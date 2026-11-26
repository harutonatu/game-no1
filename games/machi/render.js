/*
 * ぼくのまち — 地図の描画とカメラ
 * 約束：docs/machi-contract.md §7.2（さわり方）・§7.3（めがね）・§11（描画の工夫）、計画書 docs/plans/machi.md §4.2。担当B だけが編集する。
 *
 * const r = MachiRender.create(canvas, { cssW, cssH, dpr });
 * r.setState(state)                 // 新しく始めた・読み込んだ：オフスクリーンを全部描き直し、地図全体を見せる
 * r.frame(state, events, dt) → bool // 毎コマ（変わる物が無ければ何も描かず false）
 * r.resize(cssW, cssH, dpr)
 * r.camera() → { cx, cy, cell }     // 見ている真ん中（マスの座標）と 1 マスの css px
 * r.setCamera({ cx, cy, cell })     // cell は 5〜28 に切る（画面が小さく地図全体が 5px で入らないときは、全体が入る大きさまで）
 * r.panBy(dxCss, dyCss); r.zoomBy(f, pxCss, pyCss); r.fit()
 * r.zoomTo(pxCss, pyCss, cell?)     // 追加：その点へ寄る（なめらかに。cell の既定 22）。小さすぎて置けないとき main が呼ぶ
 * r.cellAt(pxCss, pyCss) → { x, y, i } | null
 * r.setPreview({ tool, cells, ok, cost, label }) | r.setPreview(null)
 * r.setView('normal' | 'poll' | 'jam' | 'live' | 'land')
 * r.flash(i); r.focus(i); r.lookAt(i, cell?)  // lookAt：光らせずに寄る（いりぐちへ寄せる）
 * r.thumb(terrain, canvas)          // 地形えらびの小さな絵（terrain は W×H の Uint8Array。W=64・H=78 とみなす）
 * r.stats() → { drawMs, drawMsMed, chunks, cars, trains, far, frames, ticks, slowFrames, gapMed, gapP95, gapMax }
 *                                   // slowFrames は「frame() の呼び出しの間隔が 34ms をこえた数」（ほしくだき render.js の数え方。ticks はその数え方のコマの数）
 * r.resetClock()                    // 間隔の数えを切る（main が rAF を休んだ・裏から戻ったあと）
 * r.setEntry(cells | null)          // いりぐちの印（点滅のふち・「いりぐち」の札。動きを減らす設定では点滅しない）
 * r.busy() → bool                   // 動いている物（カメラ・光る・育つ・点滅・作りかけのチャンク）があるか（main が rAF を休むか決める）
 * MachiRender.drawIcon(canvas, tool) // 道具のボタンの絵（main が使ってよい）
 * MachiRender.MIN_PAINT_CELL = 14    // これより小さいと置かずに寄る（約束 §7.2）
 *
 * - 引いた絵（1 マスが 12 css px より小さい）：地図全体を 1 枚のオフスクリーン（1 マス 12 px・768×936）に描いておき、
 *   毎コマは drawImage 1 回。変わったマス（state.dirty と、gen・month が変わったときの見比べ）だけ描き直す
 * - 寄った絵：8×8 マスのチャンクごとのオフスクリーン（1 ドット d px。d は今の大きさに合わせた整数）をとっておく
 *   （画素の合計で上限。古いものから捨てる）。まだ無いチャンクは 1 コマに 3 枚まで作り、その間は引いた絵で代わりに見せる
 * - マスの絵は MachiSprites.describe の id ごとに小さな canvas へ一度だけ描いて写す（タイル）
 * - 「こんざつ」の ふきだし・置く前の影・光る所・めがね の色と模様・よごれの もや は毎コマ上に重ねる（小さな画像を 1 回写す）
 */
