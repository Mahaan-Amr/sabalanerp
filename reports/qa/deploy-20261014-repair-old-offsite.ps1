$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath('D:/SabalanERP-Offsite-Recovery')
$taskRows=Get-Content 'D:/sabalanerp/reports/qa/deploy-20261014-repair-inventory.json' -Raw | ConvertFrom-Json
$taskResults=@()
foreach($taskRow in @($taskRows | Where-Object { $_.id -like 'deploy-202609*' })) {
 if(-not $taskRow.localVerified -or -not $taskRow.manifestReadable -or -not $taskRow.remoteVerified -or -not $taskRow.canonicalRemotePath) { throw 'SOURCE_NOT_VERIFIED' }
 $taskDir=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskRow.remoteDirectory))
 $taskTarget=[IO.Path]::GetFullPath((Join-Path $taskDir $taskRow.archiveName))
 if(-not $taskDir.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($taskTarget) -ne $taskDir) { throw 'OFFSITE_PATH_UNSAFE' }
 New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
 $taskPending=$taskTarget+'.repair-20261014.pending'
 if(-not (Test-Path -LiteralPath $taskTarget)) {
  if(Test-Path -LiteralPath $taskPending) { throw 'EXISTING_PENDING_COPY_PRESERVED' }
  & C:/Windows/System32/OpenSSH/scp.exe -q -i C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519 ('root@94.182.85.254:'+ $taskRow.archiveHostPath) $taskPending
  if($LASTEXITCODE) { throw 'ENCRYPTED_COPY_FAILED' }
  if((Get-Item -LiteralPath $taskPending).Length -ne $taskRow.size -or (Get-FileHash -LiteralPath $taskPending -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskRow.checksum) { throw 'ENCRYPTED_COPY_CHECKSUM_MISMATCH' }
  if(Test-Path -LiteralPath $taskTarget) { throw 'TARGET_APPEARED_PRESERVED' }
  Move-Item -LiteralPath $taskPending -Destination $taskTarget
 }
 $taskChecksum=(Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant()
 if((Get-Item -LiteralPath $taskTarget).Length -ne $taskRow.size -or $taskChecksum -ne $taskRow.checksum) { throw 'OFFSITE_CHECKSUM_MISMATCH' }
 $taskSidecar=$taskTarget+'.json'
 if(-not (Test-Path -LiteralPath $taskSidecar)) {
  $taskIncoming=$taskSidecar+'.repair-20261014.pending'
  if(Test-Path -LiteralPath $taskIncoming) { throw 'EXISTING_PENDING_METADATA_PRESERVED' }
  & C:/Windows/System32/OpenSSH/scp.exe -q -i C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519 ('root@94.182.85.254:'+ $taskRow.metadataHostPath) $taskIncoming
  if($LASTEXITCODE) { throw 'METADATA_COPY_FAILED' }
  $taskMetadata=Get-Content -LiteralPath $taskIncoming -Raw | ConvertFrom-Json
  if(($taskMetadata.id -ne $taskRow.id -and $taskMetadata.deploymentId -ne $taskRow.id) -or $taskMetadata.checksum -ne $taskChecksum -or $taskMetadata.size -ne $taskRow.size -or $taskMetadata.remoteVerified -ne $true -or $taskMetadata.localVerified -ne $true -or $taskMetadata.manifestReadable -ne $true) { throw 'SOURCE_METADATA_MISMATCH' }
  foreach($taskProperty in @('archivePath','localPath','metadataPath')) { $taskMetadata.PSObject.Properties.Remove($taskProperty) }
  [IO.File]::WriteAllText($taskIncoming,($taskMetadata | ConvertTo-Json -Depth 100),(New-Object System.Text.UTF8Encoding($false)))
  if(Test-Path -LiteralPath $taskSidecar) { throw 'SIDECAR_APPEARED_PRESERVED' }
  Move-Item -LiteralPath $taskIncoming -Destination $taskSidecar
 }
 $taskVerifiedMetadata=Get-Content -LiteralPath $taskSidecar -Raw | ConvertFrom-Json
 if($taskVerifiedMetadata.checksum -ne $taskChecksum -or $taskVerifiedMetadata.size -ne $taskRow.size -or $taskVerifiedMetadata.remoteVerified -ne $true -or ($taskVerifiedMetadata.id -ne $taskRow.id -and $taskVerifiedMetadata.deploymentId -ne $taskRow.id)) { throw 'OFFSITE_SIDECAR_MISMATCH' }
 $taskResults += @{id=$taskRow.id;checksum=$taskChecksum;size=$taskRow.size;verified=$true;windowsDirectFullRead=$true;archiveName=$taskRow.archiveName;remoteDirectory=$taskRow.remoteDirectory;checkedAt=[DateTime]::UtcNow.ToString('o')}
 $taskResults | ConvertTo-Json -Depth 8 | Set-Content 'D:/sabalanerp/reports/qa/deploy-20261014-offsite-repair-result.json' -Encoding UTF8
 Write-Output ('OFFSITE_REPAIRED='+$taskRow.id+' VERIFIED=True')
}
