from __future__ import annotations

import argparse
import errno
import hashlib
import json
import math
import os
import re
import secrets
import shlex
import signal
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Literal

APP_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = APP_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from app.frozen_archive import pin_frozen_archive

pin_frozen_archive()

# Disposable metadata reader: dispatch before DB/daemon/telemetry initialization.
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "browser-public-description":
    from app.tracker.browser_public_description import main as description_reader_main
    raise SystemExit(description_reader_main(sys.argv[2:]))

from app.fs_safety import ensure_directory
from app.daemon_maintenance import DaemonMaintenance
from app.storage.db import BrowserHistoryBackfillConfig, TrackerDatabase
from app.storage.database_maintenance import initialize_closed_wal_sidecars
from app.tracker.app_exclusion import match_app_exclusion, redact_snapshot
from app.platform_locks import (
    lock_exclusive,
    lock_exclusive_nonblocking,
    unlock,
)
from app.tracker.adaptive_context.developer_diagnostics import (
    ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV,
    ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV,
    ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY,
    ENHANCED_CONTEXT_ENABLED_META_KEY,
    ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY,
    FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV,
    FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY,
    FORCE_CHROMIUM_AX_CAPTURE_ENV,
    FORCE_CHROMIUM_AX_CAPTURE_META_KEY,
    FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV,
    FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY,
    JsonObject,
    JsonValue,
    apply_developer_diagnostics_defaults as _apply_developer_diagnostics_defaults,
    apply_developer_diagnostics_env as _apply_developer_diagnostics_env,
    save_developer_diagnostics,
)
from app.sentry_setup import capture_tracker_exception, init_tracker_sentry, silence_urllib3_libressl_warning
from app.tracker.windows_idle import is_sleep_gap
from app.tracker.capture_timeline import CaptureMutation, CaptureTimeline
from app.tracker.engagement_policy import (
    FOREGROUND_AUDIO_EVIDENCE,
    EngagementDecision,
    decide_engagement,
)
from app.tracker.dev_signals.aggregation import peak_concurrency, summarize_agent_time
from app.tracker.dev_signals.discovery import discover_repositories as discover_dev_repositories
from app.tracker.dev_signals.ingest import (
    DEFAULT_BACKFILL_DAYS as DEV_SIGNALS_BACKFILL_DAYS,
    register_repo as register_dev_repo,
    run_ingest as run_dev_signals_ingest,
)
from app.tracker.dev_signals.ssh_sources import (
    collect_ssh_agent_source as collect_ssh_agent_source_metadata,
    list_ssh_agent_sources as list_ssh_agent_source_aliases,
    test_ssh_agent_source as test_ssh_agent_source_connection,
)

if TYPE_CHECKING:
    from app.process_liveness import ProcessOwner
    from app.tracker.macos_workspace import Snapshot
    from app.tracker.power_state import PowerStateSample
    from app.tracker.youtube_metadata import YouTubeVideoMetadata

DB_PATH = APP_DIR / "drifty_tracker.sqlite3"
SAMPLE_SECONDS = int(os.environ.get("DRIFTY_SAMPLE_SECONDS", "5"))
IDLE_THRESHOLD_SECONDS = int(os.environ.get("DRIFTY_IDLE_THRESHOLD_SECONDS", "180"))
PASSIVE_ACTIVITY_LEASE_SECONDS = 30 * 60
PASSIVE_AUDIO_GAP_GRACE_SECONDS = 15
PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY = "passive_audio_last_supported_at"
YOUTUBE_METADATA_TIMEOUT_SECONDS = float(os.environ.get("DRIFTY_YOUTUBE_METADATA_TIMEOUT_SECONDS", "2"))
DATABASE_BACKUP_CHECK_SECONDS = 60 * 60

#: How often the capture daemon pulls in new agent session turns.
#:
#: Ingestion otherwise runs only when the Your Agents tab asks for it, so the
#: freshness of the view depends on having opened it. The daemon keeps the
#: recent window current on its own.
DEV_SIGNALS_INGEST_INTERVAL_SECONDS = 30 * 60

#: Files one daemon pass may read. This pass shares the capture loop, and a
#: session file costs roughly a quarter second to parse on a real corpus, so
#: the budget stays small enough to keep the worst pass around ten seconds.
#: At 48 passes a day it still covers far more files than a working machine
#: writes; the on-demand pass keeps the larger budget for bulk catch-up, and
#: git commit collection stays out of the daemon entirely.
DEV_SIGNALS_DAEMON_MAX_FILES = 40
TRACKER_RUNTIME_FINGERPRINT_META_KEY = "tracker_runtime_fingerprint"
TRACKER_EXIT_TIMEOUT_SECONDS = 3.0
WINDOWS_STOP_PROCESS_BUDGET_CAP_SECONDS = 24.0
TRACKER_EXIT_POLL_SECONDS = 0.05
# A frozen Windows daemon spends most of its first second in the bootloader
# (plus a Defender look at the fresh files) before it can write its pid
# record, so a fixed post-spawn sleep misreports a healthy start as
# "Tracker daemon did not start" whenever the host is busy. Poll instead.
# Bounded to stay inside the app's 3s recovery budget together with the
# parent's own cold start (~1s measured for the frozen sidecar).
TRACKER_START_TIMEOUT_SECONDS = 1.5
TRACKER_START_POLL_SECONDS = 0.1
_YOUTUBE_METADATA_IN_FLIGHT: set[str] = set()
_YOUTUBE_METADATA_LOCK = threading.Lock()
RuntimeMode = Literal["source", "frozen"]
TrackerProcessOwnership = Literal["tracker", "unrelated", "unknown"]
SENTRY_SMOKE_MODE = "sentry-smoke-test"
SENTRY_SDK_CHECK_MODE = "sentry-sdk-check"
# Discard-port DSN for the release build check. The check captures nothing, so no
# event is ever sent, and the real DSN from the build environment is never used.
SENTRY_SDK_CHECK_DSN = "https://public@127.0.0.1:9/0"
SENTRY_SMOKE_ID_PATTERN = re.compile(r"\Adrifty-sentry-smoke-[A-Za-z0-9_-]{6,48}\Z")


def response(ok: bool, data=None, error: str | None = None):
    return {"ok": ok, "data": data, "error": error}


def sentry_sdk_check() -> dict:
    """Report whether this build can start the Sentry SDK the way the tracker does.

    Release builds run this against the frozen sidecar: a build Python without
    sentry_sdk still produces a working tracker whose errors never reach Sentry.
    Initialization goes through init_tracker_sentry with a discard-port DSN, so
    a bundle that imports the SDK but cannot initialize it also fails.
    """
    try:
        silence_urllib3_libressl_warning()
        from sentry_sdk.consts import VERSION
    except ImportError as error:
        return response(False, {"sentrySdkVersion": None, "initialized": False}, f"Sentry SDK is not bundled: {error}")
    os.environ["DRIFTY_TRACKER_SENTRY_DSN"] = SENTRY_SDK_CHECK_DSN
    if not init_tracker_sentry(SENTRY_SDK_CHECK_MODE):
        return response(
            False,
            {"sentrySdkVersion": VERSION, "initialized": False},
            "Sentry SDK is bundled but the tracker could not initialize it.",
        )
    return response(True, {"sentrySdkVersion": VERSION, "initialized": True})


def sentry_smoke_test(smoke_id: str | None, sentry_initialized: bool) -> dict:
    resolved_smoke_id = smoke_id or f"drifty-sentry-smoke-{secrets.token_hex(8)}"
    if not SENTRY_SMOKE_ID_PATTERN.fullmatch(resolved_smoke_id):
        return response(
            False,
            {"smokeId": None, "captureRequested": False, "deliveryConfirmed": False},
            "Smoke ID must match drifty-sentry-smoke-[A-Za-z0-9_-]{6,48}.",
        )
    if not sentry_initialized:
        return response(
            False,
            {"smokeId": resolved_smoke_id, "captureRequested": False, "deliveryConfirmed": False},
            "Tracker Sentry is not initialized; configure a DSN and install the Sentry SDK.",
        )

    capture_requested = capture_tracker_exception(
        RuntimeError(resolved_smoke_id),
        {"phase": SENTRY_SMOKE_MODE, "smokeId": resolved_smoke_id},
    )
    return response(
        capture_requested,
        {
            "smokeId": resolved_smoke_id,
            "captureRequested": capture_requested,
            "deliveryConfirmed": False,
        },
        None if capture_requested else "Tracker Sentry capture or flush request failed.",
    )


def state_dir() -> Path:
    return DB_PATH.parent / ".state"


def pid_path() -> Path:
    return state_dir() / "tracker.pid"


def lifecycle_lock_path() -> Path:
    return state_dir() / "tracker.lifecycle.lock"


def daemon_lock_path() -> Path:
    return state_dir() / "tracker.daemon.lock"


def pid_lock_path() -> Path:
    return state_dir() / "tracker.pid.lock"


def ensure_state_dir() -> None:
    ensure_directory(state_dir())


@contextmanager
def tracker_lifecycle_lock():
    ensure_state_dir()
    with lifecycle_lock_path().open("a+") as lock_file:
        lock_exclusive(lock_file)
        try:
            yield
        finally:
            unlock(lock_file)


def _acquire_tracker_daemon_lock():
    ensure_state_dir()
    lock_file = daemon_lock_path().open("a+")
    if not lock_exclusive_nonblocking(lock_file):
        lock_file.close()
        return None
    return lock_file


def _release_tracker_daemon_lock(lock_file) -> None:
    unlock(lock_file)
    lock_file.close()


@contextmanager
def tracker_daemon_lock():
    """Try to own the tracker-state sampling lock for this process lifetime."""

    lock_file = _acquire_tracker_daemon_lock()
    if lock_file is None:
        yield None
        return
    try:
        yield lock_file
    finally:
        _release_tracker_daemon_lock(lock_file)


@contextmanager
def tracker_pid_lock():
    """Serialize PID record compare/write/unlink operations across runtimes."""

    ensure_state_dir()
    with pid_lock_path().open("a+") as lock_file:
        lock_exclusive(lock_file)
        try:
            yield
        finally:
            unlock(lock_file)


_DATABASE_CACHE: TrackerDatabase | None = None


def database() -> TrackerDatabase:
    """Return the TrackerDatabase for DB_PATH, reusing one instance per path.

    Constructing a TrackerDatabase runs the full schema/migration pass, and
    nearly every command handler calls database(); caching keeps that cost to
    one pass per process instead of one per IPC request. Keyed by the current
    DB_PATH value so tests (and --db overrides) that repoint DB_PATH get a
    fresh instance.
    """
    global _DATABASE_CACHE
    if _DATABASE_CACHE is None or _DATABASE_CACHE.db_path != DB_PATH:
        _DATABASE_CACHE = TrackerDatabase(DB_PATH)
    return _DATABASE_CACHE


