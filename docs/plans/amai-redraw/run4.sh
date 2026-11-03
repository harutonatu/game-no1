#!/bin/sh
# 4 つに分けて並列に測る。使い方：sh run4.sh <出力の名前> <回数> [つまみの JSON]
D=$(dirname "$0"); O=${OUT:-$D/out}; mkdir -p "$O"; N=$1; R=$2; K=${3:-}
node "$D/measure.js" 1 18 "$R" "$K" > "$O/$N.1.json" 2>/dev/null &
node "$D/measure.js" 19 33 "$R" "$K" > "$O/$N.2.json" 2>/dev/null &
node "$D/measure.js" 34 46 "$R" "$K" > "$O/$N.3.json" 2>/dev/null &
node "$D/measure.js" 47 60 "$R" "$K" > "$O/$N.4.json" 2>/dev/null &
wait
node "$D/summary.js" "$O/$N".?.json > "$O/$N.md"
