#!/bin/sh
set -eu
# Restricted SSH command for the QA operations key.
case "${SSH_ORIGINAL_COMMAND:-}" in
  'retain') exec /usr/bin/sudo -n /usr/local/sbin/sabalan-qa-backup-retention ;;
  'preflight '*) required_bytes="${SSH_ORIGINAL_COMMAND#preflight }" ;;
  *) exit 64 ;;
esac
case "$required_bytes" in ''|*[!0-9]*) exit 64;; esac
[ "${#required_bytes}" -le 16 ] || exit 64
exec /usr/bin/sudo -n /usr/local/sbin/sabalan-qa-backup-preflight "$required_bytes"
