from __future__ import annotations

from typing import Final

# System Events names Firefox-family processes after their lowercase
# executable (`firefox`, `zen`, `floorp`), not their bundle name. Observed for
# Firefox 154-156, Zen 1.22.3b, and Floorp 12.18.1 on macOS 14, and in macOS 26
# tracker history. Browser capture, the tab-close path, and the app lists all
# key on the bundle name, so an uncanonicalized segment was an app named after
# the executable: page capture never ran, an automatic close fell through to
# quitting the whole browser, and history split into two app rows.
_CANONICAL_MACOS_APP_NAMES_BY_BUNDLE_ID: Final = {
    "org.mozilla.firefox": "Firefox",
    "org.mozilla.firefoxdeveloperedition": "Firefox Developer Edition",
    "app.zen-browser.zen": "Zen",
    "app.floorp.floorp": "Floorp",
}


def canonical_macos_app_name(app_name: str | None, bundle_id: str | None) -> str | None:
    canonical = _CANONICAL_MACOS_APP_NAMES_BY_BUNDLE_ID.get((bundle_id or "").strip().casefold())
    return canonical or app_name
