// BL: いろびんの計算ロジック（Node で games/irobin/logic.js を直接読む。ブラウザ不要）
//   契約は docs/irobin-contract.md（§3 定数・面の表、§4 ロジックの API、§12.2 BL の項目）。
//   局面は契約 §4.1 の形を手で組む（mk）。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・IrobinLogic を公開していなければ例外で不合格にする。
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

function load(root) {
  const f = path.join(root, 'games/irobin/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/irobin/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.createLevel !== 'function' || typeof L.applyMove !== 'function') throw new Error('logic.js が IrobinLogic を module.exports していない');
  return L;
}

// ---- 局面を手で組む ----
// 瓶の指定：色の配列（下→上）。{ c: [...], h: [true,...], sealed: true } で隠れ・栓も指定できる
const B = (spec) => {
  const o = Array.isArray(spec) ? { c: spec } : spec;
  return { cells: [...o.c], hidden: o.h ? [...o.h] : o.c.map(() => false), sealed: !!o.sealed };
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
        T(1, 2, 1, false, 'easy'), T(2, 3, 2, false, 'easy'), T(3, 4, 2, false, 'easy'), T(4, 5, 2, false, 'easy'), T(5, 5, 2, false, 'easy'),
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
      const bBad = broken.filter((v) => { let p; try { p = L.paramsFor(v); } catch { return true; } return !(p && p.colors === 2 && p.empties === 1 && p.hidden === false && p.order === 'easy'); })
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
    id: 'BL3', tier: 'smoke', node: true, title: 'いろびん：そろう・届ける・空の瓶への置き換え・待ち瓶が場所をふさぐ・お客さんが来たら自動で届く（連鎖の順）・全部届けて won',
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
      check('色 1 がそろって sealed 2、deliveries は [瓶 2 → 枠 0 の色 1, 瓶 0 → 枠 0 の色 0] の順（連鎖）',
        o.sealed === 2 && J(o.deliveries) === J([{ bottle: 2, slot: 0, color: 1 }, { bottle: 0, slot: 0, color: 0 }]), o.deliveries);
      check('arrivals は届けるたびに 1 件（枠 0 に色 0、次に列が尽きて color null）、起きた順', J(o.arrivals) === J([{ slot: 0, color: 0 }, { slot: 0, color: null }]), o.arrivals);
      s = r.state;
      check('届けた瓶は同じ場所の空の瓶に置き換わる（本数は変わらない・sealed でない）', s.bottles.length === 6 && [0, 2].every((i) => s.bottles[i].cells.length === 0 && !s.bottles[i].sealed && s.bottles[i].hidden.length === 0), s.bottles);
      check('served 2・slots [null,2]・queue []・まだ won でない', s.served === 2 && J(s.slots) === '[null,2]' && s.queue.length === 0 && s.won === false && o.won === false, { served: s.served, slots: s.slots });
      check('hud：left は total − served（1）', J(L.hud(s)) === J({ level: 1, served: 2, total: 3, left: 1, moves: s.moves }), L.hud(s));
      // 3) 最後の色 2 → 全部届けて won
      r = L.applyMove(s, 5, 4);
      check('最後の色 2 で deliveries 1 件・arrivals は枠 1 に null・won・served 3', J(r.outcome.deliveries) === J([{ bottle: 4, slot: 1, color: 2 }]) && J(r.outcome.arrivals) === J([{ slot: 1, color: null }]) && r.outcome.won === true && r.state.won === true && r.state.served === 3 && r.outcome.stuck === false, r.outcome);
      // 4) 見えているお客さんにいる色は、そろった瞬間に届く。置き換えた枠には queue の先頭が来る
      const t = mk([[1, 1, 1], [1], []], { slots: [1, 0], queue: [] });
      const r4 = L.applyMove(t, 1, 0);
      check('一致するお客さんがいれば、そろった瞬間に届く（待ち瓶ではない）', J(r4.outcome.deliveries) === J([{ bottle: 0, slot: 0, color: 1 }]) && r4.state.bottles[0].cells.length === 0, r4.outcome);
      // 5) 同時に候補があるときは、枠は左から・瓶は番号の小さい方から
      let u = mk([{ c: [3, 3, 3, 3], sealed: true }, { c: [4, 4, 4, 4], sealed: true }, [5, 5, 5], [5], []], { slots: [5, 7], queue: [4, 3], total: 4 });
      // お客さんに 4,3 はまだいない（列の中）。5 が届くと枠 0 に 4 が来て、瓶 1 が自動で届く → 枠 0 に 3 が来て瓶 0 が届く
      u = { ...u, slots: [5, 7] };
      const r5 = L.applyMove(u, 3, 2);
      check('連鎖は「届ける → 来る → 合う待ち瓶を届ける」を繰り返す（色 4 の瓶 1 → 色 3 の瓶 0 の順）', J(r5.outcome.deliveries.map((d) => [d.bottle, d.color])) === '[[2,5],[1,4],[0,3]]', r5.outcome.deliveries);
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
      const t0 = Date.now();
      const first = levels.map((lv) => L.createLevel(lv));
      const ms = Date.now() - t0;
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
        if (info.fallback === 0 && s.bottles.length !== p.colors + p.empties) bad.push(`${lv}: 瓶の本数 ${s.bottles.length}`);
        if (s.bottles.some((b) => b.cells.length === 4 && new Set(b.cells).size === 1)) bad.push(`${lv}: 最初からそろった瓶がある`);
        if (s.bottles.some((b) => b.sealed)) bad.push(`${lv}: 最初から栓をした瓶がある`);
        if (s.bottles.some((b) => b.cells.length && b.hidden[b.cells.length - 1])) bad.push(`${lv}: 一番上が隠れている`);
        if (info.fallback === 0 && p.hidden && !s.bottles.every((b) => b.hidden.every((h, k) => h === (k < b.cells.length - 1)))) bad.push(`${lv}: 隠れの面で一番上以外が隠れていない`);
        if (!p.hidden && info.fallback < 2 && s.bottles.some((b) => b.hidden.some(Boolean))) bad.push(`${lv}: 隠れの面でないのに隠れがある`);
        if (s.total !== kinds.length || s.served !== 0 || s.moves !== 0 || s.won !== false || s.slots.length !== L.ORDER_SLOTS) bad.push(`${lv}: 始めの値`);
        const orders = [...s.slots.filter((x) => x !== null), ...s.queue];
        if (orders.length !== kinds.length || new Set(orders).size !== kinds.length || !orders.every((c) => cnt[c] === 4)) bad.push(`${lv}: 注文が各色1つずつでない ${J(orders)}`);
        const rp = L.replay(lv, info.solution);
        if (!(rp.ok && rp.state.won)) bad.push(`${lv}: solution を再生しても won にならない（ok ${rp.ok}、applied ${rp.applied}/${(info.solution || []).length}）`);
        if (!(info.nodes <= L.GEN_NODE_BUDGET * 1.5)) bad.push(`${lv}: nodes ${info.nodes}`);
      }
      check(`${levels.length} 面（1〜60・1000）：決定的・各色4段・最初からそろった瓶なし・隠れの形・注文が各色1つ・solution を再生すると won`, bad.length === 0, bad.slice(0, 8));
      check(`1〜60 面と 1000 面の生成が合計 3 秒以内（${ms}ms。目安 iPhone SE 相当で 1 面 300ms 以内）`, ms <= 3000, ms);
      check(`表のとおりに作れた面（fallback 0）が 8 割以上（0:${fb[0]} 1:${fb[1]} 2:${fb[2]}）`, fb[0] >= levels.length * 0.8, fb);
      const l1 = first[0].state;
      check('1 面は瓶 3 本（色 2＋空き 1）・隠れなし（遊び方を覚える面）', l1.bottles.length === 3 && !l1.bottles.some((b) => b.hidden.some(Boolean)), l1.bottles.length);
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
    id: 'BL6', tier: 'smoke', node: true, title: 'いろびん：ソルバー（解けない盤は solved:false・注文の順のせいで解けない盤を判定・anyOrder では解ける・上限で exhausted）',
    run({ check, root }) {
      const L = load(root);
      // 解けない：空きがなく、どの一番上も合わない
      const dead = mk([[0, 1, 0, 1], [1, 0, 1, 0]], { slots: [0, 1], queue: [], total: 2, params: { colors: 2, empties: 0, hidden: false, order: 'random' } });
      const d = L.solve(dead);
      check('動かせる手が無い盤は solved:false・exhausted:false・moves null', d.solved === false && d.exhausted === false && d.moves === null, d);
      // 注文の順で解けない：色 2 が先にそろって待ち瓶になり、場所をふさぐ（注文なしなら解ける）
      const blocked = mk([[2, 2, 2], [2], [0, 1, 1, 0], [0, 1, 1, 0]], { slots: [0, 1], queue: [2] });
      const o = L.solve(blocked), a = L.solve(blocked, { anyOrder: true });
      check('待ち瓶が場所をふさいで解けない盤を solved:false と判定（exhausted は false＝調べ尽くした）', o.solved === false && o.exhausted === false, o);
      check('同じ盤を anyOrder で解くと solved:true（注文を気にしない解き方は存在する）', a.solved === true && Array.isArray(a.moves) && a.moves.length > 0, a);
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
      check('makeSave は JSON 文字列 { v:1, level, moves }', typeof good === 'string' && J(JSON.parse(good)) === J({ v: 1, level: 5, moves: [[0, 1], [2, 3]] }), good);
      check('validateSave：makeSave した文字列は { level, moves } に戻る', J(L.validateSave(good)) === J({ level: 5, moves: [[0, 1], [2, 3]] }), L.validateSave(good));
      const sv = (x) => L.validateSave(typeof x === 'string' ? x : J(x));
      const bad = [
        ['壊れた JSON', '{not json'], ['空文字', ''], ['null', null], ['配列', '[]'], ['v が無い', { level: 1, moves: [] }], ['v が 2', { v: 2, level: 1, moves: [] }], ['v が文字', { v: '1', level: 1, moves: [] }],
        ['level 0', { v: 1, level: 0, moves: [] }], ['level 負', { v: 1, level: -1, moves: [] }], ['level 小数', { v: 1, level: 1.5, moves: [] }], ['level 文字', { v: 1, level: '3', moves: [] }],
        ['level 2^53', { v: 1, level: 9007199254740992, moves: [] }], ['moves が無い', { v: 1, level: 1 }], ['moves が配列でない', { v: 1, level: 1, moves: 'x' }],
        ['手が1要素', { v: 1, level: 1, moves: [[0]] }], ['手が3要素', { v: 1, level: 1, moves: [[0, 1, 2]] }], ['手が小数', { v: 1, level: 1, moves: [[0, 1.5]] }], ['手が文字', { v: 1, level: 1, moves: [['0', '1']] }], ['手が null', { v: 1, level: 1, moves: [null] }], ['手が数', { v: 1, level: 1, moves: [3] }],
        ['長すぎ', { v: 1, level: 1, moves: Array.from({ length: L.MAX_MOVES_SAVED + 1 }, () => [0, 1]) }],
      ].filter(([, x]) => sv(x) !== null).map(([n]) => n);
      check('validateSave：壊れた JSON・v 違い・level 0/負/小数/文字・moves が配列でない/手の形違い/長すぎ はすべて null', bad.length === 0, bad);
      check('validateSave：手が MAX_MOVES_SAVED ちょうどは通る、空の手でも通る', sv({ v: 1, level: 1, moves: Array.from({ length: L.MAX_MOVES_SAVED }, () => [0, 1]) }) !== null && sv({ v: 1, level: 12, moves: [] }) !== null, null);
      // replay
      const r0 = L.replay(2, []);
      check('replay：手が無ければ createLevel と同じ局面、ok:true・applied 0', r0.ok === true && r0.applied === 0 && J(r0.state) === J(L.createLevel(2).state), r0.applied);
      const sol = L.createLevel(3).info.solution;
      const rAll = L.replay(3, sol);
      check('replay：solution を全部当てると ok:true・applied が手の数・won', rAll.ok === true && rAll.applied === sol.length && rAll.state.won === true, { ok: rAll.ok, applied: rAll.applied, n: sol.length });
      const rBad = L.replay(3, [sol[0], [0, 0], sol[1]]);
      check('replay：注げない手（同じ瓶）で止まり ok:false・applied 1（そこまでの状態を返す）', rBad.ok === false && rBad.applied === 1 && rBad.state && rBad.state.moves === 1, { ok: rBad.ok, applied: rBad.applied });
      const rOver = L.replay(3, [[0, 99]]);
      check('replay：範囲外の番号でも例外なし・ok:false・applied 0', rOver.ok === false && rOver.applied === 0, rOver);
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
      const need = ['pick', 'drop', 'pour', 'reveal', 'seal', 'cork', 'deliver', 'arrive', 'clear', 'deny', 'undo', 'stuck', 'start', 'best', 'toggle'];
      check(`"irobin" の効果音の表に契約 §9 の音名がすべてある（${names.length} 個）`, need.every((n) => names.includes(n)), need.filter((n) => !names.includes(n)));
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
];
