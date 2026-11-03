# ゆきやまで ぱんだが ねむる（pandayukiyamanemuru・段 XXL・64x48・fuyu）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 pandayukiyamanemuru.txt を書き出す（1 マス＝1 粒）。
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

def eye(x, y, closed=False, big=1.0):
    """目。closed＝ねむっている目（下にまるい線）。"""
    if closed:
        fill({(x - 1, y), (x, y + 1), (x + 1, y + 1), (x + 2, y)}, 'K')
    else:
        fill(ell(x + .5, y + .5, 1.3 * big, 1.9 * big), 'K'); put(x, y - 1, 'W')

def tri(a, b, c):
    return poly([a, b, c])
# 場所の物は ゆきの やま と もみの木 の 2 つ。ねむるは とじた目 と Z。あかい マフラー。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K のふちで区切る）。頬は ピンク。
# ---- 空 ----
fill(rect(0, 9, 63, 27) - rect(0, 9, 4, 10) - rect(58, 9, 63, 9), 'S')
for (x, y) in rect(0, 9, 63, 27):
    if (x * 7 + y * 11) % 19 == 0 and at(x, y) == 'S': put(x, y, 'W')   # ふる ゆき
# ---- ゆきの やま（奥。頂上は しろ）----
mt = poly([(-4, 28), (10, 7), (16, 12), (21, 9), (36, 28)])
fill(mt, 'B')
fill({(x, y) for (x, y) in mt if y < 15 + 1.5 * math.sin(x * 1.3)}, 'W')
fill({(x, y) for (x, y) in mt if x > 11 and y >= 15 + 1.5 * math.sin(x * 1.3) and (x + y) % 3 == 0}, 'S')
fill(edge(mt), 'K')
# ---- もみの木（右）----
tr = rect(55, 22, 57, 30); fill(tr, 'C'); fill(edge(tr), 'K')
for (y0, hw) in ((4, 4), (9, 6), (14, 7.5)):
    t = poly([(56.5, y0), (56.5 + hw, y0 + 9), (56.5 - hw, y0 + 9)]); fill(t, 'G')
    fill({(x, y) for (x, y) in t if x >= 57 and (x + y) % 2 == 0}, 'K')
    fill({(x, y + 8) for x in range(int(56.5 - hw) + 1, int(56.5 + hw)) if (x, y0 + 8) in t for y in (y0,)}, 'W')
    fill(edge(t), 'K')
fill({(56, 3), (56, 4), (55, 4), (57, 4)}, 'Y')                   # ほし
# ---- ゆきの 地面 ----
snow = {(x, y) for (x, y) in ALL if y >= 28 + 1.0 * math.sin(x / 5.0)}
fill(snow, 'W')
for (x, y) in snow:
    if (x * 5 + y * 3) % 13 == 0: put(x, y, 'S')
fill({(x, y) for (x, y) in snow if (x, y - 1) not in snow}, 'K')
# ---- ぱんだ（おなかを つけて ねそべり、くんだ うでに あごを のせて ねむる。顔は 正面）----
shadow(28, 46, 24, 1.6, 'WS', 'S', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
legB = ell(7, 41, 5, 3.6, -15); fill(legB, 'K'); fill(ell(5, 41, 1.6, 1.4), 'C')
body = ell(20, 37, 15, 8)
fill(body, WS(body)); fill(edge(body), 'K')
tail = ell(6, 34, 2, 2); fill(tail, 'W'); fill(edge(tail), 'K')
fill({(x, y) for (x, y) in body if x >= 27}, 'K')                 # かたの くろい所
earB = ell(23, 20, 3.8, 3.8); earF = ell(41, 20, 3.8, 3.8)
fill(earB | earF, 'K'); put(41, 19, 'C'); put(23, 19, 'C'); put(42, 19, 'C'); put(22, 19, 'C')
head = ell(32, 28.5, 11, 8.5)
fill(head, WS(head)); fill(edge(head), 'K')
for (ex, ey, a) in ((27, 27, 20), (37, 27, -20)):
    fill(ell(ex + .5, ey + .8, 3.6, 2.8, a), 'K')                 # 目のまわり（たれ目）
    fill({(ex - 2, ey), (ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'W')   # とじた目
fill(ell(23.5, 31, 1.9, 1) | ell(41, 31, 1.9, 1), 'P')           # ほっぺ
fill(ell(32.5, 30.5, 1.7, 1.1), 'K')                              # はな
fill({(31, 33), (32, 33), (33, 33), (34, 33)}, 'K'); put(30, 32, 'K'); put(35, 32, 'K')   # にっこり くち
# マフラー（あごの下）
muf = ell(32.5, 37, 9.5, 1.8)
fill(muf, 'R'); fill({(x, y) for (x, y) in muf if x % 3 == 0}, 'W'); fill(edge(muf), 'K')
tl = rect(40, 37, 42, 43); fill(tl, 'R'); fill({(40, 43), (42, 43), (41, 41), (41, 39)}, 'W'); fill(edge(tl), 'K')
# くんだ うで（まくら）
for (ax, ay) in ((27, 41.5), (37, 41.5)):
    a = ell(ax, ay, 6.5, 3); fill(a, 'K'); fill({(ax - 4, 41), (ax - 3, 40), (ax + 3, 40)}, 'C')
# Z（ねむって いる）
zz(39, 11, 4); zz(42, 3, 6); zz(37, 17, 3)
finish('pandayukiyamanemuru', 'W')
