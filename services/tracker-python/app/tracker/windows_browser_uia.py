"""Live allowlisted-browser address-bar capture through a Windows UIA host.

The tracker is stdlib-only, so it cannot depend on pywin32/comtypes. Windows
PowerShell already ships the managed UI Automation assemblies; one hidden,
long-lived child loads them once and answers bounded HWND requests over a
private stdin/stdout pipe. Raw URLs never leave the local tracker process.
"""

from __future__ import annotations

import atexit
import base64
import json
import os
import queue
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


_STARTUP_TIMEOUT_SECONDS = 20.0
_REQUEST_TIMEOUT_SECONDS = 2.0
_SUPPORTED_BROWSERS = {
    "Google Chrome",
    "Google Chrome Beta",
    "Google Chrome Dev",
    "Google Chrome Canary",
    "Microsoft Edge",
    "Brave Browser",
}

_POWERSHELL_UIA_HOST = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Is-BrowserToolbarEdit($edit, $root) {
  $editRect = $edit.Current.BoundingRectangle
  $rootRect = $root.Current.BoundingRectangle
  if ($editRect.Height -le 0 -or $rootRect.Height -le 0) { return $false }
  $chromeBottom = [Math]::Min($rootRect.Top + 220, $rootRect.Top + ($rootRect.Height * 0.25))
  if ($editRect.Top -ge $chromeBottom) { return $false }

  $hasToolbar = $false
  $hasWindow = $false
  $ancestor = $walker.GetParent($edit)
  for ($depth = 0; $depth -lt 16 -and $null -ne $ancestor; $depth += 1) {
    if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
      return $false
    }
    if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::ToolBar) {
      $hasToolbar = $true
    }
    if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
      $hasWindow = $true
      break
    }
    $ancestor = $walker.GetParent($ancestor)
  }
  return ($hasToolbar -and $hasWindow)
}

function Looks-Like-WebLocation([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match '\s') { return $false }
  $hasScheme = $value -match '^[a-z][a-z0-9+.-]*://'
  $candidate = if ($hasScheme) { $value } else { 'https://' + $value }
  try {
    $uri = [Uri]$candidate
    if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host)) {
      return $false
    }
    $hostKind = [Uri]::CheckHostName($uri.Host)
    if ($uri.Host -match '^[0-9.]+$' -and $hostKind -ne [UriHostNameType]::IPv4) {
      return $false
    }
    if ($hasScheme) { return $true }
    return ($uri.Host -eq 'localhost' -or
      $hostKind -in @([UriHostNameType]::IPv4, [UriHostNameType]::IPv6) -or
      ($hostKind -eq [UriHostNameType]::Dns -and $uri.Host.Contains('.')))
  } catch { return $false }
}

function Read-AddressBar([IntPtr]$handle) {
  try {
    $root = $auto::FromHandle($handle)
    if ($null -eq $root) {
      return [pscustomobject]@{ found = $false; url = ''; error = 'window element not found' }
    }
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    foreach ($edit in $edits) {
      if (-not (Is-BrowserToolbarEdit $edit $root)) { continue }
      $valuePattern = $null
      if (-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        continue
      }
      $value = $valuePattern.Current.Value
      if ([string]::IsNullOrWhiteSpace($value)) { continue }
      $trimmed = $value.Trim()
      if (Looks-Like-WebLocation $trimmed) {
        return [pscustomobject]@{ found = $true; url = $trimmed; error = '' }
      }
    }
    return [pscustomobject]@{ found = $false; url = ''; error = 'no URL-shaped edit control value' }
  } catch {
    return [pscustomobject]@{ found = $false; url = ''; error = $_.Exception.Message }
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
    if ($line -notmatch '^READ ([0-9]+)$') {
      [pscustomobject]@{ found = $false; url = ''; error = 'invalid request' } | ConvertTo-Json -Compress
      continue
    }
    Read-AddressBar ([IntPtr][long]$Matches[1]) | ConvertTo-Json -Compress
  } catch {
    [pscustomobject]@{ found = $false; url = ''; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
"""


@dataclass(frozen=True)
class WindowsBrowserUiaResult:
    url: str | None
    error: str | None


def is_live_uia_browser(app_name: str | None) -> bool:
    return app_name in _SUPPORTED_BROWSERS


def normalize_uia_url(value: str | None) -> str | None:
    """Return an absolute HTTP(S) URL or refuse a non-URL UIA value."""
    cleaned = (value or "").strip()
    if not cleaned or any(character.isspace() for character in cleaned):
        return None
    if "://" not in cleaned:
        cleaned = "https://" + cleaned
    try:
        parsed = urlparse(cleaned)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    if all(character.isdigit() or character == "." for character in parsed.hostname):
        octets = parsed.hostname.split(".")
        if len(octets) != 4 or any(
            not octet or int(octet) > 255 for octet in octets
        ):
            return None
    try:
        parsed.port
    except ValueError:
        return None
    return cleaned


def parse_uia_response(line: str) -> WindowsBrowserUiaResult:
    try:
        payload = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return WindowsBrowserUiaResult(None, "Windows UIA returned invalid JSON.")
    if not isinstance(payload, dict):
        return WindowsBrowserUiaResult(None, "Windows UIA returned an invalid response.")
    normalized = normalize_uia_url(payload.get("url") if payload.get("found") else None)
    if normalized:
        return WindowsBrowserUiaResult(normalized, None)
    error = " ".join(str(payload.get("error") or "address bar URL unavailable").split())[:240]
    return WindowsBrowserUiaResult(None, error)


def _encoded_powershell(script: str) -> str:
    return base64.b64encode(script.encode("utf-16le")).decode("ascii")


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
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._process = subprocess.Popen(
            [
                _powershell_executable(),
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                _encoded_powershell(_POWERSHELL_UIA_HOST),
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
            self.close()
            raise RuntimeError("Windows UIA host pipes are unavailable.")
        try:
            ready = _readline_with_timeout(self._process.stdout, _STARTUP_TIMEOUT_SECONDS)
            ready_payload = json.loads(ready)
            if not isinstance(ready_payload, dict) or ready_payload.get("ready") is not True:
                raise RuntimeError("Windows UIA host did not become ready.")
        except Exception:
            self.close()
            raise

    def read(self, hwnd: int) -> WindowsBrowserUiaResult:
        if self._process.poll() is not None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("Windows UIA host is not running.")
        self._process.stdin.write(f"READ {int(hwnd)}\n")
        self._process.stdin.flush()
        return parse_uia_response(
            _readline_with_timeout(self._process.stdout, _REQUEST_TIMEOUT_SECONDS)
        )

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return
        try:
            if process.stdin is not None:
                process.stdin.write("QUIT\n")
                process.stdin.flush()
            process.wait(timeout=1.0)
        except Exception:
            process.kill()
            try:
                process.wait(timeout=1.0)
            except Exception:
                pass


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
                return _host.read(hwnd)
            except Exception as error:
                if _host is not None:
                    _host.close()
                    _host = None
                if attempt == 1:
                    message = " ".join(str(error).split())[:240]
                    return WindowsBrowserUiaResult(None, message or "Windows UIA failed.")
    return WindowsBrowserUiaResult(None, "Windows UIA failed.")
