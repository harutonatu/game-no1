// T: タッチ操作。ダブルタップ拡大の抑止（8fce3ca、iOS Safari）と、効果音の準備（タッチで AudioContext を作る＝unlock）が両立すること。
// hotfix/doubletap.mjs と release-sound/unlock-touch.mjs を統合したもの。
// 素早い連続タップ・スワイプ・長押しは CDP の Input.dispatchTouchEvent で送るため Chromium 専用（WebKit では対象外）。
// 実機の iOS Safari でダブルタップ拡大が起きないかは、ここでは確かめられない（README の実機確認へ）。
import { BASE, T48, BLK, KIRI, custom, newPage, seed, wait, frozen, touch, SFX_SPY, kiriSnap, kiriWaitObj } from '../lib.mjs';

const CDP = 'CDP のタッチ操作（連続タップ・スワイプ・長押し）';
const IP13 = (h = 664) => custom(390, h, null, 'iPhone 13 Safari');

// touchend が最後（window）まで届いたときに止められていたか（defaultPrevented）を記録する
const TE_SPY = () => {
  window.__te = [];
  window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented, t: e.target.id || e.target.className || e.target.tagName }));
};
// ブロックの操作回数を数える行をテストのときだけ差し込む（ファイル自体は変更しない。関数名が変わったら例外で知らせる）
async function countBlocks(ctx) {
  await ctx.route(/games\/blocks\/(index\.html)?(\?.*)?$/, async (route) => {
    const r = await route.fetch(); let b = await r.text();
    const inj = (needle, add) => { if (!b.includes(needle)) throw new Error('差し込み位置が見つからない: ' + needle); b = b.replace(needle, needle + add); };
    inj('function rotate(dir) {', ' (window.__c ||= {}).rot = (window.__c.rot || 0) + 1;');
    inj('function shift(dir) {', ' (window.__c ||= {}).shift = (window.__c.shift || 0) + 1;');
    inj('function hardDrop() {', ' (window.__c ||= {}).drop = (window.__c.drop || 0) + 1;');
    inj('function hold() {', ' (window.__c ||= {}).hold = (window.__c.hold || 0) + 1;');
    await route.fulfill({ response: r, body: b });
  });
}
async function open(browser, v, label, url, { counters = false } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { device: 'iPhone 13', initScript: SFX_SPY, clock: true });
  await ctx.addInitScript(TE_SPY);
  if (counters) await countBlocks(ctx);
  await seed(page, {});
  await page.goto(url); await wait(page, 250);
  const t = await touch(ctx, page);
  // 待ち時間は早送り（連続タップの判定は performance.now なので、早送りした分だけ「間をあけた」ことになる）
  const w = (ms) => wait(page, ms);
  const te = () => page.evaluate(() => window.__te.splice(0));
  const cnt = () => page.evaluate(() => ({ rot: 0, shift: 0, drop: 0, hold: 0, ...(window.__c || {}) }));
  const audio = () => page.evaluate(() => { const r = { unlock: window.__unlock, ac: window.__ac, plays: window.__plays.map((p) => p.n) }; window.__unlock = 0; window.__plays = []; return r; });
  return { ctx, page, w, ...t, te, cnt, audio };
}
const hidden = (page) => page.evaluate(() => document.querySelector('#overlay').hidden);
const cardH = (page) => page.evaluate(() => document.querySelector('#card h1, #card h2')?.textContent || '');
const pressed = (page) => page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));

