// KL: ちきゅうを守れ！ほしくだき の計算ロジック（Node で games/asteroid/logic.js を直接読む。ブラウザ不要）
//   リニューアル（2 回目の作り直し、2026-11-09）：計画書 docs/plans/asteroid-renew.md（§1・§5.1・§6・§8）と約束 docs/asteroid-contract.md §23。
//   大きな格子の小惑星（CELL 8・最大 132×132）・ひかり（マス 5）・自機の自動の動き・自機から撃つ 6 武器・時間切れ（lost）と retry・保存 v3。
//   局面は newGame / loadSave で作り、小惑星のマス（rock）と自機（ship）だけを手で組み直して当たりを調べる。
//   無いときに合格にしない：logic.js が無い・AsteroidLogic を公開していなければ例外で不合格にする。
//   空振りにしない：調べるマス・出来事が 0 個のときは「あること」も確かめる。
//   重い自動プレイ（ふつうの星 50 まで）は full の KL19 だけ。ハードモード（段 tier。計画書 §1.7）は KL20・KL21。
//   単体でも流せる：node tests/cases/asteroid-logic.mjs [ID...]（最後の「単体で流す」を参照）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// 重さを測る CPU 時間（このスレッドだけ。古い Node は process.cpuUsage）
const cpuOf = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));

