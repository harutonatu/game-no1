# 場所の背景：こうえん（青い空・遠くの木立・まん中の 土の道・両わきの しばふ）。場所の大きな物は すべりだい と ブランコ の 2 つ。
# 2026-11-15 描き直し（約束 §2.6「部品の背景の描き直し」）：はなばたけ・もり と見分けがつくよう、地面は 茶色の土の道を中心にし、
#   小さな物（すなば・バケツ・小石・草・小さな花）を足した。
# 2026-11-15 調整（ユーザー「難易度上がりすぎ」）：じゃり・小石・わだち・草と花の点々・バケツ・太陽の光の点を やめ、
#   しばふと 道を 大きな面で ぬる（道は 1 色の 太い帯）。雲の かげは 下の 1 行に まとめた。
# 色：空 S・雲 W（かげ V）・太陽 Y（ふち O）・遠くの木立 D（光 G）・しばふ G・道 C・
#   すべりだい（すべる所 Y・かげ O（ground=Y のときは S・B）・手すり R・はしご B・ふち K）・ブランコ（わく R・くさり K・いた C）・すなば（わく O・すな Y）。
# draw(flip, sky, ground, hz) … flip なら 左右が入れかわる（すべりだいが右・ブランコとすなばが左）。sky＝空の色（ふだん S）、
#   ground＝しばふの色（ふだん G。草は lib.accent の色。道は いつも C）。hz＝地面の奥の線。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *
import lib

# 2026-11-15 中間に（ユーザー「アカン簡単すぎる…ちょうど中間がいい」）：v82 で やめた 書き込みのうち、ON に 書いた物だけを 戻す。
#   ON に 入れられる 名前：rung deckhi raildot chuterim slideleg swingrim seat grain bucket sun cloud treehi tuft lawnfl pathedge gravel pebble rut flower
#   （名前を 足すと 細かくなり、難しくなる。決めかたは 計画書 docs/plans/amai-parts.md §20）
ON = {'chuterim', 'flower', 'pebble'}


def mirror():
    """描いた背景を まるごと 左右ぎゃくに（地の色・模様の印も いっしょに）。"""
    for r in lib.g: r.reverse()
    for r in lib.base: r.reverse()
    d = {(W - 1 - x, y) for (x, y) in lib.decos}
    lib.decos.clear(); lib.decos.update(d)


def slide(gy, chute_c='Y', chute_sh='O'):
    """すべりだい（左）。はしご B・台 B・手すり R・すべる所 chute_c（下の ふち chute_sh）。gy は 足の下。
    2026-11-15 調整：ふち K と 光の すじを やめ、太い 1 色の 面で 描く。"""
    top = gy - 22
    ladder = set()
    for lx in (1, 5):
        ladder |= rect(lx, top, lx, gy)
    if 'rung' in ON:
        rungs = set()
        for yy in range(top + 3, gy, 3):
            rungs |= rect(2, yy, 4, yy)
        fill(ladder, 'B'); fill(rungs, 'K')
        fill(cells(ladder, lambda x, y: x == 1), 'K')
    else:
        for yy in range(top + 3, gy, 4):
            ladder |= rect(2, yy, 4, yy)
        fill(ladder, 'B')
    deck = rect(0, top - 1, 8, top + 1)
    if 'deckhi' in ON: shape(deck, 'B', hi='S', hw=1)
    else: fill(deck, 'B')
    rail = rect(0, top - 5, 0, top - 1) | rect(7, top - 5, 7, top - 1) | rect(0, top - 5, 7, top - 5)
    fill(rail, 'R')
    if 'raildot' in ON: fill(cells(rail, lambda x, y: y == top - 5 and x % 2 == 0), 'O')
    chute = line(8.5, top + 1.5, 17, gy - 3, 4) | rect(16, gy - 4, 20, gy - 2)
    fill(chute, chute_c)
    if 'chuterim' in ON:
        fill(cells(chute, lambda x, y: (x - 1, y) not in chute or (x, y + 1) not in chute), chute_sh)
        fill(edge(chute), 'K')
    else:
        fill(cells(chute, lambda x, y: (x, y + 1) not in chute), chute_sh)
    side = line(9.5, top - 1, 18.5, gy - 6, 0)      # すべる所の 上の手すり
    fill(side - chute, 'R')
    if 'slideleg' in ON:
        leg = rect(17, gy - 2, 17, gy) | rect(9, top + 2, 9, gy); fill(leg - chute, 'K')
    return ladder | deck | chute


