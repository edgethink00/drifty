param(
  [string]$ScriptPath = (Join-Path $PSScriptRoot 'windows_tab_close.ps1')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if ($null -eq ('DriftyPs51TestElement' -as [type])) {
  Add-Type -TypeDefinition @"
using System;

public sealed class DriftyPs51TestPattern {
  public object Current { get; set; }
  public object SelectedCurrent { get; set; }
  public int SelectCallCount { get; set; }
  public bool ThrowOnSelect { get; set; }
  public void Select() {
    SelectCallCount++;
    if (ThrowOnSelect) throw new InvalidOperationException("synthetic selection failure");
    if (SelectedCurrent != null) Current = SelectedCurrent;
  }
}

public sealed class DriftyPs51TestElement {
  public object Current { get; set; }
  public DriftyPs51TestElement Parent { get; set; }
  public object[] Descendants { get; set; }
  public object[][] FindAllResults { get; set; }
  public int FindAllCallCount { get; set; }
  public bool PatternAvailable { get; set; }
  public object PatternObject { get; set; }
  public bool ThrowOnParent { get; set; }
  public bool ThrowOnFindAll { get; set; }

  public object[] FindAll(object scope, object condition) {
    if (ThrowOnFindAll) throw new InvalidOperationException("synthetic enumeration failure");
    if (FindAllResults != null && FindAllCallCount < FindAllResults.Length) {
      return FindAllResults[FindAllCallCount++];
    }
    return Descendants ?? new object[0];
  }

  public bool TryGetCurrentPattern(object pattern, out object result) {
    result = PatternObject;
    return PatternAvailable;
  }
}

public sealed class DriftyPs51TestWalker {
  public object GetParent(object element) {
    DriftyPs51TestElement typed = element as DriftyPs51TestElement;
    if (typed != null && typed.ThrowOnParent) throw new InvalidOperationException("synthetic ancestry failure");
    return typed == null ? null : typed.Parent;
  }
}

public static class DriftyPs51TestAutomationElement {
  public static DriftyPs51TestElement RootElement { get; set; }
}
"@
}

$results = New-Object System.Collections.Generic.List[object]
$loadedFunctions = @{}

function Add-TestResult([string]$name, [bool]$passed, [string]$kind, [string]$message) {
  $results.Add([pscustomobject]@{
    name = $name
    passed = $passed
    kind = $kind
    message = $message
  }) | Out-Null
}

function Assert-OrdinalEqual([string]$expected, [string]$actual) {
  if (-not [string]::Equals($expected, $actual, [StringComparison]::Ordinal)) {
    throw "expected <$expected>, got <$actual>"
  }
}

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Assert-False([bool]$condition, [string]$message) {
  if ($condition) { throw $message }
}

function New-TestRect([double]$left, [double]$top, [double]$width, [double]$height) {
  return [pscustomobject]@{
    Left = $left
    Top = $top
    Width = $width
    Height = $height
    Right = $left + $width
    Bottom = $top + $height
  }
}

function New-TestElement(
  $controlType,
  $rect,
  [bool]$isOffscreen = $false,
  [int]$processId = 101,
  [int]$nativeWindowHandle = 202,
  [string]$className = '',
  [string]$automationId = '') {
  $element = [DriftyPs51TestElement]::new()
  $element.Current = [pscustomobject]@{
    ControlType = $controlType
    BoundingRectangle = $rect
    IsOffscreen = $isOffscreen
    ProcessId = $processId
    NativeWindowHandle = $nativeWindowHandle
    ClassName = $className
    AutomationId = $automationId
  }
  $element.Descendants = @()
  return $element
}

function Set-TestPattern($element, [bool]$available, $current) {
  $pattern = [DriftyPs51TestPattern]::new()
  $pattern.Current = $current
  $element.PatternAvailable = $available
  $element.PatternObject = $pattern
}

function Connect-TestParent($element, $parent) {
  $element.Parent = $parent
}

function Invoke-Test([string]$name, [string[]]$requiredFunctions, [scriptblock]$body) {
  foreach ($requiredFunction in $requiredFunctions) {
    if (-not $loadedFunctions.ContainsKey($requiredFunction)) {
      Add-TestResult $name $false 'missing_function' "product function is missing: $requiredFunction"
      return
    }
  }
  try {
    & $body | Out-Null
    Add-TestResult $name $true 'assertion' ''
  } catch {
    Add-TestResult $name $false 'assertion' $_.Exception.Message
  }
}

$resolvedScriptPath = $null
$sourceHash = $null
try {
  $resolvedScriptPath = (Resolve-Path -LiteralPath $ScriptPath).Path
  $sourceHash = (Get-FileHash -LiteralPath $resolvedScriptPath -Algorithm SHA256).Hash
  $tokens = $null
  $parseErrors = $null
  $sourceAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $resolvedScriptPath,
    [ref]$tokens,
    [ref]$parseErrors)
  if ($parseErrors.Count -ne 0) {
    throw "product script parse failed: $($parseErrors[0].Message)"
  }

  $wantedFunctions = @(
    'Compare-AutomationElement',
    'Normalize-Url',
    'Domain-Of',
    'Get-TargetCandidates',
    'Test-UrlMatch',
    'Test-PositiveRectangle',
    'Test-DocumentGeometry',
    'Get-ElementWindowDisposition',
    'Test-ElementWindowAncestry',
    'Is-TopLevelBrowserDocument',
    'Read-PageIdentity',
    'Read-Url',
    'Read-UrlWithRetry',
    'Is-ExpectedBrowserTab',
    'Test-BrowserTab',
    'Test-CandidateIdentity',
    'Normalize-ExecutablePath',
    'Element-Key',
    'Add-TargetCandidate',
    'Window-Key',
    'Remember-OriginalSelection',
    'Remember-ReplacementSelection',
    'Test-SelectionSelected',
    'Restore-BrowserSelections',
    'Restore-ForegroundWindow',
    'Restore-OriginalSelections',
    'Scan-TargetCandidates',
    'Scan-TargetCandidatesWithRetry',
    'Test-SelectedCandidate',
    'Test-HasOtherBrowserTab',
    'Test-PostCloseCandidateAbsent',
    'Get-PostCloseVerification'
  )
  $functionAsts = @($sourceAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
  }, $true))
  foreach ($wantedFunction in $wantedFunctions) {
    $matches = @($functionAsts | Where-Object { $_.Name -eq $wantedFunction })
    if ($matches.Count -eq 1) {
      Invoke-Expression $matches[0].Extent.Text
      $loadedFunctions[$wantedFunction] = $true
    } elseif ($matches.Count -gt 1) {
      throw "product function is defined more than once: $wantedFunction"
    }
  }
} catch {
  Add-TestResult 'load product functions through AST' $false 'harness' $_.Exception.Message
}

