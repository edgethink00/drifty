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
    "Aside",
    "Brave Browser",
    "Chromium",
    "Comet",
    "Opera",
    "Vivaldi",
    "Whale",
}
AX_ADDRESS_BAR_BROWSER_APPS: Final = CHROMIUM_BROWSER_APPS | {
    "Floorp",
    "Firefox",
    "Firefox Developer Edition",
    "LibreWolf",
    "Safari",
    "Safari Technology Preview",
    "Waterfox",
    "Zen",
}

AX_NO_PROCESS: Final = "AX_NO_PROCESS"
# Firefox-family browsers whose address field is found by DOM id first.
_FIREFOX_DOM_ADDRESS_BAR_APPS: Final = frozenset({"Firefox", "Firefox Developer Edition", "Floorp", "LibreWolf", "Waterfox", "Zen"})
_SAFARI_APPS: Final = frozenset({"Safari", "Safari Technology Preview"})
AX_NO_FRONT_WINDOW: Final = "AX_NO_FRONT_WINDOW"
AX_NO_ADDRESS_FIELD: Final = "AX_NO_ADDRESS_FIELD"

_SCHEMED_PREFIXES: Final = (
    "http://",
    "https://",
    "chrome://",
    "edge://",
    "brave://",
    "arc://",
    "comet://",
    "aside://",
    "vivaldi://",
    "opera://",
    "file://",
    "about:",
)


@dataclass(frozen=True)
class AccessibilityAddressBarMetadata:
    site_url: str | None = None
    ax_window_title: str | None = None
    match_state: AddressBarMatchState | None = None
    error: str | None = None
    # Safari only: True while its address field has keyboard focus (or its
    # focus could not be read), when the field shows what is being typed
    # rather than the page. None for browsers that do not report it.
    address_field_editing: bool | None = None


def is_chromium_browser_app(app_name: str | None) -> bool:
    return app_name in CHROMIUM_BROWSER_APPS


def is_accessibility_address_bar_browser_app(app_name: str | None) -> bool:
    return app_name in AX_ADDRESS_BAR_BROWSER_APPS


