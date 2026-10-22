# ピカッと早押し — 部品どうしの約束（契約書）

6人の開発担当が同じ約束のもとで並列に作業するための1枚紙です。実装後は不要になります（design.md に取り込むか削除）。

**修正版（レビュー後）**：課題 PK-01〜PK-30（[docs/issues.md](issues.md)）を直すために更新した。変わった所には（PK-xx）を付けている。下の用語は内部の名前で、画面に出す言葉は §12 に従う。

**v31 の修正**：PK-31〜PK-37（よーいの見た目、遊び方の言葉、メニューへの確認、設定の説明、キーボード、読み上げ、黄の上の枠）。§5 の「v31 の追加」と §9 の PK19〜PK22 にまとめた。ルール・保存は変えていない。

## 1. ねらいと中身（確定済み）

- 2〜4人が iPad を囲んで遊ぶ早押しゲーム。1人用「お試しモード」（画面では「ひとりで れんしゅう」）も用意する。
- 遊び方は **方式 A**：各プレイヤーに四隅のボタン。合図でボタンが光ったら自分の色をタップ。先に自分の色をタップした人の勝ち。合図前にタップしたらフライング（相手全員に1点）。
- **人数**：2・3・4人（設定画面で選ぶ。最初から2人が選ばれている（PK-18））
- **勝利条件**：先に **3点** 取った人の勝ち。最大5ラウンドで、5ラウンド終わって最高点が同点なら **引き分け**（`winner: 'draw'`）。サドンデスはしない（PK-20、ユーザー決定 2026-10-18）
- **合図**：待ち時間は **1.0〜4.0 秒のランダム**（乱数は `random` を注入して固定できる。seed は持たない（PK-24））。合図はボタンが光る＋効果音1音
- **よーい**：ラウンドを始めるたび（はじめる・つぎへ・つづける）、待ち時間の前に約 1000ms の「よーい」を出す。この間の押下は無視（フライングにしない）（PK-05）
- **一時停止**：裏に回したとき・プレイ中に「？」を開いたときは止める。戻るとそのラウンドをやり直す（点数はそのまま、フライングにしない）（PK-04）
- **フライング**：合図前に**どれかのボタン**を押したら、押した本人以外の全員に1点
- **お試し（1人用）モード**：CPU は作らない。合図から押すまでの時間（ms）を計り、平均を保存。点を競わないので 3点では終わらず、**5回で終わる**（ヒント「全5回」・遊び方「5回で おわり」と一致させる）
- **フォルダ名**：`games/pikatto/`

## 2. ファイル構成と担当（衝突しないよう編集可能ファイルを限定）

| 担当 | 編集してよいファイル | 編集してはいけないファイル |
|---|---|---|
| A ロジック | `games/pikatto/logic.js`（新規） | ほか全部 |
| B 画面・描画 | `games/pikatto/index.html`（新規）、`games/pikatto/render.js`（新規・任意） | ほか全部 |
| C 入力 | `games/pikatto/input.js`（新規） | ほか全部 |
| D 効果音 | `common/sfx.js`（追記のみ） | ほか全部 |
| E メニュー | ルートの `index.html`（`GAMES` 配列と `ART` に追加のみ） | ほか全部 |
| F テスト | `tests/cases/pikatto.mjs`（新規）、`tests/run.mjs`（`GROUPS` に1行追記）、`tests/design.md`（PK グループの行を追記のみ） | ほか全部 |

**版と事前キャッシュ**（`common/version.js` と `sw.js`）は Wave 4 で別担当が触る。Wave 1 の6人は触らない。

**修正版の担当**：ロジック＝`logic.js`、入力＝`input.js`、画面＝`games/pikatto/index.html`、文言＝`games/pikatto/index.html`（画面の担当の後）とルート `index.html` の `desc` だけ、テスト＝§9 に書いたファイル。`sfx.js` は音名を変えないので触らない。

## 3. ロジックの API（`games/pikatto/logic.js`、担当A）

UMD で `window.PikattoLogic` と Node の `module.exports` の両方を公開する（ゼンマイさんぽに準じる）。

