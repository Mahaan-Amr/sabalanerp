$ErrorActionPreference='Stop'
$taskResult=Get-Content D:/sabalanerp/reports/qa/deploy-20261014-retry2-final-result.json -Raw | ConvertFrom-Json
if(-not $taskResult.ok -or $taskResult.runtime.deployment.phase -ne 'COMPLETED'){throw 'RELEASE_NOT_COMPLETED'}
$taskCheckpoint=$taskResult.runtime.checkpoint
if($taskCheckpoint.deploymentId -notmatch '^deploy-[a-zA-Z0-9_-]+$' -or $taskCheckpoint.releaseId -notmatch '^[a-zA-Z0-9_-]+$' -or $taskCheckpoint.checksum -notmatch '^[a-fA-F0-9]{64}$'){throw 'CHECKPOINT_IDENTITY_INVALID'}
$taskRoot=[IO.Path]::GetFullPath('D:/SabalanERP-Offsite-Recovery')
$taskDir=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskCheckpoint.releaseId))
$taskArchive=[IO.Path]::GetFullPath((Join-Path $taskDir ($taskCheckpoint.deploymentId+'.sabrec')))
if(-not $taskDir.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($taskArchive) -ne $taskDir){throw 'OFFSITE_TARGET_ESCAPED'}
$taskBefore=Get-Item -LiteralPath $taskArchive
$taskHash=(Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$taskAfter=Get-Item -LiteralPath $taskArchive
$taskSidecar=Get-Content -LiteralPath ($taskArchive+'.json') -Raw | ConvertFrom-Json
$taskVerified=$taskHash -eq $taskCheckpoint.checksum -and $taskBefore.Length -eq $taskCheckpoint.size -and $taskAfter.Length -eq $taskBefore.Length -and $taskAfter.LastWriteTimeUtc -eq $taskBefore.LastWriteTimeUtc -and $taskSidecar.checksum -eq $taskHash -and $taskSidecar.size -eq $taskCheckpoint.size -and $taskSidecar.remoteVerified -eq $true -and ($taskSidecar.id -eq $taskCheckpoint.deploymentId -or $taskSidecar.deploymentId -eq $taskCheckpoint.deploymentId)
$taskProof=@{deploymentId=$taskCheckpoint.deploymentId;checksum=$taskHash;size=$taskAfter.Length;verified=$taskVerified;windowsDirectFullRead=$true;checkedAt=[DateTime]::UtcNow.ToString('o')}
$taskProof | ConvertTo-Json | Set-Content D:/sabalanerp/reports/qa/deploy-20261014-retry2-final-offsite-proof.json -Encoding utf8
if(-not $taskVerified){throw 'FULL_OFFSITE_VERIFICATION_FAILED'}
Write-Output 'INDEPENDENT_WINDOWS_FULL_ARCHIVE_AND_SIDECAR_VERIFIED'
