from __future__ import annotations

import os
import platform
import re
import shutil
import sqlite3
import stat
import threading
import time
import warnings
from collections import deque
from collections.abc import Mapping
from functools import partial
from pathlib import Path
from types import CodeType
from typing import Callable, NamedTuple, Optional

JsonValue = object
CaptureException = Callable[..., object]
Flush = Callable[[float], object]

FILTERED_VALUE = "[Filtered]"
REDACTED_EMAIL = "[Email]"
REDACTED_ID = "[Id]"
REDACTED_SECRET = "[Secret]"
DEFAULT_ENVIRONMENT = "development"
MAX_RECURSION_DEPTH = 6
# The generic depth bound above also hides SDK payloads such as breadcrumb
# `data` (HTTP breadcrumbs carry request URLs), so it stays as is. Exception
# frames sit below that bound as well; they describe code locations, not
# activity, and pass through this explicit allowlist instead. Frame `vars`
# stays out even if local-variable capture is ever enabled.
STACK_FRAME_FIELDS = (
    "filename",
    "abs_path",
    "module",
    "function",
    "lineno",
    "colno",
    "in_app",
    "context_line",
    "pre_context",
    "post_context",
)
EXCEPTION_FIELDS = ("type", "value", "module")
MECHANISM_FIELDS = ("type", "handled")

EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
UUID_PATTERN = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.IGNORECASE)
USER_PATH_PATTERN = re.compile(r"/Users/[^/\s)]+")
# Windows profile paths name the account: C:\Users\<name>\..., including the
# \\?\ long-path prefix and forward-slash spellings.
WINDOWS_USER_PATH_PATTERN = re.compile(r"\b([A-Z]:[\\/]+Users[\\/]+)[^\\/\s\"'<>|:*?)]+", re.IGNORECASE)
# tempfile names (tmpab12_cd3) differ on every run; left in an error message they
# split one failure into a new Sentry issue per occurrence (DRIFTY-MAC-NATIVE-A..Z).
TEMP_NAME_PATTERN = re.compile(r"(?<=[\\/])tmp[a-z0-9_]{8}(?![a-z0-9_])", re.IGNORECASE)
URL_PATTERN = re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s\"'<>]+", re.IGNORECASE)
SENSITIVE_QUERY_KEY_PATTERN = re.compile(r"(access_token|refresh_token|token|apikey|api_key|key|secret|code|state|session|password)", re.IGNORECASE)
SENSITIVE_FIELD_PATTERN = re.compile(
    r"(authorization|cookie|password|secret|token|api[_-]?key|apikey|email|user[_-]?id|"
    r"window[_-]?title|title|site[_-]?url|url[_-]?host|domain|app[_-]?name|bundle[_-]?id|"
    r"timeline|segment|segments|activity|activities|payload|prompt|provider[_-]?response|"
    r"request[_-]?body|response[_-]?body)",
    re.IGNORECASE,
)

_capture_exception: CaptureException | None = None
_flush: Flush | None = None
_initialized = False
# Set when a one-shot request process defers importing the SDK until it has an
# error to report; see init_tracker_sentry(defer_sdk_import=True).
_deferred_mode: str | None = None
_deferred_database_path: Path | None = None

# The daemon samples every few seconds and the serve process answers the same
# command repeatedly, so a lasting condition such as a full disk raised the same
# error on every tick: one device sent 49 identical events in an hour and the
# shared error quota went with it. Report the first occurrence at once, then at
# most one per window for the same failure, carrying how many were held back.
#
# A fixed hourly window still let one broken install send 24 events a day per
# failing place, about 720 a month each, against a 5,000-event monthly plan.
# While the same failure keeps recurring the window doubles up to a day, and a
# rolling daily budget bounds a process that fails in many places at once.
REPEAT_REPORT_WINDOW_SECONDS = 60.0 * 60.0
REPEAT_REPORT_MAX_WINDOW_SECONDS = 24.0 * 60.0 * 60.0
REPORT_BUDGET_PERIOD_SECONDS = 24.0 * 60.0 * 60.0
REPORT_BUDGET_PER_PERIOD = 10
REPEAT_REPORT_MAX_KEYS = 64
REPEAT_KEY_MESSAGE_CHARS = 300


