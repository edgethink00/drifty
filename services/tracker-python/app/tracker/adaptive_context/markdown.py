from __future__ import annotations

import re
from pathlib import Path
from typing import Final

from app.tracker.adaptive_context.normalization import clean_context_values, path_markdown_file_from_title
from app.tracker.adaptive_context.settings import MAX_MARKDOWN_BYTES
from app.tracker.adaptive_context.types import AdaptiveContextCaptureInput

MARKDOWN_HEADING_RE: Final = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def markdown_file_path(capture: AdaptiveContextCaptureInput) -> Path | None:
    if capture.active_file_path:
        path = Path(capture.active_file_path).expanduser()
        if path.suffix.lower() in {".md", ".markdown"}:
            return path
    path = path_markdown_file_from_title(capture.window_title)
    return Path(path).expanduser() if path else None


def bounded_markdown_text(path: Path | None) -> str:
    if path is None:
        return ""
    try:
        with path.open("rb") as file:
            raw_text = file.read(MAX_MARKDOWN_BYTES)
    except OSError:
        return ""
    try:
        return raw_text.decode("utf-8")
    except UnicodeDecodeError:
        return ""


def markdown_frontmatter_tags(markdown_text: str) -> list[str]:
    if not markdown_text.startswith("---\n"):
        return []
    closing_index = markdown_text.find("\n---", 4)
    if closing_index < 0:
        return []
    frontmatter = markdown_text[4:closing_index]
    tags: list[str] = []
    for line in frontmatter.splitlines():
        key, separator, raw_value = line.partition(":")
        if key.strip() != "tags" or not separator:
            continue
        normalized = raw_value.strip().strip("[]")
        tags.extend(part.strip().strip("'\"") for part in normalized.split(","))
    return clean_context_values(tags)


def markdown_headings(markdown_text: str) -> list[str]:
    headings: list[str] = []
    for line in markdown_text.splitlines():
        match = MARKDOWN_HEADING_RE.match(line)
        if match is None:
            continue
        headings.append(match.group(2))
    return clean_context_values(headings)
