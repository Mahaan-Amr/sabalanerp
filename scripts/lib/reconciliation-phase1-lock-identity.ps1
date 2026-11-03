# Read-only metadata snapshot; transient open may contend with exclusive opens.
param([string]$FixtureRoot='')
# This is not lease acquisition, historical closure, or an authority decision.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class Phase1LockIdentity {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public UInt64 Volume; [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] Id; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out Info info,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 public static string Read(string path) {
  using(var h=CreateFileW(path,0,7,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) {
   if(h.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());Info i;
   if(!GetFileInformationByHandleEx(h,18,out i,(uint)Marshal.SizeOf(typeof(Info))))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   return i.Volume.ToString()+":"+BitConverter.ToString(i.Id).Replace("-","").ToLowerInvariant();
  }
 }
}
'@
$file='D:\sabalanerp-online-qa\deployment.lock'
if($FixtureRoot){
 $full=[IO.Path]::GetFullPath($FixtureRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
 if([IO.Path]::GetDirectoryName($full) -ne $temp -or [IO.Path]::GetFileName($full) -notmatch '^sabalan-phase1-fixture-[0-9a-f]{32}$'){throw 'TEST_ROOT_REQUIRED'}
 $file=Join-Path $full 'fixture.lock'
}
$current=$file
while($true){
 $item=Get-Item -LiteralPath $current -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PATH_REPARSE_UNPROVEN'}
 $parent=[IO.Path]::GetDirectoryName($current);if([string]::IsNullOrEmpty($parent) -or $parent -eq $current){break};$current=$parent
}
try {$a=[Phase1LockIdentity]::Read($file);$b=[Phase1LockIdentity]::Read($file)}
catch {
 $cause=$_.Exception
 while($null -ne $cause.InnerException){$cause=$cause.InnerException}
 $native=if($cause -is [System.ComponentModel.Win32Exception]){$cause.NativeErrorCode}else{'UNAVAILABLE'}
 [Console]::Error.WriteLine('IDENTITY_NATIVE_CODE='+$native)
 exit 73
}
if($a -ne $b){throw 'LOCK_IDENTITY_CHANGED'}
[pscustomobject]@{format='phase1-lock-identity/v1';fileId=$a;ancestorRace='UNPROVEN';ownership='UNKNOWN'}|ConvertTo-Json -Compress
