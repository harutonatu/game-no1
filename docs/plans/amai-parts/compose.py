# あまいものあつめ：組み立て表（combos.md）の 1 行から、1 枚の絵（文字の地図 <id>.txt と PNG）を組み立てる。
# 使い方：python3 compose.py <id>…   （引数なしで表の全部）
# 順番：場所の背景 → 主役の足もとのかげ → 動物 × ふるまい（小物は ふるまいの部品が持つ）→ 閉じた空きをうめて書き出し・確かめ。
import os, sys, re, importlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, 'parts')]
import lib

PLACE = {"まち": "bg_machi", "ゆうえんち": "bg_yuuenchi", "ほしぞら": "bg_hoshizora"}
ANIMAL = {"ぺんぎん": "pengin", "ぞう": "zou", "ぶた": "buta", "かえる": "kaeru"}
ACT = {"ほんを よむ": "hon", "うたう": "utau", "じてんしゃに のる": "jitensha"}
SEASONS = ("", "haru", "natsu", "aki", "fuyu")


def read_table():
    rows = []
    for ln in open(os.path.join(HERE, 'combos.md'), encoding='utf-8'):
        c = [s.strip() for s in ln.strip().strip('|').split('|')]
        if len(c) != 9 or not c[0].isdigit():
            continue
        season = c[4].strip('"')
        if season not in SEASONS: sys.exit(f'季節がちがう：{c[2]} {c[4]}')
        if not re.fullmatch(r'[a-z]+', c[2]): sys.exit(f'id は英小文字だけ：{c[2]}')
        rows.append({"level": int(c[0]), "tier": c[1], "id": c[2], "name": c[3], "season": season,
                     "place": c[5], "animal": c[6], "act": c[7], "how": c[8]})
    ids = [r["id"] for r in rows]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup: sys.exit('id が重なっている：' + ' '.join(sorted(dup)))
    return rows


def how(s):
    m = dict(re.findall(r'(\w+)=(-?\d+)', s))
    return {"x": int(m.get("x", 32)), "y": int(m.get("y", 46)),
            "flip": bool(re.search(r'(^|\s)ぎゃく', s)), "bgflip": '背景ぎゃく' in s}


def compose(r):
    lib.reset()
    bg = importlib.import_module(PLACE[r["place"]])
    pose = importlib.import_module(ANIMAL[r["animal"]] + "_" + ACT[r["act"]])
    h = how(r["how"])
    info = bg.draw(flip=h["bgflip"])
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
    todo = [r for r in rows if not want or r["id"] in want]
    miss = set(want) - {r["id"] for r in rows}
    if miss: sys.exit('表に無い id：' + ' '.join(sorted(miss)))
    bad = [r["id"] for r in todo if not compose(r)]
    if bad: sys.exit('決まりを満たさない：' + ' '.join(bad))


if __name__ == '__main__':
    main()
