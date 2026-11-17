#!/bin/sh
set -eu

# This script is installed on the independent drill host, never the production
# server. systemd supplies all secrets and isolated database identities.
: "${SABALANERP_DRILL_APP_ROOT:?SABALANERP_DRILL_APP_ROOT is required}"
: "${DEPLOYMENT_REMOTE_MOUNT:?DEPLOYMENT_REMOTE_MOUNT is required}"
: "${DEPLOYMENT_DRILL_DATABASE_MARKER:?DEPLOYMENT_DRILL_DATABASE_MARKER is required}"

metadata_path="${DEPLOYMENT_DRILL_METADATA_PATH:-}"
if [ -n "${metadata_path}" ]; then
  # A manual role-aware run selects the exact sidecar sealed into its plan.
  : "${DEPLOYMENT_DRILL_ROLE_TARGET_FILE:?An explicit sidecar requires a sealed role target}"
  : "${DEPLOYMENT_DRILL_ROLE_TARGET_SHA256:?An explicit sidecar requires a sealed role target hash}"
  remote_root="$(realpath -e -- "${DEPLOYMENT_REMOTE_MOUNT}")"
  [ -d "${remote_root}" ] && [ -f "${metadata_path}" ] && [ ! -L "${metadata_path}" ] \
    && [ "${metadata_path}" = "$(realpath -e -- "${metadata_path}")" ] || {
      echo "The explicit drill sidecar is not a canonical file." >&2; exit 1;
    }
  case "${metadata_path}" in
    "${remote_root}"/*.sabrec.json) ;;
    *) echo "The explicit drill sidecar is outside the independent checkpoint mount." >&2; exit 1 ;;
  esac
else
  metadata_path="$(find "${DEPLOYMENT_REMOTE_MOUNT}" -type f -name '*.sabrec.json' -printf '%T@ %p\n' \
    | sort -nr | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print; exit }')"
  [ -n "${metadata_path}" ] || { echo "No remote deployment checkpoint sidecar is available for the drill." >&2; exit 1; }
fi

DEPLOYMENT_DRILL_METADATA_PATH="${metadata_path}"
export DEPLOYMENT_DRILL_METADATA_PATH
cd "${SABALANERP_DRILL_APP_ROOT}/backend"
exec sh "${SABALANERP_DRILL_APP_ROOT}/deploy/scripts/with-backend-control-ownership.sh" node dist/scripts/deployment-recovery-drill.js
