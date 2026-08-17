"""Tests for the recorded capture platform.

``activity_segments.platform`` was hard-coded to ``"macos"`` from when macOS
was the only capture surface. The UI, CLI and sync path all read that column,
so a Windows row labelled macOS is a falsehood that survives into exports and
aggregates - and one that no crash would ever surface.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import capture_platform as cp  # noqa: E402
from app.storage.db import TrackerDatabase  # noqa: E402
from app.tracker.macos_workspace import Snapshot  # noqa: E402
from tests.support_cleanup import cleanup_temp_dir  # noqa: E402


class CapturePlatformTests(unittest.TestCase):
    def test_maps_the_interpreter_platform_to_a_product_label(self) -> None:
        with patch.object(cp.sys, "platform", "win32"):
            self.assertEqual(cp.capture_platform(), "windows")
        with patch.object(cp.sys, "platform", "darwin"):
            self.assertEqual(cp.capture_platform(), "macos")

    def test_unknown_platforms_report_themselves(self) -> None:
        # Guessing "macos" for an unrecognised platform is how the original
        # bug behaved; an honest label is better than a familiar one.
        with patch.object(cp.sys, "platform", "linux"):
            self.assertEqual(cp.capture_platform(), "linux")


class RecordedPlatformTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.database = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

    def _record(self) -> str | None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-08-17T09:00:00+00:00",
                app_name="Notepad",
                bundle_id="c:/windows/notepad.exe",
                window_title="Untitled",
                source="win32-foreground",
            )
            ,
            sample_seconds=5,
        )
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT platform FROM activity_segments ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return row["platform"] if row else None

    def test_snapshots_record_the_platform_they_were_captured_on(self) -> None:
        self.assertEqual(self._record(), cp.CAPTURE_PLATFORM)


if __name__ == "__main__":
    unittest.main()