class ReportDecision(NamedTuple):
    report: bool
    # Occurrences held back since this failure was last reported.
    held_back: int
    # The window those occurrences were held back over.
    window_seconds: float


class _RepeatEntry:
    __slots__ = ("last_report", "held_back", "window")

    def __init__(self, last_report: Optional[float], window: float) -> None:
        # None: seen while the daily budget was spent, not reported yet.
        self.last_report = last_report
        self.held_back = 0
        self.window = window


class RepeatedReportLimiter:
    """Admits one report per failure key per window and counts the rest.

    The window starts at window_seconds and doubles, up to max_window_seconds,
    each time it ends with the failure still recurring. A failure that stays
    quiet for a whole window starts over at window_seconds. At most
    budget_per_period reports are admitted per budget_period_seconds across all
    keys; failures seen while the budget is spent are counted and reported
    first when it frees.
    """

    def __init__(
        self,
        window_seconds: float = REPEAT_REPORT_WINDOW_SECONDS,
        max_keys: int = REPEAT_REPORT_MAX_KEYS,
        clock: Callable[[], float] = time.monotonic,
        *,
        max_window_seconds: float = REPEAT_REPORT_MAX_WINDOW_SECONDS,
        budget_per_period: int = REPORT_BUDGET_PER_PERIOD,
        budget_period_seconds: float = REPORT_BUDGET_PERIOD_SECONDS,
    ) -> None:
        self._window_seconds = window_seconds
        self._max_window_seconds = max(window_seconds, max_window_seconds)
        self._budget_per_period = budget_per_period
        self._budget_period_seconds = budget_period_seconds
        self._max_keys = max_keys
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, ...], _RepeatEntry] = {}
        # Times of the reports admitted inside the current budget period.
        self._admitted: deque[float] = deque()

    def admit(self, key: tuple[str, ...]) -> ReportDecision:
        with self._lock:
            now = self._clock()
            while self._admitted and now - self._admitted[0] >= self._budget_period_seconds:
                self._admitted.popleft()
            entry = self._entries.get(key)
            if (entry is not None and entry.last_report is not None
                    and now - entry.last_report < entry.window):
                entry.held_back += 1
                return ReportDecision(False, entry.held_back, entry.window)
            if len(self._admitted) >= self._budget_per_period:
                if entry is None:
                    entry = _RepeatEntry(None, self._window_seconds)
                    self._remember(key, entry)
                entry.held_back += 1
                return ReportDecision(False, entry.held_back, entry.window)

            if entry is None or entry.last_report is None:
                next_window = self._window_seconds
            elif entry.held_back:
                next_window = min(entry.window * 2.0, self._max_window_seconds)
            else:
                next_window = self._window_seconds
            held_back = entry.held_back if entry is not None else 0
            held_window = entry.window if entry is not None else self._window_seconds
            self._entries.pop(key, None)
            self._remember(key, _RepeatEntry(now, next_window))
            self._admitted.append(now)
            return ReportDecision(True, held_back, held_window)

    def _remember(self, key: tuple[str, ...], entry: _RepeatEntry) -> None:
        if len(self._entries) >= self._max_keys:
            # Dict order is insertion order and every report re-inserts its
            # key, so the first entry is the one reported longest ago.
            self._entries.pop(next(iter(self._entries)))
        self._entries[key] = entry

    def reset(self) -> None:
        with self._lock:
            self._entries.clear()
            self._admitted.clear()


_repeat_limiter = RepeatedReportLimiter()


def silence_urllib3_libressl_warning() -> None:
    # The macOS release sidecar is built on the system Python, whose ssl module
    # is LibreSSL. urllib3 2.x warns about that on import, and the app reads a
    # failed tracker command's stderr as its error message, so the warning would
    # be prefixed to every tracker error. TLS to Sentry still works.
    warnings.filterwarnings("ignore", message=r"urllib3 v2 only supports OpenSSL 1\.1\.1\+")


