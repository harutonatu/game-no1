# いろびん — 部品どうしの約束（契約書）

3人の担当（ロジック・画面・組み込み）が同じ約束のもとで**並列に**作業するための1枚紙です。実装後は不要になります（tests/design.md に取り込むか削除）。
ユーザーの承認（2026-10-19）：「はい、ワークフローで」（PM が示した「色水を仕分けるパズル＋上の動物の注文に応えて瓶を片付ける新ゲームを、約束→分担して並列に作る→レビュー→テスト合格後、公開前にユーザーに確認」への返事）。
ハシわたり・ピカッと早押しの教訓（§14）と、課題管理表の W-04〜W-06 を最初から入れてあります。
**ルール変更（ユーザー決定 2026-10-19）**：「消えるだけにする。空き瓶が増えると指数関数的に難易度が下がるため　修正後公開してください」。届けた瓶は消えるだけで、空き瓶は出てこない（§1.1）。瓶の番号の扱い（§1.2）・面の表（§3.2）・保存の形（§4.2、v:2）・演出（§7.3）・テスト（§12）をこれに合わせて直した。

## 1. ねらいと中身

- 1人用のパズル。**瓶をタップで選び、別の瓶をタップして注ぐ**。同じ色を1本にそろえると、瓶が光って栓がされ、上の動物のお客さんに届く。
- 遊びの核は「どの順で注ぐか」の1つだけ。時間制限・コイン・広告・動画で開く台・有料のお助け・ログインボーナス・時間で急かす仕掛けは**使わない**。
- **一番気持ちいい瞬間＝1色そろう瞬間**（ユーザーの言葉）。光る・栓が「ぽん」と落ちる・粒が散る・音が鳴る・（対応端末なら）短く震える。ここを一番作り込む（§7.3）。
- 参考にした市販ゲームの画面収録（board0.png など）は**遊びの構造の参考だけ**。絵・キャラクター・文言・色はまねしない。動物は**オリジナルをプログラムで描く**。
- **表示名は1か所の定数**：`IrobinLogic.NAME = "いろびん"`（仮名）。ゲーム画面の `<title>` と見出しは main.js が起動時にこの定数で上書きする（HTML に書く文字は控え）。メニューの `GAMES` の `name` は別ファイルなので、テスト BW15 が `NAME` と一致することを確かめる（名前を変えるときは logic.js とメニューの2か所。テストが食い違いを見つける）。
- **フォルダ名**：`games/irobin/`。効果音のゲーム名は `"irobin"`。保存キーは `irobin.*`（ほかのゲームのキーに触らない）。

### 1.1 ルール（ロジックの正）

- 瓶は1本 `CAP = 4` 段。中身は下から上への色の並び。
- **注げる**のは：元の瓶が空でなく・栓をしていない。相手が元と別の瓶で・栓をしていない・空きがある。相手が空か、相手の一番上の色が元の一番上の色と同じ。
- **注ぐ量**：元の一番上から、同じ色が**見えている（隠れていない）**ぶんだけ続く数と、相手の空きの、小さい方。まとめて一度に注ぐ。
- **隠れた色**：難しい面では、最初の瓶の一番上以外は「？」（隠れ）。注いで上がどいたら、**新しく一番上になった1段だけ**が見えるようになる。隠れた段は注ぐ量に数えない（隠れの下に同じ色が続いていても動かない）。この決まりは全部が分かっているソルバーでも同じに働く（決定的）。
- **そろう（栓）**：注いだ後、相手の瓶が4段とも同じ色なら `sealed = true`。そろった瞬間に隠れも全部見えるようにする。栓をした瓶は、注ぐ元にも相手にもならない。
- **お客さん（注文）**：各色は**ちょうど4段**あり、各色に1つずつ注文がある（注文の数＝色の数）。注文は列 `queue` に並び、そのうち先頭の `ORDER_SLOTS = 2` 件が画面上のお客さん（`slots[0]`・`slots[1]`）として見えている。
- **届ける**：栓をした瓶の色が、見えているお客さんの注文と一致したら、その瓶はトレイに乗って**消える**。**空き瓶は出てこない**（ユーザー決定 2026-10-19。理由「空き瓶が増えると指数関数的に難易度が下がるため」）。瓶の本数は届けるたびに1本減り、残りの瓶は並び順のまま前に詰めて並べ直す。そのお客さんは喜んで帰り、同じ枠に `queue` の次のお客さんが来る（列が尽きたら空の枠）。
  - 以前の仕様（設計担当の独自追加）は「同じ場所に空の瓶が置かれる」だった。届けるほど空き瓶が増えて、面の後半が急にやさしくなっていた。
- **注文を待つ**：一致するお客さんがいなければ、栓をした瓶はその場で待つ。その色のお客さんが来たら**自動で**届く。
  - 待ち瓶は注ぐ元にも相手にもならず、届けても空きは増えないので、**注文の順番は「解けるかどうか」を変えない**（待ち瓶は見た目と「あと何人」の目標の役。BL6 が確かめる）。
- **処理の順（決定的）**：注ぐ → 相手がそろえば栓 → 届けられるものを届ける。届けた後に来たお客さんに合う待ち瓶があれば、また届ける（連鎖）。同時に候補があるときは、**枠は左（0）から、瓶は番号の小さい方から**。連鎖の間は瓶を詰めない（番号は注ぐ前の並びのまま）。連鎖が終わってから、届けた瓶をまとめて取り除いて詰める。
- **面クリア**：全部の注文に応えた（`served === total`）。
- **詰み**：動かせる手が1つも無く、クリアでもない。そのことを伝え、「1手もどす」「やりなおし」を案内する（ゲームオーバーにはしない）。
- **詰み予備軍（doomed）**：手は残っているが、もう全部は届けられない。注ぎ終わって落ち着いたとき（と、1手もどした後・途中から再開したとき）に `solve(state, { nodeLimit: 3000 })` を1回流し、`solved:false` かつ `exhausted:false`（言い切れた）ときだけ、ヒント「この ままだと ぜんぶは とどけられないよ。「1手もどす」を おしてみてね」とお助けの `data-attention="1"` を出す。phase は idle／selected のまま（新しい phase は作らない）。上限に届いたときは何も言わない。setState の局面は調べない。
- **お助け（無料・回数制限なし）**：1手もどす（何回でも、面の最初まで）、やりなおし（面の最初から。確認カードあり）。

### 1.2 瓶の番号（位置と id）

届けた瓶が消えて詰めるので、「何番目の瓶か」は届けるたびに変わる。食い違いを防ぐため、番号を2種類に分ける。

| 番号 | 意味 | 使う所 |
|---|---|---|
| 位置（index） | 今の並びの何番目か（0〜）。届けると後ろの瓶は1つ前にずれる | `applyMove(state, from, to)`・`pourCheck`・`legalMoves`・`solve` の手・`info.solution`・`IrobinGame.pick/pour/solution`・`.bottle[data-index]`・数字キー（見えている並びの何本目か）・`aria-label` の「Nばん」 |
| id | 瓶の固定の番号。面の最初の並び順（0〜）。詰めても変わらない | `state.bottles[i].id`・`.bottle[data-id]`・保存の手 `[fromId, toId]`（`makeSave` の v:2）・`replay`・`info.solutionIds`・`moveById`・演出で瓶を探すとき |

- `applyMove` の outcome の位置（`from`・`to`・`sealed`・`revealed[].bottle`・`deliveries[].bottle`）は、すべて**注ぐ前の並び**の位置（＝演出の間、画面に並んでいるボタンの位置）。`outcome.fromId`・`toId`・`deliveries[].id` は id。
- 画面（render）は、ボタンと瓶を id で結びつける。届けの演出は id で瓶を探し、トレイへ飛んで消えたら、そのボタンを取り除いて残りを詰め、`data-index` と `aria-label` の番号を振り直す。
- 入力（input）は、押したボタンの `data-index` と `data-id` の両方を渡す。main は、演出中に押されたら演出を終わらせた後の state で id から位置を引き直す（消えた瓶なら何もしない）。飛んでいる瓶（`data-gone="1"`）は数字キーで数えず、押せない。
- 保存は id で記録する。古い保存 `v:1`（位置の手・前のルール）は、手を捨ててその面の最初から始める。

## 2. ファイル構成と担当（衝突しないよう、編集してよいファイルを限定）

| 担当 | 編集してよいファイル | 中身 |
|---|---|---|
| A ロジック | `games/irobin/logic.js` | 状態・注ぐ規則・そろい判定・注文の列・面の難しさの表・生成とソルバー・保存データの検証（純粋な計算だけ） |
| B 画面 | `games/irobin/index.html`・`render.js`・`input.js`・`main.js` | DOM と CSS、描画と演出（動物・瓶・光・粒）、タップとキーボード、つなぎ込み・保存・画面遷移・テスト用 API |
| C 組み込み | ルートの `index.html`（`GAMES`・`ART`・ベスト表示の関数の追加のみ）、`sw.js`、`common/version.js`、`common/sfx.js`（追記のみ）、`tests/`（`cases/irobin-logic.mjs`・`cases/irobin-ui.mjs` の新規、`run.mjs` の `GROUPS` 追記、`mutants/mutate.mjs` の MB 追記、`design.md`・`README.md` の追記、既存テストの「ゲーム一覧」に関わる最小限の直し） | メニューのカードと絵、事前キャッシュと版、効果音の表、テスト |

- 上の表にないファイル（`CLAUDE.md`・`docs/` のほかのファイル・ほかのゲーム）は、どの担当も編集しない。この契約書を変えたいときは PM に言う（勝手に書き換えない）。
- 画面担当の中での分け方：render.js は**描画と演出だけ**（状態を変えない）、input.js は**入力だけ**（ルールを知らない）、main.js が両者と logic.js をつなぐ。
- 読み込み順（B が index.html に書く）：`../../common/sfx.js` → `logic.js` → `render.js` → `input.js` → `main.js`
- ファイルは **LF・UTF-8**（`.gitattributes` が LF に固定している）。
- **並列のための約束（W-06）**：3人は最初から同時に作る。相手の部品がまだ空でも、この契約書だけを見て作る。ロジック担当は Node で、画面担当は logic.js が未完成の間は自分で用意した小さな仮の状態で確かめてよい（仮のコードはコミットしない）。

## 3. 定数・色・面の表（logic.js が公開し、全員が使う）

| 名前 | 値 | 意味 |
|---|---|---|
| `NAME` | `"いろびん"` | 表示名（仮名。ここだけ変えれば画面の名前が変わる） |
| `CAP` | 4 | 1本の段数 |
| `ORDER_SLOTS` | 2 | 画面に見えるお客さんの数 |
| `MAX_COLORS` | 9 | 色の最大数（瓶は最大 9+2=11 本） |
| `MAX_MOVES_SAVED` | 2000 | 保存する手の数の上限（超えた保存は壊れた扱い） |
| `SOLVE_NODE_LIMIT` | 40000 | ソルバー1回で調べる局面の上限 |
| `GEN_NODE_BUDGET` | 100000 | 1面の生成で調べる局面の合計の上限（超えたら易しい側へ）。IB-12：v39 で 200000 から。表どおりの段は 75,000 まで（`RESERVE_FALLBACK1` 20000・`RESERVE_FALLBACK2` 5000 を残す）。§20.3 |
| `GEN_TRIES` | 40 | 1つの難しさで配り直す回数の上限 |
| `SAVE_KEY_BEST` | `"irobin.best"` | クリアした一番大きい面の番号 |
| `SAVE_KEY_SAVE` | `"irobin.save"` | 今の面と途中経過 |
| `SAVE_KEY_HELP` | `"irobin.help"` | 遊び方を見たら `"1"` |

**時間ではなく「調べた局面の数」で上限を決める**理由：同じ面番号からは、どの端末でも必ず同じ問題ができる（保存した手を再生できる）。目安として iPhone SE 相当で 1 面の生成が 300ms 以内（テスト BL5 が Node で全 60 面の合計 3 秒以内を確かめる）。

### 3.1 色（`COLORS`、id は配列の番号 0〜8）

色だけに頼らない：各色に**記号**を付け、render が段ごとに描く。Okabe-Ito を土台に、暗い背景で見分けやすい9色。

| id | key | 名前（aria・ヒント用） | hex | 記号 `mark` |
|---|---|---|---|---|
| 0 | `orange` | オレンジ | `#E69F00` | `circle`（●） |
| 1 | `sky` | みずいろ | `#56B4E9` | `triangle`（▲） |
| 2 | `green` | みどり | `#009E73` | `square`（■） |
| 3 | `yellow` | きいろ | `#F0E442` | `diamond`（◆） |
| 4 | `blue` | あお | `#0072B2` | `star`（★） |
| 5 | `red` | あか | `#D55E00` | `cross`（✚） |
| 6 | `pink` | ピンク | `#CC79A7` | `heart`（♥） |
| 7 | `white` | しろ | `#EEEEEE` | `ring`（○） |
| 8 | `brown` | ちゃいろ | `#9A6A3A` | `wave`（〰） |

`COLORS = [{ id, key, name, hex, mark }, ...]`（凍結）。記号は文字のフォントに頼らず、render が図形として描く（SVG か canvas）。記号の色は、段の色との明るさの差が分かる濃い色または白（ふち付き）。

### 3.2 面の難しさの表（`LEVELS`・`paramsFor(level)`）

| 面 | 色の数 `colors` | 空き瓶 `empties` | 隠れ `hidden` | 注文の順 `order` | ねらい |
|---|---|---|---|---|---|
| 1 | 2 | 2 | なし | `easy` | 遊び方を覚える（瓶 4 本。どの最初の手でも解けなくならない） |
| 2 | 3 | 2 | なし | `easy` | |
| 3 | 4 | 2 | なし | `easy` | |
| 4–5 | 5 | 2 | なし | `easy` | |
| 6–9 | 6 | 2 | なし | `random` | 待ち瓶（まだ来ていないお客さんの色）が出始める |
| 10–14 | 7 | 2 | 12・14 面だけ | `random` | 隠れた色の登場 |
| 15–24 | 8 | 2 | 奇数面 | `random` | |
| 25–39 | 9 | 2 | 奇数面 | `random` | |
| 40– | 9 | 2 | 全部 | `random` | 上限（以後ずっと同じ難しさ） |

（v37：41 面から新しい仕掛け 3 つを足して、面が進むほど難しくする。§19 が優先）
（v41：布の瓶を 5 面から出す（5 面＝中身あり cover 1、6・7 面＝空き瓶の布）。表の色の数・空き瓶・隠れ・注文の順は変えていない。§17.2・§21 が優先）