```js
PikattoLogic = {
  // 新しい対戦を作る。random: () => number（0..1）, now: () => number（ms）は注入可能（テスト用）。
  // 既定は Math.random と Date.now
  createGame({ players, mode, random, now }) → state
    players: 2 | 3 | 4         // vs のときのみ有効（solo は常に 1 とみなす）
    mode: 'vs' | 'solo'

  // 状態（phase の遷移）
  //   'setup' → 'waiting'（startRound後、合図待ち）
  //     → 'armed'（applySignal後、押せる）→ 'resolved'（applyPress で確定）
  //     → 次ラウンドで 'waiting'、または終了で 'done'
  //   フライングは 'waiting' での applyPress で発生。即 'resolved'
  // state の形
  //   { phase, players, mode, round, maxRounds: 5, scores: number[], reactions: number[](solo),
  //     signalDelay: number(ms), signalFiredAt: number|null, lastOutcome: {...}|null,
  //     winner: null | number | 'draw' }
  //   seed は持たない（PK-24。再現は random の注入で行う）
  //   round は「いま何回目か」（1始まり）。startRound で +1 される。画面はこの値をそのまま出す（PK-01）

  startRound(state) → newState
    // phase を 'waiting' に、signalDelay を 1000..4000 のランダムに、round += 1。
    // signalFiredAt = null, lastOutcome = null。
    // phase が 'done' のときは何もしない

  redoRound(state) → newState                       // 新規（PK-04）
    // phase が 'waiting' / 'armed' のとき：round・scores・reactions はそのまま、
    //   signalDelay を 1000..4000 で引き直し、signalFiredAt = null, lastOutcome = null, phase = 'waiting'。
    // それ以外の phase（setup / resolved / done）では何もしない（同じ state を返してよい）。
    // 一時停止から戻るとき（つづける）に画面が呼ぶ

  applySignal(state) → newState
    // phase 'waiting' → 'armed'、signalFiredAt を now() に。
    // それ以外の phase では何もしない

  applyPress(state, { playerIdx, pressedAt }) → { state: newState, outcome }
    // outcome: { kind: 'win', player, reactionMs, scores } |
    //          { kind: 'foul', foulBy, award, scores } |
    //          { kind: 'ignore' }
    // kind 'ignore'：phase が 'armed' / 'waiting' 以外
    // 'armed' で正しい playerIdx の自分の色を押した → 'win'
    //   ただし pressedAt < signalFiredAt（合図より前の時刻の押下）は 'foul' として扱う（PK-10）。
    //   pressedAt === signalFiredAt は 0ms の 'win'。reactionMs は負にならない
    //   reactionMs = pressedAt - signalFiredAt、scores[player] += 1。
    //   solo モードは reactions に reactionMs を追加
    // 'waiting' で誰かが押した → 'foul'
    //   foulBy = playerIdx、award: 他のプレイヤー全員に +1。solo モードは foul で reactions に null
    // どちらでも、閾値（scores[i] >= 3 または round >= maxRounds）に達したら phase を 'done'、winner を決める
    // （フライングの award で複数人が同時に 3 点になることがある → そのときも最高点が同点なら 'draw'）

  decideWinner(state) → number | 'draw' | null
    // 'done' のとき勝者（0..players-1、最高点が同点は 'draw'）、それ以外は null。サドンデスはしない（PK-20）

  averageMs(reactions) → number | null
    // null を除いた平均。空なら null

  // 保存データの検証（ゼンマイやいろコードと同じ流儀）
  validateBestSolo(raw) → number | 0
    // 整数で 50..5000 の範囲なら受け入れる、それ以外は 0（記録なし）
  SAVE_KEY_BEST_SOLO: 'pikatto.bestSolo'
}
```

**実装の注意**：

- 乱数は注入可能にする（テストで固定の順列を使う）
- `now()` も注入可能に（Playwright の `page.clock` と合うように）
- 1〜4秒の待ち時間は閉区間 `[1000, 4000]` の一様乱数、整数（ms）に丸める
- フライング判定は、`playerIdx` を問わず「waiting 中のどのボタン押下もフライング」。armed でも `pressedAt < signalFiredAt` ならフライング（PK-10）
- `scores` は参照で返さず、毎回新しい配列を返す（イミュータブル）。`redoRound` も新しい state を返す
- 変異テスト（§9）が狙う所：`redoRound` が round・点数を変えない（MP4）、負の時刻はフライング（MP5）、`round >= maxRounds` の上限（MP6）

## 4. 入力の API（`games/pikatto/input.js`、担当C）

```js
PikattoInput.attach(root, { onPress, onCornerDown, onCornerUp }, opts?) → { detach(), reset(), discard() }
  // root 直下の .corner[data-player] に対して、pointerdown でタップを検知し、
  // onPress({ playerIdx, pressedAt }) を呼ぶ。pressedAt は normalizeTs(event.timeStamp) の値
  //   （timeStamp が使えなければ performance.now()）
  // opts: { windowMs = 30 }（受付の窓。下の createCore に渡す）
  // pointerdown のまま離れても press は1回だけ。
  // マルチタッチ：複数の指が同時に別のボタンに触れたら、両方 onPress する。
  // 受付の窓（PK-09）：最初の押下が届いてから windowMs（30ms）の間に届いた押下をまとめ、
  //   pressedAt（timeStamp）の早い順に並べ替えてから onPress を順に呼ぶ。
  //   → 「後から届いたが、押した時刻は早い」押下が勝てる。同じ時刻なら届いた順。
  // 押しっぱなし（PK-23）：pointerId ごとに数える。同じボタンを別の指で押しても、
  //   その指がまだ離れていなければ2回目は入れない（ボタンごと × pointerId ごとに held を持つ。
  //   ボタンに1本でも押したままの指があれば、そのボタンへの新しい押下は無視）。
  // キー操作（PK-06）：.corner に keydown（Enter / " " / "Spacebar"）→ down、keyup → up。
  //   e.repeat が true の keydown は無視。pointerId は "key" として数える。押下時刻は normalizeTs(e.timeStamp)。
  //   Space のスクロール・Enter の click 二重発火は preventDefault で止める。
  // touch-action: none を root（または .play 要素）に設定し、
  //   touchstart / touchmove / touchend / dblclick / contextmenu / selectstart / gesturestart を preventDefault する。
  // iPadOS の4本指ジェスチャーとの干渉を抑えるため、.play 全面に touch-action: none を敷く（Web からは完全には止められない → 遊び方で案内（PK-27））。
  // pointercancel：その pointerId の押しっぱなしだけ消す。すでに届いた押下（窓の中で待っている分も含む）は有効のまま、取り消さない。
  // detach()：すべてのリスナーを外し、窓のタイマーを止め、root に設定した style
  //   （touchAction・userSelect・webkitUserSelect・webkitTouchCallout）を attach 前の値に戻す（PK-23）。
  // reset()：held と窓に溜まった押下を捨てる（onPress は呼ばない）。画面がラウンドを切り替える・一時停止するときに呼ぶ。
  // discard()：窓に溜まった押下だけを捨てる（held は残す）。画面が「よーい」を終えるときに呼ぶ
  //   （よーいの終わり際の押下が窓に残り、ready=false の後に届いてフライングになるのを防ぐ）。
  // 支援技術の click（PK-06）：.corner への click のうち e.detail === 0 のもの（VoiceOver の二重タップ・スイッチコントロール）
  //   → down の直後に up（pointerId は "click"）。本物のタップの click は detail >= 1、キーボードは keydown/keyup の
  //   preventDefault で click が出ないので二重にならない。画面側も、隅のボタンには合成の click を送らない。

PikattoInput.createCore(cbs, opts?) → { down(playerIdx, ts, pointerId?), up(playerIdx, pointerId?), cancel(pointerId?), flush(), reset(), discard(), held }
  // DOM に依存しない核。テスト（PK14、Node）で直接使う
  // cbs: { onPress, onCornerDown?, onCornerUp? }
  // opts: { windowMs = 30, setTimer = setTimeout, clearTimer = clearTimeout }
  //   setTimer / clearTimer を注入すると、Node のテストで時間を進めずに確かめられる
  // down：held に (playerIdx, pointerId) を入れ、窓に押下を溜める（窓が無ければ開いて windowMs 後に flush を予約）
  //   pointerId を省略したときは "p" + playerIdx 扱い（従来どおりボタンごとに1つ）
  // flush()：窓に溜まった押下を ts の早い順（同じ ts は届いた順）に onPress して窓を閉じる。テストから直接呼んでよい
  // cancel(pointerId)：その pointerId の held を消すだけ。窓の中の押下は残す
  // held：Set のコピー（読み取り用）

PikattoInput.normalizeTs(ts, timeOrigin?) → number          // 新規（PK-22）
  // 純粋関数。ts が 1e11 より大きい（= 1970年からの ms で来た古い Safari）なら ts - timeOrigin を返す。
  // timeOrigin の既定は performance.timeOrigin。ts が有限の数でなければ performance.now() を返す

PikattoInput.keyAction(e) → 'down' | 'up' | null             // 新規（PK-06、テスト用に公開）
  // 純粋関数。{ type, key, repeat } を見て、keydown の Enter / " " / "Spacebar"（repeat なし）→ 'down'、
  // keyup の同じキー → 'up'、それ以外 → null
```