def init_tracker_sentry(
    mode: str, *, defer_sdk_import: bool = False, database_path: Path | None = None,
) -> bool:
    global _capture_exception, _flush, _initialized, _deferred_mode, _deferred_database_path

    if _initialized:
        return True

    dsn = _first_non_empty(
        os.environ.get("DRIFTY_TRACKER_SENTRY_DSN"),
        os.environ.get("SENTRY_DSN"),
    )
    if not dsn:
        return False

    if defer_sdk_import:
        # One-shot request processes report errors only through
        # capture_tracker_exception, so the SDK import can wait until there is
        # something to send. In the frozen macOS sidecar that import adds about a
        # second to every launch, which one-shot callers with short timeouts feel.
        _deferred_mode = mode
        _deferred_database_path = database_path
        return True

    _deferred_mode = None
    _deferred_database_path = None
    try:
        silence_urllib3_libressl_warning()
        from sentry_sdk import capture_exception, flush, init, set_tag
    except ImportError:
        return False

    try:
        init(
            dsn=dsn,
            environment=_first_non_empty(os.environ.get("SENTRY_ENVIRONMENT"), os.environ.get("DRIFTY_SENTRY_ENVIRONMENT"))
            or DEFAULT_ENVIRONMENT,
            release=_first_non_empty(os.environ.get("SENTRY_RELEASE"), os.environ.get("DRIFTY_TRACKER_SENTRY_RELEASE")),
            send_default_pii=False,
            include_local_variables=False,
            max_request_body_size="never",
            before_send=(partial(scrub_sentry_event, database_path=database_path)
                         if database_path is not None else scrub_sentry_event),
            traces_sample_rate=0.0,
        )
        set_tag("component", "tracker-python")
        set_tag("tracker_mode", mode)
        # contexts are dropped by the scrubber, so name the platform explicitly;
        # Mac and Windows builds share one release name and Sentry project.
        set_tag("os.name", _platform_name())
    except Exception:  # noqa: BROAD_EXCEPT_OK - observability setup must never stop local tracking.
        return False

    _capture_exception = capture_exception
    _flush = flush
    _initialized = True
    return True


def _repeat_key(
    error: BaseException, context: Mapping[str, JsonValue], sqlite_repeat_frame: CodeType | None,
) -> tuple[str, ...]:
    # The same place failing the same way: phase/command from the caller, the
    # exception type, SQLite's numeric result and the redacted message. Random
    # temp names are already normalized by redact_text, so they do not split keys.
    code = getattr(error, "sqlite_errorcode", None) if isinstance(error, sqlite3.Error) else None
    site = ""
    if sqlite_repeat_frame is not None and isinstance(error, sqlite3.Error):
        # A tick can fail in different operations with the same SQLite error,
        # even after an activity write committed. Use the caller's fixed code
        # location only for this process's repeat limit, never in event extras.
        trace = error.__traceback__
        while trace is not None:
            if trace.tb_frame.f_code is sqlite_repeat_frame:
                site = str(trace.tb_lineno)
                break
            trace = trace.tb_next
    try:
        message = redact_text(str(error))[:REPEAT_KEY_MESSAGE_CHARS]
    except Exception:  # noqa: BROAD_EXCEPT_OK - an unprintable error still gets reported.
        message = ""
    return (
        str(context.get("phase", "")),
        str(context.get("command", "")),
        f"{type(error).__module__}.{type(error).__qualname__}",
        str(code) if type(code) is int else "",
        message,
        site,
    )


