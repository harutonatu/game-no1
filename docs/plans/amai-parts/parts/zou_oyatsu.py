# 動物 × ふるまい：ぞうが おやつを たべる（すわって、大きな ソフトクリームを 手で持ち、口に はこんで もぐもぐ。
# 鼻は うれしそうに 上へ くるん。きらりと 食べかす）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import zou

SHADOW = (3, 14, 1.6)


def icecream(x, y):
    """大きな ソフトクリーム：x, y は 上の玉の まん中。コーン O（あみ C）・下の玉 W（かげ S）・上の玉 チョコ C（光 O）・
    さくらんぼ R。返り値：コーンの下（手で持つ所）。"""
    cone = poly([(x - 4.6, y + 3.5), (x + 4.6, y + 3.5), (x + .5, y + 14), (x - .5, y + 14)])
    fill(cone, 'O'); fill(cells(cone, lambda xx, yy: (xx + yy) % 3 == 0 or (xx - yy) % 3 == 0), 'C'); fill(edge(cone), 'K')
    lo = ell(x, y + 2.5, 5.4, 2.8)
    shape(lo, 'W', sh='S', sw=1)
    up = ell(x - .3, y - 1.2, 4.4, 3.2)
    shape(up, 'C', hi='O', sw=1, hw=1)
    ch = ell(x + .5, y - 5.2, 1.7, 1.7); shape(ch, 'R')
    put(int(x + 1), int(y - 7), 'W')
    fill({(int(x + 2), int(y - 8)), (int(x + 3), int(y - 9))}, 'K')
    return (x, y + 11)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 27
    # しっぽ
    fill(line(cx - 9, by - 5, cx - 13, by - 2), 'K'); fill(ell(cx - 13.5, by - 1.5, 1.2, 1.3), 'K')
    # 奥の足（前へ のばして すわる）
    zou.blob(ell(cx + 2, by - 3.5, 5.5, 3.4), dark=True)
    # 体（すわった まるい胴）
    body = ell(cx - 1, by - 11, 10.5, 10.5)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 手前の足（前へ のばす。足のうら W）
    zou.blob(ell(cx + 7, by - 3, 5.2, 3.2))
    shape(ell(cx + 12, by - 3, 1.6, 2.6), 'W', o='K')
    # 奥の手（おなかを さする）
    zou.blob(line(cx - 6, by - 15, cx - 3, by - 9, 4.2), dark=True)
    zou.blob(ell(cx - 2.5, by - 8.5, 2.3, 2.3), dark=True)
    # 耳 → 頭 → 顔（にっこり・もぐもぐ）
    zou.ear(hx - 11, hy + 1, 8.5, 9)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='happy', mouth='chew')
    # 鼻（口の上から 前へ、上へ くるん）
    zou.trunk([(hx + 5, hy + 2), (hx + 9, hy - 1), (hx + 11, hy - 5), (hx + 10, hy - 9), (hx + 7, hy - 10)], 5, 3)
    # 手前の手で ソフトクリームを 口の前へ
    ix, iy = hx + 9, hy + 4
    gx, gy = icecream(ix, iy)
    zou.blob(line(cx + 3, by - 11, gx - .5, gy, 4.4))
    zou.blob(ell(gx, gy, 2.5, 2.5))
    end(flip, cx)
    # 食べかすの きらり（向きに合わせて 口の まわり）
    s = -1 if flip else 1
    sparkle(cx + s * 4, hy + 11, 'Y')
    return head, body
