// 使い方：node check.js <id>…   （out/<id>.txt を読み、ゲームの parsePicture と段 XXL の範囲・2×2 でないことを確かめる）
// amai-redraw/check.js と同じ確かめ（範囲は build.js の RANGE。2026-11-05 の背景うめの後）。PNG は compose.py が作る。
const fs = require('fs'), path = require('path');
const L = require(path.resolve(__dirname, '../../../games/amai/logic.js'));
const RANGE = { S: [800, 1000, 4, 5], M: [1200, 1480, 5, 7], L: [2280, 3072, 7, 10], XL: [2860, 3072, 9, 11], XXL: [2400, 3072, 8, 12] };
const tier = process.env.TIER || 'XXL';
let bad = 0;
for (const id of process.argv.slice(2)) {
  const map = fs.readFileSync(path.join(__dirname, 'out', id + '.txt'), 'utf8').split('\n').map((s) => s.trimEnd()).filter((s) => s.length);
  const p = L.parsePicture({ id, name: 'え', season: '', map }, false);
  const R = RANGE[tier];
  const cnt = {}; let sugar = 0;
  for (const r of map) for (const c of r) if (c !== '.') { cnt[c] = (cnt[c] || 0) + 1; sugar++; }
  const nc = Object.keys(cnt).length;
  let odd = 0;
  for (const r of map) for (let x = 1; x < r.length; x += 2) if (r[x] !== r[x - 1]) odd++;
  const ok = !!p && sugar >= R[0] && sugar <= R[1] && nc >= R[2] && nc <= R[3] && odd > 0;
  if (!ok) bad++;
  console.log(`${id}: parsePicture ${p ? 'OK' : 'NG'}  大きさ ${map[0].length}x${map.length}  角砂糖 ${sugar}（${R[0]}〜${R[1]}）  色 ${nc}（${R[2]}〜${R[3]}）  2×2 でない ${odd > 0 ? 'OK' : 'NG'}  → ${ok ? '合格' : '不合格'}`, JSON.stringify(cnt));
}
process.exit(bad ? 1 : 0);
