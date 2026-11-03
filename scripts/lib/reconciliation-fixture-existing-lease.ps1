# TEST-OWNED ONLY. This is not the live canonical owner.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AuditFileId {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public UInt64 Volume; [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Id; }
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out Info info, uint size);
 public static string Value(SafeFileHandle handle) {
  Info info;
  if(!GetFileInformationByHandleEx(handle, 18, out info, (uint)Marshal.SizeOf(typeof(Info)))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  return info.Volume.ToString()+":"+BitConverter.ToString(info.Id).Replace("-", "").ToLowerInvariant();
 }
}
'@
$target = $env:SABALAN_AUDIT_FIXTURE_LEASE
$expected = $env:SABALAN_AUDIT_FIXTURE_FILE_ID
$parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$targetFull = [IO.Path]::GetFullPath($target)
$fixtureRoot = [IO.Path]::GetDirectoryName($targetFull)
if ([IO.Path]::GetDirectoryName($fixtureRoot) -ne $parent -or [IO.Path]::GetFileName($fixtureRoot) -notmatch '^sabalan-phase1-fixture-[0-9a-f]{32}$' -or [IO.Path]::GetFileName($targetFull) -ne 'fixture.lock' -or $expected -notmatch '^\d+:[0-9a-f]{32}$') { throw 'TEST_ONLY_PATH_REQUIRED' }
$stream = $null
try {
 $stream = [IO.File]::Open($targetFull,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $actual = [AuditFileId]::Value($stream.SafeFileHandle)
 if ($actual -ne $expected) { throw 'FIXTURE_FILE_ID_MISMATCH' }
 [Console]::Out.WriteLine('LEASE_READY '+$actual);[Console]::Out.Flush()
 while ($true) {
  $line=[Console]::In.ReadLine()
  if ($line -eq 'RELEASE_AFTER_VERIFIED_AUDIT') { $stream.Dispose();$stream=$null;[Console]::Out.WriteLine('LEASE_CLOSED');exit 0 }
  if ($null -eq $line) { Start-Sleep -Milliseconds 250 }
 }
} finally { if ($null -ne $stream) { $stream.Dispose() } }
