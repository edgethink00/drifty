from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
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
    }
)
DOCUMENT_DOMAINS: Final = ("notion.so", "atlassian.net", "confluence", "coda.io")
DOCUMENT_APPS: Final = frozenset({"Notion"})
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
CALENDAR_DOMAINS: Final = ("calendar.google.com", "outlook.office.com")
COMMUNICATION_DOMAINS: Final = (
    "slack.com",
    "mail.google.com",
    "outlook.office.com",
    "teams.microsoft.com",
    "discord.com",
)
TITLE_PART_RE: Final = re.compile(r"\s+(?:[-–—|·•])\s+")
BRACKET_LABEL_RE: Final = re.compile(r"\[([^\]]{1,80})\]")
TITLE_SUFFIX_VERSION_RE: Final = re.compile(r"\s+v?\d+(?:\.\d+)*$")
UNREAD_BADGE_RE: Final = re.compile(r"\s*\(\d+\)$")
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


def domain_matches(domain: str | None, candidates: Sequence[str]) -> bool:
    if domain is None:
        return False
    normalized = domain.lower()
    return any(candidate in normalized for candidate in candidates)


def document_surface_matches(capture: AdaptiveContextCaptureInput) -> bool:
    return capture.app_name in DOCUMENT_APPS or domain_matches(capture.site_domain, DOCUMENT_DOMAINS)


def url_path_parts(site_url: str | None) -> list[str]:
    if site_url is None:
        return []
    parsed = urlparse(site_url)
    return [part for part in parsed.path.split("/") if part]


def clean_context_values(values: Sequence[str] | None) -> list[str]:
    if values is None:
        return []
    cleaned_values: list[str] = []
    for value in values:
        cleaned = value.strip()
        if not cleaned:
            continue
        cleaned_values.append(cleaned[:MAX_ADAPTIVE_VALUE_CHARS])
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
    if url_parts:
        add_structured_values(fields, "workspace", [humanized_url_part(url_parts[0])])
    elif capture.app_name in DOCUMENT_APPS and len(parts) >= 2:
        add_structured_values(fields, "workspace", [parts[-1]])
    if parts:
        add_structured_values(fields, "headings", [parts[0]])
    if capture.app_name in DOCUMENT_APPS and not url_parts:
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
    elif capture.app_name == "Figma":
        add_structured_values(fields, "page_type", ["file"])
    lower_title = title_values_containing(capture).lower()
    add_structured_values(fields, "layer_type", [layer for layer in FIGMA_LAYER_TYPES if layer in lower_title])
    return fields


def calendar_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    parts = title_parts(capture)
    if len(parts) >= 2:
        add_structured_values(fields, "workspace", [parts[1]])
    lower_title = title_values_containing(capture).lower()
    add_structured_values(fields, "meeting_type", [meeting for meeting in MEETING_TYPES if meeting in lower_title])
    return fields


def communication_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    # Unread-count badges such as "받은편지함 (843)" churn per segment without adding context.
    parts = [part for part in (UNREAD_BADGE_RE.sub("", raw).strip() for raw in title_parts(capture)) if part]
    if parts:
        add_structured_values(fields, "channel", [parts[0].removeprefix("#")])
    if len(parts) >= 2:
        add_structured_values(fields, "thread", [parts[1]])
    if len(parts) >= 3:
        add_structured_values(fields, "workspace", [parts[2]])
    return fields
