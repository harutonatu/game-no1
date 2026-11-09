# 動物 × ふるまい：ぺんぎんが ほんを よむ（すわって、ひらいた本を両手で持ち、下を見る）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。flip で左右ぎゃく。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin, hon


def draw(cx, by, flip=False):
    begin()
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='down')
    # 奥の手（本の左のはしへ）
    pengin.flipper(cx - 8, by - 17, cx - 4, by - 9)
    hon.draw(cx + 5, by - 11, w=8, h=5, cover='R')
    # 手前の手（本の右のはしを持つ）
    pengin.flipper(cx + 8, by - 17, cx + 13, by - 10)
    pengin.foot(cx - 3, by - 1.5); pengin.foot(cx + 7, by - 1.2)
    end(flip, cx)
    return head, body

SHADOW = (2, 13, 1.6)   # かげ：体のまん中からのずれ・横の半径・縦の半径
