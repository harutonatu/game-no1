# いろびん — 部品どうしの約束（契約書）

3人の担当（ロジック・画面・組み込み）が同じ約束のもとで**並列に**作業するための1枚紙です。実装後は不要になります（tests/design.md に取り込むか削除）。
ユーザーの承認（2026-10-19）：「はい、ワークフローで」（PM が示した「色水を仕分けるパズル＋上の動物の注文に応えて瓶を片付ける新ゲームを、約束→分担して並列に作る→レビュー→テスト合格後、公開前にユーザーに確認」への返事）。
ハシわたり・ピカッと早押しの教訓（§14）と、課題管理表の W-04〜W-06 を最初から入れてあります。

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
- **届ける**：栓をした瓶の色が、見えているお客さんの注文と一致したら、その瓶はトレイに乗って消え、**同じ場所に空の瓶が置かれる**（片付けると場所が空く＝注文の順番に意味が出る）。そのお客さんは喜んで帰り、同じ枠に `queue` の次のお客さんが来る（列が尽きたら空の枠）。
- **注文を待つ**：一致するお客さんがいなければ、栓をした瓶はその場で待つ（場所をふさぐ）。その色のお客さんが来たら**自動で**届く。
- **処理の順（決定的）**：注ぐ → 相手がそろえば栓 → 届けられるものを届ける。届けた後に来たお客さんに合う待ち瓶があれば、また届ける（連鎖）。同時に候補があるときは、**枠は左（0）から、瓶は番号の小さい方から**。
- **面クリア**：全部の注文に応えた（`served === total`）。
- **詰み**：動かせる手が1つも無く、クリアでもない。そのことを伝え、「1手もどす」「やりなおし」を案内する（ゲームオーバーにはしない）。
- **詰み予備軍（doomed）**：手は残っているが、もう全部は届けられない。注ぎ終わって落ち着いたとき（と、1手もどした後・途中から再開したとき）に `solve(state, { nodeLimit: 3000 })` を1回流し、`solved:false` かつ `exhausted:false`（言い切れた）ときだけ、ヒント「この ままだと ぜんぶは とどけられないよ。「1手もどす」を おしてみてね」とお助けの `data-attention="1"` を出す。phase は idle／selected のまま（新しい phase は作らない）。上限に届いたときは何も言わない。setState の局面は調べない。
- **お助け（無料・回数制限なし）**：1手もどす（何回でも、面の最初まで）、やりなおし（面の最初から。確認カードあり）。

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
| `GEN_NODE_BUDGET` | 200000 | 1面の生成で調べる局面の合計の上限（超えたら易しい側へ） |
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
| 1 | 2 | 1 | なし | `easy` | 遊び方を覚える（瓶 3 本） |
| 2 | 3 | 2 | なし | `easy` | |
| 3 | 4 | 2 | なし | `easy` | |
| 4–5 | 5 | 2 | なし | `easy` | |
| 6–9 | 6 | 2 | なし | `random` | 注文の順番を考え始める |
| 10–14 | 7 | 2 | 12・14 面だけ | `random` | 隠れた色の登場 |
| 15–24 | 8 | 2 | 奇数面 | `random` | |
| 25–39 | 9 | 2 | 奇数面 | `random` | |
| 40– | 9 | 2 | 全部 | `random` | 上限（以後ずっと同じ難しさ） |

- `LEVELS` は上の表を `[{ from, colors, empties, hidden: 'none'|'odd'|'all'|[12,14], order }]` の形で持つ（形は A が決めてよい。公開するのは `paramsFor`）。
- `paramsFor(level) → { colors, empties, hidden: boolean, order: 'easy'|'random' }`。level は 1 以上の安全な整数に丸める（壊れた値は 1）。
- `order: 'easy'`：注文の列を「注文を気にせず解いたときに、そろう順」にする（下の §4 generate）。そのとおりに解けば待ちが一度も起きない＝やさしい。
- `order: 'random'`：注文の列を乱数で並べ、その列のままで解けることをソルバーで確かめる。
- 使う色：`colors` 色を `COLORS` から乱数で選ぶ（面ごとに違う色の組み合わせ）。

