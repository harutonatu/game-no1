# こうえんで くまが おどる（kumakouenodoru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 kumakouenodoru.txt を書き出す（1 マス＝1 粒）。部品は amai-more/nekomoribooru.py・pandamorinemuru.py・inumorinemuru.py をまねた（絵 C）。
# ---- 部品（楕円・多角形・線・ふちどり・かげ）。見本 kumadaidokorooyatsu.py をまねた ----
import os, math
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
ALL = {(x, y) for y in range(H) for x in range(W)}

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def at(x, y):
    return g[y][x] if 0 <= x < W and 0 <= y < H else None

def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    s = set()
    for (x, y) in ALL:
        dx, dy = x + .5 - cx, y + .5 - cy
        u = dx * ca + dy * sa; v = -dx * sa + dy * ca
        if (u / rx) ** 2 + (v / ry) ** 2 <= 1.0:
            s.add((x, y))
    return s

def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(max(0, y0), min(H - 1, y1) + 1) for x in range(max(0, x0), min(W - 1, x1) + 1)}

def poly(pts):
    s = set(); n = len(pts)
    for (x, y) in ALL:
        px, py = x + .5, y + .5; ins = False
        for i in range(n):
            ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
            if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                ins = not ins
        if ins: s.add((x, y))
    return s

def line(x0, y0, x1, y1, w=0):
    if w <= 0:
        s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(int(round(n)) + 1):
            t = i / max(1, round(n))
            s.add((int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))))
        return s
    s = set(); L2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 or 1
    for (x, y) in ALL:
        px, py = x + .5, y + .5
        t = max(0, min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / L2))
        if math.hypot(px - x0 - t * (x1 - x0), py - y0 - t * (y1 - y0)) <= w / 2:
            s.add((x, y))
    return s

