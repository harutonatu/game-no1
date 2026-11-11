# 動物 × ふるまい：かえるが おえかきを する（すわって、おなかの 前に 立てた 大きな 画用紙に クレヨンで 絵を かく。
#   かいた絵は にじ と お日さま と 花。足もとに クレヨンの はこ）。顔は 大きな頭（kaeru.head_big・face_big）で 下を見る。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import kaeru

SHADOW = (3, 16, 1.6)


def paper(x0, y0, w=17, h=15):
    """大きな 画用紙（W・ふち K・下と左の かげ S）。かいた絵：にじ（R・Y・B）・お日さま Y と 光 O・花 P と くき G・草の線 G。
    x0, y0 は 左上（右へ すこし かたむく）。まわりに 画板の わく C。返り値は紙のマス。"""
    fr = poly([(x0 - 1, y0), (x0 + w + 1, y0 - 1), (x0 + w + 2, y0 + h + 1), (x0, y0 + h + 2)])   # 画板（わく C）
    fill(fr, 'C'); fill(edge(fr), 'K')
    pa = poly([(x0 + .5, y0 + 1.5), (x0 + w, y0 + .7), (x0 + w + .6, y0 + h), (x0 + 1.2, y0 + h + .6)])
    fill(pa, 'W'); fill(cells(pa, lambda x, y: (x, y + 1) not in pa or (x - 1, y) not in pa), 'S')
    inn = pa
    # にじ（左下から 右へ）
    rx0, ry0 = x0 + w * .45, y0 + h - 2.5
    for r, c in ((7.5, 'R'), (6.3, 'Y'), (5.1, 'B')):
        ring = cells(ell(rx0, ry0, r, r * .85) - ell(rx0, ry0, r - 1.2, (r - 1.2) * .85), lambda x, y: y < ry0 - .5)
        fill(ring & inn, c)
    # お日さま（左上）
    sx, sy = x0 + 4, y0 + 4.5
    fill(ell(sx, sy, 1.6, 1.6) & inn, 'Y')
    for (dx, dy) in ((2, 0), (0, 2), (2, 2), (-2, 0), (0, -2)):
        if (int(sx + dx), int(sy + dy)) in inn: put(int(sx + dx), int(sy + dy), 'O')
    # 花 2 つ と 草
    for fx0, fy0, c in ((x0 + 3, y0 + h - 4, 'P'), (x0 + w - 3, y0 + h - 4, 'V')):
        fill(rect(fx0, fy0 + 1, fx0, y0 + h - 1) & inn, 'G')
        fill({(fx0 - 1, fy0), (fx0 + 1, fy0), (fx0, fy0 - 1), (fx0, fy0 + 1)} & inn, c); put(fx0, fy0, 'Y')
    fill({(x, y0 + h - 1) for x in range(int(x0 + 2), int(x0 + w))} & inn, 'G')
    return pa


def crayon_box(x, y):
    """クレヨンの はこ（Y・おび O・ふち K）に 4 本（R G B V）。x, y は はこの 左下。"""
    box = rect(x, y - 4, x + 7, y); fill(box, 'Y'); fill(rect(x + 1, y - 2, x + 6, y - 2), 'O'); fill(edge(box), 'K')
    for k, c in enumerate('RGBV'):
        fill(rect(x + 1 + k * 2, y - 7 + (k % 2), x + 2 + k * 2, y - 5), c)
        put(x + 1 + k * 2, y - 7 + (k % 2) - 1, c)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx - 1, by - 25
    # 奥の足（すわった もも と 水かき）
    kaeru.thigh(cx - 7, by - 5, 5.2, 4.4, -25, dark=True)
    kaeru.foot(cx - 10, by, -1, dark=True)
    # 体
    body = ell(cx, by - 11, 10.5, 10)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 1.5, by - 10, 7, 7, body)
    # 頭 → 顔（画用紙を 見る）
    head = kaeru.head_big(hx, hy)
    kaeru.face_big(hx, hy, eyes='down', mouth='smile')
    # 手前の足（ひざ）→ 画用紙（ひざに 立てて、おなかの 前に）
    kaeru.thigh(cx + 6, by - 4.5, 5.4, 4.2, 20)
    kaeru.foot(cx + 11, by, 1, l=4.6)
    pa = paper(cx - 9, by - 20, 21, 15)
    # 奥の手（紙の 左の はしを おさえる）
    kaeru.hand(cx - 10, by - 10, 1, dark=True)
    # 手前の手（紙の 右から、クレヨン R を 持って かく）
    kaeru.limb(cx + 9, by - 14, cx + 15, by - 9, 3.8)
    kaeru.hand(cx + 12.5, by - 9.5, -1)
    cr = line(cx + 10.5, by - 10.5, cx + 7.5, by - 12.5, 2); fill(cr, 'O'); put(cx + 6, by - 13, 'O'); fill(edge(cr) & line(cx + 10.5, by - 9.5, cx + 7.5, by - 11.5), 'K')
    # 足もとの クレヨンの はこ
    crayon_box(cx - 20, by - 1)
    end(flip, cx)
    return head, body
