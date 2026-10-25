/*
 * ミチビキ空港 — ロジック（DOM・時計・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/michibiki-contract.md §1（ルール）・§3（定数・難しさ）・§4（API・出来事）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.MichibikiLogic、Node では module.exports と globalThis.MichibikiLogic。
 *
 * 中の作り：
 *   - 1コマ＝STEP（1/60 秒）。時間はコマ数（tick）で数える。秒の定数はコマ数に直して使う（*_T）。
 *   - 乱数は mulberry32。state.rng に 32bit の状態（0〜4294967295）を持ち、update が新しい値を返す。
 *   - 角度の関数は使わない。向きは単位ベクトル（dx, dy）、正規化は Math.sqrt だけ。
 *   - 公開する state はイミュータブル（凍結した新しいオブジェクト）。道の点の列は凍結して前の state と共有する。
 *     手で組んだ state（テスト用）も受け付ける。足りない欄は既定の値で補う。
 *   - 契約の state の形に、次の欄を足している（画面は使わなくてよい）：
 *       pendingColor … 開いた直後の色（次の予告をその色にする。無ければ null）
 *       nearPairs    … 近すぎる組 [[a, b], ...]（a < b。near の出来事を「新しい組のときだけ」出すため）
 *   - 例外は外へ出さない。
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- 定数（契約 §3.1）

  const NAME = "ミチビキ空港";
  const STEP = 1 / 60;
  const FPS = 60;
  const LAYOUTS = Object.freeze({
    tall: Object.freeze({ w: 320, h: 520 }),
    wide: Object.freeze({ w: 520, h: 320 })
  });
  const LIVES = 3;
  const CRASH_LIFE = 1;
  const PLANE_R = 12;
  const PICK_R = 34;
  const CRASH_D = 20;
  const NEAR_D = 56;
  const ZONE_R = 22;
  const LAND_DOT = 0.7;
  const APPROACH_D = 48;
  const APPROACH_ROOM = 80;
  const RUNWAY_LEN = 96;
  const RUNWAY_W = 22;
  const SPEED = Object.freeze({ slow: 24, normal: 32, fast: 46 });
  const WARN_S = 2.0;
  const FIRST_SPAWN_S = 2.0;
  const LAND_S = 1.2;
  const CRASH_BREATH = 2.0;
  const SAFE_SPAWN_D = 80;
  const SAFE_WAIT_S = 0.5;
  const MAX_PLANES = 10;
  const PATH_STEP = 6;
  const MAX_PATH = 400;
  const COLOR_STEPS = Object.freeze([0, 4, 12]);   // 契約 §19 C2（[0, 6, 18] から早めた）
  const SAVE_KEY_BEST = "michibiki.best";
  const SAVE_KEY_HELP = "michibiki.help";

  // 難しさの式（契約 §3.4・§19 C1）。秒は 1/100 秒の整数で計算して小数の誤差を出さない
  //   max(2.0, 6.5 − 0.14×min(n,10) − 0.22×max(0, n−10))
  const INTERVAL_START = 650;   // 6.5 秒
  const INTERVAL_DROP = 14;     // 着陸 10 機までは 1 機ごとに 0.14 秒
  const INTERVAL_KNEE = 10;     // ここから縮み方を速める
  const INTERVAL_DROP2 = 22;    // 着陸 10 機を超えたら 1 機ごとに 0.22 秒
  const INTERVAL_MIN = 200;     // 2.0 秒
  const INTERVAL_JITTER = 0.15; // ×0.85〜1.15
  const ALIVE_START = 3;
  const ALIVE_EVERY = 4;
  const SLOW_FROM = 10, SLOW_RATE = 0.20;
  const FAST_FROM = 24, FAST_RATE = 0.15;

  const KINDS = Object.freeze(["slow", "normal", "fast"]);
  const EDGES = Object.freeze(["left", "right", "top", "bottom"]);
  const LAZY_S = 1.5;           // autoplay 'lazy' が待つ秒

  // コマ数
  const WARN_T = Math.round(WARN_S * FPS);
  const FIRST_SPAWN_T = Math.round(FIRST_SPAWN_S * FPS);
  const LAND_T = Math.round(LAND_S * FPS);
  const BREATH_T = Math.round(CRASH_BREATH * FPS);
  const SAFE_WAIT_T = Math.round(SAFE_WAIT_S * FPS);
  const LAZY_T = Math.round(LAZY_S * FPS);
  const MAX_ADVANCE = 36000;

  // 色（契約 §3.2）。Okabe-Ito 系。mark は記号の種類（ほかのゲームと同じ名前）、symbol は文字
  const COLORS = Object.freeze([
    { id: 0, key: "red",    name: "あか",   hex: "#D55E00", mark: "circle",   symbol: "○", opensAt: 0 },
    { id: 1, key: "blue",   name: "あお",   hex: "#0072B2", mark: "triangle", symbol: "△", opensAt: 4 },
    { id: 2, key: "yellow", name: "きいろ", hex: "#F0E442", mark: "square",   symbol: "□", opensAt: 12 }
  ].map((c) => Object.freeze(c)));

  // 滑走路（契約 §3.3）。入り口 (ex, ey) と向き (dx, dy)（入り口 → 奥）
  const RUNWAYS = Object.freeze({
    tall: Object.freeze([
      Object.freeze({ color: 0, ex: 100, ey: 170, dx: 1, dy: 0 }),
      Object.freeze({ color: 1, ex: 220, ey: 330, dx: -1, dy: 0 }),
      Object.freeze({ color: 2, ex: 70, ey: 300, dx: 0, dy: 1 })
    ]),
    wide: Object.freeze([
      Object.freeze({ color: 0, ex: 130, ey: 100, dx: 1, dy: 0 }),
      Object.freeze({ color: 1, ex: 410, ey: 220, dx: -1, dy: 0 }),
      Object.freeze({ color: 2, ex: 260, ey: 210, dx: 0, dy: -1 })
    ])
  });

  // 滑走路の置き方（MC-15）：0＝RUNWAYS のまま、1＝左右を裏返す、2＝上下を裏返す。回ごとに main が選ぶ。
  // §3.3 の決まり 1〜4 は左右・上下に裏返しても同じ形なので満たしたまま。出る位置・向きの乱数も左右・上下で同じ形なので、難しさは変わらない（v37 の計画で autoplay 200 回ずつ測った）
  const PLAN_COUNT = 3;
  function flipRunways(list, w, h, fx, fy) {
    return Object.freeze(list.map((r) => Object.freeze({
      color: r.color, ex: fx ? w - r.ex : r.ex, ey: fy ? h - r.ey : r.ey, dx: fx ? -r.dx || 0 : r.dx, dy: fy ? -r.dy || 0 : r.dy
    })));
  }
  const RUNWAY_PLANS = Object.freeze({
    tall: Object.freeze([RUNWAYS.tall, flipRunways(RUNWAYS.tall, 320, 520, true, false), flipRunways(RUNWAYS.tall, 320, 520, false, true)]),
    wide: Object.freeze([RUNWAYS.wide, flipRunways(RUNWAYS.wide, 520, 320, true, false), flipRunways(RUNWAYS.wide, 520, 320, false, true)])
  });

  // ---------------------------------------------------------------- 小さな道具

  const isInt = (n) => Number.isSafeInteger(n);
  const isNum = (n) => typeof n === "number" && Number.isFinite(n);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function dist(ax, ay, bx, by) {
    const x = ax - bx, y = ay - by;
    return Math.sqrt(x * x + y * y);
  }
  // 単位ベクトル。長さ 0 なら null
  function unit(x, y) {
    const l = Math.sqrt(x * x + y * y);
    if (!(l > 0)) return null;
    return [x / l, y / l];
  }

  // mulberry32 の1歩。a は 32bit の状態。[次の状態(0〜4294967295), 0 以上 1 未満の値]
  function rngStep(a) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return [a >>> 0, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
  }
  // テストと autoplay 用の乱数（state の中の rng と同じ並び）
  function makeRng(seed) {
    let a = normSeed(seed);
    return function () {
      const r = rngStep(a);
      a = r[0];
      return r[1];
    };
  }
  // state の rng を読み書きする小さな箱
  function rngBox(a) {
    const box = {
      a: (isNum(a) ? Math.floor(a) : 0) >>> 0,
      next() { const r = rngStep(box.a); box.a = r[0]; return r[1]; }
    };
    return box;
  }

  function normSeed(seed) {
    if (!isNum(seed)) return 0;
    return Math.floor(seed) >>> 0;
  }
  function normLayout(layout) {
    return typeof layout === "string" && hasOwn(LAYOUTS, layout) ? layout : "tall";
  }
  function normPlan(plan) { return Number.isSafeInteger(plan) && plan >= 0 && plan < PLAN_COUNT ? plan : 0; }
  // landed を 0 以上の整数に（負・小数・文字・無い → 0、小数は切り捨て）
  function normLanded(landed) {
    if (!isNum(landed) || landed < 0) return 0;
    return Math.floor(landed);
  }
  function okColor(c) { return isInt(c) && c >= 0 && c < COLORS.length; }
  function okKind(k) { return typeof k === "string" && hasOwn(SPEED, k); }

  function freezePath(points) {
    for (let i = 0; i < points.length; i++) Object.freeze(points[i]);
    return Object.freeze(points);
  }

  // ---------------------------------------------------------------- 難しさ（契約 §3.4）

  function colorsFor(landed) {
    const n = normLanded(landed);
    let c = 0;
    for (let i = 0; i < COLOR_STEPS.length; i++) if (n >= COLOR_STEPS[i]) c = i + 1;
    return Math.max(1, c);
  }
  function spawnInterval(landed) {
    const n = Math.min(normLanded(landed), 1e6);
    const v = INTERVAL_START - INTERVAL_DROP * Math.min(n, INTERVAL_KNEE) - INTERVAL_DROP2 * Math.max(0, n - INTERVAL_KNEE);
    return Math.max(INTERVAL_MIN, v) / 100;
  }
  function maxAlive(landed) {
    const n = normLanded(landed);
    return Math.min(MAX_PLANES, ALIVE_START + Math.floor(Math.min(n, 1e6) / ALIVE_EVERY));
  }
  function kindFor(landed, r) {
    const n = normLanded(landed);
    const x = isNum(r) ? r : 1;
    if (n >= FAST_FROM && x < FAST_RATE) return "fast";
    if (n >= FAST_FROM && x < FAST_RATE + SLOW_RATE) return "slow";
    if (n >= SLOW_FROM && n < FAST_FROM && x < SLOW_RATE) return "slow";
    return "normal";
  }

  // ---------------------------------------------------------------- 滑走路

  function layoutOf(state) {
    return state && typeof state === "object" ? normLayout(state.layout) : "tall";
  }
  function planOf(state) { return state && typeof state === "object" ? normPlan(state.plan) : 0; }
  function runwayListOf(layout, plan) { return RUNWAY_PLANS[normLayout(layout)][normPlan(plan)]; }
  function openColors(state) {
    const c = state && isInt(state.colors) ? state.colors : 1;
    return clamp(c, 1, COLORS.length);
  }
  function runwaysFor(state) {
    try {
      const layout = layoutOf(state);
      const n = openColors(state);
      return Object.freeze(runwayListOf(layout, planOf(state)).map((r) => Object.freeze({
        color: r.color, ex: r.ex, ey: r.ey, dx: r.dx, dy: r.dy, open: r.color < n
      })));
    } catch (e) {
      return Object.freeze([]);
    }
  }
  function runwayOf(layout, color, plan) {
    const list = runwayListOf(layout, plan);
    for (let i = 0; i < list.length; i++) if (list[i].color === color) return list[i];
    return null;
  }

  // ---------------------------------------------------------------- state を読む（手で組んだものも受け付ける）

  function sizeOf(state) {
    const L = LAYOUTS[layoutOf(state)];
    return { w: L.w, h: L.h };
  }

  function readPlane(p) {
    if (!p || typeof p !== "object") return null;
    if (!isInt(p.id) || !isNum(p.x) || !isNum(p.y)) return null;
    const d = unit(isNum(p.dx) ? p.dx : 1, isNum(p.dy) ? p.dy : 0) || [1, 0];
    const kind = okKind(p.kind) ? p.kind : "normal";
    let path = null;
    if (Array.isArray(p.path) && p.path.length > 0) path = p.path;
    const pathI = path && isInt(p.pathI) && p.pathI >= 0 ? p.pathI : 0;
    return {
      id: p.id,
      color: okColor(p.color) ? p.color : 0,
      kind,
      x: p.x, y: p.y,
      // 単位ベクトルなら元の値をそのまま使う（境界の検査で値を変えないため）
      dx: isNum(p.dx) && isNum(p.dy) && Math.abs(p.dx * p.dx + p.dy * p.dy - 1) < 1e-9 ? p.dx : d[0],
      dy: isNum(p.dx) && isNum(p.dy) && Math.abs(p.dx * p.dx + p.dy * p.dy - 1) < 1e-9 ? p.dy : d[1],
      speed: isNum(p.speed) && p.speed >= 0 ? p.speed : SPEED[kind],
      path: path && pathI < path.length ? path : null,
      pathI: path && pathI < path.length ? pathI : 0,
      guided: p.guided === true,
      near: p.near === true,
      wrongIn: okColor(p.wrongIn) ? p.wrongIn : null,
      phase: p.phase === "land" ? "land" : "fly",
      landTick: isInt(p.landTick) ? p.landTick : 0
    };
  }

  function readWarn(w) {
    if (!w || typeof w !== "object") return null;
    if (!isInt(w.id) || !isNum(w.x) || !isNum(w.y) || !isInt(w.spawnTick)) return null;
    const d = unit(isNum(w.dx) ? w.dx : 1, isNum(w.dy) ? w.dy : 0) || [1, 0];
    return {
      id: w.id,
      color: okColor(w.color) ? w.color : 0,
      kind: okKind(w.kind) ? w.kind : "normal",
      x: w.x, y: w.y, dx: d[0], dy: d[1],
      spawnTick: w.spawnTick
    };
  }

  function readStats(s) {
    const o = s && typeof s === "object" ? s : {};
    const g = (k) => (isInt(o[k]) && o[k] >= 0 ? o[k] : 0);
    return {
      crashes: g("crashes"), guidedLandings: g("guidedLandings"), freeLandings: g("freeLandings"),
      bounces: g("bounces"), wrongWays: g("wrongWays")
    };
  }

  // 作業用の、凍結していない state の写し。形が変なら null
  function readState(state) {
    if (!state || typeof state !== "object") return null;
    if (!Array.isArray(state.planes) || !Array.isArray(state.warns)) return null;
    const layout = layoutOf(state);
    const L = LAYOUTS[layout];
    const planes = [];
    for (let i = 0; i < state.planes.length; i++) {
      const p = readPlane(state.planes[i]);
      if (p) planes.push(p);
    }
    const warns = [];
    for (let i = 0; i < state.warns.length; i++) {
      const w = readWarn(state.warns[i]);
      if (w) warns.push(w);
    }
    const nearPairs = [];
    if (Array.isArray(state.nearPairs)) {
      for (const pr of state.nearPairs) {
        if (Array.isArray(pr) && isInt(pr[0]) && isInt(pr[1])) nearPairs.push([pr[0], pr[1]]);
      }
    }
    const tick = isInt(state.tick) && state.tick >= 0 ? state.tick : 0;
    let maxId = -1;
    for (const p of planes) if (p.id > maxId) maxId = p.id;
    for (const w of warns) if (w.id > maxId) maxId = w.id;
    return {
      seed: normSeed(state.seed),
      rng: (isNum(state.rng) ? Math.floor(state.rng) : normSeed(state.seed)) >>> 0,
      layout, plan: planOf(state), w: L.w, h: L.h,
      tick,
      landed: normLanded(state.landed),
      lives: isInt(state.lives) ? clamp(state.lives, 0, LIVES) : LIVES,
      over: state.over === true,
      colors: openColors(state),
      nextId: isInt(state.nextId) && state.nextId > maxId ? state.nextId : maxId + 1,
      nextSpawnTick: isInt(state.nextSpawnTick) ? state.nextSpawnTick : tick,
      pendingColor: okColor(state.pendingColor) ? state.pendingColor : null,
      planes, warns, nearPairs,
      stats: readStats(state.stats)
    };
  }

  function freezeState(s) {
    const planes = s.planes.map((p) => Object.freeze({
      id: p.id, color: p.color, kind: p.kind,
      x: p.x, y: p.y, dx: p.dx, dy: p.dy, speed: p.speed,
      path: p.path ? (Object.isFrozen(p.path) ? p.path : freezePath(p.path.map((q) => [q[0], q[1]]))) : null,
      pathI: p.path ? p.pathI : 0,
      guided: p.guided, near: p.near, wrongIn: p.wrongIn,
      phase: p.phase, landTick: p.landTick
    }));
    const warns = s.warns.map((w) => Object.freeze({
      id: w.id, color: w.color, kind: w.kind, x: w.x, y: w.y, dx: w.dx, dy: w.dy, spawnTick: w.spawnTick
    }));
    return Object.freeze({
      seed: s.seed, rng: s.rng,
      layout: s.layout, plan: s.plan, w: s.w, h: s.h,
      tick: s.tick,
      landed: s.landed, lives: s.lives, over: s.over,
      colors: s.colors,
      nextId: s.nextId,
      nextSpawnTick: s.nextSpawnTick,
      pendingColor: s.pendingColor,
      planes: Object.freeze(planes),
      warns: Object.freeze(warns),
      nearPairs: Object.freeze(s.nearPairs.map((pr) => Object.freeze([pr[0], pr[1]]))),
      stats: Object.freeze(Object.assign({}, s.stats))
    });
  }

  // ---------------------------------------------------------------- 出現

  // 辺の上の位置（場の内側 PLANE_R の所）。at は 0〜1（辺に沿った割合）
  function edgePoint(edge, at, w, h) {
    switch (edge) {
      case "right": return [w - PLANE_R, clamp(h * at, PLANE_R, h - PLANE_R)];
      case "top": return [clamp(w * at, PLANE_R, w - PLANE_R), PLANE_R];
      case "bottom": return [clamp(w * at, PLANE_R, w - PLANE_R), h - PLANE_R];
      default: return [PLANE_R, clamp(h * at, PLANE_R, h - PLANE_R)];
    }
  }
  function edgeInward(edge) {
    switch (edge) {
      case "right": return [-1, 0];
      case "top": return [0, 1];
      case "bottom": return [0, -1];
      default: return [1, 0];
    }
  }
  // 4つの辺から、辺の長さに比例した確率で選ぶ
  function pickEdge(r, w, h) {
    const per = 2 * (w + h);
    const x = r * per;
    if (x < h) return "left";
    if (x < 2 * h) return "right";
    if (x < 2 * h + w) return "top";
    return "bottom";
  }
  // 場の中央の箱（各軸 25〜75%）の点へ向かう単位ベクトル
  function aimInward(x, y, w, h, rng) {
    const tx = w * (0.25 + 0.5 * rng.next());
    const ty = h * (0.25 + 0.5 * rng.next());
    return unit(tx - x, ty - y) || [1, 0];
  }

  // 予告を1つ作る（s を書き換える）
  function makeWarn(s, rng, opt) {
    const id = s.nextId;
    s.nextId += 1;
    const edge = opt.edge;
    const at = opt.at;
    const pos = edgePoint(edge, at, s.w, s.h);
    const dir = opt.dir || aimInward(pos[0], pos[1], s.w, s.h, rng);
    const warn = {
      id, color: opt.color, kind: opt.kind,
      x: pos[0], y: pos[1], dx: dir[0], dy: dir[1],
      spawnTick: s.tick + (isInt(opt.delay) ? opt.delay : WARN_T)
    };
    s.warns.push(warn);
    return warn;
  }

  function intervalTicks(landed, rng) {
    const j = 1 - INTERVAL_JITTER + 2 * INTERVAL_JITTER * rng.next();
    return Math.max(1, Math.round(spawnInterval(landed) * FPS * j));
  }

  // ---------------------------------------------------------------- 新しい回

  // 回の1機目の出方（契約 §3.4・§19 B4）：あかの滑走路の手前側の辺（入り口の向きの逆の辺）の、
  // 入り口の線から場の中央の側へ FIRST_SIDE_MIN〜MAX ずらした所に出し、手前の点（入り口から向きの逆へ APPROACH_D）
  // へ向かってまっすぐ飛ぶ。何もしなければ手前の点を通って入り口の横を抜ける（区域に入らないので着陸しない）。
  // 手前の点に着くまでに約 4 秒あるので、そこから矢印の向きへ短くなぞるだけで入れる。r は 0〜1
  const FIRST_SIDE_MIN = 100, FIRST_SIDE_MAX = 140;
  function firstWarnOpt(layout, plan, r) {
    const L = LAYOUTS[layout];
    const rw = runwayOf(layout, 0, plan);
    const edge = rw.dx > 0 ? "left" : rw.dx < 0 ? "right" : rw.dy > 0 ? "top" : "bottom";
    const off = FIRST_SIDE_MIN + (FIRST_SIDE_MAX - FIRST_SIDE_MIN) * (isNum(r) ? clamp(r, 0, 1) : 0.5);
    const horiz = edge === "left" || edge === "right";
    const c = horiz ? rw.ey : rw.ex;                 // 入り口の線の、辺に沿った位置
    const len = horiz ? L.h : L.w;
    const at = clamp(c + (c < len / 2 ? off : -off), len * 0.15, len * 0.85) / len;
    const pos = edgePoint(edge, at, L.w, L.h);
    const ax = rw.ex - rw.dx * APPROACH_D, ay = rw.ey - rw.dy * APPROACH_D;
    return { edge, at, dir: unit(ax - pos[0], ay - pos[1]) || edgeInward(edge) };
  }

  function newGame(seed, layout, plan) {
    try {
      const lay = normLayout(layout);
      const pl = normPlan(plan);
      const L = LAYOUTS[lay];
      const sd = normSeed(seed);
      const rng = rngBox(sd);
      const s = {
        seed: sd, rng: 0,
        layout: lay, plan: pl, w: L.w, h: L.h,
        tick: 0, landed: 0, lives: LIVES, over: false,
        colors: 1, nextId: 0, nextSpawnTick: 0, pendingColor: null,
        planes: [], warns: [], nearPairs: [],
        stats: { crashes: 0, guidedLandings: 0, freeLandings: 0, bounces: 0, wrongWays: 0 }
      };
      // 回の1機目：あかの滑走路の手前側の辺から、滑走路の向きに沿って（契約 §3.4・§19 B4）
      const first = firstWarnOpt(lay, pl, rng.next());
      makeWarn(s, rng, { edge: first.edge, at: first.at, dir: first.dir, color: 0, kind: "normal", delay: FIRST_SPAWN_T });
      s.nextSpawnTick = FIRST_SPAWN_T + intervalTicks(0, rng);
      s.rng = rng.a;
      return freezeState(s);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- 動かす

  // 道をたどる・直進する（p を書き換える）
  function movePlane(p) {
    let left = p.speed * STEP;
    let guard = 0;
    while (p.path && left > 0 && guard < 64) {
      guard++;
      const q = p.path[p.pathI];
      const d = dist(p.x, p.y, q[0], q[1]);
      if (d > 0) {
        const u = [(q[0] - p.x) / d, (q[1] - p.y) / d];
        p.dx = u[0]; p.dy = u[1];
      }
      if (d <= left) {
        p.x = q[0]; p.y = q[1];
        left -= d;
        p.pathI += 1;
        if (p.pathI >= p.path.length) { p.path = null; p.pathI = 0; }
      } else {
        p.x += p.dx * left;
        p.y += p.dy * left;
        left = 0;
      }
    }
    if (left > 0) {
      p.x += p.dx * left;
      p.y += p.dy * left;
    }
  }

  // 場の端で跳ね返る（p を書き換える）。跳ね返ったら true
  function bounce(p, w, h) {
    let hit = false;
    const lo = PLANE_R, hx = w - PLANE_R, hy = h - PLANE_R;
    if (p.x < lo) { p.x = Math.min(hx, 2 * lo - p.x); p.dx = Math.abs(p.dx); hit = true; }
    else if (p.x > hx) { p.x = Math.max(lo, 2 * hx - p.x); p.dx = -Math.abs(p.dx); hit = true; }
    if (p.y < lo) { p.y = Math.min(hy, 2 * lo - p.y); p.dy = Math.abs(p.dy); hit = true; }
    else if (p.y > hy) { p.y = Math.max(lo, 2 * hy - p.y); p.dy = -Math.abs(p.dy); hit = true; }
    return hit;
  }

  // 着陸の動き：滑走路に沿って奥へ、減速しながら（p を書き換える）
  const LAND_EASE = 0.06;
  function moveLanding(p, layout, plan) {
    const rw = runwayOf(layout, p.color, plan);
    if (!rw) return;
    const tx = rw.ex + rw.dx * RUNWAY_LEN * 0.75;
    const ty = rw.ey + rw.dy * RUNWAY_LEN * 0.75;
    const nx = p.x + (tx - p.x) * LAND_EASE;
    const ny = p.y + (ty - p.y) * LAND_EASE;
    p.speed = dist(p.x, p.y, nx, ny) * FPS;
    p.x = nx; p.y = ny;
    p.dx = rw.dx; p.dy = rw.dy;
  }

  // ---------------------------------------------------------------- 1コマ

  function step(s, events) {
    const rng = rngBox(s.rng);
    s.tick += 1;
    const t = s.tick;

    // ① 予告の時刻が来たら出す（安全距離に機体がいたら 0.5 秒待つ）
    if (s.warns.length) {
      const keep = [];
      for (const w of s.warns) {
        if (w.spawnTick > t) { keep.push(w); continue; }
        let blocked = false;
        for (const p of s.planes) {
          if (p.phase === "fly" && dist(p.x, p.y, w.x, w.y) < SAFE_SPAWN_D) { blocked = true; break; }
        }
        if (blocked) { w.spawnTick = t + SAFE_WAIT_T; keep.push(w); continue; }
        s.planes.push({
          id: w.id, color: w.color, kind: w.kind,
          x: w.x, y: w.y, dx: w.dx, dy: w.dy, speed: SPEED[w.kind],
          path: null, pathI: 0, guided: false, near: false, wrongIn: null,
          phase: "fly", landTick: 0
        });
        events.push({ type: "spawn", id: w.id, color: w.color, kind: w.kind });
      }
      s.warns = keep;
      s.planes.sort((a, b) => a.id - b.id);
    }

    // ② 動かす
    for (const p of s.planes) {
      if (p.phase === "land") { moveLanding(p, s.layout, s.plan); continue; }
      movePlane(p);
      if (bounce(p, s.w, s.h)) {
        s.stats.bounces += 1;
        events.push({ type: "bounce", id: p.id, x: p.x, y: p.y });
      }
    }

    // ③ 着陸の判定
    const rws = runwayListOf(s.layout, s.plan);
    for (const p of s.planes) {
      if (p.phase !== "fly") continue;
      let inZone = null;
      for (const rw of rws) {
        if (rw.color !== p.color || rw.color >= s.colors) continue;
        if (dist(p.x, p.y, rw.ex, rw.ey) <= ZONE_R) { inZone = rw; break; }
      }
      if (!inZone) { p.wrongIn = null; continue; }
      const dot = p.dx * inZone.dx + p.dy * inZone.dy;
      if (dot >= LAND_DOT) {
        const guided = p.guided || p.path !== null;
        p.phase = "land";
        p.landTick = t;
        p.path = null; p.pathI = 0;
        p.near = false;
        p.wrongIn = null;
        s.landed += 1;
        if (guided) s.stats.guidedLandings += 1; else s.stats.freeLandings += 1;
        events.push({ type: "land", id: p.id, color: p.color, landed: s.landed, guided });
      } else if (p.wrongIn !== inZone.color) {
        p.wrongIn = inZone.color;
        s.stats.wrongWays += 1;
        events.push({ type: "wrongway", id: p.id, color: p.color, x: p.x, y: p.y });
      }
    }

    // ④ 着陸の動きが終わった機体を消す
    s.planes = s.planes.filter((p) => !(p.phase === "land" && t - p.landTick >= LAND_T));

    // ⑤ ぶつかる判定（fly どうし。id の小さい組から。消えた機体は次の組に入れない）
    const gone = new Set();
    const fly = s.planes.filter((p) => p.phase === "fly").sort((a, b) => a.id - b.id);
    for (let i = 0; i < fly.length; i++) {
      const a = fly[i];
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < fly.length; j++) {
        const b = fly[j];
        if (gone.has(b.id)) continue;
        if (dist(a.x, a.y, b.x, b.y) < CRASH_D) {
          gone.add(a.id); gone.add(b.id);
          s.lives = Math.max(0, s.lives - CRASH_LIFE);
          s.stats.crashes += 1;
          s.nextSpawnTick += BREATH_T;
          events.push({ type: "crash", ids: [a.id, b.id], x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, lives: s.lives });
          break;
        }
      }
    }
    if (gone.size) s.planes = s.planes.filter((p) => !gone.has(p.id));

    // ⑥ 近すぎる判定
    const prev = new Set(s.nearPairs.map((pr) => pr[0] + ":" + pr[1]));
    const pairs = [];
    for (const p of s.planes) p.near = false;
    const fly2 = s.planes.filter((p) => p.phase === "fly").sort((a, b) => a.id - b.id);
    for (let i = 0; i < fly2.length; i++) {
      for (let j = i + 1; j < fly2.length; j++) {
        const a = fly2[i], b = fly2[j];
        if (dist(a.x, a.y, b.x, b.y) < NEAR_D) {
          a.near = true; b.near = true;
          pairs.push([a.id, b.id]);
          if (!prev.has(a.id + ":" + b.id)) events.push({ type: "near", ids: [a.id, b.id] });
        }
      }
    }
    s.nearPairs = pairs;

    // ⑦ ライフ 0 なら終わり
    if (s.lives <= 0) {
      s.over = true;
      s.warns = [];
      events.push({ type: "over", landed: s.landed });
      s.rng = rng.a;
      return;
    }

    // ⑧ 次の予告（色の解放・間隔・maxAlive）
    const want = colorsFor(s.landed);
    if (want > s.colors) {
      for (let c = s.colors; c < want; c++) events.push({ type: "open", color: c });
      s.colors = want;
      s.pendingColor = want - 1;
    }
    if (t >= s.nextSpawnTick) {
      let alive = s.warns.length;
      for (const p of s.planes) if (p.phase === "fly") alive++;
      if (alive < maxAlive(s.landed) && s.planes.length + s.warns.length < MAX_PLANES) {
        let color;
        if (s.pendingColor !== null) { color = s.pendingColor; s.pendingColor = null; }
        else color = Math.min(s.colors - 1, Math.floor(rng.next() * s.colors));
        const kind = kindFor(s.landed, rng.next());
        const edge = pickEdge(rng.next(), s.w, s.h);
        const at = 0.15 + 0.7 * rng.next();
        const w = makeWarn(s, rng, { edge, at, color, kind });
        events.push({ type: "warn", id: w.id, color: w.color, kind: w.kind, x: w.x, y: w.y });
        s.nextSpawnTick = t + intervalTicks(s.landed, rng);
      }
    }
    s.rng = rng.a;
  }

  function update(state) {
    try {
      if (!state || typeof state !== "object" || state.over === true) return { state, events: [] };
      const s = readState(state);
      if (!s) return { state, events: [] };
      const events = [];
      step(s, events);
      return { state: freezeState(s), events };
    } catch (e) {
      return { state, events: [] };
    }
  }

  function advance(state, n) {
    try {
      const k = isInt(n) && n >= 0 && n <= MAX_ADVANCE ? n : 0;
      if (!state || typeof state !== "object" || state.over === true || k === 0) return { state, events: [] };
      const s = readState(state);
      if (!s) return { state, events: [] };
      const events = [];
      for (let i = 0; i < k && !s.over; i++) step(s, events);
      return { state: freezeState(s), events };
    } catch (e) {
      return { state, events: [] };
    }
  }

  // ---------------------------------------------------------------- 道

  // 道の点が同じ色の開いた区域に向きに沿って入るか（guided）、区域に入るが向きが足りないか（wrongWay）
  function judgePath(path, sx, sy, rw) {
    let enters = false, guided = false;
    if (!rw) return { guided, wrongWay: false };
    let px = sx, py = sy;
    for (let i = 0; i < path.length; i++) {
      const q = path[i];
      if (dist(q[0], q[1], rw.ex, rw.ey) <= ZONE_R) {
        enters = true;
        const u = unit(q[0] - px, q[1] - py);
        if (u && u[0] * rw.dx + u[1] * rw.dy >= LAND_DOT) { guided = true; break; }
      }
      px = q[0]; py = q[1];
    }
    return { guided, wrongWay: enters && !guided };
  }

  function okPoints(points) {
    if (!Array.isArray(points) || points.length === 0) return false;
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      if (!Array.isArray(q) || q.length < 2 || !isNum(q[0]) || !isNum(q[1])) return false;
    }
    return true;
  }

  // 点の列を整える：場の内側へ・機体の近くの先頭を捨てる・PATH_STEP で間引く・MAX_PATH まで
  function cleanPoints(points, px, py, w, h) {
    const out = [];
    let lx = px, ly = py;
    let started = false;
    for (let i = 0; i < points.length && out.length < MAX_PATH; i++) {
      const x = clamp(points[i][0], PLANE_R, w - PLANE_R);
      const y = clamp(points[i][1], PLANE_R, h - PLANE_R);
      if (dist(x, y, lx, ly) < PATH_STEP) continue;   // 先頭は機体から、以後は前の点から PATH_STEP 未満を捨てる
      started = true;
      out.push([x, y]);
      lx = x; ly = y;
    }
    return started ? out : [];
  }

  function setPath(state, id, points) {
    const fail = (reason) => ({ state, ok: false, guided: false, wrongWay: false, reason });
    try {
      if (!state || typeof state !== "object" || !Array.isArray(state.planes)) return fail("noplane");
      if (state.over === true) return fail("over");
      const s = readState(state);
      if (!s) return fail("noplane");
      const p = s.planes.find((q) => q.id === id);
      if (!isInt(id) || !p) return fail("noplane");
      if (p.phase !== "fly") return fail("landing");
      if (!okPoints(points)) return fail("empty");
      const path = cleanPoints(points, p.x, p.y, s.w, s.h);
      let guided = false, wrongWay = false;
      if (path.length) {
        const rw = runwayOf(s.layout, p.color, s.plan);
        const j = judgePath(path, p.x, p.y, rw && rw.color < s.colors ? rw : null);
        guided = j.guided; wrongWay = j.wrongWay;
        p.path = freezePath(path);
      } else {
        p.path = null;
      }
      p.pathI = 0;
      p.guided = guided;
      return { state: freezeState(s), ok: true, guided, wrongWay, reason: null };
    } catch (e) {
      return fail("empty");
    }
  }

  function clearPath(state, id) {
    try {
      const s = readState(state);
      if (!s || s.over) return state;
      const p = s.planes.find((q) => q.id === id);
      if (!p || p.phase !== "fly") return state;
      p.path = null; p.pathI = 0; p.guided = false;
      return freezeState(s);
    } catch (e) {
      return state;
    }
  }

  function pickPlane(state, x, y) {
    try {
      if (!state || !Array.isArray(state.planes) || !isNum(x) || !isNum(y)) return null;
      let best = null, bestD = Infinity;
      for (const p of state.planes) {
        if (!p || p.phase === "land" || !isInt(p.id) || !isNum(p.x) || !isNum(p.y)) continue;
        const d = dist(p.x, p.y, x, y);
        if (d > PICK_R) continue;
        if (d < bestD || (d === bestD && p.id < best)) { best = p.id; bestD = d; }
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- おまかせの道（契約 §4.2 suggestPath）

  const DETOUR_BACK = APPROACH_ROOM - APPROACH_D;   // 手前の点より、さらに手前へ回り込む長さ（32）
  const DETOUR_SIDE = 48;                            // 回り込むときの横の幅（区域＋機体より外）

  // 折れ線を、各区間 PATH_STEP 以上・ほぼ等間隔の点に分ける（角の点は必ず含める）。始点は含めない
  function resample(pts) {
    const out = [];
    let cx = pts[0][0], cy = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const tx = pts[i][0], ty = pts[i][1];
      const len = dist(cx, cy, tx, ty);
      if (len < PATH_STEP) {
        // 短すぎる区間は、最後の点だけ置き換える（間引きで消えないように）
        if (i === pts.length - 1 && out.length) out[out.length - 1] = [tx, ty];
        else if (i === pts.length - 1) out.push([tx, ty]);
        continue;
      }
      const n = Math.max(1, Math.floor(len / PATH_STEP));
      for (let k = 1; k <= n; k++) {
        out.push(k === n ? [tx, ty] : [cx + (tx - cx) * k / n, cy + (ty - cy) * k / n]);
      }
      cx = tx; cy = ty;
    }
    return out;
  }

  function suggestPath(state, id, color) {
    try {
      if (!state || !Array.isArray(state.planes)) return null;
      const p = state.planes.find((q) => q && q.id === id);
      if (!isInt(id) || !p || p.phase === "land" || !isNum(p.x) || !isNum(p.y)) return null;
      const c = color === undefined || color === null ? p.color : color;
      if (!okColor(c) || c >= openColors(state)) return null;
      const layout = layoutOf(state);
      const rw = runwayOf(layout, c, planOf(state));
      if (!rw) return null;
      const L = LAYOUTS[layout];
      const lo = PLANE_R, hx = L.w - PLANE_R, hy = L.h - PLANE_R;
      // 滑走路に沿った座標：u は向き（入り口 0、奥が +）、v は横（n = (-dy, dx)）
      const nx = -rw.dy, ny = rw.dx;
      const G = (u, v) => [clamp(rw.ex + rw.dx * u + nx * v, lo, hx), clamp(rw.ey + rw.dy * u + ny * v, lo, hy)];
      const pu = (p.x - rw.ex) * rw.dx + (p.y - rw.ey) * rw.dy;
      const pv = (p.x - rw.ex) * nx + (p.y - rw.ey) * ny;
      const A = G(-APPROACH_D, 0);
      const pts = [[p.x, p.y]];
      if (pu > -APPROACH_D) {
        // 横・奥の側から来る：手前の通り道の横へ回り込む
        let side;
        if (Math.abs(pv) >= 4) side = pv > 0 ? 1 : -1;
        else {
          // 真後ろ：場の中央に近い側
          const cv = (L.w / 2 - rw.ex) * nx + (L.h / 2 - rw.ey) * ny;
          side = cv < 0 ? -1 : 1;
        }
        // その側が場の端で縮むなら、反対側を使う（機体が真横で遠い場合は、そのまま）
        const roomOf = (sd) => {
          const q = G(-APPROACH_D - DETOUR_BACK, sd * DETOUR_SIDE);
          const raw = [rw.ex + rw.dx * (-APPROACH_D - DETOUR_BACK) + nx * sd * DETOUR_SIDE,
                       rw.ey + rw.dy * (-APPROACH_D - DETOUR_BACK) + ny * sd * DETOUR_SIDE];
          return dist(q[0], q[1], raw[0], raw[1]);
        };
        if (roomOf(side) > 0.5 && roomOf(-side) <= 0.5) side = -side;
        const back = -APPROACH_D - DETOUR_BACK;
        // 横の幅：機体が内側にいるときは、まず横へ PATH_STEP 以上出る（短い区間が間引かれて曲がりが急になるのを防ぐ）
        const sideW = Math.abs(pv) < DETOUR_SIDE ? Math.max(DETOUR_SIDE, Math.abs(pv) + PATH_STEP) : DETOUR_SIDE;
        if (Math.abs(pv) < DETOUR_SIDE) pts.push(G(pu, side * sideW));   // まず横へ出る
        pts.push(G(back, side * sideW));                                 // 手前の横へ
        pts.push(G(back, 0));                                            // 手前の通り道へ
      }
      pts.push(A);                       // 手前の点
      pts.push(G(0, 0));                 // 入り口
      pts.push(G(10, 0));                // 奥へ 10
      // 同じ点が続くのを除く
      const uniq = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const l = uniq[uniq.length - 1];
        if (dist(l[0], l[1], pts[i][0], pts[i][1]) > 1e-9) uniq.push(pts[i]);
      }
      const out = resample(uniq);
      return out.length ? out : null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- テスト・デバッグ用の出現

  function forceSpawn(state, opts) {
    try {
      const s = readState(state);
      if (!s || s.over) return state;
      const o = opts && typeof opts === "object" ? opts : {};
      const rng = rngBox(s.rng);
      const color = okColor(o.color) ? o.color : Math.min(s.colors - 1, Math.floor(rng.next() * s.colors));
      const kind = okKind(o.kind) ? o.kind : "normal";
      const hasEdge = typeof o.edge === "string" && EDGES.indexOf(o.edge) >= 0;
      const edge = hasEdge ? o.edge : pickEdge(rng.next(), s.w, s.h);
      const at = isNum(o.at) ? clamp(o.at, 0, 1) : 0.15 + 0.7 * rng.next();
      // 辺を決めたときは、辺にまっすぐ内向き（テストで向かい合わせにしやすい）。決めないときは中央の箱へ
      let dir = hasEdge ? edgeInward(edge) : null;
      // 拡張：向き (dx, dy) を渡せば、その向き
      if (isNum(o.dx) && isNum(o.dy)) dir = unit(o.dx, o.dy) || dir;
      const w = makeWarn(s, rng, { edge, at, color, kind, dir });
      // 拡張：位置 (x, y) を渡せば、その位置（場の内側に収める）
      if (isNum(o.x) && isNum(o.y)) {
        w.x = clamp(o.x, PLANE_R, s.w - PLANE_R);
        w.y = clamp(o.y, PLANE_R, s.h - PLANE_R);
      }
      s.rng = rng.a;
      return freezeState(s);
    } catch (e) {
      return state;
    }
  }

  // ---------------------------------------------------------------- 保存の検証

  function validateBest(raw) {
    let n;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string") {
      const t = raw.trim();
      if (!/^\d+$/.test(t)) return 0;
      n = Number(t);
    } else return 0;
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }
  function recordBest(prev, landed) {
    const p = validateBest(prev);
    const l = validateBest(landed);
    return { best: Math.max(p, l), improved: l > p };
  }
  function validateFlag(raw) { return raw === "1"; }
  function colorName(id) { return okColor(id) ? COLORS[id].name : ""; }

  // ---------------------------------------------------------------- 自動プレイ（調整と採点用）

  function naivePath(state, id) {
    const p = state.planes.find((q) => q.id === id);
    if (!p) return null;
    const rw = runwayOf(state.layout, p.color, planOf(state));
    if (!rw) return null;
    return resample([[p.x, p.y], [rw.ex, rw.ey]]);
  }

  function autoplay(seed, options) {
    const o = options && typeof options === "object" ? options : {};
    const policy = ["none", "naive", "straight", "lazy"].indexOf(o.policy) >= 0 ? o.policy : "straight";
    const layout = normLayout(o.layout);
    const maxSeconds = isNum(o.maxSeconds) && o.maxSeconds > 0 ? Math.min(o.maxSeconds, 36000) : 900;
    const maxTicks = Math.round(maxSeconds * FPS);
    let state = newGame(seed, layout, o.plan);
    let maxAliveSeen = 0;
    const pending = [];          // lazy：[道を付けるコマ, id]
    const firstFive = new Map(); // id 0〜4 の結末（'land' | 'crash'）
    let spawned = 0;
    try {
      while (!state.over && state.tick < maxTicks) {
        const r = update(state);
        state = r.state;
        for (const e of r.events) {
          if (e.type === "spawn") {
            spawned++;
            if (policy === "straight") {
              const pts = suggestPath(state, e.id);
              if (pts) state = setPath(state, e.id, pts).state;
            } else if (policy === "naive") {
              const pts = naivePath(state, e.id);
              if (pts) state = setPath(state, e.id, pts).state;
            } else if (policy === "lazy") {
              pending.push([state.tick + LAZY_T, e.id]);
            }
          } else if (e.type === "land" && e.id < 5) {
            firstFive.set(e.id, "land");
          } else if (e.type === "crash") {
            for (const i of e.ids) if (i < 5) firstFive.set(i, "crash");
          }
        }
        while (pending.length && pending[0][0] <= state.tick) {
          const id = pending.shift()[1];
          const pts = suggestPath(state, id);
          if (pts) state = setPath(state, id, pts).state;
        }
        let fly = 0;
        for (const p of state.planes) if (p.phase === "fly") fly++;
        if (fly > maxAliveSeen) maxAliveSeen = fly;
      }
    } catch (e) { /* 例外は外へ出さない */ }
    let ffl = 0;
    for (const v of firstFive.values()) if (v === "land") ffl++;
    return {
      landed: state.landed,
      crashes: state.stats.crashes,
      seconds: state.tick * STEP,
      maxAliveSeen,
      guidedLandings: state.stats.guidedLandings,
      freeLandings: state.stats.freeLandings,
      wrongWays: state.stats.wrongWays,
      // 拡張（調整の目安を測るため）
      over: state.over,
      spawned,
      bounces: state.stats.bounces,
      firstFiveLanded: ffl,
      firstFiveDone: firstFive.size
    };
  }

  // ---------------------------------------------------------------- 公開

  const api = Object.freeze({
    NAME, STEP, LAYOUTS, LIVES, CRASH_LIFE, PLANE_R, PICK_R, CRASH_D, NEAR_D, ZONE_R, LAND_DOT,
    APPROACH_D, APPROACH_ROOM, RUNWAY_LEN, RUNWAY_W, SPEED, WARN_S, FIRST_SPAWN_S, LAND_S, CRASH_BREATH,
    SAFE_SPAWN_D, MAX_PLANES, PATH_STEP, MAX_PATH, COLOR_STEPS, SAVE_KEY_BEST, SAVE_KEY_HELP,
    COLORS, RUNWAYS, RUNWAY_PLANS, PLAN_COUNT, KINDS, EDGES,
    makeRng, newGame, update, advance, setPath, clearPath, pickPlane, suggestPath, forceSpawn,
    colorsFor, spawnInterval, maxAlive, kindFor, runwaysFor,
    validateBest, recordBest, validateFlag, colorName, autoplay
  });
  root.MichibikiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
