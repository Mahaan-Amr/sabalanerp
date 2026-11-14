#!/usr/bin/env bash
# Executed only inside ip netns exec's temporary mount namespace. iproute2
# remounts /sys and hides its cgroup2 submount; restore that mount here.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C
fail() { printf 'REFUSE cgroup child: %s\n' "$*" >&2; exit 1; }
[[ $# == 4 && $EUID == 0 && ${WSL_DISTRO_NAME:-} == sabalanerp-qa-debian ]] || fail 'pinned root host and arguments required'
evidence=$1 expected_netns=$2 initial_mntns=$3 expected_cgroupns=$4
source "$(dirname "$0")/qa-netns-cgroup-membership.sh"
umask 077
[[ $(dirname -- "$evidence") == /srv/sabalanerp-qa && -d $evidence && ! -L $evidence && $(stat -c '%u:%a' -- "$evidence") == 0:700 ]] || fail 'private evidence custody changed'
[[ $(readlink /proc/self/ns/net) == "$expected_netns" ]] || fail 'network namespace changed'
[[ $(readlink /proc/self/ns/mnt) != "$initial_mntns" ]] || fail 'mount namespace is not private'
[[ $(readlink /proc/self/ns/cgroup) == "$expected_cgroupns" ]] || fail 'cgroup namespace changed'
qa_cgroup_membership_matches /proc/self/cgroup "$evidence/initial-cgroup-membership.before" "$evidence/child-cgroup-membership.before" || fail 'cgroup membership changed'
root_propagation=$(findmnt -n -o PROPAGATION /)
[[ $root_propagation == slave || $root_propagation == private ]] || fail 'mount root can propagate to initial namespace'
[[ $(stat -fc '%T:%t' /sys/fs/cgroup) == sysfs:62656572 ]] || fail 'unexpected pre-mount cgroup path'

# The root tree was made recursively slave by iproute2, so this child-only
# propagation change and mount cannot travel back to WSL's initial mount view.
mount --make-private /sys || fail 'could not make child /sys private'
[[ $(findmnt -n -o PROPAGATION /sys) == private ]] || fail 'child /sys propagation is not private'
mount -t cgroup2 -o nosuid,nodev,noexec cgroup2 /sys/fs/cgroup || fail 'child-only cgroup2 mount failed'
[[ $(stat -fc '%T:%t' /sys/fs/cgroup) == cgroup2fs:63677270 ]] || fail 'child cgroup2 statfs mismatch'
read -r target fstype propagation < <(findmnt -n -o TARGET,FSTYPE,PROPAGATION /sys/fs/cgroup)
[[ $target == /sys/fs/cgroup && $fstype == cgroup2 && $propagation == private ]] || fail 'child cgroup2 mount identity mismatch'
[[ $(readlink /proc/self/ns/net) == "$expected_netns" && $(readlink /proc/self/ns/cgroup) == "$expected_cgroupns" ]] || fail 'namespace changed after mount'
qa_cgroup_membership_matches /proc/self/cgroup "$evidence/initial-cgroup-membership.before" "$evidence/child-cgroup-membership.after" || fail 'cgroup membership changed after mount'

stat -fc '%T:%t' /sys/fs/cgroup > "$evidence/child-cgroup-statfs"
findmnt -n -T /sys/fs/cgroup -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION > "$evidence/child-cgroup-mount"
readlink /proc/self/ns/mnt > "$evidence/child-mount-ns"
readlink /proc/self/ns/cgroup > "$evidence/child-cgroup-ns"
exec /usr/bin/dockerd --host=unix:///run/docker.sock --data-root=/var/lib/docker --pidfile=/run/docker.pid --bridge=none --iptables=true
