from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass


@dataclass
class YouTubeVideoMetadata:
    video_id: str
    category: str | None = None
    channel_id: str | None = None
    channel_name: str | None = None
    title: str | None = None
    description: str | None = None
    keywords: list[str] | None = None
    duration_seconds: int | None = None
    view_count: int | None = None
    is_live: bool | None = None
    is_unlisted: bool | None = None
    publish_date: str | None = None
    upload_date: str | None = None
    source: str = "watch-page"



def parse_youtube_watch_metadata(page: str, video_id: str) -> YouTubeVideoMetadata:
    player_response = _extract_initial_player_response(page)
    microformat = player_response.get("microformat", {}).get("playerMicroformatRenderer", {})
    details = player_response.get("videoDetails", {})

    return YouTubeVideoMetadata(
        video_id=video_id,
        category=_clean_text(microformat.get("category") or _extract_meta_genre(page)),
        channel_id=_clean_text(details.get("channelId") or microformat.get("externalChannelId")),
        channel_name=_clean_text(details.get("author") or microformat.get("ownerChannelName")),
        title=_clean_text(details.get("title")),
        description=_clean_text(details.get("shortDescription")),
        keywords=_clean_keywords(details.get("keywords")),
        duration_seconds=_clean_int(details.get("lengthSeconds") or microformat.get("lengthSeconds")),
        view_count=_clean_int(details.get("viewCount") or microformat.get("viewCount")),
        is_live=_clean_bool(details.get("isLiveContent")),
        is_unlisted=_clean_bool(microformat.get("isUnlisted")),
        publish_date=_clean_text(microformat.get("publishDate")),
        upload_date=_clean_text(microformat.get("uploadDate")),
    )



def _extract_initial_player_response(page: str) -> dict:
    for marker in ("window[\"ytInitialPlayerResponse\"]", "ytInitialPlayerResponse"):
        marker_index = page.find(marker)
        if marker_index < 0:
            continue
        start = page.find("{", marker_index)
        if start < 0:
            continue
        try:
            parsed, _ = json.JSONDecoder().raw_decode(page[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return {}


def _extract_meta_genre(page: str) -> str | None:
    patterns = (
        r'<meta\s+itemprop=["\']genre["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+content=["\']([^"\']+)["\']\s+itemprop=["\']genre["\']',
    )
    for pattern in patterns:
        match = re.search(pattern, page)
        if match:
            return html.unescape(match.group(1))
    return None


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _clean_keywords(value: object) -> list[str] | None:
    if not isinstance(value, list):
        return None
    keywords = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return keywords or None


def _clean_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _clean_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None
