# 動物 × ふるまい：ぞうが じてんしゃに のる（サドルにすわり、ハンドルをにぎり、ひざで まげて ペダルを ふむ。
# 鼻を 前へ 高く上げ、耳は うしろへ なびく。うしろに はやさの線）。
# draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)。
from lib import *
import zou, jitensha

SHADOW = (0, 21, 1.4)


def foot(x, y):
    """足の先（ペダルの上）：しろい つめ 3 つ。"""
    for k in (-1, 0, 1):
        put(int(x + k), int(y), 'W')


def draw(cx, by, flip=False):
    begin()
    # はやさの線（うしろ）
    for (y, x0, n) in ((by - 31, cx - 27, 6), (by - 26, cx - 30, 8), (by - 21, cx - 28, 5)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（太く短く。ひざで まげて うしろの ペダルへ）
    l = line(sx + 2, sy - 3, sx + 6, sy + 1, 5) | line(sx + 6, sy + 1, pbx, pby - 2, 4.6); zou.blob(l, dark=True)
    foot(pbx, pby - 2)
    # しっぽ → 体（すこし 前かがみ）
    fill(line(sx - 6, sy - 5, sx - 10, sy - 2), 'K'); fill(ell(sx - 10.5, sy - 1.5, 1.2, 1.3), 'K')
    body = ell(sx + 2, sy - 7, 9.5, 8.5, -15)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 耳（うしろへ なびく）→ 頭 → 顔
    hx, hy = sx + 10, sy - 16
    zou.ear(hx - 10, hy + 1, 7.5, 8, -15)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='open', mouth='smile')
    # 手前の足（ももを 前へ、ひざで まげて 前の ペダルを ふむ）
    l = line(sx + 3, sy - 1, pfx + 1, sy - 1, 5) | line(pfx + 1, sy - 1, pfx, pfy - 2, 4.8); zou.blob(l)
    foot(pfx, pfy - 2)
    # 手前の手（ハンドルを にぎる）
    a = line(sx + 6, sy - 7, gx - 1, gy + .5, 4.2); zou.blob(a)
    zou.blob(ell(gx - .5, gy + .5, 2.4, 2.4))
    # 鼻（口の上から 前へ、上へ 高く。たのしそうに）
    zou.trunk([(hx + 6, hy + 3), (hx + 10, hy + 2), (hx + 12, hy - 2), (hx + 12, hy - 6), (hx + 10, hy - 8)], 5, 3)
    end(flip, cx)
    return head, body
