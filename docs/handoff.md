# 引き継ぎ（新しい会話の人へ）

作成日：2026-10-22（v29 を公開し、ホーム画面のアプリで v29 になったことをユーザーが確かめた直後）。前の版（v28 公開の時点）を書き直したもの。
開発とテストは**自宅 PC（Windows）の Claude Code** で行う（ユーザー決定「クラウドではなく自分のPCで開発、テストしたいです。」）。

## 0. 使い方

新しい会話の最初の一言の例：「docs/handoff.md を読んで、続きから進めて」

この文書は「**今どこにいるか**」だけを書きます。決めごと・課題・案は、次のファイルを正としてください（重複は書きません）。

| 知りたいこと | 見る場所 |
|---|---|
| 決めごと（答え方・進め方・テスト・git） | [CLAUDE.md](../CLAUDE.md) |
| 課題・改善案の一覧（未着手・作業中）と、残件のまとめ方 | [docs/issues.md](issues.md)（終わったものは [docs/issues-done.md](issues-done.md)） |
| もくもくこうばの約束（v29 は §20・§21） | [docs/seizai-contract.md](seizai-contract.md) |
| ほしくだきの約束（v29 は §19） | [docs/asteroid-contract.md](asteroid-contract.md) |
| iPhone の遠隔テスト（中継） | [docs/debug.md](debug.md) の 5 章、[docs/iphone-relay-plan.md](iphone-relay-plan.md) |
| テストの流し方・中継の使い方・実機確認リスト | [tests/README.md](../tests/README.md) |
| ゲーム案 | [docs/game-plan.md](game-plan.md) |

## 1. 今の状態

| 項目 | 内容 |
|---|---|
| 公開版 | `master`、**v29・2026-10-22**（f9400ec）。ホーム画面のアプリで v29 になったことを確認済み |
| 未公開のコミット | `feature/v30`（fix/seizai-carry の文書のコミットを含む）。自宅 PC では **push はユーザーが自分で行う**（下の 5 章） |
| 作業フォルダ（自宅 PC） | `game-no1`（master）、`game-no1-v30`（feature/v30）、`game-no1-seizai`（fix/seizai-carry、v29 で済み）。ほかに古い worktree `game-no1-hashi`・`game-no1-yokotenkai` が残っている |

v29 に入ったもの（詳しくは issues-done.md）：
- もくもくこうば：はこぶ人が門まで運ぶ（SZ-04）、「まち」が出たままにならない（SZ-05）、なえぎの「まち」の猶予 3 秒、「さいしょから」（SZ-07）
- ほしくだき：「さいしょから」（AS-05）。消せないときは古い状態のまま続けて知らせる
- X-19（さいしょからの横展開）を調べて済に。中継の直し T-11（open・reload で移ってもつながる）・T-12（URL の並び、MAC でも仮想を判定）

v29 の関門（自宅 PC）：Chromium smoke 179/179、WebKit smoke 176/176（対象外 3 は Windows の AudioContext、既知）、Chromium full 345/347。
- V8：自宅 PC だけで落ちる → **T-13**。原因はテストの代わりの字体（Windows では文字の箱が 1px 高い）。iPhone の実機ではみ出しなしを確認。ゲームの不具合ではない。
- X1：ERR_NO_BUFFER_SPACE（並列 4 の負荷と推測）。単独では合格。
- ユーザー決定：「V8 は自宅 PC の環境の問題として課題表に T-13 で記録し、中継を止めて、v29 を公開してください」。

公開前に中継で iPhone の実機を確かめた：T-11 合格、もくもくこうばの はこぶ人は 86 秒で 11 回門まで行き「まるた まち」は出なかった。

## 2. 次にやること：v30 の続き（クラウドで行う）

**ユーザーの承認「v30 の修正計画を支持します」**。v30 ＝ X-21（メニューを遊んだ順に）・X-20（戻る・別タブで古い状態を書き戻さない、**ほしくだき以外**）・T-13（V8 の測り方）・X-17（ピカッと4人・SE Safari 横）。**ほしくだき（games/asteroid）は触らない**（ユーザー決定「ほしくだきは修正を待ってほしい」）。
ブランチ **`feature/v30`**（f58ce61 まで。自宅 PC で作り、ユーザーが push）。担当 3 人の実装とコミット（課題ごと：978a2bf X-21、fba6248 X-20、f58ce61 T-13・X-17）まで済み。各担当は自分の範囲のテストに合格（X-20 の担当は自宅 PC で全項目 full 356/356）。**まだしていないこと**：

