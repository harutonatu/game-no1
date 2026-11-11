# 動物 × ふるまい：ぞうが おどる（かた足で 立ち、もう かた足を ひざで まげて 上げ、両手を 大きく ひろげる。
#   鼻も 上へ ふりあげる。手と 足の まわりに 動きの線、上に 音符）。
# draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import lib, zou

SHADOW = (0, 12, 1.5)


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 2, by - 28
    # しっぽ（ぴょんと 上へ）
    fill(line(cx - 9, by - 13, cx - 13, by - 16), 'K'); fill(ell(cx - 13.5, by - 16.5, 1.3, 1.3), 'K')
    # 奥の手（上へ 高く 上げる。耳の 上から 手が 見える）
    zou.blob(line(cx - 6, by - 20, cx - 14, by - 39, 4.4), dark=True)
    zou.blob(ell(cx - 14.5, by - 40.5, 2.7, 2.7), dark=True)
    # 立っている 奥の足
    zou.leg(cx - 3, by - 9, by)
    # 体（すこし かたむく）
    body = ell(cx, by - 13, 9.5, 10, 12)
    zou.blob(body)
    fill(cells(body, lambda x, y: (x, y - 2) not in body and (x, y - 1) in body and (x - 2, y) in body and (x + 2, y) in body), 'W')
    # 上げた 手前の足（前へ ぽんと けり上げる。足の うら W が 前を むく）
    zou.blob(line(cx + 3, by - 8, cx + 14, by - 11, 6.6))
    shape(ell(cx + 16.5, by - 11.2, 1.7, 3), 'W', o='K')
    # 耳 → 頭 → 顔（にっこり・口を あける）
    zou.ear(hx - 11, hy + 1, 8.5, 9)
    head = zou.head(hx, hy)
    zou.face(hx, hy, eyes='happy', mouth='open')
    # 手前の手（右へ 大きく ひろげる）
    zou.blob(line(cx + 6, by - 17, cx + 16, by - 20, 4.4))
    zou.blob(ell(cx + 17, by - 20.5, 2.6, 2.6))
    # 鼻（口の上から 前へ、上へ 高く ふりあげる）
    zou.trunk([(hx + 5, hy + 2), (hx + 10, hy), (hx + 13, hy - 5), (hx + 14, hy - 10), (hx + 12, hy - 13)], 5, 3)
    end(flip, cx)
    s = -1 if flip else 1
    sh = 1 if flip else 0
    X = lambda dx: cx + s * dx - sh

    def mark(pts):
        """動きの線（下の色と ちがう色。W か K）。"""
        under = {at(X(dx), by + dy) for dx, dy in pts}
        c = next(c for c in ('W', 'K', 'B') if c not in under)
        for dx, dy in pts:
            put(X(dx), by + dy, c)
    # 手の先の まわりに 弧（左右）・上げた足の 下に 2 本
    mark(((-19, -42), (-20, -41), (-21, -39), (-21, -38)))
    mark(((-11, -45), (-10, -46), (-9, -46)))
    mark(((21, -25), (22, -24), (23, -22), (23, -21), (23, -20)))
    mark(((20, -14), (21, -14), (22, -14)))
    mark(((20, -10), (21, -10), (22, -10), (23, -10)))
    mark(((16, -5), (17, -6), (18, -7)))
    # 音符（頭の 上と 鼻の 先の 外）
    note(X(-3) - 2 * sh, by - 47, 'Y')
    note(X(19) - 2 * sh, by - 45, 'R')
    return head, body
