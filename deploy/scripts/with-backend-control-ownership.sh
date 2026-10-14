#!/bin/sh
set -eu
[ "$#" -gt 0 ] || { echo RUNTIME_COMMAND_REQUIRED >&2; exit 64; }
case "${BACKEND_RUNTIME_ROLE:-standalone}" in
  candidate|serving)
    unset BACKEND_CONTROL_LOCK_FD BACKEND_CONTROL_LOCK_FILE
    exec "$@"
    ;;
  standalone|control) ;;
  *) echo BACKEND_RUNTIME_ROLE_INVALID >&2; exit 64 ;;
esac
coordination="${RECOVERY_COORDINATION_DIR:-/app/recovery-coordination}"
case "$coordination" in /*) ;; *) echo RUNTIME_CONTROL_DIRECTORY_INVALID >&2; exit 64 ;; esac
umask 077
mkdir -p "$coordination"
lock="$coordination/deployment-runtime-control.lock"
[ ! -L "$lock" ] && { [ ! -e "$lock" ] || [ -f "$lock" ]; } || {
  echo RUNTIME_CONTROL_LOCK_INVALID >&2; exit 64;
}
# The executed runtime itself retains descriptor 9. There is no lease expiry,
# helper-process death, timeout takeover or lock-file deletion path.
exec 9>>"$lock"
flock --nonblock 9 || { echo RUNTIME_CONTROL_OWNERSHIP_UNAVAILABLE >&2; exit 75; }
export BACKEND_CONTROL_LOCK_FD=9
export BACKEND_CONTROL_LOCK_FILE="$lock"
exec "$@"