- `LEVELS` は上の表を `[{ from, colors, empties, hidden: 'none'|'odd'|'all'|[12,14], order }]` の形で持つ（形は A が決めてよい。公開するのは `paramsFor`）。
- `paramsFor(level) → { colors, empties, hidden: boolean, order: 'easy'|'random' }`。level は 1 以上の安全な整数に丸める（壊れた値は 1）。
- `order: 'easy'`：注文の列を「注文を気にせず解いたときに、そろう順」にする（下の §4 generate）。そのとおりに解けば待ちが一度も起きない＝やさしい。
- `order: 'random'`：注文の列を乱数で並べ、その列のままで解けることをソルバーで確かめる（届けても空き瓶が増えないので、注文の順は解けるかどうかを変えない。待ち瓶が出るかどうかだけが変わる）。

**表の見直し（2026-10-19、届けた瓶は消えるルールに変えたとき）**：変えたのは **1 面の空き瓶 1 → 2 本だけ**。理由と測った値（Node、1〜2000 面を生成。ゆるい遊び方＝「同じ色の上へ注ぐ手を 8 割で選び、ほかは乱数」で各面 15〜40 回遊んだクリアの割合）：

| 面（色・空き） | 前のルール | 新しいルール | 見たこと |
|---|---|---|---|
| 1（2色・空き1） | 48% | 48% | 最初の2手のうち1手で解けなくなる（前のルールでも同じ）。チュートリアルなので空き2本に → 100% |
| 2〜5（3〜5色・空き2） | 98〜100% | 100% | やさしいまま |
| 6〜9（6色） | 68% | 79% | 変わらない〜少しやさしい（待ち瓶が場所をふさがなくなった） |
| 10〜14（7色） | 57% | 66% | 同上 |
| 15〜24（8色） | 37% | 25% | 少し難しい |
| 25〜（9色） | 25〜31% | 21〜23% | 少し難しい |

- 解けなくなるのは平均 8〜12 手目（面の前半）で、前のルールで空き瓶が増えていたのは面の後半なので、差は面の後半の「やさしすぎ」が消えた分に出る。序盤〜中盤（1〜14 面）は前と同じかやさしいので、空き瓶・色の数は変えない。
- 8・9 色の面を空き瓶 3 本にすると、同じ遊び方で 97〜98% クリアになり、やさしすぎる（瓶も 11〜12 本になる）。手は残っているのに解けない局面は、詰み予備軍の案内（IB-02）が知らせる。
- 生成（1〜2000 面）：全部ソルバーで解けることを確かめた面（fallback 0 が 2000 面）。生成で調べた局面は最大 7481（1529 面）、1 面の生成は最大 22ms（Node。2000 面の生成と解の再生の合計 4.2 秒）。
- 使う色：`colors` 色を `COLORS` から乱数で選ぶ（面ごとに違う色の組み合わせ）。

## 4. ロジックの API（`games/irobin/logic.js`、担当A）

UMD で `window.IrobinLogic` と Node の `module.exports`（と `globalThis.IrobinLogic`）の両方を公開する（ハシわたりの logic.js に準じる）。DOM・時計（`Date`・`performance`）・`Math.random`・localStorage には**さわらない**（乱数は面番号から作る種で決まる）。

### 4.1 状態の形（イミュータブル。毎回新しいオブジェクトと新しい配列を返し、元を変えない。凍結してよい）

```js
state = {
  level: 7,                        // 面の番号（1〜）
  params: { colors, empties, hidden, order },
  bottles: [                       // 届けた瓶は消える：本数は届けるたびに 1 本減る（残りは並び順のまま前に詰める）
    { id: 3,                       // 瓶の固定の番号（面の最初の並び順 0〜）。詰めても変わらない（§1.2）
      cells: [2, 2, 5, 1],         // 色 id。下→上。長さ 0〜CAP
      hidden: [true, true, false, false], // cells と同じ長さ。true＝「？」で見えない。一番上は必ず false
      sealed: false }              // 栓をした（4段同じ色）。sealed のとき hidden は全部 false
  ],
  slots: [3, 0],                   // 見えているお客さんの注文（色 id）。いない枠は null。長さ ORDER_SLOTS
  queue: [6, 1, 4],                // まだ来ていない注文（先頭から順に来る）
  served: 2,                       // 届けた数
  total: 7,                        // 注文の総数（= 色の数）
  moves: 12,                       // この面で注いだ回数（1手もどすと減る）
  won: false
}
```

### 4.2 関数

```js
IrobinLogic = {
  NAME, CAP, ORDER_SLOTS, MAX_COLORS, MAX_MOVES_SAVED, SOLVE_NODE_LIMIT, GEN_NODE_BUDGET, GEN_TRIES,
  SAVE_KEY_BEST, SAVE_KEY_SAVE, SAVE_KEY_HELP, COLORS, LEVELS,

  // ---- 乱数と面 ----
  makeRng(seed) → () => number           // 再現できる乱数（mulberry32）。0 以上 1 未満
  seedFor(level) → number                 // 面番号 → 32bit の種（同じ面は必ず同じ種）
  paramsFor(level) → params               // §3.2
  createLevel(level, opts?) → { state, info }
  //   決定的：同じ level からは必ず同じ state（JSON で一致）
  //   info = { level, seed, params, tries, nodes, fallback: 0|1|2, solution: [[from,to],...], solutionIds: [[fromId,toId],...] }
  //     fallback 0＝表のとおり、1＝易しい側（空き瓶 +1・order 'easy'。瓶が MAX_BOTTLES=11 を超えるときは空き瓶を増やさず色を1つ減らす）、2＝固定の予備の面
  //     solution＝この state から解ける手順（位置の手。テストと、将来のヒント用。画面には出さない）
  //     solutionIds＝同じ手順を瓶の id で書いたもの（保存の形。replay にそのまま渡せる）
  //   作り方：
  //     1) 選んだ色を各4段ずつ混ぜ、色の数ぶんの瓶に4段ずつ配る。空き瓶を後ろに足す。
  //        4段同じ色の瓶ができた配り方は捨てる（最初からそろっている瓶は無し）。
  //        hidden の面は、各瓶の一番上以外を hidden にする。
  //     2) order 'easy'：solve(state, { anyOrder: true }) で解き、そろった色の順を queue にする。
  //        order 'random'：queue を乱数で並べ、solve(state) で解けるか確かめる。
  //     3) 解けなければ配り直す（GEN_TRIES 回まで）。合計の局面数が GEN_NODE_BUDGET を超えたら fallback 1、
  //        それでもだめなら fallback 2（logic.js の中に書いた、必ず解ける固定の面）。fallback 2 も verify を通す。通らなければ例外（IB-11）。
  //     4) 最後に、画面と同じ applyMove で solution を再生し、won になることを確かめてから返す。
  //   瓶の並び順も乱数で混ぜてよい（空き瓶が必ず右端、にしない）。

  // ---- 手 ----
  pourCheck(state, from, to) → { ok: true, count } | { ok: false, reason }
  //   reason: 'won'（クリア後）| 'range'（番号が範囲外・整数でない）| 'same'（同じ瓶）| 'empty'（元が空）
  //         | 'sealed'（元か相手が栓をしている）| 'full'（相手に空きが無い）| 'mismatch'（色が違う）
  //   判定の順は上の並びのとおり（テストが reason まで確かめる）
  applyMove(state, from, to) → { state: newState, outcome }
  //   outcome（注げないとき）：{ kind: 'invalid', reason, from, to }   ← state はそのまま（同じオブジェクトを返してよい）
  //   outcome（注いだとき）：
  //   { kind: 'pour', from, to, fromId, toId, color, count,   // 位置はすべて注ぐ前の並び（§1.2）。fromId・toId は瓶の id
  //     revealed: [{ bottle, index, color }],      // 新しく見えた段（元の瓶の新しい一番上。そろって全部見えた段も含む）
  //     sealed: number|null,                       // そろった瓶の位置（無ければ null）
  //     deliveries: [{ bottle, id, slot, color }], // 届けた順（連鎖を含む）。bottle＝注ぐ前の位置、id＝瓶の id。届けた瓶は新しい state には無い
  //     arrivals: [{ slot, color|null }],          // 来たお客さん（届けるたびに1件。列が尽きたら color null）
  //     won: boolean, stuck: boolean }             // stuck＝注いだ後に動かせる手が無く、won でない
  //   arrivals と deliveries は、起きた順に交互に並ぶ。render はこの順に演出する（§7.3）
  legalMoves(state) → [[from, to], ...]   // 注げる手のすべて（from の小さい順、同じ from は to の小さい順）
  isStuck(state) → boolean                // legalMoves が空で、won でない
  indexOfId(state, id) → number           // 瓶の id → 今の位置（無ければ -1）
  moveById(state, fromId, toId) → { state, outcome }   // id で指定した applyMove。id が無ければ invalid（reason 'range'）
  toIdMoves(state, moves) → [[fromId,toId],...]|null    // 位置の手の列を、state から順に当てながら id の列に直す

  // ---- ソルバー（全部の情報を知っている前提でよい） ----
  solve(state, { nodeLimit = SOLVE_NODE_LIMIT, anyOrder = false } = {})
    → { solved: boolean, moves: [[from,to],...]|null, nodes: number, exhausted: boolean }
  //   applyMove と同じ決まりで探す（注文の順・待ち瓶がその場に残ること・届けると瓶が消えて詰めることを含む）。手は位置で返す。
  //   anyOrder: true のときだけ、そろった瓶をすぐ届けたものとして消す（generate の 'easy' 用。手の位置は実際の遊びとずれる）。
  //   局面のキーには栓をした瓶を入れない（注ぐ元にも相手にもならず、届けても空きが増えないので、先の手が同じ）。
  //   exhausted＝上限に達して打ち切った（solved:false でも「解けない」とは限らない）。
  //   同じ局面を二度調べない（瓶の並びは順不同として正規化したキーで記録してよい）。
  //   むだな手を省いてよい：中身が全部見えていて1色だけの瓶を、空の瓶へまるごと移す手。

  // ---- 再生と保存 ----
  replay(level, moves) → { state, ok: boolean, applied: number }
  //   moves は保存の形（瓶の id の組 [fromId, toId]）。createLevel(level).state に moveById で順に当てる。注げない手（無い id を含む）が出たらそこで止めて ok:false
  //   （applied＝当てられた数。state はそこまでの状態）
  hud(state) → { level, served, total, left, moves }   // left = total - served。画面に出す数（UI で ±1 しない）
  validateBest(raw) → number
  //   Number(raw) が Number.isSafeInteger で 0 以上ならその値。それ以外（null・""・NaN・負・小数・Infinity・object）は 0
  validateSave(raw) → { level, moves } | null
  //   raw は localStorage の文字列。JSON.parse に失敗・形が違う・v が 2 でない・level が 1 以上の安全な整数でない・
  //   moves が配列でない／長さが MAX_MOVES_SAVED を超える／各要素が [整数, 整数] でない → null
  //   古い v:1（位置の手・届けると空き瓶が出てきた前のルール）は、level が正しければ { level, moves: [] }（手を捨てて面の最初から）
  //   （手が今の面で注げるかは validateSave では見ない。main が replay で確かめ、ok:false なら面の最初から）
  makeSave(level, moves) → string         // JSON.stringify({ v: 3, level, moves })。moves は瓶の id の組。最初の MAX_MOVES_SAVED（2000）手までしか書かない（IB-09。それより後は書かない）
  recordBest(prevBest, clearedLevel) → { best, improved }
  //   best = max(validateBest(prevBest), clearedLevel)。improved は clearedLevel > validateBest(prevBest) のときだけ true
  validateFlag(raw) → boolean             // '1' のときだけ true

  // ---- 見た目に使う純粋な値 ----
  animalFor(level, orderIndex, otherIndex?) → string   // お客さんの動物の種類（§7.2 の ANIMALS の key）。面と注文の番号で決まる。otherIndex（省略可）＝いっしょに見えている もう1人の注文の番号。先に来た方（番号が小さい方）はそのまま、あとの方が同じなら perm の次の動物（v39、IB-08。§20.2）
  colorName(id) → string                  // 'オレンジ' など。範囲外は '？'
}
```

- `applyMove`・`createLevel` などは引数の state を変えない（イミュータブル。テスト BL4）。
- 例外を外に出さない：おかしな引数（null の state、文字列の番号など）でも `invalid` か `null` を返す。

## 5. 入力の API（`games/irobin/input.js`、担当B）

UMD で `window.IrobinInput` と `module.exports`。ルール（注げるか）は知らない。

```js
IrobinInput.attach({ board, root = document }, {
  onPick(index, via, id), // 瓶が選ばれた。via: 'tap'|'key'。index＝data-index（位置）、id＝data-id（瓶の id。§1.2）
  onCommand(cmd)          // 'undo'|'restart'|'deselect'|'sound'|'help'|'close'
}, { isBlocked = () => false }) → { detach(), focusBottle(index) }
```

- **タップ**：`#board` の `.bottle`（`<button>`）の `click` で `onPick(Number(data-index), 'tap', Number(data-id))`。届けの演出で飛んでいる瓶（`data-gone="1"`）は押しても何もしない。`pointerdown` で選ぶと指がずれた押下まで拾うので、`click` を使う（`touch-action: manipulation` で遅れは出ない）。
- **ダブルタップ拡大の抑止**：`#board` と `.tools` で `touchend`（2回目の素早いタップ）・`dblclick` を `preventDefault`。`gesturestart` も止める。既存ゲームの作り（ゼンマイ・ハシわたり）に準じる。
- **キーボード**（`document` の `keydown`。入力欄・カードが開いているとき〈`#overlay` が見えている〉は Esc 以外を無視）：
  - `←` `→`：フォーカスを左右の瓶へ（端で止まる）。`↑` `↓`：上下の段の瓶へ（render の並びの列数を `board.dataset.cols` から読む）
  - `Enter`・`Space`：フォーカスのある瓶を選ぶ（`<button>` の標準の click に任せ、二重にしない）
  - `1`〜`9`・`0`：その番号の瓶を選ぶ（`0` は10本目、11本目は `-`。IB-10）。番号は、いま並んでいる瓶（`data-gone` を除く）の何本目か
  - `U` または `Backspace`：`onCommand('undo')`。`R`：`onCommand('restart')`（確認カードが出る）
  - `Esc`：選んでいれば `onCommand('deselect')`、カードが開いていれば `onCommand('close')`
  - `M`：`onCommand('sound')`。`?`（`/`）：`onCommand('help')`
- `isBlocked()` が true の間（カード表示直後のロックなど）は onPick を呼ばない。
- 例外は外へ出さない（`safe()` で包む）。`detach` で付けたリスナーをすべて外す。

## 6. DOM 契約（担当 B が作り、C のテストが使う）

