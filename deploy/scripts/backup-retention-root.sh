#!/bin/sh
set -eu
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# The operations account can select this fixed action only. The canonical
# owner validates bounded stdin and every recovery dependency under FD9.
[ "$#" -eq 0 ] && [ "$(id -u)" -eq 0 ] || exit 64
exec 9>>/run/lock/sabalan-backup-storage.lock
flock -n 9 || exit 75
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/node /opt/sabalanerp-recovery/deploy/scripts/backup-checkpoint-retention.cjs
