// 使い方：node docs/plans/amai-redraw/build.js
// 計画書 docs/plans/amai-redraw.md §4 の表（3〜48 面）・docs/plans/amai-more.md §2 の表（49〜100 面）・docs/plans/amai-more2.md §1 の表（101〜150 面）・
// docs/plans/amai-parts/combos/A〜E.md の表（151〜250 面。2026-11-09・2026-11-10 に部品で描いた 50＋50 枚。計画書 docs/plans/amai-parts.md §8・§13）（面・段・id・場面・季節）と
// <id>.txt（文字の地図。1 マス＝1 粒。2026-11-05 から 3〜150 面とも背景を角砂糖でうめた docs/plans/amai-bg/out/<id>.txt を読む。
// 元の絵（3〜48 面は amai-redraw/、49〜100 面は amai-more/、101〜150 面は amai-more2/）は bg.py の入力として残す。計画書 docs/plans/amai-bg.md。
// 151〜250 面は背景うめ済みの docs/plans/amai-parts/out/<id>.txt を読む）から、
// games/amai/pictures-a.js（りんご・さくらんぼ＋3〜24 面）・pictures-b.js（25〜48 面）・pictures-c.js（49〜100 面）・pictures-d.js（101〜150 面）・pictures-e.js（151〜200 面）・
// pictures-f.js（2026-11-10 に足した 50 枚）を書き出す（手で写さない）。
// 2026-11-10 の並べ替え（計画書 docs/plans/amai-parts.md §12〜§14・docs/plans/amai-parts/order.js）で面の番号が変わったが、a〜e.js は 1 文字も変えないため、
// どのファイルに入れるかと a〜e.js の説明の面の番号は、並べ替える前の番号（docs/plans/amai-parts/order-before.txt）で決める。
// pictures-f.js の説明の面の番号は並べ替えた後の番号（order.txt。combos/*.md の面の列と同じ）で、その順に並べる。
// りんご・さくらんぼは今の pictures-a.js から文字のまま写す。ファイルの頭の仕組み（UMD・AmaiPictures.add）も今のまま。
// 書き出す前に、全部の絵を logic.js の parsePicture と段の決まり（大きさ 64×48 以下・角砂糖と色の数）で確かめ、1 枚でも外れたら何も書かない。
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const ROOT = path.resolve(DIR, "../../..");
const PLAN = path.join(ROOT, "docs/plans/amai-redraw.md");
const OUT_A = path.join(ROOT, "games/amai/pictures-a.js");
const OUT_B = path.join(ROOT, "games/amai/pictures-b.js");
const OUT_C = path.join(ROOT, "games/amai/pictures-c.js");
const OUT_D = path.join(ROOT, "games/amai/pictures-d.js");
const OUT_E = path.join(ROOT, "games/amai/pictures-e.js");
const PLAN_MORE = path.join(ROOT, "docs/plans/amai-more.md");
const DIR_MORE = path.join(ROOT, "docs/plans/amai-more");
const PLAN_MORE2 = path.join(ROOT, "docs/plans/amai-more2.md");
const DIR_MORE2 = path.join(ROOT, "docs/plans/amai-more2");
const DIR_BG = path.join(ROOT, "docs/plans/amai-bg/out");   // 背景をうめた 148 枚（3〜150 面。amai-bg.md §4）
const DIR_COMBOS = path.join(ROOT, "docs/plans/amai-parts/combos");   // 151〜200 面の表（担当ごとに A〜E.md）
const DIR_PARTS = path.join(ROOT, "docs/plans/amai-parts/out");   // 部品で描いた 100 枚（背景うめ済み）
const OUT_F = path.join(ROOT, "games/amai/pictures-f.js");
const ORDER_BEFORE = path.join(ROOT, "docs/plans/amai-parts/order-before.txt");   // 並べ替える前の面の番号（ファイル分けに使う）
const ORDER_AFTER = path.join(ROOT, "docs/plans/amai-parts/order.txt");   // 並べ替えた後の面の番号（combos の面の列と同じか確かめる）
const L = require(path.join(ROOT, "games/amai/logic.js"));

// 段ごとの決まり（計画書 §4）：角砂糖の下限・上限、色の数の下限・上限
// 2026-11-05：背景をうめた 148 枚に合わせた（amai-bg/out/counts.md。約束 §2.1 の TIERS と同じ幅）
const RANGE = { S: [800, 1000, 4, 5], M: [1200, 1480, 5, 7], L: [2280, 3072, 7, 10], XL: [2860, 3072, 9, 11], XXL: [2400, 3072, 8, 12] };
const SPLIT = 24;   // 24 面までを pictures-a.js、25 面からを pictures-b.js
const SPLIT_C = 48;   // 49 面からを pictures-c.js
const SPLIT_D = 100;   // 101 面からを pictures-d.js
const SPLIT_E = 150;   // 151 面からを pictures-e.js
const SPLIT_F = 200;   // 並べ替える前の 201 面から（2026-11-10 に足した 50 枚）を pictures-f.js

function fail(msg) { console.error("build.js: " + msg); process.exit(1); }

