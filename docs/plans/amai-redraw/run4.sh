#!/bin/sh
# 4 つに分けて並列に測る。使い方：sh run4.sh <出力の名前> <回数> [つまみの JSON]
# 1〜212 面（201 面からくり返し）。重い XXL が偏らないように分ける。FROM=101 なら 101〜212 面（足した 100 枚とくり返しの最初）、FROM=151 なら 151〜212 面だけ
D=$(dirname "$0"); O=${OUT:-$D/out}; mkdir -p "$O"; N=$1; R=$2; K=${3:-}
if [ "${FROM:-1}" = 101 ]; then
  set -- 101 128 129 156 157 184 185 212
elif [ "${FROM:-1}" = 151 ]; then
  set -- 151 166 167 182 183 197 198 212
else
  set -- 1 53 54 106 107 159 160 212
fi
node "$D/measure.js" $1 $2 "$R" "$K" > "$O/$N.1.json" 2>/dev/null &
node "$D/measure.js" $3 $4 "$R" "$K" > "$O/$N.2.json" 2>/dev/null &
node "$D/measure.js" $5 $6 "$R" "$K" > "$O/$N.3.json" 2>/dev/null &
node "$D/measure.js" $7 $8 "$R" "$K" > "$O/$N.4.json" 2>/dev/null &
wait
node "$D/summary.js" "$O/$N".?.json > "$O/$N.md"
