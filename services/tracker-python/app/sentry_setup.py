from __future__ import annotations

import os
import platform
import re
import warnings
from collections.abc import Mapping
from typing import Callable

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


def silence_urllib3_libressl_warning() -> None:
    # The macOS release sidecar is built on the system Python, whose ssl module
    # is LibreSSL. urllib3 2.x warns about that on import, and the app reads a
    # failed tracker command's stderr as its error message, so the warning would
    # be prefixed to every tracker error. TLS to Sentry still works.
    warnings.filterwarnings("ignore", message=r"urllib3 v2 only supports OpenSSL 1\.1\.1\+")


def init_tracker_sentry(mode: str, *, defer_sdk_import: bool = False) -> bool:
    global _capture_exception, _flush, _initialized, _deferred_mode

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
        return True

    _deferred_mode = None
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
            before_send=scrub_sentry_event,
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


def capture_tracker_exception(error: BaseException, context: Mapping[str, JsonValue] | None = None) -> bool:
    global _deferred_mode
    if _capture_exception is None and _deferred_mode is not None:
        deferred_mode, _deferred_mode = _deferred_mode, None
        init_tracker_sentry(deferred_mode)

    capture_exception = _capture_exception
    if capture_exception is None:
        return False

    try:
        capture_exception(error, extras=sanitize_mapping(dict(context or {})))
        flush = _flush
        if flush is None:
            return False
        flush(2.0)
        return True
    except Exception:  # noqa: BROAD_EXCEPT_OK - capture failures must not affect the tracker.
        return False


def scrub_sentry_event(event: dict[str, JsonValue], _hint: Mapping[str, JsonValue] | None = None) -> dict[str, JsonValue]:
    event.pop("user", None)
    event.pop("request", None)
    event.pop("contexts", None)
    # The SDK fills server_name with the device hostname, which often carries
    # the owner's name (e.g. "Morgan2024", "Jane-MacBook-Air.local").
    event.pop("server_name", None)
    exception = event.pop("exception", None)
    scrubbed = sanitize_mapping(event)
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
