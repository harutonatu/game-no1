# あまいものあつめ：絵の部品の手引き（担当 A〜E 向け）

計画書 [../amai-parts.md](../amai-parts.md)（§8 が 50 枚の表と担当）・約束 [docs/ari-contract.md](../../ari-contract.md) §2.6。
1 枚の絵＝「場所の背景」＋「動物 × ふるまい」の部品を、組み立て表の 1 行で重ねて、64×48 の文字の地図（`out/<id>.txt`）にする。

## 1. 自分が編集してよいもの（ほかは読むだけ）

| 担当 | 部品ファイル（`parts/`） | 表 |
|---|---|---|
| A ぺんぎん | `pengin.py`・`pengin_<ふるまい>.py` | `combos/A.md` |
| B ぞう | `zou.py`・`zou_<ふるまい>.py`・`maiku.py` | `combos/B.md` |
| C ぶた | `buta.py`・`buta_<ふるまい>.py`・`jitensha.py` | `combos/C.md` |
| D かえる | `kaeru.py`・`kaeru_<ふるまい>.py` | `combos/D.md` |
| E 今の動物 | `neko.py` `inu.py` `usagi.py` `kuma.py` `panda.py` と その `_<ふるまい>.py` | `combos/E.md` |

- 共通（`lib.py`・`compose.py`・`check.js`・`bg_*.py`）と、ほかの担当のファイルは**編集しない**。小物の `hon.py`（A）・`maiku.py`（B）・`jitensha.py`（C）は持ち主だけが直し、ほかの担当は**呼ぶだけ**（形を変えたいときは、自分のファイルに写して別の名前で使う）。
- 新しい小物（ボール・おやつ・クレヨン など）は、自分の動物の名前で始まるファイル（例 `kaeru_booru.py` の中、または `kaeru_mono.py`）に書く。
- 共通の部品を直したい・計画とちがう・迷うときは、直さずに止まって PM に報告する。

## 2. 部品の書き方

- **動物 × ふるまい**（`parts/<動物>_<ふるまい>.py`。ふるまい：oyatsu booru nemuru oekaki odoru hon utau jitensha）：
  ```python
  from lib import *
  import zou, maiku            # 動物の体の部品と小物
  SHADOW = (3, 13, 1.6)         # 足もとのかげ：体のまん中からの横のずれ・横の半径・縦の半径
  def draw(cx, by, flip=False): # cx＝体のまん中、by＝足の下（ふつう 46）
      begin()                   # ここから下は「右むき」で描く
      ...                       # 奥の手足 → 体 → 頭 → 顔 → 手前の手足・小物 の順に重ねる
      end(flip, cx)             # flip なら cx を軸に左右ぎゃく。主役のふちの外の模様は地の色にもどる
      return head, body         # 頭と胴体のマスの集まり（決まり 8 の確かめに使う）
  ```
  音符・動きの線など、向きで左右に動かしたくない物は `end()` のあとに描いてよい（`zou_utau.py`）。
- **動物の体**（`parts/<動物>.py`）：`blob(m)`（体の色でぬる・かげ・ふちどり K）・`head`・`face`・`ear`・`leg` など。今の動物（E）は、今の 150 枚（`docs/plans/amai-redraw/<id>.py`・`.png`）と同じ見た目にする（いぬは しろい体・ちゃいろのぶち・たれ耳・あかい首輪、ぱんだは しろい体・くろい耳と目のまわりと手足・ピンクのほっぺ）。
- **道具**（`lib.py`）：`ell rect poly line arc`（マスの集まりを作る）・`fill shape dither edge cells`（ぬる）・`note sparkle`（音符・きらり）・`hsh(x, y, k)`（決まったばらつき。乱数は使わない）。1 マス＝1 粒で描く（2×2 のかたまりだけで描かない）。
- **かげ**：体は `shape(m, 色, sh=かげ色, sw=1)` で左下にかげ、ふちどり K。地面のかげは compose.py が `SHADOW` と背景の `floor`・`shade` から描く（自分で描かない）。
- **背景**（`parts/bg_<場所>.py`。全部同じ呼び方）：`draw(flip=False, sky=None, ground=None)`。場所の物は左右に 1 つずつ（x が 3〜15 と 48〜61 のあたり）。`flip`（表の「背景ぎゃく」）で左右が入れかわる。主役は x＝26〜36 あたりに置くと、物が両方見える。

