$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$operation = [string]$env:DRIFTY_NUDGE_OPERATION
$operation = $operation.Trim().ToLowerInvariant()
if ($operation -eq '') { $operation = 'close' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if ($operation -eq 'close') {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DriftyTabWindowNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
}
"@
}

$browserProcess = [string]$env:DRIFTY_NUDGE_BROWSER_PROCESS
$browserIdentityRaw = [string]$env:DRIFTY_NUDGE_BROWSER_IDENTITY
$targetUrl = [string]$env:DRIFTY_NUDGE_SITE_URL
$targetDomain = [string]$env:DRIFTY_NUDGE_SITE_DOMAIN
$browserProcess = $browserProcess.Trim().ToLowerInvariant()
$targetUrl = $targetUrl.Trim()
$targetDomain = $targetDomain.Trim().ToLowerInvariant()
$auto = [System.Windows.Automation.AutomationElement]
$tabCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$documentCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$originalSelections = @{}
$originalSelectionKeys = @{}
$originalWindowIdentities = @{}
$replacementSelections = @{}
$originalForegroundWindow = [int64]0
$originalForegroundProcessId = [uint32]0
$foregroundDpi = [uint32]0
$originalFocusedElement = try { $auto::FocusedElement } catch { $null }
if ($operation -in @('locate', 'close_foreground')) {
  [int64]::TryParse([string]$env:DRIFTY_NUDGE_FOREGROUND_HWND, [ref]$originalForegroundWindow) | Out-Null
  [uint32]::TryParse([string]$env:DRIFTY_NUDGE_FOREGROUND_PID, [ref]$originalForegroundProcessId) | Out-Null
  [uint32]::TryParse([string]$env:DRIFTY_NUDGE_FOREGROUND_DPI, [ref]$foregroundDpi) | Out-Null
} else {
  $originalForegroundWindow = [DriftyTabWindowNative]::GetForegroundWindow().ToInt64()
}
if ($operation -eq 'close' -and $originalForegroundWindow -ne 0) {
  [DriftyTabWindowNative]::GetWindowThreadProcessId(
    [IntPtr]$originalForegroundWindow, [ref]$originalForegroundProcessId) | Out-Null
}
$foregroundWindowKey = $null
$attemptedCloseTabKey = $null
$attemptedCloseTabAbsent = $false
$attemptedCloseVerified = $false

function Compare-AutomationElement($left, $right) {
  return [System.Windows.Automation.Automation]::Compare($left, $right)
}

function Normalize-Url([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $cleaned = $value.Trim()
  if (-not [string]::Equals($value, $cleaned, [StringComparison]::Ordinal)) { return '' }
  # An address bar can omit HTTP. Never invent a protocol for a close target.
  if ($cleaned -notmatch '^https?://' -or $cleaned -match '[\s\\]') { return '' }
  try {
    $uri = [Uri]::new($cleaned, [UriKind]::Absolute)
    if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host) -or $uri.UserInfo -ne '') { return '' }
    # Uri normalizes authority/default ports. Path, query and fragment remain
    # case-sensitive identities, including their non-root trailing slashes.
    return ($uri.Scheme.ToLowerInvariant() + '://' + $uri.Authority.ToLowerInvariant() + $uri.PathAndQuery + $uri.Fragment)
  } catch { return '' }
}

function Test-UrlMatch([string]$actual, [string]$expected) {
  $left = Normalize-Url $actual
  $right = Normalize-Url $expected
  return ($left -ne '' -and $right -ne '' -and [string]::Equals($left, $right, [StringComparison]::Ordinal))
}

function Get-TargetCandidates($scan, [string]$explicitUrl) {
  if ($scan.complete -ne $true) { return @() }
  if (-not [string]::IsNullOrWhiteSpace($explicitUrl)) { return @($scan.exact.Values) }
  return @($scan.domain.Values)
}

function Add-TargetCandidate($candidates, $candidate) {
  try {
    # Geometry is a lookup key, not proof that two UIA controls are the same
    # tab. Never let a collision erase a second potentially matching target.
    if ($candidates.ContainsKey($candidate.key) -and
        -not (Compare-AutomationElement $candidates[$candidate.key].tab $candidate.tab)) { return $false }
    $candidates[$candidate.key] = $candidate
    return $true
  } catch { return $false }
}

function Domain-Of([string]$value) {
  $normalized = Normalize-Url $value
  if ($normalized -eq '') { return '' }
  try { return ([Uri]$normalized).DnsSafeHost.ToLowerInvariant() -replace '^www\.', '' } catch { return '' }
}

function Normalize-ExecutablePath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  try {
    return [IO.Path]::GetFullPath($value.Trim()).TrimEnd('\').ToLowerInvariant()
  } catch { return '' }
}

