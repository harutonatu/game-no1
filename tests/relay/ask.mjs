// 命令の道具（iPhone の遠隔テスト）。約束は docs/debug.md の 5.5。
// 中継サーバー（tests/relay/relay.mjs）へ HTTP で命令を送り、答えの JSON を出す。Node の標準だけ。
//
//   node tests/relay/ask.mjs <命令> [引数…] [--yes] [--port 8790] [--timeout 10000]
//   例：node tests/relay/ask.mjs info
//       node tests/relay/ask.mjs layout selector=#board limit=20
//       node tests/relay/ask.mjs tap x=100 y=200
//       node tests/relay/ask.mjs logs --since 12
//       node tests/relay/ask.mjs storage op=set key=a value=1 --yes
// 終了コード：0＝ok、1＝ok:false（使い方の誤りも 1）、2＝中継に届かない。

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const NOT_RUNNING = "中継が 動いていません：node tests/relay/relay.mjs で起動してください";
const USAGE = [
  "使い方：node tests/relay/ask.mjs <命令> [名前=値 …] [--yes] [--port 8790] [--timeout 10000]",
  "  特別な命令：status ・ logs [--since N] ・ wait",
  "  例：ask.mjs info ／ ask.mjs layout selector=#board limit=20 ／ ask.mjs tap x=100 y=200",
].join("\n");

const NAME_EQ = /^[A-Za-z_$][\w$-]*=/;

/** 値を読む：JSON として読めればその値、だめなら文字列 */
export function parseValue(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** 位置引数（命令名のあと）から args を作る。だめなら例外 */
export function parseArgsList(list) {
  if (list.length === 0) return undefined;
  if (list.length === 1 && list[0].trimStart().startsWith("{")) {
    try {
      return JSON.parse(list[0]);
    } catch (e) {
      throw new Error(`JSON として読めません：${e.message}`);
    }
  }
  if (list.length === 1 && !NAME_EQ.test(list[0])) return list[0];
  const out = {};
  for (const a of list) {
    if (!NAME_EQ.test(a)) throw new Error(`引数は 名前=値 の形で並べてください：${a}`);
    const i = a.indexOf("=");
    out[a.slice(0, i)] = parseValue(a.slice(i + 1));
  }
  return out;
}

/** コマンドラインを読む */
export function parseCli(argv) {
  const opts = { yes: false, port: undefined, timeout: undefined, since: undefined };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) {
      pos.push(a);
      continue;
    }
    const name = m[1];
    if (name === "yes") {
      opts.yes = true;
      continue;
    }
    if (name === "port" || name === "timeout" || name === "since") {
      const v = m[2] !== undefined ? m[2] : argv[++i];
      if (v === undefined || !/^\d+$/.test(v)) throw new Error(`--${name} には数を指定してください`);
      opts[name] = Number(v);
      continue;
    }
    if (name === "help") {
      opts.help = true;
      continue;
    }
    throw new Error(`知らないオプションです：${a}`);
  }
  return { command: pos[0], rest: pos.slice(1), opts };
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

async function request(url, init, waitMs) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(waitMs) });
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return { unreachable: true, error: timedOut ? "中継から 答えがありません（時間切れ）" : NOT_RUNNING };
  }
  const text = await res.text().catch(() => "");
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: { ok: false, error: `中継の答えが JSON ではありません（HTTP ${res.status}）`, text: text.slice(0, 200) } };
  }
}

async function main() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n${USAGE}\n`);
    return 1;
  }
  const { command, rest, opts } = cli;
  if (!command || opts.help) {
    process.stderr.write(USAGE + "\n");
    return command || opts.help ? 0 : 1;
  }
  const port = opts.port ?? (process.env.RELAY_PORT ? Number(process.env.RELAY_PORT) : 8790);
  const base = `http://127.0.0.1:${port}`;

  let args;
  try {
    args = parseArgsList(rest);
  } catch (e) {
    print({ ok: false, error: e.message });
    return 1;
  }

  let r;
  if (command === "status") {
    r = await request(`${base}/status`, { method: "GET" }, 10000);
  } else if (command === "logs") {
    const q = new URLSearchParams();
    const since = opts.since ?? (args && typeof args === "object" ? args.since : undefined);
    if (since !== undefined) q.set("since", String(since));
    r = await request(`${base}/logs${q.size ? "?" + q : ""}`, { method: "GET" }, 10000);
  } else if (command === "wait") {
    const q = new URLSearchParams();
    if (args && typeof args === "object") for (const [k, v] of Object.entries(args)) q.set(k, String(v));
    if (opts.timeout !== undefined) q.set("timeoutMs", String(opts.timeout));
    const t = Math.min(Number(q.get("timeoutMs")) || 15000, 60000);
    r = await request(`${base}/wait${q.size ? "?" + q : ""}`, { method: "GET" }, t + 5000);
  } else {
    if (command === "storage" && args && typeof args === "object" && (args.op === "set" || args.op === "remove") && !opts.yes) {
      print({
        ok: false,
        error: `storage の ${args.op} は保存データを書き換えるので、--yes を付けたときだけ送ります（送っていません）`,
        command,
      });
      return 1;
    }
    const body = { command };
    if (args !== undefined) body.args = args;
    const t = Math.min(opts.timeout ?? 10000, 60000);
    if (opts.timeout !== undefined) body.timeoutMs = t;
    r = await request(
      `${base}/run`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      t + 5000
    );
  }

  if (r.unreachable) {
    print({ ok: false, error: r.error });
    process.stderr.write(r.error + "\n");
    return 2;
  }
  print(r.body);
  return r.body && r.body.ok === true ? 0 : 1;
}

// 直接起動したときだけ動く（テストから parseArgsList などを読めるように）
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

if (isMain()) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`ask.mjs：${e && e.stack}\n`);
      process.exitCode = 1;
    }
  );
}
