from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Final, Union

from app.storage.adaptive_context_serialization import (
    adaptive_content_context_from_mapping,
    sanitized_raw_context_json,
)
from app.tracker.browser_content import normalize_context
from app.tracker.macos_app_names import canonical_macos_app_name
from app.tracker.windows_app_names import canonical_windows_app_name

RowValue = Union[str, int, float, None]
SerializedValue = Union[str, int, float, bool, None, list["SerializedValue"], dict[str, "SerializedValue"]]

BROWSER_AUTOMATION_STATUSES: Final[frozenset[str]] = frozenset(
    {"granted", "denied", "unavailable", "stale", "empty_result", "not_applicable"}
)


def display_app_name(row: Mapping[str, RowValue]) -> RowValue:
    """Stored rows keep the name captured at the time. Segments recorded before
    a browser's name was canonicalized (for example `firefox` on macOS or `zen`
    on Windows) are shown under the canonical name so one app does not split
    into two rows."""
    app_name = row["app_name"]
    bundle_id = row.get("bundle_id")
    if not isinstance(app_name, str) or not isinstance(bundle_id, str):
        return app_name
    return canonical_windows_app_name(canonical_macos_app_name(app_name, bundle_id), bundle_id)


def serialize_activity_row(row: Mapping[str, RowValue]) -> dict[str, SerializedValue]:
    classification = classification_payload(row)
    hide_site_context = should_hide_uncertain_site_context(row)
    # Parse raw_context_json once per row: the per-key helpers each re-parse it,
    # which dominated serialization time on multi-day timeline queries.
    raw_context = raw_context_mapping(row)
    youtube_is_shorts = None
    if not hide_site_context and row.get("youtube_is_shorts") is not None:
        youtube_is_shorts = bool(row.get("youtube_is_shorts"))
    serialized: dict[str, SerializedValue] = {
        "id": str(row.get("id", "")),
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSeconds": row["duration_seconds"],
        "appName": display_app_name(row),
        "bundleId": row.get("bundle_id"),
        "windowTitle": row.get("window_title"),
        "siteDomain": None if hide_site_context else row.get("site_domain"),
        "siteTitle": None if hide_site_context else row.get("site_title"),
        "siteUrl": None if hide_site_context else row.get("site_url"),
        "youtubeVideoId": None if hide_site_context else row.get("youtube_video_id"),
        "youtubePlaylistId": None if hide_site_context else row.get("youtube_playlist_id"),
        "youtubeIsShorts": youtube_is_shorts,
        "youtubeCategory": row.get("youtube_category"),
        "youtubeChannelId": row.get("youtube_channel_id"),
        "youtubeChannelName": row.get("youtube_channel_name"),
        "youtubeTitle": row.get("youtube_title"),
        "youtubeDescription": row.get("youtube_description"),
        "youtubeKeywords": json_list(row.get("youtube_keywords_json")),
        "youtubeDurationSeconds": row.get("youtube_duration_seconds"),
        "youtubeViewCount": row.get("youtube_view_count"),
        "youtubeIsLive": bool(row.get("youtube_is_live")) if row.get("youtube_is_live") is not None else None,
        "youtubeIsUnlisted": bool(row.get("youtube_is_unlisted")) if row.get("youtube_is_unlisted") is not None else None,
        "youtubePublishDate": row.get("youtube_publish_date"),
        "youtubeUploadDate": row.get("youtube_upload_date"),
        "browserName": row.get("browser_name"),
        "siteSource": row.get("site_source"),
        "browserAutomationStatus": context_automation_status(raw_context),
        "browserAutomationError": context_text(raw_context, "browser_automation_error"),
        "browserHistoryStatus": context_text(raw_context, "browser_history_status"),
        "browserHistoryReason": context_text(raw_context, "browser_history_reason"),
        "browserHistoryDatabaseFound": context_bool(raw_context, "browser_history_database_found"),
        "browserHistoryProfileCount": context_int(raw_context, "browser_history_profile_count"),
        "browserHistoryCandidateCount": context_int(raw_context, "browser_history_candidate_count"),
        "browserHistoryErrorCount": context_int(raw_context, "browser_history_error_count"),
        "frontmostCaptureSource": context_text(raw_context, "frontmost_capture_source"),
        "frontmostCaptureError": context_text(raw_context, "frontmost_capture_error"),
        "frontmostFallbackError": context_text(raw_context, "frontmost_fallback_error"),
        "windowTitleSource": context_text(raw_context, "window_title_source"),
        "platform": row.get("platform", "macos"),
        "source": row.get("source", "unknown"),
        "confidence": row.get("confidence"),
        "deviceId": row.get("origin_device_id"),
        "exclusionSource": row.get("exclusion_source"),
    }
    engagement_evidence = row_engagement_evidence(row)
    if engagement_evidence is not None:
        serialized["engagementEvidence"] = engagement_evidence
    if classification is not None:
        serialized["classification"] = classification
    if raw_context is not None:
        browser_context = normalize_context(raw_context.get("browser_content_context"))
        if not hide_site_context and not row.get("exclusion_source") and browser_context is not None:
            serialized["browserContentContext"] = browser_context
        adaptive_context = adaptive_content_context_from_mapping(raw_context)
        if adaptive_context is not None:
            serialized["adaptiveContentContext"] = adaptive_context
    return serialized