**実装の注意**：

- `onPress` は「下方向のタップ」のみ。離した時は呼ばない
- `playerIdx` は `data-player` の数値を 1-based から 0-based に変換（`parseInt(el.dataset.player, 10) - 1`）
- タイムスタンプは `normalizeTs(event.timeStamp)`、使えなければ `performance.now()`
- 受付の窓は「押下を 30ms 遅らせて渡す」ことになるが、勝ち負けは pressedAt で決まるので反応時間には影響しない
- 画面が「よーい」・一時停止中は onPress を受けても無視する（判断は画面側。input.js は状態を持たない）
- `hidden` の `.corner` は押せない（DOM 上でも反応しない）

## 5. DOM 契約（担当B・C・F で共有）

### 全体構造

```html
<main class="app">
  <header class="head">
    <a id="back" class="back" href="../../">← メニュー</a>
    <h1 class="title">ピカッと早押し</h1>
    <div class="head-tools">
      <button id="help-btn" aria-label="遊び方">？</button>
      <button id="sound-btn" aria-label="音のオン/オフ">♪</button>
    </div>
  </header>

  <!-- 設定画面（最初・やり直し時） -->
  <section class="setup" id="setup">
    <h2>にんずうをえらぶ</h2>
    <div class="players-pick">
      <button data-players="2" aria-pressed="true">2人</button>   <!-- 最初から選択（PK-18） -->
      <button data-players="3" aria-pressed="false">3人</button>
      <button data-players="4" aria-pressed="false">4人</button>
      <button data-players="solo" aria-pressed="false">ひとりで れんしゅう</button>
    </div>
    <p class="rule">さきに 3点とったら 勝ち</p>              <!-- PK-14 -->
    <button class="start" data-action="start">はじめる</button>
  </section>

  <!-- プレイ画面 -->
  <section class="play" id="play" hidden>
    <div class="scoreboard" id="scores">
      <!-- data-player ごとのスコア表示。aria-live は付けない（PK-08） -->
    </div>
    <div class="field" id="field" data-players="2">
      <!-- data-players は "1"（ひとりで れんしゅう）/"2"/"3"/"4"（PK-03） -->
      <!-- 4つの隅のボタン。使わない人数のボタンは hidden。data-color の値は変えない（テストが使う） -->
      <button class="corner" data-player="1" data-color="red"    data-icon="●" aria-label="1P（●）"></button>
      <button class="corner" data-player="2" data-color="blue"   data-icon="■" aria-label="2P（■）"></button>
      <button class="corner" data-player="3" data-color="yellow" data-icon="▲" aria-label="3P（▲）"></button>
      <button class="corner" data-player="4" data-color="green"  data-icon="◆" aria-label="4P（◆）"></button>
      <!-- 合図：中央に濃い色の「ピカッ！」（48px 以上）＋ 画面の淡い光。aria-live は付けない（PK-08） -->
      <div class="signal" id="signal" aria-hidden="true"></div>
      <!-- 「ピカッ！」のとき 'armed'、待機中は 'waiting'、確定後 'resolved' を data-phase に入れる -->
    </div>
    <p class="hint" id="hint" aria-live="polite"></p>   <!-- aria-live はここだけ。高さは2行分で固定（PK-12） -->
  </section>

  <!-- オーバーレイ（ラウンド結果・最終結果・遊び方） -->
  <div class="overlay" id="overlay" hidden>
    <div class="card" role="dialog" aria-modal="true">
      <!-- 中身は動的 -->
      <!-- 動的に次のボタンのいずれかが出る -->
      <!-- [data-cmd="next"] つぎへ（次のラウンド）   [data-cmd="again"] もう一度（最初から） -->
      <!-- [data-cmd="menu"] メニューへ    [data-cmd="close"] 遊び方を閉じる（設定画面から開いたとき） -->
      <!-- [data-cmd="resume"] つづける（一時停止から戻る。新規、PK-04） -->
      <!-- 最終結果のカードには data-final="1"、ベスト更新のカードには data-best="1" を付ける -->
    </div>
  </div>
</main>
```

