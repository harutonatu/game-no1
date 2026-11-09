# 小物：スタンドのマイク（あたま W と S のあみ・ふち K・え K・ぼう K と光 W・台 K）。
# draw(x, y, gy, toward) … x, y は マイクの あたまの まん中、gy は台の下、toward＝-1 なら左（口の方）へ かたむける。
from lib import *


def draw(x, y, gy, toward=-1):
    px = x - toward * 3                                 # ぼうの x
    pole = line(px, y + 2, px, gy - 1, 1.6) | {(int(px), yy) for yy in range(int(y) + 2, gy)}
    fill(pole, 'K'); fill({(int(px) + 1, yy) for yy in range(int(y) + 4, gy - 2, 3)}, 'W')
    base_ = ell(px + .5, gy - .8, 4, 1.4); shape(base_, 'K', o='K')
    fill(cells(base_, lambda xx, yy: yy == min(b for _, b in base_)), 'W')
    hold = line(px, y + 2.5, x - toward * .5, y + .5, 1.8); fill(hold, 'K')
    top = ell(x, y, 3, 2.8)
    fill(top, 'W'); fill(cells(top, lambda xx, yy: (xx + yy) % 2 == 0), 'S'); fill(edge(top), 'K')
    band = {(int(x) - toward, int(y) + 2), (int(x) - 2 * toward, int(y) + 2), (int(x) - toward, int(y) + 3)}
    fill(band, 'R')
    return pole | top | base_
