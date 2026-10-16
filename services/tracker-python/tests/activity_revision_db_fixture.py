"""Synthetic SQLite mutations for the TypeScript row-revision consumers."""
from datetime import datetime, timedelta
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail


def seed(database, started_at):
    database.insert_segment({
        "started_at": started_at.isoformat(),
        "ended_at": (started_at + timedelta(seconds=185)).isoformat(),
        "duration_seconds": 185, "app_name": "Drifty", "bundle_id": "so.drifty",
        "window_title": "Synthetic revision", "platform": "macos",
        "source": "nsworkspace", "raw_context_json": "{}",
    })


def state(database):
    row = database.timeline()[0]
    return {
        "full": database._serialize_row(row),
        "compact": database.dashboard_week_timeline(None, None)[0],
        "live": fetch_live_tail(database, None, None, None, None)[0],
    }


def produce(started_at):
    with TemporaryDirectory() as root:
        databases = [
            TrackerDatabase(Path(root) / (name + ".sqlite3"), perform_maintenance=False)
            for name in ("trim", "origin", "receiver")
        ]
        database, origin, receiver = databases
        try:
            seed(database, started_at)
            database.save_classifications([{
                "segmentId": database.timeline()[0]["id"],
                "category": "workspace", "productivity": "focus",
                "source": "manual", "confidence": 1,
            }])
            before = state(database)
            database.trim_latest_segment((started_at + timedelta(seconds=60)).isoformat())
            after = state(database)
            origin_device = "11111111-2222-3333-4444-555555555555"
            origin.set_sync_state({"sync_account_id": "synthetic", "sync_device_id": origin_device})
            receiver.set_sync_state({
                "sync_account_id": "synthetic",
                "sync_device_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            })
            seed(origin, started_at)
            segment_id = origin.timeline()[0]["id"]
            origin.save_classifications([{
                "segmentId": segment_id, "category": "entertainment",
                "productivity": "drift", "source": "manual", "confidence": 1,
            }])
            first = origin.get_sync_outbox(0, hot_grace_seconds=0)
            receiver.apply_synced_segments([
                {**item, "originDeviceId": origin_device} for item in first["items"]
            ])
            classified = state(receiver)
            with origin.connect() as conn:
                conn.execute("DELETE FROM activity_classifications WHERE segment_id = ?", (segment_id,))
            deletion = origin.get_sync_outbox(first["batchMaxSeq"], hot_grace_seconds=0)
            assert len(deletion["items"]) == 1
            assert deletion["items"][0]["classification"] is None
            assert all("revision" not in item for item in first["items"] + deletion["items"])
            receiver.apply_synced_segments([
                {**item, "originDeviceId": origin_device} for item in deletion["items"]
            ])
            return {
                "trim": {"before": before, "after": after},
                "classificationDelete": {"before": classified, "after": state(receiver)},
            }
        finally:
            for database in databases:
                database.close()


if __name__ == "__main__":
    print(json.dumps(produce(datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")))))
