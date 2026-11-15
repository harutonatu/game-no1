# 場所の背景：はなばたけ（青い空・低い地平線・チューリップの色の帯が 手前まで ならぶ）。場所の大きな物は 風車 の 1 つ。
# 2026-11-15 描き直し（約束 §2.6「部品の背景の描き直し」）：こうえん・もり と見分けがつくよう、地面を チューリップの列
#   （赤・黄・ピンク・白・むらさき の帯）でうめ、風車と小さな物（木のさく・ちょうちょ）を足した。
# 2026-11-15 調整（ユーザー「難易度上がりすぎ」）：チューリップの細かい模様をやめ、太い色の帯 4 本（むらさき・黄・ピンク・赤）に。
#   帯の あいだは くきの色の 大きな面。風車は ふち K・まど・格子・かげを やめて 太い 1 色の 面に（はね W・ほね K・塔 O・やね R・とびら K）。
#   木のさく・ちょうちょ・太陽の ふちと 光の点・雲の かげ・丘の 光と、帯の 花の まん中の きざみを やめた。太陽は 上の はしに 大きく。
# 色：空 S・雲 W・太陽 Y・遠くの丘 D・はと くき G・チューリップの帯 V Y P R・
#   風車（かべ O・やね R・とびら と じく K・はね W・ほね K）。
# draw(flip, sky, ground, hz) … flip なら 左右が入れかわる（風車が左）。sky＝空の色（ふだん S）、
#   ground＝はと くきの色（ふだん G。かげは lib.accent の色）。hz＝地平線（低め）。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *
import lib


def mirror():
    """描いた背景を まるごと 左右ぎゃくに（地の色・模様の印も いっしょに）。"""
    for r in lib.g: r.reverse()
    for r in lib.base: r.reverse()
    d = {(W - 1 - x, y) for (x, y) in lib.decos}
    lib.decos.clear(); lib.decos.update(d)


def windmill(x, gy, hub_y=11):
    """風車（右）。かべ O（左の かげ C）・やね R・とびら C・はね W（ほね C）・じく K。x は まん中。
    2026-11-15 調整：ふち K・まど・板の すじ・やねの 光を やめ、太い 1 色の 面で 描く。"""
    blades = set(); spars = set()
    for ang in (35, 125, 215, 305):
        a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
        spars |= line(x, hub_y, x + ca * 15, hub_y + sa * 15)
        bl = set()
        for k in range(3, 16):
            for w in range(1, 5):
                for (u, v) in ((k, w), (k + .5, w), (k, w + .5)):
                    bl.add((int(math.floor(x + .5 + ca * u - sa * v)), int(math.floor(hub_y + .5 + sa * u + ca * v))))
        blades |= {p for p in bl if p in ALL}
    fill(blades, 'W')
    fill(spars, 'K')
    tower = poly([(x - 4, hub_y + 1), (x + 4, hub_y + 1), (x + 7, gy + 1), (x - 7, gy + 1)])
    fill(tower, 'O')
    door = rect(x - 1, gy - 5, x + 1, gy); fill(door, 'K')
    roof = poly([(x - 6, hub_y + 2), (x + 6, hub_y + 2), (x + 3, hub_y - 4), (x - 3, hub_y - 4)]) | ell(x, hub_y - 4, 3, 2)
    fill(roof, 'R')
    hub = ell(x + .5, hub_y + .5, 1.6, 1.6); fill(hub, 'K')
    return tower | roof | blades


def sun_(cx, cy, r, c, rim):
    """太陽（まる c・ふち rim。光の点は 描かない）。"""
    m = ell(cx, cy, r, r); fill(m, c); fill(edge(m), rim)
    return m


def cloud_(cx, cy, w, c, shade):
    """雲（下の 1 行を まとめて かげ）。"""
    m = ell(cx, cy, w, 1.6) | ell(cx - w * .4, cy - 1, w * .6, 1.5) | ell(cx + w * .4, cy - 1.2, w * .5, 1.4)
    fill(m, c); fill(cells(m, lambda x, y: (x, y + 1) not in m), shade)
    return m


def draw(flip=False, sky=None, ground=None, hz=21):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    base_fill(rect(0, 0, 63, hz), sky)
    sun_(5, 2, 4, 'Y', 'Y')
    for (cx, cy, w) in ((22, 3, 4), (33, 8, 3)):
        cloud_(cx, cy, w, 'W' if sky != 'W' else 'S', 'W' if sky != 'W' else 'S')
    # 遠くの 低い丘（こいみどり 1 色）
    hill = {(x, y) for (x, y) in rect(0, hz - 4, 63, hz) if y >= hz - 1.5 - 1.8 * math.sin(x / 8 + 1)}
    far = 'D' if ground != 'D' else 'G'
    fill(hill, far)
    # チューリップの 太い 色の帯（4 本。上の ふちに 花と 花の あいだの きざみ。帯の あいだは くきの色の 大きな面）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    cols = [('O' if c == ground else c) for c in ('V', 'Y', 'P', 'R')]
    bands = ((hz + 2, hz + 4), (hz + 7, hz + 10), (hz + 13, hz + 17), (hz + 20, 47))
    for i, ((top, bot), c) in enumerate(zip(bands, cols)):
        cw = 3 + i // 2                                             # 花の はば（手前ほど 太い）
        band = rect(0, top, 63, bot)
        for x0 in range(-(i % 2) * 2, 64, cw + 1):
            band -= {(x0 + cw, top), (x0 + cw, top + 1)}               # 花と 花の あいだ（2 行）
        for (xx, yy) in band: deco(xx, yy, c)
    # 大きな物：風車（右）
    windmill(53, hz + 6)
    if flip: mirror()
    return {"gy": 46, "floor": ground + acc + ''.join(cols), "shade": acc}
