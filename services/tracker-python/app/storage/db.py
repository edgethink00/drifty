from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.tracker.macos_workspace import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


class TrackerDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
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
                  stale INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_activity_classifications_reusable_ai
                ON activity_classifications(input_fingerprint, ai_result, stale, classified_at DESC, segment_id DESC);
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
                    SET ended_at = ?, duration_seconds = duration_seconds + ?
                    WHERE id = ?
                    """,
                    (snapshot.observed_at, sample_seconds, last["id"]),
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
                    1.0,
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

    def fetch_timeline(self, day: str, limit: int | None = None) -> list[dict[str, Any]]:
        rows = self.timeline(limit=limit)
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
        site_map: dict[str, dict[str, Any]] = {}
        for item in self.fetch_timeline(day):
            domain = item.get("siteDomain")
            if not domain:
                continue
            entry = site_map.setdefault(
                domain,
                {
                    "siteDomain": domain,
                    "totalSeconds": 0,
                    "browserName": item.get("browserName"),
                    "siteTitle": item.get("siteTitle"),
                    "visits": 0,
                },
            )
            entry["totalSeconds"] += item["durationSeconds"]
            entry["visits"] += 1
        return sorted(site_map.values(), key=lambda item: item["totalSeconds"], reverse=True)[:limit]

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
        if start:
            query += " AND ended_at >= ?"
            params.append(start)
        if end:
            query += " AND started_at <= ?"
            params.append(end)
        query += " ORDER BY started_at ASC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [self._serialize_row(dict(row)) for row in rows]

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
                        stale
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        stale = excluded.stale
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
        query = "DELETE FROM activity_classifications WHERE ai_result != 1"
        params: list[Any] = []
        filters: list[str] = []
        if start:
            filters.append("ended_at >= ?")
            params.append(start)
        if end:
            filters.append("started_at <= ?")
            params.append(end)
        if filters:
            query += f" AND segment_id IN (SELECT id FROM activity_segments WHERE {' AND '.join(filters)})"
        with self.connect() as conn:
            cursor = conn.execute(query, tuple(params))
            return cursor.rowcount

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
        if start:
            query += " AND activity_segments.ended_at >= ?"
            params.append(start)
        if end:
            query += " AND activity_segments.started_at <= ?"
            params.append(end)
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
                activity_classifications.stale AS classification_stale
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        if start:
            query += " AND ended_at >= ?"
            params.append(start)
        if end:
            query += " AND started_at <= ?"
            params.append(end)
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
                activity_classifications.stale AS classification_stale
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        if start:
            query += " AND ended_at >= ?"
            params.append(start)
        if end:
            query += " AND started_at <= ?"
            params.append(end)
        if app_name:
            query += " AND app_name = ?"
            params.append(app_name)
        query += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def hourly_summary(self, start: str | None = None, end: str | None = None):
        buckets: dict[str, dict[str, Any]] = {}
        for row in self.timeline(start=start, end=end):
            hour_label = self._local_hour(row["started_at"])
            bucket = buckets.setdefault(
                hour_label,
                {"hour": f"localT{hour_label}", "totalSeconds": 0, "appBreakdown": []},
            )
            bucket["totalSeconds"] += row["duration_seconds"]
            bucket["appBreakdown"].append(
                {"appName": row["app_name"], "totalSeconds": row["duration_seconds"]}
            )
        return list(buckets.values())

    @staticmethod
    def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
        classification = None
        if row.get("classification_category"):
            classification = {
                "category": row.get("classification_category"),
                "productivity": row.get("classification_productivity"),
                "source": row.get("classification_source") or "unknown",
                "confidence": row.get("classification_confidence") or 0,
                "reason": row.get("classification_reason"),
                "model": row.get("classification_model"),
                "promptVersion": row.get("classification_prompt_version"),
                "taxonomyVersion": row.get("classification_taxonomy_version"),
                "inputFingerprint": row.get("classification_input_fingerprint"),
                "classifiedAt": row.get("classification_classified_at"),
                "aiResult": bool(row.get("classification_ai_result")),
                "stale": bool(row.get("classification_stale")),
            }

        serialized = {
            "id": str(row.get("id", "")),
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "durationSeconds": row["duration_seconds"],
            "appName": row["app_name"],
            "bundleId": row.get("bundle_id"),
            "windowTitle": row.get("window_title"),
            "siteDomain": row.get("site_domain"),
            "siteTitle": row.get("site_title"),
            "siteUrl": row.get("site_url"),
            "youtubeVideoId": row.get("youtube_video_id"),
            "youtubePlaylistId": row.get("youtube_playlist_id"),
            "youtubeIsShorts": bool(row.get("youtube_is_shorts")) if row.get("youtube_is_shorts") is not None else None,
            "youtubeCategory": row.get("youtube_category"),
            "youtubeChannelId": row.get("youtube_channel_id"),
            "youtubeChannelName": row.get("youtube_channel_name"),
            "youtubeTitle": row.get("youtube_title"),
            "youtubeDescription": row.get("youtube_description"),
            "youtubeKeywords": TrackerDatabase._json_list(row.get("youtube_keywords_json")),
            "youtubeDurationSeconds": row.get("youtube_duration_seconds"),
            "youtubeViewCount": row.get("youtube_view_count"),
            "youtubeIsLive": bool(row.get("youtube_is_live")) if row.get("youtube_is_live") is not None else None,
            "youtubeIsUnlisted": bool(row.get("youtube_is_unlisted")) if row.get("youtube_is_unlisted") is not None else None,
            "youtubePublishDate": row.get("youtube_publish_date"),
            "youtubeUploadDate": row.get("youtube_upload_date"),
            "browserName": row.get("browser_name"),
            "siteSource": row.get("site_source"),
            "platform": row.get("platform", "macos"),
            "source": row.get("source", "unknown"),
            "confidence": row.get("confidence"),
        }
        if classification:
            serialized["classification"] = classification
        return serialized

    @staticmethod
    def _local_day(value: str) -> str:
        return datetime.fromisoformat(value).astimezone().date().isoformat()

    @staticmethod
    def _local_hour(value: str) -> str:
        return datetime.fromisoformat(value).astimezone().strftime("%H:00")

    @staticmethod
    def _within_merge_gap(previous_end: str, next_observed_at: str, max_merge_gap_seconds: int | None) -> bool:
        if max_merge_gap_seconds is None:
            return True
        previous = TrackerDatabase._timestamp_seconds(previous_end)
        current = TrackerDatabase._timestamp_seconds(next_observed_at)
        return current - previous <= max_merge_gap_seconds

    @staticmethod
    def _timestamp_seconds(value: str) -> float:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()

    @staticmethod
    def _json_list(value: str | None) -> list[str] | None:
        if not value:
            return None
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, list):
            return None
        items = [item for item in parsed if isinstance(item, str)]
        return items or None
