/*
 * あまいものあつめ — ロジック（DOM・時計・乱数の関数・保存の場所に触れない純粋な計算だけ）
 * 契約：docs/ari-contract.md §1（決まり）・§2（面の作り方）・§4（保存）・§5.2（色と印）・§6.2（API）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.AmaiLogic、Node では module.exports と globalThis.AmaiLogic。
 * 絵は AmaiPictures（pictures-a.js・pictures-b.js・pictures-c.js・pictures-d.js・pictures-e.js・pictures-f.js が作る { add(list), byId }）から、使うときに読む。
 *   Node では ./pictures-a.js・./pictures-b.js・./pictures-c.js・./pictures-d.js・./pictures-e.js・./pictures-f.js を require する（無ければ絵は空として扱う）。
 *   byId は関数（byId(id)）でも、id → 絵 の表（オブジェクト）でもよい。
 *
 * 中の作り：
 *   - 公開する state はイミュータブル（凍結した新しいオブジェクトと配列）。logic が作った state は覚えておき（WeakSet）、
 *     次の press・step で確かめ直さない。外から来た state は validateState を通す。
 *   - 「外」（外とつながった空き）は cells から求める。速さのため、cells の配列ごとに外の表を覚えておき（WeakMap）、
 *     1 はこびでは運んだマスのまわりだけ足す（閉じた空きが外とつながったら、その空きをたどって外にする）。
 *   - 取る角砂糖は、巣から空いたマスと外の枠を歩く道のりがいちばん短いふちの角砂糖（2026-11-06）。同じ道のりなら ord（巣に近い → 下 → 左）の順。
 *     盤ごとに道のりの表と色ごとの山を持ち、運ぶたびに短くなった所だけ直す（「道のり」の節）。
 *   - 生成（createLevel）も、確かめも、画面と同じ press・step（中の pressImpl・stepImpl）を通る。
 *   - 生成の上限は時間ではなく手間の数（work）。どの端末でも同じ面になる。
 */