$uiaAuto = [System.Windows.Automation.AutomationElement]
$documentCondition = New-Object System.Windows.Automation.PropertyCondition(
  $uiaAuto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$tabCondition = New-Object System.Windows.Automation.PropertyCondition(
  $uiaAuto::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$walker = [DriftyPs51TestWalker]::new()
$auto = [DriftyPs51TestAutomationElement]
$browserProcess = 'chrome'

Invoke-Test 'real UIAutomation API owns Compare on Automation, not AutomationElement' @('Compare-AutomationElement') {
  $automationCompare = @([System.Windows.Automation.Automation].GetMethods() | Where-Object {
    $_.Name -eq 'Compare' -and $_.GetParameters().Count -eq 2 -and
    $_.GetParameters()[0].ParameterType -eq [System.Windows.Automation.AutomationElement] -and
    $_.GetParameters()[1].ParameterType -eq [System.Windows.Automation.AutomationElement]
  })
  $elementCompare = @([System.Windows.Automation.AutomationElement].GetMethods() | Where-Object { $_.Name -eq 'Compare' })
  Assert-OrdinalEqual '1' ([string]$automationCompare.Count)
  Assert-OrdinalEqual '0' ([string]$elementCompare.Count)
  $compareFunction = (Get-Command Compare-AutomationElement -CommandType Function).Definition
  Assert-True ($compareFunction -match '\[System\.Windows\.Automation\.Automation\]::Compare') 'product helper does not call the real Automation.Compare API'
  Assert-False ($compareFunction -match 'AutomationElement\]::Compare|\$auto::Compare') 'product helper still calls nonexistent AutomationElement.Compare'
  Assert-False ($compareFunction -match 'catch') 'product helper swallows comparison exceptions before caller fail-closed handling'
}

# Synthetic elements cannot be passed to the real strongly typed UIA API. The
# remaining unit fixtures override only the product wrapper with reference
# identity; the real API owner/signature is proven above before this override.
function Compare-AutomationElement($left, $right) {
  return [object]::ReferenceEquals($left, $right)
}

# The suite exercises retry/selection ordering, not wall-clock delays.
function Start-Sleep { param([int]$Milliseconds) }

function Initialize-ScanGlobals([string]$target = 'https://example.com/target') {
  $owner = [Diagnostics.Process]::GetProcessById($PID)
  $script:browserProcess = $owner.ProcessName.ToLowerInvariant()
  $script:browserIdentity = Normalize-ExecutablePath $owner.MainModule.FileName
  $script:normalizedTarget = Normalize-Url $target
  $script:targetDomain = 'example.com'
  $script:originalForegroundWindow = 0
  $script:originalSelections = @{}
  $script:originalSelectionKeys = @{}
  $script:originalWindowIdentities = @{}
  $script:replacementSelections = @{}
  $script:foregroundWindowKey = $null
  $script:attemptedCloseTabKey = $null
  $script:attemptedCloseTabAbsent = $false
  return $owner
}

Invoke-Test 'Is-ExpectedBrowserTab accepts only the measured Chrome and Edge tab structures' @('Is-ExpectedBrowserTab') {
  $chromeContainer = New-TestElement ([System.Windows.Automation.ControlType]::Tab) (New-TestRect 0 0 800 60) $false 101 0 'TabContainerImpl'
  $chromeTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false 101 0 'Tab'
  Connect-TestParent $chromeTab $chromeContainer

  $edgeContainer = New-TestElement ([System.Windows.Automation.ControlType]::Tab) (New-TestRect 0 0 800 60) $false 101 0 'EdgeTabContainerImpl'
  $edgeTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false 101 0 'EdgeTab'
  Connect-TestParent $edgeTab $edgeContainer

  $translationTabs = New-TestElement ([System.Windows.Automation.ControlType]::Tab) (New-TestRect 500 100 300 50) $false 101 0 'TabbedPane'
  $translationTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 510 110 100 30) $false 101 0 'TabbedPaneTab'
  Connect-TestParent $translationTab $translationTabs

  $script:browserProcess = 'chrome'
  Assert-True (Is-ExpectedBrowserTab $chromeTab) 'Chrome browser tab was rejected'
  Assert-False (Is-ExpectedBrowserTab $edgeTab) 'Edge tab shape was accepted as Chrome'
  Assert-False (Is-ExpectedBrowserTab $translationTab) 'Chrome translation bubble tab was accepted'

  $script:browserProcess = 'msedge'
  Assert-True (Is-ExpectedBrowserTab $edgeTab) 'Edge browser tab was rejected'
  Assert-False (Is-ExpectedBrowserTab $chromeTab) 'Chrome tab shape was accepted as Edge'
  Assert-False (Is-ExpectedBrowserTab $translationTab) 'Edge translation bubble tab was accepted'
}

function New-ScanWindow($owner, [int]$handle, [bool]$includeUnknownTab = $false) {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID $handle
  $targetTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID $handle
  Connect-TestParent $targetTab $window
  Set-TestPattern $targetTab $true ([pscustomobject]@{ IsSelected = $true })
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540) $false $PID $handle
  Connect-TestParent $document $window
  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'https://example.com/target' })
  $tabs = @($targetTab)
  if ($includeUnknownTab) {
    $unknownTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID $handle
    $unknownTab.ThrowOnParent = $true
    $tabs += $unknownTab
  }
  $window.FindAllResults = [object[][]]@(
    [object[]]$tabs,
    [object[]]@($document)
  )
  return $window
}

function New-PostCloseFixture([int]$handle) {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID $handle
  $targetTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID $handle
  Connect-TestParent $targetTab $window
  Set-TestPattern $targetTab $true ([pscustomobject]@{ IsSelected = $true })
  return [pscustomobject]@{
    owner = $owner
    window = $window
    targetTab = $targetTab
    candidate = [pscustomobject]@{
      window = $window
      tab = $targetTab
      url = 'https://example.com/target'
      key = (Element-Key $window $targetTab)
      ownerPid = $PID
      ownerStartTicks = $owner.StartTime.ToUniversalTime().Ticks
      windowHandle = $handle
    }
  }
}

Invoke-Test 'Normalize-Url rejects scheme-less input' @('Normalize-Url') {
  Assert-OrdinalEqual '' (Normalize-Url 'example.com/Path?Query=Mixed')
}

