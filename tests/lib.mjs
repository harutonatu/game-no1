// 共通部品：サーバー起動・端末定義・safe-area の再現・合否の記録
// ここ以外にサーバー／端末／safe-area の定義を書かない（重複の統合）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------- Playwright ----------
// まず通常の import('playwright') を試し、なければグローバル（npm root -g）の playwright/index.mjs を使う。
// package.json・node_modules はリポジトリに置かない。
// Service Worker 自身の通信（フォント等）も context.route で差し替えられるようにする（外部ネットワークに依存しない）
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* 下へ */ }
  const root = process.env.NPM_ROOT || execSync('npm root -g').toString().trim();
  return import(pathToFileURL(path.join(root, 'playwright/index.mjs')).href);
}
const pw = await loadPlaywright();
export const { devices } = pw;
// BROWSER=chromium|webkit（既定 chromium）
export const BROWSER = process.env.BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(BROWSER)) throw new Error('BROWSER は chromium か webkit: ' + BROWSER);
export const browserType = pw[BROWSER];
export const IS_CHROMIUM = BROWSER === 'chromium';
export const launchBrowser = () => browserType.launch(IS_CHROMIUM ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});

export const PORT = Number(process.env.PORT || 8800);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const BASE = `${ORIGIN}/game-no1/`;       // GitHub Pages と同じサブパス
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 待ち時間の早送り（page.clock） ----------
// newPage(..., { clock: true }) のページでは、ページ内のタイマー（setTimeout・requestAnimationFrame・Date・performance.now）を
// Playwright の page.clock に置き換え、wait(page, ms) で ms だけ一気に進める（実時間はほぼかからない）。
// 実時間で確かめる必要があるもの（0.8 秒の境界・Service Worker の 3 秒待ち・音の鳴る時間）は clock を使わない。
// CLOCK=0 で早送りを止め、すべて実時間で待つ（早送りで合否が変わっていないかの確認用）。
export const CLOCK = process.env.CLOCK !== '0';
const clocked = new WeakSet();
export const isClocked = (page) => clocked.has(page);
// 早送り中のページで、ページ内の時間を止めたまま fn を行う（素早い連続タップを、負荷で遅れても「素早い」ままにする）
export async function frozen(page, fn) {
  if (!clocked.has(page)) return fn();
  // 早送りでページの時刻は実時間より進んでいるので、ページの今の時刻の少し先で止める（負荷で間に合わなければ先へずらしてやり直す）
  for (let ahead = 50; ; ahead *= 4) {
    try { await page.clock.pauseAt((await page.evaluate(() => Date.now())) + ahead); break; } catch (e) { if (ahead > 3000 || !/past/.test(e.message)) throw e; }
  }
  try { return await fn(); } finally { await page.clock.resume(); }
}
export async function wait(page, ms) {
  if (!clocked.has(page)) return sleep(ms);
  await page.clock.runFor(ms);
  await sleep(Math.min(ms, 15));     // 描画・イベントの後始末に少しだけ実時間を渡す
}

