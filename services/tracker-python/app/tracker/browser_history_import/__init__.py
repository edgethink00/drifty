from __future__ import annotations

from app.storage.db import TrackerDatabase

from .models import (
    BROWSER_HISTORY_IMPORT_SOURCE,
    DEFAULT_LOOKBACK_DAYS,
    BrowserHistoryImportPreview,
    BrowserHistoryImportRequest,
    BrowserHistoryImportResult,
)
from .reader import read_import_visits
from .segments import preview_from_segments, segments_from_visits

__all__ = [
    "BROWSER_HISTORY_IMPORT_SOURCE",
    "DEFAULT_LOOKBACK_DAYS",
    "BrowserHistoryImportPreview",
    "BrowserHistoryImportRequest",
    "BrowserHistoryImportResult",
    "preview_browser_history_import",
    "import_browser_history",
]


def preview_browser_history_import(request: BrowserHistoryImportRequest) -> BrowserHistoryImportPreview:
    outcome = read_import_visits(request)
    segments = segments_from_visits(outcome.visits, request)
    return preview_from_segments(request, outcome, segments)


def import_browser_history(db: TrackerDatabase, request: BrowserHistoryImportRequest) -> BrowserHistoryImportResult:
    outcome = read_import_visits(request)
    segments = segments_from_visits(outcome.visits, request)
    preview = preview_from_segments(request, outcome, segments)
    inserted = db.insert_imported_activity_segments(
        segments,
        imported_at=request.observed_at.isoformat(),
    )
    return BrowserHistoryImportResult(
        preview=preview,
        inserted_count=inserted.inserted_count,
        skipped_duplicate_count=inserted.skipped_duplicate_count,
    )
