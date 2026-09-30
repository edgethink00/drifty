"""Live allowlisted-browser Document URL capture through a Windows UIA host.

The tracker is stdlib-only, so it cannot depend on pywin32/comtypes. Windows
PowerShell already ships the managed UI Automation assemblies; one hidden,
long-lived child loads them once and answers bounded HWND requests over a
private stdin/stdout pipe. Raw URLs never leave the local tracker process.
"""

from __future__ import annotations

import atexit
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse


_STARTUP_TIMEOUT_SECONDS = 20.0
# A cold UIA provider can take longer than the steady-state tick budget while
# it materializes Edge's accessibility tree. Repeated Windows 10 22H2 evidence
# showed a focused Edge Document taking roughly 12-19 seconds even after the
# browser window existed. A ten-second limit killed the host before its first
# useful reply and made the next attempt cold again. Give only the first
# completed request a bounded 30-second warm-up window; every later read keeps
# the normal limit.
_COLD_REQUEST_TIMEOUT_SECONDS = 30.0
_REQUEST_TIMEOUT_SECONDS = 2.0
_SUPPORTED_BROWSERS = {
    "Google Chrome",
    "Google Chrome Beta",
    "Google Chrome Dev",
    "Google Chrome Canary",
    "Microsoft Edge",
    "Brave Browser",
    "Firefox",
    "Firefox Developer Edition",
    "Floorp",
    "LibreWolf",
    "Waterfox",
    "Zen",
}
# Firefox's native UI Automation provider exposes the page Document inside its
# tab panels, and browser-owned panels as other Documents under the window.
# Floorp 12.18, LibreWolf 156, Waterfox 6.7, and Zen 1.22 measured the same way.
_GECKO_BROWSERS = {"Firefox", "Firefox Developer Edition", "Floorp", "LibreWolf", "Waterfox", "Zen"}

_POWERSHELL_UIA_HOST = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DriftyTrackerUiaNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
$auto = [System.Windows.Automation.AutomationElement]
$documentCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
# Firefox draws its private-browsing indicator only in private windows; normal
# windows expose no element with these DOM classes. They are language
# independent, unlike the window title.
$privateIndicatorCondition = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'private-browsing-indicator-icon')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'private-browsing-indicator-label')))

function Test-SameAutomationElement($left, $right) {
  try {
    if ($null -eq $left -or $null -eq $right) { return $false }
    $leftId = @($left.GetRuntimeId())
    $rightId = @($right.GetRuntimeId())
    if ($leftId.Count -eq 0 -or $leftId.Count -ne $rightId.Count) { return $false }
    for ($i = 0; $i -lt $leftId.Count; $i++) {
      if ($leftId[$i] -ne $rightId[$i]) { return $false }
    }
    return $true
  } catch { return $false }
}

function Test-ExplicitHttpUrl($value) {
  if ($value -isnot [string] -or $value -notmatch '^https?://' -or
      $value -match '[\s\x00-\x20\x7f\\]' -or $value -match '%(?![0-9a-fA-F]{2})') { return $false }
  try {
    $uri = [Uri]$value
    return ($uri.IsAbsoluteUri -and $uri.Scheme -in @('http', 'https') -and
      -not [string]::IsNullOrWhiteSpace($uri.Host) -and $uri.UserInfo -eq '')
  } catch { return $false }
}

function Test-FiniteRectangle($rect) {
  foreach ($field in @('Left', 'Top', 'Width', 'Height')) {
    $component = $rect.$field
    if ($null -eq $component -or [double]::IsNaN([double]$component) -or
        [double]::IsInfinity([double]$component)) { return $false }
  }
  return $true
}

