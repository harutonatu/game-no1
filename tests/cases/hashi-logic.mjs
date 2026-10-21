// HL: ハシわたりの計算ロジック（Node で games/hashi/logic.js・course.js を直接読む。ブラウザ不要）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

function load(root) {
  const dir = path.join(root, 'games/hashi/');
  for (const f of ['course.js', 'logic.js']) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`games/hashi/${f} が無い（ロジックのテストができない）`);
  }
  const req = createRequire(dir);
  const C = req(path.join(dir, 'course.js'));
  globalThis.HashiCourse = C;                              // logic.js の createRun・resolve が参照する
  const L = req(path.join(dir, 'logic.js'));
  if (!L || typeof L.resolve !== 'function') throw new Error('logic.js が HashiLogic を module.exports していない');
  if (!C || typeof C.makeNext !== 'function') throw new Error('course.js が HashiCourse を module.exports していない');
  return { L, C };
}

// 再現できる乱数（mulberry32）
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const right = (p) => p.x + p.w;
const center = (p) => p.x + p.w / 2;
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
// 葉の並びを決めた state（createRun の state を土台に、platforms だけ差し替える）
const PL = [{ x: 0, w: 100 }, { x: 300, w: 100 }, { x: 500, w: 100 }];   // 今の葉の右端 100、渡る先 300〜400（中心 350）
const rigged = (L, extra = {}) => ({ ...L.createRun({ random: () => 0.5 }), platforms: PL.map((p) => ({ ...p })), ...extra });

