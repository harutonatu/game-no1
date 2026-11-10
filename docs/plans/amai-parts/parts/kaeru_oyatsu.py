# 動物 × ふるまい：かえるが おやつを たべる（すわって、おだんごの くしを 口へ。目は にっこり。
#   おしりの よこの おさらに プリン）。顔は 大きな頭（kaeru.head_big・face_big）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import kaeru

SHADOW = (0, 16, 1.6)


def dango(x0, y0, x1, y1):
    """おだんごの くし（くし C。下の はし x0, y0 → 上の はし x1, y1）。玉は 下から O・W・P。"""
    fill(line(x0, y0, x1 + (x1 - x0) * .15, y1 + (y1 - y0) * .15), 'C')
    for k, c in enumerate('OWP'):
        t = .38 + k * .27
        bx, by_ = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        m = ell(bx, by_, 3.6, 3.4)
        fill(m, c)
        fill(cells(m, lambda x, y: (x - 1, y) not in m or (x, y + 1) not in m), {'O': 'C', 'W': 'S', 'P': 'V'}[c] if c != 'W' else 'S')
        fill(edge(m), 'K')
        put(int(bx), int(by_ - 1.5), 'W' if c != 'W' else 'Y')


def pudding(x, y):
    """おさら（W・かげ S）に プリン（Y・かげ O、上に カラメル C、クリーム W と さくらんぼ R）。x, y は おさらの まん中。"""
    pl = ell(x, y, 8, 1.8); shape(pl, 'W', sh='S', sw=1)
    pu = poly([(x - 6, y - .5), (x + 6, y - .5), (x + 4, y - 9), (x - 4, y - 9)])
    fill(pu, 'Y'); fill(cells(pu, lambda xx, yy: (xx - 1, yy) not in pu or (xx - 2, yy) not in pu), 'O')
    fill(cells(pu, lambda xx, yy: yy <= y - 8 or (yy == y - 7 and xx % 2 == 0)), 'C')
    fill(edge(pu), 'K')
    cr = ell(x + .5, y - 10, 3, 1.6); fill(cr, 'W'); fill(edge(cr), 'K')
    ch = ell(x + .5, y - 12.5, 2, 2); fill(ch, 'R'); fill(edge(ch), 'K'); put(x + 1, y - 13, 'W')
    put(x + 1, y - 15, 'K'); put(x + 2, y - 16, 'K')


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 24
    # 奥の足（すわった もも と 水かき）
    kaeru.thigh(cx - 7, by - 5, 5.2, 4.4, -25, dark=True)
    kaeru.foot(cx - 10, by, -1, dark=True)
    # 体
    body = ell(cx, by - 11, 10.5, 10)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 10, 7, 7, body)
    # 手前の足
    kaeru.thigh(cx + 6, by - 4.5, 5.4, 4.2, 20)
    kaeru.foot(cx + 10, by, 1, l=4.6)
    # 頭 → 顔（にっこり もぐもぐ）
    head = kaeru.head_big(hx, hy)
    kaeru.face_big(hx, hy, eyes='happy', mouth='eat')
    # 奥の手（おなかを ぽん）
    kaeru.hand(cx - 2, by - 12, 1, dark=True)
    # おだんご（口の 前へ）と 手前の手
    dango(cx + 22, by - 5, cx + 16, by - 27)
    kaeru.limb(cx + 6, by - 13, cx + 19, by - 9, 3.8)
    kaeru.hand(cx + 20.5, by - 8.5, -1)
    # おしりの よこの プリン
    pudding(cx - 19, by - 2)
    end(flip, cx)
    return head, body
