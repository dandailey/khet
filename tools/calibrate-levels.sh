#!/bin/bash
# Adjacent-level calibration matches: higher level as A. Usage: tools/calibrate-levels.sh
cd "$(dirname "$0")/.." || exit 1
out=tools/results/levels/$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$out"
run() { majel-heavy node tools/match.ts --a tools/configs/lv/L$2.json --b tools/configs/lv/L$1.json --games "$3" \
  --concurrency 2 --out "$out/L$2-vs-L$1.jsonl" 2>&1 | grep '^Final' | sed "s/^/L$2 vs L$1: /" | tee -a "$out/summary.txt"; }
run 1 2 60; run 2 3 60; run 3 4 40; run 4 5 30
