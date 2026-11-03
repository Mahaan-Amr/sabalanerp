# Read-only bounded evidence collection; this is not an authority decision.
$ErrorActionPreference = 'Stop'
$taskOperation = 'a0d2baba08ec7e004d1458675799db6a'
$taskWorktree = 'native-c3-execution-419'
$historicPids = @(33376,46404,35996,34300,49140)
$selfPid = $PID
$items = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $selfPid -and ($_.ProcessId -in $historicPids -or
    ($null -ne $_.CommandLine -and ($_.CommandLine.Contains($taskOperation) -or $_.CommandLine.Contains($taskWorktree))))
} | ForEach-Object {
  [pscustomobject]@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;Name=[string]$_.Name;
    CreationDate=$_.CreationDate.ToUniversalTime().ToString('o');SessionId=[int]$_.SessionId}
})
if ($items.Count -gt 128) { throw 'PROCESS_CENSUS_BOUND_EXCEEDED' }
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
[pscustomobject]@{format='phase1-process-snapshot/v1'; atUtc=[DateTime]::UtcNow.ToString('o'); bootUtc=$boot;
  historicPids=$historicPids; matches=$items; commandLines='REDACTED'; completeActorCensus=$false;
  jobIdentity='UNKNOWN'; leaseOwner='UNKNOWN'; scopeIdentities='UNKNOWN'} | ConvertTo-Json -Compress -Depth 4
