# v44・v45 計画書（いろびん：小さめの課題〔v44〕と 第 2 弾「なかよしちょう」〔v45〕）

- 作成：2026-10-26（計画担当・Opus）。もとにしたコード：作業ブランチ `claude/v30-handoff-docs-tftm14` の `d4136d3`（＝master＝**v43 公開済み**）。行番号はこのコミットのもの。少しずれていたら前後の文字で探す（見つからなければ止まって報告）。
- ユーザーの言葉（そのまま引用）：「**いろびん第二弾と小さめ、両方対応しましょう。まずは計画を立案して記録してください。sonnetやhaikuに依頼できるよう小さなタスクに分解してください**」。これは作業の指示で、質問ではない。
- 前からのユーザーの決定（そのまま）：「モデルを選択し、計画をしっかりと立案し、適正な軽いモデルを選ぶようにしましょう」。広告なしの方針（2026-10-19「広告なしの方針を維持」）。回数は「測らない」（2026-10-25）。IB-24 のテンポ「今のまま」。
- 実行の担当への指示には、上の言葉をそのまま入れ、「**計画とちがう・迷う所があれば、直さずに止まって報告する**」と書く（CLAUDE.md 3 章）。Haiku には「**書いた命令のほかの道具（会話を作る・メッセージを送る・予定を作るなど）は使わない**」と書く（W-07）。
- テストを流すときの PORT はタスクごとに決めた値（8710〜8789）を使う。WORKERS は書いた値（ふつう 1。関門だけ 3）。`pkill` の広い停止はしない。
- 計画のときに使った台本と結果（確認の Opus が比べるときだけ使う）：`/tmp/claude-0/-home-user-game-no1/05d90edc-3e79-52f4-9c0f-1e4cb2d395a2/scratchpad/v44/`
  - `probe.mjs`（IB-35・IB-36・IB-39・IB-45 を v43 で調べた）、`ib45.mjs`・`ib45b.mjs`（錠の大きさを変えて重なりを測った）、`head.mjs`（上の帯の空き）
  - `logic-book.js`（T45-02 のかたまりを今の logic.js に入れた写し。BL26 の (a)〜(h) の値を Node で確かめた）
  - `www/game-no1/games/irobin/render.js`（v45 の おしゃれ `drawDress` を入れた写し。`render-dress.diff`）、`dress.png`（6 匹 × 6 段を 56×60px で描いた絵）
  - スクリーンショット：`ib36-320x454.png`（初回の遊び方。SE の Safari で下が切れる）、`ib45-320x454.png`（錠が上の段にかかる）、`head-320x568.png`

---

## 1. 対象の課題と、v43 でまだ当てはまるか（事実。v43 を Chromium で開いて確かめた）

| 課題 | 中身（短く） | v43 で当てはまるか | 扱い |
|---|---|---|---|
| IB-34 | 続けて遊ぶ理由が残らない（星・手数・動物の数を保存しない） | **当てはまる**。保存は `irobin.best`・`save`・`help`・`cloth`・`small`・`only`・`lock` だけ（main.js:22-27）。星は `showClearCard`（main.js:554-602）で出すだけ | **v45**（第 2 弾） |
| IB-35 | 面を飛ばすとお客さんの動物が前の面のまま | **当てはまらない**。`setLevel` で 3→9→20→41→77→150→2→300 面と飛ばし、2 人の動物の読み上げ（`.sr`）が毎回 `animalFor(面, 0/1)` と一致した。v39（IB-08）で `build()` が新しい面のたびに `seenKind.clear()` と `c.kind = null` をする（render.js:664-666）ようになったため | **済・不要**（v39 で直っていた）。文書だけ直す（T44-12） |
| IB-36 | 初回の遊び方カードの文字が多い | **当てはまる**。初回のカードは 207 字（空白を除く）。SE の Safari 縦（320×454）ではカードの高さ 513px で、「わかった」の下の文（キーの説明）が切れてスクロールが要る（`ib36-320x454.png`） | **v44**（T44-02・T44-04）。指さしの動き（報告の後半）は入れない（v41 で 1・2 面の最初のヒント「うえの どうぶつさんが…」とトレイの指さしが入ったため。実機の様子を見てから） |
| IB-37 | Safari で 7 日開かないと保存が消えることがある（つづきコード案） | 当てはまる（推測を含む。仕組みは変わっていない） | **保留**。つづきコードは手間が大きい。v45 で記録が増えるので、まず IB-41（ホーム画面に追加の一言）を v45 に入れて様子を見る |
| IB-38 | 同じ面に挑戦するリンク `?lv=N` | 当てはまる（`?lv` は読まない） | **質問 4 の答えで決める**（★の地図・「もういちど」と同じ仕組みになるため。おすすめは v46 以降） |
| IB-39 | はじめての布のヒントで #hint の高さが動く | **当てはまらない**。4・5・6 面（布の説明あり・なし）で、SE 縦ホーム画面・SE 縦 Safari・SE 横 Safari・iPhone 13 縦 Safari の #hint の高さ（42px・42px・54.6px・42px）と盤の位置がどれも同じ。字も 15px（横は 13px）のまま。v41 で布のヒントを 5 面にし、横の短い文を足したため | **済・不要**。文書だけ直す（T44-12） |
| IB-40 | 共有に盤面の絵を付ける | 当てはまる | **保留**。瓶は DOM なので絵を描き直す仕組みが要り、手間が大きい。広く出す時期（事業化の次の段）に回す |
| IB-41 | ホーム画面に追加を促す一言 | 当てはまる（どこにも無い） | **v45**（なかよしちょうの下に 1 行。T45-06） |
| IB-42 | 予告の中身を 40 面以降でも意味のあるものに | 当てはまる。105 面から先の節目は「つぎは ○めん」だけ（main.js:491-503・M5） | **v45**（なかよしちょうの「あと ○にんで ○○」を予告に使う。T45-07） |
| IB-45 | 背の低い画面で、かぎの錠が上の段の瓶の底にかかる | **当てはまる**。109 面で SE 縦 Safari 6.7px・SE 横 Safari 6.1px、**SE 縦ホーム画面でも 2.0px** かかる（iPhone 13・iPad はかからない） | **v44**（T44-03・T44-05） |
| IB-46 | 「とける ところまで もどす」が最初まで戻る | **v43 で直して公開済み**（`e86e5f0`）。課題表は「作業中」のまま | 文書だけ直す（T44-12。issues-done.md へ移す） |
| X-26 | ほかの 11 本の description・OGP | 当てはまる（いろびん以外の 11 本の head に description・og:* が無い） | **v44**（T44-06〜T44-08） |
| X-27 | ほかのゲームを SE の Safari で見るテストが無い | 当てはまる。計画担当が仮の項目で 2048 縦横・ハシ縦横・ブロック縦・キリトリ縦横・ピカッと縦横の 9 画面を流し、**9/9 合格**（崩れていない）。項目はまだ無い | **v44**（T44-09。テストだけ） |

---

## 2. 版の分け方（おすすめ）

**おすすめ：v44＝小さめ（IB-36・IB-45・X-26・X-27 と文書の整理）、v45＝第 2 弾（IB-34・IB-41・IB-42）。**

- 理由 1（事実）：v44 は保存の形を変えない（ゲームの仕組みは変えず、文言・見た目・meta・テストだけ）。ユーザーの答えを待たずに今すぐ作れる。変異テストも要らない（CLAUDE.md 5 章）。
- 理由 2（事実）：v45 は**新しい保存 `irobin.book` を足す**。課題表にも「第 2 弾は保存の形が変わるので、別の版にする」とある。版を分けると、不具合が出たときにどちらの変更か切り分けやすい。
- 理由 3：v45 の見た目・入口・残す記録は 7 章の質問の答えで変わる。v44 を先に出せば、その間に答えをもらえる。
- v46（候補）：質問 4 で C を選んだときだけ、★の地図と「もういちど」（IB-38）を別の版にする。

---

## 3. v45 の保存の形（PM の決定。7 章の答え〔2026-10-26〕で決まった）

- 決まったこと（8 章の答えから）：Q1＝**動物ごとに違う おしゃれ・3 段**、Q2＝**クリアのカードから開く**、Q3＝**0 から数える**（古い保存から数を作らない）、Q4＝**動物の数＋面ごとの★と手数**。

### 3.1 キーと形

- **新しいキー `irobin.book`**（なかよしちょう）。今の `irobin.save`（v:3）・`irobin.best` は**変えない**。
- 形：`{ "v": 1, "a": { "kuma": 12, "usagi": 9, … }, "s": { "1": [3, 6], "2": [2, 17], … }, "last": 2 }`
  - `a`：動物 6 種（`ANIMAL_KEYS`）ごとの届けた数。0 のものは書かない。上限 1e9。
  - `s`：面ごとの記録 `[星 1〜3, 一番少ない手数]`。キーは面の番号の文字（`"1"`〜）。星 0（めやすが無い面）は書かない（Q4＝A）。
  - `last`：最後に動物の数を足した面（二重に数えないための印。3.3）。
- なかよしの段（0〜3）：届けた数が **10・50・200** で 1 段ずつ上がる（`BOOK_STEPS = [10, 50, 200]`）。決まった数で必ず上がる（ガチャではない）。
  - 理由（事実、Node。`logic-book.js` で数えた）：だれでも 0 から数えるので、1 面から始めると **10 人＝最初の動物が 10 面・6 匹そろうのが 13 面**、**50 人＝38 面・44 面**、**200 人＝127 面・135 面**。いまの 239 面から続ける人（ユーザー）は 10 人＝5〜7 面・50 人＝28〜32 面・200 人＝116〜123 面。最初のご褒美は 10 面ほどですぐ、最後は 130 面ほど先の長い目標になる。10・30・100 だと最後が 75 面（239 面からは 63 面）で早くそろいすぎ、15・60・250 だと最初が 13〜18 面で遅い。
- おしゃれ（Q1＝C。動物ごとに違う 3 つ。段が上がるたびに**重ねて**付ける。顔の目・口・鼻は隠さない）：

| 動物 | 段 1（10 人） | 段 2（50 人） | 段 3（200 人） |
|---|---|---|---|
| くま | あかい ちょうネクタイ（首） | むぎわらぼうし（頭の上・耳のあいだ） | きんの メダル（胸の右・青い ひも） |
| うさぎ | にんじんの バッジ（胸の左） | はなかんむり（頭のてっぺん・花 5 つ） | ほしの ステッキ（体の右に持つ） |
| ねこ | すずの くびわ（首・赤い わに金の すず） | さかなの バッジ（胸の左・青） | おうかん（頭の上・金に赤い玉） |
| ペンギン | あかい マフラー（首・右に たれる） | ニットぼう（みどり・白い ふちと ぼんぼり） | ふうせん（体の右から ひもで上へ・ピンク） |
| りす | どんぐりの バッジ（胸の左） | はっぱの ぼうし（頭の左上・こい みどり） | まるい めがね（目を囲む わ・目は見える） |
| ひつじ | あおい リボン（毛の右上） | ハートの バッジ（胸の左・ピンク） | とんがりぼうし（むらさきに きいろの水玉） |

  - 名前と動き（文に使う）は `render.js` の `DRESS_ITEMS`（T45-04）に 1 か所だけ書く：`[名前, 動き]`。動き：つけて・かぶって・かけて・もって・まいて。
  - 計画担当が試しに描いた絵（事実）：`/tmp/claude-0/-home-user-game-no1/05d90edc-3e79-52f4-9c0f-1e4cb2d395a2/scratchpad/v45dress/dress.png`（上から段 0〜3 を 56×60px、5 行目は段 3 の よろこぶ顔、下の段は 112×120px）。中の写し：同じ所の `www/game-no1/games/irobin/render.js`（`render-dress.diff`）、かたまりごとの写し `dress-frame.js`・`dress-a.js`・`dress-b.js`・`dress-c.js`。どの動物も顔を隠さず、56px でも見分けられた。メダル（くま）と すず（ねこ）は 56px では小さめ（確認 T45-13 で実機の大きさを見る）。

### 3.2 古い保存からの引き継ぎ・壊れた保存・新しい版の保存（`readBook(raw)`）

Q3＝B「0から数える」：**古い保存（`irobin.best`・`irobin.save`）から数を作らない**。帳面が無い人は、だれでも 0 から。`readBook` は `best` を受け取らない。

| `irobin.book` の中身 | 扱い | 書くか |
|---|---|---|
| 無い（null） | **空の帳面**（`{ v:1, a:{}, s:{}, last:0 }`） | 起動時には書かない（最初のクリアで書く） |
| JSON でない・オブジェクトでない・配列・`v` が 1 以上の整数でない | 無いときと同じ（空の帳面。最初のクリアで上書きして直る） | 起動時には書かない |
| `v` が 2 以上（これより新しい版が書いた） | 空の帳面として扱う | **書かない**（`write: false`。新しい版の記録をこわさない。古い版のページが残っていた場合の守り） |
| `v` が 1 | 使える分だけ使う：知らない動物・0 以下・小数・1e9 超の数は捨てる。面の記録は、キーが `^[1-9][0-9]{0,15}$` の安全な整数で、値が `[1〜3, 1〜1e9 の整数]` のものだけ。読むのは最初の 5000 件まで。`last` が 0 以上の整数でなければ 0 | クリアのときに書く |

