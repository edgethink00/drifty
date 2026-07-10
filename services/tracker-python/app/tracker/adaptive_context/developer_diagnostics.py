from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Final, TypedDict

from app.storage.db import TrackerDatabase
from app.tracker.adaptive_context.settings import (
    ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV,
    ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV,
    SUPPORTED_ADAPTIVE_SOURCE_FAMILIES,
)

JsonValue = object
JsonObject = dict[str, JsonValue]

FORCE_CHROMIUM_AX_CAPTURE_META_KEY: Final = "developer_diagnostics_force_chromium_ax_capture"
FORCE_CHROMIUM_AX_CAPTURE_ENV: Final = "DRIFTY_FORCE_CHROMIUM_AX_CAPTURE"
FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY: Final = "developer_diagnostics_force_frontmost_fallback_capture"
FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: Final = "DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE"
FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY: Final = "developer_diagnostics_force_browser_history_url_fallback"
FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV: Final = "DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK"
ENHANCED_CONTEXT_ENABLED_META_KEY: Final = "developer_diagnostics_enhanced_context_enabled"
ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY: Final = "developer_diagnostics_enhanced_context_capture_local"
ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY: Final = "developer_diagnostics_enhanced_context_source_families"


class DeveloperDiagnosticsResponse(TypedDict):
    forceChromiumAxCapture: bool
    forceFrontmostFallbackCapture: bool
    forceBrowserHistoryUrlFallback: bool
    enhancedContextEnabled: bool
    enhancedContextCaptureLocal: bool
    enhancedContextSourceFamilies: list[str]


@dataclass(frozen=True)  # noqa: SLOTS_OK - packaged sidecar still supports Python 3.9.
class DeveloperDiagnosticsSettings:
    force_chromium_ax_capture: bool
    force_frontmost_fallback_capture: bool
    force_browser_history_url_fallback: bool
    enhanced_context_enabled: bool
    enhanced_context_capture_local: bool
    enhanced_context_source_families: list[str]


def apply_developer_diagnostics_env(db: TrackerDatabase) -> None:
    settings = DeveloperDiagnosticsSettings(
        force_chromium_ax_capture=db.get_meta(FORCE_CHROMIUM_AX_CAPTURE_META_KEY) == "true",
        force_frontmost_fallback_capture=db.get_meta(FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY) == "true",
        force_browser_history_url_fallback=db.get_meta(FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY) == "true",
        enhanced_context_enabled=db.get_meta(ENHANCED_CONTEXT_ENABLED_META_KEY) == "true",
        enhanced_context_capture_local=db.get_meta(ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY) == "true",
        enhanced_context_source_families=source_families_from_meta(
            db.get_meta(ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY)
        ),
    )
    os.environ[FORCE_CHROMIUM_AX_CAPTURE_ENV] = "1" if settings.force_chromium_ax_capture else "0"
    os.environ[FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV] = "1" if settings.force_frontmost_fallback_capture else "0"
    os.environ[FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV] = (
        "1" if settings.force_browser_history_url_fallback else "0"
    )
    os.environ[ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV] = (
        "1" if settings.enhanced_context_enabled and settings.enhanced_context_capture_local else "0"
    )
    os.environ[ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV] = ",".join(settings.enhanced_context_source_families)


def apply_developer_diagnostics_defaults() -> None:
    os.environ[FORCE_CHROMIUM_AX_CAPTURE_ENV] = "0"
    os.environ[FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV] = "0"
    os.environ[FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV] = "0"
    os.environ[ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV] = "0"
    os.environ[ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV] = ""


def save_developer_diagnostics(db: TrackerDatabase, payload: JsonObject) -> DeveloperDiagnosticsResponse:
    settings = settings_from_payload(payload)
    db.set_meta(FORCE_CHROMIUM_AX_CAPTURE_META_KEY, bool_meta(settings.force_chromium_ax_capture))
    db.set_meta(
        FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY,
        bool_meta(settings.force_frontmost_fallback_capture),
    )
    db.set_meta(
        FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY,
        bool_meta(settings.force_browser_history_url_fallback),
    )
    db.set_meta(ENHANCED_CONTEXT_ENABLED_META_KEY, bool_meta(settings.enhanced_context_enabled))
    db.set_meta(
        ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY,
        bool_meta(settings.enhanced_context_capture_local),
    )
    db.set_meta(ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY, ",".join(settings.enhanced_context_source_families))
    apply_developer_diagnostics_env(db)
    return response_from_settings(settings)


def settings_from_payload(payload: JsonObject) -> DeveloperDiagnosticsSettings:
    return DeveloperDiagnosticsSettings(
        force_chromium_ax_capture=bool_payload(payload.get("forceChromiumAxCapture")),
        force_frontmost_fallback_capture=bool_payload(payload.get("forceFrontmostFallbackCapture")),
        force_browser_history_url_fallback=bool_payload(payload.get("forceBrowserHistoryUrlFallback")),
        enhanced_context_enabled=bool_payload(payload.get("enhancedContextEnabled")),
        enhanced_context_capture_local=bool_payload(payload.get("enhancedContextCaptureLocal")),
        enhanced_context_source_families=source_families_from_payload(
            payload.get("enhancedContextSourceFamilies")
        ),
    )


def response_from_settings(settings: DeveloperDiagnosticsSettings) -> DeveloperDiagnosticsResponse:
    return {
        "forceChromiumAxCapture": settings.force_chromium_ax_capture,
        "forceFrontmostFallbackCapture": settings.force_frontmost_fallback_capture,
        "forceBrowserHistoryUrlFallback": settings.force_browser_history_url_fallback,
        "enhancedContextEnabled": settings.enhanced_context_enabled,
        "enhancedContextCaptureLocal": settings.enhanced_context_capture_local,
        "enhancedContextSourceFamilies": settings.enhanced_context_source_families,
    }


def bool_meta(value: bool) -> str:
    return "true" if value else "false"


def bool_payload(value: JsonValue) -> bool:
    return value is True


def source_families_from_meta(value: str | None) -> list[str]:
    if value is None:
        return []
    return [
        item
        for item in (part.strip() for part in value.split(","))
        if item in SUPPORTED_ADAPTIVE_SOURCE_FAMILIES
    ]


def source_families_from_payload(value: JsonValue) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item in SUPPORTED_ADAPTIVE_SOURCE_FAMILIES]