## 4. ロジックの API（`games/irobin/logic.js`、担当A）

UMD で `window.IrobinLogic` と Node の `module.exports`（と `globalThis.IrobinLogic`）の両方を公開する（ハシわたりの logic.js に準じる）。DOM・時計（`Date`・`performance`）・`Math.random`・localStorage には**さわらない**（乱数は面番号から作る種で決まる）。

### 4.1 状態の形（イミュータブル。毎回新しいオブジェクトと新しい配列を返し、元を変えない。凍結してよい）

```js
state = {
  level: 7,                        // 面の番号（1〜）
  params: { colors, empties, hidden, order },
  bottles: [                       // 本数は面の中で変わらない（届けた瓶は空の瓶に置き換わる）
    { cells: [2, 2, 5, 1],         // 色 id。下→上。長さ 0〜CAP
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
  //   info = { level, seed, params, tries, nodes, fallback: 0|1|2, solution: [[from,to],...] }
  //     fallback 0＝表のとおり、1＝易しい側（空き瓶 +1・order 'easy'。瓶が MAX_BOTTLES=11 を超えるときは空き瓶を増やさず色を1つ減らす）、2＝固定の予備の面
  //     solution＝この state から解ける手順（テストと、将来のヒント用。画面には出さない）
  //   作り方：
  //     1) 選んだ色を各4段ずつ混ぜ、色の数ぶんの瓶に4段ずつ配る。空き瓶を後ろに足す。
  //        4段同じ色の瓶ができた配り方は捨てる（最初からそろっている瓶は無し）。
  //        hidden の面は、各瓶の一番上以外を hidden にする。
  //     2) order 'easy'：solve(state, { anyOrder: true }) で解き、そろった色の順を queue にする。
  //        order 'random'：queue を乱数で並べ、solve(state) で解けるか確かめる。
  //     3) 解けなければ配り直す（GEN_TRIES 回まで）。合計の局面数が GEN_NODE_BUDGET を超えたら fallback 1、
  //        それでもだめなら fallback 2（logic.js の中に書いた、必ず解ける固定の面）。
  //     4) 最後に replay で solution を再生し、won になることを確かめてから返す。
  //   瓶の並び順も乱数で混ぜてよい（空き瓶が必ず右端、にしない）。

  // ---- 手 ----
  pourCheck(state, from, to) → { ok: true, count } | { ok: false, reason }
  //   reason: 'won'（クリア後）| 'range'（番号が範囲外・整数でない）| 'same'（同じ瓶）| 'empty'（元が空）
  //         | 'sealed'（元か相手が栓をしている）| 'full'（相手に空きが無い）| 'mismatch'（色が違う）
  //   判定の順は上の並びのとおり（テストが reason まで確かめる）
  applyMove(state, from, to) → { state: newState, outcome }
  //   outcome（注げないとき）：{ kind: 'invalid', reason, from, to }   ← state はそのまま（同じオブジェクトを返してよい）
  //   outcome（注いだとき）：
  //   { kind: 'pour', from, to, color, count,
  //     revealed: [{ bottle, index, color }],      // 新しく見えた段（元の瓶の新しい一番上。そろって全部見えた段も含む）
  //     sealed: number|null,                       // そろった瓶の番号（無ければ null）
  //     deliveries: [{ bottle, slot, color }],     // 届けた順（連鎖を含む）。届けた瓶は空の瓶になっている
  //     arrivals: [{ slot, color|null }],          // 来たお客さん（届けるたびに1件。列が尽きたら color null）
  //     won: boolean, stuck: boolean }             // stuck＝注いだ後に動かせる手が無く、won でない
  //   arrivals と deliveries は、起きた順に交互に並ぶ。render はこの順に演出する（§7.3）
  legalMoves(state) → [[from, to], ...]   // 注げる手のすべて（from の小さい順、同じ from は to の小さい順）
  isStuck(state) → boolean                // legalMoves が空で、won でない

  // ---- ソルバー（全部の情報を知っている前提でよい） ----
  solve(state, { nodeLimit = SOLVE_NODE_LIMIT, anyOrder = false } = {})
    → { solved: boolean, moves: [[from,to],...]|null, nodes: number, exhausted: boolean }
  //   applyMove と同じ決まりで探す（注文の順・待ち瓶が場所をふさぐこと・届けると空の瓶になることを含む）。
  //   anyOrder: true のときだけ、そろった瓶をすぐ届けたものとして扱う（generate の 'easy' 用）。
  //   exhausted＝上限に達して打ち切った（solved:false でも「解けない」とは限らない）。
  //   同じ局面を二度調べない（瓶の並びは順不同として正規化したキーで記録してよい）。
  //   むだな手を省いてよい：中身が全部見えていて1色だけの瓶を、空の瓶へまるごと移す手。

  // ---- 再生と保存 ----
  replay(level, moves) → { state, ok: boolean, applied: number }
  //   createLevel(level).state に moves を順に当てる。注げない手が出たらそこで止めて ok:false
  //   （applied＝当てられた数。state はそこまでの状態）
  hud(state) → { level, served, total, left, moves }   // left = total - served。画面に出す数（UI で ±1 しない）
  validateBest(raw) → number
  //   Number(raw) が Number.isSafeInteger で 0 以上ならその値。それ以外（null・""・NaN・負・小数・Infinity・object）は 0
  validateSave(raw) → { level, moves } | null
  //   raw は localStorage の文字列。JSON.parse に失敗・形が違う・v が 1 でない・level が 1 以上の安全な整数でない・
  //   moves が配列でない／長さが MAX_MOVES_SAVED を超える／各要素が [整数, 整数] でない → null
  //   （手が今の面で注げるかは validateSave では見ない。main が replay で確かめ、ok:false なら面の最初から）
  makeSave(level, moves) → string         // JSON.stringify({ v: 1, level, moves })
  recordBest(prevBest, clearedLevel) → { best, improved }
  //   best = max(validateBest(prevBest), clearedLevel)。improved は clearedLevel > validateBest(prevBest) のときだけ true
  validateFlag(raw) → boolean             // '1' のときだけ true

  // ---- 見た目に使う純粋な値 ----
  animalFor(level, orderIndex) → string   // お客さんの動物の種類（§7.2 の ANIMALS の key）。面と注文の番号で決まる
  colorName(id) → string                  // 'オレンジ' など。範囲外は '？'
}
```

