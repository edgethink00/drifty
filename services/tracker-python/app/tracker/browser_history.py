from __future__ import annotations

import re
import shutil
import sqlite3
from collections.abc import Callable, Iterable, Mapping
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Final
from urllib.parse import urlparse

from app.tracker.browser_automation import BrowserMetadata, normalize_domain, youtube_ids

_CHROMIUM_HISTORY_LIMIT: Final = 200
_FIREFOX_HISTORY_LIMIT: Final = 200
_CHROMIUM_EPOCH_OFFSET_SECONDS: Final = 11_644_473_600
_HISTORY_TIMESTAMP_MICROSECONDS: Final = 1_000_000
BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS: Final = 3 * 60
_VALID_URL_SCHEMES: Final = frozenset({"http", "https"})
_GENERIC_TITLES: Final = frozenset({"", "new tab", "새 탭", "dashboard", "inbox", "home", "untitled"})
_BROWSER_ROOTS: Final[dict[str, Path]] = {
    "Google Chrome": Path.home() / "Library/Application Support/Google/Chrome",
    "Google Chrome Canary": Path.home() / "Library/Application Support/Google/Chrome Canary",
    "Microsoft Edge": Path.home() / "Library/Application Support/Microsoft Edge",
    "Brave Browser": Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser",
    "Chromium": Path.home() / "Library/Application Support/Chromium",
    "Arc": Path.home() / "Library/Application Support/Arc/User Data",
    "Firefox": Path.home() / "Library/Application Support/Firefox/Profiles",
}


@dataclass(frozen=True)
class BrowserHistoryCandidate:
    url: str
    title: str
    visited_at: int
    browser_name: str
    profile_name: str


@dataclass(frozen=True)
class BrowserHistoryMatchResult:
    candidate: BrowserHistoryCandidate | None
    reason: str


@dataclass(frozen=True)
class _HistoryReadOutcome:
    candidates: tuple[BrowserHistoryCandidate, ...]
    errors: tuple[str, ...]
    database_count: int


def is_browser_history_supported_app(app_name: str | None) -> bool:
    return app_name in _BROWSER_ROOTS and app_name != "Safari"


def chromium_history_paths_for_root(root: Path) -> list[Path]:
    if not root.exists():
        return []
    paths: list[Path] = []
    default_path = root / "Default" / "History"
    if default_path.exists():
        paths.append(default_path)
    for profile_dir in sorted(root.iterdir(), key=lambda path: path.name):
        history_path = profile_dir / "History"
        if profile_dir.name != "Default" and profile_dir.is_dir() and history_path.exists():
            paths.append(history_path)
    return paths


