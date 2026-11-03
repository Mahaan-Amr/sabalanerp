$ErrorActionPreference = 'Continue'

$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$log = "$env:LOCALAPPDATA\Temp\sabalan-tunnel-watchdog-22224-20260927.log"
$key = 'C:\Users\mahan\.ssh\sabalan_codex_deploy_ed25519'
$arguments = @(
  '-N', '-T',
  '-E', $log,
  '-o', 'IPQoS=none',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=20',
  '-o', 'ServerAliveCountMax=15',
  '-o', 'TCPKeepAlive=yes',
  '-o', 'BatchMode=yes',
  '-o', 'RekeyLimit=16G',
  '-c', 'aes128-gcm@openssh.com',
  '-i', $key,
  '-R', '22224:127.0.0.1:2222',
  'root@94.182.85.254'
)

while ($true) {
  & $ssh @arguments
  Start-Sleep -Seconds 2
}
