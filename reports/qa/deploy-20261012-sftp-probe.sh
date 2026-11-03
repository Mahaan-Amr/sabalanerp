set -eu
printf 'pwd\n' | timeout 20 sftp -q -b - -P 22225 -i /root/.ssh/sabalan-laptop-sftp -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/root/.ssh/sabalan-laptop-known_hosts.22225 sabalan-backup@127.0.0.1
ps -C sshfs -o pid,etime,args
