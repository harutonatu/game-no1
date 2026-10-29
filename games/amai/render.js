/*
 * あまいものあつめ — 描画と演出（状態は変えない。#pic・#fx・#slots と #grid の中・#nest の中だけをさわる）
 * 契約：docs/ari-contract.md §3.3（見た目）・§3.4（DOM）・§3.8（描画）・§5.2（色と印）・§7.5（性能）
 * 担当 C（描画）だけが編集する。
 *
 * UMD: window.AmaiRender と module.exports。
 *
 * AmaiRender.create({ pic, fx, slots, grid, nest }, { calm, sfx }) → { build, layout, update, carry, place, deny,
 *   celebrate, finishAll, pause, resume, setCalm, setFast, busy, stats }
 *   - sfx（任意）：YubiSfx.create("amai") の戻り値。描画が時を知っている音だけ鳴らす（nest＝巣に入った・empty＝箱が空いた）。
 *     place・deny・open・thaw・clear は main が鳴らす（§3.6）。
 *   - 絵：#pic に「木の板（オフスクリーン）」と「色ごとの角砂糖の絵（オフスクリーン、1 マスの大きさで 1 回だけ作る）」を重ねて描く。
 *     ありんこが持ち上げたマスだけ、板の絵でそのマスを描き直す（全体を毎回描き直さない。§3.8・AW19）。
 *   - ありんこ：#fx（画面いっぱいの canvas、pointer-events:none）に毎フレーム描く。最大 MAX_ANTS 匹。超えた分は歩かずに角砂糖だけ消す。
 *   - 演出は自前の時計（requestAnimationFrame）で進める。pause で時計ごと止まる。動くものが無い間は rAF を回さない。
 *   - 画面の数（わくの数・のこり）は logic の値をそのまま出す（絵の角砂糖だけ、ありんこが持ち上げるまで残る）。
 *   - 動きを減らす（calm）：ありんこは歩かない（角砂糖は 0.1 秒で消える）。箱は飛ばずに切りかわる。音は鳴らす。
 */
