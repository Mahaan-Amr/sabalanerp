#!/bin/sh
set -eu
# This is the forced SSH command for the operations key, not an interactive shell.
case "${SSH_ORIGINAL_COMMAND:-}" in
  'preflight '*) required_bytes="${SSH_ORIGINAL_COMMAND#preflight }" ;;
  *) exit 64 ;;
esac
case "$required_bytes" in ''|*[!0-9]*) exit 64;; esac
[ "${#required_bytes}" -le 16 ] || exit 64
exec /usr/bin/sudo -n /usr/local/sbin/sabalan-backup-preflight "$required_bytes"
