"""Windows process-table snapshot for tracker daemon reconciliation.

``app.main`` identifies its own daemons by *command line*, not by executable
name: two daemons only conflict when they point at the same ``--db`` path, and
a frozen sidecar and a source checkout must be told apart by their runtime
path. The Unix implementation gets that from ``ps -axww -o command=``.

Windows has no ``ps``, and the Toolhelp32 snapshot used elsewhere in this port
exposes only the executable name. Full command lines live in the process
environment block, reachable through `Win32_Process.CommandLine`. This module
reads it through CIM/WMI, which is present on every supported Windows install
and needs no third-party package, keeping the tracker stdlib-only.

Failure is reported as ``None`` rather than an empty table. The caller treats
an empty table as "no daemon is running" and would happily start a second one;
an unreadable table must never look like an empty one.
"""

from __future__ import annotations

import json
import subprocess
import time

__all__ = ["windows_process_table", "windows_process_command"]

# CIM is the supported successor to the removed `wmic` utility. Selecting only
# ProcessId/CommandLine keeps the payload small on a busy desktop.
_POWERSHELL_QUERY = (
    "Get-CimInstance Win32_Process | "
    "Select-Object ProcessId,CommandLine | "
    "ConvertTo-Json -Compress -Depth 2"
)
_QUERY_TIMEOUT_SECONDS = 20

# A CIM snapshot costs ~480ms on the Phase 1 test host, and that cost is
# PowerShell start-up rather than the query: an equivalent WQL projection
# measured the same. Lifecycle operations read the table more than once by
# design (inspect, act, then confirm the result), and `is_running` sits behind
# `get_status`, which the UI polls. Without a cache a single start_tracking
# call would spend about two seconds shelling out.
#
# The window is deliberately shorter than any interval over which a daemon
# could start or exit and matter: reads inside one lifecycle operation share a
# snapshot, anything later re-queries. Callers that must observe a change they
# just caused invalidate explicitly.
_CACHE_TTL_SECONDS = 0.75
_cached_table: dict | None = None
_cached_at: float = 0.0


def invalidate_process_table_cache() -> None:
    """Drop the cached snapshot before observing a change we just made."""
    global _cached_table, _cached_at
    _cached_table = None
    _cached_at = 0.0


def windows_process_table(*, deadline: float | None = None) -> dict | None:
    """Read commands within an optional monotonic Stop deadline.

    Generic callers keep the existing query timeout. An expired Stop budget is
    an unreadable snapshot, never evidence that no daemon is running.
    """
    global _cached_table, _cached_at
    now = time.monotonic()
    timeout_seconds = _QUERY_TIMEOUT_SECONDS
    if deadline is not None:
        timeout_seconds = min(timeout_seconds, deadline - now)
        if timeout_seconds <= 0:
            return None
    if _cached_table is not None and now - _cached_at < _CACHE_TTL_SECONDS:
        return dict(_cached_table)

    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                _POWERSHELL_QUERY,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            check=False,
            creationflags=_no_window_flag(),
        )
    except Exception:
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    # A single process serializes as an object rather than a list.
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return None

    processes: dict = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        pid = row.get("ProcessId")
        command = row.get("CommandLine")
        # System processes report a null command line; they are never tracker
        # daemons, and dropping them keeps the table shaped like the Unix one.
        if isinstance(pid, int) and isinstance(command, str) and command.strip():
            processes[pid] = command.strip()
    completed_at = time.monotonic()
    if deadline is not None and completed_at >= deadline:
        return None
    _cached_table = processes
    _cached_at = completed_at
    return dict(processes)


def _no_window_flag() -> int:
    """CREATE_NO_WINDOW, so reconciliation never flashes a console window."""
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def windows_process_command(pid: int, *, deadline: float | None = None) -> str | None:
    """The command line for one pid, or ``None`` when it cannot be read.

    Served from the full snapshot rather than a per-pid query: the caller uses
    this to decide whether a *specific* daemon is ours, and a pid that has
    exited must read as absent rather than as an error.
    """
    processes = windows_process_table(**({"deadline": deadline} if deadline is not None else {}))
    if processes is None:
        return None
    return processes.get(pid)