def serialize_dashboard_week_activity_row(row: Mapping[str, RowValue]) -> dict[str, SerializedValue]:
    classification = dashboard_week_classification_payload(row)
    hide_site_context = should_hide_uncertain_site_context(row)
    serialized: dict[str, SerializedValue] = {
        "id": str(row.get("id", "")),
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSeconds": row["duration_seconds"],
        "appName": display_app_name(row),
        "platform": row.get("platform", "macos"),
        "source": row.get("source", "unknown"),
    }
    engagement_evidence = row_engagement_evidence(row)
    if engagement_evidence is not None:
        serialized["engagementEvidence"] = engagement_evidence
    optional_fields: dict[str, RowValue] = {
        "deviceId": row.get("origin_device_id"),
        "bundleId": row.get("bundle_id"),
        "browserName": row.get("browser_name"),
        "siteDomain": None if hide_site_context else row.get("site_domain"),
        "siteTitle": None if hide_site_context else row.get("site_title"),
        "siteUrl": None if hide_site_context else row.get("site_url"),
        "youtubeVideoId": None if hide_site_context else row.get("youtube_video_id"),
        "youtubePlaylistId": None if hide_site_context else row.get("youtube_playlist_id"),
        "youtubeCategory": row.get("youtube_category"),
        "youtubeChannelName": row.get("youtube_channel_name"),
        "youtubeTitle": row.get("youtube_title"),
        "exclusionSource": row.get("exclusion_source"),
    }
    for key, value in optional_fields.items():
        if value is not None and value != "":
            serialized[key] = value
    if not hide_site_context and row.get("youtube_is_shorts") is not None:
        serialized["youtubeIsShorts"] = bool(row.get("youtube_is_shorts"))
    if row.get("confidence") is not None:
        serialized["confidence"] = row.get("confidence")
    if classification is not None:
        serialized["classification"] = classification
    return serialized


def serialize_project_trend_activity_row(row: Mapping[str, RowValue]) -> dict[str, SerializedValue]:
    """Minimal row for the Projects tab trend chart: identity, device, timing, and the
    app/site labels its detail view aggregates on. Everything else the full
    timeline serializer emits is unused there and would only inflate the
    multi-day payload."""
    serialized: dict[str, SerializedValue] = {
        "id": str(row.get("id", "")),
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSeconds": row["duration_seconds"],
        "appName": display_app_name(row),
        "platform": row.get("platform") or "macos",
        "source": row.get("source") or "unknown",
    }
    device_id = row.get("origin_device_id")
    if device_id:
        serialized["deviceId"] = device_id
    bundle_id = row.get("bundle_id")
    if bundle_id:
        serialized["bundleId"] = bundle_id
    site_domain = row.get("site_domain")
    if site_domain and not should_hide_uncertain_site_context(row):
        serialized["siteDomain"] = site_domain
    return serialized


def should_hide_uncertain_site_context(row: Mapping[str, RowValue]) -> bool:
    if row.get("site_source") != "applescript-front-window":
        return False
    window_title = clean_text(row.get("window_title"))
    site_title = clean_text(row.get("site_title"))
    if not window_title or not site_title:
        return True
    return not titles_match(window_title, site_title)


