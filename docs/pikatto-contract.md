# ピカッと早押し — 部品どうしの約束（契約書）

6人の開発担当が同じ約束のもとで並列に作業するための1枚紙です。実装後は不要になります（design.md に取り込むか削除）。

## 1. ねらいと中身（確定済み）

- 2〜4人が iPad を囲んで遊ぶ早押しゲーム。1人用「お試しモード」も用意する。
- 遊び方は **方式 A**：各プレイヤーに四隅のボタン。合図でボタンが光ったら自分の色をタップ。先に自分の色をタップした人の勝ち。合図前にタップしたらフライング（相手全員に1点）。
- **人数**：2・3・4人（設定画面で選ぶ）
- **勝利条件**：先に **3点** 取った人の勝ち（最大5ラウンド、同点ならサドンデス）
- **合図**：待ち時間は **1.0〜4.0 秒のランダム**（擬似乱数で再現可能にする）。合図はボタンが光る＋効果音1音
- **フライング**：合図前に**どれかのボタン**を押したら、押した本人以外の全員に1点
- **お試し（1人用）モード**：CPU は作らない。合図から押すまでの時間（ms）を計り、平均を保存。
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
  //     winner: null | number | 'draw', seed: number }

  startRound(state) → newState
    // phase を 'waiting' に、signalDelay を 1000..4000 のランダムに。
    // signalFiredAt = null, lastOutcome = null。
    // phase が 'done' のときは何もしない

  applySignal(state) → newState
    // phase 'waiting' → 'armed'、signalFiredAt を now() に。
    // それ以外の phase では何もしない

  applyPress(state, { playerIdx, pressedAt }) → { state: newState, outcome }
    // outcome: { kind: 'win', player, reactionMs, scores } |
    //          { kind: 'foul', foulBy, award, scores } |
    //          { kind: 'ignore' }
    // kind 'ignore'：phase が 'armed' / 'waiting' 以外
    // 'armed' で正しい playerIdx の自分の色を押した → 'win'
    //   reactionMs = pressedAt - signalFiredAt、scores[player] += 1。
    //   solo モードは reactions に reactionMs を追加
    // 'waiting' で誰かが押した → 'foul'
    //   foulBy = playerIdx、award: 他のプレイヤー全員に +1。solo モードは foul で reactions に null
    // どちらでも、閾値（scores[i] >= 3 または round >= maxRounds）に達したら phase を 'done'、winner を決める

  decideWinner(state) → number | 'draw' | null
    // 'done' のとき勝者（0..players-1、同点は 'draw'）、それ以外は null

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
- フライング判定は、`playerIdx` を問わず「waiting 中のどのボタン押下もフライング」
- `scores` は参照で返さず、毎回新しい配列を返す（イミュータブル）

## 4. 入力の API（`games/pikatto/input.js`、担当C）

```js
PikattoInput.attach(root, { onPress, onCornerDown, onCornerUp }) → { detach() }
  // root 直下の .corner[data-player] に対して、pointerdown でタップを検知し、
  // onPress({ playerIdx, pressedAt }) を呼ぶ。pressedAt は performance.now() 由来のタイムスタンプ（イベントの timeStamp を優先）
  // pointerdown のまま離れても press は1回だけ。
  // マルチタッチ：複数の指が同時に別のボタンに触れたら、両方 onPress する（ただし「どちらが先か」を timeStamp で判別するため、タイムスタンプの精度は維持する）。
  // 同じボタンへの連打は、前の pointerup があるまで無視（連打で2回入らないように）。
  // touch-action: none を root（または .play 要素）に設定し、
  //   touchstart / touchmove / touchend / dblclick / contextmenu / selectstart / gesturestart を preventDefault する。
  // iPadOS の4本指ジェスチャーとの干渉を抑えるため、.play 全面に touch-action: none を敷く。
  // pointercancel で状態をリセット（押しっぱなしのフラグを消す）。

PikattoInput.createCore(cbs) → { down(playerIdx, ts), up(playerIdx) }
  // DOM に依存しない核。テストで直接使う
```

**実装の注意**：

- `onPress` は「下方向のタップ」のみ。離した時は呼ばない
- `playerIdx` は `data-player` の数値を 1-based から 0-based に変換（`parseInt(el.dataset.player, 10) - 1`）
- タイムスタンプは `event.timeStamp` が使えればそれ、ダメなら `performance.now()`

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
      <button data-players="2">2人</button>
      <button data-players="3">3人</button>
      <button data-players="4">4人</button>
      <button data-players="solo">お試し（1人）</button>
    </div>
    <button class="start" data-action="start">はじめる</button>
  </section>

  <!-- プレイ画面 -->
  <section class="play" id="play" hidden>
    <div class="scoreboard" id="scores">
      <!-- data-player ごとのスコア表示 -->
    </div>
    <div class="field" id="field">
      <!-- 4つの隅のボタン。使わない人数のボタンは hidden -->
      <button class="corner" data-player="1" data-color="red"    aria-label="1人目"></button>
      <button class="corner" data-player="2" data-color="blue"   aria-label="2人目"></button>
      <button class="corner" data-player="3" data-color="yellow" aria-label="3人目"></button>
      <button class="corner" data-player="4" data-color="green"  aria-label="4人目"></button>
      <!-- 合図（画面全体を一瞬光らせる要素） -->
      <div class="signal" id="signal" aria-live="polite"></div>
      <!-- 「ピカッ！」のとき 'armed'、待機中は 'waiting'、確定後 'resolved' を data-phase に入れる -->
    </div>
    <p class="hint" id="hint" aria-live="polite"></p>
  </section>

  <!-- オーバーレイ（ラウンド結果・最終結果・遊び方） -->
  <div class="overlay" id="overlay" hidden>
    <div class="card" role="dialog" aria-modal="true">
      <!-- 中身は動的 -->
      <!-- 動的に次のボタンのいずれかが出る -->
      <!-- [data-cmd="next"] 次のラウンド   [data-cmd="again"] もう一度（最初から） -->
      <!-- [data-cmd="menu"] メニューへ    [data-cmd="close"] 遊び方を閉じる -->
    </div>
  </div>
