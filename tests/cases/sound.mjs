// A: 効果音（common/sfx.js、06a53c7 で追加）。release-sound/sfx-test.mjs を統合したもの。
// 「鳴った」は、音の部品（Oscillator・AudioBufferSource）が start したことで確かめる（耳で聞こえ方は確かめられない → README の実機確認へ）
// 版数（CACHE_VERSION）の決め打ちと、旧版との遷移時間の比較（一度きりの確認）は持ち込まない。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { BASE, T48, BLK, KIRI, custom, newPage, seed, ST, sleep, wait, SFX_SPY, plays, starts, kiriStart, kiriWaitObj, kiriSlash, kiriSnap } from '../lib.mjs';

const V = () => custom(390, 844, null, 'iPhone 13');
const PAGES = [['games/blocks/index.html', 'blocks'], ['games/2048/index.html', 'tiles'], ['games/kiritori/index.html', 'kiritori'], ['games/irocode/index.html', 'irocode'], ['games/zenmai/index.html', 'zenmai'], ['games/pikatto/index.html', 'pikatto'], ['games/irobin/index.html', 'irobin', ['games/irobin/render.js', 'games/irobin/main.js', 'games/irobin/input.js']], ['games/matomete/index.html', 'matomete', ['games/matomete/render.js', 'games/matomete/main.js', 'games/matomete/input.js']], ['index.html', 'menu']];

