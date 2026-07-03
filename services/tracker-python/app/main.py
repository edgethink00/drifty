from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Literal

APP_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = APP_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from app.storage.db import BrowserHistoryBackfillConfig, TrackerDatabase

if TYPE_CHECKING:
    from app.tracker.macos_workspace import Snapshot
    from app.tracker.power_state import PowerStateSample
    from app.tracker.youtube_metadata import YouTubeVideoMetadata

DB_PATH = APP_DIR / "drifty_tracker.sqlite3"
SAMPLE_SECONDS = int(os.environ.get("DRIFTY_SAMPLE_SECONDS", "5"))
IDLE_THRESHOLD_SECONDS = int(os.environ.get("DRIFTY_IDLE_THRESHOLD_SECONDS", "180"))
YOUTUBE_METADATA_TIMEOUT_SECONDS = float(os.environ.get("DRIFTY_YOUTUBE_METADATA_TIMEOUT_SECONDS", "2"))
FORCE_CHROMIUM_AX_CAPTURE_META_KEY = "developer_diagnostics_force_chromium_ax_capture"
FORCE_CHROMIUM_AX_CAPTURE_ENV = "DRIFTY_FORCE_CHROMIUM_AX_CAPTURE"
FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY = "developer_diagnostics_force_frontmost_fallback_capture"
FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV = "DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE"
FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY = "developer_diagnostics_force_browser_history_url_fallback"
FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV = "DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK"
TRACKER_RUNTIME_FINGERPRINT_META_KEY = "tracker_runtime_fingerprint"
_YOUTUBE_METADATA_IN_FLIGHT: set[str] = set()
_YOUTUBE_METADATA_LOCK = threading.Lock()
RuntimeMode = Literal["source", "frozen"]


def response(ok: bool, data=None, error: str | None = None):
    return {"ok": ok, "data": data, "error": error}


def state_dir() -> Path:
    return DB_PATH.parent / ".state"


def pid_path() -> Path:
    return state_dir() / "tracker.pid"


def ensure_state_dir() -> None:
    state_dir().mkdir(parents=True, exist_ok=True)


def database() -> TrackerDatabase:
    return TrackerDatabase(DB_PATH)


def accessibility_granted() -> bool:
    from app.permissions.accessibility import accessibility_granted as read_accessibility_granted

    return read_accessibility_granted()


def seconds_since_last_input() -> float | None:
    from app.tracker.idle import seconds_since_last_input as read_seconds_since_last_input

    return read_seconds_since_last_input()


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    from app.tracker.macos_workspace import current_snapshot as read_current_snapshot

    return read_current_snapshot(include_system_transient=include_system_transient)


def current_power_state() -> PowerStateSample:
    from app.tracker.power_state import current_power_state as read_current_power_state

    return read_current_power_state()


def fetch_youtube_metadata(site_url: str, video_id: str, timeout_seconds: float) -> YouTubeVideoMetadata:
    from app.tracker.youtube_metadata import fetch_youtube_metadata as read_youtube_metadata

    return read_youtube_metadata(site_url, video_id, timeout_seconds=timeout_seconds)


def fetch_live_tail(
    db: TrackerDatabase,
    start: str | None,
    end: str | None,
    after_segment_id: str | None,
    after_ended_at: str | None,
    limit: int | str | None = 8,
) -> list[dict[str, object]]:
    from app.storage.live_tail import fetch_live_tail as read_fetch_live_tail

    return read_fetch_live_tail(db, start, end, after_segment_id, after_ended_at, limit)


def backfill_browser_history_context(db: TrackerDatabase, observed_at: str) -> None:
    from app.tracker.browser_history import (
        BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS,
        browser_history_metadata,
        is_retryable_browser_history_window_title,
    )

    results = db.backfill_recent_browser_history_context(
        browser_history_metadata,
        is_retryable_browser_history_window_title,
        BrowserHistoryBackfillConfig(
            observed_at=observed_at,
            max_age_seconds=BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS,
        ),
    )
    for result in results:
        enqueue_youtube_metadata_fetch(DB_PATH, result.youtube_video_id, result.site_url)


