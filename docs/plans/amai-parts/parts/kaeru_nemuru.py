# 動物 × ふるまい：かえるが ねむる（すわって もうふを かけ、目を とじて こくり。Zzz）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kaeru

SHADOW = (1, 15, 1.6)


def zzz(x, y, n, c):
    """Z の字（大きさ n）。x, y は左上。"""
    fill(rect(x, y, x + n - 1, y) | rect(x, y + n - 1, x + n - 1, y + n - 1) |
         {(x + n - 1 - i, y + i) for i in range(n)}, c)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 22
    # 体（まるく すわる）
    body = ell(cx, by - 10, 9.5, 9)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 10, 6, 6.5, body)
    # 頭（すこし まえへ うつむく）→ 顔（目を とじる）
    head = kaeru.head(hx, hy)
    kaeru.face(hx, hy, eyes='closed', mouth='small')
    # もうふ（V に W の しま。ひざの上から 足もとまで。ふち K）
    bl = poly([(cx - 12, by - 10), (cx - 1, by - 13), (cx + 11, by - 11), (cx + 14, by), (cx - 13, by)])
    fill(bl, 'V')
    fill(cells(bl, lambda x, y: (x - cx + y) % 6 in (0, 1)), 'W')
    fill(cells(bl, lambda x, y: (x, y - 1) not in bl or (x, y - 2) not in bl), 'P')
    fill(edge(bl), 'K')
    # 鼻ちょうちん（W・ふち S）
    bub = ell(hx + 11.5, hy - .5, 2.6, 2.6)
    fill(bub, 'S'); fill(edge(bub), 'K'); put(int(hx + 12), int(hy - 1), 'W')
    # 足の先（もうふから 出る）
    kaeru.foot(cx + 13, by, 1, l=3.4)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 3 if flip else 0
    under = at(cx + s * 13, by - 34)
    c = 'B' if under not in ('B', 'S') else 'W'
    zzz(cx + s * 12 - sh, by - 33, 4, c)
    zzz(cx + s * 17 - sh, by - 40, 5, c)
    zzz(cx + s * 23 - sh, by - 46, 6, c)
    return head, body