- `readBook` の返す形：`{ book, write }`（前の計画の `fresh` と `estimateBook`・`BOOK_EST_MAX` は**作らない**）。起動の重さは増えない（面を数え直さない）。

### 3.3 二重に数えない（クリアのカードから続けたとき。IB-22）

- 今の流れ（事実）：最後の手まで保存されていて開き直すと、`startLevel` が `state.won` を見て `onClear()` を呼ぶ（main.js:316-319）。
- v45：`onClear` の中で、**`irobin.book` を `irobin.save`（次の面・手 0）より先に書く**。開き直しから来た `onClear({ restored: true })` で、帳面の `last` がこの面なら、**動物の数は足さない**（星と手数は「良い方を残す」だけなので足してよい）。
  - 帳面を書いたあと・次の面の保存の前に閉じた → 開き直すとクリアのカード（restored）→ `last` が同じ面なので数えない。
  - 最後の手の保存のあと・帳面の前に閉じた → 開き直すと restored だが `last` は前の面 → 数える（1 回だけ）。
- `setState`（テスト用の局面）でクリアしたときは帳面に書かない（`custom`）。

### 3.4 X-20（古いページから書き戻さない）との関係

- 帳面は**書くたびに保存から読み直して足す**（メモリの値から書かない）。だから契約 §18 G7（「メモリの値から書く保存を足すときは書き込みの回数で比べる」）の場面にならない。見張るキー（`WATCH_KEYS`）は `irobin.save` のまま、足さない。
- 書くのは `writeKey` を通すので、`stale`（ほかのタブが書いた・開き直す前）の間は書かない（G3 のまま）。
- 2 つのタブで同時に遊んでクリアしたとき：どちらも読み直して足すので、両方の分が残る（後勝ちで消えない）。
- 画面の おしゃれ（どの動物が何段か。0〜3）はメモリに持つが、見せるだけで保存には書かない。

### 3.5 変えないもの

`irobin.save`（v:3）・`irobin.best`・面の作り（指紋）・効果音の表・テンポ・遊び方の決まり・共有の文・`sw.js` の `APP_FILES`（ファイルの追加なし。おしゃれの絵は `render.js` の中に描く）。

---

## 4. v44 のタスク（小さめ。ユーザーの答えを待たずに進めてよい）

作業の場所：`/home/user/wt-v44`（T44-01 で作る）。ファイルの行番号は `d4136d3` のもの。

| 順 | 同時に進めてよい組（触るファイルが重ならない） |
|---|---|
| 1 | T44-01（Haiku） |
| 2 | T44-02 ∥ T44-03 ∥ T44-06 ∥ T44-07 ∥ T44-08 ∥ T44-09 |
| 3 | T44-04（T44-02 のあと）→ T44-05（T44-03・T44-04 のあと。同じテストのファイル） |
| 4 | T44-10 確認（Opus）→ T44-11 レビュー（技術 Opus ∥ UX Sonnet）→ 指摘の直し（あれば） |
| 5 | T44-12 文書（Sonnet）∥ T44-13 版（Haiku） |
| 6 | T44-14 関門（Haiku）→ T44-15 コミット（Haiku）→ ユーザーの公開の承認 → T44-16 公開（Haiku） |

### T44-01 作業の場所を作る（Haiku）

- 目的：v44 の worktree とブランチ。
- コマンド：
  ```sh
  cd /home/user/game-no1 && git fetch origin && git worktree add -b claude/v44-irobin-small /home/user/wt-v44 origin/master && cd /home/user/wt-v44 && git log --oneline -1
  ```
- 確かめ：最後の行が `d4136d3 版を v43（2026-10-26）に（関門の前）`（または v43 の公開より新しいコミット）。違えば止まって報告。
- 前に終わっている必要：なし。テスト：なし。

### T44-02 IB-36：初回の遊び方カードを短くする（Sonnet）

- 目的：はじめての人に、まだ出てこない「？」・布・キーの説明を見せない（207 字 → 約 120 字）。
- ファイル：`games/irobin/main.js` だけ。
- 変える所：

| 行 | 変える前 | 変えた後 |
|---|---|---|
| 760（`gimHelp` の閉じかっこ `  }`）の次 | （なし） | 下の `laterHelp` と `coarse` の 2 つを足す |
| 770 | `        <li>「？」は うえを どかすと みえるよ。<b>ぬのの びん</b>は、とどけた にんずで あくよ。</li>${gimHelp()}` | `${laterHelp()}${gimHelp()}`（行頭の空白 8 つはそのまま） |
| 772 | `      <p class="note">こまったら「1手もどす」「やりなおし」。キー：やじるし・エンター・すうじ（0 は 10、- は 11、= は 12ぽんめ）で えらぶ。U もどす、M おと。</p>` | `      <p class="note">こまったら「1手もどす」「やりなおし」。${coarse() ? "" : "キー：やじるし・エンター・すうじ（0 は 10、- は 11、= は 12ぽんめ）で えらぶ。U もどす、M おと。"}</p>` |

足す 2 つ（そのまま写す）：
```js
  // 遊び方の 3 つ目の行（IB-36）：「？」（12 面から）と 布（5 面から）は、その面まで来た人にだけ書く（はじめての人のカードを短く）
  function laterHelp() {
    const reach = Math.max(level, (Number(best) || 0) + 1);
    const parts = [];
    if (reach >= 12) parts.push("「？」は うえを どかすと みえるよ。");   // 12 面＝はじめての隠れ（logic.js NEWS の [12, "hidden"]）
    if (reach >= (L.CLOTH_INTRO_LEVEL || 5)) parts.push("<b>ぬのの びん</b>は、とどけた にんずで あくよ。");
    return parts.length ? `<li>${parts.join("")}</li>` : "";
  }
  // 指で さわる 画面（iPhone・iPad）では キーの説明を出さない（キーボードの人には今までどおり出す。IB-36）
  const coarse = () => { try { return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (e) { return false; } };
```
- 足すテスト：T44-04（BW34）。
- 流すテスト（PORT=8711）：
  ```sh
  PORT=8711 WORKERS=1 ONLY=BW4,BW9,BW16,BW23,BW28,BW33 node tests/run.mjs full
  PORT=8711 WORKERS=1 ONLY=V11,V14 node tests/run.mjs full
  ```
- 見込み：BW28（best 39 で 3 項目）・BW16（3 項目以下）・BW23／BW33（`touch: false` なのでキーの説明が出る）はそのまま合格。落ちたら止まって報告。
- 前：T44-01。同時：T44-03・06・07・08・09。

### T44-03 IB-45：かぎの錠を、段のすき間に収まる大きさにする（Sonnet）

- 目的：背の低い画面でも、錠が上の段の瓶にかからない。iPhone 13・iPad は今と同じ大きさ（26px）。
- ファイル：`games/irobin/index.html` だけ。
- 変える所：

| 行 | 変える前 | 変えた後 |
|---|---|---|
| 471 | `    width: min(60%, 26px);` | `    width: min(60%, clamp(19px, calc((var(--rgap, 22px) + var(--bh, 200px) * 0.16 - 1px) / 1.24), 26px));   /* 段のすき間（--rgap）と口の上の出っぱり（瓶の 16%）に収まる幅。錠の高さは幅の約 1.24 倍。記号 12px を守るため 19px より小さくしない（IB-45） */` |

- 計画担当が測った値（事実、Chromium、109 面＝かぎ 1 本。`ib45b.mjs`）：重なり SE 縦 Safari 6.7→**0**・SE 横 Safari 6.1→**0**・SE 縦ホーム画面 2.0→**0**、錠の記号（`.lockmark`）12.7・13.0・15.1px（12px 以上）。iPhone 13 縦横・iPad 縦・SE 横ホーム画面は重なり 0 のまま（iPhone 13 縦・iPad は 26px のまま）。101 面（かぎの最初の面。錠が上の段）で お客さんの棚（#shop）と 11px 以上あく。
- 足すテスト：T44-05（BW35）。
- 流すテスト（PORT=8713）：`PORT=8713 WORKERS=1 ONLY=BW5,BW27,BW33,V1,V2 node tests/run.mjs full`
- 前：T44-01。同時：T44-02・06・07・08・09。

### T44-04 BW34 を足す（IB-36 のテスト。Sonnet）

- ファイル：`tests/cases/irobin-ui.mjs` の最後（2102 行の `  },` の次、2103 行の `];` の前）。
- 題：`いろびん v44（IB-36）：はじめての遊び方カードは短い（「？」と布は その面まで来たら・キーの説明はキーボードのときだけ）。SE の Safari 縦でも「わかった」までスクロールせずに読める`（tier `full`）
- 確かめること（`openG`・`overlayInfo` を使う。BW28 の `rowsOf` と同じ数え方）：
  - (a) はじめて（`help: false`、best なし）、`view('SE','p','safari')`：`ol.rules li` が **2 つ**、文に「うえを どかすと」「ぬのの びん」が無い、カードの文字（`#card` の textContent から空白を除く）が **130 字以下**、`#overlay` の `scrollHeight <= clientHeight + 1`（スクロールが要らない）、「わかった」の真ん中を `elementFromPoint` で押せる。
  - (b) `irobin.best` が `'4'`（5 面まで来た）：3 つ目の行に「ぬのの びん」があり「うえを どかすと」は無い。`'11'`（12 面まで来た）：両方ある。`'39'`：`li` が 3 つ（BW28 と同じ）。
  - (c) Chromium だけ（`IS_CHROMIUM`。WebKit は `pointer: coarse` の出方がちがうので見ない）：さわる画面（ふつうの `openG`）の `.note` に「キー：」が無い。`opts: { touch: false }` では「= は 12ぽんめ」がある。
- 直す前に落ちることの確かめ（v43 の場所で流す）：`PORT=8715 WORKERS=1 ONLY=BW34 node tests/run.mjs full /home/user/game-no1` → (a)・(b)・(c) が落ちる（`/home/user/game-no1` は v43 のまま。このテストのファイルは wt-v44 のものを使う）。
- 流すテスト（PORT=8714）：`PORT=8714 WORKERS=1 ONLY=BW34 node tests/run.mjs full`
- 前：T44-02。同時：T44-03・06〜09（T44-05 とは同じファイルなので同時にしない）。

### T44-05 BW35 を足す（IB-45 のテスト。Sonnet）

- ファイル：`tests/cases/irobin-ui.mjs` の最後（BW34 の次）。
- 題：`いろびん v44（IB-45）：かぎの錠が上の段の瓶にかからない（109 面・SE 縦横の Safari・SE 縦ホーム画面・iPhone 13 縦・iPad 縦）。錠の記号は 12px 以上、iPhone 13 縦と iPad では錠の幅 26px のまま`（tier `full`）
- 開き方：`irobin.help`・`irobin.cloth`・`irobin.small`・`irobin.only`・`irobin.lock` を `'1'`、`irobin.save` を `{ v: 3, level: 109, moves: [] }`（BW33 と同じ開き方）。
- 確かめること（画面ごと）：`#board .lockbox` が 1 つ以上。それぞれの錠の箱と、**その錠の瓶（`closest('.bottle')`）以外**のすべての `#board .bottle` の箱の重なり（縦横とも 0.5px 超）が無い。`.lockmark` の幅・高さの小さい方が 12px 以上。`view('i13','p','safari')`・`view('iPad','p','app')` では `.lockbox` の幅が 26±0.5px。
- 直す前に落ちることの確かめ：`PORT=8717 WORKERS=1 ONLY=BW35 node tests/run.mjs full /home/user/game-no1` で SE 縦 Safari・SE 横 Safari・SE 縦ホーム画面が「重なる」で落ちる。
- 流すテスト（PORT=8716）：`PORT=8716 WORKERS=1 ONLY=BW34,BW35 node tests/run.mjs full`
- 前：T44-03・T44-04。

### T44-06 X-26：6 本の head に description・OGP（Sonnet）

- 目的：リンクを LINE などに貼ったとき、ゲームの名前と説明と絵が出る。絵は**メニューの絵（`icons/og-menu.png`）を使う**（PM の決定：新しい絵のファイルを増やさない。ゲームごとの絵は、広く出すときに作る）。
- ファイル：`games/blocks/index.html`・`games/2048/index.html`・`games/kiritori/index.html`・`games/irocode/index.html`・`games/zenmai/index.html`・`games/pikatto/index.html`（それぞれ 9 行目の `<meta name="theme-color" …>` の次に 12 行を足すだけ。ほかは触らない）。
- 足す 12 行（`{D}`・`{名前}`・`{dir}` は下の表。どのゲームも同じ形）：
  ```html
  <meta name="description" content="{D}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ゆびあそび">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="{名前}｜ゆびあそび">
  <meta property="og:description" content="{D}">
  <meta property="og:url" content="https://harutonatu.github.io/game-no1/games/{dir}/">
  <meta property="og:image" content="https://harutonatu.github.io/game-no1/icons/og-menu.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ゆびあそびの ゲームの絵">
  <meta name="twitter:card" content="summary_large_image">
  ```

