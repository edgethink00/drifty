"""Real SQLite fixture for the cross-runtime summary range tests.

The TypeScript test owns logical-day math and sends exact UTC bounds. This
fixture owns only tracker persistence/query behavior and returns the actual DTOs
used by full, paged, compact, project-trend, and live timeline readers.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase  # noqa: E402
from app.storage.live_tail import fetch_live_tail  # noqa: E402


def iso_at(milliseconds: int) -> str:
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat()


def insert(
    database: TrackerDatabase,
    *,
    segment_uid: str,
    started_at: str,
    ended_at: str,
    duration_seconds: int,
    app_name: str,
    origin_device_id: str | None = None,
    exclusion_source: str | None = None,
    platform: str = "macos",
    source: str = "manual",
    bundle_id: str | None = "dev.fixture",
) -> None:
    database.insert_segment(
        {
            "segment_uid": segment_uid,
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_seconds": duration_seconds,
            "app_name": app_name,
            "bundle_id": bundle_id,
            "window_title": "Summary range fixture",
            "platform": platform,
            "source": source,
            "confidence": None,
            "raw_context_json": "{}",
        }
    )
    if origin_device_id is not None or exclusion_source is not None:
        with database.connect() as connection:
            connection.execute(
                "UPDATE activity_segments SET origin_device_id = ?, exclusion_source = ? WHERE segment_uid = ?",
                (origin_device_id, exclusion_source, segment_uid),
            )


def read_window(database: TrackerDatabase, start: str, end: str) -> dict[str, list[dict]]:
    return {
        "full": [database._serialize_row(row) for row in database.timeline(start, end)],
        "page": database.timeline_page(start, end, limit=100)["items"],
        "search": database.search_timeline_page("summary", start, end, limit=100)["items"],
        "compact": database.dashboard_week_timeline(start, end),
        "trend": database.project_trend_timeline(start, end),
        "live": fetch_live_tail(database, start, end, None, None, 50),
    }


def main() -> int:
    request = json.load(sys.stdin)
    boundary_ms = int(request["boundaryMs"])
    first_start_ms = int(request["firstStartMs"])
    second_end_ms = int(request["secondEndMs"])

    with TemporaryDirectory() as directory:
        database = TrackerDatabase(Path(directory) / "tracker.sqlite3", perform_maintenance=False)
        try:
            point_start = iso_at(boundary_ms - 2_000)
            insert(
                database,
                segment_uid="single-point",
                started_at=point_start,
                ended_at=point_start,
                duration_seconds=60,
                app_name="Single point",
            )
            for suffix, device_id in (("a", None), ("b", "peer-device")):
                insert(
                    database,
                    segment_uid=f"multi-point-{suffix}",
                    started_at=point_start,
                    ended_at=point_start,
                    duration_seconds=60,
                    app_name=f"Multi point {suffix}",
                    origin_device_id=device_id,
                )
            insert(
                database,
                segment_uid="long-duration",
                started_at=iso_at(boundary_ms - 10 * 60_000),
                ended_at=iso_at(boundary_ms - 5 * 60_000),
                duration_seconds=1200,
                app_name="Long duration",
            )
            insert(
                database,
                segment_uid="sparse",
                started_at=iso_at(boundary_ms - 10 * 60_000),
                ended_at=iso_at(boundary_ms + 10 * 60_000),
                duration_seconds=120,
                app_name="Sparse drawing",
            )
            insert(
                database,
                segment_uid="final-second",
                started_at=iso_at(boundary_ms - 1_000),
                ended_at=iso_at(boundary_ms),
                duration_seconds=1,
                app_name="Final second",
            )
            insert(
                database,
                segment_uid="excluded-point",
                started_at=point_start,
                ended_at=point_start,
                duration_seconds=60,
                app_name="[Redacted]",
                exclusion_source="user",
            )
            insert(
                database,
                segment_uid="failed-point",
                started_at=point_start,
                ended_at=point_start,
                duration_seconds=60,
                app_name="Unavailable",
                platform="windows",
                source="unknown",
                bundle_id=None,
            )

            first_end = iso_at(boundary_ms - 1_000)
            second_start = iso_at(boundary_ms)
            result = {
                "python": sys.version.split()[0],
                "first": read_window(database, iso_at(first_start_ms), first_end),
                "second": read_window(database, second_start, iso_at(second_end_ms - 1_000)),
            }
            json.dump(result, sys.stdout, sort_keys=True)
            return 0
        finally:
            database.close()


if __name__ == "__main__":
    raise SystemExit(main())
