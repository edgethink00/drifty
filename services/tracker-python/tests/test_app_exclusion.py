from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.storage.database_maintenance import create_rotating_backup, database_backup_dir, database_quarantine_dir
from app.tracker.app_exclusion import (
    DEFAULT_EXCLUDED_APPS,
    REDACTED_APP_NAME,
    ExcludedAppRule,
    match_app_exclusion,
    redact_snapshot,
)
from app.tracker.capture_contract import Snapshot
from unittest.mock import patch
from tests.support_cleanup import cleanup_temp_dir


class AppExclusionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.db_path)

    def tearDown(self) -> None:
        self.database.close()
        cleanup_temp_dir(self.tempdir)

    def test_seeds_16_default_excluded_apps_once(self) -> None:
        apps = self.database.get_excluded_apps()
        self.assertEqual(len(apps), 16)
        names = {a["name"] for a in apps}
        self.assertIn("1Password", names)
        self.assertIn("Keychain Access", names)
        self.assertIn("Bitwarden", names)
        self.assertIn("Ledger Live", names)

        # Re-opening database should not duplicate seeds
        db2 = TrackerDatabase(self.db_path)
        try:
            self.assertEqual(len(db2.get_excluded_apps()), 16)
        finally:
            db2.close()

    def test_match_app_exclusion_by_name_and_bundle_id(self) -> None:
        rules = [
            ExcludedAppRule(id="1", name="1Password", bundle_id="com.1password.1password", source="default"),
            ExcludedAppRule(id="2", name="Secret Bank", bundle_id=None, source="user"),
        ]
        # Match by bundle id
        m1 = match_app_exclusion("Different Name", "com.1password.1password", rules)
        self.assertIsNotNone(m1)
        self.assertEqual(m1.id, "1")

        # Match by app name (case-insensitive)
        m2 = match_app_exclusion("secret bank", None, rules)
        self.assertIsNotNone(m2)
        self.assertEqual(m2.id, "2")

        # No match
        self.assertIsNone(match_app_exclusion("Safari", "com.apple.Safari", rules))

    def test_redact_snapshot_clears_content_fields(self) -> None:
        snap = Snapshot(
            observed_at="2026-09-11T10:00:00Z",
            app_name="1Password",
            bundle_id="com.1password.1password",
            window_title="Vault Credentials",
            source="frontmost",
            browser_name=None,
            site_domain="vault.1password.com",
            site_title="Vault",
            site_url="https://vault.1password.com",
        )
        redacted = redact_snapshot(snap, "default")
        self.assertEqual(redacted.app_name, REDACTED_APP_NAME)
        self.assertIsNone(redacted.bundle_id)
        self.assertIsNone(redacted.window_title)
        self.assertIsNone(redacted.site_domain)
        self.assertIsNone(redacted.site_url)
        self.assertEqual(redacted.exclusion_source, "default")
        self.assertEqual(redacted.observed_at, snap.observed_at)

    def test_record_snapshot_redacts_and_coalesces_excluded_app(self) -> None:
        snap1 = Snapshot(
            observed_at="2026-09-11T10:00:00Z",
            app_name="1Password",
            bundle_id="com.1password.1password",
            window_title="Item details",
            source="frontmost",
        )
        self.database.record_snapshot(snap1, sample_seconds=5)

        timeline = self.database.fetch_timeline("2026-09-11")
        self.assertEqual(len(timeline), 1)
        seg = timeline[0]
        self.assertEqual(seg["appName"], REDACTED_APP_NAME)
        self.assertIsNone(seg["bundleId"])
        self.assertIsNone(seg["windowTitle"])
        self.assertEqual(seg["exclusionSource"], "default")
        self.assertEqual(seg["durationSeconds"], 5)

        # Second sample within merge gap should coalesce into one continuous segment
        snap2 = Snapshot(
            observed_at="2026-09-11T10:00:05Z",
            app_name="1Password",
            bundle_id="com.1password.1password",
            window_title="Item details 2",
            source="frontmost",
        )
        self.database.record_snapshot(snap2, sample_seconds=5)

        timeline2 = self.database.fetch_timeline("2026-09-11")
        self.assertEqual(len(timeline2), 1)
        self.assertEqual(timeline2[0]["durationSeconds"], 10)
        self.assertEqual(timeline2[0]["appName"], REDACTED_APP_NAME)

    def test_non_excluded_app_records_normally(self) -> None:
        snap = Snapshot(
            observed_at="2026-09-11T10:00:00Z",
            app_name="Xcode",
            bundle_id="com.apple.dt.Xcode",
            window_title="AppDelegate.swift",
            source="frontmost",
        )
        self.database.record_snapshot(snap, sample_seconds=5)

        timeline = self.database.fetch_timeline("2026-09-11")
        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["appName"], "Xcode")
        self.assertEqual(timeline[0]["bundleId"], "com.apple.dt.Xcode")
        self.assertIsNone(timeline[0].get("exclusionSource"))

    def test_save_delete_and_history_operations(self) -> None:
        # Pre-populate history with an app
        snap = Snapshot(
            observed_at="2026-09-11T09:00:00Z",
            app_name="PersonalFinanceApp",
            bundle_id="com.finance.personal",
            window_title="Budget",
            source="frontmost",
        )
        self.database.record_snapshot(snap, sample_seconds=300)

        count = self.database.get_excluded_app_history_count("PersonalFinanceApp", "com.finance.personal")
        self.assertEqual(count, 1)

        # Add to exclusion list
        saved = self.database.save_excluded_app(
            id="com.finance.personal",
            name="PersonalFinanceApp",
            bundle_id="com.finance.personal",
            source="user",
        )
        self.assertEqual(saved["source"], "user")

        # Verify it is in list
        apps = self.database.get_excluded_apps()
        self.assertTrue(any(a["id"] == "com.finance.personal" for a in apps))

        # Delete history for this app
        deleted_count = self.database.delete_excluded_app_history("PersonalFinanceApp", "com.finance.personal")
        self.assertEqual(deleted_count, 1)
        self.assertEqual(self.database.get_excluded_app_history_count("PersonalFinanceApp"), 0)

        # Delete rule
        deleted_rule = self.database.delete_excluded_app("com.finance.personal")
        self.assertTrue(deleted_rule)
        apps_after = self.database.get_excluded_apps()
        self.assertFalse(any(a["id"] == "com.finance.personal" for a in apps_after))
        records = self.database.list_excluded_app_records()
        tombstoned = next(item for item in records if item["id"] == "com.finance.personal")
        self.assertTrue(tombstoned["tombstone"])


    def test_delete_excluded_app_history_uses_permanent_delete_contract(self) -> None:
        keep = Snapshot(
            observed_at="2026-09-11T09:00:00Z",
            app_name="Safari",
            bundle_id="com.apple.Safari",
            window_title="Keep",
            source="frontmost",
        )
        target = Snapshot(
            observed_at="2026-09-11T09:05:00Z",
            app_name="PersonalFinanceApp",
            bundle_id="com.finance.personal",
            window_title="Budget",
            source="frontmost",
        )
        self.database.record_snapshot(keep, sample_seconds=60)
        self.database.record_snapshot(target, sample_seconds=60)
        self.database.set_sync_state({"sync_account_id": "account-a"})
        older_backup = create_rotating_backup(
            self.database.connect(),
            self.db_path,
            interval_seconds=0,
        )
        self.assertIsNotNone(older_backup)
        quarantine_dir = database_quarantine_dir(self.db_path)
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        quarantined_copy = quarantine_dir / "tracker-corrupt-20261006T000000000000Z.sqlite3"
        quarantined_copy.write_bytes(self.db_path.read_bytes())

        deleted_count = self.database.delete_excluded_app_history(
            "PersonalFinanceApp",
            "com.finance.personal",
        )

        self.assertEqual(deleted_count, 1)
        self.assertEqual(
            self.database.get_excluded_app_history_count("PersonalFinanceApp", "com.finance.personal"),
            0,
        )
        self.assertEqual(
            self.database.get_excluded_app_history_count("Safari", "com.apple.Safari"),
            1,
        )
        self.assertFalse(older_backup.exists())
        self.assertFalse(quarantined_copy.exists())
        pending = self.database.get_pending_sync_deletions()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["kind"], "uids")
        self.assertEqual(len(pending[0]["segmentUids"]), 1)
        refreshed_backups = list(database_backup_dir(self.db_path).glob("tracker-*.sqlite3"))
        self.assertEqual(len(refreshed_backups), 1)
        import sqlite3
        from contextlib import closing
        with closing(sqlite3.connect(refreshed_backups[0])) as snapshot:
            remaining = snapshot.execute(
                "SELECT app_name FROM activity_segments ORDER BY app_name"
            ).fetchall()
        self.assertEqual([row[0] for row in remaining], ["Safari"])
        self.assertEqual(
            self.database.delete_excluded_app_history("PersonalFinanceApp", "com.finance.personal"),
            0,
        )

    def test_excluded_app_history_uid_deletion_replays_on_a_second_database(self) -> None:
        from tempfile import TemporaryDirectory
        target = Snapshot(
            observed_at="2026-09-11T09:05:00Z",
            app_name="PersonalFinanceApp",
            bundle_id="com.finance.personal",
            window_title="Budget",
            source="frontmost",
        )
        keep = Snapshot(
            observed_at="2026-09-11T09:06:00Z",
            app_name="Safari",
            bundle_id="com.apple.Safari",
            window_title="Keep",
            source="frontmost",
        )
        self.database.record_snapshot(target, sample_seconds=60)
        self.database.record_snapshot(keep, sample_seconds=60)
        self.database.set_sync_state({"sync_account_id": "account-a"})
        with self.database.connect() as conn:
            target_uid = conn.execute(
                "SELECT segment_uid FROM activity_segments WHERE app_name = ?",
                ("PersonalFinanceApp",),
            ).fetchone()["segment_uid"]

        deleted = self.database.delete_excluded_app_history(
            "PersonalFinanceApp",
            "com.finance.personal",
        )
        self.assertEqual(deleted, 1)
        pending = self.database.get_pending_sync_deletions()
        self.assertEqual(pending[0]["segmentUids"], [target_uid])

        other_dir = TemporaryDirectory()
        self.addCleanup(other_dir.cleanup)
        other = TrackerDatabase(Path(other_dir.name) / "other.sqlite3")
        other.set_sync_state({"sync_account_id": "account-a"})
        other.apply_synced_segments([
            {
                "segmentUid": target_uid,
                "originDeviceId": "22222222-2222-4222-8222-222222222222",
                "startedAt": "2026-09-11T09:05:00Z",
                "endedAt": "2026-09-11T09:06:00Z",
                "durationSeconds": 60,
                "appName": "PersonalFinanceApp",
                "bundleId": "com.finance.personal",
                "windowTitle": "Budget",
                "platform": "macos",
                "source": "unknown",
            },
            {
                "segmentUid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "originDeviceId": "22222222-2222-4222-8222-222222222222",
                "startedAt": "2026-09-11T09:06:00Z",
                "endedAt": "2026-09-11T09:07:00Z",
                "durationSeconds": 60,
                "appName": "Safari",
                "bundleId": "com.apple.Safari",
                "windowTitle": "Keep",
                "platform": "macos",
                "source": "unknown",
            },
        ])
        applied = other.apply_synced_deletions([
            {
                "deletionUid": pending[0]["deletionUid"],
                "kind": pending[0]["kind"],
                "segmentUids": pending[0]["segmentUids"],
            }
        ])
        self.assertEqual(applied, {"applied": 1, "skipped": 0})
        self.assertEqual(other.get_excluded_app_history_count("PersonalFinanceApp", "com.finance.personal"), 0)
        self.assertEqual(other.get_excluded_app_history_count("Safari", "com.apple.Safari"), 1)
        other.close()
    def test_get_current_snapshot_redacts_when_app_is_excluded(self) -> None:
        from app.main import get_current_snapshot
        mock_snap = Snapshot(
            observed_at="2026-09-11T10:00:00Z",
            app_name="1Password",
            bundle_id="com.1password.1password",
            window_title="Secret Vault",
            source="frontmost",
        )
        with patch("app.main.database", return_value=self.database), \
             patch("app.main.current_snapshot", return_value=mock_snap), \
             patch("app.main.DB_PATH", self.db_path):
            res = get_current_snapshot()
            self.assertTrue(res["ok"])
            data = res["data"]
            self.assertEqual(data["appName"], REDACTED_APP_NAME)
            self.assertIsNone(data["bundleId"])
            self.assertIsNone(data["windowTitle"])

    def test_apply_synced_segments_redacts_excluded_remote_rows(self) -> None:
        remote = {
            "segmentUid": "11111111-1111-4111-8111-111111111111",
            "originDeviceId": "22222222-2222-4222-8222-222222222222",
            "startedAt": "2026-09-11T10:00:00Z",
            "endedAt": "2026-09-11T10:01:00Z",
            "durationSeconds": 60,
            "appName": "1Password",
            "bundleId": "com.1password.1password",
            "windowTitle": "Vault",
            "platform": "macos",
            "source": "unknown",
        }
        self.database.set_meta("sync_device_id", "33333333-3333-4333-8333-333333333333")
        result = self.database.apply_synced_segments([remote])
        self.assertEqual(result["inserted"], 1)
        timeline = self.database.fetch_timeline("2026-09-11")
        self.assertEqual(timeline[0]["appName"], REDACTED_APP_NAME)
        self.assertIsNone(timeline[0]["windowTitle"])
        self.assertEqual(timeline[0]["exclusionSource"], "default")


if __name__ == "__main__":
    unittest.main()
