"""Keep lazy Python imports alive while the Mac updater replaces the bundle."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path


def pin_frozen_archive() -> bool:
    """Snapshot a Mac onefile PYZ before any tracker threads can start.

    PyInstaller 6.22.1 reopens the executable for each lazy import using offsets
    cached at startup. The Mac updater can replace that executable while this
    process is still running. All frozen finders/loaders share this reader, so
    retain its TOC/offsets and redirect only its filename to a private copy in
    the bootloader's existing, automatically cleaned extraction directory.
    """
    if sys.platform != "darwin" or not getattr(sys, "frozen", False):
        return False
    extraction = Path(getattr(sys, "_MEIPASS", ""))
    if not extraction.name.startswith("_MEI") or not extraction.is_dir():
        return False  # Windows/onedir and source runs do not need this workaround.

    snapshot = None
    try:
        importers = sys.modules["pyimod02_importers"]
        reader = importers.pyz_archive
        original = Path(reader._filename)
        if original.parent == extraction and original.name.startswith("drifty-pyz-"):
            return True
        if original.resolve() != Path(sys.executable).resolve():
            return False  # Do not redirect a separate, already stable PYZ.

        fd, filename = tempfile.mkstemp(prefix="drifty-pyz-", dir=extraction)
        snapshot = Path(filename)
        with os.fdopen(fd, "wb") as destination, original.open("rb") as source:
            shutil.copyfileobj(source, destination)
        # A copy, not a hard link: in-place updates must not mutate our archive.
        copied = type(reader)(str(snapshot), start_offset=reader._start_offset, check_pymagic=True)
        if copied.toc != reader.toc:
            raise ValueError("Frozen archive changed during startup")
        reader._filename = str(snapshot)
        return True
    except Exception:
        if snapshot is not None:
            try:
                snapshot.unlink(missing_ok=True)
            except OSError:
                pass  # The bootloader also removes its extraction directory.
        # Preserve startup if temp storage is unavailable or PyInstaller changes.
        # Do not put filesystem paths or exception payloads on the RPC channel.
        print("Drifty could not preserve the frozen import archive for in-process updates.", file=sys.stderr)
        return False