@contextmanager
def _status_database():
    """Read existing status without schema writes or a cached read-only handle."""
    if not DB_PATH.exists():
        # Preserve first-use bootstrap; an established DB needs no migrations
        # or backup work merely to report daemon liveness and stored metadata.
        yield database()
        return
    db = TrackerDatabase(DB_PATH, read_only=True)
    try:
        metadata_query = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracker_meta'"
        try:
            has_metadata = db.connect().execute(metadata_query).fetchone()
        except sqlite3.OperationalError as error:
            if str(error) != "unable to open database file":
                raise
            db.close()
            if not initialize_closed_wal_sidecars(DB_PATH):
                raise
            # Retry once with the original read-only contract. Never run full
            # startup maintenance just to read an established database's status.
            has_metadata = db.connect().execute(metadata_query).fetchone()
        if has_metadata:
            yield db
        else:
            # A new database file can exist before its first schema is ready.
            # Only that missing schema follows the existing initialization path;
            # actual open/read/corruption errors must still reach the caller.
            db.close()
            yield database()
    finally:
        db.close()


def accessibility_granted() -> bool:
    from app.permissions.accessibility import accessibility_granted as read_accessibility_granted

    return read_accessibility_granted()


def seconds_since_last_input() -> float | None:
    from app.tracker.idle import seconds_since_last_input as read_seconds_since_last_input

    return read_seconds_since_last_input()


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    from app.tracker.platform_workspace import current_snapshot as read_current_snapshot

    return read_current_snapshot(include_system_transient=include_system_transient)


def current_power_state() -> PowerStateSample:
    from app.tracker.power_state import current_power_state as read_current_power_state

    return read_current_power_state()


def current_foreground_audio_sample():
    from app.tracker.macos_audio_activity import foreground_audio_sample

    return foreground_audio_sample()


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
) -> list[JsonObject]:
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
        enqueue_youtube_metadata_fetch(db, result.youtube_video_id, result.site_url)


def _bool_meta(value: str | None) -> bool | None:
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def _bool_payload(value: JsonValue) -> bool:
    return value is True


def _int_payload(value: JsonValue, *, default: int, min_value: int, max_value: int, name: str) -> int:
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


