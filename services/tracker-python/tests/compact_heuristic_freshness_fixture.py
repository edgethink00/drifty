"""One disposable SQLite session for the TypeScript compact freshness test.

JSON-line requests: seed, initialize (save materializer output, then age nine
rows), and save (persist later materializer output). Each response contains
real dashboard_week_timeline DTOs plus stored metadata and the sync counter.
No tracker daemon, network, or user database is involved.
"""

from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase  # noqa: E402
from app.tracker.youtube_metadata import YouTubeVideoMetadata  # noqa: E402

START = "2026-10-12T00:00:00+00:00"
END = "2026-10-13T00:00:00+00:00"
ORIGIN_DEVICE = "11111111-2222-3333-4444-555555555555"
RECEIVER_DEVICE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def insert(database, name, kind="app"):
    browser = kind != "app"
    database.insert_segment({
        "segment_uid": name,
        "started_at": "2026-10-12T09:00:00+00:00",
        "ended_at": "2026-10-12T09:03:00+00:00",
        "duration_seconds": 180,
        "app_name": "Google Chrome" if browser else "Xcode",
        "bundle_id": "com.google.Chrome" if browser else "com.apple.dt.Xcode",
        "window_title": "Synthetic compact freshness",
        "browser_name": "Google Chrome" if browser else None,
        "site_domain": "youtube.com" if kind == "youtube" else "developer.mozilla.org" if browser else None,
        "site_url": "https://www.youtube.com/watch?v=synthetic" if kind == "youtube" else None,
        "youtube_video_id": "synthetic" if kind == "youtube" else None,
        "site_source": "accessibility" if browser else None,
        "platform": "macos", "source": "accessibility", "raw_context_json": "{}",
    })
    with database.connect() as connection:
        return str(connection.execute(
            "SELECT id FROM activity_segments WHERE segment_uid = ?", (name,),
        ).fetchone()["id"])


def save(database, records, now):
    # save_classifications owns refreshed_at; advancing this clock makes an
    # accidental same-label UPSERT observable without sleeps or wall-clock races.
    with patch("app.storage.db.datetime") as clock:
        clock.now.return_value = datetime.fromisoformat(now.replace("Z", "+00:00"))
        return database.save_classifications(records)


def seed(database, origin, now):
    for group in ("current", "stale", "old", "unversioned"):
        for kind in ("app", "domain", "youtube"):
            insert(database, f"{group}-{kind}", kind)
    database.save_youtube_metadata(YouTubeVideoMetadata(
        video_id="synthetic", category="Education", title="Synthetic lecture",
    ))
    rule = database.save_classification_rule({
        "targetKind": "app", "targetValue": "Xcode",
        "category": "entertainment", "productivity": "drift",
    })
    for name, source in (("manual", "manual"), ("ai", "llm"), ("custom-rule", "rule")):
        segment_id = insert(database, name)
        assert save(database, [{
            "segmentId": segment_id, "source": source,
            "category": "entertainment", "productivity": "drift", "confidence": 1,
            "inputFingerprint": f"synthetic:{name}", "classifiedAt": now,
            "classificationRuleId": rule["id"] if source == "rule" else None,
        }], now) == 1

    # Obtain the authoritative rule marker from the real outbox/receive path;
    # there is deliberately no receiver-local rule FK on this classification.
    database.set_sync_state({"sync_account_id": "synthetic", "sync_device_id": RECEIVER_DEVICE})
    origin.set_sync_state({"sync_account_id": "synthetic", "sync_device_id": ORIGIN_DEVICE})
    insert(origin, "synced-rule")
    origin.save_classification_rule({
        "targetKind": "app", "targetValue": "Xcode",
        "category": "entertainment", "productivity": "drift",
    })
    assert origin.apply_classification_rules()["appliedCount"] == 1
    outbox = origin.get_sync_outbox(0, hot_grace_seconds=0)
    assert len(outbox["items"]) == 1
    database.apply_synced_segments([
        {**item, "originDeviceId": ORIGIN_DEVICE} for item in outbox["items"]
    ])


def age_refresh_controls(database):
    with database.connect() as connection:
        for group in ("stale", "old", "unversioned"):
            connection.execute(
                """UPDATE activity_classifications
                   SET stale = ?, taxonomy_version = CASE ?
                       WHEN 'old' THEN 'builtin-heuristics-obsolete'
                       WHEN 'unversioned' THEN NULL ELSE taxonomy_version END,
                       category = 'entertainment', productivity = 'drift'
                   WHERE segment_id IN (
                       SELECT id FROM activity_segments WHERE segment_uid LIKE ?
                   )""",
                (1 if group == "stale" else 0, group, f"{group}-%"),
            )


def state(database, saved):
    with database.connect() as connection:
        rows = connection.execute(
            """SELECT s.segment_uid AS name, s.id, s.sync_seq,
                      c.input_fingerprint, c.classified_at, c.refreshed_at,
                      c.taxonomy_version, c.stale, c.source, c.category, c.productivity,
                      c.classification_rule_id, p.rule_snapshot_kind
               FROM activity_segments s
               LEFT JOIN activity_classifications c ON c.segment_id = s.id
               LEFT JOIN sync_classification_provenance p ON p.segment_id = s.id
               ORDER BY s.id""",
        ).fetchall()
        stored = {row["name"]: dict(row) for row in rows}
        counter = connection.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()["seq"]
    return {
        "compact": database.dashboard_week_timeline(START, END),
        "rows": stored, "syncCounter": counter, "saved": saved,
    }


def main():
    with TemporaryDirectory(prefix="drifty-compact-freshness-") as directory:
        database = TrackerDatabase(Path(directory) / "receiver.sqlite3", perform_maintenance=False)
        origin = TrackerDatabase(Path(directory) / "origin.sqlite3", perform_maintenance=False)
        try:
            for line in sys.stdin:
                request = json.loads(line)
                command = request["command"]
                if command == "seed":
                    seed(database, origin, request["now"])
                    saved = 0
                elif command in ("initialize", "save"):
                    saved = save(database, request["classifications"], request["now"])
                    if command == "initialize":
                        age_refresh_controls(database)
                else:
                    raise ValueError(f"Unknown fixture command: {command}")
                print(json.dumps(state(database, saved)), flush=True)
        finally:
            origin.close()
            database.close()


if __name__ == "__main__":
    main()
