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


# ---- 2026-11-09 に足した（担当 C。立つ・すわるの 体。上の関数は 153 の絵のため変えない）----
def leg(x, top, by, w=4, dark=False):
    """立つ足（短く太い。上 top から 足の下 by まで。先は ひづめ C）。x は足の まん中。"""
    m = rect(x - w // 2, top, x - w // 2 + w - 1, by - 1)
    blob(m, dark=dark, hi=False)
    fill(rect(x - w // 2 + 1, by - 2, x - w // 2 + w - 2, by - 2), 'C')
    return m


def foot_fwd(x0, y, x1, w=4.4, dark=False):
    """すわって 前へ 出した足（よこむき。先 x1 に ひづめ C）。"""
    m = line(x0, y, x1, y, w)
    blob(m, dark=dark, hi=False)
    fill(rect(x1 - 1, y - 1, x1 - 1, y), 'C')
    return m


def arm(x0, y0, x1, y1, w=4.2, dark=False):
    """うで（太い線）と 先の まるい手。"""
    a = line(x0, y0, x1, y1, w); blob(a, dark=dark, hi=False)
    h = ell(x1 + .5, y1 + .5, 2.3, 2.3); blob(h, dark=dark)
    return a | h


def face2(hx, hy, eyes='open', mouth='smile'):
    """face のほかの目（down＝下を見る・closed＝つぶる）と口（eat＝もぐもぐ・sing＝大きくあける）。"""
    if eyes in ('open', 'happy'):
        face(hx, hy, eyes, mouth if mouth in ('smile', 'open') else 'none')
    else:
        face(hx, hy, 'open', mouth if mouth in ('smile', 'open') else 'none')
        for ex in (hx - 2, hx + 3):
            fill(rect(ex, hy - 2, ex + 1, hy), 'P')
            if eyes == 'down':
                fill(rect(ex, hy - 1, ex + 1, hy + 1), 'K'); put(ex + 1, hy - 1, 'W')
            else:
                fill({(ex - 1, hy - 1), (ex, hy), (ex + 1, hy), (ex + 2, hy - 1)}, 'K')
    if mouth == 'sing':
        mo = ell(hx + 3, hy + 6.2, 2.6, 2.2); fill(mo, 'K'); fill(rect(hx + 2, hy + 7, hx + 4, hy + 7), 'R')
    elif mouth == 'eat':
        mo = ell(hx + 3.5, hy + 5.8, 2, 1.6); fill(mo, 'K'); put(hx + 3, hy + 6, 'R')
