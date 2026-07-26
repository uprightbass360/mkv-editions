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
# Runs from anywhere; resolves the app relative to this script. WSLg-ready:
# it keeps Chromium's sandbox on where the kernel supports it, and only adds
# --no-sandbox as a fallback where it does not (see sandbox_args below).
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

# Chromium's sandbox is mandatory-or-crash: if it cannot initialize, Electron
# aborts at launch rather than running unsandboxed. It sandboxes fine when the
# setuid helper is installed root-owned+setuid, OR when the kernel allows
# unprivileged user namespaces (the namespace sandbox). Only when neither holds
# (old kernels with userns off, Ubuntu 24.04's AppArmor userns restriction, many
# containers) must we pass --no-sandbox to launch at all. Echo the flag if so.
sandbox_args=()
sandbox_needs_flag() {
  local cs="node_modules/electron/dist/chrome-sandbox"
  # setuid sandbox helper installed correctly -> real sandbox works, no flag
  if [ -u "$cs" ] && [ "$(stat -c %u "$cs" 2>/dev/null)" = 0 ]; then return 1; fi
  # unprivileged user namespaces disabled/restricted/exhausted -> need the flag
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = 0 ] && return 0
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" != 0 ] && return 0
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)" = 0 ] && return 0
  return 1  # namespace sandbox available -> keep the sandbox on
}
if sandbox_needs_flag; then
  sandbox_args+=(--no-sandbox)
  echo "run-app: kernel cannot sandbox Chromium here, launching with --no-sandbox"
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
    npm run dev:electron -- "${sandbox_args[@]}"
    ;;
  build)
    npm run build
    echo "run-app: build complete (renderer/build + dist-electron)."
    ;;
  start | "")
    npm run build
    echo "run-app: opening the workbench window..."
    npm start -- "${sandbox_args[@]}"
    ;;
  *)
    echo "usage: $0 [start|dev|build]" >&2
    exit 2
    ;;
esac
