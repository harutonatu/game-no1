// KL: ちきゅうを守れ！ほしくだき の計算ロジック（Node で games/asteroid/logic.js を直接読む。ブラウザ不要）
//   契約は docs/asteroid-contract.md（§3 数値、§4 API、§8 保存、§11.2 KL の項目）。
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

// 保存の形から局面を作る（loadSave を通す）
function mk(L, o = {}) {
  const raw = { v: 1, star: 1, kakera: 0, slots: [{ id: 'shot', lv: 1 }], offer: null, cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0 }, seed: 7, rng: 12345, ...o };
  const s = L.loadSave(JSON.stringify(raw));
  if (!s) throw new Error('mk: loadSave が null');
  return s;
}
// 小惑星を絵で組む（rows の文字列。'.'＝空）。hp は opts.hp（数か関数）か、その星の体力。x は「左から何単位」、bottom は一番下の行の下端の y
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
  const rock = { ...s.rock, cols: C, rows: R, x, y: bottom - R * L.CELL, vy: opts.vy !== undefined ? opts.vy : 0, mats, hp, total: n, left: n, value, bottom0: bottom };
  return { ...s, rock, shots: [], burns: [], cd: s.slots.map((_, k) => (opts.only === undefined || opts.only === k ? 0 : 1e9)) };
}
function run(L, s, sec, dt) {
  dt = dt || L.STEP;
  const evs = [];
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) { const r = L.step(s, dt); if (!r) throw new Error('step が null'); s = r.state; for (const e of r.events) evs.push(e); }
  return { s, evs };
}
// 出来事が出るまで進める（最大 sec 秒）
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

