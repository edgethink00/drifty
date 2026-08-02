from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.database_maintenance import database_backup_dir, quick_check_database
from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot


REMOTE_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
LOCAL_DEVICE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


class DeviceSyncTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.db_path)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _insert_local_segment(self, index: int, *, started_at: str | None = None, ended_at: str | None = None, **overrides) -> None:
        default_started_at = datetime(2026, 7, 6, 9, 0, 0, tzinfo=timezone.utc) + timedelta(minutes=index)
        default_ended_at = default_started_at + timedelta(seconds=30)
        segment = {
            "started_at": started_at or _iso(default_started_at),
            "ended_at": ended_at or _iso(default_ended_at),
            "duration_seconds": 30,
            "app_name": "Code",
            "bundle_id": "com.microsoft.VSCode",
            "window_title": f"Window {index}",
            "platform": "macos",
            "source": "accessibility",
            "confidence": None,
            "raw_context_json": "{}",
        }
        segment.update(overrides)
        self.database.insert_segment(segment)

    def _remote_segment(self, uid: str, *, started_at: str, ended_at: str, app_name: str = "Safari", **overrides) -> dict:
        segment = {
            "segmentUid": uid,
            "originDeviceId": REMOTE_DEVICE_ID,
            "startedAt": started_at,
            "endedAt": ended_at,
            "durationSeconds": 60,
            "appName": app_name,
            "platform": "macos",
            "source": "nsworkspace",
            "classification": {
                "category": "Browsing",
                "productivity": "neutral",
                "source": "llm",
                "confidence": 0.9,
                "reason": "synced",
            },
        }
        segment.update(overrides)
        return segment

    def _snapshot(self, observed_at: str, window_title: str = "main.py") -> Snapshot:
        return Snapshot(
            observed_at=observed_at,
            app_name="Code",
            bundle_id="com.microsoft.VSCode",
            window_title=window_title,
            source="accessibility",
        )


class SyncSchemaTests(DeviceSyncTestCase):
    def test_inserted_segments_get_uid_and_monotonic_sync_seq(self) -> None:
        self._insert_local_segment(0)
        self._insert_local_segment(1)

        with self.database.connect() as conn:
            rows = conn.execute("SELECT segment_uid, sync_seq FROM activity_segments ORDER BY id").fetchall()
        self.assertEqual(len(rows), 2)
        uids = {row["segment_uid"] for row in rows}
        self.assertNotIn(None, uids)
        self.assertEqual(len(uids), 2)
        self.assertLess(rows[0]["sync_seq"], rows[1]["sync_seq"])

    def test_backfill_assigns_uids_and_seeds_counter_for_pre_sync_rows(self) -> None:
        self._insert_local_segment(0)
        self._insert_local_segment(1)
        # Simulate a database that predates the sync schema.
        with self.database.connect() as conn:
            conn.execute("UPDATE activity_segments SET segment_uid = NULL, sync_seq = 0")
            conn.execute("UPDATE sync_counter SET seq = 0 WHERE id = 1")
            conn.execute("DELETE FROM tracker_meta WHERE key = 'sync_schema_v1'")

        reopened = TrackerDatabase(self.db_path)
        with reopened.connect() as conn:
            rows = conn.execute("SELECT id, segment_uid, sync_seq FROM activity_segments ORDER BY id").fetchall()
            counter = conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()["seq"]
        for row in rows:
            self.assertIsNotNone(row["segment_uid"])
            self.assertEqual(row["sync_seq"], row["id"])
        self.assertEqual(counter, max(row["id"] for row in rows))

    def test_record_snapshot_extension_bumps_sync_seq(self) -> None:
        self.database.record_snapshot(self._snapshot("2026-07-06T09:00:00+00:00"), 5, max_merge_gap_seconds=180)
        with self.database.connect() as conn:
            before = conn.execute("SELECT id, sync_seq FROM activity_segments").fetchone()

        self.database.record_snapshot(self._snapshot("2026-07-06T09:00:05+00:00"), 5, max_merge_gap_seconds=180)
        with self.database.connect() as conn:
            rows = conn.execute("SELECT id, sync_seq FROM activity_segments").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], before["id"])
        self.assertGreater(rows[0]["sync_seq"], before["sync_seq"])

    def test_saving_classification_bumps_owning_segment_sync_seq(self) -> None:
        self._insert_local_segment(0)
        with self.database.connect() as conn:
            before = conn.execute("SELECT id, sync_seq FROM activity_segments").fetchone()

        self.database.save_classifications([
            {
                "segmentId": before["id"],
                "category": "Coding",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.95,
            }
        ])
        with self.database.connect() as conn:
            after = conn.execute("SELECT sync_seq FROM activity_segments WHERE id = ?", (before["id"],)).fetchone()
        self.assertGreater(after["sync_seq"], before["sync_seq"])


