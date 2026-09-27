from __future__ import annotations

import subprocess
import sys

OSASCRIPT_TIMEOUT_SECONDS = 5.0


def read_front_window_title() -> str | None:
    # osascript is macOS-only. Calling it unconditionally raised WinError 2 out
    # of every get_status on Windows, which surfaced as the sidecar reporting
    # ok=false for a request that has nothing to do with accessibility.
    if sys.platform != "darwin":
        return None

    script = """
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      tell process frontApp
        if exists front window then
          return name of front window
        end if
      end tell
    end tell
    """

    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=OSASCRIPT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return None

    if result.returncode != 0:
        return None

    output = result.stdout.strip()
    return output or None


def accessibility_granted() -> bool:
    """Whether the OS grants this process the access foreground capture needs.

    On macOS this is a real gate: reading another app's window title requires
    the Accessibility permission, and the probe above is how we detect it.

    Windows has no equivalent grant. ``GetForegroundWindow`` and
    ``GetWindowTextW`` work for any process in the user's own session, so
    reporting "granted" is the honest answer rather than an optimistic one -
    there is no permission the user could be asked to enable.
    """
    if sys.platform == "win32":
        return True
    return read_front_window_title() is not None


def has_accessibility_permission() -> bool:
    return accessibility_granted()
