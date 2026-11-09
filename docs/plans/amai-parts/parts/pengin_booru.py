# 動物 × ふるまい：ぺんぎんが ボールで あそぶ（立って 上を見て、両手を 上げて ボールを ぽんと 打ち上げる。
#   ボールの通り道に 点線、まわりに きらり）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin

SHADOW = (2, 13, 1.6)


def ball(cx, cy, r=6.4):
    """ボール（R と Y の 2 いろ。まん中を W の おびが まわる。ふち K・光 W）。"""
    m = ell(cx, cy, r, r)
    for (x, y) in m:
        dx, dy = x + .5 - cx, y + .5 - cy
        band = abs(dy + .12 * dx - .02 * dx * dx) < 1.3
        put(x, y, 'W' if band else ('R' if dy + .12 * dx < 0 else 'Y'))
    fill(cells(m, lambda x, y: ((x - 1, y) not in m or (x, y + 1) not in m) and at(x, y) == 'Y'), 'O')   # かげ（左下）
    fill(edge(m), 'K')
    fill({(int(cx + 2), int(cy - 4)), (int(cx + 3), int(cy - 4)), (int(cx + 3), int(cy - 3))} & m, 'W')
    return m


def draw(cx, by, flip=False):
    begin()
    # 奥の手（上へ）
    pengin.flipper(cx - 6, by - 18, cx - 13, by - 27, 4.4)
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='front', mouth='open')
    # 手前の手（前の上へ。ボールを 打ち上げた ところ）
    pengin.flipper(cx + 8, by - 12, cx + 17, by - 18, 4.6)
    pengin.foot(cx - 4, by - 1.5); pengin.foot(cx + 6, by - 1.2)
    # ボール（手の先の 上）
    bx, by_ = cx + 19, by - 35
    ball(bx, by_)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    # ボールの通り道（手から ボールへ の 点線）と きらり
    for k, (dx, dy) in enumerate(((19, -22), (19, -24), (19, -26))):
        put(cx + s * dx - sh, by + dy, 'W')
    sparkle(cx + s * 26 - sh, by - 41, 'Y')
    sparkle(cx + s * 11 - sh, by - 42, 'W')
    return head, body
