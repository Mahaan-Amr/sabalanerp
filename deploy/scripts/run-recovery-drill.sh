#!/bin/sh
set -eu

# This script is installed on the independent drill host, never the production
# server. systemd supplies all secrets and isolated database identities.
: "${SABALANERP_DRILL_APP_ROOT:?SABALANERP_DRILL_APP_ROOT is required}"
: "${DEPLOYMENT_REMOTE_MOUNT:?DEPLOYMENT_REMOTE_MOUNT is required}"
: "${DEPLOYMENT_DRILL_DATABASE_MARKER:?DEPLOYMENT_DRILL_DATABASE_MARKER is required}"

metadata_path="$(find "${DEPLOYMENT_REMOTE_MOUNT}" -type f -name '*.sabrec.json' -printf '%T@ %p\n' \
  | sort -nr | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print; exit }')"
[ -n "${metadata_path}" ] || { echo "No remote deployment checkpoint sidecar is available for the drill." >&2; exit 1; }

DEPLOYMENT_DRILL_METADATA_PATH="${metadata_path}"
export DEPLOYMENT_DRILL_METADATA_PATH
cd "${SABALANERP_DRILL_APP_ROOT}/backend"
exec node dist/scripts/deployment-recovery-drill.js
