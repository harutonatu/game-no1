# ぼくのまち：せんろの知らせ と めがねの札（計画書）

作成 2026-11-27（実装担当 Opus）。約束は [docs/machi-contract.md](../machi-contract.md)（§5.1・§5.9・§7.1・§7.3・§7.4・§7.5。決めは §0 と §7.6 に書き写した）。

## 0. ユーザーの言葉（そのまま）

- 実機の写真を見て：「線路はどうやって活用しますか？弾いてみたのですが、入り口とつながっていないと出ます。あと上の汚れとか出てくるやつこれが1部と被ってちょっと見づらいですね。」「線路は道の上に作ることができるの？」
- PM の提案（1 せんろの知らせの言い分け・2 せんろの説明・3 めがねを小さいボタンに）に：「直して公開して」

## 1. 決めたこと

| 項目 | 決め |
|---|---|
| 言い分けの条件 | 区画のマスが いりぐちと つながっていない（つながった みち が 2 マス以内に無い）とき、そのマスから **3 マス以内**（たて・よこ・ななめ。`RAIL_REACH` と同じ四角）に せんろ か ふみきり が 1 マスでもあれば「せんろ のそば」。線の長さ（8 マス）は問わない（引いたばかりの短い線でも言い分ける）。みち が 2 マス以内に無い（「みちから はなれて いるよ」）のときも、せんろ のそばなら こちらを出す |
| 言葉 | 「**せんろ だけでは そだたないよ。みちも ひいてね**」（`L.RAIL_ONLY_TEXT`。#toolHint の 1 行に SE 縦 320×568 でも収まる。CW17 で確かめる） |
| 出す所 | ① 置いたあとの札（main.js `checkLinked`）② しらべる の そだたない わけ（logic.js `inspect` の reasons。「みちが とおい」「いりぐちと つながって いないよ」の代わり）③ 月の知らせ（logic.js の noroad。つながらない区画のうち 1 つでも せんろ のそばなら こちら） |
| 中身の窓口 | `MachiLogic.unlinkedWhy(s, i)` → `"rail"`（せんろ のそば）・`"far"`（2 マス以内に みち が無い）・`"noentry"`（みち は あるが いりぐちと つながらない）・`null`（つながっている・区画でない） |
| 決まりは変えない | せんろ だけでは育たない（§5.3・§5.9）・つながりの計算は今のまま |
| せんろの説明（はじめて選んだとき） | 2 つに分けて 6 秒ずつ続けて出す：①「せんろ＝はなれた みちどうしを つなぐよ」→ ②「そばに みちも いるよ。みちの うえにも ひけるよ」。②のあとは値段のヒントへ。途中で ほかの知らせ（置けない理由など）が出たら ②は出さない |
| あそびかた の せんろ の行 | 「せんろ：はなれた みちどうしを つなぐ（「まち」から）。そばに みちも いるよ。みちの うえにも ひける（ふみきり）」。あそびかたの最後の「「みかた」で しらべよう」は「みぎうえの めがねで しらべよう」 |
| めがねのボタン `#viewBtn` | 44×44 の めがね の絵だけ（SVG。文字なし）。ふつう以外の見かたの間は今どおり黄色（`data-on="1"`）。`aria-label` は今どおり「ちずの みかた：○○。おすと △△」 |
| 見かたの名前の札 `#viewTip` | 押した直後に「みかた：○○」を ボタンの下（右上・ボタンの下 6px）に **3 秒**出して消す（動きなし。動きを減らす設定でも同じ）。続けて押すと 3 秒を数え直す。開いたときは出さない。凡例と重なるときは凡例の下へずらす。`aria-hidden="true"`（読み上げはボタンの aria-label） |
| 凡例 `#viewLegend` | 今どおり ふつう以外で出す。幅の上限を `calc(100% - 150px)` → `calc(100% - 62px)`（ボタンが 44px になった分。ボタンと重ならない） |

## 2. 直す所