def timeline_page_bounds(payload: object) -> tuple[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("timeline page selector must be an object")

    has_day = "day" in payload
    has_start = "start" in payload
    has_end = "end" in payload
    if has_day:
        if has_start or has_end:
            raise ValueError("timeline page selector cannot mix day with start or end")
        day = payload["day"]
        if not isinstance(day, str) or not day:
            raise ValueError("timeline page selector day must be a non-empty string")
        return f"{day}T00:00:00", f"{day}T23:59:59"

    if has_start != has_end:
        raise ValueError("timeline page selector requires both start and end")
    if not has_start:
        raise ValueError("timeline page selector requires day or both start and end")

    start = payload["start"]
    end = payload["end"]
    if not isinstance(start, str) or not start or not isinstance(end, str) or not end:
        raise ValueError("timeline page selector start and end must be non-empty strings")
    return start, end


def _datetime_payload(value: JsonValue, *, name: str) -> datetime:
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


def _browser_history_profile_roots_payload(value: JsonValue) -> dict[str, Path] | None:
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


def is_running(*, deadline: float | None = None) -> bool:
    # Existing boolean callers keep their conservative PID handling and their
    # historical False fallback when discovery is unreadable. Status replies
    # need the distinct unknown observation to avoid confirming a false Pause.
    return _observed_tracker_running(**({"deadline": deadline} if deadline is not None else {})) is True


def _observed_tracker_running(*, deadline: float | None = None) -> bool | None:
    query_kwargs = {"deadline": deadline} if deadline is not None else {}
    pid = _read_tracker_pid()
    if pid is not None and _process_exists(pid):
        ownership = _tracker_process_ownership(pid, **query_kwargs)
        if ownership != "unrelated":
            return True
    processes = _process_table(**query_kwargs)
    if processes is None:
        return None
    return bool(_matching_tracker_daemon_pids(processes))


def _read_tracker_pid_unlocked() -> int | None:
    try:
        # Explicit encoding: Python's text default follows the system locale,
        # which is cp949 on a Korean Windows install and would make this
        # record's readability depend on the user's regional settings.
        pid = int(pid_path().read_text(encoding="utf-8").strip())
    except Exception:
        return None
    return pid if pid > 0 else None


def _read_tracker_pid() -> int | None:
    with tracker_pid_lock():
        return _read_tracker_pid_unlocked()


def _write_tracker_pid(pid: int) -> None:
    with tracker_pid_lock():
        pid_path().write_text(str(pid), encoding="utf-8")


def _remove_pid_record_if_owned(pid: int) -> bool:
    """Remove the PID record only when it still names ``pid``.

    The short PID-record lock closes the read/unlink race where an exiting old
    daemon could otherwise delete a newly-started daemon's record.
    """

    with tracker_pid_lock():
        if _read_tracker_pid_unlocked() != pid:
            return False
        pid_path().unlink(missing_ok=True)
        return True


def _process_exists(pid: int) -> bool:
    # os.kill(pid, 0) reports success for an already-exited process on Windows
    # while any handle to it stays open, so liveness needs the real API there.
    if sys.platform == "win32":
        from app.windows_process_liveness import windows_process_is_alive

        return windows_process_is_alive(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _unix_process_query_timeout(deadline: float | None) -> float:
    # Reuse the existing exit-inspection allowance for standalone ps queries.
    # A caller's remaining budget can only shorten it, never start a fresh wait.
    if deadline is None:
        return TRACKER_EXIT_TIMEOUT_SECONDS
    return max(0.0, min(TRACKER_EXIT_TIMEOUT_SECONDS, deadline - time.monotonic()))


def _process_command(pid: int, *, deadline: float | None = None) -> str | None:
    if sys.platform == "win32":
        from app.windows_process_table import windows_process_command

        return windows_process_command(pid, **({"deadline": deadline} if deadline is not None else {}))

    timeout = _unix_process_query_timeout(deadline)
    if timeout <= 0:
        return None
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _process_table(*, deadline: float | None = None) -> dict[int, str] | None:
    """Return an untruncated process snapshot or ``None`` when inspection fails."""

    # Windows has no ps(1); command lines come from CIM instead. Both backends
    # return the same pid -> full-command-line shape, and both report failure
    # as None so a caller never mistakes an unreadable table for an empty one.
    if sys.platform == "win32":
        from app.windows_process_table import windows_process_table

        return windows_process_table(**({"deadline": deadline} if deadline is not None else {}))

    timeout = _unix_process_query_timeout(deadline)
    if timeout <= 0:
        return None
    try:
        result = subprocess.run(
            ["ps", "-axww", "-o", "pid=", "-o", "command="],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None

    processes: dict[int, str] = {}
    for line in result.stdout.splitlines():
        match = re.match(r"\s*(\d+)\s+(.+?)\s*$", line)
        if match is None:
            continue
        processes[int(match.group(1))] = match.group(2)
    return processes


def _invalidate_process_table() -> None:
    """Force the next snapshot to be queried fresh.

    The Windows backend caches briefly so one lifecycle operation does not pay
    several subprocess round trips. Wherever we act on a process and then check
    the result, that cache would answer from before the action, so the
    confirmation read has to start cold.
    """
    if sys.platform == "win32":
        from app.windows_process_table import invalidate_process_table_cache

        invalidate_process_table_cache()


def _detached_spawn_kwargs() -> dict:
    """Popen options that outlive the caller without showing a console.

    ``start_new_session`` is POSIX-only; on Windows it is ignored, so the
    daemon would inherit the launching console and flash a window at the user
    on every start. The Windows equivalent is a creation-flag pair:
    ``DETACHED_PROCESS`` so the child does not share our console, and
    ``CREATE_NEW_PROCESS_GROUP`` so a Ctrl-C in the parent's group does not
    reach the tracker.
    """
    if sys.platform == "win32":
        return {
            "creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        }
    return {"start_new_session": True}


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


def _tracker_process_ownership(pid: int, *, deadline: float | None = None) -> TrackerProcessOwnership:
    command = _process_command(pid, **({"deadline": deadline} if deadline is not None else {}))
    if command is None:
        return "unknown"
    if _command_arguments(command) is None:
        return "unknown"
    if not _is_tracker_daemon_command(command):
        return "unrelated"
    return "tracker"


def _command_arguments(command: str) -> list[str] | None:
    """Split a process command line into arguments.

    ``shlex`` implements POSIX shell quoting, where a backslash escapes the
    next character. Windows command lines are full of unquoted backslashes, so
    POSIX splitting silently eats them: ``C:\\Users\\alex\\python.exe``
    becomes ``C:Usersalexpython.exe``. That mangled path then fails to match
    the daemon's real runtime path, so ownership reads as unrelated and the
    tracker refuses to stop its own daemon.

    Windows quoting rules are different enough to need their own splitter,
    which the stdlib does not provide, so a small one lives below.
    """
    if sys.platform == "win32":
        return _windows_command_arguments(command)
    try:
        return shlex.split(command)
    except ValueError:
        return None


def _windows_command_arguments(command: str) -> list[str] | None:
    """Split a Windows command line the way CommandLineToArgvW would.

    Only the rules that matter here are implemented: a double quote toggles
    quoting, a run of backslashes is halved and escapes a following quote only
    when the run is odd, and unquoted whitespace separates arguments. That is
    enough to recover paths and ``--db`` values intact.
    """
    arguments: list[str] = []
    current: list[str] = []
    backslashes = 0
    quoted = False
    started = False

    for character in command:
        if character == "\\":
            backslashes += 1
            continue
        if character == '"':
            current.append("\\" * (backslashes // 2))
            if backslashes % 2:
                current.append('"')
            else:
                quoted = not quoted
                started = True
            backslashes = 0
            continue
        current.append("\\" * backslashes)
        backslashes = 0
        if character.isspace() and not quoted:
            if "".join(current) or started:
                arguments.append("".join(current))
                current = []
                started = False
            continue
        current.append(character)

    current.append("\\" * backslashes)
    if "".join(current) or started:
        arguments.append("".join(current))
    return arguments


def _resolve_command_path(raw_path: str) -> Path | None:
    value = raw_path.strip()
    if not value:
        return None
    if value[0] in {"'", '"'}:
        parsed = _command_arguments(value)
        if parsed is None or len(parsed) != 1:
            return None
        value = parsed[0]
    try:
        return Path(value).expanduser().resolve()
    except OSError:
        return None


# The packaged executable is named drifty-tracker[-<triple>][.exe]: a macOS
# externalBin carries the target triple in the file name, the Windows onedir
# exe is drifty-tracker.exe inside a triple-named directory, and the plain
# name is the fallback on both platforms. A name that misses here makes the
# parent blind to its own frozen daemon: get_status reports stopped, every
# start attempt spawns a replacement that instantly exits on the daemon
# lock, and the reconciliation pass deletes the healthy daemon's pid record.
_TRACKER_EXECUTABLE_NAME = re.compile(
    r"drifty-tracker"
    r"(?:-(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc))?"
    r"(?:\.exe)?"
)


def _tracker_runtime_from_prefix(prefix: str) -> tuple[RuntimeMode, Path] | None:
    """Recognize source or packaged Drifty tracker runtime command prefixes.

    Runtime names are only an additional guard. Callers must also require the
    exact ``daemon`` mode and exact resolved DB path before treating a process
    as signalable.
    """

    arguments = _command_arguments(prefix)
    if arguments:
        if len(arguments) == 1:
            executable = Path(arguments[0]).expanduser().resolve()
            if _TRACKER_EXECUTABLE_NAME.fullmatch(executable.name):
                return "frozen", executable
            if executable.as_posix().endswith("/services/tracker-python/app/main.py"):
                return "source", executable
        if len(arguments) == 2:
            interpreter = Path(arguments[0])
            script = Path(arguments[1]).expanduser().resolve()
            if "python" in interpreter.name.lower() and script.as_posix().endswith(
                "/services/tracker-python/app/main.py"
            ):
                return "source", script

    # ``ps`` on macOS does not quote argv entries containing spaces. Source
    # worktrees can therefore appear as one interpreter token followed by an
    # unquoted script path containing spaces.
    interpreter_raw, separator, script_raw = prefix.partition(" ")
    if separator and "python" in Path(interpreter_raw).name.lower():
        script = Path(script_raw).expanduser().resolve()
        if script.as_posix().endswith("/services/tracker-python/app/main.py"):
            return "source", script

    # The packaged executable path itself can also contain spaces in an app or
    # updater directory. Its basename remains stable across those locations.
    executable = Path(prefix).expanduser().resolve()
    if _TRACKER_EXECUTABLE_NAME.fullmatch(executable.name):
        return "frozen", executable
    return None


def _daemon_command_details(command: str) -> tuple[RuntimeMode, Path, Path] | None:
    prefix, separator, raw_db_path = command.rpartition(" daemon --db ")
    if not separator:
        prefix, separator, raw_db_path = command.rpartition(" daemon --db=")
    if not separator or not prefix.strip():
        return None

    runtime = _tracker_runtime_from_prefix(prefix.strip())
    command_db_path = _resolve_command_path(raw_db_path)
    if runtime is None or command_db_path is None:
        return None
    runtime_mode, runtime_path = runtime
    return runtime_mode, runtime_path, command_db_path


def _matching_tracker_daemon_pids(processes: dict[int, str]) -> list[int]:
    return sorted(
        pid
        for pid, command in processes.items()
        if pid != os.getpid() and _is_tracker_daemon_command(command)
    )


def _reconcile_pid_record(daemon_pids: list[int]) -> None:
    """Drop stale records and adopt a sole verified same-DB daemon."""

    recorded_pid = _read_tracker_pid()
    if recorded_pid is not None and recorded_pid not in daemon_pids:
        _remove_pid_record_if_owned(recorded_pid)
        recorded_pid = None
    if len(daemon_pids) == 1 and recorded_pid != daemon_pids[0]:
        _write_tracker_pid(daemon_pids[0])


def _process_has_exited(pid: int, *, deadline: float | None = None) -> bool:
    # Windows has no wait/zombie model: os.waitpid and os.WNOHANG do not exist,
    # and a terminated process is simply gone from the table rather than
    # lingering until reaped. Liveness alone is the whole answer there, and
    # asking anything further raises AttributeError, which previously escaped
    # through _wait_for_process_exit and made every stop look like a failure
    # even when the daemon had already exited.
    if sys.platform == "win32":
        return not _process_exists(pid)
    try:
        waited_pid, _ = os.waitpid(pid, os.WNOHANG)
    except (ChildProcessError, OSError):
        waited_pid = 0
    if waited_pid == pid or not _process_exists(pid):
        return True
    timeout = _unix_process_query_timeout(deadline)
    if timeout <= 0:
        return False
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "state="],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
        )
    except Exception:
        return False
    return result.returncode == 0 and result.stdout.strip().startswith("Z")


def _wait_for_process_exit(pid: int, timeout_seconds: float = TRACKER_EXIT_TIMEOUT_SECONDS) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while True:
        if _process_has_exited(pid, deadline=deadline):
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(TRACKER_EXIT_POLL_SECONDS, remaining))


def _is_tracker_daemon_command(command: str) -> bool:
    details = _daemon_command_details(command)
    if details is None:
        return False
    return details[2] == DB_PATH.expanduser().resolve()


def _running_daemon_matches_current_script(pid: int) -> bool:
    command = _process_command(pid)
    if command is None or not _is_tracker_daemon_command(command):
        return False
    details = _daemon_command_details(command)
    if details is None:
        return False
    runtime_mode, runtime_path, _ = details
    current_runtime_path = (
        Path(sys.executable).expanduser().resolve()
        if _current_runtime_mode() == "frozen"
        else Path(_current_script_path()).expanduser().resolve()
    )
    return runtime_mode == _current_runtime_mode() and runtime_path == current_runtime_path


def _running_daemon_matches_current_runtime(pid: int, db: TrackerDatabase) -> bool:
    if not _running_daemon_matches_current_script(pid):
        return False
    return db.get_meta(TRACKER_RUNTIME_FINGERPRINT_META_KEY) == _tracker_runtime_fingerprint()


def _stop_verified_tracker_daemon(pid: int, *, deadline: float | None = None) -> TrackerProcessOwnership:
    if sys.platform == "win32" and deadline is None:
        deadline = time.monotonic() + TRACKER_EXIT_TIMEOUT_SECONDS
    query_kwargs = {"deadline": deadline} if deadline is not None else {}
    if deadline is not None and time.monotonic() >= deadline:
        raise TimeoutError("Tracker daemon stop deadline expired before process inspection.")
    if not _process_exists(pid):
        _remove_pid_record_if_owned(pid)
        return "tracker"
    ownership = _tracker_process_ownership(pid, **query_kwargs)
    if ownership == "unknown":
        return ownership
    if ownership == "unrelated":
        _remove_pid_record_if_owned(pid)
        return ownership
    if sys.platform == "win32":
        from app.windows_daemon_shutdown import stop_windows_tracker_daemon

        command = _process_command(pid, **query_kwargs)
        arguments = _command_arguments(command) if command else None
        details = _daemon_command_details(command) if command else None
        if not arguments or details is None or details[2] != DB_PATH.expanduser().resolve():
            return "unknown"
        executable = Path(arguments[0]).expanduser().resolve()

        def verify_ownership(query_deadline: float = deadline) -> bool:
            _invalidate_process_table()
            fresh_command = _process_command(pid, deadline=query_deadline)
            fresh_arguments = _command_arguments(fresh_command) if fresh_command else None
            return bool(
                fresh_arguments
                and _daemon_command_details(fresh_command) == details
                and Path(fresh_arguments[0]).expanduser().resolve() == executable
            )

        stop_windows_tracker_daemon(
            pid, DB_PATH, executable, verify_ownership, TRACKER_EXIT_TIMEOUT_SECONDS,
            source_runtime=details[0] == "source",
            deadline=deadline,
        )
        _remove_pid_record_if_owned(pid)
        return ownership
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        _remove_pid_record_if_owned(pid)
        return ownership
    except OSError:
        # A Windows venv launcher's child can exit between the liveness probe
        # above and TerminateProcess. Windows may report that race as access
        # denied rather than ERROR_INVALID_PARAMETER/ProcessLookupError while
        # the dying process object is still visible. Treat only an independently
        # confirmed exit as success; a live process with the same error remains
        # a hard failure so we never hide a real permission problem.
        if not _process_exists(pid):
            _remove_pid_record_if_owned(pid)
            return ownership
        raise
    if not _wait_for_process_exit(pid):
        raise TimeoutError(f"Tracker daemon {pid} did not exit after SIGTERM.")
    _remove_pid_record_if_owned(pid)
    return ownership


def _stop_tracker_daemons(daemon_pids: list[int], *, deadline: float | None = None) -> list[str]:
    errors: list[str] = []
    for pid in daemon_pids:
        try:
            ownership = _stop_verified_tracker_daemon(pid, **({"deadline": deadline} if deadline is not None else {}))
        except Exception as exc:
            errors.append(str(exc))
            continue
        if ownership == "unknown":
            errors.append(f"Unable to verify tracker daemon {pid}; refusing to signal it.")
    return errors


def start_tracking():
    with tracker_lifecycle_lock():
        return _start_tracking_locked()


def _start_tracking_locked():
    processes = _process_table()
    if processes is None:
        return response(
            False,
            get_status()["data"],
            "Unable to inspect tracker processes; refusing to start a second daemon.",
        )
    daemon_pids = _matching_tracker_daemon_pids(processes)
    _reconcile_pid_record(daemon_pids)

    if len(daemon_pids) == 1 and _running_daemon_matches_current_runtime(daemon_pids[0], database()):
        status_response = get_status()
        if status_response.get("ok") is False:
            return status_response
        return response(True, status_response["data"])

    stop_errors = _stop_tracker_daemons(daemon_pids)
    if stop_errors:
        return response(False, get_status()["data"], " ".join(stop_errors))

    _invalidate_process_table()
    remaining_processes = _process_table()
    if remaining_processes is None:
        return response(False, get_status()["data"], "Unable to confirm that old tracker daemons exited.")
    remaining_pids = _matching_tracker_daemon_pids(remaining_processes)
    if remaining_pids:
        return response(False, get_status()["data"], "Old tracker daemons are still running.")

    command = _daemon_command("daemon")
    subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        **_detached_spawn_kwargs(),
    )
    deadline = time.monotonic() + TRACKER_START_TIMEOUT_SECONDS
    while True:
        time.sleep(TRACKER_START_POLL_SECONDS)
        status_response = get_status()
        if status_response.get("ok") is False:
            return status_response
        status = status_response["data"]
        if status.get("running"):
            return response(True, status)
        if time.monotonic() >= deadline:
            return response(False, status, "Tracker daemon did not start.")


def stop_tracking():
    with tracker_lifecycle_lock():
        return _stop_tracking_locked()


def _stop_tracking_locked():
    # Discovery has one 3s allowance. A readable same-DB PID set then determines
    # a single start-anchored budget: discovery + 3s per native Stop + 3s final
    # confirmation, capped below the controller's default 30s round trip.
    # Native Stop still owns its existing 3s limit; prebinding queries share the
    # overall budget. Native calls and database/lock work are not cancellable.
    started = time.monotonic() if sys.platform == "win32" else None
    deadline = started + TRACKER_EXIT_TIMEOUT_SECONDS if started is not None else None
    query_kwargs = {"deadline": deadline} if deadline is not None else {}
    status_kwargs = {"process_deadline": deadline} if deadline is not None else {}
    # A successful start can return while Windows process discovery still
    # caches the empty table read before the new daemon appeared. A new stop
    # operation must inspect a fresh table or it may miss that daemon, remove
    # its pid record, then find it alive during confirmation and fail.
    _invalidate_process_table()
    processes = _process_table(**query_kwargs)
    if processes is None:
        return response(
            False,
            get_status(**status_kwargs)["data"],
            "Unable to inspect tracker processes; refusing to report a successful stop.",
        )
    daemon_pids = _matching_tracker_daemon_pids(processes)
    if started is not None:
        if time.monotonic() >= deadline:
            return response(
                False,
                get_status(**status_kwargs)["data"],
                "Tracker daemon stop deadline expired during process discovery.",
            )
        # The parsed dictionary supplies distinct original same-DB PIDs only.
        # More than six cannot extend the current 24s cap, nor can a retry.
        deadline = started + min(
            WINDOWS_STOP_PROCESS_BUDGET_CAP_SECONDS,
            TRACKER_EXIT_TIMEOUT_SECONDS * (len(daemon_pids) + 2),
        )
        query_kwargs = {"deadline": deadline}
    _reconcile_pid_record(daemon_pids)

    stop_errors = _stop_tracker_daemons(daemon_pids, **query_kwargs)
    if deadline is not None:
        deadline = min(deadline, time.monotonic() + TRACKER_EXIT_TIMEOUT_SECONDS)
        query_kwargs = {"deadline": deadline}
        status_kwargs = {"process_deadline": deadline}
    if stop_errors:
        return response(False, get_status(**status_kwargs)["data"], " ".join(stop_errors))

    _invalidate_process_table()
    remaining_processes = _process_table(**query_kwargs)
    if remaining_processes is None:
        return response(False, get_status(**status_kwargs)["data"], "Unable to confirm that tracker daemons exited.")
    remaining_pids = _matching_tracker_daemon_pids(remaining_processes)
    if remaining_pids:
        return response(False, get_status(**status_kwargs)["data"], "Tracker daemons are still running.")

    recorded_pid = _read_tracker_pid()
    if recorded_pid is not None:
        _remove_pid_record_if_owned(recorded_pid)
    status_response = get_status(**status_kwargs)
    if status_response.get("ok") is False:
        return status_response
    status = status_response["data"]
    if status.get("running"):
        return response(False, status, "Tracker still reports running after stop.")
    db = database()
    db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
    reset_foreground_audio_diagnostics(db, "tracking_stopped")
    return response(True, status)


def get_status(payload: dict | None = None, *, process_deadline: float | None = None):
    with _status_database() as db:
        return _status_from_database(db, payload, process_deadline=process_deadline)


def _status_from_database(
    db: TrackerDatabase,
    payload: dict | None = None,
    *,
    process_deadline: float | None = None,
):
    # The Mac bridge replaces this field with a fresh native trust result.
    # CLI/default calls and other platforms still perform the normal probe.
    native_accessibility_supplied = sys.platform == "darwin" and (payload or {}).get("skipAccessibilityProbe") is True
    last_event_at = db.get_meta("last_event_at")
    query_kwargs = {"deadline": process_deadline} if process_deadline is not None else {}
    if sys.platform == "win32":
        running = _observed_tracker_running(**query_kwargs)
        if running is None:
            # The Rust bridge treats a failed envelope as unconfirmed. Do not
            # let its follow-up status read turn an unknown Stop into Paused.
            return response(False, error="Unable to inspect tracker processes; running state is unconfirmed.")
    else:
        running = is_running(**query_kwargs)
    tracker_mode = db.get_meta("tracker_mode") if running else None
    effective_tracker_mode = tracker_mode or ("tracking" if running else "idle")
    message = "Tracker stopped."
    if running:
        message = "Tracker idle due to inactivity." if effective_tracker_mode == "idle" else "Tracker running."

    return response(
        True,
        {
            "running": running,
            "accessibilityGranted": False if native_accessibility_supplied else accessibility_granted(),
            "lastEventAt": last_event_at,
            "databasePath": str(DB_PATH),
            "trackerMode": effective_tracker_mode,
            "idleSeconds": _float_meta(db.get_meta("idle_seconds")) if running else None,
            "idleDetectionAvailable": _bool_meta(db.get_meta("idle_detection_available")),
            "message": message,
        },
    )


def verify_current_runtime_running():
    """Confirm the sole daemon belongs to this runtime and database.

    A plain get_status() can report an older daemon as running during an
    upgrade. Startup recovery must not treat that as a successful new start.
    """
    _invalidate_process_table()
    processes = _process_table()
    if processes is None:
        return response(True, False)
    daemon_pids = _matching_tracker_daemon_pids(processes)
    return response(
        True,
        len(daemon_pids) == 1 and _running_daemon_matches_current_runtime(daemon_pids[0], database()),
    )


def get_timeline(payload: dict):
    db = database()
    if payload.get("day"):
        return response(True, db.fetch_timeline(payload["day"]))
    start, end = day_bounds(payload)
    items = [db._serialize_row(row) for row in db.timeline(start, end)]
    return response(True, items)


def _segment_ids(payload: object) -> set[str] | None:
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    if "segmentIds" not in payload:
        return None

    segment_ids = payload["segmentIds"]
    if not isinstance(segment_ids, list):
        raise ValueError("segmentIds must be a list of strings")
    if any(not isinstance(segment_id, str) for segment_id in segment_ids):
        raise ValueError("segmentIds must contain only strings")
    return set(segment_ids)


def get_timeline_page(payload: dict):
    try:
        start, end = timeline_page_bounds(payload)
    except ValueError as exc:
        return response(False, error=str(exc))

    return response(
        True,
        database().timeline_page(
            start=start,
            end=end,
            before_ended_at=payload.get("beforeEndedAt"),
            before_segment_id=payload.get("beforeSegmentId"),
            limit=payload.get("limit"),
        ),
    )


def search_timeline(payload: dict):
    try:
        start, end = timeline_page_bounds(payload)
    except ValueError as exc:
        return response(False, error=str(exc))

    query = payload.get("query", "")
    if not isinstance(query, str):
        query = ""
    return response(
        True,
        database().search_timeline_page(
            query=query,
            start=start,
            end=end,
            before_ended_at=payload.get("beforeEndedAt"),
            before_segment_id=payload.get("beforeSegmentId"),
            limit=payload.get("limit"),
        ),
    )


def get_dashboard_week_timeline(payload: dict):
    db = database()
    start, end = day_bounds(payload)
    return response(True, db.dashboard_week_timeline(start, end))


def get_project_trend_timeline(payload: dict):
    db = database()
    start, end = day_bounds(payload)
    return response(True, db.project_trend_timeline(start, end))


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
    try:
        segment_ids = _segment_ids(payload)
    except ValueError as exc:
        return response(False, error=str(exc))

    if segment_ids is not None and not segment_ids:
        return response(True, [])

    start, end = day_bounds(payload)
    return response(
        True,
        database().fetch_unclassified_segments(
            start,
            end,
            payload.get("limit", 50),
            segment_ids,
        ),
    )


def save_classifications(payload: dict):
    classifications = payload.get("classifications", [])
    if not isinstance(classifications, list):
        return response(False, error="classifications must be a list")
    db = database()
    try:
        saved = db.save_classifications(classifications)
    except sqlite3.OperationalError as exc:
        code = getattr(exc, "sqlite_errorcode", None)
        # BUSY is external writer contention; LOCKED and other failures need
        # their original error. System Python 3.9 has no sqlite_errorcode.
        busy = (code & 0xFF) == 5 if code is not None else str(exc).lower() == "database is locked"
        if not busy or db.connect().in_transaction:
            raise
        # The storage context rolled back the entire batch, including review
        # audit/counters. Retry only this local save once; guards are rechecked
        # against current rows and no provider request is repeated. Two normal
        # 5s busy waits plus this delay fit within the 30s tracker RPC budget.
        time.sleep(0.15)
        saved = db.save_classifications(classifications)
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


def get_excluded_apps(payload: dict):
    if payload.get("includeTombstones"):
        return response(True, database().list_excluded_app_records())
    return response(True, database().get_excluded_apps())


def save_excluded_app(payload: dict):
    rule_id = payload.get("id")
    name = payload.get("name")
    if not isinstance(rule_id, str) or not isinstance(name, str):
        return response(False, error="id and name are required")
    bundle_id = payload.get("bundleId") or payload.get("bundle_id")
    source = payload.get("source", "user")
    if payload.get("tombstone"):
        database().apply_excluded_app_record({
            "id": rule_id,
            "name": name,
            "bundleId": bundle_id,
            "source": source,
            "tombstone": True,
            "updatedAt": payload.get("updatedAt"),
        })
        return response(True, {"id": rule_id, "name": name, "bundleId": bundle_id, "source": source, "tombstone": True})
    if payload.get("updatedAt"):
        database().apply_excluded_app_record({
            "id": rule_id,
            "name": name,
            "bundleId": bundle_id,
            "source": source,
            "tombstone": False,
            "updatedAt": payload.get("updatedAt"),
        })
        return response(True, {"id": rule_id, "name": name, "bundleId": bundle_id, "source": source})
    rule = database().save_excluded_app(rule_id, name, bundle_id, source)
    return response(True, rule)


def delete_excluded_app(payload: dict):
    rule_id = payload.get("id")
    if not isinstance(rule_id, str) or not rule_id:
        return response(False, error="id is required")
    deleted = database().delete_excluded_app(rule_id)
    return response(True, {"deleted": deleted})


def get_excluded_app_history_count(payload: dict):
    name = payload.get("name")
    if not isinstance(name, str):
        return response(False, error="name is required")
    bundle_id = payload.get("bundleId") or payload.get("bundle_id")
    count = database().get_excluded_app_history_count(name, bundle_id)
    return response(True, {"count": count})


def delete_excluded_app_history(payload: dict):
    name = payload.get("name")
    if not isinstance(name, str):
        return response(False, error="name is required")
    bundle_id = payload.get("bundleId") or payload.get("bundle_id")
    deleted = database().delete_excluded_app_history(name, bundle_id)
    return response(True, {"deleted": deleted})


def get_recent_apps(payload: dict):
    limit = int(payload.get("limit", 50)) if isinstance(payload, dict) else 50
    return response(True, database().get_recent_apps(limit))


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


def discover_dev_repos(payload: dict):
    """Scan for git repositories without registering any of them.

    Discovery is a suggestion surface: it reports what exists so the user can
    choose, and never starts tracking on its own.
    """
    roots = payload.get("roots")
    if roots is not None and not isinstance(roots, list):
        return response(False, error="roots must be a list")
    cleaned = [str(root) for root in roots if isinstance(root, str) and root] if roots else None
    tracked = {repo["repo_key"] for repo in database().list_dev_repos()}
    discovered = discover_dev_repositories(cleaned)
    return response(
        True,
        {
            "repos": [
                {
                    "repoKey": repo.repo_key,
                    "repoPath": repo.repo_path,
                    "remoteIdentity": repo.remote_identity,
                    "lastCommitAt": repo.last_commit_at,
                    "worktreeCount": repo.worktree_count,
                    "tracked": repo.repo_key in tracked,
                }
                for repo in discovered
            ]
        },
    )


def get_dev_repos(payload: dict):
    return response(True, {"repos": database().list_dev_repos()})


def save_dev_repo(payload: dict):
    repo_path = payload.get("repoPath", payload.get("repo_path"))
    if not isinstance(repo_path, str) or not repo_path:
        return response(False, error="repoPath is required")
    author_email = payload.get("authorEmail", payload.get("author_email"))
    registered = register_dev_repo(
        database(),
        repo_path,
        author_email if isinstance(author_email, str) and author_email else None,
    )
    if registered is None:
        return response(False, error="path is not a git repository")
    return response(True, registered)


def delete_dev_repo(payload: dict):
    repo_key = payload.get("repoKey", payload.get("repo_key"))
    if not isinstance(repo_key, str) or not repo_key:
        return response(False, error="repoKey is required")
    return response(True, {"deleted": database().delete_dev_repo(repo_key)})


def sync_dev_signals(payload: dict):
    raw_days = payload.get("backfillDays", payload.get("backfill_days"))
    try:
        backfill_days = int(raw_days) if raw_days is not None else DEV_SIGNALS_BACKFILL_DAYS
    except (TypeError, ValueError):
        backfill_days = DEV_SIGNALS_BACKFILL_DAYS
    result = run_dev_signals_ingest(database(), backfill_days=max(1, backfill_days))
    return response(
        True,
        {
            "commitsIngested": result.commits_ingested,
            "agentTurnsIngested": result.agent_turns_ingested,
            "filesScanned": result.files_scanned,
            "skippedFiles": result.skipped_files,
        },
    )


def list_ssh_agent_sources(_payload: dict):
    return response(True, list_ssh_agent_source_aliases())


def test_ssh_agent_source(payload: dict):
    return response(True, test_ssh_agent_source_connection(payload.get("host")))


def collect_ssh_agent_source(payload: dict):
    raw_days = payload.get("backfillDays", payload.get("backfill_days"))
    try:
        backfill_days = int(raw_days) if raw_days is not None else DEV_SIGNALS_BACKFILL_DAYS
    except (TypeError, ValueError):
        backfill_days = DEV_SIGNALS_BACKFILL_DAYS
    return response(
        True,
        collect_ssh_agent_source_metadata(
            database(),
            payload.get("host"),
            backfill_days=max(1, backfill_days),
        ),
    )


def get_dev_signals(payload: dict):
    """Commit markers and agent time for one day.

    Agent turns overlap when sessions run in parallel, so the summary reports
    wall-clock time (real time with at least one agent working) separately from
    the cumulative sum. Only wall-clock is comparable to tracked attention time.
    """
    start, end = day_bounds(payload)
    db = database()
    commits = db.fetch_dev_commit_events(start, end)
    agent_events = db.fetch_agent_session_events(start, end)
    summary = summarize_agent_time(agent_events)
    return response(
        True,
        {
            "commits": commits,
            "agentTurns": agent_events,
            "agentSummary": {
                "wallClockSeconds": summary.wall_clock_seconds,
                "cumulativeSeconds": summary.cumulative_seconds,
                "concurrencyPeak": summary.concurrency_peak,
                "parallelFactor": round(summary.parallel_factor, 2),
                "spans": [
                    {"start": span.start.isoformat(), "end": span.end.isoformat()}
                    for span in summary.spans
                ],
            },
        },
    )


def get_agent_concurrency_peak(payload: dict):
    """Highest concurrent agent-turn count in a date range.

    Your Agents uses this to lock a personal intensity scale without pulling
    every turn body for the lookback window.
    """
    start, end = day_bounds(payload)
    agent_events = database().fetch_agent_session_events(start, end)
    return response(True, {"peak": peak_concurrency(agent_events)})


def get_projects(payload: dict):
    return response(True, database().get_projects())


def save_project(payload: dict):
    project_input = payload.get("input", payload)
    if not isinstance(project_input, dict):
        return response(False, error="input must be an object")
    try:
        project = database().save_project(project_input)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, project)


def delete_project(payload: dict):
    project_id = payload.get("id")
    if not isinstance(project_id, str) or not project_id:
        return response(False, error="id is required")
    deleted = database().delete_project(project_id)
    return response(True, {"deleted": deleted})


def save_project_anchors(payload: dict):
    project_id = payload.get("projectId", payload.get("project_id"))
    if not isinstance(project_id, str) or not project_id:
        return response(False, error="projectId is required")
    anchors = payload.get("anchors", [])
    if not isinstance(anchors, list):
        return response(False, error="anchors must be a list")
    try:
        result = database().save_project_anchors(project_id, anchors)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, result)