function Read-ValidatedDocumentUrl($document, $rootRect, [bool]$rereadGeometry = $false) {
  $offscreen = $document.Current.IsOffscreen
  if ($offscreen -eq $true) { throw 'document visibility unavailable' }
  if ($offscreen -ne $false) { throw 'document visibility unavailable' }
  $rect = $document.Current.BoundingRectangle
  if ($rereadGeometry -and -not (Test-FiniteRectangle $rect)) {
    # Firefox can answer the first bounds query for a page it has just exposed
    # with an empty rectangle and the real bounds on the next query.
    Start-Sleep -Milliseconds 50
    $rect = $document.Current.BoundingRectangle
  }
  if (-not (Test-FiniteRectangle $rect)) { throw 'document geometry unavailable' }
  if ($rect.Width -le 0 -or $rect.Height -le 0 -or
      $rect.Left -ge ($rootRect.Left + $rootRect.Width) -or
      ($rect.Left + $rect.Width) -le $rootRect.Left -or
      $rect.Top -ge ($rootRect.Top + $rootRect.Height) -or
      ($rect.Top + $rect.Height) -le $rootRect.Top) { throw 'document geometry unavailable' }
  $valuePattern = $null
  if (-not $document.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    throw 'document URL unavailable'
  }
  $url = $valuePattern.Current.Value
  if (-not (Test-ExplicitHttpUrl $url)) { throw 'document URL unavailable' }
  return $url
}

function Test-GeckoPrivateWindow($root) {
  return ($null -ne $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $privateIndicatorCondition))
}

function Test-ClassToken($element, [string]$token) {
  return (@(([string]$element.Current.ClassName) -split '\s+') -contains $token)
}

