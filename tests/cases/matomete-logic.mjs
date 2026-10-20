// QL: まとめてポンの計算ロジック（Node で games/matomete/logic.js を直接読む。ブラウザ不要）
//   契約は docs/matomete-contract.md（§1 ルール、§3 ロジックの API、§7 QL の項目）。
//   局面は契約 §3 の state の形を手で組む（mk）。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・MatometeLogic を公開していなければ例外で不合格にする。
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

function load(root) {
  const f = path.join(root, 'games/matomete/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/matomete/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.applyRemove !== 'function') throw new Error('logic.js が MatometeLogic を module.exports していない');
  return L;
}

// ---- 局面を手で組む ----
// cols：列ごとの文字列（下→上）。'0' 〜 '4' が色、足りない段は空。列の数が 10 未満なら右は空の列
const C = 10, R = 20;
function mk(cols, { colors = 4, score = 0, moves = 0, cleared, over = false, allClear = false } = {}) {
  const grid = [];
  for (let x = 0; x < C; x++) {
    const s = cols[x] || '';
    const col = [];
    for (let y = 0; y < R; y++) col.push(y < s.length ? Number(s[y]) : null);
    grid.push(col);
  }
  const filled = grid.flat().filter((v) => v !== null).length;
  return { seed: 1, mode: 'normal', colors, grid, score, moves, cleared: cleared ?? (C * R - filled), over, allClear };
}
// 盤を列の文字列に戻す（空の段は省く）
const cols = (s) => s.grid.map((c) => c.filter((v) => v !== null).join(''));
const J = (x) => JSON.stringify(x);
const full = (ch) => ch.repeat(R);

// 盤の不変条件：各列で空のマスの上に色が無い、空の列より右に色の列が無い
function gravityOk(g) {
  let emptySeen = false;
  for (let x = 0; x < C; x++) {
    let gap = false;
    for (let y = 0; y < R; y++) { if (g[x][y] === null) gap = true; else if (gap) return false; }
    if (g[x][0] === null) emptySeen = true; else if (emptySeen) return false;
  }
  return true;
}
// 総当たりで「消せるかたまりがあるか」
function bruteHasMoves(g) {
  for (let x = 0; x < C; x++) for (let y = 0; y < R; y++) {
    const v = g[x][y]; if (v === null) continue;
    if ((x + 1 < C && g[x + 1][y] === v) || (y + 1 < R && g[x][y + 1] === v)) return true;
  }
  return false;
}
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const tests = [
  {
    id: 'QL1', tier: 'smoke', node: true, title: 'まとめてポン：定数・COLORS（5色・色と記号がすべて違う）・colorName・newGame の形（10×20・全部埋まる・色の数。やさしい 3・ふつう 4・むずかしい 5）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'まとめてポン', COLS: 10, ROWS: 20, ALL_CLEAR_BONUS: 1000, MAX_MOVES_SAVED: 200, SAVE_KEY_SAVE: 'matomete.save', SAVE_KEY_BEST: 'matomete.best', SAVE_KEY_BEST_HARD: 'matomete.bestHard', SAVE_KEY_BEST_EASY: 'matomete.bestEasy', SAVE_KEY_HELP: 'matomete.help', SAVE_KEY_MODE: 'matomete.mode', CHEER_LINE: 5 };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §3 のとおり', kBad.length === 0, kBad);
      check('MODES は { easy: 3, normal: 4, hard: 5 }', J(L.MODES) === J({ easy: 3, normal: 4, hard: 5 }), L.MODES);
      check('SAVE_KEY_LEAST はモードごと（leastEasy・least・leastHard）、NEAR_CLEAR は やさしい 5・ふつう 10・むずかしい 15', J(L.SAVE_KEY_LEAST) === J({ easy: 'matomete.leastEasy', normal: 'matomete.least', hard: 'matomete.leastHard' }) && J(L.NEAR_CLEAR) === J({ easy: 5, normal: 10, hard: 15 }) && Object.isFrozen(L.SAVE_KEY_LEAST) && Object.isFrozen(L.NEAR_CLEAR), { least: L.SAVE_KEY_LEAST, near: L.NEAR_CLEAR });
      const CO = L.COLORS;
      check('COLORS は 5 色で id が 0〜4、orange・sky・green・yellow・pink の順', Array.isArray(CO) && CO.length === 5 && CO.every((c, i) => c.id === i) && J(CO.map((c) => c.key)) === J(['orange', 'sky', 'green', 'yellow', 'pink']), CO);
      const uniq = (key) => new Set(CO.map((c) => c[key])).size === CO.length;
      check('key・name・hex・mark がすべて違う（色だけに頼らない＝記号も違う）', uniq('key') && uniq('name') && uniq('hex') && uniq('mark') && CO.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex) && c.mark && c.name), CO);
      check('COLORS・MODES・API が凍結されている', Object.isFrozen(CO) && Object.isFrozen(L.MODES) && Object.isFrozen(L), null);
      check('colorName：範囲外・整数でないは「？」、0 は COLORS[0].name', L.colorName(-1) === '？' && L.colorName(5) === '？' && L.colorName(NaN) === '？' && L.colorName('0') === '？' && L.colorName(0) === CO[0].name && L.colorName(4) === CO[4].name, [L.colorName(-1), L.colorName(0)]);
      for (const [mode, n] of [['easy', 3], ['normal', 4], ['hard', 5]]) {
        const s = L.newGame(12345, mode);
        const shapeOk = s && Array.isArray(s.grid) && s.grid.length === 10 && s.grid.every((c) => Array.isArray(c) && c.length === 20);
        const vals = shapeOk ? s.grid.flat() : [];
        check(`${mode}：10 列×20 段、全マスが 0〜${n - 1} の色で埋まっている`, shapeOk && vals.every((v) => Number.isInteger(v) && v >= 0 && v < n), s && s.grid);
        check(`${mode}：${n} 色すべてが出てくる`, new Set(vals).size === n, [...new Set(vals)]);
        check(`${mode}：初期値 seed・mode・colors・score 0・moves 0・cleared 0・over/allClear false`,
          s && s.seed === 12345 && s.mode === mode && s.colors === n && s.score === 0 && s.moves === 0 && s.cleared === 0 && s.over === false && s.allClear === false, s && { ...s, grid: '…' });
      }
      const d = L.newGame(7);
      check('mode を省くと normal（4 色）', d && d.mode === 'normal' && d.colors === 4, d && d.mode);
      check('remaining(newGame) は 200', L.remaining(L.newGame(9, 'hard')) === 200, L.remaining(L.newGame(9, 'hard')));
    },
  },
  {
    id: 'QL2', tier: 'smoke', node: true, title: 'まとめてポン：かたまり（上下左右でつながる・斜めは別）・groupAt の並び・1個は消せない・canRemove',
    run({ check, root }) {
      const L = load(root);
      // x0:'00' x1:'10' x2:'1' x3:'2' x4:'2'
      //   y1:  0 0 . . .
      //   y0:  0 1 1 2 2
      const S = mk(['00', '10', '1', '2', '2', '3']);
      check('L 字のかたまり：groupAt(0,0) は [[0,0],[0,1],[1,1]]（x の小さい順、同じ x は y の小さい順）', J(L.groupAt(S, 0, 0)) === '[[0,0],[0,1],[1,1]]', L.groupAt(S, 0, 0));
      check('どのマスから数えても同じかたまり（groupAt(1,1) も同じ並び）', J(L.groupAt(S, 1, 1)) === J(L.groupAt(S, 0, 0)), L.groupAt(S, 1, 1));
      check('横のかたまり：groupAt(1,0) は [[1,0],[2,0]]', J(L.groupAt(S, 1, 0)) === '[[1,0],[2,0]]', L.groupAt(S, 1, 0));
      // 斜めだけでつながる：x0:'01' x1:'10' → (0,0)=0 と (1,1)=0 は斜め
      const D = mk(['01', '10', '2']);
      check('斜めはつながらない：groupAt(0,0) は 1 個、canRemove は false', J(L.groupAt(D, 0, 0)) === '[[0,0]]' && L.canRemove(D, 0, 0) === false && L.canRemove(D, 1, 1) === false, L.groupAt(D, 0, 0));
      const r1 = L.applyRemove(D, 0, 0);
      check('1 個のマスは消せない：invalid・reason "single"・state はそのまま（同じもの）', r1.outcome.kind === 'invalid' && r1.outcome.reason === 'single' && r1.state === D, r1.outcome);
      check('空のマス：groupAt は []、applyRemove は reason "empty"', J(L.groupAt(S, 3, 5)) === '[]' && L.applyRemove(S, 3, 5).outcome.reason === 'empty' && L.canRemove(S, 3, 5) === false, L.applyRemove(S, 3, 5).outcome);
      const bad = [[-1, 0], [10, 0], [0, 20], [0, -1], [1.5, 0], ['0', 0], [null, 0], [0, NaN], [undefined, undefined]];
      const rBad = bad.filter(([x, y]) => { const r = L.applyRemove(S, x, y); return !(r.outcome.kind === 'invalid' && r.outcome.reason === 'range' && r.state === S && J(L.groupAt(S, x, y)) === '[]' && L.canRemove(S, x, y) === false); });
      check('範囲外・整数でない座標：reason "range"、groupAt は []、canRemove は false', rBad.length === 0, rBad.map(String));
      check('canRemove：2 個以上のかたまりは true', L.canRemove(S, 0, 1) === true && L.canRemove(S, 2, 0) === true && L.canRemove(S, 3, 0) === true, null);
      const O = { ...S, over: true };
      check('over の局面：canRemove は false、applyRemove は reason "over"（範囲外より先）', L.canRemove(O, 0, 0) === false && L.applyRemove(O, 0, 0).outcome.reason === 'over' && L.applyRemove(O, -1, 0).outcome.reason === 'over', L.applyRemove(O, 0, 0).outcome);
      // 大きなかたまり（盤全体が1色）
      const F = mk(Array(10).fill(full('2')));
      check('盤全体が同じ色なら 200 個のかたまり', L.groupAt(F, 5, 5).length === 200, L.groupAt(F, 5, 5).length);
    },
  },
  {
    id: 'QL3', tier: 'smoke', node: true, title: 'まとめてポン：点数 (n−2)²・全部消し +1000・outcome の数字・score/moves/cleared の更新',
    run({ check, root }) {
      const L = load(root);
      const tbl = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 4], [10, 64], [200, 39204]];
      const tBad = tbl.filter(([n, p]) => L.scoreFor(n) !== p).map(([n, p]) => ({ n, want: p, got: L.scoreFor(n) }));
      check('scoreFor：2→0、3→1、4→4、10→64、200→39204、0・1→0', tBad.length === 0, tBad);
      const wBad = [-1, 1.5, NaN, '5', null, undefined, Infinity].filter((v) => L.scoreFor(v) !== 0);
      check('scoreFor：負・小数・数でない は 0（例外なし）', wBad.length === 0, wBad.map(String));
      // 4 個のかたまり＋残り（5 こ以上は まわりも消えるので §10 の QL11 で確かめる）
      const S = mk(['0000', '1', '12'], { score: 7, moves: 3 });
      const r = L.applyRemove(S, 0, 2);
      const o = r.outcome;
      check('4 個消す：kind remove・count 4・color 0・points 4・bonus 0・allClear false', o.kind === 'remove' && o.count === 4 && o.color === 0 && o.points === 4 && o.bonus === 0 && o.allClear === false, o);
      check('score は 7+4=11、moves は 4、cleared は +4、remaining は 3', r.state.score === 11 && r.state.moves === 4 && r.state.cleared === S.cleared + 4 && o.remaining === 3 && L.remaining(r.state) === 3, { score: r.state.score, moves: r.state.moves, cleared: r.state.cleared, rem: o.remaining });
      check('cells は消したマス（groupAt と同じ並び）', J(o.cells) === J(L.groupAt(S, 0, 0)), o.cells);
      // 全部消し
      const A = mk(['00', '0'], { score: 5 });
      const a = L.applyRemove(A, 1, 0);
      check('全部消し：allClear true・bonus 1000・points 1・over true・remaining 0', a.outcome.allClear === true && a.outcome.bonus === 1000 && a.outcome.points === 1 && a.outcome.over === true && a.outcome.remaining === 0, a.outcome);
      check('全部消し：score は 5+1+1000=1006、state.allClear・state.over が true', a.state.score === 1006 && a.state.allClear === true && a.state.over === true, { score: a.state.score });
      // 2 個は 0 点でも消せる
      const T = mk(['00', '1', '1']);
      const t = L.applyRemove(T, 0, 1);
      check('2 個は 0 点で消せる（kind remove・points 0）', t.outcome.kind === 'remove' && t.outcome.points === 0 && t.state.score === 0 && t.state.moves === 1, t.outcome);
      // 盤全体が1色 → 1回で全部消し
      const F = mk(Array(10).fill(full('3')));
      const f = L.applyRemove(F, 9, 19);
      check('盤全体が1色：200 個で 39204＋1000 点', f.outcome.count === 200 && f.state.score === 40204 && f.state.allClear === true, f.outcome.count);
    },
  },
  {
    id: 'QL4', tier: 'smoke', node: true, title: 'まとめてポン：落下（列の中ですきまを詰める）と左詰め（空の列が複数・真ん中の列）・falls と shifts',
    run({ check, root }) {
      const L = load(root);
      // 列の中の落下：x0 '1001' の真ん中 00 を消す → '11'、(0,3)→(0,1)
      const S = mk(['1001', '2', '3']);
      const r = L.applyRemove(S, 0, 1);
      check('列の中で上のマスが落ちる：x0 は "11"', r.outcome.kind === 'remove' && J(cols(r.state).slice(0, 3)) === J(['11', '2', '3']), cols(r.state));
      check('falls は [{from:[0,3],to:[0,1]}]、shifts は []', J(r.outcome.falls) === J([{ from: [0, 3], to: [0, 1] }]) && J(r.outcome.shifts) === '[]', r.outcome);
      // 真ん中の列が空になる：x2 '00' と x3 '0'？ → x2 だけが空になるように
      // x0 '1' x1 '2' x2 '00' x3 '3' x4 '13'
      const M = mk(['1', '2', '00', '3', '13']);
      const m = L.applyRemove(M, 2, 0);
      check('真ん中の列が空になる：右の列が左へ詰まる（"1","2","3","13"）', J(cols(m.state).slice(0, 5)) === J(['1', '2', '3', '13', '']), cols(m.state));
      check('shifts は [{from:3,to:2},{from:4,to:3}]、falls は []', J(m.outcome.shifts) === J([{ from: 3, to: 2 }, { from: 4, to: 3 }]) && J(m.outcome.falls) === '[]', m.outcome);
      // 空の列が複数：x1 '0' x2 '0' x3 '00'（つながっている）→ 3 列空く
      const P = mk(['1', '0', '0', '00', '2', '30', '1']);
      const p = L.applyRemove(P, 1, 0);
      check('空の列が複数（x1〜x3 が空く）：右の列が左へ詰まる（"1","2","30","1"）', p.outcome.count === 4 && J(cols(p.state).slice(0, 7)) === J(['1', '2', '30', '1', '', '', '']), cols(p.state));
      check('shifts は [{from:4,to:1},{from:5,to:2},{from:6,to:3}]', J(p.outcome.shifts) === J([{ from: 4, to: 1 }, { from: 5, to: 2 }, { from: 6, to: 3 }]), p.outcome.shifts);
      // 落下と左詰めが同時：x0 '0'、x1 '01'、x2 '2' → 0 を消すと x0 が空、x1 は '1' に落ちる
      const Q = mk(['0', '001', '2']);
      const q = L.applyRemove(Q, 0, 0);
      check('落下と左詰めが同時：盤は "1","2"、falls は左詰めの前の座標（from [1,2] to [1,0]）、shifts は [{1→0},{2→1}]',
        J(cols(q.state).slice(0, 3)) === J(['1', '2', '']) && J(q.outcome.falls) === J([{ from: [1, 2], to: [1, 0] }]) && J(q.outcome.shifts) === J([{ from: 1, to: 0 }, { from: 2, to: 1 }]), q.outcome);
      // 一番右の列が空く：shifts は無い
      const E = mk(['1', '2', '00']);
      const e = L.applyRemove(E, 2, 1);
      check('一番右の色の列が空く：shifts は []', J(e.outcome.shifts) === '[]' && J(cols(e.state).slice(0, 3)) === J(['1', '2', '']), e.outcome);
      // 落ちたマスの数＝ falls の数、各列で空の上に色が無い
      const st = L.newGame(4242);
      const big = L.applyRemove(st, ...findMove(L, st));
      check('newGame の盤で消したあと、どの列も空のマスの上に色が無く、空の列は右に寄る', big.outcome.kind === 'remove' && gravityOk(big.state.grid), cols(big.state));
      // falls の検算：落とす前の盤（消したマスを空にした）で from に色、to は from の下
      const fBad = big.outcome.falls.filter((f) => !(f.from[0] === f.to[0] && f.to[1] < f.from[1] && st.grid[f.from[0]][f.from[1]] !== null));
      check('falls はどれも同じ列で下へ（to の y < from の y）', fBad.length === 0, fBad);
    },
  },
  {
    id: 'QL5', tier: 'smoke', node: true, title: 'まとめてポン：終わりの判定（消せるかたまりが無い→over）・hasMoves・over のあとは消せない',
    run({ check, root }) {
      const L = load(root);
      // 市松模様：消せない
      const ck = []; for (let x = 0; x < 10; x++) { let s = ''; for (let y = 0; y < 20; y++) s += (x + y) % 2; ck.push(s); }
      const K = mk(ck);
      check('市松模様は hasMoves false', L.hasMoves(K) === false, null);
      const K2 = mk(ck.map((s, i) => (i === 9 ? s.slice(0, 19) + s[18] : s)));
      check('右上の1か所だけ同じ色が縦に並ぶ → hasMoves true', L.hasMoves(K2) === true, null);
      // 消したら終わる：x0 '00' x1 '1' x2 '2' → 00 を消すと '1','2' で over
      const S = mk(['100', '2']);
      const r = L.applyRemove(S, 0, 1);
      check('最後のかたまりを消す → outcome.over true・state.over true・allClear false・remaining 2', r.outcome.over === true && r.state.over === true && r.state.allClear === false && r.outcome.remaining === 2, r.outcome);
      check('over のあとはどこを押しても reason "over"', L.applyRemove(r.state, 0, 0).outcome.reason === 'over' && L.canRemove(r.state, 0, 0) === false, null);
      // まだ消せる
      const T = mk(['1100', '2']);
      const t = L.applyRemove(T, 0, 2);
      check('消したあとにまだ消せるかたまりがある → over false', t.outcome.over === false && t.state.over === false && L.hasMoves(t.state) === true, t.outcome);
      // 横のつながりだけ残る
      const H = mk(['1', '1', '00']);
      const h = L.applyRemove(H, 2, 0);
      check('横に2つ並ぶだけでも over にならない', h.outcome.over === false && L.hasMoves(h.state) === true, cols(h.state));
      check('空の盤は hasMoves false・remaining 0', L.hasMoves(mk([])) === false && L.remaining(mk([])) === 0, null);
    },
  },
  {
    id: 'QL6', tier: 'smoke', node: true, title: 'まとめてポン：同じ種で同じ盤・違う種で違う盤・最初から消せない盤を出さない・種の丸め（Date.now() でも 32bit）',
    run({ check, root }) {
      const L = load(root);
      const a = L.newGame(20261020), b = L.newGame(20261020), c = L.newGame(20261021);
      check('同じ種なら必ず同じ盤（JSON が同じ）', J(a) === J(b), null);
      check('違う種なら違う盤', J(a.grid) !== J(c.grid), null);
      check('同じ種でも normal と hard は違う盤', J(L.newGame(5, 'normal').grid) !== J(L.newGame(5, 'hard').grid), null);
      let noMove = 0, rngSame = true;
      for (let s = 0; s < 2000; s++) { if (!L.hasMoves(L.newGame(s, s % 2 ? 'hard' : 'normal'))) noMove++; }
      check('種 0〜1999 のどの盤も最初から消せるかたまりがある', noMove === 0, noMove);
      const r1 = L.makeRng(99), r2 = L.makeRng(99);
      for (let i = 0; i < 50; i++) { const v = r1(); if (v !== r2() || !(v >= 0 && v < 1)) rngSame = false; }
      check('makeRng：同じ種で同じ並び、0 以上 1 未満', rngSame, null);
      const now = 1792483200123;
      const n = L.newGame(now);
      check('Date.now() のような大きな種も受け付け、seed は 0〜4294967295 に丸まる（同じ値なら同じ盤）', n && Number.isInteger(n.seed) && n.seed >= 0 && n.seed <= 4294967295 && J(n) === J(L.newGame(now)), n && n.seed);
      check('丸めた seed で作り直しても同じ盤（保存→再開で同じ）', J(L.newGame(n.seed).grid) === J(n.grid), null);
      check('負の種も丸まる（-1 → 4294967295 と同じ盤）', J(L.newGame(-1).grid) === J(L.newGame(4294967295).grid) && L.newGame(-1).seed === 4294967295, null);
      const badSeeds = [NaN, Infinity, '1', null, undefined, {}, []];
      const sBad = badSeeds.filter((v) => { try { return L.newGame(v) !== null; } catch { return true; } });
      check('数でない・有限でない種は null（例外なし）', sBad.length === 0, sBad.map(String));
      check('同じ種でも easy と normal は違う盤、easy は 3 色', J(L.newGame(5, 'easy').grid) !== J(L.newGame(5, 'normal').grid) && L.newGame(5, 'easy').colors === 3, null);
      const badModes = ['Easy', 'EASY', '', null, 4, 'Normal', 'toString', '__proto__'];
      const mBad = badModes.filter((v) => { try { return L.newGame(1, v) !== null; } catch { return true; } });
      check('easy・normal・hard 以外の mode は null（例外なし）', mBad.length === 0, mBad.map(String));
    },
  },
  {
    id: 'QL7', tier: 'smoke', node: true, title: 'まとめてポン：replay・makeSave・validateSave（壊れた値の一覧）・validateBest・recordBest・validateFlag',
    run({ check, root }) {
      const L = load(root);
      // 1 回ぶん遊んで、途中を保存→再開
      let s = L.newGame(777, 'hard'); const mv = [];
      for (let i = 0; i < 6 && !s.over; i++) { const m = findMove(L, s); const r = L.applyRemove(s, m[0], m[1]); s = r.state; mv.push(m); }
      const raw = L.makeSave(s, mv);
      check('makeSave は { v:3, seed, mode, moves } の JSON（§10 で 2、5こ以上・まわり +3 点に変えたので v は 3）', J(JSON.parse(raw)) === J({ v: 3, seed: 777, mode: 'hard', moves: mv }), raw);
      const sv = L.validateSave(raw);
      check('validateSave(makeSave) は { seed, mode, moves }', sv && sv.seed === 777 && sv.mode === 'hard' && J(sv.moves) === J(mv), sv);
      const rp = L.replay(sv.seed, sv.mode, sv.moves);
      check('replay で同じ局面に戻る（ok true・applied 6・JSON が同じ）', rp.ok === true && rp.applied === mv.length && J(rp.state) === J(s), { ok: rp.ok, applied: rp.applied });
      const rp0 = L.replay(1, 'normal', []);
      check('replay(手なし) は newGame と同じ', rp0.ok === true && rp0.applied === 0 && J(rp0.state) === J(L.newGame(1, 'normal')), null);
      // 消せない手で止まる
      const bad = L.replay(777, 'hard', [...mv.slice(0, 2), [-1, 0], mv[2]]);
      check('途中に消せない手 → ok false・applied 2・state はその手の前', bad.ok === false && bad.applied === 2 && J(bad.state) === J(L.replay(777, 'hard', mv.slice(0, 2)).state), { ok: bad.ok, applied: bad.applied });
      const one = L.newGame(3); const single = findSingle(L, one);
      const bs = L.replay(3, 'normal', [single]);
      check('1 個のマスを押す手 → ok false・applied 0', bs.ok === false && bs.applied === 0, bs);
      const rb = [L.replay(NaN, 'normal', []), L.replay(1, 'x', []), L.replay(1, 'normal', 'abc'), L.replay(1, 'normal', [[0]]), L.replay(1, 'normal', [null])];
      check('replay の壊れた引数：例外なし・ok false', rb.every((r) => r && r.ok === false) && rb[0].state === null, rb.map((r) => r && r.ok));
      // validateSave の壊れた値
      const okSave = { v: 3, seed: 5, mode: 'normal', moves: [[0, 0]] };
      const broken = [
        undefined, null, 1, '', 'abc', '{', '[]', 'null', '"x"', '123',
        J({ ...okSave, v: 4 }), J({ ...okSave, v: 0 }), J({ ...okSave, v: '1' }), J({ ...okSave, v: '2' }), J({ ...okSave, v: '3' }),
        J({ ...okSave, v: 1, seed: 1.5 }), J({ ...okSave, v: 1, mode: 'x' }), J({ ...okSave, v: 1, moves: [[0]] }), J({ ...okSave, v: 2, seed: 1.5 }), J({ ...okSave, v: 2, mode: 'x' }), J({ ...okSave, v: 2, moves: [[0]] }), J({ seed: 5, mode: 'normal', moves: [] }),
        J({ ...okSave, seed: 1.5 }), J({ ...okSave, seed: '5' }), J({ ...okSave, seed: 4294967296 }), J({ ...okSave, seed: -2147483649 }), J({ ...okSave, seed: null }),
        J({ ...okSave, mode: 'Easy' }), J({ ...okSave, mode: 'veryhard' }), J({ ...okSave, mode: null }), J({ ...okSave, mode: 'toString' }), J({ ...okSave, mode: '__proto__' }),
        J({ ...okSave, moves: {} }), J({ ...okSave, moves: 'x' }), J({ ...okSave, moves: null }),
        J({ ...okSave, moves: Array(201).fill([0, 0]) }), J({ ...okSave, moves: [[0]] }), J({ ...okSave, moves: [[0, 0, 0]] }), J({ ...okSave, moves: [[0, 1.5]] }), J({ ...okSave, moves: [['0', 0]] }), J({ ...okSave, moves: [null] }), J({ ...okSave, moves: [{ 0: 0, 1: 0, length: 2 }] }),
      ];
      const vBad = broken.filter((v) => { try { return L.validateSave(v) !== null; } catch { return true; } });
      check(`validateSave：壊れた値 ${broken.length} 通りはすべて null（例外なし）`, vBad.length === 0, vBad);
      const good = [J(okSave), J({ ...okSave, moves: [] }), J({ ...okSave, moves: Array(200).fill([0, 0]) }), J({ ...okSave, seed: 4294967295 }), J({ ...okSave, seed: -2147483648 }), J({ ...okSave, mode: 'hard', extra: 1 }), J({ ...okSave, mode: 'easy' })];
      const gBad = good.filter((v) => L.validateSave(v) === null);
      check('validateSave：正しい値（手 0 個・200 個・seed の両端・余計な項目つき・やさしい）は受け付ける', gBad.length === 0, gBad);
      // 前の版（v:2・v:1）の途中保存：形が正しければ、手を捨てて同じ種・同じモードの最初から（§10）
      for (const ov of [1, 2]) {
        const vo = L.validateSave(J({ v: ov, seed: 777, mode: 'hard', moves: mv }));
        check(`v:${ov} の保存は { seed, mode, moves: [] }（手を捨てる。replay すると newGame と同じ）`, vo && vo.seed === 777 && vo.mode === 'hard' && J(vo.moves) === '[]' && J(L.replay(vo.seed, vo.mode, vo.moves).state) === J(L.newGame(777, 'hard')), vo);
      }
      // validateBest / recordBest / validateFlag
      const B = [['12', 12], [34, 34], ['0', 0], [0, 0], ['-1', 0], [-5, 0], ['1.5', 0], ['abc', 0], [null, 0], [undefined, 0], [NaN, 0], ['9007199254740993', 0], [{}, 0], [[], 0], ['', 0], [Infinity, 0]];
      const bBad = B.filter(([v, w]) => { try { return L.validateBest(v) !== w; } catch { return true; } }).map(([v]) => String(v));
      check('validateBest：安全な整数で 0 以上ならその値、それ以外は 0', bBad.length === 0, bBad);
      const rb1 = L.recordBest('10', 25), rb2 = L.recordBest(30, 25), rb3 = L.recordBest('壊れ', 5), rb4 = L.recordBest(5, 5);
      check('recordBest：更新したら improved true、同点・下回りは false、壊れた前回は 0 扱い', J(rb1) === J({ best: 25, improved: true }) && J(rb2) === J({ best: 30, improved: false }) && J(rb3) === J({ best: 5, improved: true }) && J(rb4) === J({ best: 5, improved: false }), [rb1, rb2, rb3, rb4]);
      check('validateFlag：\'1\' のときだけ true', L.validateFlag('1') === true && [1, true, '0', '', null, undefined, '11'].every((v) => L.validateFlag(v) === false), null);
      check('makeSave は壊れた state でも例外を出さない', (() => { try { return typeof L.makeSave(null, null) === 'string'; } catch { return false; } })(), null);
    },
  },
  {
    id: 'QL8', tier: 'smoke', node: true, title: 'まとめてポン：イミュータブル（元の state を変えない・凍結）・おかしな引数で例外を出さない',
    run({ check, root }) {
      const L = load(root);
      const s = L.newGame(31);
      const before = J(s);
      const m = findMove(L, s);
      const r = L.applyRemove(s, m[0], m[1]);
      check('applyRemove は元の state を変えない', J(s) === before && r.state !== s && r.state.grid !== s.grid, null);
      check('newGame・applyRemove の state と grid・各列が凍結されている', Object.isFrozen(s) && Object.isFrozen(s.grid) && s.grid.every(Object.isFrozen) && Object.isFrozen(r.state) && r.state.grid.every(Object.isFrozen), null);
      check('outcome（cells・falls・shifts）も凍結されている', Object.isFrozen(r.outcome) && Object.isFrozen(r.outcome.cells) && Object.isFrozen(r.outcome.falls) && Object.isFrozen(r.outcome.shifts), null);
      // 手で組んだ（凍結していない）state を渡しても書き換えない
      const H = mk(['00', '1']); const hb = J(H);
      L.applyRemove(H, 0, 0); L.groupAt(H, 0, 0); L.hasMoves(H);
      check('手で組んだ state も書き換えない', J(H) === hb, null);
      // 壊れた state
      const brokenStates = [null, undefined, 1, 'x', {}, [], { grid: [] }, { ...mk([]), grid: null }, { ...mk(['0']), colors: 0 },
        { ...mk(['0']), grid: mk(['0']).grid.slice(0, 9) }, { ...mk(['0']), grid: mk(['0']).grid.map((c) => c.slice(0, 19)) },
        mk(['9']), mk(['0'], { colors: 4, score: -1 }), { ...mk(['00']), score: NaN },
        { ...mk(['00']), grid: mk(['00']).grid.map((c, i) => (i === 0 ? [null, 0, ...c.slice(2)] : c)) },   // 空の上に色（浮いている）
        mk(['', '00']),                                                                                       // 空の列の右に色
        { ...mk(['00']), grid: mk(['00']).grid.map((c, i) => (i === 0 ? [0, '0', ...c.slice(2)] : c)) }];
      const thrown = [], notInvalid = [];
      for (const b of brokenStates) {
        try {
          const r2 = L.applyRemove(b, 0, 0);
          if (!(r2 && r2.outcome && r2.outcome.kind === 'invalid')) notInvalid.push(J(b));
          if (J(L.groupAt(b, 0, 0)) !== '[]' || L.canRemove(b, 0, 0) !== false || L.hasMoves(b) !== false || L.remaining(b) !== 0) notInvalid.push('q:' + J(b));
        } catch (e) { thrown.push(String(e)); }
      }
      check(`壊れた state ${brokenStates.length} 通り：例外なし`, thrown.length === 0, thrown);
      check('壊れた state：applyRemove は invalid、groupAt は []、canRemove・hasMoves は false、remaining は 0', notInvalid.length === 0, notInvalid.slice(0, 4));
      const calls = [() => L.makeRng(), () => L.makeRng('x')(), () => L.makeRng({ valueOf() { throw new Error('x'); } })(), () => L.scoreFor(), () => L.colorName(), () => L.validateSave(), () => L.validateBest(), () => L.recordBest(), () => L.validateFlag(), () => L.replay(), () => L.newGame()];
      const cBad = calls.map((f, i) => { try { f(); return null; } catch (e) { return i + ':' + e; } }).filter(Boolean);
      check('引数なし・おかしな引数でも例外を出さない', cBad.length === 0, cBad);
    },
  },
  {
    id: 'QL11', tier: 'smoke', node: true, title: 'まとめてポン §10：5こ以上で まわりも消える（上下左右 r マス以内・色を問わない・盤の端・空のマスは数えない）、れんぞく（5こ以上で +1・4こ以下で 0・3 回目から r=2）、点数 (n−2)²＋まわりの数×3、preview、undo（前の state）と replay で streak が同じ',
    run({ check, root }) {
      const L = load(root);
      check('定数：BIG 5・STREAK_WIDE 3・RADIUS { near 1, wide 2 }・EXTRA_POINT 3・SAVE_V 3', L.BIG === 5 && L.STREAK_WIDE === 3 && J(L.RADIUS) === J({ near: 1, wide: 2 }) && L.EXTRA_POINT === 3 && L.SAVE_V === 3, { BIG: L.BIG, W: L.STREAK_WIDE, R: L.RADIUS });
      // 盤：1 と 2 の市松（どこもつながらない）に、色 0 の縦 5 こ（列 gx の 0〜4 段）。列 0〜5 は高さ h
      const board = (gx, h = 12, n = 5, streak) => {
        const cs = [];
        for (let x = 0; x < 6; x++) { let t = ''; for (let y = 0; y < h; y++) t += (x === gx && y < n) ? '0' : String(1 + ((x + y) % 2)); cs.push(t); }
        const st = mk(cs);
        return streak === undefined ? st : { ...st, streak };
      };
      // 総当たりの期待値：かたまりの外で、どれかのマスからマンハッタン距離 r 以内の色のあるマス
      const around = (st, cells, r) => {
        const out = [];
        for (let x = 0; x < 10; x++) for (let y = 0; y < 20; y++) {
          if (st.grid[x][y] === null || cells.some(([a, b]) => a === x && b === y)) continue;
          if (cells.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) <= r)) out.push([x, y]);
        }
        return out;
      };
      const S1 = board(3);
      const g1 = L.groupAt(S1, 3, 0);
      const r1 = L.applyRemove(S1, 3, 3), o1 = r1.outcome;
      check(`5 こ（れんぞく 0 から）：radius 1・まわり ${o1.extra && o1.extra.length} こ（左右の列 5 こずつ＋上 1 こ＝11、色 1・2 の両方）`, g1.length === 5 && o1.radius === 1 && J(o1.extra) === J(around(S1, g1, 1)) && o1.extra.length === 11 && new Set(o1.extra.map(([a, b]) => S1.grid[a][b])).size === 2, o1.extra);
      check(`点数は (5−2)²＋11×3 ＝ 42（points ${o1.points}・extraPoints ${o1.extraPoints}）、streak 1、cleared は 5＋11、残りは 72−16`, o1.points === 42 && o1.extraPoints === 33 && o1.streak === 1 && r1.state.streak === 1 && r1.state.score === 42 && r1.state.cleared === S1.cleared + 16 && o1.remaining === 56, { p: o1.points, st: r1.state.streak, rem: o1.remaining });
      check('まわりはかたまりのマスと重ならない、消したあとの盤に まわりのマスが残らない（落下で詰まる）', o1.extra.every(([a, b]) => !g1.some(([c, d]) => a === c && b === d)) && L.remaining(r1.state) === 72 - 16, null);
      // 盤の端（列 0）：はみ出さない
      const E = board(0), ge = L.groupAt(E, 0, 0), oe = L.applyRemove(E, 0, 0).outcome;
      check(`盤の端（左の列）：まわりは右の列 5 こ＋上 1 こ＝6（${oe.extra.length}）、範囲外を数えない`, oe.extra.length === 6 && J(oe.extra) === J(around(E, ge, 1)), oe.extra);
      // 空のマスは数えない（列の高さが 5 なら上は空）
      const Hs = board(3, 5), oh = L.applyRemove(Hs, 3, 0).outcome;
      check(`上が空：空のマスは まわりに入らない（${oh.extra.length} こ＝左右 10）`, oh.extra.length === 10 && oh.extra.every(([a, b]) => Hs.grid[a][b] !== null), oh.extra);
      // れんぞく：前が 1 → 2（r=1）、前が 2 → 3（r=2）、前が 5 → 6（r=2 のまま）
      const o_1 = L.applyRemove(board(3, 12, 5, 1), 3, 0).outcome;
      const S2 = board(3, 12, 5, 2), r2 = L.applyRemove(S2, 3, 0), o2 = r2.outcome;
      const o5 = L.applyRemove(board(3, 12, 5, 5), 3, 0).outcome;
      check(`れんぞく：前 1 → streak 2・r 1、前 2 → streak 3・r 2（まわり ${o2.extra.length} こ＝24）、前 5 → streak 6・r 2`, o_1.streak === 2 && o_1.radius === 1 && o2.streak === 3 && o2.radius === 2 && J(o2.extra) === J(around(S2, L.groupAt(S2, 3, 0), 2)) && o2.extra.length === 24 && o5.streak === 6 && o5.radius === 2, { a: [o_1.streak, o_1.radius], b: [o2.streak, o2.radius, o2.extra.length], c: [o5.streak, o5.radius] });
      check(`r=2 の点数は 9＋24×3 ＝ 81（${o2.points}）`, o2.points === 81 && r2.state.score === 81, o2.points);
      // 4 こ以下：まわりなし・れんぞく 0
      const S6 = board(3, 12, 4, 2), r6 = L.applyRemove(S6, 3, 0), o6 = r6.outcome;
      check(`4 こ（前 2）：まわりなし（extra []・radius 0・extraPoints 0）、点 4、streak 0 に戻る`, J(o6.extra) === '[]' && o6.radius === 0 && o6.extraPoints === 0 && o6.points === 4 && o6.streak === 0 && r6.state.streak === 0, o6);
      const S8 = board(3, 12, 6), o8 = L.applyRemove(S8, 3, 0).outcome;
      check(`6 こ：まわりも消える（${o8.extra.length} こ）・点 16＋まわり×3`, o8.radius === 1 && o8.extra.length === 13 && o8.points === 16 + 13 * 3, o8.extra.length);
      // newGame の streak は 0、streak の無い手組みの state は 0 とみなす、壊れた streak は invalid
      check('newGame の streak は 0、streak の無い state は 0 とみなす、負・小数の streak は壊れた state（invalid）', L.newGame(1).streak === 0 && L.applyRemove(board(3), 3, 0).outcome.streak === 1 && L.applyRemove(board(3, 12, 5, -1), 3, 0).outcome.kind === 'invalid' && L.applyRemove(board(3, 12, 5, 1.5), 3, 0).outcome.kind === 'invalid', null);
      // preview は applyRemove と同じ（盤は変えない）
      const pv = L.preview(S2, 3, 4), pv6 = L.preview(S6, 3, 0);
      check('preview(state, x, y)：cells・extra・radius・points・extraPoints・streak が applyRemove と同じ、盤は変えない', pv && J(pv.cells) === J(o2.cells) && J(pv.extra) === J(o2.extra) && pv.radius === 2 && pv.points === 81 && pv.extraPoints === 72 && pv.streak === 3 && pv.count === 5 && pv6 && pv6.radius === 0 && pv6.extra.length === 0 && pv6.points === 4 && pv6.streak === 0, { pv, pv6 });
      const pvBad = [L.preview(S1, 0, 0), L.preview(S1, 9, 0), L.preview(S1, -1, 0), L.preview(null, 0, 0), L.preview({ ...S1, over: true }, 3, 0)];
      check('preview：1 こ・空・範囲外・壊れた state・over は null（例外なし）', pvBad.every((v) => v === null), pvBad);
      // 1手もどす（前の state を使う）と streak も戻る・replay で streak が同じ
      let s = L.newGame(4242); const mv = []; const hist = [s];
      for (let i = 0; i < 40 && !s.over; i++) {
        let best = null;
        for (let x = 0; x < 10; x++) for (let y = 0; y < 20; y++) { const g = L.groupAt(s, x, y); if (g.length >= 2 && (!best || g.length > best.n)) best = { x, y, n: g.length }; }
        const r = L.applyRemove(s, best.x, best.y); s = r.state; mv.push([best.x, best.y]); hist.push(s);
      }
      const streaks = hist.map((h) => h.streak);
      const rpOk = hist.every((h, i) => L.replay(h.seed, h.mode, mv.slice(0, i)).state.streak === h.streak);
      check(`1手もどす（前の state）で streak も戻り、replay の streak が手の途中でも同じ（${streaks.join(',')}）、5こ以上が続いた所がある`, rpOk && hist.every(Object.isFrozen) && Math.max(...streaks) >= 2, streaks);
    },
  },
  {
    id: 'QL9', tier: 'full', node: true, title: 'まとめてポン：1000 回の乱数プレイで不変条件（マスの数＝残り＋消した数、点数＝各手の和、重力、over＝消せない、replay で同じ局面）',
    run({ check, root }) {
      const L = load(root);
      const bad = [];
      let games = 0, movesTotal = 0, allClears = 0, invalidTried = 0, blasts = 0, wides = 0;
      const rnd = rng32(0xC0FFEE);
      for (let gi = 0; gi < 1000; gi++) {
        const mode = ['normal', 'hard', 'easy'][gi % 3];
        const seed = Math.floor(rnd() * 4294967296);
        let s = L.newGame(seed, mode);
        const mv = []; let sum = 0;
        let guard = 0;
        while (!s.over && guard++ < 400) {
          // ときどき適当なマスを押す（消せない手の確かめ）。ふだんは消せるマスから乱数で選ぶ
          if (rnd() < 0.3) {
            const x = Math.floor(rnd() * 10), y = Math.floor(rnd() * 20);
            const r0 = L.applyRemove(s, x, y);
            if (r0.outcome.kind === 'invalid') {
              invalidTried++;
              if (r0.state !== s) bad.push(`${seed}: invalid で state が変わった`);
              if (L.canRemove(s, x, y)) bad.push(`${seed}: canRemove true なのに invalid (${x},${y})`);
              continue;
            }
          }
          const cand = [];
          const g = s.grid;
          for (let cx = 0; cx < 10; cx++) for (let cy = 0; cy < 20; cy++) {
            const v = g[cx][cy];
            if (v !== null && ((cx + 1 < 10 && g[cx + 1][cy] === v) || (cy + 1 < 20 && g[cx][cy + 1] === v) || (cx > 0 && g[cx - 1][cy] === v) || (cy > 0 && g[cx][cy - 1] === v))) cand.push([cx, cy]);
          }
          if (cand.length === 0) { bad.push(`${seed}: over でないのに消せるマスが無い`); break; }
          const [x, y] = cand[Math.floor(rnd() * cand.length)];
          if (!L.canRemove(s, x, y)) { bad.push(`${seed}: 2 個以上つながるのに canRemove が false (${x},${y})`); break; }
          const r = L.applyRemove(s, x, y);
          if (r.outcome.kind !== 'remove') { bad.push(`${seed}: canRemove true なのに消せない (${x},${y})`); break; }
          const o = r.outcome, ns = r.state;
          sum += o.points + o.bonus;
          mv.push([x, y]);
          if (o.radius >= 1) blasts++;
          if (o.radius === 2) wides++;
          if (o.count !== o.cells.length || o.count < 2) bad.push(`${seed}: count と cells が合わない`);
          const ex = o.extra || [];
          if (o.points !== (o.count - 2) ** 2 + ex.length * 3 || o.extraPoints !== ex.length * 3) bad.push(`${seed}: points が (n-2)^2＋まわりの数×3 でない`);
          // §10：5こ以上で まわり（r は れんぞく 3 回目から 2）、4こ以下は まわりなし・れんぞく 0
          const st0 = s.streak || 0, wantR = o.count >= 5 ? (st0 + 1 >= 3 ? 2 : 1) : 0, wantSt = o.count >= 5 ? st0 + 1 : 0;
          if (o.radius !== wantR || o.streak !== wantSt || ns.streak !== wantSt) bad.push(`${seed}: radius / streak が違う（${o.count} こ・前 ${st0}）`);
          const inCells = new Set(o.cells.map(([a, b]) => a * 100 + b));
          const exWant = [];
          for (let ax = 0; ax < 10; ax++) for (let ay = 0; ay < 20; ay++) {
            if (inCells.has(ax * 100 + ay) || s.grid[ax][ay] === null || wantR === 0) continue;
            if (o.cells.some(([a, b]) => Math.abs(a - ax) + Math.abs(b - ay) <= wantR)) exWant.push([ax, ay]);
          }
          if (J(ex) !== J(exWant)) bad.push(`${seed}: まわりのマスが総当たりと違う`);
          if (L.remaining(ns) + ns.cleared !== 200) bad.push(`${seed}: 残り＋消した数が 200 でない`);
          if (ns.cleared !== L.remaining(s) - L.remaining(ns) + s.cleared) bad.push(`${seed}: cleared の増え方が違う`);
          if (o.remaining !== L.remaining(ns)) bad.push(`${seed}: outcome.remaining が違う`);
          if (ns.score !== sum) bad.push(`${seed}: score が各手の和でない`);
          if (ns.moves !== mv.length) bad.push(`${seed}: moves が手の数でない`);
          if (!gravityOk(ns.grid)) bad.push(`${seed}: 浮いたマスか、空の列の右に色がある`);
          if (ns.over !== !bruteHasMoves(ns.grid) || L.hasMoves(ns) !== bruteHasMoves(ns.grid)) bad.push(`${seed}: over / hasMoves が総当たりと違う`);
          if (o.allClear !== (L.remaining(ns) === 0) || o.bonus !== (o.allClear ? 1000 : 0)) bad.push(`${seed}: allClear / bonus が違う`);
          // 色ごとの数：消した色だけが count 減る
          const cnt = (g) => { const a = [0, 0, 0, 0, 0]; for (const c of g) for (const v of c) if (v !== null) a[v]++; return a; };
          const c0 = cnt(s.grid), c1 = cnt(ns.grid);
          const exByColor = [0, 0, 0, 0, 0]; for (const [a, b] of ex) exByColor[s.grid[a][b]]++;
          if (!c0.every((n, i) => n - c1[i] === (i === o.color ? o.count : 0) + exByColor[i])) bad.push(`${seed}: 色ごとの数が合わない`);
          if (o.falls.length > 0 && o.falls.some((f) => s.grid[f.from[0]][f.from[1]] === null)) bad.push(`${seed}: falls の from が空のマス`);
          s = ns;
          if (bad.length > 10) break;
        }
        if (!s.over) bad.push(`${seed}: 400 回押しても終わらない`);
        if (s.allClear) allClears++;
        movesTotal += mv.length; games++;
        if (gi % 10 === 0) {
          const sv = L.validateSave(L.makeSave(s, mv));
          const rp = sv && L.replay(sv.seed, sv.mode, sv.moves);
          if (!(rp && rp.ok && J(rp.state) === J(s))) bad.push(`${seed}: 保存→replay で同じ局面にならない`);
        }
        if (bad.length > 10) break;
      }
      check(`1000 回の乱数プレイ（${games} 回・合計 ${movesTotal} 手・全部消し ${allClears} 回・消せない手 ${invalidTried} 回・まわりも消えた手 ${blasts}・広い手 ${wides}）で不変条件がすべて成り立つ`, bad.length === 0 && games === 1000 && blasts > 0 && wides > 0, bad.slice(0, 10));
    },
  },
  {
    id: 'QL10', tier: 'smoke', node: true, title: 'まとめてポン：モードの記憶 validateMode・いちばん少ない のこり validateLeast／recordLeast（壊れた値は記録なし）・「おしい」の線 isNear（やさしい 5・ふつう 10・むずかしい 15）',
    run({ check, root }) {
      const L = load(root);
      const okModes = ['easy', 'normal', 'hard'].filter((m) => L.validateMode(m) === m);
      const badModes = [null, undefined, '', 'Easy', 'HARD', 'toString', '__proto__', 'constructor', 3, {}, [], 'normal ', 'veryhard'];
      const mBad = badModes.filter((v) => { try { return L.validateMode(v) !== 'normal'; } catch { return true; } }).map(String);
      check('validateMode：easy・normal・hard はそのまま', okModes.length === 3, okModes);
      check(`validateMode：無い・壊れた値（${badModes.length} 通り）は normal（例外なし）`, mBad.length === 0, mBad);
      const good = [['0', 0], ['5', 5], [5, 5], ['200', 200], [0, 0], [' 7 ', 7]];
      const gBad = good.filter(([v, w]) => L.validateLeast(v) !== w).map(([v]) => String(v));
      check('validateLeast：0〜200 の整数（文字列も）はその値', gBad.length === 0, gBad);
      const broken = [null, undefined, '', 'abc', '-1', -1, '1.5', 1.5, '201', 201, 'NaN', NaN, 'Infinity', Infinity, '1e2', '0x10', {}, [], true, '９'];
      const bBad = broken.filter((v) => { try { return L.validateLeast(v) !== null; } catch { return true; } }).map(String);
      check(`validateLeast：壊れた値 ${broken.length} 通りは null（記録なし。例外なし）`, bBad.length === 0, bBad);
      const r1 = L.recordLeast(null, 12), r2 = L.recordLeast('12', 8), r3 = L.recordLeast('8', 8), r4 = L.recordLeast('8', 20), r5 = L.recordLeast('壊れ', 30), r6 = L.recordLeast('3', 0), r7 = L.recordLeast('9', 'x');
      check('recordLeast：はじめては記録して improved false（まえ null）、少なければ improved true、同じ・多いは前のまま',
        J(r1) === J({ least: 12, improved: false, prev: null }) && J(r2) === J({ least: 8, improved: true, prev: 12 }) && J(r3) === J({ least: 8, improved: false, prev: 8 }) && J(r4) === J({ least: 8, improved: false, prev: 8 }), [r1, r2, r3, r4]);
      check('recordLeast：壊れた前の記録は「記録なし」として今回で書き直す、全部消し（0）も記録になる、今回が壊れていたら前のまま',
        J(r5) === J({ least: 30, improved: false, prev: null }) && J(r6) === J({ least: 0, improved: true, prev: 3 }) && J(r7) === J({ least: 9, improved: false, prev: 9 }), [r5, r6, r7]);
      const near = [['easy', 5, true], ['easy', 6, false], ['normal', 10, true], ['normal', 11, false], ['hard', 15, true], ['hard', 16, false], ['normal', 0, false], ['easy', 1, true], ['x', 10, true], ['x', 11, false], ['hard', 1.5, false]];
      const nBad = near.filter(([m, n, w]) => L.isNear(m, n) !== w).map((x) => x.join(':'));
      check('isNear：のこりが線以下（全部消しの 0 は含まない）で true。線はモード別、知らないモードは ふつう の線', nBad.length === 0, nBad);
    },
  },
];

// 消せる手を1つ（左下から）
function findMove(L, s) {
  for (let x = 0; x < 10; x++) for (let y = 0; y < 20; y++) if (L.canRemove(s, x, y)) return [x, y];
  return [0, 0];
}
// 1 個だけのマスを1つ
function findSingle(L, s) {
  for (let x = 0; x < 10; x++) for (let y = 0; y < 20; y++) if (s.grid[x][y] !== null && L.groupAt(s, x, y).length === 1) return [x, y];
  return [0, 0];
}
