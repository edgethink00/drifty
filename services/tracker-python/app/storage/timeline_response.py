"""Bound the full timeline before materializing an unbounded DTO list.

The JSON encoder settings match the ordinary tracker envelope: ASCII escapes,
including surrogate pairs, and the default separators. No record is clipped.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import json


MAX_TIMELINE_SOURCE_ROW_BYTES = 256 * 1024
MAX_TIMELINE_SOURCE_BATCH_BYTES = 256 * 1024
MAX_TIMELINE_JSON_ROW_BYTES = 2 * 1024 * 1024
MAX_TIMELINE_JSON_BYTES = 32 * 1024 * 1024
TIMELINE_TOO_LARGE = "tracker_timeline_too_large"


class TimelineTooLarge(ValueError):
    def __init__(self):
        super().__init__(TIMELINE_TOO_LARGE)


@dataclass(frozen=True)
class EncodedTimeline:
    # Internal validated JSON; the existing full command remains an array.
    json: str
    count: int


class TimelineJsonBuilder:
    def __init__(self):
        self._buffer = BytesIO()
        self._buffer.write(b"[")
        self._count = 0

    def append(self, item: dict) -> None:
        encoded = json.dumps(item).encode("ascii")
        separator = b", " if self._count else b""
        # Reserve the closing bracket, and reject the whole result on excess.
        if (len(encoded) > MAX_TIMELINE_JSON_ROW_BYTES
                or self._buffer.tell() + len(separator) + len(encoded) + 1 > MAX_TIMELINE_JSON_BYTES):
            raise TimelineTooLarge()
        self._buffer.write(separator)
        self._buffer.write(encoded)
        self._count += 1

    @property
    def encoded_bytes(self) -> int:
        return self._buffer.tell() + 1  # include the closing bracket

    def finish(self) -> EncodedTimeline:
        self._buffer.write(b"]")
        return EncodedTimeline(self._buffer.getvalue().decode("ascii"), self._count)

    def close(self) -> None:
        self._buffer.close()
