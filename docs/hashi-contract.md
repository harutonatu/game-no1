# ハシわたり — 部品どうしの約束（契約書）

11人の開発担当が同じ約束のもとで並列に作業するための1枚紙です。実装後は不要になります（tests/design.md に取り込むか削除）。
ピカッと早押しのレビューで見つかった教訓（§13）を、最初から各部品の約束に入れてあります。
ユーザーの決定（2026-10-18）：見た目は夜の池とカエル「ケロ」、落ちても3回まで、ぴったりのご褒美は強め（連続で倍、上限あり）。最初の版に入れる案は docs/game-plan.md「ハシわたりのアイディア」の 1・4・5・6・8・10・17・18・19。

## 1. ねらいと中身

- 1人用。**長押しで草の茎（はし）が のび、離すと倒れる**。茎の先が次のはすの葉に乗れば渡れる。届かない・長すぎると水に落ちる。
- 遊びの核は「どれだけ長く押すか」の1つだけ。時間制限・ログインボーナス・時間で急かす仕掛けは**使わない**。葉の前ではいつまでも待ってよい。
- **見た目**：夜の池。はすの葉（足場）から葉へ、小さなカエル「ケロ」が渡る。棒・忍者・黒い柱など、既存の有名作の見た目は使わない。
- **いのち（3回）**：`LIVES = 3`。落ちたら1つ減る。残りがあれば、ケロは水から顔を出して照れ笑いし（案4）、**今の葉に戻って同じ間にもう一度**挑戦する（葉の並びは変えない）。0 になったら回が終わり、結果カード。
- **点数**：渡るごとに +1。茎の先が葉の真ん中の「ぴったり印」に乗ると `streak`（連続ぴったり）が +1 され、さらにボーナス `perfectBonus(streak) = min(2^(streak-1), 16)`（1→2→4→8→16 で頭打ち）を足す。ぴったりでなければ streak は 0。落ちても streak は 0。
- **惜しい負け方**：落ちたとき「みじかすぎ／ながすぎ」と、届くべき位置をうすい影で見せる（案10）。
- **ガイド点線**（案18、設定でオン/オフ、既定はオフ）：押している間、今の長さで倒したときに茎の先が来る位置を、水面にうすい点線で示す。
- **ゆっくりモード**（案17、設定でオン/オフ、既定はオフ）：茎の伸びる速さが半分。
- **毎回少し違う**：葉の幅と間は、注入できる乱数で作る。
- **フォルダ名**：`games/hashi/`。効果音のゲーム名は `"hashi"`。保存キーは `hashi.*`。

## 2. ファイル構成と担当（衝突しないよう、編集してよいファイルを限定）

| 担当 | 編集してよいファイル | 中身 |
|---|---|---|
| A ロジック | `games/hashi/logic.js`（新規） | 判定・点数・いのち・保存データの検証（純粋な計算だけ） |
| B コース | `games/hashi/course.js`（新規） | 葉の作り方と難しさの段階表（純粋な計算だけ） |
| C 入力 | `games/hashi/input.js`（新規） | 長押しの検知（指・マウス・キーボード）、取り消し |
| D 描画 | `games/hashi/render.js`（新規） | canvas への描画だけ（DOM はさわらない） |
| E 画面 | `games/hashi/index.html`（新規。HTML と CSS だけ。`<script>` は読み込みの行だけ） | DOM・CSS・配置 |
| F 進行 | `games/hashi/main.js`（新規） | 状態の進め方・アニメーション・タイマー・保存・設定・テスト用 API |
| G 効果音 | `common/sfx.js`（追記のみ） | `HASHI` の表と `GAP` への追記 |
| H メニュー | ルートの `index.html`（`GAMES` 配列と `ART` への追加のみ） | カードと絵 |
| I テスト（ロジック） | `tests/cases/hashi-logic.mjs`（新規） | Node で logic.js と course.js を確かめる（HL） |
| J テスト（画面） | `tests/cases/hashi-ui.mjs`（新規）、`tests/run.mjs`（`GROUPS` に2行追記） | 画面の確かめ（HW） |
| K 変異・文書 | `tests/mutants/mutate.mjs`（MH の行を追記のみ）、`tests/design.md`・`tests/README.md`（HL・HW・MH の行を追記のみ） | 変異テストと対応表 |

- 上の表にないファイルは、どの担当も編集しない。
- **版と事前キャッシュ**（`common/version.js` と `sw.js`）は Wave 4 で別担当が触る。Wave 1 の11人は触らない。
- 読み込み順（E が書く）：`../../common/sfx.js` → `course.js` → `logic.js` → `render.js` → `input.js` → `main.js`
- ファイルは **LF・UTF-8** で保存する（CRLF にしない）。

