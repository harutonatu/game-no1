#!/bin/sh
# 148 枚をうめる・数える・場所ごとの一覧を作る（list.tsv：面 段 フォルダ id）
cd "$(dirname "$0")"
mkdir -p out
while IFS="	" read face tier dir id; do
  for p in kouen umibe daidokoro yukiyama mori hanabatake; do case $id in *$p*) place=$p;; esac; done
  printf "%s %s %s " "$face" "$id" "$place"; python3 bg.py ../$dir/$id.txt $place out/$id.txt
done < list.tsv > out/horizon.log
for p in kouen umibe daidokoro yukiyama mori hanabatake; do
  awk -F"	" -v p=$p 'index($4,p){print $1":"$4":../"$3"/"$4".txt:out/"$4".txt"}' list.tsv > out/.items
  n=$(wc -l < out/.items); k=1; i=0
  while [ $i -lt $n ]; do
    sed -n "$((i+1)),$((i+10))p" out/.items | xargs python3 sheet.py out/sheet-$p-$k.png
    i=$((i+10)); k=$((k+1))
  done
done
rm -f out/.items
python3 counts.py > /dev/null
node count.js out/*.txt | grep -c "parse OK"   # 148 なら全部 OK
