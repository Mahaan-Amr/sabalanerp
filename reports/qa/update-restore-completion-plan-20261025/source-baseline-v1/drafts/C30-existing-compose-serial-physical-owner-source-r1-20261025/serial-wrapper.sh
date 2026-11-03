#!/bin/sh
# Fixed SAME-service PID1. Generated root/arguments are pinned by host owner.
# No initialization, migration, arbitrary command, signal forwarding or cleanup.
set -eu
umask 077
ROOT='/var/lib/postgresql/data/serial-physical-OPERATION'
DATA="$ROOT/data"
STICKY=0
INTERRUPTED=0
trap 'STICKY=1; INTERRUPTED=1' INT TERM HUP
fail() { STICKY=1; printf '%s\n' 'SERIAL_WRAPPER_HELD' > "$ROOT/held"; }
private_root() {
 test "$(readlink -f "$ROOT")" = "$ROOT"
 test "$(stat -c '%u:%g:%a' "$ROOT")" = '0:70:710'
 test -f "$ROOT/restoration-obligation"
 test ! -L "$ROOT/restoration-obligation"
 test "$(stat -c '%u:%a:%h' "$ROOT/restoration-obligation")" = '0:600:1'
 test ! -e /var/lib/postgresql/data/postmaster.pid
}
request() {
 file="$ROOT/$1"
 test -f "$file" && test ! -L "$file" &&
 test "$(stat -c '%u:%a:%h:%s' "$file")" = '0:600:1:2' &&
 test "$(cat "$file")" = '1'
}
record() {
 # Exclusive immutable scalar state; no subprocess logs or business values.
 (set -C; printf '%s\n' "$2" > "$ROOT/$1") || { fail; return 1; }
 sync
}
private_root
# The canonical normal original server has stopped BEFORE wrapper activation.
# No original PGDATA initialization/start occurs in this process.
test "$#" -gt 3
test "$1" = '-D' && test "$2" = "$DATA"
record wrapper-ready 'READY_NO_POSTMASTER'
while ! request request-replay; do sleep 1; done
private_root
if test "$STICKY" -ne 0; then
 fail
 while ! request request-release-wrapper; do sleep 1; done
 exit 1
fi
# Source-owned host must save full frozen original inventory before this gate.
test -f "$ROOT/original-inventory-committed"
test ! -L "$ROOT/original-inventory-committed"
test "$(stat -c '%u:%a:%h' "$ROOT/original-inventory-committed")" = '0:600:1'
test "$(readlink -f "$DATA")" = "$DATA"
test "$(stat -c '%u:%g:%a' "$DATA")" = '70:70:700'
# Direct actual postmaster original, retained until wait observes its real exit.
set +e
/usr/local/bin/gosu postgres /usr/local/bin/postgres "$@" > "$ROOT/replay.stdout" 2> "$ROOT/replay.stderr" &
POSTMASTER=$!
record replay-started "$POSTMASTER" || fail
while ! request request-stop-replay; do sleep 1; done
# Smart stop waits for genuine sessions to close. No timeout sends a signal.
if /usr/local/bin/gosu postgres /usr/local/bin/pg_ctl -D "$DATA" -m smart -w stop > "$ROOT/stop.stdout" 2> "$ROOT/stop.stderr"; then
 STOP=0
else
 STOP=$?; fail
fi
# Even a failed stop observation never releases the original postmaster handle.
set +e
while :; do
 INTERRUPTED=0
 wait "$POSTMASTER"
 CODE=$?
 # A trapped signal can interrupt wait while the same child is still alive.
 if test "$INTERRUPTED" -ne 0; then STICKY=1; continue; fi
 break
done
record replay-closed "$CODE" || fail
test ! -e "$DATA/postmaster.pid" || fail
if test "$STICKY" -ne 0 || test "$STOP" -ne 0 || test "$CODE" -ne 0; then fail; fi
record wrapper-drained 'NO_POSTMASTER' || fail
# Host rechecks full ORIGINAL file inventory through live wrapper, persists it,
# and requests ordinary wrapper exit only after equality. PGDATA is untouched.
while ! request request-release-wrapper; do sleep 1; done
if test "$STICKY" -ne 0; then exit 1; fi
exit 0
