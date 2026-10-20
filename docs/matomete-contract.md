# まとめてポン — 部品どうしの約束（契約書）

3人の担当（ロジック・画面・組み込み）が同じ約束のもとで**並列に**作るための1枚紙です。実装後は tests/design.md に取り込むか削除します。

ユーザーの決定（2026-10-20、そのまま引用）：
- 「さめがめ、先に作りますか・・・」（PM の「さめがめを先に作るのがおすすめ」への返事）
- 名前：「まとめてポン (Recommended)」
- 操作：「2回タップで消す (Recommended)」
- 盤：「１０×２０ではどうでしょう？縦長に合わせる形です」

元になった遊び：さめがめ（SameGame。元祖は 1985年の『Chain Shot!』）。調査の要点は docs/game-plan.md。**ルールだけを参考にし、名前（さめがめ・鮫亀・SameGame・Shark Turtle）・絵・音・文言は使わない**。

## 1. ルール（ロジックの正）

- 盤は **横 10 列 × 縦 20 行**（`COLS = 10`、`ROWS = 20`）。マスには色 id（0〜）か空（`null`）。
- 色の数：ふつう **4色**、むずかしい **5色**（`MODES = { normal: 4, hard: 5 }`）。最初は全マスが埋まっている。
- **かたまり**：上下左右（斜めは数えない）でつながった同じ色のマスの集まり。**2個以上**なら消せる。1個は消せない。
- **消す**：かたまりのマスを全部空にする → 各列で上のマスが下へ落ちる（すきまを詰める）→ **全部空になった列は、右の列が左へ詰める**（盤の左下へ寄る）。
- **点数**：1回で n 個消すと **(n−2)²** 点（2個は 0点、3個は1点、10個は64点）。
- **全部消し**：盤が空になったら **+1000** 点。
- **終わり**：消せるかたまり（2個以上）が1つも無くなったら回が終わる。残りのマスの数を出す（少ないほどよい、の目安。点数には足さない）。
- **1手もどす**：何回でも（回の最初まで）。もどしても点数は戻る。ベストは「回が終わったときの点数」で記録する。
- **毎回少し違う**：盤は種つきの乱数（mulberry32）で作る。種は回を始めるときに main が決め（`Date.now()` など）、保存する。同じ種なら必ず同じ盤。

## 2. ファイル構成と担当

| 担当 | 編集してよいファイル | 中身 |
|---|---|---|
| A ロジック | `games/matomete/logic.js`（新規）、`tests/cases/matomete-logic.mjs`（新規。QL） | 盤・かたまり・消す・落下・左詰め・点数・終わり・保存の検証（純粋な計算だけ）と、その Node テスト |
| B 画面 | `games/matomete/index.html`・`render.js`・`input.js`・`main.js`（新規） | DOM と CSS、描画と演出、タップとキーボード、つなぎ込み・保存・画面遷移・テスト用 API |
| C 組み込み | ルートの `index.html`（`GAMES`・`ART`・ベスト表示の関数の追加のみ）、`sw.js`（`APP_FILES` 追記・`CACHE_VERSION`）、`common/version.js`、`common/sfx.js`（追記のみ）、`tests/cases/matomete-ui.mjs`（新規。QW）、`tests/run.mjs` の `GROUPS` 追記、`tests/mutants/mutate.mjs`（MQ 追記）、`tests/design.md`・`tests/README.md`（追記）、既存テストの「ゲーム一覧」に関わる最小限の直し、`docs/game-plan.md`・`docs/issues.md` への追記 | メニュー・事前キャッシュと版・効果音・画面のテスト・変異テスト・文書 |

- 表にないファイル（CLAUDE.md・ほかのゲーム・この契約書）は編集しない。契約を変えたいときは PM に言う。
- 読み込み順（B が index.html に書く）：`<title>` の直後に `../../common/debug.js`（テスト DG1）、本文の最後に `../../common/sfx.js` → `logic.js` → `render.js` → `input.js` → `main.js`。
- ファイルは LF・UTF-8。相手の部品がまだ無くても、この契約書だけを見て作る（仮のコードはコミットしない）。
- テストを流す PORT：A は Node だけ（必要なら 8600）、B は 8800、C は 8900、変異は 9900。

## 3. ロジックの API（`games/matomete/logic.js`、担当A）

UMD で `window.MatometeLogic` と Node の `module.exports`。DOM・時計・`Math.random`・localStorage にはさわらない。状態はイミュータブル（毎回新しいオブジェクト。凍結してよい）。例外を外へ出さない（おかしな引数は `null` か `invalid`）。