function Find-FocusedTopLevelDocument($root, $treeWalker, $focusedElement, [string]$requiredAncestorId = '', [string]$requiredAncestorClass = '') {
  if ($null -eq $focusedElement) { return $null }
  $document = $null
  $cursor = $focusedElement
  $exactWindow = $false
  $requiredSeen = [string]::IsNullOrEmpty($requiredAncestorId)
  $requiredClassSeen = [string]::IsNullOrEmpty($requiredAncestorClass)
  for ($depth = 0; $depth -lt 64 -and $null -ne $cursor; $depth++) {
    if (Test-SameAutomationElement $cursor $root) { $exactWindow = $true; break }
    if ($cursor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
    # Keep replacing the candidate while walking upward. If focus is inside an
    # iframe, this selects the outermost Document directly below the exact
    # foreground window rather than exposing the nested frame URL.
    if ($cursor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
      $document = $cursor
    } elseif (-not $requiredSeen -and [string]::Equals([string]$cursor.Current.AutomationId, $requiredAncestorId, [StringComparison]::Ordinal)) {
      $requiredSeen = $true
    }
    if (-not $requiredClassSeen -and (Test-ClassToken $cursor $requiredAncestorClass)) { $requiredClassSeen = $true }
    $cursor = $treeWalker.GetParent($cursor)
  }
  if (-not $exactWindow) { throw 'document ancestry unavailable' }
  # Focus inside a browser-owned panel is not the page; use the scan instead.
  if (-not $requiredSeen -or -not $requiredClassSeen) { return $null }
  return $document
}

function Read-TopLevelDocument($root, $treeWalker, $condition, $focusedElement = $null, [string]$family = 'chromium') {
  # The private indicator can establish a Gecko private window. Its absence
  # cannot prove a normal window when an accessibility provider is incomplete.
  $privacy = 'unknown'
  try {
    if ($null -eq $root -or $root.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -or
        $root.Current.IsOffscreen -ne $false) { throw 'document window unavailable' }
    $rootRect = $root.Current.BoundingRectangle
    foreach ($field in @('Left', 'Top', 'Width', 'Height')) {
      $component = $rootRect.$field
      if ($null -eq $component -or [double]::IsNaN([double]$component) -or
          [double]::IsInfinity([double]$component)) { throw 'document geometry unavailable' }
    }
    if ($rootRect.Width -le 0 -or $rootRect.Height -le 0) { throw 'document geometry unavailable' }
    $requiredAncestorId = ''
    $requiredAncestorClass = ''
    if ($family -eq 'gecko') {
      # The browser extension never reported private tabs; neither does this.
      if (Test-GeckoPrivateWindow $root) {
        return [pscustomobject]@{ found = $false; url = ''; error = 'private browsing window'; privacy = 'private' }
      }
      $requiredAncestorId = 'tabbrowser-tabpanels'
      # Only the selected tab's panel holds the page. LibreWolf 156 kept the
      # previous tab's Document on-screen with an empty rectangle after a switch.
      $requiredAncestorClass = 'deck-selected'
    }

    # Chromium can briefly enumerate more than one visible Document while its
    # accessibility tree warms up. A focused Document is a stronger identity
    # signal, but only after its full ancestry is proven to terminate at this
    # exact foreground root. Chrome focus (tab strip/omnibox) has no Document
    # ancestor and deliberately falls back to the strict enumeration below.
    $focusedDocument = Find-FocusedTopLevelDocument $root $treeWalker $focusedElement $requiredAncestorId $requiredAncestorClass
    if ($null -ne $focusedDocument) {
      $focusedUrl = Read-ValidatedDocumentUrl $focusedDocument $rootRect ($family -eq 'gecko')
      return [pscustomobject]@{ found = $true; url = $focusedUrl; error = ''; privacy = $privacy }
    }

    $documents = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $count = 0
    $url = ''
    foreach ($document in $documents) {
      # IsOffscreen and proven nesting are the only exclusion routes. A broken
      # provider/ancestry/rectangle cannot make an ambiguous window look unique.
      $offscreen = $document.Current.IsOffscreen
      if ($offscreen -eq $true) { continue }
      if ($offscreen -ne $false) { throw 'document visibility unavailable' }
      $ancestor = $treeWalker.GetParent($document)
      $nested = $false
      $exactWindow = $false
      $requiredSeen = [string]::IsNullOrEmpty($requiredAncestorId)
      $requiredClassSeen = [string]::IsNullOrEmpty($requiredAncestorClass)
      for ($depth = 0; $depth -lt 64 -and $null -ne $ancestor; $depth++) {
        if (Test-SameAutomationElement $ancestor $root) { $exactWindow = $true; break }
        if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
        if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) { $nested = $true }
        if (-not $requiredSeen -and [string]::Equals([string]$ancestor.Current.AutomationId, $requiredAncestorId, [StringComparison]::Ordinal)) {
          $requiredSeen = $true
        }
        if (-not $requiredClassSeen -and (Test-ClassToken $ancestor $requiredAncestorClass)) { $requiredClassSeen = $true }
        $ancestor = $treeWalker.GetParent($ancestor)
      }
      if (-not $exactWindow) { throw 'document ancestry unavailable' }
      if ($nested) { continue }
      # A Firefox Document outside the selected tab panel is browser chrome
      # or a background tab.
      if (-not $requiredSeen -or -not $requiredClassSeen) { continue }
      $count++
      if ($count -gt 1) { throw 'multiple visible top-level documents' }
      $url = Read-ValidatedDocumentUrl $document $rootRect ($family -eq 'gecko')
    }
    if ($count -ne 1) { throw 'document URL unavailable' }
    return [pscustomobject]@{ found = $true; url = $url; error = ''; privacy = $privacy }
  } catch {
    # Only our fixed diagnostics leave the host, never provider exception data.
    $message = $_.Exception.Message
    if ($message -notin @('document window unavailable', 'document geometry unavailable',
        'document ancestry unavailable', 'document visibility unavailable',
        'multiple visible top-level documents', 'document URL unavailable')) {
      $message = 'document provider unavailable'
    }
    return [pscustomobject]@{ found = $false; url = ''; error = $message; privacy = $privacy }
  }
}

function Read-Document([IntPtr]$handle, [string]$family) {
  try {
    if ($handle -eq [IntPtr]::Zero -or [DriftyTrackerUiaNative]::GetForegroundWindow() -ne $handle) {
      throw 'foreground changed'
    }
    [uint32]$ownerPid = 0
    [void][DriftyTrackerUiaNative]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
    $root = $auto::FromHandle($handle)
    if ($ownerPid -eq 0 -or $null -eq $root -or $root.Current.ProcessId -ne $ownerPid -or
        $root.Current.NativeWindowHandle -ne $handle.ToInt64()) { throw 'window changed' }
    $result = Read-TopLevelDocument $root $walker $documentCondition ($auto::FocusedElement) $family
    [uint32]$afterPid = 0
    [void][DriftyTrackerUiaNative]::GetWindowThreadProcessId($handle, [ref]$afterPid)
    if ($afterPid -ne $ownerPid -or [DriftyTrackerUiaNative]::GetForegroundWindow() -ne $handle -or
        -not (Test-SameAutomationElement $root ($auto::FromHandle($handle)))) { throw 'window changed' }
    return $result
  } catch {
    return [pscustomobject]@{ found = $false; url = ''; error = 'document window unavailable or changed' }
  }
}