```html
<div class="app">
  <header class="head">
    <a id="back" class="back" href="../../">← メニュー</a>
    <h1 class="title" id="gameTitle">いろびん</h1>
    <span class="level" id="levelBox"><b id="level">1</b><span class="unit">めん</span></span>
    <div class="head-tools">
      <button class="tool" id="helpBtn" type="button" aria-label="あそびかた">？</button>
      <button class="tool" id="soundBtn" type="button" aria-label="効果音" aria-pressed="true">♪</button>
    </div>
  </header>

  <section class="play" id="playView" aria-label="プレイ" data-phase="idle">
    <div class="shop" id="shop" aria-label="おきゃくさん">
      <div class="customer" id="cust0" data-slot="0" data-color="" data-mood="wait">
        <canvas class="animal" aria-hidden="true"></canvas>
        <div class="tray" aria-hidden="true"></div>
        <span class="sr" id="cust0Text"></span>          <!-- 「オレンジの びんが ほしい くま」など（読み上げ用） -->
      </div>
      <div class="customer" id="cust1" data-slot="1" data-color="" data-mood="wait"> …同じ… </div>
      <p class="queue" id="queueBox">あと <b id="left">0</b> にん</p>
    </div>
    <div class="board" id="board" role="group" aria-label="びん" data-cols="6">
      <!-- render.build が作る -->
      <button class="bottle" type="button" data-index="0" data-id="0" data-sealed="0" data-selected="0" data-waiting="0"
              aria-label="1ばん：した から あお、あお、？、オレンジ">
        <span class="glass">
          <span class="seg" data-color="4" data-hidden="0"><svg class="mark">…</svg></span>
          …（段は下から上の順。空の段は作らない）
        </span>
        <span class="cork"></span>
      </button>
    </div>
    <canvas class="fx" id="fx" aria-hidden="true"></canvas>
    <p class="hint" id="hint" role="status" aria-live="polite"></p>
    <div class="tools" id="tools">
      <button class="cta" id="undoBtn" type="button" data-cmd="undo">1手もどす</button>
      <button class="cta" id="restartBtn" type="button" data-cmd="restart">やりなおし</button>
    </div>
  </section>
</div>

<div class="overlay" id="overlay" hidden>
  <div class="card" id="card" role="dialog" aria-modal="true" aria-labelledby="cardTitle"><!-- 中身は main.js が作る。見出しに id="cardTitle" --></div>
</div>
```

| セレクタ | 用途 |
|---|---|
| `a#back` | メニューへ戻る。どの画面・どのカードからも見えて押せる（オーバーレイより手前） |
| `#helpBtn`・`#soundBtn` | 右上の？と♪（44×44 以上） |
| `#level` | 面の番号（`hud(state).level`） |
| `#playView[data-phase]` | `idle`（選んでいない）・`selected`（1本選んでいる）・`pouring`（注ぐ演出中）・`stuck`（詰み）・`clear`（クリアのカード）・`paused`（裏に回っている） |
| `#cust0`・`#cust1` | お客さん。`data-color`＝注文の色 id（いなければ `""`）、`data-mood`＝`wait`・`happy`・`enter`・`leave`・`empty` |
| `.customer .tray` | 注文の色のトレイ。色と記号を描く（色だけに頼らない） |
| `#left` | まだ応えていない注文の数（`hud(state).left` ＝ `total - served`。いま並んでいるお客さんも含む）。0 のときも「あと 0 にん」 |
| `#board[data-cols]` | 1行の瓶の数（キーボードの上下移動に使う） |
| `.bottle[data-index][data-id][data-sealed][data-selected][data-waiting]` | 瓶。`data-index`＝今の並びの位置（届けると振り直す）、`data-id`＝瓶の id（変わらない）。`data-waiting="1"`＝栓をして注文を待っている。届けの演出で飛んでいる間は `data-gone="1"`。`aria-label` に番号（位置＋1）・中身（隠れは「？」）・状態 |
| `.seg[data-color][data-hidden]` | 段。隠れの段は `data-color` を出さない（`data-color=""`・`data-hidden="1"`）で「？」を描く（DOM から答えが分からないように） |
| `.cork` | 栓（sealed のときだけ見える） |
| `canvas#fx` | 光と粒（ポインターを通す。`pointer-events: none`） |
| `#hint` | 1行の案内。2行分の高さに固定し、文言が変わっても配置が動かない |
| `#undoBtn`・`#restartBtn` | お助け。最初の状態では「1手もどす」は `disabled`。詰み・詰み予備軍のとき、押して意味のあるほうに `data-attention="1"`（目立たせる。disabled の「1手もどす」と手が0の「やりなおし」には付けない）。「やりなおし」は手が0なら `disabled`（IB-13） |
| `#overlay`・`#card` | 遊び方・面クリア・やりなおしの確認のカード |
| `.overlay [data-cmd="next"/"menu"/"close"/"restartYes"]` | つぎの めんへ・メニューへ・とじる・やりなおす |

**CSS の約束**（B）：
- 既存のトークン（`--bg #1b1f2e`・`--panel`・`--well`・`--line`・`--ink`・`--muted #9aa1b8`・`--accent`）とフォント、safe-area、ダブルタップ抑止の作りはハシわたりに準じる。`[hidden] { display: none !important; }`
- 瓶のボタンは**幅 44px 以上・高さ 44px 以上**（瓶の見た目は縦長、押せる矩形も同じ）。文字は 12px 以上（V11）、本文 16px 以上。ひらがな中心。
- `#level` は 16 桁（9007199254740991）でもはみ出さない（字を縮める。「…」で省略しない）。
- 面の番号の字の大きさ：4 桁まで s（20px）・5 桁 m（16px）・6〜8 桁 t（1 段のまま、番号と「めん」を 12px にしてすき間を詰める）・9 桁から l（14px、縦では番号を下の段に回す）（v35、IB-30、ユーザー「字を小さくする」、BW21）。
- **配置**：縦向きは上から `.head`・`#shop`・`#board`・`#hint`・`#tools`。**横向き**（`(orientation: landscape) and (max-height: 500px)`）は、`#shop`・`#hint`・`#tools` を左の縦列、`#board` を右。`.head`・`#shop`・`#board`・`#hint`・`#tools` の矩形は、iPhone SE（320×568・568×320）から iPad まで、どの向きでも重ならず画面からはみ出さない（11本の面でも）。
- `prefers-reduced-motion: reduce` で CSS のアニメーションを止める（render も §7.4 で従う）。

## 7. 描画と演出の API（`games/irobin/render.js`、担当B）

UMD で `window.IrobinRender`。状態は変えない（受け取った state を見て描くだけ）。DOM は `#board` の中身・`#shop` の中（canvas・トレイ・`data-*`・`.sr` の文）・`canvas#fx` だけをさわる。

```js
IrobinRender.create({ board, shop, fx }, { calm = false } = {}) → {
  build(state),                 // 面の始めに瓶のボタンを作り直す（本数が変わる）。layout も行う。ボタンは瓶の id と結びつける
  layout(),                     // 画面の大きさに合わせて列数と瓶の大きさを決め、board.dataset.cols を書く
  update(state, ui),            // 演出なしで今の状態に合わせる。ui = { selected: number|null }（state の位置）。ボタンの id の並びが state と違えば作り直す
  pour(outcome, state) → Promise,  // §7.3 の順で演出し、終わったら resolve（最後に update(state) 済み）
  deny(index, reason),          // 注げない：相手の瓶を小さく横に揺らす（0.25 秒）
  celebrate() → Promise,        // 面クリアの演出（お客さん全員が喜ぶ、紙ふぶき）
  finishAll(),                  // 動いている演出を一瞬で終わりまで進める（待っている Promise もすぐ resolve）
  pause(), resume(),            // 裏に回ったとき止める／戻す（Web Animations の pause/play と rAF の停止）
  setCalm(bool),                // 動きを減らす
  get busy()                    // 演出中なら true
}
IrobinRender.ANIMALS = [ 'kuma', 'usagi', 'neko', 'penguin', 'risu', 'hitsuji' ]   // 描ける動物（§7.2）
IrobinRender.drawAnimal(ctx, kind, { w, h, mood, t })   // メニューの絵でも使える純粋な描画関数
```

### 7.1 瓶
- 透明なガラスの瓶（角の丸い縦長、首が細い）。中の液は段ごとに色の矩形、境目はくっきり。各段の真ん中に色の記号（§3.1）。
- 隠れの段は暗い灰色に白い「？」。見えるようになるとき、「？」がふわっと消えて色が出る（0.25 秒、音 `reveal`）。
- 選んだ瓶は少し持ち上がる（12px 程度）＋ふちが明るくなる（`data-selected="1"`）。
- 栓は木の色の小さな丸栓。`data-waiting="1"` の瓶には、待っている色の小さな札（トレイと同じ記号）を栓の上に出す。

### 7.2 お客さん（動物）
- `ANIMALS` の6種を**プログラムで描く**（丸い頭・耳の形・模様の違いで見分けられる、やさしい線の絵。既存の有名キャラクターに似せない）。
- 各お客さんは注文の色のトレイを両手で持つ。トレイには色と記号。
- `mood`：`enter`（下からぴょこっと出てくる 0.35 秒）・`wait`（ゆっくりまばたき。calm のときは止める。4 秒ごとに 0.15 秒目を閉じる。止まっている間に描くのはその間だけ。pause（裏・遊び方・確認）の間もしない。IB-16、ユーザー「足す」、BW24）・`happy`（目を細めて跳ねる＋ハート 0.6 秒）・`leave`（手を振って下へ 0.3 秒）・`empty`（誰もいない。うすい点線の枠）。

### 7.3 注ぐ演出の順（`pour` が行う。ここが一番作り込むところ）

1. **持ち上げて移動**（0.18 秒）：元の瓶が相手の瓶の斜め上へ移る。
2. **傾けて注ぐ**（0.30 秒＋1段 0.06 秒）：元の瓶が相手の側へ約 70° 傾き、細い液の筋が落ちる。相手の液面が上がり、元の液面が下がる。音 `pour(count)`。
3. **戻る**（0.18 秒）：元の場所へ戻り、まっすぐに。見えるようになった段があれば `reveal`。
4. **そろった（`outcome.sealed !== null`）＝一番気持ちいい瞬間**：
   - 液がきらっと一度光る（白いハイライトが下から上へ走る 0.25 秒）
   - 瓶のまわりに、その色の柔らかい光の輪が広がって消える（0.6 秒）
   - 栓が上から落ちて「ぽん」と弾む（0.3 秒、音 `cork`）
   - `#fx` に、その色と白の粒が 16〜24 個、瓶の口から噴き出して落ちる（0.8 秒）
   - 音 `seal`（明るい和音）。`navigator.vibrate` があれば `sfx.buzz(15)` 程度（無ければ何もしない）
   - そろった光と粒は**次の操作で消さない**（finishAll でも粒だけは最後まで描いてよい。Promise はすぐ resolve）
5. **届ける**（`deliveries` の順。1件 0.6 秒）：瓶（id で探す）がお客さんのトレイの上へ飛び、小さくなって消える（音 `deliver`）。お客さんは `happy` → `leave`。**空の瓶は出てこない**：消えたボタンを取り除き、残りの瓶を詰めて並べ直す（列数と大きさも本数に合わせて決め直す）。残りの瓶は前の場所から新しい場所へ 0.3 秒でなめらかに寄る。`calm` では一瞬で並べ直す。
6. **次のお客さん**（`arrivals`、0.35 秒）：`enter`（音 `arrive`）。待ち瓶への自動の届けは 5 に戻る。
7. 最後に `update(state)` で表示を正にそろえる。

### 7.4 動きを減らす・裏に回す・性能
- `calm`（`prefers-reduced-motion: reduce`、main が渡す）：移動・傾き・揺れ・粒・跳ねをやめ、各段階を 0.05 秒以下の切り替えにする。光の輪は静かな縁取りを 0.3 秒だけ。音は鳴らす。
- `pause()` で Web Animations をすべて一時停止し、rAF を止める。`resume()` で続きから。
- devicePixelRatio は最大 2。粒は最大 48 個。動いていない間は rAF を回さない（iPhone SE 相当で重くしない）。例外：待っているお客さんのまばたき（IB-16）の間だけ描く。動きを減らす設定・pause の間はしない。

## 8. 進行（`games/irobin/main.js`、担当B）

### 8.1 状態の流れ
- 起動：`validateSave(localStorage['irobin.save'])` → `replay(level, moves)`（手は瓶の id）。ok でなければ同じ面の最初から（手は捨てる）。古い `v:1` も同じ面の最初から。保存の手を全部当てると won（クリアの記録の前に閉じた）なら、その面のクリアのカードから（ベストと保存を書く。IB-22）。保存が無い・壊れているなら、`level = validateBest(best) + 1`（なければ 1）の最初から。初回（`irobin.help` が無い）は遊び方カードを出す。
- `idle` で瓶を押す：注げる中身がある瓶なら `selected`（音 `pick`）。空・栓の瓶はヒントだけ（「からの びんは えらべないよ」「せんを した びんは うごかせないよ」）。
- `selected` で：同じ瓶 → 選ぶのをやめる（音 `drop`、`idle`）。別の瓶 → `applyMove`：
  - `invalid` → `render.deny`、音 `deny`、ヒント（`mismatch`＝「いろが ちがうよ」、`full`＝「いっぱいだよ」、`sealed`＝「せんを した びんには いれられないよ」）、選ぶのをやめる。
  - `pour` → 履歴に積み、保存し、`pouring` で `render.pour`。終わったら `won` なら `clear`、`stuck` なら `stuck`、それ以外は `idle`。
- **先に押せる**：`pouring` の間も瓶を選べる。新しく注ぐときは、前の演出を `render.finishAll()` で終わらせてから始める（速く遊ぶ人を待たせない）。
- `stuck`：ヒント「うごかせる びんが ないよ。『1手もどす』か『やりなおし』を おしてね」、お助けの2つに `data-attention="1"`。音 `stuck`（やさしく、責めない）。
- `clear`：`celebrate()` の後にカード。見出し「N めん クリア！」、本文「M て で とどけたよ」（ベスト更新なら「はじめて クリア！」）。ボタン1つ目「つぎの めんへ」（`data-cmd="next"`、フォーカスもここ）、2つ目「メニューへ」。カードを出して 400ms はボタンを押せない。音 `clear`、更新なら共通の `best`。

### 8.2 お助け
- **1手もどす**：履歴の1つ前の state に戻す（回数制限なし。面の最初まで）。演出中なら `finishAll()` してから。選択は解除。音 `undo`。保存も1手減らす。
- **やりなおし**：手が1つ以上あれば確認カード（「さいしょから やりなおす？」［やりなおす `restartYes`］［やめる `close`］）。手が0なら押せない（`disabled`。IB-13）。

### 8.3 保存
- 注ぐたび・もどすたびに `irobin.save` へ `makeSave(level, moves)` を書く（手は `outcome.fromId`・`toId` の組）。クリアしたら `irobin.best` を `recordBest` で更新し、`irobin.save` を次の面・手0にする。
- 読み書きは `try/catch` で囲む（保存できなくても遊べる）。ほかのゲームのキーに触らない。
- `pagehide` でも保存する。

