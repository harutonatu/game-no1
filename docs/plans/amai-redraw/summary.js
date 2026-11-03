// measure.js の出力（いくつかの JSON）をまとめて、段ごとの表（Markdown）にする。使い方：node summary.js a.json b.json …
const fs = require('fs');
const rows = []; let runs = 0;
for (const f of process.argv.slice(2)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); runs = j.runs; rows.push(...j.rows); }
rows.sort((a, b) => a.lv - b.lv);
const med = (a) => { const t = a.slice().sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : null; };
const BASE = +(process.env.BASE || 100);   // くり返しの始まりの手前（logic.js の BASE_PICTURES）
const grp = (r) => (r.repeat ? `くり返し(${BASE + 1}–)` : r.lv > 48 ? 'XXL 新(49–100)' : { S: 'S(1–4)', M: 'M(5–12)', L: 'L(13–24)', XL: 'XL(25–36)', XXL: 'XXL(37–48)' }[r.tier]);
const G = {};
for (const r of rows) (G[grp(r)] ||= []).push(r);
let md = `| 段 | でたらめ7割% | ゆるい% | 1 面の秒（中央） | 作る時間 最大ms | 作る時間 中央ms | replay 最大ms | 予備1 | 合計≠砂糖 |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const [g, rs] of Object.entries(G)) {
  const n = rs.length * runs;
  const ticks = rs.flatMap((r) => r.ticks);
  md += `| ${g} | ${(100 * rs.reduce((s, r) => s + r.rand7, 0) / n).toFixed(0)} | ${(100 * rs.reduce((s, r) => s + r.loose, 0) / n).toFixed(0)} | ${ticks.length ? Math.round(med(ticks) * 0.12) : '-'} | ${Math.max(...rs.map((r) => r.gen)).toFixed(1)} | ${med(rs.map((r) => r.gen)).toFixed(1)} | ${Math.max(...rs.map((r) => r.rep)).toFixed(1)} | ${rs.filter((r) => r.fb === 1).length} | ${rs.filter((r) => !r.sumOk).length} |\n`;
}
{ // XXL をまとめた行（37–100。目安は段ごと）
  const rs = rows.filter((r) => r.tier === 'XXL' && !r.repeat);
  if (rs.length) { const n = rs.length * runs; const ticks = rs.flatMap((r) => r.ticks);
    md += `| XXL 全(37–100) | ${(100 * rs.reduce((s, r) => s + r.rand7, 0) / n).toFixed(0)} | ${(100 * rs.reduce((s, r) => s + r.loose, 0) / n).toFixed(0)} | ${ticks.length ? Math.round(med(ticks) * 0.12) : '-'} | ${Math.max(...rs.map((r) => r.gen)).toFixed(1)} | ${med(rs.map((r) => r.gen)).toFixed(1)} | ${Math.max(...rs.map((r) => r.rep)).toFixed(1)} | ${rs.filter((r) => r.fb === 1).length} | ${rs.filter((r) => !r.sumOk).length} |\n`; }
}
const full = rows.filter((r) => r.full !== null).map((r) => `${r.lv} 面 ${r.full}/200`).join('・');
md += `\n完全でたらめ（1・2 面）：${full}\n\n面ごと：\n\n| 面 | 段 | 絵 | 砂糖 | 箱 | でたらめ7割 | ゆるい | 秒 | 作る ms | replay ms | tries | 予備 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.lv} | ${r.tier}${r.repeat ? '・くり返し' : ''}${r.mirror ? '・反転' : ''} | ${r.pic} | ${r.total} | ${r.boxes} | ${r.rand7}/${runs} | ${r.loose}/${runs} | ${r.ticks.length ? Math.round(med(r.ticks) * 0.12) : '-'} | ${r.gen} | ${r.rep} | ${r.tries} | ${r.fb} |\n`;
console.log(md);
