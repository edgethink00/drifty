"""Platform dispatch for foreground-activity capture.

``main.py`` reads snapshots through this module so the daemon loop stays
platform-agnostic. Each platform module owns its capture mechanics and returns
the shared ``Snapshot`` contract from ``capture_contract``.
"""

from __future__ import annotations

import sys

from app.tracker.capture_contract import Snapshot

__all__ = ["Snapshot", "current_snapshot"]


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    if sys.platform == "win32":
        from app.tracker.windows_workspace import current_snapshot as read_windows_snapshot

        return read_windows_snapshot()

    from app.tracker.macos_workspace import current_snapshot as read_macos_snapshot

    return read_macos_snapshot(include_system_transient=include_system_transient)