// ---------- 配信サーバー（GitHub Pages 風） ----------
// ・/game-no1/ 配下だけを配信。末尾スラッシュなしのディレクトリは 301。Cache-Control: max-age=600
// ・/__ctl?delay=ms&offline=1&hang=1&swver=xxx&rel=xxx&log=1 で、遅い回線・接続断（オフライン）・無応答・
//   「旧版の sw.js」（CACHE_VERSION だけ書き換えたもの）・「中身の変わった新しい版」（rel：sw.js 以外の .html と .js の
//   末尾に印を足す。HTML は <!--rel:xxx-->、JS は self.__rel="xxx"）を再現する
// 旧版を版数の決め打ちで用意しないため、swver を指定すると配信中の sw.js の CACHE_VERSION をその値に差し替える。
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
export function startServer(root, opts = {}) {
  root = path.resolve(root);
  const st = { delay: 0, offline: false, hang: false, swver: null, rel: null, log: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__ctl') {
      const q = u.searchParams;
      if (q.has('delay')) st.delay = Number(q.get('delay'));
      if (q.has('offline')) st.offline = q.get('offline') === '1';
      if (q.has('hang')) st.hang = q.get('hang') === '1';
      if (q.has('swver')) st.swver = q.get('swver') || null;
      if (q.has('rel')) st.rel = q.get('rel') || null;
      if (q.has('log')) { res.end(JSON.stringify(st.log.splice(0))); return; }
      res.end('ok'); return;
    }
    if (st.offline) { req.socket.destroy(); return; }       // 接続を切る＝ブラウザからはオフラインに見える（SW 自身の fetch にも効く）
    st.log.push(opts.logStrings ? `${u.pathname}${u.search} cc=${req.headers['cache-control'] || ''}` : { path: u.pathname, search: u.search, cc: req.headers['cache-control'] || '' });
    if (st.hang) return;
    const send = () => {
      if (!u.pathname.startsWith('/game-no1/')) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>404</title>'); return; }
      let f = path.join(root, decodeURIComponent(u.pathname.slice('/game-no1/'.length)));
      if (!f.startsWith(path.resolve(root))) { res.writeHead(400); res.end(); return; }
      try {
        if (fs.statSync(f).isDirectory()) {
          if (!u.pathname.endsWith('/')) { res.writeHead(301, { location: u.pathname + '/' + u.search }); res.end(); return; }
          f = path.join(f, 'index.html');
        }
      } catch { /* なければ下で 404 */ }
      if (!fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>404</title>Not Found'); return; }
      let body = fs.readFileSync(f);
      if (st.swver && path.basename(f) === 'sw.js' && u.pathname === '/game-no1/sw.js') {
        body = Buffer.from(body.toString().replace(/CACHE_VERSION\s*=\s*["'][^"']*["']/, `CACHE_VERSION = "${st.swver}"`));
      }
      if (st.rel && path.extname(f) === '.html') body = Buffer.concat([body, Buffer.from(`\n<!--rel:${st.rel}-->\n`)]);
      if (st.rel && path.extname(f) === '.js' && path.basename(f) !== 'sw.js') body = Buffer.concat([body, Buffer.from(`\n;self.__rel = ${JSON.stringify(st.rel)};\n`)]);
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600', 'x-served-at': String(Date.now()) });
      res.end(body);
    };
    if (st.delay) setTimeout(send, st.delay); else send();
  });
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve({
      state: st,
      ctl: (q) => fetch(`${ORIGIN}/__ctl?${q}`).then((r) => r.text()),
      reset: () => { Object.assign(st, { delay: 0, offline: false, hang: false, swver: null, rel: null }); st.log.length = 0; },
      close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
    }));
  });
}

// ---------- 端末定義（1か所） ----------
// safe = [top, right, bottom, left]（ホーム画面から起動したときの env(safe-area-inset-*)）
// 「Safari」はツールバーの分だけ高さが小さく、env() は 0（置換しない）。
export const DEVICES = {
  SE:   { name: 'iPhone SE(第1世代) 320×568', p: { app: [320, 568, [20, 0, 0, 0]],  safari: [320, 454] }, l: { app: [568, 320, [0, 0, 0, 0]],    safari: [568, 270] } },
  i13:  { name: 'iPhone 13 390×844',          p: { app: [390, 844, [47, 0, 34, 0]],  safari: [390, 664] }, l: { app: [844, 390, [0, 47, 21, 47]],  safari: [844, 340] } },
  PM:   { name: 'iPhone 15 Pro Max 430×932',  p: { app: [430, 932, [59, 0, 34, 0]],  safari: [430, 739] }, l: { app: [932, 430, [0, 59, 21, 59]],  safari: [932, 380] } },
  iPad: { name: 'iPad 810×1080',              p: { app: [810, 1080, [24, 0, 20, 0]], safari: [810, 1010] }, l: { app: [1080, 810, [24, 0, 20, 0]], safari: [1080, 740] } },
};
// view = { w, h, safe, label }
export function view(dev, orient, launch) {
  const d = DEVICES[dev][orient];
  if (launch === 'app') { const [w, h, safe] = d.app; return { w, h, safe, label: `${dev}${orient === 'p' ? '縦' : '横'}・ホーム画面` }; }
  const [w, h] = d.safari; return { w, h, safe: null, label: `${dev}${orient === 'p' ? '縦' : '横'}・Safari` };
}
export const custom = (w, h, safe = null, label = `${w}×${h}`) => ({ w, h, safe, label });

