# 動物 × ふるまい：ぞうが ボールで あそぶ（立って、手前の 足を 地面の 大きな ボールの 上に のせ、ころころ ころがす。
#   鼻は うれしそうに 上へ くるん、奥の手は ばんざい。ボールの まわりに 動きの線、きらり）。
# ボールは 地面と 足に ふれている（宙に うかない）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import lib, zou

SHADOW = (6, 17, 1.6)


def ball(cx, cy, r=7):
    """ボール（上 R・下 G の 2 いろ。まん中を W の おびが まわる。左下に かげ D、右上に 光 W、ふち K）。"""
    m = ell(cx, cy, r, r)
    for (x, y) in m:
        dx, dy = x + .5 - cx, y + .5 - cy
        v = dy + .25 * dx - .04 * dx * dx
        put(x, y, 'W' if abs(v) < 1.4 else ('R' if v < 0 else 'G'))
    fill(cells(m, lambda x, y: ((x - 1, y) not in m or (x, y + 1) not in m) and at(x, y) == 'G'), 'D')
    fill(edge(m), 'K')
    fill({(int(cx + 1), int(cy - 5)), (int(cx + 2), int(cy - 5)), (int(cx + 3), int(cy - 4))} & m, 'W')
    return m


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx, by - 28
    # しっぽ
    fill(line(cx - 8, by - 10, cx - 12, by - 6), 'K'); fill(ell(cx - 12.5, by - 5.5, 1.2, 1.4), 'K')
    # 奥の手（うしろへ ひろげて バランス）
    zou.blob(line(cx - 6, by - 17, cx - 14, by - 13, 4.4), dark=True)
    zou.blob(ell(cx - 14.5, by - 12.5, 2.5, 2.5), dark=True)
    # ボール（地面に のる。足の 前）
    bx, bcy, r = cx + 15, by - 7, 7
    ball(bx, bcy, r)
    # 立っている 奥の足
    zou.leg(cx - 4, by - 9, by)
    # 体
    body = ell(cx, by - 13, 9.5, 10)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 手前の足（ももを 前へ、足の うらで ボールの 上を ふむ）
    zou.blob(line(cx + 3, by - 9, cx + 11, by - 15, 7))
    ft = ell(cx + 13, by - 15.5, 3.6, 2.6)
    zou.blob(ft)
    fill({(cx + 11, by - 14), (cx + 13, by - 14), (cx + 15, by - 14)}, 'W')   # 足の うら（ボールに ふれる）
    # 耳 → 頭 → 顔
    zou.ear(hx - 11, hy + 1, 8.5, 9)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='open', mouth='open')
    # 手前の手（前へ 出して バランス）
    zou.blob(line(cx + 5, by - 18, cx + 11, by - 21, 4.2))
    zou.blob(ell(cx + 12, by - 21.5, 2.4, 2.4))
    # 鼻（口の上から 前へ、上へ くるん）
    zou.trunk([(hx + 5, hy + 2), (hx + 9, hy - 1), (hx + 11, hy - 6), (hx + 10, hy - 11), (hx + 7, hy - 12)], 5, 3)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh

    def mark(pts):
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'B') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # 動きの線（ボールの 前の 地面に ころころ・ボールの 上に まわる 弧）
    mark(((23, -9), (24, -9), (25, -9)))
    mark(((23, -5), (24, -5), (25, -5), (26, -5)))
    mark(((20, -16), (21, -15), (22, -14)))
    sparkle(X(24), by - 19, 'Y')
    return head, body
