#!/bin/sh
# Immutable, nonsecret transport policy. The host owns network credentials.
set -eu
fail() { echo 'ClamAV acquisition transport differs from its immutable policy.' >&2; exit 1; }
mode="$(cat /usr/local/share/sabalan-clamav-transport)"
[ "${CLAMAV_ACQUISITION_TRANSPORT:-}" = "$mode" ] || fail
case "$mode" in
  direct)
    cmp -s /etc/clamav/freshclam.conf /usr/local/share/sabalan-clamav-freshclam.conf || fail
    ;;
  backup-host-http-v1)
    # Compare the whole file; no arbitrary proxy, URL, TLS or database option.
    { cat /usr/local/share/sabalan-clamav-freshclam.conf; printf '%s\n' 'HTTPProxyServer sabalan-clamav-egress' 'HTTPProxyPort 10808'; } |
      cmp -s - /etc/clamav/freshclam.conf || fail
    awk '{for(i=2;i<=NF;i++) if($i=="sabalan-clamav-egress") {count++; if($1!="172.17.0.1") bad=1}} END {exit (count!=1 || bad)}' /etc/hosts || fail
    ;;
  *) fail;;
esac
