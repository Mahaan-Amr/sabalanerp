# Fixed pre-execution observer. Expected digest comes from the separate review.
param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewDigest,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{32}$')][string]$PackageId,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$CompleteDigest,[ValidatePattern('^[a-f0-9]{32}$')][string]$FixtureRun)
$ErrorActionPreference='Stop'
$root='C:\Users\mahan\.codex\worktrees\phase1-existing-lease\sabalanerp'
$packageBase=if($FixtureRun){Join-Path ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) ('sabalan-phase1-package-root-'+$FixtureRun)}else{'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102'}
$package=Join-Path $packageBase ('phase1-package-'+$PackageId)
$completePath=Join-Path $package 'COMPLETE.json'
if((Get-FileHash -LiteralPath $completePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $CompleteDigest){throw 'PACKAGE_COMPLETE_MISMATCH'}
$complete=Get-Content -LiteralPath $completePath -Raw|ConvertFrom-Json
$names=@('phase1-reviewed-evidence.json','phase1-reviewed-source-index.json','phase1-reviewed-manifest.json','phase1-reviewed-external-anchor.json')
if($complete.format -ne 'phase1-package-complete/v1' -or @($complete.files.PSObject.Properties).Count -ne 4){throw 'PACKAGE_COMPLETE_SCHEMA'}
foreach($name in $names){if((Get-FileHash -LiteralPath (Join-Path $package $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $complete.files.$name){throw 'PACKAGE_FILE_MISMATCH'}}
$review=Join-Path $package 'phase1-reviewed-external-anchor.json'
if((Get-FileHash -LiteralPath $review -Algorithm SHA256).Hash.ToLowerInvariant() -ne $reviewDigest){throw 'BOOTSTRAP_REVIEW_MISMATCH'}
$record=Get-Content -LiteralPath $review -Raw|ConvertFrom-Json
if($FixtureRun){if($record.testOnly -ne $true -or $record.operation -ne 'TEST_ONLY' -or $record.action -ne 'FIXTURE_AUDIT'){throw 'BOOTSTRAP_TEST_SCOPE'}}
elseif($record.operation -ne 'a0d2baba08ec7e004d1458675799db6a' -or $record.action -ne 'READ_ONLY_AUDIT_NEW_OWN_LEASE'){throw 'BOOTSTRAP_LIVE_SCOPE'}
$fixed=@{
 nativeLauncher=(Join-Path $root 'scripts\lib\reconciliation-phase1-native-launcher.py');
 nativeGuard=(Join-Path $root 'scripts\lib\reconciliation-phase1-native-guard.py');
 node='C:\Program Files\nodejs\node.exe';
 python='C:\Users\mahan\AppData\Local\Programs\Python\Python314\python.exe';
}
foreach($key in $fixed.Keys){if((Get-FileHash -LiteralPath $fixed[$key] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.bootstrapPins.$key){throw 'BOOTSTRAP_SOURCE_MISMATCH'}}
# A pathname/hash snapshot is not atomic pre-exec proof. The reviewed native
# parent must subsequently hold staged handles and reverify copied bytes.
[pscustomobject]@{format='phase1-bootstrap-observation/v1';source='EXTERNAL_OBSERVER';pathRace='UNPROVEN';acquisition=$false}|ConvertTo-Json -Compress
if($record.nodePath -ne $fixed.node -or (& $fixed.node --version).Trim() -ne $record.nodeVersion){throw 'NODE_RUNTIME_IDENTITY_MISMATCH'}
if($FixtureRun){& $fixed.python $fixed.nativeLauncher --review-digest $reviewDigest --package-id $PackageId --complete-digest $CompleteDigest --fixture-run $FixtureRun}
else{& $fixed.python $fixed.nativeLauncher --review-digest $reviewDigest --package-id $PackageId --complete-digest $CompleteDigest}
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