### 8.4 中断・タイマー（ハシわたりの教訓）
- タイマーは `later(fn, ms)` だけで作る（`setTimeout` を直接呼ばない。id を一覧に記録）。`clearLater()` は面を始めるとき・やりなおし・メニューへ・`pagehide` で呼ぶ。演出の順番は render の Promise で進め、タイマーで進めない。
- 面を始めるたびに `runId` を +1。Promise の続きは `runId` が一致するときだけ動く。
- `visibilitychange` で hidden：`render.pause()`、`data-phase="paused"`（前の phase を覚える）。visible：`render.resume()`、前の phase に戻す（パズルなので一時停止カードは出さない）。
- 遊び方カードを開いている間も、演出は `pause()` する。

### 8.5 キーボード・その他
- input.js の `onCommand`：`undo`・`restart`（確認カード）・`deselect`・`sound`（♪ と同じ）・`help`・`close`（Esc でカードを閉じる。クリアのカードは閉じない＝「つぎの めんへ」を選ぶ）。
- 起動時に `document.title` と `#gameTitle` を `IrobinLogic.NAME` にする。
- `prefers-reduced-motion` を見て `render.setCalm`（変わったら追従）。

### 8.6 テスト用の公開 API（B が作り、C が使う）

```js
window.IrobinGame = Object.freeze({
  getState(),   // { phase, level, best, served, total, left, moves, bottles, slots, queue, selected, stuck, doomed, par, won,
                //   overlay: null|'help'|'clear'|'confirm', busy, paused, timers, runId, canUndo, calm }
                //   bottles・slots・queue は logic の state の写し（JSON にできる形。bottles には id がある）
  pick(index),  // 瓶を押したのと同じ（onPick と同じ道を通る）。index は今の state の位置。戻り値なし
  pour(from, to),  // pick(from) → pick(to) と同じ。演出は finishAll で終わらせる。outcome.kind を返す
  solution(),   // 今の state から solve した手順 [[from,to],...]（解けなければ null）
  skip(),       // 今の演出を終わりまで進める（render.finishAll）
  setLevel(n),  // テスト用：n 面の最初から始める（保存も n 面・手0にする）
  setState(s)   // テスト用：詰みなどを作るため、logic の state の形をそのまま入れる（形がおかしければ false）
});
```

## 9. 効果音の契約（`common/sfx.js`、担当C）

`YubiSfx.create("irobin")` を使えるようにする。共通の `start`・`best`・`toggle`・`over`・`tap` に加えて：

```js
const IROBIN = {
  pick:    () => {},        // 瓶を持ち上げる「こっ」（ガラスの軽い音）
  drop:    () => {},        // 選ぶのをやめて置く「ことっ」（pick より低い）
  pour:    (count) => {},   // 注ぐ「とくとく」。count（1〜4）で長さが少し変わる
  reveal:  () => {},        // 隠れていた色が見える「ぽわん」
  seal:    (colorId) => {}, // そろった！明るい和音＋きらきら。一番気持ちいい音。colorId で根音を少し変えてよい
  cork:    () => {},        // 栓の「ぽん」
  deliver: () => {},        // お客さんに届ける「ちりん」
  arrive:  () => {},        // 次のお客さんが来る、軽い足音
  clear:   () => {},        // 面クリアの短いファンファーレ（1.2 秒以内）
  deny:    () => {},        // 注げない。小さく低い「こつ」（責めない）
  undo:    () => {},        // 1手もどす（逆回しの短い音）
  stuck:   () => {}         // 詰み。下がる2音（やさしく）
};
```

- `GAP` に `pour: 0.05`、`pick: 0.03`、`arrive: 0.08` を足す（`seal`・`cork`・`deliver`・`clear` には入れない）。既に `undo` があればそれを使う。
- 選択式に `game === "irobin" ? IROBIN` を足し、冒頭の使い方コメントにも1行足す。
- 既存の部品（mallet・wood・noise・bell・partial など）を使う。音が出せない環境でも画面だけで遊べること。

## 10. メニュー連携（担当C）

```js
{ name: "いろびん", desc: "いろみずを そろえて、どうぶつに とどけよう", url: "games/irobin/", bestText: () => irobinBest(), art: "irobin" }
```
- `irobinBest()`：`irobin.best` を `readBest` と同じ決まりで読み、1 以上なら `"${n} めん クリア"`、それ以外は `""`。
- `ART.irobin(ctx, w, h)`：色の違う液が入った小さな瓶3本（1本は栓つきで光っている）と、トレイを持った丸い動物の顔。既存の `ART` の手描き感に合わせる。

## 11. 版と事前キャッシュ（担当C）

- `common/version.js` を `{ version: "v20", date: "2026-10-19" }`、`sw.js` の `CACHE_VERSION` を `"v20"`（3つを一緒に。L10）。
- `APP_FILES` に `./games/irobin/`・`./games/irobin/index.html`・`logic.js`・`render.js`・`input.js`・`main.js` を追加（ファイルを増やしたら必ず足す）。

## 12. テスト契約（担当C）

### 12.1 グループ（`tests/run.mjs` の `GROUPS` に HW の後へ追記）
```js
{ key: 'BL', title: 'BL いろびん 計算ロジック(Node)', file: 'irobin-logic.mjs', weight: { smoke: 0, full: 0 } },
{ key: 'BW', title: 'BW いろびん 画面（遊べる・保存・戻る・画面内・横向き・中断・キーボード・音・色覚・オフライン）', file: 'irobin-ui.mjs', weight: { smoke: 8, full: 40 } },
```
- **テスト ID の接頭辞は `BL`（ロジック、Node）と `BW`（画面）**。既存の L・ZL・D・E・S・V・P・A・T・I・Z・ZU・PK・HL・HW・K などと衝突しない。
- 既存テストのうち「ゲームの一覧」を数えるもの（L の GAMES 検査、`GAME_URLS`・`GAME_COUNT` を使う D・V11 など）は、7 本 → 8 本で通ることを確かめ、必要なら最小限だけ直す。

### 12.2 BL（Node、`tests/cases/irobin-logic.mjs`）
- BL1：定数・`COLORS`（9色・hex と記号がすべて違う・`NAME`）・`paramsFor` が §3.2 の表どおり（境界 1・2・5・6・9・10・12・14・15・24・25・39・40・1000・壊れた値）。
- BL2：`pourCheck`・`applyMove` の決まり（空へ・同じ色へ・色違い・いっぱい・栓・同じ瓶・範囲外・クリア後、reason の順）。注ぐ量＝見えている同じ色の続き と 空き の小さい方。
- BL3：そろい・届け・**届けた瓶は消える（瓶が1本減り、空き瓶は増えない。残りは並び順のまま詰め、id は変わらない）**・待ち瓶・お客さんが来たら自動で届く（連鎖の順。連鎖の途中で位置がずれない）・全部届けて won。outcome の `deliveries`（bottle・id）・`arrivals` の順。
- BL4：イミュータブル（applyMove の前後で元の state が JSON で一致）。おかしな引数で例外を投げない。
- BL5：生成。1〜60 面と 1000 面が決定的（2回作って JSON 一致）、各色ちょうど4段、最初からそろった瓶なし、隠れの面は一番上以外が隠れ、最初の id が 0〜、`info.solutionIds` を replay すると won で空き瓶だけが残る。1 面はどの最初の手でも解ける。60 面の生成の合計が Node で 3 秒以内、`info.nodes <= GEN_NODE_BUDGET`。
- BL6：ソルバー。解けない小さな盤で solved:false、待ち瓶ができる盤で solve の手順を applyMove で再生すると won（手の位置がずれない）、注文の順を逆にしても `anyOrder` でも解けるかどうかは同じ。
- BL7：保存の検証。`validateBest`（`null`・`""`・`"abc"`・`"-1"`・`"1.5"`・`"NaN"`・`"Infinity"`・`"{}"`・`"1e400"`・`"9007199254740992"`）→ 0。`makeSave` は v:2。`validateSave` が壊れた JSON・v 違い・level 0・手の形違い・長すぎで null、古い v:1 は手を捨てる。`replay`（id の手）が注げない手・無い id で ok:false。`recordBest` で同じ面は improved:false。
- BL8：詰み（`isStuck`・outcome.stuck）。
- BL9：隠れ。注いで一番上になった1段だけが見えるようになる。隠れの段は注ぐ量に数えない。そろうと全部見える。
- BL12〜BL14：布の瓶（§17.6。BL12 ルール、BL13 1〜2000 面の生成、BL14 保存 v:3）。BL5・BL7・BL10 は §17 に合わせて直した（空き瓶の布で瓶が1本増える面、保存 v:3、音 unveil）。
- BL11：生成した面（2・6・12・20・40 面）の解を通して、届けるたびに瓶が届けた本数だけ減り、空き瓶は注いだ分しか変わらない。`fromId`・`toId`・`deliveries[].id` が正しく、残りの瓶は並び順のまま・中身も同じ id に付いていく。消えた id では注げない。途中で保存（v:2）→ `validateSave` → `replay` で同じ局面。

### 12.3 BW（画面、`tests/cases/irobin-ui.mjs`）
smoke：
- BW1：瓶を2本押して注ぐと、`.seg` の色の並びが `getState().bottles` と一致。`#level`・`#left` の文字が `hud` と一致。隠れの段は `data-color` が空。
- BW2：`solution()` の手順を `pick` で進めるとクリアのカード（`next`・`menu`）。`irobin.best` が更新され、`next` で面 +1・手0。
- BW3：2手注いで再読み込みすると同じ局面。壊れた `irobin.save`・`irobin.best` で落ちず、面 1 から（ページエラーなし）。ほかのゲームの保存キーが変わらない。
- BW4：プレイ中・遊び方・クリア・やりなおしの確認の、どこからでも `a#back` でメニューへ戻れる。
- BW17：届けた瓶は消える。**§17.7 に合わせて直した**：届けると画面の瓶が1本減り空き瓶は増えない、残りの瓶は動かない（寄せる動きなし・届ける前と同じ位置）、跡は `.place-empty` のまま押しても何もしない、`data-index` は state の位置・`data-id` は id・`aria-label` と数字キーの番号は id+1 で固定、空いた場所の数字キーは何もしない、矢印は跡を飛ばす、届けの演出中に押した瓶が正しい瓶（id）を選ぶ、動きを減らす設定で 0.5 秒以内、再読み込みで同じ局面（v:3）。
- BW18：布の瓶（§17.6）。

full（smoke に加えて）：
- BW5：SE 縦・SE 横（568×320 と 667×375）・iPad 縦横、11本の面（40 面）でも、ボタンと瓶が 44×44 以上で safe-area 内、`.head`・`#shop`・`#board`・`#hint`・`#tools` が重ならずはみ出さない。16 桁の面番号でもはみ出さない。
- BW6：お助け。1手もどすを手の数だけ押すと最初の局面、最初は disabled。やりなおしは確認カード → `restartYes` で最初から・手0。
- BW7：詰み。`setState` で詰みの局面を作り、1手注ぐと `stuck`、ヒントに「1手もどす」、お助けに `data-attention="1"`。
- BW16：詰み予備軍（doomed）・届けの連鎖が短い（6本以上の連鎖で4.5秒以内。布の追加で20面の連鎖が3本になったので、20面から6本以上の面を探す）・演出中にお客さんを押すと飛ばせる・クリアのカードに「めやす」と★・SE 縦横で遊び方の「わかった」がスクロールなしで押せる。
- BW8：キーボード。矢印でフォーカスが動き、Enter・数字キーで注げる。U で戻る、Esc で選ぶのをやめる、M で音のオン/オフ。カードが開いているときは瓶が反応しない。
- BW9：中断。注ぐ演出の途中で hidden にすると `paused`、`timers` は増えない、visible で演出が終わって `idle`。
- BW10：効果音。`pick`・`pour`・`seal`・`cork`・`deliver`・`arrive`・`clear` が起きた順に鳴る。音の名前がすべて sfx.js の表にある。
- BW11：色覚。各 `.seg` に記号（`.mark`）があり、色ごとに記号が違う。瓶の `aria-label` に色の名前。トレイにも記号。
- BW12：動きを減らす（`reducedMotion: 'reduce'`）で `calm` が true、注ぐ演出が 0.3 秒以内に終わる。
- BW13：`APP_FILES` に `games/irobin/*` がすべて入り、オフラインで開ける。無ければ**不合格**（skip で合格にしない）。
- BW14：`#board` のダブルタップで拡大しない（CDP のタッチ操作。Chromium だけ）。
- BW15：メニューのカードの名前が `IrobinLogic.NAME` と一致し、`irobin.best` が 3 なら「3 めん クリア」、壊れた値なら何も出ない。

テストは「保存が無い」「要素が無い」「API が無い」ときに合格扱いにしない（空振りの合格を作らない）。`IrobinGame` が無ければ例外で不合格にする。

### 12.4 変異テスト（`tests/mutants/mutate.mjs`、接頭辞 **`MB`**。既存の M・MD・MP・MH・MV・MZ と衝突しない）
- MB1 色違いの瓶にも注げる（`mismatch` の判定を外す）→ BL2
- MB2 注ぐ量が空きを超える（空きで丸めない）→ BL2
- MB3 そろった瓶を、注文の色と違うお客さんにも届ける → BL3
- MB4 届けた瓶が消えない（栓をしたまま残る）→ BL3・BL5・BL11
- MB5 注いでも隠れた段が見えるようにならない → BL9
- MB6 ソルバーが待ち瓶をもう届けたものとして数える（いつも anyOrder。手の位置がずれる）→ BL6
- MB7 `validateSave` が手の形を確かめない → BL7・BW3
- MB8 hidden で演出を止めない → BW9
- MB9 1手もどすで2手戻る → BW6
- MB10〜MB12 は tests/README.md の表を見る
- MB13 届けたあと空き瓶を足す（旧仕様に戻す）→ BL3・BL5・BL11・BW17
- MB14 演出中に押した瓶を、押したボタンの位置で選ぶ（瓶の番号のずれ）→ BW17
- MB15〜MB17・MB19：布の瓶（§17.6）。MB18（新しい色）は §17.8 で作らない（欠番）
- 置換前の文字列は、実装が固まった後に C が実物から写す（A・B は、置換の目印になる行を変に分けない）。
- 変異テストは最後の関門だけで流す（W-01）。`ONLY=<BL と BW の全項目> M=MB1,…,MB14 node tests/mutants/mutate.mjs both`。

### 12.5 テストを流すときの PORT（W-04）

| 担当 | PORT |
|---|---|
| A ロジック | 9110（BL は Node だけなので `ONLY=BL1,…` で） |
| B 画面 | 9210 |
| C 組み込み | 9310（変異テストは 9510） |

## 13. git（共通）

