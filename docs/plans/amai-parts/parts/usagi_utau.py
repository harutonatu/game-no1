# 動物 × ふるまい：うさぎが うたう（立って、スタンドのマイクを 手前の手で にぎり、奥の手を 高く上げる。目を とじて 口を あける。音符がとぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import usagi, maiku

SHADOW = (3, 13, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 25
    usagi.ears(hx, hy, (-20, 12))
    usagi.tail(cx - 8.5, by - 9)
    # 奥の手（高く上げて ひらく）
    usagi.limb(cx - 4, by - 19, cx - 12, by - 27, 4.4)
    # 足（短く 太い）
    usagi.limb(cx - 3, by - 8, cx - 3, by - 3, 5)
    usagi.limb(cx + 4, by - 8, cx + 4, by - 3, 5)
    body = usagi.body(cx, by - 13, 8.5, 9.5)
    usagi.foot(cx - 3.5, by - 1.8); usagi.foot(cx + 5.5, by - 1.8)
    head = usagi.head(hx, hy, look=1, eyes='happy', mouth='open')
    # マイク（口の前）と、それを持つ 手前の手
    mk = maiku.draw(hx + 9.5, hy + 6, by, -1)
    gx, gy = mk["grip"]
    usagi.limb(cx + 4, by - 18, gx - .5, gy + .5, 4.4)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    note(cx - s * 15 - sh, by - 45, 'R')    # 音符は 空が S でも B でも 見える色（R・Y）
    note(cx + s * 14 - sh, by - 43, 'Y')
    return head, body
