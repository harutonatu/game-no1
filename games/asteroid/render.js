/*
 * ちきゅうを守れ！ほしくだき — canvas の描画と演出
 * 契約：docs/asteroid-contract.md §6（描画）・§5.1（配置）・§4.1（state の形）・§4.3（events）。担当B だけが編集する。
 *
 * AsteroidRender.create(canvas, { calm, onAbsorb }) → {
 *   layout(cssWidth, cssHeight) → { scale, width, height },
 *   frame(state, events, dtSec), burst(kind), setCalm(bool), pause(), resume(),
 *   stats() → { particles, shots, frames, slowFrames, rockRedraws, rockFullRedraws, drawMs, calm }
 * }
 * - 世界は 幅 360 × 高さ 560 の単位（§3.1）。canvas は渡された箱（既定は canvas の親 .stage）いっぱいに広げる（§18.1 A）。
 *   見せる範囲（カメラ）は星ごとに決める：小惑星が場の幅の 7 割前後（ROCK_FILL）になるまで寄せる。ただし
 *   下（地球の上の端・バリア・戦闘機）は必ず見せ、小惑星の全体と近づく道のりが入る高さは残す。上の空は切る。
 *   寄せて上を切った分は、小惑星を「見た目だけ」下にずらして描く（ずらす量はバリアに近づくほど 0 に近づき、
 *   バリアに届く所では 0＝ロジックの位置とぴったり同じ）。弾・どかんの輪も、戦闘機から小惑星までの間で同じ割合でずらす。
 *   ロジックの数（当たり・はね返し・#distance）は何も変わらない。
 *   親の大きさが変わったら ResizeObserver（無ければ resize・orientationchange）で自分で layout し直す（T6）。
 * - 背景（星空・地球）はオフスクリーンに1回だけ描く。バリアの弧は毎フレーム（波打つため。線2本だけ）。
 * - 小惑星のマスはオフスクリーンに描いておき、欠けた・ひびが増えたマスだけ描き直す（rockRedraws）。
 *   毎フレームはそのオフスクリーンを1回写すだけ（y がずれるだけ）。星が変わった・形が元に戻った（はね返し）・
 *   大きさが変わったときだけ全部を描き直す（rockFullRedraws）。
 * - 粒は MAX_PARTICLES = 240 まで（超えたら古い粒から吸い込まれたことにする）。1 フレームに出す粒にも上限がある（間引き）。
 * - devicePixelRatio は 2 まで。shadowBlur・filter は使わない。
 * - 動きを減らす設定（prefers-reduced-motion か setCalm(true)）：揺れ・ゆっくり・光の輪なし。粒は 1 マス 1 粒、吸い込まれは直線。
 * - #kakera の跳ね（.bump）は、粒が吸い込まれたときにここで付ける（数は main.js がロジックの値そのままで書く。§13-1）。
 *   opts.onAbsorb(n) を渡すと、吸い込まれた粒の数を 0.1 秒に 1 回まで知らせる（効果音 absorb 用。無くてよい）。
 */
