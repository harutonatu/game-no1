# 動物 × ふるまい：ぶたが おやつを たべる（すわって、ソフトクリームを 口へ。足もとの おさらに ドーナツ。目は にっこり）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import buta

SHADOW = (3, 15, 1.6)


def icecream(x, y):
    """ソフトクリーム（コーン O・あみ C、うずまき W と かげ S、上に いちご R）。x, y は コーンの 下の先。"""
    cone = poly([(x - .5, y + 1), (x - 3.5, y - 7), (x + 4.5, y - 7)])
    fill(cone, 'O'); fill(cells(cone, lambda xx, yy: (xx + yy) % 3 == 0 or (xx - yy) % 3 == 0), 'C'); fill(edge(cone), 'K')
    cr = ell(x + .5, y - 8.5, 5.3, 2.3) | ell(x + .5, y - 11, 4, 2) | ell(x + .5, y - 13, 2.5, 1.6)
    fill(cr, 'W'); fill(cells(cr, lambda xx, yy: (xx - 1, yy) not in cr or (xx, yy + 1) not in cr), 'S')
    fill(cells(cr, lambda xx, yy: (yy == int(y - 10.6) and xx <= x + 1) or (yy == int(y - 12.6) and xx >= x)), 'S')
    fill(edge(cr), 'K')
    st = ell(x + .5, y - 15, 1.5, 1.3); fill(st, 'R'); fill(edge(st) - {(x, y - 16)}, 'K'); put(x + 1, y - 16, 'G')


def donut(x, y):
    """おさら（W・かげ S）に ドーナツ（生地 C・チョコ がけ R に カラフルな つぶ）。x, y は おさらの まん中。"""
    pl = ell(x, y, 7.5, 1.8); shape(pl, 'W', sh='S', sw=1)
    d = ell(x, y - 3, 6, 3.4)
    fill(d, 'O'); top = cells(d, lambda xx, yy: yy <= y - 3 or (yy == y - 2 and xx % 3 == 0))
    fill(top, 'R'); fill(ell(x, y - 4, 1.8, 1), 'K')
    for (dx, dy, c) in ((-4, -4, 'Y'), (-2, -5, 'B'), (0, -5, 'W'), (2, -5, 'Y'), (4, -4, 'B'), (-3, -3, 'W'), (3, -3, 'G'), (1, -3, 'B')):
        put(x + dx, y + dy, c)
    fill(edge(d), 'K')


def draw(cx, by, flip=False):
    begin()
    buta.foot_fwd(cx + 2, by - 3, cx + 11, 4.4, dark=True)
    buta.tail(cx - 9, by - 8)
    body = ell(cx, by - 10.5, 10, 10)
    buta.blob(body)
    buta.foot_fwd(cx - 1, by - 2, cx + 9, 4.6)
    hx, hy = cx, by - 25
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='happy', mouth='eat')
    # 手前の手（コーンを にぎる）→ ソフトクリーム（口の 前）
    buta.arm(cx + 2, by - 13, cx + 8, by - 8, 4.2)
    icecream(cx + 11, by - 4)
    # おしりの よこの おさら と ドーナツ（もう 1 つの おやつ）
    donut(cx - 15, by - 2)
    end(flip, cx)
    return head, body