(function (root) {
  "use strict";

  const MAX_ANTS = 48;
  const MAX_PARTS = 60;
  const CELL_MAX = 24;
  const SLOTS = 3, COLS = 4;
  const BACK_ROWS = 2;
  const WALK_MAX_MS = 1500;   // 1 匹の道のりの上限（はやくなら半分）
  const EXIT_MS = 150;        // わくの箱から出る
  const LIFT_MS = 80;         // 角砂糖を持ち上げる間
  const WALK_V = 230;         // 歩く速さの下限（px/秒）。道のりが長ければ上限に収まるよう速くする
  const CALM_VANISH_MS = 100; // 動きを減らす設定で角砂糖が消えるまで
  const ANT_INK = "#3a2618";

  // logic.js が無いときの予備（契約 §5.2 と同じ）
  const FALLBACK_COLORS = [
    { id: 0, letter: "R", key: "red", name: "あか", hex: "#E23B3B", mark: "circle", dots: [".###.", "#####", "#####", "#####", ".###."] },
    { id: 1, letter: "O", key: "orange", name: "オレンジ", hex: "#F28C28", mark: "triangle", dots: ["..#..", ".###.", ".###.", "#####", "#####"] },
    { id: 2, letter: "Y", key: "yellow", name: "きいろ", hex: "#F2D13A", mark: "star", dots: ["..#..", ".###.", "#####", ".#.#.", "#...#"] },
    { id: 3, letter: "G", key: "green", name: "みどり", hex: "#3E9E4F", mark: "diamond", dots: ["..#..", ".###.", "#####", ".###.", "..#.."] },
    { id: 4, letter: "S", key: "sky", name: "みずいろ", hex: "#78C6EE", mark: "plus", dots: ["..#..", "..#..", "#####", "..#..", "..#.."] },
    { id: 5, letter: "B", key: "blue", name: "あお", hex: "#2E5BC9", mark: "cross", dots: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"] },
    { id: 6, letter: "P", key: "pink", name: "ピンク", hex: "#F29BC2", mark: "heart", dots: [".#.#.", "#####", "#####", ".###.", "..#.."] },
    { id: 7, letter: "C", key: "brown", name: "ちゃいろ", hex: "#8B5A33", mark: "bars", dots: [".....", "#####", ".....", "#####", "....."] },
    { id: 8, letter: "W", key: "white", name: "しろ", hex: "#F5F2EA", mark: "ring", dots: [".###.", "#...#", "#...#", "#...#", ".###."] },
    { id: 9, letter: "K", key: "black", name: "くろ", hex: "#2B2B33", mark: "stripes", dots: [".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."] }
  ];
  const MARK_WORD = Object.freeze({ circle: "まる", triangle: "さんかく", star: "ほし", diamond: "ひしがた", plus: "じゅうじ", cross: "ばつ", heart: "ハート", bars: "よこせん", ring: "わ", stripes: "たてせん" });

  function logic() { return root.AmaiLogic || null; }
  function colorList() {
    const L = logic();
    return L && Array.isArray(L.COLORS) && L.COLORS.length ? L.COLORS : FALLBACK_COLORS;
  }
  const isColor = (x) => Number.isSafeInteger(x) && x >= 0;
  function colorInfo(id) {
    const c = isColor(id) ? colorList()[id] : null;
    return c || FALLBACK_COLORS[id] || { id, key: "unknown", name: "？", hex: "#888888", mark: "circle", dots: FALLBACK_COLORS[0].dots };
  }
  // 5×5 の点：[".###.", …] か 25 文字の文字列か、それが無ければ予備の表
  function dotsOf(c) {
    let d = c && c.dots;
    if (typeof d === "string") { const s = d.replace(/[^#.]/g, ""); if (s.length === 25) d = [0, 1, 2, 3, 4].map((i) => s.slice(i * 5, i * 5 + 5)); }
    if (Array.isArray(d) && d.length === 5 && d.every((r) => typeof r === "string" && r.length === 5)) return d;
    const f = FALLBACK_COLORS.find((x) => x.mark === (c && c.mark));
    return (f || FALLBACK_COLORS[0]).dots;
  }
  function markWord(id) { return MARK_WORD[colorInfo(id).mark] || "まる"; }
  function colorName(id) {
    const L = logic();
    if (L && typeof L.colorName === "function") { try { const n = L.colorName(id); if (typeof n === "string" && n) return n; } catch (e) { /* 予備へ */ } }
    return colorInfo(id).name;
  }

  // ===== 色の計算 =====
  function rgbOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    const n = m ? parseInt(m[1], 16) : 0x888888;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexOf(rgb) { return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
  function mix(hex, to, k) { const a = rgbOf(hex), b = rgbOf(to); return hexOf(a.map((v, i) => v + (b[i] - v) * k)); }
  function luminance(hex) {
    const ch = rgbOf(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  // 明るい色には濃い印、暗い色には白い印
  function inkFor(hex) { return luminance(hex) > 0.28 ? "#1c1a22" : "#ffffff"; }

  // ===== 印（文字のフォントに頼らず図形で描く。24×24 の中の形。SVG と canvas で同じ形） =====
  const MARK_D = Object.freeze({
    circle: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0z",
    triangle: "M12 3 21.5 20H2.5z",
    star: "M12 2.6l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 16.9l-5.7 3 1.2-6.3-4.6-4.4 6.3-.8z",
    diamond: "M12 2 21 12 12 22 3 12z",
    plus: "M9.2 3h5.6v6.2H21v5.6h-6.2V21H9.2v-6.2H3V9.2h6.2z",
    cross: "M5.4 3.2 12 9.8l6.6-6.6 2.2 2.2-6.6 6.6 6.6 6.6-2.2 2.2-6.6-6.6-6.6 6.6-2.2-2.2 6.6-6.6-6.6-6.6z",
    heart: "M12 21s-8.5-5.1-8.5-11.2C3.5 6.7 5.8 4.6 8.4 4.6c1.6 0 2.9.8 3.6 2.1.7-1.3 2-2.1 3.6-2.1 2.6 0 4.9 2.1 4.9 5.2C20.5 15.9 12 21 12 21z",
    bars: "M3 6h18v4.4H3zM3 13.6h18V18H3z",
    ring: "M3.4 12a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0-17.2 0zM7.8 12a4.2 4.2 0 1 1 8.4 0a4.2 4.2 0 1 1-8.4 0z",
    stripes: "M6 3h4.4v18H6zM13.6 3H18v18h-4.4z"
  });
  function markSvg(mark, ink, cls) {
    const d = MARK_D[mark] || MARK_D.circle;
    const edge = ink === "#ffffff" ? ' stroke="rgba(0,0,0,.45)" stroke-width="1"' : "";
    return `<svg class="${cls || "bmark"}" data-mark="${mark}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="${ink}" fill-rule="evenodd"${edge}/></svg>`;
  }
  const path2dCache = new Map();
  function markPath(mark) {
    if (typeof root.Path2D !== "function") return null;
    if (!path2dCache.has(mark)) { try { path2dCache.set(mark, new root.Path2D(MARK_D[mark] || MARK_D.circle)); } catch (e) { path2dCache.set(mark, null); } }
    return path2dCache.get(mark);
  }
  // canvas に印を描く（x, y は左上、size は一辺）。Path2D が無いときは 5×5 の点で描く
  function drawMark(ctx, mark, x, y, size, color) {
    if (!ctx || !(size > 0)) return;
    const p = markPath(mark);
    ctx.save();
    ctx.fillStyle = color || "#1c1a22";
    if (p) {
      ctx.translate(x, y);
      ctx.scale(size / 24, size / 24);
      ctx.fill(p, "evenodd");
    } else {
      const f = FALLBACK_COLORS.find((c) => c.mark === mark) || FALLBACK_COLORS[0];
      const d = size / 5;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (f.dots[r][c] === "#") ctx.fillRect(x + c * d, y + r * d, d, d);
    }
    ctx.restore();
  }
  const SNOW_SVG = '<svg class="bsnow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.6l3 2.4 3-2.4M9 20.4l3-2.4 3 2.4" fill="none" stroke="#1d5a7a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ANT_SVG = '<svg class="wantsvg" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><g fill="' + ANT_INK + '"><ellipse cx="5" cy="6.5" rx="4" ry="3"/><ellipse cx="10.5" cy="6.5" rx="2.2" ry="1.8"/><circle cx="15" cy="6" r="2.3"/></g><path d="M8 8.5 6 11.5M10.5 8.5v3M13 8.5l2 3M16 4l2-3M14.5 4 14 1" fill="none" stroke="' + ANT_INK + '" stroke-width="1.1" stroke-linecap="round"/></svg>';

  // ===== 角砂糖（立体の小さな四角） =====
  // ctx の今の座標で (x, y) から一辺 s。opts: { marks, mono, gap }
  function drawCube(ctx, x, y, s, colorId, opts) {
    const o = opts || {};
    const g = o.gap != null ? o.gap : (s >= 6 ? Math.max(0.6, s * 0.08) : 0);
    const w = s - g;
    if (w <= 0) return;
    if (o.mono) {
      ctx.fillStyle = "#c9c7cf";
      ctx.fillRect(x, y, w, w);
      return;
    }
    const c = colorInfo(colorId);
    ctx.fillStyle = c.hex;
    ctx.fillRect(x, y, w, w);
    if (w >= 3) {
      const t = Math.max(0.6, w * 0.2), l = Math.max(0.5, w * 0.12), b = Math.max(0.6, w * 0.17);
      ctx.fillStyle = mix(c.hex, "#ffffff", 0.42);
      ctx.fillRect(x, y, w, t);
      ctx.fillStyle = mix(c.hex, "#ffffff", 0.2);
      ctx.fillRect(x, y + t, l, w - t);
      ctx.fillStyle = mix(c.hex, "#000000", 0.28);
      ctx.fillRect(x, y + w - b, w, b);
      ctx.fillRect(x + w - b * 0.8, y + t, b * 0.8, w - t - b);
    }
    // 印（5×5 の点を、マスの 6 割の大きさで薄く）。1 マスが 5px 未満なら描かない（§3.3）
    if (o.marks && s >= 5) {
      const d = dotsOf(c);
      const a = w * 0.6, q = a / 5;
      const ox = x + (w - a) / 2, oy = y + (w - a) / 2;
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = inkFor(c.hex);
      for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) if (d[r][k] === "#") ctx.fillRect(ox + k * q, oy + r * q, q + 0.02, q + 0.02);
      ctx.restore();
    }
  }
  // 純粋な描画（ずかん・遊び方・メニュー）。picture = { W, H, cells }。opts: { cell, mono, marks, x, y }
  function drawPicture(ctx, picture, opts) {
    if (!ctx || !picture || !Array.isArray(picture.cells)) return;
    const o = opts || {};
    const W = picture.W | 0, H = picture.H | 0;
    if (W <= 0 || H <= 0) return;
    const s = o.cell > 0 ? o.cell : 8;
    const x0 = o.x || 0, y0 = o.y || 0;
    for (let i = 0; i < W * H; i++) {
      const v = picture.cells[i];
      if (!isColor(v)) continue;
      drawCube(ctx, x0 + (i % W) * s, y0 + Math.floor(i / W) * s, s, v, { mono: !!o.mono, marks: o.marks !== false && !o.mono });
    }
  }

  // ===== 時間の形 =====
  const ease = {
    linear: (k) => k,
    inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k,
    back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  function safe(fn) { try { return fn(); } catch (e) { if (typeof console !== "undefined") console.error("AmaiRender:", e); return undefined; } }

  // 描画が作る箱の中身の見た目（大きさ・並びは画面の担当の CSS が決める。:where で強さ 0 にしてあるので、画面の CSS が勝つ）
  const CSS = `
:where(.amai-box){position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  border-radius:8px;border:2px solid var(--e,#555);background:linear-gradient(180deg,var(--c1,#999) 0%,var(--c1,#999) 22%,var(--c,#888) 23%,var(--c2,#777) 100%);
  color:var(--ink,#1c1a22);font-weight:800;line-height:1;overflow:hidden;padding:0}
:where(.amai-box) .bmark{width:46%;max-width:26px;height:auto;aspect-ratio:1/1;display:block}
:where(.amai-box) .bnum{font-size:20px;font-variant-numeric:tabular-nums}
:where(.box.back.amai-box){flex-direction:row;gap:4px;opacity:.78;border-width:1.5px}
:where(.box.back.amai-box) .bmark{width:auto;height:62%;max-width:none}
:where(.box.back.amai-box) .bnum{font-size:12px}
:where(.amai-box[data-lid="1"]){--c:#8b5a33;--c1:#a87850;--c2:#6f4526;--e:#4a2c16;--ink:#fff6e6}
:where(.amai-box) .blid{font-size:24px;font-weight:900;color:#fff6e6}
:where(.box.back.amai-box) .blid{font-size:14px}
:where(.amai-box) .bice{position:absolute;inset:0;background:linear-gradient(160deg,rgba(225,245,255,.78),rgba(160,215,240,.62));border-radius:6px;
  display:flex;align-items:flex-start;justify-content:flex-end;padding:2px 3px;gap:1px;pointer-events:none}
:where(.amai-box) .bice .bsnow{width:14px;height:14px}
:where(.amai-box) .bice b{font-size:13px;color:#14465f}
:where(.box.back.amai-box) .bice{padding:0 3px;align-items:center}
:where(.box.back.amai-box) .bice .bsnow{width:11px;height:11px}
:where(.box.back.amai-box) .bice b{font-size:11px}
:where(.amai-box[hidden]),:where(.col .rest[hidden]){display:none}
:where(.slot){position:relative}
:where(.slot) .sbox{position:absolute;inset:0}
:where(.slot) .want{position:absolute;left:50%;top:-5px;width:16px;height:10px;margin-left:-8px;display:none}
:where(.slot) .want svg{width:100%;height:100%;display:block}
:where(.slot) .wdots{position:absolute;right:3px;top:1px;font-size:12px;display:none;color:var(--ink,#1c1a22)}
:where(.slot[data-wait="1"]) .want{display:block;animation:amaiStomp .36s steps(2) infinite}
:where(.slot[data-wait="1"][data-calm="1"]) .want{display:none}
:where(.slot[data-wait="1"][data-calm="1"]) .wdots{display:block}
@keyframes amaiStomp{0%{transform:translateX(-2px) rotate(-6deg)}100%{transform:translateX(2px) rotate(6deg)}}
@media (prefers-reduced-motion: reduce){:where(.slot[data-wait="1"]) .want{display:none;animation:none}:where(.slot[data-wait="1"]) .wdots{display:block}}
:where(.amai-nest){display:block;width:100%;height:100%}
`;
  const NEST_SVG = '<svg class="amai-nest" viewBox="0 0 40 18" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
    '<path d="M1 17.5C3 8 10 3.5 20 3.5S37 8 39 17.5z" fill="#9b6b3f"/><path d="M4 17.5C6 10.5 12 6.5 20 6.5s14 4 16 11z" fill="#c08a55"/>' +
    '<ellipse cx="20" cy="15.2" rx="8.6" ry="4.6" fill="#2a1a10"/><path d="M8 9.5h1.6M30 9h1.6M14 6.2h1.2M25.6 6.6h1.2" stroke="#e2b680" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function create(els, opts) {
    const o = opts || {};
    const pic = els && els.pic, fx = els && els.fx, slotsEl = els && els.slots, gridEl = els && els.grid, nest = els && els.nest;
    if (!pic || !slotsEl || !gridEl) throw new Error("AmaiRender.create: pic・slots・grid が必要です");
    const doc = pic.ownerDocument || root.document;
    const win = doc.defaultView || root;
    let calm = !!o.calm;
    let fast = !!o.fast;
    const sfx = o.sfx || null;
    const snd = (name) => { if (!sfx || typeof sfx.play !== "function") return; try { sfx.play(name); } catch (e) { /* 音が出なくても続ける */ } };

    // 描画の見た目の CSS を 1 回だけ入れる
    if (doc && doc.head && !doc.getElementById("amaiRenderCss")) {
      const st = doc.createElement("style");
      st.id = "amaiRenderCss";
      st.textContent = CSS;
      doc.head.insertBefore(st, doc.head.firstChild);
    }
    if (nest && !nest.querySelector(".amai-nest")) nest.innerHTML = NEST_SVG;

    // ---------- 時計（rAF 1 本。止めている間は進まない） ----------
    let clock = 0, lastT = 0, raf = 0, paused = false;
    const tweens = new Set();
    const raf_ = (fn) => (typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame(fn) : 0);
    const caf_ = (id) => { if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(id); };
    const nowMs = () => (win.performance && typeof win.performance.now === "function" ? win.performance.now() : Date.now());
    const ants = [];
    const parts = [];
    const rings = [];
    const vanish = [];        // 動きを減らす設定・数の上限で、時間がたったら消すマス { cell, at }
    let celeb = null;         // クリアの演出の絵 { img, x, y, w, h, a }
    let gen = 0;
    const frameTimes = [];
    let redraws = 0, fullDraws = 0;

    function active() { return tweens.size || ants.length || parts.length || rings.length || vanish.length || celeb; }
    function kick() { if (!raf && !paused) raf = raf_(frame); }
    function frame() {
      raf = 0;
      if (paused) return;
      const t = nowMs();
      const dt = lastT ? Math.min(100, Math.max(0, t - lastT)) : 16;
      lastT = t;
      clock += dt;
      for (const tw of Array.from(tweens)) {
        if (!tweens.has(tw)) continue;
        const k = tw.dur <= 0 ? 1 : Math.min(1, Math.max(0, (clock - tw.t0) / tw.dur));
        if (clock < tw.t0) continue;
        safe(() => tw.fn(tw.ease(k), k));
        if (k >= 1) { tweens.delete(tw); tw.res(); }
      }
      for (let i = vanish.length - 1; i >= 0; i--) if (clock >= vanish[i].at) { removeCell(vanish[i].cell); vanish.splice(i, 1); }
      const t1 = nowMs();
      drawFx(dt / 1000);
      frameTimes.push(nowMs() - t1);
      if (frameTimes.length > 60) frameTimes.shift();
      if (active()) kick();
      else { lastT = 0; clearFx(); }
    }
    function tween(ms, fn, easing, delay) {
      return new Promise((res) => {
        const tw = { t0: clock + (delay || 0), dur: Math.max(0, ms), fn, ease: easing || ease.inOut, res };
        if (tw.dur <= 0 && !delay) { safe(() => fn(1, 1)); res(); return; }
        if (!delay) safe(() => fn(tw.ease(0), 0));
        tweens.add(tw);
        kick();
      });
    }
    const wait = (ms) => tween(ms, () => {}, ease.linear);
    function endTweens() {
      for (const tw of Array.from(tweens)) { tweens.delete(tw); safe(() => tw.fn(1, 1)); tw.res(); }
    }

    // ---------- 絵（#pic） ----------
    const pctx = pic.getContext ? pic.getContext("2d") : null;
    let cur = null;            // いま出している局面（logic の state）
    let picture = null;        // 面の絵 { id, name, W, H, cells }
    let W = 0, H = 0;
    let shownCells = [];       // 絵に描いてある角砂糖（ありんこが持ち上げるまで残る）
    let cell = 8, padX = 4, padY = 4, dpr = 1, cssW = 0, cssH = 0;
    let bgCanvas = null;       // 木の板
    const sprites = new Map(); // 色 → その 1 マスの角砂糖の絵
    let spriteKey = "";
    let backRows = BACK_ROWS;

    function mkCanvas(w, h) {
      const c = doc.createElement("canvas");
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      return c;
    }
    const dx = (x) => Math.round((padX + x * cell) * dpr);
    const dy = (y) => Math.round((padY + y * cell) * dpr);
    function picName() { return (picture && picture.name) || (cur && cur.picture) || ""; }
    function setPicLabel() {
      const n = picName();
      const left = cur && Number.isSafeInteger(cur.left) ? cur.left : 0;
      pic.setAttribute("aria-label", `${n ? n + " の え。" : ""}のこり ${left} こ`);
    }
    function measureBox() {
      const box = pic.parentElement;
      let w = 288, h = 232;
      if (box && box.clientWidth) {
        const cs = win.getComputedStyle ? win.getComputedStyle(box) : null;
        const px = (v) => (cs ? parseFloat(cs[v]) || 0 : 0);
        w = box.clientWidth - px("paddingLeft") - px("paddingRight");
        h = box.clientHeight - px("paddingTop") - px("paddingBottom");
        const hud = box.querySelector(".hud");
        if (hud) h -= hud.offsetHeight;
        h -= nest ? Math.max(18, nest.offsetHeight || 0) : 18;
      }
      return { w: Math.max(20, w), h: Math.max(20, h) };
    }
    function backRowsNow() {
      if (!win.matchMedia) return BACK_ROWS;
      try {
        if (win.matchMedia("(orientation: portrait) and (max-height: 520px)").matches) return 1;
        if (win.matchMedia("(orientation: landscape) and (max-height: 500px)").matches) return 1;
      } catch (e) { /* 既定 */ }
      return BACK_ROWS;
    }
    function layout() {
      const br = backRowsNow();
      if (br !== backRows) { backRows = br; if (cur) renderBoxes(cur, true); }
      sizeFx();
      if (!W || !H) return;
      const m = measureBox();
      cell = Math.max(1, Math.min(CELL_MAX, Math.floor(Math.min(m.w / W, m.h / H) * 10) / 10));
      padX = Math.max(0, Math.min(8, Math.floor((m.w - W * cell) / 2)));
      padY = Math.max(0, Math.min(8, Math.floor((m.h - H * cell) / 2)));
      dpr = Math.min(2, win.devicePixelRatio || 1);
      cssW = W * cell + padX * 2; cssH = H * cell + padY * 2;
      pic.style.width = cssW + "px";
      pic.style.height = cssH + "px";
      const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
      if (pic.width !== pw) pic.width = pw;
      if (pic.height !== ph) pic.height = ph;
      pic.dataset.cell = String(cell);
      makeBoard(pw, ph);
      makeSprites();
      drawAll();
    }
    function makeBoard(pw, ph) {
      bgCanvas = mkCanvas(pw, ph);
      const c = bgCanvas.getContext("2d");
      if (!c) return;
      const r = Math.min(10 * dpr, pw / 4, ph / 4);
      c.beginPath();
      if (typeof c.roundRect === "function") c.roundRect(0, 0, pw, ph, r);
      else c.rect(0, 0, pw, ph);
      const g = c.createLinearGradient(0, 0, 0, ph);
      g.addColorStop(0, "#f0d3a2"); g.addColorStop(1, "#ddb47c");
      c.fillStyle = g;
      c.fill();
      c.save();
      c.clip();
      // 木目（決まった形。毎回同じ）
      c.strokeStyle = "rgba(150,98,48,.22)";
      c.lineWidth = Math.max(1, dpr);
      const step = Math.max(10 * dpr, ph / 9);
      for (let i = 0, y = step * 0.6; y < ph; i++, y += step) {
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x <= pw; x += 24 * dpr) c.lineTo(x, y + Math.sin(x / (37 * dpr) + i * 1.7) * 2.2 * dpr);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = "#b88a55";
      c.lineWidth = Math.max(1, 1.5 * dpr);
      c.beginPath();
      if (typeof c.roundRect === "function") c.roundRect(0.75 * dpr, 0.75 * dpr, pw - 1.5 * dpr, ph - 1.5 * dpr, r);
      else c.rect(0.75 * dpr, 0.75 * dpr, pw - 1.5 * dpr, ph - 1.5 * dpr);
      c.stroke();
    }
    function makeSprites() {
      const px = Math.max(1, Math.round(cell * dpr));
      const key = px + ":" + (cell >= 5 ? 1 : 0);
      if (key === spriteKey && sprites.size) return;
      spriteKey = key;
      sprites.clear();
      const n = colorList().length;
      for (let id = 0; id < n; id++) {
        const s = mkCanvas(px, px);
        const c = s.getContext("2d");
        if (c) drawCube(c, 0, 0, px, id, { marks: cell >= 5, gap: cell >= 6 ? Math.max(1, Math.round(px * 0.08)) : 0 });
        sprites.set(id, s);
      }
    }
    function drawCellAt(i) {
      const v = shownCells[i];
      if (!isColor(v)) return;
      const sp = sprites.get(v);
      if (!sp) return;
      pctx.drawImage(sp, dx(i % W), dy(Math.floor(i / W)));
    }
    function drawAll() {
      if (!pctx || !bgCanvas) return;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, pic.width, pic.height);
      pctx.drawImage(bgCanvas, 0, 0);
      for (let i = 0; i < shownCells.length; i++) drawCellAt(i);
      fullDraws++;
    }
    // 1 マスだけ消す（板の絵でそのマスを描き直す）
    function removeCell(i) {
      if (!Number.isSafeInteger(i) || i < 0 || i >= shownCells.length || !isColor(shownCells[i])) return;
      shownCells[i] = -1;
      redraws++;
      if (!pctx || !bgCanvas) return;
      const x = i % W, y = Math.floor(i / W);
      const x0 = dx(x), y0 = dy(y), w = dx(x + 1) - x0 + 1, h = dy(y + 1) - y0 + 1;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(x0, y0, w, h);
      pctx.drawImage(bgCanvas, x0, y0, w, h, x0, y0, w, h);
      // となりの角砂糖が 1px 重なっていたら描き直す（右・下のとなり）
      if (x + 1 < W) drawCellAt(i + 1);
      if (y + 1 < H) drawCellAt(i + W);
    }
    // 絵の 1 マスの中心（画面の座標）
    function cellCenter(i, rect) {
      const r = rect || pic.getBoundingClientRect();
      const k = cssW ? r.width / cssW : 1;
      const x = i % W, y = Math.floor(i / W);
      return { x: r.left + (padX + (x + 0.5) * cell) * k, y: r.top + (padY + (y + 0.5) * cell) * k, size: cell * k };
    }

    // ---------- わくと列の DOM ----------
    const slotEls = [];
    const colEls = [];
    function ensureDom() {
      slotEls.length = 0;
      for (let i = 0; i < SLOTS; i++) {
        let s = slotsEl.querySelector(`.slot[data-slot="${i}"]`);
        if (!s) { s = doc.createElement("div"); s.className = "slot"; s.dataset.slot = String(i); slotsEl.appendChild(s); }
        if (!s.querySelector(".sr")) { const sr = doc.createElement("span"); sr.className = "sr"; s.appendChild(sr); }
        s._sig = null;
        slotEls.push(s);
      }
      colEls.length = 0;
      for (let c = 0; c < COLS; c++) {
        let col = gridEl.querySelector(`.col[data-col="${c}"]`);
        if (!col) { col = doc.createElement("div"); col.className = "col"; col.dataset.col = String(c); gridEl.appendChild(col); }
        let front = col.querySelector("button.box.front");
        if (!front) {
          front = doc.createElement("button");
          front.type = "button";
          front.className = "box front";
          front.dataset.col = String(c);
          col.insertBefore(front, col.firstChild);
        }
        front.classList.add("amai-box");
        const backs = Array.from(col.querySelectorAll(".box.back"));
        while (backs.length < BACK_ROWS) {
          const b = doc.createElement("div");
          b.className = "box back";
          b.setAttribute("aria-hidden", "true");
          col.appendChild(b);
          backs.push(b);
        }
        backs.forEach((b) => b.classList.add("amai-box"));
        let rest = col.querySelector(".rest");
        if (!rest) { rest = doc.createElement("span"); rest.className = "rest"; rest.setAttribute("aria-hidden", "true"); col.appendChild(rest); }
        else col.appendChild(rest);
        front._sig = null; backs.forEach((b) => { b._sig = null; });
        colEls.push({ col, front, backs, rest });
      }
    }
    function boxVars(colorId) {
      const c = colorInfo(colorId);
      return `--c:${c.hex};--c1:${mix(c.hex, "#ffffff", 0.3)};--c2:${mix(c.hex, "#000000", 0.12)};--e:${mix(c.hex, "#000000", 0.42)};--ink:${inkFor(c.hex)}`;
    }
    const presses = (st) => (st && Number.isSafeInteger(st.presses) ? st.presses : 0);
    const iceLeft = (b, st) => (b && Number.isSafeInteger(b.ice) && b.ice > 0 ? Math.max(0, b.ice - presses(st)) : 0);
    // 箱 1 つの見た目（front・back・わくで共通）。lid の箱は色・印・数を書かない（§3.4）
    function paintBox(el, b, st, kind, col) {
      const lid = !!(b && b.lid);
      const ice = b ? iceLeft(b, st) : 0;
      const sig = b ? [b.id, lid ? "L" : b.color, lid ? "" : b.count, ice, kind].join("|") : "none";
      if (el._sig === sig) return;
      el._sig = sig;
      if (!b) {
        el.hidden = true;
        el.dataset.id = ""; el.dataset.color = ""; el.dataset.mark = ""; el.dataset.count = ""; el.dataset.lid = "0"; el.dataset.ice = "0";
        el.removeAttribute("style");
        el.innerHTML = "";
        if (kind === "front") el.setAttribute("aria-label", `${col + 1}れつめ：はこ なし`);
        return;
      }
      el.hidden = false;
      el.dataset.id = String(b.id);
      el.dataset.lid = lid ? "1" : "0";
      el.dataset.ice = String(ice);
      if (lid) {
        el.dataset.color = ""; el.dataset.mark = ""; el.dataset.count = "";
        el.removeAttribute("style");
        el.innerHTML = '<span class="blid" aria-hidden="true">？</span>';
      } else {
        const c = colorInfo(b.color);
        el.dataset.color = String(b.color);
        el.dataset.mark = c.mark;
        el.dataset.count = String(b.count);
        el.setAttribute("style", boxVars(b.color));
        el.innerHTML = markSvg(c.mark, inkFor(c.hex)) + `<b class="bnum">${b.count}</b>` +
          (ice > 0 ? `<span class="bice" aria-hidden="true">${SNOW_SVG}<b>${ice}</b></span>` : "");
      }
      if (kind === "front") {
        let label = lid ? `${col + 1}れつめ：ふたの はこ` : `${col + 1}れつめ：${colorName(b.color)}（${markWord(b.color)}） ${b.count}こ`;
        if (ice > 0) label += ` こおり あと ${ice}かい`;
        el.setAttribute("aria-label", label);
      }
    }
    function waitingColors(st) {
      // わくの箱の色のうち、ふちにその色の角砂糖が無い色（待っている箱）
      const set = new Set();
      const L = logic();
      let edges = null;
      if (L && typeof L.edgeCells === "function") edges = safe(() => L.edgeCells(st));
      if (!Array.isArray(edges)) edges = edgeCellsLocal(st);
      for (const i of edges) if (isColor(st.cells[i])) set.add(st.cells[i]);
      return set;
    }
    function edgeCellsLocal(st) {
      const w = st.W | 0, h = st.H | 0, cells = st.cells || [];
      const out = new Uint8Array(w * h);
      const q = [];
      const push = (i) => { if (!out[i] && !isColor(cells[i])) { out[i] = 1; q.push(i); } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (q.length) {
        const i = q.pop(), x = i % w, y = (i - x) / w;
        if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
      }
      const res = [];
      for (let i = 0; i < w * h; i++) {
        if (!isColor(cells[i])) continue;
        const x = i % w, y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || out[i - 1] || out[i + 1] || out[i - w] || out[i + w]) res.push(i);
      }
      return res;
    }
    function renderSlots(st) {
      const slots = Array.isArray(st.slots) ? st.slots : [];
      const ready = waitingColors(st);
      for (let i = 0; i < SLOTS; i++) {
        const el = slotEls[i];
        if (!el) continue;
        const b = slots[i] || null;
        const wait = b && !st.won && !ready.has(b.color) ? "1" : "0";
        const sig = b ? `${b.id}|${b.color}|${b.count}|${wait}` : "none";
        if (el._sig === sig) continue;
        el._sig = sig;
        el.dataset.wait = wait;
        el.dataset.calm = calm ? "1" : "0";
        const sr = el.querySelector(".sr");
        let box = el.querySelector(".sbox:not(.ghost)");
        if (!b) {
          el.dataset.color = ""; el.dataset.count = ""; el.dataset.mark = ""; el.dataset.id = "";
          if (box) box.remove();
          if (sr) sr.textContent = `わく ${i + 1}：あき`;
          continue;
        }
        const c = colorInfo(b.color);
        el.dataset.color = String(b.color);
        el.dataset.count = String(b.count);
        el.dataset.mark = c.mark;
        el.dataset.id = String(b.id);
        if (!box || box.dataset.id !== String(b.id)) {
          if (box) box.remove();
          box = doc.createElement("div");
          box.className = "sbox amai-box";
          box.setAttribute("aria-hidden", "true");
          box.dataset.id = String(b.id);
          box.setAttribute("style", boxVars(b.color));
          box.innerHTML = markSvg(c.mark, inkFor(c.hex)) + `<b class="bnum">${b.count}</b><span class="want">${ANT_SVG}</span><span class="wdots">…</span>`;
          el.insertBefore(box, sr || null);
        } else {
          const n = box.querySelector(".bnum");
          if (n && n.textContent !== String(b.count)) n.textContent = String(b.count);
        }
        box.dataset.mark = c.mark;
        box.dataset.color = String(b.color);
        if (sr) sr.textContent = `わく ${i + 1}：${colorName(b.color)}（${markWord(b.color)}） のこり ${b.count}こ`;
      }
    }
    function renderCols(st, force) {
      const cols = Array.isArray(st.cols) ? st.cols : [];
      for (let c = 0; c < COLS; c++) {
        const ce = colEls[c];
        if (!ce) continue;
        const list = Array.isArray(cols[c]) ? cols[c] : [];
        if (force) { ce.front._sig = null; ce.backs.forEach((b) => { b._sig = null; }); }
        paintBox(ce.front, list[0] || null, st, "front", c);
        for (let k = 0; k < ce.backs.length; k++) paintBox(ce.backs[k], k < backRows ? list[k + 1] || null : null, st, "back", c);
        const rest = Math.max(0, list.length - 1 - backRows);
        ce.col.dataset.rest = String(rest);
        const t = rest > 0 ? `＋${rest}` : "";
        if (ce.rest.textContent !== t) ce.rest.textContent = t;
        ce.rest.hidden = rest <= 0;
      }
    }
    function renderBoxes(st, force) {
      if (!st) return;
      if (!slotEls.length || !colEls.length) ensureDom();
      renderSlots(st);
      renderCols(st, force);
    }

    // ---------- fx（ありんこ・粒・光） ----------
    const fctx = fx && fx.getContext ? fx.getContext("2d") : null;
    let fxW = 0, fxH = 0, fxDpr = 1, fxL = 0, fxT = 0, fxDirty = false;
    function sizeFx() {
      if (!fx) return;
      const r = fx.getBoundingClientRect();
      const w = Math.round(r.width) || win.innerWidth || 0, h = Math.round(r.height) || win.innerHeight || 0;
      fxL = r.width ? r.left : 0; fxT = r.height ? r.top : 0;
      const d = Math.min(2, win.devicePixelRatio || 1);
      if (w === fxW && h === fxH && d === fxDpr) return;
      fxW = w; fxH = h; fxDpr = d;
      fx.width = Math.max(1, Math.round(w * d));
      fx.height = Math.max(1, Math.round(h * d));
    }
    sizeFx();
    function clearFx() {
      if (!fctx || !fxDirty) return;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fx.width, fx.height);
      fxDirty = false;
    }
    function antScale() { return Math.max(4.2, Math.min(7, cell * 0.55)); }
    function drawAnt(c, x, y, ang, s, step, carry, alpha, carryD, carryL) {
      c.save();
      c.globalAlpha = alpha;
      c.translate(x, y);
      c.rotate(ang);
      c.strokeStyle = ANT_INK;
      c.fillStyle = ANT_INK;
      c.lineWidth = Math.max(0.9, s * 0.16);
      c.lineCap = "round";
      // 足（2 コマ）
      c.beginPath();
      for (let i = -1; i <= 1; i++) {
        const bx = i * s * 0.32;
        const off = ((i + 3 + step) % 2 ? 1 : -1) * s * 0.28;
        c.moveTo(bx, 0); c.lineTo(bx + off, -s * 0.62);
        c.moveTo(bx, 0); c.lineTo(bx - off, s * 0.62);
      }
      // 触角
      c.moveTo(s * 0.55, -s * 0.08); c.lineTo(s * 0.95, -s * 0.38);
      c.moveTo(s * 0.55, s * 0.08); c.lineTo(s * 0.95, s * 0.38);
      c.stroke();
      c.beginPath(); c.ellipse(-s * 0.55, 0, s * 0.45, s * 0.32, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(0, 0, s * 0.26, s * 0.2, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(s * 0.46, 0, s * 0.23, 0, Math.PI * 2); c.fill();
      if (carry) {
        const q = Math.max(3, Math.min(6, s * 0.9));
        c.rotate(-ang);   // 角砂糖は傾けない
        const hx = Math.cos(ang) * s * 0.95, hy = Math.sin(ang) * s * 0.95;
        c.fillStyle = carryD || mix(carry, "#000000", 0.35);
        c.fillRect(hx - q / 2 - 0.5, hy - q / 2 - 0.5, q + 1, q + 1);
        c.fillStyle = carry;
        c.fillRect(hx - q / 2, hy - q / 2, q, q);
        c.fillStyle = carryL || mix(carry, "#ffffff", 0.45);
        c.fillRect(hx - q / 2, hy - q / 2, q, q * 0.3);
      }
      c.restore();
    }
    function antAt(a, now) {
      const tt = (now - a.t0) / a.k;
      if (tt < 0) return null;
      if (tt < EXIT_MS) {
        const e = tt / EXIT_MS;
        return { x: lerp(a.sx, a.p[0].x, e), y: lerp(a.sy, a.p[0].y, e), ang: Math.atan2(a.p[0].y - a.sy, a.p[0].x - a.sx), carry: false, alpha: 0.3 + 0.7 * e, d: 0 };
      }
      let d = (tt - EXIT_MS) * a.v / 1000;
      if (d >= a.la) {
        const after = tt - EXIT_MS - a.la / a.v * 1000;
        if (after < LIFT_MS) { const q = a.p[a.liftIdx]; return { x: q.x, y: q.y, ang: a.liftAng, carry: after > LIFT_MS / 2, alpha: 1, d: a.la, lift: true }; }
        d = a.la + (after - LIFT_MS) * a.v / 1000;
      }
      if (d >= a.L) return { end: true };
      let acc = 0;
      for (let i = 0; i < a.seg.length; i++) {
        const sl = a.seg[i];
        if (d <= acc + sl || i === a.seg.length - 1) {
          const k = sl > 0 ? Math.min(1, (d - acc) / sl) : 1;
          const p0 = a.p[i], p1 = a.p[i + 1];
          const left = a.L - d;
          return { x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k), ang: Math.atan2(p1.y - p0.y, p1.x - p0.x), carry: d > a.la, alpha: left < 6 ? Math.max(0, left / 6) : 1, d };
        }
        acc += sl;
      }
      return { end: true };
    }
    function drawFx(dt) {
      if (!fctx) { ants.length = 0; parts.length = 0; rings.length = 0; celeb = null; return; }
      // 大きさと位置（fxL・fxT）は layout()（resize・向きが変わったとき）と最初に sizeFx() で覚えた値を使う。毎コマ測らない（性能）
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fx.width, fx.height);
      fctx.setTransform(fxDpr, 0, 0, fxDpr, -fxL * fxDpr, -fxT * fxDpr);
      fxDirty = true;
      // ありんこ
      for (let i = ants.length - 1; i >= 0; i--) {
        const a = ants[i];
        const at = antAt(a, clock);
        if (at && !at.end && at.d >= a.la && !a.lifted && (at.lift ? at.carry : true)) { a.lifted = true; removeCell(a.cell); }
        if (!at) continue;
        if (at.end) {
          if (!a.lifted) { a.lifted = true; removeCell(a.cell); }
          ants.splice(i, 1);
          snd("nest");
          continue;
        }
        drawAnt(fctx, at.x, at.y, at.ang, a.s, Math.floor(at.d / 3.2) % 2, at.carry ? a.hex : null, at.alpha, a.hexD, a.hexL);
      }
      // 光の輪
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const k = (clock - r.t0) / r.dur;
        if (k >= 1) { rings.splice(i, 1); continue; }
        if (k < 0) continue;
        const rad = lerp(r.r0, r.r1, ease.out(k));
        fctx.globalAlpha = (1 - k) * r.alpha;
        fctx.strokeStyle = r.color;
        fctx.lineWidth = Math.max(1, r.width * (1 - k * 0.6));
        fctx.beginPath(); fctx.ellipse(r.x, r.y, rad * r.sx, rad, 0, 0, Math.PI * 2); fctx.stroke();
      }
      fctx.globalAlpha = 1;
      // クリアの絵
      if (celeb && celeb.img && celeb.a > 0) {
        fctx.globalAlpha = celeb.a;
        fctx.drawImage(celeb.img, celeb.x - celeb.w / 2, celeb.y - celeb.h / 2, celeb.w, celeb.h);
        fctx.globalAlpha = 1;
      }
      // 粒（小さな四角・きらきら）
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const k = p.age / p.life;
        fctx.globalAlpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
        fctx.fillStyle = p.color;
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
        if (p.shape === "star") {
          const s = p.size * (1 - k * 0.4);
          fctx.beginPath();
          for (let j = 0; j < 8; j++) { const an = (j / 8) * Math.PI * 2; const rr = j % 2 ? s * 0.38 : s; fctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
          fctx.closePath(); fctx.fill();
        } else fctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        fctx.restore();
      }
      fctx.globalAlpha = 1;
    }
    function addPart(p) {
      if (parts.length >= MAX_PARTS) parts.shift();
      parts.push(Object.assign({ age: 0, life: 0.5, g: 600, rot: 0, vr: 0, size: 3, shape: "sq", vx: 0, vy: 0 }, p));
      kick();
    }
    function burst(x, y, color, n, spread) {
      for (let i = 0; i < n; i++) {
        const an = (i / n) * Math.PI * 2 + (i % 3) * 0.4;
        const sp = (spread || 90) * (0.6 + ((i * 7) % 5) / 10);
        addPart({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 60, color, size: 2.5 + (i % 3), vr: (i % 2 ? 1 : -1) * 8, life: 0.35 + (i % 4) * 0.05 });
      }
    }
    function addRing(r) { rings.push(Object.assign({ t0: clock, dur: 500, alpha: 1, width: 3, sx: 1, color: "#ffe9a8", r0: 4, r1: 30 }, r)); kick(); }
    const rectOf = (el) => (el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
    const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    function nestPoint() {
      const r = nest ? rectOf(nest) : null;
      if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height * 0.78, top: r.top + r.height * 0.35 };
      const p = rectOf(pic);
      return { x: p.left + p.width / 2, y: p.bottom + 9, top: p.bottom + 4 };
    }

    // ---------- 公開する関数 ----------
    function setState(st) {
      cur = st;
      W = st && st.W | 0; H = st && st.H | 0;
      shownCells = st && Array.isArray(st.cells) ? st.cells.slice() : [];
    }
    function build(st, pict) {
      if (!st) return;
      finishAll();
      picture = pict && Array.isArray(pict.cells) ? pict : picture && st.picture === picture.id ? picture : null;
      setState(st);
      ensureDom();
      layout();
      renderBoxes(st, true);
      setPicLabel();
    }
    function update(st) {
      if (!st) return;
      finishAll();
      const sizeChanged = !cur || (st.W | 0) !== W || (st.H | 0) !== H;
      if (picture && st.picture !== picture.id) picture = null;
      setState(st);
      if (!slotEls.length) ensureDom();
      if (sizeChanged) layout(); else drawAll();
      renderBoxes(st, true);
      setPicLabel();
    }
    function carry(out, st) {
      if (st) cur = st;
      const list = out && Array.isArray(out.carries) ? out.carries : [];
      if (list.length) {
        const prect = rectOf(pic);
        const np = nestPoint();
        const k = fast ? 0.5 : 1;
        for (const c of list) {
          if (!c || !Number.isSafeInteger(c.cell)) continue;
          const slotEl = slotEls[c.slot];
          if (calm || !fctx || ants.length >= MAX_ANTS || !slotEl || !cssW) {
            if (calm) { vanish.push({ cell: c.cell, at: clock + CALM_VANISH_MS }); snd("nest"); kick(); }
            else removeCell(c.cell);
            continue;
          }
          const sr = rectOf(slotEl);
          const cc = cellCenter(c.cell, prect);
          const jitter = (((c.id | 0) * 37 + c.cell * 13) % 9 - 4) * 1.2;
          const p0 = { x: sr.left + sr.width / 2 + jitter, y: sr.top - 2 };
          const p1 = { x: np.x + jitter, y: np.top };
          const p2 = { x: cc.x, y: cc.y };
          const p3 = { x: np.x, y: np.y };
          const pts = [p0, p1, p2, p3];
          const seg = [];
          let L = 0;
          for (let i = 0; i < 3; i++) { const s = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(s); L += s; }
          const la = seg[0] + seg[1];
          const walkMs = WALK_MAX_MS - EXIT_MS - LIFT_MS;
          const v = Math.max(WALK_V, L / (walkMs / 1000));
          const hex = colorInfo(c.color).hex;
          ants.push({
            t0: clock, k, p: pts, seg, L, la, v, liftIdx: 2, liftAng: Math.atan2(p2.y - p1.y, p2.x - p1.x),
            sx: sr.left + sr.width / 2, sy: sr.top + sr.height * 0.4, cell: c.cell, hex, hexD: mix(hex, "#000000", 0.35), hexL: mix(hex, "#ffffff", 0.45), s: antScale(), lifted: false
          });
        }
        kick();
      }
      // 空いた箱：はずんで「ポン」と消える（わくの DOM は先に logic の値にそろえる）
      const emptied = list.filter((c) => c && c.emptied);
      const ghosts = [];
      for (const c of emptied) {
        const el = slotEls[c.slot];
        const box = el && el.querySelector(".sbox:not(.ghost)");
        if (box && box.dataset.id === String(c.id)) { box.classList.add("ghost"); ghosts.push({ box, color: c.color, el }); }
      }
      if (cur) { renderSlots(cur); setPicLabel(); }
      for (const g of ghosts) {
        snd("empty");
        if (calm) { g.box.remove(); continue; }
        const r = centerOf(rectOf(g.el));
        burst(r.x, r.y, colorInfo(g.color).hex, 8, 80);
        tween(300, (e, kk) => {
          const s = kk < 0.35 ? 1 + 0.18 * (kk / 0.35) : 1.18 * (1 - (kk - 0.35) / 0.65);
          g.box.style.transform = `scale(${Math.max(0, s).toFixed(3)})`;
          g.box.style.opacity = String(kk < 0.5 ? 1 : 1 - (kk - 0.5) * 2);
        }, ease.linear).then(() => g.box.remove());
      }
    }
    function place(out, st) {
      if (!out || out.kind !== "press") { if (st) update(st); return Promise.resolve(); }
      const col = colEls[out.col];
      const fr = col ? rectOf(col.front) : null;
      const br = col && col.backs[0] && !col.backs[0].hidden ? rectOf(col.backs[0]) : null;
      if (st) cur = st;
      // 前の飛んでいる箱があれば終わらせる
      for (const s of slotEls) s.querySelectorAll(".sbox.ghost").forEach((g) => { if (s.dataset.slot === String(out.slot)) g.remove(); });
      renderBoxes(cur);
      setPicLabel();
      const done = [];
      const slotEl = slotEls[out.slot];
      const box = slotEl && slotEl.querySelector(".sbox:not(.ghost)");
      if (!calm && box && fr && fr.width) {
        const tr = rectOf(slotEl);
        const ox = fr.left + fr.width / 2 - (tr.left + tr.width / 2), oy = fr.top + fr.height / 2 - (tr.top + tr.height / 2);
        const sx = tr.width ? fr.width / tr.width : 1, sy = tr.height ? fr.height / tr.height : 1;
        done.push(tween(250, (e) => {
          box.style.transform = e >= 1 ? "" : `translate(${(ox * (1 - e)).toFixed(1)}px,${(oy * (1 - e) - Math.sin(e * Math.PI) * 14).toFixed(1)}px) scale(${lerp(sx, 1, e).toFixed(3)},${lerp(sy, 1, e).toFixed(3)})`;
        }, ease.out));
        // 列が上へ詰まる（0.2 秒）
        if (col) {
          const shift = br && fr ? br.top - fr.top : fr.height;
          const els2 = [col.front].concat(col.backs).filter((x) => !x.hidden);
          done.push(tween(200, (e) => {
            for (const x of els2) x.style.transform = e >= 1 ? "" : `translateY(${(shift * (1 - e)).toFixed(1)}px)`;
          }, ease.out));
        }
      }
      // ふたが開く（0.25 秒）
      const opened = Array.isArray(out.opened) ? out.opened : [];
      for (const op of opened) {
        const ce = colEls[op.col];
        if (!ce || ce.front.hidden) continue;
        if (calm) continue;
        const lid = doc.createElement("span");
        lid.className = "blid lidfly";
        lid.setAttribute("aria-hidden", "true");
        lid.textContent = "？";
        lid.setAttribute("style", "position:absolute;left:0;right:0;top:0;height:50%;display:flex;align-items:center;justify-content:center;background:#8b5a33;border-bottom:2px solid #4a2c16;border-radius:6px 6px 2px 2px;color:#fff6e6;font-size:18px;font-weight:900;pointer-events:none;transform-origin:50% 0");
        ce.front.appendChild(lid);
        done.push(tween(250, (e) => {
          lid.style.transform = `translateY(${(-e * 22).toFixed(1)}px) rotate(${(-e * 25).toFixed(1)}deg)`;
          lid.style.opacity = String(1 - e);
        }, ease.out).then(() => lid.remove()));
      }
      // こおりがとける（0.3 秒、氷のかけら）
      const thawed = Array.isArray(out.thawed) ? out.thawed : [];
      for (const id of thawed) {
        const el = gridEl.querySelector(`.box[data-id="${id}"]`);
        if (!el || el.hidden) continue;
        const c = centerOf(rectOf(el));
        if (calm) continue;
        for (let i = 0; i < 9; i++) {
          const an = (i / 9) * Math.PI * 2;
          addPart({ x: c.x, y: c.y, vx: Math.cos(an) * 110, vy: Math.sin(an) * 110 - 40, color: i % 2 ? "#dff4ff" : "#9fd6f0", size: 3 + (i % 3), vr: 10, life: 0.3, shape: i % 3 ? "sq" : "star" });
        }
      }
      return Promise.all(done).then(() => {});
    }
    function deny(col) {
      const ce = colEls[col];
      if (!ce || ce.front.hidden) return Promise.resolve();
      const el = ce.front;
      if (calm) {
        el.dataset.deny = "1";
        return wait(250).then(() => { delete el.dataset.deny; });
      }
      return tween(250, (e, k) => {
        el.style.transform = k >= 1 ? "" : `translateX(${(Math.sin(k * Math.PI * 4) * 5 * (1 - k)).toFixed(1)}px)`;
      }, ease.linear);
    }
    let celebRes = null;
    function celebrate(pict) {
      const p = pict && Array.isArray(pict.cells) ? pict : picture;
      const myGen = gen;
      const np = nestPoint();
      if (nest) nest.dataset.glow = "1";
      const off = () => { if (nest) delete nest.dataset.glow; celeb = null; celebRes = null; };
      if (!p || !fctx) {
        return wait(calm ? 300 : 600).then(() => { if (myGen === gen) off(); });
      }
      // 完成した絵（オフスクリーン）
      const pw = p.W | 0, ph = p.H | 0;
      const cs = Math.max(2, cell);
      const img = mkCanvas(Math.round(pw * cs * fxDpr), Math.round(ph * cs * fxDpr));
      const ic = img.getContext("2d");
      if (ic) { ic.scale(fxDpr, fxDpr); drawPicture(ic, p, { cell: cs, marks: false }); }
      const pr = rectOf(pic);
      const full = { w: pw * cs * (cssW ? pr.width / cssW : 1), h: ph * cs * (cssW ? pr.width / cssW : 1) };
      const mid = centerOf(pr);
      const book = doc.getElementById("bookBtn");
      const bc = book ? centerOf(rectOf(book)) : { x: (win.innerWidth || 320) - 30, y: (win.innerHeight || 568) - 30 };
      celeb = { img, x: np.x, y: np.y, w: 0, h: 0, a: 0 };
      kick();
      const prom = new Promise((res) => {
        celebRes = res;
        const run = async () => {
          if (calm) {
            celeb.x = mid.x; celeb.y = mid.y; celeb.w = full.w; celeb.h = full.h;
            await tween(250, (e) => { if (celeb) celeb.a = e; }, ease.linear);
            if (myGen !== gen) return;
            await wait(450);
            if (myGen !== gen) return;
            await tween(250, (e) => { if (celeb) celeb.a = 1 - e; }, ease.linear);
            return;
          }
          addRing({ x: np.x, y: np.y, r0: 6, r1: 36, sx: 1.6, dur: 450, color: "#ffe9a8", width: 4 });
          await tween(500, (e) => {
            if (!celeb) return;
            celeb.x = lerp(np.x, mid.x, e); celeb.y = lerp(np.y, mid.y, e);
            celeb.w = full.w * lerp(0.15, 1, e); celeb.h = full.h * lerp(0.15, 1, e); celeb.a = Math.min(1, e * 1.6);
          }, ease.out, 120);
          if (myGen !== gen) return;
          for (let i = 0; i < 10; i++) {
            const an = (i / 10) * Math.PI * 2;
            addPart({ x: mid.x + Math.cos(an) * full.w * 0.5, y: mid.y + Math.sin(an) * full.h * 0.5, vx: Math.cos(an) * 60, vy: Math.sin(an) * 60, g: 0, color: i % 2 ? "#fff3b0" : "#ffd36b", size: 5, shape: "star", vr: 4, life: 0.5 });
          }
          await wait(330);
          if (myGen !== gen) return;
          await tween(500, (e) => {
            if (!celeb) return;
            celeb.x = lerp(mid.x, bc.x, e); celeb.y = lerp(mid.y, bc.y, e);
            celeb.w = full.w * lerp(1, 0.1, e); celeb.h = full.h * lerp(1, 0.1, e); celeb.a = 1 - e * e;
          }, ease.inOut);
        };
        run().then(() => { if (myGen === gen) { off(); res(); } });
      });
      return prom;
    }
    // 動いている絵を一瞬で終わりへ（ありんこは全部巣へ＝角砂糖は消す。待っている Promise もすぐ resolve。音は鳴らさない）
    function finishAll() {
      gen++;
      for (const a of ants) if (!a.lifted) { a.lifted = true; removeCell(a.cell); }
      ants.length = 0;
      for (const v of vanish) removeCell(v.cell);
      vanish.length = 0;
      endTweens();
      parts.length = 0;
      rings.length = 0;
      if (celebRes) { const r = celebRes; celebRes = null; r(); }
      celeb = null;
      if (nest) delete nest.dataset.glow;
      for (const s of slotEls) s.querySelectorAll(".sbox.ghost").forEach((g) => g.remove());
      for (const ce of colEls) { ce.front.style.transform = ""; ce.backs.forEach((b) => { b.style.transform = ""; }); ce.front.querySelectorAll(".lidfly").forEach((x) => x.remove()); delete ce.front.dataset.deny; }
      for (const s of slotEls) { const b = s.querySelector(".sbox"); if (b) b.style.transform = ""; }
      clearFx();
    }
    function pause() {
      paused = true;
      if (raf) { caf_(raf); raf = 0; }
      lastT = 0;
      pic.dataset.paused = "1";
    }
    function resume() {
      if (!paused) return;
      paused = false;
      lastT = 0;
      pic.dataset.paused = "0";
      kick();
    }
    function setCalm(v) {
      calm = !!v;
      for (const s of slotEls) s.dataset.calm = calm ? "1" : "0";
      slotsEl.dataset.calm = calm ? "1" : "0";
      if (calm) {
        // 歩いているありんこは、その場で終わらせる（角砂糖は消す）
        for (const a of ants) if (!a.lifted) { a.lifted = true; removeCell(a.cell); }
        ants.length = 0;
      }
    }
    function setFast(v) { fast = !!v; }
    function stats() {
      const s = frameTimes.slice().sort((a, b) => a - b);
      const med = s.length ? s[Math.floor(s.length / 2)] : 0;
      return { ants: ants.length, frameMs: Math.round(med * 100) / 100, redraws, full: fullDraws, running: !!raf, cell };
    }
    setCalm(calm);

    return {
      build, layout, update, carry, place, deny, celebrate, finishAll: () => finishAll(), pause, resume, setCalm, setFast, stats,
      get busy() { return !!(ants.length || tweens.size || vanish.length || celeb); },
      get calm() { return calm; },
      get fast() { return fast; },
      get paused() { return paused; }
    };
  }

  const api = Object.freeze({ MAX_ANTS, MARK_D, create, drawPicture, drawMark, drawCube, markSvg, markWord, colorInfo, inkFor });
  root.AmaiRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