(function (root) {
  "use strict";

  const NAME = "あまいものあつめ";
  const SLOTS = 3;
  // ちょうせんモード（2026-11-05。計画書 docs/plans/amai-challenge.md §1）：わく 2 つ。1手もどすは 2026-11-10 から何回でも（前は 3 回まで。CHAL_UNDO はやめた。約束 §0.11）。
  // 選べるのはクリアしたことのある 1〜250 面だけ（main が決める）。面は ふつう と同じ作り方で、わく 2 つの局面で確かめる
  const CHAL_SLOTS = 2;
  const EASY_BOXES = 5;   // 1〜2 面の箱の数の上限（1・2 面の絵は割っていない＝元の大きさなので 5 のまま。わくは 3 なので §2.1 の「必ず入る」保証は弱まる）
  // 1 はこびで 1 箱が運ぶ角砂糖の数（段 0b の測定用。1 なら今までと同じ動き）。
  // CARRY_FROM 以上の面だけ CARRY_N 個運ぶ。持ち玉の合計＝角砂糖の数は変えない（アリの数は同じ。1 回で CARRY_N 匹が運ぶイメージ）。
  const CARRY_N = 1;
  const CARRY_FROM = 1;
  // 1 はこびで 2 個運ぶ段（段 0f の測定用。空なら今までと同じ動き）。くり返しの面には使わない
  const CARRY_TIERS = {};
  const COLS = 4;
  const TICK_MS = 120;
  const FAST_MS = 60;
  const MAX_W = 64;
  const MAX_H = 48;
  const MAX_SUGAR = 3072;   // 64×48 をすべて埋めた数（2026-11-05 に 2800 から上げた。背景を足すため。計画書 docs/plans/amai-bg.md §4）
  const MAX_COUNT = 99;
  const MAX_PRESSES = 400;
  const MAX_T = 5000;
  const GEN_TRIES = 20;
  const GEN_WORK = 400000;   // 絵を 2×2 に割ってマスが 4 倍になり、47 面は 258179 まで使う。余裕を増やした（v53 の技術レビュー T-8）
  const FALLBACK_RESERVE = 60000;   // 予備 1 の手間のために残す分（work が GEN_WORK を超えないように、配り直しをここで止める）
  // 段 0e の測定用の取っ手（既定は false＝今までと同じ面ができる）。
  //   capRemain … 箱の数の上限を「今ふちから届く数 R」ではなく「その色の残り全部」にする（①）
  //   shuffleCols … 列の中の順を P の順でなく無作為にする（②。押したい箱が奥に埋まる）
  // どちらかが true のときは「S の順に押せば解ける」保証が崩れるので、解ける押し順を探して確かめる（solveSearch）。
  // over … 箱の持ち玉の上限を「ふちから届く数 R」の何倍まで許すか（段ごと。1 なら今までと同じ＝必ず単独で運び切れる）。
  //   1 より大きいと「置いた時点では運び切れない箱」ができ、道を開ける仕事が生まれる（①）。Infinity ならその色の残り全部。
  // 2026-11-03（場面の絵 46 枚に入れ替えて測り直し。計画書 docs/plans/amai-redraw.md §8.4〜§8.6）：新しい絵は詰みやすいので、
  // L・XL・XXL・くり返しは①を使わない（1＝S の順で必ず解ける作り。作る時間も最大 20〜30ms に下がる）。M だけ①を少し強めた
  const OVER = { S: 1.1, M: 1.25, L: 1, XL: 1, XXL: 1, repeat: 1 };
  // ANY_RATE：①（内側だけにある色の箱を最初から作る）を使う箱の割合（段ごと。1 なら全部の箱・0 なら使わない）。
  // 絵を 2 倍に割ってマスが 4 倍になり、①の「入／切」だけでは難しさが飛びすぎたので、途中の強さを作るために足した
  // 2026-11-05（背景をうめた 148 枚で測り直し。計画書 docs/plans/amai-bg.md §6）：S 1 → 0.5・M 0.5 → 0.3（むずかしくなりすぎたので①を弱めた）
  const ANY_RATE = { S: 0.5, M: 0.3, L: 1, XL: 0.25, XXL: 0.25, repeat: 1 };   // OVER が 1 の段では使われない
  // 2026-11-03（49〜100 面の 52 枚を足し、3 面から先を一段むずかしく。計画書 docs/plans/amai-more.md §4.1・§6）：
  // 箱を小さく（S 25–45・M 12–45・XL 40–80・XXL 25–50）、L は pull を 2 にした。1・2 面は箱の数を cap で決めるので KSET.S は効かない
  const PULL_ADD = { S: 0, M: 0, L: -2, XL: -8, XXL: -12, repeat: 0 };   // 段の pull に足す（XL・XXL は pull 0・L は 2。S は 1・2 面にも効くので 0 のまま）
  // 2026-11-05（背景をうめた 148 枚。amai-bg.md §6）：XXL 25–50 → 50–99（箱を大きく。ゆるい 30 → 35%）
  const KSET = { S: [25, 45], M: [12, 45], L: [80, 99], XL: [40, 80], XXL: [50, 99] };   // 段ごとの箱の数の幅の上書き。空なら TIERS の値
  const GEN_OPT = { shuffleCols: false, solveNodes: 15, genTries: 5, softenEvery: 1 };
  const SOLVE_NODES = 15;   // 解ける押し順の探索で開く局面の上限は「箱の数＋この余り」（1 回の tryBuild ごと・600 まで）
  const BASE_PICTURES = 250;   // 1〜250 面は PICTURE_ORDER の順に 1 枚ずつ。251 面からくり返し（49〜100 面は 2026-11-03、101〜150 面は 2026-11-04、151〜200 面は 2026-11-09、2026-11-10 に 50 枚足して並べ替えた。計画書 docs/plans/amai-more.md・amai-more2.md・amai-parts.md）
  const REPEAT_FROM = 9;
  const FRESH_FROM = 3;   // 251 面からの「ずかんにまだ無い絵を先に」を探し始める絵の番号（§2.7）
  const SAVE_V = 1;
  const BOOK_V = 1;
  const BOOK_MAX = 9999;

  const SAVE_KEY_SAVE = "amai.save";
  const SAVE_KEY_BEST = "amai.best";
  const SAVE_KEY_BOOK = "amai.book";
  const SAVE_KEY_HELP = "amai.help";
  const SAVE_KEY_FAST = "amai.fast";
  const SAVE_KEY_CLEAN = "amai.clean";
  const SAVE_KEY_GOLD = "amai.gold";   // ちょうせんでクリアした絵（金の花輪。形は amai.clean と同じ）

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
    // 2026-11-05 に足した 2 色（背景を落ち着かせるため。ユーザー「色を2つ足してください」→「こいみどりとむらさき」。計画書 docs/plans/amai-bg.md §3.1）
    [10, "D", "darkgreen", "こいみどり", "#1F5E35", "moon", [".###.", "##...", "##...", "##...", ".###."]],
    [11, "V", "purple", "むらさき", "#8A5CC8", "drop", ["..#..", ".###.", "#####", "#####", ".###."]],
  ].map(([id, letter, key, name, hex, mark, dots]) => Object.freeze({ id, letter, key, name, hex, mark, dots: Object.freeze(dots) })));
  const LETTER = Object.freeze(Object.fromEntries(COLORS.map((c) => [c.letter, c.id])));

  // ---------------------------------------------------------------- 段と面の表（§2.1。仮）
  // 段の値（251 面からは lids・ices にこの「多い方」を使う。くり返しは +1）
  const TIERS = Object.freeze({
    // 色の数・角砂糖の範囲は 2026-11-05 に背景をうめた 148 枚に合わせた（計画書 docs/plans/amai-bg.md §6）。kmin〜ices は前のまま
    S: Object.freeze({ tier: "S", colors: Object.freeze([3, 5]), sugar: Object.freeze([110, 1000]), kmin: 60, kmax: 99, pull: 0, lids: 0, ices: 0 }),
    M: Object.freeze({ tier: "M", colors: Object.freeze([5, 7]), sugar: Object.freeze([1200, 1480]), kmin: 40, kmax: 99, pull: 2, lids: 1, ices: 0 }),
    L: Object.freeze({ tier: "L", colors: Object.freeze([7, 10]), sugar: Object.freeze([2280, 3072]), kmin: 40, kmax: 99, pull: 4, lids: 2, ices: 1 }),
    XL: Object.freeze({ tier: "XL", colors: Object.freeze([9, 11]), sugar: Object.freeze([2860, 3072]), kmin: 40, kmax: 99, pull: 8, lids: 3, ices: 2 }),
    XXL: Object.freeze({ tier: "XXL", colors: Object.freeze([8, 12]), sugar: Object.freeze([2400, 3072]), kmin: 40, kmax: 99, pull: 12, lids: 4, ices: 3 }),
  });
  // 1〜250 面の仕掛けの数（面の番号で決める）
  const LEVELS = Object.freeze([
    { from: 1, to: 4, tier: "S", lids: 0, ices: 0 },
    { from: 5, to: 8, tier: "M", lids: 0, ices: 0 },
    { from: 9, to: 12, tier: "M", lids: 1, ices: 0 },
    { from: 13, to: 18, tier: "L", lids: 1, ices: 0 },
    { from: 19, to: 24, tier: "L", lids: 2, ices: 1 },
    { from: 25, to: 30, tier: "XL", lids: 3, ices: 1 },
    { from: 31, to: 36, tier: "XL", lids: 3, ices: 2 },
    { from: 37, to: 250, tier: "XXL", lids: 4, ices: 3 },
  ].map((r) => Object.freeze(r)));
  const REPEAT_K = { kmin: 12, kmax: 40 };

  // 絵の並び（§2.6 の表の順）。2026-11-10 に 50 枚足し、3 面からを段（S〜XXL）の中だけで並べ替えた（§2.6 の「面の並べ方の決まり」。
  // 並びは docs/plans/amai-parts/order.js が決まった計算で作る docs/plans/amai-parts/order.txt と同じ。手で並べかえない）。
  // id はローマ字（かなを 1 字ずつ書く形。のばす音は母音を重ねる）・英小文字だけ。
  // 配列そのものは凍結しない（テスト AL13 が 251 枚目を足して確かめるため）。中の項目は凍結。
  // 3〜48 面は 2026-11-02 に場面の絵へ描き直し、id も替えた（計画書 docs/plans/amai-redraw.md §7）。古い id（sakura・ichigo …）は
  // ここに無いので、途中の保存の絵が古い id なら main が同じ面の番号で新しい絵から始め、ずかん・もどしなしの印の古い id は残すが数えない。
  const PICTURE_ORDER = [
    // 1〜36 面（S〜XL の段。3〜36 面は となりの面に同じ行動・場所・動物を続けない）
    ["ringo", "S"], ["sakuranbo", "S"], ["nekoyukiyamaoyatsu", "S"], ["usagidaidokoronemuru", "S"],
    ["inuumibeoyatsu", "M"], ["usagikouennemuru", "M"], ["kumaumibebooru", "M"], ["inuyukiyamanemuru", "M"], ["nekodaidokorooyatsu", "M"], ["usagiyukiyamabooru", "M"], ["inukouennemuru", "M"], ["nekoyukiyamabooru", "M"],
    ["usagikouenoyatsu", "L"], ["inuumibebooru", "L"], ["kumakouennemuru", "L"], ["nekodaidokorobooru", "L"], ["kumakouenoyatsu", "L"], ["inuyukiyamabooru", "L"],
    ["nekoumibeoyatsu", "L"], ["usagikouenbooru", "L"], ["kumadaidokoronemuru", "L"], ["inukouenbooru", "L"], ["kumayukiyamaoyatsu", "L"], ["nekokouenbooru", "L"],
    ["usagiumibenemuru", "XL"], ["inudaidokorobooru", "XL"], ["nekoumibenemuru", "XL"], ["inuyukiyamaoyatsu", "XL"], ["nekodaidokoronemuru", "XL"], ["kumakouenbooru", "XL"],
    ["inuumibenemuru", "XL"], ["kumadaidokorobooru", "XL"], ["nekokouenoyatsu", "XL"], ["kumaumibenemuru", "XL"], ["inudaidokorooyatsu", "XL"], ["nekoumibebooru", "XL"],
    // 37〜250 面（XXL の段。36→37 面の境目から、同じ行動は間を 3 面以上あける・同じ場所と同じ動物は となりの面に続けない）
    ["usagikouenoekaki", "XXL"], ["inudaidokoronemuru", "XXL"], ["usagiyukiyamaoyatsu", "XXL"], ["inumoribooru", "XXL"], ["nekokouenoekaki", "XXL"], ["kumayukiyamanemuru", "XXL"],
    ["usagidaidokorooyatsu", "XXL"], ["kumayukiyamabooru", "XXL"], ["inudaidokorooekaki", "XXL"], ["nekokouennemuru", "XXL"], ["kumaumibeoyatsu", "XXL"], ["usagidaidokorobooru", "XXL"],
    ["pandakouenoekaki", "XXL"], ["nekomorinemuru", "XXL"], ["pandakouenoyatsu", "XXL"], ["nekomoribooru", "XXL"], ["kumaumibeoekaki", "XXL"], ["inumorinemuru", "XXL"],
    ["pandadaidokorooyatsu", "XXL"], ["usagiumibebooru", "XXL"], ["pandayukiyamaoekaki", "XXL"], ["usagimorinemuru", "XXL"], ["inukouenoyatsu", "XXL"], ["kumamoribooru", "XXL"],
    ["pandaumibeoekaki", "XXL"], ["kumamorinemuru", "XXL"], ["pandaumibeoyatsu", "XXL"], ["usagimoribooru", "XXL"], ["kumayukiyamaoekaki", "XXL"], ["pandadaidokoronemuru", "XXL"],
    ["inumorioyatsu", "XXL"], ["pandakouenbooru", "XXL"], ["kumadaidokorooekaki", "XXL"], ["pandaumibenemuru", "XXL"], ["nekomorioyatsu", "XXL"], ["pandayukiyamabooru", "XXL"],
    ["usagiumibeoekaki", "XXL"], ["pandamorinemuru", "XXL"], ["nekokouenodoru", "XXL"], ["usagimorioyatsu", "XXL"], ["nekoumibeoekaki", "XXL"], ["pandayukiyamanemuru", "XXL"],
    ["kumadaidokoroodoru", "XXL"], ["pandaumibebooru", "XXL"], ["inumorioekaki", "XXL"], ["pandakouennemuru", "XXL"], ["kumahanabatakeodoru", "XXL"], ["pandayukiyamaoyatsu", "XXL"],
    ["usagidaidokorooekaki", "XXL"], ["pandamoribooru", "XXL"], ["inukouenodoru", "XXL"], ["pandamorioyatsu", "XXL"], ["nekoyukiyamaoekaki", "XXL"], ["pandadaidokorobooru", "XXL"],
    ["usagihanabatakenemuru", "XXL"], ["pandamoriodoru", "XXL"], ["inuumibeoekaki", "XXL"], ["pandahanabatakebooru", "XXL"], ["kumamorioyatsu", "XXL"], ["inudaidokoroodoru", "XXL"],
    ["nekomorioekaki", "XXL"], ["usagihanabatakebooru", "XXL"], ["penginmachihon", "XXL"], ["pandahanabatakeoyatsu", "XXL"], ["nekodaidokorooekaki", "XXL"], ["kumahanabatakebooru", "XXL"],
    ["nekoumibeodoru", "XXL"], ["inuhanabatakenemuru", "XXL"], ["kumamorioekaki", "XXL"], ["nekohanabatakebooru", "XXL"], ["pandadaidokoroodoru", "XXL"], ["nekohanabatakenemuru", "XXL"],
    ["inuyukiyamaoekaki", "XXL"], ["nekohanabatakeoyatsu", "XXL"], ["kumaumibeodoru", "XXL"], ["inuhanabatakebooru", "XXL"], ["kumakouenoekaki", "XXL"], ["pandahanabatakenemuru", "XXL"],
    ["usagidaidokoroodoru", "XXL"], ["inuhanabatakeoyatsu", "XXL"], ["zouyuuenchiutau", "XXL"], ["usagihanabatakeoekaki", "XXL"], ["inumoriodoru", "XXL"], ["kumahanabatakenemuru", "XXL"],
    ["butahoshizorajitensha", "XXL"], ["pandahanabatakeoekaki", "XXL"], ["usagikouenodoru", "XXL"], ["kumahanabatakeoyatsu", "XXL"], ["kaerumoriutau", "XXL"], ["inuhanabatakeoekaki", "XXL"],
    ["usagiumibeodoru", "XXL"], ["nekomachihon", "XXL"], ["usagihanabatakeoyatsu", "XXL"], ["penginyuuenchiutau", "XXL"], ["nekomoriodoru", "XXL"], ["kumahanabatakeoekaki", "XXL"],
    ["zoudaidokorohon", "XXL"], ["inukouenjitensha", "XXL"], ["usagiyukiyamaodoru", "XXL"], ["nekohanabatakeoekaki", "XXL"], ["butamorihon", "XXL"], ["zoumachijitensha", "XXL"],
    ["pandaumibeodoru", "XXL"], ["butahanabatakeutau", "XXL"], ["penginmoribooru", "XXL"], ["kaeruhanabatakehon", "XXL"], ["pandakouenodoru", "XXL"], ["kaeruyuuenchijitensha", "XXL"],
    ["zouumibeoyatsu", "XXL"], ["usagihanabatakeutau", "XXL"], ["nekoyukiyamaodoru", "XXL"], ["penginkouenjitensha", "XXL"], ["butayuuenchioyatsu", "XXL"], ["kaerudaidokoronemuru", "XXL"],
    ["usagimoriodoru", "XXL"], ["kumayuuenchiutau", "XXL"], ["butaumibeoekaki", "XXL"], ["zouyukiyamanemuru", "XXL"], ["kaerukouenodoru", "XXL"], ["pandamachijitensha", "XXL"],
    ["zoumoriutau", "XXL"], ["penginyukiyamahon", "XXL"], ["kumamoriodoru", "XXL"], ["butamachijitensha", "XXL"], ["kaeruhoshizorautau", "XXL"], ["butayuuenchihon", "XXL"],
    ["penginhanabatakeodoru", "XXL"], ["zoukouenjitensha", "XXL"], ["penginumibeutau", "XXL"], ["nekohoshizorahon", "XXL"], ["kumayukiyamaodoru", "XXL"], ["inuyuuenchijitensha", "XXL"],
    ["butadaidokoroutau", "XXL"], ["kaerumachihon", "XXL"], ["zouhanabatakeoyatsu", "XXL"], ["penginhoshizorajitensha", "XXL"], ["kaeruyuuenchiodoru", "XXL"], ["zouhoshizorahon", "XXL"],
    ["pengindaidokorobooru", "XXL"], ["kaeruumibejitensha", "XXL"], ["usagihoshizorautau", "XXL"], ["butakouenoyatsu", "XXL"], ["penginmachiodoru", "XXL"], ["kaeruyukiyamanemuru", "XXL"],
    ["kumamoriutau", "XXL"], ["butamachioekaki", "XXL"], ["penginhoshizoraoyatsu", "XXL"], ["pandayukiyamajitensha", "XXL"], ["zouhoshizoranemuru", "XXL"], ["penginumibeoekaki", "XXL"],
    ["zoumachibooru", "XXL"], ["penginkouenhon", "XXL"], ["zouyukiyamaodoru", "XXL"], ["penginyuuenchinemuru", "XXL"], ["zouumibeoekaki", "XXL"], ["penginmachioyatsu", "XXL"],
    ["zouhoshizoraodoru", "XXL"], ["penginyukiyamanemuru", "XXL"], ["zouyuuenchibooru", "XXL"], ["pengindaidokorooekaki", "XXL"], ["zoukouenutau", "XXL"], ["penginhanabatakejitensha", "XXL"],
    ["butaumibeodoru", "XXL"], ["zoumorihon", "XXL"], ["butayuuenchibooru", "XXL"], ["penginmoriutau", "XXL"], ["butadaidokoroodoru", "XXL"], ["zouhanabatakejitensha", "XXL"],
    ["butahoshizorabooru", "XXL"], ["zoudaidokorooekaki", "XXL"], ["penginhoshizoraodoru", "XXL"], ["zoumachioyatsu", "XXL"], ["butayukiyamanemuru", "XXL"], ["kaeruyuuenchibooru", "XXL"],
    ["inuhanabatakeodoru", "XXL"], ["butakouenjitensha", "XXL"], ["kaeruhoshizoraoyatsu", "XXL"], ["butamachinemuru", "XXL"], ["kaeruhoshizoraodoru", "XXL"], ["butahanabatakehon", "XXL"],
    ["kaeruyukiyamabooru", "XXL"], ["butamoriutau", "XXL"], ["kaeruumibeoekaki", "XXL"], ["inuyukiyamaodoru", "XXL"], ["kaerumachioyatsu", "XXL"], ["usagihoshizorajitensha", "XXL"],
    ["butayuuenchioekaki", "XXL"], ["inuumibeodoru", "XXL"], ["kaerukouenutau", "XXL"], ["kumamachihon", "XXL"], ["kaerudaidokorooekaki", "XXL"], ["usagihanabatakeodoru", "XXL"],
    ["nekomachiutau", "XXL"], ["kaerumorihon", "XXL"], ["inukouenoekaki", "XXL"], ["pandayukiyamaodoru", "XXL"], ["kaeruhanabatakejitensha", "XXL"], ["inuyuuenchihon", "XXL"],
    ["pandadaidokorooekaki", "XXL"], ["kumakouenodoru", "XXL"], ["inuhoshizorajitensha", "XXL"], ["pandayuuenchiutau", "XXL"], ["usagimorioekaki", "XXL"], ["nekohanabatakeodoru", "XXL"],
    ["pandahoshizorajitensha", "XXL"], ["usagimachiutau", "XXL"], ["pandamorioekaki", "XXL"], ["nekodaidokoroodoru", "XXL"], ["usagiumibeoyatsu", "XXL"], ["nekoyuuenchihon", "XXL"],
    ["kumahoshizorautau", "XXL"], ["pandahanabatakeodoru", "XXL"], ["usagiyukiyamaoekaki", "XXL"], ["kumadaidokorooyatsu", "XXL"],
  ].map(([id, tier]) => Object.freeze({ id, tier }));

  // 予備 2 の絵（§2.2 の 8.。りんご。絵が読めないときもこれで遊べる）
  const FALLBACK_PICTURE = Object.freeze({ id: "ringo", name: "りんご", season: "", map: Object.freeze([
    "........CC..GGGG....",
    "........CC..GGGG....",
    "........CCGGGGGG....",
    "........CCGGGGGG....",
    "....RRRRCCRRRRRR....",
    "....RRRRCCRRRRRR....",
    "..RRRRRRRRRRRRRRRR..",
    "..RRRRRRRRRRRRRRRR..",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRR",
    "..RRRRRRRRRRRRRRRR..",
    "..RRRRRRRRRRRRRRRR..",
    "....RRRRRR..RRRR....",
    "....RRRRRR..RRRR....",
  ]) });
  const FALLBACK_COUNT = 99;   // 予備 2 の箱の大きさの上限（持ち玉の上限と同じ。絵を 2 倍に割った分）

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
    for (const f of ["./pictures-a.js", "./pictures-b.js", "./pictures-c.js", "./pictures-d.js", "./pictures-e.js", "./pictures-f.js"]) {
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

  // 文字の地図 → { id, name, season, W, H, cells }。決まり（§2.6 の 1・2・4・5・6、角砂糖 3072 以下（MAX_SUGAR））を守らない絵は null。
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

  // ---------------------------------------------------------------- 道のり（2026-11-06。計画書 docs/plans/amai-route.md §2 B）
  // ユーザー「経路の1番近いところから、に変更できますか？」：取る角砂糖は、巣から**空いたマスと外の枠だけを歩く道のり**が
  // いちばん短いふちの角砂糖（同じ道のりなら ord の順＝前の決まりの順）。
  // 道のりの格子は、絵のまわりに 1 マスの「外の枠」を足した (W+2)×(H+2)。巣（出発）は下の枠の (round((W−1)/2)+1, H+1)。
  // 歩けるのは外の枠と「外」（外とつながった空き）のマス。描画（render.js の findRoute）も同じ格子・同じ出発で幅優先に歩くので、
  // ありんこが歩く道の長さ＝ここで比べた道のり（選んだ理由が見て分かる）。
  // 速さ：盤ごとに「道のりの表 dist」と「色ごとのふちの角砂糖の山（小さい順のヒープ。鍵＝(道のり)×R＋順位）」を持ち、
  // 運ぶたびに、運んだマス（と、つながった閉じた空き）から短くなった所だけ幅優先で直す（外が広がると道のりは短くなるだけ）。
  // findTarget は山の先頭を見るだけ（O(1)・盤を変えない）。
  const INF = 0x3fffffff;
  const rankCache = new Map();
  function rankFor(W, H) {
    const key = W * 100 + H;
    let r = rankCache.get(key);
    if (r) return r;
    const ord = orderFor(W, H);
    r = new Int32Array(W * H);
    for (let k = 0; k < ord.length; k++) r[ord[k]] = k;
    rankCache.set(key, r);
    return r;
  }
  // 巣の出発のマス（外の枠つきの格子の番号）。render.js の findRoute と同じ
  function nestV(W, H) { return (H + 1) * (W + 2) + Math.min(W + 1, Math.max(0, Math.round((W - 1) / 2) + 1)); }
  const qCache = new Map();
  function queueFor(n) { let q = qCache.get(n); if (!q) { q = new Int32Array(n); qCache.set(n, q); } return q; }
  // ヒープ（色ごと）。鍵は rt.key[マス]、場所は rt.pos[マス]
  function hUp(h, k, key, pos) {
    const v = h[k], kv = key[v];
    while (k > 0) { const p = (k - 1) >> 1, u = h[p]; if (key[u] <= kv) break; h[k] = u; pos[u] = k; k = p; }
    h[k] = v; pos[v] = k;
  }
  function hDown(h, n, k, key, pos) {
    const v = h[k], kv = key[v];
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && key[h[c + 1]] < key[h[c]]) c++;
      if (key[h[c]] >= kv) break;
      h[k] = h[c]; pos[h[k]] = k; k = c;
    }
    h[k] = v; pos[v] = k;
  }
  // 歩けるマス v（外の枠つき）のまわりの角砂糖の鍵を、v の道のり dv から直す
  function touch(b, v, dv) {
    const W = b.W, H = b.H, vw = W + 2, rt = b.rt, cells = b.cells, key = rt.key, pos = rt.pos, rank = rt.rank, R = W * H;
    const vx = v % vw, vy = (v - vx) / vw;
    for (let d = 0; d < 4; d++) {
      const x = (d === 0 ? vx - 1 : d === 1 ? vx + 1 : vx) - 1, y = (d === 2 ? vy - 1 : d === 3 ? vy + 1 : vy) - 1;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x, c = cells[j];
      if (c < 0) continue;
      const nk = (dv + 1) * R + rank[j];
      if (nk >= key[j]) continue;
      key[j] = nk;
      const h = rt.heap[c];
      if (pos[j] < 0) { const n = rt.hn[c]++; h[n] = j; hUp(h, n, key, pos); } else hUp(h, pos[j], key, pos);
    }
  }
  function walkable(b, v) {
    const vw = b.W + 2, vx = v % vw, vy = (v - vx) / vw;
    if (vx === 0 || vy === 0 || vx === vw - 1 || vy === b.H + 1) return true;
    return b.out[(vy - 1) * b.W + (vx - 1)] === 1;
  }
  // q[0..n) の歩けるマス（道のりは入れてある）から、短くなった所を幅優先で広げる。変わったマスのまわりの鍵も直す
  function relax(b, q, n) {
    const vw = b.W + 2, vh = b.H + 2, dist = b.rt.dist;
    let head = 0;
    while (head < n) {
      const v = q[head++], dv = dist[v];
      touch(b, v, dv);
      const vx = v % vw, vy = (v - vx) / vw, nd = dv + 1;
      if (vx > 0 && dist[v - 1] > nd && walkable(b, v - 1)) { dist[v - 1] = nd; q[n++] = v - 1; }
      if (vx < vw - 1 && dist[v + 1] > nd && walkable(b, v + 1)) { dist[v + 1] = nd; q[n++] = v + 1; }
      if (vy > 0 && dist[v - vw] > nd && walkable(b, v - vw)) { dist[v - vw] = nd; q[n++] = v - vw; }
      if (vy < vh - 1 && dist[v + vw] > nd && walkable(b, v + vw)) { dist[v + vw] = nd; q[n++] = v + vw; }
    }
  }
  // 盤 b（W・H・cells・out）の道のりの表と山を一から作る
  function buildRoute(b) {
    const W = b.W, H = b.H, n = W * H, vn = (W + 2) * (H + 2);
    const cnt = new Int32Array(COLORS.length);
    for (let i = 0; i < n; i++) { const c = b.cells[i]; if (c >= 0) cnt[c]++; }
    const heap = [];
    for (let c = 0; c < COLORS.length; c++) heap.push(new Int32Array(cnt[c]));
    b.rt = { dist: new Int32Array(vn).fill(INF), key: new Float64Array(n).fill(Infinity), pos: new Int32Array(n).fill(-1), heap, hn: new Int32Array(COLORS.length), rank: rankFor(W, H) };
    const q = queueFor(vn), st = nestV(W, H);
    b.rt.dist[st] = 0; q[0] = st;
    relax(b, q, 1);
    return b.rt;
  }
  function copyRoute(rt) {
    return { dist: rt.dist.slice(), key: rt.key.slice(), pos: rt.pos.slice(), heap: rt.heap.map((h) => h.slice()), hn: rt.hn.slice(), rank: rt.rank };
  }

  // 盤：{ W, H, cells, out, rt, ord, own }。own が false の間は state の配列をそのまま読み、運ぶときに写す
  const outCache = new WeakMap();   // cells の配列 → { out: 外の表, lists: 色ごとの並び, rt: 道のりの表と山 }
  function boardOf(s) {
    let e = outCache.get(s.cells);
    const ord = orderFor(s.W, s.H);
    if (!e) { e = { out: null, lists: null, rt: null }; outCache.set(s.cells, e); }
    if (!e.out) { e.out = computeOutside(s.W, s.H, s.cells); e.rt = null; }
    if (!e.rt) e.rt = buildRoute({ W: s.W, H: s.H, cells: s.cells, out: e.out });
    return { W: s.W, H: s.H, cells: s.cells, out: e.out, rt: e.rt, ord, own: false, lists: e.lists, ptr: null, e };
  }
  function isEdge(b, i) {
    const W = b.W, x = i % W, y = (i - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === b.H - 1) return true;
    const o = b.out;
    return o[i - 1] === 1 || o[i + 1] === 1 || o[i - W] === 1 || o[i + W] === 1;
  }
  // 色ごとの「運ぶ順のマスの並び」（生成で「まだ届かない分」を数える findAny だけが使う。この盤のあいだだけ使う表）。
  // マスは運ばれて空きになるだけ（色が増えることはない）ので、先頭の目印 p は後ろへ進めるだけでよい。
  function buildLists(W, H, cells, ord) {
    const tmp = [];
    for (let c = 0; c < COLORS.length; c++) tmp.push([]);
    for (let k = 0; k < ord.length; k++) {
      const i = ord[k], v = cells[i];
      if (v >= 0) tmp[v].push(i);
    }
    const out = [];
    for (let c = 0; c < COLORS.length; c++) out.push(Int32Array.from(tmp[c]));
    return out;
  }
  function colorLists(b) {
    if (!b.lists) { b.lists = buildLists(b.W, b.H, b.cells, b.ord); if (b.e && !b.own) b.e.lists = b.lists; }
    if (!b.ptr) b.ptr = new Int32Array(COLORS.length);
    return b.lists;
  }
  // その色の、道のりがいちばん短いふちの角砂糖（同じなら運ぶ順 ord が先のもの。無ければ -1）。山の先頭を見るだけ
  function findTarget(b, color) {
    const rt = b.rt;
    if (!rt || !(color >= 0 && color < rt.hn.length) || rt.hn[color] === 0) return -1;
    return rt.heap[color][0];
  }
  // その色の、運ぶ順で一番先の角砂糖（ふちでなくてもよい。生成で「まだ届かない分」を数えるときだけ使う）
  function findAny(b, color) {
    const a = colorLists(b)[color];
    if (!a) return -1;
    const cells = b.cells, ptr = b.ptr;
    let p = ptr[color];
    while (p < a.length && cells[a[p]] !== color) p++;
    ptr[color] = p;
    return p < a.length ? a[p] : -1;
  }
  // マス i を運ぶ（空きにして、外を広げ、道のりと山を直す）
  function takeCell(b, i) {
    if (!b.own) {
      b.cells = Array.from(b.cells);
      // 外の表と道のりの表は、覚えた元（前の局面の cells の表）から引き取って書きかえる（写すと 1 はこびごとに重い）。
      // 元の局面をもう一度使うとき（1手もどし・生成の別の手）は boardOf が cells から作り直す
      const e = b.e;
      if (e && e.out === b.out && e.rt === b.rt) { e.out = null; e.rt = null; }
      else { b.out = Uint8Array.from(b.out); b.rt = copyRoute(b.rt); }
      b.own = true; b.e = null;
    }
    const W = b.W, H = b.H, vw = W + 2, rt = b.rt, cells = b.cells, out = b.out;
    const c = cells[i];
    if (c >= 0 && rt.pos[i] >= 0) {
      // 山から抜く（最後の要素を i の場所へ入れて、上か下へ直す）
      const h = rt.heap[c], k = rt.pos[i], last = h[--rt.hn[c]];
      rt.pos[i] = -1;
      if (last !== i) { h[k] = last; rt.pos[last] = k; hUp(h, k, rt.key, rt.pos); hDown(h, rt.hn[c], rt.pos[last], rt.key, rt.pos); }
    }
    rt.key[i] = Infinity;
    cells[i] = -1;
    const q = queueFor(vw * (H + 2));
    let n = 0;
    if (!out[i]) {
      // 外を広げる（閉じた空きとつながったら、その空きも外にする）。新しく外になったマスを覚える
      out[i] = 1;
      const add = [i];
      for (let t = 0; t < add.length; t++) {
        const k = add[t], x = k % W, y = (k - x) / W;
        if (x > 0 && cells[k - 1] < 0 && !out[k - 1]) { out[k - 1] = 1; add.push(k - 1); }
        if (x < W - 1 && cells[k + 1] < 0 && !out[k + 1]) { out[k + 1] = 1; add.push(k + 1); }
        if (y > 0 && cells[k - W] < 0 && !out[k - W]) { out[k - W] = 1; add.push(k - W); }
        if (y < H - 1 && cells[k + W] < 0 && !out[k + W]) { out[k + W] = 1; add.push(k + W); }
      }
    }
    // i の道のり＝まわりの歩けるマスの道のり＋1（閉じた空きは i を通ってだけつながるので、i から広げれば足りる）
    const x = i % W, y = (i - x) / W, v = (y + 1) * vw + x + 1, dist = rt.dist;
    let m = INF;
    if (dist[v - 1] < m && walkable(b, v - 1)) m = dist[v - 1];
    if (dist[v + 1] < m && walkable(b, v + 1)) m = dist[v + 1];
    if (dist[v - vw] < m && walkable(b, v - vw)) m = dist[v - vw];
    if (dist[v + vw] < m && walkable(b, v + vw)) m = dist[v + vw];
    if (m < INF && m + 1 < dist[v]) { dist[v] = m + 1; q[n++] = v; }
    if (n) relax(b, q, n);
  }

  // ---------------------------------------------------------------- 局面

  const trusted = new WeakSet();
  function freezeState(o, lite) {
    if (!lite) Object.freeze(o.cells);
    for (const c of o.cols) { for (const bx of c) Object.freeze(bx); Object.freeze(c); }
    Object.freeze(o.cols);
    for (const bx of o.slots) if (bx) Object.freeze(bx);
    Object.freeze(o.slots);
    Object.freeze(o);
    trusted.add(o);
    return o;
  }
  const mkState = (s, ch, lite) => freezeState({
    level: s.level, W: s.W, H: s.H, picture: s.picture, mirror: s.mirror, repeat: s.repeat,
    cells: s.cells, total: s.total, left: s.left, cols: s.cols, slots: s.slots, t: s.t, presses: s.presses, won: s.won, carry: s.carry, ...ch,
  }, lite);

  // 1 はこびで 1 箱が運ぶ数。面の番号と絵から導く（paramsFor と同じ値。保存からは読まない）
  function carryFor(level, picture, mirror, repeat) {
    try {
      const n = paramsFor(level, { id: picture, mirror: !!mirror, repeat: !!repeat }).carry;
      return n > 1 ? n : 1;
    } catch (e) { return 1; }
  }

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
      if (!Array.isArray(slots) || (slots.length !== SLOTS && slots.length !== CHAL_SLOTS)) return null;   // わく 3 つ（ふつう）か 2 つ（ちょうせん）
      const nslots = [];
      for (const bx of slots) {
        if (bx === null) { nslots.push(null); continue; }
        if (!bx || typeof bx !== "object" || !okId(bx.id) || !okColor(bx.color) || !okCount(bx.count)) return null;
        nslots.push({ id: bx.id, color: bx.color, count: bx.count });
      }
      // carry（1 はこびで運ぶ数）は保存しない。面の番号と絵から毎回導く（契約 §4 の保存の形は変えない）
      return freezeState({ level, W, H, picture, mirror, repeat, cells: nc, total, left, cols: ncols, slots: nslots, t, presses, won, carry: carryFor(level, picture, mirror, repeat) });
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

  // lite（skipStuck）：生成の再生用。stuck を数えず、運んだマスの札も作らない（数 n だけ返す）
  function stepImpl(s, skipStuck, reuse) {
    if (s.won) return { state: s, moved: false, carries: Object.freeze([]), n: 0, won: true, stuck: false };
    // reuse：同じ cells の配列を持つ盤を続けて使う（lite の落ち着きの間だけ。写しは最初の 1 回だけになる）
    const b = (skipStuck && reuse && reuse.cells === s.cells && reuse.own === true) ? reuse : boardOf(s);
    const slots = s.slots.slice();
    const carries = [];
    let n = 0;
    let left = s.left;
    for (let k = 0; k < slots.length; k++) {   // わくの数は局面の slots の長さ（ふつう 3・ちょうせん 2）
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
        n++;
        if (!skipStuck) carries.push(Object.freeze({ slot: k, id: bx.id, color: bx.color, cell: i, x, y: (i - x) / s.W, emptied: count === 0 }));
      }
      if (took === 0) continue;   // その色のふちが無い：待つ
      slots[k] = count === 0 ? null : { id: bx.id, color: bx.color, count };
    }
    if (n === 0) return { state: s, moved: false, carries: Object.freeze([]), n: 0, won: false, stuck: skipStuck ? false : stuckImpl(s, b) };
    outCache.set(b.cells, { out: b.out, lists: b.lists, rt: b.rt });
    const state = mkState(s, { cells: b.cells, left, slots, t: s.t + 1, won: left === 0 }, skipStuck);
    // skipStuck：生成の再生（verify・solveSearch）では stuck を見ないので数えない（マスが 4 倍になった分の手間を減らす）
    const stuck = skipStuck ? false : stuckImpl(state, { ...b, own: false, ptr: null, e: null });
    return { state, moved: true, carries: Object.freeze(carries), n, won: state.won, stuck, board: b };
  }

  function step(state) {
    try {
      const s = asState(state);
      if (!s) return { state, moved: false, carries: Object.freeze([]), n: 0, won: false, stuck: false };
      return stepImpl(s);
    } catch (e) {
      return { state, moved: false, carries: Object.freeze([]), n: 0, won: false, stuck: false };
    }
  }

  function isStable(state) {
    try { const s = asState(state); return s ? stableImpl(s) : true; } catch (e) { return true; }
  }
  function isStuck(state) {
    try { const s = asState(state); return s ? stuckImpl(s) : false; } catch (e) { return false; }
  }

  // 今のふちの角砂糖（運ぶ順＝道のりの短い順、同じなら ord の順。color を決めればその色だけ）
  function edgeCells(state, color) {
    try {
      const s = asState(state);
      if (!s) return [];
      const b = boardOf(s);
      const want = color === undefined || color === null ? null : color;
      const res = [];
      for (let i = 0; i < s.cells.length; i++) {
        const v = s.cells[i];
        if (v >= 0 && (want === null || v === want) && isEdge(b, i)) res.push(i);
      }
      const key = b.rt.key;
      res.sort((a, z) => key[a] - key[z]);
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
      // ずかんにまだ無い絵（0 回）を、反転せずに先に出す。3 枚目から（1・2 枚目はやさしい面だけの絵）。
      // 3〜48 枚目も入れるのは、絵を描き直して id が替わったとき（2026-11-02）、くり返しに入っている人が新しい絵を
      // 反転のくり返しで初めて見ないようにするため（計画書 docs/plans/amai-redraw.md §8.2）。足した 49〜250 枚目も同じ
      // （ベスト 49 以上・101 以上・151 以上・201 以上だった人や、並べ替えで前の面に動いた絵を飛ばした人は、その絵を 251 面から反転せずに先に見る）
      for (let i = FRESH_FROM - 1; i < PICTURE_ORDER.length; i++) {
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
    // 面の表（ふた・こおり）を使うのは、絵の段が面の段と同じときだけ（2026-11-11。約束 §2.6・§2.7）。
    // ・面の番号どおりの絵は、いつも面の段と同じ（新しく遊ぶ面の盤は前と変わらない）
    // ・2026-11-10 の並べ替えで面の絵が変わった途中の保存（同じ段の中の前の絵）も、面の表で前と同じ盤になり、続きから遊べる
    // ・151〜200 面・201〜250 面を足す前の途中の保存（新しい絵を先に見せるで選ばれた絵）は、XXL 以外の絵ならその絵の段の値、
    //   XXL の絵なら面の表（37 面からは XXL の段の値と同じ）で、前と同じ盤になる
    if (lv <= BASE_PICTURES && T.tier === levelRow(lv).tier) { const r = levelRow(lv); lids = r.lids; ices = r.ices; }
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
  const seenCache = new Map();   // 絵の大きさ → 使い回す作業用の表（毎回作ると GC が重い）
  function reachByColor(b, work) {
    const n = b.W * b.H;
    let seen = seenCache.get(n);
    if (!seen) { seen = new Uint8Array(n); seenCache.set(n, seen); } else seen.fill(0);
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
    const b = { W: pic.W, H: pic.H, cells, out: computeOutside(pic.W, pic.H, cells), rt: null, ord: orderFor(pic.W, pic.H), own: true, lists: null, ptr: null, e: null };
    buildRoute(b);
    return b;
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
      // over>1（①）では、いまふちに出ていない色も選べる（内側だけにある色の箱が最初から作られる）。
      // anyColor が関数のときは箱ごとに決める（ANY_RATE）
      const useAny = typeof anyColor === "function" ? anyColor() : !!anyColor;
      for (let c = 0; c < COLORS.length; c++) if (useAny ? rem[c] > 0 : R[c] > 0) cands.push(c);
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
  function layout(lv, pic, pk, P, rng, lids, ices, shuffleCols, carryN, nslots) {
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
      cells: Array.from(pic.cells), total: 0, left: 0, cols: scols, slots: new Array(nslots === CHAL_SLOTS ? CHAL_SLOTS : SLOTS).fill(null), t: 0, presses: 0, won: false, carry: carryN,
      ...(() => { let n = 0; for (const v of pic.cells) if (v >= 0) n++; return { total: n, left: n }; })(),
    });
    return { state, solution: colOf };
  }

  // 確かめ（§2.3）：解の順に「落ち着くまで進める → 押す」。画面と同じ stepImpl・pressImpl を使う
  function verify(state0, solution, lv, work) {
    let s = state0;
    const settle = () => {
      let b = null;
      for (;;) {
        const r = stepImpl(s, true, b);
        if (!r.moved) return;
        work.n += r.n;
        s = r.state;
        b = r.board && r.board.own ? r.board : null;
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
      let b = null;
      for (;;) {
        const r = stepImpl(s, true, b);
        if (!r.moved) return s;
        work.n += r.n;
        s = r.state;
        b = r.board && r.board.own ? r.board : null;
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

  // ---------------------------------------------------------------- だいじょうぶな ところまで もどす（計画書 docs/plans/amai-rescue.md・約束 §1.13）
  // 「落ち着いてから押す」遊び方（§2.3 と同じ）で、局面から全部運べるかを調べる。少しずつ進められる（画面が止まらないよう、main が区切って呼ぶ）。
  //   1 段目（とく）：生成の solveSearch と同じ ならべ方・同じ刈り方で、上限「箱の数＋RESCUE_EASY」まで。見つかれば「とける」。
  //   2 段目（しらべつくす）：同じ ならべ方で、押せる列を全部試す（同じ局面は 1 回だけ。局面の鍵は列の長さ・わく・絵）。
  //     全部試して見つからなければ「とけない」と言い切る（dead）。開いた局面が limit を超えたら「わからない」（unknown）。
  // 返す：run(n) → { done, result: "solved"|"dead"|"unknown"|null, nodes }。nodes は 1 段目と 2 段目で開いた局面の合計（手間の数。時計は使わない）。
  const RESCUE_EASY = 15;
  const RESCUE_LIMIT = 400;   // 2 段目で開く局面の上限（既定）
  function settleLite(s) {
    let b = null;
    for (;;) {
      const r = stepImpl(s, true, b);
      if (!r.moved) return s;
      s = r.state;
      b = r.board && r.board.own ? r.board : null;
    }
  }
  // 局面の鍵：列の長さ・わくの箱（id と数）・絵（cells を 2 つの 32 bit の指紋にする。取り違えの見込みは 2^-64 ほど）
  function rescueKey(s) {
    let k = "";
    for (const c of s.cols) k += c.length + ",";
    for (const bx of s.slots) k += bx ? bx.id + ":" + bx.count + "," : "-,";
    const cells = s.cells;
    let h1 = 0x811c9dc5, h2 = 0x9747b28c;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i] + 2;
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ (v + i), 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
    return k + (h1 >>> 0).toString(36) + "." + (h2 >>> 0).toString(36);
  }
  // 押せる列を、解けそうな順に（solveSearch と同じ手がかり：いま運べる箱 → 1 箱で運び切れる箱 → 持ち玉の少ない箱 → 列の番号）
  function rescueCands(s) {
    const R = reachByColor(boardOf(s), { n: 0 });
    const cands = [];
    for (let c = 0; c < COLS; c++) {
      if (reasonFor(s, c) !== null) continue;
      const f = s.cols[c][0];
      cands.push({ c, wait: R[f.color] > 0 ? 0 : 1, stay: f.count > R[f.color] ? 1 : 0, count: f.count });
    }
    cands.sort((a, z) => (a.wait - z.wait) || (a.stay - z.stay) || (a.count - z.count) || (a.c - z.c));
    return cands;
  }
  function makeRescue(state, opt) {
    const o = opt && typeof opt === "object" ? opt : {};
    const s0 = asState(state);
    const limit = isInt(o.limit) && o.limit >= 0 ? o.limit : RESCUE_LIMIT;
    let boxes = 0;
    if (s0) for (const c of s0.cols) boxes += c.length;
    const easyCap = boxes + RESCUE_EASY;
    let stage = 1, nodes = 0, used = [0, 0, 0], result = s0 ? null : "unknown", stack = null, wonPath = null;
    const seen = new Set();
    // 局面を開く（落ち着かせて積む）。"won"＝クリアに着いた・"seen"＝2 段目で前に見た局面・"open"＝積んだ
    function open(s, col, prune) {
      s = settleLite(s);
      if (s.won) return "won";
      if (!prune) {
        const key = rescueKey(s);
        if (seen.has(key)) return "seen";
        seen.add(key);
      }
      used[stage]++;
      nodes++;
      let cands = rescueCands(s);
      if (prune) {   // 生成の solveSearch と同じ刈り方：良い順に 2 つ、どちらも運べる箱なら「待つ箱」を 1 つ足す
        let use = cands.slice(0, 2);
        if (use.every((a) => a.wait === 0)) { const w = cands.find((a) => a.wait === 1); if (w) use = use.concat([w]); }
        cands = use;
      }
      stack.push({ s, col, cands, i: 0 });
      return "open";
    }
    const pathOf = (last) => stack.slice(1).map((f) => f.col).concat(last === undefined ? [] : [last]);
    // 1 段を n 局面まで進める。"won"・"empty"（全部試した）・"cap"（上限）・"more"（続きがある）
    function runStage(n, prune) {
      const cap = prune ? easyCap : limit;
      const at = nodes;
      if (stack === null) {
        stack = [];
        const r = open(s0, -1, prune);
        if (r === "won") { wonPath = []; return "won"; }
      }
      while (stack.length) {
        if (used[stage] > cap) return "cap";
        if (nodes - at >= n) return "more";
        const fr = stack[stack.length - 1];
        if (fr.i >= fr.cands.length) { stack.pop(); continue; }
        const cd = fr.cands[fr.i++];
        const r = pressImpl(fr.s, cd.c);
        if (r.outcome.kind !== "press") continue;
        const v = open(r.state, cd.c, prune);
        if (v === "won") { wonPath = pathOf(cd.c); return "won"; }
      }
      return "empty";
    }
    return {
      run(n) {
        const max = typeof n === "number" && n > 0 ? n : Infinity;
        const at = nodes;
        try {
          while (result === null && nodes - at < max) {
            const r = runStage(max - (nodes - at), stage === 1);
            if (r === "won") result = "solved";
            else if (r === "empty" || r === "cap") {
              if (stage === 1) { stage = 2; stack = null; }
              else result = r === "empty" ? "dead" : "unknown";
            }
          }
        } catch (e) { result = "unknown"; }
        return { done: result !== null, result, nodes, path: wonPath ? wonPath.slice() : null };
      },
    };
  }
  // 戻し先を探す（§1.13 R4）。states[k]＝k 番目の手を押す直前の局面（replayStates・main の履歴）。
  // 新しい方（k＝n−1）から 1 まで、1 局面ずつ makeRescue（上限 limit）で調べ、「とける」と言い切れた いちばん新しい k を返す。
  // 合計の手間が budget に届いた・どれも言い切れない：k＝0（面の最初。生成で解けると確かめた局面なので sure は opt.base0Sure）。
  // run(n) → { done, k, sure, nodes }（done までは k は null）
  const REWIND_LIMIT = 60;
  const REWIND_BUDGET = 1500;
  function makeRewind(states, opt) {
    const o = opt && typeof opt === "object" ? opt : {};
    const list = Array.isArray(states) ? states : [];
    const limit = isInt(o.limit) && o.limit >= 0 ? o.limit : REWIND_LIMIT;
    const budget = isInt(o.budget) && o.budget >= 0 ? o.budget : REWIND_BUDGET;
    const base0Sure = o.base0Sure === true;
    let k = list.length - 1, cur = null, nodes = 0, done = null;
    const finish = (kk, sure) => { done = { done: true, k: kk, sure, nodes }; return done; };
    return {
      run(n) {
        if (done) return done;
        const max = typeof n === "number" && n > 0 ? n : Infinity;
        let used = 0;
        try {
          while (used < max) {
            if (k < 1) return finish(0, base0Sure);
            if (nodes >= budget) return finish(0, base0Sure);
            if (!cur) cur = { k, base: 0, r: makeRescue(list[k], { limit }) };
            const want = Math.min(max - used, budget - nodes);
            const r = cur.r.run(want);
            const step = r.nodes - cur.base;
            cur.base = r.nodes;
            used += step; nodes += step;
            if (r.done) {
              if (r.result === "solved") return finish(cur.k, true);
              cur = null; k--;
            } else if (step <= 0) { cur = null; k--; }   // 進まない（壊れた局面）：次へ
          }
        } catch (e) { return finish(0, base0Sure); }
        return { done: false, k: null, sure: false, nodes };
      },
    };
  }
  // すぐに最後まで調べる（テスト・デバッグ用）
  function rescueSearch(state, opt) { return makeRescue(state, opt).run(Infinity); }

  function tryBuild(lv, pic, pk, prm, rng, work, pull, lids, ices, opt, noOver, soften, nslots) {
    // 1・2 面は「どう押してもクリアできる」保証を守るため、①・②を使わない（§2.1）
    const easy = lv <= 2;
    // soften：配り直すたびに①の強さを半分に寄せる（解ける面が見つからない絵で、予備に落ちる前にやさしくする）
    // soften が 3 以上になったら①を完全にやめる（今までの作り＝必ず解ける面。予備に落ちる前の最後の手）
    const hard = (soften || 0) < 3;
    const over = (easy || noOver || !hard) ? 1 : 1 + ((prm.over || 1) - 1) * Math.pow(0.5, soften || 0);
    // 内側だけにある色の箱を最初から作るか（①の本体）。配り直しが 2 回を超えたらやめる
    const anyBase = !easy && !noOver && hard && (prm.over || 1) > 1 && (soften || 0) < 2;
    const rate = anyBase ? (prm.repeat ? ANY_RATE.repeat : ANY_RATE[prm.tier]) : 0;
    const anyRate = typeof rate === "number" ? rate : 1;
    // 箱ごとに①を使うかを決める（割合が 1 なら今までと同じ＝全部の箱で使う）
    const anyColor = anyBase && (anyRate >= 1 ? true : (anyRate <= 0 ? false : () => rng() < anyRate));
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
    const built = layout(lv, pic, pk, P, rng, lids, ices, shuffleCols, (noOver ? 1 : (prm.carry || 1)), nslots);
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

  function fallback2(lv, work, nslots) {
    const pic = parsePicture(FALLBACK_PICTURE, false);
    const chooser = (cands, R) => ({ color: cands[0], n: Math.min(R[cands[0]], FALLBACK_COUNT, MAX_COUNT) });
    const S = buildS(pic, chooser, work);
    if (!S) throw new Error("amai: 予備 2 の面が作れない");
    const pk = { id: pic.id, mirror: false, repeat: false };
    const { state, solution } = layout(lv, pic, pk, S, null, 0, 0, false, 1, nslots);
    if (!verify(state, solution, lv, work)) throw new Error("amai: 予備 2 の面が確かめを通らない");
    return { state, solution };
  }

  // opt.challenge が true なら ちょうせん（わく 2 つ）の面。作り方は ふつう と同じ（同じ種・同じ手順）で、
  // 配った局面のわくを 2 つにして確かめる（verify・solveSearch がわく 2 つで最後まで運べたものだけを返す）。
  // 予備 1（S の順・引き寄せなし）は 1 箱ずつ運び切るので、わく 1 つでも必ず通る
  function createLevel(level, pick, opt) {
    const lv = normLevel(level);
    const pk = normPick(lv, pick);
    const params = paramsFor(lv, pk);
    const seed = seedFor(lv);
    const rng = makeRng(seed);
    const work = { n: 0 };
    const pic = pictureById(pk.id, pk.mirror);
    const chal = !!(opt && typeof opt === "object" && opt.challenge === true);
    const ns = chal ? CHAL_SLOTS : SLOTS;
    let tries = 0;
    const done = (r, fallback) => ({
      state: r.state,
      info: Object.freeze({ level: lv, seed, params, tries, work: work.n, fallback, challenge: chal, solution: Object.freeze(r.solution.slice()) }),
    });
    if (pic) {
      while (tries < (GEN_OPT.genTries || GEN_TRIES) && work.n < GEN_WORK - FALLBACK_RESERVE) {
        tries++;
        const r = tryBuild(lv, pic, pk, params, rng, work, params.pull, params.lids, params.ices, GEN_OPT, false, Math.floor((tries - 1) / GEN_OPT.softenEvery), ns);
        if (r) return done(r, 0);
      }
      // 予備 1 は今までの作り（R で上限・P＝S・列は P の順）に戻す。これだけは必ず通る
      const r1 = tryBuild(lv, pic, pk, params, makeRng(seed ^ 0x5bd1e995), work, 0, 0, 0, { shuffleCols: false }, true, 0, ns);
      if (r1) return done(r1, 1);
    }
    return done(fallback2(lv, work, ns), 2);
  }

  // ---------------------------------------------------------------- 再生（§4.2）

  function replay(level, pick, presses, t, opt) {
    let s = null, applied = 0;
    try {
      s = createLevel(level, pick, opt).state;   // opt.challenge：ちょうせんの面（わく 2 つ）で再生する
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

  // 押した手のそれぞれの直前の局面（だいじょうぶな ところまで もどすの戻し先の候補。§1.13）。replay と同じ道で 1 回だけ再生する。
  // 返す：{ ok, states }（states[k]＝k 番目の手を押す直前の局面。ok が false なら途中まで）
  function replayStates(level, pick, presses, opt) {
    const states = [];
    try {
      let s = createLevel(level, pick, opt).state;
      const list = Array.isArray(presses) ? presses : [];
      for (const m of list) {
        if (!Array.isArray(m) || !isInt(m[0]) || !isInt(m[1])) return { ok: false, states };
        while (s.t < m[0]) {
          const r = stepImpl(s);
          if (!r.moved) return { ok: false, states };
          s = r.state;
        }
        if (s.t !== m[0]) return { ok: false, states };
        const r = pressImpl(s, m[1]);
        if (r.outcome.kind !== "press") return { ok: false, states };
        states.push(s);
        s = r.state;
      }
      return { ok: true, states };
    } catch (e) {
      return { ok: false, states };
    }
  }

  // ---------------------------------------------------------------- 保存（§4.2・§4.3）

  // 絵の目印（課題 AM-18。2026-11-05）：その面の絵の地図（W・H・cells。反転した面は反転した cells）と mirror の FNV-1a 32 bit を 8 桁の 16 進の文字にする。
  // 途中の保存（amai.save の picSig）に書き、開くときに今の絵の目印と比べる。合わなければ押した手を使わずその面の最初から（§4.2）
  // 2026-11-06（計画書 amai-route.md §2 B）：取る角砂糖の決まり（道のり）が変わったので、決まりの版 RULE_V も混ぜる。
  // 前の版（v67 まで。RULE_V を混ぜていない目印）の途中の保存は合わなくなり、同じ面の最初から（押した手は今の決まりでは別の局面になるため）
  const SIG_RE = /^[0-9a-f]{8}$/;
  const RULE_V = 2;   // 1＝v67 まで（まっすぐの近さ）・2＝道のり
  const sigCache = new Map();
  function pictureSig(pick) {
    try {
      if (!pick || typeof pick !== "object" || typeof pick.id !== "string") return "";
      const m = pick.mirror === true;
      const pic = pictureById(pick.id, m);
      if (!pic) return "";
      const hit = sigCache.get(pic);
      if (hit) return hit;
      let h = 0x811c9dc5;
      const mix = (v) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
      mix(pic.W); mix(pic.H); mix(m ? 1 : 0);
      for (let i = 0; i < pic.cells.length; i++) mix(pic.cells[i] + 1);
      mix(0xa5); mix(RULE_V);   // 決まりの版（2026-11-06）
      const sig = (h >>> 0).toString(16).padStart(8, "0");
      sigCache.set(pic, sig);
      return sig;
    } catch (e) { return ""; }
  }
  // 保存（validateSave の結果）の押した手を今の盤で使ってよいか。目印が今の絵と決まりの目印と同じなら true。
  // 目印の無い古い保存（v66 まで）は、どの面も合わないとみなす（2026-11-06 から。前は 1・2 面だけ true だったが、決まりが変わったので 1・2 面も最初から）
  function saveFits(sv) {
    try {
      if (!sv || typeof sv !== "object" || !isInt(sv.level) || sv.level < 1 || !sv.pick) return false;
      const now = pictureSig(sv.pick);
      if (now === "") return false;
      return typeof sv.sig === "string" && sv.sig !== "" && sv.sig === now;
    } catch (e) { return false; }
  }

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
      // picSig は無くてよい（v66 までの保存）。文字でない・形ちがい（8 桁の 16 進でない）なら目印なし（""）として扱い、保存は捨てない（面の番号を残す）
      const sig = typeof o.picSig === "string" && SIG_RE.test(o.picSig) ? o.picSig : "";
      return { level: o.level, pick: { id: o.pic, mirror: o.mirror, repeat: o.rep }, presses, t: o.t, sig };
    } catch (e) { return null; }
  }

  function makeSave(level, pick, presses, t) {
    const p = pick && typeof pick === "object" ? pick : {};
    const list = Array.isArray(presses) ? presses.slice(0, MAX_PRESSES).map((m) => (Array.isArray(m) ? [m[0], m[1]] : m)) : [];
    return JSON.stringify({ v: SAVE_V, level: normLevel(level), pic: typeof p.id === "string" ? p.id : "", mirror: p.mirror === true, rep: p.repeat === true, presses: list, t: isInt(t) && t >= 0 ? t : 0, picSig: pictureSig(p) });
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

  // 「1手もどし なし！」で クリアした絵の印：{"v":1,"ids":[…]}。壊れた id（英小文字でない・65 字以上）・重複は捨てる。
  // PICTURE_ORDER に無い id（3〜48 面の絵を描き直す前の古い id など）は捨てずに残す（データを消さない。amai.book と同じ。計画書 amai-redraw.md §7.1）
  function validateClean(raw) {
    const out = { ids: [] };
    try {
      let o = raw;
      if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { return out; } }
      if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== BOOK_V || !Array.isArray(o.ids)) return out;
      const seen = new Set();
      for (const id of o.ids) {
        if (typeof id !== "string" || seen.has(id) || !ID_RE.test(id) || id.length > 64) continue;
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

  // ちょうせんでクリアした絵の印（amai.gold）：形・検査は amai.clean と同じ（壊れた値は空・壊れた id と重複は捨てる・古い id は残す）
  function validateGold(raw) { return validateClean(raw); }
  function addGold(raw, id) { return addClean(raw, id); }
  function hasGold(raw, id) { return hasClean(raw, id); }

  function bookCount(raw) {
    try {
      const b = bookOf(raw);
      let n = 0;
      for (const p of PICTURE_ORDER) if (gotOf(b, p.id) > 0) n++;
      return n;
    } catch (e) { return 0; }
  }

  // 面えらび（2026-11-03。計画書 docs/plans/amai-select.md §1）：選べるのは 1〜ベスト＋1 面。
  // 一覧に並べるのは 1〜250 面（BASE_PICTURES。絵が 1 枚ずつ決まっている面）。ベスト＋1 が 251 面より先なら、
  // その 1 面だけを「つづき」として別に出す（一覧を長くしない）。壊れたベストは 0（1 面だけ選べる）。例外を出さない
  function levelChoices(best) {
    const b = validateBest(best);
    const top = b < Number.MAX_SAFE_INTEGER ? b + 1 : Number.MAX_SAFE_INTEGER;   // 選べる一番先の面
    const list = Math.min(BASE_PICTURES, PICTURE_ORDER.length);                 // 一覧の面の数（鍵つきも並べる）
    return { top, list, open: Math.min(top, list), more: top > list ? top : 0 };
  }
  function canSelect(best, level) {
    return Number.isSafeInteger(level) && level >= 1 && level <= levelChoices(best).top;   // 数だけ（"3" などの文字は通さない）
  }

  function validateFlag(raw) {
    return raw === "1";
  }

  const api = Object.freeze({
    NAME, SLOTS, CHAL_SLOTS, COLS, TICK_MS, FAST_MS, CARRY_N, CARRY_FROM,
    MAX_W, MAX_H, MAX_SUGAR, MAX_COUNT, MAX_PRESSES, MAX_T,
    GEN_TRIES, GEN_WORK, BASE_PICTURES, REPEAT_FROM, GEN_OPT, OVER, ANY_RATE, CARRY_TIERS, PULL_ADD, REPEAT_K, KSET,
    PICTURE_ORDER,
    SAVE_KEY_SAVE, SAVE_KEY_BEST, SAVE_KEY_BOOK, SAVE_KEY_HELP, SAVE_KEY_FAST, SAVE_KEY_CLEAN, SAVE_KEY_GOLD,
    COLORS, LEVELS, TIERS,
    makeRng, seedFor, paramsFor,
    parsePicture, pickPicture, pictureById,
    createLevel, press, step,
    isStable, isStuck, canPress, edgeCells, hud,
    replay, validateState, replayStates, makeRescue, rescueSearch, makeRewind, RESCUE_LIMIT, REWIND_LIMIT, REWIND_BUDGET,
    validateSave, makeSave, pictureSig, saveFits,
    validateBest, recordBest, validateBook, addToBook, bookCount, validateClean, addClean, hasClean, validateGold, addGold, hasGold,
    levelChoices, canSelect,
    validateFlag, colorName,
  });
  root.AmaiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
