// 中継サーバー（iPhone の遠隔テスト）。約束は docs/debug.md の 5.4。
// Node の標準モジュールだけで書く（WebSocket も自分で書く。package.json を入れない決まりのため）。
//
// 起動：node tests/relay/relay.mjs [--port 8790] [--key 1234] [--root <リポジトリ>] [--host 0.0.0.0]
// 最初の 1 行は機械が読める形：RELAY_READY port=<実際のポート> key=<合言葉>
// --port 0 なら空いているポートで起動する（テスト用）。止めるときは Ctrl+C。

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 8 * 1024 * 1024; // 1 つの枠（と、まとめた 1 つの文）の上限
const MAX_BODY = 1024 * 1024; // POST /run の本文の上限
const HELLO_TIMEOUT = 10000;
const PING_EVERY = 20000;
const DEAD_AFTER = 50000; // この間なにも届かなければ切れたとみなす（画面を消した iPhone など）
const MAX_LOGS = 1000;
const PC_PATHS = new Set(["/run", "/status", "/logs", "/wait"]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ---- ループバックの判定（export して単体で確かめられるようにする） ----

/** 接続元のアドレスがループバック（127.0.0.0/8・::1・::ffff:127.x）なら true */
export function isLoopback(addr) {
  if (typeof addr !== "string" || !addr) return false;
  let a = addr.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const pct = a.indexOf("%");
  if (pct >= 0) a = a.slice(0, pct);
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  if (a.startsWith("::ffff:")) a = a.slice(7);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const n = m.slice(1).map(Number);
  if (n.some((x) => x > 255)) return false;
  return n[0] === 127;
}

/** Host ヘッダーがループバックの名前（localhost・127.x・[::1]）なら true。DNS リバインディング対策 */
export function isLoopbackHost(host) {
  if (typeof host !== "string" || !host) return false;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0) return false;
    h = h.slice(1, end);
  } else {
    const c = h.lastIndexOf(":");
    if (c >= 0) h = h.slice(0, c);
  }
  return h === "localhost" || isLoopback(h);
}

