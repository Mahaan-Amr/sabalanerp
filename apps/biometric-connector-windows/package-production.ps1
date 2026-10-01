[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BioMiniSdkDirectory,
    [Parameter(Mandatory = $true)][string]$NodeExecutable,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
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

$manifestEntries = Get-ChildItem -LiteralPath $output -Recurse -File | Where-Object { $_.Name -ne 'manifest.psd1' } | Sort-Object FullName | ForEach-Object {
    "        @{ Path = '$($_.FullName.Substring($output.Length + 1).Replace("'", "''"))'; Sha256 = '$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)' }"
}
$manifestText = "@{`r`n    Files = @(`r`n" + ($manifestEntries -join "`r`n") + "`r`n    )`r`n}`r`n"
$manifestPath = Join-Path $output 'manifest.psd1'
Set-Content -LiteralPath $manifestPath -Value $manifestText -Encoding UTF8
Write-Output $output
