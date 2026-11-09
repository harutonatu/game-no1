# 場所の背景：ゆきやま（青い空・ふる雪・遠くの雪山・雪の原）。場所の物は もみの木 と ゆきだるま の 2 つ。
# 今の 150 枚の ゆきやま と同じ色：空 S・雲 W（かげ V）・雪山 W（かげ S・岩 V）・雪の原 W（かげの粒 S・V）・もみの木 G（雪 W）。
#   しろい主役（うさぎ・いぬ・ぱんだ）のときは ground='S' で 雪の原を みずいろに（粒は W）。
# draw(flip, sky, ground, hz) … flip なら もみの木を右・ゆきだるまを左に。sky＝空の色（ふだん S）、ground＝雪の原の色
#   （ふだん W。粒は lib.accent の色）。hz＝雪の原の奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def fir(x, gy, h=26):
    """もみの木（葉 G・かげ D・つもった雪 W・ふち K、みき C）。x は まん中、gy は根もと。"""
    trunk = rect(x - 1, gy - 4, x + 1, gy); shape(trunk, 'C')
    m = set(); tiers = 4
    for i in range(tiers):
        ty = gy - h + i * (h - 4) / tiers
        hw = 3 + i * 2.6
        m |= poly([(x + .5, ty - 1), (x + hw + 1, ty + (h - 4) / tiers + 2.5), (x - hw, ty + (h - 4) / tiers + 2.5)])
    fill(m, 'G')
    fill(cells(m, lambda xx, yy: xx < x - 1 and (xx + yy) % 2 == 0 or (xx, yy + 1) not in m), 'D')
    fill(cells(m, lambda xx, yy: (xx, yy - 1) not in m and xx > x - 4) | cells(m, lambda xx, yy: (xx, yy - 1) not in m and (xx, yy - 2) not in m and xx >= x), 'W')
    fill(edge(m), 'K')
    return m | trunk


def snowman(x, gy, flip=False):
    """ゆきだるま（からだ W・かげ S・ふち K、ぼうし R、はな O、目 K、うで C）。"""
    s = -1 if flip else 1
    lo = ell(x, gy - 5, 6, 5); hi_ = ell(x, gy - 13, 4.5, 4)
    for m in (lo, hi_):
        shape(m, 'W', sh='S', sw=1)
    fill(edge(lo | hi_) - (lo & hi_), 'K'); fill(edge(hi_) & lo, 'K')
    hat = rect(x - 3, gy - 20, x + 2, gy - 17) | rect(x - 4, gy - 17, x + 3, gy - 16)
    fill(hat, 'R'); fill(edge(hat), 'K')
    put(x - 1 + s, gy - 14, 'K'); put(x + 1 + s, gy - 14, 'K')
    fill({(x + 2 * s, gy - 12), (x + 3 * s, gy - 12), (x + 4 * s, gy - 12)}, 'O')
    for side in (-1, 1):
        fill(line(x + side * 5, gy - 8, x + side * 9, gy - 12), 'C')
    for yy in (gy - 7, gy - 4):
        put(x, yy, 'K')
    return lo | hi_ | hat


def draw(flip=False, sky=None, ground=None, hz=27):
    sky = sky or 'S'; ground = ground or 'W'; acc = accent(ground)
    snow_c = 'W' if sky != 'W' else 'S'
    base_fill(rect(0, 0, 63, hz), sky)
    for (cx, cy, w) in ((34, 3, 5), (12, 8, 4)):
        cloud(63 - cx if flip else cx, cy, w, snow_c, 'V')
    # 遠くの雪山（雪 W・かげ S、下は 岩 V）
    for (px, top, w) in ((8, hz - 13, 16), (28, hz - 10, 14), (46, hz - 15, 18), (63, hz - 9, 12)):
        px = 63 - px if flip else px
        m = poly([(px, top), (px + w / 2, hz + 1), (px - w / 2, hz + 1)])
        snow = 'W' if sky != 'W' else 'S'
        fill(m, snow)
        fill(cells(m, lambda x, y: x > px), 'S' if snow == 'W' else 'B')
        fill(cells(m, lambda x, y: y > top + (hz - top) * .62 + 1.5 * math.sin(x * 1.3)), 'V')
        fill(cells(m, lambda x, y: y <= hz and ((x, y - 1) not in m or (x - 1, y) not in m or (x + 1, y) not in m)), 'K')
    # ふる雪（空の模様）
    for (x, y) in rect(0, 0, 63, hz - 1):
        if at(x, y) == sky and hsh(x, y, 5) < 28: deco(x, y, snow_c)
    # 雪の原
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    fill(rect(0, hz + 1, 63, hz + 1), acc)
    for (x, y) in gr:
        if y < hz + 3: continue
        v = hsh(x, y, 6)
        if v < 50: deco(x, y, acc)
        elif v < 54: deco(x, y, 'V')
        elif v < 66: deco(x, y, acc); deco(x + 1, y, acc); deco(x + 2, y, acc)
    # もみの木 と ゆきだるま
    fir(7 if not flip else 56, hz + 8, 30)
    snowman(55 if not flip else 8, hz + 11, not flip)
    return {"gy": 46, "floor": ground + acc + "V", "shade": acc if acc != 'W' else 'S'}
