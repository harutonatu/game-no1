# 計画書：街づくり（仮名。画面の名前は ぼくのまち）

作成 2026-11-26（PM・Opus）。状態：**計画（作るのはまだ）**。決まりの正は約束 [docs/machi-contract.md](../machi-contract.md)。この計画で決めたことは同じコミットで約束にも書く（W-09）。

## 0. ユーザーの言葉（承認・そのまま）

- 「わかりました、オリジナルで進めてください」
- 「Aで進めて」（見本 A：真上から見たドット絵）
- 「対応する端末ですが、iphonexs以降をベースにしてください」
- 「市民からの苦情はあるの？」（→ 約束 §5.18 市民の声。PM の仮。§10 で確かめる）
- そのほかの言葉は約束 §0 にそのまま引用してある。

**まねないこと**：初代シムシティ／Micropolis の名前・絵・画面の配置・決まりの写し・コードは使わない。担当には「Micropolis のコードや資料を開かない・参考にしない」と指示に書く。

## 1. 方針と評価基準

| 基準 | 合格の目安 |
|---|---|
| 核：街が育つ楽しさ | 何もしないと育たない・置き方で育ち方が変わる（CL の自動プレイ：`none` は人口 0 のまま、`greedy` は 10 年で まち、`grid`（みどり・せんろ を使う）が `factory`（こうばを固める）より すみやすさ が高い） |
| 緊張（あまいものあつめの教訓 ①） | 置き方が悪いと人が減る（`factory` で よごれ・渋滞により人口が一度でも 10% 以上減る）。理由が言葉で出る |
| 絵（教訓 ②） | 寄ったとき 1 マス 22px 以上。引いたときは町の模様に見える |
| 重さ | iPhone XS（A12）で 1 コマ 16ms 以内（約束 §6.3 のテストの目安） |
| 画面 | 基準 375×812 で見本 A に近い。SE 縦は窮屈でよいが押せない所が無い |
| 遊ぶ人を尊重 | いつでも止められる・閉じても続き・保存が壊れても落ちない・X-20 |

## 2. ファイルの分け方

| ファイル | 中身 |
|---|---|
| `games/machi/index.html` | 画面（DOM・CSS）。`<title>` の直後で `../../common/debug.js`、`common/sfx.js`・`common/version.js`・`common/notice.js`・下の 4 つを読む |
| `games/machi/logic.js` | `window.MachiLogic`（地形・育ち・お金・仕事・渋滞・よごれ・できごと・市民の声・保存・自動プレイ）。画面に触らない。Node でも動く（テストが `require`/読み込みで呼ぶ） |
| `games/machi/sprites.js` | `window.MachiSprites`（ドット絵の表。12×12 ドットの文字の絵と色）。描画担当が持つ |
| `games/machi/render.js` | `window.MachiRender`（引いた絵・寄った絵・プレビュー・めがね・飾り・カメラ） |
| `games/machi/input.js` | `window.MachiInput`（1 本指・2 本指の見分け、タップ・なぞる・つまむ） |
| `games/machi/main.js` | 画面と進行（ループ・カード・保存のタイミング・X-20・効果音・デバッグの命令） |

## 3. 部品と担当（モデル）・編集してよいファイル

