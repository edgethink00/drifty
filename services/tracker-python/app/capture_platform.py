"""The platform label recorded alongside captured activity.

``activity_segments.platform`` is not decoration: the desktop UI, the CLI and
the sync path all read it, and a Windows row labelled ``macos`` is a lie that
survives into exported data and cloud aggregates. It was hard-coded when macOS
was the only capture surface.

This is derived from the running interpreter rather than stored on ``Snapshot``
because the tracker only ever records what it captured itself, in-process. A
field would let a caller assert a platform it did not capture on.
"""

from __future__ import annotations

import sys
from typing import Final

__all__ = ["CAPTURE_PLATFORM", "capture_platform"]


def capture_platform() -> str:
    """The platform this process captures activity on."""
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return sys.platform


# Resolved once: the interpreter cannot change platform mid-run, and callers
# on hot paths should not pay a branch per row.
CAPTURE_PLATFORM: Final[str] = capture_platform()