```js
MatometeLogic = {
  NAME: "まとめてポン", COLS: 10, ROWS: 20, MODES: { normal: 4, hard: 5 },
  ALL_CLEAR_BONUS: 1000, MAX_MOVES_SAVED: 200,
  SAVE_KEY_SAVE: "matomete.save", SAVE_KEY_BEST: "matomete.best", SAVE_KEY_BEST_HARD: "matomete.bestHard", SAVE_KEY_HELP: "matomete.help",
  COLORS,   // [{ id, key, name, hex, mark }] 5色。いろびんの Okabe-Ito 系から 5色（orange●・sky▲・green■・yellow◆・pink♥）。記号は色に頼らないため

  makeRng(seed) → () => number
  newGame(seed, mode = 'normal') → state
  //  state = { seed, mode, colors, grid: [[色id|null, ...ROWS 個] ...COLS 個],   // grid[x][y]、x=0 が左、y=0 が下
  //            score, moves, cleared: number(消したマスの数), over: boolean, allClear: boolean }
  //  生成：各マスを乱数で色に。最初から消せるかたまりが1つも無い盤は配り直す（決定的に）
  groupAt(state, x, y) → [[x,y], ...] | []        // そのマスのかたまり（上下左右）。空・範囲外は []。並びは x の小さい順、同じ x は y の小さい順
  scoreFor(n) → number                            // n<2 は 0、それ以外 (n-2)^2
  canRemove(state, x, y) → boolean               // かたまりが2個以上で、over でない
  applyRemove(state, x, y) → { state, outcome }
  //  outcome（消せないとき）：{ kind: 'invalid', reason: 'over'|'range'|'empty'|'single' }（state はそのまま）
  //  outcome（消したとき）：{ kind: 'remove', cells: [[x,y]...], count, color, points,
  //     falls: [{ from:[x,y], to:[x,y] }],        // 列の中で落ちたマス（左詰めの前の座標で）
  //     shifts: [{ from: x, to: x }],             // 左へ詰めた列（空になった列より右）
  //     allClear: boolean, bonus: 0|1000, over: boolean, remaining: number }
  hasMoves(state) → boolean
  remaining(state) → number                       // 残りのマスの数
  replay(seed, mode, moves) → { state, ok, applied }   // moves = [[x,y], ...]（各手の押したマス。消したかたまりの代表＝groupAt の先頭でなくてよい、押した座標）
  makeSave(state, moves) → string                 // JSON.stringify({ v: 1, seed, mode, moves })
  validateSave(raw) → { seed, mode, moves } | null  // 壊れた値・v 違い・seed が 32bit 整数でない・mode が normal/hard でない・moves が配列でない／長さ超過／[整数,整数] でない → null
  validateBest(raw) → number                      // 安全な整数で 0 以上ならその値、それ以外 0
  recordBest(prev, score) → { best, improved }
  validateFlag(raw) → boolean                     // '1' のときだけ true
  colorName(id) → string
}
```

## 4. 画面（担当B）

### 4.1 配置
- 縦長に合わせた盤（10×20）。マスの大きさ = min(使える幅/10, 使える高さ/20)。上にヘッダー（← メニュー・名前・？・♪）、点数（いまの点数・ベスト・残り）、下に「1手もどす」「さいしょから」。
- **横画面**も崩さない（盤の向きは変えない。マスが小さくなる）。マスが 22px 未満になる画面では、ヒントに「たてむきの ほうが あそびやすいよ」を1回だけ出す。
- 盤は1枚の `<canvas>` か要素の並び（B が決める）。**タップの判定は押した座標からマスを決める**（マスが小さくても押せる）。
- 最大の点数の桁（7桁）でも表示が崩れない。ボタンは 44px 以上、文字 12px 以上、ダブルタップ拡大の抑止、どの画面からもメニューへ戻れる。

### 4.2 操作（2回タップ）
- **1回目**：押したマスのかたまりを選ぶ。かたまりを光らせ（ふち・明るさ。動きを減らす設定でも分かる）、かたまりの上に「n こ ＋p てん」の札を出す。
- **2回目**：選んでいるかたまりの中のどこかをもう一度押すと消える。別のかたまりを押したら選び直し。盤の外・空のマスを押したら選びをやめる。
- 1個だけのマス：選べない。軽く揺らして（動きを減らす設定では揺らさない）ヒント「2こ いじょう つながると けせるよ」、音 `deny`。
- キーボード：矢印でカーソル（マスのふち）を動かす、Enter・Space で選ぶ／消す、Esc で選びをやめる、U で1手もどす、M で音、? で遊び方。
- 演出中に押したら、演出を終わらせてから判定する（いろびん IB-01 と同じ）。

