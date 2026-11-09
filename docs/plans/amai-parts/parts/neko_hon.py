# 動物 × ふるまい：ねこが ほんを よむ（すわって、ひざの上の ひらいた本を 両手で持ち、下を見る。しっぽは うしろで くるん）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。flip で左右ぎゃく。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import neko, hon

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 27
    neko.tail([(cx - 8, by - 3), (cx - 15, by - 5), (cx - 18, by - 11), (cx - 17, by - 17), (cx - 14, by - 19)])
    neko.foot(cx - 6, by - 2.5)
    body = neko.body(cx, by - 12, 10.5, 10.5)
    neko.ears(hx, hy)
    head = neko.head(hx, hy, look=1, eyes='down', mouth='smile')
    neko.foot(cx + 9, by - 2.3, 5, 2.9)
    # 奥の手（本の左のはしへ）
    neko.limb(cx - 7, by - 17, cx - 5, by - 10)
    hon.draw(cx + 5, by - 11, w=8, h=5, cover='B')
    # 手前の手（本の右のはしを持つ）
    neko.limb(cx + 7, by - 18, cx + 14, by - 11, 4.8)
    end(flip, cx)
    return head, body
