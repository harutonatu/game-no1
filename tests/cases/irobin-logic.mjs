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
// 瓶の指定：色の配列（下→上）。{ c: [...], h: [true,...], sealed: true, cover: k } で隠れ・栓・布（§17）も指定できる。
// v37（§19）：cap: 3＝ちいさい びん、only: 色＝いろ きまりの びん、lock: 色＝かぎの びん
const B = (spec) => {
  const o = Array.isArray(spec) ? { c: spec } : spec;
  return { cells: [...o.c], hidden: o.h ? [...o.h] : o.c.map(() => false), sealed: !!o.sealed, ...(o.cover !== undefined ? { cover: o.cover } : {}),
    ...(o.cap !== undefined ? { cap: o.cap } : {}), ...(o.only !== undefined ? { only: o.only } : {}), ...(o.lock !== undefined ? { lock: o.lock } : {}) };   // v37 の仕掛け（契約 §19）
};
function mk(bottles, { slots = [null, null], queue = [], served = 0, total, moves = 0, won = false, params = { colors: 3, empties: 1, hidden: false, order: 'random' } } = {}) {
  return { level: 1, params, bottles: bottles.map(B), slots: [...slots], queue: [...queue], served, total: total ?? served + slots.filter((x) => x !== null).length + queue.length, moves, won };
}
const J = (x) => JSON.stringify(x);
const colorsOf = (s) => s.bottles.map((b) => b.cells.join(''));

