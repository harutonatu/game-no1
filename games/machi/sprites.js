/*
 * ぼくのまち — ドット絵の表（1 マス 12×12 ドット・真上から見た絵）
 * 約束：docs/machi-contract.md §5.1・§5.4・§5.8・§11（見本 A：docs/img/machi-mock2-A.png・machi-mock-A-zoom.png）。担当B だけが編集する。
 *
 * window.MachiSprites = {
 *   N: 12,                                  // 1 マスのドット数
 *   describe(state, i, aux) → desc          // マス i の絵の形（desc.id が絵の名前。同じ id は同じ絵）
 *   paint(desc, R)                          // R(x, y, w, h, color)：ドットの座標（0〜12）で四角を塗る
 *   iconDesc(tool) → desc                   // 道具のボタンの絵（main が MachiRender.drawIcon で使う）
 *   terrainColor(t, lv) → "#rrggbb"         // 地形えらびの小さな絵の色
 *   mountainLevels(state) → Uint8Array      // やま の高さ 0〜5（まわりの やま の数から。aux.mh に入れる）
 * }
 * - 絵は一から描いたもの（ほかのゲームの絵・アイコンは写さない）
 * - 区画の種類は色だけでなく形で見分ける：アパート＝横の線（ベランダ）、マンション＝窓の格子と影、
 *   住宅地＝屋根の棟（まんなかの線）と庭、高級住宅地＝生け垣と池、こうば＝のこぎり屋根と煙突、
 *   おみせ＝しま模様の日よけ、ビル＝細かい窓と長い影、はたけ＝うね、林業＝丸太、漁港＝船と波止場
 */
