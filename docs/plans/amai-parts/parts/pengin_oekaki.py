# 動物 × ふるまい：ぺんぎんが おえかきを する（すわって、ひざに 大きな 画板と 画用紙。手前の手で クレヨンを 持って、
#   お日さまと さかなと なみの 絵を かく。下を 見る。足もとに クレヨンの はこ）。
# 画用紙は 大きめ（横 25・縦 18 マスの 画板。前の UX レビュー「ぶたの画用紙が小さい」を受けて）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin

SHADOW = (2, 16, 1.6)


def board(x0, y0, w=24, h=18):
    """画板（太い わく C・上の ふちの 光 O・ふち K）に 画用紙 W（かげ S）。かいた絵：お日さま Y（光 O）・さかな O
    （目 K・うろこ R）・なみ B 2 本。x0, y0 は 左上。返り値：画用紙の マス。"""
    fr = poly([(x0, y0 + 1), (x0 + w, y0), (x0 + w + 1, y0 + h), (x0 + 1, y0 + h + 1)])
    fill(fr, 'C'); fill(cells(fr, lambda x, y: (x, y - 1) not in fr or (x, y - 2) not in fr), 'O'); fill(edge(fr), 'K')
    pa = poly([(x0 + 2.6, y0 + 3), (x0 + w - 2, y0 + 2.4), (x0 + w - 1.2, y0 + h - 1.8), (x0 + 3.2, y0 + h - 1.2)])
    fill(pa, 'W')
    fill(edge(pa) & cells(pa, lambda x, y: (x - 1, y) not in pa or (x, y + 1) not in pa), 'S')
    # お日さま（左上）
    sx, sy = x0 + 6, y0 + 6.5
    fill(ell(sx, sy, 2.2, 2.2), 'Y')
    for (dx, dy) in ((-3.6, 0), (3.6, 0), (0, -3.4), (-2.8, -2.8), (2.8, -2.8), (2.8, 2.8)):
        if (int(sx + dx), int(sy + dy)) in pa: put(int(sx + dx), int(sy + dy), 'O')
    # さかな（右。からだ O・しっぽ O・目 K・うろこ R）
    fx0, fy0 = x0 + 13.5, y0 + 8.5
    fish = ell(fx0, fy0, 4.2, 2.4) | poly([(fx0 - 3.5, fy0), (fx0 - 7, fy0 - 2.8), (fx0 - 7, fy0 + 2.8)])
    fill(fish & pa, 'O')
    put(int(fx0 + 2), int(fy0 - 1), 'K')
    fill({(int(fx0), int(fy0)), (int(fx0 - 1), int(fy0) - 1), (int(fx0 - 1), int(fy0) + 1)} & pa, 'R')
    # なみ（下に 2 本。B）
    for k, yy in enumerate((y0 + h - 6, y0 + h - 4)):
        for x in range(int(x0 + 3), int(x0 + w)):
            y = int(yy + (0 if (x + k * 2) % 4 < 2 else -1))
            if (x, y) in pa and at(x, y) == 'W': put(x, y, 'B')
    return pa


def crayon_box(bx, by):
    """足もとの クレヨンの はこ（Y・おび O・ふち K）と 立てた クレヨン 4 本（R G B V）。bx, by は はこの 左下。"""
    box = rect(bx, by - 4, bx + 6, by); fill(box, 'Y'); fill(edge(box), 'K'); fill(rect(bx + 1, by - 2, bx + 5, by - 2), 'O')
    for k, c in enumerate('RGBV'):
        x = bx + 1 + round(k * 1.4)
        fill(rect(x, by - 7 + (k % 2), x, by - 4), c)


def draw(cx, by, flip=False):
    begin()
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='down', mouth='smile')
    pengin.foot(cx - 6, by - 1.5)
    # 奥の手（画板の 左を おさえる）→ 画板 → 手前の手（クレヨンを にぎって 画用紙の 右下に かく）
    pengin.flipper(cx - 9, by - 16, cx - 6, by - 9, 4.2)
    board(cx - 6, by - 21, 25, 18)
    pengin.foot(cx + 9, by - 1.2)
    pengin.flipper(cx + 10, by - 18, cx + 15, by - 11, 4.6)
    cr = line(cx + 14.5, by - 9.5, cx + 12, by - 6.5, 2.2)
    fill(cr, 'R'); fill(edge(cr) & line(cx + 15.5, by - 9, cx + 13, by - 6), 'K')
    put(cx + 11, by - 6, 'R')
    crayon_box(cx - 20, by - 1)
    end(flip, cx)
    return head, body
