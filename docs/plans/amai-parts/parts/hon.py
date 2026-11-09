# 小物：ひらいた本（表紙 R・ページ W・字の線 K）。cx, cy は本のまん中。tilt＝手前へのかたむき。
from lib import *


def draw(cx, cy, w=8, h=5, cover='R', tilt=1.5):
    L = poly([(cx - w - .5, cy - h + tilt), (cx + .5, cy - h + 1 + tilt), (cx + .5, cy + h + 1), (cx - w - .5, cy + h)])
    R = poly([(cx + .5, cy - h + 1 + tilt), (cx + w + 1.5, cy - h - .5 + tilt), (cx + w + 1.5, cy + h - .5), (cx + .5, cy + h + 1)])
    cov = poly([(cx - w - 2, cy - h + tilt + 1), (cx + .5, cy - h + 2 + tilt), (cx + w + 3, cy - h + .5 + tilt),
                (cx + w + 3, cy + h + 1.5), (cx + .5, cy + h + 3.2), (cx - w - 2, cy + h + 2.2)])
    fill(cov, cover); fill(edge(cov), 'K')
    for pg, shade in ((L, 'S'), (R, None)):
        fill(pg, 'W')
        if shade: fill(cells(pg, lambda x, y: x >= cx - 1), shade)
    # 字の線
    for k in range(3):
        yy = cy - h + 3 + tilt + k * 2
        fill({(x, int(yy)) for x in range(int(cx - w + 1), int(cx - 1))}, 'K')
        fill({(x, int(yy - .5)) for x in range(int(cx + 2), int(cx + w))}, 'K')
    fill(rect(cx, cy - h + 1 + tilt, cx, cy + h + 1), 'K')
    fill(edge(L | R) - cov, 'K')
    return cov | L | R
