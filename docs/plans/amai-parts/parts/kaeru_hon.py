# 動物 × ふるまい：かえるが ほんを よむ（すわって、ひらいた本を両手で持ち、下を見る）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kaeru, hon

SHADOW = (2, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 24
    # 奥の足（すわった もも と 水かき）
    kaeru.thigh(cx - 6, by - 5, 5.2, 4.4, -25, dark=True)
    kaeru.foot(cx - 9, by, -1, dark=True)
    # 体
    body = ell(cx, by - 11, 9, 9.5)
    kaeru.blob(body, spots=True)
    kaeru.belly(cx + 2.5, by - 10, 6, 7.5, body)
    # 手前の足
    kaeru.thigh(cx + 6, by - 4.5, 5.2, 4.2, 20)
    kaeru.foot(cx + 9, by, 1, l=4.6)
    # 頭 → 顔（下を見る）
    head = kaeru.head(hx, hy)
    kaeru.face(hx, hy, eyes='down', mouth='smile')
    # 奥の手（本の左のはし）→ 本 → 手前の手（本の右のはし）
    kaeru.limb(cx - 5, by - 16, cx - 3, by - 12, 3.6, dark=True)
    hon.draw(cx + 5, by - 12, w=8, h=5, cover='B')
    kaeru.hand(cx - 3, by - 11, 1, dark=True)
    kaeru.limb(cx + 5, by - 16, cx + 14, by - 11, 3.8)
    kaeru.hand(cx + 14.5, by - 10.5, -1)
    end(flip, cx)
    return head, body
