# こうえんで くまが ねむる（kumakouennemuru・段 L）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 <id>.txt を書き出す（見本 kumadaidokorooyatsu.py と同じ作り方）
import os, math, sys
g = None
W = H = 0

def canvas(w, h):
    global g, W, H
    W, H = w, h
    g = [['.'] * W for _ in range(H)]

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def get(x, y):
    return g[y][x] if 0 <= x < W and 0 <= y < H else '.'

def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            u = (dx * ca + dy * sa) / rx; v = (-dx * sa + dy * ca) / ry
            if u * u + v * v <= 1.0:
                s.add((x, y))
    return s

def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(max(0, y0), min(H - 1, y1) + 1) for x in range(max(0, x0), min(W - 1, x1) + 1)}

def poly(pts):
    s = set(); n = len(pts)
    for y in range(H):
        for x in range(W):
            px, py = x + .5, y + .5; ins = False
            for i in range(n):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                    ins = not ins
            if ins: s.add((x, y))
    return s

def line(x0, y0, x1, y1, w=0):
    s = set(); n = int(max(abs(x1 - x0), abs(y1 - y0), 1) * 2)
    r = int(math.ceil(w))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n; y = y0 + (y1 - y0) * i / n
        for oy in range(-r, r + 1):
            for ox in range(-r, r + 1):
                if ox * ox + oy * oy <= w * w + .01:
                    s.add((int(round(x + ox)), int(round(y + oy))))
    return {(x, y) for x, y in s if 0 <= x < W and 0 <= y < H}

def fill(m, c):
    for x, y in m: put(x, y, c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def ring(m):
    """m のすぐ外がわ 1 マス"""
    return {(x + dx, y + dy) for x, y in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (x + dx, y + dy) not in m and 0 <= x + dx < W and 0 <= y + dy < H}

def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗って、かげ（右下）・明るい所（左上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m)
              and (x + d, y) in m and (x, y + d) in m}, hi)
    if o:
        fill(edge(m), o)

def dither(m, c, k=2):
    fill({(x, y) for x, y in m if (x + y) % k == 0}, c)

def z(x, y, n, c='K'):
    fill(line(x, y, x + n, y) | line(x + n, y, x, y + n) | line(x, y + n, x + n, y + n), c)

def finish(name, holec='K'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    n = 0
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out:
                g[y][x] = holec; n += 1
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while rows and all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while rows and all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    print(name, 'holes', n, 'size', len(rows[0]), 'x', len(rows), 'sugar', sum(c != '.' for r in rows for c in r))

# ================= 絵 =================
canvas(64, 48)
# ---- しばふ（ななめ上から見た島。前の面＝土）
lawn = ell(32, 41.3, 29, 4.3)
fill(lawn, 'G')
fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'Y')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C')
fill({(x, y + 1) for x, y in lawn | front if (x, y + 1) not in lawn | front}, 'K')
fill(edge(lawn) & {(x, y) for x, y in lawn if x < 3 or x > 60}, 'K')
for x in range(2, 62, 3):                                              # 奥のふちの草
    ys = [y for (xx, y) in lawn if xx == x]
    if ys: put(x, min(ys) - 1, 'G'); put(x, min(ys) - 2, 'K')
# ---- 木（右奥。こかげ）
trunk = poly([(51, 12), (56, 12), (56.5, 32), (59.5, 37), (47, 37), (50.5, 32)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk - edge(trunk) if x == 55 and y % 3 == 0}, 'K')
leaves = ell(53, 8.5, 9, 6.3) | ell(45.5, 12, 4, 3.3) | ell(60.5, 12.5, 3.5, 3.3)
shape(leaves, 'G')
fill({(x, y) for x, y in leaves - edge(leaves) if (x * 5 + y * 3) % 9 == 0 and y < 9}, 'Y')
fill({(x, y) for x, y in leaves - edge(leaves) if (x, y + 2) not in leaves and (x + y) % 2 == 0}, 'K')
fill({(x, y) for x, y in ell(50, 38.5, 13, 1.8) if get(x, y) in 'GY' and (x + y) % 2 == 0}, 'K')   # こかげ
# ---- くま（あおむけで ねむる。あたまは左）
fill({(x, y) for x, y in ell(30, 41.5, 18, 1.6) if get(x, y) in 'GY'}, 'K')
for cx, cy, ang in ((41, 24, 20), (47, 29, 60)):                       # 後ろ足（上を むく）
    leg = ell(cx, cy, 3.6, 5, ang=ang)
    shape(leg, 'C')
pad1 = ell(42.3, 20.5, 2.6, 2, ang=20); shape(pad1, 'P', o=None)
pad2 = ell(50.5, 27.5, 2.2, 2.4, ang=60); shape(pad2, 'P', o=None)
body = ell(34, 33, 13.5, 7.5)
shape(body, 'C', hi='O', d=1)
belly = ell(33, 30.5, 9, 4.2)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x, y - 1) not in belly or (x - 1, y - 1) not in belly}, 'Y')
fill(edge(belly) & {(x, y) for x, y in belly if y > 31}, 'C')
earL = ell(7, 22.5, 3.8, 3.8); shape(earL, 'C'); fill(ell(7, 22.8, 1.9, 1.9), 'P')
earR = ell(22, 22, 3.8, 3.8); shape(earR, 'C'); fill(ell(22, 22.3, 1.9, 1.9), 'P')
head = ell(14.5, 30.5, 10, 8.5)
shape(head, 'C', hi='O', d=1)
mz = ell(14.5, 34, 4.5, 3.3)
fill(mz, 'W'); fill(edge(mz), 'K')
fill(rect(13, 32, 16, 33) | {(14, 34), (15, 34)}, 'K'); put(13, 32, 'W')   # 鼻
fill({(13, 36), (14, 35), (15, 35), (16, 36)}, 'K')                    # 口
for ex in (9, 20):                                                     # とじた目（下に ふくらむ弧）
    fill({(ex - 2, 28), (ex - 1, 29), (ex, 29), (ex + 1, 29), (ex + 2, 28)}, 'K')
fill(ell(7, 32, 1.8, 1.1) | ell(22, 32, 1.8, 1.1), 'P')
arm = ell(29, 29, 5, 2.4, ang=-15)                                     # おなかの上の うで
shape(arm, 'C'); fill({(25, 29), (26, 28)}, 'O')
# ---- Zz（あたまの上）
z(16, 13, 5); z(24, 8, 4); z(31, 4, 3)
finish('kumakouennemuru', holec='G')
