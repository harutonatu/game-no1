# 場所の背景：こうえん（青い空・太陽・雲・遠くの丘と木立・しばふ）。場所の物は 大きな木 と ベンチ の 2 つ。
# 今の 150 枚の こうえん（amai-redraw・amai-bg）と同じ色：空 S・雲 W（かげ V）・太陽 Y（ふち O）・丘 D・しばふ G（草 D・花 P）。
# draw(flip, sky, ground, hz) … flip なら 木を右・ベンチを左に。sky＝空の色（ふだん S）、ground＝しばふの色（ふだん G。
#   草の模様は lib.accent の色）。hz＝しばふの奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def tree(x, gy, top=2):
    """大きな木（みき C・光 O・ふち K、葉 G・かげ D・光 Y）。x はみきのまん中、gy は根もと。"""
    trunk = rect(x - 2, top + 12, x + 2, gy) | poly([(x - 4.5, gy + 1), (x - 2, gy - 3), (x + 3, gy - 3), (x + 5.5, gy + 1)])
    shape(trunk, 'C', sh=None, hi='O', hw=1)
    fill(cells(trunk, lambda xx, yy: xx == x and (yy * 3) % 7 == 0 and yy < gy - 2), 'K')
    crown = (ell(x, top + 7, 9, 6.5) | ell(x - 6, top + 10, 6, 4.5) | ell(x + 6, top + 10.5, 6, 4.5)
             | ell(x - 2, top + 3, 6, 4) | ell(x + 4, top + 4, 5, 3.5))
    fill(crown, 'G')
    fill(cells(crown, lambda xx, yy: (xx, yy + 2) not in crown or ((xx, yy + 3) not in crown and (xx + yy) % 2 == 0)), 'D')
    for (cx, cy) in ((x - 6, top + 9), (x + 6, top + 9.5), (x, top + 6)):   # 葉の かたまりの 下に かげの線
        fill(arc(cx, cy, 4, 2.6, 20, 160, 12) & crown, 'D')
    fill(cells(crown, lambda xx, yy: hsh(xx, yy, 3) < 110 and (xx, yy - 1) in crown and (xx, yy + 3) in crown
               and (xx - 2, yy) in crown), 'Y')
    fill(edge(crown), 'K')
    return trunk | crown


def bench(x0, x1, gy):
    """ベンチ（板 C・光 O・あし K）。x0〜x1 が はば、gy は あしの下。"""
    back = rect(x0, gy - 9, x1, gy - 8) | rect(x0, gy - 6, x1, gy - 5)
    seat = poly([(x0 - 1, gy - 3.5), (x1 + 1, gy - 3.5), (x1 + 2.5, gy - 1.5), (x0 + .5, gy - 1.5)])
    legs = set()
    for lx in (x0 + 1, x1 - 1):
        legs |= rect(lx, gy - 10, lx, gy)
    fill(legs, 'K')
    for m in (back, seat):
        fill(m, 'C'); fill(cells(m, lambda xx, yy: (xx, yy - 1) not in m), 'O'); fill(edge(m) - cells(m, lambda xx, yy: (xx, yy - 1) not in m), 'K')
    fill(cells(seat, lambda xx, yy: (xx, yy + 1) not in seat), 'K')
    return back | seat | legs


def draw(flip=False, sky=None, ground=None, hz=28):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    cloud_c = 'S' if sky == 'W' else 'W'
    base_fill(rect(0, 0, 63, hz), sky)
    sun(57 if not flip else 6, 5, 3, 'Y', 'O')
    for (cx, cy, w) in ((24, 4, 5), (40, 9, 4), (8, 14, 4)):
        cloud(63 - cx if flip else cx, cy, w, cloud_c, 'V')
    # 遠くの丘と木立（こいみどり。光は G）
    hill = {(x, y) for (x, y) in rect(0, hz - 7, 63, hz) if y >= hz - 3 - 2.5 * math.sin(x / 7 + 1) - 1.2 * math.sin(x / 2.6)}
    fill(hill, 'D' if ground != 'D' else 'G')
    for tx in (20, 33, 46):
        t = ell(tx, hz - 6, 2.6, 2.2) | ell(tx + 2, hz - 5, 2, 1.8)
        fill(t, 'D' if ground != 'D' else 'G'); fill(cells(t, lambda x, y: (x, y - 1) not in t and (x + y) % 2 == 0), 'G' if ground != 'G' else 'Y')
    # しばふ
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    fill(rect(0, hz + 1, 63, hz + 1), acc)
    for (x, y) in gr:
        if y < hz + 2: continue
        v = hsh(x, y, 1)
        if v < 45: deco(x, y, acc); deco(x - 1, y + 1, acc); deco(x + 1, y + 1, acc)
        elif v < 60: deco(x, y, 'Y')
        elif v < 66 and y < 44:
            for p in ((x, y - 1), (x - 1, y), (x + 1, y), (x, y + 1)): deco(p[0], p[1], 'P')
            deco(x, y, 'Y')
    # 大きな木 と ベンチ
    tree(8 if not flip else 55, hz + 5)
    if flip: bench(3, 14, hz + 9)
    else: bench(49, 60, hz + 9)
    return {"gy": 46, "floor": ground + acc + "YP", "shade": acc}
