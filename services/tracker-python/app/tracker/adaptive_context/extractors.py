from __future__ import annotations

from collections.abc import Sequence

from app.tracker.adaptive_context.markdown import (
    bounded_markdown_text,
    markdown_file_path,
    markdown_frontmatter_tags,
    markdown_headings,
)
from app.tracker.adaptive_context.normalization import (
    BODY_LIKE_STRUCTURED_KEYS,
    AI_CONVERSATION_DOMAINS,
    COMMUNICATION_APPS,
    COMMUNICATION_DOMAINS,
    DESIGN_DOMAINS,
    DEVELOPER_WORKSPACE_APPS,
    DOCUMENT_EDITOR_APPS,
    DOCUMENT_EDITOR_DOMAINS,
    ISSUE_DOMAINS,
    calendar_surface_matches,
    atlassian_surface_matches,
    issue_repository_values,
    issue_project_values,
    calendar_structured_fields,
    ai_conversation_structured_fields,
    clean_context_values,
    communication_structured_fields,
    design_structured_fields,
    developer_workspace_structured_fields,
    document_editor_structured_fields,
    document_surface_matches,
    document_structured_fields,
    domain_matches,
    domain_exactly_matches,
    issue_structured_fields,
    path_markdown_file_from_title,
    title_parts,
    url_path_parts,
)
from app.tracker.adaptive_context.settings import (
    MAX_ADAPTIVE_ITEMS,
    MAX_ADAPTIVE_VALUE_CHARS,
    adaptive_context_capture_enabled,
    enabled_adaptive_source_families,
)
from app.tracker.adaptive_context.types import (
    AdaptiveContentContextPayload,
    AdaptiveContextCaptureInput,
    AdaptiveContextItemPayload,
    AdaptiveStructuredFields,
)


def merge_structured_fields(
    current: AdaptiveStructuredFields | None,
    derived: AdaptiveStructuredFields,
) -> AdaptiveStructuredFields | None:
    merged: AdaptiveStructuredFields = dict(current) if current is not None else {}
    for key, values in derived.items():
        if key in merged or key in BODY_LIKE_STRUCTURED_KEYS:
            continue
        merged[key] = values
    return merged or None


def derived_structured_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveStructuredFields:
    fields: AdaptiveStructuredFields = {}
    if document_surface_matches(capture):
        fields = merge_structured_fields(fields, document_structured_fields(capture)) or fields
    if domain_matches(capture.site_domain, ISSUE_DOMAINS):
        fields = merge_structured_fields(fields, issue_structured_fields(capture)) or fields
    if capture.app_name.casefold() == "figma" or domain_matches(capture.site_domain, DESIGN_DOMAINS):
        fields = merge_structured_fields(fields, design_structured_fields(capture)) or fields
    if calendar_surface_matches(capture):
        fields = merge_structured_fields(fields, calendar_structured_fields(capture)) or fields
    if capture.app_name.casefold() in COMMUNICATION_APPS or domain_matches(capture.site_domain, COMMUNICATION_DOMAINS):
        fields = merge_structured_fields(fields, communication_structured_fields(capture)) or fields
    if domain_exactly_matches(capture.site_domain, AI_CONVERSATION_DOMAINS) or (capture.app_name or "").casefold() == "chatgpt" or (capture.bundle_id or "").casefold() in {"com.openai.codex", "com.openai.chat"}:
        fields = merge_structured_fields(fields, ai_conversation_structured_fields(capture)) or fields
    if capture.app_name.casefold() in DEVELOPER_WORKSPACE_APPS:
        fields = merge_structured_fields(fields, developer_workspace_structured_fields(capture)) or fields
    if capture.app_name.casefold() in DOCUMENT_EDITOR_APPS or domain_exactly_matches(capture.site_domain, DOCUMENT_EDITOR_DOMAINS):
        fields = merge_structured_fields(fields, document_editor_structured_fields(capture)) or fields
    return fields


def capture_with_metadata_fields(capture: AdaptiveContextCaptureInput) -> AdaptiveContextCaptureInput:
    return AdaptiveContextCaptureInput(
        observed_at=capture.observed_at,
        app_name=capture.app_name,
        bundle_id=capture.bundle_id,
        window_title=capture.window_title,
        browser_name=capture.browser_name,
        site_domain=capture.site_domain,
        site_title=capture.site_title,
        site_url=capture.site_url,
        active_file_path=capture.active_file_path or path_markdown_file_from_title(capture.window_title),
        allow_local_file_read=capture.allow_local_file_read,
        structured_fields=merge_structured_fields(capture.structured_fields, derived_structured_fields(capture)),
    )


def structured_values(structured_fields: AdaptiveStructuredFields | None, key: str) -> list[str]:
    if structured_fields is None or key in BODY_LIKE_STRUCTURED_KEYS:
        return []
    return clean_context_values(structured_fields.get(key))


