# 場所の背景：ほしぞら（よる。あおい空・地平の近くは むらさき・月・星・おか・小道）。場所の物は 月 と 星 の 2 つ。
# draw(hz, flip) … hz＝おかの上の線。flip なら 月を右に。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def moon(cx, cy, r=5.5):
    """三日月（Y・かげ O）。"""
    m = ell(cx, cy, r, r) - ell(cx + r * .55, cy - r * .35, r * .85, r * .85)
    fill(m, 'Y'); fill(cells(m, lambda x, y: (x + 1, y) not in m or (x, y - 1) not in m), 'O')
    fill({p for p in ((int(cx - r * .5), int(cy + r * .2)), (int(cx - r * .5), int(cy + r * .2) + 1)) if p in m}, 'O')
    return m


def star(cx, cy, r=3, c='Y'):
    """大きな星（5 つのとがり）。ふちは O。"""
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36); rr = r if k % 2 == 0 else r * .45
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    m = poly(pts) | {(int(cx), int(cy))}
    fill(m, c); fill(cells(m, lambda x, y: (x, y + 1) not in m and (x - 1, y) in m), 'O')
    return m


def draw(hz=32, flip=False):
    sky_ = rect(0, 0, 63, hz + 2)
    base_fill(sky_, 'B')
    base_fill(cells(sky_, lambda x, y: y > hz - 7 and (x + y) % 2 == 0 or y > hz - 3), 'V')
    for (x, y) in sky_:
        if y < hz - 4 and (x * 7 + y * 13) % 71 == 0: deco(x, y, 'W')
        elif y < hz - 4 and (x * 11 + y * 5) % 97 == 0: deco(x, y, 'Y')
    for (x, y) in ((40, 4), (20, 9), (57, 14), (5, 21), (33, 17)):
        xx = 63 - x if flip else x
        for p in ((xx, y - 1), (xx - 1, y), (xx, y), (xx + 1, y), (xx, y + 1)): deco(p[0], p[1], 'W' if p != (xx, y) else 'Y')
    # おか（奥は D、手前の小道は C）
    hill = {(x, y) for (x, y) in ALL if y >= hz - 3 + 3 * math.sin(x / 10 + 1.3) - 2 * math.sin(x / 4.5)}
    base_fill(hill, 'D')
    fill(cells(hill, lambda x, y: (x, y - 1) not in hill), 'K')
    for (x, y) in hill:
        if (x, y - 1) in hill and (x * 5 + y * 3) % 13 == 0 and y < 40: deco(x, y, 'G')
    path = {(x, y) for (x, y) in ALL if y >= 41 + .8 * math.sin(x / 6)}
    base_fill(path, 'C')
    fill(cells(path, lambda x, y: (x, y - 1) not in path), 'K')
    for (x, y) in path:
        if (x, y - 1) in path and (x * 7 + y * 3) % 9 == 0: deco(x, y, 'O')
    # 月 と 星
    mx = 55 if flip else 9
    moon(mx, 8, 5.5)
    sx = 8 if flip else 54
    star(sx, 7, 3.6)
    return {"gy": 46, "floor": "COD", "shade": "K"}
