param(
  [Parameter(Mandatory = $true)]
  [string]$ScriptPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$cases = New-Object System.Collections.Generic.List[object]

function Add-Case([string]$name, [bool]$passed, [string]$detail = '') {
  $cases.Add([pscustomobject]@{ name = $name; passed = $passed; detail = $detail })
}

function Assert-Equal([string]$name, $actual, $expected) {
  $passed = if ($actual -is [string] -and $expected -is [string]) {
    [string]::Equals($actual, $expected, [StringComparison]::Ordinal)
  } else { $actual -eq $expected }
  Add-Case $name $passed $(if ($passed) { '' } else { "expected=$expected actual=$actual" })
}

function New-TestElement(
  [string]$id,
  $controlType,
  [bool]$isOffscreen = $false,
  $rectangle = $null,
  $parent = $null,
  [object[]]$children = @(),
  [string]$value = '',
  [bool]$patternAvailable = $true,
  [bool]$providerFailure = $false,
  [string]$automationId = '',
  [string]$className = ''
) {
  if ($null -eq $rectangle) {
    $rectangle = [pscustomobject]@{ Left = 0; Top = 0; Width = 800; Height = 600 }
  }
  $element = [pscustomobject]@{
    Id = $id
    Current = [pscustomobject]@{
      ControlType = $controlType
      IsOffscreen = $isOffscreen
      BoundingRectangle = $rectangle
      AutomationId = $automationId
      ClassName = $className
    }
    Parent = $parent
    Children = $children
    TestValue = $value
    PatternAvailable = $patternAvailable
    ProviderFailure = $providerFailure
    PrivateMarker = $null
  }
  $element | Add-Member ScriptMethod GetRuntimeId { return @($this.Id.ToCharArray() | ForEach-Object { [int]$_ }) }
  $element | Add-Member ScriptMethod FindAll {
    param($scope, $condition)
    return @($this.Children)
  }
  $element | Add-Member ScriptMethod FindFirst {
    param($scope, $condition)
    return $this.PrivateMarker
  }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($patternId, [ref]$result)
    if ($this.ProviderFailure) { throw 'synthetic provider failure' }
    if (-not $this.PatternAvailable) { return $false }
    $result.Value = [pscustomobject]@{
      Current = [pscustomobject]@{ Value = $this.TestValue }
    }
    return $true
  }
  return $element
}

