#!/bin/sh
set -eu
while :; do
  /usr/local/bin/sabalan-clamav-update-once || true
  # This loop only inspects the persistent schedule. Downloads remain >=1 hour apart.
  sleep 30 & wait $!
done