## 3. 座標と定数（全員が共有）

- 世界の座標は**論理単位**。画面に見える横幅は `VIEW_W = 1000`（実際の px への換算は D と F が行う）。
- 葉は `{ x, w }`（左端の x と幅）。ケロの立つ位置は、今の葉の右端。
- 茎は今の葉の右端から伸び、倒れると右向きに水平になる。**茎の先 `tipX = 今の葉の右端 + len`**。

| 名前（logic.js が公開） | 値 | 意味 |
|---|---|---|
| `VIEW_W` | 1000 | 見える横幅 |
| `GROW_PER_MS` | 0.5 | 1ms に伸びる長さ（一定。だんだん速くしない） |
| `SLOW_FACTOR` | 0.5 | ゆっくりモードのときに掛ける |
| `MAX_LEN` | 800 | 茎の最大の長さ |
| `MIN_HOLD_MS` | 60 | これ未満の押下は「うっかりタッチ」として無視（落ちない、いのちも減らない） |
| `PERFECT_HALF` | 10 | ぴったり印の半幅（葉の中心 ±10） |
| `NEAR` | 20 | 落ちたとき、ずれがこれ以下なら「おしい！」 |
| `CAMERA_LEFT` | 200 | 渡り終えたとき、今の葉の右端を画面左から何単位に置くか |
| `LIVES` | 3 | いのちの数 |
| `BONUS_CAP` | 16 | ぴったりボーナスの上限 |

## 4. ロジックの API（`games/hashi/logic.js`、担当A）

UMD で `window.HashiLogic` と Node の `module.exports`（と `globalThis.HashiLogic`）の両方を公開する（ゼンマイさんぽに準じる）。DOM・時計・localStorage にはさわらない。

```js
HashiLogic = {
  VIEW_W, GROW_PER_MS, SLOW_FACTOR, MAX_LEN, MIN_HOLD_MS, PERFECT_HALF, NEAR, CAMERA_LEFT, LIVES, BONUS_CAP,
  SAVE_KEY_BEST: 'hashi.best',

  // 押した時間（ms）→ 茎の長さ。0..MAX_LEN に丸める。NaN・負は 0、Infinity は MAX_LEN
  // opts.slow が true なら GROW_PER_MS * SLOW_FACTOR で計算する
  lengthFromHold(holdMs, opts = { slow: false }) → number
  // 長さ → その長さに必要な押す時間（ms）。lengthFromHold の逆。テストと「ガイド」で使う
  holdForLength(len, opts = { slow: false }) → number

  // ぴったりボーナス：min(2^(streak-1), BONUS_CAP)。streak が 0 以下なら 0
  perfectBonus(streak) → number

  // 新しい回を作る。random: () => number（0 以上 1 未満）を注入できる。既定は Math.random
  createRun({ random }) → state
  // state の形（イミュータブル。毎回新しいオブジェクトと新しい配列を返す）
  //   { platforms: [{x,w}, {x,w}, {x,w}],   // [0]=今いる葉 [1]=渡る先 [2]=その次（先読みの描画用）
  //     score: 0, crossed: 0, perfects: 0, streak: 0, bestStreak: 0,
  //     lives: LIVES, over: false, lastOutcome: null }
  //   最初の葉は x=0。[1] と [2] は HashiCourse.makeNext で作る

  // 茎の長さを確定して判定する
  resolve(state, len) → { state: newState, outcome }
  //   outcome の種類
  //   { kind: 'ignore' }                                   // state.over のとき
  //   { kind: 'cross', tipX, perfect: boolean, gain, bonus, landX, score, streak }
  //       gain = 1 + bonus（bonus は perfect のとき perfectBonus(新しい streak)、そうでなければ 0）
  //       landX = 渡る先の葉の右端（ケロが歩いて止まる位置）
  //       platforms を1つ左へずらし、末尾に makeNext で1つ足す
  //   { kind: 'fall', reason: 'short'|'long', tipX, missBy, near: boolean, score, lives, over }
  //       missBy = 渡る先の葉の近い方の端までの距離（> 0）。near = missBy <= NEAR
  //       lives を 1 減らし、streak を 0 にする。platforms は変えない（同じ間にもう一度）
  //       lives が 0 になったら over = true
  //   判定は閉区間：target.x <= tipX <= target.x + target.w なら cross（端ちょうどは乗れる）
  //   ぴったり：|tipX - (target.x + target.w/2)| <= PERFECT_HALF
  //   len は 0..MAX_LEN に丸めてから使う
  // 落ちたときの「ここまで要った」影の位置：target.x + target.w/2（葉の中心）を render に渡す

  // 画面に出す数。UI で +1・-1 をしない（§13-1）
  hud(state) → { score, streak, crossed, lives }

  // 保存データの検証（メニューの readBest と同じ決まり）
  validateBest(raw) → number
  //   Number(raw) が Number.isSafeInteger で 0 以上なら、その値。それ以外（null・""・NaN・負・小数・Infinity・object）は 0
  recordBest(prevBest, score) → { best, improved: boolean }
  //   improved は score > validateBest(prevBest) のときだけ true（同点は更新しない）
  // 設定の検証：'1' のときだけ true、それ以外は false
  validateFlag(raw) → boolean
}
```

