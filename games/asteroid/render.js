/*
 * ちきゅうを守れ！ほしくだき — canvas の描画と演出（リニューアル：大きな線画の小惑星のまわりを自機が飛ぶ）
 * 計画書：docs/plans/asteroid-renew.md §2（見た目 D）・§3（性能）・§5.1（state の形）・§5.2（この API）。約束 §23。担当B だけが編集する。
 *
 * AsteroidRender.create(canvas, { cssW, cssH, dpr, calm, onAbsorb }) → r
 *   r.frame(state, events, dt)  毎コマ。events はそのコマで集めたもの（無ければ [] か null）
 *   r.resize(cssW, cssH, dpr)   canvas の大きさが変わったとき（canvas.width/height はここで決める。style は main.js）
 *   r.burst(kind, arg)          'up'|'evolve'|'swap'|'unlock'（自機がひかる）。ほかに 'clear'|'end'
 *   r.reset()                   星が変わった・retry のあと（オフスクリーンを次のコマで作り直す）
 *   r.stats() → { fps, cellPx, view: { x, y, rot }, ... }
 *   （おまけ：r.setCalm(bool)・r.pause()・r.resume()。約束の外。使わなくてよい）
 *
 * - 世界の単位：1 マス CELL = 8。マス i（c = i % w, r = i / w）の中心は ((c+0.5)·8, (r+0.5)·8)。拡大は固定（1 単位 = 1 CSS px）。
 * - カメラ：自機を画面の中心より少し右下に置き、小惑星の（残っているマスの）重心がいつも画面の左の向きになるように回す。
 *   回る速さに上限（ROT_MAX rad/秒。動きを減らす設定では回さず、星の始めの向きで固定。背景の星はもともと回らない）。rot は「世界 → 画面」の回転の角度。
 * - 性能（§3）：小惑星は 64×64 マスの区画ごとのオフスクリーン canvas（1 単位 = dpr px）に描いておき、
 *   rock.dirty のマス（とそのまわり 1 マス）だけ塗り直す。ふちの光る線もそのまわりだけ。読んだら rock.dirty = []。
 *   rock.dirty が来ないのに rock.gen が変わったときは、全マスを見比べて変わったマスを探す（念のため）。
 *   毎コマは 背景 1 回 ＋ 見えている区画の drawImage（ふつう 1〜2 回）＋ ひかり のゆれ ＋ 弾・粒・自機。shadowBlur・filter は使わない。
 *   いちばん重いのは回した区画を画面いっぱいに画素にする所（命令の時間 drawMs には出ない）。コマが遅いときだけ getImageData で測り、重ければ内部の解像度を下げる（checkHeavy）。
 * - 粒は MAX_PARTICLES = 300 まで。行き先は state.ship（動いても追いかける）。
 * - 動きを減らす設定（prefers-reduced-motion か calm）：カメラの回転をゆっくりに・粒を減らす・揺れや輪を出さない。
 */
