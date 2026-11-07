# 計画書：ふつうの花輪と金の花輪を並べる（あまいものあつめ・v71 予定）

作成 2026-11-07（PM・Opus）。

## 0. ユーザーの言葉（承認）

- 「金の花輪ですが、わかりにくいので2つ並べましょう」
- 確かめの質問への答え：並べ方＝「ふつうと金を1つずつ」、場所＝「花輪が出る所すべて (Recommended)」

## 1. 決めたこと

- いま：金（`amai.gold`）がある絵には、ふつうの花輪（`amai.clean`）を付けない（金だけ 1 つ）。
- これから：**両方ある絵には、ふつうの花輪と金の花輪を 1 つずつ横に並べる**（左＝ふつう、右＝金。金は今と同じ右上の角）。片方だけの絵は今までどおり 1 つ。
- 出す所：面えらびの一覧・ずかん・クリアのカード（ちょうせんでクリアした絵が `amai.clean` にもあれば、「ちょうせん クリア！」の前の小さな絵を ふつう＋金 の 2 つに）。説明の行（`p.wnote`・`p.gnote`）は 1 つずつの見本のまま（それぞれの意味を説明する行なので）。
- 2 つのときの大きさ：面えらびのマスは SE 縦（320 幅）で約 65px しかないので、2 つ並ぶときは**どちらも 28px**、ふつうは `right: 27px`（金に少し重なってよい。金が上）。1 つのときは今までの 34px。
- 読み上げ：両方のときは「（1手もどし なし・ちょうせん クリア）」（面えらびは `aria-label`、ずかんは `.sr`）。
- 印：両方のときは `li` に `data-clean="1"` と `data-gold="1"` の両方。

## 2. 直す所（担当：Sonnet）

1. `games/amai/main.js`
   - ずかん（`const gold = !!(n > 0 && p && isGold(id));` の所）：`clean` を `!gold && …` から `!!(n > 0 && p && isClean(id))` にする。`.sr` は両方なら「（1手もどし なし・ちょうせん クリア）」。花輪は clean なら `wreath()`、gold なら `wreath(true)`、両方なら li に class `pair` を付ける（順は ふつう→金）。**MA54 の見つける文字 `const gold = !!(n > 0 && p && isGold(id));` は変えない。**
   - 面えらび（`if (p && got && isGold(p.id)) {` の所）：同じく両方を独立に判定。label は両方なら「（1手もどし なし・ちょうせん クリア）」。両方なら li に `pair`。**MA56 の見つける文字 `if (p && got && isGold(p.id)) {` は変えない**（形を変えるなら mutate.mjs の MA56 も同じコミットで直す）。
   - クリアのカード（`showClearCard`）：`c.gold` で、その絵が `amai.clean` にもあれば `p.clean.gold` の中の小さな絵を ふつう＋金 の 2 つ（`.wreath.inline` と `.wreath.inline.gold`）。`lastClear` に `cleanToo` などを足して判定してよい。
2. `games/amai/index.html`（CSS）：`li.pair .wreath { width: 28px; height: 28px; }`、`li.pair .wreath:not(.gold) { right: 27px; }`、`.wreath.gold` を `z-index: 2`。カードの小さな絵が 2 つ並んでも崩れないこと。
3. `tests/cases/amai-ui.mjs` AW34：base で 5 面の絵は `amai.clean` にもあるので、ちょうせんクリア後は
   - ずかん：5 面の絵は `n: 2`・gold true・`.sr`「（1手もどし なし・ちょうせん クリア）」。7 面の絵はふつう 1 つのまま。
   - 面えらび：5 面は `n === 2`・`clean` も `gold` も真・label に「ちょうせん クリア」と「1手もどし なし」。左がふつう・右が金（getBoundingClientRect の left の比較）。7 面はふつう 1 つ。
   - クリアのカード：`p.clean.gold` の中に `.wreath` が 2 つ（1 つは `.gold`）。
   - 題（title）の「ふつうの花輪より先」を「両方なら ふつうと金を並べる」に。
   - 金だけの絵（clean に無い）を 1 つ確かめたいので、可能なら base の `amai.gold` に別の絵（例：PO[2]、3 面）を最初から入れ、面えらびとずかんで金 1 つだけ（n:1）を確かめる。既存の確かめの期待値は合わせて直す。
4. `docs/ari-contract.md`：§3.4 の表（`li[data-gold="1"] .wreath.gold` の行「金がある面・絵には ふつうの花輪を付けない」）、§3.5 の金の花輪・クリアのカード、§7 AW34・MA54 の説明を新しい決まりに書き直す（W-09）。
5. 版上げは別担当（Haiku）：v71・2026-11-07（version.js の version・date、sw.js の CACHE_VERSION）。

## 3. 流すテスト

- `ONLY=AW34,AW29,AW23 node tests/run.mjs full`（まず直した所）。
- SE 縦（320×568）で面えらびの画面の写真を撮って PM が見る（重なり・はみ出し）。
- 変異：`ONLY=AW34 M=MA53,MA54,MA55,MA56 node tests/mutants/mutate.mjs both`（見つける文字が残っているか・見つかるか）。
- 関門：Chromium smoke・full、WebKit smoke（1 本ずつ）。

## 4. レビュー

直しだけの版で、計画を Opus が立てて差分を確かめるので、レビューは省く（CLAUDE.md 4 章）。