def adaptive_item(
    item_id: str,
    depth: int,
    kind: str,
    source_family: str,
    values: Sequence[str] | None,
    provider_policy: str,
) -> AdaptiveContextItemPayload | None:
    cleaned_values = clean_context_values(values)
    if not cleaned_values:
        return None
    return {
        "id": item_id,
        "depth": depth,
        "kind": kind,
        "sourceFamily": source_family,
        "values": cleaned_values,
        "extractionConfidence": "medium",
        "localStorage": "stored_local",
        "providerPolicy": provider_policy,
        "sensitivity": [],
    }


def append_adaptive_item(items: list[AdaptiveContextItemPayload], item: AdaptiveContextItemPayload | None) -> None:
    if item is None or len(items) >= MAX_ADAPTIVE_ITEMS:
        return
    items.append(item)


def adaptive_context_payload(
    capture: AdaptiveContextCaptureInput,
    items: list[AdaptiveContextItemPayload],
) -> AdaptiveContentContextPayload | None:
    if not items:
        return None
    segment_id = "|".join(
        value
        for value in (capture.observed_at, capture.app_name, capture.window_title or capture.site_url or "")
        if value
    )
    return {
        "version": 1,
        "segmentId": segment_id[:MAX_ADAPTIVE_VALUE_CHARS],
        "collectedAt": capture.observed_at,
        "items": items[:MAX_ADAPTIVE_ITEMS],
        "localStorage": "stored_local",
    }


def append_field_item(
    items: list[AdaptiveContextItemPayload],
    source_family: str,
    item_spec: tuple[str, int, str, str, str],
    fields: AdaptiveStructuredFields | None,
) -> None:
    item_id, depth, kind, field_key, provider_policy = item_spec
    append_adaptive_item(items, adaptive_item(item_id, depth, kind, source_family, structured_values(fields, field_key), provider_policy))


def document_knowledge_items(capture: AdaptiveContextCaptureInput) -> list[AdaptiveContextItemPayload]:
    if not document_surface_matches(capture):
        return []

    fields = capture.structured_fields
    items: list[AdaptiveContextItemPayload] = []
    source_family = "document_knowledge"
    for item_spec in (
        ("document_knowledge:workspace", 1, "workspace", "workspace", "metadata_only"),
        ("document_knowledge:tag", 2, "tag", "tags", "metadata_only"),
        ("document_knowledge:status", 2, "status", "status", "metadata_only"),
        ("document_knowledge:heading", 2, "heading", "headings", "metadata_only"),
    ):
        append_field_item(items, source_family, item_spec, fields)
    parent_values = structured_values(fields, "parent_page") or structured_values(fields, "breadcrumb")
    append_adaptive_item(items, adaptive_item("document_knowledge:parentPage", 1, "parentPage", source_family, parent_values, "metadata_only"))
    database_values = structured_values(fields, "database")
    if not database_values and not atlassian_surface_matches(capture):
        parts = url_path_parts(capture.site_url)
        database_values = [parts[0].replace("-", " ")] if parts else []
    append_adaptive_item(items, adaptive_item("document_knowledge:database", 1, "database", source_family, database_values, "metadata_only"))
    return items


def local_markdown_items(capture: AdaptiveContextCaptureInput) -> list[AdaptiveContextItemPayload]:
    path = markdown_file_path(capture) if capture.allow_local_file_read else None
    if path is None and capture.app_name.casefold() != "obsidian":
        return []

    markdown_text = bounded_markdown_text(path) if capture.allow_local_file_read else ""
    title_context = title_parts(capture) if path is None else []
    source_family = "local_notes_markdown"
    items: list[AdaptiveContextItemPayload] = []
    parents = list(path.parents) if path is not None else []
    project_values = [parents[1].name] if len(parents) > 1 else title_context[2:3]
    folder_values = [parents[0].name] if parents else title_context[1:2]
    heading_values = markdown_headings(markdown_text) if path is not None else title_context[:1]
    for item_id, depth, kind, values in (
        ("local_notes_markdown:project", 1, "project", project_values),
        ("local_notes_markdown:folder", 1, "folder", folder_values),
        ("local_notes_markdown:tag", 2, "tag", markdown_frontmatter_tags(markdown_text)),
        ("local_notes_markdown:heading", 2, "heading", heading_values),
    ):
        append_adaptive_item(items, adaptive_item(item_id, depth, kind, source_family, values, "metadata_only"))
    return items


