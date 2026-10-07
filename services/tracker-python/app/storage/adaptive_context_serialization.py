from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Union

from app.tracker.browser_content import normalize_context
from app.storage.adaptive_context_serialization_rules import (
    ADAPTIVE_CONTEXT_DEPTHS,
    ADAPTIVE_CONTEXT_ITEM_KINDS,
    ADAPTIVE_CONTEXT_RAW_KEYS,
    ADAPTIVE_CONTEXT_SOURCE_FAMILIES,
    ADAPTIVE_EXTRACTION_CONFIDENCES,
    ADAPTIVE_LOCAL_STORAGE_STATUSES,
    ADAPTIVE_PROVIDER_POLICIES,
    ADAPTIVE_SENSITIVITY_FLAGS,
    BODY_LIKE_CONTEXT_KEYS,
    MAX_ADAPTIVE_CONTEXT_ITEMS,
    MAX_ADAPTIVE_CONTEXT_VALUE_CHARS,
    MAX_ADAPTIVE_CONTEXT_VALUES,
    MESSAGE_BODY_PLACEHOLDER,
)

SerializedValue = Union[str, int, float, bool, None, list["SerializedValue"], dict[str, "SerializedValue"]]


def adaptive_content_context_from_mapping(
    raw_context: Mapping[str, SerializedValue],
) -> dict[str, SerializedValue] | None:
    raw_adaptive_context = raw_adaptive_context_value(raw_context)
    if not isinstance(raw_adaptive_context, dict):
        return None

    version = raw_adaptive_context.get("version")
    segment_id = cleaned_mapping_text(raw_adaptive_context, "segmentId")
    collected_at = cleaned_mapping_text(raw_adaptive_context, "collectedAt")
    local_storage = enum_mapping_text(
        raw_adaptive_context,
        "localStorage",
        ADAPTIVE_LOCAL_STORAGE_STATUSES,
    )
    raw_items = raw_adaptive_context.get("items")
    if version != 1 or segment_id is None or collected_at is None or local_storage is None:
        return None
    if not isinstance(raw_items, list):
        return None

    items: list[SerializedValue] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        item = adaptive_context_item(raw_item)
        if item is not None:
            items.append(item)
        if len(items) >= MAX_ADAPTIVE_CONTEXT_ITEMS:
            break
    if not items:
        return None

    return {
        "version": 1,
        "segmentId": segment_id,
        "collectedAt": collected_at,
        "items": items,
        "localStorage": local_storage,
    }


def sanitized_raw_context_json(raw_context_json: str | None) -> str | None:
    if not raw_context_json:
        return raw_context_json
    try:
        parsed = json.loads(raw_context_json)
    except json.JSONDecodeError:
        return raw_context_json
    if not isinstance(parsed, dict):
        return raw_context_json

    has_context_key = any(key in parsed for key in ADAPTIVE_CONTEXT_RAW_KEYS)
    has_body_like_key = any(key in parsed for key in BODY_LIKE_CONTEXT_KEYS)
    has_browser_context = "browser_content_context" in parsed or "browserContentContext" in parsed
    if not has_context_key and not has_body_like_key and not has_browser_context:
        return raw_context_json

    sanitized: dict[str, SerializedValue] = {
        key: value
        for key, value in parsed.items()
        if isinstance(key, str) and key not in BODY_LIKE_CONTEXT_KEYS and key not in ADAPTIVE_CONTEXT_RAW_KEYS and key not in {"browser_content_context", "browserContentContext"}
    }
    browser_context = normalize_context(parsed.get("browser_content_context", parsed.get("browserContentContext")))
    if browser_context is not None:
        sanitized["browser_content_context"] = browser_context
    adaptive_context = adaptive_content_context_from_mapping(parsed)
    if adaptive_context is not None:
        sanitized["adaptive_content_context"] = adaptive_context
    return json.dumps(sanitized)


def raw_adaptive_context_value(raw_context: Mapping[str, SerializedValue]) -> SerializedValue:
    for key in ADAPTIVE_CONTEXT_RAW_KEYS:
        if key in raw_context:
            return raw_context[key]
    return None


def adaptive_context_item(raw_item: Mapping[str, SerializedValue]) -> dict[str, SerializedValue] | None:
    item_id = cleaned_mapping_text(raw_item, "id")
    source_family = enum_mapping_text(raw_item, "sourceFamily", ADAPTIVE_CONTEXT_SOURCE_FAMILIES)
    extraction_confidence = enum_mapping_text(
        raw_item,
        "extractionConfidence",
        ADAPTIVE_EXTRACTION_CONFIDENCES,
    )
    local_storage = enum_mapping_text(raw_item, "localStorage", ADAPTIVE_LOCAL_STORAGE_STATUSES)
    provider_policy = enum_mapping_text(raw_item, "providerPolicy", ADAPTIVE_PROVIDER_POLICIES)
    depth = raw_item.get("depth")
    kind = enum_mapping_text(raw_item, "kind", ADAPTIVE_CONTEXT_ITEM_KINDS)
    values = bounded_string_list(raw_item.get("values"))
    sensitivity = enum_string_list(raw_item.get("sensitivity"), ADAPTIVE_SENSITIVITY_FLAGS)
    if kind == "messageBody":
        if provider_policy not in {"blocked", "local_only"} or values is None:
            return None
        values = [MESSAGE_BODY_PLACEHOLDER]
        if "message_body" not in sensitivity:
            sensitivity.append("message_body")
    if (
        item_id is None
        or not isinstance(depth, int)
        or isinstance(depth, bool)
        or depth not in ADAPTIVE_CONTEXT_DEPTHS
        or kind is None
        or source_family is None
        or extraction_confidence is None
        or local_storage is None
        or provider_policy is None
        or values is None
    ):
        return None
    return {
        "id": item_id,
        "depth": depth,
        "kind": kind,
        "sourceFamily": source_family,
        "values": values,
        "extractionConfidence": extraction_confidence,
        "localStorage": local_storage,
        "providerPolicy": provider_policy,
        "sensitivity": sensitivity,
    }


def cleaned_mapping_text(raw_mapping: Mapping[str, SerializedValue], key: str) -> str | None:
    value = raw_mapping.get(key)
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def enum_mapping_text(
    raw_mapping: Mapping[str, SerializedValue],
    key: str,
    allowed_values: frozenset[str],
) -> str | None:
    value = cleaned_mapping_text(raw_mapping, key)
    if value not in allowed_values:
        return None
    return value


def bounded_string_list(value: SerializedValue) -> list[SerializedValue] | None:
    if not isinstance(value, list):
        return None
    values: list[SerializedValue] = []
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()
        if not cleaned:
            continue
        values.append(cleaned[:MAX_ADAPTIVE_CONTEXT_VALUE_CHARS])
        if len(values) >= MAX_ADAPTIVE_CONTEXT_VALUES:
            break
    return values or None


def enum_string_list(value: SerializedValue, allowed_values: frozenset[str]) -> list[SerializedValue]:
    if not isinstance(value, list):
        return []
    values: list[SerializedValue] = []
    for item in value:
        if isinstance(item, str) and item in allowed_values:
            values.append(item)
    return values
