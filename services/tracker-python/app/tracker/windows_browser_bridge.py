"""Read local bridge context only after an exact foreground Document URL match."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

from app.tracker.browser_automation import BrowserMetadata, normalize_domain, youtube_ids


_MAX_SNAPSHOT_BYTES: Final = 32 * 1024
_MAX_AGE_SECONDS: Final = 5.0
_CHROMIUM_APP_NAMES: Final = frozenset(
    {
        "Google Chrome",
        "Google Chrome Beta",
        "Google Chrome Dev",
        "Google Chrome Canary",
        "Microsoft Edge",
        "Brave Browser",
        "Chromium",
        "Vivaldi",
        "Opera",
        "Whale",
    }
)


def browser_bridge_snapshot_path(environment: dict[str, str] | None = None) -> Path | None:
    values = os.environ if environment is None else environment
    override = values.get("DRIFTY_BROWSER_BRIDGE_DIR")
    if override:
        return Path(override) / "active-tab.json"
    local_app_data = values.get("LOCALAPPDATA")
    if not local_app_data:
        return None
    return Path(local_app_data) / "so.drifty.windows" / "browser-bridge" / "active-tab.json"


def _family_matches_app(browser_family: str, app_name: str) -> bool:
    if browser_family == "firefox":
        return app_name == "Firefox"
    if browser_family == "chromium":
        return app_name in _CHROMIUM_APP_NAMES
    return False


def _fresh_received_at(received_at_epoch_ms: object, now: datetime) -> bool:
    if not isinstance(received_at_epoch_ms, int):
        return False
    age_seconds = now.timestamp() - received_at_epoch_ms / 1000
    return -1.0 <= age_seconds <= _MAX_AGE_SECONDS


def read_browser_bridge_metadata(
    app_name: str,
    foreground_url: str | None,
    path: Path | None = None,
    now: datetime | None = None,
) -> BrowserMetadata | None:
    # V1 messages identify only a browser family and extension window ID, not
    # the OS foreground window or the product that sent them. A same-family
    # browser can otherwise inherit another browser's recent tab URL.
    if not foreground_url:
        return None
    snapshot_path = path or browser_bridge_snapshot_path()
    if snapshot_path is None:
        return None
    try:
        if snapshot_path.stat().st_size > _MAX_SNAPSHOT_BYTES:
            return None
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None

    observed_now = now or datetime.now(timezone.utc)
    if observed_now.tzinfo is None:
        observed_now = observed_now.replace(tzinfo=timezone.utc)
    if (
        not isinstance(payload, dict)
        or payload.get("version") != 1
        or not _fresh_received_at(payload.get("receivedAtEpochMs"), observed_now)
        or not _family_matches_app(payload.get("browserFamily"), app_name)
    ):
        return None

    tab = payload.get("tab")
    if not isinstance(tab, dict):
        return None
    url = tab.get("url")
    domain = tab.get("domain")
    title = tab.get("title")
    if not isinstance(url, str) or not isinstance(domain, str) or not isinstance(title, str):
        return None
    if len(url) > 8192 or len(domain) > 253 or len(title) > 512:
        return None
    if url != foreground_url:
        return None
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    normalized_domain = normalize_domain(url)
    if not normalized_domain or normalized_domain.casefold() != domain.casefold():
        return None

    video_id, playlist_id, is_shorts = youtube_ids(url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=normalized_domain,
        # V1 does not identify the sending HWND/product. The title can belong
        # to a different window displaying this same URL.
        site_title=None,
        site_url=url,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        match_state="browser-extension",
        browser_automation_status="granted",
    )