| dir | 名前 | D（description と og:description に同じ文） |
|---|---|---|
| blocks | ブロックパズル | 広告なし・登録なし。落ちてくるブロックで 横一列を そろえて消す パズル。 |
| 2048 | ばいばいタイル | 広告なし・登録なし。同じ数字を ぶつけて 合体させる パズル。 |
| kiritori | キリトリ道場 | 広告なし・登録なし。飛んでくる的を 指でなぞって切る。爆弾に注意。 |
| irocode | いろコード | 広告なし・登録なし。4つの色の並びを 推理する パズル。 |
| zenmai | ゼンマイさんぽ | 広告なし・登録なし。ネジを巻いて、崖の手前で ぴたりと止める。 |
| pikatto | ピカッと早押し | 広告なし・登録なし。ひかったら タップ！ いちばん はやいのは だれ？ |

- 「2048」の字は入れない（法務の報告「お金を絡めるなら説明文から 2048 を外す」に先回り。docs/business-plan.md 5 章）。
- 流すテスト（PORT=8718）：`PORT=8718 WORKERS=1 ONLY=L12,DG1 node tests/run.mjs smoke`（L13 は T44-08 が入ってから T44-10 で流す）
- 前：T44-01。同時：T44-02・03・07・08・09。

### T44-07 X-26：残り 5 本の head に description・OGP（Sonnet）

- T44-06 と同じ 12 行を、`games/hashi/index.html`・`games/matomete/index.html`・`games/michibiki/index.html`・`games/seizai/index.html`・`games/asteroid/index.html` の 9 行目（`theme-color`）の次に足す。

| dir | 名前 | D |
|---|---|---|
| hashi | ハシわたり | 広告なし・登録なし。ながおしで くきを のばして、つぎの はっぱへ。 |
| matomete | まとめてポン | 広告なし・登録なし。おなじ いろを まとめて ポン！ たくさん けすほど たかいてん。 |
| michibiki | ミチビキ空港 | 広告なし・登録なし。ゆびで みちを かいて、おなじ いろの かっそうろへ。 |
| seizai | もくもくこうば | 広告なし・登録なし。もりの きを きって、いたに して うろう。もくもく はたらく みんなを そだてよう。 |
| asteroid | ちきゅうを守れ！ほしくだき | 広告なし・登録なし。ちきゅうに せまる ほしを、ほうだいが こわすよ。かけらで ぶきを つよく しよう。 |

- ほしくだきは「修正を待ってほしい」（ユーザー決定）の対象は遊び方と保存の書き戻し。head の meta だけなので触ってよい（PM の判断）。
- 流すテスト（PORT=8719）：`PORT=8719 WORKERS=1 ONLY=L12,DG1 node tests/run.mjs smoke`
- 前：T44-01。同時：T44-02・03・06・08・09。

### T44-08 L13 を足す（X-26 のテスト。Sonnet）

- ファイル：`tests/cases/logic.mjs`。348 行（L12 の終わりの `  },`）の次、349 行の `];` の前に、そのまま写す：
```js
  {
    id: 'L13', tier: 'smoke', node: true, title: '共有の見た目の横展開（X-26）：いろびん以外の 11 本の head に description・og:*・twitter:card が 1 つずつ、og:url はそのゲームの公開の場所、og:image はメニューの絵、meta は title より前、文は「広告なし・登録なし。」で始まり og:title は「名前｜ゆびあそび」',
    run({ check, root }) {
      const BASE = 'https://harutonatu.github.io/game-no1/';
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const games = [...rd('index.html').matchAll(/\{ name: "([^"]+)"[^\n]*?url: "games\/([a-z0-9]+)\/"/g)].map((m) => ({ name: m[1], dir: m[2] })).filter((g) => g.dir !== 'irobin');
      check(`いろびん以外のゲームが 11 本（${games.map((g) => g.dir).join(',')}）`, games.length === 11, games);
      for (const g of games) {
        const f = `games/${g.dir}/index.html`;
        const html = rd(f);
        const head = html.slice(0, html.indexOf('</head>'));
        const ms = [...head.matchAll(/<meta\s+([^>]*?)\/?>/g)].map((m) => { const a = {}; for (const x of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[x[1]] = x[2]; return { ...a, idx: m.index }; });
        const one = (k, v) => { const r = ms.filter((m) => m[k] === v); return r.length === 1 ? r[0].content : null; };
        const V = {
          description: one('name', 'description'), title: one('property', 'og:title'), desc: one('property', 'og:description'),
          url: one('property', 'og:url'), image: one('property', 'og:image'), w: one('property', 'og:image:width'), h: one('property', 'og:image:height'),
          alt: one('property', 'og:image:alt'), card: one('name', 'twitter:card'), type: one('property', 'og:type'), site: one('property', 'og:site_name'),
        };
        check(`${f}：description・og:*・twitter:card が 1 つずつ`, Object.values(V).every((x) => typeof x === 'string' && x.length > 0), V);
        check(`${f}：og:url が ${BASE}games/${g.dir}/、og:image が ${BASE}icons/og-menu.png、1200×630、summary_large_image`,
          V.url === `${BASE}games/${g.dir}/` && V.image === `${BASE}icons/og-menu.png` && V.w === '1200' && V.h === '630' && V.card === 'summary_large_image', V);
        check(`${f}：description と og:description が同じで「広告なし・登録なし。」で始まる、og:title は「${g.name}｜ゆびあそび」、2048 の字を含まない`,
          V.description === V.desc && V.description.startsWith('広告なし・登録なし。') && V.title === `${g.name}｜ゆびあそび` && !/2048/.test(V.description + V.title), V);
        const titleAt = html.indexOf('<title>');
        const late = ms.filter((m) => /^og:|^twitter:/.test(m.property || m.name || '') || m.name === 'description').filter((m) => m.idx > titleAt);
        check(`${f}：共有の meta はどれも <title> より前（DG1 を崩さない）`, titleAt > 0 && late.length === 0, late);
      }
    },
  },
```
- 直す前に落ちることの確かめ：`PORT=8720 ONLY=L13 node tests/run.mjs smoke`（T44-06・07 の前なら 11 本とも落ちる）。
- 流すテスト：T44-06・07 が終わってから `PORT=8720 ONLY=L12,L13 node tests/run.mjs smoke`（T44-10 で流してもよい）。
- 前：T44-01。同時：T44-02・03・06・07・09。

### T44-09 X-27：ほかのゲームを SE の Safari で見る項目 V15（Sonnet。テストだけ）

- ファイル：`tests/cases/layout.mjs` だけ。計画担当がこのとおりに仮に入れて流し、9/9 合格を確かめた（入れたものは消してある）。
- (1) `SCREENS` の `matomete: {`（46 行）の前に足す：
```js
  hashi: {
    label: 'ハシわたり（どこまでも・プレイ中）',
    async open(page) { await seed(page, { 'hashi.help': '1' }); await page.goto(BASE + 'games/hashi/'); await wait(page, 300); await page.evaluate(() => document.querySelector('#overlay:not([hidden]) [data-cmd="endless"]').click()); await wait(page, 400); },
    // 詳しい画面内の確認（16 桁・茎の先）は HW5。ここは他のゲームと同じ画面ごとの共通確認
    probe: (page, safe) => layoutProbe(page, '#back, #helpBtn, #soundBtn, #hud, #stageWrap, #hint', safe, { overlapSel: '.head, #hud, #stageWrap, #hint', minSel: '#back, #helpBtn, #soundBtn' }),
  },
```
- (2) 最後の項目（V14）の後ろ、`];` の前に足す：
```js
  {
    id: 'V15', tier: 'full', title: 'SE の Safari（縦 320×454・横 568×270）で、まだ見ていなかった遊ぶ画面（2048 縦横・ハシわたり縦横・ブロック縦・キリトリ縦横・ピカッと 4 人 縦横）のボタンが画面内・重ならない・44px 以上（X-27。いろびん IB-44 の横展開）',
    async run({ browser, check }) {
      const p = view('SE', 'p', 'safari'), l = view('SE', 'l', 'safari');
      for (const [v, k] of [[p, 't2048'], [l, 't2048'], [p, 'hashi'], [l, 'hashi'], [p, 'blocks'], [p, 'kiri'], [l, 'kiri'], [p, 'pikatto'], [l, 'pikatto']]) await screenCheck(browser, check, v, k);
    },
  },
```
- 流すテスト（PORT=8721）：`PORT=8721 WORKERS=1 ONLY=V1,V2,V3,V15 node tests/run.mjs full`。V15 が落ちたら、直さずに止まって報告（ゲームを直すのは別の版。KNOWN_ISSUES には PM が決めてから入れる）。
- 前：T44-01。同時：T44-02・03・06・07・08。

### T44-10 確認（Opus）

- 差分（`git -C /home/user/wt-v44 diff origin/master`）が T44-02〜09 のとおりか。ほかのファイルが変わっていないか。
- まとめて流す（PORT=8722）：`PORT=8722 WORKERS=1 ONLY=BW4,BW5,BW9,BW16,BW23,BW27,BW28,BW33,BW34,BW35,V1,V2,V11,V14,V15 node tests/run.mjs full` と `PORT=8722 ONLY=L12,L13,DG1 node tests/run.mjs smoke`。
- スクリーンショット：初回の遊び方（SE 縦 Safari・SE 横 Safari・iPhone 13 縦）、109 面と 101 面（SE 縦 Safari・SE 縦ホーム画面）。見ること：カードが短く読める・錠が小さすぎない・お客さんの棚にかからない。
- 横展開（CLAUDE.md 4 章）：ほかのゲームの遊び方カードで、さわる画面にもキーの説明が出ているものを数える（直さない。課題表に書くかは PM が決める）。

### T44-11 レビュー（直しだけの版：技術 Opus ∥ UX Sonnet）

- 技術（Opus）：`clamp()`・`min()` と `var()` の組み合わせが iOS 13.4 以降の Safari で効くか（効かないときは今の 26px のままになるだけか）、`laterHelp` の `reach`、`pointer: coarse` が iPad＋キーボードで出ない（キーの説明が消える）ことを許せるか、meta の文。
- UX（Sonnet）：短くなった遊び方で、はじめての人が 1 面を始められるか、5 面・12 面で行が増えることが自然か、各ゲームの description の言葉。
- 指摘を直してからコミットする（W-03）。直しは、ファイルが分かれていれば Sonnet に割り振る。

### T44-12 文書（Sonnet。テストは流さない）

- `docs/irobin-contract.md`：最後に **§23 を足す**（題「v44 の小さな直し（2026-10-26、IB-36・IB-45）」）：ユーザーの言葉（このファイルの頭の引用をそのまま）、IB-36 の決めごと（3 つ目の行は 5 面・12 面から、キーの説明は `pointer: coarse` では出さない、指さしは入れない理由）、IB-45 の CSS の式と測った値（T44-03 の表）、BW34・BW35。
- `tests/README.md`：94 行のいろびんの行の ONLY に `BW34,BW35`。125・126 行の BL／BW の説明に BW34・BW35。L の説明に L13、V の説明に V15（X-27）。
- `tests/design.md`：いろびんの節に BW34・BW35、レイアウトの節に V15、共通の節に L13。直す前に落ちたこと（T44-04・05・08 の報告）。
- `docs/issues.md` → `docs/issues-done.md`：**済にして移す**：IB-35（v39 で直っていた。v44 で確かめた）、IB-36（v44。指さしは入れない）、IB-39（v41 で直っていた。v44 で確かめた）、IB-45（v44）、**IB-46（v43 で済。`e86e5f0`）**、X-26（v44。絵はメニューの絵）、X-27（v44。V15 を足した。崩れは無かった）。**残すもの**の「対応」を書き足す：IB-37「保留：v45 で IB-41 を先に入れて様子を見る」、IB-40「保留：絵の描き直しが要り手間が大きい。広く出す時期に」、IB-38「v45 の質問 4 で扱いを決める」。
- 前：T44-11 の指摘の直しのあと。同時：T44-13。

### T44-13 版を v44 に上げる（Haiku。書いた命令のほかの道具は使わない）

- 3 つを一緒に（日付は公開する日。PM が伝える）：
  - `common/version.js:3`：`self.YUBI_VERSION = { version: "v43", date: "2026-10-26" };` → `self.YUBI_VERSION = { version: "v44", date: "<公開する日>" };`
  - `sw.js:5`：`const CACHE_VERSION = "v43";` → `const CACHE_VERSION = "v44";`
- `APP_FILES` は変えない（ファイルの追加なし）。
- 確かめ：`cd /home/user/wt-v44 && PORT=8723 ONLY=L10 node tests/run.mjs smoke` が合格。

### T44-14 関門（Haiku。どれか不合格なら先へ進まず、出力をそのまま報告）

```sh
cd /home/user/wt-v44
PORT=8724 node tests/run.mjs smoke
PORT=8724 WORKERS=3 node tests/run.mjs full
HEADED=1 BROWSER=webkit WORKERS=1 PORT=8724 xvfb-run -a node tests/run.mjs smoke
```
- full で不合格が 1 つだけなら、その項目だけ `PORT=8725 WORKERS=1 ONLY=<ID> node tests/run.mjs full` で 1 回流し直してよい（両方の出力を報告）。2 つ以上なら止まる。WW10 は単独の合格を正とする（T-33、ユーザー判断 2026-10-25）。
- 変異テストは流さない（v44 は仕組みを変えないため。CLAUDE.md 5 章）。

