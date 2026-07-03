#!/bin/sh
# Reports which process and worktree own the Vite dev port before QA.
# Prevents QA against a stale server left running by another worktree
# (docs/harness-failure-log.md). Read-only: never kills anything.
#
# Usage: scripts/check-dev-server.sh [port]   (default 1420)
# Exit codes: 0 = port free or owned by this worktree, 1 = owned elsewhere.

port=${1:-1420}
pid=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1)

if [ -z "$pid" ]; then
  echo "Port $port is free. Start this worktree's dev server normally."
  exit 0
fi

cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
cmd=$(ps -o command= -p "$pid" | cut -c1-160)
here=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

echo "Port $port is in use:"
echo "  pid:     $pid"
echo "  command: $cmd"
echo "  cwd:     $cwd"

case "$cwd" in
  "$here"/*|"$here")
    echo "  -> OK: server belongs to this worktree ($here)."
    exit 0
    ;;
  *)
    echo "  -> STALE: server does NOT belong to this worktree ($here)."
    echo "     QA against it would test the wrong bundle. Stop it first, e.g.: kill $pid"
    exit 1
    ;;
esac
