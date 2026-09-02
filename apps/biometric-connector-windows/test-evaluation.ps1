[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BioMiniSdkDirectory,
    [Parameter(Mandatory = $true)]
    [string]$ApprovedSerial,
    [switch]$Capture
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$executable = & (Join-Path $projectDirectory 'build-evaluation.ps1') -BioMiniSdkDirectory $BioMiniSdkDirectory

Remove-Item Env:SABALAN_BIOMETRIC_ALLOWED_SERIAL -ErrorAction SilentlyContinue
$missing = (& $executable health) | ConvertFrom-Json
if ($LASTEXITCODE -eq 0 -or $missing.errorCategory -ne 'CONFIGURATION_ERROR') {
    throw 'A missing approved serial did not fail closed.'
}

$env:SABALAN_BIOMETRIC_ALLOWED_SERIAL = 'UNAPPROVED-SCANNER'
$substituted = (& $executable health) | ConvertFrom-Json
if ($LASTEXITCODE -eq 0 -or $substituted.errorCategory -ne 'DEVICE_IDENTITY_INVALID') {
    throw 'A substituted scanner did not fail closed.'
}

$env:SABALAN_BIOMETRIC_ALLOWED_SERIAL = $ApprovedSerial
$health = (& $executable health) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $health.availability -ne 'AVAILABLE' -or $health.device.model -ne 'BioMini SLIM 2') {
    throw 'The approved BioMini Slim 2 health check failed.'
}

if ($Capture) {
    Write-Host 'Place one finger flat on the approved scanner.'
    $captureResult = (& $executable capture) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $captureResult.captureQuality.state -ne 'ACCEPTED' -or $captureResult.liveness.state -ne 'LIVE') {
        throw 'The approved-device capture check failed.'
    }
    if ($captureResult.template.materialReturned -ne $false -or $captureResult.rawImagePersisted -ne $false) {
        throw 'The evaluation command exposed forbidden biometric material.'
    }
}

Write-Output 'BioMini evaluation checks passed.'