- `resolve` は `state` を変えない（新しい state と新しい配列を返す）。
- `HashiCourse` が無いとき（読み込み順の誤り）は、意味の分かるメッセージ付きの例外を投げる。

## 5. コースの API（`games/hashi/course.js`、担当B）

UMD で `window.HashiCourse` と `module.exports`。

```js
HashiCourse = {
  // 難しさの段階。crossed（渡った回数）で選ぶ。上限の段階で頭打ち
  TIERS: [
    { from: 0,  gap: [80, 220],  w: [110, 160] },
    { from: 5,  gap: [120, 320], w: [80, 130] },
    { from: 15, gap: [160, 420], w: [60, 110] },
    { from: 30, gap: [200, 520], w: [45, 90] }
  ],
  tierFor(crossed) → tier
  // 前の葉の次の葉を作る。gap と w は tier の閉区間で一様乱数、整数に丸める
  makeNext(prev, crossed, random) → { x: prev.x + prev.w + gap, w }
}
```

**公平さの約束（テスト HL で確かめる）**：
- どの段階でも `gap + w <= VIEW_W - CAMERA_LEFT - 40`（= 760）。渡り終えて画面を送ると、次の葉の右端が必ず画面に入る。
- `gap + w <= MAX_LEN`。どの葉にも必ず届く。
- `w >= 2 * PERFECT_HALF + 20`。ぴったり印が葉からはみ出さない。
- random が 0 のときと、1 にごく近い値のときでも、上の3つを守る。

## 6. 入力の API（`games/hashi/input.js`、担当C）

UMD で `window.HashiInput` と `module.exports`。

```js
HashiInput.attach(surfaceEl, { onHoldStart, onHoldEnd, onHoldCancel }, { now }) → { detach(), reset() }
  // now: () => number。既定は performance.now。**event.timeStamp は使わない**（§13-6）
  // pointerdown（マウスは左ボタンのみ）で onHoldStart({ at: now() })。setPointerCapture する
  // pointerup で onHoldEnd({ at: now(), holdMs: at - startAt })
  // pointercancel・lostpointercapture で onHoldCancel({ reason: 'cancel' })
  // マルチタッチ：最初の1本だけを数える。2本目以降は無視。最初の指が離れたら終わり
  // 押しっぱなしのまま reset() されたら、その指は以後数えない（新しく押し直すまで反応しない）
  // touch-action: none を設定する。touchstart/touchmove/touchend・dblclick・contextmenu・selectstart・dragstart を preventDefault する
  // detach で、付けたリスナーと変えたスタイルをすべて元に戻す

  // キーボードの代わり（§13-4）：document の keydown/keyup を見る
  //   Space または Enter の keydown（e.repeat は無視）→ onHoldStart、keyup → onHoldEnd
  //   ボタン・リンク・入力欄にフォーカスがあるときは何もしない（click と二重にしない）
  //   オーバーレイ（#overlay）が開いているときは何もしない
  //   指とキーボードは、先に始めた方だけを数える
  // window の blur で、押している途中なら onHoldCancel({ reason: 'blur' })

HashiInput.createCore(cbs, { now }) → { down(at), up(at), cancel(reason), reset(), get holding() }
  // DOM に依存しない核。テストと HashiGame.holdFor で直接使う
```

- 例外は外へ出さない（ゼンマイの `safe()` に準じる）。
- `holdMs` は必ず同じ `now()` で測った2つの時刻の差にする。

## 7. 描画の API（`games/hashi/render.js`、担当D）

UMD で `window.HashiRender`。

