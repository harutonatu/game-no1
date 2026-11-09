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
    hx, hy = cx + 1, by - 23
    # 体（まるく すわる）
    body = ell(cx, by - 11, 11, 10)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 11, 8, 6.5, body)
    # 頭（大きく。顔が よく 見えるように）→ 顔（目を とじて にっこり）
    head = kaeru.head_big(hx, hy)
    kaeru.face_sleep(hx, hy)
    # もうふ（V に W の しま。ひざの上から 足もとまで。ふち K）
    bl = poly([(cx - 13, by - 8), (cx - 1, by - 11), (cx + 12, by - 9), (cx + 15, by), (cx - 14, by)])
    fill(bl, 'V')
    fill(cells(bl, lambda x, y: (x - cx + y) % 6 in (0, 1)), 'W')
    fill(cells(bl, lambda x, y: (x, y - 1) not in bl or (x, y - 2) not in bl), 'P')
    fill(edge(bl), 'K')
    # もうふを にぎる 手
    kaeru.hand(cx - 5, by - 9, 1)
    # 足の先（もうふから 出る）
    kaeru.foot(cx + 14, by, 1, l=3.4)
    end(flip, cx)
    s = -1 if flip else 1
    X = lambda dx: cx + s * dx - (1 if flip else 0)
    # 鼻ちょうちん（鼻の あなの 前に ふくらむ。ふち K・光。地が しろなら 中を みずいろに）
    bx, bcy = 16.5, by - 27.5
    bub = {(X(dx), y) for (dx, y) in ell(bx, bcy, 3.4, 3.4)}
    inside = 'S' if sum(at(x, y) == 'W' for x, y in bub) * 2 > len(bub) else 'W'
    fill(bub, inside); fill(edge(bub), 'K')
    fill({(X(17), by - 30), (X(18), by - 30), (X(18), by - 29)}, 'W' if inside == 'S' else 'S')
    under = at(X(22), by - 40)
    c = 'B' if under != 'B' else 'W'
    zzz(X(15) - (3 if flip else 0), by - 36, 4, c)
    zzz(X(20) - (4 if flip else 0), by - 42, 5, c)
    zzz(X(26) - (5 if flip else 0), by - 46, 6, c)
    return head, body