/** PC 向けの窓口を使ってよい要求か。接続元・Host・Origin（あれば）がすべてループバック */
export function isPcRequest(remoteAddress, headers = {}) {
  if (!isLoopback(remoteAddress)) return false;
  if (!isLoopbackHost(headers.host)) return false;
  const origin = headers.origin;
  if (origin !== undefined && origin !== "") {
    try {
      const u = new URL(origin);
      if (!isLoopbackHost(u.host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---- 静的ファイルの場所（root の外へ出ない） ----

/**
 * URL の pathname（エンコードされたまま）から root の下のファイルの場所を作る。
 * だめなら null。戻り値 { file, dirSlash }（dirSlash は URL が / で終わるか）。
 */
export function resolveStatic(root, rawPathname) {
  let p = String(rawPathname || "/");
  if (p === "/game-no1") return { file: path.resolve(root), dirSlash: false }; // / を付けた URL へ移す
  if (p.startsWith("/game-no1/")) p = p.slice("/game-no1".length);
  let decoded;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  decoded = decoded.replace(/\\/g, "/"); // Windows の区切りでも外へ出ないように
  if (!decoded.startsWith("/")) return null;
  const segs = decoded.split("/").filter((s) => s !== "");
  for (const s of segs) {
    if (s === "." || s === "..") return null;
    if (s.startsWith(".")) return null; // .git など隠しファイルは出さない
    if (s.includes(":")) return null; // Windows のドライブ名・代替データストリーム
  }
  const base = path.resolve(root);
  const file = path.resolve(base, ...segs);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return { file, dirSlash: decoded.endsWith("/") };
}

// ---- WebSocket（RFC 6455 の最低限） ----

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "");
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode; // FIN つき・サーバーからはマスクしない
  return Buffer.concat([head, data]);
}

class WsConn {
  constructor(socket, onText, onClose) {
    this.socket = socket;
    this.onText = onText;
    this.onClose = onClose;
    this.buf = Buffer.alloc(0);
    this.parts = null; // 分割の枠を集める
    this.partsLen = 0;
    this.closed = false;
    this.closeSent = false;
    this.closeCode = 1006;
    this.closeReason = "";
    socket.setNoDelay(true);
    socket.on("data", (d) => this._onData(d));
    socket.on("close", () => this._finish());
    socket.on("error", () => this._finish());
  }

  sendText(str) {
    if (this.closed || this.closeSent) return false;
    try {
      this.socket.write(encodeFrame(0x1, Buffer.from(str, "utf8")));
      return true;
    } catch {
      return false;
    }
  }

  sendJson(obj) {
    return this.sendText(JSON.stringify(obj));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    if (!this.closeSent) {
      this.closeSent = true;
      this.closeCode = code;
      this.closeReason = reason;
      let r = Buffer.from(reason, "utf8");
      if (r.length > 123) r = r.subarray(0, 123);
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      try {
        this.socket.write(encodeFrame(0x8, p));
      } catch {}
      // 相手の close を待つが、来なければ 2 秒で切る
      this._killTimer = setTimeout(() => this.socket.destroy(), 2000);
      this._killTimer.unref?.();
    }
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._killTimer);
    try {
      this.socket.destroy();
    } catch {}
    this.onClose(this.closeCode, this.closeReason);
  }

  _onData(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    try {
      while (this._readFrame()) {}
    } catch {
      this.close(1002, "protocol error");
    }
  }

  // 1 つの枠を読めたら true
  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const rsv = b[0] & 0x70;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) {
        this._fail(1009, "too big");
        return false;
      }
      len = Number(big);
      off = 10;
    }
    if (rsv) {
      this._fail(1002, "rsv");
      return false;
    }
    if (!masked) {
      this._fail(1002, "client frames must be masked");
      return false;
    }
    if (len > MAX_FRAME) {
      this._fail(1009, "too big");
      return false;
    }
    const isControl = opcode >= 0x8;
    if (isControl && (len > 125 || !fin)) {
      this._fail(1002, "bad control frame");
      return false;
    }
    if (b.length < off + 4 + len) return false;
    const mask = b.subarray(off, off + 4);
    const payload = Buffer.allocUnsafe(len);
    const src = off + 4;
    for (let i = 0; i < len; i++) payload[i] = b[src + i] ^ mask[i & 3];
    this.buf = b.subarray(src + len);
    this._handle(fin, opcode, payload);
    return !this.closed && !this.closeSent;
  }

  _fail(code, reason) {
    this.buf = Buffer.alloc(0);
    this.close(code, reason);
  }

  _handle(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // 続きの枠
        if (!this.parts) return this._fail(1002, "unexpected continuation");
        this.partsLen += payload.length;
        if (this.partsLen > MAX_FRAME) return this._fail(1009, "too big");
        this.parts.push(payload);
        if (fin) {
          const all = Buffer.concat(this.parts);
          const op = this.partsOp;
          this.parts = null;
          this.partsLen = 0;
          this._message(op, all);
        }
        return;
      case 0x1:
      case 0x2:
        if (this.parts) return this._fail(1002, "expected continuation");
        if (fin) return this._message(opcode, payload);
        this.parts = [payload];
        this.partsLen = payload.length;
        this.partsOp = opcode;
        return;
      case 0x8: {
        // close：同じコードで返して切る
        let code = 1005;
        let reason = "";
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString("utf8");
        }
        if (!this.closeSent) {
          this.closeSent = true;
          this.closeCode = code;
          this.closeReason = reason;
          const p = Buffer.alloc(code === 1005 ? 0 : 2);
          if (code !== 1005) p.writeUInt16BE(code, 0);
          try {
            this.socket.write(encodeFrame(0x8, p));
          } catch {}
        }
        try {
          this.socket.end();
        } catch {}
        this._killTimer = setTimeout(() => this.socket.destroy(), 1000);
        this._killTimer.unref?.();
        return;
      }
      case 0x9: // ping → pong
        if (!this.closeSent) {
          try {
            this.socket.write(encodeFrame(0xa, payload));
          } catch {}
        }
        this.onText(null); // 生きている印
        return;
      case 0xa: // pong
        this.onText(null);
        return;
      default:
        return this._fail(1002, "unknown opcode");
    }
  }

  _message(opcode, data) {
    if (opcode !== 0x1) return this._fail(1003, "text only");
    const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
    this.onText(text);
  }
}

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

// ---- 中継サーバー本体 ----

