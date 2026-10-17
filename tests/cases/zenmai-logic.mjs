// ZL: ゼンマイさんぽの計算ロジック（Node で games/zenmai/logic.js・stages.js を直接読む。ブラウザ不要）
import path from 'node:path';
import { createRequire } from 'node:module';

function load(root) {
  const req = createRequire(path.join(root, 'games/zenmai/'));
  const stages = req(path.join(root, 'games/zenmai/stages.js'));
  globalThis.ZenmaiStages = stages;                       // logic.js の validateProgress が参照する
  const L = req(path.join(root, 'games/zenmai/logic.js'));
  return { L, S: stages };
}
const INIT = JSON.stringify({ stars: {}, unlocked: 1 });
const mid = (b) => (b.min + b.max) / 2;

export const tests = [
  {
    id: 'ZL1', tier: 'smoke', node: true, title: 'ゼンマイ：15ステージの構造と、どのステージも★3が取れる（幅0.15回転以上）',
    run({ check, root }) {
      const { L, S } = load(root);
      check('ステージは15個、id は z01〜z15 の順', S.length === 15 && S.every((s, i) => s.id === 'z' + String(i + 1).padStart(2, '0')), S.map((s) => s.id));
      const shape = S.filter((s) => !(s.length === 1000 && s.startX < s.target.x && s.target.x + s.target.w <= s.cliffX && s.cliffX <= s.length && s.maxTurns > 0
        && Array.isArray(s.segments) && s.segments.length > 0 && s.name && s.hint));
      check('各ステージの形（startX < 帯 ≦ 崖 ≦ 長さ、maxTurns、区間、name、hint）', shape.length === 0, shape.map((s) => s.id));
      const narrow = [], bad = [], notQuarter = [];
      for (const s of S) {
        const b = L.bestTurns(s);
        if (!b || !(b.max - b.min >= 0.15)) { narrow.push({ id: s.id, b }); continue; }
        if (!(b.max < s.maxTurns)) bad.push({ id: s.id, b, maxTurns: s.maxTurns });
        const sim = L.simulate(s, mid(b));
        if (sim.result !== 'stop' || sim.stars !== 3) bad.push({ id: s.id, mid: mid(b), sim: { r: sim.result, x: sim.x, st: sim.stars } });
        // ＋/－ボタン（1/4回転刻み）でも★3に届く
        const q = Math.ceil(b.min * 4 - 1e-9) / 4;
        if (q > b.max + 1e-9) notQuarter.push({ id: s.id, b });
      }
      check('全15ステージで bestTurns の幅が0.15回転以上', narrow.length === 0, narrow);
      check('bestTurns の中央で simulate すると stop・★3、上端は maxTurns 未満', bad.length === 0, bad);
      check('★3範囲に1/4回転の倍数が含まれる（＋/－ボタンだけでも★3）', notQuarter.length === 0, notQuarter);
      const ranges = S.map((s) => L.bestTurns(s)).map((b) => b && b.min);
      check('後のステージほど遠い（最初の3つは平ら、最後は最初より巻く）', S.slice(0, 3).every((s) => s.segments.every((g) => g.type === 'flat')) && ranges[14] > ranges[0], ranges);
    },
  },
  {
    id: 'ZL2', tier: 'smoke', node: true, title: 'ゼンマイ：simulate の結果（止まる・落ちる・巻きすぎ・境界）',
    run({ check, root }) {
      const { L, S } = load(root);
      const s = S[0];
      const wide = { ...s, maxTurns: 30 };                    // 崖まで届く巻き数を確かめるため、巻きすぎを遠ざけた版
      const b = L.bestTurns(s);
      const ok = L.simulate(s, mid(b));
      check('ちょうどよい巻き数：stop・★3、path は時間も位置も単調', ok.result === 'stop' && ok.stars === 3
        && ok.path.length >= 2 && ok.path.every((p, i, a) => i === 0 || (p.t >= a[i - 1].t && p.x >= a[i - 1].x - 1e-9)), { r: ok.result, x: ok.x });
      const z = L.simulate(s, 0);
      check('0回転は動かず stop、★0（帯の外）', z.result === 'stop' && z.x === s.startX && z.stars === 0, z);
      const fall = L.simulate(wide, L.turnsToReach(wide, wide.cliffX) + 0.5);
      check('崖を越える巻き数は fall・★0', fall.result === 'fall' && fall.stars === 0, { r: fall.result, x: fall.x });
      check('崖ちょうどは落ちない（stop）', L.simulate(wide, L.turnsToReach(wide, wide.cliffX)).result === 'stop');
      const br = L.simulate(s, s.maxTurns + 0.01), mx = L.simulate(s, s.maxTurns);
      check('maxTurns 超えは break（歩かない・★0）、maxTurns ちょうどは break でない', br.result === 'break' && br.stars === 0 && br.x === s.startX && mx.result !== 'break', { br: br.result, mx: mx.result });
      check('NaN・負の巻き数は0扱いで例外なし', L.simulate(s, NaN).x === s.startX && L.simulate(s, -3).x === s.startX);
      let prev = -1, mono = true;
      for (let t = 0; t <= 6; t += 0.25) { const r = L.simulate(s, t); if (r.x < prev - 1e-9) mono = false; prev = r.x; }
      check('平らな舞台では巻くほど遠くへ止まる（単調）', mono);
    },
  },
  {
    id: 'ZL3', tier: 'smoke', node: true, title: 'ゼンマイ：地形（上り坂は進みにくい・下り坂は進みやすい・風）',
    run({ check, root }) {
      const { L } = load(root);
      const mk = (type, k) => ({ id: 'zt', length: 1000, startX: 0, cliffX: 1000, target: { x: 400, w: 100 }, maxTurns: 20, segments: [{ x0: 0, x1: 1000, type, k }] });
      const x = (type, k) => L.simulate(mk(type, k), 3).x;
      const flat = x('flat', 1);
      check('平ら：3回転で 3×STEP 進む', Math.abs(flat - 3 * L.STEP) < 1e-6, flat);
      check('上り坂(k<1)は平らより短く、下り坂(k>1)は長い', x('up', 0.5) < flat && x('down', 1.5) > flat, { up: x('up', 0.5), down: x('down', 1.5) });
      check('追い風(+)は長く、向かい風(-)は短い', x('wind', 0.5) > flat && x('wind', -0.4) < flat, { tail: x('wind', 0.5), head: x('wind', -0.4) });
      const mixed = { id: 'zt', length: 1000, startX: 0, cliffX: 1000, target: { x: 400, w: 100 }, maxTurns: 20,
        segments: [{ x0: 0, x1: 100, type: 'flat', k: 1 }, { x0: 100, x1: 1000, type: 'up', k: 0.5 }] };
      const t = L.turnsToReach(mixed, 200);
      check('区間をまたぐ巻き数：turnsToReach と simulate が一致', Math.abs(L.simulate(mixed, t).x - 200) < 1e-6, { t, x: L.simulate(mixed, t).x });
    },
  },
  {
    id: 'ZL4', tier: 'smoke', node: true, title: 'ゼンマイ：starsFor の境界（★3/★2/★1/帯の外/崖の先）',
    run({ check, root }) {
      const { L } = load(root);
      const st = { startX: 0, cliffX: 600, length: 1000, target: { x: 200, w: 100 }, maxTurns: 10, segments: [] };
      const c = 250;                                           // 帯の中心。半幅50、★3は±12.5、★2は±30
      const T = [[c, 3], [c + 12.5, 3], [c - 12.5, 3], [c + 13, 2], [c + 30, 2], [c + 31, 1], [c - 50, 1], [c + 50, 1], [c + 51, 0], [c - 51, 0], [700, 0], [NaN, 0], [Infinity, 0]];
      const bad = T.filter(([x, e]) => L.starsFor(st, x) !== e).map(([x, e]) => ({ x, e, got: L.starsFor(st, x) }));
      check('境界値すべて期待どおり', bad.length === 0, bad);
      check('帯の中心に近いほど★が多い（単調）', [0, 10, 20, 40, 60].map((d) => L.starsFor(st, c + d)).every((v, i, a) => i === 0 || v <= a[i - 1]));
      check('stage が不正でも例外なく0', L.starsFor(null, 100) === 0 && L.starsFor({}, 100) === 0);
    },
  },
  {
    id: 'ZL5', tier: 'smoke', node: true, title: 'ゼンマイ：回転の計算（angleDelta・turnsFromRadians）',
    run({ check, root }) {
      const { L } = load(root);
      const P = Math.PI, near = (a, b) => Math.abs(a - b) < 1e-9;
      check('angleDelta：小さな差・符号', near(L.angleDelta(0, 0.5), 0.5) && near(L.angleDelta(0.5, 0), -0.5));
      check('angleDelta：±π をまたいでも短い向きに（3.0→-3.0 は正方向に約0.283）', near(L.angleDelta(3.0, -3.0), 2 * P - 6.0) && near(L.angleDelta(-3.0, 3.0), -(2 * P - 6.0)));
      const grid = [], out = [];
      for (let a = -7; a <= 7; a += 0.7) for (let b = -7; b <= 7; b += 0.9) grid.push([a, b]);
      for (const [a, b] of grid) { const d = L.angleDelta(a, b); if (!(d > -P - 1e-9 && d <= P + 1e-9)) out.push([a, b, d]); }
      check('angleDelta は常に -π〜π に収まる', out.length === 0, out.slice(0, 3));
      check('angleDelta：同じ角・NaN は0', L.angleDelta(1, 1) === 0 && L.angleDelta(NaN, NaN) === 0);
      check('turnsFromRadians：2π=1回転、時計回り(正)、-π=-0.5、不正は0', near(L.turnsFromRadians(2 * P), 1) && near(L.turnsFromRadians(-P), -0.5) && L.turnsFromRadians(NaN) === 0 && L.turnsFromRadians('x') === 0);
      let tot = 0, a = 0; for (let i = 0; i < 16; i++) { const n = a + P / 8; tot += L.angleDelta(a, ((n + P) % (2 * P)) - P); a = ((n + P) % (2 * P)) - P; }
      check('1/8回転×16回の積算で ちょうど1回転', near(L.turnsFromRadians(tot), 1), L.turnsFromRadians(tot));
    },
  },
  {
    id: 'ZL6', tier: 'smoke', node: true, title: 'ゼンマイ：進行データ validateProgress（不正は初期値、★は0〜3、解放数の範囲）',
    run({ check, root }) {
      const { L } = load(root);
      const bad = [null, undefined, 5, 'x', '{bad', [], '[]', true, () => 1];
      check('不正な値はすべて初期値 {stars:{}, unlocked:1}', bad.every((v) => JSON.stringify(L.validateProgress(v)) === INIT), bad.map((v) => L.validateProgress(v)));
      const p = L.validateProgress({ stars: { z01: 3, z02: 2, z03: 9, z04: -1, z05: 1.5, zz: 1, z99: 2, z06: '3' }, unlocked: 4 });
      check('範囲外・小数・未知のid・型違いの★は捨てる', p.stars.z01 === 3 && p.stars.z02 === 2 && !('z03' in p.stars) && !('z04' in p.stars) && !('z05' in p.stars) && !('zz' in p.stars) && !('z99' in p.stars) && !('z06' in p.stars), p);
      check('unlocked は保存値を尊重（4）', p.unlocked === 4, p.unlocked);
      check('unlocked は 1〜15 に収める（巨大・0・負・小数）', L.validateProgress({ stars: {}, unlocked: 999 }).unlocked === 15 && L.validateProgress({ stars: {}, unlocked: 0 }).unlocked === 1
        && L.validateProgress({ stars: {}, unlocked: -4 }).unlocked === 1 && L.validateProgress({ stars: {}, unlocked: 2.5 }).unlocked === 1);
      check('★を持つステージの次は開いている', L.validateProgress({ stars: { z05: 1 }, unlocked: 1 }).unlocked >= 6);
      check('JSON文字列も受け付ける／往復しても同じ', JSON.stringify(L.validateProgress(JSON.stringify(p))) === JSON.stringify(p));
      const src = { stars: { z01: 1 }, unlocked: 2 }, snap = JSON.stringify(src);
      if (L.recordResult) {
        const r = L.recordResult(src, 'z01', 3), r2 = L.recordResult(r, 'z01', 1);
        check('recordResult：最高★を残し、元の値は変えない', r.stars.z01 === 3 && r2.stars.z01 === 3 && JSON.stringify(src) === snap);
        check('recordResult：★0では次は開かない、★1以上で開く', L.recordResult(INIT, 'z03', 0).unlocked === 1 && L.recordResult(INIT, 'z03', 1).unlocked === 4 && L.recordResult(INIT, 'z15', 3).unlocked === 15);
        check('recordResult：不正な id・★は無視', JSON.stringify(L.recordResult(INIT, 'z99', 3)) === INIT && JSON.stringify(L.recordResult(INIT, 'z01', 7)) === INIT);
      }
    },
  },
];
