# 動物 × ふるまい：ぺんぎんが ねむる（すわって、ひざに もうふを かけ、ナイトキャップを かぶって 目を とじる。
#   手で もうふの はしを にぎる。頭の 前の 上に Zzz）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おしりの下。返り値：(頭, 胴体)（決まり 8 の確かめ用）。
from lib import *
import lib, pengin

SHADOW = (1, 16, 1.6)


def zee(x, y, n, c, keep=()):
    """Z の字（n×n）。x, y は左上。まわり 1 マスは 空の地の色へ もどす（星・雪・旗の ひもなどに Z が うもれないように）。
    keep（主役の マス）と、地の色の 無い マスは そのまま。"""
    m = {(x + i, y) for i in range(n)} | {(x + i, y + n - 1) for i in range(n)} | {(x + n - 1 - i, y + i) for i in range(n)}
    for (px, py) in {(px + dx, py + dy) for (px, py) in m for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - m:
        if 0 <= px < W and 0 <= py < H and (px, py) not in keep and lib.base[py][px]:
            put(px, py, lib.base[py][px]); lib.decos.discard((px, py))
    fill(m, c)


def nightcap(hx, hy):
    """ナイトキャップ：頭の 上に かぶり、先は うしろへ おれて たれる（B に W の しま・ふちの おり返し W・先に Y の ぽんぽん）。"""
    cap = poly([(hx - 9.5, hy - 4.5), (hx - 7, hy - 11), (hx - 3, hy - 15.5), (hx + 1, hy - 16.5), (hx + 4, hy - 14),
                (hx + 8.5, hy - 6.5)]) | line(hx - 1, hy - 15, hx - 7, hy - 15.5, 4.4) | line(hx - 7, hy - 15.5, hx - 11, hy - 11, 3.6)
    fill(cap, 'B')
    fill(cells(cap, lambda x, y: (x - y) % 5 in (0, 1)), 'W')
    brim = line(hx - 9.5, hy - 5, hx - 4, hy - 8.5, 3) | line(hx - 4, hy - 8.5, hx + 2, hy - 9.5, 3) | \
        line(hx + 2, hy - 9.5, hx + 8.5, hy - 6.5, 3)
    fill(brim, 'W')
    fill(cells(brim, lambda x, y: (x, y + 1) not in brim), 'S')
    fill(edge(cap | brim), 'K')
    pom = ell(hx - 11.5, hy - 9.5, 2.6, 2.6)
    shape(pom, 'Y', sh='O', sw=1)


def draw(cx, by, flip=False):
    begin()
    head, body = pengin.body_head(cx, by)
    hx, hy = cx + 1, by - 28
    pengin.face(hx, hy, head, look='closed', mouth='smile')
    nightcap(hx, hy)
    # もうふ（R に W の 水玉。上の ふちは おり返し W。おなかの 下から 足もとまで）
    bl = poly([(cx - 14, by - 11), (cx - 2, by - 14), (cx + 12, by - 12), (cx + 16, by), (cx - 15, by)])
    fill(bl, 'R')
    fill(cells(bl, lambda x, y: (x * 2 + y * 3) % 7 == 0 and (x + y) % 2 == 0), 'W')
    hem = cells(bl, lambda x, y: (x, y - 1) not in bl or (x, y - 2) not in bl)
    fill(hem, 'W'); fill(cells(hem, lambda x, y: (x, y - 1) in hem), 'P')
    fill(edge(bl), 'K')
    # 足の先（もうふから 出る）
    pengin.foot(cx + 15, by - 1.4)
    # 手（もうふの はしを にぎる。奥と 手前）
    pengin.flipper(cx - 9, by - 20, cx - 6, by - 12, 4.2)
    pengin.flipper(cx + 7, by - 20, cx + 9, by - 12, 4.6)
    me = end(flip, cx)
    # Zzz（向きに合わせて 頭の 前の 上。だんだん 大きく。ピンクの空なら V、明るい空なら B、くらい空なら W）
    for i, (dx, y, n) in enumerate(((12, by - 39, 4), (17, by - 43, 5), (23, by - 46, 6))):
        zx = cx + dx * (-1 if flip else 1) - (n if flip else 0)
        under = lib.base[y + n // 2][zx + n // 2] if 0 <= y + n // 2 < H and 0 <= zx + n // 2 < W else None
        zee(zx, y, n, 'V' if under == 'P' else 'B' if under in ('W', 'S', 'Y', 'O') else 'W', me)
    return head, body
