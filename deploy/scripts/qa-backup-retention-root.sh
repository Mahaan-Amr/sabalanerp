#!/bin/sh
set -eu
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$#" -eq 0 ] && [ "$(id -u)" -eq 0 ] || exit 64
lock=/run/lock/sabalan-qa-backup-storage.lock
[ ! -L "$lock" ] || exit 1
exec 9>>"$lock"
[ "$(stat -Lc '%d:%i:%u:%h' "$lock")" = "$(stat -Lc '%d:%i:%u:%h' /proc/self/fd/9)" ] || exit 1
[ "$(stat -c %u "$lock")" -eq 0 ] && [ "$(stat -c %h "$lock")" -eq 1 ] || exit 1
[ -z "$(find "$lock" -prune -perm /022 -print)" ] || exit 1
flock -n 9 || exit 75
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin SABALAN_BACKUP_TARGET=qa \
  /usr/bin/node /opt/sabalanerp-qa-recovery/deploy/scripts/backup-checkpoint-retention.cjs
