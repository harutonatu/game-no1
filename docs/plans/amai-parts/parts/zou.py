# 動物：ぞう（S。かげ B・耳の中 P・つめ W。長い鼻・大きな耳）。右むきで描く。
from lib import *


def blob(m, dark=False):
    """みずいろの体：ぬって、左下に あおいかげ、ふちどり K。dark は奥の手足（かげを多め）。"""
    shape(m, 'S', sh='B', sw=2 if dark else 1)


def ear(cx, cy, rx=6.5, ry=8.5, ang=-10):
    """大きな耳（中は P）。"""
    m = ell(cx, cy, rx, ry, ang)
    shape(m, 'S', sh='B', sw=1)
    inn = ell(cx + .8, cy + .5, rx - 3, ry - 3.4, ang) - edge(m)
    fill(inn, 'W'); fill(cells(inn, lambda x, y: (x - 1, y) not in inn or (x, y + 1) not in inn), 'V')
    fill(ell(cx + 1.4, cy + .6, max(1, rx - 4.6), max(1.5, ry - 5), ang) & inn - edge(inn), 'P')
    return m


def leg(x, top, by, w=3.6):
    """太い足と しろい つめ。x は足のまん中。"""
    m = rect(x - w, top, x + w - 1, by - 1) | ell(x, by - 1.2, w + .8, 1.8)
    blob(m)
    for k in (-2, 0, 2):
        put(int(x + k), by - 2, 'W')
    return m


def trunk(pts, w0=4.8, w1=3.2):
    """長い鼻：点の並びを、だんだん細くなる太い線でつなぐ。先に 穴（K）。"""
    m = set(); n = len(pts) - 1
    for i in range(n):
        w = w0 + (w1 - w0) * (i / max(1, n - 1))
        m |= line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w)
    fill(m, 'S')
    fill(cells(m, lambda x, y: (x - 1, y) not in m or (x, y + 1) not in m), 'B')
    # しわ
    for i in range(1, n):
        x, y = pts[i]
        fill(cells(m, lambda xx, yy: abs(xx - x) + abs(yy - y) == 1) - edge(m), 'B')
    fill(edge(m), 'K')
    return m


def head(hx, hy):
    """頭（大きめのだ円）。返り値は頭のマス。"""
    m = ell(hx, hy, 9.5, 8.6)
    blob(m)
    return m


def face(hx, hy, eyes='happy', mouth='open'):
    """目・口・ほっぺ。eyes：happy（にっこり閉じた目）・open。mouth：open（うたう口）・smile。"""
    for ex in (hx - 2, hx + 4):
        if eyes == 'happy':
            fill({(ex - 1, hy), (ex, hy - 1), (ex + 1, hy - 1), (ex + 2, hy)}, 'K')
        else:
            fill(rect(ex, hy - 1, ex + 1, hy + 1), 'K'); put(ex + 1, hy - 1, 'W')
    fill({(hx - 5, hy + 2), (hx - 4, hy + 2), (hx - 4, hy + 3), (hx + 7, hy + 2), (hx + 8, hy + 2), (hx + 7, hy + 3)}, 'P')
    if mouth == 'open':
        mo = ell(hx + 1.5, hy + 5.6, 2.6, 2.2)
        fill(mo, 'K'); fill(ell(hx + 1.5, hy + 6.6, 1.6, 1) & mo - edge(mo), 'R')
    else:
        fill({(hx, hy + 5), (hx + 1, hy + 6), (hx + 2, hy + 6), (hx + 3, hy + 5)}, 'K')
