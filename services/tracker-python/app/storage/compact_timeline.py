"""Keep classification inputs exact without repeating video metadata per row."""
from __future__ import annotations

from collections.abc import Callable
import json
from typing import Any

from app.storage.activity_segment_serialization import YOUTUBE_METADATA_FIELDS
from app.storage.timeline_response import (
    EncodedTimeline, MAX_TIMELINE_JSON_BYTES, TimelineJsonBuilder, TimelineTooLarge,
)


class CompactTimelineBuilder:
    PREFIX = '{"items": '
    SEPARATOR = ', "youtubeMetadata": '
    SUFFIX = '}'

    def __init__(self):
        self._items = TimelineJsonBuilder()
        self._metadata = TimelineJsonBuilder()
        self._indexes: dict[str | None, int] = {}
        self._values: dict[str, int] = {}
        self._key_bytes = 0
        self._count = 0

    def _require_budget(self) -> None:
        size = (len(self.PREFIX) + len(self.SEPARATOR) + len(self.SUFFIX)
                + self._items.encoded_bytes + self._metadata.encoded_bytes)
        if size > MAX_TIMELINE_JSON_BYTES:
            raise TimelineTooLarge()

    def append_row(self, row: dict[str, Any], serialize: Callable,
                   load_metadata: Callable[[str | None], dict]) -> None:
        # The raw lookup identity stays here. The packet carries only an index,
        # including when normal DTO privacy normalization hides the video ID.
        video_id = row.get("youtube_video_id")
        if video_id not in self._indexes:
            self._key_bytes += len(video_id.encode("utf-8")) if video_id else 0
            if self._key_bytes > MAX_TIMELINE_JSON_BYTES:
                raise TimelineTooLarge()
            metadata = load_metadata(video_id)
            # Indexes identify equal visible values, not the hidden lookup
            # identity. Identical metadata from different videos shares a slot.
            value_key = json.dumps(metadata)
            if value_key not in self._values:
                self._metadata.append(metadata)
                self._values[value_key] = len(self._values)
                self._require_budget()
            self._indexes[video_id] = self._values[value_key]
        item = serialize(row)
        for key in YOUTUBE_METADATA_FIELDS:
            item.pop(key)
        item["youtubeMetadataIndex"] = self._indexes[video_id]
        self._items.append(item)
        self._count += 1
        self._require_budget()

    def finish(self) -> EncodedTimeline:
        self._require_budget()
        items = self._items.finish().json
        metadata = self._metadata.finish().json
        return EncodedTimeline(self.PREFIX + items + self.SEPARATOR + metadata + self.SUFFIX, self._count)

    def close(self) -> None:
        self._items.close()
        self._metadata.close()
        self._indexes.clear()
        self._values.clear()
