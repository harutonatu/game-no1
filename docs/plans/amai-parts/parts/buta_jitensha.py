# 動物 × ふるまい：ぶたが じてんしゃに のる（サドルにすわり、前かがみで ハンドルをにぎり、ペダルをこぐ。うしろに はやさの線）。
# draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import buta, jitensha

SHADOW = (0, 21, 1.4)


def draw(cx, by, flip=False):
    begin()
    # はやさの線（うしろ）
    for (y, x0, n) in ((by - 30, cx - 26, 6), (by - 25, cx - 29, 8), (by - 20, cx - 27, 5)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; kx, ky = bike["crank"]; gx, gy = bike["grip"]
    # 奥の足（うしろのペダルへ）
    l = line(sx + 3, sy - 2, kx - 3, ky + 1, 4.2); buta.blob(l, dark=True, hi=False)
    buta.blob(ell(kx - 3.5, ky + 1.5, 2.4, 1.6), dark=True)
    # しっぽ → 体（前かがみ）
    buta.tail(sx - 5, sy - 6)
    body = ell(sx + 2, sy - 6, 7.5, 7.5, -15)
    buta.blob(body)
    # 頭（奥の耳 → 頭 → 手前の耳 → 顔）
    hx, hy = sx + 8, sy - 15
    buta.ear(hx + 4, hy - 8, 3, 4.6, 40)
    head = buta.head(hx, hy)
    buta.ear(hx - 2.5, hy - 8.5, 3.4, 5, 35)
    buta.face(hx, hy, eyes='open', mouth='smile')
    # 手前の足（ひざを まげて ペダルを ふむ）
    l = line(sx + 2, sy - 2, kx + 5, ky - 7, 4.6) | line(kx + 5, ky - 7, kx + 3, ky - 1, 4.2); buta.blob(l, hi=False)
    buta.blob(ell(kx + 3.5, ky - .5, 2.6, 1.7))
    # 手前の手（ハンドルを にぎる）
    a = line(sx + 5, sy - 8, gx - 1, gy + 1, 4.2); buta.blob(a, hi=False)
    buta.blob(ell(gx - .5, gy + .5, 2.3, 2.3))
    end(flip, cx)
    return head, body