// ---------- safe-area の再現（fix1/lib.mjs と同じ方式：HTML 内の env(safe-area-inset-*) を px に置き換える） ----------
export const subSafe = (body, [t, r, b, l]) => body
  .replace(/env\(safe-area-inset-top[^)]*\)/g, t + 'px').replace(/env\(safe-area-inset-right[^)]*\)/g, r + 'px')
  .replace(/env\(safe-area-inset-bottom[^)]*\)/g, b + 'px').replace(/env\(safe-area-inset-left[^)]*\)/g, l + 'px');

// ---------- コンテキスト ----------
// 全ページのコンソールエラー・ページエラーを1か所に集める（「コンソールエラー0」の確認は最後に1回だけ）
export const pageErrors = [];
export function watch(page, label, { allowNetErrors = false } = {}) {
  // allowNetErrors：わざと存在しないファイルやオフラインのエラー応答を取りに行くテスト用（WebKit は文言が違う）
  const netErr = /^Failed to load resource|^Response served by service worker is an error/;   // 2つ目は WebKit の文言（pageerror で来る）
  page.on('console', (m) => { if (m.type() === 'error' && !(allowNetErrors && netErr.test(m.text()))) pageErrors.push(`${label}: [console] ${m.text()}`); });
  page.on('pageerror', (e) => { if (!(allowNetErrors && netErr.test(e.message))) pageErrors.push(`${label}: [pageerror] ${e.message}`); });
}
// opts: { sw: true で Service Worker を有効、reducedMotion, initScript, touch:false でデスクトップ相当、
//         clock: true で待ち時間を早送り（wait(page, ms) を使う）、device: Playwright の端末名（例 'iPhone 13'） }
export async function newPage(browser, v, label, opts = {}) {
  const ctx = await browser.newContext({
    ...(opts.device ? devices[opts.device] : {}),
    viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2,
    isMobile: opts.touch !== false, hasTouch: opts.touch !== false,
    serviceWorkers: opts.sw ? 'allow' : 'block',
    reducedMotion: opts.reducedMotion || 'no-preference',
  });
  // Google Fonts は外部。テストでは空の応答にして、ネットワークに左右されないようにする
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: /gstatic/.test(r.request().url()) ? 'font/woff2' : 'text/css', body: '', headers: { 'access-control-allow-origin': '*' } }));
  if (v.safe) {
    const safe = v.safe;
    await ctx.route(/\/game-no1\/(.*\.html|(.*\/)?)(\?.*)?$/, async (route) => {
      const r = await route.fetch();
      if (!(r.headers()['content-type'] || '').includes('html')) return route.fulfill({ response: r });
      route.fulfill({ response: r, body: subSafe(await r.text(), safe), headers: { ...r.headers(), 'content-type': 'text/html; charset=utf-8' } });
    });
  }
  if (opts.initScript) await ctx.addInitScript(opts.initScript);
  const page = await ctx.newPage();
  if (opts.clock && CLOCK) { await page.clock.install(); clocked.add(page); }
  watch(page, label, { allowNetErrors: !!opts.allowNetErrors });
  return { ctx, page };
}

