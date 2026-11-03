$ErrorActionPreference='Stop'
$taskHelper='D:/sabalanerp-online-qa/held-f282-recovery-20261101/recovery-control.py'
$taskHelperSha='f584737ce036d36d50cd8bce0af781fce993ca767f06abbaa00394c48609b8c0'
$taskPlan='D:/sabalanerp-online-qa/held-f282-native-material-r3-20261101/native-recovery-plan-r5.json'
$taskPlanSha='0fd79b01c17bcdc572638191cf752bcd63138191160a8a6175f71f85186dde3f'
if((Get-FileHash -LiteralPath $taskHelper -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskHelperSha){throw 'HELPER_CHANGED'}
if((Get-FileHash -LiteralPath $taskPlan -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPlanSha){throw 'PLAN_CHANGED'}
$taskRaw=[IO.File]::ReadAllBytes($taskHelper)
$taskAttempt='D:/sabalanerp-online-qa/held-f282-native-material-r3-20261101/execution-attempt-f282-r2.json'
$taskFd=[IO.File]::Open($taskAttempt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$taskBytes=[Text.Encoding]::UTF8.GetBytes((@{operation='f28211a52244b8c71b752731cc15b1b6';planSha256=$taskPlanSha;helperSha256=$taskHelperSha;attemptedAt=[DateTimeOffset]::UtcNow.ToString('o');replayAllowed=$false}|ConvertTo-Json -Compress));$taskFd.Write($taskBytes,0,$taskBytes.Length);$taskFd.Flush($true)}finally{$taskFd.Dispose()}
$taskBootstrap="import sys,base64,hashlib;raw=base64.b64decode(sys.stdin.buffer.read(),validate=False);assert hashlib.sha256(raw).hexdigest()=='f584737ce036d36d50cd8bce0af781fce993ca767f06abbaa00394c48609b8c0';exec(compile(raw,'D:/sabalanerp-online-qa/held-f282-recovery-20261101/recovery-control.py','exec'),{'__name__':'__main__','__file__':'D:/sabalanerp-online-qa/held-f282-recovery-20261101/recovery-control.py'})"
& {[Convert]::ToBase64String($taskRaw)} | & 'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe' -I -B -c $taskBootstrap $taskPlan $taskPlanSha --journal 'D:/sabalanerp-online-qa/held-f282-recovery-execution-r1-20261101' --approved-operation 'f28211a52244b8c71b752731cc15b1b6'
exit $LASTEXITCODE