def delete_project_anchor(payload: dict):
    project_id = payload.get("projectId", payload.get("project_id"))
    kind = payload.get("kind")
    value = payload.get("value")
    if not isinstance(project_id, str) or not project_id:
        return response(False, error="projectId is required")
    if not isinstance(kind, str) or not isinstance(value, str):
        return response(False, error="kind and value are required")
    deleted = database().delete_project_anchor(project_id, kind, value)
    return response(True, {"deleted": deleted})


def save_project_assignments(payload: dict):
    assignments = payload.get("assignments", [])
    if not isinstance(assignments, list):
        return response(False, error="assignments must be a list")
    return response(True, database().save_project_assignments(assignments))


def get_project_assignments(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().get_project_assignments(start, end))


def save_project_window_assignments(payload: dict):
    assignments = payload.get("assignments", [])
    if not isinstance(assignments, list):
        return response(False, error="assignments must be a list")
    return response(True, database().save_project_window_assignments(assignments))


def get_project_window_assignments(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().get_project_window_assignments(start, end))


def upsert_team_projects(payload: dict):
    organization_id = payload.get("organizationId", payload.get("organization_id"))
    if not isinstance(organization_id, str) or not organization_id.strip():
        return response(False, error="organizationId is required")
    projects = payload.get("projects", [])
    if not isinstance(projects, list):
        return response(False, error="projects must be a list")
    try:
        result = database().upsert_team_projects(organization_id, projects)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, result)