- `applyMove`・`createLevel` などは引数の state を変えない（イミュータブル。テスト BL4）。
- 例外を外に出さない：おかしな引数（null の state、文字列の番号など）でも `invalid` か `null` を返す。

## 5. 入力の API（`games/irobin/input.js`、担当B）

UMD で `window.IrobinInput` と `module.exports`。ルール（注げるか）は知らない。

```js
IrobinInput.attach({ board, root = document }, {
  onPick(index, via),     // 瓶が選ばれた。via: 'tap'|'key'
  onCommand(cmd)          // 'undo'|'restart'|'deselect'|'sound'|'help'|'close'
}, { isBlocked = () => false }) → { detach(), focusBottle(index) }
```

- **タップ**：`#board` の `.bottle`（`<button>`）の `click` で `onPick(Number(data-index), 'tap')`。`pointerdown` で選ぶと指がずれた押下まで拾うので、`click` を使う（`touch-action: manipulation` で遅れは出ない）。
- **ダブルタップ拡大の抑止**：`#board` と `.tools` で `touchend`（2回目の素早いタップ）・`dblclick` を `preventDefault`。`gesturestart` も止める。既存ゲームの作り（ゼンマイ・ハシわたり）に準じる。
- **キーボード**（`document` の `keydown`。入力欄・カードが開いているとき〈`#overlay` が見えている〉は Esc 以外を無視）：
  - `←` `→`：フォーカスを左右の瓶へ（端で止まる）。`↑` `↓`：上下の段の瓶へ（render の並びの列数を `board.dataset.cols` から読む）
  - `Enter`・`Space`：フォーカスのある瓶を選ぶ（`<button>` の標準の click に任せ、二重にしない）
  - `1`〜`9`・`0`：その番号の瓶を選ぶ（`0` は10本目、11本目はキーなし）
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
      <button class="bottle" type="button" data-index="0" data-sealed="0" data-selected="0" data-waiting="0"
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
| `.bottle[data-index][data-sealed][data-selected][data-waiting]` | 瓶。`data-waiting="1"`＝栓をして注文を待っている。`aria-label` に番号・中身（隠れは「？」）・状態 |
| `.seg[data-color][data-hidden]` | 段。隠れの段は `data-color` を出さない（`data-color=""`・`data-hidden="1"`）で「？」を描く（DOM から答えが分からないように） |
| `.cork` | 栓（sealed のときだけ見える） |
| `canvas#fx` | 光と粒（ポインターを通す。`pointer-events: none`） |
| `#hint` | 1行の案内。2行分の高さに固定し、文言が変わっても配置が動かない |
| `#undoBtn`・`#restartBtn` | お助け。最初の状態では「1手もどす」は `disabled`。詰み・詰み予備軍のとき、押して意味のあるほうに `data-attention="1"`（目立たせる。disabled の「1手もどす」と手が0の「やりなおし」には付けない） |
| `#overlay`・`#card` | 遊び方・面クリア・やりなおしの確認のカード |
| `.overlay [data-cmd="next"/"menu"/"close"/"restartYes"]` | つぎの めんへ・メニューへ・とじる・やりなおす |

