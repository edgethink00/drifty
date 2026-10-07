"""Dedicated native-messaging entry. No tracker database, CLI or telemetry."""
from __future__ import annotations

import sys

from app.tracker.browser_content import EXTENSION_ORIGIN


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] != EXTENSION_ORIGIN:
        return 1
    from app.tracker.browser_content_host import run_native_host

    return run_native_host(sys.argv[1])


if __name__ == "__main__":
    raise SystemExit(main())
