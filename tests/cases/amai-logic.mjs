// AL: あまいものあつめの計算ロジック（Node で games/amai/logic.js を直接読む。ブラウザ不要）
//   契約は docs/ari-contract.md（§1 決まり・§2 面の作り方・§4 保存・§5.2 色と印・§6.2 API・§7.2 AL の項目）。
//   局面は契約 §4.1 の形を手で組み（mk）、validateState を通して使う。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・AmaiLogic を公開していなければ例外で不合格にする。
//   絵：本物の絵（pictures-a.js・pictures-b.js）の検査は AL2 だけ（無ければ AL2 は不合格）。
//       生成を確かめる項目（AL6・AL8・AL11・AL12・AL13）は、本物の 48 枚がそろっていればそれを使い、
//       そろっていなければテストの中で作った仮の絵（段の決まりを守る自動の絵）を AmaiPictures に入れて使う（終わったら元に戻す）。
//   単体でも流せる：node tests/cases/amai-logic.mjs [ID...]（最後の「単体で流す」を参照）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// 重さを測る CPU 時間（このスレッドだけ。T-21）
const cpuOf = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));
const cpuMs = (u) => (u.user + u.system) / 1000;

function load(root) {
  const f = path.join(root, 'games/amai/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/amai/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.createLevel !== 'function' || typeof L.step !== 'function' || typeof L.press !== 'function') throw new Error('logic.js が AmaiLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const LET = { R: 0, O: 1, Y: 2, G: 3, S: 4, B: 5, P: 6, C: 7, W: 8, K: 9 };

// ---- 局面を手で組む（§4.1 の形）。map は文字の地図、cols は [[箱, …] ×4]、箱は { c: 色, n: 数, lid, ice } ----
let NID = 1000;
const BX = (o) => ({ id: o.id ?? NID++, color: o.c, count: o.n ?? 1, lid: !!o.lid, ice: o.ice ?? 0 });
const SB = (o) => (o ? { id: o.id ?? NID++, color: o.c, count: o.n ?? 1 } : null);
function mk(L, map, { cols = [[], [], [], []], slots = [], presses = 0, t = 0, total } = {}) {
  const H = map.length, W = map[0].length;
  const cells = [];
  for (const row of map) for (const ch of row) cells.push(ch === '.' ? -1 : LET[ch]);
  const left = cells.filter((v) => v >= 0).length;
  const s = L.validateState({ level: 7, W, H, picture: 'test', mirror: false, repeat: false, cells, total: total ?? left, left,
    cols: cols.map((c) => c.map(BX)), slots: Array.from({ length: L.SLOTS }, (_, i) => SB(slots[i])), t, presses, won: left === 0 });
  if (!s) throw new Error('mk: validateState が null（テストの局面の組み方の誤り）');
  return s;
}
const at = (s, x, y) => y * s.W + x;

// ---- 仮の絵（本物の絵がそろっていないとき、生成を確かめるために使う。テストの中だけ） ----
// 楕円を色の数の種でボロノイに分けた自動の絵。段の決まり（大きさ・色の数・角砂糖の数・各色 3 個以上・閉じた空きなし）を守るまで種を変える
const FAKE_DIM = { S: [15, 14, 4], M: [19, 18, 5], L: [24, 21, 7], XL: [28, 23, 8], XXL: [32, 24, 10] };   // §2.1 の大きさの範囲の中・色は段の多い方（重い方で確かめる）
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fakePicture(L, id, tier, k) {
  const [W, H, nc] = FAKE_DIM[tier];
  const letters = 'RGYSBPCKOW';
  const T = L.TIERS[tier];
  for (let tryN = 0; tryN < 200; tryN++) {
    const rnd = rngOf(k * 7919 + tryN * 104729 + 1);
    const seeds = [];
    for (let i = 0; i < nc; i++) seeds.push([rnd() * W, rnd() * H]);
    const off = Math.floor(rnd() * 10);
    const map = [];
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
        if (dx * dx + dy * dy > 1) { row += '.'; continue; }
        let best = 0, bd = Infinity;
        for (let i = 0; i < nc; i++) { const d = (x - seeds[i][0]) ** 2 + (y - seeds[i][1]) ** 2; if (d < bd) { bd = d; best = i; } }
        row += letters[(best + off) % letters.length];
      }
      map.push(row);
    }
    const def = { id, name: 'かり', season: '', map };
    const p = L.parsePicture(def, false);
    if (!p) continue;
    const per = {};
    for (const v of p.cells) if (v >= 0) per[v] = (per[v] || 0) + 1;
    const sugar = p.cells.filter((v) => v >= 0).length;
    if (Object.keys(per).length === nc && Object.values(per).every((n) => n >= 3) && sugar >= T.sugar[0] && sugar <= T.sugar[1]) return def;
  }
  throw new Error('仮の絵が作れない：' + id);
}
function registry(defs) {
  const by = new Map();
  const reg = { add(list) { for (const d of list) by.set(d.id, d); }, byId(id) { return by.get(id) || null; }, list: () => [...by.values()] };
  reg.add(defs);
  return reg;
}
const hasReal = (L) => L.PICTURE_ORDER.slice(0, 48).every((p) => L.pictureById(p.id, false));
// 本物の 48 枚がそろっていれば何もしない。そろっていなければ仮の絵を入れて fn を流し、元に戻す
async function withPictures(L, fn) {
  if (hasReal(L)) return fn('本物');
  const prev = globalThis.AmaiPictures;
  globalThis.AmaiPictures = registry(L.PICTURE_ORDER.map((p, k) => fakePicture(L, p.id, p.tier, k + 1)));
  try { return await fn('仮'); } finally { if (prev === undefined) delete globalThis.AmaiPictures; else globalThis.AmaiPictures = prev; }
}

// 落ち着くまで進める（最大 limit はこび）
function settle(L, s, limit = 5000) {
  for (let i = 0; i < limit; i++) { const r = L.step(s); if (!r.moved) return s; s = r.state; }
  return s;
}
// 解を「落ち着いてから押す」で再生する。{ ok, state, bad }
function playSolution(L, created) {
  let s = created.state;
  for (const col of created.info.solution) {
    s = settle(L, s);
    const r = L.press(s, col);
    if (r.outcome.kind !== 'press') return { ok: false, state: s, bad: r.outcome };
    s = r.state;
  }
  s = settle(L, s);
  return { ok: s.won === true, state: s };
}
const allBoxes = (s) => s.cols.flat();
const sumByColor = (s) => { const o = {}; for (const b of allBoxes(s)) o[b.color] = (o[b.color] || 0) + b.count; for (const b of s.slots) if (b) o[b.color] = (o[b.color] || 0) + b.count; return o; };
const sugarByColor = (s) => { const o = {}; for (const v of s.cells) if (v >= 0) o[v] = (o[v] || 0) + 1; return o; };

// ゆるい遊び方（§2.8）：2〜7 はこびに 1 回、わくが空いていれば手前の箱を押す。8 割は今ふちにある色、2 割はでたらめ。1手もどす は使わない
function loosePlay(L, created, seed) {
  const rnd = rngOf(seed);
  let s = created.state, wait = 2 + Math.floor(rnd() * 6), ticks = 0;
  for (let guard = 0; guard < 20000; guard++) {
    if (s.won) return { won: true, ticks };
    if (L.isStuck(s)) return { won: false, ticks };
    if (wait <= 0 || L.isStable(s)) {
      const can = [0, 1, 2, 3].filter((c) => L.canPress(s, c) === null);
      if (can.length) {
        const good = can.filter((c) => L.edgeCells(s, s.cols[c][0].color).length > 0);
        const pool = good.length && rnd() < 0.8 ? good : can;
        s = L.press(s, pool[Math.floor(rnd() * pool.length)]).state;
      }
      wait = 2 + Math.floor(rnd() * 6);
    }
    const r = L.step(s);
    if (r.moved) { s = r.state; ticks++; }
    wait--;
  }
  return { won: false, ticks, guard: true };
}

