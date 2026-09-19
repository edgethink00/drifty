from __future__ import annotations

import re
import shutil
import sqlite3
import sys
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
# Safari's History.db stores visit_time as seconds since the Cocoa reference date
# (2001-01-01 UTC). Seconds between the Unix epoch (1970) and the Cocoa epoch.
_COCOA_EPOCH_OFFSET_SECONDS: Final = 978_307_200
_HISTORY_TIMESTAMP_MICROSECONDS: Final = 1_000_000
# Visit timestamps record last navigation, not last focus. Titles that map to
# more than one URL must still fall inside this window so an older "ChatGPT" or
# "Inbox" row cannot win. A title that maps to exactly one URL may match past
# this window: the user is still looking at that page.
BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS: Final = 3 * 60
_VALID_URL_SCHEMES: Final = frozenset({"http", "https"})
_GENERIC_TITLES: Final = frozenset({"", "new tab", "새 탭", "dashboard", "inbox", "home", "untitled"})
_MACOS_BROWSER_ROOTS: Final[dict[str, Path]] = {
    "Google Chrome": Path.home() / "Library/Application Support/Google/Chrome",
    "Google Chrome Canary": Path.home() / "Library/Application Support/Google/Chrome Canary",
    "Microsoft Edge": Path.home() / "Library/Application Support/Microsoft Edge",
    "Brave Browser": Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser",
    "Chromium": Path.home() / "Library/Application Support/Chromium",
    "Arc": Path.home() / "Library/Application Support/Arc/User Data",
    "Aside": Path.home() / "Library/Application Support/Aside",
    "Vivaldi": Path.home() / "Library/Application Support/Vivaldi",
    "Opera": Path.home() / "Library/Application Support/com.operasoftware.Opera",
    "Whale": Path.home() / "Library/Application Support/Naver/Whale",
    "Firefox": Path.home() / "Library/Application Support/Firefox/Profiles",
    # Developer Edition ships its own app bundle but keeps its profile beside
    # release Firefox, in a dev-edition-default directory under the same
    # Profiles root. The scanner already walks every profile in a root, so both
    # share one entry instead of needing a second layout.
    "Firefox Developer Edition": Path.home() / "Library/Application Support/Firefox/Profiles",
    "Zen": Path.home() / "Library/Application Support/zen/Profiles",
    "Floorp": Path.home() / "Library/Application Support/Floorp/Profiles",
    # Safari keeps a single History.db directly under ~/Library/Safari (no
    # Chromium Default/ or Firefox profile layout). The database is TCC-protected
    # and only readable with Full Disk Access.
    "Safari": Path.home() / "Library/Safari",
}


def _platform_browser_roots() -> dict[str, Path]:
    """Profile roots for the running platform.

    Only the paths differ across platforms: the schemas, the WAL-sidecar copy,
    the title match and the candidate scoring below are shared. Windows roots
    live in their own module so the macOS table stays exactly as it shipped.
    """
    if sys.platform == "win32":
        from app.tracker.windows_browser_history import windows_browser_roots

        return windows_browser_roots()
    return dict(_MACOS_BROWSER_ROOTS)


_BROWSER_ROOTS: Final[dict[str, Path]] = _platform_browser_roots()

# Firefox-family browsers use profiles.ini-style profile directories with a
# places.sqlite history database and unix-microsecond visit timestamps, unlike
# the Chromium family (Default/History with WebKit-epoch timestamps).
_FIREFOX_FAMILY_BROWSERS: Final[frozenset[str]] = frozenset(
    {"Firefox", "Firefox Developer Edition", "Zen", "Floorp"}
)

# Safari-family browsers use a single History.db (history_items join history_visits)
# with Cocoa-epoch second timestamps, gated behind Full Disk Access.
_SAFARI_FAMILY_BROWSERS: Final[frozenset[str]] = frozenset({"Safari"})

_SAFARI_HISTORY_ROOT: Final[Path] = Path.home() / "Library/Safari"
# Records the default URL scheme handler chosen in System Settings > Desktop & Dock.
# Not TCC-protected; parsed with stdlib plistlib.
_LAUNCH_SERVICES_SECURE_PLIST: Final[Path] = (
    Path.home() / "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
)


