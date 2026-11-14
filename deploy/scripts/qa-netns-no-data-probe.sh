#!/usr/bin/env bash
# #439: one-shot, no-image network qualification. Run only after independent review.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

die() { printf 'REFUSE: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 || ( $# == 3 && $3 == --hold ) ]] || die 'usage: qa-netns-no-data-probe.sh MANIFEST EVIDENCE_DIR [--hold]'
manifest=$1 evidence=$2 hold=${3:-}
owner_file=/srv/sabalanerp-qa/qa-netns-owner.pid
script_dir=$(dirname "$0")
signal_helper=$script_dir/qa-owned-pid-signal.pl
source "$script_dir/qa-netns-resolver-parent.sh"
source "$script_dir/qa-netns-owned-socket.sh"
[[ $EUID == 0 && ${WSL_DISTRO_NAME:-} == sabalanerp-qa-debian ]] || die 'pinned root WSL host required'
[[ $(dirname -- "$evidence") == /srv/sabalanerp-qa && -d $evidence && ! -L $evidence ]] || die 'private existing evidence directory required'
[[ $(stat -c '%u:%a' -- "$evidence") == 0:700 ]] || die 'unsafe evidence directory'
[[ -z $(find "$evidence" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'evidence directory must be empty'
[[ ! -e $owner_file && ! -L $owner_file ]] || die 'QA network owner already exists'

# This is the last read-only gate before any namespace or Docker operation. It
# refuses a pre-existing daemon, socket, PID file, container record or namespace.
node "$script_dir/qa-zero-state-preflight.mjs" "$manifest" || die 'zero-state preflight failed'
for command in ip slirp4netns dockerd docker curl node perl ss getent cut timeout findmnt mount iptables-save ip6tables-save; do
  command -v "$command" >/dev/null || die "missing $command"
done
[[ ! -e /run/netns/sabalanerp-qa-probe && ! -e /etc/netns/sabalanerp-qa-probe ]] || die 'probe namespace pre-exists'
initial_ns=$(readlink /proc/self/ns/net)
[[ $initial_ns == "$(readlink /proc/1/ns/net)" ]] || die 'not in initial namespace'
ip_exe=$(readlink -f "$(command -v ip)")
owner_birth=$(sed 's/^.*) //' "/proc/$$/stat" | awk '{print $20}')
birth_of() { sed 's/^.*) //' "/proc/$1/stat" | awk '{print $20}'; }
owned_signal() { perl "$signal_helper" "$1" "$2" "$3" "$4" "$5"; }
[[ ! $(node -e 'const s=require("fs").readFileSync("/etc/resolv.conf","utf8");process.stdout.write(/^\s*nameserver\s+(?:127\.|::1(?:\s|$))/m.test(s)?"bad":"")') ]] || die 'loopback initial DNS is unsafe'

owned_qa=0 owned_peer=0 owned_qa_dir=0 owned_peer_dir=0 owned_network=0 owner_file_ours=0 slirp_pid= slirp_birth= dockerd_pid= dockerd_birth= initial_server= initial_server_birth= qa_server= qa_server_birth= watchdog_pid= watchdog_birth= QA_OWNED_SOCKET_IDENTITY=
cleanup() {
  local result=$?; trap - EXIT INT TERM
  if [[ -n $watchdog_birth ]] && ! owned_signal "$watchdog_pid" "$watchdog_birth" '/usr/bin/bash,/usr/bin/sleep' "$initial_ns" 15 2>/dev/null; then result=1; fi
  [[ -z $watchdog_pid ]] || wait "$watchdog_pid" 2>/dev/null || :
  if [[ -n $qa_server_birth ]] && ! owned_signal "$qa_server" "$qa_server_birth" "$ip_exe,/usr/bin/node" "$initial_ns,${qa_ns:-$initial_ns}" 15 2>/dev/null; then result=1; fi
  [[ -z $qa_server ]] || wait "$qa_server" 2>/dev/null || :
  if [[ -n $initial_server_birth ]] && ! owned_signal "$initial_server" "$initial_server_birth" '/usr/bin/node' "$initial_ns" 15 2>/dev/null; then result=1; fi
  [[ -z $initial_server ]] || wait "$initial_server" 2>/dev/null || :
  if [[ $owned_network == 1 && -n $dockerd_birth ]] && owned_signal "$dockerd_pid" "$dockerd_birth" '/usr/bin/dockerd' "$qa_ns" 0 2>/dev/null; then
    timeout 10 ip netns exec sabalanerp-qa docker --host unix:///run/docker.sock network rm qa439-probe >/dev/null 2>&1 || result=1
  fi
  if [[ -n $dockerd_birth ]]; then
    owned_signal "$dockerd_pid" "$dockerd_birth" "$ip_exe,/usr/bin/bash,/usr/bin/dockerd" "$initial_ns,${qa_ns:-$initial_ns}" 15 2>/dev/null || result=1
    for ((i=0; i<30; i++)); do
      owned_signal "$dockerd_pid" "$dockerd_birth" "$ip_exe,/usr/bin/bash,/usr/bin/dockerd" "$initial_ns,${qa_ns:-$initial_ns}" 0 2>/dev/null || break
      sleep 0.2
    done
    if owned_signal "$dockerd_pid" "$dockerd_birth" "$ip_exe,/usr/bin/bash,/usr/bin/dockerd" "$initial_ns,${qa_ns:-$initial_ns}" 0 2>/dev/null; then
      owned_signal "$dockerd_pid" "$dockerd_birth" "$ip_exe,/usr/bin/bash,/usr/bin/dockerd" "$initial_ns,${qa_ns:-$initial_ns}" 9 2>/dev/null || :
      result=1
    fi
    wait "$dockerd_pid" 2>/dev/null || :
  fi
  if [[ -e /run/docker.sock || -L /run/docker.sock ]]; then
    qa_owned_socket_cleanup /run/docker.sock "$QA_OWNED_SOCKET_IDENTITY" || result=1
  fi
  if [[ -n $slirp_birth ]]; then owned_signal "$slirp_pid" "$slirp_birth" '/usr/bin/slirp4netns' "$initial_ns" 15 2>/dev/null || result=1; fi
  [[ -z $slirp_pid ]] || wait "$slirp_pid" 2>/dev/null || :
  if [[ $owned_peer == 1 ]]; then ip netns del sabalanerp-qa-probe 2>/dev/null || result=1; fi
  if [[ $owned_qa == 1 ]]; then ip netns del sabalanerp-qa 2>/dev/null || result=1; fi
  if [[ $owned_peer_dir == 1 ]]; then rm -f /etc/netns/sabalanerp-qa-probe/resolv.conf; rmdir /etc/netns/sabalanerp-qa-probe 2>/dev/null || result=1; fi
  if [[ $owned_qa_dir == 1 ]]; then rm -f /etc/netns/sabalanerp-qa/resolv.conf; rmdir /etc/netns/sabalanerp-qa 2>/dev/null || result=1; fi
  qa_resolver_parent_cleanup /etc/netns || result=1
  if [[ -e $evidence/initial-netns.before ]]; then
    snapshot after || result=1
    for item in initial-netns initial-iptables-v4 initial-iptables-v6 initial-routes-v4 initial-routes-v6 initial-links initial-cgroup-statfs initial-cgroup-mount initial-cgroup-ns initial-mount-ns initial-cgroup-membership host-pid1 host-pid1-exe host-wsl-config; do
      cmp -s "$evidence/$item.before" "$evidence/$item.after" || result=1
    done
  fi
  if [[ $owner_file_ours == 1 ]]; then
    [[ $(cat "$owner_file") == "$owner_record" ]] && rm -f -- "$owner_file" || result=1
  fi
  printf '%s\n' "$result" > "$evidence/exit-status"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
( sleep 180; owned_signal "$$" "$owner_birth" '/usr/bin/bash' "$initial_ns" 15 ) & watchdog_pid=$!
watchdog_birth=$(birth_of "$watchdog_pid") || die 'watchdog birth unavailable'

snapshot() {
  local phase=$1
  readlink /proc/1/ns/net > "$evidence/initial-netns.$phase"
  iptables-save > "$evidence/initial-iptables-v4.$phase"
  ip6tables-save > "$evidence/initial-iptables-v6.$phase"
  ip -4 route show table all > "$evidence/initial-routes-v4.$phase"
  ip -6 route show table all > "$evidence/initial-routes-v6.$phase"
  ip -details link show > "$evidence/initial-links.$phase"
  stat -fc '%T:%t' /sys/fs/cgroup > "$evidence/initial-cgroup-statfs.$phase"
  findmnt -n -T /sys/fs/cgroup -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION > "$evidence/initial-cgroup-mount.$phase"
  readlink /proc/self/ns/cgroup > "$evidence/initial-cgroup-ns.$phase"
  readlink /proc/self/ns/mnt > "$evidence/initial-mount-ns.$phase"
  cat /proc/self/cgroup > "$evidence/initial-cgroup-membership.$phase"
  cat /proc/1/comm > "$evidence/host-pid1.$phase"
  readlink /proc/1/exe > "$evidence/host-pid1-exe.$phase"
  cat /etc/wsl.conf > "$evidence/host-wsl-config.$phase"
}
snapshot before
[[ $(cat "$evidence/initial-cgroup-statfs.before") == cgroup2fs:63677270 ]] || die 'initial cgroup2 mount unavailable'
umask 077
qa_resolver_parent_prepare /etc/netns || die 'unsafe /etc/netns resolver parent'

# ip netns add runs in the persistent initial mount namespace. Never create a
# named namespace from ip netns exec, whose mount namespace is temporary.
ip netns add sabalanerp-qa; owned_qa=1
mkdir /etc/netns/sabalanerp-qa
owned_qa_dir=1
printf 'nameserver 10.0.2.3\n' > /etc/netns/sabalanerp-qa/resolv.conf
slirp4netns --configure --disable-host-loopback --netns-type=path /run/netns/sabalanerp-qa tap0 > "$evidence/slirp.log" 2>&1 & slirp_pid=$!
slirp_birth=$(birth_of "$slirp_pid") || die 'slirp birth unavailable'
for ((i=0; i<50; i++)); do
  kill -0 "$slirp_pid" 2>/dev/null || die 'slirp exited'
  if ip -n sabalanerp-qa link show tap0 >/dev/null 2>&1; then break; fi
  sleep 0.2
done
ip -n sabalanerp-qa link show tap0 >/dev/null || die 'slirp TAP absent'
qa_ns=$(stat -c 'net:[%i]' /run/netns/sabalanerp-qa)
[[ $qa_ns != "$initial_ns" && $qa_ns == "$(ip netns exec sabalanerp-qa readlink /proc/self/ns/net)" ]] || die 'QA namespace identity mismatch'

ip netns exec sabalanerp-qa bash "$script_dir/qa-netns-cgroup-child.sh" "$evidence" "$qa_ns" "$(cat "$evidence/initial-mount-ns.before")" "$(cat "$evidence/initial-cgroup-ns.before")" > "$evidence/dockerd.log" 2>&1 & dockerd_pid=$!
dockerd_birth=$(birth_of "$dockerd_pid") || die 'dockerd birth unavailable'
docker_gid=$(getent group docker | cut -d: -f3)
[[ $docker_gid =~ ^[1-9][0-9]*$ ]] || die 'docker group absent'
for ((i=0; i<100; i++)); do
  if [[ -S /run/docker.sock && -z $QA_OWNED_SOCKET_IDENTITY ]] && owned_signal "$dockerd_pid" "$dockerd_birth" '/usr/bin/dockerd' "$qa_ns" 0 2>/dev/null; then
    qa_owned_socket_capture /run/docker.sock "$docker_gid" || die 'daemon socket ownership mismatch'
  fi
  kill -0 "$dockerd_pid" 2>/dev/null || die 'owned dockerd exited'
  if [[ -S /run/docker.sock && -f /run/docker.pid ]] && timeout 2 ip netns exec sabalanerp-qa docker --host unix:///run/docker.sock info --format '{{.ID}}' >/dev/null 2>&1; then break; fi
  sleep 0.2
done
[[ $(cat /run/docker.pid) == "$dockerd_pid" ]] || die 'daemon PID ownership mismatch'
[[ $(readlink "/proc/$dockerd_pid/exe") == /usr/bin/dockerd && $(readlink "/proc/$dockerd_pid/ns/net") == "$qa_ns" ]] || die 'daemon identity mismatch'
[[ $(stat -c '%u:%a' /run/docker.sock) == 0:* ]] || die 'daemon socket is not root-owned'
engine_id=$(ip netns exec sabalanerp-qa docker --host unix:///run/docker.sock info --format '{{.ID}}')
[[ $engine_id == 33f03eef-8f8d-45a2-af36-b98958ddacde ]] || die 'native Engine ID changed'
printf '%s\n' "$engine_id" > "$evidence/qa-engine-id"
printf '%s\n' "$qa_ns" > "$evidence/qa-netns.after"
readlink "/proc/$dockerd_pid/ns/net" > "$evidence/qa-daemon-netns.after"
printf '%s %s\n' "$dockerd_pid" "$(sed 's/^.*) //' "/proc/$dockerd_pid/stat" | awk '{print $20}')" > "$evidence/qa-daemon-pid-birth"
printf '%s\n' "$(tr '\0' ' ' < "/proc/$dockerd_pid/cmdline")" > "$evidence/qa-daemon-command"

ip netns exec sabalanerp-qa docker --host unix:///run/docker.sock network create --driver bridge --subnet 172.30.239.0/29 --gateway 172.30.239.1 --opt com.docker.network.bridge.name=brqa439 qa439-probe >/dev/null
owned_network=1
ip -n sabalanerp-qa link show brqa439 >/dev/null || die 'Docker bridge absent'
ip netns add sabalanerp-qa-probe; owned_peer=1
mkdir /etc/netns/sabalanerp-qa-probe
owned_peer_dir=1
printf 'nameserver 10.0.2.3\n' > /etc/netns/sabalanerp-qa-probe/resolv.conf
ip -n sabalanerp-qa link add vethqa439 type veth peer name vethp439
ip -n sabalanerp-qa link set vethqa439 master brqa439
ip -n sabalanerp-qa link set vethqa439 up
ip -n sabalanerp-qa link set vethp439 netns sabalanerp-qa-probe
ip -n sabalanerp-qa-probe addr add 172.30.239.2/29 dev vethp439
ip -n sabalanerp-qa-probe link set lo up
ip -n sabalanerp-qa-probe link set vethp439 up
ip -n sabalanerp-qa-probe route add default via 172.30.239.1

# The peer enters the Docker bridge without any image, container or service.
# TXT is queried from the publisher DNS; HTTPS verifies the publisher cert.
timeout 15 ip netns exec sabalanerp-qa-probe node --input-type=module -e '
import dns from "node:dns/promises";
const r = new dns.Resolver(); r.setServers(["10.0.2.3"]);
const txt = await r.resolveTxt("current.cvd.clamav.net");
if (!txt.length || !txt.some(parts => parts.join("").length)) process.exit(1);
console.log(JSON.stringify(txt));
' > "$evidence/clamav-publisher-txt" || die 'publisher TXT lookup failed from private bridge'
timeout 20 ip netns exec sabalanerp-qa-probe curl --noproxy '*' --proxy '' --proto '=https' --max-time 15 --silent --show-error --fail --head https://mirrors.fe.up.pt/pub/clamav/daily.cvd > "$evidence/clamav-https-head" || die 'direct FEUP ClamAV HTTPS failed from private bridge'

# Positive controls make the negative loopback checks meaningful. The only
# listener in each namespace binds 127.0.0.1 and is killed during teardown.
node -e 'require("http").createServer((_,r)=>r.end("initial-ok")).listen(43991,"127.0.0.1")' >/dev/null 2>&1 & initial_server=$!
initial_server_birth=$(birth_of "$initial_server") || die 'initial server birth unavailable'
ip netns exec sabalanerp-qa node -e 'require("http").createServer((_,r)=>r.end("qa-ok")).listen(43992,"127.0.0.1")' >/dev/null 2>&1 & qa_server=$!
qa_server_birth=$(birth_of "$qa_server") || die 'QA server birth unavailable'
sleep 0.3
[[ $(timeout 3 curl --noproxy '*' --silent http://127.0.0.1:43991) == initial-ok ]] || die 'initial loopback positive control failed'
[[ $(timeout 3 ip netns exec sabalanerp-qa curl --noproxy '*' --silent http://127.0.0.1:43992) == qa-ok ]] || die 'QA loopback positive control failed'
if timeout 3 ip netns exec sabalanerp-qa curl --noproxy '*' --silent http://10.0.2.2:43991 >/dev/null 2>&1; then die 'host loopback reachable through slirp'; fi
if timeout 3 ip netns exec sabalanerp-qa-probe curl --noproxy '*' --silent http://172.30.239.1:43992 >/dev/null 2>&1; then die 'QA loopback reachable from private peer'; fi
if timeout 3 curl --noproxy '*' --silent http://127.0.0.1:43992 >/dev/null 2>&1; then die 'QA loopback reachable from initial namespace'; fi
printf 'positive initial/QA listeners; negative slirp gateway, private peer, initial-to-QA\n' > "$evidence/loopback-controls"

printf 'PASS: bounded private bridge, direct ClamAV DNS/HTTPS and loopback controls; Desktop census, backup endpoint and teardown require independent verification\n'
if [[ $hold == --hold ]]; then
  owned_signal "$watchdog_pid" "$watchdog_birth" '/usr/bin/bash,/usr/bin/sleep' "$initial_ns" 15 || die 'watchdog identity changed'
  wait "$watchdog_pid" 2>/dev/null || :; watchdog_pid= watchdog_birth=
  umask 077
  owner_birth=$(sed 's/^.*) //' "/proc/$$/stat" | awk '{print $20}')
  daemon_birth=$(sed 's/^.*) //' "/proc/$dockerd_pid/stat" | awk '{print $20}')
  owner_record="$$ $owner_birth $dockerd_pid $daemon_birth $qa_ns"
  ( set -C; printf '%s\n' "$owner_record" > "$owner_file" ) || die 'owner record already exists'
  owner_file_ours=1
  printf 'HOLD: owner PID %s; private namespace %s; stop only with qa-netns-stop.sh\n' "$$" "$qa_ns"
  while owned_signal "$dockerd_pid" "$dockerd_birth" '/usr/bin/dockerd' "$qa_ns" 0 2>/dev/null && owned_signal "$slirp_pid" "$slirp_birth" '/usr/bin/slirp4netns' "$initial_ns" 0 2>/dev/null; do sleep 1; done
  die 'owned daemon or slirp exited'
fi
