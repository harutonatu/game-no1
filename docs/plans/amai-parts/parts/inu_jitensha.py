# 動物 × ふるまい：いぬが じてんしゃに のる（サドルにすわり、前かがみで ハンドルをにぎり、ひざを まげて ペダルを こぐ。
# たれ耳が うしろへ なびき、うしろに はやさの線）。draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import inu, jitensha

SHADOW = (0, 21, 1.4)


def draw(cx, by, flip=False):
    begin()
    for (y, x0, n) in ((by - 31, cx - 27, 6), (by - 26, cx - 30, 8), (by - 21, cx - 28, 5)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（ひざで まげて うしろの ペダルへ）
    l = line(sx + 2, sy - 3, sx + 5, sy + 1, 4.6) | line(sx + 5, sy + 1, pbx, pby - 2, 4.4); inu.blob(l)
    fill(ell(pbx, pby - 1.2, 2, 1.3), 'W'); fill(edge(ell(pbx, pby - 1.2, 2, 1.3)), 'K')
    # しっぽ → 体（前かがみ）
    inu.tail(sx - 6, sy - 10, -40)
    body = inu.body(sx + 3, sy - 6.5, 8.5, 8, -15)
    # 頭 → たれ耳（うしろへ なびく）→ 首輪
    hx, hy = sx + 7, sy - 16
    head = inu.head(hx, hy, look=1, eyes='open', mouth='open')
    inu.ear(hx - 9, hy + 0.5, 50, 3.0, 6.2)
    inu.collar(hx - 2, hy + 8.5, 6.5, head)
    # 手前の足（ももを 前へ、ひざで まげて 前の ペダルを ふむ）
    l = line(sx + 4, sy - 3, pfx + 1, sy - 3, 5) | line(pfx + 1, sy - 3, pfx, pfy - 2, 4.8); inu.blob(l)
    # 手前の手（ハンドルを にぎる）
    inu.limb(sx + 5, sy - 8, gx - 1, gy + .5, 4.2)
    end(flip, cx)
    return head, body