export const tests = [
  {
    id: 'A1', tier: 'smoke', node: true, title: '静的：各ページの sfx.play("名前") がすべて common/sfx.js の音名にあり、sfx.js を本体より前に読み込む',
    run({ check, root }) {
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      check('common/sfx.js が window.YubiSfx.create を定義する', typeof sandbox.YubiSfx?.create === 'function');
      for (const [page, game, extra] of PAGES) {
        // extra：音を鳴らすコードが別の .js にある画面（いろびん・まとめてポン）。音名の検査は BL10・QW16 が play("名前") を読んで行うので、ここでは読み込み順と create だけ見る
        const html = fs.readFileSync(path.join(root, page), 'utf8') + (extra || []).map((f) => '\n' + fs.readFileSync(path.join(root, f), 'utf8')).join('');
        const names = sandbox.YubiSfx.create(game).names || [];
        const calls = [...html.matchAll(/sfx\.play\(\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
        // 文字列2つの三項演算子（例 sfx.play(a ? "tick" : "unwind")）は両方の音名を検査する。それ以外の変数での呼び出しは不可
        const ternary = [...html.matchAll(/sfx\.play\(\s*[^()"'`]+\?\s*(["'])([^"']+)\1\s*:\s*(["'])([^"']+)\3\s*\)/g)];
        ternary.forEach((m) => calls.push(m[2], m[4]));
        const dynamic = [...html.matchAll(/sfx\.play\(\s*(?!["'`])/g)].length - ternary.length;
        const missing = calls.filter((n) => !names.includes(n));
        if (!extra) check(`${page}: sfx.play ${calls.length} か所 [${[...new Set(calls)].join(', ')}] がすべて "${game}" の音名にある（変数での呼び出しなし）`, calls.length > 0 && !missing.length && !dynamic, { missing, dynamic, names });
        else check(`${page}: "${game}" の音の表に ${names.length} 個の音があり、画面のコードが YubiSfx.create("${game}") を使う（音名の検査は BL10）`, names.length >= 12 && html.includes(`YubiSfx.create("${game}")`), { names });
        const own = /const sfx = \(\(\) =>|new (window\.)?(webkit)?AudioContext|createOscillator/.test(html);
        const rel = page === 'index.html' ? 'common/sfx.js' : '../../common/sfx.js';
        const sIdx = html.indexOf(`<script src="${rel}"></script>`), mainIdx = extra ? html.indexOf('<script src="logic.js"></script>') : html.indexOf('<script>');
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
      const { ctx, page } = await newPage(browser, V(), 'A3', { initScript: SFX_SPY, clock: true });
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
    id: 'A4', tier: 'smoke', audio: true, title: '効果音オフ：♪ や M キーの設定が保存され、3つのゲーム・メニューで共有、オフなら何も鳴らない',
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
      // キリトリ道場：共通の設定（オフ）が効き、遊んで的を切っても鳴らない → ♪でオンにすると確認の音、設定を保存
      const kp_ = await newPage(browser, V(), 'A4 kiri', { initScript: SFX_SPY, clock: true });
      const kpage = kp_.page;
      await seed(kpage, { 'blockpuzzle.sound': 'off' });
      await kpage.goto(KIRI); await wait(kpage, 150);
      const kp = await kpage.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      const k0 = await starts(kpage);
      await kiriStart(kpage);
      const f = await kiriWaitObj(kpage); if (f) await kiriSlash(kpage, f.o);
      const kOff = (await starts(kpage)) - k0, ks = (await kiriSnap(kpage)).score;
      await kpage.click('#soundBtn'); await sleep(100);
      const kOn = await kpage.evaluate(() => ({ n: window.__starts, ls: localStorage.getItem('blockpuzzle.sound'), p: document.querySelector('#soundBtn').getAttribute('aria-pressed') }));
      check(`キリトリ：オフを共有（aria-pressed ${kp}）し、的を切っても（${ks} 点）鳴らない（start ${kOff}）→ ♪でオンにすると保存され確認の音`, kp === 'false' && ks >= 1 && kOff === 0 && kOn.n > 0 && kOn.ls === 'on' && kOn.p === 'true', { kp, ks, kOff, kOn });
      await kp_.ctx.close();
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
      // 測る前に AudioContext を 1 回作っておく（最初の 1 回だけ 30〜40ms かかるため。単独で流しても成り立たせる）
      await page.goto(BASE); await page.evaluate(() => { const AC = window.AudioContext || window.webkitAudioContext; return AC ? new AC().close().catch(() => {}) : null; }); await sleep(100);
      // 並列実行の負荷で 1 回だけ遅れることがあるので（S6 と同じ考え方）、16ms を超えた回があれば 6 回の測定を最大 3 巡まで繰り返し、
      // いちばん速かった巡の最大値で判定する（基準の 16ms は変えない）
      const rounds = [];
      let nav = [], handler = [], tap = [];
      for (let round = 0; round < 3; round++) {
      nav = []; handler = []; tap = [];
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
      rounds.push({ nav, handler, tap, max: Math.max(...handler) });
      if (Math.max(...handler) <= 16) break;
      }
      ({ nav, handler, tap } = rounds.sort((a, b) => a.max - b.max)[0]);
      check(`カードを押すと tap が鳴る（${tap.filter((t) => t.some((p) => p.n === 'tap' && p.d > 0)).length}/${tap.length} 回）`, tap.length >= 5 && tap.every((t) => t.some((p) => p.n === 'tap' && p.d > 0)), tap.slice(0, 2));
      const max = Math.max(...handler);
      check(`pointerdown の処理は短い（最大 ${max.toFixed(1)}ms ≤ 16ms、いちばん速い巡。各巡 ${rounds.map((r) => r.max.toFixed(1)).join('/')}ms${rounds.length > 1 ? '＝16ms を超えた巡あり' : ''}）、押してから移動までの最大 ${Math.max(...nav)}ms`, max <= 16, { handler, nav, rounds: rounds.map((r) => r.max) });
      await ctx.close();
    },
  },
  {
    id: 'A6', tier: 'full', title: 'キリトリ道場：遊んで鳴る音（start・launch・slice・miss・over）、全部の音（slice・combo・bomb・miss・launch・best ほか）、既存ゲームの音は変わらない',
    async run({ browser, check, root }) {
      const { ctx, page } = await newPage(browser, V(), 'A6', { initScript: SFX_SPY, clock: true });
      await seed(page, {});
      await page.goto(KIRI); await wait(page, 150);
      await kiriStart(page);
      const f = await kiriWaitObj(page); if (f) await kiriSlash(page, f.o);
      for (let i = 0; i < 80 && (await kiriSnap(page)).state === 'play'; i++) await wait(page, 250);
      await wait(page, 1000);
      const ps = await plays(page);
      const seen = [...new Set(ps.map((p) => p.n))];
      const sl = ps.find((p) => p.n === 'slice');
      check(`遊ぶと ${seen.join(', ')} が鳴り、どの呼び出しも部品が start、slice は切った数（${sl && sl.a}）つき`, ['start', 'launch', 'slice', 'miss', 'over', 'best'].every((n) => seen.includes(n)) && ps.every((p) => p.known && (p.d > 0 || p.n === 'launch')) && sl && sl.a === 1, ps.filter((p) => !p.known || (!p.d && p.n !== 'launch')).slice(0, 5)); // launch は同時に2個出すと2個目が GAP(0.07秒)で間引かれるので部品0でよい（個別の確認は下の direct）
      const direct = await page.evaluate(() => {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const r = {};
        for (const [n, a] of [['slice', 1], ['slice', 5], ['slice', 12], ['combo', 3], ['combo', 8], ['combo', 30], ['bomb'], ['miss'], ['launch'], ['start'], ['over'], ['best'], ['toggle']]) {
          const s = YubiSfx.create('kiritori', { ignoreSetting: true, context: ac });
          const b = window.__starts; s.play(n, a); r[n + (a || '')] = window.__starts - b;
        }
        return r;
      });
      check('slice(1・5・12)・combo(3・8・30)・bomb・miss・launch・start・over・best・toggle がすべて部品を start（範囲外の数でも鳴る）', Object.values(direct).length === 13 && Object.values(direct).every((d) => d > 0), direct);
      // 同じ処理（時刻が進まない1回の呼び出しの間）で続けて切っても、slice は1回ごとに鳴る（間引かれない）
      const burst = await page.evaluate(() => {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const s = YubiSfx.create('kiritori', { ignoreSetting: true, context: ac });
        const r = [];
        for (const n of [1, 2, 3]) { const b = window.__starts; s.play('slice', n); r.push(window.__starts - b); }
        return r;
      });
      check(`同じ動きで 3 個切ると slice が 3 回とも部品を start（${burst}）`, burst.length === 3 && burst.every((d) => d > 0), burst);
      await ctx.close();
      // 既存ゲームの音名は変わらない（キリトリの音がほかのゲームに混ざらない）
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      const names = (g) => [...sandbox.YubiSfx.create(g).names].sort().join(',');
      const common = ['best', 'on', 'over', 'start', 'tap', 'toggle'];
      const want = {
        blocks: [...common, 'clear', 'drop', 'hold', 'level', 'lock', 'move', 'rotate'].sort().join(','),
        tiles: [...common, 'merge', 'milestone', 'move', 'undo', 'win'].sort().join(','),
        menu: [...common].sort().join(','),
        kiritori: [...common, 'bomb', 'combo', 'launch', 'miss', 'slice'].sort().join(','),
      };
      const got = Object.fromEntries(Object.keys(want).map((g) => [g, names(g)]));
      check('音名の一覧：ブロック・タイル・メニューは従来どおり、キリトリだけに slice・combo・bomb・miss・launch', Object.keys(want).every((g) => got[g] === want[g]), got);
    },
  },
];
