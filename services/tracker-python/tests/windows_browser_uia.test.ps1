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
  [bool]$providerFailure = $false
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
    }
    Parent = $parent
    Children = $children
    TestValue = $value
    PatternAvailable = $patternAvailable
    ProviderFailure = $providerFailure
  }
  $element | Add-Member ScriptMethod GetRuntimeId { return @($this.Id.ToCharArray() | ForEach-Object { [int]$_ }) }
  $element | Add-Member ScriptMethod FindAll {
    param($scope, $condition)
    return @($this.Children)
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
    'Read-ValidatedDocumentUrl',
    'Find-FocusedTopLevelDocument',
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