### 主要なセレクタと data 属性

| セレクタ | 用途 |
|---|---|
| `a#back` | メニューへ戻る（既存ゲームと同じ） |
| `#setup`・`.setup` | 設定画面（人数・モード選択） |
| `.setup [data-players]` | 人数の選択ボタン（`"2"`・`"3"`・`"4"`・`"solo"`）。選ばれているものは `aria-pressed="true"`。最初は `"2"`（PK-18） |
| `.setup [data-action="start"]` | 「はじめる」ボタン（最初から押せる） |
| `#play`・`.play` | プレイ画面 |
| `#scores`・`.scoreboard` | スコア表示（`data-player` ごと、`.score[data-player]` に数字）。ひとりで れんしゅう では「ベスト」ラベル（旧「じぶん」、PK-15） |
| `#field`・`.field` | 4つの隅ボタン + 合図要素の親 |
| `#field[data-players]` | 人数 `"1"`〜`"4"`（PK-03）。CSS の配置はこれで切り替える |
| `.corner[data-player="1..4"]` | 隅のボタン。属性 `data-color`・`data-icon` と `data-lit`（光っているとき `"on"`）。`aria-pressed` は使わない（PK-24 で契約から外す） |
| `#signal`・`.signal` | 合図の光。`.signal[data-phase="armed"]` のとき中央に「ピカッ！」（48px 以上・濃い色・不透明）と淡い光（PK-08・PK-19） |
| `#field[data-phase]` | ラウンドの状態：`"ready"` ← よーい（新規、PK-05）、`"waiting"` ← 合図前、`"armed"` ← 合図中、`"resolved"` ← 確定後、`"paused"` ← 一時停止中（新規、PK-04） |
| `#hint` | ヒント。ラウンド表示「〇回目（全5回）」もここ（お試しにも回数を出す、PK-01）。高さは2行分で固定（PK-12） |
| `#overlay`・`.overlay`・`.overlay .card` | 結果・遊び方・一時停止のモーダル |
| `.overlay .card[data-final="1"]` | 最終結果のカード（新規、PK-14）。勝者の色を大きく出す |
| `.overlay .card[data-best="1"]` | ベスト更新のカード（新規、PK-15）。「ベスト更新！」の文字を出す |
| `.overlay [data-cmd="next"/"again"/"menu"/"close"/"resume"]` | モーダルのボタン（`resume` は新規） |
| `.overlay [data-cmd="menu-cancel"/"menu-go"]` | メニューへの確認カードの「つづける」「メニューへ もどる」（v31、PK-33） |
| `#signal[data-phase="ready"]` | よーい中の「よーい」（v31、PK-31） |
| `#help-btn`・`#sound-btn` | 右上の？と♪ |

### 配置（PK-02・PK-03・PK-25・PK-26）

| 人数 | 1P | 2P | 3P | 4P |
|---|---|---|---|---|
| 1（れんしゅう） | フィールド全体を押せる（PK-25）。見た目は 1P の色 | — | — | — |
| 2 | 左上 | **右下**（対角、PK-03） | — | — |
| 3 | 左上 | 右上 | 左下 | — |
| 4 | 左上 | 右上 | 左下 | 右下 |

- 3人・4人のとき、上段の隅（1P・2P）の番号と図形は 180° 回して、向かい側の人から読めるようにする（PK-26）
- 縦・横どちらでも、隅どうしの矩形が重ならない。高さは `calc(50% - 9px)` 以下など、上下の隅の間に必ずすき間を作る（PK-02）。テスト PK5・PK12 が矩形の交わりを確かめる

### 一時停止とよーい（PK-04・PK-05）

- `startRound` の直後、`#field[data-phase="ready"]` で約 1000ms「よーい」を出してから待ち時間のタイマーを始める。ready 中の押下（タップ・キー・`pressFor`）は無視
  - よーいの終わり（`endReady`）で `input.discard()` を呼び、受付の窓に残ったよーい中の押下を捨てる
  - よーいを始めるたび、見えている 1P の隅（`.corner[data-player="1"]`）にフォーカスを移す（キーボード・スイッチ操作で Tab を戻らなくてよい）
- `visibilitychange` で `document.hidden` になったとき、またはプレイ中（ready / waiting / armed）に「？」を押したとき：タイマーをすべて止め、`input.reset()`、`#field[data-phase="paused"]`、カードを出す
  - 裏から戻ったとき：「とまっています」のカードに `[data-cmd="resume"]`「つづける」と `[data-cmd="menu"]`
  - 「？」のとき：遊び方のカードに、`close` の代わりに `[data-cmd="resume"]`「つづける」
  - 「つづける」→ `redoRound` → よーい → 待ち時間。フライングにも点にもしない。round は進まない
- resolved（結果カードが出ている）や done のときは止めない（何もしない）

### v31 の追加（PK-31〜PK-37）

