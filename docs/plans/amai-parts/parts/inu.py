# 動物：いぬ（しろい体 W・かげ S・ちゃいろの ぶち C・たれ耳 C と O・あかい首輪 R と 金の札 Y・くろい鼻）。右むきで描く。
# 見た目は 今の 150 枚（amai-more2/inukouenodoru.py の animal・dancer）と そろえる。
from lib import *


def blob(m, dark=False):
    shape(m, 'W', sh='S', sw=2)


def tail(cx, cy, ang=-35):
    """ちゃいろの しっぽ（上へ ぴん）。"""
    t = ell(cx, cy, 2.2, 4.5, ang); shape(t, 'C')
    return t


def body(cx, cy, rx, ry, ang=0):
    """胴体（せなかに ちゃいろの ぶち）。"""
    b = ell(cx, cy, rx, ry, ang)
    blob(b)
    fill(ell(cx - rx * .45, cy - ry * .3, rx * .5, ry * .4) & b - edge(b), 'C')
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


def head(hx, hy, look=1, eyes='open', mouth='smile', rx=10, ry=8.4):
    """頭（目の ぶち C・目・くろい鼻・口・ほっぺ）。たれ耳は ear() で あとから重ねる。返り値は頭のマス。"""
    h = ell(hx, hy, rx, ry)
    blob(h)
    fill(edge(h), 'K')
    fill(ell(hx + 5 * look, hy - 2, 3, 2.6) & h - edge(h), 'C')
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


def ear(ex, ey, ang=18, rx=3.2, ry=6.5):
    """たれ耳（ちゃいろ C・ふちの光 O）。頭の上に重ねる。"""
    e = ell(ex, ey, rx, ry, ang); shape(e, 'C'); fill(cells(e, lambda x, y: (x - 1, y) not in e) - edge(e), 'O')
    return e


def collar(cx, cy, rx, head_m, tag=(-4, 1)):
    """あかい首輪と 金の札。cx, cy は首輪の まん中。"""
    col = ell(cx, cy, rx, 1.6) - head_m
    fill(col, 'R'); fill(edge(col) & cells(col, lambda x, y: (x, y + 1) not in col), 'K')
    tx, ty = cx + tag[0], cy + tag[1]
    fill(rect(tx, ty, tx + 1, ty + 1), 'Y')
    return col


def limb(x0, y0, x1, y1, w=4.6, dark=True):
    a = line(x0, y0, x1, y1, w) | ell(x1 + .5, y1 + .5, w * .52, w * .52)
    blob(a, dark)
    return a
