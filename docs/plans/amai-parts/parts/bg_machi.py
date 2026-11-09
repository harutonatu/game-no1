# 場所の背景：まち（空・ビル・家・道・歩道）。場所の物は ビル と 家 の 2 つ。
# draw(flip, sky, ground, hz) … flip なら ビルと家の左右を入れかえる。sky＝空の色（ふだん S）、ground＝主役の立つ歩道の色
#   （ふだん O。模様は lib.accent の色）。hz＝道の奥の線（ビルと家の足もと）。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def building(x0, x1, top, gy):
    """ビル（正面 B・横 V・まど S と あかり Y）。x0〜x1 が正面、右に 3 マスの横の面。"""
    front = rect(x0, top, x1, gy)
    side = poly([(x1 + 1, top + 1.5), (x1 + 4, top - 1), (x1 + 4, gy - 1), (x1 + 1, gy + 1)])
    roof = poly([(x0, top + .5), (x0 + 3, top - 2), (x1 + 4, top - 2), (x1 + 1, top + .5)])
    fill(front, 'B'); fill(side, 'V'); fill(roof, 'S')
    for wy in range(top + 2, gy - 3, 4):
        for wx in range(x0 + 2, x1 - 1, 4):
            lit = (wx * 3 + wy * 5) % 7 < 2
            fill(rect(wx, wy, wx + 1, wy + 1), 'Y' if lit else 'S')
            put(wx, wy + 1, 'O' if lit else 'W')
    for wy in range(top + 3, gy - 3, 4):
        fill({(x1 + 2, wy), (x1 + 3, wy - 1)}, 'B')
    door = rect((x0 + x1) // 2 - 2, gy - 3, (x0 + x1) // 2 + 1, gy)
    fill(door, 'S'); fill(cells(door, lambda x, y: x == (x0 + x1) // 2), 'K')
    m = front | side | roof
    fill(edge(m), 'K'); fill(edge(front) & side, 'K')
    return m


def house(x0, x1, wall_top, gy):
    """家（かべ W・やね R・まど S・戸 C）。"""
    wall = rect(x0, wall_top, x1, gy)
    mx = (x0 + x1) / 2 + .5
    roof = poly([(x0 - 2.5, wall_top + 1), (mx, wall_top - 8), (x1 + 3.5, wall_top + 1)])
    shape(wall, 'W', sh='S', sw=1)
    fill(roof, 'R')
    fill(cells(roof, lambda x, y: (y - wall_top) % 2 == 0 and (x + y // 2) % 3 == 0), 'C')
    fill(edge(roof), 'K')
    chim = rect(x1 - 3, wall_top - 7, x1 - 1, wall_top - 3) - roof
    shape(chim, 'C')
    win = rect(x0 + 2, wall_top + 3, x0 + 6, wall_top + 7)
    fill(win, 'S'); fill(cells(win, lambda x, y: x == x0 + 4 or y == wall_top + 5), 'W'); fill(edge(win), 'K')
    put(x0 + 3, wall_top + 4, 'W')
    door = rect(x1 - 5, wall_top + 4, x1 - 2, gy)
    shape(door, 'C', hi='O', hw=1); put(x1 - 3, wall_top + 8, 'Y')
    fill(edge(wall) - roof, 'K')
    return wall | roof


def draw(flip=False, sky=None, ground=None, hz=29):
    sky = sky or 'S'; ground = ground or 'O'; acc = accent(ground)
    sky_ = rect(0, 0, 63, hz)
    base_fill(sky_, sky)
    for (cx, cy) in ((30, 4), (47, 9)):
        c = ell(cx, cy, 5, 1.6) | ell(cx - 2, cy - 1, 3, 1.5) | ell(cx + 2, cy - 1.2, 2.5, 1.4)
        fill(c, 'W'); fill(cells(c, lambda x, y: (x, y + 1) not in c and (x + y) % 2 == 0), sky)
    # 道（奥）と 歩道（手前）
    road = rect(0, hz + 1, 63, hz + 6)
    base_fill(road, 'V')
    fill(rect(0, hz + 1, 63, hz + 1), 'K')
    for x in range(1, 64, 8):
        for k in range(4): deco(x + k, hz + 4, 'W')
    for (x, y) in road:
        if y > hz + 1 and y != hz + 4 and (x * 5 + y * 3) % 11 == 0: deco(x, y, 'K')
    curb = rect(0, hz + 7, 63, hz + 7)
    fill(curb, 'K')
    walk = rect(0, hz + 8, 63, 47)
    base_fill(walk, ground)
    for (x, y) in walk:
        r = y - hz - 8
        if r % 4 == 3: deco(x, y, acc)
        elif (x + (r // 4) * 3) % 7 == 0: deco(x, y, acc)
    # ビル と 家
    bx = (3, 15) if not flip else (45, 57)
    hx = (50, 60) if not flip else (3, 13)
    building(bx[0], bx[1], 3, hz)
    house(hx[0], hx[1], hz - 13, hz)
    return {"gy": 45, "floor": ground + acc, "shade": acc}