- **よーいの見た目（PK-31）**：よーい中は `#signal[data-phase="ready"]` にして、中央に `.word.ready`「よーい」（地は `--panel`・点線の枠。合図の「ピカッ！」とは色を変え、光らせない）。`endReady` で消す。よーい中に押すと（タップ・キー・`pressFor`）、`#hint` の2行目を「いまは おさなくて いいよ。まってね」にする（遊び方の「まだ」＝ひかるまえに おす と紛らわしくしない。1行で SE 縦 320px でも切れない）。フライングにはしない（`pressFor` は false のまま）
- **設定の説明（PK-34）**：`.setup .lead`（`#setup-lead`）と `.setup .rule`（`#setup-rule`）は、`selectPlayers` でモードに合わせて書き換える。対戦は「ほかのみんなに 1点」「さきに 3点とったら 勝ち（5回で おわり）」、れんしゅうは「はやさを はかって、ベストを めざそう」「5回 はかったら おわり（へいきんも でるよ）」
- **メニューへの確認（PK-33）**：カードの `[data-cmd="menu"]` は、対戦（vs）で試合が終わっておらず、だれかが 1点以上持っているとき（点が消えるとき）だけ、確かめるカード「メニューへ もどる？／メニューへ もどると、いまの 点は きえます。」を出す。ボタンは `[data-cmd="menu-cancel"]`「つづける」（`.primary`、フォーカスはここ）と `[data-cmd="menu-go"]`「メニューへ もどる」。出た直後の 400ms（`CONFIRM_LOCK_MS`、`showCard` の `guard`）は主ボタン以外（「メニューへ もどる」）を `disabled` にする（「メニューへ」の2度押しで2回目が「メニューへ もどる」に届いて点が消えないように。主ボタンは押せてフォーカスもそこ。R2）。「つづける」で前のカード（一時停止・遊び方・結果）に鍵なしで戻る。点が無いとき・れんしゅう・最終結果では確かめずに戻る。`a#back` は今までどおりのリンク（確かめない）
- **プレイ中の「？」のカード（PK-33）**：`[data-cmd="resume"]`「つづける」の下に `[data-cmd="menu"]`「メニューへ」も出す（後ろの `a#back` は inert で押せないため）
- **キーボード（PK-35）**：カードを閉じて戻す先が無いとき（起動直後の遊び方など）は、プレイ中なら見えている隅、設定画面なら選ばれている人数のボタンにフォーカスを置く（body に落とさない）。カードの中のボタンへの repeat の keydown（Enter・Space の押しっぱなし）は `preventDefault` で止める（Space も止める。repeat の keydown でもボタンが押された状態になり、離したときに押されてしまうため。R3）。最終カードを待つ間（400ms）に「？」を開いたら、遊び方は閉じず、「わかった」で閉じたときに最終カードを出す
- **読み上げ（PK-36）**：`#hint` の2つの span（`.round`・`.msg`）は作り直さず、文字が変わった span の `textContent` だけを変える（「いまだ！」で回数の行を読み直さない）。`#sound-btn` の `aria-label` は「音」で固定し、オン・オフは `aria-pressed` だけで伝える
- **黄の上の枠（PK-37）**：合図中（armed）と押している隅（`data-lit="on"`）の枠は、白い 5px の内側に濃い色（`#111111`）の 3px を重ねる（`inset 0 0 0 5px #fff, inset 0 0 0 8px #111`）。黄（3P）の上でも 3:1 以上

### 結果カード（PK-11・PK-14・PK-15・PK-21）

- ラウンド結果・最終結果のカードは、出してから 600ms はボタンを `disabled` にする。タイマーは `hideOverlay` で片付ける
- `.card` は `role="dialog"`・`aria-modal="true"`・`aria-labelledby="card-title"`（カードの `h2` に `id="card-title"`、結果の行 `p.res` があれば `aria-describedby`）・`tabindex="-1"`
- カードを出している間は `#app` に `inert` と `aria-hidden="true"`。押せない 600ms はカード自体にフォーカス、その後は `.primary` へ。閉じたら開く前のフォーカスに戻す（ラウンドを始めるときは 1P の隅）
- ラウンドの勝ち：「〇P の 1点！」。最終：「〇P の勝ち！」（`data-final="1"`、勝者の色を大きく）。引き分け：「ひきわけ」
- 3点とって終わったときだけ「3点とった」と出す。5回終わって終わったときは出さない（PK-14）
- 最終結果を出す `setTimeout` の id は `finalTimer` に持ち、`startGame`・`startRound`・`reset` で `clearTimeout` する（PK-21）
- れんしゅう：ベストを更新したらカードに「ベスト更新！」と `data-best="1"`（PK-15）。結果は「230 ms（0.23びょう）」のように秒も併記

### 色（CSS カスタムプロパティ）（PK-07）

Okabe-Ito 系（色覚の違いがあっても見分けやすい配色）。色だけでなく、位置・番号・図形でも区別する：

```css
--p1-color: #D55E00;  /* 朱（data-color="red"） */
--p2-color: #0072B2;  /* 青（data-color="blue"） */
--p3-color: #F0E442;  /* 黄（data-color="yellow"） */
--p4-color: #009E73;  /* 青緑（data-color="green"） */
```

- 各隅の中央に 48px 以上の不透明な図形（● ■ ▲ ◆）を出す。番号も濃く（半透明にしない）
- armed のときは、隅に白い太枠（3px 以上）も付けて「光った」を明るさ以外でも伝える。白の内側に濃い線（3px）も重ね、黄の上でも 3:1 以上にする（PK-37）

### CSS の約束

- 既存ゲームのトークン（`--bg`・`--panel`・`--well`・`--line`・`--ink`・`--muted`・`--accent`・`--accent-ink`）を使う
- フォント・ボタン・safe-area・ダブルタップ抑止の作りはゼンマイさんぽに準じる
- `.corner` は 44×44 以上、できれば一辺が画面の短辺の 32% 以上
- 本文の文字は 16px 以上（PK-16）。灰色の薄い文字にしない
- `touch-action: none` を body と `.play` 全面に敷く
- 合図の見え方を遅らせない（PK-13）：armed の `.corner` は `transition: none`、フラッシュは opacity 1 から始める、`.signal` に `will-change: opacity`
- フラッシュ（画面の白い光）の濃さは上限 0.45（PK-19）
- アニメーションは `prefers-reduced-motion: reduce` で止める。このとき画面全体は白くしない（中央の「ピカッ！」と隅の枠だけで伝える）（PK-19）

