# 動物：うさぎ（しろい体 W・かげ S・長い耳の中 P・ピンクの鼻・まるい しっぽ）。右むきで描く。
# 見た目は 今の 150 枚（amai-more2/usagikouenodoru.py の animal・dancer）と そろえる。
from lib import *


def blob(m, dark=False):
    shape(m, 'W', sh='S', sw=2)


def ears(hx, hy, angs=(-16, 18), ry=7.2):
    """長い耳（頭のうしろ）。中は P。"""
    for (ex, ang) in ((hx - 3, angs[0]), (hx + 4, angs[1])):
        e = ell(ex, hy - 12.5, 2.6, ry, ang); blob(e)
        fill(ell(ex + (-0.4 if ang < 0 else 0.4), hy - 12, 1.0, ry - 2.2, ang) - edge(e), 'P')


def tail(cx, cy):
    t = ell(cx, cy, 2.4, 2.2); blob(t)
    return t


def body(cx, cy, rx, ry, ang=0):
    b = ell(cx, cy, rx, ry, ang)
    blob(b)
    fill(edge(b), 'K')
    return b


def eyes_at(hx, hy, look=1):
    return hx - 4 + look, hx + 5 + look, hy - 1


def eye(ex, ey, kind='open'):
    if kind == 'open':
        fill(ell(ex + .5, ey + 1, 1.3, 1.9), 'K'); put(ex, ey, 'W')
    elif kind == 'down':
        fill({(ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey + 1)} | rect(ex, ey + 2, ex + 1, ey + 2), 'K')
    else:
        fill({(ex - 1, ey + 1), (ex, ey), (ex + 1, ey), (ex + 2, ey + 1)}, 'K')


def head(hx, hy, look=1, eyes='open', mouth='smile', rx=10, ry=8.2):
    h = ell(hx, hy, rx, ry)
    blob(h)
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
    return h


def limb(x0, y0, x1, y1, w=4.6, dark=True):
    a = line(x0, y0, x1, y1, w) | ell(x1 + .5, y1 + .5, w * .52, w * .52)
    blob(a, dark)
    return a


def foot(cx, cy, rx=4.2, ry=2.2):
    f = ell(cx, cy, rx, ry); blob(f)
    fill({(int(cx + rx) - 2, int(cy)), (int(cx + rx) - 3, int(cy))}, 'P')   # 足のうらの ピンク
    return f