export const tests = [
  {
    id: 'AL1', tier: 'smoke', node: true, title: 'あまいものあつめ：定数・COLORS（10 色。文字・hex・印・名前・5×5 の点がすべてちがう）・NAME・paramsFor が §2.1 の表どおり（境界・壊れた値）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'あまいものあつめ', SLOTS: 3, COLS: 4, TICK_MS: 120, FAST_MS: 60, MAX_W: 64, MAX_H: 48, MAX_SUGAR: 2800, MAX_COUNT: 99, MAX_PRESSES: 400, MAX_T: 5000,
        GEN_TRIES: 20, GEN_WORK: 300000, BASE_PICTURES: 48, REPEAT_FROM: 9,
        SAVE_KEY_SAVE: 'amai.save', SAVE_KEY_BEST: 'amai.best', SAVE_KEY_BOOK: 'amai.book', SAVE_KEY_HELP: 'amai.help', SAVE_KEY_FAST: 'amai.fast' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §6.2 のとおり', kBad.length === 0, kBad);
      // 手直し（2026-10-30）：絵を 2×2 に割って 64×48・角砂糖 2800 まで、はこびの間隔を 500→120ms にした。
      // ANY_RATE（①を使う箱の割合）は段ごとの表。XL・XXL だけ 0.25、ほかは 1
      check('ANY_RATE（①を使う箱の割合）が表どおり（S・M・L・くり返し 1、XL・XXL 0.25）', J(L.ANY_RATE) === J({ S: 1, M: 1, L: 1, XL: 0.25, XXL: 0.25, repeat: 1 }), L.ANY_RATE);
      check('はこびの間隔：ふだん 120ms・はやおくり 60ms（1 つの箱から 1 秒に約 8 匹）', L.TICK_MS === 120 && L.FAST_MS === 60 && L.FAST_MS * 2 === L.TICK_MS, { t: L.TICK_MS, f: L.FAST_MS });
      const C = L.COLORS;
      check('COLORS は 10 色で id が 0〜9・凍結', Array.isArray(C) && C.length === 10 && C.every((c, i) => c.id === i) && Object.isFrozen(C) && C.every((c) => Object.isFrozen(c)), C);
      const want = [['R', 'red', 'あか', '#E23B3B', 'circle'], ['O', 'orange', 'オレンジ', '#F28C28', 'triangle'], ['Y', 'yellow', 'きいろ', '#F2D13A', 'star'], ['G', 'green', 'みどり', '#3E9E4F', 'diamond'],
        ['S', 'sky', 'みずいろ', '#78C6EE', 'plus'], ['B', 'blue', 'あお', '#2E5BC9', 'cross'], ['P', 'pink', 'ピンク', '#F29BC2', 'heart'], ['C', 'brown', 'ちゃいろ', '#8B5A33', 'bars'],
        ['W', 'white', 'しろ', '#F5F2EA', 'ring'], ['K', 'black', 'くろ', '#2B2B33', 'stripes']];
      check('文字・key・名前・hex・印が §5.2 の表どおり', C.every((c, i) => J([c.letter, c.key, c.name, c.hex, c.mark]) === J(want[i])), C.map((c) => [c.letter, c.key, c.name, c.hex, c.mark]));
      const uniq = (f) => new Set(C.map(f)).size === C.length;
      check('文字・key・名前・hex・印・5×5 の点がすべてちがう', uniq((c) => c.letter) && uniq((c) => c.key) && uniq((c) => c.name) && uniq((c) => c.hex) && uniq((c) => c.mark) && uniq((c) => c.dots.join('/')), null);
      check('5×5 の点は 5 行 × 5 文字（# と . だけ）', C.every((c) => c.dots.length === 5 && c.dots.every((r) => /^[#.]{5}$/.test(r))), C.map((c) => c.dots));
      check('colorName', L.colorName(0) === 'あか' && L.colorName(9) === 'くろ' && L.colorName(10) === '' && L.colorName('x') === '', null);
      // §2.1 の表（1〜48 面は PICTURE_ORDER の絵で）
      // 箱の数の幅は TIERS の値。ただし段ごとの上書き KSET・くり返しの REPEAT_K があればそれ（logic.js が公開する表を読む。表の持ち主は logic.js）
      const KR = (tier) => (L.KSET && L.KSET[tier]) || [L.TIERS[tier].kmin, L.TIERS[tier].kmax];
      const T = (lv, tier, kmin, kmax, pull, lids, ices) => ({ lv, tier, kmin: KR(tier)[0], kmax: KR(tier)[1], pull, lids, ices });
      const table = [
        T(1, 'S', 15, 25, 0, 0, 0), T(2, 'S', 15, 25, 0, 0, 0), T(4, 'S', 15, 25, 0, 0, 0),
        T(5, 'M', 10, 25, 2, 0, 0), T(8, 'M', 10, 25, 2, 0, 0), T(9, 'M', 10, 25, 2, 1, 0), T(12, 'M', 10, 25, 2, 1, 0),
        T(13, 'L', 10, 30, 4, 1, 0), T(18, 'L', 10, 30, 4, 1, 0), T(19, 'L', 10, 30, 4, 2, 1), T(24, 'L', 10, 30, 4, 2, 1),
        T(25, 'XL', 10, 30, 8, 3, 1), T(30, 'XL', 10, 30, 8, 3, 1), T(31, 'XL', 10, 30, 8, 3, 2), T(36, 'XL', 10, 30, 8, 3, 2),
        T(37, 'XXL', 10, 30, 12, 4, 3), T(48, 'XXL', 10, 30, 12, 4, 3),
      ];
      const bad = [];
      for (const r of table) {
        const pk = L.pickPicture(r.lv, null);
        const p = L.paramsFor(r.lv, pk);
        const ok = p && p.tier === r.tier && p.kmin === r.kmin && p.kmax === r.kmax && p.pull === r.pull && p.lids === r.lids && p.ices === r.ices && p.picture === L.PICTURE_ORDER[r.lv - 1].id && p.mirror === false && p.repeat === false;
        if (!ok) bad.push({ want: r, got: p });
      }
      check('1〜48 面の境界（1・2・4・5・8・9・12・13・18・19・24・25・30・31・36・37・48）が表どおり', bad.length === 0, bad);
      // 49 面から：くり返し（ずかんが空なら 9 枚目＝M の段）。段の値 +（k 8–25・pull +2・多い方 +1）
      const p49 = L.paramsFor(49, L.pickPicture(49, null));
      check('49 面（くり返し・9 枚目 M）：k は REPEAT_K の幅・pull 4・lids 2・ices 1・反転', p49.repeat === true && p49.mirror === true && p49.tier === 'M' && p49.kmin === L.REPEAT_K.kmin && p49.kmax === L.REPEAT_K.kmax && p49.pull === 4 && p49.lids === 2 && p49.ices === 1 && p49.picture === L.PICTURE_ORDER[8].id, p49);
      const pX = L.paramsFor(1000, { id: L.PICTURE_ORDER[47].id, mirror: true, repeat: true });
      check('1000 面（くり返し・XXL の絵）：pull 14・lids 5・ices 4', pX.tier === 'XXL' && pX.pull === 14 && pX.lids === 5 && pX.ices === 4 && pX.kmin === L.REPEAT_K.kmin && pX.kmax === L.REPEAT_K.kmax, pX);
      const pA = L.paramsFor(60, { id: L.PICTURE_ORDER[30].id, mirror: false, repeat: false });
      check('49 面から（足した絵の扱い・くり返しでない）：その絵の段の行・lids・ices は段の多い方', pA.tier === 'XL' && pA.kmin === KR('XL')[0] && pA.kmax === KR('XL')[1] && pA.pull === 8 && pA.lids === 3 && pA.ices === 2 && pA.repeat === false, pA);
      // 壊れた値は 1 面
      const one = J(L.paramsFor(1, null));
      const broken = [0, -3, NaN, Infinity, 'abc', null, undefined, {}, 1.7].map((v) => ({ v: String(v), same: J(L.paramsFor(v, null)) === one }));
      check('壊れた level は 1 面（0・-3・NaN・Infinity・文字・null・undefined・{}）と 1.7→1', broken.every((b) => b.same), broken);
      check('PICTURE_ORDER に無い pick は、その面の絵に置きかえる', J(L.paramsFor(3, { id: 'nai', mirror: true })) === J(L.paramsFor(3, null)), L.paramsFor(3, { id: 'nai' }));
      check('LEVELS が配列', Array.isArray(L.LEVELS) && L.LEVELS.length > 0, L.LEVELS);
      // PICTURE_ORDER（§2.6 の表の段）
      const PO = L.PICTURE_ORDER;
      const tiers = PO.slice(0, 48).map((p) => p.tier).join(',');
      const wantT = [...Array(4).fill('S'), ...Array(8).fill('M'), ...Array(12).fill('L'), ...Array(12).fill('XL'), ...Array(12).fill('XXL')].join(',');
      check('PICTURE_ORDER は 48 枚・段が 4/8/12/12/12・id は英小文字だけで重ならない', PO.length >= 48 && tiers === wantT && PO.every((p) => /^[a-z]+$/.test(p.id)) && new Set(PO.map((p) => p.id)).size === PO.length, PO);
      check('1 枚目 ringo・3 枚目 sakura・9 枚目 suika・14 枚目 yukidaruma・20 枚目 momiji', PO[0].id === 'ringo' && PO[2].id === 'sakura' && PO[8].id === 'suika' && PO[13].id === 'yukidaruma' && PO[19].id === 'momiji', PO.slice(0, 20).map((p) => p.id));
    },
  },
  {
    id: 'AL2', tier: 'smoke', node: true, title: 'あまいものあつめ：本物の絵（pictures-a.js・pictures-b.js、48 枚以上）が §2.6 の決まりを守る・PICTURE_ORDER の id がちょうど 1 回ずつ・季節・parsePicture が決まりを破った絵で null・Date を使わない',
    run({ check, root }) {
      const L = load(root);
      // parsePicture の決まり（手作りの絵で）
      const ok = { id: 'abc', name: 'りんご', season: '', map: ['RRRR', 'RGGR', 'RGRR', 'RRRR'] };
      check('正しい絵は読める（W・H・cells）', (() => { const p = L.parsePicture(ok, false); return p && p.W === 4 && p.H === 4 && p.cells[5] === 3 && p.cells[0] === 0 && p.cells.length === 16; })(), L.parsePicture(ok, false));
      const mir = L.parsePicture({ ...ok, map: ['RRRG', 'RRRG', 'RRRG'] }, true);
      check('mirror で左右反転', mir && mir.cells[0] === 3 && mir.cells[3] === 0, mir);
      const bads = {
        '行の長さがちがう': { ...ok, map: ['RRR', 'RR', 'RRR'] },
        '使えない文字': { ...ok, map: ['RRR', 'RXR', 'RRR'] },
        '1〜2 個だけの色': { ...ok, map: ['RGR', 'RGR', 'RRR'] },
        '閉じた空き': { ...ok, map: ['RRRR', 'RG.R', 'RGGR', 'RRRR'] },
        '上の行が空き': { ...ok, map: ['...', 'RRR', 'RRR'] },
        '右の列が空き': { ...ok, map: ['RR.', 'RR.', 'RR.'] },
        '横 65': { ...ok, map: ['R'.repeat(65), 'R'.repeat(65), 'R'.repeat(65)] },
        '縦 49': { ...ok, map: Array(49).fill('RRR') },
        '角砂糖 2801 個以上': { ...ok, map: Array(48).fill('R'.repeat(59)) },
        'id が英小文字でない': { ...ok, id: 'Ringo1' },
        'name が空': { ...ok, name: '' },
        'name に漢字': { ...ok, name: '林檎' },
        'season がちがう': { ...ok, season: 'spring' },
        'season が無い': { id: 'abc', name: 'りんご', map: ok.map },
        'map が無い': { id: 'abc', name: 'りんご', season: '' },
        '角砂糖が無い': { ...ok, map: ['...'] },
      };
      const notNull = Object.entries(bads).filter(([, d]) => L.parsePicture(d, false) !== null).map(([k]) => k);
      check('決まりを破った絵は null（' + Object.keys(bads).join('・') + '）', notNull.length === 0, notNull);
      check('おかしな引数で null（null・文字・数）', L.parsePicture(null) === null && L.parsePicture('x') === null && L.parsePicture(3) === null, null);
      // Date を使わない（logic.js・pictures-*.js）
      const files = ['logic.js', 'pictures-a.js', 'pictures-b.js'].map((f) => path.join(root, 'games/amai', f));
      const useDate = files.filter((f) => fs.existsSync(f) && /\bDate\b|Math\.random|localStorage/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
      check('logic.js・pictures-*.js に Date・Math.random・localStorage が無い', useDate.length === 0, useDate);
      // 本物の絵
      const missingFiles = ['pictures-a.js', 'pictures-b.js'].filter((f) => !fs.existsSync(path.join(root, 'games/amai', f)));
      check('pictures-a.js・pictures-b.js がある', missingFiles.length === 0, missingFiles);
      const P = globalThis.AmaiPictures;
      check('AmaiPictures（add・byId）がある', !!P && typeof P.add === 'function' && !!P.byId, P ? Object.keys(P) : P);
      if (!P || missingFiles.length) return;
      const PO = L.PICTURE_ORDER;
      const defs = PO.map((p) => ({ p, d: typeof P.byId === 'function' ? P.byId(p.id) : P.byId[p.id] }));
      const missing = defs.filter((x) => !x.d).map((x) => x.p.id);
      check('PICTURE_ORDER の絵がすべてある（48 枚以上）', PO.length >= 48 && missing.length === 0, missing);
      // 2 つのファイルにちょうど 1 回ずつ（ファイルの文字から id を数える）
      const src = ['pictures-a.js', 'pictures-b.js'].map((f) => fs.readFileSync(path.join(root, 'games/amai', f), 'utf8')).join('\n');
      const ids = [...src.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const cnt = {}; for (const id of ids) cnt[id] = (cnt[id] || 0) + 1;
      const notOnce = PO.filter((p) => cnt[p.id] !== 1).map((p) => ({ id: p.id, n: cnt[p.id] || 0 }));
      check('PICTURE_ORDER の id が 2 つのファイルにちょうど 1 回ずつ', notOnce.length === 0, notOnce);
      const extra = Object.keys(cnt).filter((id) => !PO.some((p) => p.id === id));
      check('ファイルに PICTURE_ORDER に無い絵が無い', extra.length === 0, extra);
      const badPic = [];
      const names = new Set();
      const season = { haru: 0, natsu: 0, aki: 0, fuyu: 0 };
      for (const { p, d } of defs) {
        if (!d) continue;
        const q = L.parsePicture(d, false);
        if (!q) { badPic.push({ id: p.id, why: 'parsePicture が null（大きさ・文字・3 個以上・閉じた空き・はしの行・名前・season）' }); continue; }
        const per = {}; let sugar = 0;
        for (const v of q.cells) if (v >= 0) { per[v] = (per[v] || 0) + 1; sugar++; }
        const nc = Object.keys(per).length;
        const T = L.TIERS[p.tier];
        if (nc < T.colors[0] || nc > T.colors[1]) badPic.push({ id: p.id, why: `色の数 ${nc}（段 ${p.tier} は ${T.colors.join('–')}）` });
        if (sugar < T.sugar[0] || sugar > T.sugar[1]) badPic.push({ id: p.id, why: `角砂糖 ${sugar}（段 ${p.tier} は ${T.sugar.join('–')}）` });
        if (names.has(d.name)) badPic.push({ id: p.id, why: '名前が重なる ' + d.name });
        names.add(d.name);
        if (season[d.season] !== undefined) season[d.season]++;
      }
      // 手直し（2026-10-30）：1・2 面に出る絵だけは 2×2 に割らない（はじめての人が必ずクリアできる保証＝箱 12 個以下を守るため）。
      // 割っていない前提を確かめる：1・2 面の絵は 32×24 以下
      for (const lv of [1, 2]) {
        const pk = L.pickPicture(lv, null);
        const d = typeof P.byId === 'function' ? P.byId(pk.id) : P.byId[pk.id];
        const q = d && L.parsePicture(d, false);
        check(`${lv} 面の絵（${pk.id}）は割っていない（32×24 以下）`, !!q && q.W <= 32 && q.H <= 24, q && { W: q.W, H: q.H });
      }
      check('すべての絵が決まりを守る（段の色の数・角砂糖の数・名前が重ならない ほか）', badPic.length === 0, badPic);
      check('季節の絵が春・夏・秋・冬それぞれ 3 枚以上', Object.values(season).every((n) => n >= 3), season);
      const need = ['sakura', 'suika', 'momiji', 'yukidaruma'];
      check('さくら・すいか・もみじ・ゆきだるま がある', need.every((id) => defs.some((x) => x.p.id === id && x.d)), need);
    },
  },
  {
    id: 'AL3', tier: 'smoke', node: true, title: 'あまいものあつめ：ふち（わくのはしはふち・上下左右が角砂糖ならふちでない・ななめは数えない・閉じた空きは外でない・運ぶと閉じた空きが外になる）',
    run({ check, root }) {
      const L = load(root);
      const s1 = mk(L, ['.....', '.RRR.', '.RBR.', '.RRR.', '.....']);
      check('R はみな ふち、まん中の B は ふちでない', L.edgeCells(s1, LET.R).length === 8 && L.edgeCells(s1, LET.B).length === 0, L.edgeCells(s1));
      const s2 = mk(L, ['.....', '.R.R.', '.RBR.', '.RRR.', '.....']);
      check('B の上の R が運ばれると B は ふち', J(L.edgeCells(s2, LET.B)) === J([at(s2, 2, 2)]), L.edgeCells(s2, LET.B));
      const s3 = mk(L, ['.....', '..RR.', '.RBR.', '.RRR.', '.....']);
      check('左上（ななめ）の R が運ばれても B は ふちでない', L.edgeCells(s3, LET.B).length === 0, L.edgeCells(s3, LET.B));
      const s4 = mk(L, ['RRR', 'RBR', 'RRR']);
      check('絵のわくのはしの角砂糖は ふち（外は わくの外）', L.edgeCells(s4, LET.R).length === 8 && L.edgeCells(s4, LET.B).length === 0, L.edgeCells(s4));
      // 閉じた空き：まわりを角砂糖で囲まれた空きは外でない
      const s5 = mk(L, ['.......', '.RRGRR.', '.RB.BR.', '.RRRRR.', '.......']);
      check('閉じた空きは外でない（となりの B は ふちでない）', L.edgeCells(s5, LET.B).length === 0, L.edgeCells(s5, LET.B));
      // 運んで外とつながる（step の中で外を広げる）
      const s6 = mk(L, ['.......', '.RRGRR.', '.RB.BR.', '.RRRRR.', '.......'], { slots: [{ c: LET.G, n: 1 }, null, null, null, null], total: 14 });
      const r6 = L.step(s6);
      check('G を運ぶと閉じた空きが外になり、両どなりの B が ふち', r6.moved && J(L.edgeCells(r6.state, LET.B).sort((a, b) => a - b)) === J([at(s6, 2, 2), at(s6, 4, 2)]), { moved: r6.moved, e: L.edgeCells(r6.state, LET.B) });
      const s7 = mk(L, ['.......', '.RR.RR.', '.RB.BR.', '.RRRRR.', '.......']);
      check('同じ形を cells から作っても同じ（覚えた外の表と、作り直した外の表が一致）', J(L.edgeCells(s7)) === J(L.edgeCells(r6.state)), { a: L.edgeCells(s7), b: L.edgeCells(r6.state) });
      // ふちでない B の箱は待つ
      const s8 = mk(L, ['RRR', 'RBR', 'RRR'], { slots: [{ c: LET.B, n: 1 }, null, null, null, null], total: 9 });
      check('ふちに無い色の箱は運ばない（moved:false）', L.step(s8).moved === false, null);
    },
  },
  {
    id: 'AL4', tier: 'smoke', node: true, title: 'あまいものあつめ：運ぶ（同じ色だけ・ふちだけ・巣に近い順・同じなら下・左・1 はこびで 1 箱 1 個・左のわくから順・同じ色の 2 箱・数が減る・0 で消えてわくが空く・待つ・carries の中身）',
    run({ check, root }) {
      const L = load(root);
      // 巣に近い順：W=5 H=2。|2x−4| + 2(H−y)
      let s = mk(L, ['RRRRR', 'RRRRR'], { slots: [{ id: 1, c: LET.R, n: 10 }, null, null, null, null] });
      const got = [];
      for (let i = 0; i < 6; i++) { const r = L.step(s); got.push(r.carries[0].cell); s = r.state; }
      // (2,1)=7 → (1,1)=6・(3,1)=8 → (2,0)=2（6・8・2 は同じ近さ：下が先・左が先）→ (0,1)=5・(4,1)=9
      check('巣に近い順・同じなら下の行・同じなら左', J(got) === J([7, 6, 8, 2, 5, 9]), got);
      const r0 = L.step(mk(L, ['RRRRR', 'RRRRR'], { slots: [{ id: 1, c: LET.R, n: 2 }, null, null, null, null] }));
      const c0 = r0.carries[0];
      check('carries の中身（slot・id・color・cell・x・y・emptied）', r0.carries.length === 1 && c0.slot === 0 && c0.id === 1 && c0.color === LET.R && c0.cell === 7 && c0.x === 2 && c0.y === 1 && c0.emptied === false, r0.carries);
      check('数が 1 減り、t が 1 進み、left が 1 減る', r0.state.slots[0].count === 1 && r0.state.t === 1 && r0.state.left === 9, r0.state);
      // 同じ色だけ
      const r1 = L.step(mk(L, ['RG', 'RG'], { slots: [null, { c: LET.G, n: 1 }, null, null, null] }));
      check('同じ色の角砂糖だけ運ぶ', r1.carries.length === 1 && r1.state.cells[r1.carries[0].cell] === -1 && [1, 3].includes(r1.carries[0].cell), r1.carries);
      // 0 で消える
      check('数が 0 になった箱は消えて、わくが空く（emptied:true）', r1.carries[0].emptied === true && r1.state.slots[1] === null, r1.state.slots);
      // 左のわくから順・前の箱の結果が次に効く
      const map = ['RRR', 'RGR', 'RRR'];
      const r2 = L.step(mk(L, map, { slots: [{ c: LET.R, n: 1 }, { c: LET.G, n: 1 }, null, null, null], total: 9 }));
      check('左のわくの R が下の R を運ぶと、同じ 1 はこびで右のわくの G がふちに出て運ぶ', r2.carries.length === 2 && r2.carries[0].cell === 7 && r2.carries[1].cell === 4 && r2.carries[1].slot === 1, r2.carries);
      const r3 = L.step(mk(L, map, { slots: [{ c: LET.G, n: 1 }, { c: LET.R, n: 1 }, null, null, null], total: 9 }));
      check('順が逆（G が左）なら G はこの 1 はこびでは待つ', r3.carries.length === 1 && r3.carries[0].slot === 1 && r3.state.slots[0].count === 1, r3.carries);
      const r3b = L.step(r3.state);
      check('次の 1 はこびで G が運ぶ', r3b.carries.length === 1 && r3b.carries[0].cell === 4, r3b.carries);
      // 同じ色の 2 箱
      const r4 = L.step(mk(L, ['RRRR'], { slots: [null, { c: LET.R, n: 2 }, { c: LET.R, n: 2 }] }));
      check('同じ色の 2 箱は 2 つとも運ぶ（左のわくが先に選ぶ）', r4.carries.length === 2 && r4.carries[0].slot === 1 && r4.carries[1].slot === 2 && r4.carries[0].cell !== r4.carries[1].cell, r4.carries);
      // 1 はこびで 1 箱 1 個
      const r5 = L.step(mk(L, ['RRRRRRRR'], { slots: [{ c: LET.R, n: 5 }, null, null, null, null] }));
      check('1 はこびで 1 箱あたり 1 個だけ', r5.carries.length === 1 && r5.state.left === 7, r5.carries);
      // 待つ
      const s6 = mk(L, map, { slots: [{ c: LET.G, n: 1 }, null, null, null, null], total: 9 });
      const r6 = L.step(s6);
      check('その色がふちに無いと待つ（数が減らない・t が進まない・同じ局面）', r6.moved === false && r6.state === s6 && r6.state.slots[0].count === 1 && r6.state.t === 0 && r6.carries.length === 0, r6);
      // ふちだけ（中の G は運ばない）、空きの箱なし
      const s7 = mk(L, ['GGG', 'GRG', 'GGG'], { slots: [{ c: LET.R, n: 1 }, null, null, null, null] });
      check('ふちでない角砂糖は運ばない', L.step(s7).moved === false, null);
      // 全部運ぶと won
      let s8 = mk(L, ['RR'], { slots: [{ c: LET.R, n: 2 }, null, null, null, null] });
      s8 = L.step(s8).state; const r8 = L.step(s8);
      check('角砂糖を全部運ぶと won', r8.won === true && r8.state.won === true && r8.state.left === 0, r8.state);
      check('won の後は進まない', L.step(r8.state).moved === false, null);
      check('isStable：運べないとき true・運べるとき false', L.isStable(s6) === true && L.isStable(s7) === true && L.isStable(mk(L, ['RR'], { slots: [{ c: LET.R, n: 2 }, null, null, null, null] })) === false, null);
    },
  },
  {
    id: 'AL5', tier: 'smoke', node: true, title: 'あまいものあつめ：押す（reason の順 won → range → empty → frozen → full・一番左の空きわくへ・列が詰まる・ふたが手前で開く・こおりの残りが減り 0 でとける・こおりは押せない）',
    run({ check, root }) {
      const L = load(root);
      const map = ['RRRR', 'GGGG'];
      const full = Array.from({ length: L.SLOTS }, () => ({ c: 0 }));
      // reason の順
      const sw = L.validateState({ level: 1, W: 2, H: 1, picture: 'test', mirror: false, repeat: false, cells: [-1, -1], total: 2, left: 0, cols: [[], [], [], []], slots: Array(L.SLOTS).fill(null), t: 2, presses: 1, won: true });
      check('won：クリアの後（列の番号がおかしくても won が先）', L.press(sw, 9).outcome.reason === 'won' && L.press(sw, 0).outcome.reason === 'won', L.press(sw, 9).outcome);
      const s = mk(L, map, { cols: [[{ c: 0, n: 4 }], [], [{ c: 3, n: 4, ice: 2 }], [{ c: 3, n: 4 }]], slots: full.map((x) => ({ ...x })) .map((x, i) => (i < L.SLOTS - 1 ? x : null)), total: 8 });
      const rs = [4, -1, '0', 1.5, null, undefined].map((c) => L.press(s, c).outcome.reason);
      check('range：列の番号が 0〜3 の整数でない（4・-1・"0"・1.5・null・undefined）', rs.every((r) => r === 'range'), rs);
      check('empty：その列に箱がない', L.press(s, 1).outcome.reason === 'empty', L.press(s, 1).outcome);
      const sf = mk(L, map, { cols: [[{ c: 0, n: 4 }], [], [{ c: 3, n: 4, ice: 2 }], [{ c: 3, n: 4 }]], slots: full, total: 8 });
      check('frozen が full より先', L.press(sf, 2).outcome.reason === 'frozen', L.press(sf, 2).outcome);
      check('full：わくが全部うまっている', L.press(sf, 0).outcome.reason === 'full', L.press(sf, 0).outcome);
      check('canPress も同じ理由（押せるなら null）', L.canPress(sf, 0) === 'full' && L.canPress(sf, 2) === 'frozen' && L.canPress(s, 0) === null && L.canPress(s, 1) === 'empty', null);
      check('invalid のとき state はそのまま', L.press(sf, 0).state === sf, null);
      // 一番左の空きわく・列が詰まる
      const s2 = mk(L, map, { cols: [[{ id: 1, c: 0, n: 2 }, { id: 2, c: 0, n: 2 }], [{ id: 3, c: 3, n: 4 }], [], []], slots: [{ c: 3, n: 0 + 1 }, null, null, null, null].map((x, i) => (i === 0 ? null : x)), total: 8 });
      const s2b = L.validateState({ ...JSON.parse(J(s2)), slots: [{ id: 50, color: 3, count: 0 + 1 }, null, { id: 51, color: 0, count: 1 }] });
      const r2 = L.press(s2b, 0);
      check('押した箱は空いているわくのうち一番左（1 番）へ', r2.outcome.kind === 'press' && r2.outcome.slot === 1 && r2.state.slots[1].id === 1 && r2.outcome.id === 1 && r2.outcome.count === 2 && r2.outcome.col === 0, r2.outcome);
      check('押した列は詰まり、うしろの箱が新しい手前', r2.state.cols[0].length === 1 && r2.state.cols[0][0].id === 2 && r2.state.presses === 1, r2.state.cols[0]);
      check('ほかの列は同じ', J(r2.state.cols[1]) === J(s2b.cols[1]), null);
      // ふた
      const s3 = mk(L, map, { cols: [[{ id: 1, c: 0, n: 4 }, { id: 2, c: 3, n: 4, lid: true }], [], [], []], total: 8 });
      const r3 = L.press(s3, 0);
      check('ふたの箱は手前に来たら開く（lid:false・opened に col・id・color・count）', r3.state.cols[0][0].lid === false && J(r3.outcome.opened) === J([{ col: 0, id: 2, color: 3, count: 4 }]), r3.outcome);
      check('ふたの無い押し方では opened は空', J(L.press(mk(L, map, { cols: [[{ c: 0, n: 4 }, { c: 3, n: 4 }], [], [], []], total: 8 }), 0).outcome.opened) === '[]', null);
      check('手前にふたのある局面は validateState が null', L.validateState({ ...JSON.parse(J(s3)), cols: [[{ id: 9, color: 0, count: 4, lid: true, ice: 0 }], [], [], []] }) === null, null);
      // こおり
      let s4 = mk(L, ['RRRRRRRR', 'GGGGGGGG'], { cols: [[{ id: 1, c: 0, n: 2 }, { id: 2, c: 0, n: 2 }, { id: 3, c: 0, n: 2 }], [{ id: 7, c: 3, n: 8, ice: 2 }], [], [{ id: 4, c: 0, n: 2 }]], total: 16 });
      check('こおりの手前の箱は押せない（frozen）', L.press(s4, 1).outcome.reason === 'frozen', L.press(s4, 1).outcome);
      const r4a = L.press(s4, 0);
      check('ほかを 1 回押す：まだこおり（残り 1）・thawed は空', r4a.outcome.kind === 'press' && r4a.state.cols[1][0].ice === 2 && r4a.outcome.thawed.length === 0 && L.press(r4a.state, 1).outcome.reason === 'frozen', r4a.state.cols[1]);
      const r4b = L.press(r4a.state, 3);
      check('2 回目で とける（ice:0・thawed に id）・押せる', r4b.state.cols[1][0].ice === 0 && J(r4b.outcome.thawed) === J([7]) && L.canPress(r4b.state, 1) === null, r4b.outcome);
      // 手前でなくても減る
      const s5 = mk(L, ['RRRRRRRR', 'GGGGGGGG'], { cols: [[{ id: 1, c: 0, n: 2 }], [{ id: 6, c: 0, n: 2 }, { id: 7, c: 3, n: 8, ice: 1 }], [], []], total: 16 });
      const r5 = L.press(s5, 0);
      check('手前でない こおりの箱も、押すたびに減ってとける', r5.state.cols[1][1].ice === 0 && J(r5.outcome.thawed) === J([7]), r5.outcome);
    },
  },
  {
    id: 'AL6', tier: 'smoke', node: true, title: 'あまいものあつめ：生成（1〜60 面と 1000 面が決定的・色ごとの箱の合計＝角砂糖・箱 1〜99・解で won・1・2 面は箱 12 個以下・ふたとこおりは表の面からだけ・最初の手前にふた無し・予備 2・work ≦ GEN_WORK）',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        check(`絵：${kind}`, true, null);
        const book48 = JSON.stringify({ v: 1, got: Object.fromEntries(L.PICTURE_ORDER.map((p) => [p.id, 1])) });
        const levels = [];
        for (let lv = 1; lv <= 60; lv++) levels.push([lv, L.pickPicture(lv, null)]);
        levels.push([1000, L.pickPicture(1000, L.validateBook(book48))]);
        levels.push([77, L.pickPicture(77, L.validateBook(book48))]);
        const bad = [];
        let lidSeen = 0, iceSeen = 0;
        const fb = { 0: 0, 1: 0, 2: 0 };
        for (const [lv, pk] of levels) {
          const a = L.createLevel(lv, pk), b = L.createLevel(lv, pk);
          const s = a.state, info = a.info;
          fb[info.fallback]++;
          const why = [];
          if (J(a) !== J(b)) why.push('決定的でない');
          if (J(sumByColor(s)) !== J(sugarByColor(s))) why.push('色ごとの箱の合計が角砂糖とちがう');
          if (!allBoxes(s).every((x) => Number.isInteger(x.count) && x.count >= 1 && x.count <= 99)) why.push('箱の数が 1〜99 でない');
          // 1・2 面の箱の上限：絵を割って角砂糖が 4 倍になり、持ち玉は 99 までなので 5→12（logic.js の EASY_BOXES）
          if (lv <= 2 && allBoxes(s).length > 12) why.push('1・2 面の箱が 12 個より多い');
          const lids = allBoxes(s).filter((x) => x.lid).length, ices = allBoxes(s).filter((x) => x.ice > 0).length;
          if (lids > info.params.lids || ices > info.params.ices) why.push(`仕掛けが表より多い（ふた ${lids}・こおり ${ices}）`);
          if (lv < 9 && lids) why.push('9 面より前に ふた');
          if (lv < 19 && ices) why.push('19 面より前に こおり');
          if (s.cols.some((c) => c[0] && c[0].lid)) why.push('最初の手前に ふた');
          if (allBoxes(s).some((x) => x.lid && x.ice)) why.push('1 つの箱に仕掛けが 2 つ');
          if (info.work > L.GEN_WORK) why.push('work が GEN_WORK を超えた ' + info.work);
          if (info.solution.length !== allBoxes(s).length) why.push('solution の長さが箱の数とちがう');
          if (s.picture !== pk.id && info.fallback !== 2) why.push('絵がちがう');
          if (pk.mirror !== s.mirror) why.push('反転がちがう');
          const pl = playSolution(L, a);
          if (!pl.ok) why.push('解でクリアできない ' + J(pl.bad || null));
          lidSeen += lids; iceSeen += ices;
          if (why.length) bad.push({ lv, pic: pk.id, fallback: info.fallback, why });
        }
        check('1〜60 面・77 面・1000 面（くり返し）がすべて決まりを守る', bad.length === 0, bad);
        check('ふた・こおりが どこかの面で出る（空振りでない）', lidSeen > 0 && iceSeen > 0, { lidSeen, iceSeen });
        check('予備 2 を使った面が無い（' + J(fb) + '）', fb[2] === 0, fb);
        // 予備 2：絵が読めないとき（絵の表を空にして作る）
        const prev = globalThis.AmaiPictures;
        globalThis.AmaiPictures = registry([]);
        try {
          const f = L.createLevel(5, null);
          check('絵が読めないときは予備 2（りんご・箱 5 個）で、確かめを通る', f.info.fallback === 2 && f.state.picture === 'ringo' && allBoxes(f.state).length === 5 && playSolution(L, f).ok && J(sumByColor(f.state)) === J(sugarByColor(f.state)), { fb: f.info.fallback, n: allBoxes(f.state).length });
        } finally { globalThis.AmaiPictures = prev; }
        const c13 = L.createLevel(13, null);
        check('info の形（level・seed・params・tries・work・fallback・solution）', c13.info.level === 13 && c13.info.seed === L.seedFor(13) && c13.info.params && Number.isInteger(c13.info.tries) && Number.isInteger(c13.info.work) && [0, 1, 2].includes(c13.info.fallback) && Array.isArray(c13.info.solution), c13.info);
        check('最初の局面：t 0・presses 0・わくは空・won false・left＝total', c13.state.t === 0 && c13.state.presses === 0 && c13.state.slots.every((x) => x === null) && c13.state.won === false && c13.state.left === c13.state.total, null);
        check('面がちがえば箱の配り方がちがう（49 面と 50 面は同じ絵でもちがう）', J(L.createLevel(49, L.pickPicture(49, null)).state.cols) !== J(L.createLevel(50, L.pickPicture(50, null)).state.cols), null);
      });
    },
  },
  {
    id: 'AL7', tier: 'smoke', node: true, title: 'あまいものあつめ：うごかせない（わく全部埋まって運べない → true・1 箱でも運べる → false・わくが空いて押せる列 → false・手前が全部こおりで運べない → true・列が空でわくに残りの箱 → false）',
    run({ check, root }) {
      const L = load(root);
      const map = ['RRR', 'RGR', 'RRR'];
      const G5 = Array.from({ length: L.SLOTS }, () => ({ c: LET.G, n: 1 }));   // わく全部（SLOTS 個）
      const sA = mk(L, map, { slots: G5, cols: [[{ c: LET.R, n: 8 }], [], [], []], total: 9 });
      check('わく全部が埋まり、どの箱も運べない → true', L.isStuck(sA) === true, null);
      const r = L.step(sA);
      check('step の stuck も true（moved:false）', r.stuck === true && r.moved === false, { stuck: r.stuck, moved: r.moved });
      const sB = mk(L, map, { slots: [...G5.slice(0, L.SLOTS - 1), { c: LET.R, n: 1 }], cols: [[{ c: LET.R, n: 7 }], [], [], []], total: 9 });
      check('1 箱でも運べる → false', L.isStuck(sB) === false, null);
      const sC = mk(L, map, { slots: [...G5.slice(0, L.SLOTS - 1), null], cols: [[{ c: LET.R, n: 8 }], [], [], []], total: 9 });
      check('わくが空いていて押せる列がある → false', L.isStuck(sC) === false, null);
      const sD = mk(L, map, { slots: [...G5.slice(0, L.SLOTS - 1), null], cols: [[{ c: LET.R, n: 4, ice: 3 }], [{ c: LET.R, n: 4, ice: 2 }], [], []], total: 9 });
      check('わくが空いていても、手前が全部こおり（か空の列）で運べない → true', L.isStuck(sD) === true, null);
      const sE = mk(L, map, { slots: [{ c: LET.G, n: 1 }, { c: LET.R, n: 8 }, null, null, null], total: 9 });
      check('列が空で、わくに残りの箱（合計が合っている）→ false', L.isStuck(sE) === false, null);
      const sW = L.validateState({ level: 1, W: 1, H: 1, picture: 'test', mirror: false, repeat: false, cells: [-1], total: 1, left: 0, cols: [[], [], [], []], slots: Array(L.SLOTS).fill(null), t: 1, presses: 1, won: true });
      check('クリアした局面は false', L.isStuck(sW) === false, null);
      check('おかしな引数は false', L.isStuck(null) === false && L.isStuck({}) === false, null);
    },
  },
  {
    id: 'AL8', tier: 'smoke', node: true, title: 'あまいものあつめ：再生と 1手もどす（途中の { presses, t } を replay すると同じ局面・最後の手を除いてその手の t まで再生すると押す直前・全部戻すと面の最初・ok:false）',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, () => {
        for (const lv of [13, 40]) {
          const pk = L.pickPicture(lv, null);
          const c = L.createLevel(lv, pk);
          let s = c.state;
          const hist = [];   // { before, mv }
          const sol = c.info.solution;
          // 押す → 少し運ぶ → 押す（落ち着く前にも押す）
          for (let k = 0; k < Math.min(6, sol.length); k++) {
            const col = [0, 1, 2, 3].find((cc) => L.canPress(s, cc) === null);
            if (col === undefined) break;
            const before = s;
            const r = L.press(s, col);
            hist.push({ before, mv: [before.t, col] });
            s = r.state;
            for (let i = 0; i < 1 + (k % 3); i++) { const st = L.step(s); if (st.moved) s = st.state; }
          }
          check(`${lv} 面：手を 3 つ以上押せた（空振りでない）`, hist.length >= 3, hist.length);
          const mv = hist.map((h) => h.mv);
          const rp = L.replay(lv, pk, mv, s.t);
          check(`${lv} 面：replay で同じ局面（JSON 一致）・ok・applied`, rp.ok === true && rp.applied === mv.length && J(rp.state) === J(s), { ok: rp.ok, applied: rp.applied });
          let allBack = true;
          for (let k = hist.length - 1; k >= 0; k--) {
            const u = L.replay(lv, pk, mv.slice(0, k), mv[k][0]);
            if (!(u.ok && J(u.state) === J(hist[k].before))) { allBack = false; break; }
          }
          check(`${lv} 面：最後の手を 1 つずつ戻すと、その手を押す直前の局面（運んだ分も戻る）`, allBack, null);
          const u0 = L.replay(lv, pk, [], 0);
          check(`${lv} 面：全部戻すと面の最初`, u0.ok && J(u0.state) === J(c.state), null);
          // 落ち着いた後の t より大きい t
          const stl = settle(L, s);
          const far = L.replay(lv, pk, mv, stl.t + 1);
          check(`${lv} 面：落ち着いた後の t より大きい t で ok:false`, far.ok === false, { t: stl.t, ok: far.ok });
          const big = L.replay(lv, pk, [[stl.t + 50, 0]], stl.t + 50);
          check(`${lv} 面：手の t より前に落ち着くと ok:false・applied 0`, big.ok === false && big.applied === 0, big.applied);
        }
        // 押せない手（SLOTS+1 個目は full）
        const lv = 5, pk = L.pickPicture(5, null);
        let s = L.createLevel(lv, pk).state;
        const mv = [];
        while (mv.length < L.SLOTS) { const col = [0, 1, 2, 3].find((cc) => L.canPress(s, cc) === null); if (col === undefined) break; mv.push([0, col]); s = L.press(s, col).state; }
        const col6 = [0, 1, 2, 3].find((cc) => s.cols[cc].length > 0);
        const r6 = L.replay(lv, pk, [...mv, [0, col6]], 0);
        check('押せない手（わくがいっぱい）で ok:false・applied は わくの数', mv.length === L.SLOTS && col6 !== undefined && r6.ok === false && r6.applied === L.SLOTS, { n: mv.length, ok: r6.ok, applied: r6.applied });
        // t が逆順の手（既に進んだ時刻より前の手）は ok:false（MA9：押した手の t を見ない）
        {
          const cr = L.createLevel(lv, pk);
          const col0 = cr.info.solution[0];   // 最初の 1 手は解の 1 手目（運べる箱。0 列目が運べるとは限らない）
          const q = L.press(cr.state, col0).state;
          const st1 = L.step(q);
          const colB = [0, 1, 2, 3].find((cc) => L.canPress(st1.state, cc) === null);
          const colC = [0, 1, 2, 3].find((cc) => cc !== colB && L.canPress(st1.state, cc) === null);
          const rev = st1.moved && colB !== undefined && colC !== undefined ? L.replay(lv, pk, [[0, col0], [st1.state.t, colB], [0, colC]], st1.state.t) : null;
          check('replay：t が逆順の手（進んだ時刻より前）で ok:false', rev !== null && rev.ok === false, rev && { ok: rev.ok, applied: rev.applied });
        }
        check('replay：t が最後の手より小さいと ok:false', L.replay(lv, pk, [[3, 0]], 1).ok === false || L.replay(lv, pk, [[0, 0]], -1).ok === false, null);
      });
    },
  },
  {
    id: 'AL9', tier: 'smoke', node: true, title: 'あまいものあつめ：保存の検証（validateBest・validateSave・makeSave・validateBook・addToBook・bookCount・recordBest・validateFlag）',
    run({ check, root }) {
      const L = load(root);
      const bb = [null, '', 'abc', '-1', '1.5', 'NaN', 'Infinity', '{}', '1e400', '9007199254740992', undefined, {}, ' ', '0x10', '1e3'];
      const nb = bb.filter((v) => L.validateBest(v) !== 0).map(String);
      check('validateBest：壊れた値は 0', nb.length === 0, nb);
      check('validateBest：正しい値', L.validateBest('0') === 0 && L.validateBest('7') === 7 && L.validateBest('9007199254740991') === 9007199254740991 && L.validateBest(12) === 12, null);
      const good = { v: 1, level: 7, pic: 'hiyoko', mirror: false, rep: false, presses: [[0, 2], [0, 1], [12, 3]], t: 41 };
      const g = L.validateSave(J(good));
      check('validateSave：正しい形', g && g.level === 7 && J(g.pick) === J({ id: 'hiyoko', mirror: false, repeat: false }) && J(g.presses) === J(good.presses) && g.t === 41, g);
      const badSaves = {
        '壊れた JSON': '{"v":1,', 'JSON でない': 'abc', 'v ちがい': J({ ...good, v: 2 }), 'level 0': J({ ...good, level: 0 }), 'level 1.5': J({ ...good, level: 1.5 }),
        'pic が英小文字でない': J({ ...good, pic: 'Hiyoko' }), 'pic が無い': J({ ...good, pic: undefined }), 'mirror が文字': J({ ...good, mirror: 'false' }), 'rep が無い': J({ ...good, rep: undefined }),
        'presses が配列でない': J({ ...good, presses: {} }), '手の形ちがい（長さ 3）': J({ ...good, presses: [[0, 1, 2]] }), '手の形ちがい（文字）': J({ ...good, presses: [['0', 1]] }),
        '列 4': J({ ...good, presses: [[0, 4]] }), '列 -1': J({ ...good, presses: [[0, -1]] }), 't が負': J({ ...good, presses: [[-1, 0]] }),
        't の逆順': J({ ...good, presses: [[5, 0], [3, 1]] }), '長すぎ': J({ ...good, presses: Array(401).fill([0, 0]) }), 't > MAX_T': J({ ...good, t: 5001, presses: [] }),
        '最後の手の t が保存の t より大きい': J({ ...good, presses: [[50, 0]], t: 41 }), '配列': '[]', 'null': 'null', '数': '5',
      };
      const passed = Object.entries(badSaves).filter(([, raw]) => L.validateSave(raw) !== null).map(([k]) => k);
      check('validateSave：壊れた保存は null（' + Object.keys(badSaves).length + ' 通り）', passed.length === 0, passed);
      check('validateSave：文字でない引数は null', L.validateSave(null) === null && L.validateSave(good) === null, null);
      check('validateSave：手 400 個・t 5000 は読める', L.validateSave(J({ ...good, presses: Array(400).fill([0, 0]), t: 5000 })) !== null, null);
      const ms = L.makeSave(7, { id: 'hiyoko', mirror: false, repeat: false }, [[0, 2], [12, 3]], 41);
      check('makeSave の形（v・level・pic・mirror・rep・presses・t）と往復', J(JSON.parse(ms)) === J({ v: 1, level: 7, pic: 'hiyoko', mirror: false, rep: false, presses: [[0, 2], [12, 3]], t: 41 }) && L.validateSave(ms) !== null, ms);
      check('makeSave：くり返しの pick（mirror・rep が true）', (() => { const o = JSON.parse(L.makeSave(50, { id: 'suika', mirror: true, repeat: true }, [], 0)); return o.mirror === true && o.rep === true && o.pic === 'suika'; })(), null);
      // ずかん
      const raw = J({ v: 1, got: { ringo: 2, sakura: 'x', ichigo: 0, Kame: 3, momiji: 10000, nai: 4, suika: 1.5, kinoko: 9999 } });
      const vb = L.validateBook(raw);
      check('validateBook：壊れた項目だけ捨て、ほか（PICTURE_ORDER に無い id も）は残す', J({ ...vb.got }) === J({ ringo: 2, nai: 4, kinoko: 9999 }), { ...vb.got });
      const empt = ['{', 'null', '[]', J({ v: 2, got: { ringo: 1 } }), J({ v: 1, got: [] }), J({ v: 1 }), '', null, 5].map((r) => Object.keys(L.validateBook(r).got).length);
      check('validateBook：全体が壊れていれば空', empt.every((n) => n === 0), empt);
      check('validateBook：constructor などの名前でも壊れない', (() => { const b = L.validateBook(J({ v: 1, got: { constructor: 2 } })); return b.got.constructor === 2 && L.bookCount(J({ v: 1, got: {} })) === 0; })(), null);
      const ab = JSON.parse(L.addToBook(raw, 'ringo'));
      check('addToBook：1 足す・ほかの絵を消さない', ab.v === 1 && ab.got.ringo === 3 && ab.got.nai === 4 && ab.got.kinoko === 9999, ab);
      check('addToBook：9999 で止まる', JSON.parse(L.addToBook(raw, 'kinoko')).got.kinoko === 9999, null);
      check('addToBook：壊れた book なら新しく 1', J(JSON.parse(L.addToBook('{', 'ringo'))) === J({ v: 1, got: { ringo: 1 } }), null);
      check('addToBook：おかしな id は足さない（消しもしない）', J(JSON.parse(L.addToBook(raw, 'Bad1')).got) === J({ ringo: 2, nai: 4, kinoko: 9999 }), null);
      check('bookCount：PICTURE_ORDER にある絵だけ数える', L.bookCount(raw) === 2 && L.bookCount('{') === 0 && L.bookCount(null) === 0, L.bookCount(raw));
      check('recordBest', J(L.recordBest('3', 5)) === J({ best: 5, improved: true }) && J(L.recordBest('5', 5)) === J({ best: 5, improved: false }) && J(L.recordBest('abc', 1)) === J({ best: 1, improved: true }) && J(L.recordBest('9', 2)) === J({ best: 9, improved: false }), null);
      check('validateFlag："1" だけ true', L.validateFlag('1') === true && [null, '', '0', 'true', 1, true].every((v) => L.validateFlag(v) === false), null);
    },
  },
  {
    id: 'AL10', tier: 'smoke', node: true, title: 'あまいものあつめ：イミュータブル（press・step の前後で元の局面が JSON で一致・凍結）・おかしな引数で例外を出さない',
    run({ check, root }) {
      const L = load(root);
      const s = mk(L, ['RRRR', 'GGGG'], { cols: [[{ c: 0, n: 2 }, { c: 3, n: 4, lid: true }], [{ c: 0, n: 2 }], [{ c: 3, n: 4, ice: 1 }], []], total: 8 });
      const before = J(s);
      const r1 = L.press(s, 0);
      const r2 = L.step(r1.state);
      const r3 = L.press(r2.state, 1);
      check('press・step の後も元の局面は同じ（JSON 一致）', J(s) === before, null);
      check('press が新しいオブジェクトを返す', r1.state !== s && r1.state.cols !== s.cols && r1.state.slots !== s.slots, null);
      check('返す局面は凍結（state・cells・cols・slots）', Object.isFrozen(r2.state) && Object.isFrozen(r2.state.cells) && Object.isFrozen(r2.state.cols) && Object.isFrozen(r2.state.cols[0]) && Object.isFrozen(r2.state.slots) && Object.isFrozen(r3.state.slots[0]), null);
      // 手で作った（凍結していない）局面を渡しても、元を変えない
      const plain = JSON.parse(before);
      const pj = J(plain);
      L.press(plain, 0); L.step(L.press(plain, 0).state); L.step(plain);
      check('凍結していない局面を渡しても元を変えない', J(plain) === pj, null);
      // おかしな引数
      const odd = [undefined, null, 0, 'x', [], {}, { level: 1 }, NaN, Symbol('s')];
      const thrown = [];
      const tryIt = (name, fn) => { try { fn(); } catch (e) { thrown.push(name + '：' + e.message); } };
      for (const a of odd) {
        tryIt('press', () => { const r = L.press(a, 0); if (r.outcome.kind !== 'invalid') throw new Error('invalid でない'); });
        tryIt('step', () => { const r = L.step(a); if (r.moved !== false) throw new Error('moved'); });
        tryIt('isStable', () => L.isStable(a));
        tryIt('isStuck', () => L.isStuck(a));
        tryIt('canPress', () => L.canPress(a, 0));
        tryIt('edgeCells', () => { if (!Array.isArray(L.edgeCells(a))) throw new Error('配列でない'); });
        tryIt('hud', () => L.hud(a));
        tryIt('validateState', () => { if (L.validateState(a) !== null) throw new Error('null でない'); });
        tryIt('paramsFor', () => L.paramsFor(a, a));
        tryIt('pickPicture', () => L.pickPicture(a, a));
        tryIt('pictureById', () => L.pictureById(a, a));
        tryIt('parsePicture', () => L.parsePicture(a, a));
        tryIt('validateSave', () => L.validateSave(a));
        tryIt('validateBook', () => L.validateBook(a));
        tryIt('addToBook', () => L.addToBook(a, a));
        tryIt('bookCount', () => L.bookCount(a));
        tryIt('validateBest', () => L.validateBest(a));
        tryIt('recordBest', () => L.recordBest(a, a));
        tryIt('makeSave', () => L.makeSave(a, a, a, a));
        tryIt('colorName', () => L.colorName(a));
      }
      tryIt('press（列がおかしい）', () => { for (const c of odd) L.press(s, c); });
      tryIt('createLevel（壊れた level）', () => { L.createLevel('abc', null); L.createLevel(-5, { id: 5 }); });
      tryIt('replay（おかしな手）', () => { const r = L.replay(1, null, [[0, 'x'], null], 3); if (r.ok !== false) throw new Error('ok'); L.replay(1, null, 'x', 'y'); });
      check('例外を出さない（' + odd.length + ' 通りの引数 × 公開の関数）', thrown.length === 0, thrown.slice(0, 10));
      check('hud が局面の値をそのまま', J(L.hud(r2.state)) === J({ level: 7, left: r2.state.left, total: 8, presses: 1, carried: 8 - r2.state.left }), L.hud(r2.state));
      check('validateState：壊れた局面は null（cells の長さ・left の食いちがい・列が 3 つ・わくが 4 つ・id の重なり・数 0）', [
        { ...plain, cells: plain.cells.slice(1) }, { ...plain, left: 3 }, { ...plain, cols: plain.cols.slice(1) }, { ...plain, slots: plain.slots.slice(1) },
        { ...plain, cols: [[{ id: 1, color: 0, count: 2, lid: false, ice: 0 }], [{ id: 1, color: 0, count: 2, lid: false, ice: 0 }], [], []] },
        { ...plain, slots: [{ id: 99, color: 0, count: 0 }, ...Array(L.SLOTS - 1).fill(null)] }, { ...plain, won: true },
      ].every((x) => L.validateState(x) === null), null);
    },
  },
  {
    id: 'AL11', tier: 'full', node: true, solo: true, title: 'あまいものあつめ：性能（1〜60 面と 1000 面の生成の合計が Node で 3 秒以内・1 面 250ms 以内・一番大きい絵の面で解を最後まで再生して 150ms 以内）',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        check(`絵：${kind}`, true, null);
        // 1 回目は JIT の暖め（数えない）
        L.createLevel(48, null); L.createLevel(30, null);
        const per = [];
        const t0 = cpuOf();
        const book48 = L.validateBook(JSON.stringify({ v: 1, got: Object.fromEntries(L.PICTURE_ORDER.map((p) => [p.id, 1])) }));
        for (const lv of [...Array(60).keys()].map((i) => i + 1).concat([1000])) {
          const pk = L.pickPicture(lv, lv > 48 ? book48 : null);
          const a = cpuOf();
          L.createLevel(lv, pk);
          per.push({ lv, ms: +cpuMs(cpuOf(a)).toFixed(2) });
        }
        const total = cpuMs(cpuOf(t0));
        const worst = per.reduce((m, x) => (x.ms > m.ms ? x : m), per[0]);
        // 実測 1.4〜1.7 秒（絵を割る前は約 0.6 秒）。他のテストと並んで流れても落ちないよう 2000 → 3000ms にした
        check(`生成の合計 ${total.toFixed(0)}ms ≦ 3000ms`, total <= 3000, total);
        // 手直し（2026-10-30）で面の作り方が「解ける押し順を探して確かめる」方式に変わり、1 面の生成が重くなった（中央 10ms・最大 95ms）。
        // 基準を 50 → 100ms にゆるめた。実機（iPhone SE 第2世代）で面の始めに止まらないかは試作で確かめる（docs/plans/amai-rework.md §13）
        // 手直し（2026-10-30・絵を 2×2 に割った）：マスが 4 倍（最大 64×48）になり、生成の探索も入るので 1 面の生成が重くなった
        // （中央 16〜21ms・最大 160〜210ms）。基準を 100 → 250ms にゆるめた（実測の最大 210ms に余裕を足した値）。
        // 実機（iPhone SE 第2世代）で面の始めに止まらないかは試作で確かめる。
        check(`1 面の最大 ${worst.ms}ms（${worst.lv} 面）≦ 250ms`, worst.ms <= 250, per.filter((x) => x.ms > 100));
        // 一番大きい絵の面（角砂糖が一番多い 37〜48 面）で解を最後まで再生
        let big = null;
        for (let lv = 37; lv <= 48; lv++) { const c = L.createLevel(lv, null); if (!big || c.state.total > big.state.total) big = c; }
        const a = cpuOf();
        const pl = playSolution(L, big);
        const ms = cpuMs(cpuOf(a));
        check(`一番大きい面（${big.info.level} 面・${big.state.W}×${big.state.H}・角砂糖 ${big.state.total}）の解の再生 ${ms.toFixed(1)}ms ≦ 150ms・won`, pl.ok && ms <= 150, ms);
        // 解の再生は角砂糖 1 個ごとに step を呼ぶので、角砂糖が 4 倍（最大 2576 個）になると約 4 倍かかる（実測 74ms）。50 → 150ms にした
        const b = cpuOf();
        const rp = L.replay(big.info.level, L.pickPicture(big.info.level, null), [], 0);
        check(`replay（生成を含む）${cpuMs(cpuOf(b)).toFixed(1)}ms ≦ 50ms`, rp.ok && cpuMs(cpuOf(b)) <= 50, null);
      });
    },
  },
  {
    id: 'AL12', tier: 'full', node: true, title: 'あまいものあつめ：自動プレイの表（段ごとの ゆるい遊び方のクリアの割合・面の長さ）。合否は「作れない面が 0」と「1・2 面は 100%」だけ',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        const rows = {};
        let failedGen = 0;
        const first = [];
        const RUNS = 10;
        for (let lv = 1; lv <= 48; lv++) {
          let c;
          try { c = L.createLevel(lv, null); } catch (e) { failedGen++; continue; }
          if (c.info.fallback === 2) failedGen++;
          const tier = c.info.params.tier;
          const r = rows[tier] || (rows[tier] = { tier, levels: 0, runs: 0, won: 0, ticks: [], boxes: 0, sugar: 0, colors: 0, fb1: 0 });
          r.levels++; r.boxes += allBoxes(c.state).length; r.sugar += c.state.total; r.colors += Object.keys(sugarByColor(c.state)).length; if (c.info.fallback === 1) r.fb1++;
          for (let k = 0; k < RUNS; k++) {
            const res = loosePlay(L, c, lv * 131 + k);
            r.runs++;
            if (res.won) { r.won++; r.ticks.push(res.ticks); }
            if (lv <= 2) first.push(res.won);
          }
        }
        const table = Object.values(rows).map((r) => {
          const t = r.ticks.sort((a, b) => a - b);
          const q = (p) => (t.length ? t[Math.min(t.length - 1, Math.floor(p * t.length))] : null);
          return { 段: r.tier, 面: r.levels, 色: +(r.colors / r.levels).toFixed(1), 角砂糖: Math.round(r.sugar / r.levels), 箱: +(r.boxes / r.levels).toFixed(1), 予備1: r.fb1,
            クリア: (100 * r.won / r.runs).toFixed(0) + '%', はこび中央: q(0.5), はこび9割: q(0.9), ふつうの速さで秒: q(0.5) === null ? null : Math.round(q(0.5) * L.TICK_MS / 1000) };
        });
        console.log(`  AL12 自動プレイの表（絵：${kind}・各面 ${RUNS} 回）`);
        console.table(table);
        check('作れない面（予備 2・例外）が 0', failedGen === 0, failedGen);
        check('1・2 面は ゆるい遊び方で 100% クリア', first.length === 2 * RUNS && first.every(Boolean), first);
        check('表（参考）', true, table);
      });
    },
  },
  {
    id: 'AL13', tier: 'smoke', node: true, title: 'あまいものあつめ：絵の選び方 pickPicture（1〜48 面はずかんに関係なく同じ・49 面からくり返し・足した 49 枚目が先・壊れた book でも落ちない・ずかんが変わっても同じ pick なら同じ面）',
    async run({ check, root }) {
      const L = load(root);
      const PO = L.PICTURE_ORDER;
      const all1 = L.validateBook(J({ v: 1, got: Object.fromEntries(PO.map((p) => [p.id, 1])) }));
      const same = [];
      for (let lv = 1; lv <= 48; lv++) {
        const a = L.pickPicture(lv, null), b = L.pickPicture(lv, all1);
        if (!(a.id === PO[lv - 1].id && b.id === a.id && a.mirror === false && a.repeat === false && b.mirror === false)) same.push(lv);
      }
      check('1〜48 面は PICTURE_ORDER の順・ずかんに関係なく同じ・反転なし', same.length === 0, same);
      const p49 = L.pickPicture(49, all1);
      check('48 枚そろっていれば 49 面は くり返し（9 枚目・反転）', p49.id === PO[8].id && p49.mirror === true && p49.repeat === true, p49);
      const g = Object.fromEntries(PO.map((p) => [p.id, 2]));
      g[PO[20].id] = 1; g[PO[30].id] = 1;
      const pm = L.pickPicture(60, L.validateBook(J({ v: 1, got: g })));
      check('くり返しは回数の一番少ない絵（同じなら並びの前）', pm.id === PO[20].id && pm.repeat === true, pm);
      const g2 = Object.fromEntries(PO.map((p) => [p.id, 3]));
      g2[PO[3].id] = 1;   // 4 枚目（9 枚目より前）は くり返しに入らない
      check('9 枚目より前の絵は くり返しに入らない', L.pickPicture(70, L.validateBook(J({ v: 1, got: g2 }))).id === PO[8].id, L.pickPicture(70, L.validateBook(J({ v: 1, got: g2 }))));
      check('壊れた book・文字の book でも例外を出さない', (() => { try { return [null, '{', 5, { got: null }, { got: { ringo: 'x' } }, J({ v: 1, got: g })].every((b) => PO.some((p) => p.id === L.pickPicture(80, b).id)); } catch (e) { return false; } })(), null);
      check('文字の book（保存の生の値）も読める', L.pickPicture(60, J({ v: 1, got: g })).id === PO[20].id, null);
      // 49 枚目を足す（テストの中で足して、元に戻す）
      const extra = Object.freeze({ id: 'tesutoe', tier: 'M' });
      PO.push(extra);
      try {
        const p = L.pickPicture(49, all1);
        check('足した 49 枚目がずかんに無ければ、くり返しより先（反転なし・くり返しでない）', p.id === 'tesutoe' && p.mirror === false && p.repeat === false, p);
        const g3 = { ...Object.fromEntries(PO.map((q) => [q.id, 1])) };
        const p2 = L.pickPicture(49, L.validateBook(J({ v: 1, got: g3 })));
        check('足した絵もずかんにあれば くり返し（9 枚目から）', p2.repeat === true && p2.id === PO[8].id, p2);
        check('1〜48 面は足しても同じ', L.pickPicture(48, null).id === PO[47].id, null);
      } finally { PO.pop(); }
      check('足した絵を戻した', PO.length === 48, PO.length);
      await withPictures(L, () => {
        // くり返しの面は左右反転（cells が反転した絵）
        const pk = L.pickPicture(49, all1);
        const c = L.createLevel(49, pk);
        const pic = L.pictureById(pk.id, false);
        const mirrored = [];
        for (let y = 0; y < pic.H; y++) for (let x = 0; x < pic.W; x++) mirrored.push(pic.cells[y * pic.W + (pic.W - 1 - x)]);
        check('くり返しの面は左右反転した絵（state.mirror・cells）', c.state.mirror === true && c.state.repeat === true && J(c.state.cells) === J(mirrored) && J(c.state.cells) !== J(pic.cells), { mirror: c.state.mirror });
        check('くり返しの面は仕掛けが +1（params）', c.info.params.lids === L.TIERS[c.info.params.tier].lids + 1 && c.info.params.ices === L.TIERS[c.info.params.tier].ices + 1, c.info.params);
        // ずかんが変わっても、同じ level と pick なら同じ面
        const fixed = { id: PO[15].id, mirror: true, repeat: true };
        check('同じ level と pick の createLevel は、ずかんが変わっても同じ面', J(L.createLevel(52, fixed)) === J(L.createLevel(52, fixed)), null);
      });
    },
  },
  {
    id: 'AL14', tier: 'smoke', node: true, title: 'あまいものあつめ：「1手もどし なし！」の印 validateClean・addClean・hasClean（壊れた値・形ちがい・重複・知らない id を捨てる・足す・ある／ない・例外を出さない）',
    async run({ check, root }) {
      const L = load(root);
      const PO = L.PICTURE_ORDER, a = PO[0].id, b = PO[1].id;
      check('保存のキーは amai.clean', L.SAVE_KEY_CLEAN === 'amai.clean', L.SAVE_KEY_CLEAN);
      const bad = [null, undefined, '', '{', 5, [], 'x', J([]), J({ v: 2, ids: [a] }), J({ v: 1 }), J({ v: 1, ids: 'x' }), J({ v: 1, ids: { 0: a } })];
      check('壊れた値・形ちがいは空', bad.every((r) => J(L.validateClean(r)) === J({ ids: [] })), null);
      const v = L.validateClean(J({ v: 1, ids: [a, a, 'nanika', 5, null, b, a] }));
      check('重複・知らない id・文字でない値を捨てて使える分だけ（順は最初に出た順）', J(v) === J({ ids: [a, b] }), v);
      const s1 = L.addClean(null, a);
      check('足す：正しい形の文字列', s1 === J({ v: 1, ids: [a] }), s1);
      const s2 = L.addClean(s1, b);
      check('もう1つ足す', s2 === J({ v: 1, ids: [a, b] }), s2);
      check('同じ id をまた足しても増えない', L.addClean(s2, a) === s2, null);
      check('知らない id は足さず、元のまま正しい形で返す', L.addClean(s2, 'nanika') === s2 && L.addClean('{', 'nanika') === J({ v: 1, ids: [] }) && L.addClean(s2, 5) === s2, null);
      check('hasClean：ある／ない', L.hasClean(s2, a) === true && L.hasClean(s2, b) === true && L.hasClean(s1, b) === false && L.hasClean(null, a) === false && L.hasClean('{', a) === false, null);
    },
  },
  {
    id: 'AL15', tier: 'smoke', node: true, title: 'あまいものあつめ：箱の持ち玉の合計＝角砂糖の数（色ごと。1〜60 面・77・1000 面の最初と、解を再生するあいだ押すたび・はこぶたびに残りの角砂糖と一致・0 で終わる。崩れると絵が完成しない）',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        const book48 = L.validateBook(JSON.stringify({ v: 1, got: Object.fromEntries(L.PICTURE_ORDER.map((p) => [p.id, 1])) }));
        const levels = [];
        for (let lv = 1; lv <= 60; lv++) levels.push([lv, L.pickPicture(lv, null)]);
        levels.push([77, L.pickPicture(77, book48)], [1000, L.pickPicture(1000, book48)]);
        const badStart = [], badMid = [], badEnd = [];
        let checks = 0;
        for (const [lv, pk] of levels) {
          const c = L.createLevel(lv, pk);
          let s = c.state;
          const eq = (st) => J(sumByColor(st)) === J(sugarByColor(st));
          if (!eq(s) || allBoxes(s).reduce((a, b) => a + b.count, 0) !== s.total) badStart.push({ lv, boxes: sumByColor(s), sugar: sugarByColor(s) });
          // 解を再生しながら、1 手ごと・1 はこびごとに確かめる（全部の面だと重いので、1 面あたり最大 400 回まで）
          let n = 0;
          const guard = (st, what) => { if (n < 400 && !eq(st)) badMid.push({ lv, what, boxes: sumByColor(st), sugar: sugarByColor(st) }); n++; checks++; };
          for (const col of c.info.solution) {
            for (let i = 0; i < 5000; i++) { const r = L.step(s); if (!r.moved) break; s = r.state; guard(s, 'step'); }
            const r = L.press(s, col);
            if (r.outcome.kind !== 'press') break;
            s = r.state; guard(s, 'press');
          }
          for (let i = 0; i < 5000; i++) { const r = L.step(s); if (!r.moved) break; s = r.state; guard(s, 'step'); }
          if (!(s.won && s.left === 0 && Object.keys(sumByColor(s)).every((k) => sumByColor(s)[k] === 0))) badEnd.push({ lv, left: s.left, won: s.won, boxes: sumByColor(s) });
        }
        check(`最初の局面：色ごとの箱の持ち玉の合計＝角砂糖の数・全部の合計＝total（${kind}の絵・${levels.length} 面）`, badStart.length === 0, badStart);
        check(`解の再生中も、押すたび・はこぶたびに 箱＋わくの持ち玉の合計＝残りの角砂糖（色ごと。${checks} 回）`, badMid.length === 0, badMid.slice(0, 5));
        check('解を最後まで再生すると、残りの角砂糖 0・持ち玉 0・won', badEnd.length === 0, badEnd);
      });
    },
  },
  {
    id: 'AL16', tier: 'smoke', node: true, title: 'あまいものあつめ：はこびの間隔（120ms・はやおくり 60ms）・全段 1 はこびで 1 箱 1 個（carry は全面 1。carries は同じわくから 1 件ずつ）と、1・2 面は完全でたらめに遊んでも必ずクリアできる',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        // paramsFor の carry（表：段ごと）
        const cw = (lv, pk) => L.paramsFor(lv, pk).carry;
        const pc = [[1, 1], [5, 1], [13, 1], [25, 1], [37, 1], [48, 1]].map(([lv, want]) => ({ lv, want, got: cw(lv, L.pickPicture(lv, null)) }));
        check('carry：全段 1（1・5・13・25・37・48 面。もう 2 個運びは使わない）', pc.every((x) => x.got === x.want), pc);
        check('carry：くり返し（49 面から）も 1', cw(49, L.pickPicture(49, null)) === 1 && cw(1000, { id: L.PICTURE_ORDER[47].id, mirror: true, repeat: true }) === 1, null);
        // ユーザーの指摘の本体：1 つの箱から一定の短い間隔で次々に運ぶ（1 秒に約 8 匹）。間隔を 500ms に戻すと不合格
        check('はこびの間隔：TICK_MS 120・FAST_MS 60（1 秒に約 8 個）', L.TICK_MS === 120 && L.FAST_MS === 60 && Math.round(1000 / L.TICK_MS) === 8, { t: L.TICK_MS, f: L.FAST_MS });
        const base = L.createLevel(25, L.pickPicture(25, null)).state;
        check('createLevel の局面に carry が入る（XL・S とも 1）', base.carry === 1 && L.createLevel(1, L.pickPicture(1, null)).state.carry === 1, { xl: base.carry });
        // 実際の面で解を再生：1 はこびの carries を数える
        const stat = {};
        const bad = [];
        for (const lv of [3, 10, 20, 25, 30, 40, 48, 49, 60]) {
          const c = L.createLevel(lv, L.pickPicture(lv, null));
          const cap = c.state.carry;
          let s = c.state, max = 0, two = 0, one = 0;
          const tick = () => {
            for (let i = 0; i < 5000; i++) {
              const r = L.step(s);
              if (!r.moved) return;
              const per = {};
              for (const k of r.carries) per[k.slot] = (per[k.slot] || 0) + 1;
              const m = Math.max(...Object.values(per));
              max = Math.max(max, m);
              if (m === 2) two++; else one++;
              // 同じ色・同じわく・1 はこびの 1 箱の上限・left が carries の数だけ減る・同じマスを 2 度運ばない
              if (m > cap) bad.push({ lv, why: '1 箱が上限を超えて運んだ', per });
              if (r.state.left !== s.left - r.carries.length) bad.push({ lv, why: 'left の減りが carries と合わない' });
              if (new Set(r.carries.map((k) => k.cell)).size !== r.carries.length) bad.push({ lv, why: '同じマスを 2 度運んだ' });
              if (!r.carries.every((k) => k.color === s.slots[k.slot].color)) bad.push({ lv, why: '色がちがう' });
              for (const [k, n] of Object.entries(per)) if (n > s.slots[k].count) bad.push({ lv, why: '持ち玉より多く運んだ（残り 1 個の箱が 2 個運んだ）', slot: k });
              s = r.state;
            }
          };
          for (const col of c.info.solution) { tick(); const r = L.press(s, col); if (r.outcome.kind !== 'press') break; s = r.state; }
          tick();
          if (!s.won) bad.push({ lv, why: '解で終わらない' });
          stat[lv] = { cap, max, two, one };
        }
        check('解の再生：どの面でも 1 はこびの 1 箱は carry 個まで・left の減り＝carries の数・同じマスを 2 度運ばない', bad.length === 0, bad.slice(0, 5));
        const carryAll1 = Object.values(stat).every((x) => x.cap === 1 && x.max === 1 && x.two === 0 && x.one > 0);
        check('どの面でも 1 はこびで 1 箱から運ぶのは 1 個だけ（2 個運びが起きない・はこびは実際に起きる）', carryAll1, stat);
        // 1・2 面：完全でたらめ（押せる列をでたらめに・待つ・運ぶ。もどすは使わない）でも必ずクリアでき、うごかせなくならない
        const rnd = (seed) => rngOf(seed);
        const rows = [];
        for (const lv of [1, 2]) {
          const c = L.createLevel(lv, L.pickPicture(lv, null));
          let won = 0, stuck = 0;
          const N = 300;
          for (let k = 0; k < N; k++) {
            const r = rnd(k * 31 + lv);
            let s = c.state, g = 0;
            for (; g < 5000 && !s.won; g++) {
              if (L.isStuck(s)) { stuck++; break; }
              const cs = [0, 1, 2, 3].filter((x) => L.canPress(s, x) === null);
              if (cs.length && r() < 0.5) s = L.press(s, cs[Math.floor(r() * cs.length)]).state;
              else { const q = L.step(s); if (q.moved) s = q.state; else if (!cs.length) { stuck++; break; } }
            }
            if (s.won) won++;
          }
          rows.push({ lv, N, won, stuck });
        }
        check('1・2 面は完全でたらめに遊んでも 300 回すべてクリア（うごかせなくならない）', rows.every((x) => x.won === x.N && x.stuck === 0), rows);
      });
    },
  },
];

// ---- 単体で流す：node tests/cases/amai-logic.mjs [ID...] ----
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
