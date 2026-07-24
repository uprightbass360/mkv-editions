#!/usr/bin/env bash
#
# run-app.sh - spin up the mkv-editions Electron workbench.
#
# Usage:
#   ./run-app.sh          build the app, then open the production window
#   ./run-app.sh dev      hot-reload dev mode (Vite HMR + Electron); edits to
#                         the renderer refresh live. Ctrl-C stops both.
#   ./run-app.sh build    build only, no window
#
# Runs from anywhere; resolves the app relative to this script. WSLg-ready
# (the app's npm scripts already pass --no-sandbox).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/app"
cd "$APP"

# Dependencies present?
if [ ! -d node_modules ]; then
  echo "run-app: installing dependencies (first run)..."
  npm install
fi
# Electron's postinstall can silently no-op on unprivileged/WSL installs, which
# then fails at launch with "Electron uninstall". Ensure the binary is present.
if [ ! -f node_modules/electron/path.txt ]; then
  echo "run-app: completing electron install..."
  node node_modules/electron/install.js
fi

wait_for_port() {  # $1 = port, wait up to ~30s
  local port="$1" i
  for i in $(seq 1 100); do
    if (exec 3<>"/dev/tcp/localhost/$port") 2>/dev/null; then
      exec 3>&- 3<&-
      return 0
    fi
    sleep 0.3
  done
  echo "run-app: dev server did not come up on port $port" >&2
  return 1
}

mode="${1:-start}"
case "$mode" in
  dev)
    echo "run-app: starting Vite dev server (HMR)..."
    npm run dev:renderer >/tmp/mkved-dev-renderer.log 2>&1 &
    rpid=$!
    trap 'kill "$rpid" 2>/dev/null || true' EXIT INT TERM
    wait_for_port 5173
    echo "run-app: launching Electron against the dev server (renderer log: /tmp/mkved-dev-renderer.log)"
    npm run dev:electron
    ;;
  build)
    npm run build
    echo "run-app: build complete (renderer/build + dist-electron)."
    ;;
  start | "")
    npm run build
    echo "run-app: opening the workbench window..."
    npm start
    ;;
  *)
    echo "usage: $0 [start|dev|build]" >&2
    exit 2
    ;;
esac
