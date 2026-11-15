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

# 2026-11-15 中間に（ユーザー「アカン簡単すぎる…ちょうど中間がいい」）：v82 で やめた 書き込みのうち、ON に 書いた物だけを 戻す。
#   ON に 入れられる 名前：bladegrid bladerim towersh towerrim plank door win roofhi roofrim sun cloud hillhi notch stem bandline cuphi fence bfly
#   （名前を 足すと 細かくなり、難しくなる。決めかたは 計画書 docs/plans/amai-parts.md §20）
ON = {'bladegrid', 'fence'}


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
        bl = {p for p in bl if p in ALL}
        blades |= bl
        if 'bladerim' in ON or 'bladegrid' in ON:
            fill(bl, 'W')
            if 'bladegrid' in ON: fill(cells(bl, lambda a_, b_: (a_ + b_) % 3 == 0 or (a_ - b_) % 3 == 0), 'C')
            if 'bladerim' in ON: fill(edge(bl), 'K')
    if not ('bladerim' in ON or 'bladegrid' in ON): fill(blades, 'W')
    fill(spars, 'C' if 'bladerim' in ON else 'K')
    tower = poly([(x - 4, hub_y + 1), (x + 4, hub_y + 1), (x + 7, gy + 1), (x - 7, gy + 1)])
    fill(tower, 'O')
    if 'towersh' in ON: fill(cells(tower, lambda xx, yy: xx < x - 1 and ((xx - 1, yy) not in tower or (xx - 2, yy) not in tower or (xx + yy) % 2 == 0)), 'C')
    if 'towerrim' in ON: fill(edge(tower), 'K')
    if 'plank' in ON:
        for yy in range(hub_y + 6, gy, 5):
            fill(cells(tower, lambda a, b: b == yy and (a - 1, b) in tower and (a + 1, b) in tower), 'C')
    if 'door' in ON:
        door = rect(x - 1, gy - 5, x + 1, gy); fill(door, 'C'); fill(edge(door) - cells(door, lambda a, b: b == gy), 'K')
    else:
        door = rect(x - 1, gy - 5, x + 1, gy); fill(door, 'K')
    if 'win' in ON:
        win = rect(x - 2, hub_y + 6, x + 2, hub_y + 9); fill(win, 'B'); fill(edge(win), 'K'); fill(rect(x, hub_y + 6, x, hub_y + 9), 'K')
    roof = poly([(x - 6, hub_y + 2), (x + 6, hub_y + 2), (x + 3, hub_y - 4), (x - 3, hub_y - 4)]) | ell(x, hub_y - 4, 3, 2)
    fill(roof, 'R')
    if 'roofhi' in ON: fill(cells(roof, lambda a, b: (a + 1, b) not in roof or (a, b - 1) not in roof), 'O')
    if 'roofrim' in ON: fill(edge(roof), 'K')
    if 'bladerim' in ON: fill(spars & ell(x, hub_y, 4, 4), 'C')
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


def fence(x0, x1, gy):
    """木のさく（くい C・光 O・ふち K、よこ木 2 本）。"""
    out = set()
    for y in (gy - 4, gy - 2):
        bar = rect(x0, y, x1, y); fill(bar, 'C'); out |= bar
    for px in range(x0, x1 + 1, 3):
        post = rect(px, gy - 6, px + 1, gy)
        fill(post, 'O'); fill(cells(post, lambda a, b: a == px + 1), 'C'); put(px, gy - 6, 'K'); put(px + 1, gy - 6, 'K')
        out |= post
    fill(cells(out, lambda a, b: (a, b + 1) not in out), 'K')
    return out


def butterfly(x, y, c='Y'):
    """小さな ちょうちょ（はね c・からだ K）。"""
    fill({(x - 1, y - 1), (x + 1, y - 1), (x - 1, y), (x + 1, y)}, c)
    fill({(x, y - 1), (x, y)}, 'K')


def draw(flip=False, sky=None, ground=None, hz=21):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    base_fill(rect(0, 0, 63, hz), sky)
    if 'sun' in ON: sun(6, 4, 3, 'Y', 'O')
    else: sun_(5, 2, 4, 'Y', 'Y')
    for (cx, cy, w) in ((22, 3, 4), (33, 8, 3)):
        if 'cloud' in ON: cloud(cx, cy, w, 'W' if sky != 'W' else 'S', 'V')
        else: cloud_(cx, cy, w, 'W' if sky != 'W' else 'S', 'W' if sky != 'W' else 'S')
    # 遠くの 低い丘（こいみどり 1 色）
    hill = {(x, y) for (x, y) in rect(0, hz - 4, 63, hz) if y >= hz - 1.5 - 1.8 * math.sin(x / 8 + 1)}
    far = 'D' if ground != 'D' else 'G'
    fill(hill, far)
    if 'hillhi' in ON: fill(cells(hill, lambda x, y: (x, y - 1) not in hill and (x + y) % 2 == 0), 'G' if far == 'D' else 'Y')
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
            if 'notch' in ON: band -= {(x0 + cw // 2, top)}
        for (xx, yy) in band: deco(xx, yy, c)
        if 'stem' in ON:
            for x0 in range(-(i % 2) * 2, 64, cw + 1):
                deco(x0 + cw // 2, bot + 1, acc)
        if 'bandline' in ON:
            for x in range(64):
                if (x + i) % 2 == 0: deco(x, bot, accent(c) if c != 'W' else 'S')
        if 'cuphi' in ON:
            for x0 in range(-(i % 2) * 2, 64, cw + 1):
                deco(x0 + cw - 1, top, 'W' if c != 'W' else 'Y')
    # 大きな物：風車（右）
    windmill(53, hz + 6)
    if 'fence' in ON: fence(0, 13, hz + 5)
    if 'bfly' in ON: butterfly(19, 15, 'Y'); butterfly(42, 23, 'W' if sky != 'W' else 'P')
    if flip: mirror()
    return {"gy": 46, "floor": ground + acc + ''.join(cols) + ''.join(sorted({accent(c) for c in cols})) + ('W' if 'cuphi' in ON else ''), "shade": acc}
