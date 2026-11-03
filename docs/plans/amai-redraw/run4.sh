#!/bin/sh
# 4 つに分けて並列に測る。使い方：sh run4.sh <出力の名前> <回数> [つまみの JSON]
# 1〜112 面（101 面からくり返し）。重い XXL が偏らないように分ける
D=$(dirname "$0"); O=${OUT:-$D/out}; mkdir -p "$O"; N=$1; R=$2; K=${3:-}
node "$D/measure.js" 1 40 "$R" "$K" > "$O/$N.1.json" 2>/dev/null &
node "$D/measure.js" 41 64 "$R" "$K" > "$O/$N.2.json" 2>/dev/null &
node "$D/measure.js" 65 88 "$R" "$K" > "$O/$N.3.json" 2>/dev/null &
node "$D/measure.js" 89 112 "$R" "$K" > "$O/$N.4.json" 2>/dev/null &
wait
node "$D/summary.js" "$O/$N".?.json > "$O/$N.md"
