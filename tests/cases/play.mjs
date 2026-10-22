// P: 遊べること（操作・0.8秒の待ち・クリア・演出）。端末は iPhone 13 ホーム画面の1種類（同値分割：操作の結果は画面サイズに依存しない）
import { BASE, T48, BLK, KIRI, view, newPage, seed, open2048, ST, stateOf, overlayShown, cardText, sleep, wait, touch, SFX_SPY, plays, fixedRandom, frozen, kiriSnap, kiriStart, kiriWaitObj, kiriSlash, kiriSwipe, kiriAutoplay } from '../lib.mjs';
const V = () => view('i13', 'p', 'app');
const NEAR_OVER = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 64, 64, 8, 16];
const NEAR_OVER2 = [128, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 64, 64, 8, 16];
const gridDom = (p) => p.evaluate(() => { const g = Array(16).fill(0); document.querySelectorAll('#board .tile').forEach((t) => { g[+t.dataset.cell] = +t.dataset.v; }); return g; });

// ---------- X-20：古いページから書き戻さない（bfcache から戻ったとき・裏にいる間に別のタブが書いたとき） ----------
// key：見張る保存のキー。newer：ほかのページが書いた新しい保存（生の文字）を2つ。fp(raw)：中身の印（同じ中身なら同じ文字）。
// (a) 変わっていなければ pageshow persisted でも開き直さない。(b) bfcache（入る → ほかで書く → pageshow persisted → pagehide）で
// 書き戻さず開き直し、開き直したページが新しい保存から続ける（もう一度 pagehide で書かせて印を比べる）。
// (c) 裏にいる間に同じ context の別のページが書く（本物の storage イベント）→ pagehide で書き戻さず、表に戻ると開き直す。
// (d) storage イベントが届かないまま閉じる（iOS は裏のタブを止めるので届くのが遅れる）：別のページが書いたのと同じことを、
// このページの中から直接書いて再現する（同じページの書き換えは storage イベントが出ない）。d1：裏にしたあとに書かれて pagehide、
// d2：見えている間に書かれて（イベントが届く前に）そのまま裏へ回る（hidden の保存）→ pagehide。どちらも書き戻さず、表に戻ると開き直す。
// newer は4つ（[0] b、[1] c、[2] d1、[3] d2）。hiddenWrite(page)：(c) で裏にいる間に、このページ自身の保存を1回起こす（storage を見て止まるか）
const x20Hidden = (p, h) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, h);
async function x20Run(page, ctx, { key, newer, fp, hiddenWrite = null }) {
  const loaded = () => page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
  const hideNow = () => page.evaluate((k) => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return localStorage.getItem(k); }, key);
  let nav = loaded();
  await page.evaluate(() => { window.__x20 = 1; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  const a = { reload: await nav, same: await page.evaluate(() => window.__x20 === 1) };
  nav = loaded();
  const b = { kept: await page.evaluate(([k, raw]) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    localStorage.setItem(k, raw);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return localStorage.getItem(k) === raw;
  }, [key, newer[0]]) };
  b.reload = await nav; await wait(page, 300);
  b.fp = fp(await hideNow()); b.want = fp(newer[0]);
  await x20Hidden(page, true); await wait(page, 50);
  const p2 = await ctx.newPage();
  await p2.goto(BASE + 'manifest.webmanifest');
  await p2.evaluate(([k, raw]) => localStorage.setItem(k, raw), [key, newer[1]]);
  await p2.close();
  await page.waitForTimeout(200);
  const c = {};
  if (hiddenWrite) { await hiddenWrite(page); c.keptWrite = (await page.evaluate((k) => localStorage.getItem(k), key)) === newer[1]; }
  c.kept = (await hideNow()) === newer[1];
  nav = loaded();
  await x20Hidden(page, false);
  c.reload = await nav; await wait(page, 300);
  c.fp = fp(await hideNow()); c.want = fp(newer[1]);
  // (d1) 裏にしたあと書かれ、storage イベントが届かないまま pagehide
  await x20Hidden(page, true); await wait(page, 50);
  const d1 = { kept: await page.evaluate(([k, raw]) => {
    localStorage.setItem(k, raw);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    return localStorage.getItem(k) === raw;
  }, [key, newer[2]]) };
  nav = loaded();
  await x20Hidden(page, false);
  d1.reload = await nav; await wait(page, 300);
  d1.fp = fp(await hideNow()); d1.want = fp(newer[2]);
  // (d2) 見えている間に書かれ、イベントが届く前に裏へ回る（hidden の保存）→ pagehide
  const d2 = { kept: await page.evaluate(([k, raw]) => {
    localStorage.setItem(k, raw);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hid = localStorage.getItem(k) === raw;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    return hid && localStorage.getItem(k) === raw;
  }, [key, newer[3]]) };
  nav = loaded();
  await x20Hidden(page, false);
  d2.reload = await nav; await wait(page, 300);
  d2.fp = fp(await hideNow()); d2.want = fp(newer[3]);
  const okD = (d) => d.kept && d.reload && d.fp === d.want;
  const ok = !a.reload && a.same && b.kept && b.reload && b.fp === b.want && (!hiddenWrite || c.keptWrite) && c.kept && c.reload && c.fp === c.want && okD(d1) && okD(d2);
  return { ok, a, b, c, d1, d2 };
}
const x20Text = (r) => `変わっていなければ開き直さない（${!r.a.reload && r.a.same}）・bfcache で書き戻さない（${r.b.kept}）・開き直す（${r.b.reload}）・新しい保存から続ける（${r.b.fp === r.b.want}）・裏で別のタブが書いたら閉じても書き戻さない（${r.c.kept}）${r.c.keptWrite === undefined ? '' : `・裏でこのページが保存しようとしても書かない（${r.c.keptWrite}）`}・表に戻ると開き直して（${r.c.reload}）続ける（${r.c.fp === r.c.want}）・storage イベントが届かないまま閉じても書き戻さない（裏のあと ${r.d1.kept}・hidden の保存 ${r.d2.kept}）・開き直して続ける（${r.d1.reload && r.d1.fp === r.d1.want}・${r.d2.reload && r.d2.fp === r.d2.want}）`;

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
      const { ctx, page } = await newPage(browser, V(), 'P5', { initScript: SFX_SPY, clock: true });
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
      const r = await newPage(browser, V(), 'P5 reduce', { reducedMotion: 'reduce', clock: true });
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
  {
    id: 'P8', tier: 'smoke', title: 'キリトリ道場：スワイプで的が切れて 1 点・割れる・軌跡が約 0.2 秒残る、止めた指では切れない、落とすとライフ −1、ライフ 0 で結果カード',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P8', { clock: true, initScript: SFX_SPY });
      await seed(page, {});
      await page.goto(KIRI); await wait(page, 150);
      await kiriStart(page);
      const f = await kiriWaitObj(page);
      check('始めると下から的が飛んでくる（道場の中に全体が見える）', !!f, f && f.s);
      // 指を的の上に置いただけ（動かさない）では切れない
      await kiriSwipe(page, (s) => { const o = s.objs[0]; return o && [[o.x, o.y]]; });
      const still = await kiriSnap(page);
      // 切って、軌跡の残り方を見る。ページの時間を止めたまま切り、そこから 0.1 秒・0.25 秒だけ進める（負荷で実時間が流れても変わらない）
      let s1, tr1, tr2;
      await frozen(page, async () => {
        const s = await kiriSnap(page);
        const o = s.objs.filter((x) => x.kind !== 'bomb').sort((a, b) => Math.hypot(a.x - f.o.x, a.y - f.o.y) - Math.hypot(b.x - f.o.x, b.y - f.o.y))[0];
        await page.mouse.move(o.x - o.r - 16, o.y + 2); await page.mouse.down();
        await page.mouse.move(o.x + o.r + 16, o.y - 2, { steps: 5 }); await page.mouse.up();
        s1 = await kiriSnap(page);
        await page.clock.runFor(100); tr1 = (await kiriSnap(page)).trail;
        await page.clock.runFor(150); tr2 = (await kiriSnap(page)).trail;
      });
      const ps = (await plays(page)).map((p) => p.n);
      check(`的の上で指を止めただけでは切れず（${still.score} 点）、横になぞると切れて 1 個 1 点（${s1.score} 点）・1 個が 2つに割れて破片が出る・slice の音`, still.score === 0 && s1.score >= 1 && s1.pieces === 2 * s1.score && s1.cutCount === s1.score && s1.bits > 0 && ps.includes('slice') && ps.includes('start'), { still: still.score, s1, ps });
      check(`切った軌跡は 0.1 秒後も残り（${tr1} 点）、0.25 秒後には消える（${tr2} 点）`, tr1 > 0 && tr2 === 0, { tr1, tr2 });
      // はじめの 10 秒は、的を落としても印が出るだけでライフは減らない（はじめて遊ぶ人が遊び方をつかむ前に終わらないように）
      let sg = s1;
      for (let i = 0; i < 100 && !(sg.marks > 0 && sg.elapsed < 10) && sg.elapsed < 9.5; i++) { await wait(page, 100); sg = await kiriSnap(page); }
      const missGrace = (await plays(page)).filter((p) => p.n === 'miss').length;
      check(`はじめの 10 秒（${sg.elapsed.toFixed(1)} 秒時点）は、的を落とすと印が出る（${sg.marks} 個）がライフは減らず（${sg.lives}）、miss の音も鳴らない（${missGrace}）、ヒントが出ている間は縁も光らない`, sg.marks > 0 && sg.lives === 3 && missGrace === 0 && !sg.edge && sg.state === 'play', sg);
      // その後は、次の的を切らずに落とす → ライフ −1、miss の音、縁が光る
      let s2 = sg;
      const miss0 = (await plays(page)).filter((p) => p.n === 'miss').length;
      let edgeSeen = false;
      for (let i = 0; i < 400 && s2.lives === 3; i++) { await wait(page, 100); s2 = await kiriSnap(page); edgeSeen = edgeSeen || s2.edge; }
      const missN = (await plays(page)).filter((p) => p.n === 'miss').length - miss0;
      check(`10 秒をすぎて的を切らずに下へ落とすと 1 個につきライフ −1（落とした ${missN} 個 → ライフ ${s2.lives}、${s2.elapsed.toFixed(1)} 秒時点）、miss の音、縁が赤く光る（${edgeSeen}）、ゲームは続く`, s2.elapsed >= 10 && s2.lives === 3 - missN && missN >= 1 && missN <= 2 && s2.state === 'play' && edgeSeen && (await plays(page)).some((p) => p.n === 'miss'), s2);
      for (let i = 0; i < 240 && (await kiriSnap(page)).state === 'play'; i++) await wait(page, 250);
      const over = await kiriSnap(page);
      const early = await overlayShown(page);
      await wait(page, 1000);
      const t = await cardText(page);
      check('ライフ 0 で終わり、最後の様子を少し見せてから結果カード（スコア・自己ベスト更新）、over の音', over.state === 'over' && over.lives === 0 && !early && /ゲームオーバー/.test(t) && /自己ベスト更新/.test(t) && /生きた時間 ?\d+秒/.test(t) && new RegExp(`SCORE ?${over.score}\\b`, 'i').test(t) && (await plays(page)).some((p) => p.n === 'over'), { t, early });
      await ctx.close();
    },
  },
  {
    id: 'P9', tier: 'full', title: 'キリトリ道場：ひと振りで 3 つ以上切るとコンボ加点、爆弾を切るとライフ −1（すぐには終わらない）、的は上〜中央を飛ぶ、動きを減らす設定',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('SE', 'p', 'app'), 'P9', { clock: true, initScript: SFX_SPY });   // 長く遊ぶので、描く面積の小さい SE で
      await ctx.addInitScript(fixedRandom);   // 出てくる的の順番を毎回同じにする（爆弾・3つ同時がいつ来るかを安定させる）
      await seed(page, {});
      await page.goto(KIRI); await wait(page, 150);
      await kiriStart(page);
      // 飛んでいる的の頂点の高さ（いまの位置・速さ・重力から y − vy²/2g）を記録（道場の上端からの割合）
      const apex = [];
      const note = (s) => { for (const o of s.objs) apex.push((o.y - (o.vy * o.vy) / (2 * o.g) - s.stage.y) / s.stage.h); };
      // 的が 3 つ以上同時に飛ぶまで切り続け（爆弾はよける）、3 つを 1 回のスワイプでなぞる
      const s0 = await kiriAutoplay(page, (s) => note(s) || s.objs.filter((o) => o.kind !== 'bomb' && o.y - o.r > s.stage.y && o.y + o.r < s.stage.y + s.stage.h).length >= 3 && s.objs.every((o) => o.kind !== 'bomb'), { maxMs: 120000, step: 300, lazy: true });
      const before = s0.score;
      const done = await kiriSwipe(page, (s) => {
        const ts = s.objs.filter((o) => o.kind !== 'bomb' && o.y - o.r > s.stage.y && o.y + o.r < s.stage.y + s.stage.h).sort((a, b) => a.x - b.x);
        if (ts.length < 3 || s.objs.some((o) => o.kind === 'bomb')) return null;
        return [[ts[0].x - ts[0].r - 10, ts[0].y], ...ts.map((o) => [o.x, o.y]), [ts.at(-1).x + ts.at(-1).r + 10, ts.at(-1).y]];
      }, 8);
      const s1 = await kiriSnap(page);
      const n = s1.cutCount - s0.cutCount;
      const comboPlays = (await plays(page)).filter((p) => p.n === 'combo');
      check(`ひと振りで ${n} 個切ると ${n} 点＋コンボ加点 ${2 * n - 3}（${before}→${s1.score}）、最大コンボ ${s1.maxCombo}、combo の音`, done && n >= 3 && s1.score - before === n + 2 * n - 3 && s1.maxCombo === n && comboPlays.some((p) => p.a === n), { done, n, before, after: s1.score, s0: s0.objs.length });
      // 爆弾が来るまで切り続け、爆弾を切る → ライフ −1、点は増えない、ゲームは続く
      const s2 = await kiriAutoplay(page, (s) => note(s) || s.objs.some((o) => o.kind === 'bomb' && o.y - o.r > s.stage.y && o.y + o.r < s.stage.y + s.stage.h) && s.lives >= 2, { maxMs: 120000, step: 200 });
      const bomb = s2.objs.find((o) => o.kind === 'bomb');
      if (bomb) await kiriSwipe(page, (s) => { const b = s.objs.filter((o) => o.kind === 'bomb').sort((a, c) => Math.hypot(a.x - bomb.x, a.y - bomb.y) - Math.hypot(c.x - bomb.x, c.y - bomb.y))[0]; return b && [[b.x, b.y - b.r - 4], [b.x, b.y + b.r + 4]]; }, 3);
      const s3 = await kiriSnap(page);
      check(`爆弾を切るとライフ −1（${s2.lives}→${s3.lives}）、爆弾は点にならず（増えたのは一緒に切った的の分だけ）、すぐには終わらない（家族向け）、bomb の音`, !!bomb && s3.lives === s2.lives - 1 && s3.score - s2.score === s3.cutCount - s2.cutCount && s3.state === 'play' && (await plays(page)).some((p) => p.n === 'bomb'), { bomb: !!bomb, s2: { l: s2.lives, sc: s2.score, c: s2.cutCount }, s3: { l: s3.lives, sc: s3.score, c: s3.cutCount, st: s3.state } });
      const ap = apex;
      check(`的の頂点はすべて道場の上端から 12〜45%（上〜中央。${ap.length} 回、${Math.round(Math.min(...ap) * 100)}〜${Math.round(Math.max(...ap) * 100)}%）`, ap.length >= 5 && ap.every((y) => y >= 0.115 && y <= 0.455), { max: Math.max(...ap), n: ap.length });
      await ctx.close();
      // 動きを減らす設定：割れはするが破片は出ず、軌跡の光（影）なし
      const r = await newPage(browser, V(), 'P9 reduce', { clock: true, reducedMotion: 'reduce' });
      await seed(r.page, {});
      await r.page.goto(KIRI); await wait(r.page, 150); await kiriStart(r.page);
      const f = await kiriWaitObj(r.page);
      if (f) await kiriSlash(r.page, f.o);
      const rs = await kiriSnap(r.page);
      check('動きを減らす設定：切れて 1 点・2つに割れるが、破片は出さない', !!f && rs.score === 1 && rs.pieces === 2 && rs.bits === 0, rs);
      await r.ctx.close();
    },
  },
  {
    id: 'P10', tier: 'full', title: 'ばいばいタイル 古いページから書き戻さない（X-20）：bfcache から戻ったとき・裏にいる間に別のタブが tile2048.state を書いたとき、古い盤を書き戻さず開き直して今の保存から続ける。変わっていなければ開き直さない。storage イベントが届かないまま閉じても（裏にしたあとに書かれて pagehide・見えている間に書かれてそのまま hidden の保存）書き戻さず、表に戻ると開き直す',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'P10', { clock: true });
      await open2048(page, ST([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4], { score: 100 }));
      const mk = (score, t) => JSON.stringify(ST([t, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score }));
      const fp = (raw) => { try { const s = JSON.parse(raw); return `${s.score}:${JSON.stringify(s.grid)}`; } catch { return 'ERR'; } };
      const r = await x20Run(page, ctx, { key: 'tile2048.state', newer: [mk(4444, 8), mk(5555, 16), mk(6666, 32), mk(7777, 64)], fp,
        // 裏で別のタブが書いたあと、このページで1手動いても（saveState）書かない（storage を見て止まる）
        hiddenWrite: (p) => p.keyboard.press('ArrowLeft') });
      check(`ばいばいタイル：${x20Text(r)}`, r.ok, r);
      await ctx.close();
    },
  },
];