export const tests = [
  {
    id: 'T5', tier: 'smoke', title: 'ダブルタップ拡大の抑止（CDP を使わない版。WebKit でも確かめる）：dblclick・gesture を止め、盤面の連続タップの touchend を止める',
    async run({ browser, check }) {
      // Playwright の touchscreen.tap（どのブラウザでも使える）を2回続けて送る
      for (const [name, url, sel] of [['ブロック', BLK, '#board'], ['2048', T48, '#board'], ['キリトリ', KIRI, '#field'], ['メニュー', BASE, '.head h1']]) {
        const { ctx, page } = await newPage(browser, IP13(), 'T5 ' + name, { initScript: TE_SPY, clock: true });
        await seed(page, {});
        await page.goto(url); await page.waitForTimeout(200);
        if (url === BLK || url === KIRI) { await page.locator('#card [data-cmd=restart]').tap(); await page.waitForTimeout(400); }
        const g = await page.evaluate(() => {
          const el = document.querySelector('#board') || document.querySelector('#field') || document.body;
          const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          const gs = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
          return { dblclickPrevented: !d, gesturePrevented: gs.every((x) => !x) };
        });
        await page.evaluate(() => window.__te.splice(0));
        const b = await page.locator(sel).boundingBox();
        await frozen(page, async () => {
          await page.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40));
          await wait(page, 80);
          await page.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40));
        });
        await page.waitForTimeout(60);
        const ev = await page.evaluate(() => window.__te.splice(0));
        // ゲームの盤面（.stage）は1回目から常に止める。メニューは2回目だけ止める（1回目は止めない＝リンクやスクロールを妨げない）
        const first = url === BASE ? false : true;
        check(`${name}：dblclick・gesturestart/gesturechange を止め、連続タップの touchend は ${first ? '1回目から' : '2回目だけ'}止める`, g.dblclickPrevented && g.gesturePrevented && ev.length === 2 && ev[0].p === first && ev[1].p === true, { g, ev });
        await ctx.close();
      }
    },
  },
  {
    id: 'T1', tier: 'smoke', cdp: CDP, title: 'ダブルタップ拡大の抑止の細部（回転は2回効く・1回目は止めない・2回目でカードを押せる）と、最初のタッチで効果音の準備（unlock）ができる',
    async run({ browser, check }) {
      // ブロック：盤面の連続タップは2回目の touchend を止め、回転は2回効く。最初の盤面タップで unlock・AudioContext 1つ
      {
        const b = await open(browser, IP13(), 'T1 blocks', BLK, { counters: true });
        await b.tapEl('#card [data-cmd=restart]'); await b.w(150);
        const started = await hidden(b.page);
        await b.w(400); await b.te(); await b.audio();
        const c0 = await b.cnt(); await b.doubleTap('#board'); const ev = await b.te(); const c1 = await b.cnt();
        const au = await b.audio();
        check('ブロック：盤面の連続タップ（100ms）→ 2回目の touchend を止め、回転は2回', started && ev.length === 2 && ev[1].p === true && c1.rot - c0.rot === 2, { started, ev, c0, c1 });
        check('ブロック：盤面のタップ（touchend を止める）でも unlock が呼ばれ、AudioContext は1つ', au.unlock >= 1 && au.ac === 1, au);
        await b.ctx.close();
      }
      // 2048：盤面の連続タップは2回目の touchend を止める、最初のタップで unlock
      {
        const t = await open(browser, IP13(), 'T1 2048', T48);
        await t.te(); await t.audio();
        await t.doubleTap('#board'); const ev = await t.te();
        const au = await t.audio();
        check('2048：盤面の連続タップ → 2回目の touchend を止める、unlock が呼ばれ AudioContext は1つ', ev.length === 2 && ev[1].p === true && au.unlock >= 1 && au.ac === 1, { ev, au });
        await t.ctx.close();
      }
      // メニュー：見出しの連続タップは2回目だけ止める。2回目のタップがカードでも unlock・tap が鳴り、カードの click が起きる
      {
        const m = await open(browser, IP13(), 'T1 menu', BASE);
        await m.te(); await m.doubleTap('.head h1'); const ev = await m.te();
        check('メニュー：見出しの連続タップは2回目の touchend だけ止める（1回目は止めない）', ev.length === 2 && ev[0].p === false && ev[1].p === true, ev);
        await m.w(400);
        await m.page.evaluate(() => window.addEventListener('click', (e) => { if (e.target.closest('a.game')) { e.preventDefault(); window.__clicked = (window.__clicked || 0) + 1; } }));
        await frozen(m.page, async () => { await m.tapEl('h1'); await m.w(100); await m.te(); await m.audio(); await m.tapEl('a.game'); });
        await m.w(150);
        const ev2 = await m.te(); const au = await m.audio(); const clicked = await m.page.evaluate(() => window.__clicked || 0);
        check('メニュー：連続タップの2回目でカードを押す → touchend は止めても unlock・tap が鳴り、カードの click が1回起きる', ev2.length === 1 && ev2[0].p === true && au.unlock >= 1 && au.plays.includes('tap') && au.ac >= 1 && clicked === 1, { ev2, au, clicked });
        await m.ctx.close();
      }
    },
  },
  {
    id: 'T2', tier: 'full', cdp: CDP, title: 'ブロックのタッチ操作一式（スワイプ・はじく・ボタン・長押し・連続タップ・一時停止・やり直し・ゲームオーバー）',
    async run({ browser, check }) {
      const b = await open(browser, IP13(), 'T2', BLK, { counters: true });
      const { page } = b;
      await b.tapEl('#card [data-cmd=restart]'); await b.w(150);
      check('タイトルの「スタート」をタップで開始', await hidden(page));
      await b.te();
      const [bx, by] = await b.center('#board');
      let c0 = await b.cnt(); await b.swipe(bx, by - 100, 90, 0); await b.w(80); let c1 = await b.cnt();
      const sw = c1.shift - c0.shift;
      c0 = await b.cnt(); await b.swipe(bx, by - 150, 0, 240, 3, 0); await b.w(80); c1 = await b.cnt();
      const fl = c1.drop - c0.drop;
      c0 = await b.cnt(); await b.swipe(bx, by + 50, 0, -150, 6, 30); await b.w(80); c1 = await b.cnt();
      const up = c1.hold - c0.hold;
      check(`盤面：横スワイプで移動（${sw}）、下へはじくと一気に落下（${fl}）、上スワイプでホールド（${up}）`, sw >= 2 && fl === 1 && up === 1, { sw, fl, up });
      await b.te();
      const res = {};
      for (const [a, k] of [['left', 'shift'], ['right', 'shift'], ['drop', 'drop'], ['hold', 'hold'], ['cw', 'rot'], ['ccw', 'rot']]) {
        c0 = await b.cnt(); await b.tapEl(`[data-action=${a}]`); await b.w(260); c1 = await b.cnt(); res[a] = c1[k] - c0[k];
      }
      check('操作ボタン ◀ ▶ DROP HOLD A B のタップがそれぞれ効く', Object.values(res).every((n) => n >= 1), res);
      const sc = () => page.evaluate(() => Number(document.querySelector('#score').textContent.replace(/,/g, '')));
      const s0 = await sc(); await b.tapEl('[data-action=down]', 400); await b.w(50); const s1 = await sc();
      c0 = await b.cnt(); await b.tapEl('[data-action=left]', 600); await b.w(50); c1 = await b.cnt();
      check(`▼ の長押しでソフトドロップ（得点 ${s0}→${s1}）、◀ の長押しで連続移動（${c1.shift - c0.shift}）`, s1 > s0 && c1.shift - c0.shift >= 3, { s0, s1, c0, c1 });
      await b.te();
      c0 = await b.cnt(); await b.doubleTap('[data-action=cw]'); c1 = await b.cnt(); const ev = await b.te();
      check('A の連続タップで回転2回、2回目の touchend は止める', c1.rot - c0.rot === 2 && ev.slice(-1)[0]?.p === true, { c0, c1, ev });
      const p0 = await pressed(page); await b.tapEl('#soundBtn'); await b.w(400); const p1 = await pressed(page);
      await b.te(); await b.doubleTap('#soundBtn'); const ev2 = await b.te(); const p2 = await pressed(page);
      check('♪ のタップで切り替わり、連続タップでは2回切り替わる（2回目の touchend は止めて click を補う）', p0 !== p1 && p2 === p1 && ev2.length === 2 && ev2[0].p === false && ev2[1].p === true, { p0, p1, p2, ev2 });
      await b.w(400);
      await b.tapEl('#pauseBtn'); await b.w(150);
      const paused = /一時停止/.test(await cardH(page));
      await b.tapEl('#card [data-cmd=resume]'); await b.w(150);
      const resumed = await hidden(page);
      await b.w(400);
      await b.tapEl('#menuBtn'); await b.w(150);
      const viaMenu = await cardH(page);
      await b.tapEl('#card [data-cmd=askRestart]'); await b.w(150);
      const confirmH = await cardH(page);
      await b.tapEl('#card [data-cmd=cancel]'); await b.w(150);
      const back = await cardH(page);
      await b.tapEl('#card [data-cmd=askRestart]'); await b.w(150);
      await b.tapEl('#card [data-cmd=restart]'); await b.w(150);
      const fresh = (await hidden(page)) && (await sc()) === 0;
      check('II で一時停止 →「再開」、← メニューで一時停止 →「やり直す」確認 →「やめる」で戻る → 確定で新しいゲーム（すべてタップ）', paused && resumed && /一時停止/.test(viaMenu) && /やり直す/.test(confirmH) && /一時停止/.test(back) && fresh, { paused, resumed, viaMenu, confirmH, back, fresh });
      for (let i = 0; i < 80 && (await hidden(page)); i++) { await page.keyboard.press('Space'); await b.w(30); }
      const overH = await cardH(page);
      await b.tapEl('#card [data-cmd=restart]'); await b.w(150);
      check('ゲームオーバー画面の「もう一度」をタップで再開', /ゲームオーバー/.test(overH) && (await hidden(page)), overH);
      await b.ctx.close();
    },
  },
  {
    id: 'T3', tier: 'full', cdp: CDP, title: '2048 とメニューのタッチ操作一式（スワイプ・連続タップ・1手戻す・最初から・← メニュー、メニューのスクロールとカード）',
    async run({ browser, check }) {
      const t = await open(browser, IP13(), 'T3 2048', T48);
      const { page } = t;
      const grid = () => page.evaluate(() => document.querySelector('#board').textContent);
      const [bx, by] = await t.center('#board');
      let moved = 0;
      for (const [dx, dy] of [[-80, 0], [0, 80], [80, 0], [0, -80], [-80, 0], [0, 80]]) { const a = await grid(); await t.swipe(bx, by, dx, dy); await t.w(220); if ((await grid()) !== a) moved++; }
      check(`スワイプでタイルが動く（${moved}/6）`, moved >= 3, moved);
      await t.w(400);
      const p0 = await pressed(page); await t.te(); await t.doubleTap('#soundBtn'); const ev = await t.te(); const p1 = await pressed(page);
      check('♪ の連続タップで2回切り替わり（元に戻る）、2回目の touchend は止める', p0 === p1 && ev[0]?.p === false && ev[1]?.p === true, { p0, p1, ev });
      await t.w(400);
      const before = await grid(); await t.tapEl('#undoBtn'); await t.w(250);
      const undone = (await grid()) !== before;
      await t.w(400);
      await t.tapEl('#newBtn'); await t.w(150);
      const ch = await cardH(page);
      await t.tapEl('#card [data-cmd=cancel]'); await t.w(150);
      const closed = await hidden(page);
      await t.w(400);
      await t.tapEl('#backLink'); await page.waitForURL(BASE, { timeout: 3000 }).catch(() => {});
      check('「1手戻す」のタップで戻る、「最初から」→確認→「やめる」で閉じる、「← メニュー」でメニューへ（すべてタップ）', undone && /最初から/.test(ch) && closed && page.url() === BASE, { undone, ch, closed, url: page.url() });
      await t.ctx.close();
      const m = await open(browser, IP13(300), 'T3 menu', BASE);
      await m.swipe(195, 260, 0, -150, 8, 20); await m.w(500);
      const sy = await m.page.evaluate(() => window.scrollY);
      await m.page.evaluate(() => window.scrollTo(0, 0)); await m.w(100);
      const box = await m.page.locator('a.game').first().boundingBox();
      await frozen(m.page, async () => { await m.tapEl('h1'); await m.w(100); await m.tap(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300 - box.y - 5)); });
      const nav = await m.page.waitForURL(/games\//, { timeout: 3000 }).then(() => true, () => false);
      check(`メニュー：縦スクロールでき（${sy}px）、見出しのタップ直後（2回目扱い）でもカードのタップでゲームへ移る`, sy > 0 && nav, { sy, nav, url: m.page.url() });
      await m.ctx.close();
    },
  },
  {
    id: 'T4', tier: 'full', cdp: CDP, title: '♪ を間をあけて／素早く2回タップ：毎回 unlock され、切り替えは2回（両ゲーム）',
    async run({ browser, check }) {
      for (const [name, url] of [['ブロック', BLK], ['2048', T48]]) {
        const t = await open(browser, IP13(), 'T4 ' + name, url);
        if (url === BLK) { await t.tapEl('#card [data-cmd=restart]'); await t.w(300); }   // タイトルカードが ♪ を覆うので先に開始
        const [sx, sy] = await t.center('#soundBtn');
        await t.te(); await t.audio();
        await t.tap(sx, sy); await t.w(500); const a = await pressed(t.page);
        await t.tap(sx, sy); await t.w(500); const b = await pressed(t.page);
        const m1 = { te: await t.te(), ...(await t.audio()) };
        check(`${name}：♪を間をあけて2回タップ → 止めずに click で オフ→オン、unlock は毎回`, a === 'false' && b === 'true' && m1.te.map((x) => x.p).join() === 'false,false' && m1.unlock >= 2, { a, b, ...m1 });
        await t.w(500); await t.te(); await t.audio();
        const q0 = await pressed(t.page);
        await frozen(t.page, async () => { await t.tap(sx, sy); await t.w(100); await t.tap(sx, sy); });
        await t.w(150);
        const m2 = { te: await t.te(), ...(await t.audio()) };
        const q1 = await pressed(t.page);
        check(`${name}：♪を素早く2回 → 2回目の touchend は止めて click() で補い、unlock は毎回、切り替えは2回（元に戻る）`, m2.te.length === 2 && m2.te[0].p === false && m2.te[1].p === true && m2.unlock >= 2 && q0 === q1 && q0 === 'true', { q0, q1, ...m2 });
        await t.ctx.close();
      }
    },
  },
  {
    id: 'T6', tier: 'full', cdp: CDP, title: 'キリトリ道場のタッチ操作（指のスワイプで切る・道場の touchend は常に止める・最初のタッチで音の準備・上のボタンの連続タップ・カードのボタン）',
    async run({ browser, check }) {
      const k = await open(browser, IP13(), 'T6', KIRI);
      const { page } = k;
      await k.tapEl('#card [data-cmd=restart]'); await k.w(150);
      const started = (await kiriSnap(page)).state === 'play';
      await k.te(); await k.audio();
      const f = await kiriWaitObj(page);
      // 指で的を横になぞる（時間を止めたまま、止めた時点の位置で）
      await frozen(page, async () => {
        const s = await kiriSnap(page);
        const o = s.objs.filter((x) => x.kind !== 'bomb').sort((a, b) => Math.hypot(a.x - f.o.x, a.y - f.o.y) - Math.hypot(b.x - f.o.x, b.y - f.o.y))[0];
        await k.swipe(o.x - o.r - 30, o.y + 2, 2 * o.r + 60, -4, 8, 0);
      });
      await k.w(30);
      const s1 = await kiriSnap(page);
      const ev = await k.te(), au = await k.audio();
      check('指のスワイプで的が切れて 1 点、道場の touchend は止める、最初のタッチで unlock・AudioContext 1つ・slice が鳴る', started && !!f && s1.score === 1 && ev.length === 1 && ev[0].p === true && au.unlock >= 1 && au.ac === 1 && au.plays.includes('slice'), { started, score: s1.score, ev, au });
      await k.te();
      await k.doubleTap('#field'); const ev2 = await k.te();
      check('道場の連続タップは 1 回目から touchend を止める（拡大しない）', ev2.length === 2 && ev2.every((x) => x.p), ev2);
      await k.w(400);
      const p0 = await pressed(page); await k.te(); await k.doubleTap('#soundBtn'); const ev3 = await k.te(); const p1 = await pressed(page);
      check('♪ の連続タップで2回切り替わり（元に戻る）、2回目の touchend は止めて click を補う', p0 === p1 && ev3[0]?.p === false && ev3[1]?.p === true, { p0, p1, ev3 });
      await k.w(400);
      await k.tapEl('#pauseBtn'); await k.w(150);
      const paused = /一時停止/.test(await cardH(page));
      await k.tapEl('#card [data-cmd=resume]'); await k.w(150);
      const resumed = (await kiriSnap(page)).state === 'play' && await hidden(page);
      await k.w(400);
      await k.tapEl('#menuBtn'); await k.w(150);
      const viaMenu = /一時停止/.test(await cardH(page));
      await k.tapEl('#card [data-cmd=menu]'); await page.waitForURL(BASE, { timeout: 3000 }).catch(() => {});
      check('II → 再開、← メニュー → 一時停止 →「メニューへ」でメニュー（すべてタップ）', paused && resumed && viaMenu && page.url() === BASE, { paused, resumed, viaMenu, url: page.url() });
      await k.ctx.close();
    },
  },
];
