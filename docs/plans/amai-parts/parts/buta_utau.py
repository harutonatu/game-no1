# 動物 × ふるまい：ぶたが うたう（立って、スタンドのマイクを にぎり、口を 大きく あける。奥の手は 上へ。音符が とぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import buta, maiku

SHADOW = (3, 13, 1.6)


def draw(cx, by, flip=False):
    begin()
    # 奥の手（上へ ふりあげる）・奥の足・しっぽ
    buta.arm(cx - 5, by - 17, cx - 12, by - 25, 4, dark=True)
    buta.leg(cx - 4, by - 8, by, 4, dark=True)
    buta.tail(cx - 9, by - 10)
    body = ell(cx, by - 12, 9, 9.5)
    buta.blob(body)
    buta.leg(cx + 4, by - 6, by, 4)
    # 頭（少し 上を むく）
    hx, hy = cx + 1, by - 26
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face2(hx, hy, eyes='happy', mouth='sing')
    # マイク（はなの 前）と、それを にぎる 手前の手
    mk = maiku.draw(hx + 14, hy + 7, by, -1)
    gx, gy = mk["grip"]
    buta.arm(cx + 5, by - 14, gx - 1, gy, 4.2)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    note(cx - s * 6 - sh, by - 46, 'B')
    note(cx + s * 9 - sh, by - 45, 'R')
    return head, body
