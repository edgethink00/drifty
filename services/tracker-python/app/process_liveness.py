"""Platform ownership for app-launched sampling; standalone CLI stays independent."""

from __future__ import annotations

from contextlib import contextmanager
import sys
from typing import Iterator, Protocol


class ProcessOwner(Protocol):
    def is_alive(self) -> bool: ...

    def wait_until_exit(self, seconds: float) -> bool: ...


@contextmanager
def tracker_app_owner() -> Iterator[ProcessOwner | None]:
    if sys.platform == "darwin":
        from app.macos_process_liveness import tracker_app_owner as native_owner
    elif sys.platform == "win32":
        from app.windows_process_liveness import tracker_app_owner as native_owner
    else:
        yield None
        return
    with native_owner() as owner:
        yield owner
