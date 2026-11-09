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
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（短く太い。ひざで まげて うしろの ペダルへ。先は ひづめ C）
    l = line(sx + 2, sy - 3, sx + 5, sy + 1, 5) | line(sx + 5, sy + 1, pbx, pby - 2, 5); buta.blob(l, dark=True, hi=False)
    fill(rect(pbx - 1, pby - 1, pbx + 1, pby - 1), 'C')
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
    # 手前の足（短く太い。ももを 前へ、ひざで まげて 前の ペダルを ふむ。先は ひづめ C）
    l = line(sx + 4, sy - 3, pfx + 1, sy - 3, 5.4) | line(pfx + 1, sy - 3, pfx, pfy - 2, 5.2); buta.blob(l, hi=False)
    fill(rect(pfx - 1, pfy - 1, pfx + 1, pfy - 1), 'C')
    # 手前の手（ハンドルを にぎる）
    a = line(sx + 5, sy - 8, gx - 1, gy + 1, 4.2); buta.blob(a, hi=False)
    buta.blob(ell(gx - .5, gy + .5, 2.3, 2.3))
    end(flip, cx)
    return head, body