**CSS の約束**（B）：
- 既存のトークン（`--bg #1b1f2e`・`--panel`・`--well`・`--line`・`--ink`・`--muted #9aa1b8`・`--accent`）とフォント、safe-area、ダブルタップ抑止の作りはハシわたりに準じる。`[hidden] { display: none !important; }`
- 瓶のボタンは**幅 44px 以上・高さ 44px 以上**（瓶の見た目は縦長、押せる矩形も同じ）。文字は 12px 以上（V11）、本文 16px 以上。ひらがな中心。
- `#level` は 16 桁（9007199254740991）でもはみ出さない（字を縮める。「…」で省略しない）。
- **配置**：縦向きは上から `.head`・`#shop`・`#board`・`#hint`・`#tools`。**横向き**（`(orientation: landscape) and (max-height: 500px)`）は、`#shop`・`#hint`・`#tools` を左の縦列、`#board` を右。`.head`・`#shop`・`#board`・`#hint`・`#tools` の矩形は、iPhone SE（320×568・568×320）から iPad まで、どの向きでも重ならず画面からはみ出さない（11本の面でも）。
- `prefers-reduced-motion: reduce` で CSS のアニメーションを止める（render も §7.4 で従う）。

## 7. 描画と演出の API（`games/irobin/render.js`、担当B）

UMD で `window.IrobinRender`。状態は変えない（受け取った state を見て描くだけ）。DOM は `#board` の中身・`#shop` の中（canvas・トレイ・`data-*`・`.sr` の文）・`canvas#fx` だけをさわる。

