# Read-only hash and two-handle FileIdInfo snapshot; no lease or write action.
param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EvidenceId {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public UInt64 Volume; [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Id; }
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public uint Attr; public System.Runtime.InteropServices.ComTypes.FILETIME Create, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int kind, out Info i, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetFileInformationByHandle(SafeFileHandle h,out Basic i);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern SafeFileHandle CreateFileW(string p, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
 public static string Value(SafeFileHandle h) { Info i; if(!GetFileInformationByHandleEx(h,18,out i,(uint)Marshal.SizeOf(typeof(Info)))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); return i.Volume.ToString()+":"+BitConverter.ToString(i.Id).Replace("-", "").ToLowerInvariant(); }
 public static string PathValue(string p) { using(var h=CreateFileW(p,0,7,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) { if(h.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return Value(h); } }
 public static string Meta(SafeFileHandle h) { Basic i;if(!GetFileInformationByHandle(h,out i))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return i.SizeHigh.ToString()+":"+i.SizeLow.ToString()+":"+i.Write.dwHighDateTime.ToString()+":"+i.Write.dwLowDateTime.ToString(); }
}
'@
$full=[IO.Path]::GetFullPath($Target)
$allowed=@('D:\sabalanerp-online-qa\419-safe-rollback-a0d2baba08ec7e004d1458675799db6a\baseline.json','C:\Users\mahan\.codex\worktrees\native-c3-execution-419\sabalanerp\reports\qa\application-native-b0db9e621d4d29fa857a13285ca6254b-role-held.json')
$parent=[IO.Path]::GetDirectoryName($full);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$fixture=([IO.Path]::GetDirectoryName($parent) -eq $temp -and [IO.Path]::GetFileName($parent) -match '^sabalan-evidence-fixture-[0-9a-f]{32}$' -and [IO.Path]::GetFileName($full) -in @('evidence.json','baseline.json','role-held.json'))
if ($full -notin $allowed -and -not $fixture) { throw 'FIXED_TARGET_REQUIRED' }
$item=Get-Item -LiteralPath $full -Force
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'EVIDENCE_PATH_UNPROVEN' }
$stream=[IO.File]::Open($full,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
try {
 $id=[EvidenceId]::Value($stream.SafeFileHandle)
 if ([EvidenceId]::PathValue($full) -ne $id) { throw 'EVIDENCE_PATH_ID_MISMATCH' }
 function Read-BoundedDigest($handle) {
  $hash=[Security.Cryptography.SHA256]::Create();$buffer=New-Object byte[] 65536;$total=0
  try {
   while (($n=$handle.Read($buffer,0,$buffer.Length)) -gt 0) {
    $total += $n;if($total -gt 16777216){throw 'EVIDENCE_BOUND_EXCEEDED'}
    [void]$hash.TransformBlock($buffer,0,$n,$buffer,0)
   }
   [void]$hash.TransformFinalBlock($buffer,0,0)
   return [pscustomobject]@{bytes=$total;sha256=[BitConverter]::ToString($hash.Hash).Replace('-','').ToLowerInvariant()}
  } finally {$hash.Dispose()}
 }
 $before=[EvidenceId]::Meta($stream.SafeFileHandle)
 $first=Read-BoundedDigest $stream;$middle=[EvidenceId]::Meta($stream.SafeFileHandle)
 if($env:SABALAN_TEST_EVIDENCE_BARRIER){
  if(!$fixture -or [IO.Path]::GetFileName($full) -ne 'baseline.json' -or $env:SABALAN_TEST_EVIDENCE_BARRIER -ne [IO.Path]::GetFileName($parent).Substring('sabalan-evidence-fixture-'.Length)){throw 'TEST_BARRIER_SCOPE'}
  $marker=Join-Path $parent 'baseline-observed.json';$resume=Join-Path $parent 'baseline-resume.json'
  $raw=[Text.Encoding]::UTF8.GetBytes(([pscustomobject]@{format='phase1-evidence-barrier/v1';fileId=$id;sha256=$first.sha256;runId=$env:SABALAN_TEST_EVIDENCE_BARRIER}|ConvertTo-Json -Compress))
  $m=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$m.Write($raw,0,$raw.Length);$m.Flush($true)}finally{$m.Dispose()}
  $until=[DateTime]::UtcNow.AddSeconds(10);while(!(Test-Path -LiteralPath $resume)){if([DateTime]::UtcNow -ge $until){throw 'TEST_BARRIER_TIMEOUT'};Start-Sleep -Milliseconds 25}
 }
 [void]$stream.Seek(0,[IO.SeekOrigin]::Begin)
 $second=Read-BoundedDigest $stream;$after=[EvidenceId]::Meta($stream.SafeFileHandle)
 if($before -ne $middle -or $middle -ne $after -or $first.bytes -ne $second.bytes -or $first.sha256 -ne $second.sha256){throw 'EVIDENCE_CONTENT_CHANGED'}
 if ([EvidenceId]::Value($stream.SafeFileHandle) -ne $id -or [EvidenceId]::PathValue($full) -ne $id) { throw 'EVIDENCE_ID_CHANGED' }
 [pscustomobject]@{format='phase1-evidence-snapshot/v1';bytes=$first.bytes;sha256=$first.sha256;fileId=$id;ancestorRace='UNPROVEN';concurrentContentMutation='UNPROVEN'} | ConvertTo-Json -Compress
} finally {$stream.Dispose()}
