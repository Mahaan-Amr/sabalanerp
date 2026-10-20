#!/bin/sh
set -eu
fail() { echo "ClamAV unhealthy: $*" >&2; exit 1; }
run_dir="${CLAMAV_RUN_DIRECTORY:-/run/sabalan-clamav}"
db_dir="${CLAMAV_DATABASE_DIRECTORY:-/var/lib/clamav}"
interval="${CLAMAV_UPDATE_INTERVAL_SECONDS:-7200}"
case "$interval" in ''|*[!0-9]*) fail 'invalid update interval';; esac
[ "$interval" -ge 3600 ] && [ "$interval" -le 86400 ] || fail 'invalid update interval'
for name in clamd updater; do
  [ -f "$run_dir/$name.pid" ] || fail "$name PID is missing"
  pid="$(cat "$run_dir/$name.pid")"
  case "$pid" in ''|*[!0-9]*) fail "$name PID is invalid";; esac
  kill -0 "$pid" 2>/dev/null || fail "$name stopped"
  # kill -0 succeeds for zombies. Linux BusyBox ps does not support -p.
  state="$(if [ -r "/proc/$pid/stat" ]; then sed 's/.*) //' "/proc/$pid/stat" | cut -d' ' -f1; else ps -o stat= -p "$pid" 2>/dev/null || true; fi)"
  case "$state" in ''|*Z*) fail "$name is missing or defunct";; esac
done
[ -f "$db_dir/.sabalan-updater-state" ] || fail 'no verified update cycle'
read -r attempted succeeded result next < "$db_dir/.sabalan-updater-state"
for value in "$attempted" "$succeeded" "$result" "$next"; do
  case "$value" in ''|*[!0-9]*) fail 'invalid persisted updater state';; esac
done
now="$(date +%s)"
[ "$result" -eq 0 ] && [ "$succeeded" -gt 0 ] && [ "$succeeded" -ge "$attempted" ] || fail 'latest update failed or is incomplete'
[ "$now" -ge "$succeeded" ] && [ "$((now - succeeded))" -le "$((interval * 2))" ] || fail 'successful update evidence is stale'
log="$db_dir/.sabalan-freshclam-result"
[ -f "$log" ] || fail 'no successful FreshClam result evidence'
if grep -Eiq 'cool.down|rate.limit|blocked|ERROR:|HTTP[^0-9]*(429|403)' "$log"; then fail 'FreshClam reports cooldown or error'; fi
for name in main daily bytecode; do
  grep -Eq "(^|[[:space:]])$name[.](cvd|cld) (database is up-to-date|updated)" "$log" || fail "$name has no successful update evidence"
done
clamdscan --ping=1 >/dev/null 2>&1 || fail 'scanner is unavailable'
