# あまいものあつめ：組み立て表（151 面〜。計画書 [../amai-parts.md](../amai-parts.md)）

`python3 compose.py <id>` で 1 枚、`python3 compose.py` で表の全部を組み立てて、`out/<id>.txt`（文字の地図）・`out/<id>.png`（1 マス 10px）・`out/<id>-se.png`（SE 縦の実寸に近い 1 マス 4.5px）を書き出す。

- 場所：まち（`parts/bg_machi.py`）・ゆうえんち（`parts/bg_yuuenchi.py`）・ほしぞら（`parts/bg_hoshizora.py`）
- 動物 × ふるまい：`parts/<動物>_<ふるまい>.py`（動物：pengin・zou・buta・kaeru／ふるまい：hon・utau・jitensha）
- 置き方：`x=<体のまん中> y=<足の下>`。`ぎゃく` を書くと主役が左むき、`背景ぎゃく` を書くと場所の物の左右が入れかわる（構図が似ないように使い分ける）。
- 季節：`""`（季節でない）・`haru`・`natsu`・`aki`・`fuyu`。

| 面 | 段 | id | 名前 | 季節 | 場所 | 動物 | ふるまい | 置き方 |
|---|---|---|---|---|---|---|---|---|
| 151 | XXL | penginmachihon | まちで ぺんぎんが ほんを よむ | "" | まち | ぺんぎん | ほんを よむ | x=30 y=46 |
| 152 | XXL | zouyuuenchiutau | ゆうえんちで ぞうが うたう | "" | ゆうえんち | ぞう | うたう | x=26 y=46 背景ぎゃく |
| 153 | XXL | butahoshizorajitensha | ほしぞらで ぶたが じてんしゃに のる | "" | ほしぞら | ぶた | じてんしゃに のる | x=30 y=46 |
