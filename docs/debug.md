# デバッグ表示（common/debug.js）

iPhone の Safari で不具合が出たとき、PC なしで原因の手がかりを見るための部品です。使い方（iPhone での手順）は [tests/README.md](../tests/README.md) の「iPhone での不具合の見方」。
この文書は、仕組み・命令の一覧・将来の遠隔操作の設計メモです。

## 1. 有効・無効

| URL | 動き |
|---|---|
| `?debug=1` を付けて開く | 有効にして、そのタブの sessionStorage（`yubi.debug`）に覚える。メニュー→ゲームの移動でも有効のまま |
| `?debug=0` を付けて開く | 解除（覚えた印を消す） |
| 何も付けない | 覚えていれば有効、なければ無効 |

- **無効のときは何もしない**：DOM に要素を足さない、console を置き換えない、イベントを登録しない、`window.YubiDebug` も作らない（テスト DG2）。ファイルの読み込みと、URL と sessionStorage を1回見るだけ。
- 全ページ（メニューと8ゲーム）の `<head>` で、ほかのスクリプトより前に読む（早いエラーも拾うため）。読めなくても（404・オフラインでキャッシュなし）ゲームは動く。中で例外が起きても外へ出さない。
- Service Worker の事前キャッシュ（`sw.js` の `APP_FILES`）に入っているので、オフラインでも有効にできる（DG6）。
- ホーム画面のアプリにはアドレス欄がないので、`?debug=1` は Safari で開いて使う。

## 2. 中の作り（コアと表示を分ける）

```
 ページ（ゲーム）
   │ エラー・console・Promise の失敗
   ▼
 コア  window.YubiDebug ── ログの記録（上限 300 件）・購読 subscribe・命令の登録 command と実行 run
   ▲                ▲
   │                │（将来）
 表示（オーバーレイ） 運び役 transport（WebSocket など）
```

- **コア**は記録と命令だけを持ち、画面には何も出さない。
- **表示**（「🐞 N」ボタンとパネル）は、コアの公開している関数（`subscribe`・`run`・`logs`・`errorCount`・`stop`）だけを使う。将来の運び役も同じ関数だけを使えば足りる。
- 命令は**登録済みの関数だけ**を名前で呼ぶ。文字列を `eval` しない（DG1 が静的に確かめる）。`__proto__` のような名前も「ない命令」になる。

### コアの窓口（window.YubiDebug）

| 名前 | 中身 |
|---|---|
| `enabled` | 常に `true`（無効のときは窓口ごとない） |
| `version` | 窓口の形の版（いまは 1）。命令や戻り値の形を変えたら上げる |
| `run(名前, 引数)` | 命令を実行。**必ず** `Promise<{ ok: true, result, command, ms } \| { ok: false, error, command, ms }>` を返し、例外を投げない。ない命令は `{ ok: false, error, commands: [一覧] }`。`result` は JSON にできる形に直してある（循環・関数・DOM 要素は文字に置き換え） |
| `command(名前, 関数, { desc, args })` | 命令を足す。名前は英小文字で始まる英数字 |
| `commands()` | 命令の一覧 `[{ name, desc, args }]` |
| `subscribe(関数)` | 出来事を受け取る。戻り値を呼ぶと解除。出来事は `{ type: "log", entry, errors }`・`{ type: "command", name, ok, ms }`・`{ type: "clear" }`・`{ type: "stop" }` |
| `logs({ level?, since? })` | 記録したログの写し。`since` に前回受け取った最後の `id` を渡すと、それより新しいものだけ |
| `errorCount()` / `dropped()` | エラーの件数 / 上限で捨てた件数 |
| `log(level, ...値)` | ページから任意のログを足す（source は `app`） |
| `clear()` | ログと件数を消す |
| `stop()` | デバッグを終わる（console を元に戻す・イベントを外す・印を消す・URL の `debug=1` を外す・窓口を消す） |

ログ1件の形：`{ id, t（読み込みからの ms）, time（ISO）, level: "error"|"warn"|"log"|"info", source: "onerror"|"load"|"rejection"|"console"|"app", msg }`。
件数（🐞 の数字）に入るのは level が error のもの（実行時エラー・`<script>` などの読み込み失敗・catch されない Promise の失敗・console.error）。

## 3. 命令の一覧

| 命令 | 引数 | 戻り値（result） |
|---|---|---|
| `help` | なし | 命令の一覧 |
| `logs` | `{ level?, since? }` | `{ errors, dropped, entries: [ログ] }` |
| `info` | なし | 端末と環境：`url`・`userAgent`・`language`・`online`・`maxTouchPoints`・`screen`・`window`（inner と client の幅・高さ）・`visualViewport`（w・h・scale・offset）・`devicePixelRatio`・`orientation`・`safeArea`（top・right・bottom・left、`env(safe-area-inset-*)` を測った px）・`standalone`（ホーム画面アプリとして開いているか）・`reducedMotion`・`darkMode`・`audio`・`localStorage`（キーと値の長さ。値そのものは出さない）・`appVersion`（version.js の版と日付）・`serviceWorker`（制御中か・登録の状態・キャッシュ名・`cacheVersion`） |
| `layout` | `{ selector?, limit? }` または セレクタの文字列。既定は押せる要素すべて、60 件まで | `{ selector, count, shown, viewport, safeArea, scroll（横スクロールの有無を含む）, items: [{ el, visible, x, y, w, h, fontSize, pointerEvents, offscreen（画面外）, inUnsafe（safe-area にかかる）, clipped（中身がはみ出している）, under44（押せる要素で 44px 未満）, overlaps（重なっている items の番号）, coveredBy（中心の上に乗っている別の要素） }] }` |
| `state` | なし | `{ games: [{ name: "IrobinGame" など, via: "getState"|"snapshot", methods, state }] }`。ゲームがテスト用に公開している `window.〇〇Game` を読むだけ（ブロック・2048 は窓口がないので空） |
| `storage` | `{ op: "keys"|"get"|"set"|"remove", key?, value? }` | localStorage の読み書き。ゲームの多くは開き直したときに読み直す |
| `tap` | `{ x, y }` または `{ selector, index? }` | 要素の中心（または座標）の一番上の要素に `pointerdown → mousedown → pointerup → mouseup → click` を送る。`{ x, y, target, sent, trusted: false }` |
| `report` | なし | コピー用の文字（ページ・版・エラー件数・ログ・info・state） |