function Test-PositiveRectangle($rect) {
  if ($null -eq $rect) { return $false }
  foreach ($value in @($rect.Left, $rect.Top, $rect.Width, $rect.Height, $rect.Right, $rect.Bottom)) {
    if ($null -eq $value -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) { return $false }
  }
  return ($rect.Width -gt 0 -and $rect.Height -gt 0)
}

function Test-DocumentGeometry($document, $window) {
  try {
    $rect = $document.Current.BoundingRectangle
    $bounds = $window.Current.BoundingRectangle
    return (
      -not $document.Current.IsOffscreen -and
      (Test-PositiveRectangle $rect) -and (Test-PositiveRectangle $bounds) -and
      $rect.Right -gt $bounds.Left -and $rect.Left -lt $bounds.Right -and
      $rect.Bottom -gt $bounds.Top -and $rect.Top -lt $bounds.Bottom)
  } catch { return $false }
}

function Get-ElementWindowDisposition(
    $element, $window, [bool]$rejectDocumentAncestor = $true, [bool]$detectBrowserChrome = $false) {
  try {
    if ($window.Current.NativeWindowHandle -eq 0 -or $window.Current.ProcessId -le 0) { return 'unknown' }
    $hasToolbarAncestor = $false
    $hasFirefoxTabPanelsAncestor = $false
    $ancestor = $walker.GetParent($element)
    for ($depth = 0; $depth -lt 64 -and $null -ne $ancestor; $depth++) {
      $ancestorCurrent = $ancestor.Current
      if ($null -eq $ancestorCurrent -or $null -eq $ancestorCurrent.ControlType) { return 'unknown' }
      $ancestorControlType = $ancestorCurrent.ControlType
      if ($rejectDocumentAncestor -and $ancestorControlType -eq [System.Windows.Automation.ControlType]::Document) { return 'nested_document' }
      if ($detectBrowserChrome -and $ancestorControlType -eq [System.Windows.Automation.ControlType]::ToolBar) {
        $hasToolbarAncestor = $true
      }
      if ($detectBrowserChrome -and $browserProcess -eq 'firefox' -and
          $ancestorControlType -eq [System.Windows.Automation.ControlType]::Pane -and
          [string]::Equals([string]$ancestorCurrent.AutomationId, 'tabbrowser-tabpanels', [StringComparison]::Ordinal)) {
        $hasFirefoxTabPanelsAncestor = $true
      }
      if ($ancestorControlType -eq [System.Windows.Automation.ControlType]::Window) {
        if (Compare-AutomationElement $ancestor $window) {
          # Firefox exposes browser-owned panels (for example its translation
          # popup) as visible Document controls directly under the top-level
          # window. A real selected page is instead rooted in the measured
          # tabbrowser-tabpanels container. Requiring that container prevents
          # browser chrome from making page identity ambiguous.
          if ($detectBrowserChrome -and $browserProcess -eq 'firefox') {
            if ($hasFirefoxTabPanelsAncestor) { return 'exact_window' }
            return 'browser_chrome'
          }
          if ($detectBrowserChrome -and $hasToolbarAncestor) { return 'browser_chrome' }
          return 'exact_window'
        }
        return 'unknown'
      }
      $ancestor = $walker.GetParent($ancestor)
    }
  } catch { return 'unknown' }
  return 'unknown'
}

function Test-ElementWindowAncestry($element, $window, [bool]$rejectDocumentAncestor = $true) {
  return ((Get-ElementWindowDisposition $element $window $rejectDocumentAncestor) -eq 'exact_window')
}

function Is-TopLevelBrowserDocument($document, $window) {
  try {
    return (
      $document.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document -and
      (Test-DocumentGeometry $document $window) -and
      (Test-ElementWindowAncestry $document $window))
  } catch { return $false }
}

function Read-PageIdentity($window) {
  # Require one eligible top-level Document to identify the selected page.
  # No toolbar, page text, accessible name, protocol or domain fallback.
  $unknown = [pscustomobject]@{ state = 'unknown'; url = '' }
  try {
    $documents = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $documentCondition)
    $eligible = @()
    foreach ($document in $documents) {
      if ($document.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document) { continue }
      if ($document.Current.IsOffscreen) { continue }
      $disposition = Get-ElementWindowDisposition $document $window $true $true
      if ($disposition -in @('nested_document', 'browser_chrome')) { continue }
      if ($disposition -ne 'exact_window' -or -not (Test-DocumentGeometry $document $window)) { return $unknown }
      $eligible += $document
    }
    if ($eligible.Count -ne 1) { return $unknown }
    $pattern = $null
    if (-not $eligible[0].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { return $unknown }
    $value = [string]$pattern.Current.Value
    $url = Normalize-Url $value
    if ($url -ne '') { return [pscustomobject]@{ state = 'http_url'; url = $url } }
    # Explicit internal new-tab URLs cannot be HTTP targets. Keep this a small,
    # browser-specific allowlist; unreadable/other internal pages stay unknown.
    $internalUrl = switch ($browserProcess) {
      'chrome' { 'chrome://newtab/' }
      'msedge' { 'edge://newtab/' }
      'brave' { 'brave://newtab/' }
      'firefox' { 'about:newtab' }
      default { '' }
    }
    if ($internalUrl -ne '' -and (
        [string]::Equals($value, $internalUrl, [StringComparison]::Ordinal) -or
        [string]::Equals($value, $internalUrl.TrimEnd('/'), [StringComparison]::Ordinal) -or
        ($browserProcess -eq 'chrome' -and
         [string]::Equals($value, 'chrome://new-tab-page/', [StringComparison]::Ordinal)))) {
      return [pscustomobject]@{ state = 'known_non_target'; url = '' }
    }
    return $unknown
  } catch { return $unknown }
}