def accessibility_address_bar_script(app_name: str) -> str:
    process_name = "firefox" if app_name == "Firefox Developer Edition" else app_name
    if app_name in {"Safari", "Safari Technology Preview"}:
        # The third line says whether the address field has keyboard focus.
        # While it does, the field holds what is being typed, not the page;
        # an unreadable focus counts as editing.
        return f'''
            tell application "System Events"
              if not (exists process "{process_name}") then return "{AX_NO_PROCESS}"
              tell process "{process_name}"
                if not (exists front window) then return "{AX_NO_FRONT_WINDOW}"
                set targetWindow to front window
                set axTitle to name of targetWindow
                try
                  set addressField to UI element 3 of UI element 3 of toolbar 1 of targetWindow
                  set currentUrl to value of addressField as text
                  if currentUrl is "" or currentUrl is "missing value" then error "Address field unavailable"
                  set fieldState to "editing"
                  try
                    if not (focused of addressField) then set fieldState to "idle"
                  end try
                  return currentUrl & linefeed & axTitle & linefeed & fieldState
                on error
                  -- Safari 17 exposes the address field directly in the third
                  -- toolbar group; the third generic child is the reload button.
                  try
                    set addressField to text field 1 of group 3 of toolbar 1 of targetWindow
                    set currentUrl to value of addressField as text
                    if currentUrl is "" or currentUrl is "missing value" then return "{AX_NO_ADDRESS_FIELD}"
                    set fieldState to "editing"
                    try
                      if not (focused of addressField) then set fieldState to "idle"
                    end try
                    return currentUrl & linefeed & axTitle & linefeed & fieldState
                  on error
                    return "{AX_NO_ADDRESS_FIELD}"
                  end try
                end try
              end tell
            end tell
        '''

    if app_name == "Microsoft Edge":
        known_address_probe = "my scanKnownEdgeAddressBar(targetWindow)"
    elif app_name == "Brave Browser":
        known_address_probe = "my scanKnownBraveAddressBar(targetWindow)"
    elif app_name == "Vivaldi":
        known_address_probe = "my scanKnownVivaldiAddressBar(targetWindow)"
    elif app_name == "Opera":
        known_address_probe = "my scanKnownOperaAddressBar(targetWindow)"
    elif app_name == "Whale":
        known_address_probe = "my scanKnownWhaleAddressBar(targetWindow)"
    elif app_name == "Zen":
        known_address_probe = "my scanKnownFirefoxAddressBar(targetWindow)\n            my scanKnownZenAddressBar(targetWindow)"
    elif app_name in _FIREFOX_DOM_ADDRESS_BAR_APPS:
        known_address_probe = "my scanKnownFirefoxAddressBar(targetWindow)"
    else:
        known_address_probe = "my scanKnownChromiumAddressBar(targetWindow)"
    # Zen's tab sidebar makes the generic walk exceed the tracker timeout, so
    # Zen reads only its known paths and otherwise fails closed.
    generic_walk = "" if app_name == "Zen" else '''my scanToolbarFirst(targetWindow)
            if foundAddress is false then
              my scanElement(targetWindow)
            end if'''
    main_window_selection = ""
    if is_chromium_browser_app(app_name):
        main_window_selection = '''
            try
              set targetWindow to first window whose value of attribute "AXMain" is true
            on error
              try
                set targetWindow to first window whose subrole is "AXStandardWindow"
              end try
            end try
        '''
    return f'''
        property bestValue : ""
        property bestLength : -1
        property bestPriority : -1
        property readableCount : 0
        property visitedCount : 0
        property maxVisited : 500
        property toolbarVisitedCount : 0
        property toolbarMaxVisited : 120
        property foundAddress : false

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
                if candidatePriority is 1 then set foundAddress to true
              end if
            end try
          end tell
        end considerAddressCandidate

        on scanKnownChromiumAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 1 of theWindow
              set addressContainer to UI element 3 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressToolbar to UI element 1 of addressContainer
              set addressFieldGroup to UI element 4 of addressToolbar
              my considerAddressCandidate(UI element 2 of addressFieldGroup)
            end try
          end tell
        end scanKnownChromiumAddressBar

        on scanKnownEdgeAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 1 of theWindow
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressToolbar to UI element 1 of addressContainer
              set addressFieldGroup to UI element 3 of addressToolbar
              my considerAddressCandidate(UI element 2 of addressFieldGroup)
            end try
          end tell
        end scanKnownEdgeAddressBar

        on scanKnownBraveAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 1 of theWindow
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressContainer to UI element 2 of addressContainer
              set addressToolbar to UI element 1 of addressContainer
              set addressFieldGroup to UI element 5 of addressToolbar
              my considerAddressCandidate(UI element 2 of addressFieldGroup)
            end try
          end tell
        end scanKnownBraveAddressBar

        on scanKnownVivaldiAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              -- Vivaldi renders its browser chrome inside a first-party
              -- extension web area when assistive-technology mode is enabled.
              -- Keep this direct path ahead of the bounded scanner, which
              -- intentionally does not descend into arbitrary web content.
              set addressContainer to UI element 1 of theWindow
              repeat 7 times
                set addressContainer to UI element 1 of addressContainer
              end repeat
              set addressContainer to UI element 3 of addressContainer
              set addressToolbar to UI element 1 of addressContainer
              set addressFieldGroup to UI element 5 of addressToolbar
              set addressFieldGroup to UI element 2 of addressFieldGroup
              my considerAddressCandidate(UI element 1 of addressFieldGroup)
            end try
          end tell
        end scanKnownVivaldiAddressBar

        on scanKnownOperaAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 4 of theWindow
              repeat 10 times
                set addressContainer to UI element 1 of addressContainer
              end repeat
              set addressToolbar to UI element 2 of addressContainer
              set addressFieldGroup to UI element 1 of addressToolbar
              set addressFieldGroup to UI element 2 of addressFieldGroup
              set addressFieldGroup to UI element 1 of addressFieldGroup
              my considerAddressCandidate(UI element 2 of addressFieldGroup)
            end try
          end tell
        end scanKnownOperaAddressBar

        on scanKnownWhaleAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 1 of theWindow
              repeat 3 times
                set addressContainer to UI element 1 of addressContainer
              end repeat
              set addressContainer to UI element 6 of addressContainer
              set addressContainer to UI element 1 of addressContainer
              set addressToolbar to toolbar 1 of addressContainer
              set addressFieldGroup to UI element 7 of addressToolbar
              my considerAddressCandidate(text field 1 of addressFieldGroup)
            end try
          end tell
        end scanKnownWhaleAddressBar

        -- Firefox-family DOM ids reach Accessibility as AXDOMIdentifier and,
        -- unlike the address field's placeholder label, do not follow the UI
        -- language. Resolving them inside System Events keeps the read far
        -- below the tracker timeout that the generic walk exceeds on video
        -- pages.
        on scanKnownFirefoxAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set rootGroup to UI element 1 of theWindow
              try
                set navBar to first toolbar of rootGroup whose value of attribute "AXDOMIdentifier" is "nav-bar"
              on error
                -- Zen 1.23 nests #nav-bar inside #navigator-toolbox.
                set toolbox to first UI element of rootGroup whose value of attribute "AXDOMIdentifier" is "navigator-toolbox"
                set navBar to first toolbar of toolbox whose value of attribute "AXDOMIdentifier" is "nav-bar"
              end try
              set urlbarGroup to first UI element of navBar whose value of attribute "AXDOMIdentifier" is "urlbar"
              -- The field sits one group below #urlbar; check both levels only.
              repeat with urlbarChild in UI elements of urlbarGroup
                my considerFirefoxAddressField(urlbarChild)
                if foundAddress is true then exit repeat
                try
                  repeat with urlbarGrandchild in UI elements of urlbarChild
                    my considerFirefoxAddressField(urlbarGrandchild)
                    if foundAddress is true then exit repeat
                  end repeat
                end try
                if foundAddress is true then exit repeat
              end repeat
            end try
          end tell
        end scanKnownFirefoxAddressBar

        -- Zen 1.22 kept its address field at fixed positions below the
        -- window's first toolbar.
        on scanKnownZenAddressBar(theWindow)
          if foundAddress is true then return
          tell application "System Events"
            try
              set addressContainer to UI element 1 of theWindow
              set addressToolbar to toolbar 1 of addressContainer
              set addressContainer to UI element 1 of addressToolbar
              set addressContainer to UI element 2 of addressContainer
              my considerAddressCandidate(combo box 1 of addressContainer)
            end try
          end tell
        end scanKnownZenAddressBar

        on considerFirefoxAddressField(candidateField)
          tell application "System Events"
            set fieldIdentifier to ""
            try
              set fieldIdentifier to value of attribute "AXDOMIdentifier" of candidateField as text
            end try
            if fieldIdentifier is not "urlbar-input" then return
            try
              set candidate to value of candidateField as text
              if candidate is not "" and candidate is not "missing value" then
                set bestValue to candidate
                set bestLength to length of candidate
                set bestPriority to 2
                set readableCount to readableCount + 1
                set foundAddress to true
              end if
            end try
          end tell
        end considerFirefoxAddressField

        on scanElement(theElement)
          if foundAddress is true then return
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
              if foundAddress is true then return
            end if
            try
              repeat with childElement in UI elements of theElement
                my scanElement(childElement)
                if foundAddress is true then exit repeat
                if visitedCount is greater than maxVisited then exit repeat
              end repeat
            end try
          end tell
        end scanElement

        on scanToolbarFirst(theElement)
          if foundAddress is true then return
          if toolbarVisitedCount is greater than toolbarMaxVisited then return
          set toolbarVisitedCount to toolbarVisitedCount + 1
          tell application "System Events"
            set roleText to ""
            try
              set roleText to role of theElement
            end try
            if roleText is "AXWebArea" then return
            if roleText is "AXToolbar" then
              my scanElement(theElement)
              return
            end if
            try
              repeat with childElement in UI elements of theElement
                my scanToolbarFirst(childElement)
                if foundAddress is true then exit repeat
                if toolbarVisitedCount is greater than toolbarMaxVisited then exit repeat
              end repeat
            end try
          end tell
        end scanToolbarFirst

        tell application "System Events"
          if not (exists process "{process_name}") then return "{AX_NO_PROCESS}"
          tell process "{process_name}"
            if not (exists front window) then return "{AX_NO_FRONT_WINDOW}"
            -- Prefer the browser's main standard window. Some Chromium browsers
            -- (e.g. Aside) keep a synthetic, contentless overlay window
            -- (subrole AXUnknown, 0 children) ahead of the real window in the
            -- window order, so "front window" would scan an empty shell and
            -- report no address field. The main / standard window is the one
            -- that actually holds the omnibox.
            set targetWindow to front window
{main_window_selection}
            set axTitle to name of targetWindow
            set bestValue to ""
            set bestLength to -1
            set bestPriority to -1
            set readableCount to 0
            set visitedCount to 0
            set toolbarVisitedCount to 0
            set foundAddress to false
            {known_address_probe}
            {generic_walk}
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
    # Only Safari's script reports the field's state, on a third line.
    field_state = (parts[2].strip() if len(parts) > 2 else "") if app_name in _SAFARI_APPS else None
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
        address_field_editing=None if field_state is None else field_state != "idle",
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