Invoke-Test 'Normalize-Url preserves explicit protocol identity' @('Normalize-Url') {
  $http = Normalize-Url 'http://example.com/path'
  $https = Normalize-Url 'https://example.com/path'
  Assert-OrdinalEqual 'http://example.com/path' $http
  Assert-OrdinalEqual 'https://example.com/path' $https
  Assert-True (-not [string]::Equals($http, $https, [StringComparison]::Ordinal)) 'HTTP and HTTPS collapsed to one identity'
}

Invoke-Test 'Normalize-Url normalizes host case and default port through Uri' @('Normalize-Url') {
  Assert-OrdinalEqual 'http://example.com/Path?Query=Mixed' (Normalize-Url 'HTTP://EXAMPLE.COM:80/Path?Query=Mixed')
}

Invoke-Test 'Normalize-Url preserves path and query case' @('Normalize-Url') {
  Assert-OrdinalEqual 'https://example.com/Case/Path?Key=VaLuE' (Normalize-Url 'https://EXAMPLE.com/Case/Path?Key=VaLuE')
}

Invoke-Test 'Normalize-Url preserves fragment' @('Normalize-Url') {
  Assert-OrdinalEqual 'https://example.com/path#MixedFragment' (Normalize-Url 'https://example.com/path#MixedFragment')
}

Invoke-Test 'Normalize-Url preserves trailing slash' @('Normalize-Url') {
  Assert-OrdinalEqual 'https://example.com/' (Normalize-Url 'https://example.com')
  Assert-OrdinalEqual 'https://example.com/path/' (Normalize-Url 'https://example.com/path/')
}

Invoke-Test 'Normalize-Url preserves escaped path identity' @('Normalize-Url', 'Test-UrlMatch') {
  Assert-OrdinalEqual 'https://example.com/a%20b' (Normalize-Url 'https://example.com/a%20b')
  Assert-OrdinalEqual 'https://example.com/a%2Fb' (Normalize-Url 'https://example.com/a%2Fb')
  Assert-False (Test-UrlMatch 'https://example.com/a%2Fb' 'https://example.com/a/b') 'escaped slash matched a path separator'
  Assert-False (Test-UrlMatch 'https://example.com/a%20b' 'https://example.com/a b') 'escaped space matched invalid literal whitespace'
}

Invoke-Test 'Normalize-Url rejects unsupported schemes' @('Normalize-Url') {
  Assert-OrdinalEqual '' (Normalize-Url 'ftp://example.com/path')
}

Invoke-Test 'Normalize-Url rejects credentials' @('Normalize-Url') {
  Assert-OrdinalEqual '' (Normalize-Url 'https://user:secret@example.com/path')
}

Invoke-Test 'Normalize-Url rejects backslashes' @('Normalize-Url') {
  Assert-OrdinalEqual '' (Normalize-Url 'https://example.com\path')
}

Invoke-Test 'Normalize-Url rejects whitespace' @('Normalize-Url') {
  Assert-OrdinalEqual '' (Normalize-Url 'https://example.com/a b')
  Assert-OrdinalEqual '' (Normalize-Url ' https://example.com/path')
  Assert-OrdinalEqual '' (Normalize-Url 'https://example.com/path ')
}

Invoke-Test 'Test-UrlMatch uses ordinal normalized equality' @('Test-UrlMatch') {
  Assert-True (Test-UrlMatch 'HTTP://EXAMPLE.COM:80/Case?Q=Mixed' 'http://example.com/Case?Q=Mixed') 'equivalent authority did not match'
  Assert-True (-not (Test-UrlMatch 'https://example.com/Case?Q=Mixed' 'https://example.com/case?Q=Mixed')) 'path comparison was case-insensitive'
  Assert-True (-not (Test-UrlMatch 'http://example.com/' 'https://example.com/')) 'protocol comparison was not distinct'
  Assert-True (-not (Test-UrlMatch 'https://example.com:444/path' 'https://example.com/path')) 'different ports matched'
  Assert-True (-not (Test-UrlMatch 'https://example.com/path?a=1&b=2' 'https://example.com/path?b=2&a=1')) 'query ordering was discarded'
  Assert-True (-not (Test-UrlMatch 'https://example.com/path/' 'https://example.com/path')) 'trailing slash identities matched'
  Assert-True (-not (Test-UrlMatch 'https://example.com/path#one' 'https://example.com/path#two')) 'fragment identities matched'
  Assert-True (-not (Test-UrlMatch '' '')) 'empty identities matched'
  Assert-True (-not (Test-UrlMatch 'not a URL' 'not a URL')) 'invalid identities matched'
}

Invoke-Test 'Get-TargetCandidates uses exact values for an explicit URL' @('Get-TargetCandidates') {
  $scan = [pscustomobject]@{
    complete = $true
    exact = @{ exact = [pscustomobject]@{ key = 'exact' } }
    domain = @{ fallback = [pscustomobject]@{ key = 'fallback' } }
  }
  $candidates = @(Get-TargetCandidates $scan 'https://example.com/path')
  Assert-OrdinalEqual '1' ([string]$candidates.Count)
  Assert-OrdinalEqual 'exact' ([string]$candidates[0].key)
}

Invoke-Test 'Get-TargetCandidates never domain-falls back for an explicit URL' @('Get-TargetCandidates') {
  $scan = [pscustomobject]@{
    complete = $true
    exact = @{}
    domain = @{ fallback = [pscustomobject]@{ key = 'fallback' } }
  }
  Assert-OrdinalEqual '0' ([string](@(Get-TargetCandidates $scan 'http://example.com/path').Count))
}

Invoke-Test 'Get-TargetCandidates uses domain values only without an explicit URL' @('Get-TargetCandidates') {
  $scan = [pscustomobject]@{
    complete = $true
    exact = @{ exact = [pscustomobject]@{ key = 'exact' } }
    domain = @{ fallback = [pscustomobject]@{ key = 'fallback' } }
  }
  $candidates = @(Get-TargetCandidates $scan '   ')
  Assert-OrdinalEqual '1' ([string]$candidates.Count)
  Assert-OrdinalEqual 'fallback' ([string]$candidates[0].key)
}

Invoke-Test 'Get-TargetCandidates fails closed for an incomplete scan' @('Get-TargetCandidates') {
  $scan = [pscustomobject]@{
    complete = $false
    exact = @{ exact = [pscustomobject]@{ key = 'exact' } }
    domain = @{ fallback = [pscustomobject]@{ key = 'fallback' } }
  }
  Assert-OrdinalEqual '0' ([string](@(Get-TargetCandidates $scan 'https://example.com/path').Count))
  Assert-OrdinalEqual '0' ([string](@(Get-TargetCandidates $scan '').Count))
}