### 4.3 演出（気持ちいい所を作り込む）
- 消える：かたまりが一瞬ふくらんでから「ポン」とはじけて粒が散る。数が多いほど粒が多く音が高い（`pop(n)`）。10個以上は画面が少しだけ光る。
- 落ちる：上のマスがストンと落ちる（短く。0.2 秒前後）、左詰めはすっと寄る。動きを減らす設定では一瞬。
- 全部消し：大きなお祝い（`allclear` の音、+1000 が大きく出る）。
- 終わり：結果カード（点数・ベスト更新・残りのマス・「もういちど」「むずかしい／ふつう」切り替え・メニューへ）。カードが出た直後 0.6 秒は押せない（連打の誤タップ防止）。

### 4.4 DOM 契約（C のテストが使う）
- `#board`（盤。`data-cols="10" data-rows="20"`）、`#score`、`#best`、`#left`（残りのマス）、`#hint`（`aria-live="polite"`）、`#undoBtn`、`#restartBtn`、`#helpBtn`、`#soundBtn`、`#back`、結果カード `#overlay`（`role="dialog"`、`aria-labelledby`）と `#againBtn`・`#modeBtn`・`#menuBtn`。
- 選んでいるとき `#board[data-selected="n"]`（n＝個数）、いないとき属性なし。

### 4.5 テスト用の公開 API（B が作り、C が使う）
`window.MatometeGame = { state(), tapCell(x, y), select(x, y), remove(x, y), undo(), restart(mode?), newSeed(seed, mode?), cellRect(x, y) → {left,top,width,height}（画面座標）, isAnimating() }`

### 4.6 保存
- 手を打つたび・回を始めるたびに `matomete.save` に `makeSave`。開いたら `validateSave` → `replay` で再開（`ok:false` なら新しい回）。回が終わったら保存を消してベストを記録（ふつうは `matomete.best`、むずかしいは `matomete.bestHard`）。
- 遊び方：はじめて開いたとき（`matomete.help` が無いとき）だけ自動で出す。3項目以内、SE 縦横でスクロールなしで「わかった」が押せる。

## 5. 効果音（担当C、`common/sfx.js` の追記のみ。ゲーム名 `"matomete"`）
`select`（選ぶ）・`pop(n)`（消える。n が大きいほど明るく高い）・`fall`（落ちる、控えめ）・`allclear`・`over`（終わり）・`deny`・`undo`。共通の `start` `best` `toggle` も鳴る。

## 6. メニュー（担当C）
`GAMES` にカード：名前「まとめてポン」、説明「おなじ いろを まとめて ポン！ たくさん けすほど たかいてん」、url `games/matomete/`、ベスト表示は `matomete.best` が 1 以上なら「Best N てん」、絵はオリジナル（色の玉が積まれた盤）。

## 7. テスト（ID の接頭辞：ロジック **QL**、画面 **QW**、変異 **MQ**）
- QL（担当A）：かたまり（上下左右・斜めは別）、1個は消せない、点数式と全部消しの +1000、落下と左詰め（空の列が複数・真ん中の列）、終わりの判定、同じ種で同じ盤、最初から消せない盤を出さない、replay・保存の検証（壊れた値の一覧）、イミュータブル、例外を出さない、1000 回の乱数プレイで不変条件（マスの数＝残り＋消した数、点数＝各手の和）。
- QW（担当C）：2回タップで消える／1回目では消えない、札「n こ ＋p てん」、1個のマスでヒントと揺れ、別のかたまりで選び直し、落下と左詰めの見た目が state と一致（cellRect）、全部消しのお祝い、終わりのカード（0.6 秒ロック）とベスト記録、1手もどす、再読み込みで同じ局面、壊れた保存で落ちない、SE 縦・横・iPad で盤とボタンが画面内・44px 以上・7桁の点数、キーボードだけで遊べる、動きを減らす設定、メニューのカードとベスト表示、オフライン（APP_FILES）、DG1。
- 変異 MQ（担当C）：斜めもつなぐ、1個でも消せる、点数式 (n-1)²、全部消しボーナスなし、左詰めしない、終わりの判定を逆に、保存の v を見ない、2回目を待たずに1回で消す、など。変異テストは最後の関門で `ONLY=<QL と QW の全項目> M=MQ… node tests/mutants/mutate.mjs both`。

## 8. 左へ詰まる動き（2026-10-20 ユーザー決定）

ユーザーの言葉（そのまま）：「左へ詰まるのを残す案でお願いします」（PM の案「左へ詰まる動きは残し、すっと短く（0.2秒前後）寄せ、寄った列を一瞬光らせて分かりやすくする」への返事）。
§1 の「全部空になった列は、右の列が左へ詰める」はこのまま。画面は 0.17 秒で寄せ、寄った列をほんのり光らせる（画面担当の実装どおり）。