function Read-Url($window) {
  $identity = Read-PageIdentity $window
  if ($identity.state -eq 'http_url') { return $identity.url }
  return ''
}

function Read-UrlWithRetry($window, [int]$attempts = 3, [int]$delayMs = 120) {
  if ($attempts -lt 1) { return '' }
  for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
    $url = Read-Url $window
    if ($url -ne '') { return $url }
    if ($attempt + 1 -lt $attempts -and $delayMs -gt 0) { Start-Sleep -Milliseconds $delayMs }
  }
  return ''
}

function Element-Key($window, $tab) {
  $rect = $tab.Current.BoundingRectangle
  return "$($window.Current.ProcessId):$($window.Current.NativeWindowHandle):$([int]$rect.Left):$([int]$rect.Top):$([int]$rect.Width):$([int]$rect.Height)"
}

function Window-Key($window) {
  return "$($window.Current.ProcessId):$($window.Current.NativeWindowHandle)"
}

function Is-ExpectedBrowserTab($tab) {
  try {
    if ($browserProcess -eq 'chrome') {
      # Chromium translation and other toolbar bubbles can expose selected
      # TabItem controls inside the same BrowserRootView. Browser tabs measured
      # on current Chrome use the native Tab -> TabContainerImpl shape.
      if ($tab.Current.ClassName -ne 'Tab') { return $false }
      $parent = $walker.GetParent($tab)
      return (
        $null -ne $parent -and
        $parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Tab -and
        $parent.Current.ClassName -eq 'TabContainerImpl')
    }
    if ($browserProcess -eq 'msedge') {
      # Edge 153 exposes its real tabs as EdgeTab controls under an
      # EdgeTabContainerImpl. Keep this separate from Chrome so a toolbar
      # TabItem or a cross-browser lookalike cannot enter the candidate set.
      if ($tab.Current.ClassName -ne 'EdgeTab') { return $false }
      $parent = $walker.GetParent($tab)
      return (
        $null -ne $parent -and
        $parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Tab -and
        $parent.Current.ClassName -eq 'EdgeTabContainerImpl')
    }
    if ($browserProcess -ne 'brave') { return $true }
    # Brave translation bubbles also expose TabItem controls. Only the measured
    # native browser-tab container may participate in matching or restoration.
    if ($tab.Current.ClassName -ne 'BraveTab') { return $false }
    $parent = $walker.GetParent($tab)
    return (
      $null -ne $parent -and
      $parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Tab -and
      $parent.Current.ClassName -eq 'BraveTabContainer')
  } catch { return $false }
}

function Test-BrowserTab($tab, $window) {
  try {
    return (
      $tab.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem -and
      (Is-ExpectedBrowserTab $tab) -and
      (Test-DocumentGeometry $tab $window) -and
      (Test-ElementWindowAncestry $tab $window))
  } catch { return $false }
}

