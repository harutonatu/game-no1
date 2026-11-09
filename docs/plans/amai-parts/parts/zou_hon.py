# 動物 × ふるまい：ぞうが ほんを よむ（すわって、ひざの上の ひらいた本を 両手で持ち、下を見る。鼻の先で ページを めくる）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import zou, hon

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 27
    # しっぽ
    fill(line(cx - 9, by - 5, cx - 13, by - 2), 'K'); fill(ell(cx - 13.5, by - 1.5, 1.2, 1.3), 'K')
    # 奥の足（前へ のばして すわる。短く太い。足のうら W）
    l = ell(cx + 2, by - 3.5, 5.5, 3.4); zou.blob(l, dark=True)
    # 体（すわった まるい胴）
    body = ell(cx - 1, by - 11, 10.5, 10.5)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 手前の足（前へ のばす。足のうらを こちらに見せる：W の つめ）
    l = ell(cx + 7, by - 3, 5.2, 3.2); zou.blob(l)
    sole = ell(cx + 12, by - 3, 1.6, 2.6); shape(sole, 'W', o='K')
    # 耳 → 頭 → 顔（下を見る）
    zou.ear(hx - 11, hy + 1, 8.5, 9)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='down', mouth='smile')
    # 両手（うでは 本のうしろ。手の先で 本の 下の かどを にぎる）
    a = line(cx - 5, by - 15, cx - 4, by - 8, 4.2); zou.blob(a, dark=True)
    a = line(cx + 4, by - 14, cx + 15, by - 6, 4.2); zou.blob(a)
    # 本（ひざの上で 大きく ひらく。手前に かたむける）
    hon.draw(cx + 5, by - 11, w=9, h=5, cover='R', tilt=1.5)
    zou.blob(ell(cx - 4.5, by - 7, 2.3, 2.3), dark=True)
    zou.blob(ell(cx + 15.5, by - 6.5, 2.4, 2.4))
    # 鼻（口の上から 前へ のびて、先で ページの 右上の はしを めくる）
    zou.trunk([(hx + 6, hy + 5), (hx + 9, hy + 4.5), (hx + 12, hy + 5), (hx + 14, hy + 7), (hx + 14, hy + 10)], 5, 3)
    end(flip, cx)
    return head, body
