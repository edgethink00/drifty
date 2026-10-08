from __future__ import annotations

import sqlite3
import sys
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage import database_maintenance as maintenance
from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class DatabaseRecoveryOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clock = datetime(2026, 10, 6, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        cleanup_temp_dir(self.temp)

    def seed(self, name: str, label: str) -> TrackerDatabase:
        database = TrackerDatabase(self.root / name, perform_maintenance=False)
        self.addCleanup(database.close)
        database.insert_segment({
            "started_at": "2026-10-06T00:00:00Z",
            "ended_at": "2026-10-06T00:01:00Z",
            "duration_seconds": 60,
            "app_name": label,
        })
        return database

    def legacy_backup(self, database: TrackerDatabase) -> Path:
        # The pre-publication-record format: a closed SQLite snapshot with a
        # timestamp basename, and no record attributing it to a full DB name.
        directory = maintenance.database_backup_dir(database.db_path)
        directory.mkdir(exist_ok=True)
        path = directory / f"{database.db_path.stem}-20261006T000000000000Z.sqlite3"
        with closing(sqlite3.connect(path)) as destination:
            database.connect().backup(destination)
        return path

    def backup(self, database: TrackerDatabase) -> Path:
        return maintenance.create_rotating_backup(
            database.connect(), database.db_path, now=self.clock, interval_seconds=0,
        )

    @staticmethod
    def labels(path: Path) -> list[str]:
        with closing(sqlite3.connect(path)) as connection:
            return [row[0] for row in connection.execute("SELECT app_name FROM activity_segments ORDER BY id")]

    @staticmethod
    def delete(database: TrackerDatabase) -> int:
        segment_id = str(database.connect().execute("SELECT id FROM activity_segments").fetchone()[0])
        return database.delete_activity_segments([segment_id])

    def test_foreign_legacy_snapshot_cannot_suppress_our_first_backup(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        legacy = self.legacy_backup(first)
        own = maintenance.create_rotating_backup(
            second.connect(), second.db_path, now=self.clock + timedelta(seconds=1),
        )
        self.assertIsNotNone(own)
        self.assertEqual(self.labels(own), ["second"])
        self.assertTrue(legacy.is_file())
        self.assertIsNone(maintenance.create_rotating_backup(
            second.connect(), second.db_path, now=self.clock + timedelta(seconds=2),
        ))

    def test_ambiguous_legacy_restore_preserves_corrupt_source_before_error(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        legacy = self.legacy_backup(first)
        second.close()
        original = b"confirmed synthetic SQLite corruption"
        second.db_path.write_bytes(original)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            maintenance.prepare_database(second.db_path, now=self.clock)
        self.assertEqual(second.db_path.read_bytes(), original)
        self.assertTrue(legacy.is_file())
        self.assertFalse(maintenance.database_quarantine_dir(second.db_path).exists())
        self.assertFalse((self.root / ".tracker.db.recovery-pending").exists())

    def test_owned_recovery_ignores_foreign_legacy_even_when_newest_owned_is_corrupt(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        legacy = self.legacy_backup(first)
        owned = self.backup(second)
        newer = maintenance.create_rotating_backup(
            second.connect(), second.db_path,
            now=self.clock + timedelta(seconds=1), interval_seconds=0,
        )
        newer.write_bytes(b"synthetic corrupt snapshot")
        second.close()
        second.db_path.write_bytes(b"synthetic corrupt source")
        result = maintenance.prepare_database(second.db_path, now=self.clock)
        self.assertEqual(result.restored_backup_path, owned)
        self.assertEqual(self.labels(second.db_path), ["second"])
        self.assertTrue(legacy.is_file())

    def test_only_corrupt_owned_and_ambiguous_legacy_do_not_fall_back_to_foreign_rows(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        legacy = self.legacy_backup(first)
        self.backup(second).write_bytes(b"corrupt owned snapshot")
        second.close()
        second.db_path.write_bytes(b"corrupt live source")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            maintenance.prepare_database(second.db_path, now=self.clock)
        self.assertEqual(second.db_path.read_bytes(), b"corrupt live source")
        self.assertTrue(legacy.exists())

    def test_ambiguous_permanent_deletions_fail_before_any_rows_or_copies_change(self) -> None:
        for method in ("segments", "history", "remote"):
            with self.subTest(method=method):
                directory = self.root / method
                directory.mkdir()
                first = self.seed(f"{method}/tracker.sqlite3", "first")
                second = self.seed(f"{method}/tracker.db", "second")
                legacy = self.legacy_backup(first)
                owned = self.backup(second)
                if method == "remote":
                    with second.connect() as connection:
                        connection.execute("UPDATE activity_segments SET origin_device_id = 'foreign-device'")
                before = second.connect().execute("SELECT count(*) FROM sync_deletions").fetchone()[0]
                with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
                    if method == "segments":
                        self.delete(second)
                    elif method == "history":
                        second.delete_history_range("2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z", {"activity": True})
                    else:
                        second.purge_remote_segments()
                self.assertEqual(self.labels(second.db_path), ["second"])
                self.assertEqual(self.labels(first.db_path), ["first"])
                self.assertTrue(legacy.exists())
                self.assertTrue(owned.exists())
                self.assertEqual(second.connect().execute("SELECT count(*) FROM sync_deletions").fetchone()[0], before)

    def test_single_database_legacy_restore_and_permanent_delete_remain_supported(self) -> None:
        database = self.seed("tracker.sqlite3", "single")
        legacy = self.legacy_backup(database)
        database.close()
        database.db_path.write_bytes(b"synthetic corrupt source")
        result = maintenance.prepare_database(database.db_path, now=self.clock)
        self.assertEqual(result.restored_backup_path, legacy)
        self.assertEqual(self.labels(database.db_path), ["single"])
        database = TrackerDatabase(database.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        self.assertEqual(self.delete(database), 1)
        self.assertFalse(legacy.exists())
        database.close()
        database.db_path.write_bytes(b"synthetic subsequent corruption")
        maintenance.prepare_database(database.db_path, now=self.clock)
        self.assertEqual(self.labels(database.db_path), [])

    def test_recorded_multiple_databases_can_delete_and_recover_independently(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        first_backup = self.backup(first)
        second_backup = self.backup(second)
        self.assertEqual(self.delete(second), 1)
        self.assertTrue(first_backup.exists())
        self.assertFalse(second_backup.exists())
        first.close()
        first.db_path.write_bytes(b"synthetic corruption")
        maintenance.prepare_database(first.db_path, now=self.clock)
        self.assertEqual(self.labels(first.db_path), ["first"])

    def test_suffix_prefix_delete_preserves_actual_foreign_quarantined_original(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        first_backup = self.backup(first)
        first.close()
        original = b"synthetic corrupt first source"
        first.db_path.write_bytes(original)
        recovery = maintenance.prepare_database(first.db_path, now=self.clock)
        second = self.seed("tracker.sqlite", "second")
        self.assertEqual(self.delete(second), 1)
        self.assertEqual(recovery.quarantined_path.read_bytes(), original)
        self.assertTrue(first_backup.exists())
        self.assertEqual(self.labels(first.db_path), ["first"])

    def test_quarantine_matching_preserves_suffixes_and_accepts_owned_sidecars(self) -> None:
        for filename in ("tracker.sqlite", "tracker", "tracker[1].sqlite3"):
            with self.subTest(filename=filename):
                database = self.seed(filename, "delete")
                folder = maintenance.database_quarantine_dir(database.db_path)
                folder.mkdir(exist_ok=True)
                basename = f"{database.db_path.stem}-corrupt-20261006T000000000000Z{database.db_path.suffix}"
                owned = [folder / f"{basename}{suffix}" for suffix in ("", "-wal", "-shm")]
                foreign = [folder / f"{basename}{suffix}" for suffix in (".sqlite3", "3", "-unrelated")]
                # No-suffix DBs must not claim a different DB's extension.
                if not database.db_path.suffix:
                    foreign.append(folder / f"{basename}.sqlite")
                for path in owned + foreign:
                    path.write_bytes(b"synthetic copy")
                self.assertEqual(self.delete(database), 1)
                self.assertTrue(all(not path.exists() for path in owned))
                self.assertTrue(all(path.exists() for path in foreign))

    def test_literal_glob_filename_backup_recovery_does_not_use_other_database(self) -> None:
        first = self.seed("tracker[1].sqlite3", "literal")
        second = self.seed("tracker1.sqlite3", "other")
        first_copy = self.backup(first)
        second_copy = self.backup(second)
        first.close()
        first.db_path.write_bytes(b"synthetic confirmed corruption")
        result = maintenance.prepare_database(first.db_path, now=self.clock)
        self.assertEqual(result.restored_backup_path, first_copy)
        self.assertEqual(self.labels(first.db_path), ["literal"])
        self.assertTrue(second_copy.exists())

    def test_literal_glob_filename_delete_invalidates_only_its_own_snapshot(self) -> None:
        first = self.seed("tracker[1].sqlite3", "literal")
        second = self.seed("tracker1.sqlite3", "other")
        first_copy = self.backup(first)
        second_copy = self.backup(second)
        self.assertEqual(self.delete(first), 1)
        self.assertFalse(first_copy.exists())
        self.assertTrue(second_copy.exists())
        self.assertEqual(self.labels(second.db_path), ["other"])

    def test_longer_hyphenated_stem_backup_is_not_restored_or_deleted(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker-other.sqlite3", "second")
        first_copy = self.backup(first)
        second_copy = self.backup(second)
        first.close()
        first.db_path.write_bytes(b"synthetic corruption")
        result = maintenance.prepare_database(first.db_path, now=self.clock)
        self.assertEqual(result.restored_backup_path, first_copy)
        first = TrackerDatabase(first.db_path, perform_maintenance=False)
        self.addCleanup(first.close)
        self.assertEqual(self.delete(first), 1)
        self.assertTrue(second_copy.exists())
        self.assertEqual(self.labels(second_copy), ["second"])

    def test_longer_hyphenated_stem_unrecorded_legacy_blocks_before_delete(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker-other.sqlite3", "second")
        legacy = self.legacy_backup(second)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            self.delete(first)
        self.assertTrue(legacy.exists())
        self.assertEqual(self.labels(first.db_path), ["first"])

    def test_unrelated_database_does_not_block_single_database_legacy_delete(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        self.seed("notes.sqlite3", "notes")
        legacy = self.legacy_backup(first)
        self.assertEqual(self.delete(first), 1)
        self.assertFalse(legacy.exists())

    def test_persistent_other_owner_record_preserves_legacy_after_owner_file_is_removed(self) -> None:
        first = self.seed("tracker.sqlite3", "first")
        second = self.seed("tracker.db", "second")
        legacy = self.legacy_backup(first)
        self.backup(second)
        second.close()
        second.db_path.unlink()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            self.delete(first)
        self.assertEqual(self.labels(first.db_path), ["first"])
        self.assertTrue(legacy.is_file())

    def test_legacy_arbitrary_filename_sibling_blocks_before_restore_or_delete(self) -> None:
        for name in ("tracker", "tracker.data", "tracker.pid"):
            for action in ("restore", "delete"):
                with self.subTest(name=name, action=action):
                    folder = self.root / f"{name}-{action}"
                    folder.mkdir()
                    foreign = self.seed(f"{folder.name}/{name}", "foreign")
                    legacy = self.legacy_backup(foreign)
                    foreign.close()
                    # A legacy/copy installation may have the DB and snapshot
                    # without a durable owner record. Do not infer its suffix.
                    (folder / f".{name}.maintenance.lock").unlink()
                    current = self.seed(f"{folder.name}/tracker.sqlite3", "current")
                    if action == "restore":
                        current.close()
                        current.db_path.write_bytes(b"synthetic corrupt current source")
                        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
                            maintenance.prepare_database(current.db_path, now=self.clock)
                        self.assertEqual(current.db_path.read_bytes(), b"synthetic corrupt current source")
                        self.assertFalse(maintenance.database_quarantine_dir(current.db_path).exists())
                    else:
                        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
                            self.delete(current)
                        self.assertEqual(self.labels(current.db_path), ["current"])
                    self.assertEqual(self.labels(foreign.db_path), ["foreign"])
                    self.assertEqual(self.labels(legacy), ["foreign"])

    def test_legacy_pid_named_sqlite_sibling_is_not_process_metadata(self) -> None:
        for action in ("restore", "delete"):
            with self.subTest(action=action):
                folder = self.root / f"pid-only-{action}"
                folder.mkdir()
                current = self.seed(f"{folder.name}/tracker.sqlite3", "current")
                foreign = folder / "tracker.pid"
                backups = maintenance.database_backup_dir(foreign)
                backups.mkdir()
                legacy = backups / "tracker-20261006T000000000000Z.sqlite3"
                # Plain closed SQLite: no maintenance metadata or WAL/SHM
                # files may accidentally prove this sibling's ownership.
                with closing(sqlite3.connect(foreign)) as connection:
                    connection.execute("CREATE TABLE identity(label TEXT)")
                    connection.execute("INSERT INTO identity VALUES ('foreign')")
                    connection.commit()
                    with closing(sqlite3.connect(legacy)) as destination:
                        connection.backup(destination)
                original = legacy.read_bytes()
                # An unrecorded PID-named DB can also have a damaged header;
                # do not identify process metadata merely by lack of SQLite magic.
                foreign.write_bytes(b"synthetic corrupt foreign database")
                if action == "restore":
                    current.close()
                    current.db_path.write_bytes(b"synthetic corrupt current source")
                    with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
                        maintenance.prepare_database(current.db_path, now=self.clock)
                    self.assertEqual(current.db_path.read_bytes(), b"synthetic corrupt current source")
                else:
                    with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
                        self.delete(current)
                    self.assertEqual(self.labels(current.db_path), ["current"])
                self.assertEqual(legacy.read_bytes(), original)
                self.assertEqual(foreign.read_bytes(), b"synthetic corrupt foreign database")
                with closing(sqlite3.connect(legacy)) as connection:
                    self.assertEqual(connection.execute("SELECT label FROM identity").fetchone()[0], "foreign")

    def test_same_timestamp_recoveries_preserve_foreign_quarantined_sidecar(self) -> None:
        first = self.root / "tracker.sqlite3"
        first.write_bytes(b"synthetic corrupt first source")
        Path(f"{first}-wal").write_bytes(b"foreign quarantine sidecar")
        recovery = maintenance.prepare_database(first, now=self.clock)
        foreign_sidecar = Path(f"{recovery.quarantined_path}-wal")
        second = self.root / "tracker.sqlite3-wal"
        second.write_bytes(b"synthetic corrupt second source")
        other = maintenance.prepare_database(second, now=self.clock)
        self.assertNotEqual(other.quarantined_path, foreign_sidecar)
        self.assertEqual(foreign_sidecar.read_bytes(), b"foreign quarantine sidecar")
        self.assertEqual(other.quarantined_path.read_bytes(), b"synthetic corrupt second source")

    def test_same_timestamp_repeated_recovery_preserves_previous_original(self) -> None:
        source = self.root / "tracker.sqlite3"
        source.write_bytes(b"synthetic first original")
        first = maintenance.prepare_database(source, now=self.clock)
        source.write_bytes(b"synthetic second original")
        second = maintenance.prepare_database(source, now=self.clock)
        self.assertNotEqual(first.quarantined_path, second.quarantined_path)
        self.assertEqual(first.quarantined_path.read_bytes(), b"synthetic first original")
        self.assertEqual(second.quarantined_path.read_bytes(), b"synthetic second original")

    def test_foreign_quarantined_body_cannot_be_deleted_as_our_sqlite_sidecar(self) -> None:
        for suffix in ("-wal", "-shm", "-journal"):
            with self.subTest(suffix=suffix):
                folder = self.root / suffix[1:]
                folder.mkdir()
                first = self.seed(f"{suffix[1:]}/tracker.sqlite3", "first")
                own_backup = self.backup(first)
                first.close()
                other_path = first.db_path.with_name(f"{first.db_path.name}{suffix}")
                # The source is closed: do not create a second SQLite DB over
                # an active WAL/SHM. Actual recovery leaves a quarantined body
                # and its durable maintenance-owner record, without a live B.
                other_path.write_bytes(b"synthetic corrupt foreign DB")
                recovery = maintenance.prepare_database(other_path, now=self.clock)
                self.assertIsNone(recovery.restored_backup_path)
                first = TrackerDatabase(first.db_path, perform_maintenance=False)
                self.addCleanup(first.close)
                with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*quarantine"):
                    self.delete(first)
                self.assertEqual(self.labels(first.db_path), ["first"])
                self.assertTrue(own_backup.exists())
                self.assertEqual(recovery.quarantined_path.read_bytes(), b"synthetic corrupt foreign DB")

    def test_foreign_quarantined_sidecar_cannot_be_deleted_as_our_database_body(self) -> None:
        for suffix in ("-wal", "-shm", "-journal"):
            with self.subTest(suffix=suffix):
                folder = self.root / f"reverse{suffix}"
                folder.mkdir()
                foreign_path = folder / "tracker.sqlite3"
                foreign_path.write_bytes(b"synthetic corrupt foreign source")
                sidecar = Path(f"{foreign_path}{suffix}")
                if suffix != "-journal":
                    sidecar.write_bytes(b"foreign recovery sidecar")
                # Recovery moves WAL/SHM only. A journal case is represented
                # separately because SQLite does not produce one in WAL mode.
                recovery = maintenance.prepare_database(foreign_path, now=self.clock)
                quarantined_sidecar = Path(f"{recovery.quarantined_path}{suffix}")
                if suffix == "-journal":
                    quarantined_sidecar.write_bytes(b"foreign recovery sidecar")
                current = self.seed(f"reverse{suffix}/tracker.sqlite3{suffix}", "current")
                self.backup(current)
                with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*quarantine"):
                    self.delete(current)
                self.assertEqual(self.labels(current.db_path), ["current"])
                self.assertEqual(quarantined_sidecar.read_bytes(), b"foreign recovery sidecar")


if __name__ == "__main__":
    unittest.main()