### T44-15 コミット（Haiku。PM の指示があってから）

- `git add <ファイル>` で分ける（`-A` は使わない）：
  1. `games/irobin/main.js` `games/irobin/index.html` `tests/cases/irobin-ui.mjs`：`fix(irobin): はじめての遊び方カードを短く（「？」と布は その面から、キーの説明はキーボードのときだけ。IB-36）、背の低い画面でかぎの錠を小さく（IB-45）。BW34・BW35`
  2. 11 本の `games/*/index.html` と `tests/cases/logic.mjs`：`feat: ほかの 11 本にも description・OGP（絵はメニューの絵。X-26）。L13`
  3. `tests/cases/layout.mjs`：`test: SE の Safari 縦横で 2048・ハシわたり・ブロック・キリトリ・ピカッとの遊ぶ画面を見る V15（X-27）`
  4. `common/version.js` `sw.js` `docs/`：`v44：版を上げる、契約書 §23・テストの説明・課題表（IB-35・36・39・45・46、X-26・27 を済に）`
- 各メッセージの最後に、PM が渡す署名の行を**一字一句そのまま**（W-05）。

### T44-16 公開（Haiku。ユーザーの公開の承認の言葉を PM が引用して渡してから）

```sh
cd /home/user/wt-v44 && git fetch origin && git merge --no-edit origin/master && git push origin claude/v44-irobin-small:master
```
- fast-forward でなければ止まって報告（force push はしない）。

---

## 5. v45 のタスク（第 2 弾「なかよしちょう」。7 章の答えで決まったので、⏸ は外した）

作業の場所：`/home/user/wt-v45`（v44 を公開したあとの `origin/master` から）。行番号は `d4136d3` のもの（v44 で main.js の showHelp の所が数行ずれる。前後の文字で探す）。`render.js`・`logic.js` は v44 で変わらない。

- 答え（そのまま。担当への指示に引用する）：質問 1「動物ごとに違う」・質問 2「クリアのカードから (Recommended)」・質問 3「0から数える」・質問 4「動物＋★と手数 (Recommended)」。
- 試し描きの写し（あれば使う。無ければ 5 章の文と T45-10 (h) で確かめる）：`S=/tmp/claude-0/-home-user-game-no1/05d90edc-3e79-52f4-9c0f-1e4cb2d395a2/scratchpad/v45dress`。`$S/dress.png` が見本、`$S/shot.mjs` が `$S/www/game-no1/dress.html`（6 匹 × 段 0〜3）を写す台本。
- 絵は 4 つに分ける（同じ `render.js` なので**順に**。1 つが 35〜40 行）：T45-04（土台）→ T45-04a（くま・うさぎ）→ T45-04b（ねこ・ペンギン）→ T45-04c（りす・ひつじ）。

| 順 | 同時に進めてよい組 |
|---|---|
| 1 | T45-01（Haiku） |
| 2 | T45-02 ∥ T45-04 ∥ T45-08（触るファイル：logic.js ／ render.js ／ ルートの index.html） |
| 3 | T45-03（T45-02 のあと）∥ T45-04a（T45-04 のあと）∥ T45-11（T45-08 のあと） |
| 4 | T45-04b（T45-04a のあと）∥ T45-05（T45-02・T45-04 のあと。main.js） |
| 5 | T45-04c（T45-04b のあと）∥ T45-06（Opus。T45-05 のあと）∥ T45-09（T45-05 のあと。irobin-ui.mjs。T45-03 は irobin-logic.mjs なので重ならない） |
| 6 | T45-07（T45-06 のあと）→ T45-10（T45-04c・06・07・09 のあと） |
| 7 | T45-12（T45-02・05 のあと。mutate.mjs だけ。いつでも） |
| 8 | T45-13 確認（Opus）→ T45-14 レビュー 3 人 → 直し |
| 9 | T45-15 文書 ∥ T45-16 版 → T45-17 関門 → T45-18 変異 → T45-19 コミット → 承認 → T45-20 公開 |

### T45-01 作業の場所を作る（Haiku）

```sh
cd /home/user/game-no1 && git fetch origin && git worktree add -b claude/v45-irobin-book /home/user/wt-v45 origin/master && cd /home/user/wt-v45 && git log --oneline -1 && grep -n 'version:' common/version.js
```
- 確かめ：版が v44。違えば止まって報告。

### T45-02 logic.js：帳面の関数（Sonnet）

- ファイル：`games/irobin/logic.js` だけ。
- (1) 51 行（`const SAVE_KEY_LOCK = "irobin.lock";`）の次に：`  const SAVE_KEY_BOOK = "irobin.book";   // なかよしちょう（v45・IB-34。契約 §24）：動物ごとの届けた数・面ごとの星と一番少ない手数`
- (2) 1148 行（`function colorName(id) {…}` の閉じかっこ）の次、`const api` の前に、そのまま写す：
```js
  // ---------------------------------------------------------------- なかよしちょう（v45・IB-34。契約 §24）
  // 形 { v: 1, a: { 動物: 届けた数 }, s: { "面": [星 1〜3, 一番少ない手数] }, last: 最後に数を足した面 }。
  // main は書くたびに保存から読み直して足す（メモリの値から書かない。契約 §18 G7 の場面にしない）
  // 帳面が無い人は 0 から数える（古い irobin.best・irobin.save から数を作らない。ユーザー決定 2026-10-26「0から数える」）
  const BOOK_V = 1;
  const BOOK_STEPS = Object.freeze([10, 50, 200]);   // なかよしの段（0〜3）：届けた数がこの数になったら 1 段上がる（決まった数で必ず。ガチャではない）
  const BOOK_MAX_COUNT = 1e9;     // 数・手数の上限（大きすぎる値は捨てる）
  const BOOK_MAX_LEVELS = 5000;   // 面の記録を読む数の上限
  function emptyBook() { return { v: BOOK_V, a: {}, s: {}, last: 0 }; }
  function bookStep(n) { let s = 0; for (const t of BOOK_STEPS) if (Number(n) >= t) s += 1; return s; }
  // 次の段になる数（もう最後の段なら 0）
  function nextStepAt(n) { for (const t of BOOK_STEPS) if (!(Number(n) >= t)) return t; return 0; }
  // 読む。返す { book, write }。無い・壊れている → 空の帳面（write true。最初のクリアで書いて直る）。
  // v が新しい版 → 空の帳面で write は false（こわさない）。v が BOOK_V → 使える分だけ使う（知らない動物・0 以下・小数・大きすぎる数・形の違う面の記録は捨てる）
  function readBook(raw) {
    let o = null;
    if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== "object" || Array.isArray(o) || !Number.isSafeInteger(o.v) || o.v < 1) return { book: emptyBook(), write: true };
    if (o.v > BOOK_V) return { book: emptyBook(), write: false };
    const b = emptyBook();
    const a = o.a && typeof o.a === "object" && !Array.isArray(o.a) ? o.a : {};
    for (const k of ANIMAL_KEYS) { const n = a[k]; if (Number.isSafeInteger(n) && n > 0 && n <= BOOK_MAX_COUNT) b.a[k] = n; }
    const s = o.s && typeof o.s === "object" && !Array.isArray(o.s) ? o.s : {};
    let kept = 0;
    for (const key of Object.keys(s)) {
      if (kept >= BOOK_MAX_LEVELS) break;
      const r = s[key];
      if (!/^[1-9][0-9]{0,15}$/.test(key) || !Number.isSafeInteger(Number(key))) continue;
      if (!Array.isArray(r) || r.length !== 2 || !(r[0] === 1 || r[0] === 2 || r[0] === 3) || !Number.isSafeInteger(r[1]) || r[1] < 1 || r[1] > BOOK_MAX_COUNT) continue;
      b.s[key] = [r[0], r[1]];
      kept += 1;
    }
    b.last = Number.isSafeInteger(o.last) && o.last >= 0 ? o.last : 0;
    return { book: b, write: true };
  }
  // 1 面のクリアを足す（新しい帳面を返し、元は変えない）。c = { level, animals: [動物の key…（届けた順）], star: 0〜3, moves, count }
  // count が false（開き直してクリアのカードから続けた面で、もう数えてある）なら動物の数は足さない。星と手数は良い方を残すだけ
  // 返す { book, ups: [{ kind, step }]（段が上がった動物）, rec: { star, moves } | null（この面の前の記録） }
  function addClear(book, c) {
    const src = book && typeof book === "object" ? book : emptyBook();
    const b = { v: BOOK_V, a: Object.assign({}, src.a), s: Object.assign({}, src.s), last: Number.isSafeInteger(src.last) ? src.last : 0 };
    const o = c || {};
    const lv = normLevel(o.level);
    const ups = [];
    if (o.count !== false) {
      for (const k of Array.isArray(o.animals) ? o.animals : []) {
        if (!ANIMAL_KEYS.includes(k)) continue;
        const before = Number.isSafeInteger(b.a[k]) ? b.a[k] : 0;
        const after = Math.min(before + 1, BOOK_MAX_COUNT);
        b.a[k] = after;
        const st = bookStep(after);
        if (st > bookStep(before)) ups.push({ kind: k, step: st });
      }
      b.last = lv;
    }
    const key = String(lv);
    const prev = Array.isArray(b.s[key]) ? b.s[key] : null;
    const star = o.star === 1 || o.star === 2 || o.star === 3 ? o.star : 0;
    const mv = Number.isSafeInteger(o.moves) && o.moves >= 1 ? Math.min(o.moves, BOOK_MAX_COUNT) : 0;
    if (star && mv) b.s[key] = prev ? [Math.max(prev[0], star), Math.min(prev[1], mv)] : [star, mv];
    return { book: b, ups, rec: prev ? { star: prev[0], moves: prev[1] } : null };
  }
  function bookStars(book) {
    const s = book && book.s && typeof book.s === "object" ? book.s : {};
    let n = 0;
    for (const k of Object.keys(s)) { const r = s[k]; if (Array.isArray(r) && (r[0] === 1 || r[0] === 2 || r[0] === 3)) n += r[0]; }
    return n;
  }
  function makeBook(book) {
    const b = book && typeof book === "object" ? book : emptyBook();
    return JSON.stringify({ v: BOOK_V, a: b.a || {}, s: b.s || {}, last: Number.isSafeInteger(b.last) ? b.last : 0 });
  }
```
- (3) `const api = Object.freeze({`（1150 行）の 2 行目の `SAVE_KEY_LOCK,` の後ろに `SAVE_KEY_BOOK,` を足し、`animalFor, colorName,` の行の前に 1 行 `    BOOK_V, BOOK_STEPS, emptyBook, bookStep, nextStepAt, readBook, addClear, bookStars, makeBook,` を足す。
- 前の計画との違い（Q1＝C・Q3＝B）：`BOOK_STEPS` は `[10, 50, 200]`（3 段）。`estimateBook`・`BOOK_EST_MAX`・返す値の `fresh`・`readBook` の `best` は**作らない**。
- 頭の説明（14 行目あたり）に 1 行：「v45（IB-34）：なかよしちょう `irobin.book`（readBook・addClear・makeBook。0 から数える。契約 §24）」。
- 写したあと、`node -e 'const L=require("./games/irobin/logic.js");console.log(JSON.stringify(L.readBook(null)), L.bookStep(9), L.bookStep(10), L.bookStep(200), L.nextStepAt(50), L.nextStepAt(200))'` が `{"book":{"v":1,"a":{},"s":{},"last":0},"write":true} 0 1 3 200 0` を出すことを確かめる。
- 流すテスト（PORT=8730）：`PORT=8730 WORKERS=1 ONLY=BL1,BL19,BL23,BL24,BL25 node tests/run.mjs smoke`（面は変わらない）。
- 前：T45-01。同時：T45-04・T45-08。

### T45-03 BL26 を足す（帳面のロジックのテスト。Sonnet）

- ファイル：`tests/cases/irobin-logic.mjs` の最後（BL25 の次）。tier `smoke`、node。
- 題：`いろびん v45（IB-34）なかよしちょう：読む（無い・壊れた・新しい版・使える分だけ）、0 から数える、足す（数・段・星と手数は良い方・count false）、書いて読み直すと同じ`
- 確かめること：
  - (a) `readBook(null)` と `readBook(undefined)` が `{ book: { v:1, a:{}, s:{}, last:0 }, write: true }`（0 から。`fresh` は無い）。`readBook(null, 999)` も同じ（2 つ目の引数を見ない＝古い best から数を作らない）。
  - (b) 壊れた 8 種（`'{'`・`'[]'`・`'null'`・`'"x"'`・`'{"v":"1"}'`・`'{"v":0}'`・`'{"v":1.5}'`・`'{"a":{}}'`）は (a) と同じ。
  - (c) `'{"v":2,"a":{"kuma":50}}'` は `write: false` で `a` が空。
  - (d) 使える分だけ：`{"v":1,"a":{"kuma":-5,"neko":1.5,"dog":3,"usagi":12,"risu":2e9},"s":{"0":[3,5],"x":[1,1],"7":[4,9],"8":[2,10],"9":[1,0],"010":[1,3]},"last":-1}` → `a` が `{ usagi: 12 }` だけ、`s` が `{ "8": [2,10] }` だけ、`last` 0、`write` true。
  - (e) `addClear`：`a` 9 匹の kuma に kuma を 1 → `ups` に `{ kind:'kuma', step:1 }`、10→11 では ups なし。49→50 で step 2、199→200 で step 3、200→201 では ups なし。`count:false` では数も `last` も変わらない。星：`[2,20]` に `star 3, moves 25` → `[3,20]`、`star 1, moves 15` → `[2,15]`。`star 0` は書かない。元の帳面は変わらない（`JSON.stringify` が前後で同じ）。
  - (f) `bookStep`：9→0・10→1・49→1・50→2・199→2・200→3・1e9→3・`'abc'`→0。`nextStepAt(0)`=10・`(10)`=50・`(50)`=200・`(200)`=0。`BOOK_STEPS` が `[10,50,200]`。
  - (g) `makeBook` で書いて `readBook` で読むと同じ（`a`・`s`・`last`）。
  - (h) `bookStars`：`s` が `{1:[3,6],2:[1,9]}` で 4。
