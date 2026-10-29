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
- **置き場所の決め方**：画面（safe-area の内側、端から 4px）を 4px 刻みで調べ、重なりの重さが一番小さい所に置く。押せる要素（button・a・input・[role=button]・[data-cmd]・[data-action]）は 4px 広げて重さ 1000（必ず避ける）、canvas・img・svg（盤面・絵）は 3、文字は行ごとの四角で 2。同じなら画面の端に近い所。見直すのは、画面の大きさが変わったとき（回転）と 1 秒ごと（今の場所が何かと重なったときだけ動かす）に加えて、**押せる要素が出入りしたとき**（MutationObserver で `hidden`・`inert`・`aria-hidden` の付け外しと要素の追加・削除を見張る）。カード（遊び方・2択・クリア・エンディング）が出た・消えた直後にすぐ置き直すので、出てから 1 秒のあいだカードのボタンをふさがない（T-33）。文字や色の書きかえ・毎フレームの表示更新では動かない。メニューのように縦に流れるページでは、流したあとカードに重なることがある（その時点で空いた所へ移る。空きがなければ一番重なりの少ない所）。
- パネル：エラーとログ（新しい順）・環境（info）・「コピー」「閉じる」「デバッグを終わる」。文字は 12px 以上、ボタンは 44px 以上、safe-area の内側に 8px あける。ボタンは `touch-action: manipulation`、ログ欄は `pan-x pan-y`（ダブルタップ拡大を起こさない）。パネルの中の操作はゲームの document・window へ伝えない（ゲームが反応したりスクロールを止めたりしないように）。
- 「コピー」は `navigator.clipboard.writeText`、だめなら `execCommand("copy")`、それもだめなら選択済みの枠を出して手でコピーしてもらう。

## 5. 遠隔操作（中継）の約束

計画は [docs/iphone-relay-plan.md](iphone-relay-plan.md)。ユーザー決定「はい、Aで進めましょう。まずは計画を立案して」「はい、段0〜3を進めて」。
この章が、作る担当（中継サーバー・運び役・テスト）どうしの**約束**です。ここに無いことを勝手に決めたときは、報告に書く。

```
 PC（Claude Code） ──HTTP（127.0.0.1 だけ）──▶ 中継サーバー tests/relay/relay.mjs ◀──WebSocket /relay── iPhone の Safari
   node tests/relay/ask.mjs                       （ゲームのファイルも配信する）            debug.js ＋ common/debug-relay.js
```

### 5.1 ファイルと担当

| ファイル | 中身 | Node の標準だけ |
|---|---|---|
| `tests/relay/relay.mjs`（新規） | 中継サーバー：静的ファイルの配信・WebSocket・PC 向けの HTTP の窓口 | はい（`ws` などのパッケージは使わない。WebSocket は自分で書く） |
| `tests/relay/ask.mjs`（新規） | Claude が命令を送る道具（Windows の PowerShell でも使える） | はい（`fetch` を使う） |
| `common/debug-relay.js`（新規） | 運び役：iPhone の Safari の中で中継につなぎ、命令を `YubiDebug.run` に渡す | ブラウザ（ES5 寄りで書く。debug.js と同じ書き方） |
| `common/debug.js`（数行だけ） | `relay` の URL を読み、有効なら debug-relay.js を読み込む | |
| `tests/cases/relay.mjs`（新規） | テスト RL 系 | |

- `common/debug-relay.js` は `sw.js` の `APP_FILES` に**入れない**（http でしか使わない）。
- 中継は**テストの道具**で、公開版のゲームの動きは変えない。`?debug=1&relay=1` を付けないときは debug-relay.js を読み込まない。

### 5.2 有効にする URL（debug.js が読む）

| URL | 動き |
|---|---|
| `?debug=1&relay=1&key=1234` | sessionStorage `yubi.relay` に合言葉 `1234` を覚え、debug-relay.js を読み込む |
| `?relay=0` | `yubi.relay` を消す（つながない） |
| `?debug=0` | デバッグをやめるとき、`yubi.relay` も消す（前の合言葉で勝手につながらないように） |
| 何も付けない | `yubi.relay` があれば読み込む（メニュー→ゲームと移っても続く） |

