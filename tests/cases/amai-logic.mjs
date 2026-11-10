// AL: あまいものあつめの計算ロジック（Node で games/amai/logic.js を直接読む。ブラウザ不要）
//   契約は docs/ari-contract.md（§1 決まり・§2 面の作り方・§4 保存・§5.2 色と印・§6.2 API・§7.2 AL の項目）。
//   局面は契約 §4.1 の形を手で組み（mk）、validateState を通して使う。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・AmaiLogic を公開していなければ例外で不合格にする。
//   絵：本物の絵（pictures-a.js・pictures-b.js・pictures-c.js・pictures-d.js・pictures-e.js）の検査は AL2 だけ（無ければ AL2 は不合格）。
//       生成を確かめる項目（AL6・AL8・AL11・AL12・AL13）は、本物の 200 枚がそろっていればそれを使い、
//       そろっていなければテストの中で作った仮の絵（段の決まりを守る自動の絵）を AmaiPictures に入れて使う（終わったら元に戻す）。
//   単体でも流せる：node tests/cases/amai-logic.mjs [ID...]（最後の「単体で流す」を参照）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
const LET = { R: 0, O: 1, Y: 2, G: 3, S: 4, B: 5, P: 6, C: 7, W: 8, K: 9, D: 10, V: 11 };

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
const hasReal = (L) => L.PICTURE_ORDER.slice(0, 200).every((p) => L.pictureById(p.id, false));
// 本物の 200 枚がそろっていれば何もしない。そろっていなければ仮の絵を入れて fn を流し、元に戻す
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
    id: 'AL1', tier: 'smoke', node: true, title: 'あまいものあつめ：定数・COLORS（12 色。文字・hex・印・名前・5×5 の点がすべてちがう）・NAME・paramsFor が §2.1 の表どおり（境界・壊れた値）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'あまいものあつめ', SLOTS: 3, COLS: 4, TICK_MS: 120, FAST_MS: 60, MAX_W: 64, MAX_H: 48, MAX_SUGAR: 3072, MAX_COUNT: 99, MAX_PRESSES: 400, MAX_T: 5000,
        GEN_TRIES: 20, GEN_WORK: 400000, BASE_PICTURES: 200, REPEAT_FROM: 9,
        SAVE_KEY_SAVE: 'amai.save', SAVE_KEY_BEST: 'amai.best', SAVE_KEY_BOOK: 'amai.book', SAVE_KEY_HELP: 'amai.help', SAVE_KEY_FAST: 'amai.fast' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §6.2 のとおり', kBad.length === 0, kBad);
      // 手直し（2026-10-30）：絵を 2×2 に割って 64×48・角砂糖 2800 まで（2026-11-05 に背景を足すため 3072＝64×48 まで）、はこびの間隔を 500→120ms にした。
      // ANY_RATE（①を使う箱の割合）は段ごとの表。M 0.5（2026-11-03）・XL・XXL 0.25、ほかは 1（OVER が 1 の段では使われない）
      // 2026-11-05（背景をうめた 148 枚。計画書 amai-bg.md §6）：S 1 → 0.5・M 0.5 → 0.3
      check('ANY_RATE（①を使う箱の割合）が表どおり（S 0.5、M 0.3、L・くり返し 1、XL・XXL 0.25）', J(L.ANY_RATE) === J({ S: 0.5, M: 0.3, L: 1, XL: 0.25, XXL: 0.25, repeat: 1 }), L.ANY_RATE);
      check('はこびの間隔：ふだん 120ms・はやおくり 60ms（1 つの箱から 1 秒に約 8 匹）', L.TICK_MS === 120 && L.FAST_MS === 60 && L.FAST_MS * 2 === L.TICK_MS, { t: L.TICK_MS, f: L.FAST_MS });
      const C = L.COLORS;
      check('COLORS は 12 色で id が 0〜11・凍結（2026-11-05 に D こいみどり・V むらさき を足した）', Array.isArray(C) && C.length === 12 && C.every((c, i) => c.id === i) && Object.isFrozen(C) && C.every((c) => Object.isFrozen(c)), C);
      const want = [['R', 'red', 'あか', '#E23B3B', 'circle'], ['O', 'orange', 'オレンジ', '#F28C28', 'triangle'], ['Y', 'yellow', 'きいろ', '#F2D13A', 'star'], ['G', 'green', 'みどり', '#3E9E4F', 'diamond'],
        ['S', 'sky', 'みずいろ', '#78C6EE', 'plus'], ['B', 'blue', 'あお', '#2E5BC9', 'cross'], ['P', 'pink', 'ピンク', '#F29BC2', 'heart'], ['C', 'brown', 'ちゃいろ', '#8B5A33', 'bars'],
        ['W', 'white', 'しろ', '#F5F2EA', 'ring'], ['K', 'black', 'くろ', '#2B2B33', 'stripes'],
        ['D', 'darkgreen', 'こいみどり', '#1F5E35', 'moon'], ['V', 'purple', 'むらさき', '#8A5CC8', 'drop']];
      check('文字・key・名前・hex・印が §5.2 の表どおり', C.every((c, i) => J([c.letter, c.key, c.name, c.hex, c.mark]) === J(want[i])), C.map((c) => [c.letter, c.key, c.name, c.hex, c.mark]));
      const uniq = (f) => new Set(C.map(f)).size === C.length;
      check('文字・key・名前・hex・印・5×5 の点がすべてちがう', uniq((c) => c.letter) && uniq((c) => c.key) && uniq((c) => c.name) && uniq((c) => c.hex) && uniq((c) => c.mark) && uniq((c) => c.dots.join('/')), null);
      check('5×5 の点は 5 行 × 5 文字（# と . だけ）', C.every((c) => c.dots.length === 5 && c.dots.every((r) => /^[#.]{5}$/.test(r))), C.map((c) => c.dots));
      check('colorName', L.colorName(0) === 'あか' && L.colorName(9) === 'くろ' && L.colorName(10) === 'こいみどり' && L.colorName(11) === 'むらさき' && L.colorName(12) === '' && L.colorName('x') === '', null);
      // §2.1 の表（1〜200 面は PICTURE_ORDER の絵で。49〜100 面は 2026-11-03、101〜150 面は 2026-11-04、151〜200 面は 2026-11-09 に足した XXL）
      // 箱の数の幅は TIERS の値。ただし段ごとの上書き KSET・くり返しの REPEAT_K があればそれ（logic.js が公開する表を読む。表の持ち主は logic.js）
      const KR = (tier) => (L.KSET && L.KSET[tier]) || [L.TIERS[tier].kmin, L.TIERS[tier].kmax];
      const T = (lv, tier, kmin, kmax, pull, lids, ices) => ({ lv, tier, kmin: KR(tier)[0], kmax: KR(tier)[1], pull: pull + ((L.PULL_ADD && L.PULL_ADD[tier]) || 0), lids, ices });   // pull は段の値＋PULL_ADD（2026-11-03 に L・XL・XXL を 0 にした）
      const table = [
        T(1, 'S', 15, 25, 0, 0, 0), T(2, 'S', 15, 25, 0, 0, 0), T(4, 'S', 15, 25, 0, 0, 0),
        T(5, 'M', 10, 25, 2, 0, 0), T(8, 'M', 10, 25, 2, 0, 0), T(9, 'M', 10, 25, 2, 1, 0), T(12, 'M', 10, 25, 2, 1, 0),
        T(13, 'L', 10, 30, 4, 1, 0), T(18, 'L', 10, 30, 4, 1, 0), T(19, 'L', 10, 30, 4, 2, 1), T(24, 'L', 10, 30, 4, 2, 1),
        T(25, 'XL', 10, 30, 8, 3, 1), T(30, 'XL', 10, 30, 8, 3, 1), T(31, 'XL', 10, 30, 8, 3, 2), T(36, 'XL', 10, 30, 8, 3, 2),
        T(37, 'XXL', 10, 30, 12, 4, 3), T(48, 'XXL', 10, 30, 12, 4, 3), T(49, 'XXL', 10, 30, 12, 4, 3), T(100, 'XXL', 10, 30, 12, 4, 3), T(101, 'XXL', 10, 30, 12, 4, 3), T(150, 'XXL', 10, 30, 12, 4, 3),
        T(151, 'XXL', 10, 30, 12, 4, 3), T(200, 'XXL', 10, 30, 12, 4, 3),
      ];
      const bad = [];
      for (const r of table) {
        const pk = L.pickPicture(r.lv, null);
        const p = L.paramsFor(r.lv, pk);
        const ok = p && p.tier === r.tier && p.kmin === r.kmin && p.kmax === r.kmax && p.pull === r.pull && p.lids === r.lids && p.ices === r.ices && p.picture === L.PICTURE_ORDER[r.lv - 1].id && p.mirror === false && p.repeat === false;
        if (!ok) bad.push({ want: r, got: p });
      }
      check('1〜200 面の境界（1・2・4・5・8・9・12・13・18・19・24・25・30・31・36・37・48・49・100・101・150・151・200）が表どおり', bad.length === 0, bad);
      // 201 面から：くり返し（ずかんに 200 枚そろっていれば 9 枚目＝M の段）。段の値 +（k は REPEAT_K・pull +2・多い方 +1）
      // （ずかんが空なら、3 枚目からの 0 回の絵が反転せずに先に出る。§2.7。2026-11-03 に変えた）
      const all48 = L.validateBook(J({ v: 1, got: Object.fromEntries(L.PICTURE_ORDER.map((p) => [p.id, 1])) }));
      const p49 = L.paramsFor(201, L.pickPicture(201, all48));
      check('201 面（くり返し・9 枚目 M）：k は REPEAT_K の幅・pull 4・lids 2・ices 1・反転', p49.repeat === true && p49.mirror === true && p49.tier === 'M' && p49.kmin === L.REPEAT_K.kmin && p49.kmax === L.REPEAT_K.kmax && p49.pull === 4 && p49.lids === 2 && p49.ices === 1 && p49.picture === L.PICTURE_ORDER[8].id, p49);
      const pX = L.paramsFor(1000, { id: L.PICTURE_ORDER[47].id, mirror: true, repeat: true });
      check('1000 面（くり返し・XXL の絵）：pull 14・lids 5・ices 4', pX.tier === 'XXL' && pX.pull === 14 && pX.lids === 5 && pX.ices === 4 && pX.kmin === L.REPEAT_K.kmin && pX.kmax === L.REPEAT_K.kmax, pX);
      const pA = L.paramsFor(210, { id: L.PICTURE_ORDER[30].id, mirror: false, repeat: false });
      check('201 面から（足した絵の扱い・くり返しでない）：その絵の段の行・lids・ices は段の多い方', pA.tier === 'XL' && pA.kmin === KR('XL')[0] && pA.kmax === KR('XL')[1] && pA.pull === 8 + L.PULL_ADD.XL && pA.lids === 3 && pA.ices === 2 && pA.repeat === false, pA);
      // 壊れた値は 1 面
      const one = J(L.paramsFor(1, null));
      const broken = [0, -3, NaN, Infinity, 'abc', null, undefined, {}, 1.7].map((v) => ({ v: String(v), same: J(L.paramsFor(v, null)) === one }));
      check('壊れた level は 1 面（0・-3・NaN・Infinity・文字・null・undefined・{}）と 1.7→1', broken.every((b) => b.same), broken);
      check('PICTURE_ORDER に無い pick は、その面の絵に置きかえる', J(L.paramsFor(3, { id: 'nai', mirror: true })) === J(L.paramsFor(3, null)), L.paramsFor(3, { id: 'nai' }));
      check('LEVELS が配列', Array.isArray(L.LEVELS) && L.LEVELS.length > 0, L.LEVELS);
      // PICTURE_ORDER（§2.6 の表の段）
      const PO = L.PICTURE_ORDER;
      const tiers = PO.slice(0, 200).map((p) => p.tier).join(',');
      const wantT = [...Array(4).fill('S'), ...Array(8).fill('M'), ...Array(12).fill('L'), ...Array(12).fill('XL'), ...Array(164).fill('XXL')].join(',');
      check('PICTURE_ORDER は 200 枚・段が 4/8/12/12/164・id は英小文字だけで重ならない', PO.length >= 200 && tiers === wantT && PO.every((p) => /^[a-z]+$/.test(p.id)) && new Set(PO.map((p) => p.id)).size === PO.length, PO);
      // 3〜48 面は場面の絵（計画書 docs/plans/amai-redraw.md §4。見本 3 枚は L・XL・XXL の最初の面）
      check('1 枚目 ringo・2 枚目 sakuranbo・3 枚目 nekoyukiyamaoyatsu・13 枚目 nekokouenbooru・25 枚目 usagiumibenemuru・37 枚目 kumadaidokorooyatsu・48 枚目 kumaumibeoyatsu',
        PO[0].id === 'ringo' && PO[1].id === 'sakuranbo' && PO[2].id === 'nekoyukiyamaoyatsu' && PO[12].id === 'nekokouenbooru' && PO[24].id === 'usagiumibenemuru' && PO[36].id === 'kumadaidokorooyatsu' && PO[47].id === 'kumaumibeoyatsu', PO.map((p) => p.id));
      // 49〜100 面は足した 52 枚（計画書 docs/plans/amai-more.md §2）
      check('49 枚目 kumamorioyatsu・100 枚目 nekodaidokorooekaki（49〜100 面は足した 52 枚）', PO[48].id === 'kumamorioyatsu' && PO[99].id === 'nekodaidokorooekaki', PO.slice(48).map((p) => p.id));
      // 101〜150 面は足した 50 枚（計画書 docs/plans/amai-more2.md §1）
      check('101 枚目 pandahanabatakebooru・150 枚目 nekohanabatakeoekaki（101〜150 面は足した 50 枚）', PO[100].id === 'pandahanabatakebooru' && PO[149].id === 'nekohanabatakeoekaki', PO.slice(100).map((p) => p.id));
      // 151〜200 面は部品で描いた 50 枚（計画書 docs/plans/amai-parts.md §8）
      check('151 枚目 penginmachihon・200 枚目 pandayukiyamajitensha（151〜200 面は足した 50 枚）', PO[150].id === 'penginmachihon' && PO[199].id === 'pandayukiyamajitensha', PO.slice(150).map((p) => p.id));
      const OLD = ['sakura', 'ichigo', 'kinoko', 'suika', 'yukidaruma', 'momiji', 'kumatofuusen', 'kanransha'];
      check('描き直す前の古い id（sakura・ichigo …）は PICTURE_ORDER に無い', OLD.every((id) => !PO.some((p) => p.id === id)), OLD.filter((id) => PO.some((p) => p.id === id)));
    },
  },
  {
    id: 'AL2', tier: 'smoke', node: true, title: 'あまいものあつめ：本物の絵（pictures-a.js・pictures-b.js・pictures-c.js・pictures-d.js・pictures-e.js、200 枚以上）が §2.6 の決まりを守る・PICTURE_ORDER の id がちょうど 1 回ずつ・季節・parsePicture が決まりを破った絵で null・Date を使わない',
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
        // 角砂糖の上限は 2026-11-05 に 3072（＝64×48）へ上げたので、大きさの決まりの中では超えられない（64×48 を埋めた絵が読めることは AL21）
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
      const files = ['logic.js', 'pictures-a.js', 'pictures-b.js', 'pictures-c.js', 'pictures-d.js', 'pictures-e.js'].map((f) => path.join(root, 'games/amai', f));
      const useDate = files.filter((f) => fs.existsSync(f) && /\bDate\b|Math\.random|localStorage/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
      check('logic.js・pictures-*.js に Date・Math.random・localStorage が無い', useDate.length === 0, useDate);
      // 本物の絵
      const missingFiles = ['pictures-a.js', 'pictures-b.js', 'pictures-c.js', 'pictures-d.js', 'pictures-e.js'].filter((f) => !fs.existsSync(path.join(root, 'games/amai', f)));
      check('pictures-a.js・pictures-b.js・pictures-c.js・pictures-d.js・pictures-e.js がある', missingFiles.length === 0, missingFiles);
      const P = globalThis.AmaiPictures;
      check('AmaiPictures（add・byId）がある', !!P && typeof P.add === 'function' && !!P.byId, P ? Object.keys(P) : P);
      if (!P || missingFiles.length) return;
      const PO = L.PICTURE_ORDER;
      const defs = PO.map((p) => ({ p, d: typeof P.byId === 'function' ? P.byId(p.id) : P.byId[p.id] }));
      const missing = defs.filter((x) => !x.d).map((x) => x.p.id);
      check('PICTURE_ORDER の絵がすべてある（200 枚以上）', PO.length >= 200 && missing.length === 0, missing);
      // 5 つのファイルにちょうど 1 回ずつ（ファイルの文字から id を数える）
      const src = ['pictures-a.js', 'pictures-b.js', 'pictures-c.js', 'pictures-d.js', 'pictures-e.js'].map((f) => fs.readFileSync(path.join(root, 'games/amai', f), 'utf8')).join('\n');
      const ids = [...src.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const cnt = {}; for (const id of ids) cnt[id] = (cnt[id] || 0) + 1;
      const notOnce = PO.filter((p) => cnt[p.id] !== 1).map((p) => ({ id: p.id, n: cnt[p.id] || 0 }));
      check('PICTURE_ORDER の id が 5 つのファイルにちょうど 1 回ずつ', notOnce.length === 0, notOnce);
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
      // 季節（計画書 amai-redraw.md §4・amai-more.md §2・amai-more2.md §1・amai-parts.md §8）：ゆきやま＝fuyu・うみべ＝natsu・はなばたけ＝haru・ほか＝""（まち・ゆうえんち・ほしぞらも ""）
      const wantSeason = (id) => (/yukiyama/.test(id) ? 'fuyu' : /umibe/.test(id) ? 'natsu' : /hanabatake/.test(id) ? 'haru' : '');
      const badSeason = defs.filter(({ p, d }) => d && d.season !== wantSeason(p.id)).map(({ p, d }) => `${p.id}:${d.season}`);
      check('季節は ゆきやまの絵＝fuyu・うみべの絵＝natsu・はなばたけの絵＝haru・ほか＝""（はる・なつ・ふゆ それぞれ 3 枚以上）', badSeason.length === 0 && season.haru >= 3 && season.natsu >= 3 && season.fuyu >= 3, { badSeason, season });
      const need = ['nekokouenbooru', 'usagiumibenemuru', 'kumadaidokorooyatsu'];
      check('見本 3 枚（こうえんの ねこ・うみべの うさぎ・だいどころの くま）がある', need.every((id) => defs.some((x) => x.p.id === id && x.d)), need);
      // 3〜200 面の絵は 1 マス＝1 粒で描いた場面（2×2 に割った地図でない）：2×2 のかたまりの区切りに合わない色の境目がある
      const notSplit = [];
      for (const { p, d } of defs.slice(2)) {
        const q = d && L.parsePicture(d, false);
        if (!q) continue;
        let odd = 0;
        for (let y = 0; y < q.H; y++) for (let x = 1; x < q.W; x += 2) if (q.cells[y * q.W + x] !== q.cells[y * q.W + x - 1]) odd++;
        if (odd === 0) notSplit.push(p.id);
      }
      check('3〜200 面の絵は 2×2 に割った地図でない（1 マス＝1 粒）', notSplit.length === 0, notSplit);
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
        levels.push([77, L.pickPicture(77, L.validateBook(book48))]);   // 77 面は 49〜100 面に足した絵（ずかんに関係なく同じ）
        levels.push([100, L.pickPicture(100, null)], [125, L.pickPicture(125, null)], [150, L.pickPicture(150, null)], [175, L.pickPicture(175, null)], [200, L.pickPicture(200, null)], [201, L.pickPicture(201, L.validateBook(book48))]);   // 足した絵（101〜150 面は 2026-11-04）・足した最後の絵・くり返しの最初
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
          // 1・2 面の箱の上限は 5 のまま（1・2 面の絵だけは割っていない＝元の大きさなので。logic.js の EASY_BOXES = 5）
          if (lv <= 2 && allBoxes(s).length > 5) why.push('1・2 面の箱が 5 個より多い');
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
        check('1〜60 面・77 面・100 面・125 面・150 面・175 面・200 面・201 面と 1000 面（くり返し）がすべて決まりを守る', bad.length === 0, bad);
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
        // 201 面・202 面は、ずかんが空なら同じ絵（3 枚目）になる
        const q101 = L.pickPicture(201, null), q102 = L.pickPicture(202, null);
        check('面がちがえば箱の配り方がちがう（201 面と 202 面は同じ絵でもちがう）', q101.id === q102.id && J(L.createLevel(201, q101).state.cols) !== J(L.createLevel(202, q102).state.cols), { q101, q102 });
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
      const good = { v: 1, level: 7, pic: 'inuumibeoyatsu', mirror: false, rep: false, presses: [[0, 2], [0, 1], [12, 3]], t: 41 };
      const g = L.validateSave(J(good));
      check('validateSave：正しい形', g && g.level === 7 && J(g.pick) === J({ id: 'inuumibeoyatsu', mirror: false, repeat: false }) && J(g.presses) === J(good.presses) && g.t === 41, g);
      const badSaves = {
        '壊れた JSON': '{"v":1,', 'JSON でない': 'abc', 'v ちがい': J({ ...good, v: 2 }), 'level 0': J({ ...good, level: 0 }), 'level 1.5': J({ ...good, level: 1.5 }),
        'pic が英小文字でない': J({ ...good, pic: 'Inuumibeoyatsu' }), 'pic が無い': J({ ...good, pic: undefined }), 'mirror が文字': J({ ...good, mirror: 'false' }), 'rep が無い': J({ ...good, rep: undefined }),
        'presses が配列でない': J({ ...good, presses: {} }), '手の形ちがい（長さ 3）': J({ ...good, presses: [[0, 1, 2]] }), '手の形ちがい（文字）': J({ ...good, presses: [['0', 1]] }),
        '列 4': J({ ...good, presses: [[0, 4]] }), '列 -1': J({ ...good, presses: [[0, -1]] }), 't が負': J({ ...good, presses: [[-1, 0]] }),
        't の逆順': J({ ...good, presses: [[5, 0], [3, 1]] }), '長すぎ': J({ ...good, presses: Array(401).fill([0, 0]) }), 't > MAX_T': J({ ...good, t: 5001, presses: [] }),
        '最後の手の t が保存の t より大きい': J({ ...good, presses: [[50, 0]], t: 41 }), '配列': '[]', 'null': 'null', '数': '5',
      };
      const passed = Object.entries(badSaves).filter(([, raw]) => L.validateSave(raw) !== null).map(([k]) => k);
      check('validateSave：壊れた保存は null（' + Object.keys(badSaves).length + ' 通り）', passed.length === 0, passed);
      check('validateSave：文字でない引数は null', L.validateSave(null) === null && L.validateSave(good) === null, null);
      check('validateSave：手 400 個・t 5000 は読める', L.validateSave(J({ ...good, presses: Array(400).fill([0, 0]), t: 5000 })) !== null, null);
      const ms = L.makeSave(7, { id: 'inuumibeoyatsu', mirror: false, repeat: false }, [[0, 2], [12, 3]], 41);
      check('makeSave の形（v・level・pic・mirror・rep・presses・t・picSig）と往復', (() => { const o = JSON.parse(ms); const { picSig, ...rest } = o; return J(rest) === J({ v: 1, level: 7, pic: 'inuumibeoyatsu', mirror: false, rep: false, presses: [[0, 2], [12, 3]], t: 41 }) && typeof picSig === 'string'; })() && L.validateSave(ms) !== null, ms);
      check('makeSave：くり返しの pick（mirror・rep が true）', (() => { const o = JSON.parse(L.makeSave(50, { id: 'usagikouennemuru', mirror: true, repeat: true }, [], 0)); return o.mirror === true && o.rep === true && o.pic === 'usagikouennemuru'; })(), null);
      // ずかん
      const raw = J({ v: 1, got: { ringo: 2, sakura: 'x', ichigo: 0, Kame: 3, momiji: 10000, nai: 4, suika: 1.5, inuumibeoyatsu: 9999 } });
      const vb = L.validateBook(raw);
      check('validateBook：壊れた項目だけ捨て、ほか（PICTURE_ORDER に無い id も）は残す', J({ ...vb.got }) === J({ ringo: 2, nai: 4, inuumibeoyatsu: 9999 }), { ...vb.got });
      const empt = ['{', 'null', '[]', J({ v: 2, got: { ringo: 1 } }), J({ v: 1, got: [] }), J({ v: 1 }), '', null, 5].map((r) => Object.keys(L.validateBook(r).got).length);
      check('validateBook：全体が壊れていれば空', empt.every((n) => n === 0), empt);
      check('validateBook：constructor などの名前でも壊れない', (() => { const b = L.validateBook(J({ v: 1, got: { constructor: 2 } })); return b.got.constructor === 2 && L.bookCount(J({ v: 1, got: {} })) === 0; })(), null);
      const ab = JSON.parse(L.addToBook(raw, 'ringo'));
      check('addToBook：1 足す・ほかの絵を消さない', ab.v === 1 && ab.got.ringo === 3 && ab.got.nai === 4 && ab.got.inuumibeoyatsu === 9999, ab);
      check('addToBook：9999 で止まる', JSON.parse(L.addToBook(raw, 'inuumibeoyatsu')).got.inuumibeoyatsu === 9999, null);
      check('addToBook：壊れた book なら新しく 1', J(JSON.parse(L.addToBook('{', 'ringo'))) === J({ v: 1, got: { ringo: 1 } }), null);
      check('addToBook：おかしな id は足さない（消しもしない）', J(JSON.parse(L.addToBook(raw, 'Bad1')).got) === J({ ringo: 2, nai: 4, inuumibeoyatsu: 9999 }), null);
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
        tryIt('pictureSig', () => L.pictureSig(a));
        tryIt('saveFits', () => L.saveFits(a));
        tryIt('colorName', () => L.colorName(a));
      }
      tryIt('press（列がおかしい）', () => { for (const c of odd) L.press(s, c); });
      tryIt('createLevel（壊れた level）', () => { L.createLevel('abc', null); L.createLevel(-5, { id: 5 }); });
      tryIt('replay（おかしな手）', () => { const r = L.replay(1, null, [[0, 'x'], null], 3); if (r.ok !== false) throw new Error('ok'); L.replay(1, null, 'x', 'y'); });
      check('例外を出さない（' + odd.length + ' 通りの引数 × 公開の関数）', thrown.length === 0, thrown.slice(0, 10));
      check('hud が局面の値をそのまま', J(L.hud(r2.state)) === J({ level: 7, left: r2.state.left, total: 8, presses: 1, carried: 8 - r2.state.left }), L.hud(r2.state));
      // わくは 3 つ（ふつう）か 2 つ（ちょうせん。2026-11-05）だけ。1 つ・4 つは壊れた局面
      check('validateState：壊れた局面は null（cells の長さ・left の食いちがい・列が 3 つ・わくが 1 つ・4 つ・id の重なり・数 0）', [
        { ...plain, cells: plain.cells.slice(1) }, { ...plain, left: 3 }, { ...plain, cols: plain.cols.slice(1) }, { ...plain, slots: plain.slots.slice(2) }, { ...plain, slots: [...plain.slots, null] },
        { ...plain, cols: [[{ id: 1, color: 0, count: 2, lid: false, ice: 0 }], [{ id: 1, color: 0, count: 2, lid: false, ice: 0 }], [], []] },
        { ...plain, slots: [{ id: 99, color: 0, count: 0 }, ...Array(L.SLOTS - 1).fill(null)] }, { ...plain, won: true },
      ].every((x) => L.validateState(x) === null), null);
    },
  },
  {
    id: 'AL11', tier: 'full', flaky: { why: 'Node で面の生成の時間を測る', checks: /≦ \d+ms/ }, node: true, solo: true, title: 'あまいものあつめ：性能（1〜60 面と 1000 面の生成の合計が Node で 3 秒以内・1〜212 面と 1000 面の 1 面 250ms 以内・一番大きい絵の面で解を最後まで再生して 150ms 以内）',
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
          const pk = L.pickPicture(lv, lv > L.BASE_PICTURES ? book48 : null);
          const a = cpuOf();
          L.createLevel(lv, pk);
          per.push({ lv, ms: +cpuMs(cpuOf(a)).toFixed(2) });
        }
        const total = cpuMs(cpuOf(t0));
        // 49〜200 面に足した絵（2026-11-03・2026-11-04・2026-11-09）と、くり返しの最初（201〜212 面）も 1 面ずつ測る（合計には入れない＝合計の基準は今までと同じ 61 面）
        for (let lv = 61; lv <= 212; lv++) {
          const pk = L.pickPicture(lv, lv > L.BASE_PICTURES ? book48 : null);
          const a = cpuOf();
          L.createLevel(lv, pk);
          per.push({ lv, ms: +cpuMs(cpuOf(a)).toFixed(2) });
        }
        const worst = per.reduce((m, x) => (x.ms > m.ms ? x : m), per[0]);
        // 実測 1.4〜1.7 秒（絵を割る前は約 0.6 秒）。他のテストと並んで流れても落ちないよう 2000 → 3000ms にした
        check(`生成の合計 ${total.toFixed(0)}ms ≦ 3000ms`, total <= 3000, total);
        // 手直し（2026-10-30）で面の作り方が「解ける押し順を探して確かめる」方式に変わり、1 面の生成が重くなった（中央 10ms・最大 95ms）。
        // 基準を 50 → 100ms にゆるめた。実機（iPhone SE 第2世代）で面の始めに止まらないかは試作で確かめる（docs/plans/amai-rework.md §13）
        // 手直し（2026-10-30・絵を 2×2 に割った）：マスが 4 倍（最大 64×48）になり、生成の探索も入るので 1 面の生成が重くなった
        // （中央 16〜21ms・最大 160〜210ms）。基準を 100 → 250ms にゆるめた（実測の最大 210ms に余裕を足した値）。
        // 実機（iPhone SE 第2世代）で面の始めに止まらないかは試作で確かめる。
        check(`1 面の最大 ${worst.ms}ms（${worst.lv} 面）≦ 250ms`, worst.ms <= 250, per.filter((x) => x.ms > 100));
        // 一番大きい絵の面（角砂糖が一番多い 37〜200 面。49〜200 面は 2026-11-03・2026-11-04・2026-11-09 に足した XXL）で解を最後まで再生
        let big = null;
        for (let lv = 37; lv <= 200; lv++) { const c = L.createLevel(lv, null); if (!big || c.state.total > big.state.total) big = c; }
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
        for (let lv = 1; lv <= L.BASE_PICTURES; lv++) {
          // 1〜48 面は全部、足した 49〜200 面は 4 面ごと（49・53 … 197。全部だと長くかかるので）
          if (lv > 48 && (lv - 49) % 4 !== 0) continue;
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
    id: 'AL13', tier: 'smoke', node: true, title: 'あまいものあつめ：絵の選び方 pickPicture（1〜200 面はずかんに関係なく同じ・201 面からくり返し・足した 201 枚目が先・壊れた book でも落ちない・ずかんが変わっても同じ pick なら同じ面）',
    async run({ check, root }) {
      const L = load(root);
      const PO = L.PICTURE_ORDER;
      const all1 = L.validateBook(J({ v: 1, got: Object.fromEntries(PO.map((p) => [p.id, 1])) }));
      const same = [];
      for (let lv = 1; lv <= 200; lv++) {
        const a = L.pickPicture(lv, null), b = L.pickPicture(lv, all1);
        if (!(a.id === PO[lv - 1].id && b.id === a.id && a.mirror === false && a.repeat === false && b.mirror === false)) same.push(lv);
      }
      check('1〜200 面は PICTURE_ORDER の順・ずかんに関係なく同じ・反転なし', same.length === 0, same);
      const p49 = L.pickPicture(201, all1);
      check('200 枚そろっていれば 201 面は くり返し（9 枚目・反転）', p49.id === PO[8].id && p49.mirror === true && p49.repeat === true, p49);
      const g = Object.fromEntries(PO.map((p) => [p.id, 2]));
      g[PO[20].id] = 1; g[PO[30].id] = 1;
      const pm = L.pickPicture(210, L.validateBook(J({ v: 1, got: g })));
      check('くり返しは回数の一番少ない絵（同じなら並びの前）', pm.id === PO[20].id && pm.repeat === true, pm);
      const g2 = Object.fromEntries(PO.map((p) => [p.id, 3]));
      g2[PO[3].id] = 1;   // 4 枚目（9 枚目より前）は くり返しに入らない
      // 絵を描き直して id が替わった人（ずかんに新しい絵が 0 回）：3〜200 枚目の 0 回の絵を、反転せずに先に出す（計画書 amai-redraw.md §8.2）
      const g0 = Object.fromEntries(PO.map((p) => [p.id, 2]));
      g0[PO[1].id] = 0; g0[PO[5].id] = 0; g0[PO[30].id] = 0;   // 2 枚目（やさしい面だけの絵）は先に出さない
      const p0 = L.pickPicture(205, L.validateBook(J({ v: 1, got: g0 })));
      check('ずかんに 0 回の絵（3 枚目から）があれば、その一番前を反転せずに先に出す（くり返しでない）', p0.id === PO[5].id && p0.mirror === false && p0.repeat === false, p0);
      check('9 枚目より前の絵は くり返しに入らない', L.pickPicture(220, L.validateBook(J({ v: 1, got: g2 }))).id === PO[8].id, L.pickPicture(220, L.validateBook(J({ v: 1, got: g2 }))));
      check('壊れた book・文字の book でも例外を出さない', (() => { try { return [null, '{', 5, { got: null }, { got: { ringo: 'x' } }, J({ v: 1, got: g })].every((b) => PO.some((p) => p.id === L.pickPicture(230, b).id)); } catch (e) { return false; } })(), null);
      check('文字の book（保存の生の値）も読める', L.pickPicture(210, J({ v: 1, got: g })).id === PO[20].id, null);
      // 201 枚目を足す（テストの中で足して、元に戻す）
      const extra = Object.freeze({ id: 'tesutoe', tier: 'M' });
      PO.push(extra);
      try {
        const p = L.pickPicture(201, all1);
        check('足した 201 枚目がずかんに無ければ、くり返しより先（反転なし・くり返しでない）', p.id === 'tesutoe' && p.mirror === false && p.repeat === false, p);
        const g3 = { ...Object.fromEntries(PO.map((q) => [q.id, 1])) };
        const p2 = L.pickPicture(201, L.validateBook(J({ v: 1, got: g3 })));
        check('足した絵もずかんにあれば くり返し（9 枚目から）', p2.repeat === true && p2.id === PO[8].id, p2);
        check('1〜200 面は足しても同じ', L.pickPicture(200, null).id === PO[199].id, null);
      } finally { PO.pop(); }
      check('足した絵を戻した', PO.length === 200, PO.length);
      await withPictures(L, () => {
        // くり返しの面は左右反転（cells が反転した絵）
        const pk = L.pickPicture(201, all1);
        const c = L.createLevel(201, pk);
        const pic = L.pictureById(pk.id, false);
        const mirrored = [];
        for (let y = 0; y < pic.H; y++) for (let x = 0; x < pic.W; x++) mirrored.push(pic.cells[y * pic.W + (pic.W - 1 - x)]);
        check('くり返しの面は左右反転した絵（state.mirror・cells）', c.state.mirror === true && c.state.repeat === true && J(c.state.cells) === J(mirrored) && J(c.state.cells) !== J(pic.cells), { mirror: c.state.mirror });
        check('くり返しの面は仕掛けが +1（params）', c.info.params.lids === L.TIERS[c.info.params.tier].lids + 1 && c.info.params.ices === L.TIERS[c.info.params.tier].ices + 1, c.info.params);
        // ずかんが変わっても、同じ level と pick なら同じ面
        const fixed = { id: PO[15].id, mirror: true, repeat: true };
        check('同じ level と pick の createLevel は、ずかんが変わっても同じ面', J(L.createLevel(152, fixed)) === J(L.createLevel(152, fixed)), null);
      });
    },
  },
  {
    id: 'AL14', tier: 'smoke', node: true, title: 'あまいものあつめ：「1手もどし なし！」の印 validateClean・addClean・hasClean（壊れた値・形ちがい・重複・壊れた id を捨てる・知らない id は残す・足す・ある／ない・例外を出さない）',
    async run({ check, root }) {
      const L = load(root);
      const PO = L.PICTURE_ORDER, a = PO[0].id, b = PO[1].id;
      check('保存のキーは amai.clean', L.SAVE_KEY_CLEAN === 'amai.clean', L.SAVE_KEY_CLEAN);
      const bad = [null, undefined, '', '{', 5, [], 'x', J([]), J({ v: 2, ids: [a] }), J({ v: 1 }), J({ v: 1, ids: 'x' }), J({ v: 1, ids: { 0: a } })];
      check('壊れた値・形ちがいは空', bad.every((r) => J(L.validateClean(r)) === J({ ids: [] })), null);
      const v = L.validateClean(J({ v: 1, ids: [a, a, 'nanika', 5, null, b, a, 'Bad1', '', 'x'.repeat(65), 'nanika'] }));
      check('重複・壊れた id（英小文字でない・空・65 字）・文字でない値を捨て、PICTURE_ORDER に無い id（古い絵の id）は残す（順は最初に出た順）', J(v) === J({ ids: [a, 'nanika', b] }), v);
      const s1 = L.addClean(null, a);
      check('足す：正しい形の文字列', s1 === J({ v: 1, ids: [a] }), s1);
      const s2 = L.addClean(s1, b);
      check('もう1つ足す', s2 === J({ v: 1, ids: [a, b] }), s2);
      check('同じ id をまた足しても増えない', L.addClean(s2, a) === s2, null);
      check('知らない id は足さず、元のまま正しい形で返す', L.addClean(s2, 'nanika') === s2 && L.addClean('{', 'nanika') === J({ v: 1, ids: [] }) && L.addClean(s2, 5) === s2, null);
      const s3 = L.addClean(J({ v: 1, ids: ['sakura', a] }), b);
      check('古い id（sakura）の入った印に足しても、古い id を消さない', s3 === J({ v: 1, ids: ['sakura', a, b] }), s3);
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
  {
    id: 'AL17', tier: 'smoke', node: true, title: 'あまいものあつめ：描き直す前の古い絵の id（計画書 amai-redraw.md §7.1）：途中の保存の絵が古い id でも落ちず同じ面の番号で新しい絵の面になる・ずかん／もどしなしの印の古い id は消さないが数えない・49〜100 面を足す前に 49 面より先へ、101〜150 面を足す前に 101 面より先へ、151〜200 面を足す前に 151 面より先へ進んだ人の保存とずかんでも落ちない',
    async run({ check, root }) {
      const L = load(root);
      const PO = L.PICTURE_ORDER;
      const OLD = ['sakura', 'ichigo', 'kinoko', 'hiyoko', 'nekonokao', 'basu', 'kumatofuusen', 'kanransha'];
      check('古い id は PICTURE_ORDER に無い', OLD.every((id) => !PO.some((p) => p.id === id)), null);
      // 途中の保存（amai.save）の絵が古い id：形は正しいので読める（面の番号を保つ）
      const sv = L.validateSave(J({ v: 1, level: 5, pic: 'kinoko', mirror: false, rep: false, presses: [[0, 1], [3, 2]], t: 9 }));
      check('validateSave：古い id の保存も読める（level 5・pic kinoko）', !!sv && sv.level === 5 && sv.pick.id === 'kinoko', sv);
      await withPictures(L, () => {
        const rows = [];
        for (const [lv, id] of [[3, 'sakura'], [5, 'kinoko'], [13, 'nekonokao'], [25, 'basu'], [48, 'kanransha']]) {
          let ok = false, detail = null;
          try {
            const c = L.createLevel(lv, { id, mirror: false, repeat: false });
            const p = L.paramsFor(lv, { id, mirror: false, repeat: false });
            ok = c.state.level === lv && c.state.picture === PO[lv - 1].id && p.picture === PO[lv - 1].id && p.tier === PO[lv - 1].tier && c.info.fallback === 0;
            const r = L.replay(lv, { id, mirror: false, repeat: false }, [[0, 1]], 3);   // 押せない手でも落ちない（ok:false なら画面は同じ面の最初から）
            ok = ok && !!r && !!r.state && r.state.level === lv;
            detail = { level: c.state.level, picture: c.state.picture, fallback: c.info.fallback };
          } catch (e) { detail = String(e); }
          if (!ok) rows.push({ lv, id, detail });
        }
        check('古い id の pick で面を作ると、同じ面の番号で PICTURE_ORDER の新しい絵の面になる（落ちない・予備に落ちない）', rows.length === 0, rows);
        const pk = L.pickPicture(5, L.validateBook(J({ v: 1, got: { kinoko: 3 } })));
        check('pickPicture：古い id がずかんにあっても 5 面は新しい絵', pk.id === PO[4].id && pk.mirror === false && pk.repeat === false, pk);
      });
      // 201 面から：古い id だけのずかん（描き直す前にくり返しまで進んだ人）なら、新しい絵を 3 枚目から順に、反転せずに出す（古い id は数えない。§2.7・計画書 amai-redraw.md §8.2）
      const oldBook = J({ v: 1, got: Object.fromEntries(OLD.map((id) => [id, 5])) });
      const p49 = L.pickPicture(201, oldBook);
      check('201 面から：古い id だけのずかんなら、新しい 3 枚目の絵を反転せずに出す（くり返しでない）', p49.id === PO[2].id && p49.repeat === false && p49.mirror === false, p49);
      const ob2 = L.addToBook(L.addToBook(oldBook, PO[2].id), PO[3].id);
      const p50 = L.pickPicture(202, ob2);
      check('201 面から：新しい絵を見たら、次の 0 回の新しい絵（5 枚目）', p50.id === PO[4].id && p50.repeat === false && p50.mirror === false, p50);
      // ずかん（amai.book）：古い id は消さずに残すが、数えない
      const raw = J({ v: 1, got: { ringo: 2, sakura: 4, kinoko: 9, [PO[2].id]: 1, kanransha: 1 } });
      const vb = L.validateBook(raw);
      check('validateBook：古い id（sakura・kinoko・kanransha）を残す', vb.got.sakura === 4 && vb.got.kinoko === 9 && vb.got.kanransha === 1 && vb.got.ringo === 2, { ...vb.got });
      check('bookCount：PICTURE_ORDER にある絵だけ数える（ringo と 3 枚目の 2 枚）', L.bookCount(raw) === 2, L.bookCount(raw));
      const ab = JSON.parse(L.addToBook(raw, PO[3].id));
      check('addToBook：新しい絵を足しても古い id を消さない', ab.got.sakura === 4 && ab.got.kinoko === 9 && ab.got.kanransha === 1 && ab.got[PO[3].id] === 1, ab.got);
      check('bookCount：足したあとは 3 枚', L.bookCount(JSON.stringify(ab)) === 3, null);
      // 1手もどし なし の印（amai.clean）：古い id は消さずに残す（hasClean は新しい絵には関係しない）
      const vc = L.validateClean(J({ v: 1, ids: ['sakura', PO[0].id, 'kinoko'] }));
      check('validateClean：古い id を残す', J(vc) === J({ ids: ['sakura', PO[0].id, 'kinoko'] }), vc);
      const ac = JSON.parse(L.addClean(J({ v: 1, ids: ['sakura'] }), PO[2].id));
      check('addClean：新しい絵を足しても古い id を消さない', J(ac.ids) === J(['sakura', PO[2].id]), ac);
      check('hasClean：古い id の印は新しい絵に付かない', L.hasClean(J({ v: 1, ids: ['sakura'] }), PO[2].id) === false, null);
      // 49〜100 面を足す前（くり返しが 49 面からだった頃）に 49 面より先まで進んだ人（計画書 docs/plans/amai-more.md §5 の 2.）
      // ずかんは 1〜48 枚目だけ。途中の保存は 55 面・9 枚目の反転のくり返し
      const book48 = J({ v: 1, got: Object.fromEntries(PO.slice(0, 48).map((p) => [p.id, 2])) });
      const sv55 = L.validateSave(J({ v: 1, level: 55, pic: PO[8].id, mirror: true, rep: true, presses: [[0, 1]], t: 3 }));
      check('49 面より先の古い保存（55 面・くり返しの pick）も読める', !!sv55 && sv55.level === 55 && sv55.pick.repeat === true && sv55.pick.mirror === true, sv55);
      await withPictures(L, () => {
        let ok = false, detail = null;
        try {
          const c = L.createLevel(55, sv55.pick);
          const r = L.replay(55, sv55.pick, sv55.presses, sv55.t);
          ok = c.state.level === 55 && c.state.mirror === true && c.state.repeat === true && c.info.fallback !== 2 && !!r && !!r.state && r.state.level === 55;
          detail = { mirror: c.state.mirror, fallback: c.info.fallback, replay: r && r.ok };
        } catch (e) { detail = String(e); }
        check('古い保存の pick（55 面・反転のくり返し）で面を作り・再生しても落ちない（面の番号を保つ）', ok, detail);
      });
      const n56 = L.pickPicture(56, book48);
      check('その人の次の面（56 面）は足した 56 枚目の絵（反転しない・くり返しでない）', n56.id === PO[55].id && n56.mirror === false && n56.repeat === false, n56);
      const n101 = L.pickPicture(201, L.addToBook(book48, PO[55].id));
      check('201 面からは、飛ばした足した絵（49 枚目〜）を反転せずに先に出す', n101.id === PO[48].id && n101.mirror === false && n101.repeat === false, n101);
      check('bookCount：1〜48 枚目のずかんは 48（足した絵の分は 0 のまま。消えない）', L.bookCount(book48) === 48, L.bookCount(book48));
      check('validateBest：ベスト 60 はそのまま読める', L.validateBest('60') === 60, L.validateBest('60'));
      // 101〜150 面を足す前（くり返しが 101 面からだった頃）に 101 面より先まで進んだ人（計画書 docs/plans/amai-more2.md §3。2026-11-04）
      // ずかんは 1〜100 枚目だけ。途中の保存は 105 面・9 枚目の反転のくり返し
      const book100 = J({ v: 1, got: Object.fromEntries(PO.slice(0, 100).map((p) => [p.id, 2])) });
      const sv105 = L.validateSave(J({ v: 1, level: 105, pic: PO[8].id, mirror: true, rep: true, presses: [[0, 1]], t: 3 }));
      check('101 面より先の古い保存（105 面・くり返しの pick）も読める', !!sv105 && sv105.level === 105 && sv105.pick.repeat === true && sv105.pick.mirror === true, sv105);
      await withPictures(L, () => {
        let ok = false, detail = null;
        try {
          const c = L.createLevel(105, sv105.pick);
          const r = L.replay(105, sv105.pick, sv105.presses, sv105.t);
          ok = c.state.level === 105 && c.state.mirror === true && c.state.repeat === true && c.info.fallback !== 2 && !!r && !!r.state && r.state.level === 105;
          detail = { mirror: c.state.mirror, fallback: c.info.fallback, replay: r && r.ok };
        } catch (e) { detail = String(e); }
        check('古い保存の pick（105 面・反転のくり返し）で面を作り・再生しても落ちない（面の番号を保つ）', ok, detail);
      });
      const n106 = L.pickPicture(106, book100);
      check('その人の次の面（106 面）は足した 106 枚目の絵（反転しない・くり返しでない）', n106.id === PO[105].id && n106.mirror === false && n106.repeat === false, n106);
      const n151 = L.pickPicture(201, L.addToBook(book100, PO[105].id));
      check('201 面からは、飛ばした足した絵（101 枚目〜）を反転せずに先に出す', n151.id === PO[100].id && n151.mirror === false && n151.repeat === false, n151);
      check('bookCount：1〜100 枚目のずかんは 100（足した絵の分は 0 のまま。消えない）', L.bookCount(book100) === 100, L.bookCount(book100));
      check('validateBest：ベスト 120 はそのまま読める', L.validateBest('120') === 120, L.validateBest('120'));
      // 151〜200 面を足す前（くり返しが 151 面からだった頃）に 151 面より先まで進んだ人（計画書 docs/plans/amai-parts.md。2026-11-09）
      // ずかんは 1〜150 枚目だけ。途中の保存は 155 面・9 枚目の反転のくり返し。もどしなし・金の花輪の印もある
      const book150 = J({ v: 1, got: Object.fromEntries(PO.slice(0, 150).map((p) => [p.id, 2])) });
      const sv155 = L.validateSave(J({ v: 1, level: 155, pic: PO[8].id, mirror: true, rep: true, presses: [[0, 1]], t: 3 }));
      check('151 面より先の古い保存（155 面・くり返しの pick）も読める', !!sv155 && sv155.level === 155 && sv155.pick.repeat === true && sv155.pick.mirror === true, sv155);
      await withPictures(L, () => {
        let ok = false, detail = null;
        try {
          const c = L.createLevel(155, sv155.pick);
          const r = L.replay(155, sv155.pick, sv155.presses, sv155.t);
          ok = c.state.level === 155 && c.state.mirror === true && c.state.repeat === true && c.state.picture === PO[8].id && c.info.fallback !== 2 && !!r && !!r.state && r.state.level === 155;
          detail = { mirror: c.state.mirror, picture: c.state.picture, fallback: c.info.fallback, replay: r && r.ok };
        } catch (e) { detail = String(e); }
        check('古い保存の pick（155 面・反転のくり返し）で面を作り・再生しても落ちない（面の番号と絵を保つ）', ok, detail);
      });
      // 今の版で作った 155 面の保存（makeSave）は、目印が合い（saveFits）、押した手をそのまま再生できる（2026-11-09 技術レビュー）
      await withPictures(L, () => {
        let ok = false, detail = null;
        try {
          const c = L.createLevel(155, sv155.pick);
          let s = c.state; const presses = [];
          for (const col of c.info.solution.slice(0, 3)) { s = settle(L, s); presses.push([s.t, col]); s = L.press(s, col).state; }
          const sv = L.validateSave(L.makeSave(155, sv155.pick, presses, s.t));
          const r = sv && L.replay(155, sv.pick, sv.presses, sv.t);
          ok = !!sv && L.saveFits(sv) === true && !!r && r.ok === true && r.applied === presses.length;
          detail = { fits: sv && L.saveFits(sv), replay: r && r.ok, applied: r && r.applied, presses };
        } catch (e) { detail = String(e); }
        check('今の版の makeSave(155, pick, 押した手, t) の保存は saveFits が true・replay が ok（押した手をすべて使う）', ok, detail);
      });
      // 151〜200 面を足す前の途中の保存：175 面・新しい絵を先に見せるで選ばれた inukouenbooru（L。面の番号どおりの絵ではない）・押した手 3 つ。
      // 文字は足す前の版（fa11bd3）の makeSave で作ったもの。ふた・こおりはその絵の段の値（L：2・1）で、足す前と同じ盤に戻る（約束 §2.1・§2.7）
      await withPictures(L, (kind) => {
        const raw = '{"v":1,"level":175,"pic":"inukouenbooru","mirror":false,"rep":false,"presses":[[0,2],[95,3],[194,2]],"t":199,"picSig":"76de9b25"}';
        let ok = false, detail = null;
        try {
          const sv = L.validateSave(raw);
          const p = L.paramsFor(175, sv.pick);
          const h = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
          const c = L.createLevel(175, sv.pick);
          const r = L.replay(175, sv.pick, sv.presses, sv.t);
          // 盤の目印（足す前の版で同じ形に作った値）。仮の絵では比べられないので、本物の絵のときだけ
          const same = kind !== '本物' || (h(c.state) === 'df640e51a710b22f' && h(r.state) === 'db3bd23e9c8fa9cb');
          ok = p.lids === 2 && p.ices === 1 && (kind !== '本物' || L.saveFits(sv) === true) && r.ok === true && r.applied === 3 && c.state.level === 175 && c.state.picture === 'inukouenbooru' && same;
          detail = { kind, lids: p.lids, ices: p.ices, fits: L.saveFits(sv), replay: r.ok, applied: r.applied, start: h(c.state), end: h(r.state) };
        } catch (e) { detail = String(e); }
        check('足す前の古い保存（175 面・inukouenbooru（L）・押した手 3 つ）は、ふた 2・こおり 1（その絵の段の値）で前と同じ盤になり、押した手もそのまま再生できる', ok, detail);
      });
      const n156 = L.pickPicture(156, book150);
      check('その人の次の面（156 面）は足した 156 枚目の絵（反転しない・くり返しでない）', n156.id === PO[155].id && n156.mirror === false && n156.repeat === false, n156);
      const n201 = L.pickPicture(201, L.addToBook(book150, PO[155].id));
      check('201 面からは、飛ばした足した絵（151 枚目〜）を反転せずに先に出す', n201.id === PO[150].id && n201.mirror === false && n201.repeat === false, n201);
      check('bookCount：1〜150 枚目のずかんは 150（足した絵の分は 0 のまま。消えない）', L.bookCount(book150) === 150, L.bookCount(book150));
      const clean150 = J({ v: 1, ids: PO.slice(0, 150).map((p) => p.id) });
      check('もどしなしの印（1〜150 枚目）は消えない・足した絵には付かない', L.validateClean(clean150).ids.length === 150 && L.hasClean(clean150, PO[149].id) === true && L.hasClean(clean150, PO[150].id) === false, null);
      check('validateBest：ベスト 170 はそのまま読める', L.validateBest('170') === 170, L.validateBest('170'));
    },
  },
  {
    id: 'AL18', tier: 'smoke', node: true, title: 'あまいものあつめ：面えらびの範囲 levelChoices・canSelect（1〜ベスト＋1 面。一覧は 1〜200 面、ベスト＋1 が 201 面より先なら「つづき」を 1 つ。壊れたベストは 0 として 1 面だけ。16 桁で上限を超えない。例外を出さない）',
    async run({ check, root }) {
      const L = load(root);
      const M = Number.MAX_SAFE_INTEGER;
      const eq = (best, want) => { const r = L.levelChoices(best); return J(r) === J(want) ? true : r; };
      for (const [best, want] of [[0, { top: 1, list: 200, open: 1, more: 0 }], ['5', { top: 6, list: 200, open: 6, more: 0 }], [5, { top: 6, list: 200, open: 6, more: 0 }], [100, { top: 101, list: 200, open: 101, more: 0 }], [150, { top: 151, list: 200, open: 151, more: 0 }], [199, { top: 200, list: 200, open: 200, more: 0 }], ['200', { top: 201, list: 200, open: 200, more: 201 }], [250, { top: 251, list: 200, open: 200, more: 251 }], [M - 1, { top: M, list: 200, open: 200, more: M }], [M, { top: M, list: 200, open: 200, more: M }]]) {
        const r = eq(best, want);
        check(`levelChoices(${J(best)}) → ${J(want)}`, r === true, r);
      }
      const bads = [null, undefined, '', 'abc', '-1', -1, '1.5', 1.5, '{', NaN, Infinity, {}, [], '9'.repeat(30)];
      check('壊れたベストは 0 として扱う（1 面だけ）・例外を出さない', bads.every((b) => { try { return J(L.levelChoices(b)) === J({ top: 1, list: 200, open: 1, more: 0 }); } catch (e) { return false; } }), bads.map((b) => { try { return L.levelChoices(b); } catch (e) { return String(e); } }));
      check('canSelect：ベスト 5 なら 1〜6 面だけ', [1, 2, 6].every((n) => L.canSelect(5, n) === true) && [0, 7, 100, -1, 1.5, '3', null, NaN].every((n) => L.canSelect(5, n) === false), null);
      check('canSelect：ベスト 150 なら 151 面まで・152 面は選べない', L.canSelect(150, 151) === true && L.canSelect(150, 100) === true && L.canSelect(150, 152) === false, null);
      check('canSelect：ベスト 200 なら 201 面まで・202 面は選べない', L.canSelect(200, 201) === true && L.canSelect(200, 150) === true && L.canSelect(200, 202) === false, null);
      check('canSelect：壊れたベストでも 1 面は選べ、2 面は選べない', L.canSelect('x', 1) === true && L.canSelect('x', 2) === false && L.canSelect(undefined, 1) === true, null);
      check('canSelect：16 桁の上限の面', L.canSelect(M, M) === true && L.canSelect(M - 1, M) === true && L.canSelect(M - 2, M) === false, null);
    },
  },
  // ---------- ちょうせんモード（2026-11-05。計画書 docs/plans/amai-challenge.md §1・契約 §2.9） ----------
  {
    id: 'AL19', tier: 'smoke', node: true, title: 'あまいものあつめ：ちょうせん（わく 2 つ）の面：CHAL_SLOTS 2・CHAL_UNDO は無い（2026-11-10 に 1手もどすの回数の制限をやめた）・createLevel(n, pick, { challenge: true }) はわく 2 つで、解を画面と同じ press・step で再生すると won（1・2・3・5・13・25・37・48・77・100・150 面）・決定的・ふつうの面は変わらない（わく 3・同じ面）・replay も challenge でわく 2・amai.gold の検査（validateGold・addGold・hasGold）',
    async run({ check, root }) {
      const L = load(root);
      check('CHAL_SLOTS は 2・CHAL_UNDO は無い（2026-11-10 から何回でも）・SLOTS は 3・SAVE_KEY_GOLD は amai.gold', L.CHAL_SLOTS === 2 && L.CHAL_UNDO === undefined && L.SLOTS === 3 && L.SAVE_KEY_GOLD === 'amai.gold', { CHAL_SLOTS: L.CHAL_SLOTS, CHAL_UNDO: L.CHAL_UNDO, SLOTS: L.SLOTS, KEY: L.SAVE_KEY_GOLD });
      await withPictures(L, (kind) => {
        check(`絵：${kind}`, true, null);
        const bad = [];
        for (const lv of [1, 2, 3, 5, 13, 25, 37, 48, 77, 100, 150]) {
          const c = L.createLevel(lv, null, { challenge: true });
          const n = L.createLevel(lv, null);
          const pl = playSolution(L, c);
          if (c.state.slots.length !== 2 || c.state.slots.some((x) => x !== null)) bad.push({ lv, why: 'わくが 2 つの空きでない', slots: c.state.slots });
          if (c.info.challenge !== true || n.info.challenge !== false) bad.push({ lv, why: 'info.challenge', c: c.info.challenge, n: n.info.challenge });
          if (!pl.ok) bad.push({ lv, why: 'わく 2 つで解が通らない', bad: pl.bad });
          if (pl.ok && pl.state.slots.length !== 2) bad.push({ lv, why: '再生のあいだにわくが 2 つでなくなった' });
          if (n.state.slots.length !== 3) bad.push({ lv, why: 'ふつうの面のわくが 3 つでない' });
          const c2 = L.createLevel(lv, null, { challenge: true });
          if (J(c2.state) !== J(c.state) || J(c2.info.solution) !== J(c.info.solution)) bad.push({ lv, why: '決定的でない' });
          if (c.state.picture !== n.state.picture || c.state.total !== n.state.total) bad.push({ lv, why: '絵がふつうとちがう' });
          // 箱の持ち玉の合計＝角砂糖の数（色ごと）
          if (J(Object.entries(sumByColor(c.state)).sort()) !== J(Object.entries(sugarByColor(c.state)).sort())) bad.push({ lv, why: '持ち玉の合計が角砂糖とちがう' });
        }
        check('わく 2 つの面が解を再生して won・決定的・絵と角砂糖は ふつうと同じ・ふつうはわく 3 つのまま', bad.length === 0, bad);
        // ふつうの面は ちょうせんを足す前と同じ作り（opt を渡さない・{}・challenge が true でない値はふつう）
        const same = [1, 13, 48, 100].every((lv) => J(L.createLevel(lv, null).state) === J(L.createLevel(lv, null, {}).state) && J(L.createLevel(lv, null).state) === J(L.createLevel(lv, null, { challenge: 'yes' }).state));
        check('createLevel の opt が無い・{}・challenge が true でない（"yes"）ならふつうの面（わく 3）', same, null);
        // replay：challenge ならわく 2 つの面で再生する
        const c13 = L.createLevel(13, null, { challenge: true });
        let st = settle(L, c13.state); const r1 = L.press(st, c13.info.solution[0]); st = settle(L, r1.state);
        const rp = L.replay(13, null, [[0, c13.info.solution[0]]], st.t, { challenge: true });
        check('replay(…, { challenge: true }) はわく 2 つの面で同じ局面になる', rp.ok && rp.state.slots.length === 2 && J(rp.state) === J(st), { ok: rp.ok, n: rp.state && rp.state.slots.length });
        const rpN = L.replay(13, null, [], 0);
        check('replay（opt なし）はわく 3 つ', rpN.ok && rpN.state.slots.length === 3, null);
      });
      // validateState：わく 2 つの局面を受け付け、step はわく 2 つのまま運ぶ
      const s2 = L.validateState({ level: 7, W: 3, H: 1, picture: 'test', mirror: false, repeat: false, cells: [0, 0, 1], total: 3, left: 3, cols: [[], [], [], []], slots: [{ id: 1, color: 0, count: 2 }, { id: 2, color: 1, count: 1 }], t: 0, presses: 0, won: false });
      const r2 = s2 && L.step(s2);
      check('validateState がわく 2 つの局面を受け付け、step で 2 つのわくが運ぶ（わくは 2 つのまま）', !!s2 && r2.moved && r2.state.slots.length === 2 && r2.n === 2, r2 && { n: r2.n, slots: r2.state.slots });
      const full2 = L.validateState({ level: 7, W: 3, H: 1, picture: 'test', mirror: false, repeat: false, cells: [0, 0, 1], total: 3, left: 3, cols: [[{ id: 3, color: 0, count: 1, lid: false, ice: 0 }], [], [], []], slots: [{ id: 1, color: 2, count: 1 }, { id: 2, color: 2, count: 1 }], t: 0, presses: 0, won: false });
      check('わく 2 つが埋まれば press は full・isStuck は true', !!full2 && L.canPress(full2, 0) === 'full' && L.isStuck(full2) === true, full2 && { r: L.canPress(full2, 0), st: L.isStuck(full2) });
      // amai.gold（形は amai.clean と同じ）
      const PO = L.PICTURE_ORDER.map((x) => x.id);
      const bads = [null, undefined, '', '{', '[1]', 5, J({ v: 2, ids: [PO[0]] }), J({ v: 1, ids: 'x' }), J({ v: 1 })];
      check('壊れた amai.gold は空・例外を出さない', bads.every((b) => { try { return J(L.validateGold(b)) === J({ ids: [] }) && L.hasGold(b, PO[0]) === false; } catch (e) { return false; } }), null);
      const g = L.validateGold(J({ v: 1, ids: [PO[0], PO[0], 'Bad', 5, 'x'.repeat(65), 'furuiid', PO[3]] }));
      check('validateGold：重複・壊れた id を捨て、知らない（古い）id は残す', J(g.ids) === J([PO[0], 'furuiid', PO[3]]), g);
      const a1 = L.addGold(null, PO[2]), a2 = L.addGold(a1, PO[2]), a3 = L.addGold(a2, 'nanika');
      check('addGold：足す・同じ id は 1 回・PICTURE_ORDER に無い id は足さない・hasGold', J(JSON.parse(a3)) === J({ v: 1, ids: [PO[2]] }) && L.hasGold(a3, PO[2]) && !L.hasGold(a3, PO[1]), a3);
      check('addGold は amai.clean と別（hasClean は gold の文字を読んでも同じ形）・壊れた元でも落ちない', typeof L.addGold('{', PO[1]) === 'string' && L.hasGold(L.addGold('{', PO[1]), PO[1]), null);
    },
  },
  {
    id: 'AL20', tier: 'full', flaky: { why: 'Node で 1 面の生成の時間を測る', checks: /^ちょうせんの 1 面の生成/ }, node: true, solo: true, title: 'あまいものあつめ：ちょうせん（わく 2 つ）の 1〜200 面がすべて ふつうの作り（予備 1・2 に落ちない）で、解を再生して won。1 面の生成は 150ms 以内（iPhone SE で重すぎない目安）。ふつうの 1〜150 面はちょうせんを足しても同じ面',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        check(`絵：${kind}`, true, null);
        L.createLevel(48, null, { challenge: true }); L.createLevel(30, null, { challenge: true });   // JIT の暖め
        const per = [], bad = [];
        let same = 0;
        for (let lv = 1; lv <= Math.min(L.BASE_PICTURES, L.PICTURE_ORDER.length); lv++) {
          const a = cpuOf();
          const c = L.createLevel(lv, null, { challenge: true });
          per.push({ lv, ms: +cpuMs(cpuOf(a)).toFixed(2) });
          const pl = playSolution(L, c);
          if (c.info.fallback !== 0) bad.push({ lv, why: `予備 ${c.info.fallback} に落ちた`, tries: c.info.tries });
          if (!pl.ok || c.state.slots.length !== 2) bad.push({ lv, why: 'わく 2 つで解けない', bad: pl.bad });
          const n = L.createLevel(lv, null);
          if (J(n.state.cols) === J(c.state.cols)) same++;
        }
        const ms = per.map((x) => x.ms).sort((a, b) => a - b);
        const worst = per.reduce((m, x) => (x.ms > m.ms ? x : m), per[0]);
        check(`ちょうせんの 1〜200 面がすべて ふつうの作り（予備に落ちない）でわく 2 つで won（箱の並びが ふつうと同じ面 ${same}）`, bad.length === 0, bad);
        // 実測（2026-11-05・クラウド）：最大 約 40〜60ms・中央 約 16ms。iPhone SE で重すぎない目安 150ms
        check(`ちょうせんの 1 面の生成 最大 ${worst.ms}ms（${worst.lv} 面）・中央 ${ms[Math.floor(ms.length / 2)]}ms ≦ 150ms`, worst.ms <= 150, per.filter((x) => x.ms > 60));
      });
    },
  },
  {
    id: 'AL22', tier: 'smoke', node: true, title: 'あまいものあつめ：途中の保存の絵の目印（picSig。課題 AM-18）：makeSave が今の絵の目印（8 桁の 16 進）を書き、validateSave が読む。目印が合えば saveFits が true（続きから）・絵が変わると false（同じ面の最初から）・反転した面は反転の目印。目印の無い古い保存（v66 の形）はどの面も false（2026-11-06 から。前は 1・2 面だけ true）・決まりの版を混ぜる前の目印（v67 の形）も false（取る角砂糖の決まりが道のりに変わった。amai-route.md）。壊れた picSig（数・長すぎる・形ちがい）でも保存は読めて false・例外なし',
    async run({ check, root }) {
      const L = load(root);
      await withPictures(L, (kind) => {
        const PO = L.PICTURE_ORDER;
        const pk = { id: PO[4].id, mirror: false, repeat: false };
        const sig = L.pictureSig(pk);
        check(`絵：${kind}。pictureSig は 8 桁の 16 進（${sig}）・同じ絵なら同じ`, /^[0-9a-f]{8}$/.test(sig) && L.pictureSig({ ...pk }) === sig, sig);
        const ms = L.makeSave(5, pk, [[0, 1], [3, 2]], 7);
        const o = JSON.parse(ms), v = L.validateSave(ms);
        check('makeSave が picSig を書き、validateSave が sig で返す', o.v === 1 && o.picSig === sig && v && v.sig === sig, { o, v });
        check('①目印が合う保存は saveFits が true（続きから）', L.saveFits(v) === true, v);
        // 反転（くり返しの面）
        const pm = { id: PO[4].id, mirror: true, repeat: true };
        const sigM = L.pictureSig(pm);
        const a = L.pictureById(pk.id, false), b = L.pictureById(pk.id, true);
        const asym = a && b && JSON.stringify(a.cells) !== JSON.stringify(b.cells);
        check(`反転の面の目印は反転なしと違い（${sigM}・${sig}。左右が同じ絵でも mirror を混ぜる）、反転の保存は反転の目印で合う`, sigM !== sig && /^[0-9a-f]{8}$/.test(sigM)
          && L.saveFits(L.validateSave(L.makeSave(155, pm, [], 0))) === true && L.saveFits({ ...L.validateSave(L.makeSave(155, pm, [], 0)), sig }) === false, { asym });
        // ②絵が変わった：同じ id の地図を別の絵の地図にする
        const prev = globalThis.AmaiPictures;
        const raw = (id) => (typeof prev.byId === 'function' ? prev.byId(id) : prev.byId[id]);
        const other = raw(PO[5].id);
        globalThis.AmaiPictures = { byId: (id) => (id === pk.id ? { ...raw(id), map: other.map } : raw(id)) };
        let changed;
        try { changed = { sig: L.pictureSig(pk), fits: L.saveFits(L.validateSave(ms)) }; } finally { globalThis.AmaiPictures = prev; }
        check(`②絵が変わると目印が変わり（${changed.sig}）、前の保存は saveFits が false（同じ面の最初から）`, changed.sig !== sig && changed.fits === false, changed);
        // 左右が同じ絵でも、反転の面と反転なしの面の目印は違う（mirror を混ぜる）
        globalThis.AmaiPictures = { byId: (id) => (id === pk.id ? { ...raw(id), map: ['RRRR', 'RGGR', 'RGGR', 'RRRR'] } : raw(id)) };
        let sym;
        try { sym = { n: L.pictureSig(pk), m: L.pictureSig(pm) }; } finally { globalThis.AmaiPictures = prev; }
        check(`左右が同じ絵でも反転の目印は別（${sym.n}・${sym.m}）`, /^[0-9a-f]{8}$/.test(sym.n) && /^[0-9a-f]{8}$/.test(sym.m) && sym.n !== sym.m, sym);
        check('元の絵に戻すと、また合う', L.saveFits(L.validateSave(ms)) === true, null);
        // ③目印の無い古い保存（v66 の形）
        const old = (lv, id) => J({ v: 1, level: lv, pic: id, mirror: false, rep: false, presses: [[0, 1]], t: 3 });
        const oldRes = { lv5: L.saveFits(L.validateSave(old(5, PO[4].id))), lv3: L.saveFits(L.validateSave(old(3, PO[2].id))), lv1: L.saveFits(L.validateSave(old(1, PO[0].id))), lv2: L.saveFits(L.validateSave(old(2, PO[1].id))) };
        check('③目印の無い古い保存：読めて、1・2・3・5 面とも false（最初から。決まりが変わったので 1・2 面も）', L.validateSave(old(5, PO[4].id)) !== null && oldRes.lv5 === false && oldRes.lv3 === false && oldRes.lv1 === false && oldRes.lv2 === false, oldRes);
        // ⑤v67 の形の目印（絵の地図と mirror だけの FNV-1a。決まりの版を混ぜる前）の保存は、絵が同じでも false（同じ面の最初から）
        const sig67 = (p0, m) => { const pic = L.pictureById(p0.id, m); let h = 0x811c9dc5; const mx = (v) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }; mx(pic.W); mx(pic.H); mx(m ? 1 : 0); for (const c of pic.cells) mx(c + 1); return (h >>> 0).toString(16).padStart(8, '0'); };
        const v67 = (lv, p0, m) => L.validateSave(J({ v: 1, level: lv, pic: p0.id, mirror: m, rep: m, presses: [[0, 1]], t: 3, picSig: sig67(p0, m) }));
        const r67 = { lv5: L.saveFits(v67(5, pk, false)), lv1: L.saveFits(v67(1, { id: PO[0].id }, false)), lv155: L.saveFits(v67(155, pk, true)), sig: L.pictureSig(pk), old: sig67(pk, false) };
        check(`⑤v67 の形の目印（${r67.old}）は今の目印（${r67.sig}）と違い、1・5・155（反転）面とも false（最初から）`, r67.sig !== r67.old && r67.lv5 === false && r67.lv1 === false && r67.lv155 === false, r67);
        // ④壊れた picSig
        const good = JSON.parse(ms);
        const broken = { '数': 12345678, '長すぎる': 'a'.repeat(100000), '大文字': sig.toUpperCase() === sig ? 'ZZZZZZZZ' : sig.toUpperCase(), '7 桁': sig.slice(1), 'オブジェクト': { x: 1 }, 'null': null, '配列': [sig], '空': '' };
        const rows = [];
        for (const [k, bad] of Object.entries(broken)) {
          try {
            const vv = L.validateSave(J({ ...good, picSig: bad }));
            if (!vv || vv.sig !== '' || vv.level !== 5 || L.saveFits(vv) !== false) rows.push(`${k}: ${J(vv && { sig: vv.sig, level: vv.level })} fits ${vv && L.saveFits(vv)}`);
          } catch (e) { rows.push(`${k}: 例外 ${e.message}`); }
        }
        check(`④壊れた picSig（${Object.keys(broken).length} 通り）でも保存は読めて（面の番号は残る）目印なし・saveFits は false・例外なし`, rows.length === 0, rows);
        const thrown = [];
        for (const a2 of [undefined, null, 0, 'x', [], {}, { id: 5 }, { id: 'nai' }, { level: 3, pick: null }, { level: 'x', pick: pk, sig }, Symbol('s')]) {
          try { const s1 = L.pictureSig(a2), f1 = L.saveFits(a2); if (typeof s1 !== 'string' || f1 !== false) thrown.push(String(a2 && a2.toString ? J(a2) ?? 'sym' : a2) + ` ${s1} ${f1}`); } catch (e) { thrown.push('例外 ' + e.message); }
        }
        check('おかしな引数：pictureSig は文字（無い絵は ""）・saveFits は false・例外なし', thrown.length === 0, thrown);
        // 続きから再生できる（合う保存の押した手で replay が ok）
        const cr = L.createLevel(5, pk);
        const col0 = cr.info.solution[0];
        const ms2 = L.makeSave(5, pk, [[0, col0]], 2);
        const v2 = L.validateSave(ms2);
        const rp = L.saveFits(v2) ? L.replay(v2.level, v2.pick, v2.presses, v2.t) : null;
        check('合う保存の押した手で replay が ok（押した数 1）', !!rp && rp.ok === true && rp.state.presses === 1, rp && { ok: rp.ok, applied: rp.applied });
      });
    },
  },
  {
    id: 'AL23', tier: 'smoke', node: true, title: 'あまいものあつめ：取る角砂糖は道のり（巣から空いたマスと外の枠を歩く数）がいちばん短いふち、同じなら前の順（巣に近い → 下 → 左）（2026-11-06。ユーザー「経路の1番近いところから」。amai-route.md §2 B）：①まっすぐ近いが回り道の角砂糖より、道のりの近い角砂糖が先 ②本物の面を遊んで、毎はこび総当たりの幅優先と一致 ③edgeCells の先頭＝次に取る角砂糖',
    run({ check, root }) {
      const L = load(root);
      // ①まん中の R（3,2）は巣にまっすぐ近い（前の順で 1 番）が、上からしか入れない（道のり 14）。下のはしの R（0,3）・（6,3）は道のり 4
      const map = ['.......', '.GG.GG.', '.GRRRG.', 'RGGGGGR'];
      let s = mk(L, map, { slots: [{ c: LET.R, n: 5 }] });
      const got = [];
      for (let i = 0; i < 5; i++) { const r = L.step(s); if (!r.moved) break; got.push(r.carries[0].cell); s = r.state; }
      const want = [at(s, 0, 3), at(s, 6, 3), at(s, 3, 2), at(s, 2, 2), at(s, 4, 2)];
      check(`①道のりの近い順（${J(got)}。前のまっすぐの近さなら ${J([at(s, 3, 2), at(s, 2, 2), at(s, 4, 2), at(s, 0, 3), at(s, 6, 3)])}）・同じ道のりなら前の順（左が先）`, J(got) === J(want), { got, want });
      // ②総当たり：外（外とつながった空き）と外の枠を幅優先で歩いた数＋1 が一番小さいふち、同じなら前の順
      const brute = (st, color) => {
        const W = st.W, H = st.H, vw = W + 2, vh = H + 2, out = new Uint8Array(W * H), stack = [];
        const seed = (i) => { if (st.cells[i] < 0 && !out[i]) { out[i] = 1; stack.push(i); } };
        for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
        for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
        while (stack.length) { const i = stack.pop(), x = i % W, y = (i - x) / W; if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W); }
        const walk = (v) => { const vx = v % vw, vy = (v - vx) / vw; return vx === 0 || vy === 0 || vx === vw - 1 || vy === vh - 1 || out[(vy - 1) * W + vx - 1] === 1; };
        const d = new Int32Array(vw * vh).fill(-1), st0 = (H + 1) * vw + Math.round((W - 1) / 2) + 1, q = [st0];
        d[st0] = 0;
        for (let h = 0; h < q.length; h++) { const v = q[h], vx = v % vw; for (const u of [vx > 0 ? v - 1 : -1, vx < vw - 1 ? v + 1 : -1, v - vw, v + vw]) if (u >= 0 && u < vw * vh && d[u] < 0 && walk(u)) { d[u] = d[v] + 1; q.push(u); } }
        let best = -1, bk = null;
        for (let i = 0; i < W * H; i++) {
          if (st.cells[i] !== color) continue;
          const x = i % W, y = (i - x) / W, v = (y + 1) * vw + x + 1;
          let m = Infinity;
          for (const u of [v - 1, v + 1, v - vw, v + vw]) if (d[u] >= 0 && walk(u)) m = Math.min(m, d[u] + 1);
          if (m === Infinity) continue;
          const k = [m, Math.abs(2 * x - (W - 1)) + 2 * (H - y), -y, x];
          if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && (k[2] < bk[2] || (k[2] === bk[2] && k[3] < bk[3])))))) { bk = k; best = i; }
        }
        return best;
      };
      const rows = [];
      let n = 0;
      for (const lv of [1, 3, 13, 84]) {
        const c = L.createLevel(lv, null);
        let st = c.state;
        const rnd = rngOf(lv * 7 + 1);
        for (let g = 0; g < 400 && !st.won; g++) {
          const can = [0, 1, 2, 3].filter((k) => L.canPress(st, k) === null);
          if (can.length && (L.isStable(st) || rnd() < 0.3)) st = L.press(st, can[Math.floor(rnd() * can.length)]).state;
          const k0 = st.slots.findIndex((b) => b);
          const want0 = k0 >= 0 ? brute(st, st.slots[k0].color) : -1;
          const e0 = k0 >= 0 ? L.edgeCells(st, st.slots[k0].color)[0] ?? -1 : -1;
          const r = L.step(st);
          if (!r.moved) { if (L.isStuck(st)) break; continue; }
          n++;
          const c0 = r.carries[0];
          if (c0.slot === k0 && (c0.cell !== want0 || e0 !== want0) && rows.length < 5) rows.push(`${lv} 面 t ${st.t}: 取った ${c0.cell}・総当たり ${want0}・edgeCells の先頭 ${e0}`);
          st = r.state;
        }
      }
      check(`②③本物の面（1・3・13・84 面）を遊んで ${n} はこび、左のわくの箱が取る角砂糖が総当たりの「道のり → 前の順」と一致し、edgeCells の先頭とも一致`, n > 300 && rows.length === 0, rows);
    },
  },
  {
    id: 'AL21', tier: 'smoke', node: true, title: 'あまいものあつめ：12 色（2026-11-05 に足した D こいみどり・V むらさき）：parsePicture が D・V を読む（3 個未満は null）・角砂糖 3072（64×48）まで読めて 3073 は読めない・validateState が色 10・11 を受け付け 12・-2 は null（マス・箱・わく）・D・V の局面を解いて won・5×5 の印が形でほかと見分けられる',
    run({ check, root }) {
      const L = load(root);
      const base = { id: 'test', name: 'てすと', season: '' };
      const p = L.parsePicture({ ...base, map: ['DDDD', 'DVVD', 'DVVD', 'DDDD'] }, false);
      check('D・V の絵が読める（cells に 10・11）', !!p && p.cells[0] === 10 && p.cells[5] === 11, p);
      check('V が 2 個だけの絵は null（各色 3 個以上）', L.parsePicture({ ...base, map: ['DDDD', 'DVVD', 'DDDD'] }, false) === null, null);
      const full = (w, h) => Array.from({ length: h }, (_, y) => (y === 0 ? 'VVV' + 'D'.repeat(w - 3) : 'D'.repeat(w)));
      const big = L.parsePicture({ ...base, map: full(64, 48) }, false);
      check(`64×48 をすべて埋めた絵（角砂糖 ${64 * 48}）が読める（MAX_SUGAR ${L.MAX_SUGAR}）`, !!big && big.cells.length === 3072 && L.MAX_SUGAR === 3072, big && big.cells.length);
      check('64×49（MAX_H を超える）は null', L.parsePicture({ ...base, map: full(64, 49) }, false) === null, null);
      // validateState：色の番号の範囲（マス・手前の箱・わく）
      const st = (o) => ({ level: 7, W: 3, H: 1, picture: 'test', mirror: false, repeat: false, cells: [10, 10, 10], total: 3, left: 3,
        cols: [[{ id: 1, color: 10, count: 3, lid: false, ice: 0 }], [], [], []], slots: [null, null, null], t: 0, presses: 0, won: false, ...o });
      check('色 10（D）の局面は受け付ける', L.validateState(st({})) !== null, null);
      check('色 11（V）の局面は受け付ける', L.validateState(st({ cells: [11, 11, 11], cols: [[{ id: 1, color: 11, count: 3, lid: false, ice: 0 }], [], [], []] })) !== null, null);
      const bad = {
        'マスの色 12': st({ cells: [10, 12, 10] }), 'マスの色 -2': st({ cells: [10, -2, 10] }), 'マスの色 10.5': st({ cells: [10, 10.5, 10] }),
        '箱の色 12': st({ cols: [[{ id: 1, color: 12, count: 3, lid: false, ice: 0 }], [], [], []] }),
        'わくの色 12': st({ cols: [[], [], [], []], slots: [{ id: 1, color: 12, count: 3 }, null, null] }),
      };
      const pass = Object.entries(bad).filter(([, v]) => L.validateState(v) !== null).map(([k]) => k);
      check('壊れた色の番号（12・-2・10.5。マス・箱・わく）は null', pass.length === 0, pass);
      check('colorName(12)・colorName(-1) は空', L.colorName(12) === '' && L.colorName(-1) === '', null);
      // D・V の局面を押して運び切ると won
      let s = mk(L, ['DDDDD', 'DVVVD', 'DDDDD'], { cols: [[{ c: LET.D, n: 12 }], [{ c: LET.V, n: 3 }], [], []] });
      let r = L.press(s, 0); s = r.state || s; r = L.press(s, 1); s = r.state || s;
      for (let i = 0; i < 200 && !s.won; i++) s = L.step(s).state || s;
      check(`D・V の局面を運び切ると won（のこり ${s.left}）`, s.won === true && s.left === 0, { left: s.left, slots: s.slots });
      // 5×5 の印：新しい 2 つは、ほかの 10 個の形と 3 点以上ちがう（似た形で取り違えない）
      const C = L.COLORS, diff = (a, b) => { let n = 0; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (a[y][x] !== b[y][x]) n++; return n; };
      const near = [];
      for (const k of [10, 11]) for (let j = 0; j < C.length; j++) if (j !== k && diff(C[k].dots, C[j].dots) < 3) near.push(`${C[k].letter}-${C[j].letter}:${diff(C[k].dots, C[j].dots)}`);
      check('D・V の 5×5 の印は、ほかのどの印とも 3 点以上ちがう', near.length === 0, near);
    },
  },
  {
    id: 'AL24', tier: 'smoke', node: true, title: 'あまいものあつめ：だいじょうぶな ところまで もどす の調べ（2026-11-10。計画書 amai-rescue.md・約束 §1.13）：①80 面の最初は rescueSearch で solved、返した押す列を「落ち着いてから押す」で再生すると won ②うごかせない局面・あと 1 手で必ず うごかせない局面は dead、とける局面は solved ③上限 0・80 面の 1 手目を まちがえた局面（上限 150）は言い切れない unknown ④run(1) を小分けに呼んでも まとめたのと同じ結果 ⑤makeRewind：とける いちばん新しい k（dead を飛ばす）・budget 0 なら k＝0（base0Sure のとき sure）⑥replayStates の局面＝replay で手前まで再生した局面 ⑦壊れた局面でも例外なし',
    run({ check, root }) {
      const L = load(root);
      const settle = (s) => { for (let i = 0; i < 20000; i++) { const r = L.step(s); if (!r.moved) return s; s = r.state; } return s; };
      const playPath = (s, path) => { for (const c of path) { s = settle(s); const r = L.press(s, c); if (r.outcome.kind !== 'press') return null; s = r.state; } return settle(s); };
      // ① 80 面の最初
      const pk80 = L.pickPicture(80, null);
      const s80 = L.createLevel(80, pk80).state;
      const r80 = L.rescueSearch(s80, { limit: 3000 });
      const w80 = r80.result === 'solved' && Array.isArray(r80.path) ? playPath(s80, r80.path) : null;
      check(`①80 面の最初は solved（${r80.result}・開いた局面 ${r80.nodes}）・押す列 ${r80.path ? r80.path.length : '-'} 手を再生して won（${!!(w80 && w80.won)}）`, r80.result === 'solved' && !!(w80 && w80.won), { result: r80.result, nodes: r80.nodes });
      // ② 手で組んだ局面（R は外、B は R に囲まれた内側。わくの B は R が運ばれるまで待つ）
      const map = ['RRRRR', 'RBBBR', 'RRRRR'];
      // うごかせない：わく 3 つに B（待つ）・列にまだ箱
      const stuck = mk(L, map, { slots: [{ c: LET.B, n: 1 }, { c: LET.B, n: 1 }, { c: LET.B, n: 1 }], cols: [[{ c: LET.R, n: 12 }], [], [], []] });
      const rs = L.rescueSearch(stuck);
      // あと 1 手：わく 2 つに B（待つ）、手前は B だけ（どれを押しても 3 つとも待つ＝うごかせない）。R の箱は B のうしろ
      const near = mk(L, map, { slots: [{ c: LET.B, n: 1 }, { c: LET.B, n: 1 }], cols: [[{ c: LET.B, n: 1 }, { c: LET.R, n: 12 }], [], [], []] });
      const rn = L.rescueSearch(near);
      // とける：手前に R（R を運ぶと B が ふちに出る）
      const ok = mk(L, map, { slots: [{ c: LET.B, n: 1 }, { c: LET.B, n: 1 }], cols: [[{ c: LET.R, n: 12 }], [{ c: LET.B, n: 1 }], [], []] });
      const ro = L.rescueSearch(ok);
      const wo = ro.result === 'solved' ? playPath(ok, ro.path) : null;
      check(`②うごかせない局面は dead（${rs.result}）・あと 1 手で うごかせない局面も dead（${rn.result}）・とける局面は solved（${ro.result}・再生して won ${!!(wo && wo.won)}）`, L.isStuck(stuck) && !L.isStuck(near) && rs.result === 'dead' && rn.result === 'dead' && ro.result === 'solved' && !!(wo && wo.won), { rs, rn, ro });
      // ③ 言い切れない
      const r0 = L.rescueSearch(near, { limit: 0 });
      let wrong = null;
      { const st = settle(s80); for (let c = 0; c < 4 && !wrong; c++) { if (L.canPress(st, c) !== null) continue; const u = settle(L.press(st, c).state); const r = L.rescueSearch(u, { limit: 150 }); if (r.result === 'unknown') wrong = { c, r }; } }
      check(`③上限 0 なら unknown（${r0.result}）・80 面の 1 手目を まちがえた局面は上限 150 で unknown（列 ${wrong ? wrong.c : '-'}・${wrong ? wrong.r.nodes : '-'} 局面）＝何も言わない`, r0.result === 'unknown' && !!wrong, { r0, wrong: wrong && wrong.c });
      // ④ 小分け（40 面の解の 5 手目の局面）
      const pk40 = L.pickPicture(40, null);
      const c40 = L.createLevel(40, pk40);
      let s40 = c40.state;
      for (const c of c40.info.solution.slice(0, 5)) s40 = L.press(settle(s40), c).state;
      const whole = L.rescueSearch(s40, { limit: 150 });
      const sr = L.makeRescue(s40, { limit: 150 });
      let part = null, calls = 0;
      while (calls < 100000) { part = sr.run(1); calls++; if (part.done) break; }
      check(`④run(1) を ${calls} 回（${part && part.result}・${part && part.nodes}）＝まとめて（${whole.result}・${whole.nodes}）・押す列も同じ`, !!part && part.done && part.result === whole.result && part.nodes === whole.nodes && J(part.path) === J(whole.path), { part, whole });
      // ⑤ 戻し先
      const list = [ok, ok, near, stuck];
      const rw = L.makeRewind(list, { base0Sure: true }).run();
      const rw0 = L.makeRewind(list, { budget: 0, base0Sure: true }).run();
      const rwN = L.makeRewind([near, near, stuck], {}).run();
      let rwp = null; const mr = L.makeRewind(list, { base0Sure: true }); for (let i = 0; i < 100000; i++) { rwp = mr.run(1); if (rwp.done) break; }
      check(`⑤とける いちばん新しい k＝1（${rw.k}・sure ${rw.sure}）・小分けでも同じ（${rwp && rwp.k}）・budget 0 なら k＝0 で sure（${rw0.k}・${rw0.sure}）・どれも とけない（base0Sure なし）なら k＝0 で sure でない（${rwN.k}・${rwN.sure}）`, rw.done && rw.k === 1 && rw.sure === true && rwp.k === 1 && rw0.k === 0 && rw0.sure === true && rwN.k === 0 && rwN.sure === false, { rw, rw0, rwN });
      // ⑥ replayStates
      let s = L.createLevel(5, L.pickPicture(5, null)).state;
      const sol5 = L.createLevel(5, L.pickPicture(5, null)).info.solution;
      const presses = [];
      for (const c of sol5.slice(0, 4)) { s = settle(s); presses.push([s.t, c]); s = L.press(s, c).state; }
      const rsx = L.replayStates(5, L.pickPicture(5, null), presses);
      const same = rsx.ok && rsx.states.length === presses.length && rsx.states.every((st, k) => { const rp = L.replay(5, L.pickPicture(5, null), presses.slice(0, k), presses[k][0]); return rp.ok && J(rp.state.cells) === J(st.cells) && J(rp.state.cols) === J(st.cols) && J(rp.state.slots) === J(st.slots) && rp.state.t === st.t; });
      const bad = L.replayStates(5, L.pickPicture(5, null), [[0, 9]]);
      check(`⑥replayStates の ${presses.length} 局面＝replay で手前まで再生した局面（${same}）・押せない手なら ok false（${bad.ok}）`, same && bad.ok === false);
      // ⑦ 壊れた局面
      let threw = null;
      const outs = [];
      try { for (const x of [null, undefined, {}, 1, 'x', { cols: 1 }]) { outs.push(L.rescueSearch(x).result); outs.push(L.makeRewind(x).run().k); } outs.push(L.makeRewind([null, {}, 3]).run().k); } catch (e) { threw = e.message; }
      check(`⑦壊れた局面でも例外なし（${threw || 'なし'}）・unknown と k＝0（${J(outs)}）`, threw === null && outs.every((v) => v === 'unknown' || v === 0), { outs });
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