Invoke-Test 'Get-TargetCandidates preserves duplicate exact candidates for ambiguity refusal' @('Get-TargetCandidates') {
  $scan = [pscustomobject]@{
    complete = $true
    exact = @{
      first = [pscustomobject]@{ key = 'first' }
      second = [pscustomobject]@{ key = 'second' }
    }
    domain = @{}
  }
  Assert-OrdinalEqual '2' ([string](@(Get-TargetCandidates $scan 'https://example.com/path').Count))
}

Invoke-Test 'Test-DocumentGeometry accepts visible overlap only' @('Test-DocumentGeometry', 'Test-PositiveRectangle') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 10 10 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 20 80 760 500)
  Assert-True (Test-DocumentGeometry $document $window) 'visible overlapping document was rejected'

  $document.Current.IsOffscreen = $true
  Assert-False (Test-DocumentGeometry $document $window) 'offscreen document was accepted'
  $document.Current.IsOffscreen = $false

  $document.Current.BoundingRectangle = New-TestRect 900 80 100 100
  Assert-False (Test-DocumentGeometry $document $window) 'non-overlapping document was accepted'
  $document.Current.BoundingRectangle = New-TestRect 20 80 0 100
  Assert-False (Test-DocumentGeometry $document $window) 'zero-width document was accepted'
  $document.Current.BoundingRectangle = New-TestRect ([double]::NaN) 80 100 100
  Assert-False (Test-DocumentGeometry $document $window) 'non-finite document geometry was accepted'
}

Invoke-Test 'Is-TopLevelBrowserDocument requires exact window ancestry' @('Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Assert-True (Is-TopLevelBrowserDocument $document $window) 'top-level document in exact window was rejected'

  $nestedDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 10 70 780 520)
  Connect-TestParent $nestedDocument $document
  Assert-False (Is-TopLevelBrowserDocument $nestedDocument $window) 'nested document was accepted'

  $otherWindow = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false 101 303
  Connect-TestParent $document $otherWindow
  Assert-False (Is-TopLevelBrowserDocument $document $window) 'document belonging to another window was accepted'
}

Invoke-Test 'Get-ElementWindowDisposition distinguishes nested from unknown ancestry' @('Get-ElementWindowDisposition') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Assert-OrdinalEqual 'exact_window' (Get-ElementWindowDisposition $document $window)

  $nested = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 10 70 780 520)
  Connect-TestParent $nested $document
  Assert-OrdinalEqual 'nested_document' (Get-ElementWindowDisposition $nested $window)

  $unreadable = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 10 70 780 520)
  $unreadable.ThrowOnParent = $true
  Assert-OrdinalEqual 'unknown' (Get-ElementWindowDisposition $unreadable $window)

  $deep = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 10 10)
  $leaf = $deep
  for ($index = 0; $index -lt 65; $index++) {
    $parent = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 10 10)
    Connect-TestParent $leaf $parent
    $leaf = $parent
  }
  Connect-TestParent $leaf $window
  Assert-OrdinalEqual 'unknown' (Get-ElementWindowDisposition $deep $window)
}

Invoke-Test 'Get-ElementWindowDisposition recognizes a Document toolbar ancestor only after the exact Window' @('Get-ElementWindowDisposition') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $toolbar = New-TestElement ([System.Windows.Automation.ControlType]::ToolBar) (New-TestRect 0 0 800 60)
  $pseudoDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 100 10 30 31)
  Connect-TestParent $pseudoDocument $toolbar
  Connect-TestParent $toolbar $window
  Assert-OrdinalEqual 'browser_chrome' (Get-ElementWindowDisposition $pseudoDocument $window $true $true)

  $tab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 100 10 160 40)
  Connect-TestParent $tab $toolbar
  Assert-OrdinalEqual 'exact_window' (Get-ElementWindowDisposition $tab $window)

  $otherWindow = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false 101 303
  Connect-TestParent $toolbar $otherWindow
  Assert-OrdinalEqual 'unknown' (Get-ElementWindowDisposition $pseudoDocument $window $true $true)

  $unreadableAncestor = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 800 60)
  $unreadableAncestor.Current = $null
  Connect-TestParent $pseudoDocument $unreadableAncestor
  Connect-TestParent $unreadableAncestor $window
  Assert-OrdinalEqual 'unknown' (Get-ElementWindowDisposition $pseudoDocument $window $true $true)

  Connect-TestParent $pseudoDocument $toolbar
  $toolbar.Parent = $null
  Assert-OrdinalEqual 'unknown' (Get-ElementWindowDisposition $pseudoDocument $window $true $true)
}

Invoke-Test 'Get-ElementWindowDisposition accepts only Firefox Documents under tabbrowser-tabpanels' @('Get-ElementWindowDisposition') {
  $browserProcess = 'firefox'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $tabPanels = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 60 800 540) $false 101 202 '' 'tabbrowser-tabpanels'
  $selectedPanel = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 60 800 540) $false 101 202 'browserSidebarContainer deck-selected' 'panel-3-2'
  $contentDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $contentDocument $selectedPanel
  Connect-TestParent $selectedPanel $tabPanels
  Connect-TestParent $tabPanels $window
  Assert-OrdinalEqual 'exact_window' (Get-ElementWindowDisposition $contentDocument $window $true $true)

  $translationPanel = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 400 80 300 300) $false 101 202 'translations-panel' 'full-page-translations-panel'
  $translationDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 400 80 300 300) $false 101 202 'PanelUI-subView translations-panel-view' 'full-page-translations-panel-view-default'
  Connect-TestParent $translationDocument $translationPanel
  Connect-TestParent $translationPanel $window
  Assert-OrdinalEqual 'browser_chrome' (Get-ElementWindowDisposition $translationDocument $window $true $true)
}

Invoke-Test 'Read-PageIdentity returns normalized HTTP identity' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'HTTP://EXAMPLE.COM:80/Case#Part' })
  $window.Descendants = @($document)
  $identity = Read-PageIdentity $window
  Assert-OrdinalEqual 'http_url' ([string]$identity.state)
  Assert-OrdinalEqual 'http://example.com/Case#Part' ([string]$identity.url)
}

