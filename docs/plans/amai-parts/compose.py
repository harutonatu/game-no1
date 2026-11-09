# あまいものあつめ：組み立て表（combos/*.md。担当ごとに 1 ファイル）の 1 行から、1 枚の絵（文字の地図 <id>.txt と PNG）を組み立てる。
# 使い方：python3 compose.py <id>…   （引数なしで 表の全部）
#   部品のファイルが まだ無い行は「まだ描いていない」と出して飛ばす（止まらない）。id を名指ししたときも同じ。
# 順番：場所の背景 → 主役の足もとのかげ → 動物 × ふるまい（小物は ふるまいの部品が持つ）→ 閉じた空きをうめて書き出し・確かめ。
import os, sys, re, glob, importlib
sys.dont_write_bytecode = True   # __pycache__ を作らない（リポジトリに入れない）
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, 'parts')]
import lib

# 計画書 docs/plans/amai-parts.md §8 の 9 場所・9 動物・8 ふるまい（部品のファイル名）
PLACE = {"こうえん": "bg_kouen", "うみべ": "bg_umibe", "だいどころ": "bg_daidokoro", "ゆきやま": "bg_yukiyama",
         "もり": "bg_mori", "はなばたけ": "bg_hanabatake",
         "まち": "bg_machi", "ゆうえんち": "bg_yuuenchi", "ほしぞら": "bg_hoshizora"}
ANIMAL = {"ねこ": "neko", "くま": "kuma", "うさぎ": "usagi", "いぬ": "inu", "ぱんだ": "panda",
          "ぺんぎん": "pengin", "ぞう": "zou", "ぶた": "buta", "かえる": "kaeru"}
ACT = {"おやつを たべる": "oyatsu", "ボールで あそぶ": "booru", "ねむる": "nemuru", "おえかきを する": "oekaki",
       "おどる": "odoru", "ほんを よむ": "hon", "うたう": "utau", "じてんしゃに のる": "jitensha"}
SEASONS = ("", "haru", "natsu", "aki", "fuyu")
TIERS = ("S", "M", "L", "XL", "XXL")


def read_table():
    """combos/*.md（A.md〜E.md）の表の行を、面の順に すべて読む。"""
    rows = []
    for path in sorted(glob.glob(os.path.join(HERE, 'combos', '*.md'))):
        for ln in open(path, encoding='utf-8'):
            c = [s.strip() for s in ln.strip().strip('|').split('|')]
            if len(c) != 9 or not c[0].isdigit():
                continue
            src = os.path.basename(path)
            season = c[4].strip('"')
            if season not in SEASONS: sys.exit(f'{src}：季節がちがう：{c[2]} {c[4]}')
            if c[1] not in TIERS: sys.exit(f'{src}：段がちがう：{c[2]} {c[1]}')
            if not re.fullmatch(r'[a-z]+', c[2]): sys.exit(f'{src}：id は英小文字だけ：{c[2]}')
            for k, tbl in ((5, PLACE), (6, ANIMAL), (7, ACT)):
                if c[k] not in tbl: sys.exit(f'{src}：知らない名前「{c[k]}」（{c[2]}）')
            rows.append({"level": int(c[0]), "tier": c[1], "id": c[2], "name": c[3], "season": season,
                         "place": c[5], "animal": c[6], "act": c[7], "how": c[8], "src": src})
    rows.sort(key=lambda r: r["level"])
    for key in ("id", "level"):
        vals = [r[key] for r in rows]
        dup = {v for v in vals if vals.count(v) > 1}
        if dup: sys.exit(f'{key} が重なっている：' + ' '.join(map(str, sorted(dup))))
    return rows


def how(s):
    """置き方の欄：x=<体のまん中> y=<足の下> ぎゃく 背景ぎゃく sky=<色> ground=<色>。"""
    m = dict(re.findall(r'([a-z]+)=(-?\d+)', s))
    col = dict(re.findall(r'(sky|ground)=([A-Z])', s))
    for k, v in col.items():
        if v not in lib.COLORS: sys.exit(f'{k}= の色がちがう：{v}')
    return {"x": int(m.get("x", 32)), "y": int(m.get("y", 46)),
            "flip": bool(re.search(r'(^|\s)ぎゃく', s)), "bgflip": '背景ぎゃく' in s,
            "sky": col.get("sky"), "ground": col.get("ground")}


def part_file(name):
    return os.path.exists(os.path.join(HERE, 'parts', name + '.py'))


def missing(r):
    need = [PLACE[r["place"]], ANIMAL[r["animal"]] + "_" + ACT[r["act"]]]
    return [n + '.py' for n in need if not part_file(n)]


def compose(r):
    lib.reset()
    bg = importlib.import_module(PLACE[r["place"]])
    pose = importlib.import_module(ANIMAL[r["animal"]] + "_" + ACT[r["act"]])
    h = how(r["how"])
    info = bg.draw(flip=h["bgflip"], sky=h["sky"], ground=h["ground"])
    dx, rx, ry = getattr(pose, "SHADOW", (0, 11, 1.5))
    sx = h["x"] - dx if h["flip"] else h["x"] + dx
    lib.shadow(sx, h["y"] - .5, rx, ry, info["floor"], info.get("shade", "K"), 1.0)
    head, body = pose.draw(h["x"], h["y"], h["flip"])
    neck = lib.neck_report(head, body)
    res = lib.finish(r["id"], r["tier"])
    print('  決まり 8（頭と胴体）', neck)
    return res["ok"] and neck["ok"]


def main():
    rows = read_table()
    want = sys.argv[1:]
    miss = set(want) - {r["id"] for r in rows}
    if miss: sys.exit('表に無い id：' + ' '.join(sorted(miss)))
    todo = [r for r in rows if not want or r["id"] in want]
    bad, skip = [], []
    for r in todo:
        lack = missing(r)
        if lack:
            print(f'{r["id"]}（{r["src"]}）：まだ描いていない（{" ".join(lack)} が無い）')
            skip.append(r["id"]); continue
        if not compose(r): bad.append(r["id"])
    print(f'組み立て {len(todo) - len(skip)} 枚・まだ描いていない {len(skip)} 枚')
    if bad: sys.exit('決まりを満たさない：' + ' '.join(bad))


if __name__ == '__main__':
    main()
