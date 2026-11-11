# 動物 × ふるまい：いぬが ほんを よむ（すわって、ひざの上の ひらいた本を 両手で持ち、下を見る。たれ耳・あかい首輪。
# しっぽは うしろで ぴんと上げる）。draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import inu, hon

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 27
    inu.tail(cx - 12.5, by - 17, -35)
    # 奥の足（ひざを まげて すわる）
    f = ell(cx - 6, by - 2.5, 4.6, 2.8); inu.blob(f)
    body = inu.body(cx, by - 12, 10.5, 10.5)
    head = inu.head(hx, hy, look=1, eyes='down', mouth='smile')
    # たれ耳（頭の うしろがわ。今の絵と同じ 1 つ）
    inu.ear(hx - 9, hy - 0.5, 22, 3.4, 6.8)
    inu.collar(hx - 1, hy + 8.3, 7, head)
    # 手前の足
    f = ell(cx + 9, by - 2.3, 5, 2.9); inu.blob(f)
    # 奥の手（本の左のはしへ）
    inu.limb(cx - 7, by - 17, cx - 5, by - 10)
    hon.draw(cx + 5, by - 11, w=8, h=5, cover='G')
    # 手前の手（本の右のはしを持つ）
    inu.limb(cx + 7, by - 18, cx + 14, by - 11, 4.8)
    end(flip, cx)
    return head, body