Invoke-Test 'Read-PageIdentity skips a toolbar pseudo-Document and reads the sole content Document' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $toolbar = New-TestElement ([System.Windows.Automation.ControlType]::ToolBar) (New-TestRect 0 0 800 60)
  $pseudoDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 100 10 30 31)
  $contentDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $pseudoDocument $toolbar
  Connect-TestParent $toolbar $window
  Connect-TestParent $contentDocument $window
  Set-TestPattern $pseudoDocument $true ([pscustomobject]@{ Value = 'https://example.com/toolbar' })
  Set-TestPattern $contentDocument $true ([pscustomobject]@{ Value = 'https://example.com/content' })
  $window.Descendants = @($pseudoDocument, $contentDocument)
  $identity = Read-PageIdentity $window
  Assert-OrdinalEqual 'http_url' ([string]$identity.state)
  Assert-OrdinalEqual 'https://example.com/content' ([string]$identity.url)
}

Invoke-Test 'Read-PageIdentity recognizes only the current browser new-tab identity' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $families = @(
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://newtab/' },
    [pscustomobject]@{ process = 'msedge'; value = 'edge://newtab' },
    [pscustomobject]@{ process = 'brave'; value = 'brave://newtab/' }
  )
  foreach ($family in $families) {
    $browserProcess = $family.process
    $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
    $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
    Connect-TestParent $document $window
    Set-TestPattern $document $true ([pscustomobject]@{ Value = $family.value })
    $window.Descendants = @($document)
    $identity = Read-PageIdentity $window
    Assert-OrdinalEqual 'known_non_target' ([string]$identity.state)
    Assert-OrdinalEqual '' ([string]$identity.url)
  }

  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $wrongFamily = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $wrongFamily $window
  Set-TestPattern $wrongFamily $true ([pscustomobject]@{ Value = 'edge://newtab/' })
  $window.Descendants = @($wrongFamily)
  Assert-OrdinalEqual 'unknown' ([string](Read-PageIdentity $window).state)

  $wrongFamily.PatternObject.Current = [pscustomobject]@{ Value = 'chrome://NewTab/' }
  Assert-OrdinalEqual 'unknown' ([string](Read-PageIdentity $window).state)
}

Invoke-Test 'Read-PageIdentity recognizes the measured Chrome new-tab-page Document identity' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'chrome://new-tab-page/' })
  $window.Descendants = @($document)

  $identity = Read-PageIdentity $window
  Assert-OrdinalEqual 'known_non_target' ([string]$identity.state)
  Assert-OrdinalEqual '' ([string]$identity.url)
}

Invoke-Test 'Read-PageIdentity refuses unmeasured or cross-browser new-tab-page lookalikes' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $cases = @(
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://new-tab-page' },
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://New-Tab-Page/' },
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://new-tab-page/?query=1' },
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://new-tab-page/#fragment' },
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://new-tab-page/path' },
    [pscustomobject]@{ process = 'chrome'; value = 'chrome://user@new-tab-page/' },
    [pscustomobject]@{ process = 'chrome'; value = 'edge://new-tab-page/' },
    [pscustomobject]@{ process = 'chrome'; value = 'brave://new-tab-page/' },
    [pscustomobject]@{ process = 'msedge'; value = 'chrome://new-tab-page/' },
    [pscustomobject]@{ process = 'brave'; value = 'chrome://new-tab-page/' }
  )
  foreach ($case in $cases) {
    $browserProcess = $case.process
    $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
    $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
    Connect-TestParent $document $window
    Set-TestPattern $document $true ([pscustomobject]@{ Value = $case.value })
    $window.Descendants = @($document)
    Assert-OrdinalEqual 'unknown' ([string](Read-PageIdentity $window).state)
  }
}

Invoke-Test 'Read-PageIdentity keeps ambiguous and unprovable Documents unknown' @('Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $exact = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  $unknown = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $exact $window
  $unknown.ThrowOnParent = $true
  Set-TestPattern $exact $true ([pscustomobject]@{ Value = 'https://example.com/' })
  Set-TestPattern $unknown $true ([pscustomobject]@{ Value = 'https://example.net/' })
  $window.Descendants = @($exact, $unknown)
  Assert-OrdinalEqual 'unknown' ([string](Read-PageIdentity $window).state)

  $second = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $second $window
  Set-TestPattern $second $true ([pscustomobject]@{ Value = 'https://example.net/' })
  $window.Descendants = @($exact, $second)
  Assert-OrdinalEqual 'unknown' ([string](Read-PageIdentity $window).state)
}

Invoke-Test 'Read-Url reads one authoritative Document ValuePattern' @('Read-Url', 'Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'HTTP://EXAMPLE.COM:80/Case?Q=Mixed#Part' })
  $window.Descendants = @($document)
  Assert-OrdinalEqual 'http://example.com/Case?Q=Mixed#Part' (Read-Url $window)
}

Invoke-Test 'Read-UrlWithRetry recovers one transient empty accessibility sample' @('Read-UrlWithRetry', 'Read-Url', 'Read-PageIdentity', 'Get-ElementWindowDisposition', 'Test-DocumentGeometry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $browserProcess = 'chrome'
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $empty = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  $target = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $empty $window
  Connect-TestParent $target $window
  Set-TestPattern $empty $false $null
  Set-TestPattern $target $true ([pscustomobject]@{ Value = 'https://example.com/recovered' })
  $window.FindAllResults = [object[][]]@(
    [object[]]@($empty),
    [object[]]@($target)
  )
  Assert-OrdinalEqual 'https://example.com/recovered' (Read-UrlWithRetry $window 2 0)
}

Invoke-Test 'Read-Url ignores toolbar values and refuses no authoritative source' @('Read-Url', 'Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $toolbarEdit = New-TestElement ([System.Windows.Automation.ControlType]::Edit) (New-TestRect 100 10 500 40)
  Connect-TestParent $toolbarEdit $window
  Set-TestPattern $toolbarEdit $true ([pscustomobject]@{ Value = 'https://example.com/toolbar' })
  $window.Descendants = @($toolbarEdit)
  Assert-OrdinalEqual '' (Read-Url $window)
}

Invoke-Test 'Read-Url refuses missing or invalid Document ValuePattern' @('Read-Url', 'Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  Connect-TestParent $document $window
  Set-TestPattern $document $false $null
  $window.Descendants = @($document)
  Assert-OrdinalEqual '' (Read-Url $window)

  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'example.com/scheme-less' })
  Assert-OrdinalEqual '' (Read-Url $window)
}