- 直す前に落ちる：v44 の logic.js（関数が無い）で (a)〜(h) が落ちる（`PORT=8732 ONLY=BL26 node tests/run.mjs smoke /home/user/game-no1`）。
- 流すテスト（PORT=8731）：`PORT=8731 ONLY=BL26 node tests/run.mjs smoke`
- 前：T45-02。同時：T45-04a・T45-11。

### T45-04 render.js：おしゃれの土台（名前の表・描く入口・お店の動物へ渡す。Sonnet）

- ファイル：`games/irobin/render.js` だけ。動物ごとの絵はまだ描かない（T45-04a〜c）。この時点では `DRESS_DRAW` が空なので、見た目は変わらない。
- (1) 166 行（`cheeks` の閉じかっこ 165 行の次の空行）と 167 行（`  /*`）の間に、そのまま写す（35 行）：
```js
  // ===== なかよしの おしゃれ（v45・IB-34。契約 §24） =====
  // dress＝なかよしの段 0〜3（届けた数 10・50・200 で 1 段ずつ。logic の bookStep）。動物ごとに違う 3 つを、段が上がるたびに重ねて付ける。
  // 顔（目・口・鼻）は隠さない。色は体の色に埋もれないものにする
  // 名前と動き（クリアのカード・なかよしちょうの文に使う）：[名前, 「〜を ○○ くるよ」の ○○]
  const DRESS_ITEMS = Object.freeze({
    kuma: Object.freeze([["ちょうネクタイ", "つけて"], ["むぎわらぼうし", "かぶって"], ["きんの メダル", "かけて"]]),
    usagi: Object.freeze([["にんじんの バッジ", "つけて"], ["はなかんむり", "かぶって"], ["ほしの ステッキ", "もって"]]),
    neko: Object.freeze([["すずの くびわ", "つけて"], ["さかなの バッジ", "つけて"], ["おうかん", "かぶって"]]),
    penguin: Object.freeze([["あかい マフラー", "まいて"], ["ニットぼう", "かぶって"], ["ふうせん", "もって"]]),
    risu: Object.freeze([["どんぐりの バッジ", "つけて"], ["はっぱの ぼうし", "かぶって"], ["まるい めがね", "かけて"]]),
    hitsuji: Object.freeze([["あおい リボン", "つけて"], ["ハートの バッジ", "つけて"], ["とんがりぼうし", "かぶって"]])
  });
  const DRESS_MAX = 3;
  function starPts(x, y, ro, ri) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : ro; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
    return pts;
  }
  function strokeLine(ctx, pts, col, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, lw); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
  }
  function heart(ctx, x, y, s, col) {   // ハート：中心 (x,y)、大きさ s（幅の半分）
    disc(ctx, x - s * 0.48, y - s * 0.2, s * 0.52, col);
    disc(ctx, x + s * 0.48, y - s * 0.2, s * 0.52, col);
    poly(ctx, [[x - s * 0.98, y - s * 0.05], [x + s * 0.98, y - s * 0.05], [x, y + s * 0.95]], col);
  }
  const DRESS_DRAW = {};   // 動物 → function (ctx, d, g)。g＝{ cx, cy, r, h, neckY（あごの下）, chestX・chestY（胸の左） }
  function drawDress(ctx, k, cx, cy, r, h, dress) {
    const d = Number.isSafeInteger(dress) ? Math.max(0, Math.min(DRESS_MAX, dress)) : 0;
    const f = DRESS_DRAW[k];
    if (d <= 0 || typeof f !== "function") return;
    f(ctx, d, { cx, cy, r, h, neckY: cy + r * 1.0, chestX: cx - r * 0.62, chestY: h - r * 0.34 });
  }
```
- (2) 278 行（`drawMouth(ctx, cx, mouthY, …);`）の次に `      drawDress(ctx, k, cx, cy, r, h, o.dress);`（顔を描いたあと。おしゃれが顔の上に乗るが、どの絵も目・口・鼻には重ならない）
- (3) 169 行の説明（`kind: ANIMALS のどれか…`）の行の次に ` * dress：なかよしの段 0〜3（v45。動物ごとに違う おしゃれ。DRESS_ITEMS）` を足す。
- (4) `create` の中：
  - 323 行（`const seenKind = new Map();…`）の次に `    let dress = {};                 // なかよしの段（動物 → 0〜3）。見せるだけで保存しない（v45・IB-34）`
  - 同じ所に `    const dressOf = (k) => (k && Number.isSafeInteger(dress[k]) ? Math.max(0, Math.min(DRESS_MAX, dress[k])) : 0);`
  - 762 行：`const sig = [c.kind, c.mood, W, H, …].join("|");` → `const sig = [c.kind, dressOf(c.kind), c.mood, W, H, t ? Math.floor(t * 30) : 0].join("|");`
  - 772 行：`drawAnimal(ctx, c.kind || "kuma", { w, h, mood: …, t: t || 0 });` → `{ w, h, mood: …, t: t || 0, dress: dressOf(c.kind) }`（mood の式はそのまま）
  - 801 行（`if (c.kind) c.el.style.setProperty("--fur", FUR[c.kind]);`）の次に `      c.el.dataset.dress = String(dressOf(c.kind));`
  - 1473 行（`build, layout, update, …, setCalm,`）の次に：
    ```js
      // なかよしの段（v45・IB-34）：{ 動物: 0〜3 }。お客さんを描き直す
      setDress(map) {
        dress = map && typeof map === "object" ? Object.assign({}, map) : {};
        for (let i = 0; i < custs.length; i++) { const c = custs[i]; if (!c || !c.el) continue; c.el.dataset.dress = String(dressOf(c.kind)); c.sig = ""; drawCust(i); }
      },
    ```
- (5) 1482 行：`const api = Object.freeze({ ANIMALS, ANIMAL_NAMES, FUR, drawAnimal, markSvg, create });` → `const api = Object.freeze({ ANIMALS, ANIMAL_NAMES, FUR, DRESS_ITEMS, DRESS_MAX, drawAnimal, markSvg, create });`
- 確かめ：`node --check games/irobin/render.js`。
- 流すテスト（PORT=8733）：`PORT=8733 WORKERS=1 ONLY=BW1,BW2,BW17,BW31 node tests/run.mjs smoke` と `PORT=8733 WORKERS=1 ONLY=BW10,BW14 node tests/run.mjs full`（見た目は変わらない）。
- 前：T45-01。同時：T45-02・T45-08。

### T45-04a render.js：くま・うさぎの おしゃれ（Sonnet）

- ファイル：`games/irobin/render.js` だけ。T45-04 で足した `drawDress` の閉じかっこ（`f(ctx, d, { cx, cy, r, … });` の次の `  }`）の次に、そのまま写す（40 行）。
- 描くもの（3 章の表）：くま＝1 あかい ちょうネクタイ（首。左右の三角＋まん中の玉）・2 むぎわらぼうし（耳のあいだ。つば・山・赤い帯）・3 きんの メダル（胸の右。青い ひもの V・金の玉・星）。うさぎ＝1 にんじんの バッジ（胸の左。だいだいの三角＋葉 2 枚）・2 はなかんむり（頭のてっぺんの弧に 5 つの花、ピンクと きいろを交互、まん中は白）・3 ほしの ステッキ（体の右。むらさきの棒＋金の星）。
```js
  // くま：1 ちょうネクタイ・2 むぎわらぼうし・3 きんの メダル
  DRESS_DRAW.kuma = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    if (d >= 3) {   // 3 きんの メダル：胸の右（青い ひもを V の形に。ふちの こい金・星）
      const mx = cx + r * 0.62, my = chestY;
      strokeLine(ctx, [[mx - r * 0.17, my - r * 0.36], [mx, my - r * 0.05], [mx + r * 0.17, my - r * 0.36]], "#4f9dff", r * 0.1);
      disc(ctx, mx, my, r * 0.24, "#a8781a");
      disc(ctx, mx, my, r * 0.19, "#ffd34d");
      poly(ctx, starPts(mx, my, r * 0.12, r * 0.05), "#a8781a");
    }
    // 1 あかい ちょうネクタイ
    poly(ctx, [[cx, neckY], [cx - r * 0.42, neckY - r * 0.2], [cx - r * 0.42, neckY + r * 0.2]], "#e8434f");
    poly(ctx, [[cx, neckY], [cx + r * 0.42, neckY - r * 0.2], [cx + r * 0.42, neckY + r * 0.2]], "#e8434f");
    disc(ctx, cx, neckY, r * 0.11, "#b8202f");
    if (d >= 2) {   // 2 むぎわらぼうし：頭の上（耳のあいだ）
      oval(ctx, cx, cy - r * 0.8, r * 0.7, r * 0.15, "#e9c46a");
      oval(ctx, cx, cy - r * 0.92, r * 0.4, r * 0.3, "#f2d68a");
      ctx.fillStyle = "#e8434f"; ctx.fillRect(cx - r * 0.4, cy - r * 0.9, r * 0.8, r * 0.1);
    }
  };
  // うさぎ：1 にんじんの バッジ・2 はなかんむり・3 ほしの ステッキ
  DRESS_DRAW.usagi = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    // 1 にんじんの バッジ（胸の左）
    poly(ctx, [[chestX - r * 0.17, chestY - r * 0.2], [chestX + r * 0.17, chestY - r * 0.2], [chestX, chestY + r * 0.32]], "#ff8a3d");
    oval(ctx, chestX - r * 0.08, chestY - r * 0.3, r * 0.06, r * 0.13, "#3fae5a", -0.4);
    oval(ctx, chestX + r * 0.08, chestY - r * 0.3, r * 0.06, r * 0.13, "#3fae5a", 0.4);
    if (d >= 2) {   // 2 はなかんむり：頭のてっぺんに 5 つの花（ピンク・きいろ を交互に、まん中は白）
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.18 + i * 0.16);
        const x = cx + Math.cos(a) * r * 0.86, y = cy + Math.sin(a) * r * 0.86;
        disc(ctx, x, y, r * 0.16, i % 2 ? "#ffd34d" : "#ff7fae");
        disc(ctx, x, y, r * 0.06, "#ffffff");
      }
    }
    if (d >= 3) {   // 3 ほしの ステッキ：体の右に持つ
      strokeLine(ctx, [[cx + r * 1.0, h - r * 0.05], [cx + r * 1.12, cy + r * 0.25]], "#8a5cd6", r * 0.1);
      poly(ctx, starPts(cx + r * 1.14, cy + r * 0.05, r * 0.32, r * 0.14), "#ffd34d");
    }
  };
```
- 確かめ：`node --check games/irobin/render.js`。試し描きの写しがあれば、`cp games/irobin/render.js $S/www/game-no1/games/irobin/render.js && OUT=check-a.png PORT=8745 node $S/shot.mjs` で `$S/check-a.png` を写し、くま・うさぎの列が `$S/dress.png` と同じか見る（ほかの 4 匹は まだ段 0 のまま）。
- 流すテスト（PORT=8746）：`PORT=8746 WORKERS=1 ONLY=BW1,BW2 node tests/run.mjs smoke`
- 前：T45-04。同時：T45-03・T45-11。

### T45-04b render.js：ねこ・ペンギンの おしゃれ（Sonnet）

