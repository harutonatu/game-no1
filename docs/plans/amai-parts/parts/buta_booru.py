# 動物 × ふるまい：ぶたが ボールで あそぶ（かた足で 立ち、手前の足で ボールを ぽんと ける。ひづめが ボールに ふれる。
#   両手を ひろげて うれしそう。当たった しるしと 動きの線）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import lib, buta

SHADOW = (5, 15, 1.6)


def ball(cx, cy, r=6.2):
    """ビーチボール（R・W・B の しま。まん中に Y の まる。ふち K・光 W）。"""
    m = ell(cx, cy, r, r)
    for (x, y) in m:
        dx = x + .5 - cx
        k = int((dx + r) // (2 * r / 5))
        put(x, y, 'RWBWR'[min(4, max(0, k))])
    fill(cells(m, lambda x, y: ((x - 1, y) not in m or (x, y + 1) not in m) and at(x, y) == 'W'), 'S')   # かげ（左下）
    fill(cells(m, lambda x, y: ((x - 1, y) not in m or (x, y + 1) not in m) and at(x, y) == 'R'), 'V')
    fill(ell(cx, cy, 1.6, 1.6), 'Y')
    fill(edge(m), 'K')
    fill({(int(cx + 2), int(cy - 4)), (int(cx + 3), int(cy - 4)), (int(cx + 3), int(cy - 3))} & m, 'W')
    return m


def draw(cx, by, flip=False):
    begin()
    # 奥の手（うしろの上へ ひろげる）・立つ 奥の足・しっぽ
    buta.arm(cx - 5, by - 17, cx - 13, by - 22, 4, dark=True)
    buta.leg(cx - 2, by - 8, by, 5, dark=True)
    buta.tail(cx - 9, by - 10)
    body = ell(cx, by - 13, 9, 9.5, 8)
    buta.blob(body)
    # 頭
    hx, hy = cx + 1, by - 27
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='open', mouth='open')
    # ボール（足もと。手前の足の先が ふれる）
    bx, bcy = cx + 19, by - 7.5
    ball(bx, bcy, 7)
    # 手前の足（ももを 前へ のばして けった ところ。先は ひづめ C が ボールに つく）
    l = line(cx + 3, by - 8, cx + 11, by - 7, 5); buta.blob(l, hi=False)
    fill(rect(cx + 11, by - 9, cx + 11, by - 6), 'C')
    # 手前の手（うしろの下へ のばして つりあいを とる）
    buta.arm(cx - 1, by - 15, cx - 10, by - 11, 4.2)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh

    def mark(pts):
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'Y') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # 当たった しるし（ボールと ひづめの さかいの 上と 下に 短い線）
    mark(((11, -12), (10, -13), (9, -14)))
    mark(((11, -3), (10, -2), (9, -1)))
    # 動きの線（ボールが 前へ とぶ。ボールの 前の上に 3 本）
    for (dx, dy, n) in ((28, -12, 3), (29, -8, 4), (28, -4, 3)):
        mark(tuple((dx + i, dy) for i in range(n)))
    sparkle(X(23), by - 19, 'Y')
    return head, body