```js
HashiRender.create(canvas) → { resize(), draw(view) }
  // view = {
  //   platforms, cameraX,
  //   hero: { x, y, pose },          // pose: 'stand'|'walk'|'hop'|'fall'|'peek'（peek=水から顔を出して照れ笑い、案4）
  //   bridge: { len, angle },        // angle: 0=縦に伸び中、Math.PI/2=倒れ終わり。落ちるときはさらに倒れる
  //   perfectFx: number|null,        // ぴったりで葉が光って波紋が広がる演出の経過秒（案6）。null で無し
  //   ghostTipX: number|null,        // 落ちたとき「ここまで要った」のうすい影（案10）
  //   guideTipX: number|null,        // ガイド点線（案18）：今の長さで倒したときの茎の先。null で描かない
  //   splash: number|null,           // 落ちた後の経過秒（ぽちゃん）
  //   lives, t                       // lives は描画しなくてよい（HUD が出す）
  // }
  // DOM にはさわらず canvas だけを使う。devicePixelRatio は最大 2（iPhone SE 相当で重くしない）
  // prefers-reduced-motion: reduce なら、波・しぶき・ゆらぎ・跳ねる動きを止める（ゼンマイの calm に準じる）
```

**色**。既存のトークンと合わせ、Okabe-Ito（色覚の違いがあっても見分けやすい配色）から選ぶ。成功と失敗を赤と緑の違いだけで伝えない。

```css
--bg: #1b1f2e;  --panel: #252c41;  --well: #0d111d;  --line: #2f3750;
--ink: #ece6d6; --muted: #9aa1b8;  --accent: #f0a43a; --accent-ink: #231705;
--water: #0f2a3d;     /* 池 */
--leaf: #009e73;      /* はすの葉 */
--leaf-edge: #cfe9df; /* 葉のふち（明度差でも形が分かる） */
--bridge: #e69f00;    /* 草の茎 */
--perfect: #f0e442;   /* ぴったり印（黄）。必ず◆の形で、暗いふち付き */
--hero: #56b4e9;      /* ケロ（空色） */
```

- ぴったり印は◆で描く。成功・失敗は文字（HUD とヒント）と音でも伝える。
- 文字と背景のコントラストは 4.5:1 以上。`--muted` は #9aa1b8（4.5:1 以上になる値）を使う。

## 8. DOM 契約（担当 E・F・J で共有）

```html
<div class="app">
  <header class="head">
    <a id="back" class="back" href="../../">← メニュー</a>
    <h1 class="title">ハシわたり</h1>
    <div class="head-tools">
      <button class="tool" id="helpBtn" type="button" aria-label="遊び方とせってい">？</button>
      <button class="tool" id="soundBtn" type="button" aria-label="効果音" aria-pressed="true">♪</button>
    </div>
  </header>

  <section class="play" id="playView" aria-label="プレイ" data-phase="ready">
    <div class="hud" id="hud">
      <span class="stat"><span class="label">いま</span><b id="score">0</b></span>
      <span class="stat"><span class="label">ベスト</span><b id="best">0</b></span>
      <span class="stat lives" id="livesBox"><span class="label">のこり</span><b id="lives">3</b></span>
      <span class="stat streak" id="streakBox" hidden><span class="label">ぴったり</span><b id="streak">0</b><span>れんぞく</span></span>
    </div>
    <div class="stage-wrap" id="stageWrap" tabindex="0" role="button"
         aria-label="ながく おすと くきが のびる。はなすと たおれる" data-holding="0">
      <canvas id="stage" role="img" aria-label="池と はすの葉"></canvas>
    </div>
    <p class="hint" id="hint" role="status">ながく おして、はなしてね</p>
  </section>
</div>

<div class="overlay" id="overlay" hidden>
  <div class="card" id="card" role="dialog" aria-modal="true" aria-labelledby="cardTitle"><!-- 中身は main.js が作る。見出しに id="cardTitle" --></div>
</div>
```

