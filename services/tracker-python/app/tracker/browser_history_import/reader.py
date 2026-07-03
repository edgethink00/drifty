from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse, urlunparse

from app.tracker.browser_automation import normalize_domain
from app.tracker.browser_history import (
    _BROWSER_ROOTS,
    _CHROMIUM_EPOCH_OFFSET_SECONDS,
    _HISTORY_TIMESTAMP_MICROSECONDS,
    _copy_history_database,
    chromium_history_paths_for_root,
    firefox_history_paths_for_root,
)

from .models import (
    MAX_IMPORT_VISITS_PER_PROFILE,
    VALID_URL_SCHEMES,
    BrowserHistoryImportRequest,
    BrowserHistoryImportVisit,
    HistoryVisitReadOutcome,
)
from .segments import window_start


def read_import_visits(request: BrowserHistoryImportRequest) -> HistoryVisitReadOutcome:
    roots = _BROWSER_ROOTS if request.profile_roots is None else request.profile_roots
    start = window_start(request)
    visits: list[BrowserHistoryImportVisit] = []
    errors: list[str] = []
    database_count = 0
    for browser_name, root in roots.items():
        history_paths = _history_paths(browser_name, root)
        database_count += len(history_paths)
        for history_path in history_paths:
            with TemporaryDirectory() as tempdir:
                try:
                    copied_path = _copy_history_database(history_path, Path(tempdir))
                    visits.extend(_read_profile_visits(browser_name, history_path.parent.name, copied_path, start, request.observed_at))
                except (OSError, sqlite3.DatabaseError) as error:
                    errors.append(f"{history_path.name} import read failed: {error}")
    return HistoryVisitReadOutcome(
        visits=tuple(sorted(visits, key=lambda visit: visit.visited_at)),
        errors=tuple(errors),
        database_count=database_count,
    )


def _history_paths(browser_name: str, root: Path) -> list[Path]:
    if browser_name == "Firefox":
        return firefox_history_paths_for_root(root)
    return chromium_history_paths_for_root(root)


def _read_profile_visits(
    browser_name: str,
    profile_name: str,
    history_path: Path,
    start: datetime,
    end: datetime,
) -> list[BrowserHistoryImportVisit]:
    if browser_name == "Firefox":
        return _read_firefox_visits(browser_name, profile_name, history_path, start, end)
    return _read_chromium_visits(browser_name, profile_name, history_path, start, end)


def _read_chromium_visits(
    browser_name: str,
    profile_name: str,
    history_path: Path,
    start: datetime,
    end: datetime,
) -> list[BrowserHistoryImportVisit]:
    query = (
        "SELECT urls.url, urls.title, visits.visit_time "
        "FROM visits "
        "JOIN urls ON urls.id = visits.url "
        "WHERE urls.url IS NOT NULL AND urls.title IS NOT NULL "
        "AND visits.visit_time >= ? AND visits.visit_time <= ? "
        "ORDER BY visits.visit_time ASC "
        "LIMIT ?"
    )
    return _query_visits(
        history_path,
        query,
        (_chromium_timestamp(start), _chromium_timestamp(end), MAX_IMPORT_VISITS_PER_PROFILE),
        browser_name,
        profile_name,
        _chromium_datetime,
    )


def _read_firefox_visits(
    browser_name: str,
    profile_name: str,
    history_path: Path,
    start: datetime,
    end: datetime,
) -> list[BrowserHistoryImportVisit]:
    query = (
        "SELECT moz_places.url, moz_places.title, moz_historyvisits.visit_date "
        "FROM moz_historyvisits "
        "JOIN moz_places ON moz_places.id = moz_historyvisits.place_id "
        "WHERE moz_places.url IS NOT NULL AND moz_places.title IS NOT NULL "
        "AND moz_historyvisits.visit_date >= ? AND moz_historyvisits.visit_date <= ? "
        "ORDER BY moz_historyvisits.visit_date ASC "
        "LIMIT ?"
    )
    return _query_visits(
        history_path,
        query,
        (_unix_microseconds(start), _unix_microseconds(end), MAX_IMPORT_VISITS_PER_PROFILE),
        browser_name,
        profile_name,
        _firefox_datetime,
    )


def _query_visits(
    history_path: Path,
    query: str,
    params: tuple[int, int, int],
    browser_name: str,
    profile_name: str,
    to_datetime: Callable[[int], datetime],
) -> list[BrowserHistoryImportVisit]:
    visits: list[BrowserHistoryImportVisit] = []
    with closing(sqlite3.connect(history_path)) as conn:
        for url, title, raw_visited_at in conn.execute(query, params).fetchall():
            if not isinstance(url, str) or not isinstance(title, str) or not isinstance(raw_visited_at, int):
                continue
            sanitized_url = _sanitize_url(url)
            if sanitized_url is None:
                continue
            domain = normalize_domain(sanitized_url)
            if domain is None:
                continue
            visits.append(
                BrowserHistoryImportVisit(
                    import_key=_import_key(browser_name, profile_name, raw_visited_at, sanitized_url),
                    url=sanitized_url,
                    title=title[:300],
                    visited_at=to_datetime(raw_visited_at),
                    browser_name=browser_name,
                    profile_name=profile_name,
                    site_domain=domain,
                )
            )
    return visits


def _sanitize_url(raw_url: str) -> str | None:
    parsed = urlparse(raw_url)
    if parsed.scheme not in VALID_URL_SCHEMES or parsed.hostname is None:
        return None
    host = parsed.hostname.lower()
    if parsed.port is not None:
        host = f"{host}:{parsed.port}"
    path = parsed.path or "/"
    return urlunparse((parsed.scheme, host, path, "", "", ""))


def _import_key(browser_name: str, profile_name: str, visited_at: int, sanitized_url: str) -> str:
    value = "\0".join((browser_name, profile_name, str(visited_at), sanitized_url))
    return hashlib.sha256(value.encode()).hexdigest()


def _chromium_timestamp(value: datetime) -> int:
    return int((value.timestamp() + _CHROMIUM_EPOCH_OFFSET_SECONDS) * _HISTORY_TIMESTAMP_MICROSECONDS)


def _unix_microseconds(value: datetime) -> int:
    return int(value.timestamp() * _HISTORY_TIMESTAMP_MICROSECONDS)


def _chromium_datetime(value: int) -> datetime:
    seconds = value / _HISTORY_TIMESTAMP_MICROSECONDS - _CHROMIUM_EPOCH_OFFSET_SECONDS
    return datetime.fromtimestamp(seconds, timezone.utc)


def _firefox_datetime(value: int) -> datetime:
    return datetime.fromtimestamp(value / _HISTORY_TIMESTAMP_MICROSECONDS, timezone.utc)
