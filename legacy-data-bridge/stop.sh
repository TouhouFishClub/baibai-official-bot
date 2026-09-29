#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

readonly APP_UID="baibai-legacy-data-bridge"

if ! command -v forever >/dev/null 2>&1; then
  echo "未找到服务器现有的 forever 命令。" >&2
  exit 1
fi

if ! forever list 2>/dev/null | grep -F "$APP_UID" >/dev/null; then
  echo "$APP_UID 当前未运行。"
  exit 0
fi

forever stop "$APP_UID"