// ---- 表を読む（amai-redraw.md §4：3〜48 面・amai-more.md §2：49〜100 面・amai-more2.md §1：101〜150 面）
function readTable(plan, dir) {
  const out = [];
  for (const line of fs.readFileSync(plan, "utf8").split("\n")) {
    const m = /^\|\s*(\d+)\s*\|\s*(S|M|L|XL|XXL)\s*\|\s*`([a-z]+)`\s*\|\s*([^|]+?)\s*\|\s*(""|haru|natsu|aki|fuyu)\s*\|\s*$/.exec(line);
    if (!m) continue;
    const name = m[4].replace(/（[^）]*）\s*$/, "").trim();   // 「（見本・済）」を外す
    out.push({ level: Number(m[1]), tier: m[2], id: m[3], name, season: m[5] === '""' ? "" : m[5], dir });
  }
  return out;
}
const rows1 = readTable(PLAN, DIR), rows2 = readTable(PLAN_MORE, DIR_MORE), rows3 = readTable(PLAN_MORE2, DIR_MORE2);
if (rows1.length !== 46) fail(`amai-redraw.md §4 の表が 46 行でない（${rows1.length}）`);
if (rows2.length !== 52) fail(`amai-more.md §2 の表が 52 行でない（${rows2.length}）`);
if (rows3.length !== 50) fail(`amai-more2.md §1 の表が 50 行でない（${rows3.length}）`);
// 151〜250 面：combos/A〜E.md（列は 面・段・id・名前・季節・場所・動物・ふるまい・置き方。id に ` は付けない）。
// 面の列は並べ替えた後の番号（order.txt と同じか確かめる）。level は並べ替える前の番号（order-before.txt）にする
function readOrder(file) {
  const m = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [n, , id] = line.split(" ");
    m.set(id, Number(n));
  }
  return m;
}
const BEFORE = readOrder(ORDER_BEFORE), AFTER = readOrder(ORDER_AFTER);
if (BEFORE.size !== 250 || AFTER.size !== 250) fail(`order-before.txt・order.txt が 250 枚でない（${BEFORE.size}・${AFTER.size}）`);
const rows4 = [];
for (const f of ["A", "B", "C", "D", "E"]) {
  for (const line of fs.readFileSync(path.join(DIR_COMBOS, f + ".md"), "utf8").split("\n")) {
    const m = /^\|\s*(\d+)\s*\|\s*(S|M|L|XL|XXL)\s*\|\s*([a-z]+)\s*\|\s*([^|]+?)\s*\|\s*(""|haru|natsu|aki|fuyu)\s*\|/.exec(line);
    if (!m) continue;
    if (AFTER.get(m[3]) !== Number(m[1])) fail(`combos/${f}.md の面の列が order.txt とちがう：${m[3]} ${m[1]}`);
    if (!BEFORE.has(m[3])) fail(`order-before.txt に無い：${m[3]}`);
    rows4.push({ level: BEFORE.get(m[3]), no: Number(m[1]), tier: m[2], id: m[3], name: m[4].trim(), season: m[5] === '""' ? "" : m[5], src: DIR_PARTS });
  }
}
rows4.sort((x, y) => x.level - y.level);
if (rows4.length !== 100) fail(`combos/A〜E.md の表が 100 行でない（${rows4.length}）`);
const rows = rows1.concat(rows2, rows3, rows4);
rows.forEach((r, i) => { if (r.level !== i + 3) fail(`表の面の番号（並べ替える前）が 3〜250 の順でない（${r.level}）`); });

// ---- 地図を読んで確かめる
const ids = new Set(), names = new Set(["りんご", "さくらんぼ"]);
for (const r of rows) {
  if (ids.has(r.id)) fail(`id が重なる：${r.id}`);
  if (names.has(r.name)) fail(`名前が重なる：${r.name}`);
  ids.add(r.id); names.add(r.name);
  const file = path.join(r.src || DIR_BG, r.id + ".txt");
  if (!fs.existsSync(file)) fail(`地図が無い：${file}`);
  r.map = fs.readFileSync(file, "utf8").split("\n").map((s) => s.trimEnd()).filter((s) => s.length);
  const p = L.parsePicture({ id: r.id, name: r.name, season: r.season, map: r.map }, false);
  if (!p) fail(`parsePicture が null：${r.level} 面 ${r.id}`);
  if (p.W > 64 || p.H > 48) fail(`大きさが 64×48 を超える：${r.id} ${p.W}×${p.H}`);
  const cnt = {};
  let sugar = 0;
  for (const row of r.map) for (const c of row) if (c !== ".") { cnt[c] = (cnt[c] || 0) + 1; sugar++; }
  const R = RANGE[r.tier];
  const nc = Object.keys(cnt).length;
  if (sugar < R[0] || sugar > R[1]) fail(`角砂糖の数が段 ${r.tier} の範囲外：${r.id} ${sugar}`);
  if (nc < R[2] || nc > R[3]) fail(`色の数が段 ${r.tier} の範囲外：${r.id} ${nc}`);
  r.W = p.W; r.H = p.H; r.sugar = sugar;
  r.colors = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).join(" ");
}

