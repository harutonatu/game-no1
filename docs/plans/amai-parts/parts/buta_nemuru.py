# 動物 × ふるまい：ぶたが ねむる（すわって もうふを かけ、まくらを だいて こくり。大きな顔に とじた目。Zzz）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import buta

SHADOW = (1, 16, 1.6)


def zzz(x, y, n, c):
    """Z の字（大きさ n）。x, y は左上。"""
    fill(rect(x, y, x + n - 1, y) | rect(x, y + n - 1, x + n - 1, y + n - 1) |
         {(x + n - 1 - i, y + i) for i in range(n)}, c)


def draw(cx, by, flip=False):
    begin()
    buta.tail(cx - 10, by - 7)
    body = ell(cx, by - 10, 10.5, 9.5)
    buta.blob(body)
    # 頭（大きく。少し 前へ かたむく）→ ねむる顔
    hx, hy = cx + 1, by - 24
    head = buta.head_big(hx, hy)
    buta.face_sleep(hx, hy)
    # もうふ（B に Y の 星。上の はしは S の へり。ひざの上から 足もとまで。ふち K）
    bl = poly([(cx - 14, by - 7), (cx - 2, by - 11), (cx + 12, by - 9), (cx + 16, by), (cx - 15, by)])
    fill(bl, 'B')
    fill(cells(bl, lambda x, y: (x * 3 + y * 5) % 11 == 0), 'Y')
    fill(cells(bl, lambda x, y: (x, y - 1) not in bl or (x, y - 2) not in bl), 'S')
    fill(edge(bl), 'K')
    # もうふを にぎる 手（2 つ）
    for (x, y, d) in ((cx - 6, by - 10, True), (cx + 4, by - 11, False)):
        h = ell(x + .5, y + .5, 2.3, 2.3); buta.blob(h, dark=d)
    # 足の先（もうふから 出る。ひづめ C）
    f = ell(cx + 16.5, by - 2, 2.4, 2.2); buta.blob(f, hi=False); fill(rect(cx + 18, by - 3, cx + 18, by - 2), 'C')
    end(flip, cx)
    s = -1 if flip else 1
    X = lambda dx, n: (cx + s * dx - (n - 1 if flip else 0))
    under = at(X(18, 1), by - 40)
    c = 'B' if under not in ('B',) else 'W'
    zzz(X(12, 4), by - 33, 4, c)
    zzz(X(16, 5), by - 39, 5, c)
    zzz(X(21, 6), by - 46, 6, c)
    return head, body