| 部品 | 担当（モデル） | 編集してよいファイル |
|---|---|---|
| A ロジック | **Opus**（決まりを数値に起こす・自動プレイで数値合わせ・判断が要る） | `games/machi/logic.js`、`tests/cases/machi-logic.mjs`（CL） |
| B 描画と入力 | **Opus**（ドット絵・オフスクリーンとチャンクの使い分け・性能・つまむ操作） | `games/machi/render.js`、`games/machi/sprites.js`、`games/machi/input.js` |
| C 画面と進行 | **Sonnet**（約束 §7・§8 を写す） | `games/machi/main.js`、`games/machi/index.html` |
| D 効果音とメニュー・配信 | **Sonnet** | `common/sfx.js`（machi の表と `GAP_MACHI`）、`index.html`（`GAMES` のカードと絵 `machi` だけ）、`sw.js`（`APP_FILES` に 6 ファイル） |
| E テスト | **Sonnet**（A・B・C のあと。決まった形のテスト） | `tests/cases/machi-ui.mjs`（CW）、`tests/mutants/mutate.mjs`（MC）、共通テストのゲームの表（`tests/cases/layout.mjs` などに 13 本の一覧があれば machi を足す。足す所は E が探して PM に報告してから） |
| F 版上げ・関門・git | **Haiku**（決まった手順だけ。「書いた命令のほかの道具は使わない」と指示に書く。W-07） | `common/version.js`、`sw.js` の `CACHE_VERSION` |
| 確かめ | **Opus**（PM） | 計画とのずれを見て直しを割り振る |

- どの担当にも「計画・約束とちがう・迷う所があれば、直さずに止まって報告する」と書く。ユーザーの承認の言葉（§0）を指示にそのまま引用する。
- A と B は同時に作る（§4 の約束で）。B は A ができるまで、約束の state の形の偽物（地形と少しの建物）で描いてよい。

## 4. 部品どうしの約束

### 4.1 MachiLogic（A が作り、B・C・E が使う）

state の形・定数・関数・events は **約束 §6** のとおり（ここに写さない。正は約束）。要点：

- `terrainChoices(seed)`・`newGame(seed, choice, name)`・`step(state, dt) → { state, events }`・`canPlace`・`place`・`lineCells`・`rectCells`・`inspect`・`summary`・`setTax`・`setSpeed`・`rename`・`normalizeName`・`starReasons`・`voiceOf`・`makeSave`・`loadSave`・`validateBest`・`simulate`・`formatMoney`・`formatPop`・`dateText`。
- events：`place`・`erase`・`deny`・`grow`・`shrink`・`month`・`money`・`rank`・`best`・`event`・`eventEnd`・`jam`・`news`・`leave`・`voice`。
- `state.dirty`（変わったマスの添字）と `state.gen`。B は読んだら `[]` にしてよい。

### 4.2 MachiRender（B が作り、C が使う）

```js
const r = MachiRender.create(canvas, { cssW, cssH, dpr });
r.setState(state)                 // 新しく始めた・読み込んだ：オフスクリーンを全部描き直す
r.frame(state, events, dt)        // 毎コマ（変わる物が無ければ何もせず false を返す）
r.resize(cssW, cssH, dpr)
r.camera() → { cx, cy, cell }     // 見ている真ん中（マスの座標）と 1 マスの css px
r.setCamera({ cx, cy, cell })     // cell は 5〜28 に切る
r.panBy(dxCss, dyCss); r.zoomBy(f, pxCss, pyCss); r.fit()   // fit＝地図全体
r.cellAt(pxCss, pyCss) → { x, y, i } | null
r.setPreview({ tool, cells, ok, cost, label }) | r.setPreview(null)
r.setView('normal' | 'poll' | 'jam' | 'live' | 'land')
r.flash(i); r.focus(i)            // 市民の声を押したとき：そこへ寄って 2 秒光らせる
r.thumb(terrain, canvas)          // 地形えらびの小さな絵
r.stats() → { drawMs, chunks, cars, trains }   // テスト・デバッグ用
```

- 「こんざつ」の ふきだし は events `jam` を見て B が描く。カメラは B が持つ（ロジックは知らない）。
- `prefers-reduced-motion` では飾り（車・電車・煙）を止める。

### 4.3 MachiInput（B が作り、C がつなぐ）

```js
const detach = MachiInput.attach(canvas, {
  hasTool: () => bool,
  onTap(px, py), onPaintStart(px, py), onPaintMove(px, py), onPaintEnd(px, py), onPaintCancel(),
  onPan(dx, dy), onPinch(f, cx, cy)
});
```
- 1 本指：`hasTool()` が真ならなぞる＝paint、偽なら pan。2 本指：pan と pinch（paint 中に 2 本目が来たら `onPaintCancel`）。動きが 8px 未満で離したらタップ。

