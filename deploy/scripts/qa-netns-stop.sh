#!/usr/bin/env bash
# Stop only the recorded #439 owner. The owner itself tears down its resources.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C
die() { printf 'REFUSE: %s\n' "$*" >&2; exit 1; }
[[ $# == 0 && $EUID == 0 && ${WSL_DISTRO_NAME:-} == sabalanerp-qa-debian ]] || die 'root on pinned WSL host required'
record=/srv/sabalanerp-qa/qa-netns-owner.pid
[[ -f $record && ! -L $record && $(stat -c '%u:%h:%a' "$record") == 0:1:600 ]] || die 'safe owner record absent'
read -r owner owner_birth daemon daemon_birth namespace < "$record"
[[ $owner =~ ^[1-9][0-9]*$ && $daemon =~ ^[1-9][0-9]*$ && $owner_birth =~ ^[1-9][0-9]*$ && $daemon_birth =~ ^[1-9][0-9]*$ && $namespace =~ ^net:\[[1-9][0-9]*\]$ ]] || die 'invalid owner record'
[[ -d /proc/$owner && -d /proc/$daemon ]] || die 'recorded process absent; manual review required'
actual_owner_birth=$(sed 's/^.*) //' "/proc/$owner/stat" | awk '{print $20}')
actual_daemon_birth=$(sed 's/^.*) //' "/proc/$daemon/stat" | awk '{print $20}')
[[ $actual_owner_birth == "$owner_birth" && $actual_daemon_birth == "$daemon_birth" ]] || die 'PID birth changed'
[[ $(readlink "/proc/$daemon/exe") == /usr/bin/dockerd && $(readlink "/proc/$daemon/ns/net") == "$namespace" && $(stat -c 'net:[%i]' /run/netns/sabalanerp-qa) == "$namespace" ]] || die 'daemon or namespace changed'
tr '\0' ' ' < "/proc/$owner/cmdline" | grep -Fq 'qa-netns-no-data-probe.sh' || die 'owner executable changed'
tr '\0' ' ' < "/proc/$owner/cmdline" | grep -Fq -- '--hold' || die 'owner is not in hold mode'
kill -TERM "$owner"
for ((i=0; i<150; i++)); do
  [[ -d /proc/$owner ]] || break
  sleep 0.2
done
[[ ! -d /proc/$owner && ! -e $record && ! -e /run/netns/sabalanerp-qa && ! -e /run/docker.sock && ! -e /run/docker.pid ]] || die 'owner teardown incomplete; manual review required'
printf 'PASS: recorded QA network owner stopped and owned resources removed\n'