(function (root) {
  "use strict";

  const Lg = () => root.AsteroidLogic || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W = 360, H = 560;
  const MAX_DPR = 2;
  const MAX_PARTICLES = 240;
  const SLOW_MS = 34;
  const SPAWN_BUDGET = 72;          // 1 フレームに新しく出す粒の上限（どかん・はなれたかたまりで一度に数百にしない §13-11）
  const HIT_FX_BUDGET = 24;         // 1 フレームに出す「当たった光」の上限
  const MAT_ID = [null, "rock", "iron", "ice", "gold"];
  const MAT_HP_FALLBACK = { rock: 1, iron: 4, ice: 2, gold: 2 };
  const NAMES_FALLBACK = { shot: "たま", spread: "ちらし", bomb: "どかん", bolt: "いなずま", beam: "ビーム", fire: "ほのお" };
  // しんかの段（Lv 10 ごとに 1 段。最大 4）で弾の太さ・色を変える（U10）。段が上がるほど太く・明るく・色が変わる
  const TIER_COL = {
    shot: ["#ffffff", "#fff4b0", "#ffe27a", "#ffc2d0", "#a8f0ff"],
    spread: ["#ffd84d", "#ffe27a", "#fff0a0", "#c8ffd0", "#a8f0ff"],
    fire: ["#ff5a3c", "#ff7a3c", "#ff9a3c", "#ffc23c", "#ffe07a"]
  };
  const SHOT_COL = { shot: "#ffffff", spread: "#ffd84d", bomb: "#ff9a3c", bolt: "#bfeeff", beam: "#7fd6ff", fire: "#ff5a3c" };
  const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';
  // カメラ（§18.1 A）
  const ROCK_FILL = 0.7;      // 小惑星（の格子）の幅を場の幅のこの割合まで寄せる
  const VIEW_BOT = 548;       // 見せる一番下（地球の上の端 525 より少し下まで）
  const MAX_ZOOM = 2.4;       // 大きな画面（iPad）で寄せすぎない（css px / 単位）
  const TOP_PAD = 6;          // 星の始めに、小惑星の上に空ける見た目の余白

  // マスの色（1 マスごとに 4 段の濃さから選ぶ＝ごつごつ見せる）。模様でも分かる（§6.2）
  const MAT_SHADES = {
    1: ["#8a5a3a", "#94613f", "#9d6945", "#a7714b"],   // いわ（茶）
    2: ["#7f8690", "#8a9099", "#949aa3", "#9da3ab"],   // てつ（灰）
    3: ["#7ec8e8", "#88cfee", "#93d6f2", "#9fdcf5"],   // こおり（水色）
    4: ["#eabd3c", "#f0c645", "#f4cd52", "#f7d460"]    // きん（黄）
  };
  const MAT_EDGE = { 1: "#5e3b24", 2: "#4b5058", 3: "#4f9cc0", 4: "#a87a10" };
  const MAT_HI = { 1: "rgba(255,225,190,0.22)", 2: "rgba(255,255,255,0.25)", 3: "rgba(255,255,255,0.45)", 4: "rgba(255,250,210,0.55)" };
  const PART_COL = { 1: "#c98a5c", 2: "#c3c8cf", 3: "#c8f0ff", 4: "#ffe680" };

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
  function nameOf(id) {
    try {
      const Wp = Lg().WEAPONS;
      if (Array.isArray(Wp)) { const x = Wp.find((q) => q && q.id === id); if (x && typeof x.name === "string" && x.name) return x.name; }
      else if (Wp && typeof Wp === "object" && Wp[id] && typeof Wp[id].name === "string" && Wp[id].name) return Wp[id].name;
    } catch (e) { /* 下の既定 */ }
    return NAMES_FALLBACK[id] || "ぶき";
  }
  // しんかで何が変わったか（画面の真ん中の2行目）。数値の正はロジックの EVOLVE。ここは見せ方の言葉だけ
  function evolveLine(id, lv) {
    // Lv 30 より上は形が変わらず、強さの2倍だけ（ロジックの dmg）
    if (Math.floor(num(lv, 10) / 10) > 3) return "つよさが 2ばいに なった";
    const k = clamp(Math.floor(num(lv, 10) / 10), 1, 3);
    // 連・発の数はロジックの shapeOf（EVOLVE の表）を先に使う
    const sh = typeof Lg().shapeOf === "function" ? Lg().shapeOf(id, num(lv, 10)) : null;
    switch (id) {
      case "shot": return (typeof sh === "number" ? sh : k + 1) + "れんに なった";
      case "spread": return (typeof sh === "number" ? sh : 5 + 2 * k) + "はつに なった";
      case "bomb": return "ばくはつが おおきく なった";
      case "bolt": return "れんさが ふえた";
      case "beam": return "ビームが ふとく なった";
      case "fire": return "ながく もえる ように なった";
      default: return "つよく なった";
    }
  }
  function matHpOf(m) {
    const id = MAT_ID[m];
    try {
      const T = Lg().MAT_HP;
      if (Array.isArray(T)) {
        const v = T.length >= 5 ? T[m] : T[m - 1];
        if (typeof v === "number" && v > 0) return v;
      } else if (T && typeof T === "object") {
        const v = T[id] != null ? T[id] : T[m];
        if (typeof v === "number" && v > 0) return v;
      }
    } catch (e) { /* 下の既定 */ }
    return MAT_HP_FALLBACK[id] || 1;
  }
  // マス1つの最初の体力（ひびの段の目安にだけ使う）。正はロジックの cellHp（星 1〜9 の EARLY_HP・大きな星・星 31〜の増え方も入る。R1）
  function maxHpOf(star, m) {
    const L = Lg();
    if (typeof L.cellHp === "function") {
      try { const v = L.cellHp(Math.max(1, Math.floor(num(star, 1))), MAT_ID[m]); if (typeof v === "number" && v > 0 && Number.isFinite(v)) return v; } catch (e) { /* 下の目安 */ }
    }
    const base = num(L.HP_BASE, 2), g = num(L.HP_GROWTH, 1.2), cap = num(L.STAR_CALC_MAX, 400);
    const n = clamp(Math.floor(num(star, 1)), 1, cap);
    return base * Math.pow(g, n - 1) * matHpOf(m);
  }

  function create(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    const doc = root.document;
    const box = canvas.parentElement || null;
    const mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let calmWanted = !!o.calm;
    let calm = calmWanted || !!(mq && mq.matches);
    const onAbsorb = typeof o.onAbsorb === "function" ? o.onAbsorb : null;
    const rnd = mulberry(7349);

    let cssW = 100, cssH = 156, scale = cssW / W, dpr = 1, pxScale = scale;
    // カメラ：見せる世界の範囲（左上 camL・camT、幅 camW・高さ camH）。scale は css px / 単位
    let camL = 0, camT = 0, camW = W, camH = H, camCols = 10, camRows = 9, camKey = "";
    let roff = 0, occBottom = -1;   // 小惑星の見た目のずれ（単位）と、いま一番下のマスの下の端（ロジックの y）
    let bg = null;
    let frames = 0, slowFrames = 0, lastFrameAt = null, paused = false;
    const drawTimes = [];
    let clk = 0;             // 見た目の時計（秒）
    let lastState = null;

    // 小惑星のオフスクリーン
    let rockCv = null, rctx = null;
    let rockKey = "", rockCols = 0, rockRows = 0, rockStar = 0, rockLeft = -1, rockTotal = -1;
    let known = null;        // 描いてあるマスの材質（Uint8Array）
    let knownCrack = null;   // 描いてあるマスのひびの段
    let evCrack = null;      // events から知ったひびの段（ロジックの定数が読めないとき用）
    let prevMats = null, prevHp = null;
    let rockRedraws = 0, rockFullRedraws = 0;

    // 演出
    let particles = [];      // { x, y, vx, vy, age, home, sx, sy, dur, col, size }
    let ghosts = [];         // はなれたかたまり：{ c, r, m, delay, t }
    let fx = [];             // 短い光：{ kind, t, dur, ... }
    let absorbPending = 0, absorbAt = -1, bumpAt = -1;
    let recoil = 0, pulse = 0, brighten = 0, ring = 0, ringKind = "";
    let barrierWave = 0, slowmo = 0, nearOn = false;   // nearOn：地球まで残り 3 割以下（バリアを赤く強く。U7・Q7）
    let rockLift = 0, rockFade = 1, bounceT = -1;
    let evolveText = null;   // { a, b, t }
    let lastPhase = "";
    let spawnLeft = SPAWN_BUDGET, hitFxLeft = HIT_FX_BUDGET;
    let fighterX = W / 2, fighterY = num(Lg().FIGHTER_Y, 500);
    let lastBreakX = W / 2, lastBreakY = 200;   // 最後に欠けたマス（クリアの星の光）

    function el(id) { try { return doc ? doc.getElementById(id) : null; } catch (e) { return null; } }
    const kakeraEl = el("kakera");
    if (kakeraEl && kakeraEl.addEventListener) kakeraEl.addEventListener("animationend", () => kakeraEl.classList.remove("bump"));
    if (mq) {
      const onMq = () => { calm = calmWanted || mq.matches; };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    let lw = -1, lh = -1;
    function relayout() {
      if (!box) return;
      const w = box.clientWidth, h = box.clientHeight;
      if (w === lw && h === lh) return;
      lw = w; lh = h;
      layout(w, h);
      if (lastState) {
        const rk = lastState.rock;
        placeRock(rk);
        if (rk && typeof rk === "object" && !ensureRock(rk, num(lastState.star, 1))) syncRock(rk, num(lastState.star, 1));
        draw(lastState);
      }
    }
    if (root.ResizeObserver && box) new root.ResizeObserver(relayout).observe(box);
    else if (box && root.addEventListener) {
      // ResizeObserver が無い古い端末：画面の大きさ・向きが変わったときに layout し直す（T6）
      root.addEventListener("resize", relayout);
      root.addEventListener("orientationchange", () => { relayout(); if (root.setTimeout) root.setTimeout(relayout, 300); });
    }

    // ===== 大きさ =====
    // canvas を箱いっぱいに広げる（縦横比は箱のまま）。見せる範囲は setCam が星の大きさから決める
    function layout(cssWidth, cssHeight) {
      const bw = box ? box.clientWidth : 0, bh = box ? box.clientHeight : 0;
      cssW = Math.max(40, Math.floor(num(cssWidth, 0) > 0 ? cssWidth : bw || 320));
      cssH = Math.max(60, Math.floor(num(cssHeight, 0) > 0 ? cssHeight : bh || 480));
      dpr = Math.min(MAX_DPR, Math.max(1, num(root.devicePixelRatio, 1)));
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      const wpx = Math.round(cssW * dpr), hpx = Math.round(cssH * dpr);
      if (canvas.width !== wpx) canvas.width = wpx;
      if (canvas.height !== hpx) canvas.height = hpx;
      camKey = "";
      setCam(camCols, camRows);
      return { scale, width: cssW, height: cssH };
    }
    // 星の格子（cols×rows）に合わせて見せる範囲を決める（星が変わったとき・大きさが変わったときだけ）
    function setCam(cols, rows) {
      const key = cols + "|" + rows + "|" + cssW + "|" + cssH + "|" + dpr;
      if (key === camKey) return false;
      camKey = key; camCols = cols; camRows = rows;
      const C = num(Lg().CELL, 14), BY = num(Lg().BARRIER_Y, 470);
      const rw = Math.max(1, cols) * C, rh = Math.max(1, rows) * C;
      // 縦に要る高さ：バリアから下（地球の端まで）＋小惑星の高さ＋近づく道のり（小惑星の半分、70 単位以上）
      const need = (VIEW_BOT - BY) + rh + Math.max(70, rh * 0.5);
      const sFull = cssH / VIEW_BOT;                     // 世界の上から下まで（0〜VIEW_BOT）が入る大きさ
      const sH = Math.max(cssH / need, sFull);
      const sW = (ROCK_FILL * cssW) / rw;
      scale = Math.max(0.05, Math.min(sH, sW, MAX_ZOOM));
      camW = cssW / scale; camH = cssH / scale;
      let bot = VIEW_BOT;
      const top0 = bot - camH;
      if (top0 < 0) bot += Math.min(-top0, H - VIEW_BOT);   // 縦に余るときは地球を少し多めに見せる
      camT = bot - camH;
      camL = W / 2 - camW / 2;
      pxScale = scale * dpr;
      drawBg();
      rockKey = "";            // 大きさが変わったのでマスを全部描き直す
      return true;
    }
    // 世界の座標 → canvas の座標の変換を入れる
    function camTransform(g) { g.setTransform(pxScale, 0, 0, pxScale, -camL * pxScale, -camT * pxScale); }
    // 小惑星の見た目のずれ（単位）。格子の下の端（ロジック）が始めの位置なら最大、バリアに届けば 0
    function rockOffsetOf(rock) {
      const C = num(Lg().CELL, 14), BY = num(Lg().BARRIER_Y, 470), B0 = num(Lg().START_BOTTOM, 120);
      const rows = Math.max(1, num(rock.rows, 1) | 0);
      const v0 = Math.min(BY - 2 * C, Math.max(B0, camT + TOP_PAD + rows * C));
      if (!(v0 > B0)) return 0;
      const gb = num(rock.y, 0) + rows * C;
      return (v0 - B0) * clamp((BY - gb) / (BY - B0), 0, 1);
    }
    function bottomOf(rock) {
      const C = num(Lg().CELL, 14);
      const cols = Math.max(1, num(rock.cols, 1) | 0), rows = Math.max(0, num(rock.rows, 0) | 0), mats = rock.mats;
      if (!mats) return -1;
      for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols; c++) if (mats[r * cols + c]) return num(rock.y, 0) + (r + 1) * C;
      return -1;
    }
    // 弾などの y（ロジック）→ 見た目の y。戦闘機の所は 0、小惑星の一番下より上は小惑星と同じだけずらす
    function mapY(y) {
      if (!roff || occBottom < 0) return y;
      const FY = fighterY;
      const den = FY - occBottom;
      const k = den > 1 ? clamp((FY - y) / den, 0, 1) : 1;
      return y + roff * k;
    }

    // ===== 背景（大きさが変わったときだけ）=====
    function drawBg() {
      if (!doc) return;
      if (!bg) bg = doc.createElement("canvas");
      bg.width = canvas.width; bg.height = canvas.height;
      const c = bg.getContext("2d");
      camTransform(c);
      const vb = camT + camH;
      const g = c.createLinearGradient(0, camT, 0, vb);
      g.addColorStop(0, "#060a1e"); g.addColorStop(0.7, "#0e1538"); g.addColorStop(1, "#18245a");
      c.fillStyle = g; c.fillRect(camL, camT, camW, camH);
      const r = mulberry(1203);
      // 星の数は見せる広さに合わせる（寄せても空が寂しくならないよう、1 画面に 60〜160 個）
      const sh = Math.max(10, Math.min(470, vb) - camT);
      const nStars = Math.round(clamp(90 * (camW * sh) / (W * 470), 60, 160));
      const sz = 1 / Math.max(0.6, Math.min(2, scale));   // 寄せても点が大きくなりすぎない
      for (let k = 0; k < nStars; k++) {
        const x = camL + r() * camW, y = camT + r() * sh, s = (r() < 0.12 ? 1.6 : r() < 0.5 ? 1.1 : 0.7) * sz;
        c.globalAlpha = 0.35 + r() * 0.6;
        c.fillStyle = r() < 0.15 ? "#ffe9a8" : "#ffffff";
        c.fillRect(x, y, s, s);
      }
      c.globalAlpha = 1;
      // 遠くの小さな星雲（色の帯。ぼかしは使わない）
      c.fillStyle = "rgba(120,90,200,0.08)";
      c.beginPath(); c.ellipse(80, 140, 120, 40, -0.4, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(60,140,200,0.07)";
      c.beginPath(); c.ellipse(280, 300, 110, 34, 0.5, 0, Math.PI * 2); c.fill();
      // 地球（下の弧。青と緑）
      const ex = W / 2, ey = 1420, er = 895;     // てっぺん y = 525
      c.fillStyle = "#1d5fb8";
      c.beginPath(); c.arc(ex, ey, er, 0, Math.PI * 2); c.fill();
      c.save();
      c.beginPath(); c.arc(ex, ey, er, 0, Math.PI * 2); c.clip();
      c.fillStyle = "#3d9fe0"; c.fillRect(0, 524, W, 6);
      c.fillStyle = "#42b866";
      blob(c, 40, 540, 46, 10); blob(c, 150, 532, 34, 7); blob(c, 250, 546, 60, 12); blob(c, 340, 536, 30, 8);
      c.fillStyle = "#e9f6ff";
      blob(c, 100, 530, 22, 3); blob(c, 300, 529, 26, 3);
      c.restore();
      // 大気の縁
      c.strokeStyle = "rgba(140,210,255,0.55)"; c.lineWidth = 2;
      c.beginPath(); c.arc(ex, ey, er + 1, Math.PI * 1.25, Math.PI * 1.75); c.stroke();
    }
    function blob(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }

    // ===== 小惑星のオフスクリーン =====
    function cellPx(k) { return Math.round(k * num(Lg().CELL, 14) * pxScale); }
    function ensureRock(rock, star) {
      const cols = clamp(Math.floor(num(rock.cols, 0)), 0, 64), rows = clamp(Math.floor(num(rock.rows, 0)), 0, 64);
      const total = num(rock.total, -1), left = num(rock.left, -1);
      const key = star + "|" + cols + "|" + rows + "|" + total + "|" + pxScale;
      const reset = key !== rockKey || (rockLeft >= 0 && left > rockLeft);
      rockLeft = left; rockTotal = total;
      if (!reset) return false;
      rockKey = key; rockCols = cols; rockRows = rows; rockStar = star;
      if (!doc) return true;
      if (!rockCv) { rockCv = doc.createElement("canvas"); rctx = rockCv.getContext("2d"); }
      const w = Math.max(1, cellPx(cols)), h = Math.max(1, cellPx(rows));
      if (rockCv.width !== w) rockCv.width = w;
      if (rockCv.height !== h) rockCv.height = h;
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.clearRect(0, 0, w, h);
      const n = cols * rows;
      known = new Uint8Array(n);
      knownCrack = new Uint8Array(n);
      evCrack = new Uint8Array(n);
      prevMats = null; prevHp = null;
      const mats = rock.mats, hp = rock.hp;
      if (mats && mats.length >= n) {
        for (let i = 0; i < n; i++) {
          const m = mats[i] | 0;
          if (m >= 1 && m <= 4) {
            known[i] = m;
            knownCrack[i] = crackOf(i, m, hp, star);
            paintCell(i, m, knownCrack[i]);
          }
        }
      }
      prevMats = mats; prevHp = hp;
      rockFullRedraws++;
      rockRedraws++;
      return true;
    }
    // マス i の最初の体力。ロジックに cellHpAt(state, i) があればそれ（行ごとの倍率「もろい底」rock.rowHp も入る）、
    // 無ければ cellHp(star, mat) × rock.rowHp[行]（R1。cellHp だけで割ると底の行が最初からひびだらけに見える）
    function maxHpAt(i, m, star) {
      const L = Lg(), st = lastState;
      if (typeof L.cellHpAt === "function" && st && st.rock) {
        try { const v = L.cellHpAt(st, i); if (typeof v === "number" && v > 0 && Number.isFinite(v)) return v; } catch (e) { /* 下の式 */ }
      }
      let k = 1;
      const rk = st && st.rock;
      if (rk && Array.isArray(rk.rowHp)) {
        const r = Math.floor(i / Math.max(1, num(rk.cols, 1) | 0));
        const v = rk.rowHp[r];
        if (typeof v === "number" && v > 0 && Number.isFinite(v)) k = v;
      }
      return maxHpOf(star, m) * k;
    }
    function crackOf(i, m, hp, star) {
      if (matHpOf(m) < 2) return 0;           // かたいマス（てつ・こおり・きん）だけ ひび が入る
      let c = evCrack ? evCrack[i] : 0;
      if (hp && typeof hp[i] === "number") {
        const f = hp[i] / maxHpAt(i, m, star);
        if (Number.isFinite(f)) c = Math.max(c, f <= 0.25 ? 3 : f <= 0.5 ? 2 : f <= 0.75 ? 1 : 0);
      }
      return clamp(c | 0, 0, 3);
    }
    function paintCell(i, m, crack) {
      if (!rctx) return;
      const c = i % rockCols, r = (i / rockCols) | 0;
      const x0 = cellPx(c), x1 = cellPx(c + 1), y0 = cellPx(r), y1 = cellPx(r + 1);
      const w = x1 - x0, h = y1 - y0;
      const g = rctx;
      g.clearRect(x0, y0, w, h);
      if (!m) return;
      const hv = hash(i, rockStar);
      const ins = Math.max(0.5, w * 0.05);
      const x = x0 + ins, y = y0 + ins, ww = w - ins * 2, hh = h - ins * 2;
      const rad = Math.min(ww, hh) * 0.2;
      g.fillStyle = MAT_SHADES[m][hv & 3];
      roundRect(g, x, y, ww, hh, rad); g.fill();
      // 立体感：上と左に明るい縁、下に暗い縁
      g.fillStyle = MAT_HI[m];
      g.fillRect(x + rad * 0.6, y + 0.5, ww - rad * 1.2, Math.max(1, hh * 0.12));
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(x + rad * 0.6, y + hh - Math.max(1, hh * 0.12) - 0.5, ww - rad * 1.2, Math.max(1, hh * 0.12));
      const lw = Math.max(1, w * 0.07);
      if (m === 1) {
        // いわ：小さなくぼみ（模様なしの扱い。ごつごつ感だけ）
        if ((hv >> 3) & 1) { g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(x + ww * 0.55, y + hh * 0.5, ww * 0.18, hh * 0.16); }
      } else if (m === 2) {
        // てつ：細い格子
        g.strokeStyle = MAT_EDGE[2]; g.lineWidth = lw;
        g.beginPath();
        for (let k = 1; k <= 2; k++) {
          const px = x + (ww * k) / 3, py = y + (hh * k) / 3;
          g.moveTo(px, y + 1); g.lineTo(px, y + hh - 1);
          g.moveTo(x + 1, py); g.lineTo(x + ww - 1, py);
        }
        g.stroke();
      } else if (m === 3) {
        // こおり：斜めの線
        g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = lw;
        g.beginPath();
        g.moveTo(x + ww * 0.15, y + hh * 0.55); g.lineTo(x + ww * 0.55, y + hh * 0.15);
        g.moveTo(x + ww * 0.45, y + hh * 0.85); g.lineTo(x + ww * 0.85, y + hh * 0.45);
        g.stroke();
      } else if (m === 4) {
        // きん：小さな星の印
        g.fillStyle = "#fff6c8";
        star5(g, x + ww / 2, y + hh / 2, Math.min(ww, hh) * 0.34, Math.min(ww, hh) * 0.15);
        g.strokeStyle = MAT_EDGE[4]; g.lineWidth = Math.max(0.5, lw * 0.6); g.stroke();
      }
      g.strokeStyle = MAT_EDGE[m]; g.lineWidth = Math.max(0.5, w * 0.05);
      roundRect(g, x, y, ww, hh, rad); g.stroke();
      // ひび：1〜3 本（マスごとに決まった形）
      if (crack > 0) {
        g.strokeStyle = "rgba(20,12,8,0.85)"; g.lineWidth = Math.max(1, w * 0.08);
        g.beginPath();
        for (let k = 0; k < crack; k++) {
          const s = hash(i * 7 + k, 991);
          const ax = x + ww * (0.15 + ((s & 15) / 15) * 0.7), ay = y + (k % 2 ? hh * 0.9 : hh * 0.1);
          const mx = x + ww * (0.3 + (((s >> 4) & 15) / 15) * 0.4), my = y + hh * 0.5;
          const bx = x + (k === 1 ? ww * 0.9 : ww * 0.1), by = y + hh * (0.2 + (((s >> 8) & 15) / 15) * 0.6);
          g.moveTo(ax, ay); g.lineTo(mx, my); g.lineTo(bx, by);
        }
        g.stroke();
      }
    }
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.closePath();
    }
    function star5(g, cx, cy, R, r) {
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r : R;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    }
    // 変わったマスだけ描き直す（mats・hp の配列が写されたときだけ調べる＝コピーオンライト）
    function syncRock(rock, star) {
      if (!known) return;
      const n = rockCols * rockRows;
      const mats = rock.mats, hp = rock.hp;
      if (!mats || mats.length < n) return;
      if (mats === prevMats && hp === prevHp) return;
      for (let i = 0; i < n; i++) {
        const m = mats[i] | 0;
        const km = known[i];
        // はね返しなどで体力が戻ったマスは、events で知ったひびを忘れる（ひびが残らない。T8）
        if (evCrack && prevHp && hp && typeof hp[i] === "number" && typeof prevHp[i] === "number" && hp[i] > prevHp[i]) evCrack[i] = 0;
        if (m !== km) {
          known[i] = m >= 1 && m <= 4 ? m : 0;
          knownCrack[i] = known[i] ? crackOf(i, known[i], hp, star) : 0;
          paintCell(i, known[i], knownCrack[i]);
          rockRedraws++;
        } else if (km) {
          const cr = crackOf(i, km, hp, star);
          if (cr !== knownCrack[i]) { knownCrack[i] = cr; paintCell(i, km, cr); rockRedraws++; }
        }
      }
      prevMats = mats; prevHp = hp;
    }

    // ===== 座標 =====
    function cellCenter(rock, i) {
      const C = num(Lg().CELL, 14);
      const cols = Math.max(1, num(rock.cols, 1) | 0);
      const c = i % cols, r = (i / cols) | 0;
      return { x: num(rock.x, 0) + (c + 0.5) * C, y: num(rock.y, 0) + (r + 0.5) * C + rockLift + roff };
    }

    // ===== 粒 =====
    function addParticle(x, y, col, spread) {
      if (spawnLeft <= 0) return;
      spawnLeft--;
      if (particles.length >= MAX_PARTICLES) {
        // 古い粒から吸い込まれたことにする
        particles.shift();
        absorbed(1);
      }
      const a = rnd() * Math.PI * 2, sp = calm ? 0 : (40 + rnd() * 90) * (spread || 1);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (calm ? 0 : 20), age: 0, home: calm ? 0.0001 : 0, sx: 0, sy: 0, dur: calm ? 0.5 : 0.6, col, size: 2.6 + rnd() * 1.8 });
      const p = particles[particles.length - 1];
      if (calm) { p.sx = x; p.sy = y; }
    }
    function absorbed(n) {
      absorbPending += n;
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
    function stepParticles(dt) {
      const fx0 = fighterX, fy0 = fighterY - 4;
      let w = 0;
      for (let k = 0; k < particles.length; k++) {
        const p = particles[k];
        p.age += dt;
        if (!p.home) {
          // 飛び散る（0.22 秒、だんだん遅く）
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 0.9; p.vy *= 0.9;
          if (p.age >= 0.22) { p.home = 0.0001; p.sx = p.x; p.sy = p.y; p.age = 0; }
          particles[w++] = p;
          continue;
        }
        // 吸い込まれる（0.6 秒の曲線。calm は直線）
        const t = clamp(p.age / p.dur, 0, 1);
        if (t >= 1) { absorbed(1); continue; }
        const e = t * t * (3 - 2 * t);
        if (calm) {
          p.x = p.sx + (fx0 - p.sx) * e; p.y = p.sy + (fy0 - p.sy) * e;
        } else {
          const cx = p.sx + (p.sx < fx0 ? -40 : 40), cy = (p.sy + fy0) / 2 - 20;
          const u = 1 - e;
          p.x = u * u * p.sx + 2 * u * e * cx + e * e * fx0;
          p.y = u * u * p.sy + 2 * u * e * cy + e * e * fy0;
        }
        particles[w++] = p;
      }
      particles.length = w;
    }

    // ===== events =====
    function onEvents(state, events) {
      if (!Array.isArray(events) || !events.length) return;
      const rock = state && state.rock;
      let breaks = 0;
      for (const ev of events) if (ev && (ev.kind === "break")) breaks++;
      // 1 フレームに欠けたマスが多いときは 1 マスの粒を減らす（間引き）
      const perBreak = calm ? 1 : breaks > 24 ? 1 : breaks > 8 ? 2 : 3;
      for (const ev of events) {
        if (!ev || typeof ev.kind !== "string") continue;
        switch (ev.kind) {
          case "fire": {
            recoil = calm ? 0 : 3;
            if (ev.w === "bomb" && !calm) fx.push({ kind: "muzzle", t: 0, dur: 0.12, x: fighterX, y: fighterY - 14 });
            break;
          }
          case "hit": {
            if (!rock) break;
            const i = ev.i | 0;
            if (evCrack && i >= 0 && i < evCrack.length && typeof ev.crack === "number") evCrack[i] = Math.max(evCrack[i], clamp(ev.crack | 0, 0, 3));
            // 得意（aff>1）は大きく明るい星形の火花、苦手（aff<1）は小さな灰色の点、ふつうは今までどおり（Q5）。fx だけで粒は増やさない
            if (hitFxLeft > 0) { hitFxLeft--; const p = cellCenter(rock, i); const af = num(ev.aff, 1); fx.push({ kind: "hit", t: 0, dur: af > 1 ? 0.2 : 0.1, x: p.x, y: p.y, crack: ev.crack | 0, aff: af > 1.0001 ? 1 : af < 0.9999 ? -1 : 0 }); }
            break;
          }
          case "break": {
            if (!rock) break;
            const p = cellCenter(rock, ev.i | 0);
            const m = known && known[ev.i | 0] ? known[ev.i | 0] : matNum(ev.mat);
            for (let k = 0; k < perBreak; k++) addParticle(p.x, p.y, PART_COL[m] || "#ffffff", 1);
            if (m === 4 && !calm) fx.push({ kind: "spark", t: 0, dur: 0.35, x: p.x, y: p.y });
            break;
          }
          case "chunk": {
            if (!rock || !Array.isArray(ev.cells)) break;
            const cols = Math.max(1, num(rock.cols, 1) | 0);
            const cells = ev.cells.slice(0, 600);
            if (calm) {
              for (const i of cells) { const p = cellCenter(rock, i | 0); addParticle(p.x, p.y, PART_COL[(known && known[i | 0]) || 1], 1); }
              break;
            }
            // 外側から 0.3 秒で崩す：真ん中からの距離が遠いほど早く
            let sx = 0, sy = 0;
            for (const i of cells) { sx += (i | 0) % cols; sy += ((i | 0) / cols) | 0; }
            sx /= Math.max(1, cells.length); sy /= Math.max(1, cells.length);
            let dmax = 0.001;
            const ds = cells.map((i) => { const d = Math.hypot(((i | 0) % cols) - sx, (((i | 0) / cols) | 0) - sy); if (d > dmax) dmax = d; return d; });
            cells.forEach((i, k) => {
              ghosts.push({ c: (i | 0) % cols, r: ((i | 0) / cols) | 0, m: (known && known[i | 0]) || 1, delay: 0.08 + (1 - ds[k] / dmax) * 0.3, t: 0 });
            });
            fx.push({ kind: "chunkFlash", t: 0, dur: 0.12 });
            break;
          }
          case "bolt": {
            if (!rock || !Array.isArray(ev.path) || !ev.path.length) break;
            const pts = [{ x: fighterX, y: fighterY - 12 }];
            for (const i of ev.path.slice(0, 40)) pts.push(cellCenter(rock, i | 0));
            fx.push({ kind: "bolt", t: 0, dur: 0.18, pts, seed: (rnd() * 1e6) | 0, tier: tierOf(state, "bolt") });
            break;
          }
          case "boom": {
            const C = num(Lg().CELL, 14);
            let r = num(ev.r, 1.5);
            if (r < 6) r *= C;                     // マスの数で来たら単位に直す
            fx.push({ kind: "boom", t: 0, dur: 0.35, x: num(ev.x, W / 2), y: mapY(num(ev.y, 200)) + rockLift, r });
            break;
          }
          case "beam": {
            const C = num(Lg().CELL, 14);
            let w = num(ev.w, 1);
            if (w < 6) w *= C;
            fx.push({ kind: "beam", t: 0, dur: 0.4, x: num(ev.x, fighterX), w });
            break;
          }
          case "burn": break;   // 燃えているマスは state.burns から毎フレーム描く
          case "evolve": {
            const sl = state && Array.isArray(state.slots) ? state.slots[ev.slot | 0] : null;
            const id = sl && sl.id;
            evolveText = { a: nameOf(id) + "が しんか！", b: evolveLine(id, ev.lv), t: 0 };
            burst("evolve");
            break;
          }
          case "clear": burst("clear"); break;
          case "bounce": burst("bounce"); break;
          case "ending": burst("end"); break;
          case "boss": if (!calm) fx.push({ kind: "bossFlash", t: 0, dur: 0.8 }); break;
          default: break;
        }
      }
    }
    function matNum(id) { const k = MAT_ID.indexOf(id); return k > 0 ? k : 1; }

    // ===== 演出のきっかけ（ボタンを押したとき。0.1 秒以内に目に見える返事 §6.3）=====
    function burst(kind) {
      switch (kind) {
        case "up": pulse = 1; brighten = 0.5; break;
        case "evolve": pulse = 1; brighten = 1; if (!calm) { ring = 1; ringKind = "evolve"; } break;
        case "unlock": pulse = 1; if (!calm) { ring = 1; ringKind = "unlock"; } break;
        case "clear": {
          if (!calm) slowmo = 0.4;
          fx.push({ kind: "star", t: 0, dur: calm ? 0.6 : 1.2, x: lastBreakX, y: lastBreakY });
          break;
        }
        case "bounce": barrierWave = 1; bounceT = 0; break;
        case "end": if (!calm) { ring = 1; ringKind = "end"; } fx.push({ kind: "endGlow", t: 0, dur: 2.5 }); break;
        default: break;
      }
    }
    // ===== 1 フレーム =====
    function frame(state, events, dtSec) {
      const t0 = root.performance && performance.now ? performance.now() : Date.now();
      if (lastFrameAt != null && !paused && t0 - lastFrameAt > SLOW_MS) slowFrames++;
      lastFrameAt = t0;
      frames++;
      if (!state || typeof state !== "object") return;
      lastState = state;
      let dt = clamp(num(dtSec, 1 / 60), 0, 0.1);
      if (paused) dt = 0;
      spawnLeft = SPAWN_BUDGET; hitFxLeft = HIT_FX_BUDGET;
      const rock = state.rock;
      if (state.fighter) { fighterX = num(state.fighter.x, fighterX); fighterY = num(state.fighter.y, fighterY); }
      placeRock(rock);
      // 最後に欠けたマスの位置（クリアの星の光に使う）
      if (Array.isArray(events) && rock) {
        for (let k = events.length - 1; k >= 0; k--) {
          const e = events[k];
          if (e && e.kind === "break") { const p = cellCenter(rock, e.i | 0); lastBreakX = p.x; lastBreakY = p.y; break; }
        }
      }
      // マス（events の粒より先に：粒の色をまだ描いてあるマスから取る）
      onEvents(state, events);
      if (rock && typeof rock === "object") {
        if (!ensureRock(rock, num(state.star, 1))) syncRock(rock, num(state.star, 1));
      }
      // 演出の時計（クリアのときだけ少しゆっくり）
      let vdt = dt;
      if (slowmo > 0) { slowmo = Math.max(0, slowmo - dt); vdt = dt * 0.35; }
      clk += vdt;
      advanceFx(vdt, state);
      stepParticles(vdt);
      flushAbsorb();
      draw(state);
      const t1 = root.performance && performance.now ? performance.now() : Date.now();
      drawTimes.push(t1 - t0);
      if (drawTimes.length > 120) drawTimes.shift();
    }
    // 星の格子に合わせてカメラを決め、小惑星の見た目のずれを出す（毎フレーム。重い計算はしない）
    function placeRock(rock) {
      if (!rock || typeof rock !== "object") { roff = 0; occBottom = -1; return; }
      const cols = clamp(Math.floor(num(rock.cols, 0)), 1, 64), rows = clamp(Math.floor(num(rock.rows, 0)), 1, 64);
      setCam(cols, rows);
      roff = rockOffsetOf(rock);
      occBottom = bottomOf(rock);
    }
    function advanceFx(dt, state) {
      recoil = Math.max(0, recoil - dt * 30);
      pulse = Math.max(0, pulse - dt * 3);
      brighten = Math.max(0, brighten - dt * 2);
      ring = Math.max(0, ring - dt * 1.2);
      barrierWave = Math.max(0, barrierWave - dt * 0.8);
      let w = 0;
      for (const f of fx) { f.t += dt; if (f.t < f.dur) fx[w++] = f; }
      fx.length = w;
      if (evolveText) { evolveText.t += dt; if (evolveText.t > 1.8) evolveText = null; }
      // はなれたかたまり：時間が来たマスから粒になる
      if (ghosts.length) {
        const rock = state.rock;
        let g = 0;
        for (const h of ghosts) {
          h.t += dt;
          if (h.t >= h.delay) {
            if (rock) { const C = num(Lg().CELL, 14); addParticle(num(rock.x, 0) + (h.c + 0.5) * C, num(rock.y, 0) + (h.r + 0.5) * C + rockLift + roff, PART_COL[h.m] || "#fff", 1.3); }
            continue;
          }
          ghosts[g++] = h;
        }
        ghosts.length = g;
      }
      // はね返し：上へ押し戻して薄くなる → 形が元に戻ったら（ロジック）また見える
      const phase = state.phase;
      if (bounceT >= 0) {
        bounceT += dt;
        if (!calm) {
          const k = clamp(bounceT / 0.6, 0, 1);
          rockLift = -70 * (1 - (1 - k) * (1 - k));
        } else rockLift = 0;
        rockFade = clamp(1 - (bounceT - 0.4) / 0.6, 0, 1);
        if (phase !== "bounce" && bounceT > 0.2) { bounceT = -1; rockLift = 0; rockFade = 1; }
        else if (bounceT > 2.4) { bounceT = -1; rockLift = 0; rockFade = 1; }
      }
      if (phase === "bounce" && lastPhase !== "bounce" && bounceT < 0) { barrierWave = 1; bounceT = 0; }
      lastPhase = phase;
    }

    // ===== 描く =====
    function draw(state) {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) ctx.drawImage(bg, 0, 0);
      else { ctx.fillStyle = "#0e1538"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      camTransform(ctx);
      const rock = state && state.rock;
      // 大きな星の始め：空が少し赤く光る
      for (const f of fx) if (f.kind === "bossFlash") { ctx.globalAlpha = 0.18 * (1 - f.t / f.dur); ctx.fillStyle = "#ff7a5c"; ctx.fillRect(camL, camT, camW, camH); ctx.globalAlpha = 1; }
      drawBarrier();
      // ビーム（小惑星の下に）
      for (const f of fx) if (f.kind === "beam") drawBeam(f);
      // 小惑星
      if (rock && rockCv && rockCols > 0) {
        const x = num(rock.x, 0), y = num(rock.y, 0) + rockLift + roff;
        if (rockFade > 0) {
          if (rockFade < 1) ctx.globalAlpha = rockFade;
          ctx.drawImage(rockCv, x, y, rockCv.width / pxScale, rockCv.height / pxScale);
          ctx.globalAlpha = 1;
          drawBurns(state, rock);
          drawGhosts(rock);
        }
      }
      // 当たった光・どかんの輪・いなずま・ほし
      for (const f of fx) {
        const k = f.t / f.dur;
        if (f.kind === "hit") {
          if (f.aff > 0) {
            // 得意：大きく明るい星形の火花（広がって消える）
            ctx.globalAlpha = 1 - k; ctx.fillStyle = "#fff6c8";
            star5(ctx, f.x, f.y, 8 + 7 * k + (f.crack ? 2 : 0), 3.2 + 2 * k);
            ctx.fillStyle = "#ffffff"; ctx.globalAlpha = (1 - k) * 0.9;
            ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
          } else if (f.aff < 0) {
            // 苦手：小さな灰色の点
            ctx.globalAlpha = 0.7 * (1 - k); ctx.fillStyle = "#8d93a6";
            ctx.fillRect(f.x - 1.5, f.y - 1.5, 3, 3);
          } else {
            ctx.globalAlpha = 0.6 * (1 - k); ctx.fillStyle = "#ffffff";
            const s = 6 + (f.crack ? 2 : 0);
            ctx.fillRect(f.x - s / 2, f.y - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        } else if (f.kind === "boom") {
          ctx.globalAlpha = 0.85 * (1 - k);
          ctx.fillStyle = "rgba(255,154,60,0.35)";
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffb35c"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (f.kind === "bolt") drawBolt(f);
        else if (f.kind === "spark") {
          ctx.globalAlpha = 1 - k; ctx.fillStyle = "#fff6c8";
          star5(ctx, f.x, f.y, 6 + 6 * k, 2.5); ctx.globalAlpha = 1;
        } else if (f.kind === "star") {
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = "#ffe680";
          star5(ctx, f.x, f.y, 14 + 70 * k, 6 + 28 * k);
          ctx.fillStyle = "#ffffff";
          star5(ctx, f.x, f.y, 6 + 30 * k, 3 + 12 * k);
          ctx.globalAlpha = 1;
        } else if (f.kind === "muzzle") {
          ctx.globalAlpha = 1 - k; ctx.fillStyle = "#ffd9a8";
          ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      drawShots(state);
      drawParticles();
      drawFighter();
      drawEnd();
      drawEvolveText();
    }
    function drawBarrier() {
      const by = num(Lg().BARRIER_Y, 470);
      const ex = W / 2, R = 1530, ey = by + R;
      const wv = barrierWave;
      // 見せる幅いっぱいに弧を引く（寄せたときも、広く見せるときも端まで）
      const half = Math.asin(clamp((camW / 2 + 16) / R, 0.05, 0.99));
      const a = 0.35 + (calm ? 0 : 0.08 * Math.sin(clk * 2.2)) + wv * 0.5 + (nearOn ? 0.25 + (calm ? 0 : 0.2 * Math.sin(clk * 7)) : 0);
      ctx.strokeStyle = (nearOn ? "rgba(255,150,120," : "rgba(127,214,255,") + clamp(a, 0, 1).toFixed(3) + ")";
      ctx.lineWidth = 2 + wv * 3 + (nearOn ? 1.5 : 0);
      ctx.beginPath();
      if (wv > 0 && !calm) {
        // 波打つ弧
        const x0 = Math.floor((camL - 12) / 12) * 12, x1 = camL + camW + 12;
        for (let x = x0; x <= x1; x += 12) {
          const base = ey - Math.sqrt(R * R - (x - ex) * (x - ex));
          const y = base + Math.sin(x * 0.06 - clk * 14) * 5 * wv;
          if (x !== x0) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
      } else {
        ctx.arc(ex, ey, R, Math.PI * 1.5 - half, Math.PI * 1.5 + half);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(127,214,255,0.12)";
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(ex, ey + 6, R, Math.PI * 1.5 - half, Math.PI * 1.5 + half); ctx.stroke();
    }
    function drawBeam(f) {
      const k = f.t / f.dur;
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      ctx.globalAlpha = clamp(a, 0, 1) * 0.55;
      ctx.fillStyle = "#7fd6ff";
      ctx.fillRect(f.x - f.w / 2, camT, f.w, fighterY - 10 - camT);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.x - f.w * 0.15, camT, f.w * 0.3, fighterY - 10 - camT);
      ctx.globalAlpha = 1;
    }
    function drawBolt(f) {
      const k = f.t / f.dur;
      const r = mulberry(f.seed + ((f.t * 30) | 0));
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.lineJoin = "round";
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? "#ffffff" : "#7fd6ff";
        ctx.lineWidth = pass ? 1.2 + 0.3 * (f.tier || 0) : 3.5 + 0.8 * (f.tier || 0);
        ctx.beginPath();
        for (let k2 = 0; k2 < f.pts.length; k2++) {
          const p = f.pts[k2];
          if (!k2) { ctx.moveTo(p.x, p.y); continue; }
          const q = f.pts[k2 - 1];
          const mx = (p.x + q.x) / 2 + (r() - 0.5) * 8, my = (p.y + q.y) / 2 + (r() - 0.5) * 8;
          ctx.lineTo(mx, my); ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawBurns(state, rock) {
      const burns = state.burns;
      if (!Array.isArray(burns) || !burns.length) return;
      const C = num(Lg().CELL, 14);
      ctx.fillStyle = "#ff6a3c";
      ctx.beginPath();
      const n = Math.min(burns.length, 200);
      for (let k = 0; k < n; k++) {
        const b = burns[k];
        if (!b) continue;
        const p = cellCenter(rock, b.i | 0);
        const fl = calm ? 0 : Math.sin(clk * 18 + k) * 1.5;
        ctx.moveTo(p.x - C * 0.28, p.y + C * 0.3);
        ctx.lineTo(p.x, p.y - C * 0.35 - fl);
        ctx.lineTo(p.x + C * 0.28, p.y + C * 0.3);
        ctx.closePath();
      }
      ctx.fill();
      ctx.fillStyle = "#ffd84d";
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const b = burns[k];
        if (!b) continue;
        const p = cellCenter(rock, b.i | 0);
        ctx.moveTo(p.x - C * 0.13, p.y + C * 0.28);
        ctx.lineTo(p.x, p.y - C * 0.08);
        ctx.lineTo(p.x + C * 0.13, p.y + C * 0.28);
        ctx.closePath();
      }
      ctx.fill();
    }
    function drawGhosts(rock) {
      if (!ghosts.length) return;
      const C = num(Lg().CELL, 14);
      const ox = num(rock.x, 0), oy = num(rock.y, 0) + rockLift + roff;
      for (const h of ghosts) {
        // はじめは白く光り、崩れる直前に少し揺れる
        const k = h.t / h.delay;
        ctx.fillStyle = k < 0.35 ? "#ffffff" : MAT_SHADES[h.m][1];
        const j = k > 0.6 ? (rnd() - 0.5) * 2 : 0;
        ctx.fillRect(ox + h.c * C + 1 + j, oy + h.r * C + 1, C - 2, C - 2);
      }
    }
    function tierOf(state, id) {
      const sl = state && state.slots;
      if (Array.isArray(sl)) for (const x of sl) if (x && x.id === id) return clamp(Math.floor(num(x.lv, 1) / 10), 0, 4);
      return 0;
    }
    function drawShots(state) {
      const shots = state && state.shots;
      if (!Array.isArray(shots) || !shots.length) return;
      const n = Math.min(shots.length, num(Lg().SHOTS_MAX, 120));
      const glow = brighten > 0;
      // 色ごとにまとめて描く（fillStyle の切り替えを減らす）
      for (const w of ["shot", "spread", "fire"]) {
        const tr = tierOf(state, w);
        ctx.fillStyle = glow && w === "shot" ? "#fffbe0" : TIER_COL[w][tr];
        const s = (w === "shot" ? 3.4 + (glow ? 1 : 0) + 0.7 * tr : w === "spread" ? 2.6 + 0.5 * tr : 3 + 0.6 * tr);
        for (let k = 0; k < n; k++) {
          const p = shots[k];
          if (!p || p.w !== w) continue;
          const x = num(p.x, -99), y = mapY(num(p.y, -99));
          if (w === "shot") ctx.fillRect(x - (1.4 + 0.4 * tr) / 2, y, 1.4 + 0.4 * tr, 6 + 2 * tr);   // 尾
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
      // どかん：オレンジの丸
      ctx.fillStyle = SHOT_COL.bomb;
      for (let k = 0; k < n; k++) {
        const p = shots[k];
        if (!p || p.w !== "bomb") continue;
        ctx.beginPath(); ctx.arc(num(p.x, -99), mapY(num(p.y, -99)), 4.5 + 0.5 * tierOf(state, "bomb"), 0, Math.PI * 2); ctx.fill();
      }
      // そのほか（知らない武器の弾も白い点で出す）
      ctx.fillStyle = "#ffffff";
      for (let k = 0; k < n; k++) {
        const p = shots[k];
        if (!p || p.w === "shot" || p.w === "spread" || p.w === "fire" || p.w === "bomb") continue;
        ctx.fillRect(num(p.x, -99) - 1.5, mapY(num(p.y, -99)) - 1.5, 3, 3);
      }
    }
    function drawParticles() {
      if (!particles.length) return;
      let col = "";
      for (const p of particles) {
        if (p.col !== col) { col = p.col; ctx.fillStyle = col; }
        const s = p.home ? p.size * (1 - 0.5 * clamp(p.age / p.dur, 0, 1)) : p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    function drawFighter() {
      const x = fighterX, y = fighterY + recoil;
      const sc = 1.3 * (1 + (calm ? 0.15 : 0.35) * pulse);   // 少し大きめに描く（小さな画面でも形が分かる）
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      // 後ろの炎（ゆらぐ）
      const fl = calm ? 0 : Math.sin(clk * 30) * 2;
      ctx.fillStyle = "#ff9a3c";
      ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(0, 17 + fl); ctx.lineTo(4, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath(); ctx.moveTo(-2, 9); ctx.lineTo(0, 13 + fl * 0.5); ctx.lineTo(2, 9); ctx.closePath(); ctx.fill();
      // 2枚の羽（オレンジ）
      ctx.fillStyle = "#ff9a3c";
      ctx.beginPath(); ctx.moveTo(-5, 1); ctx.quadraticCurveTo(-12, 6, -11, 11); ctx.lineTo(-4, 8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(5, 1); ctx.quadraticCurveTo(12, 6, 11, 11); ctx.lineTo(4, 8); ctx.closePath(); ctx.fill();
      // 胴（丸みのある白）
      ctx.fillStyle = brighten > 0.3 ? "#fffbe0" : "#f4f6ff";
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.bezierCurveTo(6, -9, 6, 2, 5, 9);
      ctx.lineTo(-5, 9);
      ctx.bezierCurveTo(-6, 2, -6, -9, 0, -14);
      ctx.closePath(); ctx.fill();
      // 先っぽ（オレンジ）と窓（水色）
      ctx.fillStyle = "#ff9a3c";
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.bezierCurveTo(3, -12, 4, -9, 4.2, -8); ctx.lineTo(-4.2, -8); ctx.bezierCurveTo(-4, -9, -3, -12, 0, -14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fd6ff";
      ctx.beginPath(); ctx.arc(0, -2, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 光の輪（しんか・枠が開いた）
      if (ring > 0 && !calm) {
        const k = 1 - ring;
        ctx.globalAlpha = ring;
        ctx.strokeStyle = ringKind === "evolve" ? "#ffd84d" : ringKind === "end" ? "#8fe3a0" : "#7fd6ff";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, fighterY, 16 + 40 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, fighterY, 10 + 24 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    function drawEnd() {
      for (const f of fx) {
        if (f.kind !== "endGlow") continue;
        const k = f.t / f.dur;
        // 地球のまわりがきれいになる（大気が明るく光る）
        ctx.globalAlpha = Math.sin(Math.PI * k) * 0.6;
        ctx.strokeStyle = "#9fe6ff"; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(W / 2, 1420, 905, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
        ctx.globalAlpha = 1;
        if (!calm && ((clk * 20) | 0) % 2 === 0) {
          ctx.fillStyle = "#ffe680";
          for (let k2 = 0; k2 < 6; k2++) { const a = clk * 2 + k2; ctx.fillRect(W / 2 + Math.cos(a) * 140, 470 + Math.sin(a) * 30, 3, 3); }
        }
      }
    }
    function drawEvolveText() {
      if (!evolveText) return;
      const t = evolveText.t;
      const a = t < 0.08 ? t / 0.08 : t > 1.5 ? clamp(1 - (t - 1.5) / 0.3, 0, 1) : 1;
      const sc = calm ? 1 : 1 + 0.25 * Math.max(0, 1 - t / 0.25);
      // 12px（CSS）より小さくしない。canvas の幅に入る大きさまで
      const minPx = 12 / Math.max(0.01, scale);
      // 見せている範囲の真ん中に、見せている幅に入る大きさで（寄せたときは字を大きくしすぎない：css で 26px・16px まで）
      const VW = camW;
      let s1 = Math.min(30, 26 / Math.max(0.01, scale)), s2 = Math.min(18, 16 / Math.max(0.01, scale));
      s1 = Math.max(s1, minPx * 1.3); s2 = Math.max(s2, minPx);
      ctx.font = "900 " + s1 + "px " + FONT;
      const w1 = ctx.measureText(evolveText.a).width;
      if (w1 > VW - 24) s1 = Math.max(minPx, (s1 * (VW - 24)) / w1);
      ctx.font = "800 " + s2 + "px " + FONT;
      const w2 = ctx.measureText(evolveText.b).width;
      if (w2 > VW - 24) s2 = Math.max(minPx, (s2 * (VW - 24)) / w2);
      const cy = camT + camH * 0.42;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(camL + VW / 2, cy);
      ctx.scale(sc, sc);
      ctx.fillStyle = "rgba(14,20,48,0.94)";
      ctx.fillRect(-VW / 2 + 8, -s1 - 6, VW - 16, s1 + s2 + 22);
      ctx.strokeStyle = "#ffd84d"; ctx.lineWidth = 2;
      ctx.strokeRect(-VW / 2 + 8, -s1 - 6, VW - 16, s1 + s2 + 22);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = "900 " + s1 + "px " + FONT;
      ctx.lineWidth = 4; ctx.strokeStyle = "#5a3a00";
      ctx.strokeText(evolveText.a, 0, 0);
      ctx.fillStyle = "#ffd84d";
      ctx.fillText(evolveText.a, 0, 0);
      ctx.font = "800 " + s2 + "px " + FONT;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(evolveText.b, 0, s2 + 8);
      ctx.restore();
    }

    function setNear(v) { nearOn = !!v; }
    function setCalm(v) {
      calmWanted = !!v;
      calm = calmWanted || !!(mq && mq.matches);
      if (calm) { ring = 0; slowmo = 0; rockLift = 0; }
    }
    function pause() { paused = true; lastFrameAt = null; }
    function resume() { paused = false; lastFrameAt = null; }
    function stats() {
      const s = drawTimes.slice().sort((a, b) => a - b);
      return {
        particles: particles.length,
        shots: lastState && Array.isArray(lastState.shots) ? lastState.shots.length : 0,
        frames, slowFrames, rockRedraws, rockFullRedraws,
        drawMs: s.length ? Math.round(s[(s.length / 2) | 0] * 100) / 100 : 0,
        calm,
        // 見せている範囲（テスト・確かめ用）：zoom＝css px / 単位、rockPx＝小惑星の格子の幅（css px）、rockOffset＝見た目のずれ（単位）
        view: { zoom: Math.round(scale * 1000) / 1000, left: Math.round(camL), top: Math.round(camT), width: Math.round(camW), height: Math.round(camH),
          cssW, cssH, rockPx: Math.round(camCols * num(Lg().CELL, 14) * scale), rockOffset: Math.round(roff) }
      };
    }

    layout();
    return { layout, frame, burst, setCalm, setNear, pause, resume, stats, MAX_PARTICLES };
  }

  root.AsteroidRender = { create, MAX_PARTICLES };
})(typeof window !== "undefined" ? window : globalThis);