function New-TestWalker {
  $walker = [pscustomobject]@{}
  $walker | Add-Member ScriptMethod GetParent {
    param($element)
    return $element.Parent
  }
  return $walker
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path -LiteralPath $ScriptPath),
    [ref]$tokens,
    [ref]$parseErrors
  )
  if ($parseErrors.Count -ne 0) {
    throw "source parse failed: $($parseErrors[0].Message)"
  }

  $requiredFunctions = @(
    'Test-SameAutomationElement',
    'Test-ExplicitHttpUrl',
    'Test-FiniteRectangle',
    'Read-ValidatedDocumentUrl',
    'Test-GeckoPrivateWindow',
    'Test-ClassToken',
    'Test-ChromiumInterfaceElement',
    'Find-FocusedTopLevelDocument',
    'Get-DocumentValue',
    'Get-DocumentChain',
    'Select-VivaldiPage',
    'Read-VivaldiPage',
    'Test-VivaldiPrivateWindow',
    'Test-ProfileButtonIncognito',
    'Test-RootViewPrivateLabel',
    'Test-ChromiumPrivateWindow',
    'Test-ChromiumClueIncognito',
    'Read-TopLevelDocument'
  )
  foreach ($functionName in $requiredFunctions) {
    $definition = $ast.FindAll(
      {
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
          $node.Name -eq $functionName
      },
      $true
    ) | Select-Object -First 1
    if ($null -eq $definition) {
      throw "required function missing: $functionName"
    }
    Invoke-Expression $definition.Extent.Text
  }

  $auto = [System.Windows.Automation.AutomationElement]
  $walker = New-TestWalker
  $documentType = [System.Windows.Automation.ControlType]::Document
  $windowType = [System.Windows.Automation.ControlType]::Window
  $paneType = [System.Windows.Automation.ControlType]::Pane
  $documentCondition = New-Object System.Windows.Automation.PropertyCondition(
    $auto::ControlTypeProperty,
    $documentType
  )
  $privateIndicatorCondition = 'synthetic private indicator condition'
  $vivaldiPrivateCondition = 'synthetic Vivaldi private indicator condition'
  $vivaldiInterfaceUrl = 'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html'

  Assert-Equal 'explicit-http-preserved' (Test-ExplicitHttpUrl 'http://127.0.0.1:4173/Docs/?Q=Case#Fragment') $true
  Assert-Equal 'explicit-https-preserved' (Test-ExplicitHttpUrl 'https://example.com/Path/') $true
  Assert-Equal 'schemeless-refused' (Test-ExplicitHttpUrl '127.0.0.1:4173/docs') $false
  Assert-Equal 'credentials-refused' (Test-ExplicitHttpUrl 'https://user:pass@example.com/') $false
  Assert-Equal 'backslash-refused' (Test-ExplicitHttpUrl 'https://example.com\private') $false
  Assert-Equal 'whitespace-refused' (Test-ExplicitHttpUrl ' https://example.com/') $false
  Assert-Equal 'malformed-escape-refused' (Test-ExplicitHttpUrl 'https://example.com/%not-hex') $false

  $root = New-TestElement 'r' $windowType
  $document = New-TestElement 'd' $documentType $false $null $root @() 'http://127.0.0.1:4173/Docs/?Q=Case#Fragment'
  $root.Children = @($document)
  $single = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'single-top-level-found' $single.found $true
  Assert-Equal 'single-top-level-preserves-value' $single.url 'http://127.0.0.1:4173/Docs/?Q=Case#Fragment'

  $container = New-TestElement 'c' $paneType $false $null $root
  $top = New-TestElement 't' $documentType $false $null $container @() 'https://example.com/top/'
  $nested = New-TestElement 'n' $documentType $false $null $top @() 'https://example.com/nested/'
  $root.Children = @($nested, $top)
  $nestedChoice = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'proven-nested-excluded' $nestedChoice.url 'https://example.com/top/'

  $hidden = New-TestElement 'h' $documentType $true $null $root @() 'https://example.com/hidden/'
  $root.Children = @($hidden, $document)
  $visibleChoice = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'proven-offscreen-excluded' $visibleChoice.url 'http://127.0.0.1:4173/Docs/?Q=Case#Fragment'

  $second = New-TestElement 's' $documentType $false $null $root @() 'https://example.com/second/'
  $otherWindow = New-TestElement 'r2' $windowType
  $root.Children = @($document, $second)
  $ambiguous = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'multiple-visible-refused' $ambiguous.found $false
  Assert-Equal 'multiple-visible-diagnostic' ($ambiguous.error -match 'multiple visible top-level documents') $true

  $focusedChoice = Read-TopLevelDocument $root $walker $documentCondition $document
  Assert-Equal 'focused-document-resolves-enumeration-ambiguity' $focusedChoice.found $true
  Assert-Equal 'focused-document-preserves-exact-url' $focusedChoice.url 'http://127.0.0.1:4173/Docs/?Q=Case#Fragment'

  $focusedLeaf = New-TestElement 'f' $paneType $false $null $nested
  $root.Children = @($nested, $top)
  $focusedOuter = Read-TopLevelDocument $root $walker $documentCondition $focusedLeaf
  Assert-Equal 'focused-descendant-chooses-outermost-document' $focusedOuter.url 'https://example.com/top/'

  $chromeFocus = New-TestElement 'b' $paneType $false $null $root
  $root.Children = @($document, $second)
  Assert-Equal 'browser-chrome-focus-keeps-ambiguous-scan-refusal' (Read-TopLevelDocument $root $walker $documentCondition $chromeFocus).found $false

  # Chrome's own interface documents (measured Chrome 158) are not the page:
  # the location bar icon and suggestion list while the address is edited, and
  # a side panel page.
  $contents = New-TestElement 'mc' $paneType $false $null $root @() '' $true $false '' 'MultiContentsView'
  $page = New-TestElement 'pg' $documentType $false $null $contents @() 'https://docs.example.test/page/'
  $locationBar = New-TestElement 'lb' $paneType $false $null $root @() '' $true $false '' 'LocationBarView'
  $locationIcon = New-TestElement 'li' $documentType $false $null $locationBar @() '' $false
  $popupFrame = New-TestElement 'pf' $paneType $false $null $root @() '' $true $false '' 'RoundedOmniboxResultsFrame'
  $popup = New-TestElement 'pp' $documentType $false $null $popupFrame @() 'chrome://omnibox-popup.top-chrome/'
  $sidePanel = New-TestElement 'sp' $paneType $false $null $root @() '' $true $false '' 'SidePanel'
  $panelPage = New-TestElement 'pa' $documentType $false $null $sidePanel @() 'chrome://read-later.top-chrome/'
  $omnibox = New-TestElement 'ob' $paneType $false $null $locationBar
  $root.Children = @($locationIcon, $page, $popup, $panelPage)
  Assert-Equal 'chromium-interface-documents-are-not-the-page' (Read-TopLevelDocument $root $walker $documentCondition $omnibox).url 'https://docs.example.test/page/'
  $panelFocus = New-TestElement 'pc' $paneType $false $null $panelPage
  Assert-Equal 'focus-in-a-side-panel-page-reads-the-tab' (Read-TopLevelDocument $root $walker $documentCondition $panelFocus).url 'https://docs.example.test/page/'
  # A web page shown in the side panel is not the tab's page either.
  $settings = New-TestElement 'st' $documentType $false $null $contents @() 'chrome://settings/'
  $panelWeb = New-TestElement 'pw' $documentType $false $null $sidePanel @() 'https://search.example.test/results'
  $root.Children = @($settings, $panelWeb)
  Assert-Equal 'side-panel-web-page-is-not-taken-for-the-tab' (Read-TopLevelDocument $root $walker $documentCondition $omnibox).found $false
  # An unmeasured container keeps the strict refusal.
  $unknownPanel = New-TestElement 'up' $paneType $false $null $root @() '' $true $false '' 'SomeNewPanel'
  $unknownDocument = New-TestElement 'ud' $documentType $false $null $unknownPanel @() 'chrome://new-panel/'
  $root.Children = @($page, $unknownDocument)
  Assert-Equal 'unmeasured-interface-document-keeps-the-refusal' (Read-TopLevelDocument $root $walker $documentCondition $omnibox).found $false

  $wrongWindowFocus = New-TestElement 'w' $paneType $false $null $otherWindow
  Assert-Equal 'focus-under-wrong-window-refused' (Read-TopLevelDocument $root $walker $documentCondition $wrongWindowFocus).found $false

  $invalidFocused = New-TestElement 'i' $documentType $false $null $root @() 'edge://newtab/'
  $root.Children = @($document)
  Assert-Equal 'invalid-focused-document-does-not-fallback' (Read-TopLevelDocument $root $walker $documentCondition $invalidFocused).found $false

  $orphan = New-TestElement 'o' $documentType $false $null $null @() 'https://example.com/orphan/'
  $root.Children = @($orphan)
  $unknownAncestry = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'unknown-ancestry-refused' ($unknownAncestry.error -match 'document ancestry') $true

  $unknownRectangle = [pscustomobject]@{ Width = $null; Height = 100 }
  $unknownGeometryDocument = New-TestElement 'g' $documentType $false $unknownRectangle $root @() 'https://example.com/geometry/'
  $root.Children = @($unknownGeometryDocument)
  $unknownGeometry = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'unknown-geometry-refused' ($unknownGeometry.error -match 'document geometry') $true

  $providerDocument = New-TestElement 'p' $documentType $false $null $root @() 'https://example.com/provider/' $true $true
  $root.Children = @($providerDocument)
  $providerFailure = Read-TopLevelDocument $root $walker $documentCondition
  Assert-Equal 'provider-failure-refused' $providerFailure.error 'document provider unavailable'

  $root.Children = @($document, $providerDocument)
  Assert-Equal 'valid-plus-unprovable-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $second.TestValue = $document.TestValue
  $root.Children = @($document, $second)
  Assert-Equal 'identical-visible-duplicates-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false

  Assert-Equal 'runtime-id-prefix-is-not-equality' (Test-SameAutomationElement $root $otherWindow) $false
  $top.Parent = $otherWindow
  $root.Children = @($nested, $document)
  Assert-Equal 'nested-under-wrong-window-is-unknown' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $top.Parent = $container

  $unknownGeometryDocument.Current.BoundingRectangle = [pscustomobject]@{ Left = 0; Top = 0; Width = [double]::PositiveInfinity; Height = 100 }
  $root.Children = @($document, $unknownGeometryDocument)
  Assert-Equal 'valid-plus-nonfinite-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $unknownGeometryDocument.Current.BoundingRectangle = [pscustomobject]@{ Left = 900; Top = 0; Width = 100; Height = 100 }
  $root.Children = @($unknownGeometryDocument)
  Assert-Equal 'nonintersecting-visible-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false

  $providerDocument.ProviderFailure = $false
  $providerDocument.PatternAvailable = $false
  $root.Children = @($providerDocument)
  Assert-Equal 'missing-pattern-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $providerDocument.PatternAvailable = $true
  $providerDocument.TestValue = 'chrome://newtab/'
  Assert-Equal 'internal-page-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $providerDocument.TestValue = '127.0.0.1:4173/docs'
  Assert-Equal 'schemeless-document-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false

  $throwingWalker = New-TestWalker
  $throwingWalker | Add-Member -Force ScriptMethod GetParent { throw 'private provider detail' }
  $root.Children = @($document)
  Assert-Equal 'ancestry-exception-refused-and-redacted' (Read-TopLevelDocument $root $throwingWalker $documentCondition).error 'document provider unavailable'
  $cycle = New-TestElement 'cycle' $paneType
  $cycle.Parent = $cycle
  $orphan.Parent = $cycle
  $root.Children = @($orphan)
  Assert-Equal 'ancestry-cycle-depth-refused' (Read-TopLevelDocument $root $walker $documentCondition).error 'document ancestry unavailable'
  $root.Children = @()
  Assert-Equal 'empty-document-scan-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $root.Children = @($document)
  $document.Current.IsOffscreen = $null
  Assert-Equal 'unknown-visibility-refused' (Read-TopLevelDocument $root $walker $documentCondition).found $false
  $document.Current.IsOffscreen = $false

  # Firefox (measured 154): the selected page is a visible Document inside the
  # tabbrowser-tabpanels pane, background pages there are offscreen, and
  # browser panels such as translations are Documents directly under the window.
  $ffRoot = New-TestElement 'fr' $windowType
  $panels = New-TestElement 'fp' $paneType $false $null $ffRoot @() '' $true $false 'tabbrowser-tabpanels'
  $deck = New-TestElement 'fd' $paneType $false $null $panels @() '' $true $false '' 'browserSidebarContainer deck-selected'
  $page = New-TestElement 'fg' $documentType $false $null $deck @() 'https://www.youtube.com/watch?v=abc'
  $background = New-TestElement 'fb' $documentType $true $null $deck @() 'https://example.com/background'
  $browserPanel = New-TestElement 'fc' $documentType $false $null $ffRoot @() 'https://translations.example/'
  $ffRoot.Children = @($browserPanel, $background, $page)
  Assert-Equal 'gecko-page-under-tab-panels' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko').url 'https://www.youtube.com/watch?v=abc'
  Assert-Equal 'chromium-rules-refuse-the-same-tree' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'chromium').found $false
  $panelFocus = New-TestElement 'fq' $paneType $false $null $browserPanel
  Assert-Equal 'gecko-panel-focus-falls-back-to-page' (Read-TopLevelDocument $ffRoot $walker $documentCondition $panelFocus 'gecko').url 'https://www.youtube.com/watch?v=abc'
  $pageFocus = New-TestElement 'fx' $paneType $false $null $page
  Assert-Equal 'gecko-focused-page' (Read-TopLevelDocument $ffRoot $walker $documentCondition $pageFocus 'gecko').url 'https://www.youtube.com/watch?v=abc'
  $ffRoot.Children = @($browserPanel)
  $normalNoPage = Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko'
  Assert-Equal 'gecko-without-a-page-refused' $normalNoPage.found $false
  Assert-Equal 'gecko-no-page-privacy-remains-unknown' $normalNoPage.privacy 'unknown'
  $ffRoot.Children = @($browserPanel, $page)
  $ffRoot.PrivateMarker = New-TestElement 'pm' $paneType $false $null $ffRoot
  $privateRead = Read-TopLevelDocument $ffRoot $walker $documentCondition $pageFocus 'gecko'
  Assert-Equal 'gecko-private-window-not-found' $privateRead.found $false
  Assert-Equal 'gecko-private-window-flagged' $privateRead.privacy 'private'
  Assert-Equal 'gecko-private-window-has-no-url' $privateRead.url ''
  Assert-Equal 'chromium-ignores-gecko-private-marker' (Read-TopLevelDocument $ffRoot $walker $documentCondition $pageFocus 'chromium').url 'https://www.youtube.com/watch?v=abc'

  # LibreWolf 156 kept the previous tab's Document on-screen with an empty
  # rectangle after a switch. Only the selected panel's Document is the page.
  $ffRoot.PrivateMarker = $null
  $previousDeck = New-TestElement 'fe' $paneType $false $null $panels @() '' $true $false '' 'browserSidebarContainer'
  $emptyRect = [pscustomobject]@{ Left = [double]::PositiveInfinity; Top = [double]::PositiveInfinity; Width = [double]::NegativeInfinity; Height = [double]::NegativeInfinity }
  $previous = New-TestElement 'fo' $documentType $false $emptyRect $previousDeck @() 'https://example.com/previous'
  $ffRoot.Children = @($previous, $page)
  Assert-Equal 'gecko-previous-tab-left-on-screen-is-skipped' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko').url 'https://www.youtube.com/watch?v=abc'
  $previousFocus = New-TestElement 'fp2' $paneType $false $null $previous
  Assert-Equal 'gecko-focus-in-a-background-panel-falls-back-to-page' (Read-TopLevelDocument $ffRoot $walker $documentCondition $previousFocus 'gecko').url 'https://www.youtube.com/watch?v=abc'
  $deck.Current.ClassName = 'browserSidebarContainer'
  Assert-Equal 'gecko-without-a-selected-panel-refused' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko').found $false
  $deck.Current.ClassName = 'browserSidebarContainer deck-selected'

  # Firefox can report an empty rectangle for a page on the first bounds query
  # and its real bounds on the next. Gecko reads re-query once; Chromium and a
  # rectangle that stays empty are still refused.
  $ffRoot.PrivateMarker = $null
  $ffRoot.Children = @($page)
  $emptyThenReal = [pscustomobject]@{ Reads = 0 }
  $page.Current = [pscustomobject]@{ ControlType = $documentType; IsOffscreen = $false; AutomationId = ''; BoundingRectangle = $null }
  $page.Current | Add-Member -Force ScriptProperty BoundingRectangle {
    $emptyThenReal.Reads++
    if ($emptyThenReal.Reads -eq 1) { return [pscustomobject]@{ Left = [double]::PositiveInfinity; Top = [double]::PositiveInfinity; Width = [double]::NegativeInfinity; Height = [double]::NegativeInfinity } }
    return [pscustomobject]@{ Left = 0; Top = 106; Width = 800; Height = 494 }
  }
  Assert-Equal 'gecko-rereads-a-first-empty-rectangle' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko').url 'https://www.youtube.com/watch?v=abc'
  $emptyThenReal.Reads = 0
  Assert-Equal 'chromium-does-not-reread-geometry' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'chromium').error 'document geometry unavailable'
  $page.Current | Add-Member -Force ScriptProperty BoundingRectangle {
    return [pscustomobject]@{ Left = [double]::PositiveInfinity; Top = [double]::PositiveInfinity; Width = [double]::NegativeInfinity; Height = [double]::NegativeInfinity }
  }
  Assert-Equal 'gecko-persistently-empty-rectangle-refused' (Read-TopLevelDocument $ffRoot $walker $documentCondition $null 'gecko').error 'document geometry unavailable'

  # Vivaldi (measured 8.2): the interface is one top-level Document whose
  # page sits two URL-less webview Documents deeper. Focus is usually in the page.
  $vRoot = New-TestElement 'vr' $windowType
  $interface = New-TestElement 'vi' $documentType $false $null $vRoot @() $vivaldiInterfaceUrl
  $webview = New-TestElement 'vw' $documentType $false $null $interface @() ''
  $guest = New-TestElement 'vg' $documentType $false $null $webview @() ''
  $vPage = New-TestElement 'vp' $documentType $false $null $guest @() 'https://doc.rust-lang.org/book/'
  $vRoot.Children = @($interface, $webview, $guest, $vPage)
  # An unknown private state (no indicator, no address bar yet) does not withhold the page.
  Assert-Equal 'vivaldi-without-address-bar-reads-the-page' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $addressBar = New-TestElement 'vt' ([System.Windows.Automation.ControlType]::ToolBar) $false $null $interface @() '' $true $false '' 'toolbar toolbar-mainbar toolbar-addressbar toolbar-visible'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $vPage)
  Assert-Equal 'vivaldi-page-inside-interface' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').url 'https://doc.rust-lang.org/book/'
  Assert-Equal 'chromium-rules-refuse-the-vivaldi-interface' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'chromium').found $false
  $vFocus = New-TestElement 'vf' $paneType $false $null $vPage
  Assert-Equal 'vivaldi-focused-page' (Read-TopLevelDocument $vRoot $walker $documentCondition $vFocus 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $frame = New-TestElement 'vx' $documentType $false $null $vPage @() 'https://ads.example/frame'
  $frameFocus = New-TestElement 'vy' $paneType $false $null $frame
  Assert-Equal 'vivaldi-focus-in-an-iframe-reads-the-page' (Read-TopLevelDocument $vRoot $walker $documentCondition $frameFocus 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $addressFocus = New-TestElement 'va' $paneType $false $null $interface
  Assert-Equal 'vivaldi-address-bar-focus-falls-back-to-the-page' (Read-TopLevelDocument $vRoot $walker $documentCondition $addressFocus 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $vPage, $frame)
  Assert-Equal 'vivaldi-page-iframe-is-not-a-second-page' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $hiddenTab = New-TestElement 'vh' $documentType $true $null $guest @() 'https://example.com/background'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $hiddenTab, $vPage)
  Assert-Equal 'vivaldi-background-tab-skipped' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').url 'https://doc.rust-lang.org/book/'
  $panelView = New-TestElement 'vpv' $documentType $false $null $interface @() ''
  $panelPage = New-TestElement 'vpp' $documentType $false $null $panelView @() 'https://en.wikipedia.org/'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $vPage, $panelView, $panelPage)
  Assert-Equal 'vivaldi-web-panel-makes-the-page-ambiguous' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').error 'multiple visible top-level documents'
  $internal = New-TestElement 'vin' $documentType $false $null $guest @() 'chrome://vivaldi-webui/startpage'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $internal)
  Assert-Equal 'vivaldi-internal-page-refused' (Read-TopLevelDocument $vRoot $walker $documentCondition $null 'vivaldi').error 'document URL unavailable'
  $vRoot.Children = @($interface, $addressBar, $webview, $guest, $vPage)
  $interface.TestValue = 'chrome-extension://other/window.html'
  Assert-Equal 'vivaldi-other-interface-refused' (Read-TopLevelDocument $vRoot $walker $documentCondition $vFocus 'vivaldi').found $false
  $interface.TestValue = $vivaldiInterfaceUrl
  $indicator = New-TestElement 'vpm' ([System.Windows.Automation.ControlType]::Group) $false $null $addressBar @() '' $true $false '' 'UrlBar-PrivateWindowIndicator'
  $vRoot.Children = @($interface, $addressBar, $indicator, $webview, $guest, $vPage)
  $vPrivate = Read-TopLevelDocument $vRoot $walker $documentCondition $vFocus 'vivaldi'
  Assert-Equal 'vivaldi-private-window-not-found' $vPrivate.found $false
  Assert-Equal 'vivaldi-private-window-flagged' $vPrivate.privacy 'private'
  Assert-Equal 'vivaldi-private-window-has-no-url' $vPrivate.url ''
  $vRoot.Children = @($interface, $indicator, $webview, $guest, $vPage)
  $vIndicatorOnly = Read-TopLevelDocument $vRoot $walker $documentCondition $vFocus 'vivaldi'
  Assert-Equal 'vivaldi-indicator-without-address-bar-still-private' $vIndicatorOnly.privacy 'private'

  # Whale (measured 5.39): a private window has the same title; only the
  # profile button's localized name differs. The labels come from the host.
  $labelAssignment = $ast.FindAll(
    {
      param($node)
      $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$profileIncognitoLabels'
    },
    $true
  ) | Select-Object -First 1
  if ($null -eq $labelAssignment) { throw 'profile incognito labels missing' }
  Invoke-Expression $labelAssignment.Extent.Text
  $avatarButtonCondition = 'synthetic avatar button condition'
  $rootViewCondition = 'synthetic root view condition'
  $rootViewClasses = @('BrowserRootView', 'BraveBrowserRootView', 'RootView')
  $koreanIncognito = -join ([char[]](0xC2DC, 0xD06C, 0xB9BF, 0x20, 0xBAA8, 0xB4DC, 0xB97C, 0x20, 0xC0AC, 0xC6A9, 0x20, 0xC911, 0xC785, 0xB2C8, 0xB2E4, 0x2E))
  $wRoot = New-TestElement 'wr' $windowType
  $wPage = New-TestElement 'wp' $documentType $false $null $wRoot @() 'https://doc.rust-lang.org/book/'
  $wRoot.Children = @($wPage)
  Assert-Equal 'whale-without-profile-button-reads-the-page' (Read-TopLevelDocument $wRoot $walker $documentCondition $null 'whale').url 'https://doc.rust-lang.org/book/'
  $wAvatar = New-TestElement 'wa' ([System.Windows.Automation.ControlType]::Button) $false $null $wRoot @() '' $true $false 'view_57082' 'AvatarToolbarButton'
  $wAvatar.Current | Add-Member NoteProperty Name ([string][char]0xB098)
  $wRoot.PrivateMarker = $wAvatar
  Assert-Equal 'whale-korean-normal-profile-reads-the-page' (Read-TopLevelDocument $wRoot $walker $documentCondition $null 'whale').url 'https://doc.rust-lang.org/book/'
  $wAvatar.Current.Name = 'You'
  Assert-Equal 'whale-english-normal-profile-reads-the-page' (Read-TopLevelDocument $wRoot $walker $documentCondition $null 'whale').url 'https://doc.rust-lang.org/book/'
  $wAvatar.Current.Name = $koreanIncognito
  $wKorean = Read-TopLevelDocument $wRoot $walker $documentCondition $null 'whale'
  Assert-Equal 'whale-korean-incognito-not-found' $wKorean.found $false
  Assert-Equal 'whale-korean-incognito-flagged' $wKorean.privacy 'private'
  Assert-Equal 'whale-korean-incognito-has-no-url' $wKorean.url ''
  $wAvatar.Current.Name = "You're Incognito"
  $wEnglish = Read-TopLevelDocument $wRoot $walker $documentCondition $null 'whale'
  Assert-Equal 'whale-english-incognito-flagged' $wEnglish.privacy 'private'
  Assert-Equal 'whale-english-incognito-has-no-url' $wEnglish.url ''
  Assert-Equal 'chromium-ignores-whale-profile-button' (Read-TopLevelDocument $wRoot $walker $documentCondition $null 'chromium').url 'https://doc.rust-lang.org/book/'
  # Chrome 155 (measured): the profile button reads "secret mode" in Hangul or
  # "Incognito"; normal windows show the profile name. Only clues are refused.
  $wAvatar.Current.Name = -join ([char[]](0xC2DC, 0xD06C, 0xB9BF, 0x20, 0xBAA8, 0xB4DC))
  Assert-Equal 'chrome-korean-incognito-clues-refused' (Test-ChromiumClueIncognito 'chromium' $wRoot) $true
  Assert-Equal 'chrome-korean-incognito-keeps-its-url' (Read-TopLevelDocument $wRoot $walker $documentCondition $null 'chromium').url 'https://doc.rust-lang.org/book/'
  $wAvatar.Current.Name = 'Incognito'
  Assert-Equal 'chrome-english-incognito-clues-refused' (Test-ChromiumClueIncognito 'chromium' $wRoot) $true
  $wAvatar.Current.Name = 'You'
  Assert-Equal 'chrome-english-normal-clues-allowed' (Test-ChromiumClueIncognito 'chromium' $wRoot) $false
  $wAvatar.Current.Name = ([string][char]0xB098)
  Assert-Equal 'chrome-korean-normal-clues-allowed' (Test-ChromiumClueIncognito 'chromium' $wRoot) $false
  $wAvatar.Current.Name = 'Incognito'
  Assert-Equal 'gecko-clues-ignore-the-profile-button' (Test-ChromiumClueIncognito 'gecko' $wRoot) $false
  $wRoot.PrivateMarker = $null
  Assert-Equal 'chrome-without-profile-button-clues-allowed' (Test-ChromiumClueIncognito 'chromium' $wRoot) $false

  # Root view label (measured Chrome, Edge, Brave, Opera, Whale in ko/en/de/ja).
  $rvRoot = New-TestElement 'rv' $windowType
  # This root answers the root view query with its panes and the document query with the rest.
  $rvRoot | Add-Member -Force ScriptMethod FindAll {
    param($scope, $condition)
    $panes = [string]$condition -eq 'synthetic root view condition'
    return @($this.Children | Where-Object { ($_.Current.ControlType.ProgrammaticName -eq 'ControlType.Pane') -eq $panes })
  }
  $d3d = New-TestElement 'rvd' $paneType $false $null $rvRoot @() '' $true $false '' 'Intermediate D3D Window'
  $d3d.Current | Add-Member NoteProperty Name 'Rust (book) - Brave (Private)'
  $view = New-TestElement 'rvv' $paneType $false $null $rvRoot @() '' $true $false '' 'BraveBrowserRootView'
  $view.Current | Add-Member NoteProperty Name 'What is Ownership? (Rust) - Brave'
  $rvRoot.Children = @($d3d, $view)
  Assert-Equal 'rootview-normal-title-with-parentheses-is-normal' (Test-RootViewPrivateLabel $rvRoot) $false
  Assert-Equal 'rootview-other-class-label-ignored' (Test-ChromiumClueIncognito 'chromium' $rvRoot) $false
  $view.Current.Name = 'What is Ownership? - Brave (Private)'
  Assert-Equal 'rootview-brave-private' (Test-ChromiumClueIncognito 'chromium' $rvRoot) $true
  $view.Current.ClassName = 'RootView'
  $view.Current.Name = 'What is Ownership? ' + [char]0x2013 + ' Opera (privat)'
  Assert-Equal 'rootview-opera-german-private' (Test-RootViewPrivateLabel $rvRoot) $true
  $view.Current.Name = 'What is Ownership? - Opera' + [char]0xFF08 + 'Private' + [char]0xFF09
  Assert-Equal 'rootview-fullwidth-parenthesis-private' (Test-RootViewPrivateLabel $rvRoot) $true
  $view.Current.ClassName = 'BrowserRootView'
  $view.Current.Name = 'What is Ownership? - Google Chrome (anonym) '
  Assert-Equal 'rootview-trailing-space-private' (Test-RootViewPrivateLabel $rvRoot) $true
  $view.Current.Name = 'What is Ownership? - Google Chrome'
  Assert-Equal 'rootview-plain-browser-suffix-is-normal' (Test-RootViewPrivateLabel $rvRoot) $false
  $rvPage = New-TestElement 'rvp' $documentType $false $null $rvRoot @() 'https://doc.rust-lang.org/book/'
  $rvRoot.Children = @($d3d, $view, $rvPage)
  $view.Current.Name = 'What is Ownership? - NAVER Whale (Incognito)'
  $rvWhale = Read-TopLevelDocument $rvRoot $walker $documentCondition $null 'whale'
  Assert-Equal 'rootview-whale-private-not-found' $rvWhale.found $false
  Assert-Equal 'rootview-whale-private-flagged' $rvWhale.privacy 'private'
  Assert-Equal 'rootview-chromium-private-keeps-url' (Read-TopLevelDocument $rvRoot $walker $documentCondition $null 'chromium').url 'https://doc.rust-lang.org/book/'
  Assert-Equal 'rootview-gecko-ignores-label' (Test-ChromiumClueIncognito 'gecko' $rvRoot) $false
  $view.Current.Name = 'What is Ownership? - NAVER Whale'
  Assert-Equal 'rootview-whale-normal-reads-page' (Read-TopLevelDocument $rvRoot $walker $documentCondition $null 'whale').url 'https://doc.rust-lang.org/book/'
} catch {
  Add-Case 'suite-execution' $false $_.Exception.Message
}

$failed = @($cases | Where-Object { -not $_.passed }).Count
$result = [pscustomobject]@{
  passed = @($cases | Where-Object { $_.passed }).Count
  failed = $failed
  cases = $cases.ToArray()
}
$result | ConvertTo-Json -Depth 5 -Compress
if ($failed -ne 0) { exit 1 }
