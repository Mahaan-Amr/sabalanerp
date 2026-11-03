$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath('D:/SabalanERP-Offsite-Recovery')
$taskRows=@(Get-Content D:/sabalanerp/reports/qa/deploy-20261014-repair-inventory.json -Raw | ConvertFrom-Json | Where-Object {$_.id -like 'deploy-202609*'})
if($taskRows.Count -ne 3){throw 'SOURCE_COUNT_CHANGED'}
$taskGroups=@();$taskTransfers=@()
foreach($taskRow in $taskRows){
 if($taskRow.archiveHostPath -notmatch '^/var/lib/docker/volumes/[a-zA-Z0-9_-]+/_data/packages/deploy-[a-zA-Z0-9_-]+\.sabrec$' -or $taskRow.archiveName -notmatch '^deploy-[a-zA-Z0-9_-]+\.sabrec$' -or -not $taskRow.localVerified -or -not $taskRow.manifestReadable -or -not $taskRow.remoteVerified -or -not $taskRow.canonicalRemotePath){throw 'SOURCE_NOT_VERIFIED'}
 $taskDir=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskRow.remoteDirectory));$taskTarget=[IO.Path]::GetFullPath((Join-Path $taskDir $taskRow.archiveName))
 if(-not $taskDir.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($taskTarget) -ne $taskDir -or (Test-Path -LiteralPath $taskTarget)){throw 'TARGET_NOT_EXCLUSIVE'}
 $taskPrefix=$taskTarget+'.repair-stream-20261014.pending';$taskPrefixInfo=Get-Item -LiteralPath $taskPrefix
 # Deny concurrent writers while recording and copying the preserved prefix.
 $taskPrefixGuard=[IO.File]::Open($taskPrefix,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 $taskPrefixLength=$taskPrefixGuard.Length
 if($taskPrefixLength -le 0 -or $taskPrefixLength -ge $taskRow.size){$taskPrefixGuard.Dispose();throw 'PREFIX_LENGTH_INVALID'}
 $taskRemaining=[long]$taskRow.size-$taskPrefixLength;$taskPartSize=[long][math]::Ceiling($taskRemaining/4.0);$taskParts=@()
 for($taskIndex=0;$taskIndex -lt 4;$taskIndex++){
  $taskOffset=$taskPrefixLength+$taskIndex*$taskPartSize;$taskLength=[long][math]::Min($taskPartSize,[long]$taskRow.size-$taskOffset)
  if($taskLength -le 0){continue}
  $taskPart=$taskTarget+'.chunk-20261014-'+$taskOffset+'-'+$taskLength+'.pending'
  $taskParts+=@{offset=$taskOffset;length=$taskLength;path=$taskPart;source=$taskRow.archiveHostPath}
 }
 $taskGroups+=@{row=$taskRow;target=$taskTarget;prefix=$taskPrefix;prefixGuard=$taskPrefixGuard;prefixLength=$taskPrefixLength;parts=$taskParts}
}
try {
 foreach($taskGroup in $taskGroups){foreach($taskPart in $taskGroup.parts){
  $taskStream=[IO.File]::Open($taskPart.path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $taskStart=[Diagnostics.ProcessStartInfo]::new();$taskStart.FileName='C:/Windows/System32/OpenSSH/ssh.exe';$taskStart.UseShellExecute=$false;$taskStart.CreateNoWindow=$true;$taskStart.RedirectStandardOutput=$true;$taskStart.RedirectStandardError=$true
  $taskCommand='dd if='+$taskPart.source+' bs=1M skip='+$taskPart.offset+' count='+$taskPart.length+' iflag=skip_bytes,count_bytes status=none'
  foreach($taskArg in @('-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','IPQoS=none','root@94.182.85.254',$taskCommand)){$taskStart.ArgumentList.Add($taskArg)}
  $taskProcess=[Diagnostics.Process]::new();$taskProcess.StartInfo=$taskStart;[void]$taskProcess.Start()
  $taskErrorRead=$taskProcess.StandardError.ReadToEndAsync();$taskCopy=$taskProcess.StandardOutput.BaseStream.CopyToAsync($taskStream)
  $taskTransfers+=@{process=$taskProcess;stream=$taskStream;copy=$taskCopy;errorRead=$taskErrorRead;part=$taskPart}
  Start-Sleep -Milliseconds 2000
 }}
 Write-Output ('ENCRYPTED_RANGE_TRANSFERS_STARTED='+$taskTransfers.Count)
 foreach($taskTransfer in $taskTransfers){
  $taskTransfer.copy.GetAwaiter().GetResult();$taskTransfer.stream.Dispose();$taskTransfer.process.WaitForExit()
  if($taskTransfer.process.ExitCode -ne 0 -or (Get-Item -LiteralPath $taskTransfer.part.path).Length -ne $taskTransfer.part.length){throw 'ENCRYPTED_RANGE_COPY_FAILED'}
  Write-Output ('ENCRYPTED_RANGE_VERIFIED_LENGTH='+$taskTransfer.part.length)
 }
 foreach($taskGroup in $taskGroups){
  if($taskGroup.prefixGuard.Length -ne $taskGroup.prefixLength){throw 'PREFIX_CHANGED'}
  $taskJoined=$taskGroup.target+'.chunk-rebuilt-20261014.pending';$taskOut=[IO.File]::Open($taskJoined,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$taskGroup.prefixGuard.Position=0;$taskGroup.prefixGuard.CopyTo($taskOut);foreach($taskPart in $taskGroup.parts){$taskIn=[IO.File]::OpenRead($taskPart.path);try {$taskIn.CopyTo($taskOut)} finally {$taskIn.Dispose()}}} finally {$taskOut.Dispose()}
  if((Get-Item -LiteralPath $taskJoined).Length -ne $taskGroup.row.size -or (Get-FileHash -LiteralPath $taskJoined -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskGroup.row.checksum){throw 'FULL_ENCRYPTED_CHECKSUM_MISMATCH'}
  if(Test-Path -LiteralPath $taskGroup.target){throw 'TARGET_APPEARED_PRESERVED'}
  Move-Item -LiteralPath $taskJoined -Destination $taskGroup.target
  Write-Output ('FULL_OFFSITE_ARCHIVE_VERIFIED='+$taskGroup.row.id)
 }
} finally {
 foreach($taskTransfer in $taskTransfers){if(-not $taskTransfer.process.HasExited){$taskTransfer.process.Kill()};$taskTransfer.stream.Dispose();$taskTransfer.process.Dispose()}
 foreach($taskGroup in $taskGroups){$taskGroup.prefixGuard.Dispose()}
}
# Existing reviewed publisher validates full SHA256 again and publishes sidecars.
& D:/sabalanerp/reports/qa/deploy-20261014-repair-old-offsite-stream.ps1
