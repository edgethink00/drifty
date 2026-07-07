from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import TracebackType
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

from app.storage.classification_rule_url import canonicalize_classification_rule_site_url
from app.storage.activity_segment_serialization import (
    json_list,
    serialize_activity_row,
    serialize_dashboard_week_activity_row,
)
from app.storage.timestamps import parse_iso_datetime

if TYPE_CHECKING:
    from app.tracker.browser_automation import BrowserMetadata
    from app.tracker.macos_workspace import Snapshot
    from app.tracker.youtube_metadata import YouTubeVideoMetadata


BROWSER_HISTORY_IMPORT_SOURCE = "browser-history-import"
VALID_RULE_TARGET_KINDS = {"app", "site"}
VALID_RULE_MATCH_SCOPES = {"surface", "detail"}
VALID_RULE_DETAIL_KINDS = {"title", "windowTitle", "siteTitle", "youtubeTitle", "siteUrl"}

VALID_PROJECT_STATUSES = {"active", "archived"}
VALID_PROJECT_ANCHOR_KINDS = {"app", "domain", "keyword"}
VALID_PROJECT_EXEMPLAR_SOURCES = {"user_confirmed", "user_corrected"}
DEFAULT_PROJECT_COLOR = "#6366f1"
PROJECT_EXEMPLAR_CAP = 20
DEFAULT_RULE_CONFIDENCE = 1.0
DEFAULT_TIMELINE_PAGE_LIMIT = 200
MAX_TIMELINE_PAGE_LIMIT = 500
TIMELINE_SEARCH_FIELDS = (
    "activity_segments.app_name",
    "activity_segments.browser_name",
    "activity_segments.site_domain",
    "activity_segments.site_title",
    "activity_segments.site_url",
    "activity_segments.window_title",
    "activity_classifications.category",
    "activity_classifications.productivity",
)

BrowserHistoryResolver = Callable[[Optional[str], Optional[str], Optional[str]], Any]
BrowserHistoryTitlePolicy = Callable[[Optional[str]], bool]


class ClosingConnection(sqlite3.Connection):
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


@dataclass(frozen=True)
class BrowserHistoryBackfillConfig:
    observed_at: str
    max_age_seconds: int


@dataclass(frozen=True)
class BrowserHistoryBackfillResult:
    segment_id: int
    site_url: str | None
    youtube_video_id: str | None


@dataclass(frozen=True)
class ImportedActivitySegment:
    import_key: str
    started_at: str
    ended_at: str
    duration_seconds: int
    app_name: str
    bundle_id: str | None
    window_title: str | None
    site_domain: str | None
    site_title: str | None
    site_url: str | None
    youtube_video_id: str | None
    youtube_playlist_id: str | None
    youtube_is_shorts: int | None
    browser_name: str | None
    site_source: str
    platform: str
    source: str
    confidence: float
    raw_context_json: str


@dataclass(frozen=True)
class ImportedActivityInsertResult:
    inserted_count: int
    skipped_duplicate_count: int


class TrackerDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, factory=ClosingConnection)
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

                CREATE TABLE IF NOT EXISTS browser_history_import_keys (
                  import_key TEXT PRIMARY KEY,
                  segment_id INTEGER REFERENCES activity_segments(id) ON DELETE SET NULL,
                  imported_at TEXT NOT NULL
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
                  match_scope TEXT NOT NULL DEFAULT 'surface',
                  detail_kind TEXT NOT NULL DEFAULT '',
                  detail_value TEXT,
                  normalized_detail_value TEXT NOT NULL DEFAULT '',
                  category TEXT NOT NULL,
                  productivity TEXT NOT NULL,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  confidence REAL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_activity_classifications_reusable_ai
                ON activity_classifications(input_fingerprint, ai_result, stale, classified_at DESC, segment_id DESC);

                CREATE TABLE IF NOT EXISTS projects (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT NOT NULL,
                  color TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_anchors (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL,
                  value TEXT NOT NULL,
                  source TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(project_id, kind, value)
                );

                CREATE INDEX IF NOT EXISTS idx_project_anchors_project
                ON project_anchors(project_id);

                CREATE TABLE IF NOT EXISTS project_exemplars (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                  run_summary TEXT NOT NULL,
                  source TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_project_exemplars_project
                ON project_exemplars(project_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS activity_project_assignments (
                  segment_id INTEGER PRIMARY KEY REFERENCES activity_segments(id) ON DELETE CASCADE,
                  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                  source TEXT NOT NULL,
                  confidence REAL,
                  reason TEXT,
                  pass_id INTEGER,
                  chunk_fingerprint TEXT,
                  assigned_at TEXT NOT NULL,
                  stale INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_activity_project_assignments_project
                ON activity_project_assignments(project_id);

                CREATE TABLE IF NOT EXISTS project_pass_runs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ran_at TEXT NOT NULL,
                  range_start TEXT NOT NULL,
                  range_end TEXT NOT NULL,
                  trigger TEXT NOT NULL,
                  model TEXT,
                  provider TEXT,
                  runs_count INTEGER,
                  tokens_in INTEGER,
                  tokens_out INTEGER,
                  latency_ms INTEGER,
                  assignments_count INTEGER,
                  corrections_count INTEGER,
                  prompt_version TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_project_pass_runs_ran_at
                ON project_pass_runs(ran_at DESC);

                CREATE TABLE IF NOT EXISTS ai_review_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  segment_id INTEGER NOT NULL,
                  pass_id INTEGER NOT NULL REFERENCES project_pass_runs(id),
                  prev_category TEXT,
                  prev_productivity TEXT,
                  prev_source TEXT,
                  new_category TEXT,
                  new_productivity TEXT,
                  confidence REAL,
                  reason TEXT,
                  created_at TEXT NOT NULL,
                  reverted_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_ai_review_events_segment
                ON ai_review_events(segment_id, created_at DESC);
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

        rule_existing = {row["name"] for row in conn.execute("PRAGMA table_info(classification_rules)")}
        rule_optional_columns = {
            "match_scope": "TEXT NOT NULL DEFAULT 'surface'",
            "detail_kind": "TEXT NOT NULL DEFAULT ''",
            "detail_value": "TEXT",
            "normalized_detail_value": "TEXT NOT NULL DEFAULT ''",
        }
        for column, column_type in rule_optional_columns.items():
            if column not in rule_existing:
                conn.execute(f"ALTER TABLE classification_rules ADD COLUMN {column} {column_type}")
        conn.execute("UPDATE classification_rules SET match_scope = 'surface' WHERE match_scope IS NULL OR match_scope = ''")
        conn.execute("UPDATE classification_rules SET detail_kind = '' WHERE match_scope = 'surface'")
        conn.execute("UPDATE classification_rules SET normalized_detail_value = '' WHERE match_scope = 'surface'")
        conn.execute("DROP INDEX IF EXISTS idx_classification_rules_target")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_classification_rules_target_scope
            ON classification_rules(
                target_kind,
                normalized_target_value,
                match_scope,
                detail_kind,
                normalized_detail_value
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_classification_rules_enabled
            ON classification_rules(enabled, match_scope, target_kind, normalized_target_value)
            """
        )

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
                ORDER BY datetime(ended_at) DESC, id DESC
                LIMIT 1
                """
            ).fetchone()

            last_site_fields_empty = bool(
                last
                and last["app_name"] == snapshot.app_name
                and last["window_title"] == snapshot.window_title
                and last["site_domain"] is None
                and last["site_title"] is None
                and last["site_url"] is None
                and last["youtube_video_id"] is None
                and last["youtube_playlist_id"] is None
                and last["youtube_is_shorts"] is None
            )
            history_enrichment = (
                last_site_fields_empty
                and snapshot.site_source == "browser-history-title"
                and snapshot.site_url is not None
            )
            exact_context_match = (
                last
                and last["app_name"] == snapshot.app_name
                and last["window_title"] == snapshot.window_title
                and last["site_domain"] == snapshot.site_domain
                and last["site_title"] == snapshot.site_title
                and last["site_url"] == snapshot.site_url
                and last["youtube_video_id"] == snapshot.youtube_video_id
                and last["youtube_playlist_id"] == snapshot.youtube_playlist_id
                and last["youtube_is_shorts"] == snapshot.youtube_is_shorts
            )

            if (
                last
                and (exact_context_match or history_enrichment)
                and self._within_merge_gap(last["ended_at"], snapshot.observed_at, max_merge_gap_seconds)
            ):
                conn.execute(
                    """
                    UPDATE activity_segments
                    SET ended_at = ?,
                        duration_seconds = duration_seconds + ?,
                        bundle_id = ?,
                        browser_name = ?,
                        site_domain = ?,
                        site_title = ?,
                        site_url = ?,
                        youtube_video_id = ?,
                        youtube_playlist_id = ?,
                        youtube_is_shorts = ?,
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
                        snapshot.site_domain,
                        snapshot.site_title,
                        snapshot.site_url,
                        snapshot.youtube_video_id,
                        snapshot.youtube_playlist_id,
                        snapshot.youtube_is_shorts,
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

    def backfill_recent_browser_history_context(
        self,
        resolve_browser_history: BrowserHistoryResolver,
        is_retryable_window_title: BrowserHistoryTitlePolicy,
        config: BrowserHistoryBackfillConfig,
    ) -> list[BrowserHistoryBackfillResult]:
        observed_at_seconds = self._timestamp_seconds(config.observed_at)
        results: list[BrowserHistoryBackfillResult] = []
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM activity_segments
                WHERE site_domain IS NULL
                  AND site_title IS NULL
                  AND site_url IS NULL
                  AND youtube_video_id IS NULL
                  AND youtube_playlist_id IS NULL
                  AND youtube_is_shorts IS NULL
                  AND window_title IS NOT NULL
                ORDER BY datetime(ended_at) DESC, id DESC
                LIMIT 100
                """
            ).fetchall()

            for row in rows:
                segment_age_seconds = observed_at_seconds - self._timestamp_seconds(row["ended_at"])
                if segment_age_seconds < 0 or segment_age_seconds > config.max_age_seconds:
                    continue
                if not is_retryable_window_title(row["window_title"]):
                    continue

                raw_context = self._raw_context_dict(row["raw_context_json"])
                if raw_context.get("browser_history_status") != "no_match":
                    continue

                metadata = resolve_browser_history(row["app_name"], row["window_title"], row["ended_at"])
                if metadata.match_state != "browser-history-title" or metadata.site_url is None:
                    continue

                segment_id = int(row["id"])
                confidence = 0.45
                conn.execute(
                    """
                    UPDATE activity_segments
                    SET browser_name = ?,
                        site_domain = ?,
                        site_title = ?,
                        site_url = ?,
                        youtube_video_id = ?,
                        youtube_playlist_id = ?,
                        youtube_is_shorts = ?,
                        site_source = ?,
                        confidence = ?,
                        raw_context_json = ?
                    WHERE id = ?
                    """,
                    (
                        metadata.browser_name,
                        metadata.site_domain,
                        metadata.site_title,
                        metadata.site_url,
                        metadata.youtube_video_id,
                        metadata.youtube_playlist_id,
                        self._optional_bool_int(metadata.youtube_is_shorts),
                        metadata.match_state,
                        confidence,
                        self._backfilled_raw_context_json(raw_context, metadata, confidence, config.observed_at),
                        segment_id,
                    ),
                )
                conn.execute(
                    "UPDATE activity_classifications SET stale = 1 WHERE segment_id = ?",
                    (segment_id,),
                )
                results.append(
                    BrowserHistoryBackfillResult(
                        segment_id=segment_id,
                        site_url=metadata.site_url,
                        youtube_video_id=metadata.youtube_video_id,
                    )
                )
        return results

    def trim_latest_segment(self, ended_at: str) -> None:
        with self.connect() as conn:
            # Imported history segments describe the past, not the live session;
            # idle/power trims must never truncate or delete them.
            last = conn.execute(
                """
                SELECT * FROM activity_segments
                WHERE source != ?
                ORDER BY datetime(ended_at) DESC, id DESC
                LIMIT 1
                """,
                (BROWSER_HISTORY_IMPORT_SOURCE,),
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

    def insert_imported_activity_segments(
        self,
        segments: list[ImportedActivitySegment],
        imported_at: str,
    ) -> ImportedActivityInsertResult:
        inserted_count = 0
        skipped_duplicate_count = 0
        with self.connect() as conn:
            for segment in segments:
                # A re-run can regroup visits into a session with a new import key
                # (e.g. the session gained a visit), and imports can cover time the
                # live tracker already recorded. Skip any segment whose
                # [started_at, ended_at) range overlaps an existing segment so
                # imported time is never double-counted.
                overlapping = conn.execute(
                    """
                    SELECT 1 FROM activity_segments
                    WHERE datetime(started_at) < datetime(?)
                      AND datetime(ended_at) > datetime(?)
                    LIMIT 1
                    """,
                    (
                        self._normalize_range_bound(segment.ended_at),
                        self._normalize_range_bound(segment.started_at),
                    ),
                ).fetchone()
                if overlapping is not None:
                    skipped_duplicate_count += 1
                    continue

                key_cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO browser_history_import_keys (
                        import_key,
                        segment_id,
                        imported_at
                    ) VALUES (?, NULL, ?)
                    """,
                    (segment.import_key, imported_at),
                )
                if key_cursor.rowcount == 0:
                    skipped_duplicate_count += 1
                    continue

                segment_cursor = conn.execute(
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
                        segment.started_at,
                        segment.ended_at,
                        segment.duration_seconds,
                        segment.app_name,
                        segment.bundle_id,
                        segment.window_title,
                        segment.site_domain,
                        segment.site_title,
                        segment.site_url,
                        segment.youtube_video_id,
                        segment.youtube_playlist_id,
                        segment.youtube_is_shorts,
                        segment.browser_name,
                        segment.site_source,
                        segment.platform,
                        segment.source,
                        segment.confidence,
                        segment.raw_context_json,
                    ),
                )
                conn.execute(
                    """
                    UPDATE browser_history_import_keys
                    SET segment_id = ?
                    WHERE import_key = ?
                    """,
                    (segment_cursor.lastrowid, segment.import_key),
                )
                inserted_count += 1
        return ImportedActivityInsertResult(
            inserted_count=inserted_count,
            skipped_duplicate_count=skipped_duplicate_count,
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
                "SELECT ended_at FROM activity_segments ORDER BY datetime(ended_at) DESC, id DESC LIMIT 1"
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
                SELECT
                    id,
                    target_kind,
                    target_value,
                    match_scope,
                    detail_kind,
                    detail_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    created_at,
                    updated_at
                FROM classification_rules
                ORDER BY target_kind ASC, target_value ASC, match_scope ASC, detail_value ASC
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

        match_scope = str(rule_input.get("matchScope", rule_input.get("match_scope", "surface"))).strip() or "surface"
        if match_scope not in VALID_RULE_MATCH_SCOPES:
            raise ValueError("matchScope must be 'surface' or 'detail'")

        detail_kind = ""
        detail_value = None
        normalized_detail_value = ""
        if match_scope == "detail":
            detail_kind = str(rule_input.get("detailKind", rule_input.get("detail_kind", ""))).strip()
            raw_detail_value = str(rule_input.get("detailValue", rule_input.get("detail_value", ""))).strip()
            normalized_detail_value = self._normalize_rule_detail_by_kind(detail_kind, raw_detail_value)
            if detail_kind not in VALID_RULE_DETAIL_KINDS or not normalized_detail_value:
                raise ValueError("detailKind and detailValue are required for detail rules")
            detail_value = normalized_detail_value if detail_kind == "siteUrl" else raw_detail_value

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
                    match_scope,
                    detail_kind,
                    detail_value,
                    normalized_detail_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(
                    target_kind,
                    normalized_target_value,
                    match_scope,
                    detail_kind,
                    normalized_detail_value
                ) DO UPDATE SET
                    target_value = excluded.target_value,
                    detail_value = excluded.detail_value,
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
                    match_scope,
                    detail_kind,
                    detail_value,
                    normalized_detail_value,
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
                SELECT
                    id,
                    target_kind,
                    target_value,
                    match_scope,
                    detail_kind,
                    detail_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    created_at,
                    updated_at
                FROM classification_rules
                WHERE target_kind = ?
                  AND normalized_target_value = ?
                  AND match_scope = ?
                  AND detail_kind = ?
                  AND normalized_detail_value = ?
                """,
                (target_kind, normalized_target_value, match_scope, detail_kind, normalized_detail_value),
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

    @staticmethod
    def _expand_history_range_bound(value: str | None, *, end_of_day: bool) -> str | None:
        if not value:
            return None
        text = value.strip()
        if len(text) == 10 and "T" not in text and " " not in text:
            return f"{text}T23:59:59" if end_of_day else f"{text}T00:00:00"
        return text

    def delete_history_range(
        self,
        start: str | None = None,
        end: str | None = None,
        scopes: dict[str, Any] | None = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        scopes = scopes or {}
        delete_activity = bool(scopes.get("activity"))
        delete_ai_classifications = bool(scopes.get("aiClassifications"))
        delete_youtube_metadata = bool(scopes.get("youtubeMetadata"))

        start_bound = self._expand_history_range_bound(start, end_of_day=False)
        end_bound = self._expand_history_range_bound(end, end_of_day=True)
        has_range = bool(start_bound or end_bound)

        segment_params: list[Any] = []
        segment_subquery = self._append_overlap_filters(
            "SELECT id FROM activity_segments WHERE 1=1",
            segment_params,
            start_bound,
            end_bound,
        )
        segment_video_params: list[Any] = []
        segment_video_subquery = self._append_overlap_filters(
            "SELECT youtube_video_id FROM activity_segments WHERE youtube_video_id IS NOT NULL",
            segment_video_params,
            start_bound,
            end_bound,
        )

        activity_segments = 0
        classifications = 0
        youtube_metadata = 0

        with self.connect() as conn:
            if delete_activity:
                activity_segments = int(
                    conn.execute(
                        f"SELECT COUNT(*) AS count FROM activity_segments WHERE id IN ({segment_subquery})",
                        tuple(segment_params),
                    ).fetchone()["count"]
                )
                classifications = int(
                    conn.execute(
                        f"SELECT COUNT(*) AS count FROM activity_classifications WHERE segment_id IN ({segment_subquery})",
                        tuple(segment_params),
                    ).fetchone()["count"]
                )
            elif delete_ai_classifications:
                classifications = int(
                    conn.execute(
                        "SELECT COUNT(*) AS count FROM activity_classifications "
                        f"WHERE ai_result = 1 AND segment_id IN ({segment_subquery})",
                        tuple(segment_params),
                    ).fetchone()["count"]
                )

            if delete_youtube_metadata:
                if has_range:
                    youtube_metadata = int(
                        conn.execute(
                            f"SELECT COUNT(*) AS count FROM youtube_video_metadata WHERE video_id IN ({segment_video_subquery})",
                            tuple(segment_video_params),
                        ).fetchone()["count"]
                    )
                else:
                    youtube_metadata = int(
                        conn.execute("SELECT COUNT(*) AS count FROM youtube_video_metadata").fetchone()["count"]
                    )

            if not dry_run:
                if delete_ai_classifications:
                    conn.execute(
                        f"DELETE FROM activity_classifications WHERE ai_result = 1 AND segment_id IN ({segment_subquery})",
                        tuple(segment_params),
                    )
                if delete_youtube_metadata:
                    if has_range:
                        conn.execute(
                            f"DELETE FROM youtube_video_metadata WHERE video_id IN ({segment_video_subquery})",
                            tuple(segment_video_params),
                        )
                    else:
                        conn.execute("DELETE FROM youtube_video_metadata")
                if delete_activity:
                    conn.execute(
                        f"DELETE FROM activity_segments WHERE id IN ({segment_subquery})",
                        tuple(segment_params),
                    )

        if not dry_run and activity_segments >= 1000:
            vacuum_connection = self.connect()
            try:
                vacuum_connection.execute("VACUUM")
            finally:
                vacuum_connection.close()

        return {
            "activitySegments": activity_segments,
            "classifications": classifications,
            "youtubeMetadata": youtube_metadata,
            "dryRun": bool(dry_run),
        }

    def search_classification_rule_candidates(self, query: str, target_kind: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        needle = query.strip().lower()
        include_sites = target_kind is None or target_kind == "site"
        include_apps = target_kind is None or target_kind == "app"
        candidates: list[dict[str, Any]] = []
        with self.connect() as conn:
            if include_sites:
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

            if include_apps:
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
                SELECT
                    id,
                    target_kind,
                    target_value,
                    normalized_target_value,
                    match_scope,
                    detail_kind,
                    detail_value,
                    normalized_detail_value,
                    category,
                    productivity,
                    confidence
                FROM classification_rules
                WHERE enabled = 1
                ORDER BY
                    CASE WHEN match_scope = 'detail' THEN 0 ELSE 1 END,
                    updated_at DESC,
                    created_at DESC
                """
            ).fetchall()
            if not rules:
                return {"matchedCount": 0, "appliedCount": 0, "skippedCount": 0}

            query = """
                SELECT
                    activity_segments.*,
                    youtube_video_metadata.title AS youtube_title
                FROM activity_segments
                LEFT JOIN youtube_video_metadata
                  ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
                WHERE 1=1
            """
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

    def get_projects(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            project_rows = conn.execute(
                """
                SELECT id, name, description, color, status, created_at, updated_at
                FROM projects
                ORDER BY datetime(created_at) ASC, id ASC
                """
            ).fetchall()
            anchor_rows = conn.execute(
                "SELECT project_id, kind, value, source FROM project_anchors ORDER BY id ASC"
            ).fetchall()
        anchors_by_project: dict[str, list[dict[str, Any]]] = {}
        for row in anchor_rows:
            anchors_by_project.setdefault(row["project_id"], []).append(
                {"kind": row["kind"], "value": row["value"], "source": row["source"]}
            )
        return [
            {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
                "color": row["color"],
                "status": row["status"],
                "anchors": anchors_by_project.get(row["id"], []),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in project_rows
        ]

    def _get_project(self, project_id: str) -> dict[str, Any] | None:
        return next((project for project in self.get_projects() if project["id"] == project_id), None)

    def save_project(self, project_input: dict[str, Any]) -> dict[str, Any]:
        name = str(project_input.get("name", "")).strip()
        if not name:
            raise ValueError("name is required")
        description = str(project_input.get("description", "")).strip()
        color = str(project_input.get("color", "")).strip() or DEFAULT_PROJECT_COLOR
        status = str(project_input.get("status", "active")).strip() or "active"
        if status not in VALID_PROJECT_STATUSES:
            raise ValueError("status must be 'active' or 'archived'")

        project_id = str(project_input.get("id") or uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT created_at FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            created_at = existing["created_at"] if existing else timestamp
            conn.execute(
                """
                INSERT INTO projects (id, name, description, color, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    color = excluded.color,
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (project_id, name, description, color, status, created_at, timestamp),
            )
        project = self._get_project(project_id)
        assert project is not None
        return project

    def delete_project(self, project_id: str) -> int:
        with self.connect() as conn:
            conn.execute(
                "UPDATE activity_project_assignments SET project_id = NULL WHERE project_id = ?",
                (project_id,),
            )
            cursor = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cursor.rowcount

    def _get_project_anchors(self, project_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT kind, value, source FROM project_anchors WHERE project_id = ? ORDER BY id ASC",
                (project_id,),
            ).fetchall()
        return [{"kind": row["kind"], "value": row["value"], "source": row["source"]} for row in rows]

    def save_project_anchors(self, project_id: str, anchors: list[dict[str, Any]]) -> list[dict[str, Any]]:
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            if conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
                raise ValueError("project not found")
            for anchor in anchors:
                kind = str(anchor.get("kind", "")).strip()
                value = str(anchor.get("value", "")).strip()
                source = str(anchor.get("source", "harvested")).strip() or "harvested"
                if kind not in VALID_PROJECT_ANCHOR_KINDS or not value:
                    continue
                conn.execute(
                    """
                    INSERT OR IGNORE INTO project_anchors (project_id, kind, value, source, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (project_id, kind, value, source, timestamp),
                )
        return self._get_project_anchors(project_id)

    def delete_project_anchor(self, project_id: str, kind: str, value: str) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM project_anchors WHERE project_id = ? AND kind = ? AND value = ?",
                (project_id, kind, value),
            )
            return cursor.rowcount

    def save_project_exemplar(self, project_id: str, run_summary: str, source: str) -> dict[str, Any]:
        run_summary = str(run_summary or "").strip()
        if not run_summary:
            raise ValueError("runSummary is required")
        if source not in VALID_PROJECT_EXEMPLAR_SOURCES:
            raise ValueError("source must be 'user_confirmed' or 'user_corrected'")
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            if conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
                raise ValueError("project not found")
            cursor = conn.execute(
                """
                INSERT INTO project_exemplars (project_id, run_summary, source, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (project_id, run_summary, source, timestamp),
            )
            exemplar_id = cursor.lastrowid
            conn.execute(
                """
                DELETE FROM project_exemplars
                WHERE project_id = ?
                  AND id NOT IN (
                    SELECT id FROM project_exemplars
                    WHERE project_id = ?
                    ORDER BY datetime(created_at) DESC, id DESC
                    LIMIT ?
                  )
                """,
                (project_id, project_id, PROJECT_EXEMPLAR_CAP),
            )
        return {
            "id": exemplar_id,
            "projectId": project_id,
            "runSummary": run_summary,
            "source": source,
            "createdAt": timestamp,
        }

    def get_project_exemplars(self, project_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, run_summary, source, created_at
                FROM project_exemplars
                WHERE project_id = ?
                ORDER BY datetime(created_at) DESC, id DESC
                """,
                (project_id,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "projectId": project_id,
                "runSummary": row["run_summary"],
                "source": row["source"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

    def save_project_assignments(self, assignments: list[dict[str, Any]]) -> dict[str, int]:
        saved = 0
        skipped_manual = 0
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            for item in assignments:
                raw_segment_id = item.get("segmentId", item.get("segment_id"))
                if raw_segment_id is None:
                    continue
                try:
                    segment_id = int(raw_segment_id)
                except (TypeError, ValueError):
                    continue

                source = str(item.get("source") or "ai")
                existing = conn.execute(
                    "SELECT source FROM activity_project_assignments WHERE segment_id = ?",
                    (segment_id,),
                ).fetchone()
                if existing is not None and existing["source"] == "manual" and source != "manual":
                    skipped_manual += 1
                    continue

                confidence = item.get("confidence")
                conn.execute(
                    """
                    INSERT INTO activity_project_assignments (
                        segment_id, project_id, source, confidence, reason, pass_id, chunk_fingerprint, assigned_at, stale
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(segment_id) DO UPDATE SET
                        project_id = excluded.project_id,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        reason = excluded.reason,
                        pass_id = excluded.pass_id,
                        chunk_fingerprint = excluded.chunk_fingerprint,
                        assigned_at = excluded.assigned_at,
                        stale = excluded.stale
                    """,
                    (
                        segment_id,
                        item.get("projectId", item.get("project_id")),
                        source,
                        float(confidence) if confidence is not None else None,
                        item.get("reason"),
                        item.get("passId", item.get("pass_id")),
                        item.get("chunkFingerprint", item.get("chunk_fingerprint")),
                        item.get("assignedAt") or item.get("assigned_at") or timestamp,
                        1 if item.get("stale") else 0,
                    ),
                )
                saved += 1
        return {"saved": saved, "skippedManual": skipped_manual}

    def get_project_assignments(self, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
        query = """
            SELECT
                a.segment_id,
                a.project_id,
                a.source,
                a.confidence,
                a.reason,
                a.pass_id,
                a.chunk_fingerprint,
                a.assigned_at,
                a.stale
            FROM activity_project_assignments a
            JOIN activity_segments s ON s.id = a.segment_id
            WHERE 1 = 1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end, table_name="s")
        query += " ORDER BY datetime(s.started_at) ASC, a.segment_id ASC"
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            {
                "segmentId": str(row["segment_id"]),
                "projectId": row["project_id"],
                "source": row["source"],
                "confidence": row["confidence"],
                "reason": row["reason"],
                "passId": row["pass_id"],
                "chunkFingerprint": row["chunk_fingerprint"],
                "assignedAt": row["assigned_at"],
                "stale": bool(row["stale"]),
            }
            for row in rows
        ]

    def record_project_pass(self, pass_input: dict[str, Any]) -> dict[str, Any]:
        timestamp = datetime.now(timezone.utc).isoformat()
        ran_at = pass_input.get("ranAt") or pass_input.get("ran_at") or timestamp
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO project_pass_runs (
                    ran_at, range_start, range_end, trigger, model, provider,
                    runs_count, tokens_in, tokens_out, latency_ms,
                    assignments_count, corrections_count, prompt_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ran_at,
                    pass_input.get("rangeStart", pass_input.get("range_start")),
                    pass_input.get("rangeEnd", pass_input.get("range_end")),
                    str(pass_input.get("trigger", "manual")),
                    pass_input.get("model"),
                    pass_input.get("provider"),
                    pass_input.get("runsCount", pass_input.get("runs_count")),
                    pass_input.get("tokensIn", pass_input.get("tokens_in")),
                    pass_input.get("tokensOut", pass_input.get("tokens_out")),
                    pass_input.get("latencyMs", pass_input.get("latency_ms")),
                    pass_input.get("assignmentsCount", pass_input.get("assignments_count")),
                    pass_input.get("correctionsCount", pass_input.get("corrections_count")),
                    str(pass_input.get("promptVersion", pass_input.get("prompt_version", ""))),
                ),
            )
            pass_id = cursor.lastrowid
        return {"id": pass_id, "ranAt": ran_at}

    def get_project_pass_runs(self, start: str | None = None, end: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        query = "SELECT * FROM project_pass_runs WHERE 1 = 1"
        params: list[Any] = []
        if start:
            query += " AND datetime(ran_at) >= datetime(?)"
            params.append(self._normalize_range_bound(start))
        if end:
            query += " AND datetime(ran_at) <= datetime(?)"
            params.append(self._normalize_range_bound(end))
        query += " ORDER BY datetime(ran_at) DESC, id DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            {
                "id": row["id"],
                "ranAt": row["ran_at"],
                "rangeStart": row["range_start"],
                "rangeEnd": row["range_end"],
                "trigger": row["trigger"],
                "model": row["model"],
                "provider": row["provider"],
                "runsCount": row["runs_count"],
                "tokensIn": row["tokens_in"],
                "tokensOut": row["tokens_out"],
                "latencyMs": row["latency_ms"],
                "assignmentsCount": row["assignments_count"],
                "correctionsCount": row["corrections_count"],
                "promptVersion": row["prompt_version"],
            }
            for row in rows
        ]

    @staticmethod
    def _serialize_ai_review_event(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "segmentId": str(row["segment_id"]),
            "passId": row["pass_id"],
            "prevCategory": row["prev_category"],
            "prevProductivity": row["prev_productivity"],
            "prevSource": row["prev_source"],
            "newCategory": row["new_category"],
            "newProductivity": row["new_productivity"],
            "confidence": row["confidence"],
            "reason": row["reason"],
            "createdAt": row["created_at"],
            "revertedAt": row["reverted_at"],
        }

    def save_ai_review_events(self, events: list[dict[str, Any]]) -> int:
        saved = 0
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            for event in events:
                raw_segment_id = event.get("segmentId", event.get("segment_id"))
                pass_id = event.get("passId", event.get("pass_id"))
                if raw_segment_id is None or pass_id is None:
                    continue
                try:
                    segment_id = int(raw_segment_id)
                except (TypeError, ValueError):
                    continue
                confidence = event.get("confidence")
                conn.execute(
                    """
                    INSERT INTO ai_review_events (
                        segment_id, pass_id, prev_category, prev_productivity, prev_source,
                        new_category, new_productivity, confidence, reason, created_at, reverted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        segment_id,
                        pass_id,
                        event.get("prevCategory", event.get("prev_category")),
                        event.get("prevProductivity", event.get("prev_productivity")),
                        event.get("prevSource", event.get("prev_source")),
                        event.get("newCategory", event.get("new_category")),
                        event.get("newProductivity", event.get("new_productivity")),
                        float(confidence) if confidence is not None else None,
                        event.get("reason"),
                        event.get("createdAt") or event.get("created_at") or timestamp,
                    ),
                )
                saved += 1
        return saved

    def get_ai_review_events(self, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
        query = """
            SELECT
                e.id, e.segment_id, e.pass_id, e.prev_category, e.prev_productivity, e.prev_source,
                e.new_category, e.new_productivity, e.confidence, e.reason, e.created_at, e.reverted_at
            FROM ai_review_events e
            JOIN activity_segments s ON s.id = e.segment_id
            WHERE 1 = 1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end, table_name="s")
        query += " ORDER BY datetime(e.created_at) DESC, e.id DESC"
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._serialize_ai_review_event(row) for row in rows]

    def revert_ai_review_event(self, event_id: int) -> dict[str, Any]:
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            event = conn.execute(
                "SELECT * FROM ai_review_events WHERE id = ?", (event_id,)
            ).fetchone()
            if event is None or event["reverted_at"] is not None:
                return {"reverted": False, "restored": False}

            current = conn.execute(
                "SELECT source FROM activity_classifications WHERE segment_id = ?",
                (event["segment_id"],),
            ).fetchone()
            restored = False
            if (
                current is not None
                and current["source"] == "ai_review"
                and event["prev_category"] is not None
                and event["prev_productivity"] is not None
            ):
                conn.execute(
                    """
                    UPDATE activity_classifications
                    SET category = ?, productivity = ?, source = ?, refreshed_at = ?
                    WHERE segment_id = ?
                    """,
                    (
                        event["prev_category"],
                        event["prev_productivity"],
                        event["prev_source"] or "llm",
                        timestamp,
                        event["segment_id"],
                    ),
                )
                restored = True
            conn.execute(
                "UPDATE ai_review_events SET reverted_at = ? WHERE id = ?",
                (timestamp, event_id),
            )
        return {"reverted": True, "restored": restored}

    def get_reverted_ai_review_segment_ids(self, segment_ids: list[str]) -> list[str]:
        ids: list[int] = []
        for raw in segment_ids:
            try:
                ids.append(int(raw))
            except (TypeError, ValueError):
                continue
        if not ids:
            return []
        placeholders = ",".join("?" for _ in ids)
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT DISTINCT segment_id FROM ai_review_events
                WHERE reverted_at IS NOT NULL AND segment_id IN ({placeholders})
                """,
                ids,
            ).fetchall()
        return [str(row["segment_id"]) for row in rows]

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

    def timeline_page(
        self,
        start: str | None = None,
        end: str | None = None,
        before_ended_at: str | None = None,
        before_segment_id: str | int | None = None,
        limit: int | str | None = None,
    ) -> dict[str, Any]:
        page_limit = self._clamp_timeline_page_limit(limit)
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
        query = self._append_overlap_filters(query, params, start, end, "activity_segments")
        cursor_segment_id = self._parse_timeline_page_cursor_segment_id(before_segment_id)
        if before_ended_at and cursor_segment_id is not None:
            normalized_before_ended_at = self._normalize_range_bound(before_ended_at)
            query += """
                AND (
                  datetime(activity_segments.ended_at) < datetime(?)
                  OR (
                    datetime(activity_segments.ended_at) = datetime(?)
                    AND activity_segments.id < ?
                  )
                )
            """
            params.extend([normalized_before_ended_at, normalized_before_ended_at, cursor_segment_id])
        query += " ORDER BY datetime(activity_segments.ended_at) DESC, activity_segments.id DESC LIMIT ?"
        params.append(page_limit + 1)

        with self.connect() as conn:
            rows = [dict(row) for row in conn.execute(query, tuple(params)).fetchall()]

        page_rows = rows[:page_limit]
        has_more = len(rows) > page_limit
        items = [self._serialize_row(row) for row in reversed(page_rows)]
        cursor_row = page_rows[-1] if has_more and page_rows else None
        return {
            "items": items,
            "hasMore": has_more,
            "nextCursor": {
                "beforeEndedAt": cursor_row["ended_at"],
                "beforeSegmentId": str(cursor_row["id"]),
            } if cursor_row else None,
        }

    def search_timeline_page(
        self,
        query: str,
        start: str | None = None,
        end: str | None = None,
        before_ended_at: str | None = None,
        before_segment_id: str | int | None = None,
        limit: int | str | None = None,
    ) -> dict[str, Any]:
        tokens = self._timeline_search_tokens(query)
        if not tokens:
            return {"items": [], "hasMore": False, "nextCursor": None}

        page_limit = self._clamp_timeline_page_limit(limit)
        sql = """
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
        sql = self._append_overlap_filters(sql, params, start, end, "activity_segments")
        for token in tokens:
            field_predicates = [
                f"lower(coalesce({field}, '')) LIKE ? ESCAPE '\\'"
                for field in TIMELINE_SEARCH_FIELDS
            ]
            sql += f" AND ({' OR '.join(field_predicates)})"
            params.extend([f"%{token}%" for _ in TIMELINE_SEARCH_FIELDS])

        cursor_segment_id = self._parse_timeline_page_cursor_segment_id(before_segment_id)
        if before_ended_at and cursor_segment_id is not None:
            normalized_before_ended_at = self._normalize_range_bound(before_ended_at)
            sql += """
                AND (
                  datetime(activity_segments.ended_at) < datetime(?)
                  OR (
                    datetime(activity_segments.ended_at) = datetime(?)
                    AND activity_segments.id < ?
                  )
                )
            """
            params.extend([normalized_before_ended_at, normalized_before_ended_at, cursor_segment_id])
        sql += " ORDER BY datetime(activity_segments.ended_at) DESC, activity_segments.id DESC LIMIT ?"
        params.append(page_limit + 1)

        with self.connect() as conn:
            rows = [dict(row) for row in conn.execute(sql, tuple(params)).fetchall()]

        page_rows = rows[:page_limit]
        has_more = len(rows) > page_limit
        items = [self._serialize_row(row) for row in reversed(page_rows)]
        cursor_row = page_rows[-1] if has_more and page_rows else None
        return {
            "items": items,
            "hasMore": has_more,
            "nextCursor": {
                "beforeEndedAt": cursor_row["ended_at"],
                "beforeSegmentId": str(cursor_row["id"]),
            } if cursor_row else None,
        }

    def dashboard_week_timeline(self, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
        query = """
            SELECT
                activity_segments.id,
                activity_segments.started_at,
                activity_segments.ended_at,
                activity_segments.duration_seconds,
                activity_segments.app_name,
                activity_segments.bundle_id,
                activity_segments.window_title,
                activity_segments.browser_name,
                activity_segments.site_domain,
                activity_segments.site_title,
                activity_segments.site_url,
                activity_segments.youtube_video_id,
                activity_segments.youtube_playlist_id,
                activity_segments.youtube_is_shorts,
                activity_segments.site_source,
                activity_segments.platform,
                activity_segments.source,
                activity_segments.confidence,
                youtube_video_metadata.category AS youtube_category,
                youtube_video_metadata.channel_name AS youtube_channel_name,
                youtube_video_metadata.title AS youtube_title,
                activity_classifications.category AS classification_category,
                activity_classifications.productivity AS classification_productivity,
                activity_classifications.source AS classification_source,
                activity_classifications.confidence AS classification_confidence,
                activity_classifications.ai_result AS classification_ai_result,
                activity_classifications.stale AS classification_stale,
                activity_classifications.classification_rule_id AS classification_rule_id
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end, "activity_segments")
        query += " ORDER BY activity_segments.started_at ASC"
        with self.connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        return [serialize_dashboard_week_activity_row(dict(row)) for row in rows]

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
        match_scope = row["match_scope"] or "surface"
        detail_kind = row["detail_kind"] or None
        return {
            "id": row["id"],
            "targetKind": row["target_kind"],
            "targetValue": row["target_value"],
            "matchScope": match_scope,
            "detailKind": detail_kind,
            "detailValue": row["detail_value"],
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
    def _normalize_rule_detail(value: str | None) -> str:
        return " ".join((value or "").strip().lower().split())

    @staticmethod
    def _normalize_rule_detail_by_kind(detail_kind: str, value: str | None) -> str:
        if detail_kind == "siteUrl":
            return canonicalize_classification_rule_site_url(value) or ""
        return TrackerDatabase._normalize_rule_detail(value)

    @staticmethod
    def _looks_like_bundle_id(value: str | None) -> bool:
        text = (value or "").strip()
        return "." in text and " " not in text

    def _matching_rule(self, segment: sqlite3.Row, rules: list[sqlite3.Row]) -> sqlite3.Row | None:
        for rule in rules:
            if not self._rule_surface_matches(segment, rule):
                continue
            if rule["match_scope"] == "detail" and not self._rule_detail_matches(segment, rule):
                continue
            return rule
        return None

    def _rule_surface_matches(self, segment: sqlite3.Row, rule: sqlite3.Row) -> bool:
        if rule["target_kind"] == "site":
            host = self._normalize_site_target(segment["site_domain"] or segment["site_url"])
            target = rule["normalized_target_value"]
            return bool(host and (host == target or host.endswith(f".{target}")))

        bundle_id = segment["bundle_id"]
        target = rule["target_value"]
        if (self._looks_like_bundle_id(target) or bundle_id) and bundle_id == target:
            return True
        return self._normalize_app_target(segment["app_name"]) == rule["normalized_target_value"]

    def _rule_detail_matches(self, segment: sqlite3.Row, rule: sqlite3.Row) -> bool:
        normalized_detail_value = rule["normalized_detail_value"]
        if not normalized_detail_value:
            return False
        return normalized_detail_value in self._normalized_segment_rule_details(segment, rule["detail_kind"])

    def _normalized_segment_rule_details(self, segment: sqlite3.Row, detail_kind: str) -> set[str]:
        if detail_kind == "siteUrl":
            normalized_url = canonicalize_classification_rule_site_url(self._row_text(segment, "site_url"))
            return {normalized_url} if normalized_url else set()
        detail_columns = {
            "title": ("youtube_title", "site_title", "window_title"),
            "windowTitle": ("window_title",),
            "siteTitle": ("site_title",),
            "youtubeTitle": ("youtube_title",),
        }
        values = [self._row_text(segment, column) for column in detail_columns.get(detail_kind, ())]
        return {normalized for value in values if (normalized := self._normalize_rule_detail(value))}

    @staticmethod
    def _row_text(row: sqlite3.Row, column: str) -> str | None:
        if column not in row.keys():
            return None
        value = row[column]
        if value is None:
            return None
        return str(value)

    @staticmethod
    def _rule_reason(rule: sqlite3.Row) -> str:
        if rule["match_scope"] == "detail":
            return f"Matched local {rule['target_kind']} detail rule: {rule['target_value']} / {rule['detail_value']}"
        return f"Matched local {rule['target_kind']} rule: {rule['target_value']}"

    @staticmethod
    def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
        return serialize_activity_row(row)

    @staticmethod
    def _clamp_timeline_page_limit(limit: int | str | None) -> int:
        if limit is None:
            return DEFAULT_TIMELINE_PAGE_LIMIT
        try:
            parsed = int(limit)
        except (TypeError, ValueError):
            return DEFAULT_TIMELINE_PAGE_LIMIT
        return max(1, min(parsed, MAX_TIMELINE_PAGE_LIMIT))

    @staticmethod
    def _parse_timeline_page_cursor_segment_id(segment_id: str | int | None) -> int | None:
        if segment_id is None:
            return None
        try:
            parsed = int(segment_id)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @staticmethod
    def _timeline_search_tokens(query: str) -> list[str]:
        return [
            TrackerDatabase._escape_timeline_search_token(token)
            for token in query.strip().lower().split()
        ]

    @staticmethod
    def _escape_timeline_search_token(token: str) -> str:
        return token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

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
    def _backfilled_raw_context_json(
        raw_context: dict[str, Any],
        metadata: BrowserMetadata,
        confidence: float,
        backfilled_at: str,
    ) -> str:
        updated_context = {
            **raw_context,
            "browser_name": metadata.browser_name,
            "site_domain": metadata.site_domain,
            "site_title": metadata.site_title,
            "site_url": metadata.site_url,
            "youtube_video_id": metadata.youtube_video_id,
            "youtube_playlist_id": metadata.youtube_playlist_id,
            "youtube_is_shorts": metadata.youtube_is_shorts,
            "site_source": metadata.match_state,
            "capture_confidence": confidence,
            "browser_automation_status": metadata.browser_automation_status,
            "browser_automation_error": metadata.browser_automation_error,
            "browser_history_status": metadata.browser_history_status,
            "browser_history_reason": metadata.browser_history_reason,
            "browser_history_database_found": metadata.browser_history_database_found,
            "browser_history_profile_count": metadata.browser_history_profile_count,
            "browser_history_candidate_count": metadata.browser_history_candidate_count,
            "browser_history_error_count": metadata.browser_history_error_count,
            "browser_history_backfilled": True,
            "browser_history_backfilled_at": backfilled_at,
        }
        return json.dumps(updated_context)

    @staticmethod
    def _raw_context_dict(raw_context_json: str | None) -> dict[str, Any]:
        if not raw_context_json:
            return {}
        try:
            raw_context = json.loads(raw_context_json)
        except json.JSONDecodeError:
            return {}
        if isinstance(raw_context, dict):
            return raw_context
        return {}

    @staticmethod
    def _optional_bool_int(value: bool | None) -> int | None:
        if value is None:
            return None
        return int(value)

    @staticmethod
    def _timestamp_seconds(value: str) -> float:
        parsed = parse_iso_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()

    @staticmethod
    def _json_list(value: str | None) -> list[str] | None:
        return json_list(value)
