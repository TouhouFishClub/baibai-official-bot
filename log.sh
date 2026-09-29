#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="baibai-official-bot"
readonly LINES="${1:-200}"

exec pm2 logs "$APP_NAME" --out --lines "$LINES"