def swing(gy):
    """ブランコ（右）。わく R（太い 1 色）・くさり K・いた C。gy は あしの下。"""
    top = gy - 24
    legs = line(46, gy + .5, 49.5, top, 2.6) | line(63, gy + .5, 60.5, top, 2.6)
    bar = rect(46, top - 1, 63, top)
    frame = legs | bar
    fill(frame, 'R')
    if 'swingrim' in ON:
        fill(cells(legs, lambda x, y: (x + 1, y) not in legs), 'K')
        fill(cells(legs, lambda x, y: (x - 1, y) not in legs and y < gy - 1), 'O')
        fill(bar, 'R'); fill(cells(bar, lambda x, y: y == top - 1), 'O'); fill(rect(46, top + 1, 63, top + 1) - legs, 'K')
        fill(rect(46, top - 1, 46, top) | rect(63, top - 1, 63, top), 'K')
    for (x0, x1, sy) in ((50, 55, gy - 8), (57, 61, gy - 10)):
        fill(rect(x0, top + 1, x0, sy - 1) | rect(x1, top + 1, x1, sy - 1), 'K')
        seat = rect(x0 - 1, sy, x1 + 1, sy + 1)
        fill(seat, 'C')
        if 'seat' in ON: fill(cells(seat, lambda x, y: y == sy), 'O'); fill(cells(seat, lambda x, y: x in (x0 - 1, x1 + 1)), 'K')
    return frame


def sandbox(gy):
    """すなば（右の手前の すみ）。わく O（ふち K）・すな Y（山 O）。2026-11-15 調整：バケツ・シャベル・すなの つぶを やめた。"""
    box = poly([(52, gy - 5), (64, gy - 5), (64, gy + 1), (49, gy + 1)])
    fill(box, 'O'); fill(edge(box), 'K')
    sand = poly([(53.5, gy - 3.5), (64, gy - 3.5), (64, gy - .5), (51.5, gy - .5)])
    fill(sand, 'Y')
    if 'grain' in ON: fill(cells(sand, lambda x, y: hsh(x, y, 21) < 200), 'O')
    if 'bucket' in ON:
        bucket = rect(56, gy - 5, 59, gy - 2)
        fill(bucket, 'R'); fill(cells(bucket, lambda x, y: y == gy - 5), 'O'); fill(cells(bucket, lambda x, y: x in (56, 59) or y == gy - 2), 'K')
        fill({(56, gy - 6), (57, gy - 7), (58, gy - 7), (59, gy - 6)}, 'K')
        fill(line(61, gy - 3, 63, gy - 7) | {(60, gy - 2), (61, gy - 2)}, 'B')
    mound = ell(58, gy - 1, 3.5, 1.6) & sand; fill(mound, 'O')
    return box


def sun_(cx, cy, r, c, rim):
    """太陽（まる c・ふち rim。光の点は 描かない）。"""
    m = ell(cx, cy, r, r); fill(m, c); fill(edge(m), rim)
    return m


def cloud_(cx, cy, w, c, shade):
    """雲（下の 1 行を まとめて かげ）。"""
    m = ell(cx, cy, w, 1.6) | ell(cx - w * .4, cy - 1, w * .6, 1.5) | ell(cx + w * .4, cy - 1.2, w * .5, 1.4)
    fill(m, c); fill(cells(m, lambda x, y: (x, y + 1) not in m), shade)
    return m


