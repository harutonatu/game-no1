// BL: いろびんの計算ロジック（Node で games/irobin/logic.js を直接読む。ブラウザ不要）
//   契約は docs/irobin-contract.md（§3 定数・面の表、§4 ロジックの API、§12.2 BL の項目）。
//   局面は契約 §4.1 の形を手で組む（mk）。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・IrobinLogic を公開していなければ例外で不合格にする。
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
// 重さを測る CPU 時間（このスレッドだけ。GC・JIT の裏のスレッドと、CPU が混んで待たされた時間を数えない。古い Node は process.cpuUsage。T-21）
const cpuOf = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));

function load(root) {
  const f = path.join(root, 'games/irobin/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/irobin/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.createLevel !== 'function' || typeof L.applyMove !== 'function') throw new Error('logic.js が IrobinLogic を module.exports していない');
  return L;
}

// ---- 局面を手で組む ----
// 瓶の指定：色の配列（下→上）。{ c: [...], h: [true,...], sealed: true, cover: k } で隠れ・栓・布（§17）も指定できる
const B = (spec) => {
  const o = Array.isArray(spec) ? { c: spec } : spec;
  return { cells: [...o.c], hidden: o.h ? [...o.h] : o.c.map(() => false), sealed: !!o.sealed, ...(o.cover !== undefined ? { cover: o.cover } : {}) };
};
function mk(bottles, { slots = [null, null], queue = [], served = 0, total, moves = 0, won = false, params = { colors: 3, empties: 1, hidden: false, order: 'random' } } = {}) {
  return { level: 1, params, bottles: bottles.map(B), slots: [...slots], queue: [...queue], served, total: total ?? served + slots.filter((x) => x !== null).length + queue.length, moves, won };
}
const J = (x) => JSON.stringify(x);
const colorsOf = (s) => s.bottles.map((b) => b.cells.join(''));

export const tests = [
  {
    id: 'BL1', tier: 'smoke', node: true, title: 'いろびん：定数・COLORS（9色・色と記号がすべて違う）・paramsFor が面の表どおり（境界・壊れた値）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'いろびん', CAP: 4, ORDER_SLOTS: 2, MAX_COLORS: 9, MAX_MOVES_SAVED: 2000, SOLVE_NODE_LIMIT: 40000, GEN_NODE_BUDGET: 200000, GEN_TRIES: 40, SAVE_KEY_BEST: 'irobin.best', SAVE_KEY_SAVE: 'irobin.save', SAVE_KEY_HELP: 'irobin.help' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §3 のとおり', kBad.length === 0, kBad);
      const C = L.COLORS;
      const idOk = Array.isArray(C) && C.length === 9 && C.every((c, i) => c.id === i);
      check('COLORS は 9 色で id が 0〜8', idOk, C);
      const uniq = (key) => new Set(C.map((c) => c[key])).size === C.length;
      check('key・name・hex・mark がすべて違う（色だけに頼らない＝記号も違う）', uniq('key') && uniq('name') && uniq('hex') && uniq('mark') && C.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex) && c.mark && c.name), C);
      check('COLORS が凍結されている', Object.isFrozen(C), null);
      // 面の表（§3.2）
      const T = (lv, colors, empties, hidden, order) => ({ lv, colors, empties, hidden, order });
      const table = [
        T(1, 2, 2, false, 'easy'), T(2, 3, 2, false, 'easy'), T(3, 4, 2, false, 'easy'), T(4, 5, 2, false, 'easy'), T(5, 5, 2, false, 'easy'),
        T(6, 6, 2, false, 'random'), T(9, 6, 2, false, 'random'),
        T(10, 7, 2, false, 'random'), T(11, 7, 2, false, 'random'), T(12, 7, 2, true, 'random'), T(13, 7, 2, false, 'random'), T(14, 7, 2, true, 'random'),
        T(15, 8, 2, true, 'random'), T(16, 8, 2, false, 'random'), T(23, 8, 2, true, 'random'), T(24, 8, 2, false, 'random'),
        T(25, 9, 2, true, 'random'), T(26, 9, 2, false, 'random'), T(39, 9, 2, true, 'random'),
        T(40, 9, 2, true, 'random'), T(41, 9, 2, true, 'random'), T(1000, 9, 2, true, 'random'),
      ];
      const bad = table.filter((r) => { const p = L.paramsFor(r.lv); return !(p && p.colors === r.colors && p.empties === r.empties && p.hidden === r.hidden && p.order === r.order); })
        .map((r) => ({ want: r, got: L.paramsFor(r.lv) }));
      check('paramsFor が表どおり（1・2・5・6・9・10・12・14・15・24・25・39・40・1000 の境界を含む）', bad.length === 0, bad);
      const broken = [0, -3, 1.5, NaN, Infinity, null, undefined, {}, [], 1e400];
      const bBad = broken.filter((v) => { let p; try { p = L.paramsFor(v); } catch { return true; } return !(p && p.colors === 2 && p.empties === 2 && p.hidden === false && p.order === 'easy'); })
        .map((v) => String(v));
      check('壊れた面番号（0・負・小数・NaN・Infinity・null・undefined・object）は 1 面扱いで例外なし', bBad.length === 0, bBad);
      const mono = []; let prev = 0;
      for (let lv = 1; lv <= 60; lv++) { const p = L.paramsFor(lv); if (p.colors < prev) mono.push(lv); prev = p.colors; if (p.colors < 2 || p.colors > L.MAX_COLORS) mono.push('range' + lv); }
      check('色の数は面が進んでも減らず、2〜MAX_COLORS の範囲（少しずつ難しくなる）', mono.length === 0, mono);
      check('colorName：範囲外は「？」、0 は COLORS[0].name', L.colorName(-1) === '？' && L.colorName(99) === '？' && L.colorName(0) === C[0].name && L.colorName(NaN) === '？', [L.colorName(-1), L.colorName(0)]);
    },
  },
  {
    id: 'BL2', tier: 'smoke', node: true, title: 'いろびん：pourCheck・applyMove の決まり（空へ・同じ色へ・色違い・いっぱい・栓・同じ瓶・範囲外・クリア後、reason の順、注ぐ量）',
    run({ check, root }) {
      const L = load(root);
      // 0:[0,1] 1:[1] 2:[2,2,2] 3:[] 4:封 5:[2,2,2,2](栓なし) 6:[3,1,1] 7:[1,1] 8:[1,1,1]
      const S = mk([[0, 1], [1], [2, 2, 2], [], { c: [4, 4, 4, 4], sealed: true }, [2, 2, 2, 2], [3, 1, 1], [1, 1], [1, 1, 1]], { slots: [5, 6], queue: [] });
      const R = (f, t) => L.pourCheck(S, f, t);
      const ok = (f, t, n) => { const r = R(f, t); return r && r.ok === true && r.count === n; };
      const ng = (f, t, why) => { const r = R(f, t); return r && r.ok === false && r.reason === why; };
      check('空の瓶へ注げる（count 1）、同じ色の上へ注げる（count 1）', ok(0, 3, 1) && ok(0, 1, 1), [R(0, 3), R(0, 1)]);
      check('色違いは mismatch（空きがあっても）', ng(0, 2, 'mismatch') && ng(2, 1, 'mismatch'), [R(0, 2), R(2, 1)]);
      check('相手がいっぱいは full（色が違っていても full が先）', ng(0, 5, 'full') && ng(1, 5, 'full'), [R(0, 5), R(1, 5)]);
      check('元が空は empty、元か相手が栓をしていれば sealed', ng(3, 0, 'empty') && ng(4, 0, 'sealed') && ng(0, 4, 'sealed'), [R(3, 0), R(4, 0), R(0, 4)]);
      check('同じ瓶は same、範囲外・整数でないは range', ng(0, 0, 'same') && ng(0, 99, 'range') && ng(-1, 0, 'range') && ng(1.5, 0, 'range') && ng('0', 1, 'range') && ng(0, NaN, 'range') && ng(null, 0, 'range'),
        [R(0, 0), R(0, 99), R(-1, 0), R(1.5, 0), R('0', 1)]);
      check('判定の順：range → same → empty → sealed → full → mismatch（空の元＋栓の相手は sealed でなく empty、栓の元＋いっぱいの相手は sealed）',
        ng(3, 4, 'empty') && ng(4, 5, 'sealed') && ng(4, 4, 'same') && ng(3, 3, 'same'), [R(3, 4), R(4, 5), R(4, 4)]);
      // 注ぐ量：元の一番上の同じ色の続きと、相手の空きの小さい方
      check('まとめて注ぐ：続き 2・空き 2 → 2（[3,1,1] → [1,1]）', ok(6, 7, 2), R(6, 7));
      check('空きで丸める：続き 2・空き 1 → 1（[3,1,1] → [1,1,1]）', ok(6, 8, 1), R(6, 8));
      check('続きの方が少ない：続き 3・空き 3 以上でも 3 を超えない（[1,1,1] → 空）', ok(8, 3, 3), R(8, 3));
      const r2 = L.applyMove(S, 6, 7);
      check('applyMove(6,7)：6 は [3]、7 は [1,1,1,1] で栓、outcome は pour・count 2・color 1・sealed 7・moves+1',
        r2.outcome.kind === 'pour' && r2.outcome.count === 2 && r2.outcome.color === 1 && r2.outcome.sealed === 7 && r2.outcome.from === 6 && r2.outcome.to === 7
        && J(r2.state.bottles[6].cells) === '[3]' && J(r2.state.bottles[7].cells) === '[1,1,1,1]' && r2.state.bottles[7].sealed === true && r2.state.moves === S.moves + 1, r2.outcome);
      const r3 = L.applyMove(S, 6, 8);
      check('空きで丸めた注ぎ（count 1）：6 は [3,1]、8 は [1,1,1,1]（6 の続きは残る）', r3.outcome.count === 1 && J(r3.state.bottles[6].cells) === '[3,1]' && J(r3.state.bottles[8].cells) === '[1,1,1,1]', r3.state.bottles.slice(6));
      // 注げない手
      const inv = L.applyMove(S, 0, 2);
      check('注げない手：outcome は { kind:"invalid", reason:"mismatch", from, to }、state は変わらない（JSON が同じ）', inv.outcome.kind === 'invalid' && inv.outcome.reason === 'mismatch' && inv.outcome.from === 0 && inv.outcome.to === 2 && J(inv.state) === J(S), inv.outcome);
      check('invalid では moves も増えない', inv.state.moves === S.moves, inv.state.moves);
      // クリア後
      const W = mk([[], [], { c: [0, 0, 0, 0] }], { slots: [null, null], queue: [], served: 1, total: 1, won: true });
      const w = L.pourCheck(W, 2, 0);
      check('クリア後（won）はどの手も reason "won"', w && w.ok === false && w.reason === 'won' && L.applyMove(W, 2, 0).outcome.reason === 'won', w);
      // legalMoves
      const G = mk([[0, 1], [1], [], { c: [2, 2, 2, 2], sealed: true }], { slots: [3, null], queue: [] });
      check('legalMoves：from の小さい順、同じ from は to の小さい順（栓の瓶は含まない）', J(L.legalMoves(G)) === '[[0,1],[0,2],[1,0],[1,2]]', L.legalMoves(G));
    },
  },
  {
    id: 'BL3', tier: 'smoke', node: true, title: 'いろびん：そろう・届ける・届けた瓶は消える（瓶が1本減り、空き瓶は増えない。残りは並び順のまま詰める・id は変わらない）・待ち瓶・お客さんが来たら自動で届く（連鎖の順）・全部届けて won',
    run({ check, root }) {
      const L = load(root);
      // 色 0・1・2。お客さん [1,2]、列 [0]。b0:[0,0,0] b1:[0] b2:[1,1,1] b3:[1] b4:[2,2,2] b5:[2]
      let s = mk([[0, 0, 0], [0], [1, 1, 1], [1], [2, 2, 2], [2]], { slots: [1, 2], queue: [0] });
      check('始め：served 0・total 3・won でない', s.served === 0 && s.total === 3 && L.hud(s).left === 3, L.hud(s));
      // 1) 色 0 がそろうが、お客さんにいない → その場で待つ（場所をふさぐ）
      let r = L.applyMove(s, 1, 0);
      check('そろった（色 0）：sealed が 0、deliveries 空、arrivals 空（お客さんに色 0 がいない）', r.outcome.kind === 'pour' && r.outcome.sealed === 0 && r.outcome.deliveries.length === 0 && r.outcome.arrivals.length === 0, r.outcome);
      check('待ち瓶は栓をして場所に残る（瓶 0 が [0,0,0,0]・sealed）、瓶 1 は空', J(r.state.bottles[0].cells) === '[0,0,0,0]' && r.state.bottles[0].sealed === true && r.state.bottles[1].cells.length === 0 && r.state.served === 0 && r.state.bottles.length === 6, r.state.bottles);
      s = r.state;
      const wait = L.pourCheck(s, 0, 1);
      check('待っている栓の瓶は注ぐ元にならない（sealed）', wait.ok === false && wait.reason === 'sealed', wait);
      // 2) 色 1 がそろう → お客さん 0 に届く → 次のお客さん（色 0）が来る → 待ち瓶 0 が自動で届く（連鎖）→ 列が尽きる
      r = L.applyMove(s, 3, 2);
      const o = r.outcome;
      check('色 1 がそろって sealed 2、deliveries は [瓶 2（id 2）→ 枠 0 の色 1, 瓶 0（id 0）→ 枠 0 の色 0] の順（連鎖。bottle は注ぐ前の並びの位置）',
        o.sealed === 2 && J(o.deliveries) === J([{ bottle: 2, id: 2, slot: 0, color: 1 }, { bottle: 0, id: 0, slot: 0, color: 0 }]), o.deliveries);
      check('arrivals は届けるたびに 1 件（枠 0 に色 0、次に列が尽きて color null）、起きた順', J(o.arrivals) === J([{ slot: 0, color: 0 }, { slot: 0, color: null }]), o.arrivals);
      const emptiesBefore = s.bottles.filter((b) => b.cells.length === 0).length;   // 注ぐ前の空き瓶（瓶 1 の 1 本）
      s = r.state;
      check('届けた 2 本は消える：瓶は 6 → 4 本、残りは並び順のまま詰まり id は [1,3,4,5]（変わらない）', s.bottles.length === 4 && J(s.bottles.map((b) => b.id)) === '[1,3,4,5]' && J(colorsOf(s)) === J(['', '', '222', '2']), s.bottles);
      check(`空き瓶は増えない（注ぐ前 ${emptiesBefore} 本 → 注いで空いた瓶 3 を足して 2 本。届けた分の空き瓶は出てこない）`, s.bottles.filter((b) => b.cells.length === 0).length === emptiesBefore + 1 && !s.bottles.some((b) => b.sealed), s.bottles);
      check('served 2・slots [null,2]・queue []・まだ won でない', s.served === 2 && J(s.slots) === '[null,2]' && s.queue.length === 0 && s.won === false && o.won === false, { served: s.served, slots: s.slots });
      check('hud：left は total − served（1）', J(L.hud(s)) === J({ level: 1, served: 2, total: 3, left: 1, moves: s.moves }), L.hud(s));
      // 3) 最後の色 2 → 全部届けて won（位置は詰めた後の並び：瓶 3（id 5）→ 瓶 2（id 4））
      r = L.applyMove(s, 3, 2);
      check('最後の色 2 で deliveries 1 件（位置 2・id 4）・arrivals は枠 1 に null・won・served 3', J(r.outcome.deliveries) === J([{ bottle: 2, id: 4, slot: 1, color: 2 }]) && J(r.outcome.arrivals) === J([{ slot: 1, color: null }]) && r.outcome.won === true && r.state.won === true && r.state.served === 3 && r.outcome.stuck === false, r.outcome);
      check('クリアの局面：瓶は 3 本（id 1・3・5）で全部空。outcome の from・to は注ぐ前の位置、fromId・toId は瓶の id', r.state.bottles.length === 3 && J(r.state.bottles.map((b) => b.id)) === '[1,3,5]' && r.state.bottles.every((b) => b.cells.length === 0) && r.outcome.from === 3 && r.outcome.to === 2 && r.outcome.fromId === 5 && r.outcome.toId === 4, { b: r.state.bottles, o: r.outcome });
      // 4) 見えているお客さんにいる色は、そろった瞬間に届く。届けた枠には queue の先頭が来る
      const t = mk([[1, 1, 1], [1], []], { slots: [1, 0], queue: [] });
      const r4 = L.applyMove(t, 1, 0);
      check('一致するお客さんがいれば、そろった瞬間に届く（待ち瓶ではない）。瓶は 3 → 2 本、空き瓶は 2 本のまま増えない',
        J(r4.outcome.deliveries) === J([{ bottle: 0, id: 0, slot: 0, color: 1 }]) && r4.state.bottles.length === 2 && J(r4.state.bottles.map((b) => b.id)) === '[1,2]' && r4.state.bottles.every((b) => b.cells.length === 0), r4.outcome);
      // 5) 同時に候補があるときは、枠は左から・瓶は番号の小さい方から
      let u = mk([{ c: [3, 3, 3, 3], sealed: true }, { c: [4, 4, 4, 4], sealed: true }, [5, 5, 5], [5], []], { slots: [5, 7], queue: [4, 3], total: 4 });
      // お客さんに 4,3 はまだいない（列の中）。5 が届くと枠 0 に 4 が来て、瓶 1 が自動で届く → 枠 0 に 3 が来て瓶 0 が届く
      u = { ...u, slots: [5, 7] };
      const r5 = L.applyMove(u, 3, 2);
      check('連鎖は「届ける → 来る → 合う待ち瓶を届ける」を繰り返す（色 4 の瓶 1 → 色 3 の瓶 0 の順。位置は連鎖の途中でもずれない）', J(r5.outcome.deliveries.map((d) => [d.bottle, d.id, d.color])) === '[[2,2,5],[1,1,4],[0,0,3]]', r5.outcome.deliveries);
      check('連鎖で 3 本届けると瓶は 5 → 2 本（id 3・4 の空き瓶だけ）。空き瓶は 1 本 → 2 本（注いで空いた瓶 3 の分だけ）', r5.state.bottles.length === 2 && J(r5.state.bottles.map((b) => b.id)) === '[3,4]' && r5.state.bottles.every((b) => b.cells.length === 0), r5.state.bottles);
    },
  },
  {
    id: 'BL4', tier: 'smoke', node: true, title: 'いろびん：イミュータブル（applyMove の前後で元の state が同じ）・おかしな引数でも例外を投げない',
    run({ check, root }) {
      const L = load(root);
      const base = mk([[0, 0, 0], [0], [1, 1, 1], [1], []], { slots: [1, 0], queue: [] });
      const snap = J(base);
      const moves = [[1, 0], [3, 2], [0, 4], [0, 0], [9, 1]];
      for (const [f, t] of moves) L.applyMove(base, f, t);
      check('applyMove を何度か呼んでも元の state が JSON で同じ', J(base) === snap, null);
      const fr = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(fr); } return o; };
      const frozen = fr(JSON.parse(snap));
      let threw = null;
      try { for (const [f, t] of moves) L.applyMove(frozen, f, t); L.legalMoves(frozen); L.isStuck(frozen); L.hud(frozen); L.pourCheck(frozen, 0, 1); } catch (e) { threw = String(e); }
      check('凍結した state を渡しても例外にならない（元を書き換えていない）', threw === null, threw);
      const r = L.applyMove(base, 1, 0);
      check('返る state は新しいオブジェクトで、瓶の配列も別物', r.state !== base && r.state.bottles !== base.bottles && r.state.bottles[0] !== base.bottles[0], null);
      // おかしな引数
      const lv = L.createLevel(3).state;
      const evil = [null, undefined, 0, '', 'x', [], {}, { bottles: 5 }, { bottles: [null] }, { bottles: [{}] }, NaN];
      const fails = [];
      const t = (name, fn) => { try { fn(); } catch (e) { fails.push(name + ': ' + e); } };
      for (const e of evil) {
        t('pourCheck ' + J(e), () => L.pourCheck(e, 0, 1));
        t('applyMove ' + J(e), () => { const x = L.applyMove(e, 0, 1); if (x && x.outcome && x.outcome.kind !== 'invalid') throw new Error('invalid でない'); });
        t('legalMoves ' + J(e), () => L.legalMoves(e));
        t('isStuck ' + J(e), () => L.isStuck(e));
        t('hud ' + J(e), () => L.hud(e));
        t('solve ' + J(e), () => L.solve(e));
        t('validateSave ' + J(e), () => { if (L.validateSave(e) !== null) throw new Error('null でない'); });
        t('validateBest ' + J(e), () => { if (L.validateBest(e) !== 0) throw new Error('0 でない'); });
        t('replay ' + J(e), () => L.replay(e, e));
        t('recordBest ' + J(e), () => L.recordBest(e, e));
        t('animalFor ' + J(e), () => L.animalFor(e, e));
        t('createLevel ' + J(e), () => L.createLevel(e));
      }
      for (const [f, to] of [['a', 'b'], [{}, []], [Infinity, -Infinity], [0.5, 1], [-0, 1], [1e9, 0]]) {
        t('pourCheck ' + J([f, to]), () => L.pourCheck(lv, f, to));
        t('applyMove ' + J([f, to]), () => { const x = L.applyMove(lv, f, to); if (x.outcome.kind === 'pour' && !(Number.isInteger(f) && f >= 0)) throw new Error('注げてしまった'); });
      }
      check('null・文字列・形が壊れた state・おかしな番号のどれを渡しても例外なし（applyMove は invalid、validate 系は 0 か null）', fails.length === 0, fails.slice(0, 8));
    },
  },
  {
    id: 'BL5', tier: 'smoke', node: true, title: 'いろびん：生成（1〜60 面と 1000 面が決定的・各色ちょうど4段・最初からそろった瓶なし・隠れの形・solution が解ける・合計3秒以内）',
    run({ check, root }) {
      const L = load(root);
      const levels = [...Array.from({ length: 60 }, (_, i) => i + 1), 1000];
      // 重さは CPU 時間で見る（並列のテストで CPU が混んでも、待たされた時間を数えない。T-21・T-20 と同じ）
      const c0 = cpuOf(), t0 = Date.now();
      const first = levels.map((lv) => L.createLevel(lv));
      const cu = cpuOf(c0), ms = Math.round((cu.user + cu.system) / 1000), wall = Date.now() - t0;
      const bad = [];
      const fb = { 0: 0, 1: 0, 2: 0 };
      for (let i = 0; i < levels.length; i++) {
        const lv = levels[i], { state: s, info } = first[i], again = L.createLevel(lv);
        if (J(again) !== J(first[i])) bad.push(`${lv}: 同じ面なのに結果が違う（決定的でない）`);
        if (!s || !info) { bad.push(`${lv}: state/info が無い`); continue; }
        fb[info.fallback] = (fb[info.fallback] || 0) + 1;
        const p = L.paramsFor(lv);
        if (info.level !== lv || s.level !== lv) bad.push(`${lv}: level が違う`);
        const cnt = {};
        for (const b of s.bottles) { if (b.cells.length > L.CAP || b.hidden.length !== b.cells.length) bad.push(`${lv}: 瓶の形`); for (const c of b.cells) cnt[c] = (cnt[c] || 0) + 1; }
        const kinds = Object.keys(cnt);
        if (!kinds.every((k) => cnt[k] === 4)) bad.push(`${lv}: 色が4段ずつでない ${J(cnt)}`);
        if (info.fallback < 2 && kinds.length !== p.colors) bad.push(`${lv}: 色の数 ${kinds.length}≠${p.colors}`);
        // 布の瓶（§17）：空き瓶の布は「布をかぶった空き瓶」を1本足す（瓶が1本増える）。中身ありの布は色の瓶にかぶせる（本数は同じ）
        const cl = Array.isArray(info.cloths) ? info.cloths : null;
        const covered = s.bottles.filter((b) => b.cover !== null && b.cover !== undefined);
        const emptyCloth = cl ? cl.filter((c) => c.empty).length : 0;
        if (!cl) bad.push(`${lv}: info.cloths が無い`);
        else if (J(cl.map((c) => [c.id, c.cover, c.empty])) !== J(covered.map((b) => [b.id, b.cover, b.cells.length === 0]))) bad.push(`${lv}: info.cloths が state の布の瓶と合わない`);
        if (info.fallback === 0 && covered.length !== (p.cloths || 0)) bad.push(`${lv}: 布の瓶 ${covered.length} 本≠表の ${p.cloths}`);
        if (covered.some((b) => !(Number.isInteger(b.cover) && b.cover >= 1 && b.cover < s.total))) bad.push(`${lv}: cover が 1〜total-1 でない`);
        if (s.bottles.some((b) => !covered.includes(b) && b.cover !== null)) bad.push(`${lv}: 布の無い瓶の cover が null でない`);
        if (info.fallback === 0 && s.bottles.length !== p.colors + p.empties + emptyCloth) bad.push(`${lv}: 瓶の本数 ${s.bottles.length}（色 ${p.colors}＋空き ${p.empties}＋空き瓶の布 ${emptyCloth}）`);
        if (s.bottles.some((b) => b.cells.length === 4 && new Set(b.cells).size === 1)) bad.push(`${lv}: 最初からそろった瓶がある`);
        if (s.bottles.some((b) => b.sealed)) bad.push(`${lv}: 最初から栓をした瓶がある`);
        if (s.bottles.some((b) => b.cells.length && b.hidden[b.cells.length - 1])) bad.push(`${lv}: 一番上が隠れている`);
        if (info.fallback === 0 && p.hidden && !s.bottles.every((b) => b.hidden.every((h, k) => h === (k < b.cells.length - 1)))) bad.push(`${lv}: 隠れの面で一番上以外が隠れていない`);
        if (!p.hidden && info.fallback < 2 && s.bottles.some((b) => b.hidden.some(Boolean))) bad.push(`${lv}: 隠れの面でないのに隠れがある`);
        if (s.total !== kinds.length || s.served !== 0 || s.moves !== 0 || s.won !== false || s.slots.length !== L.ORDER_SLOTS) bad.push(`${lv}: 始めの値`);
        const orders = [...s.slots.filter((x) => x !== null), ...s.queue];
        if (orders.length !== kinds.length || new Set(orders).size !== kinds.length || !orders.every((c) => cnt[c] === 4)) bad.push(`${lv}: 注文が各色1つずつでない ${J(orders)}`);
        if (!s.bottles.every((b, k) => b.id === k)) bad.push(`${lv}: 最初の瓶の id が並び順（0〜）でない`);
        if (!Array.isArray(info.solutionIds) || info.solutionIds.length !== (info.solution || []).length) bad.push(`${lv}: solutionIds が solution と同じ長さでない`);
        const rp = L.replay(lv, info.solutionIds);
        if (!(rp.ok && rp.state.won)) bad.push(`${lv}: solutionIds を replay しても won にならない（ok ${rp.ok}、applied ${rp.applied}/${(info.solutionIds || []).length}）`);
        else if (info.fallback === 0 && !(rp.state.bottles.length === p.empties + emptyCloth && rp.state.bottles.every((b) => b.cells.length === 0 && b.cover === null))) bad.push(`${lv}: クリアの局面が「空き瓶 ${p.empties + emptyCloth} 本だけ（布はすべて取れている）」でない（${rp.state.bottles.length} 本）`);
        if (!(info.nodes <= L.GEN_NODE_BUDGET * 1.5)) bad.push(`${lv}: nodes ${info.nodes}`);
      }
      check(`${levels.length} 面（1〜60・1000）：決定的・各色4段・最初からそろった瓶なし・隠れの形・注文が各色1つ・id が 0〜・solutionIds を replay すると won、残るのは空き瓶だけ（届けた瓶は全部消える。空き瓶の布の面は 1 本多い）・布の瓶の数と cover が info.cloths と合う`, bad.length === 0, bad.slice(0, 8));
      check(`1〜60 面と 1000 面の生成が CPU 時間で合計 3 秒以内（CPU ${ms}ms・壁の時計 ${wall}ms。目安 iPhone SE 相当で 1 面 300ms 以内）`, ms <= 3000, [ms, wall]);
      check(`表のとおりに作れた面（fallback 0）が 8 割以上（0:${fb[0]} 1:${fb[1]} 2:${fb[2]}）`, fb[0] >= levels.length * 0.8, fb);
      const l1 = first[0].state;
      check('1 面は瓶 4 本（色 2＋空き 2。最初の手で解けなくならない）・隠れなし（遊び方を覚える面）', l1.bottles.length === 4 && !l1.bottles.some((b) => b.hidden.some(Boolean)), l1.bottles.length);
      const s1 = first[0].state, trap = L.legalMoves(s1).filter(([f, t]) => !L.solve(L.applyMove(s1, f, t).state).solved);
      check(`1 面は、どの最初の手を選んでもまだ解ける（解けなくなる最初の手 ${trap.length} 個）`, trap.length === 0, trap);
      const diff = new Set(first.slice(0, 20).map((x) => J(x.state.bottles))).size;
      check('面が違えば問題も違う（1〜20 面で同じ配りが重ならない）', diff === 20, diff);
      const eq = first.slice(0, 5).every((x, i) => x.info.seed === L.seedFor(i + 1) && Number.isInteger(x.info.seed));
      check('info.seed は seedFor(level)', eq, first.slice(0, 5).map((x) => x.info.seed));
      const rng = L.makeRng(123), rng2 = L.makeRng(123);
      const a = Array.from({ length: 50 }, rng), b2 = Array.from({ length: 50 }, rng2);
      check('makeRng：同じ種なら同じ列、0 以上 1 未満', J(a) === J(b2) && a.every((x) => x >= 0 && x < 1) && new Set(a).size > 40, a.slice(0, 3));
    },
  },
  {
    id: 'BL6', tier: 'smoke', node: true, title: 'いろびん：ソルバー（解けない盤は solved:false・待ち瓶がある盤の手順の位置がずれない・布の無い面では注文の順で解けるかどうかは変わらない・上限で exhausted）',
    run({ check, root }) {
      const L = load(root);
      // 解けない：空きがなく、どの一番上も合わない
      const dead = mk([[0, 1, 0, 1], [1, 0, 1, 0]], { slots: [0, 1], queue: [], total: 2, params: { colors: 2, empties: 0, hidden: false, order: 'random' } });
      const d = L.solve(dead);
      check('動かせる手が無い盤は solved:false・exhausted:false・moves null', d.solved === false && d.exhausted === false && d.moves === null, d);
      // 待ち瓶：色 2 が先にそろうが、お客さんは列の最後。待っている間は瓶がその場に残る（位置が詰まらない）。
      // ソルバーの手順を applyMove で再生して won になる＝待ち瓶を「もう届けた」と思って位置を数え間違えていない
      const waitB = mk([[2, 2, 2], [2], [0, 1], [1, 0], [0, 1], [1, 0], [], []], { slots: [0, 1], queue: [2] });
      const o = L.solve(waitB);
      let wst = waitB, wok = o.solved, waited = false;
      if (o.solved) for (const [f, t] of o.moves) { const r = L.applyMove(wst, f, t); if (r.outcome.kind !== 'pour') { wok = false; break; } if (r.outcome.sealed !== null && !r.outcome.deliveries.length) waited = true; wst = r.state; }
      check('待ち瓶ができる盤：solve の手順を applyMove で順に当てると、途中で待ち瓶ができ、最後は won（手の位置がずれない）', o.solved === true && wok && waited && wst.won === true, { o, waited, won: wst.won });
      // 届けても空き瓶は増えないので、注文の順は「解けるかどうか」を変えない（待ち瓶は注ぐ元にも相手にもならない）。
      // 布の瓶がある面は注文の順が効く（契約 §17.9）ので、布の無い面（6・7・27 面）で確かめる
      const pairs = [];
      for (const lv of [6, 7, 27]) {
        const st = L.createLevel(lv).state;
        const q = [...st.slots, ...st.queue].reverse();
        const rev = { ...JSON.parse(J(st)), slots: q.slice(0, 2), queue: q.slice(2) };
        const a1 = L.solve(st), a2 = L.solve(rev), a3 = L.solve(st, { anyOrder: true });
        pairs.push({ lv, a: a1.solved, rev: a2.solved, any: a3.solved, cloth: st.bottles.some((b) => b.cover !== null) });
      }
      check('布の無い面では、注文の順を逆にしても、anyOrder でも、解けるかどうかは同じ（生成した 6・7・27 面）', pairs.every((x) => x.a === true && x.rev === true && x.any === true && !x.cloth), pairs);
      // 解ける盤：moves を applyMove で再生すると won
      const easy = mk([[0, 1, 0], [1, 0, 1], [1, 0], []], { slots: [0, 1], queue: [], total: 2 });
      const e = L.solve(easy);
      let st = easy, okAll = e.solved;
      if (e.solved) for (const [f, t] of e.moves) { const r = L.applyMove(st, f, t); if (r.outcome.kind !== 'pour') { okAll = false; break; } st = r.state; }
      check('解ける盤：solve の手順を applyMove で順に当てると won（手が全部注げる）', e.solved === true && okAll && st.won === true, { e, won: st.won });
      // 生成した面
      const bad = [];
      for (const lv of [1, 4, 9, 12, 20, 33]) {
        const s = L.createLevel(lv).state, r = L.solve(s);
        let cur = s, ok = r.solved;
        if (r.solved) for (const [f, t] of r.moves) { const x = L.applyMove(cur, f, t); if (x.outcome.kind !== 'pour') { ok = false; break; } cur = x.state; }
        if (!(r.solved && ok && cur.won)) bad.push({ lv, solved: r.solved, ok, nodes: r.nodes });
      }
      check('createLevel の面（1・4・9・12・20・33）は solve で解け、手順を再生すると won', bad.length === 0, bad);
      // 上限
      const big = L.createLevel(30).state;
      const lim = L.solve(big, { nodeLimit: 1 });
      check('nodeLimit を小さくすると打ち切り：solved:false・exhausted:true（「解けない」と言い切らない）', lim.solved === false && lim.exhausted === true && lim.nodes <= 2, lim);
      const n = L.solve(big);
      check('既定の上限で解け、調べた局面の数が SOLVE_NODE_LIMIT 以下', n.solved === true && n.nodes <= L.SOLVE_NODE_LIMIT, { solved: n.solved, nodes: n.nodes });
    },
  },
  {
    id: 'BL7', tier: 'smoke', node: true, title: 'いろびん：保存の検証（validateBest・validateSave・makeSave・recordBest・validateFlag・replay が注げない手で止まる）',
    run({ check, root }) {
      const L = load(root);
      const bb = ['', 'abc', '-1', '1.5', 'NaN', 'Infinity', '-Infinity', '{}', '[]', '1e400', '9007199254740992', 'null', null, undefined, {}, [], NaN, -1, 1.5, Infinity, true]
        .filter((v) => L.validateBest(v) !== 0 && !(v === true));
      check('validateBest：壊れた値（""・abc・負・小数・NaN・Infinity・{}・1e400・2^53・null・object）はすべて 0', bb.length === 0, bb.map(String));
      check('validateBest：正しい値はそのまま（"0"→0、"3"→3、7→7、"9007199254740991"）', L.validateBest('0') === 0 && L.validateBest('3') === 3 && L.validateBest(7) === 7 && L.validateBest('9007199254740991') === 9007199254740991, null);
      const good = L.makeSave(5, [[0, 1], [2, 3]]);
      check('makeSave は JSON 文字列 { v:3, level, moves }（手は瓶の id。布の瓶のルール）', typeof good === 'string' && J(JSON.parse(good)) === J({ v: 3, level: 5, moves: [[0, 1], [2, 3]] }), good);
      check('validateSave：makeSave した文字列は { level, moves } に戻る', J(L.validateSave(good)) === J({ level: 5, moves: [[0, 1], [2, 3]] }), L.validateSave(good));
      const sv = (x) => L.validateSave(typeof x === 'string' ? x : J(x));
      const bad = [
        ['壊れた JSON', '{not json'], ['空文字', ''], ['null', null], ['配列', '[]'], ['v が無い', { level: 1, moves: [] }], ['v が 4', { v: 4, level: 1, moves: [] }], ['v が 0', { v: 0, level: 1, moves: [] }], ['v が文字', { v: '3', level: 1, moves: [] }],
        ['level 0', { v: 3, level: 0, moves: [] }], ['level 負', { v: 3, level: -1, moves: [] }], ['level 小数', { v: 3, level: 1.5, moves: [] }], ['level 文字', { v: 3, level: '3', moves: [] }],
        ['level 2^53', { v: 3, level: 9007199254740992, moves: [] }], ['moves が無い', { v: 3, level: 1 }], ['moves が配列でない', { v: 3, level: 1, moves: 'x' }],
        ['手が1要素', { v: 3, level: 1, moves: [[0]] }], ['手が3要素', { v: 3, level: 1, moves: [[0, 1, 2]] }], ['手が小数', { v: 3, level: 1, moves: [[0, 1.5]] }], ['手が文字', { v: 3, level: 1, moves: [['0', '1']] }], ['手が null', { v: 3, level: 1, moves: [null] }], ['手が数', { v: 3, level: 1, moves: [3] }],
        ['長すぎ', { v: 3, level: 1, moves: Array.from({ length: L.MAX_MOVES_SAVED + 1 }, () => [0, 1]) }],
        ['v:1 で level 0', { v: 1, level: 0, moves: [] }], ['v:1 で level 文字', { v: 1, level: '3', moves: [] }], ['v:2 で level 0', { v: 2, level: 0, moves: [] }], ['v:2 で level 小数', { v: 2, level: 2.5, moves: [] }],
      ].filter(([, x]) => sv(x) !== null).map(([n]) => n);
      check('validateSave：壊れた JSON・v 違い・level 0/負/小数/文字・moves が配列でない/手の形違い/長すぎ はすべて null', bad.length === 0, bad);
      check('validateSave：手が MAX_MOVES_SAVED ちょうどは通る、空の手でも通る', sv({ v: 3, level: 1, moves: Array.from({ length: L.MAX_MOVES_SAVED }, () => [0, 1]) }) !== null && sv({ v: 3, level: 12, moves: [] }) !== null, null);
      const old = sv({ v: 1, level: 7, moves: [[0, 1], [2, 3]] });
      check('古い保存 v:1（届けると空き瓶が出てきた前のルールの手）は手を捨てて、その面の最初から（{ level: 7, moves: [] }）', J(old) === J({ level: 7, moves: [] }), old);
      const old2 = sv({ v: 2, level: 9, moves: [[0, 1], [2, 3]] });
      check('古い保存 v:2（布の前のルールの手）も手を捨てて、その面の最初から（{ level: 9, moves: [] }）', J(old2) === J({ level: 9, moves: [] }), old2);
      // replay（手は瓶の id）
      const r0 = L.replay(2, []);
      check('replay：手が無ければ createLevel と同じ局面、ok:true・applied 0', r0.ok === true && r0.applied === 0 && J(r0.state) === J(L.createLevel(2).state), r0.applied);
      const sol = L.createLevel(3).info.solutionIds;
      const rAll = L.replay(3, sol);
      check('replay：solutionIds（瓶の id の手）を全部当てると ok:true・applied が手の数・won', rAll.ok === true && rAll.applied === sol.length && rAll.state.won === true, { ok: rAll.ok, applied: rAll.applied, n: sol.length });
      const rBad = L.replay(3, [sol[0], [0, 0], sol[1]]);
      check('replay：注げない手（同じ瓶）で止まり ok:false・applied 1（そこまでの状態を返す）', rBad.ok === false && rBad.applied === 1 && rBad.state && rBad.state.moves === 1, { ok: rBad.ok, applied: rBad.applied });
      const rOver = L.replay(3, [[0, 99]]);
      check('replay：無い id でも例外なし・ok:false・applied 0', rOver.ok === false && rOver.applied === 0, rOver);
      // recordBest
      const rb = (p, c) => L.recordBest(p, c);
      check('recordBest：新しい面は improved:true、同じ面・小さい面は improved:false（best は下がらない）',
        J(rb('3', 5)) === J({ best: 5, improved: true }) && J(rb('5', 5)) === J({ best: 5, improved: false }) && J(rb('5', 2)) === J({ best: 5, improved: false }) && J(rb(null, 1)) === J({ best: 1, improved: true }), [rb('3', 5), rb('5', 5), rb('5', 2), rb(null, 1)]);
      check('recordBest：壊れた前の値は 0 扱い（"abc" から 1 面クリアは best 1・improved:true）', J(rb('abc', 1)) === J({ best: 1, improved: true }) && J(rb('-4', 2)) === J({ best: 2, improved: true }), [rb('abc', 1), rb('-4', 2)]);
      check('validateFlag："1" のときだけ true', L.validateFlag('1') === true && ['', '0', 'true', null, undefined, 1, 'yes'].every((v) => L.validateFlag(v) === false), null);
    },
  },
  {
    id: 'BL8', tier: 'smoke', node: true, title: 'いろびん：詰み（isStuck・legalMoves が空・outcome.stuck）。クリアは詰みでない',
    run({ check, root }) {
      const L = load(root);
      const deadEnd = mk([[0, 1], [1, 0]], { slots: [0, 1], queue: [], total: 2 });
      check('動かせる手が無く won でない盤は isStuck:true・legalMoves 空', L.isStuck(deadEnd) === true && L.legalMoves(deadEnd).length === 0, L.legalMoves(deadEnd));
      const open = mk([[0, 1], [1], []], { slots: [0, 1], queue: [], total: 2 });
      check('動かせる手がある盤は isStuck:false', L.isStuck(open) === false && L.legalMoves(open).length > 0, L.legalMoves(open));
      const won = mk([[], [], { c: [0, 0, 0, 0] }], { slots: [null, null], queue: [], served: 1, total: 1, won: true });
      check('クリア後（手が無くても）は isStuck:false', L.isStuck(won) === false, null);
      // 注いだ結果、詰む
      const pre = mk([[0, 1], [0, 1], [2]], { slots: [0, 1], queue: [2], total: 3 });
      const r = L.applyMove(pre, 0, 1);
      check('注いだ後に手が無くなると outcome.stuck:true（won:false）、isStuck(state) も true', r.outcome.kind === 'pour' && r.outcome.stuck === true && r.outcome.won === false && L.isStuck(r.state) === true, r.outcome);
      const r2 = L.applyMove(open, 0, 2);
      check('手が残っていれば outcome.stuck:false', r2.outcome.kind === 'pour' && r2.outcome.stuck === false, r2.outcome);
      // 待ち瓶が全部ふさいで動けない
      const blockedAll = mk([{ c: [3, 3, 3, 3], sealed: true }, { c: [4, 4, 4, 4], sealed: true }], { slots: [0, 1], queue: [], total: 4, served: 2 });
      check('栓をした待ち瓶だけが残る盤も詰み（動かせる瓶が無い）', L.isStuck(blockedAll) === true, null);
    },
  },
  {
    id: 'BL9', tier: 'smoke', node: true, title: 'いろびん：隠れた色（注いで一番上になった1段だけが見える・隠れた段は注ぐ量に数えない・そろうと全部見える）',
    run({ check, root }) {
      const L = load(root);
      // 0:[1,2,2] 下2段が隠れ（上の2は見えている）, 1:[2]
      const s = mk([{ c: [1, 2, 2], h: [true, true, false] }, [2], []], { slots: [2, 1], queue: [0], total: 3 });
      const pc = L.pourCheck(s, 0, 1);
      check('隠れの下に同じ色が続いていても動かない：count は 1（見えている段だけ）', pc.ok === true && pc.count === 1, pc);
      const r = L.applyMove(s, 0, 1);
      const b0 = r.state.bottles[0];
      check('注いだ後、新しく一番上になった1段だけが見える（hidden [true,false]）・色はそのまま [1,2]', J(b0.cells) === '[1,2]' && J(b0.hidden) === '[true,false]', b0);
      check('outcome.revealed に新しく見えた段（瓶 0 の index 1・色 2）だけが入る', J(r.outcome.revealed) === J([{ bottle: 0, index: 1, color: 2 }]), r.outcome.revealed);
      const r2 = L.applyMove(r.state, 0, 1);
      check('見えるようになった段は、次の手で注げる（count 1）。その下の隠れは 1 のまま動かない', r2.outcome.kind === 'pour' && r2.outcome.count === 1 && J(r2.state.bottles[0].cells) === '[1]' && J(r2.state.bottles[0].hidden) === '[false]', r2.outcome);
      // 空の相手には、見えている同じ色の続きをまとめて注げる
      const s2 = mk([{ c: [1, 2, 2], h: [true, false, false] }, []], { slots: [2, null], queue: [], total: 2 });
      const p2 = L.pourCheck(s2, 0, 1);
      check('見えている同じ色の続きはまとめて注ぐ（count 2）', p2.ok === true && p2.count === 2, p2);
      // そろうと全部見える
      const s3 = mk([{ c: [5, 5, 3], h: [true, true, false] }, { c: [3, 3, 3], h: [true, true, false] }, []], { slots: [7, 8], queue: [], total: 2 });
      const r3 = L.applyMove(s3, 0, 1);
      const sealedBottle = r3.state.bottles[1];
      check('そろった瞬間、その瓶の隠れが全部見える（hidden がすべて false・sealed）', r3.outcome.sealed === 1 && sealedBottle.sealed === true && sealedBottle.hidden.every((h) => h === false) && J(sealedBottle.cells) === '[3,3,3,3]', sealedBottle);
      const rv = r3.outcome.revealed.map((x) => `${x.bottle}:${x.index}:${x.color}`).sort();
      check('revealed には、元の瓶の新しい一番上と、そろって見えた段（瓶 1 の index 0・1）も入る', rv.includes('0:1:5') && rv.includes('1:0:3') && rv.includes('1:1:3'), rv);
      // 生成した隠れの面：一番上以外が隠れ。DOM の答え漏れ対策として、hidden の段の色は state にはある（ロジックの正）
      const lv = L.createLevel(12).state;
      check('生成された隠れの面（12 面）：どの瓶も、一番上は見えていて、下は隠れている', lv.bottles.every((b) => b.cells.every((_, k) => b.hidden[k] === (k < b.cells.length - 1))), lv.bottles.slice(0, 2));
    },
  },
  {
    id: 'BL10', tier: 'smoke', node: true, title: 'いろびん：静的検査（効果音の名前が common/sfx.js の "irobin" の表にある・ファイルが事前キャッシュにある・メニューの名前が NAME と同じ）',
    run({ check, root }) {
      const dir = path.join(root, 'games/irobin');
      const files = ['index.html', 'logic.js', 'render.js', 'input.js', 'main.js'];
      const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
      check('games/irobin/ に index.html・logic.js・render.js・input.js・main.js がある', missing.length === 0, missing);
      // 効果音
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      const names = sandbox.YubiSfx?.create('irobin')?.names || [];
      const need = ['pick', 'drop', 'pour', 'reveal', 'seal', 'cork', 'deliver', 'arrive', 'clear', 'deny', 'undo', 'stuck', 'unveil', 'start', 'best', 'toggle'];
      check(`"irobin" の効果音の表に契約 §9・§17.5 の音名（unveil を含む）がすべてある（${names.length} 個）`, need.every((n) => names.includes(n)), need.filter((n) => !names.includes(n)));
      const used = new Set();
      for (const f of ['render.js', 'main.js', 'input.js', 'index.html']) {
        const p = path.join(dir, f); if (!fs.existsSync(p)) continue;
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bplay\(\s*(["'`])([A-Za-z]+)\1/g)) used.add(m[2]);
      }
      const unknown = [...used].filter((n) => !names.includes(n));
      check(`画面のコードが鳴らす音名 [${[...used].join(', ')}] がすべて表にある（無い名前は鳴らない）`, used.size > 0 && unknown.length === 0, { unknown, used: [...used] });
      const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
      const order = ['../../common/sfx.js', 'logic.js', 'render.js', 'input.js', 'main.js'].map((f) => html.indexOf(`src="${f}"`));
      check('index.html が sfx.js → logic.js → render.js → input.js → main.js の順に読む（契約 §2）', order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), order);
      const mainSrc = fs.existsSync(path.join(dir, 'main.js')) ? fs.readFileSync(path.join(dir, 'main.js'), 'utf8') : '';
      check('YubiSfx.create("irobin") でゲーム名を指定している', /YubiSfx\.create\(\s*["']irobin["']/.test(mainSrc + html), null);
      // 事前キャッシュ
      const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
      const appFiles = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const notCached = ['./games/irobin/', ...actual.map((f) => `./games/irobin/${f}`)].filter((f) => !appFiles.includes(f));
      check(`games/irobin/ のファイル ${actual.length} 個と ./games/irobin/ がすべて APP_FILES にある（足し忘れるとオフラインで開かない）`, actual.length >= 5 && notCached.length === 0, notCached);
      // メニュー
      const menu = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const L = load(root);
      const card = menu.match(/\{ name: "([^"]+)"[^}]*url: "games\/irobin\/"/);
      check(`メニューのカードの名前（${card && card[1]}）が IrobinLogic.NAME（${L.NAME}）と同じ`, !!card && card[1] === L.NAME, card && card[1]);
      check('メニューの ART に irobin の絵と irobinBest がある', /\n    irobin\(ctx, w, h\) \{/.test(menu) && /function irobinBest\(\)/.test(menu), null);
    },
  },
  {
    id: 'BL11', tier: 'smoke', node: true, title: 'いろびん：届けるたびに瓶が1本減り空き瓶は増えない（生成した面を通して）・瓶の id は詰めても変わらない・保存の手（id）を再生すると同じ局面・消えた瓶の id は注げない',
    run({ check, root }) {
      const L = load(root);
      const bad = [], idBad = [], saveBad = [];
      let deliveriesSeen = 0;
      for (const lv of [2, 6, 12, 20, 40]) {
        const { state: s0, info } = L.createLevel(lv);
        let st = s0;
        const ids = [];
        for (let k = 0; k < info.solution.length; k++) {
          const [f, t] = info.solution[k];
          const before = new Map(st.bottles.map((b) => [b.id, J(b.cells)]));
          const emptyBefore = st.bottles.filter((b) => b.cells.length === 0).length;
          const r = L.applyMove(st, f, t);
          if (r.outcome.kind !== 'pour') { bad.push(`${lv}: ${k} 手目が注げない`); break; }
          const o = r.outcome, ns = r.state;
          ids.push([o.fromId, o.toId]);
          const nd = o.deliveries.length;
          deliveriesSeen += nd;
          const emptyAfter = ns.bottles.filter((b) => b.cells.length === 0).length;
          // 空き瓶の増減は、注いだことによる分だけ（元が空になれば +1、空の瓶へ注げば −1）。届けた分の空き瓶は出てこない
          const delta = (st.bottles[f].cells.length === o.count ? 1 : 0) - (st.bottles[t].cells.length === 0 ? 1 : 0);
          if (ns.bottles.length !== st.bottles.length - nd) bad.push(`${lv}: ${k} 手目 届け ${nd} 本で瓶が ${st.bottles.length}→${ns.bottles.length}`);
          if (emptyAfter !== emptyBefore + delta) bad.push(`${lv}: ${k} 手目 空き瓶 ${emptyBefore}→${emptyAfter}（注いだ分の ${delta} だけ変わるはず）`);
          if (o.fromId !== st.bottles[f].id || o.toId !== st.bottles[t].id) idBad.push(`${lv}: ${k} 手目 fromId・toId が瓶の id と違う`);
          const goneIds = new Set(o.deliveries.map((d) => d.id));
          if (o.deliveries.some((d) => st.bottles[d.bottle].id !== d.id)) idBad.push(`${lv}: ${k} 手目 deliveries の bottle（注ぐ前の位置）と id が合わない`);
          if (ns.bottles.some((b) => goneIds.has(b.id))) idBad.push(`${lv}: ${k} 手目 届けた瓶の id が残っている`);
          if (new Set(ns.bottles.map((b) => b.id)).size !== ns.bottles.length) idBad.push(`${lv}: ${k} 手目 id が重なる`);
          const order = ns.bottles.map((b) => b.id), prevOrder = st.bottles.map((b) => b.id).filter((x) => !goneIds.has(x));
          if (J(order) !== J(prevOrder)) idBad.push(`${lv}: ${k} 手目 残りの並び順が変わった`);
          for (const b of ns.bottles) if (b.id !== o.fromId && b.id !== o.toId && before.get(b.id) !== J(b.cells)) idBad.push(`${lv}: ${k} 手目 さわっていない瓶 id ${b.id} の中身が変わった`);
          if (nd && goneIds.size) {
            const gid = [...goneIds][0], other = ns.bottles.find((b) => b.cells.length < 4 && !b.sealed);
            const m = other ? L.moveById(ns, gid, other.id) : null;
            if (m && !(m.outcome.kind === 'invalid' && m.outcome.reason === 'range' && m.state === ns)) idBad.push(`${lv}: 消えた瓶 id ${gid} で注げてしまう`);
            if (L.indexOfId(ns, gid) !== -1) idBad.push(`${lv}: 消えた瓶の indexOfId が -1 でない`);
          }
          // 途中で保存して読み直す
          if (k === Math.floor(info.solution.length / 2)) {
            const sv = L.validateSave(L.makeSave(lv, ids));
            const rp = sv && L.replay(lv, sv.moves);
            if (!(rp && rp.ok && J(rp.state) === J(ns))) saveBad.push(`${lv}: 途中 ${k + 1} 手の保存を replay した局面が違う`);
          }
          st = ns;
        }
        if (!st.won) bad.push(`${lv}: solution で won にならない`);
        if (J(ids) !== J(info.solutionIds) || J(L.toIdMoves(s0, info.solution)) !== J(info.solutionIds)) idBad.push(`${lv}: solutionIds が位置の手を id に直したものと違う`);
      }
      check(`届けるたびに瓶が届けた本数だけ減り、空き瓶は増えない（注いで空いた瓶の分だけ）。2・6・12・20・40 面の解（届け ${deliveriesSeen} 回）`, bad.length === 0 && deliveriesSeen > 0, bad.slice(0, 6));
      check('瓶の id：fromId・toId・deliveries の id が正しく、届けた id は消え、残りは並び順のまま・中身も同じ id に付いていく。消えた id では注げない', idBad.length === 0, idBad.slice(0, 6));
      check('途中で保存（v:3・id の手）→ validateSave → replay で、同じ局面に戻る', saveBad.length === 0, saveBad);
    },
  },

  {
    id: 'BL12', tier: 'smoke', node: true, title: 'いろびん 布の瓶：pourCheck の covered の順・布の瓶へ／から注げない・届けた数が cover に届いた手で unveiled に出て cover:null（1人早くは取れない）・空き瓶の布で空き瓶が増える・隠れの面は一番上だけ見える・イミュータブル',
    run({ check, root }) {
      const L = load(root);
      // 0:[0,0,0] 1:[0] 2:布(cover 1)[1,1,2,2] 3:布(cover 2)空き瓶 4:[] 5:栓[3,3,3,3] 6:[1,1,1] 7:[1]
      const S = mk([[0, 0, 0], [0], { c: [1, 1, 2, 2], cover: 1 }, { c: [], cover: 2 }, [], { c: [3, 3, 3, 3], sealed: true }, [1, 1, 1], [1]], { slots: [0, 1], queue: [2] });
      const snap = J(S);
      const R = (f, t) => L.pourCheck(S, f, t);
      const ng = (f, t, why) => { const r = R(f, t); return !!r && r.ok === false && r.reason === why; };
      check('布の瓶から（中身あり）・布の瓶へ（空き瓶の布にも、空の瓶からでも）は covered', ng(2, 4, 'covered') && ng(0, 3, 'covered') && ng(7, 3, 'covered') && ng(2, 0, 'covered'), [R(2, 4), R(0, 3), R(7, 3), R(2, 0)]);
      check('判定の順：range → same → covered → empty → sealed（同じ布の瓶は same、範囲外は range、空の元＋布の相手・布の元＋栓の相手は covered）',
        ng(2, 2, 'same') && ng(3, 99, 'range') && ng(4, 3, 'covered') && ng(3, 5, 'covered') && ng(4, 0, 'empty') && ng(5, 0, 'sealed'), [R(2, 2), R(3, 99), R(4, 3), R(3, 5)]);
      const W = mk([[], { c: [1, 2], cover: 1 }, { c: [0, 0, 0, 0] }], { slots: [null, null], queue: [], served: 1, total: 1, won: true });
      const w = L.pourCheck(W, 1, 0);
      check('クリア後は布の瓶でも won（won が一番先）', !!w && w.ok === false && w.reason === 'won', w);
      const inv = L.applyMove(S, 0, 3);
      check('applyMove で布の瓶へ注ぐと invalid（reason covered）・state はそのまま', inv.outcome.kind === 'invalid' && inv.outcome.reason === 'covered' && J(inv.state) === snap, inv.outcome);
      const lm = L.legalMoves(S);
      check(`legalMoves に布の瓶（位置 2・3）を含む手が無い（${J(lm)}）`, lm.length > 0 && !lm.some(([f, t]) => [2, 3].includes(f) || [2, 3].includes(t)), lm);
      check('はじめは布がかぶったまま（cover 1・2、届けた数 0）', S.bottles[2].cover === 1 && S.bottles[3].cover === 2, null);
      // 1) 色 0 がそろって届く → served 1 → cover 1 の布が取れる（cover 2 はまだ。1 人早くは取れない）
      const r1 = L.applyMove(S, 1, 0), o1 = r1.outcome, s1 = r1.state;
      check('1 人届けた手（served 1）：unveiled は cover 1 の瓶（id 2）だけ。bottle は新しい並びの位置、cells・hidden は取れた瓶の中身',
        o1.kind === 'pour' && s1.served === 1 && o1.unveiled.length === 1 && o1.unveiled[0].id === 2 && s1.bottles[o1.unveiled[0].bottle].id === 2 && J(o1.unveiled[0].cells) === '[1,1,2,2]' && J(o1.unveiled[0].hidden) === '[false,false,false,false]', o1.unveiled);
      const b2 = s1.bottles.find((b) => b.id === 2), b3 = s1.bottles.find((b) => b.id === 3);
      check('取れた瓶は cover:null（中身はそのまま）、cover 2 の瓶はまだ cover 2（1 人早くは取れない）', b2 && b2.cover === null && J(b2.cells) === '[1,1,2,2]' && b3 && b3.cover === 2, { b2, b3 });
      check('ふつうの瓶は cover:null', s1.bottles.filter((b) => b.id !== 3).every((b) => b.cover === null), s1.bottles.map((b) => b.cover));
      const p2 = L.pourCheck(s1, s1.bottles.findIndex((b) => b.id === 2), s1.bottles.findIndex((b) => b.id === 4));
      check('布が取れた瓶は注ぐ元になる（空の瓶へ count 2）', p2.ok === true && p2.count === 2, p2);
      check('元の state は変わらない（イミュータブル）', J(S) === snap, null);
      // 2) 色 1 がそろって届く → served 2 → 空き瓶の布（cover 2）が取れて、使える空き瓶が 1 本増える
      const usable = (st) => st.bottles.filter((b) => b.cells.length === 0 && b.cover === null && !b.sealed).length;
      const i7 = s1.bottles.findIndex((b) => b.id === 7), i6 = s1.bottles.findIndex((b) => b.id === 6);
      const r2 = L.applyMove(s1, i7, i6), o2 = r2.outcome, s2 = r2.state;
      check('2 人目を届けた手（served 2）：空き瓶の布（id 3）が取れる。unveiled は cells []・bottle は新しい並びの位置',
        o2.kind === 'pour' && s2.served === 2 && o2.deliveries.length === 1 && o2.unveiled.length === 1 && o2.unveiled[0].id === 3 && J(o2.unveiled[0].cells) === '[]' && s2.bottles[o2.unveiled[0].bottle].id === 3 && s2.bottles[o2.unveiled[0].bottle].cover === null, { u: o2.unveiled, served: s2.served });
      check(`使える空き瓶が、注いで空いた 1 本＋布が取れた 1 本で ${usable(s1)} → ${usable(s2)} 本`, usable(s2) === usable(s1) + 2, { before: usable(s1), after: usable(s2) });
      const r2b = L.applyMove(s1, s1.bottles.findIndex((b) => b.id === 2), s1.bottles.findIndex((b) => b.id === 4));
      check('届けの無い手では unveiled は空の配列（布は取れない）', r2b.outcome.kind === 'pour' && Array.isArray(r2b.outcome.unveiled) && r2b.outcome.unveiled.length === 0 && r2b.state.bottles.find((b) => b.id === 3).cover === 2, r2b.outcome);
      // 3) 隠れの面：布が取れると一番上だけ見え、ほかは「？」のまま
      const H = mk([[0, 0, 0], [0], { c: [1, 2, 1, 2], h: [true, true, true, false], cover: 1 }, []], { slots: [0, null], queue: [], total: 2, params: { colors: 3, empties: 1, hidden: true, order: 'random' } });
      const hs = J(H);
      const r3 = L.applyMove(H, 1, 0), u3 = r3.outcome.unveiled[0];
      const hb = r3.state.bottles.find((b) => b.id === 2);
      check('隠れの面で取れた瓶は、一番上だけ見え下の 3 段は隠れのまま（unveiled の hidden も同じ）', !!u3 && J(u3.hidden) === '[true,true,true,false]' && hb && hb.cover === null && J(hb.hidden) === '[true,true,true,false]', { u3, hb });
      check('隠れの面でも元の state は変わらない', J(H) === hs, null);
      // 凍結した state でも例外なし
      const fr = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(fr); } return o; };
      let threw = null;
      try { const F = fr(JSON.parse(snap)); L.applyMove(F, 1, 0); L.applyMove(F, 0, 3); L.legalMoves(F); L.solve(F); } catch (e) { threw = String(e); }
      check('凍結した布つきの state を渡しても例外にならない', threw === null, threw);
      // ソルバーも布を考える：布が取れるまで注げない盤を解き、手順を applyMove で再生すると won
      // 盤：0:[0,0,0] 1:[0] 2:布(cover 1)[1,1,1] 3:[1] 4:[]。色 0 を届けて布が取れてから、1 を 2 へ注ぐしかない
      const CS = mk([[0, 0, 0], [0], { c: [1, 1, 1], cover: 1 }, [1], []], { slots: [0, 1], queue: [] });
      const sv = L.solve(CS), solvedOk = (() => { if (!sv.solved) return false; let st = CS; for (const [f, t] of sv.moves) { const r = L.applyMove(st, f, t); if (r.outcome.kind !== 'pour') return false; st = r.state; } return st.won; })();
      const dead = mk([[0, 0, 0], [1], { c: [0], cover: 2 }, [1, 1, 1]], { slots: [0, 1], queue: [], total: 2 });
      const dv = L.solve(dead);
      check('布が取れないと解けない盤（色 0 の最後の 1 段が cover 2 の布の中）は solved:false', dv.solved === false && dv.exhausted === false, dv);
      check('solve は布の決まりで解き、手順を applyMove で再生すると won（布の瓶を使う手が出ない）', sv.solved === true && solvedOk, { solved: sv.solved, n: sv.moves && sv.moves.length });
    },
  },
  {
    id: 'BL13', tier: 'smoke', node: true, title: 'いろびん 布の生成：1〜2000 面が決定的（抜き取り）・全部解ける（solution を applyMove で再生して won・布は全部取れる）・paramsFor の表のとおり（1〜7 面は布なし、8 面は中身あり cover 1、15〜24 面は空き瓶 0.4、25 面以降は空き瓶の布なし）・中身ありの布の cover の幅・1本の布の瓶に同じ色4段が無い・25 面以降の布の面の半分以上で布が効いている（§17.9）',
    run({ check, root }) {
      const L = load(root);
      const N = 2000;
      const bad = [], tbl = [], det = [];
      const fb = { 0: 0, 1: 0, 2: 0 };
      let maxMs = 0, maxAt = 0, clothLv = 0, emptyCl = 0, fullCl = 0, effN = 0, effYes = 0;
      const covBad = [];
      // 重さは CPU 時間で見る（T-21。壁の時計の合計は参考に出すだけ）
      const cpuMs = (c) => { const u = cpuOf(c); return (u.user + u.system) / 1000; };
      const c0 = cpuOf(), t0 = Date.now();
      for (let lv = 1; lv <= N; lv++) {
        const a = cpuOf();
        const c = L.createLevel(lv);
        const ms = Math.round(cpuMs(a)); if (ms > maxMs) { maxMs = ms; maxAt = lv; }
        if (lv % 7 === 0 || lv <= 30) { if (J(L.createLevel(lv)) !== J(c)) det.push(lv); }
        const { state: s, info } = c, p = L.paramsFor(lv);
        fb[info.fallback] = (fb[info.fallback] || 0) + 1;
        // 面の表（契約 §17.2 の最終の表と §17.9）
        const wantCloths = lv <= 7 ? 0 : lv <= 24 ? 1 : (lv % 2 === 0 ? 1 : 0);
        const wantEmpty = lv <= 7 ? 0 : lv === 8 ? 0 : lv <= 14 ? 0.7 : lv <= 24 ? 0.4 : 0;
        if (p.cloths !== wantCloths || (wantCloths > 0 && p.clothEmpty !== wantEmpty)) tbl.push({ lv, cloths: p.cloths, clothEmpty: p.clothEmpty });
        const cov = s.bottles.filter((b) => b.cover !== null);
        if (lv <= 7 && cov.length) bad.push(`${lv}: 1〜7 面に布がある`);
        if (lv >= 25 && cov.some((b) => b.cells.length === 0)) bad.push(`${lv}: 25 面以降に空き瓶の布がある`);
        if (info.fallback === 0 && cov.length !== p.cloths) bad.push(`${lv}: 布の瓶 ${cov.length} 本≠${p.cloths}`);
        if (cov.length) clothLv++;
        // 中身ありの布の cover の幅（§17.9）：8 面は 1、8〜14 面は 1〜total/3、15〜24 面は total/3〜total/2、25 面以降は total/2±1
        const T = s.total, [cLo, cHi] = lv === 8 ? [1, 1] : lv <= 14 ? [1, Math.ceil(T / 3)] : lv <= 24 ? [Math.ceil(T / 3), Math.ceil(T / 2)] : [Math.ceil(T / 2) - 1, Math.ceil(T / 2) + 1];
        if (info.fallback === 0) for (const b of cov) if (b.cells.length > 0 && !(b.cover >= cLo && b.cover <= cHi)) covBad.push({ lv, cover: b.cover, want: [cLo, cHi] });
        if (lv === 8 && !(cov.length === 1 && cov[0].cells.length > 0 && cov[0].cover === 1)) covBad.push({ lv, intro: cov.map((b) => [b.cells.length, b.cover]) });
        // 布が効いているか（§17.9）：cover を 1 にした同じ面より、注文の順どおりに解く探索量が 1.5 倍以上（25〜600 面の布の面）
        if (lv >= 25 && lv <= 600 && cov.length) {
          const one = JSON.parse(J(s)); one.bottles.forEach((b) => { if (b.cover !== null) b.cover = 1; });
          const r = L.solve(JSON.parse(J(s)), { nodeLimit: 400000 }), r1 = L.solve(one, { nodeLimit: 400000 });
          effN++; if (r.nodes >= 1.5 * r1.nodes) effYes++;
        }
        for (const b of cov) {
          if (b.cells.length === 0) emptyCl++; else fullCl++;
          if (!(b.cells.length === 0 || b.cells.length === L.CAP)) bad.push(`${lv}: 布の瓶の中身が ${b.cells.length} 段（空き瓶か 4 段のはず）`);
          if (b.cells.length === L.CAP && b.cells.every((x) => x === b.cells[0])) bad.push(`${lv}: 布の瓶に同じ色 4 段（取れた瞬間にそろってしまう）`);
          if (!(Number.isInteger(b.cover) && b.cover >= 1 && b.cover <= s.total - 1)) bad.push(`${lv}: cover ${b.cover} が 1〜total-1 でない`);
        }
        if (s.bottles.length > (L.MAX_BOTTLES || 11)) bad.push(`${lv}: 瓶が ${s.bottles.length} 本（11 本を超える）`);
        if (!(info.nodes <= L.GEN_NODE_BUDGET)) bad.push(`${lv}: nodes ${info.nodes}`);
        // 解ける：solution を applyMove で再生して won。布は途中で全部取れる
        let st = s, unv = 0;
        for (const [f, t] of info.solution) {
          const r = L.applyMove(st, f, t);
          if (r.outcome.kind !== 'pour') { bad.push(`${lv}: solution の手が注げない（${r.outcome.reason}）`); break; }
          unv += r.outcome.unveiled.length; st = r.state;
        }
        if (!st.won) bad.push(`${lv}: solution で won にならない`);
        else if (st.bottles.some((b) => b.cover !== null) || unv !== cov.length) bad.push(`${lv}: 布が取れないまま終わった（取れた ${unv}/${cov.length}）`);
        if (bad.length > 20) break;
      }
      const total = Math.round(cpuMs(c0)), wallTotal = Date.now() - t0;
      check(`paramsFor の布の表（1〜7 面 0 本、8〜24 面 1 本・空き瓶 8 面 0／9〜14 面 0.7／15〜24 面 0.4、25 面以降は偶数面 1 本・奇数面 0 本・空き瓶 0）が 1〜${N} 面で正しい`, tbl.length === 0, tbl.slice(0, 6));
      check(`中身ありの布の cover の幅（8 面は中身あり cover 1、〜14 面 1〜total/3、15〜24 面 total/3〜total/2、25 面以降 total/2±1）`, covBad.length === 0, covBad.slice(0, 6));
      check(`25〜600 面の布の面の半分以上で布が効いている（cover 1 より探索量 1.5 倍以上）：${effYes}/${effN}＝${Math.round(100 * effYes / Math.max(1, effN))}%`, effN > 0 && effYes * 2 >= effN, { effYes, effN });
      check(`1〜${N} 面：布の本数・中身（空き瓶か 4 段、同じ色 4 段なし）・cover・瓶 11 本以内・solution を再生すると won で布は全部取れる（布の面 ${clothLv}・空き瓶の布 ${emptyCl}・中身ありの布 ${fullCl}）`, bad.length === 0 && clothLv > 0 && emptyCl > 0 && fullCl > 0, bad.slice(0, 8));
      check(`決定的（1〜30 面と 7 の倍数の面を 2 回作って JSON が一致）`, det.length === 0, det.slice(0, 8));
      check(`fallback 2（固定の予備の面）が出ない（0:${fb[0]} 1:${fb[1]} 2:${fb[2]}）`, !fb[2], fb);
      check(`生成が速い：1 面の最大 CPU ${maxMs}ms（${maxAt} 面。目安 300ms 以内）、合計 CPU ${total}ms・壁の時計 ${wallTotal}ms`, maxMs <= 300, { maxMs, maxAt, total, wallTotal });
    },
  },
  {
    id: 'BL14', tier: 'smoke', node: true, title: 'いろびん 保存 v:3（布）：v:3 の途中保存を replay すると布の状態も同じ局面、v:2・v:1 は手を捨てて面の最初から、布の瓶を使う手は replay で止まる',
    run({ check, root }) {
      const L = load(root);
      // 布が途中で取れる面を探す（空き瓶の布と中身ありの布の両方）
      const found = { empty: null, full: null };
      for (let lv = 8; lv <= 40 && !(found.empty && found.full); lv++) {
        const { state: s0, info } = L.createLevel(lv);
        let st = s0;
        for (let k = 0; k < info.solution.length; k++) {
          const r = L.applyMove(st, info.solution[k][0], info.solution[k][1]);
          st = r.state;
          for (const u of r.outcome.unveiled) {
            const key = u.cells.length ? 'full' : 'empty';
            if (!found[key]) found[key] = { lv, k, info, st };
          }
        }
      }
      check(`布が途中で取れる面がある（空き瓶 ${found.empty && found.empty.lv} 面・中身あり ${found.full && found.full.lv} 面）`, !!found.empty && !!found.full, null);
      const bad = [];
      for (const f of [found.empty, found.full].filter(Boolean)) {
        const ids = f.info.solutionIds;
        for (const cut of [Math.max(0, f.k - 1), f.k + 1]) {   // 布が取れる前と、取れた後
          const raw = L.makeSave(f.lv, ids.slice(0, cut));
          const o = JSON.parse(raw);
          const sv = L.validateSave(raw);
          const rp = sv && L.replay(f.lv, sv.moves);
          let st = L.createLevel(f.lv).state;
          for (const [a, b] of f.info.solution.slice(0, cut)) st = L.applyMove(st, a, b).state;
          if (o.v !== 3) bad.push(`${f.lv}: makeSave の v が ${o.v}`);
          if (!(rp && rp.ok && rp.applied === cut && J(rp.state) === J(st))) bad.push(`${f.lv}: ${cut} 手の保存を replay した局面が違う（布の状態 ${rp && J(rp.state.bottles.map((b) => b.cover))} / ${J(st.bottles.map((b) => b.cover))}）`);
        }
      }
      check('v:3 の途中保存（布が取れる前・後）→ validateSave → replay で、布の状態（cover）も含めて同じ局面', bad.length === 0, bad);
      // v:2・v:1（布の前のルール）の手は捨てる
      const f = found.full || found.empty;
      if (f) {
        const some = f.info.solutionIds.slice(0, 3);
        const v2 = L.validateSave(J({ v: 2, level: f.lv, moves: some })), v1 = L.validateSave(J({ v: 1, level: f.lv, moves: some }));
        check(`古い v:2・v:1 の保存は手を捨てて、その面（${f.lv} 面）の最初から（{ level, moves: [] }）`, J(v2) === J({ level: f.lv, moves: [] }) && J(v1) === J({ level: f.lv, moves: [] }), { v2, v1 });
        const rp0 = L.replay(f.lv, v2 ? v2.moves : null);
        check('捨てた後の replay は createLevel と同じ最初の局面（布もかぶったまま）', !!rp0 && rp0.ok && rp0.applied === 0 && J(rp0.state) === J(L.createLevel(f.lv).state) && rp0.state.bottles.some((b) => b.cover !== null), rp0 && rp0.applied);
        // 布の瓶を使う手は replay で止まる
        const s0 = L.createLevel(f.lv).state;
        const cid = s0.bottles.find((b) => b.cover !== null).id, other = s0.bottles.find((b) => b.cover === null && b.cells.length > 0).id;
        const rb = L.replay(f.lv, [[other, cid]]), rb2 = L.replay(f.lv, [[cid, other]]);
        check('布の瓶へ／から注ぐ手（id）を含む保存は replay で止まる（ok:false・applied 0）', rb.ok === false && rb.applied === 0 && rb2.ok === false && rb2.applied === 0, { rb: rb.applied, rb2: rb2.applied });
      }
    },
  },
  {
    id: 'BL15', tier: 'smoke', node: true, title: 'いろびん v36（IB-09・IB-11）：makeSave は最初の MAX_MOVES_SAVED 手だけ書き、何手でも validateSave が読める。予備の固定面（fallback 2）も解けて won、予備の面が解けなければ createLevel は例外',
    run({ check, root }) {
      const L = load(root);
      // ---- IB-09 ----
      const N = L.MAX_MOVES_SAVED;
      const bad = [0, 1, N - 1, N, N + 1, N * 3].filter((n) => {
        const raw = L.makeSave(1, Array.from({ length: n }, (_, i) => [i % 7, (i + 1) % 7]));
        const sv = L.validateSave(raw);
        return !(sv && sv.level === 1 && sv.moves.length === Math.min(n, N) && (n === 0 || J(sv.moves[0]) === J([0, 1])));
      });
      check(`makeSave → validateSave が 0・1・${N - 1}・${N}・${N + 1}・${N * 3} 手で読め、手は最初の ${N} 手まで（読めない：${bad.join('・') || 'なし'}）`, bad.length === 0, bad);
      // ---- IB-11：上書きの params で fallback 2（固定の予備の面）を出す ----
      const P2 = { colors: 2, empties: 1, hidden: true, order: 'random', cloths: 1, clothEmpty: 0, clothCover: 'late' };
      const rows = [1, 2, 3, 50].map((lv) => { const c = L.createLevel(lv, { params: P2 }); let s = c.state; for (const [a, b] of c.info.solution) s = L.applyMove(s, a, b).state; return { lv, fb: c.info.fallback, n: c.info.solution.length, won: s.won }; });
      check(`予備の固定面（fallback 2）：1・2・3・50 面で solution を applyMove で再生すると won（${rows.map((r) => `${r.lv}:fb${r.fb}・${r.n}手・${r.won}`).join('、')}）`, rows.every((r) => r.fb === 2 && r.n > 0 && r.won === true), rows);
      // 予備の面を解けない形にした logic.js（このテストの中だけ。ファイルは変えない）では createLevel が例外になる＝ fallback 2 も verify を通している
      const src = fs.readFileSync(path.join(root, 'games/irobin/logic.js'), 'utf8');
      const FROM = 'cells: [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2], [], []],';
      const sb = { console }; sb.globalThis = sb; vm.createContext(sb);
      vm.runInContext(src.replace(FROM, 'cells: [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2]],'), sb);
      let thrown = null;
      try { sb.IrobinLogic.createLevel(1, { params: P2 }); } catch (e) { thrown = String(e && e.message); }
      check(`予備の面が解けない形なら createLevel(1, fallback 2) は例外（${thrown || '例外なし'}）`, src.includes(FROM) && !!thrown && /予備の面/.test(thrown), { found: src.includes(FROM), thrown });
    },
  },
];
