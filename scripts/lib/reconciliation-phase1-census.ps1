# Read-only bounded evidence collection; this is not an authority decision.
param([string]$FixtureRoot='')
$ErrorActionPreference = 'Stop'
$taskOperation = 'a0d2baba08ec7e004d1458675799db6a'
$taskWorktree = 'native-c3-execution-419'
$historicPids = @(33376,46404,35996,34300,49140)
$selfPid = $PID
$all = @(Get-CimInstance Win32_Process)
if($FixtureRoot){
 $full=[IO.Path]::GetFullPath($FixtureRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
 if([IO.Path]::GetDirectoryName($full) -ne $temp -or [IO.Path]::GetFileName($full) -notmatch '^sabalan-phase1-fixture-[0-9a-f]{32}$'){throw 'TEST_ROOT_REQUIRED'}
 $excluded=New-Object 'System.Collections.Generic.HashSet[int]';$cursor=[int]$selfPid
 while($cursor -gt 0 -and $excluded.Add($cursor)){$entry=$all|Where-Object {$_.ProcessId -eq $cursor}|Select-Object -First 1;if($null -eq $entry){break};$cursor=[int]$entry.ParentProcessId}
 # One particular launcher may be excluded only when this same fixture's
 # supervisor receipt binds PID, birth, parent, Job sample and source hashes.
 # The Job membership here is explicitly parent-reported, not independent.
 $ownPid=0;$proofStatus='UNKNOWN'
 $checkNames=@('proof','parent','ancestor','launcherBirthUs','parentBirthUs','job','nodePin','launcherPin','nodeHash','launcherHash')
 $checks=[ordered]@{};foreach($name in $checkNames){$checks[$name]=@{status='UNKNOWN';expected='UNAVAILABLE';actual='UNAVAILABLE'}}
 function Test-ProofField([string]$name,[string]$expected,[string]$actual){
  $equal=$expected -ceq $actual;$checks[$name]=@{status=$(if($equal){'MATCH'}else{'MISMATCH'});expected=$expected;actual=$actual}
  if(!$equal){throw 'PROOF_FIELD_MISMATCH'}
 }
 function Microseconds([string]$ticks){if($ticks -notmatch '^\d{2,20}$'){throw 'BIRTH_FORMAT'};return $ticks.Substring(0,$ticks.Length-1)}
 try {
  $proofPath=Join-Path $full 'fixture-owner-proof.json';$proofItem=Get-Item -LiteralPath $proofPath -Force
  if($proofItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PROOF_REPARSE'}
  if($proofItem.Length -gt 16384){throw 'PROOF_BOUND'}
  $proof=Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
  $candidate=$all|Where-Object {$_.ProcessId -eq [int]$proof.launcherPid}|Select-Object -First 1
  $owner=$all|Where-Object {$_.ProcessId -eq [int]$proof.parentPid}|Select-Object -First 1
  $runId=[IO.Path]::GetFileName($full).Substring('sabalan-phase1-fixture-'.Length)
  $launcher=Join-Path $PSScriptRoot 'reconciliation-phase1-launcher.mjs'
  $expectedNode='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9'
  $sourceIndex=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reconciliation-phase1-source-index.json') -Raw|ConvertFrom-Json
  $expectedLauncher=[string](@($sourceIndex.sources|Where-Object {$_.path -eq 'reconciliation-phase1-launcher.mjs'})[0].sha256)
  if($expectedLauncher -notmatch '^[a-f0-9]{64}$'){throw 'FIXTURE_LAUNCHER_PIN'}
  $proofValid=($proof.format -eq 'phase1-fixture-owner-proof/v1' -and $proof.fixtureOnly -and $proof.runId -eq $runId -and $proof.jobAssignedBeforeResume -and $proof.jobEvidence -eq 'SUPERVISOR_HANDLE_QUERY' -and $proof.authority -eq 'PARENT_REPORTED_FIXED_TEST_ROLE' -and $null -ne $candidate -and $null -ne $owner)
  Test-ProofField 'proof' 'True' ([string]$proofValid)
  Test-ProofField 'parent' ([string]$proof.parentPid) ([string]$candidate.ParentProcessId)
  Test-ProofField 'ancestor' 'True' ([string]$excluded.Contains([int]$proof.launcherPid))
  Test-ProofField 'launcherBirthUs' (Microseconds ([string]$proof.launcherBirth100ns)) (Microseconds ([string]$candidate.CreationDate.ToUniversalTime().ToFileTimeUtc()))
  Test-ProofField 'parentBirthUs' (Microseconds ([string]$proof.parentBirth100ns)) (Microseconds ([string]$owner.CreationDate.ToUniversalTime().ToFileTimeUtc()))
  Test-ProofField 'job' 'True' ([string]([int]$proof.launcherPid -in @($proof.jobMembers)))
  Test-ProofField 'nodePin' $expectedNode ([string]$proof.nodeSha256)
  Test-ProofField 'launcherPin' $expectedLauncher ([string]$proof.launcherSha256)
  Test-ProofField 'nodeHash' $expectedNode ((Get-FileHash -LiteralPath $candidate.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant())
  Test-ProofField 'launcherHash' $expectedLauncher ((Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant())
  $ownPid=[int]$proof.launcherPid;$proofStatus='PARENT_REPORTED_BINDING'
 } catch {$ownPid=0;$proofStatus='UNKNOWN'}
 $ownLeasePid=0;$leaseProofStatus='UNKNOWN'
 if($ownPid -ne 0){
  try {
   $selfPath=Join-Path $full 'fixture-lease-self.json';$jobPath=Join-Path $full 'fixture-lease-job-proof.json'
   foreach($f in @($selfPath,$jobPath)){$it=Get-Item -LiteralPath $f -Force;if(($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $it.Length -gt 16384){throw 'LEASE_PROOF_PATH'}}
   $selfProof=Get-Content -LiteralPath $selfPath -Raw|ConvertFrom-Json;$jobProof=Get-Content -LiteralPath $jobPath -Raw|ConvertFrom-Json
   $leaseProc=$all|Where-Object {$_.ProcessId -eq [int]$selfProof.pid}|Select-Object -First 1
   $expectedHelper=[string](@($sourceIndex.sources|Where-Object {$_.path -eq 'serial-physical/host-lease.ps1'})[0].sha256);$expectedPs='60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f'
   if($expectedHelper -notmatch '^[a-f0-9]{64}$'){throw 'FIXTURE_HELPER_PIN'}
   if($selfProof.format -ne 'phase1-fixture-lease-self/v1' -or $jobProof.format -ne 'phase1-fixture-lease-job-proof/v1' -or !$selfProof.fixtureOnly -or !$jobProof.fixtureOnly -or $selfProof.runId -ne $runId -or $jobProof.runId -ne $runId -or $jobProof.jobEvidence -ne 'SUPERVISOR_HANDLE_QUERY' -or $jobProof.source -ne 'PARENT_REPORTED' -or $null -eq $leaseProc){throw 'LEASE_PROOF_INVALID'}
   if([int]$selfProof.pid -ne [int]$jobProof.pid -or [int]$leaseProc.ParentProcessId -ne $ownPid -or [int]$selfProof.parentPid -ne $ownPid -or [int]$jobProof.parentPid -ne $ownPid -or [int]$selfProof.pid -notin @($jobProof.jobMembers)){throw 'LEASE_PARENT_OR_JOB'}
   if([string]$selfProof.birth100ns -ne [string]$jobProof.birth100ns -or (Microseconds ([string]$selfProof.birth100ns)) -ne (Microseconds ([string]$leaseProc.CreationDate.ToUniversalTime().ToFileTimeUtc()))){throw 'LEASE_BIRTH'}
   if($selfProof.helperSha256 -ne $expectedHelper -or $jobProof.helperSha256 -ne $expectedHelper -or (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'serial-physical\host-lease.ps1') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHelper){throw 'LEASE_HELPER_SOURCE'}
   if($selfProof.executableSha256 -ne $expectedPs -or $jobProof.executableSha256 -ne $expectedPs -or (Get-FileHash -LiteralPath $leaseProc.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedPs){throw 'LEASE_EXECUTABLE'}
   $ownLeasePid=[int]$selfProof.pid;$leaseProofStatus='PARENT_REPORTED_BINDING'
  } catch {$ownLeasePid=0;$leaseProofStatus='UNKNOWN'}
 }
 $fixtureMatches=@($all|Where-Object {$_.ProcessId -ne $selfPid -and $_.ProcessId -ne $ownPid -and $_.ProcessId -ne $ownLeasePid -and $_.CommandLine -and $_.CommandLine.Contains($full)}|ForEach-Object {
  [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=[string]$_.Name;sessionId=[int]$_.SessionId;
   birthUtc=$_.CreationDate.ToUniversalTime().ToString('o');role=$(if($excluded.Contains([int]$_.ProcessId)){'ANCESTOR_CANDIDATE_UNPROVEN'}elseif($_.CommandLine.Contains('host-lease.ps1')){'HOST_LEASE_PATH_MATCH'}else{'FIXTURE_ROOT_PATH_MATCH'});
   job='UNKNOWN';sourceIdentity='UNPROVEN';authority='UNPROVEN'}
 })
 if($fixtureMatches.Count -gt 128){throw 'PROCESS_CENSUS_BOUND_EXCEEDED'}
 $unknown=@($fixtureMatches|Where-Object {$_.role -in @('ANCESTOR_CANDIDATE_UNPROVEN','HOST_LEASE_PATH_MATCH')}).Count
 $conflicts=@($fixtureMatches|Where-Object {$_.role -eq 'FIXTURE_ROOT_PATH_MATCH'}).Count
 $unreadableRelevant=@($all | Where-Object { $_.ProcessId -ne $selfPid -and $_.Name -match '^(node|python|pythonw|powershell|pwsh|wsl|docker)\.exe$' -and [string]::IsNullOrEmpty($_.CommandLine) }).Count
 [pscustomobject]@{format='phase1-fixture-census/v1';status=$(if($conflicts){'OBSERVED_CONFLICT'}elseif($unknown -or $proofStatus -eq 'UNKNOWN'){'UNKNOWN'}else{'BOUNDED_NO_MATCH'});matches=$fixtureMatches;unreadableRelevant=$unreadableRelevant;fixtureOnly=$true;globalCoverage='UNPROVEN';ownerProof=$proofStatus;ownLeaseProof=$leaseProofStatus;ownerChecks=$checks;birthPrecision='CIM_MICROSECONDS_TRUNCATED';rawFiletime='RETAINED_IN_SUPERVISOR_PROOF'}|ConvertTo-Json -Compress -Depth 6
 exit 0
}
$unreadableRelevant=@($all | Where-Object { $_.ProcessId -ne $selfPid -and $_.Name -match '^(node|python|pythonw|powershell|pwsh|wsl|docker)\.exe$' -and [string]::IsNullOrEmpty($_.CommandLine) }).Count
$items = @($all | Where-Object {
  $_.ProcessId -ne $selfPid -and ($_.ProcessId -in $historicPids -or
    ($null -ne $_.CommandLine -and ($_.CommandLine.Contains($taskOperation) -or $_.CommandLine.Contains($taskWorktree))))
} | ForEach-Object {
  [pscustomobject]@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;Name=[string]$_.Name;
    CreationDate=$_.CreationDate.ToUniversalTime().ToString('o');SessionId=[int]$_.SessionId}
})
if ($items.Count -gt 128) { throw 'PROCESS_CENSUS_BOUND_EXCEEDED' }
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
[pscustomobject]@{format='phase1-process-snapshot/v1'; atUtc=[DateTime]::UtcNow.ToString('o'); bootUtc=$boot;
  historicPids=$historicPids; matches=$items; unreadableRelevant=$unreadableRelevant;commandLines='REDACTED'; completeActorCensus=$false;
  jobIdentity='UNKNOWN'; leaseOwner='UNKNOWN'; scopeIdentities='UNKNOWN'} | ConvertTo-Json -Compress -Depth 4
