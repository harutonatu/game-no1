# 動物 × ふるまい：かえるが ボールで あそぶ（奥の足で 立ち、手前の足で 大きな ビーチボールを ぽんと ける。
#   足の先が ボールに ふれている。両手を 広げて バランス。ボールの 前に 動きの線）。顔は 大きな頭（kaeru.head_big・face_big）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import lib, kaeru

SHADOW = (5, 15, 1.6)


def ball(cx, cy, r=7.2):
    """ビーチボール（まん中から 4 色の おび R・Y・B・O。かげ（左下）・光 W・ふち K）。"""
    m = ell(cx, cy, r, r)
    for (x, y) in m:
        a = math.degrees(math.atan2(y + .5 - cy, (x + .5 - cx) * 1.6)) % 180
        put(x, y, 'RYBO'[int(a // 45)])
    fill(ell(cx, cy, 1.3, 1.3) & m, 'W')
    sh = cells(m, lambda x, y: (x - 1, y) not in m or (x, y + 1) not in m)
    for (x, y) in sh:
        put(x, y, {'R': 'C', 'O': 'C', 'B': 'V', 'Y': 'O'}.get(at(x, y), at(x, y)))
    fill(edge(m), 'K')
    fill({(int(cx + 2), int(cy - 4)), (int(cx + 3), int(cy - 4)), (int(cx + 3), int(cy - 3))} & m, 'W')
    return m


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx, by - 26
    # 奥の手（うしろの 上へ 広げる）
    kaeru.limb(cx - 5, by - 18, cx - 13, by - 21, 3.8, dark=True)
    kaeru.hand(cx - 14, by - 22, -1, dark=True)
    # 立っている 奥の足
    kaeru.limb(cx - 3, by - 8, cx - 4, by - 2, 4.6, dark=True)
    kaeru.foot(cx - 6, by, -1, dark=True, l=4.6)
    # 体（すこし うしろへ かたむく）
    body = ell(cx, by - 13, 9, 9.5, -10)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 12, 6, 7.5, body)
    # ボール（足もとの 前）→ けった 手前の足（ももを 前へ、足の先が ボールに ふれる）
    bx, bcy = cx + 19, by - 12
    ball(bx, bcy)
    kaeru.limb(cx + 4, by - 8, cx + 10, by - 6, 4.8)
    kaeru.foot(cx + 12, by - 4.5, 1, l=3.4)
    # 頭 → 顔（にっこり あけた口）
    head = kaeru.head_big(hx, hy)
    kaeru.face_big(hx, hy, eyes='open', mouth='grin')
    # 手前の手（前の 上へ）
    kaeru.limb(cx + 6, by - 16, cx + 13, by - 21, 3.8)
    kaeru.hand(cx + 14, by - 22, 1)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh

    def free(pts):
        """背景の地（空・かべ・地面・その模様）だけの所か。"""
        for dx, dy in pts:
            x, y = X(dx), by + dy
            if not (0 <= x < 64 and 0 <= y < 48) or lib.base[y][x] is None:
                return False
            if at(x, y) != lib.base[y][x] and (x, y) not in lib.decos:
                return False
        return True

    def mark(pts):
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'B') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # ボールの ななめ上の 動きの線（ぽんと とんで いく）
    for l in (((25, -21), (26, -22), (27, -23)), ((28, -18), (29, -19), (30, -20)), ((29, -14), (30, -14), (31, -14))):
        if free(l):
            mark(l)
    return head, body