Invoke-Test 'Read-Url refuses multiple eligible Documents' @('Read-Url', 'Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $first = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  $second = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 10 70 780 520)
  Connect-TestParent $first $window
  Connect-TestParent $second $window
  Set-TestPattern $first $true ([pscustomobject]@{ Value = 'https://example.com/first' })
  Set-TestPattern $second $true ([pscustomobject]@{ Value = 'https://example.com/second' })
  $window.Descendants = @($first, $second)
  Assert-OrdinalEqual '' (Read-Url $window)
}

Invoke-Test 'Read-Url excludes a nested Document from uniqueness' @('Read-Url', 'Is-TopLevelBrowserDocument', 'Test-DocumentGeometry', 'Test-ElementWindowAncestry', 'Test-PositiveRectangle', 'Normalize-Url') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $top = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540)
  $nested = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 10 70 780 520)
  Connect-TestParent $top $window
  Connect-TestParent $nested $top
  Set-TestPattern $top $true ([pscustomobject]@{ Value = 'https://example.com/top' })
  Set-TestPattern $nested $true ([pscustomobject]@{ Value = 'https://example.com/nested' })
  $window.Descendants = @($top, $nested)
  Assert-OrdinalEqual 'https://example.com/top' (Read-Url $window)
}

Invoke-Test 'Scan-TargetCandidates remains incomplete beside an unknown-ancestry tab' @('Scan-TargetCandidates', 'Get-ElementWindowDisposition', 'Read-PageIdentity', 'Remember-OriginalSelection', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $window = New-ScanWindow $owner 701 $true
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($window)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'unknown ancestry was silently treated as a complete scan'
  Assert-OrdinalEqual '1' ([string]$scan.exact.Count)
}

Invoke-Test 'Scan-TargetCandidates ignores a matching non-Window root only after zero-TabItem enumeration' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $pane = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 683 588 87 32) $false $PID 713
  $pane.Descendants = @()
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($pane)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-True ([bool]$scan.complete) 'proven zero-tab matching Pane made the scan incomplete'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
}

Invoke-Test 'Scan-TargetCandidates rejects a zero-tab matching non-Window root with invalid identity' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $pane = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 683 588 87 32) $false $PID 0
  $pane.Descendants = @()
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($pane)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'zero-tab non-Window with invalid candidate identity was silently skipped'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
}

Invoke-Test 'Scan-TargetCandidates rejects a matching non-Window root containing a TabItem' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $pane = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 800 600) $false $PID 714
  $tab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID 714
  Connect-TestParent $tab $pane
  Set-TestPattern $tab $true ([pscustomobject]@{ IsSelected = $true })
  $pane.Descendants = @($tab)
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($pane)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'non-Window root with a TabItem was silently skipped'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
  Assert-OrdinalEqual '0' ([string]$tab.PatternObject.SelectCallCount)
}

Invoke-Test 'Scan-TargetCandidates keeps a true Window with zero TabItems incomplete' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 715
  $window.Descendants = @()
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($window)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'true browser Window with zero TabItems was silently accepted'
}

Invoke-Test 'Scan-TargetCandidates fails closed on unreadable matching root properties' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $unreadable = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 800 600) $false $PID 716
  $unreadable.Current = $null
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($unreadable)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'unreadable matching root properties did not fail closed'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)

  $missingType = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 800 600) $false $PID 716
  $missingType.Current.ControlType = $null
  $root.Descendants = @($missingType)
  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'matching root with null ControlType did not fail closed'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
}

Invoke-Test 'Scan-TargetCandidates fails closed when a matching non-Window root cannot enumerate TabItems' @('Scan-TargetCandidates') {
  $null = Initialize-ScanGlobals
  $pane = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 800 600) $false $PID 717
  $pane.ThrowOnFindAll = $true
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($pane)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'failed non-Window TabItem enumeration was silently skipped'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
}

Invoke-Test 'Scan-TargetCandidates never selects when the original selected tab is unreadable' @('Scan-TargetCandidates', 'Remember-OriginalSelection', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 711
  $unreadableSelectedTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID 711
  $selectableTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID 711
  Connect-TestParent $unreadableSelectedTab $window
  Connect-TestParent $selectableTab $window
  Set-TestPattern $unreadableSelectedTab $false $null
  Set-TestPattern $selectableTab $true ([pscustomobject]@{ IsSelected = $false })
  $window.Descendants = @($unreadableSelectedTab, $selectableTab)
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($window)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'unrecordable original selection did not make the scan incomplete'
  Assert-OrdinalEqual '0' ([string]$scan.exact.Count)
  Assert-OrdinalEqual '0' ([string]$selectableTab.PatternObject.SelectCallCount)
}

Invoke-Test 'Scan-TargetCandidates never selects when the original selection is ambiguous' @('Scan-TargetCandidates', 'Remember-OriginalSelection', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 712
  $first = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID 712
  $second = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID 712
  Connect-TestParent $first $window
  Connect-TestParent $second $window
  Set-TestPattern $first $true ([pscustomobject]@{ IsSelected = $true })
  Set-TestPattern $second $true ([pscustomobject]@{ IsSelected = $true })
  $window.Descendants = @($first, $second)
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($window)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'ambiguous original selection did not make the scan incomplete'
  Assert-OrdinalEqual '0' ([string]$first.PatternObject.SelectCallCount)
  Assert-OrdinalEqual '0' ([string]$second.PatternObject.SelectCallCount)
}

Invoke-Test 'Scan-TargetCandidatesWithRetry retries an incomplete scan despite a candidate' @('Scan-TargetCandidatesWithRetry', 'Scan-TargetCandidates', 'Get-ElementWindowDisposition', 'Read-PageIdentity', 'Remember-OriginalSelection', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $firstWindow = New-ScanWindow $owner 702 $true
  $secondWindow = New-ScanWindow $owner 703 $false
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.FindAllResults = [object[][]]@(
    [object[]]@($firstWindow),
    [object[]]@($secondWindow)
  )
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidatesWithRetry
  Assert-True ([bool]$scan.complete) 'retry did not return the complete second scan'
  Assert-OrdinalEqual '1' ([string]$scan.exact.Count)
  Assert-OrdinalEqual '2' ([string]$root.FindAllCallCount)
  Assert-True ($scan.exact.ContainsKey('101:703:10:10:160:40') -or $scan.exact.ContainsKey("$($PID):703:10:10:160:40")) 'returned candidates did not come from the second scan'
}

