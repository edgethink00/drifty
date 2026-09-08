#!/bin/sh
# Reports which process and worktree own the Vite dev port before QA.
# Prevents QA against a server belonging to another worktree
# (docs/harness-failure-log.md). Read-only: never kills anything.
#
# Usage: scripts/check-dev-server.sh [port]   (default 1420)
# Exit codes: 0 = port free or owned by this worktree, 1 = owned elsewhere or ownership unknown.

# Exit code 2 means invalid input or a failed listener inspection.
if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [port]" >&2
  exit 2
fi
port=${1-1420}
case "$port" in
  ""|*[!0-9]*) echo "Invalid port: use an integer from 1 to 65535." >&2; exit 2 ;;
esac
port=$(printf '%s\n' "$port" | sed 's/^0*//')
if [ -z "$port" ] || [ "${#port}" -gt 5 ] || [ "$port" -gt 65535 ]; then
  echo "Invalid port: use an integer from 1 to 65535." >&2
  exit 2
fi
if ! command -v lsof >/dev/null 2>&1; then
  echo "UNKNOWN: lsof is unavailable; the port was not inspected." >&2
  exit 2
fi
listeners=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>&1)
inspection_status=$?
# lsof returns 1 with no output when no matching listener exists.
if [ "$inspection_status" -eq 1 ] && [ -z "$listeners" ]; then
  echo "Port $port is free. Start this worktree's dev server normally."
  exit 0
fi
if [ "$inspection_status" -ne 0 ] || [ -z "$listeners" ]; then
  echo "UNKNOWN: listener inspection failed; the port is not confirmed free." >&2
  exit 2
fi
for listener in $listeners; do
  case "$listener" in
    *[!0-9]*) echo "UNKNOWN: unexpected listener output; the port was not verified." >&2; exit 2 ;;
  esac
done
result=0
seen=" "
here=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
for pid in $listeners; do
  case "$seen" in *" $pid "*) continue ;; esac
  seen="$seen$pid "

cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
cmd=$(ps -o command= -p "$pid" | cut -c1-160)

echo "Port $port is in use:"
echo "  pid:     $pid"
echo "  command: $cmd"
echo "  cwd:     $cwd"

case "$cwd" in
  "$here"/*|"$here")
    echo "  -> OK: server belongs to this worktree ($here)."
    ;;
  "")
    echo "  -> UNKNOWN: could not establish this listener's worktree ownership."
    echo "     Verify its owner before using it for QA. Do not stop it based on this check."
    result=1
    ;;
  *)
    echo "  -> OTHER WORKTREE: server does NOT belong to this worktree ($here)."
    echo "     It may be an active task. Leave it running and select another supported port for this worktree."
    echo "     Verify the new port and QA URL before testing; this check does not stop or reconfigure servers."
    echo "     See docs/runbooks/visual-qa.md: Parallel Tauri QA across worktrees (isolated mode)."
    result=1
    ;;
esac
done
exit "$result"