export const tests = [
  {
    id: 'BL1', tier: 'smoke', node: true, title: 'いろびん：定数・COLORS（10色・色と記号がすべて違う）・paramsFor が面の表どおり（境界・壊れた値）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'いろびん', CAP: 4, ORDER_SLOTS: 2, MAX_COLORS: 10, MAX_MOVES_SAVED: 2000, SOLVE_NODE_LIMIT: 40000, GEN_NODE_BUDGET: 100000, GEN_TRIES: 40, SAVE_KEY_BEST: 'irobin.best', SAVE_KEY_SAVE: 'irobin.save', SAVE_KEY_HELP: 'irobin.help' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §3 のとおり', kBad.length === 0, kBad);
      const C = L.COLORS;
      const idOk = Array.isArray(C) && C.length === 10 && C.every((c, i) => c.id === i);
      check('COLORS は 10 色で id が 0〜9', idOk, C);
      check('MAX_BOTTLES が 12', L.MAX_BOTTLES === 12, L.MAX_BOTTLES);
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
        T(40, 9, 2, true, 'random'), T(41, 9, 2, true, 'random'), T(60, 9, 2, true, 'random'), T(61, 10, 2, true, 'random'), T(1000, 10, 2, true, 'random'),
      ];
      const bad = table.filter((r) => { const p = L.paramsFor(r.lv); return !(p && p.colors === r.colors && p.empties === r.empties && p.hidden === r.hidden && p.order === r.order); })
        .map((r) => ({ want: r, got: L.paramsFor(r.lv) }));
      check('paramsFor が表どおり（1・2・5・6・9・10・12・14・15・24・25・39・40・60・61・1000 の境界を含む）', bad.length === 0, bad);
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
        // v37（§19）：いろ きまりの びんは、その色がそろうと届けて消えることがある（空き瓶が onlys 本まで少なくなる）
        else if (info.fallback === 0 && !(rp.state.bottles.length <= p.empties + emptyCloth && rp.state.bottles.length >= p.empties + emptyCloth - (p.onlys || 0) && rp.state.bottles.every((b) => b.cells.length === 0 && b.cover === null && b.lock === null))) bad.push(`${lv}: クリアの局面が「空き瓶 ${p.empties + emptyCloth} 本だけ（布はすべて取れている）」でない（${rp.state.bottles.length} 本）`);
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
      // 布の瓶がある面は注文の順が効く（契約 §17.9）ので、布の無い面（3・4・27 面）で確かめる
      const pairs = [];
      for (const lv of [3, 4, 27]) {
        const st = L.createLevel(lv).state;
        const q = [...st.slots, ...st.queue].reverse();
        const rev = { ...JSON.parse(J(st)), slots: q.slice(0, 2), queue: q.slice(2) };
        const a1 = L.solve(st), a2 = L.solve(rev), a3 = L.solve(st, { anyOrder: true });
        pairs.push({ lv, a: a1.solved, rev: a2.solved, any: a3.solved, cloth: st.bottles.some((b) => b.cover !== null) });
      }
      check('布の無い面では、注文の順を逆にしても、anyOrder でも、解けるかどうかは同じ（生成した 3・4・27 面）', pairs.every((x) => x.a === true && x.rev === true && x.any === true && !x.cloth), pairs);
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
    id: 'BL13', tier: 'smoke', node: true, title: 'いろびん 布の生成：1〜2000 面が決定的（抜き取り）・全部解ける（solution を applyMove で再生して won・布は全部取れる）・paramsFor の表のとおり（1〜4 面は布なし、5 面は中身あり cover 1、6〜7 面は空き瓶の布、15〜24 面は空き瓶 0.4、25 面以降は空き瓶の布なし）・中身ありの布の cover の幅・1本の布の瓶に同じ色4段が無い・25 面以降の布の面の半分以上で布が効いている（§17.9）',
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
        const wantCloths = lv <= 4 ? 0 : lv <= 24 ? 1 : (lv % 2 === 0 ? 1 : 0);
        const wantEmpty = lv === 5 ? 0 : lv <= 7 ? 1 : lv <= 14 ? 0.7 : lv <= 24 ? 0.4 : 0;
        if (p.cloths !== wantCloths || (wantCloths > 0 && p.clothEmpty !== wantEmpty)) tbl.push({ lv, cloths: p.cloths, clothEmpty: p.clothEmpty });
        const cov = s.bottles.filter((b) => b.cover !== null);
        if (lv <= 4 && cov.length) bad.push(`${lv}: 1〜4 面に布がある`);
        if (lv >= 25 && cov.some((b) => b.cells.length === 0)) bad.push(`${lv}: 25 面以降に空き瓶の布がある`);
        if (info.fallback === 0 && cov.length !== p.cloths) bad.push(`${lv}: 布の瓶 ${cov.length} 本≠${p.cloths}`);
        if (cov.length) clothLv++;
        // 中身ありの布の cover の幅（§17.9）：5 面は 1、6〜14 面は 1〜total/3、15〜24 面は total/3〜total/2、25 面以降は total/2±1
        const T = s.total, [cLo, cHi] = lv === 5 ? [1, 1] : lv <= 14 ? [1, Math.ceil(T / 3)] : lv <= 24 ? [Math.ceil(T / 3), Math.ceil(T / 2)] : [Math.ceil(T / 2) - 1, Math.ceil(T / 2) + 1];
        if (info.fallback === 0) for (const b of cov) if (b.cells.length > 0 && !(b.cover >= cLo && b.cover <= cHi)) covBad.push({ lv, cover: b.cover, want: [cLo, cHi] });
        if (lv === 5 && !(cov.length === 1 && cov[0].cells.length > 0 && cov[0].cover === 1)) covBad.push({ lv, intro: cov.map((b) => [b.cells.length, b.cover]) });
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
        if (s.bottles.length > (L.MAX_BOTTLES || 11)) bad.push(`${lv}: 瓶が ${s.bottles.length} 本（MAX_BOTTLES を超える）`);
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
      check(`paramsFor の布の表（1〜4 面 0 本、5〜24 面 1 本・空き瓶 5 面 0／6〜7 面 1／8〜14 面 0.7／15〜24 面 0.4、25 面以降は偶数面 1 本・奇数面 0 本・空き瓶 0）が 1〜${N} 面で正しい`, tbl.length === 0, tbl.slice(0, 6));
      check(`中身ありの布の cover の幅（5 面は中身あり cover 1、〜14 面 1〜total/3、15〜24 面 total/3〜total/2、25 面以降 total/2±1）`, covBad.length === 0, covBad.slice(0, 6));
      check(`25〜600 面の布の面の半分以上で布が効いている（cover 1 より探索量 1.5 倍以上）：${effYes}/${effN}＝${Math.round(100 * effYes / Math.max(1, effN))}%`, effN > 0 && effYes * 2 >= effN, { effYes, effN });
      check(`1〜${N} 面：布の本数・中身（空き瓶か 4 段、同じ色 4 段なし）・cover・瓶 MAX_BOTTLES（12 本）以内・solution を再生すると won で布は全部取れる（布の面 ${clothLv}・空き瓶の布 ${emptyCl}・中身ありの布 ${fullCl}）`, bad.length === 0 && clothLv > 0 && emptyCl > 0 && fullCl > 0, bad.slice(0, 8));
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
  // ======================================================================
  // v37 の新しい仕掛け（IB-29・契約 §19）。ユーザーの答え：「全て採用です。徐々に難易度が上がるよう調整した上で採用します」
  {
    id: 'BL16', tier: 'smoke', node: true, title: 'いろびん v37 ちいさい びん：3 段までしか入らない（注ぐ量・full）・3 段そろっても栓にならない・cap の形の検査・ソルバーも 3 段で考える・イミュータブル',
    run({ check, root }) {
      const L = load(root);
      check('SMALL_CAP は 3、SMALL_FROM は 41', L.SMALL_CAP === 3 && L.SMALL_FROM === 41, { SMALL_CAP: L.SMALL_CAP, SMALL_FROM: L.SMALL_FROM });
      // 0:[1,0,0] 1:ちいさい[0,0] 2:ちいさい[0,0,0] 3:[] 4:ちいさい[] 5:[2,0,0,0]
      const S = mk([[1, 0, 0], { c: [0, 0], cap: 3 }, { c: [0, 0, 0], cap: 3 }, [], { c: [], cap: 3 }, [2, 0, 0, 0]], { slots: [1, 2], queue: [0] });
      const snap = J(S);
      const R = (f, t) => L.pourCheck(S, f, t);
      check('ちいさい びん（2 段）へ同じ色 2 段を注ぐと 1 段だけ（count 1）', R(0, 1).ok === true && R(0, 1).count === 1, R(0, 1));
      check('ちいさい びん（3 段）へは full', R(0, 2).ok === false && R(0, 2).reason === 'full', R(0, 2));
      check('から の ちいさい びんへ 3 段続きを注ぐと 3 段（ふつうの空き瓶へも 3 段）', R(5, 4).ok === true && R(5, 4).count === 3 && R(5, 3).count === 3, [R(5, 4), R(5, 3)]);
      const r = L.applyMove(S, 0, 1), b1 = r.state.bottles[1];
      check('注いだ後のちいさい びんは 3 段・cap 3・同じ色 3 段でも栓をしない（sealed false・届けない）', r.outcome.kind === 'pour' && b1.cap === 3 && J(b1.cells) === '[0,0,0]' && b1.sealed === false && r.outcome.sealed === null && r.state.served === 0, { b1, o: r.outcome.sealed });
      check('ふつうの瓶は cap 4・only/lock は null', r.state.bottles.filter((b) => b.id !== 1 && b.id !== 2 && b.id !== 4).every((b) => b.cap === 4 && b.only === null && b.lock === null), r.state.bottles.map((b) => [b.cap, b.only, b.lock]));
      const fr = L.pourCheck(r.state, 1, 3);
      check('ちいさい びんから注ぐのは ふつうと同じ（3 段続きを空き瓶へ count 3）', fr.ok === true && fr.count === 3, fr);
      check('元の state は変わらない（イミュータブル）', J(S) === snap, null);
      const lm = L.legalMoves(S);
      check('legalMoves に満杯のちいさい びん（位置 2）へ注ぐ手が無い', lm.length > 0 && !lm.some(([, t]) => t === 2), lm);
      // 形の検査
      const nz = (b) => L.normalizeState(mk([b, []], { slots: [0, null], queue: [], total: 1 }));
      check('cap 3 で 4 段・cap 3 で栓・cap 5・cap "3"（文字）は normalizeState が null', nz({ c: [0, 1, 0, 1], cap: 3 }) === null && nz({ c: [0, 0, 0, 0], cap: 3, sealed: true }) === null && nz({ c: [0], cap: 5 }) === null && nz({ c: [0], cap: '3' }) === null, null);
      const ok3 = nz({ c: [0, 1], cap: 3 }), ok4 = nz({ c: [0, 1], cap: 4 }), okN = nz({ c: [0, 1] });
      check('cap 3 は 3・cap 4 と cap 無しは 4 で読める', ok3 && ok3.bottles[0].cap === 3 && ok4 && ok4.bottles[0].cap === 4 && okN && okN.bottles[0].cap === 4, [ok3 && ok3.bottles[0].cap, ok4 && ok4.bottles[0].cap]);
      check('ちいさい びんに布・いろ きまり・かぎは重ねられない（null）', nz({ c: [], cap: 3, cover: 1 }) === null && nz({ c: [], cap: 3, only: 0 }) === null && nz({ c: [0, 1], cap: 3, lock: 2 }) === null, null);
      // ソルバー：ふつうの空き瓶なら解ける盤が、ちいさい びんだと解けない（4 段そろう場所にならない）
      const board = (cap) => mk([[0, 1, 1, 1], [0, 0, 1, 0], { c: [], cap }], { slots: [0, 1], queue: [] });
      const p4 = L.solve(board(4)), p3 = L.solve(board(3));
      check('盤 [0,1,1,1]・[0,0,1,0]・空き瓶：ふつうの空き瓶なら解ける、ちいさい びんだと解けない（solved:false・exhausted:false）', p4.solved === true && p3.solved === false && p3.exhausted === false, { p4: p4.solved, p3 });
      const stuck = mk([[2, 1, 2, 0], { c: [0, 0, 0], cap: 3 }, [1, 2, 1, 2]], { slots: [0, 1], queue: [2] });
      check('満杯のちいさい びんにしか注げない局面は isStuck（legalMoves が空）', L.isStuck(stuck) === true && L.legalMoves(stuck).length === 0, L.legalMoves(stuck));
      let threw = null;
      const frz = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(frz); } return o; };
      try { const F = frz(JSON.parse(snap)); L.applyMove(F, 0, 1); L.legalMoves(F); L.solve(F); } catch (e) { threw = String(e); }
      check('凍結した state でも例外にならない', threw === null, threw);
    },
  },
  {
    id: 'BL17', tier: 'smoke', node: true, title: 'いろびん v37 いろ きまりの びん：その色しか入らない（reason only）・判定の順・そろえば栓をして届く・only の形の検査・イミュータブル',
    run({ check, root }) {
      const L = load(root);
      check('ONLY_FROM は 71', L.ONLY_FROM === 71, L.ONLY_FROM);
      // 0:[1,0,0] 1:いろ きまり 0（から） 2:いろ きまり 1（から） 3:[0,1] 4:いろ きまり 0 [0,0,0] 5:[2,2,2]
      const S = mk([[1, 0, 0], { c: [], only: 0 }, { c: [], only: 1 }, [0, 1], { c: [0, 0, 0], only: 0 }, [2, 2, 2]], { slots: [2, 1], queue: [0] });
      const snap = J(S);
      const R = (f, t) => L.pourCheck(S, f, t);
      check('同じ色の いろ きまりの びんへは注げる（count 2）', R(0, 1).ok === true && R(0, 1).count === 2, R(0, 1));
      check('ちがう色の いろ きまりの びん（から）へは reason only', R(0, 2).ok === false && R(0, 2).reason === 'only' && R(3, 1).reason === 'only', [R(0, 2), R(3, 1)]);
      check('中身がある いろ きまりの びんへ ちがう色は mismatch（only より先）', R(3, 4).ok === false && R(3, 4).reason === 'mismatch', R(3, 4));
      const SS = mk([{ c: [0, 0, 0, 0], sealed: true }, { c: [], only: 1 }, { c: [1, 1, 1], only: 1 }, [1]], { slots: [2, 3], queue: [] });
      check('判定の順：same → covered/locked → empty（からの いろ きまりの びんから注ぐ）→ sealed（栓の瓶から）→ full → only', R(1, 1).reason === 'same' && R(1, 0).reason === 'empty' && L.pourCheck(SS, 0, 1).reason === 'sealed' && R(5, 1).reason === 'only', [R(1, 1), R(1, 0), L.pourCheck(SS, 0, 1), R(5, 1)]);
      const r = L.applyMove(S, 0, 4), o = r.outcome;
      check('いろ きまりの びんで 4 段そろうと栓（待ち瓶。お客さんは 2・1 なので届かない）・only は 0 のまま', o.kind === 'pour' && o.sealed === 4 && r.state.bottles[4].sealed === true && r.state.bottles[4].only === 0, { o: o.sealed, b: r.state.bottles[4] });
      const S2 = mk([[1, 0, 0], { c: [0, 0], only: 0 }, []], { slots: [0, 1], queue: [], total: 2 });
      const r2 = L.applyMove(S2, 0, 1);
      check('そろった いろ きまりの びんは、その色のお客さんに届いて消える（瓶が 1 本減る）', r2.outcome.kind === 'pour' && r2.outcome.deliveries.length === 1 && r2.state.bottles.length === 2 && !r2.state.bottles.some((b) => b.id === 1), r2.outcome.deliveries);
      check('注いだ後も only は残る（2 段の いろ きまりの びん）', (() => { const x = L.applyMove(S, 0, 1).state.bottles[1]; return x.only === 0 && J(x.cells) === '[0,0]'; })(), L.applyMove(S, 0, 1).state.bottles[1]);
      check('元の state は変わらない（イミュータブル）', J(S) === snap, null);
      const lm = L.legalMoves(S);
      check('legalMoves に ちがう色を いろ きまりの びんへ注ぐ手が無い（同じ色の手 3→2 はある）', !lm.some(([f, t]) => (t === 2 && f === 0) || (t === 1 && f === 3)) && lm.some(([f, t]) => f === 3 && t === 2), lm);
      const nz = (b) => L.normalizeState(mk([b, []], { slots: [0, null], queue: [], total: 1 }));
      check('only に ちがう色の中身・only 10・only "0"（文字）・only と布の重ね は normalizeState が null', nz({ c: [1], only: 0 }) === null && nz({ c: [], only: 10 }) === null && nz({ c: [], only: '0' }) === null && nz({ c: [], only: 0, cover: 1 }) === null && nz({ c: [], only: 0, lock: 1 }) === null, null);
      const ok = nz({ c: [3, 3], only: 3 });
      check('only 3 で中身が 3 なら読める（only・cap 4・lock null）', ok && ok.bottles[0].only === 3 && ok.bottles[0].cap === 4 && ok.bottles[0].lock === null, ok && ok.bottles[0]);
      // ソルバー：いろ きまりの びんしか空きが無い盤。0 を入れる手しか無いので、0 を先に出せる並びだけ解ける
      const good = mk([[1, 1, 1, 0], [0, 0, 0, 1], { c: [], only: 0 }], { slots: [0, 1], queue: [] });
      const bad = mk([[1, 1, 1, 0], [0, 0, 0, 1], { c: [], only: 2 }], { slots: [0, 1], queue: [] });
      const sg = L.solve(good), sb = L.solve(bad);
      const replayWon = (st, mv) => { let s = st; for (const [f, t] of mv) { const x = L.applyMove(s, f, t); if (x.outcome.kind !== 'pour') return false; s = x.state; } return s.won; };
      check('ソルバー：上の色と同じ いろ きまりの びんなら解けて再生すると won、盤に無い色の いろ きまりの びんだと解けない', sg.solved === true && replayWon(good, sg.moves) && sb.solved === false && sb.exhausted === false, { sg: sg.solved, sb });
    },
  },
  {
    id: 'BL18', tier: 'smoke', node: true, title: 'いろびん v37 かぎの びん：注ぐ元にも相手にもならない（reason locked）・鍵の色を 1 本そろえた手で開く（outcome.unlocked）・届けた数では開かない・lock の形の検査・ソルバーも鍵を考える',
    run({ check, root }) {
      const L = load(root);
      check('KEY_FROM は 101', L.KEY_FROM === 101, L.KEY_FROM);
      // 0:かぎ（1 で開く）[0,2,0] 1:[1,1,1] 2:[1] 3:[] 4:布 cover 1 [2,2,2] 5:[0]
      const S = mk([{ c: [0, 2, 0], lock: 1 }, [1, 1, 1], [1], [], { c: [2, 2, 2], cover: 1 }, [0]], { slots: [2, 0], queue: [1] });
      const snap = J(S);
      const R = (f, t) => L.pourCheck(S, f, t);
      check('かぎの びんから・へは locked（空の瓶からでも）', R(0, 3).reason === 'locked' && R(5, 0).reason === 'locked' && R(3, 0).reason === 'locked', [R(0, 3), R(5, 0), R(3, 0)]);
      check('布の瓶は今までどおり covered（かぎと分けて言う）', R(4, 3).reason === 'covered' && R(5, 4).reason === 'covered', [R(4, 3), R(5, 4)]);
      check('はじめは lock 1・cover null・cap 4', S.bottles[0].lock === 1 && L.normalizeState(S).bottles[0].lock === 1 && L.normalizeState(S).bottles[0].cover === null, L.normalizeState(S).bottles[0]);
      const r = L.applyMove(S, 2, 1), o = r.outcome, k0 = r.state.bottles.find((b) => b.id === 0);
      check('鍵の色（1）をそろえた手で開く：outcome.unlocked に id 0・bottle は新しい並びの位置・color 1', o.kind === 'pour' && o.sealed === 1 && Array.isArray(o.unlocked) && o.unlocked.length === 1 && o.unlocked[0].id === 0 && o.unlocked[0].color === 1 && r.state.bottles[o.unlocked[0].bottle] && r.state.bottles[o.unlocked[0].bottle].id === 0, o.unlocked);
      check('開いた瓶は lock null・cover null・中身はそのまま、注ぐ元になる', k0 && k0.lock === null && k0.cover === null && J(k0.cells) === '[0,2,0]' && L.pourCheck(r.state, r.state.bottles.indexOf(k0), r.state.bottles.findIndex((b) => b.id === 3)).ok === true, k0);
      const r2 = L.applyMove(S, 5, 3);
      check('鍵の色でない手・そろわない手では開かない（unlocked は空の配列）', r2.outcome.kind === 'pour' && J(r2.outcome.unlocked) === '[]' && r2.state.bottles[0].lock === 1, r2.outcome.unlocked);
      const many = mk([{ c: [0, 2, 0], lock: 1 }, [2, 2, 2], [2], [], [1, 1, 1, 1]], { slots: [2, 0], queue: [1], served: 5, total: 9 });
      const r3 = L.applyMove(many, 2, 1);
      check('届けた数がいくつでも、ほかの色（2）をそろえても開かない', r3.outcome.kind === 'pour' && r3.outcome.sealed !== null && r3.state.bottles[0].lock === 1 && r3.outcome.unlocked.length === 0, r3.outcome);
      check('元の state は変わらない（イミュータブル）', J(S) === snap, null);
      const nz = (b) => L.normalizeState(mk([b, []], { slots: [0, null], queue: [], total: 1 }));
      check('lock と栓・lock と布・lock 10・lock "1"（文字）は normalizeState が null', nz({ c: [0, 0, 0, 0], lock: 1, sealed: true }) === null && nz({ c: [0], lock: 1, cover: 2 }) === null && nz({ c: [0], lock: 10 }) === null && nz({ c: [0], lock: '1' }) === null, null);
      // ソルバー：鍵を開けないと解けない盤
      const K = mk([{ c: [0, 0, 0], lock: 1 }, [1, 1, 1], [1], [0]], { slots: [0, 1], queue: [] });
      const sv = L.solve(K);
      let st = K, unl = 0, okRun = sv.solved === true;
      if (okRun) for (const [f, t] of sv.moves) { const x = L.applyMove(st, f, t); if (x.outcome.kind !== 'pour') { okRun = false; break; } unl += x.outcome.unlocked.length; st = x.state; }
      check('ソルバーは鍵を開ける手順を見つけ、再生すると won（途中で 1 回開く）', okRun && st.won === true && unl === 1, { solved: sv.solved, unl });
      const dead = mk([{ c: [0, 0, 1], lock: 1 }, [1, 1, 1], [0], []], { slots: [0, 1], queue: [] });
      check('鍵の色が かぎの びんの中にあって開けられない盤は solved:false', L.solve(dead).solved === false && L.solve(dead).exhausted === false, L.solve(dead));
      let threw = null;
      const frz = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(frz); } return o; };
      try { const F = frz(JSON.parse(snap)); L.applyMove(F, 2, 1); L.legalMoves(F); L.solve(F); L.isStuck(F); } catch (e) { threw = String(e); }
      check('凍結した state でも例外にならない', threw === null, threw);
    },
  },
  {
    id: 'BL19', tier: 'smoke', node: true, title: 'いろびん v37 出し方と生成：paramsFor の表（1〜40 面は無し、41・71・101 面で 1 本ずつ登場、布の面は ちいさい びん だけ）・41〜600 面が全部表どおりに作れて解ける（fallback 0）・1 面 50ms 以内・仕掛けの無い面は前と同じ・保存 v:3 で仕掛けの状態も同じ局面',
    run({ check, root }) {
      const L = load(root);
      const G = (lv) => { const p = L.paramsFor(lv); return [p.smalls, p.onlys, p.keys, p.pick].join(','); };
      // 表（契約 §19.2）
      const want = { 1: '0,0,0,soft', 40: '0,0,0,soft', 41: '1,0,0,soft', 42: '0,0,0,soft', 43: '0,0,0,soft', 49: '1,0,0,soft', 50: '1,0,0,soft', 51: '1,0,0,soft', 54: '1,0,0,soft', 55: '2,0,0,soft', 56: '0,0,0,soft',
        61: '1,0,0,soft', 62: '0,0,0,soft', 63: '0,0,0,soft', 65: '1,0,0,soft', 66: '0,0,0,soft', 67: '0,0,0,soft', 69: '1,0,0,soft',
        70: '0,0,0,soft', 71: '0,1,0,soft', 72: '0,0,0,soft', 73: '0,1,0,hard', 74: '1,0,0,soft', 76: '1,0,0,soft', 77: '2,0,0,soft', 100: '1,0,0,soft', 101: '0,0,1,soft', 103: '1,1,0,soft', 104: '2,0,0,soft', 105: '1,0,1,soft', 107: '0,0,1,hard',
        150: '2,0,0,soft', 151: '1,1,0,soft', 152: '1,0,0,soft', 153: '0,0,1,hard', 154: '0,0,0,soft', 155: '1,1,0,hard', 157: '0,1,0,hard', 2001: '0,0,1,hard' };
      const tb = Object.entries(want).filter(([lv, w]) => G(Number(lv)) !== w).map(([lv, w]) => ({ lv, want: w, got: G(Number(lv)) }));
      check('paramsFor の仕掛けの表（[ちいさい, いろ きまり, かぎ, 色の選び方]）が契約 §19.2 のとおり', tb.length === 0, tb);
      const first = (k) => { for (let lv = 1; lv <= 400; lv++) if (L.paramsFor(lv)[k] > 0) return lv; return 0; };
      check(`はじめて出る面：ちいさい ${first('smalls')}・いろ きまり ${first('onlys')}・かぎ ${first('keys')}（41・71・101）`, first('smalls') === 41 && first('onlys') === 71 && first('keys') === 101, null);
      const intro = [41, 71, 101].map((lv) => { const p = L.paramsFor(lv); return p.smalls + p.onlys + p.keys === 1 && p.pick === 'soft' && p.cloths === 0; });
      check('はじめて出た面は その仕掛け 1 本だけ（ほかと重ねない・布なし・やさしい色の選び方）', intro.every(Boolean), intro);
      const two = (() => { for (let lv = 1; lv <= 400; lv++) if (L.paramsFor(lv).smalls >= 2) return lv; return 0; })();
      const a1 = []; for (let lv = 41; lv < two; lv++) if (L.paramsFor(lv).smalls === 1) a1.push(lv);
      check(`ちいさい びん 2 本は ${two} 面から（それまでに 1 本の面が ${a1.length} 面）`, two === 55 && a1.length >= 3, { two, a1 });
      const bad = [];
      for (let lv = 1; lv <= 2000; lv++) {
        const p = L.paramsFor(lv), g = p.smalls + p.onlys + p.keys;
        if (lv <= 40 && g) bad.push(`${lv}: 1〜40 面に仕掛け`);
        if (p.cloths > 0 && (p.keys > 0 || p.onlys > 0)) bad.push(`${lv}: 布の面に かぎ・いろ きまり`);
        if (p.smalls + p.onlys > p.empties || p.onlys > 1 || p.keys > 1) bad.push(`${lv}: 本数 ${G(lv)}`);
        if (lv >= 150 && G(lv) !== G(lv + 8)) bad.push(`${lv}: 150 面からは 8 面ごとに同じ（${G(lv)}・${G(lv + 8)}）`);
      }
      check('1〜2000 面：1〜40 面は仕掛け無し・布の面に かぎ・いろ きまり は出ない（ちいさい だけ）・ちいさい＋いろ きまり は空き瓶の本数まで・いろ きまり と かぎ は 1 本まで・150 面からは 8 面の くり返し', bad.length === 0, bad.slice(0, 6));
      // 生成（41〜600 面）
      const cpuMs = (c) => { const u = cpuOf(c); return (u.user + u.system) / 1000; };
      const gb = [], slow = [];
      let maxMs = 0, maxAt = 0, unl = 0, lv0 = 0, maxNodes = 0, nodesAt = 0;
      for (let lv = 41; lv <= 600; lv++) {
        const c0 = cpuOf();
        const { state: s, info } = L.createLevel(lv);
        let ms = cpuMs(c0);
        if (ms > 150) {   // 重い面は測り直して一番短い時間（JIT の温まり・GC を数えない）
          for (let k = 0; k < 2; k++) { const c1 = cpuOf(); L.createLevel(lv, { params: L.paramsFor(lv) }); ms = Math.min(ms, cpuMs(c1)); }
        }
        if (ms > maxMs) { maxMs = ms; maxAt = lv; }
        if (ms > 150) slow.push({ lv, ms: Math.round(ms) });
        if (info.nodes > maxNodes) { maxNodes = info.nodes; nodesAt = lv; }
        const p = L.paramsFor(lv);
        if (info.fallback !== 0) { gb.push(`${lv}: fallback ${info.fallback}`); continue; }
        const sm = s.bottles.filter((b) => b.cap === 3), on = s.bottles.filter((b) => b.only !== null), lk = s.bottles.filter((b) => b.lock !== null);
        if (sm.length !== p.smalls || on.length !== p.onlys || lk.length !== p.keys) gb.push(`${lv}: 仕掛けの本数 ${sm.length},${on.length},${lk.length}≠${G(lv)}`);
        if (sm.concat(on).some((b) => b.cells.length !== 0)) gb.push(`${lv}: ちいさい・いろ きまりの びんが はじめから から でない`);
        if (lk.some((b) => b.cells.length !== L.CAP || b.cells.includes(b.lock) || b.cover !== null)) gb.push(`${lv}: かぎの びんの中身・鍵の色`);
        if (s.bottles.some((b) => [b.cap === 3, b.only !== null, b.lock !== null, b.cover !== null].filter(Boolean).length > 1)) gb.push(`${lv}: 1 本に仕掛けが 2 つ`);
        let st = s, u = 0;
        for (const [f, t] of info.solution) { const r = L.applyMove(st, f, t); if (r.outcome.kind !== 'pour') { gb.push(`${lv}: solution が注げない`); break; } u += r.outcome.unlocked.length; st = r.state; }
        if (!st.won) gb.push(`${lv}: solution で won にならない`);
        if (u !== p.keys) gb.push(`${lv}: 鍵が ${u}/${p.keys} しか開かない`);
        unl += u; if (p.smalls + p.onlys + p.keys) lv0++;
        if (gb.length > 12) break;
      }
      check(`41〜600 面：全部 表どおりに作れた（fallback 0）・仕掛けの本数と形が表どおり・solution を再生すると won・鍵は全部開く（仕掛けの面 ${lv0}・開いた鍵 ${unl}）`, gb.length === 0 && lv0 > 300 && unl > 50, gb.slice(0, 8));
      // 重さ：生成の上限は時間ではなく局面の数（どの端末でも同じ面）。調べた局面が v36 の最大（25,671。1〜2000 面）と同じくらいなら、1 面の時間も v36 と同じくらい
      // （Node で最大 約 30ms。目安 50ms 以内は scratchpad の台本で静かなときに測る）。CPU 時間は並列のテストで混むと延びるので、ゆるい上限 150ms だけ見る
      check(`生成で調べた局面が 40,000 以内（v42 の最大 32,767・494 面の約 1.2 倍。最大 ${maxNodes}・${nodesAt} 面）`, maxNodes <= 40000, { maxNodes, nodesAt });
      check(`1 面の生成が CPU 150ms 以内（重い面は 3 回の一番短い時間）：最大 ${Math.round(maxMs)}ms（${maxAt} 面）`, slow.length === 0, slow.slice(0, 6));
      // 仕掛けの無い面は前（v36）と同じ面（瓶の中身・隠れ・布・注文の列の指紋）
      const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
      const fpLv = (lvs) => fnv(lvs.map((lv) => { const s = L.createLevel(lv).state; return J([s.bottles.map((b) => [b.cells, b.hidden, b.cover]), s.slots, s.queue]); }).join('|'));
      const plain = (a, b) => { const o = []; for (let lv = a; lv <= b; lv++) { const p = L.paramsFor(lv); if (!(p.smalls || p.onlys || p.keys) && (lv < 5 || lv > 7)) o.push(lv); } return o; };
      const lvsA = plain(1, 60), fpA = fpLv(lvsA);
      check(`1〜60 面のうち仕掛けの無い ${lvsA.length} 面（布を前倒しした 5〜7 面を除く）は v36 と同じ面（指紋 ${fpA}／f08fb003）`, lvsA.length === 47 && fpA === 'f08fb003', { n: lvsA.length, fpA });
      const lvsB = plain(61, 200), fpB = fpLv(lvsB);
      check(`61〜200 面のうち仕掛けの無い ${lvsB.length} 面は v42 の 10 色の面（指紋 ${fpB}／cca8d0a9）`, lvsB.length === 26 && fpB === 'cca8d0a9', { n: lvsB.length, fpB });
      // 保存 v:3：途中保存を replay すると、仕掛けの状態（cap・only・lock）も同じ局面
      const sv = [];
      for (const lv of [41, 71, 101, 104, 150]) {
        const { state: s0, info } = L.createLevel(lv);
        const cut = Math.ceil(info.solution.length / 2);
        let st = s0; for (const [a, b] of info.solution.slice(0, cut)) st = L.applyMove(st, a, b).state;
        const raw = L.makeSave(lv, info.solutionIds.slice(0, cut));
        const v = L.validateSave(raw), rp = v && L.replay(lv, v.moves);
        if (!(JSON.parse(raw).v === 3 && rp && rp.ok && J(rp.state) === J(st))) sv.push(lv);
      }
      check('保存の形は v:3 のまま。41・71・101・104・150 面の途中保存 → validateSave → replay で、仕掛けの状態も含めて同じ局面', sv.length === 0, sv);
      const l101 = L.createLevel(101), lk = l101.state.bottles.find((b) => b.lock !== null);
      const rb = L.replay(101, [[lk.id, l101.state.bottles.find((b) => b.cells.length === 0).id]]);
      check('かぎの びんから注ぐ手（id）を含む保存は replay で止まる（ok:false・applied 0。main.js はその面の最初から）', rb.ok === false && rb.applied === 0, rb.applied);
    },
  },
  {
    id: 'BL21', tier: 'smoke', node: true, title: 'いろびん IB-08：2 つの枠に同じ動物が並ばない（1〜600 面の解の道の 2 人いる局面すべて）・先に来た方（番号が小さい方）の動物は変わらない・2 引数の結果は v38 と同じ・3 番目の引数が壊れていても例外なし',
    run({ check, root }) {
      const L = load(root);
      const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
      let steps = 0; const dup = [], moved = [];
      for (let lv = 1; lv <= 600; lv++) {
        const { state, info } = L.createLevel(lv);
        const ord = [].concat(state.slots, state.queue).filter(Number.isInteger);
        const chk = (st) => {
          const [c0, c1] = st.slots;
          if (!Number.isInteger(c0) || !Number.isInteger(c1)) return;
          steps++;
          const i0 = ord.indexOf(c0), i1 = ord.indexOf(c1);
          const a0 = L.animalFor(lv, i0, i1), a1 = L.animalFor(lv, i1, i0);
          if (a0 === a1) dup.push(`${lv} 面 ${i0}・${i1}：${a0}`);
          const lo = Math.min(i0, i1);
          if ((i0 === lo ? a0 : a1) !== L.animalFor(lv, lo)) moved.push(`${lv} 面 ${lo}`);
        };
        let s = state;
        chk(s);
        for (const [f, t] of info.solution) { s = L.applyMove(s, f, t).state; if (!s.won) chk(s); }
      }
      check(`(a) 1〜600 面の解の道で 2 人いる ${steps} 局面のどれも、2 つの枠の動物が違う（同じ ${dup.length}）`, steps > 10000 && dup.length === 0, dup.slice(0, 8));
      check(`(b) 先に来た方（番号が小さい方）の動物は 2 引数のときと同じ（変わった ${moved.length}）`, moved.length === 0, moved.slice(0, 8));
      const a = [];
      for (let lv = 1; lv <= 50; lv++) for (let i = 0; i < 10; i++) a.push(L.animalFor(lv, i));
      const h = fnv(a.join(','));
      check(`(c) 2 引数の結果（1〜50 面×番号 0〜9 の 500 個）の指紋が v38 と同じ（${h}／0fab5405）`, h === '0fab5405', h);
      const fails = [];
      for (const o of [NaN, -1, 'x', {}, Symbol('s'), 1e12, Infinity, [], undefined, null]) {
        for (const i of [0, 3, 7]) {
          try { const k = L.animalFor(5, i, o); if (!L.ANIMAL_KEYS.includes(k)) fails.push(`${String(o)}→${String(k)}`); } catch (e) { fails.push(`${typeof o}: ${e}`); }
        }
      }
      check('(d) 3 番目が NaN・-1・"x"・{}・Symbol()・1e12 などでも例外なし・ANIMAL_KEYS のどれか', fails.length === 0, fails.slice(0, 8));
    },
  },
  {
    id: 'BL22', tier: 'smoke', node: true, title: 'いろびん IB-12：生成の上限 GEN_NODE_BUDGET が 100000・調べる局面が多い面（3792・494・100260 面）が v42 の面・局面の数が上限以内・fallback 0',
    run({ check, root }) {
      const L = load(root);
      const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
      check(`GEN_NODE_BUDGET が 100000（${L.GEN_NODE_BUDGET}）`, L.GEN_NODE_BUDGET === 100000, L.GEN_NODE_BUDGET);
      const lvs = [3792, 494, 100260];
      const cs = lvs.map((lv) => L.createLevel(lv));
      const h = fnv(cs.map((c) => JSON.stringify([c.state.bottles, c.state.slots, c.state.queue])).join('|'));
      const nodes = cs.map((c) => c.info.nodes), fb = cs.map((c) => c.info.fallback);
      check(`面の指紋が v42 の面（${h}／74b04ac3）`, h === '74b04ac3', h);
      check(`調べた局面の数が 57945・32767・45111（${nodes.join('・')}）で、どれも上限以内`, J(nodes) === J([57945, 32767, 45111]) && nodes.every((n) => n <= L.GEN_NODE_BUDGET), nodes);
      check(`fallback 0（${fb.join('・')}）`, fb.every((x) => x === 0), fb);
    },
  },
  {
    id: 'BL23', tier: 'smoke', node: true, title: 'いろびん IB-24 節目：MILESTONE_EVERY が 5・milestoneFor が 5 面ごとに節目・next が次の面・予告（news）が面の表と仕掛けの表どおり（2〜200 面）・壊れた値と大きな値でも例外なくすぐ返る・返す物が凍結',
    run({ check, root }) {
      const L = load(root);
      check(`MILESTONE_EVERY が 5（${L.MILESTONE_EVERY}）・milestoneFor が関数`, L.MILESTONE_EVERY === 5 && typeof L.milestoneFor === 'function', { every: L.MILESTONE_EVERY });
      // (b) 1〜200 面で milestone と next
      const mb = [];
      for (let n = 1; n <= 200; n++) { const m = L.milestoneFor(n); if (m.level !== n || m.milestone !== (n % 5 === 0) || m.next !== n + 1) mb.push({ n, m }); }
      check('1〜200 面：milestone は 5 の倍数の面だけ・next は次の面・level はその面', mb.length === 0, mb.slice(0, 6));
      // (c) 例（計画 v40 の M6）
      const ex = [
        [60, { at: 61, kind: 'colors' }, true],
        [5, { at: 6, kind: 'colors' }, true], [10, { at: 12, kind: 'hidden' }, true], [15, null, true], [20, { at: 25, kind: 'colors' }, true],
        [35, { at: 40, kind: 'hiddenAll' }, true], [40, { at: 41, kind: 'small' }, true], [70, { at: 71, kind: 'only' }, true],
        [100, { at: 101, kind: 'key' }, true], [105, null, false],
      ];
      const exBad = ex.map(([n, news, more]) => ({ n, want: { news, more }, got: L.milestoneFor(n) })).filter((x) => !(x.got.milestone === true && J(x.got.news) === J(x.want.news) && x.got.more === x.want.more));
      const m4 = L.milestoneFor(4);
      if (!(m4.milestone === false && m4.news === null)) exBad.push({ n: 4, got: m4 });
      check('例：5→6 面 colors、10→12 面 hidden、15→無し、20→25 面 colors、35→40 面 hiddenAll、40→41 面 small、60→61 面 colors、70→71 面 only、100→101 面 key、105→無し・more false、4→節目でない', exBad.length === 0, exBad);
      // (d) 予告が表とずれていない：2〜200 面で paramsFor から「初めて出るもの」を取り出し、節目ごとに次の 5 面の最初のものと比べる
      const ev = [];
      let hidFirst = 0, cloth = 0, small = 0, only = 0, key = 0;
      for (let m = 2; m <= 200; m++) {
        const p = L.paramsFor(m), q = L.paramsFor(m - 1);
        if (!cloth && p.cloths >= 1) { cloth = m; ev.push([m, 'cloth']); }
        if (p.colors > q.colors) ev.push([m, 'colors']);
        if (!hidFirst && p.hidden) { hidFirst = m; ev.push([m, 'hidden']); }
        if (!small && p.smalls >= 1) { small = m; ev.push([m, 'small']); }
        if (!only && p.onlys >= 1) { only = m; ev.push([m, 'only']); }
        if (!key && p.keys >= 1) { key = m; ev.push([m, 'key']); }
      }
      // hiddenAll＝隠れの面が続けて出て（前の面も隠れ）、そこから 200 面まで全部の面が隠れになる最初の面（"all" の行の 40 面。39 面は奇数面の隠れなので数えない）
      let hidAll = 0;
      for (let m = 200; m >= 3 && L.paramsFor(m).hidden && L.paramsFor(m - 1).hidden; m--) hidAll = m;
      if (hidAll) ev.push([hidAll, 'hiddenAll']);
      // 同じ面なら上の表の順（cloth → colors → hidden → hiddenAll → small → only → key）。NEWS の順と同じ
      const ord = ['cloth', 'colors', 'hidden', 'hiddenAll', 'small', 'only', 'key'];
      ev.sort((a, b) => a[0] - b[0] || ord.indexOf(a[1]) - ord.indexOf(b[1]));
      const nBad = [];
      for (let n = 5; n <= 195; n += 5) {
        const hit = ev.find(([at]) => n < at && at <= n + 5);
        const want = hit ? { at: hit[0], kind: hit[1] } : null;
        const got = L.milestoneFor(n).news;
        if (J(got) !== J(want)) nBad.push({ n, want, got });
      }
      const kinds = new Set(ev.map((e) => e[1]));
      check(`2〜200 面の表から取った「初めて出るもの」（${ev.map((e) => e.join(':')).join('・')}）と、5〜195 面の節目の予告が一致（7 種類すべてが出る）`, nBad.length === 0 && kinds.size === 7, nBad.slice(0, 6));
      // (e) 壊れた値・大きな値
      const t0 = Date.now(), eBad = [];
      for (const v of [NaN, -1, 'x', {}, Symbol(), 1e400, 9007199254740990, Number.MAX_SAFE_INTEGER]) {
        try { const m = L.milestoneFor(v); if (!(m && Number.isSafeInteger(m.level) && m.level >= 1 && typeof m.milestone === 'boolean')) eBad.push({ v: String(v), m }); }
        catch (e) { eBad.push({ v: String(v), err: String(e) }); }
      }
      const ms = Date.now() - t0;
      const big = L.milestoneFor(9007199254740990), mx = L.milestoneFor(Number.MAX_SAFE_INTEGER), bad1 = L.milestoneFor('x');
      check(`壊れた値（NaN・-1・'x'・{}・Symbol()・1e400）と大きな値で例外なし・合わせて ${ms}ms（50ms 以内）・壊れた値は 1 面・9007199254740990 は節目・MAX の next は MAX`,
        eBad.length === 0 && ms <= 50 && bad1.level === 1 && big.milestone === true && mx.next === Number.MAX_SAFE_INTEGER, { eBad, ms, big, mx });
      // (f) 凍結
      const f5 = L.milestoneFor(5);
      check('返す物と news が凍結されている', Object.isFrozen(f5) && Object.isFrozen(f5.news) && Object.isFrozen(L.milestoneFor(15)), null);
    },
  },
  {
    id: 'BL24', tier: 'smoke', node: true, title: 'いろびん IB-33 布を 5 面から：5 面は中身あり cover 1 の入門・6〜7 面は空き瓶の布・4 面は布なし・1〜4 面と 8〜60 面は v39 と同じ面（指紋 ceb50cdd）・5〜7 面の指紋 c5a4728b・5〜7 面は解けて布が全部取れる',
    run({ check, root }) {
      const L = load(root);
      const p4 = L.paramsFor(4), p5 = L.paramsFor(5), p6 = L.paramsFor(6), p7 = L.paramsFor(7);
      check('paramsFor：4 面は布 0、5 面は布 1・空き瓶 0・cover intro、6・7 面は布 1・空き瓶 1',
        p4.cloths === 0 && p5.cloths === 1 && p5.clothEmpty === 0 && p5.clothCover === 'intro' && [p6, p7].every((p) => p.cloths === 1 && p.clothEmpty === 1),
        { p4, p5, p6, p7 });
      const c5 = L.createLevel(5), c6 = L.createLevel(6), c7 = L.createLevel(7);
      const cov = (c) => c.state.bottles.filter((b) => b.cover !== null);
      const k5 = cov(c5), k67 = [...cov(c6), ...cov(c7)];
      check('5 面の布は 1 本で中身あり（4 段）・cover 1、6・7 面の布はどれも空き瓶',
        k5.length === 1 && k5[0].cells.length === L.CAP && k5[0].cover === 1 && cov(c6).length === 1 && cov(c7).length === 1 && k67.every((b) => b.cells.length === 0),
        { k5: k5.map((b) => [b.cells.length, b.cover]), k67: k67.map((b) => [b.cells.length, b.cover]) });
      const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
      const fpOf = (lvs) => fnv(lvs.map((lv) => { const s = L.createLevel(lv).state; return J([s.bottles, s.slots, s.queue]); }).join('\n'));
      const keep = []; for (let lv = 1; lv <= 60; lv++) if (lv < 5 || lv > 7) keep.push(lv);
      const fk = fpOf(keep), fn = fpOf([5, 6, 7]);
      check(`1〜4・8〜60 面は v39 と同じ面（指紋 ${fk}／ceb50cdd）、5〜7 面の指紋 ${fn}／c5a4728b`, fk === 'ceb50cdd' && fn === 'c5a4728b', { fk, fn });
      const bad = [];
      for (const [lv, c] of [[5, c5], [6, c6], [7, c7]]) {
        if (c.info.fallback !== 0) bad.push(`${lv}: fallback ${c.info.fallback}`);
        let st = c.state, unv = 0;
        for (const [f, t] of c.info.solution) { const r = L.applyMove(st, f, t); if (r.outcome.kind !== 'pour') { bad.push(`${lv}: 注げない手`); break; } unv += r.outcome.unveiled.length; st = r.state; }
        if (!st.won) bad.push(`${lv}: won にならない`);
        else if (st.bottles.some((b) => b.cover !== null) || unv !== cov(c).length) bad.push(`${lv}: 布が残った（取れた ${unv}）`);
      }
      check('5〜7 面：fallback 0・solution を再生すると won・布は全部取れる', bad.length === 0, bad);
    },
  },
  {
    id: 'BL25', tier: 'smoke', node: true, title: 'いろびん v42（IB-43）瓶を増やす：61 面から 10 色・瓶 12 本、むらさき（つき）、1〜60 面は v41 と同じ面、61〜69 面は仕掛けが軽い、61〜300 面が全部作れて解ける、60 面の節目の予告',
    run({ check, root }) {
      const L = load(root);
      const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
      // (a) 1〜60 面は v41 と同じ面（瓶・注文・枠・解の手）
      const parts = [];
      for (let lv = 1; lv <= 60; lv++) { const c = L.createLevel(lv); parts.push(J([c.state.bottles, c.state.slots, c.state.queue, c.info.solution])); }
      const fpA = fnv(parts.join('|'));
      check(`(a) 1〜60 面は v41 と同じ面（指紋 ${fpA}／df5616e7）`, fpA === 'df5616e7', fpA);
      // (b) むらさき
      check('(b) COLORS[9] がむらさき・つき、colorName(9) と colorName(10)',
        J(L.COLORS[9]) === J({ id: 9, key: 'purple', name: 'むらさき', hex: '#9933FF', mark: 'moon' }) && L.colorName(9) === 'むらさき' && L.colorName(10) === '？',
        { c9: L.COLORS[9], n9: L.colorName(9), n10: L.colorName(10) });
      // (c) paramsFor
      const cb = [];
      for (let lv = 1; lv <= 2000; lv++) { const p = L.paramsFor(lv); if (p.colors + p.empties > L.MAX_BOTTLES) cb.push(lv); }
      check('(c) paramsFor：60 面は 9 色・61 面と 2001 面は 10 色・1〜2000 面で 色＋空き ≦ MAX_BOTTLES',
        L.paramsFor(60).colors === 9 && L.paramsFor(61).colors === 10 && L.paramsFor(2001).colors === 10 && cb.length === 0,
        { c60: L.paramsFor(60).colors, c61: L.paramsFor(61).colors, c2001: L.paramsFor(2001).colors, cb: cb.slice(0, 5) });
      // (d) 61〜69 面の仕掛け
      const db = [];
      for (let lv = 61; lv <= 69; lv++) {
        const p = L.paramsFor(lv);
        const wantS = (lv === 61 || lv === 65 || lv === 69) ? 1 : 0;
        if (p.smalls !== wantS || p.onlys !== 0 || p.keys !== 0) db.push({ lv, smalls: p.smalls, onlys: p.onlys, keys: p.keys });
      }
      check('(d) 61〜69 面：ちいさい びんは 61・65・69 面だけ 1 本、ほかは 0、いろ きまり・かぎは 0', db.length === 0, db);
      // (e) 61〜300 面が全部作れて解ける
      const eb = [];
      let maxB = 0;
      for (let lv = 61; lv <= 300; lv++) {
        const c = L.createLevel(lv), s0 = c.state;
        if (c.info.fallback !== 0) eb.push(`${lv}: fallback ${c.info.fallback}`);
        if (s0.bottles.length !== 12) eb.push(`${lv}: 瓶が ${s0.bottles.length} 本`);
        maxB = Math.max(maxB, s0.bottles.length);
        const cnt = new Array(10).fill(0);
        for (const b of s0.bottles) for (const x of b.cells) cnt[x]++;
        if (cnt.some((n) => n !== 4)) eb.push(`${lv}: 色の段数 ${cnt.join(',')}`);
        if (!(c.info.nodes <= L.GEN_NODE_BUDGET)) eb.push(`${lv}: nodes ${c.info.nodes}`);
        let st = s0;
        for (const [f, t] of c.info.solution) { const r = L.applyMove(st, f, t); if (r.outcome.kind !== 'pour') { eb.push(`${lv}: 注げない手`); break; } st = r.state; }
        if (!st.won) eb.push(`${lv}: won にならない`);
        if (eb.length > 12) break;
      }
      check(`(e) 61〜300 面：fallback 0・最初の瓶が 12 本・色 0〜9 がちょうど 4 段ずつ（布の中も）・局面が上限以内・solution を再生すると won（最大 ${maxB} 本）`, eb.length === 0, eb.slice(0, 8));
      // (f) 60 面の節目の予告
      check('(f) milestoneFor(60).news が 61 面 colors', J(L.milestoneFor(60).news) === J({ at: 61, kind: 'colors' }), L.milestoneFor(60));
    },
  },
  {
    id: 'BL20', tier: 'full', node: true, title: 'いろびん v37 難しさ：わな手の割合（その手で解けなくなる手の割合）が 40〜49・50〜69・70〜99・100〜149・150〜200 面の帯ごとに段々に上がり、どの帯も仕掛けを入れる前より下がらない',
    run({ check, root }) {
      const L = load(root);
      const bands = [[40, 49], [50, 69], [70, 99], [100, 149], [150, 200]];
      // わな手の割合：解の道の各局面で、合法な手のうち「その手を打つと、もう解けない」とソルバー（3000 局面まで）が言い切れた手の割合
      const trapOf = (c) => {
        let st = c.state, doomed = 0, tot = 0;
        for (const [a, b] of c.info.solution) {
          for (const [x, y] of L.legalMoves(st)) { const r = L.solve(L.applyMove(st, x, y).state, { nodeLimit: 3000 }); tot++; if (!r.solved && !r.exhausted) doomed++; }
          st = L.applyMove(st, a, b).state;
        }
        return tot ? doomed / tot : 0;
      };
      const rows = bands.map(([f, t]) => {
        let now = 0, before = 0, n = 0, gim = 0;
        for (let lv = f; lv <= t; lv++) {
          const p = L.paramsFor(lv);
          now += trapOf(L.createLevel(lv));
          // 仕掛けを入れる前の面（同じ面番号・仕掛けだけ 0。仕掛けの無い面は乱数の使い方が同じなので前の面と同じ）
          before += p.smalls + p.onlys + p.keys ? trapOf(L.createLevel(lv, { params: Object.assign({}, p, { smalls: 0, onlys: 0, keys: 0 }) })) : trapOf(L.createLevel(lv));
          if (p.smalls + p.onlys + p.keys) gim++;
          n++;
        }
        return { band: `${f}-${t}`, now: +(100 * now / n).toFixed(1), before: +(100 * before / n).toFixed(1), gim, n };
      });
      const up = rows.every((r, i) => i === 0 || r.now >= rows[i - 1].now + 0.5);
      check(`わな手の割合が帯ごとに上がる（前の帯より 0.5 ポイント以上）：${rows.map((r) => `${r.band} ${r.now}%`).join('・')}`, up, rows);
      check(`どの帯も仕掛けを入れる前より下がらない（前→後：${rows.map((r) => `${r.before}→${r.now}`).join('・')}）`, rows.every((r) => r.now >= r.before), rows);
      check(`150〜200 面は 40〜49 面より 3 ポイント以上 難しい（${rows[0].now}→${rows[4].now}）`, rows[4].now >= rows[0].now + 3, null);
    },
  },
  {
    id: 'BL26', tier: 'smoke', node: true, title: 'いろびん v45（IB-34）なかよしちょう：読む（無い・壊れた・新しい版・使える分だけ）、0 から数える、足す（数・段・星と手数は良い方・count false）、書いて読み直すと同じ',
    run({ check, root }) {
      const L = load(root);
      const empty = { v: 1, a: {}, s: {}, last: 0 };
      // (a) 無い → 0 から（2 つ目の引数を見ない）
      const ra = [L.readBook(null), L.readBook(undefined), L.readBook(null, 999)];
      check('(a) readBook(null)・(undefined)・(null, 999) が空の帳面で write true（fresh なし。古い best から数を作らない）',
        ra.every((r) => J(r) === J({ book: empty, write: true })), ra);
      // (b) 壊れた 8 種
      const bads = ['{', '[]', 'null', '"x"', '{"v":"1"}', '{"v":0}', '{"v":1.5}', '{"a":{}}'];
      const rb = bads.filter((x) => J(L.readBook(x)) !== J({ book: empty, write: true }));
      check('(b) 壊れた 8 種は空の帳面で write true', rb.length === 0, rb);
      // (c) 新しい版
      const rc = L.readBook('{"v":2,"a":{"kuma":50}}');
      check('(c) v:2 は write false で a が空', rc.write === false && J(rc.book.a) === '{}', rc);
      // (d) 使える分だけ
      const rd = L.readBook('{"v":1,"a":{"kuma":-5,"neko":1.5,"dog":3,"usagi":12,"risu":2e9},"s":{"0":[3,5],"x":[1,1],"7":[4,9],"8":[2,10],"9":[1,0],"010":[1,3]},"last":-1}');
      check('(d) 使える分だけ：a は usagi 12 だけ・s は 8 面 [2,10] だけ・last 0・write true',
        J(rd.book.a) === J({ usagi: 12 }) && J(rd.book.s) === J({ 8: [2, 10] }) && rd.book.last === 0 && rd.write === true, rd);
      // (e) addClear
      const be = { v: 1, a: { kuma: 9 }, s: { 3: [2, 20] }, last: 0 };
      const snap = J(be);
      const e1 = L.addClear(be, { level: 3, animals: ['kuma'], star: 3, moves: 25, count: true });
      const e2 = L.addClear(e1.book, { level: 3, animals: ['kuma'], star: 1, moves: 15 });
      const upsAt = (before, after) => L.addClear({ v: 1, a: { kuma: before }, s: {}, last: 0 }, { level: 1, animals: ['kuma'], star: 1, moves: 5 }).ups;
      const ok1 = J(e1.ups) === J([{ kind: 'kuma', step: 1 }]) && e1.book.a.kuma === 10 && e1.book.last === 3 && J(e1.book.s['3']) === J([3, 20]);
      const ok2 = e2.ups.length === 0 && e2.book.a.kuma === 11 && J(e2.book.s['3']) === J([3, 15]);
      const ok3 = J(upsAt(49)) === J([{ kind: 'kuma', step: 2 }]) && J(upsAt(199)) === J([{ kind: 'kuma', step: 3 }]) && upsAt(200).length === 0;
      const e4 = L.addClear({ v: 1, a: { kuma: 5 }, s: {}, last: 1 }, { level: 9, animals: ['kuma'], star: 2, moves: 8, count: false });
      const ok4 = e4.book.a.kuma === 5 && e4.book.last === 1 && e4.ups.length === 0 && J(e4.book.s['9']) === J([2, 8]);
      const e5 = L.addClear({ v: 1, a: {}, s: { 3: [2, 20] }, last: 0 }, { level: 3, animals: [], star: 1, moves: 15 });
      const e6 = L.addClear({ v: 1, a: {}, s: {}, last: 0 }, { level: 4, animals: [], star: 0, moves: 10 });
      const ok5 = J(e5.book.s['3']) === J([2, 15]) && J(e6.book.s) === '{}';
      check('(e) addClear：10 人目で step 1・11 人目は ups なし・49→50 で 2・199→200 で 3・200→201 なし・count:false は数も last も変えない・星と手数は良い方・star 0 は書かない・元は変わらない',
        ok1 && ok2 && ok3 && ok4 && ok5 && J(be) === snap, { e1, e2, ok3, e4, e5, e6, snapSame: J(be) === snap });
      // (f) bookStep・nextStepAt
      const stp = [[9, 0], [10, 1], [49, 1], [50, 2], [199, 2], [200, 3], [1e9, 3], ['abc', 0]].filter(([n, w]) => L.bookStep(n) !== w);
      const nxt = [[0, 10], [10, 50], [50, 200], [200, 0]].filter(([n, w]) => L.nextStepAt(n) !== w);
      check('(f) bookStep・nextStepAt・BOOK_STEPS が [10,50,200]', stp.length === 0 && nxt.length === 0 && J(L.BOOK_STEPS) === '[10,50,200]', { stp, nxt, steps: L.BOOK_STEPS });
      // (g) 書いて読む
      const bg = { v: 1, a: { kuma: 3, hitsuji: 200 }, s: { 1: [3, 6], 12: [1, 40] }, last: 12 };
      const rg = L.readBook(L.makeBook(bg));
      check('(g) makeBook で書いて readBook で読むと a・s・last が同じ', rg.write === true && J(rg.book) === J(bg), rg);
      // (h) bookStars
      check('(h) bookStars：s が {1:[3,6],2:[1,9]} で 4・空は 0', L.bookStars({ s: { 1: [3, 6], 2: [1, 9] } }) === 4 && L.bookStars(empty) === 0 && L.bookStars(null) === 0, null);
    },
  },
];
