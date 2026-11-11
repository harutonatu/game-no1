# 動物 × ふるまい：ねこが うたう（立って、スタンドのマイクを 手前の手で にぎり、奥の手を 高く上げて ふる。
# 目を とじて 口を あける。しっぽは うしろで 低く くるん。音符がとぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import neko, maiku

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 27
    # しっぽ（うしろで 低く くるん。上げた手と まざらないように）
    neko.tail([(cx - 7, by - 5), (cx - 13, by - 5), (cx - 17, by - 8), (cx - 17, by - 13), (cx - 14, by - 15)])
    # 奥の手（高く上げて ふる）
    neko.limb(cx - 5, by - 18, cx - 11, by - 28, 4.4)
    # 足（短く 太い）
    neko.limb(cx - 3, by - 8, cx - 3, by - 3, 5)
    neko.limb(cx + 4, by - 8, cx + 4, by - 3, 5)
    body = neko.body(cx, by - 13, 9, 9.5)
    neko.foot(cx - 3.5, by - 2, 4.2, 2.4); neko.foot(cx + 5.5, by - 2, 4.2, 2.4)
    neko.ears(hx, hy)
    head = neko.head(hx, hy, look=1, eyes='happy', mouth='open')
    # マイク（口の前）と、それを持つ 手前の手
    mk = maiku.draw(hx + 10, hy + 6, by, -1)
    gx, gy = mk["grip"]
    neko.limb(cx + 4, by - 18, gx - .5, gy + .5, 4.4)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    note(cx - s * 14 - sh, by - 44, 'R')    # 音符は 頭の左右の 空（ビル・家に かさならない所。R・V）
    note(cx + s * 9 - sh, by - 46, 'V')
    return head, body
