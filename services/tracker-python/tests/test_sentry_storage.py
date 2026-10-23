from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import sentry_setup

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None


class TrackerStorageEvidenceTests(unittest.TestCase):
    def tearDown(self) -> None:
        sentry_setup._capture_exception = None
        sentry_setup._flush = None
        sentry_setup._initialized = False
        sentry_setup._deferred_mode = None
        sentry_setup._deferred_database_path = None

    def scrub(self, path, error):
        return sentry_setup.scrub_sentry_event(
            {"extra": {"phase": "serve"}},
            {"exc_info": (type(error), error, None)}, database_path=path,
        )

    def test_metadata_only_probe_keeps_numeric_sizes_and_no_private_path_or_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / ("private" + "-database.sqlite3")
            path.write_bytes(b"private row contents")
            wal = Path(str(path) + "-wal")
            with wal.open("wb") as output:
                output.truncate(1024 * 1024 + 1)
            usage = types.SimpleNamespace(free=3 * 1024 * 1024 + 123)
            with patch.object(shutil, "disk_usage", return_value=usage) as disk, patch.object(
                sqlite3, "connect", side_effect=AssertionError("must not open SQLite")
            ), patch("builtins.open", side_effect=AssertionError("must not read contents")), patch.object(
                Path, "open", side_effect=AssertionError("must not read contents")
            ):
                event = self.scrub(path, sqlite3.OperationalError("database or disk is full"))
            disk.assert_called_once_with(path.parent)
        self.assertEqual(event["extra"], {
            "phase": "serve", "tracker_storage_free_mib": 3,
            "tracker_db_present": True, "tracker_db_mib": 1,
            "tracker_wal_present": True, "tracker_wal_mib": 2,
            "tracker_journal_present": False,
        })
        self.assertNotIn(str(path), repr(event))
        self.assertNotIn("private row contents", repr(event))

    def test_failed_probes_preserve_event_without_error_strings_or_false_zero_capacity(self):
        private_error = PermissionError("private" + " directory name")
        with patch.object(shutil, "disk_usage", side_effect=private_error), patch.object(
            Path, "stat", side_effect=private_error
        ):
            event = self.scrub(Path("hidden.sqlite3"), sqlite3.OperationalError("disk I/O error"))
        self.assertEqual(event["extra"], {"phase": "serve", "tracker_storage_probe_failed": True})
        self.assertNotIn(str(private_error), repr(event))
        with patch.object(sentry_setup, "_tracker_storage_context", side_effect=RuntimeError("probe bug")):
            self.assertEqual(self.scrub(Path("hidden.sqlite3"), sqlite3.OperationalError("locked")), {
                "extra": {"phase": "serve"},
            })

    @unittest.skipIf(os.name == "nt", "creating Windows symlinks needs an unrelated OS permission")
    def test_database_symlink_uses_the_target_volume_and_sidecars(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "actual" / "tracker.sqlite3"
            target.parent.mkdir()
            target.write_bytes(b"fixture")
            Path(str(target) + "-wal").write_bytes(b"wal fixture")
            link = root / "linked.sqlite3"
            link.symlink_to(target)
            with patch.object(shutil, "disk_usage", return_value=types.SimpleNamespace(free=1024 * 1024)) as disk:
                event = self.scrub(link, sqlite3.OperationalError("full"))
            disk.assert_called_once_with(target.parent)
            self.assertTrue(event["extra"]["tracker_wal_present"])
            self.assertEqual(event["extra"]["tracker_wal_mib"], 1)

    def test_sqlite_message_or_missing_hint_never_probes_storage(self):
        with patch.object(sentry_setup, "_tracker_storage_context") as probe:
            self.scrub(Path("hidden.sqlite3"), RuntimeError("database or disk is full"))
            self.scrub(None, sqlite3.OperationalError("locked"))
            sentry_setup.scrub_sentry_event({"exception": {"values": [{"type": "OperationalError"}]}},
                                          database_path=Path("hidden.sqlite3"))
            with patch.dict(os.environ, {}, clear=True):
                self.assertFalse(sentry_setup.init_tracker_sentry("serve", database_path=Path("hidden.sqlite3")))
                self.assertFalse(sentry_setup.capture_tracker_exception(sqlite3.OperationalError("locked")))
        probe.assert_not_called()

    def test_deferred_request_preserves_the_configured_database_path(self):
        fake_sdk = types.ModuleType("sentry_sdk")
        for name in ("init", "set_tag", "capture_exception", "flush"):
            setattr(fake_sdk, name, MagicMock())
        path = Path("configured.sqlite3")
        with patch.dict(sys.modules, {"sentry_sdk": fake_sdk}), patch.dict(
            os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://public@example.invalid/1"}, clear=True
        ), patch.object(sentry_setup, "_tracker_storage_context", return_value={"tracker_storage_free_mib": 0}) as probe:
            self.assertTrue(sentry_setup.init_tracker_sentry("request", defer_sdk_import=True, database_path=path))
            probe.assert_not_called()
            error = sqlite3.OperationalError("database or disk is full")
            self.assertTrue(sentry_setup.capture_tracker_exception(error))
            callback = fake_sdk.init.call_args.kwargs["before_send"]
            event = callback({}, {"exc_info": (type(error), error, None)})
        probe.assert_called_once_with(path)
        self.assertEqual(event["extra"], {"tracker_storage_free_mib": 0})
        self.assertIsNone(sentry_setup._deferred_database_path)

    @unittest.skipIf(sentry_sdk is None, "sentry-sdk is installed only for packaged builds")
    def test_real_sdk_and_sqlite_full_keep_capacity_evidence_and_rollback(self):
        sent = []

        class CapturingTransport(sentry_sdk.transport.Transport):
            def capture_envelope(self, envelope):
                sent.extend(item.payload.json for item in envelope.items if item.headers.get("type") == "event")

        real_init = sentry_sdk.init

        def capture_init(*args, **kwargs):
            return real_init(*args, transport=CapturingTransport, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ("private" + "-tracker.sqlite3")
            connection = sqlite3.connect(path)
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("CREATE TABLE sample(value BLOB)")
                connection.execute("INSERT INTO sample VALUES ('preserved')")
                connection.commit()
                count = connection.execute("PRAGMA page_count").fetchone()[0]
                connection.execute(f"PRAGMA max_page_count={count}")
                with patch.object(sentry_sdk, "init", capture_init), patch.dict(
                    os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://public@example.invalid/1"}, clear=True
                ):
                    self.assertTrue(sentry_setup.init_tracker_sentry("serve", database_path=path))
                    try:
                        for handled in (True, False):
                            try:
                                with connection:
                                    connection.execute("INSERT INTO sample VALUES (zeroblob(1000000))")
                            except sqlite3.OperationalError as error:
                                self.assertIn("full", str(error))
                                if handled:
                                    self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "serve"}))
                                else:
                                    # SDK-native capture uses the same hint as its
                                    # uncaught-exception integration, outside our wrapper.
                                    sentry_sdk.capture_exception(error)
                            else:
                                self.fail("fixture must reach real SQLITE_FULL")
                    finally:
                        sentry_sdk.get_client().close()
                self.assertFalse(connection.in_transaction)
                self.assertEqual(connection.execute("SELECT value FROM sample").fetchall(), [("preserved",)])
                self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
            finally:
                connection.close()
        self.assertEqual(len(sent), 2)
        for event in sent:
            self.assertNotIn(str(path), repr(event))
            extras = event["extra"]
            self.assertGreater(extras["tracker_storage_free_mib"], 0)
            self.assertTrue(extras["tracker_db_present"])
            self.assertTrue(extras["tracker_wal_present"])
            self.assertTrue(all(type(value) in (int, bool) for key, value in extras.items() if key.startswith("tracker_")))
