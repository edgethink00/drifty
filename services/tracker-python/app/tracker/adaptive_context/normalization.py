from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path, PureWindowsPath
from typing import Final
from urllib.parse import unquote, urlparse

from app.tracker.adaptive_context.settings import MAX_ADAPTIVE_VALUE_CHARS, MAX_ADAPTIVE_VALUES
from app.tracker.adaptive_context.types import AdaptiveContextCaptureInput, AdaptiveStructuredFields

BODY_LIKE_STRUCTURED_KEYS: Final = frozenset(
    {
        "body",
        "document_body",
        "message_body",
        "raw_body",
        "raw_full_page_text",
        "prompt",
        "response",
        "conversation_body",
        "terminal_command",
        "shell_command",
        "document_text",
        "selected_text",
    }
)
DOCUMENT_DOMAINS: Final = ("notion.so", "confluence", "coda.io")
DOCUMENT_APPS: Final = frozenset({"notion"})
ISSUE_DOMAINS: Final = ("github.com", "gitlab.com", "sentry.io", "atlassian.net", "jira")
NON_REPO_PATH_SEGMENTS: Final = frozenset(
    {
        "codespaces",
        "dashboard",
        "explore",
        "login",
        "marketplace",
        "new",
        "notifications",
        "organizations",
        "orgs",
        "search",
        "settings",
        "sponsors",
        "topics",
        "trending",
    }
)
DESIGN_DOMAINS: Final = ("figma.com",)
AI_CONVERSATION_DOMAINS: Final = (
    "chatgpt.com",
    "claude.ai",
    "claude.com",
    "gemini.google.com",
    "grok.com",
    "perplexity.ai",
    "poe.com",
    "kimi.com",
    "chat.mistral.ai",
    "chat.deepseek.com",
)
DEVELOPER_WORKSPACE_APPS: Final = frozenset(
    {"cmux", "terminal", "windows terminal", "windowsterminal", "iterm2", "iterm", "warp", "cursor", "visual studio code", "code"}
)
EDITOR_WORKSPACE_APPS: Final = frozenset({"cursor", "visual studio code", "code"})
DOCUMENT_EDITOR_DOMAINS: Final = (
    "overleaf.com",
    "docs.google.com",
    "slides.google.com",
    "sheets.google.com",
    "office.com",
)
DOCUMENT_EDITOR_APPS: Final = frozenset(
    {
        "microsoft powerpoint",
        "powerpoint",
        "powerpnt",
        "winword",
        "microsoft word",
        "word",
        "microsoft excel",
        "excel",
        "keynote",
        "pages",
        "numbers",
    }
)
CALENDAR_DOMAINS: Final = ("calendar.google.com", "outlook.office.com")
# Only surfaces whose title layout has been observed in real captures. Each one
# renders "<channel> - <workspace>" or "<folder> - <account> - <app>", which is
# what the parsers below assume. A surface with an unverified layout can put a
# person's name where a workspace belongs, so it stays out until it is measured.
COMMUNICATION_DOMAINS: Final = (
    "slack.com",
    "mail.google.com",
    "discord.com",
)
COMMUNICATION_APPS: Final = frozenset({"slack", "discord"})
TITLE_PART_RE: Final = re.compile(r"\s+(?:[-–—|·•])\s+")
BRACKET_LABEL_RE: Final = re.compile(r"\[([^\]]{1,80})\]")
TITLE_SUFFIX_VERSION_RE: Final = re.compile(r"\s+v?\d+(?:\.\d+)*$")
UNREAD_BADGE_RE: Final = re.compile(r"\s*\(\d+\)$")
# Slack/Gmail render unread counters inside the title ("받은편지함 (1,106)",
# "students(채널)"). They churn per segment and carry no context.
UNREAD_COUNT_RE: Final = re.compile(r"\s*\(\s*[\d,\.]+\s*\)\s*$")
SLACK_UNREAD_BADGE_RE: Final = re.compile(r"^\d+\s*(?:개의 새 항목|new items?)$", re.IGNORECASE)
SLACK_CHANNEL_SUFFIX_RE: Final = re.compile(r"\s*\((?:채널|channel)\)$", re.IGNORECASE)
SLACK_DM_SUFFIX_RE: Final = re.compile(r"\s*\((?:DM|디엠)\)$", re.IGNORECASE)
# Mail surfaces expose system folders; anything else in that slot is a thread subject.
MAIL_SYSTEM_FOLDERS: Final = frozenset(
    {
        "받은편지함",
        "보낸편지함",
        "스팸함",
        "휴지통",
        "임시보관함",
        "중요편지함",
        "전체보관함",
        "inbox",
        "sent",
        "spam",
        "trash",
        "drafts",
        "starred",
        "important",
        "all mail",
        "archive",
    }
)
MAIL_SURFACE_DOMAINS: Final = ("mail.google.com", "outlook.office.com")
MAIL_SURFACE_APPS: Final = frozenset({"mail", "gmail", "outlook", "microsoft outlook", "spark", "airmail"})
CHAT_APPS: Final = frozenset({"slack", "discord", "microsoft teams", "teams"})
COMMON_TITLE_SUFFIXES: Final = frozenset(
    {
        "arc",
        "aside",
        "brave browser",
        "calendar",
        "chrome",
        "discord",
        "figma",
        "github",
        "gitlab",
        "google calendar",
        "google chrome",
        "microsoft edge",
        "microsoft teams",
        "notion",
        "obsidian",
        "slack",
        "chatgpt",
        "claude",
        "gemini",
        "grok",
        "perplexity",
        "poe",
        "cmux",
        "cursor",
        "visual studio code",
        "code",
        "terminal",
        "microsoft powerpoint",
        "powerpoint",
        "microsoft word",
        "word",
        "microsoft excel",
        "excel",
        "keynote",
        "pages",
        "numbers",
    }
)
ISSUE_STATUSES: Final = ("In progress", "To do", "Todo", "Backlog", "Open", "Closed", "Done", "Blocked")
ISSUE_SECTIONS: Final = (
    "Reproduction",
    "Expected behavior",
    "Actual behavior",
    "Root cause",
    "Acceptance criteria",
    "Description",
)
MEETING_TYPES: Final = ("planning", "standup", "retro", "review", "demo", "interview", "sync", "1:1")
FIGMA_LAYER_TYPES: Final = ("frame", "component", "section", "page")
AI_GENERIC_TITLES: Final = frozenset(
    {
        "chatgpt",
        "chatgpt: chat, work, create & code with ai",
        "claude",
        "gemini",
        "gemini spark",
        "grok",
        "perplexity",
        "poe",
        "new chat",
        "새 채팅",
        "open codex",
    }
)
NATIVE_CHATGPT_NON_SESSION_TITLES: Final = frozenset(
    {
        "computer use controls",
        "codex pet composition surface",
        "drifty pet mode",
        "codex",
        "chatgpt",
    }
)
NATIVE_CHATGPT_TITLE_LEAK_MARKERS: Final = (
    " - discord",
    " | discord",
    " - youtube",
    " - slack",
    "비밀번호를 저장",
    "휴지통",
)
NATIVE_CHATGPT_BUNDLE_IDS: Final = frozenset({"com.openai.codex", "com.openai.chat"})

