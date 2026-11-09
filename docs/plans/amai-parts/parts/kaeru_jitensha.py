# 動物 × ふるまい：かえるが じてんしゃに のる（サドルにすわり、前かがみで ハンドルをにぎり、ひざを まげて ペダルをこぐ。うしろに はやさの線）。
# draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import kaeru, jitensha

SHADOW = (0, 21, 1.4)


def draw(cx, by, flip=False):
    begin()
    for (y, x0, n) in ((by - 32, cx - 25, 6), (by - 27, cx - 29, 8), (by - 22, cx - 27, 5)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（もも → ひざで まげて うしろの ペダルへ）
    kaeru.limb(sx + 1, sy - 3, sx + 5, sy + 1, 4.4, dark=True)
    kaeru.limb(sx + 5, sy + 1, pbx, pby - 1.5, 3.8, dark=True)
    kaeru.foot(pbx + 1, pby + .5, 1, dark=True, l=3)
    # 奥の手（ハンドルの 奥）
    kaeru.limb(sx + 4, sy - 9, gx - 2, gy + 1, 3.6, dark=True)
    # 体（前かがみ）
    body = ell(sx + 2.5, sy - 7, 8.2, 8, -15)
    kaeru.blob(body, spots=True)
    kaeru.belly(sx + 5, sy - 6, 4, 5.5, body)
    # 頭 → 顔
    hx, hy = sx + 7, sy - 16
    head = kaeru.head(hx, hy)
    kaeru.face(hx, hy, eyes='open', mouth='smile')
    # 手前の足（ももを 前へ、ひざで まげて 前の ペダルを ふむ）
    kaeru.limb(sx + 3, sy - 3, pfx + 1, sy - 4, 4.8)
    kaeru.limb(pfx + 1, sy - 4, pfx, pfy - 1.5, 4)
    kaeru.foot(pfx + 1, pfy + .5, 1, l=3)
    # 手前の手（ハンドルを にぎる）
    kaeru.limb(sx + 6, sy - 9, gx - 1, gy + 1, 3.8)
    kaeru.hand(gx - .5, gy + .5, 1)
    end(flip, cx)
    return head, body