- `relay` を見るのは、デバッグが有効（`?debug=1` か覚えている）のときだけ。無効のときは今までどおり何もしない（DG2）。
- `key` は英数字 1〜16 文字だけ受け付ける。ほかは無視（つながない）。
- 読み込み方：debug.js 自身の `src` と同じ場所の `debug-relay.js` を `<script>` で足す（`document.currentScript` の src から作る。ページの深さ（メニュー・`games/<名前>/`）に関係なく正しい場所になる）。読めなくてもゲームは動く。
- 「デバッグを終わる」（`YubiDebug.stop()`）では `yubi.relay` も消し、接続を閉じる。
- `open`・`reload` で移るときは、移る先の URL に `debug=1&relay=1&key=（今の合言葉）` を**付けて**移る（T-11）。iPhone の Safari では、命令（WebSocket の受信からのタイマー）で移ったときに sessionStorage の印が新しいページで読めないことがあり、🐞 が出ず中継にもつなぎ直さなかったため。URL に付いていれば印が無くても必ず有効になる。合言葉を URL に載せるのは最初に開く URL と同じ形で、合言葉の安全性（8 文字・別サイトを断る・5 回で締め切り）は変わらない。

### 5.3 運び役（common/debug-relay.js）

- つなぐ先：`(https なら wss: さもなければ ws:)//location.host/relay`。ページを配信している中継サーバーそのもの。
- つないだらすぐ `{ type:"hello", key, page: location.pathname + location.search, info: (YubiDebug.run("info") の result) }` を送る。
- 受け取るもの：
  - `{ type:"welcome" }`：つながった。
  - `{ type:"run", id, command, args }`：`YubiDebug.run(command, args)` の戻り値に `type:"result"` と `id` を足して送り返す：`{ type:"result", id, ok, result|error, command, ms }`。
  - `{ type:"ping" }`：`{ type:"pong" }` を返す。
- 送るもの（ほか）：`YubiDebug.subscribe` の `log` の出来事を `{ type:"log", entry }` で送る（つながる前のログは、hello の直後に `YubiDebug.logs()` から最大 100 件まとめて送る）。
- **つなぎ直し**：切れたら 1・2・4・8・10・10…秒の間隔でつなぎ直す。`visibilitychange` で画面が見えたら、すぐつなぎ直す。
- 中継が合言葉違いで閉じたとき（閉じるコード **4001**）は、つなぎ直さない。`YubiDebug.log("warn", "中継：合言葉が ちがいます。PC に出ている合言葉と、URL の key= を見くらべてください")`。
- 別の端末がつないで追い出されたとき（コード **4002**）も、つなぎ直さない。
- 運び役だけの命令を `YubiDebug.command` で足す：
  - `open`：引数 `{ path }`。同じサイトのページへ移る。`path` は `/` で始まり `//` で始まらないものだけ（`/games/hashi/` など。`?` 以降も可）。結果を返してから 100ms 後に移る。移る先の URL の `debug`・`relay`・`key` は `1`・`1`・今の合言葉に置き換える（ほかの `?` と `#` はそのまま。5.2 の最後）。結果の `href` が実際に移る URL。
  - `reload`：結果を返してから 100ms 後に読み直す。今の URL に `debug=1&relay=1&key=…` が無ければ、付けた URL へ移し替える（`location.replace`。履歴は増やさない）。付いていればそのまま読み直す。
- テスト用の窓口 `window.YubiDebugRelay = { status() → "connecting"|"open"|"closed"|"rejected", stop() }`。
- 例外を外へ出さない。WebSocket が無い・つながらなくても、ゲームとデバッグ表示は動く。

### 5.4 中継サーバー（tests/relay/relay.mjs）

起動：`node tests/relay/relay.mjs [--port 8790] [--key 1234] [--root <リポジトリ>] [--host 0.0.0.0] [--exit-on-stdin-close]`。

