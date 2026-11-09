# 動物 × ふるまい：くまが うたう（立って、スタンドのマイクを 手前の手で にぎり、奥の手を 横へ 大きく ひろげる。
# 上を向いて 口を あける。音符がとぶ）。draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kuma, maiku

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 29
    kuma.ears(hx, hy)
    kuma.tail(cx - 9.5, by - 9)
    # 奥の手（横へ ひろげる）
    kuma.limb(cx - 6, by - 21, cx - 16, by - 20, 4.8)
    # 足（短く 太い）
    kuma.limb(cx - 4, by - 9, cx - 4, by - 3, 5.4)
    kuma.limb(cx + 4, by - 9, cx + 4, by - 3, 5.4)
    body = kuma.body(cx, by - 14, 9.5, 10)
    kuma.foot(cx - 4.5, by - 1.8); kuma.foot(cx + 5.5, by - 1.8)
    head = kuma.head(hx, hy, look=1, eyes='open', mouth='open')
    mk = maiku.draw(hx + 10, hy + 7, by, -1)
    gx, gy = mk["grip"]
    kuma.limb(cx + 5, by - 20, gx - .5, gy + .5, 4.6)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    note(cx - s * 11 - sh, by - 46, 'B')
    note(cx + s * 25 - sh, by - 31, 'R')
    return head, body
