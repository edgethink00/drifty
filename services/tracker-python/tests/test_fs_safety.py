from __future__ import annotations

import errno
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.fs_safety import DataDirectoryUnavailableError, ensure_directory, scratch_directory


class EnsureDirectoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_existing_directory_is_accepted_without_waiting(self) -> None:
        target = self.root / "so.drifty.windows"
        target.mkdir()
        sleeps: list[float] = []

        ensure_directory(target, sleep=sleeps.append)

        self.assertTrue(target.is_dir())
        self.assertEqual(sleeps, [])

    def test_waits_for_a_path_that_is_released_moments_later(self) -> None:
        # Windows reports "already exists" (WinError 183) for a directory whose
        # delete is still pending; the tracker failed every command in that
        # minute (DRIFTY-MAC-NATIVE-12..15). Model the release on the first wait.
        target = self.root / "so.drifty.windows"
        target.write_text("pending")

        def release(_delay: float) -> None:
            target.unlink()

        ensure_directory(target, sleep=release)

        self.assertTrue(target.is_dir())

    def test_names_what_blocks_the_directory_after_bounded_retries(self) -> None:
        target = self.root / "so.drifty.windows"
        target.write_text("not a directory")
        sleeps: list[float] = []

        with self.assertRaises(DataDirectoryUnavailableError) as raised:
            ensure_directory(target, sleep=sleeps.append)

        self.assertIn("a file", str(raised.exception))
        self.assertIsInstance(raised.exception, OSError)
        self.assertEqual(len(sleeps), 5)
        self.assertLess(sum(sleeps), 2.0)


class ScratchDirectoryTests(unittest.TestCase):
    def test_cleanup_failure_does_not_escape_the_block(self) -> None:
        # rmtree on Windows raised "The directory is not empty" (WinError 145)
        # while a scanner still held the copied history file, aborting the whole
        # capture tick (DRIFTY-MAC-NATIVE-A..Z).
        real_rmtree = shutil.rmtree
        attempts: list[bool] = []

        def busy_rmtree(path, ignore_errors=False, *args, **kwargs):
            attempts.append(bool(ignore_errors))
            if not ignore_errors:
                raise OSError(errno.ENOTEMPTY, "The directory is not empty")
            return real_rmtree(path, ignore_errors=True)

        with patch("app.fs_safety.shutil.rmtree", side_effect=busy_rmtree):
            with scratch_directory() as scratch:
                (scratch / "History").write_bytes(b"copy")
                created = scratch

        self.assertEqual(attempts, [False, False, False, True])
        self.assertFalse(created.exists())

    def test_removes_the_directory_normally(self) -> None:
        with scratch_directory() as scratch:
            (scratch / "History").write_bytes(b"copy")
            created = scratch
        self.assertFalse(created.exists())


if __name__ == "__main__":
    unittest.main()
