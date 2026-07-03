from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final
from collections.abc import Mapping

BROWSER_HISTORY_IMPORT_SOURCE: Final = "browser-history-import"
DEFAULT_LOOKBACK_DAYS: Final = 2
SESSION_TIMEOUT_SECONDS: Final = 5 * 60
# Match the tracker's coarse granularity: drop sub-tracking browsing blips (a page
# opened for a few seconds) so imported history reads like real activity, not raw
# per-navigation history. Short sessions are ~40% of the count but ~2% of the time.
MIN_SESSION_DURATION_SECONDS: Final = 20
DEFAULT_CONFIDENCE: Final = 0.35
MAX_IMPORT_VISITS_PER_PROFILE: Final = 5_000
VALID_URL_SCHEMES: Final = frozenset({"http", "https"})


@dataclass(frozen=True, slots=True)
class BrowserHistoryImportRequest:
    lookback_days: int
    observed_at: datetime
    profile_roots: Mapping[str, Path] | None = None


@dataclass(frozen=True, slots=True)
class BrowserHistoryImportVisit:
    import_key: str
    url: str
    title: str
    visited_at: datetime
    browser_name: str
    profile_name: str
    site_domain: str


@dataclass(frozen=True, slots=True)
class HistoryVisitReadOutcome:
    visits: tuple[BrowserHistoryImportVisit, ...]
    errors: tuple[str, ...]
    database_count: int


@dataclass(frozen=True, slots=True)
class BrowserHistoryImportPreview:
    lookback_days: int
    candidate_count: int
    segment_count: int
    estimated_seconds: int
    browser_count: int
    profile_count: int
    database_count: int
    error_count: int
    window_start: datetime
    window_end: datetime

    def to_payload(self) -> dict[str, int | str]:
        return {
            "lookbackDays": self.lookback_days,
            "candidateCount": self.candidate_count,
            "segmentCount": self.segment_count,
            "estimatedSeconds": self.estimated_seconds,
            "browserCount": self.browser_count,
            "profileCount": self.profile_count,
            "databaseCount": self.database_count,
            "errorCount": self.error_count,
            "windowStart": self.window_start.isoformat(),
            "windowEnd": self.window_end.isoformat(),
        }


@dataclass(frozen=True, slots=True)
class BrowserHistoryImportResult:
    preview: BrowserHistoryImportPreview
    inserted_count: int
    skipped_duplicate_count: int

    def to_payload(self) -> dict[str, int | str]:
        return {
            **self.preview.to_payload(),
            "insertedCount": self.inserted_count,
            "skippedDuplicateCount": self.skipped_duplicate_count,
        }