1. 技術（Opus）と UX（Sonnet）のレビューを同時に（対象 `git diff fe8a2b2..feature/v30`）。直すものがあれば直す。
2. 合流（下の 2.1 の材料をそのまま使う）：tests/mutants/mutate.mjs に変異を足す、tests/design.md・README.md を直す、docs/issues.md の X-21・X-20（ほしくだきの分は残す）・T-13・X-17 を済にして issues-done.md へ。
3. 変異テスト（そのゲームの分だけ、CLAUDE.md 5 章）：MR1〜4（メニュー）、X-20 の 14 案、X-17 の 1 案。全部「見つかる」こと。
4. 版を v30 に（version.js の version・date と sw.js の CACHE_VERSION。日付は公開する日。ファイルの追加は無いので APP_FILES はそのまま）。
5. 関門（クラウド）：Chromium smoke・full、WebKit smoke（WORKERS=1）。
6. ユーザーに結果を見せて承認 → 公開（`git push origin feature/v30:master`、fast-forward）。実機の確認：メニューでゲームを開いて戻ると、そのゲームが一番上に来るか。

**クラウドでの進み具合（2026-10-22、ブランチ `claude/v30-handoff-docs-tftm14`＝feature/v30 の続き）**：1〜6 は済。ユーザーの承認「公開してください」で 6c6d808 を master へ公開した（2026-10-22）。実機の確認（版の表示とメニューの並び）はユーザーが行う。
- 1：UX は要修正なし。技術は推奨1（裏から閉じるときに保存がほかで変わっていないか比べ直していない）を 878b5af で直した（`staleOnHide()`、reload は1回だけ）。残りは X-22〜24・T-14・T-15 へ。
- 2・3：変異 26 個（MR1〜4、MW65〜67、M24〜26、MD9〜11、MZ5〜7、MB23〜25、MQ42〜44、MH21〜23、MP10）は全部検出。文書の合流は fd23b45。
- 4：0dab210 で v30。
- 5：Chromium smoke 180/180、full 356/356。WebKit smoke は 2 回とも 176/178（FW4 と、Target crashed の QW3・WW5）。FW4・WW5 は v29 の master でも同じに落ちるので v30 の変更ではない → T-16。

### 2.0 v31（2026-10-22、クラウド。ユーザーの承認「v31 の計画を支持します」「テストが終わったら公開してください」）
- 中身：ピカッと PK-31〜37、ハシわたり HS-01〜05・07・08・11、メニュー X-23・HS-06、ブロック X-18、テスト T-14・T-15、ほしくだき ちらしの扇を半分（ユーザーの依頼）。技術・UX のレビューの直し（確認カードに鍵・「つづける」など）も入れた。
- 関門：Chromium smoke 179/180（KW3 は前からの不安定 → T-19、流し直しで合格）、full 362/362、WebKit smoke 174/178（4件とも Target crashed、流し直しで合格）。
- ほしくだきの作り直しの方向は決まった（契約 §20、AS-07）。次は静止画の案を 2〜3 つ見せる。
- 実機の確認：tests/README.md の実機確認リスト 12〜16（メニューの並び・ピカッとの確認カード・SE 横のブロック・ハシわたりの最大の長さの音）と、ちらしの扇。

### 2.0b v32（2026-10-23）
- 中身：ほしくだきの ちらしの扇をさらに 25% 狭く（AS-08。ユーザー「このまま v32 として公開して」）。
- 関門：ユーザー決定「関門テストは星砕きだけに限ってください」で、ほしくだきの項目（KL・KW）と X1・L10（版の食い違い）だけを流した。Chromium full 38/38、WebKit smoke 24/24。

### 2.1 合流の材料（担当の報告から写したもの）

