# 動物 × ふるまい：ぶたが おえかきを する（すわって、ひざの 画板に 画用紙。クレヨンで 絵を かく。足もとに クレヨンの はこ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import buta

SHADOW = (2, 15, 1.6)


def board(x0, y0, w=16, h=13):
    """画板（わく C・ふち K）に 画用紙 W。かいた絵：お日さま Y と 光 O・花 R と くき G・草の線 G。x0, y0 は 左上。"""
    fr = poly([(x0, y0 + 1), (x0 + w, y0), (x0 + w + 1, y0 + h), (x0 + 1, y0 + h + 1)])
    fill(fr, 'C'); fill(edge(fr), 'K')
    pa = poly([(x0 + 1.6, y0 + 2.3), (x0 + w - 1, y0 + 1.6), (x0 + w - .2, y0 + h - 1.1), (x0 + 2.4, y0 + h - .3)])
    fill(pa, 'W')
    # かいた絵（お日さま・花 2 つ・草）
    sx, sy = x0 + w - 4, y0 + 4.5
    fill(ell(sx, sy, 1.8, 1.8), 'Y')
    for (dx, dy) in ((-3, 0), (0, -3), (-2, 2), (2, 2)):
        if (int(sx + dx), int(sy + dy)) in pa: put(int(sx + dx), int(sy + dy), 'O')
    for fx0, fy0, c in ((x0 + 5, y0 + 6, 'R'), (x0 + 8, y0 + 8, 'V')):
        fill(rect(fx0, fy0 + 1, fx0, y0 + h - 2), 'G')
        fill({(fx0 - 1, fy0), (fx0 + 1, fy0), (fx0, fy0 - 1), (fx0, fy0 + 1)}, c); put(fx0, fy0, 'Y')
    fill({(x, y0 + h - 2) for x in range(int(x0 + 3), int(x0 + w - 1))} & pa, 'G')
    return fr


def crayon(x, y, c, dx=1):
    """クレヨン 1 本（よこ。色 c・紙の帯 W・先は とがる）。"""
    m = rect(x, y, x + 4 * dx, y) if dx > 0 else rect(x + 4 * dx, y, x, y)
    fill(m, c); put(x + 2 * dx, y, 'W'); put(x + 5 * dx, y, c)


def draw(cx, by, flip=False):
    begin()
    buta.foot_fwd(cx + 2, by - 3, cx + 12, 4.4, dark=True)
    buta.tail(cx - 9, by - 8)
    body = ell(cx, by - 10.5, 10, 10)
    buta.blob(body)
    buta.foot_fwd(cx - 1, by - 2, cx + 10, 4.6)
    hx, hy = cx + 1, by - 25
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='down', mouth='smile')
    # 奥の手（画板の 左を おさえる）・手前の うで → 画板 → クレヨンを 持つ 手（画用紙の 上）
    buta.arm(cx - 4, by - 15, cx + 2, by - 11, 4, dark=True)
    a = line(cx + 4, by - 15, cx + 15, by - 12, 4.2); buta.blob(a, hi=False)
    board(cx + 3, by - 21, 16, 13)
    cr = line(cx + 16.5, by - 11.5, cx + 13, by - 14.5, 2); fill(cr, 'B'); fill(edge(cr) & line(cx + 16.5, by - 10.5, cx + 13.5, by - 13.5), 'K')
    put(cx + 12, by - 15, 'B'); put(cx + 11, by - 16, 'B')
    h = ell(cx + 17.5, by - 10.5, 2.6, 2.6); buta.blob(h)
    # 足もとの クレヨンの はこ（Y・ふち K）と クレヨン
    bx = cx - 19
    box = rect(bx, by - 5, bx + 6, by - 1); fill(box, 'Y'); fill(edge(box), 'K'); fill(rect(bx + 1, by - 3, bx + 5, by - 3), 'O')
    for k, c in enumerate('RGBV'):
        fill(rect(bx + 1 + k * 1.4, by - 8 + (k % 2), bx + 1 + k * 1.4, by - 5), c)
    crayon(bx + 9, by - 1, 'R')
    end(flip, cx)
    return head, body
