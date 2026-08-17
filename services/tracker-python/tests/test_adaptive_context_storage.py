import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Final

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from tests.support_cleanup import temp_dir_closing_databases

ADAPTIVE_CONTEXT_FIXTURE: Final = {
    "version": 1,
    "segmentId": "fixture-segment",
    "collectedAt": "2026-07-08T00:00:00+00:00",
    "items": [
        {
            "id": "ctx-parent",
            "depth": 1,
            "kind": "parentPage",
            "sourceFamily": "document_knowledge",
            "values": ["Product research"],
            "extractionConfidence": "medium",
            "localStorage": "stored_local",
            "providerPolicy": "metadata_only",
            "sensitivity": [],
        },
        {
            "id": "ctx-heading",
            "depth": 2,
            "kind": "heading",
            "sourceFamily": "document_knowledge",
            "values": ["Moderator outreach"],
            "extractionConfidence": "medium",
            "localStorage": "stored_local",
            "providerPolicy": "metadata_only",
            "sensitivity": [],
        },
    ],
    "localStorage": "stored_local",
}


class AdaptiveContextStorageTests(unittest.TestCase):
    def test_old_rows_parse_without_adaptive_context(self) -> None:
        # Given: an existing local activity row created before adaptive context storage.
        started_at = "2026-07-08T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-07-08T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Code",
                    "bundle_id": "com.microsoft.VSCode",
                    "window_title": "main.py",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 1.0,
                    "raw_context_json": "{}",
                }
            )

            # When: timeline rows are serialized for the bridge.
            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        # Then: old rows remain valid and do not synthesize adaptive context.
        self.assertNotIn("adaptiveContentContext", segment)

    def test_inserted_context_round_trips_through_timeline_serialization(self) -> None:
        # Given: a row with locally stored derived, policy-labeled adaptive context.
        started_at = "2026-07-08T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-07-08T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Arc",
                    "bundle_id": "company.thebrowser.Browser",
                    "window_title": "Reddit",
                    "browser_name": "Arc",
                    "site_domain": "notion.so",
                    "site_title": "Reddit",
                    "site_url": "https://www.notion.so/workspace/reddit",
                    "site_source": "applescript",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 1.0,
                    "raw_context_json": json.dumps(
                        {"adaptive_content_context": ADAPTIVE_CONTEXT_FIXTURE}
                    ),
                }
            )

            # When: the row is fetched through the local timeline bridge shape.
            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        # Then: the bounded derived context is exposed under the camel-case domain field.
        self.assertEqual(segment["adaptiveContentContext"], ADAPTIVE_CONTEXT_FIXTURE)

    def test_raw_body_like_fields_are_not_serialized_to_segment_shape(self) -> None:
        # Given: stored raw context contains a safe item plus body-like raw fields.
        started_at = "2026-07-08T00:00:00+00:00"
        unsafe_context = {
            "version": 1,
            "segmentId": "fixture-segment",
            "collectedAt": "2026-07-08T00:00:00+00:00",
            "items": [
                {
                    "id": "ctx-safe",
                    "depth": 2,
                    "kind": "heading",
                    "sourceFamily": "document_knowledge",
                    "values": ["Launch planning"],
                    "extractionConfidence": "medium",
                    "localStorage": "stored_local",
                    "providerPolicy": "metadata_only",
                    "sensitivity": [],
                    "documentBody": "Full private body text must stay local and hidden.",
                },
                {
                    "id": "ctx-message-body",
                    "depth": 3,
                    "kind": "messageBody",
                    "sourceFamily": "communication_metadata",
                    "values": ["Raw chat body that must not be serialized."],
                    "extractionConfidence": "high",
                    "localStorage": "stored_local",
                    "providerPolicy": "blocked",
                    "sensitivity": ["message_body"],
                },
            ],
            "localStorage": "stored_local",
            "rawFullPageText": "Full page text must stay out of bridge output.",
        }
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-07-08T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Slack",
                    "window_title": "Launch channel",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 1.0,
                    "raw_context_json": json.dumps(
                        {
                            "adaptive_content_context": unsafe_context,
                            "documentBody": "Top-level body text must not leak.",
                        }
                    ),
                }
            )

            # When: the bridge serializes the segment.
            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        # Then: safe derived items and blocked message-body markers remain without raw text.
        adaptive_context = segment["adaptiveContentContext"]
        self.assertEqual(len(adaptive_context["items"]), 2)
        self.assertEqual(adaptive_context["items"][0]["id"], "ctx-safe")
        message_body_item = adaptive_context["items"][1]
        self.assertEqual(message_body_item["id"], "ctx-message-body")
        self.assertEqual(message_body_item["kind"], "messageBody")
        self.assertEqual(message_body_item["providerPolicy"], "blocked")
        self.assertEqual(message_body_item["sensitivity"], ["message_body"])
        self.assertEqual(message_body_item["values"], ["message body omitted"])
        serialized = json.dumps(adaptive_context)
        self.assertNotIn("documentBody", serialized)
        self.assertNotIn("rawFullPageText", serialized)
        self.assertNotIn("Raw chat body", serialized)
        self.assertNotIn("Full private body", serialized)

    def test_record_snapshot_persists_adaptive_context_when_present(self) -> None:
        # Given: a future adapter has already produced derived context on a snapshot.
        started_at = "2026-07-08T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.record_snapshot(
                Snapshot(
                    observed_at=started_at,
                    app_name="Arc",
                    bundle_id="company.thebrowser.Browser",
                    window_title="Reddit",
                    source="accessibility",
                    browser_name="Arc",
                    site_domain="notion.so",
                    site_title="Reddit",
                    site_url="https://www.notion.so/workspace/reddit",
                    site_source="applescript",
                    adaptive_content_context=ADAPTIVE_CONTEXT_FIXTURE,
                ),
                sample_seconds=5,
            )

            # When: the captured segment is fetched from local storage.
            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        # Then: derived context can round-trip without adding extractor logic.
        self.assertEqual(segment["adaptiveContentContext"], ADAPTIVE_CONTEXT_FIXTURE)

    def test_record_snapshot_bypasses_adaptive_context_when_absent(self) -> None:
        # Given: normal capture has no adaptive context.
        started_at = "2026-07-08T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.record_snapshot(
                Snapshot(
                    observed_at=started_at,
                    app_name="Code",
                    bundle_id="com.microsoft.VSCode",
                    window_title="main.py",
                    source="accessibility",
                ),
                sample_seconds=5,
            )

            # When: raw local storage and bridge serialization are inspected.
            with database.connect() as conn:
                row = conn.execute(
                    "SELECT raw_context_json FROM activity_segments ORDER BY id DESC LIMIT 1"
                ).fetchone()
            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        # Then: storage and UI shape both omit adaptive context when capture did not provide it.
        self.assertNotIn("adaptive_content_context", row["raw_context_json"])
        self.assertNotIn("adaptiveContentContext", segment)


if __name__ == "__main__":
    unittest.main()
