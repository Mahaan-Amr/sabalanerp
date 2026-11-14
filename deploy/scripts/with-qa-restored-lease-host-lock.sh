#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || exit 64
[ "$PWD" = /opt/sabalanerp ] || exit 64
lock=/opt/sabalanerp/.deploy-state/deployment.lock
[ ! -L "$lock" ] && [ -f "$lock" ] || exit 64
exec 9>>"$lock"
flock --nonblock 9 || exit 75
export QA_RECONCILE_HOST_LOCK_HELD=true
exec node deploy/scripts/run-qa-restored-lease-reconcile.mjs "$@"