```js
IrobinRender.create({ board, shop, fx }, { calm = false } = {}) → {
  build(state),                 // 面の始めに瓶のボタンを作り直す（本数が変わる）。layout も行う
  layout(),                     // 画面の大きさに合わせて列数と瓶の大きさを決め、board.dataset.cols を書く
  update(state, ui),            // 演出なしで今の状態に合わせる。ui = { selected: number|null }
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
- `mood`：`enter`（下からぴょこっと出てくる 0.35 秒）・`wait`（ゆっくりまばたき。calm のときは止める）・`happy`（目を細めて跳ねる＋ハート 0.6 秒）・`leave`（手を振って下へ 0.3 秒）・`empty`（誰もいない。うすい点線の枠）。

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
5. **届ける**（`deliveries` の順。1件 0.6 秒）：瓶がお客さんのトレイの上へ飛び、小さくなって消える（音 `deliver`）。お客さんは `happy` → `leave`。同じ場所に空の瓶がふわっと現れる。
6. **次のお客さん**（`arrivals`、0.35 秒）：`enter`（音 `arrive`）。待ち瓶への自動の届けは 5 に戻る。
7. 最後に `update(state)` で表示を正にそろえる。

### 7.4 動きを減らす・裏に回す・性能
- `calm`（`prefers-reduced-motion: reduce`、main が渡す）：移動・傾き・揺れ・粒・跳ねをやめ、各段階を 0.05 秒以下の切り替えにする。光の輪は静かな縁取りを 0.3 秒だけ。音は鳴らす。
- `pause()` で Web Animations をすべて一時停止し、rAF を止める。`resume()` で続きから。
- devicePixelRatio は最大 2。粒は最大 48 個。動いていない間は rAF を回さない（iPhone SE 相当で重くしない）。

## 8. 進行（`games/irobin/main.js`、担当B）

### 8.1 状態の流れ
- 起動：`validateSave(localStorage['irobin.save'])` → `replay(level, moves)`。ok でなければ同じ面の最初から（手は捨てる）。保存が無い・壊れているなら、`level = validateBest(best) + 1`（なければ 1）の最初から。初回（`irobin.help` が無い）は遊び方カードを出す。
- `idle` で瓶を押す：注げる中身がある瓶なら `selected`（音 `pick`）。空・栓の瓶はヒントだけ（「からの びんは えらべないよ」「せんを した びんは うごかせないよ」）。
- `selected` で：同じ瓶 → 選ぶのをやめる（音 `drop`、`idle`）。別の瓶 → `applyMove`：
  - `invalid` → `render.deny`、音 `deny`、ヒント（`mismatch`＝「いろが ちがうよ」、`full`＝「いっぱいだよ」、`sealed`＝「せんを した びんには いれられないよ」）、選ぶのをやめる。
  - `pour` → 履歴に積み、保存し、`pouring` で `render.pour`。終わったら `won` なら `clear`、`stuck` なら `stuck`、それ以外は `idle`。
- **先に押せる**：`pouring` の間も瓶を選べる。新しく注ぐときは、前の演出を `render.finishAll()` で終わらせてから始める（速く遊ぶ人を待たせない）。
- `stuck`：ヒント「うごかせる びんが ないよ。『1手もどす』か『やりなおし』を おしてね」、お助けの2つに `data-attention="1"`。音 `stuck`（やさしく、責めない）。
- `clear`：`celebrate()` の後にカード。見出し「N めん クリア！」、本文「M て で とどけたよ」（ベスト更新なら「はじめて クリア！」）。ボタン1つ目「つぎの めんへ」（`data-cmd="next"`、フォーカスもここ）、2つ目「メニューへ」。カードを出して 400ms はボタンを押せない。音 `clear`、更新なら共通の `best`。

### 8.2 お助け
- **1手もどす**：履歴の1つ前の state に戻す（回数制限なし。面の最初まで）。演出中なら `finishAll()` してから。選択は解除。音 `undo`。保存も1手減らす。
- **やりなおし**：手が1つ以上あれば確認カード（「さいしょから やりなおす？」［やりなおす `restartYes`］［やめる `close`］）。手が0なら何もしない。

### 8.3 保存
- 注ぐたび・もどすたびに `irobin.save` へ `makeSave(level, moves)` を書く。クリアしたら `irobin.best` を `recordBest` で更新し、`irobin.save` を次の面・手0にする。
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
                //   bottles・slots・queue は logic の state の写し（JSON にできる形）
  pick(index),  // 瓶を押したのと同じ（onPick と同じ道を通る）。戻り値なし
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
- BL3：そろい・届け・空の瓶への置き換え・待ち瓶が場所をふさぐ・お客さんが来たら自動で届く（連鎖の順）・全部届けて won。outcome の `deliveries`・`arrivals` の順。
- BL4：イミュータブル（applyMove の前後で元の state が JSON で一致）。おかしな引数で例外を投げない。
- BL5：生成。1〜60 面と 1000 面が決定的（2回作って JSON 一致）、各色ちょうど4段、最初からそろった瓶なし、隠れの面は一番上以外が隠れ、`info.solution` を replay すると won。60 面の生成の合計が Node で 3 秒以内、`info.nodes <= GEN_NODE_BUDGET`。
- BL6：ソルバー。解けない小さな盤で solved:false、注文の順のせいで解けない盤（注文なしなら解ける）を正しく解けないと判定、`anyOrder` では解ける。
- BL7：保存の検証。`validateBest`（`null`・`""`・`"abc"`・`"-1"`・`"1.5"`・`"NaN"`・`"Infinity"`・`"{}"`・`"1e400"`・`"9007199254740992"`）→ 0。`validateSave` が壊れた JSON・v 違い・level 0・手の形違い・長すぎで null。`replay` が注げない手で ok:false。`recordBest` で同じ面は improved:false。
- BL8：詰み（`isStuck`・outcome.stuck）。
- BL9：隠れ。注いで一番上になった1段だけが見えるようになる。隠れの段は注ぐ量に数えない。そろうと全部見える。

### 12.3 BW（画面、`tests/cases/irobin-ui.mjs`）
smoke：
- BW1：瓶を2本押して注ぐと、`.seg` の色の並びが `getState().bottles` と一致。`#level`・`#left` の文字が `hud` と一致。隠れの段は `data-color` が空。
- BW2：`solution()` の手順を `pick` で進めるとクリアのカード（`next`・`menu`）。`irobin.best` が更新され、`next` で面 +1・手0。
- BW3：2手注いで再読み込みすると同じ局面。壊れた `irobin.save`・`irobin.best` で落ちず、面 1 から（ページエラーなし）。ほかのゲームの保存キーが変わらない。
- BW4：プレイ中・遊び方・クリア・やりなおしの確認の、どこからでも `a#back` でメニューへ戻れる。

