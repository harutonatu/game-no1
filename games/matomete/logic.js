/*
 * まとめてポン — ロジック（DOM・時計・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/matomete-contract.md §1（ルール）・§3（API）・§9・§10（5こ以上で まわりも消える・れんぞく。§1 より優先）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.MatometeLogic、Node では module.exports と globalThis.MatometeLogic。
 *
 * 中の作り：
 *   - 盤は grid[x][y]（x=0 が左の列、y=0 が下の段）。マスは色 id（0〜colors-1）か null（空）。
 *   - 公開する state はイミュータブル（凍結した新しいオブジェクトと配列）。手で組んだ state も受け付けるが、
 *     形が合わない（列の数・段の数・色 id が範囲外・空のマスの上に色がある など）ときは invalid / false / 0 を返す。
 *   - 種は 32bit に丸める（Date.now() のような大きな数でも同じ規則で丸まる）。state.seed は 0〜4294967295。
 *   - 例外は外へ出さない。
 */
(function (root) {
  "use strict";

  const NAME = "まとめてポン";
  const COLS = 10;
  const ROWS = 20;
  const MODES = Object.freeze({ easy: 3, normal: 4, hard: 5 });
  const ALL_CLEAR_BONUS = 1000;
  const MAX_MOVES_SAVED = 200;
  const SAVE_V = 3;                                // §10 でルールが変わったので 2、BIG を 5 にしたので 3。v:2・v:1 は手を捨てて同じ種の最初から
  // §10：大きく消すと、まわりも消える
  const BIG = 5;                                  // この数以上のかたまりで、まわりも消える
  const STREAK_WIDE = 3;                          // れんぞく（5こ以上が続いた回数）がこの数以上の消し方は、まわりが広い
  const RADIUS = Object.freeze({ near: 1, wide: 2 });   // まわりの範囲（上下左右に数えたマスの数）
  const EXTRA_POINT = 3;                          // まわりで消えたマス 1 こあたりの点（ユーザー決定で +1 → +3）
  const SAVE_KEY_SAVE = "matomete.save";
  const SAVE_KEY_BEST = "matomete.best";
  const SAVE_KEY_BEST_HARD = "matomete.bestHard";
  const SAVE_KEY_HELP = "matomete.help";
  const SAVE_KEY_BEST_EASY = "matomete.bestEasy";
  const SAVE_KEY_MODE = "matomete.mode";          // 最後に遊んだモード（回が終わってから開き直しても同じモードで始める）
  // モードごとの「いちばん少ない のこり」（上達の目安。点数には足さない）
  const SAVE_KEY_LEAST = Object.freeze({ easy: "matomete.leastEasy", normal: "matomete.least", hard: "matomete.leastHard" });
  // 「おしい！」と言う のこりの線（モード別）と、小さなお祝いをする のこりの線
  const NEAR_CLEAR = Object.freeze({ easy: 5, normal: 10, hard: 15 });
  const CHEER_LINE = 5;
  const DEAL_TRIES = 50;   // 最初から消せない盤を配り直す回数の上限（超えたら決定的に直す）

  // 色（契約 §3）。いろびんの Okabe-Ito 系から 5 色。mark は記号の種類（色に頼らないため）
  const COLORS = Object.freeze([
    { id: 0, key: "orange", name: "オレンジ", hex: "#E69F00", mark: "circle" },
    { id: 1, key: "sky",    name: "みずいろ", hex: "#56B4E9", mark: "triangle" },
    { id: 2, key: "green",  name: "みどり",   hex: "#009E73", mark: "square" },
    { id: 3, key: "yellow", name: "きいろ",   hex: "#F0E442", mark: "diamond" },
    { id: 4, key: "pink",   name: "ピンク",   hex: "#CC79A7", mark: "heart" }
  ].map((c) => Object.freeze(c)));

  // ---------------------------------------------------------------- 小さな道具

  const isInt = (n) => Number.isSafeInteger(n);
  const inRange = (x, y) => isInt(x) && isInt(y) && x >= 0 && x < COLS && y >= 0 && y < ROWS;

  // 種を 32bit（0〜4294967295）に丸める。数でない・有限でないときは null
  function normSeed(seed) {
    if (typeof seed !== "number" || !Number.isFinite(seed)) return null;
    return Math.floor(seed) >>> 0;
  }

  // 再現できる乱数（mulberry32）。0 以上 1 未満
  function makeRng(seed) {
    let a;
    try { a = Number(seed) >>> 0; } catch (e) { a = 0; }
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function freezeGrid(g) {
    for (let x = 0; x < COLS; x++) Object.freeze(g[x]);
    return Object.freeze(g);
  }
  function copyGrid(g) {
    const out = new Array(COLS);
    for (let x = 0; x < COLS; x++) {
      const src = g[x], c = new Array(ROWS);
      for (let y = 0; y < ROWS; y++) c[y] = src[y];
      out[x] = c;
    }
    return out;
  }

  // 盤の形が正しいか（列 COLS 本・各 ROWS 段・色 id が範囲内・空のマスの上に色が無い・空の列の右に色が無い）
  function okGrid(g, colors) {
    if (!Array.isArray(g) || g.length !== COLS) return false;
    let emptyColSeen = false;
    for (let x = 0; x < COLS; x++) {
      const c = g[x];
      if (!Array.isArray(c) || c.length !== ROWS) return false;
      let gap = false;
      for (let y = 0; y < ROWS; y++) {
        const v = c[y];
        if (v === null) { gap = true; continue; }
        if (!isInt(v) || v < 0 || v >= colors || gap) return false;
      }
      const empty = c[0] === null;
      if (empty) emptyColSeen = true;
      else if (emptyColSeen) return false;
    }
    return true;
  }

  // ロジックが作った state（凍結済みで書き換えられない）は形を調べ直さない
  const made = new WeakSet();

  // state の形が正しいか（手で組んだ state も受け付ける）
  function okState(s) {
    try {
      if (!s || typeof s !== "object") return false;
      if (made.has(s)) return true;
      if (!isInt(s.colors) || s.colors < 1 || s.colors > COLORS.length) return false;
      if (!isInt(s.score) || s.score < 0 || !isInt(s.moves) || s.moves < 0 || !isInt(s.cleared) || s.cleared < 0) return false;
      if (s.streak !== undefined && (!isInt(s.streak) || s.streak < 0)) return false;   // 無いときは 0 とみなす（§10 より前の形）
      return okGrid(s.grid, s.colors);
    } catch (e) { return false; }
  }

  function makeState(base, grid, extra) {
    const st = Object.freeze({
      seed: base.seed, mode: base.mode, colors: base.colors, grid: freezeGrid(grid),
      score: extra.score, moves: extra.moves, cleared: extra.cleared, over: extra.over, allClear: extra.allClear,
      streak: extra.streak || 0
    });
    made.add(st);
    return st;
  }

  // ---------------------------------------------------------------- 盤の計算（grid だけを見る）

  function gridHasMoves(g) {
    for (let x = 0; x < COLS; x++) {
      const c = g[x];
      if (c[0] === null) break;                       // 空の列から右は全部空
      const r = x + 1 < COLS ? g[x + 1] : null;
      for (let y = 0; y < ROWS; y++) {
        const v = c[y];
        if (v === null) break;
        if (y + 1 < ROWS && c[y + 1] === v) return true;
        if (r && r[y] === v) return true;
      }
    }
    return false;
  }

  function gridRemaining(g) {
    let n = 0;
    for (let x = 0; x < COLS; x++) {
      const c = g[x];
      for (let y = 0; y < ROWS; y++) if (c[y] !== null) n++;
    }
    return n;
  }

  // かたまり（上下左右）。x の小さい順、同じ x は y の小さい順
  function gridGroup(g, x, y) {
    const v = g[x][y];
    if (v === null) return [];
    const seen = new Uint8Array(COLS * ROWS);
    const stack = [x * ROWS + y];
    seen[x * ROWS + y] = 1;
    const out = [];
    while (stack.length) {
      const k = stack.pop();
      out.push(k);
      const cx = (k / ROWS) | 0, cy = k - cx * ROWS;
      if (cx > 0 && !seen[k - ROWS] && g[cx - 1][cy] === v) { seen[k - ROWS] = 1; stack.push(k - ROWS); }
      if (cx < COLS - 1 && !seen[k + ROWS] && g[cx + 1][cy] === v) { seen[k + ROWS] = 1; stack.push(k + ROWS); }
      if (cy > 0 && !seen[k - 1] && g[cx][cy - 1] === v) { seen[k - 1] = 1; stack.push(k - 1); }
      if (cy < ROWS - 1 && !seen[k + 1] && g[cx][cy + 1] === v) { seen[k + 1] = 1; stack.push(k + 1); }
    }
    out.sort((a, b) => a - b);                        // k = x*ROWS+y なので、x→y の順に並ぶ
    return out.map((k) => { const cx = (k / ROWS) | 0; return [cx, k - cx * ROWS]; });
  }

  // まわりの範囲 r（§10）：かたまり n こ・消す前の れんぞく streak から。5こ未満は 0
  function radiusFor(n, streak) {
    if (!isInt(n) || n < BIG) return 0;
    const st = isInt(streak) && streak > 0 ? streak : 0;
    return st + 1 >= STREAK_WIDE ? RADIUS.wide : RADIUS.near;
  }

  // まわりのマス：かたまり cells のどれかから上下左右に数えて 1〜r マス（マンハッタン距離）にある、かたまりの外の色のあるマス。
  // 並びは x の小さい順、同じ x は y の小さい順
  function gridAround(g, cells, r) {
    if (!(r > 0)) return [];
    const inG = new Uint8Array(COLS * ROWS);
    for (const [x, y] of cells) inG[x * ROWS + y] = 1;
    const hit = new Uint8Array(COLS * ROWS);
    for (const [x, y] of cells) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= COLS) continue;
        const rest = r - Math.abs(dx);
        for (let dy = -rest; dy <= rest; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= ROWS) continue;
          const k = nx * ROWS + ny;
          if (!inG[k] && g[nx][ny] !== null) hit[k] = 1;
        }
      }
    }
    const out = [];
    for (let k = 0; k < COLS * ROWS; k++) if (hit[k]) { const cx = (k / ROWS) | 0; out.push([cx, k - cx * ROWS]); }
    return out;
  }

  // ---------------------------------------------------------------- 公開する関数

  function newGame(seed, mode) {
    try {
      const m = mode === undefined ? "normal" : mode;
      if (typeof m !== "string" || !Object.prototype.hasOwnProperty.call(MODES, m)) return null;
      const s = normSeed(seed);
      if (s === null) return null;
      const colors = MODES[m];
      const rng = makeRng(s);
      let g = null;
      for (let t = 0; t < DEAL_TRIES; t++) {
        g = new Array(COLS);
        for (let x = 0; x < COLS; x++) {
          const c = new Array(ROWS);
          for (let y = 0; y < ROWS; y++) c[y] = Math.floor(rng() * colors);
          g[x] = c;
        }
        if (gridHasMoves(g)) break;
      }
      if (!gridHasMoves(g)) g[0][1] = g[0][0];       // 実際には起きないが、念のため決定的に直す
      return makeState({ seed: s, mode: m, colors }, g, { score: 0, moves: 0, cleared: 0, over: false, allClear: false, streak: 0 });
    } catch (e) { return null; }
  }

  function groupAt(state, x, y) {
    if (!okState(state) || !inRange(x, y)) return [];
    return gridGroup(state.grid, x, y);
  }

  function scoreFor(n) {
    if (!isInt(n) || n < 2) return 0;
    return (n - 2) * (n - 2);
  }

  function canRemove(state, x, y) {
    if (!okState(state) || state.over === true || !inRange(x, y)) return false;
    const g = state.grid;
    const v = g[x][y];
    if (v === null) return false;
    return (x > 0 && g[x - 1][y] === v) || (x < COLS - 1 && g[x + 1][y] === v)
      || (y > 0 && g[x][y - 1] === v) || (y < ROWS - 1 && g[x][y + 1] === v);
  }

  function invalid(state, reason) {
    return { state, outcome: Object.freeze({ kind: "invalid", reason }) };
  }

  function applyRemove(state, x, y) {
    try {
      if (!okState(state)) return invalid(state, "range");
      if (state.over === true) return invalid(state, "over");
      if (!inRange(x, y)) return invalid(state, "range");
      const g0 = state.grid;
      const color = g0[x][y];
      if (color === null) return invalid(state, "empty");
      const cells = gridGroup(g0, x, y);
      if (cells.length < 2) return invalid(state, "single");

      // §10：5こ以上なら まわりも同時に消す（れんぞく 3 回目からは広い）
      const streak0 = isInt(state.streak) && state.streak > 0 ? state.streak : 0;
      const big = cells.length >= BIG;
      const radius = radiusFor(cells.length, streak0);
      const extra = gridAround(g0, cells, radius);
      const streak = big ? streak0 + 1 : 0;

      const g = copyGrid(g0);
      for (const [cx, cy] of cells) g[cx][cy] = null;
      for (const [cx, cy] of extra) g[cx][cy] = null;

      // 列の中で落とす（左詰めの前の座標で記録）
      const falls = [];
      for (let cx = 0; cx < COLS; cx++) {
        const c = g[cx];
        let w = 0;
        for (let cy = 0; cy < ROWS; cy++) {
          const v = c[cy];
          if (v === null) continue;
          if (cy !== w) {
            falls.push(Object.freeze({ from: Object.freeze([cx, cy]), to: Object.freeze([cx, w]) }));
            c[w] = v; c[cy] = null;
          }
          w++;
        }
      }

      // 空になった列を詰める（右の列が左へ）
      const shifts = [];
      const g2 = [];
      for (let cx = 0; cx < COLS; cx++) {
        if (g[cx][0] === null) continue;
        if (g2.length !== cx) shifts.push(Object.freeze({ from: cx, to: g2.length }));
        g2.push(g[cx]);
      }
      while (g2.length < COLS) g2.push(new Array(ROWS).fill(null));

      const count = cells.length;
      const extraPoints = extra.length * EXTRA_POINT;
      const points = scoreFor(count) + extraPoints;
      const remaining = gridRemaining(g2);
      const allClear = remaining === 0;
      const bonus = allClear ? ALL_CLEAR_BONUS : 0;
      const over = allClear || !gridHasMoves(g2);
      const ns = makeState(state, g2, {
        score: state.score + points + bonus, moves: state.moves + 1, cleared: state.cleared + count + extra.length,
        over, allClear, streak
      });
      const outcome = Object.freeze({
        kind: "remove", cells: Object.freeze(cells.map((c) => Object.freeze(c))), count, color, points,
        extra: Object.freeze(extra.map((c) => Object.freeze(c))), radius, streak, extraPoints,
        falls: Object.freeze(falls), shifts: Object.freeze(shifts),
        allClear, bonus, over, remaining
      });
      return { state: ns, outcome };
    } catch (e) {
      return invalid(state, "range");
    }
  }

  // 選んだときの予告（§10）：押したマスのかたまりを消したら、どこまで消えて何点になるか（盤は変えない）。
  // → { cells, count, extra, radius, points（合計）, extraPoints, streak（消したあとの値） } か null（消せない）
  function preview(state, x, y) {
    try {
      if (!okState(state) || state.over === true || !inRange(x, y)) return null;
      const g = state.grid;
      if (g[x][y] === null) return null;
      const cells = gridGroup(g, x, y);
      if (cells.length < 2) return null;
      const streak0 = isInt(state.streak) && state.streak > 0 ? state.streak : 0;
      const radius = radiusFor(cells.length, streak0);
      const extra = gridAround(g, cells, radius);
      const extraPoints = extra.length * EXTRA_POINT;
      return {
        cells, count: cells.length, extra, radius, extraPoints, points: scoreFor(cells.length) + extraPoints,
        streak: cells.length >= BIG ? streak0 + 1 : 0
      };
    } catch (e) { return null; }
  }

  function hasMoves(state) {
    if (!okState(state)) return false;
    return gridHasMoves(state.grid);
  }

  function remaining(state) {
    if (!okState(state)) return 0;
    return gridRemaining(state.grid);
  }

  function replay(seed, mode, moves) {
    try {
      let s = newGame(seed, mode);
      if (!s) return { state: null, ok: false, applied: 0 };
      if (!Array.isArray(moves)) return { state: s, ok: false, applied: 0 };
      let applied = 0;
      for (const m of moves) {
        if (!Array.isArray(m) || m.length !== 2) return { state: s, ok: false, applied };
        const r = applyRemove(s, m[0], m[1]);
        if (r.outcome.kind !== "remove") return { state: s, ok: false, applied };
        s = r.state;
        applied++;
      }
      return { state: s, ok: true, applied };
    } catch (e) {
      return { state: null, ok: false, applied: 0 };
    }
  }

  function makeSave(state, moves) {
    try {
      const mv = Array.isArray(moves) ? moves.map((m) => [m[0], m[1]]) : [];
      return JSON.stringify({ v: SAVE_V, seed: state.seed, mode: state.mode, moves: mv });
    } catch (e) {
      return JSON.stringify({ v: SAVE_V, seed: 0, mode: "normal", moves: [] });
    }
  }

  function validateSave(raw) {
    try {
      if (typeof raw !== "string") return null;
      let o;
      try { o = JSON.parse(raw); } catch (e) { return null; }
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
      if (o.v !== SAVE_V && o.v !== 2 && o.v !== 1) return null;
      if (!isInt(o.seed) || o.seed < -2147483648 || o.seed > 4294967295) return null;
      if (typeof o.mode !== "string" || !Object.prototype.hasOwnProperty.call(MODES, o.mode)) return null;
      if (!Array.isArray(o.moves) || o.moves.length > MAX_MOVES_SAVED) return null;
      for (const m of o.moves) {
        if (!Array.isArray(m) || m.length !== 2 || !isInt(m[0]) || !isInt(m[1])) return null;
      }
      // 前の版（v:2・v:1）の途中保存は、ルールが違うので手を捨てて同じ種の最初から（§10）
      if (o.v !== SAVE_V) return { seed: o.seed, mode: o.mode, moves: [] };
      return { seed: o.seed, mode: o.mode, moves: o.moves.map((m) => [m[0], m[1]]) };
    } catch (e) { return null; }
  }

  function validateBest(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return 0;
    if (typeof raw === "string" && raw.trim() === "") return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  function recordBest(prev, score) {
    const p = validateBest(prev);
    const s = validateBest(score);
    const improved = s > p;
    return { best: improved ? s : p, improved };
  }

  function validateFlag(raw) { return raw === "1"; }

  // 保存されたモード。MODES にあればその名前、それ以外（無い・壊れた値）は "normal"
  function validateMode(raw) {
    return typeof raw === "string" && Object.prototype.hasOwnProperty.call(MODES, raw) ? raw : "normal";
  }

  // いちばん少ない のこり：0〜COLS*ROWS の整数（文字列も可）ならその値、それ以外（無い・壊れた値）は null（記録なし）
  function validateLeast(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 && n <= COLS * ROWS ? n : null;
  }

  // 前の記録 prev（壊れた値は記録なし）と今回の のこり left → { least, improved（前より少ない）, prev（前の記録か null） }
  function recordLeast(prev, left) {
    const p = validateLeast(prev);
    const l = validateLeast(left);
    if (l === null) return { least: p, improved: false, prev: p };
    if (p === null) return { least: l, improved: false, prev: null };
    return { least: Math.min(p, l), improved: l < p, prev: p };
  }

  // 「おしい！」と言う のこりか（全部消しは含まない）
  function isNear(mode, left) {
    const line = Object.prototype.hasOwnProperty.call(NEAR_CLEAR, mode) ? NEAR_CLEAR[mode] : NEAR_CLEAR.normal;
    return isInt(left) && left > 0 && left <= line;
  }

  function colorName(id) {
    return isInt(id) && id >= 0 && id < COLORS.length ? COLORS[id].name : "？";
  }

  const api = Object.freeze({
    NAME, COLS, ROWS, MODES, ALL_CLEAR_BONUS, MAX_MOVES_SAVED,
    SAVE_KEY_SAVE, SAVE_KEY_BEST, SAVE_KEY_BEST_HARD, SAVE_KEY_BEST_EASY, SAVE_KEY_HELP, SAVE_KEY_MODE, SAVE_KEY_LEAST,
    NEAR_CLEAR, CHEER_LINE, COLORS, BIG, STREAK_WIDE, RADIUS, EXTRA_POINT, SAVE_V,
    makeRng, newGame, groupAt, scoreFor, canRemove, applyRemove, preview, hasMoves, remaining,
    replay, makeSave, validateSave, validateBest, recordBest, validateFlag, validateMode, validateLeast, recordLeast, isNear, colorName
  });
  root.MatometeLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
