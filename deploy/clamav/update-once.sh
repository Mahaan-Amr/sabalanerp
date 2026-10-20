#!/bin/sh
set -eu
db_dir="${CLAMAV_DATABASE_DIRECTORY:-/var/lib/clamav}"
interval="${CLAMAV_UPDATE_INTERVAL_SECONDS:-7200}"
case "$interval" in ''|*[!0-9]*) exit 1;; esac
[ "$interval" -ge 3600 ] && [ "$interval" -le 86400 ] || exit 1
state="$db_dir/.sabalan-updater-state"
# flock is held for the complete FreshClam invocation, never just state writes.
exec 9>"$db_dir/.sabalan-updater.lock"
flock -n 9 || exit 75
attempted=0; succeeded=0; result=1; next=0
if [ -f "$state" ]; then
  read -r attempted succeeded result next < "$state"
  for value in "$attempted" "$succeeded" "$result" "$next"; do
    case "$value" in ''|*[!0-9]*) echo 'Invalid updater state; refusing to reset its schedule.' >&2; exit 1;; esac
  done
fi
now="$(date +%s)"
[ "$now" -ge "$next" ] || exit 0
# Reserve the next slot before running. Recreate/crash must not force another download.
next="$((now + interval))"
umask 077
printf '%s %s 1 %s\n' "$now" "$succeeded" "$next" > "$state.next"
sync -f "$state.next"
mv "$state.next" "$state"
sync -f "$db_dir"
result=0
log="$db_dir/.sabalan-freshclam-result"
freshclam --stdout --config-file=/etc/clamav/freshclam.conf --datadir="$db_dir" > "$log.next" 2>&1 || result=$?
mv "$log.next" "$log"
cat "$log"
# FreshClam 1.4.6 can return zero while honoring a previous CDN cooldown.
# Require explicit success for every official database, not just its exit status.
if [ "$result" -eq 0 ]; then
  if grep -Ev '^(WARNING: )?Cool-down expired, ok to try again\.$' "$log" | grep -Eiq 'cool.down|rate.limit|blocked|ERROR:|HTTP[^0-9]*(429|403)'; then result=17; fi
  for name in main daily bytecode; do
    if ! grep -Eq "(^|[[:space:]])$name[.](cvd|cld) (database is up-to-date|updated)" "$log"; then result=17; fi
  done
fi
finished="$(date +%s)"
if [ "$result" -eq 0 ]; then succeeded="$finished"; fi
printf '%s %s %s %s\n' "$now" "$succeeded" "$result" "$next" > "$state.next"
sync -f "$state.next"
mv "$state.next" "$state"
sync -f "$db_dir"
[ "$result" -eq 0 ] || echo "FreshClam failed (exit $result); cooldown and next scheduled slot retained." >&2
exit "$result"
