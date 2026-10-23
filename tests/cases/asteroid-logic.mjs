// KL: ちきゅうを守れ！ほしくだき の計算ロジック（Node で games/asteroid/logic.js を直接読む。ブラウザ不要）
//   契約は docs/asteroid-contract.md（正とする順は §20 → §21 → §1〜§19。§3 数値、§4 API、§8 保存、§11.2 KL の項目、§21.2・§21.5）。
//   作り直し（2026-10-23）：細かいマス（CELL 7・GRID_MAX 48）・砲台・斜めの弾・ビームの穴・いなずまの枝分かれ・ひかえと入れ替え・保存 v:2。
//   局面は newGame / loadSave で作り、小惑星のマス（rock）だけを手で組み直して当たりを調べる。
//   無いときに合格にしない：logic.js が無い・AsteroidLogic を公開していなければ例外で不合格にする。
//   空振りにしない：調べるマス・出来事が 0 個のときは「あること」も確かめる。
//   重い自動プレイ（星30 まで・何本も）はテストの外（§3.10 の測った値）。ここでは軽い版を回す。
//   単体でも流せる：node tests/cases/asteroid-logic.mjs [ID...]（最後の「単体で流す」を参照）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function load(root) {
  const f = path.join(root, 'games/asteroid/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/asteroid/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.step !== 'function' || typeof L.simulate !== 'function') throw new Error('logic.js が AsteroidLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const CODE = { r: 1, i: 2, c: 3, g: 4 };   // r=いわ i=てつ c=こおり g=きん
const MATN = ['', 'rock', 'iron', 'ice', 'gold'];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const DEG = Math.PI / 180;
const ALL = ['shot', 'spread', 'bomb', 'bolt', 'beam', 'fire'];

// 保存の形（v:2）から局面を作る（loadSave を通す）
function mk(L, o = {}) {
  const raw = { v: 2, star: 1, kakera: 0, kfrac: 0, slots: [{ id: 'shot', lv: 1 }], bench: [], offer: null, swap: [], cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0 }, seed: 7, rng: 12345, ...o };
  const s = L.loadSave(JSON.stringify(raw));
  if (!s) throw new Error('mk: loadSave が null');
  return s;
}
// 小惑星を絵で組む（rows の文字列。'.'＝空）。hp は opts.hp（数か関数）か、その星の体力。x は左端の x、bottom は一番下の行の下端の y。
// opts.only を決めると、その番号の砲台だけが撃つ（ほかは cd を遠くへ）
function setRock(L, s, rows, opts = {}) {
  const R = rows.length, C = rows[0].length;
  const mats = [], hp = [];
  let value = 0, n = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = rows[r][c];
    const m = CODE[ch] || 0;
    mats.push(m);
    const i = r * C + c;
    const h = !m ? 0 : typeof opts.hp === 'function' ? opts.hp(i, ch) : typeof opts.hp === 'number' ? opts.hp : L.cellHp(s.star, MATN[m]);
    hp.push(h);
    if (m) { n++; value += L.cellValue(s.star, MATN[m]); }
  }
  const x = opts.x !== undefined ? opts.x : (L.FIELD_W - C * L.CELL) / 2;
  const bottom = opts.bottom !== undefined ? opts.bottom : 250;
  const rock = { ...s.rock, cols: C, rows: R, x, y: bottom - R * L.CELL, vy: opts.vy !== undefined ? opts.vy : 0, mats, hp, total: n, left: n, value, bottom0: bottom, rowHp: new Array(R).fill(1), scan: null };
  return { ...s, rock, shots: [], burns: [], cd: s.slots.map((_, k) => (opts.only === undefined || opts.only === k ? 0 : 1e9)) };
}
function run(L, s, sec, dt) {
  dt = dt || L.STEP;
  const evs = [];
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) { const r = L.step(s, dt); if (!r) throw new Error('step が null'); s = r.state; for (const e of r.events) evs.push(e); }
  return { s, evs };
}
function until(L, s, pred, sec) {
  const evs = [];
  const n = Math.round(sec / L.STEP);
  for (let i = 0; i < n; i++) {
    const r = L.step(s, L.STEP); s = r.state;
    for (const e of r.events) evs.push(e);
    if (r.events.some(pred)) return { s, evs, hit: true };
  }
  return { s, evs, hit: false };
}
const ofKind = (evs, k) => evs.filter((e) => e.kind === k);
const intIn = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }
function cellsOf(s) { const a = []; s.rock.mats.forEach((m, i) => { if (m) a.push(i); }); return a; }
const cx = (L, R, i) => R.x + ((i % R.cols) + 0.5) * L.CELL;
const cy = (L, R, i) => R.y + (Math.floor(i / R.cols) + 0.5) * L.CELL;
// k 番の砲台から一番近いマス（同じ距離なら左）
function nearestTo(L, s, cells, k = 0) {
  const T = L.turretsOf(s.slots.length)[k];
  let best = -1, bd = Infinity, bx = Infinity;
  for (const i of cells) { const x = cx(L, s.rock, i), y = cy(L, s.rock, i); const d = (x - T.x) ** 2 + (y - T.y) ** 2; if (d < bd || (d === bd && x < bx)) { bd = d; best = i; bx = x; } }
  return best;
}
// 一番下の行の 1 マスだけ残す（体力わずか）。砲台はそのマスを撃つ
function lastCell(L, s) {
  const keep = cellsOf(s).reduce((a, i) => (Math.floor(i / s.rock.cols) >= Math.floor(a / s.rock.cols) ? i : a), cellsOf(s)[0]);
  return { ...s, rock: { ...s.rock, mats: s.rock.mats.map((m, i) => (i === keep ? m : 0)), hp: s.rock.hp.map((h, i) => (i === keep ? 0.001 : 0)), left: 1, scan: null } };
}
// 鉄のかたまり（上下左右でつながった てつ）の大きさの一覧
function ironBlobs(R) {
  const seen = new Set(), out = [];
  for (let i = 0; i < R.mats.length; i++) {
    if (R.mats[i] !== 2 || seen.has(i)) continue;
    let n = 0; const st = [i]; seen.add(i);
    while (st.length) { const j = st.pop(); n++; const c = j % R.cols; for (const q of [c > 0 ? j - 1 : -1, c < R.cols - 1 ? j + 1 : -1, j - R.cols, j + R.cols]) if (q >= 0 && q < R.mats.length && R.mats[q] === 2 && !seen.has(q)) { seen.add(q); st.push(q); } }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}
const angOf = (b) => Math.atan2(b.vx, -b.vy);

export const tests = [
  {
    id: 'KL1', tier: 'smoke', node: true, title: 'ほしくだき：定数と表（§3・§4.2。CELL 7・GRID_MAX 48・SAVE_VERSION 2・SLOT_COST 長さ 6・しんか・FIGHTER_Y なし）、hpMul・valMul・cellValue（÷4）・dmg・upCost・相性、桁あふれ',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'ちきゅうを守れ！ほしくだき', FIELD_W: 360, FIELD_H: 560, BARRIER_Y: 470, TURRET_Y: 500, ARC_SAG: 12, CELL: 7, GRID_MAX: 48, LEVEL_MAX: 99, SLOTS_MAX: 4,
        BARREL: 14, BOLT_CELLS: 16, BEAM_W: 2, BEAM_DEPTH: 20,
        CLEAR_BONUS: 0.2, ENDING_STAR: 30, STAR_MAX: 9999, STAR_CALC_MAX: 400, KAKERA_MAX: 9e15, SHOTS_MAX: 120, STEP: 1 / 30,
        SAVE_VERSION: 2, SAVE_KEY: 'asteroid.save', SAVE_KEY_BAK: 'asteroid.save.bak', SAVE_KEY_BEST: 'asteroid.best', SAVE_KEY_HELP: 'asteroid.help' };
      const bad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §4.2・§21.2 のとおり（NAME はユーザーの書いたとおり）', bad.length === 0, bad);
      check('戦闘機の定数 FIGHTER_Y が無い（砲台に替わった。§20）', !('FIGHTER_Y' in L) && !('FIGHTER_SPEED' in L), Object.keys(L).filter((k) => /FIGHTER/.test(k)));
      check('砲台の角度（ラジアン）：AIM_MAX 60°・TURN_SPEED 360°/秒・AIM_TOL 4°', near(L.AIM_MAX, 60 * DEG, 1e-12) && near(L.TURN_SPEED, 360 * DEG, 1e-12) && near(L.AIM_TOL, 4 * DEG, 1e-12), [L.AIM_MAX, L.TURN_SPEED, L.AIM_TOL]);
      check('増え方の定数（HP_BASE 180（作り直しで 1/4 前後）・HP_GROWTH 1.252・VALUE_GROWTH 2.35・UP_GROWTH 1.35、星 30 より先は 1.0・1.03）、かけらは ÷4', L.HP_BASE === 180 && L.HP_GROWTH === 1.252 && L.VALUE_GROWTH === 2.35 && L.UP_GROWTH === 1.35 && L.HP_GROWTH2 === 1.0 && L.VALUE_GROWTH2 === 1.03 && L.VALUE_DIV === 4, [L.HP_BASE, L.HP_GROWTH, L.VALUE_GROWTH, L.UP_GROWTH, L.HP_GROWTH2, L.VALUE_GROWTH2, L.VALUE_DIV]);
      check('UP_COST（たま 5・ちらし 5・どかん 34・いなずま 5・ビーム 8・ほのお 4）・SLOT_COST は n 個目の武器の値段で長さ 6（[null, 40, 300, 2000, 80まん, 20おく]）', J(L.UP_COST) === J({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 }) && J(L.SLOT_COST) === J([null, 40, 300, 2000, 800000, 2e9]), [L.UP_COST, L.SLOT_COST]);
      check('SLOT_COST は増えていく', L.SLOT_COST.length === 6 && L.SLOT_COST[0] === null && L.SLOT_COST.slice(1).every((v, k, a) => v > 0 && (k === 0 || v > a[k - 1])), L.SLOT_COST);
      check('区切りのおまけ・ベスト・もろい底（§18.1）はそのまま', L.MILESTONE_BONUS === 0.03 && J(L.MILESTONES) === J([25, 50, 75]) && L.BEST_MAX === 200 && J(L.SOFT) === J({ q: 0.2, mul: 0.05, ramp: 0.15 }), [L.MILESTONE_BONUS, L.SOFT]);
      check('EARLY_HP・大きな星（+4 マス・重さ 1.3 倍）・大きさ（星 1 で 20 マス・1 星 0.96 マス）・近づく速さの目安・混ざり方', J(L.EARLY_HP) === J([0.015, 0.056, 0.08, 0.27, 0.35, 0.39, 0.58, 0.82, 0.9]) && L.BOSS_GROW === 4 && L.BOSS_HARD === 1.3 && L.SIZE_BASE === 20 && L.SIZE_STEP === 0.96 &&
        L.APPROACH.first === 135 && L.APPROACH.normal === 240 && L.APPROACH.boss === 300 && L.APPROACH.keep === 0.33 && J(L.MIX) === J({ iron: [0.25, 0.35], ice: 0.15, tilt: 0.08 }), [L.EARLY_HP, L.APPROACH, L.MIX]);
      check('マスは いわ・てつ・こおり・きん（コード 1〜4）、硬さ 1・4・2・2、かけら 1・4・2・10', J(L.MATS.map((m) => [m.id, m.code, m.name])) === J([['rock', 1, 'いわ'], ['iron', 2, 'てつ'], ['ice', 3, 'こおり'], ['gold', 4, 'きん']]) && J(L.MAT_HP) === J({ rock: 1, iron: 4, ice: 2, gold: 2 }) && J(L.MAT_VALUE) === J({ rock: 1, iron: 4, ice: 2, gold: 10 }), [L.MATS, L.MAT_HP, L.MAT_VALUE]);
      check('武器（作り直し：面で当たる どかん・いなずま・ビームは強さ約 1/4。ちらし 1.25・いなずま 0.65 は自動プレイで直した値）', J(L.WEAPONS.map((w) => [w.id, w.name, w.dmg, w.rate])) === J([['shot', 'たま', 1, 0.2], ['spread', 'ちらし', 1.25, 0.6], ['bomb', 'どかん', 0.75, 1.6], ['bolt', 'いなずま', 0.65, 1.2], ['beam', 'ビーム', 0.375, 2], ['fire', 'ほのお', 3, 1]]), L.WEAPONS.map((w) => [w.id, w.dmg, w.rate]));
      const aff = { spread: { rock: 2, iron: 0.9, ice: 1, gold: 1 }, bomb: { rock: 1, iron: 1, ice: 2, gold: 1 }, bolt: { rock: 1, iron: 2.2, ice: 0.5, gold: 1 }, beam: { rock: 1, iron: 1.8, ice: 1, gold: 1 }, fire: { rock: 1, iron: 0.75, ice: 3, gold: 1 }, shot: { rock: 1, iron: 1, ice: 1, gold: 1 } };
      const affBad = [];
      for (const w in aff) for (const m in aff[w]) if (L.affOf(w, m) !== aff[w][m]) affBad.push([w, m, L.affOf(w, m)]);
      check('相性の倍率が §3.3 の表どおり（ない所は 1）、どれも 0.5〜3 倍', affBad.length === 0 && L.WEAPONS.every((w) => L.MATS.every((m) => L.affOf(w.id, m.id) >= 0.5 && L.affOf(w.id, m.id) <= 3)), affBad);
      check('得意なマス：ちらし＝いわ、どかん・ほのお＝こおり、いなずま・ビーム＝てつ、たま＝なし', J(L.WEAPONS.map((w) => w.good)) === J([null, 'rock', 'ice', 'iron', 'iron', 'ice']), null);
      // 式：hpMul(n) = 増え方 × EARLY_HP × adj、valMul(n) = 増え方 × adj。adj = (なめらかな直径² × 0.86) ÷ (列 × 行) × (大きな星 1.3) × (傾きのならし)
      const adjOf = (n) => {
        const info = L.starInfo(n), k = Math.min(n, 40), sm = Math.min(48, 20 + (k - 1) * 0.96);
        const iron0 = n < 3 ? 0 : n < 10 ? L.MIX.iron[0] : L.MIX.iron[1], ice0 = n < 6 ? 0 : L.MIX.ice;
        const w = (a, b) => (1 - a - b) + 4 * a + 2 * b;
        return (sm * sm * 0.86) / (info.cols * info.rows) * (info.boss ? L.BOSS_HARD : 1) * w(iron0, ice0) / w(info.mix.iron, info.mix.ice);
      };
      const grow = (n, g1, g2) => (n <= 30 ? g1 ** (n - 1) : g1 ** 29 * g2 ** (n - 30));
      const hpW = (n) => grow(Math.min(n, 400), L.HP_GROWTH, L.HP_GROWTH2) * (n <= L.EARLY_HP.length ? L.EARLY_HP[n - 1] : 1) * adjOf(n);
      const valW = (n) => grow(Math.min(n, 400), L.VALUE_GROWTH, L.VALUE_GROWTH2) * adjOf(n);
      const fb = [1, 2, 3, 4, 5, 9, 10, 12, 17, 25, 30, 31, 35, 77, 400].filter((n) => !near(L.hpMul(n) / hpW(n), 1, 1e-9) || !near(L.valMul(n) / valW(n), 1, 1e-9));
      check('hpMul・valMul が式どおり（作り直しで格子が 2 倍でも、ならしの式は同じ）', fb.length === 0, fb.map((n) => [n, L.hpMul(n), hpW(n)]));
      check('マスの体力 = HP_BASE × hpMul × MAT_HP、かけら = MAT_VALUE × valMul ÷ 4（端数こみ。整数にしない）', near(L.cellHp(3, 'iron'), L.HP_BASE * L.hpMul(3) * 4, 1e-9) && near(L.cellValue(1, 'rock'), L.valMul(1) / 4, 1e-12) && near(L.cellValue(9, 'gold'), 10 * L.valMul(9) / 4, 1e-9) && !Number.isInteger(L.cellValue(1, 'rock')), [L.cellHp(3, 'iron'), L.cellValue(1, 'rock'), L.cellValue(9, 'gold')]);
      // 星の重さ（体力の合計の目安）は、マスが細かくなっても前の作り（CELL 14・直径 10 + 0.48(n−1)・HP_BASE 600）とほぼ同じ（§3「星1つの体力の合計とかけらの合計は今と同じ目安」）
      const weightNow = (n) => { const i = L.starInfo(n); return L.cellHp(n, 'rock') * i.cols * i.rows; };
      const ratio = [4, 12, 20, 30].map((n) => weightNow(n) / (600 * L.HP_GROWTH ** (n - 1) * (n <= 9 ? L.EARLY_HP[n - 1] : 1) * (Math.min(24, 10 + (n - 1) * 0.48) ** 2) * 0.86 * (n % 5 === 0 ? 1.3 : 1) * (adjOf(n) * L.starInfo(n).cols * L.starInfo(n).rows / ((Math.min(48, 20 + (Math.min(n, 40) - 1) * 0.96) ** 2) * 0.86 * (n % 5 === 0 ? 1.3 : 1)))));
      check('星の体力の合計は前の作りの 1.1〜1.25 倍（HP_BASE 180 ÷ 150。自動プレイで 1 つの星を 3〜5 分に合わせた分）', ratio.every((x) => x > 1.1 && x < 1.25), ratio);
      const dw = (base, Lv) => base * (1 + 0.25 * (Lv - 1)) * 2 ** Math.floor(Lv / 10);
      check('dmg(w, L) = DMG × (1 + 0.25(L−1)) × 2^floor(L/10)', [1, 5, 9, 10, 11, 20, 30, 99].every((Lv) => L.WEAPONS.every((w) => near(L.dmg(w.id, Lv), dw(w.dmg, Lv), 1e-9 * dw(w.dmg, Lv)))), [L.dmg('shot', 9), L.dmg('shot', 10)]);
      check('upCost(w, L) = round(UP_COST × 1.35^(L−1))、Lv 上限で null、Lv 98 でも KAKERA_MAX 未満・減らない', L.WEAPONS.every((w) => L.upCost(w.id, 1) === L.UP_COST[w.id] && L.upCost(w.id, 7) === Math.round(L.UP_COST[w.id] * 1.35 ** 6) && L.upCost(w.id, 98) < L.KAKERA_MAX) && L.upCost('shot', 99) === null &&
        Array.from({ length: 97 }, (_, k) => k + 1).every((Lv) => L.upCost('beam', Lv + 1) >= L.upCost('beam', Lv)), [L.upCost('shot', 7)]);
      check('しんか（§3.3）：たま 1→2→3 連、ちらし 5→7→9→11 発、どかん 3→4→5→6 マス、いなずま 16→24→32→40 マス、ビーム 2→4→6→8 マス、ほのお 3→4 秒、Lv30 で打ち止め',
        [9, 10, 20, 30, 99].map((Lv) => ALL.map((w) => L.shapeOf(w, Lv)).join(',')).join('/') === '1,5,3,16,2,3/2,7,4,24,4,4/3,9,5,32,6,5/4,11,6,40,8,6/4,11,6,40,8,6' &&
        L.EVOLVE.bomb.base === 3 && L.EVOLVE.bolt.base === L.BOLT_CELLS && L.EVOLVE.beam.base === L.BEAM_W, [9, 10, 20, 30].map((Lv) => ALL.map((w) => L.shapeOf(w, Lv))));
      const fin = [L.hpMul(1e9), L.valMul(1e9), L.cellHp(9999, 'iron'), L.cellValue(9999, 'gold'), L.dmg('shot', 99), L.dmg('beam', 1e9), L.upCost('beam', 98)];
      check('STAR_CALC_MAX を超える星・LEVEL_MAX でも有限の数', fin.every(Number.isFinite) && L.hpMul(1e9) === L.hpMul(9999) && L.valMul(1e9) === L.valMul(9999) && L.cellValue(9999, 'gold') <= 1e18, fin);
      check('表・API が凍結されている', Object.isFrozen(L) && Object.isFrozen(L.WEAPONS) && Object.isFrozen(L.MATS) && Object.isFrozen(L.UP_COST) && Object.isFrozen(L.SLOT_COST) && Object.isFrozen(L.EVOLVE), null);
      const s = mk(L, { slots: [{ id: 'shot', lv: 12 }, { id: 'bolt', lv: 3 }] });
      check('upCostOf は upCost と同じ、Lv99 で null。slotCostOf は持っている武器（砲台＋ひかえ）の数で決まり、6 種類で null（4 台でも null にしない）',
        L.upCostOf(s, 0) === L.upCost('shot', 12) && L.upCostOf(s, 1) === L.upCost('bolt', 3) && L.upCostOf(mk(L, { slots: [{ id: 'shot', lv: 99 }] }), 0) === null && L.slotCostOf(s) === L.SLOT_COST[2] &&
        L.slotCostOf(mk(L, { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })) })) === L.SLOT_COST[4] &&
        L.slotCostOf(mk(L, { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })), bench: [{ id: 'beam', lv: 1 }] })) === L.SLOT_COST[5] &&
        L.slotCostOf(mk(L, { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })), bench: [{ id: 'beam', lv: 1 }, { id: 'fire', lv: 1 }] })) === null, null);
      const d0 = L.dpsOf(s, 0), d1 = L.dpsOf(mk(L, { slots: [{ id: 'shot', lv: 13 }] }), 0);
      check('dpsOf は 1 以上の整数で、Lv が上がると増える', Number.isInteger(d0) && d0 >= 1 && d1 > d0 && ALL.every((w) => Number.isInteger(L.dpsOf({ slots: [{ id: w, lv: 99 }] }, 0))), [d0, d1]);
    },
  },
  {
    id: 'KL2', tier: 'smoke', node: true, title: 'ほしくだき：星の形（同じ星と種で同じ形）、マスが GRID_MAX² 以下、混ざり方、てつは大きなかたまり（一番大きい 40 マス以上・8 割が 30 マス以上・底の 2 行に無い）、きんは 2×2、approachSec、formatKakera',
    run({ check, root }) {
      const L = load(root);
      const a = mk(L, { star: 12, seed: 99 }), b = mk(L, { star: 12, seed: 99, kakera: 500, tries: 2 }), c = mk(L, { star: 12, seed: 100 });
      check('同じ星の番号と種なら同じ形・同じ混ざり方（かけら・挑戦回数によらない）', J(a.rock.mats) === J(b.rock.mats) && a.rock.cols === b.rock.cols, null);
      check('種が違えば形が変わる', J(a.rock.mats) !== J(c.rock.mats), null);
      const bad = [], blobBad = [];
      let gotIron = 0, gotIce = 0, nBlobs = 0;
      const tags = new Set();
      for (let n = 1; n <= 60; n++) {
        const info = L.starInfo(n);
        const s = mk(L, { star: n, seed: 3 + (n % 4) });
        const R = s.rock;
        const cells = cellsOf(s);
        const cnt = (code) => R.mats.filter((m) => m === code).length;
        const ironR = cnt(2) / cells.length, iceR = cnt(3) / cells.length;
        if (info.mix.iron > 0) gotIron++;
        if (info.mix.ice > 0) gotIce++;
        tags.add(info.tag);
        const why = [];
        if (!(info.cols <= L.GRID_MAX && info.rows <= L.GRID_MAX && R.cols === info.cols && R.rows === info.rows)) why.push('格子の大きさ');
        if (!(cells.length >= 200 && cells.length <= L.GRID_MAX * L.GRID_MAX && R.total === cells.length && R.left === cells.length)) why.push('マスの数');
        if (n < 3 && (cnt(2) || cnt(3) || cnt(4))) why.push('星1〜2 は いわ だけ');
        if (n < 6 && cnt(3)) why.push('こおりは 6〜');
        if (n < 8 && cnt(4)) why.push('きんは 8〜');
        if (n >= 8 && !(cnt(4) >= 4 && cnt(4) <= 12 && cnt(4) % 4 === 0 && cnt(4) === info.mix.gold)) why.push('きんは 2×2 が 1〜3 個');
        if (n >= 3 && !(ironR >= 0.1 && ironR <= 0.5)) why.push('てつの割合 ' + ironR.toFixed(2));
        if (n >= 6 && !(iceR >= 0.03 && iceR <= 0.3)) why.push('こおりの割合 ' + iceR.toFixed(2));
        if (Math.abs(ironR - info.mix.iron) > 0.03 || Math.abs(iceR - info.mix.ice) > 0.03) why.push('starInfo の mix と実際が違う');
        const want = Math.round((n % 5 === 0 ? 300 : n <= 3 ? 135 : 240) / (0.33 + info.rows * 7 / 350) / 10) * 10;
        if (info.approachSec !== want || info.boss !== (n % 5 === 0)) why.push('approachSec/boss');
        const big = info.mix.iron === 0 && info.mix.ice === 0 ? '' : info.mix.iron >= info.mix.ice ? 'てつが おおい' : 'こおりが おおい';
        if (info.tag !== big) why.push('tag');
        const seen = new Set([cells[0]]), st = [cells[0]];
        while (st.length) { const j = st.pop(); const C = R.cols; for (const q of [j - 1, j + 1, j - C, j + C]) { if (q < 0 || q >= R.mats.length || seen.has(q) || !R.mats[q]) continue; if ((q === j - 1 && j % C === 0) || (q === j + 1 && q % C === 0)) continue; seen.add(q); st.push(q); } }
        if (seen.size !== cells.length) why.push('はじめから はなれている');
        if (why.length) bad.push({ n, why, cells: cells.length, ironR, iceR });
        // てつのかたまり（§3.2・§3.10）
        if (n >= 3) {
          const bl = ironBlobs(R), all = bl.reduce((x, y) => x + y, 0);
          const maxRow = Math.max(...cells.map((i) => Math.floor(i / R.cols)));
          const low = cells.filter((i) => Math.floor(i / R.cols) >= maxRow - 1 && R.mats[i] !== 1).length;
          nBlobs += bl.length;
          if (!(bl[0] >= 40 && bl.filter((x) => x >= 30).reduce((x, y) => x + y, 0) >= 0.8 * all && low === 0 && bl.length <= 4)) blobBad.push({ n, bl, low });
        }
      }
      check('星 1〜60：格子 48×48 以内、マスの数・混ざり方（てつ 10〜50%・こおり 3〜30%）・きん（2×2 が 1〜3 個）・approachSec（行×7 の式）・札、はじめは1つのかたまり', bad.length === 0, bad.slice(0, 4));
      check('てつは大きなかたまり（星 3〜60：一番大きい かたまり 40 マス以上・てつの 8 割以上が 30 マス以上のかたまり・かたまりは 4 個まで）、一番下の 2 行には てつ・こおり・きん が無い', blobBad.length === 0 && nBlobs >= 58, blobBad.slice(0, 4));
      check('てつ・こおりのある星があり、札は「てつが おおい」「こおりが おおい」の両方が出る（空振りでない）', gotIron > 40 && gotIce > 40 && tags.has('てつが おおい') && tags.has('こおりが おおい') && tags.has(''), [gotIron, gotIce, [...tags]]);
      const sizes = [1, 10, 29, 30, 9999].map((n) => L.starInfo(n).cols);
      check('星が進むと大きくなり（星 1 で 20 列）、星 30・9999 で 48 列（GRID_MAX）。見た目の大きさは前と同じ（48 × 7 = 336 単位）', sizes[0] === 20 && sizes[0] < sizes[2] && sizes.every((x) => x <= 48) && L.starInfo(9999).cols === 48 && L.starInfo(30).cols === 48 && 48 * L.CELL === 336, sizes);
      check('starInfo のおかしな引数は null、STAR_MAX を超える番号は 9999 として扱う', [0, -1, NaN, 'x', null, undefined, Infinity].every((x) => L.starInfo(x) === null) && J(L.starInfo(1e9)) === J(L.starInfo(9999)), null);
      const s7 = mk(L, { star: 7 });
      const i7 = cellsOf(s7).find((i) => s7.rock.mats[i] === 2);
      const r7 = Math.floor(i7 / s7.rock.cols);
      check('マスの体力が星の式どおり（cellHp × その行の倍率 rowHp = cellHpAt）・rock.value が全部のマスのかけらの合計', i7 !== undefined && near(s7.rock.hp[i7], L.cellHp(7, 'iron') * s7.rock.rowHp[r7], 1e-9) && near(L.cellHpAt(s7, i7), s7.rock.hp[i7], 1e-9) && near(s7.rock.value, cellsOf(s7).reduce((v, i) => v + L.cellValue(7, MATN[s7.rock.mats[i]]), 0), 1e-6), null);
      const F = [[0, '0'], [7, '7'], [1234, '1,234'], [9999, '9,999'], [12345, '1.2まん'], [10000, '1まん'], [99999, '9.9まん'], [1234567, '123まん'], [99999999, '9999まん'], [123456789, '1.2おく'], [5.6e12, '5.6ちょう'], [9e15, '9000ちょう'], [-5, '0'], [NaN, '0'], [Infinity, '9000ちょう'], ['x', '0'], [800000, '80まん'], [2e9, '20おく']];
      const fbad = F.filter(([n, w]) => L.formatKakera(n) !== w).map(([n, w]) => ({ n, want: w, got: L.formatKakera(n) }));
      check('formatKakera：1,234 → 1.2まん → 1.2おく → 5.6ちょう（切り捨て）、おかしな値は 0', fbad.length === 0, fbad);
      let longest = 0; for (let e = 0; e <= 16; e++) for (const m of [1, 9.99, 5.55]) longest = Math.max(longest, L.formatKakera(m * 10 ** e).length);
      check('formatKakera は最大でも 10 文字以内', longest <= 10 && L.formatKakera(L.KAKERA_MAX).length <= 10, longest);
    },
  },
  {
    id: 'KL3', tier: 'smoke', node: true, title: 'ほしくだき：当たり（斜めの弾は DDA で通り道の最初のマス・場の外へ消える、ちらしの扇 12°・15°、どかんの円 半径 3 マス・縁が中心、いなずまの枝分かれ（同じ種類・BOLT_CELLS・木）、ビームが掘る、ほのお、ひび、弾の上限）',
    run({ check, root }) {
      const L = load(root);
      const BIG = 1e9, C7 = L.CELL;
      // 斜め：右はしの砲台（4 台の 4 番目 x=288）から左上の星へ撃つと、星の右の縁に当たる
      let d = mk(L, { slots: [{ id: 'spread', lv: 1 }, { id: 'bomb', lv: 1 }, { id: 'bolt', lv: 1 }, { id: 'shot', lv: 1 }] });
      d = setRock(L, d, Array(10).fill('rrrrrr'), { hp: BIG, only: 3, x: 60, bottom: 260 });
      let r = until(L, d, (e) => e.kind === 'hit', 3);
      const f0 = ofKind(r.evs, 'fire')[0], h0 = ofKind(r.evs, 'hit')[0];
      const T3 = L.turretsOf(4)[3];
      const rightEdge = h0 && (h0.i % 6 === 5 || !r.s.rock.mats[h0.i + 1]);
      check('斜め：右はしの砲台から左上へ撃つ（ang が左向き 10° より大きい）と、星の右の縁のマスに当たる', !!f0 && f0.k === 3 && f0.w === 'shot' && f0.ang < -10 * DEG && rightEdge && near(f0.x, T3.x + Math.sin(f0.ang) * L.BARREL, 1e-6) && near(f0.y, T3.y - Math.cos(f0.ang) * L.BARREL, 1e-6), [f0, h0]);
      const sh = r.s.shots.length ? r.s.shots[0] : null;
      check('弾は砲身の向き ang の方へ飛ぶ（vx = sin(ang)×600、vy = −cos(ang)×600）', !sh || (near(angOf(sh), r.s.turrets[3].ang, 1e-6) && near(Math.hypot(sh.vx, sh.vy), 600, 1e-6)), sh);
      // 通り道の手前のマスに先に当たる：斜めに飛ぶ弾を入れて、先に通るマスに当たる（奥のマスには当たらない）
      let p = mk(L);
      p = setRock(L, p, ['r....', '.....', '.....', '.....', '....r'], { hp: BIG, only: -1, x: 100, bottom: 200 });
      const R0 = p.rock;
      p = { ...p, shots: [{ k: 0, w: 'shot', x: R0.x + 6 * C7, y: R0.y + 6 * C7, vx: -Math.SQRT1_2 * 600, vy: -Math.SQRT1_2 * 600, t: 0, dmg: 1 }] };
      r = run(L, p, 0.5);
      const hp1 = ofKind(r.evs, 'hit');
      check('斜めの弾は、通り道で先に入ったマス（右下）に当たり、奥のマス（左上）には当たらない（DDA）', hp1.length === 1 && hp1[0].i === 24 && r.s.shots.length === 0, hp1);
      // すり抜けない：1 マスの星へ、いろいろな向きから弾を通すと必ず当たる
      let miss = 0, tried = 0;
      for (let a = -55; a <= 55; a += 5) for (const off of [-3, -1.5, 0, 1.5, 3]) {
        let q = mk(L);
        q = setRock(L, q, ['r'], { hp: BIG, only: -1, x: 176.5, bottom: 250 });
        const tx = 180 + off * Math.cos(a * DEG), ty = 246.5 + off * Math.sin(a * DEG);
        const sx = tx - Math.sin(a * DEG) * 150, sy = ty + Math.cos(a * DEG) * 150;
        q = { ...q, shots: [{ k: 0, w: 'shot', x: sx, y: sy, vx: Math.sin(a * DEG) * 600, vy: -Math.cos(a * DEG) * 600, t: 0, dmg: 1 }] };
        tried++;
        if (ofKind(run(L, q, 1).evs, 'hit').length !== 1) miss++;
      }
      check('弾は 1 step に 20 単位（約 3 マス）進んでも、通り道の 1 マスをすり抜けない（いろいろな向き・ずれの 115 本）', miss === 0 && tried === 115, miss);
      let o = mk(L);
      o = setRock(L, o, ['r'], { hp: BIG, only: -1, x: 20, bottom: 100 });
      o = { ...o, shots: [{ k: 0, w: 'shot', x: 300, y: 480, vx: 300, vy: -520, t: 0, dmg: 1 }] };
      const ro = run(L, o, 1.5);
      check('何にも当たらない弾は場の外へ出たら消える', ofKind(ro.evs, 'hit').length === 0 && ro.s.shots.length === 0, ro.s.shots.length);
      // ちらし：扇に 5 発（Lv10 で 7 発）、全体 12°・15°（§20.3）
      for (const [lv, n, wdeg] of [[1, 5, 12], [10, 7, 15]]) {
        let t = mk(L, { slots: [{ id: 'spread', lv }] });
        t = setRock(L, t, ['rrrrrrrrrr', 'rrrrrrrrrr'], { hp: BIG, only: 0, bottom: 200 });
        let st = t, sp = [];
        for (let k = 0; k < 10 && !sp.length; k++) { st = L.step(st, L.STEP).state; sp = st.shots.filter((x) => x.w === 'spread'); }
        const ang = sp.map(angOf).sort((x, y) => x - y);
        const gaps = ang.slice(1).map((x, k) => x - ang[k]);
        const width = (ang[ang.length - 1] - ang[0]) / DEG;
        check(`ちらし Lv${lv}：扇に ${n} 発（間かくがそろう）、扇の全体が ${wdeg}°（ユーザー決定 0.375 倍）`, sp.length === n && gaps.every((g) => g > 0.03 && near(g, gaps[0], 1e-9)) && near(width, wdeg, 1e-6), [sp.length, width]);
      }
      // どかん：縁のマスの上に落ち、半径 3 マスの円の中だけ
      let bm = mk(L, { slots: [{ id: 'bomb', lv: 1 }] });
      bm = setRock(L, bm, Array(15).fill('rrrrrrrrrrrrrrr'), { hp: BIG, only: 0, bottom: 300 });
      r = until(L, bm, (e) => e.kind === 'boom', 3);
      const boom = ofKind(r.evs, 'boom')[0];
      const hitsB = ofKind(r.evs, 'hit').filter((e) => e.w === 'bomb').map((e) => e.i).sort((x, y) => x - y);
      const inC = [];
      let centerCell = -1;
      if (boom) { const R = r.s.rock; for (let i = 0; i < 225; i++) { const x = cx(L, R, i), y = cy(L, R, i); if ((x - boom.x) ** 2 + (y - boom.y) ** 2 <= (boom.r + 1e-6) ** 2) inC.push(i); if (near(x, boom.x, 1e-6) && near(y, boom.y, 1e-6)) centerCell = i; } }
      const onEdge = centerCell >= 0 && (centerCell % 15 === 0 || centerCell % 15 === 14 || centerCell < 15 || centerCell >= 210);
      check('どかん：半径 3 マス（21 単位）の円の中のマスだけ、円の中心は縁のマス（円は外から欠ける）', !!boom && near(boom.r, 21) && J(hitsB) === J(inC) && hitsB.length >= 12 && hitsB.length <= 29 && onEdge, [boom, hitsB.length, centerCell]);
      const fB = ofKind(r.evs, 'fire').find((e) => e.w === 'bomb');
      check('どかん：山なりで 0.6 秒後に落ちる', !!fB && r.evs.indexOf(boom) > r.evs.indexOf(fB) && Math.round((r.s.t - (r.s.cd[0] - 1.6)) * 30) === 18, r.s.t);
      // いなずま：一番近い てつ へ落ち、つながった てつ だけへ枝分かれ（6 マスのかたまり）
      let bl = mk(L, { star: 3, slots: [{ id: 'bolt', lv: 1 }] });
      bl = setRock(L, bl, ['rriiirrr', 'rrrirrir', 'rriirrir', 'rrrrrrrr'], { hp: BIG, only: 0, bottom: 300 });
      r = until(L, bl, (e) => e.kind === 'bolt', 2);
      let bolt = ofKind(r.evs, 'bolt')[0];
      const blobA = [2, 3, 4, 11, 18, 19];
      const tree = (b, C = 8) => { if (!b) return false; const got = [b.from]; for (const [x, y] of b.edges) { if (!got.includes(x) || got.includes(y)) return false; const dd = Math.abs(x - y); if (!(dd === C || (dd === 1 && Math.floor(x / C) === Math.floor(y / C)))) return false; got.push(y); } return got; };
      const tA = tree(bolt);
      check('いなずま：てつ に落ち、上下左右でつながった てつ（6 マス）だけへ枝分かれ（はなれた てつ・いわ には行かない）。edges は木（親は先に通ったマス）', !!tA && blobA.includes(bolt.from) && J([...tA].sort((x, y) => x - y)) === J(blobA), bolt);
      check('いなずま：枝分かれしたマス全部に当たる（hit の w が bolt）', J(ofKind(r.evs, 'hit').filter((e) => e.w === 'bolt').map((e) => e.i).sort((x, y) => x - y)) === J(blobA), null);
      for (const [lv, n] of [[1, 16], [10, 24]]) {
        let bb = mk(L, { star: 3, slots: [{ id: 'bolt', lv }] });
        bb = setRock(L, bb, Array(10).fill('iiiiiiiiii'), { hp: BIG, only: 0, bottom: 260 });
        const b2 = ofKind(until(L, bb, (e) => e.kind === 'bolt', 2).evs, 'bolt')[0];
        const t2 = tree(b2, 10);
        check(`いなずま Lv${lv}：大きな てつ のかたまりでは BOLT_CELLS（${n} マス）まで・木になっている`, !!t2 && t2.length === n && new Set(t2).size === n, b2 && b2.edges.length);
      }
      // ビーム：細い柱（幅 2 マス × 高さ 45 マス）を真下の砲台から。最初に当たったマスから奥へ 20 マス、2 回目はもっと奥（穴が深くなる）
      let be = mk(L, { star: 3, slots: [{ id: 'beam', lv: 1 }] });
      be = setRock(L, be, Array(45).fill('rr'), { hp: 1e-6, only: 0, x: 180 - C7, bottom: 440 });
      r = until(L, be, (e) => e.kind === 'beam', 2);
      const bm1 = ofKind(r.evs, 'beam')[0];
      const rowsOf = (cells) => cells.map((i) => Math.floor(i / 2));
      const r1 = bm1 ? rowsOf(bm1.cells) : [];
      check('ビーム：真上へ、最初に当たった一番下のマスから奥へ BEAM_DEPTH（20）マス、幅 2 マス（40 マス）を全部こわす。出来事に k・砲身の先・ang・len・w・cells', !!bm1 && bm1.k === 0 && near(bm1.ang, 0, 1e-9) && bm1.cells.length === 40 && Math.max(...r1) === 44 && Math.min(...r1) === 25 && near(bm1.w, 14) && bm1.len > 0 && near(bm1.y, L.turretsOf(1)[0].y - L.BARREL, 1e-6) && ofKind(r.evs, 'break').length === 40, bm1 && [bm1.cells.length, Math.min(...r1), Math.max(...r1), bm1.ang]);
      const r2b = until(L, r.s, (e) => e.kind === 'beam', 3);
      const bm2 = ofKind(r2b.evs, 'beam')[0];
      const rr2 = bm2 ? rowsOf(bm2.cells) : [];
      check('ビーム：2 回目は同じ向きで、空いた穴の奥（残りの 25 マスのうち下から 20 行）へ進む（掘る）', !!bm2 && near(bm2.ang, 0, 1e-9) && Math.max(...rr2) === 24 && Math.min(...rr2) === 5 && bm2.len > bm1.len, bm2 && [Math.min(...rr2), Math.max(...rr2), bm2.len, bm1.len]);
      // ビーム：てつ には 1.8 倍
      let bi = mk(L, { star: 3, slots: [{ id: 'beam', lv: 1 }] });
      bi = setRock(L, bi, Array(6).fill('ri'), { hp: BIG, only: 0, x: 180 - C7, bottom: 300 });
      const rbi = until(L, bi, (e) => e.kind === 'beam', 2);
      const dI = bi.rock.hp[1] - rbi.s.rock.hp[1], dR = bi.rock.hp[0] - rbi.s.rock.hp[0];
      check('ビーム：てつ には 1.8 倍（相性）', dR > 0 && near(dI / dR, 1.8, 1e-6), [dI, dR]);
      // ほのお：当たったマスが燃え、0.5 秒で となりの こおり へ 1 だんだけ広がる（1 発で 3 マス）
      let f1 = mk(L, { star: 6, slots: [{ id: 'fire', lv: 1 }] });
      f1 = setRock(L, f1, ['ccccccc'], { hp: BIG, only: 0, x: 180 - 3.5 * C7, bottom: 300 });
      const f1a = until(L, f1, (e) => e.kind === 'burn', 2);
      const f1b = run(L, { ...f1a.s, cd: f1a.s.cd.map(() => 1e9) }, 3);
      const burnedLine = [...new Set(ofKind([...f1a.evs, ...f1b.evs], 'burn').map((e) => e.i))].sort((x, y) => x - y);
      check('ほのお：一番近い こおり（真ん中 3）に火がつき、となりの こおり（2・4）へ 1 だんだけ広がる（燃えうつったマスからは広がらない）', J(burnedLine) === J([2, 3, 4]), burnedLine);
      const h12 = f1a.s.rock.hp[3], h12b = run(L, { ...f1a.s, cd: f1a.s.cd.map(() => 1e9) }, 1).s.rock.hp[3];
      check('ほのお：燃えている こおり は毎秒 DMG×3（相性）で減る', near(h12 - h12b, L.dmg('fire', 1) * 3, 0.11 * L.dmg('fire', 1)), h12 - h12b);
      // 燃えていたマスが欠けたら、残りの時間で となりのマスへ燃えうつる（火を むだにしない。作り直しで足した決まり）
      let f2 = mk(L, { star: 6, slots: [{ id: 'fire', lv: 1 }] });
      f2 = setRock(L, f2, ['rrrrrrr'], { hp: 0.5, only: 0, x: 180 - 3.5 * C7, bottom: 300 });
      const f2a = until(L, f2, (e) => e.kind === 'burn', 2);
      const f2b = run(L, { ...f2a.s, cd: f2a.s.cd.map(() => 1e9) }, 2.5);
      const brk2 = ofKind(f2b.evs, 'break').length, burn2 = ofKind(f2b.evs, 'burn').length;
      check('ほのお：燃えていたマスが欠けると、残りの時間で となりのマスへ燃えうつる（1 発で 3 秒、いわ を何マスも）', brk2 >= 4 && burn2 >= 3 && f2b.s.burns.length <= 1, [brk2, burn2]);
      // ひび：かたいマスは crack が増えてから欠ける
      let cr = mk(L, { star: 3, slots: [{ id: 'shot', lv: 9 }] });
      cr = setRock(L, cr, ['i'], { x: 180 - 3.5, bottom: 300 });
      const rr = until(L, cr, (e) => e.kind === 'break', 120);
      const cracks = ofKind(rr.evs, 'hit').map((e) => e.crack);
      check('ひび：てつ に当たるたび crack が 0〜3 で増えていき、最後に欠ける（break）', cracks.length >= 3 && cracks.every((c, k) => c >= 0 && c <= 3 && (k === 0 || c >= cracks[k - 1])) && cracks[cracks.length - 1] === 3 && ofKind(rr.evs, 'break').length === 1, cracks);
      // 弾の上限
      let many = mk(L, { slots: [{ id: 'shot', lv: 30 }, { id: 'spread', lv: 30 }, { id: 'fire', lv: 30 }, { id: 'bomb', lv: 30 }] });
      many = setRock(L, many, ['rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr'], { hp: BIG, bottom: 60 });
      let maxShots = 0, cur = many;
      for (let i = 0; i < 300; i++) { cur = L.step(cur, 0.1).state; cur = { ...cur, cd: cur.cd.map(() => 0) }; maxShots = Math.max(maxShots, cur.shots.length); }
      check('弾は SHOTS_MAX（120）を超えない（毎回すぐ撃てるようにしても）', maxShots <= L.SHOTS_MAX && maxShots >= 100, maxShots);
    },
  },
  {
    id: 'KL4', tier: 'smoke', node: true, title: 'ほしくだき：はなれたかたまり（首を切ると小さいほうが全部くだける・かけらは合計どおり・同じ大きさは真ん中に近いほうが本体・本体はくだけない）',
    run({ check, root }) {
      const L = load(root);
      const BIG = 1e9, C7 = L.CELL;
      const pic = ['rrrr.rr', 'rrrr.rr', 'rrrrrrr'];
      let s = mk(L, { kakera: 100 });
      const neck = 2 * 7 + 4;
      s = setRock(L, s, pic, { hp: (i) => (i === neck ? 0.5 : BIG), x: 180 - 4.5 * C7, bottom: 300 });
      const r = until(L, s, (e) => e.kind === 'break', 2);
      const brk = ofKind(r.evs, 'break'), ch = ofKind(r.evs, 'chunk');
      const right = [5, 6, 12, 13, 19, 20];
      const v1 = L.cellValue(1, 'rock');
      check('首（1 マス。砲台の真上）が欠けると、右の小さいかたまり（6 マス）が同じ step で全部くだける', brk.length === 1 && brk[0].i === neck && ch.length === 1 && J([...ch[0].cells].sort((a, b) => a - b)) === J(right) && right.every((i) => r.s.rock.mats[i] === 0), [brk, ch]);
      check('くだけたかたまりのかけら＝各マスの value の合計、かけらは首＋かたまりの分（端数は kfrac）だけ増える', ch[0] && near(ch[0].value, 6 * v1, 1e-9) && r.s.kakera === 100 + Math.floor(7 * v1) && near(r.s.kfrac, 7 * v1 - Math.floor(7 * v1), 1e-9) && r.s.totals.chunks === 1 && r.s.totals.cells === 7, [ch[0], r.s.kakera, r.s.kfrac]);
      const left = [0, 1, 2, 3, 7, 8, 9, 10, 14, 15, 16, 17];
      check('本体（大きいほう 12 マス）はくだけない・体力もそのまま', left.every((i) => r.s.rock.mats[i] === 1 && r.s.rock.hp[i] === BIG) && r.s.rock.left === 12 && r.s.phase === 'fly', r.s.rock.left);
      const pic2 = ['rrr.rrr.', 'rrr.rrr.', 'rrrrrrr.'];
      const neck2 = 2 * 8 + 3;
      let t = mk(L);
      t = setRock(L, t, pic2, { hp: (i) => (i === neck2 ? 0.5 : BIG), x: 180 - 3.5 * C7, bottom: 300 });
      const r2 = until(L, t, (e) => e.kind === 'break', 2);
      const ch2 = ofKind(r2.evs, 'chunk')[0];
      check('同じ大きさのときは、格子の真ん中に近いマスを含むほう（右）が本体で、左がくだける', ch2 && J([...ch2.cells].sort((a, b) => a - b)) === J([0, 1, 2, 8, 9, 10, 16, 17, 18]) && r2.s.rock.left === 9, ch2);
      let u = mk(L);
      u = setRock(L, u, ['rrrrr', 'rrrrr'], { hp: (i) => (i === 7 ? 0.5 : BIG), x: 180 - 2.5 * C7, bottom: 300 });
      const r3 = until(L, u, (e) => e.kind === 'break', 2);
      check('切れていなければ chunk は出ない（break は出ている）', ofKind(r3.evs, 'break').length === 1 && ofKind(r3.evs, 'chunk').length === 0 && r3.s.rock.left === 9, null);
    },
  },
  {
    id: 'KL5', tier: 'smoke', node: true, title: 'ほしくだき：近づく・とどく（approachSec どおり・下を削ると 1 マスぶん延びる・届くと星が最初から・かけらと武器は残る・やさしくなる仕掛け）、入れ替えの予約は はね返しのやり直しの始めに当たる',
    run({ check, root }) {
      const L = load(root);
      const BIG = 1e12;
      const reach = (o, mut) => {
        let s = mk(L, o);
        s = { ...s, rock: { ...s.rock, hp: s.rock.hp.map((h) => (h ? BIG : 0)) }, cd: s.cd.map(() => 1e9) };
        if (mut) s = mut(s);
        const r = until(L, s, (e) => e.kind === 'bounce', 700);
        return { ...r, t: r.s.t, s0: s };
      };
      const bad = [];
      for (const star of [1, 4, 5, 31]) {
        const sec = L.starInfo(star).approachSec;
        const r = reach({ star });
        if (!r.hit || Math.abs(r.t - sec) > L.STEP * 1.5 || !(sec >= 150 && sec <= 400)) bad.push({ star, want: sec, got: r.t });
      }
      check('削らなければ、一番下のマスが approachSec（150〜400 秒）でバリアに届く', bad.length === 0, bad);
      const a = reach({ star: 4 });
      const b = reach({ star: 4 }, (s) => {
        const R = s.rock, br = Math.max(...cellsOf(s).map((i) => Math.floor(i / R.cols)));
        const mats = R.mats.map((m, i) => (Math.floor(i / R.cols) === br ? 0 : m));
        return { ...s, rock: { ...R, mats, left: mats.filter((m) => m).length, scan: null } };
      });
      check('一番下の行を削ると、届くまでの時間が 1 マスぶん（7/vy 秒）延びる', b.hit && near(b.t - a.t, L.CELL / a.s0.rock.vy, L.STEP * 1.5), [a.t, b.t]);
      // 届いたとき（一番下の行だけ欠けるようにする）。入れ替えの予約（いなずま → ほのお）は、はね返しのあとのやり直しの始めに当たる
      let s = mk(L, { star: 4, kakera: 777, slots: [{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 3 }], bench: [{ id: 'fire', lv: 5 }], totals: { cells: 5, stars: 3, kakera: 900, chunks: 1 } });
      s = L.reserveSwap(s, 1, 'fire').state;
      const shape0 = J(s.rock.mats);
      const brow = Math.max(...cellsOf(s).map((i) => Math.floor(i / s.rock.cols)));
      s = { ...s, rock: { ...s.rock, hp: s.rock.hp.map((h, i) => (h ? (Math.floor(i / s.rock.cols) === brow ? 0.001 : BIG) : 0)) } };
      const r = until(L, s, (e) => e.kind === 'bounce', 500);
      const bounce = ofKind(r.evs, 'bounce')[0];
      const k1 = r.s.kakera;
      check('届くと bounce（broken＝壊した割合）・phase は bounce、地球は壊れない', r.hit && r.s.phase === 'bounce' && bounce.broken > 0 && bounce.broken < 1 && near(bounce.broken, 1 - r.s.rock.left / r.s.rock.total), bounce);
      check('飛んでいる間・はね返しの間は入れ替わらない（予約のまま）', ofKind(r.evs, 'swap').length === 0 && r.s.slots[1].id === 'bolt' && J(r.s.swap) === J([{ slot: 1, id: 'fire' }]), [r.s.slots, r.s.swap]);
      const r2 = run(L, r.s, 1.9);
      check('はね返しの 2 秒の間は止まって待つ（1.9 秒ではまだ bounce・まだ替わらない）', r2.s.phase === 'bounce' && r2.s.slots[1].id === 'bolt' && ofKind(r2.evs, 'swap').length === 0, r2.s.phase);
      const r3 = run(L, r2.s, 0.2);
      check('2 秒たつと自動で次の挑戦（fly）、星は最初から（形が元どおり・残り＝全部）', r3.s.phase === 'fly' && J(r3.s.rock.mats) === shape0 && r3.s.rock.left === r3.s.rock.total && r3.s.star === 4, [r3.s.phase, r3.s.rock.left]);
      const sw = ofKind(r3.evs, 'swap');
      check('やり直しの始めの step で予約が当たる（swap の出来事・ほのお Lv5 が砲台へ・いなずま Lv3 は ひかえ へ・予約は空）', J(sw) === J([{ kind: 'swap', slot: 1, from: 'bolt', to: 'fire', lv: 5 }]) && J(r3.s.slots) === J([{ id: 'shot', lv: 7 }, { id: 'fire', lv: 5 }]) && J(r3.s.bench) === J([{ id: 'bolt', lv: 3 }]) && J(r3.s.swap) === J([]), [sw, r3.s.slots, r3.s.bench]);
      check('かけら・累計は残る（減らない）、tries が 1→2', r3.s.kakera >= k1 && k1 > 777 && r3.s.totals.stars === 3 && r3.s.totals.cells >= 5 && r3.s.tries === 2, [k1, r3.s.kakera, r3.s.tries]);
      const vy = (tries) => mk(L, { star: 4, tries }).rock.vy;
      const base = vy(1);
      const want = { 1: 1, 2: 0.9, 3: 0.8, 4: 0.75, 6: 0.75, 50: 0.75 };
      const vb = Object.entries(want).filter(([t, f]) => !near(vy(+t) / base, f, 1e-9)).map(([t, f]) => ({ tries: t, want: f, got: vy(+t) / base }));
      check('2 回目から降りる速さが 1 回ごとに 10% ずつ遅く、最大 25%', vb.length === 0, vb);
      let c = lastCell(L, mk(L, { star: 4, tries: 6 }));
      const rc = run(L, c, 3);
      check('クリアすると tries は 1 にもどり、速さも元にもどる', rc.s.star === 5 && rc.s.tries === 1 && near(rc.s.rock.vy, (L.BARRIER_Y - L.START_BOTTOM) / L.starInfo(5).approachSec, 1e-9), [rc.s.star, rc.s.tries]);
      const p0 = L.progressOf(mk(L, { star: 4 }));
      check('progressOf：始めは broken 0・distance 1、届いたときは distance 0', p0.broken === 0 && p0.distance === 1 && p0.left === p0.total && L.progressOf(r.s).distance === 0, [p0, L.progressOf(r.s)]);
    },
  },
  {
    id: 'KL6', tier: 'smoke', node: true, title: 'ほしくだき：クリア（おまけ＝value×0.2・1.5 秒で次の星・大きな星の予告）、予約は次の星の始めに当たる（swap の出来事・外した武器の Lv は ひかえ に残る）、ENDING_STAR でエンディング（1回だけ）',
    run({ check, root }) {
      const L = load(root);
      let s = lastCell(L, mk(L, { star: 4, kakera: 50, ms: [25, 50, 75], slots: [{ id: 'shot', lv: 7 }, { id: 'beam', lv: 12 }], bench: [{ id: 'bolt', lv: 9 }, { id: 'fire', lv: 2 }] }));
      s = L.reserveSwap(s, 0, 'bolt').state;
      const r = until(L, s, (e) => e.kind === 'clear', 3);
      const cl = ofKind(r.evs, 'clear')[0];
      const bonus = Math.floor(s.rock.value * 0.2);
      const v = L.cellValue(4, MATN[s.rock.mats.find((m) => m)]);
      check('最後のマスが欠けると clear（star 4）・おまけ＝その星の全部のマスの value×0.2（切り捨て）', !!cl && cl.star === 4 && cl.bonus === bonus && ofKind(r.evs, 'milestone').length === 0 && bonus > 0 && r.s.kakera === 50 + Math.floor(v + bonus) && r.s.phase === 'clear' && r.s.totals.stars === 1, [cl, r.s.kakera, 50 + v + bonus]);
      const r1 = run(L, r.s, 1.4);
      check('クリアの演出 1.5 秒の間は clear のまま（おまけは1回だけ・まだ入れ替わらない）', r1.s.phase === 'clear' && r1.s.kakera === r.s.kakera && ofKind(r1.evs, 'clear').length === 0 && r1.s.slots[0].id === 'shot' && ofKind(r1.evs, 'swap').length === 0, r1.s.phase);
      const r2 = run(L, r1.s, 0.2);
      check('1.5 秒で次の星（5）が上から（fly・新しい形・tries 1）、大きな星なら boss の出来事', r2.s.phase === 'fly' && r2.s.star === 5 && r2.s.rock.left === r2.s.rock.total && r2.s.rock.total > 0 && r2.s.tries === 1 && J(ofKind(r2.evs, 'boss')) === J([{ kind: 'boss', star: 5 }]), [r2.s.phase, r2.s.star]);
      check('次の星の始めに予約が当たる：swap の出来事（たま → いなずま Lv9）、外した たま は Lv7 のまま ひかえ に、予約は空', J(ofKind(r2.evs, 'swap')) === J([{ kind: 'swap', slot: 0, from: 'shot', to: 'bolt', lv: 9 }]) && J(r2.s.slots) === J([{ id: 'bolt', lv: 9 }, { id: 'beam', lv: 12 }]) && J(r2.s.bench) === J([{ id: 'shot', lv: 7 }, { id: 'fire', lv: 2 }]) && J(r2.s.swap) === J([]) && r2.s.turrets.length === 2, [r2.s.slots, r2.s.bench]);
      const e0 = lastCell(L, mk(L, { star: 30, kakera: 0 }));
      const re = run(L, e0, 3);
      check('星 30（ENDING_STAR）をクリアするとエンディング（ending 1回・phase end・cleared・次は星 31）', ofKind(re.evs, 'ending').length === 1 && re.s.phase === 'end' && re.s.cleared === true && re.s.star === 31, [re.s.phase, re.s.star]);
      const rz = run(L, re.s, 5);
      check('phase end の間は進まない', rz.s.phase === 'end' && rz.s.t === re.s.t && rz.evs.length === 0, rz.s.t - re.s.t);
      const cont = L.loadSave(L.makeSave(re.s));
      check('「このまま あそぶ」（保存し直し）で星 31 から fly で続く、cleared は true のまま', cont && cont.phase === 'fly' && cont.star === 31 && cont.cleared === true, cont && [cont.phase, cont.star]);
      const re2 = run(L, lastCell(L, mk(L, { star: 30, cleared: true })), 3);
      check('エンディングは1回だけ（cleared のあとは ending が出ない・止まらない）', ofKind(re2.evs, 'ending').length === 0 && re2.s.phase === 'fly' && re2.s.star === 31, re2.s.phase);
      const re3 = run(L, lastCell(L, mk(L, { star: 9999, cleared: true })), 3);
      check('星 9999（STAR_MAX）をクリアしても 9999 のまま続く', re3.s.star === 9999 && re3.s.phase === 'fly' && ofKind(re3.evs, 'clear').length === 1, re3.s.star);
    },
  },
  {
    id: 'KL7', tier: 'smoke', node: true, title: 'ほしくだき：2択（得意が違う2つ・砲台と ひかえ の武器は出ない・引き直せない・選ぶまで止まる）、4 台のあとは ひかえ に Lv1、残り 1 つは候補 1 つ、6 種類で slotCostOf null・unlock は all、強くする',
    run({ check, root }) {
      const L = load(root);
      const good = Object.fromEntries(L.WEAPONS.map((w) => [w.id, w.good]));
      const bad = [];
      let n = 0, nBench = 0, nOne = 0;
      for (let seed = 1; seed <= 40; seed++) {
        let s = mk(L, { seed, rng: seed * 7919, kakera: 9e15 });
        for (let k = 0; k < 5; k++) {
          const u = L.unlock(s);
          if (!u.ok) { bad.push({ seed, k, why: 'unlock 失敗 ' + u.reason }); break; }
          const o = u.state.offer;
          n++;
          const have = s.slots.map((x) => x.id).concat(s.bench.map((x) => x.id));
          const left = ALL.filter((id) => !have.includes(id));
          if (left.length >= 2) {
            if (!(Array.isArray(o) && o.length === 2 && o[0] !== o[1] && o.every((id) => good[id] !== undefined && !have.includes(id)))) bad.push({ seed, k, o, have });
            if (left.some((x) => left.some((y) => good[x] !== good[y])) && good[o[0]] === good[o[1]]) bad.push({ seed, k, why: '得意が同じ', o });
          } else {
            nOne++;
            if (!(Array.isArray(o) && o.length === 1 && o[0] === left[0])) bad.push({ seed, k, why: '残り 1 つ', o });
          }
          if (u.state.phase !== 'choose' || u.state.kakera !== s.kakera - L.SLOT_COST[have.length]) bad.push({ seed, k, why: 'phase/お金' });
          const pick = o.length === 1 ? 0 : seed % 2;
          const c = L.choose(u.state, pick);
          const toBench = s.slots.length >= 4;
          if (toBench) nBench++;
          const ok = c.ok && c.to === (toBench ? 'bench' : 'slot') && c.state.phase === 'fly' && c.state.offer === null &&
            (toBench ? c.state.slots.length === 4 && J(c.state.bench[c.state.bench.length - 1]) === J({ id: o[pick], lv: 1 }) && c.events.length === 0
              : c.state.slots.length === s.slots.length + 1 && J(c.state.slots[c.state.slots.length - 1]) === J({ id: o[pick], lv: 1 }) && c.state.turrets.length === c.state.slots.length && J(c.events) === J([{ kind: 'turrets', n: c.state.slots.length }]));
          if (!ok) bad.push({ seed, k, why: 'choose', c: [c.ok, c.to] });
          s = c.state;
        }
        const u6 = L.unlock(s);
        if (u6.ok || u6.reason !== 'all' || L.slotCostOf(s) !== null || s.slots.length + s.bench.length !== 6) bad.push({ seed, why: '6 種類で開けられた', r: u6.reason });
      }
      check('どの種でも：2択は持っていない（砲台にも ひかえ にも無い）武器 2 つで得意が違う、残り 1 つなら候補 1 つ。4 台未満は新しい砲台（turrets の出来事）、4 台なら ひかえ に Lv1。6 種類で unlock は all（200 回）', bad.length === 0 && n === 200 && nBench === 80 && nOne === 40, bad.slice(0, 3));
      let s = mk(L, { kakera: 400 });
      const u = L.unlock(s);
      const t0 = u.state.t;
      const rs = run(L, u.state, 3);
      check('2択の間は場が止まる（t・マス・かけら が変わらない）', rs.s.t === t0 && rs.s.phase === 'choose' && J(rs.s.rock.mats) === J(u.state.rock.mats) && rs.s.kakera === u.state.kakera && rs.evs.length === 0, rs.s.t);
      const again = L.unlock(u.state);
      check('2択の間にもう一度 unlock はできない（引き直せない・二重に払わない）', !again.ok && again.state.offer === u.state.offer && again.state.kakera === u.state.kakera, again.reason);
      const ld = L.loadSave(L.makeSave(u.state));
      check('offer は保存で残る（読み直しても同じ候補・phase choose・かけらは払ったまま）', ld && J(ld.offer) === J(u.state.offer) && ld.phase === 'choose' && ld.kakera === u.state.kakera && J(L.loadSave(L.makeSave(ld)).offer) === J(u.state.offer), ld && ld.offer);
      check('choose の k が候補の外・2択でないときの choose は ok:false', !L.choose(u.state, 2).ok && !L.choose(u.state, '0').ok && !L.choose(s, 0).ok, null);
      const one = L.unlock(mk(L, { kakera: 9e15, slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })), bench: [{ id: 'beam', lv: 4 }] }));
      check('残り 1 つのときは候補 1 つ（[id]）・choose(1) は ok:false・choose(0) で ひかえ へ', one.ok && J(one.state.offer) === J(['fire']) && !L.choose(one.state, 1).ok && L.choose(one.state, 0).to === 'bench', one.state.offer);
      const poor = L.unlock(mk(L, { kakera: 10 }));
      check('かけらが足りないと unlock は ok:false・reason money（払わない）', !poor.ok && poor.reason === 'money' && poor.state.kakera === 10, poor.reason);
      let bnc = { ...mk(L, { kakera: 400 }), phase: 'bounce', wait: 1 };
      const cb = L.choose(L.unlock(bnc).state, 0);
      check('はね返し・クリアの演出の間に選んだら、その演出の続きにもどる', cb.ok && cb.state.phase === 'bounce', cb.state.phase);
      const up = L.upgrade(mk(L, { kakera: 1000, slots: [{ id: 'shot', lv: 9 }] }), 0);
      check('upgrade：値段を払って Lv+1、Lv10 で evolve の出来事', up.ok && up.state.slots[0].lv === 10 && up.state.kakera === 1000 - L.upCost('shot', 9) && J(up.events) === J([{ kind: 'evolve', slot: 0, lv: 10 }]), up);
      const upm = L.upgrade(mk(L, { kakera: 0 }), 0), upx = L.upgrade(mk(L, { kakera: 9e15, slots: [{ id: 'shot', lv: 99 }] }), 0);
      check('upgrade：足りないと money、Lv99 で max（何も変わらない）', !upm.ok && upm.reason === 'money' && !upx.ok && upx.reason === 'max' && upx.state.kakera === 9e15, [upm.reason, upx.reason]);
    },
  },
  {
    id: 'KL8', tier: 'smoke', node: true, title: 'ほしくだき：場を押す API が無い（poke・retryNow なし）、公開の関数は §4.2 のものだけ、bounce は 2 秒・clear は 1.5 秒で自動で fly へ',
    run({ check, root }) {
      const L = load(root);
      const keys = Object.keys(L);
      check('AsteroidLogic に poke・retryNow・tap・touch・skip などの「場を押す」関数が無い', !['poke', 'retryNow', 'tap', 'touch', 'skip', 'skipBounce', 'POKE_COOLDOWN'].some((k) => k in L), keys.filter((k) => /poke|retry|tap|touch|skip/i.test(k)));
      const fns = keys.filter((k) => typeof L[k] === 'function').sort();
      const allowed = ['affOf', 'cellHp', 'cellHpAt', 'cellValue', 'choose', 'dmg', 'dpsOf', 'formatKakera', 'hpMul', 'loadSave', 'makeSave', 'matOf', 'newGame', 'progressOf', 'reserveSwap', 'saveVersionOf', 'shapeOf', 'simulate', 'slotCostOf', 'starInfo', 'step', 'swapChoicesOf', 'turretsOf', 'unlock', 'upCost', 'upCostOf', 'upgrade', 'validateBest', 'valMul'].sort();
      check('公開している関数は契約 §4.2 のもの（turretsOf・swapChoicesOf・reserveSwap・saveVersionOf を含む）＋計算の補助だけ', J(fns) === J(allowed), fns);
      let r = run(L, { ...mk(L), phase: 'bounce', wait: 2 }, 1.95);
      const p1 = r.s.phase;
      r = run(L, r.s, 0.1);
      check("'bounce' は 2 秒で自動で 'fly' へ", p1 === 'bounce' && r.s.phase === 'fly', [p1, r.s.phase]);
      r = run(L, { ...mk(L), phase: 'clear', wait: 1.5 }, 1.45);
      const p2 = r.s.phase;
      r = run(L, r.s, 0.1);
      check("'clear' は 1.5 秒で自動で 'fly' へ（次の星）", p2 === 'clear' && r.s.phase === 'fly' && r.s.star === 2, [p2, r.s.phase, r.s.star]);
    },
  },
  {
    id: 'KL9', tier: 'smoke', node: true, title: 'ほしくだき：保存 v:2（往復・星の途中 mid・クリアの演出中は次の星（予約を当てた形）・壊れた値の一覧（bench・swap・kfrac・slots）で落ちない）、v:1 はかけらだけ引き継ぐ（§8.4）、v:3 は null、saveVersionOf、validateBest',
    run({ check, root }) {
      const L = load(root);
      const s0 = mk(L, { star: 17, kakera: 123456, kfrac: 0.25, slots: [{ id: 'fire', lv: 12 }, { id: 'shot', lv: 33 }, { id: 'bolt', lv: 9 }], bench: [{ id: 'beam', lv: 4 }], swap: [{ slot: 2, id: 'beam' }], tries: 3, totals: { cells: 4000, stars: 16, kakera: 999999, chunks: 50 }, seed: 42, rng: 777 });
      const raw = L.makeSave(s0);
      const o = JSON.parse(raw);
      const N0 = s0.rock.cols * s0.rock.rows;
      check('makeSave の形は §8.2 v:2（v・star・kakera・kfrac・slots・bench・offer・swap・cleared・tries・totals・seed・rng・ms・bestT・mid）', J(Object.keys(o).sort()) === J(['bench', 'bestT', 'cleared', 'kakera', 'kfrac', 'mid', 'ms', 'offer', 'rng', 'seed', 'slots', 'star', 'swap', 'totals', 'tries', 'v']) && o.v === 2 && o.kfrac === 0.25 &&
        J(o.slots) === J([{ id: 'fire', lv: 12 }, { id: 'shot', lv: 33 }, { id: 'bolt', lv: 9 }]) && J(o.bench) === J([{ id: 'beam', lv: 4 }]) && J(o.swap) === J([{ slot: 2, id: 'beam' }]) &&
        o.mid.mats.length === N0 && o.mid.hp.length === N0 && /^[0-4]+$/.test(o.mid.mats) && /^[09]+$/.test(o.mid.hp), Object.keys(o));
      const s1 = L.loadSave(raw);
      check('makeSave → loadSave → makeSave で同じ（slots の [0] が たま でなくても・ひかえ・予約も）', L.makeSave(s1) === raw && J(s1.rock.mats) === J(s0.rock.mats) && s1.phase === 'fly' && s1.rock.y === s0.rock.y && s1.turrets.length === 3 && s1.hold === false, null);
      let sm = mk(L, { star: 6, seed: 5, slots: [{ id: 'shot', lv: 30 }, { id: 'bomb', lv: 20 }] });
      sm = run(L, sm, 25).s;
      const rawM = L.makeSave(sm), om = JSON.parse(rawM), sm2 = L.loadSave(rawM);
      const hpOk = sm.rock.mats.every((m, i) => !m || (sm2.rock.hp[i] >= sm.rock.hp[i] - 1e-9 && sm2.rock.hp[i] <= sm.rock.hp[i] + L.cellHpAt(sm, i) / 9 + 1e-9));
      check('星の途中を保存すると、開き直しても残りのマス・位置・体力（弱くならない側に 9 段）がもどる', sm.phase === 'fly' && sm.rock.left < sm.rock.total && sm2.rock.left === sm.rock.left && J(sm2.rock.mats) === J(sm.rock.mats) && near(sm2.rock.y, sm.rock.y, 0.01) && sm2.rock.total === sm.rock.total && near(sm2.rock.value, sm.rock.value, 1e-6) && hpOk && sm2.phase === 'fly', [sm.rock.left, sm2.rock.left]);
      const big = L.makeSave(mk(L, { star: 30 }));
      check('星の途中の保存は小さい（星 30 の 48×41 の大きな星でも 6KB 未満）', big.length < 6144 && rawM.length < 6144, big.length);
      const fresh = (x) => x && x.rock.left === x.rock.total && x.rock.y === mk(L, { star: 6, seed: 5 }).rock.y && x.star === 6 && x.kakera === om.kakera;
      const midBad = [
        ['mats の長さが違う', { ...om.mid, mats: om.mid.mats.slice(1) }],
        ['mats に 5', { ...om.mid, mats: '5' + om.mid.mats.slice(1) }],
        ['mats に最初の形に無いマス', { ...om.mid, mats: om.mid.mats.replace(/^0/, '1') }],
        ['mats の種類を変えた', { ...om.mid, mats: om.mid.mats.replace(/[234]/, (c) => (c === '2' ? '3' : '2')) }],
        ['マスが 0 個', { ...om.mid, mats: '0'.repeat(om.mid.mats.length) }],
        ['y が数でない', { ...om.mid, y: 'x' }],
        ['mid が配列', [1, 2]],
        ['mid が文字', 'abc'],
      ].filter(([, m]) => !fresh(L.loadSave(JSON.stringify({ ...om, mid: m })))).map(([nm]) => nm);
      check('mid が壊れていたら星の最初から（落ちない・ほかの進みは残す）', midBad.length === 0 && om.mid.mats.startsWith('0') && /[234]/.test(om.mid.mats), midBad);
      const yBig = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, y: 1e9 } }));
      check('mid の y が大きすぎても、一番下のマスはバリアの手前（すぐ はね返らない）', yBig.rock.left === sm.rock.left && L.progressOf(yBig).distance > 0 && L.step(yBig, L.STEP).events.every((e) => e.kind !== 'bounce'), L.progressOf(yBig));
      const full = (x) => x.rock.mats.every((m, i) => !m || near(x.rock.hp[i], L.cellHpAt(x, i), 1e-9));
      const hpBad = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, hp: 'x' } }));
      check('mid の hp だけ壊れていたら、残りのマスはそのまま・体力は満タン', hpBad.rock.left === sm.rock.left && full(hpBad), null);
      // クリアの演出中の保存：次の星・予約を当てた slots・bench と swap []（はじめての星 30 だけは星 30 のまま・予約も残す）
      let cs = lastCell(L, mk(L, { star: 7, tries: 3, slots: [{ id: 'shot', lv: 7 }, { id: 'beam', lv: 2 }], bench: [{ id: 'fire', lv: 11 }] }));
      cs = L.reserveSwap(cs, 1, 'fire').state;
      const cl = until(L, cs, (e) => e.kind === 'clear', 3);
      const oc = JSON.parse(L.makeSave(cl.s));
      check('クリアの演出中の保存は次の星（tries 1・mid なし）で、予約を当てた形（ほのお Lv11 が砲台・ビーム Lv2 が ひかえ・swap []）', cl.s.phase === 'clear' && oc.star === 8 && oc.tries === 1 && oc.mid === undefined && J(oc.slots) === J([{ id: 'shot', lv: 7 }, { id: 'fire', lv: 11 }]) && J(oc.bench) === J([{ id: 'beam', lv: 2 }]) && J(oc.swap) === J([]) && J(cl.s.swap) === J([{ slot: 1, id: 'fire' }]), [oc.star, oc.slots, oc.bench, oc.swap]);
      const c30 = until(L, L.reserveSwap(lastCell(L, mk(L, { star: 30, slots: [{ id: 'shot', lv: 7 }], bench: [{ id: 'fire', lv: 11 }] })), 0, 'fire').state, (e) => e.kind === 'clear', 3);
      const o30 = JSON.parse(L.makeSave(c30.s));
      check('はじめての星 30 のクリアだけはエンディングを見せるため星 30 のまま（予約もそのまま）', c30.s.phase === 'clear' && o30.star === 30 && o30.mid === undefined && J(o30.swap) === J([{ slot: 0, id: 'fire' }]), [o30.star, o30.swap]);
      let bo = mk(L, { star: 4 });
      bo = { ...bo, rock: { ...bo.rock, y: bo.rock.y + 1000 } };
      const bb = L.step(bo, L.STEP);
      const ob = JSON.parse(L.makeSave(bb.state));
      check('はね返し中の保存は mid なし（開き直すと星の最初から・tries は増えたまま）', bb.state.phase === 'bounce' && ob.mid === undefined && ob.tries === 2 && L.loadSave(L.makeSave(bb.state)).rock.left === bb.state.rock.total, [bb.state.phase, ob.tries]);
      // おかしな形
      const base = { v: 2, star: 5, kakera: 100, kfrac: 0, slots: [{ id: 'shot', lv: 3 }], bench: [], offer: null, swap: [], cleared: false, tries: 1, totals: { cells: 1, stars: 1, kakera: 1, chunks: 0 }, seed: 1, rng: 1 };
      const nulls = ['', '{', 'null', '[]', '[1,2]', '"x"', '42', 'true', JSON.stringify({ ...base, v: 3 }), JSON.stringify({ ...base, v: '2' }), JSON.stringify({ ...base, v: null }), JSON.stringify({ ...base, v: 0 }), JSON.stringify({ star: 3 }), undefined, null, 42];
      const nb = nulls.filter((x) => L.loadSave(x) !== null);
      check('JSON でない・配列・オブジェクトでない・v が 1・2 でない（v:3・文字・null・無し）は null（落ちない）', nb.length === 0, nb);
      const SV = [[JSON.stringify(base), 2], [JSON.stringify({ v: 1, kakera: 5 }), 1], [{ v: 2 }, 2], [JSON.stringify({ ...base, v: 3 }), null], ['{', null], ['[1]', null], [null, null], [JSON.stringify({ v: '1' }), null], [undefined, null]];
      const svb = SV.filter(([x, w]) => L.saveVersionOf(x) !== w).map(([x, w]) => ({ x, want: w, got: L.saveVersionOf(x) }));
      check('saveVersionOf：v:1 → 1・v:2 → 2・ほか（v:3・壊れた文字・null）→ null', svb.length === 0, svb);
      const fix = (patch) => { const r = L.loadSave(JSON.stringify({ ...base, ...patch })); return r && JSON.parse(L.makeSave(r)); };
      const six = ALL.map((id) => ({ id, lv: 1 }));
      const cases = [
        ['star 0 → 1', { star: 0 }, (x) => x.star === 1],
        ['star 1e9 → 9999', { star: 1e9 }, (x) => x.star === 9999],
        ['star "x" → 1', { star: 'x' }, (x) => x.star === 1],
        ['kakera -5 → 0', { kakera: -5 }, (x) => x.kakera === 0],
        ['kakera 1e30 → KAKERA_MAX', { kakera: 1e30 }, (x) => x.kakera === 9e15],
        ['kakera 12.9 → 12', { kakera: 12.9 }, (x) => x.kakera === 12],
        ['kfrac 1.5 → 0', { kfrac: 1.5 }, (x) => x.kfrac === 0],
        ['kfrac -0.1 → 0', { kfrac: -0.1 }, (x) => x.kfrac === 0],
        ['kfrac 文字 → 0', { kfrac: 'x' }, (x) => x.kfrac === 0],
        ['kfrac 0.75 は残す', { kfrac: 0.75 }, (x) => x.kfrac === 0.75],
        ['slots が配列でない → たま だけ', { slots: 'x' }, (x) => J(x.slots) === J([{ id: 'shot', lv: 1 }])],
        ['slots が空 → たま だけ', { slots: [] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 1 }])],
        ['slots の [0] が たま でなくてもそのまま（入れ替えられる）', { slots: [{ id: 'bolt', lv: 4 }, { id: 'shot', lv: 9 }] }, (x) => J(x.slots) === J([{ id: 'bolt', lv: 4 }, { id: 'shot', lv: 9 }])],
        ['重複は後ろを捨てる', { slots: [{ id: 'shot', lv: 2 }, { id: 'fire', lv: 5 }, { id: 'fire', lv: 50 }, { id: 'shot', lv: 77 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 2 }, { id: 'fire', lv: 5 }])],
        ['知らない id・形の違う要素は捨てる', { slots: [{ id: 'shot', lv: 2 }, { id: 'laser', lv: 5 }, null, 7, { lv: 3 }, { id: 'beam', lv: 2 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 2 }, { id: 'beam', lv: 2 }])],
        ['lv は 1〜99 の整数', { slots: [{ id: 'shot', lv: 500 }, { id: 'beam', lv: -3 }, { id: 'bomb', lv: 'x' }, { id: 'fire', lv: 2.5 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 99 }, { id: 'beam', lv: 1 }, { id: 'bomb', lv: 1 }, { id: 'fire', lv: 2 }])],
        ['5 つ以上の砲台は 4 つまで、残りは ひかえ へ（捨てない）', { slots: six }, (x) => x.slots.length === 4 && J(x.bench) === J([{ id: 'beam', lv: 1 }, { id: 'fire', lv: 1 }]) && x.offer === null],
        ['bench が配列でない → []', { bench: 'x' }, (x) => J(x.bench) === J([])],
        ['bench の重複・slots と重なる・知らない id は捨てる', { slots: [{ id: 'shot', lv: 3 }], bench: [{ id: 'fire', lv: 4 }, { id: 'shot', lv: 9 }, { id: 'fire', lv: 8 }, { id: 'laser', lv: 1 }, null, { id: 'bomb', lv: 300 }] }, (x) => J(x.bench) === J([{ id: 'fire', lv: 4 }, { id: 'bomb', lv: 99 }])],
        ['slots と bench を合わせて 6 つまで（7 つ以上は重複なので捨てる）', { slots: six.slice(0, 4), bench: [...six, { id: 'fire', lv: 3 }] }, (x) => x.slots.length + x.bench.length === 6 && J(x.bench) === J([{ id: 'beam', lv: 1 }, { id: 'fire', lv: 1 }])],
        ['swap が配列でない → []', { swap: { slot: 0, id: 'fire' } }, (x) => J(x.swap) === J([])],
        ['swap の id が ひかえ に無い → 捨てる', { bench: [{ id: 'fire', lv: 2 }], swap: [{ slot: 0, id: 'beam' }, { slot: 0, id: 'shot' }] }, (x) => J(x.swap) === J([])],
        ['swap の枠が範囲の外・整数でない → 捨てる', { bench: [{ id: 'fire', lv: 2 }], swap: [{ slot: 1, id: 'fire' }, { slot: -1, id: 'fire' }, { slot: 0.5, id: 'fire' }] }, (x) => J(x.swap) === J([])],
        ['同じ枠・同じ id の予約は後ろを捨てる', { slots: [{ id: 'shot', lv: 1 }, { id: 'bolt', lv: 1 }], bench: [{ id: 'fire', lv: 2 }, { id: 'beam', lv: 1 }], swap: [{ slot: 0, id: 'fire' }, { slot: 0, id: 'beam' }, { slot: 1, id: 'fire' }, { slot: 1, id: 'beam' }] }, (x) => J(x.swap) === J([{ slot: 0, id: 'fire' }, { slot: 1, id: 'beam' }])],
        ['offer が持っている武器（砲台・ひかえ）→ 作り直す（払い済み）', { bench: [{ id: 'bolt', lv: 1 }], offer: ['shot', 'bolt'] }, (x) => Array.isArray(x.offer) && x.offer.length === 2 && !x.offer.includes('shot') && !x.offer.includes('bolt')],
        ['offer が知らない id・同じ2つ → 作り直す', { offer: ['bolt', 'bolt'] }, (x) => x.offer[0] !== x.offer[1] && x.offer.every((id) => ALL.includes(id))],
        ['正しい offer は残す', { offer: ['fire', 'beam'] }, (x) => J(x.offer) === J(['fire', 'beam'])],
        ['残り 1 つなら offer は候補 1 つ', { slots: six.slice(0, 4), bench: [six[4]], offer: ['fire', 'beam'] }, (x) => J(x.offer) === J(['fire'])],
        ['6 種類持っていれば offer は null', { slots: six.slice(0, 4), bench: six.slice(4), offer: ['beam', 'fire'] }, (x) => x.offer === null],
        ['cleared と star > 30 の食い違い → cleared true', { star: 40, cleared: false }, (x) => x.cleared === true],
        ['cleared が文字 → false', { cleared: 'yes' }, (x) => x.cleared === false],
        ['tries 0 → 1', { tries: 0 }, (x) => x.tries === 1],
        ['totals が壊れている → 0', { totals: { cells: -1, stars: 'x', kakera: null } }, (x) => J(x.totals) === J({ cells: 0, stars: 0, kakera: 0, chunks: 0 })],
        ['seed・rng が壊れている → 数に直す', { seed: 'x', rng: -1 }, (x) => Number.isInteger(x.seed) && Number.isInteger(x.rng) && x.seed >= 0 && x.rng >= 0],
      ];
      const cb = cases.filter(([, p, ok]) => { const x = fix(p); return !x || !ok(x); }).map(([name, p]) => ({ name, got: fix(p) }));
      check('v:2 はフィールドごとに直す（星・かけら・kfrac・武器・ひかえ・予約・offer・cleared・tries・totals・seed）', cb.length === 0, cb);
      // v:1（作り直しの前）：かけらだけ引き継ぐ（§8.4）
      const v1 = { v: 1, star: 12, kakera: 50000, slots: [{ id: 'shot', lv: 40 }, { id: 'bolt', lv: 30 }, { id: 'beam', lv: 25 }, { id: 'fire', lv: 20 }], offer: null, cleared: false, tries: 3, totals: { cells: 9000, stars: 11, kakera: 99999, chunks: 70 }, seed: 77, rng: 5, ms: [25, 50], bestT: { 3: 120, 5: 200 }, mid: { y: 10, mats: '1', hp: '9', tt: 5 } };
      const l1 = L.loadSave(JSON.stringify(v1)), o1 = l1 && JSON.parse(L.makeSave(l1));
      check('v:1 は かけらだけ引き継ぐ：星 1・たま Lv1・ひかえ と予約なし・2択なし・tries 1・bestT と totals と ms は空・cleared false・種は引き継ぐ・保存は v:2', !!o1 && o1.v === 2 && o1.star === 1 && o1.kakera === 50000 && J(o1.slots) === J([{ id: 'shot', lv: 1 }]) && J(o1.bench) === J([]) && J(o1.swap) === J([]) && o1.offer === null && o1.tries === 1 &&
        J(o1.bestT) === J({}) && J(o1.ms) === J([]) && J(o1.totals) === J({ cells: 0, stars: 0, kakera: 0, chunks: 0 }) && o1.cleared === false && o1.seed === 77 && l1.phase === 'fly' && l1.rock.left === l1.rock.total, o1);
      const v1b = [['x', 0], [-3, 0], [1e30, 9e15], [12.7, 12], [null, 0], [undefined, 0]].filter(([k, w]) => { const x = L.loadSave(JSON.stringify({ ...v1, kakera: k })); return !x || x.kakera !== w || x.star !== 1; }).map(([k]) => k);
      check('v:1 の壊れた kakera は 0（大きすぎは KAKERA_MAX）、星 30 を越えた v:1 でも星 1 から（エンディングをもう一度見られる）', v1b.length === 0 && L.loadSave(JSON.stringify({ ...v1, star: 77, cleared: true })).cleared === false, v1b);
      check('オブジェクトのままでも読める（文字列でなくても）', L.loadSave({ ...base })?.star === 5, null);
      const VB = [[5, 5], ['12', 12], [3.9, 3], [-1, 0], [1e9, 9999], ['x', 0], [null, 0], [undefined, 0], [NaN, 0], ['', 0], [{}, 0], [[], 0], ['  7 ', 7]];
      const vb = VB.filter(([x, w]) => L.validateBest(x) !== w).map(([x, w]) => ({ x, want: w, got: L.validateBest(x) }));
      check('validateBest は 0〜STAR_MAX の整数（おかしな値は 0）', vb.length === 0, vb);
      check('makeSave におかしな値 → null（落ちない）', [null, undefined, 5, 'x', {}, { star: 1 }].every((x) => L.makeSave(x) === null), null);
    },
  },
  {
    id: 'KL10', tier: 'smoke', node: true, title: 'ほしくだき：決定的・イミュータブル（凍らせた state でも動く・元を変えない。choose・reserveSwap も）・コピーオンライト・例外を出さない（おかしな引数の一覧）',
    run({ check, root }) {
      const L = load(root);
      const play = () => {
        let s = mk(L, { star: 12, kakera: 5000, slots: [{ id: 'shot', lv: 20 }, { id: 'bomb', lv: 10 }, { id: 'fire', lv: 10 }, { id: 'bolt', lv: 10 }], bench: [{ id: 'beam', lv: 10 }] });
        const evs = [];
        for (let i = 0; i < 600; i++) { const r = L.step(s, L.STEP); s = r.state; evs.push(...r.events); if (i % 60 === 0) { const u = L.upgrade(s, i % 4); if (u.ok) s = u.state; } }
        return J([s, evs]);
      };
      const A = play(), B = play();
      check('同じ入力なら同じ結果（決定的。20 秒・強くするを混ぜて）', A === B && A.length > 1000, A.length);
      const s = deepFreeze(mk(L, { star: 12, kakera: 1e6, slots: [{ id: 'shot', lv: 20 }, { id: 'bomb', lv: 10 }, { id: 'fire', lv: 10 }, { id: 'beam', lv: 10 }], bench: [{ id: 'bolt', lv: 3 }] }));
      const before = J(s);
      let ok = true, err = null, cur = s, n = 0;
      try {
        for (let i = 0; i < 300; i++) { const r = L.step(cur, L.STEP); n += r.events.length; deepFreeze(r.state); cur = r.state; }
        const u = L.upgrade(s, 1); const k = L.unlock(cur);
        const rs = L.reserveSwap(s, 2, 'bolt');
        const s3 = deepFreeze(mk(L, { star: 12, kakera: 1e6, slots: [{ id: 'shot', lv: 20 }, { id: 'bomb', lv: 10 }, { id: 'fire', lv: 10 }] }));
        const b3 = J(s3);
        const k3 = L.unlock(s3);
        const k3s = deepFreeze(k3.state), b3k = J(k3s);
        const c = L.choose(k3s, 1);
        ok = u.ok && k.ok === false && k.reason === 'money' && rs.ok && J(rs.state.swap) === J([{ slot: 2, id: 'bolt' }]) && k3.ok && k3s.phase === 'choose' && c.ok && c.state.slots.length === 4 && c.state.slots[3].id === k3s.offer[1] && c.state.phase === 'fly' && J(s3) === b3 && J(k3s) === b3k;
        L.progressOf(s); L.dpsOf(s, 0); L.makeSave(s); L.swapChoicesOf(s, 0);
      } catch (e) { ok = false; err = String(e); }
      check('凍らせた state を渡しても例外にならない（中で書き換えていない）・出来事も出る・unlock→choose・reserveSwap も凍らせたままできて元は変わらない', ok && n > 50, [err, n]);
      check('step・upgrade・reserveSwap のあとも元の state は変わらない（イミュータブル）', J(s) === before, null);
      const s2 = { ...mk(L), cd: [1e9] };
      const r1 = L.step(s2, L.STEP);
      check('マスが変わらない step ではマスの配列を写さない（コピーオンライト）', r1.state.rock.mats === s2.rock.mats && r1.state.rock.hp === s2.rock.hp && r1.state !== s2 && r1.state.rock !== s2.rock, null);
      const s3 = setRock(L, mk(L), ['r'], { hp: 0.01, x: 180 - 3.5, bottom: 300 });
      const r3 = until(L, s3, (e) => e.kind === 'break', 2);
      check('マスが欠けた step だけ配列を写す（元の配列は変わらない）', r3.hit && s3.rock.mats[0] === 1 && r3.s.rock.mats[0] === 0, null);
      const g = mk(L);
      const calls = [
        () => L.step(null, 0.1), () => L.step({}, 0.1), () => L.step(g, NaN), () => L.step(g, -1), () => L.step(g, 1e9), () => L.step(g, 'x'), () => L.step(g),
        () => L.step({ ...g, rock: null }, 0.1), () => L.step({ ...g, slots: 'x' }, 0.1), () => L.step({ ...g, rock: { ...g.rock, mats: [1] } }, 0.1),
        () => L.step({ ...g, turrets: null, bench: 'x', swap: 5, cd: null }, 0.1), () => L.step({ ...g, slots: [{ id: 'laser', lv: 1 }] }, 0.1),
        () => L.upgrade(null, 0), () => L.upgrade(g, 9), () => L.upgrade(g, -1), () => L.upgrade(g, '0'), () => L.upgrade(g, 0.5), () => L.upgrade(g),
        () => L.unlock(null), () => L.unlock({}), () => L.choose(null, 0), () => L.choose(g, 5),
        () => L.dpsOf(null, 0), () => L.dpsOf(g, 7), () => L.upCostOf(g, 7), () => L.upCostOf(null), () => L.slotCostOf(null), () => L.slotCostOf({ slots: 3 }),
        () => L.progressOf(null), () => L.progressOf({}), () => L.starInfo('x'), () => L.formatKakera({}), () => L.formatKakera(), () => L.makeSave(null), () => L.loadSave('{"v":2,"slots":{"0":1}}'),
        () => L.validateBest({}), () => L.newGame('x'), () => L.newGame(NaN), () => L.newGame(-5), () => L.newGame(1e20),
        () => L.simulate('bogus', { maxSec: 3, seed: 'x', start: 5 }), () => L.simulate('idle', { maxSec: 5, start: { star: 'x', slots: 7 } }), () => L.dmg('laser', 1), () => L.upCost('laser', 1), () => L.affOf('shot', 'wood'), () => L.cellHp(1, 'wood'), () => L.shapeOf('x', 1),
        () => L.turretsOf(), () => L.turretsOf('x'), () => L.turretsOf(9), () => L.swapChoicesOf(null, 0), () => L.swapChoicesOf(g, 'x'), () => L.reserveSwap(null, 0, 'fire'), () => L.reserveSwap(g, 0, {}), () => L.reserveSwap(g), () => L.saveVersionOf({ toString: null }),
        () => L.loadSave('{"v":2,"bench":{"length":3},"swap":[null,{"slot":"0"}]}'), () => L.loadSave('{"v":1,"kakera":{}}'),
      ];
      const thrown = [];
      calls.forEach((f, k) => { try { f(); } catch (e) { thrown.push([k, String(e)]); } });
      check('おかしな引数の一覧（58 種）で例外を出さない', thrown.length === 0 && calls.length >= 58, thrown);
      check('おかしな state の step は null、おかしな slot の upgrade は ok:false、turretsOf の範囲外は null、reserveSwap のおかしな値は ok:false', L.step(null, 0.1) === null && L.step({}, 0.1) === null && L.upgrade(g, 9).ok === false && L.upgrade(null, 0).ok === false && L.unlock(null).ok === false && L.choose(null, 0).ok === false &&
        L.turretsOf(0) === null && L.turretsOf(5) === null && L.turretsOf(2.5) === null && L.reserveSwap(null, 0, 'fire').ok === false && L.swapChoicesOf(g, 3) === null, null);
      const dts = [NaN, -1, 'x', undefined].map((d) => L.step(g, d).state.t);
      check('dt は 0〜0.1 に丸める（NaN・負・文字は 0、1e9 は 0.1）', dts.every((t) => t === 0) && near(L.step(g, 1e9).state.t, 0.1), dts);
      check('newGame：種なしは 1、文字・NaN は null、大きな数・負も 32bit に直して動く。始めは たま 1 台・ひかえ と予約なし・hold false', L.newGame().seed === 1 && L.newGame('x') === null && L.newGame(NaN) === null && Number.isInteger(L.newGame(1e20).seed) && L.newGame(-5).seed === 5 &&
        J(L.newGame(3).slots) === J([{ id: 'shot', lv: 1 }]) && J(L.newGame(3).bench) === J([]) && J(L.newGame(3).swap) === J([]) && L.newGame(3).hold === false && L.newGame(3).turrets.length === 1, null);
    },
  },
  {
    id: 'KL11', tier: 'full', node: true, title: 'ほしくだき：自動プレイ（§3.10・§17.1 の軽い版：greedy 星 12・idle 20 分・30 秒に 1 つ買う人・random・worst・開き直し・入れ替えの効き目）',
    run({ check, root }) {
      const L = load(root);
      const g = L.simulate('greedy', { seed: 1, maxStar: 12 });
      check('greedy：例外なしで星 12 まで届く', !g.error && g.stars.length === 12 && g.endSec !== null, g.error || g.stars.length);
      check('最初の買い物まで 20 秒以内', g.firstBuySec !== null && g.firstBuySec <= 20, g.firstBuySec);
      const first = g.stars.filter((x) => x.star <= 3), norm = g.stars.filter((x) => !x.boss && x.star > 3), boss = g.stars.filter((x) => x.boss);
      check('1回の挑戦：最初の 3 星は 60〜220 秒、ふつうの星は 120〜360 秒、大きな星は 420 秒以内（目安：最初 1.5〜3 分・ふつう 3〜5 分・大きな星 4〜6 分。§3.10 の測った値を参照）',
        first.every((x) => x.clearSec >= 60 && x.clearSec <= 220) && norm.every((x) => x.clearSec >= 120 && x.clearSec <= 360) && boss.every((x) => x.clearSec >= 150 && x.clearSec <= 420), g.stars.map((x) => Math.round(x.clearSec)));
      check('やり直し：ふつうの星は平均 0.3 回以下、どの星も 5 回以内', norm.reduce((a, x) => a + x.tries - 1, 0) / norm.length <= 0.3 && g.stars.every((x) => x.tries <= 5), g.stars.map((x) => x.tries));
      check('2択を3回以上選んで星 12 までに 4 台・5 つ目の武器（ひかえ）も星 10〜15 で手に入る、弾は SHOTS_MAX 以下', g.picks.length >= 3 && g.final.slots.length === 4 && g.gotAt.some((x) => x.n === 5 && x.star >= 10 && x.star <= 15) && g.shotsMax <= L.SHOTS_MAX && g.shotsMax > 0, [g.picks.length, g.gotAt, g.shotsMax]);
      const gaps = g.stars.map((x) => x.sec / Math.max(1, x.buys));
      check('買い物の間隔：星ごとの平均が 45 秒以内・全体の平均 30 秒以内', gaps.every((x) => x <= 45) && g.buyGaps.avg <= 30, [gaps.map(Math.round), g.buyGaps]);
      const lefts = g.stars.map((x) => x.leftRatio).sort((a, b) => a - b);
      const lmed = lefts[Math.floor(lefts.length / 2)];
      check('地球までの近さがクリアまでに動く：クリアのときの残りの道のりの中央値が 0.35〜0.8（目安 0.4〜0.7）、どの星も 1 未満', lmed >= 0.35 && lmed <= 0.8 && g.stars.every((x) => x.leftRatio < 1), lefts);
      check('はなれて くだける が 1 つの星で平均 3 回以上（細い所を切る見せ場）', g.stars.reduce((a, x) => a + x.chunks, 0) / g.stars.length >= 3, g.stars.map((x) => x.chunks));
      const i1 = L.simulate('idle', { seed: 2, maxStar: 1, maxSec: 400 });
      check('星1 は何も買わなくても1回目でクリア、3 分以内、残りの道のり 3 割以上', i1.stars.length === 1 && i1.stars[0].tries === 1 && i1.stars[0].clearSec <= 180 && i1.stars[0].leftRatio >= 0.3 && i1.buys === 0, i1.stars[0]);
      const idle = L.simulate('idle', { seed: 1, maxSec: 1200 });
      const kb = idle.kakeraAtBounce;
      check('idle 20 分：例外なし・何も買わない・はね返されても止まらず、そのたびに かけら が増える', !idle.error && idle.buys === 0 && kb.length >= 3 && kb.every((k, i) => i === 0 || k > kb[i - 1]) && idle.t >= 1200 - 1, [idle.error, kb.length, kb.slice(0, 5)]);
      const slow = L.simulate('greedy', { seed: 1, maxStar: 12, buyEvery: 30 });
      const br = slow.bounces.map((b) => b.broken).sort((a, b) => a - b);
      const b30g = g.stars.map((x) => x.b30), b30s = slow.stars.map((x) => x.b30);
      check('前半のペース：どの星も最初の 30 秒で 15% 以上のマスが欠ける（greedy・30 秒に 1 つ買う人、星 12 まで）', b30g.length === 12 && slow.stars.length === 12 && b30g.every((x) => x >= 0.15) && b30s.every((x) => x >= 0.15), [b30g, b30s]);
      check('惜しい負け：30 秒に 1 つ買う人が負けたときの壊した割合の中央値が 35〜97%（目安 70〜95% は星 30 までで測る）', !slow.error && br.length >= 2 && br[Math.floor(br.length / 2)] >= 0.35 && br[Math.floor(br.length / 2)] <= 0.97, br);
      const g3 = L.simulate('greedy', { seed: 3, maxStar: 12 });
      for (const pol of ['random', 'worst']) {
        const r = L.simulate(pol, { seed: 3, maxStar: 12 });
        check(`${pol}：星 12 まで詰まらず、greedy の 1.6 倍以内`, !r.error && r.endSec !== null && r.endSec <= g3.endSec * 1.6, [r.endSec, g3.endSec]);
      }
      const re = L.simulate('greedy', { seed: 1, maxStar: 12, reopenEvery: 180 });
      check('3 分ごとに閉じて開き直しても、星の途中の保存で greedy の 1.2 倍以内で星 12 まで進む', !re.error && re.endSec !== null && re.reopens >= 10 && re.endSec <= g.endSec * 1.2, [re.endSec, g.endSec, re.reopens]);
      // 入れ替えの効き目（§3.10）：greedy は星 16 までに入れ替えを使い、入れ替えなし（swap:false）より遅くならない
      const gs = L.simulate('greedy', { seed: 2, maxStar: 16 }), gn = L.simulate('greedy', { seed: 2, maxStar: 16, swap: false });
      check('入れ替え：greedy は ひかえ の武器へ入れ替える（1 回以上・swap の出来事）、swap:false より遅くならない（1.02 倍以内）、swap:false は入れ替えない', !gs.error && gs.swaps >= 1 && gn.swaps === 0 && gs.endSec <= gn.endSec * 1.02, [gs.swaps, gs.endSec, gn.endSec, gs.swapLog]);
      check('いなずまの枝分かれ：てつ の多い星で、1 回の当たるマスの数の中央値が BOLT_CELLS の 6 割以上', gs.boltMedian !== null && gs.boltMedian >= 0.6 && gs.boltCells > 50, [gs.boltMedian, gs.boltCells]);
    },
  },
  {
    id: 'KL12', tier: 'full', node: true, title: 'ほしくだき：1000 回の乱数の操作（強くする・開ける・選ぶ・入れ替えの予約・step の大きさ）で不変条件（turrets と slots の数・slots と bench が重ならず 6 以下・|ang| ≦ AIM_MAX・台の x は枠が増えたとき以外動かない・弾 ≦ SHOTS_MAX・かけら・totals）',
    run({ check, root }) {
      const L = load(root);
      let rnd = 20261023;
      const R = () => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296);
      let s = mk(L, { star: 8, kakera: 3000 });
      const bad = [];
      let ops = 0, steps = 0, leftUps = 0, swaps = 0, angs = 0;
      const tx = (st) => J(st.turrets.map((t) => [t.x, t.y]));
      for (let i = 0; i < 1000; i++) {
        const prev = s;
        const x = R();
        if (x < 0.13) { const u = L.upgrade(s, Math.floor(R() * 5)); if (u.ok) s = u.state; ops++; }
        else if (x < 0.19) { const u = L.unlock(s); if (u.ok) s = u.state; ops++; }
        else if (x < 0.24) { const c = L.choose(s, R() < 0.5 ? 0 : 1); if (c.ok) s = c.state; ops++; }
        else if (x < 0.28) { const k = Math.floor(R() * 5); const ch = L.swapChoicesOf(s, k); const id = ch ? ch[Math.floor(R() * ch.length)] : ALL[Math.floor(R() * 6)]; const r = L.reserveSwap(s, k, id); if (r.ok) s = r.state; ops++; }
        else if (x < 0.30) { s = { ...s, kakera: L.KAKERA_MAX - 3 }; }
        else {
          const dt = [0, L.STEP, 0.05, 0.1, 0.5, R() * 0.1][Math.floor(R() * 6)];
          const n = 1 + Math.floor(R() * 60);
          for (let k = 0; k < n; k++) {
            const r = L.step(s, dt);
            const restarted = r.events.some((e) => e.kind === 'bounce' || e.kind === 'clear') || (r.state.phase === 'fly' && s.phase !== 'fly');
            if (r.state.rock.left > s.rock.left && !restarted) bad.push({ i, why: 'left が増えた', a: s.rock.left, b: r.state.rock.left });
            if (r.state.rock.left > s.rock.left) leftUps++;
            if (r.state.slots.length === s.slots.length && tx(r.state) !== tx(s)) bad.push({ i, why: '台の x が動いた' });
            if (r.events.some((e) => e.kind === 'swap')) swaps++;
            if (r.state.turrets.some((t) => Math.abs(t.ang) > 1e-9)) angs++;
            if (r.state.phase === 'fly' && s.phase === 'fly' && r.events.some((e) => e.kind === 'swap')) bad.push({ i, why: '飛んでいる間に入れ替わった' });
            s = r.state; steps++;
          }
        }
        if (!intIn(s.kakera, 0, L.KAKERA_MAX) || !(s.kfrac >= 0 && s.kfrac < 1)) bad.push({ i, why: 'kakera/kfrac', v: [s.kakera, s.kfrac] });
        if (s.shots.length > L.SHOTS_MAX) bad.push({ i, why: 'shots', v: s.shots.length });
        for (const k of ['cells', 'stars', 'kakera', 'chunks']) if (!(s.totals[k] >= prev.totals[k]) || !Number.isFinite(s.totals[k])) bad.push({ i, why: 'totals ' + k });
        const ids = s.slots.map((y) => y.id).concat(s.bench.map((y) => y.id));
        if (!(s.slots.length >= 1 && s.slots.length <= 4 && new Set(ids).size === ids.length && ids.length <= 6 && s.slots.concat(s.bench).every((y) => intIn(y.lv, 1, 99)))) bad.push({ i, why: 'slots/bench', ids });
        if (!(s.turrets.length === s.slots.length && s.turrets.every((t, k) => Math.abs(t.ang) <= L.AIM_MAX + 1e-9 && near(t.x, L.turretsOf(s.slots.length)[k].x, 1e-9)))) bad.push({ i, why: 'turrets' });
        if (!(s.swap.every((p) => p.slot < s.slots.length && s.bench.some((b) => b.id === p.id)) && new Set(s.swap.map((p) => p.slot)).size === s.swap.length)) bad.push({ i, why: 'swap', swap: s.swap });
        if (!['fly', 'choose', 'bounce', 'clear', 'end'].includes(s.phase)) bad.push({ i, why: 'phase ' + s.phase });
        if (s.phase === 'choose' && !(Array.isArray(s.offer) && s.offer.length >= 1 && s.offer.length <= 2)) bad.push({ i, why: 'offer' });
        if (s.phase === 'end') s = L.loadSave(L.makeSave(s));
        if (bad.length > 5) break;
      }
      check('不変条件が 1000 回の操作のあいだ保たれる（やり直し・次の星・入れ替え・斜めの向きの場面も通る）', bad.length === 0 && ops > 100 && steps > 10000 && leftUps > 0 && swaps > 0 && angs > 100, { bad: bad.slice(0, 5), ops, steps, leftUps, swaps, angs, star: s.star });
    },
  },
  {
    id: 'KL13', tier: 'smoke', node: true, title: 'ほしくだき：区切り（壊した割合 25・50・75% で milestone とおまけ＝value×0.03・星ごとに各1回・やり直しでもらい直せない・保存と検証・次の星で元にもどる）',
    run({ check, root }) {
      const L = load(root);
      // その星の形のうち、上から K マス（番号の小さい順）だけ残し、砲台から一番近いマス 1 つだけ弱くして撃たせる
      const keepTop = (s, K) => {
        const cells = cellsOf(s).slice(0, K);
        const set = new Set(cells);
        const lastI = nearestTo(L, s, cells);
        const mats = s.rock.mats.map((m, i) => (set.has(i) ? m : 0));
        const hp = s.rock.hp.map((h, i) => (!set.has(i) ? 0 : i === lastI ? 0.001 : 1e12));
        return { ...s, rock: { ...s.rock, mats, hp, left: K, vy: 0, scan: null }, shots: [], burns: [] };
      };
      const s0 = mk(L, { star: 4, kakera: 10 });
      const T = s0.rock.total, mb = Math.floor(s0.rock.value * 0.03);
      const K1 = Math.floor(T * 0.5) + 1;
      const a = until(L, keepTop(s0, K1), (e) => e.kind === 'break', 3);
      const ms1 = ofKind(a.evs, 'milestone');
      const got = ofKind(a.evs, 'break').reduce((v, e) => v + e.value, 0) + ofKind(a.evs, 'chunk').reduce((v, e) => v + e.value, 0);
      check('1 マス欠けて 50% を超えると milestone 25 と 50 が1回ずつ（小さい順）・おまけは floor(value×0.03)・かけらに足される', J(ms1) === J([{ kind: 'milestone', pct: 25, bonus: mb }, { kind: 'milestone', pct: 50, bonus: mb }]) && mb > 0 && a.s.kakera === 10 + 2 * mb + Math.floor(got) && J(a.s.ms) === J([25, 50]), [ms1, a.s.kakera, a.s.ms]);
      const a2 = run(L, a.s, 1);
      check('同じ挑戦の中で、もう一度は出ない', ofKind(a2.evs, 'milestone').length === 0, ofKind(a2.evs, 'milestone'));
      const rb = run(L, { ...a2.s, rock: { ...a2.s.rock, y: a2.s.rock.y + 1000 } }, 2.2);
      check('はね返して星の最初からになっても、もらった区切り（ms）は残る（tries 2）', rb.s.phase === 'fly' && rb.s.tries === 2 && rb.s.rock.left === rb.s.rock.total && J(rb.s.ms) === J([25, 50]) && ofKind(rb.evs, 'bounce').length === 1, [rb.s.phase, rb.s.tries, rb.s.ms]);
      const K2 = Math.floor(T * 0.25) + 1;
      const c = until(L, keepTop(rb.s, K2), (e) => e.kind === 'break', 3);
      const ms2 = ofKind(c.evs, 'milestone');
      check('やり直しの挑戦では 25・50 はもう出ず、75 だけ1回', J(ms2) === J([{ kind: 'milestone', pct: 75, bonus: mb }]) && J(c.s.ms) === J([25, 50, 75]), ms2);
      const o = JSON.parse(L.makeSave(c.s));
      check('保存に ms が入り、開き直しても残る', J(o.ms) === J([25, 50, 75]) && J(L.loadSave(JSON.stringify(o)).ms) === J([25, 50, 75]), o.ms);
      const fresh = (patch) => L.loadSave(JSON.stringify({ ...JSON.parse(L.makeSave(s0)), mid: undefined, ...patch }));
      const msCases = [[[25, 25, 99, '50', null, 75], [25, 75]], ['x', []], [{}, []], [null, []], [[75, 25], [25, 75]], [undefined, []]];
      const msBad = msCases.filter(([v, want]) => { const x = fresh({ ms: v }); return !x || J(x.ms) !== J(want); }).map(([v]) => v);
      check('保存の ms が壊れていたら 25・50・75 だけ残す', msBad.length === 0, msBad);
      const reo = L.loadSave(JSON.stringify({ ...o, ms: [] }));
      check('星の途中（mid）でもう超えている区切りは、ms が空でも「もらった」ことになる', reo && reo.rock.left === c.s.rock.left && J(reo.ms) === J([25, 50, 75]), reo && reo.ms);
      const d = until(L, keepTop(c.s, 1), (e) => e.kind === 'clear', 3);
      check('クリアの step でも区切りは重ならない・演出中の保存は次の星で ms 空', ofKind(d.evs, 'clear').length === 1 && ofKind(d.evs, 'milestone').length === 0 && J(JSON.parse(L.makeSave(d.s)).ms) === J([]), d.evs.map((e) => e.kind));
      const d2 = run(L, d.s, 1.6);
      check('次の星へ進むと ms は空', d2.s.star === 5 && d2.s.phase === 'fly' && J(d2.s.ms) === J([]), [d2.s.star, d2.s.ms]);
      const e = until(L, keepTop(mk(L, { star: 4 }), 1), (x) => x.kind === 'clear', 3);
      check('最後の 1 マスで一気に 100% になったら、25・50・75 を小さい順に clear の前に出す', J(e.evs.filter((x) => x.kind === 'milestone' || x.kind === 'clear').map((x) => x.pct || x.kind)) === J([25, 50, 75, 'clear']), e.evs.map((x) => x.kind));
    },
  },
  {
    id: 'KL14', tier: 'smoke', node: true, title: 'ほしくだき：クリアの時間とベスト（clear に time・best・distance、星ごとの bestT を保存・検証・200 件まで、時間は最後の挑戦の始めから・星の途中の保存でも続きから）',
    run({ check, root }) {
      const L = load(root);
      const last = (o, extra = {}) => lastCell(L, { ...mk(L, o), ...extra });
      const r1 = (x) => Math.max(0.1, Math.round(x * 10) / 10);
      const s1 = last({ star: 4, ms: [25, 50, 75] }, { t: 500, tryAt: 380 });
      let prev = s1, cl = null, r;
      for (let k = 0; k < 90 && !cl; k++) { r = L.step(prev, L.STEP); cl = r.events.find((e) => e.kind === 'clear') || null; if (!cl) prev = r.state; }
      check('clear に time（最後の挑戦の始めから・0.1 秒に丸め）・best（はじめては null）・distance（0〜1）', !!cl && cl.time === r1(r.state.t - 380) && cl.time > 100 && cl.best === null && cl.distance > 0 && cl.distance <= 1 && near(cl.distance, L.progressOf(prev).distance, 0.01), [cl, L.progressOf(prev)]);
      check('はじめてのクリアで bestT にその星の時間が入る', r.state.bestT[4] === cl.time && Object.keys(r.state.bestT).length === 1 && J(s1.bestT) === J({}), r.state.bestT);
      const fast = until(L, last({ star: 4, bestT: { 4: 999, 9: 50 } }, { t: 0, tryAt: 0 }), (e) => e.kind === 'clear', 3);
      const cf = ofKind(fast.evs, 'clear')[0];
      check('前より速ければ best は前の値・bestT は新しい時間', cf.best === 999 && fast.s.bestT[4] === cf.time && cf.time < 999 && fast.s.bestT[9] === 50, [cf, fast.s.bestT]);
      const slow = until(L, last({ star: 4, bestT: { 4: 0.1 } }), (e) => e.kind === 'clear', 3);
      const cs = ofKind(slow.evs, 'clear')[0];
      check('前より遅ければ bestT は前のまま', cs.best === 0.1 && slow.s.bestT[4] === 0.1 && cs.time > 0.1, [cs, slow.s.bestT]);
      let b = mk(L, { star: 4 });
      b = { ...b, t: 100, tryAt: 0, rock: { ...b.rock, y: b.rock.y + 1000 } };
      const rb = run(L, b, 2.1);
      check('はね返し → やり直しの始めで tryAt が今になる', rb.s.phase === 'fly' && rb.s.tryAt > 101.9 && rb.s.tryAt <= rb.s.t, [rb.s.tryAt, rb.s.t]);
      const nx = run(L, slow.s, 1.6);
      check('次の星の始めでも tryAt が今になる', nx.s.star === 5 && nx.s.phase === 'fly' && nx.s.tryAt > slow.s.t && nx.s.tryAt <= nx.s.t, [nx.s.tryAt, nx.s.t]);
      const sv = JSON.parse(L.makeSave(fast.s));
      check('クリアの演出中の保存（次の星）にも、いま入ったベストが入る', sv.star === 5 && sv.bestT[4] === cf.time && sv.bestT[9] === 50, sv.bestT);
      const fl = { ...mk(L, { star: 6, seed: 3 }), t: 100, tryAt: 37.46 };
      const om = JSON.parse(L.makeSave(fl));
      const lo = L.loadSave(JSON.stringify(om));
      check('星の途中の保存に mid.tt が入り、開き直すと続きから数える', om.mid.tt === 62.5 && near(lo.t - lo.tryAt, 62.5, 1e-9), [om.mid.tt, lo.t - lo.tryAt]);
      const ttBad = [['x', 0], [-5, 0], [1e9, 1e7], [null, 0]].filter(([v, w]) => { const x = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, tt: v } })); return !x || !near(x.t - x.tryAt, w, 1e-9); }).map(([v]) => v);
      check('mid.tt が壊れていたら 0（大きすぎは 1e7 まで）', ttBad.length === 0, ttBad);
      const noMid = L.loadSave(JSON.stringify({ ...om, mid: undefined }));
      check('星の最初から始まるとき（mid なし）は tryAt = t', noMid.tryAt === noMid.t, [noMid.tryAt, noMid.t]);
      const bt = { 0: 5, 1: -1, 2: 'x', 3: 12.345, 10000: 4, abc: 3, 5: 0, 6: 1e9, 8: 0.04, '07': 5, 9: 61.25, 12: null };
      const lb = L.loadSave(JSON.stringify({ ...om, bestT: bt }));
      check('bestT の検証：キーは 1〜STAR_MAX の整数、値は正の有限の数（0.1 秒に丸め・1e7 まで）', J(lb.bestT) === J({ 3: 12.3, 8: 0.1, 9: 61.3 }), lb.bestT);
      check('bestT が配列・文字・null なら空', ['x', [1, 2], null, 5].every((v) => J(L.loadSave(JSON.stringify({ ...om, bestT: v })).bestT) === J({})), null);
      const many = {}; for (let k = 1; k <= 250; k++) many[k] = k;
      const keys = Object.keys(L.loadSave(JSON.stringify({ ...om, bestT: many })).bestT).map(Number);
      check('bestT は 200 件まで（番号の大きい星を残す）', keys.length === 200 && Math.min(...keys) === 51 && Math.max(...keys) === 250, [keys.length, Math.min(...keys)]);
      check('bestT 200 件・ひかえ・予約があっても保存は小さい（星 30 の大きな星の途中で 8KB 未満）', L.makeSave(L.loadSave(JSON.stringify({ ...JSON.parse(L.makeSave(mk(L, { star: 30, slots: ALL.slice(0, 4).map((id) => ({ id, lv: 99 })), bench: ALL.slice(4).map((id) => ({ id, lv: 99 })), swap: [{ slot: 0, id: 'beam' }] }))), bestT: Object.fromEntries(Array.from({ length: 200 }, (_, k) => [k + 1, 1234.5])) }))).length < 8192, null);
    },
  },
  {
    id: 'KL15', tier: 'smoke', node: true, title: 'ほしくだき：hit の相性の倍率 aff・もろい底（下の行ほど体力が少ない・星の重さは同じ）・cellHpAt・starInfo の main',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, { star: 12, slots: [{ id: 'shot', lv: 1 }, { id: 'spread', lv: 1 }, { id: 'bolt', lv: 1 }, { id: 'beam', lv: 1 }] });
      s = setRock(L, s, ['rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', 'cccccccccccccccccccccccccccccccc', 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'], { hp: 1e12, bottom: 300 });
      const r = run(L, s, 4);
      const hits = ofKind(r.evs, 'hit');
      const badAff = hits.filter((e) => e.aff !== L.affOf(e.w, e.mat));
      const affs = new Set(hits.map((e) => e.aff));
      check('hit に相性の倍率 aff（affOf(w, mat) と同じ）。得意（>1）と苦手（<1）とふつう（1）が出る', hits.length > 20 && badAff.length === 0 && [...affs].some((a) => a > 1) && [...affs].some((a) => a < 1) && affs.has(1), [hits.length, badAff.slice(0, 3), [...affs]]);
      const soft = [];
      for (const n of [1, 3, 4, 7, 10, 12, 15, 30, 31, 77]) {
        const g = mk(L, { star: n, seed: 9 });
        const R = g.rock, rh = R.rowHp;
        let w0 = 0, w1 = 0;
        for (let i = 0; i < R.mats.length; i++) if (R.mats[i]) { w0 += L.cellHp(n, MATN[R.mats[i]]); w1 += R.hp[i]; }
        const rowsUsed = [];
        for (let rr = R.rows - 1; rr >= 0; rr--) if (R.mats.slice(rr * R.cols, rr * R.cols + R.cols).some((m) => m)) rowsUsed.push(rh[rr]);
        const mono = rowsUsed.every((v, k) => k === 0 || v >= rowsUsed[k - 1] - 1e-12);
        const ratio = rowsUsed[rowsUsed.length - 1] / rowsUsed[0];
        const hpOk = R.mats.every((m, i) => !m || near(R.hp[i], L.cellHpAt(g, i), 1e-9));
        if (!(near(w1 / w0, 1, 1e-9) && mono && near(ratio, 1 / 0.05, 1e-6) && hpOk && rh.length === R.rows)) soft.push({ n, w: w1 / w0, mono, ratio });
      }
      check('もろい底：一番下の行は一番上の行の 0.05 倍の体力、下から上へ減らない、体力の合計は倍率なしと同じ、hp は cellHpAt と同じ', soft.length === 0, soft);
      const g4 = mk(L, { star: 4 });
      const R4 = g4.rock;
      let below = 0;
      for (let i = 0; i < R4.mats.length; i++) if (R4.mats[i] && R4.rowHp[Math.floor(i / R4.cols)] < R4.rowHp[0] * 0.06) below++;
      check('もろい行のマスは星の 1〜3 割', below / R4.total >= 0.1 && below / R4.total <= 0.3, below / R4.total);
      check('cellHpAt：空のマス・おかしな引数は null', L.cellHpAt(g4, g4.rock.mats.indexOf(0)) === null && L.cellHpAt(g4, -1) === null && L.cellHpAt(null, 0) === null && L.cellHpAt(g4, 1e6) === null && L.cellHpAt(g4, 'x') === null, null);
      const mains = [1, 3, 6, 7, 8, 12].map((n) => [n, L.starInfo(n).main, L.starInfo(n).tag]);
      check('starInfo の main と tag が合う', mains.every(([, m, t]) => (m === null ? t === '' : m === 'iron' ? t === 'てつが おおい' : m === 'ice' && t === 'こおりが おおい')) && L.starInfo(1).main === null && L.starInfo(3).main === 'iron', mains);
    },
  },
  {
    id: 'KL16', tier: 'smoke', node: true, title: 'ほしくだき：砲台（turretsOf が等間隔で弧の上・向きは TURN_SPEED より速く回らない・AIM_TOL に入るまで撃たない・±AIM_MAX・武器ごとのねらい：たま＝その砲台から一番近いマス、いなずま＝一番近い てつ）',
    run({ check, root }) {
      const L = load(root);
      const pos = [1, 2, 3, 4].map((n) => L.turretsOf(n));
      const arcY = (x) => 500 + 12 * ((x - 180) / 180) ** 2;
      const okPos = pos.every((p, k) => p.length === k + 1 && p.every((t, j) => near(t.x, 360 * (j + 1) / (k + 2), 1e-9) && near(t.y, arcY(t.x), 1e-9)));
      check('turretsOf(n)：x は 360 × (k+1)/(n+1)（4 台で 72・144・216・288、1 台で 180）、y は弧の上（TURRET_Y + ARC_SAG × ((x−180)/180)²）', okPos && J(pos[3].map((t) => t.x)) === J([72, 144, 216, 288]) && pos[0][0].x === 180 && pos[0][0].y === 500, pos);
      check('turretsOf の範囲外（0・5・小数・文字）は null', [0, 5, 2.5, 'x', null].every((n) => L.turretsOf(n) === null), null);
      const s4 = mk(L, { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })) });
      check('state の turrets は slots と同じ数・turretsOf と同じ位置・向き 0 から', s4.turrets.length === 4 && s4.turrets.every((t, k) => near(t.x, pos[3][k].x, 1e-9) && near(t.y, pos[3][k].y, 1e-9) && t.ang === 0), s4.turrets);
      // 回る速さ：左の低い所の星（約 −40°）。1 step に 12° まで、向きが 4° 以内になるまで撃たない
      let s = mk(L);
      s = setRock(L, s, ['rrr', 'rrr'], { hp: 1e9, x: 20, bottom: 330 });
      let cur = s, firstFire = -1, over = 0, early = 0, maxAng = 0;
      for (let i = 0; i < 30; i++) {
        const r = L.step(cur, L.STEP);
        const a0 = cur.turrets[0].ang, a1 = r.state.turrets[0].ang;
        if (Math.abs(a1 - a0) > L.TURN_SPEED * L.STEP + 1e-9) over++;
        const fe = ofKind(r.events, 'fire');
        if (fe.length) { if (firstFire < 0) firstFire = i; if (Math.abs(a1 - r.state.turrets[0].aim) > L.AIM_TOL + 1e-9 || !near(fe[0].ang, a1, 1e-12)) early++; }
        maxAng = Math.max(maxAng, Math.abs(a1));
        cur = r.state;
      }
      const aim = cur.turrets[0].aim;
      check('向きは 1 step に TURN_SPEED × dt（12°）までしか回らず、AIM_TOL（4°）に入るまで撃たない（左の星へ 3 step 以上かけて回ってから撃つ）', over === 0 && early === 0 && firstFire >= 2 && aim < -30 * DEG && near(cur.turrets[0].ang, aim, 1e-9), [over, early, firstFire, aim / DEG]);
      // ±AIM_MAX：真横に近い星（約 −75°）でも 60° までしか向かない（そのまま撃つ）
      let w = mk(L);
      w = setRock(L, w, ['r'], { hp: 1e9, x: 10, bottom: 455 });
      const rw = run(L, w, 1);
      check('ねらいが ±AIM_MAX（60°）の外なら 60° で止まって撃つ（弾は外れて消えてよい）', near(rw.s.turrets[0].ang, -L.AIM_MAX, 1e-9) && near(rw.s.turrets[0].aim, -L.AIM_MAX, 1e-9) && ofKind(rw.evs, 'fire').length >= 2, [rw.s.turrets[0].ang / DEG, ofKind(rw.evs, 'fire').length]);
      // 武器ごとのねらい：2 台（たま x=120・いなずま x=240）。それぞれ自分の砲台から一番近いマス・一番近い てつ
      let g = mk(L, { star: 3, slots: [{ id: 'shot', lv: 1 }, { id: 'bolt', lv: 1 }] });
      g = setRock(L, g, ['iirrrrrrrrrrrrrrrrrrrri', 'rrrrrrrrrrrrrrrrrrrrrrr', 'rrrrrrrrrrrrrrrrrrrrrrr'], { hp: 1e9, bottom: 300 });
      const rg = run(L, g, 1.5);
      const fs = ofKind(rg.evs, 'fire'), f0 = fs.find((e) => e.k === 0), f1 = fs.find((e) => e.k === 1);
      const want0 = nearestTo(L, g, cellsOf(g), 0), want1 = nearestTo(L, g, cellsOf(g).filter((i) => g.rock.mats[i] === 2), 1);
      const bolt = ofKind(rg.evs, 'bolt')[0];
      check('たま は自分の砲台（x=120）から一番近いマス、いなずま は自分の砲台（x=240）から一番近い てつ（右上の 1 マス）をねらう', !!f0 && !!f1 && near(f0.tx, cx(L, g.rock, want0), 1e-6) && near(f0.ty, cy(L, g.rock, want0), 1e-6) && f1.w === 'bolt' && bolt && bolt.from === want1 && want1 === 22 && Math.abs(f0.ang) < 0.2 && f1.ang > 0, [f0, f1, want0, want1]);
      // 場を押しても変わらない：ねらいは state と時刻だけで決まる（同じ state なら同じ向き）
      check('同じ state からは同じ向き（決定的）', J(L.step(g, L.STEP).state.turrets) === J(L.step(g, L.STEP).state.turrets), null);
    },
  },
  {
    id: 'KL17', tier: 'smoke', node: true, title: 'ほしくだき：ひかえと入れ替え（reserveSwap の理由・持ったことが無い武器は選べない・取り消し・星の途中では替わらない・次の星の始めで替わる・Lv は武器ごと・ひかえは撃たない・強くできない・保存して残る）',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, { star: 4, kakera: 1e6, slots: [{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 3 }], bench: [{ id: 'fire', lv: 5 }, { id: 'beam', lv: 1 }] });
      const R = (st, k, id) => L.reserveSwap(st, k, id);
      const reasons = [R(s, 5, 'fire').reason, R(s, -1, 'fire').reason, R(s, 0.5, 'fire').reason, R(s, 0, 'laser').reason, R(s, 0, 5).reason, R(s, 0, 'spread').reason, R({ ...s, phase: 'end' }, 0, 'fire').reason];
      check('reserveSwap の理由：枠が範囲外 slot・知らない武器 id・持ったことが無い（ひかえ に無い）武器 bench・エンディング中 phase', J(reasons) === J(['slot', 'slot', 'slot', 'id', 'id', 'bench', 'phase']), reasons);
      const a = R(s, 0, 'fire');
      check('ひかえ の武器を予約できる（swap に入る・slots と bench はまだ同じ・かけらは使わない）', a.ok && J(a.state.swap) === J([{ slot: 0, id: 'fire' }]) && J(a.state.slots) === J(s.slots) && J(a.state.bench) === J(s.bench) && a.state.kakera === s.kakera, a.state.swap);
      const b = R(a.state, 1, 'fire');
      check('ほかの枠で予約済みの武器は選べない（bench）', !b.ok && b.reason === 'bench', b.reason);
      check('swapChoicesOf：今の武器（取り消し。先頭）と、ほかの枠で予約されていない ひかえ の武器', J(L.swapChoicesOf(a.state, 0)) === J(['shot', 'fire', 'beam']) && J(L.swapChoicesOf(a.state, 1)) === J(['bolt', 'beam']) && L.swapChoicesOf(a.state, 2) === null && J(L.swapChoicesOf(mk(L), 0)) === J(['shot']), [L.swapChoicesOf(a.state, 0), L.swapChoicesOf(a.state, 1)]);
      const re = R(a.state, 0, 'beam');
      check('同じ枠に別の武器を選ぶと予約が置きかわる（枠ごとに 1 つ）', re.ok && J(re.state.swap) === J([{ slot: 0, id: 'beam' }]), re.state.swap);
      const cancel = R(a.state, 0, 'shot');
      check('今の武器を選ぶと予約の取り消し（swap が空・ok）', cancel.ok && J(cancel.state.swap) === J([]), cancel.state.swap);
      // 星の途中では替わらない
      const two = R(R(s, 0, 'fire').state, 1, 'beam').state;
      const mid = run(L, two, 5);
      check('星の途中（飛んでいる間）は替わらない（5 秒たっても予約のまま・swap の出来事なし）', mid.s.phase === 'fly' && J(mid.s.slots) === J(s.slots) && J(mid.s.swap) === J([{ slot: 0, id: 'fire' }, { slot: 1, id: 'beam' }]) && ofKind(mid.evs, 'swap').length === 0, mid.s.swap);
      const fireW = new Set(ofKind(mid.evs, 'fire').map((e) => e.w));
      check('ひかえ の武器は撃たない（撃つのは砲台の たま・いなずま だけ）', fireW.size >= 1 && [...fireW].every((w) => w === 'shot' || w === 'bolt'), [...fireW]);
      check('強くできるのは砲台の武器だけ（ひかえ は slot の番号を持たない：upgrade(2) は slot）', L.upgrade(two, 2).reason === 'slot' && L.upCostOf(two, 2) === null && L.dpsOf(two, 2) === null, null);
      // 保存して開き直しても、予約と ひかえ が残る
      const ld = L.loadSave(L.makeSave(mid.s));
      check('保存して開き直しても、予約と ひかえ（覚えている Lv）が残る', J(ld.swap) === J(mid.s.swap) && J(ld.bench) === J(mid.s.bench) && J(ld.slots) === J(mid.s.slots), [ld.swap, ld.bench]);
      // 次の星の始めで替わる：2 つの予約が両方当たる
      const c1 = until(L, lastCell(L, two), (e) => e.kind === 'clear', 3);
      const c2 = run(L, c1.s, 1.6);
      const sws = ofKind(c2.evs, 'swap');
      check('次の星の始めに予約が全部当たる（2 枠・swap の出来事が 2 つ・載った武器は覚えていた Lv：ほのお 5・ビーム 1）', J(sws) === J([{ kind: 'swap', slot: 0, from: 'shot', to: 'fire', lv: 5 }, { kind: 'swap', slot: 1, from: 'bolt', to: 'beam', lv: 1 }]) && J(c2.s.slots) === J([{ id: 'fire', lv: 5 }, { id: 'beam', lv: 1 }]) && J(c2.s.swap) === J([]), [sws, c2.s.slots]);
      check('Lv は武器ごと：外した たま Lv7・いなずま Lv3 は ひかえ でその Lv のまま', J(c2.s.bench) === J([{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 3 }]), c2.s.bench);
      // 載せた武器を強くしてから戻すと、外した武器の Lv は覚えたまま・戻した たま は Lv7
      let up = c2.s;
      for (let k = 0; k < 4; k++) up = L.upgrade(up, 0).state;
      const back = R(up, 0, 'shot').state;
      const c3 = run(L, until(L, lastCell(L, back), (e) => e.kind === 'clear', 3).s, 1.6);
      check('戻すとその Lv：たま は Lv7 で砲台へ、強くした ほのお は Lv9 で ひかえ へ（Lv を引き継がない）', J(c3.s.slots) === J([{ id: 'shot', lv: 7 }, { id: 'beam', lv: 1 }]) && J(c3.s.bench) === J([{ id: 'fire', lv: 9 }, { id: 'bolt', lv: 3 }]), [c3.s.slots, c3.s.bench]);
      // 2択の候補に予約・ひかえ の武器は出ない
      let fo = mk(L, { kakera: 1e9, slots: [{ id: 'shot', lv: 1 }], bench: [{ id: 'fire', lv: 1 }, { id: 'beam', lv: 1 }] });
      fo = R(fo, 0, 'fire').state;
      let leak = 0;
      for (let k = 0; k < 30; k++) { const u = L.unlock({ ...fo, rng: k * 977 }); if (u.state.offer.some((id) => ['shot', 'fire', 'beam'].includes(id))) leak++; }
      check('2択の候補は、砲台・ひかえ・予約のどれにも無い武器から（30 回）', leak === 0, leak);
    },
  },
  {
    id: 'KL18', tier: 'smoke', node: true, title: 'ほしくだき：hold（true の間は砲台が撃たない・向きは回る・はね返し／クリアで false にもどる・保存しない）',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, { star: 4, slots: [{ id: 'shot', lv: 30 }, { id: 'bolt', lv: 30 }] });
      s = { ...s, hold: true };
      const r = run(L, s, 3);
      check('hold の間は撃たない（fire・hit・break・弾なし）が、向きは回る', r.s.hold === true && ofKind(r.evs, 'fire').length === 0 && ofKind(r.evs, 'hit').length === 0 && r.s.shots.length === 0 && r.s.rock.left === s.rock.total && r.s.turrets.some((t) => Math.abs(t.ang) > 0.01), [ofKind(r.evs, 'fire').length, r.s.turrets.map((t) => t.ang)]);
      const off = run(L, { ...r.s, hold: false }, 1);
      check('hold を戻すと撃つ（空振りでない）', ofKind(off.evs, 'fire').length > 0, ofKind(off.evs, 'fire').length);
      // デバッグ lose と同じ形：一番下をバリアの線の 0.5 単位上まで下げて hold → 次の step で必ず bounce・hold は false に
      const by = (st) => { const R = st.rock; let mr = 0; R.mats.forEach((m, i) => { if (m) mr = Math.max(mr, Math.floor(i / R.cols)); }); return R.y + (mr + 1) * L.CELL; };
      const at = { ...s, rock: { ...s.rock, y: s.rock.y + (L.BARRIER_Y - by(s)) } };
      const st1 = L.step(at, L.STEP);
      check('一番下を線ちょうど（BARRIER_Y）・hold にすると、次の step で必ず bounce、hold は false にもどる', st1.events.some((e) => e.kind === 'bounce') && st1.state.phase === 'bounce' && st1.state.hold === false && !st1.events.some((e) => e.kind === 'fire'), [st1.state.phase, st1.state.hold]);
      // 契約 §7.4 の lose（線の 0.5 単位上）：撃たないので、0.5 ÷ vy 秒（星 4 で約 0.5 秒）のうちに必ず bounce（撃ちきってクリアにならない）
      const half = { ...s, rock: { ...s.rock, y: s.rock.y + (L.BARRIER_Y - 0.5 - by(s)) } };
      const need = Math.ceil(0.5 / (s.rock.vy * L.STEP)) + 1;
      const uh = until(L, half, (e) => e.kind === 'bounce', need * L.STEP + 1e-9);
      check('線の 0.5 単位上・hold では、撃たずに 0.5 ÷ vy 秒のうちに必ず bounce（次の step ではない。§7.4 の注意）', uh.hit && ofKind(uh.evs, 'fire').length === 0 && L.step(half, L.STEP).state.phase === 'fly', [need, uh.hit]);
      const cl = until(L, { ...lastCell(L, s), hold: false }, (e) => e.kind === 'clear', 3);
      const cl2 = L.step({ ...cl.s, hold: true }, L.STEP);
      check('クリア・星が変わると hold は false（クリアの step で false・次の星の始めでも false）', cl.s.hold === false && run(L, cl2.state, 1.6).s.hold === false, null);
      check('hold は保存しない（makeSave に無い・読み直すと false）', !('hold' in JSON.parse(L.makeSave(r.s))) && L.loadSave(L.makeSave(r.s)).hold === false, null);
    },
  },
  {
    id: 'KL19', tier: 'full', node: true, title: 'ほしくだき：重さ（§21.5：48×41 のいちばん大きな星・4 台 Lv30 で 1 step の中央 1ms 以下、stepCells 6000 以下、greedy で星 30 まで 10 秒以内）',
    run({ check, root }) {
      const L = load(root);
      const slots = ['spread', 'bomb', 'bolt', 'beam'].map((id) => ({ id, lv: 30 }));
      const out = [];
      for (const [star, lv] of [[30, 30], [9999, 30], [30, 80]]) {
        const sl = slots.map((x) => ({ ...x, lv }));
        let s = mk(L, { star, slots: sl, seed: 5, cleared: star > 30 });
        s = { ...s, rock: { ...s.rock, vy: 0 } };
        const ts = [];
        let brk = 0;
        for (let i = 0; i < 600; i++) { const t0 = process.hrtime.bigint(); const r = L.step(s, L.STEP); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); s = r.state; brk += r.events.filter((e) => e.kind === 'break').length; if (s.phase !== 'fly') break; }
        ts.sort((a, b) => a - b);
        const sim = L.simulate('idle', { seed: 5, maxSec: 20, start: { star, slots: sl } });
        out.push({ star, lv, grid: s.rock.cols + 'x' + s.rock.rows, median: +ts[ts.length >> 1].toFixed(4), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(3), cells: sim.stepCells, brk, err: sim.error });
      }
      check('48×41（GRID_MAX 48 の列）の星・4 台（ちらし・どかん・いなずま・ビーム）Lv30 と Lv80（よく欠ける）で、1 step の中央が 1ms 以下・stepCells の最大が 6000 以下', out.every((o) => o.grid === '48x41' && o.median <= 1 && o.cells > 0 && o.cells <= 6000 && !o.err) && out[2].brk > 50, out);
      const t0 = Date.now();
      const g = L.simulate('greedy', { seed: 1 });
      const ms = Date.now() - t0;
      check('greedy で星 30 まで 1 本が 10 秒以内（Node）・stepCells の最大 6000 以下', !g.error && g.stars.length === 30 && ms <= 10000 && g.stepCells <= 6000, [ms, g.stepCells, g.stars.length]);
    },
  },
];

// ---- 単体で流す：node tests/cases/asteroid-logic.mjs [ID...] ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const only = process.argv.slice(2);
  let ng = 0;
  for (const t of tests) {
    if (only.length && !only.includes(t.id)) continue;
    const fails = [];
    let n = 0;
    const t0 = Date.now();
    try { await t.run({ root, tier: 'full', check: (name, ok, detail) => { n++; if (!ok) fails.push({ name, detail }); return !!ok; } }); } catch (e) { fails.push({ name: '例外', detail: e.stack }); }
    console.log(`${fails.length ? 'NG' : 'OK'} ${t.id}（${n} 件・${Date.now() - t0}ms）`);
    for (const f of fails) console.log('   × ' + f.name + '\n     ' + JSON.stringify(f.detail).slice(0, 1500));
    if (fails.length) ng++;
  }
  process.exit(ng ? 1 : 0);
}
