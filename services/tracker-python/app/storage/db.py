from __future__ import annotations

from app.tracker.browser_content import normalize_context as normalize_browser_context

import hashlib
import json
import math
import re
import sqlite3
import sys
import uuid
from ipaddress import IPv6Address
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

from app.fs_safety import ensure_directory
from app.storage import activity_block_labels, activity_timeline_cards
from app.storage.ai_review_schema import ensure_ai_review_schema
from app.storage.sync_deletion_barrier import (
    SyncDeletionBarrier, ensure_received_deletion_schema, sync_account_scope,
)
from app.text_safety import without_lone_surrogates
from app.storage.classification_rule_url import canonicalize_classification_rule_site_url
from app.capture_platform import CAPTURE_PLATFORM
from app.storage.activity_segment_serialization import (
    json_list,
    sanitized_raw_context_json,
    serialize_activity_row,
    serialize_dashboard_week_activity_row,
    serialize_project_trend_activity_row,
)
from app.storage.timestamps import history_ends_after, parse_iso_datetime
from app.tracker.capture_timeline import CaptureMutation, CaptureTimeline, CaptureTiming, CaptureTrim
from app.storage.database_maintenance import (
    DatabasePreparationResult,
    create_rotating_backup,
    database_initialization_guard,
    permanent_deletion_guard,
    prepare_database,
)
from app.tracker.app_exclusion import (
    DEFAULT_EXCLUDED_APPS,
    REDACTED_APP_NAME,
    SITE_RULE_PREFIX,
    ExcludedAppRule,
    match_exclusion,
    normalize_excluded_site,
    redact_snapshot,
)

if TYPE_CHECKING:
    from app.tracker.browser_automation import BrowserMetadata
    from app.tracker.macos_workspace import Snapshot
    from app.tracker.youtube_metadata import YouTubeVideoMetadata


BROWSER_HISTORY_IMPORT_SOURCE = "browser-history-import"
VALID_RULE_TARGET_KINDS = {"app", "site"}
VALID_RULE_MATCH_SCOPES = {"surface", "detail"}
VALID_RULE_DETAIL_KINDS = {"title", "windowTitle", "siteTitle", "youtubeTitle", "siteUrl"}

VALID_PROJECT_STATUSES = {"active", "archived"}
VALID_PROJECT_ANCHOR_KINDS = {"app", "domain", "keyword", "repo_path"}

# SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999. Keep a margin for extra
# bound values in the same statement when deleting by id.
ACTIVITY_SEGMENT_DELETE_BATCH_SIZE = 900
DEFAULT_PROJECT_COLOR = "#6366f1"
DEFAULT_RULE_CONFIDENCE = 1.0
RULE_WRITE_STAGE_MIN_ROWS = 256
RULE_WRITE_COLUMNS = (
    "segment_id", "input_fingerprint", "category", "productivity", "confidence", "reason",
    "classified_at", "refreshed_at", "rule_id", "captured_id", "captured_rule_id",
    "segment_uid", "app_name", "bundle_id", "site_domain", "site_url", "site_title",
    "window_title", "youtube_video_id", "youtube_title", "started_at", "ended_at",
)
DEFAULT_TIMELINE_PAGE_LIMIT = 200
MAX_TIMELINE_PAGE_LIMIT = 500
# Keep room for several ordinary ~4 MiB WAL checkpoint cycles without retaining
# the peak size of a large classification/import transaction for the whole run.
MAX_RETAINED_JOURNAL_BYTES = 16 * 1024 * 1024
TIMELINE_SEARCH_FIELDS = (
    "activity_segments.app_name",
    "activity_segments.browser_name",
    "activity_segments.site_domain",
    "activity_segments.site_title",
    "activity_segments.site_url",
    "activity_segments.window_title",
    "activity_classifications.category",
    "activity_classifications.productivity",
    "projects.name",
)

BrowserHistoryResolver = Callable[[Optional[str], Optional[str], Optional[str]], Any]
BrowserHistoryTitlePolicy = Callable[[Optional[str]], bool]