def draw(flip=False, sky=None, ground=None, hz=17):
    sky = sky or 'S'; ground = ground or 'G'; acc = accent(ground)
    path_c = 'C' if ground != 'C' else 'O'
    base_fill(rect(0, 0, 63, hz), sky)
    if 'sun' in ON: sun(57, 4, 3, 'Y', 'O')
    else: sun_(57, 4, 3, 'Y', 'Y')
    if 'cloud' in ON:
        for (cx, cy, w) in ((14, 4, 4), (36, 2, 3)):
            cloud(cx, cy, w, 'S' if sky == 'W' else 'W', 'V')
    else:
        for (cx, cy, w) in ((14, 1, 6), (38, 1, 5)):
            cloud_(cx, cy, w, 'S' if sky == 'W' else 'W', 'V')
    # 遠くの木立（こいみどりの まるい木が ならぶ。光は 上の ふちに 1 行）
    far, far_hi = ('D', 'G') if ground != 'D' else ('G', 'Y')
    trees = set()
    for (tx, r) in ((2, 3.5), (8, 4.2), (15, 3.4), (21, 4), (28, 3.2), (34, 4.4), (41, 3.6), (47, 4), (54, 3.3), (61, 4.2)):
        trees |= ell(tx, hz - r + 1.5, r, r * .9)
    trees |= rect(0, hz - 1, 63, hz)
    fill(trees, far)
    if 'treehi' in ON: fill(cells(trees, lambda x, y: (x, y - 1) not in trees or ((x, y - 2) not in trees and (x + y) % 2 == 0)), far_hi)
    else: fill(cells(trees, lambda x, y: (x, y - 1) not in trees and y < hz - 1), far_hi)
    # しばふ（大きな面で ぬる。点々は 描かない）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, ground)
    for (x, y) in gr:
        v = hsh(x, y, 4)
        if 'tuft' in ON and 70 <= v < 80 and y > hz + 4: deco(x, y, acc); deco(x - 1, y - 1, acc); deco(x + 1, y - 1, acc)
        elif 'lawnfl' in ON and 80 <= v < 88 and y > hz + 6: deco(x, y, 'P' if (x + y) % 2 else 'Y')
    # まん中の 太い 土の道（奥は せまく、手前は ひろい。1 色の 大きな面）
    path = poly([(27, hz + 1), (37, hz + 1), (58, 48), (6, 48)])
    base_fill(path, path_c)
    pe = cells(path, lambda x, y: (x - 1, y) not in path or (x + 1, y) not in path)
    if 'pathedge' in ON:
        for (x, y) in pe:
            if (x + y) % 2 == 0: deco(x, y, acc)
    for (x, y) in path - pe:
        v = hsh(x, y, 5)
        t = (y - hz) / (47 - hz)
        if 'gravel' in ON and v < 40 + 50 * t: deco(x, y, 'O' if path_c == 'C' else 'C')
        elif 'pebble' in ON and 500 <= v < 512 + 6 * t and y > hz + 5 and not 22 <= x <= 41 and (x + 1, y) in path:
            deco(x, y, 'W'); deco(x + 1, y, 'W'); deco(x, y + 1, 'K'); deco(x + 1, y + 1, 'K')
    if 'rut' in ON:
        for k in (-.35, .35):
            for y in range(hz + 3, 48):
                t = (y - hz) / (47 - hz); x = int(round(32 + k * (8 + 40 * t) * .7))
                if (x, y) in path and y % 2 == 0: deco(x, y, 'O' if path_c == 'C' else 'C')
    if 'flower' in ON:
        for (fx_, fy, c) in ((2, 43, 'P'), (6, 46, 'Y'), (4, 47, 'P'), (50, 30, 'P'), (55, 34, 'Y'), (59, 28, 'P'), (22, 22, 'Y'), (41, 21, 'P')):
            c = c if c != ground else 'W'
            for q in ((fx_, fy - 1), (fx_ - 1, fy), (fx_ + 1, fy), (fx_, fy + 1)): deco(q[0], q[1], c)
            deco(fx_, fy, 'Y' if c != 'Y' else 'O')
    # 大きな物：すべりだい と ブランコ。小さな物：すなば
    slide(40, *(('Y', 'O') if ground != 'Y' else ('S', 'B')))
    swing(38)
    sandbox(46)
    if flip: mirror()
    return {"gy": 46, "floor": path_c + ground + acc + ('OWK' if ON & {'gravel', 'pebble', 'rut'} else '') + ('PY' if ON & {'flower', 'lawnfl'} else ''), "shade": 'K'}
