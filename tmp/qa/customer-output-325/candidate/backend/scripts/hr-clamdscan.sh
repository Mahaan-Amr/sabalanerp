#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: hr-clamdscan.sh <file>" >&2
  exit 2
fi

exec clamdscan \
  --config-file=/etc/clamav/clamd-remote.conf \
  --stream \
  --no-summary \
  "$1"
