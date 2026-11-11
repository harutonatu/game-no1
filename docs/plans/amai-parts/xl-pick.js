// 使い方：
//   node xl-pick.js measure <面 from> <面 to> > xl.<from>.json   （25〜36 面の 12 枚を、from〜to 面のそれぞれに置いて測る。4 つに分けて並列に流せる）
//   node xl-pick.js pick xl.*.json                              （決まりに合う並びを全部数え、ゆるいの数で選ぶ）
// あまいものあつめの 25〜36 面（XL）の並びの選び直し（2026-11-11。計画書 docs/plans/amai-parts.md §14.2）。
// 面の盤は「面の番号（種と面の表のふた・こおり）× 絵」で決まるので、同じ 12 枚でも並びで難しさが変わる。
// 測り方は docs/plans/amai-redraw/measure.js と同じ（ゆるい＝ふちの色の箱を 8 割で選ぶ、種 lv*131+k、40 回。でたらめ7割も同じ種）。
// 選び方（乱数なし）：12 枚の並び 12! 通りのうち、order.js の決まり（となりに同じ行動・場所・動物を続けない〔24→25 も〕、
//   最後の面が 37 面以上の連続 4 面に同じ行動は 1 回まで〔34〜36 面が入る〕、36→37 も）に合うものを全部数え、
//   ① 12 面のゆるいの合計が 並べ替える前（order-before.txt の並び）の合計にいちばん近い
//   ② ゆるいでクリアした回のはこびの中央（1 面の秒）が 170 秒にいちばん近い
//   ③ 前の帯（25〜30・31〜36 面）にいた帯のままの絵が多い ④ 前と同じ面の絵が多い ⑤ id の並びが辞書順で早い
//   の順に 1 つ選ぶ。選んだ並びは order.js の XL_PICK に写す。
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const O = require("./order.js");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ")[2]);
const before = read("order-before.txt");
const PICS = before.slice(24, 36);
const RUNS = 40, SEC_TARGET = 170;

function measure(from, to) {
  for (const f of "abcdef") require(path.join(root, `games/amai/pictures-${f}.js`));
  const L = require(path.join(root, "games/amai/logic.js"));
  function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function play(c, seed, pGood) {   // measure.js の play と同じ
    const rnd = rngOf(seed);
    let s = c.state, wait = 2 + Math.floor(rnd() * 6), ticks = 0;
    for (let g = 0; g < 40000; g++) {
      if (s.won) return { won: true, ticks };
      if (L.isStuck(s)) return { won: false, ticks };
      if (wait <= 0 || L.isStable(s)) {
        const can = [0, 1, 2, 3].filter((k) => L.canPress(s, k) === null);
        if (can.length) {
          const good = can.filter((k) => L.edgeCells(s, s.cols[k][0].color).length > 0);
          const pool = good.length && rnd() < pGood ? good : can;
          s = L.press(s, pool[Math.floor(rnd() * pool.length)]).state;
        }
        wait = 2 + Math.floor(rnd() * 6);
      }
      const r = L.step(s);
      if (r.moved) { s = r.state; ticks++; }
      wait--;
    }
    return { won: false, ticks };
  }
  const out = [];
  for (let lv = from; lv <= to; lv++) for (const id of PICS) {
    const c = L.createLevel(lv, { id, mirror: false, repeat: false });
    let loose = 0, rand7 = 0; const ticks = [];
    for (let k = 0; k < RUNS; k++) {
      if (play(c, lv * 7919 + k * 31 + 1, 0.3).won) rand7++;
      const r = play(c, lv * 131 + k, 0.8); if (r.won) { loose++; ticks.push(r.ticks); }
    }
    out.push({ lv, id, loose, rand7, ticks, fb: c.info.fallback });
  }
  process.stdout.write(JSON.stringify(out));
}

function pick(files) {
  const M = new Map();
  for (const f of files) for (const r of JSON.parse(fs.readFileSync(f, "utf8"))) M.set(r.lv + " " + r.id, r);
  if (M.size !== 144) throw new Error("12 枚 × 12 面の測りがそろっていない: " + M.size);
  const cur = read("order.txt");   // 24 面と 37 面からは選び直しで変わらない
  const score = (x) => {
    const rows = x.map((id, i) => M.get((25 + i) + " " + id));
    const t = rows.flatMap((r) => r.ticks).sort((a, b) => a - b);
    return { x, loose: rows.reduce((s, r) => s + r.loose, 0), rand7: rows.reduce((s, r) => s + r.rand7, 0),
      sec: Math.round(t[Math.floor(t.length / 2)] * 0.12),
      band: x.filter((id, i) => (PICS.indexOf(id) < 6) === (i < 6)).length, same: x.filter((id, i) => id === PICS[i]).length };
  };
  const target = score(PICS).loose;
  const seq = cur.slice(), used = new Array(12).fill(false), valid = [];
  const rec = (pos) => {
    if (pos === 36) {
      const r = O.countRules(seq.map((id, i) => (i < 2 ? {} : O.parseId(id))));
      if (!(r.act || r.place || r.animal || r.gap)) valid.push(score(seq.slice(24, 36)));
      return;
    }
    const pr = O.parseId(seq[pos - 1]);
    for (let i = 0; i < 12; i++) {
      if (used[i]) continue;
      const q = O.parseId(PICS[i]);
      if (q.a === pr.a || q.p === pr.p || q.c === pr.c) continue;
      used[i] = true; seq[pos] = PICS[i]; rec(pos + 1); used[i] = false;
    }
  };
  rec(24);
  valid.sort((a, b) => Math.abs(a.loose - target) - Math.abs(b.loose - target) || Math.abs(a.sec - SEC_TARGET) - Math.abs(b.sec - SEC_TARGET)
    || b.band - a.band || b.same - a.same || (a.x.join() < b.x.join() ? -1 : 1));
  const pct = (n) => (100 * n / (12 * RUNS)).toFixed(1) + "%";
  console.log("決まりに合う並び：" + valid.length + " 通り（ゆるい " + pct(Math.min(...valid.map((v) => v.loose))) + "〜" + pct(Math.max(...valid.map((v) => v.loose))) + "）");
  const band6 = valid.filter((v) => v.band === 12);
  console.log("帯を守る並び：" + band6.length + " 通り" + band6.map((v) => "（ゆるい " + pct(v.loose) + "・" + v.sec + " 秒）").join(""));
  const now = score(cur.slice(24, 36));
  console.log("前：ゆるい " + pct(target) + "／今の order.txt：ゆるい " + pct(now.loose) + "・" + now.sec + " 秒");
  console.log("上から 5 つ：");
  for (const v of valid.slice(0, 5)) console.log("  ゆるい " + pct(v.loose) + "・でたらめ7割 " + pct(v.rand7) + "・" + v.sec + " 秒・帯のまま " + v.band + "/12：" + v.x.join(" "));
}

if (process.argv[2] === "measure") measure(+process.argv[3], +process.argv[4]);
else if (process.argv[2] === "pick") pick(process.argv.slice(3));
else console.log("node xl-pick.js measure <from> <to> | pick <json…>");