### tap の制限（合成のイベント）

`tap` が送るイベントはスクリプトが作ったもので、`isTrusted` が `false` です。ブラウザは「人の操作」とみなしません。

- **効果音の開始**（AudioContext の resume）・クリップボード・全画面など、人の操作が要るものは動かない。
- **ダブルタップ拡大・スクロール・:active の見た目**など、ブラウザ自身の動きは起きない。拡大の抑止が効いているかは確かめられない（実機で指で確かめる）。
- タッチ（touchstart など）は送らない。ゲームの pointer・mouse・click の処理を呼ぶことはできる。

## 4. 表示（オーバーレイ）

- 閉じた状態は 44×44 の「🐞 N」ボタン（エラーがあれば赤）。Shadow DOM の中にあり、ゲームの CSS と混ざらない。外側の要素は大きさ 0 の固定位置で、ページの並びに影響しない。
- **置き場所の決め方**：画面（safe-area の内側、端から 4px）を 4px 刻みで調べ、重なりの重さが一番小さい所に置く。押せる要素（button・a・input・[role=button]・[data-cmd]・[data-action]）は 4px 広げて重さ 1000（必ず避ける）、canvas・img・svg（盤面・絵）は 3、文字は行ごとの四角で 2。同じなら画面の端に近い所。画面の大きさが変わったとき（回転）と 1 秒ごとに見直し、今の場所が何かと重なったときだけ動かす（遊び方のカードが出た・消えた、など）。メニューのように縦に流れるページでは、流したあとカードに重なることがある（その時点で空いた所へ移る。空きがなければ一番重なりの少ない所）。
- パネル：エラーとログ（新しい順）・環境（info）・「コピー」「閉じる」「デバッグを終わる」。文字は 12px 以上、ボタンは 44px 以上、safe-area の内側に 8px あける。ボタンは `touch-action: manipulation`、ログ欄は `pan-x pan-y`（ダブルタップ拡大を起こさない）。パネルの中の操作はゲームの document・window へ伝えない（ゲームが反応したりスクロールを止めたりしないように）。
- 「コピー」は `navigator.clipboard.writeText`、だめなら `execCommand("copy")`、それもだめなら選択済みの枠を出して手でコピーしてもらう。

## 5. 将来の遠隔操作（設計メモ。今回は作っていない）

ねらい：PC の Claude Code から、iPhone の本物の Safari で「タップの再現・配置の測定・エラーの回収・ゲームの状態の読み書き」をする。

```
 PC（Claude Code） ──HTTP──▶ 中継サーバー（同じ Wi-Fi の PC 上の Node） ◀──WebSocket── iPhone の Safari（debug.js ＋ 運び役）
```

1. **運び役（transport）を1つ足す**：`?debug=1&relay=ws://192.168.x.x:8790` のように中継先を受け取り、WebSocket でつなぐ。受け取った `{ id, command, args }` を `YubiDebug.run(command, args)` に渡し、結果を `{ id, ...結果 }` で返す。`YubiDebug.subscribe` でログを流す。コアは変えない。
2. **中継サーバー**：Node 標準＋ws（または Node 22 の WebSocket）で数十行。PC 側には HTTP（`POST /run { command, args }` → 結果）を出し、Claude Code は curl で呼ぶ。
3. **段階**：(1) 読むだけ（info・layout・state・logs）→ (2) tap・storage → (3) 画面の撮影（必要なら）。

制限・注意：

- **https のページから ws://（暗号化なし）へはつなげない**（混在コンテンツ）。GitHub Pages は https なので、中継は wss://（証明書が要る）にするか、PC で http 配信したページを使う。
- **http（PC の IP アドレス）で配信すると Service Worker は動かない**（安全な接続でないため）。オフラインや更新の確かめは https の公開版で。
- 合成タップの制限（3 章）はそのまま。効果音の開始やダブルタップ拡大の抑止は、遠隔では確かめられない。
- 画面を消す・別のアプリへ移ると、Safari は接続を切る。つなぎ直しを運び役に入れる。
- だれでも命令を送れないよう、中継先の指定は `?debug=1` のときだけ・接続時に合言葉（毎回変える短い文字）を付ける。storage の set は保存データを書き換えるので、遠隔では確認してから使う。
- 本物の iPhone を PC の Safari の Web インスペクタにつなぐ方法（Mac が要る）の代わりになるもので、Windows でも使える。
