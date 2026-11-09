# 場所の背景：うみべ（青い空・太陽・雲・海と波・すなはま）。場所の物は パラソル と ヨット の 2 つ。
# 今の 150 枚の うみべ と同じ色：空 S・雲 W（かげ V）・太陽 Y（ふち O）・海 B（波 S・波がしら W）・すな Y（粒 O・貝がら P）。
# draw(flip, sky, ground, hz) … flip なら パラソルを右・ヨットを左に。sky＝空の色（ふだん S）、ground＝すなの色（ふだん Y。
#   粒は lib.accent の色）。hz＝すなはまの奥の線（海の手前）。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def parasol(x, gy, top=6, flip=False):
    """パラソル（ぬの R と W の しま・ふち K、ぼう W と K）。x は ぼうの x、gy は ぼうの下。"""
    s = -1 if flip else 1
    pole = line(x, top + 3, x + s * 1, gy, 2)
    fill(pole, 'W'); fill(edge(pole) - cells(pole, lambda xx, yy: yy < top + 4), 'K')
    cx, cy = x - s * 1, top + 6
    canopy = poly([(cx - 13, cy + 2), (cx - 9, cy - 3), (cx - 3, cy - 5.5), (cx + 3, cy - 5.5), (cx + 9, cy - 3), (cx + 13, cy + 2)])
    canopy |= {(xx, yy) for k in range(-13, 13, 6) for (xx, yy) in ell(cx + k + 3, cy + 2, 3.2, 1.6)}
    fill(canopy, 'W')
    fill(cells(canopy, lambda xx, yy: int((math.degrees(math.atan2(xx + .5 - cx, yy + .5 - (cy - 6))) + 90) / 22) % 2 == 0), 'R')
    fill(cells(canopy, lambda xx, yy: (xx, yy + 1) not in canopy and (xx + yy) % 2 == 0), 'O')
    fill(edge(canopy), 'K')
    fill({(int(cx), cy - 7), (int(cx), cy - 6)}, 'K')
    return pole | canopy


def yacht(x, y, flip=False):
    """ヨット（ほ W・かげ S・ふち K、ふね R・ふち K、旗 Y）。x, y は ふねの まん中。"""
    s = -1 if flip else 1
    hull = poly([(x - 6, y - 1), (x + 6, y - 1), (x + 4, y + 2), (x - 4, y + 2)])
    fill(hull, 'R'); fill(cells(hull, lambda xx, yy: yy == y - 1), 'W'); fill(edge(hull) - cells(hull, lambda xx, yy: yy == y - 1), 'K')
    mast = rect(x, y - 11, x, y - 1); fill(mast, 'K')
    sail = poly([(x + s * 1.5, y - 11), (x + s * 1.5, y - 2), (x + s * 8, y - 2)])
    sail2 = poly([(x - s * .5, y - 9), (x - s * .5, y - 2), (x - s * 5, y - 2)])
    for m in (sail, sail2):
        fill(m, 'W'); fill(cells(m, lambda xx, yy: (xx, yy + 1) not in m), 'S'); fill(edge(m), 'K')
    fill({(x, y - 12), (x + s, y - 12), (x + s, y - 11)}, 'Y')
    return hull | mast | sail | sail2


def draw(flip=False, sky=None, ground=None, hz=29):
    sky = sky or 'S'; ground = ground or 'Y'; acc = accent(ground)
    sea_c, wave = ('S', 'W') if sky == 'B' else ('B', 'S')
    cloud_c = 'S' if sky == 'W' else 'W'
    sea_top = hz - 8
    base_fill(rect(0, 0, 63, sea_top - 1), sky)
    sun(57 if not flip else 6, 4, 3, 'Y', 'O')
    for (cx, cy, w) in ((36, 4, 5), (46, 11, 4), (22, 13, 3)):
        cloud(63 - cx if flip else cx, cy, w, cloud_c, 'V')
    # 海（奥ほど こい。波の線と 波がしら）
    sea = rect(0, sea_top, 63, hz)
    base_fill(sea, sea_c)
    fill(rect(0, sea_top, 63, sea_top), 'K' if sky != 'K' else 'V')
    for (x, y) in sea:
        if y == sea_top: continue
        k = (x + y * 5 + (y // 2) * 3) % 9
        if k in (0, 1, 2) and y > sea_top + 1: deco(x, y, wave)
        elif k == 3 and hsh(x, y, 2) < 500: deco(x, y, 'W')
    # すなはま（波うちぎわは 白い あわ）
    sand = rect(0, hz + 1, 63, 47)
    base_fill(sand, ground)
    for x in range(64):
        yy = hz + 1 + (1 if math.sin(x / 3.2) > .3 else 0)
        for y in range(hz + 1, yy + 1): deco(x, y, 'W')
    for (x, y) in sand:
        if y < hz + 3: continue
        v = hsh(x, y, 4)
        if v < 70: deco(x, y, acc)
        elif v < 74 and y > hz + 6: deco(x, y, 'P'); deco(x + 1, y, 'W')
    # パラソル と ヨット
    parasol(9 if not flip else 54, hz + 10, 3, flip)
    yacht(52 if not flip else 11, sea_top + 4, flip)
    return {"gy": 46, "floor": ground + acc + "WP", "shade": acc}