class LocalWritePathIsolationTests(DeviceSyncTestCase):
    def test_record_snapshot_never_extends_a_remote_segment(self) -> None:
        self.database.record_snapshot(self._snapshot("2026-07-06T09:00:00+00:00"), 5, max_merge_gap_seconds=180)
        # A remote segment with the exact same context and a newer ended_at would
        # be the coalescing target without the origin filter.
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000001",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:00:04+00:00",
                app_name="Code",
                windowTitle="main.py",
            )
        ])

        self.database.record_snapshot(self._snapshot("2026-07-06T09:00:05+00:00"), 5, max_merge_gap_seconds=180)

        with self.database.connect() as conn:
            local_rows = conn.execute(
                "SELECT ended_at FROM activity_segments WHERE origin_device_id IS NULL"
            ).fetchall()
            remote_row = conn.execute(
                "SELECT ended_at, duration_seconds FROM activity_segments WHERE origin_device_id IS NOT NULL"
            ).fetchone()
        self.assertEqual(len(local_rows), 1)
        self.assertEqual(local_rows[0]["ended_at"], "2026-07-06T09:00:05+00:00")
        self.assertEqual(remote_row["ended_at"], "2026-07-06T09:00:04+00:00")
        self.assertEqual(remote_row["duration_seconds"], 60)

    def test_trim_latest_segment_ignores_remote_segments(self) -> None:
        self._insert_local_segment(0, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:05:00+00:00")
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000002",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:30:00+00:00",
            )
        ])

        self.database.trim_latest_segment("2026-07-06T09:02:00+00:00")

        with self.database.connect() as conn:
            local_row = conn.execute(
                "SELECT ended_at FROM activity_segments WHERE origin_device_id IS NULL"
            ).fetchone()
            remote_row = conn.execute(
                "SELECT ended_at FROM activity_segments WHERE origin_device_id IS NOT NULL"
            ).fetchone()
        self.assertEqual(local_row["ended_at"], "2026-07-06T09:02:00+00:00")
        self.assertEqual(remote_row["ended_at"], "2026-07-06T09:30:00+00:00")

    def test_remote_segments_are_not_offered_for_classification(self) -> None:
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000003",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:01:00+00:00",
                classification=None,
            )
        ])
        self._insert_local_segment(0)

        unclassified = self.database.fetch_unclassified_segments()
        self.assertEqual(len(unclassified), 1)
        self.assertIsNone(unclassified[0]["deviceId"])