### 4.4 DOM・効果音・保存（C が作る。正は約束 §7〜§9）

- DOM の id：`#topBar` `#backBtn` `#nameBtn` `[data-cmd="help"]` `#stats` `#moneyText` `#popText` `#starText` `#newsBar` `#newsText` `#dateText` `#mapWrap` `#mapCanvas` `#viewBtn` `[data-cmd="zoom-in"]` `[data-cmd="zoom-out"]` `#speedBtns [data-speed]` `#zoomHint` `#voiceBar` `#toolHint` `#tools [data-tool]` `#terrainCard [data-terrain] [data-cmd="reroll"]` `#nameCard #nameInput [data-cmd="name-ok"] [data-cmd="name-cancel"]` `#infoCard` `#rankCard` `#helpCard` `#restartCard [data-cmd="restart"]`。
- 効果音：`YubiSfx.create("machi")`：`select` `place` `road` `rail` `green` `erase` `deny` `grow` `rank` `voice` `good` `oops`（＋共通の `start` `best` `toggle`）。
- 保存：`machi.save` `machi.bak` `machi.save.v<n>` `machi.best` `machi.seen`。形と X-20 は約束 §8（もくもくこうば `games/seizai/main.js` の `saveNow`・`keepBroken`・`reloadIfStale` の形を写す）。
- デバッグの命令（`YubiDebug.command`。テストも使う）：`stats`（summary・`r.stats()`・`stepMs`）・`addmoney(n)`・`skip(months)`（速く進める）・`setspeed(s)`・`event(kind)`・`voice(why)`・`demo(months)`（`greedy` で町を作って読み込む。性能のテスト用）・`setstate(save)`。

### 4.5 メニュー（D）

`GAMES` に `{ name: "ぼくのまち"（仮。§10）, desc: "みちと いえを おいて、まちを そだてよう。こんざつや よごれに きをつけて", url: "games/machi/", best: "machi.best", art: "machi" }`。絵は見本 A の色の小さな町。

## 5. 作る順番（関門つき）

1. **段 0 計画の確かめ**：§10 をユーザーに聞く（答えを約束に書く）。
2. **段 1 動く試作**（A・B 同時 → C。テストは CL の一部だけ）：中身は 地形えらび・みち／すむ／しごと／おみせ・育つ・お金・時間（とめる・はやく）・拡大縮小と動かし方・引いた絵と寄った絵・渋滞の ふきだし・保存。できごと・市民の声・めがね・節目のごほうび は後回しでよい。
   - **関門**：PM が Playwright で 375×812 の写真と数秒の動画を撮って見る。CPU 4 倍遅くで指で動かして重くないか測る。
   - **ユーザーに実機で触ってもらう**（あまいものあつめの教訓 ③）。触り方（公開のしかた）は PM が一人で決めずに §10 で聞く。ここでの感想で決まりと数値を直してから先へ進む。
3. **段 2 本作**：A が残り（せんろ・よごれ・できごと・市民の声・節目・めぐみ・自動プレイで数値合わせ → §6 の表）、B が めがね・飾り・ドット絵の仕上げ、C がカード・声・X-20、D が効果音とメニューと sw.js。
4. **段 3 テスト**（E）：§7。
5. **段 4 レビュー 6 観点**（§8）→ 指摘を直す（W-03）。直したらレビューの指摘に当たる所だけ確かめ直す。
6. **段 5 版上げ・関門・公開**（F）：版を上げる 3 つ → Chromium smoke・full、WebKit smoke（`HEADED=1 BROWSER=webkit WORKERS=1 xvfb-run -a`）が全部合格 → 変異 `MC` を流す → ユーザーの承認 → merge・fast-forward の push。

関門：どの段も、テスト（その段の分）が通らなければ先へ進まない。

## 6. 数値合わせ（A が `simulate` で測って書く）

約束 §5 の数値は仮。A は次を種 1〜8 で測り、この表に書いてから約束の数値を直す。