| 場所 | ファイル | 物（2 つ） | sky のふだん | ground のふだん |
|---|---|---|---|---|
| こうえん | bg_kouen | 大きな木・ベンチ | S | G（しばふ） |
| うみべ | bg_umibe | パラソル・ヨット | S | Y（すな） |
| だいどころ | bg_daidokoro | まど・だな（なべ） | W（かべ） | Y（ゆか） |
| ゆきやま | bg_yukiyama | もみの木・ゆきだるま | S | W（雪） |
| もり | bg_mori | 大きな木・きのこ | S | G（こけ） |
| はなばたけ | bg_hanabatake | ひまわり・ちょうちょ | S | G（草と花） |
| まち | bg_machi | ビル・家 | S | O（歩道。道は V） |
| ゆうえんち | bg_yuuenchi | 観覧車・旗 | P | Y（ひろば） |
| ほしぞら | bg_hoshizora | 月・星 | B（よる） | C（小道） |

- **sky=・ground=**（表の置き方に `sky=P ground=D` と書く）：主役の体の色と空・地面の色が同じときに変える（約束 §2.6）。例：ぞう（S）は S の空で `sky=P` か `sky=W`、かえる（G）は しばふ・こけ・草で `ground=Y` か `ground=D`、しろい主役（うさぎ・いぬ・ぱんだ）は だいどころで `sky=S`・ゆきやまで `ground=S`、ぶた（P）は ゆうえんちで `sky=S`、ねこ（O）は まちで `ground=Y`、くま（C）は ほしぞらで `ground=O`。地面の模様の色は `lib.accent` が地の色から決める。

## 3. 1 枚の作り方と確かめ方

1. `combos/<担当>.md` に 1 行足す（計画書 §8 の面・id・名前・季節・場所・動物・ふるまい。段は XXL）。列：`| 面 | 段 | id | 名前 | 季節 | 場所 | 動物 | ふるまい | 置き方 |`。置き方：`x=<体のまん中> y=46`・`ぎゃく`（主役が左むき）・`背景ぎゃく`・`sky=`・`ground=`。
2. `cd docs/plans/amai-parts && python3 compose.py <id>` → `OK` と「決まり 8 … 'ok': True」を確かめる。
3. `node check.js <id>` → 「合格」。
4. **PNG を目で見る**：`out/<id>.png`（大きい）と `out/<id>-se.png`（SE 縦の実寸）。何をしているか・どの動物か・場所の物 2 つが一目で分かるか。
5. 同じ部品の 2 枚目は、場所を変え、向き（ぎゃく）・置く位置（x）・背景ぎゃく のうち 2 つ以上を変える。
- 試しの絵は表に入れずに作ってよいが、**試しのファイルはコミットしない**。

## 4. 描く決まり（約束 §2.6 の要点）

- 64×48 を全部うめる（背景の部品がうめる）・12 色（R O Y G S B P C W K D V）・色は 8〜12・各色 3 個以上・閉じた空きなし・角砂糖 2400〜3072（`compose.py` と `check.js` が確かめる）。
- 今の絵柄：太いふちどり（K）・光とかげ・奥行き。**主役は絵の半分くらい**、顔ははっきり。**場所の物は 2 つまで**（背景の部品にある分だけ。足さない）。
- 頭と胴体は 3 マス以上重ね、首は頭の幅の半分以上（決まり 8）。
- **足は胴の高さの半分くらいまで・太さ 3 マス以上**。じてんしゃは ひざで曲げて足先をペダルに（サドルを高くしない）。
- 主役の体の色と空・地面の色が同じなら、`sky=`・`ground=` で背景の色を変える。
- ぞうの耳は顔の横の大きな丸い耳（`zou.ear`。空が P の場所で `inner='P'` を使わない。ドーナツに見える）、うたうときのマイクは大きく（`maiku.draw` の返り値 `grip` を手でにぎる）。ぺんぎんは目のまわりに白いわっか。有名なキャラクターに似せない。

## 5. コミット

- 1 枚できたら、自分のファイルだけを入れる：
  ```sh
  git add parts/<自分の部品>.py combos/<担当>.md out/<id>.txt out/<id>.png out/<id>-se.png
  git commit parts/<自分の部品>.py combos/<担当>.md out/<id>.txt out/<id>.png out/<id>-se.png -m "あまいものあつめ：…（日本語で何を描いたか）"
  git push origin feature/amai-parts
  ```
  `git commit <ファイル>` の形にして、ほかの人の変更を入れない（`git commit -a` や `git add .` は使わない）。`index.lock` で失敗したら数秒あけてやり直す。push が失敗したら数秒あけてやり直す（force push はしない）。
- メッセージの末尾には、PM から指示された署名の 2 行をそのまま書く。
- master・games/・common/・sw.js・tests/ は触らない。
