# 場所の背景：はなばたけ（青い空・太陽・雲・遠くの丘・一面の花）。場所の物は ひまわり と ちょうちょ の 2 つ。
# 今の 150 枚の はなばたけ と同じ色：空 S・雲 W（かげ V）・太陽 Y（ふち O）・丘 D・草 G（かげ D）・花 P R Y W V・
#   ひまわり（花びら Y・ふち O・まん中 C・くき G）・ちょうちょ（はね O と Y・ふち K）。
# draw(flip, sky, ground, hz) … flip なら ひまわりを左・ちょうちょを右に。sky＝空の色（ふだん S）、ground＝草の色（ふだん G。
#   かげは lib.accent の色）。hz＝花畑の奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def sunflower(x, gy, top=8):
    """ひまわり（花びら Y・かげ O・ふち K、まん中 C と K の点、くき と 葉 G・かげ D）。x は くきの x、gy は根もと。"""
    stem = rect(x, top + 5, x + 1, gy); fill(stem, 'G'); fill(cells(stem, lambda xx, yy: xx == x + 1), 'D')
    for (ly, s) in ((top + 15, 1), (top + 21, -1)):
        leaf = ell(x + .5 + s * 3.5, ly, 3.4, 1.6, -25 * s); fill(leaf, 'G')
        fill(cells(leaf, lambda xx, yy: (xx, yy + 1) not in leaf), 'D'); fill(edge(leaf) - stem, 'K')
    pet = set()
    for k in range(12):
        a = math.radians(k * 30)
        pet |= ell(x + .5 + 4.6 * math.cos(a), top + 5 * math.sin(a) * .95, 2.3, 1.5, k * 30)
    fill(pet, 'Y'); fill(cells(pet, lambda xx, yy: (xx, yy + 1) not in pet or (xx - 1, yy) not in pet), 'O'); fill(edge(pet), 'K')
    mid = ell(x + .5, top, 3.2, 3)
    fill(mid, 'C'); fill(cells(mid, lambda xx, yy: (xx + yy) % 2 == 0), 'K'); fill(edge(mid), 'K')
    return stem | pet | mid


def butterfly(x, y, s=1):
    """ちょうちょ（はね O と Y・もよう K・ふち K、からだ K、しょっかく K）。"""
    up = ell(x + s * 2.5, y - 1.5, 2.6, 2.2) | ell(x - s * .5, y - 2, 2.2, 2)
    lo = ell(x + s * 2, y + 1.6, 2, 1.6) | ell(x - s * 0, y + 1.6, 1.6, 1.4)
    fill(up, 'O'); fill(lo, 'Y'); fill(cells(up, lambda xx, yy: hsh(xx, yy, 11) < 300 and (xx, yy) not in edge(up)), 'Y')
    fill(edge(up | lo), 'K')
    body = rect(x + (1 if s > 0 else 0), y - 3, x + (1 if s > 0 else 0), y + 3); fill(body, 'K')
    fill({(x + s * 2, y - 4), (x + s * 3, y - 5)}, 'K')
    return up | lo | body


def draw(flip=False, sky=None, ground=None, hz=27):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    base_fill(rect(0, 0, 63, hz), sky)
    sun(6 if not flip else 57, 5, 3, 'Y', 'O')
    for (cx, cy, w) in ((28, 4, 5), (46, 9, 4), (20, 14, 3)):
        cloud(63 - cx if flip else cx, cy, w, 'W' if sky != 'W' else 'S', 'V')
    hill = {(x, y) for (x, y) in rect(0, hz - 6, 63, hz) if y >= hz - 2 - 2.5 * math.sin(x / 9 + .5) - .8 * math.sin(x / 3)}
    fill(hill, 'D' if ground != 'D' else 'G')
    fill(cells(hill, lambda x, y: (x, y - 1) not in hill and (x + y) % 2 == 0), 'G' if ground != 'D' else 'Y')
    # 一面の花（奥は小さな点、手前は 十字の花）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    cols = [c for c in 'PRYWV' if c != ground]
    for (x, y) in gr:
        v = hsh(x, y, 12)
        if y < hz + 7:
            if v < 80: deco(x, y, acc)
            elif v < 330: deco(x, y, cols[v % len(cols)])
        else:
            if v < 50: deco(x, y, acc)
            elif v < 300 and (x + 2 * y) % 5 == 0:
                c = cols[(v // 3) % len(cols)]
                for p in ((x, y - 1), (x - 1, y), (x + 1, y), (x, y + 1)): deco(p[0], p[1], c)
                deco(x, y, 'Y' if c != 'Y' else 'O')
    # ひまわり と ちょうちょ
    sunflower(57 if not flip else 6, hz + 8, 9)
    butterfly(8 if not flip else 55, 20, 1 if not flip else -1)
    return {"gy": 46, "floor": ground + acc + ''.join(cols) + 'O', "shade": acc}
