[CmdletBinding()]
param(
    [ValidatePattern('^http://(127\.0\.0\.1|localhost):[0-9]{2,5}$')]
    [string]$ErpOrigin = 'http://127.0.0.1:3000',
    [ValidateRange(1024, 65535)]
    [int]$ListenPort = 47631
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $projectDirectory '..\..')).Path
$hostDirectory = Join-Path $projectDirectory 'host'
$adapterPath = Join-Path $projectDirectory 'artifacts\Sabalan.BioMini.Adapter.exe'
$runtimeDirectory = Join-Path $projectDirectory '.local'
$configPath = Join-Path $runtimeDirectory 'connector.json'
$backendEnvPath = Join-Path $runtimeDirectory 'backend.env'
$journalPath = Join-Path $runtimeDirectory 'commands.json'
$composePath = Join-Path $repositoryRoot 'docker-compose.local.yml'
$workstationId = 'SABALAN-LOCAL-BIOMINI'
$allowedSerial = 'SBBM-SLIM22024060000000873053007'

function New-LocalBiometricKey {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    } finally {
        $generator.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
    throw "Local BioMini adapter is missing: $adapterPath. Build it from the approved SDK before starting the connector."
}

Push-Location $repositoryRoot
try {
    $runningServices = @(& docker compose -f $composePath ps --status running --services)
    if ($LASTEXITCODE -ne 0) { throw 'The sabalanerp-local Compose project is unavailable.' }
    if ($runningServices -notcontains 'backend' -or $runningServices -notcontains 'frontend') {
        throw 'The existing sabalanerp-local backend and frontend must be running before the connector starts.'
    }

    $existingListener = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue
    if ($existingListener) {
        throw "Port $ListenPort is already in use. Stop the existing listener before starting the local biometric connector."
    }

    $env:SABALAN_BIOMETRIC_ALLOWED_SERIAL = $allowedSerial
    try {
        $healthText = (& $adapterPath health | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'The BioMini adapter health command failed.' }
        $health = $healthText | ConvertFrom-Json
        if ($health.availability -ne 'AVAILABLE' -or $health.device.serial -ne $allowedSerial) {
            throw 'The approved BioMini Slim 2 is not available to the local adapter.'
        }
    } finally {
        Remove-Item Env:SABALAN_BIOMETRIC_ALLOWED_SERIAL -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $commandSecret = New-LocalBiometricKey
    $transportKey = New-LocalBiometricKey
    $connectorConfig = [ordered]@{
        workstationId = $workstationId
        allowedOrigin = $ErpOrigin
        listenPort = $ListenPort
        commandSecretBase64 = $commandSecret
        activeTransportKeyId = 'transport-v1'
        transportKeysBase64 = @{ 'transport-v1' = $transportKey }
        journalPath = $journalPath
        adapterPath = $adapterPath
        allowedDeviceSerial = $allowedSerial
    }
    $connectorJson = $connectorConfig | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($configPath, $connectorJson, [System.Text.UTF8Encoding]::new($false))

    $workstationConfig = @{
        $workstationId = @{
            commandSecretBase64 = $commandSecret
            activeTransportKeyId = 'transport-v1'
            transportKeysBase64 = @{ 'transport-v1' = $transportKey }
        }
    }
    $env:BIOMETRIC_CONNECTOR_MODE = 'physical'
    $env:BIOMETRIC_WORKSTATIONS_JSON = $workstationConfig | ConvertTo-Json -Depth 4 -Compress
    $backendEnvironment = "BIOMETRIC_CONNECTOR_MODE=physical`nBIOMETRIC_WORKSTATIONS_JSON=$($env:BIOMETRIC_WORKSTATIONS_JSON)`n"
    [System.IO.File]::WriteAllText($backendEnvPath, $backendEnvironment, [System.Text.UTF8Encoding]::new($false))

    & docker compose -f $composePath build backend
    if ($LASTEXITCODE -ne 0) { throw 'The local backend image could not be rebuilt from the current biometric source.' }

    & docker compose -f $composePath up -d --wait --wait-timeout 90 --no-deps --force-recreate backend
    if ($LASTEXITCODE -ne 0) { throw 'The local backend could not be switched to physical biometric diagnostics mode.' }

    & npm --prefix $hostDirectory run build
    if ($LASTEXITCODE -ne 0) { throw 'The workstation connector host build failed.' }

    $env:SABALAN_BIOMETRIC_CONFIG_PATH = $configPath
    Write-Output "BioMini Slim 2 is available. Starting the development connector on 127.0.0.1:$ListenPort."
    Write-Output 'Keep this terminal open while using the biometric diagnostics page. Press Ctrl+C to stop the connector.'
    & node (Join-Path $hostDirectory 'dist\index.js')
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:SABALAN_BIOMETRIC_CONFIG_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:BIOMETRIC_CONNECTOR_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:BIOMETRIC_WORKSTATIONS_JSON -ErrorAction SilentlyContinue
    Pop-Location
}
