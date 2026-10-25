/*
 * ちきゅうを守れ！ほしくだき — canvas の描画と演出（作り直し：砲台・斜め撃ち・細かいマス）
 * 契約：docs/asteroid-contract.md §20・§20.4（案A）・§21.2（使ってよい state の欄）・§21.3・§21.5・§6。担当B だけが編集する。
 *
 * AsteroidRender.create(canvas, { calm, onAbsorb }) → {
 *   layout(cssWidth, cssHeight) → { scale, width, height },
 *   frame(state, events, dtSec),
 *   burst(kind, arg)   // 'up'|'evolve'|'unlock'|'clear'|'bounce'|'end'|'swap'。arg は砲台（枠）の番号
 *   setCalm(bool), setNear(bool), pause(), resume(),
 *   stats() → { particles, shots, frames, slowFrames, rockRedraws, rockFullRedraws, drawMs, calm, cellPx, view, turrets, bolt（v40：最後のいなずまの dur・segs・other）, evolve（v40：しんか の 2 行目） }
 * }
 * - 世界は 幅 360 × 高さ 560 の単位（§3.1）。canvas は親の箱いっぱいに広げ、見せる範囲（カメラ）は星の大きさで決める
 *   （§18.1 A）。寄せて上を切った分は、小惑星を見た目だけ下にずらす（バリアに届く所では 0）。ロジックの数は変えない。
 * - 使う state の欄は §21.2 の一覧だけ：star・phase・slots・rock（cols・rows・x・y・mats・hp・left・total・rowHp）・
 *   turrets（x・y・ang）・shots（k・w・x・y・vx・vy）・burns。
 * - 砲台（§6.2・§20.4）：白い丸い台座（半円のドーム）＋オレンジの砲身。砲身の先と台座の窓は、その武器の弾の色。
 *   砲身は turrets[k].ang の向き（0＝真上、左が負）。撃つと砲身が少し縮む。強くすると はねる。入れ替えは砲身が下がって新しい色で上がる。
 * - 小惑星のマス（1 マス約 6px）はオフスクリーンに描いておき、欠けた・ひびが増えたマスだけ描き直す（rockRedraws）。
 *   全部の描き直し（rockFullRedraws）は星が変わる・はね返し・大きさが変わるときだけ。1 マスは fillRect 数回。
 * - 粒は MAX_PARTICLES = 240 まで（超えたら古い粒から吸い込まれたことにする）。粒は一番近い砲台へ吸い込まれる。
 * - devicePixelRatio は 2 まで。shadowBlur・filter は使わない。
 * - 動きを減らす設定（prefers-reduced-motion か setCalm(true)）：揺れ・ゆっくり・光の輪・砲台のはね・入れ替えの動き・
 *   台の滑りなし。粒は少なく、吸い込まれは直線。
 * - #kakera の跳ね（.bump）は、粒が吸い込まれたときにここで付ける（数は main.js がロジックの値そのままで書く。§13-1）。
 */