Invoke-Test 'Scan-TargetCandidates fails closed when distinct tabs collide on Element-Key' @('Scan-TargetCandidates', 'Get-ElementWindowDisposition', 'Read-PageIdentity', 'Remember-OriginalSelection', 'Test-CandidateIdentity', 'Element-Key') {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 704
  $firstTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10.1 10.1 160.1 40.1) $false $PID 704
  $secondTab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10.4 10.4 160.4 40.4) $false $PID 704
  Connect-TestParent $firstTab $window
  Connect-TestParent $secondTab $window
  Set-TestPattern $firstTab $true ([pscustomobject]@{ IsSelected = $true })
  Set-TestPattern $secondTab $true ([pscustomobject]@{ IsSelected = $false })
  $secondTab.PatternObject.SelectedCurrent = [pscustomobject]@{ IsSelected = $true }

  $firstDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540) $false $PID 704
  $secondDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540) $false $PID 704
  Connect-TestParent $firstDocument $window
  Connect-TestParent $secondDocument $window
  Set-TestPattern $firstDocument $true ([pscustomobject]@{ Value = 'https://example.com/target' })
  Set-TestPattern $secondDocument $true ([pscustomobject]@{ Value = 'https://example.com/target' })
  $window.FindAllResults = [object[][]]@(
    [object[]]@($firstTab, $secondTab),
    [object[]]@($firstDocument),
    [object[]]@($secondDocument)
  )
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.Descendants = @($window)
  [DriftyPs51TestAutomationElement]::RootElement = $root

  Assert-OrdinalEqual (Element-Key $window $firstTab) (Element-Key $window $secondTab)
  Assert-False ([object]::ReferenceEquals($firstTab, $secondTab)) 'synthetic tabs were not distinct'
  $scan = Scan-TargetCandidates
  Assert-False ([bool]$scan.complete) 'distinct tabs sharing a geometry key falsely proved uniqueness'
  Assert-True ($scan.exact.Count -le 1) 'collision produced more than one retained hashtable candidate'
}

Invoke-Test 'Scan-TargetCandidatesWithRetry retries a complete empty first scan' @('Scan-TargetCandidatesWithRetry', 'Scan-TargetCandidates', 'Get-ElementWindowDisposition', 'Read-PageIdentity', 'Remember-OriginalSelection', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $secondWindow = New-ScanWindow $owner 705 $false
  $root = New-TestElement ([System.Windows.Automation.ControlType]::Pane) (New-TestRect 0 0 1 1)
  $root.FindAllResults = [object[][]]@(
    [object[]]@(),
    [object[]]@($secondWindow)
  )
  [DriftyPs51TestAutomationElement]::RootElement = $root

  $scan = Scan-TargetCandidatesWithRetry
  Assert-True ([bool]$scan.complete) 'complete target-bearing second scan was rejected'
  Assert-OrdinalEqual '1' ([string]$scan.exact.Count)
  Assert-OrdinalEqual '2' ([string]$root.FindAllCallCount)
}

Invoke-Test 'Test-SelectedCandidate rejects stale URL and unselected tab' @('Test-SelectedCandidate', 'Test-CandidateIdentity', 'Test-BrowserTab', 'Read-Url', 'Test-UrlMatch', 'Normalize-ExecutablePath') {
  $owner = [Diagnostics.Process]::GetProcessById($PID)
  $browserProcess = $owner.ProcessName.ToLowerInvariant()
  $browserIdentity = Normalize-ExecutablePath $owner.MainModule.FileName
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 202
  $tab = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40) $false $PID 202
  Connect-TestParent $tab $window
  Set-TestPattern $tab $true ([pscustomobject]@{ IsSelected = $true })
  $document = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540) $false $PID 202
  Connect-TestParent $document $window
  Set-TestPattern $document $true ([pscustomobject]@{ Value = 'https://example.com/Target' })
  $window.Descendants = @($document)
  $candidate = [pscustomobject]@{
    window = $window
    tab = $tab
    url = 'https://example.com/Target'
    ownerPid = $PID
    ownerStartTicks = $owner.StartTime.ToUniversalTime().Ticks
    windowHandle = 202
  }
  Assert-True (Test-SelectedCandidate $candidate) 'unchanged selected candidate was rejected'

  $document.PatternObject.Current = [pscustomobject]@{ Value = 'https://example.com/Changed' }
  Assert-False (Test-SelectedCandidate $candidate) 'candidate with stale URL was accepted'
  $document.PatternObject.Current = [pscustomobject]@{ Value = 'https://example.com/Target' }
  $tab.PatternObject.Current = [pscustomobject]@{ IsSelected = $false }
  Assert-False (Test-SelectedCandidate $candidate) 'unselected candidate was accepted'
}

Invoke-Test 'Test-HasOtherBrowserTab refuses last tab and missing target' @('Test-HasOtherBrowserTab', 'Test-BrowserTab') {
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600)
  $target = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 10 10 160 40)
  $other = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40)
  Connect-TestParent $target $window
  Connect-TestParent $other $window
  $candidate = [pscustomobject]@{ window = $window; tab = $target }

  $window.Descendants = @($target)
  Assert-False (Test-HasOtherBrowserTab $candidate) 'last browser tab was accepted'
  $window.Descendants = @($target, $other)
  Assert-True (Test-HasOtherBrowserTab $candidate) 'candidate with another browser tab was rejected'
  $window.Descendants = @($other)
  Assert-False (Test-HasOtherBrowserTab $candidate) 'missing candidate tab was accepted'
  $window.Descendants = @($target, $other)
  $other.Current.IsOffscreen = $true
  Assert-False (Test-HasOtherBrowserTab $candidate) 'offscreen second tab bypassed last-tab refusal'
}

Invoke-Test 'Get-PostCloseVerification rejects the same element after navigation despite URL absence' @('Get-PostCloseVerification', 'Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity') {
  $fixture = New-PostCloseFixture 721
  $navigatedDocument = New-TestElement ([System.Windows.Automation.ControlType]::Document) (New-TestRect 0 60 800 540) $false $PID 721
  Connect-TestParent $navigatedDocument $fixture.window
  Set-TestPattern $navigatedDocument $true ([pscustomobject]@{ Value = 'https://example.com/navigated-away' })
  $fixture.window.Descendants = @($fixture.targetTab, $navigatedDocument)
  $scan = [pscustomobject]@{ complete = $true; exact = @{}; domain = @{} }

  Assert-False ([bool](Get-PostCloseVerification $fixture.candidate $scan 'exact_url').verified) 'URL disappearance was accepted while the same tab element remained'
}