- ファイル：`games/irobin/render.js` だけ。T45-04a で足した `DRESS_DRAW.usagi = function … };` の次に、そのまま写す（38 行）。
- 描くもの：ねこ＝1 すずの くびわ（首。赤い わ＋金の すず＋すずの すじ）・2 さかなの バッジ（胸の左。青い だ円＋しっぽの三角＋黒い目）・3 おうかん（耳のあいだ。金の 7 点の形＋赤い玉）。ペンギン＝1 あかい マフラー（首の だ円＋右に たれる はし＋白い すじ）・2 ニットぼう（みどりの半円＋白い ふち＋白い ぼんぼり）・3 ふうせん（体の右から白い ひも、ピンクの だ円＋結び目の三角＋光）。
```js
  // ねこ：1 すずの くびわ・2 さかなの バッジ・3 おうかん
  DRESS_DRAW.neko = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    // 1 すずの くびわ（赤い わと きんの すず）
    oval(ctx, cx, neckY - r * 0.02, r * 0.62, r * 0.11, "#e8434f");
    disc(ctx, cx, neckY + r * 0.14, r * 0.15, "#ffd34d");
    strokeLine(ctx, [[cx - r * 0.08, neckY + r * 0.18], [cx + r * 0.08, neckY + r * 0.18]], "#8a6a10", r * 0.05);
    if (d >= 2) {   // 2 さかなの バッジ（胸の左。青い さかな）
      oval(ctx, chestX + r * 0.04, chestY, r * 0.24, r * 0.13, "#4f9dff");
      poly(ctx, [[chestX - r * 0.16, chestY], [chestX - r * 0.36, chestY - r * 0.15], [chestX - r * 0.36, chestY + r * 0.15]], "#4f9dff");
      disc(ctx, chestX + r * 0.14, chestY - r * 0.03, r * 0.04, "#141826");
    }
    if (d >= 3) {   // 3 おうかん：頭の上（耳のあいだ。きんに赤い玉）
      const top = cy - r * 0.86;
      poly(ctx, [[cx - r * 0.42, top + r * 0.1], [cx - r * 0.42, top - r * 0.34], [cx - r * 0.2, top - r * 0.1], [cx, top - r * 0.42], [cx + r * 0.2, top - r * 0.1], [cx + r * 0.42, top - r * 0.34], [cx + r * 0.42, top + r * 0.1]], "#ffd34d");
      disc(ctx, cx, top - r * 0.02, r * 0.08, "#e8434f");
    }
  };
  // ペンギン：1 あかい マフラー・2 ニットぼう・3 ふうせん
  DRESS_DRAW.penguin = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    // 1 あかい マフラー：首と、右に たれる はし
    oval(ctx, cx, neckY - r * 0.05, r * 0.7, r * 0.16, "#ff5a5a");
    poly(ctx, [[cx + r * 0.22, neckY - r * 0.05], [cx + r * 0.5, neckY - r * 0.05], [cx + r * 0.58, neckY + r * 0.5], [cx + r * 0.3, neckY + r * 0.5]], "#ff5a5a");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(cx + r * 0.3, neckY + r * 0.34, r * 0.27, r * 0.07);
    if (d >= 2) {   // 2 ニットぼう：みどりの半円＋白い ふち＋白い ぼんぼり
      const top = cy - r * 0.78;
      ctx.beginPath(); ctx.arc(cx, top, r * 0.58, Math.PI, 0); ctx.closePath(); ctx.fillStyle = "#3fbf6a"; ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(cx - r * 0.66, top - r * 0.04, r * 1.32, r * 0.16);
      disc(ctx, cx, top - r * 0.62, r * 0.15, "#ffffff");
    }
    if (d >= 3) {   // 3 ふうせん：体の右から ひもで上へ（ピンク）
      strokeLine(ctx, [[cx + r * 0.95, h - r * 0.1], [cx + r * 1.05, cy - r * 0.2], [cx + r * 1.0, cy - r * 0.55]], "#e6e9f2", r * 0.05);
      oval(ctx, cx + r * 1.0, cy - r * 0.9, r * 0.3, r * 0.36, "#ff7fae");
      poly(ctx, [[cx + r * 1.0, cy - r * 0.56], [cx + r * 0.93, cy - r * 0.48], [cx + r * 1.07, cy - r * 0.48]], "#ff7fae");
      disc(ctx, cx + r * 0.9, cy - r * 1.02, r * 0.07, "rgba(255,255,255,.7)");
    }
  };
```
- 確かめ：`node --check games/irobin/render.js`。写しがあれば `OUT=check-b.png PORT=8747 node $S/shot.mjs`（cp は T45-04a と同じ）で、ねこ・ペンギンの列が `dress.png` と同じか見る。
- 流すテスト（PORT=8748）：`PORT=8748 WORKERS=1 ONLY=BW1,BW2 node tests/run.mjs smoke`
- 前：T45-04a。同時：T45-05。

### T45-04c render.js：りす・ひつじの おしゃれ（Sonnet）

- ファイル：`games/irobin/render.js` だけ。T45-04b で足した `DRESS_DRAW.penguin = function … };` の次に、そのまま写す（37 行）。
- 描くもの：りす＝1 どんぐりの バッジ（胸の左。明るい実＋こげ茶の ぼうし＋柄）・2 はっぱの ぼうし（頭の左上に ななめの こい みどりの葉＋すじ）・3 まるい めがね（目を囲む むらさきの わ 2 つ＋ブリッジ。目は見える）。ひつじ＝1 あおい リボン（毛の右上。三角 2 つ＋こい青の玉）・2 ハートの バッジ（胸の左。ピンク）・3 とんがりぼうし（頭の上。むらさきの三角＋きいろの水玉 3 つ＋白い ぼんぼり）。
```js
  // りす：1 どんぐりの バッジ・2 はっぱの ぼうし・3 まるい めがね
  DRESS_DRAW.risu = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    // 1 どんぐりの バッジ（胸の左。こげ茶の ぼうしと 明るい実）
    oval(ctx, chestX, chestY + r * 0.06, r * 0.18, r * 0.22, "#e8b45c");
    oval(ctx, chestX, chestY - r * 0.1, r * 0.22, r * 0.11, "#5a3518");
    strokeLine(ctx, [[chestX, chestY - r * 0.2], [chestX + r * 0.04, chestY - r * 0.3]], "#5a3518", r * 0.06);
    if (d >= 2) {   // 2 はっぱの ぼうし：頭の左上に ななめの はっぱ（こい みどり＋すじ）
      oval(ctx, cx - r * 0.3, cy - r * 0.98, r * 0.42, r * 0.2, "#2f9e4f", -0.35);
      strokeLine(ctx, [[cx - r * 0.66, cy - r * 0.86], [cx + r * 0.06, cy - r * 1.1]], "#1d6b33", r * 0.05);
      strokeLine(ctx, [[cx + r * 0.06, cy - r * 1.1], [cx + r * 0.16, cy - r * 1.22]], "#1d6b33", r * 0.07);
    }
    if (d >= 3) {   // 3 まるい めがね：目を囲む わ（目は見える）
      const ey = cy - r * 0.04;
      ctx.strokeStyle = "#3a2a6a"; ctx.lineWidth = Math.max(1.2, r * 0.06);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * r * 0.36, ey, r * 0.24, 0, Math.PI * 2); ctx.stroke(); }
      strokeLine(ctx, [[cx - r * 0.12, ey - r * 0.03], [cx + r * 0.12, ey - r * 0.03]], "#3a2a6a", r * 0.06);
    }
  };
  // ひつじ：1 あおい リボン・2 ハートの バッジ・3 とんがりぼうし
  DRESS_DRAW.hitsuji = function (ctx, d, g) {
    const { cx, cy, r, h, neckY, chestX, chestY } = g;
    // 1 あおい リボン：毛の右上
    const x = cx + r * 0.55, y = cy - r * 0.8;
    poly(ctx, [[x, y], [x - r * 0.38, y - r * 0.24], [x - r * 0.38, y + r * 0.24]], "#4f7dff");
    poly(ctx, [[x, y], [x + r * 0.38, y - r * 0.24], [x + r * 0.38, y + r * 0.24]], "#4f7dff");
    disc(ctx, x, y, r * 0.12, "#2d4fc2");
    if (d >= 2) heart(ctx, chestX, chestY, r * 0.24, "#ff5a8a");   // 2 ハートの バッジ（胸の左）
    if (d >= 3) {   // 3 とんがりぼうし：頭の上（むらさきに きいろの水玉、てっぺんに ぼんぼり）
      const base = cy - r * 0.95;
      poly(ctx, [[cx - r * 0.4, base], [cx + r * 0.4, base], [cx + r * 0.05, base - r * 0.85]], "#8a5cd6");
      disc(ctx, cx - r * 0.12, base - r * 0.2, r * 0.07, "#ffd34d");
      disc(ctx, cx + r * 0.14, base - r * 0.3, r * 0.07, "#ffd34d");
      disc(ctx, cx + r * 0.0, base - r * 0.52, r * 0.06, "#ffd34d");
      disc(ctx, cx + r * 0.05, base - r * 0.86, r * 0.12, "#ffffff");
    }
  };
```
- 確かめ：`node --check games/irobin/render.js`。写しがあれば `OUT=check-c.png PORT=8749 node $S/shot.mjs` で、6 匹すべてが `dress.png` と同じか見る（`diff $S/render.base.js games/irobin/render.js` が `$S/render-dress.diff` と同じなら なお良い。`render.base.js` は d4136d3 の render.js）。
- 流すテスト（PORT=8750）：`PORT=8750 WORKERS=1 ONLY=BW1,BW2,BW17,BW31 node tests/run.mjs smoke`
- 前：T45-04b。同時：T45-06・T45-09。

### T45-05 main.js：クリアで数えて保存する・起動で おしゃれを渡す（Sonnet）

- ファイル：`games/irobin/main.js` だけ。
- (1) 27 行（`GIM_KEYS`）の次に：
```js
  const KEY_BOOK = L.SAVE_KEY_BOOK || "irobin.book";   // なかよしちょう（v45・IB-34。契約 §24）
  // 星（めやすの手数と比べて 1〜3。めやすが無い面は 0）。クリアのカード・共有・帳面で同じ式を使う
  const starOf = (mv, p) => (!p ? 0 : mv <= p ? 3 : mv <= Math.ceil(p * 1.5) ? 2 : 1);
```
- (2) 136 行（`function safeCall…`）の次に：
```js
  // なかよしちょう：いつも保存から読み直す（メモリの値から書かない。X-20 の G7 の場面にしない）。無い人は 0 から（古い保存から数を作らない）
  function readBookNow() { return typeof L.readBook === "function" ? safeCall(() => L.readBook(readKey(KEY_BOOK)), null) : null; }
  function dressMap(book) { const m = {}; for (const k of R.ANIMALS || []) m[k] = safeCall(() => L.bookStep(book && book.a ? book.a[k] || 0 : 0), 0) || 0; return m; }
```
- (3) 318 行：`      onClear();`（startLevel の中、IB-22 の開き直し）→ `      onClear({ restored: true });`
- (4) 472 行：`function onClear() {` → `function onClear(o) {`
- (5) 481 行（`const animals = …`）の次、482 行（`lastClear = …`）の前に：
```js
    // なかよしちょう（IB-34）：次の面への保存（irobin.save）より先に書く。開き直してクリアのカードから続けた面で、
    // もう数えてある（last が この面）なら数は足さない（契約 §24.3）。setState の局面（custom）は書かない
    let ups = [], dress = null;
    if (!custom) {
      const rb = readBookNow();
      const r2 = rb ? safeCall(() => L.addClear(rb.book, { level, animals, star: starOf(h.moves, par), moves: h.moves, count: !(o && o.restored && rb.book.last === level) }), null) : null;
      if (r2) {
        if (rb.write) writeKey(KEY_BOOK, L.makeBook(r2.book));
        ups = r2.ups;
        dress = dressMap(r2.book);
        if (typeof render.setDress === "function") render.setDress(dress);
      }
    }
```
- (6) 482 行の `lastClear = { level, …, animals };` の `animals` の後ろに `, ups, dress` を足す。
- (7) 523 行と 559 行の `const star = !p ? 0 : c.moves <= p ? 3 : c.moves <= Math.ceil(p * 1.5) ? 2 : 1;` → `const star = starOf(c.moves, p);`（2 か所。式は同じ）
- (8) boot（975 行の `(function boot() {` の次の行）に：
```js
    // なかよしちょう：お客さんの おしゃれを渡す（IB-34）。起動では書かない（無い人は 0 から。最初のクリアで書く）
    const rb = readBookNow();
    if (rb && typeof render.setDress === "function") render.setDress(dressMap(rb.book));
```
- 前の計画との違い（Q3＝B）：起動で帳面を書かない（`fresh` を見ない）。`readBook` に `best` を渡さない。
- 変えないもの：`WATCH_KEYS`（`irobin.save` だけ）・`save()`・共有の文・効果音。
- 流すテスト（PORT=8734）：`PORT=8734 WORKERS=1 node tests/run.mjs smoke` と `PORT=8734 WORKERS=1 ONLY=BW3,BW6,BW7,BW11,BW12,BW20,BW21,BW22,BW31,BW32 node tests/run.mjs full`
- 前：T45-02・T45-04（`setDress` があること。T45-04a〜c は待たなくてよい）。同時：T45-04b・T45-03・T45-11。

### T45-06 クリアのカードの一言・「なかよしちょう」のカード・ホーム画面の一言（**Opus**）

