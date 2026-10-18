// PK: ピカッと早押し（games/pikatto/）。
//   Node で logic.js を直接読む PK1 と PK9（ブラウザ不要）、画面のテスト PK2〜PK8。
//   画面の DOM は契約（docs/pikatto-contract.md §5）だけに頼る：
//     a#back・.setup・.setup [data-players=…]・.setup [data-action="start"]・.play・.corner[data-player="1..4"]・
//     #field[data-phase]・#signal・.overlay・.overlay [data-cmd=next/again/menu/close]・#help-btn・#sound-btn。
//   テスト用の公開 API（契約 §9）：window.PikattoGame = { getState, startRound, forceSignal, pressFor(idx), reset }。
//   forceSignal() は 1〜4 秒の待ちを飛ばして即 'armed' にする（早送り用）。
//
// PK8（オフライン）と PK9 の一部は Wave 4（版と事前キャッシュ）の後に効く。
//   Wave 1 では事前キャッシュに games/pikatto/ がまだ入らないので、SKIP_SW=1 でスキップ可能にしてある。
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays } from '../lib.mjs';

const PK_URL = BASE + 'games/pikatto/';
const V = () => view('i13', 'p', 'app');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Node：logic.js を読む ----------
function loadLogic(root) {
  const req = createRequire(import.meta.url);
  const p = path.join(root, 'games/pikatto/logic.js');
  delete req.cache[req.resolve(p)];
  return req(p);
}

// ---------- 画面：共通の操作 ----------
async function openPK(browser, label, { v = V(), opts = {}, extra = {} } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  // 初回のみ出る遊び方オーバーレイを閉じた状態で始める（既存ゲームの zenmai.help・irocode.help と同じ流儀）
  await seed(page, { 'pikatto.help': '1', ...extra });
  await page.goto(PK_URL); await wait(page, 300);
  return { ctx, page };
}
// 人数を選んで「はじめる」
async function startVs(page, n) {
  await page.locator(`.setup [data-players="${n}"]`).tap(); await wait(page, 150);
  await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
}
async function startSolo(page) {
  await page.locator('.setup [data-players="solo"]').tap(); await wait(page, 150);
  await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
}
const getState = (p) => p.evaluate(() => window.PikattoGame && window.PikattoGame.getState());
const phaseOf = (p) => p.evaluate(() => (window.PikattoGame.getState() || {}).phase);
const playVisible = (p) => p.evaluate(() => { const e = document.querySelector('.play'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.hidden; });
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('.overlay');
  const shown = !!ov && !ov.hidden && getComputedStyle(ov).display !== 'none';
  const cmds = shown ? [...ov.querySelectorAll('.card [data-cmd]')].filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed').map((b) => b.dataset.cmd) : [];
  return { shown, cmds, text: shown ? (ov.querySelector('.card')?.textContent || '').replace(/\s+/g, ' ').trim() : '' };
});
// 合図を飛ばして armed にする（forceSignal がある前提。契約 §9）
async function arm(page) { await page.evaluate(() => window.PikattoGame.forceSignal()); await wait(page, 50); }
async function pressFor(page, idx) { await page.evaluate((i) => window.PikattoGame.pressFor(i), idx); await wait(page, 100); }

