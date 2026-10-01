[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$connectorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$testRoot = Join-Path $connectorRoot ('.local\package-validation-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$installer = Join-Path $connectorRoot 'install-connector.ps1'
$requiredFiles = @('node.exe', 'host\index.js', 'adapter\Sabalan.BioMini.Adapter.exe', 'install-connector.ps1')

function New-TestPackage([string]$Name) {
    $directory = Join-Path $testRoot $Name
    foreach ($relative in $requiredFiles) {
        $file = Join-Path $directory $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
        Set-Content -LiteralPath $file -Value 'unsigned validation fixture; never execute' -Encoding UTF8
    }
    Write-TestManifest $directory $requiredFiles
    return $directory
}

function Write-TestManifest([string]$Directory, [string[]]$Files) {
    $entries = foreach ($relative in $Files) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $Directory $relative) -Algorithm SHA256).Hash
        "@{ Path = '$relative'; Sha256 = '$hash' }"
    }
    Set-Content -LiteralPath (Join-Path $Directory 'manifest.psd1') -Value ("@{ Files = @(" + ($entries -join ';') + ") }") -Encoding UTF8
}

function Invoke-Validation([string]$Directory, [string]$Origin = 'https://sabalanerp.com') {
    & $installer -PackageDirectory $Directory -WorkstationId 'VALIDATION-ONLY' -ErpOrigin $Origin -AllowedDeviceSerial 'VALIDATION-DEVICE' -ValidateOnly
}

function Assert-Rejected([string]$Name, [string]$Directory, [string]$Pattern, [string]$Origin = 'https://sabalanerp.com') {
    $rejected = $false
    try { Invoke-Validation $Directory $Origin | Out-Null }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected validation error for ${Name}: $($_.Exception.Message)" }
        $rejected = $true
    }
    if (-not $rejected) { throw "Validation incorrectly accepted: $Name" }
    Write-Output "PASS: $Name rejected"
}

try {
    $valid = New-TestPackage 'unsigned'
    Invoke-Validation $valid | Out-Null
    Write-Output 'PASS: unsigned package accepted without installation'

    $tampered = New-TestPackage 'tampered'
    Add-Content -LiteralPath (Join-Path $tampered 'host\index.js') -Value 'changed'
    Assert-Rejected 'changed file' $tampered 'Package integrity failed'

    $missing = New-TestPackage 'missing'
    Rename-Item -LiteralPath (Join-Path $missing 'node.exe') -NewName 'node-renamed.exe'
    Assert-Rejected 'missing file' $missing 'Package file is missing'

    $extra = New-TestPackage 'extra'
    Set-Content -LiteralPath (Join-Path $extra 'extra.txt') -Value 'unlisted'
    Assert-Rejected 'unlisted file' $extra 'absent from the manifest'

    $duplicate = New-TestPackage 'duplicate'
    Write-TestManifest $duplicate ($requiredFiles + 'node.exe')
    Assert-Rejected 'duplicate path' $duplicate 'path is duplicated'

    $escaping = New-TestPackage 'escaping'
    Set-Content -LiteralPath (Join-Path $escaping 'manifest.psd1') -Value "@{ Files = @(@{ Path = '..\escape.exe'; Sha256 = 'unused' }) }"
    Assert-Rejected 'escaping path' $escaping 'path is invalid|escapes the package'

    $absentRequired = New-TestPackage 'absent-required'
    Rename-Item -LiteralPath (Join-Path $absentRequired 'node.exe') -NewName 'other.exe'
    Write-TestManifest $absentRequired @('other.exe', 'host\index.js', 'adapter\Sabalan.BioMini.Adapter.exe', 'install-connector.ps1')
    Assert-Rejected 'required file omitted from manifest' $absentRequired 'Required package file is absent'

    Assert-Rejected 'HTTP origin' $valid 'ERP origin must use HTTPS' 'http://sabalanerp.com'
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $connectorRoot '.local')).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside connector test workspace.' }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
