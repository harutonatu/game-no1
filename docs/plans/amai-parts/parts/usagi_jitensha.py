# 動物 × ふるまい：うさぎが じてんしゃに のる（サドルにすわり、ハンドルを にぎり、ひざで まげて ペダルを こぐ。
# 長い耳が うしろへ なびき、うしろに はやさの線。にっこり 口を あける）。draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import usagi, jitensha

SHADOW = (0, 21, 1.4)


def ears_back(hx, hy):
    """長い耳を うしろ（左上）へ なびかせる（usagi.ears の 向きを ねかせた形）。中は P。"""
    for (ex, ey, ang) in ((hx - 8, hy - 9.5, -60), (hx - 12, hy - 6.5, -72)):
        e = ell(ex, ey, 2.6, 7.2, ang); usagi.blob(e)
        fill(ell(ex, ey, 1.0, 5.0, ang) - edge(e), 'P')


def draw(cx, by, flip=False):
    begin()
    # はやさの線（うしろ）
    for (y, x0, n) in ((by - 22, cx - 30, 7), (by - 17, cx - 31, 5), (by - 12, cx - 29, 6)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（ひざで まげて うしろの ペダルへ）
    usagi.limb(sx + 2, sy - 3, sx + 5, sy + 1, 4.6); usagi.limb(sx + 5, sy + 1, pbx, pby - 2, 4.4)
    usagi.tail(sx - 6, sy - 4)
    body = usagi.body(sx + 2, sy - 7.5, 8, 8.5, -10)
    hx, hy = sx + 6, sy - 18
    # 長い耳（うしろへ なびく）
    ears_back(hx, hy)
    head = usagi.head(hx, hy, look=1, eyes='happy', mouth='open')
    # 手前の足（ももを 前へ、ひざで まげて 前の ペダルを ふむ）
    usagi.limb(sx + 4, sy - 2, pfx + 1, sy - 2, 5); usagi.limb(pfx + 1, sy - 2, pfx, pfy - 2, 4.8)
    # 手前の手（ハンドルを にぎる）
    usagi.limb(sx + 5, sy - 8, gx - .5, gy + .5, 4.2)
    end(flip, cx)
    return head, body
