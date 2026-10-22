// 中継サーバー（iPhone の遠隔テスト）。約束は docs/debug.md の 5.4。
// Node の標準モジュールだけで書く（WebSocket も自分で書く。package.json を入れない決まりのため）。
//
// 起動：node tests/relay/relay.mjs [--port 8790] [--key 1234] [--root <リポジトリ>] [--host 0.0.0.0] [--exit-on-stdin-close]
// 最初の 1 行は機械が読める形：RELAY_READY port=<実際のポート> key=<合言葉>
// --port 0 なら空いているポートで起動する（テスト用）。止めるときは Ctrl+C。
// --exit-on-stdin-close：標準入力が閉じたら終わる（テストから起動したとき、親が先に終わっても中継が残らないように）。

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
const MAX_FRAME_BEFORE_HELLO = 64 * 1024; // hello の前は小さく（合言葉を知らない相手にメモリを使わせない）
const MAX_LOG_ENTRY = 32 * 1024; // ログ 1 件の上限（バイト。超えたら切り詰める）
const MAX_PRE_HELLO = 8; // hello の前の接続の数の上限
const MAX_BAD_KEYS = 5; // 合言葉の間違いがこの回数になったら、起動し直すまで hello をすべて断る
const KEY_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // 紛らわしい文字（0 o O 1 l i I）を除く
const KEY_LEN = 8;
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

/**
 * WebSocket の Host が IP アドレス（IPv4・[IPv6]）か localhost なら true（ポートは付いていてよい）。
 * 名前（evil.example など）は断る：DNS リバインディングで、よそのページから中継につながれないように。
 */
export function isIpOrLocalHost(host) {
  if (typeof host !== "string" || !host) return false;
  const h = host.trim().toLowerCase();
  let name;
  let rest;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0) return false;
    name = h.slice(1, end);
    rest = h.slice(end + 1);
    if (!/^[0-9a-f:.]+$/.test(name) || !name.includes(":")) return false;
  } else {
    const c = h.indexOf(":");
    name = c >= 0 ? h.slice(0, c) : h;
    rest = c >= 0 ? h.slice(c) : "";
    if (name !== "localhost") {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
      if (!m || m.slice(1).some((x) => Number(x) > 255)) return false;
    }
  }
  return rest === "" || /^:\d{1,5}$/.test(rest);
}

/**
 * WebSocket の Origin が、つないできたページそのもの（http:// ＋ Host。https なら https://）なら true。
 * Origin が無い・違うものは断る（よそのサイトのページや、ブラウザ以外からのなりすましを防ぐ）。
 */
export function isSameOrigin(origin, host, secure = false) {
  if (typeof origin !== "string" || !origin || typeof host !== "string" || !host) return false;
  const want = (secure ? "https://" : "http://") + host.trim().toLowerCase();
  return origin.trim().toLowerCase() === want;
}

/** WebSocket の upgrade を受けてよいか（Host が IP か localhost、Origin が同じページ） */
export function isAllowedUpgrade(headers = {}, secure = false) {
  return isIpOrLocalHost(headers.host) && isSameOrigin(headers.origin, headers.host, secure);
}

/** 既定の合言葉：紛らわしい文字を除いた英小文字と数字の 8 文字（crypto の乱数） */
export function makeKey() {
  let s = "";
  for (let i = 0; i < KEY_LEN; i++) s += KEY_CHARS[crypto.randomInt(0, KEY_CHARS.length)];
  return s;
}

/**
 * real（realpath したもの）が realRoot の中なら、root からの相対パスを返す。外なら null。
 * Windows（win32）では大文字小文字を区別しない。plat を変えると、ほかの OS の形でも確かめられる。
 */