// ---- 今の pictures-a.js から、頭の仕組みと りんご・さくらんぼ を文字のまま取る
const srcA = fs.readFileSync(OUT_A, "utf8").split("\n");
const addAt = srcA.findIndex((s) => s === "  AmaiPictures.add([");
if (addAt < 0) fail("pictures-a.js に「  AmaiPictures.add([」が無い");
const head = srcA.slice(1, addAt + 1);   // 1 行目（説明）は書き直す
const ringoAt = srcA.findIndex((s) => /^ {4}\/\/ 1 りんご/.test(s));
const sakuraAt = srcA.findIndex((s) => /^ {4}\{ id: "sakuranbo"/.test(s));
if (ringoAt < 0 || sakuraAt < 0) fail("pictures-a.js に りんご・さくらんぼ が無い");
let endAt = -1;
for (let i = sakuraAt; i < srcA.length; i++) if (srcA[i] === "    ] },") { endAt = i; break; }
if (endAt < 0) fail("さくらんぼの終わりが見つからない");
const easy = srcA.slice(ringoAt, endAt + 1).map((s) => s.replace("ほかの 46 枚は 1 マスを 2×2 に割ってある", "3〜48 面の 46 枚は 1 マス＝1 粒で描いた場面").replace("3〜48 面の 46 枚は 1 マス＝1 粒で描いた場面", "3〜100 面の 98 枚は 1 マス＝1 粒で描いた場面").replace("3〜100 面の 98 枚は 1 マス＝1 粒で描いた場面", "3〜150 面の 148 枚は 1 マス＝1 粒で描いた場面"));

const q = (s) => JSON.stringify(s);
function entry(r) {
  const season = r.season ? `・季節 ${r.season}` : "";
  return [
    `    // ${r.level > SPLIT_F ? r.no : r.level} ${r.name}（${r.tier} 段。${r.W}×${r.H}・${r.colors}・角砂糖 ${r.sugar}${season}）`,
    `    { id: ${q(r.id)}, name: ${q(r.name)}, season: ${q(r.season)}, map: [`,
    ...r.map.map((s) => `      ${q(s)},`),
    "    ] },",
  ];
}
function file(first, body) {
  return [first, ...head, ...body, "  ]);", "", "  return AmaiPictures;", "});", ""].join("\n");
}
const NOTE = "地図は docs/plans/amai-bg/out/<id>.txt（背景も角砂糖でうめた絵）から build.js で書き出す（手で直さない）。1 マス＝1 粒で描いた場面の絵。文字の地図の決まりは docs/ari-contract.md §2.6。";
const a = file(`// あまいものあつめ：1〜24 面の絵（りんご・さくらんぼ＋3〜24 面の場面）。${NOTE}`,
  [...easy, ...rows.filter((r) => r.level <= SPLIT).flatMap(entry)]);
const b = file(`// あまいものあつめ：25〜48 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT && r.level <= SPLIT_C).flatMap(entry));
const c = file(`// あまいものあつめ：49〜100 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT_C && r.level <= SPLIT_D).flatMap(entry));
const d = file(`// あまいものあつめ：101〜150 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT_D && r.level <= SPLIT_E).flatMap(entry));
const NOTE_E = "地図は docs/plans/amai-parts/out/<id>.txt（部品で組み立て、背景も角砂糖でうめた絵。計画書 docs/plans/amai-parts.md）から build.js で書き出す（手で直さない）。1 マス＝1 粒で描いた場面の絵。文字の地図の決まりは docs/ari-contract.md §2.6。";
const e = file(`// あまいものあつめ：151〜200 面の絵（場面）。${NOTE_E}`,
  rows.filter((r) => r.level > SPLIT_E && r.level <= SPLIT_F).flatMap(entry));
const f = file(`// あまいものあつめ：2026-11-10 に足した 50 枚の絵（場面。面の番号は並べ替えた後。docs/plans/amai-parts/order.txt）。${NOTE_E}`,
  rows.filter((r) => r.level > SPLIT_F).sort((x, y) => x.no - y.no).flatMap(entry));
fs.writeFileSync(OUT_A, a);
fs.writeFileSync(OUT_B, b);
fs.writeFileSync(OUT_C, c);
fs.writeFileSync(OUT_D, d);
fs.writeFileSync(OUT_E, e);
fs.writeFileSync(OUT_F, f);
console.log(`書き出した：pictures-a.js（2＋${rows.filter((r) => r.level <= SPLIT).length} 枚）・pictures-b.js（${rows.filter((r) => r.level > SPLIT && r.level <= SPLIT_C).length} 枚）・pictures-c.js（${rows.filter((r) => r.level > SPLIT_C && r.level <= SPLIT_D).length} 枚）・pictures-d.js（${rows.filter((r) => r.level > SPLIT_D && r.level <= SPLIT_E).length} 枚）・pictures-e.js（${rows.filter((r) => r.level > SPLIT_E && r.level <= SPLIT_F).length} 枚）・pictures-f.js（${rows.filter((r) => r.level > SPLIT_F).length} 枚）`);
