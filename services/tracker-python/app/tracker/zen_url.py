"""Restore the page path Zen's address field hides while it is not edited.

Zen 1.23 shows only the host in its sidebar address field until the field is
focused, so the address-bar read loses the path, YouTube video identity and the
exact URL that page clues are bound to. The packaged helper reads only the
selected page's native URL attribute, never page contents.
"""
from __future__ import annotations

import json
import sys
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from app.tracker.browser_automation import BrowserMetadata, normalize_domain, youtube_ids
from app.tracker.chatgpt_session import CommandRunner, packaged_helper_path

ZEN_BUNDLE_ID = "app.zen-browser.zen"
HELPER_TIMEOUT_SECONDS = 0.4


def _host(value: str) -> str | None:
    try:
        host = urlsplit(value).hostname
    except ValueError:
        return None
    return host.casefold().removeprefix("www.") if host else None


def _host_only(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.path in {"", "/"} and not parts.query and not parts.fragment


def refine_zen_url(
    browser: BrowserMetadata,
    bundle_id: str | None,
    pid: int | None,
    run_command: CommandRunner,
    *,
    helper_path: Path | None = None,
) -> BrowserMetadata:
    if (
        bundle_id != ZEN_BUNDLE_ID
        or browser.browser_name != "Zen"
        or type(pid) is not int
        or pid <= 0
        or not (browser.match_state or "").startswith("accessibility-address-bar")
        or not browser.ax_window_title
        or not browser.site_url
        or not _host_only(browser.site_url)
    ):
        return browser
    if helper_path is None:
        if sys.platform != "darwin":
            return browser
        # Never compile on a tracking tick; a missing helper keeps the host.
        helper_path = packaged_helper_path()
    if helper_path is None:
        return browser
    try:
        result = json.loads(run_command([str(helper_path), "--gecko-url", str(pid)], timeout=HELPER_TIMEOUT_SECONDS))
    except (OSError, RuntimeError, ValueError, TypeError):
        return browser
    if not isinstance(result, dict) or type(result.get("schemaVersion")) is not int or result["schemaVersion"] != 1:
        return browser
    url = result.get("url")
    if (
        type(result.get("pid")) is not int or result["pid"] != pid
        or result.get("bundleId") != bundle_id
        or result.get("windowTitle") != browser.ax_window_title
        or not isinstance(url, str) or not url.startswith(("http://", "https://"))
        or _host(url) is None or _host(url) != _host(browser.site_url)
    ):
        return browser
    video_id, playlist_id, is_shorts = youtube_ids(url)
    return replace(
        browser, site_url=url, site_domain=normalize_domain(url),
        youtube_video_id=video_id, youtube_playlist_id=playlist_id, youtube_is_shorts=is_shorts,
    )
