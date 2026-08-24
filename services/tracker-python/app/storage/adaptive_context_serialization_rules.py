from __future__ import annotations

from typing import Final

ADAPTIVE_CONTEXT_RAW_KEYS: Final[tuple[str, str]] = ("adaptive_content_context", "adaptiveContentContext")
BODY_LIKE_CONTEXT_KEYS: Final[frozenset[str]] = frozenset(
    {
        "documentBody",
        "document_body",
        "notionBody",
        "notion_body",
        "obsidianBody",
        "obsidian_body",
        "messageBody",
        "message_body",
        "rawBody",
        "raw_body",
        "rawFullPageText",
        "raw_full_page_text",
        "prompt",
        "response",
        "conversationBody",
        "conversation_body",
        "terminalCommand",
        "terminal_command",
        "shellCommand",
        "shell_command",
        "documentText",
        "document_text",
        "selectedText",
        "selected_text",
    }
)
ADAPTIVE_CONTEXT_DEPTHS: Final[frozenset[int]] = frozenset({0, 1, 2, 3})
ADAPTIVE_CONTEXT_ITEM_KINDS: Final[frozenset[str]] = frozenset(
    {
        "appName",
        "bundleId",
        "windowTitle",
        "siteDomain",
        "siteUrl",
        "siteTitle",
        "youtubeTitle",
        "youtubeChannelName",
        "youtubeCategory",
        "workspace",
        "parentPage",
        "database",
        "project",
        "folder",
        "vault",
        "repo",
        "team",
        "channel",
        "thread",
        "document",
        "heading",
        "tag",
        "label",
        "status",
        "documentType",
        "issueType",
        "visibleSection",
        "meetingType",
        "attendeeCountRange",
        "pageType",
        "layerType",
        "channelType",
        "conversationType",
        "shortSelectedHint",
        "shortVisibleHint",
        "introHint",
        "safeKeywordSummary",
        "messageBody",
    }
)
ADAPTIVE_CONTEXT_SOURCE_FAMILIES: Final[frozenset[str]] = frozenset(
    {
        "surface_metadata",
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
ADAPTIVE_PROVIDER_POLICIES: Final[frozenset[str]] = frozenset(
    {"send", "metadata_only", "local_only", "blocked"}
)
ADAPTIVE_EXTRACTION_CONFIDENCES: Final[frozenset[str]] = frozenset(
    {"high", "medium", "low", "unknown"}
)
ADAPTIVE_LOCAL_STORAGE_STATUSES: Final[frozenset[str]] = frozenset(
    {"not_persisted_current_payload", "stored_local", "dropped", "expired", "disabled"}
)
ADAPTIVE_SENSITIVITY_FLAGS: Final[frozenset[str]] = frozenset(
    {
        "auth",
        "password",
        "payment",
        "health",
        "legal",
        "hr",
        "finance",
        "message_body",
        "secret_like",
        "personal_identifier",
    }
)
MAX_ADAPTIVE_CONTEXT_ITEMS: Final = 8
MAX_ADAPTIVE_CONTEXT_VALUES: Final = 5
MAX_ADAPTIVE_CONTEXT_VALUE_CHARS: Final = 240
MESSAGE_BODY_PLACEHOLDER: Final = "message body omitted"
