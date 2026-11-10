# 動物 × ふるまい：ぱんだが うたう（立って、スタンドのマイクを 手前の くろい手で にぎり、奥の手を ななめ上へ のばす。
# 目を とじて 口を あける。音符がとぶ）。draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import panda, maiku

SHADOW = (3, 14, 1.6)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 28
    panda.ears(hx, hy)
    panda.tail(cx - 9, by - 8)
    # 奥の手（ひじを まげて 上へ 高く のばす）
    panda.limb(cx - 6, by - 19, cx - 14, by - 22, 4.6); panda.limb(cx - 14, by - 22, cx - 16, by - 30, 4.4)
    # 足（くろく 短く 太い）
    panda.limb(cx - 4, by - 8, cx - 4, by - 2.5, 5.4)
    panda.limb(cx + 4, by - 8, cx + 4, by - 2.5, 5.4)
    body = panda.body(cx, by - 13, 9.5, 10)
    head = panda.head(hx, hy, look=1, eyes='happy', mouth='open')
    # マイク（口の前）と、それを持つ 手前の手
    mk = maiku.draw(hx + 10, hy + 7, by, -1)
    gx, gy = mk["grip"]
    panda.limb(cx + 4, by - 19, gx - .5, gy + .5, 4.6, rim=True)
    end(flip, cx)
    X = (lambda x: 2 * cx - 5 - x) if flip else (lambda x: x)   # 音符は 向きで 左右に うつすが 形は そのまま
    note(X(cx + 2), by - 46, 'R')     # 頭の上の 空（音符は 空 P でも 見える色 R・B）
    note(X(cx - 24), by - 29, 'B')    # 上げた手の 先
    return head, body
