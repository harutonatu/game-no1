# 動物 × ふるまい：ぺんぎんが うたう（立って、くちばしを大きく あけ、手前の手で スタンドのマイクを にぎる。奥の手は 上へ ふる。音符がとぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin, maiku

SHADOW = (4, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    # 奥の手（上へ ふりあげる）
    pengin.flipper(cx - 7, by - 18, cx - 15, by - 25, 4.6)
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='happy', mouth='open')
    # マイク（くちばしの前）と、それを にぎる 手前の手
    mk = maiku.draw(hx + 15, hy + 3, by, -1)
    gx, gy = mk["grip"]
    pengin.flipper(cx + 7, by - 16, gx, gy + 1, 4.8)
    pengin.foot(cx - 4, by - 1.5); pengin.foot(cx + 6, by - 1.2)
    end(flip, cx)
    # 音符（頭の上と、うしろ〔ぎゃくの時は 前の上。場所の物に かからないように〕）
    if flip:
        note(cx - 7, by - 45, 'B'); note(cx - 20, by - 42, 'V')
    else:
        note(cx + 2, by - 45, 'B'); note(cx - 24, by - 41, 'V')
    return head, body
