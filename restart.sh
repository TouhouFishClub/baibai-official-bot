#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="baibai-official-bot"
readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "$APP_NAME 尚未启动，请先执行 ./run.sh。" >&2
  exit 1
fi

pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