- 既定：ポート 8790（環境変数 `RELAY_PORT` でも可）、合言葉は起動のたびに **8 文字**を作る（紛らわしい `0 o O 1 l i I` を除いた英小文字と数字、crypto の乱数。`--key` で固定。テスト用）、root はこのファイルの 2 つ上（リポジトリの一番上）、host は `0.0.0.0`（同じ Wi-Fi の iPhone から届く）。
- `--exit-on-stdin-close`：標準入力が閉じたら終わる（テストから起動したときだけ付ける。親のテストが落ちても中継が残らない）。人が使うときは付けない（動きは今までどおり）。
- 起動したら、最初の 1 行に `RELAY_READY port=<ポート> key=<合言葉>`（テストが読むので形を変えない）。そのあと PC の IPv4 アドレス（内部・ループバック以外）ごとに、iPhone で開く URL を出す：`http://192.168.x.x:8790/?debug=1&relay=1&key=…`。URL が複数あるときは、ふつうの LAN（Wi-Fi・有線）を先に、仮想のネットワークを後ろに並べ（T-12）、先頭に「おすすめ」、仮想のものに「（仮想のネットワーク。ふつうは使わない）」と添える。仮想とみなすのは、アダプタ名（`os.networkInterfaces` のキー）に VirtualBox・VMware・Hyper-V・vEthernet・WSL・Docker などを含むもの、`192.168.56.x`（VirtualBox の既定）、`172.16〜31.x`（WSL・Hyper-V・Docker の既定）、`169.254.x.x`（つながっていないアダプタ）。名前とアドレスで分からないもの（例：名前が「イーサネット 3」の VirtualBox）も、MAC の先頭（VirtualBox `0a:00:27`・`08:00:27`、VMware `00:50:56`・`00:0c:29`・`00:05:69`、Hyper-V `00:15:5d`。大文字・`-` 区切りも可。`isVirtualMac(mac)`）で仮想とみなす。ふつうの LAN の中では `192.168.` → `10.` → そのほかの順。並べ方は純粋関数 `orderLanAddresses(nets)`（export。入力は `os.networkInterfaces()` と同じ形、出力は `[{ address, name, virtual }]`）。合言葉と「止めるときは Ctrl+C」も出す。
- 出来事を 1 行ずつ出す：つながった（端末の幅×高さ・ページ）、切れた、合言葉ちがい、命令（名前・ok・ms）。
- **静的ファイルの配信**：root の下だけ（`..` や絶対パスで外へ出ない）。`.` で始まる部分（`.git` など）・`:`・`~`（Windows の 8.3 形式の短い名前 `GIT~1`）を含む道は 404。シンボリックリンクなどは実際の場所（`fs.realpathSync.native`）で確かめ、root からの相対パスに `.` で始まる部分があれば 404（Windows では大文字小文字を区別せずに比べる）。フォルダに `/` が無いときの 301 の移す先は、先頭の `/` を 1 つにまとめた同じサイトの道（`//games` → `/games/`。よそのサイトへ移さない）。`/` で終わる URL は `index.html`。`/game-no1/` で始まる URL も同じものを返す（GitHub Pages と同じ形でも開ける）。拡張子に合った Content-Type（html・js・mjs・css・json・webmanifest・png・svg・ico・txt）。`Cache-Control: no-store`（直したらすぐ見える）。無ければ 404。
- **WebSocket**：`/relay` の Upgrade だけ。RFC 6455 の最低限（握手・テキストの枠・マスク・分割の枠・ping/pong・close）。1 つの枠は 8MB まで（超えたら閉じる）。20 秒ごとに `{type:"ping"}` を送る。
  - **なりすまし対策**：Upgrade の `Host` は IP アドレス（IPv4・`[IPv6]`）か `localhost` だけ（名前は断る。DNS リバインディング対策。iPhone は `http://192.168.x.x:8790/` のように IP で開く）。`Origin` は `http://` ＋ `Host`（https なら `https://`）と同じものだけ（無いもの・違うものは断る）。断るときは握手せず HTTP 403。
  - hello の `key` が違えば、コード 4001 で閉じる。間違いを数え、**5 回**になったら起動し直すまで hello をすべて（正しい合言葉でも）4001 で断り、PC の画面に出す。hello の前の命令は受け付けない。10 秒以内に hello が無ければ閉じる。
  - hello の前は 1 つの枠を 64KB まで（超えたら 1009 で閉じる）。hello の前の接続は 8 本まで（9 本目は握手せず HTTP 503）。握手と同じ包みで届いた最初の枠も読む。
  - 受け取ったログは 1 件 32KB までに切り詰める（超えたら `{ level, truncated:true, text }`）。
  - つなげるのは 1 台だけ。新しい端末が正しく hello したら、古い接続をコード 4002 で閉じる。
- **PC 向けの窓口**（**ループバック（127.0.0.1・::1）からだけ**。ほかは 403。答えはすべて JSON）：

| 窓口 | 答え |
|---|---|
| `POST /run` 本文 `{ command, args, timeoutMs }` | 運び役の result（`{ ok, result|error, command, ms }`。`type`・`id` は外す）。つながっていない：`{ ok:false, error:"iPhone が つながっていません" }`。待ちは既定 10 秒・最大 60 秒、過ぎたら `{ ok:false, error:"時間切れ" }`。途中で切れたら `{ ok:false, error:"とちゅうで きれました" }` |
| `GET /status` | `{ ok:true, connected, key, port, device: { userAgent, page, screen:{w,h}, connectedAt, lastSeen } \| null, badKeys, locked }`（`badKeys`＝合言葉の間違いの数、`locked`＝5 回で締め切ったか） |
| `GET /logs?since=<番号>` | `{ ok:true, last, entries: [{ seq, at, page, entry }] }`。中継が受け取ったログ（最大 1000 件、古いものから捨てる）のうち、seq が since より大きいもの |
| `GET /wait?timeoutMs=<ms>` | つながるまで待つ（既定 15 秒・最大 60 秒）。`{ ok:true, connected:true, device }` か `{ ok:false, error:"時間切れ" }`。`open`・`reload` のあとに使う |