export const tests = [
  {
    id: 'HL1', tier: 'smoke', node: true, title: 'ハシわたり：定数と、押した時間⇔茎の長さ（境界・ゆっくり・逆関数）',
    run({ check, root }) {
      const { L } = load(root);
      const K = { VIEW_W: 1000, GROW_PER_MS: 0.5, SLOW_FACTOR: 0.5, MAX_LEN: 800, MIN_HOLD_MS: 60, PERFECT_HALF: 10, NEAR: 20, CAMERA_LEFT: 200, LIVES: 3, BONUS_CAP: 16, SAVE_KEY_BEST: 'hashi.best' };
      const kBad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約書 §3・§4 のとおり', kBad.length === 0, kBad);
      const T = [
        [0, undefined, 0], [L.MIN_HOLD_MS, undefined, 30], [1000, undefined, 500], [1600, undefined, 800], [1601, undefined, 800], [1e9, undefined, 800],
        [NaN, undefined, 0], [-5, undefined, 0], [-Infinity, undefined, 0], [Infinity, undefined, 800],
        [1000, { slow: false }, 500], [1000, {}, 500],
        [0, { slow: true }, 0], [L.MIN_HOLD_MS, { slow: true }, 15], [1000, { slow: true }, 250], [3200, { slow: true }, 800], [3300, { slow: true }, 800],
        [NaN, { slow: true }, 0], [-1, { slow: true }, 0], [Infinity, { slow: true }, 800],
      ];
      const bad = T.filter(([h, o, e]) => { const v = o === undefined ? L.lengthFromHold(h) : L.lengthFromHold(h, o); return !near(v, e); })
        .map(([h, o, e]) => ({ hold: h, opts: o, want: e, got: o === undefined ? L.lengthFromHold(h) : L.lengthFromHold(h, o) }));
      check('lengthFromHold の境界（0・MIN_HOLD_MS・MAX_LEN ちょうど・超え・NaN・負・±Infinity、ゆっくり あり/なし）', bad.length === 0, bad);
      check('holdForLength：0→0ms、MAX_LEN→1600ms、ゆっくりでは MAX_LEN→3200ms', near(L.holdForLength(0), 0) && near(L.holdForLength(L.MAX_LEN), 1600) && near(L.holdForLength(L.MAX_LEN, { slow: true }), 3200) && near(L.holdForLength(400, { slow: false }), 800),
        { h0: L.holdForLength(0), hMax: L.holdForLength(L.MAX_LEN), hMaxSlow: L.holdForLength(L.MAX_LEN, { slow: true }) });
      const inv = [];
      for (const slow of [false, true]) {
        for (const len of [0, 1, 30, 123.5, 400, 799, 800]) { const back = L.lengthFromHold(L.holdForLength(len, { slow }), { slow }); if (!near(back, len, 1e-6)) inv.push({ slow, len, back }); }
        const hMax = slow ? 3200 : 1600;
        for (let h = 0; h <= hMax; h += 37) { const back = L.holdForLength(L.lengthFromHold(h, { slow }), { slow }); if (!near(back, h, 1e-6)) inv.push({ slow, h, back }); }
      }
      check('lengthFromHold と holdForLength が互いに逆（0..MAX_LEN の範囲、ゆっくり あり/なし）', inv.length === 0, inv.slice(0, 5));
      let mono = true, prev = -1;
      for (let h = -100; h <= 2000; h += 10) { const v = L.lengthFromHold(h); if (v < prev || v < 0 || v > L.MAX_LEN) mono = false; prev = v; }
      check('押すほど長い（単調）、0..MAX_LEN からはみ出さない', mono);
    },
  },
  {
    id: 'HL2', tier: 'smoke', node: true, title: 'ハシわたり：resolve の判定（端ちょうどで渡れる・外れ・ぴったり・missBy・おしい）',
    run({ check, root }) {
      const { L } = load(root);
      const s = rigged(L);
      check('土台の state：今の葉の右端 100、渡る先 300〜400', right(s.platforms[0]) === 100 && s.platforms[1].x === 300 && right(s.platforms[1]) === 400);
      const r = (len) => L.resolve(s, len).outcome;
      // 端ちょうど（閉区間）
      const left = r(200), rgt = r(300);
      check('葉の左端ちょうど（tipX=300）は cross', left && left.kind === 'cross' && left.tipX === 300, left);
      check('葉の右端ちょうど（tipX=400）は cross', rgt && rgt.kind === 'cross' && rgt.tipX === 400, rgt);
      check('cross の landX は渡る先の葉の右端（400）', left.landX === 400 && rgt.landX === 400, { left: left.landX, rgt: rgt.landX });
      // 外れ
      const s1 = r(199), l1 = r(301);
      check('左端の1手前（tipX=299）は fall・short・missBy 1・near', s1.kind === 'fall' && s1.reason === 'short' && near(s1.missBy, 1) && s1.near === true && s1.tipX === 299, s1);
      check('右端の1先（tipX=401）は fall・long・missBy 1・near', l1.kind === 'fall' && l1.reason === 'long' && near(l1.missBy, 1) && l1.near === true && l1.tipX === 401, l1);
      const n20 = r(180), n21 = r(179), f20 = r(320), f21 = r(321);
      check('みじかすぎ：missBy 20 は near、21 は near でない', n20.reason === 'short' && near(n20.missBy, 20) && n20.near === true && n21.reason === 'short' && near(n21.missBy, 21) && n21.near === false, { n20, n21 });
      check('ながすぎ：missBy 20 は near、21 は near でない', f20.reason === 'long' && near(f20.missBy, 20) && f20.near === true && f21.reason === 'long' && near(f21.missBy, 21) && f21.near === false, { f20, f21 });
      const far = r(5);
      check('うんと短い：short・missBy は葉の左端まで（195）・near でない', far.kind === 'fall' && far.reason === 'short' && near(far.missBy, 195) && far.near === false, far);
      // ぴったり（中心 350 ±10）
      const P = [[250, true], [260, true], [240, true], [261, false], [239, false], [200, false], [300, false]];
      const pBad = P.filter(([len, e]) => { const o = r(len); return !(o.kind === 'cross' && o.perfect === e); }).map(([len, e]) => ({ len, want: e, got: r(len) }));
      check('ぴったり：中心 ±PERFECT_HALF（tipX 340〜360）だけ perfect、外は perfect でない', pBad.length === 0, pBad);
      const half = r(250.5);
      check('小数の長さも扱える（tipX 350.5 は perfect）', half.kind === 'cross' && half.perfect === true && near(half.tipX, 350.5), half);
      // 長さの丸め
      const neg = r(-50), nan = r(NaN), huge = r(1e9);
      check('負の長さは 0 扱い（tipX=今の葉の右端、short）', neg.kind === 'fall' && neg.reason === 'short' && neg.tipX === 100 && near(neg.missBy, 200), neg);
      check('NaN の長さは 0 扱い（tipX=100、例外なし）', nan.kind === 'fall' && nan.reason === 'short' && nan.tipX === 100, nan);
      check('MAX_LEN を超える長さは MAX_LEN 扱い（tipX=900、long、missBy 500）', huge.kind === 'fall' && huge.reason === 'long' && huge.tipX === 900 && near(huge.missBy, 500), huge);
      // 公平さの確認：その葉に届く長さはいつも MAX_LEN 以下
      check('渡る先の右端ちょうど（len 300）≦ MAX_LEN', 300 <= L.MAX_LEN);
    },
  },
  {
    id: 'HL3', tier: 'smoke', node: true, title: 'ハシわたり：点数（+1、ぴったりボーナス 1→2→4→8→16→16、streak の切れ方）と hud',
    run({ check, root }) {
      const { L } = load(root);
      const PB = [[-1, 0], [0, 0], [1, 1], [2, 2], [3, 4], [4, 8], [5, 16], [6, 16], [7, 16], [50, 16]];
      const pbBad = PB.filter(([n, e]) => L.perfectBonus(n) !== e).map(([n, e]) => ({ n, want: e, got: L.perfectBonus(n) }));
      check('perfectBonus：0 以下は 0、1→2→4→8→16 で頭打ち（上限 BONUS_CAP）', pbBad.length === 0, pbBad);

      let s = L.createRun({ random: seeded(7) });
      const perfLen = (st) => center(st.platforms[1]) - right(st.platforms[0]);
      const edgeLen = (st) => st.platforms[1].x - right(st.platforms[0]);            // 左端ちょうど（ぴったりでない）
      const want = [1, 2, 4, 8, 16, 16];
      const got = [], gains = [], streaks = [], scores = [];
      for (let i = 0; i < want.length; i++) {
        const { state, outcome } = L.resolve(s, perfLen(s));
        got.push(outcome.kind === 'cross' && outcome.perfect ? outcome.bonus : 'x');
        gains.push(outcome.gain); streaks.push(outcome.streak); scores.push(outcome.score === state.score ? state.score : 'mismatch');
        s = state;
      }
      check('ぴったり6連続のボーナスが 1→2→4→8→16→16', JSON.stringify(got) === JSON.stringify(want), got);
      check('gain = 1 + bonus', JSON.stringify(gains) === JSON.stringify(want.map((b) => 1 + b)), gains);
      check('streak が 1→6 と増え、outcome.score は新しい state.score と同じ', JSON.stringify(streaks) === '[1,2,3,4,5,6]' && scores.every((v) => v !== 'mismatch'), { streaks, scores });
      const total = want.reduce((a, b) => a + 1 + b, 0);   // 53
      check(`6回のぴったりで score ${total}・crossed 6・perfects 6・streak 6・bestStreak 6`, s.score === total && s.crossed === 6 && s.perfects === 6 && s.streak === 6 && s.bestStreak === 6,
        { score: s.score, crossed: s.crossed, perfects: s.perfects, streak: s.streak, bestStreak: s.bestStreak });

      const plain = L.resolve(s, edgeLen(s));
      check('ぴったりでない cross：+1 だけ、bonus 0、streak 0、bestStreak は 6 のまま', plain.outcome.kind === 'cross' && plain.outcome.perfect === false && plain.outcome.gain === 1 && plain.outcome.bonus === 0
        && plain.state.score === total + 1 && plain.state.streak === 0 && plain.outcome.streak === 0 && plain.state.bestStreak === 6 && plain.state.crossed === 7 && plain.state.perfects === 6, { o: plain.outcome, score: plain.state.score });
      s = plain.state;
      const again = L.resolve(s, perfLen(s));
      check('streak が切れた後のぴったりは、また bonus 1 から', again.outcome.perfect === true && again.outcome.bonus === 1 && again.state.streak === 1 && again.state.score === total + 3, again.outcome);
      s = again.state;
      const fl = L.resolve(s, 0);
      check('落ちると streak 0、score はそのまま', fl.outcome.kind === 'fall' && fl.state.streak === 0 && fl.state.score === s.score && fl.outcome.score === s.score && fl.state.bestStreak === 6, fl.outcome);
      const after = L.resolve(fl.state, perfLen(fl.state));
      check('落ちた後のぴったりも bonus 1 から', after.outcome.perfect === true && after.outcome.bonus === 1 && after.state.streak === 1, after.outcome);

      const h = L.hud(after.state);
      check('hud は state の値そのまま（score・streak・crossed・lives）', h && h.score === after.state.score && h.streak === after.state.streak && h.crossed === after.state.crossed && h.lives === after.state.lives
        && Object.keys(h).sort().join() === 'crossed,lives,score,streak', h);
      const h0 = L.hud(L.createRun({ random: () => 0 }));
      check('始めの hud は score 0・streak 0・crossed 0・lives 3（UI で ±1 しない値）', h0.score === 0 && h0.streak === 0 && h0.crossed === 0 && h0.lives === L.LIVES, h0);
    },
  },
  {
    id: 'HL4', tier: 'smoke', node: true, title: 'ハシわたり：いのち（落ちると1減る・同じ間でやり直し・0で over・over の後は ignore）',
    run({ check, root }) {
      const { L } = load(root);
      const s0 = rigged(L, { score: 4, crossed: 4, streak: 2, bestStreak: 2 });
      check('始めの lives は LIVES（3）', L.createRun({ random: () => 0.3 }).lives === 3 && s0.lives === 3);
      const a = L.resolve(s0, 50);
      check('1回目の落下：lives 3→2、over でない、outcome.lives・over も同じ', a.outcome.kind === 'fall' && a.state.lives === 2 && a.outcome.lives === 2 && a.state.over === false && a.outcome.over === false, a.outcome);
      check('落ちても platforms は同じ並び（同じ間にもう一度）', JSON.stringify(a.state.platforms) === JSON.stringify(PL), a.state.platforms);
      check('落ちても score・crossed は変わらない', a.state.score === 4 && a.state.crossed === 4, { score: a.state.score, crossed: a.state.crossed });
      const retry = L.resolve(a.state, 250);
      check('同じ葉からやり直して渡れる（cross、lives は 2 のまま）', retry.outcome.kind === 'cross' && retry.state.lives === 2 && retry.state.score === 4 + 2, retry.outcome);
      const b = L.resolve(a.state, 700);
      check('2回目の落下（ながすぎ）：lives 1、over でない', b.outcome.kind === 'fall' && b.outcome.reason === 'long' && b.state.lives === 1 && b.state.over === false, b.outcome);
      const c = L.resolve(b.state, 10);
      check('3回目の落下：lives 0、over、outcome.over も true', c.outcome.kind === 'fall' && c.state.lives === 0 && c.state.over === true && c.outcome.over === true && c.outcome.lives === 0, c.outcome);
      const snap = JSON.stringify(c.state);
      const d = L.resolve(c.state, 250), e = L.resolve(c.state, 10);
      check('over の後は渡れる長さでも ignore（点も増えない）', d.outcome && d.outcome.kind === 'ignore' && d.state && d.state.score === c.state.score && d.state.lives === 0 && d.state.over === true, d.outcome);
      check('over の後は落ちる長さでも ignore（lives が負にならない）', e.outcome && e.outcome.kind === 'ignore' && e.state.lives === 0, e.outcome);
      check('ignore で元の state は変わらない', JSON.stringify(c.state) === snap);
      check('落ちた後の hud.lives も state と同じ', L.hud(b.state).lives === 1 && L.hud(c.state).lives === 0);
    },
  },
  {
    id: 'HL5', tier: 'smoke', node: true, title: 'ハシわたり：イミュータブル（resolve の前後で元の state と platforms が変わらない）と createRun',
    run({ check, root }) {
      const { L, C } = load(root);
      const base = rigged(L, { score: 3, crossed: 3, streak: 1, bestStreak: 1 });
      const snap = JSON.stringify(base);
      const plats = base.platforms, p0 = plats[0], p1 = plats[1];
      let cross, fall, err = null;
      try { cross = L.resolve(base, 250); fall = L.resolve(base, 10); } catch (e) { err = String(e); }
      check('resolve で例外が出ない', !err, err);
      check('resolve（cross・fall）の後も、元の state・platforms・各葉が同じ', JSON.stringify(base) === snap && base.platforms === plats && plats[0] === p0 && plats[1] === p1 && plats.length === 3);
      check('cross・fall とも新しい state と新しい platforms 配列を返す', cross.state !== base && fall.state !== base && cross.state.platforms !== plats && fall.state.platforms !== plats);
      // 凍らせた state でも動く（中で書き換えていない）
      const frozen = deepFreeze(rigged(L, { score: 3 }));
      let fErr = null, fc, ff;
      try { fc = L.resolve(frozen, 250); ff = L.resolve(frozen, 10); } catch (e) { fErr = String(e); }
      check('凍らせた（Object.freeze した）state を渡しても例外なく判定できる', !fErr && fc.outcome.kind === 'cross' && ff.outcome.kind === 'fall', fErr);
      // cross で並びが1つ左へずれ、末尾に1つ足される
      const np = cross.state.platforms;
      check('cross で platforms が1つ左へずれ、長さは 3 のまま', np.length === 3 && np[0].x === PL[1].x && np[0].w === PL[1].w && np[1].x === PL[2].x && np[1].w === PL[2].w, np);
      const g = np[2].x - right(np[1]);
      const okTier = C.TIERS.some((t) => g >= t.gap[0] && g <= t.gap[1] && np[2].w >= t.w[0] && np[2].w <= t.w[1]);
      check('末尾に足された葉は makeNext の範囲（どれかの段階の gap と w）', Number.isInteger(g) && Number.isInteger(np[2].w) && okTier, { gap: g, w: np[2].w });

      // createRun
      const r = L.createRun({ random: () => 0 });
      const keys = ['platforms', 'score', 'crossed', 'perfects', 'streak', 'bestStreak', 'lives', 'over', 'lastOutcome'];
      check('createRun の state に契約の項目がある', keys.every((k) => k in r), Object.keys(r));
      check('createRun の初期値（score 0・crossed 0・perfects 0・streak 0・bestStreak 0・lives 3・over false・lastOutcome null）',
        r.score === 0 && r.crossed === 0 && r.perfects === 0 && r.streak === 0 && r.bestStreak === 0 && r.lives === 3 && r.over === false && r.lastOutcome === null, r);
      check('葉は3枚、最初の葉は x=0、左から右へ重ならずに並ぶ', Array.isArray(r.platforms) && r.platforms.length === 3 && r.platforms[0].x === 0 && r.platforms[0].w > 0
        && r.platforms[1].x > right(r.platforms[0]) && r.platforms[2].x > right(r.platforms[1]), r.platforms);
      const g0 = r.platforms[1].x - right(r.platforms[0]);
      check('random=0 で注入した乱数が使われる（2枚目は gap 80・w 110、段階0の下限）', g0 === 80 && r.platforms[1].w === 110, { gap: g0, w: r.platforms[1].w });
      const r9 = L.createRun({ random: () => 0.999999 });
      const g9 = r9.platforms[1].x - right(r9.platforms[0]);
      check('random=0.999999 では2枚目は gap 220・w 160（段階0の上限）', g9 === 220 && r9.platforms[1].w === 160, { gap: g9, w: r9.platforms[1].w });
      const A = L.createRun({ random: seeded(42) }), B = L.createRun({ random: seeded(42) });
      check('同じ乱数の列なら同じ並び（再現できる）', JSON.stringify(A.platforms) === JSON.stringify(B.platforms), { A: A.platforms, B: B.platforms });
      let dErr = null, def;
      try { def = L.createRun({}); } catch (e) { dErr = String(e); }
      check('random を省いても（既定の Math.random で）作れる', !dErr && def.platforms.length === 3 && def.platforms[0].x === 0, dErr);
      const r2 = L.createRun({ random: () => 0 });
      check('createRun は毎回新しい platforms 配列を返す', r2.platforms !== r.platforms && r2 !== r);
    },
  },
  {
    id: 'HL6', tier: 'smoke', node: true, title: 'ハシわたり：コース（段階表・tierFor・makeNext の公平さ、random 0/0.5/0.999999 と1000回の乱数）',
    run({ check, root }) {
      const { L, C } = load(root);
      const LIM = L.VIEW_W - L.CAMERA_LEFT - 40;   // 760
      const WANT = [{ from: 0, gap: [80, 220], w: [110, 160] }, { from: 5, gap: [120, 320], w: [80, 130] }, { from: 15, gap: [160, 420], w: [60, 110] }, { from: 30, gap: [200, 520], w: [45, 90] }];
      check('TIERS が契約書 §5 のとおり（4段階）', JSON.stringify(C.TIERS) === JSON.stringify(WANT), C.TIERS);
      const tBad = C.TIERS.filter((t) => !(t.gap[1] + t.w[1] <= LIM && t.gap[1] + t.w[1] <= L.MAX_LEN && t.w[0] >= 2 * L.PERFECT_HALF + 20 && t.gap[0] > 0));
      check(`段階表そのものが公平（gap+w ≦ ${LIM}、≦ MAX_LEN、w ≧ ${2 * L.PERFECT_HALF + 20}）`, tBad.length === 0, tBad);
      const TF = [[0, 0], [4, 0], [5, 1], [14, 1], [15, 2], [29, 2], [30, 3], [31, 3], [1000, 3]];
      const tfBad = TF.filter(([n, i]) => C.tierFor(n) !== C.TIERS[i] && JSON.stringify(C.tierFor(n)) !== JSON.stringify(C.TIERS[i])).map(([n, i]) => ({ crossed: n, want: i, got: C.tierFor(n) }));
      check('tierFor：0〜4→段階0、5〜14→1、15〜29→2、30 以上→3（頭打ち）', tfBad.length === 0, tfBad);

      const bad = [];
      const one = (tier, crossed, rnd, label) => {
        const prev = Object.freeze({ x: 123, w: 77 });
        let n;
        try { n = C.makeNext(prev, crossed, rnd); } catch (e) { bad.push({ label, err: String(e) }); return; }
        const gap = n.x - right(prev);
        const ok = Number.isInteger(gap) && Number.isInteger(n.w) && gap >= tier.gap[0] && gap <= tier.gap[1] && n.w >= tier.w[0] && n.w <= tier.w[1]
          && gap + n.w <= LIM && gap + n.w <= L.MAX_LEN && n.w >= 2 * L.PERFECT_HALF + 20;
        if (!ok) bad.push({ label, crossed, gap, w: n.w });
      };
      for (const t of C.TIERS) for (const crossed of [t.from, t.from + 1]) for (const v of [0, 0.5, 0.999999]) one(t, crossed, () => v, `random=${v}`);
      check('全段階で random 0・0.5・0.999999 でも、範囲内の整数・公平さを守る', bad.length === 0, bad);
      const ends = C.TIERS.map((t) => {
        const lo = C.makeNext({ x: 0, w: 100 }, t.from, () => 0), hi = C.makeNext({ x: 0, w: 100 }, t.from, () => 0.999999);
        return { lo: [lo.x - 100, lo.w], hi: [hi.x - 100, hi.w], want: [[t.gap[0], t.w[0]], [t.gap[1], t.w[1]]] };
      });
      check('random 0 で下限、0.999999 で上限（閉区間の両端が出る）', ends.every((e) => JSON.stringify([e.lo, e.hi]) === JSON.stringify(e.want)), ends);
      const before = bad.length;
      const rnd = seeded(2026);
      for (const t of C.TIERS) for (let i = 0; i < 1000; i++) one(t, t.from + (i % 5), rnd, 'seeded');
      check('全段階で 1000 回ずつの乱数でも、範囲内の整数・公平さを破らない', bad.length === before, bad.slice(before, before + 5));

      // 回を通して：createRun → ぴったりで 40 回渡っても、どの葉にも届き、次の葉の右端が画面に入る
      let s = L.createRun({ random: seeded(9) });
      const runBad = [];
      for (let i = 0; i < 40; i++) {
        const [c0, c1] = s.platforms;
        const need = right(c1) - right(c0);
        if (!(need <= L.MAX_LEN && need <= LIM && c1.w >= 2 * L.PERFECT_HALF + 20)) runBad.push({ i, c0, c1 });
        const o = L.resolve(s, center(c1) - right(c0));
        if (o.outcome.kind !== 'cross') { runBad.push({ i, outcome: o.outcome }); break; }
        s = o.state;
      }
      check('40 回渡る間、どの葉も届く距離で、画面を送ると右端が入る（crossed 40）', runBad.length === 0 && s.crossed === 40, runBad.slice(0, 3));
    },
  },
  {
    id: 'HL7', tier: 'smoke', node: true, title: 'ハシわたり：保存データの検証（validateBest・recordBest・validateFlag）',
    run({ check, root }) {
      const { L } = load(root);
      const broken = [null, undefined, '', 'abc', '-1', '1.5', 'NaN', 'Infinity', '{}', '1e400', '9007199254740992', -1, 1.5, NaN, Infinity, -Infinity, {}, '[]', () => 5];
      const bBad = broken.filter((v) => L.validateBest(v) !== 0).map((v) => ({ v: typeof v === 'function' ? 'fn' : v, got: L.validateBest(v) }));
      check('壊れた値（null・""・"abc"・"-1"・"1.5"・"NaN"・"Infinity"・"{}"・"1e400"・"9007199254740992"・-1 ほか）は 0', bBad.length === 0, bBad);
      const good = [['0', 0], [0, 0], ['5', 5], [5, 5], ['120', 120], ['9007199254740991', 9007199254740991], [9007199254740991, 9007199254740991]];
      const gBad = good.filter(([v, e]) => L.validateBest(v) !== e).map(([v, e]) => ({ v, want: e, got: L.validateBest(v) }));
      check('正しい値（0・"5"・5・16 桁の最大）はそのまま数で返す', gBad.length === 0, gBad);

      const R = [
        [5, 5, 5, false], [5, 6, 6, true], [5, 3, 5, false], ['5', 5, 5, false], ['5', 7, 7, true],
        ['abc', 0, 0, false], [null, 1, 1, true], [null, 0, 0, false], ['-3', 2, 2, true], [0, 0, 0, false],
      ];
      const rBad = R.filter(([p, sc, b, imp]) => { const r = L.recordBest(p, sc); return !(r && r.best === b && r.improved === imp); })
        .map(([p, sc, b, imp]) => ({ prev: p, score: sc, want: { best: b, improved: imp }, got: L.recordBest(p, sc) }));
      check('recordBest：同点は improved=false、上回ったときだけ true、壊れた前回値は 0 扱い', rBad.length === 0, rBad);

      const F = [['1', true], ['0', false], [1, false], [true, false], [null, false], [undefined, false], ['', false], ['true', false], [' 1', false], ['11', false], [{}, false]];
      const fBad = F.filter(([v, e]) => L.validateFlag(v) !== e).map(([v, e]) => ({ v, want: e, got: L.validateFlag(v) }));
      check("validateFlag：'1' のときだけ true、それ以外（'0'・数の 1・true・null・'' など）は false", fBad.length === 0, fBad);
    },
  },
  {
    id: 'HL8', tier: 'smoke', node: true, title: 'ハシわたり：読み込み順の誤り（HashiCourse が無い）で、意味の分かる例外',
    run({ check, root }) {
      load(root);
      const dir = path.join(root, 'games/hashi/');
      const req = createRequire(dir);
      const file = req.resolve(path.join(dir, 'logic.js'));
      const saved = globalThis.HashiCourse, cached = req.cache[file];
      let msg = null, worked = false;
      try {
        delete globalThis.HashiCourse;
        delete req.cache[file];
        const L2 = req(file);
        try { const s = L2.createRun({ random: () => 0 }); worked = !!(s && s.platforms && s.platforms.length === 3); } catch (e) { msg = String(e && e.message || e); }
      } finally {
        globalThis.HashiCourse = saved;
        if (cached) req.cache[file] = cached; else delete req.cache[file];
      }
      // logic.js が Node で course.js を自分で require するなら作れてよい。作れないなら、何が足りないか分かる例外にする
      check('HashiCourse が無いとき：自分で読み込んで作れる、または「HashiCourse／course」を含む例外', worked || (msg !== null && /HashiCourse|course/i.test(msg)), { worked, msg });
    },
  },
  {
    id: 'HL9', tier: 'smoke', node: true, title: 'ハシわたり：ひとつ飛ばし（2つ先の葉の端ちょうどで渡れる・2つ分＋おまけ・ぴったりと重なる・行き過ぎ／間に落ちる・届く所は画面の中）',
    run({ check, root }) {
      const { L, C } = load(root);
      check('SKIP_BONUS は 1', L.SKIP_BONUS === 1, L.SKIP_BONUS);
      const s = rigged(L, { score: 10, crossed: 4 });   // 今の葉の右端 100、次 300〜400、2つ先 500〜600（中心 550）
      const r = (len, st = s) => L.resolve(st, len);
      const e1 = r(400), e2 = r(500);
      const okSkip = (x, tip) => x.outcome.kind === 'cross' && x.outcome.skip === true && x.outcome.tipX === tip && x.outcome.landX === 600 && x.outcome.perfect === false
        && x.outcome.gain === 3 && x.outcome.skipBonus === 1 && x.outcome.bonus === 0 && x.state.score === 13 && x.state.crossed === 6 && x.state.streak === 0;
      check('2つ先の左端ちょうど（tipX=500）でひとつ飛ばし：+3（2つ分＋おまけ1）・crossed +2・landX 600', okSkip(e1, 500), e1.outcome);
      check('2つ先の右端ちょうど（tipX=600）でもひとつ飛ばし', okSkip(e2, 600), e2.outcome);
      const np = e1.state.platforms;
      const g1 = np[1].x - right(np[0]), g2 = np[2].x - right(np[1]);
      const inTier = (g, w) => C.TIERS.some((t) => g >= t.gap[0] && g <= t.gap[1] && w >= t.w[0] && w <= t.w[1]);
      check('飛ばした後の並び：先頭が 2つ先だった葉、その先に新しい葉が2枚（段階表の範囲）', np.length === 3 && np[0].x === 500 && np[0].w === 100 && inTier(g1, np[1].w) && inTier(g2, np[2].w), np);
      const nor = r(250);
      check('次の葉に乗るときは今までどおり（skip false・+1＋ぴったり）', nor.outcome.kind === 'cross' && nor.outcome.skip === false && nor.outcome.skipBonus === 0 && nor.outcome.landX === 400 && nor.state.crossed === 5, nor.outcome);
      const gapFall = r(399), over = r(501), over2 = r(1e9);
      check('次の葉と2つ先の間（tipX=499）は落ちる（long）', gapFall.outcome.kind === 'fall' && gapFall.outcome.reason === 'long' && gapFall.state.lives === 2, gapFall.outcome);
      check('2つ先の行き過ぎ（tipX=601、MAX_LEN）も落ちる（long）', over.outcome.kind === 'fall' && over.outcome.reason === 'long' && over2.outcome.kind === 'fall', { over: over.outcome, over2: over2.outcome });
      const p1 = r(450), p2 = r(460), p3 = r(461);
      check('2つ先の中心 ±PERFECT_HALF でぴったり：+2 +1 +ボーナス1 = 4・streak 1', p1.outcome.skip && p1.outcome.perfect && p1.outcome.gain === 4 && p1.outcome.bonus === 1 && p1.state.streak === 1 && p1.state.perfects === 1
        && p2.outcome.perfect === true && p3.outcome.perfect === false && p3.outcome.skip === true, { p1: p1.outcome, p3: p3.outcome });
      const sk = rigged(L, { streak: 2, bestStreak: 2, score: 0 });
      const p4 = r(450, sk);
      check('ぴったりの連続中のひとつ飛ばし：ボーナスも続く（streak 3 → +2 +1 +4 = 7）', p4.outcome.gain === 7 && p4.state.streak === 3 && p4.state.bestStreak === 3 && p4.state.score === 7, p4.outcome);
      const p5 = r(420, sk);
      check('ぴったりでないひとつ飛ばしは streak が切れる（+3、streak 0）', p5.outcome.gain === 3 && p5.state.streak === 0 && p5.state.bestStreak === 2, p5.outcome);
      // 公平さ：2つ先の葉は、いつも次の葉の右端より段階表の gap の下限以上先にある。届く所は画面の中
      const LIM = L.VIEW_W - L.CAMERA_LEFT;   // 今の葉の右端から右へ見える幅（少なくとも）
      const bad = [];
      const minGap = Math.min(...C.TIERS.map((t) => t.gap[0]));
      let reach = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        let st = L.createRun({ random: seeded(seed) });
        for (let i = 0; i < 60; i++) {
          const [c0, c1, c2] = st.platforms;
          const need2 = c2.x - right(c0), need1 = right(c1) - right(c0);
          if (!(need2 >= need1 + minGap)) bad.push({ seed, i, why: '2つ先が近すぎる', c0, c1, c2 });
          if (need2 <= L.MAX_LEN) {
            reach++;
            if (!(need2 <= LIM && Math.min(right(c2) - right(c0), L.MAX_LEN) <= LIM)) bad.push({ seed, i, why: '届くのに画面の外', c0, c2 });
          }
          const o = L.resolve(st, center(c1) - right(c0));
          st = o.state;
        }
      }
      check(`2つ先は次の葉より ${minGap} 以上遠く、茎が届く所はいつも画面（右へ ${LIM}）の中（300 回中 届く ${reach} 回）`, bad.length === 0 && reach > 0, bad.slice(0, 3));
      const e3 = L.resolve(rigged(L, { platforms: [PL[0], PL[1]] }), 400);
      check('2つ先が無い並び（platforms 2 枚）でも例外にならず、行き過ぎは落ちる', e3.outcome.kind === 'fall' && e3.outcome.reason === 'long', e3.outcome);
    },
  },
];