def get_team_projects(payload: dict):
    return response(True, database().get_team_projects())


def save_team_project_assignments(payload: dict):
    assignments = payload.get("assignments", [])
    if not isinstance(assignments, list):
        return response(False, error="assignments must be a list")
    return response(True, database().save_team_project_assignments(assignments))


def get_team_project_assignments(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().get_team_project_assignments(start, end))


def record_project_pass(payload: dict):
    pass_input = payload.get("input", payload)
    if not isinstance(pass_input, dict):
        return response(False, error="input must be an object")
    return response(True, database().record_project_pass(pass_input))


def get_project_pass_runs(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().get_project_pass_runs(start, end))


def save_ai_review_events(payload: dict):
    events = payload.get("events", [])
    if not isinstance(events, list):
        return response(False, error="events must be a list")
    saved = database().save_ai_review_events(events)
    return response(True, {"saved": saved})


def get_ai_review_events(payload: dict):
    start, end = day_bounds(payload)
    return response(True, database().get_ai_review_events(start, end))


def revert_ai_review_event(payload: dict):
    event_id = payload.get("id")
    if not isinstance(event_id, int) or isinstance(event_id, bool):
        return response(False, error="id must be an integer")
    return response(True, database().revert_ai_review_event(event_id))


def preview_browser_history_import(payload: dict):
    from app.tracker.browser_history_import import preview_browser_history_import as preview_import

    try:
        request = _browser_history_import_request(payload)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, preview_import(request).to_payload())


def get_browser_history_environment(payload: dict):
    from app.tracker.browser_history import browser_history_environment

    # Returns booleans only (safariHistoryReadable, defaultBrowserIsSafari) for the
    # Safari onboarding-row decision and Full Disk Access polling. The readable check
    # also registers Drifty in the Full Disk Access list. No paths/URLs/titles.
    return response(True, browser_history_environment())


def import_browser_history(payload: dict):
    from app.tracker.browser_history_import import import_browser_history as run_import

    try:
        request = _browser_history_import_request(payload)
    except ValueError as exc:
        return response(False, error=str(exc))
    return response(True, run_import(database(), request).to_payload())


def set_developer_diagnostics(payload: JsonObject):
    return response(True, save_developer_diagnostics(database(), payload))


def _failed_foreground_capture(snapshot: Snapshot) -> bool:
    return snapshot.frontmost_capture_source == "unavailable" or (
        snapshot.frontmost_capture_source is None
        and snapshot.source == "unknown"
        and snapshot.app_name.strip() == "Unavailable"
        and not snapshot.bundle_id
    )


def get_current_snapshot():
    if DB_PATH.exists():
        _apply_developer_diagnostics_env(database())
    else:
        _apply_developer_diagnostics_defaults()
    snapshot = current_snapshot()
    if snapshot.source == "unknown" and _failed_foreground_capture(snapshot):
        # A failed foreground read is a capture gap, just as in the daemon
        # loop. Limit this response change to Windows' unknown-source failure;
        # macOS frontmost reads retain their existing response contract.
        return response(True)
    if DB_PATH.exists():
        excluded_rules = database().get_excluded_app_rules()
        match = match_app_exclusion(snapshot.app_name, snapshot.bundle_id, excluded_rules)
        if match:
            snapshot = redact_snapshot(snapshot, match.source)
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
            "windowTitleSource": snapshot.window_title_source,
        },
    )


def audio_grace_is_active(
    last_supported_at: str | None,
    now: datetime,
    grace_seconds: int = PASSIVE_AUDIO_GAP_GRACE_SECONDS,
) -> bool:
    if not last_supported_at:
        return False
    try:
        parsed = datetime.fromisoformat(last_supported_at)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        return False
    elapsed = (now - parsed.astimezone(timezone.utc)).total_seconds()
    return 0 <= elapsed <= grace_seconds