def is_firefox_family_browser(app_name: str) -> bool:
    return app_name in _FIREFOX_FAMILY_BROWSERS


def is_safari_family_browser(app_name: str) -> bool:
    return app_name in _SAFARI_FAMILY_BROWSERS


def safari_history_paths_for_root(root: Path) -> list[Path]:
    history_path = root / "History.db"
    # is_file() may itself be denied by TCC when Full Disk Access is off; treat
    # that (and a missing database) the same way — nothing readable here.
    try:
        return [history_path] if history_path.is_file() else []
    except OSError:
        return []


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
    # Opera's main profile keeps History directly in the user-data root rather
    # than a Default/ subfolder; newer builds also mirror it under Default/.
    root_history_path = root / "History"
    if root_history_path.is_file():
        paths.append(root_history_path)
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
    # Windows browsers decorate the window title with profile names and
    # localized tab-count fragments that macOS never adds, so a single exact
    # or prefix compare misses every page. Try progressively less decorated
    # forms of the same title instead of loosening the matcher, which would
    # weaken macOS matching too.
    if sys.platform == "win32":
        from app.tracker.windows_window_titles import windows_page_title_candidates

        pool = tuple(candidates)
        result = BrowserHistoryMatchResult(candidate=None, reason="missing_window_title")
        for variant in windows_page_title_candidates(window_title):
            result = _match_browser_history_title(variant, pool, observed_at)
            if result.candidate is not None or result.reason in {"ambiguous_url", "outside_time_window"}:
                return result
        return result
    return _match_browser_history_title(window_title, candidates, observed_at)