def capture_tracker_exception(
    error: BaseException,
    context: Mapping[str, JsonValue] | None = None,
    *,
    limit_repeats: bool = True,
    sqlite_repeat_frame: CodeType | None = None,
) -> bool:
    """Report one tracker error; return True only when capture and flush ran.

    Repeats of the same failure inside its current window, and failures past
    the process's daily report budget, are counted instead of sent (returning
    False); the next report of that failure carries the count.
    Explicit diagnostics such as the smoke test pass limit_repeats=False.
    """
    global _deferred_mode, _deferred_database_path
    if _capture_exception is None and _deferred_mode is not None:
        deferred_mode, _deferred_mode = _deferred_mode, None
        database_path, _deferred_database_path = _deferred_database_path, None
        init_tracker_sentry(deferred_mode, database_path=database_path)

    capture_exception = _capture_exception
    if capture_exception is None:
        return False

    try:
        extras = dict(context or {})
        if limit_repeats:
            decision = _repeat_limiter.admit(_repeat_key(error, extras, sqlite_repeat_frame))
            if not decision.report:
                return False
            if decision.held_back:
                extras.update(
                    suppressed_repeats=decision.held_back,
                    repeat_window_seconds=int(decision.window_seconds),
                )
        if isinstance(error, sqlite3.Error):
            # BUSY and BUSY_SNAPSHOT share a message but need different recovery.
            # Python 3.9 has no result attribute: keep its original report without
            # guessing from text. Copy only numbers, never SQL or arbitrary attrs.
            code = getattr(error, "sqlite_errorcode", None)
            if type(code) is int and 0 < code <= 0x7FFFFFFF:
                extras.update(sqlite_extended_result=code, sqlite_primary_result=code & 0xFF)
        capture_exception(error, extras=sanitize_mapping(extras))
        flush = _flush
        if flush is None:
            return False
        flush(2.0)
        return True
    except Exception:  # noqa: BROAD_EXCEPT_OK - capture failures must not affect the tracker.
        return False


def _tracker_storage_context(database_path: Path) -> dict[str, JsonValue]:
    """Read filesystem metadata only; never open SQLite or read file contents.

    These describe the configured tracker DB, not necessarily the database
    that raised (e.g. a browser-history read), nor SQLite's temp directory.
    Free MiB round down and file MiB round up; zero free MiB means <1 MiB.
    """
    try:
        # SQLite follows DB symlinks. Measure the target volume and sidecars,
        # not a link's parent (which can be on a different filesystem).
        database_path = database_path.resolve()
    except (OSError, RuntimeError):
        return {"tracker_storage_probe_failed": True}
    mib = 1024 * 1024
    context: dict[str, JsonValue] = {}
    try:
        context["tracker_storage_free_mib"] = shutil.disk_usage(database_path.parent).free // mib
    except OSError:
        context["tracker_storage_probe_failed"] = True
    for name, suffix in (("db", ""), ("wal", "-wal"), ("journal", "-journal")):
        try:
            metadata = Path(str(database_path) + suffix).stat()
            if stat.S_ISREG(metadata.st_mode):
                context[f"tracker_{name}_present"] = True
                context[f"tracker_{name}_mib"] = (metadata.st_size + mib - 1) // mib
            else:
                context["tracker_storage_probe_failed"] = True
        except FileNotFoundError:
            context[f"tracker_{name}_present"] = False
        except OSError:
            context["tracker_storage_probe_failed"] = True
    return context


def scrub_sentry_event(
    event: dict[str, JsonValue], _hint: Mapping[str, JsonValue] | None = None,
    *, database_path: Path | None = None,
) -> dict[str, JsonValue]:
    event.pop("user", None)
    event.pop("request", None)
    event.pop("contexts", None)
    # The SDK fills server_name with the device hostname, which often carries
    # the owner's name (e.g. "Morgan2024", "Jane-MacBook-Air.local").
    event.pop("server_name", None)
    exception = event.pop("exception", None)
    scrubbed = sanitize_mapping(event)
    # SDK exception hints cover both handled request/tick errors and uncaught
    # startup failures. Never trust an event's text/type label as an exception.
    exc_info = (_hint or {}).get("exc_info")
    if database_path is not None and isinstance(exc_info, tuple) and len(exc_info) == 3 and isinstance(exc_info[1], sqlite3.Error):
        try:
            context = _tracker_storage_context(database_path)
            extras = scrubbed.get("extra")
            scrubbed["extra"] = {**(extras if isinstance(extras, dict) else {}), **context}
        except Exception:  # noqa: BROAD_EXCEPT_OK - diagnostic failure must preserve the original event.
            pass
    if isinstance(exception, Mapping):
        scrubbed["exception"] = _sanitize_exception(exception)
    return scrubbed


