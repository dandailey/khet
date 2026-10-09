#!/bin/bash
# Deploy the built game to https://danieldailey.com/khet/ (Daniel's standing approval, 2026-10-09).
# Scope: only /srv/otw/sites/danieldailey.com/khet/ on host "otw". Keeps a timestamped backup beside the
# live file, installs atomically, checks sha256 on disk and over HTTPS, then runs the live headless smoke.
#
# Usage: tools/deploy-live.sh [file=dist/index.html] [target=index.html]
# Rollback: ssh otw 'cd /srv/otw/sites/danieldailey.com/khet && cp -p <target>.bak-<UTC> <target>'
set -euo pipefail
cd "$(dirname "$0")/.."
src=${1:-dist/index.html}
target=${2:-index.html}
dir=/srv/otw/sites/danieldailey.com/khet
url=https://danieldailey.com/khet/
[ "$target" = index.html ] || url="$url$target"
case "$target" in */*|..*|'') echo "target must be a plain file name" >&2; exit 2;; esac
[ -s "$src" ] || { echo "missing $src" >&2; exit 2; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
want=$(sha256sum "$src" | cut -c1-64)
before=$(ssh otw "sha256sum $dir/$target 2>/dev/null | cut -c1-64" || true)
echo "deploy $src -> $dir/$target  new=$want  current=${before:-none}"
[ "$want" = "$before" ] && { echo "already live; nothing to do"; exit 0; }

if [ -n "$before" ]; then ssh otw "cp -p $dir/$target $dir/$target.bak-$stamp"; fi
scp -q "$src" "otw:$dir/.$target.tmp-$stamp"
ssh otw "chmod 644 $dir/.$target.tmp-$stamp && mv $dir/.$target.tmp-$stamp $dir/$target"

ondisk=$(ssh otw "sha256sum $dir/$target | cut -c1-64")
served=$(curl -fsS "$url" | sha256sum | cut -c1-64)
echo "on disk $ondisk; served $served"
if [ "$ondisk" != "$want" ] || [ "$served" != "$want" ]; then
  echo "HASH MISMATCH; roll back with the .bak-$stamp file" >&2; exit 1
fi
echo "installed $(date -u +%FT%TZ); backup ${before:+$target.bak-$stamp}"

chrome=${CHROME_PATH:-$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1)}
KHET_URL="$url" CHROME_PATH="$chrome" node tools/play-ai-smoke.mjs | tail -1
