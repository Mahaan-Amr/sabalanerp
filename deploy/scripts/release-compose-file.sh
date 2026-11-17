#!/bin/sh
set -eu
[ "$#" -eq 3 ] || exit 1
case "$1" in docker-compose.prod.yml|docker-compose.rehearsal.yml) ;; *) exit 1;; esac
case "$2" in 0|1) ;; *) exit 1;; esac
case "$3" in ''|legacy-scanner|no-malware-scan) ;; *) exit 1;; esac
if [ "$1" = docker-compose.rehearsal.yml ] && [ "$2" = 0 ] && [ "$3" = no-malware-scan ]; then
  printf '%s\n' docker-compose.rehearsal-scanner-free.yml
else
  printf '%s\n' "$1"
fi
