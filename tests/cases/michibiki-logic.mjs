// FL: ミチビキ空港の計算ロジック（Node で games/michibiki/logic.js を直接読む。ブラウザ不要）
//   契約は docs/michibiki-contract.md（§1 ルール、§3 定数・滑走路・難しさ、§4 ロジックの API、§13.2 FL の項目）。
//   局面は契約 §4.1 の state の形を手で組む（world・P）。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・MichibikiLogic を公開していなければ例外で不合格にする。
//   場所の決め方（tall 320×520）：滑走路は あか (100,170)→右・あお (220,330)→左・きいろ (70,300)→下。y ≥ 410 の帯には何も無いので、
//   動き・ぶつかる・跳ね返るの確認はそこで行う。
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

function load(root) {
  const f = path.join(root, 'games/michibiki/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/michibiki/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.update !== 'function' || typeof L.setPath !== 'function') throw new Error('logic.js が MichibikiLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const near = (a, b, eps = 1e-6) => typeof a === 'number' && Math.abs(a - b) <= eps;
const hyp = (ax, ay, bx, by) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

// ---- 局面を手で組む ----
// 機体（契約 §4.1 の形）。dx, dy は単位ベクトルで渡す
function P(L, id, color, x, y, dx, dy, o = {}) {
  const kind = o.kind || 'normal';
  return { id, color, kind, x, y, dx, dy, speed: L.SPEED[kind], path: null, pathI: 0, guided: false, near: false, wrongIn: null, phase: 'fly', landTick: null, ...o };
}
// 機体だけの場（予告なし・次の予告はずっと先）。landed から colors を決める（colors を渡せば上書き）
function world(L, planes, { layout = 'tall', landed = 0, colors, lives = 3, tick = 0, nextSpawnTick = 1e8, warns = [], seed = 1 } = {}) {
  const b = L.newGame(seed, layout);
  const maxId = Math.max(-1, ...planes.map((p) => p.id), ...warns.map((w) => w.id));
  return { ...b, tick, landed, lives, over: false, colors: colors ?? L.colorsFor(landed), nextId: maxId + 1, nextSpawnTick, planes, warns, stats: { crashes: 0, guidedLandings: 0, freeLandings: 0, bounces: 0, wrongWays: 0 } };
}
// 1コマずつ進めて、出来事に tick を付けて集める。stop(state, eventsOfThisTick) が真なら止める
function run(L, s, n, stop) {
  const evs = [];
  for (let i = 0; i < n; i++) {
    const r = L.update(s);
    s = r.state;
    for (const e of r.events) evs.push({ ...e, tick: s.tick });
    if (stop && stop(s, r.events)) break;
  }
  return { s, evs };
}
const plane = (s, id) => s.planes.find((p) => p.id === id);
const ofType = (evs, t) => evs.filter((e) => e.type === t);
// 線分 a-b と点 p の距離
function segPt(ax, ay, bx, by, px, py) {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
  return hyp(ax + vx * t, ay + vy * t, px, py);
}
// 線分どうしの距離（交われば 0）
function segSeg(a, b, c, d) {
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segPt(...c, ...d, ...a), segPt(...c, ...d, ...b), segPt(...a, ...b, ...c), segPt(...a, ...b, ...d));
}
// 半直線 (x,y)+(dx,dy)t（t≥0）が箱 [x0,x1]×[y0,y1] を通るか（slab）
function rayHitsBox(x, y, dx, dy, x0, x1, y0, y1) {
  let t0 = 0, t1 = Infinity;
  for (const [p, d, lo, hi] of [[x, dx, x0, x1], [y, dy, y0, y1]]) {
    if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1;
}
const RW_TABLE = { tall: [[100, 170, 1, 0], [220, 330, -1, 0], [70, 300, 0, 1]], wide: [[130, 100, 1, 0], [410, 220, -1, 0], [260, 210, 0, -1]] };
const median = (a) => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };

// 自分で回す自動プレイ（FL9・FL10）：policy 'none' | 'naive'（出たら入り口へ一直線）| 'straight'（出たら suggestPath）
function sim(L, seed, policy, { layout = 'tall', maxTicks = 54000, onTick } = {}) {
  let s = L.newGame(seed, layout);
  const spawned = [], landedIds = new Set(), crashedIds = new Set();
  let crashPairs = 0;
  for (let i = 0; i < maxTicks && !s.over; i++) {
    const prev = s;
    const r = L.update(s);
    s = r.state;
    for (const e of r.events) {
      if (e.type === 'spawn') {
        spawned.push(e.id);
        if (policy !== 'none') {
          const p = plane(s, e.id);
          if (p) {
            let pts = null;
            if (policy === 'naive') { const rw = L.runwaysFor(s).find((x) => x.color === p.color); pts = rw && [[rw.ex, rw.ey]]; }
            else pts = L.suggestPath(s, e.id);
            if (pts) { const sp = L.setPath(s, e.id, pts); if (sp.ok) s = sp.state; }
          }
        }
      } else if (e.type === 'land') landedIds.add(e.id);
      else if (e.type === 'crash') { crashPairs++; (e.ids || []).forEach((id) => crashedIds.add(id)); }
    }
    if (onTick && onTick(prev, s, r.events, { spawned, crashPairs }) === false) break;
  }
  return { s, spawned, landedIds, crashedIds, crashPairs };
}

export const tests = [
  {
    id: 'FL1', tier: 'smoke', node: true, title: 'ミチビキ空港：定数・COLORS（3色・hex と印がすべて違う）・RUNWAYS（2つの layout で置き方の決まり 1〜4・向きが単位ベクトル）・0 < LAND_DOT < 1・難しさの関数の境界（0・5・6・17・18・29・30・1000・負・小数・文字）',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'ミチビキ空港', STEP: 1 / 60, LIVES: 3, CRASH_LIFE: 1, PLANE_R: 12, PICK_R: 34, CRASH_D: 20, NEAR_D: 56, ZONE_R: 22, LAND_DOT: 0.7, APPROACH_D: 48, APPROACH_ROOM: 80, RUNWAY_LEN: 96, RUNWAY_W: 22, WARN_S: 2, FIRST_SPAWN_S: 2, LAND_S: 1.2, CRASH_BREATH: 2, SAFE_SPAWN_D: 80, MAX_PLANES: 10, PATH_STEP: 6, MAX_PATH: 400, SAVE_KEY_BEST: 'michibiki.best', SAVE_KEY_HELP: 'michibiki.help' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §3.1 のとおり', kBad.length === 0, kBad);
      check('LAYOUTS は tall 320×520・wide 520×320、SPEED は slow 24・normal 32・fast 46、COLOR_STEPS は [0, 6, 18]',
        J(L.LAYOUTS) === J({ tall: { w: 320, h: 520 }, wide: { w: 520, h: 320 } }) && J(L.SPEED) === J({ slow: 24, normal: 32, fast: 46 }) && J(L.COLOR_STEPS) === J([0, 6, 18]), { LAYOUTS: L.LAYOUTS, SPEED: L.SPEED, COLOR_STEPS: L.COLOR_STEPS });
      check('0 < LAND_DOT < 1（向きを見るが、ぴったりでなくてよい）', L.LAND_DOT > 0 && L.LAND_DOT < 1, L.LAND_DOT);
      check('CRASH_D < 2×PLANE_R（かすっただけでは落ちない）、PICK_R×2 ≥ 44（つかみやすい）、NEAR_D > CRASH_D', L.CRASH_D < 2 * L.PLANE_R && L.PICK_R * 2 >= 44 && L.NEAR_D > L.CRASH_D, null);
      const CO = L.COLORS;
      check('COLORS は 3 色で id 0〜2、red・blue・yellow、名前 あか・あお・きいろ', Array.isArray(CO) && CO.length === 3 && CO.every((c, i) => c.id === i) && J(CO.map((c) => c.key)) === J(['red', 'blue', 'yellow']) && J(CO.map((c) => c.name)) === J(['あか', 'あお', 'きいろ']), CO);
      const uniq = (k) => new Set(CO.map((c) => String(c[k]).toLowerCase())).size === CO.length;
      check('hex・印（mark）・名前がすべて違う（色だけに頼らない）', uniq('hex') && uniq('mark') && uniq('name') && CO.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex) && c.mark), CO);
      check('COLORS・RUNWAYS・LAYOUTS・SPEED・API が凍結されている', Object.isFrozen(CO) && Object.isFrozen(L.RUNWAYS) && Object.isFrozen(L.LAYOUTS) && Object.isFrozen(L.SPEED) && Object.isFrozen(L), null);
      for (const layout of ['tall', 'wide']) {
        const { w, h } = L.LAYOUTS[layout];
        const s = L.newGame(1, layout);
        const rw = L.runwaysFor({ ...s, colors: 3 });
        check(`${layout}：RUNWAYS に 3 本、runwaysFor は色 id の順で { color, ex, ey, dx, dy, open }`, Array.isArray(L.RUNWAYS[layout]) && L.RUNWAYS[layout].length === 3 && rw.length === 3 && rw.every((r, i) => r.color === i && r.open === true && ['ex', 'ey', 'dx', 'dy'].every((k) => typeof r[k] === 'number')), rw);
        check(`${layout}：入り口と向きが契約 §3.3 の表のとおり`, J(rw.map((r) => [r.ex, r.ey, r.dx, r.dy])) === J(RW_TABLE[layout]), rw.map((r) => [r.ex, r.ey, r.dx, r.dy]));
        check(`${layout}：向きは上下左右どれかの単位ベクトル`, rw.every((r) => Math.abs(Math.hypot(r.dx, r.dy) - 1) < 1e-12 && (r.dx === 0 || r.dy === 0)), rw);
        const Z = L.ZONE_R, bad = [];
        for (let i = 0; i < 3; i++) {
          const a = rw[i];
          // 決まり 1：区域の外側が端から 40 以上、区域の外側どうしで 60 以上
          const edge = Math.min(a.ex, w - a.ex, a.ey, h - a.ey) - Z;
          if (edge < 40) bad.push(`${i}: 区域の外側が端から ${edge}`);
          for (let j = i + 1; j < 3; j++) { const b = rw[j], g = hyp(a.ex, a.ey, b.ex, b.ey) - 2 * Z; if (g < 60) bad.push(`${i}-${j}: 区域の外側どうし ${g.toFixed(1)}`); }
          // 決まり 2：手前の通り道（入り口から向きの逆へ APPROACH_ROOM）が場の内側（端から PLANE_R 以上）。向きの逆側の端まで 80 以上
          const ax = a.ex - a.dx * L.APPROACH_ROOM, ay = a.ey - a.dy * L.APPROACH_ROOM;
          if (ax < L.PLANE_R || ax > w - L.PLANE_R || ay < L.PLANE_R || ay > h - L.PLANE_R) bad.push(`${i}: 手前の通り道の端 (${ax}, ${ay}) が場の外`);
          const back = a.dx > 0 ? a.ex : a.dx < 0 ? w - a.ex : a.dy > 0 ? a.ey : h - a.ey;
          if (back < 80) bad.push(`${i}: 向きの逆側の端まで ${back}`);
          // 決まり 3：手前の通り道が、ほかの滑走路の帯（幅の外側）と区域の中心から ZONE_R + PLANE_R 以上
          for (let j = 0; j < 3; j++) {
            if (j === i) continue;
            const b = rw[j];
            const strip = segSeg([a.ex, a.ey], [ax, ay], [b.ex, b.ey], [b.ex + b.dx * L.RUNWAY_LEN, b.ey + b.dy * L.RUNWAY_LEN]) - L.RUNWAY_W / 2;
            const zone = segPt(a.ex, a.ey, ax, ay, b.ex, b.ey);
            if (strip < Z + L.PLANE_R) bad.push(`${i}→${j}: 通り道と帯の外側 ${strip.toFixed(1)}`);
            if (zone < Z + L.PLANE_R) bad.push(`${i}→${j}: 通り道と区域の中心 ${zone.toFixed(1)}`);
          }
          // 決まり 4：奥（入り口から向きへ RUNWAY_LEN）が場の内側
          const fx = a.ex + a.dx * L.RUNWAY_LEN, fy = a.ey + a.dy * L.RUNWAY_LEN;
          if (fx < 0 || fx > w || fy < 0 || fy > h) bad.push(`${i}: 奥 (${fx}, ${fy}) が場の外`);
        }
        check(`${layout}：置き方の決まり 1〜4（区域どうし 60・端から 40・手前の通り道 ${L.APPROACH_ROOM} が場の内側・通り道がほかの滑走路から 34 以上・奥が場の内側）`, bad.length === 0, bad);
        const r1 = L.runwaysFor(s);
        check(`${layout}：はじめ（colors 1）は あかだけ open、あお・きいろは open: false`, J(r1.map((r) => r.open)) === J([true, false, false]), r1);
      }
      // §3.4 の難しさ
      const cf = [[0, 1], [5, 1], [6, 2], [17, 2], [18, 3], [29, 3], [30, 3], [1000, 3]];
      check('colorsFor：0〜5 → 1、6〜17 → 2、18〜 → 3', cf.every(([n, w]) => L.colorsFor(n) === w), cf.map(([n]) => [n, L.colorsFor(n)]));
      const si = [[0, 6.5], [5, 5.8], [6, 5.66], [10, 5.1], [17, 4.12], [18, 3.98], [20, 3.7], [29, 2.44], [30, 2.4], [1000, 2.4]];
      check('spawnInterval：max(2.4, 6.5 − 0.14 × landed) 秒', si.every(([n, w]) => near(L.spawnInterval(n), w, 1e-9)), si.map(([n]) => [n, L.spawnInterval(n)]));
      const ma = [[0, 3], [3, 3], [4, 4], [5, 4], [6, 4], [8, 5], [17, 7], [18, 7], [20, 8], [27, 9], [28, 10], [29, 10], [30, 10], [1000, 10]];
      check('maxAlive：min(MAX_PLANES, 3 + floor(landed / 4))', ma.every(([n, w]) => L.maxAlive(n) === w), ma.map(([n]) => [n, L.maxAlive(n)]));
      const odd = [-1, -100, 2.5, 5.9, 'abc', '6', null, undefined, NaN, Infinity, {}, []];
      const oBad = [];
      for (const v of odd) {
        try {
          const c = L.colorsFor(v), i = L.spawnInterval(v), m = L.maxAlive(v), k = L.kindFor(v, 0.1);
          if (![1, 2, 3].includes(c) || !(i >= 2.4 && i <= 6.5) || !(Number.isInteger(m) && m >= 3 && m <= 10) || !['slow', 'normal', 'fast'].includes(k)) oBad.push(`${String(v)}: ${c}/${i}/${m}/${k}`);
        } catch (e) { oBad.push(`${String(v)}: 例外 ${e.message}`); }
      }
      check(`負・小数・文字・null などでも例外を出さず、範囲内の値（colors 1〜3・間隔 2.4〜6.5・maxAlive 3〜10・kind）`, oBad.length === 0, oBad);
      check('負の landed は 0 と同じ（1 色・6.5 秒・3 機）', L.colorsFor(-1) === 1 && near(L.spawnInterval(-1), 6.5) && L.maxAlive(-1) === 3, [L.colorsFor(-1), L.spawnInterval(-1), L.maxAlive(-1)]);
    },
  },
  {
    id: 'FL2', tier: 'smoke', node: true, title: 'ミチビキ空港 動き：直進（speed × STEP ずつ）・slow/normal/fast の速さ、道をたどる・道の終わりで最後の向きのまま直進、setPath の間引き・MAX_PATH・先頭の点を捨てる・reason の一覧、pickPlane（PICK_R の境界の両側・一番近い・同じ距離は id の小さい方・着陸中は選ばない）',
    run({ check, root }) {
      const L = load(root);
      const v = L.SPEED.normal * L.STEP;
      // 直進
      let s = world(L, [P(L, 0, 0, 100, 460, 1, 0), P(L, 1, 0, 160, 480, 0.6, -0.8)]);
      const r1 = run(L, s, 1).s, r60 = run(L, s, 60).s;
      check(`直進：1 コマで x が speed × STEP（${v.toFixed(4)}）進む・60 コマで 32 進む`, near(plane(r1, 0).x, 100 + v) && near(plane(r1, 0).y, 460) && near(plane(r60, 0).x, 132, 1e-6), [plane(r1, 0), plane(r60, 0)]);
      check('斜め (0.6, −0.8) にも speed × STEP ずつ（30 コマで (169.6, 467.2)）', near(plane(run(L, s, 30).s, 1).x, 169.6, 1e-6) && near(plane(run(L, s, 30).s, 1).y, 467.2, 1e-6), plane(run(L, s, 30).s, 1));
      // 種類ごとの速さ（forceSpawn で出す）
      const spd = {};
      for (const kind of ['slow', 'normal', 'fast']) {
        let t = L.forceSpawn(world(L, []), { color: 0, kind, edge: 'bottom', at: 0.5 });
        const w = t.warns[t.warns.length - 1];
        const r = run(L, t, 400, (x) => x.planes.length > 0).s;
        const p = r.planes[0];
        const a = run(L, r, 1).s, q = a && plane(a, p.id);
        spd[kind] = { kind: p && p.kind, speed: p && p.speed, step: q && hyp(p.x, p.y, q.x, q.y), warnKind: w && w.kind };
      }
      check('forceSpawn の kind で出た機体の speed が SPEED[kind]、1 コマの移動が speed × STEP', ['slow', 'normal', 'fast'].every((k) => spd[k].kind === k && spd[k].speed === L.SPEED[k] && near(spd[k].step, L.SPEED[k] * L.STEP, 1e-6)), spd);
      // 道をたどる → 終わりで直進
      s = world(L, [P(L, 0, 0, 60, 460, 1, 0)]);
      const sp = L.setPath(s, 0, [[120, 460], [120, 420]]);
      check('setPath が ok: true と新しい state を返し、機体に道が付く', sp.ok === true && plane(sp.state, 0).path && plane(sp.state, 0).path.length === 2, sp);
      const a200 = run(L, sp.state, 200).s, p200 = plane(a200, 0);
      // 200 コマで 106.7 進む：60 右へ → 40 上へ → 6.7 上へ直進
      check(`道をたどる：右へ 60・上へ 40 のあと、最後の向き（上）のまま直進（200 コマ後 (120, 413.3) 付近・向き (0, −1)。実際 (${p200.x.toFixed(2)}, ${p200.y.toFixed(2)})）`, near(p200.x, 120, 2) && near(p200.y, 420 - (200 * v - 100), 2) && p200.dy < -0.99, p200);
      const a300 = plane(run(L, a200, 100).s, 0);
      check('道が終わったら止まらず直進し続ける（さらに 100 コマで 53 上へ）', near(a300.y, p200.y - 100 * v, 1e-6) && near(a300.x, p200.x, 1e-6), a300);
      // 間引き・先頭の点
      s = world(L, [P(L, 0, 0, 160, 460, 1, 0)]);
      const dense = Array.from({ length: 40 }, (_, i) => [160 + (i + 1) * 2, 460]);
      const tp = L.setPath(s, 0, dense), pth = tp.ok ? plane(tp.state, 0).path : [];
      const gaps = pth.map((q, i) => (i ? hyp(q[0], q[1], pth[i - 1][0], pth[i - 1][1]) : hyp(q[0], q[1], 160, 460)));
      check(`2 ずつの点 40 個は PATH_STEP（6）未満を間引く（${pth.length} 点、間隔の最小 ${Math.min(...gaps).toFixed(2)}）、機体から 6 未満の先頭の点は捨てる`, tp.ok && pth.length >= 10 && pth.length <= 14 && gaps.every((g) => g >= L.PATH_STEP - 1e-9), { n: pth.length, gaps });
      check('道は凍結され、点は [x, y] の形', Object.isFrozen(pth) && pth.every((q) => Array.isArray(q) && q.length === 2), pth.slice(0, 3));
      // MAX_PATH：7 ずつの往復で 1000 点
      const many = [];
      for (let row = 0; many.length < 1000; row++) for (let i = 0; i < 40 && many.length < 1000; i++) many.push([row % 2 ? 300 - i * 7 : 20 + i * 7, 30 + row * 7]);
      const mp = L.setPath(s, 0, many), mpth = mp.ok ? plane(mp.state, 0).path : [];
      check(`1000 点の道は MAX_PATH（${L.MAX_PATH}）点で打ち切り、先頭から順に残す（超えた分を捨てる）`, mp.ok && mpth.length === L.MAX_PATH && J(mpth[0]) === J(many[0]) && J(mpth[L.MAX_PATH - 1]) === J(many[L.MAX_PATH - 1]), { n: mpth.length, first: mpth[0], last: mpth[mpth.length - 1] });
      // reason の一覧（だめなときは state はそのまま）
      const base = world(L, [P(L, 0, 0, 160, 460, 1, 0), P(L, 1, 0, 100, 170, 1, 0, { phase: 'land', landTick: 0 })]);
      const rs = {
        over: L.setPath({ ...base, over: true, lives: 0 }, 0, [[200, 460]]),
        noplane: L.setPath(base, 99, [[200, 460]]),
        landing: L.setPath(base, 1, [[200, 460]]),
        empty1: L.setPath(base, 0, []),
        empty2: L.setPath(base, 0, null),
        empty3: L.setPath(base, 0, 'abc'),
        empty4: L.setPath(base, 0, [[NaN, 1], ['x', 2]]),
      };
      const want = { over: 'over', noplane: 'noplane', landing: 'landing', empty1: 'empty', empty2: 'empty', empty3: 'empty', empty4: 'empty' };
      const rBad = Object.entries(want).filter(([k, w]) => !(rs[k] && rs[k].ok === false && rs[k].reason === w && J(rs[k].state) === J(k === 'over' ? { ...base, over: true, lives: 0 } : base))).map(([k]) => `${k}: ${rs[k] && rs[k].reason}`);
      check('setPath がだめなとき ok: false・reason（over・noplane・landing・empty）・state はそのまま', rBad.length === 0, rBad);
      // pickPlane
      const pk = world(L, [P(L, 1, 0, 160, 460, 1, 0), P(L, 2, 0, 100, 460, 1, 0), P(L, 3, 0, 250, 460, 1, 0), P(L, 4, 0, 290, 460, 1, 0), P(L, 5, 0, 100, 170, 1, 0, { phase: 'land', landTick: 0 })]);
      const R = L.PICK_R;
      check(`pickPlane：中心から ${R - 0.01} は選ぶ・${R + 0.01} は選ばない（ほかの機体が遠い向きで）`, L.pickPlane(pk, 160, 460 + R - 0.01) === 1 && L.pickPlane(pk, 160, 460 + R + 0.01) === null, [L.pickPlane(pk, 160, 460 + R - 0.01), L.pickPlane(pk, 160, 460 + R + 0.01)]);
      check('pickPlane：近い方（(120,460) は id 2 が 20・id 1 が 40）', L.pickPlane(pk, 120, 460) === 2, L.pickPlane(pk, 120, 460));
      check('pickPlane：同じ距離なら id の小さい方（(270,460) は id 3・4 から 20）', L.pickPlane(pk, 270, 460) === 3, L.pickPlane(pk, 270, 460));
      check('pickPlane：着陸中（phase land）の機体は選ばない、何も無い所は null', L.pickPlane(pk, 100, 170) === null && L.pickPlane(pk, 160, 300) === null, [L.pickPlane(pk, 100, 170), L.pickPlane(pk, 160, 300)]);
    },
  },
  {
    id: 'FL3', tier: 'smoke', node: true, title: 'ミチビキ空港 着陸：同じ色の区域（ZONE_R の境界の両側）で +1・land、LAND_S 後に消える、色が違う・閉じた滑走路は素通り（wrongway なし）、着陸の動き中はぶつからない、guided と stats。向き：内積が LAND_DOT ちょうど・+0.01 は着陸・−0.01 と真逆・真横はしない、wrongway は1回だけ・入り直すとまた1回、区域の中で向きが直るとそのコマで着陸、setPath の guided／wrongWay',
    run({ check, root }) {
      const L = load(root);
      const v = L.SPEED.normal * L.STEP, Z = L.ZONE_R, LT = Math.round(L.LAND_S / L.STEP);
      const EX = 100, EY = 170;     // tall のあか、向き (1, 0)
      // 区域の境界（動いたあとの距離で判定）
      const inS = world(L, [P(L, 0, 0, EX - (Z - 0.01) - v, EY, 1, 0)]);
      const outS = world(L, [P(L, 0, 0, EX - (Z + 0.01) - v, EY, 1, 0)]);
      const ri = L.update(inS), ro = L.update(outS);
      check(`区域の中（入り口から ${Z - 0.01}）に入ったコマで着陸：landed 1・land の出来事 { id, color, landed, guided }`, ri.state.landed === 1 && ri.events.some((e) => e.type === 'land' && e.id === 0 && e.color === 0 && e.landed === 1 && e.guided === false), ri.events);
      check(`区域のすぐ外（${Z + 0.01}）では着陸しない、次のコマで着陸する`, ro.state.landed === 0 && !ro.events.some((e) => e.type === 'land') && L.update(ro.state).state.landed === 1, ro.events);
      // 着陸の動き → LAND_S 後に消える
      const lt = ri.state;
      const pl = plane(lt, 0);
      check('着陸した機体は phase "land"・landTick がそのコマ、stats.freeLandings 1（道なし）', pl && pl.phase === 'land' && pl.landTick === lt.tick && lt.stats.freeLandings === 1 && lt.stats.guidedLandings === 0, { pl, stats: lt.stats });
      const before = run(L, lt, LT - 2).s, after = run(L, lt, LT + 2).s;
      check(`LAND_S（${LT} コマ）の少し前はまだ場にあり、少し後に消える`, !!plane(before, 0) && !plane(after, 0), { before: before.planes, after: after.planes });
      // 着陸の動き中はぶつからない：同じ位置に飛んでいる機体（あお。閉じた色なので降りない）を置く
      const lp = plane(lt, 0);
      const crowd = { ...lt, planes: [...lt.planes, P(L, 7, 1, lp.x, lp.y, 0, 1)], nextId: 8 };
      const cr = run(L, crowd, 10);
      check('着陸の動き中の機体と重なっても、ぶつからない（crash なし・ライフ 3・飛んでいる機体は残る）', ofType(cr.evs, 'crash').length === 0 && cr.s.lives === 3 && !!plane(cr.s, 7), cr.evs);
      // 向きの境界（区域の中 (90,165) から、内積 c の向きで）
      const dir = (c) => [c, Math.sqrt(1 - c * c)];
      const at = (c) => { const [dx, dy] = dir(c); const r = L.update(world(L, [P(L, 0, 0, 90, 165, dx, dy)])); return { landed: r.state.landed, wrong: r.events.filter((e) => e.type === 'wrongway').length }; };
      const dot = { exact: at(L.LAND_DOT), up: at(L.LAND_DOT + 0.01), down: at(L.LAND_DOT - 0.01) };
      check(`内積が LAND_DOT ちょうど（${L.LAND_DOT}）・+0.01 は着陸、−0.01 は着陸しない（wrongway を出す）`, dot.exact.landed === 1 && dot.up.landed === 1 && dot.down.landed === 0 && dot.down.wrong === 1, dot);
      const opp = run(L, world(L, [P(L, 0, 0, 108, 170, -1, 0)]), 3), side = run(L, world(L, [P(L, 0, 0, 100, 158, 0, 1)]), 3);
      check('区域の中で真逆（内積 −1）・真横（0）は着陸しない', opp.s.landed === 0 && side.s.landed === 0, { opp: opp.evs, side: side.evs });
      // wrongway は1回だけ、出て入り直すとまた1回
      let s = world(L, [P(L, 0, 0, 160, 170, -1, 0)]);
      let r = run(L, s, 400, (x) => plane(x, 0).x < 70);
      const w1 = ofType(r.evs, 'wrongway');
      check('逆向きで区域を通り抜けると wrongway { id, color, x, y } が1回だけ、着陸しない・ライフも点も変わらない', w1.length === 1 && w1[0].id === 0 && w1[0].color === 0 && typeof w1[0].x === 'number' && r.s.landed === 0 && r.s.lives === 3, r.evs);
      check('区域を出たら wrongIn が null に戻る', plane(r.s, 0).wrongIn === null, plane(r.s, 0));
      const loop = L.setPath(r.s, 0, [[45, 140], [45, 110], [150, 110], [150, 170], [110, 170], [90, 170], [60, 170]]);
      check('区域に入るが向きが足りない道は setPath が guided: false・wrongWay: true', loop.ok && loop.guided === false && loop.wrongWay === true, loop);
      const r2 = run(L, loop.state, 1200, (x) => { const p = plane(x, 0); return p && p.pathI >= 6 && p.x < 70; });
      const w2 = ofType(r2.evs, 'wrongway');
      check(`回って入り直すと、また wrongway が1回（合わせて 2 回、stats.wrongWays ${r2.s.stats.wrongWays}）、landed 0・ライフ 3`, w2.length === 1 && r2.s.stats.wrongWays === 2 && r2.s.landed === 0 && r2.s.lives === 3, { evs: r2.evs, stats: r2.s.stats });
      // 区域の中で道をたどって向きが直ると、そのコマで着陸
      s = world(L, [P(L, 0, 0, 96, 160, 0, 1)]);
      const t1 = L.update(s);
      check('区域の中で真横を向いていると、そのコマは wrongway で着陸しない', t1.state.landed === 0 && t1.events.some((e) => e.type === 'wrongway'), t1.events);
      const fix = L.setPath(t1.state, 0, [[112, 166], [140, 166]]);
      const t2 = fix.ok ? L.update(fix.state) : { state: t1.state, events: [] };
      check('向きを直す道を付けると guided: true、次のコマで着陸（land の guided: true）', fix.ok && fix.guided === true && t2.state.landed === 1 && t2.events.some((e) => e.type === 'land' && e.guided === true), { fix: { ok: fix.ok, guided: fix.guided }, ev: t2.events });
      check('道で導いた着陸は stats.guidedLandings に数える', t2.state.stats.guidedLandings === 1 && t2.state.stats.freeLandings === 0, t2.state.stats);
      // setPath の guided／wrongWay
      const gw = world(L, [P(L, 0, 0, 40, 170, 1, 0), P(L, 1, 0, 160, 250, 0, -1)]);
      const g1 = L.setPath(gw, 0, [[70, 170], [110, 170]]);
      const g2 = L.setPath(gw, 1, [[160, 260], [160, 300]]);
      const g3 = L.setPath(gw, 1, [[240, 330], [180, 330]]);    // あおの区域（色が違う）を通る
      check('手前から向きに沿って入る道は guided: true・wrongWay: false', g1.ok && g1.guided === true && g1.wrongWay === false, g1);
      check('区域に入らない道・色の違う区域を通る道は guided: false・wrongWay: false', g2.ok && g2.guided === false && g2.wrongWay === false && g3.ok && g3.guided === false && g3.wrongWay === false, { g2, g3 });
      const gl = run(L, g1.state, 300, (x) => x.landed > 0);
      check('guided の道をたどると着陸し、land の guided: true', gl.s.landed === 1 && ofType(gl.evs, 'land')[0].guided === true, gl.evs);
      // 色が違う・閉じた滑走路は素通り（wrongway も出ない）
      const other = run(L, world(L, [P(L, 0, 1, 40, 170, 1, 0)], { landed: 6 }), 200);
      check('あおの機体は あかの区域を向きどおりに通っても着陸せず、wrongway も出ない', other.s.landed === 6 && ofType(other.evs, 'wrongway').length === 0 && ofType(other.evs, 'land').length === 0, other.evs);
      const closed = run(L, world(L, [P(L, 0, 1, 280, 330, -1, 0)], { landed: 0 }), 200);
      const open = run(L, world(L, [P(L, 0, 1, 280, 330, -1, 0)], { landed: 6 }), 200);
      check('閉じた あおの滑走路は向きどおりでも素通り（wrongway なし）、開いていれば着陸する', closed.s.landed === 0 && ofType(closed.evs, 'wrongway').length === 0 && open.s.landed === 7, { closed: closed.evs, open: open.evs.filter((e) => e.type === 'land') });
    },
  },
  {
    id: 'FL4', tier: 'smoke', node: true, title: 'ミチビキ空港 ぶつかる・近すぎる・ライフ：CRASH_D と NEAR_D の境界の両側、2機が消えてライフ −1、同じコマで2組なら −2、3機が1点に集まる（id の小さい組から・消えた機体は数えない）、near は新しい組のときだけ、ライフ 0 で over・それ以後の update は同じ state、CRASH_BREATH',
    run({ check, root }) {
      const L = load(root);
      // 同じ向きに並んで飛ぶ2機（距離が変わらない）
      const pair = (d, o = {}) => world(L, [P(L, 0, 0, 100, 440, 1, 0), P(L, 1, 0, 100, 440 + d, 1, 0)], o);
      const c1 = L.update(pair(L.CRASH_D - 0.01)), c2 = L.update(pair(L.CRASH_D + 0.01));
      const ce = c1.events.find((e) => e.type === 'crash');
      check(`距離 ${L.CRASH_D - 0.01} でぶつかる：2機とも消え、ライフ 3 → 2、crash { ids: [0, 1], x, y, lives: 2 }、stats.crashes 1`, c1.state.planes.length === 0 && c1.state.lives === 2 && ce && J([...ce.ids].sort()) === J([0, 1]) && ce.lives === 2 && typeof ce.x === 'number' && c1.state.stats.crashes === 1, c1.events);
      check(`距離 ${L.CRASH_D + 0.01} ではぶつからない`, c2.state.planes.length === 2 && c2.state.lives === 3 && !c2.events.some((e) => e.type === 'crash'), c2.events);
      const n1 = L.update(pair(L.NEAR_D - 0.01)), n2 = L.update(pair(L.NEAR_D + 0.01));
      check(`距離 ${L.NEAR_D - 0.01} で2機とも near: true・near { ids: [0, 1] }、${L.NEAR_D + 0.01} では near: false・出来事なし`, n1.state.planes.every((p) => p.near === true) && n1.events.some((e) => e.type === 'near' && J([...e.ids].sort()) === J([0, 1])) && n2.state.planes.every((p) => p.near === false) && !n2.events.some((e) => e.type === 'near'), { n1: n1.events, n2: n2.events });
      const cont = run(L, n1.state, 30);
      check('近すぎる組が続いている間は near の出来事を出さない（30 コマで 0 回）', ofType(cont.evs, 'near').length === 0 && cont.s.planes.every((p) => p.near), cont.evs);
      const third = { ...cont.s, planes: [...cont.s.planes, P(L, 2, 0, cont.s.planes[0].x, 400, 1, 0)], nextId: 3 };
      const n3 = L.update(third);
      check('新しい組（id 0 と 2）ができたら、その組の near を1回出す', n3.events.filter((e) => e.type === 'near').length === 1 && J([...n3.events.find((e) => e.type === 'near').ids].sort()) === J([0, 2]), n3.events);
      // 同じコマで2組
      const two = world(L, [P(L, 0, 0, 60, 420, 1, 0), P(L, 1, 0, 60, 430, 1, 0), P(L, 2, 0, 200, 480, 1, 0), P(L, 3, 0, 200, 490, 1, 0)]);
      const t2 = L.update(two);
      check('同じコマで2組ぶつかるとライフ −2（1）・crash 2 回・4機とも消える', t2.state.lives === 1 && t2.events.filter((e) => e.type === 'crash').length === 2 && t2.state.planes.length === 0 && t2.state.stats.crashes === 2, t2.events);
      // 3機が1点に集まる（0-1・0-2・1-2 のどれも CRASH_D 未満）
      const tri = world(L, [P(L, 0, 0, 100, 460, 1, 0), P(L, 1, 0, 105, 460, 1, 0), P(L, 2, 0, 110, 460, 1, 0)]);
      const t3 = L.update(tri);
      const c3 = t3.events.filter((e) => e.type === 'crash');
      check('3機が1点：id の小さい組（0, 1）だけがぶつかり、ライフ −1、id 2 は残る（消えた機体は次の組に入れない）', c3.length === 1 && J([...c3[0].ids].sort()) === J([0, 1]) && t3.state.lives === 2 && t3.state.planes.length === 1 && t3.state.planes[0].id === 2, t3.events);
      // ライフ 0 で over
      const last = L.update(pair(10, { lives: 1, landed: 4 }));
      check('ライフ 1 でぶつかると lives 0・over: true・over { landed } の出来事', last.state.lives === 0 && last.state.over === true && last.events.some((e) => e.type === 'over' && e.landed === 4), last.events);
      const again = L.update(last.state), adv = L.advance(last.state, 100);
      check('over のあとの update・advance は同じ state と空の events', J(again.state) === J(last.state) && again.events.length === 0 && J(adv.state) === J(last.state) && adv.events.length === 0, again.events);
      // CRASH_BREATH：ぶつかったときとぶつからないときで、次の予告の出るコマを比べる
      const nextWarn = (d) => run(L, world(L, [P(L, 0, 0, 100, 440, 1, 0), P(L, 1, 0, 100, 440 + d, 1, 0)], { nextSpawnTick: 60 }), 600, (x, e) => e.some((q) => q.type === 'warn')).evs.find((e) => e.type === 'warn');
      const wa = nextWarn(10), wb = nextWarn(100);
      const delay = wa && wb ? wa.tick - wb.tick : null;
      check(`ぶつかると次の予告が CRASH_BREATH（${L.CRASH_BREATH} 秒＝${L.CRASH_BREATH * 60} コマ）のびる（差 ${delay} コマ）`, delay !== null && Math.abs(delay - L.CRASH_BREATH * 60) <= 2, { wa, wb });
    },
  },
  {
    id: 'FL5', tier: 'smoke', node: true, title: 'ミチビキ空港 端：四辺と角で跳ね返る（向きが反転・場の外に出ない）・bounce の出来事と stats.bounces、setPath の点が場の外なら内側に収める',
    run({ check, root }) {
      const L = load(root);
      const S = Math.SQRT1_2;
      const cases = [['左', 30, 460, -1, 0, (p) => p.dx > 0], ['右', 290, 460, 1, 0, (p) => p.dx < 0], ['上', 160, 30, 0, -1, (p) => p.dy > 0], ['下', 160, 490, 0, 1, (p) => p.dy < 0], ['左上の角', 30, 30, -S, -S, (p) => p.dx > 0 && p.dy > 0], ['右下の角', 290, 490, S, S, (p) => p.dx < 0 && p.dy < 0]];
      const bad = [];
      for (const [name, x, y, dx, dy, ok] of cases) {
        let s = world(L, [P(L, 0, 0, x, y, dx, dy)]);
        let out = false;
        const evs = [];
        for (let i = 0; i < 120; i++) {
          const r = L.update(s); s = r.state; evs.push(...r.events);
          const p = plane(s, 0);
          if (!p || p.x < 0 || p.x > 320 || p.y < 0 || p.y > 520) out = true;
        }
        const p = plane(s, 0), b = evs.filter((e) => e.type === 'bounce');
        if (out || !p || !ok(p) || b.length < 1 || !b.every((e) => e.id === 0 && typeof e.x === 'number') || s.stats.bounces !== b.length) bad.push({ name, out, p, bounces: b.length, stats: s.stats.bounces });
      }
      check('四辺と角で跳ね返り、向きが場の内側へ反転、場の外に出ない、bounce { id, x, y } と stats.bounces', bad.length === 0, bad);
      const wd = world(L, [P(L, 0, 0, 260, 160, 1, 0)], { layout: 'wide' });
      let s = wd, out = false;
      for (let i = 0; i < 900; i++) { s = L.update(s).state; const p = plane(s, 0); if (!p || p.x < 0 || p.x > 520 || p.y < 0 || p.y > 320) out = true; }
      check('wide（520×320）でも左右の端で跳ね返り、場の外に出ない（15 秒）', !out && !!plane(s, 0), plane(s, 0));
      const sp = L.setPath(world(L, [P(L, 0, 0, 160, 460, 1, 0)]), 0, [[-50, 300], [160, 200], [400, 600], [160, -40]]);
      const pth = sp.ok ? plane(sp.state, 0).path : [];
      const R = L.PLANE_R;
      check(`setPath の場の外の点は内側（${R}〜w−${R}・${R}〜h−${R}）に収める`, sp.ok && pth.length >= 3 && pth.every(([x, y]) => x >= R - 1e-9 && x <= 320 - R + 1e-9 && y >= R - 1e-9 && y <= 520 - R + 1e-9), pth);
    },
  },
  {
    id: 'FL6', tier: 'smoke', node: true, title: 'ミチビキ空港 難しさ：着陸 5→6 で2色・17→18 で3色、open の出来事、開いた直後の1機目が新しい色、出る間隔（landed 0 と 30 で spawnInterval ×0.85〜1.15）、maxAlive（上限に達したら予告を出さずに待つ）、kindFor（10 と 24 の境界）',
    run({ check, root }) {
      const L = load(root);
      for (const [from, color] of [[5, 1], [17, 2]]) {
        const s = world(L, [P(L, 0, 0, 40, 170, 1, 0)], { landed: from });
        const r = run(L, s, 300, (x) => x.landed > from);
        const op = ofType(r.evs, 'open');
        check(`着陸 ${from} → ${from + 1} で colors ${L.colorsFor(from)} → ${color + 1}、open { color: ${color} } が1回`, r.s.colors === color + 1 && op.length === 1 && op[0].color === color, r.evs);
        const next = run(L, { ...r.s, nextSpawnTick: Math.min(r.s.nextSpawnTick, r.s.tick + 1) }, 900, (x, e) => e.some((q) => q.type === 'warn'));
        const w = ofType(next.evs, 'warn')[0];
        check(`開いた直後に出る1機目は新しい色（${color}）`, !!w && w.color === color, next.evs);
      }
      // maxAlive：landed 0 で 3 機が飛んでいれば予告を出さない（左右に往復するだけの 3 機）
      const three = world(L, [P(L, 0, 0, 40, 400, 1, 0), P(L, 1, 0, 160, 460, -1, 0), P(L, 2, 0, 280, 516 - 12, 1, 0)], { nextSpawnTick: 1 });
      const w3 = run(L, three, 600);
      check('landed 0（maxAlive 3）で 3 機いると、10 秒たっても予告を出さない', ofType(w3.evs, 'warn').length === 0 && w3.s.warns.length === 0 && w3.s.planes.length === 3, ofType(w3.evs, 'warn'));
      const two = { ...w3.s, planes: w3.s.planes.slice(0, 2) };
      const w2 = run(L, two, 60, (x, e) => e.some((q) => q.type === 'warn'));
      check('1 機減らすとすぐ予告を出す（機体＋予告が maxAlive 以下）', ofType(w2.evs, 'warn').length === 1 && w2.s.planes.length + w2.s.warns.length <= 3, w2.evs);
      // 出る間隔：機体の無い場で予告が2回出る間
      const gap = (landed, seed) => {
        const s = world(L, [], { landed, nextSpawnTick: 1, seed, colors: L.colorsFor(landed) });
        const r = run(L, { ...s, rng: (seed * 2654435761) >>> 0 }, 1200, (x, e) => false);
        const ws = ofType(r.evs, 'warn');
        return ws.length >= 2 ? (ws[1].tick - ws[0].tick) / 60 : null;
      };
      const gBad = [];
      for (const landed of [0, 30]) for (let seed = 1; seed <= 6; seed++) {
        const g = gap(landed, seed), I = L.spawnInterval(landed);
        if (g === null || g < I * 0.85 - 0.05 || g > I * 1.15 + 0.05) gBad.push({ landed, seed, gap: g, I });
      }
      check('予告と次の予告の間は spawnInterval(landed) ×0.85〜1.15（landed 0 は 約 6.5 秒、30 は 約 2.4 秒）', gBad.length === 0, gBad);
      // kindFor
      const dist = (n) => { const c = { slow: 0, normal: 0, fast: 0 }; for (let i = 0; i < 1000; i++) c[L.kindFor(n, i / 1000)]++; return c; };
      const k9 = dist(9), k10 = dist(10), k23 = dist(23), k24 = dist(24);
      check(`kindFor：landed 9 はすべて normal、10 で slow 20%（${k10.slow}/1000）、23 まで fast なし、24 で fast 15%（${k24.fast}）・slow 20%（${k24.slow}）`,
        k9.normal === 1000 && Math.abs(k10.slow - 200) <= 2 && k10.fast === 0 && k23.fast === 0 && Math.abs(k23.slow - 200) <= 2 && Math.abs(k24.fast - 150) <= 2 && Math.abs(k24.slow - 200) <= 2, { k9, k10, k23, k24 });
    },
  },
  {
    id: 'FL7', tier: 'smoke', node: true, title: 'ミチビキ空港 出現：newGame は予告1つ（FIRST_SPAWN_S）、回の1機目は左の辺、予告から WARN_S 後に同じ位置・同じ色で出る、SAFE_SPAWN_D の中に機体がいたら待つ、出る位置が辺の 15〜85%・向きが場の中央の箱へ、同じ種・同じ入力なら同じ結果（advance 3600 の JSON）、Math.random を書き換えても同じ',
    run({ check, root }) {
      const L = load(root);
      const FT = Math.round(L.FIRST_SPAWN_S / L.STEP), WT = Math.round(L.WARN_S / L.STEP);
      const g = L.newGame(12345);
      check('newGame：tick 0・landed 0・lives 3・over false・colors 1・機体なし・予告 1 つ（spawnTick = FIRST_SPAWN_S のコマ）・stats が 0', g.tick === 0 && g.landed === 0 && g.lives === 3 && g.over === false && g.colors === 1 && g.planes.length === 0 && g.warns.length === 1 && g.warns[0].spawnTick === FT && g.layout === 'tall' && g.w === 320 && g.h === 520 && J(g.stats) === J({ crashes: 0, guidedLandings: 0, freeLandings: 0, bounces: 0, wrongWays: 0 }), g);
      check('newGame の layout が変なら tall、wide は 520×320', L.newGame(1, 'bogus').layout === 'tall' && L.newGame(1, 'wide').w === 520 && L.newGame(1, 'wide').h === 320, null);
      const firstBad = [];
      for (let seed = 1; seed <= 200; seed++) for (const layout of ['tall', 'wide']) {
        const w = L.newGame(seed, layout).warns[0], H = L.LAYOUTS[layout].h;
        if (!(Math.abs(w.x - L.PLANE_R) < 0.5 && w.color === 0 && w.dx > 0 && w.y >= H * 0.15 - 0.5 && w.y <= H * 0.85 + 0.5)) firstBad.push({ seed, layout, w });
      }
      check('回の1機目（200 種 × 2 layout）は あか・左の辺（x = PLANE_R）・辺の 15〜85%・右向き', firstBad.length === 0, firstBad.slice(0, 5));
      const b1 = L.advance(g, FT - 2).state, b2 = L.advance(g, FT + 1).state;
      const p0 = b2.planes[0];
      check(`1機目は FIRST_SPAWN_S（${FT} コマ）で出る：少し前は予告のまま、少し後に機体（同じ色・予告の位置から 1 コマ分以内）`, b1.planes.length === 0 && b1.warns.length === 1 && b2.planes.length === 1 && p0.color === g.warns[0].color && p0.id === g.warns[0].id && hyp(p0.x, p0.y, g.warns[0].x, g.warns[0].y) <= p0.speed * L.STEP * 2 + 1e-6, { b1: b1.warns, p0 });
      // forceSpawn → WARN_S 後
      const f = L.forceSpawn(world(L, []), { color: 0, edge: 'top', at: 0.5 });
      const fw = f.warns[f.warns.length - 1];
      const fr = run(L, f, WT + 5, (x, e) => e.some((q) => q.type === 'spawn'));
      const fs = ofType(fr.evs, 'spawn')[0];
      check(`forceSpawn の予告は WARN_S（${WT} コマ）後に出る（spawn { id, color, kind }・${fs && fs.tick} コマ）`, !!fw && fw.spawnTick === WT && !!fs && fs.id === fw.id && fs.color === 0 && Math.abs(fs.tick - WT) <= 1, { fw, fs });
      // SAFE_SPAWN_D：出る位置の近くに機体がいたら待つ
      const sf = L.forceSpawn(world(L, []), { color: 0, edge: 'left', at: 0.5 });
      const sw = sf.warns[sf.warns.length - 1];
      const blocker = P(L, 50, 0, sw.x + 28, sw.y - 60, 0, 1, { kind: 'slow', speed: L.SPEED.slow });
      const sb = run(L, { ...sf, planes: [blocker], nextId: 51 }, 900, (x, e) => e.some((q) => q.type === 'spawn'));
      const ss = ofType(sb.evs, 'spawn')[0];
      const before = ss && run(L, { ...sf, planes: [blocker], nextId: 51 }, ss.tick - 1).s;
      const bp = before && plane(before, 50);
      check(`出る位置から SAFE_SPAWN_D（${L.SAFE_SPAWN_D}）以内に機体がいる間は出ない（予告は残る）、離れたら 0.5 秒きざみで出る（${ss && ss.tick} コマ）`, !!ss && ss.tick > sw.spawnTick + 30 && bp && hyp(bp.x, bp.y, sw.x, sw.y) >= L.SAFE_SPAWN_D - 1 && (ss.tick - sw.spawnTick) % 30 <= 1, { ss, sw, bp });
      // 出る位置と向き（50 種 × 60 秒）
      const posBad = [], edges = new Set();
      let spawns = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const layout = seed % 2 ? 'tall' : 'wide', { w, h } = L.LAYOUTS[layout];
        let s = L.newGame(seed, layout);
        for (let i = 0; i < 3600 && !s.over; i++) {
          const r = L.update(s); s = r.state;
          for (const e of r.events) {
            if (e.type === 'warn') {
              const R = L.PLANE_R, x = e.x, y = e.y;
              const side = Math.abs(x - R) < 0.5 ? 'left' : Math.abs(x - (w - R)) < 0.5 ? 'right' : Math.abs(y - R) < 0.5 ? 'top' : Math.abs(y - (h - R)) < 0.5 ? 'bottom' : null;
              const along = side === 'left' || side === 'right' ? y / h : x / w;
              if (!side || along < 0.15 - 0.01 || along > 0.85 + 0.01) posBad.push({ seed, e }); else edges.add(side);
            }
            if (e.type === 'spawn') {
              spawns++;
              const p = plane(s, e.id);
              if (p && !(Math.abs(Math.hypot(p.dx, p.dy) - 1) < 1e-9 && rayHitsBox(p.x, p.y, p.dx, p.dy, w * 0.25 - 1, w * 0.75 + 1, h * 0.25 - 1, h * 0.75 + 1))) posBad.push({ seed, spawn: p });
            }
          }
        }
      }
      check(`予告の位置は四辺のどれか（x か y が PLANE_R の所）・辺の 15〜85%、出た向きは単位ベクトルで場の中央の箱（25〜75%）へ（${spawns} 機、辺 ${[...edges].join('・')}）`, posBad.length === 0 && edges.size === 4 && spawns > 100, posBad.slice(0, 5));
      // 決定的
      const inputs = (s0) => { let s = s0; const evs = []; for (let i = 0; i < 3600; i++) { if (i === 200 && s.planes[0]) { const sp = L.setPath(s, s.planes[0].id, [[80, 200], [200, 300]]); if (sp.ok) s = sp.state; } const r = L.update(s); s = r.state; evs.push(r.events); } return J({ s, evs }); };
      const a1 = J(L.advance(L.newGame(777), 3600)), a2 = J(L.advance(L.newGame(777), 3600));
      const i1 = inputs(L.newGame(4242)), i2 = inputs(L.newGame(4242));
      check('同じ種なら advance(3600) の JSON が一致、同じ入力（200 コマ目に setPath）でも一致、違う種なら違う', a1 === a2 && i1 === i2 && a1 !== J(L.advance(L.newGame(778), 3600)), null);
      const orig = Math.random;
      let r1, r2;
      try { Math.random = () => 0; r1 = J(L.advance(L.newGame(777), 3600)); Math.random = () => 0.999; r2 = inputs(L.newGame(4242)); } finally { Math.random = orig; }
      check('Math.random を書き換えても結果が変わらない（種だけで決まる）', r1 === a1 && r2 === i1, null);
    },
  },
  {
    id: 'FL8', tier: 'smoke', node: true, title: 'ミチビキ空港 保存の検証：validateBest（壊れた値 → 0）・recordBest の同点と更新・validateFlag・colorName',
    run({ check, root }) {
      const L = load(root);
      const good = [['0', 0], ['12', 12], [12, 12], ['9007199254740991', 9007199254740991], [0, 0]];
      const gBad = good.filter(([v, w]) => L.validateBest(v) !== w).map(([v]) => String(v));
      check('validateBest：安全な整数で 0 以上はその値', gBad.length === 0, gBad);
      const broken = [null, undefined, '', 'abc', '-1', -1, '1.5', 1.5, 'NaN', NaN, 'Infinity', Infinity, '{}', {}, [], '1e400', '9007199254740992', true];
      const bBad = broken.filter((v) => { try { return L.validateBest(v) !== 0; } catch { return true; } }).map(String);
      check(`validateBest：壊れた値 ${broken.length} 通り（null・""・"abc"・"-1"・"1.5"・"NaN"・"Infinity"・"{}"・"1e400"・"9007199254740992" ほか）は 0、例外なし`, bBad.length === 0, bBad);
      const r1 = L.recordBest(5, 5), r2 = L.recordBest(5, 7), r3 = L.recordBest(7, 3), r4 = L.recordBest(0, 1);
      check('recordBest：同じ値は improved: false、多ければ更新して true、少なければ前のまま', r1.best === 5 && r1.improved === false && r2.best === 7 && r2.improved === true && r3.best === 7 && r3.improved === false && r4.best === 1 && r4.improved === true, [r1, r2, r3, r4]);
      const fl = [['1', true], ['0', false], [1, false], ['true', false], [null, false], [undefined, false], ['', false], [' 1', false]];
      check('validateFlag：\'1\' のときだけ true', fl.every(([v, w]) => L.validateFlag(v) === w), fl.map(([v]) => [String(v), L.validateFlag(v)]));
      check('colorName：0 あか・1 あお・2 きいろ、範囲外・変な値は \'\'', L.colorName(0) === 'あか' && L.colorName(1) === 'あお' && L.colorName(2) === 'きいろ' && L.colorName(3) === '' && L.colorName(-1) === '' && L.colorName('0') === '' && L.colorName(NaN) === '', [L.colorName(0), L.colorName(3)]);
    },
  },
  {
    id: 'FL9', tier: 'smoke', node: true, title: 'ミチビキ空港 不変条件：イミュータブル（update・setPath の前後で元の state が同じ）、おかしな引数で例外を出さない、1000 種 × 3 つの遊び方で 座標がいつも場の内側・landed は減らない・lives 0〜3・機体の数 ≤ MAX_PLANES・id は重ならない・landed + 2×ぶつかった組 + 飛んでいる機体 = 出た機体',
    run({ check, root }) {
      const L = load(root);
      let s = L.advance(L.newGame(99), 300).state;
      const snap = J(s);
      const id = s.planes[0] && s.planes[0].id;
      L.update(s); L.advance(s, 50); L.setPath(s, id, [[100, 100], [200, 200]]); L.clearPath(s, id); L.forceSpawn(s, { color: 0 }); L.suggestPath(s, id);
      check('update・advance・setPath・clearPath・forceSpawn・suggestPath の後でも元の state の JSON が同じ', J(s) === snap && id !== undefined, null);
      check('返す state は凍結されている（planes・機体も）', Object.isFrozen(s) && Object.isFrozen(s.planes) && s.planes.every((p) => Object.isFrozen(p)), null);
      const sp = L.setPath(s, id, [[100, 100], [200, 200]]);
      const cl = sp.ok ? L.clearPath(sp.state, id) : null;
      check('clearPath で道が無くなる（path: null）', !!cl && plane(cl, id).path === null, cl && plane(cl, id));
      const odd = [
        () => L.update(null), () => L.update({}), () => L.update(undefined), () => L.update('x'),
        () => L.advance(null, 5), () => L.advance(s, -1), () => L.advance(s, 'abc'), () => L.advance(s, 36001), () => L.advance(s, 1.5),
        () => L.setPath(null, 0, [[1, 1]]), () => L.setPath(s, 'x', [[1, 1]]), () => L.setPath(s, id, [[1]]), () => L.setPath(s, id, { 0: [1, 2], length: 1 }),
        () => L.clearPath(null, 0), () => L.clearPath(s, 999), () => L.pickPlane(null, 1, 1), () => L.pickPlane(s, 'a', null),
        () => L.suggestPath(null, 0), () => L.suggestPath(s, 999), () => L.suggestPath(s, id, 7), () => L.forceSpawn(null, {}), () => L.forceSpawn(s, null), () => L.forceSpawn(s, { color: 9, kind: 'x', edge: 'nowhere', at: 5 }),
        () => L.runwaysFor(null), () => L.newGame('abc', 'bogus'), () => L.newGame(), () => L.colorName({}), () => L.recordBest('x', 'y'), () => L.makeRng('abc'),
        () => L.autoplay(1, { policy: 'bogus', maxSeconds: 5 }), () => L.autoplay('x', null),
      ];
      const thrown = [];
      odd.forEach((f, i) => { try { f(); } catch (e) { thrown.push(`${i}: ${f.toString().slice(6, 60)} → ${e.message}`); } });
      check(`おかしな引数 ${odd.length} 通りで例外を投げない`, thrown.length === 0, thrown);
      check('advance：範囲外の n（−1・36001・小数・文字）は 0 コマ（同じ tick）', [-1, 36001, 1.5, 'abc'].every((n) => L.advance(s, n).state.tick === s.tick), null);
      const ng = L.newGame('abc', 'bogus');
      check('newGame(\'abc\', \'bogus\') でも遊べる state（tall・予告 1 つ）', ng && ng.layout === 'tall' && ng.warns.length === 1, ng);
      // 1000 種 × 3 つの遊び方（自分で回す。1 回 40 秒まで、100 種に 1 回は終わりまで）
      const pols = ['none', 'naive', 'straight'];
      const bad = [];
      let ticks = 0, totalSpawn = 0, totalLand = 0, totalCrash = 0;
      const T0 = Date.now();
      for (let seed = 1; seed <= 1000; seed++) {
        const policy = pols[seed % 3], layout = seed % 2 ? 'tall' : 'wide', { w, h } = L.LAYOUTS[layout];
        const maxTicks = seed % 100 === 0 ? 54000 : 2400;
        const r = sim(L, seed, policy, {
          layout, maxTicks,
          onTick(prev, s, evs, { spawned, crashPairs }) {
            ticks++;
            const ids = new Set();
            for (const p of s.planes) {
              if (!(p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h)) { bad.push(`${seed}/${policy}: 場の外 (${p.x}, ${p.y})`); return false; }
              if (ids.has(p.id)) { bad.push(`${seed}: id ${p.id} が重なる`); return false; }
              ids.add(p.id);
            }
            if (s.landed < prev.landed) { bad.push(`${seed}: landed が減った`); return false; }
            if (!(s.lives >= 0 && s.lives <= 3)) { bad.push(`${seed}: lives ${s.lives}`); return false; }
            if (s.planes.length > L.MAX_PLANES) { bad.push(`${seed}: 機体 ${s.planes.length}`); return false; }
            const fly = s.planes.filter((p) => p.phase === 'fly').length;
            if (s.landed + 2 * crashPairs + fly !== spawned.length) { bad.push(`${seed}/${policy} tick ${s.tick}: landed ${s.landed} + 2×${crashPairs} + 飛んでいる ${fly} ≠ 出た ${spawned.length}`); return false; }
            if (bad.length > 10) return false;
            return true;
          },
        });
        totalSpawn += r.spawned.length; totalLand += r.s.landed; totalCrash += r.crashPairs;
        if (bad.length > 10) break;
      }
      check(`1000 種 × 3 つの遊び方（${ticks} コマ・出た ${totalSpawn} 機・着陸 ${totalLand}・ぶつかった ${totalCrash} 組、${((Date.now() - T0) / 1000).toFixed(1)} 秒）で不変条件がすべて成り立つ`, bad.length === 0 && totalLand > 0 && totalCrash > 0, bad.slice(0, 10));
    },
  },
  {
    id: 'FL10', tier: 'full', node: true, title: 'ミチビキ空港 調整の目安（§3.4）：autoplay で none の着陸の中央 ≤ 3、naive ≤ straight の半分、straight 12〜50、lazy ≤ straight、straight の1回の長さ 2〜5 分、最初の5機の着陸の割合 80% 以上',
    run({ check, root }) {
      const L = load(root);
      const T0 = Date.now();
      const N = 100;
      const res = {};
      for (const policy of ['none', 'naive', 'straight', 'lazy']) {
        const a = [];
        for (let seed = 1; seed <= N; seed++) a.push(L.autoplay(seed, { policy }));
        res[policy] = { landed: median(a.map((x) => x.landed)), seconds: median(a.map((x) => x.seconds)), crashes: median(a.map((x) => x.crashes)), wrong: median(a.map((x) => x.wrongWays)), shape: a.every((x) => ['landed', 'crashes', 'seconds', 'maxAliveSeen', 'guidedLandings', 'freeLandings', 'wrongWays'].every((k) => typeof x[k] === 'number')) };
      }
      const sec = (Date.now() - T0) / 1000;
      check(`autoplay は { landed, crashes, seconds, maxAliveSeen, guidedLandings, freeLandings, wrongWays } を返す`, Object.values(res).every((r) => r.shape), res);
      check(`none（何もしない）の着陸の中央 ${res.none.landed} ≤ 3`, res.none.landed <= 3, res);
      check(`naive（向きを見ず一直線）の中央 ${res.naive.landed} ≤ straight の半分（${res.straight.landed / 2}）`, res.naive.landed <= res.straight.landed / 2, res);
      check(`straight（おまかせの道）の中央 ${res.straight.landed} が 12〜50`, res.straight.landed >= 12 && res.straight.landed <= 50, res);
      check(`lazy（1.5 秒後）の中央 ${res.lazy.landed} ≤ straight ${res.straight.landed}`, res.lazy.landed <= res.straight.landed, res);
      check(`straight の1回の長さの中央 ${res.straight.seconds} 秒が 2〜5 分`, res.straight.seconds >= 120 && res.straight.seconds <= 300, res);
      // 最初の5機（straight）
      let first = 0, firstLanded = 0;
      for (let seed = 1; seed <= N; seed++) {
        const r = sim(L, seed, 'straight', { maxTicks: 54000, onTick: (prev, s, evs, { spawned }) => !(spawned.length >= 5 && spawned.slice(0, 5).every((id) => !s.planes.some((p) => p.id === id))) });
        const five = r.spawned.slice(0, 5);
        first += five.length; firstLanded += five.filter((id) => r.landedIds.has(id)).length;
      }
      check(`最初の5機（straight・${N} 回）のうち、ぶつからずに着陸した割合 ${(firstLanded / first * 100).toFixed(1)}% ≥ 80%`, first > 0 && firstLanded / first >= 0.8, { first, firstLanded });
      check(`各 ${N} 回 × 4 つの遊び方が Node で 30 秒以内（${sec.toFixed(1)} 秒）`, sec <= 30, sec);
    },
  },
  {
    id: 'FL11', tier: 'smoke', node: true, title: 'ミチビキ空港 静的：index.html の読み込み順（debug.js が <title> の直後・本文の最後で sfx → logic → render → input → main）、APP_FILES に全ファイル、画面のコードが鳴らす音の名前がすべて sfx.js の "michibiki" の表にあり、契約 §10 の音がそろう',
    run({ check, root }) {
      const dir = path.join(root, 'games/michibiki');
      if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('games/michibiki/index.html が無い');
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const at = (s) => html.indexOf(`<script src="${s}"></script>`);
      const title = html.indexOf('</title>'), head = html.indexOf('</head>'), dbg = at('../../common/debug.js');
      const between = dbg > title ? html.slice(title + '</title>'.length, dbg).replace(/<!--[\s\S]*?-->/g, '').trim() : 'x';
      check(`debug.js が <title> の直後（間はコメントだけ）・<head> の中`, dbg > 0 && dbg < head && between === '', { dbg, title, between: between.slice(0, 80) });
      const order = ['../../common/sfx.js', 'logic.js', 'render.js', 'input.js', 'main.js'].map(at);
      check(`本文で sfx.js → logic.js → render.js → input.js → main.js の順（${order.join(' < ')}）`, order.every((x, i) => x > head && (i === 0 || x > order[i - 1])), order);
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      const names = sandbox.YubiSfx.create('michibiki').names || [];
      const need = ['warn', 'pick', 'lock', 'land', 'near', 'crash', 'bounce', 'open', 'start', 'best', 'toggle', 'over'];
      check(`"michibiki" の音の表に ${need.join('・')} がある（${names.join(',')}）`, need.every((n) => names.includes(n)), names);
      const code = ['main.js', 'render.js', 'input.js'].filter((f) => fs.existsSync(path.join(dir, f))).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      const calls = [...code.matchAll(/(?:sfx\.play|snd|sound|playSfx)\(\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
      const missing = calls.filter((n) => !names.includes(n));
      check(`画面のコードの音 ${calls.length} か所 [${[...new Set(calls)].join(', ')}] がすべて音の表にある`, calls.length >= 6 && missing.length === 0, missing);
      check('main.js が YubiSfx.create("michibiki") を使う', /YubiSfx\.create\(\s*["']michibiki["']/.test(code), null);
      const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
      const files = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      const actual = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
      const want = [...new Set(['./games/michibiki/', ...['index.html', 'logic.js', 'render.js', 'input.js', 'main.js', ...actual].map((f) => `./games/michibiki/${f}`)])];
      const lack = want.filter((f) => !files.includes(f));
      check(`sw.js の APP_FILES に games/michibiki/ の ${want.length} 件がすべてある（足りない：${lack.join(' / ') || 'なし'}）`, actual.length >= 5 && lack.length === 0, lack);
    },
  },
  {
    id: 'FL12', tier: 'smoke', node: true, title: 'ミチビキ空港 おまかせの道（suggestPath）：2つの layout・3色で、機体を手前・横・奥の側・真後ろに置き 8 方向から、最後の区間が滑走路の向きそのもの・手前の点が入り口から APPROACH_D・点がすべて場の内側・間隔が PATH_STEP 前後・曲がりが 90度以内、その道で1機だけの場を進めると必ず着陸（wrongway なし）、閉じた色・無い id は null',
    run({ check, root }) {
      const L = load(root);
      const R = L.PLANE_R, S = Math.SQRT1_2;
      const heads = [[1, 0], [-1, 0], [0, 1], [0, -1], [S, S], [S, -S], [-S, S], [-S, -S]];
      const bad = [];
      let cases = 0, turnCases = 0;
      for (const layout of ['tall', 'wide']) {
        const { w, h } = L.LAYOUTS[layout];
        for (const rw of L.runwaysFor({ ...L.newGame(1, layout), colors: 3 })) {
          const { ex, ey, dx, dy } = rw, nx = -dy, ny = dx;
          const spots = {
            '手前': [ex - dx * 130, ey - dy * 130], '横+': [ex + nx * 70 + dx * 30, ey + ny * 70 + dy * 30], '横−': [ex - nx * 70 + dx * 30, ey - ny * 70 + dy * 30],
            '奥の側': [ex + dx * 70 + nx * 45, ey + dy * 70 + ny * 45], '真後ろ': [ex + dx * (L.RUNWAY_LEN + 25), ey + dy * (L.RUNWAY_LEN + 25)],
          };
          const A = [ex - dx * L.APPROACH_D, ey - dy * L.APPROACH_D];
          for (const [where, [px0, py0]] of Object.entries(spots)) {
            const px = Math.max(30, Math.min(w - 30, px0)), py = Math.max(30, Math.min(h - 30, py0));
            for (const [hx, hy] of heads) {
              cases++;
              const tag = `${layout}/${rw.color}/${where}/(${hx.toFixed(1)},${hy.toFixed(1)})`;
              const s = world(L, [P(L, 0, rw.color, px, py, hx, hy)], { layout, landed: 18 });
              const pts = L.suggestPath(s, 0);
              if (!Array.isArray(pts) || pts.length < 3) { bad.push(`${tag}: 道が無い`); continue; }
              // 点が場の内側
              if (!pts.every(([x, y]) => x >= R - 1e-6 && x <= w - R + 1e-6 && y >= R - 1e-6 && y <= h - R + 1e-6)) bad.push(`${tag}: 場の外の点`);
              // 間隔（最後の 1 区間は短くてよい）
              const gaps = pts.map((q, i) => (i ? hyp(q[0], q[1], pts[i - 1][0], pts[i - 1][1]) : hyp(q[0], q[1], px, py)));
              const inner = gaps.slice(1, -1);
              if (!inner.every((g) => g >= L.PATH_STEP * 0.5 && g <= L.PATH_STEP * 1.5 + 1e-6)) bad.push(`${tag}: 間隔 ${Math.min(...inner).toFixed(2)}〜${Math.max(...inner).toFixed(2)}`);
              // 手前の点・入り口・奥へ 10 がまっすぐ（滑走路の向き）
              const last = pts[pts.length - 1];
              if (hyp(last[0], last[1], ex + dx * 10, ey + dy * 10) > L.PATH_STEP) bad.push(`${tag}: 終わりが奥へ 10 でない (${last})`);
              if (Math.min(...pts.map((q) => hyp(q[0], q[1], A[0], A[1]))) > L.PATH_STEP / 2 + 1e-6) bad.push(`${tag}: 手前の点（入り口から ${L.APPROACH_D}）を通らない`);
              let k = pts.length - 1;
              while (k > 0 && Math.abs((pts[k][0] - ex) * dy - (pts[k][1] - ey) * dx) < 0.5 && ((pts[k][0] - ex) * dx + (pts[k][1] - ey) * dy) >= -L.APPROACH_D - 0.5) k--;
              const tailStart = pts[k + 1];
              const tAlong = (tailStart[0] - ex) * dx + (tailStart[1] - ey) * dy;
              if (tAlong > -L.APPROACH_D + L.PATH_STEP + 1e-6) bad.push(`${tag}: 最後のまっすぐな区間が手前の点から始まらない（入り口から ${(-tAlong).toFixed(1)}）`);
              // 曲がり 90度以内（場の端から 80 以上の位置）
              if (Math.min(px, w - px, py, h - py) >= 80) {
                turnCases++;
                for (let i = 2; i < pts.length; i++) {
                  const ax = pts[i - 1][0] - pts[i - 2][0], ay = pts[i - 1][1] - pts[i - 2][1], bx = pts[i][0] - pts[i - 1][0], by = pts[i][1] - pts[i - 1][1];
                  if (ax * bx + ay * by < -1e-9) { bad.push(`${tag}: ${i} 番目で 90度を超えて曲がる`); break; }
                }
              }
              // その道で進めると着陸
              const sp = L.setPath(s, 0, pts);
              if (!sp.ok || sp.guided !== true) { bad.push(`${tag}: setPath ${sp.ok}/${sp.guided}`); continue; }
              const r = run(L, sp.state, 3600, (x) => x.landed > 18);
              if (r.s.landed !== 19 || ofType(r.evs, 'wrongway').length) bad.push(`${tag}: 着陸しない（landed ${r.s.landed}・wrongway ${ofType(r.evs, 'wrongway').length}）`);
            }
          }
        }
      }
      check(`${cases} 通り（曲がりを見たのは ${turnCases}）で、道の形の決まりを満たし、その道で必ず着陸する（wrongway なし）`, bad.length === 0 && cases === 240 && turnCases > 50, bad.slice(0, 12));
      const s = world(L, [P(L, 0, 1, 160, 460, 1, 0)], { landed: 0 });
      check('閉じた色（colors 1 で あお）・無い id・着陸中は null、color を指定すると その色の滑走路へ', L.suggestPath(s, 0) === null && L.suggestPath(s, 0, 1) === null && L.suggestPath(s, 9) === null && Array.isArray(L.suggestPath(s, 0, 0)), null);
    },
  },
];
