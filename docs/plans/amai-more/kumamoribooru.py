# もりで くまが ボールで あそぶ（kumamoribooru・段 XXL・64x48）部品で描いて <id>.txt を書き出す。
import os
W, H = 64, 48
g = [['.'] * W for _ in range(H)]

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def ell(cx, cy, rx, ry):
    return {(x, y) for y in range(H) for x in range(W)
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0}

def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}

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

def line(x0, y0, x1, y1):
    s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        s.add((round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)))
    return s

def thick(pts, r):
    s = set()
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(abs(x1 - x0), abs(y1 - y0), 1) * 2
        for i in range(n + 1):
            s |= ell(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, r)
    return s

def fill(m, c):
    for x, y in m: put(x, y, c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def erode(m):
    return m - edge(m)

def shape(m, c, o='K', sh=None, hi=None):
    """塗って、かげ（左下）・明るい所（右上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x - 2, y) not in m or (x, y + 2) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x + 2, y) not in m or (x, y - 2) not in m)
              and (x - 2, y) in m and (x, y + 2) in m}, hi)
    if o:
        fill(edge(m), o)

def mv(m, dx, dy):
    return {(x + dx, y + dy) for x, y in m}

def zee(x, y, s):
    """ねむりの Z（s マス角）"""
    fill({(x + i, y) for i in range(s)} | {(x + i, y + s - 1) for i in range(s)} | line(x + s - 1, y, x, y + s - 1), 'K')

def flip():
    for r in g: r.reverse()

# ---- 主役（いぬ以外の 4 ひき）----
KIND = {
    'kuma':  dict(base='C', sh='K', hi='O', limb='C', pad='O'),
    'panda': dict(base='W', sh='S', hi=None, limb='K', pad=None),
    'usagi': dict(base='W', sh='S', hi=None, limb='W', pad='P'),
    'neko':  dict(base='O', sh='C', hi='Y', limb='O', pad='P'),
}

def eye_open(kind, ex, ey, rx=1.7):
    if kind == 'panda':
        fill(ell(ex, ey + .5, rx + 1.3, 3.4), 'K')
        fill({(ex, ey - 1), (ex + 1, ey - 1), (ex, ey)}, 'W')
    else:
        fill(ell(ex, ey, rx, 2.2), 'K'); put(ex, ey - 1, 'W')

def eye_shut(kind, ex, ey):
    if kind == 'panda':
        fill(ell(ex, ey, 3, 3), 'K')
        fill({(ex - 1, ey), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'W')
    else:
        fill({(ex - 2, ey - 1), (ex - 1, ey), (ex, ey), (ex + 1, ey), (ex + 2, ey - 1)}, 'K')

def sit(kind, dx=0, dy=0, paw=(38, 25), eyes='open', mouth='smile', shadow='O'):
    """すわった主役。右へ 3/4 むき。paw＝前のうでの手の位置（その場の座標）。"""
    k = KIND[kind]; S = lambda m: mv(m, dx, dy)
    fill(S(ell(20, 46, 15, 1.3)), shadow)
    shape(S(poly([(8, 30), (3, 36), (6, 40), (11, 34)])), k['limb'])               # 奥のうで
    if kind == 'neko':                                                              # しっぽ
        tail = S(thick([(8, 42), (2, 40), (1, 33), (3, 28)], 1.6)); shape(tail, 'O')
        fill(S({(1, 34), (2, 34), (1, 31), (2, 31)}), 'C')
    if kind == 'usagi':
        shape(S(ell(7, 41, 3, 3)), 'W')
    body = S(ell(20, 35, 13, 11.5)); shape(body, k['base'], sh=k['sh'])
    if kind == 'kuma':
        b = S(ell(23, 37, 7, 7.5)); fill(b, 'O'); fill({(x, y) for x, y in b if (x - 1, y - 1) not in b}, 'Y')
    elif kind == 'neko':
        b = S(ell(23, 37, 6.5, 7.5)); fill(b, 'W'); fill({(x, y) for x, y in b if (x + 1, y) not in b}, 'Y')
        for sx in (11, 14):
            fill(S(line(sx, 29, sx + 1, 33)), 'C')
    elif kind == 'panda':
        fill(S(ell(20, 26, 14, 4.5)) & body, 'K')                                   # かたの くろい帯
    for cx in (10, 29):                                                             # あし
        f = S(ell(cx, 44, 4.5, 3)); shape(f, k['limb'])
        if k['pad']:
            fill(S(ell(cx, 44, 2.3, 1.5)), k['pad']); fill(edge(S(ell(cx, 44, 2.3, 1.5))), k['limb'])
        else:
            fill(S({(cx - 1, 43), (cx, 43), (cx + 1, 43)}), 'C')
    hy = 17 if kind == 'usagi' else 15
    hr = (11.5, 9.5) if kind == 'usagi' else (12.5, 10.5)
    # 耳
    if kind in ('kuma', 'panda'):
        for ex, ey in ((10, 6), (32, 5)):
            e = S(ell(ex, ey, 4.5, 4.5)); shape(e, k['limb'])
            if kind == 'kuma': fill(S(ell(ex, ey + .5, 2.4, 2.4)), 'P')
            else: fill(S({(ex + 1, ey - 2), (ex + 2, ey - 1)}), 'C')
    elif kind == 'neko':
        for pts in ([(7, 14), (8, 1), (19, 7)], [(25, 6), (35, 0), (35, 13)]):
            e = S(poly(pts)); shape(e, 'O'); fill(erode(erode(e)), 'P')
    else:
        for pts in ([(12, 11), (6, 1), (8, 0), (11, 0), (17, 9)], [(24, 9), (28, 0), (31, 0), (33, 2), (29, 11)]):
            e = S(poly(pts)); shape(e, 'W', sh='S'); fill(erode(erode(e)), 'P')
    head = S(ell(21, hy, *hr)); shape(head, k['base'], sh=k['sh'])
    if k['hi']:
        fill({(x, y) for x, y in head if (x + 2, y) not in head and (x, y) not in edge(head) and 7 + dy <= y <= 18 + dy}
             | {(x, y) for x, y in head if (x, y - 2) not in head and (x, y) not in edge(head) and 20 + dx <= x <= 28 + dx}, k['hi'])
    if kind == 'neko':
        for sx in (18, 21, 24):
            fill(S(line(sx, 6, sx, 8)), 'C')
    o = hy - 15                                                                     # うさぎは顔が 2 下
    # 口まわり
    my = 20.5 + o
    if kind == 'kuma':
        mz = S(ell(25, my, 5.6, 4.2)); fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'O'); fill(edge(mz), 'K')
    elif kind == 'neko':
        mz = S(ell(25, my, 5.2, 3.6)); fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'Y')
        for a, b in (((19, 19), (13, 18)), ((19, 22), (13, 23)), ((31, 19), (36, 18)), ((31, 21), (36, 22))):
            fill(S(line(a[0], a[1] + o, b[0], b[1] + o)), 'K')
    nose_c = 'P' if kind in ('usagi', 'neko') else 'K'
    ny = 18 + o
    if nose_c == 'K':
        fill(S(rect(24, ny, 28, ny + 1) | rect(25, ny + 2, 27, ny + 2)), 'K'); put(25 + dx, ny + dy, 'W')
    else:
        fill(S(rect(25, ny + 1, 27, ny + 1) | {(26, ny + 2)}), nose_c); fill(S({(24, ny + 1), (28, ny + 1), (25, ny), (26, ny), (27, ny), (25, ny + 2), (27, ny + 2)}), 'K')
    put(26 + dx, ny + 3 + dy, 'K')
    if mouth == 'open':
        fill(S(rect(25, ny + 4, 27, ny + 5)), 'R')
        fill(S({(24, ny + 4), (28, ny + 4), (24, ny + 5), (28, ny + 5), (25, ny + 6), (26, ny + 6), (27, ny + 6)}), 'K'); put(26 + dx, ny + 5 + dy, 'P')
    else:
        fill(S({(23, ny + 3), (24, ny + 4), (25, ny + 4), (26, ny + 3), (27, ny + 4), (28, ny + 4), (29, ny + 3)}), 'K')
    for ex, ey, rx in ((15, 13 + o, 1.6), (29, 12 + o, 1.8)):
        (eye_open(kind, ex + dx, ey + dy, rx) if eyes == 'open' else eye_shut(kind, ex + dx, ey + dy))
    fill(S(ell(14, 19 + o, 2.2, 1.2)), 'P')
    # 前のうで
    px, py = paw
    arm = thick([(28 + dx, 34 + dy), (px, py)], 2.6); shape(arm, k['limb'])
    if k['hi']: fill({(x, y) for x, y in arm if (x + 1, y - 1) not in arm} - edge(arm), k['hi'])
    p = ell(px, py, 2.8, 2.5); shape(p, k['limb'])
    return dict(paw=(px, py))

def lie(kind, dx=0, dy=0, shadow='O'):
    """ねている主役（左に頭、からだは右へ）。"""
    k = KIND[kind]; S = lambda m: mv(m, dx, dy)
    fill(S(ell(32, 46, 27, 1.5)), shadow)
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

# ---- 道具 ----
def easel(x0, y0, w, h, art):
    """イーゼル（左上 x0,y0・紙の大きさ w×h）。art(x0,y0,w,h) が紙に絵を描く。"""
    for lx0, lx1 in ((x0 + 2, x0 - 1), (x0 + w - 3, x0 + w)):
        fill(line(lx0, y0 + h, lx1, 47), 'C')
    fill(line(x0 + w // 2, y0 + h, x0 + w // 2 + 3, 47), 'K')
    fill(rect(x0 - 1, y0 + h, x0 + w, y0 + h + 1), 'C'); fill({(x, y0 + h + 1) for x in range(x0 - 1, x0 + w + 1)}, 'K')
    fill(rect(x0 + w // 2 - 1, y0 - 3, x0 + w // 2, y0), 'C')
    paper = rect(x0, y0, x0 + w - 1, y0 + h - 1); fill(paper, 'W'); fill(edge(paper), 'K')
    art(x0, y0, w, h)

def rainbow(x0, y0, w, h):
    cx = x0 + w / 2 - .5; cy = y0 + h - 2
    for i, c in enumerate('ROYGSB'):
        r = w / 2 - 2 - i
        if r > 0: fill({(x, y) for x, y in ell(cx, cy, r, r * .9) if y < cy and x0 < x < x0 + w - 1 and y0 < y}, c)
    fill({(x, y) for x, y in ell(cx, cy, w / 2 - 8, (w / 2 - 8) * .9) if y < cy}, 'W')

def brush(px, py, tip, dx=4, dy=-6):
    """手に持つ筆（柄はちゃいろ、先は色）"""
    h = line(px, py, px + dx, py + dy) | line(px + 1, py, px + dx + 1, py + dy)
    fill(edge(h | {(x + 1, y) for x, y in h} | {(x - 1, y) for x, y in h}), 'K'); fill(h, 'C')
    t = {(px + dx + i, py + dy - j) for i in (0, 1, 2) for j in (0, 1, 2)} - {(px + dx + 2, py + dy - 2)}
    fill(t, tip); fill({(px + dx, py + dy - 2)}, 'W')

def ball(cx, cy, r):
    b = ell(cx, cy, r, r); fill(b, 'W')
    fill({(x, y) for x, y in b if (x - cx) * 1.3 + (y - cy) < -r * .4}, 'R')
    fill({(x, y) for x, y in b if (x - cx) * 1.3 + (y - cy) > r * .4}, 'B')
    fill({(x, y) for x, y in b if abs((x - cx) * 1.3 + (y - cy)) <= r * .4 and (x - cx) > r * .2}, 'Y')
    fill({(int(cx - r * .4), int(cy - r * .5)), (int(cx - r * .4) + 1, int(cy - r * .5))}, 'W')
    fill(edge(b), 'K')

def tree(x, top, ground, w=9):
    """もりの背の高い木（みき C・葉 G）"""
    trunk = rect(x - 2, top + 8, x + 2, ground); fill(trunk, 'C')
    fill({(x - 2, y) for y in range(top + 8, ground + 1)}, 'K'); fill({(x + 2, y) for y in range(top + 8, ground + 1)}, 'K')
    fill({(x + 1, y) for y in range(top + 8, ground + 1)}, 'O')
    fill({(x - 1, y) for y in range(top + 12, ground, 5)}, 'K')
    fill(line(x - 1, ground, x - 4, ground) | line(x + 1, ground, x + 4, ground), 'K')
    leaf = ell(x - 3, top + 6, w * .7, 6) | ell(x + 4, top + 5, w * .8, 6.5) | ell(x, top + 1, w * .8, 5) | ell(x + 1, top + 10, w, 4)
    fill(leaf, 'G')
    fill({(p, q) for p, q in leaf if (p * 3 + q * 7) % 13 == 0}, 'Y')
    fill({(p, q) for p, q in leaf if (p - 1, q - 1) not in leaf} - edge(leaf), 'Y')
    fill(edge(leaf), 'K')

def mushroom(x, y):
    """きのこ（x＝まんなか、y＝地面）"""
    st = rect(x - 1, y - 3, x + 1, y); fill(st, 'W'); fill(edge(st), 'K')
    cap = {(p, q) for p, q in ell(x, y - 3, 4, 3.2) if q <= y - 3}
    fill(cap, 'R'); fill({(x - 2, y - 5), (x + 1, y - 4), (x + 2, y - 6)}, 'W'); fill(edge(cap), 'K')

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
            if g[y][x] == '.' and (x, y) not in out: g[y][x] = holec   # 閉じた空きを埋める
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(''.join(r) for r in g) + '\n')
    print(sum(c != '.' for r in g for c in r))
# ---- 奥のしげみ ----
bu = set()
for i, bx in enumerate(range(-3, 70, 10)):
    bu |= ell(bx, 26 + (i % 2) * 2, 6.5, 6)
bu = {(x, y) for x, y in bu if y < 33}
fill(bu, 'G'); fill({(x, y) for x, y in bu if (x - 1, y - 1) not in bu}, 'Y'); fill({(x, y) for x, y in bu if (x * 5 + y * 7) % 9 == 0}, 'K'); fill(edge(bu), 'K')
# ---- 地面（くさ・おちば）----
gr = rect(0, 32, 63, 47); fill(gr, 'G')
fill({(x, y) for x, y in gr if (x + 2 * y) % 5 == 0 or (x * 5 + y * 3) % 11 == 0}, 'Y')
fill({(x, y) for x, y in gr if (x * 7 + y * 5) % 23 == 0}, 'O')
fill({(x, y) for x, y in gr if (x * 3 + y * 11) % 29 == 0}, 'R')
fill({(x, 32) for x in range(W)}, 'K')
# ---- 背の高い木（右）----
tree(57, 2, 37, w=8)
fill(ell(57, 38, 7, 1.2), 'K')
# ---- きのこ（木の根もと）----
mushroom(50, 44); fill(ell(50, 45, 4, .8), 'K')
# ---- くま（ボールを 高く あげる）----
sit('kuma', dx=0, dy=0, paw=(38, 19), mouth='open', shadow='C')
ball(44, 9, 6.5)
for a, b in (((46, 18), (47, 19)), ((50, 16), (51, 17)), ((36, 4), (35, 3))):
    fill(line(*a, *b), 'K')
finish('kumamoribooru')
