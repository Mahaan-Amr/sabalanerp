$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SabalanDeploymentPowerLease {
 [DllImport("kernel32.dll", SetLastError=true)]
 public static extern uint SetThreadExecutionState(uint flags);
}
'@
$taskStop='D:/sabalanerp/.codex-sabalan-deploy-awake-20261014.stop'
$taskReport='D:/sabalanerp/reports/qa/deploy-20261014-windows-power-lease.json'
$taskDeadline=[DateTime]::UtcNow.AddHours(6)
try {
 if([SabalanDeploymentPowerLease]::SetThreadExecutionState(2147483649) -eq 0){throw 'POWER_REQUEST_FAILED'}
 @{pid=$PID;startedAt=[DateTime]::UtcNow.ToString('o');expiresAt=$taskDeadline.ToString('o');systemRequired=$true;displayRequired=$false;permanentPowerSettingsChanged=$false}|ConvertTo-Json|Set-Content -Encoding utf8 -LiteralPath $taskReport
 while([DateTime]::UtcNow -lt $taskDeadline -and -not (Test-Path -LiteralPath $taskStop)){Start-Sleep -Seconds 15}
} finally {
 [SabalanDeploymentPowerLease]::SetThreadExecutionState(2147483648)|Out-Null
}