class SyncOutboxTests(DeviceSyncTestCase):
    def test_outbox_returns_local_rows_after_cursor_with_classifications(self) -> None:
        self._insert_local_segment(0)
        self._insert_local_segment(1)
        with self.database.connect() as conn:
            first = conn.execute("SELECT id, sync_seq FROM activity_segments ORDER BY id").fetchone()
        self.database.save_classifications([
            {"segmentId": first["id"], "category": "Coding", "productivity": "focus", "source": "llm", "confidence": 0.9}
        ])

        outbox = self.database.get_sync_outbox(0, limit=10, hot_grace_seconds=0)

        self.assertEqual(len(outbox["items"]), 2)
        self.assertEqual(outbox["pendingCount"], 2)
        by_title = {item["windowTitle"]: item for item in outbox["items"]}
        self.assertEqual(by_title["Window 0"]["classification"]["category"], "Coding")
        self.assertIsNone(by_title["Window 1"]["classification"])
        self.assertEqual(outbox["batchMaxSeq"], max(item["syncSeq"] for item in outbox["items"]))

        # Cursor semantics: nothing left past batchMaxSeq.
        drained = self.database.get_sync_outbox(outbox["batchMaxSeq"], limit=10, hot_grace_seconds=0)
        self.assertEqual(drained["items"], [])
        self.assertEqual(drained["batchMaxSeq"], outbox["batchMaxSeq"])

    def test_outbox_excludes_remote_rows(self) -> None:
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000004",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:01:00+00:00",
            )
        ])
        self._insert_local_segment(0)

        outbox = self.database.get_sync_outbox(0, limit=10, hot_grace_seconds=0)
        self.assertEqual(len(outbox["items"]), 1)
        self.assertEqual(outbox["items"][0]["appName"], "Code")

    def test_outbox_holds_back_the_hot_segment_until_it_goes_cold(self) -> None:
        cold_end = datetime.now(timezone.utc) - timedelta(hours=1)
        self._insert_local_segment(
            0,
            started_at=_iso(cold_end - timedelta(minutes=5)),
            ended_at=_iso(cold_end),
        )
        hot_end = datetime.now(timezone.utc)
        self._insert_local_segment(
            1,
            started_at=_iso(hot_end - timedelta(minutes=2)),
            ended_at=_iso(hot_end),
        )

        held = self.database.get_sync_outbox(0, limit=10)
        self.assertEqual(len(held["items"]), 1)
        self.assertEqual(held["items"][0]["windowTitle"], "Window 0")
        self.assertEqual(held["pendingCount"], 1)

        released = self.database.get_sync_outbox(0, limit=10, hot_grace_seconds=0)
        self.assertEqual(len(released["items"]), 2)

    def test_cursor_never_advances_past_a_held_hot_segment(self) -> None:
        # Cold segment first, then the hot one; a classification write then bumps
        # the COLD segment's sync_seq above the hot segment's. Without the clamp
        # the cursor would advance past the hot seq while it is excluded, and once
        # cold (nothing re-bumps an unclassified segment) it would be stranded
        # below the cursor forever.
        cold_end = datetime.now(timezone.utc) - timedelta(hours=1)
        self._insert_local_segment(
            0,
            started_at=_iso(cold_end - timedelta(minutes=5)),
            ended_at=_iso(cold_end),
        )
        hot_end = datetime.now(timezone.utc)
        self._insert_local_segment(
            1,
            started_at=_iso(hot_end - timedelta(minutes=2)),
            ended_at=_iso(hot_end),
        )
        with self.database.connect() as conn:
            cold_id = conn.execute(
                "SELECT id FROM activity_segments WHERE window_title = 'Window 0'"
            ).fetchone()["id"]
            hot_seq = conn.execute(
                "SELECT sync_seq FROM activity_segments WHERE window_title = 'Window 1'"
            ).fetchone()["sync_seq"]
        self.database.save_classifications([
            {"segmentId": cold_id, "category": "Coding", "productivity": "focus", "source": "llm", "confidence": 0.9}
        ])

        held = self.database.get_sync_outbox(0, limit=10)

        # The cold segment (now with a higher seq) is returned, but the cursor
        # stays below the held hot segment's seq so it is picked up once cold.
        self.assertEqual([item["windowTitle"] for item in held["items"]], ["Window 0"])
        self.assertLess(held["batchMaxSeq"], hot_seq)

        released = self.database.get_sync_outbox(held["batchMaxSeq"], limit=10, hot_grace_seconds=0)
        self.assertIn("Window 1", [item["windowTitle"] for item in released["items"]])


