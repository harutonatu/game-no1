# あまいものあつめ：絵の空き（.）を、場所に合った書き込んだ背景の角砂糖でうめる。
# 使い方：python3 bg.py <入力 .txt> <場所> <出力 .txt>
#   場所：kouen umibe daidokoro yukiyama mori hanabatake
# 考え方：
#   1. 地平線（空と地面の境）を、絵の中の地面の帯（草・砂・床・雪の色が多い行）から見つける。無ければ下から 1/3。
#   2. 空（地平線より上）と地面（下）を、場所ごとの「地の色」と「模様」（雲・遠くの山や木立・太陽・草・花・砂の粒・板・タイル・雪の粒）でうめる。
#   3. 元の角砂糖のふちどり（K）のすぐ外の 1 マスは、模様を置かず地の色にする（主役が埋もれないように）。
#   4. 色は 12 色（R O Y G S B P C W K と、足した D こいみどり・V むらさき）。D と V は背景を落ち着かせる色として
#      いつでも使う（遠くの木立・丘・森のかげ・草のかげ＝D、雲のかげ・花・遠くの山のかげ＝V）。
#      そのほかの色は、絵がもう使っている色だけ（無ければ代わりの色）。
#   5. 乱数は入力の中身から作った種つき（同じ入力からは毎回同じ出力）。
import sys, math, random, hashlib

PLACES = ("kouen", "umibe", "daidokoro", "yukiyama", "mori", "hanabatake")
GROUND = {  # 地面の帯を見つける色
    "kouen": "GYP", "umibe": "YO", "daidokoro": "YO", "yukiyama": "WS", "mori": "GYO", "hanabatake": "GYPR",
}


