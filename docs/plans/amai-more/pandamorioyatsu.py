# もりで ぱんだが おやつを たべる（pandamorioyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 pandamorioyatsu.txt を書き出す（1 マス＝1 粒）。
# ---- 部品（楕円・多角形・線・ふちどり・かげ・主役）。手本 amai-redraw/inudaidokorooyatsu.py をまねた ----
import math, os
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c
def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            u = dx * math.cos(a) + dy * math.sin(a); v = -dx * math.sin(a) + dy * math.cos(a)
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1: s.add((x, y))
    return s
def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}
def poly(pts):
    s = set(); n = len(pts)
    for y in range(H):
        for x in range(W):
            px, py = x + .5, y + .5; ins = False
            for i in range(n):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay): ins = not ins
            if ins: s.add((x, y))
    return s
def line(x0, y0, x1, y1, w=0):
    s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
        for k in range(w + 1): s.add((x + k, y))
    return s
def cap(x0, y0, x1, y1, r):
    """太い線（両はしが丸い）。うで・あし・みき に使う。"""
    s = set(); vx, vy = x1 - x0, y1 - y0; L2 = vx * vx + vy * vy or 1
    for y in range(H):
        for x in range(W):
            t = max(0, min(1, ((x - x0) * vx + (y - y0) * vy) / L2))
            if (x - x0 - t * vx) ** 2 + (y - y0 - t * vy) ** 2 <= r * r: s.add((x, y))
    return s
def fill(m, c):
    for x, y in m:
        cc = c(x, y) if callable(c) else c
        if cc: put(x, y, cc)
