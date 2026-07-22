#!/usr/bin/env bash
#
# mkv-editions.sh — dependency check + convenience wrapper for src/gen-editions.py
#
# Usage:
#   ./mkv-editions.sh [--install-deps] <BDMV_dir> <out_dir> \
#       [--mode flat|linked] [--title NAME] [--preserve-chapters] [--qpfile] \
#       "<Edition>=<playlist.mpls>" ...
#   (all options are forwarded verbatim to src/gen-editions.py)
#
#   --install-deps   install any missing dependencies, then continue
#   MKVED_AUTO_INSTALL=1  same, via env var (useful in scripts)
#
# Required: python3, mkvmerge (mkvtoolnix), ffprobe (ffmpeg) — used in BOTH modes
#   (frame-exact boundaries + durations). build.sh itself only calls mkvmerge.
# Optional: x264 and/or x265 — ONLY to re-encode a flat edition using the
#   --qpfile output. Not run by this tool, so they are not auto-installed.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$SCRIPT_DIR/src/gen-editions.py"

# --- pass-through for --install-deps as the first argument ----------------
AUTO_INSTALL="${MKVED_AUTO_INSTALL:-0}"
if [ "${1:-}" = "--install-deps" ]; then
  AUTO_INSTALL=1
  shift
fi

pkg_for() {                       # binary -> distro package name
  case "$1" in
    mkvmerge) echo mkvtoolnix ;;
    ffprobe)  echo ffmpeg ;;
    python3)  echo python3 ;;
    *)        echo "$1" ;;
  esac
}

install_pkgs() {                  # install the given package names
  if   command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y "$@"
  elif command -v dnf     >/dev/null 2>&1; then sudo dnf install -y "$@"
  elif command -v pacman  >/dev/null 2>&1; then sudo pacman -S --needed --noconfirm "$@"
  elif command -v zypper  >/dev/null 2>&1; then sudo zypper install -y "$@"
  elif command -v brew    >/dev/null 2>&1; then brew install "$@"
  else
    echo "No supported package manager found. Please install manually: $*" >&2
    return 1
  fi
}

# --- check dependencies ---------------------------------------------------
missing=()
for bin in python3 mkvmerge ffprobe; do
  command -v "$bin" >/dev/null 2>&1 || missing+=("$bin")
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing dependencies: ${missing[*]}" >&2
  # dedupe package names
  pkgs=()
  for bin in "${missing[@]}"; do pkgs+=("$(pkg_for "$bin")"); done
  mapfile -t pkgs < <(printf '%s\n' "${pkgs[@]}" | sort -u)

  if [ "$AUTO_INSTALL" = "1" ]; then
    echo "Installing: ${pkgs[*]}" >&2
    install_pkgs "${pkgs[@]}"
  else
    echo "Install them, or re-run with --install-deps to do it automatically:" >&2
    for bin in "${missing[@]}"; do printf '  %-9s -> %s\n' "$bin" "$(pkg_for "$bin")" >&2; done
    exit 1
  fi
fi

# --- run ------------------------------------------------------------------
exec python3 "$PY" "$@"