def issue_tool_items(capture: AdaptiveContextCaptureInput) -> list[AdaptiveContextItemPayload]:
    if not domain_matches(capture.site_domain, ISSUE_DOMAINS):
        return []

    fields = capture.structured_fields
    repo_values = issue_repository_values(capture)
    source_family = "work_tracker_dev_platform"
    items: list[AdaptiveContextItemPayload] = []
    append_adaptive_item(items, adaptive_item("work_tracker_dev_platform:repo", 1, "repo", source_family, repo_values, "metadata_only"))
    append_adaptive_item(items, adaptive_item("work_tracker_dev_platform:project", 1, "project", source_family, issue_project_values(capture), "metadata_only"))
    for item_spec in (
        ("work_tracker_dev_platform:issueType", 2, "issueType", "issue_type", "metadata_only"),
        ("work_tracker_dev_platform:label", 2, "label", "labels", "metadata_only"),
        ("work_tracker_dev_platform:status", 2, "status", "status", "metadata_only"),
    ):
        append_field_item(items, source_family, item_spec, fields)
    section_values = structured_values(fields, "visible_sections") or structured_values(fields, "headings")
    append_adaptive_item(
        items,
        adaptive_item("work_tracker_dev_platform:visibleSection", 2, "visibleSection", source_family, section_values, "metadata_only"),
    )
    return items


def metadata_only_items(
    capture: AdaptiveContextCaptureInput,
    source_family: str,
    provider_policy: str,
) -> list[AdaptiveContextItemPayload]:
    fields = capture.structured_fields
    items: list[AdaptiveContextItemPayload] = []
    for field_key, kind, depth in (
        ("workspace", "workspace", 1),
        ("page_type", "pageType", 2),
        ("layer_type", "layerType", 2),
        ("meeting_type", "meetingType", 2),
        ("attendee_count_range", "attendeeCountRange", 2),
        ("channel", "channel", 1),
        ("thread", "thread", 1),
        ("channel_type", "channelType", 2),
    ):
        append_adaptive_item(
            items,
            adaptive_item(f"{source_family}:{kind}", depth, kind, source_family, structured_values(fields, field_key), provider_policy),
        )
    return items


def selected_metadata_items(
    capture: AdaptiveContextCaptureInput,
    source_family: str,
    item_specs: Sequence[tuple[str, int, str]],
) -> list[AdaptiveContextItemPayload]:
    items: list[AdaptiveContextItemPayload] = []
    for field_key, depth, kind in item_specs:
        append_adaptive_item(
            items,
            adaptive_item(
                f"{source_family}:{kind}",
                depth,
                kind,
                source_family,
                structured_values(capture.structured_fields, field_key),
                "metadata_only",
            ),
        )
    return items


def adaptive_content_context_for_capture(capture: AdaptiveContextCaptureInput) -> AdaptiveContentContextPayload | None:
    if not adaptive_context_capture_enabled():
        return None

    capture = capture_with_metadata_fields(capture)
    enabled_families = enabled_adaptive_source_families()
    items: list[AdaptiveContextItemPayload] = []
    if "document_knowledge" in enabled_families:
        items.extend(document_knowledge_items(capture))
    if "local_notes_markdown" in enabled_families:
        items.extend(local_markdown_items(capture))
    if "work_tracker_dev_platform" in enabled_families:
        items.extend(issue_tool_items(capture))
    if "design_dev_tool" in enabled_families and (capture.app_name.casefold() == "figma" or domain_matches(capture.site_domain, DESIGN_DOMAINS)):
        items.extend(metadata_only_items(capture, "design_dev_tool", "metadata_only"))
    if "calendar_meeting" in enabled_families and (calendar_surface_matches(capture)):
        items.extend(metadata_only_items(capture, "calendar_meeting", "metadata_only"))
    if "communication_metadata" in enabled_families and (
        capture.app_name.casefold() in COMMUNICATION_APPS or domain_matches(capture.site_domain, COMMUNICATION_DOMAINS)
    ):
        items.extend(metadata_only_items(capture, "communication_metadata", "metadata_only"))
    if "ai_conversation" in enabled_families and (
        domain_exactly_matches(capture.site_domain, AI_CONVERSATION_DOMAINS)
        or (capture.app_name or "").casefold() == "chatgpt"
        or (capture.bundle_id or "").casefold() in {"com.openai.codex", "com.openai.chat"}
    ):
        items.extend(selected_metadata_items(capture, "ai_conversation", (
            ("workspace", 1, "workspace"),
            ("thread", 1, "thread"),
            ("conversation_type", 2, "conversationType"),
        )))
    if "developer_workspace" in enabled_families and capture.app_name.casefold() in DEVELOPER_WORKSPACE_APPS:
        items.extend(selected_metadata_items(capture, "developer_workspace", (
            ("workspace", 1, "workspace"),
            ("project", 1, "project"),
            ("repo", 1, "repo"),
        )))
    if "document_editor" in enabled_families and (
        capture.app_name.casefold() in DOCUMENT_EDITOR_APPS or domain_exactly_matches(capture.site_domain, DOCUMENT_EDITOR_DOMAINS)
    ):
        items.extend(selected_metadata_items(capture, "document_editor", (
            ("workspace", 1, "workspace"),
            ("document", 1, "document"),
            ("document_type", 2, "documentType"),
        )))
    return adaptive_context_payload(capture, items)
