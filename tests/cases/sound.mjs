// A: 効果音（common/sfx.js、06a53c7 で追加）。release-sound/sfx-test.mjs を統合したもの。
// 「鳴った」は、音の部品（Oscillator・AudioBufferSource）が start したことで確かめる（耳で聞こえ方は確かめられない → README の実機確認へ）
// 版数（CACHE_VERSION）の決め打ちと、旧版との遷移時間の比較（一度きりの確認）は持ち込まない。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { BASE, T48, BLK, custom, newPage, seed, ST, sleep, wait, SFX_SPY, plays, starts } from '../lib.mjs';

const V = () => custom(390, 844, null, 'iPhone 13');
const PAGES = [['games/blocks/index.html', 'blocks'], ['games/2048/index.html', 'tiles'], ['games/irocode/index.html', 'irocode'], ['index.html', 'menu']];

export const tests = [
  {
    id: 'A1', tier: 'smoke', node: true, title: '静的：各ページの sfx.play("名前") がすべて common/sfx.js の音名にあり、sfx.js を本体より前に読み込む',
    run({ check, root }) {
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      check('common/sfx.js が window.YubiSfx.create を定義する', typeof sandbox.YubiSfx?.create === 'function');
      for (const [page, game] of PAGES) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        const names = sandbox.YubiSfx.create(game).names || [];
        const calls = [...html.matchAll(/sfx\.play\(\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
        const dynamic = [...html.matchAll(/sfx\.play\(\s*(?!["'`])/g)].length;
        const missing = calls.filter((n) => !names.includes(n));
        check(`${page}: sfx.play ${calls.length} か所 [${[...new Set(calls)].join(', ')}] がすべて "${game}" の音名にある（変数での呼び出しなし）`, calls.length > 0 && !missing.length && !dynamic, { missing, dynamic, names });
        const own = /const sfx = \(\(\) =>|new (window\.)?(webkit)?AudioContext|createOscillator/.test(html);
        const rel = page === 'index.html' ? 'common/sfx.js' : '../../common/sfx.js';
        const sIdx = html.indexOf(`<script src="${rel}"></script>`), mainIdx = html.indexOf('<script>');
        check(`${page}: 古い自前の音モジュールがなく、${rel} を本体より前に読み込み、YubiSfx.create("${game}") を使う`, !own && sIdx > 0 && sIdx < mainIdx && html.includes(`YubiSfx.create("${game}")`), { own, sIdx, mainIdx });
      }
    },
  },
  {
    id: 'A2', tier: 'full', title: 'ブロック：操作で各音が鳴る（start・move・rotate・hold・drop・lock・over、clear 1〜4・level ほか）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'A2', { initScript: SFX_SPY });
      await seed(page, {});
      await page.goto(BLK); await sleep(200);
      await page.click('#card [data-cmd=restart]'); await sleep(150);
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'z', 'c', 'ArrowLeft', 'Space']) { await page.keyboard.press(k); await sleep(90); }
      // ソフトドロップで着地させ、固定されるまで待つ（ハードドロップは drop の音だけで lock は鳴らさない仕様）
      await page.keyboard.down('ArrowDown'); await sleep(1500); await page.keyboard.up('ArrowDown'); await sleep(1200);
      for (let i = 0; i < 40 && await page.evaluate(() => !document.querySelector('#card h1')?.textContent.includes('ゲームオーバー')); i++) { await page.keyboard.press('ArrowUp'); await sleep(30); await page.keyboard.press('Space'); await sleep(60); }
      await sleep(400);
      const ps = await plays(page);
      const seen = [...new Set(ps.map((p) => p.n))];
      check(`操作で ${seen.join(', ')} が鳴り、どの呼び出しも部品が start（${await starts(page)} 個）`,
        ['start', 'move', 'rotate', 'hold', 'drop', 'lock', 'over'].every((n) => seen.includes(n)) && ps.every((p) => p.known && p.d > 0), ps.filter((p) => !p.known || !p.d));
      // 盤面操作では出しにくい clear(1〜4)・level などは、同じモジュールを別に作って直接鳴らす
      // （1つの AudioContext を共有し、同時発音の上限は作ったものごとに数えるので待たずに鳴らせる）
      const direct = await page.evaluate(() => {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const r = {};
        for (const [n, a] of [['clear', 1], ['clear', 2], ['clear', 3], ['clear', 4], ['level'], ['best'], ['tap']]) {
          const s = YubiSfx.create('blocks', { ignoreSetting: true, context: ac });
          const b = window.__starts; s.play(n, a); r[n + (a || '')] = window.__starts - b;
        }
        return r;
      });
      check('clear(1〜4)・level・best・tap も部品が start する', Object.values(direct).length === 7 && Object.values(direct).every((d) => d > 0), direct);
      await ctx.close();
    },
  },
  {
    id: 'A3', tier: 'full', title: '2048：操作で各音が鳴る（milestone・best・move・undo・merge・win・over・start）、ベスト更新の音は1ゲーム1回（再読み込み後も）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'A3', { initScript: SFX_SPY }, { clock: true });
      const all = [];
      const harvest = async () => { all.push(...((await plays(page)) || [])); };
      const z = Array(16).fill(0);
      // 64+64 → 128（milestone）＋ 2+2、スコアが開始時ベスト 1000 を超える（best）→ 右へ（move）→ U（undo）
      const gA = [...z]; gA[0] = 64; gA[1] = 64; gA[4] = 2; gA[5] = 2;
      await seed(page, { 'tile2048.state': ST(gA, { score: 990, bestAtStart: 1000, topTile: 64 }), 'tile2048.best': '1000' });
      await page.goto(T48); await wait(page, 250);
      await page.keyboard.press('ArrowLeft'); await wait(page, 250);
      await page.keyboard.press('ArrowRight'); await wait(page, 250);
      await page.keyboard.press('u'); await wait(page, 250);
      const gB = [...z]; gB[0] = 2; gB[1] = 2;                                   // merge
      await harvest(); await seed(page, { 'tile2048.state': ST(gB, { score: 10 }) }); await page.goto(T48); await wait(page, 250);
      await page.keyboard.press('ArrowLeft'); await wait(page, 250);
      const gC = [...z]; gC[0] = 1024; gC[1] = 1024;                             // win
      await harvest(); await seed(page, { 'tile2048.state': ST(gC, { score: 10 }) }); await page.goto(T48); await wait(page, 250);
      await page.keyboard.press('ArrowLeft'); await wait(page, 600);
      const gD = [2, 4, 2, 4, 4, 2, 4, 2, 32, 4, 2, 4, 8, 16, 8, 0];             // 右で詰む（over）→ もう一度（start）
      await harvest(); await seed(page, { 'tile2048.state': ST(gD, { score: 10 }) }); await page.goto(T48); await wait(page, 250);
      await page.keyboard.press('ArrowRight'); await wait(page, 1500);
      await page.click('#card [data-cmd=restart]'); await wait(page, 250);
      await harvest();
      const seen = [...new Set(all.map((p) => p.n))];
      check(`操作で ${seen.join(', ')} が鳴り、どの呼び出しも部品が start`,
        ['milestone', 'best', 'move', 'undo', 'merge', 'win', 'over', 'start'].every((n) => seen.includes(n)) && all.every((p) => p.known && p.d > 0), all);
      check(`ベスト更新の音は1ゲーム1回（${all.filter((p) => p.n === 'best').length} 回）`, all.filter((p) => p.n === 'best').length === 1, all.map((p) => p.n));
      // 同じゲームで2回ベストを上回っても best は1回だけ（再読み込み後も）
      const g = [...z]; g[0] = 2; g[1] = 2; g[4] = 2; g[5] = 2; g[8] = 2; g[9] = 2;
      await seed(page, { 'tile2048.state': ST(g, { score: 999, bestAtStart: 1000 }), 'tile2048.best': '1000' });
      await page.goto(T48); await wait(page, 250);
      await page.keyboard.press('ArrowLeft'); await wait(page, 250);
      const ps0 = await plays(page);
      await page.reload(); await wait(page, 250);
      await page.keyboard.press('ArrowDown'); await wait(page, 250); await page.keyboard.press('ArrowUp'); await wait(page, 250);
      const ps = await plays(page);
      const sc = await page.evaluate(() => JSON.parse(localStorage.getItem('tile2048.state')).score);
      check(`ベスト超えで best が1回 → 再読み込みして更に伸ばしても（スコア ${sc}）best は鳴らない`, ps0.filter((p) => p.n === 'best').length === 1 && ps.filter((p) => p.n === 'best').length === 0 && ps.length >= 2 && sc > 1003, { ps0: ps0.map((p) => p.n), ps: ps.map((p) => p.n) });
      await ctx.close();
    },
  },
  {
    id: 'A4', tier: 'smoke', title: '効果音オフ：♪ や M キーの設定が保存され、両ゲーム・メニューで共有、オフなら何も鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'A4', { initScript: SFX_SPY });
      await seed(page, {});
      await page.goto(BLK); await sleep(150);
      // タイトルカードが前にあるので、ボタンの click をそのまま送る（同じ処理）。オン→オフ（オフにするときは鳴らない）
      await page.evaluate(() => document.querySelector('#soundBtn').click()); await sleep(80);
      const st = await page.evaluate(() => ({ ls: localStorage.getItem('blockpuzzle.sound'), pressed: document.querySelector('#soundBtn').getAttribute('aria-pressed') }));
      await page.click('#card [data-cmd=restart]'); await sleep(100);
      for (const k of ['ArrowLeft', 'ArrowUp', 'c', 'Space', 'Space']) { await page.keyboard.press(k); await sleep(50); }
      const n1 = await starts(page);
      check(`ブロック：♪でオフ（保存 ${st.ls}・aria-pressed ${st.pressed}）→ 操作しても鳴らない（start ${n1}）`, st.ls === 'off' && st.pressed === 'false' && n1 === 0, { st, n1 });
      // 2048 でもオフ（共通の設定）、操作しても鳴らない → ♪でオンにすると確認の音
      await page.goto(T48); await sleep(200);
      const pr = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      for (const k of ['ArrowLeft', 'ArrowRight', 'u']) { await page.keyboard.press(k); await sleep(150); }
      const n3 = await starts(page);
      await page.click('#soundBtn'); await sleep(100);
      const on = await page.evaluate(() => ({ n: window.__starts, ls: localStorage.getItem('blockpuzzle.sound') }));
      check(`2048：オフを共有（aria-pressed ${pr}）して鳴らない（start ${n3}）→ ♪でオンにすると保存され確認の音が鳴る（start ${on.n}）`, pr === 'false' && n3 === 0 && on.n > 0 && on.ls === 'on', { pr, n3, on });
      // ブロックに戻るとオン、再読み込みでも保たれる。M キーでオフ → 再読み込み後もオフ
      await page.goto(BLK); await sleep(120);
      const c = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.click('#card [data-cmd=restart]'); await sleep(80);
      await page.keyboard.press('m'); await sleep(80); await page.reload(); await sleep(150);
      const m = await page.evaluate(() => ({ ls: localStorage.getItem('blockpuzzle.sound'), pressed: document.querySelector('#soundBtn').getAttribute('aria-pressed') }));
      check('ブロック：2048 でオンにした設定が効き（オン）、M キーでオフ → 再読み込み後もオフ', c === 'true' && m.ls === 'off' && m.pressed === 'false', { c, m });
      // メニュー：オフならカードを押しても鳴らない。開いたままの間に設定が変わったら次に押したときに従う
      await page.goto(BASE); await sleep(150);
      await page.evaluate(() => document.querySelectorAll('a.game').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
      const b0 = await starts(page);
      await page.locator('a.game').nth(1).click(); await sleep(80);
      const offN = (await starts(page)) - b0;
      await page.evaluate(() => localStorage.setItem('blockpuzzle.sound', 'on'));
      await page.locator('a.game').nth(0).click(); await sleep(80);
      const onTap = (await plays(page)).some((p) => p.n === 'tap' && p.d > 0);
      await page.evaluate(() => localStorage.setItem('blockpuzzle.sound', 'off'));
      const b1 = await starts(page);
      await page.locator('a.game').nth(0).click(); await sleep(80);
      const offN2 = (await starts(page)) - b1;
      check('メニュー：オフなら押しても鳴らず、開いたままオン→オフに変わっても次に押したときに従う', offN === 0 && onTap && offN2 === 0, { offN, onTap, offN2 });
      await ctx.close();
    },
  },
  {
    id: 'A5', tier: 'full', title: 'メニュー：カードを押すと tap が鳴り、押したときの処理が短い（遷移を遅らせない）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'A5', {
        initScript: () => {
          window.__h = [];
          window.addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true });
          window.addEventListener('pointerdown', () => { window.__h.push(performance.now() - window.__t0); });
        },
      });
      await ctx.addInitScript(SFX_SPY);
      await seed(page, {});
      const nav = [], handler = [], tap = [];
      for (let i = 0; i < 6; i++) {
        await page.goto(BASE); await sleep(120);
        const box = await page.locator('a.game').nth(i % 2).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const t0 = Date.now();
        await page.mouse.down();
        const info = await page.evaluate(() => ({ h: window.__h.at(-1), plays: window.__plays })).catch(() => null);
        await page.mouse.up();
        await page.waitForURL(i % 2 ? T48 : BLK, { waitUntil: 'commit' });
        nav.push(Date.now() - t0);
        if (info) { handler.push(info.h); tap.push(info.plays); }
      }
      check(`カードを押すと tap が鳴る（${tap.filter((t) => t.some((p) => p.n === 'tap' && p.d > 0)).length}/${tap.length} 回）`, tap.length >= 5 && tap.every((t) => t.some((p) => p.n === 'tap' && p.d > 0)), tap.slice(0, 2));
      const max = Math.max(...handler);
      check(`pointerdown の処理は短い（最大 ${max.toFixed(1)}ms ≤ 16ms）、押してから移動までの最大 ${Math.max(...nav)}ms`, max <= 16, { handler, nav });
      await ctx.close();
    },
  },
];