def _match_browser_history_title(
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
    # Chromium/Firefox visit times record last navigation, not last focus. A
    # unique page title still on screen after the 3-minute window is the user
    # still on that page (Meet calls, long documents). Keep the window only to
    # disambiguate titles that map to more than one URL.
    unique_urls = {candidate.url for candidate in matches}
    if len(unique_urls) == 1:
        nearest_candidate = _nearest_history_candidate(
            _most_specific_title_matches(matches),
            observed_at,
            enforce_window=False,
        )
        if nearest_candidate is None:
            return BrowserHistoryMatchResult(candidate=None, reason="outside_time_window")
        return BrowserHistoryMatchResult(candidate=nearest_candidate, reason="matched")
    timely_matches = _history_candidates_within_time_window(matches, observed_at)
    if not timely_matches:
        return BrowserHistoryMatchResult(candidate=None, reason="outside_time_window")
    if len({candidate.url for candidate in timely_matches}) != 1:
        return BrowserHistoryMatchResult(candidate=None, reason="ambiguous_url")
    nearest_candidate = _nearest_history_candidate(_most_specific_title_matches(timely_matches), observed_at)
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
    if is_firefox_family_browser(app_name):
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
    for sidecar_suffix in ("-journal", "-wal", "-shm"):
        sidecar = source.with_name(f"{source.name}{sidecar_suffix}")
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


def _most_specific_title_matches(matches: list[BrowserHistoryCandidate]) -> list[BrowserHistoryCandidate]:
    best_length = max(len(_normalize_title(candidate.title)) for candidate in matches)
    return [candidate for candidate in matches if len(_normalize_title(candidate.title)) == best_length]


def _nearest_history_candidate(
    candidates: list[BrowserHistoryCandidate],
    observed_at: str | None,
    *,
    enforce_window: bool = True,
) -> BrowserHistoryCandidate | None:
    if not candidates:
        return None
    observed_at_seconds = _observed_at_unix_seconds(observed_at)
    if observed_at_seconds is None:
        return max(candidates, key=lambda candidate: candidate.visited_at)

    nearest_candidate = min(
        candidates,
        key=lambda candidate: abs(_candidate_visited_at_unix_seconds(candidate) - observed_at_seconds),
    )
    if not enforce_window:
        return nearest_candidate
    nearest_delta_seconds = abs(_candidate_visited_at_unix_seconds(nearest_candidate) - observed_at_seconds)
    if nearest_delta_seconds > BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS:
        return None
    return nearest_candidate


def _history_candidates_within_time_window(
    candidates: list[BrowserHistoryCandidate],
    observed_at: str | None,
) -> list[BrowserHistoryCandidate]:
    observed_at_seconds = _observed_at_unix_seconds(observed_at)
    if observed_at_seconds is None:
        return candidates
    return [
        candidate
        for candidate in candidates
        if abs(_candidate_visited_at_unix_seconds(candidate) - observed_at_seconds)
        <= BROWSER_HISTORY_TITLE_MATCH_WINDOW_SECONDS
    ]


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
    if is_firefox_family_browser(candidate.browser_name):
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


def safari_history_readable(root: Path | None = None) -> bool:
    """Attempt a copy-and-open of Safari's History.db.

    This attempt is also what registers Drifty in the Full Disk Access list: even a
    denied read causes macOS to add the app to System Settings > Privacy > Full Disk
    Access, where the user can toggle it on. Returns True only when the database is
    actually readable (Full Disk Access granted and a History.db exists). Any denial,
    missing database, or corruption returns False and never raises.
    """
    history_path = (_SAFARI_HISTORY_ROOT if root is None else root) / "History.db"
    try:
        with TemporaryDirectory() as tempdir:
            copied_path = _copy_history_database(history_path, Path(tempdir))
            with closing(sqlite3.connect(copied_path)) as conn:
                conn.execute("SELECT 1 FROM history_visits LIMIT 1").fetchone()
        return True
    except (OSError, sqlite3.DatabaseError):
        return False


def default_browser_is_safari(plist_path: Path | None = None, *, platform: str | None = None) -> bool:
    """Report whether Safari is the default browser via LaunchServices.

    Rule (conservative, per the Safari-onboarding-row decision):
      - Read the LaunchServices secure plist and find the LSHandlers entry whose
        LSHandlerURLScheme is "http" (or "https"); its role bundle id names the
        default browser. Safari when the id contains "safari", otherwise False.
      - No http/https handler entry at all -> Safari is the macOS system fallback
        default -> True.
      - Absent plist (never customized) -> no handler found -> True.
      - Any parse/read error (corrupt or unreadable plist) -> False, so a broken
        read never spuriously shows the Safari row.
    """
    if (sys.platform if platform is None else platform) != "darwin":
        return False

    # Imported lazily: plistlib pulls in xml.parsers.expat at import time, and this
    # module is on a hot import path shared by live tracking that never needs it.
    # A mis-linked interpreter without expat degrades to conservative False.
    try:
        import plistlib
    except Exception:
        return False

    path = _LAUNCH_SERVICES_SECURE_PLIST if plist_path is None else plist_path
    try:
        with path.open("rb") as handle:
            data = plistlib.load(handle)
    except FileNotFoundError:
        # Never customized: Safari is the system default until a handler is set.
        return True
    except Exception:
        # Corrupt or otherwise unreadable plist: be conservative, don't show the row.
        return False

    handlers = data.get("LSHandlers") if isinstance(data, dict) else None
    if not isinstance(handlers, list):
        return True

    for handler in handlers:
        if not isinstance(handler, dict):
            continue
        if handler.get("LSHandlerURLScheme") in ("http", "https"):
            role = handler.get("LSHandlerRoleAll") or handler.get("LSHandlerRoleViewer")
            if isinstance(role, str) and role:
                return "safari" in role.lower()
            # Entry present but no bundle id -> fall through to other handlers.
    # No http/https handler entry: Safari is the system fallback default.
    return True


def browser_history_environment() -> dict[str, bool]:
    """Minimized environment info for the Safari onboarding row (booleans only).

    Never returns paths, URLs, or titles (privacy rule).
    """
    return {
        "safariHistoryReadable": safari_history_readable(),
        "defaultBrowserIsSafari": default_browser_is_safari(),
    }
