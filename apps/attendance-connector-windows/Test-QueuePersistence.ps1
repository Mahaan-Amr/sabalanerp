# Tests the actual reader queue function without loading the SDK or contacting any server.
param([string]$ReaderPath = (Join-Path $PSScriptRoot 'Read-Attendance.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ReaderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Reader parsing failed.' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Save-Queue' }, $true)
if (-not $function) { throw 'Save-Queue was not found.' }
. ([scriptblock]::Create($function.Extent.Text))
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('SabalanQueueTest-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testDirectory) | Out-Null
try {
  $stateFile = Join-Path $testDirectory 'state.json'
  $seen = @{ 'synthetic-event-1' = $true }
  $pending = New-Object 'System.Collections.Generic.List[object]'
  $pending.Add(@{ deviceCode = 'test-only'; occurredAt = '2026-01-01T00:00:00Z'; verifyMode = 0; inOutRaw = 255 })
  Save-Queue
  $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if (@($saved.pending).Count -ne 1 -or @($saved.seen).Count -ne 1) { throw 'Initial queue creation failed.' }
  $seen['synthetic-event-2'] = $true
  $pending.Add(@{ deviceCode = 'test-only'; occurredAt = '2026-01-01T00:00:10Z'; verifyMode = 0; inOutRaw = 255 })
  Save-Queue
  $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if (@($saved.pending).Count -ne 2 -or @($saved.seen).Count -ne 2) { throw 'Queue replacement lost pending events.' }
  $pending.RemoveRange(0, 2)
  Save-Queue
  $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if (@($saved.pending).Count -ne 0 -or @($saved.seen).Count -ne 2) { throw 'Acknowledged queue persistence failed.' }
  if ([IO.File]::Exists($stateFile + '.new')) { throw 'Temporary queue file remained after save.' }
  Write-Output 'QUEUE_PERSISTENCE_OK'
} finally {
  # Only remove this test's unique synthetic directory, never the configured reader queue.
  [IO.Directory]::Delete($testDirectory, $true)
}
