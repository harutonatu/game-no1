# 動物 × ふるまい：かえるが おどる（かた足で立ち、もう かた足を 前へ上げ、両手を 上へ ひろげる。動きの線と音符）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kaeru

SHADOW = (-1, 11, 1.5)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 26
    # 奥の手（左上へ ひろげる）
    kaeru.limb(cx - 5, by - 19, cx - 12, by - 25, 3.8, dark=True)
    kaeru.hand(cx - 13, by - 26.5, -1, dark=True)
    # 立っている 奥の足
    kaeru.limb(cx - 3, by - 8, cx - 4, by - 2, 4.4, dark=True)
    kaeru.foot(cx - 6, by, -1, dark=True, l=4.4)
    # 体（すこし かたむく）
    body = ell(cx, by - 13, 8.5, 9.5, 10)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 12, 5.5, 7.5, body)
    # 上げた 手前の足（ももを 前へ、ひざで まげて 下へ）
    kaeru.limb(cx + 4, by - 8, cx + 10, by - 10, 4.6)
    kaeru.limb(cx + 10, by - 10, cx + 11, by - 6, 4)
    kaeru.foot(cx + 12, by - 4, 1, l=3.4)
    # 頭 → 顔
    head = kaeru.head(hx, hy)
    kaeru.face(hx, hy, eyes='open', mouth='open')
    # 手前の手（右上へ ひろげる）
    kaeru.limb(cx + 6, by - 18, cx + 14, by - 23, 3.8)
    kaeru.hand(cx + 15, by - 24.5, 1)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    # 動きの線（手の外と 足の下）
    for (x, y) in ((cx - s * 17, by - 30), (cx - s * 18, by - 25), (cx + s * 19, by - 29), (cx + s * 20, by - 24)):
        fill({(x - sh, y), (x - sh, y + 1), (x - sh, y + 2)}, 'W')
    fill({(cx + s * 15 - sh, by - 2), (cx + s * 16 - sh, by - 2), (cx + s * 17 - sh, by - 2)}, 'W')
    kaeru.song_notes([(cx - s * 5 - 2 * sh, by - 46), (cx + s * 12 - 2 * sh, by - 43)])
    return head, body
