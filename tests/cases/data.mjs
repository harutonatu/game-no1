// D: データが消えない・保存データの互換性（リスク最重要）。画面サイズは iPhone 13 ホーム画面の1種類だけで確かめる
import { BASE, T48, BLK, view, newPage, seed, open2048, ST, stateOf, cardText, blocksPlay, fixedRandom, sleep, wait } from '../lib.mjs';
const V = () => view('i13', 'p', 'app');
const G0 = [2, 0, 0, 2, 0, 4, 0, 0, 0, 0, 8, 0, 2, 0, 0, 0];
const NEAR_OVER = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 64, 64, 8, 16];   // 左で 128 ができて詰む
const g16 = (v) => [v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4];

export const tests = [
  {
    id: 'D1', tier: 'smoke', title: '2048 の途中経過が再読み込みで消えない（盤面・スコア・種・1手戻す）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D1', { clock: true });
      await open2048(page, ST(G0, { score: 40, seed: 777 }));
      for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) { await page.keyboard.press(k); await wait(page, 130); }
      await wait(page, 250); // スコアのカウントアップ（約200ms）を待つ
      const pre = await stateOf(page);
      const preShown = await page.evaluate(() => document.querySelector('#score').textContent);
      await page.reload(); await wait(page, 250);
      const post = await stateOf(page);
      const dom = await page.evaluate(() => { const g = Array(16).fill(0); document.querySelectorAll('#board .tile').forEach((t) => { g[+t.dataset.cell] = +t.dataset.v; }); return { g, score: document.querySelector('#score').textContent, undo: !document.querySelector('#undoBtn').disabled }; });
      check('再読み込み後、盤面・スコア・種・手数が保存どおり', JSON.stringify(pre.grid) === JSON.stringify(post.grid) && pre.score === post.score && pre.seed === post.seed && pre.moves === post.moves, { pre, post });
      check('画面の盤面とスコア表示が保存データと一致', JSON.stringify(dom.g) === JSON.stringify(post.grid) && dom.score === preShown, { dom, preShown });
      check('再読み込み後も「1手戻す」が使え、直前の盤面に戻る', dom.undo && await (async () => { await page.click('#undoBtn'); await wait(page, 120); const s = await stateOf(page); return JSON.stringify(s.grid) === JSON.stringify(pre.prev.grid) && s.score === pre.prev.score; })());
      await ctx.close();
    },
  },
  {
    id: 'D2', tier: 'smoke', title: '壊れた・改ざんされた保存データ → エラーなく新しいゲーム（同値クラスごとに代表1つ＋境界）',
    async run({ browser, check, tier, errors }) {
      const { ctx, page } = await newPage(browser, V(), 'D2', { clock: true });
      // 無効の同値クラス（各1つ）。smoke は ★ の4つだけ
      const BAD = [
        ['★JSON でない文字列', 'not json {'],
        ['★タイルが2のべきでない(3)', ST(g16(3))],
        ['★スコアが負(-500)', ST(G0, { score: -500 })],
        ['★prev のタイルが不正', ST(G0, { prev: { grid: g16(5), score: 0 } })],
        ['タイルが上限超え(2^21)：境界', ST(g16(2 ** 21))],
        ['タイルが大きすぎ(3·2^32)', ST(g16(3 * 2 ** 32))],
        ['タイルが負(-2)', ST(g16(-2))],
        ['タイルが文字列"2"', ST(g16('2'))],
        ['スコアが文字列"Infinity"', ST(G0, { score: 'Infinity' })],
        ['スコアが小数(1.5)', ST(G0, { score: 1.5 })],
        ['スコアが 2^53：境界', ST(G0, { score: 2 ** 53 })],
        ['prev のスコアが -1', ST(G0, { prev: { grid: G0, score: -1 } })],
        ['種が文字列', ST(G0, { seed: 'abc' })],
        ['種が負(-5)', ST(G0, { seed: -5 })],
        ['盤面が全部空き', ST(Array(16).fill(0))],
        ['grid が文字列', ST('hello')],
        ['数値だけ', '12345'],
        ['HTML 片', '<img src=x onerror=alert(1)>'],
        ['v が 2（未知の版）', ST(G0, { v: 2 })],
      ].filter(([n]) => tier === 'full' || n.startsWith('★'));
      const fails = [];
      for (const [label, st] of BAD) {
        const before = errors.length;
        await open2048(page, st, { 'tile2048.best': '50' });
        const r = await page.evaluate(() => ({ tiles: document.querySelectorAll('#board .tile').length, score: document.querySelector('#score').textContent, ov: !document.querySelector('#overlay').hidden, st: JSON.parse(localStorage.getItem('tile2048.state')), imgs: document.querySelectorAll('img').length }));
        if (!(r.tiles === 2 && r.score === '0' && !r.ov && r.st.score === 0 && r.st.grid.filter(Boolean).length === 2 && errors.length === before && r.imgs === 0)) fails.push({ label, r });
      }
      check(`無効データ ${BAD.length} 種 → 新しいゲーム・エラーなし`, fails.length === 0, fails);
      if (tier === 'full') {
        // 受け入れ側の境界：2^20 のタイル、2^53-1 のスコアは有効
        await open2048(page, ST(g16(2 ** 20), { score: 2 ** 53 - 1, keepPlaying: true }));
        const s = await stateOf(page);
        check('有効の境界（タイル 2^20・スコア 2^53-1）は捨てずに再開', s.grid[0] === 2 ** 20 && s.score === 2 ** 53 - 1, s);
      }
      await ctx.close();
    },
  },
  {
    id: 'D3', tier: 'full', title: '不正なベスト値は 0 扱い、正しい値は3画面（2048・ブロック・メニュー）で同じに表示',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D3', { clock: true });
      const fails = [];
      for (const bad of ['Infinity', '-500', 'abc', '1.5', String(2 ** 53), '1e400']) {
        await open2048(page, undefined, { 'tile2048.best': bad, 'blockpuzzle.best': bad });
        const b1 = await page.evaluate(() => document.querySelector('#best').textContent);
        await page.goto(BLK); const b2 = await page.evaluate(() => document.querySelector('#best').textContent);
        await page.goto(BASE); const b3 = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
        if (!(b1 === '0' && b2 === '0' && b3.every((x) => x === 'まだ記録なし'))) fails.push({ bad, b1, b2, b3 });
      }
      check('不正なベスト 6 種（∞・負・文字・小数・2^53・1e400）→ 0／まだ記録なし', fails.length === 0, fails);
      const big = 2 ** 53 - 1;
      await open2048(page, undefined, { 'tile2048.best': String(big), 'blockpuzzle.best': '777' });
      const a = await page.evaluate(() => document.querySelector('#best').textContent);
      await page.goto(BASE); const m = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      check('有効の境界 2^53-1 と通常値 777 はそのまま表示', a === big.toLocaleString('en-US') && m[0] === '777' && m[1] === big.toLocaleString('en-US'), { a, m });
      await ctx.close();
    },
  },
  {
    id: 'D4', tier: 'smoke', title: '旧版の保存データとの互換（種なし state・旧キー blockpuzzle.best・効果音設定）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D4', { clock: true });
      // fix1 以前の形式：seed / topTile / bestFlashed がなく、prev にも seed がない
      await open2048(page, { v: 1, grid: G0, score: 40, prev: { grid: g16(2), score: 0 }, keepPlaying: false, moves: 3 });
      const s1 = await stateOf(page);
      const shown = await page.evaluate(() => document.querySelectorAll('#board .tile').length);
      await page.keyboard.press('ArrowLeft'); await wait(page, 150);
      const s2 = await stateOf(page);
      check('旧形式を読み、種を補って続行できる（盤面5枚・スコア40・手数+1）', shown === 5 && Number.isInteger(s1.seed) && s1.score === 40 && s2.moves === 4, { s1, s2 });
      await page.click('#undoBtn'); await wait(page, 120);
      const s3 = await stateOf(page);
      check('旧形式から続行後の「1手戻す」も元の盤面・種に戻る', JSON.stringify(s3.grid) === JSON.stringify(G0) && s3.seed === s1.seed, s3);
      // ゲーム集になる前（ブロックパズル単体）のベストのキーをメニューが読む。0 は「まだ記録なし」
      await seed(page, { 'blockpuzzle.best': '12345', 'tile2048.best': '0', 'blockpuzzle.sound': 'off' });
      await page.goto(BASE);
      const best = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      check('旧キー blockpuzzle.best=12345 → メニューに 12,345、0 は「まだ記録なし」', best[0] === '12,345' && best[1] === 'まだ記録なし', best);
      await page.goto(T48);
      const snd = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.goto(BLK);
      const snd2 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      check('共通の効果音設定（blockpuzzle.sound=off）が両ゲームで効く', snd === 'false' && snd2 === 'false', { snd, snd2 });
      await ctx.close();
    },
  },
  {
    id: 'D5', tier: 'smoke', title: 'ブロックパズルのベストが消えない（メニューへ・ページ離脱・やり直し・裏へ回す、低い得点では上書きしない）',
    async run({ browser, check, tier }) {
      const { ctx, page } = await newPage(browser, V(), 'D5', { clock: true });
      await seed(page, {});
      let sc = await blocksPlay(page, 4);
      await page.click('#pauseBtn'); await wait(page, 80);
      const note = await page.evaluate(() => document.querySelector('#card p').textContent);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      const menu = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      check(`一時停止→メニューへ でベスト ${sc} を保存しメニューに表示（注記あり）`, sc > 0 && menu[0] === sc.toLocaleString('en-US') && /ベストは記録されます/.test(note), { sc, menu, note });
      await seed(page, { 'blockpuzzle.best': '5' });
      sc = await blocksPlay(page, 4);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
      check(`pagehide でベスト保存 (${sc})`, await page.evaluate(() => localStorage.getItem('blockpuzzle.best')) === String(sc));
      // 境界：既存ベストより低い得点では上書きしない（score > best のときだけ保存）
      await seed(page, { 'blockpuzzle.best': '999999' });
      await blocksPlay(page, 4);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
      await page.click('#pauseBtn'); await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('既存ベスト(999999)より低い得点では上書きしない', await page.evaluate(() => localStorage.getItem('blockpuzzle.best')) === '999999');
      if (tier === 'full') {
        await seed(page, { 'blockpuzzle.best': '5' });
        sc = await blocksPlay(page, 4);
        await page.goto('about:blank');
        const p2 = await ctx.newPage(); await p2.goto(BASE);
        check(`実際にページを離れても（タブ移動）ベスト保存 (${sc})`, await p2.evaluate(() => localStorage.getItem('blockpuzzle.best')) === String(sc));
        await p2.close();
        await seed(page, { 'blockpuzzle.best': '5' });
        sc = await blocksPlay(page, 4);
        await page.click('#pauseBtn'); await page.click('#card [data-cmd=askRestart]'); await page.click('#card [data-cmd=restart]'); await wait(page, 80);
        const r = await page.evaluate(() => ({ s: localStorage.getItem('blockpuzzle.best'), shown: document.querySelector('#best').textContent }));
        check(`やり直しでもベスト保存・表示 (${sc})`, r.s === String(sc) && r.shown === sc.toLocaleString('en-US'), r);
        await seed(page, { 'blockpuzzle.best': '5' });
        sc = await blocksPlay(page, 4);
        await page.click('#pauseBtn'); await page.click('#card [data-cmd=askRestart]');
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
        const v = await page.evaluate(() => ({ s: localStorage.getItem('blockpuzzle.best'), h: document.querySelector('#card h1')?.textContent }));
        check(`確認画面中にアプリを裏へ回す（visibilitychange）→ ベスト保存、確認画面のまま (${sc})`, v.s === String(sc) && v.h === 'やり直す？', v);
      }
      await ctx.close();
    },
  },
  {
    id: 'D6', tier: 'full', title: 'localStorage が使えない環境（プライベートモード等）でも3画面が動く',
    async run({ browser, check, errors }) {
      const before = errors.length;
      const { ctx, page } = await newPage(browser, V(), 'D6', { initScript: () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError', { clock: true }); } }); } });
      await page.goto(BASE);
      const cards = await page.evaluate(() => document.querySelectorAll('a.game').length);
      await page.goto(T48); await wait(page, 150);
      for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) await page.keyboard.press(k);
      await wait(page, 200);
      const tiles = await page.evaluate(() => document.querySelectorAll('#board .tile').length);
      await page.goto(BLK); await wait(page, 150);
      await page.click('#card [data-cmd=restart]'); await page.keyboard.press('Space'); await wait(page, 80);
      const sc = await page.evaluate(() => Number(document.querySelector('#score').textContent.replace(/,/g, '')));
      check('メニュー表示・2048 で手が進む・ブロックで得点、ページエラーなし', cards === 2 && tiles >= 2 && sc > 0 && errors.length === before, { cards, tiles, sc, errs: errors.slice(before) });
      await ctx.close();
    },
  },
  {
    id: 'D7', tier: 'full', title: '「自己ベスト更新！」の境界（同点は更新でない、1点上なら更新）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D7', { initScript: fixedRandom }, { clock: true });
      // 2048：1000 + 128 = 1128 で詰む
      await open2048(page, ST(NEAR_OVER, { score: 1000 }), { 'tile2048.best': '1128' });
      await page.keyboard.press('ArrowLeft'); await wait(page, 1150);
      let t = await cardText(page);
      check('2048：過去のベストと同点(1128)では「自己ベスト更新！」を出さない', /ゲームオーバー/.test(t) && !/自己ベスト更新/.test(t) && /ベスト 1,128/.test(t), t);
      await open2048(page, ST(NEAR_OVER, { score: 1000 }), { 'tile2048.best': '1127' });
      await page.keyboard.press('ArrowLeft'); await wait(page, 1150);
      t = await cardText(page);
      check('2048：1点上回れば「自己ベスト更新！」', /自己ベスト更新/.test(t), t);
      // ブロック：乱数固定で同じ得点になるゲームを、ベスト=同点 と ベスト=1点下 で終わらせる
      const play = async (best) => {
        await seed(page, { 'blockpuzzle.best': String(best) });
        await page.goto(BLK); await wait(page, 120);
        await page.click('#card [data-cmd=restart]');
        for (let i = 0; i < 90; i++) { await page.keyboard.press('Space'); if (await page.evaluate(() => document.querySelector('#card h1')?.textContent === 'ゲームオーバー' && !document.querySelector('#overlay').hidden)) break; }
        return page.evaluate(() => ({ text: document.querySelector('#card').innerText.replace(/\s+/g, ' '), best: localStorage.getItem('blockpuzzle.best') }));
      };
      const r0 = await play(0);
      const s = Number((r0.text.match(/SCORE ?([\d,]+)/i) || [0, '0'])[1].replace(/,/g, ''));
      const tie = await play(s), above = await play(s - 1);
      const sameScore = (x) => (x.text.match(/SCORE ?([\d,]+)/i) || [0, ''])[1] === s.toLocaleString('en-US');
      check(`ブロック：同点(${s})では更新表示なし、1点下のベストなら更新表示`, s > 0 && sameScore(tie) && sameScore(above) && !/自己ベスト更新/.test(tie.text) && /自己ベスト更新/.test(above.text) && tie.best === String(s), { s, tie, above });
      await ctx.close();
    },
  },
  {
    id: 'D8', tier: 'full', title: '1手戻すと出目固定（同じ手→同じ出目、種の保存・前進、新しいゲームは別の種）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D8', { clock: true });
      await open2048(page, ST(G0, { score: 40, seed: 987654321 }));
      const res = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowLeft'); await wait(page, 130);
        res.push(JSON.stringify((await stateOf(page)).grid));
        await page.click('#undoBtn'); await wait(page, 80);
      }
      const back = await stateOf(page);
      check('「左→戻す」を4回、出現結果が毎回同じ', new Set(res).size === 1, res);
      check('戻すと盤面・スコア・種も元に戻る', JSON.stringify(back.grid) === JSON.stringify(G0) && back.score === 40 && back.seed === 987654321, back);
      await page.reload(); await wait(page, 200);
      await page.keyboard.press('ArrowLeft'); await wait(page, 130);
      check('再読み込み後も同じ手で同じ出目（種が保存されている）', JSON.stringify((await stateOf(page)).grid) === res[0]);
      const seeds = [(await stateOf(page)).seed];
      for (const k of ['ArrowUp', 'ArrowRight']) { await page.keyboard.press(k); await wait(page, 130); seeds.push((await stateOf(page)).seed); }
      check('1手ごとに種が進む', new Set(seeds).size === 3, seeds);
      const ns = [];
      for (let i = 0; i < 3; i++) { await seed(page, {}); await page.goto(T48); ns.push((await stateOf(page)).seed); }
      check('新しいゲームは毎回違う種', ns.every(Number.isInteger) && new Set(ns).size === 3, ns);
      await ctx.close();
    },
  },
  {
    id: 'D9', tier: 'full', title: 'メニューのベスト表示が最新（ゲームから戻る・ブラウザの戻る＝bfcache）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'D9', { clock: true });
      await seed(page, { 'tile2048.best': '10' });
      await page.goto(BASE);
      await page.locator('a.game').nth(1).click(); await page.waitForURL('**/games/2048/');
      await page.evaluate(() => localStorage.setItem('tile2048.best', '99999'));
      await page.goBack(); await page.waitForURL(BASE); await wait(page, 150);
      const a = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      await page.evaluate(() => localStorage.setItem('tile2048.best', '2048'));
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      const b = await page.evaluate(() => [...document.querySelectorAll('.best b')].map((b) => b.textContent));
      check('戻るボタンで戻っても、bfcache 復帰(pageshow persisted)でもベストを再表示', a[1] === '99,999' && b[1] === '2,048', { a, b });
      await ctx.close();
    },
  },
];
