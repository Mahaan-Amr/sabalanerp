#!/bin/sh
# Read-only evidence for the official legacy daemon layout. No update or mutation.
set -eu
printf 'CLOCK\t%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$(cut -d' ' -f1 /proc/uptime)" "$(getconf CLK_TCK)" "$(id -u clamav)" "$(date +%z)"
for entry in /proc/[0-9]*; do
  name="$(cat "$entry/comm" 2>/dev/null || true)"
  case "$name" in freshclam|clamd)
    stat="$(sed 's/.*) //' "$entry/stat")"
    state="$(printf '%s\n' "$stat" | awk '{print $1}')"
    started="$(printf '%s\n' "$stat" | awk '{print $20}')"
    uid="$(awk '/^Uid:/{print $2}' "$entry/status")"
    arguments="$(base64 < "$entry/cmdline" | tr -d '\n')"
    printf 'PROCESS\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "${entry##*/}" "$uid" "$state" "$started" "$arguments"
  ;; esac
done