GENERIC_DEVELOPER_TITLES: Final = frozenset(
    {"cmux", "terminal", "cursor", "cursor agents", "visual studio code", "code", "shell", "zsh", "bash"}
)
GENERIC_DOCUMENT_TITLES: Final = frozenset(
    {
        "microsoft powerpoint",
        "powerpoint",
        "presentation1",
        "microsoft word",
        "word",
        "document1",
        "microsoft excel",
        "excel",
        "book1",
        "keynote",
        "pages",
        "numbers",
        "overleaf, online latex editor",
    }
)
SAFE_WORKSPACE_RE: Final = re.compile(r"^[\w][\w.@+\-]{0,79}$", re.UNICODE)
SAFE_EDITOR_WORKSPACE_RE: Final = re.compile(r"^[\w][\w .@+\-]{0,79}$", re.UNICODE)
COMMAND_LIKE_TITLE_RE: Final = re.compile(
    r"^(?:ssh|sudo|export|cd|git|npm|pnpm|yarn|python|python3|cargo|docker|kubectl|make)(?:\s|$)",
    re.IGNORECASE,
)
PRESENTER_VIEW_RE: Final = re.compile(
    r"^(?:PowerPoint\s+(?:Presenter View|발표자 보기))\s*[-–—|]\s*\[?(.+?)\]?\s*$",
    re.IGNORECASE,
)
DOCUMENT_EXTENSION_RE: Final = re.compile(
    r"\.(?:pptx?|docx?|xlsx?|key|pages|numbers|tex)$",
    re.IGNORECASE,
)