| セレクタ | 用途 |
|---|---|
| `a#back` | メニューへ戻る。どの画面・どのカードからも見えて押せる |
| `#helpBtn`・`#soundBtn` | 右上の？と♪（44×44 以上）。？は遊び方と設定（ゆっくり・ガイド）のカードを開く |
| `#playView[data-phase]` | `ready`・`growing`・`falling`・`walking`・`scrolling`・`dropping`・`respawn`・`over`・`paused` |
| `#hud`・`#score`・`#best`・`#lives`・`#streak`・`#streakBox` | 表示。値は `HashiLogic.hud(state)` と保存値をそのまま出す |
| `#stageWrap[data-holding="0/1"]` | 長押しを受ける面（キャンバス全体）。押している間は `"1"` |
| `canvas#stage` | 描画 |
| `#hint` | 1行の案内（落ちたときの「おしい！ みじかすぎ」もここ）。2行分の高さに固定し、文言が変わっても配置が動かない |
| `#overlay`・`#card` | 結果・遊び方と設定・一時停止のカード |
| `.overlay [data-cmd="again"/"menu"/"close"/"resume"]` | もう一度・メニューへ・閉じる・つづける |
| `.overlay [data-set="slow"/"guide"]` | 設定の切り替えボタン（`aria-pressed`、44px 以上） |

**CSS の約束**（E）：
- 既存のトークン、フォント、safe-area、ダブルタップ抑止の作りはゼンマイさんぽに準じる。`[hidden] { display: none !important; }`
- `touch-action: none` は `#stageWrap` に敷く（カードは縦スクロールを残す）。
- 本文の文字は 16px 以上、HUD の数字は 20px 以上。ひらがな中心。
- `#score`・`#best` は 16 桁（9,007,199,254,740,991）でもはみ出さない（字を縮める。「…」で省略しない）。
- **横向き（§13-2）**：`(orientation: landscape) and (max-height: 500px)` では、`#hud` を左の縦列に移し、`#stageWrap` が残りを使う。`.head`・`#hud`・`#stageWrap`・`#hint` の矩形はどの向きでも重ならない。
- アニメーションは `prefers-reduced-motion: reduce` で止める。

## 9. 進行（`games/hashi/main.js`、担当F）

### 状態の流れ

`ready` →（押す）`growing` →（離す、`holdMs >= MIN_HOLD_MS`）`falling` → `resolve` の結果で
- `cross`：`walking` → `scrolling` → `ready`（着地でケロが小さく跳ねる `hop`、案8。ぴったりなら `perfectFx`、案6）
- `fall` で `over` でない：`walking`（茎の先まで）→ `dropping` → `respawn`（水から顔を出して照れ笑い `peek` → 今の葉に戻る、案4）→ `ready`
- `fall` で `over`：`walking` → `dropping` → `over`（結果カード）

`holdMs < MIN_HOLD_MS` のとき、またはキャンセルのときは、茎を 0 に戻して `ready` に戻る（落ちない）。`ready` 以外で押しても伸びない。

### アニメーション
- `requestAnimationFrame` の1本だけで動かす。1フレームの経過時間は最大 50ms に丸める。
- `ready` で止まっている間は描き直さない（ガイド・波のゆらぎが要るときだけ低頻度で）。
- 長さは `growing` の間 `L.lengthFromHold(now() - startAt, { slow })` で描き、離したら `onHoldEnd` の `holdMs` で確定する。見えていた長さと判定に使う長さは同じ関数で求める。
- ガイド点線（設定オン時）：`growing` の間 `guideTipX = 今の葉の右端 + 今の長さ` を render に渡す。
- 落ちたとき：`ghostTipX = 渡る先の葉の中心` を、次に押し始めるまで出す。
- 時間の目安：倒れる 0.25 秒、歩く 速さ一定、送る 0.3 秒、照れ笑い 0.8 秒。reduced-motion のときは、それぞれ 0.05 秒以下。

### タイマーの片付け（§13-7）
- タイマーは `later(fn, ms)` だけで作る（`setTimeout` を直接呼ばない）。`later` は id を一覧に記録する。
- `clearLater()` を、もう一度・メニューへ・遊び方を開く・隠れる（`visibilitychange` で hidden）・`pagehide` のときに必ず呼ぶ。
- 回ごとに `runId` を +1 する。`later` のコールバックと rAF は、`runId` が一致するときだけ動く。

### 中断（§13-3）
- `visibilitychange` で hidden、または遊び方カードを開いたとき
  - `growing` なら、押下を取り消す（`input.reset()`、茎は 0、`ready` に戻す。落ちない・いのちも減らない）
  - `falling`・`walking`・`scrolling`・`dropping`・`respawn` なら、`paused` にする。`clearLater()` を呼び、rAF を止める
- hidden から戻ったときは、`paused` なら一時停止カードを出す（`つづける`・`もう一度`・`メニューへ`）。`つづける` で止めた所から続ける。遊び方カードを閉じたときも同じく続ける。
- `pagehide` でベストを保存する。

