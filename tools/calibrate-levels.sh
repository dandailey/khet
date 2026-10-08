#!/bin/bash
# Adjacent-level calibration: level n+1 (A) vs level n (B) for n in FROM..TO-1, GAMES games each.
# Usage: tools/calibrate-levels.sh [FROM=1] [TO=10] [GAMES=40]
cd "$(dirname "$0")/.." || exit 1
from=${1:-1}; to=${2:-10}; games=${3:-40}
out=tools/results/levels/$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$out"
for ((n = from; n < to; n++)); do
  m=$((n + 1))
  majel-heavy node tools/match.ts --a tools/configs/lv/L$m.json --b tools/configs/lv/L$n.json --games "$games" \
    --concurrency 2 --out "$out/L$m-vs-L$n.jsonl" 2>&1 | grep '^Final' | sed "s/^/L$m vs L$n: /" | tee -a "$out/summary.txt"
done