### 5.5 命令の道具（tests/relay/ask.mjs）

```
node tests/relay/ask.mjs <命令> [引数…] [--yes] [--port 8790] [--timeout 10000]
```

- 特別な命令：`status`・`logs [--since N]`・`wait`（それぞれ 5.4 の窓口）。ほかは `POST /run`。
- 引数は `名前=値` を並べる（PowerShell で JSON の引用符に困らないように）：`ask.mjs layout selector=#board limit=20`、`ask.mjs tap x=100 y=200`。値は JSON として読めればその値（数・true・null）、だめなら文字列。引数が 1 つで `{` で始まるなら JSON の本文として使う。引数が `名前=` の形でない 1 つだけなら、そのまま args にする（`ask.mjs layout "#board"`）。
- `storage` の `op=set` と `op=remove` は `--yes` が無いと送らず、理由を出して終わる（保存データを消さないため）。
- 出力は整形した JSON（標準出力）。終了コード：0＝ok、1＝ok:false、2＝中継に届かない（「中継が 動いていません：node tests/relay/relay.mjs で起動してください（別の PowerShell の窓で node tests/relay/relay.mjs を動かしたままにしてください。ポートを変えたときは --port を付けます）」）。
- `status` で `connected:false` のときは、答えの JSON に `hint`（「iPhone でまだ開いていないか、つながっていません。tests/README.md の『うまくいかないとき』を見てください」）を足す。
- 引数なしのときの使い方の表示に、よく使う命令（info・layout・state・open・logs）と「まず status で "connected": true を確かめてから使います」を出す。

### 5.6 テスト（RL 系、tests/cases/relay.mjs）

テストは relay.mjs を子のプロセスとして `--key` 固定・空いているポートで起動し、Playwright のページを iPhone の代わりにつなぐ。Chromium と WebKit の両方で合格すること。

| 番号 | 確かめること |
|---|---|
| RL1（smoke） | 起動 → `?debug=1&relay=1&key=…` で開く → `/status` が connected、`info`・`layout`・`state`・`logs` が `/run` で返る |
| RL2 | 合言葉が違うとつながらない（4001・`YubiDebugRelay.status()` が rejected・つなぎ直さない） |
| RL3 | `open` でメニュー→ゲームへ移っても、`/wait` のあと命令が通る（移る先の URL に `debug=1&relay=1&key=` が付く。sessionStorage も残る） |
| RL4 | 中継を止めて起動し直すと、運び役が自動でつなぎ直す |
| RL5 | `relay` を付けない（`?debug=1` だけ）・`?debug=1` も無いときは debug-relay.js を読み込まない（時間で待たず、load と `YubiDebug` ができたことで判定）。`?relay=0`・`?debug=0`・「デバッグを終わる」で `yubi.relay` が消える |
| RL6 | ask.mjs：`storage op=set` は `--yes` が無いと送らない、中継が無いと終了コード 2、`名前=値` の読み方 |
| RL7 | 静的配信：root の外（`/../`・`%2e%2e`）は読めない、`/game-no1/` でも開ける、`~` を含む道・隠しフォルダへのリンクは 404、`//games` の 301 は `/games/` へ、PC 向けの窓口はループバック以外 403（ループバック以外からの要求が作れないなら、判定の関数を直接確かめる。Windows の形は判定の関数で確かめる） |
| RL8 | 2 台目がつなぐと 1 台目が 4002 で閉じられ、つなぎ直さない |
| RL9 | Node だけ（偽の端末）：握手と同じ包みの hello・分割の枠・途中の ping・バイト単位の分割・長さ 127 形式・1 回に複数の枠・ログの切り詰め・hello 前の 64KB 上限・`--exit-on-stdin-close` |
| RL10 | なりすまし対策：別の Origin・Origin 無し・名前の Host は 403、合言葉 5 回間違いで正しい合言葉でも 4001、既定の合言葉は 8 文字、hello 前の接続は 8 本まで |
| RL11 | `open`・`reload` で移るとき、sessionStorage の印が消えていても（iPhone で起きたことのまね）、移った先でデバッグが有効（🐞）になり中継につなぎ直す。移る先の URL に `debug=1&relay=1&key=` が付き、`path` の `?`・`#` は残る（T-11） |
| RL12（Node だけ） | `orderLanAddresses`：ふつうの LAN が先・仮想（アダプタ名・192.168.56.x・172.16〜31.x・169.254.x.x）が後ろ・内部と IPv6 は除く・数字の family（Node 18.0〜18.3）も読む、起動の表示で先頭に「おすすめ」（T-12） |
