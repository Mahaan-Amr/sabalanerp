[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')][string]$WorkstationId,
    [Parameter(Mandatory = $true)][uri]$ErpOrigin,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9-]{8,128}$')][string]$AllowedDeviceSerial,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40,64}$')][string]$TrustedSignerThumbprint
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer from an elevated PowerShell session.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'The BioMini connector requires 64-bit Windows.' }
$package = (Resolve-Path -LiteralPath $PackageDirectory).Path
$manifestPath = Join-Path $package 'manifest.psd1'
$trustedSigner = $TrustedSignerThumbprint.Replace(' ', '').ToUpperInvariant()
function Assert-TrustedSignature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $actualSigner = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint.Replace(' ', '').ToUpperInvariant() } else { '' }
    if ($signature.Status -ne 'Valid' -or $actualSigner -ne $trustedSigner) { throw "Trusted Sabalan signature gate failed: $Path" }
}
Assert-TrustedSignature $manifestPath
$manifest = Import-PowerShellDataFile -LiteralPath $manifestPath
$listed = @{}
$packagePrefix = $package.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($entry in $manifest.Files) {
    $relative = [string]$entry.Path
    $segments = $relative -split '[\\/]'
    if ([IO.Path]::IsPathRooted($relative) -or $segments.Count -eq 0 -or ($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) { throw "Package manifest path is invalid: $relative" }
    $file = [IO.Path]::GetFullPath((Join-Path $package $relative))
    if (-not $file.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Package manifest path escapes the package: $relative" }
    $normalized = $relative.Replace('/', '\').ToLowerInvariant()
    if ($listed.ContainsKey($normalized)) { throw "Package manifest path is duplicated: $relative" }
    $listed[$normalized] = $file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Package file is missing: $relative" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Package integrity failed: $($entry.path)" }
}
$actual = Get-ChildItem -LiteralPath $package -Recurse -File | Where-Object { $_.FullName -ne $manifestPath } | ForEach-Object { $_.FullName.Substring($packagePrefix.Length).Replace('/', '\').ToLowerInvariant() }
if ($actual.Count -ne $listed.Count -or ($actual | Where-Object { -not $listed.ContainsKey($_) })) { throw 'Package contains files that are absent from the signed manifest.' }
$required = @('node.exe', 'host\index.js', 'adapter\Sabalan.BioMini.Adapter.exe', 'install-connector.ps1')
foreach ($relative in $required) {
    $normalized = $relative.ToLowerInvariant()
    if (-not $listed.ContainsKey($normalized)) { throw "Required package file is absent from the signed manifest: $relative" }
    Assert-TrustedSignature $listed[$normalized]
}
if ($ErpOrigin.Scheme -ne 'https') { throw 'ERP origin must use HTTPS.' }

$installRoot = Join-Path $env:ProgramFiles 'SabalanERP\Biometric Connector'
$dataRoot = Join-Path $env:ProgramData 'SabalanERP\Biometric Connector'
$releaseId = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
$releaseRoot = Join-Path $installRoot (Join-Path 'releases' $releaseId)
if (Test-Path -LiteralPath $releaseRoot) { throw "Release $releaseId is already installed." }
New-Item -ItemType Directory -Path $releaseRoot, $dataRoot -Force | Out-Null
foreach ($entry in $manifest.Files) {
    $relative = [string]$entry.Path
    $destination = Join-Path $releaseRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $listed[$relative.Replace('/', '\').ToLowerInvariant()] -Destination $destination
}

$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $commandBytes = New-Object byte[] 32; $random.GetBytes($commandBytes)
    $transportBytes = New-Object byte[] 32; $random.GetBytes($transportBytes)
} finally { $random.Dispose() }
$commandSecret = [Convert]::ToBase64String($commandBytes)
$transportKey = [Convert]::ToBase64String($transportBytes)
[Array]::Clear($commandBytes, 0, $commandBytes.Length)
[Array]::Clear($transportBytes, 0, $transportBytes.Length)

$config = [ordered]@{
    workstationId = $WorkstationId
    allowedOrigin = $ErpOrigin.GetLeftPart([UriPartial]::Authority)
    listenPort = 47631
    commandSecretBase64 = $commandSecret
    activeTransportKeyId = 'transport-v1'
    transportKeysBase64 = @{ 'transport-v1' = $transportKey }
    journalPath = (Join-Path $dataRoot 'commands.json')
    adapterPath = (Join-Path $releaseRoot 'adapter\Sabalan.BioMini.Adapter.exe')
    allowedDeviceSerial = $AllowedDeviceSerial
}
$configPath = Join-Path $dataRoot 'connector.json'
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
$provisioningPath = Join-Path $dataRoot 'erp-provisioning.json'
@{ $WorkstationId = @{ commandSecretBase64 = $commandSecret; activeTransportKeyId = 'transport-v1'; transportKeysBase64 = @{ 'transport-v1' = $transportKey } } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $provisioningPath -Encoding UTF8

& icacls.exe $dataRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict connector data ACLs.' }

$taskName = 'SabalanERP Biometric Connector'
$action = New-ScheduledTaskAction -Execute (Join-Path $releaseRoot 'node.exe') -Argument ('"' + (Join-Path $releaseRoot 'host\index.js') + '"') -WorkingDirectory (Join-Path $releaseRoot 'host')
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 0) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Connector installed. Transfer $provisioningPath to the ERP secret store, merge it into BIOMETRIC_WORKSTATIONS_JSON, then securely remove the export."