### 保存と設定
- 点が今のベストを超えた時点で、すぐ `hashi.best` に書く。読むときと書くときは `try/catch` で囲む（保存できなくても遊べる）。
- `hashi.help`：遊び方を一度見たら `"1"`。初回だけ遊び方を自動で出す。
- `hashi.slow`・`hashi.guide`：`"1"` か `"0"`。読むときは `L.validateFlag`。遊び方カードの中の切り替えボタンで変える。
- ゆっくりモードでもベストは同じ `hashi.best` に記録する。

### 結果カード
- 文言の例：見出し「3 わたった！」、本文「ぴったり 2かい」「ベスト こうしん！」（ベスト更新の音は共通の `best`）。
- 1つ目のボタンは「もう一度」（`data-cmd="again"`）。フォーカスもここに置く。2つ目は「メニューへ」。
- カードを出してから 400ms はボタンを押せない（落ちた直後の連打で押し間違えない）。カードを閉じた後 300ms は `#stageWrap` の押下を受けない。

### キーボード（§13-4）
- Space・Enter：長押しの代わり（C の input.js が担当）
- Esc：遊び方を閉じる／一時停止カードの「つづける」
- M：音のオン/オフ（ゼンマイと同じ）

## 10. SFX 契約（`common/sfx.js`、担当G）

`YubiSfx.create("hashi")` を使えるようにする。共通の `start`・`best`・`toggle`・`over`・`tap` に加えて：

```js
const HASHI = {
  grow:   (ratio) => {},  // 伸びる間の極小の「ぷつ」。ratio（0..1 = len/MAX_LEN）が大きいほど少し高い音（案5）。vol 0.02〜0.04
  tip:    () => {},       // 茎が倒れて「ことん」
  land:   () => {},       // 葉に乗った「ぽん」
  perfect:(n) => {},      // ぴったり。n=連続回数（1〜5 で頭打ち）で少しずつ高く
  walk:   () => {},       // 歩く1歩「ぺた」
  splash: () => {},       // 水に落ちる「ぽちゃん」。やさしく、責めない
  peek:   () => {}        // 水から顔を出す「ぴょこ」（軽く、明るく）
};
```

- `GAP` に `grow: 0.05`、`walk: 0.08` を足す。`land`・`perfect`・`splash` には入れない。
- 下の選択式に `game === "hashi" ? HASHI` を1つ足し、冒頭の使い方コメントにも1行足す。
- 既存の部品（mallet・wood・noise・bell など）を使う。音が出せない環境でも、画面だけで遊べること（音は補助）。

## 11. メニュー連携（担当H）

```js
{ name: "ハシわたり", desc: "ながおしで くきを のばして、つぎの葉へ", url: "games/hashi/", best: "hashi.best", art: "hashi" }
```
- `best:` 方式にする（既存の `readBest` が、安全な非負の整数だけを受け付ける。`validateBest` と同じ決まり）。
- `ART.hashi(ctx, w, h)`：池（濃い青）、はすの葉2枚（`--leaf` の楕円＋明るいふち）、その間に倒れかけのオレンジの茎、左の葉に空色の小さなカエル。手描き感は既存の `ART` に合わせる。

## 12. テスト契約（担当I・J・K）

### `tests/run.mjs` の `GROUPS` に追記（PK の後）
```js
{ key: 'HL', title: 'HL ハシわたり 計算ロジック(Node)', file: 'hashi-logic.mjs', weight: { smoke: 0, full: 0 } },
{ key: 'HW', title: 'HW ハシわたり 画面（データ・戻る・画面内・横向き・中断・キーボード・音・オフライン）', file: 'hashi-ui.mjs', weight: { smoke: 8, full: 40 } },
```
（`GROUPS` の実際の形は既存の行に合わせる。形が違えば既存に合わせて読み替える）

### テスト用の公開 API（F が作る）
```js
window.HashiGame = Object.freeze({
  getState(),     // { phase, score, best, lives, streak, crossed, bridgeLen, platforms, overlay, paused, runId, lastOutcome, timers, slow, guide }
                  //   timers = 生きている later の数（片付けの確認用）
  holdFor(ms),    // input の core で down → up を、注入した時刻で行う（ready のときだけ。成否を返す）
  lenToCross(),   // 今の葉で、ぴったりに乗るための長さ（期待値の計算機）
  setRandom(seq), // 次の「もう一度」から使う乱数の列（配列を順に返し、尽きたら最初へ）
  skip()          // 今のアニメーションを終わりまで進める
});
```

