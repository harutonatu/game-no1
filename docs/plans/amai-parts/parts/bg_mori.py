# 場所の背景：もり（木の間の 青い空・奥の木立・こけの地面）。場所の物は 大きな木 と きのこ の 2 つ。
# 今の 150 枚の もり と同じ色：空 S・雲 W（かげ V）・奥の木立と丘 D（光 G）・地面 G（かげ D・木もれ日 Y・落ち葉 O）・
#   みき C（光 O）・きのこ R（白い点 W）。
# draw(flip, sky, ground, hz) … flip なら 大きな木を右・きのこを左に。sky＝空の色（ふだん S）、ground＝地面の色（ふだん G。
#   かげは lib.accent の色）。hz＝地面の奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def big_tree(x, gy):
    """大きな木（太い みき C・光 O・木の あな K・根 C、上は 葉 G・かげ D・光 Y が 絵の上まで）。x は みきの まん中。"""
    trunk = rect(x - 4, 8, x + 4, gy) | poly([(x - 8, gy + 1), (x - 4, gy - 5), (x + 4, gy - 5), (x + 8, gy + 1)])
    shape(trunk, 'C', hi='O', hw=1)
    fill(cells(trunk, lambda xx, yy: (xx - x) % 3 == 0 and abs(xx - x) < 4 and hsh(xx, yy, 7) < 400 and yy > 12), 'K')
    hole = ell(x + .5, gy - 13, 1.8, 2.4); fill(hole, 'K')
    crown = ell(x, 2, 15, 8) | ell(x - 10, 7, 8, 5) | ell(x + 10, 7.5, 8, 5)
    fill(crown, 'G')
    fill(cells(crown, lambda xx, yy: (xx, yy + 2) not in crown or ((xx, yy + 3) not in crown and (xx + yy) % 2 == 0)), 'D')
    fill(cells(crown, lambda xx, yy: hsh(xx, yy, 8) < 120 and (xx, yy + 3) in crown and (xx - 1, yy) in crown), 'Y')
    fill(cells(edge(crown), lambda xx, yy: yy > 0), 'K')
    return trunk | crown


def mushroom(x, gy, s=1):
    """きのこ 2 本（かさ R・白い点 W・ふち K、え W・かげ S）。"""
    out = set()
    for (dx, h, r) in ((0, 8, 5), (s * 7, 5, 3.4)):
        cx = x + dx
        stem = rect(cx - 1, gy - h + 1, cx + 1, gy); shape(stem, 'W', sh='S', sw=1)
        cap = ell(cx, gy - h, r, r * .75) & rect(cx - 7, gy - h - 7, cx + 7, gy - h + 1)
        fill(cap, 'R')
        fill(cells(cap, lambda xx, yy: hsh(xx, yy, 9) < 260 and (xx, yy + 1) in cap and (xx, yy - 1) in cap), 'W')
        fill(edge(cap), 'K')
        out |= stem | cap
    return out


def draw(flip=False, sky=None, ground=None, hz=28):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    far, far_hi = ('D', 'G') if ground != 'D' else ('G', 'Y')
    base_fill(rect(0, 0, 63, hz), sky)
    for (cx, cy, w) in ((36, 4, 4), (52, 10, 4)):
        cloud(63 - cx if flip else cx, cy, w, 'W' if sky != 'W' else 'S', 'V')
    # 奥の木立（こいみどりの まるい木と みき）
    for (tx, ty, r) in ((20, hz - 9, 5), (31, hz - 12, 6), (43, hz - 8, 5), (55, hz - 11, 6), (63, hz - 7, 4)):
        tx = 63 - tx if flip else tx
        fill(rect(tx, ty + r - 1, tx, hz), 'C')
        t = ell(tx, ty, r, r * .9) | ell(tx - r * .6, ty + r * .5, r * .6, r * .5) | ell(tx + r * .6, ty + r * .5, r * .6, r * .5)
        fill(t, far); fill(cells(t, lambda x, y: (x, y - 1) not in t or ((x, y - 2) not in t and (x + y) % 2 == 0)), far_hi)
    hill = {(x, y) for (x, y) in rect(0, hz - 4, 63, hz) if y >= hz - 2 - 1.5 * math.sin(x / 5 + 2)}
    fill(hill, far)
    # 地面（こけ）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    fill(rect(0, hz + 1, 63, hz + 1), acc)
    for (x, y) in gr:
        if y < hz + 2: continue
        v = hsh(x, y, 10)
        if v < 80: deco(x, y, acc)
        elif v < 110: deco(x, y, 'Y')
        elif v < 135: deco(x, y, 'O')
    # 大きな木 と きのこ
    big_tree(7 if not flip else 56, hz + 7)
    mushroom(54 if not flip else 9, hz + 12, 1 if not flip else -1)
    return {"gy": 46, "floor": ground + acc + "YO", "shade": acc}