def domain_matches(domain: str | None, candidates: Sequence[str]) -> bool:
    if domain is None:
        return False
    normalized = domain.lower()
    return any(candidate in normalized for candidate in candidates)


def domain_exactly_matches(domain: str | None, candidates: Sequence[str]) -> bool:
    if domain is None:
        return False
    normalized = domain.casefold().split(":", 1)[0].removeprefix("www.").rstrip(".")
    return normalized in candidates


def atlassian_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    domain = (capture.site_domain or "").casefold().rstrip(".")
    return domain == "atlassian.net" or domain.endswith(".atlassian.net")


def document_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    if atlassian_surface_matches(capture):
        return url_path_parts(capture.site_url)[:1] == ["wiki"]
    return capture.app_name.casefold() in DOCUMENT_APPS or domain_matches(capture.site_domain, DOCUMENT_DOMAINS)


def calendar_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    if capture.app_name.casefold() == "calendar":
        return True
    if domain_exactly_matches(capture.site_domain, ("calendar.google.com",)):
        return True
    # Outlook shares its origin with mail and account screens. Only its calendar
    # route can contribute meeting metadata; a mail title can contain an account.
    return domain_exactly_matches(capture.site_domain, ("outlook.office.com",)) and url_path_parts(capture.site_url)[:1] == ["calendar"]


def is_native_chatgpt_capture(capture: AdaptiveContextCaptureInput) -> bool:
    return (capture.app_name or "").casefold() == "chatgpt" or (capture.bundle_id or "").casefold() in NATIVE_CHATGPT_BUNDLE_IDS


def native_chatgpt_session_title_usable(window_title: str | None) -> bool:
    title = (window_title or "").strip()
    if not title:
        return False
    lowered = title.casefold()
    if lowered in AI_GENERIC_TITLES or lowered in NATIVE_CHATGPT_NON_SESSION_TITLES:
        return False
    if any(marker in lowered for marker in NATIVE_CHATGPT_TITLE_LEAK_MARKERS):
        return False
    return True


def ai_conversation_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    # Native ChatGPT window titles are generic unless the session AX helper has
    # already replaced them with the Codex header thread/project.
    if is_native_chatgpt_capture(capture):
        return native_chatgpt_session_title_usable(capture.window_title)
    return domain_exactly_matches(capture.site_domain, AI_CONVERSATION_DOMAINS)


def developer_workspace_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    return capture.app_name.casefold() in DEVELOPER_WORKSPACE_APPS


def document_editor_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    return capture.app_name.casefold() in DOCUMENT_EDITOR_APPS or domain_exactly_matches(capture.site_domain, DOCUMENT_EDITOR_DOMAINS)


def url_path_parts(site_url: str | None) -> list[str]:
    if site_url is None:
        return []
    parsed = urlparse(site_url)
    return [part for part in parsed.path.split("/") if part]


def clean_context_values(values: Sequence[str] | None) -> list[str]:
    if values is None:
        return []
    cleaned_values: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = value.strip()
        if not cleaned:
            continue
        truncated = cleaned[:MAX_ADAPTIVE_VALUE_CHARS]
        # GitHub renders a label both in the title and the sidebar; keep one copy.
        if truncated in seen:
            continue
        seen.add(truncated)
        cleaned_values.append(truncated)
        if len(cleaned_values) >= MAX_ADAPTIVE_VALUES:
            break
    return cleaned_values


def add_structured_values(fields: AdaptiveStructuredFields, key: str, values: Sequence[str]) -> None:
    cleaned_values = clean_context_values(values)
    if cleaned_values:
        fields[key] = cleaned_values


def humanized_url_part(part: str) -> str:
    cleaned = unquote(part)
    cleaned = re.sub(r"[0-9a-fA-F]{16,}", "", cleaned)
    cleaned = cleaned.replace("_", " ").replace("-", " ")
    cleaned = " ".join(cleaned.split())
    return cleaned.strip()


def is_common_title_suffix(part: str) -> bool:
    lowered = part.lower()
    # App suffixes may carry a version, e.g. "Obsidian 1.12.7".
    return lowered in COMMON_TITLE_SUFFIXES or TITLE_SUFFIX_VERSION_RE.sub("", lowered) in COMMON_TITLE_SUFFIXES


def title_parts(capture: AdaptiveContextCaptureInput) -> list[str]:
    parts: list[str] = []
    for title in (capture.site_title, capture.window_title):
        if title is None:
            continue
        for part in TITLE_PART_RE.split(title):
            cleaned = part.strip()
            if cleaned and not is_common_title_suffix(cleaned):
                parts.append(cleaned)
    return clean_context_values(parts)


