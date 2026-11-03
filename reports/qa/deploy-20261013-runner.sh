#!/bin/sh
umask 077
cd /opt/sabalanerp || exit 1
log=reports/deploy/codex-update-20261013-main.log
exitfile=reports/deploy/codex-update-20261013-main.exit
if [ -e "$log" ] || [ -e "$exitfile" ]; then exit 2; fi
sh deploy/scripts/deploy.sh deploy/.env.prod >"$log" 2>&1
result=$?
printf '%s\n' "$result" >"$exitfile"
exit "$result"
