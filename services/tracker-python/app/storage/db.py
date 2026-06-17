from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.storage.activity_segment_serialization import json_list, serialize_activity_row
from app.storage.timestamps import parse_iso_datetime
from app.tracker.macos_workspace import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


VALID_RULE_TARGET_KINDS = {"app", "site"}
DEFAULT_RULE_CONFIDENCE = 1.0


class TrackerDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS activity_segments (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  started_at TEXT NOT NULL,
                  ended_at TEXT NOT NULL,
                  duration_seconds INTEGER NOT NULL,
                  app_name TEXT NOT NULL,
                  bundle_id TEXT,
                  window_title TEXT,
                  site_domain TEXT,
                  site_title TEXT,
                  site_url TEXT,
                  youtube_video_id TEXT,
                  youtube_playlist_id TEXT,
                  youtube_is_shorts INTEGER,
                  browser_name TEXT,
                  site_source TEXT,
                  platform TEXT NOT NULL,
                  source TEXT NOT NULL,
                  confidence REAL,
                  raw_context_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_activity_segments_started_at
                ON activity_segments(datetime(started_at));

                CREATE INDEX IF NOT EXISTS idx_activity_segments_ended_at
                ON activity_segments(datetime(ended_at));

                CREATE TABLE IF NOT EXISTS tracker_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS youtube_video_metadata (
                  video_id TEXT PRIMARY KEY,
                  category TEXT,
                  channel_id TEXT,
                  channel_name TEXT,
                  title TEXT,
                  description TEXT,
                  keywords_json TEXT,
                  duration_seconds INTEGER,
                  view_count INTEGER,
                  is_live INTEGER,
                  is_unlisted INTEGER,
                  publish_date TEXT,
                  upload_date TEXT,
                  source TEXT,
                  status TEXT NOT NULL,
                  fetched_at TEXT,
                  next_retry_at TEXT,
                  error_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS activity_classifications (
                  segment_id INTEGER PRIMARY KEY REFERENCES activity_segments(id) ON DELETE CASCADE,
                  input_fingerprint TEXT NOT NULL,
                  category TEXT NOT NULL,
                  productivity TEXT NOT NULL,
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  reason TEXT,
                  model TEXT,
                  prompt_version TEXT,
                  taxonomy_version TEXT,
                  request_id TEXT,
                  latency_ms INTEGER,
                  classified_at TEXT NOT NULL,
                  refreshed_at TEXT,
                  ai_result INTEGER NOT NULL DEFAULT 0,
                  stale INTEGER NOT NULL DEFAULT 0,
                  classification_rule_id TEXT REFERENCES classification_rules(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS classification_rules (
                  id TEXT PRIMARY KEY,
                  target_kind TEXT NOT NULL,
                  target_value TEXT NOT NULL,
                  normalized_target_value TEXT NOT NULL,
                  category TEXT NOT NULL,
                  productivity TEXT NOT NULL,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  confidence REAL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_activity_classifications_reusable_ai
                ON activity_classifications(input_fingerprint, ai_result, stale, classified_at DESC, segment_id DESC);

                CREATE UNIQUE INDEX IF NOT EXISTS idx_classification_rules_target
                ON classification_rules(target_kind, normalized_target_value);

                CREATE INDEX IF NOT EXISTS idx_classification_rules_enabled
                ON classification_rules(enabled, target_kind, normalized_target_value);
                """
            )
            self._ensure_columns(conn)

    def _ensure_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(activity_segments)")}
        optional_columns = {
            "site_domain": "TEXT",
            "site_title": "TEXT",
            "site_url": "TEXT",
            "youtube_video_id": "TEXT",
            "youtube_playlist_id": "TEXT",
            "youtube_is_shorts": "INTEGER",
            "browser_name": "TEXT",
            "site_source": "TEXT",
        }
        for column, column_type in optional_columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE activity_segments ADD COLUMN {column} {column_type}")

        metadata_existing = {row["name"] for row in conn.execute("PRAGMA table_info(youtube_video_metadata)")}
        metadata_optional_columns = {
            "title": "TEXT",
            "description": "TEXT",
            "keywords_json": "TEXT",
            "duration_seconds": "INTEGER",
            "view_count": "INTEGER",
            "is_live": "INTEGER",
            "is_unlisted": "INTEGER",
            "publish_date": "TEXT",
            "upload_date": "TEXT",
        }
        for column, column_type in metadata_optional_columns.items():
            if column not in metadata_existing:
                conn.execute(f"ALTER TABLE youtube_video_metadata ADD COLUMN {column} {column_type}")

        classification_existing = {row["name"] for row in conn.execute("PRAGMA table_info(activity_classifications)")}
        classification_optional_columns = {
            "taxonomy_version": "TEXT",
            "request_id": "TEXT",
            "latency_ms": "INTEGER",
            "refreshed_at": "TEXT",
            "ai_result": "INTEGER NOT NULL DEFAULT 0",
            "stale": "INTEGER NOT NULL DEFAULT 0",
            "classification_rule_id": "TEXT REFERENCES classification_rules(id) ON DELETE SET NULL",
        }
        for column, column_type in classification_optional_columns.items():
            if column not in classification_existing:
                conn.execute(f"ALTER TABLE activity_classifications ADD COLUMN {column} {column_type}")

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM tracker_meta WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO tracker_meta(key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def youtube_metadata_should_fetch(self, video_id: str, now: str | None = None) -> bool:
        timestamp = now or datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT status, next_retry_at FROM youtube_video_metadata WHERE video_id = ?",
                (video_id,),
            ).fetchone()
        if not row:
            return True
        if row["status"] == "ok":
            return False
        return not row["next_retry_at"] or row["next_retry_at"] <= timestamp

    def save_youtube_metadata(self, metadata: YouTubeVideoMetadata) -> None:
        fetched_at = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO youtube_video_metadata(
                    video_id,
                    category,
                    channel_id,
                    channel_name,
                    title,
                    description,
                    keywords_json,
                    duration_seconds,
                    view_count,
                    is_live,
                    is_unlisted,
                    publish_date,
                    upload_date,
                    source,
                    status,
                    fetched_at,
                    next_retry_at,
                    error_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, NULL, 0)
                ON CONFLICT(video_id) DO UPDATE SET
                    category = excluded.category,
                    channel_id = excluded.channel_id,
                    channel_name = excluded.channel_name,
                    title = excluded.title,
                    description = excluded.description,
                    keywords_json = excluded.keywords_json,
                    duration_seconds = excluded.duration_seconds,
                    view_count = excluded.view_count,
                    is_live = excluded.is_live,
                    is_unlisted = excluded.is_unlisted,
                    publish_date = excluded.publish_date,
                    upload_date = excluded.upload_date,
                    source = excluded.source,
                    status = 'ok',
                    fetched_at = excluded.fetched_at,
                    next_retry_at = NULL,
                    error_count = 0
                """,
                (
                    metadata.video_id,
                    metadata.category,
                    metadata.channel_id,
                    metadata.channel_name,
                    metadata.title,
                    metadata.description,
                    json.dumps(metadata.keywords) if metadata.keywords is not None else None,
                    metadata.duration_seconds,
                    metadata.view_count,
                    metadata.is_live,
                    metadata.is_unlisted,
                    metadata.publish_date,
                    metadata.upload_date,
                    metadata.source,
                    fetched_at,
                ),
            )

    def save_youtube_metadata_failure(self, video_id: str) -> None:
        now = datetime.now(timezone.utc)
        failed_at = now.isoformat()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT error_count FROM youtube_video_metadata WHERE video_id = ?",
                (video_id,),
            ).fetchone()
            error_count = int(row["error_count"] if row else 0) + 1
            retry_seconds = min(3600, 60 * error_count)
            next_retry_at = datetime.fromtimestamp(now.timestamp() + retry_seconds, timezone.utc).isoformat()
            conn.execute(
                """
                INSERT INTO youtube_video_metadata(
                    video_id,
                    status,
                    fetched_at,
                    next_retry_at,
                    error_count
                ) VALUES (?, 'failed', ?, ?, ?)
                ON CONFLICT(video_id) DO UPDATE SET
                    status = 'failed',
                    fetched_at = excluded.fetched_at,
                    next_retry_at = excluded.next_retry_at,
                    error_count = excluded.error_count
                """,
                (video_id, failed_at, next_retry_at, error_count),
            )

    def record_snapshot(self, snapshot: Snapshot, sample_seconds: int, max_merge_gap_seconds: int | None = None) -> None:
        with self.connect() as conn:
            last = conn.execute(
                """
                SELECT * FROM activity_segments
                ORDER BY ended_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()

            if (
                last
                and last["app_name"] == snapshot.app_name
                and last["window_title"] == snapshot.window_title
                and last["site_domain"] == snapshot.site_domain
                and last["site_title"] == snapshot.site_title
                and last["site_url"] == snapshot.site_url
                and last["youtube_video_id"] == snapshot.youtube_video_id
                and last["youtube_playlist_id"] == snapshot.youtube_playlist_id
                and last["youtube_is_shorts"] == snapshot.youtube_is_shorts
                and self._within_merge_gap(last["ended_at"], snapshot.observed_at, max_merge_gap_seconds)
            ):
                conn.execute(
                    """
                    UPDATE activity_segments
                    SET ended_at = ?,
                        duration_seconds = duration_seconds + ?,
                        bundle_id = ?,
                        browser_name = ?,
                        site_source = ?,
                        source = ?,
                        confidence = ?,
                        raw_context_json = ?
                    WHERE id = ?
                    """,
                    (
                        snapshot.observed_at,
                        sample_seconds,
                        snapshot.bundle_id,
                        snapshot.browser_name,
                        snapshot.site_source,
                        snapshot.source,
                        getattr(snapshot, "capture_confidence", 1.0),
                        json.dumps(asdict(snapshot)),
                        last["id"],
                    ),
                )
                return

            conn.execute(
                """
                INSERT INTO activity_segments (
                    started_at,
                    ended_at,
                    duration_seconds,
                    app_name,
                    bundle_id,
                    window_title,
                    site_domain,
                    site_title,
                    site_url,
                    youtube_video_id,
                    youtube_playlist_id,
                    youtube_is_shorts,
                    browser_name,
                    site_source,
                    platform,
                    source,
                    confidence,
                    raw_context_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot.observed_at,
                    snapshot.observed_at,
                    sample_seconds,
                    snapshot.app_name,
                    snapshot.bundle_id,
                    snapshot.window_title,
                    snapshot.site_domain,
                    snapshot.site_title,
                    snapshot.site_url,
                    snapshot.youtube_video_id,
                    snapshot.youtube_playlist_id,
                    snapshot.youtube_is_shorts,
                    snapshot.browser_name,
                    snapshot.site_source,
                    "macos",
                    snapshot.source,
                    getattr(snapshot, "capture_confidence", 1.0),
                    json.dumps(asdict(snapshot)),
                ),
            )

    def trim_latest_segment(self, ended_at: str) -> None:
        with self.connect() as conn:
            last = conn.execute(
                """
                SELECT * FROM activity_segments
                ORDER BY ended_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            if not last:
                return

            target = self._timestamp_seconds(ended_at)
            current_end = self._timestamp_seconds(last["ended_at"])
            if target >= current_end:
                return

            started = self._timestamp_seconds(last["started_at"])
            duration_seconds = int(round(target - started))
            if duration_seconds <= 0:
                conn.execute("DELETE FROM activity_segments WHERE id = ?", (last["id"],))
                return

            conn.execute(
                """
                UPDATE activity_segments
                SET ended_at = ?, duration_seconds = ?
                WHERE id = ?
                """,
                (ended_at, duration_seconds, last["id"]),
            )

    def insert_segment(self, segment: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO activity_segments (
                    started_at,
                    ended_at,
                    duration_seconds,
                    app_name,
                    bundle_id,
                    window_title,
                    site_domain,
                    site_title,
                    site_url,
                    youtube_video_id,
                    youtube_playlist_id,
                    youtube_is_shorts,
                    browser_name,
                    site_source,
                    platform,
                    source,
                    confidence,
                    raw_context_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    segment["started_at"],
                    segment["ended_at"],
                    segment["duration_seconds"],
                    segment["app_name"],
                    segment.get("bundle_id"),
                    segment.get("window_title"),
                    segment.get("site_domain"),
                    segment.get("site_title"),
                    segment.get("site_url"),
                    segment.get("youtube_video_id"),
                    segment.get("youtube_playlist_id"),
                    segment.get("youtube_is_shorts"),
                    segment.get("browser_name"),
                    segment.get("site_source"),
                    segment.get("platform", "macos"),
                    segment.get("source", "unknown"),
                    segment.get("confidence"),
                    segment.get("raw_context_json"),
                ),
            )

    @staticmethod
    def _normalize_range_bound(value: str) -> str:
        parsed = parse_iso_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.astimezone()
        return parsed.astimezone(timezone.utc).isoformat()

    @staticmethod
    def _append_overlap_filters(
        query: str,
        params: list[Any],
        start: str | None,
        end: str | None,
        table_name: str | None = None,
    ) -> str:
        started_at = f"{table_name}.started_at" if table_name else "started_at"
        ended_at = f"{table_name}.ended_at" if table_name else "ended_at"
        if start:
            query += f" AND datetime({ended_at}) >= datetime(?)"
            params.append(TrackerDatabase._normalize_range_bound(start))
        if end:
            query += f" AND datetime({started_at}) <= datetime(?)"
            params.append(TrackerDatabase._normalize_range_bound(end))
        return query

    def fetch_timeline(self, day: str, limit: int | None = None) -> list[dict[str, Any]]:
        start, end = self._local_day_bounds(day)
        rows = self.timeline(start=start, end=end, limit=limit)
        filtered = [row for row in rows if self._local_day(row["started_at"]) == day]
        return [self._serialize_row(row) for row in filtered]

    def fetch_hourly_summary(self, day: str) -> list[dict[str, Any]]:
        buckets: dict[str, dict[str, Any]] = {}
        for item in self.fetch_timeline(day):
            hour_label = self._local_hour(item["startedAt"])
            bucket = buckets.setdefault(
                hour_label,
                {"hourLabel": hour_label, "durationSeconds": 0, "topApps": []},
            )
            bucket["durationSeconds"] += item["durationSeconds"]
            bucket["topApps"].append(
                {"appName": item["appName"], "durationSeconds": item["durationSeconds"]}
            )
        return list(buckets.values())

    def fetch_top_sites(self, day: str, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    site_domain,
                    SUM(duration_seconds) AS total_seconds,
                    COUNT(*) AS visits,
                    MAX(NULLIF(browser_name, '')) AS browser_name,
                    MAX(NULLIF(site_title, '')) AS site_title
                FROM activity_segments
                WHERE NULLIF(site_domain, '') IS NOT NULL
                  AND date(datetime(started_at, 'localtime')) = ?
                GROUP BY site_domain
                ORDER BY total_seconds DESC, visits DESC, site_domain ASC
                LIMIT ?
                """,
                (day, limit),
            ).fetchall()
        return self._serialize_top_site_rows(rows)

    def fetch_last_event_at(self) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT ended_at FROM activity_segments ORDER BY ended_at DESC, id DESC LIMIT 1"
            ).fetchone()
        return row["ended_at"] if row else None

    def fetch_unclassified_segments(self, start: str | None = None, end: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        query = """
            SELECT
                activity_segments.*,
                youtube_video_metadata.category AS youtube_category,
                youtube_video_metadata.channel_id AS youtube_channel_id,
                youtube_video_metadata.channel_name AS youtube_channel_name,
                youtube_video_metadata.title AS youtube_title,
                youtube_video_metadata.description AS youtube_description,
                youtube_video_metadata.keywords_json AS youtube_keywords_json,
                youtube_video_metadata.duration_seconds AS youtube_duration_seconds,
                youtube_video_metadata.view_count AS youtube_view_count,
                youtube_video_metadata.is_live AS youtube_is_live,
                youtube_video_metadata.is_unlisted AS youtube_is_unlisted,
                youtube_video_metadata.publish_date AS youtube_publish_date,
                youtube_video_metadata.upload_date AS youtube_upload_date
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE activity_classifications.segment_id IS NULL
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        query += " ORDER BY started_at ASC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [self._serialize_row(dict(row)) for row in rows]

    def get_classification_rules(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, target_kind, target_value, category, productivity, enabled, confidence, created_at, updated_at
                FROM classification_rules
                ORDER BY target_kind ASC, target_value ASC
                """
            ).fetchall()
        return [self._serialize_rule(row) for row in rows]

    def save_classification_rule(self, rule_input: dict[str, Any]) -> dict[str, Any]:
        target_kind = str(rule_input.get("targetKind", rule_input.get("target_kind", ""))).strip()
        if target_kind not in VALID_RULE_TARGET_KINDS:
            raise ValueError("targetKind must be 'site' or 'app'")

        raw_target_value = str(rule_input.get("targetValue", rule_input.get("target_value", ""))).strip()
        normalized_target_value = self._normalize_rule_target(target_kind, raw_target_value)
        if not normalized_target_value:
            raise ValueError("targetValue is required")

        target_value = normalized_target_value if target_kind == "site" else raw_target_value
        category = str(rule_input["category"])
        productivity = str(rule_input["productivity"])
        enabled = 1 if rule_input.get("enabled", True) else 0
        confidence = rule_input.get("confidence")
        if confidence is not None:
            confidence = float(confidence)
        timestamp = datetime.now(timezone.utc).isoformat()
        rule_id = str(rule_input.get("id") or uuid.uuid4())

        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO classification_rules (
                    id,
                    target_kind,
                    target_value,
                    normalized_target_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(target_kind, normalized_target_value) DO UPDATE SET
                    target_value = excluded.target_value,
                    category = excluded.category,
                    productivity = excluded.productivity,
                    enabled = excluded.enabled,
                    confidence = excluded.confidence,
                    updated_at = excluded.updated_at
                """,
                (
                    rule_id,
                    target_kind,
                    target_value,
                    normalized_target_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    timestamp,
                    timestamp,
                ),
            )
            row = conn.execute(
                """
                SELECT id, target_kind, target_value, category, productivity, enabled, confidence, created_at, updated_at
                FROM classification_rules
                WHERE target_kind = ? AND normalized_target_value = ?
                """,
                (target_kind, normalized_target_value),
            ).fetchone()
            if row and not enabled:
                conn.execute(
                    "DELETE FROM activity_classifications WHERE source = 'rule' AND classification_rule_id = ?",
                    (row["id"],),
                )
        return self._serialize_rule(row)

    def delete_classification_rule(self, rule_id: str) -> int:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM activity_classifications WHERE source = 'rule' AND classification_rule_id = ?",
                (rule_id,),
            )
            cursor = conn.execute("DELETE FROM classification_rules WHERE id = ?", (rule_id,))
            return cursor.rowcount

    def delete_activity_segments(self, segment_ids: list[str]) -> int:
        normalized_ids = sorted({
            int(segment_id)
            for segment_id in segment_ids
            if segment_id.strip().isdecimal()
        })
        if not normalized_ids:
            return 0

        placeholders = ",".join("?" for _ in normalized_ids)
        with self.connect() as conn:
            cursor = conn.execute(
                f"DELETE FROM activity_segments WHERE id IN ({placeholders})",
                tuple(normalized_ids),
            )
            return cursor.rowcount

    def search_classification_rule_candidates(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        needle = query.strip().lower()
        candidates: list[dict[str, Any]] = []
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    normalized_site,
                    site_title,
                    browser_name,
                    category,
                    productivity,
                    segment_count,
                    total_seconds,
                    first_seen_at,
                    last_seen_at
                FROM (
                    SELECT
                        lower(COALESCE(NULLIF(site_domain, ''), NULLIF(site_url, ''))) AS raw_site,
                        site_title,
                        browser_name,
                        activity_classifications.category AS category,
                        activity_classifications.productivity AS productivity,
                        COUNT(*) AS segment_count,
                        SUM(duration_seconds) AS total_seconds,
                        MIN(started_at) AS first_seen_at,
                        MAX(ended_at) AS last_seen_at,
                        COALESCE(NULLIF(site_domain, ''), NULLIF(site_url, '')) AS normalized_site
                    FROM activity_segments
                    LEFT JOIN activity_classifications ON activity_classifications.segment_id = activity_segments.id
                    WHERE COALESCE(NULLIF(site_domain, ''), NULLIF(site_url, '')) IS NOT NULL
                    GROUP BY lower(COALESCE(NULLIF(site_domain, ''), NULLIF(site_url, '')))
                )
                ORDER BY total_seconds DESC, segment_count DESC, last_seen_at DESC
                """
            ).fetchall()
            for row in rows:
                domain = self._normalize_site_target(row["normalized_site"])
                if not domain or (needle and needle not in domain.lower() and needle not in str(row["site_title"] or "").lower()):
                    continue
                candidates.append(
                    {
                        "id": f"site:{domain}",
                        "targetKind": "site",
                        "targetValue": domain,
                        "displayName": domain,
                        "appName": None,
                        "bundleId": None,
                        "siteDomain": domain,
                        "siteTitle": row["site_title"],
                        "browserName": row["browser_name"],
                        "category": row["category"],
                        "productivity": row["productivity"],
                        "segmentCount": int(row["segment_count"] or 0),
                        "totalSeconds": int(row["total_seconds"] or 0),
                        "firstSeenAt": row["first_seen_at"],
                        "lastSeenAt": row["last_seen_at"],
                    }
                )

            rows = conn.execute(
                """
                SELECT
                    app_name,
                    bundle_id,
                    activity_classifications.category AS category,
                    activity_classifications.productivity AS productivity,
                    COUNT(*) AS segment_count,
                    SUM(duration_seconds) AS total_seconds,
                    MIN(started_at) AS first_seen_at,
                    MAX(ended_at) AS last_seen_at
                FROM activity_segments
                LEFT JOIN activity_classifications ON activity_classifications.segment_id = activity_segments.id
                GROUP BY app_name, bundle_id
                ORDER BY total_seconds DESC, segment_count DESC, last_seen_at DESC
                """
            ).fetchall()
            for row in rows:
                app_name = row["app_name"] or ""
                bundle_id = row["bundle_id"]
                searchable = f"{app_name} {bundle_id or ''}".lower()
                if needle and needle not in searchable:
                    continue
                target_value = bundle_id if bundle_id else app_name
                if not target_value:
                    continue
                candidates.append(
                    {
                        "id": f"app:{target_value}",
                        "targetKind": "app",
                        "targetValue": target_value,
                        "displayName": app_name,
                        "appName": app_name,
                        "bundleId": bundle_id,
                        "siteDomain": None,
                        "siteTitle": None,
                        "browserName": None,
                        "category": row["category"],
                        "productivity": row["productivity"],
                        "segmentCount": int(row["segment_count"] or 0),
                        "totalSeconds": int(row["total_seconds"] or 0),
                        "firstSeenAt": row["first_seen_at"],
                        "lastSeenAt": row["last_seen_at"],
                    }
                )
        return candidates[:limit]

    def apply_classification_rules(self, start: str | None = None, end: str | None = None) -> dict[str, int]:
        with self.connect() as conn:
            rules = conn.execute(
                """
                SELECT id, target_kind, target_value, normalized_target_value, category, productivity, confidence
                FROM classification_rules
                WHERE enabled = 1
                ORDER BY updated_at DESC, created_at DESC
                """
            ).fetchall()
            if not rules:
                return {"matchedCount": 0, "appliedCount": 0, "skippedCount": 0}

            query = "SELECT * FROM activity_segments WHERE 1=1"
            params: list[Any] = []
            query = self._append_overlap_filters(query, params, start, end)
            rows = conn.execute(query, tuple(params)).fetchall()

            matched_count = 0
            applied_count = 0
            skipped_count = 0
            timestamp = datetime.now(timezone.utc).isoformat()
            for segment in rows:
                rule = self._matching_rule(segment, rules)
                if not rule:
                    continue
                matched_count += 1
                segment_id = int(segment["id"])
                cursor = conn.execute(
                    """
                    INSERT INTO activity_classifications (
                        segment_id,
                        input_fingerprint,
                        category,
                        productivity,
                        source,
                        confidence,
                        reason,
                        model,
                        prompt_version,
                        taxonomy_version,
                        request_id,
                        latency_ms,
                        classified_at,
                        refreshed_at,
                        ai_result,
                        stale,
                        classification_rule_id
                    ) VALUES (?, ?, ?, ?, 'rule', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, 0, 0, ?)
                    ON CONFLICT(segment_id) DO UPDATE SET
                        input_fingerprint = excluded.input_fingerprint,
                        category = excluded.category,
                        productivity = excluded.productivity,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        reason = excluded.reason,
                        model = excluded.model,
                        prompt_version = excluded.prompt_version,
                        taxonomy_version = excluded.taxonomy_version,
                        request_id = excluded.request_id,
                        latency_ms = excluded.latency_ms,
                        classified_at = excluded.classified_at,
                        refreshed_at = excluded.refreshed_at,
                        ai_result = excluded.ai_result,
                        stale = excluded.stale,
                        classification_rule_id = excluded.classification_rule_id
                    """,
                    (
                        segment_id,
                        f"rule:{rule['id']}:{segment_id}",
                        rule["category"],
                        rule["productivity"],
                        float(rule["confidence"] if rule["confidence"] is not None else DEFAULT_RULE_CONFIDENCE),
                        self._rule_reason(rule),
                        timestamp,
                        timestamp,
                        rule["id"],
                    ),
                )
                if cursor.rowcount > 0:
                    applied_count += 1
                else:
                    skipped_count += 1
        return {"matchedCount": matched_count, "appliedCount": applied_count, "skippedCount": skipped_count}

    def save_classifications(self, classifications: list[dict[str, Any]]) -> int:
        saved = 0
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            for item in classifications:
                raw_segment_id = item.get("segmentId", item.get("segment_id"))
                if raw_segment_id is None:
                    continue
                try:
                    segment_id = int(raw_segment_id)
                except (TypeError, ValueError):
                    continue

                source = str(item.get("source") or "llm")
                classified_at = item.get("classifiedAt") or item.get("classified_at") or timestamp
                ai_result = 1 if item.get("aiResult", item.get("ai_result", source == "llm")) else 0
                stale = 1 if item.get("stale") else 0
                classification_rule_id = item.get("classificationRuleId", item.get("classification_rule_id")) if source == "rule" else None

                conn.execute(
                    """
                    INSERT INTO activity_classifications (
                        segment_id,
                        input_fingerprint,
                        category,
                        productivity,
                        source,
                        confidence,
                        reason,
                        model,
                        prompt_version,
                        taxonomy_version,
                        request_id,
                        latency_ms,
                        classified_at,
                        refreshed_at,
                        ai_result,
                        stale,
                        classification_rule_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(segment_id) DO UPDATE SET
                        input_fingerprint = excluded.input_fingerprint,
                        category = excluded.category,
                        productivity = excluded.productivity,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        reason = excluded.reason,
                        model = excluded.model,
                        prompt_version = excluded.prompt_version,
                        taxonomy_version = excluded.taxonomy_version,
                        request_id = excluded.request_id,
                        latency_ms = excluded.latency_ms,
                        classified_at = excluded.classified_at,
                        refreshed_at = excluded.refreshed_at,
                        ai_result = excluded.ai_result,
                        stale = excluded.stale,
                        classification_rule_id = excluded.classification_rule_id
                    """,
                    (
                        segment_id,
                        item.get("inputFingerprint", item.get("input_fingerprint", f"segment:{segment_id}")),
                        item["category"],
                        item["productivity"],
                        source,
                        float(item.get("confidence", 0)),
                        item.get("reason"),
                        item.get("model"),
                        item.get("promptVersion", item.get("prompt_version")),
                        item.get("taxonomyVersion", item.get("taxonomy_version")),
                        item.get("requestId", item.get("request_id")),
                        item.get("latencyMs", item.get("latency_ms")),
                        classified_at,
                        timestamp,
                        ai_result,
                        stale,
                        classification_rule_id,
                    ),
                )
                saved += 1
        return saved

    def get_reusable_ai_classifications(self, input_fingerprints: list[str]) -> dict[str, dict[str, Any]]:
        fingerprints = list(dict.fromkeys(fingerprint for fingerprint in input_fingerprints if fingerprint))
        if not fingerprints:
            return {}

        placeholders = ",".join("?" for _ in fingerprints)
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    segment_id,
                    input_fingerprint,
                    category,
                    productivity,
                    source,
                    confidence,
                    reason,
                    model,
                    prompt_version,
                    taxonomy_version,
                    request_id,
                    latency_ms,
                    classified_at,
                    ai_result,
                    stale
                FROM activity_classifications
                WHERE input_fingerprint IN ({placeholders})
                  AND ai_result = 1
                  AND stale = 0
                ORDER BY input_fingerprint ASC, classified_at DESC, segment_id DESC
                """,
                tuple(fingerprints),
            ).fetchall()

        reusable: dict[str, dict[str, Any]] = {}
        for row in rows:
            fingerprint = row["input_fingerprint"]
            if fingerprint in reusable:
                continue
            reusable[fingerprint] = {
                "segmentId": str(row["segment_id"]),
                "inputFingerprint": fingerprint,
                "category": row["category"],
                "productivity": row["productivity"],
                "source": row["source"] or "llm",
                "confidence": row["confidence"],
                "reason": row["reason"],
                "model": row["model"],
                "promptVersion": row["prompt_version"],
                "taxonomyVersion": row["taxonomy_version"],
                "requestId": row["request_id"],
                "latencyMs": row["latency_ms"],
                "classifiedAt": row["classified_at"],
                "aiResult": bool(row["ai_result"]),
                "stale": bool(row["stale"]),
            }
        return reusable

    def refresh_non_ai_classifications(self, start: str | None = None, end: str | None = None) -> int:
        query = "DELETE FROM activity_classifications WHERE ai_result != 1 AND source != 'rule'"
        params: list[Any] = []
        filters: list[str] = []
        if start:
            filters.append("datetime(ended_at) >= datetime(?)")
            params.append(self._normalize_range_bound(start))
        if end:
            filters.append("datetime(started_at) <= datetime(?)")
            params.append(self._normalize_range_bound(end))
        if filters:
            query += f" AND segment_id IN (SELECT id FROM activity_segments WHERE {' AND '.join(filters)})"
        with self.connect() as conn:
            cursor = conn.execute(query, tuple(params))
            deleted = cursor.rowcount
        self.apply_classification_rules(start, end)
        return deleted

    def classification_metrics(self, start: str | None = None, end: str | None = None) -> dict[str, int]:
        query = """
            SELECT
              COUNT(activity_segments.id) AS total_segments,
              SUM(CASE WHEN activity_classifications.segment_id IS NOT NULL THEN 1 ELSE 0 END) AS classified_segments,
              SUM(CASE WHEN activity_classifications.ai_result = 1 THEN 1 ELSE 0 END) AS ai_classified_segments,
              SUM(CASE WHEN activity_classifications.stale = 1 THEN 1 ELSE 0 END) AS stale_classifications
            FROM activity_segments
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end, "activity_segments")
        with self.connect() as conn:
            row = conn.execute(query, tuple(params)).fetchone()
        total = int(row["total_segments"] or 0)
        classified = int(row["classified_segments"] or 0)
        ai_classified = int(row["ai_classified_segments"] or 0)
        stale = int(row["stale_classifications"] or 0)
        return {
            "totalSegments": total,
            "classifiedSegments": classified,
            "unclassifiedSegments": max(total - classified, 0),
            "aiClassifiedSegments": ai_classified,
            "staleClassifications": stale,
        }

    def timeline(self, start: str | None = None, end: str | None = None, limit: int | None = None):
        query = """
            SELECT
                activity_segments.*,
                youtube_video_metadata.category AS youtube_category,
                youtube_video_metadata.channel_id AS youtube_channel_id,
                youtube_video_metadata.channel_name AS youtube_channel_name,
                youtube_video_metadata.title AS youtube_title,
                youtube_video_metadata.description AS youtube_description,
                youtube_video_metadata.keywords_json AS youtube_keywords_json,
                youtube_video_metadata.duration_seconds AS youtube_duration_seconds,
                youtube_video_metadata.view_count AS youtube_view_count,
                youtube_video_metadata.is_live AS youtube_is_live,
                youtube_video_metadata.is_unlisted AS youtube_is_unlisted,
                youtube_video_metadata.publish_date AS youtube_publish_date,
                youtube_video_metadata.upload_date AS youtube_upload_date,
                activity_classifications.category AS classification_category,
                activity_classifications.productivity AS classification_productivity,
                activity_classifications.source AS classification_source,
                activity_classifications.confidence AS classification_confidence,
                activity_classifications.reason AS classification_reason,
                activity_classifications.model AS classification_model,
                activity_classifications.prompt_version AS classification_prompt_version,
                activity_classifications.taxonomy_version AS classification_taxonomy_version,
                activity_classifications.input_fingerprint AS classification_input_fingerprint,
                activity_classifications.classified_at AS classification_classified_at,
                activity_classifications.ai_result AS classification_ai_result,
                activity_classifications.stale AS classification_stale,
                activity_classifications.request_id AS classification_request_id,
                activity_classifications.latency_ms AS classification_latency_ms,
                activity_classifications.classification_rule_id AS classification_rule_id
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        query += " ORDER BY started_at ASC"
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def raw_events(
        self,
        start: str | None = None,
        end: str | None = None,
        app_name: str | None = None,
        limit: int = 50,
    ):
        query = """
            SELECT
                activity_segments.*,
                youtube_video_metadata.category AS youtube_category,
                youtube_video_metadata.channel_id AS youtube_channel_id,
                youtube_video_metadata.channel_name AS youtube_channel_name,
                youtube_video_metadata.title AS youtube_title,
                youtube_video_metadata.description AS youtube_description,
                youtube_video_metadata.keywords_json AS youtube_keywords_json,
                youtube_video_metadata.duration_seconds AS youtube_duration_seconds,
                youtube_video_metadata.view_count AS youtube_view_count,
                youtube_video_metadata.is_live AS youtube_is_live,
                youtube_video_metadata.is_unlisted AS youtube_is_unlisted,
                youtube_video_metadata.publish_date AS youtube_publish_date,
                youtube_video_metadata.upload_date AS youtube_upload_date,
                activity_classifications.category AS classification_category,
                activity_classifications.productivity AS classification_productivity,
                activity_classifications.source AS classification_source,
                activity_classifications.confidence AS classification_confidence,
                activity_classifications.reason AS classification_reason,
                activity_classifications.model AS classification_model,
                activity_classifications.prompt_version AS classification_prompt_version,
                activity_classifications.taxonomy_version AS classification_taxonomy_version,
                activity_classifications.input_fingerprint AS classification_input_fingerprint,
                activity_classifications.classified_at AS classification_classified_at,
                activity_classifications.ai_result AS classification_ai_result,
                activity_classifications.stale AS classification_stale,
                activity_classifications.request_id AS classification_request_id,
                activity_classifications.latency_ms AS classification_latency_ms,
                activity_classifications.classification_rule_id AS classification_rule_id
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        if app_name:
            query += " AND app_name = ?"
            params.append(app_name)
        query += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def hourly_summary(self, start: str | None = None, end: str | None = None):
        query = """
            SELECT
                strftime('%H:00', datetime(started_at, 'localtime')) AS hour_label,
                app_name,
                SUM(duration_seconds) AS total_seconds
            FROM activity_segments
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        query += """
            GROUP BY hour_label, app_name
            ORDER BY hour_label ASC, total_seconds DESC, app_name ASC
        """

        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()

        buckets: dict[str, dict[str, Any]] = {}
        for row in rows:
            hour_label = row["hour_label"]
            bucket = buckets.setdefault(
                hour_label,
                {"hour": f"localT{hour_label}", "totalSeconds": 0, "appBreakdown": []},
            )
            total_seconds = int(row["total_seconds"] or 0)
            bucket["totalSeconds"] += total_seconds
            bucket["appBreakdown"].append(
                {"appName": row["app_name"], "totalSeconds": total_seconds}
            )
        return list(buckets.values())

    def top_sites(self, start: str | None = None, end: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        query = """
            SELECT
                site_domain,
                SUM(duration_seconds) AS total_seconds,
                COUNT(*) AS visits,
                MAX(NULLIF(browser_name, '')) AS browser_name,
                MAX(NULLIF(site_title, '')) AS site_title
            FROM activity_segments
            WHERE NULLIF(site_domain, '') IS NOT NULL
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        query += """
            GROUP BY site_domain
            ORDER BY total_seconds DESC, visits DESC, site_domain ASC
            LIMIT ?
        """
        params.append(limit)

        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()

        return self._serialize_top_site_rows(rows)

    @staticmethod
    def _serialize_top_site_rows(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
        return [
            {
                "siteDomain": row["site_domain"],
                "totalSeconds": int(row["total_seconds"] or 0),
                "browserName": row["browser_name"],
                "siteTitle": row["site_title"],
                "visits": int(row["visits"] or 0),
            }
            for row in rows
        ]

    @staticmethod
    def _serialize_rule(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "targetKind": row["target_kind"],
            "targetValue": row["target_value"],
            "category": row["category"],
            "productivity": row["productivity"],
            "enabled": bool(row["enabled"]),
            "confidence": row["confidence"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _normalize_rule_target(target_kind: str, value: str | None) -> str:
        if target_kind == "site":
            return TrackerDatabase._normalize_site_target(value)
        return TrackerDatabase._normalize_app_target(value)

    @staticmethod
    def _normalize_site_target(value: str | None) -> str:
        if not value:
            return ""
        text = value.strip().lower()
        if not text:
            return ""
        parsed = urlparse(text if "://" in text else f"//{text}")
        host = parsed.hostname or text.split("/", 1)[0].split(":", 1)[0]
        while host.startswith("www."):
            host = host[4:]
        return host.strip(".")

    @staticmethod
    def _normalize_app_target(value: str | None) -> str:
        return " ".join((value or "").strip().lower().split())

    @staticmethod
    def _looks_like_bundle_id(value: str | None) -> bool:
        text = (value or "").strip()
        return "." in text and " " not in text

    def _matching_rule(self, segment: sqlite3.Row, rules: list[sqlite3.Row]) -> sqlite3.Row | None:
        for rule in rules:
            if rule["target_kind"] == "site":
                host = self._normalize_site_target(segment["site_domain"] or segment["site_url"])
                target = rule["normalized_target_value"]
                if host and (host == target or host.endswith(f".{target}")):
                    return rule
                continue

            bundle_id = segment["bundle_id"]
            target = rule["target_value"]
            if (self._looks_like_bundle_id(target) or bundle_id) and bundle_id == target:
                return rule
            if self._normalize_app_target(segment["app_name"]) == rule["normalized_target_value"]:
                return rule
        return None

    @staticmethod
    def _rule_reason(rule: sqlite3.Row) -> str:
        return f"Matched local {rule['target_kind']} rule: {rule['target_value']}"

    @staticmethod
    def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
        return serialize_activity_row(row)

    @staticmethod
    def _local_day(value: str) -> str:
        return parse_iso_datetime(value).astimezone().date().isoformat()

    @staticmethod
    def _local_day_bounds(day: str) -> tuple[str, str]:
        start = datetime.fromisoformat(f"{day}T00:00:00")
        end = start + timedelta(days=1, seconds=-1)
        return start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")

    @staticmethod
    def _local_hour(value: str) -> str:
        return parse_iso_datetime(value).astimezone().strftime("%H:00")

    @staticmethod
    def _within_merge_gap(previous_end: str, next_observed_at: str, max_merge_gap_seconds: int | None) -> bool:
        if max_merge_gap_seconds is None:
            return True
        previous = TrackerDatabase._timestamp_seconds(previous_end)
        current = TrackerDatabase._timestamp_seconds(next_observed_at)
        return current - previous <= max_merge_gap_seconds

    @staticmethod
    def _timestamp_seconds(value: str) -> float:
        parsed = parse_iso_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()

    @staticmethod
    def _json_list(value: str | None) -> list[str] | None:
        return json_list(value)
