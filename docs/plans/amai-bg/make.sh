#!/bin/sh
# 見本 6 枚を作る
cd "$(dirname "$0")"
P=..
while read dir id place; do
  python3 bg.py $P/$dir/$id.txt $place $id.txt
  python3 ba.py $P/$dir/$id.txt $id.txt $id-ba.png
  node count.js $P/$dir/$id.txt $id.txt
done <<L
amai-more nekokouenoekaki kouen
amai-redraw usagiumibenemuru umibe
amai-redraw kumadaidokorooyatsu daidokoro
amai-redraw usagiyukiyamaoyatsu yukiyama
amai-more kumamorioyatsu mori
amai-more2 kumahanabatakenemuru hanabatake
L
python3 grid.py samples2.png nekokouenoekaki-ba.png usagiumibenemuru-ba.png kumadaidokorooyatsu-ba.png usagiyukiyamaoyatsu-ba.png kumamorioyatsu-ba.png kumahanabatakenemuru-ba.png
