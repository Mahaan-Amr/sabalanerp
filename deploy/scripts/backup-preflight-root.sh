#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$#" -eq 1 ] || exit 64
case "$1" in ''|*[!0-9]*) exit 64;; esac
[ "${#1}" -le 16 ] && [ "$(id -u)" -eq 0 ] || exit 64
exec 9>/run/lock/sabalan-backup-storage.lock
flock -n 9 || exit 75
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/node \
  /opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs \
  --mode apply --project sabalanerp-backup \
  --lock-file /run/lock/sabalan-backup-storage.lock --lock-fd 9 \
  --storage-root /srv/sabalanerp-recovery --required-bytes "$1" \
  --checkpoint-root /srv/sabalanerp-recovery/checkpoints \
  --audit /var/log/sabalanerp-backup/storage-cleanup.jsonl