| 測る物 | ねらい |
|---|---|
| `greedy` で まち（1,000）までの月 | 遊ぶ時間で 5〜8 分（ふつうの速さ） |
| `greedy` で し（10,000）までの月 | 40〜60 分 |
| `none`（何も置かない） | 人口 0 のまま |
| `factory`（こうばを住む所のそばに固める） | 人口が一度 10% 以上減る・ほし 2 以下 |
| `grid`（みどり・せんろ・混ぜて置く） | 同じ年で `factory` より人口が多く ほし 3 以上 |
| お金 | `greedy` で はじめの 2 年に置く物が足りなくなる時がある（つまる緊張）が、マイナスが 12 か月続かない |
| 交差点 | 同じ量で 交差点だらけ の方が まっすぐ より渋滞の段が高い |
| 重さ | Node で 64×78 を `greedy` 20 年、`step` 1 回の中央と最大 |

（表は A が埋める）

## 7. テストの形

番号の頭は ほかのゲームとかぶらない **CL（ロジック）・CW（画面）・MC（変異）**。

- **CL**（`tests/cases/machi-logic.mjs`）：
  1. 地形：同じ種で同じ・3 つの型がちがう・置ける土地 55% 以上・いりぐちがある
  2. 置く：値段とお金・置けない地形・はしの値段・お金が足りないと足りる所まで・5 秒以内の取り消し・いりぐちは こわせない・使えない道具（rank）
  3. 育つ：みち が無い／いりぐちとつながらないと育たない・つながると育つ
  4. 住む場所 4 種類が 2 軸の表どおり（d と v を作った小さな地図で）・rank で使える種類・建て替えは 1 年続いたときだけ
  5. めぐみの種類が場所で決まる（海辺＝漁港・もりのそば＝林業・ほか＝はたけ）
  6. 仕事の釣り合い r と「しごとが たりない／ひとが たりない」
  7. 渋滞：交差点の方が混む・せんろで減る・段 2 以上で `jam`
  8. 電車：せんろ 8 マス以上で離れた塊が 1 つのつながりになる・7 マスでは ならない・駅は無い
  9. よごれ：こうばから広がる・みどりで減る・漁港が小さくなる
  10. お金：毎月の入る・出る・税のたかさ・マイナスで育たない
  11. 時間：`speed` 0 で進まない・1 か月＝16 tick・dt の切り
  12. できごと：割合（多数回で 10% ± の幅）・3 か月の間・はじめの 2 年は こまること が無い・かじ の広がり 3 マスまで・おおあめは 1 か月で戻る
  13. 市民の声：困りごとごとに `why` が出る・場所の添字・同じ声は 3 か月出ない・いい声
  14. 節目：rank が上がる・下がらない・お祝いのお金・`best`
  15. 名前：`normalizeName`（空白・制御文字・11 文字・空・絵文字）
  16. 保存：往復で同じ・壊れた値（JSON でない・長さちがい・範囲外・v ちがい）で `null`・数の範囲外は直して読む
  17. 自動プレイ：§6 のねらい（`none`・`greedy`・`factory`・`grid`）
  18. 重さ：Node で `step` の中央
- **CW**（`tests/cases/machi-ui.mjs`）：開く→地形えらび→始まる・あそびかた・道具を選んで置く（お金が減る）・なぞって みち・こわす・しらべる カード・拡大縮小（2 本指と ＋− ボタン）・14px 未満で置くと寄る・とめる／はやく・名前を変える（10 文字・空）・めがね・市民の声を押すと地図が動く・節目のカード・開き直して続き・壊れた保存で落ちず `machi.bak`・X-20（別のタブで進めた保存へ開き直す・知らせ）・さいしょから・メニューへ戻る・メニューのカードとベスト・375×812 で見本 A の並び・SE 縦横でも はみ出し 0 と 44px・最大のけた・コンソールエラー 0・オフライン（sw）・性能（約束 §6.3。`flaky`）。
- **MC**（変異。`node tests/mutants/mutate.mjs both` の machi の分）：育つ条件・2 軸のしきい・交差点の受け止め量・せんろの 8 マス・よごれの減り・お金の計算・できごとの間・保存の検証・名前の上限。置換元が今のコードに 1 回だけあることを確かめる。
- 共通のテスト（版の L10・sw・DG1・画面の大きさの一覧など）に machi を足す所は E が探す。

