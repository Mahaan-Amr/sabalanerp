[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $projectDirectory '..\..')).Path
$composePath = Join-Path $repositoryRoot 'docker-compose.local.yml'
$backendEnvPath = Join-Path $projectDirectory '.local\backend.env'

Push-Location $repositoryRoot
try {
    & docker compose -f $composePath ps | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The sabalanerp-local Compose project is unavailable.' }
    Remove-Item -LiteralPath $backendEnvPath -Force -ErrorAction SilentlyContinue
    & docker compose -f $composePath up -d --wait --wait-timeout 90 --no-deps --force-recreate backend
    if ($LASTEXITCODE -ne 0) { throw 'The local backend could not be reset to simulator mode.' }
    Write-Output 'The local backend is back in biometric simulator mode.'
} finally {
    Pop-Location
}
