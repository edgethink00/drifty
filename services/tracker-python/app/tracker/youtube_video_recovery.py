"""Recover a YouTube video id when the browser momentarily reports a base URL.

Chromium browsers (e.g. Aside) usually expose the exact `/watch?v=…` URL, but during
YouTube's in-page (SPA) navigation the window title can update to the new video a tick
before `URL of active tab` settles, so an occasional capture lands with the video title
but a bare `https://www.youtube.com/` URL and therefore no video id. Those blips then look
like the YouTube home page and get classified "unknown", and never trigger the background
metadata fetch (category / channel).

This keeps a small in-memory map of the most recent `video title -> video id` seen while
the id *was* present, and fills the id back in for a matching title-only blip. It is a pure
in-memory lookup on the capture thread — no I/O, no blocking, no user-visible impact.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from urllib.parse import urlparse

# The window title of a watched video looks like "<name> - YouTube[ - <status>][ - <app>]".
_YOUTUBE_TITLE_MARKER = " - youtube"
# YouTube prefixes the tab title with an unread-notification count, e.g. "(3) <name> - YouTube".
_NOTIFICATION_COUNT_PREFIX = re.compile(r"^\(\d+\)\s+")
# Hosts whose bare base URL can be the mid-SPA-navigation blip we recover from. Deliberately
# excludes music.youtube.com, whose base URL is a real listening surface of its own.
_BLIP_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})


def youtube_video_name(window_title: str | None, site_domain: str | None) -> str | None:
    """The specific video name if this window is a YouTube *video*, else None.

    Returns None for the bare home/feed title ("YouTube") and for non-YouTube windows,
    so those are never given a recovered id (a real home visit stays home).
    """
    if not window_title or not site_domain:
        return None
    if "youtube" not in site_domain.lower():
        return None
    marker_index = window_title.lower().find(_YOUTUBE_TITLE_MARKER)
    if marker_index <= 0:
        return None
    name = window_title[:marker_index].strip()
    # Drop the notification-count prefix so "(3) <name>" and "<name>" share one memory key.
    name = _NOTIFICATION_COUNT_PREFIX.sub("", name).strip()
    if not name or name.lower() == "youtube":
        return None
    return name


def is_base_url_blip(site_url: str | None) -> bool:
    """True only for the bare YouTube base URL a mid-SPA-navigation capture leaves behind.

    Search results, playlists, channels, and Shorts share the "<name> - YouTube" title shape
    with real videos, so recovery must never fire on a URL that already names a page — only
    on "https://www.youtube.com/" (host variants aside) with no path, query, or fragment.
    """
    if not site_url:
        return False
    try:
        parsed = urlparse(site_url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if (parsed.hostname or "").lower() not in _BLIP_HOSTS:
        return False
    if parsed.path not in ("", "/"):
        return False
    return not parsed.query and not parsed.fragment


def canonical_watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


class YouTubeVideoIdMemory:
    """Remembers recent `video title -> video id` and recovers it for title-only blips."""

    def __init__(self, max_entries: int = 64) -> None:
        self._entries: "OrderedDict[str, str]" = OrderedDict()
        self._max_entries = max(1, max_entries)

    def observe(
        self,
        window_title: str | None,
        site_domain: str | None,
        site_url: str | None,
        video_id: str | None,
        *,
        learn: bool = True,
    ) -> tuple[str | None, str | None]:
        """Return the (possibly recovered) `(video_id, site_url)` for this capture.

        - When a video id is present (and `learn` is set), remember it under the video's
          title. Callers pass `learn=False` for captures whose tab data may describe a
          different window (e.g. front-fallback matches), so a mismatch cannot teach the
          memory a wrong title -> id pair that would later replay at full confidence.
        - When the id is absent, the title names a video we have seen, *and* the URL is the
          bare base-URL blip, fill the id back in and canonicalise the URL so downstream
          classification + metadata fetch work. Pages that merely share the video's title
          (search results, playlists, channels) keep their real URL untouched.
        Otherwise the inputs are returned unchanged.
        """
        name = youtube_video_name(window_title, site_domain)
        if video_id:
            if learn and name is not None:
                self._remember(name, video_id)
            return video_id, site_url
        if name is not None and is_base_url_blip(site_url):
            recovered = self._entries.get(name)
            if recovered is not None:
                self._entries.move_to_end(name)
                return recovered, canonical_watch_url(recovered)
        return video_id, site_url

    def _remember(self, name: str, video_id: str) -> None:
        self._entries[name] = video_id
        self._entries.move_to_end(name)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
