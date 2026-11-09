# 小物：スタンドのマイク（大きな あみの あたま〔W に S の こうし・ふち K〕・赤い わ R・長い持ち手 K と光 W・ぼう K・台 K）。
# draw(x, y, gy, toward) … x, y は マイクの あたまの まん中、gy は台の下、toward＝-1 なら左（口の方）へ かたむける。
# 返り値：dict（"grip"＝手で にぎる所〔持ち手の下の方〕、"cells"＝描いたマス）。
from lib import *


def draw(x, y, gy, toward=-1):
    t = -toward                                          # 持ち手は 口と反対へ すこし かたむく
    ang = 18 * toward
    # 持ち手（わ の下から ななめ下へ 長く。光の線 W）
    gx0, gy0 = x + t * 1.2, y + 5.2
    gx1, gy1 = x + t * 3.2, y + 12.5
    # ぼう（持ち手の下から 台まで）と 台
    px = int(round(gx1 - .5))
    pole = {(px, yy) for yy in range(int(gy1) - 1, gy)}
    fill(pole, 'K'); fill({(px + t, yy) for yy in range(int(gy1) + 1, gy - 1, 3)}, 'K')
    base_ = ell(px + .5, gy - .8, 4.5, 1.5); shape(base_, 'K', o='K')
    fill(cells(base_, lambda xx, yy: yy == min(b for _, b in base_)), 'W')
    grip = line(gx0, gy0, gx1, gy1, 3.2)
    fill(grip, 'K')
    shine = {p for p in line(gx0 - .4 * t, gy0 + 1, gx1 - .6 * t, gy1 - 1.5) if p in grip and p not in edge(grip)}
    if not shine:
        shine = {p for p in line(gx0, gy0 + 1, gx1, gy1 - 1.5) if p in grip}
    fill(shine, 'W')
    # 赤い わ（あたまと 持ち手の つなぎ目）
    ring = ell(x + t * .6, y + 4.2, 3.0, 1.4, ang)
    fill(ring, 'R'); fill(edge(ring), 'K')
    # あたま（たてに長い だ円。あみ＝しろ に みずいろの こうし、ふち K）
    top = ell(x, y, 3.8, 4.3, ang)
    fill(top, 'W')
    fill(cells(top, lambda xx, yy: xx % 2 == 0 or yy % 2 == 0), 'S')
    fill(cells(top, lambda xx, yy: (xx - t, yy) not in top or (xx, yy - 1) not in top), 'W')
    fill(edge(top), 'K')
    return {"grip": (gx0 + (gx1 - gx0) * .75, gy0 + (gy1 - gy0) * .75), "cells": pole | base_ | grip | ring | top}