export function relInside(realRoot, real, plat = process.platform) {
  const P = plat === "win32" ? path.win32 : path.posix;
  let a = String(realRoot);
  let b = String(real);
  if (plat === "win32") {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  const rel = P.relative(a, b);
  if (!rel || rel === ".." || rel.startsWith(".." + P.sep) || P.isAbsolute(rel)) return null;
  return rel;
}

/** root の中で、相対パスのどこかに . で始まる部分（.git など）があれば true */
export function hasHiddenPart(rel, plat = process.platform) {
  const sep = plat === "win32" ? /[\\/]/ : /\//;
  return String(rel).split(sep).some((s) => s.startsWith("."));
}

// ---- 静的ファイルの場所（root の外へ出ない） ----

/**
 * URL の pathname（エンコードされたまま）から root の下のファイルの場所を作る。
 * だめなら null。戻り値 { file, dirSlash, slashURL }（dirSlash は URL が / で終わるか、
 * slashURL はフォルダのとき移す先の URL。先頭の / は必ず 1 つ＝よそのサイトへ移さない）。
 */
export function resolveStatic(root, rawPathname) {
  let p = String(rawPathname || "/").replace(/^\/+/, "/"); // //games → /games（//games/ だとよそのサイトと読まれる）
  if (!p.startsWith("/")) return null;
  let prefix = "";
  if (p === "/game-no1") return { file: path.resolve(root), dirSlash: false, slashURL: "/game-no1/" }; // / を付けた URL へ移す
  if (p.startsWith("/game-no1/")) {
    p = p.slice("/game-no1".length);
    prefix = "/game-no1";
  }
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
    if (s.includes("~")) return null; // Windows の 8.3 形式の短い名前（GIT~1 → .git）
  }
  const base = path.resolve(root);
  const file = path.resolve(base, ...segs);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  const slashURL = prefix + "/" + segs.map((s) => encodeURIComponent(s)).join("/") + (segs.length ? "/" : "");
  return { file, dirSlash: decoded.endsWith("/"), slashURL };
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
    this.maxFrame = MAX_FRAME; // hello の前は小さくする（startRelay が決める）
    socket.setNoDelay(true);
    socket.on("data", (d) => this._onData(d));
    socket.on("close", () => this._finish());
    socket.on("end", () => this._finish()); // 相手が閉じた（http のサーバーは半分開いたままにするので、こちらも閉じる）
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
      if (big > BigInt(this.maxFrame)) {
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
    if (len > this.maxFrame) {
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
        if (this.partsLen > this.maxFrame) return this._fail(1009, "too big");
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

// 仮想のネットワーク（iPhone からは届かないことが多い）のアダプタ名（T-12）
const VIRTUAL_NAME = /virtualbox|vbox|vmware|vmnet|hyper-?v|vethernet|\bwsl\b|docker|\bveth|virbr|\bbr-|\blxd|\blxc|podman|parallels|utun|tailscale|zerotier|loopback|pseudo/i;
/** 仮想のネットワークらしいか（アダプタ名か、アドレスの範囲で見る） */
export function isVirtualLan(name, address) {
  if (VIRTUAL_NAME.test(String(name || ""))) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(String(address || ""));
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
  if (a === 192 && b === 168 && c === 56) return true;   // VirtualBox のホストオンリー（既定）
  if (a === 172 && b >= 16 && b <= 31) return true;      // WSL・Hyper-V・Docker の既定
  if (a === 169 && b === 254) return true;               // つながっていないアダプタ（自動のアドレス）
  return false;
}
/**
 * iPhone で開く URL のアドレスを、使いそうな順に並べる（純粋関数。T-12）。
 * nets は os.networkInterfaces() と同じ形。IPv4 で内部（ループバック）でないものだけ。
 * 並び：ふつうの LAN（192.168. → 10. → そのほか）→ 仮想。同じ組の中は元の順。戻り値 [{ address, name, virtual }]
 */
export function orderLanAddresses(nets) {
  const list = [];
  for (const name of Object.keys(nets || {})) {
    for (const n of (nets && nets[name]) || []) {
      if (!n || typeof n.address !== "string") continue;
      const fam = typeof n.family === "number" ? (n.family === 4 ? "IPv4" : "IPv6") : n.family;
      if (fam === "IPv4" && !n.internal) list.push({ address: n.address, name, virtual: isVirtualLan(name, n.address) });
    }
  }
  const rank = (x) => (x.virtual ? 3 : x.address.startsWith("192.168.") ? 0 : x.address.startsWith("10.") ? 1 : 2);
  return list.map((x, i) => ({ x, i })).sort((p, q) => rank(p.x) - rank(q.x) || p.i - q.i).map((p) => p.x);
}

function lanAddresses() {
  return orderLanAddresses(os.networkInterfaces());
}

/** 起動の表示のうち、iPhone で開く URL の行（純粋関数。addrs は orderLanAddresses の戻り値） */
export function lanUrlLines(addrs, port, key) {
  if (!addrs || !addrs.length) return ["  iPhone から届くアドレスが見つかりません（Wi-Fi につながっているか確かめてください）。"];
  const url = (ip) => `http://${ip}:${port}/?debug=1&relay=1&key=${key}`;
  const lines = ["  iPhone の Safari で開く URL（同じ Wi-Fi で）："];
  addrs.forEach((a, i) => {
    const note = a.virtual ? "　（仮想のネットワーク。ふつうは使わない）" : i === 0 && addrs.length > 1 ? "　← おすすめ" : "";
    lines.push(`    ${url(a.address)}${note}`);
  });
  if (addrs.length > 1) lines.push("    （複数あるときは、iPhone と同じ Wi-Fi のもの。ふつうは一番上の 192.168. で始まるもの）");
  return lines;
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

/** ログ 1 件を MAX_LOG_ENTRY バイトまでに切り詰める（超えたら { truncated, text } にする） */
function clipEntry(entry) {
  let s;
  try {
    s = JSON.stringify(entry);
  } catch {
    return { truncated: true, text: "" };
  }
  if (s === undefined) return entry;
  if (Buffer.byteLength(s) <= MAX_LOG_ENTRY) return entry;
  const level = entry && typeof entry === "object" && typeof entry.level === "string" ? entry.level.slice(0, 20) : undefined;
  return { level, truncated: true, text: Buffer.from(s, "utf8").subarray(0, MAX_LOG_ENTRY - 200).toString("utf8") };
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
    realRoot = fs.realpathSync.native(root); // 下の静的ファイルと同じ方式（Windows で 2 種類が混ざらないように）
  } catch {}
  let badKeys = 0; // 合言葉の間違いの数（MAX_BAD_KEYS で締め切る）
  const preHello = new Set(); // hello の前の接続

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
  function onUpgrade(req, socket, head) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
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
    // なりすまし対策：Host は IP か localhost だけ、Origin はそのページ自身（http:// ＋ Host）だけ
    if (!isAllowedUpgrade(req.headers, !!req.socket.encrypted)) {
      say(`[中継] よそからの接続を断りました（Host ${String(req.headers.host || "なし").slice(0, 60)}・Origin ${String(req.headers.origin || "なし").slice(0, 60)}）`);
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (preHello.size >= MAX_PRE_HELLO) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
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
    conn.maxFrame = MAX_FRAME_BEFORE_HELLO;
    allConns.add(conn);
    preHello.add(conn);
    state.helloTimer = setTimeout(() => {
      if (!state.hello) {
        say(`[中継] hello が来ないので閉じました（${remote}）`);
        conn.close(1008, "no hello");
      }
    }, HELLO_TIMEOUT);
    if (head && head.length) conn._onData(head); // 握手と同じ包みで届いた最初の枠も読む
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
      if (badKeys >= MAX_BAD_KEYS) {
        say(`[中継] 締め切り中なので断りました（${conn.socket.remoteAddress}）。起動し直すと受け付けます`);
        state.rejected = true;
        conn.close(4001, "locked");
        return;
      }
      if (String(msg.key) !== key) {
        badKeys += 1;
        say(`[中継] 合言葉が ちがいます（${conn.socket.remoteAddress}、${badKeys} 回目）`);
        if (badKeys >= MAX_BAD_KEYS) {
          say(`[中継] 合言葉の間違いが ${MAX_BAD_KEYS} 回になったので、これからの接続はすべて断ります。中継を起動し直してください（Ctrl+C → もう一度 node tests/relay/relay.mjs）`);
        }
        state.rejected = true;
        conn.close(4001, "bad key");
        return;
      }
      preHello.delete(conn);
      conn.maxFrame = MAX_FRAME;
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
      logs.push({ seq, at: new Date().toISOString(), page: d.page, entry: clipEntry(msg.entry) });
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    } else if (msg.type === "hello") {
      // 同じ接続で hello が来たら、ページだけ覚え直す
      if (String(msg.key) === key && msg.page) d.page = String(msg.page);
    }
    // pong などはここまでで lastSeen を更新済み
  }

  function onWsClose(conn, state, code) {
    allConns.delete(conn);
    preHello.delete(conn);
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
      return sendJson(res, 200, { ok: true, connected: !!device, key, port: actualPort, device: deviceView(device), badKeys, locked: badKeys >= MAX_BAD_KEYS });
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
    const rawPath = String(req.url || "/").split("?")[0].split("#")[0].replace(/^\/+/, "/");
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
        res.writeHead(301, { Location: r.slashURL + url.search, "Cache-Control": "no-store" });
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
    // シンボリックリンク・8.3 形式の短い名前で root の外や .git へ出ていないか（実際の場所で確かめる）
    try {
      const real = fs.realpathSync.native(file);
      const rel = relInside(realRoot, real);
      if (rel === null || hasHiddenPart(rel)) return notFound();
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

const FLAGS = new Set(["exit-on-stdin-close"]); // 値を取らないオプション

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const name = a.startsWith("--") ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : null;
    if (!name) continue;
    if (FLAGS.has(name)) {
      o[name] = true;
      continue;
    }
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
  for (const line of lanUrlLines(addrs, p, key)) console.log(line);
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
  if (a["exit-on-stdin-close"] !== undefined) {
    // テストから起動したとき：親（テスト）が終わって標準入力が閉じたら、中継も終わる
    let once = false;
    const stdinStop = () => {
      if (once) return;
      once = true;
      stop();
    };
    process.stdin.on("end", stdinStop);
    process.stdin.on("close", stdinStop);
    process.stdin.on("error", stdinStop);
    process.stdin.resume();
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    const me = fs.realpathSync.native(fileURLToPath(import.meta.url));
    const arg = fs.realpathSync.native(path.resolve(process.argv[1]));
    return process.platform === "win32" ? me.toLowerCase() === arg.toLowerCase() : me === arg;
  } catch {
    return false;
  }
}

if (isMain()) main();
