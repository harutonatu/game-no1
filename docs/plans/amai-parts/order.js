// 使い方：node docs/plans/amai-parts/order.js [--combos]
// あまいものあつめの面の並べ替え（計画書 docs/plans/amai-parts.md §12〜§14・約束 docs/ari-contract.md §2.6 の「面の並べ方の決まり」）。
// 入力：order-before.txt（並べ替える前の 250 枚。1〜200 面は v76 の PICTURE_ORDER、201〜250 面は combos/*.md の仮の面）。
// 出力：order.txt（並べ替えた 250 枚。「面 段 id」）。--combos のときは combos/A〜E.md の表の「面」の列だけを新しい番号に書き直す
//   （表の行を読んで列に分け、面の列だけを替えて組み直す。ほかの列・ほかの行は 1 文字も変えない）。
// 決まり（3 面から。1・2 面〔ringo・sakuranbo〕は動かさない。並べ替えは段〔S〜XXL〕の中だけ）：
//   - となりの面に同じ行動・同じ場所・同じ動物を続けない（3〜250 面）
//   - 37 面から（XXL）と 36→37 面の境目：同じ行動は間を 3 面以上あける（最後の面が 37 面以上の、どの連続 4 面にも同じ行動は 1 回まで）
//   - 3〜36 面（S〜XL）は行動が 3 種類だけなので、間をあける決まりは使わない（2026-11-11 ユーザー「おすすめで」）
// 計算：乱数を使わない。段ごとに前から 1 面ずつ、決まりに合う絵のうち
//   ① 残りの数が多くて今置かないと間に合わない行動の絵 ② 「今の位置からの近さ＋散らす点（2〜4 面前と同じ場所・2 面前と同じ動物）」が小さい絵 ③ 前の位置が早い絵
//   の順に選ぶ（深さ優先。行き詰まったら戻る）。
// 25〜36 面（XL）の選び直し（2026-11-11。PM の案「25〜36 面だけ、並べ方の決まりを守ったまま、難しさが前に近くなる並びを選び直す（絵は変えない）」に
//   ユーザー「良いです」。計画書 §14.2）：上の計算で全部の段を並べたあと（37 面からは上の計算のまま。XL を先に替えると 37 面からの散らす点が変わるため）、
//   25〜36 面だけを XL_PICK に置きかえる。XL_PICK は xl-pick.js が選んだ並び（決まりに合う 12 枚の並び 229 通りを全部数え、
//   ゆるいの合計が並べ替える前にいちばん近く、次に 1 面の秒が 170 秒に近いもの。前の帯〔25〜30・31〜36 面〕を全部守る並びは 1 通りだけで ゆるい 25% だった）。
"use strict";
const fs = require("fs");
const path = require("path");
const DIR = __dirname;

const ANIMALS = "neko kuma usagi inu panda pengin zou buta kaeru".split(" ");
const PLACES = "kouen umibe daidokoro yukiyama mori hanabatake machi yuuenchi hoshizora".split(" ");
const ACTS = "oyatsu booru nemuru oekaki odoru hon utau jitensha".split(" ");
const TIER_ORDER = ["S", "M", "L", "XL", "XXL"];
const GAP_FROM = 37;   // ここから（最後の面がこの番号以上の連続 4 面）は同じ行動の間を 3 面以上あける
const WIN = 4;
// 25〜36 面の並び（xl-pick.js が選んだもの。上の説明）
const XL_PICK = ["kumaumibenemuru", "inudaidokorooyatsu", "nekoumibenemuru", "kumadaidokorobooru", "usagiumibenemuru", "inudaidokorobooru",
  "nekokouenoyatsu", "inuumibenemuru", "kumakouenbooru", "nekodaidokoronemuru", "inuyukiyamaoyatsu", "nekoumibebooru"];
const XL_FROM = 25;

