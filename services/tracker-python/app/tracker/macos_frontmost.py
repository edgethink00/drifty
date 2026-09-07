from __future__ import annotations

import re
from collections.abc import Callable


CommandRunner = Callable[[list[str]], str]
OsascriptRunner = Callable[[str], str]

_LSAPPINFO_ASN_RE = re.compile(
    r"^ASN:(?:0x)?([0-9A-Fa-f]+)-(?:0x)?([0-9A-Fa-f]+):$"
)


def normalize_lsappinfo_asn(value: str) -> str:
    cleaned = value.strip().strip("[]").strip()
    matched = _LSAPPINFO_ASN_RE.fullmatch(cleaned)
    if matched is None:
        return cleaned
    high, low = matched.groups()
    return f"ASN:0x{high.lower()}-0x{low.lower()}:"


def optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned == "missing value":
        return None
    return cleaned


def lsappinfo_text(value: str) -> str | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if not cleaned.startswith('"'):
        return optional_text(cleaned)

    chars: list[str] = []
    escaped = False
    for char in cleaned[1:]:
        if escaped:
            chars.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            return optional_text("".join(chars))
        chars.append(char)
    return None


def lsappinfo_assignment(line: str, key: str) -> str | None:
    for prefix in (f'"{key}"=', f"{key}="):
        if line.startswith(prefix):
            return lsappinfo_text(line.split("=", 1)[1])
    return None


def lsappinfo_header_app_name(line: str) -> str | None:
    if not line.startswith('"') or line.startswith('"name"=') or line.startswith('"bundleID"='):
        return None
    return lsappinfo_text(line)


def frontmost_via_system_events(run_osascript: OsascriptRunner) -> tuple[str | None, str | None, str | None, int | None]:
    result = run_osascript(
        '''
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set bundleId to bundle identifier of frontApp
          if bundleId is missing value then set bundleId to ""
          set windowTitle to ""
          tell frontApp
            if exists front window then
              set windowTitle to name of front window
              if windowTitle is missing value then set windowTitle to ""
              -- Aside exposes an empty AXUnknown shadow window as its front
              -- window. Recover the title from the real main window only when
              -- that exact synthetic shape is present.
              if appName is "Aside" and windowTitle is "" then
                set frontSubrole to ""
                set frontChildCount to -1
                try
                  set frontSubrole to subrole of front window as text
                end try
                try
                  set frontChildCount to count of UI elements of front window
                end try
                if frontSubrole is "AXUnknown" and frontChildCount is 0 then
                  try
                    set targetWindow to first window whose value of attribute "AXMain" is true
                    set windowTitle to name of targetWindow as text
                  on error
                    try
                      set targetWindow to first window whose subrole is "AXStandardWindow"
                      set windowTitle to name of targetWindow as text
                    end try
                  end try
                end if
              end if
            end if
          end tell
          set unixId to unix id of frontApp
          return appName & linefeed & bundleId & linefeed & windowTitle & linefeed & unixId
        end tell
        '''
    )
    parts = result.splitlines()
    app_name = optional_text(parts[0] if len(parts) > 0 else None)
    bundle_id = optional_text(parts[1] if len(parts) > 1 else None)
    window_title = optional_text(parts[2] if len(parts) > 2 else None)
    pid_text = optional_text(parts[3] if len(parts) > 3 else None)
    pid = int(pid_text) if pid_text and pid_text.isdigit() else None
    return app_name, bundle_id, window_title, pid


def frontmost_via_lsappinfo(run_command: CommandRunner) -> tuple[str | None, str | None, str | None, int | None]:
    front = run_command(["lsappinfo", "front"])
    if "NULL" in front:
        return None, None, "lsappinfo front returned NULL.", None

    asn = normalize_lsappinfo_asn(front)
    info = run_command(["lsappinfo", "info", asn])
    app_name = None
    bundle_id = None
    for line in info.splitlines():
        line = line.strip()
        if app_name is None:
            app_name = lsappinfo_header_app_name(line)
        parsed_name = lsappinfo_assignment(line, "name")
        if parsed_name is not None:
            app_name = parsed_name
        parsed_bundle_id = lsappinfo_assignment(line, "bundleID")
        if parsed_bundle_id is not None:
            bundle_id = parsed_bundle_id

    fallback_error = None
    if app_name is None:
        fallback_error = "lsappinfo info returned no parseable app name."
    return app_name, bundle_id, fallback_error, None
