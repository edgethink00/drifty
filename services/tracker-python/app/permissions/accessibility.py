from __future__ import annotations

import subprocess


def read_front_window_title() -> str | None:
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

    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        return None

    output = result.stdout.strip()
    return output or None


def accessibility_granted() -> bool:
    return read_front_window_title() is not None


def has_accessibility_permission() -> bool:
    return accessibility_granted()
