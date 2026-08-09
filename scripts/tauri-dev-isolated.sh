#!/bin/sh

set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cleanup_dir=$(mktemp -d "${TMPDIR:-/tmp}/drifty-isolated-cleanup.XXXXXX") || exit 1
cleanup_marker="$cleanup_dir/started"
export DRIFTY_ISOLATED_CLEANUP_MARKER="$cleanup_marker"

cleanup_tracker() {
  if [ -f "$cleanup_marker" ]; then
    if ! node "$script_dir/tauri-dev-isolated.mjs" --cleanup-tracker >/dev/null; then
      echo "[tauri-dev-isolated] could not confirm isolated tracker shutdown" >&2
    fi
  fi
  rm -f "$cleanup_marker"
  rmdir "$cleanup_dir" 2>/dev/null || true
}

# npm handles terminal signals outside the Node launcher. This shell remains
# long enough to run cleanup after npm interrupts the foreground process group.
trap cleanup_tracker EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

node "$script_dir/tauri-dev-isolated.mjs" "$@"