class ApplySyncedSegmentsTests(DeviceSyncTestCase):
    def test_apply_inserts_then_updates_in_place_by_uid(self) -> None:
        uid = "99999999-0000-0000-0000-000000000005"
        first = self.database.apply_synced_segments([
            self._remote_segment(uid, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")
        ])
        self.assertEqual(first, {"inserted": 1, "updated": 0, "skipped": 0})

        second = self.database.apply_synced_segments([
            self._remote_segment(
                uid,
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:03:00+00:00",
                durationSeconds=180,
            )
        ])
        self.assertEqual(second, {"inserted": 0, "updated": 1, "skipped": 0})

        with self.database.connect() as conn:
            rows = conn.execute("SELECT ended_at, duration_seconds FROM activity_segments WHERE segment_uid = ?", (uid,)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ended_at"], "2026-07-06T09:03:00+00:00")
        self.assertEqual(rows[0]["duration_seconds"], 180)

    def test_apply_writes_classification_for_remote_segment(self) -> None:
        uid = "99999999-0000-0000-0000-000000000006"
        self.database.apply_synced_segments([
            self._remote_segment(uid, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")
        ])

        timeline = self.database.fetch_timeline("2026-07-06")
        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["deviceId"], REMOTE_DEVICE_ID)
        self.assertEqual(timeline[0]["classification"]["category"], "Browsing")
        self.assertEqual(timeline[0]["classification"]["productivity"], "neutral")

    def test_apply_preserves_local_manual_or_rule_classification(self) -> None:
        uid = "99999999-0000-0000-0000-00000000000a"
        self.database.apply_synced_segments([
            self._remote_segment(uid, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")
        ])
        with self.database.connect() as conn:
            segment_id = conn.execute(
                "SELECT id FROM activity_segments WHERE segment_uid = ?", (uid,)
            ).fetchone()["id"]
        # The user re-classifies the remote segment locally (rule/manual override).
        self.database.save_classifications([
            {"segmentId": segment_id, "category": "Work", "productivity": "focus", "source": "manual", "confidence": 1.0}
        ])

        # The originating device re-pushes with a longer duration AND its own
        # LLM classification; the segment fields update but the user's local
        # override must survive.
        self.database.apply_synced_segments([
            self._remote_segment(
                uid,
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:05:00+00:00",
                durationSeconds=300,
            )
        ])

        timeline = self.database.fetch_timeline("2026-07-06")
        self.assertEqual(timeline[0]["durationSeconds"], 300)
        self.assertEqual(timeline[0]["classification"]["category"], "Work")
        self.assertEqual(timeline[0]["classification"]["source"], "manual")

    def test_apply_never_converts_a_local_segment_to_remote(self) -> None:
        self._insert_local_segment(0, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")
        with self.database.connect() as conn:
            local = conn.execute("SELECT segment_uid, ended_at FROM activity_segments").fetchone()

        # An echoed pull of this device's own upload reuses the same uid but
        # carries a different origin device id (e.g. before sync_device_id was
        # cached); it must never rewrite the local row.
        result = self.database.apply_synced_segments([
            self._remote_segment(
                local["segment_uid"],
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:59:00+00:00",
            )
        ])
        self.assertEqual(result, {"inserted": 0, "updated": 0, "skipped": 1})
        with self.database.connect() as conn:
            row = conn.execute("SELECT origin_device_id, ended_at FROM activity_segments").fetchone()
        self.assertIsNone(row["origin_device_id"])
        self.assertEqual(row["ended_at"], local["ended_at"])

    def test_apply_refuses_segments_that_echo_this_device(self) -> None:
        self.database.set_sync_state({"sync_device_id": LOCAL_DEVICE_ID})
        result = self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000007",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:01:00+00:00",
                originDeviceId=LOCAL_DEVICE_ID,
            )
        ])
        self.assertEqual(result, {"inserted": 0, "updated": 0, "skipped": 1})

    def test_purge_remote_segments_leaves_local_rows(self) -> None:
        self._insert_local_segment(0)
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000008",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:01:00+00:00",
            )
        ])

        purged = self.database.purge_remote_segments()
        self.assertEqual(purged, 1)
        with self.database.connect() as conn:
            remaining = conn.execute("SELECT origin_device_id FROM activity_segments").fetchall()
        self.assertEqual(len(remaining), 1)
        self.assertIsNone(remaining[0]["origin_device_id"])

    def test_purge_remote_segments_removes_referencing_project_windows(self) -> None:
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000009",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:03:00+00:00",
            )
        ])
        with self.database.connect() as conn:
            remote_segment_id = str(
                conn.execute(
                    "SELECT id FROM activity_segments WHERE origin_device_id IS NOT NULL"
                ).fetchone()["id"]
            )
        self.database.save_project_window_assignments([
            {
                "windowId": "window:2026-07-06T09:00:00+00:00",
                "windowStartedAt": "2026-07-06T09:00:00+00:00",
                "windowEndedAt": "2026-07-06T09:03:00+00:00",
                "durationSeconds": 180,
                "segmentOverlaps": [
                    {"segmentId": remote_segment_id, "durationSeconds": 180}
                ],
                "projectId": None,
                "teamProjectId": None,
            }
        ])

        self.assertEqual(self.database.purge_remote_segments(), 1)
        self.assertEqual(self.database.get_project_window_assignments(), [])