def fetch_row_dicts(conn: sqlite3.Connection, query: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Run a query and return each row as a plain dict, in column order.

    Equivalent to [dict(row) for row in conn.execute(...)] on a sqlite3.Row
    connection, but builds the dicts from plain tuples instead of looking each
    column up by name. On a 12.9k-row week timeline this cut fetching plus
    serializing from about 146ms to 91ms. When a query repeats a column name,
    the first occurrence wins, matching sqlite3.Row name lookup.
    """
    cursor = conn.cursor()
    cursor.row_factory = None
    cursor.execute(query, params)
    columns = [description[0] for description in cursor.description]
    rows = cursor.fetchall()
    if len(set(columns)) == len(columns):
        return [dict(zip(columns, row)) for row in rows]
    unique_columns = list(dict.fromkeys(columns))
    first_index = {column: columns.index(column) for column in unique_columns}
    return [{column: row[first_index[column]] for column in unique_columns} for row in rows]


@dataclass(frozen=True)
class BrowserHistoryBackfillConfig:
    observed_at: str
    max_age_seconds: int


@dataclass(frozen=True)
class BrowserHistoryBackfillResult:
    segment_id: int
    site_url: str | None
    youtube_video_id: str | None



def _excluded_rule_kind(rule_id: str) -> str:
    return "site" if rule_id.startswith(SITE_RULE_PREFIX) else "app"


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
    # One-time repair for range deletions that the macOS tracker left incomplete
    # before trimmed fractional seconds were parsed (#1767). See
    # replay_trimmed_fraction_range_deletions().
    RANGE_DELETION_REPLAY_META_KEY = "range_deletion_replay_v1"
    _TRIMMED_FRACTION = re.compile(r"[T ]\d{2}:\d{2}:\d{2}\.(\d+)")

    def __init__(self, db_path: Path, *, perform_maintenance: bool = True, read_only: bool = False):
        self.db_path = db_path
        self.path = db_path
        self.read_only = read_only
        self.capture_timeline = CaptureTimeline()
        if not self.read_only:
            ensure_directory(self.db_path.parent)
        self._connection: sqlite3.Connection | None = None
        self.maintenance_error: str | None = None
        self.maintenance_result = DatabasePreparationResult(existed=self.db_path.exists())
        if not self.read_only:
            self.maintenance_result = (
                prepare_database(self.db_path)
                if perform_maintenance
                else self.maintenance_result
            )
            with database_initialization_guard(self.db_path):
                self._init_db()
        if not self.read_only and perform_maintenance and self.maintenance_result.existed:
            self._replay_range_deletions_once()
            self.create_periodic_backup()

    def _replay_range_deletions_once(self) -> None:
        try:
            self.replay_trimmed_fraction_range_deletions()
        except (OSError, sqlite3.DatabaseError) as error:
            # A failed repair must not keep the tracker from starting. The
            # marker stays unset, so the next start tries again.
            self._record_maintenance_error(error, operation="Range deletion replay skipped")

    @classmethod
    def _has_trimmed_fraction(cls, value: str | None) -> bool:
        match = cls._TRIMMED_FRACTION.search(value or "")
        return bool(match) and len(match.group(1)) not in (3, 6)

    def replay_trimmed_fraction_range_deletions(self) -> int:
        """Finish this Mac's range deletions that skipped synced rows.

        Before #1767 the macOS tracker's Python could not parse the trimmed
        fractional seconds PostgreSQL gives synced rows. history_ends_after()
        then returned False, so every range deletion with a start bound kept
        the synced rows whose end time had such a fraction. Re-run that check
        once, only for this device's own range tombstones and only for those
        rows. Deleting them records a uids tombstone, so other Macs that kept
        the same rows drop them too. Received range deletions are not stored
        with their bounds and cannot be replayed here.
        """
        if self.read_only or CAPTURE_PLATFORM != "macos":
            return 0
        with self.connect() as conn:
            done = conn.execute(
                "SELECT 1 FROM tracker_meta WHERE key = ?",
                (self.RANGE_DELETION_REPLAY_META_KEY,),
            ).fetchone()
            if done is not None:
                return 0
            ranges = conn.execute(
                "SELECT range_start, range_end FROM sync_deletions "
                "WHERE kind = 'range' AND range_start IS NOT NULL"
            ).fetchall()
            segment_ids: set[str] = set()
            for deletion in ranges:
                params: list[Any] = []
                query = self._append_overlap_filters(
                    "SELECT id, ended_at FROM activity_segments WHERE origin_device_id IS NOT NULL",
                    params,
                    deletion["range_start"],
                    deletion["range_end"],
                    strict_start=True,
                )
                segment_ids.update(
                    str(row["id"])
                    for row in conn.execute(query, tuple(params))
                    if self._has_trimmed_fraction(row["ended_at"])
                )
        deleted = self.delete_activity_segments(sorted(segment_ids)) if segment_ids else 0
        with self.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO tracker_meta(key, value) VALUES (?, ?)",
                (
                    self.RANGE_DELETION_REPLAY_META_KEY,
                    json.dumps({
                        "deleted": deleted,
                        "ranges": len(ranges),
                        "at": datetime.now(timezone.utc).isoformat(),
                    }),
                ),
            )
        return deleted

    def _record_maintenance_error(
        self, error: OSError | sqlite3.DatabaseError, *, operation: str
    ) -> None:
        self.maintenance_error = str(error)
        print(f"[tracker-db] {operation}: {error}", file=sys.stderr)

    def _record_post_delete_backup_error(
        self, error: OSError | sqlite3.DatabaseError
    ) -> None:
        # The permanent delete has already committed and older recovery copies
        # are gone. Do not report the delete as failed merely because the new
        # safety copy could not be written.
        self._record_maintenance_error(
            error, operation="Post-delete backup unavailable"
        )

    def create_periodic_backup(self) -> Path | None:
        """Best-effort daily backup for a long-running tracker process."""

        try:
            backup = create_rotating_backup(self.connect(), self.db_path)
            self.maintenance_error = None
            return backup
        except (OSError, sqlite3.DatabaseError) as error:
            # A failed safety copy must never make an otherwise healthy
            # source-of-truth database unavailable to the tracker.
            self._record_maintenance_error(error, operation="Backup skipped")
            return None

    def _create_post_delete_backup(self) -> Path | None:
        try:
            backup = create_rotating_backup(
                self.connect(), self.db_path, interval_seconds=0
            )
            self.maintenance_error = None
            return backup
        except (OSError, sqlite3.DatabaseError) as error:
            self._record_post_delete_backup_error(error)
            return None

    def connect(self) -> sqlite3.Connection:
        """Return this instance's long-lived connection, opening it on first use.

        The returned connection is used as a context manager exactly like the
        previous per-call connections: ``with self.connect() as conn`` commits
        on success and rolls back on exception (plain sqlite3.Connection
        semantics). It just no longer closes on exit, so call sites keep the
        same commit behavior while skipping a fresh open per operation.
        """
        if self._connection is not None:
            return self._connection
        if self.read_only:
            connection = sqlite3.connect(f"{self.db_path.resolve().as_uri()}?mode=ro", uri=True)
        else:
            connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.create_function("history_ends_after", 2, history_ends_after)
        connection.execute("PRAGMA foreign_keys = ON")
        # The daemon and the serve process write this database concurrently
        # (and delete_history_range runs VACUUM); wait for a contended lock
        # instead of raising "database is locked" immediately.
        connection.execute("PRAGMA busy_timeout = 5000")
        # WAL mode only needs NORMAL durability; avoids an fsync per commit.
        if self.read_only:
            connection.execute("PRAGMA query_only = ON")
        else:
            connection.execute("PRAGMA synchronous = NORMAL")
            journal_limit = connection.execute("PRAGMA journal_size_limit").fetchone()[0]
            if journal_limit < 0 or journal_limit > MAX_RETAINED_JOURNAL_BYTES:
                # SQLite truncates only reusable space when the WAL resets;
                # active transactions/readers may still grow it beyond this.
                # Preserve tighter platform defaults (Apple uses 32 KiB).
                connection.execute(f"PRAGMA journal_size_limit = {MAX_RETAINED_JOURNAL_BYTES}")
        self._connection = connection
        return connection

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    @contextmanager
    def _definition_connection(self, conn: sqlite3.Connection | None):
        """Reuse an import transaction without a nested context committing it."""
        if conn is not None:
            yield conn
        else:
            with self.connect() as connection:
                yield connection

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

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
                  engagement_evidence TEXT,
                  raw_context_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_activity_segments_started_at
                ON activity_segments(datetime(started_at));

                CREATE INDEX IF NOT EXISTS idx_activity_segments_ended_at
                ON activity_segments(datetime(ended_at));

                -- Timeline summaries spread a positive recorded duration over
                -- at least that much wall-clock time. Index the same effective
                -- end used by the domain so a point/short timestamp span can be
                -- found in the following logical window without scanning the
                -- complete activity table.
                CREATE INDEX IF NOT EXISTS idx_activity_segments_sampled_end_at
                ON activity_segments(
                  CASE
                    WHEN julianday(started_at) IS NOT NULL
                      AND julianday(ended_at) IS NOT NULL
                      AND julianday(ended_at) >= julianday(started_at)
                      AND duration_seconds > 0
                    THEN max(
                      julianday(ended_at),
                      julianday(started_at) + duration_seconds / 86400.0
                    )
                    ELSE julianday(ended_at)
                  END
                );

                CREATE TABLE IF NOT EXISTS tracker_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS browser_history_import_keys (
                  import_key TEXT PRIMARY KEY,
                  segment_id INTEGER REFERENCES activity_segments(id) ON DELETE SET NULL,
                  imported_at TEXT NOT NULL
                );

                -- Parent deletion must find referencing keys without scanning
                -- the whole import history for each segment under the write lock.
                CREATE INDEX IF NOT EXISTS idx_browser_history_import_keys_segment_id
                ON browser_history_import_keys(segment_id);

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

                CREATE TABLE IF NOT EXISTS team_projects (
                  id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT NOT NULL,
                  color TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_team_projects_org
                ON team_projects(organization_id);

                CREATE TABLE IF NOT EXISTS team_project_anchors (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  team_project_id TEXT NOT NULL REFERENCES team_projects(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL,
                  value TEXT NOT NULL,
                  source TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(team_project_id, kind, value)
                );

                CREATE INDEX IF NOT EXISTS idx_team_project_anchors_project
                ON team_project_anchors(team_project_id);

                CREATE TABLE IF NOT EXISTS team_project_assignments (
                  segment_id INTEGER PRIMARY KEY REFERENCES activity_segments(id) ON DELETE CASCADE,
                  team_project_id TEXT REFERENCES team_projects(id) ON DELETE SET NULL,
                  source TEXT NOT NULL,
                  confidence REAL,
                  pass_id INTEGER,
                  chunk_fingerprint TEXT,
                  assigned_at TEXT NOT NULL,
                  stale INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_team_project_assignments_project
                ON team_project_assignments(team_project_id);

                CREATE TABLE IF NOT EXISTS project_window_assignments (
                  window_started_at TEXT PRIMARY KEY,
                  window_id TEXT NOT NULL,
                  window_ended_at TEXT NOT NULL,
                  duration_seconds INTEGER NOT NULL,
                  segment_overlaps_json TEXT NOT NULL,
                  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                  team_project_id TEXT REFERENCES team_projects(id) ON DELETE SET NULL,
                  source TEXT NOT NULL DEFAULT 'ai',
                  confidence REAL,
                  reason TEXT,
                  pass_id INTEGER,
                  chunk_fingerprint TEXT,
                  assigned_at TEXT NOT NULL,
                  stale INTEGER NOT NULL DEFAULT 0,
                  CHECK (project_id IS NULL OR team_project_id IS NULL)
                );

                CREATE INDEX IF NOT EXISTS idx_project_window_assignments_range
                ON project_window_assignments(window_started_at, window_ended_at);

                CREATE INDEX IF NOT EXISTS idx_project_window_assignments_project
                ON project_window_assignments(project_id);

                CREATE INDEX IF NOT EXISTS idx_project_window_assignments_team_project
                ON project_window_assignments(team_project_id);

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

                CREATE TABLE IF NOT EXISTS sync_counter (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  seq INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sync_deletions (
                  deletion_uid TEXT PRIMARY KEY,
                  account_id TEXT,
                  kind TEXT NOT NULL CHECK (kind IN ('range', 'uids')),
                  range_start TEXT,
                  range_end TEXT,
                  segment_uids_json TEXT,
                  created_at TEXT NOT NULL,
                  pushed INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS applied_sync_deletions (
                  deletion_uid TEXT PRIMARY KEY,
                  applied_at TEXT NOT NULL
                );

                -- Dev signals. Local-only: intentionally outside the sync
                -- triggers and never mirrored to shared surfaces.
                CREATE TABLE IF NOT EXISTS dev_commit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  repo_key TEXT NOT NULL,
                  commit_sha TEXT NOT NULL,
                  authored_at TEXT NOT NULL,
                  insertions INTEGER,
                  deletions INTEGER,
                  files_changed INTEGER,
                  ingested_at TEXT NOT NULL,
                  UNIQUE(repo_key, commit_sha)
                );

                CREATE INDEX IF NOT EXISTS idx_dev_commit_events_authored
                ON dev_commit_events(datetime(authored_at));

                CREATE TABLE IF NOT EXISTS dev_repos (
                  repo_key TEXT PRIMARY KEY,
                  repo_path TEXT NOT NULL,
                  author_email TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agent_session_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  provider TEXT NOT NULL,
                  session_key TEXT NOT NULL,
                  turn_index INTEGER NOT NULL,
                  started_at TEXT NOT NULL,
                  ended_at TEXT NOT NULL,
                  active_seconds INTEGER NOT NULL,
                  cwd_key TEXT,
                  model TEXT,
                  total_tokens INTEGER,
                  tokens_in INTEGER,
                  tokens_out INTEGER,
                  tokens_cache_read INTEGER,
                  tokens_cache_write INTEGER,
                  cost_usd REAL,
                  ingested_at TEXT NOT NULL,
                  UNIQUE(provider, session_key, turn_index)
                );

                CREATE INDEX IF NOT EXISTS idx_agent_session_events_started
                ON agent_session_events(datetime(started_at));

                CREATE TABLE IF NOT EXISTS excluded_apps (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  bundle_id TEXT,
                  source TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO sync_counter(id, seq) VALUES (1, 0);
                """
            )
            self._ensure_columns(conn)
            self._ensure_sync_schema(conn)
            ensure_ai_review_schema(conn)
            activity_block_labels.ensure_activity_block_label_schema(conn)
            activity_timeline_cards.ensure_activity_timeline_card_schema(conn)
            self._ensure_default_excluded_apps(conn)

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
            "engagement_evidence": "TEXT",
            "segment_uid": "TEXT",
            "origin_device_id": "TEXT",
            "sync_seq": "INTEGER NOT NULL DEFAULT 0",
            "exclusion_source": "TEXT",
        }
        for column, column_type in optional_columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE activity_segments ADD COLUMN {column} {column_type}")

        excluded_existing = {row["name"] for row in conn.execute("PRAGMA table_info(excluded_apps)")}
        excluded_optional = {
            "tombstone": "INTEGER NOT NULL DEFAULT 0",
            "updated_at": "TEXT",
        }
        for column, column_type in excluded_optional.items():
            if column not in excluded_existing:
                conn.execute(f"ALTER TABLE excluded_apps ADD COLUMN {column} {column_type}")
        conn.execute("UPDATE excluded_apps SET updated_at = created_at WHERE updated_at IS NULL")

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

        sync_deletion_existing = {row["name"] for row in conn.execute("PRAGMA table_info(sync_deletions)")}
        if "account_id" not in sync_deletion_existing:
            conn.execute("ALTER TABLE sync_deletions ADD COLUMN account_id TEXT")
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

        agent_existing = {row["name"] for row in conn.execute("PRAGMA table_info(agent_session_events)")}
        agent_optional_columns = {
            "tokens_in": "INTEGER",
            "tokens_out": "INTEGER",
            "tokens_cache_read": "INTEGER",
            "tokens_cache_write": "INTEGER",
            "cost_usd": "REAL",
        }
        for column, column_type in agent_optional_columns.items():
            if column not in agent_existing:
                conn.execute(f"ALTER TABLE agent_session_events ADD COLUMN {column} {column_type}")

    def _ensure_sync_schema(self, conn: sqlite3.Connection) -> None:
        ensure_received_deletion_schema(conn)
        # Local-only ownership and meaning for the classification currently
        # materialized on a received segment. These facts are deliberately
        # orthogonal: reverting a local review can restore a synced rule
        # snapshot while ownership remains the receiver user's local choice.
        # input_fingerprint is classifier input identity, not either fact (a
        # receiver-local AI review can legitimately retain ``sync:<segment_uid>``).
        provenance_table_existed = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' "
            "AND name = 'sync_classification_provenance'"
        ).fetchone() is not None
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_classification_provenance (
              segment_id INTEGER PRIMARY KEY
                REFERENCES activity_classifications(segment_id) ON DELETE CASCADE,
              provenance TEXT NOT NULL
                CHECK (provenance IN ('sync', 'local-protected', 'legacy')),
              rule_snapshot_kind TEXT
                CHECK (rule_snapshot_kind IS NULL OR rule_snapshot_kind = 'synced-rule'),
              CHECK (provenance != 'legacy' OR rule_snapshot_kind IS NULL)
            )
            """
        )
        if not provenance_table_existed:
            # The only published legacy schema has no side-state table. Its
            # manual/rule/AI rows are ambiguous, so retain them conservatively as
            # legacy and never invent received-rule meaning from historical labels.
            conn.execute(
                """
                INSERT OR IGNORE INTO sync_classification_provenance(
                    segment_id, provenance, rule_snapshot_kind
                )
                SELECT segment_id, 'legacy', NULL FROM activity_classifications
                """
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sync_deletions_account_pending
            ON sync_deletions(account_id, pushed, created_at)
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_segments_segment_uid
            ON activity_segments(segment_uid) WHERE segment_uid IS NOT NULL
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_activity_segments_sync_seq
            ON activity_segments(sync_seq)
            """
        )

        # Live recency follows local capture creation, even after wall-clock
        # correction. Skip imported/remote tails without scanning their rows.
        conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_activity_segments_local_live_id
            ON activity_segments(id DESC)
            WHERE origin_device_id IS NULL
              AND source != '{BROWSER_HISTORY_IMPORT_SOURCE}'
            """
        )

        # One-time backfill: give pre-sync rows a stable uid and seed sync_seq from the
        # rowid so the initial push walks history oldest-first. Runs before the triggers
        # are created so the seeding UPDATEs cannot race the counter.
        migrated = conn.execute(
            "SELECT value FROM tracker_meta WHERE key = 'sync_schema_v1'"
        ).fetchone()
        if not migrated:
            missing_uid_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM activity_segments WHERE segment_uid IS NULL"
                )
            ]
            for segment_id in missing_uid_ids:
                conn.execute(
                    "UPDATE activity_segments SET segment_uid = ? WHERE id = ?",
                    (str(uuid.uuid4()), segment_id),
                )
            conn.execute("UPDATE activity_segments SET sync_seq = id WHERE sync_seq = 0")
            conn.execute(
                """
                UPDATE sync_counter
                SET seq = MAX(seq, COALESCE((SELECT MAX(id) FROM activity_segments), 0))
                WHERE id = 1
                """
            )
            conn.execute(
                "INSERT OR REPLACE INTO tracker_meta(key, value) VALUES ('sync_schema_v1', 'done')"
            )

        # Change tracking for device sync: every content mutation stamps the segment with
        # a fresh monotonic sync_seq so the push outbox can resume from a cursor. The uid
        # COALESCE is a safety net for insert paths that predate uid generation; sync_seq
        # is deliberately absent from the UPDATE OF list so the trigger cannot re-fire
        # (recursive_triggers is also off by default).
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_activity_segments_sync_insert
            AFTER INSERT ON activity_segments
            BEGIN
              UPDATE sync_counter SET seq = seq + 1 WHERE id = 1;
              UPDATE activity_segments
                 SET sync_seq = (SELECT seq FROM sync_counter WHERE id = 1),
                     segment_uid = COALESCE(
                       segment_uid,
                       lower(
                         hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
                         substr(hex(randomblob(2)), 2) || '-' ||
                         substr('89ab', (abs(random()) % 4) + 1, 1) ||
                         substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
                       )
                     )
               WHERE id = NEW.id;
            END
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_activity_segments_sync_update
            AFTER UPDATE OF started_at, ended_at, duration_seconds, app_name, bundle_id,
              window_title, site_domain, site_title, site_url, youtube_video_id,
              youtube_playlist_id, youtube_is_shorts, browser_name, site_source, source,
              confidence
            ON activity_segments
            BEGIN
              UPDATE sync_counter SET seq = seq + 1 WHERE id = 1;
              UPDATE activity_segments
                 SET sync_seq = (SELECT seq FROM sync_counter WHERE id = 1)
               WHERE id = NEW.id;
            END
            """
        )
        # Classification changes re-push the owning segment so remote devices render
        # category/productivity colors without re-running the LLM.
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_activity_classifications_sync_insert
            AFTER INSERT ON activity_classifications
            BEGIN
              UPDATE sync_counter SET seq = seq + 1 WHERE id = 1;
              UPDATE activity_segments
                 SET sync_seq = (SELECT seq FROM sync_counter WHERE id = 1)
               WHERE id = NEW.segment_id;
            END
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_activity_classifications_sync_update
            AFTER UPDATE ON activity_classifications
            BEGIN
              UPDATE sync_counter SET seq = seq + 1 WHERE id = 1;
              UPDATE activity_segments
                 SET sync_seq = (SELECT seq FROM sync_counter WHERE id = 1)
               WHERE id = NEW.segment_id;
            END
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_activity_classifications_sync_delete
            AFTER DELETE ON activity_classifications
            BEGIN
              UPDATE sync_counter
                 SET seq = seq + 1
               WHERE id = 1
                 AND EXISTS (
                   SELECT 1 FROM activity_segments WHERE id = OLD.segment_id
                 );
              UPDATE activity_segments
                 SET sync_seq = (SELECT seq FROM sync_counter WHERE id = 1)
               WHERE id = OLD.segment_id;
            END
            """
        )

        # Protected local choices are explicit. Automatic writers deliberately
        # leave no side-state row, so an origin correction can replace them. Every
        # ordinary writer also clears remote rule meaning. Sync ingest and Revert
        # restore their deliberate state in the same SQLite transaction.
        for operation in ("INSERT", "UPDATE"):
            trigger_name = f"trg_activity_classifications_sync_origin_{operation.lower()}"
            conn.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
            conn.execute(
                f"""
                CREATE TRIGGER {trigger_name}
                AFTER {operation} ON activity_classifications
                BEGIN
                  DELETE FROM sync_classification_provenance
                   WHERE segment_id = NEW.segment_id;
                  INSERT INTO sync_classification_provenance(
                      segment_id, provenance, rule_snapshot_kind
                  )
                  SELECT NEW.segment_id, 'local-protected', NULL
                   WHERE NEW.source IN ('manual', 'ai_review')
                      OR (NEW.source = 'rule' AND NEW.classification_rule_id IS NOT NULL)
                  ON CONFLICT(segment_id) DO UPDATE SET
                      provenance = 'local-protected',
                      rule_snapshot_kind = NULL;
                END
                """
            )
        conn.execute("DROP TRIGGER IF EXISTS trg_activity_classifications_sync_origin_delete")
        conn.execute(
            """
            CREATE TRIGGER trg_activity_classifications_sync_origin_delete
            AFTER DELETE ON activity_classifications
            BEGIN
              DELETE FROM sync_classification_provenance
               WHERE segment_id = OLD.segment_id;
            END
            """
        )

    def _ensure_default_excluded_apps(self, conn: sqlite3.Connection) -> None:
        seeded = conn.execute("SELECT value FROM tracker_meta WHERE key = 'did_seed_default_secret_apps'").fetchone()
        if not seeded:
            now_iso = datetime.now(timezone.utc).isoformat()
            for rule in DEFAULT_EXCLUDED_APPS:
                conn.execute(
                    "INSERT OR IGNORE INTO excluded_apps(id, name, bundle_id, source, created_at) VALUES (?, ?, ?, ?, ?)",
                    (rule.id, rule.name, rule.bundle_id, rule.source, now_iso),
                )
            conn.execute(
                "INSERT OR REPLACE INTO tracker_meta(key, value) VALUES ('did_seed_default_secret_apps', '1')"
            )

    def _get_excluded_app_rules(self, conn: sqlite3.Connection) -> list[ExcludedAppRule]:
        rows = conn.execute("SELECT id, name, bundle_id, source FROM excluded_apps WHERE COALESCE(tombstone, 0) = 0").fetchall()
        return [
            ExcludedAppRule(
                id=row["id"],
                name=row["name"],
                bundle_id=row["bundle_id"],
                source=row["source"],
            )
            for row in rows
        ]

    def get_excluded_app_rules(self) -> list[ExcludedAppRule]:
        with self.connect() as conn:
            return self._get_excluded_app_rules(conn)

    def get_excluded_apps(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, name, bundle_id, source, created_at, tombstone, updated_at FROM excluded_apps WHERE COALESCE(tombstone, 0) = 0 ORDER BY created_at ASC"
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "bundleId": row["bundle_id"],
                    "source": row["source"],
                    "createdAt": row["created_at"],
                    "kind": _excluded_rule_kind(row["id"]),
                }
                for row in rows
            ]

    def save_excluded_app(self, id: str, name: str, bundle_id: str | None = None, source: str = "user") -> dict[str, Any]:
        if id.startswith(SITE_RULE_PREFIX):
            domain = normalize_excluded_site(id[len(SITE_RULE_PREFIX):])
            if not domain:
                raise ValueError("Enter a site address such as example.com.")
            id, name, bundle_id = SITE_RULE_PREFIX + domain, domain, None
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO excluded_apps(id, name, bundle_id, source, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    bundle_id = excluded.bundle_id,
                    source = excluded.source,
                    tombstone = 0,
                    updated_at = excluded.created_at
                """,
                (id, name, bundle_id, source, now_iso),
            )
        return {"id": id, "name": name, "bundleId": bundle_id, "source": source, "createdAt": now_iso, "kind": _excluded_rule_kind(id)}

    def delete_excluded_app(self, id: str) -> bool:
        with self.connect() as conn:
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor = conn.execute(
                "UPDATE excluded_apps SET tombstone = 1, updated_at = ? WHERE id = ? AND COALESCE(tombstone, 0) = 0",
                (now_iso, id),
            )
            return cursor.rowcount > 0

    def list_excluded_app_records(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, name, bundle_id, source, created_at, tombstone, updated_at FROM excluded_apps"
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "bundleId": row["bundle_id"],
                    "source": row["source"],
                    "createdAt": row["created_at"],
                    "tombstone": bool(row["tombstone"]),
                    "updatedAt": row["updated_at"] or row["created_at"],
                    "kind": _excluded_rule_kind(row["id"]),
                }
                for row in rows
            ]

    def apply_excluded_app_record(self, record: dict[str, Any]) -> None:
        now_iso = record.get("updatedAt") or datetime.now(timezone.utc).isoformat()
        tombstone = 1 if record.get("tombstone") else 0
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO excluded_apps(id, name, bundle_id, source, created_at, tombstone, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    bundle_id = excluded.bundle_id,
                    source = excluded.source,
                    tombstone = excluded.tombstone,
                    updated_at = excluded.updated_at
                WHERE excluded.updated_at >= COALESCE(excluded_apps.updated_at, excluded_apps.created_at)
                """,
                (
                    record["id"],
                    record["name"],
                    record.get("bundleId"),
                    record.get("source") or "user",
                    now_iso,
                    tombstone,
                    now_iso,
                ),
            )

    def get_excluded_app_history_count(self, name: str, bundle_id: str | None = None, site_domain: str | None = None) -> int:
        with self.connect() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) as count FROM activity_segments WHERE {self._excluded_app_history_predicate(bundle_id, site_domain)}",
                self._excluded_app_history_params(name, bundle_id, site_domain),
            ).fetchone()
            return int(row["count"]) if row else 0

    def delete_excluded_app_history(self, name: str, bundle_id: str | None = None, site_domain: str | None = None) -> int:
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT id FROM activity_segments WHERE {self._excluded_app_history_predicate(bundle_id, site_domain)}",
                self._excluded_app_history_params(name, bundle_id, site_domain),
            ).fetchall()
        segment_ids = [str(row["id"]) for row in rows]
        if not segment_ids:
            return 0
        return self.delete_activity_segments(segment_ids)

    @staticmethod
    def _excluded_app_history_predicate(bundle_id: str | None, site_domain: str | None = None) -> str:
        if normalize_excluded_site(site_domain):
            # The site itself and its subdomains, however the browser named the host.
            return "lower(trim(site_domain, '.')) = ? OR lower(trim(site_domain, '.')) LIKE ? ESCAPE '\\'"
        if bundle_id:
            return "lower(bundle_id) = lower(?) OR lower(app_name) = lower(?)"
        return "lower(app_name) = lower(?)"

    @staticmethod
    def _excluded_app_history_params(name: str, bundle_id: str | None, site_domain: str | None = None) -> tuple[str, ...]:
        domain = normalize_excluded_site(site_domain)
        if domain:
            escaped = domain.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            return (domain, "%." + escaped)
        if bundle_id:
            return (bundle_id, name)
        return (name,)

    def get_recent_apps(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    app_name,
                    bundle_id,
                    MAX(ended_at) AS last_seen_at,
                    SUM(duration_seconds) AS total_seconds
                FROM activity_segments
                WHERE app_name != '[Redacted]' AND app_name IS NOT NULL AND app_name != ''
                GROUP BY app_name, bundle_id
                ORDER BY last_seen_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [
                {
                    "name": row["app_name"],
                    "bundleId": row["bundle_id"],
                    "lastSeenAt": row["last_seen_at"],
                    "totalSeconds": int(row["total_seconds"] or 0),
                }
                for row in rows
            ]

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

    @staticmethod
    def _youtube_metadata_write_is_allowed(
        conn: sqlite3.Connection, video_id: str, require_activity_reference: bool,
    ) -> bool:
        if not require_activity_reference:
            return True
        # The reference check and metadata write share one write transaction.
        # A concurrent deletion cannot commit between them.
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        return conn.execute(
            "SELECT 1 FROM activity_segments WHERE youtube_video_id = ? LIMIT 1",
            (video_id,),
        ).fetchone() is not None

    def save_youtube_metadata(
        self, metadata: YouTubeVideoMetadata, *, require_activity_reference: bool = False,
    ) -> None:
        fetched_at = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            if not self._youtube_metadata_write_is_allowed(conn, metadata.video_id, require_activity_reference):
                return
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

    def save_youtube_metadata_failure(
        self, video_id: str, *, require_activity_reference: bool = False,
    ) -> None:
        now = datetime.now(timezone.utc)
        failed_at = now.isoformat()
        with self.connect() as conn:
            if not self._youtube_metadata_write_is_allowed(conn, video_id, require_activity_reference):
                return
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

    def record_snapshot(
        self, snapshot: Snapshot, sample_seconds: int, max_merge_gap_seconds: int | None = None,
        *, unmergeable_segment_uids: frozenset[str] = frozenset(),
    ) -> CaptureMutation:
        # SQLite rejects the whole row for one unpaired UTF-16 surrogate, such as
        # an emoji half left by a truncated Windows title (DRIFTY-MAC-NATIVE-16).
        snapshot = without_lone_surrogates(snapshot)
        with self.connect() as conn:
            if not conn.in_transaction:
                # The before/after journal must describe one serialized capture
                # mutation, not a row another process replaced after our read.
                conn.execute("BEGIN IMMEDIATE")
            excluded_rules = self._get_excluded_app_rules(conn)
            match = match_exclusion(snapshot.app_name, snapshot.bundle_id, snapshot.site_domain, snapshot.site_url, excluded_rules)
            if match:
                snapshot = redact_snapshot(snapshot, match.source)

            # Only coalesce live, locally-originated segments. Imported history
            # describes the past, and synced segments describe another device's
            # timeline; neither may absorb a new local capture interval.
            # The last capture is the newest inserted live row, not the greatest
            # wall time: an older row can end in the future after clock rollback.
            last = conn.execute(
                """
                SELECT * FROM activity_segments
                WHERE origin_device_id IS NULL
                  AND source != ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (BROWSER_HISTORY_IMPORT_SOURCE,),
            ).fetchone()

            # A matching display name/title does not establish app identity.
            # Do not rewrite an earlier device/platform or unidentified app
            # interval with the identity and page fields of a later capture.
            same_capture_identity = bool(
                last
                and last["platform"] == CAPTURE_PLATFORM
                and last["bundle_id"] == snapshot.bundle_id
            )
            last_site_fields_empty = bool(
                last
                and same_capture_identity
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
            snapshot_engagement_evidence = snapshot.engagement_evidence
            last_engagement_evidence = last["engagement_evidence"] if last else None
            same_engagement_evidence = last_engagement_evidence == snapshot_engagement_evidence
            def browser_clues(context):
                normalized = normalize_browser_context(context)
                return {k: v for k, v in normalized.items() if k in {"description", "headings", "visibleTopic"}} if normalized else None
            same_browser_clues = (browser_clues(self._raw_context_dict(last["raw_context_json"]).get("browser_content_context"))
                                  == browser_clues(snapshot.browser_content_context)) if last else False
            exact_context_match = (
                last
                and same_capture_identity
                and same_engagement_evidence
                and same_browser_clues
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
                and last["segment_uid"] not in unmergeable_segment_uids
                and (exact_context_match or (history_enrichment and same_engagement_evidence))
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
                        engagement_evidence = ?,
                        raw_context_json = ?,
                        exclusion_source = ?
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
                        snapshot_engagement_evidence,
                        self._snapshot_raw_context_json(snapshot),
                        snapshot.exclusion_source,
                        last["id"],
                    ),
                )
                after = conn.execute("SELECT * FROM activity_segments WHERE id = ?", (last["id"],)).fetchone()
                return CaptureMutation(CaptureTiming.from_row(last), CaptureTiming.from_row(after), sample_seconds,
                                       after["youtube_video_id"], after["site_url"])

            cursor = conn.execute(
                """
                INSERT INTO activity_segments (
                    segment_uid,
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
                    engagement_evidence,
                    raw_context_json,
                    exclusion_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
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
                    CAPTURE_PLATFORM,
                    snapshot.source,
                    getattr(snapshot, "capture_confidence", 1.0),
                    snapshot_engagement_evidence,
                    self._snapshot_raw_context_json(snapshot),
                    snapshot.exclusion_source,
                ),
            )
            after = conn.execute("SELECT * FROM activity_segments WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return CaptureMutation(None, CaptureTiming.from_row(after), sample_seconds,
                                   after["youtube_video_id"], after["site_url"])

    def latest_local_engagement_evidence(self) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT engagement_evidence
                FROM activity_segments
                WHERE origin_device_id IS NULL
                  AND source != ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (BROWSER_HISTORY_IMPORT_SOURCE,),
            ).fetchone()
        if row is None:
            return None
        value = row["engagement_evidence"]
        return value if value == "foreground-audio" else None

    def trim_captured_segments(self, trims: list[CaptureTrim]) -> None:
        """Reconcile only rows observed in this run, if their timing is unchanged."""
        deletions = {}
        with self.connect() as conn:
            for trim in trims:
                expected = trim.expected
                if trim.target is None:
                    deletions[expected.segment_id] = expected
                    continue
                target = trim.target
                conn.execute(
                    """
                    UPDATE activity_segments SET ended_at = ?, duration_seconds = ?
                    WHERE id = ? AND segment_uid = ? AND started_at = ?
                      AND ended_at = ? AND duration_seconds = ?
                      AND origin_device_id IS NULL AND source != ?
                    """,
                    (target.ended_at, target.duration_seconds, expected.segment_id,
                     expected.segment_uid, expected.started_at, expected.ended_at,
                     expected.duration_seconds, BROWSER_HISTORY_IMPORT_SOURCE),
                )
        if deletions:
            self.delete_activity_segments([str(segment_id) for segment_id in deletions],
                                          expected_capture_timings=deletions)

    def backfill_recent_browser_history_context(
        self,
        resolve_browser_history: BrowserHistoryResolver,
        is_retryable_window_title: BrowserHistoryTitlePolicy,
        config: BrowserHistoryBackfillConfig,
    ) -> list[BrowserHistoryBackfillResult]:
        observed_at_seconds = self._timestamp_seconds(config.observed_at)
        # Bound the scan in SQL so the per-tick daemon query only touches rows
        # inside the backfill window (the expression index on datetime(ended_at)
        # applies) instead of scanning the 100 most recent context-less rows of
        # all time and discarding the stale ones in Python.
        # Legacy Windows title misses may remain after an upgrade. Their saved
        # platform/capture source must prevent History from inventing a URL,
        # including when a mixed database is opened by a Mac tracker. Exclude
        # them before LIMIT so they cannot crowd out eligible Mac captures.
        backfill_cutoff = datetime.fromtimestamp(
            observed_at_seconds - config.max_age_seconds, tz=timezone.utc
        ).isoformat()
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM activity_segments
                WHERE site_domain IS NULL
                  AND platform != 'windows'
                  AND source NOT IN ('win32-foreground', 'win32-foreground-untitled')
                  AND site_title IS NULL
                  AND site_url IS NULL
                  AND youtube_video_id IS NULL
                  AND youtube_playlist_id IS NULL
                  AND youtube_is_shorts IS NULL
                  AND window_title IS NOT NULL
                  AND datetime(ended_at) >= datetime(?)
                ORDER BY datetime(ended_at) DESC, id DESC
                LIMIT 100
                """,
                (backfill_cutoff,),
            ).fetchall()

        # History resolution may copy/read another application's database. Do
        # all of it before the first UPDATE so a slow lookup cannot hold our
        # writer reservation and block capture or serve-process classification.
        # Staging the complete batch also preserves rollback on resolver errors.
        pending: list[tuple[sqlite3.Row, BrowserMetadata, str]] = []
        confidence = 0.45
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
            pending.append((
                row, metadata,
                self._backfilled_raw_context_json(raw_context, metadata, confidence, config.observed_at),
            ))

        results: list[BrowserHistoryBackfillResult] = []
        if not pending:
            return results
        with self.connect() as conn:
            for row, metadata, raw_context_json in pending:
                segment_id = int(row["id"])
                # Capture, sync, deletion or enrichment may have changed this
                # snapshot during the lookups. Check its input and the context
                # we replace atomically with the UPDATE; a skipped row can be
                # considered again on the next tick with its current contents.
                cursor = conn.execute(
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
                      AND started_at IS ?
                      AND ended_at IS ?
                      AND duration_seconds IS ?
                      AND app_name IS ?
                      AND bundle_id IS ?
                      AND window_title IS ?
                      AND platform IS ?
                      AND source IS ?
                      AND browser_name IS ?
                      AND site_source IS ?
                      AND confidence IS ?
                      AND raw_context_json IS ?
                      AND site_domain IS NULL
                      AND site_title IS NULL
                      AND site_url IS NULL
                      AND youtube_video_id IS NULL
                      AND youtube_playlist_id IS NULL
                      AND youtube_is_shorts IS NULL
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
                        raw_context_json,
                        segment_id,
                        row["started_at"],
                        row["ended_at"],
                        row["duration_seconds"],
                        row["app_name"],
                        row["bundle_id"],
                        row["window_title"],
                        row["platform"],
                        row["source"],
                        row["browser_name"],
                        row["site_source"],
                        row["confidence"],
                        row["raw_context_json"],
                    ),
                )
                if not cursor.rowcount:
                    continue
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
            # Imported history segments describe the past, not the live session, and
            # segments pulled from another synced device describe that device's timeline;
            # idle/power trims must never truncate or delete either.
            # Trim the current capture, including a new epoch after clock rollback.
            last = conn.execute(
                """
                SELECT * FROM activity_segments
                WHERE source != ?
                  AND origin_device_id IS NULL
                ORDER BY id DESC
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
            collapse_id = last["id"] if duration_seconds <= 0 else None

            if collapse_id is None:
                conn.execute(
                    """
                    UPDATE activity_segments
                    SET ended_at = ?, duration_seconds = ?
                    WHERE id = ?
                    """,
                    (ended_at, duration_seconds, last["id"]),
                )

        if collapse_id is not None:
            # A trim that erases a segment is still a permanent deletion: it must
            # invalidate recovery copies and, when the segment already synced,
            # leave a tombstone so other devices drop it too.
            self.delete_activity_segments([str(collapse_id)])

    def insert_segment(self, segment: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO activity_segments (
                    segment_uid,
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
                    engagement_evidence,
                    raw_context_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    segment.get("segment_uid") or str(uuid.uuid4()),
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
                    segment.get("engagement_evidence"),
                    sanitized_raw_context_json(segment.get("raw_context_json")),
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
            overlap_index = self._browser_history_import_overlap_index(conn, segments)
            excluded_rules = self._get_excluded_app_rules(conn)
            for segment in segments:
                # Imported browsing honors the same exclusions as live capture;
                # an excluded app or site never enters history this way either.
                if match_exclusion(segment.app_name, segment.bundle_id, segment.site_domain, segment.site_url, excluded_rules):
                    continue
                # A re-run can regroup visits into a session with a new import key
                # (e.g. the session gained a visit), and imports can cover time the
                # live tracker already recorded. Skip any segment whose
                # [started_at, ended_at) range overlaps an existing segment so
                # imported time is never double-counted. Remote-device segments are
                # exempt: another Mac being active at the same time does not make this
                # Mac's imported browsing a duplicate.
                overlapping = conn.execute(
                    f"""
                    SELECT 1 FROM activity_segments INDEXED BY {overlap_index}
                    WHERE datetime(started_at) < datetime(?)
                      AND datetime(ended_at) > datetime(?)
                      AND origin_device_id IS NULL
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
                        segment_uid,
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
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
                        sanitized_raw_context_json(segment.raw_context_json),
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

    def _browser_history_import_overlap_index(
        self, conn: sqlite3.Connection, segments: list[ImportedActivitySegment],
    ) -> str:
        # SQLite normally picks the ended-at range for the two-sided overlap
        # predicate. Importing older history then visits every later record for
        # each segment, holding the import's write lock across those repeated
        # scans. Compare the batch's two indexed ranges once, before any write,
        # and keep the exact overlap predicate and one atomic import transaction.
        # Count remote rows too: these indexes must scan them before the overlap
        # predicate can discard them. Counting only local matches can choose a
        # range full of remote records instead of the cheaper opposite range.
        # These indexes are created by _init_db for both new and existing DBs.
        if not segments:
            return "idx_activity_segments_ended_at"
        latest_end = max(self._normalize_range_bound(segment.ended_at) for segment in segments)
        earliest_start = min(self._normalize_range_bound(segment.started_at) for segment in segments)
        candidates = conn.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM activity_segments INDEXED BY idx_activity_segments_started_at
                 WHERE datetime(started_at) < datetime(?)) AS started,
                (SELECT COUNT(*) FROM activity_segments INDEXED BY idx_activity_segments_ended_at
                 WHERE datetime(ended_at) > datetime(?)) AS ended
            """,
            (latest_end, earliest_start),
        ).fetchone()
        return ("idx_activity_segments_started_at" if candidates["started"] < candidates["ended"]
                else "idx_activity_segments_ended_at")

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
        *,
        strict_start: bool = False,
    ) -> str:
        started_at = f"{table_name}.started_at" if table_name else "started_at"
        ended_at = f"{table_name}.ended_at" if table_name else "ended_at"
        if start:
            query += f" AND datetime({ended_at}) >= datetime(?)"
            params.append(TrackerDatabase._normalize_range_bound(start))
            if strict_start:
                query += f" AND history_ends_after({ended_at}, ?)"
                params.append(TrackerDatabase._normalize_range_bound(start))
        if end:
            query += f" AND datetime({started_at}) <= datetime(?)"
            params.append(TrackerDatabase._normalize_range_bound(end))
        return query

    @staticmethod
    def _sampled_effective_end_sql(table_name: str | None = None) -> str:
        """SQL equivalent of the domain's sampledActivityTimeBounds end.

        Keep raw timestamps and recorded duration unchanged. Only valid positive
        samples expand. Other rows retain the legacy raw-end read predicate,
        including exclusion of malformed ends from bounded reads, so paged and
        full reads keep the same identities. Exclusion/failed-capture policy
        remains a consumer concern.
        """
        started_at = f"{table_name}.started_at" if table_name else "started_at"
        ended_at = f"{table_name}.ended_at" if table_name else "ended_at"
        duration_seconds = f"{table_name}.duration_seconds" if table_name else "duration_seconds"
        return f"""
            CASE
              WHEN julianday({started_at}) IS NOT NULL
                AND julianday({ended_at}) IS NOT NULL
                AND julianday({ended_at}) >= julianday({started_at})
                AND {duration_seconds} > 0
              THEN max(
                julianday({ended_at}),
                julianday({started_at}) + {duration_seconds} / 86400.0
              )
              ELSE julianday({ended_at})
            END
        """

    @staticmethod
    def _append_timeline_overlap_filters(
        query: str,
        params: list[Any],
        start: str | None,
        end: str | None,
        table_name: str | None = None,
    ) -> str:
        """Append inclusive query bounds for timeline rows.

        Tracker range DTOs are second-precision and inclusive. Consumers clip
        the returned rows to their exact half-open logical window. The effective
        end predicate is deliberately limited to timeline row reads; aggregate
        SQL endpoints keep their established timestamp contract.
        """
        started_at = f"{table_name}.started_at" if table_name else "started_at"
        if start:
            query += f" AND ({TrackerDatabase._sampled_effective_end_sql(table_name)}) >= julianday(?)"
            params.append(TrackerDatabase._normalize_range_bound(start))
        if end:
            # Range DTO ends are inclusive and second-precision. Keep the
            # established datetime() comparison so 23:59:59.500 belongs to
            # the 23:59:59 final query second as well as any forward sample
            # overlap in the following window.
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

    def fetch_unclassified_segments(
        self,
        start: str | None = None,
        end: str | None = None,
        limit: int = 50,
        segment_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
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
              AND activity_segments.origin_device_id IS NULL
        """
        params: list[Any] = []
        query = self._append_overlap_filters(query, params, start, end)
        if segment_ids is not None:
            placeholders = ", ".join("?" for _ in segment_ids)
            query += f" AND CAST(activity_segments.id AS TEXT) IN ({placeholders})"
            params.extend(sorted(segment_ids))
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
                FROM classification_rules
                ORDER BY target_kind ASC, target_value ASC, match_scope ASC, detail_value ASC
                """
            ).fetchall()
        return [self._serialize_rule(row) for row in rows]

    @classmethod
    def _classification_rule_sync_key(cls, rule: Any) -> str:
        """The rule's unique key as a stable hash, so devices that sync agree on one rule.

        Two devices that each save a rule for the same app or site (and the
        same title or address) store one rule under the table's unique key;
        device sync keys the account's row by this hash of it.
        """
        return hashlib.sha256("".join(cls._classification_rule_key(rule)).encode("utf-8")).hexdigest()

    def _classification_rule_identity(self, target_kind: str, rule_input: dict[str, Any]) -> dict[str, Any]:
        """The normalized fields that identify a rule, shared by save and preview."""
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

        return {
            "target_kind": target_kind,
            "target_value": normalized_target_value if target_kind == "site" else raw_target_value,
            "normalized_target_value": normalized_target_value,
            "match_scope": match_scope,
            "detail_kind": detail_kind,
            "detail_value": detail_value,
            "normalized_detail_value": normalized_detail_value,
        }

    @staticmethod
    def _classification_rule_key(rule: Any) -> tuple[str, str, str, str, str]:
        """The rule's unique key, as the classification_rules table enforces it."""
        return (
            rule["target_kind"],
            rule["normalized_target_value"],
            rule["match_scope"],
            rule["detail_kind"] or "",
            rule["normalized_detail_value"] or "",
        )

    def preview_classification_rule(self, rule_input: dict[str, Any]) -> dict[str, Any]:
        """How many captured records saving this rule would apply to, without writing.

        The candidate takes the place a newly saved rule takes: it replaces an
        enabled rule with the same key and, being the newest, comes first among
        rules of its scope, so detail rules keep their records from a whole-app
        or whole-site rule. Manual classifications are counted apart because
        apply_classification_rules never overwrites them, so matchedCount is
        exactly the number of records the rule holds once saved and applied.
        Applying re-runs every enabled rule, so its appliedCount also counts
        records other rules hold; asked again after applying, this still
        answers for the one rule.
        """
        target_kind = str(rule_input.get("targetKind", rule_input.get("target_kind", ""))).strip()
        if target_kind not in VALID_RULE_TARGET_KINDS:
            raise ValueError("targetKind must be 'site' or 'app'")
        candidate = {
            "id": "preview",
            **self._classification_rule_identity(target_kind, rule_input),
            "category": None,
            "productivity": None,
            "confidence": None,
        }
        candidate_key = self._classification_rule_key(candidate)

        with self.connect() as conn:
            existing = [
                rule for rule in self._enabled_classification_rules(conn)
                if self._classification_rule_key(rule) != candidate_key
            ]
            rows = conn.execute(
                """
                    SELECT
                        segment.id,
                        segment.app_name,
                        segment.bundle_id,
                        segment.site_domain,
                        segment.site_url,
                        segment.site_title,
                        segment.window_title,
                        segment.duration_seconds,
                        video.title AS youtube_title,
                        classification.source AS stored_source
                    FROM activity_segments AS segment
                    LEFT JOIN youtube_video_metadata AS video ON video.video_id = segment.youtube_video_id
                    LEFT JOIN activity_classifications AS classification ON classification.segment_id = segment.id
                """
            ).fetchall()

        detail_rules = [rule for rule in existing if rule["match_scope"] == "detail"]
        surface_rules = [rule for rule in existing if rule["match_scope"] != "detail"]
        ordered = (
            [candidate, *detail_rules, *surface_rules]
            if candidate["match_scope"] == "detail"
            else [*detail_rules, candidate, *surface_rules]
        )

        # Surface matching depends only on these captured values. Cache, per
        # surface, the ordered rules that match it (none when the candidate
        # does not), so most records are ruled out by one lookup and only
        # detail rules are checked per record.
        missing = object()
        surface_rules_by_key: dict[tuple[str | None, str | None, str | None], list[Any] | None] = {}
        matched_count = 0
        matched_seconds = 0.0
        manual_count = 0
        for segment in rows:
            surface_key = (
                segment["site_domain"] or segment["site_url"],
                segment["bundle_id"], segment["app_name"],
            )
            candidates = surface_rules_by_key.get(surface_key, missing)
            if candidates is missing:
                normalized: dict[str, str] = {}
                candidates = (
                    [rule for rule in ordered if self._rule_surface_matches(segment, rule, normalized)]
                    if self._rule_surface_matches(segment, candidate, normalized)
                    else None
                )
                if len(surface_rules_by_key) < 20_000:
                    surface_rules_by_key[surface_key] = candidates
            if candidates is None or self._first_detail_match(segment, candidates, {}) is not candidate:
                continue
            if segment["stored_source"] == "manual":
                manual_count += 1
                continue
            matched_count += 1
            matched_seconds += float(segment["duration_seconds"] or 0)

        return {"matchedCount": matched_count, "matchedSeconds": matched_seconds, "manualCount": manual_count}

    def save_classification_rule(self, rule_input: dict[str, Any], *, _conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        target_kind = str(rule_input.get("targetKind", rule_input.get("target_kind", ""))).strip()
        if target_kind not in VALID_RULE_TARGET_KINDS:
            raise ValueError("targetKind must be 'site' or 'app'")

        # Old IPv6 exact-URL rows lost their brackets. Permit an unchanged
        # row to be disabled without guessing its ambiguous host/port spelling.
        existing_id = rule_input.get("id")
        if existing_id and rule_input.get("enabled") is False:
            with self._definition_connection(_conn) as conn:
                existing = conn.execute("SELECT * FROM classification_rules WHERE id = ?", (str(existing_id),)).fetchone()
                if existing and existing["target_kind"] == "site" and ":" in existing["target_value"]:
                    serialized = self._serialize_rule(existing)
                    fields = ("targetKind", "targetValue", "matchScope", "detailKind", "detailValue", "category", "productivity", "confidence")
                    if all(rule_input.get(key) == serialized[key] for key in fields):
                        conn.execute("UPDATE classification_rules SET enabled = 0, updated_at = ? WHERE id = ?", (datetime.now(timezone.utc).isoformat(), str(existing_id)))
                        conn.execute("DELETE FROM activity_classifications WHERE source = 'rule' AND classification_rule_id = ?", (str(existing_id),))
                        return self._serialize_rule(conn.execute("SELECT * FROM classification_rules WHERE id = ?", (str(existing_id),)).fetchone())

        identity = self._classification_rule_identity(target_kind, rule_input)
        target_value = identity["target_value"]
        normalized_target_value = identity["normalized_target_value"]
        match_scope = identity["match_scope"]
        detail_kind = identity["detail_kind"]
        detail_value = identity["detail_value"]
        normalized_detail_value = identity["normalized_detail_value"]
        category = str(rule_input["category"])
        productivity = str(rule_input["productivity"])
        enabled = 1 if rule_input.get("enabled", True) else 0
        confidence = rule_input.get("confidence")
        if confidence is not None:
            confidence = float(confidence)
        timestamp = datetime.now(timezone.utc).isoformat()
        rule_id = str(rule_input.get("id") or uuid.uuid4())

        with self._definition_connection(_conn) as conn:
            if existing_id and target_kind == "site" and normalized_target_value.startswith("[") and conn.execute("SELECT 1 FROM classification_rules WHERE id = ?", (rule_id,)).fetchone():
                # Re-normalizing a repaired IPv6 URL changes its unique key.
                # Update the existing identity instead of inserting that id again.
                conn.execute(
                    """UPDATE classification_rules SET target_kind = ?, target_value = ?, normalized_target_value = ?,
                    match_scope = ?, detail_kind = ?, detail_value = ?, normalized_detail_value = ?,
                    category = ?, productivity = ?, enabled = ?, confidence = ?, updated_at = ? WHERE id = ?""",
                    (target_kind, target_value, normalized_target_value, match_scope, detail_kind, detail_value,
                     normalized_detail_value, category, productivity, enabled, confidence, timestamp, rule_id),
                )
            else:
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

    def delete_classification_rule(self, rule_id: str, *, _conn: sqlite3.Connection | None = None) -> int:
        with self._definition_connection(_conn) as conn:
            conn.execute(
                "DELETE FROM activity_classifications WHERE source = 'rule' AND classification_rule_id = ?",
                (rule_id,),
            )
            cursor = conn.execute("DELETE FROM classification_rules WHERE id = ?", (rule_id,))
            return cursor.rowcount

    @staticmethod
    def _record_sync_deletion(
        conn: sqlite3.Connection,
        kind: str,
        range_start: str | None = None,
        range_end: str | None = None,
        segment_uids: list[str] | None = None,
    ) -> None:
        account_row = conn.execute(
            "SELECT value FROM tracker_meta WHERE key = 'sync_account_id'"
        ).fetchone()
        account_id = account_row["value"] if account_row and account_row["value"] else None
        # A single tombstone must stay small enough to travel: the receiving
        # device re-queries its uids with SQLite's bound-variable limit, and the
        # row itself is pushed through PostgREST. Whole-app history purges can
        # produce tens of thousands of uids, so one row per batch.
        uid_chunks: list[list[str] | None] = (
            [segment_uids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
             for start in range(0, len(segment_uids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE)]
            if segment_uids
            else [None]
        )
        created_at = datetime.now(timezone.utc).isoformat()
        if kind == "range" and range_end is None:
            # "Delete history" is a snapshot through deletion time, not a ban
            # on future capture. Send the finite bound to older servers too.
            range_end = created_at
        for uid_chunk in uid_chunks:
            conn.execute(
                """
                INSERT INTO sync_deletions (
                    deletion_uid, account_id, kind, range_start, range_end, segment_uids_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    account_id,
                    kind,
                    range_start,
                    range_end,
                    json.dumps(uid_chunk) if uid_chunk is not None else None,
                    created_at,
                ),
            )

    @staticmethod
    def _delete_project_windows_for_segment_ids(
        conn: sqlite3.Connection, segment_ids: set[str]
    ) -> None:
        if not segment_ids:
            return
        rows = conn.execute(
            "SELECT window_started_at, segment_overlaps_json FROM project_window_assignments"
        ).fetchall()
        starts_to_delete: list[str] = []
        for row in rows:
            try:
                overlaps = json.loads(row["segment_overlaps_json"])
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(overlaps, list) and any(
                isinstance(overlap, dict)
                and str(overlap.get("segmentId", "")) in segment_ids
                for overlap in overlaps
            ):
                starts_to_delete.append(row["window_started_at"])
        for start in range(0, len(starts_to_delete), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
            batch = starts_to_delete[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
            placeholders = ",".join("?" for _ in batch)
            conn.execute(
                f"DELETE FROM project_window_assignments WHERE window_started_at IN ({placeholders})",
                batch,
            )

    def delete_activity_segments(
        self,
        segment_ids: list[str],
        record_tombstone: bool = True,
        *,
        refresh_recovery_backup: bool = True,
        expected_capture_timings: dict[int, CaptureTiming] | None = None,
        _claim_sync_deletion: Callable[[sqlite3.Connection], tuple[bool, bool]] | None = None,
        _sync_segment_uids: list[str] | None = None,
    ) -> int:
        normalized_ids = sorted({
            int(segment_id)
            for segment_id in segment_ids
            if segment_id.strip().isdecimal()
        })
        if not normalized_ids and _sync_segment_uids is None:
            return 0

        with permanent_deletion_guard(
            self.db_path,
            self.connect(),
            on_backup_error=self._record_post_delete_backup_error,
            refresh_backup=refresh_recovery_backup,
        ) as invalidate_recovery_copies:
            with self.connect() as conn:
                if not conn.in_transaction:
                    # Targets, associated metadata and optional capture validation
                    # must share the deletion's write transaction. A SELECT alone
                    # would let daemon writers change those references before the
                    # first DELETE acquires SQLite's write lock.
                    conn.execute("BEGIN IMMEDIATE")
                remote_only = False
                if _claim_sync_deletion is not None:
                    proceed, remote_only = _claim_sync_deletion(conn)
                    if not proceed:
                        return 0
                    # Even an absent UID installs a durable receive barrier.
                    # Recovery must not fall back to a copy that predates it.
                    invalidate_recovery_copies()
                if _sync_segment_uids is not None:
                    # Resolve UID targets after taking the same write lock as
                    # the tombstone. A previously empty lookup cannot race a
                    # late page into a permanently applied-but-ineffective delete.
                    normalized_ids = []
                    for start in range(0, len(_sync_segment_uids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                        batch = _sync_segment_uids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                        placeholders = ",".join("?" for _ in batch)
                        query = f"SELECT id FROM activity_segments WHERE segment_uid IN ({placeholders})"
                        if remote_only:
                            query += " AND origin_device_id IS NOT NULL"
                        normalized_ids.extend(row[0] for row in conn.execute(query, tuple(batch)))
                rows: list[sqlite3.Row] = []
                columns = "*" if expected_capture_timings is not None else "id, segment_uid, youtube_video_id"
                for start in range(0, len(normalized_ids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                    batch = normalized_ids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                    placeholders = ",".join("?" for _ in batch)
                    rows.extend(
                        conn.execute(
                            f"SELECT {columns} FROM activity_segments WHERE id IN ({placeholders})",
                            tuple(batch),
                        ).fetchall()
                    )
                if expected_capture_timings is not None:
                    rows = [row for row in rows
                            if row["origin_device_id"] is None
                            and row["source"] != BROWSER_HISTORY_IMPORT_SOURCE
                            and CaptureTiming.from_row(row) == expected_capture_timings.get(row["id"])]
                    normalized_ids = [int(row["id"]) for row in rows]
                if not rows:
                    return 0

                # Remove recovery copies before the transaction mutates the live
                # database. If invalidation fails, the transaction never deletes.
                invalidate_recovery_copies()
                self._delete_project_windows_for_segment_ids(
                    conn, {str(row["id"]) for row in rows}
                )
                deleted = 0
                for start in range(0, len(normalized_ids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                    batch = normalized_ids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                    placeholders = ",".join("?" for _ in batch)
                    cursor = conn.execute(
                        f"DELETE FROM activity_segments WHERE id IN ({placeholders})",
                        tuple(batch),
                    )
                    deleted += cursor.rowcount
                # Only prune metadata associated with these removed segments.
                # Other retained cache rows and videos still referenced survive.
                video_ids = sorted({row["youtube_video_id"] for row in rows if row["youtube_video_id"]})
                for start in range(0, len(video_ids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                    batch = video_ids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                    placeholders = ",".join("?" for _ in batch)
                    conn.execute(
                        f"DELETE FROM youtube_video_metadata WHERE video_id IN ({placeholders}) "
                        "AND video_id NOT IN (SELECT youtube_video_id FROM activity_segments "
                        "WHERE youtube_video_id IS NOT NULL)",
                        tuple(batch),
                    )
                deleted_uids = [
                    row["segment_uid"] for row in rows if row["segment_uid"] is not None
                ]
                if record_tombstone and deleted_uids:
                    self._record_sync_deletion(conn, "uids", segment_uids=deleted_uids)
                return deleted

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
        record_tombstone: bool = True,
        *,
        refresh_recovery_backup: bool = True,
        _claim_sync_deletion: Callable[[sqlite3.Connection], tuple[bool, bool]] | None = None,
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
            strict_start=True,
        )
        segment_video_params: list[Any] = []
        segment_video_subquery = self._append_overlap_filters(
            "SELECT youtube_video_id FROM activity_segments WHERE youtube_video_id IS NOT NULL",
            segment_video_params,
            start_bound,
            end_bound,
            strict_start=True,
        )

        activity_segments = 0
        classifications = 0
        youtube_metadata = 0

        def inspect_and_delete(invalidate_recovery_copies: Callable[[], None]) -> None:
            nonlocal activity_segments, classifications, youtube_metadata
            with self.connect() as conn:
                if not dry_run and not conn.in_transaction:
                    # Counts, recovery invalidation, deletes and the sync tombstone
                    # must describe one snapshot while daemon/provider writers wait.
                    conn.execute("BEGIN IMMEDIATE")
                remote_only = False
                deletion_subquery = segment_subquery
                if not dry_run and _claim_sync_deletion is not None:
                    proceed, remote_only = _claim_sync_deletion(conn)
                    if not proceed:
                        return
                    invalidate_recovery_copies()
                    if remote_only:
                        deletion_subquery += " AND origin_device_id IS NOT NULL"
                if delete_activity:
                    activity_segments = int(
                        conn.execute(
                            f"SELECT COUNT(*) AS count FROM activity_segments WHERE id IN ({deletion_subquery})",
                            tuple(segment_params),
                        ).fetchone()["count"]
                    )
                    classifications = int(
                        conn.execute(
                            f"SELECT COUNT(*) AS count FROM activity_classifications WHERE segment_id IN ({deletion_subquery})",
                            tuple(segment_params),
                        ).fetchone()["count"]
                    )
                elif delete_ai_classifications:
                    classifications = int(
                        conn.execute(
                            "SELECT COUNT(*) AS count FROM activity_classifications "
                            f"WHERE ai_result = 1 AND segment_id IN ({deletion_subquery})",
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

                if dry_run:
                    return
                if activity_segments + classifications + youtube_metadata > 0:
                    # Fail closed before making an advertised permanent deletion:
                    # an older backup or quarantined copy must not resurrect it.
                    invalidate_recovery_copies()
                if delete_ai_classifications:
                    conn.execute(
                        f"DELETE FROM activity_classifications WHERE ai_result = 1 AND segment_id IN ({deletion_subquery})",
                        tuple(segment_params),
                    )
                    activity_timeline_cards.delete_windows_for_segments(conn, segment_subquery, tuple(segment_params))
                if delete_youtube_metadata:
                    if has_range:
                        conn.execute(
                            f"DELETE FROM youtube_video_metadata WHERE video_id IN ({segment_video_subquery})",
                            tuple(segment_video_params),
                        )
                    else:
                        conn.execute("DELETE FROM youtube_video_metadata")
                if delete_activity:
                    if remote_only:
                        self._delete_project_windows_for_segment_ids(conn, {
                            str(row["id"]) for row in conn.execute(deletion_subquery, tuple(segment_params))
                        })
                    elif has_range:
                        window_query = "DELETE FROM project_window_assignments WHERE 1=1"
                        window_params: list[Any] = []
                        if start_bound:
                            window_query += " AND datetime(window_ended_at) >= datetime(?)"
                            window_params.append(self._normalize_range_bound(start_bound))
                            window_query += " AND history_ends_after(window_ended_at, ?)"
                            window_params.append(self._normalize_range_bound(start_bound))
                        if end_bound:
                            window_query += " AND datetime(window_started_at) <= datetime(?)"
                            window_params.append(self._normalize_range_bound(end_bound))
                        conn.execute(window_query, window_params)
                        # Range deletion removes whole overlapping segments. Their
                        # project windows can lie outside the requested range, so
                        # invalidate those references in this same write transaction.
                        deleted_segment_ids = {
                            str(row["id"])
                            for row in conn.execute(deletion_subquery, tuple(segment_params))
                        }
                        self._delete_project_windows_for_segment_ids(conn, deleted_segment_ids)
                    else:
                        conn.execute("DELETE FROM project_window_assignments")
                    conn.execute(
                        f"DELETE FROM activity_segments WHERE id IN ({deletion_subquery})",
                        tuple(segment_params),
                    )
                    if record_tombstone and activity_segments > 0:
                        # Store the same UTC-normalized bounds the overlap filter matched
                        # on, so a synced device in another timezone deletes the exact
                        # same absolute window. Open bounds stay None.
                        self._record_sync_deletion(
                            conn,
                            "range",
                            range_start=self._normalize_range_bound(start_bound) if start_bound else None,
                            range_end=self._normalize_range_bound(end_bound) if end_bound else None,
                        )

        if dry_run:
            inspect_and_delete(lambda: None)
        else:
            with permanent_deletion_guard(
                self.db_path,
                self.connect(),
                on_backup_error=self._record_post_delete_backup_error,
                refresh_backup=refresh_recovery_backup,
            ) as invalidate_recovery_copies:
                inspect_and_delete(invalidate_recovery_copies)

        if not dry_run and activity_segments >= 1000:
            # VACUUM cannot run inside a transaction; the deleting with-block
            # above has already committed, so the shared connection is back in
            # autocommit mode here. A compaction failure must not turn that
            # committed deletion into a misleading failed command response.
            try:
                self.connect().execute("VACUUM")
            except (OSError, sqlite3.DatabaseError) as error:
                self._record_maintenance_error(error, operation="Vacuum skipped")

        return {
            "activitySegments": activity_segments,
            "classifications": classifications,
            "youtubeMetadata": youtube_metadata,
            "dryRun": bool(dry_run),
        }

    # --- Device sync -----------------------------------------------------------------

    SYNC_META_PREFIX = "sync_"
    SYNC_HOT_GRACE_SECONDS = 180

    @staticmethod
    def _serialize_sync_outbox_row(row: sqlite3.Row) -> dict[str, Any]:
        classification = None
        if row["cls_category"]:
            classification = {
                "category": row["cls_category"],
                "productivity": row["cls_productivity"],
                "source": row["cls_source"] or "unknown",
                "confidence": row["cls_confidence"],
                "reason": row["cls_reason"],
                "classifiedAt": row["cls_classified_at"],
            }
        return {
            "segmentUid": row["segment_uid"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "durationSeconds": row["duration_seconds"],
            "appName": row["app_name"],
            "bundleId": row["bundle_id"],
            "windowTitle": row["window_title"],
            "siteDomain": row["site_domain"],
            "siteTitle": row["site_title"],
            "siteUrl": row["site_url"],
            "youtubeVideoId": row["youtube_video_id"],
            "youtubePlaylistId": row["youtube_playlist_id"],
            "youtubeIsShorts": bool(row["youtube_is_shorts"]) if row["youtube_is_shorts"] is not None else None,
            "browserName": row["browser_name"],
            "siteSource": row["site_source"],
            "platform": row["platform"],
            "source": row["source"],
            "confidence": row["confidence"],
            "syncSeq": row["sync_seq"],
            "classification": classification,
            "exclusionSource": row["exclusion_source"] if "exclusion_source" in row.keys() else None,
        }

    def get_sync_outbox(self, after_seq: int, limit: int = 500, hot_grace_seconds: int | None = None) -> dict[str, Any]:
        grace = self.SYNC_HOT_GRACE_SECONDS if hot_grace_seconds is None else hot_grace_seconds
        limit = max(1, min(int(limit), 1000))
        with self.connect() as conn:
            # The most recent live segment is still being extended by record_snapshot;
            # pushing it every few seconds would thrash the server. It becomes eligible
            # once its ended_at is older than the idle threshold (it can only be trimmed
            # after that, and trims bump sync_seq so a re-push self-heals).
            hot_id: int | None = None
            hot_seq: int | None = None
            hot = conn.execute(
                """
                SELECT id, ended_at, sync_seq FROM activity_segments
                WHERE origin_device_id IS NULL AND source != ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (BROWSER_HISTORY_IMPORT_SOURCE,),
            ).fetchone()
            if hot is not None:
                ended = parse_iso_datetime(hot["ended_at"])
                if ended.tzinfo is None:
                    ended = ended.astimezone()
                age_seconds = (datetime.now(timezone.utc) - ended.astimezone(timezone.utc)).total_seconds()
                if age_seconds < grace:
                    hot_id = int(hot["id"])
                    hot_seq = int(hot["sync_seq"])

            base_where = "s.origin_device_id IS NULL AND s.segment_uid IS NOT NULL AND s.sync_seq > ?"
            params: list[Any] = [int(after_seq)]
            if hot_id is not None:
                base_where += " AND s.id != ?"
                params.append(hot_id)

            rows = conn.execute(
                f"""
                SELECT
                    s.*,
                    c.category AS cls_category,
                    c.productivity AS cls_productivity,
                    c.source AS cls_source,
                    c.confidence AS cls_confidence,
                    c.reason AS cls_reason,
                    c.classified_at AS cls_classified_at
                FROM activity_segments s
                LEFT JOIN activity_classifications c ON c.segment_id = s.id
                WHERE {base_where}
                ORDER BY s.sync_seq ASC
                LIMIT ?
                """,
                tuple(params) + (limit,),
            ).fetchall()

            pending_count = int(
                conn.execute(
                    f"SELECT COUNT(*) AS count FROM activity_segments s WHERE {base_where}",
                    tuple(params),
                ).fetchone()["count"]
            )
            counter_seq = int(conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()["seq"])

        items = [self._serialize_sync_outbox_row(row) for row in rows]
        # The push cursor must advance only past what was actually returned. While the
        # hot segment is held back it must also never advance past the hot segment's
        # own seq: a classification bump on ANOTHER segment can produce a higher seq in
        # this batch, and if the cursor passed the hot seq the segment would be
        # stranded below the cursor once it goes cold (nothing re-bumps an
        # unclassified segment). Clamping keeps it in reach; re-pushing the few rows
        # above the clamp next cycle is harmless because the server upsert is
        # idempotent.
        batch_max_seq = max((item["syncSeq"] for item in items), default=int(after_seq))
        if hot_seq is not None:
            batch_max_seq = min(batch_max_seq, hot_seq - 1)
        batch_max_seq = max(batch_max_seq, int(after_seq))
        return {
            "items": items,
            "batchMaxSeq": batch_max_seq,
            "counterSeq": counter_seq,
            "pendingCount": pending_count,
        }

    def get_sync_state(self) -> dict[str, Any]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT key, value FROM tracker_meta WHERE key LIKE ?",
                (f"{self.SYNC_META_PREFIX}%",),
            ).fetchall()
            counter_seq = int(conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()["seq"])
            pending_deletions = int(
                conn.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM sync_deletions
                    WHERE pushed = 0
                      AND account_id = (
                        SELECT value FROM tracker_meta WHERE key = 'sync_account_id'
                      )
                    """
                ).fetchone()["count"]
            )
        return {
            "state": {row["key"]: row["value"] for row in rows},
            "counterSeq": counter_seq,
            "pendingDeletions": pending_deletions,
        }

    def set_sync_state(self, entries: dict[str, Any], *, _conn: sqlite3.Connection | None = None) -> int:
        written = 0
        with self._definition_connection(_conn) as conn:
            for key, value in entries.items():
                if not isinstance(key, str) or not key.startswith(self.SYNC_META_PREFIX):
                    continue
                if value is None:
                    conn.execute("DELETE FROM tracker_meta WHERE key = ?", (key,))
                else:
                    conn.execute(
                        """
                        INSERT INTO tracker_meta(key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                        """,
                        (key, str(value)),
                    )
                written += 1
        return written

    @staticmethod
    def _canonical_definition_snapshot(value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        result = dict(value)
        if "anchors" in result:
            result["anchors"] = sorted(result["anchors"], key=lambda anchor: (anchor["kind"], anchor["value"], anchor["source"]))
        return result

    @classmethod
    def _synced_definition_value(cls, kind: str, value: dict[str, Any] | None) -> dict[str, Any] | None:
        """The same field families as projectSyncValue/ruleSyncValue, no JS hash."""
        if value is None:
            return None
        if kind == "rule":
            return {key: value[key] for key in (
                "targetKind", "targetValue", "matchScope", "detailKind", "detailValue",
                "category", "productivity", "enabled", "confidence",
            )}
        result = {key: value[key] for key in ("name", "description", "color", "status", "anchors")}
        result = cls._canonical_definition_snapshot(result)
        created_at = cls._valid_iso_timestamp(value["createdAt"])
        if created_at:
            result["createdAt"] = datetime.fromisoformat(created_at).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return result

    def _validate_synced_definition(self, request: dict[str, Any]) -> None:
        fields = {"accountId", "kind", "key", "value", "updatedAt", "expected"}
        if not isinstance(request, dict) or set(request) != fields:
            raise ValueError("input must contain only accountId, kind, key, value, updatedAt and expected")
        account = request["accountId"]
        if not isinstance(account, str) or not account.strip() or len(account) > 256:
            raise ValueError("accountId is required")
        kind, key, value, expected = (request[field] for field in ("kind", "key", "value", "expected"))
        if kind not in ("project", "rule"):
            raise ValueError("kind must be 'project' or 'rule'")
        pattern = r"[A-Za-z0-9_-]{1,64}" if kind == "project" else r"[0-9a-f]{64}"
        if not isinstance(key, str) or not re.fullmatch(pattern, key):
            raise ValueError("invalid definition key")
        if not self._valid_iso_timestamp(request["updatedAt"]):
            raise ValueError("updatedAt must be an ISO timestamp with a timezone")
        if value is not None and not isinstance(value, dict):
            raise ValueError("value must be an object or null")
        if expected is not None:
            expected_fields = ({"id", "name", "description", "color", "status", "anchors", "createdAt", "updatedAt"}
                               if kind == "project" else {"id", "targetKind", "targetValue", "matchScope", "detailKind", "detailValue",
                                                          "category", "productivity", "enabled", "confidence", "createdAt", "updatedAt", "syncKey"})
            if not isinstance(expected, dict) or set(expected) != expected_fields:
                raise ValueError("expected must be the complete serialized definition or null")
            text_fields = expected_fields - ({"anchors"} if kind == "project" else {"enabled", "confidence", "detailKind", "detailValue"})
            if any(not isinstance(expected[field], str) for field in text_fields):
                raise ValueError("expected must be the complete serialized definition")
            if kind == "rule" and (not isinstance(expected["enabled"], bool)
                                   or any(expected[field] is not None and not isinstance(expected[field], str) for field in ("detailKind", "detailValue"))
                                   or (expected["confidence"] is not None and (isinstance(expected["confidence"], bool) or not isinstance(expected["confidence"], (int, float))))):
                raise ValueError("invalid expected rule fields")
            if kind == "project":
                anchors = expected["anchors"]
                if not isinstance(anchors, list) or any(
                    not isinstance(anchor, dict) or set(anchor) != {"kind", "value", "source"}
                    or any(not isinstance(anchor[field], str) for field in ("kind", "value", "source")) for anchor in anchors
                ):
                    raise ValueError("expected anchors must be complete serialized anchors")
        try:
            json.dumps({"value": value, "expected": expected}, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeError) as error:
            raise ValueError("definition must be valid JSON") from error
        if value is None:
            return
        limit = 16_384 if kind == "project" else 4_096
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > limit:
            raise ValueError("definition exceeds its size limit")
        if kind == "project":
            allowed = {"name", "description", "color", "status", "anchors", "createdAt"}
            if set(value) - allowed or not isinstance(value.get("name"), str) or not value["name"].strip():
                raise ValueError("invalid project fields")
            if any(field in value and not isinstance(value[field], str) for field in ("description", "color")):
                raise ValueError("project description and color must be strings")
            if value.get("status", "active") not in ("active", "archived"):
                raise ValueError("invalid project status")
            if "createdAt" in value and not self._valid_iso_timestamp(value["createdAt"]):
                raise ValueError("invalid project createdAt")
            anchors = value.get("anchors", [])
            if not isinstance(anchors, list):
                raise ValueError("anchors must be a list")
            seen = set()
            for anchor in anchors:
                if (not isinstance(anchor, dict) or set(anchor) - {"kind", "value", "source"}
                    or anchor.get("kind") not in ("app", "domain", "keyword")
                    or not isinstance(anchor.get("value"), str) or not anchor["value"].strip()
                    or anchor.get("source", "manual") not in ("manual", "harvested")):
                    raise ValueError("invalid project anchor")
                identity = (anchor["kind"], anchor["value"].strip())
                if identity in seen:
                    raise ValueError("duplicate project anchor")
                seen.add(identity)
        else:
            allowed = {"targetKind", "targetValue", "matchScope", "detailKind", "detailValue", "category", "productivity", "enabled", "confidence"}
            if set(value) - allowed or value.get("targetKind") not in ("app", "site"):
                raise ValueError("invalid rule fields")
            if any(not isinstance(value.get(field), str) or not value[field].strip() for field in ("targetValue", "category", "productivity")):
                raise ValueError("rule targetValue, category and productivity are required")
            if "enabled" in value and not isinstance(value["enabled"], bool):
                raise ValueError("rule enabled must be a boolean")
            if (value.get("matchScope", "surface") not in ("surface", "detail")
                or value.get("detailKind") not in (None, *VALID_RULE_DETAIL_KINDS)
                or (value.get("detailValue") is not None and not isinstance(value["detailValue"], str))):
                raise ValueError("invalid rule detail fields")
            confidence = value.get("confidence")
            if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1):
                raise ValueError("rule confidence must be between 0 and 1")
            identity = self._classification_rule_identity(value["targetKind"], value)
            if self._classification_rule_sync_key(identity) != key:
                raise ValueError("rule key does not match its normalized identity")

    def apply_synced_definition(self, request: dict[str, Any]) -> dict[str, Any]:
        """CAS an inbound definition and its acknowledgement in one local transaction."""
        self._validate_synced_definition(request)
        kind, key, value = (request[field] for field in ("kind", "key", "value"))
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            ledger_row = conn.execute("SELECT value FROM tracker_meta WHERE key = 'sync_definition_ledger'").fetchone()
            raw = ledger_row["value"] if ledger_row else '{"projects":{},"rules":{}}'
            if kind == "project":
                current = self._get_project(key, _conn=conn)
            else:
                row = next((row for row in conn.execute("SELECT * FROM classification_rules")
                            if self._classification_rule_sync_key(row) == key), None)
                current = self._serialize_rule(row) if row else None
            if sync_account_scope(conn) != request["accountId"]:
                return {"applied": False, "value": current, "ledger": raw, "reason": "account_changed"}
            if self._canonical_definition_snapshot(current) != self._canonical_definition_snapshot(request["expected"]):
                return {"applied": False, "value": current, "ledger": raw, "reason": "local_changed"}
            try:
                ledger = json.loads(raw)
            except (TypeError, ValueError) as error:
                raise ValueError("invalid sync definition ledger") from error
            if not isinstance(ledger, dict) or any(not isinstance(ledger.get(section, {}), dict) for section in ("projects", "rules")):
                raise ValueError("invalid sync definition ledger")
            if kind == "project":
                if value is None:
                    self.delete_project(key, _conn=conn)
                    result = None
                else:
                    self.save_project({**value, "id": key}, _conn=conn)
                    conn.execute("DELETE FROM project_anchors WHERE project_id = ?", (key,))
                    self.save_project_anchors(key, [{**anchor, "source": anchor.get("source", "manual")} for anchor in value.get("anchors", [])], _conn=conn)
                    result = self._get_project(key, _conn=conn)
            else:
                if value is None:
                    if current is not None:
                        self.delete_classification_rule(current["id"], _conn=conn)
                    result = None
                else:
                    result = self.save_classification_rule(value, _conn=conn)
                    if result["syncKey"] != key:
                        raise ValueError("rule key does not match its normalized identity")
                ledger["rulesNeedApply"] = True
            ledger.setdefault("projects" if kind == "project" else "rules", {})[key] = {
                "at": request["updatedAt"], "value": self._synced_definition_value(kind, result),
            }
            raw = json.dumps(ledger, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            self.set_sync_state({"sync_definition_ledger": raw}, _conn=conn)
            # Result and ledger are already captured; no post-commit snapshot can
            # acknowledge a later UI edit as though it came from the account.
            return {"applied": True, "value": result, "ledger": raw}

    def apply_synced_segments(self, segments: list[dict[str, Any]]) -> dict[str, int]:
        inserted = 0
        updated = 0
        skipped = 0
        timestamp = datetime.now(timezone.utc).isoformat()
        local_device_id = self.get_meta("sync_device_id")
        with self.connect() as conn:
            if not conn.in_transaction:
                conn.execute("BEGIN IMMEDIATE")
            # Snapshot the account's tombstones and apply the page under one
            # write lock, so a concurrent deletion cannot slip between them.
            deletion_barrier = SyncDeletionBarrier(conn, segments)
            for item in segments:
                segment_uid = item.get("segmentUid")
                origin_device_id = item.get("originDeviceId")
                if not segment_uid or not origin_device_id:
                    skipped += 1
                    continue
                # Echo protection: never re-apply rows this device originated, even if
                # the pull filter missed them.
                if local_device_id and origin_device_id == local_device_id:
                    skipped += 1
                    continue

                if deletion_barrier.blocks(conn, item):
                    skipped += 1
                    continue

                # Strict receive allow-list: engagement_evidence and raw_context_json
                # are local sensor/context fields and are intentionally ignored even
                # if a malformed or older peer includes them in a sync payload.
                rules = self._get_excluded_app_rules(conn)
                match = match_exclusion(item.get("appName"), item.get("bundleId"), item.get("siteDomain"), item.get("siteUrl"), rules)
                exclusion_source = item.get("exclusionSource")
                if match or exclusion_source or item.get("appName") == REDACTED_APP_NAME:
                    item = {
                        **item,
                        "appName": REDACTED_APP_NAME,
                        "bundleId": None,
                        "windowTitle": None,
                        "siteDomain": None,
                        "siteTitle": None,
                        "siteUrl": None,
                        "youtubeVideoId": None,
                        "youtubePlaylistId": None,
                        "browserName": None,
                        "exclusionSource": exclusion_source or (match.source if match else "user"),
                    }
                values = (
                    item.get("startedAt"),
                    item.get("endedAt"),
                    int(item.get("durationSeconds") or 0),
                    item.get("appName") or "",
                    item.get("bundleId"),
                    item.get("windowTitle"),
                    item.get("siteDomain"),
                    item.get("siteTitle"),
                    item.get("siteUrl"),
                    item.get("youtubeVideoId"),
                    item.get("youtubePlaylistId"),
                    1 if item.get("youtubeIsShorts") else (0 if item.get("youtubeIsShorts") is False else None),
                    item.get("browserName"),
                    item.get("siteSource"),
                    item.get("platform") or "macos",
                    item.get("source") or "unknown",
                    item.get("confidence"),
                    origin_device_id,
                    item.get("exclusionSource"),
                )
                existing = conn.execute(
                    "SELECT id, origin_device_id FROM activity_segments WHERE segment_uid = ?",
                    (segment_uid,),
                ).fetchone()
                if existing is not None and existing["origin_device_id"] is None:
                    # A pulled row claiming a uid that exists here as a LOCAL
                    # segment is an echo of this device's own upload; updating it
                    # would flip local history to remote and break coalescing,
                    # publishing, and the push outbox.
                    skipped += 1
                    continue
                if existing is not None:
                    segment_id = int(existing["id"])
                    conn.execute(
                        """
                        UPDATE activity_segments SET
                            started_at = ?, ended_at = ?, duration_seconds = ?, app_name = ?,
                            bundle_id = ?, window_title = ?, site_domain = ?, site_title = ?,
                            site_url = ?, youtube_video_id = ?, youtube_playlist_id = ?,
                            youtube_is_shorts = ?, browser_name = ?, site_source = ?,
                            platform = ?, source = ?, confidence = ?, origin_device_id = ?,
                            exclusion_source = ?
                        WHERE id = ?
                        """,
                        values + (segment_id,),
                    )
                    updated += 1
                else:
                    cursor = conn.execute(
                        """
                        INSERT INTO activity_segments (
                            started_at, ended_at, duration_seconds, app_name, bundle_id,
                            window_title, site_domain, site_title, site_url, youtube_video_id,
                            youtube_playlist_id, youtube_is_shorts, browser_name, site_source,
                            platform, source, confidence, origin_device_id, exclusion_source, segment_uid
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        values + (segment_uid,),
                    )
                    segment_id = int(cursor.lastrowid)
                    inserted += 1

                classification_present = "classification" in item
                classification = item.get("classification")
                if isinstance(classification, dict) and classification.get("category"):
                    # A user-authored local override (rule/manual) or an approved
                    # AI-review correction on a remote segment must survive the
                    # originating device re-pushing its own classification. The
                    # dedicated marker distinguishes those choices from the same
                    # source labels received through sync; fingerprints cannot.
                    existing_classification = conn.execute(
                        """
                        SELECT
                          c.source,
                          p.provenance
                        FROM activity_classifications c
                        LEFT JOIN sync_classification_provenance p
                          ON p.segment_id = c.segment_id
                        WHERE c.segment_id = ?
                        """,
                        (segment_id,),
                    ).fetchone()
                    if existing_classification is not None and (
                        existing_classification["provenance"] == "local-protected"
                        or (
                            existing_classification["provenance"] == "legacy"
                            and existing_classification["source"] in ("rule", "manual", "ai_review")
                        )
                    ):
                        continue
                    source = str(classification.get("source") or "llm")
                    conn.execute(
                        """
                        INSERT INTO activity_classifications (
                            segment_id, input_fingerprint, category, productivity, source,
                            confidence, reason, classified_at, refreshed_at, ai_result, stale
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                        ON CONFLICT(segment_id) DO UPDATE SET
                            input_fingerprint = excluded.input_fingerprint,
                            category = excluded.category,
                            productivity = excluded.productivity,
                            source = excluded.source,
                            confidence = excluded.confidence,
                            reason = excluded.reason,
                            classified_at = excluded.classified_at,
                            refreshed_at = excluded.refreshed_at,
                            ai_result = excluded.ai_result,
                            stale = 0
                        """,
                        (
                            segment_id,
                            f"sync:{segment_uid}",
                            classification.get("category"),
                            classification.get("productivity") or "neutral",
                            source,
                            float(classification.get("confidence") or 0),
                            classification.get("reason"),
                            classification.get("classifiedAt") or timestamp,
                            timestamp,
                            1 if source == "llm" else 0,
                        ),
                    )
                    # The INSERT/UPDATE trigger above first invalidates any old
                    # marker. Restoring it here makes provenance and the received
                    # classification one SQLite transaction while keeping all
                    # non-sync writers automatically local.
                    conn.execute(
                        """
                        INSERT INTO sync_classification_provenance(
                            segment_id, provenance, rule_snapshot_kind
                        )
                        VALUES (
                            ?, 'sync',
                            CASE WHEN ? = 'rule' THEN 'synced-rule' ELSE NULL END
                        )
                        ON CONFLICT(segment_id) DO UPDATE SET
                            provenance = 'sync',
                            rule_snapshot_kind = excluded.rule_snapshot_kind
                        """,
                        (segment_id, source),
                    )
                elif classification_present and classification is None:
                    # A missing key is a legacy partial payload and changes
                    # nothing. Explicit null removes only a classification whose
                    # current writer is proven to be sync ingest; local choices
                    # and legacy ambiguous rows remain conservative.
                    conn.execute(
                        """
                        DELETE FROM activity_classifications
                        WHERE segment_id = ?
                          AND EXISTS (
                            SELECT 1 FROM sync_classification_provenance
                            WHERE segment_id = ? AND provenance = 'sync'
                          )
                        """,
                        (segment_id, segment_id),
                    )
        return {"inserted": inserted, "updated": updated, "skipped": skipped}

    def get_pending_sync_deletions(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT deletion_uid, kind, range_start, range_end, segment_uids_json, created_at
                FROM sync_deletions
                WHERE pushed = 0
                  AND account_id = (
                    SELECT value FROM tracker_meta WHERE key = 'sync_account_id'
                  )
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (max(1, min(int(limit), 500)),),
            ).fetchall()
        return [
            {
                "deletionUid": row["deletion_uid"],
                "kind": row["kind"],
                "rangeStart": row["range_start"],
                "rangeEnd": (row["range_end"] if row["range_end"] is not None or row["kind"] != "range"
                             else row["created_at"]),
                "segmentUids": json.loads(row["segment_uids_json"]) if row["segment_uids_json"] else None,
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

    def mark_sync_deletions_pushed(self, deletion_uids: list[str]) -> int:
        uids = [uid for uid in deletion_uids if isinstance(uid, str) and uid]
        if not uids:
            return 0
        updated = 0
        with self.connect() as conn:
            for start in range(0, len(uids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                batch = uids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                placeholders = ",".join("?" for _ in batch)
                cursor = conn.execute(
                    f"""
                    UPDATE sync_deletions
                    SET pushed = 1
                    WHERE deletion_uid IN ({placeholders})
                      AND account_id = (
                        SELECT value FROM tracker_meta WHERE key = 'sync_account_id'
                      )
                    """,
                    tuple(batch),
                )
                updated += cursor.rowcount
        return updated

    def apply_synced_deletions(self, deletions: list[dict[str, Any]]) -> dict[str, int]:
        applied = 0
        skipped = 0
        recovery_backup_due = False
        timestamp = datetime.now(timezone.utc).isoformat()
        try:
            for deletion in deletions:
                deletion_uid = deletion.get("deletionUid")
                kind = deletion.get("kind")
                if not deletion_uid or kind not in ("range", "uids"):
                    skipped += 1
                    continue
                with self.connect() as conn:
                    account = sync_account_scope(conn)
                    known = conn.execute(
                        "SELECT 1 FROM received_sync_deletions WHERE account_id = ? AND deletion_uid = ?",
                        (account, deletion_uid),
                    ).fetchone()
                if known is not None:
                    skipped += 1
                    continue

                segment_uids = [uid for uid in (deletion.get("segmentUids") or []) if isinstance(uid, str) and uid]
                start = self._expand_history_range_bound(deletion.get("rangeStart"), end_of_day=False) if kind == "range" else None
                end = self._expand_history_range_bound(deletion.get("rangeEnd"), end_of_day=True) if kind == "range" else None
                range_start = self._normalize_range_bound(start) if start else None
                range_end = self._normalize_range_bound(end) if end else None
                if kind == "range" and range_end is None:
                    # Old senders emitted open-ended tombstones. Freeze their
                    # upper edge at the original deletion time (receipt time
                    # only for legacy payloads without createdAt).
                    range_end = self._normalize_range_bound(deletion.get("createdAt") or timestamp)
                deletion_claimed = False

                def claim_deletion(conn: sqlite3.Connection) -> tuple[bool, bool]:
                    nonlocal deletion_claimed
                    if sync_account_scope(conn) != account:
                        raise ValueError("Sync account changed while applying deletion")
                    # Target, replay marker, and deletion commit together. A
                    # legacy marker is enriched without repeating the deletion
                    # over local history captured since its original application.
                    marker = conn.execute(
                        "INSERT OR IGNORE INTO applied_sync_deletions (deletion_uid, applied_at) VALUES (?, ?)",
                        (deletion_uid, timestamp),
                    )
                    deletion_claimed = marker.rowcount > 0
                    barrier = conn.execute(
                        """
                        INSERT OR IGNORE INTO received_sync_deletions
                        (account_id, deletion_uid, kind, range_start, range_end, segment_uids_json)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (account, deletion_uid, kind, range_start, range_end,
                         json.dumps(segment_uids) if kind == "uids" else None),
                    )
                    return deletion_claimed or barrier.rowcount > 0, not deletion_claimed

                recovery_backup_due = True
                if kind == "range":
                    deleted = self.delete_history_range(
                        start=range_start, end=range_end, scopes={"activity": True},
                        record_tombstone=False, refresh_recovery_backup=False,
                        _claim_sync_deletion=claim_deletion,
                    )["activitySegments"]
                else:
                    deleted = self.delete_activity_segments(
                        [], record_tombstone=False, refresh_recovery_backup=False,
                        _claim_sync_deletion=claim_deletion, _sync_segment_uids=segment_uids,
                    )
                if deletion_claimed or deleted:
                    applied += 1
                else:
                    skipped += 1
        finally:
            if recovery_backup_due:
                self._create_post_delete_backup()
        return {"applied": applied, "skipped": skipped}

    def purge_remote_segments(self) -> int:
        with permanent_deletion_guard(
            self.db_path,
            self.connect(),
            on_backup_error=self._record_post_delete_backup_error,
        ) as invalidate_recovery_copies:
            with self.connect() as conn:
                remote_segment_ids = {
                    str(row["id"])
                    for row in conn.execute(
                        "SELECT id FROM activity_segments WHERE origin_device_id IS NOT NULL"
                    )
                }
                # Authentication can change while the caller awaits this purge.
                # Invalidate pull checkpoints in the same transaction as the
                # rows, even if the caller abandons its later state write. Keep
                # the account/generation and device-global push cursor intact.
                conn.execute(
                    "DELETE FROM tracker_meta WHERE key IN (?, ?, ?)",
                    ("sync_pull_cursor", "sync_deletion_pull_cursor", "sync_last_pulled_at"),
                )
                if not remote_segment_ids:
                    return 0
                invalidate_recovery_copies()
                self._delete_project_windows_for_segment_ids(conn, remote_segment_ids)
                cursor = conn.execute("DELETE FROM activity_segments WHERE origin_device_id IS NOT NULL")
                return cursor.rowcount

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

    @staticmethod
    def _enabled_classification_rules(conn: sqlite3.Connection) -> list[sqlite3.Row]:
        return conn.execute(
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
                    confidence,
                    updated_at,
                    created_at
                FROM classification_rules
                WHERE enabled = 1
                ORDER BY
                    CASE WHEN match_scope = 'detail' THEN 0 ELSE 1 END,
                    updated_at DESC,
                    created_at DESC
            """
        ).fetchall()

    def apply_classification_rules(self, start: str | None = None, end: str | None = None) -> dict[str, int]:
        # Editing or adding a rule while we match can change precedence. Retry
        # preparation once outside the writer; never keep it locked to rematch
        # all history, and never spin indefinitely under concurrent edits.
        for _ in range(2):
            result = self._apply_classification_rule_snapshot(start, end)
            if result is not None:
                return result
        raise RuntimeError("Classification rules changed during application. Try again.")

    def _apply_classification_rule_snapshot(self, start: str | None, end: str | None) -> dict[str, int] | None:
        with self.connect() as conn:
            rules = self._enabled_classification_rules(conn)
            if not rules:
                return {"matchedCount": 0, "appliedCount": 0, "skippedCount": 0}

            query = """
                SELECT
                    activity_segments.*,
                    youtube_video_metadata.title AS youtube_title,
                    existing.classification_rule_id AS stored_rule_id
                FROM activity_segments
                LEFT JOIN activity_classifications AS existing ON existing.segment_id = activity_segments.id
                LEFT JOIN youtube_video_metadata
                  ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
                WHERE 1=1
            """
            params: list[Any] = []
            query = self._append_overlap_filters(query, params, start, end)
            rows = conn.execute(query, tuple(params)).fetchall()

            prepared: list[tuple[Any, ...]] = []
            materialized: list[tuple[Any, ...]] = []
            new_results: list[tuple[Any, ...]] = []
            timestamp = datetime.now(timezone.utc).isoformat()
            surface_rules: dict[tuple[str | None, str | None, str | None], list[sqlite3.Row]] = {}
            for segment in rows:
                # Surface matching depends only on these captured values. Reuse
                # its ordered candidates within this immutable rule snapshot;
                # URL/title detail matching remains independent per segment.
                surface_key = (
                    segment["site_domain"] or segment["site_url"],
                    segment["bundle_id"], segment["app_name"],
                )
                if surface_key not in surface_rules and len(surface_rules) < 256:
                    normalized: dict[str, str] = {}
                    surface_rules[surface_key] = [
                        candidate for candidate in rules
                        if self._rule_surface_matches(segment, candidate, normalized)
                    ]
                # Bound candidate memory for batches with many unique surfaces.
                # Uncached surfaces keep the original full matching path.
                rule = self._matching_rule(segment, surface_rules.get(surface_key, rules))
                if not rule:
                    continue
                segment_id = int(segment["id"])
                prepared.append((
                    segment_id,
                    f"rule:{rule['id']}:{segment_id}",
                    rule["category"],
                    rule["productivity"],
                    float(rule["confidence"] if rule["confidence"] is not None else DEFAULT_RULE_CONFIDENCE),
                    self._rule_reason(rule),
                    timestamp,
                    timestamp,
                    rule["id"],
                    segment_id,
                    rule["id"],
                    segment["segment_uid"], segment["app_name"], segment["bundle_id"],
                    segment["site_domain"], segment["site_url"], segment["site_title"],
                    segment["window_title"], segment["youtube_video_id"], segment["youtube_title"],
                    segment["started_at"], segment["ended_at"],
                ))
                # Only possible repeats need a live comparison after admission.
                # New/moved results can be staged before taking the main writer.
                if segment["stored_rule_id"] == rule["id"]:
                    materialized.append(prepared[-1])
                else:
                    new_results.append(prepared[-1])

            if not prepared:
                return {"matchedCount": 0, "appliedCount": 0, "skippedCount": 0}

            # Preserve BEGIN IMMEDIATE's rejection of an existing transaction;
            # committing TEMP preparation must never commit caller-owned writes.
            if conn.in_transaction:
                raise sqlite3.OperationalError("cannot start a transaction within a transaction")

            # Staging only new/moved results keeps repeated applications on
            # the no-write path. Its TEMP writes finish before main admission.
            with self._stage_new_rule_results(conn, new_results) as staged:
                with conn:
                    snapshot_rules = {tuple(rule) for rule in rules}
                    conn.execute("BEGIN IMMEDIATE")
                    if any(tuple(rule) not in snapshot_rules for rule in self._enabled_classification_rules(conn)):
                        return None
                    unchanged = self._unchanged_rule_classifications(conn, materialized)
                    applied_count = self._write_rule_classifications(conn, None) if staged else 0
                    remaining = materialized if staged else prepared
                    applied_count += self._write_rule_classifications(
                        conn, (row for row in remaining if row[0] not in unchanged),
                    ) + len(unchanged)
        return {"matchedCount": len(prepared), "appliedCount": applied_count,
                "skippedCount": len(prepared) - applied_count}

    @staticmethod
    @contextmanager
    def _stage_new_rule_results(conn: sqlite3.Connection, rows: list[tuple[Any, ...]]) -> Iterator[bool]:
        if len(rows) < RULE_WRITE_STAGE_MIN_ROWS:
            yield False
            return
        conn.execute(f"CREATE TEMP TABLE pending_rule_results ({', '.join(RULE_WRITE_COLUMNS)})")
        try:
            # Only the connection-private TEMP database is written here. No
            # classification is visible and the main DB remains writable.
            with conn:
                conn.executemany(
                    f"INSERT INTO temp.pending_rule_results VALUES ({','.join(['?'] * len(RULE_WRITE_COLUMNS))})",
                    rows,
                )
            yield True
        finally:
            # The inner writer context commits/rolls back before TEMP cleanup,
            # including a changed rule snapshot that needs another attempt.
            conn.execute("DROP TABLE temp.pending_rule_results")

    @staticmethod
    def _write_rule_classifications(
        conn: sqlite3.Connection, rows: Iterable[tuple[Any, ...]] | None,
    ) -> int:
        # One guarded UPSERT for both paths. Staging is a transport optimization:
        # live captures, enabled rules and manual corrections still win here.
        query = """
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
            )
            SELECT {segment_id}, {input_fingerprint}, {category}, {productivity}, 'rule', {confidence}, {reason}, NULL, NULL, NULL, NULL, NULL, {classified_at}, {refreshed_at}, 0, 0, {rule_id}
            FROM {source}
            LEFT JOIN youtube_video_metadata AS video ON video.video_id = segment.youtube_video_id
            WHERE segment.id = {captured_id}
              AND EXISTS (SELECT 1 FROM classification_rules WHERE id = {captured_rule_id} AND enabled = 1)
              AND segment.segment_uid IS {segment_uid} AND segment.app_name IS {app_name} AND segment.bundle_id IS {bundle_id}
              AND segment.site_domain IS {site_domain} AND segment.site_url IS {site_url} AND segment.site_title IS {site_title}
              AND segment.window_title IS {window_title} AND segment.youtube_video_id IS {youtube_video_id} AND video.title IS {youtube_title}
              AND segment.started_at IS {started_at} AND segment.ended_at IS {ended_at}
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
            WHERE activity_classifications.source != 'manual'
        """
        if rows is None:
            bindings = {column: f"batch.{column}" for column in RULE_WRITE_COLUMNS}
            source = ("temp.pending_rule_results AS batch JOIN activity_segments AS segment "
                      "ON segment.id = batch.captured_id")
            return conn.execute(query.format(source=source, **bindings)).rowcount
        bindings = dict.fromkeys(RULE_WRITE_COLUMNS, "?")
        return conn.executemany(
            query.format(source="activity_segments AS segment", **bindings), rows,
        ).rowcount

    @staticmethod
    def _unchanged_rule_classifications(conn: sqlite3.Connection, prepared: list[tuple[Any, ...]]) -> set[int]:
        # The caller holds BEGIN IMMEDIATE: these classifications, capture fields,
        # and provenance cannot change between this read and the guarded writes.
        # Keep already-applied rows in the reported count, but retain their stored
        # classification times and sync sequence when their entire meaning agrees.
        unchanged: set[int] = set()
        for offset in range(0, len(prepared), 32):
            batch = prepared[offset:offset + 32]
            # 32 * 22 parameters stays below even SQLite's older 999-value limit.
            values = ",".join(["(" + ",".join(["?"] * 22) + ")"] * len(batch))
            unchanged.update(row[0] for row in conn.execute(
                f"""
                    WITH batch(
                        segment_id, input_fingerprint, category, productivity,
                        confidence, reason, classified_at, refreshed_at, rule_id,
                        captured_id, captured_rule_id, segment_uid, app_name, bundle_id,
                        site_domain, site_url, site_title, window_title,
                        youtube_video_id, youtube_title, started_at, ended_at
                    ) AS (VALUES {values})
                    SELECT batch.segment_id FROM batch
                    JOIN activity_segments AS segment ON segment.id = batch.captured_id
                    LEFT JOIN youtube_video_metadata AS video ON video.video_id = segment.youtube_video_id
                    JOIN activity_classifications AS current ON current.segment_id = segment.id
                    WHERE EXISTS (SELECT 1 FROM classification_rules
                                  WHERE id = batch.captured_rule_id AND enabled = 1)
                      AND segment.segment_uid IS batch.segment_uid
                      AND segment.app_name IS batch.app_name AND segment.bundle_id IS batch.bundle_id
                      AND segment.site_domain IS batch.site_domain AND segment.site_url IS batch.site_url
                      AND segment.site_title IS batch.site_title AND segment.window_title IS batch.window_title
                      AND segment.youtube_video_id IS batch.youtube_video_id AND video.title IS batch.youtube_title
                      AND segment.started_at IS batch.started_at AND segment.ended_at IS batch.ended_at
                      AND current.input_fingerprint IS batch.input_fingerprint
                      AND current.category IS batch.category AND current.productivity IS batch.productivity
                      AND current.source = 'rule' AND current.confidence IS batch.confidence
                      AND current.reason IS batch.reason AND current.classification_rule_id IS batch.rule_id
                      AND current.model IS NULL AND current.prompt_version IS NULL
                      AND current.taxonomy_version IS NULL
                      AND current.request_id IS NULL AND current.latency_ms IS NULL
                      AND current.ai_result = 0 AND current.stale = 0
                      AND EXISTS (SELECT 1 FROM sync_classification_provenance
                                  WHERE segment_id = segment.id AND provenance = 'local-protected'
                                    AND rule_snapshot_kind IS NULL)
                """,
                tuple(value for row in batch for value in row),
            ))
        return unchanged

    # ---- Dev signals -----------------------------------------------------
    #
    # These tables are local-only by design: they are absent from the sync
    # triggers above and must never reach team, leaderboard, or profile
    # surfaces.

    def list_dev_repos(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT repo_key, repo_path, author_email, created_at FROM dev_repos ORDER BY created_at ASC"
            ).fetchall()
        return [dict(row) for row in rows]

    def save_dev_repo(self, repo_key: str, repo_path: str, author_email: str | None) -> dict[str, Any]:
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO dev_repos (repo_key, repo_path, author_email, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(repo_key) DO UPDATE SET
                  repo_path = excluded.repo_path,
                  author_email = excluded.author_email
                """,
                (repo_key, repo_path, author_email, timestamp),
            )
        return {"repoKey": repo_key, "repoPath": repo_path, "authorEmail": author_email}

    def delete_dev_repo(self, repo_key: str) -> int:
        with self.connect() as conn:
            conn.execute("DELETE FROM dev_commit_events WHERE repo_key = ?", (repo_key,))
            cursor = conn.execute("DELETE FROM dev_repos WHERE repo_key = ?", (repo_key,))
            return cursor.rowcount

    def save_dev_commit_events(self, events: list[dict[str, Any]]) -> int:
        """Insert commit events, ignoring ones already stored.

        Ingestion re-reads overlapping windows, so the unique constraint on
        (repo_key, commit_sha) carries the deduplication.
        """
        if not events:
            return 0
        timestamp = datetime.now(timezone.utc).isoformat()
        inserted = 0
        with self.connect() as conn:
            for event in events:
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO dev_commit_events
                      (repo_key, commit_sha, authored_at, insertions, deletions,
                       files_changed, ingested_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event.get("repoKey"),
                        event.get("commitSha"),
                        event.get("authoredAt"),
                        event.get("insertions"),
                        event.get("deletions"),
                        event.get("filesChanged"),
                        timestamp,
                    ),
                )
                inserted += cursor.rowcount
        return inserted

    def fetch_dev_commit_events(self, start: str, end: str) -> list[dict[str, Any]]:
        norm_start = self._normalize_range_bound(start)
        norm_end = self._normalize_range_bound(end)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT repo_key, commit_sha, authored_at, insertions, deletions, files_changed
                FROM dev_commit_events
                WHERE datetime(authored_at) >= datetime(?)
                  AND datetime(authored_at) < datetime(?)
                ORDER BY datetime(authored_at) ASC
                """,
                (norm_start, norm_end),
            ).fetchall()
        return [
            {
                "repoKey": row["repo_key"],
                "commitSha": row["commit_sha"],
                "authoredAt": row["authored_at"],
                "insertions": row["insertions"],
                "deletions": row["deletions"],
                "filesChanged": row["files_changed"],
            }
            for row in rows
        ]

    def save_agent_session_events(
        self,
        events: list[dict[str, Any]],
        *,
        replace_sessions: bool = False,
    ) -> int:
        """Persist turns, optionally replacing each represented session.

        Replacement is valid only when ``events`` contains the complete parsed
        contents of every represented session. Empty or unreadable sources are
        deliberately not represented, so a parser failure cannot erase the
        last known rows.
        """
        if not events:
            return 0
        timestamp = datetime.now(timezone.utc).isoformat()
        keys = [
            (event.get("provider"), event.get("sessionKey"), event.get("turnIndex"))
            for event in events
        ]
        rows = [
            (
                event.get("provider"),
                event.get("sessionKey"),
                event.get("turnIndex"),
                event.get("startedAt"),
                event.get("endedAt"),
                event.get("activeSeconds"),
                event.get("cwdKey"),
                event.get("model"),
                event.get("totalTokens"),
                event.get("tokensIn"),
                event.get("tokensOut"),
                event.get("tokensCacheRead"),
                event.get("tokensCacheWrite"),
                event.get("costUsd"),
                timestamp,
            )
            for event in events
        ]
        with self.connect() as conn:
            existing: set[tuple] = set()
            for provider, session_key, turn_index in keys:
                row = conn.execute(
                    """
                    SELECT 1 FROM agent_session_events
                    WHERE provider = ? AND session_key = ? AND turn_index = ?
                    """,
                    (provider, session_key, turn_index),
                ).fetchone()
                if row is not None:
                    existing.add((provider, session_key, turn_index))
            if replace_sessions:
                session_scopes = {
                    (provider, session_key)
                    for provider, session_key, _ in keys
                    if provider is not None and session_key is not None
                }
                conn.executemany(
                    """
                    DELETE FROM agent_session_events
                    WHERE provider = ? AND session_key = ?
                    """,
                    sorted(session_scopes),
                )
            conn.executemany(
                """
                INSERT INTO agent_session_events
                  (provider, session_key, turn_index, started_at, ended_at,
                   active_seconds, cwd_key, model, total_tokens,
                   tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
                   cost_usd, ingested_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, session_key, turn_index) DO UPDATE SET
                  started_at = excluded.started_at,
                  ended_at = excluded.ended_at,
                  active_seconds = excluded.active_seconds,
                  cwd_key = excluded.cwd_key,
                  model = excluded.model,
                  total_tokens = excluded.total_tokens,
                  tokens_in = excluded.tokens_in,
                  tokens_out = excluded.tokens_out,
                  tokens_cache_read = excluded.tokens_cache_read,
                  tokens_cache_write = excluded.tokens_cache_write,
                  cost_usd = excluded.cost_usd
                """,
                rows,
            )
        return sum(1 for key in keys if key not in existing)

    def fetch_agent_session_events(self, start: str, end: str) -> list[dict[str, Any]]:
        norm_start = self._normalize_range_bound(start)
        norm_end = self._normalize_range_bound(end)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT provider, session_key, turn_index, started_at, ended_at,
                       active_seconds, cwd_key, model, total_tokens,
                       tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost_usd
                FROM agent_session_events
                WHERE datetime(started_at) < datetime(?)
                  AND datetime(ended_at) >= datetime(?)
                ORDER BY datetime(started_at) ASC
                """,
                (norm_end, norm_start),
            ).fetchall()
        return [
            {
                "provider": row["provider"],
                "sessionKey": row["session_key"],
                "turnIndex": row["turn_index"],
                "startedAt": row["started_at"],
                "endedAt": row["ended_at"],
                "activeSeconds": row["active_seconds"],
                "cwdKey": row["cwd_key"],
                "model": row["model"],
                "totalTokens": row["total_tokens"],
                "tokensIn": row["tokens_in"],
                "tokensOut": row["tokens_out"],
                "tokensCacheRead": row["tokens_cache_read"],
                "tokensCacheWrite": row["tokens_cache_write"],
                "costUsd": row["cost_usd"],
            }
            for row in rows
        ]

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
        return [self._serialize_project(row, anchors_by_project.get(row["id"], [])) for row in project_rows]

    @staticmethod
    def _serialize_project(row: sqlite3.Row, anchors: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": row["id"], "name": row["name"], "description": row["description"],
            "color": row["color"], "status": row["status"], "anchors": anchors,
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _get_project(self, project_id: str, *, _conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
        with self._definition_connection(_conn) as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            return self._serialize_project(row, self._get_project_anchors(project_id, _conn=conn)) if row else None

    def save_project(self, project_input: dict[str, Any], *, _conn: sqlite3.Connection | None = None) -> dict[str, Any]:
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
        with self._definition_connection(_conn) as conn:
            existing = conn.execute(
                "SELECT created_at FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            # A project another device made (device sync) keeps its own
            # creation time, so the project list has one order everywhere.
            created_at = existing["created_at"] if existing else (
                self._valid_iso_timestamp(project_input.get("createdAt")) or timestamp
            )
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
        project = self._get_project(project_id, _conn=_conn)
        assert project is not None
        return project

    @staticmethod
    def _valid_iso_timestamp(value: Any) -> str | None:
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat()

    def delete_project(self, project_id: str, *, _conn: sqlite3.Connection | None = None) -> int:
        with self._definition_connection(_conn) as conn:
            conn.execute(
                "UPDATE activity_project_assignments SET project_id = NULL WHERE project_id = ?",
                (project_id,),
            )
            conn.execute(
                "UPDATE project_window_assignments SET project_id = NULL WHERE project_id = ?",
                (project_id,),
            )
            cursor = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cursor.rowcount

    def _get_project_anchors(self, project_id: str, *, _conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        with self._definition_connection(_conn) as conn:
            rows = conn.execute(
                "SELECT kind, value, source FROM project_anchors WHERE project_id = ? ORDER BY id ASC",
                (project_id,),
            ).fetchall()
        return [{"kind": row["kind"], "value": row["value"], "source": row["source"]} for row in rows]

    def save_project_anchors(self, project_id: str, anchors: list[dict[str, Any]], *, _conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        timestamp = datetime.now(timezone.utc).isoformat()
        with self._definition_connection(_conn) as conn:
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
        return self._get_project_anchors(project_id, _conn=_conn)

    def delete_project_anchor(self, project_id: str, kind: str, value: str) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM project_anchors WHERE project_id = ? AND kind = ? AND value = ?",
                (project_id, kind, value),
            )
            return cursor.rowcount

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
                project_id = item.get("projectId", item.get("project_id"))
                # The segment or project can be deleted from another connection after
                # the pass selected it. Skip that row atomically instead of letting a
                # foreign-key failure roll back the rest of the batch (#1492, #1487).
                cursor = conn.execute(
                    """
                    INSERT INTO activity_project_assignments (
                        segment_id, project_id, source, confidence, reason, pass_id, chunk_fingerprint, assigned_at, stale
                    )
                    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                    WHERE EXISTS (SELECT 1 FROM activity_segments WHERE id = ?)
                      AND (? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?))
                    ON CONFLICT(segment_id) DO UPDATE SET
                        project_id = excluded.project_id,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        reason = excluded.reason,
                        pass_id = excluded.pass_id,
                        chunk_fingerprint = excluded.chunk_fingerprint,
                        assigned_at = excluded.assigned_at,
                        stale = excluded.stale
                    WHERE excluded.source = 'manual' OR activity_project_assignments.source != 'manual'
                    """,
                    (
                        segment_id,
                        project_id,
                        source,
                        float(confidence) if confidence is not None else None,
                        item.get("reason"),
                        item.get("passId", item.get("pass_id")),
                        item.get("chunkFingerprint", item.get("chunk_fingerprint")),
                        item.get("assignedAt") or item.get("assigned_at") or timestamp,
                        1 if item.get("stale") else 0,
                        segment_id,
                        project_id,
                        project_id,
                    ),
                )
                if cursor.rowcount > 0:
                    saved += 1
                elif source != "manual":
                    # A manual correction can commit after the optimistic read.
                    # The UPSERT enforces priority while holding the writer lock;
                    # missing segment/project references are not manual skips.
                    current = conn.execute(
                        "SELECT source FROM activity_project_assignments WHERE segment_id = ?",
                        (segment_id,),
                    ).fetchone()
                    if current is not None and current["source"] == "manual":
                        skipped_manual += 1
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

    def save_project_window_assignments(self, assignments: list[dict[str, Any]]) -> dict[str, int]:
        saved = 0
        timestamp = datetime.now(timezone.utc).isoformat()
        if not assignments:
            return {"saved": 0, "skippedManual": 0}
        with self.connect() as conn:
            for item in assignments:
                window_id = str(item.get("windowId", item.get("window_id", ""))).strip()
                window_started_at = str(
                    item.get("windowStartedAt", item.get("window_started_at", ""))
                ).strip()
                window_ended_at = str(
                    item.get("windowEndedAt", item.get("window_ended_at", ""))
                ).strip()
                if not window_id or not window_started_at or not window_ended_at:
                    continue
                try:
                    started_at = parse_iso_datetime(window_started_at)
                    ended_at = parse_iso_datetime(window_ended_at)
                except (TypeError, ValueError):
                    continue
                if ended_at <= started_at:
                    continue

                overlaps: list[dict[str, Any]] = []
                raw_overlaps = item.get("segmentOverlaps", item.get("segment_overlaps", []))
                if isinstance(raw_overlaps, list):
                    for overlap in raw_overlaps:
                        if not isinstance(overlap, dict):
                            continue
                        segment_id = str(overlap.get("segmentId", overlap.get("segment_id", ""))).strip()
                        try:
                            duration_seconds = float(
                                overlap.get("durationSeconds", overlap.get("duration_seconds", 0))
                            )
                        except (TypeError, ValueError):
                            continue
                        if not segment_id or not math.isfinite(duration_seconds) or duration_seconds <= 0:
                            continue
                        overlaps.append(
                            {"segmentId": segment_id, "durationSeconds": duration_seconds}
                        )
                if not overlaps:
                    continue

                project_id = item.get("projectId", item.get("project_id"))
                team_project_id = item.get("teamProjectId", item.get("team_project_id"))
                if project_id and team_project_id:
                    continue
                confidence = item.get("confidence")
                try:
                    duration_seconds = float(
                        item.get(
                            "durationSeconds",
                            item.get("duration_seconds", sum(overlap["durationSeconds"] for overlap in overlaps)),
                        )
                    )
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(duration_seconds) or duration_seconds <= 0:
                    continue

                if not conn.in_transaction:
                    # A daemon idle trim can delete activity while AI results arrive.
                    # Reserve the writer only after structural validation, then keep
                    # reference checks and all window writes serialized.
                    conn.execute("BEGIN IMMEDIATE")
                # A deleted segment invalidates the whole fixed window, just as
                # _delete_project_windows_for_segment_ids does for stored rows.
                # Do not recreate it from a late result or retain its old duration.
                segment_ids = list({overlap["segmentId"] for overlap in overlaps})
                references_exist = True
                for start in range(0, len(segment_ids), ACTIVITY_SEGMENT_DELETE_BATCH_SIZE):
                    batch = segment_ids[start:start + ACTIVITY_SEGMENT_DELETE_BATCH_SIZE]
                    placeholders = ",".join("?" for _ in batch)
                    existing_count = conn.execute(
                        f"SELECT COUNT(*) FROM activity_segments WHERE id IN ({placeholders})",
                        tuple(batch),
                    ).fetchone()[0]
                    if existing_count != len(batch):
                        references_exist = False
                        break
                if not references_exist:
                    continue

                cursor = conn.execute(
                    """
                    INSERT INTO project_window_assignments (
                        window_started_at, window_id, window_ended_at, duration_seconds,
                        segment_overlaps_json, project_id, team_project_id, source,
                        confidence, reason, pass_id, chunk_fingerprint, assigned_at, stale
                    )
                    SELECT ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?, ?
                    WHERE (? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?))
                      AND (? IS NULL OR EXISTS (SELECT 1 FROM team_projects WHERE id = ?))
                    ON CONFLICT(window_started_at) DO UPDATE SET
                        window_id = excluded.window_id,
                        window_ended_at = excluded.window_ended_at,
                        duration_seconds = excluded.duration_seconds,
                        segment_overlaps_json = excluded.segment_overlaps_json,
                        project_id = excluded.project_id,
                        team_project_id = excluded.team_project_id,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        reason = excluded.reason,
                        pass_id = excluded.pass_id,
                        chunk_fingerprint = excluded.chunk_fingerprint,
                        assigned_at = excluded.assigned_at,
                        stale = excluded.stale
                    """,
                    (
                        window_started_at,
                        window_id,
                        window_ended_at,
                        duration_seconds,
                        json.dumps(overlaps, separators=(",", ":")),
                        project_id or None,
                        team_project_id or None,
                        float(confidence) if confidence is not None else None,
                        item.get("reason"),
                        item.get("passId", item.get("pass_id")),
                        item.get("chunkFingerprint", item.get("chunk_fingerprint")),
                        item.get("assignedAt") or item.get("assigned_at") or timestamp,
                        1 if item.get("stale") else 0,
                        project_id or None,
                        project_id or None,
                        team_project_id or None,
                        team_project_id or None,
                    ),
                )
                if cursor.rowcount > 0:
                    saved += 1
        return {"saved": saved, "skippedManual": 0}

    def get_project_window_assignments(
        self, start: str | None = None, end: str | None = None
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM project_window_assignments WHERE 1 = 1"
        params: list[Any] = []
        if start:
            query += " AND datetime(window_ended_at) > datetime(?)"
            params.append(self._normalize_range_bound(start))
        if end:
            query += " AND datetime(window_started_at) < datetime(?)"
            params.append(self._normalize_range_bound(end))
        query += " ORDER BY datetime(window_started_at) ASC"
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()

        result: list[dict[str, Any]] = []
        for row in rows:
            try:
                raw_overlaps = json.loads(row["segment_overlaps_json"])
            except (TypeError, ValueError, json.JSONDecodeError):
                raw_overlaps = []
            overlaps: list[dict[str, Any]] = []
            if isinstance(raw_overlaps, list):
                for overlap in raw_overlaps:
                    if not isinstance(overlap, dict):
                        continue
                    segment_id = str(overlap.get("segmentId", "")).strip()
                    try:
                        overlap_seconds = float(overlap.get("durationSeconds", 0))
                    except (TypeError, ValueError):
                        continue
                    if segment_id and math.isfinite(overlap_seconds) and overlap_seconds > 0:
                        overlaps.append(
                            {"segmentId": segment_id, "durationSeconds": overlap_seconds}
                        )
            result.append(
                {
                    "windowId": row["window_id"],
                    "windowStartedAt": row["window_started_at"],
                    "windowEndedAt": row["window_ended_at"],
                    "durationSeconds": row["duration_seconds"],
                    "segmentOverlaps": overlaps,
                    "projectId": row["project_id"],
                    "teamProjectId": row["team_project_id"],
                    "source": row["source"],
                    "confidence": row["confidence"],
                    "reason": row["reason"],
                    "passId": row["pass_id"],
                    "chunkFingerprint": row["chunk_fingerprint"],
                    "assignedAt": row["assigned_at"],
                    "stale": bool(row["stale"]),
                }
            )
        return result

    def get_activity_block_labels(
        self, start: str | None = None, end: str | None = None
    ) -> list[dict[str, Any]]:
        normalized_start = self._normalize_range_bound(start) if start else None
        normalized_end = self._normalize_range_bound(end) if end else None
        with self.connect() as conn:
            return activity_block_labels.get_labels(conn, normalized_start, normalized_end)

    def save_activity_block_user_label(
        self, label: Any, previous_block_key: Any = None
    ) -> dict[str, Any]:
        with self.connect() as conn:
            return activity_block_labels.save_user_label(conn, label, previous_block_key, parse_iso_datetime)

    def delete_activity_block_user_label(self, block_key: Any) -> dict[str, int]:
        with self.connect() as conn:
            return activity_block_labels.delete_user_label(conn, block_key)

    def get_activity_timeline_cards(
        self, start: str | None = None, end: str | None = None
    ) -> list[dict[str, Any]]:
        normalized_start = self._normalize_range_bound(start) if start else None
        normalized_end = self._normalize_range_bound(end) if end else None
        with self.connect() as conn:
            return activity_timeline_cards.get_windows(conn, normalized_start, normalized_end)

    def save_activity_timeline_window(self, window: Any) -> dict[str, int]:
        with self.connect() as conn:
            return activity_timeline_cards.save_window(conn, window, parse_iso_datetime)

    def get_team_projects(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            project_rows = conn.execute(
                """
                SELECT id, organization_id, name, description, color, status, created_at, updated_at
                FROM team_projects
                ORDER BY organization_id ASC, datetime(updated_at) DESC, id ASC
                """
            ).fetchall()
            anchor_rows = conn.execute(
                "SELECT team_project_id, kind, value, source FROM team_project_anchors ORDER BY id ASC"
            ).fetchall()
        anchors_by_project: dict[str, list[dict[str, Any]]] = {}
        for row in anchor_rows:
            anchors_by_project.setdefault(row["team_project_id"], []).append(
                {"kind": row["kind"], "value": row["value"], "source": row["source"]}
            )
        return [
            {
                "id": row["id"],
                "organizationId": row["organization_id"],
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

    def upsert_team_projects(
        self, organization_id: str, projects: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        org_id = str(organization_id or "").strip()
        if not org_id:
            raise ValueError("organizationId is required")

        prepared: list[dict[str, Any]] = []
        for project_input in projects:
            project_id = str(project_input.get("id") or "").strip()
            if not project_id:
                raise ValueError("team project id is required")
            name = str(project_input.get("name", "")).strip()
            if not name:
                raise ValueError("name is required")
            description = str(project_input.get("description", "")).strip()
            color = str(project_input.get("color", "")).strip() or DEFAULT_PROJECT_COLOR
            status = str(project_input.get("status", "active")).strip() or "active"
            if status not in VALID_PROJECT_STATUSES:
                raise ValueError("status must be 'active' or 'archived'")
            prepared.append(
                {
                    "id": project_id,
                    "name": name,
                    "description": description,
                    "color": color,
                    "status": status,
                    "anchors": project_input.get("anchors") or [],
                }
            )

        incoming_ids = [project["id"] for project in prepared]
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            if incoming_ids:
                placeholders = ", ".join("?" for _ in incoming_ids)
                conn.execute(
                    f"DELETE FROM team_projects WHERE organization_id = ? AND id NOT IN ({placeholders})",
                    [org_id, *incoming_ids],
                )
            else:
                conn.execute(
                    "DELETE FROM team_projects WHERE organization_id = ?",
                    (org_id,),
                )

            for project in prepared:
                existing = conn.execute(
                    "SELECT created_at FROM team_projects WHERE id = ?", (project["id"],)
                ).fetchone()
                created_at = existing["created_at"] if existing else timestamp
                conn.execute(
                    """
                    INSERT INTO team_projects (
                        id, organization_id, name, description, color, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        organization_id = excluded.organization_id,
                        name = excluded.name,
                        description = excluded.description,
                        color = excluded.color,
                        status = excluded.status,
                        updated_at = excluded.updated_at
                    """,
                    (
                        project["id"],
                        org_id,
                        project["name"],
                        project["description"],
                        project["color"],
                        project["status"],
                        created_at,
                        timestamp,
                    ),
                )

                conn.execute(
                    "DELETE FROM team_project_anchors WHERE team_project_id = ?",
                    (project["id"],),
                )
                for anchor in project["anchors"]:
                    kind = str(anchor.get("kind", "")).strip()
                    value = str(anchor.get("value", "")).strip()
                    source = str(anchor.get("source", "harvested")).strip() or "harvested"
                    if kind not in VALID_PROJECT_ANCHOR_KINDS or not value:
                        continue
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO team_project_anchors (
                            team_project_id, kind, value, source, created_at
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (project["id"], kind, value, source, timestamp),
                    )
        return self.get_team_projects()

    def save_team_project_assignments(self, assignments: list[dict[str, Any]]) -> dict[str, int]:
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
                    "SELECT source FROM team_project_assignments WHERE segment_id = ?",
                    (segment_id,),
                ).fetchone()
                if existing is not None and existing["source"] == "manual" and source != "manual":
                    skipped_manual += 1
                    continue

                confidence = item.get("confidence")
                team_project_id = item.get("teamProjectId", item.get("team_project_id"))
                # Same guard as save_project_assignments: a vanished segment or team
                # project skips only its own row (#1492).
                cursor = conn.execute(
                    """
                    INSERT INTO team_project_assignments (
                        segment_id, team_project_id, source, confidence, pass_id, chunk_fingerprint, assigned_at, stale
                    )
                    SELECT ?, ?, ?, ?, ?, ?, ?, ?
                    WHERE EXISTS (SELECT 1 FROM activity_segments WHERE id = ?)
                      AND (? IS NULL OR EXISTS (SELECT 1 FROM team_projects WHERE id = ?))
                    ON CONFLICT(segment_id) DO UPDATE SET
                        team_project_id = excluded.team_project_id,
                        source = excluded.source,
                        confidence = excluded.confidence,
                        pass_id = excluded.pass_id,
                        chunk_fingerprint = excluded.chunk_fingerprint,
                        assigned_at = excluded.assigned_at,
                        stale = excluded.stale
                    WHERE excluded.source = 'manual' OR team_project_assignments.source != 'manual'
                    """,
                    (
                        segment_id,
                        team_project_id,
                        source,
                        float(confidence) if confidence is not None else None,
                        item.get("passId", item.get("pass_id")),
                        item.get("chunkFingerprint", item.get("chunk_fingerprint")),
                        item.get("assignedAt") or item.get("assigned_at") or timestamp,
                        1 if item.get("stale") else 0,
                        segment_id,
                        team_project_id,
                        team_project_id,
                    ),
                )
                if cursor.rowcount > 0:
                    saved += 1
                elif source != "manual":
                    # A manual correction can commit after the optimistic read.
                    # The UPSERT enforces priority while holding the writer lock;
                    # missing segment/project references are not manual skips.
                    current = conn.execute(
                        "SELECT source FROM team_project_assignments WHERE segment_id = ?",
                        (segment_id,),
                    ).fetchone()
                    if current is not None and current["source"] == "manual":
                        skipped_manual += 1
        return {"saved": saved, "skippedManual": skipped_manual}

    def get_team_project_assignments(
        self, start: str | None = None, end: str | None = None
    ) -> list[dict[str, Any]]:
        query = """
            SELECT
                a.segment_id,
                a.team_project_id,
                a.source,
                a.confidence,
                a.pass_id,
                a.chunk_fingerprint,
                a.assigned_at,
                a.stale
            FROM team_project_assignments a
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
                "teamProjectId": row["team_project_id"],
                "source": row["source"],
                "confidence": row["confidence"],
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

    _AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS = (
        "input_fingerprint",
        "category",
        "productivity",
        "source",
        "confidence",
        "reason",
        "model",
        "prompt_version",
        "taxonomy_version",
        "request_id",
        "latency_ms",
        "classified_at",
        "refreshed_at",
        "ai_result",
        "stale",
        "classification_rule_id",
    )
    _AI_REVIEW_RULE_SNAPSHOT_KIND_KEY = "rule_snapshot_kind"

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
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            return self._save_ai_review_events(conn, events, timestamp)

    @staticmethod
    def _save_ai_review_events(
        conn: sqlite3.Connection,
        events: list[dict[str, Any]],
        timestamp: str,
        *,
        capture_classification_snapshots: bool = False,
    ) -> int:
        saved = 0
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
            previous_snapshot = event.get("_previousClassification")
            applied_snapshot = event.get("_appliedClassification")
            if capture_classification_snapshots:
                previous_snapshot_json = json.dumps(
                    previous_snapshot, separators=(",", ":"), sort_keys=True
                )
                applied_snapshot_json = json.dumps(
                    applied_snapshot, separators=(",", ":"), sort_keys=True
                )
            else:
                # The legacy public event command cannot supply restore state.
                # Only the atomic classification writer owns these snapshots.
                previous_snapshot_json = None
                applied_snapshot_json = None
            # pass_id references project_pass_runs; an event whose segment is gone
            # can never be shown or reverted. Skip either case per row (#1492).
            cursor = conn.execute(
                """
                INSERT INTO ai_review_events (
                    segment_id, pass_id, prev_category, prev_productivity, prev_source,
                    new_category, new_productivity, confidence, reason, created_at, reverted_at,
                    prev_classification_json, applied_classification_json
                )
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?
                WHERE EXISTS (SELECT 1 FROM activity_segments WHERE id = ?)
                  AND EXISTS (SELECT 1 FROM project_pass_runs WHERE id = ?)
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
                    previous_snapshot_json,
                    applied_snapshot_json,
                    segment_id,
                    pass_id,
                ),
            )
            if cursor.rowcount > 0:
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
            # Reserve the writer before reading either the event or the current
            # classification. The ownership check and restore are one snapshot.
            if not conn.in_transaction:
                conn.execute("BEGIN IMMEDIATE")
            event = conn.execute(
                "SELECT * FROM ai_review_events WHERE id = ?", (event_id,)
            ).fetchone()
            if event is None or event["reverted_at"] is not None:
                return {"reverted": False, "restored": False}

            snapshot_columns = ", ".join(
                f"c.{column}" for column in self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS
            )
            current = conn.execute(
                f"""
                SELECT {snapshot_columns}, p.rule_snapshot_kind
                FROM activity_classifications c
                LEFT JOIN sync_classification_provenance p ON p.segment_id = c.segment_id
                WHERE c.segment_id = ?
                """,
                (event["segment_id"],),
            ).fetchone()
            newer_event = conn.execute(
                "SELECT 1 FROM ai_review_events WHERE segment_id = ? AND id > ? AND reverted_at IS NULL LIMIT 1",
                (event["segment_id"], event["id"]),
            ).fetchone()
            restored = False
            restored_rule_snapshot_kind = None
            previous_snapshot_json = event["prev_classification_json"]
            applied_snapshot_json = event["applied_classification_json"]
            if current is not None and newer_event is None:
                if previous_snapshot_json is not None or applied_snapshot_json is not None:
                    try:
                        previous_snapshot = json.loads(previous_snapshot_json)
                        applied_snapshot = json.loads(applied_snapshot_json)
                    except (TypeError, json.JSONDecodeError):
                        previous_snapshot = None
                        applied_snapshot = None
                    expected_columns = set(self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS)
                    expected_with_meaning = expected_columns | {
                        self._AI_REVIEW_RULE_SNAPSHOT_KIND_KEY
                    }
                    snapshots_have_meaning = (
                        isinstance(previous_snapshot, dict)
                        and isinstance(applied_snapshot, dict)
                        and set(previous_snapshot) == expected_with_meaning
                        and set(applied_snapshot) == expected_with_meaning
                    )
                    legacy_full_snapshots = (
                        isinstance(previous_snapshot, dict)
                        and isinstance(applied_snapshot, dict)
                        and set(previous_snapshot) == expected_columns
                        and set(applied_snapshot) == expected_columns
                    )
                    current_snapshot = dict(current)
                    current_classification = {
                        column: current[column]
                        for column in self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS
                    }
                    applied_matches = (
                        snapshots_have_meaning and current_snapshot == applied_snapshot
                    ) or (
                        legacy_full_snapshots
                        and current_classification == applied_snapshot
                        and current[self._AI_REVIEW_RULE_SNAPSHOT_KIND_KEY] is None
                    )
                    previous_meaning = (
                        previous_snapshot.get(self._AI_REVIEW_RULE_SNAPSHOT_KIND_KEY)
                        if snapshots_have_meaning
                        else None
                    )
                    if (
                        (snapshots_have_meaning or legacy_full_snapshots)
                        and applied_snapshot["source"] == "ai_review"
                        and applied_matches
                        and previous_meaning in (None, "synced-rule")
                    ):
                        assignments = ", ".join(
                            f"{column} = ?" for column in self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS
                        )
                        conn.execute(
                            f"UPDATE activity_classifications SET {assignments} WHERE segment_id = ?",
                            tuple(previous_snapshot[column]
                                  for column in self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS)
                            + (event["segment_id"],),
                        )
                        restored_rule_snapshot_kind = previous_meaning
                        restored = True
                elif (
                    # Legacy events have no complete snapshot. Preserve their
                    # historical label-only behavior, but apply the same
                    # ownership/latest-event guard and never infer metadata.
                    current["source"] == "ai_review"
                    and current["category"] == event["new_category"]
                    and current["productivity"] == event["new_productivity"]
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
                if restored:
                    # Revert itself is a deliberate local user choice. Restore the
                    # prior rule meaning, but never restore prior sync ownership.
                    conn.execute(
                        """
                        INSERT INTO sync_classification_provenance(
                            segment_id, provenance, rule_snapshot_kind
                        ) VALUES (?, 'local-protected', ?)
                        ON CONFLICT(segment_id) DO UPDATE SET
                            provenance = 'local-protected',
                            rule_snapshot_kind = excluded.rule_snapshot_kind
                        """,
                        (event["segment_id"], restored_rule_snapshot_kind),
                    )
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

                # A project review opts into one atomic correction + audit write.
                # Read the actual previous row under the same writer reservation.
                review_pass_id = item.get("reviewPassId", item.get("review_pass_id"))
                review_previous = None
                if source == "ai_review" and review_pass_id is not None:
                    try:
                        review_pass_id = int(review_pass_id)
                    except (TypeError, ValueError):
                        continue
                    if not conn.in_transaction:
                        conn.execute("BEGIN IMMEDIATE")
                    if conn.execute("SELECT 1 FROM project_pass_runs WHERE id = ?", (review_pass_id,)).fetchone() is None:
                        continue
                    if conn.execute(
                        "SELECT 1 FROM ai_review_events WHERE segment_id = ? AND reverted_at IS NOT NULL LIMIT 1",
                        (segment_id,),
                    ).fetchone() is not None:
                        continue
                    review_snapshot_columns = ", ".join(
                        f"c.{column}"
                        for column in self._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS
                    )
                    review_previous = conn.execute(
                        f"""
                        SELECT {review_snapshot_columns}, p.rule_snapshot_kind
                        FROM activity_classifications c
                        LEFT JOIN sync_classification_provenance p
                          ON p.segment_id = c.segment_id
                        WHERE c.segment_id = ?
                        """,
                        (segment_id,),
                    ).fetchone()
                    if review_previous is None:
                        continue
                    if (review_previous["category"] == item["category"]
                            and review_previous["productivity"] == item["productivity"]):
                        continue

                # A classifier can select an unclassified segment, then finish after the
                # user has corrected it. Resolve that race atomically at the write.
                # The segment (or its rule) can also disappear before the result lands:
                # an idle trim, a history deletion, or a rule deletion commits from
                # another connection. Skip that row inside the same statement instead of
                # letting a foreign-key failure roll back every other row in the batch.
                # Repeated fresh built-in answers are not refresh events. Compare
                # their meaning in the UPSERT itself so overlapping readers cannot
                # both bump sync_seq. Keep the first timestamps, but still let an
                # ordinary local write clear any existing sync/protection marker.
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
                    )
                    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    WHERE EXISTS (SELECT 1 FROM activity_segments WHERE id = ?)
                      AND (
                        ? IS NULL
                        OR EXISTS (SELECT 1 FROM classification_rules WHERE id = ? AND enabled = 1)
                      )
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
                    WHERE (
                        excluded.source = 'manual'
                        OR (
                          activity_classifications.source != 'manual'
                          AND (
                            activity_classifications.source != 'rule'
                            OR activity_classifications.classification_rule_id IS NULL
                            OR excluded.classification_rule_id IS NOT NULL
                          )
                        )
                    )
                    AND NOT (
                        excluded.source IN ('app-db', 'domain-db', 'youtube')
                        AND excluded.ai_result = 0
                        AND excluded.stale = 0
                        AND excluded.taxonomy_version IS NOT NULL
                        AND excluded.taxonomy_version IS NOT ''
                        AND activity_classifications.input_fingerprint IS excluded.input_fingerprint
                        AND activity_classifications.category IS excluded.category
                        AND activity_classifications.productivity IS excluded.productivity
                        AND activity_classifications.source IS excluded.source
                        AND activity_classifications.confidence IS excluded.confidence
                        AND activity_classifications.reason IS excluded.reason
                        AND activity_classifications.model IS excluded.model
                        AND activity_classifications.prompt_version IS excluded.prompt_version
                        AND activity_classifications.taxonomy_version IS excluded.taxonomy_version
                        AND activity_classifications.request_id IS excluded.request_id
                        AND activity_classifications.latency_ms IS excluded.latency_ms
                        AND activity_classifications.ai_result IS excluded.ai_result
                        AND activity_classifications.stale IS excluded.stale
                        AND activity_classifications.classification_rule_id IS excluded.classification_rule_id
                        AND NOT EXISTS (
                            SELECT 1 FROM sync_classification_provenance
                            WHERE segment_id = excluded.segment_id
                        )
                    )
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
                        segment_id,
                        classification_rule_id,
                        classification_rule_id,
                    ),
                )
                if cursor.rowcount > 0:
                    saved += cursor.rowcount
                    if source == "ai_review" and review_pass_id is not None:
                        review_applied = conn.execute(
                            f"""
                            SELECT {review_snapshot_columns}, p.rule_snapshot_kind
                            FROM activity_classifications c
                            LEFT JOIN sync_classification_provenance p
                              ON p.segment_id = c.segment_id
                            WHERE c.segment_id = ?
                            """,
                            (segment_id,),
                        ).fetchone()
                        event_saved = self._save_ai_review_events(conn, [{
                            "segmentId": segment_id,
                            "passId": review_pass_id,
                            "prevCategory": review_previous["category"],
                            "prevProductivity": review_previous["productivity"],
                            "prevSource": review_previous["source"],
                            "newCategory": item["category"],
                            "newProductivity": item["productivity"],
                            "confidence": item.get("confidence"),
                            "reason": item.get("reason"),
                            "_previousClassification": dict(review_previous),
                            "_appliedClassification": dict(review_applied),
                        }], timestamp, capture_classification_snapshots=True)
                        if event_saved != 1:
                            raise sqlite3.IntegrityError("Unable to record the applied AI review correction")
                        conn.execute(
                            "UPDATE project_pass_runs SET corrections_count = COALESCE(corrections_count, 0) + 1 WHERE id = ?",
                            (review_pass_id,),
                        )
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
        # Keep rules, user edits, and AI-review corrections. The AI review
        # writer defaults ai_result to 0, but its correction is still an AI
        # result and has its own explicit Revert action.
        query = "DELETE FROM activity_classifications WHERE ai_result != 1 AND source NOT IN ('rule', 'manual', 'ai_review')"
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

    def _classification_provenance_source(self) -> str:
        # Read-only CLI queries may inspect a DB before a new app has migrated
        # it. Preserve that read-only contract and never invent legacy meaning.
        if self.read_only and self.connect().execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' "
            "AND name = 'sync_classification_provenance'"
        ).fetchone() is None:
            return "(SELECT NULL AS segment_id, NULL AS rule_snapshot_kind)"
        return "sync_classification_provenance"

    def timeline(self, start: str | None = None, end: str | None = None, limit: int | None = None):
        query = f"""
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
                activity_classifications.classification_rule_id AS classification_rule_id,
                sync_classification_provenance.rule_snapshot_kind AS classification_rule_snapshot_kind
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            LEFT JOIN {self._classification_provenance_source()} AS sync_classification_provenance
              ON sync_classification_provenance.segment_id = activity_classifications.segment_id
            WHERE 1=1
        """
        # Sort only identities: joining large video descriptions before the
        # sort can spill many copies of the same metadata to SQLite temp files.
        # Keep the established timestamp ordering, bounds and limit semantics.
        ids_query = "SELECT id FROM activity_segments WHERE 1=1"
        params: list[Any] = []
        ids_query = self._append_timeline_overlap_filters(ids_query, params, start, end)
        ids_query += " ORDER BY started_at ASC"
        if limit:
            ids_query += " LIMIT ?"
            params.append(limit)
        with self.connect() as conn:
            # Python's connection context does not start transactions for
            # SELECTs. Pin every detail batch to the identity query's snapshot
            # so concurrent recording, edits or deletions cannot mix versions.
            if not conn.in_transaction:
                conn.execute("BEGIN")
            segment_ids = [row[0] for row in conn.execute(ids_query, tuple(params))]
            rows = []
            for offset in range(0, len(segment_ids), DEFAULT_TIMELINE_PAGE_LIMIT):
                batch = segment_ids[offset:offset + DEFAULT_TIMELINE_PAGE_LIMIT]
                placeholders = ",".join("?" for _ in batch)
                details = fetch_row_dicts(
                    conn, query + f" AND activity_segments.id IN ({placeholders})", tuple(batch),
                )
                by_id = {row["id"]: row for row in details}
                rows.extend(by_id[segment_id] for segment_id in batch)
        return rows

    def timeline_page(
        self,
        start: str | None = None,
        end: str | None = None,
        before_ended_at: str | None = None,
        before_segment_id: str | int | None = None,
        limit: int | str | None = None,
    ) -> dict[str, Any]:
        page_limit = self._clamp_timeline_page_limit(limit)
        query = f"""
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
                activity_classifications.classification_rule_id AS classification_rule_id,
                sync_classification_provenance.rule_snapshot_kind AS classification_rule_snapshot_kind
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            LEFT JOIN {self._classification_provenance_source()} AS sync_classification_provenance
              ON sync_classification_provenance.segment_id = activity_classifications.segment_id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_timeline_overlap_filters(query, params, start, end, "activity_segments")
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
            rows = fetch_row_dicts(conn, query, tuple(params))

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
        sql = f"""
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
                activity_classifications.classification_rule_id AS classification_rule_id,
                sync_classification_provenance.rule_snapshot_kind AS classification_rule_snapshot_kind
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            LEFT JOIN {self._classification_provenance_source()} AS sync_classification_provenance
              ON sync_classification_provenance.segment_id = activity_classifications.segment_id
            LEFT JOIN activity_project_assignments
              ON activity_project_assignments.segment_id = activity_segments.id
            LEFT JOIN projects
              ON projects.id = activity_project_assignments.project_id
            WHERE 1=1
        """
        params: list[Any] = []
        sql = self._append_timeline_overlap_filters(sql, params, start, end, "activity_segments")
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
            rows = fetch_row_dicts(conn, sql, tuple(params))

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
        query = f"""
            SELECT
                activity_segments.id,
                activity_segments.sync_seq,
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
                activity_segments.engagement_evidence,
                activity_segments.origin_device_id,
                activity_segments.exclusion_source,
                youtube_video_metadata.category AS youtube_category,
                youtube_video_metadata.channel_name AS youtube_channel_name,
                youtube_video_metadata.title AS youtube_title,
                activity_classifications.category AS classification_category,
                activity_classifications.productivity AS classification_productivity,
                activity_classifications.source AS classification_source,
                activity_classifications.confidence AS classification_confidence,
                activity_classifications.ai_result AS classification_ai_result,
                activity_classifications.taxonomy_version AS classification_taxonomy_version,
                activity_classifications.stale AS classification_stale,
                activity_classifications.classification_rule_id AS classification_rule_id,
                sync_classification_provenance.rule_snapshot_kind AS classification_rule_snapshot_kind
            FROM activity_segments
            LEFT JOIN youtube_video_metadata
              ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
            LEFT JOIN activity_classifications
              ON activity_classifications.segment_id = activity_segments.id
            LEFT JOIN {self._classification_provenance_source()} AS sync_classification_provenance
              ON sync_classification_provenance.segment_id = activity_classifications.segment_id
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_timeline_overlap_filters(query, params, start, end, "activity_segments")
        query += " ORDER BY activity_segments.started_at ASC"
        with self.connect() as conn:
            rows = fetch_row_dicts(conn, query, tuple(params))
        return [serialize_dashboard_week_activity_row(row) for row in rows]

    def project_trend_timeline(self, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
        # Minimal segment view for the Projects tab trend chart + detail sources:
        # attribution happens client-side against project assignments, so only
        # identity, device, timing, and app/site labels are needed. window_title,
        # site_title, and site_source feed the hide-uncertain-site-context rule
        # and are not serialized.
        query = """
            SELECT
                id,
                started_at,
                ended_at,
                duration_seconds,
                app_name,
                bundle_id,
                site_domain,
                window_title,
                site_title,
                site_source,
                origin_device_id,
                platform,
                source
            FROM activity_segments
            WHERE 1=1
        """
        params: list[Any] = []
        query = self._append_timeline_overlap_filters(query, params, start, end)
        query += " ORDER BY started_at ASC"
        with self.connect() as conn:
            rows = fetch_row_dicts(conn, query, tuple(params))
        return [serialize_project_trend_activity_row(row) for row in rows]

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
        sync_key = (
            {"syncKey": TrackerDatabase._classification_rule_sync_key(row)}
            if "normalized_target_value" in row.keys()
            else {}
        )
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
            **sync_key,
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
        try:
            return f"[{IPv6Address(text).compressed}]"
        except ValueError:
            pass
        try:
            parsed = urlparse(text if "://" in text else f"//{text}")
            host = parsed.hostname or text.split("/", 1)[0].split(":", 1)[0]
        except ValueError:
            # Captured metadata can have a malformed URL and no site_domain.
            # It cannot match a site rule, but must not abort the rules batch.
            return ""
        if ":" in host:
            try:
                return f"[{IPv6Address(host).compressed}]"
            except ValueError:
                return ""
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
        # Normalize each captured field once per segment instead of repeating
        # URL parsing for every rule. Batch preparation runs before the writer.
        surfaces: dict[str, str] = {}
        details: dict[str, set[str]] = {}
        for rule in rules:
            if not self._rule_surface_matches(segment, rule, surfaces):
                continue
            if rule["match_scope"] == "detail" and not self._rule_detail_matches(segment, rule, details):
                continue
            return rule
        return None

    def _first_detail_match(
        self, segment: sqlite3.Row, rules: list[Any], details: dict[str, set[str]],
    ) -> Any | None:
        """The first of these rules, whose surfaces already match, that also matches in detail."""
        for rule in rules:
            if rule["match_scope"] == "detail" and not self._rule_detail_matches(segment, rule, details):
                continue
            return rule
        return None

    def _rule_surface_matches(
        self, segment: sqlite3.Row, rule: sqlite3.Row, normalized: dict[str, str],
    ) -> bool:
        if rule["target_kind"] == "site":
            if "site" not in normalized:
                normalized["site"] = self._normalize_site_target(segment["site_domain"] or segment["site_url"])
            host = normalized["site"]
            target = rule["normalized_target_value"]
            return bool(host and (host == target or host.endswith(f".{target}")))

        bundle_id = segment["bundle_id"]
        target = rule["target_value"]
        if (self._looks_like_bundle_id(target) or bundle_id) and bundle_id == target:
            return True
        if "app" not in normalized:
            normalized["app"] = self._normalize_app_target(segment["app_name"])
        return normalized["app"] == rule["normalized_target_value"]

    def _rule_detail_matches(
        self, segment: sqlite3.Row, rule: sqlite3.Row, normalized: dict[str, set[str]],
    ) -> bool:
        normalized_detail_value = rule["normalized_detail_value"]
        if not normalized_detail_value:
            return False
        detail_kind = rule["detail_kind"]
        if detail_kind not in normalized:
            normalized[detail_kind] = self._normalized_segment_rule_details(segment, detail_kind)
        return normalized_detail_value in normalized[detail_kind]

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
        previous = TrackerDatabase._timestamp_seconds(previous_end)
        current = TrackerDatabase._timestamp_seconds(next_observed_at)
        gap_seconds = current - previous
        # A backward wall-clock correction must not move a committed segment's
        # end before its start. Preserve that interval and record a new sample.
        return gap_seconds >= 0 and (
            max_merge_gap_seconds is None or gap_seconds <= max_merge_gap_seconds
        )

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
        return sanitized_raw_context_json(json.dumps(updated_context)) or "{}"

    @staticmethod
    def _snapshot_raw_context_json(snapshot: Snapshot) -> str:
        raw_context = asdict(snapshot)
        adaptive_context = raw_context.pop("adaptive_content_context", None)
        if adaptive_context is not None:
            raw_context["adaptive_content_context"] = adaptive_context
        return sanitized_raw_context_json(json.dumps(raw_context)) or "{}"

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
