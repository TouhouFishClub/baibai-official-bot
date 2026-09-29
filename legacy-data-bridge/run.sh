#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
npm ci --omit=dev

readonly APP_UID="baibai-legacy-data-bridge"

if ! command -v forever >/dev/null 2>&1; then
  echo "未找到服务器现有的 forever 命令。" >&2
  exit 1
fi

forever stop "$APP_UID" >/dev/null 2>&1 || true
forever -a -o out.log -e err.log start \
  --uid "$APP_UID" \
  -c "node --max-old-space-size=8192" \
  src/index.js