- **なぜ Opus か**：クリアのカードのボタンが 3 つ→4 つになり、SE 縦横（ホーム画面・Safari）の 4 画面で「つぎの めんへ」が動かない・スクロールしないで押せる並べ方を、測りながら決める必要がある（BW23・BW31・BW32 の基準を守る）。決めた並べ方は確認のときに Sonnet が写せる形で 5 章のこのタスクに書き足す。
- ファイル：`games/irobin/main.js`・`games/irobin/index.html`。
- 決めてあること（写す所。Q2＝A「クリアのカードから」・Q4＝A）：
  - おしゃれの名前は `R.DRESS_ITEMS[動物][段 − 1]` の `[名前, 動き]` を使う（main.js に名前の表を持たない。1 か所だけ）。
  - クリアのカード：`p.next-note` の次に `<p class="friend" data-f="f"></p>`。文：段が上がった動物が 1 匹なら、段 1 は「${名前}さんと なかよしに なったよ！ ${おしゃれ}を ${動き} くるよ」、段 2・3 は「${名前}さんと もっと なかよしに なったよ！ ${おしゃれ}を ${動き} くるよ」（例：「くまさんと なかよしに なったよ！ ちょうネクタイを つけて くるよ」「ペンギンさんと もっと なかよしに なったよ！ ふうせんを もって くるよ」）。2 匹以上なら「${名前・名前}さんと なかよしに なったよ！」。無いときは `hidden`。音：上がったときは `best`（`showRecord` で鳴らすときは 1 回だけ）。
  - 動物の列（`.served`）の絵に `dress: c.dress ? c.dress[kind] || 0 : 0` を渡す（上がったおしゃれを付けた顔）。
  - ボタン `<button class="cta book" type="button" data-cmd="book">なかよしちょう</button>`（「メニューへ」の次。共有と並ぶ）。押すと `showBook()`。
  - `showBook()`：`overlayKind` を `"book"`。見出し「なかよしちょう」、★の合計「あつめた ★ ${n}こ」（0 なら出さない）、6 匹の行（絵 56×60 に今の段の おしゃれ・名前・「${数}にん」・「あと ${次−数}にんで ${次のおしゃれの名前}」か「ぜんぶ そろったよ」）、ホーム画面に追加していないときだけ（`navigator.standalone !== true` かつ `(display-mode: standalone)` でない）「ホーム画面に ついかすると、きろくが きえにくいよ」（IB-41）、ボタン「もどる」（`data-cmd="bookClose"`）。閉じる（もどる・Esc）とクリアのカードに戻る（`showClearCard({ again: true })`：音と 400ms の押せない時間はくり返さない）。
  - 帳面は `readBookNow()` で読む（メモリの値を出さない）。まだ 1 人も届けていない動物の行は「0にん」「あと 10にんで ${段 1 の名前}」（0 から数えるので、v45 を開いた直後はみな 0）。
- 足すテスト：T45-10（BW37）。BW31 (d) の「ボタンは next,menu」は「next,menu,book」に変わる（T45-10 で直す）。
- 流すテスト（PORT=8735）：`PORT=8735 WORKERS=1 ONLY=BW4,BW16,BW23,BW31,BW32,V11,V14 node tests/run.mjs full`
- 前：T45-05。同時：T45-04c・T45-09。

### T45-07 IB-42：105 面から先の節目の予告に、なかよしの「あと ○にん」（Sonnet）

- ファイル：`games/irobin/main.js` だけ。
- 491〜503 行の `nextNoteText(c)` の最後の `return \`つぎは ${next}めん\`;` を、次に替える：
```js
    // 105 面から先（more でない）：なかよしの段が一番近い動物を出す（IB-42）。全部そろっていれば今までどおり
    const near = safeCall(() => {
      const rb = readBookNow();
      if (!rb) return null;
      let pick = null;
      for (const k of R.ANIMALS || []) {
        const n = rb.book.a[k] || 0, at = L.nextStepAt(n);
        if (at && (!pick || at - n < pick.left)) pick = { k, left: at - n, step: L.bookStep(n) + 1 };
      }
      return pick;
    }, null);
    const item = near && R.DRESS_ITEMS && R.DRESS_ITEMS[near.k] ? R.DRESS_ITEMS[near.k][near.step - 1] : null;
    if (near && item) return `つぎは ${next}めん。${R.ANIMAL_NAMES[near.k] || "おきゃくさん"}さん あと ${near.left}にんで ${item[0]}`;
    return `つぎは ${next}めん`;
```
  （並びが同じ数なら `R.ANIMALS` の順で先の動物）
- 足すテスト：T45-10 の (g)。BW32 (g)「つぎは 106めん」だけ → 帳面を 6 匹とも 200 にしてから開くと「つぎは 106めん」のまま、帳面なし（0 から）では「あと ○にんで」に変わる（T45-10 で直す）。
- 流すテスト（PORT=8736）：`PORT=8736 WORKERS=1 ONLY=BW32 node tests/run.mjs smoke`（(g) は T45-10 で直すまで落ちてよい。ほかが合格なら次へ）
- 前：T45-06。

### T45-08 メニューのいろびんのカードに ★の合計（Sonnet）

- ファイル：`index.html`（ルート）だけ。Q4＝A のとおり。
- 819〜826 行の `irobinBest()` を次に替える（ルートのメニューは logic.js を読まないので、ここで小さく読む）：
```js
  // いろびん：irobin.best（クリアした一番大きい面）。安全な整数で 1 以上のときだけ「N めん クリア」、それ以外は空。
  // なかよしちょう（irobin.book、v45）の ★ が 1 つ以上なら「・★M」を足す。壊れた帳面は ★ なしとして扱う
  function irobinBest() {
    try {
      const raw = localStorage.getItem("irobin.best");
      if (raw === null) return "";
      const n = Number(raw);
      if (!(Number.isSafeInteger(n) && n >= 1)) return "";
      let stars = 0;
      try {
        const b = JSON.parse(localStorage.getItem("irobin.book"));
        if (b && b.v === 1 && b.s && typeof b.s === "object" && !Array.isArray(b.s)) for (const k of Object.keys(b.s).slice(0, 5000)) { const r = b.s[k]; if (Array.isArray(r) && (r[0] === 1 || r[0] === 2 || r[0] === 3)) stars += r[0]; }
      } catch (e) { stars = 0; }
      return n + " めん クリア" + (stars > 0 ? "・★" + stars : "");
    } catch (e) { return ""; }
  }
```
- 流すテスト（PORT=8737）：`PORT=8737 WORKERS=1 ONLY=BW15,V13 node tests/run.mjs full`（BW15 は帳面なしなので今のまま合格）
- 前：T45-01。同時：T45-02・T45-04。

### T45-09 BW36 を足す（数える・保存・0 から・二重に数えない・壊れた帳面・X-20。Sonnet）

- ファイル：`tests/cases/irobin-ui.mjs` の最後。tier `full`。
- 題：`いろびん v45（IB-34）なかよしちょうの保存：クリアで動物の数・星・手数が残る、前から遊んでいる人も 0 から数える、開き直したクリアのカードで二重に数えない、壊れた帳面でも落ちない・新しい版の帳面を書きかえない、古いページから書き戻さない`
- 確かめること（`irobin.book` は `localStorage` から読む）：
  - (a) 帳面なし・best なし：開いただけでは `irobin.book` が `null`（起動で書かない）。1 面を solution で解くと、`a` の合計が 1 面の注文の数（`getState().total`）、どの動物もクリアのカードの `.served` の aria-label の順（ずらしを含む）と合う、`s["1"]` が `[星, 手数]`（星は `.stars` の `data-stars`、手数は `getState().moves`）、`last` 1。
  - (b) 0 から：best 60・`irobin.save` が 61 面・帳面なしで開く → `irobin.book` は `null` のまま、`#shop .customer` の `data-dress` がみな `0`。61 面を解くと `a` の合計が 61 面の注文の数だけ（1〜60 面の分は入らない）。
  - (c) 開き直し：3 面の solution の手を全部 `irobin.save` に入れ、帳面の `last` を 3 にして開く → クリアのカード（`overlay 'clear'`）、`a` が変わらない。`last` を 2 にして開く → `a` の合計が 3 面の注文の数だけ増える（1 回だけ。もう一度開き直しても増えない）。
  - (d) 壊れた帳面 `'{'`・`'[]'` と、混ざった帳面（BL26 (d) と同じ文字）で開いて 1 面を解く：コンソールエラー 0、クリアのカードが出る、壊れた帳面は 1 面の分の正しい帳面に書きかわる、混ざった帳面の `usagi` 12 は残る（＋届けた分）。
  - (e) `'{"v":2,"a":{"kuma":50}}'` で開いて 1 面を解く：`irobin.book` の文字が前と同じ（書きかえない）。
  - (f) X-20：1 面を開き、`x20Hidden(page, true)`、同じ context の別のページが `irobin.save` を `{v:3,level:7,moves:[]}` にする → `pagehide` を起こしても `irobin.book` の文字が変わらない。表に戻すと開き直し（7 面）、帳面の文字は前と同じ。
- 直す前に落ちる：v44（`/home/user/game-no1` を v44 にしてから、または v44 の公開の場所）で (a)〜(e) が落ちる。
- 流すテスト（PORT=8738）：`PORT=8738 WORKERS=1 ONLY=BW36 node tests/run.mjs full`
- 前：T45-05。同時：T45-03・T45-04c・T45-06。

### T45-10 BW37 を足し、BW31・BW32 を直す（画面。Sonnet）

- ファイル：`tests/cases/irobin-ui.mjs`。
- BW31 (d)（1919 行あたり）：「ボタンは next,menu」→「next,menu,book」（T45-06 の並べ方のとおり。共有のあるカードの順も T45-06 に合わせる）。BW32 (g)（2014 行）：開く前に `irobin.book` を 6 匹とも 200 にして「つぎは 106めん」のまま。
- 足す BW37（tier `full`）。題：`いろびん v45（IB-34・IB-41・IB-42）：段が上がった面のクリアのカードに一言と音 best 1 回、お店の動物が 動物ごとの おしゃれを付けて来る（data-dress・絵が段ごとに変わる）、なかよしちょうのカード（6 匹・数・あと ○にん・★の合計）が SE 縦横のホーム画面と Safari で押せてはみ出さない、もどるでクリアのカードへ戻る、ホーム画面に追加していないときだけ一言、105 面の予告に「あと ○にんで」`
  - (a) 帳面の kuma を 9 にして、1 面の注文に くま がいる面（`animalFor(n, i) === 'kuma'` の面を 1〜20 面から探す）を solution で解く：`.friend` が「くまさんと なかよしに なったよ！ ちょうネクタイを つけて くるよ」、音 best が 1 回（`SFX_SPY`・`plays`）。段が上がらない面では `.friend` が隠れている。kuma を 49 にして同じ面を解くと「くまさんと もっと なかよしに なったよ！ むぎわらぼうしを かぶって くるよ」。
  - (b) 帳面の 6 匹を 50 にして開く：`#shop .customer` の `data-dress` が `2`（お客さんがいる枠）。200 にすると `3`、1000 でも `3`。
  - (c) クリアのカードで「なかよしちょう」を押す（帳面は kuma 50・ほか 0）：`overlay 'book'`、行が 6 つ、くまの行に「50にん」「あと 150にんで きんの メダル」、うさぎの行に「0にん」「あと 10にんで にんじんの バッジ」、★の合計の行。`view('SE','p','app')`・`view('SE','p','safari')`・`view('SE','l','app')`・`view('SE','l','safari')` で「もどる」がスクロールなしで押せる・44px 以上・カードが画面の中・横スクロールなし。6 匹とも 200 のときは 6 行とも「ぜんぶ そろったよ」。
  - (d) 「もどる」と Escape でクリアのカードに戻る（`overlay 'clear'`、ボタンがすぐ押せる＝`aria-disabled` なし、音 best が増えない）。
  - (e) IB-41：ふつうの開き方で「ホーム画面に ついかすると」がある。`initScript` で `navigator.standalone = true` にすると無い。
  - (f) 帳面が `v:2` のときも、なかよしちょうのカードは落ちずに開く（数は 0）。
  - (g) best 104・帳面を kuma 195・ほか 200 にして 105 面をクリア：予告が「つぎは 106めん。くまさん あと 5にんで きんの メダル」。
  - (h) 絵（Q1＝C の守り）：ページの中で `IrobinRender.drawAnimal` を 6 匹 × 段 0〜3 で 112×120 の canvas に描き、`toDataURL()` が どの動物も段 0→1→2→3 で毎回変わる（描き忘れた動物・段が無い）。段 4・`'x'`・`-1` は段 3・0・0 と同じ絵。`IrobinRender.DRESS_ITEMS` が 6 匹 × 3 つで、名前 18 個がみな違う。
- 流すテスト（PORT=8739）：`PORT=8739 WORKERS=1 ONLY=BW31,BW32,BW36,BW37 node tests/run.mjs full`
- 前：T45-04c・T45-06・T45-07・T45-09。

### T45-11 V13 にいろびんの ★ を足す（Sonnet）

- ファイル：`tests/cases/layout.mjs` だけ。V13（399 行〜）の seed の `'irobin.best': '999'` の後ろに `'irobin.book': JSON.stringify({ v: 1, a: {}, s: Object.fromEntries(Array.from({ length: 999 }, (_, i) => [String(i + 1), [3, 30]])), last: 999 })` を足す（「999 めん クリア・★2997」が「…」で切れず 2 行までか、を今の V13 の確かめ方のまま見る）。
- 流すテスト（PORT=8740）：`PORT=8740 WORKERS=1 ONLY=V13 node tests/run.mjs full`
- 前：T45-08。同時：T45-03・T45-04a。