(function (root) {
  "use strict";

  const N = 12;

  // 色（見本 A の色。名前で引く）
  const C = {
    grassA: "#cddb8f", grassB: "#d3df96", flowerW: "#ffffff", flowerP: "#f49ab0", flowerY: "#ffe066",
    sea: "#58a8d8", seaHi: "#86c6ec", seaFoam: "#d6eefa",
    river: "#6bb7e0", riverHi: "#9ad2ef", riverBank: "#c8e8f6",
    sand: "#ecd9a0", sandDot: "#d8c184",
    forest: "#79a74e", forestA: "#3f7f3a", forestB: "#2f6a2c", forestC: "#5f9a44", forestHi: "#9cc865",
    mtn: ["#8a9a5a", "#9a9266", "#a89a7e", "#bdb4a2", "#dcd8cc", "#f4f6f8"],
    mtnShade: "rgba(60,50,30,.16)",
    road: "#c2ae92", roadEdge: "#a8957b", roadLine: "#f7edd2", bridgeEdge: "#7a5a3a",
    jam: "rgba(232,60,44,.32)",
    ballast: "#b9b4a8", tie: "#8a6a46", rail: "#454552",
    yard: "#a9d870", yardEdge: "#86b858", wall: "#fff2d6",
    hedge: "#2f8a3a", lawn: "#8fd36a", pond: "#4fc3f7", pondHi: "#b8ecff", villaRoof: "#5a6fb0", villaRidge: "#3f4f8a",
    apt: "#e9a05c", aptLine: "#b86a3a", aptWin: "#fff6e0",
    man: "#6a63b4", manWin: "#c3caf5", manShadow: "#343a66", manTop: "#8a85cf",
    ofc: "#3f9bb4", ofcWin: "#bff0fa", ofcShadow: "#25596d",
    fac: "#8f97a8", facHi: "#c9d0dc", facBase: "#4a5368", chim: "#b9382a", smoke: "#f4f4f4",
    eco: "#e3e8ee", ecoPanel: "#3d6ca8", ecoEdge: "#5fbf6a",
    shopRoof: "#f2c14e", awnR: "#e0503c", awnW: "#fff2d6", shopBase: "#b9a06a",
    soil: "#a47a48", soilD: "#8a6038", cropA: "#a7d964", cropB: "#7fc04e", gold: "#e8c860", goldD: "#d4a940",
    log: "#8a5a36", logEnd: "#e0b47a", hutRoof: "#b9382a",
    dock: "#c9d0dc", dockLine: "#8f97a8", plank: "#b9a06a", boat: "#ffffff", boatR: "#e0503c",
    zone: { 5: "#e8604c", 6: "#6f7890", 7: "#e8a21a", 8: "#8a6a3a" },
    shadow: "rgba(40,40,60,.22)",
    cars: ["#e8473a", "#3b82d9", "#f2c14e", "#ffffff", "#4caf6a", "#9a5ad0"],
    puddle: "#6bb7e0", sign: "#2f8a3a",
  };
  const ROOFS = [["#e0503c", "#b9382a"], ["#5b8fd0", "#3d6ca8"], ["#5fae5a", "#3f8a3c"], ["#c07a48", "#8f5530"]];

  // 決まった値の乱数（マスの添字と塩から 0〜1）
  function hs(i, s) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // 文字の絵（12×12。"." は塗らない）
  const TREE = [
    "............",
    "....dLLd....",
    "...dLhhLd...",
    "..dLhhLLLd..",
    "..dLhLLLLd..",
    "..dLLLLLLd..",
    "...dLLLLd...",
    "....ddLd....",
    ".....tt.....",
    ".....tt.....",
    "............",
    "............",
  ];
  const TREE_PAL = { d: "#2f7a2a", L: "#7fc04e", h: "#a7d964", t: "#8a5a36" };
  function spr(rows, pal, R, ox, oy) {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      let run = 0, rc = "";
      for (let i = 0; i <= row.length; i++) {
        const ch = i < row.length ? row[i] : ".";
        if (ch === rc && ch !== ".") { run++; continue; }
        if (rc && rc !== "." && run) R(ox + i - run, oy + j, run, 1, pal[rc]);
        rc = ch; run = ch === "." ? 0 : 1;
      }
    }
  }
  function smallTree(R, x, y) { // 3×4
    R(x, y, 3, 3, "#3f9a4a"); R(x + 1, y, 1, 1, "#7fc04e"); R(x + 1, y + 3, 1, 1, "#8a5a36");
  }

  // ---------- 地形 ----------
  function grass(R, d) {
    R(0, 0, N, N, d.par ? C.grassB : C.grassA);
    if (d.fl === 1) R(3, 4, 1, 1, C.flowerW);
    else if (d.fl === 2) { R(7, 3, 1, 1, C.flowerP); R(4, 8, 1, 1, C.flowerW); }
    else if (d.fl === 3) R(8, 7, 1, 1, C.flowerY);
  }
  function water(R, d, sea) {
    R(0, 0, N, N, sea ? C.sea : C.river);
    const hi = sea ? C.seaHi : C.riverHi;
    if (d.v === 1) { R(2, 4, 3, 1, hi); R(7, 8, 3, 1, hi); }
    else if (d.v === 2) { R(6, 2, 3, 1, hi); }
    const f = sea ? C.seaFoam : C.riverBank, m = d.m;
    if (m & 1) R(0, 0, N, 1, f);
    if (m & 4) R(0, N - 1, N, 1, f);
    if (m & 8) R(0, 0, 1, N, f);
    if (m & 2) R(N - 1, 0, 1, N, f);
  }
  function sand(R, d) {
    R(0, 0, N, N, C.sand);
    if (d.v === 1) { R(3, 3, 1, 1, C.sandDot); R(8, 8, 1, 1, C.sandDot); }
    else if (d.v === 2) { R(7, 2, 1, 1, C.sandDot); R(2, 9, 1, 1, C.sandDot); }
  }
  function mountain(R, d) {
    R(0, 0, N, N, C.mtn[d.lv]);
    if (d.v === 1) R(3, 3, 6, 6, C.mtnShade);
    else if (d.v === 2) { R(1, 6, 4, 4, C.mtnShade); R(7, 1, 3, 3, C.mtnShade); }
    if (d.lv >= 4 && d.v === 0) R(4, 5, 3, 2, "rgba(255,255,255,.35)");
  }
  function forest(R, d) {
    R(0, 0, N, N, C.forest);
    if (d.v === 0) {
      R(1, 1, 5, 5, C.forestA); R(2, 2, 2, 2, C.forestB); R(2, 1, 2, 1, C.forestHi);
      R(6, 6, 5, 5, C.forestA); R(7, 7, 2, 2, C.forestB); R(7, 6, 2, 1, C.forestHi);
      R(7, 1, 3, 3, C.forestC);
    } else {
      R(6, 1, 5, 5, C.forestA); R(7, 2, 2, 2, C.forestB); R(7, 1, 2, 1, C.forestHi);
      R(1, 6, 5, 5, C.forestA); R(2, 7, 2, 2, C.forestB); R(2, 6, 2, 1, C.forestHi);
      R(2, 1, 3, 3, C.forestC);
    }
  }

  // ---------- みち・せんろ ----------
  function roadBase(R, d) {
    if (d.br) R(0, 0, N, N, d.br === 2 ? C.sea : C.river);
    const m = d.m;
    if (d.br) {
      // はし：道の向きに板を渡し、両脇に欄干
      const hz = (m & 10) || !(m & 5);
      if (hz) { R(0, 2, N, 8, C.road); R(0, 1, N, 1, C.bridgeEdge); R(0, 10, N, 1, C.bridgeEdge); }
      else { R(2, 0, 8, N, C.road); R(1, 0, 1, N, C.bridgeEdge); R(10, 0, 1, N, C.bridgeEdge); }
      if ((m & 10) && (m & 5)) { R(0, 2, N, 8, C.road); R(2, 0, 8, N, C.road); }
    } else {
      R(0, 0, N, N, C.road);
      if (!(m & 1)) R(0, 0, N, 1, C.roadEdge);
      if (!(m & 4)) R(0, N - 1, N, 1, C.roadEdge);
      if (!(m & 8)) R(0, 0, 1, N, C.roadEdge);
      if (!(m & 2)) R(N - 1, 0, 1, N, C.roadEdge);
    }
  }
  function roadMarks(R, d) {
    const m = d.m, hz = m & 10, vt = m & 5;
    if (hz && !vt) R(4, 5, 4, 1, C.roadLine);
    else if (vt && !hz) R(5, 4, 1, 4, C.roadLine);
    else R(5, 5, 2, 2, C.roadLine);
  }
  function cars(R, d) {
    const n = [0, 1, 2, 4][d.tr] || 0;
    if (!n) return;
    const m = d.m, hz = m & 10, vt = m & 5;
    const H = [[1, 2], [7, 7], [6, 2], [2, 7]], V = [[2, 1], [7, 7], [2, 6], [7, 2]];
    for (let k = 0; k < n; k++) {
      const col = C.cars[(d.v + k * 2) % C.cars.length];
      const useV = vt && (!hz || k % 2 === 1);
      if (useV) { const p = V[k]; R(p[0], p[1], 2, 3, col); }
      else { const p = H[k]; R(p[0], p[1], 3, 2, col); }
    }
  }
  function road(R, d) {
    roadBase(R, d);
    roadMarks(R, d);
    if (d.tr >= 2) R(0, 0, N, N, C.jam);
    cars(R, d);
    if (d.bl) { R(1, 2, 4, 2, C.puddle); R(6, 7, 5, 2, C.puddle); R(7, 3, 3, 1, C.puddle); }
    if (d.ent) {
      // いりぐち：となりまちへの みち の看板（みどりの板に白い矢印）
      R(0, 0, 5, 4, C.sign); R(1, 1, 2, 2, "#ffffff"); R(3, 1, 1, 2, "#ffffff");
    }
  }
  function railBands(R, m, ballast) {
    const hb = (x0, x1) => {
      if (ballast) R(x0, 3, x1 - x0, 6, C.ballast);
      for (const tx of [1, 4, 7, 10]) if (tx >= x0 && tx < x1) R(tx, 3, 1, 6, C.tie);
      R(x0, 4, x1 - x0, 1, C.rail); R(x0, 7, x1 - x0, 1, C.rail);
    };
    const vb = (y0, y1) => {
      if (ballast) R(3, y0, 6, y1 - y0, C.ballast);
      for (const ty of [1, 4, 7, 10]) if (ty >= y0 && ty < y1) R(3, ty, 6, 1, C.tie);
      R(4, y0, 1, y1 - y0, C.rail); R(7, y0, 1, y1 - y0, C.rail);
    };
    const hz = m & 10, vt = m & 5;
    if (!m) { hb(0, N); return; }
    if (hz) hb(m & 8 ? 0 : 3, m & 2 ? N : 9);
    if (vt) vb(m & 1 ? 0 : 3, m & 4 ? N : 9);
  }
  function rail(R, d) {
    if (d.br) R(0, 0, N, N, d.br === 2 ? C.sea : C.river);
    else grass(R, d);
    railBands(R, d.m, true);
    if (d.br) {
      const hz = (d.m & 10) || !(d.m & 5);
      if (hz) { R(0, 2, N, 1, C.bridgeEdge); R(0, 9, N, 1, C.bridgeEdge); }
      else { R(2, 0, 1, N, C.bridgeEdge); R(9, 0, 1, N, C.bridgeEdge); }
    }
  }
  function crossing(R, d) {
    roadBase(R, d);
    railBands(R, d.lm || 10, false);
    // ふみきり：赤と白の しるし
    R(0, 0, 2, 1, C.awnR); R(2, 0, 1, 1, "#ffffff"); R(N - 2, N - 1, 2, 1, C.awnR); R(N - 3, N - 1, 1, 1, "#ffffff");
    if (d.tr >= 2) R(0, 0, N, N, C.jam);
  }

  // ---------- 区画 ----------
  function lot(R, d) {
    grass(R, d);
    const z = C.zone[d.u] || "#888888";
    for (let i = 0; i < N; i += 2) { R(i, 0, 1, 1, z); R(i, N - 1, 1, 1, z); R(0, i, 1, 1, z); R(N - 1, i, 1, 1, z); }
    // まんなかの小さな しるし（色だけに頼らない形）
    if (d.u === 5) { R(5, 3, 2, 1, z); R(4, 4, 4, 1, z); R(4, 5, 4, 3, "#ffffff"); R(5, 6, 2, 2, z); }
    else if (d.u === 6) { R(3, 5, 6, 3, z); R(3, 4, 2, 1, z); R(6, 4, 2, 1, z); R(7, 2, 1, 2, z); }
    else if (d.u === 7) { R(3, 4, 6, 1, z); for (let i = 3; i < 9; i += 2) R(i, 5, 1, 2, z); R(3, 7, 6, 1, z); }
    else { R(5, 6, 2, 2, z); R(3, 4, 2, 2, "#5fae5a"); R(7, 3, 2, 2, "#5fae5a"); R(5, 5, 2, 1, "#5fae5a"); }
  }
  function house(R, x, y, w, h, roof, ridge) {
    R(x + 1, y + 1, w, h + 1, C.shadow);
    R(x, y, w, h, roof);
    R(x, y + ((h - 1) >> 1), w, 1, ridge);
    R(x, y + h, w, 1, C.wall);
  }
  function homeSmall(R, d) { // 住宅地
    grass(R, d);
    const [roof, ridge] = ROOFS[d.v & 3];
    if (d.lv === 1) {
      R(2, 2, 8, 8, C.yard);
      house(R, 3, 3, 6, 3, roof, ridge);
    } else {
      R(1, 1, 10, 10, C.yardEdge); R(2, 2, 8, 8, C.yard);
      house(R, 2, 2, d.lv === 3 ? 8 : 7, 4, roof, ridge);
      if (d.lv === 3) { smallTree(R, 7, 7); R(3, 8, 2, 1, "#e8e0c8"); }
      else R(8, 8, 2, 2, "#5b9a3a");
    }
  }
  function homeVilla(R, d) { // 高級住宅地
    R(0, 0, N, N, C.hedge); R(1, 1, 10, 10, C.lawn);
    if (d.lv === 1) {
      house(R, 3, 3, 6, 4, C.villaRoof, C.villaRidge);
    } else {
      house(R, 2, 2, 7, 4, C.villaRoof, C.villaRidge);
      if (d.lv === 3) { R(7, 7, 3, 3, C.pond); R(8, 7, 1, 1, C.pondHi); smallTree(R, 2, 7); R(5, 7, 1, 4, "#e8e0c8"); }
      else { smallTree(R, 8, 7); smallTree(R, 2, 7); }
    }
  }
  function aptBlock(R, x, y, w, h) {
    R(x + 1, y + 1, w, h, C.shadow);
    R(x, y, w, h, C.apt);
    for (let r = y + 2; r < y + h; r += 3) R(x, r, w, 1, C.aptLine);
    for (let r = y + 1; r < y + h - 1; r += 3) for (let c = x + 1; c < x + w - 1; c += 3) R(c, r, 1, 1, C.aptWin);
  }
  function apartment(R, d) {
    grass(R, d);
    if (d.lv === 1) aptBlock(R, 2, 4, 8, 5);
    else if (d.lv === 2) aptBlock(R, 1, 2, 10, 8);
    else aptBlock(R, 1, 1, 10, 10);
  }
  function tower(R, x, y, w, h, sh, body, win, shade) {
    R(x + sh, y + sh, w, h, shade);
    R(x, y, w, h, body);
    for (let r = y + 1; r < y + h - 1; r += 2) for (let c = x + 1; c < x + w - 1; c += 2) R(c, r, 1, 1, win);
  }
  function mansion(R, d) {
    grass(R, d);
    if (d.lv === 1) tower(R, 2, 2, 7, 7, 1, C.man, C.manWin, C.manShadow);
    else if (d.lv === 2) tower(R, 1, 1, 9, 9, 1, C.man, C.manWin, C.manShadow);
    else { tower(R, 1, 1, 9, 9, 2, C.man, C.manWin, C.manShadow); R(4, 4, 3, 3, C.manTop); }
  }
  function factory(R, d) {
    grass(R, d);
    const eco = d.k === 2;
    let x = 2, y = 3, w = 8, h = 6;
    if (d.lv === 2) { x = 1; y = 2; w = 10; h = 8; } else if (d.lv === 3) { x = 1; y = 1; w = 10; h = 10; }
    R(x + 1, y + 1, w, h, C.shadow);
    if (eco) {
      R(x, y, w, h, C.ecoEdge); R(x + 1, y + 1, w - 2, h - 2, C.eco);
      for (let r = y + 2; r < y + h - 2; r += 2) R(x + 1, r, w - 2, 1, C.ecoPanel);
    } else {
      for (let r = 0; r < h - 1; r++) R(x, y + r, w, 1, r % 2 ? C.fac : C.facHi);
      R(x, y + h - 1, w, 1, C.facBase);
      R(x + w - 2, y, 1, 2, C.chim);
      if (d.lv >= 2) R(x + 1, y, 1, 2, C.chim);
      if (d.lv >= 2) R(x + w - 1, y - 1 < 0 ? 0 : y - 1, 2 > N - (x + w - 1) ? 1 : 2, 1, C.smoke);
    }
  }
  function shop(R, d) {
    grass(R, d);
    let x = 3, y = 4, w = 6, h = 5;
    if (d.lv === 2) { x = 1; y = 2; w = 10; h = 8; } else if (d.lv === 3) { x = 1; y = 1; w = 10; h = 10; }
    R(x + 1, y + 1, w, h, C.shadow);
    R(x, y, w, h - 3, C.shopRoof);
    for (let c = 0; c < w; c++) R(x + c, y + h - 3, 1, 2, c % 2 ? C.awnW : C.awnR);
    R(x, y + h - 1, w, 1, C.shopBase);
    if (d.lv === 3) R(x + 2, y + 2, w - 4, 2, "#ffffff");
  }
  function office(R, d) { // ビル
    grass(R, d);
    if (d.lv === 1) tower(R, 2, 2, 7, 7, 1, C.ofc, C.ofcWin, C.ofcShadow);
    else if (d.lv === 2) tower(R, 1, 1, 9, 9, 2, C.ofc, C.ofcWin, C.ofcShadow);
    else { tower(R, 1, 1, 9, 9, 2, C.ofc, C.ofcWin, C.ofcShadow); R(4, 4, 3, 3, "#7bbad2"); R(5, 5, 1, 1, "#e0503c"); }
  }
  function field(R, d) { // はたけ
    R(0, 0, N, N, C.soil);
    const a = d.lv === 1 ? C.soilD : d.lv === 3 ? C.gold : C.cropA;
    const b = d.lv === 1 ? C.cropB : d.lv === 3 ? C.goldD : C.cropB;
    for (let r = 1; r < N - 1; r++) {
      if (d.o) R(r, 1, 1, N - 2, r % 2 ? a : b); else R(1, r, N - 2, 1, r % 2 ? a : b);
    }
    if (d.lv === 1) for (let k = 2; k < N - 2; k += 3) { if (d.o) R(k, 5, 1, 1, C.cropA); else R(5, k, 1, 1, C.cropA); }
  }
  function lumber(R, d) { // 林業
    forest(R, { v: d.v & 1 });
    R(5, 5, 6, 6, C.grassA);
    R(6, 5, 4, 3, C.hutRoof); R(6, 6, 4, 1, "#8f2a20"); R(6, 8, 4, 1, C.wall);
    const n = d.lv;
    for (let k = 0; k < n; k++) { R(1, 9 - k * 2 + (k ? 0 : 0), 4, 1, C.log); R(1, 9 - k * 2, 1, 1, C.logEnd); }
  }
  function harbor(R, d) { // 漁港
    R(0, 0, N, N, C.dock);
    R(0, 0, N, 1, C.dockLine); R(0, N - 1, N, 1, C.dockLine);
    R(1, 2, 10, 2, C.plank);
    R(2, 6, 5, 2, C.boat); R(2, 6, 2, 2, C.boatR);
    if (d.lv >= 2) { R(6, 9, 4, 1, C.boat); R(6, 9, 1, 1, C.boatR); }
    if (d.lv >= 3) { R(8, 5, 3, 3, "#e0b47a"); R(9, 6, 1, 1, C.log); }
  }
  function park(R, d) {
    grass(R, d);
    if (d.v === 0) spr(TREE, TREE_PAL, R, 0, 0);
    else if (d.v === 1) { smallTree(R, 1, 1); smallTree(R, 7, 2); smallTree(R, 3, 7); R(8, 8, 1, 1, C.flowerP); R(9, 9, 1, 1, C.flowerW); }
    else { R(2, 2, 8, 8, "#b9dc7a"); smallTree(R, 2, 2); R(6, 6, 3, 3, C.pond); R(7, 6, 1, 1, C.pondHi); }
  }

  const PAINT = {
    grass, sea: (R, d) => water(R, d, true), river: (R, d) => water(R, d, false), sand, mtn: mountain, forest,
    road, rail, cross: crossing, park, lot,
    home: (R, d) => (d.k === 1 ? apartment : d.k === 2 ? mansion : d.k === 4 ? homeVilla : homeSmall)(R, d),
    work: factory,
    shop: (R, d) => (d.k === 2 ? office : shop)(R, d),
    nat: (R, d) => (d.k === 2 ? lumber : d.k === 3 ? harbor : field)(R, d),
  };
  function paint(d, R) { const f = PAINT[d.ty]; if (f) f(R, d); }

  // ---------- マスの絵の形 ----------
  const isWater = (t) => t === 1 || t === 2;
  function describe(st, i, aux) {
    const W = st.W, H = st.H, x = i % W, y = (i / W) | 0;
    const t = st.terrain[i], u = st.use[i];
    const par = (x + y) & 1;
    const useAt = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? -1 : st.use[yy * W + xx]);
    const terAt = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? -1 : st.terrain[yy * W + xx]);
    if (u === 1 || u === 3 || u === 9) {
      const rd = (v) => v === 1 || v === 3 || v === 9;
      const out = u === 9; // いりぐちは地図の外へ続く
      let m = 0;
      const nb = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
      for (const [dx, dy, b] of nb) { const v = useAt(x + dx, y + dy); if (rd(v) || (out && v === -1)) m |= b; }
      const br = isWater(t) ? t : 0;
      const tr = st.traffic ? Math.min(3, st.traffic[i]) : 0;
      const bl = st.blocked && st.blocked[i] ? 1 : 0;
      const v = (hs(i, 3) * 6) | 0;
      if (u === 3) {
        let lm = 0;
        for (const [dx, dy, b] of nb) { const w = useAt(x + dx, y + dy); if (w === 2 || w === 3) lm |= b; }
        return { id: "x" + m + "." + lm + "." + tr + "." + br, ty: "cross", m, lm, tr, br, v };
      }
      const ent = u === 9 ? 1 : 0;
      return { id: "r" + m + "." + br + "." + tr + "." + bl + "." + ent + "." + (tr ? v : 0), ty: "road", m, br, tr: tr, bl, ent, v };
    }
    if (u === 2) {
      let m = 0;
      const nb = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
      for (const [dx, dy, b] of nb) { const w = useAt(x + dx, y + dy); if (w === 2 || w === 3) m |= b; }
      const br = isWater(t) ? t : 0;
      return { id: "l" + m + "." + br + "." + par, ty: "rail", m, br, par, fl: 0 };
    }
    if (u === 4) { const v = (hs(i, 4) * 3) | 0; return { id: "p" + v + par, ty: "park", v, par, fl: 0 }; }
    if (u >= 5 && u <= 8) {
      const lv = st.lvl[i] | 0;
      if (!lv) return { id: "z" + u + par, ty: "lot", u, par, fl: 0 };
      const k = st.kind[i] | 0;
      const v = (hs(i, 5) * 4) | 0;
      if (u === 5) return { id: "h" + k + lv + (k === 3 || k === 0 ? v : 0) + par, ty: "home", k: k || 3, lv, v, par, fl: 0 };
      if (u === 6) return { id: "w" + k + lv + par, ty: "work", k, lv, par, fl: 0 };
      if (u === 7) return { id: "s" + k + lv + par, ty: "shop", k, lv, par, fl: 0 };
      const o = ((x >> 2) + (y >> 2)) & 1;
      return { id: "n" + k + lv + o + (v & 1), ty: "nat", k, lv, o, v: v & 1, par, fl: 0 };
    }
    // 地形だけ
    if (isWater(t)) {
      let m = 0;
      const nb = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
      for (const [dx, dy, b] of nb) { const w = terAt(x + dx, y + dy); if (w !== -1 && !isWater(w)) m |= b; }
      const v = hs(i, 1) < 0.3 ? 1 : hs(i, 2) < 0.15 ? 2 : 0;
      return { id: (t === 1 ? "o" : "q") + m + "." + v, ty: t === 1 ? "sea" : "river", m, v };
    }
    if (t === 3) {
      const lv = aux && aux.mh ? aux.mh[i] : 2;
      const v = hs(i, 8) < 0.3 ? 1 : hs(i, 9) < 0.15 ? 2 : 0;
      return { id: "m" + lv + v, ty: "mtn", lv, v };
    }
    if (t === 4) { const v = hs(i, 6) < 0.5 ? 0 : 1; return { id: "f" + v, ty: "forest", v }; }
    if (t === 5) { const v = hs(i, 7) < 0.25 ? 1 : hs(i, 7) < 0.5 ? 2 : 0; return { id: "b" + v, ty: "sand", v }; }
    const r = hs(i, 3);
    const fl = r < 0.04 ? 1 : r < 0.07 ? 2 : r < 0.09 ? 3 : 0;
    return { id: "g" + par + fl, ty: "grass", par, fl };
  }

  // やま の高さ：まわり 5×5 の やま の数と、ふちからの近さで 0〜5
  function mountainLevels(st) {
    const W = st.W, H = st.H, T = st.terrain, out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] !== 3) continue;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { n++; continue; }
        if (T[yy * W + xx] === 3) n++;
      }
      // 25 で いちばん高い。ふちは低く
      let lv = n >= 25 ? 5 : n >= 23 ? 4 : n >= 20 ? 3 : n >= 16 ? 2 : n >= 11 ? 1 : 0;
      // 内側をさらに高く（7×7 も全部 やま なら頂上）
      if (lv === 5) {
        let all = true;
        for (let dy = -3; dy <= 3 && all; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          if (T[yy * W + xx] !== 3) { all = false; break; }
        }
        if (!all) lv = 4;
      }
      out[i] = lv;
    }
    return out;
  }

  function terrainColor(t, lv) {
    if (t === 1) return C.sea;
    if (t === 2) return C.river;
    if (t === 3) return C.mtn[lv == null ? 2 : lv];
    if (t === 4) return "#5f9a44";
    if (t === 5) return C.sand;
    return C.grassA;
  }

  // 道具のボタンの絵（見本 A のボタンの絵）
  function iconDesc(tool) {
    switch (tool) {
      case "home": return { id: "I-home", ty: "home", k2: 3, k: 3, lv: 2, v: 0, par: 0, fl: 0 };
      case "work": return { ty: "work", k: 1, lv: 2, par: 0, fl: 0 };
      case "shop": return { ty: "shop", k: 1, lv: 2, par: 0, fl: 0 };
      case "road": return { ty: "road", m: 10, br: 0, tr: 0, bl: 0, ent: 0, v: 0 };
      case "rail": return { ty: "rail", m: 10, br: 0, par: 0, fl: 0 };
      case "green": return { ty: "park", v: 0, par: 0, fl: 0 };
      case "nature": return { ty: "nat", k: 1, lv: 2, o: 0, v: 0, par: 0, fl: 0 };
      case "erase": return { ty: "erase" };
      default: return null;
    }
  }
  PAINT.erase = (R) => {
    R(0, 0, N, N, C.grassA);
    for (let k = 0; k < 8; k++) { R(2 + k, 2 + k, 1, 1, C.awnR); R(9 - k, 2 + k, 1, 1, C.awnR); }
  };

  root.MachiSprites = { N, C, hs, describe, paint, iconDesc, terrainColor, mountainLevels };
})(typeof window !== "undefined" ? window : globalThis);
