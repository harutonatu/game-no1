# 動物 × ふるまい：ぞうが おえかきを する（すわって、前の 大きな イーゼルの 画用紙に、鼻で にぎった クレヨンで 絵を かく。
#   手前の手は クレヨンの はこを 持つ。画用紙には お日さま・花・家の 絵）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)。
from lib import *
import zou

SHADOW = (8, 17, 1.6)


def easel(x0, y0, by, w=15, h=16):
    """イーゼル（足 C・ふち K）と 大きな 画用紙 W（ふち K）。x0, y0 は 画用紙の 左上、by は 地面。
    かいた絵：お日さま Y・光 O・家 R の やね と O の かべ・花 V と くき G・草 G。返り値：画用紙の マス。"""
    # 足（うしろ 1 本・前 2 本）と 受け皿
    for (xa, xb) in ((x0 + w * .5, x0 + w * .5 + 2), (x0 + 2, x0 - 1), (x0 + w - 2, x0 + w + 1)):
        lg = line(xa, y0 + h - 1, xb, by - 1, 2.2); fill(lg, 'C'); fill(edge(lg) - rect(0, 0, 63, y0 + h - 1), 'K')
    tray = rect(x0 - 1, y0 + h, x0 + w, y0 + h + 1)
    fill(tray, 'C'); fill(edge(tray), 'K')
    pa = rect(x0, y0, x0 + w - 1, y0 + h - 1)
    fill(pa, 'W'); fill(edge(pa), 'K')
    # お日さま（右上）
    sx, sy = x0 + w - 4, y0 + 3.5
    fill(ell(sx, sy, 1.7, 1.7), 'Y')
    for (dx, dy) in ((-2.5, 0), (0, 2.5), (-2, -2), (2, 2), (-2, 2)):
        if (int(sx + dx), int(sy + dy)) in pa - edge(pa):
            put(int(sx + dx), int(sy + dy), 'O')
    # 家（左）
    hx0, hy0 = x0 + 2, y0 + 7
    fill(rect(hx0 + 1, hy0 + 3, hx0 + 5, hy0 + 6), 'O')
    fill(rect(hx0 + 3, hy0 + 5, hx0 + 3, hy0 + 6), 'C')
    fill({(hx0 + i, hy0 + 2) for i in range(0, 7)} | {(hx0 + i, hy0 + 1) for i in range(1, 6)} |
         {(hx0 + i, hy0) for i in range(2, 5)} | {(hx0 + 3, hy0 - 1)}, 'R')
    # 花（右下）
    fx0, fy0 = x0 + w - 4, y0 + 9
    fill(rect(fx0, fy0 + 1, fx0, y0 + h - 3), 'G'); put(fx0 + 1, fy0 + 3, 'G')
    fill({(fx0 - 1, fy0), (fx0 + 1, fy0), (fx0, fy0 - 1), (fx0, fy0 + 1)}, 'V'); put(fx0, fy0, 'Y')
    # 草（下の はし）
    fill({(x, y0 + h - 2) for x in range(x0 + 1, x0 + w - 1) if x % 2 == 0}, 'G')
    # 受け皿の クレヨン
    for k, c in enumerate('RBY'):
        fill({(x0 + 2 + k * 4, y0 + h - 1 + 0), (x0 + 3 + k * 4, y0 + h - 1)}, c)
    return pa


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx - 1, by - 27
    # イーゼル（体の 前。先に 描いて、鼻と 手を 上に 重ねる）
    pa = easel(cx + 10, by - 30, by)
    # しっぽ
    fill(line(cx - 10, by - 5, cx - 14, by - 2), 'K'); fill(ell(cx - 14.5, by - 1.5, 1.2, 1.3), 'K')
    # 奥の足（前へ のばして すわる）
    zou.blob(ell(cx + 1, by - 3.5, 5.5, 3.4), dark=True)
    # 体（すわった まるい胴）
    body = ell(cx - 2, by - 11, 10, 10.5)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 手前の足（前へ のばす。足のうら W）
    zou.blob(ell(cx + 5, by - 3, 5.2, 3.2))
    shape(ell(cx + 10, by - 3, 1.6, 2.6), 'W', o='K')
    # 耳 → 頭 → 顔（画用紙を 見る）
    zou.ear(hx - 11, hy + 1, 8.5, 9)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='open', mouth='smile')
    # 手前の手（クレヨンの はこを 持つ。はこ Y・ふち K・クレヨン R G B）
    bx, byy = cx + 4, by - 13
    zou.blob(line(cx - 1, by - 16, bx, byy, 4.2))
    box = rect(bx - 1, byy - 2, bx + 4, byy + 2); fill(box, 'Y'); fill(edge(box), 'K')
    fill(rect(bx, byy, bx + 3, byy), 'O')
    for k, c in enumerate('RGB'):
        fill({(bx + k + (k > 0), byy - 3), (bx + k + (k > 0), byy - 4)}, c)
    zou.blob(ell(bx - 1, byy + .5, 2.4, 2.4))
    # 鼻（口の上から 前へ のばし、先で クレヨンを にぎって 画用紙に かく）
    tx, ty = cx + 16, by - 22
    zou.trunk([(hx + 5, hy + 2), (hx + 9, hy + 2), (hx + 13, hy + 3), (tx - 1, ty)], 5, 3.4)
    cr = line(tx, ty + 1, tx + 3, ty + 4, 2); fill(cr, 'B'); put(tx + 3, ty + 4, 'B')
    fill(edge(cr) & line(tx - 1, ty + 1, tx + 2, ty + 4), 'K')
    # かいた 線（クレヨンの 先から くるくる）
    fill({(tx + 4, ty + 5), (tx + 5, ty + 5), (tx + 6, ty + 4), (tx + 6, ty + 3)} & (pa - edge(pa)), 'B')
    end(flip, cx)
    return head, body