def engagement_decision_for_tick(
    db: TrackerDatabase,
    idle_seconds: float | None,
    *,
    now: datetime | None = None,
    interactive_threshold_seconds: int = IDLE_THRESHOLD_SECONDS,
    passive_lease_seconds: int = PASSIVE_ACTIVITY_LEASE_SECONDS,
) -> EngagementDecision:
    reference_time = now or datetime.now(timezone.utc)
    if idle_seconds is None:
        db.set_meta("idle_detection_available", "false")
    else:
        db.set_meta("idle_detection_available", "true")
        db.set_meta("idle_seconds", f"{idle_seconds:.3f}")

    if idle_seconds is None or idle_seconds < interactive_threshold_seconds:
        db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        reset_foreground_audio_diagnostics(
            db,
            "idle_detection_unavailable" if idle_seconds is None else "interactive_input",
        )
        return decide_engagement(
            idle_seconds=idle_seconds,
            audio_supported=False,
            audio_grace_active=False,
            latest_engagement_evidence=None,
            interactive_threshold_seconds=interactive_threshold_seconds,
            passive_lease_seconds=passive_lease_seconds,
        )

    latest_evidence = db.latest_local_engagement_evidence()
    if latest_evidence != FOREGROUND_AUDIO_EVIDENCE:
        latest_evidence = None
    # Evidence alone never opens grace: the separate supported-at timestamp
    # must also be <=15s old, and is cleared on direct input, daemon start,
    # explicit/engagement stop, and power suppression. That makes an older DB
    # row inert across sessions while still letting the first dropout after a
    # just-recorded passive sample keep its already-supported time.

    audio_supported = False
    grace_active = False
    grace_eligible = True
    remaining_seconds = max(0, math.ceil(passive_lease_seconds - idle_seconds))
    db.set_meta("passive_lease_remaining_seconds", str(remaining_seconds))
    if idle_seconds < passive_lease_seconds:
        try:
            audio_sample = current_foreground_audio_sample()
        except Exception:
            # The native probe already fails closed for expected CoreAudio and
            # process-inspection errors. Keep the daemon alive if an unexpected
            # import/runtime edge escapes that boundary.
            db.set_meta("foreground_audio_detection_available", "false")
            db.set_meta("foreground_audio_active", "false")
            db.set_meta("foreground_audio_reason", "probe_failed")
            # A crashed native probe is stronger uncertainty than a momentary
            # no-output sample. Do not bridge it with the dropout grace.
            grace_eligible = False
        else:
            audio_supported = bool(audio_sample.available and audio_sample.active)
            # Output that definitely belongs to another process is an ownership
            # change, not a dropout in the previously supported foreground app.
            grace_eligible = audio_sample.reason != "active_output_not_owned_by_frontmost"
            db.set_meta("foreground_audio_detection_available", str(bool(audio_sample.available)).lower())
            db.set_meta("foreground_audio_active", str(audio_supported).lower())
            db.set_meta("foreground_audio_reason", audio_sample.reason)
        if audio_supported:
            supported_at = reference_time.isoformat()
            db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, supported_at)
            grace_active = True
        elif grace_eligible:
            grace_active = audio_grace_is_active(
                db.get_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY),
                reference_time,
            )

    return decide_engagement(
        idle_seconds=idle_seconds,
        audio_supported=audio_supported,
        audio_grace_active=grace_active,
        latest_engagement_evidence=latest_evidence,
        interactive_threshold_seconds=interactive_threshold_seconds,
        passive_lease_seconds=passive_lease_seconds,
    )


def _retry_pending_input_cleanup(db: TrackerDatabase, timeline: CaptureTimeline) -> None:
    if timeline.pending_input_trims:
        db.trim_captured_segments(list(timeline.pending_input_trims.values()))
        timeline.pending_input_trims.clear()
        timeline.cleanup_retry_logged = False


def apply_engagement_stop(
    db: TrackerDatabase,
    decision: EngagementDecision,
    idle_seconds: float | None,
    *,
    now: datetime | None = None,
    input_tick: float | None = None,
) -> None:
    timeline = db.capture_timeline if isinstance(db.capture_timeline, CaptureTimeline) else None
    if decision.kind == "stop_and_trim_to_input" and idle_seconds is not None:
        if input_tick is not None and timeline is not None:
            timeline.queue_input_stop(input_tick - idle_seconds)
        else:
            reference_time = now or datetime.now(timezone.utc)
            idle_started_at = reference_time - timedelta(seconds=idle_seconds)
            db.trim_latest_segment(idle_started_at.isoformat())
    if timeline is not None:
        _retry_pending_input_cleanup(db, timeline)
        timeline.clear_observations()
    db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
    reset_foreground_audio_diagnostics(db, "engagement_stopped")
    db.set_meta("tracker_mode", "idle")


def reset_foreground_audio_diagnostics(db: TrackerDatabase, reason: str) -> None:
    db.set_meta("foreground_audio_detection_available", "false")
    db.set_meta("foreground_audio_active", "false")
    db.set_meta("foreground_audio_reason", reason)
    db.set_meta("passive_lease_remaining_seconds", "")


def handle_power_state_sample(db: TrackerDatabase, power_state: PowerStateSample,
                              *, timeline: CaptureTimeline | None = None) -> bool:
    if power_state.should_capture:
        return False

    observed_at = power_state.observed_at.isoformat()
    if timeline is None:
        db.trim_latest_segment(observed_at)
    # Completed samples already end before suppression in capture order.
    # A corrected wall clock is not evidence that their supported time should
    # be shortened. Retain pending input anchors: resuming without new input
    # must still clean up the provisional interactive time before suppression.
    db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
    reset_foreground_audio_diagnostics(db, "power_suppressed")
    db.set_meta("tracker_mode", "suppressed")
    db.set_meta("capture_suppressed_reason", power_state.reason)
    db.set_meta("last_capture_suppressed_at", observed_at)
    return True


def sample_seconds_since_previous(previous_tick: float | None, current_tick: float, default_seconds: int = SAMPLE_SECONDS) -> int:
    if previous_tick is None:
        return default_seconds
    return max(default_seconds, int(round(current_tick - previous_tick)))


def enqueue_youtube_metadata_fetch(db: TrackerDatabase, video_id: str | None, site_url: str | None) -> None:
    if not video_id or not site_url:
        return

    # Check on the calling thread's existing connection. The worker opens its
    # own connection; SQLite connections must not cross thread boundaries.
    if not db.youtube_metadata_should_fetch(video_id):
        return

    with _YOUTUBE_METADATA_LOCK:
        if video_id in _YOUTUBE_METADATA_IN_FLIGHT:
            return
        _YOUTUBE_METADATA_IN_FLIGHT.add(video_id)

    try:
        threading.Thread(
            target=_fetch_youtube_metadata_background,
            args=(db.db_path, video_id, site_url),
            daemon=True,
        ).start()
    except RuntimeError:
        # Optional enrichment must not interrupt capture or leave a video
        # permanently in-flight when the host cannot start another thread.
        with _YOUTUBE_METADATA_LOCK:
            _YOUTUBE_METADATA_IN_FLIGHT.discard(video_id)


def _fetch_youtube_metadata_background(db_path: Path, video_id: str, site_url: str) -> None:
    db: TrackerDatabase | None = None
    try:
        db = TrackerDatabase(db_path, perform_maintenance=False)
        if not db.youtube_metadata_should_fetch(video_id):
            return
        metadata = fetch_youtube_metadata(site_url, video_id, timeout_seconds=YOUTUBE_METADATA_TIMEOUT_SECONDS)
        db.save_youtube_metadata(metadata, require_activity_reference=True)
    except Exception:
        if db is None:
            db = TrackerDatabase(db_path, perform_maintenance=False)
        db.save_youtube_metadata_failure(video_id, require_activity_reference=True)
    finally:
        try:
            if db is not None:
                db.close()
        finally:
            with _YOUTUBE_METADATA_LOCK:
                _YOUTUBE_METADATA_IN_FLIGHT.discard(video_id)


def get_sync_outbox(payload: dict):
    after_seq = payload.get("afterSeq", 0)
    if not isinstance(after_seq, int) or after_seq < 0:
        return response(False, error="afterSeq must be a non-negative integer")
    limit = payload.get("limit", 500)
    if not isinstance(limit, int) or limit <= 0:
        return response(False, error="limit must be a positive integer")
    hot_grace = payload.get("hotGraceSeconds")
    if hot_grace is not None and (not isinstance(hot_grace, int) or hot_grace < 0):
        return response(False, error="hotGraceSeconds must be a non-negative integer")
    return response(True, database().get_sync_outbox(after_seq, limit, hot_grace))


def get_sync_state(payload: dict):
    return response(True, database().get_sync_state())


def set_sync_state(payload: dict):
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return response(False, error="entries must be an object")
    written = database().set_sync_state(entries)
    return response(True, {"written": written})


def apply_synced_segments(payload: dict):
    segments = payload.get("segments")
    if not isinstance(segments, list):
        return response(False, error="segments must be a list")
    items = [item for item in segments if isinstance(item, dict)]
    return response(True, database().apply_synced_segments(items))


def get_pending_sync_deletions(payload: dict):
    limit = payload.get("limit", 100)
    if not isinstance(limit, int) or limit <= 0:
        return response(False, error="limit must be a positive integer")
    return response(True, database().get_pending_sync_deletions(limit))


def mark_sync_deletions_pushed(payload: dict):
    raw_uids = payload.get("deletionUids")
    if not isinstance(raw_uids, list):
        return response(False, error="deletionUids must be a list")
    uids = [uid for uid in raw_uids if isinstance(uid, str) and uid]
    marked = database().mark_sync_deletions_pushed(uids)
    return response(True, {"marked": marked})


def apply_synced_deletions(payload: dict):
    deletions = payload.get("deletions")
    if not isinstance(deletions, list):
        return response(False, error="deletions must be a list")
    items = [item for item in deletions if isinstance(item, dict)]
    return response(True, database().apply_synced_deletions(items))


def purge_remote_segments(payload: dict):
    purged = database().purge_remote_segments()
    return response(True, {"purged": purged})


def backup_for_version_switch(payload: dict):
    from app.storage.database_maintenance import create_rotating_backup
    db = database()
    path = create_rotating_backup(db.connect(), db.db_path, interval_seconds=0)
    if path is None:
        return response(False, error="No verified tracker backup was created")
    return response(True, str(path))