def titles_match(window_title: str, site_title: str) -> bool:
    window = window_title.lower()
    site = site_title.lower()
    return window.startswith(site) or site.startswith(window)


def clean_text(value: RowValue) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def row_engagement_evidence(row: Mapping[str, RowValue]) -> str | None:
    value = row.get("engagement_evidence")
    return value if value == "foreground-audio" else None


def classification_payload(row: Mapping[str, RowValue]) -> dict[str, SerializedValue] | None:
    if not row.get("classification_category"):
        return None

    classification: dict[str, SerializedValue] = {
        "category": row.get("classification_category"),
        "productivity": row.get("classification_productivity"),
        "source": row.get("classification_source") or "unknown",
        "confidence": row.get("classification_confidence") or 0,
        "reason": row.get("classification_reason"),
        "model": row.get("classification_model"),
        "promptVersion": row.get("classification_prompt_version"),
        "taxonomyVersion": row.get("classification_taxonomy_version"),
        "inputFingerprint": row.get("classification_input_fingerprint"),
        "classifiedAt": row.get("classification_classified_at"),
        "aiResult": bool(row.get("classification_ai_result")),
        "stale": bool(row.get("classification_stale")),
        "classificationRuleId": row.get("classification_rule_id"),
        "reusedAiResult": bool(row.get("classification_ai_result"))
        and (row.get("classification_source") or "") == "llm"
        and row.get("classification_request_id") is None
        and row.get("classification_latency_ms") is None,
    }
    if (
        row.get("classification_source") == "rule"
        and row.get("classification_rule_snapshot_kind") == "synced-rule"
    ):
        classification["ruleSnapshotKind"] = "synced-rule"
    return classification


def dashboard_week_classification_payload(row: Mapping[str, RowValue]) -> dict[str, SerializedValue] | None:
    if not row.get("classification_category"):
        return None

    classification: dict[str, SerializedValue] = {
        "category": row.get("classification_category"),
        "productivity": row.get("classification_productivity"),
        "source": row.get("classification_source") or "unknown",
        "confidence": row.get("classification_confidence") or 0,
        "aiResult": bool(row.get("classification_ai_result")),
        "stale": bool(row.get("classification_stale")),
    }
    if row.get("classification_rule_id"):
        classification["classificationRuleId"] = row.get("classification_rule_id")
    if (
        row.get("classification_source") == "rule"
        and row.get("classification_rule_snapshot_kind") == "synced-rule"
    ):
        classification["ruleSnapshotKind"] = "synced-rule"
    return classification


def browser_automation_status(row: Mapping[str, RowValue]) -> str | None:
    return context_automation_status(raw_context_mapping(row))


def context_automation_status(parsed: Mapping[str, SerializedValue] | None) -> str | None:
    status = context_text(parsed, "browser_automation_status")
    if status not in BROWSER_AUTOMATION_STATUSES:
        return None
    return status


def raw_context_text(row: Mapping[str, RowValue], key: str) -> str | None:
    return context_text(raw_context_mapping(row), key)


def context_text(parsed: Mapping[str, SerializedValue] | None, key: str) -> str | None:
    if parsed is None:
        return None

    value = parsed.get(key)
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def raw_context_bool(row: Mapping[str, RowValue], key: str) -> bool | None:
    return context_bool(raw_context_mapping(row), key)


def context_bool(parsed: Mapping[str, SerializedValue] | None, key: str) -> bool | None:
    if parsed is None:
        return None

    value = parsed.get(key)
    return value if isinstance(value, bool) else None


def raw_context_int(row: Mapping[str, RowValue], key: str) -> int | None:
    return context_int(raw_context_mapping(row), key)


def context_int(parsed: Mapping[str, SerializedValue] | None, key: str) -> int | None:
    if parsed is None:
        return None

    value = parsed.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def raw_context_mapping(row: Mapping[str, RowValue]) -> dict[str, SerializedValue] | None:
    raw_context = row.get("raw_context_json")
    if not isinstance(raw_context, str) or not raw_context:
        return None
    try:
        parsed = json.loads(raw_context)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def json_list(value: RowValue) -> list[str] | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None
    items = [item for item in parsed if isinstance(item, str)]
    return items or None
