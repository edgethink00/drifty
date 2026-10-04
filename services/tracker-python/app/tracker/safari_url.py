"""Resolve Safari's omitted URL scheme without expanding capture permissions."""
from __future__ import annotations

import json
import sys
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from app.tracker.browser_automation import BrowserMetadata
from app.tracker.chatgpt_session import CommandRunner, packaged_helper_path

_BUNDLES = {"Safari": "com.apple.Safari", "Safari Technology Preview": "com.apple.SafariTechnologyPreview"}
HELPER_TIMEOUT_SECONDS = 0.4


def _same_address(left: str, right: str) -> bool:
    # Safari drops the root slash in its address field. Treat only that
    # representation difference as equal; do not decode paths or relax the
    # authority, query or fragment comparison.
    try:
        a, b = urlsplit(left), urlsplit(right)
        return (a.netloc, a.path or "/", a.query, a.fragment) == (
            b.netloc, b.path or "/", b.query, b.fragment,
        )
    except ValueError:
        return False


def refine_safari_url(
    browser: BrowserMetadata,
    bundle_id: str | None,
    pid: int | None,
    run_command: CommandRunner,
    *,
    helper_path: Path | None = None,
) -> BrowserMetadata:
    if (
        _BUNDLES.get(browser.browser_name or "") != bundle_id
        or bundle_id is None
        or type(pid) is not int
        or pid <= 0
        or browser.match_state != "accessibility-address-bar-schemaless"
        or not browser.ax_window_title
        or not browser.site_url
        or not browser.site_url.startswith("https://")
    ):
        return browser
    if helper_path is None:
        if sys.platform != "darwin":
            return browser
        # Never compile on a tracking tick; a missing/old helper preserves the
        # existing lower-confidence address-bar fallback.
        helper_path = packaged_helper_path()
    if helper_path is None:
        return browser
    try:
        result = json.loads(run_command(
            [str(helper_path), "--safari-url", str(pid)], timeout=HELPER_TIMEOUT_SECONDS,
        ))
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
        or not _same_address(url, browser.site_url)
    ):
        return browser
    # Only the omitted scheme changes. Keep source/confidence, title, video
    # identity and every existing classification/close guard unchanged.
    return replace(browser, site_url=url.split("://", 1)[0] + "://" + browser.site_url.split("://", 1)[1])