function parseId(id) {
  for (const a of ANIMALS) {
    if (!id.startsWith(a)) continue;
    for (const p of PLACES) {
      if (!id.startsWith(a + p)) continue;
      const c = id.slice(a.length + p.length);
      if (ACTS.includes(c)) return { a, p, c };
    }
  }
  return null;
}

function readBefore() {
  const list = [];
  for (const line of fs.readFileSync(path.join(DIR, "order-before.txt"), "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [n, tier, id] = line.split(" ");
    list.push({ n: Number(n), tier, id });
  }
  list.forEach((x, i) => { if (x.n !== i + 1) throw new Error("order-before.txt の面の番号が続いていない: " + x.n); });
  for (let i = 2; i < list.length; i++) {
    const q = parseId(list[i].id);
    if (!q) throw new Error("id を動物・場所・行動に読めない: " + list[i].id);
    Object.assign(list[i], q);
  }
  return list;
}

// 決まりを数える（テスト AL と同じ数え方）。arr は { a, p, c } の並び（0 始まり。1・2 面は数えない）
function countRules(arr) {
  const r = { act: 0, place: 0, animal: 0, gap: 0 };
  for (let i = 2; i + 1 < arr.length; i++) {
    if (arr[i].c === arr[i + 1].c) r.act++;
    if (arr[i].p === arr[i + 1].p) r.place++;
    if (arr[i].a === arr[i + 1].a) r.animal++;
  }
  for (let e = 3; e < arr.length; e++) {   // e＝連続 4 面の最後（0 始まり）
    if (e + 1 < GAP_FROM) continue;
    const s = Math.max(2, e - WIN + 1);
    const seen = new Set();
    for (let k = s; k <= e; k++) { if (seen.has(arr[k].c)) { r.gap++; break; } seen.add(arr[k].c); }
  }
  return r;
}

function solve(before) {
  const out = before.slice(0, 2);
  let nodes = 0;
  for (const tier of TIER_ORDER) {
    const items = before.slice(2).filter((x) => x.tier === tier);
    const start = out.length;
    const used = new Array(items.length).fill(false);
    const rem = {};
    for (const x of items) rem[x.c] = (rem[x.c] || 0) + 1;
    const ok = (x) => {
      const n = out.length;   // 置く位置（0 始まり）
      if (n > 2) { const pr = out[n - 1]; if (pr.c === x.c || pr.p === x.p || pr.a === x.a) return false; }
      if (n + 1 >= GAP_FROM) for (let k = 1; k < WIN && n - k >= 2; k++) if (out[n - k].c === x.c) return false;
      return true;
    };
    const gapTier = start + 1 >= GAP_FROM;
    const rec = () => {
      const pos = out.length;
      if (pos - start === items.length) return true;
      if (++nodes > 5e6) throw new Error("並びが見つからない（探しすぎ）: " + tier);
      const left = start + items.length - pos;
      const cand = [];
      for (let i = 0; i < items.length; i++) if (!used[i] && ok(items[i])) cand.push(i);
      const urgent = (x) => (gapTier && rem[x.c] * WIN >= left ? 0 : 1);
      const near = (x) => Math.abs((x.n - 1) - pos);
      // 散らす：2〜4 面前に同じ場所があれば 1 つにつき 3、2 面前に同じ動物があれば 2 を、近さに足す
      const spread = (x) => {
        let s = 0;
        for (let k = 2; k <= 4 && pos - k >= 2; k++) if (out[pos - k].p === x.p) s += 3;
        if (pos - 2 >= 2 && out[pos - 2].a === x.a) s += 2;
        return s;
      };
      cand.sort((i, j) => {
        const a = items[i], b = items[j];
        return urgent(a) - urgent(b) || (near(a) + spread(a)) - (near(b) + spread(b)) || a.n - b.n;
      });
      for (const i of cand) {
        used[i] = true; rem[items[i].c]--; out.push(items[i]);
        if (rec()) return true;
        out.pop(); rem[items[i].c]++; used[i] = false;
      }
      return false;
    };
    if (!rec()) throw new Error("並びが見つからない: " + tier);
  }
  // 25〜36 面を XL_PICK に置きかえる（同じ 12 枚であることを確かめる）
  const xl = out.slice(XL_FROM - 1, XL_FROM - 1 + XL_PICK.length);
  if (xl.some((x) => x.tier !== "XL") || xl.map((x) => x.id).sort().join() !== XL_PICK.slice().sort().join()) throw new Error("XL_PICK が 25〜36 面の 12 枚と合わない");
  const byId = new Map(xl.map((x) => [x.id, x]));
  XL_PICK.forEach((id, i) => { out[XL_FROM - 1 + i] = byId.get(id); });
  return out;
}

// combos/*.md の面の列だけを書き直す
function rewriteCombos(newNo) {
  let changed = 0;
  for (const f of ["A", "B", "C", "D", "E"]) {
    const file = path.join(DIR, "combos", f + ".md");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const res = lines.map((line) => {
      if (!line.startsWith("| ")) return line;
      const cells = line.split("|");
      // cells[0]＝""、cells[1]＝面、cells[2]＝段、cells[3]＝id、… 最後＝""
      if (cells.length < 11 || !/^ \d+ $/.test(cells[1])) return line;
      const id = cells[3].trim();
      if (!newNo.has(id)) throw new Error(f + ".md の id が並びに無い: " + id);
      const next = cells.slice();
      next[1] = " " + newNo.get(id) + " ";
      const out = next.join("|");
      // 確かめ：面の列のほかは同じ
      if (out.slice(out.indexOf("|", 2)) !== line.slice(line.indexOf("|", 2))) throw new Error("面の列のほかが変わった: " + id);
      if (out !== line) changed++;
      return out;
    });
    fs.writeFileSync(file, res.join("\n"));
  }
  return changed;
}

function main() {
  const before = readBefore();
  const after = solve(before);
  const ids = new Set(after.map((x) => x.id));
  if (after.length !== before.length || ids.size !== before.length) throw new Error("枚数が合わない");
  after.forEach((x, i) => { if (before[i].tier !== x.tier) throw new Error("段の並びが変わった: " + (i + 1)); });
  const b = countRules(before), a = countRules(after);
  if (a.act || a.place || a.animal || a.gap) throw new Error("決まりに合わない: " + JSON.stringify(a));
  fs.writeFileSync(path.join(DIR, "order.txt"),
    "# 並べ替えた 250 枚（order.js が書き出す。手で直さない）。面 段 id\n" + after.map((x, i) => `${i + 1} ${x.tier} ${x.id}`).join("\n") + "\n");
  let moved = 0, maxMove = 0;
  after.forEach((x, i) => { const d = Math.abs(x.n - 1 - i); if (d) moved++; if (d > maxMove) maxMove = d; });
  console.log("前：となりで同じ行動 " + b.act + "・場所 " + b.place + "・動物 " + b.animal + "・37 面からの連続 4 面に同じ行動 " + b.gap);
  console.log("後：となりで同じ行動 " + a.act + "・場所 " + a.place + "・動物 " + a.animal + "・37 面からの連続 4 面に同じ行動 " + a.gap);
  console.log("動いた絵 " + moved + " 枚・いちばん大きく動いた " + maxMove + " 面");
  console.log("新しい 50 枚の面：" + after.map((x, i) => (x.n > 200 ? i + 1 : 0)).filter(Boolean).join(" "));
  if (process.argv.includes("--combos")) {
    const no = new Map(after.map((x, i) => [x.id, i + 1]));
    console.log("combos の面を書き直した行：" + rewriteCombos(no));
  }
}

if (require.main === module) main();
module.exports = { parseId, countRules, ANIMALS, PLACES, ACTS, GAP_FROM };