</main>
```

### 主要なセレクタと data 属性

| セレクタ | 用途 |
|---|---|
| `a#back` | メニューへ戻る（既存ゲームと同じ） |
| `#setup`・`.setup` | 設定画面（人数・モード選択） |
| `.setup [data-players]` | 人数の選択ボタン（`"2"`・`"3"`・`"4"`・`"solo"`） |
| `.setup [data-action="start"]` | 「はじめる」ボタン |
| `#play`・`.play` | プレイ画面 |
| `#scores`・`.scoreboard` | スコア表示（`data-player` ごと、`.score[data-player]` に数字） |
| `#field`・`.field` | 4つの隅ボタン + 合図要素の親 |
| `.corner[data-player="1..4"]` | 隅のボタン。属性 `data-color` と `aria-pressed`・`data-lit`（光っているとき `"on"`） |
| `#signal`・`.signal` | 合図の光（画面全体のオーバーレイ、`.signal[data-phase="armed"]` のとき光る） |
| `#field[data-phase]` | ラウンドの状態：`"waiting"` ← 合図前、`"armed"` ← 合図中、`"resolved"` ← 確定後 |
| `#overlay`・`.overlay`・`.overlay .card` | 結果・遊び方のモーダル |
| `.overlay [data-cmd="next"/"again"/"menu"/"close"]` | モーダルのボタン |
| `#help-btn`・`#sound-btn` | 右上の？と♪ |

### 色（CSS カスタムプロパティ）

既存ゲームに合わせた6色のうち4色を使う（色覚にも配慮して、明度差＋位置＋アイコンで区別可能にする）：

```css
--p1-color: #e0524d;  /* 赤 */
--p2-color: #4a86e8;  /* 青 */
--p3-color: #f2cc4b;  /* 黄 */
--p4-color: #4cae6a;  /* 緑 */
```

### CSS の約束

- 既存ゲームのトークン（`--bg`・`--panel`・`--well`・`--line`・`--ink`・`--muted`・`--accent`・`--accent-ink`）を使う
- フォント・ボタン・safe-area・ダブルタップ抑止の作りはゼンマイさんぽに準じる
- `.corner` は 44×44 以上、できれば一辺が画面の短辺の 32% 以上
- `touch-action: none` を body と `.play` 全面に敷く
- アニメーションは `prefers-reduced-motion: reduce` で止める

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

ルートの `index.html` の `GAMES` 配列に1行足す：

```js
{ name: "ピカッと早押し", desc: "合図でタップ、1番はやいのはだれ？", url: "games/pikatto/", bestKey: "pikatto.bestSolo", bestFormat: (n) => n + " ms", art: "pikatto" }
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

### 公開 API（テスト用）

`window.PikattoGame = { getState, startRound, forceSignal, pressFor(playerIdx), reset }` を `games/pikatto/index.html` の bootstrap が公開する。`forceSignal()` はラウンドの待ち時間を飛ばして即 'armed' にする（テストの早送り用）。

### design.md

`tests/design.md` の対応表に PK グループの行を追加。中身の仕組みの変異を入れたら `MP1`〜`MP3` を書けるようにする（Wave 1 では変異は書かなくてよい）。

## 10. 版と事前キャッシュ（Wave 4、別担当）

Wave 4 でまとめて行う：

- `common/version.js` を `v17`・`2026-10-18` に
- `sw.js` の `CACHE_VERSION` を `v17` に
- `sw.js` の `APP_FILES` に `./games/pikatto/`・`./games/pikatto/index.html`・`./games/pikatto/logic.js`・`./games/pikatto/input.js`（担当Bが `render.js` を作ったときはそれも）を追加

**Wave 1 の6人は `common/version.js` と `sw.js` に触らない。**

## 11. 共通で守ること（CLAUDE.md §1 より）

- ボタンは 44px 以上、ダブルタップ拡大の抑止、最大の桁数でも表示が崩れない、どの画面からもメニューへ戻れる、保存データが壊れていても落ちない
- 色だけでなく位置・形・アイコンでも区別可能にする（色覚への配慮）
- 日本語の表記（ひらがな・やさしい語で）
- iOS Safari の制約（AudioContext はユーザー操作のあとで有効化、消音スイッチに従う ambient）を守る

## 12. ゴール

公開の条件（Chromium smoke + full、WebKit smoke）を満たしたら完了。実機確認はユーザーが行う。