def _apply_developer_diagnostics_env(db: TrackerDatabase) -> None:
    force_chromium_ax_capture = db.get_meta(FORCE_CHROMIUM_AX_CAPTURE_META_KEY) == "true"
    force_frontmost_fallback_capture = db.get_meta(FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY) == "true"
    force_browser_history_url_fallback = db.get_meta(FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY) == "true"
    os.environ[FORCE_CHROMIUM_AX_CAPTURE_ENV] = "1" if force_chromium_ax_capture else "0"
    os.environ[FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV] = "1" if force_frontmost_fallback_capture else "0"
    os.environ[FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV] = "1" if force_browser_history_url_fallback else "0"


def _apply_developer_diagnostics_defaults() -> None:
    os.environ[FORCE_CHROMIUM_AX_CAPTURE_ENV] = "0"
    os.environ[FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV] = "0"
    os.environ[FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV] = "0"


def _bool_meta(value: str | None) -> bool | None:
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def _bool_payload(value: object) -> bool:
    return value is True


def _int_payload(value: object, *, default: int, min_value: int, max_value: int, name: str) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    return min(max(value, min_value), max_value)


def _float_meta(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def day_bounds(payload: dict) -> tuple[str | None, str | None]:
    if payload.get("day"):
        day = payload["day"]
        return f"{day}T00:00:00", f"{day}T23:59:59"
    return payload.get("start"), payload.get("end")


def _datetime_payload(value: object, *, name: str) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} must be an ISO datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _browser_history_profile_roots_payload(value: object) -> dict[str, Path] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("profileRoots must be an object")
    roots: dict[str, Path] = {}
    for browser_name, root in value.items():
        if not isinstance(browser_name, str) or not isinstance(root, str):
            raise ValueError("profileRoots must map browser names to paths")
        roots[browser_name] = Path(root)
    return roots


def _browser_history_import_request(payload: dict):
    from app.tracker.browser_history_import import BrowserHistoryImportRequest, DEFAULT_LOOKBACK_DAYS

    return BrowserHistoryImportRequest(
        lookback_days=_int_payload(
            payload.get("lookbackDays"),
            default=DEFAULT_LOOKBACK_DAYS,
            min_value=1,
            max_value=30,
            name="lookbackDays",
        ),
        observed_at=_datetime_payload(payload.get("observedAt"), name="observedAt"),
        profile_roots=_browser_history_profile_roots_payload(payload.get("profileRoots")),
    )


def is_running() -> bool:
    pid_file = pid_path()
    if not pid_file.exists():
        return False
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
        return True
    except Exception:
        pid_file.unlink(missing_ok=True)
        return False


def _read_tracker_pid() -> int | None:
    try:
        return int(pid_path().read_text().strip())
    except Exception:
        return None


def _process_command(pid: int) -> str | None:
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _current_script_path() -> str:
    return str(Path(__file__).resolve())


def _current_runtime_mode() -> RuntimeMode:
    return "frozen" if getattr(sys, "frozen", False) else "source"


def _daemon_command(mode: str) -> list[str]:
    if _current_runtime_mode() == "frozen":
        return [sys.executable, mode, "--db", str(DB_PATH)]
    return [sys.executable, _current_script_path(), mode, "--db", str(DB_PATH)]


def _tracker_runtime_source_files() -> list[Path]:
    return [
        path
        for path in APP_DIR.rglob("*.py")
        if "__pycache__" not in path.parts
    ]


