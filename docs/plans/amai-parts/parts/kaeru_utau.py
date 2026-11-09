# 動物 × ふるまい：かえるが うたう（うしろ足で立ち、スタンドのマイクに大きな口をよせ、奥の手を広げる。音符がとぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kaeru, maiku

SHADOW = (3, 13, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 25
    # 奥の手（ななめ上へ 広げる）
    kaeru.limb(cx - 5, by - 18, cx - 12, by - 25, 3.8, dark=True)
    kaeru.hand(cx - 13, by - 26, -1, dark=True)
    # 奥の足
    kaeru.thigh(cx - 5, by - 6, 4.6, 4.2, -30, dark=True)
    kaeru.foot(cx - 8, by, -1, dark=True)
    # 体
    body = ell(cx, by - 12, 8.5, 9.5)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 11, 5.5, 7.5, body)
    # 手前の足（もも と 水かき）
    kaeru.thigh(cx + 4, by - 5, 5, 4.2, 25)
    kaeru.foot(cx + 6, by, 1)
    # 頭 → 顔
    head = kaeru.head(hx, hy)
    kaeru.face(hx, hy, eyes='open', mouth='open')
    # マイク（口の前）と、それを持つ 手前の手
    mk = maiku.draw(hx + 13.5, hy + 3, by, -1)
    gx, gy = mk["grip"]
    kaeru.limb(cx + 4, by - 15, gx - 1, gy + 1, 3.8)
    kaeru.hand(gx, gy + .5, -1)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    kaeru.song_notes([(cx - s * 5 - sh, by - 46), (cx + s * 13 - sh, by - 43)])
    return head, body