// ---------- 状態の注入（どのページからでも同じオリジンの localStorage に書く） ----------
export async function seed(page, items, { clear = true } = {}) {
  // ゲームの画面は離れるとき（pagehide）に自分の状態・ベストを保存するので、必ず中立のページへ移ってから書き込む
  if (page.url() !== BASE + 'manifest.webmanifest') await page.goto(BASE + 'manifest.webmanifest');
  await page.evaluate(([items, clear]) => {
    if (clear) localStorage.clear();
    for (const [k, v] of Object.entries(items)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  }, [items, clear]);
}
export const ST = (grid, o = {}) => ({ v: 1, grid, score: 1000, prev: null, keepPlaying: false, moves: 30, seed: 12345, ...o });
export const T48 = BASE + 'games/2048/';
export const BLK = BASE + 'games/blocks/';
export async function open2048(page, state, extra = {}) {
  await seed(page, { ...(state === undefined ? {} : { 'tile2048.state': state }), ...extra });
  await page.goto(T48); await wait(page, 200);
}
export const cardText = (p) => p.evaluate(() => document.querySelector('#overlay').hidden ? '' : document.querySelector('#card').textContent.replace(/\s+/g, ' '));
export const overlayShown = (p) => p.evaluate(() => !document.querySelector('#overlay').hidden);
export const stateOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tile2048.state')));
// ブロックパズルを開始してハードドロップを n 回
export async function blocksPlay(page, n = 4) {
  await page.goto(BLK); await wait(page, 200);
  await page.click('#card [data-cmd=restart]'); await wait(page, 120);
  for (let i = 0; i < n; i++) { await page.keyboard.press('Space'); await wait(page, 40); }
  return page.evaluate(() => Number(document.querySelector('#score').textContent.replace(/,/g, '')));
}
// ---------- キリトリ道場 ----------
// ゲームの様子は window.KiritoriGame.snapshot()（読むだけ）で調べ、切るのは本物のマウス操作（pointer イベント）で行う
export const KIRI = BASE + 'games/kiritori/';
export const kiriSnap = (p) => p.evaluate(() => window.KiritoriGame.snapshot());
export async function kiriStart(page) {
  if (!page.url().startsWith(KIRI)) { await page.goto(KIRI); await wait(page, 150); }
  await page.click('#card [data-cmd=restart]'); await wait(page, 60);
}
// 道場の中に全体が見えている的（爆弾を除く。bomb: true なら爆弾）を待つ。見つからなければ null
export async function kiriWaitObj(page, { bomb = false, maxMs = 8000, step = 100, min = 1 } = {}) {
  for (let t = 0; t <= maxMs; t += step) {
    const s = await kiriSnap(page);
    if (s.state !== 'play') return null;
    const vis = s.objs.filter((o) => (o.kind === 'bomb') === bomb && o.y - o.r > s.stage.y + 2 && o.y + o.r < s.stage.y + s.stage.h - 2 && o.x - o.r > s.stage.x && o.x + o.r < s.stage.x + s.stage.w);
    if (vis.length >= min) return { s, objs: vis, o: vis[0] };
    await wait(page, step);
  }
  return null;
}
// 点の列をマウスでなぞる（1回のスワイプ）。早送り中のページでは時間を止めたまま（的が動かない）。
// pts は点の列か、止めた時点の snapshot から点の列を作る関数（関数が null を返したらなぞらない）
export async function kiriSwipe(page, pts, steps = 5) {
  return frozen(page, async () => {
    const list = typeof pts === 'function' ? pts(await kiriSnap(page)) : pts;
    if (!list) return false;
    await page.mouse.move(list[0][0], list[0][1]);
    await page.mouse.down();
    for (let i = 1; i < list.length; i++) await page.mouse.move(list[i][0], list[i][1], { steps });
    await page.mouse.up();
    return true;
  });
}
const nearest = (s, o) => s.objs.filter((x) => x.kind === o.kind).sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y))[0];
// 1つの的（kiriWaitObj で見つけたもの）を横に切る
export const kiriSlash = (page, o) => kiriSwipe(page, (s) => { const n = nearest(s, o); return n && [[n.x - n.r - 16, n.y + 2], [n.x + n.r + 16, n.y - 2]]; });
// 爆弾をよけて的を切り続け、cond(snapshot) が真になるまで遊ぶ（最大 maxMs のゲーム内時間）。
// lazy: true なら落ち始めた的だけ切る（上がっている的は残す＝同時に飛ぶ的が増える）
export async function kiriAutoplay(page, cond, { maxMs = 60000, step = 150, lazy = false } = {}) {
  const pick = (s) => {
    const bombs = s.objs.filter((o) => o.kind === 'bomb');
    const safe = (o) => bombs.every((b) => Math.abs(b.y - o.y) > b.r + 10 || b.x + b.r < o.x - o.r - 12 || b.x - b.r > o.x + o.r + 12);
    const tgt = s.objs.find((o) => o.kind !== 'bomb' && o.y - o.r > s.stage.y + 2 && o.y < s.stage.y + s.stage.h && safe(o) && (!lazy || o.vy > 0));
    return tgt && [[tgt.x - tgt.r - 6, tgt.y], [tgt.x + tgt.r + 6, tgt.y]];
  };
  for (let t = 0; t <= maxMs; t += step) {
    const s = await kiriSnap(page);
    if (cond(s) || s.state !== 'play') return s;
    // 切る的があるときだけ、時間を止めてなぞる（止めた時点の位置で選び直す）
    if (pick(s)) await kiriSwipe(page, pick, 3);
    await wait(page, step);
  }
  return kiriSnap(page);
}