function makeKey() {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

function shortUa(ua) {
  const s = String(ua || "");
  if (/iPhone/.test(s)) return "iPhone";
  if (/iPad/.test(s)) return "iPad";
  if (/Macintosh/.test(s) && /Safari/.test(s) && !/Chrome/.test(s)) return "Mac Safari";
  if (/Android/.test(s)) return "Android";
  if (/HeadlessChrome|Chrome/.test(s)) return "Chrome";
  if (/Firefox/.test(s)) return "Firefox";
  return s.slice(0, 40) || "不明な端末";
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      const fam = typeof n.family === "number" ? (n.family === 4 ? "IPv4" : "IPv6") : n.family;
      if (fam === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function clampMs(v, def, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/**
 * 中継サーバーを起動する。戻り値 Promise<{ server, port, key, root, close() }>。
 * opts: { port, key, root, host, log（1 行を出す関数。既定は console.log） }
 */
export function startRelay(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const key = opts.key != null ? String(opts.key) : makeKey();
  const host = opts.host || "0.0.0.0";
  const say = opts.log || ((s) => console.log(s));
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {}

  let device = null; // { conn, userAgent, page, screen, connectedAt, connectedAtMs, lastSeen }
  let nextId = 1;
  const pending = new Map(); // id → { resolve, timer, conn }
  const logs = [];
  let seq = 0;
  const waiters = new Set(); // /wait の待ち
  const allConns = new Set();
  const sockets = new Set();

  function stamp(d) {
    d.lastSeen = new Date().toISOString();
    d.lastSeenMs = Date.now();
  }

  function deviceView(d) {
    if (!d) return null;
    return {
      userAgent: d.userAgent,
      page: d.page,
      screen: d.screen,
      connectedAt: d.connectedAt,
      lastSeen: d.lastSeen,
    };
  }

  function failPendingFor(conn, error) {
    for (const [id, p] of pending) {
      if (p.conn === conn) {
        clearTimeout(p.timer);
        pending.delete(id);
        p.resolve({ ok: false, error });
      }
    }
  }

  function notifyWaiters() {
    for (const w of [...waiters]) w.check();
  }

  // ---- WebSocket の 1 本 ----
  function onUpgrade(req, socket) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pathname = "/";
    try {
      pathname = new URL(req.url, "http://x").pathname;
    } catch {}
    const wsKey = req.headers["sec-websocket-key"];
    const upgrade = String(req.headers.upgrade || "").toLowerCase();
    if (pathname !== "/relay" || upgrade !== "websocket" || !wsKey || req.headers["sec-websocket-version"] !== "13") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(wsKey)}\r\n\r\n`
    );
    const state = { hello: null };
    const remote = socket.remoteAddress;
    const conn = new WsConn(
      socket,
      (text) => onWsText(conn, state, text),
      (code) => onWsClose(conn, state, code)
    );
    allConns.add(conn);
    state.helloTimer = setTimeout(() => {
      if (!state.hello) {
        say(`[中継] hello が来ないので閉じました（${remote}）`);
        conn.close(1008, "no hello");
      }
    }, HELLO_TIMEOUT);
  }

  function onWsText(conn, state, text) {
    if (state.hello) stamp(state.hello);
    if (text === null) return; // ping/pong
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (!state.hello) {
      if (msg.type !== "hello") return; // hello の前は受け付けない
      clearTimeout(state.helloTimer);
      if (String(msg.key) !== key) {
        say(`[中継] 合言葉が ちがいます（${conn.socket.remoteAddress}）`);
        state.rejected = true;
        conn.close(4001, "bad key");
        return;
      }
      const info = msg.info && typeof msg.info === "object" ? msg.info : {};
      const sc = info.screen && typeof info.screen === "object" ? info.screen : {};
      const now = new Date();
      const d = {
        conn,
        userAgent: String(info.userAgent || ""),
        page: String(msg.page || ""),
        screen: { w: Number(sc.w) || 0, h: Number(sc.h) || 0 },
        connectedAt: now.toISOString(),
        connectedAtMs: now.getTime(),
      };
      stamp(d);
      state.hello = d;
      const old = device;
      device = d;
      if (old && old.conn !== conn) {
        failPendingFor(old.conn, "とちゅうで きれました");
        old.replaced = true;
        old.conn.close(4002, "replaced");
        say("[中継] 別の端末がつないだので、前の端末を切りました");
      }
      conn.sendJson({ type: "welcome" });
      say(`[中継] つながりました（${shortUa(d.userAgent)}、${d.screen.w}×${d.screen.h}）${d.page}`);
      notifyWaiters();
      return;
    }
    const d = state.hello;
    if (msg.type === "result") {
      const p = pending.get(msg.id);
      if (!p || p.conn !== conn) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      const { type, id, ...rest } = msg;
      say(`[中継] 命令 ${rest.command ?? p.command} ${rest.ok ? "ok" : "ng"} ${rest.ms ?? "?"}ms`);
      p.resolve(rest);
    } else if (msg.type === "log") {
      seq += 1;
      logs.push({ seq, at: new Date().toISOString(), page: d.page, entry: msg.entry });
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    } else if (msg.type === "hello") {
      // 同じ接続で hello が来たら、ページだけ覚え直す
      if (String(msg.key) === key && msg.page) d.page = String(msg.page);
    }
    // pong などはここまでで lastSeen を更新済み
  }

  function onWsClose(conn, state, code) {
    allConns.delete(conn);
    clearTimeout(state.helloTimer);
    failPendingFor(conn, "とちゅうで きれました");
    const d = state.hello;
    if (d && device === d) {
      device = null;
      say(`[中継] 切れました（${shortUa(d.userAgent)}、コード ${code}）`);
    } else if (d && d.replaced) {
      say(`[中継] 前の端末が切れました（コード ${code}）`);
    }
  }

  // 20 秒ごとの ping と、黙った接続の片付け
  const pinger = setInterval(() => {
    if (!device) return;
    if (Date.now() - device.lastSeenMs > DEAD_AFTER) {
      say("[中継] 返事がないので切りました");
      device.conn.terminate();
      return;
    }
    device.conn.sendJson({ type: "ping" });
  }, PING_EVERY);
  pinger.unref?.();

  // ---- PC 向けの窓口 ----
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let len = 0;
      req.on("data", (c) => {
        len += c.length;
        if (len > MAX_BODY) {
          reject(new Error("本文が大きすぎます"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function handleRun(req, res) {
    let body;
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "本文が JSON ではありません" });
    }
    if (!body || typeof body !== "object" || typeof body.command !== "string" || !body.command) {
      return sendJson(res, 400, { ok: false, error: "command がありません" });
    }
    const command = body.command;
    if (!device) {
      return sendJson(res, 200, { ok: false, error: "iPhone が つながっていません", command });
    }
    const timeoutMs = clampMs(body.timeoutMs, 10000, 60000);
    const id = nextId++;
    const conn = device.conn;
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        say(`[中継] 命令 ${command} 時間切れ（${timeoutMs}ms）`);
        resolve({ ok: false, error: "時間切れ", command });
      }, timeoutMs);
      pending.set(id, { resolve, timer, conn, command });
      const msg = { type: "run", id, command };
      if (body.args !== undefined) msg.args = body.args;
      if (!conn.sendJson(msg)) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ ok: false, error: "とちゅうで きれました", command });
      }
    });
    if (result.command === undefined) result.command = command;
    sendJson(res, 200, result);
  }

  function handleWait(req, res, url) {
    const timeoutMs = clampMs(url.searchParams.get("timeoutMs"), 15000, 60000);
    // 約束に無い追加：after=<connectedAt> を付けると、それより新しい接続だけを待つ（open・reload の直後用）
    const afterRaw = url.searchParams.get("after");
    let afterMs = 0;
    if (afterRaw) {
      const n = /^\d+$/.test(afterRaw) ? Number(afterRaw) : Date.parse(afterRaw);
      if (Number.isFinite(n)) afterMs = n;
    }
    let done = false;
    const w = {
      check() {
        if (done) return;
        if (device && device.connectedAtMs > afterMs) {
          finish({ ok: true, connected: true, device: deviceView(device) });
        }
      },
    };
    const timer = setTimeout(() => finish({ ok: false, error: "時間切れ" }), timeoutMs);
    function finish(obj) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiters.delete(w);
      sendJson(res, 200, obj);
    }
    res.on("close", () => {
      done = true;
      clearTimeout(timer);
      waiters.delete(w);
    });
    waiters.add(w);
    w.check();
  }

  function handlePc(req, res, url) {
    const p = url.pathname;
    if (p === "/run") {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST で送ってください" });
      return handleRun(req, res);
    }
    if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "GET で送ってください" });
    if (p === "/status") {
      return sendJson(res, 200, { ok: true, connected: !!device, key, port: actualPort, device: deviceView(device) });
    }
    if (p === "/logs") {
      const since = Number(url.searchParams.get("since")) || 0;
      return sendJson(res, 200, { ok: true, last: seq, entries: logs.filter((e) => e.seq > since) });
    }
    if (p === "/wait") return handleWait(req, res, url);
  }

  // ---- 静的ファイル ----
  async function handleStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
      return res.end("405 Method Not Allowed");
    }
    const notFound = () => {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("404 Not Found");
    };
    const rawPath = String(req.url || "/").split("?")[0].split("#")[0];
    const r = resolveStatic(root, rawPath);
    if (!r) return notFound();
    let file = r.file;
    let st;
    try {
      st = await fs.promises.stat(file);
    } catch {
      return notFound();
    }
    if (st.isDirectory()) {
      if (!r.dirSlash) {
        // 相対パスが正しく解決されるよう、/ を付けた URL へ移す
        res.writeHead(301, { Location: rawPath + "/" + url.search, "Cache-Control": "no-store" });
        return res.end();
      }
      file = path.join(file, "index.html");
      try {
        st = await fs.promises.stat(file);
      } catch {
        return notFound();
      }
    }
    if (!st.isFile()) return notFound();
    // シンボリックリンクで root の外へ出ていないか
    try {
      const real = await fs.promises.realpath(file);
      if (!real.startsWith(realRoot + path.sep)) return notFound();
    } catch {
      return notFound();
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://relay.local");
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (PC_PATHS.has(url.pathname)) {
      if (!isPcRequest(req.socket.remoteAddress, req.headers)) {
        return sendJson(res, 403, { ok: false, error: "この窓口は PC（127.0.0.1）からだけ使えます" });
      }
      return handlePc(req, res, url);
    }
    handleStatic(req, res, url).catch(() => {
      try {
        res.writeHead(500);
        res.end();
      } catch {}
    });
  });
  server.on("upgrade", onUpgrade);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  let actualPort = 0;
  let closing = null;
  function close() {
    if (closing) return closing;
    clearInterval(pinger);
    for (const c of allConns) {
      try {
        c.close(1001, "relay stopped");
      } catch {}
    }
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "とちゅうで きれました" });
    }
    pending.clear();
    closing = new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(() => {
        for (const s of sockets) s.destroy();
      }, 200).unref?.();
    });
    return closing;
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(opts.port ?? 8790), host, () => {
      server.removeListener("error", reject);
      actualPort = server.address().port;
      resolve({ server, port: actualPort, key, root, host, close });
    });
  });
}

// ---- 直接起動したときだけ動く部分 ----

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const name = a.startsWith("--") ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : null;
    if (!name) continue;
    const val = eq > 0 ? a.slice(eq + 1) : argv[++i];
    o[name] = val;
  }
  return o;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const port = a.port ?? process.env.RELAY_PORT ?? 8790;
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) {
    console.error(`ポートの指定が正しくありません：${port}`);
    process.exit(1);
  }
  if (a.key != null && !/^[A-Za-z0-9]{1,16}$/.test(a.key)) {
    console.error("--key は英数字 1〜16 文字にしてください");
    process.exit(1);
  }
  const host = a.host || "0.0.0.0";
  let relay;
  try {
    relay = await startRelay({ port: Number(port), key: a.key, root: a.root, host });
  } catch (e) {
    if (e && e.code === "EADDRINUSE") {
      console.error(`ポート ${port} は ほかのプログラムが使っています。--port で別の番号を指定してください。`);
    } else {
      console.error(`起動できませんでした：${e && e.message}`);
    }
    process.exit(1);
  }
  const { port: p, key } = relay;
  console.log(`RELAY_READY port=${p} key=${key}`);
  console.log("中継サーバーを起動しました。");
  console.log(`  合言葉：${key}`);
  console.log(`  配信している場所：${relay.root}`);
  const loopOnly = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const addrs = loopOnly ? [] : lanAddresses();
  if (addrs.length) {
    console.log("  iPhone の Safari で開く URL（同じ Wi-Fi で）：");
    for (const ip of addrs) console.log(`    http://${ip}:${p}/?debug=1&relay=1&key=${key}`);
  } else {
    console.log("  iPhone から届くアドレスが見つかりません（Wi-Fi につながっているか確かめてください）。");
  }
  console.log(`  この PC で開く URL：http://127.0.0.1:${p}/?debug=1&relay=1&key=${key}`);
  console.log(`  命令を送る：node tests/relay/ask.mjs info${String(p) === "8790" ? "" : ` --port ${p}`}`);
  console.log("  止めるときは Ctrl+C");

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(0);
    stopping = true;
    console.log("[中継] 止めます");
    relay.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (process.platform === "win32") process.on("SIGBREAK", stop);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    const me = fs.realpathSync(fileURLToPath(import.meta.url));
    const arg = fs.realpathSync(path.resolve(process.argv[1]));
    return process.platform === "win32" ? me.toLowerCase() === arg.toLowerCase() : me === arg;
  } catch {
    return false;
  }
}

if (isMain()) main();