## 6. SFX 契約（`common/sfx.js`、担当D）

`YubiSfx.create("pikatto")` を使えるようにする。`COMMON` の `start`・`best`・`toggle`・`over`・`tap` は共通で、以下を追加する：

```js
const PIKATTO = {
  // 合図：短く明るい「ピカッ」。マリンバの高音＋小さなベル。遅れが気にならないよう decay は短め
  signal: () => { /* 高めの倍音豊か、0.08〜0.12秒 */ },
  // 合図前のカウント（待機中の「とん…とん」。音は非常に小さく、心を落ち着かせる） — 任意
  ready: () => { /* 低めの木の音、0.03秒 */ },
  // フライング：責めない「こつん」。低い木の音とごく小さい noise
  foul: () => { /* 低音、0.08秒 */ },
  // 自分が勝ったときの「ピンポン」：明るい2〜3音
  win: () => { /* C5 → G5 → C6、0.15 秒くらい */ },
  // 引き分け・小休止：やさしい2音
  tie: () => { /* 中音域、0.1 秒 */ },
  // 最終勝利：ばいばいタイルの win を少し短くしたような上昇
  finish: () => { /* 5音＋ベル */ }
};
```

**実装の注意**：

- 既存の mallet / wood / noise / bell / partial / N / C5 など同じユーティリティを使う
- 連打の間引き（`GAP`）に `signal` と `foul` は入れない（連続することは少なく、見逃したら気づけない）
- `common/sfx.js` の下の `game === "pikatto" ? PIKATTO : {}` に1行追加。使い方コメント（1〜14行目）にも1行足す

## 7. 保存データ契約

| キー | 形 | 検証 |
|---|---|---|
| `pikatto.bestSolo` | number（ms、小さいほど良い） | 整数で 50..5000 の範囲なら有効、それ以外は 0（記録なし） |

- vs モードは保存しない（毎回リセット）
- 検証ロジックは `PikattoLogic.validateBestSolo(raw)` に実装し、メニュー側は `index.html` で同じ検証を再実装（logic.js は読み込まないため）

## 8. メニュー連携（担当E）

ルートの `index.html` の `GAMES` 配列に1行足す（説明文は修正版で「ひかったら タップ！ いちばん はやいのは だれ？」に変える（PK-17））：

```js
{ name: "ピカッと早押し", desc: "ひかったら タップ！ いちばん はやいのは だれ？", url: "games/pikatto/", bestKey: "pikatto.bestSolo", bestFormat: (n) => n + " ms", art: "pikatto" }
```

ただし、既存の `GAMES` は `best` と `stats` と `bestText` のどれかを使っている。既存の `renderBest()` を壊さずに **`bestFormat` を足す**か、**`bestText: () => pikattoBest()`** 方式のどちらかで実装する。既存の `zenmaiBest()` と同じ流儀で `pikattoBest()` を追加するのが安全。

```js
// index.html の中で
function pikattoBest() {
  try {
    const raw = localStorage.getItem("pikatto.bestSolo");
    if (raw === null) return "";
    const n = Number(raw);
    return Number.isInteger(n) && n >= 50 && n <= 5000 ? n + " ms" : "";
  } catch (e) { return ""; }
}
```

### ART 関数の追加

`ART.pikatto(ctx, w, h)` を既存の `ART` オブジェクトに追加する。デザインは：

- 画面を4つのパネルに割って、4色（赤・青・黄・緑）の角丸四角を描く（既存ゲームの絵柄に合わせた、やわらかい色）
- 中央に小さな「ピカッ！」を示す丸い光（白〜淡い黄色）、周りにごく薄い光彩

既存の `ART.tiles` の構造を参考に、`roundRect` と `jit` 的な小さな乱れで手描き感を出す。

## 9. テスト契約（担当F、グループ記号 **PK**）

### `tests/run.mjs` の `GROUPS` に1行追加（PK を最後に）

```js
{ key: 'PK', title: 'PK ピカッと早押し（ロジック・画面・保存・オフライン・音・タッチ）', file: 'pikatto.mjs', weight: { smoke: 8, full: 35 } },
```

### `tests/cases/pikatto.mjs` に書く確認（smoke と full）

**smoke（これだけは絶対に動く）**：

- PK1：ロジック（Node）
  - createGame → startRound → applySignal → applyPress('armed') の勝ちで scores が増える
  - 'waiting' での applyPress は foul、他プレイヤー全員に +1
  - 3点先取で phase='done'、winner が整数
  - validateBestSolo が壊れた値 10 種を 0 にする
- PK2：画面（smoke）
  - 設定で2人を選び「はじめる」で `.play` が表示
  - 合図前に押すと overlay に `[data-cmd="next"]` が出る（フライング）
  - 合図後に正しい色を押すと勝ちの表示
- PK3：データ
  - `pikatto.bestSolo` が solo モードで更新される
  - 壊れた保存データ（文字列・NaN・負・Infinity・object）は 0 扱い
- PK4：メニューへ戻れる（E グループに1項目 or PK 内）
  - `a#back` でメニューに戻る、プレイ中・結果画面・遊び方からも戻れる

**full（smoke に加えて）**：

- PK5：桁数・画面内（V と似た確認を PK 用に）
  - SE 縦・iPad 横で、4つの `.corner` がすべて 44×44 以上、safe-area 内
- PK6：効果音
  - `signal`・`foul`・`win`・`finish` が鳴る順を確かめる