def _tracker_runtime_fingerprint() -> str:
    digest = hashlib.sha256()
    if _current_runtime_mode() == "frozen":
        executable = Path(sys.executable)
        digest.update(b"frozen\0")
        digest.update(str(executable).encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(executable.read_bytes())
        except OSError as exc:
            digest.update(f"read-error:{type(exc).__name__}".encode("utf-8"))
            digest.update(b"\0")
            try:
                executable_stat = executable.stat()
                digest.update(f"{executable_stat.st_size}:{executable_stat.st_mtime_ns}".encode("utf-8"))
            except OSError as stat_exc:
                digest.update(f"stat-error:{type(stat_exc).__name__}".encode("utf-8"))
        return digest.hexdigest()

    digest.update(b"source\0")
    for path in sorted(_tracker_runtime_source_files()):
        digest.update(str(path.relative_to(APP_DIR)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _running_daemon_matches_current_script(pid: int) -> bool:
    command = _process_command(pid)
    if not command:
        return True
    current_script = _current_script_path()
    if _current_runtime_mode() == "frozen":
        if "tracker-python" in command and "main.py" in command:
            return False
        if sys.executable in command and "daemon" in command:
            return True
        return True
    if current_script in command:
        return True
    if "tracker-python" in command and "main.py" in command:
        return False
    return True


def _running_daemon_matches_current_runtime(pid: int, db: TrackerDatabase) -> bool:
    if not _running_daemon_matches_current_script(pid):
        return False
    return db.get_meta(TRACKER_RUNTIME_FINGERPRINT_META_KEY) == _tracker_runtime_fingerprint()


def _stop_stale_tracker_daemon(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    pid_path().unlink(missing_ok=True)


def start_tracking():
    ensure_state_dir()
    if is_running():
        pid = _read_tracker_pid()
        if pid is None or _running_daemon_matches_current_runtime(pid, database()):
            return response(True, get_status()["data"])
        _stop_stale_tracker_daemon(pid)
        time.sleep(0.25)

    command = _daemon_command("daemon")
    subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(0.25)
    status = get_status()["data"]
    if not status.get("running"):
        return response(False, status, "Tracker daemon did not start.")
    return response(True, status)


def stop_tracking():
    pid_file = pid_path()
    if not pid_file.exists():
        return response(True, get_status()["data"])

    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except Exception as exc:
        return response(False, error=str(exc))
    finally:
        pid_file.unlink(missing_ok=True)

    return response(True, get_status()["data"])


def get_status():
    db = database()
    last_event_at = db.get_meta("last_event_at")
    running = is_running()
    tracker_mode = db.get_meta("tracker_mode") if running else None
    effective_tracker_mode = tracker_mode or ("tracking" if running else "idle")
    message = "Tracker stopped."
    if running:
        message = "Tracker idle due to inactivity." if effective_tracker_mode == "idle" else "Tracker running."

    return response(
        True,
        {
            "running": running,
            "accessibilityGranted": accessibility_granted(),
            "lastEventAt": last_event_at,
            "databasePath": str(DB_PATH),
            "trackerMode": effective_tracker_mode,
            "idleSeconds": _float_meta(db.get_meta("idle_seconds")) if running else None,
            "idleDetectionAvailable": _bool_meta(db.get_meta("idle_detection_available")),
            "message": message,
        },
    )


def get_timeline(payload: dict):
    db = database()
    if payload.get("day"):
        return response(True, db.fetch_timeline(payload["day"]))
    start, end = day_bounds(payload)
    items = [db._serialize_row(row) for row in db.timeline(start, end)]
    return response(True, items)


def get_timeline_page(payload: dict):
    safe_payload = payload if isinstance(payload, dict) else {}
    db = database()
    start, end = day_bounds(safe_payload)
    return response(
        True,
        db.timeline_page(
            start=start,
            end=end,
            before_ended_at=safe_payload.get("beforeEndedAt"),
            before_segment_id=safe_payload.get("beforeSegmentId"),
            limit=safe_payload.get("limit"),
        ),
    )


def search_timeline(payload: dict):
    safe_payload = payload if isinstance(payload, dict) else {}
    query = safe_payload.get("query", "")
    if not isinstance(query, str):
        query = ""
    db = database()
    start, end = day_bounds(safe_payload)
    return response(
        True,
        db.search_timeline_page(
            query=query,
            start=start,
            end=end,
            before_ended_at=safe_payload.get("beforeEndedAt"),
            before_segment_id=safe_payload.get("beforeSegmentId"),
            limit=safe_payload.get("limit"),
        ),
    )


def get_dashboard_week_timeline(payload: dict):
    db = database()
    start, end = day_bounds(payload)
    return response(True, db.dashboard_week_timeline(start, end))


def get_live_tail(payload: dict):
    safe_payload = payload if isinstance(payload, dict) else {}
    db = database()
    start, end = day_bounds(safe_payload)
    running = is_running()
    tracker_mode = db.get_meta("tracker_mode") if running else None

    segments = fetch_live_tail(
        db,
        start,
        end,
        safe_payload.get("afterSegmentId"),
        safe_payload.get("afterEndedAt"),
        safe_payload.get("limit", 8),
    )
    return response(
        True,
        {
            "running": running,
            "trackerMode": tracker_mode or ("tracking" if running else "idle"),
            "lastEventAt": db.get_meta("last_event_at"),
            "segments": segments,
        },
    )


def get_hourly_summary(payload: dict):
    db = database()
    if payload.get("day"):
        return response(True, db.fetch_hourly_summary(payload["day"]))
    start, end = day_bounds(payload)
    return response(True, db.hourly_summary(start, end))


def get_raw_events(payload: dict):
    db = database()
    if payload.get("day"):
        items = db.fetch_timeline(payload["day"], payload.get("limit", 50))
        app_name = payload.get("appName")
        if app_name:
            items = [item for item in items if item["appName"] == app_name]
        return response(True, items)
    start, end = day_bounds(payload)
    rows = db.raw_events(
        start=start,
        end=end,
        app_name=payload.get("appName"),
        limit=payload.get("limit", 50),
    )
    return response(True, [db._serialize_row(row) for row in rows])


def get_top_sites(payload: dict):
    db = database()
    if payload.get("day"):
        return response(True, db.fetch_top_sites(payload["day"], payload.get("limit", 10)))
    start, end = day_bounds(payload)
    return response(True, db.top_sites(start, end, payload.get("limit", 10)))


def get_unclassified_segments(payload: dict):
    db = database()
    start, end = day_bounds(payload)
    return response(True, db.fetch_unclassified_segments(start, end, payload.get("limit", 50)))


def save_classifications(payload: dict):
    classifications = payload.get("classifications", [])
    if not isinstance(classifications, list):
        return response(False, error="classifications must be a list")
    saved = database().save_classifications(classifications)
    return response(True, {"saved": saved})


def get_reusable_ai_classifications(payload: dict):
    input_fingerprints = payload.get("inputFingerprints", payload.get("input_fingerprints", []))
    if not isinstance(input_fingerprints, list):
        return response(False, error="inputFingerprints must be a list")
    fingerprints = [item for item in input_fingerprints if isinstance(item, str)]
    return response(True, database().get_reusable_ai_classifications(fingerprints))


def get_classification_rules(payload: dict):
    return response(True, database().get_classification_rules())


def save_classification_rule(payload: dict):
    rule_input = payload.get("input", payload)
    if not isinstance(rule_input, dict):
        return response(False, error="input must be an object")
    rule = database().save_classification_rule(rule_input)
    return response(True, rule)


def delete_classification_rule(payload: dict):
    rule_id = payload.get("id")
    if not isinstance(rule_id, str) or not rule_id:
        return response(False, error="id is required")
    deleted = database().delete_classification_rule(rule_id)
    return response(True, {"deleted": deleted})


def delete_activity_segments(payload: dict):
    raw_ids = payload.get("ids")
    if not isinstance(raw_ids, list):
        return response(False, error="ids is required")
    ids = [segment_id for segment_id in raw_ids if isinstance(segment_id, str) and segment_id]
    deleted = database().delete_activity_segments(ids)
    return response(True, {"deleted": deleted})


def delete_history_range(payload: dict):
    scopes = payload.get("scopes")
    if not isinstance(scopes, dict):
        return response(False, error="scopes is required")
    start = payload.get("start")
    if start is not None and not isinstance(start, str):
        return response(False, error="start must be a string")
    end = payload.get("end")
    if end is not None and not isinstance(end, str):
        return response(False, error="end must be a string")
    result = database().delete_history_range(
        start=start or None,
        end=end or None,
        scopes=scopes,
        dry_run=_bool_payload(payload.get("dryRun")),
    )
    return response(True, result)


def search_classification_rule_candidates(payload: dict):
    query = payload.get("query", "")
    if not isinstance(query, str):
        return response(False, error="query must be a string")
    target_kind = payload.get("targetKind")
    if target_kind is not None and not isinstance(target_kind, str):
        return response(False, error="targetKind must be site or app")
    if target_kind is not None and target_kind not in {"site", "app"}:
        return response(False, error="targetKind must be site or app")
    return response(True, database().search_classification_rule_candidates(query, target_kind=target_kind))


def apply_classification_rules(payload: dict):
    start, end = day_bounds(payload or {})
    return response(True, database().apply_classification_rules(start, end))


def refresh_non_ai_classifications(payload: dict):
    start, end = day_bounds(payload)
    deleted = database().refresh_non_ai_classifications(start, end)
    return response(True, {"deleted": deleted})


def get_classification_metrics(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().classification_metrics(start, end))


def preview_browser_history_import(payload: dict):
    from app.tracker.browser_history_import import preview_browser_history_import as preview_import

    try:
        request = _browser_history_import_request(payload)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, preview_import(request).to_payload())


def import_browser_history(payload: dict):
    from app.tracker.browser_history_import import import_browser_history as run_import

    try:
        request = _browser_history_import_request(payload)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, run_import(database(), request).to_payload())


def set_developer_diagnostics(payload: dict):
    force_chromium_ax_capture = _bool_payload(payload.get("forceChromiumAxCapture"))
    force_frontmost_fallback_capture = _bool_payload(payload.get("forceFrontmostFallbackCapture"))
    force_browser_history_url_fallback = _bool_payload(payload.get("forceBrowserHistoryUrlFallback"))
    db = database()
    db.set_meta(FORCE_CHROMIUM_AX_CAPTURE_META_KEY, "true" if force_chromium_ax_capture else "false")
    db.set_meta(
        FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY,
        "true" if force_frontmost_fallback_capture else "false",
    )
    db.set_meta(
        FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY,
        "true" if force_browser_history_url_fallback else "false",
    )
    _apply_developer_diagnostics_env(db)
    return response(
        True,
        {
            "forceChromiumAxCapture": force_chromium_ax_capture,
            "forceFrontmostFallbackCapture": force_frontmost_fallback_capture,
            "forceBrowserHistoryUrlFallback": force_browser_history_url_fallback,
        },
    )


def get_current_snapshot():
    if DB_PATH.exists():
        _apply_developer_diagnostics_env(database())
    else:
        _apply_developer_diagnostics_defaults()
    snapshot = current_snapshot()
    return response(
        True,
        {
            "observedAt": snapshot.observed_at,
            "appName": snapshot.app_name,
            "bundleId": snapshot.bundle_id,
            "windowTitle": snapshot.window_title,
            "browserName": snapshot.browser_name,
            "siteDomain": snapshot.site_domain,
            "siteTitle": snapshot.site_title,
            "siteUrl": snapshot.site_url,
            "youtubeVideoId": snapshot.youtube_video_id,
            "youtubePlaylistId": snapshot.youtube_playlist_id,
            "youtubeIsShorts": snapshot.youtube_is_shorts,
            "source": snapshot.source,
            "siteSource": snapshot.site_source,
            "captureConfidence": snapshot.capture_confidence,
            "browserAutomationStatus": snapshot.browser_automation_status,
            "browserAutomationError": snapshot.browser_automation_error,
            "browserHistoryStatus": snapshot.browser_history_status,
            "browserHistoryReason": snapshot.browser_history_reason,
            "browserHistoryDatabaseFound": snapshot.browser_history_database_found,
            "browserHistoryProfileCount": snapshot.browser_history_profile_count,
            "browserHistoryCandidateCount": snapshot.browser_history_candidate_count,
            "browserHistoryErrorCount": snapshot.browser_history_error_count,
            "systemTransientActivity": snapshot.system_transient_activity,
            "frontmostCaptureSource": snapshot.frontmost_capture_source,
            "frontmostCaptureError": snapshot.frontmost_capture_error,
            "frontmostFallbackError": snapshot.frontmost_fallback_error,
        },
    )


def handle_idle_sample(
    db: TrackerDatabase,
    idle_seconds: float | None,
    now: datetime | None = None,
    threshold_seconds: int = IDLE_THRESHOLD_SECONDS,
) -> bool:
    if idle_seconds is None:
        db.set_meta("idle_detection_available", "false")
        return False

    db.set_meta("idle_detection_available", "true")
    db.set_meta("idle_seconds", f"{idle_seconds:.3f}")
    if idle_seconds < threshold_seconds:
        return False

    reference_time = now or datetime.now(timezone.utc)
    idle_started_at = reference_time - timedelta(seconds=idle_seconds)
    db.trim_latest_segment(idle_started_at.isoformat())
    db.set_meta("tracker_mode", "idle")
    return True


def handle_power_state_sample(db: TrackerDatabase, power_state: PowerStateSample) -> bool:
    if power_state.should_capture:
        return False

    observed_at = power_state.observed_at.isoformat()
    db.trim_latest_segment(observed_at)
    db.set_meta("tracker_mode", "suppressed")
    db.set_meta("capture_suppressed_reason", power_state.reason)
    db.set_meta("last_capture_suppressed_at", observed_at)
    return True


def sample_seconds_since_previous(previous_tick: float | None, current_tick: float, default_seconds: int = SAMPLE_SECONDS) -> int:
    if previous_tick is None:
        return default_seconds
    return max(default_seconds, int(round(current_tick - previous_tick)))


def enqueue_youtube_metadata_fetch(db_path: Path, video_id: str | None, site_url: str | None) -> None:
    if not video_id or not site_url:
        return

    db = TrackerDatabase(db_path)
    if not db.youtube_metadata_should_fetch(video_id):
        return

    with _YOUTUBE_METADATA_LOCK:
        if video_id in _YOUTUBE_METADATA_IN_FLIGHT:
            return
        _YOUTUBE_METADATA_IN_FLIGHT.add(video_id)

    threading.Thread(
        target=_fetch_youtube_metadata_background,
        args=(db_path, video_id, site_url),
        daemon=True,
    ).start()


def _fetch_youtube_metadata_background(db_path: Path, video_id: str, site_url: str) -> None:
    try:
        db = TrackerDatabase(db_path)
        if not db.youtube_metadata_should_fetch(video_id):
            return
        metadata = fetch_youtube_metadata(site_url, video_id, timeout_seconds=YOUTUBE_METADATA_TIMEOUT_SECONDS)
        db.save_youtube_metadata(metadata)
    except Exception:
        TrackerDatabase(db_path).save_youtube_metadata_failure(video_id)
    finally:
        with _YOUTUBE_METADATA_LOCK:
            _YOUTUBE_METADATA_IN_FLIGHT.discard(video_id)


COMMANDS = {
    "get_status": lambda payload: get_status(),
    "start_tracking": lambda payload: start_tracking(),
    "stop_tracking": lambda payload: stop_tracking(),
    "get_timeline": get_timeline,
    "get_timeline_page": get_timeline_page,
    "search_timeline": search_timeline,
    "get_dashboard_week_timeline": get_dashboard_week_timeline,
    "get_live_tail": get_live_tail,
    "get_current_snapshot": lambda payload: get_current_snapshot(),
    "get_hourly_summary": get_hourly_summary,
    "get_raw_events": get_raw_events,
    "get_top_sites": get_top_sites,
    "get_unclassified_segments": get_unclassified_segments,
    "get_reusable_ai_classifications": get_reusable_ai_classifications,
    "get_classification_rules": get_classification_rules,
    "save_classification_rule": save_classification_rule,
    "delete_classification_rule": delete_classification_rule,
    "delete_activity_segments": delete_activity_segments,
    "delete_history_range": delete_history_range,
    "search_classification_rule_candidates": search_classification_rule_candidates,
    "apply_classification_rules": apply_classification_rules,
    "save_classifications": save_classifications,
    "refresh_non_ai_classifications": refresh_non_ai_classifications,
    "get_classification_metrics": get_classification_metrics,
    "preview_browser_history_import": preview_browser_history_import,
    "import_browser_history": import_browser_history,
    "set_developer_diagnostics": set_developer_diagnostics,
}


def daemon():
    ensure_state_dir()
    pid_path().write_text(str(os.getpid()))
    db = database()
    db.set_meta("tracker_script_path", _current_script_path())
    db.set_meta(TRACKER_RUNTIME_FINGERPRINT_META_KEY, _tracker_runtime_fingerprint())
    last_capture_tick: float | None = None

    try:
        while True:
            if handle_power_state_sample(db, current_power_state()):
                last_capture_tick = None
                time.sleep(SAMPLE_SECONDS)
                continue

            idle_seconds = seconds_since_last_input()
            if handle_idle_sample(db, idle_seconds):
                last_capture_tick = None
                time.sleep(SAMPLE_SECONDS)
                continue

            _apply_developer_diagnostics_env(db)
            snapshot = current_snapshot(include_system_transient=False)
            capture_tick = time.monotonic()
            sample_seconds = sample_seconds_since_previous(last_capture_tick, capture_tick)
            last_capture_tick = capture_tick
            db.record_snapshot(snapshot, sample_seconds, max_merge_gap_seconds=IDLE_THRESHOLD_SECONDS)
            enqueue_youtube_metadata_fetch(DB_PATH, snapshot.youtube_video_id, snapshot.site_url)
            backfill_browser_history_context(db, snapshot.observed_at)
            db.set_meta("last_event_at", snapshot.observed_at)
            db.set_meta("tracker_mode", "tracking")
            time.sleep(SAMPLE_SECONDS)
    finally:
        pid_path().unlink(missing_ok=True)


def _dispatch(request: dict):
    command = request["command"]
    payload = request.get("payload", {})
    handler = COMMANDS[command]
    return handler(payload)


def handle_request(raw_request: str):
    try:
        request = json.loads(raw_request)
        print(json.dumps(_dispatch(request)))
    except Exception as exc:
        print(json.dumps(response(False, error=str(exc))))


def serve():
    """Persistent request server (one JSON request per stdin line, one JSON
    response per stdout line).

    Keeps the interpreter warm and modules imported so each query avoids the
    ~200-400ms cold-start cost of spawning a fresh ``python main.py`` process.
    Errors are returned per request and never break the loop; EOF on stdin
    (parent process exit / closed pipe) ends the loop cleanly.
    """
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            envelope = _dispatch(request)
        except Exception as exc:  # never let a single bad request kill the server
            envelope = response(False, error=str(exc))
        if request_id is not None:
            envelope = {**envelope, "id": request_id}
        sys.stdout.write(json.dumps(envelope))
        sys.stdout.write("\n")
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="request")
    parser.add_argument("--request-json", dest="request_json")
    parser.add_argument("--db", dest="db_path")
    args = parser.parse_args()

    global DB_PATH
    if args.db_path:
        DB_PATH = Path(args.db_path)

    if args.mode == "daemon":
        daemon()
        return

    if args.mode == "serve":
        serve()
        return

    if args.request_json:
        handle_request(args.request_json)
        return

    print(json.dumps(response(False, error="No request provided")))


if __name__ == "__main__":
    main()