export const tests = [
  {
    id: 'KL1', tier: 'smoke', node: true, title: 'ほしくだき：定数と表（§3・§4.2）、hpMul・valMul・dmg（しんかで2倍）・upCost・相性の倍率、STAR_CALC_MAX と LEVEL_MAX でも有限',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'ちきゅうを守れ！ほしくだき', FIELD_W: 360, FIELD_H: 560, BARRIER_Y: 470, FIGHTER_Y: 500, CELL: 14, GRID_MAX: 24, LEVEL_MAX: 99, SLOTS_MAX: 4,
        CLEAR_BONUS: 0.2, ENDING_STAR: 30, STAR_MAX: 9999, STAR_CALC_MAX: 400, KAKERA_MAX: 9e15, SHOTS_MAX: 120, STEP: 1 / 30,
        SAVE_VERSION: 1, SAVE_KEY: 'asteroid.save', SAVE_KEY_BAK: 'asteroid.save.bak', SAVE_KEY_BEST: 'asteroid.best', SAVE_KEY_HELP: 'asteroid.help' };
      const bad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §4.2 のとおり（NAME はユーザーの書いたとおり）', bad.length === 0, bad);
      // §17（1つの星を長くする）で直した数値（§3.10 の「直した数値」の表）
      check('増え方の定数が §3.10 で直した値（HP_BASE 570・HP_GROWTH 1.252・VALUE_GROWTH 2.35・UP_GROWTH 1.35、星 30 より先は 1.0・1.03）', L.HP_BASE === 570 && L.HP_GROWTH === 1.252 && L.VALUE_GROWTH === 2.35 && L.UP_GROWTH === 1.35 && L.HP_GROWTH2 === 1.0 && L.VALUE_GROWTH2 === 1.03, [L.HP_BASE, L.HP_GROWTH, L.VALUE_GROWTH, L.UP_GROWTH, L.HP_GROWTH2, L.VALUE_GROWTH2]);
      check('UP_COST・SLOT_COST が §3.10 で直した値（たま 5・ちらし 5・どかん 34・いなずま 5・ビーム 8・ほのお 4、枠 40・300・2000）', J(L.UP_COST) === J({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 }) && J(L.SLOT_COST) === J([null, 40, 300, 2000]), [L.UP_COST, L.SLOT_COST]);
      check('最初の星のやさしさ EARLY_HP（星 1〜9）・大きな星（+2 マス・重さ 1.3 倍）・近づく速さの目安（135・240・300 秒、残り 0.33）・混ざり方（てつ 25%→35%、こおり 15%、傾き 8 ポイント）', J(L.EARLY_HP) === J([0.022, 0.056, 0.063, 0.27, 0.35, 0.39, 0.58, 0.82, 0.9]) && L.BOSS_GROW === 2 && L.BOSS_HARD === 1.3 && L.SIZE_STEP === 0.48 &&
        L.APPROACH.first === 135 && L.APPROACH.normal === 240 && L.APPROACH.boss === 300 && L.APPROACH.keep === 0.33 && J(L.MIX) === J({ iron: [0.25, 0.35], ice: 0.15, tilt: 0.08 }) && L.BEAM_DEPTH === 10, [L.EARLY_HP, L.APPROACH, L.MIX]);
      check('マスは いわ・てつ・こおり・きん（コード 1〜4）、硬さ 1・4・2・2、かけら 1・4・2・10（てつ は硬さと同じ 4）', J(L.MATS.map((m) => [m.id, m.code, m.name])) === J([['rock', 1, 'いわ'], ['iron', 2, 'てつ'], ['ice', 3, 'こおり'], ['gold', 4, 'きん']]) && J(L.MAT_HP) === J({ rock: 1, iron: 4, ice: 2, gold: 2 }) && J(L.MAT_VALUE) === J({ rock: 1, iron: 4, ice: 2, gold: 10 }), [L.MATS, L.MAT_HP, L.MAT_VALUE]);
      check('武器は たま・ちらし・どかん・いなずま・ビーム・ほのお（強さと間隔は §3.10 で直した値：ちらし 1・いなずま 3・ほのお 3）', J(L.WEAPONS.map((w) => [w.id, w.name, w.dmg, w.rate])) === J([['shot', 'たま', 1, 0.2], ['spread', 'ちらし', 1, 0.6], ['bomb', 'どかん', 3, 1.6], ['bolt', 'いなずま', 3, 1.2], ['beam', 'ビーム', 1.5, 2], ['fire', 'ほのお', 3, 1]]), L.WEAPONS);
      const aff = { spread: { rock: 2, iron: 0.9, ice: 1, gold: 1 }, bomb: { rock: 1, iron: 1, ice: 2, gold: 1 }, bolt: { rock: 1, iron: 2.2, ice: 0.5, gold: 1 }, beam: { rock: 1, iron: 1.8, ice: 1, gold: 1 }, fire: { rock: 1, iron: 0.75, ice: 3, gold: 1 }, shot: { rock: 1, iron: 1, ice: 1, gold: 1 } };
      const affBad = [];
      for (const w in aff) for (const m in aff[w]) if (L.affOf(w, m) !== aff[w][m]) affBad.push([w, m, L.affOf(w, m)]);
      check('相性の倍率が §3.3 の表どおり（ない所は 1）', affBad.length === 0, affBad);
      const all = []; for (const w of L.WEAPONS) for (const m of L.MATS) all.push(L.affOf(w.id, m.id));
      check('相性はどれも 0.5〜3 倍（まったく効かない、は無い）', all.every((a) => a >= 0.5 && a <= 3), all);
      check('得意なマス：ちらし＝いわ、どかん・ほのお＝こおり、いなずま・ビーム＝てつ、たま＝なし', J(L.WEAPONS.map((w) => w.good)) === J([null, 'rock', 'ice', 'iron', 'iron', 'ice']), null);
      // 式
      // 式（§3.10）：hpMul(n) = 増え方 × EARLY_HP × adj、valMul(n) = 増え方 × adj。
      //   増え方は星 30 まで GROWTH^(n−1)、その先は GROWTH2^(n−30) を掛ける。
      //   adj = (なめらかな直径² × 0.86) ÷ (列 × 行) × (大きな星なら BOSS_HARD) × (傾ける前の重み ÷ 傾けたあとの重み)。重みは いわ 1・てつ 4・こおり 2
      const adjOf = (n) => {
        const info = L.starInfo(n), k = Math.min(n, 40), sm = Math.min(24, 10 + (k - 1) * L.SIZE_STEP);
        const iron0 = n < 3 ? 0 : n < 10 ? L.MIX.iron[0] : L.MIX.iron[1], ice0 = n < 6 ? 0 : L.MIX.ice;
        const w = (a, b) => (1 - a - b) + 4 * a + 2 * b;
        return (sm * sm * 0.86) / (info.cols * info.rows) * (info.boss ? L.BOSS_HARD : 1) * w(iron0, ice0) / w(info.mix.iron, info.mix.ice);
      };
      const grow = (n, g1, g2) => (n <= 30 ? g1 ** (n - 1) : g1 ** 29 * g2 ** (n - 30));
      const hpW = (n) => grow(Math.min(n, 400), L.HP_GROWTH, L.HP_GROWTH2) * (n <= L.EARLY_HP.length ? L.EARLY_HP[n - 1] : 1) * adjOf(n);
      const valW = (n) => grow(Math.min(n, 400), L.VALUE_GROWTH, L.VALUE_GROWTH2) * adjOf(n);
      const fb = [1, 2, 3, 4, 5, 9, 10, 12, 17, 25, 30, 31, 35, 77, 400].filter((n) => !near(L.hpMul(n) / hpW(n), 1, 1e-9) || !near(L.valMul(n) / valW(n), 1, 1e-9));
      check('hpMul・valMul が式どおり（星 1〜9 は EARLY_HP、星 30 より先は増え方 1.0・1.03、大きな星・大きさのならし・傾きのならし）', fb.length === 0, fb.map((n) => [n, L.hpMul(n), hpW(n)]));
      check('星 30 より先は体力が増えない（エンディングのあと詰まらない）', near(L.hpMul(36) / L.hpMul(31), adjOf(36) / adjOf(31), 1e-9) && near(L.hpMul(97) / L.hpMul(32), adjOf(97) / adjOf(32), 1e-9), [L.hpMul(31), L.hpMul(36), L.hpMul(97)]);
      check('マスの体力 = HP_BASE × hpMul × MAT_HP、かけら = floor(MAT_VALUE × valMul)（最低 1）', near(L.cellHp(3, 'iron'), L.HP_BASE * L.hpMul(3) * 4, 1e-9) && L.cellValue(1, 'rock') === 1 && L.cellValue(9, 'gold') === Math.floor(10 * L.valMul(9)), [L.cellHp(3, 'iron'), L.cellValue(9, 'gold')]);
      // 傾き（てつ多め・こおり多め）でも星の重さは変わらない：1 マスあたりの平均の体力 × 重みが、傾けない星と同じ
      const wt = (n) => { const i = L.starInfo(n); return L.hpMul(n) * ((1 - i.mix.iron - i.mix.ice) + 4 * i.mix.iron + 2 * i.mix.ice) * i.cols * i.rows / (i.boss ? L.BOSS_HARD : 1); };
      const tiltBad = [12, 13, 14, 16, 17, 18].filter((n) => !near(wt(n) / (L.HP_GROWTH ** (n - 1) * (Math.min(24, 10 + (n - 1) * 0.48) ** 2) * 0.86 * ((1 - 0.35 - 0.15) + 4 * 0.35 + 2 * 0.15)), 1, 1e-9));
      check('傾いた星でも、重さ（体力の合計の目安）は傾けない星と同じ（得意な武器で速くなるだけ）', tiltBad.length === 0, tiltBad);
      const dw = (w, Lv, base) => base * (1 + 0.25 * (Lv - 1)) * 2 ** Math.floor(Lv / 10);
      check('dmg(w, L) = DMG × (1 + 0.25(L−1)) × 2^floor(L/10)', [[1], [5], [9], [10], [11], [20], [30], [99]].every(([Lv]) => L.WEAPONS.every((w) => near(L.dmg(w.id, Lv), dw(w.id, Lv, w.dmg), 1e-9 * dw(w.id, Lv, w.dmg)))), [L.dmg('shot', 9), L.dmg('shot', 10)]);
      check('しんか（Lv10）で強さがちょうど 2 倍に跳ねる（Lv9→10 は 2×(1+2.25)/(1+2) 倍）', near(L.dmg('bolt', 10) / L.dmg('bolt', 9), 2 * 3.25 / 3, 1e-9), L.dmg('bolt', 10) / L.dmg('bolt', 9));
      check('upCost(w, L) = round(UP_COST × 1.35^(L−1))、Lv 上限で null', L.WEAPONS.every((w) => L.upCost(w.id, 1) === L.UP_COST[w.id] && L.upCost(w.id, 7) === Math.round(L.UP_COST[w.id] * 1.35 ** 6)) && L.upCost('shot', 20) === Math.round(5 * 1.35 ** 19) && L.upCost('shot', 99) === null, [L.upCost('shot', 7), L.upCost('shot', 20)]);
      check('Lv 98 の値段でも かけらの上限（KAKERA_MAX）より小さい（どの武器も Lv 99 まで買える）', L.WEAPONS.every((w) => L.upCost(w.id, 98) < L.KAKERA_MAX), L.WEAPONS.map((w) => L.upCost(w.id, 98)));
      check('upCost はレベルとともに増え続ける（減らない）', Array.from({ length: 97 }, (_, k) => k + 1).every((Lv) => L.upCost('beam', Lv + 1) >= L.upCost('beam', Lv)), null);
      check('しんかの形（§3.3）：たま 1→2→3 連、ちらし 5→7 発、どかん 1.5→2 マス、いなずま 4→6、ビーム 1→2、ほのお 3→4 秒、Lv30 で打ち止め',
        L.shapeOf('shot', 9) === 1 && L.shapeOf('shot', 10) === 2 && L.shapeOf('shot', 20) === 3 && L.shapeOf('spread', 10) === 7 && L.shapeOf('bomb', 10) === 2 && L.shapeOf('bolt', 10) === 6 && L.shapeOf('beam', 10) === 2 && L.shapeOf('fire', 10) === 4 &&
        L.shapeOf('spread', 30) === L.shapeOf('spread', 99) && L.shapeOf('spread', 30) === 11, [L.shapeOf('spread', 30), L.shapeOf('spread', 99)]);
      check('SLOT_COST は [null, 2つめ, 3つめ, 4つめ] で増えていく', L.SLOT_COST.length === 4 && L.SLOT_COST[0] === null && L.SLOT_COST[1] > 0 && L.SLOT_COST[2] > L.SLOT_COST[1] && L.SLOT_COST[3] > L.SLOT_COST[2], L.SLOT_COST);
      // 桁あふれ
      const fin = [L.hpMul(1e9), L.valMul(1e9), L.cellHp(9999, 'iron'), L.cellValue(9999, 'gold'), L.dmg('shot', 99), L.dmg('beam', 1e9), L.upCost('beam', 98)];
      check('STAR_CALC_MAX を超える星・LEVEL_MAX でも有限の数（Infinity・NaN にならない）', fin.every(Number.isFinite) && L.hpMul(1e9) === L.hpMul(9999) && L.valMul(1e9) === L.valMul(9999) && Number.isFinite(L.valMul(9999)) && L.cellValue(9999, 'gold') <= 1e18, fin);
      check('表・API が凍結されている', Object.isFrozen(L) && Object.isFrozen(L.WEAPONS) && Object.isFrozen(L.MATS) && Object.isFrozen(L.UP_COST) && Object.isFrozen(L.SLOT_COST) && Object.isFrozen(L.EVOLVE), null);
      // 画面用の値
      const s = mk(L, { slots: [{ id: 'shot', lv: 12 }, { id: 'bolt', lv: 3 }] });
      check('upCostOf は upCost と同じ、Lv99 で null、slotCostOf は枠の数で決まり 4 枠で null', L.upCostOf(s, 0) === L.upCost('shot', 12) && L.upCostOf(s, 1) === L.upCost('bolt', 3) && L.upCostOf(mk(L, { slots: [{ id: 'shot', lv: 99 }] }), 0) === null && L.slotCostOf(s) === L.SLOT_COST[2] &&
        L.slotCostOf(mk(L, { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })) })) === null, null);
      const d0 = L.dpsOf(s, 0), d1 = L.dpsOf(mk(L, { slots: [{ id: 'shot', lv: 13 }] }), 0);
      check('dpsOf は 1 以上の整数で、Lv が上がると増える', Number.isInteger(d0) && d0 >= 1 && d1 > d0 && Number.isInteger(L.dpsOf(mk(L, { slots: [{ id: 'shot', lv: 99 }] }), 0)), [d0, d1]);
    },
  },
  {
    id: 'KL2', tier: 'smoke', node: true, title: 'ほしくだき：星の形（同じ星と種で同じ形・やり直しで同じ）、マスの数が GRID_MAX² 以下、混ざり方が §3.2 の範囲、approachSec・大きな星、formatKakera',
    run({ check, root }) {
      const L = load(root);
      const a = mk(L, { star: 12, seed: 99 }), b = mk(L, { star: 12, seed: 99, kakera: 500, tries: 2 }), c = mk(L, { star: 12, seed: 100 });
      check('同じ星の番号と種なら同じ形・同じ混ざり方（かけら・挑戦回数によらない）', J(a.rock.mats) === J(b.rock.mats) && a.rock.cols === b.rock.cols, null);
      check('種が違えば形が変わる（毎回少し違う）', J(a.rock.mats) !== J(c.rock.mats), null);
      const bad = [];
      let gotIron = 0, gotIce = 0, tags = new Set();
      for (let n = 1; n <= 60; n++) {
        const info = L.starInfo(n);
        const s = mk(L, { star: n, seed: 3 });
        const cells = cellsOf(s);
        const cnt = (code) => s.rock.mats.filter((m) => m === code).length;
        const ironR = cnt(2) / cells.length, iceR = cnt(3) / cells.length;
        if (info.mix.iron > 0) gotIron++;
        if (info.mix.ice > 0) gotIce++;
        tags.add(info.tag);
        const why = [];
        if (!(info.cols <= L.GRID_MAX && info.rows <= L.GRID_MAX && s.rock.cols === info.cols && s.rock.rows === info.rows)) why.push('格子の大きさ');
        if (!(cells.length >= 20 && cells.length <= L.GRID_MAX * L.GRID_MAX && s.rock.total === cells.length && s.rock.left === cells.length)) why.push('マスの数');
        if (n < 3 && (cnt(2) || cnt(3) || cnt(4))) why.push('星1〜2 は いわ だけ');
        if (n < 6 && cnt(3)) why.push('こおりは 6〜');
        if (n < 8 && cnt(4)) why.push('きんは 8〜');
        if (n >= 8 && !(cnt(4) >= 2 && cnt(4) <= 6)) why.push('きんは 2〜6 マス');
        if (n >= 3 && !(ironR >= 0.1 && ironR <= 0.5)) why.push('てつの割合 ' + ironR.toFixed(2));
        if (n >= 6 && !(iceR >= 0.03 && iceR <= 0.3)) why.push('こおりの割合 ' + iceR.toFixed(2));
        if (Math.abs(ironR - info.mix.iron) > 0.06 || Math.abs(iceR - info.mix.ice) > 0.06) why.push('starInfo の mix と実際が違う');
        // approachSec（§3.10）＝ 目安の秒（大きな星 300・星1〜3 は 135・ふつう 240）÷（0.33 + 行×14 ÷ 350）を 10 秒に丸める
        const want = Math.round((n % 5 === 0 ? 300 : n <= 3 ? 135 : 240) / (0.33 + info.rows * 14 / 350) / 10) * 10;
        if (info.approachSec !== want || info.boss !== (n % 5 === 0)) why.push('approachSec/boss');
        const big = info.mix.iron === 0 && info.mix.ice === 0 ? '' : info.mix.iron >= info.mix.ice ? 'てつが おおい' : 'こおりが おおい';
        if (info.tag !== big) why.push('tag');
        // 1つのかたまり（はじめから はなれたマスが無い）
        const seen = new Set([cells[0]]), st = [cells[0]];
        while (st.length) { const j = st.pop(); const C = s.rock.cols; for (const q of [j - 1, j + 1, j - C, j + C]) { if (q < 0 || q >= s.rock.mats.length || seen.has(q) || !s.rock.mats[q]) continue; if ((q === j - 1 && j % C === 0) || (q === j + 1 && q % C === 0)) continue; seen.add(q); st.push(q); } }
        if (seen.size !== cells.length) why.push('はじめから はなれている');
        if (why.length) bad.push({ n, why, cells: cells.length, ironR, iceR, info });
      }
      check('星 1〜60：格子 24×24 以内、マスの数・混ざり方（てつ 10〜50%・こおり 3〜30%）・きんの数・approachSec（星の高さからの式）・札が §3.2 の範囲、はじめは1つのかたまり', bad.length === 0, bad.slice(0, 4));
      check('てつ・こおりのある星があり、札は「てつが おおい」「こおりが おおい」の両方が出る（空振りでない）', gotIron > 40 && gotIce > 40 && tags.has('てつが おおい') && tags.has('こおりが おおい') && tags.has(''), [gotIron, gotIce, [...tags]]);
      const sizes = [1, 10, 29, 30, 9999].map((n) => L.starInfo(n).cols);
      check('星が進むと大きくなり、星 9999 でも 24 列まで', sizes[0] < sizes[2] && sizes.every((x) => x <= 24) && L.starInfo(9999).cols === 24, sizes);
      check('starInfo のおかしな引数は null（0・負・NaN・文字）、STAR_MAX を超える番号は 9999 として扱う', [0, -1, NaN, 'x', null, undefined, Infinity].every((x) => L.starInfo(x) === null) && J(L.starInfo(1e9)) === J(L.starInfo(9999)), null);
      // 体力とかけらが星の式どおり
      const s7 = mk(L, { star: 7 });
      const i7 = cellsOf(s7).find((i) => s7.rock.mats[i] === 2);
      check('マスの体力が星の式どおり（星7 の てつ）・rock.value が全部のマスのかけらの合計', i7 !== undefined && near(s7.rock.hp[i7], L.cellHp(7, 'iron'), 1e-9) && s7.rock.value === cellsOf(s7).reduce((v, i) => v + L.cellValue(7, MATN[s7.rock.mats[i]]), 0), null);
      // formatKakera
      const F = [[0, '0'], [7, '7'], [1234, '1,234'], [9999, '9,999'], [12345, '1.2まん'], [10000, '1まん'], [99999, '9.9まん'], [1234567, '123まん'], [99999999, '9999まん'], [123456789, '1.2おく'], [5.6e12, '5.6ちょう'], [9e15, '9000ちょう'], [-5, '0'], [NaN, '0'], [Infinity, '9000ちょう'], ['x', '0']];
      const fb = F.filter(([n, w]) => L.formatKakera(n) !== w).map(([n, w]) => ({ n, want: w, got: L.formatKakera(n) }));
      check('formatKakera：1,234 → 1.2まん → 1.2おく → 5.6ちょう（切り捨て）、おかしな値は 0', fb.length === 0, fb);
      let longest = 0; for (let e = 0; e <= 16; e++) for (const m of [1, 9.99, 5.55]) longest = Math.max(longest, L.formatKakera(m * 10 ** e).length);
      check('formatKakera は最大でも 10 文字以内', longest <= 10 && L.formatKakera(L.KAKERA_MAX).length <= 10, longest);
    },
  },
  {
    id: 'KL3', tier: 'smoke', node: true, title: 'ほしくだき：当たり（たまは一番近いマス、ちらしは扇、どかんの円、いなずまは同じ種類のつながったマスだけ、ビームは列を貫く、ほのおは こおり へ広がる）',
    run({ check, root }) {
      const L = load(root);
      const BIG = 1e9;
      // たま：一番近いマス（戦闘機は x=180。右下に1つだけ近いマス）
      let s = mk(L);
      s = setRock(L, s, ['rrrrrrr', 'rrrrrrr', '.....r.'], { hp: BIG, x: 180 - 3.5 * 14, bottom: 300 });
      s = { ...s, fighter: { x: 180, y: L.FIGHTER_Y } };
      let r = until(L, s, (e) => e.kind === 'hit', 2);
      const fire0 = ofKind(r.evs, 'fire')[0], hit0 = ofKind(r.evs, 'hit')[0];
      const want = 2 * 7 + 5;   // 一番下の行の右の1マスがいちばん近い
      check('たま：一番近いマス（一番下の右のマス）をねらって当たる', r.hit && fire0 && fire0.w === 'shot' && hit0.i === want && near(fire0.tx, s.rock.x + 5.5 * 14) && hit0.w === 'shot' && hit0.mat === 'rock', [fire0, hit0]);
      check('戦闘機はねらうマスの真下へ動く（速さ 160/秒をこえない）', r.s.fighter.x > 180 && r.s.fighter.x - 180 <= 160 * r.s.t + 1e-6, [r.s.fighter.x, r.s.t]);
      // ちらし：扇に 5 発（Lv10 で 7 発）
      for (const [lv, n] of [[1, 5], [10, 7]]) {
        let t = mk(L, { slots: [{ id: 'shot', lv: 1 }, { id: 'spread', lv }] });
        t = setRock(L, t, ['rrrrrrrrrr', 'rrrrrrrrrr'], { hp: BIG, only: 1, bottom: 200 });
        const st = L.step(t, L.STEP).state;
        const sp = st.shots.filter((b) => b.w === 'spread');
        const ang = sp.map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
        const gaps = ang.slice(1).map((a, k) => a - ang[k]);
        check(`ちらし Lv${lv}：扇に ${n} 発（向きが全部違い、間かくがそろう）`, sp.length === n && gaps.every((g) => g > 0.05 && near(g, gaps[0], 1e-9)), sp.length);
      }
      // どかん：円（半径 1.5 マス）の中だけ
      let bm = mk(L, { slots: [{ id: 'shot', lv: 1 }, { id: 'bomb', lv: 1 }] });
      bm = setRock(L, bm, Array(7).fill('rrrrrrr'), { hp: BIG, only: 1, bottom: 300 });
      r = until(L, bm, (e) => e.kind === 'boom', 2);
      const boom = ofKind(r.evs, 'boom')[0];
      const hitsB = ofKind(r.evs, 'hit').filter((e) => e.w === 'bomb').map((e) => e.i).sort((a, b) => a - b);
      let inC = [];
      if (boom) { const R = r.s.rock; for (let i = 0; i < 49; i++) { const cx = R.x + (i % 7 + 0.5) * 14, cy = R.y + (Math.floor(i / 7) + 0.5) * 14; if ((cx - boom.x) ** 2 + (cy - boom.y) ** 2 <= (boom.r + 1e-6) ** 2) inC.push(i); } }
      check('どかん：落ちた所の円（半径 1.5 マス＝21 単位）の中のマスだけに当たる（9 マス）', !!boom && near(boom.r, 21) && hitsB.length === 9 && J(hitsB) === J(inC), [boom, hitsB, inC]);
      const fireB = ofKind(r.evs, 'fire').find((e) => e.w === 'bomb');
      check('どかん：山なりで 0.6 秒後に落ちる', !!fireB && r.s.t >= 0.6 - 1e-6 && r.s.t <= 0.6 + L.STEP + 1e-6, r.s.t);
      // いなずま：同じ種類のつながったマスだけ
      let bl = mk(L, { star: 3, slots: [{ id: 'shot', lv: 1 }, { id: 'bolt', lv: 1 }] });
      bl = setRock(L, bl, [
        'iiirii',
        'rrrrri',
        'rrirrr',
        'riiirr'], { hp: BIG, only: 1, bottom: 300 });
      r = until(L, bl, (e) => e.kind === 'bolt', 1);
      const bolt = ofKind(r.evs, 'bolt')[0];
      const C = 6;
      const conn = bolt && bolt.path.every((i, k) => k === 0 || bolt.path.slice(0, k).some((j) => Math.abs(j - i) === C || (Math.abs(j - i) === 1 && Math.floor(j / C) === Math.floor(i / C))));
      check('いなずま：一番近い てつ をねらい、つながっている てつ（4 マス）だけへ伝わる（いわ・はなれた てつ には行かない）', !!bolt && bolt.path[0] === 20 && bolt.path.every((i) => r.s.rock.mats[i] === 2) && conn && J([...bolt.path].sort((a, b) => a - b)) === J([14, 19, 20, 21]), bolt);
      const hitsL = ofKind(r.evs, 'hit').filter((e) => e.w === 'bolt').map((e) => e.i);
      check('いなずま：連鎖したマス全部に当たる', J([...hitsL].sort()) === J([...bolt.path].sort()), hitsL);
      let bl1 = mk(L, { slots: [{ id: 'shot', lv: 1 }, { id: 'bolt', lv: 1 }] });
      bl1 = setRock(L, bl1, ['rrrrrrrrrr', 'rrrrrrrrrr'], { hp: BIG, only: 1 });
      const b1 = ofKind(until(L, bl1, (e) => e.kind === 'bolt', 1).evs, 'bolt')[0];
      check('いなずま Lv1：つながりが大きければ 4 回まで連鎖（5 マス）', b1 && b1.path.length === 5, b1);
      let bl2 = mk(L, { slots: [{ id: 'shot', lv: 1 }, { id: 'bolt', lv: 10 }] });
      bl2 = setRock(L, bl2, ['rrrrrrrrrr', 'rrrrrrrrrr'], { hp: BIG, only: 1 });
      const b2 = ofKind(until(L, bl2, (e) => e.kind === 'bolt', 1).evs, 'bolt')[0];
      check('いなずま Lv10（しんか）：連鎖 +2（7 マス）', b2 && b2.path.length === 7, b2);
      // ビーム：マスが一番多い列を貫く
      let be = mk(L, { star: 3, slots: [{ id: 'shot', lv: 1 }, { id: 'beam', lv: 1 }] });
      be = setRock(L, be, ['.r.r.', 'rrrr.', 'rrirr', 'rrirr'], { hp: BIG, only: 1 });
      r = until(L, be, (e) => e.kind === 'beam', 1);
      const hitsBe = ofKind(r.evs, 'hit').filter((e) => e.w === 'beam').map((e) => e.i).sort((a, b) => a - b);
      check('ビーム：マスが一番多い列（同じなら戦闘機に近い列）を下から上まで全部（4 マス）', J(hitsBe) === J([1, 6, 11, 16]) || J(hitsBe) === J([3, 8, 13, 18]), hitsBe);
      check('ビーム：てつ には 1.5 倍（相性）', (() => { const R0 = be.rock, R1 = r.s.rock; const iron = hitsBe.find((i) => R0.mats[i] === 2); const rock = hitsBe.find((i) => R0.mats[i] === 1); return iron === undefined || near((R0.hp[iron] - R1.hp[iron]) / (R0.hp[rock] - R1.hp[rock]), 1.5, 1e-6); })(), null);
      // ビーム：1 列で貫くのは下から BEAM_DEPTH（10）マスまで
      let bd = mk(L, { star: 3, slots: [{ id: 'shot', lv: 1 }, { id: 'beam', lv: 1 }] });
      bd = setRock(L, bd, Array.from({ length: 14 }, () => 'r'), { hp: BIG, only: 1, bottom: 300 });
      const rbd = until(L, bd, (e) => e.kind === 'beam', 1);
      const hitBd = ofKind(rbd.evs, 'hit').filter((e) => e.w === 'beam').map((e) => e.i).sort((a, b) => a - b);
      check('ビーム：1 列 14 マスのうち、下から 10 マス（BEAM_DEPTH）だけを貫く', L.BEAM_DEPTH === 10 && J(hitBd) === J([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), hitBd);
      // ほのお：当たったマスが燃え、となりの こおり へ広がる（いわ には広がらない）
      let fi = mk(L, { star: 6, slots: [{ id: 'shot', lv: 1 }, { id: 'fire', lv: 1 }] });
      fi = setRock(L, fi, ['rrrrr', 'rcccr', 'rrcrr'], { hp: BIG, only: 1, x: 180 - 2.5 * 14, bottom: 300 });
      fi = { ...fi, fighter: { x: 180, y: L.FIGHTER_Y } };
      r = run(L, fi, 2.5);
      const burned = [...new Set(ofKind(r.evs, 'burn').map((e) => e.i))].sort((a, b) => a - b);
      const lit = until(L, fi, (e) => e.kind === 'burn' && e.i === 12, 2);
      const lit2 = run(L, lit.s, 1);
      // 1 発目は一番近い 12（こおり）→ 0.5 秒で上の 7（こおり）へ。2・3 発目は「まだ燃えていない一番近いマス」11・13（いわ）→ 11 から上の 6（こおり）へ。
      // 燃えうつった 7 からは、さらには広がらない（8 は 13 から 0.5 秒後で、2.5 秒の中には入らない）
      const firstBurn = ofKind(r.evs, 'burn')[0];
      check('ほのお：一番近いマス（こおり 12）に火がつき、0.5 秒で となりの こおり（7）へ。次の弾は まだ燃えていないマス（11・13）をねらう', firstBurn && firstBurn.i === 12 && J(burned) === J([6, 7, 11, 12, 13]), burned);
      check('ほのお：燃えている こおり は毎秒 DMG×3（相性）で減る', lit.hit && near(lit.s.rock.hp[12] - lit2.s.rock.hp[12], L.dmg('fire', 1) * L.affOf('fire', 'ice'), 0.11 * L.dmg('fire', 1)), lit.hit && lit.s.rock.hp[12] - lit2.s.rock.hp[12]);
      // 燃えうつりは 1 だんだけ：こおりの 1 列に 1 発だけ撃つと、当たったマスと両どなりだけが燃える
      let f1 = mk(L, { star: 6, slots: [{ id: 'shot', lv: 1 }, { id: 'fire', lv: 1 }] });
      f1 = setRock(L, f1, ['ccccccc'], { hp: BIG, only: 1, x: 180 - 3.5 * 14, bottom: 300 });
      f1 = { ...f1, fighter: { x: 180, y: L.FIGHTER_Y } };
      const f1a = run(L, f1, 0.1);
      const f1b = run(L, { ...f1a.s, cd: f1a.s.cd.map(() => 1e9) }, 3);
      const burnedLine = [...new Set(ofKind([...f1a.evs, ...f1b.evs], 'burn').map((e) => e.i))].sort((a, b) => a - b);
      check('ほのお：燃えうつったマスからは、さらに広がらない（1 発で 3 マスだけ。こおりのかたまり全部は燃えない）', J(burnedLine) === J([2, 3, 4]), burnedLine);
      // ひび：かたいマスは crack が 1→3 と増える
      let cr = mk(L, { star: 3, slots: [{ id: 'shot', lv: 9 }] });
      cr = setRock(L, cr, ['i'], { x: 180 - 7, bottom: 300 });
      cr = { ...cr, fighter: { x: 180, y: L.FIGHTER_Y } };
      const rr = until(L, cr, (e) => e.kind === 'break', 120);
      const cracks = ofKind(rr.evs, 'hit').map((e) => e.crack);
      check('ひび：てつ に当たるたび crack が 0〜3 で増えていき、最後に欠ける（break）', cracks.length >= 3 && cracks.every((c, k) => c >= 0 && c <= 3 && (k === 0 || c >= cracks[k - 1])) && cracks[cracks.length - 1] === 3 && ofKind(rr.evs, 'break').length === 1, cracks);
      // 弾の上限
      let many = mk(L, { slots: [{ id: 'shot', lv: 30 }, { id: 'spread', lv: 30 }, { id: 'fire', lv: 30 }, { id: 'bomb', lv: 30 }] });
      many = setRock(L, many, ['rrrrrrrrrrrrrrrrrrrrrrrr'], { hp: BIG, bottom: 60 });
      let maxShots = 0, cur = many;
      for (let i = 0; i < 300; i++) { cur = L.step(cur, 0.1).state; cur = { ...cur, cd: cur.cd.map(() => 0) }; maxShots = Math.max(maxShots, cur.shots.length); }
      check('弾は SHOTS_MAX（120）を超えない（毎回すぐ撃てるようにしても）', maxShots <= L.SHOTS_MAX && maxShots >= 100, maxShots);
    },
  },
  {
    id: 'KL4', tier: 'smoke', node: true, title: 'ほしくだき：はなれたかたまり（首を切ると小さいほうが全部くだける・かけらは合計どおり・同じ大きさは真ん中に近いほうが本体・本体はくだけない）',
    run({ check, root }) {
      const L = load(root);
      const BIG = 1e9;
      // 左 12 マスの本体と右 6 マスを、下の行の首（列4）だけでつなぐ。首だけ体力が少ない
      const pic = ['rrrr.rr', 'rrrr.rr', 'rrrrrrr'];
      let s = mk(L, { kakera: 100 });
      const neck = 2 * 7 + 4;
      s = setRock(L, s, pic, { hp: (i) => (i === neck ? 0.5 : BIG), x: 180 - 4.5 * 14, bottom: 300 });
      s = { ...s, fighter: { x: 180, y: L.FIGHTER_Y } };
      const r = until(L, s, (e) => e.kind === 'break', 2);
      const brk = ofKind(r.evs, 'break'), ch = ofKind(r.evs, 'chunk');
      const right = [5, 6, 12, 13, 19, 20];
      const v1 = L.cellValue(1, 'rock');
      check('首（1 マス）が欠けると、右の小さいかたまり（6 マス）が同じ step で全部くだける', brk.length === 1 && brk[0].i === neck && ch.length === 1 && J([...ch[0].cells].sort((a, b) => a - b)) === J(right) && right.every((i) => r.s.rock.mats[i] === 0), [brk, ch]);
      check('くだけたかたまりのかけら＝各マスの value の合計、かけらは首＋かたまりの分だけ増える', ch[0] && ch[0].value === 6 * v1 && r.s.kakera === 100 + 7 * v1 && r.s.totals.chunks === 1 && r.s.totals.cells === 7, [ch[0], r.s.kakera]);
      const left = [0, 1, 2, 3, 7, 8, 9, 10, 14, 15, 16, 17];
      check('本体（大きいほう 12 マス）はくだけない・体力もそのまま', left.every((i) => r.s.rock.mats[i] === 1 && r.s.rock.hp[i] === BIG) && r.s.rock.left === 12 && r.s.phase === 'fly', r.s.rock.left);
      // 同じ大きさ（9 と 9）：格子の真ん中（列 3.5・行 1）に近いマスを含むほう（右）が本体
      const pic2 = ['rrr.rrr.', 'rrr.rrr.', 'rrrrrrr.'];
      const neck2 = 2 * 8 + 3;
      let t = mk(L);
      t = setRock(L, t, pic2, { hp: (i) => (i === neck2 ? 0.5 : BIG), x: 180 - 3.5 * 14, bottom: 300 });
      t = { ...t, fighter: { x: 180, y: L.FIGHTER_Y } };
      const r2 = until(L, t, (e) => e.kind === 'break', 2);
      const ch2 = ofKind(r2.evs, 'chunk')[0];
      check('同じ大きさのときは、格子の真ん中に近いマスを含むほう（右）が本体で、左がくだける', ch2 && J([...ch2.cells].sort((a, b) => a - b)) === J([0, 1, 2, 8, 9, 10, 16, 17, 18]) && r2.s.rock.left === 9, ch2);
      // つながったままなら何もくだけない（空振りでない：欠けたマスはある）
      let u = mk(L);
      u = setRock(L, u, ['rrrrr', 'rrrrr'], { hp: (i) => (i === 7 ? 0.5 : BIG), x: 180 - 2.5 * 14, bottom: 300 });
      u = { ...u, fighter: { x: 180, y: L.FIGHTER_Y } };
      const r3 = until(L, u, (e) => e.kind === 'break', 2);
      check('切れていなければ chunk は出ない（break は出ている）', ofKind(r3.evs, 'break').length === 1 && ofKind(r3.evs, 'chunk').length === 0 && r3.s.rock.left === 9, null);
    },
  },
  {
    id: 'KL5', tier: 'smoke', node: true, title: 'ほしくだき：近づく・とどく（approachSec どおり・下を削ると延びる・届くと星が最初から・かけらと武器は残る・tries が増える・2 回目から 10% ずつ遅く最大 25%）',
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
      check('削らなければ、一番下のマスが approachSec（星の高さから決まる 150〜400 秒）でバリアに届く', bad.length === 0, bad);
      const a = reach({ star: 4 });
      const b = reach({ star: 4 }, (s) => {
        const R = s.rock, br = Math.max(...cellsOf(s).map((i) => Math.floor(i / R.cols)));
        const mats = R.mats.map((m, i) => (Math.floor(i / R.cols) === br ? 0 : m));
        return { ...s, rock: { ...R, mats, left: mats.filter((m) => m).length } };
      });
      check('一番下の行を削ると、届くまでの時間が 1 マスぶん（14/vy 秒）延びる', b.hit && near(b.t - a.t, 14 / a.s0.rock.vy, L.STEP * 1.5), [a.t, b.t]);
      // 届いたとき
      let s = mk(L, { star: 4, kakera: 777, slots: [{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 3 }], totals: { cells: 5, stars: 3, kakera: 900, chunks: 1 } });
      const shape0 = J(s.rock.mats);
      const brow = Math.max(...cellsOf(s).map((i) => Math.floor(i / s.rock.cols)));
      s = { ...s, rock: { ...s.rock, hp: s.rock.hp.map((h, i) => (h ? (Math.floor(i / s.rock.cols) === brow ? 0.01 : BIG) : 0)) } };   // 一番下の行だけ欠けるようにする
      const r = until(L, s, (e) => e.kind === 'bounce', 500);
      const bounce = ofKind(r.evs, 'bounce')[0];
      const k1 = r.s.kakera;
      check('届くと bounce（broken＝壊した割合）・phase は bounce、地球は壊れない（phase end にならない）', r.hit && r.s.phase === 'bounce' && bounce.broken > 0 && bounce.broken < 1 && near(bounce.broken, 1 - r.s.rock.left / r.s.rock.total), bounce);
      const r2 = run(L, r.s, 1.9);
      check('はね返しの 2 秒の間は止まって待つ（1.9 秒ではまだ bounce）', r2.s.phase === 'bounce', r2.s.phase);
      const r3 = run(L, r2.s, 0.2);
      check('2 秒たつと自動で次の挑戦（fly）、星は最初から（形が元どおり・残り＝全部）', r3.s.phase === 'fly' && J(r3.s.rock.mats) === shape0 && r3.s.rock.left === r3.s.rock.total && r3.s.star === 4, [r3.s.phase, r3.s.rock.left, r3.s.rock.total]);
      check('かけら・武器・累計は残る（減らない）、tries が 1→2', r3.s.kakera >= k1 && k1 > 777 && J(r3.s.slots) === J([{ id: 'shot', lv: 7 }, { id: 'bolt', lv: 3 }]) && r3.s.totals.stars === 3 && r3.s.totals.cells >= 5 && r3.s.tries === 2, [k1, r3.s.kakera, r3.s.tries]);
      // やさしくなる仕掛け
      const vy = (tries) => mk(L, { star: 4, tries }).rock.vy;
      const base = vy(1);
      const want = { 1: 1, 2: 0.9, 3: 0.8, 4: 0.75, 6: 0.75, 50: 0.75 };
      const vb = Object.entries(want).filter(([t, f]) => !near(vy(+t) / base, f, 1e-9)).map(([t, f]) => ({ tries: t, want: f, got: vy(+t) / base }));
      check('2 回目から降りる速さが 1 回ごとに 10% ずつ遅く、最大 25%（tries 4 以上は 0.75 倍）', vb.length === 0, vb);
      const t3 = reach({ star: 4, tries: 3 });
      check('tries 3 の星は届くまでの時間が 1/0.8 倍に延びる', near(t3.t, L.starInfo(4).approachSec / 0.8, L.STEP * 1.5), t3.t);
      // クリアしたら元に戻る
      let c = mk(L, { star: 4, tries: 6 });
      c = setRock(L, c, ['r'], { hp: 0.01, x: 180 - 7, bottom: 300 });
      c = { ...c, fighter: { x: 180, y: L.FIGHTER_Y } };
      const rc = run(L, c, 3);
      check('クリアすると tries は 1 にもどり、速さも元にもどる', rc.s.star === 5 && rc.s.tries === 1 && near(rc.s.rock.vy, (L.BARRIER_Y - L.START_BOTTOM) / L.starInfo(5).approachSec, 1e-9), [rc.s.star, rc.s.tries, rc.s.rock.vy]);
      // 地球までの近さ
      const p0 = L.progressOf(mk(L, { star: 4 }));
      check('progressOf：始めは broken 0・distance 1、届いたときは distance 0', p0.broken === 0 && p0.distance === 1 && p0.left === p0.total && L.progressOf(r.s).distance === 0, [p0, L.progressOf(r.s)]);
    },
  },
  {
    id: 'KL6', tier: 'smoke', node: true, title: 'ほしくだき：クリア（残り 0 で clear・おまけ＝全部のマスの value×0.2・1.5 秒で次の星・大きな星の予告）、ENDING_STAR でエンディング（1回だけ）',
    run({ check, root }) {
      const L = load(root);
      const last = (o) => {
        let s = mk(L, o);
        const keep = cellsOf(s).reduce((a, i) => (Math.floor(i / s.rock.cols) >= Math.floor(a / s.rock.cols) ? i : a), cellsOf(s)[0]);
        const mats = s.rock.mats.map((m, i) => (i === keep ? m : 0));
        const hp = s.rock.hp.map((h, i) => (i === keep ? 0.01 : 0));
        return { ...s, rock: { ...s.rock, mats, hp, left: 1 }, fighter: { x: s.rock.x + ((keep % s.rock.cols) + 0.5) * 14, y: L.FIGHTER_Y } };
      };
      const s = last({ star: 4, kakera: 50 });
      const r = until(L, s, (e) => e.kind === 'clear', 3);
      const cl = ofKind(r.evs, 'clear')[0];
      const bonus = Math.floor(s.rock.value * 0.2);
      const v = L.cellValue(4, MATN[s.rock.mats.find((m) => m)]);
      check('最後のマスが欠けると clear（star 4）・おまけ＝その星の全部のマスの value×0.2（切り捨て）', !!cl && cl.star === 4 && cl.bonus === bonus && bonus > 0 && r.s.kakera === 50 + v + bonus && r.s.phase === 'clear' && r.s.totals.stars === 1, [cl, r.s.kakera, 50 + v + bonus]);
      const r1 = run(L, r.s, 1.4);
      check('クリアの演出 1.5 秒の間は clear のまま（おまけは1回だけ）', r1.s.phase === 'clear' && r1.s.kakera === r.s.kakera && ofKind(r1.evs, 'clear').length === 0, r1.s.phase);
      const r2 = run(L, r1.s, 0.2);
      check('1.5 秒で次の星（5）が上から（fly・新しい形・tries 1）、大きな星なら boss の出来事', r2.s.phase === 'fly' && r2.s.star === 5 && r2.s.rock.left === r2.s.rock.total && r2.s.rock.total > 0 && r2.s.tries === 1 && J(ofKind(r2.evs, 'boss')) === J([{ kind: 'boss', star: 5 }]), [r2.s.phase, r2.s.star, r2.evs]);
      // エンディング
      const e0 = last({ star: 30, kakera: 0 });
      const re = run(L, e0, 3);
      const ends = ofKind(re.evs, 'ending');
      check('星 30（ENDING_STAR）をクリアするとエンディング（ending 1回・phase end・cleared・次は星 31）', ends.length === 1 && re.s.phase === 'end' && re.s.cleared === true && re.s.star === 31, [ends, re.s.phase, re.s.star, re.s.cleared]);
      const rz = run(L, re.s, 5);
      check('phase end の間は進まない（t もマスも変わらない）', rz.s.phase === 'end' && rz.s.t === re.s.t && rz.evs.length === 0, rz.s.t - re.s.t);
      const cont = L.loadSave(L.makeSave(re.s));
      check('「このまま あそぶ」（保存し直し）で星 31 から fly で続く、cleared は true のまま', cont && cont.phase === 'fly' && cont.star === 31 && cont.cleared === true, cont && [cont.phase, cont.star]);
      const e2 = last({ star: 30, kakera: 0, cleared: true });
      const re2 = run(L, e2, 3);
      check('エンディングは1回だけ（cleared のあとに星 30 をもう一度クリアしても ending は出ない・止まらない）', ofKind(re2.evs, 'ending').length === 0 && re2.s.phase === 'fly' && re2.s.star === 31, re2.s.phase);
      const e3 = last({ star: 9999, cleared: true });
      const re3 = run(L, e3, 3);
      check('星 9999（STAR_MAX）をクリアしても 9999 のまま続く', re3.s.star === 9999 && re3.s.phase === 'fly' && ofKind(re3.evs, 'clear').length === 1, re3.s.star);
    },
  },
  {
    id: 'KL7', tier: 'smoke', node: true, title: 'ほしくだき：2択（得意が違う2つ・持っている武器は出ない・offer が保存で残る＝引き直せない・選ぶまで場が止まる・4 枠で開けられない）',
    run({ check, root }) {
      const L = load(root);
      const good = Object.fromEntries(L.WEAPONS.map((w) => [w.id, w.good]));
      const bad = [];
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        let s = mk(L, { seed, rng: seed * 7919, kakera: 1e9 });
        for (let k = 0; k < 3; k++) {
          const u = L.unlock(s);
          if (!u.ok) { bad.push({ seed, k, why: 'unlock 失敗 ' + u.reason }); break; }
          const o = u.state.offer;
          n++;
          const have = s.slots.map((x) => x.id);
          if (!(Array.isArray(o) && o.length === 2 && o[0] !== o[1] && o.every((id) => good[id] !== undefined && !have.includes(id)) && good[o[0]] !== good[o[1]])) bad.push({ seed, k, o, have });
          if (u.state.phase !== 'choose' || u.state.kakera !== s.kakera - L.SLOT_COST[s.slots.length]) bad.push({ seed, k, why: 'phase/お金' });
          const c = L.choose(u.state, seed % 2);
          if (!c.ok || c.state.slots.length !== s.slots.length + 1 || c.state.slots[c.state.slots.length - 1].id !== o[seed % 2] || c.state.slots[c.state.slots.length - 1].lv !== 1 || c.state.phase !== 'fly' || c.state.offer !== null) bad.push({ seed, k, why: 'choose' });
          s = c.state;
        }
        if (s.slots.length === 4) {
          const u4 = L.unlock(s);
          if (u4.ok || u4.reason !== 'max' || L.slotCostOf(s) !== null) bad.push({ seed, why: '4 枠で開けられた' });
        }
      }
      check('どの種でも：2択は持っていない武器 2 つで、得意なマスが違う。払うと phase choose、選ぶと Lv1 で枠が増え fly にもどる（120 回）', bad.length === 0 && n === 120, bad.slice(0, 3));
      let s = mk(L, { kakera: 400 });
      const u = L.unlock(s);
      const t0 = u.state.t;
      const rs = run(L, u.state, 3);
      check('2択の間は場が止まる（step しても t・マス・かけら が変わらない）', rs.s.t === t0 && rs.s.phase === 'choose' && J(rs.s.rock.mats) === J(u.state.rock.mats) && rs.s.kakera === u.state.kakera && rs.evs.length === 0, rs.s.t);
      const again = L.unlock(u.state);
      check('2択の間にもう一度 unlock はできない（引き直せない・二重に払わない）', !again.ok && again.state.offer === u.state.offer && again.state.kakera === u.state.kakera, again.reason);
      const ld = L.loadSave(L.makeSave(u.state));
      check('offer は保存で残る（読み直しても同じ候補・phase choose・かけらは払ったまま）', ld && J(ld.offer) === J(u.state.offer) && ld.phase === 'choose' && ld.kakera === u.state.kakera, ld && ld.offer);
      const ld2 = L.loadSave(L.makeSave(ld));
      check('何度読み直しても候補は同じ', J(ld2.offer) === J(u.state.offer), ld2.offer);
      check('choose の k が 0・1 以外、2択でないときの choose は ok:false', !L.choose(u.state, 2).ok && !L.choose(u.state, '0').ok && !L.choose(s, 0).ok, null);
      const poor = L.unlock(mk(L, { kakera: 10 }));
      check('かけらが足りないと unlock は ok:false・reason money（払わない）', !poor.ok && poor.reason === 'money' && poor.state.kakera === 10, poor.reason);
      // はね返しの 2 秒の間に開けて選んでも、はね返しの続きから
      let bnc = mk(L, { kakera: 400 });
      bnc = { ...bnc, phase: 'bounce', wait: 1 };
      const ub = L.unlock(bnc);
      const cb = L.choose(ub.state, 0);
      check('はね返し・クリアの演出の間に選んだら、その演出の続きにもどる', ub.ok && cb.ok && cb.state.phase === 'bounce', cb.state.phase);
      // 強くする
      const up = L.upgrade(mk(L, { kakera: 1000, slots: [{ id: 'shot', lv: 9 }] }), 0);
      check('upgrade：値段を払って Lv+1、Lv10 で evolve の出来事', up.ok && up.state.slots[0].lv === 10 && up.state.kakera === 1000 - L.upCost('shot', 9) && J(up.events) === J([{ kind: 'evolve', slot: 0, lv: 10 }]), up);
      const upm = L.upgrade(mk(L, { kakera: 0 }), 0), upx = L.upgrade(mk(L, { kakera: 9e15, slots: [{ id: 'shot', lv: 99 }] }), 0);
      check('upgrade：足りないと money、Lv99 で max（何も変わらない）', !upm.ok && upm.reason === 'money' && !upx.ok && upx.reason === 'max' && upx.state.kakera === 9e15, [upm.reason, upx.reason]);
    },
  },
  {
    id: 'KL8', tier: 'smoke', node: true, title: 'ほしくだき：場を押す API が無い（poke・retryNow なし）、bounce は 2 秒・clear は 1.5 秒で自動で fly へ（ユーザー決定「なにもしない」）',
    run({ check, root }) {
      const L = load(root);
      const keys = Object.keys(L);
      check('AsteroidLogic に poke・retryNow・tap・touch・skip などの「場を押す」関数が無い', !['poke', 'retryNow', 'tap', 'touch', 'skip', 'skipBounce', 'POKE_COOLDOWN'].some((k) => k in L), keys.filter((k) => /poke|retry|tap|touch|skip/i.test(k)));
      const fns = keys.filter((k) => typeof L[k] === 'function').sort();
      const allowed = ['affOf', 'cellHp', 'cellValue', 'choose', 'dmg', 'dpsOf', 'formatKakera', 'hpMul', 'loadSave', 'makeSave', 'matOf', 'newGame', 'progressOf', 'shapeOf', 'simulate', 'slotCostOf', 'starInfo', 'step', 'unlock', 'upCost', 'upCostOf', 'upgrade', 'validateBest', 'valMul'].sort();
      check('公開している関数は契約 §4.2 のもの＋計算の補助（hpMul など）だけ', J(fns) === J(allowed), fns);
      let s = mk(L);
      s = { ...s, phase: 'bounce', wait: 2 };
      let r = run(L, s, 1.95);
      const p1 = r.s.phase;
      r = run(L, r.s, 0.1);
      check("'bounce' は 2 秒で自動で 'fly' へ", p1 === 'bounce' && r.s.phase === 'fly', [p1, r.s.phase]);
      let c = mk(L);
      c = { ...c, phase: 'clear', wait: 1.5 };
      r = run(L, c, 1.45);
      const p2 = r.s.phase;
      r = run(L, r.s, 0.1);
      check("'clear' は 1.5 秒で自動で 'fly' へ（次の星）", p2 === 'clear' && r.s.phase === 'fly' && r.s.star === 2, [p2, r.s.phase, r.s.star]);
    },
  },
  {
    id: 'KL9', tier: 'smoke', node: true, title: 'ほしくだき：保存（makeSave→loadSave で同じ・星の途中 mid・クリアの演出中は次の星・壊れた値の一覧で落ちない・フィールドごとに直す・重複と知らない id を捨てる・v:2 は null）、validateBest',
    run({ check, root }) {
      const L = load(root);
      const s0 = mk(L, { star: 17, kakera: 123456, slots: [{ id: 'shot', lv: 33 }, { id: 'fire', lv: 12 }, { id: 'bolt', lv: 9 }], tries: 3, totals: { cells: 4000, stars: 16, kakera: 999999, chunks: 50 }, seed: 42, rng: 777 });
      const raw = L.makeSave(s0);
      const o = JSON.parse(raw);
      const N0 = s0.rock.cols * s0.rock.rows;
      check('makeSave の形は §8.2（v・star・kakera・slots・offer・cleared・tries・totals・seed・rng と、星の途中 mid { y, mats, hp }）', J(Object.keys(o).sort()) === J(['cleared', 'kakera', 'mid', 'offer', 'rng', 'seed', 'slots', 'star', 'totals', 'tries', 'v']) && o.v === 1 &&
        J(Object.keys(o.mid).sort()) === J(['hp', 'mats', 'y']) && o.mid.mats.length === N0 && o.mid.hp.length === N0 && /^[0-4]+$/.test(o.mid.mats) && /^[09]+$/.test(o.mid.hp), Object.keys(o));
      const s1 = L.loadSave(raw);
      check('makeSave → loadSave → makeSave で同じ（同じ形・同じ位置）', L.makeSave(s1) === raw && J(s1.rock.mats) === J(s0.rock.mats) && s1.phase === 'fly' && s1.rock.y === s0.rock.y, null);
      // 星の途中：少し削ってから保存 → 開き直すと、残りのマス・位置・体力（9 段に切り上げ）がもどる
      let sm = mk(L, { star: 6, seed: 5, slots: [{ id: 'shot', lv: 30 }, { id: 'bomb', lv: 20 }] });
      sm = run(L, sm, 25).s;
      const rawM = L.makeSave(sm), om = JSON.parse(rawM), sm2 = L.loadSave(rawM);
      const hpOk = sm.rock.mats.every((m, i) => !m || (sm2.rock.hp[i] >= sm.rock.hp[i] - 1e-9 && sm2.rock.hp[i] <= sm.rock.hp[i] + L.cellHp(6, MATN[m]) / 9 + 1e-9));
      check('星の途中を保存すると、開き直しても残りのマス・小惑星の位置・体力がもどる（体力は弱くならない側に 9 段で丸める）', sm.phase === 'fly' && sm.rock.left < sm.rock.total && sm2.rock.left === sm.rock.left && J(sm2.rock.mats) === J(sm.rock.mats) && near(sm2.rock.y, sm.rock.y, 0.01) && sm2.rock.total === sm.rock.total && sm2.rock.value === sm.rock.value && hpOk && sm2.phase === 'fly', [sm.rock.left, sm2.rock.left]);
      check('星の途中の保存も小さい（星 30 の大きな星でも 2KB 未満）', L.makeSave(mk(L, { star: 30 })).length < 2048 && rawM.length < 2048, L.makeSave(mk(L, { star: 30 })).length);
      // 壊れた mid：星の最初から（ほかの欄は読む）。体力だけ壊れていれば満タン
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
      ].filter(([, m]) => !fresh(L.loadSave(JSON.stringify({ ...om, mid: m })))).map(([n]) => n);
      check('mid が壊れていたら（長さ・文字・最初に無いマス・種類の変更・0 個・y・形）、星の最初から（落ちない・ほかの進みは残す）', midBad.length === 0 && om.mid.mats.startsWith('0') && /[234]/.test(om.mid.mats), midBad);
      const yBig = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, y: 1e9 } }));
      const pY = L.progressOf(yBig);
      check('mid の y が大きすぎても、一番下のマスはバリアの手前（すぐ はね返らない）', yBig.rock.left === sm.rock.left && pY.distance > 0 && L.step(yBig, L.STEP).events.every((e) => e.kind !== 'bounce'), pY);
      const hpBad = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, hp: 'x' } })), hpBad2 = L.loadSave(JSON.stringify({ ...om, mid: { ...om.mid, hp: om.mid.hp.replace(/[1-9]/, '0') } }));
      const full = (x) => x.rock.mats.every((m, i) => !m || near(x.rock.hp[i], L.cellHp(6, MATN[m]), 1e-9));
      check('mid の hp だけ壊れていたら、残りのマスはそのまま・体力は満タン', hpBad.rock.left === sm.rock.left && full(hpBad) && hpBad2.rock.left === sm.rock.left && full(hpBad2), null);
      // クリアの演出中（phase clear）に閉じたら次の星から（同じ星をもう一度にしない・おまけを 2 回もらわない）。はね返し中は星の最初から
      const lastCell = (st) => { const keep = cellsOf(st).reduce((a, i) => (Math.floor(i / st.rock.cols) >= Math.floor(a / st.rock.cols) ? i : a), cellsOf(st)[0]); return { ...st, rock: { ...st.rock, mats: st.rock.mats.map((m, i) => (i === keep ? m : 0)), hp: st.rock.hp.map((h, i) => (i === keep ? 0.01 : 0)), left: 1 }, fighter: { x: st.rock.x + ((keep % st.rock.cols) + 0.5) * 14, y: L.FIGHTER_Y } }; };
      const cl = until(L, lastCell(mk(L, { star: 7, tries: 3 })), (e) => e.kind === 'clear', 3);
      const oc = JSON.parse(L.makeSave(cl.s));
      const cl30 = until(L, lastCell(mk(L, { star: 30 })), (e) => e.kind === 'clear', 3);
      const o30 = JSON.parse(L.makeSave(cl30.s));
      check('クリアの演出中の保存は次の星（tries 1・mid なし）。はじめての星 30 のクリアだけはエンディングを見せるため星 30 のまま', cl.s.phase === 'clear' && oc.star === 8 && oc.tries === 1 && oc.mid === undefined && cl30.s.phase === 'clear' && o30.star === 30 && o30.mid === undefined, [oc.star, oc.tries, o30.star]);
      let bo = mk(L, { star: 4 });
      bo = { ...bo, rock: { ...bo.rock, y: bo.rock.y + 1000 } };
      const bb = L.step(bo, L.STEP);
      const ob = JSON.parse(L.makeSave(bb.state));
      check('はね返し中の保存は mid なし（開き直すと星の最初から・tries は増えたまま）', bb.state.phase === 'bounce' && ob.mid === undefined && ob.tries === 2 && L.loadSave(L.makeSave(bb.state)).rock.left === bb.state.rock.total, [bb.state.phase, ob.tries]);
      const base = { v: 1, star: 5, kakera: 100, slots: [{ id: 'shot', lv: 3 }], offer: null, cleared: false, tries: 1, totals: { cells: 1, stars: 1, kakera: 1, chunks: 0 }, seed: 1, rng: 1 };
      const nulls = ['', '{', 'null', '[]', '[1,2]', '"x"', '42', 'true', JSON.stringify({ ...base, v: 2 }), JSON.stringify({ ...base, v: '1' }), JSON.stringify({ ...base, v: null }), JSON.stringify({ ...base, v: 0 }), JSON.stringify({ star: 3 }), undefined, null, 42];
      const nb = nulls.filter((x) => L.loadSave(x) !== null);
      check('JSON でない・配列・オブジェクトでない・v が 1 でない（v:2・文字・null・無し）は null（落ちない）', nb.length === 0, nb);
      const fix = (patch) => { const r = L.loadSave(JSON.stringify({ ...base, ...patch })); return r && JSON.parse(L.makeSave(r)); };
      const cases = [
        ['star 0 → 1', { star: 0 }, (x) => x.star === 1],
        ['star 1e9 → 9999', { star: 1e9 }, (x) => x.star === 9999],
        ['star 3.7 → 3', { star: 3.7 }, (x) => x.star === 3],
        ['star "x" → 1', { star: 'x' }, (x) => x.star === 1],
        ['kakera -5 → 0', { kakera: -5 }, (x) => x.kakera === 0],
        ['kakera 1e30 → KAKERA_MAX', { kakera: 1e30 }, (x) => x.kakera === 9e15],
        ['kakera 12.9 → 12', { kakera: 12.9 }, (x) => x.kakera === 12],
        ['kakera NaN 文字 → 0', { kakera: 'NaN' }, (x) => x.kakera === 0],
        ['slots が配列でない → shot だけ', { slots: 'x' }, (x) => J(x.slots) === J([{ id: 'shot', lv: 1 }])],
        ['slots の [0] が shot でない → shot を先頭に', { slots: [{ id: 'bolt', lv: 4 }, { id: 'shot', lv: 9 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 9 }, { id: 'bolt', lv: 4 }])],
        ['重複は後ろを捨てる', { slots: [{ id: 'shot', lv: 2 }, { id: 'fire', lv: 5 }, { id: 'fire', lv: 50 }, { id: 'shot', lv: 77 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 2 }, { id: 'fire', lv: 5 }])],
        ['知らない id・形の違う要素は捨てる', { slots: [{ id: 'shot', lv: 2 }, { id: 'laser', lv: 5 }, null, 7, { lv: 3 }, { id: 'beam', lv: 2 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 2 }, { id: 'beam', lv: 2 }])],
        ['lv は 1〜99 の整数', { slots: [{ id: 'shot', lv: 500 }, { id: 'beam', lv: -3 }, { id: 'bomb', lv: 'x' }, { id: 'fire', lv: 2.5 }] }, (x) => J(x.slots) === J([{ id: 'shot', lv: 99 }, { id: 'beam', lv: 1 }, { id: 'bomb', lv: 1 }, { id: 'fire', lv: 2 }])],
        ['5 つ以上は 4 つまで', { slots: ['shot', 'spread', 'bomb', 'bolt', 'beam', 'fire'].map((id) => ({ id, lv: 1 })) }, (x) => x.slots.length === 4 && x.offer === null],
        ['offer が持っている武器 → 候補を作り直す（払い済み）', { offer: ['shot', 'bolt'] }, (x) => Array.isArray(x.offer) && x.offer.length === 2 && !x.offer.includes('shot')],
        ['offer が知らない id → 作り直す', { offer: ['laser', 'x'] }, (x) => Array.isArray(x.offer) && x.offer.every((id) => ['spread', 'bomb', 'bolt', 'beam', 'fire'].includes(id))],
        ['offer が同じ2つ → 作り直す', { offer: ['bolt', 'bolt'] }, (x) => x.offer[0] !== x.offer[1]],
        ['正しい offer は残す', { offer: ['fire', 'beam'] }, (x) => J(x.offer) === J(['fire', 'beam'])],
        ['4 枠なら offer は null', { slots: ['shot', 'spread', 'bomb', 'bolt'].map((id) => ({ id, lv: 1 })), offer: ['beam', 'fire'] }, (x) => x.offer === null],
        ['cleared と star > 30 の食い違い → cleared true', { star: 40, cleared: false }, (x) => x.cleared === true],
        ['cleared が文字 → false', { cleared: 'yes' }, (x) => x.cleared === false],
        ['tries 0・文字 → 1', { tries: 0 }, (x) => x.tries === 1],
        ['totals が壊れている → 0', { totals: { cells: -1, stars: 'x', kakera: null } }, (x) => J(x.totals) === J({ cells: 0, stars: 0, kakera: 0, chunks: 0 })],
        ['totals が無い → 0', { totals: undefined }, (x) => x.totals.cells === 0],
        ['seed・rng が壊れている → 数に直す', { seed: 'x', rng: -1 }, (x) => Number.isInteger(x.seed) && Number.isInteger(x.rng) && x.seed >= 0 && x.rng >= 0],
      ];
      const cb = cases.filter(([, p, ok]) => { const x = fix(p); return !x || !ok(x); }).map(([name, p]) => ({ name, got: fix(p) }));
      check('v:1 はフィールドごとに直す（星・かけら・武器の重複と知らない id・lv・offer・cleared・tries・totals・seed）', cb.length === 0, cb);
      const keep = fix({ star: 'x', kakera: 5000, slots: [{ id: 'shot', lv: 20 }, { id: 'laser' }] });
      check('壊れた欄があっても、ほかの進み（かけら・武器）は捨てない', keep.kakera === 5000 && J(keep.slots) === J([{ id: 'shot', lv: 20 }]), keep);
      const ls = L.loadSave({ ...base });
      check('オブジェクトのままでも読める（文字列でなくても）', ls && ls.star === 5, null);
      // validateBest
      const VB = [[5, 5], ['12', 12], [3.9, 3], [-1, 0], [1e9, 9999], ['x', 0], [null, 0], [undefined, 0], [NaN, 0], ['', 0], [{}, 0], [[], 0], ['  7 ', 7]];
      const vb = VB.filter(([x, w]) => L.validateBest(x) !== w).map(([x, w]) => ({ x, want: w, got: L.validateBest(x) }));
      check('validateBest は 0〜STAR_MAX の整数（おかしな値は 0）', vb.length === 0, vb);
      check('makeSave におかしな値 → null（落ちない）', [null, undefined, 5, 'x', {}, { star: 1 }].every((x) => L.makeSave(x) === null), null);
    },
  },
  {
    id: 'KL10', tier: 'smoke', node: true, title: 'ほしくだき：決定的・イミュータブル（凍らせた state でも動く・元を変えない）・例外を出さない（おかしな引数の一覧）',
    run({ check, root }) {
      const L = load(root);
      const play = () => {
        let s = mk(L, { star: 12, kakera: 5000, slots: [{ id: 'shot', lv: 20 }, { id: 'bomb', lv: 10 }, { id: 'fire', lv: 10 }, { id: 'bolt', lv: 10 }] });
        const evs = [];
        for (let i = 0; i < 600; i++) { const r = L.step(s, L.STEP); s = r.state; evs.push(...r.events); if (i % 60 === 0) { const u = L.upgrade(s, i % 4); if (u.ok) s = u.state; } }
        return J([s, evs]);
      };
      const A = play(), B = play();
      check('同じ入力なら同じ結果（決定的。20 秒・強くするを混ぜて）', A === B && A.length > 1000, A.length);
      const s = deepFreeze(mk(L, { star: 12, kakera: 1e6, slots: [{ id: 'shot', lv: 20 }, { id: 'bomb', lv: 10 }, { id: 'fire', lv: 10 }, { id: 'beam', lv: 10 }] }));
      const before = J(s);
      let ok = true, err = null, cur = s, n = 0;
      try {
        for (let i = 0; i < 300; i++) { const r = L.step(cur, L.STEP); n += r.events.length; deepFreeze(r.state); cur = r.state; }
        const u = L.upgrade(s, 1); const k = L.unlock(cur); const c = k.ok ? L.choose(deepFreeze(k.state), 1) : null;
        ok = u.ok && k.ok === false && c === null;   // 4 枠なので unlock は失敗
        L.progressOf(s); L.dpsOf(s, 0); L.makeSave(s);
      } catch (e) { ok = false; err = String(e); }
      check('凍らせた state を渡しても例外にならない（中で書き換えていない）・出来事も出る', ok && n > 50, [err, n]);
      check('step・upgrade のあとも元の state は変わらない（イミュータブル）', J(s) === before, null);
      const s2 = mk(L);
      const r1 = L.step(s2, L.STEP);
      check('マスが変わらない step ではマスの配列を写さない（コピーオンライト）', r1.state.rock.mats === s2.rock.mats && r1.state !== s2 && r1.state.rock !== s2.rock, null);
      let s3 = setRock(L, mk(L), ['r'], { hp: 0.01, x: 180 - 7, bottom: 300 }); s3 = { ...s3, fighter: { x: 180, y: L.FIGHTER_Y } };
      const r3 = until(L, s3, (e) => e.kind === 'break', 2);
      check('マスが欠けた step だけ配列を写す（元の配列は変わらない）', r3.hit && s3.rock.mats[0] === 1 && r3.s.rock.mats[0] === 0, null);
      // おかしな引数
      const g = mk(L);
      const calls = [
        () => L.step(null, 0.1), () => L.step({}, 0.1), () => L.step(g, NaN), () => L.step(g, -1), () => L.step(g, 1e9), () => L.step(g, 'x'), () => L.step(g),
        () => L.step({ ...g, rock: null }, 0.1), () => L.step({ ...g, slots: 'x' }, 0.1), () => L.step({ ...g, rock: { ...g.rock, mats: [1] } }, 0.1),
        () => L.upgrade(null, 0), () => L.upgrade(g, 9), () => L.upgrade(g, -1), () => L.upgrade(g, '0'), () => L.upgrade(g, 0.5), () => L.upgrade(g),
        () => L.unlock(null), () => L.unlock({}), () => L.choose(null, 0), () => L.choose(g, 5),
        () => L.dpsOf(null, 0), () => L.dpsOf(g, 7), () => L.upCostOf(g, 7), () => L.upCostOf(null), () => L.slotCostOf(null), () => L.slotCostOf({ slots: 3 }),
        () => L.progressOf(null), () => L.progressOf({}), () => L.starInfo('x'), () => L.formatKakera({}), () => L.formatKakera(), () => L.makeSave(null), () => L.loadSave('{"v":1,"slots":{"0":1}}'),
        () => L.validateBest(Symbol.iterator === undefined ? 0 : {}), () => L.newGame('x'), () => L.newGame(NaN), () => L.newGame(-5), () => L.newGame(1e20),
        () => L.simulate('bogus', null), () => L.simulate('idle', { maxSec: 5 }), () => L.dmg('laser', 1), () => L.upCost('laser', 1), () => L.affOf('shot', 'wood'), () => L.cellHp(1, 'wood'), () => L.shapeOf('x', 1),
      ];
      const thrown = [];
      calls.forEach((f, k) => { try { f(); } catch (e) { thrown.push([k, String(e)]); } });
      check('おかしな引数の一覧（45 種）で例外を出さない', thrown.length === 0 && calls.length >= 45, thrown);
      check('おかしな state の step は null、おかしな slot の upgrade は ok:false', L.step(null, 0.1) === null && L.step({}, 0.1) === null && L.upgrade(g, 9).ok === false && L.upgrade(null, 0).ok === false && L.unlock(null).ok === false && L.choose(null, 0).ok === false, null);
      const dts = [NaN, -1, 'x', undefined].map((d) => L.step(g, d).state.t);
      check('dt は 0〜0.1 に丸める（NaN・負・文字は 0、1e9 は 0.1）', dts.every((t) => t === 0) && near(L.step(g, 1e9).state.t, 0.1), dts);
      check('newGame：種なしは 1、文字・NaN は null、大きな数・負も 32bit に直して動く', L.newGame().seed === 1 && L.newGame('x') === null && L.newGame(NaN) === null && Number.isInteger(L.newGame(1e20).seed) && L.newGame(-5).seed === 5, null);
    },
  },
  {
    id: 'KL11', tier: 'full', node: true, title: 'ほしくだき：自動プレイ（§3.10・§17.1 の軽い版：greedy で星 12 まで・idle 20 分。星1 は買わなくても1回目に 3 分以内でクリア・最初の買い物 20 秒以内・1回の挑戦 3〜5 分前後・買い物の間隔・地球までの近さが動く・やり直しが少ない・惜しい負け・弾 120 以下・random/worst も詰まない）',
    run({ check, root }) {
      const L = load(root);
      const g = L.simulate('greedy', { seed: 1, maxStar: 12 });
      check('greedy：例外なしで星 12 まで届く', !g.error && g.stars.length === 12 && g.endSec !== null, g.error || g.stars.length);
      check('最初の買い物まで 20 秒以内', g.firstBuySec !== null && g.firstBuySec <= 20, g.firstBuySec);
      const first = g.stars.filter((x) => x.star <= 3), norm = g.stars.filter((x) => !x.boss && x.star > 3), boss = g.stars.filter((x) => x.boss);
      check('1回の挑戦：最初の 3 星は 60〜220 秒、ふつうの星は 140〜360 秒、大きな星は 420 秒以内（目安：最初 1.5〜3 分・ふつう 3〜5 分・大きな星 4〜6 分。§3.10 の測った値を参照）',
        first.every((x) => x.clearSec >= 60 && x.clearSec <= 220) && norm.every((x) => x.clearSec >= 140 && x.clearSec <= 360) && boss.every((x) => x.clearSec >= 150 && x.clearSec <= 420), g.stars.map((x) => Math.round(x.clearSec)));
      check('やり直し：ふつうの星は平均 0.3 回以下、どの星も 5 回以内', norm.reduce((a, x) => a + x.tries - 1, 0) / norm.length <= 0.3 && g.stars.every((x) => x.tries <= 5), g.stars.map((x) => x.tries));
      check('2択を2回以上選んでいる（星 12 までに 4 枠）、弾は SHOTS_MAX 以下', g.picks.length >= 2 && g.final.slots.length === 4 && g.shotsMax <= L.SHOTS_MAX && g.shotsMax > 0, [g.picks.length, g.shotsMax]);
      const gaps = g.stars.map((x) => x.sec / Math.max(1, x.buys));
      check('買い物の間隔：星ごとの平均が 45 秒以内・全体の平均 30 秒以内（目安はどの星も 30 秒に 1 回。§3.10 の測った値を参照）', gaps.every((x) => x <= 45) && g.buyGaps.avg <= 30, [gaps.map(Math.round), g.buyGaps]);
      const lefts = g.stars.map((x) => x.leftRatio).sort((a, b) => a - b);
      const lmed = lefts[Math.floor(lefts.length / 2)];
      check('地球までの近さがクリアまでに動く：クリアのときの残りの道のりの中央値が 0.35〜0.8（目安 0.4〜0.7）、どの星も 1 未満', lmed >= 0.35 && lmed <= 0.8 && g.stars.every((x) => x.leftRatio < 1), lefts);
      const i1 = L.simulate('idle', { seed: 2, maxStar: 1, maxSec: 400 });
      check('星1 は何も買わなくても1回目でクリア、3 分以内、残りの道のり 3 割以上', i1.stars.length === 1 && i1.stars[0].tries === 1 && i1.stars[0].clearSec <= 180 && i1.stars[0].leftRatio >= 0.3 && i1.buys === 0, i1.stars[0]);
      const idle = L.simulate('idle', { seed: 1, maxSec: 1200 });
      const kb = idle.kakeraAtBounce;
      check('idle 20 分：例外なし・何も買わない・はね返されても止まらず、そのたびに かけら が増える', !idle.error && idle.buys === 0 && kb.length >= 3 && kb.every((k, i) => i === 0 || k > kb[i - 1]) && idle.t >= 1200 - 1, [idle.error, kb.length, kb.slice(0, 5)]);
      // 惜しい負け：30 秒に 1 つ買う人（ゆっくり買う人）が負けたときの壊した割合
      const slow = L.simulate('greedy', { seed: 1, maxStar: 12, buyEvery: 30 });
      const br = slow.bounces.map((b) => b.broken).sort((a, b) => a - b);
      check('惜しい負け：30 秒に 1 つ買う人が負けたときの壊した割合の中央値が 35〜97%（目安 70〜95% は星 30 までで測る。§3.10。星 12 までは はじめの星の負けが多く低め）', !slow.error && br.length >= 2 && br[Math.floor(br.length / 2)] >= 0.35 && br[Math.floor(br.length / 2)] <= 0.97, br);
      for (const pol of ['random', 'worst']) {
        const r = L.simulate(pol, { seed: 3, maxStar: 12 });
        const g3 = L.simulate('greedy', { seed: 3, maxStar: 12 });
        check(`${pol}：星 12 まで詰まらず、greedy の 1.6 倍以内`, !r.error && r.endSec !== null && r.endSec <= g3.endSec * 1.6, [r.endSec, g3.endSec]);
      }
      // 開き直し：3 分ごとに閉じて開いても、星の途中の保存で進める（保存しないと 3 分より長い星は終わらない）
      const re = L.simulate('greedy', { seed: 1, maxStar: 12, reopenEvery: 180 });
      check('3 分ごとに閉じて開き直しても、星の途中の保存で greedy の 1.2 倍以内で星 12 まで進む', !re.error && re.endSec !== null && re.reopens >= 10 && re.endSec <= g.endSec * 1.2, [re.endSec, g.endSec, re.reopens]);
    },
  },
  {
    id: 'KL12', tier: 'full', node: true, title: 'ほしくだき：1000 回の乱数の操作（強くする・開ける・選ぶ・step の大きさ）で不変条件（かけら 0〜上限の整数・left はやり直し以外で増えない・弾 ≦ SHOTS_MAX・totals は減らない）',
    run({ check, root }) {
      const L = load(root);
      let rnd = 20261021;
      const R = () => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296);
      let s = mk(L, { star: 8, kakera: 3000 });
      const bad = [];
      let ops = 0, steps = 0, stars0 = s.star;
      for (let i = 0; i < 1000; i++) {
        const prev = s;
        const x = R();
        let restarted = false;
        if (x < 0.15) { const u = L.upgrade(s, Math.floor(R() * 5) - 0); if (u.ok) s = u.state; ops++; }
        else if (x < 0.2) { const u = L.unlock(s); if (u.ok) s = u.state; ops++; }
        else if (x < 0.25) { const c = L.choose(s, R() < 0.5 ? 0 : 1); if (c.ok) s = c.state; ops++; }
        else if (x < 0.27) { s = { ...s, kakera: L.KAKERA_MAX - 3 }; }
        else {
          const dt = [0, L.STEP, 0.05, 0.1, 0.5, R() * 0.1][Math.floor(R() * 6)];
          const n = 1 + Math.floor(R() * 60);
          for (let k = 0; k < n; k++) {
            const r = L.step(s, dt);
            if (r.events.some((e) => e.kind === 'bounce' || e.kind === 'clear')) restarted = true;
            if (r.state.rock !== s.rock && r.state.rock.mats !== s.rock.mats && (r.state.phase === 'fly' && s.phase !== 'fly')) restarted = true;
            if (r.state.rock.left > s.rock.left && !restarted && !(s.phase !== 'fly')) bad.push({ i, why: 'left が増えた', a: s.rock.left, b: r.state.rock.left });
            s = r.state; steps++;
          }
        }
        if (!intIn(s.kakera, 0, L.KAKERA_MAX)) bad.push({ i, why: 'kakera', v: s.kakera });
        if (s.shots.length > L.SHOTS_MAX) bad.push({ i, why: 'shots', v: s.shots.length });
        for (const k of ['cells', 'stars', 'kakera', 'chunks']) if (!(s.totals[k] >= prev.totals[k]) || !Number.isFinite(s.totals[k])) bad.push({ i, why: 'totals ' + k });
        if (!(s.slots.length >= 1 && s.slots.length <= 4 && s.slots[0].id === 'shot' && new Set(s.slots.map((y) => y.id)).size === s.slots.length && s.slots.every((y) => intIn(y.lv, 1, 99)))) bad.push({ i, why: 'slots' });
        if (!['fly', 'choose', 'bounce', 'clear', 'end'].includes(s.phase)) bad.push({ i, why: 'phase ' + s.phase });
        if (s.phase === 'choose' && !(Array.isArray(s.offer) && s.offer.length === 2)) bad.push({ i, why: 'offer' });
        if (s.phase === 'end') s = L.loadSave(L.makeSave(s));
        if (bad.length > 5) break;
      }
      check('不変条件が 1000 回の操作のあいだ保たれる', bad.length === 0 && ops > 100 && steps > 10000, { bad: bad.slice(0, 5), ops, steps, star: s.star, from: stars0 });
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
    for (const f of fails) console.log('   × ' + f.name + '\n     ' + JSON.stringify(f.detail));
    if (fails.length) ng++;
  }
  process.exit(ng ? 1 : 0);
}
