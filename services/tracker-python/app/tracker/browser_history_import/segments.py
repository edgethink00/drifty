from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from app.storage.db import ImportedActivitySegment
from app.tracker.browser_automation import youtube_ids

from .models import (
    BROWSER_HISTORY_IMPORT_SOURCE,
    DEFAULT_CONFIDENCE,
    MIN_SESSION_DURATION_SECONDS,
    SESSION_TIMEOUT_SECONDS,
    BrowserHistoryImportPreview,
    BrowserHistoryImportRequest,
    BrowserHistoryImportVisit,
    HistoryVisitReadOutcome,
)

# Transient / low-signal navigations that add noise but little meaning: search-result
# pages, sign-in / auth redirects, and blank/new-tab targets. Dropping these also lets
# a same-site session that was split by a brief detour merge back together.
_LOW_SIGNAL_PATH_MARKERS: tuple[str, ...] = ("/signin", "/login", "/logout", "/oauth", "/sso")
_LOW_SIGNAL_HOSTS: frozenset[str] = frozenset({"accounts.google.com"})


def is_low_signal_url(url: str) -> bool:
    if not url:
        return True
    lowered = url.lower()
    if lowered.startswith("about:") or lowered.startswith("chrome://") or "://newtab" in lowered:
        return True
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower().strip(".")
    while host.startswith("www."):
        host = host[4:]
    path = (parts.path or "").lower()
    if (host == "google.com" or host.endswith(".google.com")) and path.startswith("/search"):
        return True
    if host in _LOW_SIGNAL_HOSTS:
        return True
    return any(marker in path for marker in _LOW_SIGNAL_PATH_MARKERS)


def segments_from_visits(
    visits: Iterable[BrowserHistoryImportVisit],
    request: BrowserHistoryImportRequest,
) -> list[ImportedActivitySegment]:
    ordered_visits = tuple(
        sorted(
            (visit for visit in visits if not is_low_signal_url(visit.url)),
            key=lambda visit: visit.visited_at,
        )
    )
    if not ordered_visits:
        return []

    segments: list[ImportedActivitySegment] = []
    current: list[BrowserHistoryImportVisit] = []
    for visit in ordered_visits:
        if not current:
            current = [visit]
            continue
        last_visit = current[-1]
        gap_seconds = int((visit.visited_at - last_visit.visited_at).total_seconds())
        if visit.site_domain == last_visit.site_domain and gap_seconds <= SESSION_TIMEOUT_SECONDS:
            current.append(visit)
            continue
        segment = _segment_from_session(current, next_visit_at=visit.visited_at, window_end=request.observed_at)
        if segment is not None:
            segments.append(segment)
        current = [visit]

    segment = _segment_from_session(current, next_visit_at=None, window_end=request.observed_at)
    if segment is not None:
        segments.append(segment)
    return segments


def preview_from_segments(
    request: BrowserHistoryImportRequest,
    outcome: HistoryVisitReadOutcome,
    segments: list[ImportedActivitySegment],
) -> BrowserHistoryImportPreview:
    browser_names = {visit.browser_name for visit in outcome.visits}
    profiles = {(visit.browser_name, visit.profile_name) for visit in outcome.visits}
    return BrowserHistoryImportPreview(
        lookback_days=request.lookback_days,
        candidate_count=len(outcome.visits),
        segment_count=len(segments),
        estimated_seconds=sum(segment.duration_seconds for segment in segments),
        browser_count=len(browser_names),
        profile_count=len(profiles),
        database_count=outcome.database_count,
        error_count=len(outcome.errors),
        window_start=window_start(request),
        window_end=request.observed_at,
    )


def window_start(request: BrowserHistoryImportRequest) -> datetime:
    return request.observed_at - timedelta(days=max(request.lookback_days, 1))


def _segment_from_session(
    visits: list[BrowserHistoryImportVisit],
    next_visit_at: datetime | None,
    window_end: datetime,
) -> ImportedActivitySegment | None:
    first_visit = visits[0]
    last_visit = visits[-1]
    timeout_end = last_visit.visited_at + timedelta(seconds=SESSION_TIMEOUT_SECONDS)
    capped_end = min(timeout_end, window_end)
    if next_visit_at is not None:
        capped_end = min(capped_end, next_visit_at)
    duration_seconds = int(round((capped_end - first_visit.visited_at).total_seconds()))
    if duration_seconds < MIN_SESSION_DURATION_SECONDS:
        return None

    video_id, playlist_id, is_shorts = youtube_ids(first_visit.url)
    return ImportedActivitySegment(
        import_key=_session_import_key(visits),
        started_at=first_visit.visited_at.isoformat(),
        ended_at=capped_end.isoformat(),
        duration_seconds=duration_seconds,
        app_name=first_visit.browser_name,
        bundle_id=None,
        window_title=first_visit.title,
        site_domain=first_visit.site_domain,
        site_title=first_visit.title,
        site_url=first_visit.url,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=1 if is_shorts else 0 if is_shorts is not None else None,
        browser_name=first_visit.browser_name,
        site_source=BROWSER_HISTORY_IMPORT_SOURCE,
        platform="macos",
        source=BROWSER_HISTORY_IMPORT_SOURCE,
        confidence=DEFAULT_CONFIDENCE,
        raw_context_json=json.dumps(
            {
                "source": BROWSER_HISTORY_IMPORT_SOURCE,
                "browserName": first_visit.browser_name,
                "confidence": DEFAULT_CONFIDENCE,
                "visitCount": len(visits),
            }
        ),
    )


def _session_import_key(visits: list[BrowserHistoryImportVisit]) -> str:
    value = "\0".join(visit.import_key for visit in visits)
    return hashlib.sha256(value.encode()).hexdigest()