(function (root) {
  "use strict";

  const Lg = () => root.AsteroidLogic || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W = 360, H = 560;
  const MAX_DPR = 2;
  const MAX_PARTICLES = 240;
  const SHOTS_MAX = 120;
  const SLOW_MS = 34;
  const SPAWN_BUDGET = 72;          // 1 フレームに新しく出す粒の上限（§13-11）
  const HIT_FX_BUDGET = 24;         // 1 フレームに出す「当たった光」の上限
  const MAT_ID = [null, "rock", "iron", "ice", "gold"];
  const MAT_HP_FALLBACK = { rock: 1, iron: 4, ice: 2, gold: 2 };
  const NAMES_FALLBACK = { shot: "たま", spread: "ちらし", bomb: "どかん", bolt: "いなずま", beam: "ビーム", fire: "ほのお" };
  // しんかの段（Lv 10 ごとに 1 段。最大 4）で弾の太さ・色を変える（U10）
  const TIER_COL = {
    shot: ["#ffffff", "#fff4b0", "#ffe27a", "#ffc2d0", "#a8f0ff"],
    spread: ["#ffd84d", "#ffe27a", "#fff0a0", "#c8ffd0", "#a8f0ff"],
    fire: ["#ff5a3c", "#ff7a3c", "#ff9a3c", "#ffc23c", "#ffe07a"]
  };
  // 武器の色（弾の色＝砲身の先と台座の窓の色。§5.2 の行の絵の地の色もこれにそろえる）
  const SHOT_COL = { shot: "#ffffff", spread: "#ffd84d", bomb: "#ff9a3c", bolt: "#bfeeff", beam: "#7fd6ff", fire: "#ff5a3c" };
  const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';
  // カメラ（§18.1 A）
  const ROCK_FILL = 0.75;     // 小惑星（の格子）の幅を場の幅のこの割合まで寄せる
  const VIEW_BOT = 548;       // 見せる一番下（地球の上の端 525 より少し下まで）
  const MIN_VIEW_W = 290;     // 横に見せる最小の幅（両はしの砲台 72・288 が必ず入る）
  const MAX_ZOOM = 2.4;       // 大きな画面（iPad）で寄せすぎない（css px / 単位）
  const TOP_PAD = 6;          // 星の始めに、小惑星の上に空ける見た目の余白
  // 砲台の形（単位）
  const DOME_R = 10;          // 台座のドームの半径
  const BARREL_W = 6;         // 砲身の太さ
  const BARREL_VIS = 19;      // 絵の砲身の長さ（大きさ 1 のとき。ロジックの BARREL より少し長く描き、弾は砲身の中から出てくる）

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
    // たまは貫通が増える Lv（ロジックの SHOT_UP.pierce。20・40・60・80・99）で「つきぬける」（v40）
    const pierce = safe(() => Lg().SHOT_UP.pierce, null) || [20, 40, 60, 80, 99];
    if (id === "shot" && Array.isArray(pierce) && pierce.includes(num(lv, 10))) return num(lv, 10) === 20 ? "3れんで つきぬける ように なった" : "もっと つきぬける ように なった";
    if (Math.floor(num(lv, 10) / 10) > 3) return "つよさが 2ばいに なった";
    const k = clamp(Math.floor(num(lv, 10) / 10), 1, 3);
    const sh = typeof Lg().shapeOf === "function" ? safe(() => Lg().shapeOf(id, num(lv, 10)), null) : null;
    switch (id) {
      case "shot": return (typeof sh === "number" ? sh : k + 1) + "れんに なった";
      case "spread": return (typeof sh === "number" ? sh : 5 + 2 * k) + "はつに なった";
      case "bomb": return "ばくはつが おおきく なった";
      case "bolt": return "えだわかれが ふえた";
      case "beam": return "ビームが ふとく なった";
      case "fire": return "ながく もえる ように なった";
      default: return "つよく なった";
    }
  }
  function safe(f, d) { try { return f(); } catch (e) { return d; } }
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
  function maxHpOf(star, m) {
    const L = Lg();
    if (typeof L.cellHp === "function") {
      const v = safe(() => L.cellHp(Math.max(1, Math.floor(num(star, 1))), MAT_ID[m]), null);
      if (typeof v === "number" && v > 0 && Number.isFinite(v)) return v;
    }
    const base = num(L.HP_BASE, 150), g = num(L.HP_GROWTH, 1.2), cap = num(L.STAR_CALC_MAX, 400);
    const n = clamp(Math.floor(num(star, 1)), 1, cap);
    return base * Math.pow(g, n - 1) * matHpOf(m);
  }
  function weaponCol(id) { return SHOT_COL[id] || "#ffffff"; }

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
    const C = () => num(Lg().CELL, 7);
    const TY = () => num(Lg().TURRET_Y, 500);
    const SAG = () => num(Lg().ARC_SAG, 12);
    const BARREL = () => num(Lg().BARREL, 14);

    let cssW = 100, cssH = 156, scale = cssW / W, dpr = 1, pxScale = scale;
    let camL = 0, camT = 0, camW = W, camH = H, camCols = 20, camRows = 20, camKey = "";
    let roff = 0, occBottom = -1;   // 小惑星の見た目のずれ（単位）と、いま一番下のマスの下の端（ロジックの y）
    let tsz = 1;                    // 砲台を描く大きさの倍率（寄せが小さい画面で形が分かるように少し大きく）
    let bg = null;
    let frames = 0, slowFrames = 0, lastFrameAt = null, paused = false;
    const drawTimes = [];
    let clk = 0;
    let lastState = null;

    // 小惑星のオフスクリーン
    let rockCv = null, rctx = null;
    let rockKey = "", rockCols = 0, rockRows = 0, rockStar = 0, rockLeft = -1;
    let known = null;        // 描いてあるマスの材質
    let knownCrack = null;   // 描いてあるマスのひびの段（絵）
    let evCrack = null;      // hit の出来事から知ったひびの段
    let beamMark = null;     // ビームの穴のまわり（ひびを 1 段足す。描画だけ §6.3）
    let maxHpCache = null;   // マスの満タンの体力（ひびの段の目安）
    let prevMats = null, prevHp = null;
    let dirty = [];          // 次の同期で描き直すマス（ビームの穴のまわり）
    let rockRedraws = 0, rockFullRedraws = 0;
    let gapPx = 1, cornerPx = 1;

    // 砲台（見た目）：x・y は滑らせた位置、pop は出てくる動き、hop は はね、rec は反動、swap は入れ替えの動き
    let tv = [];
    // 演出
    let particles = [];      // { x, y, vx, vy, age, home, sx, sy, dur, col, size, tk }
    let ghosts = [];         // はなれたかたまり：{ c, r, m, delay, t }
    let fx = [];
    let absorbPending = 0, absorbAt = -1, bumpAt = -1;
    let ring = 0, ringKind = "", ringK = -1;
    let barrierWave = 0, slowmo = 0, nearOn = false;
    let rockLift = 0, rockFade = 1, bounceT = -1;
    let evolveText = null;
    let lastBolt = null;     // 確かめ用：最後のいなずまの { dur, segs, other（てつ 以外へ伝わった枝の数） }
    let lastPhase = "";
    let spawnLeft = SPAWN_BUDGET, hitFxLeft = HIT_FX_BUDGET;
    let lastBreakX = W / 2, lastBreakY = 200;

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
      root.addEventListener("resize", relayout);
      root.addEventListener("orientationchange", () => { relayout(); if (root.setTimeout) root.setTimeout(relayout, 300); });
    }

    // ===== 大きさ =====
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
      const c = C(), BY = num(Lg().BARRIER_Y, 470);
      const rw = Math.max(1, cols) * c, rh = Math.max(1, rows) * c;
      // 縦に要る高さ：バリアから下（地球の端まで）＋小惑星の高さ＋近づく道のり（小惑星の 3 割、60 単位以上）
      const need = (VIEW_BOT - BY) + rh + Math.max(60, rh * 0.3);
      const sFull = cssH / VIEW_BOT;
      const sH = Math.max(cssH / need, sFull);
      const sW = (ROCK_FILL * cssW) / rw;
      scale = Math.max(0.05, Math.min(sH, sW, MAX_ZOOM, cssW / MIN_VIEW_W));
      camW = cssW / scale; camH = cssH / scale;
      let bot = VIEW_BOT;
      const top0 = bot - camH;
      if (top0 < 0) bot += Math.min(-top0, H - VIEW_BOT);
      camT = bot - camH;
      camL = W / 2 - camW / 2;
      pxScale = scale * dpr;
      // 砲台：css で台座の半径が 11px より小さくならないよう少し大きく描く（最大 2 倍。小さな画面でも形が分かる）
      tsz = clamp(11 / (DOME_R * scale), 1, 2);
      drawBg();
      rockKey = "";
      return true;
    }
    function camTransform(g) { g.setTransform(pxScale, 0, 0, pxScale, -camL * pxScale, -camT * pxScale); }
    function rockOffsetOf(rock) {
      const c = C(), BY = num(Lg().BARRIER_Y, 470), B0 = num(Lg().START_BOTTOM, 120);
      const rows = Math.max(1, num(rock.rows, 1) | 0);
      const v0 = Math.min(BY - 2 * c, Math.max(B0, camT + TOP_PAD + rows * c));
      if (!(v0 > B0)) return 0;
      const gb = num(rock.y, 0) + rows * c;
      return (v0 - B0) * clamp((BY - gb) / (BY - B0), 0, 1);
    }
    function bottomOf(rock) {
      const c = C();
      const cols = Math.max(1, num(rock.cols, 1) | 0), rows = Math.max(0, num(rock.rows, 0) | 0), mats = rock.mats;
      if (!mats) return -1;
      for (let r = rows - 1; r >= 0; r--) for (let k = 0; k < cols; k++) if (mats[r * cols + k]) return num(rock.y, 0) + (r + 1) * c;
      return -1;
    }
    // 弾などの y（ロジック）→ 見た目の y。砲台の所は 0、小惑星の一番下より上は小惑星と同じだけずらす
    function mapY(y) {
      if (!roff || occBottom < 0) return y;
      const FY = TY();
      const den = FY - occBottom;
      const k = den > 1 ? clamp((FY - y) / den, 0, 1) : 1;
      return y + roff * k;
    }
    // 弧（砲台の並ぶ線）：y = TURRET_Y + ARC_SAG × ((x − 180) / 180)²
    function arcY(x) { const u = (x - W / 2) / (W / 2); return TY() + SAG() * u * u; }

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
      const sh = Math.max(10, Math.min(470, vb) - camT);
      const nStars = Math.round(clamp(90 * (camW * sh) / (W * 470), 60, 160));
      const sz = 1 / Math.max(0.6, Math.min(2, scale));
      for (let k = 0; k < nStars; k++) {
        const x = camL + r() * camW, y = camT + r() * sh, s = (r() < 0.12 ? 1.6 : r() < 0.5 ? 1.1 : 0.7) * sz;
        c.globalAlpha = 0.35 + r() * 0.6;
        c.fillStyle = r() < 0.15 ? "#ffe9a8" : "#ffffff";
        c.fillRect(x, y, s, s);
      }
      c.globalAlpha = 1;
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
      c.fillStyle = "#3d9fe0"; c.fillRect(camL, 524, camW, 6);
      c.fillStyle = "#42b866";
      blob(c, 40, 540, 46, 10); blob(c, 150, 532, 34, 7); blob(c, 250, 546, 60, 12); blob(c, 340, 536, 30, 8);
      c.fillStyle = "#e9f6ff";
      blob(c, 100, 530, 22, 3); blob(c, 300, 529, 26, 3);
      c.restore();
      c.strokeStyle = "rgba(140,210,255,0.55)"; c.lineWidth = 2;
      c.beginPath(); c.arc(ex, ey, er + 1, Math.PI * 1.25, Math.PI * 1.75); c.stroke();
      // 砲台の並ぶ弧（バリアの土台。案A の浅い弧）
      const sag = Math.max(0.5, SAG()), R = (W / 2) * (W / 2) / (2 * sag) + sag / 2, cy = TY() + R;
      const half = Math.asin(clamp((camW / 2 + 16) / R, 0.05, 0.99));
      c.strokeStyle = "rgba(127,214,255,0.12)"; c.lineWidth = 10;
      c.beginPath(); c.arc(W / 2, cy + 5, R, Math.PI * 1.5 - half, Math.PI * 1.5 + half); c.stroke();
      c.strokeStyle = "rgba(127,214,255,0.40)"; c.lineWidth = 2;
      c.beginPath(); c.arc(W / 2, cy, R, Math.PI * 1.5 - half, Math.PI * 1.5 + half); c.stroke();
    }
    function blob(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }

    // ===== 小惑星のオフスクリーン =====
    function cellPx(k) { return Math.round(k * C() * pxScale); }
    function ensureRock(rock, star) {
      const cols = clamp(Math.floor(num(rock.cols, 0)), 0, 64), rows = clamp(Math.floor(num(rock.rows, 0)), 0, 64);
      const total = num(rock.total, -1), left = num(rock.left, -1);
      const key = star + "|" + cols + "|" + rows + "|" + total + "|" + pxScale;
      const reset = key !== rockKey || (rockLeft >= 0 && left > rockLeft);
      rockLeft = left;
      if (!reset) return false;
      rockKey = key; rockCols = cols; rockRows = rows; rockStar = star;
      const n = cols * rows;
      known = new Uint8Array(n);
      knownCrack = new Uint8Array(n);
      evCrack = new Uint8Array(n);
      beamMark = new Uint8Array(n);
      maxHpCache = new Float64Array(n);
      dirty = [];
      prevMats = null; prevHp = null;
      if (!doc) return true;
      if (!rockCv) { rockCv = doc.createElement("canvas"); rctx = rockCv.getContext("2d"); }
      const w = Math.max(1, cellPx(cols)), h = Math.max(1, cellPx(rows));
      if (rockCv.width !== w) rockCv.width = w;
      if (rockCv.height !== h) rockCv.height = h;
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.clearRect(0, 0, w, h);
      const cw = C() * pxScale;
      gapPx = Math.max(1, Math.round(cw * 0.1));            // マスの間のすき間（css 1px 前後）
      cornerPx = cw >= 7 ? 1 : 0;                           // 角の丸め（1 画素を欠く）
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
    // マス i の満タンの体力（ロジックの cellHpAt。無ければ cellHp × rowHp[行]）。マスごとに 1 回だけ計算してためる
    function maxHpAt(i, m, star) {
      if (maxHpCache && maxHpCache[i] > 0) return maxHpCache[i];
      const L = Lg(), st = lastState;
      let v = null;
      if (typeof L.cellHpAt === "function" && st && st.rock) v = safe(() => L.cellHpAt(st, i), null);
      if (!(typeof v === "number" && v > 0 && Number.isFinite(v))) {
        let k = 1;
        const rk = st && st.rock;
        if (rk && rk.rowHp && typeof rk.rowHp.length === "number") {
          const rv = rk.rowHp[Math.floor(i / Math.max(1, num(rk.cols, 1) | 0))];
          if (typeof rv === "number" && rv > 0 && Number.isFinite(rv)) k = rv;
        }
        v = maxHpOf(star, m) * k;
      }
      if (maxHpCache) maxHpCache[i] = v;
      return v;
    }
    function crackOf(i, m, hp, star) {
      let c = 0;
      if (matHpOf(m) >= 2) {
        c = evCrack ? evCrack[i] : 0;
        if (hp && typeof hp[i] === "number") {
          const f = hp[i] / maxHpAt(i, m, star);
          if (Number.isFinite(f)) c = Math.max(c, f <= 0.25 ? 3 : f <= 0.5 ? 2 : f <= 0.75 ? 1 : 0);
        }
      }
      if (beamMark && beamMark[i]) c += 1;      // ビームの穴のまわり：1 段だけ足す
      return clamp(c | 0, 0, 3);
    }
    // 1 マスを描く（fillRect 数回。てつ＝格子 1 本ずつ、こおり＝斜め線 1 本、きん＝星の印）
    function paintCell(i, m, crack) {
      if (!rctx) return;
      const c = i % rockCols, r = (i / rockCols) | 0;
      const x0 = cellPx(c), x1 = cellPx(c + 1), y0 = cellPx(r), y1 = cellPx(r + 1);
      const g = rctx;
      g.clearRect(x0, y0, x1 - x0, y1 - y0);
      if (!m) return;
      const gp = gapPx, x = x0 + (gp >> 1), y = y0 + (gp >> 1);
      const ww = x1 - x0 - gp, hh = y1 - y0 - gp;
      if (ww < 1 || hh < 1) return;
      const hv = hash(i, rockStar);
      const cr = ww >= 5 ? cornerPx : 0;
      g.fillStyle = MAT_SHADES[m][hv & 3];
      if (cr) { g.fillRect(x + cr, y, ww - 2 * cr, hh); g.fillRect(x, y + cr, ww, hh - 2 * cr); }
      else g.fillRect(x, y, ww, hh);
      const t = Math.max(1, Math.round(hh * 0.14));
      g.fillStyle = MAT_HI[m]; g.fillRect(x + cr, y, ww - 2 * cr, t);
      g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(x + cr, y + hh - t, ww - 2 * cr, t);
      const lw = Math.max(1, Math.round(ww * 0.12));
      if (m === 1) {
        if ((hv >> 3) & 1 && ww >= 6) { g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(x + Math.round(ww * 0.55), y + Math.round(hh * 0.45), Math.max(1, Math.round(ww * 0.22)), Math.max(1, Math.round(hh * 0.2))); }
      } else if (m === 2) {
        // てつ：格子（縦横 1 本ずつ）
        g.fillStyle = MAT_EDGE[2];
        g.fillRect(x + ((ww - lw) >> 1), y + 1, lw, hh - 2);
        g.fillRect(x + 1, y + ((hh - lw) >> 1), ww - 2, lw);
      } else if (m === 3) {
        // こおり：斜めの線 1 本（左下 → 右上）
        g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = lw;
        g.beginPath(); g.moveTo(x + ww * 0.18, y + hh * 0.82); g.lineTo(x + ww * 0.82, y + hh * 0.18); g.stroke();
      } else if (m === 4) {
        // きん：小さな星の印
        g.fillStyle = "#fff6c8";
        if (ww >= 7) star5(g, x + ww / 2, y + hh / 2, ww * 0.44, ww * 0.19);
        else g.fillRect(x + ((ww - 2) >> 1), y + ((hh - 2) >> 1), 2, 2);
      }
      // ひび：1 段＝斜め 1 本、2 段＝折れ線、3 段＝×
      if (crack > 0) {
        g.strokeStyle = "rgba(20,12,8,0.9)"; g.lineWidth = Math.max(1, Math.round(ww * 0.11));
        g.beginPath();
        const s = hash(i * 7, 991), flip = s & 1;
        const ax = flip ? x + ww * 0.2 : x + ww * 0.8, bx = flip ? x + ww * 0.8 : x + ww * 0.2;
        if (crack >= 3) {
          g.moveTo(x + ww * 0.15, y + hh * 0.15); g.lineTo(x + ww * 0.85, y + hh * 0.85);
          g.moveTo(x + ww * 0.85, y + hh * 0.15); g.lineTo(x + ww * 0.15, y + hh * 0.85);
        } else if (crack === 2) {
          g.moveTo(ax, y + hh * 0.12); g.lineTo(x + ww * 0.5, y + hh * 0.55); g.lineTo(bx, y + hh * 0.7);
          g.moveTo(x + ww * 0.5, y + hh * 0.55); g.lineTo(x + ww * (flip ? 0.4 : 0.6), y + hh * 0.9);
        } else {
          g.moveTo(ax, y + hh * 0.15); g.lineTo(x + ww * 0.5, y + hh * 0.5); g.lineTo(bx, y + hh * 0.85);
        }
        g.stroke();
      }
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
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.closePath();
    }
    // 変わったマスだけ描き直す（mats・hp の配列が写されたときだけ調べる＝コピーオンライト）
    function syncRock(rock, star) {
      if (!known) return;
      const n = rockCols * rockRows;
      const mats = rock.mats, hp = rock.hp;
      if (!mats || mats.length < n) return;
      if (mats !== prevMats || hp !== prevHp) {
        const hpOk = hp && typeof hp.length === "number" && hp.length >= n;
        const ph = prevHp && prevHp.length >= n ? prevHp : null;
        for (let i = 0; i < n; i++) {
          const m = mats[i] | 0;
          const km = known[i];
          if (m !== km) {
            known[i] = m >= 1 && m <= 4 ? m : 0;
            if (!known[i]) beamMark[i] = 0;
            knownCrack[i] = known[i] ? crackOf(i, known[i], hp, star) : 0;
            paintCell(i, known[i], knownCrack[i]);
            rockRedraws++;
          } else if (km && hpOk && (!ph || hp[i] !== ph[i])) {
            // 体力が戻ったマスは events で知ったひびを忘れる（T8）
            if (ph && hp[i] > ph[i]) evCrack[i] = 0;
            const cr = crackOf(i, km, hp, star);
            if (cr !== knownCrack[i]) { knownCrack[i] = cr; paintCell(i, km, cr); rockRedraws++; }
          }
        }
        prevMats = mats; prevHp = hp;
      }
      if (dirty.length) {
        for (const i of dirty) {
          const km = known[i];
          if (!km) continue;
          const cr = crackOf(i, km, hp, star);
          if (cr !== knownCrack[i]) { knownCrack[i] = cr; paintCell(i, km, cr); rockRedraws++; }
        }
        dirty = [];
      }
    }

    // ===== 座標 =====
    function cellCenter(rock, i) {
      const c = C();
      const cols = Math.max(1, num(rock.cols, 1) | 0);
      const cc = i % cols, r = (i / cols) | 0;
      return { x: num(rock.x, 0) + (cc + 0.5) * c, y: num(rock.y, 0) + (r + 0.5) * c + rockLift + roff };
    }

    // ===== 砲台（見た目） =====
    function turretTargets(state) {
      const ts = state && state.turrets;
      if (Array.isArray(ts) && ts.length) return ts.slice(0, 4).map((t) => ({ x: num(t && t.x, W / 2), y: num(t && t.y, TY()), ang: clamp(num(t && t.ang, 0), -1.6, 1.6) }));
      // turrets が無い state（古い作り・テスト）：枠の数から等間隔に置く（§3.8 の式）
      const n = clamp(Array.isArray(state && state.slots) ? state.slots.length : 1, 1, 4);
      const out = [];
      for (let k = 0; k < n; k++) { const x = (W * (k + 1)) / (n + 1); out.push({ x, y: arcY(x), ang: 0 }); }
      return out;
    }
    function syncTurrets(state, dt) {
      const tg = turretTargets(state);
      const slots = Array.isArray(state.slots) ? state.slots : [];
      for (let k = 0; k < tg.length; k++) {
        const t = tg[k];
        let v = tv[k];
        const col = weaponCol(slots[k] && slots[k].id);
        if (!v) {
          v = tv[k] = { x: t.x, y: t.y, fx: t.x, fy: t.y, tx: t.x, ty: t.y, mt: 1, pop: calm || !frames ? 1 : 0, hop: 0, rec: 0, swap: -1, swapCol: col, col, ang: t.ang };
        }
        if (t.x !== v.tx || t.y !== v.ty) {
          v.fx = v.x; v.fy = v.y; v.tx = t.x; v.ty = t.y; v.mt = calm ? 1 : 0;
        }
        if (v.mt < 1) {
          v.mt = Math.min(1, v.mt + dt / 0.5);
          const e = v.mt * v.mt * (3 - 2 * v.mt);
          v.x = v.fx + (v.tx - v.fx) * e; v.y = v.fy + (v.ty - v.fy) * e;
        } else { v.x = v.tx; v.y = v.ty; }
        v.ang = t.ang;
        if (v.col !== col && v.swap < 0) { v.swapCol = v.col; if (!calm) v.swap = 0; }
        v.col = col;
        if (v.pop < 1) v.pop = Math.min(1, v.pop + dt / 0.3);
        v.hop = Math.max(0, v.hop - dt * 3);
        v.rec = Math.max(0, v.rec - dt * 10);
        if (v.swap >= 0) { v.swap += dt; if (v.swap >= 0.4) v.swap = -1; }
      }
      tv.length = tg.length;
    }
    function nearestTurret(x, y) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < tv.length; k++) { const d = (tv[k].x - x) * (tv[k].x - x) + (tv[k].y - y) * (tv[k].y - y); if (d < bd) { bd = d; best = k; } }
      return best;
    }
    // 絵の砲身の先（ビーム・いなずま・撃った光はここから出す。ロジックの砲身の先 BARREL と同じ向き）
    function muzzleOf(k, ang) {
      const v = tv[k];
      if (!v) return { x: W / 2, y: TY() - BARREL() };
      const a = typeof ang === "number" ? ang : v.ang, L = Math.max(BARREL(), BARREL_VIS) * tsz;
      return { x: v.x + Math.sin(a) * L, y: v.y - Math.cos(a) * L };
    }
    function slotOfWeapon(state, id) {
      const sl = state && state.slots;
      if (Array.isArray(sl)) for (let k = 0; k < sl.length; k++) if (sl[k] && sl[k].id === id) return k;
      return -1;
    }

    // ===== 粒 =====
    function addParticle(x, y, col, spread) {
      if (spawnLeft <= 0) return;
      spawnLeft--;
      if (particles.length >= MAX_PARTICLES) { particles.shift(); absorbPending++; }
      const a = rnd() * Math.PI * 2, sp = calm ? 0 : (30 + rnd() * 70) * (spread || 1);
      const p = { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (calm ? 0 : 15), age: 0, home: calm ? 0.0001 : 0, sx: x, sy: y, dur: calm ? 0.5 : 0.6, col, size: 2 + rnd() * 1.4, tk: nearestTurret(x, y) };
      particles.push(p);
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
      let w = 0;
      for (let k = 0; k < particles.length; k++) {
        const p = particles[k];
        p.age += dt;
        if (!p.home) {
          // 飛び散る（0.22 秒、だんだん遅く）
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 0.9; p.vy *= 0.9;
          if (p.age >= 0.22) { p.home = 0.0001; p.sx = p.x; p.sy = p.y; p.age = 0; p.tk = nearestTurret(p.x, p.y); }
          particles[w++] = p;
          continue;
        }
        // 一番近い砲台へ吸い込まれる（0.6 秒の曲線。calm は直線）
        const t = clamp(p.age / p.dur, 0, 1);
        if (t >= 1) { absorbPending++; continue; }
        const tt = tv[p.tk] || tv[0];
        const hx = tt ? tt.x : W / 2, hy = tt ? tt.y - DOME_R * 0.5 : TY();
        const e = t * t * (3 - 2 * t);
        if (calm) {
          p.x = p.sx + (hx - p.sx) * e; p.y = p.sy + (hy - p.sy) * e;
        } else {
          const cx = p.sx + (p.sx < hx ? -30 : 30), cy = (p.sy + hy) / 2 - 10;
          const u = 1 - e;
          p.x = u * u * p.sx + 2 * u * e * cx + e * e * hx;
          p.y = u * u * p.sy + 2 * u * e * cy + e * e * hy;
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
      for (const ev of events) if (ev && ev.kind === "break") breaks++;
      // マスが小さいので 1 マス 1〜2 粒（§6.3）。多いときは 1 粒
      const perBreak = calm || breaks > 12 ? 1 : 2;
      for (const ev of events) {
        if (!ev || typeof ev.kind !== "string") continue;
        switch (ev.kind) {
          case "fire": {
            const k = ev.k | 0;
            if (tv[k] && !calm) tv[k].rec = 1;
            if (ev.w === "bomb" && !calm) { const m = tv[k] ? muzzleOf(k, typeof ev.ang === "number" ? ev.ang : undefined) : { x: num(ev.x, W / 2), y: num(ev.y, TY()) }; fx.push({ kind: "muzzle", t: 0, dur: 0.12, x: m.x, y: m.y }); }
            break;
          }
          case "hit": {
            if (!rock) break;
            const i = ev.i | 0;
            if (evCrack && i >= 0 && i < evCrack.length && typeof ev.crack === "number") evCrack[i] = Math.max(evCrack[i], clamp(ev.crack | 0, 0, 3));
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
            const cells = ev.cells.slice(0, 1200);
            if (calm) {
              for (let k = 0; k < cells.length; k += 2) { const i = cells[k] | 0; const p = cellCenter(rock, i); addParticle(p.x, p.y, PART_COL[(known && known[i]) || 1], 1); }
              break;
            }
            // 白く光って、0.3 秒で外側から崩れる（真ん中からの距離が遠いほど早く）
            let sx = 0, sy = 0;
            for (const i of cells) { sx += (i | 0) % cols; sy += ((i | 0) / cols) | 0; }
            sx /= Math.max(1, cells.length); sy /= Math.max(1, cells.length);
            let dmax = 0.001;
            const ds = cells.map((i) => { const d = Math.hypot(((i | 0) % cols) - sx, (((i | 0) / cols) | 0) - sy); if (d > dmax) dmax = d; return d; });
            cells.forEach((i, k) => {
              ghosts.push({ c: (i | 0) % cols, r: ((i | 0) / cols) | 0, m: (known && known[i | 0]) || 1, delay: 0.1 + (1 - ds[k] / dmax) * 0.3, t: 0, sp: k % 2 === 0 });
            });
            break;
          }
          case "bolt": {
            if (!rock) break;
            // 枝分かれ（edges：[[親, 子]…]）。古い作りの path も 1 本の枝として描く
            let edges = Array.isArray(ev.edges) ? ev.edges : null;
            let from = ev.from;
            if (!edges && Array.isArray(ev.path) && ev.path.length) { edges = []; for (let k = 1; k < ev.path.length; k++) edges.push([ev.path[k - 1], ev.path[k]]); from = ev.path[0]; }
            if (!edges) edges = [];
            if (typeof from !== "number") from = edges.length ? edges[0][0] : -1;
            if (from < 0) break;
            const depth = new Map([[from | 0, 0]]);
            const segs = [];
            let dmax = 1;
            for (const e of edges.slice(0, 120)) {
              if (!Array.isArray(e)) continue;
              const a = e[0] | 0, b = e[1] | 0;
              const da = depth.has(a) ? depth.get(a) : 0;
              depth.set(b, da + 1);
              if (da + 1 > dmax) dmax = da + 1;
              const pa = cellCenter(rock, a), pb = cellCenter(rock, b);
              // てつ 以外へ伝わった枝は色を変える（v40：てつ から いわ・こおり へ伝わるのが見えるように）。マスはもう欠けているかもしれないので、描いてある材質を先に見る
              const mb = (known && known[b]) || (rock.mats && rock.mats[b]) || 0;
              segs.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, d: da, o: mb !== 2 });
            }
            const k = slotOfWeapon(state, "bolt");
            const root0 = cellCenter(rock, from | 0);
            const m = k >= 0 && tv[k] ? muzzleOf(k) : { x: root0.x, y: camT };
            lastBolt = { dur: 0.35, segs: segs.length, other: segs.filter((g) => g.o).length };
            fx.push({ kind: "bolt", t: 0, dur: 0.35, mx: m.x, my: m.y, rx: root0.x, ry: root0.y, segs, dmax, seed: (rnd() * 1e6) | 0, tier: tierOf(state, "bolt") });
            break;
          }
          case "boom": {
            const c = C();
            let r = num(ev.r, 3);
            if (r <= 8) r *= c;                    // マスの数で来たら単位に直す
            fx.push({ kind: "boom", t: 0, dur: 0.35, x: num(ev.x, W / 2), y: mapY(num(ev.y, 200)) + rockLift, r });
            break;
          }
          case "beam": {
            const c = C();
            let w = num(ev.w, 2);
            if (w <= 8) w *= c;
            const k = typeof ev.k === "number" ? ev.k | 0 : slotOfWeapon(state, "beam");
            const ang = num(ev.ang, 0);
            const x = num(ev.x, W / 2), y = num(ev.y, TY() - BARREL());
            const len = num(ev.len, Math.max(40, y - camT));
            // 光は絵の砲身の先から、ロジックの光の終わり（穴の奥）まで
            const m0 = k >= 0 && tv[k] ? muzzleOf(k, ang) : { x, y };
            fx.push({ kind: "beam", t: 0, dur: 0.4, x: m0.x, y: m0.y, ex: x + Math.sin(ang) * len, ey: y - Math.cos(ang) * len, w });
            // 穴のまわりのマスに ひび を 1 段（描画だけ。ロジックの体力は変えない）
            if (Array.isArray(ev.cells) && beamMark && rock && rock.mats) {
              const cols = rockCols, rows = rockRows, n = cols * rows, mats = rock.mats;
              const set = new Set();
              for (const i of ev.cells) set.add(i | 0);
              for (const i of set) {
                const cc = i % cols, rr = (i / cols) | 0;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                  const x2 = cc + dx, y2 = rr + dy;
                  if (x2 < 0 || y2 < 0 || x2 >= cols || y2 >= rows) continue;
                  const j = y2 * cols + x2;
                  if (j >= n || set.has(j) || beamMark[j] || !(mats[j] | 0)) continue;
                  beamMark[j] = 1; dirty.push(j);
                }
              }
            }
            break;
          }
          case "burn": break;   // 燃えているマスは state.burns から毎フレーム描く
          case "evolve": {
            const sl = state && Array.isArray(state.slots) ? state.slots[ev.slot | 0] : null;
            const id = sl && sl.id;
            evolveText = { a: nameOf(id) + "が しんか！", b: evolveLine(id, ev.lv), t: 0 };
            burst("evolve", ev.slot | 0);
            break;
          }
          case "swap": {
            const k = ev.slot | 0;
            if (tv[k]) { tv[k].swapCol = weaponCol(ev.from); if (!calm) tv[k].swap = 0; }
            break;
          }
          case "turrets": break;   // 並び直しは syncTurrets が turrets の x の変化から滑らせる
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
    function burst(kind, arg) {
      const k = typeof arg === "number" && arg >= 0 ? arg | 0 : -1;
      const v = k >= 0 ? tv[k] : null;
      switch (kind) {
        case "up":
          if (v) { v.hop = 1; }
          else for (const t of tv) t.hop = 1;
          break;
        case "evolve":
          if (v) v.hop = 1;
          if (!calm) { ring = 1; ringKind = "evolve"; ringK = k >= 0 ? k : 0; }
          break;
        case "unlock":
          if (!calm) { ring = 1; ringKind = "unlock"; ringK = k >= 0 ? k : Math.max(0, tv.length - 1); }
          break;
        case "swap":
          if (v) { v.swapCol = v.col; if (calm) v.hop = 1; else v.swap = 0; }
          break;
        case "clear":
          if (!calm) slowmo = 0.4;
          fx.push({ kind: "star", t: 0, dur: calm ? 0.6 : 1.2, x: lastBreakX, y: lastBreakY });
          break;
        case "bounce": barrierWave = 1; bounceT = 0; break;
        case "end":
          if (!calm) { ring = 1; ringKind = "end"; ringK = -1; }
          fx.push({ kind: "endGlow", t: 0, dur: 2.5 });
          break;
        default: break;
      }
    }

    // ===== 1 フレーム =====
    function frame(state, events, dtSec) {
      const t0 = root.performance && performance.now ? performance.now() : Date.now();
      if (lastFrameAt != null && !paused && t0 - lastFrameAt > SLOW_MS) slowFrames++;
      lastFrameAt = t0;
      if (!state || typeof state !== "object") { frames++; return; }
      lastState = state;
      let dt = clamp(num(dtSec, 1 / 60), 0, 0.1);
      if (paused) dt = 0;
      spawnLeft = SPAWN_BUDGET; hitFxLeft = HIT_FX_BUDGET;
      const rock = state.rock;
      syncTurrets(state, dt);
      placeRock(rock);
      if (Array.isArray(events) && rock) {
        for (let k = events.length - 1; k >= 0; k--) {
          const e = events[k];
          if (e && e.kind === "break") { const p = cellCenter(rock, e.i | 0); lastBreakX = p.x; lastBreakY = p.y; break; }
        }
      }
      // 星が変わったかを先に見る（beam の ひび の印を新しい格子に付けるため）。粒の色は描いてあるマスから取る
      if (rock && typeof rock === "object") {
        const cols = clamp(Math.floor(num(rock.cols, 0)), 0, 64), rows = clamp(Math.floor(num(rock.rows, 0)), 0, 64);
        if ((num(state.star, 1) + "|" + cols + "|" + rows + "|" + num(rock.total, -1) + "|" + pxScale) !== rockKey) ensureRock(rock, num(state.star, 1));
      }
      onEvents(state, events);
      if (rock && typeof rock === "object") {
        if (!ensureRock(rock, num(state.star, 1))) syncRock(rock, num(state.star, 1));
      }
      let vdt = dt;
      if (slowmo > 0) { slowmo = Math.max(0, slowmo - dt); vdt = dt * 0.35; }
      clk += vdt;
      advanceFx(vdt, state);
      stepParticles(vdt);
      flushAbsorb();
      draw(state);
      frames++;
      const t1 = root.performance && performance.now ? performance.now() : Date.now();
      drawTimes.push(t1 - t0);
      if (drawTimes.length > 120) drawTimes.shift();
    }
    function placeRock(rock) {
      if (!rock || typeof rock !== "object") { roff = 0; occBottom = -1; return; }
      const cols = clamp(Math.floor(num(rock.cols, 0)), 1, 64), rows = clamp(Math.floor(num(rock.rows, 0)), 1, 64);
      setCam(cols, rows);
      roff = rockOffsetOf(rock);
      occBottom = bottomOf(rock);
    }
    function advanceFx(dt, state) {
      ring = Math.max(0, ring - dt * 1.2);
      barrierWave = Math.max(0, barrierWave - dt * 0.8);
      let w = 0;
      for (const f of fx) { f.t += dt; if (f.t < f.dur) fx[w++] = f; }
      fx.length = w;
      if (evolveText) { evolveText.t += dt; if (evolveText.t > 1.8) evolveText = null; }
      if (ghosts.length) {
        const rock = state.rock;
        const c = C();
        let g = 0;
        for (const h of ghosts) {
          h.t += dt;
          if (h.t >= h.delay) {
            if (rock && h.sp) addParticle(num(rock.x, 0) + (h.c + 0.5) * c, num(rock.y, 0) + (h.r + 0.5) * c + rockLift + roff, PART_COL[h.m] || "#fff", 1.3);
            continue;
          }
          ghosts[g++] = h;
        }
        ghosts.length = g;
      }
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
      for (const f of fx) if (f.kind === "bossFlash") { ctx.globalAlpha = 0.18 * (1 - f.t / f.dur); ctx.fillStyle = "#ff7a5c"; ctx.fillRect(camL, camT, camW, camH); ctx.globalAlpha = 1; }
      drawBarrier();
      if (rock && rockCv && rockCols > 0 && rockFade > 0) {
        const x = num(rock.x, 0), y = num(rock.y, 0) + rockLift + roff;
        if (rockFade < 1) ctx.globalAlpha = rockFade;
        ctx.drawImage(rockCv, x, y, rockCv.width / pxScale, rockCv.height / pxScale);
        ctx.globalAlpha = 1;
        drawBurns(state, rock);
        drawGhosts(rock);
      }
      // ビーム（穴の奥まで）
      for (const f of fx) if (f.kind === "beam") drawBeam(f);
      for (const f of fx) {
        const k = f.t / f.dur;
        if (f.kind === "hit") {
          if (f.aff > 0) {
            ctx.globalAlpha = 1 - k; ctx.fillStyle = "#fff6c8";
            star5(ctx, f.x, f.y, 6 + 5 * k + (f.crack ? 1.5 : 0), 2.4 + 1.5 * k);
            ctx.fillStyle = "#ffffff"; ctx.globalAlpha = (1 - k) * 0.9;
            ctx.fillRect(f.x - 1.5, f.y - 1.5, 3, 3);
          } else if (f.aff < 0) {
            ctx.globalAlpha = 0.7 * (1 - k); ctx.fillStyle = "#8d93a6";
            ctx.fillRect(f.x - 1.2, f.y - 1.2, 2.4, 2.4);
          } else {
            ctx.globalAlpha = 0.6 * (1 - k); ctx.fillStyle = "#ffffff";
            const s = 4.5 + (f.crack ? 1.5 : 0);
            ctx.fillRect(f.x - s / 2, f.y - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        } else if (f.kind === "boom") {
          ctx.globalAlpha = 0.85 * (1 - k);
          ctx.fillStyle = "rgba(255,154,60,0.35)";
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffb35c"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (f.kind === "bolt") drawBolt(f);
        else if (f.kind === "spark") {
          ctx.globalAlpha = 1 - k; ctx.fillStyle = "#fff6c8";
          star5(ctx, f.x, f.y, 5 + 5 * k, 2); ctx.globalAlpha = 1;
        } else if (f.kind === "star") {
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = "#ffe680";
          star5(ctx, f.x, f.y, 14 + 70 * k, 6 + 28 * k);
          ctx.fillStyle = "#ffffff";
          star5(ctx, f.x, f.y, 6 + 30 * k, 3 + 12 * k);
          ctx.globalAlpha = 1;
        } else if (f.kind === "muzzle") {
          ctx.globalAlpha = 1 - k; ctx.fillStyle = "#ffd9a8";
          ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      drawShots(state);
      drawParticles();
      drawTurrets();
      drawEnd();
      drawEvolveText();
    }
    function drawBarrier() {
      const by = num(Lg().BARRIER_Y, 470);
      const ex = W / 2, R = 1530, ey = by + R;
      const wv = barrierWave;
      const half = Math.asin(clamp((camW / 2 + 16) / R, 0.05, 0.99));
      const a = 0.35 + (calm ? 0 : 0.08 * Math.sin(clk * 2.2)) + wv * 0.5 + (nearOn ? 0.25 + (calm ? 0 : 0.2 * Math.sin(clk * 7)) : 0);
      ctx.strokeStyle = (nearOn ? "rgba(255,150,120," : "rgba(127,214,255,") + clamp(a, 0, 1).toFixed(3) + ")";
      ctx.lineWidth = 1.5 + wv * 3 + (nearOn ? 1.5 : 0);
      ctx.beginPath();
      if (wv > 0 && !calm) {
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
    }
    // ビーム：太い水色の帯（砲身の先から穴の奥まで）。今の絵のまま斜めにする
    function drawBeam(f) {
      const k = f.t / f.dur;
      const a = clamp(k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85, 0, 1);
      const ex = f.ex, ey = mapY(f.ey) + rockLift;
      const dx = ex - f.x, dy = ey - f.y, L = Math.hypot(dx, dy);
      if (L < 1) return;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.atan2(dx, -dy));
      ctx.globalAlpha = a * 0.55; ctx.fillStyle = "#7fd6ff";
      ctx.fillRect(-f.w / 2, -L, f.w, L);
      ctx.globalAlpha = a; ctx.fillStyle = "#ffffff";
      ctx.fillRect(-f.w * 0.15, -L, f.w * 0.3, L);
      ctx.restore();
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = "#fff6c8";
      ctx.beginPath(); ctx.arc(ex, ey, f.w * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // いなずま：砲身の先から ねらったマスへ落ち、edges の枝を全部（枝の先ほど細く、0.35 秒。てつ 以外へ伝わった枝は黄色の外がわ）
    function drawBolt(f) {
      const k = f.t / f.dur;
      const r = mulberry(f.seed + ((f.t * 30) | 0));
      const tier = f.tier || 0;
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      // 幹（砲台 → ねらったマス）は折れ線、枝は深さで 3 段の太さに分けてまとめて描く
      const trunk = [];
      const n = Math.max(3, Math.round(Math.hypot(f.rx - f.mx, f.ry - f.my) / 22));
      trunk.push([f.mx, f.my]);
      for (let j = 1; j < n; j++) { const u = j / n; trunk.push([f.mx + (f.rx - f.mx) * u + (r() - 0.5) * 9, f.my + (f.ry - f.my) * u + (r() - 0.5) * 6]); }
      trunk.push([f.rx, f.ry]);
      const jit = f.segs.map(() => [(r() - 0.5) * 4, (r() - 0.5) * 4]);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? "#ffffff" : "#7fd6ff";
        const base = pass ? 1.2 + 0.3 * tier : 3.2 + 0.7 * tier;
        ctx.lineWidth = base;
        ctx.beginPath();
        ctx.moveTo(trunk[0][0], trunk[0][1]);
        for (let j = 1; j < trunk.length; j++) ctx.lineTo(trunk[j][0], trunk[j][1]);
        ctx.stroke();
        for (let band = 0; band < 6; band++) {
          const other = band >= 3, bd = band % 3;
          if (other && pass) ctx.strokeStyle = "#ffffff";
          else if (other) ctx.strokeStyle = "#ffd36b";
          ctx.lineWidth = Math.max(pass ? 0.5 : 1, base * (1 - bd * 0.3));
          ctx.beginPath();
          let any = false;
          for (let s = 0; s < f.segs.length; s++) {
            const g = f.segs[s];
            const b = Math.min(2, Math.floor((g.d / Math.max(1, f.dmax)) * 3));
            if (b !== bd || !!g.o !== other) continue;
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
    function drawBurns(state, rock) {
      const burns = state.burns;
      if (!Array.isArray(burns) || !burns.length) return;
      const c = C();
      const n = Math.min(burns.length, 300);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? "#ffd84d" : "#ff6a3c";
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const b = burns[k];
          if (!b) continue;
          const p = cellCenter(rock, b.i | 0);
          if (!pass) {
            const fl = calm ? 0 : Math.sin(clk * 18 + k) * 0.8;
            ctx.moveTo(p.x - c * 0.32, p.y + c * 0.32); ctx.lineTo(p.x, p.y - c * 0.42 - fl); ctx.lineTo(p.x + c * 0.32, p.y + c * 0.32);
          } else {
            ctx.moveTo(p.x - c * 0.15, p.y + c * 0.3); ctx.lineTo(p.x, p.y - c * 0.08); ctx.lineTo(p.x + c * 0.15, p.y + c * 0.3);
          }
          ctx.closePath();
        }
        ctx.fill();
      }
    }
    // はなれたかたまり：白く光り、外側から崩れる（崩れる直前に少し揺れる）
    function drawGhosts(rock) {
      if (!ghosts.length) return;
      const c = C();
      const ox = num(rock.x, 0), oy = num(rock.y, 0) + rockLift + roff;
      const g1 = 0.12;
      // まわりの白い光（崩れるまで）
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (const h of ghosts) ctx.fillRect(ox + h.c * c - 1.2, oy + h.r * c - 1.2, c + 2.4, c + 2.4);
      ctx.fillStyle = "#ffffff";
      for (const h of ghosts) { if (h.t / h.delay < 0.4) ctx.fillRect(ox + h.c * c + g1, oy + h.r * c + g1, c - 2 * g1, c - 2 * g1); }
      let col = "";
      for (const h of ghosts) {
        const k = h.t / h.delay;
        if (k < 0.4) continue;
        const cc = MAT_SHADES[h.m][1];
        if (cc !== col) { col = cc; ctx.fillStyle = cc; }
        const j = k > 0.7 ? (rnd() - 0.5) * 1.5 : 0;
        ctx.fillRect(ox + h.c * c + 0.6 + j, oy + h.r * c + 0.6, c - 1.2, c - 1.2);
      }
    }
    function tierOf(state, id) {
      const sl = state && state.slots;
      if (Array.isArray(sl)) for (const x of sl) if (x && x.id === id) return clamp(Math.floor(num(x.lv, 1) / 10), 0, 4);
      return 0;
    }
    // 弾：速さ（vx・vy）の向きに描く（斜め）。絵は今のまま
    function drawShots(state) {
      const shots = state && state.shots;
      if (!Array.isArray(shots) || !shots.length) return;
      const n = Math.min(shots.length, SHOTS_MAX);
      for (const w of ["shot", "spread", "fire"]) {
        const tr = tierOf(state, w);
        const k0 = slotOfWeapon(state, w);
        const glow = k0 >= 0 && tv[k0] && tv[k0].hop > 0.3;
        const col = glow ? "#fffbe0" : TIER_COL[w][tr];
        const s = w === "shot" ? 3.4 + (glow ? 1 : 0) + 0.7 * tr : w === "spread" ? 2.6 + 0.5 * tr : 3 + 0.6 * tr;
        let any = false;
        // 尾（たまだけ。向きの反対へ）
        if (w === "shot") {
          ctx.strokeStyle = col; ctx.lineWidth = 1.4 + 0.4 * tr; ctx.lineCap = "butt";
          ctx.beginPath();
          const tl = 6 + 2 * tr;
          for (let k = 0; k < n; k++) {
            const p = shots[k];
            if (!p || p.w !== w) continue;
            const x = num(p.x, -99), y = mapY(num(p.y, -99));
            const vx = num(p.vx, 0), vy = num(p.vy, -1), vl = Math.hypot(vx, vy) || 1;
            ctx.moveTo(x, y); ctx.lineTo(x - (vx / vl) * tl, y - (vy / vl) * tl);
            any = true;
          }
          if (any) ctx.stroke();
        }
        ctx.fillStyle = col;
        for (let k = 0; k < n; k++) {
          const p = shots[k];
          if (!p || p.w !== w) continue;
          ctx.fillRect(num(p.x, -99) - s / 2, mapY(num(p.y, -99)) - s / 2, s, s);
        }
      }
      ctx.fillStyle = SHOT_COL.bomb;
      const br = 4.5 + 0.5 * tierOf(state, "bomb");
      for (let k = 0; k < n; k++) {
        const p = shots[k];
        if (!p || p.w !== "bomb") continue;
        ctx.beginPath(); ctx.arc(num(p.x, -99), mapY(num(p.y, -99)), br, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      for (let k = 0; k < n; k++) {
        const p = shots[k];
        if (!p || p.w === "shot" || p.w === "spread" || p.w === "fire" || p.w === "bomb") continue;
        ctx.fillRect(num(p.x, -99) - 1.2, mapY(num(p.y, -99)) - 1.2, 2.4, 2.4);
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
    // 砲台：白い丸い台座（半円のドーム）＋オレンジの砲身。砲身の先と窓は武器の色
    function drawTurrets() {
      const bl = BARREL();
      for (let k = 0; k < tv.length; k++) {
        const v = tv[k];
        const hop = calm ? 0 : Math.sin(Math.min(1, v.hop) * Math.PI) * 5;
        const pop = v.pop < 1 ? v.pop * v.pop * (3 - 2 * v.pop) : 1;
        // 入れ替え：0〜0.2 秒で砲身が下がり（前の色）、0.2〜0.4 秒で新しい色で上がる
        let bar = 1, tipCol = v.col;
        if (v.swap >= 0) {
          if (v.swap < 0.2) { bar = 1 - v.swap / 0.2; tipCol = v.swapCol; }
          else bar = (v.swap - 0.2) / 0.2;
        }
        const s = tsz * pop;
        if (s <= 0.01) continue;
        const slope = Math.atan((2 * SAG() * (v.x - W / 2)) / ((W / 2) * (W / 2)));
        ctx.save();
        ctx.translate(v.x, v.y - hop);
        // 砲身（台座の中心から ang の向きへ）
        const L = Math.max(bl, BARREL_VIS) * (1 - 0.22 * v.rec) * Math.max(0.15, bar);
        ctx.save();
        ctx.scale(s, s);
        ctx.rotate(v.ang);
        ctx.fillStyle = "#ff9a3c";
        roundRect(ctx, -BARREL_W / 2, -L, BARREL_W, L, 1.6); ctx.fill();
        ctx.fillStyle = tipCol;
        roundRect(ctx, -BARREL_W / 2 - 0.6, -L, BARREL_W + 1.2, Math.min(5.5, L * 0.5), 1.6); ctx.fill();
        ctx.strokeStyle = "#2a3360"; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.restore();
        // 台座（白いドーム。弧の傾きに合わせる）
        ctx.scale(s, s);
        ctx.rotate(slope);
        ctx.fillStyle = "#c9d0ea";
        ctx.beginPath(); ctx.ellipse(0, 0.6, DOME_R + 2.5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = v.hop > 0.3 ? "#fffbe0" : "#f4f6ff";
        ctx.beginPath(); ctx.arc(0, 0, DOME_R, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
        // 窓（武器の色）
        ctx.fillStyle = v.swap >= 0 && v.swap < 0.2 ? v.swapCol : v.col;
        ctx.beginPath(); ctx.arc(0, -DOME_R * 0.45, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#2a3360"; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.restore();
      }
      // 光の輪（しんか・新しい武器・エンディング）
      if (ring > 0 && !calm) {
        const k = 1 - ring;
        ctx.globalAlpha = ring;
        ctx.strokeStyle = ringKind === "evolve" ? "#ffd84d" : ringKind === "end" ? "#8fe3a0" : "#7fd6ff";
        ctx.lineWidth = 2.5;
        const list = ringK >= 0 && tv[ringK] ? [tv[ringK]] : tv;
        for (const v of list) {
          ctx.beginPath(); ctx.arc(v.x, v.y - 4, 14 + 36 * k, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(v.x, v.y - 4, 9 + 20 * k, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // エンディング：地球のまわりがきれいになり、砲台がそろって空へ光を打ち上げる（§3.11）
    function drawEnd() {
      for (const f of fx) {
        if (f.kind !== "endGlow") continue;
        const k = f.t / f.dur;
        ctx.globalAlpha = Math.sin(Math.PI * k) * 0.6;
        ctx.strokeStyle = "#9fe6ff"; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(W / 2, 1420, 905, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
        for (let j = 0; j < tv.length; j++) {
          const v = tv[j];
          const up = clamp(k * 1.6 - j * 0.08, 0, 1);
          if (up <= 0) continue;
          const top = v.y - 20 - (v.y - 20 - camT) * up;
          ctx.globalAlpha = Math.sin(Math.PI * k) * 0.7;
          ctx.fillStyle = v.col;
          ctx.fillRect(v.x - 2.5, top, 5, v.y - 20 - top);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(v.x - 0.8, top, 1.6, v.y - 20 - top);
        }
        ctx.globalAlpha = 1;
      }
    }
    function drawEvolveText() {
      if (!evolveText) return;
      const t = evolveText.t;
      const a = t < 0.08 ? t / 0.08 : t > 1.5 ? clamp(1 - (t - 1.5) / 0.3, 0, 1) : 1;
      const sc = calm ? 1 : 1 + 0.25 * Math.max(0, 1 - t / 0.25);
      const minPx = 12 / Math.max(0.01, scale);
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
      if (calm) { ring = 0; slowmo = 0; rockLift = 0; for (const t of tv) { t.swap = -1; t.mt = 1; t.pop = 1; t.hop = 0; t.rec = 0; } }
    }
    function pause() { paused = true; lastFrameAt = null; }
    function resume() { paused = false; lastFrameAt = null; }
    function stats() {
      const s = drawTimes.slice().sort((a, b) => a - b);
      return {
        particles: particles.length,
        shots: lastState && Array.isArray(lastState.shots) ? Math.min(SHOTS_MAX, lastState.shots.length) : 0,
        frames, slowFrames, rockRedraws, rockFullRedraws,
        drawMs: s.length ? Math.round(s[(s.length / 2) | 0] * 100) / 100 : 0,
        calm,
        cellPx: Math.round(C() * scale * 100) / 100,   // 1 マスの画面の大きさ（CSS px）
        // 見せている範囲（テスト・確かめ用）：zoom＝css px / 単位、rockPx＝小惑星の格子の幅（css px）、rockOffset＝見た目のずれ（単位）
        view: { zoom: Math.round(scale * 1000) / 1000, left: Math.round(camL), top: Math.round(camT), width: Math.round(camW), height: Math.round(camH),
          cssW, cssH, rockPx: Math.round(camCols * C() * scale), rockOffset: Math.round(roff) },
        // 砲台の見た目の位置（世界の単位。確かめ用）
        turrets: tv.map((v) => ({ x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, ang: Math.round(v.ang * 1000) / 1000 })),
        // 確かめ用（v40）：最後のいなずま・いま出ている しんか の 2 行目
        bolt: lastBolt ? Object.assign({}, lastBolt) : null,
        evolve: evolveText ? evolveText.b : null
      };
    }

    layout();
    return { layout, frame, burst, setCalm, setNear, pause, resume, stats, MAX_PARTICLES };
  }

  root.AsteroidRender = { create, MAX_PARTICLES };
})(typeof window !== "undefined" ? window : globalThis);
