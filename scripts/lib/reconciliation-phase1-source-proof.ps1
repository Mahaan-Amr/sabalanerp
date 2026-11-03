# Source-only native snapshot. Tests write/delete access but writes no bytes.
# This is not a substitute for the reviewed parent's lifetime custody.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class Phase1DeniedOpen {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public UInt64 Volume; [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] Id; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out Info info,uint size);
 public static int Test(string path,uint access) { using(var h=CreateFileW(path,access,7,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){if(!h.IsInvalid)return 0;return Marshal.GetLastWin32Error();} }
 public static string DirectoryId(string path) {using(var h=CreateFileW(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){if(h.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());Info i;if(!GetFileInformationByHandleEx(h,18,out i,(uint)Marshal.SizeOf(typeof(Info))))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return i.Volume.ToString()+":"+BitConverter.ToString(i.Id).Replace("-","").ToLowerInvariant();}}
}
'@
$src=[IO.Path]::GetFullPath($PSScriptRoot);$root=[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($src));$tmp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if([IO.Path]::GetDirectoryName($root) -ne $tmp -or [IO.Path]::GetFileName($root) -notmatch '^sabalan-phase1-source-[a-f0-9]{32}$'){throw 'STAGED_SOURCE_ROOT_REQUIRED'}
$names=@('reconciliation-phase1-operational.mjs','reconciliation-phase1-core.mjs','reconciliation-readonly-phase1-cli.mjs','reconciliation-phase1-census.ps1','reconciliation-phase1-evidence.ps1','reconciliation-phase1-lock-identity.ps1','serial-physical\host-lease.mjs','serial-physical\host-lease.ps1','reconciliation-phase1-verify.mjs','reconciliation-phase1-launcher.mjs','reconciliation-phase1-review-anchor.mjs','reconciliation-phase1-source-proof.ps1','reconciliation-phase1-reviewed-intent.json','reconciliation-phase1-external-anchor.json','reconciliation-phase1-review-evidence.json','reconciliation-phase1-source-index.json')
foreach($name in $names){
 $f=Join-Path $src $name;$item=Get-Item -LiteralPath $f -Force
 if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'STAGED_SOURCE_REPARSE'}
 if([Phase1DeniedOpen]::Test($f,0x40000000) -ne 32){throw 'STAGED_SOURCE_WRITE_NOT_DENIED'}
 if([Phase1DeniedOpen]::Test($f,0x00010000) -ne 32){throw 'STAGED_SOURCE_DELETE_NOT_DENIED'}
}
$output=[IO.Path]::GetFullPath($env:SABALAN_PHASE1_OUTPUT_ROOT)
if([IO.Path]::GetDirectoryName($output) -ne $tmp -or [IO.Path]::GetFileName($output) -notmatch '^sabalan-phase1-output-[0-9a-f]{32}$'){throw 'OUTPUT_ROOT_REQUIRED'}
$item=Get-Item -LiteralPath $output -Force;if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'OUTPUT_ROOT_UNPROVEN'}
$staging=Join-Path $output 'staging.json';$stageItem=Get-Item -LiteralPath $staging -Force
if(($stageItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $stageItem.Length -gt 65536){throw 'STAGING_RECORD_INVALID'}
$parentProof=Get-Content -LiteralPath $staging -Raw|ConvertFrom-Json
$outputId=[Phase1DeniedOpen]::DirectoryId($output)
if($parentProof.format -ne 'phase1-native-staging/v1' -or $parentProof.outputRoot -ne $output -or $parentProof.outputRootFileId -ne $outputId){throw 'OUTPUT_ROOT_IDENTITY_MISMATCH'}
[pscustomobject]@{format='phase1-staged-source-denial/v1';files=$names.Count;writeDenied=$true;deleteDenied=$true;outputRootFileId=$outputId;outputIdentity='PARENT_REPORTED_AND_REOBSERVED';ancestorRace='UNPROVEN';continuity='PARENT_HELD_ONLY'}|ConvertTo-Json -Compress