def fill(m, c):
    for x, y in m:
        put(x, y, c(x, y) if callable(c) else c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def shape(m, c, o='K', sh=None, hi=None, sw=2, hw=2):
    """塗って、かげ（左下）・明るい所（右上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x - sw, y) not in m or (x, y + sw) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x + hw, y) not in m or (x, y - hw) not in m)
              and (x - sw, y) in m and (x, y + sw) in m}, hi)
    if o:
        fill(edge(m), o)

def shadow(cx, cy, rx, ry, on, c='K', solid=0.5):
    for (x, y) in ell(cx, cy, rx, ry):
        q = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2
        if at(x, y) in on and (q < solid or (x + y) % 2 == 0):
            put(x, y, c)

def zz(x, y, n, c='K'):
    for i in range(n):
        put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)

def finish(name, holec='W'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out:
                g[y][x] = holec                      # 閉じた空きをうめる
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while rows and all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while rows and all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    cnt = {}
    for r in rows:
        for ch in r:
            if ch != '.': cnt[ch] = cnt.get(ch, 0) + 1
    print(name, sum(cnt.values()), len(cnt), cnt)

# ---- 場面と主役の部品（絵 B。58〜66 面で同じ部品を使う）----
def cells(m, f):
    return {(x, y) for (x, y) in m if f(x, y)}

def dither(m, c, k=2):
    fill(cells(m, lambda x, y: (x + y) % k == 0), c)

def zzz(x, y, c='K'):
    zz(x, y, 3, c); zz(x + 4, y - 4, 4, c); zz(x + 9, y - 9, 5, c)

def cloud(cx, cy, s=1.0):
    m = ell(cx, cy, 5 * s, 2 * s) | ell(cx - 3 * s, cy + .5, 3 * s, 1.6 * s) | ell(cx + 1 * s, cy - 1.4 * s, 3 * s, 2 * s)
    fill(m, 'W'); fill(cells(m, lambda x, y: (x, y + 1) not in m), 'S')

# 空（上の何行かは あけておく）
def sky(y0, y1, x0=0, x1=63):
    fill(rect(x0, y0, x1, y1), 'S')

# もり：奥の木立（みき C・葉 G。奥は くらい）と 地面（落ち葉）
def bg_forest(gy=33, top=6, trunks=(3, 13, 25, 37, 49, 59)):
    back = rect(0, top + 6, 63, gy)
    fill(back, 'S')
    fill(cells(back, lambda x, y: y > gy - 6 and (x + y) % 2 == 0), 'G')
    for tx in trunks:
        t = rect(tx, top + 6, tx + 2, gy)
        fill(t, 'C'); fill(cells(t, lambda x, y: x == tx + 2), 'K'); fill(cells(t, lambda x, y: x == tx), 'O')
    can = set()
    for i, cx in enumerate(range(-2, 70, 9)):
        can |= ell(cx, top + 5 + (i % 2) * 2.5, 6.5, 5.5)
    fill(can, 'G')
    fill(cells(can, lambda x, y: (x, y + 2) not in can and (x + y) % 2 == 0), 'K')
    fill(cells(can, lambda x, y: (x * 7 + y * 3) % 11 == 0 and (x, y + 2) in can), 'Y')
    fill(edge(can), 'K')
    gr = rect(0, gy, 63, H - 1)
    fill(gr, 'G'); fill({(x, gy) for x in range(W)}, 'K')
    for (x, y) in gr:
        if y > gy and (x * 5 + y * 7) % 23 == 0: put(x, y, 'K')
        elif y > gy + 1 and (x * 11 + y * 5) % 29 == 0: put(x, y, 'O')
        elif y > gy + 1 and (x * 13 + y * 3) % 37 == 0: put(x, y, 'Y')

# もりの 大きな木（手前。みき C・葉 G）
def big_tree(tx, gy, cy=10, r=11):
    trunk = poly([(tx - 2, gy + 2), (tx, cy + 4), (tx + 4, cy + 4), (tx + 6, gy + 2)])
    shape(trunk, 'C', hi='O', hw=2)
    fill(cells(trunk, lambda x, y: (y % 5 == 0) and x == tx + 2), 'K')
    root = ell(tx + 2, gy + 1.5, 6, 1.6); fill(root - trunk, 'K')
    crown = ell(tx + 2, cy, r, r * 0.75) | ell(tx - r * 0.6, cy + 3, r * 0.6, r * 0.5) | ell(tx + 2 + r * 0.7, cy + 3, r * 0.6, r * 0.5)
    fill(crown, 'G')
    fill(cells(crown, lambda x, y: ((x, y + 3) not in crown or (x - 3, y) not in crown) and (x + y) % 2 == 0), 'K')
    fill(cells(crown, lambda x, y: (x * 3 + y * 5) % 9 == 0 and (x, y - 2) in crown and (x + 3, y) in crown and (x, y + 3) in crown), 'Y')
    fill(edge(crown), 'K')

# きのこ（あか・しろの ぽつぽつ）
def mushroom(cx, by, s=1.0):
    st = rect(int(cx - 1 * s), int(by - 4 * s), int(cx + 1 * s), by)
    shape(st, 'W', sh='S', sw=1)
    cap = ell(cx + .5, by - 4.5 * s, 4 * s, 2.8 * s) - rect(0, int(by - 4 * s) + 1, W - 1, H - 1)
    fill(cap, 'R')
    fill(cells(cap, lambda x, y: (x * 3 + y * 2) % 5 == 0 and (x, y - 1) in cap), 'W')
    fill(edge(cap), 'K')

# 切りかぶ
def stump(cx, by, rx=6, h=5):
    side = rect(cx - rx, by - h, cx + rx, by) | ell(cx + .5, by, rx + 1, 1.5)
    shape(side, 'C', hi='O', hw=2)
    fill(cells(side, lambda x, y: (x - cx) % 3 == 0 and by - h + 2 <= y < by), 'K')
    top_ = ell(cx + .5, by - h, rx + 1, 2)
    fill(top_, 'Y'); fill(ell(cx + .5, by - h, rx * 0.55, 1.1), 'O'); put(cx, by - h, 'C')
    fill(edge(top_), 'K')

# こうえん：空・くも・しば生（花）
def bg_park(gy=32, top=4, clouds=((9, 5, 1.0), (50, 4, 0.9))):
    sky(top, gy)
    for (cx, cy, s_) in clouds: cloud(cx, top + cy, s_)
    gr = {(x, y) for (x, y) in ALL if y >= gy + 1.2 * math.sin(x / 7.0)}
    fill(gr, 'G')
    fill(cells(gr, lambda x, y: (x, y - 1) not in gr), 'K')
    for (x, y) in gr:
        if (x, y - 1) in gr and (x * 5 + y * 7) % 19 == 0: put(x, y, 'K')
        elif (x, y - 2) in gr and (x * 11 + y * 3) % 41 == 0:
            put(x, y, 'W'); put(x - 1, y, 'Y')
    return gr

# こうえんの木（丸い葉）
def park_tree(tx, gy, cy=12, r=9):
    trunk = rect(tx, cy + 3, tx + 3, gy + 1)
    shape(trunk, 'C', hi='O', hw=2)
    crown = ell(tx + 2, cy, r, r * 0.85) | ell(tx - r * 0.5, cy + 3, r * 0.55, r * 0.5) | ell(tx + 2 + r * 0.6, cy + 3.5, r * 0.6, r * 0.5)
    fill(crown, 'G')
    fill(cells(crown, lambda x, y: ((x, y + 3) not in crown or (x - 3, y) not in crown) and (x + y) % 2 == 0), 'K')
    fill(cells(crown, lambda x, y: (x * 3 + y * 5) % 11 == 0 and (x + 2, y - 2) in crown and (x, y + 3) in crown), 'Y')
    fill(edge(crown), 'K')

# ベンチ（ななめ）
def bench(x0, gy, w=16):
    seat = poly([(x0 + 2, gy - 9), (x0 + w + 2, gy - 9), (x0 + w, gy - 6), (x0, gy - 6)])
    back = rect(x0 + 2, gy - 16, x0 + w + 2, gy - 15) | rect(x0 + 2, gy - 12, x0 + w + 2, gy - 11)
    for lx in (x0 + 1, x0 + w - 2):
        fill(rect(lx, gy - 6, lx + 1, gy), 'K')
    for lx in (x0 + 3, x0 + w + 1):
        fill(rect(lx, gy - 16, lx, gy - 9), 'K')
    shape(back, 'C', hi='O', hw=2); shape(seat, 'C', hi='O', hw=2)

# うみべ：空・海（なみ）・すな
def bg_beach(sy=18, gy=28, top=3):
    sky(top, sy)
    sea = rect(0, sy, 63, gy)
    fill(sea, 'S'); fill(rect(0, sy, 63, sy + 2), 'B')
    fill(cells(sea, lambda x, y: y > sy + 2 and (x + 3 * y) % 9 < 3 and y % 3 == 0), 'B')
    fill(cells(sea, lambda x, y: y >= gy - 1 and (x // 3 + y) % 2 == 0), 'W')
    sand = {(x, y) for (x, y) in ALL if y > gy + 1.0 * math.sin(x / 6.0)}
    fill(sand, 'Y')
    for (x, y) in sand:
        if (x * 7 + y * 5) % 13 == 0: put(x, y, 'O')
    fill(cells(sand, lambda x, y: (x, y - 1) not in sand), 'W')
    return sand

# パラソル
def parasol(px, gy, ty=2, r=11):
    fill(line(px, ty + 2, px, gy, 0) | line(px + 1, ty + 2, px + 1, gy, 0), 'K')
    top_ = poly([(px - r, ty + 7), (px + .5, ty), (px + r + 1, ty + 7)]) | ell(px + .5, ty + 6, r + .5, 1.5)
    fill(top_, lambda x, y: 'R' if int((math.atan2(x + .5 - px - .5, y + .5 - ty) * 6)) % 2 == 0 else 'W')
    fill(cells(top_, lambda x, y: (x, y + 1) not in top_), 'P')
    fill(edge(top_), 'K')
    fill(ell(px + .5, gy, 3, 1), 'K')

# ゆきやま：空（雪のつぶ）・山・雪の地面
def bg_snow(gy=30, top=3, peaks=((14, 6, 18, 16), (52, 9, 16, 20))):
    sk = rect(0, top, 63, gy + 2)
    fill(sk, 'S')
    fill(cells(sk, lambda x, y: (x * 5 + y * 3) % 17 == 0 and y < gy - 4), 'W')
    for (px, py, wl, wr) in peaks:
        m = poly([(px - wl, gy + 1), (px, py), (px + wr, gy + 1)])
        fill(m, 'W')
        fill(cells(m, lambda x, y: x > px + (y - py) * 0.25), 'S')
        low = cells(m, lambda x, y: y > py + 8 + (2 if (x // 2) % 2 else 0))
        fill(cells(low, lambda x, y: x > px + (y - py) * 0.25), 'B')
        fill(cells(low, lambda x, y: x <= px + (y - py) * 0.25 and (x + y) % 3 == 0), 'S')
        fill(edge(m) - cells(m, lambda x, y: y >= gy), 'K')
    ground = {(x, y) for (x, y) in ALL if y >= gy + 2.5 * math.sin(x / 9.0)}
    fill(ground, 'W')
    for (x, y) in ground:
        if (y - gy - 2.5 * math.sin(x / 9.0)) < 1.2: put(x, y, 'K')
    return ground

def fir(tx, gy, top=14):
    fill(rect(tx, gy - 5, tx + 1, gy), 'C'); fill(rect(tx + 1, gy - 5, tx + 1, gy), 'K')
    n = 3; span = gy - 5 - top
    for i in range(n):
        ty = top + i * span // (n + 0.4); hw = 3 + i * 2.5; hh = span // n + 2
        t = poly([(tx + .5 - hw, ty + hh), (tx + 1, ty), (tx + 1.5 + hw, ty + hh)])
        fill(t, 'G')
        fill(cells(t, lambda x, y: x < tx and (x + y) % 2 == 0), 'K')
        fill(cells(t, lambda x, y: y <= ty + 1 or (y == ty + hh - 1 and x % 3 != 0)), 'W')
        fill(edge(t) - cells(t, lambda x, y: y <= ty + 1), 'K')

# イーゼル と 紙（art(x0, y0, x1, y1) が 中の絵を描く）
def easel(x0, y0, x1, y1, gy, art):
    mx = (x0 + x1) // 2
    fill(line(mx - 1, y0 - 2, x0 - 2, gy, 2), 'C'); fill(line(mx, y0 - 2, x1 + 2, gy, 2), 'C')
    fill(line(mx, y0, mx + 1, gy - 2, 2), 'K')
    fill(rect(x0 - 2, y1 + 1, x1 + 2, y1 + 2), 'C'); fill(rect(x0 - 2, y1 + 2, x1 + 2, y1 + 2), 'K')
    paper = rect(x0, y0, x1, y1)
    fill(paper, 'W'); fill(cells(paper, lambda x, y: x == x1 - 1), 'S')
    art(x0 + 1, y0 + 1, x1 - 1, y1 - 1)
    fill(edge(paper), 'K')

def art_rainbow(x0, y0, x1, y1):
    cx = (x0 + x1) / 2 + .5; cy = y1 + 1
    for (r, c) in ((8.5, 'R'), (7.3, 'O'), (6.1, 'Y'), (4.9, 'G'), (3.7, 'B')):
        fill(ell(cx, cy, r, r * 0.9) & rect(x0, y0, x1, y1) - ell(cx, cy, r - 1.2, (r - 1.2) * 0.9), c)

# ふで（え のぐ つき）・パレット
def brush(x0, y0, x1, y1, tip='R'):
    fill(line(x0, y0, x1, y1), 'C')
    fill(line(x0, y0 + 1, x1, y1 + 1) - line(x0, y0, x1, y1), 'K')
    fill({(x1, y1), (x1 + (1 if x1 > x0 else -1), y1), (x1, y1 + 1)}, tip)

def palette(cx, cy, cols='RYBG'):
    m = ell(cx, cy, 5, 3.2) - ell(cx - 3, cy + 1.6, 1.2, 1)
    shape(m, 'O', sh='C', sw=1)
    for (dx, dy), c in zip(((-2, -1), (0, -2), (2, -1), (3, 1)), cols):
        fill({(int(cx + dx), int(cy + dy)), (int(cx + dx) + 1, int(cy + dy))}, c)

# ---- 主役：すわった形（右むき 斜め）。kind = panda / kuma / neko / inu / usagi ----
SKIN = {'panda': ('W', 'S', None), 'kuma': ('C', None, 'O'), 'neko': ('O', None, 'Y'),
        'inu': ('W', 'S', None), 'usagi': ('W', 'S', None)}

def blob(m, kind, dark=False):
    c, sh, hi = SKIN[kind]
    if kind == 'panda' and dark:
        shape(m, 'K', o='K'); fill(cells(m, lambda x, y: (x - 1, y) in m and (x, y + 1) in m and (x + 1, y) in m and (x, y - 1) in m and ((x + 2, y) not in m or (x, y - 2) not in m) and (x + y) % 2 == 0), 'B')
        return
    shape(m, c, sh=sh, sw=2)
    if hi: fill(cells(m, lambda x, y: (x, y - 2) not in m and (x, y - 1) in m and (x - 2, y) in m and (x + 2, y) in m), hi)

def animal(kind, cx, by, armB=None, armF=None, eyes='open', mouth='smile', look=1, hold=None, up=False, kick=(0, 0)):
    """cx＝体の まんなか、by＝足の下。armB＝奥のうでの先、armF＝手前のうでの先。"""
    hx, hy = cx + 1, by - 27
    footB = ell(cx - 6, by - 2.5, 4.6, 2.8); footF = ell(cx + 7 + kick[0], by - 2.3 + kick[1], 5, 2.9)
    body = ell(cx, by - 12, 11, 10.5)
    head = ell(hx, hy, 10.5, 8.6)
    # 耳（奥）
    if kind == 'usagi':
        for (ex, ang) in ((hx - 3, -12), (hx + 4, 14)):
            e = ell(ex, hy - 13, 2.8, 8, ang); blob(e, kind)
            fill(ell(ex + (-0.4 if ang < 0 else 0.4), hy - 12.5, 1.1, 5.5, ang) - edge(e), 'P')
    elif kind == 'neko':
        for (ex, d) in ((hx - 6, -1), (hx + 6, 1)):
            e = poly([(ex - 4, hy - 4), (ex + d * 1.5, hy - 12), (ex + 4, hy - 4)]); blob(e, kind)
            fill(poly([(ex - 1.8, hy - 5), (ex + d * 1.2, hy - 9.5), (ex + 1.8, hy - 5)]), 'P')
    elif kind in ('kuma', 'panda'):
        for ex in (hx - 7.5, hx + 7.5):
            e = ell(ex, hy - 7, 3.8, 3.8); blob(e, kind, dark=True)
            if kind == 'kuma': fill(ell(ex, hy - 6.7, 1.9, 1.9), 'P')
    # しっぽ（奥）
    if kind == 'neko':
        t = line(cx - 10, by - 3, cx - 17, by - 14, 4) | line(cx - 17, by - 14, cx - 15, by - 20, 4); blob(t, kind)
        fill(cells(t, lambda x, y: y % 3 == 0) - edge(t), 'C')
    elif kind == 'inu':
        t = ell(cx - 12, by - 9, 2.2, 4.5, -35); shape(t, 'C')
    elif kind in ('usagi', 'panda'):
        t = ell(cx - 11, by - 5, 2.6, 2.4); blob(t, kind, dark=(kind == 'panda'))
    # 奥のうで
    if armB:
        a = line(cx - (9 if up else 6), by - 17, armB[0], armB[1], 5); blob(a, kind, dark=True)
    if armF and up:
        a = line(cx + 9, by - 17, armF[0], armF[1], 5); blob(a, kind, dark=True)
    blob(footB, kind, dark=True)
    blob(body, kind)
    if kind == 'kuma':
        bl = ell(cx + 1, by - 10, 6.5, 6.5) & body
        fill(bl, 'O'); fill(cells(bl, lambda x, y: (x + 1, y - 1) not in bl), 'Y')
    if kind == 'neko':
        bl = ell(cx + 2, by - 11, 5.5, 7) & body
        fill(bl - edge(body), 'W')
        for k in range(3):
            fill(cells(body, lambda x, y: x < cx - 4 and abs(y - (by - 18 + k * 4) + (x - cx) * 0.3) < 0.8) - edge(body), 'C')
    if kind == 'inu':
        fill(ell(cx - 5, by - 15, 5, 4) & body - edge(body), 'C')
    if kind == 'panda':  # かたの くろい帯
        band = (ell(cx, by - 19, 11, 3.2) & body) | (ell(cx, by - 18.5, 10.5, 3.6) & body)
        fill(band, 'K')
    fill(edge(body), 'K')
    blob(footF, kind, dark=True)
    if kind in ('kuma',): fill(ell(cx + 7.5 + kick[0], by + kick[1] - 2.2, 2.4, 1.4), 'O')
    if kind == 'panda': fill(ell(cx + 7.5 + kick[0], by + kick[1] - 2.4, 2.2, 1.3), 'C')
    # あたま
    blob(head, kind)
    if kind == 'neko':
        for k in (-2, 0, 2):
            fill(cells(head, lambda x, y: x == hx + look + k and hy - 8 < y < hy - 5 + (k == 0)), 'C')
        fill(ell(hx + 1.5 * look, hy + 3.5, 4.5, 2.8) & head - edge(head), 'W')
    fill(edge(head), 'K')
    if kind == 'inu':  # たれ耳と 目の ぶち
        fill(ell(hx + 5 * look, hy - 2, 3, 2.6) & head - edge(head), 'C')
    if kind == 'kuma':
        mz = ell(hx + 1.5 * look, hy + 3.5, 4.6, 3.2)
        fill(mz, 'W'); fill(cells(mz, lambda x, y: (x, y + 1) not in mz), 'S'); fill(edge(mz), 'K')
    # 目
    ex1, ex2, ey = hx - 4 + look, hx + 5 + look, hy - 1
    for i, ex in enumerate((ex1, ex2)):
        if kind == 'panda':
            p = ell(ex + .5, ey + 1.5, 2.6, 3.3, 25 if i == 0 else -25); fill(p, 'K')
            if eyes == 'open': fill({(ex, ey), (ex + 1, ey)}, 'W'); put(ex, ey + 1, 'W')
            else: fill({(ex - 1, ey + 1), (ex, ey + 2), (ex + 1, ey + 2), (ex + 2, ey + 1)}, 'W')
        else:
            if eyes == 'open':
                fill(ell(ex + .5, ey + 1, 1.3, 1.9), 'K'); put(ex, ey, 'W')
            else:
                fill({(ex - 1, ey + 1), (ex, ey + 2), (ex + 1, ey + 2), (ex + 2, ey + 1)}, 'K')
    # 鼻と 口
    nx, ny = hx + 2 * look, hy + 2
    fill({(nx, ny), (nx + 1, ny), (nx, ny + 1), (nx + 1, ny + 1)} if kind in ('kuma', 'inu', 'panda') else {(nx, ny), (nx + 1, ny)},
         'K' if kind != 'usagi' and kind != 'neko' else 'P')
    if mouth == 'smile':
        fill({(nx - 2, ny + 2), (nx - 1, ny + 3), (nx, ny + 2), (nx + 1, ny + 2), (nx + 2, ny + 3), (nx + 3, ny + 2)}, 'K')
    elif mouth == 'open':
        fill(rect(nx - 1, ny + 2, nx + 2, ny + 4), 'K'); fill({(nx, ny + 4), (nx + 1, ny + 4), (nx, ny + 3), (nx + 1, ny + 3)}, 'R')
    elif mouth == 'line':
        fill({(nx - 1, ny + 3), (nx, ny + 3), (nx + 1, ny + 3), (nx + 2, ny + 3)}, 'K')
    # ほっぺ
    fill({(ex1 - 3, hy + 3), (ex1 - 2, hy + 3), (ex2 + 3, hy + 3), (ex2 + 4, hy + 3)}, 'P')
    if kind == 'inu':  # たれ耳（手前）と くびわ
        for (ex, ang) in ((hx - 9, 18), ):
            e = ell(ex, hy + 1, 3.2, 6.5, ang); shape(e, 'C'); fill(cells(e, lambda x, y: (x - 1, y) not in e) - edge(e), 'O')
        col = ell(cx + 1, by - 18.5, 9, 1.6) - head
        fill(col, 'R'); fill(edge(col) & cells(col, lambda x, y: (x, y + 1) not in col), 'K')
        fill({(cx - 4, by - 17), (cx - 3, by - 17), (cx - 4, by - 16), (cx - 3, by - 16)}, 'Y')
    if kind == 'neko':
        for d in (-1, 1):
            fill(line(hx + 1.5 * look + d * 6, hy + 2, hx + 1.5 * look + d * 9, hy + 1), 'K')
    # 手前のうで
    if hold == 'back': pass
    if armF and not up:
        a = line(cx + 5, by - 17, armF[0], armF[1], 5); blob(a, kind, dark=True)
    return head, body

def art_sea(x0, y0, x1, y1):   # 海と おひさま と ヨット
    fill(rect(x0, y0 + (y1 - y0) // 2, x1, y1), 'B')
    fill(cells(rect(x0, y0 + (y1 - y0) // 2 + 1, x1, y1), lambda x, y: (x + y) % 4 == 0), 'S')
    fill(ell(x0 + 3.5, y0 + 3, 2.6, 2.6), 'Y'); fill(cells(ell(x0 + 3.5, y0 + 3, 2.6, 2.6), lambda x, y: (x + 1, y + 1) not in ell(x0 + 3.5, y0 + 3, 2.6, 2.6)), 'O')
    sx = x1 - 6; sy = y0 + (y1 - y0) // 2
    fill(poly([(sx, sy - 6), (sx, sy), (sx + 4, sy)]), 'R'); fill(rect(sx - 2, sy, sx + 4, sy + 1), 'C')

def art_snowman(x0, y0, x1, y1):   # ゆきだるま と もみの木
    fill(rect(x0, y0, x1, y1), 'S')
    fill(rect(x0, y1 - 2, x1, y1), 'W')
    cx = x0 + 5.5
    fill(ell(cx, y1 - 3.5, 3.6, 3), 'W'); fill(ell(cx, y1 - 8, 2.6, 2.4), 'W')
    put(int(cx) - 1, y1 - 9, 'K'); put(int(cx) + 1, y1 - 9, 'K'); put(int(cx), y1 - 8, 'O')
    fill(rect(int(cx) - 2, y1 - 6, int(cx) + 2, y1 - 6), 'R')
    tx = x1 - 4
    fill(poly([(tx - 3.5, y1 - 2), (tx + .5, y1 - 10), (tx + 4.5, y1 - 2)]), 'G'); fill(rect(tx, y1 - 2, tx, y1 - 1), 'C')
    fill({(tx, y1 - 12), (tx - 1, y1 - 11), (tx, y1 - 11), (tx + 1, y1 - 11), (tx, y1 - 10)}, 'Y')

def art_flower(x0, y0, x1, y1):   # 花 と ちょう
    fill(rect(x0, y1 - 3, x1, y1), 'G')
    for (fx, c) in ((x0 + 3, 'R'), (x0 + 8, 'Y'), (x0 + 13, 'P')):
        fill(line(fx, y1 - 6, fx, y1 - 2), 'G')
        fill({(fx - 1, y1 - 7), (fx + 1, y1 - 7), (fx, y1 - 8), (fx, y1 - 6)}, c); put(fx, y1 - 7, 'O')
    fill({(x1 - 3, y0 + 2), (x1 - 1, y0 + 2), (x1 - 3, y0 + 3), (x1 - 1, y0 + 3)}, 'B'); put(x1 - 2, y0 + 2, 'K'); put(x1 - 2, y0 + 3, 'K')

def art_mountain(x0, y0, x1, y1):   # 雪の山 と おひさま
    fill(rect(x0, y0, x1, y1), 'S')
    m = poly([(x0 - 1, y1 + 1), (x0 + 7, y0 + 3), (x1 + 1, y1 + 1)])
    fill(m, 'B'); fill(cells(m, lambda x, y: y < y0 + 6), 'W')
    fill(ell(x1 - 2.5, y0 + 2.5, 2, 2), 'Y')

def art_sun(x0, y0, x1, y1):   # おひさま と かもめ
    cx, cy = x0 + 5.5, y0 + 5
    for k in range(8):
        a = k * math.pi / 4
        put(int(round(cx - .5 + math.cos(a) * 4.2)), int(round(cy - .5 + math.sin(a) * 4.2)), 'R')
    sun = ell(cx, cy, 2.8, 2.8); fill(sun, 'Y'); fill(cells(sun, lambda x, y: (x + 1, y + 1) not in sun), 'O')
    fill(rect(x0, y1 - 2, x1, y1), 'S'); fill(cells(rect(x0, y1 - 2, x1, y1), lambda x, y: (x + y) % 3 == 0), 'B')
    for (bx, by_) in ((x1 - 4, y0 + 4),):
        fill({(bx - 1, by_), (bx, by_ + 1), (bx + 1, by_), (bx + 2, by_ + 1), (bx + 3, by_)}, 'K')

# すなの おしろ
def sandcastle(x0, gy):
    base = rect(x0, gy - 5, x0 + 11, gy)
    t1 = rect(x0 + 1, gy - 9, x0 + 4, gy - 5); t2 = rect(x0 + 7, gy - 11, x0 + 10, gy - 5)
    m = base | t1 | t2
    for (tx0, ty) in ((x0 + 1, gy - 9), (x0 + 7, gy - 11)):
        m |= {(tx0, ty - 1), (tx0 + 3, ty - 1)}
    shape(m, 'O', hi='Y', hw=2)
    fill({(x0 + 5, gy - 2), (x0 + 6, gy - 2), (x0 + 5, gy - 1), (x0 + 6, gy - 1), (x0 + 5, gy), (x0 + 6, gy)}, 'K')
    fill(line(x0 + 9, gy - 12, x0 + 9, gy - 16), 'K'); fill({(x0 + 10, gy - 16), (x0 + 11, gy - 16), (x0 + 10, gy - 15)}, 'R')

# ボール（あか と しろの しま。上に うごきの線）
def ball(cx, cy, r=4.5, lines=True):
    b = ell(cx, cy, r, r)
    fill(b, 'R')
    for (x, y) in b:
        if abs(y + .5 - (cy + .5 + 0.07 * (x + .5 - cx) ** 2)) < 0.9: put(x, y, 'W')
    fill(cells(b, lambda x, y: (x - 1, y + 2) not in b and (x, y - 3) in b and x < cx), 'C')
    fill({(int(cx) + 1, int(cy - r) + 2), (int(cx) + 2, int(cy - r) + 2), (int(cx) + 2, int(cy - r) + 3)}, 'W')
    fill(edge(b), 'K')
    if lines:
        for (a, b_, c, d) in ((cx + r + 2, cy - 2, cx + r + 4, cy - 3), (cx + r + 2, cy + 1, cx + r + 5, cy + 1), (cx + r + 1, cy + 4, cx + r + 3, cy + 5)):
            fill(line(int(a), int(b_), int(c), int(d)), 'K')

# クッキー（チョコの つぶ。かじった あと つき）
def cookie(cx, cy, r=3.5, bite=True):
    m = ell(cx, cy, r, r * 0.9)
    if bite: m -= ell(cx + r * 0.9, cy - r * 0.6, r * 0.45, r * 0.45)
    fill(m, 'Y'); fill(cells(m, lambda x, y: (x - 1, y + 1) not in m), 'O')
    fill(cells(m, lambda x, y: (x * 3 + y * 5) % 7 == 0) - edge(m), 'C')
    fill(edge(m), 'K')


# ---- 絵 C の部品（119〜126 面）：はなばたけ・おどる・ねている形・だいどころ ----
def mv(m, dx, dy):
    return {(x + dx, y + dy) for x, y in m}

def thick(pts, r):
    s = set()
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0), 1) * 2)
        for i in range(n + 1):
            s |= ell(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, r)
    return s

def erode(m):
    return m - edge(m)

# はなばたけ：空・おくの丘・一面の花（おくは小さく、手前は大きく）・小道
def bg_flower(gy=26, top=3, path=None, clouds=((10, 4, 1.0), (46, 6, 0.8))):
    sky(top, gy)
    for (cx, cy, s_) in clouds: cloud(cx, top + cy, s_)
    hill = {(x, y) for (x, y) in ALL if y >= gy - 3 + 2.2 * math.sin(x / 9.0 + 1)}
    fill(hill, 'G'); fill(cells(hill, lambda x, y: (x, y - 1) not in hill), 'K')
    fill(cells(hill, lambda x, y: (x, y - 1) in hill and (x + y) % 2 == 0 and y < gy + 1), 'K')
    field = cells(hill, lambda x, y: y > gy + 1)
    fill(field, 'G')
    cols = 'RYPWO'
    for (x, y) in field:
        d = y - gy                                   # 手前ほど 大きく まばらに
        if d < 6:
            if (x * 3 + y * 7) % 4 == 0: put(x, y, cols[(x // 2 + y) % 5])
            elif (x + 2 * y) % 5 == 0: put(x, y, 'K')
    for (x, y) in field:
        if path and path(x, y): put(x, y, 'O')
    if path:
        p = cells(field, lambda x, y: path(x, y))
        fill(cells(p, lambda x, y: (x + y * 3) % 7 == 0), 'Y')
        fill(edge(p) - cells(p, lambda x, y: y >= H - 1), 'C')
    return field

def flower_row(y, x0, x1, step, cols, size=1, path=None, skip=()):
    """花の列（くき・葉・花びら）。size 1＝小さい・2＝大きい"""
    i = 0
    for x in range(x0, x1 + 1, step):
        if path and path(x, y): i += 1; continue
        if any(a <= x <= b for a, b in skip): i += 1; continue
        c = cols[i % len(cols)]; i += 1
        jy = y + (1 if i % 2 else 0)
        if size == 1:
            fill(line(x, jy, x, jy + 2), 'G'); put(x - 1, jy + 2, 'K')
            fill({(x - 1, jy), (x + 1, jy), (x, jy - 1)}, c); put(x, jy, 'Y' if c != 'Y' else 'O')
        else:
            tulip(x, jy + 5, c)

def tulip(x, by, c='R'):
    fill(line(x, by - 4, x, by), 'G'); fill({(x - 1, by - 1), (x - 2, by - 2), (x + 1, by - 2)}, 'G')
    put(x - 1, by, 'K')
    hd = {(x - 1, by - 7), (x, by - 7), (x + 1, by - 7), (x - 1, by - 6), (x, by - 6), (x + 1, by - 6), (x - 1, by - 8), (x + 1, by - 8)}
    fill(hd, c); put(x + 1, by - 7, 'W' if c != 'W' else 'Y'); fill({(x - 1, by - 5), (x, by - 5), (x + 1, by - 5)}, 'K')

def sunflower(x, by, top, r=3.4):
    st = rect(x, top + 2, x + 1, by); fill(st, 'G'); fill(cells(st, lambda a, b: a == x + 1), 'K')
    for (lx, ly, d) in ((x - 3, top + 10, -1), (x + 4, top + 14, 1)):
        lf = ell(lx + .5, ly, 2.6, 1.4, 25 * d); fill(lf, 'G'); fill(edge(lf), 'K')
    pet = ell(x + 1, top, r + 2.3, r + 2.3)
    fill(pet, 'Y'); fill(cells(pet, lambda a, b: (a + b) % 3 == 0), 'O')
    fill(edge(pet), 'K')
    cen = ell(x + 1, top, r, r); fill(cen, 'C'); fill(cells(cen, lambda a, b: (a + b) % 2 == 0), 'K')
    fill(cells(cen, lambda a, b: (a - 1, b + 1) not in cen and (a + b) % 2 == 1), 'O')

def butterfly(x, y, c='P'):
    fill({(x - 2, y - 1), (x - 1, y - 1), (x - 2, y), (x - 1, y), (x - 1, y + 1),
          (x + 1, y - 1), (x + 2, y - 1), (x + 1, y), (x + 2, y), (x + 1, y + 1)}, c)
    fill({(x, y - 1), (x, y), (x, y + 1), (x - 1, y - 2), (x + 1, y - 2)}, 'K')
    put(x - 2, y - 1, 'W' if c != 'W' else 'Y')

def note(x, y, c='K'):
    """音符（たま x,y の 2×2。ぼうは右うえへ 4、はた つき）"""
    fill({(x - 1, y), (x, y), (x - 1, y + 1), (x, y + 1), (x - 2, y + 1)}, c)
    fill(line(x, y - 4, x, y), c); fill({(x + 1, y - 3), (x + 2, y - 2)}, c)

def note2(x, y, c='K'):
    """2 つ つながった音符（たまは x,y と x+4,y）"""
    for dx in (0, 4):
        fill({(x + dx - 1, y), (x + dx, y), (x + dx - 1, y + 1), (x + dx, y + 1), (x + dx - 2, y + 1)}, c)
        fill(line(x + dx, y - 4, x + dx, y), c)
    fill(rect(x, y - 4, x + 4, y - 3), c)

def swish(pts, c='K'):
    """うごきの線（点を つなぐ）"""
    for (a, b), (p, q) in zip(pts, pts[1:]):
        fill(line(a, b, p, q), c)

def dancer(kind, cx, by, lift=6, kick=(6, -4), armB=None, armF=None, **kw):
    """おどる主役：片足で立ち、もう片足を けり上げ、両手を ひろげる。"""
    dk = (kind == 'panda')
    lb = line(cx - 5, by - lift - 4, cx - 4, by - 3, 5); blob(lb, kind, dark=True)
    fb = ell(cx - 4, by - 2.4, 4.6, 2.6); blob(fb, kind, dark=True)
    if kind == 'kuma': fill(ell(cx - 3.5, by - 2.2, 2.2, 1.2), 'O')
    lf = line(cx + 4, by - lift - 6, cx + 7 + kick[0], by - lift - 2.3 + kick[1], 5); blob(lf, kind, dark=True)
    return animal(kind, cx, by - lift, armB=armB, armF=armF, up=True, kick=kick, **kw)

# ねている主役（いぬ以外。左に頭、からだは右へ）
KIND = {
    'kuma':  dict(base='C', sh='K', hi='O', limb='C', pad='O'),
    'panda': dict(base='W', sh='S', hi=None, limb='K', pad=None),
    'usagi': dict(base='W', sh='S', hi=None, limb='W', pad='P'),
    'neko':  dict(base='O', sh='C', hi='Y', limb='O', pad='P'),
}

def eye_shut(kind, ex, ey):
    if kind == 'panda':
        fill(ell(ex, ey, 3, 3), 'K')
        fill({(ex - 1, ey), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'W')
    else:
        fill({(ex - 2, ey - 1), (ex - 1, ey), (ex, ey), (ex + 1, ey), (ex + 2, ey - 1)}, 'K')

def lie(kind, dx=0, dy=0, shadow_c='O'):
    k = KIND[kind]; S = lambda m: mv(m, dx, dy)
    fill(S(ell(32, 46, 27, 1.5)), shadow_c)
    if kind == 'neko':
        shape(S(thick([(54, 42), (60, 40), (61, 34)], 1.6)), 'O'); fill(S({(60, 37), (61, 37), (61, 35)}), 'C')
    elif kind in ('usagi', 'panda'):
        shape(S(ell(56, 37, 3, 3)), 'W', sh='S' if kind == 'usagi' else None)
    elif kind == 'kuma':
        shape(S(ell(56, 37, 2.5, 2.5)), 'C')
    shape(S(ell(51, 42, 6, 4)), k['limb'])
    body = S(ell(36, 37, 19, 8.5)); shape(body, k['base'], sh=k['sh'])
    if k['hi']: fill({(x, y) for x, y in body if (x, y - 2) not in body and (x, y) not in edge(body) and x > 30}, k['hi'])
    if kind == 'panda':
        fill(S(ell(33, 37, 4, 9)) & body, "K")
    elif kind == 'neko':
        for sx in (36, 42, 48): fill(S(line(sx, 30, sx + 1, 34)), 'C')
    shape(S(ell(51, 42, 6, 4)), k['limb'])
    if kind == 'usagi':
        for pts in ([(20, 27), (38, 24), (44, 26), (39, 29), (22, 31)], [(19, 24), (34, 18), (41, 18), (38, 22), (22, 28)]):
            e = S(poly(pts)); shape(e, 'W', sh='S'); fill(erode(erode(e)), 'P')
    elif kind in ('kuma', 'panda'):
        for ex, ey in ((9, 26), (26, 25)):
            shape(S(ell(ex, ey, 4, 4)), k['limb'])
            if kind == 'kuma': fill(S(ell(ex, ey + .5, 2, 2)), 'P')
    else:
        for pts in ([(6, 31), (6, 19), (15, 26)], [(21, 25), (29, 19), (30, 30)]):
            e = S(poly(pts)); shape(e, 'O'); fill(erode(erode(e)), 'P')
    head = S(ell(18, 34, 12, 9.5)); shape(head, k['base'], sh=k['sh'])
    if k['hi']: fill({(x, y) for x, y in head if (x, y - 2) not in head and (x, y) not in edge(head) and x > 14}, k['hi'])
    if kind == 'kuma':
        mz = S(ell(18, 38.5, 5, 3.6)); fill(mz, 'W'); fill(edge(mz), 'K')
    elif kind == 'neko':
        mz = S(ell(18, 38.5, 5, 3.3)); fill(mz, 'W')
        for a, b in (((12, 37), (5, 36)), ((12, 39), (5, 40)), ((24, 37), (31, 36)), ((24, 39), (31, 40))):
            fill(S(line(*a, *b)), 'K')
    nc = 'P' if kind in ('usagi', 'neko') else 'K'
    fill(S(rect(17, 36, 19, 37)), nc); put(18 + dx, 38 + dy, 'K')
    fill(S({(16, 39), (17, 40), (18, 39), (19, 40), (20, 39)}), 'K')
    eye_shut(kind, 12 + dx, 33 + dy); eye_shut(kind, 24 + dx, 33 + dy)
    fill(S(ell(9, 37, 2, 1.1)) | S(ell(27, 37, 2, 1.1)), 'P')
    for cx, cy in ((11, 43), (24, 44)):
        f = S(ell(cx, cy, 4, 2.5)); shape(f, k['limb'])
        if k['pad']: fill(S({(cx - 1, cy), (cx + 1, cy)}), k['pad'])

def inu_lie(dx=0, dy=0, shadow_c='K'):
    """ふせて ねむる いぬ（左むき）。白い体・ちゃいろの ぶち・たれ耳・あかい首輪。"""
    S = lambda m: mv(m, dx, dy)
    fill(S(ell(35, 45, 25, 1.5)), shadow_c)
    tail = S(ell(57, 24, 2.6, 6, 35)); shape(tail, 'C'); fill({(x, y) for x, y in tail if (x - 1, y) not in tail} - edge(tail), 'O')
    body = S(ell(39, 33, 19, 10))
    WS = lambda m: {(x, y) for x, y in m if (x, y + 2) not in m or (x + 3, y) not in m}
    shape(body, 'W'); fill(WS(body) - edge(body), 'S')
    spot = (S(ell(44, 27, 7, 4.5)) | S(ell(51, 34, 3.5, 3.5))) & (body - edge(body))
    fill(spot, 'C')
    hind = S(ell(50, 41, 8, 4)); shape(hind, 'W'); fill({(x, y) for x, y in hind if (x, y + 1) not in hind} - edge(hind), 'S')
    fill(S({(43, 42), (45, 43)}), 'K')
    for p in (S(ell(12, 41, 7, 2.6)), S(ell(16, 43.5, 7, 2.4))):
        shape(p, 'W'); fill({(x, y) for x, y in p if (x, y + 1) not in p} - edge(p), 'S')
    fill(S({(6, 41), (8, 41), (10, 44), (12, 44)}), 'K')
    col = S(ell(31, 32, 2.3, 8.5, 8)) & (body - edge(body)); fill(col, 'R'); fill({(x, y) for x, y in col if (x + 1, y) not in col}, 'K')
    fill(S(ell(31, 38, 1.4, 1.4)), 'Y'); fill(edge(S(ell(31, 38, 1.4, 1.4))), 'K')
    hs = S(ell(19, 30, 11, 9) | ell(9, 35, 6.5, 4))
    shape(hs, 'W'); fill({(x, y) for x, y in hs if (x, y + 2) not in hs} - edge(hs), 'S')
    fill(S(ell(15, 26, 3.6, 3)), 'C')
    fill(S({(12, 28), (13, 29), (14, 29), (15, 29), (16, 29), (17, 28)}), 'K')
    fill(S(rect(3, 33, 5, 34) | {(4, 35)}), 'K'); put(4 + dx, 33 + dy, 'W')
    fill(S(line(6, 38, 12, 38)), 'K')
    fill(S(rect(13, 33, 16, 33)), 'P')
    ear = S(ell(25, 32, 4, 8.5, -15))
    shape(ear, 'C'); fill({(x, y) for x, y in ear if (x - 1, y) not in ear} - edge(ear), 'O')

# だいどころ：床（タイル）・かべ・腰板
def bg_kitchen(FY=36, top=0, wall='W'):
    fill(rect(0, top, 63, FY - 1), wall)
    fill(cells(rect(0, top, 63, FY - 7), lambda x, y: (x % 8 == 0 or (y - top) % 8 == 0)), 'S')
    fill(rect(0, FY - 6, 63, FY - 1), 'Y'); fill({(x, y) for x in range(W) for y in range(FY - 6, FY) if x % 6 == 0}, 'O')
    fill({(x, FY - 6) for x in range(W)}, 'K')
    for y in range(FY, H):
        for x in range(W):
            u = (x - 30) * 10 / (y - FY + 10)
            put(x, y, 'B' if (math.floor(u / 4) + (y - FY) // 3) % 2 == 0 else 'W')
    fill({(x, FY) for x in range(W)}, 'K')

# ---- この絵 ----
# こうえんで くまが おどる：こうえんの しばふで、くまが 片足を 上げ 両手を ふって おどる。場所の物は 木 と すべりだい。
GY = 31
bg_park(GY, top=11, clouds=((26, 2, 0.8),))
park_tree(2, GY, cy=16, r=8)
# すべりだい（右。はしご と すべる所）
for lx in (47, 52):
    fill(rect(lx, 15, lx + 1, GY + 6), 'C'); fill(rect(lx + 1, 15, lx + 1, GY + 6), 'K')
for y in range(18, GY + 6, 3):
    fill(rect(48, y, 51, y), 'O')
fill(rect(46, 14, 56, 15), 'Y'); fill(edge(rect(46, 14, 56, 15)), 'K')
sl = line(55, 16, 63, GY + 4, 3.6); fill(sl, 'R'); fill(cells(sl, lambda x, y: (x + 1, y - 1) not in sl), 'W'); fill(edge(sl), 'K')
fill(rect(46, 11, 46, 13) | rect(56, 11, 56, 13), 'K')
fill(ell(55, GY + 7, 9, 1), 'K')
shadow(27, 46, 12, 1.5, 'GKWY', 'K', 1.0)
head, body = dancer('kuma', 26, 46, lift=5, kick=(7, -5), armB=(10, 14), armF=(41, 13), mouth='open')
for (px, py) in ((10, 14), (41, 13)):
    fill(ell(px, py, 2.6, 2.4), 'C'); fill(edge(ell(px, py, 2.6, 2.4)), 'K'); fill({(px, py), (px + 1, py)}, 'O')
note(6, 4, 'K'); note2(40, 4, 'B'); note(43, 25, 'R'); note(8, 27, 'Y')
swish([(43, 9), (45, 11), (45, 14)])
swish([(43, 37), (45, 39), (45, 42)])
finish('kumakouenodoru', 'G')
