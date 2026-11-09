# あまいものあつめ：組み立て表の説明（151 面〜。計画書 [../amai-parts.md](../amai-parts.md) §8）

表は担当ごとに `combos/A.md`〜`combos/E.md` に分けた（同じ列の形）。`compose.py` は `combos/*.md` をすべて読み、面の順に並べる。
`python3 compose.py <id>` で 1 枚、`python3 compose.py` で表の全部を組み立てて、`out/<id>.txt`（文字の地図）・`out/<id>.png`（1 マス 10px）・`out/<id>-se.png`（SE 縦の実寸に近い 1 マス 4.5px）を書き出す。部品のファイルが無い行は「まだ描いていない」と出して飛ばす。

- 列：`| 面 | 段 | id | 名前 | 季節 | 場所 | 動物 | ふるまい | 置き方 |`（9 列。面は数字だけ。段は XXL）
- 場所（9）：こうえん・うみべ・だいどころ・ゆきやま・もり・はなばたけ・まち・ゆうえんち・ほしぞら（`parts/bg_<ローマ字>.py`）
- 動物（9）：ねこ neko・くま kuma・うさぎ usagi・いぬ inu・ぱんだ panda・ぺんぎん pengin・ぞう zou・ぶた buta・かえる kaeru
- ふるまい（8）：おやつを たべる oyatsu・ボールで あそぶ booru・ねむる nemuru・おえかきを する oekaki・おどる odoru・ほんを よむ hon・うたう utau・じてんしゃに のる jitensha
- 動物 × ふるまい：`parts/<動物>_<ふるまい>.py`（例：`parts/zou_utau.py`）。
- 置き方：`x=<体のまん中> y=<足の下>`。`ぎゃく` を書くと主役が左むき、`背景ぎゃく` を書くと場所の物の左右が入れかわる。`sky=<色>`・`ground=<色>` で空（へやは かべ）・主役の立つ地面の地の色を変える（主役の体の色と同じときに使う。約束 §2.6。例：`sky=P`）。
- 季節：`""`（季節でない）・`haru`・`natsu`・`aki`・`fuyu`。