Invoke-Test 'Test-PostCloseCandidateAbsent fails closed when element comparison throws' @('Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity', 'Test-BrowserTab') {
  $fixture = New-PostCloseFixture 720
  $survivor = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID 720
  Connect-TestParent $survivor $fixture.window
  $fixture.window.Descendants = @($fixture.targetTab, $survivor)
  $originalCompare = ${function:Compare-AutomationElement}
  try {
    Set-Item Function:Compare-AutomationElement { throw 'synthetic comparison failure' }
    Assert-False (Test-PostCloseCandidateAbsent $fixture.candidate) 'comparison failure was mistaken for verified candidate absence'
  } finally {
    Set-Item Function:Compare-AutomationElement $originalCompare
  }
}

Invoke-Test 'Get-PostCloseVerification rejects changed PID HWND or start identity' @('Get-PostCloseVerification', 'Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity') {
  $scan = [pscustomobject]@{ complete = $true; exact = @{}; domain = @{} }
  $pidChanged = New-PostCloseFixture 722
  $pidChanged.window.Descendants = @()
  $pidChanged.window.Current.ProcessId = $PID + 1
  Assert-False ([bool](Get-PostCloseVerification $pidChanged.candidate $scan 'exact_url').verified) 'changed PID was accepted as the original browser window'

  $handleChanged = New-PostCloseFixture 723
  $handleChanged.window.Descendants = @()
  $handleChanged.window.Current.NativeWindowHandle = 724
  Assert-False ([bool](Get-PostCloseVerification $handleChanged.candidate $scan 'exact_url').verified) 'changed HWND was accepted as the original browser window'

  $startChanged = New-PostCloseFixture 725
  $startChanged.window.Descendants = @()
  $startChanged.candidate.ownerStartTicks = $startChanged.candidate.ownerStartTicks + 1
  Assert-False ([bool](Get-PostCloseVerification $startChanged.candidate $scan 'exact_url').verified) 'changed process-start identity was accepted as the original browser window'
}

Invoke-Test 'Get-PostCloseVerification accepts absent candidate plus absent target URL' @('Get-PostCloseVerification', 'Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity') {
  $fixture = New-PostCloseFixture 724
  $replacement = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID 724
  Connect-TestParent $replacement $fixture.window
  $fixture.window.Descendants = @($replacement)
  $scan = [pscustomobject]@{ complete = $true; exact = @{}; domain = @{} }

  Assert-True ([bool](Get-PostCloseVerification $fixture.candidate $scan 'exact_url').verified) 'absent candidate plus absent target URL with stable identity was rejected'
}

Invoke-Test 'Get-PostCloseVerification rejects an empty survivor enumeration' @('Get-PostCloseVerification', 'Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity') {
  $fixture = New-PostCloseFixture 727
  $fixture.window.Descendants = @()
  $scan = [pscustomobject]@{ complete = $true; exact = @{}; domain = @{} }

  Assert-False ([bool](Get-PostCloseVerification $fixture.candidate $scan 'exact_url').verified) 'empty candidate and target enumerations falsely proved candidate absence'
}

Invoke-Test 'Get-PostCloseVerification still requires an empty target URL scan' @('Get-PostCloseVerification', 'Test-PostCloseCandidateAbsent', 'Test-CandidateIdentity') {
  $fixture = New-PostCloseFixture 726
  $replacement = New-TestElement ([System.Windows.Automation.ControlType]::TabItem) (New-TestRect 170 10 160 40) $false $PID 726
  Connect-TestParent $replacement $fixture.window
  $fixture.window.Descendants = @($replacement)
  $scan = [pscustomobject]@{ complete = $true; exact = @{ remaining = [pscustomobject]@{ key = 'remaining' } }; domain = @{} }

  Assert-False ([bool](Get-PostCloseVerification $fixture.candidate $scan 'exact_url').verified) 'candidate absence bypassed the existing target URL absence requirement'
}

Invoke-Test 'Restore-OriginalSelections reports selection failure while foreground restoration succeeds' @('Restore-OriginalSelections', 'Restore-BrowserSelections', 'Test-SelectionSelected', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 731
  $selection = [DriftyPs51TestPattern]::new()
  $selection.Current = [pscustomobject]@{ IsSelected = $false }
  $selection.ThrowOnSelect = $true
  $windowKey = Window-Key $window
  $originalSelections[$windowKey] = $selection
  $originalSelectionKeys[$windowKey] = 'original'
  $originalWindowIdentities[$windowKey] = [pscustomobject]@{
    window = $window
    ownerPid = $PID
    ownerStartTicks = $owner.StartTime.ToUniversalTime().Ticks
    windowHandle = 731
  }

  Assert-False (Restore-OriginalSelections { return $true }) 'foreground success masked a failed tab-selection restore'
  Assert-OrdinalEqual '1' ([string]$selection.SelectCallCount)
}

Invoke-Test 'Restore-OriginalSelections accepts the uniquely selected replacement for a closed original target' @('Restore-OriginalSelections', 'Restore-BrowserSelections', 'Test-SelectionSelected', 'Test-CandidateIdentity') {
  $owner = Initialize-ScanGlobals
  $window = New-TestElement ([System.Windows.Automation.ControlType]::Window) (New-TestRect 0 0 800 600) $false $PID 732
  $deadOriginal = [DriftyPs51TestPattern]::new()
  $deadOriginal.Current = [pscustomobject]@{ IsSelected = $false }
  $deadOriginal.ThrowOnSelect = $true
  $replacement = [DriftyPs51TestPattern]::new()
  $replacement.Current = [pscustomobject]@{ IsSelected = $true }
  $windowKey = Window-Key $window
  $originalSelections[$windowKey] = $deadOriginal
  $originalSelectionKeys[$windowKey] = 'closed-target'
  $replacementSelections[$windowKey] = $replacement
  $originalWindowIdentities[$windowKey] = [pscustomobject]@{
    window = $window
    ownerPid = $PID
    ownerStartTicks = $owner.StartTime.ToUniversalTime().Ticks
    windowHandle = 732
  }
  $attemptedCloseTabKey = 'closed-target'
  $attemptedCloseTabAbsent = $true

  Assert-True (Restore-OriginalSelections { return $true }) 'the verified replacement selection was not accepted for the deliberately closed original target'
  Assert-OrdinalEqual '0' ([string]$deadOriginal.SelectCallCount)
}

$passedCount = @($results | Where-Object { $_.passed }).Count
$failedCount = $results.Count - $passedCount
[pscustomobject]@{
  scriptPath = $resolvedScriptPath
  sourceSha256 = $sourceHash
  passed = $passedCount
  failed = $failedCount
  results = $results.ToArray()
} | ConvertTo-Json -Depth 6 -Compress

if ($failedCount -ne 0) { exit 1 }
exit 0
