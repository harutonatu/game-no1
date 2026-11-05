# 148 枚の前後の数を out/counts.md に書く：python3 counts.py
import csv, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def load(p): return [s.rstrip() for s in open(p, encoding="utf-8") if s.strip()]
rows, tiers = [], {}
for face, tier, d, i in csv.reader(open("list.tsv"), delimiter="\t"):
    a, b = load(f"../{d}/{i}.txt"), load(f"out/{i}.txt")
    ca = {c for r in a for c in r if c != "."}; cb = {c for r in b for c in r if c != "."}
    na = sum(1 for r in a for c in r if c != "."); nb = sum(1 for r in b for c in r if c != ".")
    assert all(len(r) == len(a[0]) for r in b) and len(a) == len(b) and "." not in "".join(b)
    assert all(x == y or x == "." for ra, rb in zip(a, b) for x, y in zip(ra, rb)), i  # 元の角砂糖は変えていない
    rows.append((face, tier, i, na, nb, len(ca), len(cb), "".join(sorted(cb - ca))))
    tiers.setdefault(tier, []).append((na, nb, len(ca), len(cb)))
out = ["# 背景をうめた 148 枚の数（python3 counts.py で作る）", "",
       "## 段ごと", "", "| 段 | 枚 | 角砂糖 前（平均・範囲） | 角砂糖 後（平均・範囲） | 色 前（範囲） | 色 後（範囲） |", "|---|---|---|---|---|---|"]
for t in ("S", "M", "L", "XL", "XXL"):
    v = tiers[t]; f = lambda k: [x[k] for x in v]
    out.append(f"| {t} | {len(v)} | {sum(f(0))/len(v):.0f}（{min(f(0))}〜{max(f(0))}） | {sum(f(1))/len(v):.0f}（{min(f(1))}〜{max(f(1))}） | {min(f(2))}〜{max(f(2))} | {min(f(3))}〜{max(f(3))} |")
A = sum(r[3] for r in rows); B = sum(r[4] for r in rows)
out += ["", f"合計：角砂糖 前 {A} → 後 {B}（{B/A:.2f} 倍）。", "",
        "## 1 枚ずつ", "", "| 面 | 段 | id | 前の角砂糖 | 後の角砂糖 | 前の色 | 後の色 | 足した色 |", "|---|---|---|---|---|---|---|---|"]
out += [f"| {r[0]} | {r[1]} | `{r[2]}` | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7] or '—'} |" for r in rows]
open("out/counts.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out[:12]))
from collections import Counter
print(Counter(r[7] for r in rows))