**変異の案（mutate.mjs にそのまま貼る形）**
```js
  ['MR1 最近遊んだゲームを先頭でなく後ろに足す', '並び順', 'index.html', 'return cleanRecent([url, ...recent.filter((u) => u !== url)]);', 'return cleanRecent([...recent.filter((u) => u !== url), url]);'],
  ['MR2 メニューを並べ替えない', '並び順', 'index.html', 'if (want.every((li, i) => now[i] === li)) return;', 'if (true) return;'],
  ['MR3 壊れた yubi.recent でメニューが落ちる', '保存データ互換', 'index.html', 'try { return cleanRecent(JSON.parse(localStorage.getItem(RECENT_KEY))); } catch (e) { return []; }', 'return cleanRecent(JSON.parse(localStorage.getItem(RECENT_KEY)));'],
  ['MR4 押した瞬間に並べ替える（押し間違い）', '操作', 'index.html', 'a.addEventListener("click", () => saveRecent(game.url));', 'a.addEventListener("click", () => { saveRecent(game.url); placeRows(); });'],
  ['MW65 もくもくこうば：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/seizai/main.js', '    if (!stale && !changedElsewhere()) return false;', '    return false;'],
  ['MW66 もくもくこうば：開き直す前（stale）でも保存を書く（X-20）', '保存', 'games/seizai/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['M24 ばいばいタイル：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/2048/index.html', '    if (!stale && rawState() === seenState) return false;', '    return false;'],
  ['M25 ばいばいタイル：裏で別のタブが書いても保存を止めない（storage を見ない。X-20）', '保存', 'games/2048/index.html', 'if (document.hidden && (e.key === null || e.key === KEY_STATE)) stale = true;', 'if (false) stale = true;'],
  ['MD9 いろコード：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/irocode/index.html', '    if (!stale && WATCH_KEYS.every((k) => readRaw(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MD10 いろコード：開き直す前（stale）でも保存を書く（X-20）', '保存', 'games/irocode/index.html', '  function writeJSON(key, v) {\n    if (stale) return;\n', '  function writeJSON(key, v) {\n'],
  ['MZ5 ゼンマイ：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/zenmai/index.html', '    if (!stale && rawProgress() === seenProgress) return false;', '    return false;'],
  ['MZ6 ゼンマイ：開き直す前（stale）でも進み具合を書く（X-20）', '保存', 'games/zenmai/index.html', '  function saveProgress() {\n    if (stale) return;\n', '  function saveProgress() {\n'],
  ['MB23 いろびん：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §18・X-20）', '保存', 'games/irobin/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MB24 いろびん：開き直す前（stale）でも保存を書く（契約 §18・X-20）', '保存', 'games/irobin/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['MQ42 まとめてポン：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §11・X-20）', '保存', 'games/matomete/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MQ43 まとめてポン：裏で別のタブが書いても保存を止めない（storage を見ない。契約 §11・X-20）', '保存', 'games/matomete/main.js', 'if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true;', 'if (false) stale = true;'],
  ['MH21 ハシわたり：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §17・X-20）', '保存', 'games/hashi/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MH22 ハシわたり：開き直す前（stale）でもベストを書く（pagehide で下げる。契約 §17・X-20）', '保存', 'games/hashi/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['M?? ピカッとのとても低い横画面ですき間を詰めない（SE Safari 横で 4 人の隅が重なる、X-17）', 'ボタン重なり', 'games/pikatto/index.html', '@media (orientation: landscape) and (max-height: 300px) {', '@media (orientation: landscape) and (max-height: 260px) {'],
```
- 見つける項目の見込み：MR1・MR2＝E7・E8、MR3＝E8・X1、MR4＝E8（流し方 `ONLY=E1,E7,E8 M=MR1,MR2,MR3,MR4`）。X-20：WW26（MW65・66）、P10（M24・25）、I20（MD9・10）、ZU16（MZ5・6）、BW20（MB23・24）、QW21（MQ42・43）、HW20（MH21・22）。smoke では見逃す設計（新しい項目は full）。X-17 は V2。M?? は既存の M の続きの番号にする。
- X-20 の担当の見込みは「流していない」。MR1〜4・X-17 は担当が手で確かめ済み。

**tests/design.md に足す文**
- E 節：「E7・E8 メニューの並び（X-21）：`yubi.recent`（url の配列、最近が先頭）にあるゲームが先、残りは GAMES の順。カードの click（タップ・Enter を含む）で保存だけし、並べ直すのは開いたとき・pageshow・visibilitychange。壊れた保存（JSON でない・配列でない・知らない url・重複・長すぎ）は使える分だけ使う。並べ直しは li を付け直すだけで、絵とベストは残る。保存に失敗しても移動する。メニューのカードは並びが変わるので、テストでは `nth()` でなく `a.game[href="…"]` で押す。」
- 項目の対応表：`| 古いページから書き戻さない（X-20） | bfcache から戻った・裏で別のタブが書いたページが、メモリの古い状態を保存に書き戻す（6） | WW26（もくもくこうば。visibilitychange が先の順も）, P10（ばいばいタイル）, I20（いろコード）, ZU16（ゼンマイさんぽ）, BW20（いろびん）, QW21（まとめてポン）, HW20（ハシわたり。ベストを下げない） |`
- V8・V1：「スコア欄の文字は Range の矩形で測るが、各行の縦は『行の中心 ± line-height/2』に切り詰める（T-13）。テストは Google Fonts を空にするので、文字は端末の代わりの字体で描かれ、字体の文字の箱が OS で違う（Windows では 12px・line-height 15px に対して 16px）。横は Range のまま。許容は 0.5px のまま。」
- V2：「SE の Safari 横（568×270）で、ブロック（K1）に加えて、ピカッと 4 人の隅が重ならないこと、すき間 6px 以上・高さ 44px 以上（X-17）。」

