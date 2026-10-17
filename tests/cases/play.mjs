// P: 遊べること（操作・0.8秒の待ち・クリア・演出）。端末は iPhone 13 ホーム画面の1種類（同値分割：操作の結果は画面サイズに依存しない）
import { BASE, T48, BLK, view, newPage, seed, open2048, ST, stateOf, overlayShown, cardText, sleep, wait, touch, SFX_SPY, plays } from '../lib.mjs';
const V = () => view('i13', 'p', 'app');
const NEAR_OVER = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 64, 64, 8, 16];
const NEAR_OVER2 = [128, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 64, 64, 8, 16];
const gridDom = (p) => p.evaluate(() => { const g = Array(16).fill(0); document.querySelectorAll('#board .tile').forEach((t) => { g[+t.dataset.cell] = +t.dataset.v; }); return g; });

export const tests = [
  {
    id: 'P1', tier: 'smoke', title: '基本操作：2048 のキー（矢印・WASD）、ブロックの画面ボタン',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P1', { clock: true });
      await open2048(page, ST([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0], { score: 0 }));
      let changed = 0;
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'a', 'w', 'd', 's']) { const x = await gridDom(page); await page.keyboard.press(k); await wait(page, 130); if (JSON.stringify(await gridDom(page)) !== JSON.stringify(x)) changed++; }
      check(`キーボード（矢印・WASD）で動く（${changed}/7 手で変化）`, changed >= 4);
      await seed(page, {});
      await page.goto(BLK); await wait(page, 120); await page.click('#card [data-cmd=restart]'); await wait(page, 100);
      const drop = page.locator('[data-action=drop]');
      for (let i = 0; i < 3; i++) { await drop.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true }); await drop.dispatchEvent('pointerup', { pointerId: 1 }); await wait(page, 100); }
      const sc = await page.evaluate(() => Number(document.querySelector('#score').textContent.replace(/,/g, '')));
      check('ブロック：画面の DROP ボタンで落とせる（得点が増える）', sc > 0, sc);
      await ctx.close();
    },
  },
  {
    id: 'P7', tier: 'smoke', cdp: 'CDP のタッチ操作（スワイプ）', title: '2048 のスワイプ（24px の境界：20px では動かず 30px で動く）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P7');
      const t = await touch(ctx, page);
      const swipe = async (x0, y0, dx, dy) => { await t.swipe(x0, y0, dx, dy, 5, 0); await wait(page, 160); };
      // 左右どちらにも動ける盤面
      await open2048(page, ST([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0], { score: 0 }));
      const b = await page.locator('#board').boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const g0 = await gridDom(page);
      await swipe(cx, cy, -20, 0); await swipe(cx, cy, 0, -20);
      const g1 = await gridDom(page);
      check('20px（閾値 24px 未満）のスワイプでは動かない', JSON.stringify(g0) === JSON.stringify(g1));
      await swipe(cx, cy, -30, 0);
      const g2 = await gridDom(page);
      check('30px（閾値以上）のスワイプで動く', JSON.stringify(g2) !== JSON.stringify(g1));
      await ctx.close();
    },
  },
  {
    id: 'P2', tier: 'full', title: '詰んでから結果カードまでの 0.8 秒（前後の境界）と待ち中の入力',
    async run({ browser, check }) {
      // 前半の 0.8 秒の境界は実時間で確かめる（早送りしない）
      let { ctx, page } = await newPage(browser, V(), 'P2');
      await open2048(page, ST(NEAR_OVER));
      await page.evaluate(() => { window.__shownAt = 0; new MutationObserver(() => { if (!document.querySelector('#overlay').hidden && !window.__shownAt) window.__shownAt = performance.now(); }).observe(document.querySelector('#overlay'), { attributes: true }); });
      const t0 = await page.evaluate(() => performance.now());
      await page.keyboard.press('ArrowLeft'); await wait(page, 450);
      const mid = await page.evaluate(() => ({ hidden: document.querySelector('#overlay').hidden, tiles: document.querySelectorAll('#board .tile').length, undoOff: document.querySelector('#undoBtn').disabled }));
      // 868b9e4 で、待ち中も上の「1手戻す」を有効にした（押すとカードを出さずに戻す＝U キーと同じ）
      check('境界の手前：詰んで 0.45 秒後はカードなし・最後の盤面(16枚)が見え、上の「1手戻す」は押せる', mid.hidden && mid.tiles === 16 && !mid.undoOff, mid);
      await wait(page, 900);
      const dt = await page.evaluate((t0) => window.__shownAt - t0, t0);
      check(`境界の後：キー入力から ${Math.round(dt)}ms でカード（移動100ms＋待ち800ms → 800〜1250ms）`, dt >= 800 && dt <= 1250, dt);
      const t = await cardText(page);
      const b = await page.evaluate(() => [...document.querySelectorAll('#card .row button')].map((x) => x.textContent + (x.classList.contains('primary') ? '*' : '')));
      // 868b9e4 で配置を 1段目［もう一度］、2段目［1手戻す］［メニューへ］に変更
      check('カードに「最大タイル 128 ／ 次は 256」、ボタン [もう一度*] / [1手戻す][メニューへ]', /最大タイル 128 ／ 次は 256/.test(t) && JSON.stringify(b) === JSON.stringify(['もう一度*', '1手戻す', 'メニューへ']), { t, b });
      await page.click('#card [data-cmd=undo]'); await wait(page, 150);
      check('カードの「1手戻す」で詰む前に戻り、別の方向で続行できる', !(await overlayShown(page)) && JSON.stringify((await stateOf(page)).grid) === JSON.stringify(NEAR_OVER) && await (async () => { await page.keyboard.press('ArrowRight'); await wait(page, 150); return !(await overlayShown(page)); })());
      // 後半（待ち中の入力）は待ち時間を早送りする（タイマーの順序はそのまま、待ち時間だけ短くなる）
      await ctx.close();
      ({ ctx, page } = await newPage(browser, V(), 'P2 clock', { clock: true }));
      // 待ち中のタップ → すぐ出る。そのタップでカードのボタンは押されない
      await open2048(page, ST(NEAR_OVER2));
      await page.keyboard.press('ArrowLeft'); await wait(page, 250);
      const bb = await page.locator('#board').boundingBox();
      const pre = await stateOf(page);
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height * 0.85); await wait(page, 60);
      const tap = { shown: await overlayShown(page), st: await stateOf(page) };
      await wait(page, 300);
      const t2 = await cardText(page);
      check('待ち中のタップでカードがすぐ出て、同じタップでボタンは作動しない', tap.shown && tap.st.moves === pre.moves && /ゲームオーバー/.test(t2), { shown: tap.shown });
      check('最大が2枚なら「あと1回の合体で 256」', /最大タイル 128 ／ あと1回の合体で 256/.test(t2), t2);
      await page.reload(); await wait(page, 200);
      check('結果カードのまま再読み込みしても「1手戻す」が押せる', await page.evaluate(() => !document.querySelector('#card [data-cmd=undo]')?.disabled));
      // 待ち中に上の「1手戻す」を押す → カードを出さずに戻す
      await open2048(page, ST(NEAR_OVER)); await page.keyboard.press('ArrowLeft'); await wait(page, 300);
      await page.locator('#undoBtn').tap(); await wait(page, 1000);
      const ub = { ov: await overlayShown(page), m: (await stateOf(page)).moves };
      check('待ち中に上の「1手戻す」をタップ → 1手戻り、結果カードは出ない', !ub.ov && ub.m === 30, ub);
      // 待ち中の U は戻す（カードは後から出ない）、矢印はカードを即時表示
      await open2048(page, ST(NEAR_OVER)); await page.keyboard.press('ArrowLeft'); await wait(page, 300); await page.keyboard.press('u'); await wait(page, 1000);
      const u = { ov: await overlayShown(page), m: (await stateOf(page)).moves };
      await open2048(page, ST(NEAR_OVER)); await page.keyboard.press('ArrowLeft'); await wait(page, 20); await page.keyboard.press('u'); await wait(page, 1100);
      const u2 = { ov: await overlayShown(page), m: (await stateOf(page)).moves };
      await open2048(page, ST(NEAR_OVER)); await page.keyboard.press('ArrowLeft'); await wait(page, 200); await page.keyboard.press('ArrowUp'); await wait(page, 50);
      const ar = await overlayShown(page);
      check('待ち中(0.3秒)・アニメ中(0.02秒)の U は1手戻してカードを出さない、矢印はカードを即時表示', !u.ov && u.m === 30 && !u2.ov && u2.m === 30 && ar, { u, u2, ar });
      await open2048(page, ST([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]));
      check('戻せる手がない結果カードでは「1手戻す」は無効', await page.evaluate(() => document.querySelector('#card [data-cmd=undo]').disabled));
      await page.click('#card [data-cmd=restart]'); await wait(page, 200);
      const f = await stateOf(page);
      check('「もう一度」で新しい盤面（2枚・0点）', f.grid.filter(Boolean).length === 2 && f.score === 0 && !(await overlayShown(page)), f);
      await ctx.close();
    },
  },
  {
    id: 'P3', tier: 'full', title: '2048 クリア：「続ける」で再表示されない、クリアと詰みが同時なら続けた後にゲームオーバー',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P3', { clock: true });
      await open2048(page, ST([1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], { score: 20000 }));
      await page.keyboard.press('ArrowLeft'); await wait(page, 300);
      const w = await cardText(page);
      await page.click('#card [data-cmd=continue]'); await wait(page, 100);
      const hid = !(await overlayShown(page));
      await page.keyboard.press('ArrowRight'); await wait(page, 300);
      check('2048 で「クリア！」→「続ける」で再開し、次の手で再表示されない', /クリア/.test(w) && hid && !(await overlayShown(page)), w);
      // 左で 2048 ができ、空いた1マスに 2 でも 4 でも出現後に詰む盤面
      await open2048(page, ST([1024, 1024, 8, 16, 4, 2, 4, 8, 2, 4, 2, 4, 4, 2, 4, 2], { score: 20000 }));
      await page.keyboard.press('ArrowLeft'); await wait(page, 300);
      const w2 = await cardText(page);
      await page.click('#card [data-cmd=continue]'); await wait(page, 1200);
      const o2 = await cardText(page);
      check('クリアと詰みが同時 →「続ける」の後にゲームオーバーが出る（閉じ込められない）', /クリア/.test(w2) && /ゲームオーバー/.test(o2), { w2, o2 });
      await ctx.close();
    },
  },
  {
    id: 'P4', tier: 'full', title: '連打・アニメ中の入力で表示と保存がずれない、1手戻すは1回だけ',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P4', { clock: true });
      await open2048(page, undefined);
      for (let i = 0; i < 60; i++) { await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4]); if (i % 7 === 0) await page.keyboard.press('u'); }
      await wait(page, 450);
      const r = await page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('tile2048.state'));
        const dom = Array(16).fill(0); let dup = 0;
        document.querySelectorAll('#board .tile').forEach((e) => { const i = +e.dataset.cell; if (dom[i]) dup++; dom[i] = Number(e.textContent); });
        return { match: JSON.stringify(dom) === JSON.stringify(st.grid), dup, score: document.querySelector('#score').textContent === st.score.toLocaleString('en-US') };
      });
      check('60回の連打（途中で U）後も、画面の盤面・スコア表示＝保存データ、重複タイルなし', r.match && r.dup === 0 && r.score, r);
      const s0 = await stateOf(page);
      let moved = false;
      for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) { await page.keyboard.press(k); await wait(page, 130); if ((await stateOf(page)).moves !== s0.moves) { moved = true; break; } }
      await page.click('#undoBtn'); await wait(page, 100);
      const s1 = await stateOf(page);
      const off = await page.evaluate(() => document.querySelector('#undoBtn').disabled);
      check('「1手戻す」で直前に戻り、続けては戻せない（ボタン無効）', moved && JSON.stringify(s1.grid) === JSON.stringify(s0.grid) && s1.score === s0.score && off, { moved, off });
      await ctx.close();
    },
  },
  {
    id: 'P5', tier: 'full', title: '手応えの演出（+N・カウントアップ・ベスト超えの光は1回・128 の特別な音）と動きを減らす設定',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P5', { initScript: SFX_SPY }, { clock: true });
      await open2048(page, ST([512, 512, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 0 }), { 'tile2048.best': '999999' });
      await page.evaluate(() => { window.__vals = []; const el = document.querySelector('#score'); new MutationObserver(() => window.__vals.push([performance.now(), el.textContent])).observe(el, { childList: true, characterData: true, subtree: true }); });
      await page.keyboard.press('ArrowLeft'); await wait(page, 40);
      const gain = await page.evaluate(() => { const g = document.querySelector('#board .gain'); return g && g.textContent; });
      await wait(page, 500);
      const vals = await page.evaluate(() => window.__vals);
      const nums = vals.map((v) => Number(v[1].replace(/,/g, ''))), span = vals.length ? vals[vals.length - 1][0] - vals[0][0] : 0;
      check(`合体で「+1,024」、スコアは約200msでカウントアップ（${Math.round(span)}ms）`, gain === '+1,024' && nums[nums.length - 1] === 1024 && nums.some((n) => n > 0 && n < 1024) && span >= 100 && span <= 320, { gain, nums });
      const watchFlash = () => page.evaluate(() => { window.__flash = 0; const box = document.querySelector('#best').parentElement; new MutationObserver(() => { if (box.classList.contains('flash')) window.__flash++; }).observe(box, { attributes: true, attributeFilter: ['class'] }); });
      await open2048(page, ST([2, 2, 4, 4, 8, 8, 16, 16, 2, 2, 4, 4, 0, 0, 0, 0], { score: 10 }), { 'tile2048.best': '15' });
      await watchFlash();
      for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) { await page.keyboard.press(k); await wait(page, 170); }
      const n1 = await page.evaluate(() => window.__flash);
      await page.reload(); await wait(page, 200); await watchFlash();
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { await page.keyboard.press(k); await wait(page, 140); }
      const n2 = await page.evaluate(() => window.__flash);
      check(`ベストを超えた瞬間に BEST 欄が1回だけ光り（${n1}回）、同じゲームを再開しても光らない（${n2}回）`, n1 === 1 && n2 === 0);
      await open2048(page, ST([64, 64, 0, 0, 64, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 0 }));
      // 効果音（案A）で音の作りが変わったため、部品の数ではなく鳴らした音の名前で確かめる
      const n0 = (await plays(page)).length;
      await page.keyboard.press('ArrowLeft'); await wait(page, 200); const p1 = (await plays(page)).slice(n0).map((x) => x.n + (x.a ? ':' + x.a : ''));
      await page.keyboard.press('ArrowRight'); await wait(page, 200); const p2 = (await plays(page)).slice(n0 + p1.length).map((x) => x.n + (x.a ? ':' + x.a : ''));
      check(`初めて 128 に届いた手だけ特別な音（1手目 [${p1}]、次の手 [${p2}]）`, p1.includes('milestone:128') && !p2.some((x) => x.startsWith('milestone')) && p2.length >= 1, { p1, p2 });
      await ctx.close();
      const r = await newPage(browser, V(), 'P5 reduce', { reducedMotion: 'reduce' }, { clock: true });
      await open2048(r.page, ST([512, 512, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 0 }), { 'tile2048.best': '100' });
      await r.page.evaluate(() => { window.__flash = 0; const box = document.querySelector('#best').parentElement; new MutationObserver(() => { if (box.classList.contains('flash')) window.__flash++; }).observe(box, { attributes: true, attributeFilter: ['class'] }); });
      await r.page.keyboard.press('ArrowLeft');
      const imm = await r.page.evaluate(() => ({ s: document.querySelector('#score').textContent, gain: !!document.querySelector('#board .gain') }));
      await wait(r.page, 250);
      const fl = await r.page.evaluate(() => ({ n: window.__flash, anim: [...document.querySelectorAll('.tile-in')].map((e) => getComputedStyle(e).animationName).filter((a) => a !== 'none').length, tr: getComputedStyle(document.querySelector('#board .tile')).transitionDuration }));
      check('動きを減らす設定：スコアは即時、「+N」・光り・タイルの動きなし', imm.s === '1,028' && !imm.gain && fl.n === 0 && fl.anim === 0 && fl.tr === '0s', { imm, fl });
      await r.ctx.close();
    },
  },
];
