// RL: iPhone の遠隔テスト（中継）。tests/relay/relay.mjs（中継サーバー）・tests/relay/ask.mjs（命令の道具）・
// common/debug-relay.js（運び役）を、本物の iPhone の代わりに Playwright のページをつないで確かめる（約束は docs/debug.md の 5 章）。
// 中継は子のプロセスとして「合言葉を固定（--key）・空いているポート（--port 0）・127.0.0.1 だけで待つ」形で起動し、
// テストが終わったら（失敗しても）必ず止める。PC 向けの窓口（/run・/status・/logs・/wait）は fetch で呼ぶ。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { BASE, custom, newPage, sleep, swInfo, pageErrors } from '../lib.mjs';

const KEY = '4321';
const V = (w = 390, h = 844) => custom(w, h, null, `${w}×${h}`);

// ---------- 中継（子のプロセス） ----------
const children = new Set();
// 念のため：テストの子プロセス（run.mjs の worker）が終わるときに、残った中継を止める
process.on('exit', () => { for (const c of children) { try { c.kill(); } catch { /* 無視 */ } } });

// 起動の行から実際のポートを読む（relay.mjs は最初に「RELAY_READY port=<ポート> key=<合言葉>」を出す）
const PORT_RE = /RELAY_READY port=(\d+)/;
// --exit-on-stdin-close：テスト（親）が落ちて標準入力が閉じたら、中継も終わる（残らない）。key:null なら --key を付けない（既定の合言葉）
const KEY_RE = /RELAY_READY port=\d+ key=(\S+)/;
function startRelay(root, { key = KEY, port = 0, host = '127.0.0.1', relRoot } = {}) {
  const file = path.join(root, 'tests/relay/relay.mjs');
  const args = [file, '--port', String(port), '--host', host, '--exit-on-stdin-close'];
  if (key !== null) args.push('--key', key);
  if (relRoot) args.push('--root', relRoot);
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, RELAY_PORT: '' } });
  children.add(child);
  let out = '';
  const r = {
    child, key, get out() { return out; }, port: null,
    url: (p = '') => `http://127.0.0.1:${r.port}/${p}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode) { children.delete(child); return; }
      const done = new Promise((res) => child.once('exit', res));
      child.kill();
      await Promise.race([done, sleep(3000)]);
      if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await Promise.race([done, sleep(2000)]); }
      children.delete(child);
    },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { r.stop(); reject(new Error('中継が 10 秒以内に起動の行を出さない\n' + out.slice(-800))); }, 10000);
    const on = (d) => {
      out += d;
      const m = out.match(PORT_RE);
      if (m && !r.port) { r.port = Number(m[1]); const k = out.match(KEY_RE); if (k) r.key = k[1]; clearTimeout(timer); resolve(r); }
    };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.once('exit', (code) => { if (!r.port) { clearTimeout(timer); reject(new Error(`中継が起動の途中で終了（code ${code}）\n${out.slice(-800)}`)); } });
  });
}
// 1 項目の中で起動した中継をすべて止める（失敗しても）
async function withRelays(fn) {
  const mine = [];
  const start = async (root, o) => { const r = await startRelay(root, o); mine.push(r); return r; };
  try { return await fn(start); } finally { for (const r of mine) await r.stop().catch(() => {}); }
}
const api = async (r, p, body) => {
  const res = await fetch(r.url(p.replace(/^\//, '')), body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; } catch { return { status: res.status, text }; }
};
const run = (r, command, args, timeoutMs) => api(r, '/run', { command, args, ...(timeoutMs ? { timeoutMs } : {}) });
// 条件がそろうまで待つ（fn が真を返すまで。だめなら最後の値）
async function until(fn, ms = 10000, step = 100) {
  const t0 = Date.now(); let v;
  while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(step); }
  return v;
}
// 生の HTTP 要求（fetch は /../ を先に正規化してしまうので、パスをそのまま送る）
const rawGet = (port, p, host = '127.0.0.1') => new Promise((resolve) => {
  const req = http.request({ host, port, path: p, method: 'GET' }, (res) => {
    let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  req.on('error', (e) => resolve({ status: 0, error: e.message, body: '' }));
  req.end();
});
// 空いているポート（何も待っていないポート。ask.mjs の「中継が無い」確認用）
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// ---------- Node の偽の端末（ブラウザを使わない WebSocket。枠の形を自分で作って送る） ----------
// 端末から中継への枠（マスクつき）。len127 は長さを 127 形式で書く（64KB 以上で使う）
function cframe(op, payload, { fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = (fin ? 0x80 : 0) | op;
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}
const helloMsg = (key, page = '/rl-node') => JSON.stringify({ type: 'hello', key, page, info: { userAgent: 'node-rl', screen: { w: 11, h: 22 } } });
// 中継へ WebSocket の握手を送る。first を渡すと、握手と同じ write で続けて送る（upgrade の head に入る）
function wsClient(port, { origin, host, first, noOrigin = false } = {}) {
  const H = host ?? `127.0.0.1:${port}`;
  const O = noOrigin ? null : (origin ?? `http://${H}`);
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const c = { sock, status: 0, frames: [], closeCode: null, ended: false, raw: '' };
    let buf = Buffer.alloc(0), headDone = false, settled = false;
    const done = () => { if (!settled) { settled = true; resolve(c); } };
    c.send = (b) => { try { sock.write(b); } catch { /* 無視 */ } };
    c.text = (o) => c.send(cframe(0x1, typeof o === 'string' ? o : JSON.stringify(o)));
    c.msgs = () => c.frames.filter((f) => f.op === 1).map((f) => { try { return JSON.parse(f.data.toString('utf8')); } catch { return null; } }).filter(Boolean);
    c.until = (fn, ms = 5000) => until(async () => fn(c), ms, 20);
    c.end = () => { try { sock.destroy(); } catch { /* 無視 */ } };
    sock.on('connect', () => {
      const lines = ['GET /relay HTTP/1.1', `Host: ${H}`, 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13'];
      if (O !== null) lines.push(`Origin: ${O}`);
      const req = Buffer.from(lines.join('\r\n') + '\r\n\r\n');
      sock.write(first ? Buffer.concat([req, first]) : req);
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!headDone) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        c.raw = buf.subarray(0, i).toString('latin1');
        c.status = Number((/^HTTP\/1\.1 (\d+)/.exec(c.raw) || [])[1] || 0);
        buf = buf.subarray(i + 4); headDone = true; done();
      }
      for (;;) {
        if (buf.length < 2) break;
        const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        const data = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        c.frames.push({ op, data });
        if (op === 0x8) c.closeCode = data.length >= 2 ? data.readUInt16BE(0) : 1005;
      }
    });
    const fin = () => { c.ended = true; done(); };
    sock.on('close', fin); sock.on('error', fin);
    setTimeout(done, 5000);
  });
}

// ---------- ask.mjs（子のプロセス） ----------
function ask(root, args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(root, 'tests/relay/ask.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(c);
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill(), 20000);
    c.on('close', (code) => { clearTimeout(t); children.delete(c); let json = null; try { json = JSON.parse(out); } catch { /* JSON でない */ } resolve({ code, out, err, json }); });
  });
}

// ---------- iPhone の代わりのページ ----------
// WebSocket を包んで、つないだ回数と閉じたときのコードを window.__rl に記録する（運び役の動きは変えない）
const wsSpy = () => {
  const W = window.WebSocket;
  if (!W || W.__rlSpy) return;
  window.__rl = { opens: 0, urls: [], closes: [] };
  const S = function (u, p) {
    const ws = p === undefined ? new W(u) : new W(u, p);
    window.__rl.opens++; window.__rl.urls.push(String(u));
    ws.addEventListener('close', (e) => window.__rl.closes.push(e.code));
    return ws;
  };
  S.prototype = W.prototype; S.__rlSpy = true;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) S[k] = W[k];
  window.WebSocket = S;
};
// 中継を止めている間の「WebSocket につながらない」は、ブラウザが console に出すことがある（RL4 でわざと起こす）。
// これだけは X1 の集計に入れない（ほかのエラーは今までどおり数える）
const WS_NOISE = /WebSocket connection to .*\/relay.* failed|WebSocket .*\/relay|ws:\/\/127\.0\.0\.1:\d+\/relay/;
function allowWsNoise(page, label) {
  page.removeAllListeners('console'); page.removeAllListeners('pageerror');
  page.on('console', (m) => { if (m.type() === 'error' && !WS_NOISE.test(m.text())) pageErrors.push(`${label}: [console] ${m.text()}`); });
  page.on('pageerror', (e) => { if (!WS_NOISE.test(String(e.message))) pageErrors.push(`${label}: [pageerror] ${e.message}`); });
}
async function phone(browser, label, { w, h } = {}) {
  const { ctx, page } = await newPage(browser, V(w, h), label, { initScript: wsSpy });
  allowWsNoise(page, label);
  const sockets = [];
  page.on('websocket', (ws) => { if (/\/relay$/.test(ws.url())) sockets.push(ws.url()); });
  const relayJs = [];
  page.on('request', (q) => { if (q.url().includes('/common/debug-relay.js')) relayJs.push(q.url()); });
  return { ctx, page, sockets, relayJs };
}
const relayStatus = (page) => page.evaluate(() => (window.YubiDebugRelay ? window.YubiDebugRelay.status() : 'none')).catch((e) => 'err:' + e.message);
const spy = (page) => page.evaluate(() => window.__rl || null).catch(() => null);
const openPhone = (r, page, p = '', key = r.key) => page.goto(r.url(`${p}?debug=1&relay=1&key=${key}`));