function Remember-OriginalSelection($window, $tabs) {
  $windowKey = Window-Key $window
  if ($window.Current.NativeWindowHandle -eq $originalForegroundWindow) {
    $script:foregroundWindowKey = $windowKey
  }
  if ($originalSelections.ContainsKey($windowKey)) { return $true }
  $selected = @()
  for ($index = 0; $index -lt $tabs.Count; $index++) {
    if (-not (Test-BrowserTab $tabs[$index] $window)) { continue }
    $selection = $null
    if (-not $tabs[$index].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { return $false }
    try {
      if ($selection.Current.IsSelected) {
        $selected += [pscustomobject]@{
          selection = $selection
          key = (Element-Key $window $tabs[$index])
        }
      }
    } catch { return $false }
  }
  if ($selected.Count -ne 1) { return $false }
  $originalSelections[$windowKey] = $selected[0].selection
  $originalSelectionKeys[$windowKey] = $selected[0].key
  return $true
}

function Remember-ReplacementSelection($window) {
  try {
    $windowKey = Window-Key $window
    $replacementSelections.Remove($windowKey) | Out-Null
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    $selected = @()
    for ($index = 0; $index -lt $tabs.Count; $index++) {
      if (-not (Test-BrowserTab $tabs[$index] $window)) { continue }
      $selection = $null
      if (-not $tabs[$index].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { return $false }
      if ($selection.Current.IsSelected) {
        $selected += $selection
      }
    }
    if ($selected.Count -ne 1) { return $false }
    $replacementSelections[$windowKey] = $selected[0]
    return $true
  } catch { return $false }
}

function Test-SelectionSelected($selection) {
  try { return [bool]$selection.Current.IsSelected } catch { return $false }
}

function Restore-BrowserSelections {
  $restored = $true
  $restoreKeys = @($originalSelections.Keys | Where-Object { $_ -ne $foregroundWindowKey })
  if ($null -ne $foregroundWindowKey -and $originalSelections.ContainsKey($foregroundWindowKey)) {
    $restoreKeys += $foregroundWindowKey
  }
  foreach ($windowKey in $restoreKeys) {
    if (-not $originalWindowIdentities.ContainsKey($windowKey) -or
        -not (Test-CandidateIdentity $originalWindowIdentities[$windowKey])) {
      $restored = $false
      continue
    }
    $preferReplacement = (
      $attemptedCloseTabAbsent -and
      $null -ne $attemptedCloseTabKey -and
      $originalSelectionKeys.ContainsKey($windowKey) -and
      $originalSelectionKeys[$windowKey] -eq $attemptedCloseTabKey)
    if ($preferReplacement) {
      if (-not $replacementSelections.ContainsKey($windowKey)) {
        $restored = $false
        continue
      }
      $selection = $replacementSelections[$windowKey]
      try {
        if (-not (Test-SelectionSelected $selection)) { $selection.Select() }
      } catch { $restored = $false; continue }
      if (-not (Test-SelectionSelected $selection)) { $restored = $false }
      if (-not (Test-CandidateIdentity $originalWindowIdentities[$windowKey])) { $restored = $false }
      continue
    }
    try {
      $selection = $originalSelections[$windowKey]
      if (-not (Test-SelectionSelected $selection)) { $selection.Select() }
    } catch { $restored = $false; continue }
    if (-not (Test-SelectionSelected $selection)) { $restored = $false }
    if (-not (Test-CandidateIdentity $originalWindowIdentities[$windowKey])) { $restored = $false }
  }
  return $restored
}

function Restore-ForegroundWindow {
  if ($originalForegroundWindow -eq 0 -or $originalForegroundProcessId -eq 0) { return $false }
  $currentOwner = [uint32]0
  $targetThread = [DriftyTabWindowNative]::GetWindowThreadProcessId(
    [IntPtr]$originalForegroundWindow, [ref]$currentOwner)
  if ($currentOwner -ne $originalForegroundProcessId) { return $false }
  if ($targetThread -eq 0) { return $false }

  if ($null -ne $originalFocusedElement) {
    try {
      $originalFocusedElement.SetFocus()
      Start-Sleep -Milliseconds 50
      if ([DriftyTabWindowNative]::GetForegroundWindow().ToInt64() -eq $originalForegroundWindow) {
        return $true
      }
    } catch { }
  }
  if ([DriftyTabWindowNative]::GetForegroundWindow().ToInt64() -eq $originalForegroundWindow) {
    return $true
  }
  try {
    $originalElement = $auto::FromHandle([IntPtr]$originalForegroundWindow)
    $originalElement.SetFocus()
    Start-Sleep -Milliseconds 50
    if ([DriftyTabWindowNative]::GetForegroundWindow().ToInt64() -eq $originalForegroundWindow) {
      return $true
    }
  } catch { }
  try {
    [DriftyTabWindowNative]::BringWindowToTop([IntPtr]$originalForegroundWindow) | Out-Null
    [DriftyTabWindowNative]::SetForegroundWindow([IntPtr]$originalForegroundWindow) | Out-Null
    Start-Sleep -Milliseconds 50
    return ([DriftyTabWindowNative]::GetForegroundWindow().ToInt64() -eq $originalForegroundWindow)
  } catch { return $false }
}

function Restore-OriginalSelections([scriptblock]$foregroundRestore = $null) {
  $selectionsRestored = Restore-BrowserSelections
  $foregroundRestored = if ($null -ne $foregroundRestore) {
    [bool](& $foregroundRestore)
  } else {
    Restore-ForegroundWindow
  }
  return ($selectionsRestored -and $foregroundRestored)
}

function Scan-TargetCandidates {
  $exact = @{}
  $domain = @{}
  $complete = $true
  $windows = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    try {
      $current = $window.Current
      if ($null -eq $current) { $complete = $false; continue }
      $ownerPid = $current.ProcessId
    } catch { $complete = $false; continue }
    if ($ownerPid -le 0) { continue }
    try {
      $ownerProcess = [Diagnostics.Process]::GetProcessById($ownerPid)
      $name = $ownerProcess.ProcessName.ToLowerInvariant()
    } catch { continue }
    if ($name -ne $browserProcess) { continue }
    try {
      $ownerIdentity = Normalize-ExecutablePath $ownerProcess.MainModule.FileName
      $ownerStartTicks = $ownerProcess.StartTime.ToUniversalTime().Ticks
    } catch { $complete = $false; continue }
    if ($ownerIdentity -eq '') { $complete = $false; continue }
    if ($ownerIdentity -ne $browserIdentity) { continue }
    try {
      $rootControlType = $window.Current.ControlType
      $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    } catch { $complete = $false; continue }
    if ($null -eq $rootControlType -or $null -eq $tabs) { $complete = $false; continue }
    $windowIdentity = [pscustomobject]@{
      window = $window; ownerPid = $ownerPid; ownerStartTicks = $ownerStartTicks
      windowHandle = $window.Current.NativeWindowHandle
    }
    if (-not (Test-CandidateIdentity $windowIdentity)) { $complete = $false; continue }
    if ($rootControlType -ne [System.Windows.Automation.ControlType]::Window) {
      if ($tabs.Count -ne 0) { $complete = $false }
      continue
    }
    if ($tabs.Count -eq 0) { $complete = $false; continue }
    $windowKey = Window-Key $window
    if (-not $originalWindowIdentities.ContainsKey($windowKey)) { $originalWindowIdentities[$windowKey] = $windowIdentity }
    if (-not (Remember-OriginalSelection $window $tabs)) {
      $complete = $false
      continue
    }
    for ($index = 0; $index -lt $tabs.Count; $index++) {
      $tab = $tabs[$index]
      if (-not (Is-ExpectedBrowserTab $tab)) { continue }
      # Embedded web TabItems are not browser tabs; unreadable browser tabs
      # cannot be silently omitted when proving a unique target.
      $disposition = Get-ElementWindowDisposition $tab $window
      if ($disposition -eq 'nested_document') { continue }
      if ($disposition -ne 'exact_window') { $complete = $false; continue }
      if (-not (Test-BrowserTab $tab $window)) { $complete = $false; continue }
      $selection = $null
      if (-not $tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { $complete = $false; continue }
      if (-not (Test-CandidateIdentity $windowIdentity)) { $complete = $false; break }
      try {
        $selection.Select(); Start-Sleep -Milliseconds 180
        if (-not $selection.Current.IsSelected -or -not (Test-CandidateIdentity $windowIdentity)) { $complete = $false; continue }
      } catch { $complete = $false; continue }
      $pageIdentity = Read-PageIdentity $window
      if (-not $selection.Current.IsSelected -or -not (Test-CandidateIdentity $windowIdentity)) { $complete = $false; continue }
      if ($pageIdentity.state -eq 'known_non_target') { continue }
      if ($pageIdentity.state -ne 'http_url') { $complete = $false; continue }
      $url = $pageIdentity.url
      $key = Element-Key $window $tab
      $candidate = [pscustomobject]@{
        window = $window
        tab = $tab
        url = $url
        key = $key
        ownerPid = $ownerPid
        ownerStartTicks = $ownerStartTicks
        windowHandle = $window.Current.NativeWindowHandle
      }
      if ((Test-UrlMatch $url $normalizedTarget) -and -not (Add-TargetCandidate $exact $candidate)) { $complete = $false }
      if ($targetDomain -ne '' -and (Domain-Of $url) -eq ($targetDomain -replace '^www\.', '') -and
          -not (Add-TargetCandidate $domain $candidate)) { $complete = $false }
    }
  }
  return [pscustomobject]@{ exact = $exact; domain = $domain; complete = $complete }
}

function Scan-TargetCandidatesWithRetry {
  for ($scanAttempt = 0; $scanAttempt -lt 2; $scanAttempt += 1) {
    $scan = Scan-TargetCandidates
    if ($scan.complete -and ($scan.exact.Count -gt 0 -or $scan.domain.Count -gt 0)) { return $scan }
    if ($scanAttempt -eq 0) { Start-Sleep -Milliseconds 350 }
  }
  return $scan
}

function Test-CandidateIdentity($candidate) {
  try {
    if ($candidate.ownerPid -le 0 -or $candidate.windowHandle -eq 0) { return $false }
    if ($candidate.window.Current.ProcessId -ne $candidate.ownerPid) { return $false }
    if ($candidate.window.Current.NativeWindowHandle -ne $candidate.windowHandle) { return $false }
    $ownerProcess = [Diagnostics.Process]::GetProcessById($candidate.ownerPid)
    if ($ownerProcess.ProcessName.ToLowerInvariant() -ne $browserProcess) { return $false }
    if ((Normalize-ExecutablePath $ownerProcess.MainModule.FileName) -ne $browserIdentity) { return $false }
    if ($ownerProcess.StartTime.ToUniversalTime().Ticks -ne $candidate.ownerStartTicks) { return $false }
    return $true
  } catch { return $false }
}

function Test-SelectedCandidate($candidate) {
  try {
    if (-not (Test-CandidateIdentity $candidate) -or -not (Test-BrowserTab $candidate.tab $candidate.window)) { return $false }
    $selection = $null
    if (-not $candidate.tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { return $false }
    if (-not $selection.Current.IsSelected) { return $false }
    if (-not (Test-UrlMatch (Read-Url $candidate.window) $candidate.url)) { return $false }
    return ($selection.Current.IsSelected -and (Test-CandidateIdentity $candidate))
  } catch { return $false }
}

function Test-HasOtherBrowserTab($candidate) {
  try {
    $tabs = $candidate.window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    $count = 0; $targetPresent = $false
    foreach ($tab in $tabs) {
      if (-not (Test-BrowserTab $tab $candidate.window)) { continue }
      $count++
      if (Compare-AutomationElement $tab $candidate.tab) { $targetPresent = $true }
    }
    return ($targetPresent -and $count -gt 1)
  } catch { return $false }
}

function Test-PostCloseCandidateAbsent($candidate) {
  try {
    if (-not (Test-CandidateIdentity $candidate)) { return $false }
    $tabs = $candidate.window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    $eligibleSurvivors = 0
    foreach ($tab in $tabs) {
      if (Compare-AutomationElement $tab $candidate.tab) { return $false }
      if (Test-BrowserTab $tab $candidate.window) { $eligibleSurvivors++ }
    }
    return ($eligibleSurvivors -gt 0 -and (Test-CandidateIdentity $candidate))
  } catch { return $false }
}

function Get-PostCloseVerification($candidate, $scan, [string]$matchKind) {
  $candidateAbsent = Test-PostCloseCandidateAbsent $candidate
  $remaining = if ($matchKind -eq 'exact_url') {
    [int]$scan.exact.Count
  } elseif ($matchKind -eq 'unique_domain') {
    [int]$scan.domain.Count
  } else {
    [int]::MaxValue
  }
  return [pscustomobject]@{
    candidateAbsent = $candidateAbsent
    remaining = $remaining
    verified = ($scan.complete -eq $true -and $candidateAbsent -and $remaining -eq 0)
  }
}

function Resolve-ForegroundCloseCandidate {
  if ($originalForegroundWindow -eq 0 -or $originalForegroundProcessId -eq 0) {
    return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_no_foreground'; error = 'no foreground browser window' }
  }
  try {
    $ownerProcess = [Diagnostics.Process]::GetProcessById($originalForegroundProcessId)
    if ($ownerProcess.ProcessName.ToLowerInvariant() -ne $browserProcess -or
        (Normalize-ExecutablePath $ownerProcess.MainModule.FileName) -ne $browserIdentity) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_wrong_foreground'; error = 'captured browser is not foreground' }
    }
    $window = $auto::FromHandle([IntPtr]$originalForegroundWindow)
    if ($null -eq $window -or $window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -or
        $window.Current.NativeWindowHandle -ne $originalForegroundWindow -or
        $window.Current.ProcessId -ne $originalForegroundProcessId) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_stale_window'; error = 'foreground browser identity changed' }
    }
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    $eligible = @()
    foreach ($tab in $tabs) {
      if (-not (Test-BrowserTab $tab $window)) { continue }
      $selection = $null
      if (-not $tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
        return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_incomplete_tabs'; error = 'browser tab selection was unreadable' }
      }
      if ($selection.Current.IsSelected) { $eligible += $tab }
    }
    if ($eligible.Count -ne 1) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_ambiguous_selected_tab'; error = "selected browser tabs=$($eligible.Count)" }
    }
    # Firefox can rebuild its accessibility tree immediately after showing a
    # browser-owned panel, yielding one transient empty page identity even
    # though the selected tab and its next sample are stable. Keep the retry
    # bounded and still require the final exact URL/domain match below.
    $actualUrl = Read-UrlWithRetry $window
    $candidate = [pscustomobject]@{
      window = $window; tab = $eligible[0]; ownerPid = $originalForegroundProcessId
      ownerStartTicks = $ownerProcess.StartTime.ToUniversalTime().Ticks
      windowHandle = $originalForegroundWindow; url = $actualUrl
    }
    if (-not (Test-CandidateIdentity $candidate) -or -not (Test-SelectedCandidate $candidate)) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_stale_target'; error = 'selected tab no longer matches the captured page' }
    }
    $matchKind = if ($targetUrl -ne '') { 'exact_url' } else { 'unique_domain' }
    $matches = if ($targetUrl -ne '') {
      Test-UrlMatch $actualUrl $normalizedTarget
    } else {
      (Domain-Of $actualUrl) -eq ($targetDomain -replace '^www\.', '')
    }
    if (-not $matches) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_target_mismatch'; error = 'foreground tab does not match the captured page' }
    }
    if (-not (Test-HasOtherBrowserTab $candidate)) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_last_tab_refused'; error = 'refusing the last browser tab' }
    }
    $tabRect = $candidate.tab.Current.BoundingRectangle
    $buttonRows = @()
    $buttons = $candidate.tab.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    foreach ($button in $buttons) {
      $invokePattern = $null
      if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { continue }
      $rect = $button.Current.BoundingRectangle
      if (-not (Test-PositiveRectangle $rect) -or $button.Current.IsOffscreen) { continue }
      if ($rect.Left -lt ($tabRect.Left - 2) -or $rect.Right -gt ($tabRect.Right + 2) -or
          $rect.Top -lt ($tabRect.Top - 2) -or $rect.Bottom -gt ($tabRect.Bottom + 2)) { continue }
      $buttonRows += [pscustomobject]@{
        element = $button; invoke = $invokePattern; rect = $rect; right = [double]$rect.Right
      }
    }
    $closeRow = @($buttonRows | Sort-Object -Property right -Descending | Select-Object -First 1)
    if ($closeRow.Count -ne 1) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_no_close_button'; error = 'selected tab has no bounded close button' }
    }
    if (-not (Test-CandidateIdentity $candidate) -or -not (Test-SelectedCandidate $candidate)) {
      return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_stale_target'; error = 'selected tab changed during geometry lookup' }
    }
    $rect = $closeRow[0].rect
    $dpi = $foregroundDpi
    $scale = if ($dpi -gt 0) { [double]$dpi / 96.0 } else { 1.0 }
    return [pscustomobject]@{
      passed = $true
      candidate = $candidate
      closeElement = $closeRow[0].element
      closeInvoke = $closeRow[0].invoke
      matchKind = $matchKind
      x = ([double]$rect.Left + [double]$rect.Right) / 2.0 / $scale
      y = ([double]$rect.Top + [double]$rect.Bottom) / 2.0 / $scale
      dpi = $dpi
      scale = $scale
      diagnostic = "windows_uia_${matchKind}_close_button"
      error = $null
    }
  } catch {
    return [pscustomobject]@{ passed = $false; diagnostic = 'windows_uia_geometry_exception'; error = $_.Exception.Message }
  }
}

