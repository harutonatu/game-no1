// CL: ぼくのまち の計算ロジック（Node で games/machi/logic.js を直接読む。ブラウザ不要）
//   約束は docs/machi-contract.md（§5 遊びの決まり・§6 中身の形・§8 保存）、項目は計画書 docs/plans/machi.md §7。
//   小さな町は「平らな地図に いりぐちだけ」の state（flat）を作り、use・kind・lvl を手で置いてから recalc で計算し直して使う。
//   無いときに合格にしない：logic.js が無い・MachiLogic を公開していなければ例外で不合格にする。
//   単体でも流せる：node tests/cases/machi-logic.mjs [ID...]
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const cpuOf = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));
const cpuMs = (u) => (u.user + u.system) / 1000;

function load(root) {
  const f = path.join(root, 'games/machi/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/machi/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.step !== 'function' || typeof L.place !== 'function') throw new Error('logic.js が MachiLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const mut0 = (raw, f) => { const x = JSON.parse(raw); f(x); return JSON.stringify(x); };
const EX = 10;   // 手で組む町の いりぐち の x

// 平らな地図（いりぐちは (10,0)〜(10,2)）
function flat(L, { money = 100000, rank = 0 } = {}) {
  const s = L.newGame(1, 0);
  s.terrain.fill(L.TER.FLAT); s.use.fill(0); s.kind.fill(0); s.lvl.fill(0); s.poll.fill(0); s.blocked.fill(0);
  s.entry = [{ x: EX, y: 0 }, { x: EX, y: 1 }, { x: EX, y: 2 }];
  for (const e of s.entry) s.use[e.y * L.W + e.x] = L.USE.ENTRY;
  s.money = money; s.rank = rank; s.dirty = [];
  L.recalc(s);
  return s;
}
const I = (L, x, y) => y * L.W + x;
function setUse(L, s, x, y, use, kind = 0, lvl = 0) { const i = I(L, x, y); s.use[i] = use; s.kind[i] = kind; s.lvl[i] = lvl; return i; }
function roadV(L, s, x, y0, y1) { for (let y = y0; y <= y1; y++) setUse(L, s, x, y, L.USE.ROAD); }
function roadH(L, s, y, x0, x1) { for (let x = x0; x <= x1; x++) setUse(L, s, x, y, L.USE.ROAD); }
// 1 か月＝16 tick（ふつうの速さ・dt 0.25）。events をまとめて返す
function months(L, s, m) {
  const ev = [];
  s.speed = 1;
  for (let n = 0; n < m * L.TICKS_PER_MONTH; n++) { const r = L.step(s, 0.25); for (const e of r.events) ev.push(e); }
  return ev;
}
const maxRoadTraffic = (L, s) => { let m = 0; for (let i = 0; i < L.N; i++) if (s.use[i] === 1 || s.use[i] === 3) m = Math.max(m, s.traffic[i]); return m; };
const sumRoadTraffic = (L, s) => { let m = 0; for (let i = 0; i < L.N; i++) if (s.use[i] === 1 || s.use[i] === 3) m += s.traffic[i]; return m; };

export const tests = [
  {
    id: 'CL1', tier: 'smoke', node: true, title: 'ぼくのまち：地形（同じ種で同じ・3 つの型がちがう・置ける土地 55% 以上・いりぐちが上のふちに 3 マス・いりぐちの近く 10×10 は へいち・定数）',
    run({ check, root }) {
      const L = load(root);
      const K = { W: 64, H: 78, CHUNK: 8, POLL_BLOCK: 4, TICK_SEC: 0.25, TICKS_PER_MONTH: 16, NAME_MAX: 10, DEFAULT_NAME: 'ぼくのまち', SAVE_VERSION: 1 };
      const bad = Object.entries(K).filter(([k, v]) => L[k] !== v);
      check('定数が約束 §6.2 のとおり', bad.length === 0, bad);
      check('SPEEDS は [0, 1, 4]', J(L.SPEEDS) === '[0,1,4]', L.SPEEDS);
      check('TOOLS は 8 つ（§5.2 の id・値段・はし・維持費・使える節目）', J(L.TOOLS.map((t) => [t.id, t.cost, t.bridgeCost, t.upkeep, t.rank])) === J([['home', 20, null, 0, 0], ['work', 30, null, 0, 0], ['shop', 30, null, 0, 0], ['nature', 20, null, 0, 0], ['road', 10, 50, 1, 0], ['rail', 40, 200, 3, 1], ['green', 15, null, 1, 0], ['erase', 5, null, 0, 0]]), L.TOOLS);
      const a = L.terrainChoices(42), b = L.terrainChoices(42), c = L.terrainChoices(45);
      check('3 つ返す・型は 0 うみべ・1 かわの まち・2 やまあい', a.length === 3 && a.map((t) => t.type).join() === '0,1,2' && a.map((t) => t.name).join() === 'うみべ,かわの まち,やまあい', a.map((t) => [t.type, t.name]));
      check('同じ種で同じ地形', a.every((t, k) => Buffer.from(t.terrain).equals(Buffer.from(b[k].terrain)) && J(t.entry) === J(b[k].entry)), null);
      check('ちがう種（seed + 3）では ちがう地形', a.every((t, k) => !Buffer.from(t.terrain).equals(Buffer.from(c[k].terrain))), null);
      check('3 つの型どうしが ちがう', !Buffer.from(a[0].terrain).equals(Buffer.from(a[1].terrain)) && !Buffer.from(a[1].terrain).equals(Buffer.from(a[2].terrain)), null);
      const fails = [];
      const kinds = [0, 0, 0];
      for (let sd = 1; sd <= 30; sd++) {
        for (const t of L.terrainChoices(sd)) {
          let land = 0, sea = 0, mt = 0, riv = 0;
          for (const v of t.terrain) { if (v === 0 || v === 4 || v === 5) land++; if (v === 1) sea++; if (v === 3) mt++; if (v === 2) riv++; }
          if (land < L.N * 0.55) fails.push({ sd, type: t.type, land: land / L.N });
          if (sea > 0 && mt > 0 && riv > 0) kinds[t.type]++;
          if (t.entry.length !== 3 || !t.entry.every((e, k) => e.y === k && e.x === t.entry[0].x)) fails.push({ sd, entry: t.entry });
          const ex = t.entry[0].x;
          let fl = 0; for (let y = 0; y < 10; y++) for (let x = ex - 5; x < ex + 5; x++) if (t.terrain[y * 64 + x] === 0) fl++;
          if (fl < 80) fails.push({ sd, type: t.type, nearFlat: fl });
        }
      }
      check('種 1〜30 の 90 枚：置ける土地 55% 以上・いりぐちは上のふちから 3 マス・いりぐちの近く 10×10 の 8 割以上が へいち', fails.length === 0, fails.slice(0, 5));
      check(`海・山・川をどれも入れた地形が多い（型ごと 30 枚のうち ${kinds.join('/')} 枚）`, kinds.every((n) => n >= 20), kinds);
      const s = L.newGame(42, 1, 'テスト');
      check('newGame：選んだ地形・いりぐちは use 9・お金・月・速さ・名前', s && Buffer.from(s.terrain).equals(Buffer.from(a[1].terrain)) && s.entry.every((e) => s.use[e.y * 64 + e.x] === 9)
        && s.money === L.START_MONEY && s.month === 0 && s.speed === 1 && s.tax === 1 && s.rank === 0 && s.name === 'テスト' && s.pop === 0, s && { money: s.money, name: s.name });
      check('newGame：名前なしは ぼくのまち・おかしな choice は 0', L.newGame(3).name === 'ぼくのまち' && L.newGame(3, 9).choice === 0, null);
      check('newGame：はじめは全部のマスが dirty', s.dirty.length >= L.N, s.dirty.length);
    },
  },
  {
    id: 'CL2', tier: 'smoke', node: true, title: 'ぼくのまち：置く（値段とお金・置けない地形・はしの値段・お金が足りないと足りる所まで・5 秒以内の取り消し（置く前の形に戻す）・いりぐちは こわせない・使えない道具 rank・ふみきり・お金が足りなくても こわせる）',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L, { money: 1000 });
      const r1 = L.place(s, 'road', L.lineCells(EX, 3, EX, 7));
      check('みち 5 マス：お金が 50 減る・events place', r1.placed === 5 && r1.cost === 50 && s.money === 950 && r1.events.some((e) => e.kind === 'place' && e.tool === 'road' && e.cells.length === 5), r1);
      const r2 = L.place(s, 'home', L.rectCells(EX + 1, 3, EX + 2, 4));
      check('すむ 2×2：80 減る', r2.placed === 4 && s.money === 870, { r2, money: s.money });
      setUse(L, s, 20, 20, 0); s.terrain[I(L, 20, 20)] = L.TER.SEA; s.terrain[I(L, 21, 20)] = L.TER.MOUNT; s.terrain[I(L, 22, 20)] = L.TER.RIVER; s.terrain[I(L, 23, 20)] = L.TER.FOREST;
      const c = (tool, x, y) => L.canPlace(s, tool, x, y);
      check('うみ・やま には置けない（terrain）', !c('road', 20, 20).ok && c('road', 20, 20).reason === 'terrain' && c('home', 21, 20).reason === 'terrain', [c('road', 20, 20), c('home', 21, 20)]);
      check('かわ：みち は はし（50）・せんろ は 200・すむ は置けない', c('road', 22, 20).ok && c('road', 22, 20).cost === 50 && c('home', 22, 20).reason === 'terrain', [c('road', 22, 20), c('home', 22, 20)]);
      L.place(s, 'home', [I(L, 23, 20)]);
      check('もり に すむ を置くと もり が消えて へいち', s.terrain[I(L, 23, 20)] === L.TER.FLAT && s.use[I(L, 23, 20)] === L.USE.HOME, s.terrain[I(L, 23, 20)]);
      check('置いた所には置けない（occupied）', c('shop', EX + 1, 3).reason === 'occupied', c('shop', EX + 1, 3));
      check('せんろ は まち から（rank）', c('rail', 30, 30).reason === 'rank', c('rail', 30, 30));
      check('いりぐち に置けない・こわせない（entry）', c('road', EX, 1).reason === 'entry' && c('erase', EX, 1).reason === 'entry', [c('road', EX, 1), c('erase', EX, 1)]);
      check('何も無い所は こわせない（empty）', c('erase', 30, 30).reason === 'empty', c('erase', 30, 30));
      // お金が足りないとき
      s.money = 35;
      const r3 = L.place(s, 'road', L.lineCells(30, 10, 34, 10));
      check('お金 35 で みち 5 マス → 3 マス置いて deny money 2', r3.placed === 3 && s.money === 5 && r3.events.some((e) => e.kind === 'deny' && e.reason === 'money' && e.count === 2), r3);
      s.money = -10;
      check('お金がマイナスだと置けない（money）が、こわすは できる', c('road', 40, 40).reason === 'money' && c('erase', 30, 10).ok, [c('road', 40, 40), c('erase', 30, 10)]);
      // 5 秒の取り消し
      s.money = 1000;
      L.place(s, 'shop', [I(L, 40, 40)]);
      const u1 = L.canPlace(s, 'erase', 40, 40);
      const re = L.place(s, 'erase', [I(L, 40, 40)]);
      check('置いてすぐ こわす → 置いた値段を全部返す', u1.ok && u1.cost === -30 && s.money === 1000 && s.use[I(L, 40, 40)] === 0 && re.events.some((e) => e.kind === 'erase'), { u1, money: s.money });
      L.place(s, 'shop', [I(L, 40, 40)]);
      months(L, s, 1);   // 4 秒
      const u2 = L.canPlace(s, 'erase', 40, 40);
      for (let n = 0; n < 8; n++) L.step(s, 0.25);   // あと 2 秒
      const u3 = L.canPlace(s, 'erase', 40, 40);
      check('4 秒後はまだ返す・6 秒後は こわす値段 5（建物の lvl ごとに +10）', u2.cost === -30 && u3.cost === 5 + 10 * s.lvl[I(L, 40, 40)], { u2, u3 });
      // ふみきり
      s.rank = 1; s.money = 5000;
      L.place(s, 'road', L.lineCells(5, 50, 15, 50));
      L.place(s, 'rail', L.lineCells(10, 45, 10, 55));
      check('みち と せんろ が交わると ふみきり（3）', s.use[I(L, 10, 50)] === L.USE.CROSS && s.use[I(L, 10, 49)] === L.USE.RAIL && s.use[I(L, 9, 50)] === L.USE.ROAD, s.use[I(L, 10, 50)]);
      // 5 秒の取り消しは、置いたものだけを置く前の形に戻す（技術レビュー A9）
      for (let n = 0; n < 32; n++) L.step(s, 0.25);   // 8 秒たつ（せんろ は もう取り消せない）
      const m1 = s.money;
      L.place(s, 'road', [I(L, 10, 47)]);
      const xi = I(L, 10, 47);
      const ux = L.canPlace(s, 'erase', 10, 47);
      L.place(s, 'erase', [xi]);
      check('古い せんろ に みち を重ねて（ふみきり）すぐ取り消す → せんろ に戻る・みち の値段 10 だけ返る', s.use[xi] === L.USE.RAIL && s.money === m1 && ux.undo === true && ux.cost === -10, { use: s.use[xi], money: s.money, m1, ux });
      s.terrain[I(L, 30, 45)] = L.TER.FOREST; s.terrain[I(L, 31, 45)] = L.TER.FOREST;
      const fm = s.money;
      L.place(s, 'home', [I(L, 30, 45)]); L.place(s, 'road', [I(L, 31, 45)]);
      L.place(s, 'erase', [I(L, 30, 45), I(L, 31, 45)]);
      check('もり に置いて すぐ取り消す → もり に戻る・お金も戻る', s.terrain[I(L, 30, 45)] === L.TER.FOREST && s.terrain[I(L, 31, 45)] === L.TER.FOREST && s.use[I(L, 30, 45)] === 0 && s.use[I(L, 31, 45)] === 0 && s.money === fm, { t: [s.terrain[I(L, 30, 45)], s.terrain[I(L, 31, 45)]], money: s.money, fm });
      const nm = s.money;
      L.place(s, 'rail', [I(L, 40, 45)]); L.place(s, 'road', [I(L, 40, 45)]);
      const cx = I(L, 40, 45);
      check('すぐ置いた せんろ に みち を重ねると ふみきり', s.use[cx] === L.USE.CROSS, s.use[cx]);
      L.place(s, 'erase', [cx]);
      const c1 = s.use[cx];
      L.place(s, 'erase', [cx]);
      check('1 回目の取り消しで せんろ・2 回目で なし（どちらも全部返す）', c1 === L.USE.RAIL && s.use[cx] === 0 && s.money === nm, { c1, c2: s.use[cx], money: s.money, nm });
      // お金が足りなくても こわせる（ただ。借金を深くしない。技術レビュー M1）
      s.money = 3;
      const ef = L.canPlace(s, 'erase', 30, 10);
      L.place(s, 'erase', [I(L, 30, 10)]);
      check('お金 3 でも みち を こわせる（値段 0・お金は 3 のまま）', ef.ok && ef.cost === 0 && s.use[I(L, 30, 10)] === 0 && s.money === 3, { ef, money: s.money });
      s.money = -40;
      L.place(s, 'erase', [I(L, 31, 10)]);
      check('お金が マイナスでも こわせる・借金は ふえない（-40 のまま）', s.use[I(L, 31, 10)] === 0 && s.money === -40, s.money);
      check('lineCells は長い方へまっすぐ・rectCells は 8×8 まで', J(L.lineCells(0, 0, 3, 1)) === J([0, 1, 2, 3]) && L.lineCells(0, 0, 1, 5).length === 6 && L.rectCells(0, 0, 20, 20).length === 64 && L.rectCells(5, 5, 4, 4).length === 4, null);
      check('おかしな引数でも落ちない', L.place(s, 'nai', [1]).placed === 0 && L.place(s, 'road', 'x').placed === 0 && L.canPlace(s, 'road', -1, 0).ok === false && L.canPlace(null, 'road', 0, 0).ok === false && J(L.lineCells('a')) === '[]', null);
    },
  },
  {
    id: 'CL3', tier: 'smoke', node: true, title: 'ぼくのまち：育つ（みち が無い・いりぐちとつながらないと育たない・つながると育つ・せんろ だけでは育たない）',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L);
      roadV(L, s, EX, 3, 12);
      const a = setUse(L, s, EX + 1, 6, L.USE.HOME);           // つながった みち のとなり
      const b = setUse(L, s, 40, 40, L.USE.HOME);              // みち が無い
      roadH(L, s, 30, 30, 36); const c = setUse(L, s, 33, 31, L.USE.HOME);   // つながっていない みち
      L.recalc(s);
      months(L, s, 24);
      check('つながった みち のそば は育つ', s.lvl[a] > 0, s.lvl[a]);
      check('みち が無い所は育たない', s.lvl[b] === 0, s.lvl[b]);
      check('いりぐちとつながっていない みち のそばは育たない', s.lvl[c] === 0, s.lvl[c]);
      const ins = L.inspect(s, 33, 31);
      check('しらべる：つながっていない理由が出る', ins && ins.connected === false && ins.reasons.some((t) => /つながって いない/.test(t)), ins && ins.reasons);
      check('しらべる：みち が遠い理由', L.inspect(s, 40, 40).reasons.some((t) => /みちが とおい/.test(t)), L.inspect(s, 40, 40).reasons);
      roadH(L, s, 12, EX, 30); roadV(L, s, 30, 12, 30);   // つなげる
      for (let y = 4; y <= 8; y++) setUse(L, s, EX - 1, y, L.USE.WORK);   // 仕事も置く（しごとが無いと すむ は育ちきらない）
      L.recalc(s);
      months(L, s, 24);
      check('つなげると育つ', s.lvl[c] > 0, s.lvl[c]);
      // せんろだけ
      const s2 = flat(L, { rank: 1 });
      for (let y = 3; y <= 20; y++) setUse(L, s2, EX, y, L.USE.RAIL);
      const d = setUse(L, s2, EX + 1, 10, L.USE.HOME);
      L.recalc(s2);
      months(L, s2, 24);
      check('せんろ だけでは育たない（車の みち が要る）', s2.lvl[d] === 0, s2.lvl[d]);
      // none は人口 0
      const r = L.simulate(1, 'none', 36);
      check('何も置かないと人口 0 のまま（3 年）', r && r.pop === 0 && r.log.every((e) => e.pop === 0), r && r.pop);
    },
  },
  {
    id: 'CL4', tier: 'smoke', node: true, title: 'ぼくのまち：住む場所 4 種類（密度 d と 地価 v の 2 軸の表・rank で使える種類・建て替えは 1 年続いたときだけ）',
    run({ check, root }) {
      const L = load(root);
      const k = (d, v, r) => L.homeKindOf(d, v, r);
      check('し（rank 2）：d≧50・v≧55 → マンション、d≧50・v<55 → アパート、d<50・v≧65 → 高級住宅地、d<50・v 55〜64 → 住宅地、d<50・v<55 → 住宅地',
        k(50, 55, 2) === 2 && k(80, 90, 2) === 2 && k(50, 54, 2) === 1 && k(49, 65, 2) === 4 && k(49, 64, 2) === 3 && k(49, 55, 2) === 3 && k(0, 0, 2) === 3, [k(50, 55, 2), k(50, 54, 2), k(49, 65, 2), k(49, 64, 2)]);
      check('まち（rank 1）：マンションのはずの所は アパート', k(60, 80, 1) === 1 && k(10, 80, 1) === 4, [k(60, 80, 1), k(10, 80, 1)]);
      check('むら（rank 0）：住宅地だけ', [k(60, 80, 0), k(60, 10, 0), k(10, 80, 0), k(10, 10, 0)].every((x) => x === 3), null);
      check('HOME の人数（lvl 1/2/3）が §5.4 の表どおり', J(L.HOME.slice(1).map((h) => h.people.slice(1))) === J([[15, 30, 45], [25, 50, 80], [4, 8, 12], [2, 4, 6]]), L.HOME);
      // 建て替え：密度が高くなる所（せんろ 3 マス以内）の 住宅地 lvl 2
      const s = flat(L, { rank: 1 });
      roadV(L, s, EX, 3, 30);
      for (let y = 3; y <= 30; y++) setUse(L, s, EX + 3, y, L.USE.RAIL);
      for (let y = 6; y <= 20; y++) setUse(L, s, EX - 1, y, L.USE.WORK, 1, 1);
      const h = setUse(L, s, EX + 1, 12, L.USE.HOME, 3, 2);
      L.recalc(s);
      const want = L.homeKindOf(s.dens[h], s.land[h], s.rank);
      check(`その場所の d=${s.dens[h]}・v=${s.land[h]} は アパート を指す`, want === 1, { d: s.dens[h], v: s.land[h], want });
      s.inflow = 1000;
      months(L, s, 6);
      const k6 = s.kind[h];
      months(L, s, 8);
      const k14 = s.kind[h];
      check(`6 か月では建て替えない（${k6}）・1 年をこえると アパート に建て替える（${k14}）`, k6 !== 1 && k14 === 1, { k6, k14, lvl: s.lvl[h] });
    },
  },
  {
    id: 'CL5', tier: 'smoke', node: true, title: 'ぼくのまち：めぐみ の種類は場所で決まる（海辺＝漁港・もり／やま のそば＝林業・ほか＝はたけ）・canPlace の natureKind',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L);
      s.terrain[I(L, 30, 30)] = L.TER.SEA;
      s.terrain[I(L, 40, 40)] = L.TER.FOREST;
      s.terrain[I(L, 50, 50)] = L.TER.MOUNT;
      const nk = (x, y) => L.canPlace(s, 'nature', x, y).natureKind;
      check('海のとなり → 3 漁港', nk(31, 30) === 3 && nk(30, 31) === 3, [nk(31, 30), nk(30, 31)]);
      check('もり から 2 マス以内 → 2 林業', nk(42, 40) === 2 && nk(41, 41) === 2, [nk(42, 40), nk(41, 41)]);
      check('やま から 2 マス以内 → 2 林業', nk(52, 52) === 2, nk(52, 52));
      check('ほか → 1 はたけ', nk(20, 20) === 1 && nk(43, 40) === 1, [nk(20, 20), nk(43, 40)]);
      check('もり の上に めぐみ を置ける（もり は残る）', L.place(s, 'nature', [I(L, 40, 40)]).placed === 1 && s.terrain[I(L, 40, 40)] === L.TER.FOREST && s.kind[I(L, 40, 40)] === 2, null);
      check('WORK の仕事（はたけ 3/5/8・林業 3/5/8・漁港 5/10/15・こうば 10/20/35・おみせ 6/12/20・ビル 20/40/70）',
        J([L.WORK[8][1].jobs, L.WORK[8][2].jobs, L.WORK[8][3].jobs, L.WORK[6][1].jobs, L.WORK[7][1].jobs, L.WORK[7][2].jobs]) === J([[0, 3, 5, 8], [0, 3, 5, 8], [0, 5, 10, 15], [0, 10, 20, 35], [0, 6, 12, 20], [0, 20, 40, 70]]), null);
    },
  },
  {
    id: 'CL6', tier: 'smoke', node: true, title: 'ぼくのまち：仕事の釣り合い r（(仕事＋R_SOFT)÷(はたらく人＋R_SOFT)）と「しごとが たりない／はたらく ひとが たりない」',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L);
      roadV(L, s, EX, 3, 40);
      for (let y = 4; y <= 40; y++) { setUse(L, s, EX + 1, y, L.USE.HOME, 3, 3); setUse(L, s, EX - 1, y, L.USE.HOME, 3, 3); }
      L.recalc(s);
      const sm = L.summary(s);
      const want = (0 + L.R_SOFT) / (sm.pop * 0.5 + L.R_SOFT);
      check(`人 ${sm.pop}・仕事 0 → r = ${want.toFixed(3)}`, Math.abs(sm.r - want) < 1e-9 && sm.workers === sm.pop * 0.5, sm);
      const ins = L.inspect(s, EX + 1, 10);
      check('しらべる：しごとが たりない', ins.reasons.some((t) => /しごとが たりない/.test(t)), ins.reasons);
      const ev = months(L, s, 8);
      check('知らせ・声で「しごとが たりない」が出る', ev.some((e) => (e.kind === 'news' || e.kind === 'voice') && e.why === 'nojob'), ev.filter((e) => e.kind === 'news' || e.kind === 'voice').slice(0, 5));
      check('仕事が足りないと すむ は小さくなる（shrink）', ev.some((e) => e.kind === 'shrink' && e.use === 5), null);
      // 仕事だけ
      const s2 = flat(L);
      roadV(L, s2, EX, 3, 40);
      for (let y = 4; y <= 40; y++) setUse(L, s2, EX + 1, y, L.USE.WORK, 1, 2);
      setUse(L, s2, EX - 1, 5, L.USE.HOME, 3, 1);
      L.recalc(s2);
      check('仕事だけ多い → r > 1.25', L.summary(s2).r > 1.25, L.summary(s2).r);
      const ev2 = months(L, s2, 8);
      check('「はたらく ひとが たりない」が出る・しごと は小さくなる', ev2.some((e) => (e.kind === 'news' || e.kind === 'voice') && e.why === 'noworker') && ev2.some((e) => e.kind === 'shrink' && e.use === 6), ev2.filter((e) => e.kind === 'news' || e.kind === 'voice').slice(0, 5));
    },
  },
  {
    id: 'CL7', tier: 'smoke', node: true, title: 'ぼくのまち：渋滞（交差点の方が混む・せんろで減る・段 2 以上で jam・受け止められる量）',
    run({ check, root }) {
      const L = load(root);
      check('受け止められる量：まっすぐ 20・交差点 10・ふみきり 8', L.CAP_ROAD === 20 && L.CAP_X === 10 && L.CAP_CROSS === 8, null);
      // 同じ すむ（同じマス・同じ人）で、みち が まっすぐ 1 本 と、交差点だらけ を比べる
      const build = (cross, rail) => {
        const s = flat(L, { rank: 1 });
        roadV(L, s, EX, 3, 40);
        for (let y = 4; y <= 40; y++) for (const x of [EX - 2, EX - 1, EX + 1, EX + 2]) {
          if (cross && y % 3 === 0) continue;
          if (!cross && y % 3 === 0) continue;
          setUse(L, s, x, y, L.USE.HOME, 1, 1);
        }
        if (cross) for (let y = 6; y <= 39; y += 3) { setUse(L, s, EX - 1, y, L.USE.ROAD); setUse(L, s, EX + 1, y, L.USE.ROAD); }
        if (rail) for (let y = 3; y <= 40; y++) setUse(L, s, EX + 4, y, L.USE.RAIL);
        L.recalc(s);
        return s;
      };
      const st = build(false, false), cr = build(true, false), rl = build(false, true);
      const pa = L.summary(st).pop, pb = L.summary(cr).pop;
      check(`同じ人の数（${pa}・${pb}）`, pa === pb && pa > 0, { pa, pb });
      const ms = maxRoadTraffic(L, st), mc = maxRoadTraffic(L, cr);
      check(`交差点だらけ の方が段が高い（まっすぐ ${ms}・交差点 ${mc}）`, mc > ms, { ms, mc });
      const sr = sumRoadTraffic(L, rl), ss = sumRoadTraffic(L, st);
      check(`せんろ が 3 マス以内を通ると渋滞が減る（段の合計 ${ss} → ${sr}）`, sr < ss && maxRoadTraffic(L, rl) <= ms, { ss, sr });
      // 段 2 以上で jam（いちばん混んでいる所）
      const s = flat(L, { rank: 1 });
      roadV(L, s, EX, 3, 30);
      for (let y = 4; y <= 30; y++) for (const x of [EX - 2, EX - 1, EX + 1, EX + 2]) setUse(L, s, x, y, L.USE.HOME, 1, 3);
      L.recalc(s);
      const ev = months(L, s, 1);
      const jam = ev.find((e) => e.kind === 'jam');
      check('アパートだらけの まっすぐの みち は段 2 以上・月に jam（i は みち・level ≧ 2）', jam && jam.level >= 2 && (s.use[jam.i] === 1 || s.use[jam.i] === 9) && s.traffic[jam.i] === jam.level, jam);
      const ins = L.inspect(s, EX + 1, 10);
      check('しらべる：こんで いる', ins.jamNear >= 2 && ins.reasons.some((t) => /こんで/.test(t)), ins);
    },
  },
  {
    id: 'CL8', tier: 'smoke', node: true, title: 'ぼくのまち：電車（せんろ 8 マス以上で、3 マス以内の離れた みち の塊が 1 つのつながりに・7 マスではならない・駅は無い）',
    run({ check, root }) {
      const L = load(root);
      const mk = (len) => {
        const s = flat(L, { rank: 1 });
        roadV(L, s, EX, 3, 6);                 // いりぐちの みち（下のはしは y=6）
        roadV(L, s, EX + 1 + len, 10, 14);     // 離れた みち（x = 11 + len）
        for (let x = EX + 1; x <= EX + len; x++) setUse(L, s, x, 8, L.USE.RAIL);
        const h = setUse(L, s, EX + 2 + len, 12, L.USE.HOME);
        L.recalc(s);
        return { s, h };
      };
      const a = mk(8), b = mk(7);
      check('8 マスの せんろ：離れた みち のそばの区画が いりぐちとつながる', L.inspect(a.s, a.h % L.W, (a.h / L.W) | 0).connected === true, L.inspect(a.s, a.h % L.W, (a.h / L.W) | 0));
      check('7 マスでは つながらない', L.inspect(b.s, b.h % L.W, (b.h / L.W) | 0).connected === false, null);
      check('つながりの数：8 マスは 1 つ・7 マスは 2 つ', a.s.net.comps.length === 1 && b.s.net.comps.length === 2, [a.s.net.comps.length, b.s.net.comps.length]);
      months(L, a.s, 24);
      check('せんろで つながった区画は育つ', a.s.lvl[a.h] > 0, a.s.lvl[a.h]);
      check('駅の道具は無い', !L.TOOLS.some((t) => /station|eki/.test(t.id)), L.TOOLS.map((t) => t.id));
      check('RAIL_MIN は 8', L.RAIL_MIN === 8, L.RAIL_MIN);
    },
  },
  {
    id: 'CL9', tier: 'smoke', node: true, title: 'ぼくのまち：よごれ（こうばから広がる・みどりで減る・漁港は海がよごれると育たない・すみやすさが下がる）',
    run({ check, root }) {
      const L = load(root);
      const mk = (green) => {
        const s = flat(L);
        roadV(L, s, EX, 3, 40);
        for (let y = 20; y <= 23; y++) setUse(L, s, EX + 1, y, L.USE.WORK, 1, 1);
        if (green) for (let y = 16; y <= 31; y++) for (const x of [EX + 3, EX + 4, EX + 5, EX + 6, EX - 1, EX - 2]) setUse(L, s, x, y, L.USE.GREEN);
        L.recalc(s);
        return s;
      };
      const a = mk(false), b = mk(true);
      a.inflow = b.inflow = 0;
      months(L, a, 6); months(L, b, 6);
      const blk = (s, x, y) => s.poll[(y >> 2) * 16 + (x >> 2)];
      const pa = blk(a, EX + 1, 22), pn = blk(a, EX + 1, 17), pf = blk(a, EX + 1, 50);
      check(`こうばの区画がよごれる（${pa}）・となりへ広がる（${pn}）・遠くは 0（${pf}）`, pa >= 20 && pn > 0 && pn < pa && pf === 0, { pa, pn, pf });
      const pb = blk(b, EX + 1, 22);
      check(`みどりで減る（${pa} → ${pb}）`, pb < pa, { pa, pb });
      // 漁港
      const s = flat(L);
      for (let y = 10; y <= 20; y++) s.terrain[I(L, 30, y)] = L.TER.SEA;
      const f = setUse(L, s, 31, 14, L.USE.NATURE, 3, 1);
      L.recalc(s);
      check('きれいな海なら しらべる に海の理由は出ない', !L.inspect(s, 31, 14).reasons.some((t) => /うみが よごれ/.test(t)), null);
      s.poll[(14 >> 2) * 16 + (30 >> 2)] = 60;
      check('海の区画が よごれ 40 以上 → 漁港は「うみが よごれて いる」', L.inspect(s, 31, 14).reasons.some((t) => /うみが よごれ/.test(t)), L.inspect(s, 31, 14).reasons);
      // すみやすさ
      const h = flat(L);
      roadV(L, h, EX, 3, 20);
      const hi = setUse(L, h, EX + 1, 10, L.USE.HOME, 3, 1);
      L.recalc(h);
      const l0 = h.live[hi];
      h.poll[(10 >> 2) * 16 + ((EX + 1) >> 2)] = 60;
      L.recalc(h);
      check(`よごれ 60 で すみやすさが 30 下がる（${l0} → ${h.live[hi]}）`, l0 - h.live[hi] === 30, { l0, l1: h.live[hi] });
    },
  },
  {
    id: 'CL10', tier: 'smoke', node: true, title: 'ぼくのまち：お金（毎月の入る・出る（維持費＋町の せわ）・税のたかさ・マイナスで育たない・払えない維持費は待つ・人口 0 で動けないときの ほじょきん）',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L, { money: 1000, rank: 1 });
      roadV(L, s, EX, 3, 22);                                                // みち 20 マス（いりぐち 3 マスは維持費なし）
      for (let y = 4; y <= 13; y++) setUse(L, s, EX + 1, y, L.USE.HOME, 3, 3);   // 住宅地 lvl 3 ×10 ＝ 120 人
      for (let y = 4; y <= 7; y++) setUse(L, s, EX - 1, y, L.USE.WORK, 1, 2);    // こうば lvl 2 ×4 ＝ 仕事 80
      for (let y = 8; y <= 10; y++) setUse(L, s, EX - 1, y, L.USE.GREEN);
      L.recalc(s);
      s.inflow = 0;
      const want = (tax) => Math.round((120 * L.HOME[3].tax + 80 * 0.12) * [0.7, 1, 1.3][tax]);
      const ev = months(L, s, 1);
      const m = ev.find((e) => e.kind === 'money');
      const pop = L.summary(s).pop, jobs = L.summary(s).jobs;
      const inc = Math.round((pop * L.HOME[3].tax + jobs * 0.12));
      const serv = Math.round(pop * L.SERVICE[1]);
      check(`入る＝(住む人の税＋仕事×0.12)×税・出る＝みち 20＋みどり 3＋町の せわ（人口 × ${L.SERVICE[1]}＝${serv}）（${m && m.income}・${m && m.cost}）`, m && m.income === inc && m.service === serv && m.cost === 23 + serv && m.delta === inc - 23 - serv - m.build && m.subsidy === 0, { m, pop, jobs, inc });
      check('summary に build（育つのに払ったお金）・service（町の せわ）', L.summary(s).service === serv && typeof L.summary(s).build === 'number', L.summary(s));
      check('month の events（year・month）', ev.some((e) => e.kind === 'month' && e.year === 1 && e.month === 5), ev.filter((e) => e.kind === 'month'));
      check('setTax：まち では 0〜2・むら では ふつう だけ', L.setTax(s, 2) && s.tax === 2 && !L.setTax(flat(L), 0) && !L.setTax(s, 3), null);
      const before = s.money;
      const ev2 = months(L, s, 1);
      const m2 = ev2.find((e) => e.kind === 'money');
      const popB = L.summary(s).pop, jobsB = L.summary(s).jobs;
      check('税 たかい は ×1.3', m2 && m2.income === Math.round((popB * L.HOME[3].tax + jobsB * 0.12) * 1.3) && s.money === before + m2.delta, { m2, want: want(2) });
      // マイナスで育たない（人口 0 なので ほじょきん 20 が毎月入り、3 か月で 0 以上に戻る）
      const n = flat(L, { money: -50 });
      roadV(L, n, EX, 3, 12);
      const h = setUse(L, n, EX + 1, 6, L.USE.HOME);
      L.recalc(n);
      const evn = months(L, n, 3);
      check('お金がマイナスの間は育たない・知らせ money', n.lvl[h] === 0 && evn.some((e) => e.kind === 'news' && e.why === 'money'), { lvl: n.lvl[h], news: evn.filter((e) => e.kind === 'news') });
      check(`マイナスの間は維持費を待つ（お金は ほじょきん の分だけ ふえる：-50 → ${n.money}）`, n.money === 10 && evn.filter((e) => e.kind === 'money').every((e) => e.cost === 0 && e.subsidy === L.SUBSIDY), { money: n.money, m: evn.filter((e) => e.kind === 'money') });
      months(L, n, 12);
      check('0 以上に戻ると育つ', n.lvl[h] > 0, n.lvl[h]);
      // 払えない維持費は待つ（0 より下にならない）
      const z = flat(L, { money: 5 });
      roadH(L, z, 3, 0, 60);
      L.recalc(z);
      const evz = months(L, z, 3);
      check(`お金 5 で みち 60 マス：月の計算でマイナスにならない（${z.money}）`, z.money >= 0 && evz.filter((e) => e.kind === 'money').every((e) => e.cost <= 20), { money: z.money, m: evz.filter((e) => e.kind === 'money') });
      // 人口 0・お金 0 で動けない（技術レビュー M1）：まちの ほじょきん で すむ を置けるようになり、ぬけ出せる
      const b = flat(L, { money: 2000 });
      const rr = L.place(b, 'road', [...L.lineCells(EX, 3, EX, 77), ...L.lineCells(0, 40, 63, 40), ...L.lineCells(0, 70, 63, 70)].filter((i) => b.use[i] === 0));
      check(`みち を ${rr.placed} マス引いて お金を使い切る（${b.money}）`, b.money < 20 && b.pop === 0, { money: b.money, placed: rr.placed });
      const evb = months(L, b, 1);
      const tip = evb.find((e) => e.kind === 'tip');
      check('人口 0・お金が すむ の値段より少ない → ほじょきん 20 が入る・tip（key broke・amount 20・text）と知らせ（why broke）', tip && tip.key === 'broke' && tip.amount === L.SUBSIDY && typeof tip.text === 'string' && tip.text.length > 0
        && evb.some((e) => e.kind === 'news' && e.why === 'broke') && b.money >= 20, { tip, money: b.money, ev: evb.filter((e) => e.kind === 'news' || e.kind === 'money') });
      const ph = L.place(b, 'home', [I(L, EX + 1, 5)]);
      months(L, b, 12);
      check(`すむ を置ける・育って人が来る（ぬけ出せる。人口 ${b.pop}）`, ph.placed === 1 && b.pop > 0, { placed: ph.placed, pop: b.pop, money: b.money });
      const ev12 = months(L, b, 12);
      check('人が来たあとは ほじょきん は入らない', ev12.filter((e) => e.kind === 'money').every((e) => e.subsidy === 0), ev12.filter((e) => e.kind === 'money').map((e) => e.subsidy));
      check('formatMoney・formatPop（3 けたごとのカンマ・マイナス）', L.formatMoney(99999999) === '99,999,999' && L.formatPop(1000) === '1,000' && L.formatMoney(-1234) === '-1,234' && L.formatMoney(0) === '0' && L.formatMoney(NaN) === '0', null);
    },
  },
  {
    id: 'CL11', tier: 'smoke', node: true, title: 'ぼくのまち：時間（speed 0 で進まない・1 か月＝16 tick・dt は 0.25 で切る・はやく は 4 倍・dateText）',
    run({ check, root }) {
      const L = load(root);
      const s = flat(L);
      L.setSpeed(s, 0);
      for (let n = 0; n < 100; n++) L.step(s, 0.25);
      check('とめる：100 回 step しても月も tick も進まない', s.month === 0 && s.tick === 0, { m: s.month, t: s.tick });
      check('setSpeed：0・1・4 だけ', L.setSpeed(s, 1) && s.speed === 1 && !L.setSpeed(s, 2) && s.speed === 1, null);
      for (let n = 0; n < 15; n++) L.step(s, 0.25);
      check('15 tick ではまだ 0 か月', s.month === 0 && s.tick === 15, { m: s.month, t: s.tick });
      const r = L.step(s, 0.25);
      check('16 tick で 1 か月（month の events）', s.month === 1 && r.events.some((e) => e.kind === 'month'), s.month);
      const t0 = s.tick;
      L.step(s, 10);
      check('dt 10 秒でも 0.25 秒ぶん（1 tick）だけ', s.tick === t0 + 1, s.tick - t0);
      L.setSpeed(s, 4);
      const t1 = s.tick;
      L.step(s, 0.25);
      check('はやく：dt 0.25 で 4 tick', s.tick === t1 + 4, s.tick - t1);
      check('step はおかしな dt・state でも落ちない', L.step(s, NaN).events.length === 0 && L.step(null, 1).events.length === 0 && L.step(s, -1).events.length === 0, null);
      check('dateText：0 → 1 ねんめ 4 がつ・8 → 1 ねんめ 12 がつ・9 → 1 ねんめ 1 がつ・12 → 2 ねんめ 4 がつ', L.dateText(0) === '1 ねんめ 4 がつ' && L.dateText(8) === '1 ねんめ 12 がつ' && L.dateText(9) === '1 ねんめ 1 がつ' && L.dateText(12) === '2 ねんめ 4 がつ', [L.dateText(0), L.dateText(9), L.dateText(12)]);
      const sm = L.summary(s);
      check('summary の year・month', sm.year === Math.floor(s.month / 12) + 1 && sm.month === ((s.month + 3) % 12) + 1, sm);
    },
  },
  {
    id: 'CL12', tier: 'smoke', node: true, title: 'ぼくのまち：できごと（割合・3 か月の間・はじめの 2 年は こまること が無い・かじ は 3 マスまで・おおあめ は 1 か月で戻る・人口 300 未満では起きない）',
    run({ check, root }) {
      const L = load(root);
      const mk = () => {
        const s = flat(L, { rank: 1 });
        s.terrain.fill(L.TER.FLAT);
        for (let x = 0; x < L.W; x++) s.terrain[I(L, x, 60)] = L.TER.RIVER;
        roadV(L, s, EX, 3, 62);
        for (let y = 4; y <= 58; y++) { setUse(L, s, EX + 1, y, L.USE.HOME, 3, 3); setUse(L, s, EX - 1, y, L.USE.WORK, 1, 1); }
        for (let y = 4; y <= 30; y += 4) setUse(L, s, EX + 2, y, L.USE.SHOP, 1, 1);
        L.recalc(s);
        return s;
      };
      const s = mk();
      const starts = [];
      for (let m = 0; m < 600; m++) {
        if (s.pop < 300) { for (let y = 4; y <= 58; y++) { s.lvl[I(L, EX + 1, y)] = 3; s.kind[I(L, EX + 1, y)] = 3; } L.recalc(s); }
        const ev = months(L, s, 1);
        for (const e of ev) if (e.kind === 'event') starts.push({ m: s.month, ev: e.ev, n: e.cells.length, good: e.good });
      }
      const rate = starts.length / 600;
      check(`600 か月で ${starts.length} 回（10% の くじ と 3 か月の間で 5〜10%）`, rate >= 0.05 && rate <= 0.10, rate);
      const gaps = starts.slice(1).map((e, k) => e.m - starts[k].m);
      check('起きたあと 3 か月は起きない（次まで 4 か月以上）', gaps.every((g) => g >= 4), gaps.filter((g) => g < 4));
      check('はじめの 2 年に こまること（おおあめ・かじ）は無い', starts.filter((e) => e.ev === 'rain' || e.ev === 'fire').every((e) => e.m > 24), starts.filter((e) => e.m <= 24));
      check('かじ は 1〜3 マス・こまること は good:false', starts.filter((e) => e.ev === 'fire').every((e) => e.n >= 1 && e.n <= 3 && !e.good), starts.filter((e) => e.ev === 'fire'));
      const kinds = new Set(starts.map((e) => e.ev));
      check(`いろいろ起きる（${[...kinds].join('・')}）`, kinds.has('festival') && kinds.has('fire') && kinds.has('rain'), [...kinds]);
      // おおあめ
      const r = mk();
      r.month = 30; r.ev.cool = 0;
      const ev = L.startEvent(r, 'rain');
      const e = ev.find((x) => x.kind === 'event');
      check('おおあめ：川のそばの みち 6 マスまでが通れない（blocked）', e && e.cells.length >= 1 && e.cells.length <= 6 && e.cells.every((i) => r.blocked[i] === 1), e);
      const ev2 = months(L, r, 1);
      check('1 か月で戻る（eventEnd・blocked 0）', ev2.some((x) => x.kind === 'eventEnd' && x.ev === 'rain') && e.cells.every((i) => r.blocked[i] === 0), null);
      // かじ（まわりに みどり も水も無い）
      const f = mk();
      const fe = L.startEvent(f, 'fire').find((x) => x.kind === 'event');
      check('かじ：建物が空き地に（区画は残る）・3 マスまで', fe && fe.cells.length <= 3 && fe.cells.every((i) => f.lvl[i] === 0 && f.use[i] >= 5), fe);
      let fp = 0; for (let i = 0; i < L.N; i++) if (f.use[i] === 5 && f.lvl[i]) fp += L.HOME[f.kind[i]].people[f.lvl[i]];
      check(`かじ のあと 人口を数え直す（${f.pop}・数えると ${fp}）`, f.pop === fp, { pop: f.pop, fp });
      // 300 未満
      const p = flat(L);
      roadV(L, p, EX, 3, 20);
      for (let y = 4; y <= 10; y++) setUse(L, p, EX + 1, y, L.USE.HOME, 3, 3);
      L.recalc(p);
      p.month = 30;
      const pe = months(L, p, 120).filter((x) => x.kind === 'event');
      check('人口 300 未満では起きない', pe.length === 0, pe);
    },
  },
  {
    id: 'CL13', tier: 'smoke', node: true, title: 'ぼくのまち：市民の声（困りごとごとに why・場所の添字・同じ声は 3 か月出ない・いい声）',
    run({ check, root }) {
      const L = load(root);
      const a = flat(L, { money: -10 });
      check('お金がマイナス → money（場所なし -1）', J(L.voiceOf(a)) === J({ why: 'money', i: -1, good: false, text: L.VOICES.money }), L.voiceOf(a));
      const b = flat(L);
      roadH(L, b, 30, 20, 30);
      const z = setUse(L, b, 25, 31, L.USE.HOME);
      L.recalc(b);
      const vb = L.voiceOf(b);
      check('つながっていない区画 → noroad（その区画の添字）', vb && vb.why === 'noroad' && vb.i === z, vb);
      const c = flat(L, { rank: 1 });
      roadV(L, c, EX, 3, 30);
      for (let y = 4; y <= 30; y++) for (const x of [EX - 2, EX - 1, EX + 1, EX + 2]) setUse(L, c, x, y, L.USE.HOME, 1, 3);
      for (let y = 4; y <= 30; y++) setUse(L, c, EX + 3, y, L.USE.WORK, 1, 3);
      L.recalc(c);
      const vc = L.voiceOf(c);
      check('こんでいる みち → jam（みち の添字）', vc && vc.why === 'jam' && (c.use[vc.i] === 1 || c.use[vc.i] === 9), vc);
      // 同じ声は 3 か月出ない
      const ev = months(L, c, 7).filter((e) => e.kind === 'voice');
      const jamMonths = [];
      const c2 = flat(L, { rank: 1 });
      roadV(L, c2, EX, 3, 30);
      for (let y = 4; y <= 30; y++) for (const x of [EX - 2, EX - 1, EX + 1, EX + 2]) setUse(L, c2, x, y, L.USE.HOME, 1, 3);
      for (let y = 4; y <= 30; y++) setUse(L, c2, EX + 3, y, L.USE.WORK, 1, 3);
      L.recalc(c2);
      for (let m = 0; m < 9; m++) for (const e of months(L, c2, 1)) if (e.kind === 'voice' && e.why === 'jam') jamMonths.push(c2.month);
      const g = jamMonths.slice(1).map((x, k) => x - jamMonths[k]);
      check(`同じ声（jam）は 3 か月あけて出る（${jamMonths.join(',')}）`, jamMonths.length >= 2 && g.every((x) => x >= 3), jamMonths);
      check('voice の events の形（why・i・good・text）', ev.every((e) => typeof e.why === 'string' && Number.isInteger(e.i) && typeof e.good === 'boolean' && typeof e.text === 'string' && e.text.length > 0), ev);
      // いい声
      const h = flat(L);
      roadV(L, h, EX, 3, 20);
      for (let y = 5; y <= 8; y++) setUse(L, h, EX + 2, y, L.USE.GREEN);
      setUse(L, h, EX - 2, 6, L.USE.SHOP, 1, 1);
      const hh = setUse(L, h, EX + 1, 6, L.USE.HOME, 3, 1);
      h.terrain[I(L, EX + 3, 6)] = L.TER.RIVER;
      L.recalc(h);
      const vh = L.voiceOf(h);
      check(`すみやすさ 75 以上（${h.live[hh]}）→ いい声 happy（good:true）`, vh && vh.why === 'happy' && vh.good === true && vh.i === hh, vh);
      check('声の言い方は責めない（「して！」を使わない）', Object.values(L.VOICES).every((t) => !/して！|しろ|なさい/.test(t)), L.VOICES);
      check('voiceOf はおかしな state で null', L.voiceOf(null) === null && L.voiceOf({}) === null, null);
    },
  },
  {
    id: 'CL14', tier: 'smoke', node: true, title: 'ぼくのまち：節目（rank が上がる・お祝いのお金・下がらない・best・せんろ が使えるようになる）',
    run({ check, root }) {
      const L = load(root);
      check('RANKS の人口（0・1,000・10,000・30,000・60,000）と名前', J(L.RANKS.map((r) => [r.pop, r.name])) === J([[0, 'むら'], [1000, 'まち'], [10000, 'し'], [30000, 'おおきな し'], [60000, 'だいとし']]), L.RANKS);
      const s = flat(L, { money: 100 });
      roadV(L, s, EX, 3, 50);
      for (let y = 4; y <= 50; y++) for (const x of [EX - 2, EX - 1, EX + 1, EX + 2]) setUse(L, s, x, y, L.USE.HOME, 3, 3);
      for (let y = 4; y <= 50; y++) setUse(L, s, EX + 3, y, L.USE.WORK, 1, 3);
      L.recalc(s);
      check(`人口 ${s.pop}（1,000 以上）`, s.pop >= 1000, s.pop);
      const m0 = s.money;
      const ev = months(L, s, 1);
      const rk = ev.find((e) => e.kind === 'rank');
      const md = ev.find((e) => e.kind === 'money');
      check('rank 1 まち・unlocks に rail・お祝いのお金', rk && rk.rank === 1 && rk.name === 'まち' && rk.unlocks.includes('rail') && s.rank === 1 && s.money === m0 + md.delta + L.RANKS[1].bonus, { rk, m0, money: s.money });
      check('best の events', ev.some((e) => e.kind === 'best' && e.pop === s.bestPop), ev.filter((e) => e.kind === 'best'));
      check('せんろ が使える', L.canPlace(s, 'rail', 40, 60).ok, L.canPlace(s, 'rail', 40, 60));
      for (let i = 0; i < L.N; i++) if (s.use[i] === L.USE.HOME) s.lvl[i] = 0;
      L.recalc(s);
      const ev2 = months(L, s, 1);
      check('人が減っても rank は下がらない・bestPop も残る', s.rank === 1 && s.bestPop >= 1000 && !ev2.some((e) => e.kind === 'rank'), { rank: s.rank, best: s.bestPop });
      check('summary の next・nextPop', L.summary(s).next === 'し' && L.summary(s).nextPop === 10000, L.summary(s));
      check('おおきな し・だいとし の unlocks は空（おおきな こうえん・まちの タワー は作らない。お祝いのお金だけ）', L.RANKS[3].unlocks.length === 0 && L.RANKS[4].unlocks.length === 0 && L.RANKS[3].bonus > 0 && L.RANKS[4].bonus > 0, L.RANKS.slice(3));
      check('道具に こうえん（大）・タワー は無い', !L.TOOLS.some((t) => /park|tower/.test(t.id)), L.TOOLS.map((t) => t.id));
    },
  },
  {
    id: 'CL15', tier: 'smoke', node: true, title: 'ぼくのまち：名前（normalizeName：空白・制御文字・11 文字・空・絵文字・文字でない）・rename',
    run({ check, root }) {
      const L = load(root);
      const n = L.normalizeName;
      const cases = [
        ['  みどりまち  ', 'みどりまち'], ['あ\nい\tう', 'あいう'], ['あいうえおかきくけこさ', 'あいうえおかきくけこ'], ['', 'ぼくのまち'], ['   ', 'ぼくのまち'],
        ['\u0000\u0007', 'ぼくのまち'], ['🍎🍎🍎🍎🍎🍎🍎🍎🍎🍎🍎', '🍎🍎🍎🍎🍎🍎🍎🍎🍎🍎'], ['東京タウン123', '東京タウン123'], [null, 'ぼくのまち'], [123, 'ぼくのまち'], ['a‮b', 'ab'],
      ];
      const bad = cases.filter(([a, b]) => n(a) !== b).map(([a, b]) => ({ a, want: b, got: n(a) }));
      check('normalizeName の表どおり', bad.length === 0, bad);
      check('家族の絵文字（いくつかの文字でできた 1 文字）も 1 文字に数える', n('👨‍👩‍👧'.repeat(12)) === '👨‍👩‍👧'.repeat(10), [...n('👨‍👩‍👧'.repeat(12))].length);
      const s = flat(L);
      check('rename は normalizeName を通す', L.rename(s, '  ねこまち\n') && s.name === 'ねこまち' && L.rename(s, '') && s.name === 'ぼくのまち', s.name);
    },
  },
  {
    id: 'CL16', tier: 'smoke', node: true, title: 'ぼくのまち：保存（往復で同じ・壊れた値で null・数の範囲外は直して読む・validateBest・saveVersionOf）',
    run({ check, root }) {
      const L = load(root);
      const r = L.simulate(3, 'grid', 150);
      const s = r.state;
      s.name = 'ほぞんまち'; s.tax = 0; s.speed = 4;
      const raw = L.makeSave(s, 1234567);
      const o = JSON.parse(raw);
      check('makeSave の形（§8 の欄）', o.v === 1 && o.at === 1234567 && ['seed', 'choice', 'name', 'money', 'month', 'acc', 'speed', 'tax', 'rank', 'bestPop', 'rng', 'entry', 'terrain', 'use', 'kind', 'lvl', 'poll', 'blocked', 'ev'].every((k) => k in o), Object.keys(o));
      check(`大きさ ${raw.length} 文字（60KB 以下）`, raw.length < 60000, raw.length);
      const t = L.loadSave(raw);
      const same = t && ['terrain', 'use', 'kind', 'lvl', 'poll', 'blocked'].every((f) => Buffer.from(t[f]).equals(Buffer.from(s[f])))
        && ['seed', 'choice', 'name', 'money', 'month', 'speed', 'tax', 'rank', 'bestPop', 'rng'].every((f) => t[f] === s[f]) && J(t.entry) === J(s.entry);
      check('往復で同じ', same, t && { money: [t.money, s.money], month: [t.month, s.month] });
      check('読んだあと 人口・仕事・ほし を計算し直す', t && t.pop === s.pop && t.jobs === s.jobs && t.star === s.star, t && { pop: [t.pop, s.pop], star: [t.star, s.star] });
      check('もう一度 makeSave しても同じ文字（at が同じなら）', L.makeSave(t, 1234567) === raw, null);
      const st9 = L.loadSave(mut0(raw, (x) => { x.star = 9; })), stN = L.loadSave(mut0(raw, (x) => { delete x.star; }));
      check('ほし は保存した値に戻す・無い／範囲外（9）は計算し直す（1〜5）', o.star === s.star && st9 && st9.star >= 1 && st9.star <= 5 && stN && stN.star >= 1 && stN.star <= 5, { o: o.star, st9: st9 && st9.star, stN: stN && stN.star });
      // 同じ乱数で同じに進む
      const a = L.loadSave(raw), b = L.loadSave(raw);
      months(L, a, 12); months(L, b, 12);
      check('読み込んだ 2 つは同じに進む（決定的）', a.pop === b.pop && a.money === b.money && Buffer.from(a.lvl).equals(Buffer.from(b.lvl)), [a.pop, b.pop]);
      const mut = (f) => { const x = JSON.parse(raw); f(x); return JSON.stringify(x); };
      const broken = {
        'JSON でない': '{abc', '空': '', 'null': 'null', '配列': '[]', 'v ちがい': mut((x) => { x.v = 2; }), 'v なし': mut((x) => { delete x.v; }),
        'terrain の長さちがい': mut((x) => { x.terrain = x.terrain.slice(0, -4); }), 'use が base64 でない': mut((x) => { x.use = '!' + x.use.slice(1); }),
        'lvl が範囲外（4）': mut((x) => { const u = Buffer.from(x.lvl, 'base64'); u[100] = 4; x.lvl = u.toString('base64'); }),
        'use が範囲外（10）': mut((x) => { const u = Buffer.from(x.use, 'base64'); u[100] = 10; x.use = u.toString('base64'); }),
        '海の上に すむ': mut((x) => { const t2 = Buffer.from(x.terrain, 'base64'); const u = Buffer.from(x.use, 'base64'); const k = t2.indexOf(1); u[k] = 5; x.use = u.toString('base64'); }),
        'poll が 101': mut((x) => { const u = Buffer.from(x.poll, 'base64'); u[0] = 101; x.poll = u.toString('base64'); }),
        'entry が無い': mut((x) => { delete x.entry; }), 'entry が いりぐち でない': mut((x) => { x.entry[0] = [0, 50]; }),
        'seed が文字': mut((x) => { x.seed = 'a'; }), 'choice 3': mut((x) => { x.choice = 3; }), 'kind が use に合わない': mut((x) => { const u = Buffer.from(x.use, 'base64'); const kd = Buffer.from(x.kind, 'base64'); const k = u.indexOf(1); kd[k] = 3; x.kind = kd.toString('base64'); }),
      };
      const got = Object.entries(broken).map(([k, v]) => { try { return [k, L.loadSave(v)]; } catch (e) { return [k, 'ERR ' + e.message]; } });
      check(`壊れた保存 ${got.length} 通りは null・例外なし`, got.every(([, v]) => v === null), got.filter(([, v]) => v !== null).map(([k]) => k));
      check('文字でない（undefined・数・オブジェクト）も null', [undefined, 5, {}, s].every((x) => L.loadSave(x) === null), null);
      const fix = L.loadSave(mut((x) => { x.money = 1e12; x.month = -5; x.speed = 3; x.tax = 9; x.rank = 99; x.bestPop = -1; x.name = '  ' + 'な'.repeat(20); x.acc = 99; x.ev = { cool: 99, active: [{ kind: 'nai', left: 1 }, { kind: 'festival', left: 2, cells: [1, -5, 'x'] }], lastBad: 'a' }; }));
      check('数・文字の範囲外は直して読む（お金・月・速さ・税・rank・best・名前・acc・できごと）', fix && fix.money === L.MONEY_MAX && fix.month === 0 && fix.speed === 1 && fix.tax === 1 && fix.rank === 4 && fix.bestPop >= 0 && fix.name === 'な'.repeat(10) && fix.acc <= 0.25
        && fix.ev.cool === 3 && fix.ev.active.length === 1 && J(fix.ev.active[0].cells) === '[1]' && fix.ev.lastBad === -1, fix && { money: fix.money, rank: fix.rank, tax: fix.tax, ev: fix.ev, name: fix.name });
      check('saveVersionOf：v を返す・壊れていれば null', L.saveVersionOf(raw) === 1 && L.saveVersionOf(mut((x) => { x.v = 3; })) === 3 && L.saveVersionOf('{x') === null, null);
      const vb = [['1234', 1234], ['0', 0], [' 56 ', 56], ['-3', 0], ['1.5', 0], ['abc', 0], ['', 0], [null, 0], ['99999999', 0], [777, 777]];
      check('validateBest', vb.every(([a, b]) => L.validateBest(a) === b), vb.map(([a]) => L.validateBest(a)));
      check('保存のキー', L.SAVE_KEY === 'machi.save' && L.SAVE_KEY_BAK === 'machi.bak' && L.SAVE_KEY_BEST === 'machi.best' && L.SAVE_KEY_SEEN === 'machi.seen', null);
    },
  },
  {
    id: 'CL17', tier: 'smoke', node: true, title: 'ぼくのまち：自動プレイ（計画書 §6 のねらい：none は 0・greedy は まち まで 5〜8 分・factory は 10% 以上へり ほし 2 以下・grid は factory より人が多く ほし 3 以上・お金はつまるがマイナスが続かない）',
    run({ check, root }) {
      const L = load(root);
      const res = {};
      for (const p of ['greedy', 'factory', 'grid']) res[p] = [1, 2].map((sd) => L.simulate(sd, p, 240, { choice: sd - 1 }));
      const none = L.simulate(1, 'none', 120);
      check('none：10 年 人口 0', none.pop === 0, none.pop);
      const t1k = res.greedy.map((r) => r.monthsTo[1000]);
      check(`greedy：まち（1,000）まで ${t1k.map((m) => m && (m * 4 / 60).toFixed(1) + ' 分').join('・')}（75〜125 か月＝5〜8.3 分）`, t1k.every((m) => m !== null && m >= 75 && m <= 125), t1k);
      check(`greedy：はじめの 2 年に お金が 500 を切る時がある（${res.greedy.map((r) => r.minMoney24).join('・')}）・マイナスが 12 か月続かない`, res.greedy.every((r) => r.minMoney24 < 500 && r.negRunMax < 12), res.greedy.map((r) => [r.minMoney24, r.negRunMax]));
      check(`factory：人口が一度 10% 以上へる（${res.factory.map((r) => Math.round(r.dropMax * 100) + '%').join('・')}）・ほし 2 以下の時がある`, res.factory.every((r) => r.dropMax >= 0.1 && r.starMin <= 2), res.factory.map((r) => [r.dropMax, r.starMin]));
      const y20 = (r) => r.log[239].pop;
      check(`grid：20 年で factory より人が多い（${res.grid.map(y20).join('・')} > ${res.factory.map(y20).join('・')}）・ほしの平均 3 以上`, res.grid.every((r, k) => y20(r) > y20(res.factory[k]) && r.starAvg >= 3), res.grid.map((r) => [y20(r), r.starAvg]));
      check(`greedy は渋滞が起きる（段 ${res.greedy.map((r) => r.jamMax).join('・')}）`, res.greedy.some((r) => r.jamMax >= 2), null);
      check('simulate はおかしな引数でも落ちない', L.simulate(1, 'nai', 2).pop === 0 && L.simulate('x', 'greedy', -1) !== undefined, null);
    },
  },
  {
    id: 'CL19', tier: 'smoke', node: true, title: 'ぼくのまち：お金の使い道（まち から 育つのに払う・足りなければ待つ・むら は ただ・町の せわ は節目で増える・税は来る人にも効く・お金がたまると知らせ）',
    run({ check, root }) {
      const L = load(root);
      check('SERVICE は節目ごとに増える（むら 0）・TAX_INFLOW は ひくい ＞ ふつう ＞ たかい', L.SERVICE[0] === 0 && L.SERVICE.every((v, k) => k === 0 || v > L.SERVICE[k - 1]) && L.TAX_INFLOW[0] > L.TAX_INFLOW[1] && L.TAX_INFLOW[1] > L.TAX_INFLOW[2], { sv: L.SERVICE, ti: L.TAX_INFLOW });
      // 育つ条件のそろった 住宅地 lvl 1 を 20 マス（仕事も足りる）
      const mk = (rank, money) => {
        const s = flat(L, { rank, money });
        roadV(L, s, EX, 3, 40);
        for (let y = 4; y <= 40; y++) setUse(L, s, EX - 1, y, L.USE.WORK, 1, 3);
        for (let y = 6; y <= 25; y++) setUse(L, s, EX + 1, y, L.USE.HOME, 3, 1);
        for (let y = 4; y <= 40; y += 3) setUse(L, s, EX + 2, y, L.USE.GREEN);
        L.recalc(s);
        s.inflow = 5000;
        return s;
      };
      const lv2 = (s) => { let n = 0; for (let y = 6; y <= 25; y++) if (s.lvl[I(L, EX + 1, y)] >= 2) n++; return n; };
      const a = mk(1, 0);
      const ins = L.inspect(a, EX + 1, 10);
      check('まち・お金 0：しらべる に「おおきく なるのに おかねが たりないよ」', ins.reasons.some((t) => /おおきく なるのに おかねが たりない/.test(t)), ins.reasons);
      const s0 = a.money;
      L.setSpeed(a, 1);
      for (let n = 0; n < 15; n++) L.step(a, 0.25);   // 月の終わりの前まで（入るお金で払えるようにならない）
      check(`まち・お金 0 では 1 段より上へ育たない（2 段 ${lv2(a)}）`, lv2(a) === 0 && a.money === s0, { n: lv2(a), money: a.money });
      const b = mk(1, 100000);
      const evb = months(L, b, 6).filter((e) => e.kind === 'money');
      const paid = evb.reduce((x, e) => x + e.build, 0);
      const want = Math.round((L.HOME[3].people[2] - L.HOME[3].people[1]) * (L.BUILD_PAY + b.pop * L.BUILD_PAY_RATE));
      check(`まち・お金あり：育つ（2 段 ${lv2(b)}）・育つのに払う（6 か月で ${paid}。1 段ぶん 約 ${want}）・money の delta に入る`, lv2(b) > 0 && paid >= lv2(b) * 4 * L.BUILD_PAY && evb.every((e) => e.delta === e.income - e.cost - e.build + e.subsidy), { n: lv2(b), paid, want });
      const c = mk(0, 0);
      months(L, c, 6);
      check(`むら では お金 0 でも ただで育つ（2 段 ${lv2(c)}）`, lv2(c) > 0, lv2(c));
      // 税は 来る人 にも効く
      const t = mk(1, 100000);
      const inflowOf = (tax) => { const s = mk(1, 100000); L.setTax(s, tax); s.inflow = 0; months(L, s, 1); return s.inflow; };
      const i0 = inflowOf(0), i1 = inflowOf(1), i2 = inflowOf(2);
      check(`1 か月に来る人：ひくい ${i0.toFixed(1)} ＞ ふつう ${i1.toFixed(1)} ＞ たかい ${i2.toFixed(1)}`, i0 > i1 && i1 > i2, { i0, i1, i2, t: t.tax });
      // お金がたまると、ぜいを さげる知らせ
      const r = mk(1, 50000);
      const evr = months(L, r, 13).filter((e) => e.kind === 'news');
      check('まち・ふつう・お金 2 万以上 → 知らせ why rich（ぜいを ひくく すると…）', evr.some((e) => e.why === 'rich' && /ぜいを ひくく/.test(e.text)), evr);
      const q = mk(1, 50000); L.setTax(q, 0);
      check('税 ひくい のときは rich を出さない', !months(L, q, 13).some((e) => e.kind === 'news' && e.why === 'rich'), null);
    },
  },
  {
    id: 'CL20', tier: 'full', node: true, title: 'ぼくのまち：自動プレイで税の 3 段と住む場所（ひくい は育つのが速くお金がたまらない・たかい はお金がたまり育つのが遅い・お金がたまったら税を下げると いちばん育つ・住宅地と高級住宅地が 2 割以上）',
    run({ check, root }) {
      const L = load(root);
      const seeds = [1, 2];
      const at = (r, m) => r.log[m - 1];
      const run = (tax) => seeds.map((sd) => L.simulate(sd, 'grid', 360, { choice: sd - 1, tax }));
      const T = [run(0), run(1), run(2)];
      const smart = seeds.map((sd) => L.simulate(sd, 'grid', 360, { choice: sd - 1 }));
      const pops = (k, m) => T[k].map((r) => at(r, m).pop);
      const moneys = (k, m) => T[k].map((r) => at(r, m).money);
      check(`25 年目の人口：ひくい ${pops(0, 300)} ＞ ふつう ${pops(1, 300)} ＞ たかい ${pops(2, 300)}`, seeds.every((_, j) => pops(0, 300)[j] > pops(1, 300)[j] && pops(1, 300)[j] > pops(2, 300)[j]), [pops(0, 300), pops(1, 300), pops(2, 300)]);
      check(`25 年目のお金：ひくい ${moneys(0, 300)} ＜ ふつう ${moneys(1, 300)} ＜ たかい ${moneys(2, 300)}`, seeds.every((_, j) => moneys(0, 300)[j] < moneys(1, 300)[j] && moneys(1, 300)[j] < moneys(2, 300)[j]), [moneys(0, 300), moneys(1, 300), moneys(2, 300)]);
      check(`ひくい だけ では お金が たまらない（25 年目 ${moneys(0, 300)}・ふつう の 1 割より少ない）`, seeds.every((_, j) => moneys(0, 300)[j] < moneys(1, 300)[j] * 0.1), null);
      check(`ふつう の お金は 30 年で 10 万より少ない（${T[1].map((r) => r.money)}）`, T[1].every((r) => r.money < 100000), T[1].map((r) => r.money));
      check(`お金がたまったら ひくい にする（grid の決まり）と、30 年目の人口が ふつう だけ より多い（${smart.map((r) => r.pop)} ＞ ${T[1].map((r) => r.pop)}）`, smart.every((r, j) => r.pop > T[1][j].pop), null);
      const share = (rs) => { const c = [0, 0, 0, 0, 0]; for (const r of rs) { const s = r.state; for (let i = 0; i < L.N; i++) if (s.use[i] === 5 && s.lvl[i] > 0) c[s.kind[i]]++; } return { c, low: (c[3] + c[4]) / (c[1] + c[2] + c[3] + c[4]) }; };
      const g = share(seeds.map((sd) => L.simulate(sd, 'greedy', 480, { choice: sd - 1 }))), gr = share(T[1]);
      check(`住宅地＋高級住宅地の割合：greedy 40 年 ${(g.low * 100).toFixed(0)}%・grid 30 年 ${(gr.low * 100).toFixed(0)}%（2 割以上）`, g.low >= 0.2 && gr.low >= 0.2, { g, gr });
    },
  },
  {
    id: 'CL18', tier: 'smoke', flaky: { why: 'Node で step の時間を測る', checks: /ms/ }, node: true, solo: true, title: 'ぼくのまち：重さ（64×78 の greedy 20 年の町で step 1 回：中央 3ms 以内・95% 1.5ms 以内・月の終わりを含む最大 20ms 以内（Node））',
    run({ check, root }) {
      const L = load(root);
      const s = L.simulate(1, 'greedy', 240).state;
      s.speed = 1;
      for (let n = 0; n < 64; n++) L.step(s, 0.25);   // あたため
      const t = [];
      for (let n = 0; n < 640; n++) { const c = cpuOf(); L.step(s, 0.25); t.push(cpuMs(cpuOf(c))); }
      t.sort((a, b) => a - b);
      const med = t[320], p95 = t[608], max = t[639];
      check(`step 1 回の中央 ${med.toFixed(3)}ms（3ms 以内）`, med <= 3, med);
      check(`step 1 回の 95% ${p95.toFixed(3)}ms（1.5ms 以内。月の終わりの計算を月の中の tick に分けた）`, p95 <= 1.5, p95);
      check(`いちばん重い step（月の終わり）${max.toFixed(2)}ms（20ms 以内）`, max <= 20, max);
      const raw = L.makeSave(s, 0);
      const c = cpuOf(); L.loadSave(raw); const lm = cpuMs(cpuOf(c));
      check(`loadSave ${lm.toFixed(1)}ms（100ms 以内）`, lm <= 100, lm);
    },
  },
];

// ---- 単体で流す：node tests/cases/machi-logic.mjs [ID...] ----
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