- 作業場所は worktree `…/scratchpad/wt-irobin`（ブランチ `feature/irobin`）。ほかの場所を書き換えない。
- コミットメッセージは日本語。末尾に次の2行を**一字一句そのまま**入れる（名前を書き換えない。W-05）：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01V9DC9ejSppyhZtD33dpUtK
  ```
- force push・rebase・履歴の書き換え・**master への push は禁止**（公開はユーザーの確認の後に PM が行う）。

## 14. これまでの教訓（最初から入れておく約束）

1. **表示の1ずれ**：画面の数は `hud()` の値をそのまま出す（BW1）。
2. **横向きでの重なり**：高さ 500px 以下の横向きの配置を契約に書いた（§6）。矩形で検査（BW5）。
3. **裏に回す・遊び方を開く**：演出を止める（§8.4、BW9、MB8）。
4. **キーボード**：瓶を矢印・数字で選べる（§5、BW8）。
5. **色覚**：Okabe-Ito 系の配色＋記号（§3.1、BW11）。
6. **タイマーの片付け**：`later`・`clearLater`・`runId`（§8.4）。
7. **結果カード直後の誤タップ**：400ms 押せない（§8.1）。
8. **空振りのテスト**：無いときに合格にしない（§12.3）。
9. **DOM から答えが見えない**：隠れの段に色を書かない（§6）。
10. **決定的な生成**：時計でなく局面の数で上限（§3）。保存した手を再生できる。

## 15. 共通で守ること（CLAUDE.md より）

- ボタンは 44px 以上、ダブルタップ拡大の抑止、最大の桁数でも表示が崩れない、どの画面からもメニューへ戻れる、保存データが壊れていても落ちない、文字は 12px 以上。
- キーボードでも遊べる、動きを減らす設定に従う、裏に回したら演出を止める、iPhone SE 320×568 の縦横で重ならない・はみ出さない、オフラインで動く。
- 不具合を直すときは、同じ不具合がほかのゲームにもないかを確かめる（横展開）。

## 16. ゴール

公開の条件（Chromium の smoke と full、WebKit の smoke）を満たし、レビュー（技術・UX・中毒性・品質・アクセシビリティ・性能）の指摘を直したら、**公開前にユーザーに確認する**。master への push はユーザーの承認の後。

## 17. 布の瓶（2026-10-20 追加。ここが §1〜§12 より優先）

ユーザーの承認（2026-10-20）：「布の瓶、中身が入っている、空き瓶がランダムで出てくる、両方採用します。空き瓶が出てくる場合は難易度が下がるでしょう。レベルが上がれば空き瓶ではなく、新しい色が出てくるようにすればいいと思います。」
（PM が示した「届けた瓶が消えるだけになり、注文の順番が解けるかどうかに関係しなくなったので、注文に考えどころを持たせる」案への返事。）

ねらい：お客さんに届けた数で布が取れる瓶を置き、**どの色を先にそろえて届けるか**（＝注文の順番）に意味を持たせる。負けの条件・時間の制限は増やさない（詰み・詰み予備軍の案内は今までどおり）。

### 17.1 ルール（ロジックの正）

- 瓶に `cover` を足す：`null`＝布なし、整数 `k`＝**届けた数 `served` が k 以上になったら布が取れる**。画面には「あと `k - served` にん」と出す。
- 布の瓶は**注ぐ元にも相手にもならない**。`pourCheck` の reason に `'covered'` を足す。判定の順は `'won'`→`'range'`→`'same'`→**`'covered'`（元か相手が布）**→`'empty'`→`'sealed'`→`'full'`→`'mismatch'`。
- 布の下の中身は2種類：
  - **中身あり**：ふつうの瓶と同じく色水が入っている（解くのに必要）。隠れの面では、布が取れたとき一番上だけ見え、ほかは「？」（§1.1 と同じ）。隠れでない面では全部見える。
  - **空き瓶**：`cells: []`。布が取れると空き瓶が1本増える（ご褒美。そのぶん面はやさしくなる）。
- **新しい色**（高い面だけ）：ある1色の4段が**全部、布の瓶の中**にあり、布の外には1段も無い。布が取れて初めてその色が見える。1本の布の瓶に同じ色4段は入れない（取れた瞬間にそろってしまうため）。だから新しい色は布の瓶が2本以上の面だけ。
- **処理の順**：注ぐ → 栓 → 届けの連鎖 → 届けた瓶を取り除いて詰める → **`served >= cover` の布を取る**（`cover = null`）。取れた瓶はそろっていない（生成が保証）ので、布が取れたことで届けが起きることはない。
- お客さん：布の中の色の注文も、ふつうに列に並ぶ。布が取れる前にその色のお客さんが来ると、届けられない注文が枠をふさぐ（これが「注文の順番」の考えどころ）。
- 生成は、布を含めて `solve`（注文の順どおり）で解けることを確かめた面だけを出す（今までどおり）。`order:'easy'` の面は `anyOrder` で解いた順を列にする（今までどおり）。
- 詰み・詰み予備軍：今までどおり（`isStuck`・`solve` が布を考える）。

### 17.2 面の表への追加（`paramsFor` が返す）

`params` に `cloths`（布の瓶の本数）・`clothEmpty`（布の瓶1本ごとに空き瓶になる確率。面の種の乱数で決まる＝同じ面は必ず同じ）・`clothNew`（新しい色を出すか）を足す。最初の案（ロジック担当が Node で測って直してよい。直したら値と理由をこの表の下に書く）：

| 面 | cloths | clothEmpty | clothNew | ねらい |
|---|---|---|---|---|
| 1–7 | 0 | — | false | 今までどおり（6 面から待ち瓶が出る。新しいことを2つ同時に出さない） |
| 8–14 | 1 | 0.5 | false | 布の登場。半分くらいは空き瓶（ご褒美） |
| 15–24 | 1 | 0.3 | false | |
| 25–39 | 2 | 0.15 | 偶数面 | 新しい色の登場 |
| 40– | 2 | 0 | true | 空き瓶は出ない。新しい色が出る |

- 空き瓶になる布は「色の瓶に布をかぶせる」のではなく「布をかぶった空き瓶を1本足す」。瓶が `MAX_BOTTLES = 11` を超えるときは空き瓶にせず中身ありにする。
- `cover` の値（何人届けたら取れるか）は生成の乱数で `1` 〜 `total - 1` から選ぶ。中身ありの布は早め（目安 1〜total の半分）、空き瓶の布は遅め（目安 total の半分以降）にすると、空き瓶でやさしくなりすぎない。ロジック担当が測って決める。
- **評価の基準**（ロジック担当が測って報告する。§3.2 の測り方＝ゆるい遊び方のクリアの割合と同じ）：
  1. 1〜7 面のクリアの割合が今と変わらない（布が無いので生成も同じでよい。ただし保存の形の版は上げる）。
  2. 8〜24 面は今と同じか少し難しい〜少しやさしいの範囲（空き瓶の布でやさしくなりすぎない）。
  3. 25 面以降は今と同じか少し難しい。
  4. 生成：1〜2000 面すべて fallback 0 か 1（2 は 0 面が目標）、1 面の生成が Node で最大 50ms 以内、局面の最大が `GEN_NODE_BUDGET` 以内。
  5. 布の瓶の `cover` が、解の途中で必ず取れる（取れないまま終わる面は出さない。全部届けると served = total ≧ cover なので自然に満たす）。

**測った値と直した理由（2026-10-20、ロジック担当。§17.8「新しい色はやめる」を反映した最終の表）**

| 面 | cloths | clothEmpty | ねらい |
|---|---|---|---|
| 1–7 | 0 | — | 今までどおり（面の中身も前と同じ） |
| 8–14 | 1 | 0.7 | 布の登場。7 割が空き瓶、3 割が中身あり |
| 15–24 | 1 | 0.7 | |
| 25– | 偶数面 1・奇数面 0 | 0 | 中身ありだけ（9 色で瓶が 11 本＝上限のため空き瓶の布は足せない）。奇数面は布なし（25〜39 の奇数面は隠れの面なので、新しいことを2つ同時に出さない） |

- cover：中身ありは `1`〜`ceil(total/3)`、空き瓶は `ceil(total/2)`〜`total-1`（面の種の乱数）。
- 測り方：§3.2 のゆるい遊び方。同じ表の行でも面ごとの差が大きい（同じ行で 2%〜87%）ので、帯の数字は「実際の面」と「同じ設定で 300〜400 面ぶん作った平均」の両方を見た。
- 1 色の瓶に布（300 面×10 回の平均、前→布）：中身ありの布は約半分になる（6 色 76%→48%、7 色 54%→27%、8 色 36%→14%、9 色 22%→9%）。中身の色の種類や cover を早めても 1〜3 ポイントしか変わらない（布の瓶が注ぐ相手にならず、作業場所が1本減るのが主な理由）。空き瓶の布はほぼ変わらない（77%・54%・30%）。そこで最初の案の clothEmpty（0.5・0.3）を 0.7 に上げ、9 色の面（中身ありしか置けない）は 1 面おき・1 本にした（2 本だと 5〜6%）。
- 結果（前のルール→布あり）：同じ設定の平均で 8〜9 面 76%→66%、10〜14 面 54%→46%、15〜24 面 36%→25%、25 面以降 約21%→約15%（布の面 9%・布なしの面は前と同じ）。実際の面（1〜600 面）では 1 面 100→100%、2〜5 面 99→99%、6〜7 面 82→82%、8〜9 面 66→57%、10〜14 面 58→51%、15〜24 面 25→29%、25〜39 面 19→16%、40 面以降 21→14%。基準 1〜3（少し難しい〜同じ）に収まる。
- 生成（1〜2000 面）：全部 fallback 0、局面の最大 27428（278 面）、1 面の生成は最大 26ms（Node）、2000 面の合計 2.1 秒。布で届けられない注文が2枠ともふさぐ列は、解く前に並べ直す（これが無いと最大 134ms・10 万局面だった）。

**§17.9 を反映した表と測った値（2026-10-20、ロジック担当。上の最終の表より優先）**

| 面 | cloths | clothEmpty | 中身ありの cover（`params.clothCover`） | 選び方 |
|---|---|---|---|---|
| 1–4 | 0 | — | — | 今までどおり（面の中身も前と同じ） |
| 5（`CLOTH_INTRO_LEVEL`。v41 で 8 から） | 1 | 0（中身あり） | `"intro"`＝1 | はじめての布は必ず中身あり・すぐ開く |
| 6–7（v41） | 1 | 1（空き瓶の布） | `"early"` | とどけると あく を続けて覚える |
| 8–14 | 1 | 0.7 | `"early"`＝1〜ceil(total/3) | 8 面は v41 で入門の扱いが外れたが、生成された面は前と同じ（中身あり・cover 1） |
| 15–24 | 1 | **0.4** | `"mid"`＝ceil(total/3)〜ceil(total/2)（8 色で 3〜4） | |
| 25– | 偶数面 1・奇数面 0 | 0 | `"late"`＝ceil(total/2)±1（9 色で 4〜6） | 布の中の色の注文が布の取れる前に枠に来る列を選ぶ＋「布が効いている」面を優先 |

- `params` に `clothCover`（`"intro"|"early"|"mid"|"late"`）を足した（`easierParams` もそのまま持つ。`opts.params` の壊れた値は `"early"`）。空き瓶の布の cover は今までどおり ceil(total/2)〜total-1。
- 「布が効いている」の決め方（`"late"` の面だけ）：解けた候補ごとに、布の cover を 1 にした同じ面（同じ列）を「元の探索量 ÷ 1.5」局面まで解く。そこまでに解ければ「cover 1 のときより 1.5 倍以上かかる＝効いている」としてその面を出す。効いていなければ次の候補へ。候補は最大 8 個・選ぶのに使う局面は合計 25,000 まで。超えたら最初に解けた候補を出す（必ず解ける・決定的は今までどおり）。`"late"` の候補 1 つを解くのは 15,000 局面まで（重い候補は捨てる。1 面の生成を 50ms 以内に保つため）。
- 列の選び方：行き詰まらない列（`queueFeasible`）のうち、布の中の色の注文が「列の位置 < cover + 1」（＝布が取れる前に見える枠に来る）列を最大 30 回の並べ直しで探す。無ければ行き詰まらない最初の列。
- 測り方は今までどおり（§3.2 のゆるい遊び方、実際の面 1〜600、40 面以降は 1 面 20 回・それより前は 100 回）。

| 帯 | クリアの割合 前→後 |
|---|---|
| 1 | 100 → 100% |
| 2–5 | 99.3 → 99.3% |
| 6–7 | 81.5 → 81.5% |
| 8–9 | 56.5 → 56.5%（8 面は前も中身あり cover 1 だった。今は必ずそうなる） |
| 10–14 | 51.4 → 51.4%（表を変えていない） |
| 15–24 | 28.8 → 24.7% |
| 25–39 | 16.4 → 14.7%（布の面だけ 10.1 → 10.3%） |
| 40– | 14.2 → 13.2%（布の面だけ 8.0 → 4.4%、布なしの面は 21.7% のまま） |

- 布が効いている面の割合（cover 1 より探索量 1.5 倍以上、1〜2000 面の布の面）：25–39 面 0/7 → 2/7、40 面以降 8% → **65%**（981 面、探索量の比の中央値 1.00 → 1.86）。25 面以降の布の面全体で約 8% → 約 65%（目安 50% 以上）。8〜24 面は cover が 1〜4 で、cover 1 と探索量は変わらない（0%。§17.9 の対象外）。
- 25 面以降のクリアの割合は帯で 13〜15%（目安の 10% 未満にはならない）なので、布は 1 面おき（偶数面）のまま。布の面だけを見ると 40 面以降 4.4% と難しいが、1 面おきに布なしの面（21.7%）が挟まる。
- 生成（1〜2000 面）：全部 fallback 0、局面の最大 25,671（478 面。前は 27,428）、1 面の生成の最大は Node で約 40ms（前は約 37ms）、2000 面の合計は 2.2 秒 → 約 7 秒（布の面の平均の局面が約 600 → 約 4,500。端末で作るのは 1 面ずつなので問題にならない）。
- テスト：BL13 に表・cover の幅・効いている面の割合（25〜600 面で半分以上）を足した。BL6 の「注文の順で解けるかどうかは変わらない」は布の無い面（6・7・27 面）で確かめる（布の面は順が効くのが今の決まり）。BW16 の連鎖の時間は、布が同じ手で取れる手を除いて探す（36 面の 6 本の連鎖で布の演出が足されて 4.5 秒を超えたため。画面の不具合ではない）。

### 17.3 API の変更（ロジック）

- 状態：`bottles[i].cover: number|null`（§4.1 に足す）。布の瓶の `hidden` は §1.1 の決まりのまま持つ（布が取れたときにそのまま使う）。
- `applyMove` の outcome（注いだとき）に `unveiled: [{ id, bottle, cells, hidden }]` を足す。`bottle` は**新しい state の位置**（布が取れるのは詰めた後なので）、`id` は瓶の id、`cells`・`hidden` は取れた瓶の中身。無ければ `[]`。
- `createLevel` の `info` に `cloths: [{ id, cover, empty: boolean }]` と `newColor: 色id|null` を足す。
- `hud(state)` は今のまま。
- **保存の形を `v: 3` に上げる**：`makeSave` は `{ v: 3, level, moves }`。`validateSave` は v:3 を受け、**v:2 と v:1 は level が正しければ `{ level, moves: [] }`**（布で面の作りが変わったので、手を捨ててその面の最初から）。
- 新しい定数 `SAVE_KEY_CLOTH = "irobin.cloth"`（布の説明を見たら `"1"`）。
- 例外を外へ出さない・イミュータブル、は今までどおり。

### 17.4 画面（担当B）

- 布の瓶：瓶の形のまま、中身の代わりに**布**を描く（色に頼らない模様。例：ゆるい縦じわと結び目）。布の上か下に**「あと N」**の札（N＝`cover - served`、12px 以上・読みやすいコントラスト）。
- DOM：`.bottle[data-covered="1"][data-cover-left="N"]`。布が無い瓶は `data-covered` を付けない（または `"0"`）。`aria-label` は「Nばん。ぬのを かぶった びん。あと M にん とどけると あく」。
- 布の瓶を押したとき：選べない。ヒント「ぬのの びんは、おきゃくさんに あと M にん とどけると あくよ」を出し、軽く揺らす（動きを減らす設定では揺らさない）。`deny` の音。選んでいる瓶があっても、その選びは解除しない。
- 布が取れる演出（届けの演出の後）：布がふわっと持ち上がって消え、小さな光、音 `unveil`。中身が空き瓶なら「あきびんが でてきた！」、新しい色ならその色の名前で「あたらしい いろ ○○が でてきた！」、ふつうの中身なら何も言わない（音と光だけ）。動きを減らす設定では一瞬で取る。演出中のタップで飛ばせる（IB-01 の決まりに乗る）。
- **はじめて布が出た面**（`SAVE_KEY_CLOTH` が無いとき）：面の最初のヒントを「ぬのの びんは なかが みえないよ。おきゃくさんに とどけると ぬのが とれるよ」（v41 で変えた。§21。それまでは「ぬのの びんは、おきゃくさんに とどけると あくよ。どの いろから とどけるか かんがえよう」）にし、布の瓶を指さす（IB-04 のトレイと同じやり方）。見たら `"1"` を保存。
- 遊び方カード：3項目のまま、布のことを短く入れる（SE 縦横でスクロールなしで「わかった」が押せること＝BW16 を守る）。
- 数字キー：布の瓶も「並んでいる瓶」として数える（押すと上の「布の瓶を押したとき」と同じ）。
- 保存は v:3（logic の `makeSave` をそのまま使う）。
- テスト用 API（§8.6）：`IrobinGame.state()` の瓶に `cover` がそのまま出ること。

### 17.5 効果音（担当C、`common/sfx.js` の irobin の表に追記のみ）

- `unveil`：布が取れる音（やわらかく上がる2音。`reveal` と聞き分けられる）。ほかのゲームの表に触らない。

### 17.6 テスト（担当C）と PORT

- BL12：布のルール。`pourCheck` の `'covered'` の順、布の瓶へ／から注げない、`served` が `cover` に届いた手で `unveiled` に出て `cover:null`、空き瓶の布が取れると空き瓶が増える、隠れの面で取れた瓶は一番上だけ見える、イミュータブル。
- BL13：生成。2000 面までの決定性・全部解ける（solution を applyMove で再生して won）・`paramsFor` の表のとおり（1〜7 面は布なし、40 面以降は空き瓶の布なし）・`clothNew` の面で新しい色が布の外に無い・1本の布の瓶に同じ色4段が無い。
- BL14：保存 v:3。v:2・v:1 は手を捨てて面の最初から、v:3 の途中保存→`replay` で同じ局面（布の状態も）。
- BW18：布の瓶の見た目と札（`data-covered`・`data-cover-left`・aria-label）、押すと選べずヒント、届けて布が取れる（`unveiled` の瓶の札が消え、中身が描かれる）、動きを減らす設定で 0.5 秒以内に取れる、はじめての布のヒントと `irobin.cloth`、再読み込みで同じ局面。
- 変異（MB）：MB15 布が1人早く取れる（`>=` を `>= cover-1`）→ BL12、MB16 布の瓶に注げる → BL12、MB17 v:2 の手をそのまま再生する → BL14、MB18 新しい色の4段を布の外にも配る → BL13、MB19 布の瓶を押すと選べる → BW18。
- 既存の BL・BW・MB は新ルールで壊れないように直す（面の作りが変わるので、面の中身を決め打ちしているテストは、布の無い 1〜7 面を使うか、布を考えた形に直す）。
- PORT：ロジック担当は Node だけ。画面担当は `PORT=8800`、テスト担当は `PORT=8900`（W-04）。

### 17.7 届けた瓶の跡（2026-10-20 ユーザー決定。§1.2・§7・BW17 の「寄せる」より優先）

ユーザーの指示（そのまま）：「あと瓶の位置ですが、今は便が消えると位置を調整してくれる機能があります。あれは外してください。」

- 届けた瓶が消えても、**残りの瓶は動かさない**。消えた瓶の場所は空いたまま（何も置かない、押しても何も起きない）。寄せる動きは消す。
- 画面の置き場所は**瓶の id で固定**（id＝面の最初の並び順。布の空き瓶も最初から id と置き場所を持つ）。列の数・瓶の大きさは面の最初の本数で決め、届けても変えない。
- 瓶の番号（`aria-label` の「Nばん」・数字キー）は**置き場所の番号（id + 1）で固定**し、届けても変わらない。消えた場所の番号はキーで押しても何もしない。矢印キーは空いた場所を飛ばして次の瓶へ。
- ロジック（logic.js）の配列は今までどおり詰めてよい（位置 index は内部の番号）。画面は `data-id` で置き場所を決め、`data-index` は今の state の位置を入れる（main が id↔位置を引き直す決まり §1.2 は今までどおり）。

### 17.8 「新しい色」はやめる（2026-10-20 ユーザー決定。§17.1〜17.6 の「新しい色」より優先）

ユーザーの言葉（そのまま）：「単に色水が入っている（空き瓶ではない）」という意味です。今までなかった新しい色ではないです」

- 「新しい色」（1色の4段を全部布の中に入れる）は**作らない**。高い面の布の瓶は、ふつうの「中身あり」（色水が入っている）だけ。
- `params.clothNew`・`info.newColor` は削除する。面の表の clothNew の列は無し（40 面以降は「空き瓶は出ない＝中身ありだけ」）。
- 画面のヒント「あたらしい いろ ○○が でてきた！」は削除。中身ありの布が取れたときは今までどおり何も言わない（音と光だけ）。
- テスト：BL13 の「clothNew の面で新しい色が布の外に無い」と変異 MB18 は作らない。

### 17.9 考えどころを強める（2026-10-20 ユーザー決定。§17.2 の表より優先）

レビュー（中毒性・品質）で「布の瓶が『どの色から届けるか』の考えどころとしてほとんど働いていない」と分かった（空き瓶の布は遅く開いても解ける＝おまけ、25 面以降は cover 1〜3 で自然に開き、布が効いて難しくなる面は約 9%）。
ユーザーの決定（PM の案「25面以降は布が取れるまでを『あと4〜6にん』にし、布の中の色のお客さんが前の方に来る面を選ぶ。15〜24面は空き瓶の布を7割→4割に。8面の最初の布は色水入り・すぐ開く入門に。難しさは少し上がる」への返事）：「考えどころを強める (Recommended)」。

- 5 面（`CLOTH_INTRO_LEVEL`。v41 で 8 から）：最初の布は**中身あり・cover 1**（入門。必ず。はじめての布のヒントと合う）。6・7 面は空き瓶の布（`clothEmpty` 1）。8〜14 面は今の表のまま（8 面は入門の扱いが外れるが、面は同じ）。
- 15〜24 面：`clothEmpty` 0.7 → **0.4**。中身ありの cover は中程度（目安 total の 1/3〜1/2）。
- 25 面以降：中身ありの cover を **total の半分前後（目安 4〜6）**。さらに、生成した候補の中から「cover を 1 にしたときより解く探索量が 1.5 倍以上」（＝布が順番に効いている）面を優先して選ぶ。目安：布が効いている面の割合 9% → **50% 以上**。
- 決定性・必ず解ける・1面の生成 Node で最大 50ms・fallback 2 は 0 面、は今までどおり。
- 測って報告：帯ごとのクリアの割合（§3.2 の測り方）前→後、布が効いている面の割合、生成の最大時間。25 面以降のクリアの割合が今（約 14〜16%）より大きく下がる（目安 10% 未満）なら、布を 1 面おきのままにするなどで調整し、理由を §17.2 の下に書く。

## 18. 古いページから書き戻さない（2026-10-22、v30、X-20）

ユーザーの承認（2026-10-22。そのまま引用）：「v30 の修正計画を支持します」。課題 X-20：Safari のタブで bfcache（戻る・進むで残しておいたページ）から古いページへ戻ると、メモリ上の古い状態を保存に書き戻す（さいしょからの後や、別のタブで遊んだあとに古い進み具合が戻る）。

| 番号 | 決めごと |
|---|---|
| G1 見張るキー | `irobin.save`（面と手）。このページが最後に読んだ・書いた生の文字（`seenRaw`）を覚え、自分で書く・消すたびに読み直して覚え直す |
| G2 表に戻ったとき | `visibilitychange`（表）と `pageshow`（persisted の有無によらない）で、見張るキーが覚えた文字と違えば（ほかのページ・さいしょからが書いた）、保存を止めて（`stale`）`location.reload()`。以後のほかの処理（再開・カードのボタン戻しなど）はしない。同じなら今までどおり続ける（開き直さない） |
| G3 保存を止める | `stale` の間は書く・消すを何もしない（開き直す前の pagehide・hidden で古い状態を書かない） |
| G4 別のタブ | 裏（`document.hidden`）にいる間に `storage` イベントで見張るキー（または `clear`）が変わったら `stale` にする（閉じても書き戻さない）。表に戻ると G2 で開き直す。見えている間の `storage` イベントは今までどおり（同時に2つ見えているときは後に書いた方が残る。開き直しの往復を起こさないため） |
| G5 変えないもの | 効果音・デバッグ命令・遊び方カード（開き直しても、見たかどうかの保存で決まるので不自然に出ない）。同じページの中で（デバッグ命令 storage・テストで）見張るキーを書くと、次に表に戻ったとき「ほか」と見なして開き直す（その前にゲームが自分で保存すれば覚え直すので開き直さない） |
| G6 開き直しの知らせ（X-24。v39） | 開き直す直前（`reloadIfStale` の `location.reload()` の前）に `YubiNotice.markReload()`（`common/notice.js`。印は sessionStorage）。開き直したページの上に「ほかの タブの つづきから はじめました」を 1 回だけ 4 秒出す（押す邪魔をしない）。さいしょから などの開き直しでは呼ばない。メニューの「さっき遊んだ」の印は付けない（ユーザー決定 2026-10-24「知らせだけ (Recommended)」）。テストは BW20（x20Run）・L11 |
| G7 比べ方の注意（X-22。v39） | 比べるのは保存の生の文字で、どちらも保存なし（null）なら「変わっていない」と見なす。今は毎回保存から読むので実害なし＝**直さない**。メモリの値から書く保存を足すときは、書くたびに増やす印（書き込みの回数）で比べる形に変える（`changedElsewhere` の上の 1 行のコメントにも書いた） |

テスト：BW20（full）。(a) 変わっていなければ pageshow persisted でも開き直さない (b) pagehide persisted → ほかで書く → pageshow persisted → pagehide で書き戻さず、開き直して新しい保存から続ける (c) 裏にいる間に同じ context の別のページが書く（本物の storage イベント）→ pagehide で書き戻さず、表に戻ると開き直す。直す前のコードでは不合格になることを確かめた。

## 19. v37 の新しい仕掛け：ちいさい びん・いろ きまりの びん・かぎの びん（2026-10-24、IB-29。ここが §3.2・§17 より優先）

ユーザーの答え（2026-10-24、そのまま）：直し方「新しい仕掛けを足す」、仕掛けの選択「全て採用です。徐々に難易度が上がるよう調整した上で採用します」。
（PM の計画 docs/plans/v37.md 1 章：40 面から先は「わな手の割合」が上がらない（作業げーになる）ので、新しい仕掛けを足す。案 A・B・C の 3 つ。）

### 19.1 ルール（ロジックの正）

| 仕掛け | 中身 | 状態（`bottles[i]`） | 注げないときの reason |
|---|---|---|---|
| A **ちいさい びん** | 空き瓶が背の低い瓶になり、**3 段まで**しか入らない。4 段にならないので、そろう（栓をする）場所にはならない（一時置き場だけ） | `cap: 3`（ふつうの瓶は `cap: 4`） | 3 段で `'full'` |
| B **いろ きまりの びん** | 空き瓶の首に色の札。**その色しか入れられない**。4 段そろえば栓をして、ふつうに届く（届けると消える） | `only: 色`（ふつうは `null`） | ちがう色は `'only'`（中身がある瓶へ色ちがいは今までどおり `'mismatch'` が先） |
| C **かぎの びん** | 中身の入った瓶に鍵。**注ぐ元にも相手にもならない**。鍵の色（その瓶に入っていない色）の瓶を **1 本そろえた（栓をした）瞬間に開く**（届けの前）。届けた数では開かない | `lock: 色`（ふつうは `null`）。`cover` は `null` | `'locked'`（布は今までどおり `'covered'`） |

- 判定の順：`'won'`→`'range'`→`'same'`→`'covered'`／`'locked'`→`'empty'`→`'sealed'`→`'full'`→`'mismatch'`→`'only'`。
- 1 本の瓶に仕掛けは 1 つだけ（布・ちいさい・いろ きまり・かぎ は重ならない。`normalizeState` は重なった形・`cap` が 3 か 4 でない・`only` の瓶にちがう色・`lock` と栓は `null`）。
- `applyMove` の outcome に `unlocked: [{ id, bottle, color }]` を足す（`bottle` は新しい state の位置。無ければ `[]`）。
- 詰めた形：ビット 28〜31 を「印」に使う（0＝ふつう、1〜9＝色＋1、15＝ちいさい）。かぎは「印＝鍵の色＋1」かつ布のビット 15。局面のキーは 3 文字（印も入れる）。
- ソルバー・詰み・詰み予備軍は同じ `pourCount`・`step` を通るので、3 つの仕掛けを考える。
- 公開する定数：`SMALL_CAP`(3)・`SMALL_FROM`(41)・`ONLY_FROM`(71)・`KEY_FROM`(101)・`SAVE_KEY_SMALL`("irobin.small")・`SAVE_KEY_ONLY`("irobin.only")・`SAVE_KEY_LOCK`("irobin.lock")。`paramsFor` は `smalls`・`onlys`・`keys`（本数）と `pick`（`"soft"`|`"hard"`）を足して返す。

### 19.2 出し方（面の表）

決め方：**新しい仕掛けは最初の面だけ 1 本で、登場の面とその次の数面はほかの仕掛けと重ねない**（表のとおり、登場の次の帯の途中から組み合わせる）。慣れてから本数・組み合わせ・「hard」を増やす。帯ごとの「わな手の割合」（その手を打つと、もう解けなくなる手の割合。§3.2 の測り方の (3)）が段々に上がるように、組み合わせごとに 40〜400 面で測り、帯の値が上がる並びを選んだ。

- 面 n の仕掛けは、帯の行の `(n % 8) >> 1` 番目（布なしの面＝奇数面は n % 8 が 1・3・5・7 の順、布の面＝偶数面は 0・2・4・6 の順）。
- 布の面（偶数面）に出すのは **ちいさい びん だけ**（かぎは布と同じ「あとで開く」瓶で分かりにくく、生成も重い。いろ きまりを重ねると「布が効いている面」（§17.9）が半分を切った）。
- `pick`：`"soft"`＝いろ きまりは中くらいに埋まった色・かぎは一番上に出ている色・生成は最初に解けた面。`"hard"`＝どちらも一番深く埋まっている色で、布なしの面では「仕掛けを外した同じ面より、解く探索量が 1.5 倍以上」（＝仕掛けが効いている）面を選ぶ（§17.9 の布と同じ選び方。候補 8 個・25,000 局面まで）。

| 帯 | 布なしの面（n%8＝1・3・5・7） | 布の面（n%8＝0・2・4・6） | ねらい |
|---|---|---|---|
| 1–40 | なし | なし | 今までどおり（面の中身も前とまったく同じ） |
| 41–49 | A1s・なし・なし・なし（41・49 面） | なし | **41 面：ちいさい びんの登場**（1 本） |
| 50–69 | A1s・A1s・A1s・A2s（55 面から 2 本） | なし・A1s・なし・A1s（50 面から） | ちいさい びんに慣れる。2 本・布の面にも |
| 70–99 | B1h・A1s・A2s・B1s | なし・A1s・A1s・なし | **71 面：いろ きまりの びんの登場**（1 本・soft） |
| 100–149 | A1C1s・C1h・C1s・A1B1s | A2s・A1s・A1s・なし | **101 面：かぎの びんの登場**（1 本・soft）。105 面から組み合わせ |
| 150– | C1h・A1B1h・B1h・A1B1s | A1s・なし・A1s・A2s | 3 つとも。ここから先は同じ（上限。8 面ごとのくり返し） |

（A＝ちいさい、B＝いろ きまり、C＝かぎ、数字＝本数、s＝soft・h＝hard。いろ きまり・かぎは 1 面 1 本まで。いろ きまりは 2 本にすると空き瓶が無くなり、生成で解ける配りだけが残ってやさしくなる（40〜400 面で測ると 1 本 13.6% → 2 本 7.7〜9.7%、色の選び方を変えても同じ）ので、**本数でなく色の選び方（soft→hard）と、ちいさい びんとの組み合わせで強める**。）

### 19.3 生成

- 仕掛けは、配った瓶に乱数の後から足す（ちいさい・いろ きまりは空き瓶を前から、かぎは布の無い中身ありの瓶を乱数で 1 本）。**仕掛けの無い面は乱数の使い方が前と同じ**＝面も前と同じ（1〜200 面のうち仕掛けの無い 72 面の指紋が v36 と同じ。BL19）。
- かぎの色は、その瓶に入っていない色だけから選ぶ（入っている色だと開けられない）。注文の列の「布で行き詰まらないか」（`queueFeasible`・`queueFront`）は、かぎの瓶を飛ばす。かぎの面の候補 1 つを解くのは 15,000 局面まで（重い候補は捨てて次へ）。
- 易しい側（fallback 1）は仕掛けなし。

### 19.4 画面（render.js・main.js・index.html）

- ちいさい びん：`.bottle[data-cap="3"]`。ガラスを 4 分の 3 の高さに（段の高さはふつうの瓶と同じ）。**口のあたりに常設の「3」の札**（`.gimtag` の中の `.capbox`。12px 以上。形だけに頼らない）。aria-label「Nばん：ちいさい びん（3つ まで）。…」。3 段の瓶へ注ごうとすると「ちいさい びんには 3つ までしか はいらないよ」。
- いろ きまりの びん：`.bottle[data-only="色"]`。ガラスのふちをその色にし、首にその色と記号の札（`.onlybox`。色に頼らない）。栓をしたら札は消す。aria-label「Nばん：いろ きまりの びん（○○だけ）。…」。ちがう色は「この びんには ○○ しか いれられないよ」。
- かぎの びん：`.bottle[data-lock="色"]`。中身は見えたまま少し暗く（brightness 0.85）し、**口の上**（`.onlybox` と同じ側。中身のマスと重ならない）に錠（`.lockbox`：太いつる（stroke 4.5）＋鍵の色の箱に記号）。押すと選べず（選んでいた瓶はそのまま）「かぎの びんは、○○を 1ぽん そろえると あくよ」と deny。開くとき：そろった演出の後、錠（`.lockfly`。瓶に直接つける）が持ち上がって消え、光と音 `unveil`、ヒント「○○が そろって、かぎが あいた！」。動きを減らす設定では一瞬で外して縁取りだけ。
- **はじめて出た面**：まだ見ていない仕掛け（ちいさい→いろ きまり→かぎ の順に 1 つ）を面の最初のヒントにし、その瓶を光らせる（`#board[data-gim-tip="small|only|lock"]`）。**最初の 1 手を指した時**に `irobin.small`・`irobin.only`・`irobin.lock` に `"1"`（出した瞬間でなく。開き直しても、まだ 1 手も指していなければ同じ説明が出る）。いろ きまりの説明は「くちの しるしと おなじ いろ だけ はいるよ」。
- 遊び方カード：もう出てきた仕掛けだけ、4 項目目に 1 文ずつ（`li.gimhelp`）。40 面までは今までどおり 3 項目。縦は 16px のまま。横で背が低いとき（max-height 500px）は 14px、とくに低い（340px 以下。SE 横）ときだけ 13px・すき間 1px に詰めて、4 項目でもスクロールなしで収める。
- テスト用 `setState` は `cap`・`only`・`lock` をそのまま渡す。

