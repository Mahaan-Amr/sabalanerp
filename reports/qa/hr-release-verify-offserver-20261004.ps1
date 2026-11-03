$ErrorActionPreference = 'Stop'
$artifacts = @(Get-Content 'D:/sabalanerp/reports/qa/hr-release-capacity-artifacts-20261004.json' -Raw | ConvertFrom-Json)
$proofs = @()
foreach ($artifact in $artifacts) {
  if ($artifact.id -eq 'deploy-20260929T092026Z-196f4de63b68-configuration') { continue }
  $archiveName = $artifact.id + '.sabrec'
  if ($artifact.id -match '^deploy-202610') {
    $releaseDirectory = $artifact.id.Substring(7)
    $archivePath = Join-Path (Join-Path 'D:/SabalanERP-Offsite-Recovery' $releaseDirectory) $archiveName
  } else {
    $matches = @('D:/SabalanERP-Offsite-Recovery-Archive', 'E:/SabalanERP-Offsite-Recovery-Archive') | ForEach-Object {
      $candidate = Join-Path $_ $archiveName
      if (Test-Path -LiteralPath $candidate) { $candidate }
    }
    if (@($matches).Count -eq 0) { continue }
    if (@($matches).Count -ne 1) { throw "Expected one completed off-server copy: $($artifact.id)" }
    $archivePath = @($matches)[0]
  }
  $archivePath = (Resolve-Path -LiteralPath $archivePath).Path
  $metadataPath = $archivePath + '.json'
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $size = (Get-Item -LiteralPath $archivePath).Length
  if ($hash -ne $artifact.checksum -or $size -ne $artifact.size -or $metadata.checksum -ne $hash -or ($metadata.id -ne $artifact.id -and $metadata.deploymentId -ne $artifact.id) -or $metadata.remoteVerified -ne $true) { throw "Off-server verification failed: $($artifact.id)" }
  $proofs += [pscustomobject]@{id=$artifact.id; checksum=$hash; size=$size; verified=$true;
    archiveLocation=$archivePath; metadataLocation=$metadataPath; verifiedAt=[DateTime]::UtcNow.ToString('o')}
  Write-Output "Freshly verified $($artifact.id)"
}
$proofs | ConvertTo-Json -Depth 5 | Set-Content 'D:/sabalanerp/reports/qa/hr-release-fresh-offserver-proof-20261004.json' -Encoding UTF8