full（smoke に加えて）：
- BW5：SE 縦・SE 横（568×320 と 667×375）・iPad 縦横、11本の面（40 面）でも、ボタンと瓶が 44×44 以上で safe-area 内、`.head`・`#shop`・`#board`・`#hint`・`#tools` が重ならずはみ出さない。16 桁の面番号でもはみ出さない。
- BW6：お助け。1手もどすを手の数だけ押すと最初の局面、最初は disabled。やりなおしは確認カード → `restartYes` で最初から・手0。
- BW7：詰み。`setState` で詰みの局面を作り、1手注ぐと `stuck`、ヒントに「1手もどす」、お助けに `data-attention="1"`。
- BW16：詰み予備軍（doomed）・届けの連鎖が短い（20面の6本で4.5秒以内）・演出中にお客さんを押すと飛ばせる・クリアのカードに「めやす」と★・SE 縦横で遊び方の「わかった」がスクロールなしで押せる。
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
- MB4 届けた後、空の瓶に置き換えない（瓶が消える）→ BL3・BL5
- MB5 注いでも隠れた段が見えるようにならない → BL9
- MB6 ソルバーが注文の順を無視する（いつも anyOrder）→ BL6
- MB7 `validateSave` が手の形を確かめない → BL7・BW3
- MB8 hidden で演出を止めない → BW9
- MB9 1手もどすで2手戻る → BW6
- 置換前の文字列は、実装が固まった後に C が実物から写す（A・B は、置換の目印になる行を変に分けない）。
- 変異テストは最後の関門だけで流す（W-01）。`ONLY=<BL と BW の全項目> M=MB1,…,MB9 node tests/mutants/mutate.mjs both`。

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