(function (root) {
  "use strict";

  const S = root.MachiSprites;
  const N = 12;           // 1 マスのドット数
  const CH = 8;           // チャンクの大きさ（マス）
  const MIN_CELL = 5, MAX_CELL = 28, NEAR_CELL = 12, MIN_PAINT_CELL = 14;
  const CHUNK_PIX_BUDGET = 12e6; // チャンクの画素の合計の上限（約 48MB）
  const CHUNK_MAX = 48;
  const BUILD_PER_FRAME = 2;
  const SLOW_MS = 34;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (root.performance && performance.now ? performance.now() : Date.now());
  const mkCanvas = (w, h) => {
    const c = root.document.createElement("canvas");
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  };
  const reduceMotion = () => { try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; } };
  const FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans CJK JP","Noto Sans JP",system-ui,sans-serif';

  // ---------- タイル（マスの絵）の置き場 ----------
  const tileCaches = new Map(); // d -> Map(id -> canvas)
  function tileOf(desc, d) {
    let m = tileCaches.get(d);
    if (!m) { m = new Map(); tileCaches.set(d, m); }
    let c = m.get(desc.id);
    if (c) return c;
    c = mkCanvas(N * d, N * d);
    const g = c.getContext("2d");
    S.paint(desc, (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * d, y * d, w * d, h * d); });
    m.set(desc.id, c);
    return c;
  }
  // 使わなくなった d のタイルを捨てる（d=1 は引いた絵の分なので残す）
  function dropTiles(keep) {
    for (const d of Array.from(tileCaches.keys())) if (d !== 1 && !keep.has(d)) tileCaches.delete(d);
  }

  function drawIcon(canvas, tool) {
    const desc = S.iconDesc(tool);
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!desc) return;
    const d = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / N));
    const ox = ((canvas.width - N * d) / 2) | 0, oy = ((canvas.height - N * d) / 2) | 0;
    S.paint(desc, (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(ox + x * d, oy + y * d, w * d, h * d); });
  }

  function create(canvas, opt) {
    opt = opt || {};
    const ctx = canvas.getContext("2d");
    let cssW = opt.cssW || canvas.clientWidth || 300, cssH = opt.cssH || canvas.clientHeight || 300;
    let dpr = opt.dpr || root.devicePixelRatio || 1;
    let st = null, W = 64, H = 78;
    let cam = { cx: 32, cy: 39, cell: 5.5 };
    let anim = null;              // { from, to, t, dur }
    let need = true;              // 次のコマで描く
    let atlas = null, actx = null; // 引いた絵（1 マス 12px）
    let aux = { mh: null };
    let shadow = null;            // 見比べ用の写し { terrain, use, kind, lvl, traffic, blocked }
    let lastGen = -1, lastMonth = -1;
    const chunks = new Map();     // "d:cx:cy" -> { d, c, used }
    let chunkTick = 0;
    let preview = null, view = "normal";
    let jam = null;               // { i, level }
    let flashes = [];             // { i, t }
    let builds = [];              // 育つ演出 { i, t }
    let overlay = null, overlayAt = -1, overlayKey = "";
    let haze = null, hazeKey = "";
    const times = []; let lastMs = 0, frames = 0, slow = 0;
    const gaps = []; let lastCallAt = 0, ticks = 0, gapMax = 0;
    let entryMark = null;         // いりぐちの印のマス [i, ...]
    let blinkT = 0;
    let missing = false;
    let movedAt = 0, roughFar = false;

    let lastCam = "";
    let lastCell = -1, zoomedAt = 0;
    function camMoved() {
      if (cam.cell !== lastCell) { lastCell = cam.cell; zoomedAt = now(); }
      const k = cam.cx.toFixed(3) + "," + cam.cy.toFixed(3) + "," + cam.cell.toFixed(3); if (k === lastCam) return false; lastCam = k; return true;
    }
    function setSize(w, h, r) {
      cssW = Math.max(1, w); cssH = Math.max(1, h); dpr = Math.max(1, Math.min(3, r || 1));
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
      clampCam(); need = true;
    }

    // ---------- カメラ ----------
    const fitCell = () => Math.min(cssW / W, cssH / H);
    const minCell = () => Math.min(MIN_CELL, fitCell());
    function clampCam(c) {
      c = c || cam;
      c.cell = clamp(c.cell, minCell(), MAX_CELL);
      const hw = cssW / 2 / c.cell, hh = cssH / 2 / c.cell;
      c.cx = W <= 2 * hw ? W / 2 : clamp(c.cx, hw, W - hw);
      c.cy = H <= 2 * hh ? H / 2 : clamp(c.cy, hh, H - hh);
      return c;
    }
    function camera() { const c = anim ? anim.to : cam; return { cx: cam.cx, cy: cam.cy, cell: cam.cell, target: c === cam ? null : { cx: c.cx, cy: c.cy, cell: c.cell } }; }
    function setCamera(c) {
      anim = null;
      cam = clampCam({ cx: +c.cx || cam.cx, cy: +c.cy || cam.cy, cell: +c.cell || cam.cell });
      need = true;
    }
    function panBy(dx, dy) {
      anim = null;
      cam.cx -= dx / cam.cell; cam.cy -= dy / cam.cell; clampCam(); need = true;
    }
    function zoomBy(f, px, py) {
      anim = null;
      if (!(f > 0)) return;
      if (px == null) { px = cssW / 2; py = cssH / 2; }
      const wx = cam.cx + (px - cssW / 2) / cam.cell, wy = cam.cy + (py - cssH / 2) / cam.cell;
      const nc = clamp(cam.cell * f, minCell(), MAX_CELL);
      cam.cell = nc;
      cam.cx = wx - (px - cssW / 2) / nc; cam.cy = wy - (py - cssH / 2) / nc;
      clampCam(); need = true;
    }
    function fit() { anim = null; cam = clampCam({ cx: W / 2, cy: H / 2, cell: fitCell() }); need = true; }
    function animateTo(to, dur) {
      to = clampCam({ cx: to.cx, cy: to.cy, cell: to.cell });
      if (reduceMotion()) { cam = to; anim = null; need = true; return; }
      anim = { from: { cx: cam.cx, cy: cam.cy, cell: cam.cell }, to, t: 0, dur: dur || 0.35 };
      need = true;
    }
    function zoomTo(px, py, cell) {
      const wx = cam.cx + (px - cssW / 2) / cam.cell, wy = cam.cy + (py - cssH / 2) / cam.cell;
      animateTo({ cx: wx, cy: wy, cell: Math.max(cam.cell, cell || 22) });
    }
    function cellAt(px, py) {
      const x = Math.floor(cam.cx + (px - cssW / 2) / cam.cell), y = Math.floor(cam.cy + (py - cssH / 2) / cam.cell);
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return { x, y, i: y * W + x };
    }
    function focus(i) {
      if (!(i >= 0 && i < W * H)) return;
      const x = i % W, y = (i / W) | 0;
      animateTo({ cx: x + 0.5, cy: y + 0.5, cell: Math.max(cam.cell, 22) }, 0.5);
      flash(i);
    }
    // そのマスへ寄る（光らせない）。cell は今より小さくしない
    function lookAt(i, cell) {
      if (!(i >= 0 && i < W * H)) return;
      const x = i % W, y = (i / W) | 0;
      animateTo({ cx: x + 0.5, cy: y + 0.5, cell: Math.max(cam.cell, cell || 22) }, 0.5);
    }
    function flash(i) { if (i >= 0 && i < W * H) { flashes.push({ i, t: 2 }); need = true; } }

    // ---------- 引いた絵（アトラス） ----------
    function paintAtlasCell(i) {
      const desc = S.describe(st, i, aux);
      const x = i % W, y = (i / W) | 0;
      actx.drawImage(tileOf(desc, 1), x * N, y * N);
      return desc;
    }
    function repaintChunksAt(i, desc) {
      const x = i % W, y = (i / W) | 0, kx = (x / CH) | 0, ky = (y / CH) | 0;
      for (const ch of chunks.values()) {
        if (ch.kx !== kx || ch.ky !== ky) continue;
        ch.g.drawImage(tileOf(desc, ch.d), (x - kx * CH) * N * ch.d, (y - ky * CH) * N * ch.d);
      }
    }
    function touchCell(i) {
      // マス i と まわり 8 マス（みちのつながり・岸の線が変わる）を描き直す
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        const desc = paintAtlasCell(j);
        if (chunks.size) repaintChunksAt(j, desc);
      }
    }
    function rebuildAll() {
      atlas = mkCanvas(W * N, H * N); actx = atlas.getContext("2d");
      aux.mh = S.mountainLevels(st);
      for (let i = 0; i < W * H; i++) paintAtlasCell(i);
      chunks.clear();
      shadow = {
        terrain: Uint8Array.from(st.terrain), use: Uint8Array.from(st.use), kind: Uint8Array.from(st.kind), lvl: Uint8Array.from(st.lvl),
        traffic: st.traffic ? Uint8Array.from(st.traffic) : new Uint8Array(W * H), blocked: st.blocked ? Uint8Array.from(st.blocked) : new Uint8Array(W * H),
      };
      lastGen = st.gen; lastMonth = st.month;
      findJam(); overlayAt = -1; hazeKey = "";
      need = true;
    }
    // gen・month が変わったとき：写しと見比べて違うマスだけ描き直す（dirty の漏れに強くする）
    function diffScan() {
      const n = W * H, sh = shadow;
      const T = st.terrain, U = st.use, K = st.kind, L = st.lvl, TR = st.traffic, BL = st.blocked;
      let changed = 0;
      let mtn = false;
      for (let i = 0; i < n; i++) {
        const tr = TR ? TR[i] : 0, bl = BL ? BL[i] : 0;
        if (T[i] !== sh.terrain[i] || U[i] !== sh.use[i] || K[i] !== sh.kind[i] || L[i] !== sh.lvl[i] || tr !== sh.traffic[i] || (bl ? 1 : 0) !== (sh.blocked[i] ? 1 : 0)) {
          if (T[i] !== sh.terrain[i] && (T[i] === 3 || sh.terrain[i] === 3)) mtn = true;
          sh.terrain[i] = T[i]; sh.use[i] = U[i]; sh.kind[i] = K[i]; sh.lvl[i] = L[i]; sh.traffic[i] = tr; sh.blocked[i] = bl;
          touchCell(i); changed++;
        }
      }
      if (mtn) aux.mh = S.mountainLevels(st);
      return changed;
    }
    function findJam() {
      jam = null;
      const TR = st && st.traffic;
      if (!TR) return;
      let best = -1, lv = 1;
      for (let i = 0; i < TR.length; i++) if (TR[i] > lv) { lv = TR[i]; best = i; }
      if (best >= 0) jam = { i: best, level: lv };
    }

    function setState(state) {
      st = state;
      W = state.W || 64; H = state.H || 78;
      rebuildAll();
      if (Array.isArray(st.dirty)) st.dirty.length = 0;
      fit();
    }

    // ---------- チャンク ----------
    function chunkD() { return clamp(Math.round(cam.cell * dpr / N), 2, 7); }
    function getChunk(kx, ky, d, allowBuild) {
      const key = d + ":" + kx + ":" + ky;
      let ch = chunks.get(key);
      if (ch) { ch.used = ++chunkTick; return ch; }
      if (!allowBuild) return null;
      const size = CH * N * d;
      const c = mkCanvas(size, size), g = c.getContext("2d");
      for (let yy = 0; yy < CH; yy++) for (let xx = 0; xx < CH; xx++) {
        const x = kx * CH + xx, y = ky * CH + yy;
        if (x >= W || y >= H) continue;
        g.drawImage(tileOf(S.describe(st, y * W + x, aux), d), xx * N * d, yy * N * d);
      }
      ch = { d, kx, ky, c, g, used: ++chunkTick, pix: size * size };
      chunks.set(key, ch);
      trimChunks(d);
      return ch;
    }
    function trimChunks(curD) {
      let pix = 0;
      for (const ch of chunks.values()) pix += ch.pix;
      if (pix <= CHUNK_PIX_BUDGET && chunks.size <= CHUNK_MAX) return;
      const list = Array.from(chunks.entries()).sort((a, b) => (a[1].d === curD) - (b[1].d === curD) || a[1].used - b[1].used);
      for (const [k, ch] of list) {
        if (pix <= CHUNK_PIX_BUDGET && chunks.size <= CHUNK_MAX) break;
        chunks.delete(k); pix -= ch.pix;
      }
      const keep = new Set(); for (const ch of chunks.values()) keep.add(ch.d);
      dropTiles(keep);
    }

    // ---------- めがね・もや（1 マス 1〜4 px の小さな画像） ----------
    function viewValue(i) {
      if (view === "jam") return st.use[i] === 1 || st.use[i] === 3 ? (st.traffic ? st.traffic[i] : 0) / 3 : -1;
      if (view === "poll") { const x = i % W, y = (i / W) | 0; return st.poll ? st.poll[((y >> 2) * (W >> 2)) + (x >> 2)] / 100 : 0; }
      if (view === "live") return st.use[i] === 5 && st.live ? st.live[i] / 100 : -1;
      if (view === "land") { const t = st.terrain[i]; return t === 1 || t === 2 || t === 3 ? -1 : st.land ? st.land[i] / 100 : 0; }
      return -1;
    }
    // 色（悪い＝赤・良い＝青みどり）と模様（悪いほど点が多い）。poll・jam は高いほど悪い、live・land は高いほど良い
    function buildOverlay() {
      const P = 4;
      if (!overlay) overlay = mkCanvas(W * P, H * P);
      if (overlay.width !== W * P || overlay.height !== H * P) { overlay.width = W * P; overlay.height = H * P; }
      const g = overlay.getContext("2d");
      const img = g.createImageData(W * P, H * P), a = img.data;
      const bad = view === "poll" || view === "jam";
      for (let i = 0; i < W * H; i++) {
        let v = viewValue(i);
        if (v < 0) continue;
        v = clamp(v, 0, 1);
        const b = bad ? v : 1 - v; // 0 良い〜1 悪い
        const r = b < 0.5 ? Math.round(60 + 390 * b) : 250, gg = b < 0.5 ? 200 : Math.round(200 - 300 * (b - 0.5)), bl = b < 0.5 ? Math.round(170 - 200 * b) : 60;
        const x = i % W, y = (i / W) | 0;
        // 模様（色だけに頼らない。凡例 main の #viewLegend と同じ 3 段）：よい＝模様なし・ふつう＝点・わるい＝✕
        const lvl = b < 1 / 3 ? 0 : b < 2 / 3 ? 1 : 2;
        for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) {
          const o = ((y * P + py) * W * P + (x * P + px)) * 4;
          let dot = false;
          if (lvl === 1) dot = px === 1 && py === 1;
          else if (lvl === 2) dot = px === py || px + py === P - 1;
          a[o] = dot ? 40 : r; a[o + 1] = dot ? 30 : gg; a[o + 2] = dot ? 40 : bl; a[o + 3] = dot ? 150 : 120;
        }
      }
      g.putImageData(img, 0, 0);
    }
    function buildHaze() {
      // よごれ 40 以上の区画（4×4 マス）に、うすい灰色の点々
      const P = 4, BW = W >> 2, BH = Math.ceil(H / 4);
      if (!haze) haze = mkCanvas(W * P, H * P);
      const g = haze.getContext("2d");
      const img = g.createImageData(W * P, H * P), a = img.data;
      let any = false;
      for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
        const p = st.poll[by * BW + bx];
        if (p < 40) continue;
        any = true;
        const al = Math.round(clamp((p - 30) / 70, 0.1, 0.55) * 255);
        for (let y = by * 4 * P; y < Math.min(H * P, (by + 1) * 4 * P); y++) for (let x = bx * 4 * P; x < (bx + 1) * 4 * P; x++) {
          if ((x + y) % 2) continue;
          const o = (y * W * P + x) * 4;
          a[o] = 120; a[o + 1] = 120; a[o + 2] = 132; a[o + 3] = al;
        }
      }
      g.putImageData(img, 0, 0);
      return any;
    }
    let hazeAny = false;

    // ---------- 1 コマ ----------
    function frame(state, events, dt) {
      if (!state) return false;
      // コマの間隔（canvas の命令はあとでまとめて描かれるので、draw() の JS の時間ではなく 呼ばれる間隔で重さを数える。ほしくだき と同じ）
      const tc = now();
      if (lastCallAt) {
        const gap = tc - lastCallAt;
        if (gap < 1000) {               // 1 秒より長い間は休み（裏・rAF を休んだ）とみなして数えない
          ticks++;
          if (gap > SLOW_MS) slow++;
          if (gap > gapMax) gapMax = gap;
          gaps.push(gap); if (gaps.length > 240) gaps.shift();
        }
      }
      lastCallAt = tc;
      if (state !== st) setState(state);
      dt = typeof dt === "number" && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;
      if (events && events.length) {
        for (const e of events) {
          if (!e) continue;
          if (e.kind === "jam") { jam = e.level >= 2 && e.i >= 0 ? { i: e.i, level: e.level } : null; need = true; }
          else if (e.kind === "grow" && !reduceMotion() && cam.cell >= NEAR_CELL) { builds.push({ i: e.i, t: 0.8 }); if (builds.length > 30) builds.shift(); need = true; }
        }
      }
      // 変わったマス
      if (Array.isArray(st.dirty) && st.dirty.length) {
        const D = st.dirty;
        if (D.length > 1200) rebuildAll();
        else {
          for (let k = 0; k < D.length; k++) {
            const i = D[k];
            if (i >= 0 && i < W * H) {
              const sh = shadow; sh.terrain[i] = st.terrain[i]; sh.use[i] = st.use[i]; sh.kind[i] = st.kind[i]; sh.lvl[i] = st.lvl[i];
              sh.traffic[i] = st.traffic ? st.traffic[i] : 0; sh.blocked[i] = st.blocked ? st.blocked[i] : 0;
              touchCell(i);
            }
          }
        }
        D.length = 0; need = true;
      }
      if (st.gen !== lastGen || st.month !== lastMonth) {
        const monthChanged = st.month !== lastMonth;
        lastGen = st.gen; lastMonth = st.month;
        if (diffScan()) need = true;
        if (monthChanged) {
          if (!jam || !st.traffic || st.traffic[jam.i] < 2) findJam();
          overlayAt = -1; hazeKey = ""; need = true;
        }
      }
      if (anim) {
        anim.t += dt;
        const k = Math.min(1, anim.t / anim.dur), e = 1 - Math.pow(1 - k, 3);
        cam.cell = anim.from.cell + (anim.to.cell - anim.from.cell) * e;
        cam.cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e;
        cam.cy = anim.from.cy + (anim.to.cy - anim.from.cy) * e;
        clampCam();
        if (k >= 1) anim = null;
        need = true;
      }
      if (flashes.length) { for (const f of flashes) f.t -= dt; flashes = flashes.filter((f) => f.t > 0); need = true; }
      if (builds.length) { for (const b of builds) b.t -= dt; builds = builds.filter((b) => b.t > 0); need = true; }
      if (roughFar && now() - movedAt > 200) need = true;
      if (entryMark) {
        if (!reduceMotion()) { const b0 = Math.floor(blinkT * 2); blinkT += dt; if (Math.floor(blinkT * 2) !== b0) need = true; }
      }
      if (!need && !missing) return false;
      if (camMoved()) movedAt = now();
      need = false;
      const t0 = now();
      draw();
      lastMs = now() - t0;
      times.push(lastMs); if (times.length > 120) times.shift();
      frames++;
      return true;
    }

    function draw() {
      const s = cam.cell * dpr;                 // 1 マスの device px
      const ox = Math.round(canvas.width / 2 - cam.cx * s), oy = Math.round(canvas.height / 2 - cam.cy * s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#e9d7b0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      missing = false;
      const far = cam.cell < NEAR_CELL;
      // 見えているマスの範囲
      const x0 = Math.max(0, Math.floor(-ox / s)), y0 = Math.max(0, Math.floor(-oy / s));
      const x1 = Math.min(W, Math.ceil((canvas.width - ox) / s)), y1 = Math.min(H, Math.ceil((canvas.height - oy) / s));
      if (far) {
        // 引いた絵は ふつうは画素をそのまま（はっきり・軽い）。縮める（1 マスが 12 device px 未満）ときだけ、止まってから なめらかに描き直す
        const smooth = s < N && now() - movedAt > 200;
        ctx.imageSmoothingEnabled = smooth;
        if (smooth) ctx.imageSmoothingQuality = "high";
        roughFar = s < N && !smooth;
        ctx.drawImage(atlas, x0 * N, y0 * N, (x1 - x0) * N, (y1 - y0) * N, ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
      } else {
        ctx.imageSmoothingEnabled = false;
        const d = chunkD();
        // 拡大縮小している間はチャンクを作らない（ある物か引いた絵で代わりに見せ、止まってから作る）
        let built = now() - zoomedAt < 150 ? BUILD_PER_FRAME : 0;
        const kx0 = (x0 / CH) | 0, ky0 = (y0 / CH) | 0, kx1 = ((x1 - 1) / CH) | 0, ky1 = ((y1 - 1) / CH) | 0;
        for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) {
          let ch = chunks.get(d + ":" + kx + ":" + ky) || null;
          if (ch) ch.used = ++chunkTick;
          else if (built < BUILD_PER_FRAME) { ch = getChunk(kx, ky, d, true); built++; }
          const cw = Math.min(CH, W - kx * CH), chh = Math.min(CH, H - ky * CH);
          const dx0 = Math.round(ox + kx * CH * s), dy0 = Math.round(oy + ky * CH * s);
          const dx1 = Math.round(ox + (kx * CH + cw) * s), dy1 = Math.round(oy + (ky * CH + chh) * s);
          if (!ch) {
            // まだ無い：ほかの d のチャンクか、引いた絵で代わりに
            let alt = null;
            for (const c2 of chunks.values()) if (c2.kx === kx && c2.ky === ky) { alt = c2; break; }
            if (alt) ctx.drawImage(alt.c, 0, 0, cw * N * alt.d, chh * N * alt.d, dx0, dy0, dx1 - dx0, dy1 - dy0);
            else ctx.drawImage(atlas, kx * CH * N, ky * CH * N, cw * N, chh * N, dx0, dy0, dx1 - dx0, dy1 - dy0);
            missing = true;
            continue;
          }
          ctx.drawImage(ch.c, 0, 0, cw * N * d, chh * N * d, dx0, dy0, dx1 - dx0, dy1 - dy0);
        }
      }
      // よごれの もや（ふつうの見かた）
      if (st.poll && view === "normal") {
        const key = st.month + ":" + st.gen;
        if (hazeKey !== key) { hazeAny = buildHaze(); hazeKey = key; }
        if (hazeAny) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(haze, x0 * 4, y0 * 4, (x1 - x0) * 4, (y1 - y0) * 4, ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
        }
      }
      // めがね
      if (view !== "normal") {
        if (overlayAt !== st.month || overlayKey !== view + ":" + st.gen) { buildOverlay(); overlayAt = st.month; overlayKey = view + ":" + st.gen; }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(overlay, x0 * 4, y0 * 4, (x1 - x0) * 4, (y1 - y0) * 4, ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
      }
      // 育つ演出（足場の枠）
      for (const b of builds) {
        const x = b.i % W, y = (b.i / W) | 0;
        const a = clamp(b.t / 0.8, 0, 1);
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = Math.max(1, s * 0.08);
        const pad = s * 0.08;
        ctx.strokeRect(ox + x * s + pad, oy + y * s + pad, s - pad * 2, s - pad * 2);
        ctx.fillStyle = "#ffffff";
        const sp = s * 0.12;
        ctx.fillRect(ox + x * s + s * 0.5 - sp / 2, oy + y * s - s * 0.25 * (1 - a), sp, sp);
        ctx.globalAlpha = 1;
      }
      // 置く前の影
      if (preview && preview.cells && preview.cells.length) drawPreview(ox, oy, s);
      // いりぐちの印
      if (entryMark) drawEntry(ox, oy, s);
      // 光る所
      for (const f of flashes) {
        const x = f.i % W, y = (f.i / W) | 0;
        const on = Math.floor(f.t * 4) % 2 === 0;
        ctx.lineWidth = Math.max(2, s * 0.14);
        ctx.strokeStyle = on ? "#ffffff" : "#ff7a2f";
        const r = Math.max(s, 10 * dpr);
        ctx.strokeRect(ox + (x + 0.5) * s - r / 2 - s * 0.15, oy + (y + 0.5) * s - r / 2 - s * 0.15, r + s * 0.3, r + s * 0.3);
      }
      // こんざつ の ふきだし
      if (jam && jam.level >= 2) drawJamTag(ox, oy, s);
    }

    function drawPreview(ox, oy, s) {
      const p = preview;
      const ok = p.ok !== false;
      ctx.fillStyle = ok ? "rgba(255,255,255,.42)" : "rgba(232,60,44,.38)";
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, lx = 0, ly = 0;
      for (const i of p.cells) {
        if (!(i >= 0 && i < W * H)) continue;
        const x = i % W, y = (i / W) | 0;
        ctx.fillRect(ox + x * s, oy + y * s, s, s);
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        lx = x; ly = y;
      }
      if (maxX < 0) return;
      ctx.lineWidth = Math.max(1.5, dpr * 1.5);
      ctx.strokeStyle = ok ? "#2f7a2a" : "#c0281e";
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeRect(ox + minX * s + 0.5, oy + minY * s + 0.5, (maxX - minX + 1) * s - 1, (maxY - minY + 1) * s - 1);
      ctx.setLineDash([]);
      // 値段と名前の札（最後のマスの上）
      const txt = (p.label ? p.label + " " : "") + (typeof p.cost === "number" ? String(p.cost).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "");
      if (txt.trim()) bubble(ox + (lx + 0.5) * s, oy + ly * s - 4 * dpr, txt.trim(), ok ? "#3b2a1a" : "#c0281e", "#ffffff");
    }
    function bubble(x, y, text, bg, fg) {
      const fs = 12 * dpr;
      ctx.font = "800 " + fs + "px " + FONT;
      const w = ctx.measureText(text).width + 14 * dpr, h = fs + 9 * dpr;
      let bx = clamp(x - w / 2, 2 * dpr, canvas.width - w - 2 * dpr), by = y - h - 5 * dpr;
      if (by < 2 * dpr) by = y + 30 * dpr;
      ctx.fillStyle = bg;
      roundRect(bx, by, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, 1.5 * dpr); ctx.stroke();
      if (by < y) {
        ctx.beginPath(); ctx.moveTo(x - 5 * dpr, by + h - 0.5); ctx.lineTo(x + 5 * dpr, by + h - 0.5); ctx.lineTo(x, by + h + 5 * dpr); ctx.closePath();
        ctx.fillStyle = bg; ctx.fill();
      }
      ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5 * dpr);
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
      ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
      ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      ctx.closePath();
    }
    function drawEntry(ox, oy, s) {
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (const i of entryMark) { const x = i % W, y = (i / W) | 0; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
      if (maxX < 0) return;
      const on = reduceMotion() || Math.floor(blinkT * 2) % 2 === 0;
      const pad = Math.max(3 * dpr, s * 0.25);
      const bx = ox + minX * s - pad, by = oy + minY * s - pad, bw = (maxX - minX + 1) * s + pad * 2, bh = (maxY - minY + 1) * s + pad * 2;
      ctx.lineWidth = Math.max(3 * dpr, s * 0.16);
      ctx.strokeStyle = on ? "#ff5a1f" : "#ffffff";
      ctx.strokeRect(bx, by, bw, bh);
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = on ? "#ffffff" : "#ff5a1f";
      ctx.strokeRect(bx - ctx.lineWidth * 2, by - ctx.lineWidth * 2, bw + ctx.lineWidth * 4, bh + ctx.lineWidth * 4);
      // 札（印の下。地図の上の端に近いので下に出す）
      const fs = 13 * dpr;
      ctx.font = "800 " + fs + "px " + FONT;
      const text = "いりぐち";
      const w = ctx.measureText(text).width + 16 * dpr, h = fs + 10 * dpr;
      const cx = clamp(bx + bw / 2, w / 2 + 2 * dpr, canvas.width - w / 2 - 2 * dpr);
      let ty = by + bh + 8 * dpr;
      if (ty + h > canvas.height - 2 * dpr) ty = Math.max(2 * dpr, by - h - 8 * dpr);
      ctx.fillStyle = "#ff5a1f";
      roundRect(cx - w / 2, ty, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, 1.5 * dpr); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, cx, ty + h / 2 + 0.5 * dpr);
    }
    function drawJamTag(ox, oy, s) {
      const x = jam.i % W, y = (jam.i / W) | 0;
      const px = ox + (x + 0.5) * s, py = oy + (y + 0.15) * s;
      if (px < -50 || py < -50 || px > canvas.width + 50 || py > canvas.height + 50) return;
      const fs = (cam.cell >= NEAR_CELL ? 13 : 10) * dpr;
      ctx.font = "800 " + fs + "px " + FONT;
      const text = jam.level >= 3 ? "おおこんざつ" : "こんざつ";
      const w = ctx.measureText(text).width + 14 * dpr, h = fs + 8 * dpr;
      // 地図の端で札が欠けない（濁点が切れない）ように、札を内側へ寄せる。上に入らなければ下に出す
      const m = 4 * dpr;
      const bx = clamp(px - w / 2, m, canvas.width - w - m);
      let by = py - h - 6 * dpr;
      const below = by < m;
      if (below) by = oy + (y + 1) * s + 6 * dpr;
      ctx.fillStyle = "#e8352c";
      roundRect(bx, by, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, 1.5 * dpr); ctx.stroke();
      const tipX = clamp(px, bx + h / 2, bx + w - h / 2);
      ctx.beginPath();
      if (below) { ctx.moveTo(tipX - 5 * dpr, by + 0.5); ctx.lineTo(tipX + 5 * dpr, by + 0.5); ctx.lineTo(px, oy + (y + 0.85) * s); }
      else { ctx.moveTo(tipX - 5 * dpr, by + h - 0.5); ctx.lineTo(tipX + 5 * dpr, by + h - 0.5); ctx.lineTo(px, py); }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5 * dpr);
    }

    function setPreview(p) {
      preview = p && Array.isArray(p.cells) ? { tool: p.tool, cells: p.cells.slice(0, 200), ok: p.ok, cost: p.cost, label: p.label } : null;
      need = true;
    }
    function setView(v) {
      v = ["normal", "poll", "jam", "live", "land"].indexOf(v) >= 0 ? v : "normal";
      if (v !== view) { view = v; overlayAt = -1; need = true; }
    }

    function thumb(terrain, c) {
      const tw = 64, th = 78;
      if (!terrain || terrain.length < tw * th) return;
      const fake = { W: tw, H: th, terrain };
      const mh = S.mountainLevels(fake);
      const small = mkCanvas(tw, th), g = small.getContext("2d");
      const img = g.createImageData(tw, th), a = img.data;
      for (let i = 0; i < tw * th; i++) {
        const t = terrain[i], hex = S.terrainColor(t, mh[i]);
        let r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        if (t === 0 && ((i % tw) + ((i / tw) | 0)) % 2) { r -= 6; gg -= 6; b -= 6; }
        a[i * 4] = r; a[i * 4 + 1] = gg; a[i * 4 + 2] = b; a[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const cg = c.getContext("2d");
      cg.imageSmoothingEnabled = false;
      cg.clearRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / tw, c.height / th);
      const w = tw * k, h = th * k;
      cg.drawImage(small, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }

    function stats() {
      const sorted = times.slice().sort((a, b) => a - b);
      const gs = gaps.slice().sort((a, b) => a - b);
      return {
        drawMs: Math.round(lastMs * 100) / 100,
        drawMsMed: sorted.length ? Math.round(sorted[sorted.length >> 1] * 100) / 100 : 0,
        chunks: chunks.size, cars: 0, trains: 0, far: cam.cell < NEAR_CELL, frames, ticks, slowFrames: slow,
        gapMed: gs.length ? Math.round(gs[gs.length >> 1] * 10) / 10 : 0,
        gapP95: gs.length ? Math.round(gs[Math.min(gs.length - 1, Math.floor(gs.length * 0.95))] * 10) / 10 : 0,
        gapMax: Math.round(gapMax * 10) / 10,
        cell: Math.round(cam.cell * 100) / 100,
        preview: preview ? (preview.label || "") : null,   // テスト用：置く前の札の文
      };
    }

    setSize(cssW, cssH, dpr);
    return {
      setState, frame, resize: setSize, camera, setCamera, panBy, zoomBy, fit, zoomTo, cellAt,
      setPreview, setView, flash, focus, lookAt, thumb, stats,
      resetClock: () => { lastCallAt = 0; },
      setEntry: (cells) => {
        const next = Array.isArray(cells) && cells.length ? cells.filter((i) => i >= 0 && i < W * H) : null;
        if (String(next) !== String(entryMark)) { entryMark = next && next.length ? next : null; blinkT = 0; need = true; }
      },
      busy: () => need || !!anim || flashes.length > 0 || builds.length > 0 || missing || roughFar || (!!entryMark && !reduceMotion()),
      entryCells: () => (entryMark ? entryMark.slice() : null),
      view: () => view,
      redraw: () => { need = true; },
    };
  }

  root.MachiRender = { create, drawIcon, MIN_PAINT_CELL, MIN_CELL, MAX_CELL, NEAR_CELL };
})(typeof window !== "undefined" ? window : globalThis);
