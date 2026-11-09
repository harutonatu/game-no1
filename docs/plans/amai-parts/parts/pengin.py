# 動物：ぺんぎん（K と W。くちばしと足 O・平たい手・白いおなか。光は B）。右むきで描く。
from lib import *


def blob(m):
    """くろい体：ぬって、右上に あおい光（市松）。"""
    fill(m, 'K')
    fill(cells(m, lambda x, y: (x - 1, y) in m and (x, y + 1) in m and (x + 1, y) in m and (x, y - 1) in m
               and ((x + 2, y) not in m or (x, y - 2) not in m) and (x + y) % 2 == 0), 'B')


def flipper(x0, y0, x1, y1, w=4.4):
    """平たい手。中は K、ふちは B（くろい体の上でも形が見えるように）。外側のはしは K。"""
    m = line(x0, y0, x1, y1, w) | ell(x0 + (x1 - x0) * .6, y0 + (y1 - y0) * .6, w * .75, w * .55,
                                       math.degrees(math.atan2(y1 - y0, x1 - x0)))
    fill(m, 'K')
    fill(cells(edge(m), lambda x, y: at(x, y) is not None), 'B')
    return m


def foot(cx, cy):
    m = ell(cx, cy, 3.8, 1.9)
    shape(m, 'O', sh='C', sw=1)
    return m


def body_head(cx, by):
    """体と頭（ひと続きのかたち）。白いおなかは のどから下。返り値 (head, body)。"""
    body = ell(cx, by - 12, 11, 12.5)
    head = ell(cx + 1, by - 28, 10.5, 9)
    m = body | head
    blob(m)
    belly = ell(cx + 3.5, by - 11.5, 8, 12.5) & m
    shape(belly - edge(m), 'W', o=None, sh='S', sw=1)
    return head, body


def face(hx, hy, head, look='down', mouth='smile'):
    """目（しろい わっかの中に くろ目）・くちばし・ほっぺ。hx, hy は頭のまん中。look：down（下を見る）・front・closed。"""
    for ex in (hx - 3, hx + 4):
        ring = ell(ex + 1, hy, 2.6, 2.6)
        fill(ring, 'W')
        if look == 'closed':
            fill({(ex - 1, hy), (ex, hy + 1), (ex + 1, hy + 1), (ex + 2, hy)}, 'K')
        else:
            dy = 1 if look == 'down' else 0
            fill(rect(ex, hy - 1 + dy, ex + 1, hy + dy), 'K'); put(ex + 1, hy - 1 + dy, 'W') if look != 'down' else None
    # ほっぺ
    fill({(hx - 6, hy + 3), (hx - 5, hy + 3), (hx - 4, hy + 3), (hx - 5, hy + 4)}, 'P')
    # くちばし（右へ。頭の外へ少し出す）
    if mouth == 'open':
        up = poly([(hx + 2, hy + 1.2), (hx + 12.5, hy + 2.5), (hx + 2, hy + 4)])
        lo = poly([(hx + 2.5, hy + 4.6), (hx + 10.5, hy + 6.8), (hx + 2, hy + 7.2)])
        fill(rect(hx + 3, hy + 4, hx + 8, hy + 4) | rect(hx + 3, hy + 5, hx + 6, hy + 5), 'R')
        shape(up, 'O', sh='C', sw=1); shape(lo, 'O', sh='C', sw=1)
    else:
        bk = poly([(hx + 1.5, hy + .8), (hx + 12.5, hy + 3.4), (hx + 1.5, hy + 6.2)])
        shape(bk, 'O', sh='C', sw=1)
