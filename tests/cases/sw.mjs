// S: オフラインで起動できる・更新で古いキャッシュが消える（Service Worker）。
// オフラインは「サーバーが接続を切る」方式で再現（Playwright の setOffline は SW 自身の fetch に効かないため）。
// キャッシュ版数は sw.js から読み取り、決め打ちしない。
import { BASE, ZEN, GAME_COUNT, GAME_URLS, T48, BLK, KIRI, IRO, custom, newPage, seed, ST, sleep, swInfo as libSwInfo, IS_CHROMIUM, SFX_SPY } from '../lib.mjs';
const V = () => custom(390, 844, null, 'iPhone 13');
const swInfo = (root) => { const i = libSwInfo(root); return { ...i, files: i.n }; };
async function installed(browser, label, allowNetErrors = false, opts = {}) {
  const { ctx, page } = await newPage(browser, V(), label, { sw: true, allowNetErrors, ...opts });
  await page.goto(BASE);
  // install に失敗すると ready は永久に解決しないので、8 秒で打ち切って不合格にする（止まらずに先へ進む）
  const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
  if (!ok) { await ctx.close(); throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）'); }
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
  return { ctx, page };
}
const appKeys = (page, name) => page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
// common/sfx.js の応答（Service Worker から返ったか）を記録する
const sfxWatch = (page) => {
  const list = [];
  const on = (r) => { if (r.url().includes('/common/sfx.js')) list.push({ status: r.status(), sw: r.fromServiceWorker() }); };
  page.on('response', on);
  return { list, off: () => page.off('response', on) };
};
// 効果音が鳴るか：YubiSfx で tap を鳴らし、音の部品が start したか（SFX_SPY を入れたページで）
const sfxPlays = (page) => page.evaluate(() => {
  if (typeof window.YubiSfx?.create !== 'function') return 'YubiSfx なし';
  const b = window.__starts; window.YubiSfx.create('menu', { ignoreSetting: true }).play('tap'); return window.__starts - b;
}).catch((e) => 'error: ' + e.message);
const titleAt = async (page, url, sel) => {
  try { await page.goto(url, { timeout: 10000 }); return { t: await page.title(), el: await page.locator(sel).count(), path: new URL(page.url()).pathname }; } catch (e) { return { err: e.message.split('\n')[0] }; }
};

export const tests = [
  {
    id: 'S1', tier: 'smoke', title: 'インストール後、オフラインでメニュー・5つのゲームが開き、行き来できる',
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
      for (const [k, url, sel] of [['menu', BASE, 'a.game'], ['blocks', BLK, '#board'], ['t2048', T48, '#board .tile'], ['kiri', KIRI, '#field'], ['iro', IRO, '#slots'], ['zen', ZEN, '#stage']]) {
        res[k] = await titleAt(page, url, sel);
        res[k].sfx = await page.evaluate(() => typeof window.YubiSfx?.create).catch(() => 'error');
      }
      page.off('response', onResp);
      check('オフライン：メニュー・ブロック・2048・キリトリ道場・いろコード・ゼンマイさんぽが開く', res.menu.t === 'ゆびあそび' && res.menu.el === GAME_COUNT && res.blocks.t === 'ブロックパズル' && res.blocks.el === 1 && res.t2048.t === 'ばいばいタイル' && res.t2048.el >= 2 && res.kiri.t === 'キリトリ道場' && res.kiri.el === 1 && res.iro.t === 'いろコード' && res.iro.el === 1 && res.zen.t === 'ゼンマイさんぽ' && res.zen.el === 1, res);
      check('オフライン：6画面とも common/sfx.js をキャッシュから読み、効果音（YubiSfx）が使える', Object.values(res).every((r) => r.sfx === 'function') && sfxResp.length === 6 && sfxResp.every((r) => r.sw && r.status === 200), { res, sfxResp });
      // オフラインのままキリトリ道場で遊べる（始めて的が飛ぶ）
      // 1 フレームで進むのは最大 0.05 秒なので、遅い環境ではゲーム内の時間がゆっくり進む。ゲーム内で 1 秒たつまで待つ（最大 10 秒）
      await page.goto(KIRI); await page.click('#card [data-cmd=restart]');
      await page.waitForFunction(() => window.KiritoriGame.snapshot().elapsed > 1, null, { timeout: 10000 }).catch(() => {});
      const ks = await page.evaluate(() => window.KiritoriGame.snapshot());
      check('オフライン：キリトリ道場を始めると的が飛んでくる', ks.state === 'play' && ks.elapsed > 1 && (ks.objs.length > 0 || ks.lives < 3), { state: ks.state, n: ks.objs.length, elapsed: ks.elapsed });
      await page.goto(BASE);
      await page.locator('a.game').nth(0).click(); await page.waitForURL(BLK);
      await page.locator('#card [data-cmd=menu]').click(); await page.waitForURL(BASE);
      await page.locator('a.game').nth(1).click(); await page.waitForURL(T48);
      await page.locator('#backLink').click(); await page.waitForURL(BASE);
      await page.locator('a.game').nth(2).click(); await page.waitForURL(KIRI);
      await page.locator('#card [data-cmd=menu]').click(); await page.waitForURL(BASE);
      await page.locator('a.game').nth(3).click(); await page.waitForURL(IRO);
      await page.locator('#back').click(); await page.waitForURL(BASE);
      await page.evaluate(() => localStorage.setItem('zenmai.help', '1'));   // 初回の遊び方カードは見たことにする（カードの閉じ方は ZU2 で確認）
      await page.locator('a.game').nth(4).click(); await page.waitForURL(ZEN);
      await page.locator('#back').click(); await page.waitForURL(BASE);
      check('オフラインのまま メニュー→ブロック→2048→キリトリ→いろコード→ゼンマイ（各回メニューへ戻る）と行き来できる', page.url() === BASE && await page.locator('a.game').count() === GAME_COUNT);
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
      check('オフラインで存在しないパス → メニューへ移り、リンク・画像の URL が壊れない', u.url === BASE && u.title === 'ゆびあそび' && JSON.stringify(u.links) === JSON.stringify(GAME_URLS.map((x) => BASE + x)) && u.img === 'image/png', u);
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
      check(`遅い回線：${dt}ms でキャッシュから表示（境界 3 秒の前後：2.8〜4.8 秒）`, dt >= 2800 && dt <= 4800 && title === 'ブロックパズル', { dt, title });
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
      check(`無応答のサーバー：キャッシュ済みページは ${tH}ms で表示（4.5 秒未満）`, tH < 4500 && (await page.title()) === 'ばいばいタイル', { tH });
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
    id: 'S6', tier: 'full', title: '遅い回線（5秒）・無応答：メニュー・ブロック・2048 とも約3秒で表示され、common/sfx.js はキャッシュからすぐ読まれて効果音が鳴る（K2）',
    async run({ browser, check, srv }) {
      srv.reset();
      const { ctx, page } = await installed(browser, 'S6', true, { initScript: SFX_SPY });
      const calm = async () => { await srv.ctl('delay=0&hang=0'); await page.goto('about:blank'); await sleep(300); };
      // オンライン（遅延なし）：3画面とも 1 秒未満で表示（sfx.js をキャッシュから返しても、通常の表示が遅くならない）。
      // 並列実行の負荷で 1 回だけ遅れることがあるので、2 回開いて速いほうで判定する
      const on = {};
      for (const [name, url] of [['メニュー', BASE], ['ブロック', BLK], ['2048', T48]]) {
        for (let i = 0; i < 2; i++) { const t0 = Date.now(); await page.goto(url, { waitUntil: 'domcontentloaded' }); on[name] = Math.min(on[name] ?? Infinity, Date.now() - t0); }
      }
      check(`オンライン：3画面とも 1 秒未満で表示（${Object.entries(on).map(([k, v]) => `${k} ${v}ms`).join('、')}）`, Object.values(on).every((v) => v < 1000), on);
      await calm();
      for (const [mode, q] of [['遅い回線（5秒）', 'delay=5000'], ['無応答', 'hang=1']]) {
        for (const [name, url] of [['メニュー', BASE], ['ブロック', BLK], ['2048', T48]]) {
          await srv.ctl(q);
          const w = sfxWatch(page);
          const t0 = Date.now();
          // 合格なら約 3 秒。6 秒で打ち切る（K2 のある版では 3 秒＋5 秒、無応答では表示されない）
          await page.goto(url + '?t=' + t0, { waitUntil: 'domcontentloaded', timeout: 6000 }).catch(() => {});
          const dt = Date.now() - t0;
          w.off();
          const snd = await sfxPlays(page);
          check(`${mode}：${name}が ${dt}ms で表示（2.8〜4.8 秒）、sfx.js は Service Worker から 200、効果音が鳴る（部品 ${snd}）`,
            dt >= 2800 && dt <= 4800 && w.list.length >= 1 && w.list.every((r) => r.sw && r.status === 200) && snd > 0, { dt, sfx: w.list, snd });
          await calm();
        }
      }
      await ctx.close();
    },
  },
  {
    id: 'S7', tier: 'full', title: '新しい版がサーバーに出たとき：旧版の SW のままでも HTML と sfx.js の版がそろう（古い sfx.js をキャッシュから混ぜない）、旧キャッシュに新しい版を混ぜない、更新後は新しい版がそろう',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const OLD = info.ver + '-old-test';
      srv.reset(); await srv.ctl('swver=' + encodeURIComponent(OLD));
      const { ctx, page } = await installed(browser, 'S7', true);
      // 版の印：HTML の末尾の <!--rel:xxx--> と、sfx.js が入れる self.__rel
      const ver = () => page.evaluate(() => ({
        html: ([...document.childNodes, ...document.documentElement.childNodes, ...(document.body ? document.body.childNodes : [])].find((n) => n.nodeType === 8 && n.data.startsWith('rel:'))?.data.slice(4)) || null,
        sfx: window.__rel || null,
      }));
      // ① 中身だけ新しくなった（sw.js は旧版のまま＝版数の上げ忘れ、または更新の確認前）：オンラインで開くと HTML も sfx.js も新しい版
      await srv.ctl('rel=R2');
      const r1 = {};
      for (const [name, url] of [['menu', BASE], ['blocks', BLK], ['t2048', T48], ['kiri', KIRI]]) { await page.goto(url); await sleep(150); r1[name] = await ver(); }
      check('旧版の SW のまま新しい版を開く：4画面とも HTML と sfx.js がそろって新しい版（R2）', Object.values(r1).every((v) => v.html === 'R2' && v.sfx === 'R2'), r1);
      // ② そのままオフライン：キャッシュは旧版のままそろっている（新しい HTML・sfx.js を旧キャッシュに混ぜない）
      await sleep(300);
      await srv.ctl('offline=1');
      const r2 = {};
      for (const [name, url] of [['menu', BASE], ['blocks', BLK], ['t2048', T48], ['kiri', KIRI]]) { await page.goto(url).catch(() => {}); await sleep(150); r2[name] = await ver().catch((e) => e.message); }
      check('続けてオフライン：4画面とも旧版の HTML と旧版の sfx.js（混ざらない）', Object.values(r2).every((v) => v.html === null && v.sfx === null), r2);
      await srv.ctl('offline=0');
      // ③ 新版の sw.js（版数を上げた）を配る：旧キャッシュが消え、新しいキャッシュは新しい版でそろい、オフラインでも新しい版
      await srv.ctl('swver=&rel=R3');
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      let k = [];
      for (let i = 0; i < 40; i++) { k = await page.evaluate(() => caches.keys()); if (k.includes(info.app) && !k.includes(info.prefix + OLD)) break; await sleep(250); }
      check(`更新：旧版のキャッシュが消え、新版 ${info.app} だけ`, k.filter((x) => x.startsWith(info.prefix)).join() === info.app, k);
      await srv.ctl('offline=1');
      const r3 = {};
      for (const [name, url] of [['menu', BASE], ['blocks', BLK], ['t2048', T48], ['kiri', KIRI]]) { await page.goto(url).catch(() => {}); await sleep(150); r3[name] = await ver().catch((e) => e.message); }
      check('更新後にオフライン：4画面とも HTML と sfx.js がそろって新しい版（R3）', Object.values(r3).every((v) => v.html === 'R3' && v.sfx === 'R3'), r3);
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
];