**tests/README.md に足す文**
- 変更ごとの流し方の表：`| メニュー（index.html）の並び・カード | smoke ＋ ONLY=E1,E7,E8,D9,A4,A5,T3 node tests/run.mjs full |`。各ゲームの ONLY に WW26・BW20・QW21・HW20・ZU16・I20・P10 を足す。V2 の説明に「SE 横 Safari（568×270）のブロック・ピカッと 4 人が重ならない」。変異の表に X-17 の行 `| M?? ピカッと 4 人の隅が SE Safari 横で重なる（X-17） | 検出（V2） | 検出（V2） |`。
- 説明：「古いページから書き戻さない（X-20）：途中の保存を持つゲームは、表に戻ったとき（visibilitychange・pageshow）に保存が自分の覚えた文字と違えば、書かずに `location.reload()` する。テストは pageshow を `new PageTransitionEvent('pageshow', { persisted: true })` で送って再現し、別のタブは同じ context の 2 つ目のページから書く（本物の storage イベント）。」

**課題表に書くこと**
- X-20：ほしくだき（games/asteroid/main.js:861–863、15 秒ごとの自動保存、sleep の saveNow）にも同じ直しが要る。写すときは stale を saveNow の先頭で見て静かに抜ける（writeKey で false を返すと tellSaveFail の「保存できない」が出る）。iPad の画面分割で同時に 2 つ見えているときは後勝ちのまま。ブロック・ピカッとはベストの競合がまれに起こりうる（直していない）。ほしくだきの KW9（`#gameTitle`）も Range で測っていて、T-13 と同じ揺れが起き得る（直すなら同じ切り詰め）。
- X-21：`history.scrollRestoration = "manual"` を入れた（戻ったとき先頭のゲームが見えるように、メニューはいつも一番上から）。
- X-17：高さ約 263px 未満の横画面ではまだ重なる（実在の端末には無い）。
- テストの並列数（自宅 PC で測定 2026-10-22）：Chromium full を WORKERS=4 で 241 秒、8 で 184 秒。8 では速さを測る A5・WW10 が落ちる（T-02・T-09）。ユーザーは並列 8 を希望（「８は行けますよね」）。

## 3. この会話でやったこと（2026-10-22）

- SZ-04・SZ-05 の直しを技術・UX でレビュー → なえぎの猶予 3 秒・段が変わったら券を 0 に、を足した。
- ユーザーの提案「一度の改修で複数の課題を解決し、一度のテストでリリース」を受け、性質の似た課題（さいしょから・中継）を v29 にまとめた。3 人の担当で並列に作り（触るファイルを分け、担当はコミットしない）、合流担当がコミットを課題ごとに分けた。変異テスト MW61〜64・MK38〜42 はすべて見つかった。
- 技術・UX のレビューで出た小さな直し 3 つ（ほしくだきの消せないときの知らせ・MAC での判定・文字ボタンの色）を関門の前に入れた。bfcache の件は X-20 に。

## 4. 進め方で学んだこと（この会話で追加したもの）

- **push は Claude Code の権限設定で止められる**（会話の中の許可でも越えられない）。公開の push はユーザーに PowerShell で流してもらい、Claude は `git ls-remote` と公開サイトの `common/version.js` で確かめる（今回は push から約 30 秒で v29 に）。
- 同じフォルダで複数の担当を並列に動かすときは、担当に git の add・commit をさせず、テストの PORT を分け（8800・8900・9000）、共有の文書（tests/README.md・design.md・mutate.mjs・issues）は合流担当が最後にまとめて直す。
- テストを同時に何本も流すと、Windows では通信の空きが足りなくなり（ERR_NO_BUFFER_SPACE）、関係ない項目が落ちる。関門は 1 本ずつ流す。
- Git Bash から中継に `path=/games/…` を送ると、Windows のパスに書き換えられる。`MSYS_NO_PATHCONV=1` を付ける。
- 中継の住所（192.168.1.13:8790）は公開サイトと別のサイトなので、保存データも別（ゲームは最初から始まる）。Safari では safe-area は 0。ホーム画面のアプリの safe-area は中継では測れない。
- Claude がバックグラウンドで中継を起動すれば、ユーザーが PowerShell の窓を開く必要はない（会話を閉じると中継も止まる）。
- 音声入力の聞き間違い（例：「P 11」＝T-11、「気」＝木）は、文脈から読み、読み替えたことを答えに書く。

## 5. 作業環境のこと

### 自宅 PC（Windows、6コア12スレッド、16GB）
- リポジトリは `C:\tools\vm\share\701．ゆびあそび\game-no1`。作業前に `git switch master` と `git pull origin master`。
- PowerShell では環境変数を `$env:WORKERS=4; node tests/run.mjs full` の形で書く（CLAUDE.md 5 章）。
- 公開（ユーザーが流す）：`git -C <作業フォルダ> push origin <ブランチ>:master` と `git -C <作業フォルダ> push origin <ブランチ>`。

### 会社 PC
- **監視ソフトがある**。テストと中継は使わない。
