# 場所の背景：だいどころ（タイルの かべ・こしいた・板の ゆか）。場所の物は まど と だな（なべ つき）の 2 つ。
# 今の 150 枚の だいどころ と同じ色：かべ W（目地 S・小さな花 V と Y）・こしいた O（つぎめ C）・ゆか Y（板の目地 O）。
#   しろい主役（うさぎ・いぬ・ぱんだ）のときは sky='S' で かべを みずいろのタイル（しろい目地）に（今の 150 枚と同じ）。
# draw(flip, sky, ground, hz) … flip なら まどを右・だなを左に。sky＝かべの色（ふだん W）、ground＝ゆかの色（ふだん Y。
#   板の目地は lib.accent の色）。hz＝ゆかの奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def window(x0, y0, x1, y1):
    """まど（そとは 青い空と雲、わく C・光 O、カーテン P・かげ V）。"""
    pane = rect(x0, y0, x1, y1)
    fill(pane, 'S')
    fill(ell(x0 + (x1 - x0) * .35, y0 + 4, 3, 1.2) | ell(x0 + (x1 - x0) * .35 + 2, y0 + 3.2, 2, 1), 'W')
    frame = edge(pane) | cells(pane, lambda x, y: x == (x0 + x1) // 2 or y == (y0 + y1) // 2)
    fill(frame, 'C'); fill(cells(frame, lambda x, y: y == y0 or x == x0), 'O')
    out = edge(rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1)); fill(out, 'K')
    sill = rect(x0 - 2, y1 + 2, x1 + 2, y1 + 4); shape(sill, 'O', sh='C', sw=1)
    for side in (-1, 1):
        cx = x0 if side < 0 else x1
        cur = poly([(cx + side * 1.5, y0 - 1.5), (cx - side * 4, y0 - 1.5), (cx - side * 1.5, y1 + 1.5), (cx + side * 1.5, y1 + 1.5)])
        fill(cur, 'P'); fill(cells(cur, lambda x, y: (x + y) % 3 == 0 and (x, y - 1) in cur), 'V'); fill(edge(cur), 'K')
    rod = rect(x0 - 3, y0 - 2, x1 + 3, y0 - 2); fill(rod, 'K')
    return pane | sill


def shelf(x0, x1, top, gy):
    """だな（戸 C・光 O・とって Y、上に なべ R と ふた）。x0〜x1 が はば、gy は あしの下。"""
    body = rect(x0, top, x1, gy - 1)
    shape(body, 'C', hi='O', hw=1)
    mid = (x0 + x1) // 2
    for (a, b) in ((x0 + 1, mid - 1), (mid + 1, x1 - 1)):
        d = rect(a, top + 3, b, gy - 3); fill(edge(d), 'K')
        put(mid - 2 if a < mid else mid + 2, top + 7, 'Y'); put(mid - 2 if a < mid else mid + 2, top + 8, 'Y')
    tp = rect(x0 - 1, top, x1 + 1, top + 1); fill(tp, 'O'); fill(edge(tp), 'K')
    fill(rect(x0, top + 2, x1, top + 2), 'K')
    pot = ell(mid, top - 3, 5, 3.2) & rect(x0, top - 6, x1, top - 1)
    fill(pot, 'R'); fill(cells(pot, lambda x, y: (x, y - 1) not in pot), 'O'); fill(edge(pot), 'K')
    lid = ell(mid, top - 5.5, 4.2, 1.3); fill(lid, 'W'); fill(edge(lid), 'K'); fill({(mid, top - 7), (mid - 1, top - 7)}, 'K')
    for hx in (mid - 6, mid + 5):
        put(hx, top - 4, 'K')
    return body | pot | lid


def draw(flip=False, sky=None, ground=None, hz=31):
    wall = sky or 'W'; ground = ground or 'Y'; acc = accent(ground)
    grout = accent(wall)
    wain = hz - 7
    base_fill(rect(0, 0, 63, wain - 1), wall)
    for (x, y) in rect(0, 0, 63, wain - 1):
        if y % 5 == 4 or (x + (y // 5 % 2) * 3) % 6 == 5: deco(x, y, grout)
    for ty in range(0, wain, 5):   # タイルの小さな花（3 枚に 1 枚）
        for tx in range(0, 64, 6):
            if (tx // 6 + ty // 5) % 3 == 0:
                cx, cy = tx - (ty // 5 % 2) * 3 + 2, ty + 1
                for dx, dy in ((-1, 0), (1, 0), (0, 1)): deco(cx + dx, cy + dy, 'V')
                deco(cx, cy, 'Y')
    # こしいた（O に C の つぎめ。上に C の 見切り）
    wb = rect(0, wain, 63, hz)
    base_fill(wb, 'O' if ground != 'O' else 'C')
    for (x, y) in wb:
        if y == wain or x % 4 == 3: deco(x, y, 'C' if ground != 'O' else 'K')
    fill(rect(0, hz, 63, hz), 'K')
    # ゆか（板の目地）
    fl = rect(0, hz + 1, 63, 47)
    base_fill(fl, ground)
    for (x, y) in fl:
        k = y - hz - 1
        if k % 3 == 2 or (x + (k // 3) * 7) % 13 == 0: deco(x, y, acc)
    # まど と だな
    if not flip:
        window(5, 4, 18, 14); shelf(48, 61, hz - 10, hz + 3)
    else:
        window(45, 4, 58, 14); shelf(2, 15, hz - 10, hz + 3)
    return {"gy": 46, "floor": ground + acc, "shade": acc}