- PK7：ダブルタップ抑止
  - `.play` 内で素早い2回タップが拡大のきっかけにならない（T と同じ流儀）
- PK8：オフライン
  - 事前キャッシュに `games/pikatto/*` が入っている、オフラインで開ける
- PK9：境界値
  - 合図の待ち時間が 1000〜4000 ms に入る（`random` を注入して境界を確かめる）
  - フライングと同時に合図が発火した場合の判定（waiting 中の押下はすべて foul）

### 修正版で直す・足すテスト（PK-28・PK-29・PK-30）

編集してよいファイル：`tests/cases/pikatto.mjs`、`tests/cases/layout.mjs`（`SCREENS` に pikatto を足すのみ）、`tests/cases/sound.mjs`（`PAGES` に pikatto を足すのみ）、`tests/mutants/mutate.mjs`（MP4〜MP7 を足すのみ）、`tests/design.md`（PK・MP の行の追記・更新のみ）、`tests/run.mjs`（PK の weight の更新のみ）。

**大事な前提**：`page.clock` を使っていても `event.timeStamp` は本物の時刻のまま進む。だから**勝ち負け（だれが勝ったか・反応時間）は `pressFor(idx, ts)` で確かめ、実際のタップ（`page.mouse` / `touchscreen`）のテストでは勝ち負けを見ない**（画面が進む・カードが出る、だけを見る）。

既存の直し：

- PK1：`redoRound`（waiting / armed で round・scores・reactions が変わらず phase が waiting、signalDelay が 1000..4000、resolved / done では何もしない）と、負の時刻（`pressedAt < signalFiredAt`）はフライング・同時刻は 0ms の勝ち、を足す
- PK2・PK6：「よーい」があるので、時計を **1100ms 以上**進めてからフライングを試す（ready 中の押下は無視されるため）
- PK3：保存（`pikatto.bestSolo`）が無ければ**不合格**（今は合格してしまう）
- PK5：4つの `.corner` の矩形が互いに交わらないことも確かめる
- PK8：`APP_FILES` に `games/pikatto/*` が無ければ**不合格**（skip にしない）
- `layout.mjs` の `SCREENS` と `sound.mjs` の `PAGES` に pikatto を足す

新しい項目：

| 記号 | 種類 | 確かめること |
|---|---|---|
| PK10 | smoke・静的 | `sw.js` の `APP_FILES` に pikatto の全ファイル、`index.html` の読み込み順（sfx.js → logic.js → input.js → 本体）、`sfx.js` に `signal`・`foul`・`win`・`finish` がある |
| PK11 | smoke | 「はじめる」の後、`#hint` のラウンド表示が「1」から始まる（2人・れんしゅうの両方、PK-01） |
| PK12 | full | SE 横・iPad 横で、隅どうしの矩形が交わらない。2人のとき 1P と 2P が対角（左上と右下）（PK-02・PK-03） |
| PK13 | smoke | waiting 中に `visibilitychange`（hidden）と「？」を起こすと、時計を進めても armed にならず点数も変わらない。「つづける」で waiting（よーいの後）に戻る（PK-04） |
| PK14 | full・Node | `createCore`：窓の中で後に届いた早い timeStamp が先に onPress される、同じボタンを別の pointerId で押しても2回目は入らない、`keyAction` が Enter / Space で down・repeat を無視、`cancel` 後も窓の押下は残る、`normalizeTs` が 1e11 超を直す（PK-06・PK-09・PK-22・PK-23） |
| PK15 | smoke | れんしゅうでベスト更新すると `.card[data-best="1"]` と「ベスト更新！」、スコアのラベルが「ベスト」（PK-15） |
| PK16 | full | 引き分け（5回で同点）で「ひきわけ」・`data-final="1"`、3点で終わったときだけ「3点とった」、終わった後 `finalTimer` が残らない（`again` 直後に最終カードが重ならない）（PK-14・PK-21） |
| PK17 | full | 最大桁（点数・反応時間 5000 ms・「0.23びょう」併記）でも表示が崩れない |
| PK18 | full | armed で押下 → pointercancel が来ても、その押下は有効のまま（勝ちが取り消されない） |
| PK19 | full | よーい中は `#signal[data-phase="ready"]` に「よーい」（合図と地の色が違う）、よーい中に押すとフライングにせずヒントに「いまは おさなくて いいよ。まってね」、waiting で消える。設定の説明がモードで変わる。遊び方に「1000分」「4本・5本指」「ジェスチャー」「設定」「安全」「画面」を使わない（v31、PK-31・PK-32・PK-34） |
| PK20 | full | 4人・点ありの結果カード・プレイ中の「？」・一時停止のカードの「メニューへ」で確かめるカード（「つづける」（menu-cancel）にフォーカス、文「メニューへ もどると、いまの 点は きえます。」）、出た直後に「メニューへ もどる」の場所を押しても戻らず点も残る（R2）、「つづける」で元のカードに戻る、鍵の後の「メニューへ もどる」で戻る。点が無い・れんしゅう・最終結果では確かめない（v31、PK-33） |
| PK21 | full | 起動直後の遊び方を Enter で閉じてもフォーカスが body でない、Enter の押しっぱなし（repeat）・Space の押しっぱなし（Enter と同じく repeat の keydown を何度か起こす。R3）で「つぎへ」が押されない（押し直せば押される）、最終カードを待つ間に開いた遊び方が勝手に閉じず「わかった」で最終カード（v31、PK-35） |
| PK22 | full | `#sound-btn` の名前にオン／オフが無く aria-pressed だけ変わる、合図で `#hint` は `.msg` だけ変わる（MutationObserver）、合図中の 3P（黄）の内側の枠のどれかが地の色と 3:1 以上（v31、PK-36・PK-37） |