COMMANDS = {
    "backup_for_version_switch": backup_for_version_switch,
    "get_status": get_status,
    "verify_current_runtime_running": lambda payload: verify_current_runtime_running(),
    "start_tracking": lambda payload: start_tracking(),
    "stop_tracking": lambda payload: stop_tracking(),
    "get_timeline": get_timeline,
    "get_timeline_page": get_timeline_page,
    "search_timeline": search_timeline,
    "get_dashboard_week_timeline": get_dashboard_week_timeline,
    "get_project_trend_timeline": get_project_trend_timeline,
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
    "get_excluded_apps": get_excluded_apps,
    "save_excluded_app": save_excluded_app,
    "delete_excluded_app": delete_excluded_app,
    "get_excluded_app_history_count": get_excluded_app_history_count,
    "delete_excluded_app_history": delete_excluded_app_history,
    "get_recent_apps": get_recent_apps,
    "delete_activity_segments": delete_activity_segments,
    "delete_history_range": delete_history_range,
    "search_classification_rule_candidates": search_classification_rule_candidates,
    "apply_classification_rules": apply_classification_rules,
    "save_classifications": save_classifications,
    "refresh_non_ai_classifications": refresh_non_ai_classifications,
    "get_classification_metrics": get_classification_metrics,
    "get_projects": get_projects,
    "save_project": save_project,
    "delete_project": delete_project,
    "discover_dev_repos": discover_dev_repos,
    "get_dev_repos": get_dev_repos,
    "save_dev_repo": save_dev_repo,
    "delete_dev_repo": delete_dev_repo,
    "sync_dev_signals": sync_dev_signals,
    "list_ssh_agent_sources": list_ssh_agent_sources,
    "test_ssh_agent_source": test_ssh_agent_source,
    "collect_ssh_agent_source": collect_ssh_agent_source,
    "get_dev_signals": get_dev_signals,
    "get_agent_concurrency_peak": get_agent_concurrency_peak,
    "save_project_anchors": save_project_anchors,
    "delete_project_anchor": delete_project_anchor,
    "save_project_assignments": save_project_assignments,
    "get_project_assignments": get_project_assignments,
    "save_project_window_assignments": save_project_window_assignments,
    "get_project_window_assignments": get_project_window_assignments,
    "upsert_team_projects": upsert_team_projects,
    "get_team_projects": get_team_projects,
    "save_team_project_assignments": save_team_project_assignments,
    "get_team_project_assignments": get_team_project_assignments,
    "record_project_pass": record_project_pass,
    "get_project_pass_runs": get_project_pass_runs,
    "save_ai_review_events": save_ai_review_events,
    "get_ai_review_events": get_ai_review_events,
    "revert_ai_review_event": revert_ai_review_event,
    "preview_browser_history_import": preview_browser_history_import,
    "import_browser_history": import_browser_history,
    "get_browser_history_environment": get_browser_history_environment,
    "set_developer_diagnostics": set_developer_diagnostics,
    "get_sync_outbox": get_sync_outbox,
    "get_sync_state": get_sync_state,
    "set_sync_state": set_sync_state,
    "apply_synced_segments": apply_synced_segments,
    "get_pending_sync_deletions": get_pending_sync_deletions,
    "mark_sync_deletions_pushed": mark_sync_deletions_pushed,
    "apply_synced_deletions": apply_synced_deletions,
    "purge_remote_segments": purge_remote_segments,
}


