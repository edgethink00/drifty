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

from collections import OrderedDict

# The window title of a watched video looks like "<name> - YouTube[ - <status>][ - <app>]".
_YOUTUBE_TITLE_MARKER = " - youtube"


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
    if not name or name.lower() == "youtube":
        return None
    return name


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
    ) -> tuple[str | None, str | None]:
        """Return the (possibly recovered) `(video_id, site_url)` for this capture.

        - When a video id is present, remember it under the video's title.
        - When it is absent but the title names a video we have seen, fill the id back in
          and canonicalise the URL so downstream classification + metadata fetch work.
        Otherwise the inputs are returned unchanged.
        """
        name = youtube_video_name(window_title, site_domain)
        if video_id:
            if name is not None:
                self._remember(name, video_id)
            return video_id, site_url
        if name is not None:
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
