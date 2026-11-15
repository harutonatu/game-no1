# 場所の背景：はなばたけ（青い空・低い地平線・チューリップの色の帯が 手前まで ならぶ）。場所の大きな物は 風車 の 1 つ。
# 2026-11-15 描き直し（約束 §2.6「部品の背景の描き直し」）：こうえん・もり と見分けがつくよう、地面を チューリップの列
#   （赤・黄・ピンク・白・むらさき の帯）でうめ、風車と小さな物（木のさく・ちょうちょ）を足した。
# 色：空 S・雲 W（かげ V）・太陽 Y（ふち O）・遠くの丘 D（光 G）・はと くき G（かげ D）・チューリップ R P Y W V（光・かげ）・
#   風車（かべ O・かげ C・やね R・まど B・はね W と C・ふち K）・木のさく（C・光 O・ふち K）・ちょうちょ（Y と K）。
# draw(flip, sky, ground, hz) … flip なら 左右が入れかわる（風車が左・さくが右）。sky＝空の色（ふだん S）、
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
    """風車（右）。かべ O（かげ C）・やね R・まど と とびら B と C・はね（W の板・C の ほね）・ふち K。x は まん中。"""
    # 4 まいの はね（ななめの X）。うしろに 描いてから 塔を 重ねる
    blades = set(); spars = set(); outer = set()
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
        fill(bl, 'W')
        fill(cells(bl, lambda a_, b_: (a_ + b_) % 3 == 0 or (a_ - b_) % 3 == 0), 'C')
        fill(edge(bl), 'K')
    fill(spars, 'C')
    tower = poly([(x - 4, hub_y + 1), (x + 4, hub_y + 1), (x + 7, gy + 1), (x - 7, gy + 1)])
    fill(tower, 'O')
    fill(cells(tower, lambda xx, yy: xx < x - 1 and ((xx - 1, yy) not in tower or (xx - 2, yy) not in tower or (xx + yy) % 2 == 0)), 'C')
    fill(edge(tower), 'K')
    for yy in range(hub_y + 6, gy, 5):                          # かべの 板の すじ
        fill(cells(tower, lambda a, b: b == yy and (a - 1, b) in tower and (a + 1, b) in tower), 'C')
    door = rect(x - 1, gy - 5, x + 1, gy); fill(door, 'C'); fill(edge(door) - cells(door, lambda a, b: b == gy), 'K')
    win = rect(x - 2, hub_y + 6, x + 2, hub_y + 9); fill(win, 'B'); fill(edge(win), 'K'); fill(rect(x, hub_y + 6, x, hub_y + 9), 'K')
    roof = poly([(x - 6, hub_y + 2), (x + 6, hub_y + 2), (x + 3, hub_y - 4), (x - 3, hub_y - 4)]) | ell(x, hub_y - 4, 3, 2)
    fill(roof, 'R'); fill(cells(roof, lambda a, b: (a + 1, b) not in roof or (a, b - 1) not in roof), 'O'); fill(edge(roof), 'K')
    fill(spars & ell(x, hub_y, 4, 4), 'C')
    hub = ell(x + .5, hub_y + .5, 1.6, 1.6); fill(hub, 'K')
    return tower | roof | blades


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
    sun(6, 4, 3, 'Y', 'O')
    for (cx, cy, w) in ((22, 3, 4), (33, 8, 3)):
        cloud(cx, cy, w, 'W' if sky != 'W' else 'S', 'V')
    # 遠くの 低い丘（こいみどり）
    hill = {(x, y) for (x, y) in rect(0, hz - 4, 63, hz) if y >= hz - 1.5 - 1.8 * math.sin(x / 8 + 1)}
    far, far_hi = ('D', 'G') if ground != 'D' else ('G', 'Y')
    fill(hill, far); fill(cells(hill, lambda x, y: (x, y - 1) not in hill and (x + y) % 2 == 0), far_hi)
    # チューリップの 色の帯（奥は うすく、手前ほど 太い）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    cols = [('O' if c == ground else c) for c in ('W', 'P', 'V', 'Y', 'P', 'R')]
    bands = [hz + 1, hz + 3, hz + 6, hz + 10, hz + 15, hz + 21, 48]
    for i in range(len(bands) - 1):
        top, bot = bands[i], bands[i + 1]; h = bot - top; c = cols[i % len(cols)]
        sh_c = accent(c) if c != 'W' else 'S'
        if h <= 3:                                                  # 遠くの帯：花の点が ならぶ
            for x in range(64):
                for yy in range(top, bot - 1):
                    if (x + yy + i) % 3: deco(x, yy, c)
                deco(x, bot - 1, acc) if x % 2 else None
            continue
        cw = 2 if h <= 4 else 3 if h <= 6 else 4                   # 花（カップ）の はば
        ch = h - 2                                                  # 花の高さ（のこり 2 行は くきと葉）
        for x0 in range(-(i % 2) * 2, 64, cw + 1):
            cup = rect(x0, top, x0 + cw - 1, top + ch - 1)
            if cw >= 3:
                cup -= {(x0 + cw // 2, top)} if cw == 3 else {(x0 + 1, top), (x0 + 2, top)} - {(x0 + 1, top)}
            for (xx, yy) in cup: deco(xx, yy, c)
            if cw >= 3:
                deco(x0, top + ch - 1, sh_c); deco(x0 + cw - 1, top, 'W' if c != 'W' else 'Y')
            deco(x0 + cw // 2, top + ch, acc)                       # くき
            deco(x0 - 1, top + ch, acc); deco(x0 + cw, top + ch + 1, acc)   # 葉
        for x in range(64):
            if (x + i) % 2 == 0: deco(x, bot - 1, acc)
    # 大きな物：風車（右）。小さな物：木のさく（左）・ちょうちょ
    windmill(53, hz + 6)
    fence(0, 13, hz + 5)
    butterfly(19, 15, 'Y'); butterfly(42, 23, 'W' if sky != 'W' else 'P')
    if flip: mirror()
    return {"gy": 46, "floor": ground + acc + ''.join(cols) + 'S', "shade": acc}
