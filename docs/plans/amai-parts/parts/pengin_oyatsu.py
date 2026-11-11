# 動物 × ふるまい：ぺんぎんが おやつを たべる（立って、大きな ピンクの ドーナツを 手前の手で 持ち、くちばしで ぱくり。
#   ドーナツは かじった あと つき。奥の手は おなかを ぽん。口の まわりに 食べかすの きらり）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import lib, pengin

SHADOW = (3, 14, 1.6)


def donut(x, y, r=7.6):
    """大きな ドーナツ：x, y は まん中。生地 O（かげ C）・上に ピンクの クリーム P（なみの ふち）・
    つぶつぶ（R Y G W B）・まん中の あな。左上を かじった あと。返り値：ドーナツの マス。"""
    ring = ell(x, y, r, r * .88) - ell(x + .2, y + .3, 1.8, 1.5)
    bite = ell(x - r + .3, y - r * .42, 1.9, 1.7) | ell(x - r + .5, y - r * .05, 1.6, 1.5)
    m = ring - bite
    fill(m, 'O')
    fill(cells(m, lambda xx, yy: (xx - 1, yy) not in m or (xx, yy + 1) not in m), 'C')
    # クリーム（上の 6 わり。下の ふちは なみ）
    icing = cells(m, lambda xx, yy: yy + .5 < y + 1.4 + 1.1 * math.sin(xx * 1.3) and (xx, yy + 1) in m)
    fill(icing, 'P')
    inner = icing - edge(m) - edge(ell(x + .2, y + .3, 2.9, 2.6))
    k = 0
    for (xx, yy) in sorted(inner, key=lambda p: (p[1], p[0])):
        if (xx * 2 + yy * 3) % 5 == 0:
            put(xx, yy, 'RGWBY'[k % 5]); k += 1
    fill(edge(m) | (edge(ell(x + .2, y + .3, 2.9, 2.6)) & m), 'K')
    return m


def draw(cx, by, flip=False):
    begin()
    # 奥の手（おなかを ぽん）
    pengin.flipper(cx - 9, by - 18, cx - 3, by - 10, 4.4)
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    # ドーナツ（くちばしの 先に かじった あとが くる）→ 顔（くちばしを 上に 重ねて ぱくり）
    donut(cx + 16.5, by - 22.5)
    pengin.face(hx, hy, head, look='happy', mouth='smile')
    # 手前の手（ドーナツの 下を 持つ）
    pengin.flipper(cx + 6, by - 13, cx + 11, by - 18, 4.8)
    pengin.foot(cx - 4, by - 1.5); pengin.foot(cx + 6, by - 1.2)
    end(flip, cx)
    # 食べかすの きらり（ドーナツの 上）
    s = -1 if flip else 1
    X = lambda dx: cx + s * dx - (1 if flip else 0)
    sparkle(X(20), by - 33, 'Y')
    sparkle(X(25), by - 30, 'W')
    # おいしい の ハート（R。頭の 右上。まわり 1 マスの 星などの 模様は 地の色へ もどす）
    hm = {(X(dx), by - 41 + r) for r, row in enumerate(("XX.XX", "XXXXX", ".XXX.", "..X..")) for dx, ch in
          zip(range(13, 18), row) if ch == 'X'}
    hm |= {(X(12), by - 40), (X(18), by - 40)}
    for (px, py) in {(px + dx, py + dy) for (px, py) in hm for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - hm:
        if (px, py) in lib.decos and lib.base[py][px]:
            put(px, py, lib.base[py][px]); lib.decos.discard((px, py))
    fill(hm, 'R')
    return head, body
