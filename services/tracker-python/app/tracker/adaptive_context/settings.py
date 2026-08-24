from __future__ import annotations

import os
from typing import Final

ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV: Final = "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE"
ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV: Final = "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES"
MAX_ADAPTIVE_ITEMS: Final = 8
MAX_ADAPTIVE_VALUES: Final = 5
MAX_ADAPTIVE_VALUE_CHARS: Final = 240
MAX_MARKDOWN_BYTES: Final = 32768
SUPPORTED_ADAPTIVE_SOURCE_FAMILIES: Final = frozenset(
    {
        "document_knowledge",
        "local_notes_markdown",
        "work_tracker_dev_platform",
        "design_dev_tool",
        "calendar_meeting",
        "communication_metadata",
        "ai_conversation",
        "developer_workspace",
        "document_editor",
    }
)


def adaptive_context_capture_enabled() -> bool:
    return os.environ.get(ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV) == "1"


def enabled_adaptive_source_families() -> frozenset[str]:
    raw_value = os.environ.get(ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV)
    if raw_value is None:
        return SUPPORTED_ADAPTIVE_SOURCE_FAMILIES

    enabled = {
        value.strip()
        for value in raw_value.split(",")
        if value.strip() in SUPPORTED_ADAPTIVE_SOURCE_FAMILIES
    }
    return frozenset(enabled)