def title_values_containing(capture: AdaptiveContextCaptureInput) -> str:
    return " ".join(value for value in (capture.site_title, capture.window_title) if value)


def title_stem(capture: AdaptiveContextCaptureInput) -> str | None:
    parts = title_parts(capture)
    if parts:
        return parts[0]
    if capture.window_title:
        return Path(capture.window_title).stem
    return None


def path_markdown_file_from_title(window_title: str | None) -> str | None:
    if window_title is None:
        return None
    match = re.search(r"(/[^:]+?\.(?:md|markdown))", window_title)
    return str(Path(match.group(1)).expanduser()) if match else None


def slug_without_title(slug: str, title: str | None) -> str | None:
    humanized = humanized_url_part(slug)
    if not humanized:
        return None
    if title:
        pattern = re.compile(rf"\s*{re.escape(title)}\s*$", re.IGNORECASE)
        humanized = pattern.sub("", humanized).strip()
    return humanized or None


def document_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    parts = title_parts(capture)
    url_parts = url_path_parts(capture.site_url)
    if atlassian_surface_matches(capture):
        if "spaces" in url_parts:
            space_index = url_parts.index("spaces") + 1
            if space_index < len(url_parts):
                add_structured_values(fields, "workspace", [humanized_url_part(url_parts[space_index])])
        if parts:
            add_structured_values(fields, "headings", [parts[0]])
        return fields
    if url_parts:
        add_structured_values(fields, "workspace", [humanized_url_part(url_parts[0])])
    elif capture.app_name.casefold() in DOCUMENT_APPS and len(parts) >= 2:
        add_structured_values(fields, "workspace", [parts[-1]])
    if parts:
        add_structured_values(fields, "headings", [parts[0]])
    if capture.app_name.casefold() in DOCUMENT_APPS and not url_parts:
        if len(parts) >= 3:
            add_structured_values(fields, "parent_page", [parts[1]])
        if len(parts) >= 4:
            add_structured_values(fields, "database", [parts[2]])
        return fields
    if len(parts) >= 2:
        add_structured_values(fields, "parent_page", [parts[1]])
    if len(parts) >= 3:
        add_structured_values(fields, "database", [parts[2]])
    if "parent_page" not in fields and url_parts:
        parent = slug_without_title(url_parts[-1], title_stem(capture))
        if parent:
            add_structured_values(fields, "parent_page", [parent])
    return fields


def issue_type_from_url(site_url: str | None) -> str | None:
    parts = url_path_parts(site_url)
    if "issues" in parts:
        return "issue"
    if "pull" in parts or "merge_requests" in parts:
        return "pull_request"
    if any(part.lower() == "browse" for part in parts):
        return "issue"
    return None


def issue_repository_values(capture: AdaptiveContextCaptureInput) -> list[str]:
    parts = url_path_parts(capture.site_url)
    if len(parts) < 2 or parts[0].casefold() in NON_REPO_PATH_SEGMENTS:
        return []
    if domain_exactly_matches(capture.site_domain, ("github.com",)):
        return ["/".join(parts[:2])]
    if domain_exactly_matches(capture.site_domain, ("gitlab.com",)):
        return ["/".join(parts[:parts.index("-")])] if "-" in parts else ["/".join(parts[:2])]
    # Jira browse/project and Sentry organization paths do not identify a repo.
    return []


def issue_project_values(capture: AdaptiveContextCaptureInput) -> list[str]:
    if not (atlassian_surface_matches(capture) or domain_matches(capture.site_domain, ("jira",))):
        return []
    parts = url_path_parts(capture.site_url)
    if len(parts) >= 2 and parts[0] == "browse":
        match = re.fullmatch(r"([A-Za-z][A-Za-z0-9_]*)-\d+", parts[1])
        return [match.group(1).upper()] if match else []
    if "projects" in parts:
        project_index = parts.index("projects") + 1
        if project_index < len(parts) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", parts[project_index]):
            return [parts[project_index].upper()]
    return []


