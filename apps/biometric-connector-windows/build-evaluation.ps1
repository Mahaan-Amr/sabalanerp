[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BioMiniSdkDirectory
)

$ErrorActionPreference = 'Stop'
$resolvedSdk = (Resolve-Path -LiteralPath $BioMiniSdkDirectory).Path
$required = @('BioMini.UFScanner.dll', 'BioMini.UFMatcher.dll', 'UFScanner.dll', 'UFMatcher.dll')
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSdk $name))) {
        throw "Required BioMini SDK file is missing: $name"
    }
}

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$artifactDirectory = Join-Path $projectDirectory 'artifacts'
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'The .NET Framework x64 C# compiler is unavailable.'
}

$sources = @(
    (Join-Path $projectDirectory 'src\BioMiniSdkAdapter.cs'),
    (Join-Path $projectDirectory 'src\Program.cs')
)
$references = @(
    '/reference:System.dll',
    '/reference:System.Core.dll',
    ('/reference:' + (Join-Path $resolvedSdk 'BioMini.UFScanner.dll')),
    ('/reference:' + (Join-Path $resolvedSdk 'BioMini.UFMatcher.dll'))
)
$output = Join-Path $artifactDirectory 'Sabalan.BioMini.Evaluation.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ ("/out:$output") $references $sources
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed with exit code $LASTEXITCODE." }

Get-ChildItem -LiteralPath $resolvedSdk -Filter '*.dll' -File | Copy-Item -Destination $artifactDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectDirectory 'src\Sabalan.BioMini.Evaluation.exe.config') -Destination ($output + '.config') -Force

Write-Output $output
