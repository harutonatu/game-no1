// PK: ピカッと早押し（games/pikatto/）。
//   Node で logic.js・input.js を直接読む PK1・PK9・PK14、静的検査の PK10（ブラウザ不要）、画面のテスト PK2〜PK8・PK11〜PK13・PK15〜PK18。
//   画面の DOM は契約（docs/pikatto-contract.md §5）だけに頼る：
//     a#back・.setup・.setup [data-players=…]・.setup [data-action="start"]・.play・.corner[data-player="1..4"]・
//     #field[data-phase]（ready/waiting/armed/resolved/paused）・#field[data-players]・#signal・#hint・#scores・
//     .overlay・.overlay .card[data-final/data-best]・.overlay [data-cmd=next/again/menu/close/resume]・#help-btn・#sound-btn。
//   テスト用の公開 API（契約 §9）：window.PikattoGame = { getState, startRound, forceSignal, pressFor(idx, ts?), reset }。
//     forceSignal() は「よーい」と 1〜4 秒の待ちを飛ばして即 'armed' にする（早送り用）。
//     pressFor(idx, ts) は受付の窓を通さずロジックに渡す。ready・paused 中は無視して false。
//
// 大事な前提：page.clock を使っていても event.timeStamp は本物の時刻のまま進む（performance.now だけが早送りされる）。
//   だから勝ち負け（だれが勝ったか・反応時間）は pressFor(idx, ts) で確かめ、実際のタップのテストでは勝ち負けを見ない
//   （画面が進む・カードが出る、だけを見る）。実際のイベントで勝ち負けを見る PK18 は早送りを使わない。
// 「よーい」（約 1000ms、PK-05）があるので、waiting 中に押したいときは時計を READY_MS（1300ms）進めてから押す。
//   待ち時間は 1000ms 以上なので、よーい（〜1200ms 程度まで）＋待ちの途中に必ず入る。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY } from '../lib.mjs';

const PK_URL = BASE + 'games/pikatto/';
const V = () => view('i13', 'p', 'app');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const READY_MS = 1300;          // よーいを越えて waiting に入るまで進める時間
const CARD_LOCK_MS = 650;       // 結果カードのボタンが押せるようになるまで（600ms、PK-11）

// ---------- Node：logic.js・input.js を読む ----------
function loadFresh(root, rel) {
  const req = createRequire(import.meta.url);
  const p = path.join(root, rel);
  delete req.cache[req.resolve(p)];
  return req(p);
}
const loadLogic = (root) => loadFresh(root, 'games/pikatto/logic.js');
const loadInput = (root) => loadFresh(root, 'games/pikatto/input.js');

// ---------- 画面：共通の操作 ----------
async function openPK(browser, label, { v = V(), opts = {}, extra = {} } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  // 初回のみ出る遊び方オーバーレイを閉じた状態で始める（既存ゲームの zenmai.help・irocode.help と同じ流儀）
  await seed(page, { 'pikatto.help': '1', ...extra });
  await page.goto(PK_URL); await wait(page, 300);
  return { ctx, page };
}
// 人数を選んで「はじめる」（「よーい」の途中で戻る）
async function startVs(page, n) {
  await page.locator(`.setup [data-players="${n}"]`).tap(); await wait(page, 150);
  await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
}
const startSolo = (page) => startVs(page, 'solo');
const getState = (p) => p.evaluate(() => window.PikattoGame && window.PikattoGame.getState());
const fieldPhase = (p) => p.evaluate(() => document.querySelector('#field')?.dataset.phase);
const playVisible = (p) => p.evaluate(() => { const e = document.querySelector('.play'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.hidden; });
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('.overlay');
  const shown = !!ov && !ov.hidden && getComputedStyle(ov).display !== 'none';
  const card = ov && ov.querySelector('.card');
  const cmds = shown ? [...ov.querySelectorAll('.card [data-cmd]')].filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed').map((b) => b.dataset.cmd) : [];
  return {
    shown, cmds,
    final: shown && card ? card.dataset.final || null : null,
    best: shown && card ? card.dataset.best || null : null,
    text: shown && card ? (card.textContent || '').replace(/\s+/g, ' ').trim() : '',
  };
});
// 合図を飛ばして armed にする（よーい中でも効く。契約 §9）
async function arm(page) { await page.evaluate(() => window.PikattoGame.forceSignal()); await wait(page, 50); }
// pressFor(idx, ts)。ts を省くと画面の既定（performance.now()）
async function pressFor(page, idx, ts = null) {
  const r = await page.evaluate(([i, t]) => (t === null ? window.PikattoGame.pressFor(i) : window.PikattoGame.pressFor(i, t)), [idx, ts]);
  await wait(page, 100);
  return r;
}
// 合図から ms 後に押したことにする（勝ち負けと反応時間を決め打ちで確かめる）
async function pressAfter(page, idx, ms) {
  const r = await page.evaluate(([i, m]) => { const s = window.PikattoGame.getState(); return window.PikattoGame.pressFor(i, s.signalFiredAt + m); }, [idx, ms]);
  await wait(page, 100);
  return r;
}
// 結果カードのボタン（出してから 600ms は押せない、PK-11）
async function cmd(page, name) {
  await wait(page, CARD_LOCK_MS);
  await page.click(`.overlay [data-cmd="${name}"]`);
  await wait(page, 100);
}
// 決められた順にラウンドを進める。数字はその人の勝ち、'f2' は 2 番の人（0 始まり）のフライング
async function playRounds(page, seq, ms = 200) {
  for (let k = 0; k < seq.length; k++) {
    if (k > 0) await cmd(page, 'next');
    const s = seq[k];
    if (typeof s === 'string' && s[0] === 'f') { await wait(page, READY_MS); await pressFor(page, Number(s.slice(1))); }
    else { await arm(page); await pressAfter(page, s, ms); }
  }
}
// 最終カードが出るまで待ってから中身を読む
async function finalCard(page) { await wait(page, 700); return overlayInfo(page); }
// 裏に回した／戻したことにする（document.hidden を差し替えて visibilitychange を送る）
const setHidden = (page, h) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}, h);
// 見えている隅のボタンの矩形と、矩形どうしの交わり
const cornerRects = (p) => p.evaluate(() => [...document.querySelectorAll('.corner[data-player]')]
  .filter((e) => !e.hidden && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0)
  .map((e) => { const q = e.getBoundingClientRect(); return { p: Number(e.dataset.player), x: q.left, y: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; }));
function intersections(rs) {
  const out = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const A = rs[i], B = rs[j];
    if (A.x < B.r - 0.5 && B.x < A.r - 0.5 && A.y < B.b - 0.5 && B.y < A.b - 0.5) out.push(`${A.p}P×${B.p}P`);
  }
  return out;
}
// カードの見出しが切れず、全ボタンに（必要ならスクロールして）届き、横にはみ出さない
const cardFit = (p) => p.evaluate(() => {
  const ov = document.querySelector('.overlay'), card = ov && ov.querySelector('.card');
  if (!card) return { ok: false, why: 'card なし' };
  ov.scrollTop = 0;
  const head = card.querySelector('h1, h2');
  const headTop = head ? head.getBoundingClientRect().top : -1;
  const btns = [...card.querySelectorAll('button')].map((b) => { b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { t: b.textContent, reach: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, h: r.height }; });
  ov.scrollTop = 0;
  const wide = [...card.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.tagName + '.' + e.className);
  const cr = card.getBoundingClientRect();
  const hscroll = document.documentElement.scrollWidth > innerWidth;
  return { ok: headTop >= 0 && btns.length > 0 && btns.every((x) => x.reach && x.h >= 43.5) && !wide.length && cr.left >= -0.5 && cr.right <= innerWidth + 0.5 && !hscroll, headTop, btns, wide, hscroll, card: [cr.left, cr.right] };
});

