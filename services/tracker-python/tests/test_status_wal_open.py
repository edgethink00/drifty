import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import main


class StatusWalOpenTests(unittest.TestCase):
    def make_closed_wal(self, path):
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("PRAGMA journal_mode=WAL").fetchall()
            connection.execute("CREATE TABLE tracker_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            connection.execute("INSERT INTO tracker_meta VALUES ('last_event_at', 'preserved-event')")
            connection.commit()
            self.assertEqual(connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone(), (0, 0, 0))
        wal = Path(f"{path}-wal")
        if wal.exists():
            self.assertEqual(wal.stat().st_size, 0)
        wal.unlink(missing_ok=True)
        Path(f"{path}-shm").unlink(missing_ok=True)

    def test_status_reads_closed_wal_without_schema_or_metadata_writes(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            self.make_closed_wal(path)
            original = path.read_bytes()
            with patch.object(main, "DB_PATH", path), patch.object(
                main, "_DATABASE_CACHE", None
            ), patch.object(main, "is_running", return_value=False), patch.object(
                main, "_observed_tracker_running", return_value=False
            ), patch.object(
                main, "accessibility_granted", return_value=False
            ), patch.object(main, "database") as initialize:
                result = main.get_status()
                self.assertTrue(result["ok"])
                self.assertFalse(result["data"]["running"])
                self.assertEqual(result["data"]["lastEventAt"], "preserved-event")
                initialize.assert_not_called()
                self.assertIsNone(main._DATABASE_CACHE)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir() if p.is_dir()), [])
            with closing(sqlite3.connect(path)) as reader:
                self.assertEqual(reader.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("tracker_meta",)])
                self.assertEqual(reader.execute("SELECT * FROM tracker_meta").fetchall(), [("last_event_at", "preserved-event")])

    def test_wal_recovery_returns_a_read_only_handle(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            self.make_closed_wal(path)
            connect = sqlite3.connect
            modes = []

            def fail_first_read_only(database, *args, **kwargs):
                mode = "ro" if "mode=ro" in str(database) else "rw"
                modes.append(mode)
                if modes == ["ro"]:
                    raise sqlite3.OperationalError("unable to open database file")
                return connect(database, *args, **kwargs)

            with patch.object(main, "DB_PATH", path), patch.object(
                sqlite3, "connect", side_effect=fail_first_read_only
            ), main._status_database() as db:
                self.assertTrue(db.read_only)
                self.assertEqual(db.get_meta("last_event_at"), "preserved-event")
                with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
                    db.connect().execute("INSERT INTO tracker_meta VALUES ('forbidden', 'write')")
            self.assertEqual(modes, ["ro", "rw", "ro"])

    def test_status_never_bootstraps_over_existing_recovery_files(self):
        for suffix in ("-wal", "-shm", "-journal"):
            with self.subTest(suffix=suffix), TemporaryDirectory() as tmp:
                path = Path(tmp) / "tracker.sqlite3"
                self.make_closed_wal(path)
                sidecar = Path(f"{path}{suffix}")
                sidecar.write_bytes(b"preserve-existing-recovery-evidence")
                original = path.read_bytes()
                with patch.object(main, "DB_PATH", path), patch.object(
                    sqlite3, "connect", side_effect=sqlite3.OperationalError("unable to open database file")
                ) as connect:
                    with self.assertRaisesRegex(sqlite3.OperationalError, "unable to open database file"):
                        with main._status_database():
                            self.fail("status must preserve the open failure")
                    self.assertEqual(connect.call_count, 1)
                self.assertEqual(sidecar.read_bytes(), b"preserve-existing-recovery-evidence")
                self.assertEqual(path.read_bytes(), original)

    def test_status_preserves_a_directory_at_the_database_path(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            path.mkdir()
            marker = path / "preserved.txt"
            marker.write_text("keep")
            # SQLite builds report either CANTOPEN or IOERR for a directory.
            # Preserve this interpreter's original SQLite error exactly.
            with self.assertRaises(sqlite3.OperationalError) as original:
                with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as reader:
                    reader.execute("SELECT 1 FROM sqlite_master").fetchone()
            with patch.object(main, "DB_PATH", path):
                with self.assertRaises(sqlite3.OperationalError) as status_error:
                    with main._status_database():
                        self.fail("a directory is not a status database")
            self.assertEqual(str(status_error.exception), str(original.exception))
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["tracker.sqlite3"])

    def test_status_does_not_recreate_a_database_removed_before_wal_bootstrap(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            self.make_closed_wal(path)
            connect = sqlite3.connect
            modes = []

            def remove_before_writable_open(database, *args, **kwargs):
                mode = "ro" if "mode=ro" in str(database) else "rw"
                modes.append(mode)
                if mode == "ro":
                    raise sqlite3.OperationalError("unable to open database file")
                path.unlink()
                return connect(database, *args, **kwargs)

            with patch.object(main, "DB_PATH", path), patch.object(
                sqlite3, "connect", side_effect=remove_before_writable_open
            ):
                with self.assertRaisesRegex(sqlite3.OperationalError, "unable to open database file"):
                    with main._status_database():
                        self.fail("missing source must not be created")
            self.assertEqual(modes, ["ro", "rw"])
            self.assertFalse(path.exists())

    def test_status_preserves_other_open_errors_and_non_wal_sources(self):
        for error, wal_mode in (("disk I/O error", True), ("database is locked", True), ("unable to open database file", False)):
            with self.subTest(error=error, wal_mode=wal_mode), TemporaryDirectory() as tmp:
                path = Path(tmp) / "tracker.sqlite3"
                if wal_mode:
                    self.make_closed_wal(path)
                else:
                    with closing(sqlite3.connect(path)) as connection:
                        connection.execute("CREATE TABLE preserved (value TEXT)")
                original = path.read_bytes()
                with patch.object(main, "DB_PATH", path), patch.object(
                    sqlite3, "connect", side_effect=sqlite3.OperationalError(error)
                ) as connect:
                    with self.assertRaisesRegex(sqlite3.OperationalError, error):
                        with main._status_database():
                            self.fail("status must preserve the open failure")
                    self.assertEqual(connect.call_count, 1)
                self.assertEqual(path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
