// E: メニューへ戻れる（閉じ込めがない）。どの画面・どのカードからも出口があること
import { BASE, GAME_COUNT, GAME_URLS, T48, BLK, KIRI, view, custom, newPage, seed, open2048, ST, cardText, overlayShown, stateOf, cardReach, sleep, wait, touch, kiriSnap, kiriStart } from '../lib.mjs';
const V = () => view('i13', 'p', 'app');
const OVER = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
const WIN = [2048, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0];
const hrefs = (p) => p.evaluate(() => [...document.querySelectorAll('a.game')].map((a) => a.getAttribute('href')));
const btns = (p) => p.evaluate(() => [...document.querySelectorAll('#card .row button')].map((b) => b.textContent + (b.classList.contains('primary') ? '*' : '') + (b.disabled ? '(off)' : '')));

export const tests = [
  {
    id: 'E1', tier: 'smoke', title: 'メニュー → 各ゲーム → メニュー（タイトル・プレイ中・一時停止、2048 の「← メニュー」）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'E1', { clock: true });
      await seed(page, {});
      await page.goto(BASE);
      check(`保存が空のとき、メニューにゲームのカードが GAMES と同じ ${GAME_COUNT} 枚・同じ順（キリトリ道場・いろコード・ゼンマイさんぽを含む）・見出し「ゆびあそび」`, await page.evaluate((urls) => JSON.stringify([...document.querySelectorAll('a.game')].map((a) => a.getAttribute('href'))) === JSON.stringify(urls) && document.querySelector('h1').textContent === 'ゆびあそび', GAME_URLS) && GAME_COUNT >= 5 && ['games/kiritori/', 'games/irocode/', 'games/zenmai/'].every((u) => GAME_URLS.includes(u)));
      await page.locator('a.game[href="games/blocks/"]').tap(); await page.waitForURL('**/games/blocks/');
      const title = await cardText(page);
      check('ブロック：タイトル画面に「スタート」と「メニューへ」', /スタート/.test(title) && /メニューへ/.test(title), title);
      await page.click('#card [data-cmd=restart]'); await wait(page, 100);
      await page.locator('#menuBtn').tap(); await wait(page, 80);
      const pc = await cardText(page);
      check('ブロック：プレイ中の「← メニュー」は一時停止画面を経由（誤タップで即終了しない）', /一時停止/.test(pc) && /メニューへ/.test(pc) && page.url().endsWith('games/blocks/'), pc);
      await page.locator('#card [data-cmd=menu]').tap(); await page.waitForURL(BASE);
      check('一時停止画面の「メニューへ」でメニューに戻る', page.url() === BASE);
      await page.locator('a.game[href="games/2048/"]').tap(); await page.waitForURL('**/games/2048/');
      const back = await page.evaluate(() => document.querySelector('#backLink').textContent.replace(/\s+/g, ''));
      await page.locator('#backLink').tap(); await page.waitForURL(BASE);
      check('2048：「← メニュー」でメニューに戻る', back === '←メニュー' && page.url() === BASE, back);
      await page.goto(BLK); await wait(page, 100);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('ブロック：タイトル画面の「メニューへ」でメニューに戻る', page.url() === BASE);
      await ctx.close();
    },
  },
  {
    id: 'E2', tier: 'smoke', title: '2048 の結果カード（ゲームオーバー・クリア）からメニューへ戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'E2', { clock: true });
      await open2048(page, ST(OVER, { score: 100 }));
      const t = await cardText(page);
      const b = await btns(page);
      // 868b9e4 で配置を変更：1段目［もう一度］、2段目［1手戻す］［メニューへ］（期待値をコピー側で更新）
      check('ゲームオーバー画面のボタン [もう一度*] / [1手戻す(無効)][メニューへ]', /ゲームオーバー/.test(t) && JSON.stringify(b) === JSON.stringify(['もう一度*', '1手戻す(off)', 'メニューへ']), b);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('ゲームオーバー →「メニューへ」でメニュー', page.url() === BASE);
      await open2048(page, ST(WIN, { score: 20000 }));
      const w = await btns(page);
      // 868b9e4 で「新しいゲーム」→「最初から」、配置を 1段目［続ける］、2段目［最初から］［メニューへ］に変更（期待値をコピー側で更新）
      check('クリア画面：主ボタン「続ける」が先頭、「最初から」「メニューへ」あり', w[0] === '続ける*' && w.includes('最初から') && w.includes('メニューへ'), w);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      await page.goto(T48); await wait(page, 150);
      await page.click('#card [data-cmd=continue]'); await wait(page, 80);
      check('クリア → メニュー → 再訪で「続ける」を押すと遊べる', page.url() === T48 && !(await overlayShown(page)));
      await ctx.close();
    },
  },
  {
    id: 'E3', tier: 'full', title: '確認・一時停止カードから必ず抜けられる（Esc・やめる・再押下・ゲームオーバー）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'E3', { clock: true });
      await seed(page, { 'blockpuzzle.best': '10' });
      await page.goto(BLK); await wait(page, 120);
      await page.click('#card [data-cmd=restart]'); await wait(page, 100);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await wait(page, 40); }
      await page.click('#pauseBtn'); await wait(page, 60);
      const h = () => page.evaluate(() => document.querySelector('#overlay').hidden ? '(なし)' : document.querySelector('#card h1')?.textContent);
      const cmds = await page.evaluate(() => [...document.querySelectorAll('#card [data-cmd]')].map((b) => b.dataset.cmd).join());
      const before = await page.evaluate(() => document.querySelector('#score').textContent);
      const shot1 = await page.locator('#board').screenshot();
      await page.click('#card [data-cmd=askRestart]');
      const confirm = await h();
      const cb = await page.evaluate(() => [...document.querySelectorAll('#card button')].map((b) => b.textContent + (b.classList.contains('primary') ? '*' : '')));
      await page.evaluate(() => document.querySelector('#pauseBtn').click()); const a1 = await h(); // カード表示中は II が覆われるのでプログラムから押す（キーボード・支援技術の経路）
      await page.click('#card [data-cmd=askRestart]'); await page.keyboard.press('Escape'); await wait(page, 30); const a2 = await h();
      await page.click('#card [data-cmd=askRestart]'); await page.click('#card [data-cmd=cancel]'); const a3 = await h();
      const shot2 = await page.locator('#board').screenshot();
      const after = await page.evaluate(() => document.querySelector('#score').textContent);
      check('一時停止カード [再開][やり直す][メニューへ]、やり直すは確認 [やめる][やり直す*]', cmds === 'resume,askRestart,menu' && confirm === 'やり直す？' && JSON.stringify(cb) === JSON.stringify(['やめる', 'やり直す*']), { cmds, confirm, cb });
      check('確認中の II・Esc・やめる はすべて一時停止画面へ戻り、盤面とスコアが保たれる', a1 === '一時停止' && a2 === '一時停止' && a3 === '一時停止' && before === after && shot1.equals(shot2), { a1, a2, a3, before, after });
      await page.click('#card [data-cmd=askRestart]'); await page.click('#card [data-cmd=restart]'); await wait(page, 60);
      const n = await page.evaluate(() => ({ h: document.querySelector('#overlay').hidden, s: document.querySelector('#score').textContent }));
      await page.keyboard.press('Escape'); await wait(page, 30); await page.keyboard.press('Escape'); await wait(page, 30);
      check('確認の「やり直す」で新しいゲーム、直後の 一時停止→再開 も1回で効く', n.h && n.s === '0' && await h() === '(なし)', n);
      for (let i = 0; i < 90; i++) { await page.keyboard.press('Space'); if (await h() === 'ゲームオーバー') break; }
      const over = await page.evaluate(() => [...document.querySelectorAll('#card [data-cmd]')].map((b) => b.dataset.cmd));
      check('ブロックのゲームオーバー画面に「メニューへ」「もう一度」', await h() === 'ゲームオーバー' && over.includes('menu') && over.includes('restart'), over);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('ブロックのゲームオーバー →「メニューへ」でメニュー', page.url() === BASE);
      // 2048 の確認
      await open2048(page, ST([2, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8], { score: 120 }));
      let dialog = false; page.on('dialog', (d) => { dialog = true; d.dismiss(); });
      await page.locator('#newBtn').tap(); await page.keyboard.press('n'); await page.evaluate(() => document.querySelector('#newBtn').click()); await wait(page, 60);
      const q1 = await page.evaluate(() => ({ h: document.querySelector('#card h2')?.textContent, n: document.querySelectorAll('#card').length }));
      await page.keyboard.press('u'); await page.keyboard.press('ArrowLeft'); await wait(page, 100);
      const q2 = await page.evaluate(() => document.querySelector('#card h2')?.textContent);
      await page.keyboard.press('Escape'); await wait(page, 60);
      const g = (await stateOf(page)).grid;
      // 868b9e4 で見出しを「最初からやり直す？」に変更
      check('2048「最初から」はページ内の確認1枚（再押下で重ならず、確認中の U・矢印は無視）、Esc で盤面そのままプレイに戻る',
        !dialog && q1.h === '最初からやり直す？' && q1.n === 1 && q2 === '最初からやり直す？' && !(await overlayShown(page)) && JSON.stringify(g) === JSON.stringify([2, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8]), { q1, q2, dialog });
      await open2048(page, ST(WIN, { score: 20000 }));
      await page.click('#card [data-cmd=askRestart]'); const c1 = await cardText(page);
      await page.click('#card [data-cmd=cancel]'); const c2 = await cardText(page);
      await page.click('#card [data-cmd=askRestart]'); await page.keyboard.press('Escape'); await wait(page, 60); const c3 = await cardText(page);
      await page.click('#card [data-cmd=askRestart]'); await page.click('#card [data-cmd=restart]'); await wait(page, 150);
      const fresh = await stateOf(page);
      check('クリア画面の「最初から」は確認あり、やめる・Esc でクリア画面に戻り、確定で新しい盤面', /最初からやり直す？/.test(c1) && /20,000/.test(c1) && /クリア/.test(c2) && /クリア/.test(c3) && fresh.grid.filter(Boolean).length === 2 && !(await overlayShown(page)), { c1, c2, c3 });
      await ctx.close();
    },
  },
  {
    id: 'E4', tier: 'smoke', title: '低い横持ちでもカードの見出しが切れず、全ボタンに届く（高さの境界）',
    async run({ browser, check, tier }) {
      // smoke：SE 横・ホーム画面（568×320、高さ ≤360 の区分）。full：Safari の 568×270（ツールバー分低い）も
      const views = [custom(568, 320, [0, 0, 0, 0], 'SE横・ホーム画面')];
      if (tier === 'full') views.push(custom(568, 270, null, 'SE横・Safari(270)'));
      for (const v of views) {
        const { ctx, page } = await newPage(browser, v, 'E4 ' + v.label, { clock: true });
        const res = {};
        await seed(page, {});
        await page.goto(BLK); await wait(page, 150); res['ブロック タイトル'] = await cardReach(page);
        if (tier === 'full') {
          await page.click('#card [data-cmd=restart]'); await wait(page, 80);
          await page.click('#pauseBtn'); await wait(page, 60); res['ブロック 一時停止'] = await cardReach(page);
          await page.click('#card [data-cmd=askRestart]'); res['ブロック やり直し確認'] = await cardReach(page);
          await page.click('#card [data-cmd=cancel]'); await page.click('#card [data-cmd=resume]');
          for (let i = 0; i < 90; i++) { await page.keyboard.press('Space'); if (await overlayShown(page)) break; }
          await wait(page, 60); res['ブロック ゲームオーバー'] = await cardReach(page);
        }
        await seed(page, {});
        await page.goto(KIRI); await wait(page, 150); res['キリトリ タイトル'] = await cardReach(page);
        await kiriStart(page);
        await page.click('#pauseBtn'); await wait(page, 60); res['キリトリ 一時停止'] = await cardReach(page);
        if (tier === 'full') {
          await page.click('#card [data-cmd=askRestart]'); res['キリトリ やり直し確認'] = await cardReach(page);
          await page.click('#card [data-cmd=cancel]'); await page.click('#card [data-cmd=resume]');
          for (let i = 0; i < 60 && !(await overlayShown(page)); i++) await wait(page, 500);
          res['キリトリ ゲームオーバー'] = await cardReach(page);
        }
        const states = { 'ゲームオーバー': ST(OVER, { score: 1234567, prev: { grid: [...OVER.slice(0, 15), 0], score: 1234560, seed: 1 } }), 'クリア': ST(WIN, { score: 1234567 }), '新しいゲーム確認': ST([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], { score: 120 }) };
        for (const [k, s] of Object.entries(states)) {
          if (tier !== 'full' && k !== 'ゲームオーバー') continue;
          await open2048(page, s);
          if (k === '新しいゲーム確認') { await page.click('#newBtn'); await wait(page, 60); }
          res['2048 ' + k] = await cardReach(page);
        }
        const bad = Object.entries(res).filter(([, r]) => !r.ok);
        check(`${v.label}：${Object.keys(res).length} 枚のカードすべて見出しが見え、全ボタンに到達可`, bad.length === 0, bad);
        if (v.h === 320) {
          await page.goto(BLK); await wait(page, 120);
          const init = await page.evaluate(() => [...document.querySelectorAll('#card button')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
          check(`${v.label}：ブロックのタイトルは「スタート」「メニューへ」がスクロールなしで見える`, init);
          await page.goto(KIRI); await wait(page, 120);
          const ki = await page.evaluate(() => [...document.querySelectorAll('#card button')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
          check(`${v.label}：キリトリ道場のタイトルは「はじめる」「メニューへ」がスクロールなしで見える`, ki);
        }
        await ctx.close();
      }
    },
  },
  {
    id: 'E5', tier: 'full', cdp: 'CDP のタッチ操作（スワイプ）', title: '画面高さ 270・200 でカードを指で縦スクロールでき、スクロール後のボタンを押せる（実際のタッチ操作）',
    async run({ browser, check }) {
      for (const H of [270, 200]) {
        const { ctx, page } = await newPage(browser, custom(568, H, [0, 0, 0, 0]), 'E5');
        const t = await touch(ctx, page);
        const swipeUp = async () => {
          await page.evaluate(() => { document.querySelector('#overlay').scrollTop = 0; });
          await t.swipe(284, H - 30, 0, -120, 12, 16); await wait(page, 350);
          return page.evaluate(() => { const o = document.querySelector('#overlay'); return { need: o.scrollHeight > o.clientHeight, st: o.scrollTop }; });
        };
        await seed(page, {});
        await page.goto(BLK); await wait(page, 150);
        const a = await swipeUp();
        await open2048(page, ST(WIN, { score: 1234567 }));
        const b = await swipeUp();
        check(`568×${H}：ブロックのタイトル・2048 のクリア画面をタッチで縦スクロールできる`, (!a.need || a.st > 0) && (!b.need || b.st > 0) && (a.need || b.need || H > 300), { a, b });
        if (H === 200) {
          // 一時停止カード（hotfix/doubletap.mjs から統合）：スクロールしてから「再開」をタップで押せる
          await page.goto(BLK); await wait(page, 150);
          await page.keyboard.press('Enter'); await wait(page, 150);
          await page.keyboard.press('Escape'); await wait(page, 150);
          const c = await swipeUp();
          await page.locator('#card [data-cmd=resume]').scrollIntoViewIfNeeded({ timeout: 3000 });
          await t.tapEl('#card [data-cmd=resume]'); await wait(page, 150);
          check('568×200：ブロックの一時停止カードを縦スクロールでき、スクロール後の「再開」をタップで押せる', c.need && c.st > 0 && await page.evaluate(() => document.querySelector('#overlay').hidden), c);
        }
        await ctx.close();
      }
    },
  },
  {
    id: 'E6', tier: 'smoke', title: 'キリトリ道場：タイトル・プレイ中（← メニューは一時停止を経由）・一時停止・やり直し確認・結果カードからメニューへ戻れる',
    async run({ browser, check, tier }) {
      const { ctx, page } = await newPage(browser, V(), 'E6', { clock: true });
      await seed(page, {});
      await page.goto(BASE);
      await page.locator('a.game[href="games/kiritori/"]').tap(); await page.waitForURL('**/games/kiritori/'); await wait(page, 150);
      const title = await btns(page);
      check('タイトル：[メニューへ][はじめる*]、「← メニュー」の表記', JSON.stringify(title) === JSON.stringify(['メニューへ', 'はじめる*']) && await page.evaluate(() => document.querySelector('#menuBtn').textContent.replace(/\s+/g, '')) === '←メニュー', title);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('タイトルの「メニューへ」でメニューへ', page.url() === BASE);
      await page.goto(KIRI); await wait(page, 150);
      await kiriStart(page); await wait(page, 500);
      await page.locator('#menuBtn').tap(); await wait(page, 60);
      const pc = await cardText(page), pb = await btns(page);
      const t0 = (await kiriSnap(page)).elapsed; await wait(page, 800); const t1 = (await kiriSnap(page)).elapsed;
      check('プレイ中の「← メニュー」は一時停止画面を経由（[再開*] / [やり直す][メニューへ]）、止まっている間は時間が進まない', /一時停止/.test(pc) && JSON.stringify(pb) === JSON.stringify(['再開*', 'やり直す', 'メニューへ']) && page.url() === KIRI && t0 === t1, { pc, pb, t0, t1 });
      await page.click('#card [data-cmd=askRestart]');
      const cb = await btns(page), ct = await cardText(page);
      await page.click('#card [data-cmd=cancel]');
      const back = await cardText(page);
      await page.keyboard.press('Escape'); await wait(page, 60);
      const resumed = (await kiriSnap(page)).state;
      check('「やり直す」は確認 [やめる][やり直す*] →「やめる」で一時停止へ戻る → Esc で再開', /やり直す？/.test(ct) && JSON.stringify(cb) === JSON.stringify(['やめる', 'やり直す*']) && /一時停止/.test(back) && resumed === 'play', { ct, cb, back, resumed });
      await page.click('#pauseBtn'); await wait(page, 60);
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('一時停止の「メニューへ」でメニューへ', page.url() === BASE);
      // 切らずに落とし続けてライフ 0 → 結果カード [もう一度*] / [メニューへ]
      await page.goto(KIRI); await wait(page, 150); await kiriStart(page);
      for (let i = 0; i < 60 && !(await overlayShown(page)); i++) await wait(page, 500);
      const ob = await btns(page), ot = await cardText(page);
      check('ライフ 0 で結果カード：スコア・ベスト・最大コンボ、[もう一度*]（横幅いっぱい）/ [メニューへ]', /ゲームオーバー/.test(ot) && /最大コンボ/.test(ot) && /ベスト/.test(ot) && JSON.stringify(ob) === JSON.stringify(['もう一度*', 'メニューへ'])
        && await page.evaluate(() => { const c = document.querySelector('#card .btns').getBoundingClientRect(), p = document.querySelector('#card .primary').getBoundingClientRect(); return Math.abs(c.width - p.width) < 1; }), { ot, ob });
      await page.click('#card [data-cmd=menu]'); await page.waitForURL(BASE);
      check('結果カードの「メニューへ」でメニューへ', page.url() === BASE);
      if (tier === 'full') {
        await page.goto(KIRI); await wait(page, 150); await kiriStart(page);
        for (let i = 0; i < 60 && !(await overlayShown(page)); i++) await wait(page, 500);
        await page.click('#card [data-cmd=restart]'); await wait(page, 100);
        const s = await kiriSnap(page);
        check('結果カードの「もう一度」で新しいゲーム（スコア 0・ライフ 3）', s.state === 'play' && s.score === 0 && s.lives === 3 && !s.overlay, s);
      }
      await ctx.close();
    },
  },
  {
    id: 'E7', tier: 'smoke', title: 'メニューは最近遊んだ順（X-21）：空なら GAMES の順、押して戻るとそのゲームが先頭・一番上に見える（タップ・Enter）。Ctrl+クリック（別タブ）では入れない（X-23）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'E7');
      await seed(page, {});
      await page.goto(BASE);
      const a = await hrefs(page);
      check('(a) 保存が空なら GAMES の順', JSON.stringify(a) === JSON.stringify(GAME_URLS), a);
      // いちばん下のゲームをタップ → ブラウザの戻る（bfcache を含む）→ 先頭に来て、画面は一番上
      const last = GAME_URLS.at(-1);
      await page.locator(`a.game[href="${last}"]`).scrollIntoViewIfNeeded();
      await page.locator(`a.game[href="${last}"]`).tap(); await page.waitForURL(BASE + last);
      await page.goBack(); await page.waitForURL(BASE); await sleep(150);
      const b1 = await hrefs(page), y1 = await page.evaluate(() => window.scrollY);
      check(`(b) ${last} を押して戻ると先頭・残りは GAMES の順・スクロールは一番上`, JSON.stringify(b1) === JSON.stringify([last, ...GAME_URLS.filter((u) => u !== last)]) && y1 === 0, { b1, y1 });
      // 次に 2048 を Enter で開き、ゲームの「← メニュー」で戻る → [2048, last, …]
      await page.locator('a.game[href="games/2048/"]').focus(); await page.keyboard.press('Enter'); await page.waitForURL(T48);
      await page.locator('#backLink').click(); await page.waitForURL(BASE); await sleep(150);
      const b2 = await hrefs(page);
      const saved = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      check(`(b) 続けて 2048 を Enter で開いて戻ると [2048, ${last}, 残りは GAMES の順]、保存は url の配列`, JSON.stringify(b2) === JSON.stringify(['games/2048/', last, ...GAME_URLS.filter((u) => u !== last && u !== 'games/2048/')]) && saved === JSON.stringify(['games/2048/', last]), { b2, saved });
      // X-23：Ctrl+クリック（別タブで開く）では遊んでいないので先頭に入れない。開いた別タブは閉じる
      const tabs = [];
      ctx.on('page', (p) => tabs.push(p));
      await page.locator('a.game[href="games/kiritori/"]').click({ modifiers: ['Control'] }); await sleep(300);
      const c1 = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      check('(X-23) Ctrl+クリック（別タブで開く）では yubi.recent が変わらず、メニューに留まる', c1 === saved && page.url() === BASE, { c1, url: page.url(), tabs: tabs.length });
      for (const p of tabs) await p.close().catch(() => {});
      await ctx.close();
    },
  },
  {
    id: 'E8', tier: 'full', title: '最近遊んだ順（X-21）：壊れた保存でも落ちない・押した瞬間は並びが変わらない・保存に失敗しても移動する・並べ直しでベストと絵が残る・修飾キーつき・中ボタンでは保存しない（X-23）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'E8');
      const rev = [...GAME_URLS].reverse();
      const blockClicks = () => page.evaluate(() => document.querySelectorAll('a.game').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
      // (c) 壊れた yubi.recent：使える分だけ使い、落ちない（ページのエラーは watch が不合格にする）
      const cases = [
        ['JSON でない', 'games/2048/{', GAME_URLS],
        ['配列でない（文字）', '"games/2048/"', GAME_URLS],
        ['配列でない（物）', '{"0":"games/2048/"}', GAME_URLS],
        ['null', 'null', GAME_URLS],
        ['数・null・物・知らない url・重複', JSON.stringify([5, null, {}, 'games/nope/', 'games/kiritori/', 'games/2048', 'games/2048/', 'games/kiritori/', ['games/blocks/']]),
          ['games/kiritori/', 'games/2048/', ...GAME_URLS.filter((u) => u !== 'games/kiritori/' && u !== 'games/2048/')]],
        ['GAMES より長い', JSON.stringify([...rev, ...GAME_URLS]), rev],
      ];
      const bad = [];
      for (const [label, raw, want] of cases) {
        await seed(page, { 'yubi.recent': raw });
        await page.goto(BASE); await sleep(80);
        const got = await hrefs(page);
        const best = await page.evaluate(() => [...document.querySelectorAll('.best b')].filter((b) => b.textContent).length);
        if (JSON.stringify(got) !== JSON.stringify(want) || best !== GAME_COUNT) bad.push({ label, got, best });
      }
      check(`(c) 壊れた yubi.recent（${cases.map((c) => c[0]).join('・')}）でも落ちず、使える分だけで並ぶ`, bad.length === 0, bad);
      // 壊れた保存（いまは「GAMES より長い」）のまま押すと、使える url だけ・重複なしで先頭に入れて保存し直す
      await blockClicks();
      await page.locator('a.game[href="games/blocks/"]').click();
      const fixed = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      check('(c) 壊れた保存のまま押すと、使える url だけ・重複なし・最大 GAMES の数で保存し直す', fixed === JSON.stringify(['games/blocks/', ...rev.filter((u) => u !== 'games/blocks/')]), fixed);
      // (d) 押したとき（click・タップ）は保存だけで、その場では並べ替えない
      await seed(page, {});
      await page.goto(BASE); await sleep(80);
      await blockClicks();
      const last = GAME_URLS.at(-1);
      await page.locator(`a.game[href="${last}"]`).click(); await sleep(200);
      const d1 = await hrefs(page), dSaved = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      await page.locator('a.game[href="games/2048/"]').tap(); await sleep(200);
      const d2 = await hrefs(page), dSaved2 = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      check('(d) 押した瞬間は並びが変わらず（GAMES の順のまま）、保存だけ先頭に入る', JSON.stringify(d1) === JSON.stringify(GAME_URLS) && JSON.stringify(d2) === JSON.stringify(GAME_URLS) && dSaved === JSON.stringify([last]) && dSaved2 === JSON.stringify(['games/2048/', last]), { d1, d2, dSaved, dSaved2 });
      // (X-23) 修飾キー（Ctrl・Meta・Shift・Alt）つき・中ボタン（auxclick）では保存しない。ふつうのクリックでは保存する
      const keep = JSON.stringify(['games/2048/', last]), mods = [];
      for (const m of ['Control', 'Meta', 'Shift', 'Alt']) {
        await page.locator('a.game[href="games/kiritori/"]').click({ modifiers: [m] }); await sleep(60);
        mods.push([m, await page.evaluate(() => localStorage.getItem('yubi.recent'))]);
      }
      await page.evaluate(() => document.querySelectorAll('a.game').forEach((a) => a.addEventListener('auxclick', (e) => e.preventDefault())));
      await page.locator('a.game[href="games/kiritori/"]').click({ button: 'middle' }); await sleep(60);
      mods.push(['中ボタン', await page.evaluate(() => localStorage.getItem('yubi.recent'))]);
      check('(X-23) Ctrl・Meta・Shift・Alt を押しながらのクリックと中ボタンのクリックでは yubi.recent が変わらない', mods.every(([, v]) => v === keep), mods);
      await page.locator('a.game[href="games/kiritori/"]').click(); await sleep(60);
      const plain = await page.evaluate(() => localStorage.getItem('yubi.recent'));
      check('(X-23) ふつうのクリックでは先頭に入る', plain === JSON.stringify(['games/kiritori/', 'games/2048/', last]), plain);
      // (e) 並べ直しても同じカード（作り直さない）で、ベスト表示と絵が残る
      await seed(page, { 'tile2048.best': '1234' });
      await page.goto(BASE); await sleep(300);
      const before = await page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/2048/"]'); a.__mark = 1;
        return { best: a.querySelector('.best b').textContent, art: a.querySelector('canvas').toDataURL(), n: document.querySelectorAll('#games > li').length };
      });
      await page.evaluate(() => { localStorage.setItem('yubi.recent', JSON.stringify(['games/2048/'])); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      const after = await page.evaluate(() => {
        const a = document.querySelector('a.game');
        return { href: a.getAttribute('href'), same: a.__mark === 1, best: a.querySelector('.best b').textContent, art: a.querySelector('canvas').toDataURL(), n: document.querySelectorAll('#games > li').length, links: document.querySelectorAll('#games > li > a.game').length };
      });
      check('(e) pageshow で並べ直すと 2048 が先頭、同じカードのまま・ベスト「1,234」・絵（canvas）が残る・カードの数は同じ', after.href === 'games/2048/' && after.same && before.best === '1,234' && after.best === '1,234' && after.art === before.art && after.art.length > 1000 && after.n === GAME_COUNT && after.links === GAME_COUNT && before.n === GAME_COUNT, { before: { ...before, art: before.art.length }, after: { ...after, art: after.art.length } });
      // 見えたとき（visibilitychange）にも並べ直す
      await page.evaluate(() => { localStorage.setItem('yubi.recent', JSON.stringify(['games/kiritori/'])); document.dispatchEvent(new Event('visibilitychange')); });
      const v = await hrefs(page);
      check('(e) 見えたとき（visibilitychange）にも並べ直す', v[0] === 'games/kiritori/', v.slice(0, 3));
      await ctx.close();
      // 保存に失敗しても（容量いっぱいなど）移動は止まらない。メニューの画面だけ localStorage.setItem を失敗させる
      const f = await newPage(browser, V(), 'E8 setItem失敗', { initScript: () => { if (!/\/games\//.test(location.pathname)) Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; } });
      await f.page.goto(BASE);
      await f.page.locator('a.game[href="games/2048/"]').click();
      const moved = await f.page.waitForURL(T48, { timeout: 5000 }).then(() => true, () => false);
      check('保存に失敗しても（setItem が例外）カードを押すとゲームへ移る', moved, f.page.url());
      await f.ctx.close();
    },
  },
];
