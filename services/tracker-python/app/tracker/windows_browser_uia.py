"""Live allowlisted-browser Document URL capture through a Windows UIA host.

The tracker is stdlib-only, so it cannot depend on pywin32/comtypes. Windows
PowerShell already ships the managed UI Automation assemblies; one hidden,
long-lived child loads them once and answers bounded HWND requests over a
private stdin/stdout pipe. Raw URLs never leave the local tracker process.

With the Content context setting on, the same host can also read bounded
visible page clues (headings and short viewport text) from the one Document
its immediately preceding URL read validated. That reader is compiled only on
its first request, so it costs nothing while the setting is off.
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
import time
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
# The clue reader enforces its own budget on a separate thread and answers
# within budget + 40ms. Its first request also compiles the reader once.
_CLUES_REPLY_SLACK_SECONDS = 0.5
_CLUES_COLD_REPLY_SLACK_SECONDS = 8.0
_CLUES_MAX_BUDGET_MS = 620
_CLUES_MIN_BUDGET_MS = 100
_EXIT_WAIT_SECONDS = 0.5
_EXIT_LAUNCH_WAIT_SECONDS = 0.5
# Track a host before its constructor awaits readiness: it has an owned child
# then, but is not yet published in _host. Shutdown must not wait for the read
# lock, and must also prevent a cancelled read from spawning its retry host.
_host_shutdown = threading.Event()
_owned_hosts_lock = threading.Lock()
_owned_hosts: set[_WindowsUiaHost] = set()
_SUPPORTED_BROWSERS = {
    "Google Chrome",
    "Google Chrome Beta",
    "Google Chrome Dev",
    "Google Chrome Canary",
    "Microsoft Edge",
    "Brave Browser",
    "Comet",
    "Opera",
    "Vivaldi",
    "Whale",
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
# Vivaldi nests every page inside its own interface document (measured 8.2).
_VIVALDI_BROWSERS = {"Vivaldi"}
# Whale titles private windows like normal ones; its profile button names them (measured 5.39).
_WHALE_BROWSERS = {"Whale"}

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
# windows expose no element with these DOM classes or ids. They are language
# independent, unlike the window title. Firefox 157 replaced the icon/label
# pair with an indicator toolbar button, and private windows also show the
# "Clear private session" button (DOM id reset-pbm-toolbar-button).
$privateIndicatorCondition = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'private-browsing-indicator-icon')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'private-browsing-indicator-label')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'private-browsing-indicator-button toolbarbutton-1')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::AutomationIdProperty, 'reset-pbm-toolbar-button')))
# Vivaldi draws its whole interface as one web document (this built-in page)
# and nests each tab's page inside it under URL-less webview Documents. Only a
# private window shows the address bar's private-window indicator class, which
# is language independent (measured 8.2 on Windows; macOS uses the same class).
# An unknown private state does not withhold a page (owner decision
# 2026-10-13): only the indicator's presence marks a private window. Without
# it, as with a hidden address bar or a tree that is still being built, the
# window counts as normal.
$vivaldiInterfaceUrl = 'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html'
$vivaldiPrivateCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ClassNameProperty, 'UrlBar-PrivateWindowIndicator')
# Whale 5.39 and Chrome 155 give a private window the same title as a normal
# one. Only the profile button differs, and its name is localized. Measured:
# the Korean UI names it "secret mode" (Whale adds "is in use"; the first label
# spells "secret mode" in Hangul) and the English UI "Incognito" (Whale: "You're
# Incognito"); a normal window shows the profile name. The button precedes the
# page in the tree. Other UI languages stay undetected. Edge has no such button
# (its title carries [InPrivate]); Brave and Opera showed none either.
$avatarButtonCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ClassNameProperty, 'AvatarToolbarButton')
$profileIncognitoLabels = @(
  (-join ([char[]](0xC2DC, 0xD06C, 0xB9BF, 0x20, 0xBAA8, 0xB4DC))),
  'Incognito')
# Every measured Chromium browser names the pane directly under its window
# "<page title> - <browser>" and appends a parenthesized mode label only to a
# private or guest window: Chrome "(Incognito)", Edge "(InPrivate)", Brave
# "(Private)", Opera "(Private)", Whale "(Incognito)", localized in Korean,
# German and Japanese (fullwidth parentheses). The label's text is localized;
# its closing parenthesis is not. This is the same parenthesized label macOS
# already rejects in the accessibility window title. A normal window whose
# name ended in a parenthesis (an unmeasured channel or profile label) would
# only lose its page clues.
$rootViewClasses = @('BrowserRootView', 'BraveBrowserRootView', 'RootView')
$rootViewCondition = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'BrowserRootView')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'BraveBrowserRootView')),
  (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'RootView')))

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

# Chrome draws parts of its own interface as web documents: the suggestion list
# and an icon in the location bar while the address is being edited, and side
# panel pages such as the reading list (measured Chrome 158). None is the tab's
# page. Counted as pages, they made the window look ambiguous and dropped its
# URL whenever focus was outside the page.
function Test-ChromiumInterfaceElement($element) {
  return (@('LocationBarView', 'RoundedOmniboxResultsFrame', 'SidePanel') -contains [string]$element.Current.ClassName)
}

function Find-FocusedTopLevelDocument($root, $treeWalker, $focusedElement, [string]$requiredAncestorId = '', [string]$requiredAncestorClass = '', [bool]$skipInterface = $false) {
  if ($null -eq $focusedElement) { return $null }
  $document = $null
  $cursor = $focusedElement
  $exactWindow = $false
  $interfaceSeen = $false
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
    if ($skipInterface -and (Test-ChromiumInterfaceElement $cursor)) { $interfaceSeen = $true }
    $cursor = $treeWalker.GetParent($cursor)
  }
  if (-not $exactWindow) { throw 'document ancestry unavailable' }
  # Focus inside a browser-owned panel is not the page; use the scan instead.
  if ($interfaceSeen -or -not $requiredSeen -or -not $requiredClassSeen) { return $null }
  return $document
}

function Get-DocumentValue($document) {
  $valuePattern = $null
  if (-not $document.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) { return '' }
  return [string]$valuePattern.Current.Value
}

# Documents from $start up to this exact window, innermost first.
function Get-DocumentChain($start, $root, $treeWalker) {
  $chain = New-Object System.Collections.ArrayList
  $cursor = $start
  for ($depth = 0; $depth -lt 96 -and $null -ne $cursor; $depth++) {
    if (Test-SameAutomationElement $cursor $root) { return ,$chain }
    if ($cursor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
    if ($cursor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) { [void]$chain.Add($cursor) }
    $cursor = $treeWalker.GetParent($cursor)
  }
  throw 'document ancestry unavailable'
}

# A Vivaldi page is the first Document with a value inside the window's
# interface document, below only URL-less webview Documents.
function Select-VivaldiPage($chain) {
  $last = $chain.Count - 1
  if ($last -lt 1 -or -not [string]::Equals((Get-DocumentValue $chain[$last]), $vivaldiInterfaceUrl, [StringComparison]::Ordinal)) {
    return $null
  }
  for ($i = $last - 1; $i -ge 0; $i--) {
    if (-not [string]::IsNullOrEmpty((Get-DocumentValue $chain[$i]))) { return $chain[$i] }
  }
  return $null
}

function Read-VivaldiPage($root, $treeWalker, $condition, $focusedElement, $rootRect) {
  if ($null -ne $focusedElement) {
    $focusedPage = Select-VivaldiPage (Get-DocumentChain $focusedElement $root $treeWalker)
    if ($null -ne $focusedPage) {
      $focusedUrl = Read-ValidatedDocumentUrl $focusedPage $rootRect
      $script:lastPage = $focusedPage
      return $focusedUrl
    }
  }
  # Focus in the address bar or a panel: exactly one visible page must remain.
  $count = 0
  $url = ''
  $selected = $null
  foreach ($document in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
    $offscreen = $document.Current.IsOffscreen
    if ($offscreen -eq $true) { continue }
    if ($offscreen -ne $false) { throw 'document visibility unavailable' }
    $page = Select-VivaldiPage (Get-DocumentChain $document $root $treeWalker)
    if ($null -eq $page -or -not (Test-SameAutomationElement $page $document)) { continue }
    $count++
    if ($count -gt 1) { throw 'multiple visible top-level documents' }
    $url = Read-ValidatedDocumentUrl $document $rootRect
    $selected = $document
  }
  if ($count -ne 1) { throw 'document URL unavailable' }
  $script:lastPage = $selected
  return $url
}

function Test-VivaldiPrivateWindow($root) {
  foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $vivaldiPrivateCondition)) {
    if (Test-ClassToken $element 'UrlBar-PrivateWindowIndicator') { return $true }
  }
  return $false
}

function Test-ProfileButtonIncognito($root) {
  $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $avatarButtonCondition)
  if ($null -eq $button) { return $false }
  $name = [string]$button.Current.Name
  foreach ($label in $profileIncognitoLabels) {
    if ($name.IndexOf($label, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}

function Test-RootViewPrivateLabel($root) {
  foreach ($view in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $rootViewCondition)) {
    if ($rootViewClasses -notcontains [string]$view.Current.ClassName) { continue }
    $name = ([string]$view.Current.Name).TrimEnd()
    if ($name.EndsWith(')') -or $name.EndsWith([string][char]0xFF09)) { return $true }
  }
  return $false
}

# Either signal marks a Chromium-family private window: the root view's
# parenthesized label (any UI language) or the profile button's name.
function Test-ChromiumPrivateWindow($root) {
  return ((Test-RootViewPrivateLabel $root) -or (Test-ProfileButtonIncognito $root))
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
    if ($family -eq 'vivaldi') {
      # Select the page first: that focus query also makes Vivaldi build its interface tree.
      $vivaldiUrl = Read-VivaldiPage $root $treeWalker $condition $focusedElement $rootRect
      if (Test-VivaldiPrivateWindow $root) {
        $script:lastPage = $null
        return [pscustomobject]@{ found = $false; url = ''; error = 'private browsing window'; privacy = 'private' }
      }
      return [pscustomobject]@{ found = $true; url = $vivaldiUrl; error = ''; privacy = $privacy }
    }
    if ($family -eq 'whale' -and (Test-ChromiumPrivateWindow $root)) {
      return [pscustomobject]@{ found = $false; url = ''; error = 'private browsing window'; privacy = 'private' }
    }
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
    $skipInterface = ($family -eq 'chromium' -or $family -eq 'whale')
    $focusedDocument = Find-FocusedTopLevelDocument $root $treeWalker $focusedElement $requiredAncestorId $requiredAncestorClass $skipInterface
    if ($null -ne $focusedDocument) {
      $focusedUrl = Read-ValidatedDocumentUrl $focusedDocument $rootRect ($family -eq 'gecko')
      $script:lastPage = $focusedDocument
      return [pscustomobject]@{ found = $true; url = $focusedUrl; error = ''; privacy = $privacy }
    }

    $documents = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $count = 0
    $url = ''
    $selected = $null
    foreach ($document in $documents) {
      # IsOffscreen and proven nesting are the only exclusion routes. A broken
      # provider/ancestry/rectangle cannot make an ambiguous window look unique.
      $offscreen = $document.Current.IsOffscreen
      if ($offscreen -eq $true) { continue }
      if ($offscreen -ne $false) { throw 'document visibility unavailable' }
      $ancestor = $treeWalker.GetParent($document)
      $nested = $false
      $interface = $false
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
        if ($skipInterface -and (Test-ChromiumInterfaceElement $ancestor)) { $interface = $true }
        $ancestor = $treeWalker.GetParent($ancestor)
      }
      if (-not $exactWindow) { throw 'document ancestry unavailable' }
      if ($nested) { continue }
      if ($interface) { continue }
      # A Firefox Document outside the selected tab panel is browser chrome
      # or a background tab.
      if (-not $requiredSeen -or -not $requiredClassSeen) { continue }
      $count++
      if ($count -gt 1) { throw 'multiple visible top-level documents' }
      $url = Read-ValidatedDocumentUrl $document $rootRect ($family -eq 'gecko')
      $selected = $document
    }
    if ($count -ne 1) { throw 'document URL unavailable' }
    $script:lastPage = $selected
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
  # Every READ replaces the one Document a following CLUES request may inspect.
  $script:lastDocument = $null
  $script:lastPage = $null
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
    if ($result.found -eq $true -and $null -ne $script:lastPage) {
      $script:lastDocument = [pscustomobject]@{ Handle = $handle; OwnerPid = $ownerPid; Family = $family; Document = $script:lastPage; Url = [string]$result.url }
    }
    $script:lastPage = $null
    return $result
  } catch {
    $script:lastPage = $null
    return [pscustomobject]@{ found = $false; url = ''; error = 'document window unavailable or changed' }
  }
}

$script:ClueReaderSource = @'
__DRIFTY_CLUE_READER_SOURCE__
'@
$script:clueReaderState = 'unloaded'
$script:lastDocument = $null
$script:lastPage = $null

function Initialize-ClueReader {
  # Compiled on the first CLUES request only; a failure disables clues, never URL reads.
  if ($script:clueReaderState -eq 'unloaded') {
    try {
      Add-Type -TypeDefinition $script:ClueReaderSource -Language CSharp
      $script:clueReaderState = 'loaded'
    } catch { $script:clueReaderState = 'failed' }
  }
  return ($script:clueReaderState -eq 'loaded')
}

# A Chromium private window (Chrome, Brave, Opera; Edge also by its title)
# keeps its URL and title, as on macOS, but its page text is never read.
function Test-ChromiumClueIncognito([string]$family, $root) {
  return ($family -eq 'chromium' -and (Test-ChromiumPrivateWindow $root))
}

function Read-Clues([IntPtr]$handle, [int]$budgetMs) {
  # Only the Document the immediately preceding READ validated for this exact
  # foreground window is inspected, once. Page text leaves only as capped clues.
  $last = $script:lastDocument
  $script:lastDocument = $null
  try {
    if ($null -eq $last -or $last.Handle -ne $handle -or [DriftyTrackerUiaNative]::GetForegroundWindow() -ne $handle) {
      return [pscustomobject]@{ found = $false; error = 'document unavailable' }
    }
    if (Test-ChromiumClueIncognito ([string]$last.Family) ($auto::FromHandle($handle))) {
      return [pscustomobject]@{ found = $false; error = 'private browsing window' }
    }
    if (-not (Initialize-ClueReader)) { return [pscustomobject]@{ found = $false; error = 'clue reader unavailable' } }
    $title = [string]$last.Document.Current.Name
    $runtimeId = [int[]]@($last.Document.GetRuntimeId())
    if ([string]::IsNullOrWhiteSpace($title) -or $title.Length -gt 500 -or $runtimeId.Count -eq 0) {
      return [pscustomobject]@{ found = $false; error = 'document title unavailable' }
    }
    $clues = [DriftyTrackerBrowserClues.Reader]::Read($handle, [int]$last.OwnerPid, $runtimeId, [string]$last.Url, $title, ($last.Family -eq 'gecko'), $budgetMs)
    if ($clues.ContainsKey('failure')) {
      $reason = [string]$clues['failure']
      if ($reason -notin @('invalid request', 'busy', 'budget', 'window changed', 'document changed', 'document geometry unavailable',
          'incomplete', 'sensitive', 'empty', 'provider unavailable')) { $reason = 'provider unavailable' }
      return [pscustomobject]@{ found = $false; error = $reason }
    }
    return [pscustomobject]@{ found = $true; url = [string]$last.Url; title = $title; headings = [string[]]$clues['headings']; visibleTopic = [string[]]$clues['visibleTopic'] }
  } catch {
    return [pscustomobject]@{ found = $false; error = 'provider unavailable' }
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
    if ($line -match '^CLUES ([0-9]+) ([0-9]+)$') {
      Read-Clues ([IntPtr][long]$Matches[1]) ([int]$Matches[2]) | ConvertTo-Json -Compress
      continue
    }
    if ($line -notmatch '^READ ([0-9]+)(?: (chromium|gecko|vivaldi|whale))?$') {
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


# Bounded visible-page clue reader (C#), compiled by the host on its first CLUES
# request. See docs/research/2026-10-07-browser-coverage-native-follow-up.md V26.
_CLUE_READER_SOURCE = r"""using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace DriftyTrackerBrowserClues {
  [StructLayout(LayoutKind.Sequential)] public struct UiaPoint { public int X, Y; }
  [ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")] public class CUIAutomation {}
  [ComImport, Guid("352ffba8-0973-437c-a61f-f64cafd81df9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IUIAutomationCondition {}
  // Hand-declared UIAutomationCore COM surface: placeholder methods keep every
  // used method at its exact vtable slot. Managed System.Windows.Automation
  // cannot read the ARIA role/landmark properties or bulk-cache a subtree.
  [ComImport, Guid("b32a92b5-bc25-4078-9c08-d7ee95c48e03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IUIAutomationCacheRequest {
    void AddProperty(int propertyId); void _AddPattern(); void _Clone(); void _get_TreeScope();
    void put_TreeScope(int scope); void _get_TreeFilter(); void put_TreeFilter(IUIAutomationCondition filter);
    void _get_AutomationElementMode(); void put_AutomationElementMode(int mode);
  }
  [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IUIAutomation {
    void _CompareElements(); void _CompareRuntimeIds(); void _GetRootElement();
    IUIAutomationElement ElementFromHandle(IntPtr hwnd);
    IUIAutomationElement ElementFromPoint(UiaPoint pt);
    void _GetFocusedElement(); void _GetRootElementBuildCache(); void _ElementFromHandleBuildCache(); void _ElementFromPointBuildCache();
    void _GetFocusedElementBuildCache(); void _CreateTreeWalker(); void _get_ControlViewWalker(); void _get_ContentViewWalker(); void _get_RawViewWalker();
    void _get_RawViewCondition(); void _get_ControlViewCondition(); void _get_ContentViewCondition();
    IUIAutomationCacheRequest CreateCacheRequest();
    IUIAutomationCondition CreateTrueCondition(); void _CreateFalseCondition();
    IUIAutomationCondition CreatePropertyCondition(int propertyId, [MarshalAs(UnmanagedType.Struct)] object value);
  }
  [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IUIAutomationElement {
    void _SetFocus();
    [return: MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] int[] GetRuntimeId();
    IUIAutomationElement FindFirst(int scope, IUIAutomationCondition condition);
    void _FindAll(); void _FindFirstBuildCache(); void _FindAllBuildCache();
    IUIAutomationElement BuildUpdatedCache(IUIAutomationCacheRequest request);
    [return: MarshalAs(UnmanagedType.Struct)] object GetCurrentPropertyValue(int propertyId);
    void _GetCurrentPropertyValueEx();
    [return: MarshalAs(UnmanagedType.Struct)] object GetCachedPropertyValue(int propertyId);
    void _GetCachedPropertyValueEx(); void _GetCurrentPatternAs(); void _GetCachedPatternAs(); void _GetCurrentPattern(); void _GetCachedPattern(); void _GetCachedParent();
    IUIAutomationElementArray GetCachedChildren();
  }
  [ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IUIAutomationElementArray { int get_Length(); IUIAutomationElement GetElement(int index); }

  // Bounded visible-page clues from one top-level browser Document the URL
  // reader has already identified. One bulk UIA cache request inspects the
  // complete page structure before any text is selected, as the macOS helper
  // does. A password field, multi-line editor, incomplete inspection, expired
  // budget or any identity change yields no clues. Text leaves this class only
  // as the capped heading/visible-topic lists.
  public static class Reader {
    const int RuntimeIdId = 30000, BoundingId = 30001, ProcessIdId = 30002, ControlTypeId = 30003, NameId = 30005, IsKeyboardFocusableId = 30009,
      IsPasswordId = 30019, IsOffscreenId = 30022, IsTextPatternAvailableId = 30040, ValueId = 30045, AriaRoleId = 30101, AriaPropertiesId = 30102,
      LandmarkId = 30157, HeadingId = 30173;
    const int ButtonType = 50000, CheckBoxType = 50002, ComboBoxType = 50003, EditType = 50004, LinkType = 50005, MenuType = 50009, MenuBarType = 50010,
      RadioType = 50013, SliderType = 50015, SpinnerType = 50016, TabType = 50018, TabItemType = 50019, TextType = 50020, ToolBarType = 50021,
      TreeType = 50023, CustomType = 50025, GroupType = 50026, DocumentType = 50030, WindowType = 50032, PaneType = 50033;
    const int MaxNodes = 8192, MaxDepth = 32, MaxHits = 24;
    static readonly object Gate = new object();
    static Thread running;

    sealed class Node {
      public int Type, Parent, Depth, End, Heading = -1; public bool Leaf, Offscreen, Excluded, Main, Link, Inline, IdRead;
      public string Name; public double[] Rect; public int[] Id; public IUIAutomationElement Element;
    }
    static Dictionary<string, object> Failure(string reason) { var r = new Dictionary<string, object>(); r["failure"] = reason; return r; }
    static string Clean(string value, int limit) {
      var text = string.Join(" ", (value ?? "").Replace('\ufffc', ' ').Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
      if (text.Length <= limit) return text;
      if (char.IsHighSurrogate(text[limit - 1])) limit--;
      return text.Substring(0, limit).Trim();
    }
    static bool Same(int[] a, int[] b) {
      if (a == null || b == null || a.Length == 0 || a.Length != b.Length) return false;
      for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
      return true;
    }
    static int Number(object v) { return v is int ? (int)v : 0; }
    static bool Flag(object v) { return v is bool && (bool)v; }
    static double[] Rect(object v) {
      var r = v as double[];
      if (r == null || r.Length != 4) return null;
      foreach (var d in r) if (double.IsNaN(d) || double.IsInfinity(d)) return null;
      return r;
    }
    static bool Inside(double[] r, double[] view) {
      return r != null && r[2] >= 1 && r[3] >= 4 && r[0] >= view[0] - 1 && r[1] >= view[1] - 1 &&
        r[0] + r[2] <= view[0] + view[2] + 1 && r[1] + r[3] <= view[1] + view[3] + 1;
    }
    static bool InputType(int t) {
      return t == EditType || t == ButtonType || t == ComboBoxType || t == CheckBoxType || t == RadioType || t == SliderType || t == SpinnerType;
    }
    static bool ExcludedRole(string role) {
      switch (role) {
        case "navigation": case "search": case "banner": case "contentinfo": case "complementary": case "toolbar": case "menu": case "menubar":
        case "dialog": case "alertdialog": case "textbox": case "searchbox": case "combobox": case "tablist": case "tab": case "tree": case "button": return true;
        default: return false;
      }
    }

    // Runs the read on its own MTA thread so a slow provider call cannot hold
    // the host past the budget. A read still running refuses the next request.
    public static Dictionary<string, object> Read(IntPtr hwnd, int ownerPid, int[] documentId, string url, string title, bool gecko, int budgetMs) {
      if (budgetMs < 50 || budgetMs > 620 || documentId == null || documentId.Length == 0 || string.IsNullOrEmpty(url) || string.IsNullOrEmpty(title))
        return Failure("invalid request");
      Thread thread;
      Dictionary<string, object> result = null;
      lock (Gate) {
        if (running != null && running.IsAlive) return Failure("busy");
        thread = new Thread(() => { result = ReadCore(hwnd, ownerPid, documentId, url, title, gecko, budgetMs); });
        thread.IsBackground = true;
        thread.SetApartmentState(ApartmentState.MTA);
        running = thread;
      }
      thread.Start();
      if (!thread.Join(budgetMs + 40)) return Failure("budget");
      return result ?? Failure("provider unavailable");
    }

    static Dictionary<string, object> ReadCore(IntPtr hwnd, int ownerPid, int[] documentId, string url, string title, bool gecko, int budgetMs) {
      var clock = Stopwatch.StartNew();
      var result = new Dictionary<string, object>();
      var held = new List<object>();
      Func<object, object> hold = o => { if (o != null && Marshal.IsComObject(o)) held.Add(o); return o; };
      try {
        var automation = (IUIAutomation)hold(new CUIAutomation());
        var root = (IUIAutomationElement)hold(automation.ElementFromHandle(hwnd));
        if (root == null || Number(root.GetCurrentPropertyValue(ProcessIdId)) != ownerPid) return Failure("window changed");
        var byId = (IUIAutomationCondition)hold(automation.CreatePropertyCondition(RuntimeIdId, documentId));
        var document = (IUIAutomationElement)hold(root.FindFirst(4, byId));
        Func<bool> sameDocument = () => document != null && Same(document.GetRuntimeId(), documentId) &&
          Number(document.GetCurrentPropertyValue(ControlTypeId)) == DocumentType && !Flag(document.GetCurrentPropertyValue(IsOffscreenId)) &&
          (document.GetCurrentPropertyValue(ValueId) as string) == url && (document.GetCurrentPropertyValue(NameId) as string) == title;
        if (!sameDocument()) return Failure("document changed");
        var view = Rect(document.GetCurrentPropertyValue(BoundingId));
        if (view == null || view[2] <= 0 || view[3] <= 0) {
          // Firefox can answer the first bounds query for a just-exposed page with an empty rectangle.
          Thread.Sleep(50);
          view = Rect(document.GetCurrentPropertyValue(BoundingId));
        }
        var frame = Rect(root.GetCurrentPropertyValue(BoundingId));
        if (view == null || frame == null || view[2] <= 0 || view[3] <= 0) return Failure("document geometry unavailable");
        // Only the part of the page inside the browser window can be visible.
        double left = Math.Max(view[0], frame[0]), top = Math.Max(view[1], frame[1]);
        double right = Math.Min(view[0] + view[2], frame[0] + frame[2]), bottom = Math.Min(view[1] + view[3], frame[1] + frame[3]);
        if (right - left <= 0 || bottom - top <= 0) return Failure("document geometry unavailable");
        view = new[] { left, top, right - left, bottom - top };

        var request = (IUIAutomationCacheRequest)hold(automation.CreateCacheRequest());
        foreach (var p in new[] { RuntimeIdId, BoundingId, ControlTypeId, NameId, IsPasswordId, IsOffscreenId, AriaRoleId, AriaPropertiesId,
            LandmarkId, HeadingId, IsKeyboardFocusableId, IsTextPatternAvailableId })
          request.AddProperty(p);
        request.put_TreeScope(7);
        request.put_TreeFilter((IUIAutomationCondition)hold(automation.CreateTrueCondition()));
        request.put_AutomationElementMode(0);
        var cached = (IUIAutomationElement)hold(document.BuildUpdatedCache(request));
        if (cached == null || clock.ElapsedMilliseconds > budgetMs) return Failure("budget");

        // Complete structural inspection, in document order, before any text selection.
        var nodes = new List<Node>();
        var stack = new Stack<KeyValuePair<IUIAutomationElement, int>>();
        stack.Push(new KeyValuePair<IUIAutomationElement, int>(cached, -1));
        bool mainObserved = false;
        while (stack.Count > 0) {
          var item = stack.Pop();
          var e = item.Key; int parent = item.Value;
          if (nodes.Count >= MaxNodes) return Failure("incomplete");
          var n = new Node { Parent = parent, Depth = parent < 0 ? 0 : nodes[parent].Depth + 1, Type = Number(e.GetCachedPropertyValue(ControlTypeId)), Element = e };
          if (n.Depth >= MaxDepth) return Failure("incomplete");
          if (parent >= 0) { var p = nodes[parent]; n.Excluded = p.Excluded; n.Main = p.Main; n.Link = p.Link; n.Heading = p.Heading; }
          int index = nodes.Count;
          var children = (IUIAutomationElementArray)hold(e.GetCachedChildren());
          int count = children == null ? 0 : children.get_Length();
          n.Leaf = count == 0;
          if (n.Type == EditType || n.Type == GroupType || n.Type == DocumentType || n.Type == CustomType || n.Type == PaneType) {
            // A password field, textarea or rich-text editor (macOS AXSecureTextField/AXTextArea)
            // excludes the whole page. Chromium marks textareas and contenteditable roots
            // multiline=true. Gecko exposes no multi-line signal, so any text box other than a
            // search, combo or spin box, and any focusable text group, excludes the page there.
            string aria = (e.GetCachedPropertyValue(AriaPropertiesId) as string) ?? "";
            bool sensitive = (n.Type == EditType && Flag(e.GetCachedPropertyValue(IsPasswordId))) ||
              aria.IndexOf("multiline=true", StringComparison.OrdinalIgnoreCase) >= 0;
            if (gecko && !sensitive) {
              string editRole = (e.GetCachedPropertyValue(AriaRoleId) as string) ?? "";
              sensitive = (n.Type == EditType && editRole != "searchbox" && editRole != "combobox" && editRole != "spinbutton") ||
                (n.Type == GroupType && Flag(e.GetCachedPropertyValue(IsKeyboardFocusableId)) && Flag(e.GetCachedPropertyValue(IsTextPatternAvailableId)));
            }
            if (sensitive) return Failure("sensitive");
          }
          if (n.Type == TextType && n.Leaf) {
            n.Name = e.GetCachedPropertyValue(NameId) as string;
            n.Rect = Rect(e.GetCachedPropertyValue(BoundingId));
            n.Offscreen = Flag(e.GetCachedPropertyValue(IsOffscreenId));
          } else {
            string role = (e.GetCachedPropertyValue(AriaRoleId) as string) ?? "";
            int landmark = Number(e.GetCachedPropertyValue(LandmarkId));
            if ((index > 0 && (n.Type == DocumentType || n.Type == WindowType)) || InputType(n.Type) || ExcludedRole(role) ||
                landmark == 80003 || landmark == 80004 || n.Type == MenuType || n.Type == MenuBarType || n.Type == ToolBarType ||
                n.Type == TabType || n.Type == TabItemType || n.Type == TreeType) n.Excluded = true;
            if (landmark == 80002 || role == "main") n.Main = true;
            if (n.Type == LinkType || role == "link") n.Link = true;
            int level = Number(e.GetCachedPropertyValue(HeadingId));
            // Chrome reports HeadingLevel; Edge 145 only reports the ARIA heading role.
            if ((level >= 80051 && level <= 80059) || role == "heading") n.Heading = index;
            // Gecko exposes paragraphs as Text with the paragraph role; they are blocks, not inline runs.
            n.Inline = n.Type == LinkType || (n.Type == TextType && n.Heading != index && role != "paragraph" && role != "blockquote");
          }
          mainObserved |= n.Main;
          nodes.Add(n);
          for (int i = count - 1; i >= 0; i--) stack.Push(new KeyValuePair<IUIAutomationElement, int>((IUIAutomationElement)hold(children.GetElement(i)), index));
        }
        // Subtree ranges: node i covers [i, End).
        for (int i = nodes.Count - 1; i >= 0; i--) {
          if (nodes[i].End == 0) nodes[i].End = i + 1;
          int p = nodes[i].Parent;
          if (p >= 0 && nodes[p].End < nodes[i].End) nodes[p].End = nodes[i].End;
        }
        if (clock.ElapsedMilliseconds > budgetMs) return Failure("budget");

        int hits = 0;
        // Runtime ids are read only inside a block being checked.
        Func<int, int[]> idOf = k => {
          var m = nodes[k];
          if (!m.IdRead) { m.IdRead = true; m.Id = m.Element.GetCachedPropertyValue(RuntimeIdId) as int[]; }
          return m.Id;
        };
        // The center of a visible leaf must hit inside the block that owns it,
        // so text under an overlay, dialog or another window is not admitted. The
        // hit may be the leaf or any element of the block (Gecko returns the paragraph).
        Func<int, int, bool> visibleIn = (leaf, block) => {
          if (hits >= MaxHits) return false;
          hits++;
          var r = nodes[leaf].Rect;
          var at = (IUIAutomationElement)hold(automation.ElementFromPoint(new UiaPoint { X = (int)(r[0] + r[2] / 2), Y = (int)(r[1] + r[3] / 2) }));
          var id = at == null ? null : at.GetRuntimeId();
          if (id == null) return false;
          for (int k = block; k < nodes[block].End; k++) if (Same(idOf(k), id)) return true;
          return false;
        };
        // A block is the nearest non-inline ancestor. It is assembled only when all of
        // its descendants are inline text or links, every non-blank leaf is fully inside
        // the visible page, and its first and last leaves hit inside it.
        Func<int, bool, string> assemble = (block, linkOnly) => {
          var text = new StringBuilder(); int first = -1, last = -1; bool plain = false;
          for (int j = block + 1; j < nodes[block].End; j++) {
            var m = nodes[j];
            if (!(m.Inline || (m.Type == TextType && m.Leaf))) return null;
            if (!m.Leaf) continue;
            if (m.Type != TextType) return null;
            string piece = m.Name ?? "";
            if (piece.Trim().Length == 0) { text.Append(piece); continue; }
            if (m.Offscreen || !Inside(m.Rect, view)) return null;
            if (!m.Link) plain = true;
            if (first < 0) first = j;
            last = j;
            text.Append(piece);
            if (text.Length > 2048) return null;
          }
          if (first < 0 || (!plain && !linkOnly)) return null;
          if (!visibleIn(first, block) || (last != first && !visibleIn(last, block))) return null;
          return text.ToString();
        };
        var headings = new List<string>(); var topic = new List<string>(); var shortTopic = new List<string>(); var seenBlocks = new HashSet<int>();
        int headingChars = 0, topicChars = 0;
        string lowerTitle = Clean(title, 500).ToLowerInvariant();
        for (int i = 0; i < nodes.Count && (headings.Count < 3 || topic.Count < 4); i++) {
          var n = nodes[i];
          if (n.Type != TextType || !n.Leaf || n.Excluded || n.Offscreen || Clean(n.Name, 4).Length == 0 || !Inside(n.Rect, view)) continue;
          if (clock.ElapsedMilliseconds > budgetMs) return Failure("budget");
          if (n.Heading >= 0) {
            int h = n.Heading;
            if (!seenBlocks.Add(h) || headings.Count >= 3) continue;
            string clean = Clean(assemble(h, true), 80);
            if (clean.Length == 0 || headings.Contains(clean) || clean.ToLowerInvariant() == lowerTitle || headingChars + clean.Length > 240) continue;
            headings.Add(clean); headingChars += clean.Length;
            continue;
          }
          if (n.Link || (mainObserved && !n.Main) || topic.Count >= 4) continue;
          int block = n.Parent;
          while (block > 0 && nodes[block].Inline) block = nodes[block].Parent;
          if (block < 0 || !seenBlocks.Add(block)) continue;
          string t = Clean(assemble(block, false), 120);
          bool letter = false;
          foreach (char c in t) if (char.IsLetter(c)) { letter = true; break; }
          if (!letter || topic.Contains(t) || shortTopic.Contains(t) || headings.Contains(t) || t.ToLowerInvariant() == lowerTitle) continue;
          // Sentence-like blocks come first; short labels (ranks, relative times) only fill what is left.
          if (t.Length < 24) { if (shortTopic.Count < 4) shortTopic.Add(t); continue; }
          if (topicChars + t.Length > 240) continue;
          topic.Add(t); topicChars += t.Length;
        }
        foreach (var t in shortTopic) {
          if (topic.Count >= 4 || topicChars + t.Length > 240) break;
          topic.Add(t); topicChars += t.Length;
        }
        if (!sameDocument() || Number(root.GetCurrentPropertyValue(ProcessIdId)) != ownerPid) return Failure("document changed");
        if (clock.ElapsedMilliseconds > budgetMs) return Failure("budget");
        if (headings.Count == 0 && topic.Count == 0) return Failure("empty");
        result["headings"] = headings.ToArray();
        result["visibleTopic"] = topic.ToArray();
        return result;
      } catch (Exception) {
        // Provider exception text could contain page data; only a fixed reason leaves.
        return Failure("provider unavailable");
      } finally {
        for (int i = held.Count - 1; i >= 0; i--) { try { Marshal.ReleaseComObject(held[i]); } catch { } }
      }
    }
  }
}
"""
_POWERSHELL_UIA_HOST = _POWERSHELL_UIA_HOST.replace("__DRIFTY_CLUE_READER_SOURCE__", _CLUE_READER_SOURCE)


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
    if app_name in _GECKO_BROWSERS:
        return "gecko"
    if app_name in _VIVALDI_BROWSERS:
        return "vivaldi"
    return "whale" if app_name in _WHALE_BROWSERS else "chromium"


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


@dataclass(frozen=True)
class WindowsBrowserCluesResult:
    """Capped visible-page clues bound to the Document URL and name they came from."""

    url: str | None = None
    title: str | None = None
    clues: dict | None = None
    error: str | None = None


def parse_clues_response(line: str) -> WindowsBrowserCluesResult:
    """Accept only a complete, already-capped clue reply; reject rather than trim."""
    from app.tracker.browser_content import normalize_clues

    try:
        payload = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return WindowsBrowserCluesResult(error="Windows page clues returned invalid JSON.")
    if not isinstance(payload, dict):
        return WindowsBrowserCluesResult(error="Windows page clues returned an invalid response.")
    if payload.get("found") is not True:
        error = " ".join(str(payload.get("error") or "page clues unavailable").split())[:240]
        return WindowsBrowserCluesResult(error=error)
    if set(payload) - {"found", "url", "title", "headings", "visibleTopic"}:
        return WindowsBrowserCluesResult(error="Windows page clues returned an invalid response.")
    url = normalize_uia_url(payload.get("url"))
    title = payload.get("title")
    if not url or not isinstance(title, str) or not title.strip() or len(title) > 500:
        return WindowsBrowserCluesResult(error="Windows page clues lost their page identity.")
    lists = {key: payload.get(key) for key in ("headings", "visibleTopic") if payload.get(key) not in (None, [])}
    clues = normalize_clues(lists) if lists else None
    if clues is None:
        return WindowsBrowserCluesResult(error="Windows page clues were empty or out of bounds.")
    return WindowsBrowserCluesResult(url=url, title=title, clues=clues)


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


class _OwnedUiaProcess(subprocess.Popen):
    """Publish process ownership before the blocking stdlib initializer."""

    def __init__(self, owner: _WindowsUiaHost, command, **kwargs) -> None:
        with _owned_hosts_lock:
            if _host_shutdown.is_set():
                raise RuntimeError("Windows UIA capture is stopped.")
            owner._launch_pending = True
            owner._process = self
        try:
            super().__init__(command, **kwargs)
        finally:
            owner._launch_finished.set()


class _WindowsUiaHost:
    def __init__(self) -> None:
        self._has_completed_request = False
        self._clue_reader_requested = False
        self._process: subprocess.Popen[str] | None = None
        self._script_path: Path | None = None
        self._launch_pending = False
        self._launch_finished = threading.Event()
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        with _owned_hosts_lock:
            if _host_shutdown.is_set():
                raise RuntimeError("Windows UIA capture is stopped.")
            _owned_hosts.add(self)
        try:
            # UTF-16LE -EncodedCommand exceeds Windows' 32,767-character
            # command-line limit for this host. A private temp script keeps the
            # executable pinned while stdin remains available for requests.
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8-sig", prefix="drifty-uia-", suffix=".ps1", delete=False
            ) as script:
                self._script_path = Path(script.name)
                script.write(_POWERSHELL_UIA_HOST)
            if _host_shutdown.is_set():
                raise RuntimeError("Windows UIA capture is stopped.")
            self._process = _OwnedUiaProcess(
                self,
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
            # Exit can race process creation. Ownership was already published
            # before Popen.__init__, and this also refuses post-exit reads.
            if _host_shutdown.is_set():
                raise RuntimeError("Windows UIA capture is stopped.")
            if self._process.stdout is None or self._process.stdin is None:
                raise RuntimeError("Windows UIA host pipes are unavailable.")
            ready = _readline_with_timeout(self._process.stdout, _STARTUP_TIMEOUT_SECONDS)
            ready_payload = json.loads(ready)
            if not isinstance(ready_payload, dict) or ready_payload.get("ready") is not True:
                raise RuntimeError("Windows UIA host did not become ready.")
            if _host_shutdown.is_set():
                raise RuntimeError("Windows UIA capture is stopped.")
            self._remove_script()
        except Exception:
            self.close()
            raise

    def read(self, hwnd: int, family: str = "chromium") -> WindowsBrowserUiaResult:
        if self._process.poll() is not None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("Windows UIA host is not running.")
        if family not in {"chromium", "gecko", "vivaldi", "whale"}:
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

    def read_clues(self, hwnd: int, budget_ms: int) -> WindowsBrowserCluesResult:
        if self._process.poll() is not None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("Windows UIA host is not running.")
        if type(budget_ms) is not int or not _CLUES_MIN_BUDGET_MS <= budget_ms <= _CLUES_MAX_BUDGET_MS:
            raise ValueError("Unsupported Windows page clue budget.")
        self._process.stdin.write(f"CLUES {int(hwnd)} {budget_ms}\n")
        self._process.stdin.flush()
        # The first request compiles the reader; later ones answer within budget.
        slack = (
            _CLUES_REPLY_SLACK_SECONDS
            if getattr(self, "_clue_reader_requested", False)
            else _CLUES_COLD_REPLY_SLACK_SECONDS
        )
        self._clue_reader_requested = True
        return parse_clues_response(
            _readline_with_timeout(self._process.stdout, budget_ms / 1000 + slack)
        )

    def close(self) -> None:
        if _host_shutdown.is_set():
            self.abort()
            return
        process = getattr(self, "_process", None)
        if process is not None and not self._process_ready(process):
            self.abort()
            return
        stopped = process is None
        try:
            if process is None:
                return
            try:
                if process.poll() is not None:
                    stopped = True
                    return
                if process.stdin is not None:
                    process.stdin.write("QUIT\n")
                    process.stdin.flush()
                process.wait(timeout=1.0)
                stopped = True
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
                try:
                    process.wait(timeout=1.0)
                    stopped = True
                except Exception:
                    pass
        finally:
            self._remove_script()
            if stopped:
                self._forget_owned_host()

    def abort(self) -> None:
        """Bounded exit cleanup, independent of an in-flight pipe/provider read."""
        process = getattr(self, "_process", None)
        finished = getattr(self, "_launch_finished", None)
        pending = getattr(self, "_launch_pending", False)
        if pending and finished is not None and not finished.is_set() and not self._process_ready(process):
            # Native creation may not have published a PID/handle yet. Allow a
            # bounded publication wait, never the foreground lock or a join.
            deadline = time.monotonic() + _EXIT_LAUNCH_WAIT_SECONDS
            while not finished.is_set() and not self._process_ready(process):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                finished.wait(min(0.01, remaining))
                process = getattr(self, "_process", None)
        ready = self._process_ready(process)
        # An incomplete launch is still owned even if no process is visible
        # yet. Forgetting it here made actual interpreter exit leak a child
        # created inside a Popen initializer that had not returned to the host.
        stopped = not ready and (not pending or finished is None or finished.is_set())
        try:
            if ready:
                try:
                    process.kill()
                except Exception:
                    pass
                try:
                    process.wait(timeout=_EXIT_WAIT_SECONDS)
                    stopped = True
                except Exception:
                    pass
        finally:
            self._remove_script()
            if stopped:
                self._forget_owned_host()

    def _process_ready(self, process) -> bool:
        if process is None:
            return False
        if not hasattr(self, "_launch_finished"):
            return True  # Existing direct host fixtures are already initialized.
        if getattr(process, "pid", None) is None:
            return False
        return os.name != "nt" or getattr(process, "_handle", None) is not None

    def _forget_owned_host(self) -> None:
        with _owned_hosts_lock:
            _owned_hosts.discard(self)

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
    _host_shutdown.set()
    with _owned_hosts_lock:
        owned = list(_owned_hosts)
    # Do not acquire _host_lock: its owner may still be in the 30s cold read or
    # waiting for constructor readiness. Both are released by terminating the
    # separately registered child, without allowing another host to launch.
    _host = None
    for host in owned:
        host.abort()


atexit.register(_close_host)


def read_live_browser_url(hwnd: int, app_name: str | None) -> WindowsBrowserUiaResult:
    """Read one focused supported-browser URL, restarting a failed host once."""
    if sys.platform != "win32" or not is_live_uia_browser(app_name):
        return WindowsBrowserUiaResult(None, "Windows UIA is not applicable.")
    global _host
    with _host_lock:
        for attempt in range(2):
            if _host_shutdown.is_set():
                return WindowsBrowserUiaResult(None, "Windows UIA capture is stopped.")
            try:
                if _host is None:
                    _host = _WindowsUiaHost()
                host = _host
                if _host_shutdown.is_set():
                    host.abort()
                    _host = None
                    return WindowsBrowserUiaResult(None, "Windows UIA capture is stopped.")
                result = host.read(hwnd, _uia_family(app_name))
                if _host_shutdown.is_set():
                    return WindowsBrowserUiaResult(None, "Windows UIA capture is stopped.")
                return result
            except Exception as error:
                if _host is not None:
                    try:
                        _host.close()
                    except Exception:
                        pass
                    _host = None
                if _host_shutdown.is_set():
                    return WindowsBrowserUiaResult(None, "Windows UIA capture is stopped.")
                if attempt == 1:
                    message = " ".join(str(error).split())[:240]
                    return WindowsBrowserUiaResult(None, message or "Windows UIA failed.")
    return WindowsBrowserUiaResult(None, "Windows UIA failed.")


def read_live_browser_clues(hwnd: int, app_name: str | None, budget_ms: int) -> WindowsBrowserCluesResult:
    """Read clues from the Document the host's last URL read validated.

    Never starts a host: without a just-validated Document there is nothing to
    read. A failed exchange retires the host so the next URL read starts clean.
    """
    if sys.platform != "win32" or not is_live_uia_browser(app_name):
        return WindowsBrowserCluesResult(error="Windows UIA is not applicable.")
    if type(budget_ms) is not int or not _CLUES_MIN_BUDGET_MS <= budget_ms <= _CLUES_MAX_BUDGET_MS:
        return WindowsBrowserCluesResult(error="Unsupported Windows page clue budget.")
    global _host
    with _host_lock:
        if _host_shutdown.is_set():
            return WindowsBrowserCluesResult(error="Windows UIA capture is stopped.")
        host = _host
        if host is None:
            return WindowsBrowserCluesResult(error="No validated Windows Document is available.")
        try:
            return host.read_clues(hwnd, budget_ms)
        except Exception:
            try:
                host.close()
            except Exception:
                pass
            _host = None
            return WindowsBrowserCluesResult(error="Windows page clues failed.")