### T45-12 変異の行を足す（Sonnet）

- ファイル：`tests/mutants/mutate.mjs`。281 行（MB51）の次に：
```
  ['MB52 いろびん：開き直したクリアのカードで、なかよしちょうの数を二重に足す（IB-34）', '保存', 'games/irobin/main.js', 'count: !(o && o.restored && rb.book.last === level)', 'count: true'],
  ['MB53 いろびん：なかよしちょうの負の数・小数を捨てない（IB-34）', '保存', 'games/irobin/logic.js', 'if (Number.isSafeInteger(n) && n > 0 && n <= BOOK_MAX_COUNT) b.a[k] = n;', 'if (typeof n === "number") b.a[k] = n;'],
  ['MB54 いろびん：新しい版の なかよしちょうを書きかえる（IB-34）', '保存', 'games/irobin/logic.js', 'if (o.v > BOOK_V) return { book: emptyBook(), write: false };', 'if (o.v > BOOK_V) return { book: emptyBook(), write: true };'],
  ['MB55 いろびん：なかよしの段が 1 つ遅れる（10 にんで上がらない。IB-34）', '保存', 'games/irobin/logic.js', 'for (const t of BOOK_STEPS) if (Number(n) >= t) s += 1;', 'for (const t of BOOK_STEPS) if (Number(n) > t) s += 1;'],
  ['MB56 いろびん：面の星を良い方でなく今回の値で上書きする（IB-34）', '保存', 'games/irobin/logic.js', '[Math.max(prev[0], star), Math.min(prev[1], mv)]', '[star, mv]'],
```
- 見込み：MB52 は BW36 (c)、MB53〜MB56 は BL26（MB55 は BW37 (a) も）。前の計画の MB57（引き継ぎ）は、Q3＝B で引き継ぎを作らないので**入れない**。
- テストは流さない（T45-18 で流す）。前：T45-02・T45-05。

### T45-13 確認（Opus）

- 差分が 5 章のとおりか（render は `diff $S/render.base.js games/irobin/render.js` が `$S/render-dress.diff` と同じか、logic は T45-02 の写しと比べる）。
- `PORT=8741 WORKERS=1 ONLY=BL1,BL19,BL23,BL24,BL25,BL26 node tests/run.mjs smoke`、`PORT=8741 WORKERS=1 ONLY=BW3,BW4,BW15,BW20,BW22,BW23,BW31,BW32,BW36,BW37,V13,V14 node tests/run.mjs full`。
- スクリーンショット：お店の動物（6 匹 × 段 0〜3）を iPhone 13 縦・SE 縦 Safari で、クリアのカード（段が上がった面）と なかよしちょうのカードを SE 縦横の 4 画面で。見ること：おしゃれが顔（目・口・鼻）を隠さない、小さい物（くまの メダル・ねこの すず・りすの どんぐり）が実機の大きさで見分けられる、ステッキ・ふうせん・りすの しっぽが 枠の外に はみ出さない、色覚（どの おしゃれも体の色に埋もれない）。
- 横展開：ほかのゲームで、保存を書くたびに読み直していない（メモリの値から書く）新しい保存が無いか（X-22 の注意）。

### T45-14 レビュー（遊び方が変わる版：技術 Opus ∥ UX Sonnet ∥ 中毒性 Sonnet）

- 技術（Opus）：3 章の保存の決めごと（書く順・二重に数えない・0 から・起動で書かない・壊れた帳面・新しい版・X-20）、`irobin.book` の大きさ（5000 面で約 70KB）、`setDress` で描き直す回数、`drawDress` が 1 匹あたり何回の描画か（毎フレーム描く所は無いか）。
- UX（Sonnet）：クリアのカードの一言の長さ（SE 横。「ペンギンさんと もっと なかよしに なったよ！ ニットぼうを かぶって くるよ」がいちばん長い）、なかよしちょうの言葉（ひらがな・子ども）、ホーム画面の一言、ボタンが 1 つ増えたカードで迷わないか、18 の おしゃれが何か分かるか。
- 中毒性（Sonnet。A の 10 項目、特に 7「上達が見える」・10「小さなご褒美」・6「毎回少し違う」）：段の間隔（0 から約 10・40・130 面）がちょうどよいか、ご褒美が控えめの範囲か（ガチャ・時間で急かす仕掛けなし）、動物ごとに違うことで「次はだれ」が楽しみになるか。v32 の 33/50 からどれだけ上がるかを採点。
- 指摘を直してからコミットする（W-03）。

### T45-15 文書（Sonnet。関門の前。テストは流さない）

- `docs/irobin-contract.md`：**§24 を足す**（題「なかよしちょう（2026-10-xx、v45、IB-34・IB-41・IB-42）」）：ユーザーの言葉と質問の答え（そのまま。8 章）、3 章の保存の形・表・0 から数える・二重に数えない・X-20、段（10・50・200）と 6 匹 × 3 の おしゃれの表、画面（クリアのカード・なかよしちょう・お店の動物・メニューの ★）、BL26・BW36・BW37、MB52〜MB56、直したテスト（BW31・BW32・V13）。§8.3（保存）と §18 G1 に「`irobin.book` は見張らない（読み直して足すため）」を 1 行。
- `tests/README.md`：いろびんの行の ONLY に `BW36,BW37`（full）・`BL26`（smoke）、M に `MB52〜MB56`。変異の表に T45-18 の結果。
- `tests/design.md`：いろびんの節に BL26・BW36・BW37、直す前に落ちたこと。
- `docs/issues.md` → `issues-done.md`：IB-34・IB-41・IB-42 を v45 で済に。IB-37 の対応に「v45 で IB-41 を入れた。消えた報告があれば つづきコードを考える」。
- `docs/business/irobin/0-summary.md` の注に「第 2 弾は v45 で済」を 1 行。

### T45-16 版を v45 に上げる（Haiku。書いた命令のほかの道具は使わない）

- `common/version.js:3` の `version: "v44", date: "<v44 の日>"` → `version: "v45", date: "<公開する日>"`、`sw.js:5` の `"v44"` → `"v45"`。`APP_FILES` は変えない。
- 確かめ：`cd /home/user/wt-v45 && PORT=8742 ONLY=L10 node tests/run.mjs smoke`。

### T45-17 関門（Haiku。不合格なら止まって出力をそのまま報告）

```sh
cd /home/user/wt-v45
PORT=8743 node tests/run.mjs smoke
PORT=8743 WORKERS=3 node tests/run.mjs full
HEADED=1 BROWSER=webkit WORKERS=1 PORT=8743 xvfb-run -a node tests/run.mjs smoke
```
- 流し直しの決まりは T44-14 と同じ。

### T45-18 変異テスト（Haiku。関門のあと。いろびんの分だけ）

```sh
cd /home/user/wt-v45
PORT=8744 WORKERS=1 ONLY=BL26,BW36,BW37 M=MB52,MB53,MB54,MB55,MB56 node tests/mutants/mutate.mjs both
```
- 全部「検出」が合格。表をそのまま報告し、T45-15 の担当が tests/README.md に写す。

### T45-19 コミット（Haiku。PM の指示があってから）

1. `games/irobin/logic.js` `tests/cases/irobin-logic.mjs`：`feat(irobin): なかよしちょうの保存 irobin.book（動物ごとの数・面ごとの星と手数。0 から数える。壊れた帳面・新しい版。IB-34）。BL26`
2. `games/irobin/render.js`：`feat(irobin): お客さんの動物に おしゃれ（動物ごとに違う 3 段。なかよしの段 0〜3。IB-34）`
3. `games/irobin/main.js` `games/irobin/index.html` `tests/cases/irobin-ui.mjs`：`feat(irobin): クリアで数えて保存（二重に数えない）、クリアのカードの一言と なかよしちょうのカード、ホーム画面の一言（IB-41）、105 面から先の予告（IB-42）。BW36・BW37、BW31・BW32 を直す`
4. `index.html` `tests/cases/layout.mjs`：`feat: メニューのいろびんに ★の合計（IB-34）。V13`
5. `tests/mutants/mutate.mjs` `common/version.js` `sw.js` `docs/`：`v45：版を上げる、変異 MB52〜MB56、契約書 §24・テストの説明・課題表`
- 署名の行は PM が渡すものを一字一句そのまま（W-05）。

### T45-20 公開（Haiku。ユーザーの承認の言葉を PM が引用して渡してから）

```sh
cd /home/user/wt-v45 && git fetch origin && git merge --no-edit origin/master && git push origin claude/v45-irobin-book:master
```

- v45 のタスクの数と担当（6 章の v45 の行は前の計画のまま。こちらが新しい）：**22**（＋レビュー 3）＝ Haiku 6（T45-01・16・17・18・19・20）・Sonnet 14（T45-02・03・04・04a・04b・04c・05・07・08・09・10・11・12・15）・Opus 2（T45-06 画面の並べ方・T45-13 確認）＋レビュー技術。

---

### 5.x 実際とのちがい（T45-15 の担当が、できたコードに合わせて追記。2026-10-27）

- BW37 (g) の期待は「あと 4にん」。105 面で くまにも届けてから予告を作る（くま 195＋届ける 1 で 196。200 まで あと 4）。
- BW37 (c) は「もどる」がスクロールなしで押せる・なかよしちょうの最後の行がスクロールで見える、に置き換えた（SE の Safari では最後の行が帯の下に出る。IB-47）。
- クリアのカードのボタンは next・menu・book・share の 4 つ（BW31・BW32 をこれに合わせて直した）。
- 一言の文は「○さんが ×を つけたよ！」（1 匹）、「○さん・△さんが おしゃれを したよ！」（2 匹）。
- メニューの★は ★ があるときだけ「N めん クリア ★M」。「N めん クリア」の中は折り返さない空白（nowrap）。

## 6. タスクの数と担当のモデル

| 版 | Haiku | Sonnet | Opus | 合計 |
|---|---|---|---|---|
| v44 | 5（T44-01・13・14・15・16） | 9（T44-02〜09・12） | 1（T44-10 確認）＋レビュー技術 | 16（＋レビュー 2） |
| v45 | 6（T45-01・16・17・18・19・20） | 10（T45-02・03・04・05・07・08・09・10・11・12）＋文書 1（T45-15） | 2（T45-06 画面の並べ方・T45-13 確認）＋レビュー技術 | 20（＋レビュー 3） |

- Opus で作る作業は T45-06 だけ（理由はタスクに書いた）。ほかの Opus は確認とレビュー（技術）。
- レビュー：v44＝技術（Opus）・UX（Sonnet）の 2 つ。v45＝技術（Opus）・UX（Sonnet）・中毒性（Sonnet）の 3 つ（遊び方が変わるため。CLAUDE.md 4 章）。
- 確認（Opus）の入る所：v44 は T44-10（作業のあと・レビューの前）、v45 は T45-13（同じ）。レビューの指摘を直したあとも、差分だけ Opus が見る。

---

## 7. ユーザーに決めてもらったこと（決定。2026-10-26。答えは 8 章にそのまま）

**決定 1：おしゃれの段と見た目**（T45-02・T45-04〜04c）
- **動物ごとに違う おしゃれ・3 段**（前の案の C）。届けた数 **10・50・200** で 1 段ずつ（0 から数えるので、最初は約 10 面、最後は約 130 面先。3.1）。6 匹 × 3 つの中身は 3.1 の表。絵は計画担当が試しに描いた（`v45dress/dress.png`）。絵の手間が大きいので、土台と 2 匹ずつの 4 つのタスクに分けた。

**決定 2：なかよしちょうの開き方と名前**（T45-06）
- **クリアのカードに「なかよしちょう」ボタン**（前の案の A・おすすめ）。遊ぶ画面（上の帯・瓶）は変えない。名前は「なかよしちょう」。

**決定 3：前から遊んでいる人の なかよしの数**（T45-02・T45-05）
- **0 から数える**（前の案の B）。古い `irobin.best`・`irobin.save` から数を作らない。帳面が無い人は空の帳面から始まり、起動では書かず、最初のクリアで書く（3.2）。前の計画の `estimateBook`・変異 MB57 は作らない。

**決定 4：残す記録**（T45-02・T45-06・T45-08・T45-11）
- **動物の数＋面ごとの★と一番少ない手数**（前の案の A・おすすめ）。★の合計をメニューと なかよしちょうに出す。クリアした面を選んで遊び直す（★の地図・IB-38）は次の版（v46 以降）で決める。

## 8. ユーザーの答え（2026-10-26。そのまま）

- 版の進め方：「いろびん第二弾と小さめ、両方対応しましょう。まずは計画を立案して記録してください。sonnetやhaikuに依頼できるよう小さなタスクに分解してください」。v44＝小さめ・v45＝第 2 弾（2 章のおすすめ）で進める（PM）。
- 質問 1 おしゃれ：**「動物ごとに違う」**（C：6 匹それぞれ違うおしゃれ・3 段）→ T45-02・T45-04 を書き直す。
- 質問 2 開き方：「クリアのカードから (Recommended)」
- 質問 3 前から遊んでいる人の数：**「0から数える」**（B）→ T45-02 の引き継ぎを書き直す。
- 質問 4 残す記録：「動物＋★と手数 (Recommended)」
