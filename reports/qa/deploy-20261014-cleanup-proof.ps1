$ErrorActionPreference='Stop'
$inventory=Get-Content -Raw D:/sabalanerp/reports/qa/deploy-20261014-cleanup-inventory.json | ConvertFrom-Json
$recoveryRoot=[IO.Path]::GetFullPath('D:/SabalanERP-Offsite-Recovery')
$results=@()
foreach($artifact in $inventory){
 $target=[IO.Path]::GetFullPath((Join-Path (Join-Path $recoveryRoot $artifact.remoteDirectory) $artifact.archiveName))
 if(-not $target.StartsWith($recoveryRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Recovery verification target escaped recovery directory'}
 $verified=$false;$actual=$null
 if($artifact.remoteVerified -and (Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath ($target+'.json'))){
  $before=Get-Item -LiteralPath $target
  $actual=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
  $sidecar=Get-Content -Raw -LiteralPath ($target+'.json') | ConvertFrom-Json
  $after=Get-Item -LiteralPath $target
  $verified=$actual -eq $artifact.checksum -and $sidecar.checksum -eq $artifact.checksum -and $sidecar.remoteVerified -eq $true -and ($sidecar.id -eq $artifact.id -or $sidecar.deploymentId -eq $artifact.id) -and $before.Length -eq $artifact.size -and $after.Length -eq $before.Length -and $after.LastWriteTimeUtc -eq $before.LastWriteTimeUtc
 }
 $results += [pscustomobject]@{id=$artifact.id;archiveName=$artifact.archiveName;remoteDirectory=$artifact.remoteDirectory;size=$artifact.size;checksum=$actual;verified=$verified;windowsDirectFullRead=$true;checkedAt=[DateTime]::UtcNow.ToString('o')}
 Write-Output ('OFFSITE_CHECKED='+$results.Count+' VERIFIED='+$verified)
}
$results | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 D:/sabalanerp/reports/qa/deploy-20261014-cleanup-proof.json
Write-Output ('OFFSITE_VERIFIED_TOTAL='+@($results | Where-Object verified).Count)
