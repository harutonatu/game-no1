/*
 * あまいものあつめ — ロジック（DOM・時計・乱数の関数・保存の場所に触れない純粋な計算だけ）
 * 契約：docs/ari-contract.md §1（決まり）・§2（面の作り方）・§4（保存）・§5.2（色と印）・§6.2（API）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.AmaiLogic、Node では module.exports と globalThis.AmaiLogic。
 * 絵は AmaiPictures（pictures-a.js・pictures-b.js が作る { add(list), byId }）から、使うときに読む。
 *   Node では ./pictures-a.js・./pictures-b.js を require する（無ければ絵は空として扱う）。
 *   byId は関数（byId(id)）でも、id → 絵 の表（オブジェクト）でもよい。
 *
 * 中の作り：
 *   - 公開する state はイミュータブル（凍結した新しいオブジェクトと配列）。logic が作った state は覚えておき（WeakSet）、
 *     次の press・step で確かめ直さない。外から来た state は validateState を通す。
 *   - 「外」（外とつながった空き）は cells から求める。速さのため、cells の配列ごとに外の表を覚えておき（WeakMap）、
 *     1 はこびでは運んだマスのまわりだけ足す（閉じた空きが外とつながったら、その空きをたどって外にする）。
 *   - 運ぶ順（巣に近い → 下 → 左）は、絵の大きさごとにマスを並べた表 ord を 1 回作り、前から見て最初に当たるマスを取る。
 *   - 生成（createLevel）も、確かめも、画面と同じ press・step（中の pressImpl・stepImpl）を通る。
 *   - 生成の上限は時間ではなく手間の数（work）。どの端末でも同じ面になる。
 */
