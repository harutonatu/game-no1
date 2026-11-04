// 使い方：node docs/plans/amai-redraw/build.js
// 計画書 docs/plans/amai-redraw.md §4 の表（3〜48 面）・docs/plans/amai-more.md §2 の表（49〜100 面）・docs/plans/amai-more2.md §1 の表（101〜150 面）（面・段・id・場面・季節）と
// <id>.txt（文字の地図。1 マス＝1 粒。3〜48 面は amai-redraw/、49〜100 面は amai-more/、101〜150 面は amai-more2/）から、
// games/amai/pictures-a.js（りんご・さくらんぼ＋3〜24 面）・pictures-b.js（25〜48 面）・pictures-c.js（49〜100 面）・pictures-d.js（101〜150 面）を書き出す（手で写さない）。
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
const PLAN_MORE = path.join(ROOT, "docs/plans/amai-more.md");
const DIR_MORE = path.join(ROOT, "docs/plans/amai-more");
const PLAN_MORE2 = path.join(ROOT, "docs/plans/amai-more2.md");
const DIR_MORE2 = path.join(ROOT, "docs/plans/amai-more2");
const L = require(path.join(ROOT, "games/amai/logic.js"));

// 段ごとの決まり（計画書 §4）：角砂糖の下限・上限、色の数の下限・上限
const RANGE = { S: [476, 692, 3, 4], M: [856, 1128, 4, 5], L: [1264, 1600, 5, 7], XL: [1688, 2240, 6, 8], XXL: [2096, 2576, 8, 10] };
const SPLIT = 24;   // 24 面までを pictures-a.js、25 面からを pictures-b.js
const SPLIT_C = 48;   // 49 面からを pictures-c.js
const SPLIT_D = 100;   // 101 面からを pictures-d.js

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
const rows = rows1.concat(rows2, rows3);
rows.forEach((r, i) => { if (r.level !== i + 3) fail(`表の面の番号が 3〜150 の順でない（${r.level}）`); });

// ---- 地図を読んで確かめる
const ids = new Set(), names = new Set(["りんご", "さくらんぼ"]);
for (const r of rows) {
  if (ids.has(r.id)) fail(`id が重なる：${r.id}`);
  if (names.has(r.name)) fail(`名前が重なる：${r.name}`);
  ids.add(r.id); names.add(r.name);
  const file = path.join(r.dir, r.id + ".txt");
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
    `    // ${r.level} ${r.name}（${r.tier} 段。${r.W}×${r.H}・${r.colors}・角砂糖 ${r.sugar}${season}）`,
    `    { id: ${q(r.id)}, name: ${q(r.name)}, season: ${q(r.season)}, map: [`,
    ...r.map.map((s) => `      ${q(s)},`),
    "    ] },",
  ];
}
function file(first, body) {
  return [first, ...head, ...body, "  ]);", "", "  return AmaiPictures;", "});", ""].join("\n");
}
const NOTE = "地図は docs/plans/amai-redraw/<id>.txt・amai-more/<id>.txt・amai-more2/<id>.txt から build.js で書き出す（手で直さない）。1 マス＝1 粒で描いた場面の絵。文字の地図の決まりは docs/ari-contract.md §2.6。";
const a = file(`// あまいものあつめ：1〜24 面の絵（りんご・さくらんぼ＋3〜24 面の場面）。${NOTE}`,
  [...easy, ...rows.filter((r) => r.level <= SPLIT).flatMap(entry)]);
const b = file(`// あまいものあつめ：25〜48 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT && r.level <= SPLIT_C).flatMap(entry));
const c = file(`// あまいものあつめ：49〜100 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT_C && r.level <= SPLIT_D).flatMap(entry));
const d = file(`// あまいものあつめ：101〜150 面の絵（場面）。${NOTE}`,
  rows.filter((r) => r.level > SPLIT_D).flatMap(entry));
fs.writeFileSync(OUT_A, a);
fs.writeFileSync(OUT_B, b);
fs.writeFileSync(OUT_C, c);
fs.writeFileSync(OUT_D, d);
console.log(`書き出した：pictures-a.js（2＋${rows.filter((r) => r.level <= SPLIT).length} 枚）・pictures-b.js（${rows.filter((r) => r.level > SPLIT && r.level <= SPLIT_C).length} 枚）・pictures-c.js（${rows.filter((r) => r.level > SPLIT_C && r.level <= SPLIT_D).length} 枚）・pictures-d.js（${rows.filter((r) => r.level > SPLIT_D).length} 枚）`);