def issue_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    title_text = title_values_containing(capture)
    issue_type = issue_type_from_url(capture.site_url)
    if issue_type:
        add_structured_values(fields, "issue_type", [issue_type])
    labels: list[str] = []
    for match in BRACKET_LABEL_RE.finditer(title_text):
        labels.extend(part.strip() for part in match.group(1).split(","))
    add_structured_values(fields, "labels", labels)
    lower_title = title_text.lower()
    add_structured_values(fields, "status", [status for status in ISSUE_STATUSES if status.lower() in lower_title])
    add_structured_values(fields, "visible_sections", [section for section in ISSUE_SECTIONS if section.lower() in lower_title])
    return fields


def design_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    parts = title_parts(capture)
    url_parts = url_path_parts(capture.site_url)
    if len(parts) >= 2:
        add_structured_values(fields, "workspace", [parts[1]])
    elif url_parts:
        add_structured_values(fields, "workspace", [humanized_url_part(url_parts[-1])])
    if url_parts and url_parts[0] in {"file", "design", "proto", "board"}:
        add_structured_values(fields, "page_type", [url_parts[0]])
    elif capture.app_name.casefold() == "figma":
        add_structured_values(fields, "page_type", ["file"])
    lower_title = title_values_containing(capture).lower()
    add_structured_values(fields, "layer_type", [layer for layer in FIGMA_LAYER_TYPES if layer in lower_title])
    return fields


def ai_conversation_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    if not ai_conversation_surface_matches(capture):
        return fields

    parts = title_parts(capture)
    if is_native_chatgpt_capture(capture):
        if not native_chatgpt_session_title_usable(capture.window_title):
            return fields
        if parts:
            add_structured_values(fields, "thread", [parts[0]])
            if len(parts) >= 2:
                add_structured_values(fields, "workspace", [parts[1]])
        add_structured_values(fields, "conversation_type", ["chat"])
        return fields
    if parts and parts[0].casefold() not in AI_GENERIC_TITLES:
        add_structured_values(fields, "thread", [parts[0]])

    path_parts = [part.casefold() for part in url_path_parts(capture.site_url)]
    domain = (capture.site_domain or "").casefold().split(":", 1)[0].removeprefix("www.").rstrip(".")
    conversation_type: str | None = None
    if domain == "chatgpt.com":
        if "project" in path_parts or "projects" in path_parts:
            conversation_type = "project"
        elif "canvas" in path_parts:
            conversation_type = "canvas"
        elif "g" in path_parts or "gpts" in path_parts:
            conversation_type = "custom_gpt"
        elif "c" in path_parts:
            conversation_type = "chat"
    elif domain in {"claude.ai", "claude.com"}:
        if "project" in path_parts or "projects" in path_parts:
            conversation_type = "project"
        elif "chat" in path_parts:
            conversation_type = "chat"
    elif domain == "gemini.google.com" and "app" in path_parts:
        conversation_type = "chat"
    elif "chat" in path_parts:
        conversation_type = "chat"
    if conversation_type:
        add_structured_values(fields, "conversation_type", [conversation_type])
    return fields


def _path_workspace(title: str) -> str | None:
    expanded = title.strip()
    if re.fullmatch(r"[A-Za-z]:[\\/][^\n\r\t]+", expanded):
        candidate = PureWindowsPath(expanded).name
        return candidate if SAFE_WORKSPACE_RE.fullmatch(candidate) else None
    if not expanded.startswith(("/", "~/")) or any(character in expanded for character in ("\n", "\r", "\t")):
        return None
    candidate = expanded.rstrip("/").rsplit("/", 1)[-1]
    return candidate if SAFE_WORKSPACE_RE.fullmatch(candidate) else None


def developer_workspace_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    if not developer_workspace_surface_matches(capture):
        return fields
    title = (capture.window_title or capture.site_title or "").strip()
    if not title or title.casefold() in GENERIC_DEVELOPER_TITLES or COMMAND_LIKE_TITLE_RE.match(title):
        return fields

    app = capture.app_name.casefold()
    workspace: str | None = _path_workspace(title)
    if app == "cmux" and workspace is None and SAFE_WORKSPACE_RE.fullmatch(title):
        workspace = title
    elif app in EDITOR_WORKSPACE_APPS:
        parts = title_parts(capture)
        candidate = parts[-1] if len(parts) >= 2 else None
        if candidate and candidate.casefold() not in GENERIC_DEVELOPER_TITLES and SAFE_EDITOR_WORKSPACE_RE.fullmatch(candidate):
            workspace = candidate
    if workspace:
        add_structured_values(fields, "workspace", [workspace])
    return fields


