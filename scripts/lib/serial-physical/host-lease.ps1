$ErrorActionPreference = 'Stop'
# Canonical local deployment lock, held by this original kernel file handle.
# Reports/PIDs cannot recreate custody. EOF never releases an unfinished owner.
if ($env:SABALAN_AUDIT_EXPECTED_FILE_ID) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AuditFileId {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public UInt64 Volume; [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Id; }
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out Info info, uint size);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
 public static string CurrentBirth() {long c,e,k,u;if(!GetProcessTimes(GetCurrentProcess(),out c,out e,out k,out u))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return c.ToString();}
 public static string Value(SafeFileHandle handle) {
  Info info;
  if(!GetFileInformationByHandleEx(handle, 18, out info, (uint)Marshal.SizeOf(typeof(Info)))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  return info.Volume.ToString()+":"+BitConverter.ToString(info.Id).Replace("-", "").ToLowerInvariant();
 }
 public static string PathValue(string path) {
  using (SafeFileHandle handle=CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
   if(handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   return Value(handle);
  }
 }
}
'@

}

$file = $env:SABALAN_SERIAL_LEASE_FILE
$stream = $null
$fixtureValidated = $false
try {
    if ($env:SABALAN_AUDIT_EXPECTED_FILE_ID) {
        # Proposed opt-in only; this example is NOT a complete path guard.
        $expected = $env:SABALAN_AUDIT_EXPECTED_FILE_ID
        if ($expected -notmatch '^\d+:[0-9a-f]{32}$') { throw 'AUDIT_EXPECTED_FILE_ID_INVALID' }
        $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $actual = [AuditFileId]::Value($stream.SafeFileHandle)
        if ($actual -ne $expected) { $stream.Dispose(); $stream = $null; throw 'AUDIT_FILE_ID_MISMATCH' }
        if ([AuditFileId]::PathValue($file) -ne $actual) { $stream.Dispose(); $stream = $null; throw 'AUDIT_PATH_FILE_ID_MISMATCH' }
        if ($env:SABALAN_TEST_RUN_ID) {
            $run=$env:SABALAN_TEST_RUN_ID;$root=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file));$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
            if($run -notmatch '^[a-f0-9]{32}$' -or [IO.Path]::GetDirectoryName($root) -ne $temp -or [IO.Path]::GetFileName($root) -ne ('sabalan-phase1-fixture-'+$run) -or [IO.Path]::GetFileName($file) -ne 'fixture.lock'){throw 'FIXTURE_BINDING_PATH_INVALID'}
            $fixtureValidated = $true
            $self=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
            $exe=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
            $proof=[ordered]@{format='phase1-fixture-lease-self/v1';fixtureOnly=$true;runId=$run;pid=$PID;birth100ns=[AuditFileId]::CurrentBirth();parentPid=[int]$self.ParentProcessId;executableSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant();helperSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();fileId=$actual}
            $raw=[Text.Encoding]::UTF8.GetBytes(($proof|ConvertTo-Json -Compress));$stage=Join-Path $root 'fixture-lease-self.staging';$f=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try{$f.Write($raw,0,$raw.Length);$f.Flush($true)}finally{$f.Dispose()}
            [IO.File]::Move($stage,(Join-Path $root 'fixture-lease-self.json'))
        }
    } else {
        $stream = [IO.File]::Open($file, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
} catch {
    if ($null -ne $stream) { $stream.Dispose(); $stream = $null }
    [Console]::Out.WriteLine('LEASE_BUSY')
    exit 75
}
if ($env:SABALAN_AUDIT_EXPECTED_FILE_ID) {
    [Console]::Out.WriteLine('LEASE_READY ' + $actual)
} else {
    [Console]::Out.WriteLine('LEASE_READY')
}
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq 'RELEASE_AFTER_VERIFIED_RESTORATION') {
        if ($env:SABALAN_TEST_RELEASE_DELAY) {
            if (-not $fixtureValidated -or $env:SABALAN_TEST_RELEASE_DELAY -ne 'DELAY_RELEASE_12S') { throw 'FIXTURE_RELEASE_DELAY_INVALID' }
            Start-Sleep -Seconds 12
        }
        $stream.Flush($true)
        $stream.Dispose()
        [Console]::Out.WriteLine('LEASE_CLOSED')
        exit 0
    }
    if ($null -eq $line) { Start-Sleep -Milliseconds 250 }
}
