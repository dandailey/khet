#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
# Compile only the reviewed local copy and bridge; never invoke upstream scripts.
gcc -O2 -std=c11 -D_POSIX_C_SOURCE=200809L -Wall -Wextra \
  external/bridge/khetai_cli.c external/bridge/khetai_lib.c \
  -o external/bridge/khetai_cli