### 19.5 保存

- 形は **v:3 のまま**。仕掛けの状態は手（瓶の id）を `replay` すると決まる（BL19：41・71・101・104・150 面の途中保存で同じ局面）。
- 仕掛けが入った面（41 面など）の v36 の途中保存：面の作りが変わったので、手が新しい面で当てはまらなければ今までどおり `replay` が失敗して、その面の最初から（main.js の `buildHistory`）。当てはまれば、その局面は新しいルールで作った局面。面番号・ベストはそのまま。

### 19.6 測った値（2026-10-24、ロジック担当。Node、実際の面、ゆるい遊び方は 1 面 20 回、わな手は解の道の各局面でソルバー 3,000 局面まで）

| 帯 | わな手の割合 前→後 | クリアの割合（ゆるい遊び方）前→後 | 仕掛けの面 |
|---|---|---|---|
| 40–49 | 13.4 → **13.7%** | 7.0 → 6.0% | 2/10 |
| 50–69 | 10.1 → **14.9%** | 14.0 → 5.5% | 14/20 |
| 70–99 | 13.5 → **16.1%** | 11.5 → 5.5% | 23/30 |
| 100–149 | 12.5 → **17.3%** | 17.3 → 7.1% | 44/50 |
| 150–200 | 12.5 → **18.5%** | 11.0 → 3.4% | 45/51 |
| 201–400 | 13.6 → 18.5% | 13.0 → 4.8% | |
| 401–1000 | 12.6 → 18.2% | 12.5 → 2.6% | |