def _daemon_tick(
    db: TrackerDatabase,
    last_capture_tick: float | None,
    *,
    capture_allowed: Callable[[], bool] | None = None,
) -> float | None:
    """Run one sampling tick and return the next ``last_capture_tick`` value.

    Returns ``None`` when no snapshot was captured (power-suppressed or idle),
    mirroring a capture gap so the next capture uses the default sample length.
    """
    if capture_allowed is not None and not capture_allowed():
        return None
    # Non-storage adapters used by callers/tests can retain the standalone
    # trim API. The daemon's real database owns one non-persisted generation.
    timeline = db.capture_timeline if isinstance(db.capture_timeline, CaptureTimeline) else None
    power_state = current_power_state()
    power_suppressed = (handle_power_state_sample(db, power_state, timeline=timeline)
                        if timeline is not None else handle_power_state_sample(db, power_state))
    if power_suppressed:
        return None

    idle_seconds = seconds_since_last_input()
    input_tick = time.monotonic() if timeline is not None else None
    reference_time = datetime.now(timezone.utc)
    engagement = engagement_decision_for_tick(db, idle_seconds, now=reference_time)
    if not engagement.should_capture:
        apply_engagement_stop(db, engagement, idle_seconds, now=reference_time, input_tick=input_tick)
        return None

    pending_cleanup_failed = False
    if timeline is not None and timeline.pending_input_trims:
        try:
            _retry_pending_input_cleanup(db, timeline)
        except Exception:
            # Cleanup is recoverable maintenance. Keep its frozen plans, but
            # do not lose newly supported activity while a backup is locked.
            # Capture below cannot merge into a still-queued target.
            # The original failed stop already reaches the daemon's error
            # reporter. Do not synchronously flush telemetry on every active
            # retry; it can delay capture while the same error persists.
            if not timeline.cleanup_retry_logged:
                print("tracker idle cleanup retry failed:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                timeline.cleanup_retry_logged = True
            pending_cleanup_failed = True

    _apply_developer_diagnostics_env(db)
    if capture_allowed is not None and not capture_allowed():
        return None
    # Both OS snapshot providers stamp observed_at at the start of inspection.
    # Pair it with monotonic time before a potentially blocking foreground read.
    snapshot_tick = time.monotonic() if timeline is not None else None
    snapshot = current_snapshot(include_system_transient=False)
    # Foreground inspection can block. Discard its result if the owning app
    # exited or cooperative Stop arrived while the OS resolved the snapshot.
    if capture_allowed is not None and not capture_allowed():
        return None
    if _failed_foreground_capture(snapshot):
        # A failed foreground read is a gap, not an app the user opened.
        return None
    snapshot.engagement_evidence = FOREGROUND_AUDIO_EVIDENCE if engagement.is_passive else None
    capture_tick = time.monotonic()
    windows_sampling_gap = (
        sys.platform == "win32"
        and last_capture_tick is not None
        and is_sleep_gap(capture_tick - last_capture_tick, SAMPLE_SECONDS)
    )
    if windows_sampling_gap:
        # A long interruption is unobserved time, not activity in the first
        # foreground app seen after resume. Start a fresh sample and segment.
        last_capture_tick = None
    sample_seconds = (
        timeline.credit_sample_seconds(last_capture_tick, capture_tick, SAMPLE_SECONDS)
        if timeline is not None
        else sample_seconds_since_previous(last_capture_tick, capture_tick)
    )
    capture_options = ({"unmergeable_segment_uids": frozenset(timeline.pending_input_trims)}
                       if pending_cleanup_failed and timeline is not None else {})
    if engagement.is_passive:
        passive_merge_gap = PASSIVE_AUDIO_GAP_GRACE_SECONDS if last_capture_tick is not None else 0
        mutation = db.record_snapshot(snapshot, sample_seconds, max_merge_gap_seconds=passive_merge_gap,
                                      **capture_options)
    else:
        interactive_merge_gap = 0 if windows_sampling_gap else IDLE_THRESHOLD_SECONDS
        mutation = db.record_snapshot(snapshot, sample_seconds, max_merge_gap_seconds=interactive_merge_gap,
                                      **capture_options)
    if timeline is not None and isinstance(mutation, CaptureMutation):
        timeline.remember(mutation, snapshot_tick,
                          input_tick - idle_seconds if idle_seconds is not None else None,
                          passive=engagement.is_passive, continuous=last_capture_tick is not None)
    if isinstance(mutation, CaptureMutation):
        enqueue_youtube_metadata_fetch(db, mutation.youtube_video_id, mutation.site_url)
    backfill_browser_history_context(db, snapshot.observed_at)
    db.set_meta("last_event_at", snapshot.observed_at)
    # Preserve the existing public tracker-mode vocabulary. Passive support is
    # diagnostic evidence for this segment, not a new daemon lifecycle mode.
    db.set_meta("tracker_mode", "tracking")
    return capture_tick


def _maybe_create_periodic_backup(
    maintenance: DaemonMaintenance,
    last_check_wall_seconds: float,
    *,
    now_wall_seconds: float | None = None,
) -> float:
    current = time.time() if now_wall_seconds is None else now_wall_seconds
    elapsed = current - last_check_wall_seconds
    if elapsed < 0:
        # A wall-clock correction should restart the inexpensive hourly check
        # window rather than suppress backups for an unbounded period.
        return current
    if elapsed < DATABASE_BACKUP_CHECK_SECONDS:
        return last_check_wall_seconds
    maintenance.request_backup()
    return current


def _maybe_ingest_dev_signals(
    maintenance: DaemonMaintenance,
    last_check_wall_seconds: float,
    *,
    now_wall_seconds: float | None = None,
) -> float:
    current = time.time() if now_wall_seconds is None else now_wall_seconds
    elapsed = current - last_check_wall_seconds
    if elapsed < 0:
        # A wall-clock correction restarts the window instead of suspending
        # ingestion for an unbounded stretch.
        return current
    if elapsed < DEV_SIGNALS_INGEST_INTERVAL_SECONDS:
        return last_check_wall_seconds
    maintenance.request_agent_ingest()
    return current


def _close_loaded_windows_capture() -> None:
    if sys.platform != "win32":
        return
    capture = sys.modules.get("app.tracker.windows_browser_capture")
    if capture is not None:
        capture.close_browser_capture()
    else:
        # A direct UIA caller can load the host without loading the URL worker.
        # Do not import either module during shutdown and create fresh state.
        uia = sys.modules.get("app.tracker.windows_browser_uia")
        if uia is not None:
            uia._close_host()


def _close_loaded_macos_capture() -> None:
    capture = sys.modules.get("app.tracker.macos_capture")
    if capture is not None:
        capture.context_worker.close()


def daemon():
    from app.process_liveness import tracker_app_owner

    with tracker_app_owner() as owner:
        if owner is not None and not owner.is_alive():
            return
        _daemon_with_owner(owner)


def _is_sqlite_lock_error(error: sqlite3.OperationalError) -> bool:
    code = getattr(error, "sqlite_errorcode", None)
    if code is not None:
        # Primary SQLITE_BUSY / SQLITE_LOCKED, including extended result codes.
        return (code & 0xFF) in (5, 6)
    # System Python 3.9 does not expose sqlite_errorcode.
    message = str(error).lower()
    return message in (
        "database is locked", "database table is locked", "database schema is locked"
    ) or message.startswith(("database table is locked:", "database schema is locked:"))


def _daemon_with_owner(owner: ProcessOwner | None) -> None:
    daemon_pid = os.getpid()
    lock_file = _acquire_tracker_daemon_lock()
    if lock_file is None:
        return

    stop_event = None
    maintenance = None
    try:
        if owner is not None and not owner.is_alive():
            return
        if sys.platform == "win32":
            from app.windows_daemon_shutdown import WindowsDaemonStopEvent

            # Publish the process-generation event under the daemon lock and
            # before the PID record, including during database initialization.
            stop_event = WindowsDaemonStopEvent(DB_PATH)
        if owner is not None and not owner.is_alive():
            return
        _write_tracker_pid(daemon_pid)

        def capture_allowed() -> bool:
            return (owner is None or owner.is_alive()) and (
                stop_event is None or not stop_event.requested()
            )

        def wait_for_next_tick() -> bool:
            if stop_event is not None:
                # One native wait wakes for either cancellation source. Waiting
                # only on the app handle would delay an ordinary Stop by a tick.
                return (
                    stop_event.wait(SAMPLE_SECONDS)
                    if owner is None
                    else stop_event.wait(SAMPLE_SECONDS, owner=owner)
                )
            if owner is not None:
                return owner.wait_until_exit(SAMPLE_SECONDS)
            time.sleep(SAMPLE_SECONDS)
            return False

        startup_lock_reported = False
        while True:
            try:
                db = database()
                if isinstance(db.capture_timeline, CaptureTimeline):
                    db.capture_timeline = CaptureTimeline()
                db.set_meta("tracker_script_path", _current_script_path())
                db.set_meta(TRACKER_RUNTIME_FINGERPRINT_META_KEY, _tracker_runtime_fingerprint())
                # A grace window is meaningful only inside one uninterrupted daemon
                # run. Restarts and manual stop/start cycles begin fail-closed.
                db.set_meta(PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
                reset_foreground_audio_diagnostics(db, "daemon_started")
                break
            except sqlite3.OperationalError as exc:
                if not _is_sqlite_lock_error(exc):
                    raise
                # Initialization can contend with another local writer just
                # like a sampling tick. Keep the sole daemon alive and retry
                # on its existing cadence, without capturing before all startup
                # state is ready or crediting the wait as tracked activity.
                if not capture_allowed():
                    return
                if not startup_lock_reported:
                    # One uninterrupted startup-lock episode needs one remote
                    # report/flush; retain local evidence of every later retry.
                    startup_lock_reported = True
                    capture_tracker_exception(exc, {"phase": "daemon_database_startup"})
                print("tracker database startup locked; retrying:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                if wait_for_next_tick() or not capture_allowed():
                    return

        last_capture_tick: float | None = None
        maintenance = DaemonMaintenance(DB_PATH, backfill_days=DEV_SIGNALS_BACKFILL_DAYS,
                                        max_files=DEV_SIGNALS_DAEMON_MAX_FILES)
        last_backup_check = time.time()
        # One wall-clock read per loop feeds both maintenance windows.
        last_dev_signals_ingest = last_backup_check

        while capture_allowed():
            backup_check_started_at = time.time()
            try:
                last_backup_check = _maybe_create_periodic_backup(
                    maintenance,
                    last_backup_check,
                    now_wall_seconds=backup_check_started_at,
                )
            except Exception as exc:
                # Maintenance must never suppress the primary capture loop,
                # even if an unexpected backup bug escapes the storage layer.
                last_backup_check = backup_check_started_at
                capture_tracker_exception(exc, {"phase": "database_periodic_backup"})
                print("tracker database periodic backup failed:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
            if not capture_allowed():
                break
            try:
                last_dev_signals_ingest = _maybe_ingest_dev_signals(
                    maintenance,
                    last_dev_signals_ingest,
                    now_wall_seconds=backup_check_started_at,
                )
            except Exception as exc:
                # Reading another tool's session logs is best-effort. A parser
                # or permission failure must not interrupt capture.
                last_dev_signals_ingest = backup_check_started_at
                capture_tracker_exception(exc, {"phase": "dev_signals_periodic_ingest"})
                print("tracker dev signals periodic ingest failed:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
            if not capture_allowed():
                break
            try:
                if owner is None and stop_event is None:
                    last_capture_tick = _daemon_tick(db, last_capture_tick)
                else:
                    last_capture_tick = _daemon_tick(db, last_capture_tick, capture_allowed=capture_allowed)
            except Exception as exc:
                # One failed tick (Apple Event failure, a locked database,
                # an unexpected snapshot shape, ...) must not kill tracking
                # until the next app relaunch; log it and keep sampling.
                # KeyboardInterrupt/SystemExit still propagate and stop the loop.
                capture_tracker_exception(exc, {"phase": "daemon_tick"})
                print("tracker daemon tick failed:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                # A failed tick means a capture gap, so the next successful
                # capture starts from the default sample length again.
                last_capture_tick = None
            if wait_for_next_tick():
                break
    finally:
        try:
            if maintenance is not None:
                maintenance.close()
            _close_loaded_macos_capture()
            _close_loaded_windows_capture()
        finally:
            try:
                _remove_pid_record_if_owned(daemon_pid)
            finally:
                try:
                    if stop_event is not None:
                        stop_event.close()
                finally:
                    _release_tracker_daemon_lock(lock_file)


def _dispatch(request: dict):
    command = request["command"]
    payload = request.get("payload", {})
    handler = COMMANDS[command]
    return handler(payload)


def _safe_request_command(request: dict | None) -> str:
    if not request:
        return "unknown"
    command = request.get("command")
    return command if isinstance(command, str) else "unknown"


def handle_request(raw_request: str):
    request = None
    try:
        request = json.loads(raw_request)
        serialized = json.dumps(_dispatch(request))
    except Exception as exc:
        capture_tracker_exception(exc, {"phase": "request", "command": _safe_request_command(request)})
        serialized = json.dumps(response(False, error=str(exc)))
    # A completed command is not a failed command when its caller disconnects.
    # Use the same response-write boundary as the persistent server, including
    # flushing buffered short responses before Python's shutdown flush.
    _write_response_line(serialized)


def serve():
    """Persistent request server (one JSON request per stdin line, one JSON
    response per stdout line).

    Keeps the interpreter warm and modules imported so each query avoids the
    ~200-400ms cold-start cost of spawning a fresh ``python main.py`` process.
    Errors are returned per request and never break the loop; EOF on stdin
    (parent process exit / closed pipe) ends the loop cleanly, as does a
    host that closes its response pipe.
    """
    # The Rust host writes UTF-8 JSON lines. Windows otherwise decodes a piped
    # stdin with the ANSI code page (cp949 on Korean Windows), which turns every
    # non-ASCII request field into lone surrogates that SQLite then rejects.
    # "replace" keeps one malformed byte from raising outside the per-request
    # handler and ending the serve loop.
    reconfigure = getattr(sys.stdin, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8", errors="replace")
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = None
        request = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            envelope = _dispatch(request)
        except Exception as exc:  # never let a single bad request kill the server
            capture_tracker_exception(exc, {"phase": "serve", "command": _safe_request_command(request)})
            envelope = response(False, error=str(exc))
        if request_id is not None:
            envelope = {**envelope, "id": request_id}
        serialized = json.dumps(envelope)
        if not _write_response_line(serialized):
            # There is no reader for this response. Stop before dispatching any
            # more requests; a completed mutation must never be replayed here.
            return


def _write_response_line(serialized: str) -> bool:
    try:
        sys.stdout.write(serialized)
        sys.stdout.write("\n")
        sys.stdout.flush()
    except OSError as exc:
        if not _is_closed_serve_pipe(exc):
            raise
        _detach_closed_stdout()
        return False
    return True


def _is_closed_serve_pipe(error: OSError) -> bool:
    if isinstance(error, BrokenPipeError):
        return True
    # The Windows CRT can report a disconnected output pipe as EINVAL rather than
    # BrokenPipeError. Only accept that error at the response-write boundary,
    # on Windows, with stdout confirmed to be a pipe (not a file or console).
    if sys.platform != "win32" or error.errno != errno.EINVAL:
        return False
    try:
        return stat.S_ISFIFO(os.fstat(sys.stdout.fileno()).st_mode)
    except (OSError, ValueError, AttributeError):
        return False


def _detach_closed_stdout() -> None:
    """Prevent Python's exit-time flush from retrying the disconnected pipe."""
    try:
        stdout_fd = sys.stdout.fileno()
        devnull = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(devnull, stdout_fd)
        finally:
            os.close(devnull)
    except (OSError, ValueError, AttributeError):
        # A replaced/closed stream may not expose a usable file descriptor.
        pass


def _is_public_cli_invocation(arguments: list[str]) -> bool:
    if "--request-json" in arguments:
        return False
    legacy_options_with_values = {"--db", "--request-json", "--smoke-id"}
    legacy_modes = {"request", "daemon", "serve", SENTRY_SMOKE_MODE, SENTRY_SDK_CHECK_MODE}
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument in legacy_options_with_values:
            index += 2
            continue
        if any(argument.startswith(f"{option}=") for option in legacy_options_with_values):
            index += 1
            continue
        if argument.startswith("-"):
            index += 1
            continue
        return argument not in legacy_modes
    return True


def main():
    # Native framing bypasses CLI output, telemetry and database initialization.
    if (len(sys.argv) == 3 and sys.argv[1] == "browser-context-host") or (len(sys.argv) == 2 and sys.argv[1].startswith("chrome-extension://")):
        from app.tracker.browser_content_host import run_native_host
        raise SystemExit(run_native_host(sys.argv[-1]))

    user_cli_args = sys.argv[1:]
    if _is_public_cli_invocation(user_cli_args):
        from app.cli import run_cli

        raise SystemExit(run_cli(user_cli_args))

    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="request")
    parser.add_argument("--request-json", dest="request_json")
    parser.add_argument("--db", dest="db_path")
    parser.add_argument("--smoke-id", dest="smoke_id")
    args = parser.parse_args()

    if args.smoke_id is not None and args.mode != SENTRY_SMOKE_MODE:
        parser.error("--smoke-id is only valid with sentry-smoke-test mode")

    global DB_PATH
    if args.db_path:
        DB_PATH = Path(args.db_path)

    if args.mode == SENTRY_SDK_CHECK_MODE:
        result = sentry_sdk_check()
        print(json.dumps(result))
        if not result["ok"]:
            raise SystemExit(1)
        return

    sentry_initialized = init_tracker_sentry(args.mode, defer_sdk_import=args.mode == "request")

    if args.mode == SENTRY_SMOKE_MODE:
        result = sentry_smoke_test(args.smoke_id, sentry_initialized)
        print(json.dumps(result))
        if not result["ok"]:
            raise SystemExit(1)
        return

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
