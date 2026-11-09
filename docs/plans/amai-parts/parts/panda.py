# 動物：ぱんだ（しろい体 W・かげ S・くろい耳と目のまわりと うで・あし・かたの帯 K〔光は B の市松〕・ピンクのほっぺ）。右むきで描く。
# 見た目は 今の 150 枚（amai-more2/pandakouenodoru.py の animal・dancer）と そろえる。
from lib import *


def blob(m, dark=False):
    if dark:
        shape(m, 'K', o='K')
        fill(cells(m, lambda x, y: (x - 1, y) in m and (x, y + 1) in m and (x + 1, y) in m and (x, y - 1) in m
                   and ((x + 2, y) not in m or (x, y - 2) not in m) and (x + y) % 2 == 0), 'B')
        return
    shape(m, 'W', sh='S', sw=2)


def ears(hx, hy):
    for ex in (hx - 7.5, hx + 7.5):
        e = ell(ex, hy - 6.5, 3.6, 3.6); blob(e, True)


def tail(cx, cy):
    t = ell(cx, cy, 2.4, 2.2); blob(t, True)
    return t


def body(cx, cy, rx, ry, ang=0):
    """胴体（かたの くろい帯）。"""
    b = ell(cx, cy, rx, ry, ang)
    blob(b)
    fill(ell(cx, cy - ry * .7, rx * 1.05, 3.0, ang) & b, 'K')
    fill(edge(b), 'K')
    return b


def eyes_at(hx, hy, look=1):
    return hx - 4 + look, hx + 5 + look, hy - 1


def eye(ex, ey, i, kind='open'):
    p = ell(ex + .5, ey + 1.5, 2.6, 3.3, 25 if i == 0 else -25); fill(p, 'K')
    if kind == 'open':
        fill({(ex, ey), (ex + 1, ey)}, 'W'); put(ex, ey + 1, 'W')
    elif kind == 'down':
        fill({(ex, ey + 2), (ex + 1, ey + 2)}, 'W'); put(ex, ey + 1, 'W')
    else:
        fill({(ex - 1, ey + 1), (ex, ey), (ex + 1, ey), (ex + 2, ey + 1)}, 'W')


def head(hx, hy, look=1, eyes='open', mouth='smile', rx=10, ry=8.2):
    h = ell(hx, hy, rx, ry)
    blob(h)
    fill(edge(h), 'K')
    ex1, ex2, ey = eyes_at(hx, hy, look)
    eye(ex1, ey, 0, eyes); eye(ex2, ey, 1, eyes)
    nx, ny = hx + 2 * look, hy + 2
    fill(rect(nx, ny, nx + 1, ny + 1), 'K')
    if mouth == 'smile':
        fill({(nx - 2, ny + 2), (nx - 1, ny + 3), (nx, ny + 2), (nx + 1, ny + 2), (nx + 2, ny + 3), (nx + 3, ny + 2)}, 'K')
    elif mouth == 'open':
        fill(rect(nx - 1, ny + 2, nx + 2, ny + 4), 'K'); fill(rect(nx, ny + 3, nx + 1, ny + 4), 'R')
    fill({(ex1 - 3, hy + 3), (ex1 - 2, hy + 3), (ex2 + 3, hy + 3), (ex2 + 4, hy + 3)}, 'P')
    return h


def limb(x0, y0, x1, y1, w=4.6, dark=True, rim=False):
    """くろい うで・あし。rim なら 上のふちの内側に B の線（くろい物どうしが重なっても 形が分かるように）。"""
    a = line(x0, y0, x1, y1, w) | ell(x1 + .5, y1 + .5, w * .52, w * .52)
    blob(a, dark)
    if rim:
        fill(cells(a, lambda x, y: (x, y - 1) in a and (x, y - 2) not in a and (x - 1, y) in a and (x + 1, y) in a), 'B')
    return a