def firefox_history_paths_for_root(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return [
        profile_dir / "places.sqlite"
        for profile_dir in sorted(root.iterdir(), key=lambda path: path.name)
        if profile_dir.is_dir() and (profile_dir / "places.sqlite").exists()
    ]


def match_browser_history_title(
    window_title: str | None,
    candidates: Iterable[BrowserHistoryCandidate],
    observed_at: str | None = None,
) -> BrowserHistoryMatchResult:
    if not _normalize_title(window_title or ""):
        return BrowserHistoryMatchResult(candidate=None, reason="missing_window_title")

    matches: list[BrowserHistoryCandidate] = []
    saw_generic = False
    for candidate in candidates:
        normalized_title = _normalize_title(candidate.title)
        if _title_matches_window_title(window_title, candidate.title):
            if _is_generic_title(normalized_title):
                saw_generic = True
                continue
            if _is_viable_url(candidate.url):
                matches.append(candidate)

    if not matches:
        return BrowserHistoryMatchResult(candidate=None, reason="generic_title" if saw_generic else "no_match")
    nearest_candidate = _nearest_history_candidate(matches, observed_at)
    if nearest_candidate is None:
        return BrowserHistoryMatchResult(candidate=None, reason="outside_time_window")
    return BrowserHistoryMatchResult(candidate=nearest_candidate, reason="matched")


def browser_history_metadata(
    app_name: str | None,
    window_title: str | None,
    observed_at: str | None = None,
    *,
    profile_roots: Mapping[str, Path] | None = None,
) -> BrowserMetadata:
    if not is_browser_history_supported_app(app_name):
        return BrowserMetadata()
    if app_name is None:
        return BrowserMetadata()

    roots = _BROWSER_ROOTS if profile_roots is None else profile_roots
    root = roots.get(app_name)
    if root is None:
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=f"Browser history URL fallback has no profile root for {app_name}.",
            browser_history_status="no_profile_root",
            browser_history_reason="missing_profile_root",
            browser_history_database_found=False,
            browser_history_profile_count=0,
            browser_history_candidate_count=0,
            browser_history_error_count=0,
        )

    outcome = _read_history_candidates(app_name, root)
    if not outcome.candidates:
        detail = "; ".join(outcome.errors[:2])
        suffix = f" {detail}" if detail else ""
        reason = "missing_database" if outcome.database_count == 0 else "read_error"
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=f"{app_name} browser history fallback found no readable browser history database.{suffix}",
            browser_history_status="no_readable_database",
            browser_history_reason=reason,
            browser_history_database_found=outcome.database_count > 0,
            browser_history_profile_count=outcome.database_count,
            browser_history_candidate_count=0,
            browser_history_error_count=len(outcome.errors),
        )

    match = match_browser_history_title(window_title, outcome.candidates, observed_at)
    if match.candidate is None:
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=f"{app_name} browser history fallback found no unique browser history title match: {match.reason}.",
            browser_history_status="no_match",
            browser_history_reason=match.reason,
            browser_history_database_found=outcome.database_count > 0,
            browser_history_profile_count=outcome.database_count,
            browser_history_candidate_count=len(outcome.candidates),
            browser_history_error_count=len(outcome.errors),
        )

    video_id, playlist_id, is_shorts = youtube_ids(match.candidate.url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=normalize_domain(match.candidate.url),
        site_title=match.candidate.title,
        site_url=match.candidate.url,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        match_state="browser-history-title",
        browser_automation_status="granted",
        browser_history_status="matched",
        browser_history_reason="matched",
        browser_history_database_found=outcome.database_count > 0,
        browser_history_profile_count=outcome.database_count,
        browser_history_candidate_count=len(outcome.candidates),
        browser_history_error_count=len(outcome.errors),
    )


def _read_history_candidates(app_name: str, root: Path) -> _HistoryReadOutcome:
    if app_name == "Firefox":
        return _read_history_files(app_name, firefox_history_paths_for_root(root), _read_firefox_candidates)
    return _read_history_files(app_name, chromium_history_paths_for_root(root), _read_chromium_candidates)


def _read_history_files(
    app_name: str,
    history_paths: Iterable[Path],
    read_candidates: Callable[[Path, str, str], list[BrowserHistoryCandidate]],
) -> _HistoryReadOutcome:
    candidates: list[BrowserHistoryCandidate] = []
    errors: list[str] = []
    history_path_list = tuple(history_paths)
    for history_path in history_path_list:
        with TemporaryDirectory() as tempdir:
            try:
                copied_path = _copy_history_database(history_path, Path(tempdir))
            except OSError as error:
                errors.append(f"{history_path.name} copy failed: {error}")
                continue
            try:
                candidates.extend(read_candidates(copied_path, app_name, history_path.parent.name))
            except sqlite3.DatabaseError as error:
                errors.append(f"{history_path.name} read failed: {error}")
    return _HistoryReadOutcome(candidates=tuple(candidates), errors=tuple(errors), database_count=len(history_path_list))


def _copy_history_database(source: Path, temp_path: Path) -> Path:
    target = temp_path / source.name
    shutil.copy2(source, target)
    for sidecar in (source.with_name(f"{source.name}-wal"), source.with_name(f"{source.name}-shm")):
        if sidecar.exists():
            shutil.copy2(sidecar, temp_path / sidecar.name)
    return target


