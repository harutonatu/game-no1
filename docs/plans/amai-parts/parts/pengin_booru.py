# 動物 × ふるまい：ぺんぎんが ボールで あそぶ（立って、手前の つばさの先に ボールを のせて ぽんと 打ち上げる。
#   当たった しるし と、上へ とぶ 動きの線、きらり）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import lib, pengin

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
    # 奥の手（上へ。うれしくて ばんざい）
    pengin.flipper(cx - 6, by - 18, cx - 13, by - 27, 4.4)
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='front', mouth='open')
    pengin.foot(cx - 4, by - 1.5); pengin.foot(cx + 6, by - 1.2)
    # ボール（手前の手の先に のって いる。つばさで ぽんと 打つ ところ）
    bx, by_ = cx + 20, by - 29
    ball(bx, by_)
    # 手前の手（前の上へ。先が ボールの 下に ふれる）
    pengin.flipper(cx + 8, by - 12, cx + 16, by - 21, 4.6)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh
    def free(pts):
        """背景の地（空・かべ・その模様）だけの所か（場所の物や 主役の上に 線を 描かない）。"""
        for dx, dy in pts:
            x, y = X(dx), by + dy
            if not (0 <= x < 64 and 0 <= y < 48) or lib.base[y][x] is None:
                return False
            if at(x, y) != lib.base[y][x] and (x, y) not in lib.decos:
                return False
        return True

    def mark(pts):
        """動きの線・当たった しるし（下の色と ちがう色）。"""
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'B') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # 当たった しるし（つばさの先から 左右下へ 短い線。ぽん）
    for l in (((11, -22), (10, -21)), ((24, -21), (25, -20), (26, -19))):
        if free(l):
            mark(l)
    # 動きの線（上へ とぶ。ボールの 外がわ か ななめ上の、背景の 地の 所に 2 本）
    for lines in ((((28, -24), (28, -25), (28, -26), (28, -27)), ((30, -22), (30, -23), (30, -24))),
                  (((14, -36), (13, -37), (12, -38)), ((26, -36), (27, -37), (28, -38)))):
        if all(free(l) for l in lines):
            for l in lines:
                mark(l)
            break
    sparkle(X(26), by - 41, 'Y')
    return head, body
