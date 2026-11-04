#!/bin/sh
# 4 つに分けて並列に測る。使い方：sh run4.sh <出力の名前> <回数> [つまみの JSON]
# 1〜162 面（151 面からくり返し）。重い XXL が偏らないように分ける。FROM=101 なら 101〜162 面だけ（足した 50 枚とくり返しの最初）
D=$(dirname "$0"); O=${OUT:-$D/out}; mkdir -p "$O"; N=$1; R=$2; K=${3:-}
if [ "${FROM:-1}" = 101 ]; then
  set -- 101 116 117 132 133 147 148 162
else
  set -- 1 40 41 80 81 121 122 162
fi
node "$D/measure.js" $1 $2 "$R" "$K" > "$O/$N.1.json" 2>/dev/null &
node "$D/measure.js" $3 $4 "$R" "$K" > "$O/$N.2.json" 2>/dev/null &
node "$D/measure.js" $5 $6 "$R" "$K" > "$O/$N.3.json" 2>/dev/null &
node "$D/measure.js" $7 $8 "$R" "$K" > "$O/$N.4.json" 2>/dev/null &
wait
node "$D/summary.js" "$O/$N".?.json > "$O/$N.md"