### HL（Node、I）
- `lengthFromHold`・`holdForLength` の境界（0・`MIN_HOLD_MS`・`MAX_LEN` ちょうど・超え・NaN・負・Infinity、slow あり/なし）と、互いに逆になっていること
- `resolve`：葉の左端ちょうど・右端ちょうどで cross、外れで fall（short / long）、中心 ±`PERFECT_HALF` で perfect、`missBy` と `near`
- 点数：cross で +1、ぴったりのボーナスが 1→2→4→8→16→16（上限）、ぴったりでない・落ちたで streak 0
- いのち：落ちると 1 減り platforms は変わらない、0 で over、over のあとは ignore
- イミュータブル：resolve の前後で元の state と platforms が変わらない
- コース：random を 0・0.5・0.999999 にして全段階で §5 の公平さを守る。1000 回の乱数で破れない
- `validateBest` が壊れた値（`null`・`""`・`"abc"`・`"-1"`・`"1.5"`・`"NaN"`・`"Infinity"`・`"{}"`・`"1e400"`・`"9007199254740992"`・数値の -1）を 0 にする。`validateFlag`
- `recordBest`：同点は improved=false

### HW（画面、J）
smoke：
- HW1：`lenToCross()` ぶん `holdFor` すると score が 1 以上。`#score`・`#lives` の文字が `getState()` と一致する（§13-1）
- HW2：外れる長さで落ちると lives が 1 減り、同じ葉からやり直せる。3回落ちると `over`、カードに `again` と `menu`。`again` で score 0・lives 3・`ready`
- HW3：`hashi.best` が回の途中で更新される。壊れた保存値で落ちず、0 と表示
- HW4：プレイ中・結果・遊び方・一時停止の、どこからでも `a#back` でメニューへ戻れる

full（smoke に加えて）：
- HW5：SE 縦・SE 横（667×375）・iPad 縦横で、ボタンが 44×44 以上で safe-area 内。`.head`・`#hud`・`#stageWrap`・`#hint` が重ならない。16 桁のベストではみ出さない
- HW6：中断。growing 中に hidden にすると落ちずに `ready`、bridgeLen 0、lives そのまま。walking 中に hidden にすると `paused` で `timers` が 0、visible でカード、`resume` で続く。遊び方を開いたときも同じ
- HW7：キーボード。Space の keydown／keyup で伸びて倒れる。repeat では伸び直さない。ボタンにフォーカスがあるとき・カードが開いているときは反応しない
- HW8：タイマー。落ちた直後に `again` を連打しても、古い回の音（`splash`・`over`）が新しい回で鳴らない。`runId` が進む。カードを出して 400ms 以内の `again` は効かない
- HW9：時計。`page.clock` で 1000ms 押すと bridgeLen が `lengthFromHold(1000)`（±1 フレーム）。ゆっくりモードでは半分
- HW10：効果音。`grow`・`tip`・`land`・`perfect`・`splash`・`peek`・`over`・`best` が鳴る順。音名がすべて sfx.js の表にある
- HW11：`#stageWrap` でのダブルタップが拡大にならない。カードを閉じた直後の連打が下に届かない
- HW12：設定。ゆっくり・ガイドの切り替えが保存され、開き直しても残る。壊れた値で落ちない
- HW13（Wave 4 の後）：`APP_FILES` に `games/hashi/*` がすべて入り、オフラインで開ける。APP_FILES に無ければ**不合格**（skip で合格にしない）

テストは「保存が無い」「要素が無い」ときに合格扱いにしない（空振りの合格を作らない。ピカッと早押しの PK3・PK8 の反省）。

### 変異テスト（K、`MH`）
- MH1 判定の端を開区間にする（端ちょうどで落ちる）→ HL
- MH2 `recordBest` で同点も更新する → HL
- MH3 ぴったりボーナスの上限を外す → HL
- MH4 落ちても lives を減らさない → HL・HW2
- MH5 hidden で押下を取り消さない → HW6
- MH6 `again` で `clearLater()` を呼ばない → HW8

## 13. ピカッと早押しの教訓（最初から入れておく約束）

