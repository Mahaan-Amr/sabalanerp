# Run explicitly with 32-bit Windows PowerShell. No device management calls.
param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Use 32-bit Windows PowerShell (SysWOW64).' }
$settings = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$endpoint = [Uri]$settings.ErpUrl
if ($endpoint.Scheme -ne 'https' -and -not ($endpoint.IsLoopback -and $endpoint.Scheme -eq 'http')) { throw 'HTTPS is required outside loopback.' }
$stateDirectory = [IO.Path]::GetFullPath($settings.StateDirectory)
[IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
# Exclusive ownership prevents two readers racing on the durable queue.
$queueLock = [IO.File]::Open((Join-Path $stateDirectory 'reader.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$stateFile = Join-Path $stateDirectory 'state.json'
$seen = @{}
$pending = New-Object 'System.Collections.Generic.List[object]'
if (Test-Path -LiteralPath $stateFile) {
  $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  foreach ($key in $saved.seen) { $seen[[string]$key] = $true }
  foreach ($item in $saved.pending) { $pending.Add($item) }
}
function Save-Queue {
  $temporary = $stateFile + '.new'
  $json = @{ seen = @($seen.Keys); pending = @($pending.ToArray()) } | ConvertTo-Json -Depth 6 -Compress
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
  $file = [IO.File]::Open($temporary, 'Create', 'Write', 'None')
  try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
  # Windows PowerShell 5.1 coerces $null to an empty string for string arguments.
  # File.Replace needs a real null backup path to preserve atomic replacement.
  if ([IO.File]::Exists($stateFile)) { [IO.File]::Replace($temporary, $stateFile, [System.Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($temporary, $stateFile) }
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SabalanAttendanceLoader {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern IntPtr LoadLibraryExW(string path, IntPtr reserved, uint flags);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr handle);
}
'@
$handles = New-Object 'System.Collections.Generic.List[IntPtr]'
$sdk = $null
$connected = $false
$clockSample = $null
$clockReadAt = [DateTime]::MinValue
function Measure-DeviceClock {
  [int]$y=0; [int]$mo=0; [int]$d=0; [int]$h=0; [int]$mi=0; [int]$s=0
  $before = [DateTime]::UtcNow
  $watch = [Diagnostics.Stopwatch]::StartNew()
  if (-not $sdk.GetDeviceTime([int]$settings.MachineNumber, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$s)) { throw 'Device clock read unavailable.' }
  $watch.Stop()
  $after = [DateTime]::UtcNow
  if ([Math]::Abs(($after-$before).TotalSeconds-$watch.Elapsed.TotalSeconds) -gt 0.5) { return $null }
  $deviceTime = [TimeZoneInfo]::ConvertTimeToUtc([DateTime]::new($y,$mo,$d,$h,$mi,$s,[DateTimeKind]::Unspecified),$zone)
  $deviceMinusWindows = ($deviceTime-$before.AddTicks([long](($after-$before).Ticks/2))).TotalMilliseconds
  $erpBefore = [DateTime]::UtcNow
  $erpWatch = [Diagnostics.Stopwatch]::StartNew()
  $health = Invoke-RestMethod -Uri ($settings.ErpUrl.TrimEnd('/') + '/api/health') -TimeoutSec 10
  $erpWatch.Stop()
  $erpAfter = [DateTime]::UtcNow
  if ($health.status -ne 'OK' -or [Math]::Abs(($erpAfter-$erpBefore).TotalSeconds-$erpWatch.Elapsed.TotalSeconds) -gt 0.5) { return $null }
  $erpTime = ([DateTimeOffset]::Parse([string]$health.timestamp,[Globalization.CultureInfo]::InvariantCulture)).UtcDateTime
  $erpMinusWindows = ($erpTime-$erpBefore.AddTicks([long](($erpAfter-$erpBefore).Ticks/2))).TotalMilliseconds
  $offset = [Math]::Round($erpMinusWindows-$deviceMinusWindows)
  $uncertainty = [Math]::Ceiling(($watch.Elapsed.TotalMilliseconds+$erpWatch.Elapsed.TotalMilliseconds)/2+1000)
  if ([Math]::Abs($offset) -gt 300000 -or $uncertainty -gt 15000) { return $null }
  return @{ offsetMs=$offset; uncertaintyMs=$uncertainty; measuredAt=$erpTime.ToString('o') }
}
try {
  foreach ($library in @('zkemsdk.dll','commpro.dll','tcpcomm.dll','plcommpro.dll','pltcpcomm.dll')) {
    $handle = [SabalanAttendanceLoader]::LoadLibraryExW((Join-Path $settings.SdkDirectory $library), [IntPtr]::Zero, 8)
    if ($handle -eq [IntPtr]::Zero) { throw "SDK dependency load failed: $library" }
    $handles.Add($handle)
  }
  $sdk = New-Object -ComObject 'zkemkeeper.ZKEM.1'
  $zone = [TimeZoneInfo]::FindSystemTimeZoneById('Iran Standard Time')
  $queueDurable = $true
  while ($true) {
    $readOk = $false
    try {
      if (-not $connected) {
        if ($settings.CommunicationKey) { if (-not $sdk.SetCommPassword([int]$settings.CommunicationKey)) { throw 'SDK communication authentication failed.' } }
        $connected = $sdk.Connect_Net([string]$settings.DeviceAddress, [int]$settings.DevicePort)
        if (-not $connected) { throw 'Terminal connection failed.' }
      }
      if (([DateTime]::UtcNow-$clockReadAt).TotalSeconds -ge 60) {
        $clockSample = $null
        try { $clockSample = Measure-DeviceClock } catch { Write-Warning 'Clock estimate unavailable; raw attendance timestamps are preserved.' }
        $clockReadAt = [DateTime]::UtcNow
      }
      # This is the successfully tested read sequence; no templates or user directory.
      if (-not $sdk.ReadGeneralLogData([int]$settings.MachineNumber)) { throw 'Terminal log read failed.' }
      [string]$code = ''; [int]$verify = 0; [int]$direction = 0
      [int]$year = 0; [int]$month = 0; [int]$day = 0; [int]$hour = 0; [int]$minute = 0; [int]$second = 0; [int]$workcode = 0
      while ($sdk.SSR_GetGeneralLogData([int]$settings.MachineNumber, [ref]$code, [ref]$verify, [ref]$direction, [ref]$year, [ref]$month, [ref]$day, [ref]$hour, [ref]$minute, [ref]$second, [ref]$workcode)) {
        $local = [DateTime]::new($year,$month,$day,$hour,$minute,$second,[DateTimeKind]::Unspecified)
        $occurred = [TimeZoneInfo]::ConvertTimeToUtc($local,$zone).ToString("yyyy-MM-ddTHH:mm:ss'Z'")
        $key = "$code|$occurred|$verify|$direction"
        if (-not $seen.ContainsKey($key)) {
          $queueDurable = $false
          $pending.Add(@{ deviceCode = $code; occurredAt = $occurred; verifyMode = $verify; inOutRaw = $direction })
          $seen[$key] = $true
        }
      }
      Save-Queue
      $queueDurable = $true
      $readOk = $true
    } catch {
      # Generic diagnostics deliberately contain no address, credential or personnel row.
      Write-Warning 'Terminal read unavailable; keeping the existing queue.'
      if ($connected) { $sdk.Disconnect(); $connected = $false }
    }
    if (-not $queueDurable) { Start-Sleep -Milliseconds 1000; continue }
    try {
      # Empty batches are authenticated heartbeats. Persist before sending and after ACK.
      $batch = @($pending.ToArray() | Select-Object -First 100)
      $body = @{ punches = $batch; readOk = $readOk }
      if ($clockSample -and ([DateTime]::UtcNow-$clockReadAt).TotalSeconds -lt 90) { $body.clockSample = $clockSample }
      $payload = $body | ConvertTo-Json -Depth 5 -Compress
      $result = Invoke-RestMethod -Uri ($settings.ErpUrl.TrimEnd('/') + '/api/attendance-device/connector/' + $settings.TerminalId + '/punches') -Method Post -ContentType 'application/json' -Headers @{ Authorization = 'Bearer ' + $settings.Token } -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 10
      if (-not $result.success -or @($result.data.accepted).Count -ne $batch.Count) { throw 'Batch not fully acknowledged.' }
      if ($batch.Count -gt 0) { $pending.RemoveRange(0,$batch.Count); Save-Queue }
    } catch { Write-Warning 'ERP delivery unavailable; queue retained for retry.' }
    Start-Sleep -Milliseconds 1000
  }
} finally {
  if ($connected -and $sdk) { $sdk.Disconnect() }
  if ($sdk) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($sdk) | Out-Null }
  for ($i = $handles.Count - 1; $i -ge 0; $i--) { [SabalanAttendanceLoader]::FreeLibrary($handles[$i]) | Out-Null }
  $queueLock.Dispose()
}