- わな手の割合は帯ごとに段々に上がる（BL20 が 40〜200 面で確かめる）。どの帯も前より下がらない。解の長さの中央は 33〜34 → 35〜37 手。
- 組み合わせごと（40〜400 面に同じ仕掛けを入れて測った平均。布なしの面／布の面）：なし 9.3／16.9%、A1s 12.2／19.5、A1h 16.9／19.5、A2s 16.6／22.0、A2h 20.3、B1s 11.6、B1h 16.4、C1s 12.2、C1h 17.3、A1B1s 15.8、A1B1h 19.9、A1C1s 15.3。soft の面は hard より 4〜5 ポイントやさしい（登場の面に使う）。
- 生成（1〜2000 面）：**全部 fallback 0（作れない面 0）**、調べた局面の最大 30,187（1334 面。v36 は 25,671）、1 面の生成の最大 34.5ms（Node、3 回の一番短い時間。同じ条件で v36 は 28.0ms）。2000 面の合計は v36 の 6.2 秒 → 10.9 秒（1.7 倍。仕掛けが効いている面を選ぶ分。端末で作るのは 1 面ずつなので問題にならない）。かぎの面の最大は 50ms より十分短い（計画の試作の 59ms・作れない面は、かぎの色をその瓶に無い色に限り、候補 1 つの上限を 15,000 局面にして無くした）。
- 布が効いている面（§17.9。25〜600 面の布の面）：65%（187/288。v36 と同じくらい）。

### 19.7 テストと変異

- BL16（ちいさい）・BL17（いろ きまり）・BL18（かぎ）：規則・判定の順・形の検査・ソルバー・イミュータブル。BL19：表・登場の面・1〜2000 面の決まり・41〜600 面が全部作れて解ける・局面の数・仕掛けの無い面は前と同じ・保存。BL20（full）：わな手の割合が帯ごとに上がる。BL5 は「クリアの局面の空き瓶」を、いろ きまりの瓶が届いて消える分だけ少なくてよいに直した。
- BW25（ちいさい）・BW26（いろ きまり）・BW27（かぎ）・BW28（遊び方の行と SE 縦横）。すべて full。
- 変異：MB29（ちいさい びんに 4 段入る）・MB30（短く描かない）・MB31（いろ きまりに ほかの色も入る）・MB32（札を描かない）・MB33（鍵が開かない）・MB34（かぎの びんを押すと選べる）。局面のキーの 3 文字目を落とす変異は作らない（瓶は印ごとに分かれて並ぶので、落としても局面が重ならない）。MB2・MB15・MB16 は置換前の文字を新しいコードに合わせた。

## 20. 詰んだら とける ところまで もどす・同じ動物を並べない・生成の上限（2026-10-24、v39、IB-25・IB-08・IB-12）

ユーザーの言葉（2026-10-24。そのまま引用）：「残件を全て修正して欲しい」。質問への答え：IB-25 は「戻す ボタン (Recommended)」（知らせに「解ける所まで戻す」ボタンを付ける）、IB-24 は「今のまま」。計画：docs/plans/v39-2.md の 1 章。

### 20.1 IB-25：詰んだら「とける ところまで もどす」（R1〜R8）

| 番号 | 決めごと |
|---|---|
| R1 出すとき | 注いだあと（`afterPour`）に、(a) **詰み**（`stuck`）になったとき、(b) **詰み予備軍**（`doomed`）に**なった最初の 1 回**に、知らせのカード（`overlayKind = "rescue"`。`showRescue`）を出す。出すのは次のひと区切り（`later(…, 0)`）。そのときに遊び方を開いている・裏に回っている・局面が変わっている（すぐ次の手を指した）なら**取りやめ**、`rescueOwed` を残して、**予備軍のまま次に注いだ手のあと**に出す（取りやめのままにしない）。開き直し・1手もどす・setLevel のあとの `checkDoomed` では出さない（今どおりヒントとお助けの目印だけ） |
| R2 カード | 見出し：詰み「うごかせる びんが ないよ」、予備軍「もう ぜんぶは とどけられないよ」。本文「とける ところまで もどす？」。ボタンは主「とける ところまで もどす」（`data-cmd="rewindYes"`、primary・先に並べる）と「このまま つづける」（`data-cmd="close"`）。`.btns`・`.cta`（44px 以上）。出た直後 400ms（`CARD_LOCK_MS`。`cardShownAt`）は押せない（overlay の click の判定は `clear` と `rescue`）。`render.pause()` で出し、閉じたら `resume`（確認カードと同じ） |
| R3 このまま つづける | カードを閉じるだけ。ヒント（`HINT_STUCK`・`HINT_DOOMED`）とお助けの `data-attention="1"` は今どおり。Esc・閉じる命令（input の `close`）も同じ |
| R4 戻し先 | 今の手の数を n とし、k＝n−1 から 1 まで新しい方から `L.solve(history[k], { nodeLimit: 3000 })` を流し、**最初に `solved: true` になった k**（解ける最後の局面。`rewindTarget`）へ戻す。`exhausted`（言い切れない）は解けない扱いで続ける。調べた局面の合計（`r.nodes`）が `REWIND_BUDGET`＝30,000 を超えたら、または見つからなければ k＝0（面の最初。生成で解けると確かめ済み） |
| R5 戻したあと | `doRewind`：`flush()` を先に呼び、`state = history[k]`、`history.length = k`、`moves.length = k`、`selected = null`、`doomed = false`、`render.update`、`save()`、`hud()`、音 `undo`、`setPhase(restPhase())`、`checkDoomed()`、`renderTools()`、ヒント「ここからなら ぜんぶ とどけられるよ」（`HINT_REWOUND`）。setState の最初（k＝0）へ戻したときだけ `idleHint()`（解けるとは限らないため） |
| R6 setState の局面 | `custom` のとき：詰み（stuck）だけ R1 が出る（予備軍は調べないので出ない）。戻し先も R4 と同じ探し方（解ける所が無ければ k＝0＝setState の局面） |
| R7 変えないもの | 「1手もどす」（`undo`。変異 MB9 の置換元）・`checkDoomed`（MB11 の置換元）・保存の形・効果音の名前（新しい音は足さない）・デバッグ命令 |
| R8 テスト用 | `getState()` の `overlay` が `"rescue"`。`window.IrobinGame` に新しい関数は足さない（カードのボタンを押して確かめる） |

- IB-24（面クリアから次の面へのテンポ）は、ユーザー決定 2026-10-24「今のまま」で**直さない**。

### 20.2 IB-08：2 つの枠に同じ動物が並ばない

