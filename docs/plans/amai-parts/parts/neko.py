# 動物：ねこ（O。光 Y・しまもよう C・しろい おなかと口もと W・三角の耳の中 P・ピンクの鼻・ひげ K）。右むきで描く。
# 見た目は 今の 150 枚（amai-more2/nekohanabatakeodoru.py の animal・dancer）と そろえる。
from lib import *


def blob(m, dark=False):
    """体の色でぬる（ふちどり K）。光 Y は上のはし。"""
    shape(m, 'O', sw=2)
    fill(cells(m, lambda x, y: (x, y - 2) not in m and (x, y - 1) in m and (x - 2, y) in m and (x + 2, y) in m), 'Y')


def ears(hx, hy):
    """三角の耳（頭のうしろ）。中は P。"""
    for (ex, d) in ((hx - 6, -1), (hx + 6, 1)):
        e = poly([(ex - 4, hy - 4), (ex + d * 1.5, hy - 12), (ex + 4, hy - 4)]); blob(e)
        fill(poly([(ex - 1.8, hy - 5), (ex + d * 1.2, hy - 9.5), (ex + 1.8, hy - 5)]), 'P')


def tail(pts, w=3.8):
    """しっぽ（点をつなぐ太い線・しま C）。"""
    t = set()
    for i in range(len(pts) - 1):
        t |= line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w)
    blob(t)
    fill(cells(t, lambda x, y: y % 3 == 0) - edge(t), 'C')
    return t


def body(cx, cy, rx, ry, ang=0):
    """胴体（しろい おなか・せなかの しま）。返り値は胴体のマス。"""
    b = ell(cx, cy, rx, ry, ang)
    blob(b)
    bl = ell(cx + 2, cy + 1, rx * .55, ry * .66) & b
    fill(bl - edge(b), 'W')
    for k in range(3):
        fill(cells(b, lambda x, y: x < cx - 3 and abs(y - (cy - ry * .55 + k * 4) + (x - cx) * 0.3) < 0.8) - edge(b), 'C')
    fill(edge(b), 'K')
    return b


def eyes_at(hx, hy, look=1):
    return hx - 4 + look, hx + 5 + look, hy - 1


def eye(ex, ey, kind='open'):
    if kind == 'open':
        fill(ell(ex + .5, ey + 1, 1.3, 1.9), 'K'); put(ex, ey, 'W')
    elif kind == 'down':        # 下（本）を見る：黒目を下に
        fill({(ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey + 1)} | rect(ex, ey + 2, ex + 1, ey + 2), 'K')
    else:                       # happy：にっこり とじた目
        fill({(ex - 1, ey + 1), (ex, ey), (ex + 1, ey), (ex + 2, ey + 1)}, 'K')


def head(hx, hy, look=1, eyes='open', mouth='smile', rx=10.5, ry=8.6):
    """頭（ひたいの しま・しろい口もと・目・ピンクの鼻・口・ほっぺ・ひげ）。返り値は頭のマス。"""
    h = ell(hx, hy, rx, ry)
    blob(h)
    for k in (-2, 0, 2):
        fill(cells(h, lambda x, y: x == hx + look + k and hy - 8 < y < hy - 5 + (k == 0)), 'C')
    fill(ell(hx + 1.5 * look, hy + 3.5, 4.5, 2.8) & h - edge(h), 'W')
    fill(edge(h), 'K')
    ex1, ex2, ey = eyes_at(hx, hy, look)
    eye(ex1, ey, eyes); eye(ex2, ey, eyes)
    nx, ny = hx + 2 * look, hy + 2
    fill({(nx, ny), (nx + 1, ny)}, 'P')
    if mouth == 'smile':
        fill({(nx - 2, ny + 2), (nx - 1, ny + 3), (nx, ny + 2), (nx + 1, ny + 2), (nx + 2, ny + 3), (nx + 3, ny + 2)}, 'K')
    elif mouth == 'open':
        fill(rect(nx - 1, ny + 2, nx + 2, ny + 4), 'K'); fill(rect(nx, ny + 3, nx + 1, ny + 4), 'R')
    fill({(ex1 - 3, hy + 3), (ex1 - 2, hy + 3), (ex2 + 3, hy + 3), (ex2 + 4, hy + 3)}, 'P')
    for d in (-1, 1):
        fill(line(hx + 1.5 * look + d * 6, hy + 2, hx + 1.5 * look + d * 9, hy + 1), 'K')
    return h


def limb(x0, y0, x1, y1, w=4.6, dark=True):
    """うで・あし（太い線）と 先の まるい手。"""
    a = line(x0, y0, x1, y1, w) | ell(x1 + .5, y1 + .5, w * .52, w * .52)
    blob(a, dark)
    return a


def foot(cx, cy, rx=4.6, ry=2.8):
    f = ell(cx, cy, rx, ry); blob(f, True)
    return f
