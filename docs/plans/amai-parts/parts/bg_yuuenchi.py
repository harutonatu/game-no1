# 場所の背景：ゆうえんち（ピンクの空・観覧車・旗のかざり・しげみ・ひろば）。場所の物は 観覧車 と 旗 の 2 つ。
# draw(hz, flip) … hz＝ひろばの奥の線。flip なら 観覧車を右に、旗を左に。
# 返り値：{"gy": 主役の足の下の目安, "floor": かげを落としてよい地面の色, "shade": かげの色}
from lib import *


def ferris(cx, cy, r, gy):
    """観覧車：足（V）・わく（W とふち K）・骨（K）・まん中（Y）・ゴンドラ（R Y B G）。"""
    outer = ell(cx, cy, r + .6, r + .6); inner = ell(cx, cy, r - 2.2, r - 2.2)
    rim = outer - inner
    fill(rim, 'W'); fill(edge(rim), 'K')
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        fill(line(cx - .5, cy - .5, cx - .5 + (r - 2) * math.cos(a), cy - .5 + (r - 2) * math.sin(a)), 'K')
    for sx in (-1, 1):
        leg = line(cx, cy, cx + sx * r * .6, gy + 1, 3.6)
        shape(leg, 'V')
    hub = ell(cx, cy, 2.2, 2.2); shape(hub, 'Y')
    for k, c in zip(range(8), 'RYBGRYBG'):
        a = math.radians(k * 45)
        gx, gy_ = cx + r * math.cos(a), cy + r * math.sin(a)
        car = rect(gx - 2, gy_ + .5, gx + 1, gy_ + 3.5)
        fill(car, c); fill(cells(car, lambda x, y: y == min(yy for _, yy in car) + 1 and (x + y) % 2 == 0), 'W')
        fill(edge(car), 'K')


def bunting(x0, y0, x1, y1, sag=3, cols='RYBG'):
    """旗のかざり：たれたひもに 三角の旗。"""
    n = int(abs(x1 - x0))
    pts = []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)
        pts.append((int(round(x)), int(round(y))))
    fill(set(pts), 'K')
    k = 0
    for i in range(2, n - 2, 6):
        x, y = pts[i]
        f = poly([(x - 1.5, y + .5), (x + 3.5, y + .5), (x + 1, y + 5.5)])
        fill(f, cols[k % len(cols)]); fill(edge(f), 'K'); k += 1


def draw(hz=30, flip=False):
    sky_ = rect(0, 0, 63, hz)
    base_fill(sky_, 'P')
    for (x, y) in sky_:
        if y < 14 and (x * 7 + y * 11) % 47 == 0: deco(x, y, 'W')
    cxs = (50, 6) if flip else (8, 44)
    for (cx, cy) in ((cxs[1] + 6, 12), (cxs[1] - 2, 17)):
        c = ell(cx, cy, 5, 1.6) | ell(cx - 2, cy - 1, 3, 1.5) | ell(cx + 2, cy - 1.2, 2.5, 1.4)
        fill(c, 'W'); fill(cells(c, lambda x, y: (x, y + 1) not in c and (x + y) % 2 == 0), 'P')
    # しげみ（地平線）
    hedge = {(x, y) for (x, y) in rect(0, hz - 3, 63, hz) if y >= hz - 2 + 1.2 * math.sin(x / 2.3)}
    fill(hedge, 'G'); fill(cells(hedge, lambda x, y: (x, y - 1) not in hedge), 'K')
    fill(cells(hedge, lambda x, y: (x * 3 + y) % 5 == 0 and (x, y - 1) in hedge), 'K')
    # ひろば（きいろのタイル。奥ほど目が細かい）
    gr = rect(0, hz + 1, 63, 47)
    base_fill(gr, 'Y')
    fill(rect(0, hz + 1, 63, hz + 1), 'K')
    for y in (hz + 4, hz + 8, hz + 13):
        for x in range(64): deco(x, y, 'O')
    for k in range(-5, 6):
        for (x, y) in line(32 + k * 4, hz + 4, 32 + k * 12, 47):
            deco(x, y, 'O')
    # 観覧車 と 旗
    wx = 51 if flip else 13
    ferris(wx, 14, 11, hz)
    if flip:
        bunting(-1, 0, 22, 1, 2)
    else:
        bunting(34, 2, 64, 0, 3)
    return {"gy": 45, "floor": "YO", "shade": "O"}
