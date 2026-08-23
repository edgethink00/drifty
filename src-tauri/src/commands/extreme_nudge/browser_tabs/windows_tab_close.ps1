$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DriftyTabWindowNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
}
"@

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
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
  $auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$originalSelections = @{}
$originalSelectionKeys = @{}
$replacementSelections = @{}
$originalForegroundWindow = [DriftyTabWindowNative]::GetForegroundWindow().ToInt64()
$originalForegroundProcessId = [uint32]0
$originalFocusedElement = try { $auto::FocusedElement } catch { $null }
if ($originalForegroundWindow -ne 0) {
  [DriftyTabWindowNative]::GetWindowThreadProcessId(
    [IntPtr]$originalForegroundWindow, [ref]$originalForegroundProcessId) | Out-Null
}
$foregroundWindowKey = $null
$attemptedCloseTabKey = $null
$attemptedCloseVerified = $false

function Is-BrowserToolbarEdit($edit, $window) {
  $editRect = $edit.Current.BoundingRectangle
  $windowRect = $window.Current.BoundingRectangle
  if ($editRect.Height -le 0 -or $windowRect.Height -le 0) { return $false }
  $chromeBottom = [Math]::Min($windowRect.Top + 220, $windowRect.Top + ($windowRect.Height * 0.25))
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

function Normalize-Url([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $cleaned = $value.Trim()
  if ($cleaned -notmatch '^[a-z][a-z0-9+.-]*://') { $cleaned = 'https://' + $cleaned }
  try {
    $uri = [Uri]$cleaned
    if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host)) { return '' }
    return ($uri.Scheme.ToLowerInvariant() + '://' + $uri.Authority.ToLowerInvariant() + $uri.PathAndQuery).TrimEnd('/')
  } catch { return '' }
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

function Read-Url($window) {
  $edits = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
  foreach ($edit in $edits) {
    if (-not (Is-BrowserToolbarEdit $edit $window)) { continue }
    $pattern = $null
    if (-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { continue }
    $normalized = Normalize-Url $pattern.Current.Value
    if ($normalized -ne '') { return $normalized }
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
  if ($browserProcess -ne 'brave') { return $true }
  try {
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

function Remember-OriginalSelection($window, $tabs) {
  $windowKey = Window-Key $window
  if ($window.Current.NativeWindowHandle -eq $originalForegroundWindow) {
    $script:foregroundWindowKey = $windowKey
  }
  if ($originalSelections.ContainsKey($windowKey)) { return }
  for ($index = 0; $index -lt $tabs.Count; $index++) {
    if (-not (Is-ExpectedBrowserTab $tabs[$index])) { continue }
    $selection = $null
    if (-not $tabs[$index].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { continue }
    try {
      if ($selection.Current.IsSelected) {
        $originalSelections[$windowKey] = $selection
        $originalSelectionKeys[$windowKey] = (Element-Key $window $tabs[$index])
        return
      }
    } catch { continue }
  }
}

function Remember-ReplacementSelection($window) {
  try {
    $windowKey = Window-Key $window
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    for ($index = 0; $index -lt $tabs.Count; $index++) {
      if (-not (Is-ExpectedBrowserTab $tabs[$index])) { continue }
      $selection = $null
      if (-not $tabs[$index].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { continue }
      if ($selection.Current.IsSelected) {
        $replacementSelections[$windowKey] = $selection
        return
      }
    }
  } catch { return }
}

function Restore-OriginalSelections {
  $restoreKeys = @($originalSelections.Keys | Where-Object { $_ -ne $foregroundWindowKey })
  if ($null -ne $foregroundWindowKey -and $originalSelections.ContainsKey($foregroundWindowKey)) {
    $restoreKeys += $foregroundWindowKey
  }
  foreach ($windowKey in $restoreKeys) {
    $preferReplacement = (
      $attemptedCloseVerified -and
      $null -ne $attemptedCloseTabKey -and
      $originalSelectionKeys.ContainsKey($windowKey) -and
      $originalSelectionKeys[$windowKey] -eq $attemptedCloseTabKey)
    if ($preferReplacement) {
      if ($replacementSelections.ContainsKey($windowKey)) {
        try { $replacementSelections[$windowKey].Select() } catch { }
      }
      continue
    }
    try {
      $originalSelections[$windowKey].Select()
      continue
    } catch { }
    if ($replacementSelections.ContainsKey($windowKey)) {
      try { $replacementSelections[$windowKey].Select() } catch { }
    }
  }
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

function Scan-TargetCandidates {
  $exact = @{}
  $domain = @{}
  $windows = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    $ownerPid = $window.Current.ProcessId
    if ($ownerPid -le 0) { continue }
    try {
      $ownerProcess = [Diagnostics.Process]::GetProcessById($ownerPid)
      $name = $ownerProcess.ProcessName.ToLowerInvariant()
      $ownerIdentity = Normalize-ExecutablePath $ownerProcess.MainModule.FileName
      $ownerStartTicks = $ownerProcess.StartTime.ToUniversalTime().Ticks
    } catch { continue }
    if ($name -ne $browserProcess) { continue }
    if ($ownerIdentity -eq '' -or $ownerIdentity -ne $browserIdentity) { continue }
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    Remember-OriginalSelection $window $tabs
    for ($index = 0; $index -lt $tabs.Count; $index++) {
      $tab = $tabs[$index]
      if (-not (Is-ExpectedBrowserTab $tab)) { continue }
      $tabRect = $tab.Current.BoundingRectangle
      if ($tab.Current.IsOffscreen -or $tabRect.Width -le 0 -or $tabRect.Height -le 0) { continue }
      $selection = $null
      if (-not $tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { continue }
      try { $selection.Select(); Start-Sleep -Milliseconds 180 } catch { continue }
      $url = Read-Url $window
      if ($url -eq '') { continue }
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
      if ($normalizedTarget -ne '' -and $url -eq $normalizedTarget) { $exact[$key] = $candidate }
      if ($targetDomain -ne '' -and (Domain-Of $url) -eq ($targetDomain -replace '^www\.', '')) { $domain[$key] = $candidate }
    }
  }
  return [pscustomobject]@{ exact = $exact; domain = $domain }
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

function Fail([string]$message, [string]$diagnostic = 'windows_uia_target_not_found') {
  $focusRestored = Restore-OriginalSelections
  [pscustomobject]@{ closed = $false; diagnostic = $diagnostic; error = $message; focusRestored = $focusRestored } |
    ConvertTo-Json -Compress
  exit 0
}

try {
  if ($browserProcess -notin @('chrome', 'msedge', 'brave')) { Fail 'unsupported browser process' 'windows_uia_unsupported_browser' }
  $browserIdentity = Normalize-ExecutablePath $browserIdentityRaw
  if ($browserIdentity -eq '') { Fail 'missing or invalid browser identity' 'windows_uia_missing_browser_identity' }
  if ([IO.Path]::GetFileNameWithoutExtension($browserIdentity) -ne $browserProcess) {
    Fail 'browser identity does not match the requested process' 'windows_uia_invalid_browser_identity'
  }
  $normalizedTarget = Normalize-Url $targetUrl
  if ($targetDomain -eq '' -and $normalizedTarget -ne '') { $targetDomain = Domain-Of $normalizedTarget }
  if ($normalizedTarget -eq '' -and $targetDomain -eq '') { Fail 'missing URL or domain' 'windows_uia_missing_target' }

  $exact = @{}
  $domain = @{}
  for ($scanAttempt = 0; $scanAttempt -lt 2; $scanAttempt += 1) {
    $scan = Scan-TargetCandidates
    $exact = $scan.exact
    $domain = $scan.domain
    if ($exact.Count -gt 0 -or $domain.Count -gt 0) { break }
    Start-Sleep -Milliseconds 350
  }

  $matchKind = 'exact_url'
  $candidates = @($exact.Values)
  if ($candidates.Count -eq 0) {
    $matchKind = 'unique_domain'
    $candidates = @($domain.Values)
  }
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
  $confirmedUrl = Read-Url $candidate.window
  $confirmed = if ($matchKind -eq 'exact_url') {
    $confirmedUrl -eq $normalizedTarget
  } else {
    (Domain-Of $confirmedUrl) -eq ($targetDomain -replace '^www\.', '')
  }
  if (-not $confirmed) { Fail 'selected tab no longer matches target' 'windows_uia_stale_target' }

  $tabRect = $candidate.tab.Current.BoundingRectangle
  $buttonRows = @()
  $buttons = $candidate.tab.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $button = $buttons[$index]
    $invokePattern = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { continue }
    $rect = $button.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0 -or $button.Current.IsOffscreen) { continue }
    if ($rect.Left -lt ($tabRect.Left - 2) -or $rect.Right -gt ($tabRect.Right + 2) -or
        $rect.Top -lt ($tabRect.Top - 2) -or $rect.Bottom -gt ($tabRect.Bottom + 2)) { continue }
    $buttonRows += [pscustomobject]@{ element = $button; invoke = $invokePattern; right = [double]$rect.Right }
  }
  $closeRow = @($buttonRows | Sort-Object -Property right -Descending | Select-Object -First 1)
  if ($closeRow.Count -ne 1) { Fail 'target tab has no bounded invokable close button' 'windows_uia_no_close_button' }
  if (-not (Test-CandidateIdentity $candidate)) {
    Fail 'target browser identity changed before close' 'windows_uia_stale_browser_identity'
  }
  $closeRow[0].invoke.Invoke()
  Start-Sleep -Milliseconds 500
  Remember-ReplacementSelection $candidate.window
  $attemptedCloseTabKey = $candidate.key

  $verification = Scan-TargetCandidates
  $remaining = if ($matchKind -eq 'exact_url') {
    $verification.exact.Count
  } else {
    $verification.domain.Count
  }
  if ($remaining -ne 0) {
    Fail "target still present after close invoke: remaining=$remaining" 'windows_uia_no_verified_close'
  }
  $attemptedCloseVerified = $true
  $focusRestored = Restore-OriginalSelections
  $diagnostic = if ($focusRestored) { "windows_uia_$matchKind" } else { "windows_uia_${matchKind}_focus_restore_failed" }
  [pscustomobject]@{ closed = $true; diagnostic = $diagnostic; error = $null; focusRestored = $focusRestored } |
    ConvertTo-Json -Compress
} catch {
  Fail $_.Exception.Message 'windows_uia_exception'
}
