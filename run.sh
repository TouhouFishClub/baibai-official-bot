#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="baibai-official-bot"
readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

# startOrReload 会沿用旧的 cluster 进程形态；这里每次按配置重新 fork 启动。
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$APP_NAME"
fi

pm2 start ecosystem.config.js --only "$APP_NAME" --update-env
pm2 save