## 8. レビュー（6 観点。新しいゲーム）

技術（Opus）・UX（Sonnet）・中毒性 10 項目（Sonnet）・品質 10 項目（Sonnet）・アクセシビリティ（Sonnet：回す操作が要らない・＋− ボタン・色だけに頼らない・片手）・性能（Opus：XS 相当・CPU 4 倍遅く）。中毒性 3・5 と品質 5・6 が 3 点以下なら、方針として残さず直す（あまいものあつめの教訓 ①）。

## 9. 気をつけること（PM の見立て）

- 以下は私の推測です：いちばん難しいのは「育ち方の数値」と「寄った絵の重さ」。どちらも段 1 の試作で先に確かめる。
- 1 マス 5px の引いた絵ではタップが当たらないので、置こうとしたら寄る決まり（約束 §7.2）を必ず入れる。
- 保存は 64×78 の配列 6 枚の base64（約 30KB 前後）。localStorage の容量は足りる。

## 10. ユーザーに聞くべき残りの決め（勝手に決めずに残す。PM の仮で約束に入れてある）

**答え（2026-11-26。ユーザーの選んだ言葉そのまま）**：1 メニューの名前「ぼくのまち (Recommended)」／5 こまるできごと「入れる（はじめ 2 年は無し） (Recommended)」／7 さわり方「なぞって置く (Recommended)」／9 試作の触り方「メニューにも出す」（PM：メニューに「しさくちゅう」の札を付けて並べる。公開は関門を通してから）。2・3・4・6・8 は聞いていない → PM のおすすめ（①）のまま進め、試作を触ってもらったあとに直す。


1. **メニューに出すゲームの名前**：①「ぼくのまち」（画面の名前と同じ。**おすすめ**）②「まちそだて」③ ほかの名前。
2. **第一次産業のボタンの名前**（陸・山・海で置いた場所により はたけ・林業・漁港 になる 1 つのボタン）：①「めぐみ」（自然のめぐみ。**おすすめ**）②「はたけ」（海や山でも同じ名前）③ 3 つのボタンに分ける（ボタンが 10 個になり狭い）。
3. **小さい画面（iPhone SE・8）の扱い**：①「遊べるが窮屈でよい（押せない所・崩れは無し）」（**おすすめ**。PM の仮）② SE でも見本どおりにする（地図が小さくなる）。
4. **市民の声**：① 苦情といい声の両方を、押すとその場所へ動く形で入れる（**おすすめ**。PM の仮）② 苦情だけ ③ 入れない。
5. **こまるできごと（おおあめ・かじ）**：① 入れる・責めない・はじめの 2 年は無し（**おすすめ**。PM の仮）② 「こまることを おこさない」設定も付ける。
6. **お金がマイナスのとき**：① ゲームは続き、プラスに戻るまで育たない・置けない（**おすすめ**。PM の仮）② お金を借りられる。
7. **さわり方**：① 道具を選んでいると 1 本指で なぞって置く・地図を動かすのは 2 本指か 道具を選んでいないとき（**おすすめ**。PM の仮）② 1 本指はいつも地図を動かし、置くのはタップだけ（みちを 1 マスずつ置くので手間）。
8. **1 か月の長さ**：① 4 秒で試作し、触ってから決める（**おすすめ**）② 先に決める。
9. **試作を実機で触る方法**：① 公開版（master）に `games/machi/` を置くが、メニューには出さず URL だけ伝える（**おすすめ**。ホーム画面のアプリと同じ Safari で触れる）② PM の写真・動画だけを見る（実機で触らない）③ そのほか。
