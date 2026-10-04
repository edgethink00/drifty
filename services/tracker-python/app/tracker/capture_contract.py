"""The capture contract shared by every platform.

``Snapshot`` is what a platform capture module returns and what the storage
layer persists. It lived in ``macos_workspace`` because macOS was the only
implementation; leaving it there made every platform import the macOS module
to learn the shared shape, which is backwards and made the seam look narrower
than it is.

``FrontmostCaptureSource`` is deliberately widened here. It was a macOS-only
literal (``system-events``/``lsappinfo``), so a Windows capture had no honest
value to report. The union now carries the Windows mechanisms too, which keeps
the diagnostic field truthful instead of forcing a macOS label onto a Win32
read.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from app.tracker.adaptive_context import AdaptiveContentContextPayload
from app.tracker.browser_automation import BrowserAutomationStatus
from app.tracker.macos_system_activity import SystemTransientActivity

__all__ = [
    "EngagementEvidence",
    "FrontmostCaptureSource",
    "Snapshot",
    "WindowTitleSource",
    "utc_now_iso",
]


def utc_now_iso() -> str:
    """The observation timestamp every capture module stamps onto a Snapshot."""
    return datetime.now(timezone.utc).isoformat()

FrontmostCaptureSource = Literal[
    # macOS mechanisms
    "system-events",
    "lsappinfo",
    "nsworkspace",
    # Windows mechanisms
    "win32-foreground",
    "uwp-frame-host",
    "unavailable",
]
EngagementEvidence = Literal["foreground-audio"]
# Which mechanism produced window_title. The accessibility tree and the
# on-screen window list fail independently, so a capture that recovered a title
# from the window list must stay distinguishable in diagnostics.
WindowTitleSource = Literal[
    "system-events",
    "browser-accessibility",
]


@dataclass
class Snapshot:
    observed_at: str
    app_name: str
    bundle_id: str | None
    window_title: str | None
    source: str
    browser_name: str | None = None
    site_domain: str | None = None
    site_title: str | None = None
    site_url: str | None = None
    youtube_video_id: str | None = None
    youtube_playlist_id: str | None = None
    youtube_is_shorts: bool | None = None
    site_source: str | None = None
    capture_confidence: float = 1.0
    browser_automation_status: BrowserAutomationStatus | None = None
    browser_automation_error: str | None = None
    browser_history_status: str | None = None
    browser_history_reason: str | None = None
    browser_history_database_found: bool | None = None
    browser_history_profile_count: int | None = None
    browser_history_candidate_count: int | None = None
    browser_history_error_count: int | None = None
    system_transient_activity: SystemTransientActivity | None = None
    frontmost_capture_source: FrontmostCaptureSource | None = None
    frontmost_capture_error: str | None = None
    frontmost_fallback_error: str | None = None
    window_title_source: WindowTitleSource | None = None
    adaptive_content_context: AdaptiveContentContextPayload | None = None
    engagement_evidence: EngagementEvidence | None = None
    exclusion_source: str | None = None
