from __future__ import annotations

import os
import re
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

EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
UUID_PATTERN = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.IGNORECASE)
USER_PATH_PATTERN = re.compile(r"/Users/[^/\s)]+")
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


def init_tracker_sentry(mode: str) -> bool:
    global _capture_exception, _flush, _initialized

    if _initialized:
        return True

    dsn = _first_non_empty(
        os.environ.get("DRIFTY_TRACKER_SENTRY_DSN"),
        os.environ.get("SENTRY_DSN"),
    )
    if not dsn:
        return False

    try:
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
    except Exception:  # noqa: BROAD_EXCEPT_OK - observability setup must never stop local tracking.
        return False

    _capture_exception = capture_exception
    _flush = flush
    _initialized = True
    return True


def capture_tracker_exception(error: BaseException, context: Mapping[str, JsonValue] | None = None) -> bool:
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
    return sanitize_mapping(event)


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
    return USER_PATH_PATTERN.sub("/Users/[user]", UUID_PATTERN.sub(REDACTED_ID, EMAIL_PATTERN.sub(REDACTED_EMAIL, URL_PATTERN.sub(_sanitize_url, value))))


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
