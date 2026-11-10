# 動物 × ふるまい：ぶたが おどる（かた足で 立ち、手前の足を ひざで まげて 上げ、奥の手を 上へ・手前の手を 前へ ひろげる。
#   にっこり目に あけた口。動きの線と 音符）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import buta

SHADOW = (0, 12, 1.5)


def draw(cx, by, flip=False):
    begin()
    # 奥の手（うしろの上へ 高く 上げる）・立つ 奥の足・しっぽ
    buta.arm(cx - 5, by - 18, cx - 15, by - 25, 4, dark=True)
    buta.leg(cx - 2, by - 8, by, 5, dark=True)
    buta.tail(cx - 9, by - 11)
    # 体（すこし かたむく）
    body = ell(cx, by - 13, 8.5, 9.5, 10)
    buta.blob(body)
    # 上げた 手前の足（ももを 前へ、ひざで まげて 下へ。先は ひづめ C）
    l = line(cx + 3, by - 8, cx + 9, by - 10, 5) | line(cx + 9, by - 10, cx + 10, by - 5, 4.6); buta.blob(l, hi=False)
    fill(rect(cx + 9, by - 4, cx + 11, by - 4), 'C')
    # 頭（すこし 上を むく）
    hx, hy = cx + 1, by - 28
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='happy', mouth='open')
    # 手前の手（前へ ひろげる。鼻の 下を とおる）
    buta.arm(cx + 6, by - 17, cx + 15, by - 15, 4.2)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh

    def mark(pts):
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'Y') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # 動きの線（上げた手の 外・前の手の 外・上げた足の 下）
    mark(((-19, -31), (-19, -30), (-19, -29)))
    mark(((-20, -25), (-20, -24), (-20, -23)))
    mark(((20, -18), (20, -17), (20, -16)))
    mark(((21, -13), (21, -12), (21, -11)))
    mark(((14, -2), (15, -2), (16, -2)))
    # 音符（頭の 上の 左右）
    note(cx - s * 7 - 4 * sh, by - 46, 'B')
    note(cx + s * 13 - 4 * sh, by - 44, 'R')
    return head, body