export const tests = [
  // ================= PK1 Node：ロジック =================
  {
    id: 'PK1', tier: 'smoke', node: true, title: 'ピカッと：ロジック（armed で勝ち・waiting でフライング・負の時刻はフライング・3点先取・5回で終わり・れんしゅうは5回で終わり・同点は引き分け・redoRound・validateBestSolo）',
    run({ check, root }) {
      const L = loadLogic(root);
      // 乱数と時計を注入して決定的に動かす
      const mkRng = (seq) => { let i = 0; return () => seq[(i++) % seq.length]; };
      const mkNow = (start) => { let t = start; return () => (t += 10); };
      // --- 基本の勝ち ---
      let st = L.createGame({ players: 2, mode: 'vs', random: mkRng([0.5]), now: mkNow(1000) });
      check('createGame は seed を持たない（PK-24）', !('seed' in st), Object.keys(st));
      st = L.startRound(st);
      check('startRound で phase=waiting、round=1、signalDelay が 1000..4000 の整数、scores は 0,0',
        st.phase === 'waiting' && st.round === 1 && Number.isInteger(st.signalDelay) && st.signalDelay >= 1000 && st.signalDelay <= 4000 && eq(st.scores, [0, 0]) && st.signalFiredAt === null,
        st);
      st = L.applySignal(st);
      check('applySignal で phase=armed、signalFiredAt が now()', st.phase === 'armed' && typeof st.signalFiredAt === 'number', { phase: st.phase, fired: st.signalFiredAt });
      const { state: st2, outcome } = L.applyPress(st, { playerIdx: 0, pressedAt: st.signalFiredAt + 250 });
      check('armed で player 0 が押すと win、scores[0] が +1、reactionMs=250、他は 0',
        outcome.kind === 'win' && outcome.player === 0 && outcome.reactionMs === 250 && eq(st2.scores, [1, 0]) && st2.phase === 'resolved',
        { outcome, scores: st2.scores, phase: st2.phase });
      // --- 合図より前の時刻の押下（受付の窓で後から届いたもの）はフライング、同時刻は 0ms の勝ち（PK-10） ---
      const early = L.applyPress(st, { playerIdx: 1, pressedAt: st.signalFiredAt - 1 });
      check('armed でも pressedAt < signalFiredAt（1ms 前）なら foul、押した本人以外に +1（PK-10）',
        early.outcome.kind === 'foul' && early.outcome.foulBy === 1 && eq(early.state.scores, [1, 0]) && early.state.phase === 'resolved', early.outcome);
      const early2 = L.applyPress(st, { playerIdx: 0, pressedAt: st.signalFiredAt - 500 });
      check('armed で 500ms 前の押下も foul（反応時間が負の勝ちにならない）', early2.outcome.kind === 'foul' && !(early2.outcome.reactionMs < 0), early2.outcome);
      const same0 = L.applyPress(st, { playerIdx: 1, pressedAt: st.signalFiredAt });
      check('armed で pressedAt === signalFiredAt は reactionMs=0 の win', same0.outcome.kind === 'win' && same0.outcome.player === 1 && same0.outcome.reactionMs === 0, same0.outcome);
      // --- waiting でのフライング ---
      let f = L.createGame({ players: 3, mode: 'vs', random: mkRng([0.1]) });
      f = L.startRound(f);
      const r = L.applyPress(f, { playerIdx: 1, pressedAt: 2000 });
      check('waiting でどのボタンを押しても foul、他プレイヤー全員に +1（押した本人は 0 のまま）',
        r.outcome.kind === 'foul' && r.outcome.foulBy === 1 && eq([...r.outcome.award].sort(), [0, 2]) && eq(r.state.scores, [1, 0, 1]) && r.state.phase === 'resolved',
        r);
      // --- 決められた順にラウンドを進めるヘルパー（数字は勝ち、'fN' は N のフライング） ---
      const play = (players, seq) => {
        let g = L.createGame({ players, mode: 'vs', now: mkNow(5000) });
        const trail = [];
        for (const s of seq) {
          g = L.startRound(g);
          if (typeof s === 'string') g = L.applyPress(g, { playerIdx: Number(s.slice(1)), pressedAt: 1 }).state;
          else { g = L.applySignal(g); g = L.applyPress(g, { playerIdx: s, pressedAt: g.signalFiredAt + 200 }).state; }
          trail.push({ round: g.round, phase: g.phase, scores: g.scores.slice(), winner: g.winner });
        }
        return { g, trail };
      };
      // --- 3点先取で phase='done'、winner が整数 ---
      const w3 = play(2, [0, 0, 0]);
      check('player 0 だけが3回勝つと phase=done、winner=0、decideWinner も 0', w3.g.phase === 'done' && w3.g.winner === 0 && L.decideWinner(w3.g) === 0 && eq(w3.g.scores, [3, 0]), w3.trail);
      // --- 5回で終わり（MP6：round >= maxRounds の上限）---
      const d5 = play(3, [0, 1, 2, 0, 1]);
      check('3人で 0,1,2,0,1 の順に勝つ：4回目までは resolved、5回目で phase=done・winner="draw"（2,2,1 の同点。サドンデスなし、PK-20）',
        d5.trail.slice(0, 4).every((t) => t.phase === 'resolved') && d5.g.phase === 'done' && d5.g.winner === 'draw' && L.decideWinner(d5.g) === 'draw' && d5.g.round === 5 && eq(d5.g.scores, [2, 2, 1]), d5.trail);
      check('5回で終わった後の startRound は何もしない（6回目に進まない）', L.startRound(d5.g).round === 5 && L.startRound(d5.g).phase === 'done', L.startRound(d5.g));
      const w5 = play(4, [0, 1, 2, 0, 3]);
      check('4人で 0,1,2,0,3 の順に勝つ：5回目で phase=done、最高点 2 の 1P が winner=0（3点に届かなくても5回で決まる）',
        w5.g.phase === 'done' && w5.g.winner === 0 && eq(w5.g.scores, [2, 1, 1, 1]) && w5.trail[3].phase === 'resolved', w5.trail);
      // --- フライングの award で 2 人が同時に 3 点 → 引き分け ---
      const fd = play(3, [0, 1, 0, 1, 'f2']);
      check('3人で 2,2,0 のときに 3P がフライング → 3,3,0 で phase=done・winner="draw"', fd.g.phase === 'done' && fd.g.winner === 'draw' && eq(fd.g.scores, [3, 3, 0]), fd.trail);
      // --- redoRound（PK-04、MP4） ---
      let rd = L.createGame({ players: 2, mode: 'vs', random: mkRng([0, 1]), now: mkNow(1000) });
      rd = L.startRound(rd);                                   // signalDelay 1000（random=0）
      const rdW = L.redoRound(rd);                             // signalDelay 4000（random=1）で引き直す
      check('redoRound（waiting）：phase=waiting、round=1 のまま、scores も同じ、signalDelay を引き直す（1000→4000）、新しい state を返す',
        rdW !== rd && rdW.phase === 'waiting' && rdW.round === 1 && eq(rdW.scores, [0, 0]) && rd.signalDelay === 1000 && rdW.signalDelay === 4000 && rdW.signalFiredAt === null && rdW.lastOutcome === null,
        { before: rd, after: rdW });
      // 1回勝ってから2回目の armed でやり直す
      let ra = L.createGame({ players: 2, mode: 'vs', random: mkRng([0.3]), now: mkNow(1000) });
      ra = L.startRound(ra); ra = L.applySignal(ra); ra = L.applyPress(ra, { playerIdx: 1, pressedAt: ra.signalFiredAt + 100 }).state;
      ra = L.startRound(ra); ra = L.applySignal(ra);
      const raScores = ra.scores.slice();
      const raR = L.redoRound(ra);
      check('redoRound（armed、2回目・1点ずつ持っている）：phase=waiting、round=2 のまま、scores=[0,1] のまま、signalFiredAt=null、signalDelay は 1000..4000',
        raR.phase === 'waiting' && raR.round === 2 && eq(raR.scores, [0, 1]) && raR.signalFiredAt === null && raR.signalDelay >= 1000 && raR.signalDelay <= 4000 && eq(ra.scores, raScores) && ra.phase === 'armed',
        { before: { round: ra.round, scores: ra.scores, phase: ra.phase }, after: raR });
      // solo の reactions はそのまま
      let rs = L.createGame({ mode: 'solo', random: mkRng([0.5]), now: mkNow(1000) });
      rs = L.startRound(rs); rs = L.applySignal(rs); rs = L.applyPress(rs, { playerIdx: 0, pressedAt: rs.signalFiredAt + 321 }).state;
      rs = L.startRound(rs); rs = L.applySignal(rs);
      const rsR = L.redoRound(rs);
      check('redoRound（solo・armed）：reactions=[321] のまま、round=2 のまま', eq(rsR.reactions, [321]) && rsR.round === 2 && rsR.phase === 'waiting', rsR);
      // setup / resolved / done では何もしない
      const rSetup = L.createGame({ players: 2, mode: 'vs' });
      const rRes = st2;                                          // resolved
      const rDone = w3.g;                                        // done
      const keep = (a, b) => a === b || (a.phase === b.phase && a.round === b.round && eq(a.scores, b.scores) && eq(a.reactions, b.reactions));
      const noop = [['setup', rSetup], ['resolved', rRes], ['done', rDone]].map(([ph, s]) => [ph, keep(L.redoRound(s), s), L.redoRound(s).phase]);
      check('redoRound を setup・resolved・done で呼んでも何もしない（phase・round・scores が同じ）', noop.every(([, ok]) => ok), noop);
      // --- validateBestSolo：壊れた値を 0 にする、有効値は通る ---
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
      // --- solo は 3回せいこうでは終わらず、5回で終わる（ヒント「全5回」・遊び方「5回で おわり」と合わせる）---
      {
        let g = L.createGame({ mode: 'solo', random: mkRng([0.5]), now: mkNow(1000) });
        const trail = [];
        for (let k = 0; k < 5; k++) {
          g = L.startRound(g); g = L.applySignal(g);
          g = L.applyPress(g, { playerIdx: 0, pressedAt: g.signalFiredAt + 200 + k }).state;
          trail.push({ round: g.round, phase: g.phase, scores: g.scores.slice() });
        }
        check('solo：5回とも せいこう → 3〜4回目は resolved（3点でも終わらない）、5回目で phase=done、reactions は 5 つ',
          trail.slice(0, 4).every((t) => t.phase === 'resolved') && g.phase === 'done' && g.round === 5 && g.reactions.length === 5, trail);
        check('solo：5回で終わった後の startRound は 6回目に進まない', L.startRound(g).round === 5 && L.startRound(g).phase === 'done', L.startRound(g));
      }
      // --- 境界ケース ---
      const afterStartDone = L.startRound(w3.g);
      check('startRound を phase=done で呼ぶと state は不変（phase が done のまま）', afterStartDone.phase === 'done' && afterStartDone === w3.g, { phase: afterStartDone.phase });
      const stSetup = L.createGame({ players: 2, mode: 'vs' });
      const stArmed = L.applySignal(L.startRound(stSetup));
      const stResolved = L.applyPress(stArmed, { playerIdx: 0, pressedAt: (stArmed.signalFiredAt || 0) + 150 }).state;
      const signalResults = [['setup', stSetup], ['armed', stArmed], ['resolved', stResolved], ['done', w3.g]].map(([ph, x]) => [ph, L.applySignal(x) === x]);
      check('applySignal を waiting 以外（setup・armed・resolved・done）で呼んでも state は不変', signalResults.every(([, ok]) => ok), signalResults);
      const first = L.applyPress(stArmed, { playerIdx: 0, pressedAt: (stArmed.signalFiredAt || 0) + 200 });
      const second = L.applyPress(first.state, { playerIdx: 0, pressedAt: (stArmed.signalFiredAt || 0) + 300 });
      check('applyPress を armed で 2 回連続：1 回目は win、2 回目は ignore', first.outcome.kind === 'win' && second.outcome.kind === 'ignore', { first: first.outcome.kind, second: second.outcome.kind });
      check('applyPress を phase=done で呼ぶと ignore', L.applyPress(w3.g, { playerIdx: 0, pressedAt: 1000 }).outcome.kind === 'ignore');
      check('averageMs([]) は null', L.averageMs([]) === null, L.averageMs([]));
      check('averageMs([null, null]) は null', L.averageMs([null, null]) === null, L.averageMs([null, null]));
      check('averageMs([null, 200, null]) は 200', L.averageMs([null, 200, null]) === 200, L.averageMs([null, 200, null]));
    },
  },

  // ================= PK10 静的：事前キャッシュ・読み込み順・音名 =================
  {
    id: 'PK10', tier: 'smoke', node: true, title: 'ピカッと 静的：sw.js の APP_FILES に pikatto の全ファイル、読み込み順（sfx.js → logic.js → input.js → 本体）、sfx.js に signal・foul・win・finish',
    run({ check, root }) {
      const dir = path.join(root, 'games/pikatto');
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const info = swInfo(root);
      // フォルダの中のファイル（.html・.js・.css）と、index.html が読み込むローカルのスクリプト
      const own = fs.readdirSync(dir).filter((f) => /\.(html|js|css)$/.test(f)).map((f) => './games/pikatto/' + f);
      const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
      const refs = srcs.map((s) => './' + path.posix.normalize(path.posix.join('games/pikatto', s)));
      const want = [...new Set(['./games/pikatto/', ...own, ...refs])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`APP_FILES に pikatto の ${want.length} 件（${want.join(' ')}）がすべてある（無ければ不合格。オフラインで開かない）`, missing.length === 0, { missing, want });
      // 読み込み順：sfx.js → logic.js → input.js → 本体（インラインの <script>）
      const at = (s) => html.indexOf(`<script src="${s}"></script>`);
      const order = { sfx: at('../../common/sfx.js'), logic: at('logic.js'), input: at('input.js'), main: html.search(/<script>\s/) };
      check(`読み込み順が sfx.js(${order.sfx}) → logic.js(${order.logic}) → input.js(${order.input}) → 本体(${order.main})`,
        order.sfx > 0 && order.sfx < order.logic && order.logic < order.input && order.input < order.main, order);
      // sfx.js の音名
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      const names = sandbox.YubiSfx?.create('pikatto').names || [];
      const needSfx = ['signal', 'foul', 'win', 'finish', 'start', 'best', 'toggle'];
      check(`YubiSfx.create("pikatto") に ${needSfx.join('・')} がある`, needSfx.every((n) => names.includes(n)), { names });
      check('index.html が YubiSfx.create("pikatto") を使う', html.includes('YubiSfx.create("pikatto")'));
    },
  },

  // ================= PK9 Node：境界値 =================
  {
    id: 'PK9', tier: 'full', node: true, title: 'ピカッと：境界値（signalDelay は 1000..4000 ms、waiting 中はどんな playerIdx でも foul）',
    run({ check, root }) {
      const L = loadLogic(root);
      const bounds = [0, 0.5, 1].map((r) => {
        const g = L.startRound(L.createGame({ players: 2, mode: 'vs', random: () => r }));
        return { r, d: g.signalDelay };
      });
      const okRange = bounds.every((b) => Number.isInteger(b.d) && b.d >= 1000 && b.d <= 4000);
      check(`signalDelay の境界：r=0→${bounds[0].d}（1000）、r=0.5→${bounds[1].d}（2000〜3000）、r=1→${bounds[2].d}（4000）、すべて整数で 1000..4000`,
        okRange && bounds[0].d === 1000 && bounds[2].d === 4000 && bounds[1].d >= 2000 && bounds[1].d <= 3000, bounds);
      const out = [];
      for (let i = 0; i < 100; i++) {
        const g = L.startRound(L.createGame({ players: 2, mode: 'vs', random: () => (i / 99) }));
        if (!(Number.isInteger(g.signalDelay) && g.signalDelay >= 1000 && g.signalDelay <= 4000)) out.push(g.signalDelay);
      }
      check('100 通りの乱数すべて signalDelay が 1000..4000 の整数', out.length === 0, out);
      // redoRound の待ち時間も同じ範囲
      const redo = [0, 0.5, 1].map((r) => L.redoRound(L.startRound(L.createGame({ players: 2, mode: 'vs', random: () => r }))).signalDelay);
      check(`redoRound の signalDelay も 1000..4000（${redo.join('・')}）`, redo[0] === 1000 && redo[2] === 4000 && redo.every((d) => Number.isInteger(d) && d >= 1000 && d <= 4000), redo);
      let g = L.createGame({ players: 4, mode: 'vs' });
      g = L.startRound(g);
      const foulRes = [0, 1, 2, 3].map((idx) => L.applyPress(g, { playerIdx: idx, pressedAt: 1000 }).outcome);
      const allFoul = foulRes.every((o) => o.kind === 'foul');
      const awards = foulRes.map((o) => [...o.award].sort().join(','));
      check('waiting 中：0・1・2・3 のどのボタンを押しても foul、押した本人以外に +1',
        allFoul && awards[0] === '1,2,3' && awards[1] === '0,2,3' && awards[2] === '0,1,3' && awards[3] === '0,1,2',
        { kinds: foulRes.map((o) => o.kind), awards });
      const outRange = [-1, 5, 100, 1.5, NaN].map((idx) => L.applyPress(g, { playerIdx: idx, pressedAt: 1000 }).outcome.kind);
      check('範囲外の playerIdx（-1・5・100・1.5・NaN）は ignore（state を変えない）', outRange.every((k) => k === 'ignore'), outRange);
      let a = L.createGame({ players: 2, mode: 'vs' });
      a = L.applySignal(L.startRound(a));
      const same = L.applyPress(a, { playerIdx: 0, pressedAt: a.signalFiredAt });
      check('合図と同時刻（reactionMs=0）でも win（armed なら押下＝勝ち）', same.outcome.kind === 'win' && same.outcome.reactionMs === 0, same.outcome);
    },
  },

  // ================= PK14 Node：入力の核（受付の窓・pointerId・キー・timeStamp） =================
  {
    id: 'PK14', tier: 'full', node: true, title: 'ピカッと 入力（Node）：受付の窓で後に届いた早い押下が先、同じボタンの別の指は入らない、cancel 後も押下は残る、keyAction、normalizeTs',
    run({ check, root }) {
      const I = loadInput(root);
      check('PikattoInput に attach・createCore・normalizeTs・keyAction がある', ['attach', 'createCore', 'normalizeTs', 'keyAction'].every((k) => typeof I[k] === 'function'), Object.keys(I));
      // 時間を進めずに窓を閉じられるよう、タイマーを注入する
      const mk = (cbs = {}) => {
        const timers = [];
        const presses = [], downs = [];
        const core = I.createCore({ onPress: (p) => presses.push(p), onCornerDown: (p) => downs.push(p.playerIdx), ...cbs }, {
          setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
          clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
        });
        const fire = () => { for (const t of timers) if (t.fn) { const f = t.fn; t.fn = null; f(); } };
        return { core, timers, presses, downs, fire };
      };
      // 1. 窓の中で後から届いた、押した時刻の早い押下が先に onPress される（PK-09）
      {
        const t = mk();
        t.core.down(0, 100, 'a');
        t.core.down(1, 90, 'b');
        const before = t.presses.length;
        t.fire();
        check('窓：1P(ts=100) → 2P(ts=90) の順に届くと、窓が閉じるまで onPress せず、閉じたら 2P → 1P の順（早い timeStamp が勝つ）',
          before === 0 && eq(t.presses.map((p) => [p.playerIdx, p.pressedAt]), [[1, 90], [0, 100]]), { before, presses: t.presses });
        check('窓の長さは 30ms（setTimer に 30 を渡す）、窓は 1 つだけ開く', t.timers.length === 1 && t.timers[0].ms === 30, t.timers.map((x) => x.ms));
      }
      // 2. 同じ時刻なら届いた順
      {
        const t = mk();
        t.core.down(2, 50, 'c'); t.core.down(3, 50, 'd'); t.fire();
        check('同じ timeStamp なら届いた順（3P → 4P）', eq(t.presses.map((p) => p.playerIdx), [2, 3]), t.presses);
      }
      // 3. 同じボタンを別の指で押しても、押したままの指があれば 2 回目は入らない（PK-23）
      {
        const t = mk();
        t.core.down(0, 10, 'a');
        t.core.down(0, 20, 'b');
        t.fire();
        check('1P を指 a で押したまま指 b で押しても onPress は 1 回、onCornerDown も 1 回', t.presses.length === 1 && t.downs.length === 1 && t.core.held.has(0), { presses: t.presses, downs: t.downs });
        t.core.up(0, 'b');
        check('入らなかった指 b を離しても、指 a が押したままなら 1P は押されたまま', t.core.held.has(0));
        t.core.up(0, 'a');
        check('指 a を離すと 1P は離れた状態', !t.core.held.has(0));
        t.core.down(0, 30, 'b'); t.fire();
        check('離した後なら別の指 b の押下は入る（合計 2 回）', t.presses.length === 2 && t.presses[1].pressedAt === 30, t.presses);
      }
      // 4. pointerId を省くとボタンごとに 1 つ
      {
        const t = mk();
        t.core.down(2, 10); t.core.down(2, 20); t.fire();
        const n1 = t.presses.length;
        t.core.up(2); t.core.down(2, 30); t.fire();
        check('pointerId を省くとボタンごとに 1 つ：押したままの 2 回目は入らず、up の後は入る', n1 === 1 && t.presses.length === 2, t.presses);
      }
      // 5. cancel：押しっぱなしだけ消し、窓の中の押下は残す（pointercancel）
      {
        const t = mk();
        t.core.down(0, 10, 'a');
        t.core.cancel('a');
        const heldAfter = t.core.held.has(0);
        t.fire();
        check('cancel(pointerId) の後も窓の中の押下は onPress される、押しっぱなしは消える', !heldAfter && t.presses.length === 1 && t.presses[0].playerIdx === 0, { heldAfter, presses: t.presses });
      }
      // 6. reset：窓の押下を捨てる
      {
        const t = mk();
        t.core.down(1, 10, 'x');
        t.core.reset();
        t.fire();
        check('reset() で窓の押下を捨て（onPress しない）、押しっぱなしも消える', t.presses.length === 0 && !t.core.held.has(1), t.presses);
      }
      // 6b. discard：窓の押下だけ捨て、押しっぱなしは残す（よーいの終わり、PK-05）
      {
        const ups = [];
        const t = mk({ onCornerUp: (p) => ups.push(p.playerIdx) });
        t.core.down(1, 10, 'x');
        t.core.discard();
        t.fire();
        const heldAfter = t.core.held.has(1);
        t.core.up(1, 'x');
        check('discard() で窓の押下を捨て（onPress しない）、押しっぱなしは残る（離すと onCornerUp が届く）',
          t.presses.length === 0 && heldAfter && eq(ups, [1]) && !t.core.held.has(1), { presses: t.presses, heldAfter, ups });
      }
      // 7. flush を直接呼ぶ
      {
        const t = mk();
        t.core.down(3, 5, 'a'); t.core.flush();
        const n = t.presses.length;
        t.fire();
        check('flush() で窓をすぐ閉じる、後でタイマーが来ても 2 回目は出ない', n === 1 && t.presses.length === 1, t.presses);
      }
      // 8. keyAction（PK-06）
      const ka = [
        [{ type: 'keydown', key: 'Enter' }, 'down'], [{ type: 'keydown', key: ' ' }, 'down'], [{ type: 'keydown', key: 'Spacebar' }, 'down'],
        [{ type: 'keydown', key: 'Enter', repeat: true }, null], [{ type: 'keydown', key: ' ', repeat: true }, null],
        [{ type: 'keyup', key: 'Enter' }, 'up'], [{ type: 'keyup', key: ' ' }, 'up'],
        [{ type: 'keydown', key: 'a' }, null], [{ type: 'keydown', key: 'Tab' }, null], [{ type: 'keypress', key: 'Enter' }, null],
      ].map(([e, want]) => ({ e, want, got: I.keyAction(e) }));
      check('keyAction：Enter・Space・"Spacebar" の keydown → down、repeat は null、keyup → up、ほかのキー・種類は null', ka.every((x) => x.got === x.want), ka.filter((x) => x.got !== x.want));
      // 9. normalizeTs（PK-22）
      const ep = 1.7e12;
      const n1 = I.normalizeTs(ep + 5000, ep), n2 = I.normalizeTs(1234.5, ep), n3 = I.normalizeTs(NaN), n4 = I.normalizeTs(undefined);
      check(`normalizeTs：1970年起点の ms（1e11 超）は timeOrigin を引く（${n1}）、ふつうの値はそのまま（${n2}）、数でなければ有限の数（${n3}・${n4}）`,
        n1 === 5000 && n2 === 1234.5 && Number.isFinite(n3) && Number.isFinite(n4), { n1, n2, n3, n4 });
    },
  },

  // ================= PK2 画面：基本の遊び =================
  {
    id: 'PK2', tier: 'smoke', title: 'ピカッと 画面：最初から2人、はじめる→よーい（押しても無視）→forceSignal→pressFor で勝ち、waiting 中の押下でフライング、実タップでも進む',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK2');
      const setup = await page.evaluate(() => {
        const s = document.querySelector('.setup');
        const two = document.querySelector('.setup [data-players="2"]');
        return { shown: !!s && !s.hidden, buttons: [...document.querySelectorAll('.setup [data-players]')].map((b) => b.dataset.players), start: !!document.querySelector('.setup [data-action="start"]'), startDisabled: !!document.querySelector('.setup [data-action="start"]')?.disabled, twoPressed: two?.getAttribute('aria-pressed') };
      });
      check('設定画面：.setup が見える、人数の選択肢に 2・3・4・solo がある、「はじめる」ボタンがある',
        setup.shown && ['2', '3', '4', 'solo'].every((v) => setup.buttons.includes(v)) && setup.start, setup);
      check('最初から 2人が選ばれていて（aria-pressed="true"）「はじめる」が押せる（PK-18）', setup.twoPressed === 'true' && !setup.startDisabled, setup);
      const sel0 = (await getState(page))?.selectedPlayers;
      check('getState().selectedPlayers の初期値は 2', sel0 === 2, sel0);
      // 人数を選ばずにそのまま「はじめる」で 2人のゲーム
      await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
      const playShown = await playVisible(page);
      check('「はじめる」で .play が表示（.setup は隠れる）', playShown && !(await page.evaluate(() => !document.querySelector('.setup').hidden && getComputedStyle(document.querySelector('.setup')).display !== 'none')), { playShown });
      const api = await page.evaluate(() => ({ has: !!window.PikattoGame, keys: window.PikattoGame ? Object.keys(window.PikattoGame).sort() : [] }));
      check('window.PikattoGame に getState・startRound・forceSignal・pressFor・reset がある',
        api.has && ['forceSignal', 'getState', 'pressFor', 'reset', 'startRound'].every((k) => api.keys.includes(k)), api);
      // よーい（PK-05）：押しても無視
      const r0 = await getState(page);
      check('はじめた直後は「よーい」：getState().ready=true、#field[data-phase="ready"]、players=2', r0 && r0.ready === true && r0.players === 2 && (await fieldPhase(page)) === 'ready', { r0, fp: await fieldPhase(page) });
      const pr = await pressFor(page, 0);
      await page.locator('.corner[data-player="2"]').tap(); await wait(page, 100);
      const r1 = await getState(page), ov0 = await overlayInfo(page);
      check('よーい中の pressFor は false、実タップも無視（scores=[0,0]、カードは出ない、フライングにしない）', pr === false && eq(r1.scores, [0, 0]) && !r1.lastOutcome && !ov0.shown, { pr, r1, ov0 });
      // 1 ラウンド目：forceSignal（よーいも飛ばす）で armed にし、player 0 が勝つ
      await arm(page);
      const armed = await getState(page);
      check('forceSignal でよーい中からでも phase=armed、ready=false、#field[data-phase="armed"]', armed && armed.phase === 'armed' && armed.ready === false && eq(armed.scores, [0, 0]) && (await fieldPhase(page)) === 'armed', armed);
      await pressAfter(page, 0, 230);
      const afterWin = await getState(page);
      check('player 0 の pressFor（合図の 230ms 後）で scores[0]=1、lastOutcome.kind=win、reactionMs=230',
        afterWin && afterWin.scores[0] === 1 && afterWin.lastOutcome && afterWin.lastOutcome.kind === 'win' && afterWin.lastOutcome.reactionMs === 230, afterWin);
      const ov = await overlayInfo(page);
      check('ラウンド結果のオーバーレイに [data-cmd="next"] が出る（まだ 3 点に達していない）', ov.shown && ov.cmds.includes('next'), ov);
      // 次のラウンド：よーいを越えてから waiting 中に押してフライング
      // よーいの終わり際（残り約20ms）に押す：受付の窓（30ms）が閉じる前によーいが終わっても、フライングにしない。
      // 時計を止めたまま「つぎへ」→ 980ms 進める → 押す → 100ms 進める（実時間の遅れで境界がずれないように）
      await wait(page, CARD_LOCK_MS);
      let st2, edge0, edge1, edgeOv;
      await frozen(page, async () => {
        await page.evaluate(() => document.querySelector('.overlay [data-cmd="next"]').click());
        st2 = await getState(page);
        await page.clock.runFor(980);
        edge0 = await getState(page);
        await page.evaluate(() => {
          const el = document.querySelector('.corner[data-player="2"]');
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true }));
        });
        await page.clock.runFor(100);
        edge1 = await getState(page); edgeOv = await overlayInfo(page);
      });
      check('「つぎへ」で round=2、phase=waiting、signalFiredAt=null、よーいから始まる',
        st2 && st2.round === 2 && st2.phase === 'waiting' && st2.signalFiredAt === null && st2.ready === true, st2);
      await page.evaluate(() => {
        const el = document.querySelector('.corner[data-player="2"]');
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true }));
      });
      check('よーいの終わり際（窓が閉じる前によーいが終わる）の押下は無視：よーいは明けて waiting、点は [1,0] のまま、カードは出ない（PK-05）',
        edge0.ready === true && edge1.ready === false && edge1.phase === 'waiting' && eq(edge1.scores, [1, 0]) && !edge1.lastOutcome && !edgeOv.shown, { edge0: { ready: edge0.ready }, edge1, edgeOv });
      await wait(page, READY_MS - 1080);
      const st3 = await getState(page);
      check(`よーいの後（${READY_MS}ms）は waiting（ready=false、#field[data-phase="waiting"]）でまだ光らない`, st3.phase === 'waiting' && st3.ready === false && (await fieldPhase(page)) === 'waiting', { st3, fp: await fieldPhase(page) });
      const fr = await pressFor(page, 0);
      const foulState = await getState(page);
      check('waiting 中の pressFor(0) でフライング（他プレイヤー +1）、lastOutcome.kind=foul',
        fr === true && foulState && foulState.lastOutcome && foulState.lastOutcome.kind === 'foul' && foulState.scores[1] === 1 && foulState.lastOutcome.foulBy === 0, foulState);
      const ov2 = await overlayInfo(page);
      check('フライングでもオーバーレイに [data-cmd="next"] が出る', ov2.shown && ov2.cmds.includes('next'), ov2);
      // 3 ラウンド目：実際のタップでも進む（page.clock の下では timeStamp が本物の時刻なので勝ち負けは見ない）
      await cmd(page, 'next');
      await arm(page);
      await page.locator('.corner[data-player="2"]').tap(); await wait(page, 200);
      const st4 = await getState(page), ov3 = await overlayInfo(page);
      check('armed で 2P の隅を実際にタップすると、ラウンドが決まり（phase が armed でなくなる）結果カードが出る', st4.phase !== 'armed' && !!st4.lastOutcome && ov3.shown, { phase: st4.phase, lastOutcome: st4.lastOutcome, ov3 });
      await ctx.close();
    },
  },

  // ================= PK11 ラウンド表示 =================
  {
    id: 'PK11', tier: 'smoke', title: 'ピカッと：#hint の回数表示が「1」から始まり次で「2」（2人・ひとりで れんしゅうの両方、PK-01）、aria-live は #hint だけ（PK-08）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK11');
      const firstNum = () => page.evaluate(() => { const t = (document.querySelector('#hint')?.textContent || '').replace(/\s+/g, ' ').trim(); return { t, n: (t.match(/\d+/) || [])[0] || null }; });
      for (const who of ['2', 'solo']) {
        await startVs(page, who);
        await wait(page, READY_MS);
        const h1 = await firstNum(), s1 = await getState(page);
        check(`${who === 'solo' ? 'ひとりで れんしゅう' : '2人'}：はじめた後の #hint の最初の数字が 1（「${h1.t}」）、getState().round=1`, h1.n === '1' && s1.round === 1, { h1, round: s1.round });
        await arm(page); await pressAfter(page, 0, 250);
        await cmd(page, 'next');
        await wait(page, READY_MS);
        const h2 = await firstNum(), s2 = await getState(page);
        check(`${who === 'solo' ? 'ひとりで れんしゅう' : '2人'}：「つぎへ」の後の #hint の最初の数字が 2（「${h2.t}」）、round=2`, h2.n === '2' && s2.round === 2, { h2, round: s2.round });
        const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map((e) => e.id || e.className));
        check(`aria-live はプレイ中も #hint だけ（${live.join(',')}）`, eq(live, ['hint']), live);
        await page.evaluate(() => window.PikattoGame.reset()); await wait(page, 200);
      }
      await ctx.close();
    },
  },

  // ================= PK3 データ =================
  {
    id: 'PK3', tier: 'smoke', title: 'ピカッと データ：ひとりで れんしゅうで pikatto.bestSolo が保存される（無ければ不合格）、壊れた保存は 0 扱い（メニューにも出ない）',
    async run({ browser, check }) {
      // ---- 壊れた保存：メニューで ms の数字が出ない、ゲームでも 0 扱い ----
      const bads = [['文字列', '"abc"'], ['負', '-100'], ['NaN', 'null'], ['object JSON', '{"ms":300}'], ['Infinity 文字列', '"Infinity"'], ['小数', '123.4'], ['範囲外 49', '49'], ['範囲外 5001', '5001']];
      for (const [label, raw] of bads) {
        const { ctx, page } = await newPage(browser, V(), 'PK3 broken ' + label, { clock: true });
        await seed(page, { 'pikatto.bestSolo': raw, 'pikatto.help': '1' });
        await page.goto(BASE); await wait(page, 300);
        const t = await page.evaluate(() => {
          const card = [...document.querySelectorAll('a.game, .game')].find((e) => /ピカッ|pikatto/i.test(e.textContent || ''));
          return { has: !!card, text: card ? card.textContent.replace(/\s+/g, ' ').trim() : '' };
        });
        check(`壊れた保存（${label}）：メニューにピカッとのカードがあり、ベストの ms が表示されない`, t.has && !/[0-9]+\s*ms/.test(t.text), t);
        await page.goto(PK_URL); await wait(page, 300);
        const b = (await getState(page))?.bestSolo;
        check(`壊れた保存（${label}）：ゲームを開いても落ちず、bestSolo=0`, b === 0, b);
        await ctx.close();
      }
      // ---- ひとりで れんしゅうで bestSolo が整数で入る ----
      const { ctx, page } = await openPK(browser, 'PK3 solo', { opts: { initScript: SFX_SPY } });
      await startSolo(page);
      const s0 = await getState(page);
      check('ひとりで れんしゅうで開始：mode=solo、players=1、#field[data-players="1"]', s0 && s0.mode === 'solo' && s0.players === 1 && (await page.evaluate(() => document.querySelector('#field')?.dataset.players)) === '1', s0);
      await playRounds(page, [0], 300);
      const stored = await page.evaluate(() => { try { return localStorage.getItem('pikatto.bestSolo'); } catch { return 'ERR'; } });
      check(`1回目の勝ち（300ms）で pikatto.bestSolo が "300" で保存される（保存されていなければ不合格。stored=${stored}）`, stored === '300', { stored });
      // 最後（れんしゅうは 3回せいこうでは終わらず全5回）まで遊んでも、遅い記録で上書きしない
      for (const ms of [450, 500, 600, 700]) { await cmd(page, 'next'); await arm(page); await pressAfter(page, 0, ms); }
      await wait(page, 700);
      const st = await getState(page);
      const stored2 = await page.evaluate(() => localStorage.getItem('pikatto.bestSolo'));
      check(`5回で終わり（phase=done、round=5）、遅い記録（450〜700ms）では上書きしない（stored=${stored2}）`, st.phase === 'done' && st.round === 5 && stored2 === '300', { stored2, phase: st.phase, round: st.round });
      await ctx.close();
    },
  },

  // ================= PK15 ベスト更新の表示 =================
  {
    id: 'PK15', tier: 'smoke', title: 'ピカッと ひとりで れんしゅう：スコア欄のラベルは「ベスト」、ベスト更新でカードに data-best="1" と「ベスト更新！」、更新しないときは出ない（PK-15）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK15', { extra: { 'pikatto.bestSolo': '400' } });
      await startSolo(page);
      const sb = await page.evaluate(() => (document.querySelector('#scores')?.textContent || '').replace(/\s+/g, ' ').trim());
      check(`スコア欄に「ベスト」と保存済みの 400 が出る、「じぶん」は使わない（「${sb}」）`, /ベスト/.test(sb) && /400/.test(sb) && !/じぶん/.test(sb), sb);
      await arm(page); await pressAfter(page, 0, 300);
      const ov1 = await overlayInfo(page);
      const st1 = await page.evaluate(() => localStorage.getItem('pikatto.bestSolo'));
      check('400 → 300ms で更新：カードに data-best="1" と「ベスト更新！」、保存は "300"', ov1.shown && ov1.best === '1' && /ベスト更新/.test(ov1.text) && st1 === '300', { ov1, st1 });
      const sb1 = await page.evaluate(() => document.querySelector('#scores')?.textContent || '');
      check('スコア欄のベストも 300 に変わる', /300/.test(sb1), sb1);
      await cmd(page, 'next');
      await arm(page); await pressAfter(page, 0, 350);
      const ov2 = await overlayInfo(page);
      const st2 = await page.evaluate(() => localStorage.getItem('pikatto.bestSolo'));
      check('300 のときに 350ms：data-best は付かず「ベスト更新」も出ない、保存は "300" のまま', ov2.shown && !ov2.best && !/ベスト更新/.test(ov2.text) && st2 === '300', { ov2, st2 });
      await ctx.close();
    },
  },

  // ================= PK13 一時停止 =================
  {
    id: 'PK13', tier: 'smoke', title: 'ピカッと 一時停止：waiting 中に裏へ回す／「？」で止まり、時計を進めても光らず点数も変わらない。「つづける」で同じ回のよーいからやり直す（PK-04）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK13');
      await startVs(page, 2);
      await arm(page); await pressAfter(page, 1, 200);      // 2P が 1 点
      await cmd(page, 'next');
      await wait(page, READY_MS);
      const before = await getState(page);
      check('準備：2回目の waiting、scores=[0,1]', before.phase === 'waiting' && before.round === 2 && eq(before.scores, [0, 1]), before);
      // ---- 裏に回す ----
      await setHidden(page, true); await wait(page, 100);
      const p1 = await getState(page);
      check('裏に回すと paused=true、#field[data-phase="paused"]', p1.paused === true && (await fieldPhase(page)) === 'paused', { p1, fp: await fieldPhase(page) });
      await wait(page, 5000);
      const p2 = await getState(page);
      check('止まっている間は 5 秒進めても armed にならず、点数・回数も変わらない', p2.phase !== 'armed' && p2.signalFiredAt === null && eq(p2.scores, [0, 1]) && p2.round === 2, p2);
      const pr = await pressFor(page, 0);
      check('止まっている間の pressFor は false（フライングにしない）', pr === false && eq((await getState(page)).scores, [0, 1]), pr);
      await setHidden(page, false); await wait(page, 100);
      const ovH = await overlayInfo(page);
      check('戻るとカードに [data-cmd="resume"]（つづける）と [data-cmd="menu"] がある', ovH.shown && ovH.cmds.includes('resume') && ovH.cmds.includes('menu'), ovH);
      await wait(page, 3000);
      check('戻ってもカードを閉じるまでは止まったまま（armed にならない）', (await getState(page)).phase !== 'armed');
      await cmd(page, 'resume');
      const r1 = await getState(page);
      check('「つづける」で同じ 2回目のよーいから（ready=true、paused=false、round=2、scores=[0,1]、カードは閉じる）',
        r1.ready === true && r1.paused === false && r1.round === 2 && eq(r1.scores, [0, 1]) && r1.phase === 'waiting' && !(await overlayInfo(page)).shown, r1);
      await wait(page, READY_MS);
      const r2 = await getState(page);
      check('よーいの後は waiting（まだ光らない）', r2.phase === 'waiting' && r2.ready === false && (await fieldPhase(page)) === 'waiting', r2);
      // ---- 「？」で止まる ----
      await page.locator('#help-btn').tap(); await wait(page, 100);
      const q1 = await getState(page), ovQ = await overlayInfo(page);
      check('プレイ中の「？」で paused=true、遊び方のカードに [data-cmd="resume"] があり close は無い', q1.paused === true && ovQ.shown && ovQ.cmds.includes('resume') && !ovQ.cmds.includes('close'), { q1, ovQ });
      await wait(page, 5000);
      const q2 = await getState(page);
      check('遊び方を開いている間は 5 秒進めても armed にならず、点数・回数も変わらない', q2.phase !== 'armed' && eq(q2.scores, [0, 1]) && q2.round === 2, q2);
      await cmd(page, 'resume');
      const q3 = await getState(page);
      check('「つづける」で同じ 2回目のよーいから（round=2、scores=[0,1]）', q3.ready === true && q3.paused === false && q3.round === 2 && eq(q3.scores, [0, 1]), q3);
      // ---- 結果カードが出ているとき（resolved）は止めない ----
      await arm(page); await pressAfter(page, 0, 200);
      await setHidden(page, true); await wait(page, 100);
      const z = await getState(page);
      await setHidden(page, false); await wait(page, 100);
      const ovZ = await overlayInfo(page);
      check('resolved（結果カード）のときに裏へ回しても止めない（paused=false、カードの [data-cmd="next"] のまま）', z.paused === false && ovZ.cmds.includes('next') && !ovZ.cmds.includes('resume'), { z, ovZ });
      await ctx.close();
    },
  },

  // ================= PK4 閉じ込めなし =================
  {
    id: 'PK4', tier: 'smoke', title: 'ピカッと：プレイ中・結果画面・遊び方のどこからでも a#back でメニューに戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK4');
      const href = await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href'));
      check('a#back の href は ../../', href === '../../', href);
      const backReachable = () => page.evaluate(() => { const b = document.querySelector('a#back'); if (!b) return false; const r = b.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && (el === b || b.contains(el) || el.closest('a#back') === b); });
      await page.click('a#back');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('設定画面から a#back でメニューに戻る', page.url() === BASE, page.url());
      await page.goto(PK_URL); await wait(page, 300);
      await startVs(page, 2);
      check('プレイ中：.play が見え、a#back が押せる', await playVisible(page) && await backReachable());
      await page.click('a#back');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('プレイ中から a#back でメニューに戻る', page.url() === BASE, page.url());
      await page.goto(PK_URL); await wait(page, 300);
      await startVs(page, 2);
      await arm(page); await pressAfter(page, 0, 200);
      const ov = await overlayInfo(page);
      check('ラウンド結果のオーバーレイが見える', ov.shown, ov);
      if (await backReachable()) {
        await page.click('a#back');
        await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        check('結果画面から a#back でメニューに戻る', page.url() === BASE, page.url());
      } else if (ov.cmds.includes('menu')) {
        await cmd(page, 'menu');
        await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        check('結果画面から [data-cmd="menu"] でメニューに戻る', page.url() === BASE, page.url());
      } else {
        check('結果画面から a#back か [data-cmd="menu"] で戻れること（どちらかが押せる）', false, ov);
      }
      // 遊び方（help）から戻れる
      await page.goto(PK_URL); await wait(page, 300);
      await page.locator('#help-btn').tap(); await wait(page, 300);
      const hov = await overlayInfo(page);
      check('設定画面の「？」で遊び方カードが開く', hov.shown, hov);
      if (await backReachable()) {
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
      await ctx.close();
    },
  },

  // ================= PK5 画面内・44px =================
  {
    id: 'PK5', tier: 'full', title: 'ピカッと 画面内・44px：SE 縦・iPad 横で、4つの .corner が 44×44 以上・safe-area 内・互いに重ならない',
    async run({ browser, check }) {
      for (const v of [view('SE', 'p', 'app'), view('iPad', 'l', 'app')]) {
        const { ctx, page } = await openPK(browser, 'PK5 ' + v.label, { v });
        await startVs(page, 4);
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
        const rs = await cornerRects(page);
        const x = intersections(rs);
        check(`${v.label}｜4つの .corner の矩形が互いに交わらない（PK-02）`, rs.length === 4 && x.length === 0, { x, rs });
        const head = await layoutProbe(page, '#help-btn, #sound-btn, a#back', v.safe, { minSel: '#help-btn, #sound-btn, a#back' });
        check(`${v.label}｜ヘッダ（戻る・?・♪）が画面内・44px 以上`, !head.outside.length && !head.small.length, head);
        await ctx.close();
      }
    },
  },

  // ================= PK12 隅の重なり・2人は対角 =================
  {
    id: 'PK12', tier: 'full', title: 'ピカッと 配置：SE 横・iPad 横で、2・3・4人の隅が交わらない、2人は 1P 左上・2P 右下（対角）、#field[data-players]、れんしゅうはフィールドのどこでも押せる（PK-02・PK-03・PK-25）',
    async run({ browser, check }) {
      for (const v of [view('SE', 'l', 'app'), view('iPad', 'l', 'app'), view('SE', 'p', 'app')]) {
        const { ctx, page } = await openPK(browser, 'PK12 ' + v.label, { v });
        for (const n of [2, 3, 4]) {
          await page.evaluate(() => window.PikattoGame.reset()); await wait(page, 100);
          await startVs(page, n);
          const dp = await page.evaluate(() => document.querySelector('#field')?.dataset.players);
          const rs = await cornerRects(page);
          const x = intersections(rs);
          check(`${v.label}｜${n}人：#field[data-players="${n}"]、見える隅が ${n} 個で互いに交わらない、どれも 44px 以上`,
            dp === String(n) && rs.length === n && x.length === 0 && rs.every((q) => q.w >= 43.5 && q.h >= 43.5), { dp, x, rs });
          if (n === 2) {
            const [a, b] = [rs.find((q) => q.p === 1), rs.find((q) => q.p === 2)];
            // 中心どうしで比べる：1P の中心が 2P の中心より左かつ上（ボタンの幅は実装に任せる）
            const cx = (q) => (q.x + q.r) / 2, cy = (q) => (q.y + q.b) / 2;
            const diag = a && b && cx(b) - cx(a) > 20 && cy(b) - cy(a) > 20;
            check(`${v.label}｜2人：1P が左上・2P が右下（対角、PK-03）`, !!diag, { a, b });
          }
        }
        // れんしゅう：フィールドの右下の端をタップしても押せる（PK-25）
        await page.evaluate(() => window.PikattoGame.reset()); await wait(page, 100);
        await startSolo(page);
        await arm(page);
        const f = await page.evaluate(() => { const q = document.querySelector('#field').getBoundingClientRect(); return { x: q.right - 14, y: q.bottom - 14, dp: document.querySelector('#field').dataset.players }; });
        await page.touchscreen.tap(f.x, f.y); await wait(page, 200);
        const s = await getState(page);
        check(`${v.label}｜れんしゅう：#field[data-players="1"]、フィールドの右下の端（${Math.round(f.x)},${Math.round(f.y)}）のタップでも押せる（armed でなくなる）`, f.dp === '1' && s.phase !== 'armed' && !!s.lastOutcome, { f, phase: s.phase, lastOutcome: s.lastOutcome });
        await ctx.close();
      }
    },
  },

  // ================= PK6 効果音 =================
  {
    id: 'PK6', tier: 'full', title: 'ピカッと 効果音：signal・foul・win・finish が鳴る、♪で切り替わる（SFX_SPY で name の列を記録）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK6', { opts: { initScript: SFX_SPY } });
      const names = () => page.evaluate(() => window.__plays.map((p) => p.n));
      await startVs(page, 2);
      const afterStart = await names();
      await arm(page);
      await wait(page, 100);
      const afterSignal = await names();
      const newSig = afterSignal.slice(afterStart.length);
      check(`forceSignal の後に "signal" が鳴る（鳴った音：${newSig.join(',')}）`, newSig.includes('signal'), { afterStart, afterSignal });
      await pressAfter(page, 0, 200); await wait(page, 200);
      const afterWin = await names();
      check(`勝ちで "win" が鳴る（直近：${afterWin.slice(afterSignal.length).join(',')}）`, afterWin.slice(afterSignal.length).includes('win'), afterWin);
      // フライング：次のラウンドで、よーいを越えてから waiting 中に押す
      await cmd(page, 'next');
      await wait(page, READY_MS);
      const n0 = (await names()).length;
      await pressFor(page, 0); await wait(page, 200);
      const afterFoul = await names();
      check(`フライング（よーいの後、waiting 中の押下）で "foul" が鳴る（直近：${afterFoul.slice(n0).join(',')}）`, afterFoul.slice(n0).includes('foul'), afterFoul);
      // 試合終了まで遊んで finish（scores は [1,1]。1P があと 2 回勝つ）
      for (let i = 0; i < 2; i++) { await cmd(page, 'next'); await arm(page); await pressAfter(page, 0, 200); }
      await wait(page, 700);
      const afterFinish = await names();
      check(`試合終了で "finish" が鳴る（全音名：${[...new Set(afterFinish)].join(',')}）`, (await getState(page)).phase === 'done' && afterFinish.includes('finish'), afterFinish);
      // toggle：♪のタップで aria-pressed と blockpuzzle.sound が切り替わること（sfx.toggle() は SFX_SPY に記録されない）
      const finalOv = await overlayInfo(page);
      if (finalOv.shown && finalOv.cmds.includes('again')) await cmd(page, 'again');
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

  // ================= PK16 終わり方 =================
  {
    id: 'PK16', tier: 'full', title: 'ピカッと 終わり方：5回で同点は「ひきわけ」・data-final、3点で終わったときだけ「3点とった」、終わる直前に reset／もう一度 で最終カードが後から出ない（PK-14・PK-20・PK-21）',
    async run({ browser, check }) {
      const { ctx, page } = await openPK(browser, 'PK16');
      // ---- 3人で 0,1,2,0,1 → 2,2,1 の引き分け ----
      await startVs(page, 3);
      await playRounds(page, [0, 1, 2, 0, 1]);
      const d = await finalCard(page), ds = await getState(page);
      check('3人・5回で 2,2,1：phase=done、winner="draw"、最終カード（data-final="1"）に「ひきわけ」、「3点とった」「3点先取」は出ない',
        ds.phase === 'done' && ds.winner === 'draw' && d.final === '1' && /ひきわけ/.test(d.text) && !/3\s*点\s*(とった|先取)/.test(d.text), { d, winner: ds.winner, scores: ds.scores });
      check('最終カードに [data-cmd="again"] と [data-cmd="menu"]、[data-cmd="next"] は無い', d.cmds.includes('again') && d.cmds.includes('menu') && !d.cmds.includes('next'), d.cmds);
      // ---- もう一度：最終カードが重ならない ----
      await cmd(page, 'again');
      await wait(page, 1000);
      const a1 = await getState(page), ao = await overlayInfo(page);
      check('「もう一度」で round=1・scores=[0,0,0] から、1 秒たっても最終カードが出ない', a1.round === 1 && eq(a1.scores, [0, 0, 0]) && !ao.final && a1.phase !== 'done', { a1, ao });
      // ---- 3人で 0,0,0 → 3点とった ----
      await playRounds(page, [0, 0, 0]);
      const w = await finalCard(page), ws = await getState(page);
      check('3人で 1P が 3回勝つ：winner=0、最終カード data-final="1" に「1P」と「3点とった」', ws.phase === 'done' && ws.winner === 0 && w.final === '1' && /1\s*P/.test(w.text) && /3\s*点\s*とった/.test(w.text), { w, ws: { winner: ws.winner, scores: ws.scores } });
      // ---- 4人で 0,1,2,0,3 → 5回で 1P の勝ち（3点に届いていない）----
      await page.evaluate(() => window.PikattoGame.reset()); await wait(page, 100);
      await startVs(page, 4);
      await playRounds(page, [0, 1, 2, 0, 3]);
      const f5 = await finalCard(page), f5s = await getState(page);
      check('4人・5回で 2,1,1,1：winner=0、data-final="1"、「1P」は出るが「3点とった」「3点先取」は出ない（PK-14）',
        f5s.phase === 'done' && f5s.winner === 0 && f5.final === '1' && /1\s*P/.test(f5.text) && !/3\s*点\s*(とった|先取)/.test(f5.text), { f5, scores: f5s.scores });
      // ---- 終わる押下の直後（最終カードが出る前）に reset → 後から最終カードが出ない（finalTimer、PK-21）----
      await page.evaluate(() => window.PikattoGame.reset()); await wait(page, 100);
      await startVs(page, 2);
      await playRounds(page, [0, 0]);
      await cmd(page, 'next');
      await arm(page);
      await page.evaluate(() => { const G = window.PikattoGame; const s = G.getState(); G.pressFor(0, s.signalFiredAt + 200); G.reset(); });
      await wait(page, 1500);
      const rz = await getState(page), ro = await overlayInfo(page);
      check('3点目の直後に reset()：1.5 秒たっても最終カードが出ず（overlay なし）、設定画面のまま、2人が選ばれている', !ro.shown && rz.screen === 'setup' && rz.selectedPlayers === 2, { rz: { screen: rz.screen, selectedPlayers: rz.selectedPlayers }, ro });
      // 同じく、直後に新しいゲームを始めても（startGame）前の試合の最終カードが割り込まない
      await startVs(page, 2);
      await playRounds(page, [1, 1]);
      await cmd(page, 'next');
      await arm(page);
      await page.evaluate(() => { const G = window.PikattoGame; const s = G.getState(); G.pressFor(1, s.signalFiredAt + 200); G.reset(); document.querySelector('.setup [data-action="start"]').click(); });
      await wait(page, 1500);
      const ag = await getState(page), agov = await overlayInfo(page);
      check('3点目の直後に reset→はじめる：1.5 秒たっても前の最終カードが出ない（round=1・scores=[0,0] の新しいゲーム）', ag.screen === 'play' && ag.round === 1 && eq(ag.scores, [0, 0]) && ag.phase !== 'done' && !agov.shown, { ag: { screen: ag.screen, round: ag.round, phase: ag.phase, scores: ag.scores }, agov });
      await ctx.close();
    },
  },

  // ================= PK17 最大桁 =================
  {
    id: 'PK17', tier: 'full', title: 'ピカッと 最大桁：反応 5000 ms・ベスト 5000 ms・「0.23びょう」併記でも、SE 縦・SE 横でカードとスコア欄が崩れない。#hint の高さは状態で変わらない（PK-12）',
    async run({ browser, check }) {
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'app')]) {
        const { ctx, page } = await openPK(browser, 'PK17 ' + v.label, { v, extra: { 'pikatto.bestSolo': '5000' } });
        await startSolo(page);
        const hintH = [];
        const hH = () => page.evaluate(() => Math.round(document.querySelector('#hint').getBoundingClientRect().height));
        hintH.push(['ready', await hH()]);
        const sc = await page.evaluate(() => [...document.querySelectorAll('#scores .score, #scores [data-player]')].map((e) => ({ t: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth })));
        check(`${v.label}｜スコア欄にベスト 5000 ms が出て、はみ出さない`, sc.length > 0 && sc.some((x) => /5000/.test(x.t)) && sc.every((x) => x.sw <= x.cw + 1), sc);
        await wait(page, READY_MS); hintH.push(['waiting', await hH()]);
        await arm(page); hintH.push(['armed', await hH()]);
        await pressAfter(page, 0, 5000); hintH.push(['resolved', await hH()]);
        const c1 = await overlayInfo(page), f1 = await cardFit(page);
        check(`${v.label}｜反応 5000 ms のカード：「5000」と「びょう」が出て、見出し・ボタンが画面内（44px 以上）・横にはみ出さない`, /5000/.test(c1.text) && /びょう/.test(c1.text) && f1.ok, { c1, f1 });
        const pl = await layoutProbe(page, '.back, .tool', v.safe, { minSel: '.back, .tool' });
        check(`${v.label}｜カードを出していても横スクロールなし、ヘッダは画面内`, !pl.hscroll && !pl.outside.length, pl);
        await cmd(page, 'next');
        await arm(page); await pressAfter(page, 0, 230);
        const c2 = await overlayInfo(page), f2 = await cardFit(page);
        check(`${v.label}｜230 ms のカード：「230」と「0.23」（びょう）が併記され、崩れない`, /230/.test(c2.text) && /0\.23/.test(c2.text) && f2.ok, { c2, f2 });
        const hs = hintH.map(([, h]) => h);
        check(`${v.label}｜#hint の高さが よーい・waiting・armed・resolved で変わらない（${hintH.map(([k, h]) => k + ':' + h).join(' ')}）、2 行分以上`, hs.every((h) => h === hs[0]) && hs[0] >= 30, hintH);
        await ctx.close();
      }
      // 4人のスコア欄（いちばん多い人数）でも崩れない
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'app')]) {
        const { ctx, page } = await openPK(browser, 'PK17 4人 ' + v.label, { v });
        await startVs(page, 4);
        await playRounds(page, [0, 1, 2, 3]);
        const c = await cardFit(page);
        check(`${v.label}｜4人・1点ずつのラウンド結果カードが崩れない`, c.ok, c);
        await cmd(page, 'next');
        const lp = await layoutProbe(page, '.back, .tool, #scores, .corner, #hint', v.safe, { overlapSel: '.back, .tool, #scores, .corner, #hint', minSel: '.back, .tool, .corner' });
        check(`${v.label}｜4人のプレイ画面：スコア欄・隅・ヒントが画面内で重ならない、44px 以上`, lp.n > 0 && !lp.outside.length && !lp.overlaps.length && !lp.small.length && !lp.hscroll, lp);
        await ctx.close();
      }
    },
  },

  // ================= PK18 pointercancel・キー操作（実イベント、早送りなし） =================
  {
    id: 'PK18', tier: 'full', title: 'ピカッと 入力（実イベント・早送りなし）：armed で押下 → pointercancel でも勝ちは有効、隅の Enter・Space・支援技術の click で押せる、repeat は無視、結果カードの名前・inert・フォーカス、detach で style が戻る（PK-06・PK-23）',
    async run({ browser, check }) {
      // 早送りしない（event.timeStamp と performance.now が同じ時計になるので、勝ち負けまで見られる）
      const { ctx, page } = await newPage(browser, V(), 'PK18', {});
      await seed(page, { 'pikatto.help': '1' });
      await page.goto(PK_URL); await sleep(300);
      await startVs(page, 2);
      await arm(page);
      // repeat の keydown は無視
      await page.evaluate(() => document.querySelector('.corner[data-player="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })));
      await sleep(120);
      check('armed で 2P の隅に repeat=true の Enter keydown：押下にならない（armed のまま）', (await getState(page)).phase === 'armed', await getState(page));
      // pointerdown → すぐ pointercancel
      await page.evaluate(() => {
        const el = document.querySelector('.corner[data-player="1"]');
        const o = { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new PointerEvent('pointercancel', o));
      });
      await sleep(150);
      const s1 = await getState(page);
      check('armed で 1P を押した直後に pointercancel が来ても、その押下は有効（1P の win、scores=[1,0]）', s1.lastOutcome && s1.lastOutcome.kind === 'win' && s1.lastOutcome.player === 0 && eq(s1.scores, [1, 0]), s1);
      // Enter
      await cmd(page, 'next');
      await arm(page);
      await page.evaluate(() => document.querySelector('.corner[data-player="2"]').focus());
      await page.keyboard.press('Enter'); await sleep(150);
      const s2 = await getState(page);
      check('2P の隅にフォーカスして Enter：2P の win（reactionMs は 0 以上）', s2.lastOutcome && s2.lastOutcome.kind === 'win' && s2.lastOutcome.player === 1 && s2.lastOutcome.reactionMs >= 0 && eq(s2.scores, [1, 1]), s2);
      // Space
      await cmd(page, 'next');
      await arm(page);
      await page.evaluate(() => document.querySelector('.corner[data-player="1"]').focus());
      const sy0 = await page.evaluate(() => scrollY);
      await page.keyboard.press('Space'); await sleep(150);
      const s3 = await getState(page);
      check('1P の隅にフォーカスして Space：1P の win、画面はスクロールしない', s3.lastOutcome && s3.lastOutcome.kind === 'win' && s3.lastOutcome.player === 0 && eq(s3.scores, [2, 1]) && (await page.evaluate(() => scrollY)) === sy0, s3);
      // 結果カード：名前（見出し）があり、背後は inert、押せない間はカード自体にフォーカス
      const dlg = await page.evaluate(() => {
        const card = document.querySelector('.overlay .card');
        const id = card && card.getAttribute('aria-labelledby');
        const t = id && document.getElementById(id);
        const app = document.querySelector('#app');
        return { role: card && card.getAttribute('role'), name: t ? t.textContent.trim() : '', inCard: !!t && card.contains(t), inert: !!(app && app.inert), focusCard: document.activeElement === card };
      });
      check('結果カードは role=dialog・aria-labelledby がカード内の見出し（名前あり）、背後の #app は inert、押せない間はカードにフォーカス',
        dlg.role === 'dialog' && dlg.inCard && dlg.name.length > 0 && dlg.inert && dlg.focusCard, dlg);
      // 「つぎへ」の後は 1P の隅にフォーカス（Tab で戻らなくてよい）、#app の inert は外れる
      await cmd(page, 'next');
      const fc = await page.evaluate(() => ({ focus1: document.activeElement === document.querySelector('.corner[data-player="1"]'), inert: !!document.querySelector('#app').inert }));
      check('「つぎへ」でカードを閉じると #app の inert が外れ、1P の隅にフォーカスが移る', fc.focus1 && !fc.inert, fc);
      // 支援技術（VoiceOver の二重タップ・スイッチコントロール）の click（detail=0）だけでも押せる
      await arm(page);
      await page.evaluate(() => document.querySelector('.corner[data-player="2"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      await sleep(150);
      const s4 = await getState(page);
      check('armed で 2P の隅に detail=0 の click（支援技術）：2P の win、1回だけ（scores=[2,2]）', s4.lastOutcome && s4.lastOutcome.kind === 'win' && s4.lastOutcome.player === 1 && eq(s4.scores, [2, 2]), s4);
      // detach で root の style が戻る
      const st = await page.evaluate(() => {
        const d = document.createElement('div');
        d.style.userSelect = 'text'; d.style.touchAction = 'pan-y';
        document.body.appendChild(d);
        const h = window.PikattoInput.attach(d, { onPress() {} });
        const during = { ta: d.style.touchAction, us: d.style.userSelect };
        h.detach();
        const after = { ta: d.style.touchAction, us: d.style.userSelect };
        d.remove();
        return { during, after, hasReset: typeof h.reset === 'function' };
      });
      check('PikattoInput.attach の戻り値に reset() があり、detach で touchAction・userSelect が attach 前の値に戻る', st.hasReset && st.during.ta === 'none' && st.after.ta === 'pan-y' && st.after.us === 'text', st);
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
      await seed(page, { 'pikatto.help': '1' });
      await page.goto(PK_URL); await wait(page, 300);
      await page.locator('.setup [data-players="2"]').tap(); await wait(page, 150);
      await page.locator('.setup [data-action="start"]').tap(); await wait(page, 300);
      const g = await page.evaluate(() => {
        const el = document.querySelector('.corner[data-player="1"]') || document.querySelector('.play') || document.body;
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gs = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        return { dblclickPrevented: !d, gesturePrevented: gs.every((x) => !x) };
      });
      check('.play 内で dblclick・gesturestart/gesturechange を止める', g.dblclickPrevented && g.gesturePrevented, g);
      const t = await touch(ctx, page);
      await page.evaluate(() => window.__te.splice(0));
      await t.doubleTap('.corner[data-player="1"]');
      const ev = await page.evaluate(() => window.__te.splice(0));
      check('.corner の素早い2回タップ：touchend が2回届き、2回目は止められているかオーバーレイに流れている（どちらも拡大しない）',
        ev.length === 2 && (ev[1].p === true || /overlay/.test(ev[1].t || '')), ev);
      await ctx.close();
    },
  },

  // ================= PK8 オフライン =================
  {
    id: 'PK8', tier: 'full', title: 'ピカッと オフライン：事前キャッシュに games/pikatto/* が入り（無ければ不合格）、オフラインでも開けて遊べる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/pikatto');
      const want = ['./games/pikatto/', ...fs.readdirSync(dir).filter((f) => /\.(html|js|css)$/.test(f)).map((f) => './games/pikatto/' + f)];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`APP_FILES に ${want.join(' ')} がすべてある`, missing.length === 0, { missing });
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
      const play = await page.evaluate(() => { try { document.querySelector('.setup [data-action="start"]').click(); return !!window.PikattoGame && window.PikattoGame.forceSignal(); } catch (e) { return String(e); } });
      check('オフラインでも「はじめる」→合図まで進む（PikattoLogic・PikattoInput が読めている）', play === true, play);
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
];
