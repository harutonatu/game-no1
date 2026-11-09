# 小物：じてんしゃ（右むき）。車輪 2 つ（タイヤ K・リム W・スポーク W）・わく R・サドル C・ハンドル K。
# draw(cx, by, r) … cx＝わくのまん中、by＝車輪の下。返り値：dict（サドル・ペダル・ハンドルの位置）。
from lib import *


def wheel(cx, cy, r):
    tire = ell(cx, cy, r, r) - ell(cx, cy, r - 1.6, r - 1.6)
    fill(ell(cx, cy, r, r), 'K')
    rim = ell(cx, cy, r - 1.6, r - 1.6) - ell(cx, cy, r - 2.6, r - 2.6)
    fill(rim, 'W')
    for k in range(4):
        a = math.radians(k * 45 + 10)
        fill(line(cx - .5 - (r - 2.5) * math.cos(a), cy - .5 - (r - 2.5) * math.sin(a),
                  cx - .5 + (r - 2.5) * math.cos(a), cy - .5 + (r - 2.5) * math.sin(a)), 'W')
    hub = ell(cx, cy, 1.3, 1.3); fill(hub, 'K')
    return tire | rim


def draw(cx, by, r=7.5):
    rx, fx_ = cx - 12, cx + 13            # 車輪のまん中
    wy = by - r
    wheel(rx, wy, r); wheel(fx_, wy, r)
    seat = (cx - 5, by - 16); crank = (cx + 1, by - 10); head = (cx + 9, by - 18)   # サドルは低め・ペダルは体の近く（短い足でとどく）
    tubes = (line(rx, wy, seat[0], seat[1], 2.2) | line(seat[0], seat[1] + 1, head[0], head[1] + 1, 2.2) |
             line(head[0], head[1], crank[0], crank[1], 2.2) | line(crank[0], crank[1], rx, wy, 2.2) |
             line(head[0], head[1], fx_ - .5, wy - .5, 2.2))
    fill(tubes, 'R'); fill(cells(tubes, lambda x, y: (x, y - 1) not in tubes and (x + y) % 3 == 0), 'W')
    fill(ell(rx, wy, 1.4, 1.4) | ell(fx_, wy, 1.4, 1.4), 'K')
    ring = ell(crank[0], crank[1], 2.4, 2.4); fill(ring, 'K'); put(crank[0], crank[1], 'Y')
    # ペダル（前は上・うしろは下。クランクの うでの 先に 横長の ふみ板）
    pf = (crank[0] + 3, crank[1] - 1); pb = (crank[0] - 3, crank[1] + 1)
    fill(line(crank[0], crank[1], pf[0], pf[1]) | line(crank[0], crank[1], pb[0], pb[1]), 'K')
    fill(rect(pf[0] - 1, pf[1], pf[0] + 1, pf[1]) | rect(pb[0] - 1, pb[1], pb[0] + 1, pb[1]), 'K')
    sad = ell(seat[0] - .5, seat[1] - 1, 3.6, 1.4); shape(sad, 'C')
    bar = line(head[0], head[1], head[0] + 1, head[1] - 3, 1.8) | line(head[0] + 1, head[1] - 3, head[0] + 4, head[1] - 4, 2)
    fill(bar, 'K')
    return {"seat": seat, "crank": crank, "pedal_f": pf, "pedal_b": pb, "grip": (head[0] + 3, head[1] - 4), "rear": (rx, wy, r)}