- 原因（事実）：`animalFor` は注文の番号だけで決まり、6 人ごとに同じ並びに戻る。片方の枠のお客さんが長く待つと、離れた番号の人と並ぶ。1〜600 面の解の道で、2 人いる 20,545 局面のうち 188 局面・87 面で並んだ（115 面は注文の 2 番目と 7 番目がどちらも ペンギン）。
- logic（`animalFor(level, orderIndex, otherIndex?)`）：2 引数のときの結果は前と同じ（BL21 の指紋 `0fab5405`）。3 引数のとき、**先に来た方（番号が小さい方）はそのまま**、あとの方が同じ動物なら perm の次の動物。壊れた値（`NaN`・`-1`・`'x'`・`{}`・`Symbol()`・`1e12`）でも例外なし。
- render（画面側）：`animalKind(lv, color, other)` が `other`（もう 1 つの枠の色）の注文の番号を `animalFor` の 3 番目に渡す。`setCustomer(i, color, lv, other)` は、(1) 同じ人（色が同じで動物が決まっている）は気分だけが変わっても動物を決め直さない、(2) **もう 1 つの枠に いま見えている お客さんと同じ動物なら次の動物にする**（`nextAnimal`。ずらされた人が待っている間に新しい人が来ても並ばない）、(3) その面で一度見せた動物を `seenKind`（注文の番号 → 動物。画面の中だけ・新しい面や局面で空にする）に覚え、もどしても動物が変わらない。並べ直し（`aligned` でないとき）は `build(state, { orders: orders.slice(), keep: true })` で**面の最初の注文の順を引き継ぐ**（作り直すと番号がずれて動物が変わるため）。logic が読めないときの予備は今のまま（同じ動物が並んでもよい）。
- 開き直したとき、先に来た方がもう帰っていれば、あとの方は本来の動物で出る（並ばないので問題ない）。保存の形・logic の判定は変えない（動物は見た目だけ）。

### 20.3 IB-12：生成の上限を半分に

- `GEN_NODE_BUDGET` 200000 → **100000**、`RESERVE_FALLBACK1` 50000 → **20000**（表どおりの段の上限 145,000 → 75,000）。`RESERVE_FALLBACK2` 5000 は変えない。
- 測った値（Node、計画担当）：700〜800 局面/ms。1〜9,000 面・100,001〜103,000 面の最大は **58,457 局面（4774 面、86ms）**、ほかは 34,000 以下。全部 fallback 0。**1〜7,500 面・100,001〜102,000 面で面が 1 つも変わらない**（瓶・注文・枠・fallback が前と同じ）。1334・4774・100878 面の `[bottles, slots, queue]` の指紋は前も後も `9852e4a9`（局面の数 30187・58457・33173）。最悪の止まりは半分になった。

### 20.4 テストと変異

- **BL21**（smoke）：1〜600 面の解の道の 2 人いる各局面で、`animalFor(lv, i0, i1) !== animalFor(lv, i1, i0)`（直す前は 188 局面）。番号が小さい方は 2 引数と同じ。2 引数の結果が v38 と同じ（500 個の指紋 `0fab5405`）。3 番目が壊れた値でも例外なし。
- **BL22**（smoke）：`GEN_NODE_BUDGET === 100000`。1334・4774・100878 面の指紋 `9852e4a9`・局面の数 30187・58457・33173（どれも上限以内）・fallback 0。
- **BW29**（full）：詰み・予備軍の最初の 1 回だけカードが出る（見出し・ボタン・44px 以上・出てすぐは押せない）。押すと解ける最後の局面（それより先はどれも解けない）へ戻る（保存も同じ・開き直しても同じ）。「このまま つづける」は閉じるだけ。setState の詰みでも出る。SE 縦・横で収まる。
- **BW30**（full）：115 面と 68 面（ずらされた動物が見えている間に新しい人が来る面）を solution で遊び、2 人いる各局面で `#cust0Text`・`#cust1Text` の動物の名前が違う（直す前は 2 番目と 7 番目がどちらも ペンギン）。
- **BW7・BW16（直した）**：詰み・予備軍で rescue カードが出るようになったので、カードが出たことを確かめて閉じてから、今までの確かめを続ける。**確かめの基準は変えていない**。
- 変異：**MB35**（あとから来たお客さんが同じ動物でも ずらさない。BL21・BW30 が検出）・**MB36**（生成の上限を 200000 に戻す。BL22）・**MB37**（とける ところまで もどす が 1 手しか戻らない。BW29）・**MB38**（もう 1 つの枠に いま見えている動物を避けない。BW30）。MB35 は BL21 だけで検出（BW30 では検出しない。画面側の避けがあるため）。

## 21. 動物を軸にした第 1 弾（2026-10-25、v41、IB-33・IB-24・IB-31・IB-32。ここが §3.2・§17・§20 より優先）

ユーザーの言葉（そのまま）：「第1弾を進めて」「はいそれで計画を立案してください。」。答え：共有ボタン「★3と節目だけ (Recommended)」、共有の文「計画のまま」、回数を測る「測らない」。布の瓶は 5 面から・節目は 5 面ごと・OGP の絵はゲームの絵の部品で組む（おすすめで決定）。あとでユーザーが「先にほし砕きの修正をお願い」と指示したため、ほしくだきの直しを v40 として先に公開し、このいろびんの第 1 弾は **v41** で公開する（2026-10-26 に公開）。計画書は docs/plans/v40.md（ファイル名はそのまま）。

### 21.1 測った値と保存への影響（Node、ゆるい遊び方 1 面 400 回）

- 布の瓶を **5 面から**。面が変わるのは **5・6・7 面だけ**（1〜2000 面の瓶・注文・枠・解の手を比べた）。5 面＝入門の布（中身あり・cover 1）で勝率 100%→79%、6・7 面＝空き瓶の布（`clothEmpty` 1）で 6 面 86→85%、7 面 75→100%。8 面は生成された面が前と同じ。4 面・8 面より先は何も変わらない。
- 課題の文の「1〜7 面のゆるい勝率 90% 以上」は v39 でも 6 面 86%・7 面 75% で満たしていなかったので、物差しを「1〜7 面の平均が前より下がらない」に置き直した（前 93.7%・後 94.1%）。
- 保存：形は変えない（`irobin.best`・`irobin.cloth` はそのまま）。5〜7 面の**途中**で保存していた人は、手の再生が合わず、その面の最初から始まる（落ちない）。版の知らせは出さない。
- 回数は**測らない**（ユーザー決定 2026-10-25）。共有のリンクに `?from=share` などの印も付けない。

### 21.2 IB-24：節目 `milestoneFor`（M1〜M6）と NEWS

| 番号 | 決めごと |
|---|---|
| M1 節目 | `MILESTONE_EVERY = 5`。面 n をクリアしたとき `n % 5 === 0` が節目 |
| M2 返す形 | `milestoneFor(level) → { level: n, milestone, next: n+1（n が MAX_SAFE_INTEGER なら n）, news: null \| { at, kind }, more: boolean }`。n は `normLevel`（壊れた値は 1）。凍結した物を返す |
| M3 news | 節目のときだけ、`NEWS` の中で `n < at && at <= n + 5` の最初のもの（NEWS は at の小さい順）。面の番号で回さない（MAX 近くで終わらなくなるため） |
| M4 NEWS | `[[CLOTH_INTRO_LEVEL,"cloth"],[6,"colors"],[10,"colors"],[12,"hidden"],[15,"colors"],[25,"colors"],[40,"hiddenAll"],[SMALL_FROM,"small"],[ONLY_FROM,"only"],[KEY_FROM,"key"]]`。表を変えたら一緒に直す（BL23 (d) が見る）。**`[CLOTH_INTRO_LEVEL, "cloth"]` は 5 面より前に節目が無いので、実際には出ない**（表を一貫させるために残してある） |
| M5 more | `n < KEY_FROM`。101 面より先の節目は `more: false` で、カードは静かな 1 行 |
| M6 例 | 5→`{at:6,"colors"}`、10→`{at:12,"hidden"}`、15→null・more true、20→`{at:25,"colors"}`、35→`{at:40,"hiddenAll"}`、40→`{at:41,"small"}`、70→`{at:71,"only"}`、100→`{at:101,"key"}`、105→null・more false、4→`milestone:false, news:null` |

- テンポ（お祝い 900ms＋カード 400ms）は「ユーザー決定 2026-10-24『今のまま』」で変えていない。

### 21.3 ヒント

- 1・2 面の最初：「うえの どうぶつさんが ほしい いろを、1ぽんに 4つ あつめよう」。「1ぽんに 4つ」は字の間に U+2060（幅 0 の結合）を入れて途中で折れないようにしてある。動物の名前は出さない。
- 布のヒント：**5 面（`CLOTH_INTRO_LEVEL`）だけ**長い文「ぬのの びんは なかが みえないよ。おきゃくさんに とどけると ぬのが とれるよ」。ほかの面は「おきゃくさんに とどけると ぬのが とれるよ」。横で背が低いときは「とどけると ぬのが とれるよ」。布の瓶を押したときの文は変えない。

### 21.4 クリアカード

- 並び（上から）：h2 →★→ `div.served`（届けた動物の顔の列）→ `p.moves` →記録の行 `p.best-new` →予告の行 `p.next-note` →`.btns`。共有の知らせ `p.share-note` は **`.btns` の最初の子で `position: absolute` の吹き出し**（場所を取らないので「つぎの めんへ」が動かない。空のときは `visibility: hidden`。押すと閉じる）。ボタンは「つぎの めんへ（primary）→ メニューへ → ともだちに おしえる（共有があるときだけ。枠だけ）」。ボタンの間は 12px 以上。
- 動物の列：render.js の `animalsSeen()`（画面で見せた動物。見せていない番号は null）を main が `animalFor(level, i)` で埋める。canvas 28×28px、`role="img"`、`aria-label`「とどけた おきゃくさん：…」（showCard のあとに直接入れる）。**開き直した面の動物の列は推定**（開く前に帰ったお客さんは `animalFor(level, i)` の 2 引数で埋めるため、IB-08 でずらされた人だけ、画面で見た動物と違うことがある）。**小さい画面（`max-height: 700px` 以下）では動物の列を隠す**。動物は共有の文に残る。
- `p.moves`：「N かい そそいで とどけたよ」と「（めやす N かい）」の 2 つの span。それぞれ途中で折り返さない。

記録の行（`const showRecord = c.improved && c.milestone;`。変異 MB41 の置換元）：

| 条件 | 記録の行 | 音 |
|---|---|---|
| 節目で記録が伸びた | 「あたらしい きろく！」 | `best` |
| 節目でない面で記録が伸びた | 「ここまで ○めん」（`.quiet`。本文色・ふつうの太さ・14px） | なし |
| 伸びていない | 出さない | なし |

予告の行（節目だけ。「？」を使わない）：

| kind | 文 |
|---|---|
| cloth | ぬのの びんが でるよ |
| colors | いろが ふえるよ |
| hidden | かくれた いろが でるよ |
| hiddenAll | かくれた いろが ふえるよ |
| small | ちいさい びんが でるよ |
| only | いろ きまりの びんが でるよ |
| key | かぎの びんが でるよ |

- 組み立て：`news.at === next` →「つぎは ${next}めん。${文}」、`at > next` →「つぎは ${next}めん。${at}めんで ${文}」。`news` 無しで `more` →「つぎは ${next}めん。${動物の名前}さんが まってるよ」。`more` でない →「つぎは ${next}めん」だけ。

### 21.5 IB-31：「ともだちに おしえる」

- 出す条件：`star === 3 || c.milestone`。それ以外のカードには共有ボタンも `share-note` も置かない。
- 文（ユーザー決定「計画のまま」）：「いろびん ${level}めん クリア！ ${★}」の次の行に「${動物の絵文字を並べて} に とどけたよ（${手数}かい）」。絵文字：くま🐻 うさぎ🐰 ねこ🐱 ペンギン🐧 りす🐿️ ひつじ🐑。URL は `SHARE_URL = "https://harutonatu.github.io/game-no1/games/irobin/"`。**印（`?from=share` など）は付けない**。個人の情報は入れない。
- 押したとき：**click の中で同期に呼ぶ**（`await` やタイマーをはさむと iPhone では「人が押した」扱いが切れる）。`navigator.share` があればそれ。`AbortError`・`InvalidStateError` は何もしない。ほかの失敗はコピーを試さず、知らせに「この あどれすを コピーしてね」と URL を見せる（押すまで残る）。`navigator.share` が無く clipboard があれば `writeText(文 + "\n" + URL)`。成功したらボタンの文字を 3 秒「コピーしました」にして、知らせは「LINE などの にゅうりょくらんを ながおしして はりつけてね」（ボタンの文字が戻るのと同時に 3 秒で消える）。失敗の文は「コピーできなかったよ。ながおしで コピーしてね」と URL（押すまで残る）。知らせは `user-select: text`・16px 以上。
- 二重押しは `sharing` の印で防ぐ。**`sharing` は `showClearCard` でも false に戻す**。カードは閉じない。外への通信はしない。
- 横向き（背が低いとき）のボタンは 1 行目「つぎの めんへ」「メニューへ」、2 行目「ともだちに おしえる」を幅いっぱい。BW23 の基準は変えていない。

### 21.6 IB-32：description・OGP

- いろびん（`games/irobin/index.html`）とメニュー（`index.html`）の `<title>` より前（DG1 を崩さない）に `description`・`og:*`・`twitter:card=summary_large_image` を入れる。いろびん：「広告なし・登録なし。どうぶつが ほしい いろの…」、og:title「いろびん｜どうぶつに いろみずを とどける パズル」。メニュー：「指で あそぶ 12こ の ゲーム。広告なし・登録なし。…」（12 は `GAMES` の数。L12 が合うか見る）。
- 絵（`icons/og-irobin.png`・`icons/og-menu.png`、1200×630、1 枚 300KB 以下）は `tests/og/og.html`＋`node tests/og/make.mjs` でゲームの絵の部品から作る。**`sw.js` の `APP_FILES` には入れない**（絵は SNS や LINE の機械が読むだけで、オフラインで遊ぶのに要らない。入れると全員が更新のたびに余分に落とす。`tests/og/` も入れない）。版は上げる。

### 21.7 テストと変異

- 直した：BL6（布の無い面を 3・4・27 面に）・BL13（5〜24 面に布・5 面は中身ありの入門）・BL19（5〜7 面を除いた 69 面の指紋 `4c324cd0`）・BW5（4 面で測る）・BW16・BW29（予備軍を探す面を 4 面に）・BW18（文を「ぬのが とれる」に）。基準は変えていない。
- 新しい：BL23（節目と NEWS。smoke）・BL24（5〜7 面の布と指紋 `ceb50cdd`／`c5a4728b`。smoke）・BW31（ヒント・動物の列・共有・狭い画面。smoke）・BW32（記録の出し方・予告・テンポ。smoke）・L12（メニューといろびんの head・絵。smoke）。
- BL23 (d) の `hiddenAll` の決め方：「前の面も隠れで、そこから 200 面まで全部が隠れになる最初の面」（答えは 40 面）。
- 変異：**MB39**（はじめての布が 8 面のまま。BL13・BL24）・**MB40**（毎面が節目になる。BL23・BW32）・**MB41**（「あたらしい きろく！」が毎面に出る。BW32）。
