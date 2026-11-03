$ErrorActionPreference = 'Stop'
# Canonical local deployment lock, held by this original kernel file handle.
# Reports/PIDs cannot recreate custody. EOF never releases an unfinished owner.
$file = $env:SABALAN_SERIAL_LEASE_FILE
$stream = $null
try {
    $stream = [IO.File]::Open($file, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
    [Console]::Out.WriteLine('LEASE_BUSY')
    exit 75
}
[Console]::Out.WriteLine('LEASE_READY')
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq 'RELEASE_AFTER_VERIFIED_RESTORATION') {
        $stream.Flush($true)
        $stream.Dispose()
        [Console]::Out.WriteLine('LEASE_CLOSED')
        exit 0
    }
    if ($null -eq $line) { Start-Sleep -Milliseconds 250 }
}
