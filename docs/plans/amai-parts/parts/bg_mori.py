# 場所の背景：もり（木の みきが たくさん ならぶ 深い森。空は 葉の すき間から 少し見えるだけ）。
#   場所の大きな物は 手前の 大きな木 と たおれた 丸太 の 2 つ。
# 2026-11-15 描き直し（約束 §2.6「部品の背景の描き直し」）：こうえん・はなばたけ と見分けがつくよう、全体を こい みどり（D）と
#   みきの ちゃいろ（C）にし、小さな物（きのこ・しだ・落ち葉・木もれ日）を足した。
# 色：葉 D（光 G・木の実 Y）・すき間の空 S・奥 D（遠くの みき K）・みき C（光 O・ふち K）・地面 G（こけ D・落ち葉 O R Y・木もれ日 Y）・
#   しだ D と G・きのこ R（点 W・え W）・丸太（皮 C・切り口 Y と O の年輪）。
# draw(flip, sky, ground, hz) … flip なら 左右が入れかわる（大きな木が右・丸太が左）。sky＝すき間の空の色（ふだん S）、
#   ground＝地面の色（ふだん G。こけは lib.accent の色）。hz＝地面の奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *
import lib


def mirror():
    """描いた背景を まるごと 左右ぎゃくに（地の色・模様の印も いっしょに）。"""
    for r in lib.g: r.reverse()
    for r in lib.base: r.reverse()
    d = {(W - 1 - x, y) for (x, y) in lib.decos}
    lib.decos.clear(); lib.decos.update(d)


