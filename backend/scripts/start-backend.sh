#!/bin/sh
set -eu
case "${BACKEND_RUNTIME_ROLE:-standalone}" in
  candidate) exec node dist/index.js ;;
  standalone)
    node dist/scripts/recovery-database-preflight.js
    exec node dist/index.js
    ;;
  *) echo BACKEND_RUNTIME_ROLE_INVALID >&2; exit 64 ;;
esac
