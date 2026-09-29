#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
npm ci --omit=dev
pm2 startOrReload ecosystem.config.js --only baibai-legacy-data-bridge --update-env
pm2 save
