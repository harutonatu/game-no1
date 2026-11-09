# 動物 × ふるまい：ぺんぎんが じてんしゃに のる（サドルに すわり、前を見て、平たい手で ハンドルを にぎる。
#   みじかい足を ひざで まげて、オレンジの足で ペダルを ふむ。うしろに はやさの線）。
# draw(cx, by, flip) … cx＝じてんしゃの まん中、by＝車輪の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin, jitensha

SHADOW = (0, 21, 1.4)


def leg(x0, y0, x1, y1, dark=False):
    """みじかい足（K・太さ 4）と、ペダルを ふむ オレンジの足。"""
    m = line(x0, y0, x1, y1 - 1.5, 4)
    fill(m, 'K')
    if not dark:
        fill(cells(edge(m), lambda x, y: (x + 1, y) not in m), 'B')
    f = ell(x1 + 1, y1 - .6, 2.8, 1.4)
    shape(f, 'O' if not dark else 'C', sh='C' if not dark else None, sw=1)
    return m | f


def draw(cx, by, flip=False):
    begin()
    # はやさの線（うしろ）
    for (y, x0, n) in ((by - 29, cx - 20, 4), (by - 25, cx - 22, 6), (by - 21, cx - 21, 4)):
        fill(rect(x0, y, x0 + n - 1, y), 'W')
    bike = jitensha.draw(cx, by)
    sx, sy = bike["seat"]; gx, gy = bike["grip"]
    pfx, pfy = bike["pedal_f"]; pbx, pby = bike["pedal_b"]
    # 奥の足（うしろの ペダルへ）
    leg(sx + 3, sy - 2, pbx, pby, dark=True)
    # 奥の手（ハンドルの 奥を にぎる）
    pengin.flipper(sx + 6, sy - 11, gx - 2, gy - 1, 4)
    # 体と頭（すわった形。体は少し前へ かたむく）
    body = ell(sx + 3, sy - 6, 8.5, 9, -10)
    head = ell(sx + 7, sy - 19, 9.5, 8)
    m = body | head
    pengin.blob(m)
    belly = ell(sx + 6, sy - 6, 6, 8.5, -10) & m
    shape(belly - edge(m), 'W', o=None, sh='S', sw=1)
    hx, hy = sx + 7, sy - 19
    pengin.face(hx, hy, head, look='front')
    # 手前の足（ひざで まげて 前の ペダルを ふむ）
    leg(sx + 5, sy - 2, pfx, pfy)
    # 手前の手（ハンドルを にぎる）
    pengin.flipper(sx + 7, sy - 10, gx, gy + 1, 4.6)
    end(flip, cx)
    return head, body
