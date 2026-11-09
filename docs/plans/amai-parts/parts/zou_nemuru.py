# 動物 × ふるまい：ぞうが ねむる（おなかを 下に ねそべり、前足の上に あごを のせて 目を閉じる。鼻は 地面で くるん。
# 頭の上に Zzz）。
# draw(cx, by, flip) … cx＝体のまん中、by＝おなかの下（地面）。返り値：(頭, 胴体)。
from lib import *
import lib, zou

SHADOW = (1, 19, 1.5)


def zee(x, y, n, c):
    """Z の字（n×n。上と下の横線と ななめ）。x, y は左上。"""
    m = {(x + i, y) for i in range(n)} | {(x + i, y + n - 1) for i in range(n)} | {(x + n - 1 - i, y + i) for i in range(n)}
    # まわり 1 マスの 模様（星など）は 地の色へ もどす（Z が 星に うもれないように）
    for (px, py) in {(px + dx, py + dy) for (px, py) in m for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - m:
        if (px, py) in lib.decos and lib.base[py][px]:
            put(px, py, lib.base[py][px]); lib.decos.discard((px, py))
    fill(m, c)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 9, by - 13
    # しっぽ
    fill(line(cx - 17, by - 10, cx - 21, by - 6), 'K'); fill(ell(cx - 21.5, by - 5.5, 1.2, 1.3), 'K')
    # うしろ足（ねそべって よこに 出す。足のうら W）
    zou.blob(ell(cx - 13, by - 2.8, 5.5, 2.8), dark=True)
    # 体（よこに長い まるい胴）
    body = ell(cx - 4, by - 10, 14, 10)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    zou.blob(ell(cx - 7, by - 2.8, 5.5, 2.8))
    shape(ell(cx - 12.5, by - 2.8, 1.4, 2.2), 'W', o='K')
    # 前足（あごの下で 前へ そろえる）
    zou.blob(ell(cx + 10, by - 2.8, 8.5, 2.8), dark=True)
    # 耳（たれて 顔の横）→ 頭 → 顔（ねむる目・口は小さく）
    zou.ear(hx - 10, hy + 1, 8, 8.5)
    head = zou.head(hx, hy)
    zou.face(hx, hy - 1, eyes='sleep', mouth='smile')
    # 手前の前足の先（あごの下から のぞく。つめ W）
    f = ell(cx + 15, by - 2.6, 4, 2.6); zou.blob(f)
    for k in (0, 2):
        put(int(cx + 16 + k), by - 2, 'W')
    # 鼻（口の上から 前へ、地面で くるん）
    zou.trunk([(hx + 6, hy + 2), (hx + 10, hy + 3), (hx + 13, hy + 6), (hx + 14, hy + 9), (hx + 16, hy + 10)], 4.8, 3)
    end(flip, cx)
    # Zzz（向きに合わせて 頭の上。だんだん大きく、ななめ上へ。明るい空なら B、くらい空なら W）
    for i, n in enumerate((4, 5, 6)):
        zx = cx + (4 + i * 4) * (-1 if flip else 1) - (n if flip else 0)
        zy = hy - 17 - i * 7
        under = lib.base[zy + n // 2][zx + n // 2] if 0 <= zy + n // 2 < H and 0 <= zx + n // 2 < W else None
        zee(zx, zy, n, 'B' if under in ('W', 'P', 'S', 'Y', 'O') else 'W')
    return head, body