### 公開 API（テスト用）

`games/pikatto/index.html` の bootstrap が公開する：

```js
window.PikattoGame = Object.freeze({
  getState() → { ...state（平らに展開）, screen, selectedPlayers, bestSolo, gameState,
                 ready: boolean,    // 「よーい」中なら true（新規、PK-05）
                 paused: boolean }  // 一時停止中なら true（新規、PK-04）
  startRound(),
  forceSignal() → boolean,   // 「よーい」と待ち時間を両方飛ばして即 'armed'。waiting でも ready でも効く
  pressFor(playerIdx, ts?) → boolean,
    // 第2引数 ts（新規）：押した時刻。省略時は performance.now()。
    // 受付の窓を通さず、直接ロジックに渡す（勝ち負けのテスト用）。ready・paused 中は無視して false
  reset()                    // 設定画面に戻す。finalTimer・よーい・待ち時間のタイマーを止め、input.reset()、2人を選択状態に
})
```

`selectedPlayers` の初期値は `2`（PK-18）。

### design.md

`tests/design.md` の対応表に PK10〜PK18 と、変異 MP4〜MP7 の行を追記する。

### 変異テスト（`tests/mutants/mutate.mjs`、PK-30）

| 記号 | 変異 | 捕まえるテスト |
|---|---|---|
| MP4 | `redoRound` で round か点数が変わる | PK1 |
| MP5 | 負の時刻（`pressedAt < signalFiredAt`）でも win になる | PK1 |
| MP6 | 5ラウンド上限 `round >= maxRounds` → `round > maxRounds` | PK1・PK16 |
| MP7 | ベストを保存しない（`saveBestSolo` の呼び出しを消す） | PK3・PK15 |
| MP8 | れんしゅうも 3回せいこうで終わる | PK1・PK3 |
| MP9 | よーいの終わりに受付の窓を捨てない（終わり際の押下がフライングになる） | PK2 |
| MP13 | メニューへの確認カードに鍵（`guard: CONFIRM_LOCK_MS`）をかけない（「メニューへ」の2度押しで点が消える。v31 のレビュー後 R2） | PK20 |
| MP14 | repeat を止めるキーから `" "` を消す（Space の押しっぱなしで「つぎへ」が押される。R3） | PK21 |

中身の仕組みを変える修正なので、`node tests/mutants/mutate.mjs both` を pikatto の分だけ流す。

## 10. 版と事前キャッシュ（Wave 4、別担当）

Wave 4 でまとめて行う：

- `common/version.js` を `v17`・`2026-10-18` に
- `sw.js` の `CACHE_VERSION` を `v17` に
- `sw.js` の `APP_FILES` に `./games/pikatto/`・`./games/pikatto/index.html`・`./games/pikatto/logic.js`・`./games/pikatto/input.js`（担当Bが `render.js` を作ったときはそれも）を追加

**Wave 1 の6人は `common/version.js` と `sw.js` に触らない。**

修正版でも同じ：版（`version`・`date`・`CACHE_VERSION` の3つ）は最後に別担当がまとめて上げる。ファイルを足したときは `APP_FILES` にも足す（PK10 が確かめる）。

## 11. 共通で守ること（CLAUDE.md §1 より）

- ボタンは 44px 以上、ダブルタップ拡大の抑止、最大の桁数でも表示が崩れない、どの画面からもメニューへ戻れる、保存データが壊れていても落ちない
- 色だけでなく位置・形・アイコンでも区別可能にする（色覚への配慮）
- 日本語の表記（ひらがな・やさしい語で）
- iOS Safari の制約（AudioContext はユーザー操作のあとで有効化、消音スイッチに従う ambient）を守る

## 12. 画面の言葉（PK-17、画面の担当の後で文言の担当が直す）

内部の名前（コード・data 属性）は変えず、画面に出す言葉だけをそろえる。**`data-cmd`・`data-players`・`data-action` の値は変えない**（テストが使う）。

| 内部の用語 | 画面の言葉 |
|---|---|
| フライング | 見出し「まだ」、説明「ひかるまえに おす」、結果カード「まだだよ！」 |
| ラウンド | 「〇回目」。次へ進むボタンは「つぎへ」 |
| ラウンドの勝ち | 「〇P の 1点！」 |
| 最終の勝ち | 「〇P の勝ち！」 |
| お試し | 「ひとりで れんしゅう」。ベスト値のラベルは「ベスト」 |
| 合図・反応・先取 | 「ひかる」「はやさ」「3点とった」 |
| さいしょから | 「もう一度」 |
| +1点 | 「1点」 |
| 4隅 | 「4つのすみ」 |
| ミリ秒 | 遊び方では「ms（1000分の1秒）」と言わず、「かずが ちいさいほど はやい！（230 ms は 0.23びょう）」と例で伝える（v31、PK-32）。結果は「230 ms（0.23びょう）」のように秒も併記 |

遊び方には次も入れる：「さきに 3点とったら 勝ち」（PK-14）、iPad のジェスチャの一言（PK-27）。v31 で「手のひらや たくさんの ゆびで さわると、ホームに もどる ことが あります。」と「おとなの人が iPad の「せってい」で ジェスチャを オフに すると あんしんです。」の2つの文（別の `<dd>`）に言いかえた（PK-32。子ども向けの注意と、おとな向けの設定の話を分ける）。遊び方の言葉は、子どもが読めるよう 人・点・回・色・勝ち・小さい・手 のほかは ひらがなにする（PK-32）。

メニューの説明：「ひかったら タップ！ いちばん はやいのは だれ？」

## 13. ゴール

公開の条件（Chromium smoke + full、WebKit smoke）を満たしたら完了。実機確認はユーザーが行う。
