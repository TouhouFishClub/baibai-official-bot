#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="baibai-official-bot"

if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "$APP_NAME 当前未运行。"
  exit 0
fi

pm2 stop "$APP_NAME"