Write-Output '{"ready":true}'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  if ($line -eq 'QUIT') { break }
  try {
    if ($line -notmatch '^READ ([0-9]+)(?: (chromium|gecko))?$') {
      [pscustomobject]@{ found = $false; url = ''; error = 'invalid request' } | ConvertTo-Json -Compress
      continue
    }
    $requestedHandle = [IntPtr][long]$Matches[1]
    $requestedFamily = if ($Matches[2]) { $Matches[2] } else { 'chromium' }
    Read-Document $requestedHandle $requestedFamily | ConvertTo-Json -Compress
  } catch {
    [pscustomobject]@{ found = $false; url = ''; error = 'invalid request' } | ConvertTo-Json -Compress
  }
}
"""


@dataclass(frozen=True)
class WindowsBrowserUiaResult:
    url: str | None
    error: str | None
    # "normal" is reserved for a future positive, locale-independent proof.
    # Today's Windows UIA host reports unknown or proven Gecko private only.
    privacy_state: Literal["unknown", "normal", "private"] = "unknown"


def is_live_uia_browser(app_name: str | None) -> bool:
    return app_name in _SUPPORTED_BROWSERS


def _uia_family(app_name: str | None) -> str:
    return "gecko" if app_name in _GECKO_BROWSERS else "chromium"


def normalize_uia_url(value: str | None) -> str | None:
    """Validate an explicit Document URL without inventing or rewriting identity."""
    if not isinstance(value, str) or not re.match(r"^https?://", value, re.IGNORECASE):
        return None
    cleaned = value
    if (any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in cleaned)
            or "\\" in cleaned or re.search(r"%(?![0-9a-fA-F]{2})", cleaned)):
        return None
    try:
        parsed = urlparse(cleaned)
    except ValueError:
        return None
    if (parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None):
        return None
    if all(character.isdigit() or character == "." for character in parsed.hostname):
        octets = parsed.hostname.split(".")
        if len(octets) != 4 or any(
            not octet or not octet.isascii() or int(octet) > 255 for octet in octets
        ):
            return None
    try:
        parsed.port
    except ValueError:
        return None
    return cleaned


def parse_uia_response(line: str, family: str = "chromium") -> WindowsBrowserUiaResult:
    try:
        payload = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return WindowsBrowserUiaResult(None, "Windows UIA returned invalid JSON.")
    if not isinstance(payload, dict):
        return WindowsBrowserUiaResult(None, "Windows UIA returned an invalid response.")
    if payload.get("privacy") == "private":
        return WindowsBrowserUiaResult(None, "private browsing window", privacy_state="private")
    # Do not infer a normal Chromium window from an absent private flag. Even a
    # Gecko normal reply is trusted only for a Gecko request to this host.
    privacy_state: Literal["unknown", "normal", "private"] = (
        "normal" if family == "gecko" and payload.get("privacy") == "normal" else "unknown"
    )
    normalized = normalize_uia_url(payload.get("url") if payload.get("found") is True else None)
    if normalized:
        return WindowsBrowserUiaResult(normalized, None, privacy_state=privacy_state)
    error = " ".join(str(payload.get("error") or "document URL unavailable").split())[:240]
    return WindowsBrowserUiaResult(None, error, privacy_state=privacy_state)


def _powershell_executable() -> str:
    system_root = os.environ.get("SystemRoot")
    if not system_root:
        raise RuntimeError("SystemRoot is unavailable; refusing to search for PowerShell.")
    candidate = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if not candidate.is_absolute() or not candidate.is_file():
        raise RuntimeError("Trusted Windows PowerShell executable is unavailable.")
    return str(candidate)


def _readline_with_timeout(stream, timeout_seconds: float) -> str:
    replies: queue.Queue[object] = queue.Queue(maxsize=1)

    def read() -> None:
        try:
            replies.put(stream.readline())
        except BaseException as error:  # the reader must report pipe teardown
            replies.put(error)

    threading.Thread(target=read, daemon=True).start()
    try:
        reply = replies.get(timeout=timeout_seconds)
    except queue.Empty as error:
        raise TimeoutError("Windows UIA response timed out.") from error
    if isinstance(reply, BaseException):
        raise RuntimeError(str(reply))
    if not reply:
        raise RuntimeError("Windows UIA host closed its output pipe.")
    return str(reply).strip()


class _WindowsUiaHost:
    def __init__(self) -> None:
        self._has_completed_request = False
        self._process: subprocess.Popen[str] | None = None
        self._script_path: Path | None = None
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            # UTF-16LE -EncodedCommand exceeds Windows' 32,767-character
            # command-line limit for this host. A private temp script keeps the
            # executable pinned while stdin remains available for requests.
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8-sig", prefix="drifty-uia-", suffix=".ps1", delete=False
            ) as script:
                self._script_path = Path(script.name)
                script.write(_POWERSHELL_UIA_HOST)
            self._process = subprocess.Popen(
                [
                    _powershell_executable(),
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(self._script_path),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=creation_flags,
            )
            if self._process.stdout is None or self._process.stdin is None:
                raise RuntimeError("Windows UIA host pipes are unavailable.")
            ready = _readline_with_timeout(self._process.stdout, _STARTUP_TIMEOUT_SECONDS)
            ready_payload = json.loads(ready)
            if not isinstance(ready_payload, dict) or ready_payload.get("ready") is not True:
                raise RuntimeError("Windows UIA host did not become ready.")
            self._remove_script()
        except Exception:
            self.close()
            raise

    def read(self, hwnd: int, family: str = "chromium") -> WindowsBrowserUiaResult:
        if self._process.poll() is not None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("Windows UIA host is not running.")
        if family not in {"chromium", "gecko"}:
            raise ValueError("Unsupported Windows UIA browser family.")
        self._process.stdin.write(f"READ {int(hwnd)} {family}\n")
        self._process.stdin.flush()
        timeout_seconds = (
            _REQUEST_TIMEOUT_SECONDS
            if self._has_completed_request
            else _COLD_REQUEST_TIMEOUT_SECONDS
        )
        result = parse_uia_response(
            _readline_with_timeout(self._process.stdout, timeout_seconds), family
        )
        self._has_completed_request = True
        return result

    def close(self) -> None:
        process = getattr(self, "_process", None)
        try:
            if process is None:
                return
            try:
                if process.poll() is not None:
                    return
                if process.stdin is not None:
                    process.stdin.write("QUIT\n")
                    process.stdin.flush()
                process.wait(timeout=1.0)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
                try:
                    process.wait(timeout=1.0)
                except Exception:
                    pass
        finally:
            self._remove_script()

    def _remove_script(self) -> None:
        path = getattr(self, "_script_path", None)
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                return  # PowerShell may still hold the file; close retries.
            self._script_path = None


_host_lock = threading.Lock()
_host: _WindowsUiaHost | None = None


def _close_host() -> None:
    global _host
    with _host_lock:
        if _host is not None:
            _host.close()
            _host = None


atexit.register(_close_host)


def read_live_browser_url(hwnd: int, app_name: str | None) -> WindowsBrowserUiaResult:
    """Read one focused supported-browser URL, restarting a failed host once."""
    if sys.platform != "win32" or not is_live_uia_browser(app_name):
        return WindowsBrowserUiaResult(None, "Windows UIA is not applicable.")
    global _host
    with _host_lock:
        for attempt in range(2):
            try:
                if _host is None:
                    _host = _WindowsUiaHost()
                return _host.read(hwnd, _uia_family(app_name))
            except Exception as error:
                if _host is not None:
                    try:
                        _host.close()
                    except Exception:
                        pass
                    _host = None
                if attempt == 1:
                    message = " ".join(str(error).split())[:240]
                    return WindowsBrowserUiaResult(None, message or "Windows UIA failed.")
    return WindowsBrowserUiaResult(None, "Windows UIA failed.")
