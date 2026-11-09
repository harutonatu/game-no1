# 動物 × ふるまい：ぺんぎんが おどる（体を かたむけ、片足を 上げて、両手を 大きく ひろげる。
#   手のまわりに 動きの線、上に 音符）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import pengin

SHADOW = (1, 12, 1.5)


def draw(cx, by, flip=False):
    begin()
    # 奥の手（ななめ 上へ 大きく ひろげる）
    pengin.flipper(cx - 6, by - 20, cx - 15, by - 28, 4.6)
    # 体と頭（体は 右へ すこし かたむく）
    body = ell(cx + 1, by - 13, 10.5, 12, 14)
    head = ell(cx + 4, by - 29, 10, 8.6)
    m = body | head
    pengin.blob(m)
    belly = ell(cx + 4, by - 12.5, 7.5, 11.5, 14) & m
    shape(belly - edge(m), 'W', o=None, sh='S', sw=1)
    hx, hy = cx + 4, by - 29
    pengin.face(hx, hy, head, look='happy', mouth='smile')
    # 立っている足
    pengin.foot(cx - 3, by - 1.5)
    # 上げた足（前へ ける。みじかい足 K と オレンジの足）
    lg = line(cx + 6, by - 6, cx + 12, by - 8, 4); fill(lg, 'K')
    f = ell(cx + 14, by - 9, 3.6, 1.9, -25); shape(f, 'O', sh='C', sw=1)
    # 手前の手（前へ 大きく ひろげる）
    pengin.flipper(cx + 7, by - 17, cx + 18, by - 21, 4.6)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh
    # 動きの線（手の先の まわりに 弧）
    for (dx, y) in ((-18, by - 32), (-19, by - 31), (-20, by - 29), (-20, by - 28)):
        put(X(dx), y, 'K')
    for (dx, y) in ((21, by - 26), (22, by - 24), (22, by - 23), (22, by - 22), (21, by - 20)):
        put(X(dx), y, 'K')
    for (dx, y) in ((15, by - 4), (16, by - 4), (17, by - 5), (18, by - 6)):
        put(X(dx), y, 'K')
    # 音符
    note(X(10) - 2, by - 46, 'R')
    note(X(-10) - 2, by - 44, 'V')
    return head, body
