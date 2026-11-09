# 動物：ぶた（P。かげ V・光 W。まるい鼻・まいたしっぽ）。右むきで描く。
from lib import *


def blob(m, dark=False, hi=True):
    shape(m, 'P', sh='V', sw=2 if dark else 1)
    if hi: fill(cells(m, lambda x, y: (x, y - 2) not in m and (x, y - 1) in m and (x - 2, y) in m and (x + 2, y) in m
               and (x - 1, y + 1) in m and (x + y) % 2 == 0), 'W')


def ear(cx, cy, rx=3.2, ry=5, ang=35):
    """耳（木の葉の形を 前へ たおす）。中は R。"""
    m = ell(cx, cy, rx, ry, ang) | ell(cx + .5, cy + 1, rx * .9, ry * .6, ang)
    shape(m, 'P', sh='V', sw=1)
    fill(ell(cx + .3, cy + .2, max(1, rx - 1.8), max(1.5, ry - 2.4), ang) - edge(m), 'R')
    return m


def tail(x, y, s=1):
    """まいたしっぽ（ピンクの 1 マスの線で くるり。x, y は おしりの つけね）。s＝-1 で向きぎゃく。"""
    pts = [(x, y), (x - 2 * s, y - 1), (x - 3 * s, y - 3), (x - 3 * s, y - 5), (x - 2 * s, y - 6), (x - 1 * s, y - 6),
           (x, y - 5), (x, y - 4), (x - 1 * s, y - 3), (x - 2 * s, y - 4)]
    m = set()
    for i in range(len(pts) - 1):
        m |= line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    fill(m, 'P')
    return m


def head(hx, hy):
    m = ell(hx, hy, 9.5, 8.2)
    blob(m)
    return m


def face(hx, hy, eyes='open', mouth='smile'):
    """目・まるい鼻（あな 2 つ）・口・ほっぺ。"""
    for ex in (hx - 2, hx + 3):
        if eyes == 'happy':
            fill({(ex - 1, hy), (ex, hy - 1), (ex + 1, hy - 1), (ex + 2, hy)}, 'K')
        else:
            fill(rect(ex, hy - 2, ex + 1, hy), 'K'); put(ex + 1, hy - 2, 'W')
    sn = ell(hx + 10, hy + 2, 3, 3.4)
    shape(sn, 'P', sh='V', sw=1)
    fill({(int(hx + 9), int(hy + 1)), (int(hx + 9), int(hy + 2)), (int(hx + 11), int(hy + 1)), (int(hx + 11), int(hy + 2))}, 'K')
    fill({(hx - 6, hy + 2), (hx - 5, hy + 2), (hx - 5, hy + 3)}, 'R')
    if mouth == 'smile':
        fill({(hx + 1, hy + 5), (hx + 2, hy + 6), (hx + 3, hy + 6), (hx + 4, hy + 5)}, 'K')
    elif mouth == 'open':
        mo = rect(hx + 1, hy + 5, hx + 4, hy + 7); fill(mo, 'K'); fill(rect(hx + 2, hy + 6, hx + 3, hy + 6), 'R')