def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗って、かげ（右下）・明るい所（左上）を付けて、ふちどり。光は左上から。"""
    fill(m, c)
    if sh: fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi: fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m) and (x + d, y) in m and (x, y + d) in m}, hi)
    if o: fill(edge(m), o)
def z(x, y, n, c='K'):
    for i in range(n): put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)
def finish(name, hole='W'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.': out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out: g[y][x] = hole   # 閉じた空きは埋める
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    cnt = {}
    for r in rows:
        for c in r:
            if c != '.': cnt[c] = cnt.get(c, 0) + 1
    print(sum(cnt.values()), cnt)

# ---- 背景の部品 ----
def tree(x, y0, y1, cx, cy, rx, ry, leaf='G', hi='Y'):
    """背の高い木：みき（C）と 葉（G）。光は左上。"""
    tr = cap(x, y0, x, y1, 2.2) | poly([(x - 4, y1 + 1), (x + 4, y1 + 1), (x + 2, y1 - 3), (x - 2, y1 - 3)])
    shape(tr, 'C', sh='K', d=1)
    fill({(x - 1, yy) for yy in range(y0 + 2, y1 - 2) if yy % 4 == 0}, 'O')
    lv = ell(cx, cy, rx, ry) | ell(cx - rx * .55, cy + ry * .45, rx * .6, ry * .6) | ell(cx + rx * .55, cy + ry * .4, rx * .6, ry * .6)
    fill(lv, leaf)
    fill({(a, b) for a, b in lv if (a + 2, b + 2) not in lv and (a + b) % 2 == 0}, 'K' if leaf == 'G' else 'S')
    fill({(a, b) for a, b in lv if (a * 5 + b * 3) % 11 == 0 and (a - 2, b - 2) in lv and (a + 3, b + 3) in lv}, hi)
    fill(edge(lv), 'K')
def mushroom(cx, by, r=4, col='R'):
    st = rect(cx - 1, by - 3, cx + 1, by); shape(st, 'W', sh='S', d=1)
    cp = {(x, y) for x, y in ell(cx, by - 3, r, r * .8) if y <= by - 3}
    fill(cp, col); fill({(x, y) for x, y in cp if (x * 3 + y) % 5 == 0 and (x, y) not in edge(cp)}, 'W'); fill(edge(cp), 'K')
    fill(edge(st), 'K')
def pine(cx, top, bot, w):
    fill(rect(cx - 1, bot, cx + 1, bot + 3), 'C'); fill(edge(rect(cx - 1, bot, cx + 1, bot + 3)), 'K')
    m = set()
    for k in range(3):
        t = top + (bot - top) * k // 3
        m |= poly([(cx + .5, t), (cx + .5 + w * (k + 2) / 4, t + (bot - top) * .45), (cx + .5 - w * (k + 2) / 4, t + (bot - top) * .45)])
    m |= poly([(cx + .5, top + (bot - top) * .5), (cx + .5 + w, bot + .5), (cx + .5 - w, bot + .5)])
    fill(m, 'G'); fill({(x, y) for x, y in m if x > cx + 1 and (x + y) % 2 == 0}, 'K')
    fill({(x, y) for x, y in m if (x + y) % 4 == 0 and y % 3 == 0}, 'W')
    fill(edge(m), 'K')
def easel(x0, y0, x1, y1, art, legbot=46):
    """イーゼル（木の台）に 紙。art(x0,y0,x1,y1) で 中の絵を描く。"""
    mx = (x0 + x1) // 2
    fill(cap(x0 + 2, y1, x0 - 1, legbot, .7) | cap(x1 - 2, y1, x1 + 1, legbot, .7), 'C')
    fill(cap(mx, y0 - 2, mx, legbot - 2, .7), 'C')
    fill(edge(cap(x0 + 2, y1, x0 - 1, legbot, .7) | cap(x1 - 2, y1, x1 + 1, legbot, .7)), 'K')
    paper = rect(x0, y0, x1, y1); fill(paper, 'W'); art(x0 + 1, y0 + 1, x1 - 1, y1 - 1)
    fill(edge(paper), 'K')
    fill(rect(x0 - 1, y1 + 1, x1 + 1, y1 + 2), 'C'); fill(edge(rect(x0 - 1, y1 + 1, x1 + 1, y1 + 2)), 'K')
def rainbow(x0, y0, x1, y1):
    """紙の中の にじ と おひさま と 花。"""
    cx = (x0 + x1) / 2; cy = y1 + 1; R = min((x1 - x0) / 2, y1 - y0) - .5
    for i, c in enumerate('RYGB'):
        r = R - i * 1.6
        fill({(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if r - 1.6 < math.hypot(x - cx, (y - cy) * 1.0) <= r}, c)
def crayons(x, y):
    for i, c in enumerate('RBYG'):
        m = rect(x + i * 3, y, x + i * 3 + 1, y + 3); fill(m, c); put(x + i * 3, y, 'W' if c != 'Y' else 'O'); fill({(x + i * 3, y + 3), (x + i * 3 + 1, y + 3)}, 'K')

# ---- 主役（すわって 右を むく。頭の中心 hx,hy、体の中心 bx,by）----
def critter(sp, hx, hy, bx, by, hand=None, hand2=None, eyes='open', mouth='smile', tail=True):
    pal = {'kuma': ('C', 'K', 'O'), 'panda': ('W', 'S', None), 'inu': ('W', 'S', None), 'neko': ('O', 'C', 'Y')}[sp]
    base, sh, hi = pal
    # 尾
    if tail and sp == 'neko':
        tl = cap(bx - 9, by + 6, bx - 15, by - 2, 2) | cap(bx - 15, by - 2, bx - 13, by - 9, 2)
        shape(tl, 'O', sh='C', d=1); fill({(a, b) for a, b in tl if b % 3 == 0} - edge(tl), 'C')
    if tail and sp == 'inu':
        shape(ell(bx - 11, by - 1, 2.4, 5, -35), 'C')
    # 奥のうで
    if hand2:
        a2 = cap(bx - 6, by - 6, hand2[0], hand2[1], 2.6)
        shape(a2, 'K' if sp == 'panda' else base, sh=None if sp == 'panda' else sh, d=1)
    # 体
    body = ell(bx, by, 11, 10.5)
    shape(body, base, sh=sh, hi=hi)
    if sp == 'kuma': bel = ell(bx + 2, by + 2, 6.5, 7)
    if sp == 'kuma':
        fill(bel, 'O'); fill({(a, b) for a, b in bel if (a - 1, b - 1) not in bel}, 'Y'); bel = set()
    elif sp == 'neko': bel = ell(bx + 3, by + 1, 5.5, 7.5)
    elif sp == 'panda': bel = set()
    else: bel = set()
    if bel:
        fill(bel, 'Y' if sp == 'kuma' else 'W'); fill({(a, b) for a, b in bel if (a + 1, b + 1) not in bel}, 'O' if sp == 'kuma' else 'S')
    if sp == 'neko':
        for k in range(3): fill(line(bx - 9 + k * 3, by - 6 + k, bx - 7 + k * 3, by - 2 + k) & body, 'C')
    if sp == 'inu': fill(ell(bx - 6, by - 4, 5, 4) & body, 'C')
    if sp == 'panda':
        fill(ell(bx, by - 8, 12, 4) & body, 'K')                       # かたの くろい帯
    fill(edge(body), 'K')
    # あし
    for fx, fy in ((bx - 7, by + 9), (bx + 7, by + 9.5)):
        f = ell(fx, fy, 4.6, 3)
        if sp == 'panda': shape(f, 'K'); fill(ell(fx + .5, fy, 2, 1.2), 'P' if False else 'K')
        else:
            shape(f, base, sh=sh, d=1)
            pad = ell(fx + .5, fy, 2.2, 1.3)
            fill(pad, 'P' if sp in ('neko', 'inu') else 'O'); fill(edge(pad) - {(a, b) for a, b in pad if b > fy}, base)
    if sp == 'inu':
        fill(ell(hx, by - 9.5, 8.5, 1.6), 'R'); fill(edge(ell(hx, by - 9.5, 8.5, 1.6)), 'K')       # くびわ
        fill(ell(hx + 3, by - 7.5, 1.4, 1.4), 'Y'); fill(edge(ell(hx + 3, by - 7.5, 1.4, 1.4)), 'K')
    # 耳（うしろ）
    head = ell(hx, hy, 10, 9)
    if sp == 'kuma':
        for ex, ey in ((hx - 8, hy - 7), (hx + 7, hy - 8)):
            shape(ell(ex, ey, 4, 4), 'C'); fill(ell(ex, ey + .5, 2, 2), 'P')
    if sp == 'panda':
        for ex, ey in ((hx - 8, hy - 7), (hx + 7, hy - 8)):
            shape(ell(ex, ey, 4, 4), 'K')
    if sp == 'neko':
        for pts, inn in (([(hx - 10, hy - 2), (hx - 9, hy - 13), (hx - 2, hy - 7)], [(hx - 8, hy - 4), (hx - 8, hy - 10), (hx - 4, hy - 7)]),
                         ([(hx + 2, hy - 8), (hx + 9, hy - 14), (hx + 10, hy - 3)], [(hx + 4, hy - 8), (hx + 8, hy - 11), (hx + 8, hy - 5)])):
            shape(poly(pts), 'O'); fill(poly(inn), 'P')
    if sp == 'inu':
        shape(ell(hx + 6, hy - 4, 3, 5.5, -20), 'C')
    # 頭
    snout = ell(hx + 9, hy + 3.5, 5.5, 3.6) if sp == 'inu' else set()
    hm = head | snout
    shape(hm, base)
    fill({(a, b) for a, b in head if (a, b + 2) not in hm} - edge(hm), sh)
    if hi: fill({(a, b) for a, b in head if (a, b - 2) not in head and (a + 2, b) in head and a < hx + 3} - edge(hm), hi)
    fill(edge(hm), 'K')
    # かお
    ny = hy + 3
    if sp == 'kuma':
        mz = ell(hx + 4, hy + 4.5, 5, 3.6); fill(mz, 'W'); fill({(a, b) for a, b in mz if (a, b + 1) not in mz}, 'O'); fill(edge(mz), 'K')
        fill(rect(hx + 3, hy + 2, hx + 6, hy + 3) | {(hx + 4, hy + 4), (hx + 5, hy + 4)}, 'K'); put(hx + 3, hy + 2, 'W')
    if sp == 'panda':
        for px, py, ang in ((hx - 4, hy, -30), (hx + 5, hy - 1, 30)):
            fill(ell(px, py, 2.6, 3.3, ang), 'K')
        mz = ell(hx + 3, hy + 5, 3.5, 2.4); fill(mz, 'W'); fill({(a, b) for a, b in mz if (a, b + 1) not in mz}, 'S')
        fill(rect(hx + 2, hy + 3, hx + 4, hy + 4), 'K')
    if sp == 'neko':
        mz = ell(hx + 3, hy + 4.5, 4.5, 2.8); fill(mz, 'W')
        fill({(hx + 2, hy + 3), (hx + 3, hy + 3), (hx + 4, hy + 3), (hx + 3, hy + 4)}, 'P')
        fill(line(hx - 2, hy - 7, hx - 2, hy - 5) | line(hx, hy - 8, hx, hy - 5) | line(hx + 2, hy - 7, hx + 2, hy - 5), 'C')
        fill(line(hx - 7, hy + 3, hx - 3, hy + 4) | line(hx + 8, hy + 4, hx + 12, hy + 3), 'K')
    if sp == 'inu':
        fill(ell(hx + 4, hy - 3, 3, 3), 'C')
        fill(rect(hx + 13, hy + 1, hx + 15, hy + 2) | {(hx + 14, hy + 3)}, 'K'); put(hx + 13, hy + 1, 'W')
    # 目
    if sp == 'inu': eyes_at = ((hx - 2, hy - 3, 1.2), (hx + 4, hy - 2, 1.3))
    else: eyes_at = ((hx - 4, hy - 1, 1.3), (hx + 5, hy - 2, 1.4))
    for ex, ey, r in eyes_at:
        if eyes == 'open':
            fill(ell(ex, ey, r, 1.8), 'K'); put(ex, ey - 1, 'W')
        else:
            fill({(ex - 1, ey), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'K')
    # 口
    mx, my = (hx + 4, hy + 6) if sp != 'inu' else (hx + 9, hy + 6)
    if sp == 'neko': mx, my = hx + 3, hy + 5
    if sp == 'neko' and mouth == 'smile':
        fill({(mx, my - 1), (mx - 1, my), (mx + 1, my), (mx - 2, my), (mx + 2, my)}, 'K'); put(mx, my, 'W')
    elif mouth == 'smile':
        fill({(mx - 2, my), (mx - 1, my + 1), (mx, my), (mx + 1, my + 1), (mx + 2, my)}, 'K')
    elif mouth == 'open':
        fill(rect(mx - 1, my, mx + 1, my + 1), 'R'); fill({(mx, my + 1)}, 'P')
        fill(edge(rect(mx - 2, my - 1, mx + 2, my + 2)), 'K')
    elif mouth == 'tongue':
        fill(line(mx - 4, my, mx + 4, my), 'K'); fill(rect(mx - 3, my + 1, mx - 1, my + 2), 'P')
    if sp == 'inu':                                                     # たれ耳（手前）
        ef = ell(hx - 8, hy + 1, 3.4, 7, 15); shape(ef, 'C'); fill({(x, y) for x, y in ef if (x - 1, y) not in ef} - edge(ef), 'O')
    # ほっぺ
    if sp != 'inu': fill(ell(hx - 6, hy + 3.5, 1.8, 1), 'P'); fill(ell(hx + 9, hy + 2.5, 1, 1), 'P')
    else: fill(rect(hx - 2, hy + 2, hx, hy + 2), 'P')
    # 手前の うで
    if hand:
        a = cap(bx + 4, by - 5, hand[0], hand[1], 2.6)
        if sp == 'panda':
            shape(a, 'K'); fill({(x, y) for x, y in a if (x - 2, y - 1) not in a and (x + 1, y + 1) in a and (x, y) not in edge(a)} | {(x, y) for x, y in a if (x - 1, y - 2) not in a and (x + 1, y + 1) in a and (x, y) not in edge(a)}, 'B')
        else: shape(a, base, sh=sh, d=1)
        p = ell(hand[0], hand[1], 2.6, 2.4)
        shape(p, 'K' if sp == 'panda' else base)

# もりで ぱんだが おやつを たべる：いちごの カップケーキを ほおばる ぱんだ（絵の半分）。場所の物は 背の高い木 と きのこ の 2 つ。
# （右むきに描いて、さいごに 左右を 入れかえる）
GY = 35
# 奥の もり
far = set()
for cx, cy, r in ((10, 24, 6), (22, 22, 7), (35, 25, 6), (47, 22, 7), (59, 25, 6)):
    far |= ell(cx, cy, r, r * .9)
far |= rect(0, 26, 63, GY)
fill(far, 'G'); fill({(x, y) for x, y in far if (x + y) % 2 == 0 and y >= 29}, 'K')
fill({(x, y) for x, y in far if (x * 3 + y * 5) % 9 == 0 and y < 29}, 'Y'); fill(edge(far), 'K')
for x in (16, 29, 41, 53):
    fill(rect(x, 30, x + 1, GY), 'C')
# おひさま
fill(ell(55, 4, 2.6, 2.6), 'Y'); fill(edge(ell(55, 4, 2.6, 2.6)), 'O')
# 地面（草と おちば）
fill(rect(0, GY, 63, 47), 'G')
fill({(x, y) for x in range(W) for y in range(GY, H) if (x * 7 + y * 5) % 19 == 0}, 'Y')
for lx, ly, c in ((22, 40, 'O'), (46, 38, 'R'), (60, 44, 'O'), (36, 46, 'Y'), (8, 38, 'R')):
    fill({(lx, ly), (lx + 1, ly), (lx + 1, ly - 1)}, c)
fill({(x, GY) for x in range(W)}, 'K')
# 背の高い木（左）
tree(5, 5, 41, 6, 6, 9, 8)
# きのこ（右下）
mushroom(57, 44, 4); mushroom(62, 45, 2.8, 'O'); mushroom(51, 46, 2.4)
# ぱんだ
fill(ell(24, 46, 14, 1.3), 'K')
critter('panda', 24, 15, 23, 33, hand=(37, 22), hand2=(14, 36), mouth='open')
# カップケーキ（手の上。いちごの クリーム）
cup = poly([(34.5, 19), (46.5, 19), (44, 26), (37, 26)]); fill(cup, lambda x, y: 'Y' if x % 3 else 'O'); fill(edge(cup), 'K')
cr = ell(40.5, 16.5, 6.5, 3.8) | ell(40.5, 12.5, 4, 2.8) | ell(40.5, 9.5, 2, 1.6)
fill(cr, 'P'); fill({(x, y) for x, y in cr if (x - 1, y - 1) not in cr}, 'W'); fill({(x, y) for x, y in cr if (x + 1, y + 1) not in cr}, 'R'); fill(edge(cr), 'K')
fill({(37, 16), (40, 14), (43, 16), (39, 18), (42, 12)}, 'W')
st = ell(40.5, 6.5, 2.2, 2); fill(st, 'R'); fill(edge(st), 'K'); fill({(39, 4), (40, 4), (41, 4), (42, 4)}, 'G'); put(40, 6, 'W')
for r in g: r.reverse()
finish('pandamorioyatsu', 'G')
