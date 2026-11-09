# 動物 × ふるまい：ぶたが ほんを よむ（すわって、ひらいた本を 両手で 持ち、下を見る）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import buta, hon

SHADOW = (2, 14, 1.6)


def hand(x, y, dark=False):
    h = ell(x + .5, y + .5, 2.3, 2.5); buta.blob(h, dark=dark)


def books(x, by):
    """よこに つんだ 本 2 さつ（下 C・上 R。ページの はし W）。x は まん中。"""
    for (dy, w, c, ox) in ((0, 5, 'C', 0), (4, 4, 'R', 1)):
        b = rect(x - w + ox, by - 5 - dy, x + w + ox, by - 1 - dy)
        fill(b, 'W'); fill(cells(b, lambda xx, yy: yy in (by - 5 - dy, by - 4 - dy, by - 1 - dy) or xx <= x - w + ox + 1), c)
        fill({(xx, by - 3 - dy) for xx in range(x - w + ox + 3, x + w + ox, 2)}, 'S')
        fill(edge(b), 'K')


def draw(cx, by, flip=False):
    begin()
    books(cx - 16, by)
    # 奥の足（前へ）・しっぽ
    buta.foot_fwd(cx + 2, by - 3, cx + 12, 4.4, dark=True)
    buta.tail(cx - 9, by - 8)
    body = ell(cx, by - 10.5, 10, 10)
    buta.blob(body)
    # 手前の足（前へ）
    buta.foot_fwd(cx - 1, by - 2, cx + 10, 4.6)
    # 頭（下を見るので 少し 前へ・下へ）
    hx, hy = cx + 1, by - 25
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='down', mouth='smile')
    # うで → 本 → 本の はしを 持つ 手
    a = line(cx - 4, by - 15, cx - 1, by - 11, 4); buta.blob(a, dark=True, hi=False)
    a = line(cx + 4, by - 16, cx + 15, by - 12, 4.2); buta.blob(a, hi=False)
    hon.draw(cx + 7, by - 11, w=8, h=5, cover='B', tilt=1)
    hand(cx - 2, by - 10, dark=True)
    hand(cx + 17, by - 11)
    end(flip, cx)
    return head, body
