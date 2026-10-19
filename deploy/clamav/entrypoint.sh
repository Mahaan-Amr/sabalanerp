#!/bin/sh
set -eu
run_dir="${CLAMAV_RUN_DIRECTORY:-/run/sabalan-clamav}"
db_dir="${CLAMAV_DATABASE_DIRECTORY:-/var/lib/clamav}"
mkdir -p "$run_dir" "$db_dir" /var/log/clamav
chown clamav:clamav "$db_dir" /var/log/clamav
# State files are deliberately persistent across container recreation.
for name in .sabalan-updater-state .sabalan-updater-state.next .sabalan-updater.lock .sabalan-freshclam-result .sabalan-freshclam-result.next; do
  [ ! -L "$db_dir/$name" ] || { echo 'Unsafe updater state symlink.' >&2; exit 1; }
  [ ! -e "$db_dir/$name" ] || chown clamav:clamav "$db_dir/$name"
done
scanner=''; updater=''
rm -f "$run_dir/clamd.pid" "$run_dir/updater.pid"
stop() {
  trap - TERM INT EXIT
  for child in "$scanner" "$updater"; do [ -z "$child" ] || kill -TERM "$child" 2>/dev/null || true; done
  for child in "$scanner" "$updater"; do [ -z "$child" ] || wait "$child" 2>/dev/null || true; done
}
trap 'stop; exit 0' TERM INT
trap stop EXIT
clamd --foreground --config-file=/etc/clamav/clamd.conf &
scanner=$!
printf '%s\n' "$scanner" > "$run_dir/clamd.pid"
# Avoid racing initial bank load with FreshClam's load test or losing its RELOAD notification.
startup_deadline="$(( $(date +%s) + 300 ))"
until timeout 10 clamdscan --ping=1 >/dev/null 2>&1; do
  kill -0 "$scanner" 2>/dev/null || exit 1
  case "$(sed 's/.*) //' "/proc/$scanner/stat" | cut -d' ' -f1)" in Z) exit 1;; esac
  [ "$(date +%s)" -lt "$startup_deadline" ] || exit 1
  sleep 1 & wait $!
done
su -s /bin/sh clamav -c 'exec /usr/local/bin/sabalan-clamav-updater' &
updater=$!
printf '%s\n' "$updater" > "$run_dir/updater.pid"
while kill -0 "$scanner" 2>/dev/null && kill -0 "$updater" 2>/dev/null; do
  for pid in "$scanner" "$updater"; do
    case "$(if [ -r "/proc/$pid/stat" ]; then sed 's/.*) //' "/proc/$pid/stat" | cut -d' ' -f1; else ps -o stat= -p "$pid" 2>/dev/null || true; fi)" in ''|*Z*) exit 1;; esac
  done
  sleep 5 & wait $!
done
# An unexpected child exit must stop the container, rather than leave a green tail process.
sleep 30 & wait $!
exit 1