| ファイル:行（今） | 前 → 後 | 担当 |
|---|---|---|
| games/machi/logic.js 1130 `hasUnconnected` の近く | `railNearZone(s, i)`・`unlinkedWhy(s, i)` を足す。`RAIL_ONLY_TEXT` を定数に。api に `unlinkedWhy`・`RAIL_ONLY_TEXT` | Opus |
| logic.js 1113 noroad の知らせ | 「いりぐちと つながって いないよ」→ つながらない区画に せんろ のそばが あれば `RAIL_ONLY_TEXT` | Opus |
| logic.js 1351〜1352 inspect の reasons | z<0「みちが とおい…」・未接続「いりぐちと…」→ せんろ のそばなら `RAIL_ONLY_TEXT` の 1 つ | Opus |
| games/machi/main.js 193 TIPS.rail・showTip | 1 文 → 2 文（続けて出す `hintNext`）。setHint で ほかの知らせが出たら続きを捨てる | Opus |
| main.js 266〜273 checkLinked | `far ? … : …` → `L.unlinkedWhy` で rail なら `RAIL_ONLY_TEXT` | Opus |
| main.js 543〜570 めがね | ボタンの中を SVG の絵に。`#viewTip` を 3 秒出す（setTimeout） | Opus |
| games/machi/index.html 156〜160・306・359・362 | #viewBtn を 44×44・#viewTip を足す・凡例の幅・あそびかた の文 | Opus |
| tests/cases/machi-ui.mjs CW8（522〜524）・CW16（818〜826） | `#viewBtn .cur/.nx` → `aria-label` と `#viewTip` | Opus |
| tests/cases/machi-ui.mjs CW17（新） | 下の 3 | Opus |
| tests/cases/machi-logic.mjs CL22（新） | 下の 3 | Opus |
| tests/mutants/mutate.mjs MC62・MC63（新） | 下の 4 | Opus |

## 3. 足すテスト

- **CL22**（Node・full）：flat の町に せんろ だけ（いりぐちに つながる 18 マスの線）とそばの すむ → `unlinkedWhy` が `"rail"`・inspect の reasons に「せんろ だけでは」があり「いりぐちと つながって いない」「みちが とおい」が無い・月の知らせが `RAIL_ONLY_TEXT`。せんろ から 4 マス以上はなれた つながらない区画は `"noentry"`/`"far"` のまま・いつもの言葉。みち を引いて つなぐと `null`。
- **CW17**（画面・full）：375×812 と SE 縦 320×568 で ① せんろ（rank 1 の町）を はじめて選ぶと説明 ①→6 秒→② →6 秒→値段。② と RAIL_ONLY_TEXT が #toolHint の 1 行に収まる（scrollWidth ≦ clientWidth）② せんろ のそばに すむ を置くと札が「せんろ だけでは そだたないよ。みちも ひいてね」・しらべる の わけ も同じ ③ #viewBtn は 44×44 以上・文字なし・中に svg・押すと #viewTip「みかた：よごれ」が出て 3 秒で消える・aria-label・凡例と ボタン・札 が重ならない・ズーム／速さのボタン・#voiceBar・#zoomHint と重ならず、地図の中。動きを減らす設定（`reducedMotion: 'reduce'`）でも札が 3 秒出る。
- 直す：CW8（見かたが回る：aria-label と #viewTip で読む）・CW16（凡例：ボタンと重ならない・ふつうに戻ると凡例が消える）。

## 4. 変異（`ONLY=CL22,CW17 M=MC62,MC63 node tests/mutants/mutate.mjs full`）

- MC62：logic.js `unlinkedWhy` の せんろ のそばを見ない（いつもの言葉に戻る。見つける：CL22）
- MC63：main.js の置いたあとの札が せんろ を言い分けない（見つける：CW17）

## 5. 流すテスト

- `PORT=8987 ONLY=CL1,…,CL22,CW1,…,CW17,X1 node tests/run.mjs full`（Chromium）。WebKit は PM。版は上げない（PM）。
