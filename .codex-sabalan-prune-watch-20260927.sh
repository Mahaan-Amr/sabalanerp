#!/bin/sh
set -eu

deploy_pid=2261333
deploy_log=/var/log/sabalanerp-deploy-20260927-68219037-retry9.log
prune_log=/var/log/sabalanerp-builder-prune-20260927-retry9.log

while :; do
  state=$(ps -p "$deploy_pid" -o stat= 2>/dev/null || true)
  case "$state" in
    ''|Z*) exit 0 ;;
  esac
  if grep -Fq 'Production runtime environment validation passed.' "$deploy_log"; then
    docker builder prune --all --force > "$prune_log" 2>&1
    exit 0
  fi
  sleep 2
done
