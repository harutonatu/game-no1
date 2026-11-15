# 場所の背景：もり（木の みきが たくさん ならぶ 深い森。空は 葉の すき間から 少し見えるだけ）。
#   場所の大きな物は 手前の 大きな木 と たおれた 丸太 の 2 つ。
# 2026-11-15 描き直し（約束 §2.6「部品の背景の描き直し」）：こうえん・はなばたけ と見分けがつくよう、全体を こい みどり（D）と
#   みきの ちゃいろ（C）にし、小さな物（きのこ・しだ・落ち葉・木もれ日）を足した。
# 2026-11-15 調整（ユーザー「難易度上がりすぎ」）：木もれ日・落ち葉と こけの 点々・葉の 点々と 木の実・みきの すじ・地面の きのこを やめ、
#   しだ・丸太の 切り口の 年輪も やめ、葉は D と G の 大きな かたまり、地面は こけの 大きな面で ぬる（きのこは 丸太の上の 2 つだけ）。
#   すき間の空は 上の はしに 大きく 3 つ。
# 色：葉 D（光 G）・すき間の空 S・奥 D（遠くの みき K）・みき C（光 O・ふち K）・地面 G（奥の ふち D）・
#   きのこ R（点 W・え W）・丸太（皮 C・光 O・すじ K・切り口 Y・ふち K）。
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
    """みき（C・光 O・ふち K）。x は 左はし、w は はば、gy は 根もと。2026-11-15 調整：木の はだの すじと 市松の光を やめた。"""
    t = rect(x, top, x + w - 1, gy)
    if near:
        t |= poly([(x - 3, gy + 1), (x, gy - 4), (x + w, gy - 4), (x + w + 3, gy + 1)])
    fill(t, 'C')
    if w >= 4:
        fill(cells(t, lambda a, b: (a + 2, b) not in t and (a + 1, b) in t), 'O')
    fill(cells(t, lambda a, b: (a - 1, b) not in t), 'K')
    if w >= 3:
        fill(cells(t, lambda a, b: (a + 1, b) not in t), 'K')
    return t


def canopy(sky):
    """上の 葉（D の かたまりに G の 光の かたまり）と、すき間の空。2026-11-15 調整：葉の 点々・木の実・すき間の ふちの 点を やめた。"""
    leaves = set(); hi = set()
    for k in range(18):
        cx = (k * 11 + 3) % 66 - 1; cy = 2 + (k * 7) % 9
        rx, ry = 4 + (k % 3), 2.4 + (k % 2)
        leaves |= ell(cx, cy, rx, ry)
        hi |= ell(cx - 1, cy - .8, rx * .6, ry * .55)
    fill(leaves, 'D'); fill(hi & leaves, 'G')
    for (gx, gy_, rx) in ((16, 0, 5), (33, 0, 4), (50, 0, 5)):
        fill(ell(gx, gy_, rx, 2.6), sky)
    return leaves


def log(x, gy):
    """たおれた 丸太（右の手前）。皮 C（光 O・すじ K）・切り口 Y・ふち K、上に きのこ。"""
    body = rect(x + 2, gy - 6, 63, gy)
    fill(body, 'C'); fill(cells(body, lambda a, b: b == gy - 6), 'O')
    fill(rect(x + 6, gy - 3, 62, gy - 3), 'K')
    end = ell(x + 2.5, gy - 2.5, 3, 3.6)
    fill(end, 'Y')
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


def draw(flip=False, sky=None, ground=None, hz=34):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    # 奥の くらい森
    base_fill(rect(0, 0, 63, hz), 'D' if sky != 'D' else 'G')
    for x in range(1, 64, 4):                                       # 遠くの ほそい みき（K）
        if hsh(x, 0, 35) < 700: fill(rect(x, 6, x, hz), 'K')
    # 地面（こけの 大きな面。奥の ふちに 1 行の かげ）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    fill(rect(0, hz + 1, 63, hz + 1), acc)
    # 中くらいの みき（奥から）
    for (x, w, gy) in ((22, 3, hz + 1), (33, 3, hz + 1), (43, 3, hz + 1), (14, 5, hz + 3), (27, 4, hz + 3), (38, 4, hz + 2), (51, 5, hz + 4)):
        trunk(x, w, gy)
    # 上の葉と すき間の空
    canopy(sky)
    # 大きな物：手前の 大きな木（左）・たおれた 丸太（右）。小さな物：丸太の上の きのこ
    trunk(0, 10, 45, top=0, near=True)
    hollow = ell(5.5, 24, 1.8, 2.6); fill(hollow, 'K')
    log(50, 46)
    if flip: mirror()
    return {"gy": 46, "floor": ground + acc, "shade": acc}