(function (root) {
  "use strict";

  const Lg = () => root.AsteroidLogic || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const MAX_DPR = 2;
  const MAX_PARTICLES = 300;
  const SHOTS_MAX = 200;
  const SLOW_MS = 34;
  const HEAVY_GAP_MS = 20;        // コマの間隔の中央がこれをこえたら（50fps 未満）、描画が重いのかを測る
  const HEAVY_DRAW_MS = 12;       // 画素にする時間がこれをこえたまま続いたら、内部の解像度を下げる
  const PROBE_MS = 150;           // 測る間隔（軽かったら 4 秒まで延ばす）
  const SPAWN_BUDGET = 80;        // 1 コマに新しく出す粒の上限
  const HIT_FX_BUDGET = 24;       // 1 コマに出す「当たった光」の上限
  const TILE = 64;                // 区画の大きさ（マス）。64 × 8 × 2 = 1024 px（§3「1056 を超えるなら区画に分ける」）
  const MAX_CELLS = 140;          // 格子の 1 辺の上限（計画は最大 132）
  const ROT_MAX = 0.5;            // カメラの回る速さの上限（rad/秒）。動きを減らす設定では回さない（星の始めの向きで固定）
  const ROT_EASE = 2.2;           // 差に対する回る速さ（1/秒）。上限と小さい方
  const ANCHOR_X = 0.62, ANCHOR_Y = 0.56;   // 自機の画面の位置（幅・高さに対する割合）
  const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';
  const NAMES_FALLBACK = { shot: "たま", spread: "ちらし", bomb: "どかん", bolt: "いなずま", beam: "ビーム", fire: "ほのお" };

  // ===== 色（見本 D）=====
  const BG_TOP = "#0a1630", BG_BOT = "#06102a";
  const BODY = { 1: "#0c1838", 2: "#131c38", 3: "#0c1f40", 4: "#191c33", 5: "#0c1838" };
  const GRID = "#1a2a55";
  const EDGE_GLOW = "rgba(170,205,255,";      // ふちの光（外側の太い線の色。アルファは後ろに足す）
  const EDGE_CORE = "#f4f8ff";
  const MARK_IRON = "#5e7096";
  const MARK_ICE = "#5aa6d6";
  const MARK_GOLD = "#f2c14e";
  const GLOW_COL = ["#e8782a", "#f0b72f"];    // ひかり：オレンジと黄
  const CRACK = "#46609a";
  const SHOT_COL = { shot: "#ffffff", spread: "#ffd84d", bomb: "#ff9a3c", bolt: "#ffe066", beam: "#d8f6ff", fire: "#ff5a3c" };
  const PART_COL = { 1: "#ffffff", 2: "#c8d4ea", 3: "#c8f0ff", 4: "#ffd34d", 5: "#ffc23c" };
  const YELLOW = "#ffd84d";
  const SHIP_SCALE = 1.35;   // 自機の大きさ（絵の倍率。長さ約 22 単位）

  function hash(a, b) {
    let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return h >>> 0;
  }
  function mulberry(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function safe(f, d) { try { return f(); } catch (e) { return d; } }
  function nameOf(id) {
    try {
      const Wp = Lg().WEAPONS;
      if (Array.isArray(Wp)) { const x = Wp.find((q) => q && q.id === id); if (x && typeof x.name === "string" && x.name) return x.name; }
      else if (Wp && typeof Wp === "object" && Wp[id] && typeof Wp[id].name === "string" && Wp[id].name) return Wp[id].name;
    } catch (e) { /* 下の既定 */ }
    return NAMES_FALLBACK[id] || "ぶき";
  }
  function evolveLine(id, lv) {
    if (Math.floor(num(lv, 10) / 10) > 3) return "つよさが 2ばいに なった";
    switch (id) {
      case "shot": return "たまが ふえた";
      case "spread": return "はっすうが ふえた";
      case "bomb": return "ばくはつが おおきく なった";
      case "bolt": return "えだわかれが ふえた";
      case "beam": return "ビームが ふとく なった";
      case "fire": return "ながく もえる ように なった";
      default: return "つよく なった";
    }
  }
  function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
  function now() { return root.performance && performance.now ? performance.now() : Date.now(); }

  function create(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    const doc = root.document;
    const mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let calmWanted = !!o.calm;
    let calm = calmWanted || !!(mq && mq.matches);
    const onAbsorb = typeof o.onAbsorb === "function" ? o.onAbsorb : null;
    const rnd = mulberry(7349);
    const C = () => { const c = num(Lg().CELL, 8); return c > 0 ? c : 8; };

    let cssW = 360, cssH = 640, dpr = 1;
    let dprCap = Infinity, heavySince = null;   // 描画が重いときの逃げ道：内部の解像度の上限（一度下げたら戻さない）
    let probeAt = -Infinity, probeWait = PROBE_MS, flushMs = 0;   // 描いた絵を画素にする時間を、コマが遅いときだけ時々測る（checkHeavy）
    let bg = null;
    let frames = 0, slowFrames = 0, lastFrameAt = null, paused = false;
    const drawTimes = [];
    const frameGaps = [];
    let clk = 0;
    let lastState = null;

    // カメラ
    let camX = 0, camY = 0, rot = 0, camReady = false;

    // 小惑星（描いてある形）
    let rockRef = null, rockW = 0, rockH = 0, rockN = 0, rockGen = -1, rockStar = -1;
    let known = null;        // 描いてあるマスの材質（Uint8Array）
    let crackK = null;       // 描いてあるひびの段（0〜2）
    let hp0 = null;          // 星の始めの体力（ひびの段の目安）
    let tiles = [];          // { cv, g, tc, tr, x0, y0, cw, ch } or null
    let tilesX = 0, tilesY = 0, tileScale = 1;
    let needFull = true;
    let sumC = 0, sumR = 0, cnt = 0;   // 残っているマスの重心
    let glowSet = new Set(); // ひかり のマス
    let glowList = null;     // 描く用の配列（glowSet が変わったら作り直す）
    let rockRedraws = 0, rockFullRedraws = 0, lastFullMs = 0;

    // 演出
    let particles = [];      // { x, y, vx, vy, age, home, sx, sy, dur, col, size }
    let ghosts = [];         // はなれたかたまり・ひかり：{ x, y, m, delay, t, flash }
    let fx = [];
    let absorbPending = 0, absorbAt = -1, bumpAt = -1;
    let shipGlow = 0, shipGlowKind = "";
    let evolveText = null;
    let lastBolt = null;
    let spawnLeft = SPAWN_BUDGET, hitFxLeft = HIT_FX_BUDGET;
    let flame = 0;

    function el(id) { try { return doc ? doc.getElementById(id) : null; } catch (e) { return null; } }
    const kakeraEl = el("kakera");
    if (kakeraEl && kakeraEl.addEventListener) kakeraEl.addEventListener("animationend", () => kakeraEl.classList.remove("bump"));
    if (mq) {
      const onMq = () => { calm = calmWanted || mq.matches; };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    }

    // ===== 大きさ =====
    function resize(w, h, d) {
      cssW = Math.max(1, Math.round(num(w, cssW)));
      cssH = Math.max(1, Math.round(num(h, cssH)));
      dpr = Math.min(clamp(num(d, dpr), 1, MAX_DPR), dprCap);
      const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      bg = null;
      // 区画の細かさは dpr に合わせる。ただし重くて下げたときは作り直さない（細かい区画を縮めて描けば同じ絵。作り直しの引っかかりを出さない）
      if (dpr > tileScale + 1e-6 || (dpr < tileScale - 1e-6 && dprCap === Infinity)) needFull = true;
    }
    function makeCanvas(w, h) {
      if (doc && doc.createElement) { const c = doc.createElement("canvas"); c.width = w; c.height = h; return c; }
      if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
      return null;
    }

    // 背景：縦のグラデーション＋小さな星（動かない）。大きさが変わったときだけ作る
    function buildBg() {
      const pw = canvas.width, ph = canvas.height;
      const c = makeCanvas(pw, ph);
      if (!c) return null;
      const g = c.getContext("2d");
      const gr = g.createLinearGradient(0, 0, 0, ph);
      gr.addColorStop(0, BG_TOP); gr.addColorStop(1, BG_BOT);
      g.fillStyle = gr; g.fillRect(0, 0, pw, ph);
      const r = mulberry(1234);
      const n = Math.round((cssW * cssH) / 2600);
      for (let k = 0; k < n; k++) {
        const x = r() * pw, y = r() * ph, s = (r() < 0.15 ? 1.6 : 1) * dpr;
        g.globalAlpha = 0.25 + r() * 0.45;
        g.fillStyle = r() < 0.2 ? "#cfe0ff" : "#8fa6d8";
        g.fillRect(x, y, s, s);
      }
      g.globalAlpha = 1;
      return c;
    }

    // ===== 小惑星のオフスクリーン =====
    function matsOf(rock) { return rock && rock.mats && typeof rock.mats.length === "number" ? rock.mats : null; }
    function matAt(i) { return known[i] | 0; }
    function solid(c, r) { return c >= 0 && r >= 0 && c < rockW && r < rockH && known[r * rockW + c] !== 0; }

    function tileOf(c, r) { return tiles[((r / TILE) | 0) * tilesX + ((c / TILE) | 0)]; }
    function ensureTile(tx, ty) {
      const k = ty * tilesX + tx;
      if (tiles[k]) return tiles[k];
      const cell = C();
      const cw = Math.min(TILE, rockW - tx * TILE), ch = Math.min(TILE, rockH - ty * TILE);
      // ふちの光が格子の外にはみ出すので、外側の区画は 1 マス広げる
      const padL = tx === 0 ? 1 : 0, padT = ty === 0 ? 1 : 0;
      const padR = tx === tilesX - 1 ? 1 : 0, padB = ty === tilesY - 1 ? 1 : 0;
      const x0 = (tx * TILE - padL) * cell, y0 = (ty * TILE - padT) * cell;
      const ww = (cw + padL + padR) * cell, hh = (ch + padT + padB) * cell;
      const cv = makeCanvas(Math.max(1, Math.ceil(ww * tileScale)), Math.max(1, Math.ceil(hh * tileScale)));
      if (!cv) return null;
      const g = cv.getContext("2d");
      const t = { cv, g, x0, y0, ww, hh, c0: tx * TILE - padL, r0: ty * TILE - padT, c1: tx * TILE + cw + padR, r1: ty * TILE + ch + padB };
      tiles[k] = t;
      return t;
    }
    // 区画の中の、マスの範囲 [c0,c1)×[r0,r1) を塗る（clip は呼ぶ側）。edges は edge 候補の範囲（1 マス広い）
    function paintCells(g, list, noGrid) {
      const cell = C();
      // 体
      const byM = [[], [], [], [], [], []];
      for (const i of list) { const m = known[i]; if (m) byM[m].push(i); }
      for (let m = 1; m <= 5; m++) {
        const L = byM[m];
        if (!L.length) continue;
        g.fillStyle = BODY[m];
        for (const i of L) g.fillRect((i % rockW) * cell, ((i / rockW) | 0) * cell, cell, cell);
      }
      // 薄いマス目（上と左の線）
      g.fillStyle = GRID;
      const lw = 0.7;
      if (!noGrid) for (let m = 1; m <= 5; m++) for (const i of byM[m]) {
        const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell;
        g.fillRect(x, y, cell, lw); g.fillRect(x, y, lw, cell);
      }
      // しるし：てつ＝十字、こおり＝斜め、きん＝金の点、ひかり＝オレンジと黄
      if (byM[2].length) {
        g.fillStyle = MARK_IRON;
        for (const i of byM[2]) { const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell; g.fillRect(x + 2, y + cell / 2 - 0.4, cell - 3.3, 0.8); g.fillRect(x + cell / 2 - 0.4 + 0.35, y + 2, 0.8, cell - 3.3); }
      }
      if (byM[3].length) {
        g.strokeStyle = MARK_ICE; g.lineWidth = 0.8; g.beginPath();
        for (const i of byM[3]) { const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell; g.moveTo(x + 2, y + cell - 1.6); g.lineTo(x + cell - 1.6, y + 2); }
        g.stroke();
      }
      if (byM[4].length) {
        g.fillStyle = MARK_GOLD; g.beginPath();
        for (const i of byM[4]) { const x = (i % rockW + 0.5) * cell + 0.35, y = (((i / rockW) | 0) + 0.5) * cell + 0.35; g.moveTo(x + 1.5, y); g.arc(x, y, 1.5, 0, TAU); }
        g.fill();
      }
      if (byM[5].length) {
        for (let k = 0; k < 2; k++) {
          g.fillStyle = GLOW_COL[k];
          for (const i of byM[5]) { if ((hash(i, 77) & 1) !== k) continue; const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell; g.fillRect(x + 1, y + 1, cell - 1.6, cell - 1.6); }
        }
      }
      if (crackK && !noGrid) paintCracks(g, list);
    }
    // ひび
    function paintCracks(g, list) {
      const cell = C();
      {
        g.strokeStyle = CRACK; g.lineWidth = 0.7; g.beginPath();
        let any = false;
        for (const i of list) {
          const k = crackK[i]; if (!k || !known[i] || known[i] === 5) continue;
          any = true;
          const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell, h = hash(i, 5);
          const a = (h & 3) + 1.5, b = ((h >> 2) & 3) + 1.5;
          g.moveTo(x + a, y + 1.5); g.lineTo(x + cell / 2, y + cell / 2); g.lineTo(x + cell - 1.5, y + b + 2);
          if (k > 1) { g.moveTo(x + cell / 2, y + cell / 2); g.lineTo(x + b, y + cell - 1.5); }
        }
        if (any) g.stroke();
      }
    }
    // 区画をまとめて塗る（作り直しのとき用。いわ の体とマス目は横・縦の続きを 1 本の四角で塗り、ほかは paintCells と同じ）
    function paintBlock(g, cc0, cr0, cc1, cr1) {
      const cell = C(), lw = 0.7;
      const other = [];
      g.fillStyle = BODY[1];
      for (let r = cr0; r < cr1; r++) {
        let c = cc0;
        while (c < cc1) {
          while (c < cc1 && !known[r * rockW + c]) c++;
          const s0 = c;
          while (c < cc1 && known[r * rockW + c]) { if (known[r * rockW + c] !== 1) other.push(r * rockW + c); c++; }
          if (c > s0) g.fillRect(s0 * cell, r * cell, (c - s0) * cell, cell);
        }
      }
      paintCells(g, other, true);
      g.fillStyle = GRID;
      for (let r = cr0; r < cr1; r++) {
        let c = cc0;
        while (c < cc1) {
          while (c < cc1 && !known[r * rockW + c]) c++;
          const s0 = c;
          while (c < cc1 && known[r * rockW + c]) c++;
          if (c > s0) g.fillRect(s0 * cell, r * cell, (c - s0) * cell, lw);
        }
      }
      for (let c = cc0; c < cc1; c++) {
        let r = cr0;
        while (r < cr1) {
          while (r < cr1 && !known[r * rockW + c]) r++;
          const s0 = r;
          while (r < cr1 && known[r * rockW + c]) r++;
          if (r > s0) g.fillRect(c * cell, s0 * cell, lw, (r - s0) * cell);
        }
      }
      if (crackK) {
        const ck = [];
        for (let r = cr0; r < cr1; r++) for (let c = cc0; c < cc1; c++) { const i = r * rockW + c; if (crackK[i] && known[i]) ck.push(i); }
        if (ck.length) paintCracks(g, ck);
      }
    }
    // ふちの線（マスと空の境目）。cand のマスの辺のうち、となりが空のもの
    function strokeEdges(g, cand) {
      const cell = C();
      g.beginPath();
      let any = false;
      for (const i of cand) {
        if (!known[i]) continue;
        const c = i % rockW, r = (i / rockW) | 0, x = c * cell, y = r * cell;
        if (!solid(c, r - 1)) { g.moveTo(x, y); g.lineTo(x + cell, y); any = true; }
        if (!solid(c, r + 1)) { g.moveTo(x, y + cell); g.lineTo(x + cell, y + cell); any = true; }
        if (!solid(c - 1, r)) { g.moveTo(x, y); g.lineTo(x, y + cell); any = true; }
        if (!solid(c + 1, r)) { g.moveTo(x + cell, y); g.lineTo(x + cell, y + cell); any = true; }
      }
      if (!any) return;
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = EDGE_GLOW + "0.12)"; g.lineWidth = 7; g.stroke();
      g.strokeStyle = EDGE_GLOW + "0.28)"; g.lineWidth = 4; g.stroke();
      g.strokeStyle = EDGE_CORE; g.lineWidth = 1.7; g.stroke();
    }
    function fullRedraw() {
      const t0 = now();
      tiles = [];
      tileScale = dpr;
      tilesX = Math.ceil(rockW / TILE); tilesY = Math.ceil(rockH / TILE);
      for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
        const c0 = tx * TILE, r0 = ty * TILE, c1 = Math.min(rockW, c0 + TILE), r1 = Math.min(rockH, r0 + TILE);
        // 空の区画は作らない（あとでマスが増えることはない。光のはみ出しはとなりの区画の 1 マス分だけなので、まわり 1 マスも見る）
        let has = false;
        for (let r = Math.max(0, r0 - 1); r < Math.min(rockH, r1 + 1) && !has; r++) for (let c = Math.max(0, c0 - 1); c < Math.min(rockW, c1 + 1); c++) if (known[r * rockW + c]) { has = true; break; }
        if (!has) { tiles.push(null); continue; }
        tiles.push(null);
        const t = ensureTile(tx, ty);
        if (!t) continue;
        const g = t.g;
        g.setTransform(tileScale, 0, 0, tileScale, -t.x0 * tileScale, -t.y0 * tileScale);
        g.clearRect(t.x0, t.y0, t.ww, t.hh);
        const cr0 = Math.max(0, t.r0), cr1 = Math.min(rockH, t.r1), cc0 = Math.max(0, t.c0), cc1 = Math.min(rockW, t.c1);
        paintBlock(g, cc0, cr0, cc1, cr1);
        // ふちはこの区画に光がかかるマス（1 マス広く）
        const cand = [];
        for (let r = Math.max(0, cr0 - 1); r < Math.min(rockH, cr1 + 1); r++) for (let c = Math.max(0, cc0 - 1); c < Math.min(rockW, cc1 + 1); c++) { const i = r * rockW + c; if (known[i]) cand.push(i); }
        strokeEdges(g, cand);
      }
      needFull = false;
      rockFullRedraws++;
      lastFullMs = now() - t0;
    }
    // 変わったマス（changed）のまわり 1 マスを塗り直す
    function partialRedraw(changed) {
      if (!changed.length) return;
      const cell = C();
      const area = new Set();
      for (const i of changed) {
        const c = i % rockW, r = (i / rockW) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const c2 = c + dx, r2 = r + dy;
          if (c2 < 0 || r2 < 0 || c2 >= rockW || r2 >= rockH) continue;
          area.add(r2 * rockW + c2);
        }
      }
      // 区画ごとに分ける（区画の外側の 1 マスの枠＝格子の外は、はしの区画に入れる）
      const byTile = new Map();
      const push = (k, i, out) => { let e = byTile.get(k); if (!e) { e = { area: [], out: [] }; byTile.set(k, e); } (out ? e.out : e.area).push(i); };
      for (const i of area) {
        const c = i % rockW, r = (i / rockW) | 0;
        const tx = (c / TILE) | 0, ty = (r / TILE) | 0;
        push(ty * tilesX + tx, i, false);
        // 格子のはしのマスなら、外側の光の枠も塗り直す（はしの区画の pad の所）
        if (c === 0 || r === 0 || c === rockW - 1 || r === rockH - 1) push(ty * tilesX + tx, i, true);
      }
      for (const [k, e] of byTile) {
        const t = tiles[k];
        if (!t) continue;     // 空の区画（マスが無い所。変わることは無い）
        const g = t.g;
        g.setTransform(tileScale, 0, 0, tileScale, -t.x0 * tileScale, -t.y0 * tileScale);
        g.save();
        g.beginPath();
        for (const i of e.area) g.rect((i % rockW) * cell, ((i / rockW) | 0) * cell, cell, cell);
        for (const i of e.out) {
          const c = i % rockW, r = (i / rockW) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const c2 = c + dx, r2 = r + dy;
            if (c2 >= 0 && r2 >= 0 && c2 < rockW && r2 < rockH) continue;
            g.rect(c2 * cell, r2 * cell, cell, cell);
          }
        }
        g.clip();
        for (const i of e.area) g.clearRect((i % rockW) * cell, ((i / rockW) | 0) * cell, cell, cell);
        for (const i of e.out) { const c = i % rockW, r = (i / rockW) | 0; g.clearRect((c - 1) * cell, (r - 1) * cell, cell * 3, cell * 3); }
        if (e.out.length) {   // clearRect で消えた中のマスを戻すため、まわりも塗る
          for (const i of e.out) { const c = i % rockW, r = (i / rockW) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c2 = c + dx, r2 = r + dy; if (c2 >= 0 && r2 >= 0 && c2 < rockW && r2 < rockH) e.area.push(r2 * rockW + c2); } }
        }
        paintCells(g, e.area);
        const cand = new Set();
        for (const i of e.area) {
          const c = i % rockW, r = (i / rockW) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const c2 = c + dx, r2 = r + dy;
            if (c2 < 0 || r2 < 0 || c2 >= rockW || r2 >= rockH) continue;
            cand.add(r2 * rockW + c2);
          }
        }
        strokeEdges(g, cand);
        g.restore();
      }
      rockRedraws++;
    }
    function crackOf(i, hp) {
      if (!hp0 || !hp) return 0;
      const a = num(hp0[i], 0), b = num(hp[i], 0);
      if (!(a > 0)) return 0;
      const f = b / a;
      return f > 0.67 ? 0 : f > 0.34 ? 1 : 2;
    }
    // 新しい格子を読む（星が変わった・retry・reset）
    function adoptRock(rock) {
      const mats = matsOf(rock);
      const w = clamp(Math.floor(num(rock.w, 0)), 0, MAX_CELLS), h = clamp(Math.floor(num(rock.h, 0)), 0, MAX_CELLS);
      rockRef = rock.key; rockW = w; rockH = h; rockN = w * h;
      rockGen = num(rock.gen, -1);
      known = new Uint8Array(rockN);
      crackK = new Uint8Array(rockN);
      hp0 = null;
      sumC = 0; sumR = 0; cnt = 0; glowSet = new Set(); glowList = null;
      if (mats) {
        for (let i = 0; i < rockN; i++) {
          const m = clamp(mats[i] | 0, 0, 5);
          known[i] = m;
          if (m) { sumC += i % w; sumR += (i / w) | 0; cnt++; if (m === 5) glowSet.add(i); }
        }
      }
      const hp = rock.hp;
      if (hp && typeof hp.length === "number" && hp.length >= rockN) {
        hp0 = new Float32Array(rockN);
        for (let i = 0; i < rockN; i++) hp0[i] = num(hp[i], 0);
      }
      if (Array.isArray(rock.dirty)) safe(() => { rock.dirty = []; }, null);
      ghosts = [];
      needFull = true;
    }
    // マス i の材質が m に変わった（描いてある形を直す）
    function setKnown(i, m) {
      const old = known[i];
      if (old === m) return false;
      const c = i % rockW, r = (i / rockW) | 0;
      if (old) { sumC -= c; sumR -= r; cnt--; }
      if (m) { sumC += c; sumR += r; cnt++; }
      if (old === 5) { glowSet.delete(i); glowList = null; }
      if (m === 5) { glowSet.add(i); glowList = null; }
      known[i] = m;
      return true;
    }
    function syncRock(state) {
      const rock = state.rock;
      if (!rock || typeof rock !== "object") return;
      const w = clamp(Math.floor(num(rock.w, 0)), 0, MAX_CELLS), h = clamp(Math.floor(num(rock.h, 0)), 0, MAX_CELLS);
      const gen = num(rock.gen, -1);
      const star = num(state.star, 1);
      if (rock.key !== rockRef || w !== rockW || h !== rockH || star !== rockStar || gen < rockGen || !known) {
        rockStar = star;
        adoptRock(rock);
      }
      const mats = matsOf(rock);
      if (!mats || !rockN) { if (needFull) needFull = false; return; }
      const changed = [];
      const d = rock.dirty;
      let gotDirty = false;
      if (d && typeof d.length === "number" && d.length) {
        gotDirty = true;
        for (let k = 0; k < d.length; k++) {
          const i = d[k] | 0;
          if (i < 0 || i >= rockN) continue;
          if (setKnown(i, clamp(mats[i] | 0, 0, 5))) changed.push(i);
          else if (crackK && rock.hp) { const ck = crackOf(i, rock.hp); if (ck !== crackK[i]) { crackK[i] = ck; changed.push(i); } }
        }
        // 読んだら空にする（同じ配列をロジックが持ち続けていても、新しい配列に替えていても大丈夫なように）
        if (Array.isArray(d)) d.length = 0; else safe(() => { rock.dirty = []; }, null);
      }
      if (gen !== rockGen) {
        if (!gotDirty) {   // dirty が来なかった：全部見比べる（念のため。17,424 マスで 0.1ms 以下）
          for (let i = 0; i < rockN; i++) { const m = clamp(mats[i] | 0, 0, 5); if (setKnown(i, m)) changed.push(i); }
        }
        rockGen = gen;
      }
      if (needFull) fullRedraw();
      else if (changed.length) partialRedraw(changed);
    }
    function cellCenter(i) {
      const cell = C(), w = Math.max(1, rockW);
      return { x: ((i % w) + 0.5) * cell, y: (((i / w) | 0) + 0.5) * cell };
    }

    // ===== カメラ =====
    function updateCamera(state, dt, snap) {
      const ship = state.ship;
      const cell = C();
      if (ship && typeof ship === "object") { camX = num(ship.x, camX); camY = num(ship.y, camY); }
      if (cnt <= 0) return;
      const gx = (sumC / cnt + 0.5) * cell, gy = (sumR / cnt + 0.5) * cell;
      const dx = gx - camX, dy = gy - camY;
      if (dx * dx + dy * dy < 1) return;
      // 世界の向き a の線が画面で左（π）を向く回転：rot + a = π
      const want = Math.PI - Math.atan2(dy, dx);
      if (snap || !camReady) { rot = want; camReady = true; return; }
      if (calm) return;   // 動きを減らす：向きは星の始めのまま（酔い対策）
      const diff = angDiff(want, rot);
      const step = Math.min(ROT_MAX * dt, Math.abs(diff) * Math.min(1, ROT_EASE * dt));
      rot = angDiff(rot + Math.sign(diff) * step, 0);
    }
    // 世界 → 画面（device px）の変換を ctx に入れる
    function worldTransform(g) {
      const cs = Math.cos(rot) * dpr, sn = Math.sin(rot) * dpr;
      const ax = cssW * ANCHOR_X * dpr, ay = cssH * ANCHOR_Y * dpr;
      g.setTransform(cs, sn, -sn, cs, ax - (cs * camX - sn * camY), ay - (sn * camX + cs * camY));
    }
    // 画面に見えている世界の範囲（回した四角を囲む箱）
    function viewBox(pad) {
      const cs = Math.cos(-rot), sn = Math.sin(-rot);
      const ax = cssW * ANCHOR_X, ay = cssH * ANCHOR_Y;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pts = [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]];
      for (const p of pts) {
        const sx = p[0] - ax, sy = p[1] - ay;
        const wx = camX + cs * sx - sn * sy, wy = camY + sn * sx + cs * sy;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
      }
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }

    // ===== 粒 =====
    function addParticle(x, y, col, spread, size) {
      if (spawnLeft <= 0) return;
      spawnLeft--;
      if (particles.length >= MAX_PARTICLES) { particles.shift(); absorbPending++; }
      const a = rnd() * TAU, sp = calm ? 0 : (25 + rnd() * 60) * (spread || 1);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, home: calm ? 1 : 0, sx: x, sy: y, dur: 0.45 + rnd() * 0.25, col, size: size || 1.3 + rnd() * 1.1, bend: (rnd() - 0.5) * 40 });
    }
    function flushAbsorb() {
      if (absorbPending <= 0) return;
      if (kakeraEl && !calm && clk - bumpAt > 0.12) {
        bumpAt = clk;
        kakeraEl.classList.remove("bump");
        void kakeraEl.offsetWidth;
        kakeraEl.classList.add("bump");
      }
      if (onAbsorb && clk - absorbAt >= 0.1) {
        absorbAt = clk;
        const n = absorbPending;
        absorbPending = 0;
        try { onAbsorb(n); } catch (e) { /* 音が鳴らなくても絵は止めない */ }
      } else if (!onAbsorb) absorbPending = 0;
    }
    function stepParticles(dt, ship) {
      const hx = ship ? num(ship.x, camX) : camX, hy = ship ? num(ship.y, camY) : camY;
      let w = 0;
      for (let k = 0; k < particles.length; k++) {
        const p = particles[k];
        p.age += dt;
        if (!p.home) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 0.9; p.vy *= 0.9;
          if (p.age >= 0.2) { p.home = 1; p.sx = p.x; p.sy = p.y; p.age = 0; }
          particles[w++] = p;
          continue;
        }
        const t = clamp(p.age / p.dur, 0, 1);
        if (t >= 1) { absorbPending++; continue; }
        const e = t * t;   // だんだん速く吸い込まれる
        if (calm) { p.x = p.sx + (hx - p.sx) * e; p.y = p.sy + (hy - p.sy) * e; }
        else {
          // 横へ少しふくらむ曲線（自機へ向かう線に直角）
          const dx = hx - p.sx, dy = hy - p.sy, L = Math.hypot(dx, dy) || 1;
          const nx = -dy / L, ny = dx / L, b = p.bend * (1 - e) * e * 4;
          p.x = p.sx + dx * e + nx * b; p.y = p.sy + dy * e + ny * b;
        }
        particles[w++] = p;
      }
      particles.length = w;
    }

    // ===== events =====
    function onEvents(state, events) {
      if (!Array.isArray(events) || !events.length) return;
      const ship = state.ship || {};
      let breaks = 0;
      for (const ev of events) if (ev && ev.kind === "break") breaks++;
      const perBreak = calm ? (breaks > 6 ? 0.5 : 1) : breaks > 16 ? 1 : 2;
      let half = 0;
      for (const ev of events) {
        if (!ev || typeof ev.kind !== "string") continue;
        switch (ev.kind) {
          case "fire": {
            if (!calm && (ev.w === "bomb" || ev.w === "spread")) fx.push({ kind: "muzzle", t: 0, dur: 0.1, x: num(ev.x, num(ship.x, 0)), y: num(ev.y, num(ship.y, 0)), col: SHOT_COL[ev.w] });
            break;
          }
          case "hit": {
            const i = ev.i | 0;
            if (!known || i < 0 || i >= rockN) break;
            if (hitFxLeft > 0) { hitFxLeft--; const p = cellCenter(i); fx.push({ kind: "hit", t: 0, dur: 0.12, x: p.x, y: p.y }); }
            // ひびの段が変わったら塗り直す
            if (crackK && known[i] && state.rock && state.rock.hp) { const ck = crackOf(i, state.rock.hp); if (ck !== crackK[i]) { crackK[i] = ck; partialRedraw([i]); } }
            break;
          }
          case "break": {
            const i = ev.i | 0;
            if (!known || i < 0 || i >= rockN) break;
            const p = cellCenter(i);
            const m = known[i] || 1;
            let n = perBreak;
            if (n < 1) { half++; n = half % 2; }
            for (let k = 0; k < n; k++) addParticle(p.x, p.y, PART_COL[m] || "#ffffff", 1);
            if (m === 4 && !calm) fx.push({ kind: "spark", t: 0, dur: 0.3, x: p.x, y: p.y });
            break;
          }
          case "chunk":
          case "glow": {
            if (!known || !Array.isArray(ev.cells)) break;
            const isGlow = ev.kind === "glow";
            const cells = ev.cells.slice(0, 1200);
            let sx = 0, sy = 0;
            for (const i of cells) { sx += (i | 0) % rockW; sy += ((i | 0) / rockW) | 0; }
            sx /= Math.max(1, cells.length); sy /= Math.max(1, cells.length);
            let dmax = 0.001;
            const ds = cells.map((i) => { const d = Math.hypot(((i | 0) % rockW) - sx, (((i | 0) / rockW) | 0) - sy); if (d > dmax) dmax = d; return d; });
            const every = calm ? 3 : 1;
            cells.forEach((i, k) => {
              i |= 0;
              if (i < 0 || i >= rockN) return;
              const m = known[i] || (isGlow ? 5 : 1);
              const p = cellCenter(i);
              if (!calm) ghosts.push({ x: p.x, y: p.y, m, delay: isGlow ? (ds[k] / dmax) * 0.12 : 0.05 + (1 - ds[k] / dmax) * 0.25, t: 0, flash: isGlow });
              if (k % every === 0) {
                const np = isGlow ? 3 : 1;
                for (let j = 0; j < np; j++) addParticle(p.x, p.y, isGlow ? (j === 0 ? "#ffe27a" : "#ffb347") : PART_COL[m] || "#ffffff", isGlow ? 1.6 : 1, isGlow ? 1.8 : 0);
              }
            });
            if (isGlow && !calm) {
              const cell = C();
              fx.push({ kind: "glowRing", t: 0, dur: 0.45, x: (sx + 0.5) * cell, y: (sy + 0.5) * cell, r: Math.max(12, dmax * cell + 10) });
            }
            break;
          }
          case "bolt": {
            if (!known) break;
            let edges = Array.isArray(ev.edges) ? ev.edges : null;
            let from = ev.from;
            if (!edges && Array.isArray(ev.path) && ev.path.length) { edges = []; for (let k = 1; k < ev.path.length; k++) edges.push([ev.path[k - 1], ev.path[k]]); from = ev.path[0]; }
            if (!edges) edges = [];
            if (typeof from !== "number") from = edges.length ? edges[0][0] : -1;
            if (from < 0 || from >= rockN) break;
            const depth = new Map([[from | 0, 0]]);
            const segs = [];
            let dmax = 1;
            for (const e of edges.slice(0, 120)) {
              if (!Array.isArray(e)) continue;
              const a = e[0] | 0, b = e[1] | 0;
              const da = depth.has(a) ? depth.get(a) : 0;
              depth.set(b, da + 1);
              if (da + 1 > dmax) dmax = da + 1;
              const pa = cellCenter(a), pb = cellCenter(b);
              segs.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, d: da });
            }
            const r0 = cellCenter(from | 0);
            lastBolt = { dur: 0.35, segs: segs.length };
            fx.push({ kind: "bolt", t: 0, dur: 0.35, mx: num(ev.x, num(ship.x, r0.x)), my: num(ev.y, num(ship.y, r0.y)), rx: r0.x, ry: r0.y, segs, dmax, seed: (rnd() * 1e6) | 0 });
            break;
          }
          case "boom": {
            // r は世界の単位
            fx.push({ kind: "boom", t: 0, dur: 0.4, x: num(ev.x, 0), y: num(ev.y, 0), r: Math.max(4, num(ev.r, 24)) });
            break;
          }
          case "beam": {
            // ang は ship.ang と同じ向き（x + cos·len, y + sin·len）。w は世界の単位の太さ
            const ang = num(ev.ang, 0), len = Math.max(4, num(ev.len, 80));
            const x = num(ev.x, num(ship.x, 0)), y = num(ev.y, num(ship.y, 0));
            fx.push({ kind: "beam", t: 0, dur: 0.35, x, y, ex: x + Math.cos(ang) * len, ey: y + Math.sin(ang) * len, w: clamp(num(ev.w, 6), 1.5, 40) });
            break;
          }
          case "burn": break;   // 燃えているマスは state.burns から毎コマ描く
          case "evolve": {
            const sl = state && Array.isArray(state.slots) ? state.slots[ev.slot | 0] : null;
            const id = (sl && sl.id) || ev.w || ev.id;
            evolveText = { a: nameOf(id) + "が しんか！", b: evolveLine(id, ev.lv), t: 0 };
            burst("evolve", ev.slot | 0);
            break;
          }
          case "swap": burst("swap"); break;
          case "clear": burst("clear"); break;
          case "ending": burst("end"); break;
          case "lost": fx.push({ kind: "lost", t: 0, dur: 0.8 }); break;
          case "boss": if (!calm) fx.push({ kind: "bossFlash", t: 0, dur: 0.8 }); break;
          default: break;
        }
      }
    }

    // ===== 演出のきっかけ（ボタンを押したとき。自機がひかる）=====
    function burst(kind) {
      switch (kind) {
        case "up": shipGlow = Math.max(shipGlow, 0.6); shipGlowKind = "up"; break;
        case "evolve": shipGlow = 1; shipGlowKind = "evolve"; break;
        case "unlock": shipGlow = 1; shipGlowKind = "unlock"; break;
        case "swap": shipGlow = Math.max(shipGlow, 0.8); shipGlowKind = "swap"; break;
        case "clear": fx.push({ kind: "star", t: 0, dur: calm ? 0.6 : 1.2 }); break;
        case "end": fx.push({ kind: "endGlow", t: 0, dur: 2.5 }); shipGlow = 1; shipGlowKind = "evolve"; break;
        default: break;
      }
    }
    function reset() {
      rockRef = null; known = null; needFull = true; camReady = false;
      particles = []; ghosts = []; fx = []; absorbPending = 0;
    }

    // ===== 1 コマ =====
    function frame(state, events, dtSec) {
      const t0 = now();
      if (lastFrameAt != null && !paused) {
        const gap = t0 - lastFrameAt;
        if (gap > SLOW_MS) slowFrames++;
        frameGaps.push(gap); if (frameGaps.length > 60) frameGaps.shift();
      }
      lastFrameAt = t0;
      if (!state || typeof state !== "object") { frames++; return; }
      lastState = state;
      let dt = clamp(num(dtSec, 1 / 60), 0, 0.1);
      if (paused) dt = 0;
      spawnLeft = SPAWN_BUDGET; hitFxLeft = HIT_FX_BUDGET;
      // 先に形を合わせる（events の粒の色は「壊れる前に描いてあった材質」から取りたいので、break の色は adopt 前の known）
      const rock = state.rock;
      const fresh = !!rock && typeof rock === "object" && (rock.key !== rockRef || !known);
      if (fresh) syncRock(state);
      onEvents(state, events);
      if (!fresh) syncRock(state);
      updateCamera(state, dt, fresh);
      clk += dt;
      flame += dt;
      advanceFx(dt);
      stepParticles(dt, state.ship);
      flushAbsorb();
      draw(state);
      frames++;
      drawTimes.push(now() - t0);
      if (drawTimes.length > 120) drawTimes.shift();
      checkHeavy();
    }
    // 描画が重いときの逃げ道：内部の解像度を 2 → 1.5 → 1 と下げる（CSS の大きさは変えない）。
    // canvas の命令は記録されるだけで、画素にする（ラスタライズ）のはコマの終わりのブラウザの中なので、drawMs（命令の時間）には出ない。
    // そこで、コマの間隔の中央が 20ms をこえるときだけ、時々 getImageData(1 画素) で画素にするのを今させて、その時間を測る。
    // 画素にする時間が 12ms をこえたのが 0.15 秒あけて 2 回続いたら下げる。軽ければ測る間隔を延ばす（30fps に止めている端末で何度も測らない）。
    function checkHeavy() {
      if (dpr <= 1 || paused || frameGaps.length < 10) { heavySince = null; return; }
      const gaps = frameGaps.slice(-10).sort((a, b) => a - b);
      if (gaps[5] <= HEAVY_GAP_MS) { heavySince = null; probeWait = PROBE_MS; return; }
      const t = now();
      if (t - probeAt < probeWait) return;
      probeAt = t;
      try { ctx.getImageData(0, 0, 1, 1); } catch (e) { return; }
      const ms = now() - t;   // 画素にする時間だけ（星が変わるときの作り直しなど、命令の側の一時の重さでは下げない）
      if (ms <= HEAVY_DRAW_MS) { heavySince = null; flushMs = ms; probeWait = Math.min(4000, probeWait * 2); return; }
      probeWait = PROBE_MS;
      if (heavySince === null) { heavySince = t; flushMs = ms; return; }
      flushMs = Math.min(flushMs, ms);   // 重い間の小さいほう（たまたま重かった 1 回で下げすぎない）
      if (t - heavySince < 150) return;
      // 画素の数に比例するとみて、12ms に収まる見込みの解像度へ（1.5 で足りなければ 1 へまっすぐ。下げる引っかかりを 1 回にする）
      dprCap = dpr > 1.5 && flushMs * (1.5 / dpr) * (1.5 / dpr) <= HEAVY_DRAW_MS ? 1.5 : 1;
      heavySince = null;
      drawTimes.length = 0; frameGaps.length = 0;
      resize(cssW, cssH, dprCap);
    }
    function advanceFx(dt) {
      let w = 0;
      for (const f of fx) { f.t += dt; if (f.t < f.dur) fx[w++] = f; }
      fx.length = w;
      w = 0;
      for (const g of ghosts) { g.t += dt; if (g.t < g.delay + 0.3) ghosts[w++] = g; }
      ghosts.length = w;
      if (shipGlow > 0) shipGlow = Math.max(0, shipGlow - dt * 1.4);
      if (evolveText) { evolveText.t += dt; if (evolveText.t > 1.8) evolveText = null; }
    }

    // ===== 描く =====
    function draw(state) {
      if (!bg) bg = buildBg();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      if (bg) ctx.drawImage(bg, 0, 0);
      else { ctx.fillStyle = BG_BOT; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      const vb = viewBox(4);
      worldTransform(ctx);
      drawRock(vb);
      drawGlowPulse(vb);
      drawBurns(state, vb);
      drawGhosts();
      for (const f of fx) {
        if (f.kind === "beam") drawBeam(f);
        else if (f.kind === "bolt") drawBolt(f);
        else if (f.kind === "boom") drawBoom(f);
        else if (f.kind === "glowRing") drawRing(f, "#ffc23c");
        else if (f.kind === "hit") { ctx.globalAlpha = 1 - f.t / f.dur; ctx.fillStyle = "#ffffff"; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); }
        else if (f.kind === "spark") { const k = f.t / f.dur; ctx.globalAlpha = 1 - k; ctx.strokeStyle = MARK_GOLD; ctx.lineWidth = 1; const r = 3 + k * 6; ctx.beginPath(); ctx.moveTo(f.x - r, f.y); ctx.lineTo(f.x + r, f.y); ctx.moveTo(f.x, f.y - r); ctx.lineTo(f.x, f.y + r); ctx.stroke(); }
        else if (f.kind === "muzzle") { ctx.globalAlpha = 1 - f.t / f.dur; ctx.fillStyle = f.col || "#fff"; ctx.beginPath(); ctx.arc(f.x, f.y, 3.5, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      drawShots(state, vb);
      drawParticles();
      drawShip(state);
      // ここから画面の座標（CSS px）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const f of fx) {
        if (f.kind === "star") drawStarFlash(f);
        else if (f.kind === "endGlow" || f.kind === "bossFlash" || f.kind === "lost") drawScreenTint(f);
      }
      drawEvolveText();
      ctx.globalAlpha = 1;
    }
    function drawRock(vb) {
      if (!known || !tiles.length) return;
      const ts = tileScale;
      for (const t of tiles) {
        if (!t) continue;
        const x0 = Math.max(vb.x0, t.x0), y0 = Math.max(vb.y0, t.y0);
        const x1 = Math.min(vb.x1, t.x0 + t.ww), y1 = Math.min(vb.y1, t.y0 + t.hh);
        if (x1 <= x0 || y1 <= y0) continue;
        // 元の画像の範囲は画素の整数に（Safari ははみ出すと描かないことがある）
        const sx = Math.max(0, Math.floor((x0 - t.x0) * ts)), sy = Math.max(0, Math.floor((y0 - t.y0) * ts));
        const ex = Math.min(t.cv.width, Math.ceil((x1 - t.x0) * ts)), ey = Math.min(t.cv.height, Math.ceil((y1 - t.y0) * ts));
        if (ex <= sx || ey <= sy) continue;
        ctx.drawImage(t.cv, sx, sy, ex - sx, ey - sy, t.x0 + sx / ts, t.y0 + sy / ts, (ex - sx) / ts, (ey - sy) / ts);
      }
    }
    // ひかり：明るさがゆっくりゆれる（見えているマスだけ。4 つの組に分けてまとめて塗る）
    function drawGlowPulse(vb) {
      if (!glowSet.size) return;
      if (!glowList) glowList = Array.from(glowSet);
      const cell = C();
      const c0 = Math.floor(vb.x0 / cell), c1 = Math.ceil(vb.x1 / cell), r0 = Math.floor(vb.y0 / cell), r1 = Math.ceil(vb.y1 / cell);
      const speed = calm ? 0.8 : 2.2;
      for (let grp = 0; grp < 4; grp++) {
        const a = 0.5 + 0.5 * Math.sin(clk * speed + grp * 1.57);
        ctx.globalAlpha = 0.08 + a * (calm ? 0.18 : 0.38);
        ctx.fillStyle = grp & 1 ? "#fff3b0" : "#ffd27a";
        ctx.beginPath();
        let any = false;
        for (const i of glowList) {
          const c = i % rockW, r = (i / rockW) | 0;
          if (c < c0 || c > c1 || r < r0 || r > r1) continue;
          if ((hash(i, 31) & 3) !== grp) continue;
          ctx.rect(c * cell + 1, r * cell + 1, cell - 1.6, cell - 1.6);
          any = true;
        }
        if (any) ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawBurns(state, vb) {
      const burns = state.burns;
      if (!Array.isArray(burns) || !burns.length || !rockW) return;
      const cell = C();
      const n = Math.min(burns.length, 300);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? "#ffd84d" : "#ff6a3c";
        ctx.globalAlpha = pass ? 0.8 : 0.55;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const b = burns[k];
          if (!b) continue;
          const i = typeof b === "number" ? b : b.i;
          if (typeof i !== "number" || i < 0 || i >= rockN) continue;
          const x = (i % rockW) * cell, y = ((i / rockW) | 0) * cell;
          if (x < vb.x0 - cell || x > vb.x1 || y < vb.y0 - cell || y > vb.y1) continue;
          const fl = 0.5 + 0.5 * Math.sin(clk * 14 + i);
          const s = pass ? 1.2 + fl * 1.4 : 2.5 + fl * 1.5;
          ctx.moveTo(x + cell / 2 + s, y + cell / 2);
          ctx.arc(x + cell / 2, y + cell / 2, s, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawGhosts() {
      if (!ghosts.length) return;
      const cell = C();
      for (const g of ghosts) {
        if (g.t < g.delay) {
          // 崩れる前：白く光る
          ctx.globalAlpha = g.flash ? 0.9 : 0.6;
          ctx.fillStyle = g.flash ? "#fff1b8" : "#dfe9ff";
          ctx.fillRect(g.x - cell / 2 + 0.5, g.y - cell / 2 + 0.5, cell - 1, cell - 1);
        } else {
          const k = (g.t - g.delay) / 0.3;
          const s = (cell - 1) * (1 - k);
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = g.flash ? GLOW_COL[g.m & 1] : "#9fb6e6";
          ctx.fillRect(g.x - s / 2, g.y - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawRing(f, col) {
      const k = f.t / f.dur;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // どかん：黄の二重の輪（見本 D）
    function drawBoom(f) {
      const k = f.t / f.dur;
      const r = f.r * (0.35 + 0.65 * Math.sqrt(k));
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.fillStyle = "#ffb347";
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = YELLOW; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, r * 1.45, 0, TAU); ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function drawBeam(f) {
      const k = f.t / f.dur;
      const a = clamp(k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85, 0, 1);
      const dx = f.ex - f.x, dy = f.ey - f.y, L = Math.hypot(dx, dy);
      if (L < 1) return;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const band = (w) => { ctx.beginPath(); ctx.moveTo(f.x + nx * w, f.y + ny * w); ctx.lineTo(f.ex + nx * w, f.ey + ny * w); ctx.lineTo(f.ex - nx * w, f.ey - ny * w); ctx.lineTo(f.x - nx * w, f.y - ny * w); ctx.closePath(); ctx.fill(); };
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = "#9fe6ff"; band(f.w * 0.75);
      ctx.globalAlpha = a * 0.8; ctx.fillStyle = "#d8f6ff"; band(f.w * 0.35);
      ctx.globalAlpha = a; ctx.fillStyle = "#ffffff"; band(Math.max(0.6, f.w * 0.12));
      ctx.globalAlpha = 1;
    }
    // いなずま：自機 → ねらったマスへ折れ線、そこから枝（黄、枝の先ほど細く、0.35 秒）
    function drawBolt(f) {
      const k = f.t / f.dur;
      const r = mulberry(f.seed + ((f.t * 30) | 0));
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      const trunk = [[f.mx, f.my]];
      const L = Math.hypot(f.rx - f.mx, f.ry - f.my);
      const n = Math.max(3, Math.round(L / 10));
      const nx = -(f.ry - f.my) / (L || 1), ny = (f.rx - f.mx) / (L || 1);
      for (let j = 1; j < n; j++) { const u = j / n, off = (r() - 0.5) * 9; trunk.push([f.mx + (f.rx - f.mx) * u + nx * off, f.my + (f.ry - f.my) * u + ny * off]); }
      trunk.push([f.rx, f.ry]);
      const jit = f.segs.map(() => [(r() - 0.5) * 5, (r() - 0.5) * 5]);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? "#fffbe0" : YELLOW;
        const base = pass ? 0.8 : 2;
        ctx.lineWidth = base;
        ctx.beginPath();
        ctx.moveTo(trunk[0][0], trunk[0][1]);
        for (let j = 1; j < trunk.length; j++) ctx.lineTo(trunk[j][0], trunk[j][1]);
        ctx.stroke();
        for (let bd = 0; bd < 3; bd++) {
          ctx.lineWidth = Math.max(0.5, base * (1 - bd * 0.3));
          ctx.beginPath();
          let any = false;
          for (let s = 0; s < f.segs.length; s++) {
            const g = f.segs[s];
            const b = Math.min(2, Math.floor((g.d / Math.max(1, f.dmax)) * 3));
            if (b !== bd) continue;
            any = true;
            ctx.moveTo(g.ax, g.ay);
            ctx.lineTo((g.ax + g.bx) / 2 + jit[s][0], (g.ay + g.by) / 2 + jit[s][1]);
            ctx.lineTo(g.bx, g.by);
          }
          if (any) ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawShots(state, vb) {
      const shots = state.shots;
      if (!Array.isArray(shots) || !shots.length) return;
      const n = Math.min(SHOTS_MAX, shots.length);
      const kinds = ["shot", "spread", "bomb", "fire", "other"];
      ctx.lineCap = "round";
      for (const kd of kinds) {
        ctx.beginPath();
        let any = false;
        for (let k = 0; k < n; k++) {
          const s = shots[k];
          if (!s) continue;
          const w = s.w in SHOT_COL && s.w !== "bolt" && s.w !== "beam" ? s.w : "other";
          if (w !== kd) continue;
          const x = num(s.x, NaN), y = num(s.y, NaN);
          if (!(x >= vb.x0 && x <= vb.x1 && y >= vb.y0 && y <= vb.y1)) continue;
          any = true;
          const vx = num(s.vx, 0), vy = num(s.vy, 0), v = Math.hypot(vx, vy) || 1;
          if (kd === "bomb") { ctx.moveTo(x + 3.2, y); ctx.arc(x, y, 3.2, 0, TAU); }
          else if (kd === "fire") { ctx.moveTo(x + 2.6, y); ctx.arc(x, y, 2.6, 0, TAU); }
          else { const len = kd === "shot" ? 6 : 4.5; ctx.moveTo(x, y); ctx.lineTo(x - (vx / v) * len, y - (vy / v) * len); }
        }
        if (!any) continue;
        if (kd === "bomb") { ctx.strokeStyle = SHOT_COL.bomb; ctx.lineWidth = 1.6; ctx.stroke(); }
        else if (kd === "fire") { ctx.globalAlpha = 0.85; ctx.fillStyle = SHOT_COL.fire; ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.strokeStyle = kd === "other" ? "#ffffff" : SHOT_COL[kd]; ctx.lineWidth = kd === "shot" ? 1.8 : 1.6; ctx.stroke(); }
      }
    }
    function drawParticles() {
      if (!particles.length) return;
      // 色ごとにまとめる（色は数種類）
      const groups = new Map();
      for (const p of particles) { let g = groups.get(p.col); if (!g) { g = []; groups.set(p.col, g); } g.push(p); }
      for (const [col, L] of groups) {
        ctx.fillStyle = col;
        ctx.beginPath();
        for (const p of L) { const s = p.size; ctx.rect(p.x - s / 2, p.y - s / 2, s, s); }
        ctx.fill();
      }
    }
    // 自機：白い線だけの、先の丸い三角＋小さな炎
    function drawShip(state) {
      const s = state.ship;
      if (!s || typeof s !== "object") return;
      const x = num(s.x, camX), y = num(s.y, camY), a = num(s.ang, 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.scale(SHIP_SCALE, SHIP_SCALE);
      // 炎（後ろ）
      const fl = calm ? 0.5 : 0.5 + 0.5 * Math.sin(flame * 40) * 0.6 + rnd() * 0.2;
      ctx.fillStyle = "#ff9a3c"; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(-6, -2.2); ctx.lineTo(-6 - 4 - fl * 4, 0); ctx.lineTo(-6, 2.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffe27a";
      ctx.beginPath(); ctx.moveTo(-6, -1.1); ctx.lineTo(-6 - 2 - fl * 2, 0); ctx.lineTo(-6, 1.1); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      // ひかる（強くした・しんか・入れ替え）
      if (shipGlow > 0) {
        const col = shipGlowKind === "swap" ? "#9fe6ff" : YELLOW;
        ctx.globalAlpha = shipGlow * 0.35; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, 12 + (1 - shipGlow) * 8, 0, TAU); ctx.fill();
        if (!calm && shipGlowKind !== "up") {
          ctx.globalAlpha = shipGlow; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, 10 + (1 - shipGlow) * 22, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // 本体：先の丸い三角（線だけ）。光は太い薄い線を下に
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(-6, -5.5);
        ctx.lineTo(7, -1.6);
        ctx.quadraticCurveTo(9.6, 0, 7, 1.6);
        ctx.lineTo(-6, 5.5);
        ctx.lineTo(-3.5, 0);
        ctx.closePath();
      };
      ctx.lineJoin = "round";
      path();
      ctx.fillStyle = "rgba(10,22,48,0.85)"; ctx.fill();
      ctx.strokeStyle = "rgba(200,225,255,0.25)"; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.restore();
    }
    function drawStarFlash(f) {
      const k = f.t / f.dur;
      const ax = cssW * ANCHOR_X, ay = cssH * ANCHOR_Y;
      ctx.globalAlpha = Math.sin(Math.PI * k) * 0.8;
      ctx.strokeStyle = YELLOW; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax, ay, 10 + k * Math.max(cssW, cssH) * 0.6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function drawScreenTint(f) {
      const k = f.t / f.dur;
      const a = Math.sin(Math.PI * k);
      if (f.kind === "lost") { ctx.globalAlpha = a * 0.25; ctx.fillStyle = "#ff7a3c"; }
      else if (f.kind === "bossFlash") { ctx.globalAlpha = a * 0.18; ctx.fillStyle = "#ff5a3c"; }
      else { ctx.globalAlpha = a * 0.2; ctx.fillStyle = "#ffe27a"; }
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
    }
    function drawEvolveText() {
      if (!evolveText) return;
      const t = evolveText.t;
      const a = t < 0.08 ? t / 0.08 : t > 1.5 ? clamp(1 - (t - 1.5) / 0.3, 0, 1) : 1;
      const sc = calm ? 1 : 1 + 0.25 * Math.max(0, 1 - t / 0.25);
      const VW = cssW;
      let s1 = 26, s2 = 16;
      ctx.font = "900 " + s1 + "px " + FONT;
      const w1 = ctx.measureText(evolveText.a).width;
      if (w1 > VW - 40) s1 = Math.max(14, (s1 * (VW - 40)) / w1);
      ctx.font = "800 " + s2 + "px " + FONT;
      const w2 = ctx.measureText(evolveText.b).width;
      if (w2 > VW - 40) s2 = Math.max(12, (s2 * (VW - 40)) / w2);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(VW / 2, cssH * 0.36);
      ctx.scale(sc, sc);
      ctx.fillStyle = "rgba(6,16,42,0.94)";
      ctx.fillRect(-VW / 2 + 12, -s1 - 8, VW - 24, s1 + s2 + 26);
      ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = 2;
      ctx.strokeRect(-VW / 2 + 12, -s1 - 8, VW - 24, s1 + s2 + 26);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.font = "900 " + s1 + "px " + FONT;
      ctx.fillStyle = "#f2c14e";
      ctx.fillText(evolveText.a, 0, 0);
      ctx.font = "800 " + s2 + "px " + FONT;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(evolveText.b, 0, s2 + 8);
      ctx.restore();
    }

    function setCalm(v) {
      calmWanted = !!v;
      calm = calmWanted || !!(mq && mq.matches);
    }
    function pause() { paused = true; lastFrameAt = null; }
    function resume() { paused = false; lastFrameAt = null; }
    function stats() {
      const s = drawTimes.slice().sort((a, b) => a - b);
      const gs = frameGaps.length ? frameGaps.reduce((a, b) => a + b, 0) / frameGaps.length : 0;
      return {
        fps: gs > 0 ? Math.round(10000 / gs) / 10 : 0,
        cellPx: C(),                 // 1 マスの画面の大きさ（CSS px。拡大は固定）
        view: { x: Math.round(camX * 10) / 10, y: Math.round(camY * 10) / 10, rot: Math.round(rot * 1000) / 1000 },
        particles: particles.length,
        shots: lastState && Array.isArray(lastState.shots) ? Math.min(SHOTS_MAX, lastState.shots.length) : 0,
        frames, slowFrames, rockRedraws, rockFullRedraws,
        fullMs: Math.round(lastFullMs * 100) / 100,
        drawMs: s.length ? Math.round(s[(s.length / 2) | 0] * 100) / 100 : 0,
        drawMsMax: s.length ? Math.round(s[s.length - 1] * 100) / 100 : 0,
        calm, dpr, flushMs: Math.round(flushMs * 100) / 100,
        bolt: lastBolt ? Object.assign({}, lastBolt) : null,
        evolve: evolveText ? evolveText.b : null
      };
    }

    resize(num(o.cssW, canvas.clientWidth || 360), num(o.cssH, canvas.clientHeight || 640), num(o.dpr, root.devicePixelRatio || 1));
    return { frame, resize, burst, reset, stats, setCalm, pause, resume, MAX_PARTICLES };
  }

  root.AsteroidRender = { create, MAX_PARTICLES };
})(typeof window !== "undefined" ? window : globalThis);