export const tests = [
  {
    id: 'RL1', tier: 'smoke', title: '中継：起動 → ?debug=1&relay=1&key=… で開く → /status が connected、info・layout・state・logs が /run で返る',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        check('中継が子のプロセスとして起動し、起動の行から実際のポートが読める（--port 0）', r.port > 0, r.out.slice(0, 400));
        const st0 = await api(r, '/status');
        check('/status（つなぐ前）：ok・connected:false・key・port・device:null', st0.ok === true && st0.connected === false && st0.key === KEY && st0.port === r.port && st0.device === null, st0);
        const none = await run(r, 'info');
        check('/run（つなぐ前）：{ ok:false, error:"iPhone が つながっていません" }', none.ok === false && none.error === 'iPhone が つながっていません', none);
        const { ctx, page, relayJs } = await phone(browser, 'RL1');
        try {
          await openPhone(r, page);
          const w = await api(r, '/wait?timeoutMs=10000');
          check('/wait：つながるまで待って { ok:true, connected:true, device } を返す', w.ok === true && w.connected === true && !!w.device, w);
          const st = await api(r, '/status');
          const d = st.device || {};
          check('/status：connected:true、device に userAgent・page・screen{w,h}・connectedAt・lastSeen', st.ok && st.connected === true && typeof d.userAgent === 'string' && d.userAgent.length > 0 && typeof d.page === 'string' && d.page.startsWith('/') && d.screen && d.screen.w > 0 && d.screen.h > 0 && d.connectedAt != null && d.lastSeen != null, st);
          // 中継は hello を受けた時点で connected にし、そのあと welcome を送る。ページが welcome を読むまで待つ（WebKit は少し遅れる）
          await until(async () => (await relayStatus(page)) === 'open', 3000, 50);
          check('ページ側：debug-relay.js を読み込み、YubiDebugRelay.status() が open、sessionStorage yubi.relay に合言葉', relayJs.length === 1 && (await relayStatus(page)) === 'open' && (await page.evaluate(() => sessionStorage.getItem('yubi.relay'))) === KEY, { relayJs, s: await relayStatus(page) });
          const info = await run(r, 'info');
          check('info：{ ok:true, result, command:"info", ms }（type・id は外す）、result の画面の幅が 390', info.ok === true && info.command === 'info' && typeof info.ms === 'number' && !('type' in info) && !('id' in info) && info.result && info.result.window && info.result.window.innerWidth === 390 && typeof info.result.userAgent === 'string', info);
          const lay = await run(r, 'layout', { selector: 'a.game', limit: 3 });
          check('layout：メニューのカード（a.game）の位置と大きさが返る', lay.ok === true && lay.result && lay.result.count > 0 && Array.isArray(lay.result.items) && lay.result.items.length > 0 && lay.result.items[0].w > 0, lay.ok ? { count: lay.result.count } : lay);
          const state = await run(r, 'state');
          check('state：ok で、games の配列が返る', state.ok === true && state.result && Array.isArray(state.result.games), state);
          await page.evaluate(() => { console.log('RLTEST ログが 中継へ届く'); console.warn('RLTEST 注意'); });
          const lg = await until(async () => { const x = await api(r, '/logs?since=0'); return x.ok && (x.entries || []).some((e) => JSON.stringify(e.entry).includes('RLTEST ログが')) ? x : null; }, 5000) || await api(r, '/logs?since=0');
          const hit = (lg.entries || []).filter((e) => JSON.stringify(e.entry).includes('RLTEST'));
          check('/logs：ページの console.log・warn が { seq, at, page, entry } で届く（last がある）', lg.ok === true && typeof lg.last === 'number' && hit.length >= 2 && hit.every((e) => typeof e.seq === 'number' && e.at != null && typeof e.page === 'string'), lg.entries ? lg.entries.slice(-5) : lg);
          const lg2 = await api(r, `/logs?since=${lg.last}`);
          check('/logs?since=last：それより新しいものだけ（0 件）', lg2.ok === true && Array.isArray(lg2.entries) && lg2.entries.length === 0, lg2);
          const logs = await run(r, 'logs');
          check('/run logs：エラー件数とログの配列', logs.ok === true && typeof logs.result.errors === 'number' && Array.isArray(logs.result.entries) && logs.result.entries.some((e) => JSON.stringify(e).includes('RLTEST')), logs.ok ? { n: logs.result.entries.length } : logs);
          const bad = await run(r, 'nosuch');
          check('ない命令：/run が ok:false とエラー文を返す（中継・運び役は落ちない）', bad.ok === false && typeof bad.error === 'string', bad);
          const slow = await page.evaluate(() => { window.YubiDebug.command('rlslow', () => new Promise((res) => setTimeout(() => res(1), 3000))); return true; });
          const to = await run(r, 'rlslow', {}, 500);
          check('答えが timeoutMs を過ぎると { ok:false, error:"時間切れ" }', slow && to.ok === false && to.error === '時間切れ', to);
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL2', tier: 'full', title: '中継：合言葉が違うとつながらない（4001・status() が rejected・つなぎ直さない）、形の悪い key は読み込まない',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        const { ctx, page, sockets, relayJs } = await phone(browser, 'RL2');
        try {
          await openPhone(r, page, '', '9999');
          const s = await until(async () => ((await relayStatus(page)) === 'rejected' ? 'rejected' : null), 6000) || await relayStatus(page);
          check('合言葉ちがい：YubiDebugRelay.status() が rejected', s === 'rejected', s);
          await sleep(3500);   // つなぎ直すなら 1・2 秒後に試すはず
          const sp = await spy(page);
          check('閉じるコードは 4001、そのあと 3.5 秒待ってもつなぎ直さない（WebSocket は 1 回だけ）', sp && sp.closes.includes(4001) && sp.opens === 1 && sockets.length === 1, { sp, sockets });
          const st = await api(r, '/status');
          check('中継側：connected:false のまま、/run は「つながっていません」', st.connected === false && (await run(r, 'info')).error === 'iPhone が つながっていません', st);
          const warn = await page.evaluate(() => JSON.stringify(window.YubiDebug.logs()));
          check('ページのログに「中継：合言葉が ちがいます」（warn）が出る', /合言葉が ちがいます/.test(warn), warn.slice(0, 400));
          // key の形が悪い（英数字 1〜16 文字以外）：覚えず、debug-relay.js も読まない
          const { ctx: c2, page: p2, relayJs: j2, sockets: s2 } = await phone(browser, 'RL2b');
          try {
            for (const k of ['ab-cd', '12345678901234567', '', '%3Cx%3E']) await p2.goto(r.url(`?debug=1&relay=1&key=${k}`)).then(() => sleep(300));
            const ss = await p2.evaluate(() => sessionStorage.getItem('yubi.relay'));
            check('形の悪い key（記号・17 文字・空・<x>）：yubi.relay を覚えず、debug-relay.js を読まず、つながない', ss === null && j2.length === 0 && s2.length === 0, { ss, j2, s2 });
            // 正しい key を覚えたあとで、形の悪い key を付けて開くと、覚えた yubi.relay も消す
            await p2.goto(r.url(`?debug=1&relay=1&key=${KEY}`)); await sleep(300);
            const had = await p2.evaluate(() => sessionStorage.getItem('yubi.relay'));
            await p2.goto(r.url('games/hashi/?relay=1&key=ab-cd')); await sleep(300);
            const after = { ss: await p2.evaluate(() => sessionStorage.getItem('yubi.relay')), api: await p2.evaluate(() => typeof window.YubiDebugRelay) };
            check('覚えた合言葉があっても、relay=1 で形の悪い key なら yubi.relay を消し、つながない', had === KEY && after.ss === null && after.api === 'undefined', { had, after });
          } finally { await c2.close(); }
          check('（参考）合言葉ちがいのページは debug-relay.js を 1 回だけ読む', relayJs.length === 1, relayJs);
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL3', tier: 'full', title: '中継：open でメニュー→ゲームへ移っても、/wait のあと命令が通る（移る先の URL に debug・relay・key を付ける。sessionStorage も残る）、open は同じサイトの / 始まりだけ',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        const { ctx, page } = await phone(browser, 'RL3');
        try {
          await openPhone(r, page);
          await api(r, '/wait?timeoutMs=10000');
          for (const p of ['//example.com/', 'http://example.com/', 'games/hashi/', 'javascript:alert(1)', '/\\example.com/', '/games/ha shi/', '/games/\nhashi/', '']) {
            const x = await run(r, 'open', { path: p });
            check(`open { path: ${JSON.stringify(p)} } は ok:false（移らない）`, x.ok === false, x);
          }
          await sleep(300);
          check('悪い path では移っていない（メニューのまま）', new URL(page.url()).pathname === '/', page.url());
          const before = (await api(r, '/status')).device.connectedAt;
          const o = await run(r, 'open', { path: '/games/hashi/' });
          check('open { path:"/games/hashi/" } は ok:true を返してから移る', o.ok === true, o);
          await page.waitForURL(/\/games\/hashi\/(\?|$)/, { timeout: 5000 }).catch(() => {});
          await sleep(300);
          const w = await api(r, `/wait?timeoutMs=15000&after=${encodeURIComponent(before)}`);
          const st = await until(async () => { const x = await api(r, '/status'); return x.connected && x.device && /^\/games\/hashi\//.test(x.device.page) ? x : null; }, 15000) || await api(r, '/status');
          check('移った先（/games/hashi/）でつなぎ直し、/wait?after=<直前の connectedAt> が新しい接続を返し、/status の page が /games/hashi/', w.ok === true && w.device && /^\/games\/hashi\//.test(w.device.page) && st.connected === true && /^\/games\/hashi\//.test(st.device.page), { w, st });
          { const sp = new URL(page.url()).searchParams;
            check('移った先の URL に debug=1・relay=1・key=今の合言葉 が付き、open の答えの href と同じ、sessionStorage の合言葉も残る（T-11）', sp.get('debug') === '1' && sp.get('relay') === '1' && sp.get('key') === KEY && o.result && o.result.href === page.url() && (await page.evaluate(() => sessionStorage.getItem('yubi.relay'))) === KEY, { url: page.url(), o }); }
          const info = await run(r, 'info');
          const state = await run(r, 'state');
          check('移った先でも info・state が通る', info.ok === true && state.ok === true && Array.isArray(state.result.games), { info: info.ok, state });
          const before2 = (await api(r, '/status')).device.connectedAt;
          await page.evaluate(() => { window.__rlMark = 'よみなおす前'; });
          const rl = await run(r, 'reload');
          const w2 = await api(r, `/wait?timeoutMs=15000&after=${encodeURIComponent(before2)}`);
          const info2 = await run(r, 'info');
          check('reload は ok:true を返し、読み直した（印が消えた）あと /wait?after= で新しい接続になり、命令が通る', rl.ok === true && w2.ok === true && w2.device && w2.device.connectedAt !== before2 && info2.ok === true && (await page.evaluate(() => window.__rlMark)) === undefined, { rl, w2, info2: info2.ok });
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL4', tier: 'full', title: '中継：止めて起動し直すと、運び役が自動でつなぎ直す（ページは読み直さない）',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r1 = await start(root);
        const { ctx, page } = await phone(browser, 'RL4');
        try {
          await openPhone(r1, page);
          await api(r1, '/wait?timeoutMs=10000');
          await page.evaluate(() => { window.__rlMark = 'まだ同じページ'; });
          const port = r1.port;
          await r1.stop();
          const s = await until(async () => { const x = await relayStatus(page); return x !== 'open' ? x : null; }, 5000);
          check('中継を止めると、運び役の status() が open でなくなる（connecting か closed。rejected ではない）', ['connecting', 'closed'].includes(s), s);
          await sleep(1500);
          const r2 = await start(root, { port });
          check('同じポートで起動し直せる', r2.port === port, r2.out.slice(0, 300));
          const t0 = Date.now();
          const w = await api(r2, '/wait?timeoutMs=20000');
          const sec = (Date.now() - t0) / 1000;
          check(`起動し直した中継に自動でつなぎ直す（${sec.toFixed(1)} 秒。間隔は最大 10 秒）`, w.ok === true && w.connected === true && sec <= 12, w);
          const info = await run(r2, 'info');
          check('つなぎ直したあと info が通り、ページは読み直していない（印が残る）', info.ok === true && (await page.evaluate(() => window.__rlMark)) === 'まだ同じページ' && (await relayStatus(page)) === 'open', info.ok ? 'ok' : info);
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL5', tier: 'smoke', title: '中継：relay を付けない（?debug=1 だけ・?debug なし・debug なしの relay=1）ときは debug-relay.js を読み込まない、?relay=0 と「デバッグを終わる」で消える、APP_FILES に入れない',
    async run({ browser, check, root }) {
      check('common/debug-relay.js は sw.js の APP_FILES に入れない（http でしか使わない）', !swInfo(root).files.includes('./common/debug-relay.js'), swInfo(root).files.filter((f) => f.includes('common')));
      // ふだんのテスト用サーバー（/game-no1/）で、relay を付けない開き方
      const { ctx, page, relayJs, sockets } = await phone(browser, 'RL5');
      try {
        const got = [];
        // デバッグが無効のうち（sessionStorage にまだ覚えていない）に relay=1 を試し、そのあと ?debug=1 だけで開く
        // 待ち方：goto は load まで待つ。debug.js は読み込みの途中で <script> を足すので、読み込むなら load の前に要求が出て、
        // load の時点で performance の記録に残る。デバッグが有効のページは YubiDebug ができていることも確かめる（時間の sleep に頼らない）
        for (const q of ['', 'games/irobin/', '?relay=1&key=1234', 'games/hashi/?relay=1&key=1234', '?debug=1', 'games/irobin/?debug=1', 'games/hashi/']) {
          const n = relayJs.length;
          await page.goto(BASE + q, { waitUntil: 'load' });
          const wantDbg = q.includes('debug=1') || got.some((g) => g.q.includes('debug=1'));
          if (wantDbg) await page.waitForFunction(() => !!window.YubiDebug, null, { timeout: 5000 }).catch(() => {});
          const pg = await page.evaluate(() => ({
            ready: document.readyState,
            api: typeof window.YubiDebugRelay,
            dbg: typeof window.YubiDebug,
            ss: sessionStorage.getItem('yubi.relay'),
            perf: performance.getEntriesByType('resource').filter((e) => e.name.includes('/common/debug-relay.js')).length,
            tag: !!document.querySelector('script[src*="debug-relay.js"]'),
          }));
          got.push({ q, loaded: relayJs.length - n, ...pg, wantDbg });
        }
        check('?debug=1 だけ・何も付けない・debug なしの relay=1（メニューとゲーム）：debug-relay.js を読まず（要求・記録・<script> なし）、YubiDebugRelay も yubi.relay もない', got.every((g) => g.ready === 'complete' && g.loaded === 0 && g.perf === 0 && !g.tag && g.api === 'undefined' && g.ss === null && g.dbg === (g.wantDbg ? 'object' : 'undefined')) && sockets.length === 0, got);
      } finally { await ctx.close(); }
      // 中継で：?relay=0 で消える・「デバッグを終わる」で消えて切れる
      await withRelays(async (start) => {
        const r = await start(root);
        const { ctx: c2, page: p2, relayJs: j2 } = await phone(browser, 'RL5b');
        try {
          await openPhone(r, p2);
          await api(r, '/wait?timeoutMs=10000');
          await p2.goto(r.url('games/irobin/?relay=0')); await sleep(400);
          const n0 = j2.length;
          await p2.goto(r.url('')); await sleep(400);
          const off = { ss: await p2.evaluate(() => sessionStorage.getItem('yubi.relay')), api: await p2.evaluate(() => typeof window.YubiDebugRelay), dbg: await p2.evaluate(() => typeof window.YubiDebug), loaded: j2.length - n0 };
          const st = await until(async () => { const x = await api(r, '/status'); return x.connected === false ? x : null; }, 5000) || await api(r, '/status');
          check('?relay=0：yubi.relay を消し、そのあとメニューへ移っても debug-relay.js を読まない（デバッグ表示は有効のまま）・中継は connected:false', off.ss === null && off.api === 'undefined' && off.dbg === 'object' && off.loaded === 0 && st.connected === false, { off, st });
          await openPhone(r, p2);
          await api(r, '/wait?timeoutMs=10000');
          await p2.evaluate(() => window.YubiDebug.stop()); await sleep(300);
          const st2 = await until(async () => { const x = await api(r, '/status'); return x.connected === false ? x : null; }, 5000) || await api(r, '/status');
          const ss2 = await p2.evaluate(() => sessionStorage.getItem('yubi.relay'));
          await sleep(2500);
          const st3 = await api(r, '/status');
          check('「デバッグを終わる」（YubiDebug.stop）：yubi.relay を消し、接続を閉じ、つなぎ直さない', ss2 === null && st2.connected === false && st3.connected === false, { ss2, st2, st3 });
          // ?debug=0 でも yubi.relay を消す：そのあと ?debug=1 だけで開いても、前の合言葉で勝手につながない
          await openPhone(r, p2);
          await api(r, '/wait?timeoutMs=10000');
          await p2.goto(r.url('games/hashi/?debug=0'), { waitUntil: 'load' });
          const d0 = { ss: await p2.evaluate(() => sessionStorage.getItem('yubi.relay')), dbg: await p2.evaluate(() => typeof window.YubiDebug), api: await p2.evaluate(() => typeof window.YubiDebugRelay) };
          const n1 = j2.length;
          await p2.goto(r.url('?debug=1'), { waitUntil: 'load' });
          await p2.waitForFunction(() => !!window.YubiDebug, null, { timeout: 5000 }).catch(() => {});
          const d1 = { ss: await p2.evaluate(() => sessionStorage.getItem('yubi.relay')), api: await p2.evaluate(() => typeof window.YubiDebugRelay), loaded: j2.length - n1 };
          const st4 = await until(async () => { const x = await api(r, '/status'); return x.connected === false ? x : null; }, 5000) || await api(r, '/status');
          check('?debug=0：yubi.relay も消す（そのあと ?debug=1 だけで開いても debug-relay.js を読まず、中継は connected:false）', d0.ss === null && d0.dbg === 'undefined' && d0.api === 'undefined' && d1.ss === null && d1.api === 'undefined' && d1.loaded === 0 && st4.connected === false, { d0, d1, st4: st4.connected });
        } finally { await c2.close(); }
      });
    },
  },
  {
    id: 'RL6', tier: 'full', title: '中継：ask.mjs（storage の set・remove は --yes が無いと送らない・中継が無いと終了コード 2・名前=値 の読み方・status／logs／wait）',
    async run({ browser, check, root }) {
      const dead = await freePort();
      const a0 = await ask(root, ['status', '--port', String(dead)]);
      check('中継が動いていない：終了コード 2 と「中継が 動いていません」', a0.code === 2 && /中継が 動いていません/.test(a0.out + a0.err), a0);
      await withRelays(async (start) => {
        const r = await start(root);
        const P = ['--port', String(r.port)];
        const a1 = await ask(root, ['info', ...P]);
        check('つながっていない：/run の ok:false をそのまま出し、終了コード 1', a1.code === 1 && a1.json && a1.json.ok === false && a1.json.error === 'iPhone が つながっていません', a1);
        const { ctx, page } = await phone(browser, 'RL6');
        try {
          await openPhone(r, page);
          const aw = await ask(root, ['wait', ...P]);
          check('ask wait：つながるまで待ち、終了コード 0', aw.code === 0 && aw.json && aw.json.connected === true, aw);
          const as = await ask(root, ['status', ...P]);
          check('ask status：整形した JSON（connected:true・key）と終了コード 0', as.code === 0 && as.json && as.json.connected === true && as.json.key === KEY && /\n {2}"/.test(as.out), as.out.slice(0, 300));
          // 引数の読み方は、受け取った args をそのまま返す命令（rlecho）をページに足して確かめる
          await page.evaluate(() => {
            window.__rlSeen = [];
            window.YubiDebug.command('rlecho', (a) => { window.__rlSeen.push(a); return a; });
          });
          const e1 = await ask(root, ['rlecho', 'n=3', 'f=1.5', 'b=true', 'z=null', 's=abc', 'sel=#board .x', 'j={"a":[1,2]}', 'e=', ...P]);
          check('名前=値：JSON として読めれば数・true・null・オブジェクト、だめなら文字列（"#board .x"・空）', e1.code === 0 && e1.json && e1.json.ok === true && JSON.stringify(e1.json.result) === JSON.stringify({ n: 3, f: 1.5, b: true, z: null, s: 'abc', sel: '#board .x', j: { a: [1, 2] }, e: '' }), e1.json || e1);
          const e2 = await ask(root, ['rlecho', '{"x":1,"y":"two"}', ...P]);
          check('引数が 1 つで { で始まるなら JSON の本文として使う', e2.code === 0 && JSON.stringify(e2.json && e2.json.result) === '{"x":1,"y":"two"}', e2.json || e2);
          const e3 = await ask(root, ['rlecho', '#board', ...P]);
          check('名前= の形でない引数 1 つは、そのまま args（"#board"）', e3.code === 0 && e3.json && e3.json.result === '#board', e3.json || e3);
          const lay = await ask(root, ['layout', 'selector=a.game', 'limit=2', ...P]);
          check('ask layout selector=a.game limit=2：ok で終了コード 0', lay.code === 0 && lay.json && lay.json.ok === true && lay.json.result.count > 0, lay.json || lay);
          // storage の書き換えは --yes が無いと送らない
          const before = (await page.evaluate(() => window.__rlSeen.length));
          await page.evaluate(() => { localStorage.setItem('rl.keep', 'のこす'); window.__rlCmds = []; window.YubiDebug.subscribe((ev) => { if (ev.type === 'command') window.__rlCmds.push(ev.name); }); });
          const s1 = await ask(root, ['storage', 'op=set', 'key=rl.test', 'value=1', ...P]);
          const s2 = await ask(root, ['storage', 'op=remove', 'key=rl.keep', ...P]);
          await sleep(300);
          const ls = await page.evaluate(() => ({ t: localStorage.getItem('rl.test'), k: localStorage.getItem('rl.keep'), cmds: window.__rlCmds.slice() }));
          check('storage op=set・op=remove（--yes なし）：終了コード 0 以外で理由を出し、ページへ命令が届かない（保存データは変わらない）', s1.code !== 0 && s2.code !== 0 && /--yes/.test(s1.out + s1.err) && ls.t === null && ls.k === 'のこす' && !ls.cmds.includes('storage'), { s1: [s1.code, (s1.out + s1.err).slice(0, 200)], s2: s2.code, ls });
          const g = await ask(root, ['storage', 'op=get', 'key=rl.keep', ...P]);
          check('storage op=get（読むだけ）は --yes なしで送る', g.code === 0 && g.json && g.json.ok === true && g.json.result.value === 'のこす', g.json || g);
          const s3 = await ask(root, ['storage', 'op=set', 'key=rl.test', 'value=1', '--yes', ...P]);
          const s4 = await ask(root, ['storage', 'op=remove', 'key=rl.keep', '--yes', ...P]);
          const ls2 = await page.evaluate(() => ({ t: localStorage.getItem('rl.test'), k: localStorage.getItem('rl.keep') }));
          check('--yes を付けると set・remove が届く', s3.code === 0 && s4.code === 0 && ls2.t === '1' && ls2.k === null, { s3: s3.json, s4: s4.json, ls2 });
          await page.evaluate(() => { localStorage.removeItem('rl.test'); console.log('RLTEST ask の logs'); });
          const lg = await until(async () => { const x = await ask(root, ['logs', '--since', '0', ...P]); return x.json && JSON.stringify(x.json.entries || []).includes('RLTEST ask') ? x : null; }, 5000);
          check('ask logs --since 0：ページのログが届く', !!lg && lg.code === 0 && lg.json.ok === true, lg && lg.json ? lg.json.last : lg);
          check('（参考）rlecho は 3 回だけ呼ばれた', before === 3, before);
          const ca = as.json.device.connectedAt;
          const aw2 = await ask(root, ['wait', `after=${ca}`, '--timeout', '800', ...P]);
          check('ask wait after=<今の connectedAt>：新しい接続が来なければ時間切れ（終了コード 1）', aw2.code === 1 && aw2.json && aw2.json.ok === false && aw2.json.error === '時間切れ', aw2.json || aw2);
          const u1 = await ask(root, ['info', '--port', 'abc']);
          const u2 = await ask(root, ['info', '--nosuch', ...P]);
          check('使い方の誤り（--port に数でない・知らないオプション）は終了コード 1', u1.code === 1 && u2.code === 1, { u1: [u1.code, u1.err.slice(0, 80)], u2: [u2.code, u2.err.slice(0, 80)] });
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL7', tier: 'full', title: '中継：静的配信（root の外は読めない・/game-no1/ でも開ける・Content-Type・no-store・404）、PC 向けの窓口はループバック以外 403',
    async run({ check, root }) {
      await withRelays(async (start) => {
        // root を games/ にして起動し、1 つ上（リポジトリの sw.js・index.html）が読めないことを確かめる
        const r = await start(root, { relRoot: path.join(root, 'games') });
        const outside = ['/../sw.js', '/%2e%2e/sw.js', '/%2E%2E/sw.js', '/..%2fsw.js', '/%2e%2e%2fsw.js', '/hashi/../../sw.js', '/hashi/%2e%2e/%2e%2e/sw.js', '/game-no1/../sw.js', '/game-no1/%2e%2e/sw.js', '/..%5csw.js', '/hashi/..%5c..%5csw.js', '//etc/passwd', '/%2fetc%2fpasswd'];
        const leaks = [];
        for (const p of outside) { const x = await rawGet(r.port, p); if (x.status === 200 && (x.body.includes('CACHE_VERSION') || x.body.includes('root:'))) leaks.push({ p, status: x.status }); }
        check(`root の外（/../・%2e%2e・%2f・\\・絶対パス、${outside.length} 通り）は読めない`, leaks.length === 0, leaks);
        check('（前提）root の中（/hashi/）は読める', (await rawGet(r.port, '/hashi/')).status === 200);
      });
      await withRelays(async (start) => {
        const r = await start(root);
        const top = await rawGet(r.port, '/');
        const sub = await rawGet(r.port, '/game-no1/');
        const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        check('/ と /game-no1/ はどちらもメニュー（index.html）を返す', top.status === 200 && sub.status === 200 && top.body === idx && sub.body === idx, { top: top.status, sub: sub.status });
        const types = {};
        for (const [p, re] of [['/', /text\/html/], ['/common/debug.js', /javascript/], ['/tests/run.mjs', /javascript/], ['/manifest.webmanifest', /manifest\+json|json/], ['/icons/apple-touch-icon.png', /image\/png/], ['/game-no1/games/hashi/', /text\/html/]]) {
          const x = await rawGet(r.port, p); types[p] = [x.status, x.headers['content-type'], x.headers['cache-control']];
          if (!(x.status === 200 && re.test(x.headers['content-type'] || '') && /no-store/.test(x.headers['cache-control'] || ''))) types[p].push('NG');
        }
        check('拡張子に合った Content-Type（html・js・mjs・webmanifest・png）と Cache-Control: no-store', Object.values(types).every((t) => !t.includes('NG')), types);
        const nf = await rawGet(r.port, '/no-such-file.js');
        check('無いファイルは 404', nf.status === 404, nf.status);
        const hid = {};
        for (const p of ['/.git/HEAD', '/.git/config', '/games/.hidden', '/%2egit/HEAD', '/index.html:stream', '/C:/Windows/win.ini']) hid[p] = (await rawGet(r.port, p)).status;
        check('. で始まる名前（.git など）・: を含む部分は 404', Object.values(hid).every((x) => x === 404), hid);
        const dir = await rawGet(r.port, '/games/hashi?x=1');
        check('フォルダに / が無いと 301 で / 付きへ', dir.status === 301 && /\/games\/hashi\/(\?x=1)?$/.test(dir.headers.location || ''), { status: dir.status, location: dir.headers.location });
        // 先頭の / が 2 つ以上・\ 混じりでも、移す先は「/ 1 つで始まる同じサイトの道」（//games/ だと よそのサイト games へ移ってしまう）
        const redir = {};
        for (const p of ['//games', '///games', '/%5cgames', '//game-no1/games', '/game-no1']) { const x = await rawGet(r.port, p); redir[p] = [x.status, x.headers.location]; }
        check('//games・///games・/\\games などの 301 の Location は / 1 つで始まる（よそのサイトへ移さない）', Object.values(redir).every(([st, loc]) => st === 301 && typeof loc === 'string' && /^\/[^/\\]/.test(loc)), redir);
        const tilde = {};
        for (const p of ['/GIT~1/config', '/games~1/', '/%7egit/HEAD']) tilde[p] = (await rawGet(r.port, p)).status;
        check('~ を含む道（Windows の 8.3 形式の短い名前 GIT~1 など）は 404', Object.values(tilde).every((x) => x === 404), tilde);
        const post = await new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port: r.port, path: '/index.html', method: 'POST' }, (x) => { x.resume(); x.on('end', () => resolve(x.statusCode)); }); q.on('error', () => resolve(0)); q.end('x'); });
        check('ページへの POST は 405', post === 405, post);
        // PC 向けの窓口：ループバック（127.0.0.1）からは使える
        const ok = await rawGet(r.port, '/status');
        check('ループバックからの /status は 200', ok.status === 200, ok.status);
      });
      // ループバックの判定の関数（relay.mjs が export する。import しても中継は起動しない）
      const m = await import(pathToFileURL(path.join(root, 'tests/relay/relay.mjs')).href);
      const H = { host: '127.0.0.1:8790' };
      const cases = [
        ['127.0.0.1', H, true], ['::1', { host: '[::1]:8790' }, true], ['::ffff:127.0.0.1', H, true], ['127.5.6.7', { host: 'localhost:8790' }, true],
        ['192.168.1.5', H, false], ['::ffff:192.168.1.5', H, false], ['10.0.0.2', H, false], ['', H, false], [undefined, H, false],
        ['127.0.0.1', { host: '192.168.1.5:8790' }, false], ['127.0.0.1', { host: 'evil.example:8790' }, false],
        ['127.0.0.1', { ...H, origin: 'http://evil.example' }, false], ['127.0.0.1', { ...H, origin: 'http://127.0.0.1:8790' }, true],
      ];
      const wrong = cases.filter(([a, h, want]) => m.isPcRequest(a, h) !== want);
      const rs = { ok: m.resolveStatic(root, '/games/hashi/'), sub: m.resolveStatic(root, '/game-no1/sw.js'), up: m.resolveStatic(root, '/../sw.js'), enc: m.resolveStatic(root, '/%2e%2e/sw.js'), bs: m.resolveStatic(root, '/..%5csw.js'), dot: m.resolveStatic(root, '/.git/HEAD'), bad: m.resolveStatic(root, '/%E0%A4%A') };
      check('判定の関数 resolveStatic：root の中は場所を返し（/game-no1/ も）、外・.git・壊れたエンコードは null', rs.ok && rs.ok.file === path.join(root, 'games', 'hashi') && rs.sub && rs.sub.file === path.join(root, 'sw.js') && rs.up === null && rs.enc === null && rs.bs === null && rs.dot === null && rs.bad === null, rs);
      check('判定の関数 isPcRequest：接続元・Host・Origin がすべてループバックのときだけ通す（13 通り）', typeof m.isPcRequest === 'function' && wrong.length === 0, wrong);
      // root の中かどうか（realpath のあと）：Windows の形は大文字小文字を区別しない、. で始まる部分があれば隠す
      const ri = {
        winCase: m.relInside('C:\\Users\\a\\game-no1', 'c:\\users\\A\\GAME-NO1\\index.html', 'win32') === 'index.html',
        winOut: m.relInside('C:\\Users\\a\\game-no1', 'C:\\Users\\a\\game-no1x\\index.html', 'win32') === null,
        winDrive: m.relInside('C:\\r', 'D:\\r\\x', 'win32') === null,
        posixOut: m.relInside('/r/game', '/r/game-no1/x', 'posix') === null && m.relInside('/r/game', '/r/game', 'posix') === null,
        posixIn: m.relInside('/r/game', '/r/game/a/b.js', 'posix') === 'a/b.js',
        hidWin: m.hasHiddenPart('games\\.git\\config', 'win32') === true && m.hasHiddenPart('games\\hashi\\index.html', 'win32') === false,
        hidPosix: m.hasHiddenPart('.git/config', 'posix') === true && m.hasHiddenPart('a/b.js', 'posix') === false,
        slash: m.resolveStatic(root, '//games')?.slashURL === '/games/' && m.resolveStatic(root, '/%5cgames')?.slashURL === '/games/' && m.resolveStatic(root, '/game-no1/games')?.slashURL === '/game-no1/games/',
        tilde: m.resolveStatic(root, '/GIT~1/config') === null,
      };
      check('判定の関数 relInside・hasHiddenPart・resolveStatic：Windows の大文字小文字・別のドライブ・名前の前方一致・.git・//・~', Object.values(ri).every(Boolean), ri);
      // シンボリックリンクで root の中の隠しフォルダ（.secret）へ向けても読めない（8.3 形式の GIT~1 と同じ：実際の場所で .  始まりを見る）
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl7-'));
      try {
        fs.mkdirSync(path.join(tmp, '.secret'));
        fs.writeFileSync(path.join(tmp, '.secret', 'key.txt'), 'SECRET');
        fs.writeFileSync(path.join(tmp, 'ok.txt'), 'OK');
        let linked = true;
        try { fs.symlinkSync(path.join(tmp, '.secret'), path.join(tmp, 'vis'), 'dir'); } catch { linked = false; }
        if (!linked) check('（この機械ではシンボリックリンクを作れないので、隠しフォルダへのリンクは確かめられない）', true);
        else await withRelays(async (start) => {
          const r = await start(root, { relRoot: tmp });
          const a = await rawGet(r.port, '/vis/key.txt');
          const b = await rawGet(r.port, '/ok.txt');
          check('リンク vis → .secret を通しても隠しフォルダの中は 404（root の中の ok.txt は 200）', a.status === 404 && !a.body.includes('SECRET') && b.status === 200 && b.body === 'OK', { vis: a.status, ok: b.status });
        });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      // ループバック以外からの要求：この機械の LAN の IPv4 があれば、0.0.0.0 で待つ中継へそのアドレスからつなぐ
      const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal);
      if (!lan) { check('（この機械に LAN の IPv4 が無いので、ループバック以外からの 403 は確かめられない）', true); return; }
      await withRelays(async (start) => {
        const r = await start(root, { host: '0.0.0.0' });
        const res = {};
        for (const p of ['/status', '/logs?since=0', '/wait?timeoutMs=100']) res[p] = (await rawGet(r.port, p, lan.address)).status;
        const post = await new Promise((resolve) => {
          const req = http.request({ host: lan.address, port: r.port, path: '/run', method: 'POST', headers: { 'content-type': 'application/json' } }, (x) => { x.resume(); x.on('end', () => resolve(x.statusCode)); });
          req.on('error', (e) => resolve('err ' + e.message)); req.end('{"command":"info"}');
        });
        res['POST /run'] = post;
        const page = (await rawGet(r.port, '/', lan.address)).status;
        check(`ループバック以外（${lan.address}）からの PC 向けの窓口（/status・/logs・/wait・/run）は 403、ページの配信は 200`, Object.values(res).every((s) => s === 403) && page === 200, { res, page });
      });
    },
  },
  {
    id: 'RL8', tier: 'full', title: '中継：2 台目がつなぐと 1 台目が 4002 で閉じられ、つなぎ直さない（命令は 2 台目へ）',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        const a = await phone(browser, 'RL8 1台目', { w: 390, h: 844 });
        const b = await phone(browser, 'RL8 2台目', { w: 320, h: 568 });
        try {
          await openPhone(r, a.page);
          await api(r, '/wait?timeoutMs=10000');
          check('1 台目がつながる（info の幅 390）', (await run(r, 'info')).result?.window?.innerWidth === 390);
          await openPhone(r, b.page, 'games/irobin/');
          const st = await until(async () => { const x = await api(r, '/status'); return x.connected && x.device && /^\/games\/irobin\//.test(x.device.page) ? x : null; }, 10000) || await api(r, '/status');
          check('2 台目が正しく hello すると、/status の device が 2 台目（/games/irobin/）になる', st.connected === true && /^\/games\/irobin\//.test(st.device.page), st);
          const sa = await until(async () => { const x = await spy(a.page); return x && x.closes.includes(4002) ? x : null; }, 5000) || await spy(a.page);
          await sleep(3500);
          const sa2 = await spy(a.page);
          const s1 = await relayStatus(a.page);
          check('1 台目は閉じるコード 4002 で閉じられ、3.5 秒待ってもつなぎ直さない（status は closed か rejected）', sa && sa.closes.includes(4002) && sa2.opens === 1 && a.sockets.length === 1 && ['closed', 'rejected'].includes(s1), { sa2, s1, sockets: a.sockets });
          const w4002 = await a.page.evaluate(() => JSON.stringify(window.YubiDebug.logs())).catch(() => '');
          check('1 台目のログに、追い出されたことの warn が残る', /中継/.test(w4002) && /"warn"/.test(w4002), w4002.slice(0, 300));
          const info = await run(r, 'info');
          check('命令は 2 台目へ届く（info の幅 320）・2 台目は open のまま', info.ok === true && info.result.window.innerWidth === 320 && (await relayStatus(b.page)) === 'open', info.ok ? info.result.window : info);
        } finally { await a.ctx.close(); await b.ctx.close(); }
      });
    },
  },
  {
    id: 'RL9', tier: 'full', title: '中継（Node だけ）：WebSocket の枠の読み方（握手と同じ包みの hello・分割の枠・途中の ping・バイト単位の分割・長さ 127 形式・1 回に複数の枠）、hello 前の上限、標準入力が閉じたら終わる',
    async run({ check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        const logsOf = async () => (await api(r, '/logs?since=0')).entries || [];
        // 1) 握手と同じ write で hello を送る（upgrade の head に入る。捨てると welcome が来ない）
        const a = await wsClient(r.port, { first: cframe(0x1, helloMsg(KEY, '/rl-head')) });
        const aw = await a.until((c) => c.msgs().some((m) => m.type === 'welcome'), 3000);
        check('握手と同じ包みで届いた hello（upgrade の head）も読み、welcome を返す', a.status === 101 && !!aw, { status: a.status, msgs: a.msgs() });
        // 2) hello を 3 つの分割の枠で送り、途中に ping をはさむ → pong（同じ中身）と welcome
        const b = await wsClient(r.port);
        const hm = Buffer.from(helloMsg(KEY, '/rl-frag'));
        const k1 = Math.floor(hm.length / 3), k2 = Math.floor(hm.length * 2 / 3);
        b.send(cframe(0x1, hm.subarray(0, k1), { fin: false }));
        b.send(cframe(0x0, hm.subarray(k1, k2), { fin: false }));
        b.send(cframe(0x9, 'rl-ping'));
        b.send(cframe(0x0, hm.subarray(k2), { fin: true }));
        const bw = await b.until((c) => c.msgs().some((m) => m.type === 'welcome') && c.frames.some((f) => f.op === 0xa), 3000);
        const pong = b.frames.find((f) => f.op === 0xa);
        check('分割の枠（text＋続き＋続き）でまとめた hello が通り、途中の ping には同じ中身の pong を返す', !!bw && pong && pong.data.toString() === 'rl-ping', { msgs: b.msgs(), ops: b.frames.map((f) => f.op) });
        check('2 本目が正しく hello すると、1 本目は 4002 で閉じられる', !!(await a.until((c) => c.closeCode === 4002, 3000)), a.closeCode);
        const st1 = await api(r, '/status');
        check('/status の device は 2 本目（/rl-frag・11×22）', st1.connected && st1.device.page === '/rl-frag' && st1.device.screen.w === 11 && st1.device.screen.h === 22, st1.device);
        // 3) 1 回の write に 2 つの枠（ログ 2 件）
        b.send(Buffer.concat([cframe(0x1, JSON.stringify({ type: 'log', entry: { level: 'log', text: 'RL9 いっしょ1' } })), cframe(0x1, JSON.stringify({ type: 'log', entry: { level: 'log', text: 'RL9 いっしょ2' } }))]));
        const both = await until(async () => { const e = await logsOf(); return e.some((x) => x.entry?.text === 'RL9 いっしょ1') && e.some((x) => x.entry?.text === 'RL9 いっしょ2'); }, 3000);
        check('1 回に届いた 2 つの枠を両方読む（ログ 2 件）', !!both);
        // 4) 長さ 127 形式（64KB を超える）の枠：hello のあとは受け取り、ログ 1 件は 32KB までに切り詰める
        const big = JSON.stringify({ type: 'log', entry: { level: 'warn', text: 'RL9 大きい ' + 'x'.repeat(70000) } });
        b.send(cframe(0x1, big));
        const bigE = await until(async () => (await logsOf()).find((x) => x.entry && x.entry.truncated && String(x.entry.text).includes('RL9 大きい')), 3000);
        check('長さ 127 形式の枠（約 70KB）を読み、ログ 1 件は 32KB 以下に切り詰める（truncated・level は残る）', !!bigE && Buffer.byteLength(JSON.stringify(bigE.entry)) <= 32 * 1024 && bigE.entry.level === 'warn' && b.closeCode === null, bigE ? { bytes: Buffer.byteLength(JSON.stringify(bigE.entry)) } : await logsOf().then((e) => e.length));
        // 5) バイト単位の分割：result の枠を 1 バイトずつ送る（/run の答えになる）
        const runP = run(r, 'rlnode', { n: 1 }, 5000);
        const got = await b.until((c) => c.msgs().find((m) => m.type === 'run'), 3000);
        if (got) {
          const fr = cframe(0x1, JSON.stringify({ type: 'result', id: got.id, ok: true, result: { echo: got.args }, command: got.command, ms: 1 }));
          for (let i = 0; i < fr.length; i++) { b.send(fr.subarray(i, i + 1)); if (i % 8 === 0) await new Promise((res) => setImmediate(res)); }
        }
        const rr = await runP;
        check('命令 { type:"run" } が偽の端末へ届き、1 バイトずつ送った result が /run の答えになる', !!got && got.command === 'rlnode' && rr.ok === true && rr.result && rr.result.echo && rr.result.echo.n === 1 && !('id' in rr), { got, rr });
        b.end();
        // 6) hello の前は 1 枠 64KB まで（超えたら 1009 で閉じる）
        const c = await wsClient(r.port);
        c.send(cframe(0x1, JSON.stringify({ type: 'hello', key: KEY, pad: 'y'.repeat(70000) })));
        const cc = await c.until((x) => x.closeCode !== null || x.ended, 3000);
        check('hello の前に 64KB を超える枠を送ると 1009 で閉じる（welcome は来ない）', !!cc && c.closeCode === 1009 && !c.msgs().some((m) => m.type === 'welcome'), { code: c.closeCode, ended: c.ended });
        c.end();
      });
      // 7) --exit-on-stdin-close：標準入力が閉じたら中継は終わる（テストの親が落ちても残らない）
      const r2 = await startRelay(root);
      try {
        const exited = new Promise((res) => r2.child.once('exit', () => res(true)));
        r2.child.stdin.end();
        const ok = await Promise.race([exited, sleep(5000).then(() => false)]);
        check('--exit-on-stdin-close：標準入力が閉じたら 5 秒以内に終わる', ok === true, r2.out.slice(-200));
      } finally { await r2.stop(); }
    },
  },
  {
    id: 'RL10', tier: 'full', title: '中継：なりすまし対策（Origin が同じページだけ・Origin 無しを断る・Host は IP か localhost だけ・合言葉 5 回間違いで締め切る・既定の合言葉は 8 文字・hello 前の接続は 8 本まで）',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root, { key: null });
        check('既定の合言葉は 8 文字（紛らわしい 0 o 1 l i を除いた英小文字と数字）', /^[a-hjkmnp-z2-9]{8}$/.test(r.key || ''), r.out.split('\n')[0]);
        const P = r.port;
        const res = {};
        for (const [name, o] of [
          ['別の Origin（http://evil.example）', { origin: 'http://evil.example' }],
          ['Origin 無し', { noOrigin: true }],
          ['Origin の port ちがい', { origin: `http://127.0.0.1:${P + 1}` }],
          ['https の Origin（http の中継）', { origin: `https://127.0.0.1:${P}` }],
          ['名前の Host（evil.example・Origin も合わせる）', { host: `evil.example:${P}` }],
          ['名前の Host（127.0.0.1.nip.io）', { host: `127.0.0.1.nip.io:${P}` }],
        ]) { const c = await wsClient(P, o); res[name] = c.status; c.end(); }
        check('なりすまし：別の Origin・Origin 無し・port ちがい・名前の Host は 403（握手しない）', Object.values(res).every((x) => x === 403), res);
        const okc = {};
        for (const [name, o] of [['127.0.0.1', {}], ['localhost', { host: `localhost:${P}` }]]) { const c = await wsClient(P, o); okc[name] = c.status; c.end(); }
        check('（前提）Host が IP・localhost で、Origin がそのページ自身なら 101', okc['127.0.0.1'] === 101 && okc.localhost === 101, okc);
        check('PC の画面に「よそからの接続を断りました」が出る', /よそからの接続を断りました/.test(r.out), r.out.slice(-300));
        // hello の前の接続は 8 本まで
        await sleep(200);
        const hold = [];
        for (let i = 0; i < 8; i++) hold.push(await wsClient(P));
        const ninth = await wsClient(P);
        check('hello の前の接続は 8 本まで（9 本目は 503）', hold.every((c) => c.status === 101) && ninth.status === 503, { hold: hold.map((c) => c.status), ninth: ninth.status });
        ninth.end(); for (const c of hold) c.end();
        await until(async () => { const c = await wsClient(P); const ok = c.status === 101; c.end(); return ok; }, 3000);
        // 合言葉の間違いは 5 回で締め切り：そのあとは正しい合言葉でも 4001
        const codes = [];
        for (let i = 0; i < 5; i++) {
          const c = await wsClient(P);
          c.text(helloMsg('wrong' + i));
          await c.until((x) => x.closeCode !== null || x.ended, 3000);
          codes.push(c.closeCode); c.end();
        }
        const st = await api(r, '/status');
        check('合言葉ちがい 5 回はそれぞれ 4001、/status に badKeys:5・locked:true', codes.every((x) => x === 4001) && st.badKeys === 5 && st.locked === true, { codes, badKeys: st.badKeys, locked: st.locked });
        const good = await wsClient(P);
        good.text(helloMsg(r.key));
        await good.until((x) => x.closeCode !== null || x.ended, 3000);
        check('締め切ったあとは、正しい合言葉の hello も 4001 で断る（welcome なし・connected:false）', good.closeCode === 4001 && !good.msgs().some((m) => m.type === 'welcome') && (await api(r, '/status')).connected === false, { code: good.closeCode, msgs: good.msgs() });
        good.end();
        const { ctx, page } = await phone(browser, 'RL10');
        try {
          await openPhone(r, page);
          const s = await until(async () => ((await relayStatus(page)) === 'rejected' ? 'rejected' : null), 6000) || await relayStatus(page);
          check('ブラウザ（正しい合言葉）も締め切り中は rejected', s === 'rejected', s);
        } finally { await ctx.close(); }
        check('PC の画面に、締め切ったことと起動し直す案内が出る', /5 回になったので/.test(r.out) && /起動し直して/.test(r.out), r.out.slice(-400));
      });
      // 判定の関数（ブラウザ以外からも確かめる）
      const m = await import(pathToFileURL(path.join(root, 'tests/relay/relay.mjs')).href);
      const cases = [
        [{ host: '192.168.1.5:8790', origin: 'http://192.168.1.5:8790' }, true], [{ host: '[::1]:8790', origin: 'http://[::1]:8790' }, true], [{ host: 'localhost:8790', origin: 'http://localhost:8790' }, true],
        [{ host: '192.168.1.5:8790' }, false], [{ host: '192.168.1.5:8790', origin: 'null' }, false], [{ host: 'evil.example:8790', origin: 'http://evil.example:8790' }, false],
        [{ host: '999.1.1.1:8790', origin: 'http://999.1.1.1:8790' }, false], [{ host: '192.168.1.5:8790', origin: 'http://192.168.1.5:8790.evil' }, false], [{ host: '192.168.1.5:8790', origin: 'https://192.168.1.5:8790' }, false],
        [{ host: '1.2.3.4.nip.io', origin: 'http://1.2.3.4.nip.io' }, false], [{ origin: 'http://127.0.0.1' }, false],
      ];
      const wrong = cases.filter(([h, want]) => m.isAllowedUpgrade(h) !== want);
      check(`判定の関数 isAllowedUpgrade（${cases.length} 通り）`, typeof m.isAllowedUpgrade === 'function' && wrong.length === 0, wrong);
    },
  },
  {
    id: 'RL11', tier: 'full', title: '中継：open・reload で移るとき、sessionStorage の印が消えていても（iPhone で起きたことのまね）、移った先でデバッグが有効（🐞）になり中継につなぎ直す（T-11）',
    async run({ browser, check, root }) {
      await withRelays(async (start) => {
        const r = await start(root);
        const { ctx, page } = await phone(browser, 'RL11');
        const dbg = () => page.evaluate(() => ({ core: !!window.YubiDebug, bug: !!document.getElementById('yubi-debug'), relay: window.YubiDebugRelay ? window.YubiDebugRelay.status() : 'none' })).catch((e) => ({ err: e.message }));
        try {
          await openPhone(r, page);
          await api(r, '/wait?timeoutMs=10000');
          // iPhone の Safari では、命令で移った先で sessionStorage の印が読めなかった。印を消して同じ状況を作る
          await page.evaluate(() => sessionStorage.clear());
          const before = (await api(r, '/status')).device.connectedAt;
          const o = await run(r, 'open', { path: '/games/hashi/?x=1&debug=0&key=zzz#top' });
          const sp = o.ok && new URL(o.result.href).searchParams;
          check('open の答えの href：debug=1・relay=1・key=今の合言葉 に置き換え、ほかの ?（x=1）と #top は残す', o.ok === true && sp.get('debug') === '1' && sp.get('relay') === '1' && sp.get('key') === KEY && sp.get('x') === '1' && new URL(o.result.href).hash === '#top' && new URL(o.result.href).pathname === '/games/hashi/', o);
          const w = await api(r, `/wait?timeoutMs=15000&after=${encodeURIComponent(before)}`);
          const st = await until(async () => { const x = await dbg(); return x.relay === 'open' ? x : null; }, 10000) || await dbg();
          check('印が消えていても、open で移った先でつなぎ直し（/wait?after= が新しい接続、page が /games/hashi/）、デバッグが有効（YubiDebug・🐞 のボタン）', w.ok === true && w.device && /^\/games\/hashi\//.test(w.device.page) && st.core === true && st.bug === true && st.relay === 'open', { w, st, url: page.url() });
          const info = await run(r, 'info');
          check('移った先で命令（info）が通る', info.ok === true, info.ok);
          // 指で移ったページ（URL に debug・relay・key が無い）で印が消えた状態から reload
          await page.evaluate(() => { history.replaceState(null, '', '/games/hashi/'); sessionStorage.clear(); window.__rlMark = 'よみなおす前'; });
          const before2 = (await api(r, '/status')).device.connectedAt;
          const rl = await run(r, 'reload');
          const w2 = await api(r, `/wait?timeoutMs=15000&after=${encodeURIComponent(before2)}`);
          const st2 = await until(async () => { const x = await dbg(); return x.relay === 'open' ? x : null; }, 10000) || await dbg();
          const sp2 = new URL(page.url()).searchParams;
          check('reload：URL に debug=1・relay=1・key を付けて読み直し（印が消えていても）、つなぎ直してデバッグが有効', rl.ok === true && w2.ok === true && w2.device && w2.device.connectedAt !== before2 && st2.core === true && st2.bug === true && st2.relay === 'open' && sp2.get('debug') === '1' && sp2.get('relay') === '1' && sp2.get('key') === KEY && (await page.evaluate(() => window.__rlMark)) === undefined, { rl, w2, st2, url: page.url() });
        } finally { await ctx.close(); }
      });
    },
  },
  {
    id: 'RL12', tier: 'full', node: true, title: '中継（Node だけ）：iPhone で開く URL の並び（ふつうの LAN が先・仮想のネットワーク（名前・アドレスの範囲・MAC の先頭で見る）は後ろで印つき・先頭に「おすすめ」）（T-12）',
    async run({ check, root }) {
      const m = await import(pathToFileURL(path.join(root, 'tests/relay/relay.mjs')).href);
      check('orderLanAddresses・isVirtualLan・lanUrlLines を export している', typeof m.orderLanAddresses === 'function' && typeof m.isVirtualLan === 'function' && typeof m.lanUrlLines === 'function');
      const v4 = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
      // 2026-10-22 段4 の自宅 PC と同じ並び（VirtualBox → Wi-Fi → Hyper-V の Default Switch → WSL）
      const home = {
        'イーサネット 3': [v4('192.168.56.1'), { address: 'fe80::1', family: 'IPv6', internal: false }],
        'Wi-Fi': [v4('192.168.1.13')],
        'vEthernet (Default Switch)': [v4('172.26.64.1')],
        'vEthernet (WSL (Hyper-V firewall))': [v4('172.26.96.1')],
        'Loopback Pseudo-Interface 1': [v4('127.0.0.1', { internal: true })],
      };
      const a = m.orderLanAddresses(home);
      check('自宅 PC の 4 つ：192.168.1.13（Wi-Fi）が先頭でふつう、残り 3 つは仮想・元の順', JSON.stringify(a.map((x) => [x.address, x.virtual])) === JSON.stringify([['192.168.1.13', false], ['192.168.56.1', true], ['172.26.64.1', true], ['172.26.96.1', true]]), a);
      const b = m.orderLanAddresses({
        'VirtualBox Host-Only Network': [v4('192.168.99.1')], 'docker0': [v4('10.200.0.1')], 'eth1': [v4('169.254.3.4')],
        'en5': [v4('10.0.0.8')], 'en0': [v4('192.168.0.20')], 'en7': [v4('100.64.1.2', { family: 4 })], 'lo': [v4('127.0.0.1', { internal: true })],
      });
      check('名前で仮想（VirtualBox・docker）、169.254 は仮想、192.168. → 10. → そのほか、数字の family（4）も読む、内部は除く', JSON.stringify(b.map((x) => x.address)) === JSON.stringify(['192.168.0.20', '10.0.0.8', '100.64.1.2', '192.168.99.1', '10.200.0.1', '169.254.3.4']) && b.slice(3).every((x) => x.virtual) && b.slice(0, 3).every((x) => !x.virtual), b);
      // 名前でもアドレスでも分からない仮想（VirtualBox のホストオンリーを 192.168.57.1 に変えた「イーサネット 3」）は MAC の先頭で見る
      const c = m.orderLanAddresses({
        'イーサネット 3': [v4('192.168.57.1', { mac: '0a:00:27:00:00:05' })],
        'Wi-Fi': [v4('192.168.1.13', { mac: 'a4:5e:60:11:22:33' })],
      });
      const lc = m.lanUrlLines(c, 8790, 'k');
      check('MAC の先頭で仮想（イーサネット 3・192.168.57.1・0a:00:27）→ 後ろで印つき、Wi-Fi 192.168.1.13 が先頭の「おすすめ」', JSON.stringify(c.map((x) => [x.address, x.virtual])) === JSON.stringify([['192.168.1.13', false], ['192.168.57.1', true]]) && /192\.168\.1\.13.*おすすめ/.test(lc[1]) && /192\.168\.57\.1.*仮想のネットワーク/.test(lc[2]), { c, lc });
      check('MAC の判定：VirtualBox・VMware・Hyper-V の先頭（大文字・- 区切りも）は仮想、ふつうの MAC・空・mac なしはふつう', typeof m.isVirtualMac === 'function'
        && ['08:00:27:aa:bb:cc', '0A-00-27-00-00-05', '00:50:56:C0:00:08', '00-0C-29-12-34-56', '00:05:69:00:00:01', '00:15:5D:01:02:03'].every((x) => m.isVirtualMac(x) && m.isVirtualLan('イーサネット', '192.168.1.5', x))
        && !m.isVirtualMac('a4:5e:60:11:22:33') && !m.isVirtualMac('00:00:00:00:00:00') && !m.isVirtualMac('') && !m.isVirtualMac(undefined) && !m.isVirtualLan('Wi-Fi', '192.168.1.13') && !m.isVirtualLan('Wi-Fi', '192.168.1.13', 'a4:5e:60:11:22:33'));
      check('空・壊れた入力でも落ちない', m.orderLanAddresses({}).length === 0 && m.orderLanAddresses(null).length === 0 && m.orderLanAddresses({ x: [null, { family: 'IPv4' }] }).length === 0);
      const lines = m.lanUrlLines(a, 8790, 'k2345678');
      check('起動の表示：先頭が 192.168.1.13 で「おすすめ」、仮想の 3 つに「仮想のネットワーク」の印、URL は ?debug=1&relay=1&key=', /http:\/\/192\.168\.1\.13:8790\/\?debug=1&relay=1&key=k2345678.*おすすめ/.test(lines[1]) && lines.slice(2, 5).every((l) => /仮想のネットワーク/.test(l)) && !/仮想/.test(lines[1]), lines);
      const one = m.lanUrlLines([{ address: '192.168.1.13', virtual: false }], 8790, 'k');
      check('1 つだけのときは「おすすめ」も複数の注意も出さない、0 のときは見つからない案内', one.length === 2 && !/おすすめ/.test(one[1]) && /見つかりません/.test(m.lanUrlLines([], 8790, 'k').join('')), one);
    },
  },
];