def trunk(x, w, gy, top=0, near=False):
    """みき（C・光 O・ふち K、木の はだの すじ K）。x は 左はし、w は はば、gy は 根もと。"""
    t = rect(x, top, x + w - 1, gy)
    if near:
        t |= poly([(x - 3, gy + 1), (x, gy - 4), (x + w, gy - 4), (x + w + 3, gy + 1)])
    fill(t, 'C')
    fill(cells(t, lambda a, b: ((a + 2, b) not in t and (a + 1, b) in t and (near or (a + b) % 2 == 0))
               or (w >= 6 and (a + 3, b) not in t and (a + 2, b) in t and (a + b) % 2 == 0)), 'O')
    if w >= 4:                                                      # 木の はだの すじ
        fill(cells(t, lambda a, b: (a - x) % 3 == 1 and (a + 2, b) in t and (b // 2 + a * 3) % 5 == 0), 'K')
    fill(cells(t, lambda a, b: (a - 1, b) not in t), 'K')
    if w >= 3:
        fill(cells(t, lambda a, b: (a + 1, b) not in t), 'K')
    return t


def canopy(sky):
    """上の 葉（D に G の かたまり・Y の木の実）と、すき間の空。"""
    leaves = set()
    for k in range(18):
        cx = (k * 11 + 3) % 66 - 1; cy = 2 + (k * 7) % 9
        leaves |= ell(cx, cy, 4 + (k % 3), 2.4 + (k % 2))
    for (x, y) in leaves:
        if hsh(x, y, 32) < 330: put(x, y, 'G')
    fill(cells(leaves, lambda x, y: (x, y + 1) not in leaves and (x + y) % 2 == 0), 'K')
    for (x, y) in leaves:
        if hsh(x, y, 33) < 18: put(x, y, 'Y')
    # すき間の空（小さな まど）
    for (gx, gy_, rx) in ((14, 1, 2.5), (27, 3, 2), (40, 1, 3), (52, 4, 2)):
        hole = ell(gx, gy_, rx, 1.4)
        fill(hole, sky)
        fill(cells(hole, lambda x, y: (x + y) % 2 == 0 and ((x - 1, y) not in hole or (x + 1, y) not in hole)), 'G')
    return leaves


def log(x, gy):
    """たおれた 丸太（右の手前）。皮 C（光 O・すじ K）・切り口 Y（年輪 O）・ふち K、上に きのこ。"""
    body = rect(x + 2, gy - 6, 63, gy)
    fill(body, 'C'); fill(cells(body, lambda a, b: b == gy - 6 or (b == gy - 5 and a % 2 == 0)), 'O')
    fill(cells(body, lambda a, b: b in (gy - 3, gy - 1) and hsh(a, b, 34) < 450), 'K')
    end = ell(x + 2.5, gy - 2.5, 3, 3.6)
    fill(end, 'Y')
    fill(cells(end, lambda a, b: abs(math.hypot(a + .5 - x - 2.5, (b + .5 - gy + 2.5) * .83) - 1.6) < .5), 'O')
    put(x + 2, gy - 3, 'C')
    fill(edge(body | end) - cells(body, lambda a, b: a == 63), 'K')
    for (mx, h) in ((x + 9, 3), (x + 13, 2)):
        mushroom(mx, gy - 7, h)
    return body | end


def mushroom(x, gy, h=2):
    """小さな きのこ（かさ R・点 W・ふち K、え W）。"""
    fill(rect(x, gy - h + 1, x, gy), 'W')
    cap = rect(x - 2, gy - h - 1, x + 2, gy - h) - {(x - 2, gy - h - 1), (x + 2, gy - h - 1)}
    fill(cap, 'R'); put(x, gy - h - 1, 'W')
    fill(cells(cap, lambda a, b: b == gy - h and a in (x - 2, x + 2)), 'K')
    fill({(x - 1, gy - h - 2), (x, gy - h - 2), (x + 1, gy - h - 2)}, 'K')


def fern(x, gy, c='D', hi='G'):
    """しだ（まん中の じく と、左右へ ななめ上に のびる 葉。先は hi）。"""
    for y in range(gy - 6, gy + 1): deco(x, y, c)
    for (k, n) in ((0, 4), (2, 3), (4, 2)):
        for s_ in (-1, 1):
            pts = line(x, gy - k, x + s_ * n, gy - k - 2)
            for (px, py) in pts: deco(px, py, c)
            deco(x + s_ * n, gy - k - 2, hi)
    deco(x, gy - 7, hi)


def draw(flip=False, sky=None, ground=None, hz=34):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    # 奥の くらい森
    base_fill(rect(0, 0, 63, hz), 'D' if sky != 'D' else 'G')
    for x in range(1, 64, 4):                                       # 遠くの ほそい みき（K）
        if hsh(x, 0, 35) < 700: fill(rect(x, 6, x, hz), 'K')
    # 地面
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    fill(rect(0, hz + 1, 63, hz + 1), acc)
    for (x, y) in gr:
        if y < hz + 2: continue
        v = hsh(x, y, 36)
        if v < 110: deco(x, y, acc)
        elif v < 135: deco(x, y, 'O' if ground != 'O' else 'C')
        elif v < 150: deco(x, y, 'R' if ground != 'R' else 'O')
        elif v < 162: deco(x, y, 'Y' if ground != 'Y' else 'O')
    # 中くらいの みき（奥から）
    for (x, w, gy) in ((22, 3, hz + 1), (33, 3, hz + 1), (43, 3, hz + 1), (14, 5, hz + 3), (27, 4, hz + 3), (38, 4, hz + 2), (51, 5, hz + 4)):
        trunk(x, w, gy)
    # 上の葉と すき間の空
    canopy(sky)
    # 木もれ日（すき間から ななめの 光の すじ、地面に 光の まる）
    for (sx, ex) in ((27, 34), (40, 48)):
        for y in range(6, hz + 1, 2):
            x = int(round(sx + (ex - sx) * (y - 6) / (hz - 6)))
            if lib.g[y][x] in ('D', 'G') and y % 4 == 2: deco(x, y, 'Y' if sky != 'Y' else 'W')
        for (x, y) in ell(ex, hz + 4, 3.5, 1.2):
            if (x + y) % 2 == 0: deco(x, y, 'Y' if ground != 'Y' else 'W')
    # 大きな物：手前の 大きな木（左）・たおれた 丸太（右）。小さな物：しだ・きのこ
    trunk(0, 10, 45, top=0, near=True)
    hollow = ell(5.5, 24, 1.8, 2.6); fill(hollow, 'K')
    log(50, 46)
    fern(15, 45, acc, 'G' if ground != 'G' else 'Y'); fern(46, 46, acc, 'G' if ground != 'G' else 'Y')
    mushroom(12, 46, 3); mushroom(16, 47, 2); mushroom(57, 38, 1)
    if flip: mirror()
    return {"gy": 46, "floor": ground + acc + "ORYW", "shade": acc}
