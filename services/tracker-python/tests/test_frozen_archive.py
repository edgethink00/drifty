from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.frozen_archive import pin_frozen_archive


class ArchiveReader:
    """Minimal file-backed lazy reader; frozen binaries cover the real SDK."""

    def __init__(self, filename, start_offset=7, check_pymagic=False):
        self._filename = filename
        self._start_offset = start_offset
        self.toc = {"lazy": (0, len(b"module"))}

    def extract(self):
        with open(self._filename, "rb") as archive:
            archive.seek(self._start_offset)
            return archive.read()


class FrozenArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.extraction = self.root / "_MEIfixture"
        self.extraction.mkdir()
        self.executable = self.root / "tracker"
        self.executable.write_bytes(b"header-module")
        self.executable.chmod(0o755)
        self.reader = ArchiveReader(str(self.executable))
        for attribute, value in (("platform", "darwin"), ("frozen", True),
                                 ("_MEIPASS", str(self.extraction)), ("executable", str(self.executable))):
            p = patch.object(sys, attribute, value, create=True)
            p.start()
            self.addCleanup(p.stop)
        p = patch.dict(sys.modules, {"pyimod02_importers": SimpleNamespace(pyz_archive=self.reader)})
        p.start()
        self.addCleanup(p.stop)

    def test_lazy_reader_survives_replacement_in_place_write_and_removal(self):
        finder_reader = self.reader
        original_stat = self.executable.stat()
        self.assertTrue(pin_frozen_archive())
        snapshot = Path(self.reader._filename)
        self.assertEqual(snapshot.parent, self.extraction)
        if os.name == "posix":
            self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(snapshot.stat().st_ino, original_stat.st_ino)
        self.assertEqual(self.executable.stat().st_mode, original_stat.st_mode)
        self.assertEqual(self.reader._start_offset, 7)
        self.assertEqual(self.reader.toc, {"lazy": (0, 6)})
        self.assertTrue(pin_frozen_archive())
        self.assertEqual(list(self.extraction.iterdir()), [snapshot])
        replacement = self.root / "replacement"
        replacement.write_bytes(b"new offsets and different modules")
        replacement.replace(self.executable)
        self.assertEqual(finder_reader.extract(), b"module")
        self.executable.write_bytes(b"in-place write")
        self.assertEqual(finder_reader.extract(), b"module")
        self.executable.unlink()
        self.assertEqual(finder_reader.extract(), b"module")

    def test_copy_failure_preserves_original_reader_and_removes_partial_file(self):
        with patch("app.frozen_archive.shutil.copyfileobj", side_effect=OSError("private-path")), \
                patch("sys.stderr") as stderr:
            self.assertFalse(pin_frozen_archive())
        self.assertEqual(self.reader._filename, str(self.executable))
        self.assertEqual(list(self.extraction.iterdir()), [])
        self.assertNotIn("private-path", str(stderr.write.call_args_list))

    def test_changed_archive_is_not_used(self):
        self.reader.toc = {"different": (0, 6)}
        with patch("sys.stderr"):
            self.assertFalse(pin_frozen_archive())
        self.assertEqual(self.reader._filename, str(self.executable))
        self.assertEqual(list(self.extraction.iterdir()), [])

    def test_other_runtimes_do_not_copy(self):
        for changes in ({"platform": "win32"}, {"frozen": False}, {"_MEIPASS": str(self.root)}):
            with self.subTest(changes=changes), patch.multiple(sys, **changes), \
                    patch("app.frozen_archive.tempfile.mkstemp") as create:
                self.assertFalse(pin_frozen_archive())
                create.assert_not_called()
        self.assertEqual(list(self.extraction.iterdir()), [])

    def test_separate_pyz_is_left_unchanged(self):
        self.reader._filename = str(self.root / "separate.pyz")
        self.assertFalse(pin_frozen_archive())
        self.assertEqual(list(self.extraction.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