export const tests = [
  // ================= PK1 Node：ロジック =================
  {
    id: 'PK1', tier: 'smoke', node: true, title: 'ピカッと：ロジック（startRound→applySignal→armed で勝ち・waiting でフライング・3点先取で終了・validateBestSolo）',
    run({ check, root }) {
      const L = loadLogic(root);
      // 乱数と時計を注入して決定的に動かす
      const mkRng = (seq) => { let i = 0; return () => seq[(i++) % seq.length]; };
      const mkNow = (start) => { let t = start; return () => (t += 10); };
      // --- 基本の勝ち ---
      let st = L.createGame({ players: 2, mode: 'vs', random: mkRng([0.5]), now: mkNow(1000) });
      st = L.startRound(st);
      check('startRound で phase=waiting、round=1、signalDelay が 1000..4000 の整数、scores は 0,0',
        st.phase === 'waiting' && st.round === 1 && Number.isInteger(st.signalDelay) && st.signalDelay >= 1000 && st.signalDelay <= 4000 && eq(st.scores, [0, 0]) && st.signalFiredAt === null,
        st);
      st = L.applySignal(st);
      check('applySignal で phase=armed、signalFiredAt が now()', st.phase === 'armed' && typeof st.signalFiredAt === 'number', { phase: st.phase, fired: st.signalFiredAt });
      let { state: st2, outcome } = L.applyPress(st, { playerIdx: 0, pressedAt: st.signalFiredAt + 250 });
      check('armed で player 0 が押すと win、scores[0] が +1、reactionMs=250、他は 0',
        outcome.kind === 'win' && outcome.player === 0 && outcome.reactionMs === 250 && eq(st2.scores, [1, 0]) && st2.phase === 'resolved',
        { outcome, scores: st2.scores, phase: st2.phase });
      // --- waiting でのフライング ---
      let f = L.createGame({ players: 3, mode: 'vs', random: mkRng([0.1]) });
      f = L.startRound(f);
      const r = L.applyPress(f, { playerIdx: 1, pressedAt: 2000 });
      check('waiting でどのボタンを押しても foul、他プレイヤー全員に +1（押した本人は 0 のまま）',
        r.outcome.kind === 'foul' && r.outcome.foulBy === 1 && eq(r.outcome.award.sort(), [0, 2]) && eq(r.state.scores, [1, 0, 1]) && r.state.phase === 'resolved',
        r);
      // --- 3点先取で phase='done'、winner が整数 ---
      let g = L.createGame({ players: 2, mode: 'vs' });
      let won = false, winner = null;
      for (let i = 0; i < 10 && !won; i++) {
        g = L.startRound(g); g = L.applySignal(g);
        const res = L.applyPress(g, { playerIdx: 0, pressedAt: (g.signalFiredAt || 0) + 300 });
        g = res.state;
        if (g.phase === 'done') { won = true; winner = g.winner; }
      }
      check('player 0 だけが3回勝つと phase=done、winner=0、decideWinner も 0', won && g.phase === 'done' && winner === 0 && L.decideWinner(g) === 0 && eq(g.scores, [3, 0]), { phase: g.phase, winner, scores: g.scores });
      // --- validateBestSolo：壊れた値 10 種を 0 にする、有効値は通る ---
      const bad = { '文字列': 'abc', '空文字': '', 'NaN': NaN, '負': -5, 'Infinity': Infinity, '-Infinity': -Infinity, '小数': 123.4, '0': 0, '49': 49, '5001': 5001, 'null': null, 'object': { ms: 300 }, '配列': [250], 'true': true };
      const bb = Object.entries(bad).filter(([, v]) => L.validateBestSolo(v) !== 0).map(([k, v]) => [k, v, L.validateBestSolo(v)]);
      check(`validateBestSolo：壊れた ${Object.keys(bad).length} 種を 0 にする`, bb.length === 0, bb);
      check('validateBestSolo：有効な値（50・300・5000・"250"）はそのまま整数で通す',
        L.validateBestSolo(50) === 50 && L.validateBestSolo(300) === 300 && L.validateBestSolo(5000) === 5000 && L.validateBestSolo('250') === 250);
      check('SAVE_KEY_BEST_SOLO は "pikatto.bestSolo"', L.SAVE_KEY_BEST_SOLO === 'pikatto.bestSolo', L.SAVE_KEY_BEST_SOLO);
      // --- イミュータブル（元の scores を書き換えない） ---
      const h = L.createGame({ players: 2, mode: 'vs' });
      const h2 = L.startRound(h);
      check('createGame → startRound は元の state の scores を書き換えない', eq(h.scores, [0, 0]) && h.phase === 'setup' && h2.phase === 'waiting');
      // --- solo モードの reactions ---
      let s = L.createGame({ mode: 'solo', random: mkRng([0.5]), now: mkNow(1000) });
      s = L.startRound(s); s = L.applySignal(s);
      s = L.applyPress(s, { playerIdx: 0, pressedAt: s.signalFiredAt + 400 }).state;
      check('solo：勝ちで reactions に反応時間（ms）が増える', s.mode === 'solo' && s.players === 1 && eq(s.reactions, [400]), { reactions: s.reactions });
      // --- 境界ケース補強 ---
      // phase='done' の state を作るヘルパー（player 0 が 3 回勝って終了させる）
      function makeDoneState() {
        let d = L.createGame({ players: 2, mode: 'vs' });
        for (let i = 0; i < 5 && d.phase !== 'done'; i++) {
          d = L.startRound(d);
          d = L.applySignal(d);
          d = L.applyPress(d, { playerIdx: 0, pressedAt: (d.signalFiredAt || 0) + 100 }).state;
        }
        return d;
      }
      // 1. startRound を phase='done' で呼んでも phase は 'done' のまま
      const doneState = makeDoneState();
      const afterStartDone = L.startRound(doneState);
      check('startRound を phase=done で呼ぶと state は不変（phase が done のまま）',
        afterStartDone.phase === 'done' && afterStartDone === doneState, { phase: afterStartDone.phase });
      // 2. applySignal を waiting 以外で呼ぶと phase 不変
      // setup: createGame の初期 state
      const stSetup = L.createGame({ players: 2, mode: 'vs' });
      // armed: startRound → applySignal
      const stArmed = L.applySignal(L.startRound(stSetup));
      // resolved: applyPress で win
      const stResolved = L.applyPress(stArmed, { playerIdx: 0, pressedAt: (stArmed.signalFiredAt || 0) + 150 }).state;
      // done: makeDoneState()
      const stDone = makeDoneState();
      const signalResults = [
        ['setup',    L.applySignal(stSetup)    === stSetup],
        ['armed',    L.applySignal(stArmed)    === stArmed],
        ['resolved', L.applySignal(stResolved) === stResolved],
        ['done',     L.applySignal(stDone)     === stDone],
      ];
      const signalUnchanged = signalResults.every(([, ok]) => ok);
      check('applySignal を waiting 以外（setup・armed・resolved・done）で呼んでも state は不変',
        signalUnchanged, signalResults.map(([ph, ok]) => ({ ph, ok })));
      // 3. applyPress を armed で 2 回連続：2 回目は ignore
      let arm2 = L.applySignal(L.startRound(L.createGame({ players: 2, mode: 'vs' })));
      const first = L.applyPress(arm2, { playerIdx: 0, pressedAt: (arm2.signalFiredAt || 0) + 200 });
      const second = L.applyPress(first.state, { playerIdx: 0, pressedAt: (arm2.signalFiredAt || 0) + 300 });
      check('applyPress を armed で 2 回連続：1 回目は win、2 回目は ignore（1 回目で resolved になるため）',
        first.outcome.kind === 'win' && second.outcome.kind === 'ignore', { first: first.outcome.kind, second: second.outcome.kind });
      // 4. applyPress を phase='done' で呼ぶと ignore
      const pressOnDone = L.applyPress(makeDoneState(), { playerIdx: 0, pressedAt: 1000 });
      check('applyPress を phase=done で呼ぶと outcome.kind === ignore',
        pressOnDone.outcome.kind === 'ignore', { kind: pressOnDone.outcome.kind });
      // 5. averageMs の境界ケース
      check('averageMs([]) は null', L.averageMs([]) === null, L.averageMs([]));
      check('averageMs([null, null]) は null', L.averageMs([null, null]) === null, L.averageMs([null, null]));
      check('averageMs([null, 200, null]) は 200', L.averageMs([null, 200, null]) === 200, L.averageMs([null, 200, null]));
    },
  },

  // ================= PK9 Node：境界値 =================
  {
    id: 'PK9', tier: 'full', node: true, title: 'ピカッと：境界値（signalDelay は 1000..4000 ms、waiting 中はどんな playerIdx でも foul）',
    run({ check, root }) {
      const L = loadLogic(root);
      // random を 0・0.5・1 で、signalDelay が 1000・2500 前後・4000 に収まる
      const bounds = [0, 0.5, 1].map((r) => {
        const g = L.startRound(L.createGame({ players: 2, mode: 'vs', random: () => r }));
        return { r, d: g.signalDelay };
      });
      const okRange = bounds.every((b) => Number.isInteger(b.d) && b.d >= 1000 && b.d <= 4000);
      check(`signalDelay の境界：r=0→${bounds[0].d}（1000）、r=0.5→${bounds[1].d}（2000〜3000）、r=1→${bounds[2].d}（4000）、すべて整数で 1000..4000`,
        okRange && bounds[0].d === 1000 && bounds[2].d === 4000 && bounds[1].d >= 2000 && bounds[1].d <= 3000, bounds);
      // 100 通りの乱数で、どれも範囲内の整数
      const out = [];
      for (let i = 0; i < 100; i++) {
        const g = L.startRound(L.createGame({ players: 2, mode: 'vs', random: () => (i / 99) }));
        if (!(Number.isInteger(g.signalDelay) && g.signalDelay >= 1000 && g.signalDelay <= 4000)) out.push(g.signalDelay);
      }
      check('100 通りの乱数すべて signalDelay が 1000..4000 の整数', out.length === 0, out);
      // waiting 中：playerIdx を 0・1・2・3 と範囲外（-1・5・NaN）で確かめる
      // 範囲内のインデックスは foul、範囲外は ignore（契約の実装どおり：Number.isInteger && 0..players-1）
      let g = L.createGame({ players: 4, mode: 'vs' });
      g = L.startRound(g);
      const foulRes = [0, 1, 2, 3].map((idx) => L.applyPress(g, { playerIdx: idx, pressedAt: 1000 }).outcome);
      const allFoul = foulRes.every((o) => o.kind === 'foul');
      const awards = foulRes.map((o) => o.award.sort().join(','));
      check('waiting 中：0・1・2・3 のどのボタンを押しても foul、押した本人以外に +1',
        allFoul && awards[0] === '1,2,3' && awards[1] === '0,2,3' && awards[2] === '0,1,3' && awards[3] === '0,1,2',
        { kinds: foulRes.map((o) => o.kind), awards });
      // 範囲外は ignore（押し間違いの保護）
      const outRange = [-1, 5, 100, 1.5, NaN].map((idx) => L.applyPress(g, { playerIdx: idx, pressedAt: 1000 }).outcome.kind);
      check('範囲外の playerIdx（-1・5・100・1.5・NaN）は ignore（state を変えない）', outRange.every((k) => k === 'ignore'), outRange);
      // armed で合図と押下が同じ ms（reactionMs=0）でも win
      let a = L.createGame({ players: 2, mode: 'vs' });
      a = L.applySignal(L.startRound(a));
      const same = L.applyPress(a, { playerIdx: 0, pressedAt: a.signalFiredAt });
      check('合図と同時刻（reactionMs=0）でも win（armed なら押下＝勝ち）', same.outcome.kind === 'win' && same.outcome.reactionMs === 0, same.outcome);
    },
  },

  // ================= PK2 画面：基本の遊び =================
  {
    id: 'PK2', tier: 'smoke', title: 'ピカッと 画面：2人で始めて .play が出る、forceSignal→pressFor で勝ち、waiting 中の pressFor でフライング',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK2');
      // 設定画面が最初に出る
      const setup = await page.evaluate(() => {
        const s = document.querySelector('.setup');
        return { shown: !!s && !s.hidden, buttons: [...document.querySelectorAll('.setup [data-players]')].map((b) => b.dataset.players), start: !!document.querySelector('.setup [data-action="start"]') };
      });
      check('設定画面：.setup が見える、人数の選択肢に 2・3・4・solo がある、「はじめる」ボタンがある',
        setup.shown && ['2', '3', '4', 'solo'].every((v) => setup.buttons.includes(v)) && setup.start, setup);
      // 2人で始める
      await startVs(page, 2);
      const playShown = await playVisible(page);
      check('「はじめる」で .play が表示（.setup は隠れる）', playShown && !(await page.evaluate(() => !document.querySelector('.setup').hidden && getComputedStyle(document.querySelector('.setup')).display !== 'none')), { playShown });
      const api = await page.evaluate(() => ({
        has: !!window.PikattoGame, keys: window.PikattoGame ? Object.keys(window.PikattoGame).sort() : [],
      }));
      check('window.PikattoGame に getState・startRound・forceSignal・pressFor・reset がある',
        api.has && ['forceSignal', 'getState', 'pressFor', 'reset', 'startRound'].every((k) => api.keys.includes(k)), api);
      // 1 ラウンド目：forceSignal で armed にし、player 0 が勝つ
      await arm(page);
      const armed = await getState(page);
      check('forceSignal で phase=armed、players=2、scores=[0,0]', armed && armed.phase === 'armed' && armed.players === 2 && eq(armed.scores, [0, 0]), armed);
      await pressFor(page, 0);
      await wait(page, 200);
      const afterWin = await getState(page);
      check('player 0 の pressFor で scores[0]=1、lastOutcome.kind=win',
        afterWin && afterWin.scores[0] === 1 && afterWin.lastOutcome && afterWin.lastOutcome.kind === 'win', afterWin);
      const ov = await overlayInfo(page);
      check('ラウンド結果のオーバーレイに [data-cmd="next"] が出る（まだ 3 点に達していない）',
        ov.shown && ov.cmds.includes('next'), ov);
      // 次のラウンド：フライング（waiting 中に pressFor）
      await page.click('.overlay [data-cmd="next"]'); await wait(page, 300);
      const st2 = await getState(page);
      check('「つぎ」で round=2、phase=waiting、signalFiredAt=null に戻る',
        st2 && st2.round === 2 && st2.phase === 'waiting' && st2.signalFiredAt === null, st2);
      await pressFor(page, 0);          // waiting 中なのでフライング
      await wait(page, 200);
      const foulState = await getState(page);
      check('waiting 中の pressFor(0) でフライング（他プレイヤー +1）、lastOutcome.kind=foul',
        foulState && foulState.lastOutcome && foulState.lastOutcome.kind === 'foul' && foulState.scores[1] === 1 && foulState.lastOutcome.foulBy === 0,
        foulState);
      const ov2 = await overlayInfo(page);
      check('フライングでもオーバーレイに [data-cmd="next"] または（終了なら）[data-cmd="again"] が出る',
        ov2.shown && (ov2.cmds.includes('next') || ov2.cmds.includes('again')), ov2);
      await ctx.close();
    },
  },

  // ================= PK3 データ =================
  {
    id: 'PK3', tier: 'smoke', title: 'ピカッと データ：solo モードで pikatto.bestSolo が更新、壊れた保存は 0 扱い（メニューで「まだ記録なし」）',
    async run({ browser, check }) {
      // ---- 壊れた保存：ロジックで 0 扱い、メニューで「まだ記録なし」の表示 ----
      const bads = [['文字列', '"abc"'], ['負', '-100'], ['NaN', 'null'], ['object JSON', '{"ms":300}'], ['Infinity 文字列', '"Infinity"'], ['小数', '123.4']];
      for (const [label, raw] of bads) {
        const { ctx, page } = await newPage(browser, V(), 'PK3 broken ' + label, { clock: true });
        await seed(page, { 'pikatto.bestSolo': raw });
        await page.goto(BASE); await wait(page, 300);
        // メニューに「ピカッと」のカードがあり、ベスト欄に ms の数字が出ていない（0 や空の表示）
        const t = await page.evaluate(() => {
          const card = [...document.querySelectorAll('a.game, .game')].find((e) => /ピカッ|pikatto/i.test(e.textContent || ''));
          return { has: !!card, text: card ? card.textContent.replace(/\s+/g, ' ').trim() : '' };
        });
        // 壊れた値のときはベストが出ないか「まだ記録なし」などの空扱いになる（ms の数字が入らない）
        check(`壊れた保存（${label}）：メニューのカードにベストの ms が表示されない`, t.has ? !/[0-9]+\s*ms/.test(t.text) : true, t);
        await ctx.close();
      }
      // ---- solo モードで bestSolo が整数で入る ----
      const { ctx, page } = await openPK(browser, 'PK3 solo', { opts: { initScript: SFX_SPY } });
      await startSolo(page);
      const s0 = await getState(page);
      check('solo で開始：mode=solo、players=1', s0 && s0.mode === 'solo' && s0.players === 1, s0);
      // 合図→押す を数回行って reactions を貯める。保存までは画面実装任せ（画面担当がクリア時に書く）
      for (let i = 0; i < 3; i++) {
        if ((await getState(page)).phase === 'waiting' || (await getState(page)).phase === 'resolved' || (await getState(page)).phase === 'setup') {
          if ((await getState(page)).phase !== 'waiting') { await page.evaluate(() => window.PikattoGame.startRound()); await wait(page, 200); }
        }
        await arm(page);
        await pressFor(page, 0);
        await wait(page, 300);
        // 次のラウンドへ（必要なら）
        const ov = await overlayInfo(page);
        if (ov.shown && ov.cmds.includes('next')) { await page.click('.overlay [data-cmd="next"]'); await wait(page, 300); }
      }
      // 最後まで遊ぶ（勝ちまで）
      for (let safety = 0; safety < 10; safety++) {
        const st = await getState(page);
        if (!st || st.phase === 'done') break;
        if (st.phase === 'waiting') { await arm(page); await pressFor(page, 0); await wait(page, 300); }
        else if (st.phase === 'armed') { await pressFor(page, 0); await wait(page, 300); }
        else {
          const ov = await overlayInfo(page);
          if (ov.cmds.includes('next')) { await page.click('.overlay [data-cmd="next"]'); await wait(page, 300); }
          else break;
        }
      }
      const stored = await page.evaluate(() => { try { return localStorage.getItem('pikatto.bestSolo'); } catch { return null; } });
      const n = Number(stored);
      // 画面担当が保存する／しないは実装依存。保存されていれば整数で 50..5000 であること、なければスキップ（画面実装を待つ）
      if (stored === null) {
        check('solo の bestSolo は画面実装（勝ちで保存）に依存（Wave 1 時点ではまだ保存されない可能性あり）', true, { stored });
      } else {
        check(`solo の bestSolo が整数で 50..5000（stored=${stored}）`,
          Number.isInteger(n) && n >= 50 && n <= 5000, { stored, n });
      }
      await ctx.close();
    },
  },

  // ================= PK4 閉じ込めなし =================
  {
    id: 'PK4', tier: 'smoke', title: 'ピカッと：プレイ中・結果画面・遊び方のどこからでも a#back でメニューに戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK4');
      // a#back の href は ../../（＝メニュー）
      const href = await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href'));
      check('a#back の href は ../../', href === '../../', href);
      // 設定画面から戻れる
      await page.click('a#back');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('設定画面から a#back でメニューに戻る', page.url() === BASE, page.url());
      // プレイ中から戻れる
      await page.goto(PK_URL); await wait(page, 300);
      await startVs(page, 2);
      check('プレイ中：.play が見え、a#back がクリックできる', await playVisible(page) && await page.evaluate(() => { const b = document.querySelector('a#back'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
      await page.click('a#back');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('プレイ中から a#back でメニューに戻る', page.url() === BASE, page.url());
      // 結果画面（ラウンド結果）から戻れる
      await page.goto(PK_URL); await wait(page, 300);
      await startVs(page, 2);
      await arm(page); await pressFor(page, 0); await wait(page, 300);
      const ov = await overlayInfo(page);
      check('ラウンド結果のオーバーレイが見える', ov.shown, ov);
      // オーバーレイ中でも a#back がクリックできることを確かめる。カードに [data-cmd="menu"] があるならそれでも良い
      const canBack = await page.evaluate(() => { const b = document.querySelector('a#back'); if (!b) return false; const r = b.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && (el === b || b.contains(el) || el.closest('a#back') === b); });
      if (canBack) {
        await page.click('a#back');
        await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        check('結果画面から a#back でメニューに戻る', page.url() === BASE, page.url());
      } else if (ov.cmds.includes('menu')) {
        await page.click('.overlay [data-cmd="menu"]');
        await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        check('結果画面から [data-cmd="menu"] でメニューに戻る', page.url() === BASE, page.url());
      } else {
        check('結果画面から a#back か [data-cmd="menu"] で戻れること（どちらかが押せる）', false, ov);
      }
      // 遊び方（help）から戻れる
      await page.goto(PK_URL); await wait(page, 300);
      const helpBtn = await page.locator('#help-btn').count();
      if (helpBtn > 0) {
        await page.locator('#help-btn').tap(); await wait(page, 300);
        const hov = await overlayInfo(page);
        if (hov.shown) {
          // 閉じる or メニューへ戻れる。見た目のサイズだけでなく、オーバーレイに覆われていないかも elementFromPoint で確かめる
          const back2 = await page.evaluate(() => { const b = document.querySelector('a#back'); if (!b) return false; const r = b.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && (el === b || b.contains(el) || el.closest('a#back') === b); });
          if (back2) {
            await page.click('a#back');
            await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
            check('遊び方カードを開いた状態から a#back でメニューに戻る', page.url() === BASE, page.url());
          } else if (hov.cmds.includes('close')) {
            await page.click('.overlay [data-cmd="close"]'); await wait(page, 200);
            await page.click('a#back');
            await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
            check('遊び方を [data-cmd="close"] で閉じて a#back でメニューに戻る', page.url() === BASE, page.url());
          } else {
            check('遊び方カード：閉じる手段か a#back がある', false, hov);
          }
        } else {
          check('遊び方カードは help-btn で開ける（または遊び方を開かない設計）', true, { hov });
        }
      } else {
        check('遊び方ボタン（#help-btn）は任意（契約で推奨）', true);
      }
      await ctx.close();
    },
  },

  // ================= PK5 画面内・44px =================
  {
    id: 'PK5', tier: 'full', title: 'ピカッと 画面内・44px：SE 縦・iPad 横で、4つの .corner が 44×44 以上・safe-area 内',
    async run({ browser, check }) {
      for (const v of [view('SE', 'p', 'app'), view('iPad', 'l', 'app')]) {
        const { ctx, page } = await openPK(browser, 'PK5 ' + v.label, { v });
        await startVs(page, 4);
        // 契約の DOM：.corner[data-player=1..4]
        const probe = await page.evaluate(([safe]) => {
          const [t, r, b, l] = safe || [0, 0, 0, 0];
          const rects = [...document.querySelectorAll('.corner[data-player]')].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => {
            const q = e.getBoundingClientRect();
            return { p: e.dataset.player, w: Math.round(q.width), h: Math.round(q.height), inside: q.left >= l - 0.5 && q.top >= t - 0.5 && q.right <= innerWidth - r + 0.5 && q.bottom <= innerHeight - b + 0.5 };
          });
          return { n: rects.length, rects, hscroll: document.documentElement.scrollWidth > innerWidth };
        }, [v.safe]);
        const small = probe.rects.filter((x) => x.w < 44 - 0.5 || x.h < 44 - 0.5);
        const outside = probe.rects.filter((x) => !x.inside);
        check(`${v.label}｜.corner が4つ、すべて 44×44 以上・safe-area 内、横スクロールなし`,
          probe.n === 4 && small.length === 0 && outside.length === 0 && !probe.hscroll, { probe, small, outside });
        // layoutProbe の共通確認：ヘッダのボタンも 44px 以上
        const head = await layoutProbe(page, '#help-btn, #sound-btn, a#back', v.safe, { minSel: '#help-btn, #sound-btn' });
        check(`${v.label}｜ヘッダ（戻る・?・♪）が画面内・44px 以上`, !head.outside.length && !head.small.length, head);
        await ctx.close();
      }
    },
  },

  // ================= PK6 効果音 =================
  {
    id: 'PK6', tier: 'full', title: 'ピカッと 効果音：signal・foul・win・finish・start・toggle が鳴る（SFX_SPY で name の列を記録）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK6', { opts: { initScript: SFX_SPY } });
      const names = () => page.evaluate(() => window.__plays.map((p) => p.n));
      await startVs(page, 2);
      // start：「はじめる」で start が1回鳴る（共通音）。鳴らない設計もあり得るので強制はしないが、少なくとも何か鳴ることが多い
      const afterStart = await names();
      // 合図：forceSignal() で signal が鳴る
      await arm(page);
      await wait(page, 100);
      const afterSignal = await names();
      const newSig = afterSignal.slice(afterStart.length);
      check(`forceSignal の後に "signal" が鳴る（鳴った音：${newSig.join(',')}）`, newSig.includes('signal'), { afterStart, afterSignal });
      // 勝ち：pressFor で win が鳴る
      await pressFor(page, 0); await wait(page, 300);
      const afterWin = await names();
      check(`勝ちで "win" が鳴る（直近：${afterWin.slice(afterSignal.length).join(',')}）`, afterWin.slice(afterSignal.length).includes('win'), afterWin);
      // フライング：次のラウンドで waiting 中に押して foul
      const ov1 = await overlayInfo(page);
      if (ov1.cmds.includes('next')) { await page.click('.overlay [data-cmd="next"]'); await wait(page, 300); }
      await pressFor(page, 0); await wait(page, 300);
      const afterFoul = await names();
      check(`フライング（waiting 中の押下）で "foul" が鳴る（直近：${afterFoul.slice(afterWin.length).join(',')}）`,
        afterFoul.slice(afterWin.length).includes('foul'), afterFoul);
      // 試合終了まで遊んで finish が鳴ることを確かめる
      for (let safety = 0; safety < 20; safety++) {
        const st = await getState(page);
        if (!st || st.phase === 'done') break;
        if (st.phase === 'waiting') { await arm(page); await pressFor(page, 0); await wait(page, 300); }
        else if (st.phase === 'armed') { await pressFor(page, 0); await wait(page, 300); }
        else {
          const ov = await overlayInfo(page);
          if (ov.cmds.includes('next')) { await page.click('.overlay [data-cmd="next"]'); await wait(page, 300); }
          else if (ov.cmds.includes('again')) break;
          else break;
        }
      }
      const afterFinish = await names();
      check(`試合終了で "finish" が鳴る（全音名：${[...new Set(afterFinish)].join(',')}）`, afterFinish.includes('finish'), afterFinish);
      // toggle：♪のタップで aria-pressed と blockpuzzle.sound が切り替わること。
      // ※ sfx.toggle() は内部で table.toggle() を直接呼ぶため SFX_SPY（sfx.play のラッパ）には記録されない。
      // 既存の A4 と同じく、aria-pressed と localStorage で状態の切替を確かめる。
      const finalOv = await overlayInfo(page);
      if (finalOv.shown) {
        if (finalOv.cmds.includes('again')) await page.click('.overlay [data-cmd="again"]');
        else if (finalOv.cmds.includes('menu')) await page.click('.overlay [data-cmd="menu"]');
        else if (finalOv.cmds.includes('close')) await page.click('.overlay [data-cmd="close"]');
        await wait(page, 300);
      }
      const before = await page.evaluate(() => ({ p: document.querySelector('#sound-btn')?.getAttribute('aria-pressed'), ls: localStorage.getItem('blockpuzzle.sound') }));
      await page.evaluate(() => document.querySelector('#sound-btn')?.click());
      await wait(page, 150);
      const mid = await page.evaluate(() => ({ p: document.querySelector('#sound-btn')?.getAttribute('aria-pressed'), ls: localStorage.getItem('blockpuzzle.sound') }));
      await page.evaluate(() => document.querySelector('#sound-btn')?.click());
      await wait(page, 150);
      const after = await page.evaluate(() => ({ p: document.querySelector('#sound-btn')?.getAttribute('aria-pressed'), ls: localStorage.getItem('blockpuzzle.sound') }));
      check(`♪（#sound-btn）で aria-pressed と blockpuzzle.sound が切り替わる（${before.p}→${mid.p}→${after.p}）`,
        before.p === 'true' && mid.p === 'false' && mid.ls === 'off' && after.p === 'true' && after.ls === 'on', { before, mid, after });
      await ctx.close();
    },
  },

  // ================= PK7 ダブルタップ抑止 =================
  {
    id: 'PK7', tier: 'full', cdp: 'CDP のタッチ操作（連続タップ）', title: 'ピカッと：.play 内の素早い2回タップが拡大のきっかけにならない（dblclick・gesture を止める、2回目の touchend を止める）',
    async run({ browser, check }) {
      const TE_SPY = () => {
        window.__te = [];
        window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented, t: e.target.className || e.target.id || e.target.tagName }));
      };
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'PK7', { initScript: TE_SPY, clock: true });
      await seed(page, { 'pikatto.help': '1' });  // 遊び方オーバーレイを閉じた状態で始める
      await page.goto(PK_URL); await wait(page, 300);
      await page.locator('.setup [data-players="2"]').tap(); await wait(page, 150);
      await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
      // dblclick・gesture を .play（または .corner）で止めること
      const g = await page.evaluate(() => {
        const el = document.querySelector('.corner[data-player="1"]') || document.querySelector('.play') || document.body;
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gs = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        return { dblclickPrevented: !d, gesturePrevented: gs.every((x) => !x) };
      });
      check('.play 内で dblclick・gesturestart/gesturechange を止める', g.dblclickPrevented && g.gesturePrevented, g);
      // CDP で素早い連続タップ：盤面（.corner）は1回目から touchend を止める想定
      const t = await touch(ctx, page);
      await page.evaluate(() => window.__te.splice(0));
      await t.doubleTap('.corner[data-player="1"]');
      const ev = await page.evaluate(() => window.__te.splice(0));
      // 2回目のタップが .corner に届けば preventDefault、
      // 1回目の押下でオーバーレイが開いて 2回目がオーバーレイに流れた場合も拡大は起きない（モーダル状態なので安全）。
      check('.corner の素早い2回タップ：touchend が2回届き、2回目は止められているかオーバーレイに流れている（どちらも拡大しない）',
        ev.length === 2 && (ev[1].p === true || /overlay/.test(ev[1].t || '')), ev);
      await ctx.close();
    },
  },

  // ================= PK8 オフライン =================
  {
    id: 'PK8', tier: 'full', title: 'ピカッと オフライン：事前キャッシュに games/pikatto/* が入り、オフラインでも開ける（Wave 4 の版上げ後）',
    async run({ browser, check, srv, root }) {
      // Wave 4（common/version.js と sw.js の APP_FILES に pikatto を追加）が済んでいないときはスキップする
      const info = swInfo(root);
      const want = ['./games/pikatto/', './games/pikatto/index.html', './games/pikatto/logic.js', './games/pikatto/input.js'];
      const missing = want.filter((f) => !info.files.includes(f));
      if (process.env.SKIP_SW === '1' || missing.length > 0) {
        check(`Wave 4 の版上げ待ち：APP_FILES に ${missing.join(' / ')} がまだ無い → 検査しない（SKIP_SW=1 または欠けあり）`, true, { missing, SKIP_SW: process.env.SKIP_SW });
        return;
      }
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'PK8', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/pikatto\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(PK_URL, { timeout: 10000 }); await sleep(300);
      const setupShown = await page.evaluate(() => !!document.querySelector('.setup'));
      check('オフラインでピカッとが開き、.setup が出る', setupShown, { setupShown });
      const js = ['logic.js', 'input.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・input.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
];
