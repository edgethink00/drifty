from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = APP_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from app.permissions.accessibility import accessibility_granted
from app.storage.db import TrackerDatabase
from app.tracker.idle import seconds_since_last_input
from app.tracker.macos_workspace import current_snapshot
from app.tracker.power_state import PowerStateSample, current_power_state
from app.tracker.youtube_metadata import fetch_youtube_metadata

DB_PATH = APP_DIR / "drifty_tracker.sqlite3"
SAMPLE_SECONDS = int(os.environ.get("DRIFTY_SAMPLE_SECONDS", "5"))
IDLE_THRESHOLD_SECONDS = int(os.environ.get("DRIFTY_IDLE_THRESHOLD_SECONDS", "180"))
YOUTUBE_METADATA_TIMEOUT_SECONDS = float(os.environ.get("DRIFTY_YOUTUBE_METADATA_TIMEOUT_SECONDS", "2"))
_YOUTUBE_METADATA_IN_FLIGHT: set[str] = set()
_YOUTUBE_METADATA_LOCK = threading.Lock()


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


def _bool_meta(value: str | None) -> bool | None:
    if value == "true":
        return True
    if value == "false":
        return False
    return None


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


def _running_daemon_matches_current_script(pid: int) -> bool:
    command = _process_command(pid)
    if not command:
        return True
    current_script = _current_script_path()
    if current_script in command:
        return True
    if "tracker-python" in command and "main.py" in command:
        return False
    return True


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
        if pid is None or _running_daemon_matches_current_script(pid):
            return response(True, get_status()["data"])
        _stop_stale_tracker_daemon(pid)
        time.sleep(0.25)

    command = [sys.executable, str(Path(__file__).resolve()), "daemon", "--db", str(DB_PATH)]
    subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(0.25)
    return response(True, get_status()["data"])


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


def search_classification_rule_candidates(payload: dict):
    query = payload.get("query", "")
    if not isinstance(query, str):
        return response(False, error="query must be a string")
    return response(True, database().search_classification_rule_candidates(query))


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


def get_current_snapshot():
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
            "systemTransientActivity": snapshot.system_transient_activity,
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
    "search_classification_rule_candidates": search_classification_rule_candidates,
    "apply_classification_rules": apply_classification_rules,
    "save_classifications": save_classifications,
    "refresh_non_ai_classifications": refresh_non_ai_classifications,
    "get_classification_metrics": get_classification_metrics,
}


def daemon():
    ensure_state_dir()
    pid_path().write_text(str(os.getpid()))
    db = database()
    db.set_meta("tracker_script_path", _current_script_path())
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

            snapshot = current_snapshot(include_system_transient=False)
            capture_tick = time.monotonic()
            sample_seconds = sample_seconds_since_previous(last_capture_tick, capture_tick)
            last_capture_tick = capture_tick
            db.record_snapshot(snapshot, sample_seconds, max_merge_gap_seconds=IDLE_THRESHOLD_SECONDS)
            enqueue_youtube_metadata_fetch(DB_PATH, snapshot.youtube_video_id, snapshot.site_url)
            db.set_meta("last_event_at", snapshot.observed_at)
            db.set_meta("tracker_mode", "tracking")
            time.sleep(SAMPLE_SECONDS)
    finally:
        pid_path().unlink(missing_ok=True)


def handle_request(raw_request: str):
    try:
        request = json.loads(raw_request)
        command = request["command"]
        payload = request.get("payload", {})
        handler = COMMANDS[command]
        print(json.dumps(handler(payload)))
    except Exception as exc:
        print(json.dumps(response(False, error=str(exc))))


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

    if args.request_json:
        handle_request(args.request_json)
        return

    print(json.dumps(response(False, error="No request provided")))


if __name__ == "__main__":
    main()