def find_horizon(m, place):
    """左右のはしの列で、そこから下がほぼ地面の色になる一番上の行。4 列の中央の値。"""
    H, W = len(m), len(m[0])
    gc = GROUND[place]
    found = []
    for x in (0, 1, W - 2, W - 1):
        colv = [m[y][x] for y in range(H)]
        for y in range(H // 4, H - 2):
            if not all(c in gc for c in colv[y:y + 3]):
                continue
            rest = [c for c in colv[y:] if c not in ".K"]
            if rest and sum(1 for c in rest if c in gc) / len(rest) >= 0.75:
                found.append(y)
                break
    if not found:
        return H - H // 3
    found.sort()
    return found[len(found) // 2]


def main():
    src, place, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    if place not in PLACES:
        sys.exit("場所は " + " ".join(PLACES) + " のどれか")
    text = open(src, encoding="utf-8").read()
    m = [list(s.rstrip()) for s in text.split("\n") if s.strip()]
    H, W = len(m), len(m[0])
    rnd = random.Random(int(hashlib.md5((place + text).encode()).hexdigest(), 16))
    used = {c for row in m for c in row if c != "."}
    added = []

    def col(c, fallback):
        """絵にある色と D・V はそのまま。それ以外の無い色は fallback。"""
        if c in used:
            return c
        if c in "DV":
            if c not in added:
                added.append(c)
            return c
        return fallback

    hz = find_horizon(m, place)
    dot = [[m[y][x] == "." for x in range(W)] for y in range(H)]
    # K のすぐ外（8 近傍）は地の色だけ
    ring = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if dot[y][x]:
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < H and 0 <= xx < W and m[yy][xx] == "K":
                            ring[y][x] = True
    out = [row[:] for row in m]

    big = [[False] * W for _ in range(H)]

    def free(x, y):
        return 0 <= x < W and 0 <= y < H and dot[y][x] and not ring[y][x] and not big[y][x]

    def paint(x, y, c):
        if c and free(x, y):
            out[y][x] = c

    # うみべの海の帯：地平線の上で あお・みずいろ が多い行
    sea_top = hz
    if place == "umibe":
        r = hz - 1
        while r >= 0 and sum(1 for c in m[r] if c in "BS") / W >= 0.35:
            r -= 1
        sea_top = r + 1
        if sea_top == hz:  # 海が描かれていなければ地平線の上 4 行を海に
            sea_top = max(0, hz - 4)

    # ---- 地の色 ----
    if place == "daidokoro":
        sky_base, gnd_base = col("W", "S"), col("Y", "O")
    elif place == "yukiyama":
        sky_base, gnd_base = col("S", "W"), col("W", "S")
    elif place == "umibe":
        sky_base, gnd_base = col("S", "W"), col("Y", "O")
    else:
        sky_base, gnd_base = col("S", "W"), col("G", "Y")
    sea_base = col("B", "S") if place == "umibe" else None

    for y in range(H):
        for x in range(W):
            if dot[y][x]:
                if y >= hz:
                    out[y][x] = gnd_base
                elif sea_base and y >= sea_top:
                    out[y][x] = sea_base
                else:
                    out[y][x] = sky_base

    sky_bottom = sea_top if place == "umibe" else hz

    # ---- 空の模様 ----
    # 大きな物（雲・太陽・木・山）は big に印を付け、最後に小さく切れた かけら（6 マス未満）を地の色へ戻す
    def stamp(cells, fit, over_hill=False):
        """cells：{(x,y): 色}。空いているマスが fit 以上の割合なら描く。over_hill なら丘の上にも重ねる。"""
        cells = {k: v for k, v in cells.items() if v}
        if not cells:
            return False
        ok = lambda x, y: free(x, y) or (over_hill and 0 <= x < W and 0 <= y < H and hill[y][x] and not ring[y][x])
        n = sum(1 for (x, y) in cells if ok(x, y))
        if n < len(cells) * fit:
            return False
        for (x, y), c in cells.items():
            if ok(x, y):
                out[y][x] = c
                big[y][x] = True
        return True

    def cloud_cells(cx, cy, w, c, shade):
        parts = [(cx, cy, w * 0.5, 1.7), (cx - w * 0.32, cy + 0.6, w * 0.34, 1.2), (cx + w * 0.34, cy + 0.5, w * 0.36, 1.3)]
        cells = {}
        for y in range(int(cy - 3), int(cy + 2)):
            for x in range(int(cx - w) - 1, int(cx + w) + 2):
                if any(((x - px) / rx) ** 2 + ((y - py) / ry) ** 2 <= 1 for px, py, rx, ry in parts):
                    cells[(x, y)] = c
        # 雲の下のはしに 夕方の かげ（下の行の まん中あたりに、まばらに。線にならないように）
        for (x, y) in list(cells):
            if ((x, y + 1) not in cells and (x - 1, y) in cells and (x + 1, y) in cells and (x, y - 1) in cells
                    and shade and shade != c and rnd.random() < 0.35):
                cells[(x, y)] = shade
        return cells

    def clouds(c, shade, per):
        free_sky = sum(1 for y in range(sky_bottom) for x in range(W) if free(x, y))
        n = max(2, free_sky // per)
        for _ in range(n):
            for _try in range(40):
                w = rnd.randint(4, 8)
                cx, cy = rnd.randint(1, W - 2), rnd.randint(2, max(2, sky_bottom - 5))
                if stamp(cloud_cells(cx, cy, w, c, shade), 0.8):
                    break

    def sun(c, rim):
        for cx, cy in ((5, 4), (W - 6, 4), (6, 5), (W - 7, 5)):
            cells = {}
            for y in range(cy - 5, cy + 6):
                for x in range(cx - 5, cx + 6):
                    d = (x - cx) ** 2 + (y - cy) ** 2
                    if d <= 8:
                        cells[(x, y)] = c
                    elif d <= 13:
                        cells[(x, y)] = rim
            for dx, dy in ((0, -5), (0, 5), (-5, 0), (5, 0), (4, 4), (-4, -4), (4, -4), (-4, 4)):
                cells[(cx + dx, cy + dy)] = rim
            if stamp(cells, 0.9):
                return

    def tree(cx, base, crown_rx, crown_ry, trunk_h, leaf, light, trunk):
        cells = {}
        top = base - trunk_h - int(crown_ry * 2)
        ccy = top + crown_ry
        for y in range(int(top) - 1, base):
            for x in range(int(cx - crown_rx) - 1, int(cx + crown_rx) + 2):
                if ((x - cx) / crown_rx) ** 2 + ((y - ccy) / crown_ry) ** 2 <= 1:
                    hl = light and ((x - cx) + (y - ccy) < -crown_rx * 0.6) and rnd.random() < 0.55
                    cells[(x, y)] = light if hl else leaf
                elif trunk and y > ccy and abs(x - cx) <= 0.6:
                    cells[(x, y)] = trunk
        return cells

    def trees(n, base_lo, base_hi, size, leaf, light, trunk, fit):
        for _ in range(n):
            for _try in range(40):
                rx = rnd.uniform(*size)
                cx, base = rnd.randint(0, W - 1), rnd.randint(base_lo, base_hi)
                if not (0 <= base - 1 < H and hill[base - 1][cx]):  # 根もとが丘の上にない木は描かない（浮いて見える）
                    continue
                if stamp(tree(cx, base, rx, rx * 0.8, rnd.randint(2, 4), leaf, light, trunk), fit, True):
                    break

    def hills(c, height, bumps, base_row):
        # 地平線の上の、遠くの丘。K のすぐ外のマスは地の色のまま（ふちどりが暗い丘に溶けないように）
        ph = rnd.random() * 6.28
        for x in range(W):
            h = height * (0.6 + 0.4 * math.sin(x * bumps + ph))
            for y in range(max(0, int(base_row - h)), base_row):
                if free(x, y):
                    out[y][x] = c
                    big[y][x] = True
                    hill[y][x] = True

    def peaks(c, shade, rock, base_row):
        x = rnd.randint(-6, 0)
        while x < W:
            w = rnd.randint(10, 16)
            top = base_row - rnd.randint(7, 11)
            cx = x + w / 2
            cells = {}
            for y in range(top, base_row):
                half = (y - top + 0.5) * (w / 2) / (base_row - top)
                for xx in range(int(cx - half), int(cx + half) + 1):
                    snow = y - top < (base_row - top) * 0.45
                    cells[(xx, y)] = (shade if xx > cx else c) if snow or not rock else (rock if xx > cx else shade)
            stamp(cells, 0)
            x += w - 3

    W_ = col("W", sky_base)
    D, V = col("D", None), col("V", None)
    if place in ("kouen", "umibe", "hanabatake"):
        sun(col("Y", sky_base), col("O", col("Y", sky_base)))
    hill = [[False] * W for _ in range(H)]
    if place == "kouen":
        hills(D, 6, 0.22, hz)  # 遠くの丘（こいみどり）
        trees(W // 8, hz - 5, hz - 2, (2.5, 4), D, col("G", D), col("C", None), 0.6)  # 遠くの木立（こいみどりに みどりの光）
        clouds(W_, V, 110)  # 雲の下に むらさきの かげ
    if place == "hanabatake":
        hills(D, 4, 0.18, hz)
        clouds(W_, V, 110)
    if place == "umibe":
        clouds(W_, V, 110)
    if place == "yukiyama":
        peaks(W_, col("S", sky_base), V, hz)  # 遠くの雪山：雪 W・かげ S、下の岩肌は かげ側が むらさき
        clouds(W_, V, 160)
        for y in range(sky_bottom):  # ふる雪
            for x in range(W):
                if rnd.random() < 0.03:
                    paint(x, y, W_)
    if place == "mori":
        # 森：奥の地面と木立は こいみどり、葉の光は みどり・きいろ、幹は ちゃいろ
        hills(D, 7, 0.3, hz)
        trees(W // 4, hz - 6, hz - 2, (3, 5.5), D, col("G", D), col("C", None), 0.5)
        clouds(W_, V, 160)
    if place == "daidokoro":
        # かべ：上は しろいタイル（みずいろの目地、ところどころに小さな花の模様）、
        #       腰の高さから下は 板（だいだいに ちゃいろの継ぎ目、上に ちゃいろの見切り）
        grout = col("S", sky_base)
        wain = max(0, hz - max(6, hz // 4))  # 腰板の上のはし
        for y in range(wain):
            for x in range(W):
                if (y % 5 == 4) or ((x + (y // 5 % 2) * 3) % 6 == 5):
                    paint(x, y, grout)
        for ty in range(0, wain, 5):  # タイルの小さな模様（3 枚に 1 枚）
            for tx in range(0, W, 6):
                ox = tx - (ty // 5 % 2) * 3
                if (tx // 6 + ty // 5) % 3 == 0:
                    cx, cy = ox + 2, ty + 1
                    for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, 1)):
                        paint(cx + dx, cy + dy, V if (dx, dy) != (0, 0) else col("Y", V))
        board, seam2 = col("O", col("C", sky_base)), col("C", None)
        for y in range(wain, hz):
            for x in range(W):
                if y == wain:
                    paint(x, y, seam2 or board)
                else:
                    paint(x, y, seam2 if (seam2 and x % 4 == 3) else board)
    if place == "umibe":
        # 海の波：みずいろの波の線と、しろい波がしら
        for y in range(sea_top, hz):
            off = rnd.randint(0, 7)
            for x in range(W):
                k = (x + off + y * 3) % 9
                if k in (0, 1, 2):
                    paint(x, y, col("S", sea_base))
                elif k == 3 and rnd.random() < 0.5:
                    paint(x, y, col("W", sea_base))

    # 小さく切れた かけらを地の色へ
    seen = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if big[y][x] and not seen[y][x]:
                comp, st = [], [(x, y)]
                seen[y][x] = True
                while st:
                    a, b = st.pop()
                    comp.append((a, b))
                    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        aa, bb = a + da, b + db
                        if 0 <= aa < W and 0 <= bb < H and big[bb][aa] and not seen[bb][aa]:
                            seen[bb][aa] = True
                            st.append((aa, bb))
                if len(comp) < 6:
                    for a, b in comp:
                        out[b][a] = gnd_base if b >= hz else (sea_base if sea_base and b >= sea_top else sky_base)

    # ---- 地面の模様 ----
    for y in range(hz, H):
        for x in range(W):
            r = rnd.random()
            if place == "kouen":
                if r < 0.05:  # 草のかげ（こいみどりの ^）
                    paint(x, y, D); paint(x - 1, y + 1, D); paint(x + 1, y + 1, D)
                elif r < 0.065:
                    paint(x, y, col("Y", D))  # 日の当たる草
                elif r < 0.075:  # 小さな花
                    c = col("P", col("W", gnd_base)); paint(x, y, c)
                    paint(x - 1, y, c); paint(x + 1, y, c); paint(x, y - 1, c); paint(x, y + 1, c); paint(x, y, col("Y", c))
            elif place == "hanabatake":
                if r < 0.06:
                    paint(x, y, D)  # 草のかげ
                elif r < 0.17:
                    paint(x, y, rnd.choice([col("P", V), col("R", V), col("Y", V), col("W", V), V]))
            elif place == "mori":
                if r < 0.08:
                    paint(x, y, D)  # 森のかげ
                elif r < 0.10:
                    paint(x, y, col("Y", gnd_base))  # 木もれ日
                elif r < 0.115:
                    paint(x, y, col("O", gnd_base))  # 落ち葉
                elif r < 0.119:  # きのこ
                    paint(x, y, col("R", gnd_base)); paint(x - 1, y, col("R", gnd_base)); paint(x + 1, y, col("R", gnd_base))
                    paint(x, y + 1, col("W", gnd_base))
            elif place == "umibe":
                if r < 0.07:
                    paint(x, y, col("O", gnd_base))  # 砂の粒
                elif r < 0.075:  # 貝がら
                    paint(x, y, col("P", col("W", gnd_base))); paint(x + 1, y, col("W", gnd_base))
            elif place == "yukiyama":
                if r < 0.06:
                    paint(x, y, col("S", gnd_base))  # 雪のかげの粒
                elif r < 0.064:
                    paint(x, y, V)  # 夕方の雪のかげ
                elif r < 0.079:  # ふきだまりの線
                    for i in range(3):
                        paint(x + i, y, col("S", gnd_base))
            elif place == "daidokoro":
                pass
    if place == "daidokoro":
        # 床の板：だいだいの目地（横の線と、ずらした縦の継ぎ目）
        seam = col("O", gnd_base)
        for y in range(hz, H):
            for x in range(W):
                k = y - hz
                if k % 3 == 2 or (x + (k // 3) * 7) % 13 == 0:
                    paint(x, y, seam)

    # 各色 3 個以上（足した色が 1〜2 個だけなら地の色へ戻す）
    cnt = {}
    for row in out:
        for c in row:
            cnt[c] = cnt.get(c, 0) + 1
    for y in range(H):
        for x in range(W):
            c = out[y][x]
            if dot[y][x] and c not in used and cnt[c] < 3:
                out[y][x] = gnd_base if y >= hz else sky_base
    open(dst, "w", encoding="utf-8").write("\n".join("".join(r) for r in out) + "\n")
    print(f"地平線 {hz} 行目（海 {sea_top}）  使った足し色 {''.join(added) or 'なし'}")


if __name__ == "__main__":
    main()
