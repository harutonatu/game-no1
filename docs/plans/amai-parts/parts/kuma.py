# 動物：くま（ちゃいろ C・光 O・まるい耳の中 P・おなか O と光 Y・しろい口もと W とかげ S・くろい鼻・足のうら O）。右むきで描く。
# 見た目は 今の 150 枚（amai-more2/kumakouenodoru.py の animal・dancer）と そろえる。
from lib import *


def blob(m, dark=False):
    shape(m, 'C', sw=2)
    fill(cells(m, lambda x, y: (x, y - 2) not in m and (x, y - 1) in m and (x - 2, y) in m and (x + 2, y) in m), 'O')


def ears(hx, hy):
    for ex in (hx - 7.5, hx + 7.5):
        e = ell(ex, hy - 6.5, 3.6, 3.6); blob(e)
        fill(ell(ex, hy - 6.2, 1.8, 1.8), 'P')


def tail(cx, cy):
    t = ell(cx, cy, 2.4, 2.2); blob(t)
    return t


def body(cx, cy, rx, ry, ang=0):
    """胴体（まるい おなか O と光 Y）。"""
    b = ell(cx, cy, rx, ry, ang)
    blob(b)
    bl = ell(cx + 1, cy + 1.5, rx * .65, ry * .63) & b
    fill(bl, 'O'); fill(cells(bl, lambda x, y: (x + 1, y - 1) not in bl), 'Y')
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
    mz = ell(hx + 1.5 * look, hy + 3.5, 4.6, 3.2)
    fill(mz, 'W'); fill(cells(mz, lambda x, y: (x, y + 1) not in mz), 'S'); fill(edge(mz), 'K')
    ex1, ex2, ey = eyes_at(hx, hy, look)
    eye(ex1, ey, eyes); eye(ex2, ey, eyes)
    nx, ny = hx + 2 * look, hy + 2
    fill(rect(nx, ny, nx + 1, ny + 1), 'K')
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


def foot(cx, cy, rx=4.4, ry=2.3):
    f = ell(cx, cy, rx, ry); blob(f)
    fill(ell(cx + .5, cy, rx * .45, ry * .45), 'O')
    return f