class SyncDeletionTests(DeviceSyncTestCase):
    def test_delete_activity_segments_records_uid_tombstone(self) -> None:
        self._insert_local_segment(0)
        with self.database.connect() as conn:
            row = conn.execute("SELECT id, segment_uid FROM activity_segments").fetchone()

        deleted = self.database.delete_activity_segments([str(row["id"])])
        self.assertEqual(deleted, 1)

        pending = self.database.get_pending_sync_deletions()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["kind"], "uids")
        self.assertEqual(pending[0]["segmentUids"], [row["segment_uid"]])

    def test_delete_history_range_records_range_tombstone(self) -> None:
        self._insert_local_segment(0, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")

        result = self.database.delete_history_range(
            start="2026-07-06",
            end="2026-07-06",
            scopes={"activity": True},
        )
        self.assertEqual(result["activitySegments"], 1)

        pending = self.database.get_pending_sync_deletions()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["kind"], "range")
        self.assertIsNotNone(pending[0]["rangeStart"])
        self.assertIsNotNone(pending[0]["rangeEnd"])

    def test_dry_run_and_suppressed_tombstones_record_nothing(self) -> None:
        self._insert_local_segment(0, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")
        self.database.delete_history_range(start="2026-07-06", end="2026-07-06", scopes={"activity": True}, dry_run=True)
        self.assertEqual(self.database.get_pending_sync_deletions(), [])

        self.database.delete_history_range(
            start="2026-07-06",
            end="2026-07-06",
            scopes={"activity": True},
            record_tombstone=False,
        )
        self.assertEqual(self.database.get_pending_sync_deletions(), [])

    def test_mark_sync_deletions_pushed_empties_the_outbox(self) -> None:
        self._insert_local_segment(0)
        with self.database.connect() as conn:
            row = conn.execute("SELECT id FROM activity_segments").fetchone()
        self.database.delete_activity_segments([str(row["id"])])

        pending = self.database.get_pending_sync_deletions()
        marked = self.database.mark_sync_deletions_pushed([pending[0]["deletionUid"]])
        self.assertEqual(marked, 1)
        self.assertEqual(self.database.get_pending_sync_deletions(), [])

    def test_apply_synced_deletions_is_idempotent_and_does_not_ping_pong(self) -> None:
        self._insert_local_segment(0, started_at="2026-07-06T09:00:00+00:00", ended_at="2026-07-06T09:01:00+00:00")

        deletion = {
            "deletionUid": "77777777-0000-0000-0000-000000000001",
            "kind": "range",
            "rangeStart": "2026-07-06T00:00:00+00:00",
            "rangeEnd": "2026-07-06T23:59:59+00:00",
        }
        first = self.database.apply_synced_deletions([deletion])
        self.assertEqual(first, {"applied": 1, "skipped": 0})
        self.assertEqual(self.database.fetch_timeline("2026-07-06"), [])
        # Replaying a remote deletion must not create a fresh local tombstone.
        self.assertEqual(self.database.get_pending_sync_deletions(), [])

        second = self.database.apply_synced_deletions([deletion])
        self.assertEqual(second, {"applied": 0, "skipped": 1})

    def test_apply_synced_deletions_by_uids(self) -> None:
        self.database.apply_synced_segments([
            self._remote_segment(
                "99999999-0000-0000-0000-000000000009",
                started_at="2026-07-06T09:00:00+00:00",
                ended_at="2026-07-06T09:01:00+00:00",
            )
        ])

        result = self.database.apply_synced_deletions([
            {
                "deletionUid": "77777777-0000-0000-0000-000000000002",
                "kind": "uids",
                "segmentUids": ["99999999-0000-0000-0000-000000000009"],
            }
        ])
        self.assertEqual(result["applied"], 1)
        self.assertEqual(self.database.fetch_timeline("2026-07-06"), [])

    def test_apply_synced_deletion_page_creates_one_post_batch_backup(self) -> None:
        segment_uids = [
            "99999999-0000-0000-0000-000000000010",
            "99999999-0000-0000-0000-000000000011",
        ]
        self.database.apply_synced_segments(
            [
                self._remote_segment(
                    segment_uid,
                    started_at=f"2026-07-06T09:0{index}:00+00:00",
                    ended_at=f"2026-07-06T09:0{index}:30+00:00",
                )
                for index, segment_uid in enumerate(segment_uids)
            ]
        )

        result = self.database.apply_synced_deletions(
            [
                {
                    "deletionUid": f"77777777-0000-0000-0000-00000000001{index}",
                    "kind": "uids",
                    "segmentUids": [segment_uid],
                }
                for index, segment_uid in enumerate(segment_uids)
            ]
        )

        self.assertEqual(result, {"applied": 2, "skipped": 0})
        backups = list(
            database_backup_dir(self.db_path).glob("tracker-*.sqlite3")
        )
        self.assertEqual(len(backups), 1)
        self.assertTrue(quick_check_database(backups[0], immutable=True))
        self.assertEqual(self.database.fetch_timeline("2026-07-06"), [])


if __name__ == "__main__":
    unittest.main()