(function (root) {
  "use strict";

  const NAME = "あまいものあつめ";
  const SLOTS = 3;
  const EASY_BOXES = 5;   // 1〜2 面の箱の数の上限（段 0 のあいだは 5 のまま。わくは 3 なので §2.1 の「必ず入る」保証は弱まる）
  // 1 はこびで 1 箱が運ぶ角砂糖の数（段 0b の測定用。1 なら今までと同じ動き）。
  // CARRY_FROM 以上の面だけ CARRY_N 個運ぶ。持ち玉の合計＝角砂糖の数は変えない（アリの数は同じ。1 回で CARRY_N 匹が運ぶイメージ）。
  const CARRY_N = 1;
  const CARRY_FROM = 1;
  // 1 はこびで 2 個運ぶ段（段 0f の測定用。空なら今までと同じ動き）。くり返しの面には使わない
  const CARRY_TIERS = { XL: 2, XXL: 2, repeat: 2 };
  const COLS = 4;
  const TICK_MS = 500;
  const FAST_MS = 250;
  const MAX_W = 32;
  const MAX_H = 24;
  const MAX_SUGAR = 700;
  const MAX_COUNT = 99;
  const MAX_PRESSES = 400;
  const MAX_T = 5000;
  const GEN_TRIES = 20;
  const GEN_WORK = 300000;
  const FALLBACK_RESERVE = 60000;   // 予備 1 の手間のために残す分（work が GEN_WORK を超えないように、配り直しをここで止める）
  // 段 0e の測定用の取っ手（既定は false＝今までと同じ面ができる）。
  //   capRemain … 箱の数の上限を「今ふちから届く数 R」ではなく「その色の残り全部」にする（①）
  //   shuffleCols … 列の中の順を P の順でなく無作為にする（②。押したい箱が奥に埋まる）
  // どちらかが true のときは「S の順に押せば解ける」保証が崩れるので、解ける押し順を探して確かめる（solveSearch）。
  // over … 箱の持ち玉の上限を「ふちから届く数 R」の何倍まで許すか（段ごと。1 なら今までと同じ＝必ず単独で運び切れる）。
  //   1 より大きいと「置いた時点では運び切れない箱」ができ、道を開ける仕事が生まれる（①）。Infinity ならその色の残り全部。
  const OVER = { S: 1.1, M: 1.02, L: 1.02, XL: 2, XXL: 1.1, repeat: 1.3 };
  const PULL_ADD = { S: 0, M: 0, L: 0, XL: 0, XXL: 0, repeat: 0 };
  const KSET = { L: [6, 20] };   // 段ごとの箱の数の幅の上書き。空なら TIERS の値
  const GEN_OPT = { shuffleCols: false, solveNodes: 15, genTries: 5, softenEvery: 1 };
  const SOLVE_NODES = 15;   // 解ける押し順の探索で開く局面の上限は「箱の数＋この余り」（1 回の tryBuild ごと・600 まで）
  const BASE_PICTURES = 48;
  const REPEAT_FROM = 9;
  const SAVE_V = 1;
  const BOOK_V = 1;
  const BOOK_MAX = 9999;

  const SAVE_KEY_SAVE = "amai.save";
  const SAVE_KEY_BEST = "amai.best";
  const SAVE_KEY_BOOK = "amai.book";
  const SAVE_KEY_HELP = "amai.help";
  const SAVE_KEY_FAST = "amai.fast";
  const SAVE_KEY_CLEAN = "amai.clean";

  // ---------------------------------------------------------------- 色と印（§5.2）
  const COLORS = Object.freeze([
    [0, "R", "red", "あか", "#E23B3B", "circle", [".###.", "#####", "#####", "#####", ".###."]],
    [1, "O", "orange", "オレンジ", "#F28C28", "triangle", ["..#..", ".###.", ".###.", "#####", "#####"]],
    [2, "Y", "yellow", "きいろ", "#F2D13A", "star", ["..#..", ".###.", "#####", ".#.#.", "#...#"]],
    [3, "G", "green", "みどり", "#3E9E4F", "diamond", ["..#..", ".###.", "#####", ".###.", "..#.."]],
    [4, "S", "sky", "みずいろ", "#78C6EE", "plus", ["..#..", "..#..", "#####", "..#..", "..#.."]],
    [5, "B", "blue", "あお", "#2E5BC9", "cross", ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]],
    [6, "P", "pink", "ピンク", "#F29BC2", "heart", [".#.#.", "#####", "#####", ".###.", "..#.."]],
    [7, "C", "brown", "ちゃいろ", "#8B5A33", "bars", [".....", "#####", ".....", "#####", "....."]],
    [8, "W", "white", "しろ", "#F5F2EA", "ring", [".###.", "#...#", "#...#", "#...#", ".###."]],
    [9, "K", "black", "くろ", "#2B2B33", "stripes", [".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."]],
  ].map(([id, letter, key, name, hex, mark, dots]) => Object.freeze({ id, letter, key, name, hex, mark, dots: Object.freeze(dots) })));
  const LETTER = Object.freeze(Object.fromEntries(COLORS.map((c) => [c.letter, c.id])));

  // ---------------------------------------------------------------- 段と面の表（§2.1。仮）
  // 段の値（49 面からは lids・ices にこの「多い方」を使う。くり返しは +1）
  const TIERS = Object.freeze({
    S: Object.freeze({ tier: "S", colors: Object.freeze([3, 4]), sugar: Object.freeze([110, 180]), kmin: 15, kmax: 25, pull: 0, lids: 0, ices: 0 }),
    M: Object.freeze({ tier: "M", colors: Object.freeze([4, 5]), sugar: Object.freeze([200, 300]), kmin: 10, kmax: 25, pull: 2, lids: 1, ices: 0 }),
    L: Object.freeze({ tier: "L", colors: Object.freeze([5, 7]), sugar: Object.freeze([300, 420]), kmin: 10, kmax: 30, pull: 4, lids: 2, ices: 1 }),
    XL: Object.freeze({ tier: "XL", colors: Object.freeze([6, 8]), sugar: Object.freeze([420, 560]), kmin: 10, kmax: 30, pull: 8, lids: 3, ices: 2 }),
    XXL: Object.freeze({ tier: "XXL", colors: Object.freeze([8, 10]), sugar: Object.freeze([520, 700]), kmin: 10, kmax: 30, pull: 12, lids: 4, ices: 3 }),
  });
  // 1〜48 面の仕掛けの数（面の番号で決める）
  const LEVELS = Object.freeze([
    { from: 1, to: 4, tier: "S", lids: 0, ices: 0 },
    { from: 5, to: 8, tier: "M", lids: 0, ices: 0 },
    { from: 9, to: 12, tier: "M", lids: 1, ices: 0 },
    { from: 13, to: 18, tier: "L", lids: 1, ices: 0 },
    { from: 19, to: 24, tier: "L", lids: 2, ices: 1 },
    { from: 25, to: 30, tier: "XL", lids: 3, ices: 1 },
    { from: 31, to: 36, tier: "XL", lids: 3, ices: 2 },
    { from: 37, to: 48, tier: "XXL", lids: 4, ices: 3 },
  ].map((r) => Object.freeze(r)));
  const REPEAT_K = { kmin: 3, kmax: 10 };

  // 絵の並び（§2.6 の表の順）。絵を足すときは最後に足す（並べかえない・途中に入れない）。
  // id はローマ字（かなを 1 字ずつ書く形。のばす音は母音を重ねる）・英小文字だけ。
  // 配列そのものは凍結しない（テスト AL13 が 49 枚目を足して確かめるため）。中の項目は凍結。
  const PICTURE_ORDER = [
    ["ringo", "S"], ["sakuranbo", "S"], ["sakura", "S"], ["ichigo", "S"],
    ["kinoko", "M"], ["hiyoko", "M"], ["chuurippu", "M"], ["onigiri", "M"], ["suika", "M"], ["sakana", "M"], ["donguri", "M"], ["choucho", "M"],
    ["nekonokao", "L"], ["yukidaruma", "L"], ["kame", "L"], ["koinobori", "L"], ["keeki", "L"], ["asagao", "L"],
    ["katatsumuri", "L"], ["momiji", "L"], ["inunokao", "L"], ["tebukuro", "L"], ["himawari", "L"], ["kuri", "L"],
    ["basu", "XL"], ["ohanamidango", "XL"], ["pengin", "XL"], ["kakigoori", "XL"], ["fune", "XL"], ["satsumaimo", "XL"],
    ["kujira", "XL"], ["kurisumasutsurii", "XL"], ["ouchi", "XL"], ["hanabi", "XL"], ["kikansha", "XL"], ["kakashi", "XL"],
    ["nijitokumo", "XXL"], ["tanpopotomitsubachi", "XXL"], ["rokettotohoshi", "XXL"], ["umitosunahama", "XXL"], ["kumatofuusen", "XXL"], ["otsukimi", "XXL"],
    ["oshiro", "XXL"], ["kamakura", "XXL"], ["kyouryuu", "XXL"], ["takoage", "XXL"], ["kabutomushitoki", "XXL"], ["kanransha", "XXL"],
  ].map(([id, tier]) => Object.freeze({ id, tier }));

  // 予備 2 の絵（§2.2 の 8.。りんご。絵が読めないときもこれで遊べる）
  const FALLBACK_PICTURE = Object.freeze({ id: "ringo", name: "りんご", season: "", map: Object.freeze([
    "....C.GG..",
    "....CGGG..",
    "..RRCRRR..",
    ".RRRRRRRR.",
    "RRRRRRRRRR",
    "RRRRRRRRRR",
    "RRRRRRRRRR",
    "RRRRRRRRRR",
    ".RRRRRRRR.",
    "..RRR.RR..",
  ]) });
  const FALLBACK_COUNT = 25;   // 予備 2 の箱の大きさの上限（りんごで 25・25・16・5・3 の 5 箱）

  // ---------------------------------------------------------------- 小さな道具

  const isInt = (n) => Number.isSafeInteger(n);
  const ID_RE = /^[a-z]+$/;
  const NAME_RE = /^[ぁ-ゖァ-ヺー　 ]+$/;
  const SEASONS = Object.freeze(["", "haru", "natsu", "aki", "fuyu"]);

  // 面番号を 1 以上の安全な整数に丸める（壊れた値は 1）
  function normLevel(level) {
    let n;
    try { n = Number(level); } catch (e) { return 1; }
    if (!Number.isFinite(n)) return 1;
    n = Math.floor(n);
    if (n < 1) return 1;
    if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
    return n;
  }

  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // 再現できる乱数（mulberry32。いろびんと同じ作り）。0 以上 1 未満
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

  // 面番号 → 32bit の種（いろびんと同じ混ぜ方に、このゲームの定数を足す）
  function seedFor(level) {
    const n = normLevel(level);
    const lo = (n % 4294967296) >>> 0;
    const hi = Math.floor(n / 4294967296) >>> 0;
    return fmix((fmix(lo ^ 0x3c6ef372) + Math.imul(hi ^ 0x27d4eb2f, 0x165667b1) + 0x9e3779b9) | 0);
  }

  const randInt = (rng, n) => Math.floor(rng() * n);
  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function colorName(id) {
    return isInt(id) && id >= 0 && id < COLORS.length ? COLORS[id].name : "";
  }

  // ---------------------------------------------------------------- 絵（§2.6）

  // Node では絵のファイルを読む（無ければ空）。ブラウザでは index.html が先に読んでいる
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    for (const f of ["./pictures-a.js", "./pictures-b.js"]) {
      try {
        const m = require(f);
        if (!root.AmaiPictures && m && typeof m.add === "function") root.AmaiPictures = m;
      } catch (e) { /* 絵のファイルがまだ無い：空として扱う */ }
    }
  }

  function rawPicture(id) {
    const P = root.AmaiPictures;
    if (!P || typeof id !== "string") return null;
    try {
      let d = null;
      if (typeof P.byId === "function") d = P.byId(id);
      else if (P.byId && typeof P.byId === "object" && Object.prototype.hasOwnProperty.call(P.byId, id)) d = P.byId[id];
      return d && typeof d === "object" ? d : null;
    } catch (e) { return null; }
  }

  // 文字の地図 → { id, name, season, W, H, cells }。決まり（§2.6 の 1・2・4・5・6、角砂糖 700 以下）を守らない絵は null。
  // 段の範囲（決まり 3 の色の数と角砂糖の数）は絵だけでは決まらないので、ここでは見ない（テスト AL2 が PICTURE_ORDER の段で見る）
  function parsePicture(def, mirror) {
    try {
      if (!def || typeof def !== "object") return null;
      const { id, name, map } = def;
      const season = def.season;
      if (typeof id !== "string" || !ID_RE.test(id) || id.length > 64) return null;
      if (typeof name !== "string" || !NAME_RE.test(name) || name.trim() === "") return null;
      if (typeof season !== "string" || !SEASONS.includes(season)) return null;
      if (!Array.isArray(map) || map.length < 1 || map.length > MAX_H) return null;
      const H = map.length;
      if (typeof map[0] !== "string") return null;
      const W = map[0].length;
      if (W < 1 || W > MAX_W) return null;
      const cells = new Array(W * H);
      const per = new Array(COLORS.length).fill(0);
      let sugar = 0;
      for (let y = 0; y < H; y++) {
        const row = map[y];
        if (typeof row !== "string" || row.length !== W) return null;
        for (let x = 0; x < W; x++) {
          const ch = row[mirror === true ? W - 1 - x : x];
          let v;
          if (ch === ".") v = -1;
          else if (Object.prototype.hasOwnProperty.call(LETTER, ch)) { v = LETTER[ch]; per[v]++; sugar++; }
          else return null;
          cells[y * W + x] = v;
        }
      }
      if (sugar < 1 || sugar > MAX_SUGAR) return null;
      // はしの行・列のどれかに角砂糖がある（むだな空きの行・列を作らない）
      const rowHas = (y) => { for (let x = 0; x < W; x++) if (cells[y * W + x] >= 0) return true; return false; };
      const colHas = (x) => { for (let y = 0; y < H; y++) if (cells[y * W + x] >= 0) return true; return false; };
      if (!rowHas(0) || !rowHas(H - 1) || !colHas(0) || !colHas(W - 1)) return null;
      // 各色 3 個以上
      for (const n of per) if (n > 0 && n < 3) return null;
      // 閉じた空きがない
      const out = computeOutside(W, H, cells);
      for (let i = 0; i < W * H; i++) if (cells[i] < 0 && !out[i]) return null;
      Object.freeze(cells);
      return Object.freeze({ id, name, season, W, H, cells });
    } catch (e) { return null; }
  }

  let picCacheOwner = null;
  let picCache = new Map();
  function pictureById(id, mirror) {
    try {
      if (typeof id !== "string") return null;
      const P = root.AmaiPictures || null;
      if (P !== picCacheOwner) { picCacheOwner = P; picCache = new Map(); }
      const key = id + (mirror === true ? "|m" : "|n");
      if (picCache.has(key)) return picCache.get(key);
      const d = rawPicture(id);
      const p = d && d.id === id ? parsePicture(d, mirror === true) : null;
      if (p) picCache.set(key, p);   // 読めなかった絵は覚えない（あとから足されたら読めるように）
      return p;
    } catch (e) { return null; }
  }

  function orderIndex(id) {
    for (let i = 0; i < PICTURE_ORDER.length; i++) if (PICTURE_ORDER[i].id === id) return i;
    return -1;
  }

  // ---------------------------------------------------------------- 外・ふち（§1.3）

  // 外とつながった空き（1）を求める。絵のわくの外から、上下左右に空きをたどる
  function computeOutside(W, H, cells) {
    const out = new Uint8Array(W * H);
    const stack = [];
    const seed = (i) => { if (cells[i] < 0 && !out[i]) { out[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    flood(W, H, cells, out, stack);
    return out;
  }
  function flood(W, H, cells, out, stack) {
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i - x) / W;
      if (x > 0) { const j = i - 1; if (cells[j] < 0 && !out[j]) { out[j] = 1; stack.push(j); } }
      if (x < W - 1) { const j = i + 1; if (cells[j] < 0 && !out[j]) { out[j] = 1; stack.push(j); } }
      if (y > 0) { const j = i - W; if (cells[j] < 0 && !out[j]) { out[j] = 1; stack.push(j); } }
      if (y < H - 1) { const j = i + W; if (cells[j] < 0 && !out[j]) { out[j] = 1; stack.push(j); } }
    }
  }

  // 運ぶ順の表（巣に近い → 下 → 左）。絵の大きさごとに 1 回だけ作る
  const ordCache = new Map();
  function orderFor(W, H) {
    const key = W * 100 + H;
    let o = ordCache.get(key);
    if (o) return o;
    const idx = [];
    for (let i = 0; i < W * H; i++) idx.push(i);
    const d = (i) => { const x = i % W, y = (i - x) / W; return Math.abs(2 * x - (W - 1)) + 2 * (H - y); };
    idx.sort((a, b) => {
      const da = d(a), db = d(b);
      if (da !== db) return da - db;
      const ya = Math.floor(a / W), yb = Math.floor(b / W);
      if (ya !== yb) return yb - ya;
      return (a % W) - (b % W);
    });
    o = Int32Array.from(idx);
    ordCache.set(key, o);
    return o;
  }

  // 盤：{ W, H, cells, out, ord, own }。own が false の間は state の配列をそのまま読み、運ぶときに写す
  const outCache = new WeakMap();   // cells の配列 → 外の表
  function boardOf(s) {
    let out = outCache.get(s.cells);
    if (!out) { out = computeOutside(s.W, s.H, s.cells); outCache.set(s.cells, out); }
    return { W: s.W, H: s.H, cells: s.cells, out, ord: orderFor(s.W, s.H), own: false };
  }
  function isEdge(b, i) {
    const W = b.W, x = i % W, y = (i - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === b.H - 1) return true;
    const o = b.out;
    return o[i - 1] === 1 || o[i + 1] === 1 || o[i - W] === 1 || o[i + W] === 1;
  }
  // その色の、運ぶ順で一番先のふちの角砂糖（無ければ -1）
  function findTarget(b, color) {
    const ord = b.ord, cells = b.cells;
    for (let k = 0; k < ord.length; k++) {
      const i = ord[k];
      if (cells[i] === color && isEdge(b, i)) return i;
    }
    return -1;
  }
  // その色の、運ぶ順で一番先の角砂糖（ふちでなくてもよい。生成で「まだ届かない分」を数えるときだけ使う）
  function findAny(b, color) {
    const ord = b.ord, cells = b.cells;
    for (let k = 0; k < ord.length; k++) if (cells[ord[k]] === color) return ord[k];
    return -1;
  }
  // マス i を運ぶ（空きにして、外を広げる）
  function takeCell(b, i) {
    if (!b.own) { b.cells = Array.from(b.cells); b.out = Uint8Array.from(b.out); b.own = true; }
    b.cells[i] = -1;
    b.out[i] = 1;
    flood(b.W, b.H, b.cells, b.out, [i]);
  }

  // ---------------------------------------------------------------- 局面

  const trusted = new WeakSet();
  function freezeState(o) {
    Object.freeze(o.cells);
    for (const c of o.cols) { for (const bx of c) Object.freeze(bx); Object.freeze(c); }
    Object.freeze(o.cols);
    for (const bx of o.slots) if (bx) Object.freeze(bx);
    Object.freeze(o.slots);
    Object.freeze(o);
    trusted.add(o);
    return o;
  }
  const mkState = (s, ch) => freezeState({
    level: s.level, W: s.W, H: s.H, picture: s.picture, mirror: s.mirror, repeat: s.repeat,
    cells: s.cells, total: s.total, left: s.left, cols: s.cols, slots: s.slots, t: s.t, presses: s.presses, won: s.won, carry: s.carry, ...ch,
  });

  // setState 用。形を確かめて、凍結した新しい局面を返す（だめなら null）
  function validateState(s) {
    try {
      if (!s || typeof s !== "object") return null;
      const { level, W, H, picture, mirror, repeat, cells, total, left, cols, slots, t, presses, won } = s;
      if (!isInt(level) || level < 1) return null;
      if (!isInt(W) || W < 1 || W > MAX_W || !isInt(H) || H < 1 || H > MAX_H) return null;
      if (typeof picture !== "string" || !ID_RE.test(picture)) return null;
      if (typeof mirror !== "boolean" || typeof repeat !== "boolean" || typeof won !== "boolean") return null;
      if (!Array.isArray(cells) || cells.length !== W * H) return null;
      let cnt = 0;
      const nc = new Array(W * H);
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i];
        if (!isInt(v) || v < -1 || v >= COLORS.length) return null;
        if (v >= 0) cnt++;
        nc[i] = v;
      }
      if (!isInt(left) || left !== cnt || !isInt(total) || total < left || total > MAX_SUGAR) return null;
      if (won !== (left === 0)) return null;
      if (!isInt(t) || t < 0 || t > MAX_T || !isInt(presses) || presses < 0 || presses > MAX_PRESSES) return null;
      const ids = new Set();
      const okId = (id) => isInt(id) && id >= 0 && !ids.has(id) && (ids.add(id), true);
      const okColor = (c) => isInt(c) && c >= 0 && c < COLORS.length;
      const okCount = (n) => isInt(n) && n >= 1 && n <= MAX_COUNT;
      if (!Array.isArray(cols) || cols.length !== COLS) return null;
      const ncols = [];
      for (const c of cols) {
        if (!Array.isArray(c)) return null;
        const nb = [];
        for (let j = 0; j < c.length; j++) {
          const bx = c[j];
          if (!bx || typeof bx !== "object" || !okId(bx.id) || !okColor(bx.color) || !okCount(bx.count)) return null;
          if (typeof bx.lid !== "boolean" || !isInt(bx.ice) || bx.ice < 0 || bx.ice > MAX_PRESSES) return null;
          if (j === 0 && bx.lid) return null;   // 手前の箱は ふたが開いている
          if (bx.lid && bx.ice > 0) return null;   // 仕掛けは 1 つまで
          nb.push({ id: bx.id, color: bx.color, count: bx.count, lid: bx.lid, ice: bx.ice > presses ? bx.ice : 0 });
        }
        ncols.push(nb);
      }
      if (!Array.isArray(slots) || slots.length !== SLOTS) return null;
      const nslots = [];
      for (const bx of slots) {
        if (bx === null) { nslots.push(null); continue; }
        if (!bx || typeof bx !== "object" || !okId(bx.id) || !okColor(bx.color) || !okCount(bx.count)) return null;
        nslots.push({ id: bx.id, color: bx.color, count: bx.count });
      }
      return freezeState({ level, W, H, picture, mirror, repeat, cells: nc, total, left, cols: ncols, slots: nslots, t, presses, won });
    } catch (e) { return null; }
  }
  const asState = (s) => (s && typeof s === "object" && trusted.has(s) ? s : validateState(s));

  // ---------------------------------------------------------------- 押す（§1.4）

  function reasonFor(s, col) {
    if (s.won) return "won";
    if (typeof col !== "number" || !isInt(col) || col < 0 || col >= COLS) return "range";
    const c = s.cols[col];
    if (c.length === 0) return "empty";
    if (c[0].ice > s.presses) return "frozen";
    if (s.slots.indexOf(null) < 0) return "full";
    return null;
  }

  function pressImpl(s, col) {
    const reason = reasonFor(s, col);
    if (reason) return { state: s, outcome: Object.freeze({ kind: "invalid", reason, col }) };
    const slot = s.slots.indexOf(null);
    const np = s.presses + 1;
    const opened = [];
    const thawed = [];
    const cols = s.cols.map((c, ci) => {
      let arr = ci === col ? c.slice(1) : c;
      let changed = ci === col;
      const out = arr.map((bx, j) => {
        let nb = bx;
        if (j === 0 && bx.lid) { nb = { id: bx.id, color: bx.color, count: bx.count, lid: false, ice: bx.ice }; opened.push(Object.freeze({ col: ci, id: bx.id, color: bx.color, count: bx.count })); }
        if (nb.ice > 0 && nb.ice <= np) { nb = { id: nb.id, color: nb.color, count: nb.count, lid: nb.lid, ice: 0 }; thawed.push(nb.id); }
        if (nb !== bx) changed = true;
        return nb;
      });
      return changed ? out : c;
    });
    const f = s.cols[col][0];
    const slots = s.slots.slice();
    slots[slot] = { id: f.id, color: f.color, count: f.count };
    const state = mkState(s, { cols, slots, presses: np });
    return { state, outcome: Object.freeze({ kind: "press", col, slot, id: f.id, color: f.color, count: f.count, opened: Object.freeze(opened), thawed: Object.freeze(thawed) }) };
  }

  function press(state, col) {
    try {
      const s = asState(state);
      if (!s) return { state, outcome: Object.freeze({ kind: "invalid", reason: "range", col }) };
      return pressImpl(s, col);
    } catch (e) {
      return { state, outcome: Object.freeze({ kind: "invalid", reason: "range", col }) };
    }
  }

  function canPress(state, col) {
    try {
      const s = asState(state);
      if (!s) return "range";
      return reasonFor(s, col);
    } catch (e) { return "range"; }
  }

  // ---------------------------------------------------------------- 運ぶ（§1.5〜1.9）

  function stableImpl(s, b) {
    if (s.won) return true;
    const seen = new Set();
    for (const bx of s.slots) {
      if (!bx || seen.has(bx.color)) continue;
      seen.add(bx.color);
      if (findTarget(b || (b = boardOf(s)), bx.color) >= 0) return false;
    }
    return true;
  }
  function stuckImpl(s, b) {
    if (s.won) return false;
    if (!stableImpl(s, b)) return false;
    for (let c = 0; c < COLS; c++) if (reasonFor(s, c) === null) return false;
    return true;
  }

  function stepImpl(s) {
    if (s.won) return { state: s, moved: false, carries: Object.freeze([]), won: true, stuck: false };
    const b = boardOf(s);
    const slots = s.slots.slice();
    const carries = [];
    let left = s.left;
    for (let k = 0; k < SLOTS; k++) {
      const bx = slots[k];
      if (!bx) continue;
      const cap = Math.max(1, s.carry || (s.level >= CARRY_FROM ? CARRY_N : 1));
      let count = bx.count, took = 0;
      for (let m = 0; m < cap && count > 0; m++) {
        const i = findTarget(b, bx.color);
        if (i < 0) break;      // その色のふちが無い：ここまで
        takeCell(b, i);
        left--; count--; took++;
        const x = i % s.W;
        carries.push(Object.freeze({ slot: k, id: bx.id, color: bx.color, cell: i, x, y: (i - x) / s.W, emptied: count === 0 }));
      }
      if (took === 0) continue;   // その色のふちが無い：待つ
      slots[k] = count === 0 ? null : { id: bx.id, color: bx.color, count };
    }
    if (carries.length === 0) return { state: s, moved: false, carries: Object.freeze([]), won: false, stuck: stuckImpl(s, b) };
    outCache.set(b.cells, b.out);
    const state = mkState(s, { cells: b.cells, left, slots, t: s.t + 1, won: left === 0 });
    return { state, moved: true, carries: Object.freeze(carries), won: state.won, stuck: stuckImpl(state, { ...b, own: false }) };
  }

  function step(state) {
    try {
      const s = asState(state);
      if (!s) return { state, moved: false, carries: Object.freeze([]), won: false, stuck: false };
      return stepImpl(s);
    } catch (e) {
      return { state, moved: false, carries: Object.freeze([]), won: false, stuck: false };
    }
  }

  function isStable(state) {
    try { const s = asState(state); return s ? stableImpl(s) : true; } catch (e) { return true; }
  }
  function isStuck(state) {
    try { const s = asState(state); return s ? stuckImpl(s) : false; } catch (e) { return false; }
  }

  // 今のふちの角砂糖（運ぶ順。color を決めればその色だけ）
  function edgeCells(state, color) {
    try {
      const s = asState(state);
      if (!s) return [];
      const b = boardOf(s);
      const want = color === undefined || color === null ? null : color;
      const res = [];
      for (let k = 0; k < b.ord.length; k++) {
        const i = b.ord[k];
        const v = s.cells[i];
        if (v >= 0 && (want === null || v === want) && isEdge(b, i)) res.push(i);
      }
      return res;
    } catch (e) { return []; }
  }

  function hud(state) {
    try {
      const s = asState(state);
      if (!s) return { level: 1, left: 0, total: 0, presses: 0, carried: 0 };
      return { level: s.level, left: s.left, total: s.total, presses: s.presses, carried: s.total - s.left };
    } catch (e) { return { level: 1, left: 0, total: 0, presses: 0, carried: 0 }; }
  }

  // ---------------------------------------------------------------- 面の表・絵の選び方（§2.1・§2.7）

  function emptyBook() { return { got: Object.create(null) }; }
  function bookOf(book) {
    if (typeof book === "string") return validateBook(book);
    if (book && typeof book === "object" && book.got && typeof book.got === "object") return book;
    return emptyBook();
  }
  function gotOf(b, id) {
    const g = b.got;
    if (!g || !Object.prototype.hasOwnProperty.call(g, id)) return 0;
    const n = g[id];
    return isInt(n) && n > 0 ? n : 0;
  }

  // 面を始めるときの絵（日付を使わない。純粋）
  function pickPicture(level, book) {
    try {
      const lv = normLevel(level);
      if (lv <= BASE_PICTURES && lv <= PICTURE_ORDER.length) return Object.freeze({ id: PICTURE_ORDER[lv - 1].id, mirror: false, repeat: false });
      const b = bookOf(book);
      for (let i = BASE_PICTURES; i < PICTURE_ORDER.length; i++) {
        if (gotOf(b, PICTURE_ORDER[i].id) === 0) return Object.freeze({ id: PICTURE_ORDER[i].id, mirror: false, repeat: false });
      }
      let best = -1, bestN = Infinity;
      for (let i = REPEAT_FROM - 1; i < PICTURE_ORDER.length; i++) {
        const n = gotOf(b, PICTURE_ORDER[i].id);
        if (n < bestN) { bestN = n; best = i; }
      }
      if (best < 0) best = PICTURE_ORDER.length - 1;
      return Object.freeze({ id: PICTURE_ORDER[best].id, mirror: true, repeat: true });
    } catch (e) {
      return Object.freeze({ id: PICTURE_ORDER[0].id, mirror: false, repeat: false });
    }
  }

  function normPick(lv, pick) {
    if (pick && typeof pick === "object" && typeof pick.id === "string" && orderIndex(pick.id) >= 0) {
      return { id: pick.id, mirror: pick.mirror === true, repeat: pick.repeat === true };
    }
    const p = pickPicture(lv, null);
    return { id: p.id, mirror: p.mirror, repeat: p.repeat };
  }

  function levelRow(lv) {
    let row = LEVELS[0];
    for (const r of LEVELS) if (lv >= r.from) row = r;
    return row;
  }

  function paramsFor(level, pick) {
    const lv = normLevel(level);
    const p = normPick(lv, pick);
    const T = TIERS[PICTURE_ORDER[orderIndex(p.id)].tier] || TIERS.S;
    let lids, ices;
    if (lv <= BASE_PICTURES) { const r = levelRow(lv); lids = r.lids; ices = r.ices; }
    else { lids = T.lids; ices = T.ices; }
    let kmin = T.kmin, kmax = T.kmax, pull = T.pull;
    if (p.repeat) { kmin = REPEAT_K.kmin; kmax = REPEAT_K.kmax; pull += 2; lids = T.lids + 1; ices = T.ices + 1; }
    else if (KSET[T.tier]) { kmin = KSET[T.tier][0]; kmax = KSET[T.tier][1]; }
    const over = p.repeat ? OVER.repeat : (OVER[T.tier] || 1);
    pull += (p.repeat ? PULL_ADD.repeat : (PULL_ADD[T.tier] || 0));
    const cw = p.repeat ? CARRY_TIERS.repeat : CARRY_TIERS[T.tier];
    const carry = cw > 1 ? cw : 1;
    return Object.freeze({ tier: T.tier, picture: p.id, mirror: p.mirror, repeat: p.repeat, kmin, kmax, pull, lids, ices, over, carry });
  }

  // ---------------------------------------------------------------- 面を作る（§2.2・§2.3・§2.4）

  // 盤（写し）で、ふちの角砂糖から上下左右に同じ色をたどって届く数（色ごと）。たどったマスを work に足す
  function reachByColor(b, work) {
    const n = b.W * b.H;
    const seen = new Uint8Array(n);
    const R = new Array(COLORS.length).fill(0);
    const W = b.W, H = b.H, cells = b.cells;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      if (c < 0 || seen[i] || !isEdge(b, i)) continue;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        R[c]++; work.n++;
        const x = k % W, y = (k - x) / W;
        if (x > 0 && !seen[k - 1] && cells[k - 1] === c) { seen[k - 1] = 1; stack.push(k - 1); }
        if (x < W - 1 && !seen[k + 1] && cells[k + 1] === c) { seen[k + 1] = 1; stack.push(k + 1); }
        if (y > 0 && !seen[k - W] && cells[k - W] === c) { seen[k - W] = 1; stack.push(k - W); }
        if (y < H - 1 && !seen[k + W] && cells[k + W] === c) { seen[k + W] = 1; stack.push(k + W); }
      }
    }
    return R;
  }

  function picBoard(pic) {
    const cells = Array.from(pic.cells);
    return { W: pic.W, H: pic.H, cells, out: computeOutside(pic.W, pic.H, cells), ord: orderFor(pic.W, pic.H), own: true };
  }

  // 運び切る順 S（1 箱だけで運び切れる箱の列）。chooser(cands, R, rem) → { color, n }
  function buildS(pic, chooser, work, anyColor) {
    const b = picBoard(pic);
    const rem = new Array(COLORS.length).fill(0);
    let left = 0;
    for (const v of b.cells) if (v >= 0) { rem[v]++; left++; }
    const S = [];
    while (left > 0) {
      const R = reachByColor(b, work);
      const cands = [];
      // over>1（①）では、いまふちに出ていない色も選べる（内側だけにある色の箱が最初から作られる）
      for (let c = 0; c < COLORS.length; c++) if (anyColor ? rem[c] > 0 : R[c] > 0) cands.push(c);
      if (!cands.length) return null;
      const { color, n } = chooser(cands, R, rem);
      if (n <= 0 || n > rem[color]) return null;
      // R を超える分（①）は、まだふちに出ていないマスも先に消して数える。
      // 盤から消す数は必ず n なので、持ち玉の合計＝角砂糖の数は保たれる
      for (let k = 0; k < n; k++) {
        let i = findTarget(b, color);
        if (i < 0) i = findAny(b, color);
        if (i < 0) return null;
        takeCell(b, i);
        work.n++;
      }
      rem[color] -= n; left -= n;
      S.push({ color, count: n });
    }
    return S;
  }

  // P（押す順）→ 列に配る → 仕掛け → 最初の局面と解。rng が null なら round-robin・仕掛けなし
  function layout(lv, pic, pk, P, rng, lids, ices, shuffleCols, carryN) {
    const cols = [[], [], [], []];
    const colOf = [], posOf = [];
    for (let k = 0; k < P.length; k++) {
      let c;
      if (rng) {
        let mn = Infinity;
        for (const a of cols) if (a.length < mn) mn = a.length;
        const allowed = [];
        for (let j = 0; j < COLS; j++) if (cols[j].length + 1 - mn <= 4) allowed.push(j);
        c = allowed[randInt(rng, allowed.length)];
      } else c = k % COLS;
      colOf.push(c); posOf.push(cols[c].length);
      cols[c].push(k);
    }
    // ②：列の中の順を無作為にする（P の順に押しても手前にあるとは限らなくなる）
    if (rng && shuffleCols) {
      for (let j = 0; j < COLS; j++) {
        shuffle(rng, cols[j]);
        for (let q = 0; q < cols[j].length; q++) { colOf[cols[j][q]] = j; posOf[cols[j][q]] = q; }
      }
    }
    // 手前に来るときの押した数 f
    const front = P.map((_, i) => (posOf[i] === 0 ? 0 : cols[colOf[i]][posOf[i] - 1] + 1));
    const lid = new Array(P.length).fill(false);
    const ice = new Array(P.length).fill(0);
    if (rng && lids > 0) {
      const cand = [];
      for (let i = 5; i < P.length; i++) if (posOf[i] > 0) cand.push(i);
      shuffle(rng, cand);
      for (let k = 0; k < Math.min(lids, cand.length); k++) lid[cand[k]] = true;
    }
    if (rng && ices > 0) {
      const cand = [];
      for (let i = 4; i < P.length; i++) if (!lid[i] && front[i] !== i) cand.push(i);
      shuffle(rng, cand);
      for (let k = 0; k < Math.min(ices, cand.length); k++) {
        const i = cand[k];
        ice[i] = Math.min(i, front[i] + 1 + randInt(rng, 4));
      }
    }
    // 箱の id は列ごとに手前から（解の順を DOM の id から読めないように）
    let nid = 0;
    const scols = cols.map((a) => a.map((k) => ({ id: nid++, color: P[k].color, count: P[k].count, lid: lid[k], ice: ice[k] })));
    const state = freezeState({
      level: lv, W: pic.W, H: pic.H, picture: pic.id, mirror: pk.mirror, repeat: pk.repeat,
      cells: Array.from(pic.cells), total: 0, left: 0, cols: scols, slots: new Array(SLOTS).fill(null), t: 0, presses: 0, won: false, carry: carryN,
      ...(() => { let n = 0; for (const v of pic.cells) if (v >= 0) n++; return { total: n, left: n }; })(),
    });
    return { state, solution: colOf };
  }

  // 確かめ（§2.3）：解の順に「落ち着くまで進める → 押す」。画面と同じ stepImpl・pressImpl を使う
  function verify(state0, solution, lv, work) {
    let s = state0;
    const settle = () => {
      for (;;) {
        const r = stepImpl(s);
        if (!r.moved) return;
        work.n += r.carries.length;
        s = r.state;
      }
    };
    for (const col of solution) {
      settle();
      const r = pressImpl(s, col);
      if (r.outcome.kind !== "press") return false;
      s = r.state;
    }
    settle();
    if (lv <= 2 && solution.length > EASY_BOXES) return false;
    return s.won === true;
  }

  // 解ける押し順を探す（①・②で「S の順」の保証が崩れたとき用）。画面と同じ pressImpl・stepImpl だけを使う。
  // 深さ優先＋ならべ方の手がかり：いま運べる箱（ふちに自分の色がある）を先に、同じなら持ち玉の少ない箱を先に。
  function solveSearch(state0, work, cap) {
    const path = [];
    const budget = { n: 0 };
    const settle = (s) => {
      for (;;) {
        const r = stepImpl(s);
        if (!r.moved) return s;
        work.n += r.carries.length;
        s = r.state;
      }
    };
    function dfs(s) {
      if (budget.n > cap || work.n > GEN_WORK) return false;
      s = settle(s);
      if (s.won) return true;
      budget.n++;
      const b = boardOf(s);
      // いま 1 箱だけで運び切れる数（色ごと）。わくを空けられる箱を先に押すための手がかり
      const R = reachByColor(b, { n: 0 });
      const cands = [];
      for (let c = 0; c < COLS; c++) {
        if (reasonFor(s, c) !== null) continue;
        const f = s.cols[c][0];
        cands.push({ c, wait: R[f.color] > 0 ? 0 : 1, stay: f.count > R[f.color] ? 1 : 0, count: f.count });
      }
      if (!cands.length) return false;
      cands.sort((a, z) => (a.wait - z.wait) || (a.stay - z.stay) || (a.count - z.count) || (a.c - z.c));
      // 枝を刈る：良い順に 2 つ試し、全部だめなら「待つ箱」も最後に 1 つだけ試す
      let use = cands.slice(0, 2);
      if (use.every((a) => a.wait === 0)) { const w = cands.find((a) => a.wait === 1); if (w) use = use.concat([w]); }
      for (const cd of use) {
        const r = pressImpl(s, cd.c);
        if (r.outcome.kind !== "press") continue;
        path.push(cd.c);
        if (dfs(r.state)) return true;
        path.pop();
      }
      return false;
    }
    return dfs(state0) ? path.slice() : null;
  }

  function tryBuild(lv, pic, pk, prm, rng, work, pull, lids, ices, opt, noOver, soften) {
    // 1・2 面は「どう押してもクリアできる」保証を守るため、①・②を使わない（§2.1）
    const easy = lv <= 2;
    // soften：配り直すたびに①の強さを半分に寄せる（解ける面が見つからない絵で、予備に落ちる前にやさしくする）
    // soften が 3 以上になったら①を完全にやめる（今までの作り＝必ず解ける面。予備に落ちる前の最後の手）
    const hard = (soften || 0) < 3;
    const over = (easy || noOver || !hard) ? 1 : 1 + ((prm.over || 1) - 1) * Math.pow(0.5, soften || 0);
    // 内側だけにある色の箱を最初から作るか（①の本体）。配り直しが 2 回を超えたらやめる
    const anyColor = !easy && !noOver && hard && (prm.over || 1) > 1 && (soften || 0) < 2;
    const shuffleCols = easy ? false : !!(opt || GEN_OPT).shuffleCols;
    const chooser = (cands, R, rem) => {
      const color = cands[randInt(rng, cands.length)];
      // 上限 cap：ふちから届く数 R の over 倍まで（over=1 なら今までと同じ R）。その色の残りは超えない
      const cap = over >= 1e9 ? rem[color] : Math.min(rem[color], Math.max(1, Math.ceil(R[color] * over)));
      let n = prm.kmin + randInt(rng, prm.kmax - prm.kmin + 1);
      if (n >= 5) n = Math.round(n / 5) * 5;
      if (easy) n = cap;
      else {
        n = Math.min(n, cap);
        if (rem[color] - n < prm.kmin && cap >= rem[color]) n = rem[color];
      }
      return { color, n: Math.max(1, Math.min(n, MAX_COUNT, cap)) };
    };
    const S = buildS(pic, chooser, work, anyColor);
    if (!S) return null;
    const P = S.slice();
    for (let k = 0; k < pull && P.length >= 2; k++) {
      const half = Math.floor(P.length / 2);
      const i = half + randInt(rng, P.length - half);
      const d = 2 + randInt(rng, 7);
      const j = Math.max(0, i - d);
      const [bx] = P.splice(i, 1);
      P.splice(j, 0, bx);
    }
    const built = layout(lv, pic, pk, P, rng, lids, ices, shuffleCols, (noOver ? 1 : (prm.carry || 1)));
    let solution = built.solution;
    if (anyColor || over > 1 || shuffleCols) {
      // solveSearch は画面と同じ press・step で最後まで進めて won を見ているので、これ自体が §2.3 の確かめになる。
      // 同じ再生をもう一度する（verify）のは手間の無駄なので、箱の数の決まりだけ見る
      solution = solveSearch(built.state, work, Math.min(600, P.length + (GEN_OPT.solveNodes || SOLVE_NODES)));
      if (!solution) return null;
      if (lv <= 2 && solution.length > EASY_BOXES) return null;
    } else if (!verify(built.state, solution, lv, work)) return null;
    return { state: built.state, solution };
  }

  function fallback2(lv, work) {
    const pic = parsePicture(FALLBACK_PICTURE, false);
    const chooser = (cands, R) => ({ color: cands[0], n: Math.min(R[cands[0]], FALLBACK_COUNT, MAX_COUNT) });
    const S = buildS(pic, chooser, work);
    if (!S) throw new Error("amai: 予備 2 の面が作れない");
    const pk = { id: pic.id, mirror: false, repeat: false };
    const { state, solution } = layout(lv, pic, pk, S, null, 0, 0, false, 1);
    if (!verify(state, solution, lv, work)) throw new Error("amai: 予備 2 の面が確かめを通らない");
    return { state, solution };
  }

  function createLevel(level, pick) {
    const lv = normLevel(level);
    const pk = normPick(lv, pick);
    const params = paramsFor(lv, pk);
    const seed = seedFor(lv);
    const rng = makeRng(seed);
    const work = { n: 0 };
    const pic = pictureById(pk.id, pk.mirror);
    let tries = 0;
    const done = (r, fallback) => ({
      state: r.state,
      info: Object.freeze({ level: lv, seed, params, tries, work: work.n, fallback, solution: Object.freeze(r.solution.slice()) }),
    });
    if (pic) {
      while (tries < (GEN_OPT.genTries || GEN_TRIES) && work.n < GEN_WORK - FALLBACK_RESERVE) {
        tries++;
        const r = tryBuild(lv, pic, pk, params, rng, work, params.pull, params.lids, params.ices, GEN_OPT, false, Math.floor((tries - 1) / GEN_OPT.softenEvery));
        if (r) return done(r, 0);
      }
      // 予備 1 は今までの作り（R で上限・P＝S・列は P の順）に戻す。これだけは必ず通る
      const r1 = tryBuild(lv, pic, pk, params, makeRng(seed ^ 0x5bd1e995), work, 0, 0, 0, { shuffleCols: false }, true);
      if (r1) return done(r1, 1);
    }
    return done(fallback2(lv, work), 2);
  }

  // ---------------------------------------------------------------- 再生（§4.2）

  function replay(level, pick, presses, t) {
    let s = null, applied = 0;
    try {
      s = createLevel(level, pick).state;
      const list = Array.isArray(presses) ? presses : [];
      for (const m of list) {
        if (!Array.isArray(m) || !isInt(m[0]) || !isInt(m[1])) return { state: s, ok: false, applied };
        while (s.t < m[0]) {
          const r = stepImpl(s);
          if (!r.moved) return { state: s, ok: false, applied };
          s = r.state;
        }
        if (s.t !== m[0]) return { state: s, ok: false, applied };
        const r = pressImpl(s, m[1]);
        if (r.outcome.kind !== "press") return { state: s, ok: false, applied };
        s = r.state;
        applied++;
      }
      const tt = isInt(t) ? t : -1;
      if (tt < s.t) return { state: s, ok: false, applied };
      while (s.t < tt) {
        const r = stepImpl(s);
        if (!r.moved) return { state: s, ok: false, applied };
        s = r.state;
      }
      return { state: s, ok: true, applied };
    } catch (e) {
      return { state: s, ok: false, applied };
    }
  }

  // ---------------------------------------------------------------- 保存（§4.2・§4.3）

  function validateSave(raw) {
    try {
      if (typeof raw !== "string") return null;
      let o;
      try { o = JSON.parse(raw); } catch (e) { return null; }
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
      if (o.v !== SAVE_V) return null;
      if (!isInt(o.level) || o.level < 1) return null;
      if (typeof o.pic !== "string" || !ID_RE.test(o.pic) || o.pic.length > 64) return null;
      if (typeof o.mirror !== "boolean" || typeof o.rep !== "boolean") return null;
      if (!Array.isArray(o.presses) || o.presses.length > MAX_PRESSES) return null;
      if (!isInt(o.t) || o.t < 0 || o.t > MAX_T) return null;
      let prev = 0;
      const presses = [];
      for (const m of o.presses) {
        if (!Array.isArray(m) || m.length !== 2) return null;
        const [pt, col] = m;
        if (!isInt(pt) || pt < 0 || pt > MAX_T || !isInt(col) || col < 0 || col >= COLS) return null;
        if (pt < prev) return null;
        prev = pt;
        presses.push([pt, col]);
      }
      if (prev > o.t) return null;
      return { level: o.level, pick: { id: o.pic, mirror: o.mirror, repeat: o.rep }, presses, t: o.t };
    } catch (e) { return null; }
  }

  function makeSave(level, pick, presses, t) {
    const p = pick && typeof pick === "object" ? pick : {};
    const list = Array.isArray(presses) ? presses.slice(0, MAX_PRESSES).map((m) => (Array.isArray(m) ? [m[0], m[1]] : m)) : [];
    return JSON.stringify({ v: SAVE_V, level: normLevel(level), pic: typeof p.id === "string" ? p.id : "", mirror: p.mirror === true, rep: p.repeat === true, presses: list, t: isInt(t) && t >= 0 ? t : 0 });
  }

  function validateBest(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return 0;
    if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  function recordBest(prevBest, clearedLevel) {
    const prev = validateBest(prevBest);
    const cl = validateBest(clearedLevel);
    const improved = cl > prev;
    return { best: improved ? cl : prev, improved };
  }

  // ずかん：壊れた項目だけ捨てる（PICTURE_ORDER に無い id も残す）。JSON 全体が壊れていれば空
  function validateBook(raw) {
    const b = emptyBook();
    try {
      let o = raw;
      if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { return b; } }
      if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== BOOK_V) return b;
      const g = o.got;
      if (!g || typeof g !== "object" || Array.isArray(g)) return b;
      for (const k of Object.keys(g)) {
        const n = g[k];
        if (ID_RE.test(k) && k.length <= 64 && isInt(n) && n >= 1 && n <= BOOK_MAX) b.got[k] = n;
      }
    } catch (e) { /* 空のまま */ }
    return b;
  }
  const bookString = (b) => JSON.stringify({ v: BOOK_V, got: b.got });

  function addToBook(raw, id) {
    const b = validateBook(raw);
    if (typeof id === "string" && ID_RE.test(id) && id.length <= 64) b.got[id] = Math.min(BOOK_MAX, gotOf(b, id) + 1);
    return bookString(b);
  }

  // 「1手もどし なし！」で クリアした絵の印：{"v":1,"ids":[…]}。壊れた・知らない id・重複は捨てる
  function validateClean(raw) {
    const out = { ids: [] };
    try {
      let o = raw;
      if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { return out; } }
      if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== BOOK_V || !Array.isArray(o.ids)) return out;
      const seen = new Set();
      for (const id of o.ids) {
        if (typeof id !== "string" || seen.has(id) || !PICTURE_ORDER.some((p) => p.id === id)) continue;
        seen.add(id);
        out.ids.push(id);
      }
    } catch (e) { /* 空のまま */ }
    return out;
  }
  const cleanString = (c) => JSON.stringify({ v: BOOK_V, ids: c.ids });

  function addClean(raw, id) {
    const c = validateClean(raw);
    if (typeof id === "string" && PICTURE_ORDER.some((p) => p.id === id) && c.ids.indexOf(id) < 0) c.ids.push(id);
    return cleanString(c);
  }

  function hasClean(raw, id) {
    return validateClean(raw).ids.indexOf(id) >= 0;
  }

  function bookCount(raw) {
    try {
      const b = bookOf(raw);
      let n = 0;
      for (const p of PICTURE_ORDER) if (gotOf(b, p.id) > 0) n++;
      return n;
    } catch (e) { return 0; }
  }

  function validateFlag(raw) {
    return raw === "1";
  }

  const api = Object.freeze({
    NAME, SLOTS, COLS, TICK_MS, FAST_MS, CARRY_N, CARRY_FROM,
    MAX_W, MAX_H, MAX_SUGAR, MAX_COUNT, MAX_PRESSES, MAX_T,
    GEN_TRIES, GEN_WORK, BASE_PICTURES, REPEAT_FROM, GEN_OPT, OVER, CARRY_TIERS, PULL_ADD, REPEAT_K, KSET,
    PICTURE_ORDER,
    SAVE_KEY_SAVE, SAVE_KEY_BEST, SAVE_KEY_BOOK, SAVE_KEY_HELP, SAVE_KEY_FAST, SAVE_KEY_CLEAN,
    COLORS, LEVELS, TIERS,
    makeRng, seedFor, paramsFor,
    parsePicture, pickPicture, pictureById,
    createLevel, press, step,
    isStable, isStuck, canPress, edgeCells, hud,
    replay, validateState,
    validateSave, makeSave,
    validateBest, recordBest, validateBook, addToBook, bookCount, validateClean, addClean, hasClean,
    validateFlag, colorName,
  });
  root.AmaiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
