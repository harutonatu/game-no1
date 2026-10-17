/*
 * ゼンマイさんぽ — ロジック（DOM に触れない純粋な計算だけ）
 *
 * 巻いた量 → エネルギー = turns × STEP。人形は右へ歩き、区間の進みやすさ倍率 m で
 * 「進んだ距離 ÷ m」ずつエネルギーを使う（m>1 なら同じエネルギーで遠くへ行く）。
 *   flat: m = 1（k は無視）   up / down: m = k   wind: m = 1 + k（k>0 追い風、k<0 向かい風）
 *   区間が無い場所は flat。m は最小 0.05 に丸める。
 * cliffX を越えたら落下（ちょうど cliffX で止まるのは「止まった」扱い）。
 * turns > maxTurns はバネが切れて失敗（歩かない）。
 *
 * UMD: ブラウザでは window.ZenmaiLogic、Node では module.exports と globalThis.ZenmaiLogic。
 */
(function (root) {
  "use strict";

  const STEP = 60;            // 1回転あたりの基本の歩幅（論理単位）
  const SPEED = 220;          // 歩き始めの速さ（論理単位/秒、倍率 m がかかる）
  const SLOW = 0.4;           // ほどけきる直前の速さの割合（だんだんゆっくりになる）
  const DT = 1 / 30;          // path の間隔（秒）
  const EPS = 1e-9;
  const STAR3 = 0.25;         // 帯の半幅に対する ★3 の範囲（中心から ±25%）
  const STAR2 = 0.6;          // ★2 の範囲（±60%）。帯の中なら ★1
  const TAU = Math.PI * 2;
  const INITIAL = () => ({ stars: {}, unlocked: 1 });

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  // -π〜π（-π は含まず π は含む）に正規化した角度の差。画面座標（y 下向き）の atan2 なら時計回りが正
  function angleDelta(prevRad, curRad) {
    let d = num(curRad, 0) - num(prevRad, 0);
    d = d % TAU;                       // (-2π, 2π)
    if (d > Math.PI) d -= TAU;
    else if (d <= -Math.PI) d += TAU;
    return d;
  }

  function turnsFromRadians(totalRad) { return num(totalRad, 0) / TAU; }

  // 区間の進みやすさ倍率
  function segMult(s) {
    if (!s) return 1;
    const k = num(s.k, 1);
    let m;
    if (s.type === "wind") m = 1 + num(s.k, 0);
    else if (s.type === "up" || s.type === "down") m = k;
    else m = 1;
    return Math.max(0.05, m);
  }

  // x の位置（右へ進むとき）の倍率。x0 <= x < x1 の区間（後に書かれたものが優先）
  function multAt(stage, x) {
    const segs = Array.isArray(stage.segments) ? stage.segments : [];
    let m = 1;
    for (const s of segs) if (s && x >= num(s.x0, 0) - EPS && x < num(s.x1, 0) - EPS) m = segMult(s);
    return m;
  }

  // x より右の、いちばん近い区切り（区間の端・崖・舞台の端）
  function nextBoundary(stage, x) {
    let b = Math.min(num(stage.cliffX, Infinity), num(stage.length, 1000));
    const segs = Array.isArray(stage.segments) ? stage.segments : [];
    for (const s of segs) {
      if (!s) continue;
      for (const v of [num(s.x0, NaN), num(s.x1, NaN)]) if (v > x + EPS && v < b) b = v;
    }
    return b;
  }

  function edgeX(stage) { return Math.min(num(stage.cliffX, Infinity), num(stage.length, 1000)); }

  function starsFor(stage, x) {
    if (!stage || !stage.target) return 0;
    x = num(x, NaN);
    if (!isFinite(x)) return 0;
    if (x > num(stage.cliffX, Infinity)) return 0;
    const w = Math.max(0, num(stage.target.w, 0));
    const half = w / 2;
    const c = num(stage.target.x, 0) + half;
    const d = Math.abs(x - c);
    const e = 1e-7;
    if (d <= half * STAR3 + e) return 3;
    if (d <= half * STAR2 + e) return 2;
    if (d <= half + e) return 1;
    return 0;
  }

  function simulate(stage, turns) {
    const startX = num(stage.startX, 0);
    const maxTurns = num(stage.maxTurns, Infinity);
    turns = turns === Infinity ? Infinity : num(turns, 0);   // NaN などは 0 扱い
    if (turns > maxTurns + 1e-9) {
      return { result: "break", x: startX, path: [{ t: 0, x: startX }], stars: 0, turns: turns };
    }
    if (turns < 0) turns = 0;
    const E0 = turns * STEP;
    let E = E0, x = startX, t = 0;
    const path = [{ t: 0, x: x }];
    const edge = edgeX(stage);
    let fell = false, guard = 0;
    while (E > EPS && guard++ < 200000) {
      if (x >= edge - EPS) { fell = true; break; }   // 崖の上でまだ力が残っている → 落ちる
      const m = multAt(stage, x);
      const speed = SPEED * m * (SLOW + (1 - SLOW) * (E0 > 0 ? E / E0 : 0));
      let dx = Math.min(speed * DT, nextBoundary(stage, x) - x, E * m);
      if (dx <= 0) dx = Math.min(E * m, edge - x);
      x += dx;
      E -= dx / m;
      t += dx / speed;
      path.push({ t: t, x: x });
    }
    if (E <= EPS) E = 0;
    if (!fell && x > num(stage.cliffX, Infinity) + EPS) fell = true;
    if (fell) return { result: "fall", x: x, path: path, stars: 0, turns: turns };
    return { result: "stop", x: x, path: path, stars: starsFor(stage, x), turns: turns };
  }

  // startX から x までに要る巻き数（x が崖より先なら Infinity）
  function turnsToReach(stage, x) {
    let p = num(stage.startX, 0), E = 0;
    const edge = edgeX(stage);
    if (x > edge + EPS) return Infinity;
    if (x <= p) return 0;
    let guard = 0;
    while (p < x - EPS && guard++ < 10000) {
      const b = Math.min(nextBoundary(stage, p), x);
      E += (b - p) / multAt(stage, p);
      p = b;
    }
    return E / STEP;
  }

  // ★3 になる巻き数の範囲 { min, max }。取れないときは null
  function bestTurns(stage) {
    if (!stage || !stage.target) return null;
    const half = num(stage.target.w, 0) / 2;
    const c = num(stage.target.x, 0) + half;
    const lo = Math.max(c - half * STAR3, num(stage.startX, 0));
    const hi = Math.min(c + half * STAR3, num(stage.cliffX, Infinity), num(stage.length, 1000));
    if (hi < lo) return null;
    const min = turnsToReach(stage, lo);
    const max = Math.min(turnsToReach(stage, hi), num(stage.maxTurns, Infinity));
    if (!(max >= min)) return null;
    return { min: min, max: max };
  }

  function stageCount() {
    const S = root.ZenmaiStages;
    return Array.isArray(S) && S.length > 0 ? S.length : 15;
  }

  // 保存データの検証。文字列（localStorage の生の値）も受け付ける
  function validateProgress(v) {
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return INITIAL(); } }
    if (!v || typeof v !== "object" || Array.isArray(v)) return INITIAL();
    const n = stageCount();
    const S = Array.isArray(root.ZenmaiStages) ? root.ZenmaiStages : null;
    const ids = S ? S.map(s => s && s.id) : null;
    const stars = {};
    let unlocked = 1;
    if (v.stars && typeof v.stars === "object" && !Array.isArray(v.stars)) {
      for (const id of Object.keys(v.stars)) {
        const s = v.stars[id];
        if (!/^z\d{2}$/.test(id)) continue;
        if (!(Number.isInteger(s) && s >= 0 && s <= 3)) continue;
        const idx = ids ? ids.indexOf(id) : parseInt(id.slice(1), 10) - 1;
        if (idx < 0 || idx >= n) continue;
        stars[id] = s;
        if (s > 0) unlocked = Math.max(unlocked, Math.min(n, idx + 2)); // クリア済みの次は開いている
      }
    }
    const u = v.unlocked;
    if (Number.isInteger(u) && u >= 1) unlocked = Math.max(unlocked, Math.min(n, u));
    return { stars: stars, unlocked: unlocked };
  }

  // 結果を記録した新しい progress（★は最高を残す、クリアで次を解放）。元の値は変えない
  function recordResult(progress, stageId, stars) {
    const p = validateProgress(progress);
    const S = Array.isArray(root.ZenmaiStages) ? root.ZenmaiStages : null;
    const n = stageCount();
    const idx = S ? S.findIndex(s => s && s.id === stageId) : parseInt(String(stageId).slice(1), 10) - 1;
    if (!(idx >= 0 && idx < n) || !Number.isInteger(stars) || stars < 0 || stars > 3) return p;
    p.stars[stageId] = Math.max(p.stars[stageId] || 0, stars);
    if (stars > 0) p.unlocked = Math.max(p.unlocked, Math.min(n, idx + 2));
    return p;
  }

  // path から時刻 t の位置（線形補間）。描画用
  function positionAt(path, t) {
    if (!Array.isArray(path) || path.length === 0) return 0;
    if (t <= path[0].t) return path[0].x;
    const last = path[path.length - 1];
    if (t >= last.t) return last.x;
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid].t <= t) lo = mid; else hi = mid; }
    const a = path[lo], b = path[hi];
    return b.t > a.t ? a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t) : b.x;
  }

  const api = {
    STEP, SPEED, STAR3, STAR2,
    angleDelta, turnsFromRadians, simulate, starsFor, bestTurns, validateProgress,
    turnsToReach, recordResult, positionAt, multAt
  };
  root.ZenmaiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
