[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BioMiniSdkDirectory,
    [Parameter(Mandatory = $true)][string]$NodeExecutable,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40,64}$')][string]$CodeSigningCertificateThumbprint
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'OutputDirectory must not already exist.' }
$node = (Resolve-Path -LiteralPath $NodeExecutable).Path
if ([IO.Path]::GetExtension($node) -ne '.exe') { throw 'NodeExecutable must be a Windows executable.' }

& (Join-Path $root 'build-production.ps1') -BioMiniSdkDirectory $BioMiniSdkDirectory | Out-Null
& npm --prefix (Join-Path $root 'host') run build
if ($LASTEXITCODE -ne 0) { throw 'Connector host build failed.' }

New-Item -ItemType Directory -Path (Join-Path $output 'adapter'), (Join-Path $output 'host') -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'artifacts') -File |
    Where-Object { $_.Name -ne 'Sabalan.BioMini.Evaluation.exe' -and $_.Name -ne 'Sabalan.BioMini.Evaluation.exe.config' } |
    Copy-Item -Destination (Join-Path $output 'adapter') -Force
Copy-Item -Path (Join-Path $root 'host\dist\*') -Destination (Join-Path $output 'host') -Recurse -Force
Copy-Item -LiteralPath $node -Destination (Join-Path $output 'node.exe')
Copy-Item -LiteralPath (Join-Path $root 'install-connector.ps1') -Destination $output

$certificate = Get-Item -LiteralPath ("Cert:\CurrentUser\My\" + $CodeSigningCertificateThumbprint)
if (-not $certificate.HasPrivateKey) { throw 'The code-signing certificate has no accessible private key.' }
$codeSigningOid = '1.3.6.1.5.5.7.3.3'
if (-not ($certificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq $codeSigningOid })) { throw 'The selected certificate is not authorized for code signing.' }
Get-ChildItem -LiteralPath $output -Recurse -Include '*.exe','*.ps1' | ForEach-Object {
    $signature = Set-AuthenticodeSignature -LiteralPath $_.FullName -Certificate $certificate -HashAlgorithm SHA256
    if ($signature.Status -ne 'Valid') { throw "Signing failed for $($_.FullName): $($signature.StatusMessage)" }
}

$manifestEntries = Get-ChildItem -LiteralPath $output -Recurse -File | Where-Object { $_.Name -ne 'manifest.psd1' } | Sort-Object FullName | ForEach-Object {
    "        @{ Path = '$($_.FullName.Substring($output.Length + 1).Replace("'", "''"))'; Sha256 = '$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)' }"
}
$manifestText = "@{`r`n    Files = @(`r`n" + ($manifestEntries -join "`r`n") + "`r`n    )`r`n}`r`n"
$manifestPath = Join-Path $output 'manifest.psd1'
Set-Content -LiteralPath $manifestPath -Value $manifestText -Encoding UTF8
$manifestSignature = Set-AuthenticodeSignature -LiteralPath $manifestPath -Certificate $certificate -HashAlgorithm SHA256
if ($manifestSignature.Status -ne 'Valid') { throw "Signing failed for manifest.psd1: $($manifestSignature.StatusMessage)" }
Write-Output $output
