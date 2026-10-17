// S: オフラインで起動できる・更新で古いキャッシュが消える（Service Worker）。
// オフラインは「サーバーが接続を切る」方式で再現（Playwright の setOffline は SW 自身の fetch に効かないため）。
// キャッシュ版数は sw.js から読み取り、決め打ちしない。
import { BASE, T48, BLK, custom, newPage, seed, ST, sleep, swInfo as libSwInfo, known, IS_CHROMIUM } from '../lib.mjs';
const V = () => custom(390, 844, null, 'iPhone 13');
const swInfo = (root) => { const i = libSwInfo(root); return { ...i, files: i.n }; };
async function installed(browser, label, allowNetErrors = false) {
  const { ctx, page } = await newPage(browser, V(), label, { sw: true, allowNetErrors });
  await page.goto(BASE);
  // install に失敗すると ready は永久に解決しないので、8 秒で打ち切って不合格にする（止まらずに先へ進む）
  const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
  if (!ok) { await ctx.close(); throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）'); }
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
  return { ctx, page };
}
const appKeys = (page, name) => page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
const titleAt = async (page, url, sel) => {
  try { await page.goto(url, { timeout: 10000 }); return { t: await page.title(), el: await page.locator(sel).count(), path: new URL(page.url()).pathname }; } catch (e) { return { err: e.message.split('\n')[0] }; }
};

export const tests = [
  {
    id: 'S1', tier: 'smoke', title: 'インストール後、オフラインでメニュー・両ゲームが開き、行き来できる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      srv.reset();
      const { ctx, page } = await installed(browser, 'S1');
      await sleep(200);
      const r = await page.evaluate(async (prefix) => ({ scope: (await navigator.serviceWorker.getRegistration()).scope, keys: (await caches.keys()).filter((k) => k.startsWith(prefix)) }), info.prefix);
      const entries = await appKeys(page, info.app);
      check(`scope が ${BASE}、アプリ用キャッシュは ${info.app} の1つだけで ${info.files} ファイル`, r.scope === BASE && r.keys.length === 1 && r.keys[0] === info.app && entries.length === info.files, { r, n: entries.length });
      const pre = srv.state.log.filter((l) => l.path === '/game-no1/games/2048/index.html');
      check('事前キャッシュはブラウザの HTTP キャッシュを通さず取得（no-cache）', pre.length >= 1 && pre.every((l) => /no-cache/.test(l.cc)), pre);
      await srv.ctl('offline=1');
      // 効果音 common/sfx.js も Service Worker（キャッシュ）から読まれ、YubiSfx が使えること（release-sound の sfx 確認から統合）
      const sfxResp = [];
      const onResp = (r) => { if (r.url().endsWith('/common/sfx.js')) sfxResp.push({ status: r.status(), sw: r.fromServiceWorker() }); };
      page.on('response', onResp);
      const res = {};
      for (const [k, url, sel] of [['menu', BASE, 'a.game'], ['blocks', BLK, '#board'], ['t2048', T48, '#board .tile']]) {
        res[k] = await titleAt(page, url, sel);
        res[k].sfx = await page.evaluate(() => typeof window.YubiSfx?.create).catch(() => 'error');
      }
      page.off('response', onResp);
      check('オフライン：メニュー・ブロック・2048 が開く', res.menu.t === 'ゆびあそび' && res.menu.el === 2 && res.blocks.t === 'ブロックパズル' && res.blocks.el === 1 && res.t2048.t === 'ばいばいタイル' && res.t2048.el >= 2, res);
      check('オフライン：3画面とも common/sfx.js をキャッシュから読み、効果音（YubiSfx）が使える', Object.values(res).every((r) => r.sfx === 'function') && sfxResp.length === 3 && sfxResp.every((r) => r.sw && r.status === 200), { res, sfxResp });
      await page.goto(BASE);
      await page.locator('a.game').nth(0).click(); await page.waitForURL(BLK);
      await page.locator('#card [data-cmd=menu]').click(); await page.waitForURL(BASE);
      await page.locator('a.game').nth(1).click(); await page.waitForURL(T48);
      await page.locator('#backLink').click(); await page.waitForURL(BASE);
      check('オフラインのまま メニュー→ブロック→メニュー→2048→メニュー と行き来できる', page.url() === BASE && await page.locator('a.game').count() === 2);
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'S2', tier: 'smoke', title: '更新：旧版の SW から新版へ → 旧キャッシュが消えて新版だけ残る（版数は決め打ちしない）、保存データは残る',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const OLD = info.ver + '-old-test';
      srv.reset(); await srv.ctl('swver=' + encodeURIComponent(OLD));
      const { ctx, page } = await installed(browser, 'S2');
      await page.evaluate(async () => {
        for (const n of ['blockpuzzle-app-v2', 'blockpuzzle-fonts', 'otherrepo-cache']) { const c = await caches.open(n); await c.put('/x-' + n, new Response('x')); }
        localStorage.setItem('tile2048.best', '4096'); localStorage.setItem('blockpuzzle.best', '777');
      });
      await seed(page, { 'tile2048.state': ST([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4], { score: 1234 }) }, { clear: false });
      const k0 = await page.evaluate(() => caches.keys());
      check(`（準備）旧版 ${info.prefix}${OLD} と、もっと古い blockpuzzle-* のキャッシュがある`, k0.includes(info.prefix + OLD) && k0.includes('blockpuzzle-app-v2'), k0);
      await srv.ctl('swver=');
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      let k1 = [];
      for (let i = 0; i < 40; i++) { k1 = await page.evaluate(() => caches.keys()); if (k1.includes(info.app) && !k1.includes(info.prefix + OLD)) break; await sleep(250); }
      const apps = k1.filter((k) => k.startsWith(info.prefix));
      check(`旧版・blockpuzzle-* が消え、アプリ用キャッシュは新版 ${info.app} の1つだけ。他リポジトリのキャッシュは残す`, apps.length === 1 && apps[0] === info.app && !k1.some((k) => k.startsWith('blockpuzzle-')) && k1.includes('otherrepo-cache'), k1);
      await page.goto(BASE); await sleep(200);
      const swText = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return (await fetch(r.active.scriptURL, { cache: 'no-store' })).text(); });
      const best = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem('tile2048.state')));
      check('更新後も保存データ（ベスト・途中の盤面）がそのまま、有効な SW は新版', best[0] === '777' && best[1] === '4,096' && st.score === 1234 && swText.includes(`"${info.ver}"`), { best, st: st && st.score });
      await ctx.close();
    },
  },
  {
    id: 'S3', tier: 'full', title: 'オフラインの細部：index.html・クエリ付き・存在しないパス・存在しない画像、クエリで重複キャッシュしない',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      srv.reset();
      const { ctx, page } = await installed(browser, 'S3', true); // 存在しない画像・パスをわざと取りに行く
      await page.evaluate(async () => { for (const q of ['?utm=a', '?x=1&y=2']) await fetch('icons/icon-192.png' + q).then((r) => r.blob()); });
      await page.goto(T48 + '?utm_source=home'); await page.goto(BASE + '?from=pwa'); await sleep(200);
      const k = await appKeys(page, info.app);
      check(`クエリ付き URL で開いても重複キャッシュが増えない（${k.length} 件、? を含むキーなし）`, k.length === info.files && !k.some((x) => x.includes('?')), k);
      await srv.ctl('offline=1');
      const r = { idx: await titleAt(page, BASE + 'index.html', 'a.game'), q: await titleAt(page, T48 + '?from=home', '#board'), i2: await titleAt(page, T48 + 'index.html', '#board') };
      check('オフライン：index.html・クエリ付き・games/2048/index.html も開く', r.idx.t === 'ゆびあそび' && r.q.t === 'ばいばいタイル' && r.i2.t === 'ばいばいタイル', r);
      await page.goto(BASE + 'nope/deep/path/'); await page.waitForLoadState('load');
      const u = await page.evaluate(async () => ({ url: location.href, title: document.title, links: [...document.querySelectorAll('a.game')].map((a) => a.href), img: await fetch(document.querySelector('link[rel=apple-touch-icon]').href).then((x) => x.ok && x.headers.get('content-type')).catch(() => 'error') }));
      check('オフラインで存在しないパス → メニューへ移り、リンク・画像の URL が壊れない', u.url === BASE && u.title === 'ゆびあそび' && JSON.stringify(u.links) === JSON.stringify([BLK, T48]) && u.img === 'image/png', u);
      const miss = await page.evaluate(async () => fetch('icons/nothing.png').then((x) => 'status ' + x.status + ' ' + x.headers.get('content-type')).catch((e) => 'error:' + e.name));
      await srv.ctl('offline=0');
      const miss2 = await page.evaluate(async () => fetch('icons/nothing.png').then((x) => x.status));
      check('存在しない画像：オフラインでは HTML でなくエラー、オンラインではサーバーの 404 のまま', miss === 'error:TypeError' && miss2 === 404, { miss, miss2 });
      await ctx.close();
    },
  },
  {
    id: 'S4', tier: 'full', title: '遅い回線（5秒）・無応答のサーバーでも約3秒でキャッシュから開き、後で届いた応答でキャッシュを更新',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      srv.reset();
      const { ctx, page } = await installed(browser, 'S4', true); // 存在しないパスの 404 をわざと待つ
      const stamp = () => page.evaluate(async (u) => { const r = await caches.match(u); return r && Number(r.headers.get('x-served-at')); }, BLK);
      const before = await stamp();
      await srv.ctl('delay=5000');
      let t0 = Date.now();
      await page.goto(BLK + '?t=' + t0, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const dt = Date.now() - t0, title = await page.title();
      const K2 = known('S4|slow');
      check(`遅い回線：${dt}ms でキャッシュから表示（境界 3 秒の前後：2.8〜4.8 秒）`, dt >= 2800 && dt <= 4800 && title === 'ブロックパズル', { known: K2, dt, title }, K2);
      await sleep(3200);
      const after = await stamp();
      check('遅れて届いた応答でキャッシュが新しくなる', before && after && after > before && after >= t0 + 4500, { before, after, t0 });
      t0 = Date.now(); await page.goto(BASE + 'nope/x/', { timeout: 15000 }).catch(() => {});
      const tNo = Date.now() - t0, nope = await page.title();
      check('遅い回線：キャッシュにないパスはネットの応答（404）を待つ', tNo >= 4800 && nope === '404', { tNo, nope });
      await srv.ctl('delay=0&hang=1');
      // 合格なら 4.5 秒未満で開く。それより長く待っても判定は同じなので 6 秒で打ち切る
      t0 = Date.now(); await page.goto(T48, { timeout: 6000 }).catch(() => {});
      const tH = Date.now() - t0;
      check(`無応答のサーバー：キャッシュ済みページは ${tH}ms で表示（4.5 秒未満）`, tH < 4500 && (await page.title()) === 'ばいばいタイル', { known: K2, tH }, K2);
      await srv.ctl('hang=0');
      await ctx.close();
      void info;
    },
  },
  {
    id: 'S5', tier: 'full', title: '末尾スラッシュなし（301）で開け、リダイレクト応答はキャッシュしない。フォント用キャッシュは20件まで',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      srv.reset();
      const { ctx, page } = await installed(browser, 'S5');
      await page.goto(BASE + 'games/2048'); await sleep(150);
      const r = await page.evaluate(() => ({ t: document.title, p: location.pathname }));
      const k = (await appKeys(page, info.app)).map((u) => new URL(u).pathname);
      check('オンライン：games/2048 → 301 → 2048 が開き、リダイレクト応答はキャッシュに入らない', r.t === 'ばいばいタイル' && r.p === '/game-no1/games/2048/' && !k.includes('/game-no1/games/2048'), { r, k });
      // WebKit では Service Worker 自身の通信を Playwright で差し替えられず、外部の Google Fonts に出てしまうため Chromium だけで確かめる
      if (!IS_CHROMIUM) { await ctx.close(); return; }
      await page.goto(BASE);
      await page.evaluate(async () => { for (let i = 0; i < 25; i++) { await fetch(`https://fonts.gstatic.com/s/test/f${i}.woff2`, { mode: 'cors' }).catch(() => {}); await new Promise((r) => setTimeout(r, 25)); } });
      await sleep(400);
      const fk = await page.evaluate(async () => (await (await caches.open('yubiasobi-fonts')).keys()).map((r) => r.url.replace(/.*\//, '')));
      check(`フォント用キャッシュは上限20件、古いものから消える（${fk.length} 件）`, fk.filter((x) => /^f\d+\.woff2$/.test(x)).length <= 20 && !fk.includes('f0.woff2') && fk.includes('f24.woff2') && fk.length <= 20, fk);
      await ctx.close();
    },
  },
  {
    id: 'S6', tier: 'full', title: '遅い回線（4秒）：メニュー・2048 も約3秒でキャッシュから表示（S4 のブロックと同じ作りの画面）',
    async run({ browser, check, srv }) {
      srv.reset();
      const { ctx, page } = await installed(browser, 'S6', true);
      await srv.ctl('delay=4000');
      const K2 = known('S4|slow');
      for (const [name, url] of [['メニュー', BASE], ['2048', T48]]) {
        const t0 = Date.now();
        // 合格なら約 3 秒。5 秒で打ち切る（K2 のある版では 3 秒＋4 秒かかる）
        await page.goto(url + '?t=' + t0, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        const dt = Date.now() - t0;
        check(`遅い回線：${name}が ${dt}ms で表示（2.8〜4.8 秒）`, dt >= 2800 && dt <= 4800, { known: K2, dt }, K2);
        await srv.ctl('delay=0'); await page.goto('about:blank'); await sleep(300); await srv.ctl('delay=4000');
      }
      await srv.ctl('delay=0');
      await ctx.close();
    },
  },
];