def _sanitize_exception(exception: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    values = exception.get("values")
    if not isinstance(values, list):
        return {"values": []}
    return {"values": [_sanitize_exception_value(value) for value in values if isinstance(value, Mapping)]}


def _sanitize_exception_value(value: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    sanitized = _allowed_scalars(value, EXCEPTION_FIELDS)
    mechanism = value.get("mechanism")
    if isinstance(mechanism, Mapping):
        sanitized["mechanism"] = _allowed_scalars(mechanism, MECHANISM_FIELDS)
    stacktrace = value.get("stacktrace")
    frames = stacktrace.get("frames") if isinstance(stacktrace, Mapping) else None
    if isinstance(frames, list):
        sanitized["stacktrace"] = {
            "frames": [_allowed_scalars(frame, STACK_FRAME_FIELDS) for frame in frames if isinstance(frame, Mapping)]
        }
    return sanitized


def _allowed_scalars(value: Mapping[str, JsonValue], fields: tuple[str, ...]) -> dict[str, JsonValue]:
    allowed: dict[str, JsonValue] = {}
    for field in fields:
        item = value.get(field)
        if isinstance(item, str):
            allowed[field] = redact_text(item)
        elif isinstance(item, (bool, int)):
            allowed[field] = item
        elif isinstance(item, list):
            allowed[field] = [redact_text(line) for line in item if isinstance(line, str)]
    return allowed


def sanitize_value(value: JsonValue, key: str = "", depth: int = 0) -> JsonValue:
    if _is_sensitive_field_name(key):
        return FILTERED_VALUE
    if depth > MAX_RECURSION_DEPTH:
        return FILTERED_VALUE
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, list):
        return [sanitize_value(item, key, depth + 1) for item in value]
    if isinstance(value, Mapping):
        return sanitize_mapping(value, depth + 1)
    return FILTERED_VALUE


def sanitize_mapping(value: Mapping[str, JsonValue], depth: int = 0) -> dict[str, JsonValue]:
    return {key: sanitize_value(item, key, depth + 1) for key, item in value.items()}


def redact_text(value: str) -> str:
    redacted = URL_PATTERN.sub(_sanitize_url, value)
    redacted = EMAIL_PATTERN.sub(REDACTED_EMAIL, redacted)
    redacted = UUID_PATTERN.sub(REDACTED_ID, redacted)
    redacted = USER_PATH_PATTERN.sub("/Users/[user]", redacted)
    redacted = WINDOWS_USER_PATH_PATTERN.sub(r"\1[user]", redacted)
    return TEMP_NAME_PATTERN.sub("tmp[random]", redacted)


def _platform_name() -> str:
    system = platform.system()
    if system == "Darwin":
        return "macOS"
    return system or "unknown"


def _sanitize_url(match: re.Match[str]) -> str:
    raw_url = match.group(0)
    split_at = len(raw_url)
    for marker in ("?", "#"):
        marker_index = raw_url.find(marker)
        if marker_index >= 0:
            split_at = min(split_at, marker_index)
    if split_at < len(raw_url):
        return raw_url[:split_at]
    if SENSITIVE_QUERY_KEY_PATTERN.search(raw_url):
        return REDACTED_SECRET
    return raw_url


def _is_sensitive_field_name(key: str) -> bool:
    return bool(SENSITIVE_FIELD_PATTERN.search(key) or SENSITIVE_QUERY_KEY_PATTERN.search(key))


def _first_non_empty(*values: str | None) -> str | None:
    for value in values:
        if value and value.strip():
            return value.strip()
    return None