def _read_chromium_candidates(history_path: Path, app_name: str, profile_name: str) -> list[BrowserHistoryCandidate]:
    query = (
        "SELECT urls.url, urls.title, max(coalesce(visits.visit_time, urls.last_visit_time, 0)) AS visited_at "
        "FROM urls "
        "LEFT JOIN visits ON visits.url = urls.id "
        "WHERE urls.url IS NOT NULL AND urls.title IS NOT NULL "
        "GROUP BY urls.id "
        "ORDER BY visited_at DESC "
        "LIMIT ?"
    )
    return _query_candidates(history_path, query, _CHROMIUM_HISTORY_LIMIT, app_name, profile_name)


def _read_firefox_candidates(history_path: Path, app_name: str, profile_name: str) -> list[BrowserHistoryCandidate]:
    query = (
        "SELECT moz_places.url, moz_places.title, "
        "max(coalesce(moz_historyvisits.visit_date, moz_places.last_visit_date, 0)) AS visited_at "
        "FROM moz_places "
        "LEFT JOIN moz_historyvisits ON moz_historyvisits.place_id = moz_places.id "
        "WHERE moz_places.url IS NOT NULL AND moz_places.title IS NOT NULL "
        "GROUP BY moz_places.id "
        "ORDER BY visited_at DESC "
        "LIMIT ?"
    )
    return _query_candidates(history_path, query, _FIREFOX_HISTORY_LIMIT, app_name, profile_name)


def _query_candidates(
    history_path: Path,
    query: str,
    limit: int,
    app_name: str,
    profile_name: str,
) -> list[BrowserHistoryCandidate]:
    candidates: list[BrowserHistoryCandidate] = []
    with closing(sqlite3.connect(history_path)) as conn:
        for url, title, visited_at in conn.execute(query, (limit,)).fetchall():
            if isinstance(url, str) and isinstance(title, str) and isinstance(visited_at, int):
                candidates.append(
                    BrowserHistoryCandidate(
                        url=url,
                        title=title,
                        visited_at=visited_at,
                        browser_name=app_name,
                        profile_name=profile_name,
                    )
                )
    return candidates


def _nearest_history_candidate(candidates: list[BrowserHistoryCandidate], observed_at: str | None) -> BrowserHistoryCandidate | None:
    observed_at_seconds = _observed_at_unix_seconds(observed_at)
    if observed_at_seconds is None:
        return max(candidates, key=lambda candidate: candidate.visited_at)

    nearest_candidate = min(
        candidates,
        key=lambda candidate: abs(_candidate_visited_at_unix_seconds(candidate) - observed_at_seconds),
    )
    nearest_delta_seconds = abs(_candidate_visited_at_unix_seconds(nearest_candidate) - observed_at_seconds)
    if nearest_delta_seconds > BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS:
        return None
    return nearest_candidate


def _observed_at_unix_seconds(observed_at: str | None) -> float | None:
    if observed_at is None:
        return None
    try:
        parsed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.timestamp()


def _candidate_visited_at_unix_seconds(candidate: BrowserHistoryCandidate) -> float:
    visited_at_seconds = candidate.visited_at / _HISTORY_TIMESTAMP_MICROSECONDS
    if candidate.browser_name == "Firefox":
        return visited_at_seconds
    return visited_at_seconds - _CHROMIUM_EPOCH_OFFSET_SECONDS


def _normalize_title(value: str) -> str:
    collapsed = re.sub(r"\s+", " ", value.strip().lower())
    return collapsed.strip(" -")


def is_retryable_browser_history_window_title(window_title: str | None) -> bool:
    normalized_window = _normalize_title(window_title or "")
    if not normalized_window:
        return False

    first_part = _normalize_title(normalized_window.split(" - ", maxsplit=1)[0])
    return not _is_generic_title(first_part)


def _title_matches_window_title(window_title: str | None, title: str) -> bool:
    normalized_window = _normalize_title(window_title or "")
    normalized_title = _normalize_title(title)
    if not normalized_window:
        return False
    return normalized_window == normalized_title or normalized_window.startswith(f"{normalized_title} - ")


def _is_generic_title(normalized_title: str) -> bool:
    return normalized_title in _GENERIC_TITLES


def _is_viable_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in _VALID_URL_SCHEMES:
        return False
    return bool(parsed.netloc)
