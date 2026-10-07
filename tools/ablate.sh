#!/bin/bash
# Usage: tools/ablate.sh <games> <variant...>  -- each variant vs base, sequential, concurrency 3
cd "$(dirname "$0")/.." || exit 1
games=$1; shift
out=tools/results/ablate-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$out"
for v in "$@"; do
  majel-heavy node tools/match.ts --a tools/configs/ablate/$v.json --b tools/configs/ablate/base.json \
    --games "$games" --concurrency 3 --out "$out/$v.jsonl" 2>&1 | grep '^Final' | sed "s/^/$v: /" | tee -a "$out/summary.txt"
done
