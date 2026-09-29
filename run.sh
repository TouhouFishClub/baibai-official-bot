#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="baibai-official-bot"
readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "$APP_NAME 已存在，正在按最新配置重启。"
  pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.js --only "$APP_NAME"
fi

pm2 save

