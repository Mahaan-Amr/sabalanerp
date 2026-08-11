#!/bin/sh
set -u

coordination_dir="${RECOVERY_COORDINATION_DIR:-/app/recovery-coordination}"
restart_marker="$coordination_dir/restart-inquiry"
stopped_marker="$coordination_dir/inquiry-stopped"
mkdir -p "$coordination_dir"
rm -f "$stopped_marker"

child_pid=""
shutdown_inquiry() {
  if [ -n "${child_pid}" ] && kill -0 "${child_pid}" 2>/dev/null; then
    kill -TERM "${child_pid}" 2>/dev/null || true
    wait "${child_pid}" 2>/dev/null || true
  fi
  touch "$stopped_marker"
  exit 0
}
trap shutdown_inquiry TERM INT

while true; do
  npm run db:push || exit 1
  npm run db:seed || exit 1
  npm run start -- -p 3001 &
  child_pid=$!
  recovery_restart=0

  while kill -0 "$child_pid" 2>/dev/null; do
    if [ -f "$restart_marker" ]; then
      recovery_restart=1
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      touch "$stopped_marker"
      while [ -f "$restart_marker" ]; do sleep 1; done
      rm -f "$stopped_marker"
      break
    fi
    sleep 1
  done

  if [ "$recovery_restart" -eq 0 ]; then
    wait "$child_pid" 2>/dev/null || true
    sleep 2
  fi
done
