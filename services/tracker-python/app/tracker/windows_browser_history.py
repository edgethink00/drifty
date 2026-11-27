"""Windows profile roots for the browser-history URL fallback.

Only the *location* of each history database differs on Windows; the schema,
the WAL-sidecar copy, the title match and the candidate scoring in
``browser_history`` are identical, so this module contributes a path table and
nothing else.

Two Windows-specific shapes are handled here:

* Chromium browsers nest their profile tree under a ``User Data`` directory,
  where macOS puts profiles directly in the Application Support folder.
* Firefox keeps profiles under ``%APPDATA%\\Mozilla\\Firefox\\Profiles`` rather
  than Application Support, and Windows installs commonly carry both a
  release and a default-release profile.

The fallback is deliberately treated as *navigation evidence*, never as a
measured dwell time: a history row proves a page was visited, not that it was
focused, and background tabs, private windows and cleared history all break
that inference. ActivityWatch reaches the same conclusion and ships a browser
extension (``aw-watcher-web``) for real time attribution rather than reading
these databases as a primary source.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final


def _user_profile() -> Path | None:
    """The user's profile directory, or ``None`` when it cannot be determined.

    ``Path.home()`` raises on Windows when neither ``USERPROFILE`` nor the
    ``HOMEDRIVE``/``HOMEPATH`` pair is set, which happens under service
    accounts and stripped environments. This lookup feeds an optional URL
    fallback, so an unknown home has to degrade to "no history roots" rather
    than propagate an exception into a capture tick.
    """
    try:
        return Path.home()
    except (RuntimeError, OSError):
        return None


def _appdata(variable: str, *subdirectories: str) -> Path | None:
    value = os.environ.get(variable)
    if value:
        return Path(value)
    home = _user_profile()
    if home is None:
        return None
    return home.joinpath(*subdirectories)


def windows_browser_roots() -> dict:
    """Profile roots keyed by the app name Windows foreground capture reports.

    Keys match the ``app_name`` produced by ``windows_workspace`` so the shared
    ``browser_history`` lookup finds them without a translation layer.
    """
    local = _appdata("LOCALAPPDATA", "AppData", "Local")
    roaming = _appdata("APPDATA", "AppData", "Roaming")
    if local is None or roaming is None:
        # Without a resolvable profile directory there is nowhere to look; an
        # empty table reads downstream as "no history database found", which
        # is exactly what is true here.
        return {}
    return {
        "Google Chrome": local / "Google" / "Chrome" / "User Data",
        "Google Chrome Beta": local / "Google" / "Chrome Beta" / "User Data",
        "Google Chrome Dev": local / "Google" / "Chrome Dev" / "User Data",
        "Google Chrome Canary": local / "Google" / "Chrome SxS" / "User Data",
        "Microsoft Edge": local / "Microsoft" / "Edge" / "User Data",
        "Brave Browser": local / "BraveSoftware" / "Brave-Browser" / "User Data",
        "Chromium": local / "Chromium" / "User Data",
        "Comet": local / "Perplexity" / "Comet" / "User Data",
        "Vivaldi": local / "Vivaldi" / "User Data",
        "Opera": roaming / "Opera Software" / "Opera Stable",
        "Whale": local / "Naver" / "Naver Whale" / "User Data",
        "Firefox": roaming / "Mozilla" / "Firefox" / "Profiles",
        "Firefox Developer Edition": roaming / "Mozilla" / "Firefox" / "Profiles",
        "Zen": roaming / "zen" / "Profiles",
        "Floorp": roaming / "Floorp" / "Profiles",
        "LibreWolf": roaming / "librewolf" / "Profiles",
        "Waterfox": roaming / "Waterfox" / "Profiles",
    }


WINDOWS_BROWSER_ROOTS: Final[dict] = windows_browser_roots()