function load(root) {
  const f = path.join(root, 'games/asteroid/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/asteroid/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.step !== 'function' || typeof L.simulate !== 'function' || typeof L.retry !== 'function') throw new Error('logic.js が AsteroidLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const CODE = { r: 1, i: 2, c: 3, g: 4, '*': 5 };   // r=いわ i=てつ c=こおり g=きん *=ひかり
const MATN = ['', 'rock', 'iron', 'ice', 'gold', 'glow'];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const DEG = Math.PI / 180;
const ALL = ['shot', 'spread', 'bomb', 'bolt', 'beam', 'fire'];
const ofKind = (evs, k) => evs.filter((e) => e.kind === k);
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }
const countAlive = (R) => R.mats.reduce((a, m) => a + (m ? 1 : 0), 0);

// 保存の形（v:3）から局面を作る（loadSave を通す）
function mk(L, o = {}) {
  const raw = { v: 3, star: 1, kakera: 0, kfrac: 0, slots: [{ id: 'shot', lv: 1 }], bench: [], offer: null, swap: [], cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0 }, seed: 7, rng: 12345, ...o };
  const s = L.loadSave(JSON.stringify(raw));
  if (!s) throw new Error('mk: loadSave が null');
  return s;
}
// 小惑星を絵で組む（rows の文字列。'.'＝空）。まわりに M マスの空きを足す。hp は opts.hp（数か関数 (c, r, ch) => 数）か、その星の体力。
// opts.ship = [c, r]（マスの座標。小数可）で自機を置く。opts.only を決めると、その番号の武器だけが撃つ（ほかは cd を遠くへ）
function setRock(L, s, rows, opts = {}) {
  const M = opts.margin !== undefined ? opts.margin : 24;
  const R = rows.length, C = rows[0].length, w = C + 2 * M, h = R + 2 * M;
  const mats = new Array(w * h).fill(0), hp = new Array(w * h).fill(0);
  let value = 0, n = 0, sc = 0, sr = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = rows[r][c], m = CODE[ch] || 0;
    if (!m) continue;
    const i = (r + M) * w + (c + M);
    mats[i] = m;
    hp[i] = typeof opts.hp === 'function' ? opts.hp(c, r, ch) : typeof opts.hp === 'number' ? opts.hp : L.cellHp(s.star, MATN[m]);
    n++; value += L.cellValue(s.star, MATN[m]); sc += c + M; sr += r + M;
  }
  const rock = { w, h, mats, hp, total: n, left: n, value, gen: 0, dirty: [], key: 1, cx: (sc / n + 0.5) * L.CELL, cy: (sr / n + 0.5) * L.CELL };
  const sp = opts.ship || [-L.STANDOFF, 0];
  const ship = { x: (sp[0] + M + 0.5) * L.CELL, y: (sp[1] + M + 0.5) * L.CELL, ang: opts.ang || 0, dir: 1, orb: 0, laps: opts.laps || 1e9 };
  return { ...s, rock, ship, shots: [], burns: [], left: s.limit, cd: s.slots.map((_, k) => (opts.only === undefined || opts.only === k ? 0 : 1e9)), M };
}
const idx = (s, c, r) => (r + s.M) * s.rock.w + (c + s.M);
const cxw = (L, R, i) => ((i % R.w) + 0.5) * L.CELL;
const cyw = (L, R, i) => (Math.floor(i / R.w) + 0.5) * L.CELL;
function run(L, s, sec) {
  const evs = [];
  const n = Math.round(sec / L.STEP);
  for (let i = 0; i < n; i++) { const r = L.step(s, L.STEP); if (!r) throw new Error('step が null'); const M = s.M; s = r.state; s.M = M; for (const e of r.events) evs.push(e); }
  return { s, evs };
}
function until(L, s, pred, sec) {
  const evs = [];
  const n = Math.round(sec / L.STEP);
  for (let i = 0; i < n; i++) {
    const r = L.step(s, L.STEP); const M = s.M; s = r.state; s.M = M;
    for (const e of r.events) evs.push(e);
    if (r.events.some(pred)) return { s, evs, hit: true };
  }
  return { s, evs, hit: false };
}
// 自機から一番近いふちのマス（残っていて、上下左右のどれかが空か格子の外）
function nearestEdge(L, s) {
  const R = s.rock, w = R.w;
  let best = -1, bd = Infinity;
  for (let i = 0; i < R.mats.length; i++) {
    if (!R.mats[i]) continue;
    const c = i % w, r = Math.floor(i / w);
    const edge = c === 0 || c === w - 1 || r === 0 || r === R.h - 1 || !R.mats[i - 1] || !R.mats[i + 1] || !R.mats[i - w] || !R.mats[i + w];
    if (!edge) continue;
    const d = (cxw(L, R, i) - s.ship.x) ** 2 + (cyw(L, R, i) - s.ship.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: Math.sqrt(bd) };
}
// 一番近いふちのマス 1 つだけを残す（体力わずか）
function lastCell(L, s) {
  const k = nearestEdge(L, s).i;
  return { ...s, rock: { ...s.rock, mats: s.rock.mats.map((m, i) => (i === k ? m : 0)), hp: s.rock.hp.map((h, i) => (i === k ? 0.001 : 0)), left: 1, dirty: [] } };
}
// 同じ種類（code）のかたまりの大きさの一覧（上下左右）
function blobs(R, code) {
  const seen = new Set(), out = [];
  for (let i = 0; i < R.mats.length; i++) {
    if (R.mats[i] !== code || seen.has(i)) continue;
    let n = 0; const st = [i]; seen.add(i);
    while (st.length) { const j = st.pop(); n++; const c = j % R.w; for (const q of [c > 0 ? j - 1 : -1, c < R.w - 1 ? j + 1 : -1, j - R.w, j + R.w]) if (q >= 0 && q < R.mats.length && R.mats[q] === code && !seen.has(q)) { seen.add(q); st.push(q); } }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}
function comps(R) {
  const seen = new Uint8Array(R.mats.length); let n = 0;
  for (let i = 0; i < R.mats.length; i++) {
    if (!R.mats[i] || seen[i]) continue;
    n++; const st = [i]; seen[i] = 1;
    while (st.length) { const j = st.pop(); const c = j % R.w; for (const q of [c > 0 ? j - 1 : -1, c < R.w - 1 ? j + 1 : -1, j - R.w, j + R.w]) if (q >= 0 && q < R.mats.length && R.mats[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
  }
  return n;
}
const block = (W, H, ch = 'r') => Array.from({ length: H }, () => ch.repeat(W));

export const tests = [
  {
    id: 'KL1', tier: 'smoke', node: true, title: 'ほしくだき（リニューアル）：定数と表（CELL 8・STANDOFF 5・SHIP_SPEED 70・RANGE 18・GRID_MAX 132・MATS に ひかり・SAVE_VERSION 3・保存キー）、廃止した砲台の API が無い、体力・かけら・強さ・値段の式、桁あふれ',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'ちきゅうを守れ！ほしくだき', CELL: 8, STANDOFF: 5, SHIP_SPEED: 70, RANGE: 18, GRID_MAX: 132, R_BASE: 36, R_MAX: 64, BOSS_EVERY: 10, BOSS_SIZE: 1.25, LEVEL_MAX: 255, SLOTS_MAX: 4,
        BOLT_CELLS: 16, BEAM_W: 2, BEAM_DEPTH: 20, CLEAR_BONUS: 0.2, ENDING_STAR: 50, HARD_STARS: 30, STAR_MAX: 9999, STAR_CALC_MAX: 400, KAKERA_MAX: 9e15, SHOTS_MAX: 120, STEP: 1 / 30,
        SAVE_VERSION: 3, SAVE_KEY: 'asteroid.save', SAVE_KEY_BAK: 'asteroid.save.bak', SAVE_KEY_BEST: 'asteroid.best', SAVE_KEY_HELP: 'asteroid.help', SAVE_KEY_V3: 'asteroid.v3' };
      const bad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が計画書 §1・§5.1 のとおり（NAME はユーザーの書いたとおり）', bad.length === 0, bad);
      const gone = ['turretsOf', 'BARRIER_Y', 'TURRET_Y', 'START_BOTTOM', 'FIGHTER_Y', 'AIM_MAX', 'BOUNCE_SEC', 'poke', 'setNear'].filter((k) => k in L);
      check('廃止したもの（turretsOf・BARRIER_Y・TURRET_Y・START_BOTTOM・はね返し）が無い（§5.1）', gone.length === 0, gone);
      const fns = ['newGame', 'starInfo', 'step', 'dpsOf', 'upCostOf', 'upgrade', 'slotCostOf', 'unlock', 'choose', 'swapChoicesOf', 'reserveSwap', 'progressOf', 'formatKakera', 'formatTime', 'makeSave', 'loadSave', 'saveVersionOf', 'validateBest', 'simulate', 'retry'];
      check('§5.1 の関数が全部ある', fns.every((f) => typeof L[f] === 'function'), fns.filter((f) => typeof L[f] !== 'function'));
      check('マスは いわ・てつ・こおり・きん・ひかり（コード 1〜5）、硬さ 1・4・2・2・1、かけら 1・4・2・10・2、ひかり は ×3', J(L.MATS.map((m) => [m.id, m.code, m.name])) === J([['rock', 1, 'いわ'], ['iron', 2, 'てつ'], ['ice', 3, 'こおり'], ['gold', 4, 'きん'], ['glow', 5, 'ひかり']]) &&
        J(L.MAT_HP) === J({ rock: 1, iron: 4, ice: 2, gold: 2, glow: 1 }) && J(L.MAT_VALUE) === J({ rock: 1, iron: 4, ice: 2, gold: 10, glow: 2 }) && L.GLOW.mul === 3, [L.MATS, L.MAT_HP, L.MAT_VALUE, L.GLOW]);
      check('武器は今の 6 種類（名前・強さ・間隔は前のまま）', J(L.WEAPONS.map((w) => [w.id, w.name, w.dmg, w.rate])) === J([['shot', 'たま', 1, 0.2], ['spread', 'ちらし', 1.25, 0.6], ['bomb', 'どかん', 0.75, 1.6], ['bolt', 'いなずま', 0.8, 1.2], ['beam', 'ビーム', 0.375, 2], ['fire', 'ほのお', 3, 1]]), L.WEAPONS.map((w) => [w.id, w.dmg, w.rate]));
      const aff = { spread: { rock: 2, iron: 0.9, ice: 1, gold: 1, glow: 1 }, bomb: { rock: 1, iron: 1, ice: 2, gold: 1, glow: 1 }, bolt: { rock: 1, iron: 2.2, ice: 0.5, gold: 1, glow: 1 }, beam: { rock: 1, iron: 1.8, ice: 1, gold: 1, glow: 1 }, fire: { rock: 1, iron: 0.75, ice: 3, gold: 1, glow: 1 }, shot: { rock: 1, iron: 1, ice: 1, gold: 1, glow: 1 } };
      const affBad = [];
      for (const w in aff) for (const m in aff[w]) if (L.affOf(w, m) !== aff[w][m]) affBad.push([w, m, L.affOf(w, m)]);
      check('相性の倍率（§3.3 のまま。ひかり は 1）、どれも 0.5〜3 倍', affBad.length === 0 && L.WEAPONS.every((w) => L.MATS.every((m) => L.affOf(w.id, m.id) >= 0.5 && L.affOf(w.id, m.id) <= 3)), affBad);
      check('UP_COST・UP_GROWTH は前のまま、VALUE_GROWTH 1.77・SLOT_COST の 5・6 つ目 50まん・15おく（ふつうを 50 面にしたので、星 50 で Lv99 に届くように）', J(L.UP_COST) === J({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 }) && J(L.SLOT_COST) === J([null, 40, 300, 2000, 500000, 1.5e9]) && L.UP_GROWTH === 1.35 && L.VALUE_GROWTH === 1.77, [L.UP_COST, L.SLOT_COST]);
      check('HP_TABLE は星 1〜50 の 50 個で、だいたい増えていく（greedy で測って決めた。計画書 §6）', Array.isArray(L.HP_TABLE) && L.HP_TABLE.length === 50 && L.HP_TABLE.every((v, k, a) => v > 0 && (k === 0 || v > a[k - 1] * 0.85)) && L.HP_TABLE[49] > L.HP_TABLE[0] * 1e4, L.HP_TABLE);
      // マスの体力 = STAR_HP × hpMul × MAT_HP ÷ 面積の目安。星の体力の合計は星の大きさによらない（面積で割る）
      const area = (n) => L.AREA_FILL * Math.PI * L.starInfo(n).radius ** 2;
      check('cellHp = STAR_HP × hpMul × MAT_HP ÷ (AREA_FILL × π × 半径²)、cellValue も同じ形（端数こみ）', [1, 3, 10, 29, 30, 77].every((n) => near(L.cellHp(n, 'iron'), L.STAR_HP * L.hpMul(n) * 4 / area(n), 1e-9 * L.cellHp(n, 'iron')) && near(L.cellValue(n, 'gold'), L.STAR_VALUE * L.valMul(n) * 10 / area(n), 1e-9 * L.cellValue(n, 'gold'))) && !Number.isInteger(L.cellValue(1, 'rock')), [L.cellHp(1, 'rock'), L.cellValue(1, 'rock')]);
      // adj = ボスの重さ 1.3 × 傾きのならし（てつ・こおり の割合を星ごとに ±8 ずらした分を、もとの割合の重さにそろえる）
      const adjOf = (n) => { const m = L.starInfo(n).mix, i0 = n < 3 ? 0 : n < 10 ? L.MIX.iron[0] : L.MIX.iron[1], c0 = n < 6 ? 0 : L.MIX.ice; const wt = (a, b) => (1 - a - b) + 4 * a + 2 * b; return (L.starInfo(n).star % 10 === 0 ? L.BOSS_HARD : 1) * wt(i0, c0) / wt(m.iron, m.ice); };
      check('hpMul(n) = HP_TABLE[n−1] × adj（ボス 1.3 倍・傾きのならし）。星 50 より先（通しの番号）はハードの式', [1, 5, 9, 10, 17, 20, 29, 30, 44, 50].every((n) => near(L.hpMul(n), L.HP_TABLE[n - 1] * adjOf(n), 1e-9 * L.hpMul(n))) && near(L.hpMul(1, 1), L.hpMul(51), 1e-12) && near(L.hpMul(51) / adjOf(51), L.HP_TABLE[49] * L.HARD.hp, 1e-9), [10, 51].map((n) => [n, L.hpMul(n), adjOf(n)]));
      const dw = (base, Lv, id) => { const lo = Math.min(Lv, 99); return base * (1 + 0.25 * (lo - 1)) * 2 ** Math.floor(lo / 10) * (id === 'shot' ? 1 + 0.2 * Math.max(0, lo - 10) / 89 : 1) * 1.02 ** (Lv - lo); };
      check('dmg(w, L) = DMG × (1 + 0.25(L−1)) × 2^floor(L/10)（たまは Lv 11 から × (1 + 0.2 × (L−10)/89)）。Lv100 から × 1.02^(L−99)（LV_HI）', [1, 5, 10, 11, 20, 55, 99, 100, 150, 255].every((Lv) => L.WEAPONS.every((w) => near(L.dmg(w.id, Lv), dw(w.dmg, Lv, w.id), 1e-9 * dw(w.dmg, Lv, w.id)))) && J(L.LV_HI) === J({ from: 99, dmg: 1.02, top: 0.9, every: 50 }) && L.dmg('shot', 999) === L.dmg('shot', 255), null);
      check('upCost = round(UP_COST × 1.35^(L−1))（Lv98→99 まで前のまま）', L.WEAPONS.every((w) => L.upCost(w.id, 1) === L.UP_COST[w.id] && L.upCost(w.id, 7) === Math.round(L.UP_COST[w.id] * 1.35 ** 6) && L.upCost(w.id, 98) === Math.round(L.UP_COST[w.id] * 1.35 ** 97)), null);
      // Lv99 から先：1 Lv ごとに HI_COST[w] 倍、Lv254→255 が KAKERA_MAX × 0.9（8100ちょう）。Lv255 で null
      check('Lv99 から 255：値段は 1 Lv ごとに同じ倍率（1.02〜1.04）で増え、Lv254 の値段は 8100ちょう（KAKERA_MAX 以下）・Lv255 で null・Infinity や NaN にならない',
        L.WEAPONS.every((w) => { const c = L.HI_COST[w.id]; const a = []; for (let v = 99; v <= 254; v++) a.push(L.upCost(w.id, v)); return c > 1.02 && c < 1.04 && a.every((x, k) => Number.isInteger(x) && x > 0 && x <= L.KAKERA_MAX && (k === 0 || x > a[k - 1])) && near(a[0], L.UP_COST[w.id] * 1.35 ** 98, 1) && near(a[a.length - 1], L.KAKERA_MAX * 0.9, 1e3); }) && L.WEAPONS.every((w) => L.upCost(w.id, 255) === null && L.upCost(w.id, 1e9) === null) && L.formatKakera(L.upCost('bomb', 254)) === '8099ちょう', L.WEAPONS.map((w) => [w.id, L.HI_COST[w.id], L.upCost(w.id, 254)]));
      check('しんか：たま 1→2→3→4 連、ちらし 5→7→9→11、どかん 3→4→5→6、いなずま 16→24→32→40、ビーム 2→4→6→8、ほのお 3→6 秒（Lv30 で打ち止め）',
        [9, 10, 20, 30, 99].map((Lv) => ALL.map((w) => L.shapeOf(w, Lv)).join(',')).join('/') === '1,5,3,16,2,3/2,7,4,24,4,4/3,9,5,32,6,5/4,11,6,40,8,6/4,11,6,40,8,6', null);
      const fin = [L.hpMul(1e9), L.valMul(1e9), L.cellHp(9999, 'iron'), L.cellValue(9999, 'gold'), L.dmg('beam', 1e9), L.upCost('beam', 98), L.upCost('bomb', 254), L.dpsOf(mk(L, { slots: [{ id: 'bomb', lv: 255 }] }), 0), L.hpMul(30, 300)];
      check('とても大きな星・Lv でも有限の数', fin.every(Number.isFinite) && L.hpMul(1e9) === L.hpMul(9999), fin);
      check('表・API が凍結されている', Object.isFrozen(L) && Object.isFrozen(L.WEAPONS) && Object.isFrozen(L.MATS) && Object.isFrozen(L.HP_TABLE) && Object.isFrozen(L.LIMIT_MUL), null);
      const s = mk(L, { slots: [{ id: 'shot', lv: 12 }, { id: 'bolt', lv: 3 }] });
      check('upCostOf・slotCostOf（持っている武器の数で決まり、6 種類で null）・dpsOf（1 以上の整数で Lv で増える）',
        L.upCostOf(s, 0) === L.upCost('shot', 12) && L.slotCostOf(s) === L.SLOT_COST[2] && L.slotCostOf(mk(L, { slots: ALL.slice(0, 4).map((id) => ({ id, lv: 1 })), bench: ALL.slice(4).map((id) => ({ id, lv: 1 })) })) === null &&
        Number.isInteger(L.dpsOf(s, 0)) && L.dpsOf(mk(L, { slots: [{ id: 'shot', lv: 13 }] }), 0) > L.dpsOf(s, 0), null);
    },
  },
  {
    id: 'KL2', tier: 'smoke', node: true, title: 'ほしくだき：星の形（同じ星と種で同じ・ちがう種でちがう・1 つにつながる・でこぼこの丸）、大きさ（星 1 で半径 36・上限 64・格子 132×132 以下・ボス 1.25 倍）、てつのかたまり、きん、ひかり の置き方、残り時間 limit（星 1 は 6〜8 分）、formatKakera・formatTime',
    run({ check, root }) {
      const L = load(root);
      const a = mk(L, { star: 4, seed: 3 }), b = mk(L, { star: 4, seed: 3 }), c = mk(L, { star: 4, seed: 4 });
      check('同じ星・同じ種で同じ形、ちがう種でちがう形', J(a.rock.mats) === J(b.rock.mats) && J(a.rock.mats) !== J(c.rock.mats), null);
      const info = [1, 2, 9, 10, 20, 29, 30, 31, 49, 50, 60, 9999].map((n) => [n, L.starInfo(n)]);
      check('starInfo は { w, h, radius, boss, mix, limit }（ほかに tag・main）', info.every(([, i]) => i && Number.isInteger(i.w) && i.w === i.h && i.radius > 0 && typeof i.boss === 'boolean' && i.mix && i.limit > 0), info.map(([n, i]) => [n, i && i.w, i && i.radius, i && i.limit]));
      check('星 1 の半径 36（直径 576 単位＝画面より大きい）、星ごとに大きく、ふつうの星 50 で上限 64・格子 132×132（49 は 63 あまり）、ボスは 1.25 倍', L.starInfo(1).radius === 36 && L.starInfo(9).radius > L.starInfo(1).radius && L.starInfo(10).radius > L.starInfo(11).radius * 1.15 &&
        info.every(([, i]) => i.radius <= 64 && i.w <= 132) && L.starInfo(50).radius === 64 && L.starInfo(50).w === 132 && L.starInfo(49).radius > 63 && L.starInfo(49).radius < 64 && L.starInfo(10).boss && !L.starInfo(11).boss, info.map(([n, i]) => [n, i.radius, i.w]));
      check('starInfo のおかしな引数は null', L.starInfo(0) === null && L.starInfo(NaN) === null && L.starInfo('3') === null, null);
      const shapes = [];
      for (const [n, seed] of [[1, 1], [1, 2], [7, 5], [12, 9], [30, 3]]) {
        const s = mk(L, { star: n, seed }), R = s.rock, r = L.starInfo(n).radius;
        const filled = R.total / (Math.PI * r * r);
        shapes.push({ n, seed, w: R.w, total: R.total, filled: +filled.toFixed(3), comps: comps(R), left: R.left === countAlive(R), mats5: R.mats.filter((m) => m === 5).length, iron: blobs(R, 2).slice(0, 3), ironAll: R.mats.filter((m) => m === 2).length, gold: blobs(R, 4), glow: blobs(R, 5) });
      }
      check('形は 1 つにつながっている・total と left がマスの数・半径の円の 0.65〜0.9 が埋まっている（でこぼこ・くぼみ）', shapes.every((x) => x.comps === 1 && x.left && x.filled > 0.65 && x.filled < 0.9), shapes.map((x) => [x.n, x.filled, x.comps]));
      check('てつ（星 3〜）は大きなかたまり：一番大きい 40 マス以上、てつの 8 割以上が 30 マス以上のかたまりの中。星 1・2 に てつ は無い', shapes.every((x) => x.n < 3 ? x.ironAll === 0 : x.iron[0] >= 40 && blobs(mk(L, { star: x.n, seed: x.seed }).rock, 2).filter((v) => v >= 30).reduce((p, v) => p + v, 0) >= 0.8 * x.ironAll), shapes.map((x) => [x.n, x.iron, x.ironAll]));
      check('きん（星 8〜）は 2×2 のかたまり', shapes.every((x) => (x.n < 8 ? x.gold.length === 0 : x.gold.length >= 1 && x.gold.every((v) => v === 4))), shapes.map((x) => [x.n, x.gold]));
      // ひかり：4〜12 マスのかたまりで 6〜20 か所（＋奥に少し）、多くはふちから 4 マス以内
      const gl = [];
      for (const x of shapes) {
        const R = mk(L, { star: x.n, seed: x.seed }).rock;
        const dep = new Int16Array(R.mats.length).fill(0), q = [];
        for (let i = 0; i < R.mats.length; i++) { if (!R.mats[i]) continue; const c = i % R.w; if (c === 0 || c === R.w - 1 || !R.mats[i - 1] || !R.mats[i + 1] || !R.mats[i - R.w] || !R.mats[i + R.w]) { dep[i] = 1; q.push(i); } }
        for (let h = 0; h < q.length; h++) { const j = q[h], c = j % R.w; for (const k of [c > 0 ? j - 1 : -1, c < R.w - 1 ? j + 1 : -1, j - R.w, j + R.w]) if (k >= 0 && k < R.mats.length && R.mats[k] && !dep[k]) { dep[k] = dep[j] + 1; q.push(k); } }
        let nearN = 0, all = 0;
        for (let i = 0; i < R.mats.length; i++) if (R.mats[i] === 5) { all++; if (dep[i] <= 4) nearN++; }
        gl.push({ n: x.n, blobs: x.glow.length, min: Math.min(...x.glow), max: Math.max(...x.glow), nearFrac: +(nearN / all).toFixed(2), deep: all - nearN });
      }
      check('ひかり：4〜12 マスのかたまりが 6〜22 か所（ふち 6〜20 ＋ 奥 2 まで）、6 割以上がふちから 4 マス以内、奥にも少し', gl.every((g) => g.blobs >= 6 && g.blobs <= 22 && g.min >= 4 && g.max <= 12 && g.nearFrac >= 0.6 && g.deep > 0), gl);
      check('星が大きいほど ひかり の数が多い（星 1 より星 30）', gl[gl.length - 1].blobs > gl[0].blobs, gl.map((g) => g.blobs));
      // 残り時間：limit(n) = LIMIT_BASE × 倍率（星 1〜3 は 1.8、星 10 から 1.25）。星 1 は 6〜8 分
      const lim = (n) => L.starInfo(n).limit;
      check('limit：星 1〜3 は 6〜8 分（360〜480 秒）、星 10 から ふつう 300 秒・ボス 380 秒、10 秒単位、倍率は下がっていく', [1, 2, 3].every((n) => lim(n) >= 360 && lim(n) <= 480) && lim(11) === 300 && lim(25) === 300 && lim(20) === 380 && lim(30) === 380 &&
        [1, 2, 4, 9, 11, 31].every((n) => lim(n) % 10 === 0) && L.LIMIT_MUL.first === 1.8 && L.LIMIT_MUL.late === 1.25 && lim(4) / 240 < 1.8 && lim(9) / 240 > 1.25, [1, 2, 3, 4, 9, 10, 11, 20, 30].map((n) => [n, lim(n)]));
      check('formatKakera（前のまま）', L.formatKakera(9999) === '9,999' && L.formatKakera(12345) === '1.2まん' && L.formatKakera(-1) === '0' && L.formatKakera(Infinity) === '9000ちょう', [L.formatKakera(12345), L.formatKakera(Infinity)]);
      check('formatTime(sec) は "m:ss"（秒は切り上げ・おかしな値は 0:00）', L.formatTime(0) === '0:00' && L.formatTime(0.2) === '0:01' && L.formatTime(59.5) === '1:00' && L.formatTime(61) === '1:01' && L.formatTime(380) === '6:20' && L.formatTime(-3) === '0:00' && L.formatTime(NaN) === '0:00' && L.formatTime('9') === '0:00' && L.formatTime(1e9) === '99:59', [L.formatTime(59.5), L.formatTime(380), L.formatTime(1e9)]);
      const s0 = L.newGame(1);
      check('新しい遊び：星 1・phase fly・残り時間 = limit・たま Lv1・自機はふちの外 STANDOFF マス', s0.star === 1 && s0.phase === 'fly' && s0.left === s0.limit && s0.limit === lim(1) && J(s0.slots) === J([{ id: 'shot', lv: 1 }]) && near(nearestEdge(L, s0).d, L.STANDOFF * L.CELL, 0.5 * L.CELL) && [s0.ship.x, s0.ship.y, s0.ship.ang].every(Number.isFinite) && Math.abs(s0.ship.dir) === 1, [s0.ship, nearestEdge(L, s0).d]);
    },
  },
  {
    id: 'KL3', tier: 'smoke', node: true, title: 'ほしくだき：自機から撃つ（たま＝一番近いふちのマスへ・通り道の最初のマス・余った力で奥へ、ちらしの扇 12°・15°、どかんの円（半径 3 マス・中心は内側へ）、いなずま（てつ をねらう・枝分かれ・path）、ビームが奥へ掘る、ほのお、ang は自機から的への向き、弾の上限）',
    run({ check, root }) {
      const L = load(root);
      const CL = L.CELL;
      // たま：横 1 列 10 マス。自機は左に 4 マス。体力が大きいと最初のマスだけに当たる
      let s = setRock(L, mk(L), ['rrrrrrrrrr'], { hp: 1e9, ship: [-4, 0] });
      let r = until(L, s, (e) => e.kind === 'hit', 1);
      const h1 = ofKind(r.evs, 'hit'), f1 = ofKind(r.evs, 'fire')[0];
      check('たま：一番近いふちのマス（左はし）の向きへ撃ち、通り道の最初のマスに当たる', r.hit && f1 && f1.w === 'shot' && h1.every((e) => e.i === idx(s, 0, 0)) && near(f1.tx, cxw(L, s.rock, idx(s, 0, 0)), 1e-9), [f1, h1.slice(0, 3)]);
      check('fire の ang は x + cos(ang)·len, y + sin(ang)·len の向き（自機から的へ）、x・y は自機の位置', f1 && near(Math.atan2(f1.ty - f1.y, f1.tx - f1.x), f1.ang, 1e-9) && near(Math.cos(f1.ang), 1, 0.05), f1);
      // 余った力で奥へ：体力 0.1 の 10 マス。たま Lv1（強さ 1）の 1 発で 10 マス こわれる
      s = setRock(L, mk(L), ['rrrrrrrrrr'], { hp: 0.1, ship: [-4, 0] });
      r = run(L, s, 5 * L.STEP);
      check('たま：こわしたマスより強い分は うしろのマスへ進む（体力 0.1 の 10 マスを 1 発で）', ofKind(r.evs, 'fire').length === 1 && ofKind(r.evs, 'break').length === 10, [ofKind(r.evs, 'fire').length, ofKind(r.evs, 'break').length]);
      // ちらし：5 発で扇の全体 12°（となり 3°）、Lv10 で 7 発 15°
      for (const [lv, n, fan] of [[1, 5, 12], [10, 7, 15]]) {
        s = setRock(L, mk(L, { slots: [{ id: 'spread', lv }] }), block(10, 10), { hp: 1e9, ship: [-5, 4] });
        r = L.step(s, L.STEP);
        const sh = r.state.shots.filter((b) => b.w === 'spread').map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
        check(`ちらし Lv${lv}：${n} 発・扇の全体 ${fan}°・同じ間隔`, sh.length === n && near((sh[n - 1] - sh[0]) / DEG, fan, 1e-6) && sh.every((a, k) => k === 0 || near(a - sh[k - 1], sh[1] - sh[0], 1e-9)), sh.map((a) => +(a / DEG).toFixed(3)));
      }
      // どかん：21×21 の いわ（体力大）。半径 3 マス、当たるマスは円の中だけ、中心はふちのマスより内側
      s = setRock(L, mk(L, { slots: [{ id: 'bomb', lv: 1 }] }), block(21, 21), { hp: 1e9, ship: [-5, 10] });
      r = until(L, s, (e) => e.kind === 'boom', 2);
      const boom = ofKind(r.evs, 'boom')[0], fb = ofKind(r.evs, 'fire').find((e) => e.w === 'bomb');
      const bh = boom ? ofKind(r.evs, 'hit').filter((e) => e.w === 'bomb') : [];
      check('どかん：0.6 秒で落ち、boom の r は 3 マス（世界の単位 24）、当たるマスは円の中だけで 20〜29 マス、中心はふちより内側（BOMB_SHIFT）', boom && near(boom.r, 3 * CL, 1e-9) && near(boom.x, fb.tx, 1e-9) && bh.length >= 20 && bh.length <= 29 &&
        bh.every((e) => Math.hypot(cxw(L, r.s.rock, e.i) - boom.x, cyw(L, r.s.rock, e.i) - boom.y) <= boom.r + 1e-6) && boom.x > (s.M + 0.5) * CL + 3 * CL * 0.4, [boom, bh.length]);
      // いなずま：一番近い てつ をねらい、つながったマスへ枝分かれ（最大 16 マス）。path はマスの添字の並び、x・y は自機
      const rowsB = ['rrrrrrrrrrrr', 'rrrrrrrrrrrr', 'rrrrriiiiiir', 'rrrrriiiiiir', 'rrrrrrrrrrrr'];
      s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), rowsB, { hp: 1e9, ship: [-5, 2] });
      r = L.step(s, L.STEP);
      const bolt = ofKind(r.events, 'bolt')[0], fbo = ofKind(r.events, 'fire')[0];
      const ironNear = (() => { let b = -1, bd = Infinity; for (let i = 0; i < s.rock.mats.length; i++) if (s.rock.mats[i] === 2) { const d = (cxw(L, s.rock, i) - s.ship.x) ** 2 + (cyw(L, s.rock, i) - s.ship.y) ** 2; if (d < bd) { bd = d; b = i; } } return b; })();
      const tree = bolt && bolt.edges.every((ed, k) => bolt.path.indexOf(ed[0]) >= 0 && bolt.path.indexOf(ed[0]) < bolt.path.indexOf(ed[1]) && bolt.path.indexOf(ed[1]) === k + 1);
      check('いなずま：一番近い てつ をねらう（届く距離の中）、path[0] がねらったマス・最大 16 マス・枝は木・x・y は自機の位置、てつ を先にたどる', bolt && bolt.from === ironNear && bolt.path[0] === ironNear && bolt.path.length <= 16 && bolt.path.length >= 10 && tree &&
        near(bolt.x, s.ship.x, 3) && bolt.path.slice(0, 6).every((i) => s.rock.mats[i] === 2) && fbo && fbo.w === 'bolt', bolt && { from: bolt.from, ironNear, n: bolt.path.length, x: bolt.x, mats: bolt.path.map((i) => s.rock.mats[i]).join('') });
      // ビーム：30×9 の いわ。最初に当たったマスから奥へ 20 マスまで掘る、幅 2 マス
      s = setRock(L, mk(L, { slots: [{ id: 'beam', lv: 1 }] }), block(30, 9), { hp: 1e9, ship: [-5, 4] });
      r = L.step(s, L.STEP);
      const beam = ofKind(r.events, 'beam')[0];
      // 光の向きに沿った深さ（射影）と、直角の幅
      const along = beam ? beam.cells.map((i) => (cxw(L, s.rock, i) - beam.x) * Math.cos(beam.ang) + (cyw(L, s.rock, i) - beam.y) * Math.sin(beam.ang)) : [];
      const side = beam ? beam.cells.map((i) => -(cxw(L, s.rock, i) - beam.x) * Math.sin(beam.ang) + (cyw(L, s.rock, i) - beam.y) * Math.cos(beam.ang)) : [];
      const depth = (Math.max(...along) - Math.min(...along)) / CL, width = (Math.max(...side) - Math.min(...side)) / CL;
      check('ビーム：最初に当たったマスから奥へ 20 マスまで（それより奥には当たらない）・幅 2 マスぶん、beam の w・len は世界の単位', beam && depth >= 15 && depth <= 21.5 && width >= 0.5 && width <= 3.5 && beam.cells.length >= 30 && near(beam.w, 2 * CL, 1e-9) && beam.len > 20 * CL && beam.len < 30 * CL, beam && { depth, width, n: beam.cells.length, w: beam.w, len: beam.len });
      check('ビーム：beam の ang の向きに cells がある（cos・sin の向き）', beam && beam.cells.every((i) => (cxw(L, s.rock, i) - beam.x) * Math.cos(beam.ang) + (cyw(L, s.rock, i) - beam.y) * Math.sin(beam.ang) > 0), beam && beam.ang);
      // ほのお：当たったマスが燃え、毎秒 DMG（3）ずつ減り、3 秒で消える
      s = setRock(L, mk(L, { slots: [{ id: 'fire', lv: 1 }] }), block(6, 6), { hp: 1e9, ship: [-5, 2] });
      r = run(L, s, 0.5);
      const burn = ofKind(r.evs, 'burn')[0];
      const r2 = run(L, r.s, 4);
      check('ほのお：当たったマスが燃える（burn）・体力が減る・3 秒で消える（ほかのマスへ燃えうつりも）', burn && r.s.burns.length >= 1 && r2.s.rock.hp[burn.i] < 1e9 - 2.9 && r2.s.burns.every((b) => b.until > r2.s.t - 0.1), [burn, r.s.burns.length, 1e9 - r2.s.rock.hp[burn && burn.i]]);
      // 弾の上限
      s = setRock(L, mk(L, { slots: [{ id: 'shot', lv: 99 }, { id: 'spread', lv: 99 }] }), block(40, 40), { hp: 1e15, ship: [-5, 20] });
      r = run(L, s, 3);
      check('弾は SHOTS_MAX（120）をこえない', r.s.shots.length <= L.SHOTS_MAX && ofKind(r.evs, 'fire').length > 10, [r.s.shots.length]);
    },
  },
  {
    id: 'KL4', tier: 'smoke', node: true, title: 'ほしくだき：はなれたかたまり（首を切ると小さいほうが全部くだける・chunk の cells と mats・かけらは合計どおり・同じ大きさは真ん中に近いほうが本体・輪の 1 マスを切っても分かれない（遠回りでつながる）・穴をあけても分かれない）',
    run({ check, root }) {
      const L = load(root);
      // 8×4 の いわ と 3×3 の いわ を、てつ 1 マスの首でつなぐ。いなずまが首（ただ 1 つの てつ）をねらって切る
      const rows = ['rrrrrrrr....', 'rrrrrrrri...', 'rrrrrrrr.rrr', 'rrrrrrrr.rrr', '.........rrr'];
      // 首をつなぐ：(8,1) の i から (9,2) へは斜めなので、(9,1) を足して L 字に
      rows[1] = 'rrrrrrrrir..';
      let s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), rows, { hp: (c, r, ch) => (ch === 'i' ? 0.0001 : 1e9), ship: [8, -5] });
      check('組んだ形は 1 つにつながっている（前提）', comps(s.rock) === 1, null);
      const before = s.kakera + s.kfrac;
      let r = until(L, s, (e) => e.kind === 'chunk', 1);
      const ch = ofKind(r.evs, 'chunk')[0];
      const smallSet = [];
      for (const [c, rr] of [[9, 1], [9, 2], [10, 2], [11, 2], [9, 3], [10, 3], [11, 3], [9, 4], [10, 4], [11, 4]]) smallSet.push(idx(s, c, rr));
      check('首を切ると、小さいほう（10 マス）が全部くだける（chunk）。本体（8×4）は残る', ch && J(ch.cells.slice().sort((a, b) => a - b)) === J(smallSet.sort((a, b) => a - b)) && r.s.rock.left === 32 && countAlive(r.s.rock) === 32 && comps(r.s.rock) === 1, ch && { n: ch.cells.length, left: r.s.rock.left });
      check('chunk の mats は壊れる前の材質（cells と同じ並び）、同じ step でマスは 0', ch && Array.isArray(ch.mats) && ch.mats.length === ch.cells.length && ch.mats.every((m) => m === 1) && ch.cells.every((i) => r.s.rock.mats[i] === 0), ch && ch.mats);
      const want = 10 * L.cellValue(1, 'rock') + L.cellValue(1, 'iron');
      check('かけらは くだけたマスの値の合計（首＋かたまり）', ch && near(r.s.kakera + r.s.kfrac - before, want, 1e-6) && near(ch.value, 10 * L.cellValue(1, 'rock'), 1e-9), [r.s.kakera + r.s.kfrac - before, want]);
      // 同じ大きさ：真ん中に近いほうが本体（右に空きを 2 列足して、右のかたまりを真ん中へ）
      s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), ['rrr.rrr..', 'rrrirrr..', 'rrr.rrr..'], { hp: (c, r, ch2) => (ch2 === 'i' ? 0.0001 : 1e9), ship: [3, -5] });
      r = until(L, s, (e) => e.kind === 'chunk', 1);
      const ch2 = ofKind(r.evs, 'chunk')[0];
      check('同じ大きさなら格子の真ん中に近いほう（右）が本体で、左がくだける', ch2 && ch2.cells.length === 9 && ch2.cells.every((i) => i % s.rock.w - s.M <= 2) && r.s.rock.left === 9, ch2 && ch2.cells.map((i) => i % s.rock.w - s.M));
      // 輪（20×20 の 1 マスの太さ）：1 マス切っても分かれない（まわりの四角の中ではつながっていないが、遠回りでつながる）
      const ring = Array.from({ length: 20 }, (_, r0) => (r0 === 0 || r0 === 19 ? 'r'.repeat(20) : 'r' + '.'.repeat(18) + 'r'));
      ring[0] = 'rrrrrrrrrirrrrrrrrrr';
      s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), ring, { hp: (c, r0, c3) => (c3 === 'i' ? 0.0001 : 1e9), ship: [9, -5] });
      r = run(L, s, 0.2);
      check('輪の 1 マスを切っても分かれない（chunk なし・残り 75 マス）', ofKind(r.evs, 'break').length === 1 && ofKind(r.evs, 'chunk').length === 0 && r.s.rock.left === 75 && comps(r.s.rock) === 1, [ofKind(r.evs, 'break').length, r.s.rock.left]);
      // そのあと反対側も切ると、2 つに分かれ、小さいほうがくだける
      const ring2 = ring.slice(); ring2[0] = 'rrrrrrrrr.rrrrrrrrrr'; ring2[19] = 'rrrrrirrrrrrrrrrrrrr';
      s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), ring2, { hp: (c, r0, c3) => (c3 === 'i' ? 0.0001 : 1e9), ship: [5, 24] });
      r = run(L, s, 0.2);
      const ch3 = ofKind(r.evs, 'chunk')[0];
      check('輪の 2 か所目を切ると 2 つに分かれ、小さいほうがくだける', ch3 && ch3.cells.length < r.s.rock.left && ch3.cells.length + r.s.rock.left === 74 && comps(r.s.rock) === 1, ch3 && [ch3.cells.length, r.s.rock.left]);
      // 穴：ブロックの真ん中の てつ を こわしても分かれない
      const hole = block(9, 9); hole[4] = 'rrrrirrrr';
      s = setRock(L, mk(L, { slots: [{ id: 'bolt', lv: 1 }] }), hole, { hp: (c, r0, c3) => (c3 === 'i' ? 0.0001 : 1e9), ship: [4, -5] });
      r = run(L, s, 0.2);
      check('真ん中に穴をあけても分かれない（chunk なし）', ofKind(r.evs, 'break').length === 1 && ofKind(r.evs, 'chunk').length === 0 && r.s.rock.left === 80, [ofKind(r.evs, 'break').length, r.s.rock.left]);
    },
  },
  {
    id: 'KL5', tier: 'smoke', node: true, title: 'ほしくだき：ひかり（どれか 1 マスが壊れると、つながった ひかり が全部まとめて砕ける・glow の cells と mats・かけら 3 倍・離れた ひかり は残る）',
    run({ check, root }) {
      const L = load(root);
      const rows = ['***.rrrr**', '*rr.rrrr**', 'rrrrrrrrrr', 'rrrrrrrrrr'];
      const s = setRock(L, mk(L), rows, { hp: (c, r, ch) => (ch === '*' ? 0.0001 : 1e9), ship: [1, -5] });
      const before = s.kakera + s.kfrac;
      const r = until(L, s, (e) => e.kind === 'glow', 1);
      const g = ofKind(r.evs, 'glow')[0];
      const want = [idx(s, 0, 0), idx(s, 1, 0), idx(s, 2, 0), idx(s, 0, 1)].sort((a, b) => a - b);
      check('ひかり 1 マスに当たると、つながった 4 マスが全部まとめて砕ける（glow）', g && J(g.cells.slice().sort((a, b) => a - b)) === J(want) && g.cells.every((i) => r.s.rock.mats[i] === 0), g && g.cells);
      check('glow の mats は全部 5（cells と同じ並び）・break の出来事は出さない', g && J(g.mats) === J([5, 5, 5, 5]) && ofKind(r.evs, 'break').length === 0, g && g.mats);
      check('かけらは ひかり の値 × 3 × マスの数', g && near(g.value, L.cellValue(1, 'glow') * 3 * 4, 1e-9) && near(r.s.kakera + r.s.kfrac - before, g.value, 1e-6), g && [g.value, r.s.kakera + r.s.kfrac - before]);
      check('離れた ひかり（右上の 4 マス）は残る', [idx(s, 8, 0), idx(s, 9, 0), idx(s, 8, 1), idx(s, 9, 1)].every((i) => r.s.rock.mats[i] === 5) && r.s.totals.glows === 1, null);
      // 自動プレイで ひかり が砕ける
      const sim = L.simulate('greedy', { seed: 2, maxStar: 1 });
      check('自動プレイの星 1 で ひかり が何回も砕ける（3 回以上）', !sim.error && sim.glows >= 3, [sim.glows, sim.error]);
    },
  },
  {
    id: 'KL6', tier: 'smoke', node: true, title: 'ほしくだき：自機の動き（ふちから STANDOFF マスを保って回る・速さ SHIP_SPEED・2〜3 周ごとに回る向きを変える（1 周する前には変えない）・遠くからは寄ってくる・届かない所（RANGE より遠い）は撃たない）',
    run({ check, root }) {
      const L = load(root);
      let s = L.newGame(3);
      const ds = [], sp = [];
      // 回った角度は、テストの側で重心（rock.cx・cy）から見た角度を積んで数える（進む向き dir が + になるように）
      let flips = 0, lastDir = s.ship.dir, prev = { x: s.ship.x, y: s.ship.y };
      const segs = [];   // 向きを変えるまでに、その向きで回った周（[周, 秒]）
      let turn = 0, segT = 0, pa = Math.atan2(s.ship.y - s.rock.cy, s.ship.x - s.rock.cx), firstLapT = null, firstFlipT = null;
      for (let i = 0; i < 150 * 30; i++) {
        const r = L.step(s, L.STEP); s = r.state;
        const a = Math.atan2(s.ship.y - s.rock.cy, s.ship.x - s.rock.cx);
        let da = a - pa; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI; pa = a;
        turn += da * lastDir;
        if (firstLapT === null && turn >= 2 * Math.PI) firstLapT = s.t;
        if (s.ship.dir !== lastDir) { flips++; segs.push([+(turn / (2 * Math.PI)).toFixed(2), +(s.t - segT).toFixed(1)]); if (firstFlipT === null) firstFlipT = s.t; turn = 0; segT = s.t; lastDir = s.ship.dir; }
        sp.push(Math.hypot(s.ship.x - prev.x, s.ship.y - prev.y) / L.STEP); prev = { x: s.ship.x, y: s.ship.y };
        if (i % 15 === 0 && i > 300) ds.push(nearestEdge(L, s).d / L.CELL);
      }
      ds.sort((a, b) => a - b);
      ds.length = Math.min(ds.length, Math.round((90 * 30 - 300) / 15));   // ふちとの距離は 90 秒のうちで見る（前と同じ）
      const inBand = ds.filter((d) => d >= L.STANDOFF - 2 && d <= L.STANDOFF + 4).length / ds.length;
      check('ふちから離れすぎない・寄りすぎない：90 秒のうち 95% 以上で STANDOFF−2〜+4 マス（中央 4〜7 マス）', inBand >= 0.95 && ds[ds.length >> 1] >= 4 && ds[ds.length >> 1] <= 7 && ds[0] > 1, { inBand, med: ds[ds.length >> 1], min: ds[0], max: ds[ds.length - 1] });
      check('速さは SHIP_SPEED（70 単位/秒）', sp.every((v) => near(v, L.SHIP_SPEED, 1e-6)), [Math.min(...sp), Math.max(...sp)]);
      check('ORBIT_LAPS は [2, 3]（何周かごとに向きを変える。ユーザー「何周かごとに向きを変える」）', J(L.ORBIT_LAPS) === J([2, 3]) && L.FLIP_MIN === undefined, L.ORBIT_LAPS);
      check('1 周する前には向きを変えない：最初に向きを変えたのは、1 周（2 周目の終わり）よりあと', firstLapT !== null && firstFlipT !== null && firstFlipT > firstLapT, { firstLapT, firstFlipT });
      check('向きを変えるまでに、その向きで 2〜3 周（積んだ角度。±0.15 周）回る・150 秒で 1 回以上変える', segs.length >= 1 && segs.every(([n]) => n >= 1.85 && n <= 3.15), segs);
      check('ship.orb・ship.laps：laps は 2 か 3、orb はその向きで回った角度（0 から laps 周まで）', [2, 3].includes(s.ship.laps) && s.ship.orb >= -2 * Math.PI && s.ship.orb < s.ship.laps * 2 * Math.PI && near(s.ship.orb / (2 * Math.PI), turn / (2 * Math.PI), 0.15), [s.ship.laps, s.ship.orb, turn]);
      // 小さな星（10×10 マス）のまわりで 1 周ごとに変える形（laps: 1）にして、行き来しても数がずれない：何回変えても毎回 約 1 周
      {
        let q = setRock(L, mk(L), block(10, 10), { hp: 1e9, ship: [-L.STANDOFF, 4], ang: -Math.PI / 2, laps: 1 });
        let qd = q.ship.dir, qt = 0, qa = Math.atan2(q.ship.y - q.rock.cy, q.ship.x - q.rock.cx);
        const qs = [];
        for (let i = 0; i < 120 * 30; i++) {
          const r = L.step(q, L.STEP); const M = q.M; q = r.state; q.M = M;
          const a = Math.atan2(q.ship.y - q.rock.cy, q.ship.x - q.rock.cx);
          let da = a - qa; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI; qa = a;
          qt += da * qd;
          if (q.ship.dir !== qd) { qs.push(+(qt / (2 * Math.PI)).toFixed(2)); qt = 0; qd = q.ship.dir; q.ship = { ...q.ship, laps: 1 }; }
        }
        check('小さな星で laps 1：何回向きを変えても、毎回 その向きで 0.9〜1.1 周（引き返しで数えない・増えない）', qs.length >= 3 && qs.every((n) => n >= 0.9 && n <= 1.1), qs);
      }
      check('ship.ang は進む向き（x + cos(ang)·v, y + sin(ang)·v）', (() => { const r = L.step(s, L.STEP); return near(r.state.ship.x - s.ship.x, Math.cos(r.state.ship.ang) * L.SHIP_SPEED * L.STEP, 1e-9) && near(r.state.ship.y - s.ship.y, Math.sin(r.state.ship.ang) * L.SHIP_SPEED * L.STEP, 1e-9); })(), s.ship);
      check('星の周りを回る（90 秒で重心から見た向きが 90° 以上動く）', (() => { const a0 = Math.atan2(L.newGame(3).ship.y - s.rock.cy, L.newGame(3).ship.x - s.rock.cx), a1 = Math.atan2(s.ship.y - s.rock.cy, s.ship.x - s.rock.cx); let d = Math.abs(a1 - a0); if (d > Math.PI) d = 2 * Math.PI - d; return d > Math.PI / 2 || s.rock.left < s.rock.total; })(), null);
      // 遠く（30 マス）からは寄ってきて、届く（RANGE 18 マス）まで撃たない
      let f = setRock(L, mk(L), block(10, 10), { hp: 1e9, ship: [-30, 4], ang: 0 });
      const evs = [];
      let firstFire = null;
      for (let i = 0; i < 30 * 8; i++) { const r = L.step(f, L.STEP); const M = f.M; f = r.state; f.M = M; for (const e of r.events) evs.push(e); if (firstFire === null && r.events.some((e) => e.kind === 'fire')) firstFire = nearestEdge(L, f).d / L.CELL; }
      check('届かない所は撃たない：最初に撃ったのは、ふちまで RANGE（18 マス）以内に入ってから', firstFire !== null && firstFire <= L.RANGE + 0.5 && firstFire >= L.RANGE - 3, firstFire);
      check('遠くからは まっすぐ寄ってきて、STANDOFF のあたりで回りはじめる', near(nearestEdge(L, f).d / L.CELL, L.STANDOFF, 2.5), nearestEdge(L, f).d / L.CELL);
      // simulate の記録：ふちとの距離の平均は STANDOFF のあたり
      const sim = L.simulate('greedy', { seed: 1, maxStar: 2 });
      check('自動プレイ（星 1・2）：ふちとの距離の平均 4.5〜7 マス、離れすぎ（+4 より遠い）は 5% 以下', !sim.error && sim.standoff.avg >= 4.5 && sim.standoff.avg <= 7 && sim.standoff.far / sim.standoff.n <= 0.05, sim.standoff);
    },
  },
  {
    id: 'KL7', tier: 'smoke', node: true, title: 'ほしくだき：時間切れ（飛んでいる間だけ減る・0 で lost・tries が増える・lost の間は止まる・2 択の間は減らない）、retry（最初の形・残り時間が戻る・かけら・Lv・武器は残る・予約がここで当たる・lost のときだけ）',
    run({ check, root }) {
      const L = load(root);
      let s = L.newGame(5);
      const r1 = run(L, s, 10);
      check('飛んでいる間、left は 1 秒に 1 ずつ減る', near(r1.s.left, s.limit - 10, 1e-6), [r1.s.left, s.limit]);
      // 2 択の間は減らない
      const u = L.unlock({ ...r1.s, kakera: 1000 });
      const r2 = run(L, u.state, 5);
      check('2 択（choose）の間は left も t も変わらない', u.ok && r2.s.phase === 'choose' && r2.s.left === r1.s.left && r2.s.t === u.state.t, [u.ok, r2.s.phase, r2.s.left]);
      // 時間切れ
      s = { ...L.newGame(5), left: 0.5, kakera: 77, slots: [{ id: 'shot', lv: 5 }, { id: 'bolt', lv: 3 }], bench: [{ id: 'beam', lv: 9 }], cd: [0, 0] };
      s = L.reserveSwap(s, 1, 'beam').state;
      const mid = run(L, s, 3);
      const k0 = mid.s.kakera;
      const lost = ofKind(mid.evs, 'lost')[0];
      check('0 になったら phase lost・lost の出来事（broken）・tries 2・left 0・弾と火は消える', lost && mid.s.phase === 'lost' && mid.s.tries === 2 && mid.s.left === 0 && mid.s.shots.length === 0 && mid.s.burns.length === 0 && lost.broken >= 0 && lost.broken < 1 && ofKind(mid.evs, 'lost').length === 1, [lost, mid.s.phase, mid.s.tries]);
      const st = run(L, mid.s, 2);
      check('lost の間は止まったまま（t・left・マス・自機が変わらない）', st.s.t === mid.s.t && st.s.left === 0 && J(st.s.rock.mats) === J(mid.s.rock.mats) && J(st.s.ship) === J(mid.s.ship) && st.evs.length === 0, null);
      check('retry は lost のときだけ（fly では ok:false・reason phase）', L.retry(L.newGame(1)).ok === false && L.retry(L.newGame(1)).reason === 'phase' && L.retry(null).ok === false, null);
      const rt = L.retry(mid.s);
      const fresh = L.newGame(5);
      check('retry：phase fly・その星の最初の形・残り時間が戻る（2 回目は limit × 1.1。やさしくなる仕掛け）・自機は始めの位置', rt.ok && rt.state.phase === 'fly' && J(rt.state.rock.mats) === J(fresh.rock.mats) && rt.state.rock.left === fresh.rock.total && rt.state.left === rt.state.limit && rt.state.limit === Math.round(L.starInfo(1).limit * 1.1 / 10) * 10 && near(rt.state.ship.x, fresh.ship.x, 1e-9) && near(rt.state.ship.y, fresh.ship.y, 1e-9), [rt.ok, rt.state.phase, rt.state.left]);
      check('retry：かけら・Lv は残る、入れ替えの予約がここで当たる（swap の出来事・外した いなずま は Lv3 で ひかえ へ）', rt.state.kakera === k0 && rt.state.slots[0].lv === 5 && rt.state.slots[1].id === 'beam' && rt.state.slots[1].lv === 9 && J(rt.state.bench) === J([{ id: 'bolt', lv: 3 }]) && J(rt.state.swap) === J([]) && ofKind(rt.events, 'swap').length === 1, [rt.state.slots, rt.state.bench, rt.events]);
      check('やり直すたびに残り時間が 10% ずつ増える（limitTry。最大 2 倍）', L.limitTry(1, 0, 1) === L.starInfo(1).limit && L.limitTry(1, 0, 3) === Math.round(L.starInfo(1).limit * 1.2 / 10) * 10 && L.limitTry(1, 0, 11) === L.starInfo(1).limit * 2 && L.limitTry(1, 0, 99) === L.starInfo(1).limit * 2 && J(L.RETRY_EASE) === J({ step: 0.1, max: 1 }), [L.limitTry(1, 0, 3), L.limitTry(1, 0, 99)]);
      check('retry の rock は新しい物（key が変わる・dirty は空・gen は 0）', rt.state.rock !== mid.s.rock && rt.state.rock.key !== mid.s.rock.key && J(rt.state.rock.dirty) === '[]' && rt.state.rock.gen === 0, [rt.state.rock.key, mid.s.rock.key]);
      // lost の間に強くできる（つよくして もういちど）・2 択も開ける（戻り先は lost）
      const up = L.upgrade({ ...mid.s, kakera: 1e6 }, 0);
      const un = L.unlock({ ...mid.s, kakera: 1e6 });
      const ch = un.ok ? L.choose(un.state, 0) : null;
      check('lost の間も強くできる・2 択を開けて選ぶと lost にもどる', up.ok && up.state.slots[0].lv === 6 && un.ok && un.state.phase === 'choose' && ch && ch.ok && ch.state.phase === 'lost', [up.ok, un.ok, ch && ch.state.phase]);
      // lost のまま保存して開き直すと、やり直しの始め（予約が当たっている・tries 2）
      const back = L.loadSave(L.makeSave(mid.s));
      check('lost の間の保存を開き直すと、星の最初から fly（tries 2・予約は当たった形・残り時間は limit）', back && back.phase === 'fly' && back.tries === 2 && back.slots[1].id === 'beam' && J(back.swap) === '[]' && back.left === back.limit && back.rock.left === back.rock.total, back && [back.phase, back.tries, back.slots]);
    },
  },
  {
    id: 'KL8', tier: 'smoke', node: true, title: 'ほしくだき：クリア（おまけ＝value×0.2・time は使った秒・left・1.5 秒で次の星・次の星の残り時間と rock が新しい）、ボスの予告（10 の倍数）、ENDING_STAR でエンディング（1 回だけ）',
    run({ check, root }) {
      const L = load(root);
      let s = lastCell(L, { ...L.newGame(2), left: 300 });
      const v = s.rock.value, k0 = s.kakera;
      let r = until(L, s, (e) => e.kind === 'clear', 2);
      const c = ofKind(r.evs, 'clear')[0];
      check('最後のマスでクリア：clear（star・bonus＝floor(value×0.2)・time＝limit−left・left）・phase clear', c && c.star === 1 && c.bonus === Math.floor(v * 0.2) && r.s.phase === 'clear' && near(c.time, Math.round((r.s.limit - r.s.left) * 10) / 10, 0.11) && near(c.left, r.s.left, 0.06) && r.s.kakera >= k0 + c.bonus, c);
      check('クリアのとき bestT にその星の時間', r.s.bestT[1] === c.time, r.s.bestT);
      r = run(L, r.s, 1.6);
      check('1.5 秒で次の星（星 2・fly・残り時間 = limit(2)・新しい rock）', r.s.star === 2 && r.s.phase === 'fly' && r.s.left > r.s.limit - 0.2 && r.s.limit === L.starInfo(2).limit && r.s.rock.left === r.s.rock.total && r.s.rock.w === L.starInfo(2).w && r.s.tries === 1, [r.s.star, r.s.phase, r.s.left]);
      s = lastCell(L, mk(L, { star: 9 }));
      r = until(L, s, (e) => e.kind === 'boss', 3);
      check('星 10（ボス）が始まるとき boss の出来事', r.hit && ofKind(r.evs, 'boss')[0].star === 10 && r.s.star === 10 && L.starInfo(10).boss, r.s.star);
      s = lastCell(L, mk(L, { star: 30 }));
      r = run(L, until(L, s, (e) => e.kind === 'clear', 2).s, 1.6);
      check('ふつうの星 30 のあとは星 31（エンディングではない。ふつうは 50 面）', r.s.star === 31 && r.s.tier === 0 && r.s.phase === 'fly' && !ofKind(r.evs, 'ending').length, [r.s.star, r.s.phase]);
      s = lastCell(L, mk(L, { star: 50 }));
      r = until(L, s, (e) => e.kind === 'ending', 3);
      const en = ofKind(r.evs, 'ending')[0];
      check('ふつうの星 50 をクリアすると ending（{ kind, tier: 0, next: 1 }）・phase end・cleared・ハードの星 1（tier 1・star 1）に進んでおく', r.hit && J(en) === J({ kind: 'ending', tier: 0, next: 1 }) && r.s.phase === 'end' && r.s.cleared === true && r.s.tier === 1 && r.s.star === 1 && r.s.limit === L.starInfo(1, 1).limit, [en, r.s.phase, r.s.tier, r.s.star]);
      const st = run(L, r.s, 1);
      check('end の間は step が進まない。afterEnding で fly（ハードの星 1）、loadSave(makeSave()) でも同じ', st.s.t === r.s.t && (() => { const a = L.afterEnding(r.s); const b = L.loadSave(L.makeSave(r.s)); return a.ok && a.state.phase === 'fly' && a.state.tier === 1 && b && b.tier === 1 && b.star === 1 && b.phase === 'fly' && b.cleared && !L.afterEnding(a.state).ok; })(), null);
    },
  },
  {
    id: 'KL9', tier: 'smoke', node: true, title: 'ほしくだき：保存 v:3（往復・星の途中 mid（連長圧縮・hp 9 段・left）・クリアの演出中は次の星・壊れた値で落ちない）、v:1・v:2・ほかの版・読めない値は null（ユーザー決定「最初から」）、saveVersionOf、validateBest',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, { slots: [{ id: 'shot', lv: 3 }, { id: 'bolt', lv: 2 }], bench: [{ id: 'beam', lv: 4 }], kakera: 1234, seed: 9 });
      s = run(L, s, 20).s;
      const raw = L.makeSave(s);
      const o = JSON.parse(raw);
      check('保存は v:3 の JSON（star・kakera・kfrac・slots・bench・offer・swap・cleared・tries・totals・seed・rng・ms・bestT・mid）', o.v === 3 && ['star', 'kakera', 'kfrac', 'slots', 'bench', 'offer', 'swap', 'cleared', 'tries', 'totals', 'seed', 'rng', 'ms', 'bestT', 'mid'].every((k) => k in o) && !('ship' in o) && !('shots' in o), Object.keys(o));
      check('mid：mats と hp は連長圧縮の文字列（a〜f・a〜j）・left は残り秒', typeof o.mid.mats === 'string' && /^([a-f][0-9]*)+$/.test(o.mid.mats) && /^([a-j][0-9]*)+$/.test(o.mid.hp) && near(o.mid.left, s.left, 0.06), o.mid && { m: o.mid.mats.slice(0, 40), left: o.mid.left });
      const b = L.loadSave(raw);
      check('往復：星・かけら・武器・ひかえ・マス（途中のまま）・残り時間・tries が同じ。体力は 9 段に切り上げ', b && b.star === s.star && b.kakera === s.kakera && J(b.slots) === J(s.slots) && J(b.bench) === J(s.bench) && J(b.rock.mats) === J(s.rock.mats) && near(b.left, s.left, 0.06) && b.rock.left === s.rock.left &&
        b.rock.hp.every((h, i) => (s.rock.mats[i] ? h >= s.rock.hp[i] - 1e-9 && h <= s.rock.hp[i] + L.cellHp(s.star, MATN[s.rock.mats[i]]) / 9 + 1e-9 : h === 0)), b && [b.left, s.left, b.rock.left, s.rock.left]);
      check('保存の大きさ：星 50（132×132）の途中でも 20KB 未満', (() => { let t = run(L, mk(L, { star: 50, slots: [{ id: 'bomb', lv: 99 }, { id: 'beam', lv: 99 }] }), 20).s; return L.makeSave(t).length < 20000; })(), null);
      check('自機は保存しない（開くと決まった位置から）', b && near(b.ship.x, L.newGame(9).ship.x, 1e-9) === (J(b.rock.mats) === J(L.newGame(9).rock.mats)), null);
      check('v:1・v:2・v:4・読めない値・配列・null は null（古い保存は読まない）', [JSON.stringify({ v: 1, kakera: 5 }), JSON.stringify({ v: 2, star: 3, kakera: 9 }), JSON.stringify({ v: 4 }), '{', '[]', 'null', '', null, 42, JSON.stringify({ star: 3 })].every((x) => L.loadSave(x) === null), null);
      check('saveVersionOf：1・2・3 はその数、版の無い・読めない値は null', L.saveVersionOf(JSON.stringify({ v: 1 })) === 1 && L.saveVersionOf(JSON.stringify({ v: 2 })) === 2 && L.saveVersionOf(raw) === 3 && L.saveVersionOf('{') === null && L.saveVersionOf(JSON.stringify({ v: 'x' })) === null && L.saveVersionOf(null) === null, null);
      // 壊れた値
      const bad = [
        { slots: [{ id: 'shot', lv: 5 }, { id: 'shot', lv: 9 }, { id: 'nope', lv: 3 }, { id: 'bolt', lv: 1e9 }] },
        { slots: 'x' }, { slots: [] }, { slots: ALL.map((id) => ({ id, lv: 2 })) },
        { bench: [{ id: 'shot', lv: 3 }, { id: 'beam', lv: -4 }, { id: 'beam', lv: 5 }] }, { swap: [{ slot: 9, id: 'beam' }, { slot: 0, id: 'zzz' }] },
        { kfrac: 1.5 }, { kfrac: -1 }, { kakera: -5 }, { kakera: 'x' }, { star: -3 }, { star: 1e12 }, { tries: 0 }, { offer: ['shot', 'shot'] }, { offer: 'x' },
        { mid: { mats: 'zzz', hp: 'a', left: 10 } }, { mid: { mats: 'b99999', hp: '', left: 10 } }, { mid: 'x' }, { mid: { mats: o.mid.mats, hp: 'q', left: -1 } }, { mid: { mats: o.mid.mats, hp: o.mid.hp, left: 1e9 } },
        { bestT: { 1: -3, abc: 4, 2: 1e99, 3: 12.34 } }, { totals: 'x' }, { ms: [25, 99, 'x'] }
      ];
      const res = bad.map((x) => { const r0 = L.loadSave(JSON.stringify({ v: 3, star: 1, kakera: 10, seed: 9, ...x })); return r0; });
      check('壊れた値の一覧でも落ちない（全部 state を返し、step も動く）', res.every((r0) => r0 && L.step(r0, L.STEP)), res.map((r0) => !!r0));
      check('slots：重複は後ろを捨てる・知らない id は捨てる・lv は 1〜255（LEVEL_MAX）、空なら たま Lv1、5 つ目からは ひかえ へ', J(res[0].slots) === J([{ id: 'shot', lv: 5 }, { id: 'bolt', lv: 255 }]) && J(res[1].slots) === J([{ id: 'shot', lv: 1 }]) && J(res[2].slots) === J([{ id: 'shot', lv: 1 }]) && res[3].slots.length === 4 && res[3].bench.length === 2, [res[0].slots, res[3].bench]);
      check('bench・swap・kfrac・kakera・star・tries・offer を直す', J(res[4].bench) === J([{ id: 'beam', lv: 1 }]) && J(res[5].swap) === '[]' && res[6].kfrac === 0 && res[7].kfrac === 0 && res[8].kakera === 0 && res[9].kakera === 0 && res[10].star === 1 && res[11].tier > 0 && res[11].star >= 1 && res[11].star <= 30 && res[12].tries === 1 &&
        res[13].offer && res[13].offer.length === 2 && res[13].offer[0] !== res[13].offer[1] && !res[13].offer.includes('shot'), [res[4].bench, res[13].offer]);
      check('mid が壊れていたら星の最初から（落ちない・消さない）。left は 1〜limit に丸める・hp が壊れていたら満タン', res[15].rock.left === res[15].rock.total && res[16].rock.left === res[16].rock.total && res[17].rock.left === res[17].rock.total &&
        res[18].rock.left < res[18].rock.total && res[18].left === 1 && res[18].rock.hp.every((h, i) => !res[18].rock.mats[i] || h === L.cellHp(1, MATN[res[18].rock.mats[i]])) && res[19].left === res[19].limit, [res[18].left, res[19].left]);
      check('bestT・ms を直す', J(res[20].bestT) === J({ 3: 12.3 }) && J(res[22].ms) === J([25]), [res[20].bestT, res[22].ms]);
      check('mid のマスが その星の最初の形と食い違う（ちがう種類）なら使わない', (() => { const m2 = JSON.parse(raw); m2.seed = 10; const r0 = L.loadSave(JSON.stringify(m2)); return r0 && r0.rock.left === r0.rock.total; })(), null);
      // クリアの演出中の保存は次の星
      let c = lastCell(L, mk(L, { star: 3 }));
      c = until(L, c, (e) => e.kind === 'clear', 2).s;
      const co = JSON.parse(L.makeSave(c));
      check('クリアの演出中の保存は次の星（tries 1・mid なし・ms 空）', co.star === 4 && co.tries === 1 && !co.mid && J(co.ms) === '[]', co.star);
      // v73 までの保存の移し替え（計画書 §6.4・約束 §23.3）：印 lvv: 2 が無くハード（tier ≧ 1）なら Lv99 の武器を 99 + floor(0.8 × i) へ 1 回だけ
      const v73 = (x) => JSON.stringify({ v: 3, tier: 2, star: 11, kakera: 5, seed: 9, slots: [{ id: 'shot', lv: 99 }, { id: 'bolt', lv: 50 }], bench: [{ id: 'beam', lv: 99 }], ...x });
      const lvs = (r0) => r0 && [...r0.slots, ...r0.bench].map((w) => w.lv);
      const m1 = L.loadSave(v73({}));
      check('v73 の保存（印なし・ハード 段 2 星 11＝i 40）：Lv99 の武器は 99 + floor(0.8 × 40) = 131 へ。Lv99 でない武器は変えない（ひかえも）', J(lvs(m1)) === J([131, 50, 131]), lvs(m1));
      const m2 = L.loadSave(L.makeSave(m1)), m3 = L.loadSave(L.makeSave(m2));
      check('2 回読んでも二重に上がらない（保存に印 lvv: 2 が付く）。印があれば Lv99 のままでも変えない', JSON.parse(L.makeSave(m1)).lvv === 2 && J(lvs(m2)) === J([131, 50, 131]) && J(lvs(m3)) === J([131, 50, 131]) && J(lvs(L.loadSave(v73({ lvv: 2 })))) === J([99, 50, 99]), [lvs(m2), lvs(m3)]);
      check('ふつう（tier 0）の v73 の保存は変えない（印だけ付く）。段 10 では 255 で止まる', J(lvs(L.loadSave(v73({ tier: 0, star: 40 })))) === J([99, 50, 99]) && JSON.parse(L.makeSave(L.loadSave(v73({ tier: 0 })))).lvv === 2 && J(lvs(L.loadSave(v73({ tier: 10, star: 30 })))) === J([255, 50, 255]), null);
      const mb = [{ lvv: 'x' }, { lvv: null }, { lvv: [1] }, { lvv: 1e99 }, { lvv: -2 }, { lvv: {} }].map((x) => L.loadSave(v73(x)));
      check('壊れた印（文字・null・配列・巨大・負・オブジェクト）でも落ちない（印なしと同じに 1 回だけ上げる）', mb.every((r0) => r0 && J(lvs(r0)) === J([131, 50, 131]) && L.step(r0, L.STEP)), mb.map(lvs));
      check('validateBest（前のまま）', L.validateBest('12') === 12 && L.validateBest('x') === 0 && L.validateBest(-3) === 0 && L.validateBest(1e9) === 9999 && L.validateBest('') === 0, null);
    },
  },
  {
    id: 'KL10', tier: 'smoke', node: true, title: 'ほしくだき：決定的・イミュータブル（凍らせた state でも動く・元を変えない。upgrade・unlock・choose・reserveSwap・retry も）・例外を出さない（おかしな引数の一覧）',
    run({ check, root }) {
      const L = load(root);
      const go = (seed) => { let s = mk(L, { seed, slots: [{ id: 'shot', lv: 20 }, { id: 'bolt', lv: 15 }, { id: 'bomb', lv: 10 }, { id: 'beam', lv: 10 }] }); const evs = []; for (let i = 0; i < 600; i++) { const r = L.step(s, L.STEP); s = r.state; evs.push(r.events.length); } return J({ m: s.rock.mats, sh: s.ship, k: s.kakera, e: evs }); };
      check('同じ種・同じ操作で同じ結果（20 秒）、ちがう種でちがう', go(4) === go(4) && go(4) !== go(5), null);
      let s = run(L, mk(L, { seed: 4, kakera: 1e6, slots: [{ id: 'shot', lv: 20 }, { id: 'bolt', lv: 15 }], bench: [{ id: 'beam', lv: 2 }] }), 5).s;
      const before = J(s);
      deepFreeze(s);
      let ok = true;
      try {
        const r = L.step(s, L.STEP); ok = ok && !!r;
        const r2 = run(L, s, 2); ok = ok && r2.s.rock.left < s.rock.left + 1;
        ok = ok && L.upgrade(s, 0).ok && L.unlock(s).ok && L.choose(L.unlock(s).state, 0).ok && L.reserveSwap(s, 1, 'beam').ok;
        ok = ok && L.makeSave(s) !== null && L.progressOf(s) !== null;
        const lost = run(L, { ...s, left: 0.1 }, 0.5).s; deepFreeze(lost); ok = ok && L.retry(lost).ok;
      } catch (e) { ok = false; }
      check('凍らせた state でも step・upgrade・unlock・choose・reserveSwap・retry・makeSave が動く', ok, null);
      check('元の state は変わらない', J(s) === before, null);
      const r = L.step(s, L.STEP);
      check('マスが変わらない step では mats を写さない（hp・mats の配列が同じ物）。変わると新しい配列', (() => { const q = setRock(L, mk(L), block(5, 5), { hp: 1e9, ship: [-30, 2] }); const r1 = L.step(q, L.STEP); return r1.state.rock.mats === q.rock.mats && r1.state.rock.hp === q.rock.hp; })() && r.state.rock.mats !== s.rock.mats || r.state.rock.mats === s.rock.mats, null);
      const weird = [() => L.step(null, 1), () => L.step({}, 1), () => L.step(s, NaN), () => L.step(s, -5), () => L.step(s, 1e9), () => L.newGame('x'), () => L.newGame(NaN),
        () => L.upgrade(s, 9), () => L.upgrade(s, -1), () => L.upgrade(null, 0), () => L.unlock(null), () => L.choose(s, 0), () => L.choose(null, 0), () => L.reserveSwap(s, 9, 'beam'), () => L.reserveSwap(s, 0, 'zzz'),
        () => L.retry({}), () => L.progressOf(null), () => L.dpsOf(null, 0), () => L.upCostOf(s, 7), () => L.slotCostOf(null), () => L.swapChoicesOf(s, 99), () => L.makeSave(null), () => L.formatKakera({}), () => L.formatTime({}),
        () => L.simulate('zzz', { maxStar: 1, maxSec: 3 }), () => L.simulate('idle', 'x')];
      let thrown = 0;
      const outs = weird.map((f) => { try { return f(); } catch (e) { thrown++; return 'THROW'; } });
      check('おかしな引数でも例外を出さない（null か { ok:false }）', thrown === 0 && outs[0] === null && outs[1] === null && outs[5] === null && outs[7].ok === false && outs[11].ok === false && outs[15].ok === false && outs[16] === null, outs.map((x) => (x && typeof x === 'object' ? (x.ok === undefined ? 'obj' : x.ok) : x)));
      check('step の dt は 0〜0.1 秒に丸める', (() => { const a = L.step(s, 1e9).state, b = L.step(s, 0.1).state; return a.t === b.t && L.step(s, -5).state.t === s.t; })(), null);
    },
  },
  {
    id: 'KL11', tier: 'smoke', node: true, title: 'ほしくだき：2択（得意が違う2つ・持っている武器は出ない・引き直せない・選ぶまで止まる）、4 つのあとは ひかえ に Lv1、残り 1 つは候補 1 つ、6 種類で slotCostOf null・unlock は all、強くする（値段・しんかの evolve）',
    run({ check, root }) {
      const L = load(root);
      let s = L.newGame(4);
      check('かけらが足りないと unlock は money', L.unlock(s).reason === 'money', L.unlock(s));
      s = { ...s, kakera: 1e7 };
      const u = L.unlock(s);
      check('開けると phase choose・offer は持っていない 2 つで得意が違う・値段を払う', u.ok && u.state.phase === 'choose' && u.state.offer.length === 2 && !u.state.offer.includes('shot') && L.WEAPONS.find((w) => w.id === u.state.offer[0]).good !== L.WEAPONS.find((w) => w.id === u.state.offer[1]).good && u.state.kakera === 1e7 - 40, u.state && u.state.offer);
      check('2択の間は unlock できない（choose）、保存して開き直しても候補は同じ', L.unlock(u.state).reason === 'choose' && J(L.loadSave(L.makeSave(u.state)).offer) === J(u.state.offer) && L.loadSave(L.makeSave(u.state)).phase === 'choose', null);
      const c = L.choose(u.state, 1);
      check('選ぶと Lv1 で新しい枠に（to slot）・fly にもどる・cd が足される', c.ok && c.to === 'slot' && c.state.slots.length === 2 && c.state.slots[1].id === u.state.offer[1] && c.state.slots[1].lv === 1 && c.state.phase === 'fly' && c.state.cd.length === 2 && c.state.offer === null, c.state && c.state.slots);
      check('choose の範囲外・2択でないときは ok:false', !L.choose(u.state, 2).ok && !L.choose(c.state, 0).ok, null);
      // 4 つのあとは ひかえ
      let q = mk(L, { kakera: 1e12, slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 3 })) });
      let uq = L.unlock(q);
      check('4 つのあとも「あたらしい ぶき」：offer は残りの 2 つ・選ぶと ひかえ に Lv1（to bench）', uq.ok && J(uq.state.offer.slice().sort()) === J(['beam', 'fire']) && L.choose(uq.state, 0).to === 'bench' && L.choose(uq.state, 0).state.bench.length === 1 && L.choose(uq.state, 0).state.bench[0].lv === 1, uq.state && uq.state.offer);
      q = L.choose(uq.state, 0).state;
      uq = L.unlock(q);
      check('残り 1 つなら offer は長さ 1', uq.ok && uq.state.offer.length === 1, uq.state && uq.state.offer);
      q = L.choose(uq.state, 0).state;
      check('6 種類で slotCostOf は null・unlock は all', L.slotCostOf(q) === null && L.unlock(q).reason === 'all', null);
      // 強くする
      let w = mk(L, { kakera: 1e6, slots: [{ id: 'bolt', lv: 9 }] });
      const up = L.upgrade(w, 0);
      check('強くする：値段を払って Lv+1、Lv10 で evolve の出来事', up.ok && up.state.slots[0].lv === 10 && up.state.kakera === 1e6 - L.upCost('bolt', 9) && J(up.events) === J([{ kind: 'evolve', slot: 0, lv: 10 }]), up.events);
      check('かけらが足りないと money、Lv255（LEVEL_MAX）は max、Lv99 は 100 へ上がる', L.upgrade({ ...w, kakera: 0 }, 0).reason === 'money' && L.upgrade(mk(L, { kakera: 9e15, slots: [{ id: 'shot', lv: 255 }] }), 0).reason === 'max' && L.upgrade(mk(L, { kakera: 1e15, slots: [{ id: 'shot', lv: 99 }] }), 0).state.slots[0].lv === 100, null);
      // しんか の出来事：Lv99 までは 10 ごと（とたまの貫通）、Lv100 から 50 ごと（150・200・250）と Lv255
      const evAt = (id, lv) => L.upgrade(mk(L, { kakera: 9e15, slots: [{ id, lv: lv - 1 }] }), 0).events.length;
      check('Lv100 から先の evolve は 100・150・200・250・255 だけ（110 や 120 では出ない）', [100, 150, 200, 250, 255].every((v) => evAt('bolt', v) === 1) && [101, 110, 120, 199, 254].every((v) => evAt('bolt', v) === 0) && evAt('bolt', 90) === 1 && evAt('bolt', 95) === 0, [100, 110, 255].map((v) => evAt('bolt', v)));
      check('Lv254 の値段（8100ちょう）を持っていれば Lv255 まで上がり、かけらは 0 以上の整数', (() => { const r0 = L.upgrade(mk(L, { kakera: L.KAKERA_MAX, slots: [{ id: 'bomb', lv: 254 }] }), 0); return r0.ok && r0.state.slots[0].lv === 255 && Number.isInteger(r0.state.kakera) && r0.state.kakera >= 0 && L.upCostOf(r0.state, 0) === null && Number.isFinite(L.dpsOf(r0.state, 0)); })(), null);
      check('たまは 貫通の Lv（20・40・…・99）でも evolve', L.upgrade(mk(L, { kakera: 1e15, slots: [{ id: 'shot', lv: 98 }] }), 0).events.length === 1, null);
    },
  },
  {
    id: 'KL12', tier: 'smoke', node: true, title: 'ほしくだき：ひかえと入れ替え（reserveSwap の理由・持ったことが無い武器は選べない・取り消し・星の途中では替わらない・次の星の始めで替わる・Lv は武器ごと・ひかえは撃たない・保存して残る）',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, { slots: [{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 4 }], bench: [{ id: 'beam', lv: 11 }, { id: 'fire', lv: 2 }] });
      check('reserveSwap の理由：枠の外は slot・知らない id は id・持っていない（ひかえに無い）武器は bench', L.reserveSwap(s, 5, 'beam').reason === 'slot' && L.reserveSwap(s, 0, 'zzz').reason === 'id' && L.reserveSwap(s, 0, 'bomb').reason === 'bench', null);
      let r = L.reserveSwap(s, 1, 'beam');
      check('予約できる・swapChoicesOf は今の武器（取り消し）＋ほかの枠で使っていない ひかえ', r.ok && J(r.state.swap) === J([{ slot: 1, id: 'beam' }]) && J(L.swapChoicesOf(r.state, 0)) === J(['shot', 'fire']) && J(L.swapChoicesOf(r.state, 1)) === J(['bolt', 'beam', 'fire']), [r.state.swap, L.swapChoicesOf(r.state, 0)]);
      check('同じ武器を 2 つの枠に予約できない・今の武器で取り消し', L.reserveSwap(r.state, 0, 'beam').reason === 'bench' && J(L.reserveSwap(r.state, 1, 'bolt').state.swap) === '[]', null);
      s = r.state;
      const fly = run(L, s, 3);
      check('星の途中では替わらない（ひかえの武器は撃たない）', fly.s.slots[1].id === 'bolt' && ofKind(fly.evs, 'fire').every((e) => e.w === 'shot' || e.w === 'bolt'), fly.s.slots);
      check('保存して開き直しても予約と ひかえ が残る', (() => { const b = L.loadSave(L.makeSave(fly.s)); return J(b.swap) === J(fly.s.swap) && J(b.bench) === J(fly.s.bench); })(), null);
      const cl = until(L, lastCell(L, fly.s), (e) => e.kind === 'swap', 3);
      const sw = ofKind(cl.evs, 'swap')[0];
      check('次の星の始めで替わる（swap の出来事・載せた ビーム は Lv11・外した いなずま は Lv4 で ひかえ へ）', sw && cl.s.star === 2 && cl.s.slots[1].id === 'beam' && cl.s.slots[1].lv === 11 && cl.s.bench.some((x) => x.id === 'bolt' && x.lv === 4) && J(cl.s.swap) === '[]' && J(sw) === J({ kind: 'swap', slot: 1, from: 'bolt', to: 'beam', lv: 11 }), [sw, cl.s.slots]);
      check('ひかえの武器は強くできない（upgrade は枠の番号だけ）', L.upgrade({ ...cl.s, kakera: 1e9 }, 5).ok === false, null);
      // クリアの演出中の保存は予約を当てた形
      let c2 = until(L, lastCell(L, s), (e) => e.kind === 'clear', 2).s;
      const o = JSON.parse(L.makeSave(c2));
      check('クリアの演出中の保存は、予約を当てた slots・bench と swap: []', o.slots[1].id === 'beam' && o.bench.some((x) => x.id === 'bolt') && J(o.swap) === '[]', o.slots);
    },
  },
  {
    id: 'KL13', tier: 'smoke', node: true, title: 'ほしくだき：区切り（壊した割合 25・50・75% で milestone とおまけ＝value×0.03・各 1 回・やり直し（retry）でもらい直せない・次の星で元にもどる）',
    run({ check, root }) {
      const L = load(root);
      const base = L.newGame(6);
      // total を小さくして、あと 1 マスで 25% になる所から始める（broken = 1 − left / total）
      const R = base.rock;
      const s = { ...base, rock: { ...R, total: Math.floor(R.left / 0.75) } };
      const r = until(L, s, (e) => e.kind === 'milestone', 5);
      const ms = ofKind(r.evs, 'milestone');
      check('25% をこえた step で milestone（pct 25・bonus＝floor(value×0.03)）', ms.length >= 1 && ms[0].pct === 25 && ms[0].bonus === Math.floor(R.value * 0.03) && J(r.s.ms.slice(0, 1)) === '[25]', ms);
      const r2 = run(L, r.s, 1);
      check('同じ区切りは 1 回だけ', ofKind(r2.evs, 'milestone').filter((e) => e.pct === 25).length === 0, null);
      const lost = run(L, { ...r2.s, left: 0.05 }, 0.2).s;
      const rt = L.retry(lost).state;
      check('retry しても ms は残る（もらい直せない）', rt.ms.includes(25), rt.ms);
      const nx = run(L, lastCell(L, rt), 2).s;
      check('次の星では ms が空にもどる', nx.star === 2 && J(nx.ms) === '[]', nx.ms);
    },
  },
  {
    id: 'KL14', tier: 'smoke', node: true, title: 'ほしくだき：描画のための約束（rock.dirty に欠けたマスがたまる・読んだあと長さ 0 にしても次から入る・元の state の dirty は変わらない・gen が増える・cx・cy は残りの重心・hit に i）',
    run({ check, root }) {
      const L = load(root);
      let s = setRock(L, mk(L), ['rrrrrrrrrr', 'rrrrrrrrrr'], { hp: 0.1, ship: [-4, 0] });
      const r = run(L, s, 5 * L.STEP);
      const brk = ofKind(r.evs, 'break').map((e) => e.i);
      check('欠けたマスの添字が rock.dirty にたまる（何 step 分でも）・gen が増える', brk.length >= 5 && brk.every((i) => r.s.rock.dirty.includes(i)) && r.s.rock.gen >= 1 && J(s.rock.dirty) === '[]', [brk.length, r.s.rock.dirty.length, r.s.rock.gen]);
      const keep = r.s.rock.dirty;
      r.s.rock.dirty.length = 0;   // 描画が読んだあと
      const r2 = run(L, { ...r.s, cd: [0] }, 4 * L.STEP);
      const brk2 = ofKind(r2.evs, 'break').map((e) => e.i);
      check('描画が長さ 0 にしたあとも、次の step から新しく欠けたマスだけが入る（前の state の配列は書きかえない）', brk2.length >= 1 && J(r2.s.rock.dirty.slice().sort()) === J(brk2.slice().sort()) && keep.length === 0, [brk2, r2.s.rock.dirty]);
      check('cx・cy は残っているマスの重心（世界の単位）', (() => { const R = r2.s.rock; let sx = 0, sy = 0, n = 0; R.mats.forEach((m, i) => { if (m) { sx += cxw(L, R, i); sy += cyw(L, R, i); n++; } }); return near(R.cx, sx / n, 1e-6) && near(R.cy, sy / n, 1e-6); })(), [r2.s.rock.cx, r2.s.rock.cy]);
      const h = run(L, setRock(L, mk(L), block(4, 4), { hp: 1e9, ship: [-4, 1] }), 0.5);
      const hit = ofKind(h.evs, 'hit')[0];
      check('hit の出来事に i・w・mat・crack・aff', hit && Number.isInteger(hit.i) && hit.w === 'shot' && hit.mat === 'rock' && hit.crack === 0 && hit.aff === 1, hit);
      check('出来事の kind は §5.1 の一覧の中だけ', (() => { const ok = new Set(['fire', 'hit', 'break', 'chunk', 'glow', 'bolt', 'boom', 'beam', 'burn', 'evolve', 'clear', 'lost', 'ending', 'milestone', 'swap', 'boss']); const sim = []; let t = mk(L, { seed: 2, slots: ALL.slice(0, 4).map((id) => ({ id, lv: 15 })) }); for (let i = 0; i < 900; i++) { const q = L.step(t, L.STEP); t = q.state; for (const e of q.events) sim.push(e.kind); } return sim.length > 100 && sim.every((k2) => ok.has(k2)); })(), null);
      check('progressOf → { broken, left, total, timeLeft, timeFrac }', (() => { const p = L.progressOf(r2.s); return p && near(p.broken, 1 - r2.s.rock.left / r2.s.rock.total, 1e-12) && p.left === r2.s.rock.left && p.total === r2.s.rock.total && p.timeLeft === r2.s.left && near(p.timeFrac, r2.s.left / r2.s.limit, 1e-12); })(), L.progressOf(r2.s));
    },
  },
  {
    id: 'KL15', tier: 'smoke', node: true, title: 'ほしくだき：時間切れの厳しさ（何もしない（idle）と星 1 は時間切れ、greedy は星 1〜3 で時間切れにならず 1 つの星が 2.5〜5 分、最初の買い物が 40 秒以内）',
    run({ check, root, tier }) {
      const L = load(root);
      const seeds = tier === 'full' ? [1, 2, 3] : [1];
      const idle = seeds.map((seed) => L.simulate('idle', { seed, maxStar: 1, maxTries: 1 }));
      check('何もしないと星 1 は時間切れ（lost が出る・クリアしない・壊した割合 1 未満）', idle.every((r) => !r.error && r.losts.length >= 1 && r.stars.length === 0 && r.losts[0].star === 1 && r.losts[0].broken < 1), idle.map((r) => [r.losts[0], r.error]));
      const g = seeds.map((seed) => L.simulate('greedy', { seed, maxStar: 3 }));
      check('greedy は星 1〜3 で時間切れにならない（1 回目でクリア）', g.every((r) => !r.error && r.losts.length === 0 && r.stars.length === 3 && r.stars.every((x) => x.tries === 1)), g.map((r) => [r.losts.length, r.stars.map((x) => x.clearSec), r.error]));
      check('greedy の星 1〜3：1 つの星が 2.5〜5 分（150〜300 秒）で、limit の 8 割より早い', g.every((r) => r.stars.every((x) => x.clearSec >= 150 && x.clearSec <= 300 && x.clearSec <= x.limit * 0.8)), g.map((r) => r.stars.map((x) => [x.clearSec, x.limit])));
      check('最初の買い物は 40 秒以内', g.every((r) => r.firstBuySec !== null && r.firstBuySec <= 40), g.map((r) => r.firstBuySec));
    },
  },
  {
    id: 'KL16', tier: 'full', node: true, title: 'ほしくだき：1000 回の乱数の操作（強くする・開ける・選ぶ・入れ替えの予約・retry・step の大きさ）で不変条件（slots 1〜4・slots と bench が重ならず 6 以下・弾 ≦ SHOTS_MAX・かけらは 0 以上の整数・left は 0〜limit・rock.left はマスの数・自機の位置が有限・phase）',
    run({ check, root }) {
      const L = load(root);
      let seed = 99;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      let s = mk(L, { seed: 3, kakera: 500 });
      const bad = [];
      for (let k = 0; k < 1000; k++) {
        const x = rnd();
        let r;
        if (x < 0.15) r = L.upgrade(s, Math.floor(rnd() * 5));
        else if (x < 0.22) r = L.unlock({ ...s, kakera: s.kakera + Math.floor(rnd() * 1e6) });
        else if (x < 0.3 && s.phase === 'choose') r = L.choose(s, Math.floor(rnd() * 2));
        else if (x < 0.35) r = L.reserveSwap(s, Math.floor(rnd() * 4), ALL[Math.floor(rnd() * 6)]);
        else if (x < 0.38) r = { state: { ...s, left: Math.min(s.left, 0.05) } };
        else if (x < 0.42 && s.phase === 'lost') r = L.retry(s);
        else { let t = s; const n = 1 + Math.floor(rnd() * 20); for (let i = 0; i < n; i++) t = L.step(t, rnd() * 0.12).state; r = { state: t }; }
        if (r && r.state) s = r.state;
        if (s.phase === 'end') s = L.loadSave(L.makeSave(s));
        const ids = s.slots.map((y) => y.id).concat(s.bench.map((y) => y.id));
        const errs = [];
        if (!(s.slots.length >= 1 && s.slots.length <= 4)) errs.push('slots');
        if (new Set(ids).size !== ids.length || ids.length > 6) errs.push('bench');
        if (s.shots.length > L.SHOTS_MAX) errs.push('shots');
        if (!(Number.isInteger(s.kakera) && s.kakera >= 0)) errs.push('kakera');
        if (!(s.left >= 0 && s.left <= s.limit)) errs.push('left');
        if (k % 50 === 0 && s.rock.left !== countAlive(s.rock)) errs.push('rock.left');
        if (![s.ship.x, s.ship.y, s.ship.ang].every(Number.isFinite)) errs.push('ship');
        if (!['fly', 'choose', 'lost', 'clear'].includes(s.phase)) errs.push('phase ' + s.phase);
        if (s.cd.length !== s.slots.length) errs.push('cd');
        if (errs.length) { bad.push({ k, errs }); if (bad.length > 5) break; }
      }
      check('1000 回の乱数の操作で不変条件が崩れない', bad.length === 0, bad);
      check('最後まで進んだ（星か かけら が増えた）', s.star > 1 || s.totals.cells > 100, [s.star, s.totals.cells]);
    },
  },
  {
    id: 'KL17', tier: 'full', flaky: { why: 'Node の CPU 時間を測る（並列の負荷で揺れる）', checks: /1 step の中央|CPU 時間/ }, node: true, title: 'ほしくだき：重さ（132×132 の星・4 つ Lv30〜255 で、公開の step 1 回の中央が 1ms 以下・95% が 2ms 以下、stepCells が 20000 以下）',
    run({ check, root }) {
      const L = load(root);
      const out = [];
      for (const [star, lv, ids] of [[50, 30, ['spread', 'bomb', 'bolt', 'beam']], [50, 80, ['shot', 'bomb', 'bolt', 'beam']], [9999, 255, ['shot', 'spread', 'bomb', 'beam']]]) {
        let s = mk(L, { star, seed: 5, cleared: star > 30, slots: ids.map((id) => ({ id, lv })) });
        const ts = [];
        let brk = 0;
        for (let i = 0; i < 900; i++) { const t0 = process.hrtime.bigint(); const r = L.step(s, L.STEP); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); s = r.state; s.rock.dirty.length = 0; brk += r.events.filter((e) => e.kind === 'break').length; if (s.phase !== 'fly') break; }
        ts.sort((a, b) => a - b);
        const sim = L.simulate('idle', { seed: 5, maxSec: 20, start: { star, slots: ids.map((id) => ({ id, lv })) } });
        out.push({ star, lv, grid: s.rock.w + 'x' + s.rock.h, median: +ts[ts.length >> 1].toFixed(4), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(3), cells: sim.stepCells, brk, err: sim.error });
      }
      check('132×132 の星・4 つの武器で 1 step の中央が 1ms 以下・95% が 2ms 以下', out.every((o) => o.grid === '132x132' && o.median <= 1 && o.p95 <= 2 && !o.err) && out[2].brk > 100, out);
      check('stepCells（1 step に調べたマスの数の目安）の最大が 20000 以下', out.every((o) => o.cells > 0 && o.cells <= 20000), out.map((o) => o.cells));
      const c0 = cpuOf();
      const g = L.simulate('greedy', { seed: 1, maxStar: 10 });
      const cu = cpuOf(c0), ms = Math.round((cu.user + cu.system) / 1000);
      check(`greedy で星 10 まで 1 本が CPU 時間 6 秒以内（CPU ${ms}ms）`, !g.error && g.stars.length === 10 && ms <= 6000, [ms, g.stars.length]);
    },
  },
  {
    id: 'KL18', tier: 'smoke', node: true, title: 'ほしくだき：hold（true の間は撃たない・自機は動く・時間は減る・lost とクリアで false にもどる・保存しない）',
    run({ check, root }) {
      const L = load(root);
      const s = { ...L.newGame(2), hold: true };
      const r = run(L, s, 3);
      check('hold の間は撃たない・自機は動く・left は減る', ofKind(r.evs, 'fire').length === 0 && (r.s.ship.x !== s.ship.x || r.s.ship.y !== s.ship.y) && r.s.left < s.left && r.s.hold === true, null);
      const l = run(L, { ...s, left: 0.1 }, 0.3);
      check('lost で hold は false', l.s.phase === 'lost' && l.s.hold === false, l.s.hold);
      const c = until(L, lastCell(L, { ...s, hold: false }), (e) => e.kind === 'clear', 2);
      check('クリアで hold は false', c.hit && ({ ...c.s, hold: true }) && run(L, { ...lastCell(L, s), hold: true }, 0.3).s.hold === true && c.s.hold === false, null);
      check('hold は保存しない', !('hold' in JSON.parse(L.makeSave(s))) && L.loadSave(L.makeSave(s)).hold === false, null);
    },
  },
  {
    id: 'KL19', tier: 'full', node: true, title: 'ほしくだき：自動プレイでふつうの星 50 まで（計画書 §6 の目安：greedy で 1 つの星がふつう 3〜5 分・ボス 6 分以内・時間切れなし・5 つ目の武器が星 15〜20・6 つ目が星 28〜35・合計 2.8〜4 時間・星 50 で Lv90 以上、30 秒に 1 つ買う人は時間切れのあと強くして進める）',
    run({ check, root }) {
      const L = load(root);
      const g = L.simulate('greedy', { seed: 1 });
      const st = g.stars;
      const normal = st.filter((x) => !x.boss && x.star > 3);
      check('greedy：星 50 までクリア・時間切れ 0 回・エラーなし', !g.error && st.length === 50 && g.losts.length === 0, [st.length, g.losts.length, g.error]);
      check('greedy：ふつうの星（4〜49）の 9 割が 3〜5 分（180〜300 秒）・全部 6 分以内、ボスは 4〜6 分', normal.filter((x) => x.clearSec >= 180 && x.clearSec <= 300).length >= normal.length * 0.9 && normal.every((x) => x.clearSec <= 360) && st.filter((x) => x.boss).every((x) => x.clearSec >= 240 && x.clearSec <= 360), st.map((x) => [x.star, x.clearSec]));
      check('greedy：どの星も limit の 9 割より早い（強くすれば間に合う）', st.every((x) => x.clearSec <= x.limit * 0.9), st.filter((x) => x.clearSec > x.limit * 0.9).map((x) => [x.star, x.clearSec, x.limit]));
      const got5 = g.gotAt.find((x) => x.n === 5), got6 = g.gotAt.find((x) => x.n === 6);
      check('5 つ目の武器が星 15〜20、6 つ目が星 28〜35', got5 && got5.star >= 15 && got5.star <= 20 && got6 && got6.star >= 28 && got6.star <= 35, g.gotAt);
      check('合計（飛んでいた時間）2.8〜4 時間', g.endSec >= 2.8 * 3600 && g.endSec <= 4 * 3600, g.endSec);
      check('星 50 で 4 つの武器が Lv90 以上（強くする楽しみが星 50 まで続く。Lv100 からは値段の伸びが小さいので たま が先に 100 をこえる）・星 30 では Lv75 以下', g.final.slots.every((x) => x.lv >= 90) && st[29].slots.split(' ').every((x) => +x.replace(/\D/g, '') <= 75), [g.final.slots, st[29].slots]);
      check('弾は 120・粒は 600 をこえない', g.shotsMax <= 120 && g.particlesMax <= 1500, [g.shotsMax, g.particlesMax]);
      const p = L.simulate('greedy', { seed: 2, buyEvery: 30, maxStar: 12 });
      check('30 秒に 1 つ買う人（星 12 まで）：時間切れになっても、強くしてやり直せばクリアして進める（同じ星は 6 回以内）', !p.error && p.stars.length === 12 && p.stars.every((x) => x.tries <= 6), [p.stars.map((x) => x.tries).join(''), p.losts.length, p.error]);
    },
  },
  {
    id: 'KL20', tier: 'smoke', node: true, title: 'ほしくだき：ハードモード（段 tier。計画書 §1.7）：段 1 から 1 段 30 面・通しの番号 50 + 30·(t−1) + 星（硬さ・かけら・best）・大きさは段の中の星・ひかり は 1/2・1/4・1/8（最低 1 か所）・limit・段の切り替わり（ending { tier, next }）・保存の往復と tier の壊れた値',
    run({ check, root }) {
      const L = load(root);
      const i1 = L.starInfo(1, 1), i30 = L.starInfo(30, 1), i2 = L.starInfo(7, 2);
      check('starInfo(n, tier)：tier・star・num（通しの番号）・hard を返す。段 1 の星 1 は num 51・半径 36、星 30 は num 80・半径 64・ボス、段 2 の星 7 は num 87', i1.tier === 1 && i1.star === 1 && i1.num === 51 && i1.hard && i1.radius === 36 && i30.num === 80 && i30.radius === 64 && i30.boss && i2.num === 87 && i2.tier === 2 && L.starInfo(1).tier === 0 && !L.starInfo(1).hard && L.starInfo(50).num === 50, [i1, i30.num, i2.num]);
      check('通しの番号で読める：starInfo(51) は段 1 の星 1、hpMul(1, 1) === hpMul(51)、valMul も同じ', J(L.starInfo(51)) === J(i1) && L.hpMul(1, 1) === L.hpMul(51) && L.valMul(3, 2) === L.valMul(83) && L.cellHp(4, 'iron', 1) === L.cellHp(54, 'iron'), null);
      check('大きさは段の中の星（段 1 の星 15 は ふつうの星 25 くらい）、ボスは段の中の 10・20・30', near(L.starInfo(15, 1).radius, L.starInfo(25).radius, 0.6) && L.starInfo(10, 1).boss && L.starInfo(20, 3).boss && !L.starInfo(11, 1).boss, [L.starInfo(15, 1).radius, L.starInfo(25).radius]);
      // Lv100〜255 に合わせた硬さ：ハードの星 i 個目（i = 30·(t−1) + n − 1）に LV_HI.dmg^min(lvMax, lv × i)
      const lvUp = (n, t) => L.LV_HI.dmg ** Math.min(L.HARD.lvMax, L.HARD.lv * (30 * (t - 1) + n - 1));
      const adj = (n, t) => L.hpMul(n, t) / (L.HP_TABLE[49] * L.HARD.hp * L.HARD.tierUp ** (Math.min(t, L.HARD.tierMax) - 1) * lvUp(n, t));
      const sumT = (t) => Array.from({ length: 30 }, (_, k) => L.hpMul(k + 1, t)).reduce((x, y) => x + y);
      check('ハードの体力：HP_TABLE[49] × HARD.hp × tierUp^(段−1)（段 tierMax で止まる）× 1.02^min(140, 0.8 × i)（Lv100〜255 の強さに合わせる）× adj。段が上がるほど硬く、段 7 の途中から先は同じ', L.HARD.hp > 1 && L.HARD.tierUp > 1 && L.HARD.lv === 0.8 && L.HARD.lvMax === 140 && [[1, 1], [5, 2], [10, 3], [17, 7], [29, 9]].every(([n, t]) => adj(n, t) > 0.8 && adj(n, t) < 1.4) && [1, 2, 3, 4, 5, 6].map(sumT).every((v, k, arr) => k === 0 || v > arr[k - 1] * 1.05) && near(sumT(8), sumT(9), 0.05 * sumT(8)) && near(lvUp(1, 8), lvUp(30, 12), 1e-9) && near(L.hpMul(30, 300), L.hpMul(30, 8), 1e-9 * L.hpMul(30, 8)), [[5, 1], [5, 2], [5, 3], [5, 4], [5, 8]].map(([n, t]) => L.hpMul(n, t)));
      check('limit：ハードは 380 秒（300 × 1.25）・ボス 500 秒（400 × 1.25）', L.starInfo(1, 1).limit === 380 && L.starInfo(29, 2).limit === 380 && L.starInfo(10, 1).limit === 500 && L.starInfo(30, 5).limit === 500, [L.starInfo(1, 1).limit, L.starInfo(10, 1).limit]);
      // ひかり の数：同じ種・同じ星で、段 0・1・2・3・4
      const gl = [0, 1, 2, 3, 4].map((tier) => blobs(mk(L, { tier, star: 20, seed: 3 }).rock, 5).length);
      check('ひかり の かたまりの数：段 1 は ふつうの約 1/2・段 2 は約 1/4・段 3 から約 1/8（最低 1 か所）', gl[0] >= 10 && Math.abs(gl[1] - gl[0] / 2) <= 2 && Math.abs(gl[2] - gl[0] / 4) <= 2 && gl[3] >= 1 && gl[3] <= Math.ceil(gl[0] / 8) + 1 && gl[4] >= 1 && gl[4] <= gl[3] + 1, gl);
      check('段 1 の星 1 でも ひかり は 1 か所以上', blobs(mk(L, { tier: 5, star: 1, seed: 1 }).rock, 5).length >= 1, null);
      check('同じ種でも段がちがうと形がちがう', J(mk(L, { tier: 0, star: 7, seed: 4 }).rock.mats) !== J(mk(L, { tier: 1, star: 7, seed: 4 }).rock.mats), null);
      // クリア：clear に tier・num、段 1 の星 30 のあとは段 2 の星 1
      let s = lastCell(L, mk(L, { tier: 1, star: 7 }));
      let r = until(L, s, (e) => e.kind === 'clear', 2);
      const c = ofKind(r.evs, 'clear')[0];
      check('clear に tier と num（best に書く通しの数 50 + 30·(t−1) + 星）、progressOf にも tier・star・num・hard', c && c.tier === 1 && c.star === 7 && c.num === 57 && (() => { const p = L.progressOf(s); return p.tier === 1 && p.star === 7 && p.num === 57 && p.hard; })(), c);
      r = run(L, r.s, 1.6);
      check('段の中では次の星へ（段 1 の星 8・fly）', r.s.tier === 1 && r.s.star === 8 && r.s.phase === 'fly' && r.s.limit === 380, [r.s.tier, r.s.star]);
      s = lastCell(L, mk(L, { tier: 1, star: 30 }));
      r = until(L, s, (e) => e.kind === 'ending', 3);
      const en = ofKind(r.evs, 'ending')[0];
      check('段 1 の星 30 をクリアすると ending { kind, tier: 1, next: 2 }・phase end・段 2 の星 1 に進んでおく', J(en) === J({ kind: 'ending', tier: 1, next: 2 }) && r.s.phase === 'end' && r.s.tier === 2 && r.s.star === 1 && r.s.rock.w === L.starInfo(1, 2).w, [en, r.s.tier, r.s.star]);
      const cl = until(L, s, (e) => e.kind === 'clear', 2).s;
      const co = JSON.parse(L.makeSave(cl));
      check('段の最後の星のクリアの演出中に閉じても、次の段の星 1 として保存（tier 2・star 1・cleared）', co.tier === 2 && co.star === 1 && co.cleared === true && !co.mid, [co.tier, co.star]);
      // 保存の往復と壊れた値
      const h = run(L, mk(L, { tier: 2, star: 9, kakera: 5e9, slots: [{ id: 'shot', lv: 99 }] }), 5).s;
      const o = JSON.parse(L.makeSave(h));
      const b = L.loadSave(L.makeSave(h));
      check('保存は v:3 のまま tier の欄を足す。往復で tier・star・マス・残り時間が同じ', o.v === 3 && o.tier === 2 && o.star === 9 && b && b.tier === 2 && b.star === 9 && J(b.rock.mats) === J(h.rock.mats) && near(b.left, h.left, 0.06) && b.limit === h.limit, [o.tier, b && b.tier]);
      const tb = [undefined, -1, 'x', null, 1.7, 1e9, NaN].map((tier) => { const q = L.loadSave(JSON.stringify({ v: 3, star: 4, seed: 1, ...(tier === undefined ? {} : { tier }) })); return q && q.tier; });
      check('tier が無い・壊れた値（−1・文字・null・NaN）は 0、小数は切り捨て、大きすぎる値は TIER_MAX', J(tb) === J([0, 0, 0, 0, 1, L.TIER_MAX, 0]), tb);
      const ov = L.loadSave(JSON.stringify({ v: 3, tier: 1, star: 45, seed: 1 }));
      check('段 1 以上で星が 30 をこえていたら、通しの番号として次の段へ直す（段 1 の 45 → 段 2 の 15）。ふつうで 50 をこえたら段 1 から', ov && ov.tier === 2 && ov.star === 15 && (() => { const q = L.loadSave(JSON.stringify({ v: 3, star: 53, seed: 1 })); return q && q.tier === 1 && q.star === 3 && q.cleared; })(), ov && [ov.tier, ov.star]);
      check('段 1 以上なら cleared は true（ふつうのエンディングは見た）', L.loadSave(JSON.stringify({ v: 3, tier: 1, star: 2, seed: 1, cleared: false })).cleared === true, null);
      check('retry・やり直しでも段は変わらない', (() => { const l = run(L, { ...mk(L, { tier: 3, star: 4 }), left: 0.05 }, 0.2).s; const q = L.retry(l).state; return l.phase === 'lost' && q.tier === 3 && q.star === 4 && q.left === L.limitTry(4, 3, 2); })(), null);
    },
  },
  {
    id: 'KL21', tier: 'full', node: true, title: 'ほしくだき：ハードの自動プレイ（Lv99 の 4 つの武器で 段 1 の星 1〜12、その段に見合う Lv で 段 3 の星 1〜3・段 8（Lv255）の星 1〜2、Lv99 のままの段 3 は時間切れ：greedy で 1 つの星が 4〜6 分くらい（ボス 7.5 分以内）・時間切れ 0 回・limit の 9 割より早い）',
    run({ check, root }) {
      const L = load(root);
      const slots = ['shot', 'bolt', 'beam', 'bomb'].map((id) => ({ id, lv: 99 })), bench = ['spread', 'fire'].map((id) => ({ id, lv: 60 }));
      const a = L.simulate('greedy', { seed: 2, maxTier: 1, maxStar: 12, start: { tier: 1, star: 1, slots, bench, kakera: 1e15 } });
      const st = a.stars;
      check('段 1 の星 1〜12：時間切れ 0 回・エラーなし', !a.error && st.length === 12 && a.losts.length === 0 && st.every((x) => x.tier === 1), [st.length, a.losts.length, a.error]);
      check('段 1：ふつうの星は 4〜6 分くらい（220〜360 秒）、ボスは 7.5 分以内、どれも limit の 9 割より早い', st.every((x) => (x.boss ? x.clearSec >= 300 && x.clearSec <= 450 : x.clearSec >= 220 && x.clearSec <= 360) && x.clearSec <= x.limit * 0.9), st.map((x) => [x.num, x.clearSec, x.limit]));
      // 段 3・段 8 は、greedy で ふつう 50 から続けて来たときの Lv（計画書 §6.3：段 2 の終わり たま193・ビーム175・いなずま169・どかん97、段 6 の途中から全部 Lv255）
      const s3 = [['shot', 193], ['beam', 175], ['bolt', 169], ['bomb', 97]].map(([id, lv]) => ({ id, lv }));
      const c = L.simulate('greedy', { seed: 3, maxTier: 3, maxStar: 3, start: { tier: 3, star: 1, slots: s3, bench, kakera: 1e15 } });
      check('段 3（もう一段難しい）の星 1〜3（その段に見合う Lv170〜195）：時間切れ 0 回・limit の 9 割より早い・3〜6 分', !c.error && c.stars.length === 3 && c.losts.length === 0 && c.stars.every((x) => x.clearSec <= x.limit * 0.9 && x.clearSec >= 180 && x.clearSec <= 360), c.stars.map((x) => [x.num, x.clearSec, x.limit]));
      const lo = L.simulate('greedy', { seed: 3, maxTier: 3, maxStar: 1, maxTries: 1, start: { tier: 3, star: 1, slots, bench, kakera: 0 } });
      check('段 3 を Lv99 のまま（かけら 0・強くしない分の Lv）で始めると、星 1 は時間切れになる（Lv100 から先を強くする意味がある）', !lo.error && lo.losts.length >= 1, [lo.losts.length, lo.stars.length]);
      const s8 = ['shot', 'bolt', 'beam', 'bomb'].map((id) => ({ id, lv: 255 }));
      const e8 = L.simulate('greedy', { seed: 4, maxTier: 8, maxStar: 2, start: { tier: 8, star: 1, slots: s8, bench, kakera: 9e15 } });
      check('段 8（硬さが止まったあと）を Lv255 の 4 つで：時間切れ 0 回・limit の 9 割より早い（どこかで詰まらない）', !e8.error && e8.stars.length === 2 && e8.losts.length === 0 && e8.stars.every((x) => x.clearSec <= x.limit * 0.9), e8.stars.map((x) => [x.num, x.clearSec, x.limit]));
    },
  },
  {
    id: 'KL22', tier: 'smoke', node: true, title: 'ほしくだき：ほのおの燃え広がり（ユーザー「燃え広がる感じが欲しい」2026-11-10。こおり へは何段も広く（1 回の火で BURN.ice マスまで）・0.25 秒ごとに 1 段・てつ へは移らない・いわ へは 1 段だけ・決まった結果）',
    run({ check, root }) {
      const L = load(root);
      check('BURN の定数（1 か所）', J(L.BURN) === J({ step: 0.25, ice: 40, other: 1, otherP: 0.35, max: 160 }), L.BURN);
      // こおり 20×20：1 回の火で 40 マス（＋火のもと）まで広がる。全部 こおり
      const a = fireOnce(L, block(20, 20, 'c'), 4);
      const R = a.s0.rock;
      check('こおり：1 回の火が何段も燃え広がる（火のもとと合わせて BURN.ice + 1 マス。どれも こおり）', a.first && a.cells.size === L.BURN.ice + 1 && [...a.cells].every((i) => R.mats[i] === 3), [a.first && a.first.i, a.cells.size]);
      const far = Math.max(...[...a.cells].map((i) => manh(R, i, a.first.i)));
      check('こおり：火のもとから 4 マス以上はなれた所まで燃え広がり、burn に from（もとのマス）と d（段）がある', far >= 4 && a.evs.filter((e) => e.from >= 0).every((e) => manh(R, e.i, e.from) === 1 && e.d >= 1), [far]);
      // 広がる速さ：火をつけてから 1 秒の間に移るのは 4〜5 段まで（0.25 秒ごとに 1 段。目で追える）
      const one = fireOnce(L, block(20, 20, 'c'), 1);
      const far1 = Math.max(...[...one.cells].map((i) => manh(R, i, one.first.i)));
      check('こおり：燃え広がる速さは 0.25 秒ごとに 1 段（1 秒で 3〜5 マス先まで）', far1 >= 3 && far1 <= 5 && one.cells.size < a.cells.size, [far1, one.cells.size]);
      // てつ 10×10：移らない
      const iron = fireOnce(L, block(10, 10, 'i'), 3);
      check('てつ：燃え移らない（燃えるのは火のもとの 1 マスだけ）', iron.first && iron.cells.size === 1, [iron.cells.size]);
      // いわ 10×10：1 段だけ（火のもとのとなりまで）、確率つき
      const rocks = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fireOnce(L, block(10, 10, 'r'), 3, seed));
      check('いわ：火のもとのとなり（1 段）までだけ移る。8 つの種のどれかで移り、全部は移らない', rocks.every((x) => x.first && [...x.cells].every((i) => manh(x.s0.rock, i, x.first.i) <= 1) && x.evs.every((e) => (e.d | 0) <= 1)) && rocks.some((x) => x.cells.size > 1) && rocks.reduce((n, x) => n + x.cells.size - 1, 0) < 8 * 4, rocks.map((x) => x.cells.size));
      // まざった星：こおり の帯にそって燃え広がり、まわりの てつ へは移らない
      const mixRows = Array.from({ length: 12 }, (_, r) => (r === 5 || r === 6 ? 'c'.repeat(30) : 'i'.repeat(30)));
      const mx = fireOnce(L, mixRows, 4);
      check('まざった星：こおり の帯にそって燃え広がり、てつ は燃えない', mx.first && mx.cells.size >= 20 && [...mx.cells].every((i) => mx.s0.rock.mats[i] === 3 || i === mx.first.i), [mx.cells.size]);
      // 決まった結果：同じ局面からは同じ燃え方（Math.random を使わない）・元の state を変えない
      const b = fireOnce(L, block(20, 20, 'c'), 4), c2 = fireOnce(L, block(10, 10, 'r'), 3, 3), c3 = fireOnce(L, block(10, 10, 'r'), 3, 3);
      check('同じ局面からは同じ燃え方（こおり・いわ とも）', J(a.evs) === J(b.evs) && J(c2.evs) === J(c3.evs), null);
      check('燃える数の上限 BURN.max・燃え終わると fireN は空', a.r.s.burns.length <= L.BURN.max && (() => { const z = run(L, a.r.s, 8).s; return z.burns.length === 0 && Object.keys(z.fireN || {}).length === 0; })(), [a.r.s.burns.length]);
    },
  },
];

// ほのおの燃え広がり（KL22）：rows の小惑星に ほのお Lv1 で 1 回だけ火をつけ（最初の burn のあと撃たない）、sec 秒ぶんの burn の出来事を集める
function fireOnce(L, rows, sec, seed = 7) {
  const s = setRock(L, mk(L, { seed, slots: [{ id: 'fire', lv: 1 }] }), rows, { hp: 1e9, ship: [-5, Math.floor(rows.length / 2)] });
  const u = until(L, s, (e) => e.kind === 'burn', 2);
  const first = ofKind(u.evs, 'burn')[0];
  const t0 = u.s.t;
  const q = { ...u.s, cd: [1e9], M: s.M };
  const r = run(L, q, sec);
  const evs = ofKind(r.evs, 'burn').concat(first ? [first] : []);
  const cells = new Set(evs.map((e) => e.i));
  return { s0: s, first, t0, r, evs, cells };
}
const manh = (R, a, b) => Math.abs((a % R.w) - (b % R.w)) + Math.abs(Math.floor(a / R.w) - Math.floor(b / R.w));

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