function Fail([string]$message, [string]$diagnostic = 'windows_uia_target_not_found') {
  $focusRestored = if ($operation -eq 'close') { Restore-OriginalSelections } else { $true }
  [pscustomobject]@{ closed = $false; located = $false; x = $null; y = $null; diagnostic = $diagnostic; error = $message; focusRestored = $focusRestored } |
    ConvertTo-Json -Compress
  exit 0
}

try {
  if ($browserProcess -notin @('chrome', 'msedge', 'brave', 'firefox')) { Fail 'unsupported browser process' 'windows_uia_unsupported_browser' }
  if ($operation -notin @('close', 'locate', 'close_foreground')) { Fail 'unsupported browser operation' 'windows_uia_unsupported_operation' }
  $browserIdentity = Normalize-ExecutablePath $browserIdentityRaw
  if ($browserIdentity -eq '') { Fail 'missing or invalid browser identity' 'windows_uia_missing_browser_identity' }
  if ([IO.Path]::GetFileNameWithoutExtension($browserIdentity) -ne $browserProcess) {
    Fail 'browser identity does not match the requested process' 'windows_uia_invalid_browser_identity'
  }
  $normalizedTarget = Normalize-Url $targetUrl
  if ($targetUrl -ne '' -and $normalizedTarget -eq '') { Fail 'explicit URL has no authoritative identity' 'windows_uia_invalid_target_url' }
  if ($targetDomain -eq '' -and $normalizedTarget -ne '') { $targetDomain = Domain-Of $normalizedTarget }
  if ($normalizedTarget -eq '' -and $targetDomain -eq '') { Fail 'missing URL or domain' 'windows_uia_missing_target' }

  if ($operation -eq 'locate') {
    $geometry = Resolve-ForegroundCloseCandidate
    if ($geometry.passed -ne $true) { Fail ([string]$geometry.error) ([string]$geometry.diagnostic) }
    [pscustomobject]@{
      closed = $false; located = $true; x = $geometry.x; y = $geometry.y
      diagnostic = $geometry.diagnostic; error = $null; focusRestored = $true
      dpi = $geometry.dpi; scale = $geometry.scale
    } | ConvertTo-Json -Compress
    exit 0
  }

  if ($operation -eq 'close_foreground') {
    $resolved = Resolve-ForegroundCloseCandidate
    if ($resolved.passed -ne $true) { Fail ([string]$resolved.error) ([string]$resolved.diagnostic) }
    $candidate = $resolved.candidate
    if (-not (Test-CandidateIdentity $candidate) -or -not (Test-SelectedCandidate $candidate)) {
      Fail 'selected foreground tab changed before close' 'windows_uia_stale_target'
    }
    if (-not (Test-HasOtherBrowserTab $candidate)) {
      Fail 'refusing the last browser tab' 'windows_uia_last_tab_refused'
    }
    $resolved.closeInvoke.Invoke()
    Start-Sleep -Milliseconds 500
    if (-not (Test-PostCloseCandidateAbsent $candidate)) {
      Fail 'foreground target tab remained after close invoke' 'windows_uia_no_verified_close'
    }
    [pscustomobject]@{
      closed = $true; located = $false; x = $null; y = $null
      diagnostic = "windows_uia_foreground_$($resolved.matchKind)"
      error = $null; focusRestored = $true
    } | ConvertTo-Json -Compress
    exit 0
  }

  $scan = Scan-TargetCandidatesWithRetry
  $exact = $scan.exact
  $domain = $scan.domain

  if (-not $scan.complete) { Fail 'browser tab identity scan was incomplete' 'windows_uia_incomplete_scan' }
  $matchKind = if ($targetUrl -ne '') { 'exact_url' } else { 'unique_domain' }
  $candidates = @(Get-TargetCandidates $scan $targetUrl)
  if ($candidates.Count -ne 1) {
    Fail "ambiguous target: exact=$($exact.Count), domain=$($domain.Count)" 'windows_uia_ambiguous_or_missing_target'
  }

  $candidate = $candidates[0]
  if (-not (Test-CandidateIdentity $candidate)) {
    Fail 'target browser identity changed after scan' 'windows_uia_stale_browser_identity'
  }
  $selection = $null
  if (-not $candidate.tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
    Fail 'target tab lost selection pattern' 'windows_uia_stale_target'
  }
  $selection.Select()
  Start-Sleep -Milliseconds 180
  if (-not (Test-SelectedCandidate $candidate)) { Fail 'selected tab no longer matches target' 'windows_uia_stale_target' }
  if (-not (Test-HasOtherBrowserTab $candidate)) { Fail 'refusing the last browser tab' 'windows_uia_last_tab_refused' }

  $tabRect = $candidate.tab.Current.BoundingRectangle
  $buttonRows = @()
  $buttons = $candidate.tab.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $button = $buttons[$index]
    $invokePattern = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { continue }
    $rect = $button.Current.BoundingRectangle
    if (-not (Test-PositiveRectangle $rect) -or $button.Current.IsOffscreen) { continue }
    if ($rect.Left -lt ($tabRect.Left - 2) -or $rect.Right -gt ($tabRect.Right + 2) -or
        $rect.Top -lt ($tabRect.Top - 2) -or $rect.Bottom -gt ($tabRect.Bottom + 2)) { continue }
    $buttonRows += [pscustomobject]@{ element = $button; invoke = $invokePattern; rect = $rect; right = [double]$rect.Right }
  }
  $closeRow = @($buttonRows | Sort-Object -Property right -Descending | Select-Object -First 1)
  if ($closeRow.Count -ne 1) { Fail 'target tab has no bounded invokable close button' 'windows_uia_no_close_button' }
  if (-not (Test-CandidateIdentity $candidate)) {
    Fail 'target browser identity changed before close' 'windows_uia_stale_browser_identity'
  }
  if (-not (Test-HasOtherBrowserTab $candidate)) { Fail 'refusing the last browser tab' 'windows_uia_last_tab_refused' }
  if (-not (Test-SelectedCandidate $candidate)) { Fail 'selected tab changed before close' 'windows_uia_stale_target' }
  $closeRow[0].invoke.Invoke()
  Start-Sleep -Milliseconds 500
  $attemptedCloseTabKey = $candidate.key
  if (-not (Test-PostCloseCandidateAbsent $candidate)) {
    Fail 'target tab element or browser window identity remained after close invoke' 'windows_uia_no_verified_close'
  }
  $attemptedCloseTabAbsent = $true
  Remember-ReplacementSelection $candidate.window | Out-Null

  $verification = Scan-TargetCandidates
  $postClose = Get-PostCloseVerification $candidate $verification $matchKind
  if (-not $postClose.verified) {
    if (-not $verification.complete) { Fail 'post-close tab scan was incomplete' 'windows_uia_no_verified_close' }
    if (-not $postClose.candidateAbsent) {
      $attemptedCloseTabAbsent = $false
      Fail 'target tab element or browser window identity changed during post-close verification' 'windows_uia_no_verified_close'
    }
    Fail "target still present after close invoke: remaining=$($postClose.remaining)" 'windows_uia_no_verified_close'
  }
  $attemptedCloseVerified = $true
  $focusRestored = Restore-OriginalSelections
  $diagnostic = if ($focusRestored) { "windows_uia_$matchKind" } else { "windows_uia_${matchKind}_focus_restore_failed" }
  [pscustomobject]@{ closed = $true; located = $false; x = $null; y = $null; diagnostic = $diagnostic; error = $null; focusRestored = $focusRestored } |
    ConvertTo-Json -Compress
} catch {
  Fail $_.Exception.Message 'windows_uia_exception'
}
