# 背景をうめた 148 枚の数（python3 counts.py で作る）

## 段ごと

| 段 | 枚 | 角砂糖 前（平均・範囲） | 角砂糖 後（平均・範囲） | 色 前（範囲） | 色 後（範囲） |
|---|---|---|---|---|---|
| S | 2 | 667（659〜675） | 920（840〜999） | 4〜4 | 4〜5 |
| M | 8 | 965（887〜1115） | 1364（1240〜1452） | 5〜5 | 5〜7 |
| L | 12 | 1526（1381〜1600） | 2823（2304〜3072） | 6〜7 | 7〜10 |
| XL | 12 | 2082（1875〜2223） | 3056（2880〜3072） | 7〜8 | 9〜11 |
| XXL | 114 | 2454（2105〜2575） | 2968（2432〜3072） | 8〜10 | 8〜12 |

合計：角砂糖 前 332105 → 後 421672（1.27 倍）。

## 1 枚ずつ

| 面 | 段 | id | 前の角砂糖 | 後の角砂糖 | 前の色 | 後の色 | 足した色 |
|---|---|---|---|---|---|---|---|
| 3 | S | `nekoyukiyamaoyatsu` | 659 | 840 | 4 | 4 | — |
| 4 | S | `usagidaidokoronemuru` | 675 | 999 | 4 | 5 | V |
| 5 | M | `inuumibeoyatsu` | 887 | 1408 | 5 | 7 | SV |
| 6 | M | `usagikouennemuru` | 906 | 1344 | 5 | 7 | SV |
| 7 | M | `kumaumibebooru` | 1115 | 1333 | 5 | 5 | — |
| 8 | M | `nekodaidokorooyatsu` | 914 | 1240 | 5 | 6 | V |
| 9 | M | `inuyukiyamanemuru` | 943 | 1344 | 5 | 5 | — |
| 10 | M | `usagiyukiyamabooru` | 1054 | 1428 | 5 | 6 | V |
| 11 | M | `nekoyukiyamabooru` | 963 | 1364 | 5 | 5 | — |
| 12 | M | `inukouennemuru` | 941 | 1452 | 5 | 7 | DS |
| 13 | L | `nekokouenbooru` | 1580 | 2944 | 7 | 10 | DSV |
| 14 | L | `kumayukiyamaoyatsu` | 1593 | 2816 | 7 | 8 | V |
| 15 | L | `usagikouenoyatsu` | 1600 | 3072 | 7 | 9 | DV |
| 16 | L | `inuumibebooru` | 1462 | 2752 | 7 | 8 | V |
| 17 | L | `usagikouenbooru` | 1439 | 3024 | 7 | 9 | DV |
| 18 | L | `kumakouennemuru` | 1576 | 2867 | 7 | 10 | DSV |
| 19 | L | `inuyukiyamabooru` | 1414 | 2304 | 6 | 7 | V |
| 20 | L | `kumadaidokoronemuru` | 1594 | 2867 | 7 | 8 | V |
| 21 | L | `nekodaidokorobooru` | 1561 | 2944 | 7 | 8 | V |
| 22 | L | `kumakouenoyatsu` | 1598 | 2852 | 7 | 10 | DSV |
| 23 | L | `inukouenbooru` | 1381 | 2944 | 7 | 9 | DV |
| 24 | L | `nekoumibeoyatsu` | 1511 | 2494 | 7 | 8 | V |
| 25 | XL | `usagiumibenemuru` | 2223 | 3072 | 8 | 9 | V |
| 26 | XL | `inudaidokorobooru` | 1944 | 3072 | 8 | 9 | V |
| 27 | XL | `inuyukiyamaoyatsu` | 1931 | 2880 | 8 | 9 | V |
| 28 | XL | `nekoumibenemuru` | 1961 | 3072 | 8 | 9 | V |
| 29 | XL | `kumadaidokorobooru` | 2162 | 3072 | 8 | 9 | V |
| 30 | XL | `nekodaidokoronemuru` | 2139 | 3072 | 8 | 9 | V |
| 31 | XL | `nekokouenoyatsu` | 2145 | 3072 | 8 | 11 | DSV |
| 32 | XL | `kumaumibenemuru` | 2222 | 3072 | 8 | 9 | V |
| 33 | XL | `kumakouenbooru` | 2204 | 3072 | 7 | 10 | DSV |
| 34 | XL | `inudaidokorooyatsu` | 1967 | 3072 | 8 | 9 | V |
| 35 | XL | `nekoumibebooru` | 2216 | 3072 | 8 | 9 | V |
| 36 | XL | `inuumibenemuru` | 1875 | 3072 | 8 | 9 | V |
| 37 | XXL | `kumadaidokorooyatsu` | 2537 | 3072 | 10 | 11 | V |
| 38 | XXL | `usagiumibebooru` | 2287 | 3072 | 10 | 11 | V |
| 39 | XXL | `usagiyukiyamaoyatsu` | 2345 | 3072 | 10 | 10 | — |
| 40 | XXL | `inudaidokoronemuru` | 2311 | 3072 | 9 | 10 | V |
| 41 | XXL | `kumayukiyamabooru` | 2551 | 3072 | 10 | 11 | V |
| 42 | XXL | `usagidaidokorooyatsu` | 2408 | 3072 | 10 | 11 | V |
| 43 | XXL | `kumayukiyamanemuru` | 2570 | 2944 | 10 | 10 | — |
| 44 | XXL | `usagiumibeoyatsu` | 2563 | 3008 | 10 | 11 | V |
| 45 | XXL | `nekokouennemuru` | 2548 | 2944 | 10 | 11 | V |
| 46 | XXL | `inukouenoyatsu` | 2506 | 2816 | 9 | 10 | V |
| 47 | XXL | `usagidaidokorobooru` | 2534 | 2944 | 10 | 11 | V |
| 48 | XXL | `kumaumibeoyatsu` | 2560 | 2880 | 10 | 10 | — |
| 49 | XXL | `kumamorioyatsu` | 2173 | 3072 | 9 | 11 | DV |
| 50 | XXL | `usagikouenoekaki` | 2555 | 3072 | 10 | 12 | DV |
| 51 | XXL | `nekomorinemuru` | 2105 | 3072 | 8 | 10 | SV |
| 52 | XXL | `pandakouenoyatsu` | 2290 | 3008 | 9 | 11 | DV |
| 53 | XXL | `inumorinemuru` | 2117 | 3072 | 9 | 10 | V |
| 54 | XXL | `pandadaidokorooyatsu` | 2248 | 3072 | 10 | 11 | V |
| 55 | XXL | `nekokouenoekaki` | 2184 | 3072 | 10 | 11 | V |
| 56 | XXL | `inumoribooru` | 2213 | 3072 | 9 | 10 | D |
| 57 | XXL | `inudaidokorooekaki` | 2292 | 3072 | 10 | 11 | V |
| 58 | XXL | `nekomoribooru` | 2496 | 2624 | 9 | 9 | — |
| 59 | XXL | `kumaumibeoekaki` | 2511 | 2688 | 9 | 9 | — |
| 60 | XXL | `pandakouenoekaki` | 2565 | 2816 | 10 | 10 | — |
| 61 | XXL | `inumorioyatsu` | 2491 | 2560 | 9 | 9 | — |
| 62 | XXL | `usagimorinemuru` | 2363 | 2432 | 9 | 9 | — |
| 63 | XXL | `pandayukiyamaoekaki` | 2454 | 2560 | 10 | 10 | — |
| 64 | XXL | `pandakouenbooru` | 2521 | 3072 | 10 | 11 | V |
| 65 | XXL | `kumayukiyamaoekaki` | 2516 | 2624 | 10 | 10 | — |
| 66 | XXL | `pandaumibeoekaki` | 2575 | 3008 | 9 | 10 | V |
| 67 | XXL | `usagiyukiyamaoekaki` | 2360 | 3072 | 10 | 11 | V |
| 68 | XXL | `pandaumibenemuru` | 2483 | 3072 | 8 | 9 | V |
| 69 | XXL | `kumadaidokorooekaki` | 2381 | 3072 | 10 | 11 | V |
| 70 | XXL | `pandadaidokoronemuru` | 2383 | 3072 | 9 | 10 | V |
| 71 | XXL | `pandamorinemuru` | 2280 | 3072 | 9 | 11 | DV |
| 72 | XXL | `pandaumibeoyatsu` | 2413 | 3072 | 9 | 10 | V |
| 73 | XXL | `nekomorioyatsu` | 2485 | 3072 | 9 | 11 | DV |
| 74 | XXL | `usagiumibeoekaki` | 2406 | 3072 | 9 | 10 | V |
| 75 | XXL | `kumamoribooru` | 2521 | 3072 | 9 | 11 | DS |
| 76 | XXL | `nekoumibeoekaki` | 2566 | 2944 | 10 | 11 | V |
| 77 | XXL | `usagimorioyatsu` | 2517 | 3072 | 9 | 9 | — |
| 78 | XXL | `pandamorioekaki` | 2555 | 3072 | 10 | 10 | — |
| 79 | XXL | `pandayukiyamanemuru` | 2515 | 2880 | 9 | 10 | V |
| 80 | XXL | `inumorioekaki` | 2573 | 3072 | 10 | 11 | V |
| 81 | XXL | `kumamorinemuru` | 2567 | 3072 | 9 | 9 | — |
| 82 | XXL | `usagimorioekaki` | 2539 | 3072 | 10 | 10 | — |
| 83 | XXL | `pandadaidokorooekaki` | 2360 | 3072 | 10 | 11 | V |
| 84 | XXL | `pandakouennemuru` | 2560 | 3072 | 10 | 10 | — |
| 85 | XXL | `usagimoribooru` | 2197 | 3072 | 10 | 12 | DV |
| 86 | XXL | `nekoyukiyamaoekaki` | 2348 | 3072 | 10 | 11 | V |
| 87 | XXL | `pandaumibebooru` | 2363 | 3072 | 9 | 10 | V |
| 88 | XXL | `kumakouenoekaki` | 2277 | 3072 | 9 | 11 | DS |
| 89 | XXL | `pandayukiyamabooru` | 2402 | 3008 | 10 | 11 | V |
| 90 | XXL | `usagidaidokorooekaki` | 2320 | 3072 | 10 | 11 | V |
| 91 | XXL | `inuumibeoekaki` | 2163 | 3008 | 9 | 10 | V |
| 92 | XXL | `pandamoribooru` | 2112 | 3072 | 10 | 12 | DV |
| 93 | XXL | `kumamorioekaki` | 2559 | 3072 | 9 | 10 | S |
| 94 | XXL | `pandayukiyamaoyatsu` | 2303 | 3008 | 9 | 10 | V |
| 95 | XXL | `nekomorioekaki` | 2493 | 3072 | 10 | 11 | V |
| 96 | XXL | `pandadaidokorobooru` | 2313 | 3072 | 9 | 10 | V |
| 97 | XXL | `inukouenoekaki` | 2351 | 3008 | 10 | 11 | V |
| 98 | XXL | `pandamorioyatsu` | 2491 | 3072 | 10 | 11 | V |
| 99 | XXL | `inuyukiyamaoekaki` | 2344 | 2944 | 9 | 10 | V |
| 100 | XXL | `nekodaidokorooekaki` | 2540 | 3072 | 10 | 11 | V |
| 101 | XXL | `pandahanabatakebooru` | 2529 | 3072 | 10 | 11 | V |
| 102 | XXL | `nekokouenodoru` | 2545 | 3008 | 10 | 11 | V |
| 103 | XXL | `pandahanabatakeoyatsu` | 2452 | 2560 | 10 | 10 | — |
| 104 | XXL | `pandamoriodoru` | 2555 | 2944 | 10 | 11 | V |
| 105 | XXL | `kumadaidokoroodoru` | 2536 | 2944 | 9 | 10 | V |
| 106 | XXL | `usagihanabatakebooru` | 2535 | 3072 | 10 | 11 | V |
| 107 | XXL | `inukouenodoru` | 2464 | 2816 | 10 | 10 | — |
| 108 | XXL | `usagihanabatakenemuru` | 2571 | 2624 | 10 | 10 | — |
| 109 | XXL | `kumahanabatakebooru` | 2534 | 2944 | 10 | 11 | V |
| 110 | XXL | `inudaidokoroodoru` | 2215 | 3072 | 10 | 11 | V |
| 111 | XXL | `kumahanabatakeodoru` | 2539 | 3072 | 10 | 11 | V |
| 112 | XXL | `nekohanabatakenemuru` | 2539 | 2880 | 9 | 10 | V |
| 113 | XXL | `pandahanabatakeodoru` | 2538 | 3072 | 10 | 11 | V |
| 114 | XXL | `nekoumibeodoru` | 2512 | 3008 | 9 | 9 | — |
| 115 | XXL | `usagihanabatakeoekaki` | 2551 | 3072 | 10 | 11 | V |
| 116 | XXL | `kumaumibeodoru` | 2516 | 2880 | 9 | 9 | — |
| 117 | XXL | `pandadaidokoroodoru` | 2202 | 3072 | 10 | 11 | V |
| 118 | XXL | `usagidaidokoroodoru` | 2125 | 3072 | 10 | 11 | V |
| 119 | XXL | `nekohanabatakebooru` | 2527 | 2944 | 9 | 9 | — |
| 120 | XXL | `inuhanabatakenemuru` | 2553 | 3008 | 9 | 10 | V |
| 121 | XXL | `inumoriodoru` | 2573 | 3008 | 10 | 10 | — |
| 122 | XXL | `usagikouenodoru` | 2547 | 3072 | 10 | 11 | V |
| 123 | XXL | `inuhanabatakebooru` | 2497 | 2880 | 9 | 10 | V |
| 124 | XXL | `nekodaidokoroodoru` | 2570 | 3072 | 9 | 10 | V |
| 125 | XXL | `kumakouenodoru` | 2558 | 3072 | 10 | 10 | — |
| 126 | XXL | `pandahanabatakenemuru` | 2544 | 3072 | 9 | 10 | V |
| 127 | XXL | `nekohanabatakeodoru` | 2528 | 3072 | 10 | 11 | V |
| 128 | XXL | `kumahanabatakenemuru` | 2463 | 3072 | 9 | 10 | V |
| 129 | XXL | `usagiumibeodoru` | 2506 | 3072 | 9 | 10 | V |
| 130 | XXL | `pandahanabatakeoekaki` | 2511 | 2688 | 10 | 10 | — |
| 131 | XXL | `nekomoriodoru` | 2485 | 2816 | 9 | 10 | V |
| 132 | XXL | `pandayukiyamaodoru` | 2525 | 2880 | 8 | 8 | — |
| 133 | XXL | `inuumibeodoru` | 2484 | 3008 | 9 | 10 | V |
| 134 | XXL | `usagihanabatakeodoru` | 2548 | 3072 | 10 | 11 | V |
| 135 | XXL | `inuyukiyamaodoru` | 2544 | 2752 | 9 | 9 | — |
| 136 | XXL | `inuhanabatakeodoru` | 2471 | 2752 | 10 | 10 | — |
| 137 | XXL | `usagiyukiyamaodoru` | 2519 | 3072 | 8 | 9 | V |
| 138 | XXL | `inuhanabatakeoekaki` | 2459 | 2688 | 10 | 11 | V |
| 139 | XXL | `pandaumibeodoru` | 2518 | 2880 | 8 | 9 | V |
| 140 | XXL | `kumahanabatakeoekaki` | 2436 | 2624 | 9 | 9 | — |
| 141 | XXL | `pandakouenodoru` | 2526 | 2880 | 10 | 10 | — |
| 142 | XXL | `kumamoriodoru` | 2550 | 2880 | 9 | 10 | V |
| 143 | XXL | `inuhanabatakeoyatsu` | 2513 | 2688 | 9 | 9 | — |
| 144 | XXL | `nekohanabatakeoyatsu` | 2562 | 2624 | 9 | 9 | — |
| 145 | XXL | `kumayukiyamaodoru` | 2572 | 3072 | 10 | 11 | V |
| 146 | XXL | `usagihanabatakeoyatsu` | 2553 | 3008 | 10 | 11 | V |
| 147 | XXL | `nekoyukiyamaodoru` | 2557 | 3008 | 10 | 11 | V |
| 148 | XXL | `kumahanabatakeoyatsu` | 2546 | 2752 | 9 | 9 | — |
| 149 | XXL | `usagimoriodoru` | 2546 | 3072 | 10 | 11 | V |
| 150 | XXL | `nekohanabatakeoekaki` | 2572 | 2944 | 10 | 11 | V |
