# 動物 × ふるまい：ぞうが うたう（立って、スタンドのマイクに口をよせ、鼻を高く上げる。音符がとぶ）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import zou, maiku

SHADOW = (3, 13, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 2, by - 27
    # しっぽ
    fill(line(cx - 9, by - 9, cx - 12, by - 5), 'K'); fill(ell(cx - 12, by - 4.5, 1.2, 1.4), 'K')
    # 奥の手（ひらいて下へ）
    a = line(cx - 6, by - 16, cx - 13, by - 11, 4.6); zou.blob(a, dark=True)
    zou.blob(ell(cx - 13.5, by - 10.5, 2.6, 2.4), dark=True)
    zou.leg(cx - 4, by - 9, by)
    body = ell(cx, by - 12, 9.5, 10)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    zou.leg(cx + 5, by - 7, by)
    # 耳（頭のうしろ・左へ大きく）→ 頭 → 顔
    zou.ear(hx - 12, hy + 1.5, 8, 10, -8)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='happy', mouth='open')
    # マイク（口の前）と、それを持つ 手前の手
    maiku.draw(hx + 9, hy + 5.5, by, -1)
    a = line(cx + 5, by - 16, hx + 10, by - 15, 4.4); zou.blob(a)
    zou.blob(ell(hx + 11, by - 15.5, 2.4, 2.4))
    # 鼻（口の上から 前へ、上へ くるん）
    zou.trunk([(hx + 5, hy + 2), (hx + 9, hy - 1), (hx + 11, hy - 6), (hx + 10, hy - 11), (hx + 7, hy - 12)], 5, 3)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 5 if flip else 0
    note(cx - s * 3 - sh, by - 46, 'B')
    note(cx - s * 25 - sh, by - 34, 'V')
    return head, body