// ブロックパズルの乱数を固定する（ブロックの出順を毎回同じにする）
export const fixedRandom = () => { let a = 42; Math.random = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; };

// ---------- sw.js から読む値（版数は決め打ちしない） ----------
export function swInfo(root) {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const ver = (sw.match(/CACHE_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  const prefix = (sw.match(/APP_PREFIX\s*=\s*["']([^"']+)["']/) || [, 'yubiasobi-app-'])[1];
  const files = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return { ver, prefix, app: prefix + ver, files, n: files.length };
}

// ---------- タッチ操作（CDP。Chromium だけ） ----------
// Playwright の touchscreen は tap しかないので、スワイプ・押し続け・素早い連続タップは CDP の Input.dispatchTouchEvent で送る。
// WebKit では使えないため、これを使うテストには cdp: true を付ける（WebKit では「対象外」として飛ばす）
export async function touch(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const tap = async (x, y, hold = 30) => { await send('touchStart', [{ x, y }]); await sleep(hold); await send('touchEnd', []); };
  const swipe = async (x0, y0, dx, dy, steps = 6, stepMs = 16) => {
    await send('touchStart', [{ x: x0, y: y0 }]);
    for (let i = 1; i <= steps; i++) { if (stepMs) await sleep(stepMs); await send('touchMove', [{ x: x0 + dx * i / steps, y: y0 + dy * i / steps }]); }
    await send('touchEnd', []);
  };
  const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tapEl = async (sel, hold) => { const [x, y] = await center(sel); await tap(x, y, hold); };
  // 素早い連続タップ（間 100ms）。早送り中のページでは、ページ内の時間を止めて送る（負荷で CDP が遅れても 350ms 以内の扱いのまま）
  const doubleTap = async (sel) => { const [x, y] = await center(sel); await frozen(page, async () => { await tap(x, y); await sleep(100); await tap(x, y); }); await sleep(60); };
  return { cdp, send, tap, swipe, center, tapEl, doubleTap };
}

// ---------- 効果音の記録（ページのスクリプトより前に入れる initScript） ----------
// 音の部品（Oscillator・AudioBufferSource）の start の数と、YubiSfx の play / unlock の呼び出しを記録する
export const SFX_SPY = () => {
  window.__starts = 0; window.__plays = []; window.__unlock = 0; window.__ac = 0;
  for (const C of [window.OscillatorNode, window.AudioBufferSourceNode]) {
    if (!C) continue;
    const o = C.prototype.start;
    C.prototype.start = function (...a) { window.__starts++; return o.apply(this, a); };
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) { const W = class extends AC { constructor(...a) { super(...a); window.__ac++; } }; window.AudioContext = W; if (window.webkitAudioContext) window.webkitAudioContext = W; }
  let Y;
  Object.defineProperty(window, 'YubiSfx', {
    configurable: true, get() { return Y; },
    set(v) {
      const c = v.create;
      v.create = function (g, o) {
        const s = c.call(this, g, o);
        const p = s.play, u = s.unlock;
        s.play = function (n, a) { const b = window.__starts; const r = p.call(this, n, a); window.__plays.push({ n, a, d: window.__starts - b, known: s.names.includes(n) }); return r; };
        s.unlock = function () { window.__unlock++; return u.call(this); };
        return s;
      };
      Y = v;
    },
  });
};
export const plays = (p) => p.evaluate(() => window.__plays);
export const starts = (p) => p.evaluate(() => window.__starts);

// ---------- 画面の共通確認（横スクロール・画面外・safe-area・重なり・44px） ----------
// 「横スクロールなし」「画面内」などは各スクリプトで別々に書かれていたものを、この1関数にまとめた
export async function layoutProbe(page, sel, safe, { overlapSel = null, minSel = null } = {}) {
  return page.evaluate(([sel, safe, overlapSel, minSel]) => {
    const [t, r, b, l] = safe || [0, 0, 0, 0];
    const vis = (e) => (e.offsetParent !== null || getComputedStyle(e).position === 'fixed') && e.getBoundingClientRect().width > 0 && !e.closest('[hidden]');
    const name = (e) => e.getAttribute('aria-label') || e.dataset.action || e.dataset.cmd || e.id || e.className || e.tagName;
    const rect = (e) => { const q = e.getBoundingClientRect(); return { n: name(e), x: q.left, y: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
    const els = [...document.querySelectorAll(sel)].filter(vis).map(rect);
    const outside = els.filter((a) => a.x < l - 0.5 || a.y < t - 0.5 || a.r > innerWidth - r + 0.5 || a.b > innerHeight - b + 0.5).map((a) => `${a.n}[${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.r)},${Math.round(a.b)}]`);
    const overlaps = [];
    if (overlapSel) {
      const o = [...document.querySelectorAll(overlapSel)].filter(vis).map(rect);
      for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) {
        const A = o[i], B = o[j];
        if (A.x < B.r - 0.5 && B.x < A.r - 0.5 && A.y < B.b - 0.5 && B.y < A.b - 0.5) overlaps.push(`${A.n}×${B.n}`);
      }
    }
    const small = minSel ? [...document.querySelectorAll(minSel)].filter(vis).map(rect).filter((a) => a.w < 44 - 0.5 || a.h < 44 - 0.5).map((a) => `${a.n}:${Math.round(a.w)}x${Math.round(a.h)}`) : [];
    const hscroll = document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth;
    return { n: els.length, outside, overlaps, small, hscroll };
  }, [sel, safe, overlapSel, minSel]);
}
// 結果・確認カード：見出しが切れず、全ボタンに（必要ならカードをスクロールして）届くか
export async function cardReach(page) {
  return page.evaluate(() => {
    const ov = document.querySelector('#overlay'), card = document.querySelector('#card');
    ov.scrollTop = 0;
    const head = card.querySelector('h1, h2').getBoundingClientRect();
    const res = { headTop: Math.round(head.top), oy: getComputedStyle(ov).overflowY, ta: getComputedStyle(ov).touchAction, btns: [] };
    for (const b of card.querySelectorAll('button')) {
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      res.btns.push({ t: b.textContent, reach: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5 });
    }
    ov.scrollTop = 0;
    res.ok = res.headTop >= 0 && res.btns.length > 0 && res.btns.every((x) => x.reach) && res.oy === 'auto' && res.ta === 'pan-y';
    return res;
  });
}

// ---------- 合否の記録 ----------
// 既知の不具合の一覧（ここに載せたものだけが「既知」扱い。直ったら行を消す）
// K1（SE 横・Safari でブロックの DROP・HOLD が重なる）は feature/kiritori で直し、通常の合否に入れた（V2・V3・V8）
export const KNOWN_ISSUES = {
};
// 既知の不具合のキー → 説明（なければ undefined）。check(名前, ok, 詳細, known(キー)) のように使う
export const known = (key) => KNOWN_ISSUES[key];
export class Recorder {
  constructor() { this.items = []; this.cur = null; }
  start(id, title) { this.cur = { id, title, checks: [], t0: Date.now() }; }
  // known：既知の不具合（修正待ち）。不合格でもテスト全体は不合格にしないが、毎回「既知」として表示する。直ったら「解消」と表示
  check(name, ok, detail, known) { this.cur.checks.push({ name, ok: !!ok, known: known || undefined, detail: ok ? undefined : detail }); return !!ok; }
  fail(e) { this.cur.checks.push({ name: '例外', ok: false, detail: String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') }); }
  end() { const c = this.cur; c.ms = Date.now() - c.t0; c.ok = c.checks.length > 0 && c.checks.every((x) => x.ok || x.known); this.items.push(c); this.cur = null; return c; }
}