def _document_type(capture: AdaptiveContextCaptureInput) -> str | None:
    app = capture.app_name.casefold()
    domain = (capture.site_domain or "").casefold()
    if app in {"microsoft powerpoint", "powerpoint", "powerpnt", "keynote"} or "slides.google.com" in domain:
        return "presentation"
    if app in {"microsoft excel", "excel", "numbers"} or "sheets.google.com" in domain:
        return "spreadsheet"
    if "overleaf.com" in domain:
        return "paper"
    if app in {"microsoft word", "word", "winword", "pages"} or "docs.google.com" in domain:
        return "document"
    return None


def document_editor_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    if not document_editor_surface_matches(capture):
        return fields

    raw_title = (capture.site_title or capture.window_title or "").strip()
    presenter_match = PRESENTER_VIEW_RE.match(raw_title)
    if presenter_match:
        document = presenter_match.group(1).strip().strip("[]")
    else:
        parts = title_parts(capture)
        document = parts[0] if parts else ""
    document = DOCUMENT_EXTENSION_RE.sub("", document).strip().strip("[]")
    if document and document.casefold() not in GENERIC_DOCUMENT_TITLES:
        add_structured_values(fields, "document", [document])
        document_type = _document_type(capture)
        if document_type:
            add_structured_values(fields, "document_type", [document_type])
    return fields


def calendar_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    if not calendar_surface_matches(capture):
        return fields
    # A calendar title slot may name an attendee/account rather than a workspace.
    # Only meeting shape is derived until a real container layout is measured.
    lower_title = title_values_containing(capture).lower()
    add_structured_values(fields, "meeting_type", [meeting for meeting in MEETING_TYPES if meeting in lower_title])
    return fields


def communication_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    # Unread-count badges such as "받은편지함 (843)" churn per segment without adding context.
    parts = [part for part in (UNREAD_BADGE_RE.sub("", raw).strip() for raw in title_parts(capture)) if part]
    parts = [UNREAD_COUNT_RE.sub("", part).strip() for part in parts]
    parts = [part for part in parts if part and not SLACK_UNREAD_BADGE_RE.match(part)]
    if not parts:
        return fields
    if is_mail_surface(capture):
        return mail_structured_fields(parts)
    return chat_structured_fields(parts)


def is_mail_surface(capture: AdaptiveContextCaptureInput) -> bool:
    # A chat app never renders a mail surface, and its channel names may mention mail.
    if capture.app_name.casefold() in CHAT_APPS:
        return False
    if domain_matches(capture.site_domain, MAIL_SURFACE_DOMAINS):
        return True
    if capture.app_name.casefold() in MAIL_SURFACE_APPS:
        return True
    # In a browser the app name is the browser, so fall back to the title suffix
    # ("... - Gmail"), which is the mail client's own trailing marker.
    trailing = title_parts(capture)
    return bool(trailing) and trailing[-1].casefold() in MAIL_SURFACE_APPS


def mail_structured_fields(parts: Sequence[str]) -> AdaptiveStructuredFields:
    """Mail titles read "<folder-or-subject> - <account> - Gmail".

    Only system folders are context. A non-folder value in that slot is a thread
    subject, and the account slot is a personal identifier; neither is retained.
    """
    fields: AdaptiveStructuredFields = {}
    folder = parts[0]
    if folder.casefold() in MAIL_SYSTEM_FOLDERS:
        add_structured_values(fields, "channel", [folder])
        add_structured_values(fields, "channel_type", ["folder"])
    else:
        add_structured_values(fields, "channel_type", ["thread"])
    return fields


def chat_structured_fields(parts: Sequence[str]) -> AdaptiveStructuredFields:
    """Slack/Discord titles read "<channel> - <workspace-or-server> - <app>".

    The second slot is the containing workspace/server, not a thread. DM peers are
    replaced by a type marker so a social graph never leaves the device.
    """
    fields: AdaptiveStructuredFields = {}
    raw_channel = parts[0]
    is_dm = raw_channel.startswith("@") or bool(SLACK_DM_SUFFIX_RE.search(raw_channel))
    if is_dm:
        add_structured_values(fields, "channel_type", ["dm"])
    else:
        channel = SLACK_CHANNEL_SUFFIX_RE.sub("", raw_channel).removeprefix("#").strip()
        if channel:
            add_structured_values(fields, "channel", [channel])
            add_structured_values(fields, "channel_type", ["channel"])
    if len(parts) >= 2:
        add_structured_values(fields, "workspace", [parts[1]])
    return fields
