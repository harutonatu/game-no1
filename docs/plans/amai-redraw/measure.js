// 難しさと面を作る速さを測る台本（計画書 docs/plans/amai-redraw.md §8・考え方は amai-rework.md §10〜§13）。
// 使い方：node measure.js <面 from> <面 to> <回数> [つまみの JSON] > 出力.json
//   つまみの JSON：{"OVER":{...},"ANY_RATE":{...},"KSET":{...},"REPEAT_K":{...},"CARRY_TIERS":{...},"GEN_OPT":{...}}（logic.js の既定に上書き）
//   くり返しの面（BASE_PICTURES＋1 面から。今は 101 面）は、1〜BASE_PICTURES 面をクリアしたずかん（全部 1 回）から始め、面ごとにずかんへ足していく（ふつうに遊んだ人の順）。
//   遊び方：でたらめ7割＝ふちの色の箱を選ぶのが 3 割（あとはでたらめ）／ゆるい＝8 割／完全でたらめ＝0 割（1・2 面だけ 200 回）。
//   2〜7 はこびに 1 回押す（tests の loosePlay と同じ）。1手もどしは使わない。1 面の秒＝ゆるいでクリアした回のはこびの中央 × TICK_MS。
const path = require('path');
const root = path.resolve(__dirname, '../../..');
require(path.join(root, 'games/amai/pictures-a.js'));
require(path.join(root, 'games/amai/pictures-b.js'));
require(path.join(root, 'games/amai/pictures-c.js'));
const L = require(process.env.LOGIC || path.join(root, 'games/amai/logic.js'));   // LOGIC＝試しに書き換えた logic.js（測るだけ）
const [from, to, runs, knobs] = [+process.argv[2], +process.argv[3], +process.argv[4], process.argv[5] ? JSON.parse(process.argv[5]) : {}];
for (const [k, v] of Object.entries(knobs)) {
  const o = L[k];
  for (const kk of Object.keys(o)) if (!(kk in v)) continue;
  Object.assign(o, v);
}
const cpu = () => process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
const ms = (a) => { const b = cpu(); return ((b.user - a.user) + (b.system - a.system)) / 1000; };
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function play(c, seed, pGood) {
  const rnd = rngOf(seed);
  let s = c.state, wait = 2 + Math.floor(rnd() * 6), ticks = 0, presses = 0;
  for (let g = 0; g < 40000; g++) {
    if (s.won) return { won: true, ticks, presses };
    if (L.isStuck(s)) return { won: false, ticks, presses };
    if (wait <= 0 || L.isStable(s)) {
      const can = [0, 1, 2, 3].filter((k) => L.canPress(s, k) === null);
      if (can.length) {
        const good = can.filter((k) => L.edgeCells(s, s.cols[k][0].color).length > 0);
        const pool = good.length && rnd() < pGood ? good : can;
        s = L.press(s, pool[Math.floor(rnd() * pool.length)]).state; presses++;
      }
      wait = 2 + Math.floor(rnd() * 6);
    }
    const r = L.step(s);
    if (r.moved) { s = r.state; ticks++; }
    wait--;
  }
  return { won: false, ticks, presses, guard: true };
}
// ずかん：1〜BASE 面はクリア済み（1 回）。BASE＋1 面からは前の面の絵を足していく
const BASE = L.BASE_PICTURES;
let book = JSON.stringify({ v: 1, got: Object.fromEntries(L.PICTURE_ORDER.slice(0, BASE).map((p) => [p.id, 1])) });
const picks = {};
for (let lv = BASE + 1; lv <= Math.max(to, BASE + 1); lv++) { const pk = L.pickPicture(lv, book); picks[lv] = pk; book = L.addToBook(book, pk.id); }
L.createLevel(48, null); L.createLevel(30, null);   // 暖め
const out = [];
for (let lv = from; lv <= to; lv++) {
  const pk = lv > BASE ? picks[lv] : L.pickPicture(lv, null);
  const t0 = cpu(); const c = L.createLevel(lv, pk); const gen = ms(t0);
  const t1 = cpu(); const rp = L.replay(lv, pk, [], 0); const rep = ms(t1);
  // 不変：箱の持ち玉の合計＝角砂糖の数
  let sum = 0; for (const col of c.state.cols) for (const b of col) sum += b.count;
  const row = { lv, pic: pk.id, mirror: pk.mirror, repeat: pk.repeat, tier: c.info.params.tier, total: c.state.total, boxes: c.state.cols.flat().length, fb: c.info.fallback, tries: c.info.tries,
    gen: +gen.toFixed(2), rep: +rep.toFixed(2), repOk: rp.ok, sumOk: sum === c.state.total, rand7: 0, loose: 0, ticks: [], full: null };
  for (let k = 0; k < runs; k++) {
    if (play(c, lv * 7919 + k * 31 + 1, 0.3).won) row.rand7++;
    const r = play(c, lv * 131 + k, 0.8);
    if (r.won) { row.loose++; row.ticks.push(r.ticks); }
  }
  if (lv <= 2) { let w = 0; for (let k = 0; k < 200; k++) if (play(c, lv * 977 + k, 0).won) w++; row.full = w; }
  out.push(row);
  process.stderr.write(`${lv} `);
}
process.stdout.write(JSON.stringify({ runs, knobs, rows: out }));