1. **表示の1ずれ**：画面に出す数はロジックの値をそのまま出す（`hud()`）。UI で `+1` しない。テストは DOM の文字と state を必ず突き合わせる（HW1）。
2. **横向きでの重なり**：横向きで高さが 500px 以下のときの配置を契約に書く（§8）。重なりを矩形で検査する（HW5）。
3. **visibilitychange と「？」**：押下の取り消し・一時停止・タイマーの片付けを契約に書く（§9）。テストは HW6。
4. **キーボード**：Space・Enter で長押しの代わりができる。Esc・M も（§6・§9）。テストは HW7。
5. **色覚**：Okabe-Ito の配色、形（◆）と文字でも伝える（§7）。
6. **時刻の基準**：時刻は注入した `now()`（既定は `performance.now`）だけから取る。`event.timeStamp`・`Date.now` と混ぜない（§6）。
7. **setTimeout の片付け**：`later`・`clearLater`・`runId`（§9）。テストは HW8、変異は MH6。
8. **結果カード直後の誤タップ**：400ms 押せない（§9）。
9. **空振りのテスト**：無いときに合格にしない（§12）。

## 14. 版と事前キャッシュ（Wave 4、別担当）

- `common/version.js` を `v18`・公開する日に、`sw.js` の `CACHE_VERSION` を `v18` にする（3つを一緒に）。
- `APP_FILES` に `./games/hashi/`・`index.html`・`course.js`・`logic.js`・`render.js`・`input.js`・`main.js` を追加する。
- ピカッと早押し（v17、ブランチ feature/pikatto）を先に取り込んでいる前提。

## 15. 共通で守ること（CLAUDE.md §1・§4 より）

- ボタンは 44px 以上、ダブルタップ拡大の抑止、最大の桁数でも表示が崩れない、どの画面からもメニューへ戻れる、保存データが壊れていても落ちない
- 時間制限・ログインボーナス・時間で急かす仕掛けは使わない
- 片手でも遊べる（画面のどこを押してもよい）。ひらがな中心のやさしい言葉
- iOS Safari の制約（AudioContext はユーザー操作の後で有効化、消音スイッチに従う）を守る
- 不具合を直すときは、同じ不具合が他のゲームにもないかを確かめる（横展開）

## 16. ゴール

公開の条件（Chromium の smoke と full、WebKit の smoke）を満たしたら完了。ただし Windows 版 WebKit の A4（AudioContext が無い環境の問題、docs/issues.md の T-01）は除く。実機確認はユーザーが行う。

## 17. 古いページから書き戻さない（2026-10-22、v30、X-20）

ユーザーの承認（2026-10-22。そのまま引用）：「v30 の修正計画を支持します」。課題 X-20：Safari のタブで bfcache（戻る・進むで残しておいたページ）から古いページへ戻ると、メモリ上の古い状態を保存に書き戻す（さいしょからの後や、別のタブで遊んだあとに古い進み具合が戻る）。

| 番号 | 決めごと |
|---|---|
| G1 見張るキー | `hashi.best` と `hashi.stage`（途中の保存は無いが、pagehide でメモリのベストを書くので、古いページがベストを下げないように見張る）。このページが最後に読んだ・書いた生の文字（`seenRaw`）を覚え、自分で書く・消すたびに読み直して覚え直す |
| G2 表に戻ったとき | `visibilitychange`（表）と `pageshow`（persisted の有無によらない）で、見張るキーが覚えた文字と違えば（ほかのページ・さいしょからが書いた）、保存を止めて（`stale`）`location.reload()`。以後のほかの処理（再開・カードのボタン戻しなど）はしない。同じなら今までどおり続ける（開き直さない） |
| G3 保存を止める | `stale` の間は書く・消すを何もしない（開き直す前の pagehide・hidden で古い状態を書かない）。開き直すと「どっちで あそぶ？」から始まる（開いたときと同じ） |
| G4 別のタブ | 裏（`document.hidden`）にいる間に `storage` イベントで見張るキー（または `clear`）が変わったら `stale` にする（閉じても書き戻さない）。表に戻ると G2 で開き直す。見えている間の `storage` イベントは今までどおり（同時に2つ見えているときは後に書いた方が残る。開き直しの往復を起こさないため） |
| G5 変えないもの | 効果音・デバッグ命令・遊び方カード（開き直しても、見たかどうかの保存で決まるので不自然に出ない）。同じページの中で（デバッグ命令 storage・テストで）見張るキーを書くと、次に表に戻ったとき「ほか」と見なして開き直す（その前にゲームが自分で保存すれば覚え直すので開き直さない） |

テスト：HW20（full）。(a) 変わっていなければ pageshow persisted でも開き直さない (b) pagehide persisted → ほかで書く → pageshow persisted → pagehide で書き戻さず、開き直して新しい保存から続ける (c) 裏にいる間に同じ context の別のページが書く（本物の storage イベント）→ pagehide で書き戻さず、表に戻ると開き直す。直す前のコードでは不合格になることを確かめた。
