"""Display names for Windows executables, shared by capture and stored rows.

Windows foreground capture only has an executable path. A basename missing
from these tables is shown without its ``.exe`` suffix, which suits ordinary
apps but not browsers: a browser recorded as ``zen`` or ``floorp`` is an app,
so page capture never runs and a drift verdict on it closes the whole browser
instead of refusing the unsupported tab close.
"""

from __future__ import annotations

import ntpath
from typing import Final, Optional

_BROWSER_EXE_DISPLAY_NAMES: Final = {
    "chrome.exe": "Google Chrome",
    "msedge.exe": "Microsoft Edge",
    "brave.exe": "Brave Browser",
    "chromium.exe": "Chromium",
    "vivaldi.exe": "Vivaldi",
    "opera.exe": "Opera",
    "whale.exe": "Whale",
    "firefox.exe": "Firefox",
    "zen.exe": "Zen",
    "floorp.exe": "Floorp",
    "librewolf.exe": "LibreWolf",
    "waterfox.exe": "Waterfox",
    "mullvadbrowser.exe": "Mullvad Browser",
    "arc.exe": "Arc",
    "comet.exe": "Comet",
    "thorium.exe": "Thorium",
}

# Executables whose basename is shared with another product or is generic are
# named by their install location instead (lowercase, "/" separators, suffix).
_BROWSER_PATH_DISPLAY_NAMES: Final = (
    ("/google/chrome beta/application/chrome.exe", "Google Chrome Beta"),
    ("/google/chrome dev/application/chrome.exe", "Google Chrome Dev"),
    ("/google/chrome sxs/application/chrome.exe", "Google Chrome Canary"),
    # Tor Browser ships Firefox's executable name. Naming it keeps Firefox page
    # capture and tab closing away from a privacy browser.
    ("/tor browser/browser/firefox.exe", "Tor Browser"),
    ("/yandex/yandexbrowser/application/browser.exe", "Yandex Browser"),
)

WINDOWS_BROWSER_APP_NAMES: Final = frozenset(_BROWSER_EXE_DISPLAY_NAMES.values()) | frozenset(
    display_name for _, display_name in _BROWSER_PATH_DISPLAY_NAMES
)


def exe_display_name(exe_path: Optional[str]) -> Optional[str]:
    if not exe_path:
        return None
    name = exe_path.replace("\\", "/").rsplit("/", 1)[-1]
    normalized_path = exe_path.replace("\\", "/").lower()
    for suffix, display_name in _BROWSER_PATH_DISPLAY_NAMES:
        if normalized_path.endswith(suffix):
            return display_name
    known = _BROWSER_EXE_DISPLAY_NAMES.get(name.lower())
    if known:
        return known
    if name.lower().endswith(".exe"):
        name = name[: -len(".exe")]
    return name or None


def is_windows_browser_app(app_name: Optional[str]) -> bool:
    return app_name in WINDOWS_BROWSER_APP_NAMES


def canonical_windows_app_name(app_name: Optional[str], bundle_id: Optional[str]) -> Optional[str]:
    """The current display name for a row recorded under its executable name.

    Windows rows store the lowercased executable path as ``bundle_id``. A row
    whose name is that executable's stem (for example ``zen`` for
    ``...\\zen.exe``) predates the name above and is shown under it, so one
    browser does not split into two app rows across an update. Any other stored
    name is kept as captured.
    """
    if not app_name or not bundle_id or not ntpath.isabs(bundle_id):
        return app_name
    basename = ntpath.basename(bundle_id)
    if not basename.lower().endswith(".exe"):
        return app_name
    if app_name.casefold() != basename[: -len(".exe")].casefold():
        return app_name
    return exe_display_name(bundle_id) or app_name
