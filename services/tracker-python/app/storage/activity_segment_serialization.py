from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Final, Union

RowValue = Union[str, int, float, None]
SerializedValue = Union[str, int, float, bool, None, list[str], dict[str, "SerializedValue"]]

BROWSER_AUTOMATION_STATUSES: Final[frozenset[str]] = frozenset(
    {"granted", "denied", "unavailable", "stale", "empty_result", "not_applicable"}
)


def serialize_activity_row(row: Mapping[str, RowValue]) -> dict[str, SerializedValue]:
    classification = classification_payload(row)
    hide_site_context = should_hide_uncertain_site_context(row)
    youtube_is_shorts = None
    if not hide_site_context and row.get("youtube_is_shorts") is not None:
        youtube_is_shorts = bool(row.get("youtube_is_shorts"))
    serialized: dict[str, SerializedValue] = {
        "id": str(row.get("id", "")),
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSeconds": row["duration_seconds"],
        "appName": row["app_name"],
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
        "browserAutomationStatus": browser_automation_status(row),
        "browserAutomationError": raw_context_text(row, "browser_automation_error"),
        "browserHistoryStatus": raw_context_text(row, "browser_history_status"),
        "browserHistoryReason": raw_context_text(row, "browser_history_reason"),
        "browserHistoryDatabaseFound": raw_context_bool(row, "browser_history_database_found"),
        "browserHistoryProfileCount": raw_context_int(row, "browser_history_profile_count"),
        "browserHistoryCandidateCount": raw_context_int(row, "browser_history_candidate_count"),
        "browserHistoryErrorCount": raw_context_int(row, "browser_history_error_count"),
        "frontmostCaptureSource": raw_context_text(row, "frontmost_capture_source"),
        "frontmostCaptureError": raw_context_text(row, "frontmost_capture_error"),
        "frontmostFallbackError": raw_context_text(row, "frontmost_fallback_error"),
        "platform": row.get("platform", "macos"),
        "source": row.get("source", "unknown"),
        "confidence": row.get("confidence"),
        "deviceId": row.get("origin_device_id"),
    }
    if classification is not None:
        serialized["classification"] = classification
    return serialized


def serialize_dashboard_week_activity_row(row: Mapping[str, RowValue]) -> dict[str, SerializedValue]:
    classification = dashboard_week_classification_payload(row)
    hide_site_context = should_hide_uncertain_site_context(row)
    serialized: dict[str, SerializedValue] = {
        "id": str(row.get("id", "")),
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSeconds": row["duration_seconds"],
        "appName": row["app_name"],
        "platform": row.get("platform", "macos"),
        "source": row.get("source", "unknown"),
    }
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


def classification_payload(row: Mapping[str, RowValue]) -> dict[str, SerializedValue] | None:
    if not row.get("classification_category"):
        return None

    return {
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
    return classification


def browser_automation_status(row: Mapping[str, RowValue]) -> str | None:
    status = raw_context_text(row, "browser_automation_status")
    if status not in BROWSER_AUTOMATION_STATUSES:
        return None
    return status


def raw_context_text(row: Mapping[str, RowValue], key: str) -> str | None:
    parsed = raw_context_mapping(row)
    if parsed is None:
        return None

    value = parsed.get(key)
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def raw_context_bool(row: Mapping[str, RowValue], key: str) -> bool | None:
    parsed = raw_context_mapping(row)
    if parsed is None:
        return None

    value = parsed.get(key)
    return value if isinstance(value, bool) else None


def raw_context_int(row: Mapping[str, RowValue], key: str) -> int | None:
    parsed = raw_context_mapping(row)
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
