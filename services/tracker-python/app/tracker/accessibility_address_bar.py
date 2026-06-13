from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal
from urllib.parse import urlparse

AddressBarMatchState = Literal["accessibility-address-bar", "accessibility-address-bar-schemaless"]

CHROMIUM_BROWSER_APPS: Final = {
    "Google Chrome",
    "Google Chrome Canary",
    "Microsoft Edge",
    "Arc",
    "Brave Browser",
    "Chromium",
}

AX_NO_PROCESS: Final = "AX_NO_PROCESS"
AX_NO_FRONT_WINDOW: Final = "AX_NO_FRONT_WINDOW"
AX_NO_ADDRESS_FIELD: Final = "AX_NO_ADDRESS_FIELD"

_SCHEMED_PREFIXES: Final = (
    "http://",
    "https://",
    "chrome://",
    "edge://",
    "brave://",
    "arc://",
    "file://",
    "about:",
)


@dataclass(frozen=True)
class AccessibilityAddressBarMetadata:
    site_url: str | None = None
    ax_window_title: str | None = None
    match_state: AddressBarMatchState | None = None
    error: str | None = None


def is_chromium_browser_app(app_name: str | None) -> bool:
    return app_name in CHROMIUM_BROWSER_APPS


def accessibility_address_bar_script(app_name: str) -> str:
    return f'''
        property bestValue : ""
        property bestLength : -1
        property bestPriority : -1
        property readableCount : 0
        property visitedCount : 0
        property maxVisited : 500

        on considerAddressCandidate(addressField)
          tell application "System Events"
            try
              set descriptionText to ""
              try
                set descriptionText to description of addressField
              end try
              set candidatePriority to 0
              if descriptionText contains "주소" or descriptionText contains "Address" or descriptionText contains "address" or descriptionText contains "URL" or descriptionText contains "url" then
                set candidatePriority to 1
              end if
              set candidate to value of addressField as text
              if candidate is not "" and candidate is not "missing value" then
                set readableCount to readableCount + 1
                if candidatePriority > bestPriority or (candidatePriority is bestPriority and (length of candidate) > bestLength) then
                  set bestValue to candidate
                  set bestLength to length of candidate
                  set bestPriority to candidatePriority
                end if
              end if
            end try
          end tell
        end considerAddressCandidate

        on scanElement(theElement)
          if visitedCount is greater than maxVisited then return
          set visitedCount to visitedCount + 1
          tell application "System Events"
            set roleText to ""
            try
              set roleText to role of theElement
            end try
            if roleText is "AXWebArea" then return
            if roleText is "AXTextField" or roleText is "AXComboBox" then
              my considerAddressCandidate(theElement)
            end if
            try
              repeat with childElement in UI elements of theElement
                my scanElement(childElement)
                if visitedCount is greater than maxVisited then exit repeat
              end repeat
            end try
          end tell
        end scanElement

        tell application "System Events"
          if not (exists process "{app_name}") then return "{AX_NO_PROCESS}"
          tell process "{app_name}"
            if not (exists front window) then return "{AX_NO_FRONT_WINDOW}"
            set axTitle to name of front window
            set bestValue to ""
            set bestLength to -1
            set bestPriority to -1
            set readableCount to 0
            set visitedCount to 0
            my scanElement(front window)
            if readableCount is 0 then return "{AX_NO_ADDRESS_FIELD}"
            return bestValue & linefeed & axTitle
          end tell
        end tell
    '''


def metadata_from_accessibility_address_bar_result(app_name: str, result: str) -> AccessibilityAddressBarMetadata:
    normalized_result = result.strip()
    if normalized_result == AX_NO_ADDRESS_FIELD:
        return AccessibilityAddressBarMetadata(
            error=f"{app_name} accessibility address bar fallback found no readable address field.",
        )
    if normalized_result == AX_NO_FRONT_WINDOW:
        return AccessibilityAddressBarMetadata(
            error=f"{app_name} accessibility address bar fallback found no front window.",
        )
    if normalized_result == AX_NO_PROCESS:
        return AccessibilityAddressBarMetadata(
            error=f"{app_name} accessibility address bar fallback found no browser process.",
        )
    if not normalized_result:
        return AccessibilityAddressBarMetadata(
            error=f"{app_name} accessibility address bar fallback returned an empty result.",
        )

    parts = result.splitlines()
    raw_value = parts[0].strip() if parts else ""
    ax_window_title = parts[1].strip() if len(parts) > 1 else None
    normalized = _normalize_address_bar_value(raw_value)
    if not normalized:
        return AccessibilityAddressBarMetadata(
            error=f"{app_name} accessibility address bar fallback returned a non-URL value.",
        )

    site_url, match_state = normalized
    return AccessibilityAddressBarMetadata(
        site_url=site_url,
        ax_window_title=ax_window_title or None,
        match_state=match_state,
    )


def _normalize_address_bar_value(value: str) -> tuple[str, AddressBarMatchState] | None:
    cleaned = value.strip()
    if not cleaned or cleaned == "missing value":
        return None
    if any(cleaned.startswith(prefix) for prefix in _SCHEMED_PREFIXES):
        return cleaned, "accessibility-address-bar"
    if any(character.isspace() for character in cleaned):
        return None
    if not _looks_like_host(cleaned):
        return None
    return f"https://{cleaned}", "accessibility-address-bar-schemaless"


def _looks_like_host(value: str) -> bool:
    try:
        parsed = urlparse(f"https://{value}")
    except ValueError:
        return False
    hostname = parsed.hostname
    if not hostname:
        return False
    return hostname == "localhost" or hostname.startswith("127.") or "." in hostname
