# 動物 × ふるまい：ぱんだが じてんしゃに のる（サドルにすわり、せすじを のばして ハンドルを にぎり、くろい足を ひざで まげて
# ペダルを こぐ。にっこり 口を あける。はやさの線は 描かない〔まちの ビルや家に まぎれるので〕）。draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import panda, jitensha

SHADOW = (0, 21, 1.4)


def draw(cx, by, flip=False):
    begin()
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（くろ。ひざで まげて うしろの ペダルへ）
    panda.limb(sx + 2, sy - 3, sx + 5, sy + 1, 4.6); panda.limb(sx + 5, sy + 1, pbx, pby - 2, 4.4)
    panda.tail(sx - 6, sy - 5)
    body = panda.body(sx + 2, sy - 8, 8.5, 9, -8)
    hx, hy = sx + 5, sy - 18
    panda.ears(hx, hy)
    head = panda.head(hx, hy, look=1, eyes='open', mouth='open')
    # 手前の足（ももを 前へ、ひざで まげて 前の ペダルを ふむ）
    panda.limb(sx + 4, sy - 2, pfx + 1, sy - 2, 5, rim=True); panda.limb(pfx + 1, sy - 2, pfx, pfy - 2, 4.8)
    # 手前の手（ハンドルを にぎる）
    panda.limb(sx + 5, sy - 8, gx - .5, gy + .5, 4.2, rim=True)
    end(flip, cx)
    return head, body
