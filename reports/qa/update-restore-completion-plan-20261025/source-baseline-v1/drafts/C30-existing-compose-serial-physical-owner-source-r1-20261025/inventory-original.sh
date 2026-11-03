#!/bin/sh
# Read-only frozen ORIGINAL file inventory. No stopped-container exec needed.
set -eu
ROOT='/var/lib/postgresql/data'
OWNED='serial-physical-OPERATION'
test "$(readlink -f "$ROOT")" = "$ROOT"
test ! -e "$ROOT/postmaster.pid"
PHASE=${1:-}
case "$PHASE" in initial|final) ;; *) exit 1;; esac
cd "$ROOT"
# No tablespace/WAL links into original or foreign data. PostgreSQL filenames
# are constrained here; unsupported names fail rather than being normalized.
(set -C; find . -xdev -path "./$OWNED" -prune -o -print > "$OWNED/inventory-$PHASE.paths")
(set -C; LC_ALL=C sort "$OWNED/inventory-$PHASE.paths" > "$OWNED/inventory-$PHASE.sorted")
while IFS= read -r name; do
 case "$name" in .) continue;; *[!a-zA-Z0-9_./-]*|*../*|*/../*) exit 1;; esac
 test ! -L "$name"
 if test -d "$name"; then
  printf 'D %s %s\n' "$name" "$(stat -c '%d:%i:%f:%u:%g:%h:%s:%y:%z' "$name")"
 else
  test -f "$name"
  test "$(stat -c '%h' "$name")" = '1'
  exec 3< "$name"
  named=$(stat -c '%d:%i:%f:%u:%g:%h:%s:%y:%z' "$name")
  held=$(stat -L -c '%d:%i:%f:%u:%g:%h:%s:%y:%z' /proc/self/fd/3)
  test "$held" = "$named"
  digest=$(sha256sum <&3); digest=${digest%% *}
  test "$(stat -L -c '%d:%i:%f:%u:%g:%h:%s:%y:%z' /proc/self/fd/3)" = "$held"
  test "$(stat -c '%d:%i:%f:%u:%g:%h:%s:%y:%z' "$name")" = "$named"
  exec 3<&-
  printf 'F %s %s %s\n' "$name" "$named" "$digest"
 fi
done < "$OWNED/inventory-$PHASE.sorted"
