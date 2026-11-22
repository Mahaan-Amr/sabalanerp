#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="${DEPLOYMENT_REPO_ROOT:-$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)}"
OPERATIONS_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
SYSTEM_RECOVERY_BACKUP_HOST="${SCRIPT_DIR}/system-recovery-backup-host.mjs"
SYSTEM_RECOVERY_BACKUP=0
SYSTEM_RECOVERY_OWNER_HANDOFF=0
SYSTEM_RECOVERY_OWNER_ACTION=BACKUP
case "${1:-}" in
  --system-recovery-owner)
    [ "$#" -eq 4 ] || exit 1
    exec node "${SYSTEM_RECOVERY_BACKUP_HOST}" launch-owner "${SCRIPT_DIR}/deploy.sh" "$2" "$3" "$4"
    ;;
  --system-recovery-owner-input)
    [ "$#" -eq 4 ] && [ ! -t 0 ] || exit 1
    case "$2" in /*) ;; *) exit 1;; esac
    case "$4" in BACKUP|RESTORE) ;; *) exit 1;; esac
    SYSTEM_RECOVERY_BACKUP=1
    SYSTEM_RECOVERY_OWNER_HANDOFF=1
    SYSTEM_RECOVERY_OWNER_ACTION="$4"
    SYSTEM_RECOVERY_OPERATION_ID="$3"
    shift
    set -- "$1" "$2"
    exec 8<&0 </dev/null
    ;;
  --system-recovery-backup)
    [ "$#" -eq 3 ] || { echo 'Usage: deploy.sh --system-recovery-backup <env> <operation-id>' >&2; exit 1; }
    exec node "${SYSTEM_RECOVERY_BACKUP_HOST}" launch "${SCRIPT_DIR}/deploy.sh" "$2" "$3"
    ;;
  --system-recovery-backup-input)
    [ "$#" -eq 3 ] && [ ! -t 0 ] || exit 1
    case "$2" in /*) ;; *) exit 1;; esac
    SYSTEM_RECOVERY_BACKUP=1
    SYSTEM_RECOVERY_OPERATION_ID="$3"
    shift
    exec 8<&0 </dev/null
    ;;
esac
CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK=0
CUSTOMER_ALLOCATION_ROLLBACK_EVIDENCE=""
if [ "${1:-}" = "--customer-allocation-current-data-rollback" ]; then
  shift
  [ "$#" -eq 2 ] || { echo 'Usage: deploy.sh --customer-allocation-current-data-rollback <env> <historical-GO-evidence-directory>' >&2; exit 1; }
  CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK=1
  CUSTOMER_ALLOCATION_ROLLBACK_EVIDENCE="$2"
fi
CAPTURE_ONLY=0
unset DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS
# Only the private deployment journal supplies a lease token to control containers.
export DEPLOYMENT_LEASE_TOKEN=""
PREBUILT_RELEASE=0
MAINTENANCE_IMAGE_SELECTION=0
unset DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX
unset DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY
PREBUILT_RELEASE_PLAN=""
PREBUILT_RELEASE_SHA256=""
if [ "${1:-}" = "--maintenance-images" ]; then
  MAINTENANCE_IMAGE_SELECTION=1
  PREBUILT_RELEASE=1; shift
  [ "$#" -eq 3 ] || { echo 'Usage: deploy.sh --maintenance-images <env> <private-plan> <sha256>' >&2; exit 1; }
  PREBUILT_RELEASE_PLAN="$2"
  PREBUILT_RELEASE_SHA256="$3"
fi
if [ "${1:-}" = "--prebuilt-release" ]; then
  PREBUILT_RELEASE=1; shift
  [ "$#" -eq 3 ] || { echo 'Usage: deploy.sh --prebuilt-release <env> <private-plan> <sha256>' >&2; exit 1; }
  PREBUILT_RELEASE_PLAN="$2"
  PREBUILT_RELEASE_SHA256="$3"
fi
if [ "${1:-}" = "--capture-only" ]; then CAPTURE_ONLY=1; shift; fi
ENV_FILE="${1:-deploy/.env.prod}"
CAPTURE_ONLY_PLAN="${2:-}"
if [ "${CAPTURE_ONLY}" -eq 1 ]; then [ "$#" -eq 2 ] && [ -n "${CAPTURE_ONLY_PLAN}" ] || { echo "Usage: deploy.sh --capture-only <env> <private-prebuilt-control-plan>" >&2; exit 1; }; fi
OFFLINE_CLAMAV_INCIDENT=0
OFFLINE_CLAMAV_MANIFEST=""
OFFLINE_CLAMAV_MANIFEST_SHA256=""
if [ "${1:-}" = "--offline-clamav-incident" ]; then
  shift
  [ "$#" -eq 3 ] || { echo 'Usage: deploy.sh --offline-clamav-incident <env> <private-source-manifest> <sha256>' >&2; exit 1; }
  ENV_FILE="$1"
  OFFLINE_CLAMAV_INCIDENT=1
  OFFLINE_CLAMAV_MANIFEST="$2"
  OFFLINE_CLAMAV_MANIFEST_SHA256="$3"
fi
DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-release}"
case "${DEPLOYMENT_MODE}" in
  release|configuration) ;;
  *) echo "DEPLOYMENT_MODE must be release or configuration." >&2; exit 1 ;;
esac
[ "${CAPTURE_ONLY}" -eq 0 ] || [ "${DEPLOYMENT_MODE}" = "release" ] || { echo "Capture-only cannot change configuration." >&2; exit 1; }
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${PREBUILT_RELEASE}" -eq 0 ] \
    && [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 0 ] && [ -z "${DEPLOYMENT_CLAMAV_TARGET_IMAGE:-}" ] || {
    echo 'Customer allocation current-data rollback requires a dedicated protected release.' >&2; exit 1;
  }
fi
CONFIGURATION_STATE="${REPO_ROOT}/.deploy-state/biometric-configuration.json"
SYSTEM_RECOVERY_BACKUP_INTENT="${REPO_ROOT}/.deploy-state/system-recovery-backup-active.json"
if [ "${SYSTEM_RECOVERY_BACKUP}" -eq 1 ]; then
  [ "${DEPLOYMENT_MODE}" = release ] && [ -z "${DEPLOYMENT_CLAMAV_TARGET_IMAGE:-}${DEPLOYMENT_CUSTOMER_ALLOCATION_EVIDENCE_DIR:-}" ] || {
    echo 'System Recovery backup requires the unchanged canonical production release.' >&2
    exit 1
  }
fi
CONFIGURATION_ACTIVE=0
DEPLOYMENT_CLAMAV_TARGET_IMAGE="${DEPLOYMENT_CLAMAV_TARGET_IMAGE:-}"
DEPLOYMENT_CLAMAV_REPAIR=false
[ -z "${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" ] || DEPLOYMENT_CLAMAV_REPAIR=true
if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] && [ "${DEPLOYMENT_MODE}" != release ]; then
  echo "ClamAV repair requires the complete protected release path." >&2; exit 1
fi
[ "${CAPTURE_ONLY}" -eq 0 ] || [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] || {
  echo 'Capture-only cannot change or repair the scanner.' >&2; exit 1
}
export DEPLOYMENT_CLAMAV_REPAIR DEPLOYMENT_CLAMAV_TARGET_IMAGE
DEPLOYMENT_CLAMAV_OPERATION="${DEPLOYMENT_CLAMAV_OPERATION:-repair}"
case "${DEPLOYMENT_CLAMAV_OPERATION}" in repair|incident-recovery) ;; *) echo 'Unknown ClamAV operation.' >&2; exit 1;; esac
if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" != true ]; then
  echo 'Incident recovery requires a qualified immutable ClamAV target.' >&2; exit 1
fi
export DEPLOYMENT_CLAMAV_OPERATION
if [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 1 ]; then
  [ "${DEPLOYMENT_MODE}" = release ] && [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || {
    echo 'Offline source delivery requires the complete ClamAV incident release.' >&2; exit 1;
  }
fi
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE_FILE="docker-compose.prod.yml"
LEGACY_SCANNER_COMPOSE="docker-compose.rollback-legacy.yml"
LEGACY_RELEASE_GRAPH=0
DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=""
ADVISORY_LOCK_KEY="741936425"
LOCK_FILE="${REPO_ROOT}/.deploy-state/deployment.lock"
ADVISORY_PID=""
ADVISORY_APPLICATION_NAME=""
MUTATION_STARTED=0
BOOTSTRAP=0
SESSION_PREPARED=0
MAINTENANCE_ACTIVE=0
CAPTURE_MAINTENANCE_PROVEN=0
FINISHED=0
DRAINED_EARLY=0
NATIVE_RUNTIME_CLOSURE_REQUIRED=0
LEGACY_BACKEND_SIGNAL_PENDING=0
DB_LEASE_ACQUIRED=0
PUBLIC_TRAFFIC_OPEN=0
DISPATCH_TRANSITION_REQUIRED=0
DISPATCH_TRANSITION_ATTESTED=0
ROLLBACK_ALREADY_ATTEMPTED=0
FINANCIAL_EVIDENCE_REFERRAL_REQUIRED=0
FINANCIAL_EVIDENCE_DRY_RUN_REPORT=""
FINANCIAL_EVIDENCE_REFERRAL_REPORT=""
if [ -n "${DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD:-}${DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD:-}" ]; then
  echo "Online bootstrap is unavailable in this protected maintenance runner." >&2
  exit 1
fi
if [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; then
  [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${DEPLOYMENT_MODE}" = release ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] \
    && [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 0 ] && [ "${SYSTEM_RECOVERY_BACKUP}" -eq 0 ] || {
    echo 'Maintenance image selection requires an ordinary full protected release.' >&2; exit 1;
  }
elif [ "${PREBUILT_RELEASE}" -eq 1 ]; then
  [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${DEPLOYMENT_MODE}" = release ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] \
    && [ -n "${DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD:-}" ] && [ -n "${DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD:-}" ] || {
    echo 'Prebuilt release requires the same original protected release pipes; configuration, capture and scanner repair cannot substitute.' >&2; exit 1;
  }
fi

# A requested activation must use the ordinary protected release path. The
# signed decision and its receipt are required for this invocation only.
unset DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256
ALLOCATION_EVIDENCE_DIR="${DEPLOYMENT_CUSTOMER_ALLOCATION_EVIDENCE_DIR:-}"
ALLOCATION_AUTHORITY_DIR="${DEPLOYMENT_CUSTOMER_ALLOCATION_AUTHORITY_DIR:-}"
ALLOCATION_APPROVER_SHA256="${DEPLOYMENT_CUSTOMER_ALLOCATION_APPROVER_SHA256:-}"
ALLOCATION_RELEASE_SCRIPT="${OPERATIONS_ROOT}/deploy/scripts/customer-allocation-release.mjs"
allocation_predecessor=""
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  [ -z "${ALLOCATION_EVIDENCE_DIR}" ] && [ -n "${ALLOCATION_AUTHORITY_DIR}" ] \
    && [ -n "${ALLOCATION_APPROVER_SHA256}" ] || {
    echo 'Customer allocation rollback requires closure credentials with activation unselected.' >&2
    exit 1
  }
elif [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  [ -n "${ALLOCATION_AUTHORITY_DIR}" ] \
    && [ -n "${ALLOCATION_APPROVER_SHA256}" ] && [ "${ALLOCATION_EVIDENCE_DIR}" != "${ALLOCATION_AUTHORITY_DIR}" ] \
    && [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ] \
    && { [ "${PREBUILT_RELEASE}" -eq 0 ] || [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; } \
    && [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 0 ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] || {
    echo 'Customer allocation activation requires private evidence and authority custody and an ordinary protected release.' >&2
    exit 1
  }
fi

cd "${REPO_ROOT}"
DEPLOYMENT_PRESERVED_CLAMAV_EVIDENCE_DIR="${REPO_ROOT}/.deploy-state"
export DEPLOYMENT_PRESERVED_CLAMAV_EVIDENCE_DIR

env_value() {
  key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command is missing: $1" >&2; exit 1; }
}

preserved_clamav_guard() {
  [ -n "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ] || return 0
  [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] || { echo 'Scanner preservation cannot repair or replace the scanner.' >&2; return 1; }
  if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
    # Keep the original child owned and renew the existing lease even if its
    # inspector deadline has refused qualification but descendants remain open.
    run_original_owned_with_heartbeat node "${OPERATIONS_ROOT}/deploy/scripts/preserved-clamav.mjs" "$@"
  else
    node "${OPERATIONS_ROOT}/deploy/scripts/preserved-clamav.mjs" "$@"
  fi
}

runtime_compose_file() {
  runtime_policy="${DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY:-}"
  if [ -n "${ALLOCATION_EVIDENCE_DIR}" ] || [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then runtime_policy=no-malware-scan; fi
  sh "${OPERATIONS_ROOT}/deploy/scripts/release-compose-file.sh" "${COMPOSE_FILE}" "${LEGACY_RELEASE_GRAPH}" "${runtime_policy}"
}

compose() {
  if [ -n "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ]; then
    preserved_clamav_guard compose "$@" || return 1
  fi
  run_compose "$@"
}

run_compose() {
  if [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ] && [ "${COMPOSE_FILE}" = docker-compose.prod.yml ]; then
    docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" -f "${LEGACY_SCANNER_COMPOSE}" "$@"
  else
    docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" "$@"
  fi
}

verify_prebuilt_release() {
  if [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; then
    set -- node "${OPERATIONS_ROOT}/deploy/scripts/maintenance-image-selection.mjs" "${1:-verify}" \
      "${PREBUILT_RELEASE_PLAN}" "${PREBUILT_RELEASE_SHA256}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" \
      "${COMPOSE_FILE}" "${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:-production}"
    if [ "$3" = bind ]; then
      : "${SESSION_HOST_PATH:?Maintenance image binding requires the canonical session path.}"
      DEPLOYMENT_MAINTENANCE_REPORT_DIR="${SESSION_HOST_PATH%/*}"
      export DEPLOYMENT_MAINTENANCE_REPORT_DIR
    fi
    if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
      DEPLOYMENT_PREBUILT_ENV_FILE="${ENV_FILE}" run_original_owned_with_heartbeat "$@"
    else
      DEPLOYMENT_PREBUILT_ENV_FILE="${ENV_FILE}" "$@"
    fi
    return $?
  fi
  DEPLOYMENT_PREBUILT_ENV_FILE="${ENV_FILE}" node "${OPERATIONS_ROOT}/deploy/scripts/prebuilt-release-plan.mjs" \
    "${PREBUILT_RELEASE_PLAN}" "${PREBUILT_RELEASE_SHA256}" "${REPO_ROOT}" "${OPERATIONS_ROOT}"
}

customer_allocation_retention_path() {
  coordination_mount="$(docker volume inspect sabalanerp_recovery_coordination --format '{{.Mountpoint}}')" || return 1
  case "${coordination_mount}" in /*) ;; *) return 1;; esac
  printf '%s\n' "${coordination_mount}/customer-allocation-active-retention.json"
}

verify_allocation_promotion_allowed() {
  if [ "${CAPTURE_ONLY}" -eq 1 ] || [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then return 0; fi
  allocation_control_state="$(compose exec -T postgres sh -c '
    exec env PGCONNECT_TIMEOUT=5 PGOPTIONS="-c statement_timeout=10000 -c default_transaction_read_only=on" \
      psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ' <<'SQL'
SELECT to_regclass('public.customer_allocation_release_control') IS NOT NULL AS present \gset
\if :present
SELECT state FROM public.customer_allocation_release_control WHERE id = 'grouped-allocation';
\else
SELECT 'ABSENT';
\endif
SQL
  )" || return 1
  case "${allocation_control_state}" in
    CLOSED|ABSENT) return 0 ;;
    ACTIVE) echo 'Close the active customer allocation release through verified current-data rollback before promoting different application images.' >&2 ;;
    *) echo 'The customer allocation release state could not be proven.' >&2 ;;
  esac
  return 1
}

select_customer_allocation_predecessor() {
  allocation_reference="$(customer_allocation_retention_path)" || return 1
  node "${OPERATIONS_ROOT}/deploy/scripts/lib/customer-allocation-current-data.mjs" select \
    "${CUSTOMER_ALLOCATION_ROLLBACK_EVIDENCE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
    "${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}" "${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}" "${allocation_reference}"
}

capture_remaining_seconds() {
  [ "${CAPTURE_ONLY}" -eq 1 ] && [ -n "${capture_pause_started:-}" ] || return 1
  node -e 'const elapsed=process.hrtime.bigint()-BigInt(process.argv[1]);if(elapsed<0n)process.exit(1);const left=(900000000000n-elapsed)/1000000000n;const requested=BigInt(process.argv[2]);if(left<=0n||requested<=0n)process.exit(1);process.stdout.write((left<requested?left:requested).toString())' "${capture_pause_started}" "$1"
}

start_release_services() {
  verify_database_role_pin || return 1
  wait_seconds="$1"
  if [ "${CAPTURE_ONLY}" -eq 1 ]; then
    [ "${MUTATION_STARTED}" -eq 0 ] && [ "${MAINTENANCE_ACTIVE}" -eq 1 ] && [ -n "${CAPTURE_ONLY_SNAPSHOT:-}" ] && [ -n "${capture_pause_started:-}" ] || return 1
    capture_wait_seconds="$(capture_remaining_seconds "${wait_seconds}")" || return 1
    if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
      run_original_owned_with_heartbeat node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" start-original \
        "${CAPTURE_ONLY_SNAPSHOT}" "${ENV_FILE}" "${REPO_ROOT}/${COMPOSE_FILE}" "${capture_wait_seconds}" "${capture_pause_started}" "${SESSION_HOST_PATH}"
    else
      node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" start-original \
        "${CAPTURE_ONLY_SNAPSHOT}" "${ENV_FILE}" "${REPO_ROOT}/${COMPOSE_FILE}" "${capture_wait_seconds}" "${capture_pause_started}" "${SESSION_HOST_PATH}"
    fi
    return $?
  fi
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ] && [ "${DEPLOYMENT_PHASE:-}" = ROLLBACK_STARTED ]; then
    echo 'Original incident state was restored; its known-unhealthy scanner cannot authorize reopening. Maintenance is retained.' >&2
    return 1
  fi
  if [ -n "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ]; then
    preserved_clamav_guard health || return 1
    compose up -d --no-deps --no-build --wait --wait-timeout "${wait_seconds}" postgres backend frontend inquiry nginx || return 1
  elif [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    # PostgreSQL stays on its existing container for this scanner operation.
    compose up -d --no-deps --no-build --wait --wait-timeout "${wait_seconds}" clamav backend frontend inquiry nginx || return 1
  elif [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] && [ "${MUTATION_STARTED}" -eq 0 ]; then
    # A failed preflight/checkpoint must restart the exact old container, never apply target config.
    compose start clamav || return 1
    compose up -d --no-deps --no-build --wait --wait-timeout "${wait_seconds}" postgres backend frontend inquiry nginx || return 1
  elif [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; then
    printf '%s\n' "${DEPLOYMENT_CLAMAV_IMAGE}" | grep -Eq '^sha256:[a-f0-9]{64}$' || return 1
    if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then
      compose up -d --no-build --wait --wait-timeout "${wait_seconds}" postgres clamav backend frontend inquiry nginx || return 1
    else
      # The scanner used by the retained release is never recreated here.
      legacy_scanner_id="$(compose ps -a -q clamav)" || return 1
      [ -n "${legacy_scanner_id}" ] || return 1
      [ "$(docker inspect --format '{{.Image}}' "${legacy_scanner_id}")" = "${DEPLOYMENT_CLAMAV_IMAGE}" ] || return 1
      if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ] && [ "${DEPLOYMENT_PHASE:-}" = RELEASE_STARTED ]; then
        [ "$(docker inspect --format '{{.Id}}' "${legacy_scanner_id}")" = "${CUSTOMER_ALLOCATION_RETAINED_SCANNER}" ] || return 1
      fi
      compose start --wait --wait-timeout "${wait_seconds}" clamav || return 1
      compose up -d --no-deps --no-build --wait --wait-timeout "${wait_seconds}" postgres backend frontend inquiry nginx || return 1
    fi
  else
    compose up -d --no-build --wait --wait-timeout "${wait_seconds}" postgres backend frontend inquiry nginx || return 1
  fi
  # Nginx resolves Compose service names when its workers start. Recreate it
  # after application containers have their final addresses so rollout and
  # rollback cannot reopen traffic through stale upstream IPs.
  compose up -d --no-deps --force-recreate --wait --wait-timeout "${wait_seconds}" nginx || return 1
  verify_database_role_pin "$(compose ps -q backend)" "$(compose ps -q postgres)"
}

run_backend() {
  # The marker writer uses the host journal and filesystem only. It must
  # still be able to close public traffic if a later pin check fails.
  if [ "$#" -ne 3 ] || [ "$1" != node ] || [ "$2" != dist/scripts/deployment-control.js ] || [ "$3" != maintenance-on ]; then
    verify_database_role_pin || return 1
  fi
  legacy_control_files=""
  if [ "${COMPOSE_FILE}" = docker-compose.prod.yml ] \
    && { [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || \
      { [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ] && [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; } || \
      { [ "${SYSTEM_RECOVERY_BACKUP}" -eq 1 ] && [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; }; }; then
    legacy_control_files="-f ${LEGACY_SCANNER_COMPOSE}"
  fi
  backend_pull_policy=""
  if [ "${SYSTEM_RECOVERY_BACKUP}" -eq 1 ]; then backend_pull_policy="--pull=never"; fi
  owner_container_option=""
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-}" = RESTORE ] && [ "$#" -ge 4 ] \
    && [ "$1" = sh ] && [ "$2" = scripts/with-backend-control-ownership.sh ] \
    && [ "$3" = node ] && [ "$4" = dist/scripts/system-recovery-owner.js ]; then
    owner_container_option="--name ${SYSTEM_RECOVERY_OWNER_CONTAINER}"
  fi
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-}" = RESTORE ] && [ "${DEPLOYMENT_GATE_MODE:-}" = APPLICATION_RECOVERY ] \
    && [ "$#" -eq 2 ] && [ "$1" = node ] && [ "$2" = dist/scripts/deployment-gates.js ]; then
    owner_container_option="--name ${SYSTEM_RECOVERY_GATES_CONTAINER}"
  fi
  DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_TARGET_BACKEND_IMAGE}" BACKEND_DB_CONNECTION_LIMIT=2 DATABASE_APPLICATION_NAME=sabalanerp-deployment \
    docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" ${legacy_control_files} run -T --rm --no-deps ${backend_pull_policy} ${owner_container_option} \
      --label "io.sabalan.deployment.id=${DEPLOYMENT_ID}" \
      -e "BACKEND_RUNTIME_ROLE=control" \
      -e DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX \
      -e DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX \
      -e "DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256=${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_REPAIR=${DEPLOYMENT_CLAMAV_REPAIR}" \
      -e "DEPLOYMENT_CLAMAV_OPERATION=${DEPLOYMENT_CLAMAV_OPERATION}" \
      -e "DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256=${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256=${DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_TARGET_IMAGE=${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" \
      -e "DEPLOYMENT_ID=${DEPLOYMENT_ID}" \
      -e "DEPLOYMENT_MODE=${DEPLOYMENT_MODE}" \
      -e "DEPLOYMENT_RELEASE_ID=${DEPLOYMENT_RELEASE_ID}" \
      -e "DEPLOYMENT_TARGET_COMMIT=${DEPLOYMENT_TARGET_COMMIT}" \
      -e DEPLOYMENT_LEASE_TOKEN \
      -e "DEPLOYMENT_OWNER=${DEPLOYMENT_OWNER}" \
      -e "DEPLOYMENT_PHASE=${DEPLOYMENT_PHASE:-}" \
      -e "DEPLOYMENT_RESULT=${DEPLOYMENT_RESULT:-}" \
      -e "DEPLOYMENT_ORIGINAL_RESULT=${DEPLOYMENT_ORIGINAL_RESULT:-}" \
      -e "DEPLOYMENT_GATE_MODE=${DEPLOYMENT_GATE_MODE:-}" \
      -e "SYSTEM_RECOVERY_POSTGRES_IMAGE_ID=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
      -e "SYSTEM_RECOVERY_OPERATION_ID=${SYSTEM_RECOVERY_OPERATION_ID:-}" \
      -e "SYSTEM_RECOVERY_RUNTIME_BEFORE=${SYSTEM_RECOVERY_RUNTIME_BEFORE:-}" \
      -e "SYSTEM_RECOVERY_RUNTIME_AFTER=${SYSTEM_RECOVERY_RUNTIME_AFTER:-}" \
      -e "DEPLOYMENT_LEASE_MS=1200000" \
      -e "DEPLOYMENT_CONTROL_IMAGE=${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_BACKEND_IMAGE=${DEPLOYMENT_BACKEND_IMAGE}" \
      -e DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT \
      -e "DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=${DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP:-false}" \
      -e "DEPLOYMENT_ALLOW_MISSING_PERFORMANCE_EXPORT_TABLE=${DEPLOYMENT_ALLOW_MISSING_PERFORMANCE_EXPORT_TABLE:-false}" \
      -e "DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_NGINX_IMAGE=${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}" \
      -e "DEPLOYMENT_REMOTE_RETENTION_RECEIPT=${DEPLOYMENT_REMOTE_RETENTION_RECEIPT:-}" \
      -e "DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256=${DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256:-}" \
      -e "INQUIRY_ALREADY_DRAINED=true" \
      -e "SYSTEM_RECOVERY_MUTATION_STARTED_NS=${SYSTEM_RECOVERY_MUTATION_STARTED_NS:-}" \
      deployment "$@"
}

dispatch_volume_transition() {
  transition_mode="$1"
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    [ "${transition_mode}" != stage ] || transition_mode=verify-mounted
  fi
  # Until the helper proves an already mounted volume, recovery must assume
  # the old backend could have unmounted layer files. A failed stage may have
  # allocated the new volume without returning its legacy result yet.
  DISPATCH_TRANSITION_REQUIRED=1
  transition_backend="$(compose ps -a -q backend)"
  [ -n "${transition_backend}" ] || { echo 'DISPATCH_TRANSITION_UNPROVEN' >&2; return 1; }
  transition_backend="$(docker inspect --format '{{.Id}}' "${transition_backend}")" || return 1
  transition_result="$(python3 "${OPERATIONS_ROOT}/deploy/scripts/dispatch-volume-transition.py" \
    "${transition_mode}" "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" \
    "${transition_backend}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}")" || return 1
  case "${transition_result}" in
    legacy) DISPATCH_TRANSITION_REQUIRED=1;;
    mounted) DISPATCH_TRANSITION_REQUIRED=0;;
    *) echo 'DISPATCH_TRANSITION_UNPROVEN' >&2; return 1;;
  esac
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ] && [ "${DISPATCH_TRANSITION_REQUIRED}" -ne 0 ]; then
    echo 'ClamAV incident recovery requires the existing dispatch storage mount.' >&2; return 1
  fi
  if [ "${transition_mode}" = attest ]; then DISPATCH_TRANSITION_ATTESTED=1; fi
}

# QA only: prove the remote bind in the controller, Docker daemon and the
# actual one-off deployment container. A local directory under an SSHFS mount
# in another mount namespace must never satisfy remote checkpoint admission.
assert_qa_remote_checkpoint_mount() {
  [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:-}" ] || return 0
  qa_mountinfo="$(run_backend node -e 'process.stdout.write(require("node:fs").readFileSync("/proc/self/mountinfo", "utf8"))')" || return 1
  printf '%s\n' "${qa_mountinfo}" | node "${OPERATIONS_ROOT}/deploy/scripts/qa-remote-mount-guard.mjs" \
    --container "${DEPLOYMENT_REMOTE_MOUNT_HOST}" "$(env_value DEPLOYMENT_BACKUP_HOST)"
}

run_backend_timed() {
  verify_database_role_pin || return 1
  duration="$1"
  shift
  legacy_control_files=""
  if [ "${COMPOSE_FILE}" = docker-compose.prod.yml ] \
    && { [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || \
      { [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ] && [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; }; }; then
    legacy_control_files="-f ${LEGACY_SCANNER_COMPOSE}"
  fi
  timeout "${duration}" env \
    DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
    BACKEND_DB_CONNECTION_LIMIT=2 \
    DATABASE_APPLICATION_NAME=sabalanerp-deployment \
    docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" ${legacy_control_files} run -T --rm --no-deps \
      --label "io.sabalan.deployment.id=${DEPLOYMENT_ID}" \
      -e "BACKEND_RUNTIME_ROLE=control" \
      -e DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX \
      -e DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX \
      -e "DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256=${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_REPAIR=${DEPLOYMENT_CLAMAV_REPAIR}" \
      -e "DEPLOYMENT_CLAMAV_OPERATION=${DEPLOYMENT_CLAMAV_OPERATION}" \
      -e "DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256=${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256=${DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_TARGET_IMAGE=${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" \
      -e "DEPLOYMENT_ID=${DEPLOYMENT_ID}" \
      -e "DEPLOYMENT_MODE=${DEPLOYMENT_MODE}" \
      -e "DEPLOYMENT_RELEASE_ID=${DEPLOYMENT_RELEASE_ID}" \
      -e "DEPLOYMENT_TARGET_COMMIT=${DEPLOYMENT_TARGET_COMMIT}" \
      -e DEPLOYMENT_LEASE_TOKEN \
      -e "DEPLOYMENT_OWNER=${DEPLOYMENT_OWNER}" \
      -e "DEPLOYMENT_PHASE=${DEPLOYMENT_PHASE:-}" \
      -e "DEPLOYMENT_LEASE_MS=1200000" \
      -e "DEPLOYMENT_CONTROL_IMAGE=${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_BACKEND_IMAGE=${DEPLOYMENT_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=${DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP:-false}" \
      -e "DEPLOYMENT_ALLOW_MISSING_PERFORMANCE_EXPORT_TABLE=${DEPLOYMENT_ALLOW_MISSING_PERFORMANCE_EXPORT_TABLE:-false}" \
      -e "DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_NGINX_IMAGE=${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}" \
      -e "DEPLOYMENT_REMOTE_RETENTION_RECEIPT=${DEPLOYMENT_REMOTE_RETENTION_RECEIPT:-}" \
      -e "DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256=${DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256:-}" \
      -e "INQUIRY_ALREADY_DRAINED=true" \
      deployment "$@"
}

run_backend_timed_with_heartbeat() {
  duration="$1"
  shift
  run_backend_timed "${duration}" "$@" </dev/null &
  timed_pid=$!
  heartbeat_elapsed=0
  while kill -0 "${timed_pid}" 2>/dev/null; do
    sleep 5
    heartbeat_elapsed=$((heartbeat_elapsed + 5))
    if [ "${heartbeat_elapsed}" -ge 60 ] && kill -0 "${timed_pid}" 2>/dev/null; then
      if ! control heartbeat; then
        kill -TERM "${timed_pid}" 2>/dev/null || true
        wait "${timed_pid}" 2>/dev/null || true
        echo "Deployment lease heartbeat failed while checkpoint work was active." >&2
        return 1
      fi
      heartbeat_elapsed=0
    fi
  done
  set +e
  wait "${timed_pid}"
  timed_status=$?
  set -e
  return "${timed_status}"
}

# A protected file guardian may own unresolved native work. Lease loss never
# kills/disowns this original child or turns a timeout into completion.
run_original_owned_with_heartbeat() {
  "$@" </dev/null &
  owned_pid=$!
  owned_heartbeat_elapsed=0
  owned_heartbeat_failed=0
  while kill -0 "${owned_pid}" 2>/dev/null; do
    sleep 5
    owned_heartbeat_elapsed=$((owned_heartbeat_elapsed + 5))
    if [ "${owned_heartbeat_elapsed}" -ge 60 ] && kill -0 "${owned_pid}" 2>/dev/null; then
      if ! control heartbeat >&2; then
        owned_heartbeat_failed=1
        echo "Protected original child remains owned; lease renewal failed." >&2
      fi
      owned_heartbeat_elapsed=0
    fi
  done
  set +e
  wait "${owned_pid}"
  owned_status=$?
  set -e
  [ "${owned_heartbeat_failed}" -eq 0 ] || return 1
  return "${owned_status}"
}

wait_for_cutover_approval() {
  approval_message="${3:-independently signed live cohort approval}"
  approval_path="$1"
  duration="$2"
  elapsed=0
  heartbeat_elapsed=0
  while [ ! -f "${approval_path}" ]; do
    [ "${elapsed}" -lt "${duration}" ] || {
      echo "Timed out waiting for the ${approval_message}." >&2
      return 1
    }
    sleep 5
    elapsed=$((elapsed + 5))
    heartbeat_elapsed=$((heartbeat_elapsed + 5))
    if [ "${heartbeat_elapsed}" -ge 60 ]; then
      control heartbeat || return 1
      heartbeat_elapsed=0
    fi
  done
}

protected_compose_config() {
  # The credential-bearing rendering goes only to private helper stdin.
  COMPOSE_PROFILES=deployment run_compose config --format json
}

database_role_pin_path() {
  case "${DEPLOYMENT_ID:-}" in ''|*[!a-zA-Z0-9_-]*) return 1;; esac
  printf '%s\n' "${REPO_ROOT}/.deploy-state/database-roles-${DEPLOYMENT_ID}.sha256"
}

verify_database_role_pin() {
  database_role_pin="$(database_role_pin_path)" || return 1
  protected_compose_config | node "${OPERATIONS_ROOT}/deploy/scripts/protected-database-role-pin.mjs" verify "${database_role_pin}" "$@"
}

run_customer_allocation_controller() {
  verify_database_role_pin || return 1
  allocation_mode="$1"
  allocation_control_image="$2"
  allocation_close_digest="${3:-}"
  if [ "${allocation_mode}" = activate ]; then
    set -- --mount "type=bind,src=${ALLOCATION_EVIDENCE_DIR},dst=/allocation-evidence,readonly"
  elif [ "${allocation_mode}" = close ]; then
    set --
  else
    return 1
  fi
  protected_compose_config | node "${ALLOCATION_RELEASE_SCRIPT}" input \
    "${allocation_predecessor}" "${ALLOCATION_AUTHORITY_DIR}" "${ALLOCATION_APPROVER_SHA256}" \
    "${allocation_mode}" "${allocation_request:-}" "${allocation_close_digest}" \
    | docker run --rm -i --pull never --network "${allocation_network}" \
      --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges \
      --label "io.sabalan.deployment.id=${DEPLOYMENT_ID}" \
      --mount "type=bind,src=${ALLOCATION_AUTHORITY_DIR},dst=/allocation-authority,readonly" "$@" \
      "${allocation_control_image}" node /app/operations/deploy/scripts/customer-allocation-release.mjs "${allocation_mode}"
}

control() {
  case "${1:-}" in prepare|maintenance-on) preserved_clamav_guard identity || return 1;; maintenance-off) preserved_clamav_guard health || return 1;; esac
  case "${1:-}" in
    # These responses contain the raw lease token. The controller keeps the
    # corresponding durable events in the host journal.
    prepare|acquire|bootstrap-enable|bootstrap-adopt|local-transition|heartbeat|transition|finish)
      run_backend node dist/scripts/deployment-control.js "$@" >/dev/null ;;
    *) run_backend node dist/scripts/deployment-control.js "$@" ;;
  esac
}

verify_incident_target() {
  node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" verify-incident "$1" \
    "${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}" "$2" ${3:+"$3"}
}

require_bound_incident_target() {
  actual_receipt_sha256="$(verify_incident_target "$@")" || return 1
  [ "${actual_receipt_sha256}" = "${DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256}" ] || {
    echo 'ClamAV incident target receipt changed after preflight.' >&2; return 1
  }
}

enter_maintenance() {
  verify_database_role_pin || return 1
  if [ "${CAPTURE_ONLY}" -eq 1 ]; then
    # Capture must restart the exact original Nginx container after the
    # checkpoint. Its mounted marker check takes effect without recreation.
    MAINTENANCE_ACTIVE=1
    control maintenance-on
  elif [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    require_bound_incident_target "${DEPLOYMENT_CLAMAV_READY_FILE}" "${incident_runway_seconds}" || return 1
    # Make the durable boundary own every subsequent runtime change. A crash
    # before the shell flag is set is detected through the marker and journal.
    control maintenance-on
    MAINTENANCE_ACTIVE=1
    compose up -d --no-deps --force-recreate nginx
  else
    compose up -d --no-deps --force-recreate nginx
    control maintenance-on
    MAINTENANCE_ACTIVE=1
  fi
  verify_public_maintenance || return 1
  if [ "${CAPTURE_ONLY}" -eq 1 ]; then CAPTURE_MAINTENANCE_PROVEN=1; fi
}

phase() {
  DEPLOYMENT_PHASE="$1"
  export DEPLOYMENT_PHASE
  if [ "${BOOTSTRAP}" -eq 1 ]; then
    control local-transition
  else
    control transition
    control heartbeat
  fi
}

remaining_mutation_seconds() {
  elapsed_now=$(( $(date +%s) - mutation_started_at ))
  remaining_now=$((900 - elapsed_now))
  [ "${remaining_now}" -gt 0 ] || { echo "Post-mutation verification exceeded 15 minutes." >&2; return 1; }
  echo "${remaining_now}"
}

image_of_service() {
  container_id="$(compose ps -q "$1")"
  [ -n "${container_id}" ] || { echo "The current $1 container is unavailable; a rollback release cannot be proven." >&2; return 1; }
  docker inspect --format '{{.Image}}' "${container_id}"
}

session_value() {
  node -e 'const fs=require("fs"); const value=process.argv[2].split(".").reduce((item,key)=>item?.[key], JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); if (value === undefined || value === null) process.exit(2); process.stdout.write(String(value));' "${SESSION_HOST_PATH}" "$1"
}

verify_public_maintenance() {
  domain="$(env_value DOMAIN)"
  inquiry_domain="$(env_value INQUIRY_DOMAIN)"
  for public_domain in "${domain}" "${inquiry_domain}"; do
    status="$(curl -k -sS -o /dev/null -w '%{http_code}' "https://${public_domain}/" || true)"
    [ "${status}" = "503" ] || { echo "Maintenance boundary was not proven for ${public_domain} (HTTP ${status})." >&2; return 1; }
  done
}

assert_native_runtime_closed() {
  # An interrupted legacy signal is a durable hold, never inferred closure.
  python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --assert-resolved \
    "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE:-}" \
    "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json" || return 1
  # Stream the frozen operations bundle's read-only checker, so configuration
  # mode can inspect an older image without requiring a newly built executable.
  # FD9 excludes every cooperating runtime/control owner during the check.
  run_backend sh -c '
    set -eu
    umask 077
    coordination="${RECOVERY_COORDINATION_DIR:-/app/recovery-coordination}"
    case "$coordination" in /*) ;; *) exit 64 ;; esac
    lock="$coordination/deployment-runtime-control.lock"
    [ ! -L "$lock" ] && { [ ! -e "$lock" ] || [ -f "$lock" ]; } || exit 64
    exec 9>>"$lock"
    flock --nonblock 9 || exit 75
    export BACKEND_CONTROL_LOCK_FD=9 BACKEND_CONTROL_LOCK_FILE="$lock"
    exec python3 - --assert-closed
  ' < "${OPERATIONS_ROOT}/deploy/scripts/backend-runtime-owner.py"
}

assert_original_legacy_still_stopped() {
  python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --assert-current-stopped \
    "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE:-}" \
    "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json" "${SESSION_HOST_PATH}"
}

drain_current_services() {
  if [ "${DB_LEASE_ACQUIRED}" -eq 0 ]; then
    python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --assert-unleased-drain-allowed \
      "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE:-}" \
      "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json" || return 1
  fi
  old_backend_container="$(compose ps -q backend)"
  old_backend_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${old_backend_container}")"
  NATIVE_RUNTIME_CLOSURE_REQUIRED=1
  if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
    [ "${MAINTENANCE_ACTIVE}" -eq 1 ] && [ "${DEPLOYMENT_PHASE}" = TRAFFIC_BLOCKED ] || return 1
    verify_public_maintenance || return 1
    control heartbeat || return 1
    LEGACY_BACKEND_SIGNAL_PENDING=1
    run_original_owned_with_heartbeat python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --forward \
      "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
      "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json" "${SESSION_HOST_PATH}" || return 1
    assert_original_legacy_still_stopped || return 1
  fi
  compose stop -t 300 frontend backend inquiry || return 1
  assert_native_runtime_closed || return 1
  if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then assert_original_legacy_still_stopped || return 1; fi
  remaining_old_sessions="$(compose exec -T postgres sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT count(*) FROM pg_stat_activity WHERE client_addr = '${old_backend_ip}'::inet\"")"
  [ "${remaining_old_sessions}" = "0" ] || { echo "The previous backend retained ${remaining_old_sessions} database sessions after drain." >&2; return 1; }
  utilization="$(compose exec -T postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT round(100.0 * count(*) / current_setting('"'"'max_connections'"'"')::int, 2) FROM pg_stat_activity"')"
  awk -v value="${utilization}" 'BEGIN { exit !(value < 85) }' || { echo "Database connection utilization remains ${utilization}% after drain; mutation is forbidden." >&2; return 1; }
}

drain_release_for_rollback() {
  rollback_backend_container="$(compose ps -q backend)" || return 1
  rollback_backend_ip=""
  if [ -n "${rollback_backend_container}" ]; then
    rollback_backend_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${rollback_backend_container}")" || return 1
  fi
  NATIVE_RUNTIME_CLOSURE_REQUIRED=1
  compose stop -t 300 frontend backend inquiry || return 1
  assert_native_runtime_closed || return 1
  if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then
    rollback_clamav_container="$(compose ps -aq clamav)" || return 1
    compose stop -t 60 clamav || return 1
    current_clamav_container="$(compose ps -aq clamav)" || return 1
    [ "${current_clamav_container}" = "${rollback_clamav_container}" ] || return 1
    if [ -n "${rollback_clamav_container}" ]; then
      rollback_clamav_status="$(docker inspect --format '{{.State.Status}}' "${rollback_clamav_container}")" || return 1
      case "${rollback_clamav_status}" in
        created|exited|dead) ;;
        *) echo 'ClamAV shutdown was not proven; rollback cannot restore its bank.' >&2; return 1 ;;
      esac
    fi
  fi
  if [ -n "${rollback_backend_ip}" ]; then
    rollback_sessions="$(compose exec -T postgres sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT count(*) FROM pg_stat_activity WHERE client_addr = '${rollback_backend_ip}'::inet\"")" || return 1
    [ "${rollback_sessions}" = "0" ] || { echo "The failed release retained ${rollback_sessions} database sessions; rollback promotion is unsafe." >&2; return 1; }
  fi
}

try_acquire_advisory() {
  lock_token="SABALAN_DEPLOYMENT_LOCK_${DEPLOYMENT_ID}"
  ADVISORY_APPLICATION_NAME="sabalan-lock-${DEPLOYMENT_ID}"
  rm -f "${REPO_ROOT}/.deploy-state/advisory-lock.log"
  docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" exec -T \
    -e "PGAPPNAME=${ADVISORY_APPLICATION_NAME}" postgres sh -c \
    "psql -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"SELECT pg_advisory_lock(741936425); SELECT '${lock_token}'; SELECT pg_sleep(21600);\"" \
    >"${REPO_ROOT}/.deploy-state/advisory-lock.log" 2>&1 &
  ADVISORY_PID=$!
  attempt=0
  while [ "${attempt}" -lt 10 ]; do
    attempt=$((attempt + 1))
    holder_count="$(compose exec -T postgres sh -c \
      "psql -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"SELECT count(*) FROM pg_locks lock JOIN pg_stat_activity activity ON activity.pid = lock.pid WHERE activity.application_name = '${ADVISORY_APPLICATION_NAME}' AND lock.locktype = 'advisory' AND lock.granted;\"" \
      2>/dev/null || printf '0')"
    if [ "${holder_count}" = "1" ] && kill -0 "${ADVISORY_PID}" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  kill "${ADVISORY_PID}" >/dev/null 2>&1 || true
  wait "${ADVISORY_PID}" >/dev/null 2>&1 || true
  release_advisory_database_session
  ADVISORY_PID=""
  return 1
}

release_advisory_database_session() {
  [ -n "${ADVISORY_APPLICATION_NAME}" ] || return 0
  compose exec -T postgres sh -c \
    "psql -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '${ADVISORY_APPLICATION_NAME}' AND pid <> pg_backend_pid();\"" \
    >/dev/null 2>&1 || true
  ADVISORY_APPLICATION_NAME=""
}

cleanup_locks() {
  if [ -n "${ADVISORY_PID}" ]; then
    kill "${ADVISORY_PID}" >/dev/null 2>&1 || true
    wait "${ADVISORY_PID}" >/dev/null 2>&1 || true
    ADVISORY_PID=""
  fi
  release_advisory_database_session
  flock -u 9 >/dev/null 2>&1 || true
}

cleanup_configuration_snapshot() {
  if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
    if node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" cleanup "${REPO_ROOT}"; then
      CONFIGURATION_ACTIVE=0
    else
      echo "Verified release retained; protected configuration state requires inspection before another deployment." >&2
    fi
  fi
}

switch_to_previous_images() {
  scanner_journal="${REPO_ROOT}/.deploy-state/customer-allocation-rollback-${DEPLOYMENT_ID}.scanner.json"
  if [ -e "${scanner_journal}" ] || [ -L "${scanner_journal}" ]; then
    [ "${DB_LEASE_ACQUIRED}" -eq 1 ] && [ "${DEPLOYMENT_PHASE:-}" = ROLLBACK_STARTED ] || return 1
    run_original_owned_with_heartbeat node "${OPERATIONS_ROOT}/deploy/scripts/lib/customer-allocation-current-data.mjs" \
      stop-staged-scanner "${scanner_journal}" || return 1
  fi
  if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
    node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" persist "${REPO_ROOT}" previous || return 1
    configuration_exports="$(node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" exports "${REPO_ROOT}" previous)" || return 1
    eval "${configuration_exports}"
  fi
  DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}"
  DEPLOYMENT_FRONTEND_IMAGE="${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}"
  DEPLOYMENT_INQUIRY_IMAGE="${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}"
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
  DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
  LEGACY_RELEASE_GRAPH=0
  [ -z "${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}" ] || LEGACY_RELEASE_GRAPH=1
  export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE
  # Values are journaled before mutation and emitted only after strict hash/digest validation.
  rollback_runtime_exports="$(node scripts/performance-deployment-environment.mjs restore "${SESSION_HOST_PATH}")" || return 1
  eval "${rollback_runtime_exports}"
}

clamav_unit_name() { printf 'clamav-checkpoint-%s' "${DEPLOYMENT_ID}"; }

capture_clamav_checkpoint() {
  [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || return 0
  compose stop -t 60 clamav || return 1
  clamav_container="$(compose ps -aq clamav)"
  [ "$(docker inspect --format '{{.State.Running}}' "${clamav_container}")" = false ] || return 1
  clamav_unit="${REPO_ROOT}/.deploy-state/$(clamav_unit_name)"
  mkdir -m 700 "${clamav_unit}"
  docker cp "${clamav_container}:/etc/clamav/." - >"${clamav_unit}/config.tar"
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    cp "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}" "${clamav_unit}/incident-snapshot.json"
  else
    cp "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}" "${clamav_unit}/rollback-proof.json"
  fi
  cp "${DEPLOYMENT_CLAMAV_READY_FILE}" "${clamav_unit}/target.json"
  cp "$(dirname "${DEPLOYMENT_CLAMAV_READY_FILE}")/target-bank.tar" "${clamav_unit}/target-bank.tar"
  docker cp "${clamav_unit}" "$(compose ps -aq backend):/app/recovery-coordination/"
  run_backend node scripts/clamav-checkpoint.mjs capture
}

restore_clamav_configuration() {
  [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || return 0
  # deployment-rollback has already authenticated this unit against the decrypted checkpoint.
  # Never start the old scanner with the target bank or target configuration.
  clamav_config="${REPO_ROOT}/.deploy-state/$(clamav_unit_name)-restore.tar"
  docker cp "$(compose ps -aq backend):/app/recovery-coordination/$(clamav_unit_name)/config.tar" "${clamav_config}" || return 1
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" != incident-recovery ]; then
    DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE="${REPO_ROOT}/.deploy-state/$(clamav_unit_name)-rollback-proof.json"
    docker cp "$(compose ps -aq backend):/app/recovery-coordination/$(clamav_unit_name)/rollback-proof.json" "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}" || return 1
    export DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE
  fi
  compose up --no-start --no-deps --no-build --pull never clamav || return 1
  docker cp -a - "$(compose ps -aq clamav):/etc/clamav/" <"${clamav_config}"
}

verify_clamav_repair_runtime() {
  [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] || return 0
  clamav_runtime_timeout=120
  if [ "${MUTATION_STARTED}" -eq 1 ] && [ "${DEPLOYMENT_PHASE:-}" != ROLLBACK_STARTED ]; then
    clamav_runtime_timeout="$(remaining_mutation_seconds)" || return 1
  fi
  if [ "${DEPLOYMENT_PHASE:-}" = ROLLBACK_STARTED ]; then
    timeout "${clamav_runtime_timeout}" node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" inspect-rollback "$(compose ps -q clamav)" "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}" >"${DEPLOYMENT_REPORT_DIR_HOST}/clamav-runtime-${DEPLOYMENT_ID}.json"
  else
    installed_receipt="${REPO_ROOT}/.deploy-state/$(clamav_unit_name)/target.json"
    set -- inspect "$(compose ps -q clamav)"
    if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
      set -- inspect "$2" "${installed_receipt}" "${DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256}"
    fi
    timeout "${clamav_runtime_timeout}" node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" "$@" >"${DEPLOYMENT_REPORT_DIR_HOST}/clamav-runtime-${DEPLOYMENT_ID}.json"
  fi
}

refresh_performance_database_identity() {
  identity_name="performance-database-${DEPLOYMENT_ID}.json"
  if [ "${MUTATION_STARTED}" -eq 1 ]; then
    identity_remaining="$(remaining_mutation_seconds)" || return 1
    run_backend_timed "${identity_remaining}" node dist/scripts/deployment-performance-identity.js "/app/deployment-reports/${identity_name}"
  else
    run_backend node dist/scripts/deployment-performance-identity.js "/app/deployment-reports/${identity_name}" --before-migrations
  fi
  identity_path="${DEPLOYMENT_REPORT_DIR_HOST}/${identity_name}"
  PERFORMANCE_RELEASE_SCHEMA_HASH="$(node -e 'const v=require("fs").readFileSync(process.argv[1],"utf8");const h=JSON.parse(v).schemaHash;if(!/^[a-f0-9]{64}$/.test(h))process.exit(1);process.stdout.write(h)' "${identity_path}")"
  PERFORMANCE_RELEASE_POLICY_HASH="$(node -e 'const v=require("fs").readFileSync(process.argv[1],"utf8");const h=JSON.parse(v).policyHash;if(!/^[a-f0-9]{64}$/.test(h))process.exit(1);process.stdout.write(h)' "${identity_path}")"
  export PERFORMANCE_RELEASE_SCHEMA_HASH PERFORMANCE_RELEASE_POLICY_HASH
  PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH="$(compose config | grep -v -e 'PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH:' -e 'PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH:' | node -e "const c=require('node:crypto');let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>process.stdout.write(c.createHash('sha256').update(b).digest('hex')))")"
  if [ -n "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ]; then
    PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH="$(preserved_clamav_guard infrastructure "${PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH}")" || return 1
  fi
  PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH="${PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH}"
  export PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH
}

finish_with_notification_result() {
  original_result="$1"
  DEPLOYMENT_RESULT="${original_result}"
  export DEPLOYMENT_RESULT
  if run_backend node dist/scripts/deployment-notify.js; then
    DEPLOYMENT_PHASE="${original_result}"
    export DEPLOYMENT_PHASE
  else
    DEPLOYMENT_PHASE="COMPLETED_WITH_NOTIFICATION_FAILURE"
    DEPLOYMENT_ORIGINAL_RESULT="${original_result}"
    export DEPLOYMENT_PHASE DEPLOYMENT_ORIGINAL_RESULT
  fi
  control finish
  FINISHED=1
}

host_backup_retention() {
  retention_stage="$1"
  case "${retention_stage}" in BEFORE_CHECKPOINT|AFTER_CHECKPOINT) ;; *) return 1;; esac
  run_backend node dist/scripts/deployment-retention-local.js export-holds "${retention_stage}" || return 1
  case "${DEPLOYMENT_REPORT_DIR_HOST}" in /*) retention_host_root="${DEPLOYMENT_REPORT_DIR_HOST}";; *) retention_host_root="${REPO_ROOT}/${DEPLOYMENT_REPORT_DIR_HOST#./}";; esac
  retention_name="remote-retention-${DEPLOYMENT_ID}-${retention_stage}.json"
  node "${OPERATIONS_ROOT}/deploy/scripts/backup-retention-host.mjs" "${ENV_FILE}" "${DEPLOYMENT_ID}" "${retention_stage}" "${retention_host_root}/${retention_name}" "${retention_host_root}/retention-holds-${DEPLOYMENT_ID}-${retention_stage}.json"
}

bind_host_backup_retention_receipt() {
  retention_stage="$1"
  case "${retention_stage}" in BEFORE_CHECKPOINT|AFTER_CHECKPOINT) ;; *) return 1;; esac
  case "${DEPLOYMENT_REPORT_DIR_HOST}" in /*) retention_host_root="${DEPLOYMENT_REPORT_DIR_HOST}";; *) retention_host_root="${REPO_ROOT}/${DEPLOYMENT_REPORT_DIR_HOST#./}";; esac
  retention_name="remote-retention-${DEPLOYMENT_ID}-${retention_stage}.json"
  DEPLOYMENT_REMOTE_RETENTION_RECEIPT="/app/deployment-reports/${retention_name}"
  DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto"),p=process.argv[1];const a=fs.lstatSync(p,{bigint:true});if(!a.isFile()||a.uid!==0n||a.nlink!==1n||(a.mode&511n)!==256n||a.size>8388608n||fs.realpathSync(p)!==p)process.exit(1);const raw=fs.readFileSync(p),b=fs.lstatSync(p,{bigint:true});for(const k of ["dev","ino","size","mtimeNs","ctimeNs"])if(a[k]!==b[k])process.exit(1);process.stdout.write(c.createHash("sha256").update(raw).digest("hex"))' "${retention_host_root}/${retention_name}")" || return 1
  export DEPLOYMENT_REMOTE_RETENTION_RECEIPT DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256
}

capture_only_services() {
  ids=""
  set -- backend frontend inquiry nginx postgres
  if [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; then set -- "$@" clamav; fi
  for service in "$@"; do
    id="$(compose ps -a -q "${service}")"; [ -n "${id}" ] || return 1
    ids="${ids} ${id}"
  done
  docker inspect ${ids}
}

verify_capture_only_configuration() {
  [ "${CAPTURE_ONLY}" -eq 1 ] || return 0
  observed_control="$(docker image inspect "${DEPLOYMENT_TARGET_BACKEND_IMAGE}" | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" plan "${CAPTURE_ONLY_PLAN}" "${OPERATIONS_ROOT}")" || return 1
  [ "${observed_control}" = "${DEPLOYMENT_TARGET_BACKEND_IMAGE}" ] || return 1
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${CAPTURE_ONLY_SNAPSHOT}" "${ENV_FILE}"
}

complete_capture_only() {
  [ "${CAPTURE_ONLY}" -eq 1 ] && [ "${MUTATION_STARTED}" -eq 0 ] && [ "${BOOTSTRAP}" -eq 0 ] && [ "${DB_LEASE_ACQUIRED}" -eq 1 ] || return 1
  assert_native_runtime_closed || return 1
  switch_to_previous_images || return 1
  start_release_services 300 || return 1
  verify_capture_only_configuration || return 1
  capture_remaining_seconds 900 >/dev/null || return 1
  DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_backend node dist/scripts/deployment-gates.js || return 1
  capture_remaining_seconds 900 >/dev/null || return 1
  control maintenance-off || return 1
  MAINTENANCE_ACTIVE=0
  PUBLIC_TRAFFIC_OPEN=1
  capture_pause_seconds="$(node -e 'const n=process.hrtime.bigint()-BigInt(process.argv[1]);if(n<0n)process.exit(1);process.stdout.write(((n+999999999n)/1000000000n).toString())' "${capture_pause_started}")"
  finish_with_notification_result ABORTED || return 1
  capture_qualification_code=0
  node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" complete "${CAPTURE_ONLY_SNAPSHOT}" "${CAPTURE_ONLY_OUTPUT}" "${capture_pause_seconds}" || capture_qualification_code=$?
  cleanup_locks
  trap - EXIT INT TERM
  echo "Fresh COMPLETE checkpoint captured; unchanged release reopened. Pause ${capture_pause_seconds}s. No deployment mutation or publication occurred."
  return "${capture_qualification_code}"
}

recover_failure() {
  exit_code="$1"
  trap - EXIT INT TERM
  echo "Deployment failed; entering deterministic recovery (exit ${exit_code})." >&2

  if [ "${SESSION_PREPARED}" -eq 0 ]; then
    if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
      node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" persist "${REPO_ROOT}" previous || exit 1
      node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" cleanup "${REPO_ROOT}" || exit 1
    fi
    cleanup_locks
    exit "${exit_code}"
  fi

  if [ "${PUBLIC_TRAFFIC_OPEN}" -eq 1 ]; then
    echo "Traffic had opened after all gates; rollback is forbidden because new writes may exist. Returning to maintenance." >&2
    control maintenance-on || true
    MAINTENANCE_ACTIVE=1
    DEPLOYMENT_PHASE=RECOVERY_REQUIRED
    DEPLOYMENT_RESULT=RECOVERY_REQUIRED
    export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
    control finish || true
    run_backend node dist/scripts/deployment-notify.js || true
    cleanup_locks
    echo "The proven release is retained with all writes; maintenance remains active pending journal recovery." >&2
    exit "${exit_code}"
  fi

  if [ "${LEGACY_BACKEND_SIGNAL_PENDING}" -eq 1 ]; then
    control maintenance-on || true
    MAINTENANCE_ACTIVE=1
    DEPLOYMENT_PHASE=RECOVERY_REQUIRED
    DEPLOYMENT_RESULT=RECOVERY_REQUIRED
    export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
    control finish || true
    cleanup_locks
    echo 'Legacy shutdown was not proven; no automatic reopen or rollback is permitted.' >&2
    exit "${exit_code}"
  fi

  if [ "${CAPTURE_ONLY}" -eq 1 ] && [ "${MAINTENANCE_ACTIVE}" -eq 1 ] \
    && [ "${CAPTURE_MAINTENANCE_PROVEN}" -eq 0 ]; then
    control maintenance-on || true
    DEPLOYMENT_PHASE=RECOVERY_REQUIRED
    DEPLOYMENT_RESULT=RECOVERY_REQUIRED
    export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
    if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then control finish || true; fi
    cleanup_locks
    echo 'Capture maintenance boundary was not proven; no automatic reopen is permitted.' >&2
    exit "${exit_code}"
  fi

  if [ "${ROLLBACK_ALREADY_ATTEMPTED}" -eq 1 ]; then
    control maintenance-on || true
    DEPLOYMENT_PHASE=RECOVERY_REQUIRED
    DEPLOYMENT_RESULT=RECOVERY_REQUIRED
    export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
    control finish || true
    run_backend node dist/scripts/deployment-notify.js || true
    cleanup_locks
    echo "An interrupted rollback is never replayed blindly; maintenance remains active for controlled recovery." >&2
    exit "${exit_code}"
  fi

  if [ "${MUTATION_STARTED}" -eq 0 ]; then
    if [ "${DISPATCH_TRANSITION_REQUIRED}" -eq 1 ] && [ "${DISPATCH_TRANSITION_ATTESTED}" -eq 0 ]; then
      if [ "${MAINTENANCE_ACTIVE}" -eq 1 ] || [ "${DEPLOYMENT_PHASE:-}" = MAINTENANCE_REQUESTED ] \
        || [ "${DEPLOYMENT_PHASE:-}" = TRAFFIC_BLOCKED ] || [ "${DEPLOYMENT_PHASE:-}" = SERVICES_DRAINED ]; then
        control maintenance-on || true
        MAINTENANCE_ACTIVE=1
        DEPLOYMENT_PHASE=RECOVERY_REQUIRED
        DEPLOYMENT_RESULT=RECOVERY_REQUIRED
        export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
        if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then control finish || true; fi
        cleanup_locks
        echo 'Unattested legacy dispatch layer; maintenance remains active for protected recovery.' >&2
        exit "${exit_code}"
      fi
      # The old backend has never been recreated or stopped. Preserve it as-is.
      if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
        DEPLOYMENT_PHASE=ABORTED DEPLOYMENT_RESULT=ABORTED control finish || true
      else
        control cancel-preflight || true
      fi
      cleanup_locks
      echo 'Unattested dispatch transition aborted before maintenance; original backend remains running.' >&2
      exit "${exit_code}"
    fi
    if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
      incident_boundary="$(control incident-boundary-state)" || { cleanup_locks; exit "${exit_code}"; }
      if [ "${incident_boundary}" = PRE_MAINTENANCE ]; then
        # Cancel only this operation. Do not recreate nginx, start the scanner,
        # drain services or turn maintenance on to recover an untouched release.
        if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
          DEPLOYMENT_PHASE=ABORTED DEPLOYMENT_RESULT=ABORTED control finish || true
        else
          control cancel-preflight || true
        fi
        cleanup_locks
        echo 'Incident preparation failed before maintenance; the running original was left untouched.' >&2
        exit "${exit_code}"
      fi
      [ "${incident_boundary}" = PROTECTED ] || { cleanup_locks; exit "${exit_code}"; }
      control maintenance-on || true
      MAINTENANCE_ACTIVE=1
      # No original data is changed, but a known-degraded release cannot be
      # claimed healthy merely because the remote checkpoint failed.
      DEPLOYMENT_PHASE=RECOVERY_REQUIRED
      DEPLOYMENT_RESULT=RECOVERY_REQUIRED
      export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
      if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then control finish || true; fi
      run_backend node dist/scripts/deployment-notify.js || true
      cleanup_locks
      echo 'Incident preparation failed within maintenance; original data is retained and recovery remains required.' >&2
      exit "${exit_code}"
    fi
    control maintenance-on || true
    MAINTENANCE_ACTIVE=1
    switch_to_previous_images
    if { [ "${NATIVE_RUNTIME_CLOSURE_REQUIRED}" -eq 0 ] || assert_native_runtime_closed; } \
      && start_release_services 300 \
      && verify_capture_only_configuration \
      && { [ "${CAPTURE_ONLY}" -eq 0 ] || capture_remaining_seconds 900 >/dev/null; } \
      && DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_backend node dist/scripts/deployment-gates.js \
      && { [ "${CAPTURE_ONLY}" -eq 0 ] || capture_remaining_seconds 900 >/dev/null; }; then
      if ! control maintenance-off; then
        DEPLOYMENT_PHASE=RECOVERY_REQUIRED; DEPLOYMENT_RESULT=RECOVERY_REQUIRED
        export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
        if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then control finish || true; fi
        cleanup_locks
        exit "${exit_code}"
      fi
      PUBLIC_TRAFFIC_OPEN=1
      MAINTENANCE_ACTIVE=0
      if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
        finish_with_notification_result ABORTED || true
      else
        control cancel-preflight || true
        DEPLOYMENT_RESULT=ABORTED run_backend node dist/scripts/deployment-notify.js || true
      fi
      cleanup_locks
      cleanup_configuration_snapshot
      echo "Deployment aborted before mutation; the unchanged previous release passed gates and was reopened." >&2
      exit "${exit_code}"
    fi
    DEPLOYMENT_PHASE=RECOVERY_REQUIRED
    DEPLOYMENT_RESULT=RECOVERY_REQUIRED
    export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
    if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
      control finish || true
    else
      echo "The preflight host journal is retained so the next invocation retries recovery before starting a new deployment." >&2
    fi
    run_backend node dist/scripts/deployment-notify.js || true
    cleanup_locks
    echo "The unchanged previous release did not pass mandatory gates; maintenance remains active." >&2
    exit "${exit_code}"
  fi

  echo "Mutation had started. Running the single permitted automatic rollback attempt." >&2
  if verify_database_role_pin \
    && drain_release_for_rollback \
    && {
      DEPLOYMENT_PHASE="ROLLBACK_STARTED"
      export DEPLOYMENT_PHASE
      if [ "${BOOTSTRAP}" -eq 1 ]; then control local-transition; else control transition; fi
    } \
    && verify_database_role_pin \
    && run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-rollback.js \
    && run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-finalize-recovery.js \
    && switch_to_previous_images; then
    restore_clamav_configuration || exit 1
    if start_release_services 300 \
      && verify_clamav_repair_runtime \
      && DEPLOYMENT_GATE_MODE=ROLLBACK run_backend node dist/scripts/deployment-gates.js; then
      referral_ready=1
      if [ "${FINANCIAL_EVIDENCE_REFERRAL_REQUIRED}" -eq 1 ]; then
        if ! run_backend node dist/scripts/reconcile-contract-financial-evidence.js \
          --refer-from="/app/deployment-reports/${FINANCIAL_EVIDENCE_DRY_RUN_REPORT}" \
          --output="/app/deployment-reports/${FINANCIAL_EVIDENCE_REFERRAL_REPORT}"; then
          referral_ready=0
          echo "Rollback succeeded, but durable financial-evidence referral failed; maintenance remains active." >&2
        fi
      fi
      if [ "${referral_ready}" -eq 1 ] && control maintenance-off; then
        MAINTENANCE_ACTIVE=0
        finish_with_notification_result ROLLED_BACK || true
        cleanup_locks
        cleanup_configuration_snapshot
        echo "Automatic rollback completed and the verified previous release was reopened." >&2
        exit "${exit_code}"
      fi
    fi
  fi

  DEPLOYMENT_PHASE="RECOVERY_REQUIRED"
  DEPLOYMENT_RESULT="RECOVERY_REQUIRED"
  export DEPLOYMENT_PHASE DEPLOYMENT_RESULT
  if [ "${BOOTSTRAP}" -eq 1 ]; then
    control finish || true
  else
    control finish || true
  fi
  run_backend node dist/scripts/deployment-notify.js || true
  cleanup_locks
  echo "Automatic rollback could not be proven. Maintenance remains active; controlled recovery is required." >&2
  exit "${exit_code}"
}

trap 'recover_failure $?' EXIT
trap 'exit 130' INT TERM

for command in git docker awk curl df flock grep mkdir node python3 timeout; do require_command "${command}"; done

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi
if [ ! -d .git ]; then
  echo "Deployment must run in the production git clone." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has local changes. Deployment stopped before any state change." >&2
  exit 1
fi
if [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:-}${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:-}" ]; then
  [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ] \
    && { [ "${PREBUILT_RELEASE}" -eq 0 ] || [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; } && [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 0 ] \
    && [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:-}" ] \
    && [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:-}" ] || {
    echo 'QA_REHEARSAL_MODE_INVALID' >&2; exit 1;
  }
  COMPOSE_FILE="$(node "${OPERATIONS_ROOT}/deploy/scripts/qa-rehearsal-target.mjs" \
    "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE}" "${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256}" \
    "${REPO_ROOT}" "${ENV_FILE}")" || exit 1
  [ "${COMPOSE_FILE}" = docker-compose.rehearsal.yml ] || { echo 'QA_REHEARSAL_COMPOSE_INVALID' >&2; exit 1; }
fi
if [ "${SYSTEM_RECOVERY_BACKUP}" -eq 1 ] && [ "${COMPOSE_FILE}" = docker-compose.prod.yml ]; then
  export COMPOSE_PROJECT_NAME=sabalanerp
fi
DEPLOYMENT_SECRET_DIR="$(env_value DEPLOYMENT_SECRET_DIR)"
DEPLOYMENT_REMOTE_MOUNT_HOST="$(env_value DEPLOYMENT_REMOTE_MOUNT_HOST)"
DEPLOYMENT_REPORT_DIR_HOST="$(env_value DEPLOYMENT_REPORT_DIR_HOST)"
DEPLOYMENT_OWNER="$(env_value DEPLOYMENT_OWNER)"
[ -n "${DEPLOYMENT_SECRET_DIR}" ] && [ -n "${DEPLOYMENT_REMOTE_MOUNT_HOST}" ] && [ -n "${DEPLOYMENT_REPORT_DIR_HOST}" ] && [ -n "${DEPLOYMENT_OWNER}" ] || {
  echo "Deployment storage, report, secret, and owner settings are mandatory." >&2
  exit 1
}
secret_path="${DEPLOYMENT_SECRET_DIR}/local-rollback-key"
[ -f "${secret_path}" ] || { echo "Missing deployment secret file: ${secret_path}" >&2; exit 1; }
[ "$(wc -c < "${secret_path}" | tr -d ' ')" -ge 32 ] || { echo "Deployment secret ${secret_path} is too short." >&2; exit 1; }
public_key_path="${DEPLOYMENT_SECRET_DIR}/remote-recovery-public.pem"
[ -f "${public_key_path}" ] && grep -q 'BEGIN PUBLIC KEY' "${public_key_path}" || {
  echo "Missing or invalid off-server recovery public key: ${public_key_path}" >&2
  exit 1
}
if [ "${SYSTEM_RECOVERY_BACKUP}" -eq 0 ] && [ "$(env_value BACKEND_DATABASE_USER)" = sabalan_application_runtime ]; then
  node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" verify \
    "$(realpath -- "${ENV_FILE}")" "$(realpath -- "${DEPLOYMENT_SECRET_DIR}/system-recovery-owner-private.pem")"
fi
[ -d "${DEPLOYMENT_REMOTE_MOUNT_HOST}" ] && [ -r "${DEPLOYMENT_REMOTE_MOUNT_HOST}" ] && [ -w "${DEPLOYMENT_REMOTE_MOUNT_HOST}" ] || {
  echo "Independent remote checkpoint mount is unavailable: ${DEPLOYMENT_REMOTE_MOUNT_HOST}" >&2
  exit 1
}

# This host file is bind-mounted into nginx. A restrictive checkout or copy
# mode must never turn the intended public 503 boundary into nginx's 403 page.
chmod 0644 "${REPO_ROOT}/deploy/nginx/maintenance.html"

mkdir -p "${REPO_ROOT}/.deploy-state"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another host deployment owns ${LOCK_FILE}; no state was changed." >&2
  exit 1
fi
case "${DEPLOYMENT_REPORT_DIR_HOST}" in
  /*) SESSION_HOST_PATH="${DEPLOYMENT_REPORT_DIR_HOST}/active-deployment-session.json" ;;
  *) SESSION_HOST_PATH="${REPO_ROOT}/${DEPLOYMENT_REPORT_DIR_HOST#./}/active-deployment-session.json" ;;
esac

if [ -e "${SYSTEM_RECOVERY_BACKUP_INTENT}" ] || [ -L "${SYSTEM_RECOVERY_BACKUP_INTENT}" ]; then
  echo 'An unresolved System Recovery backup owns the protected boundary. Preserve its intent and journal for controlled recovery.' >&2
  exit 1
fi
if [ "${SYSTEM_RECOVERY_BACKUP}" -eq 1 ]; then
  # shellcheck source=deploy/scripts/system-recovery-backup-host.sh
  . "${SCRIPT_DIR}/system-recovery-backup-host.sh"
  run_system_recovery_backup
  exit 0
fi

if [ -f "${SESSION_HOST_PATH}" ]; then
  maintenance_resume="$(node "${OPERATIONS_ROOT}/deploy/scripts/maintenance-image-selection.mjs" resume "${SESSION_HOST_PATH}")" || exit 1
  eval "${maintenance_resume}"
  preservation_resume="$(node "${OPERATIONS_ROOT}/deploy/scripts/preserved-clamav.mjs" resume "${SESSION_HOST_PATH}")" || exit 1
  eval "${preservation_resume}"
  preserved_clamav_guard identity || exit 1
  echo "An interrupted deployment journal was found; automatic recovery runs before any new deployment." >&2
  DEPLOYMENT_ID="$(session_value deploymentId)"
  verify_database_role_pin || exit 1
  DEPLOYMENT_RELEASE_ID="$(session_value releaseId)"
  DEPLOYMENT_TARGET_COMMIT="$(session_value targetCommit)"
  DEPLOYMENT_OWNER="$(session_value owner)"
  DEPLOYMENT_PHASE="$(session_value phase)"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="$(session_value controlImage)"
  DEPLOYMENT_LEASE_TOKEN="$(session_value leaseToken)" || exit 1
  [ -n "${DEPLOYMENT_LEASE_TOKEN}" ] || { echo 'Interrupted deployment recovery lacks its journaled lease token.' >&2; exit 1; }
  export DEPLOYMENT_LEASE_TOKEN
  incident_operation="$(session_value clamavOperation)"
  if [ "${incident_operation}" = incident-recovery ]; then
    DEPLOYMENT_CLAMAV_OPERATION=incident-recovery
    DEPLOYMENT_CLAMAV_REPAIR=true
    DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256="$(session_value clamavIncidentSnapshotSha256)"
    export DEPLOYMENT_CLAMAV_OPERATION DEPLOYMENT_CLAMAV_REPAIR DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256
  fi
  DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="$(session_value rollbackReleaseSet.backend)"
  DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="$(session_value rollbackReleaseSet.frontend)"
  DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="$(session_value rollbackReleaseSet.inquiry)"
  DEPLOYMENT_PREVIOUS_NGINX_IMAGE="$(session_value rollbackReleaseSet.nginx)"
  DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="$(session_value rollbackReleaseSet.postgres)"
  DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="$(session_value rollbackReleaseSet.clamav || [ "$?" -eq 2 ])"
  bootstrap_value="$(session_value bootstrap)"
  [ "${bootstrap_value}" = "true" ] && BOOTSTRAP=1 || BOOTSTRAP=0
  export DEPLOYMENT_ID DEPLOYMENT_RELEASE_ID DEPLOYMENT_TARGET_COMMIT DEPLOYMENT_OWNER DEPLOYMENT_PHASE DEPLOYMENT_TARGET_BACKEND_IMAGE
  export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE
  if [ -f "${CONFIGURATION_STATE}" ]; then
    CONFIGURATION_ACTIVE=1
    configuration_traffic_state="$(node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" recovery-state "${REPO_ROOT}" "${DEPLOYMENT_ID}")"
    if [ "${DEPLOYMENT_PHASE}" = "TRAFFIC_OPENED" ] || [ "${configuration_traffic_state}" = "open" ]; then
      configuration_exports="$(node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" exports "${REPO_ROOT}")"
      eval "${configuration_exports}"
      SESSION_PREPARED=1
      PUBLIC_TRAFFIC_OPEN=1
      recover_failure 1
    fi
  fi
  if [ -d "${REPO_ROOT}/.deploy-state/$(clamav_unit_name)" ] || docker cp "$(compose ps -aq backend):/app/recovery-coordination/$(clamav_unit_name)/unit.json" "${REPO_ROOT}/.deploy-state/clamav-resume-unit.json" 2>/dev/null; then
    DEPLOYMENT_CLAMAV_REPAIR=true
    LEGACY_RELEASE_GRAPH=1
    export DEPLOYMENT_CLAMAV_REPAIR
  fi
  SESSION_PREPARED=1
  [ "${DEPLOYMENT_PHASE}" = "PREFLIGHT" ] || DB_LEASE_ACQUIRED=1
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    # Establish the durable boundary before any ordinary resume path can
    # recreate/start the known-degraded release or acquire a new public state.
    case "${DEPLOYMENT_PHASE}" in
      PREFLIGHT|LEASE_ACQUIRED|MAINTENANCE_REQUESTED|TRAFFIC_BLOCKED|SERVICES_DRAINED|LOCAL_CHECKPOINT_VERIFIED|REMOTE_CHECKPOINT_VERIFIED)
        recover_failure 1
        ;;
    esac
  fi
  switch_to_previous_images
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    retained_postgres="$(compose ps -q postgres)" || retained_postgres=
    if [ -z "${retained_postgres}" ] || [ "$(docker inspect --format '{{.Image}} {{.State.Running}}' "${retained_postgres}")" != "${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE} true" ]; then
      echo 'Interrupted ClamAV incident recovery requires the running retained PostgreSQL container and its recorded image. The recovery journal is retained.' >&2
      cleanup_locks
      trap - EXIT INT TERM
      exit 1
    fi
  else
    compose up -d --no-deps postgres
  fi
  try_acquire_advisory || { echo "Interrupted deployment recovery cannot acquire its PostgreSQL advisory lease." >&2; exit 1; }
  control maintenance-on
  MAINTENANCE_ACTIVE=1
  drain_release_for_rollback || {
    echo 'Interrupted deployment drain could not be proven; maintenance and the recovery journal are retained.' >&2
    cleanup_locks
    trap - EXIT INT TERM
    exit 1
  }
  case "${DEPLOYMENT_PHASE}" in
    PREFLIGHT|LEASE_ACQUIRED|MAINTENANCE_REQUESTED|TRAFFIC_BLOCKED|SERVICES_DRAINED|LOCAL_CHECKPOINT_VERIFIED|REMOTE_CHECKPOINT_VERIFIED)
      if [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ]; then
        dispatch_volume_transition attest || { echo 'Interrupted dispatch transition remains in maintenance.' >&2; exit 1; }
      fi
      if start_release_services 300 \
        && DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_backend node dist/scripts/deployment-gates.js; then
        control maintenance-off
        MAINTENANCE_ACTIVE=0
        if [ "${DEPLOYMENT_PHASE}" = "PREFLIGHT" ]; then control cancel-preflight; else DEPLOYMENT_PHASE=ABORTED control finish; fi
        DEPLOYMENT_RESULT=ABORTED run_backend node dist/scripts/deployment-notify.js || true
        cleanup_locks
        trap - EXIT INT TERM
        cleanup_configuration_snapshot
        echo "Interrupted pre-mutation deployment was aborted only after the previous release passed every unchanged-release gate." >&2
        exit 1
      fi
      echo "The interrupted deployment remains fail-closed because the previous release did not pass all gates." >&2
      cleanup_locks
      trap - EXIT INT TERM
      exit 1
      ;;
    TRAFFIC_OPENED)
      PUBLIC_TRAFFIC_OPEN=1
      recover_failure 1
      ;;
    ROLLBACK_STARTED|RECOVERY_REQUIRED)
      ROLLBACK_ALREADY_ATTEMPTED=1
      recover_failure 1
      ;;
    *)
      MUTATION_STARTED=1
      recover_failure 1
      ;;
  esac
fi

if [ "${PREBUILT_RELEASE}" -eq 1 ]; then
  # Original-session recovery above precedes any newly supplied content plan.
  # No selected runtime, source fetch, storage cleanup or build has begun.
  prebuilt_exports="$(verify_prebuilt_release)" || exit 1
  eval "${prebuilt_exports}"
  preserved_clamav_guard health || exit 1
fi

if [ -f "${CONFIGURATION_STATE}" ]; then
  echo "Unfinished configuration state exists without a deployment session; inspect and recover it before a new release." >&2
  exit 1
fi

# Refuse missing/reused operations credentials before fetching or building.
# Interrupted releases above retain their existing recovery path.
node "${OPERATIONS_ROOT}/deploy/scripts/backup-retention-host.mjs" --inspect "${ENV_FILE}"

if [ "${DEPLOYMENT_MODE}" = "release" ] && [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${PREBUILT_RELEASE}" -eq 0 ] \
  && [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 0 ]; then
if [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 1 ]; then
  node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" offline-source-import "${OFFLINE_CLAMAV_MANIFEST}" "${OFFLINE_CLAMAV_MANIFEST_SHA256}" "${REPO_ROOT}" "${OPERATIONS_ROOT}"
else
if [ "${COMPOSE_FILE}" = docker-compose.rehearsal.yml ]; then
  echo 'Using the plan-pinned clean QA checkout; no remote source change.'
else
  echo "Fetching ${DEPLOY_REMOTE}/${DEPLOY_BRANCH} and requiring a fast-forward update..."
  git fetch --prune "${DEPLOY_REMOTE}"
  git checkout "${DEPLOY_BRANCH}"
  git pull --ff-only "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}"
  git submodule update --init --recursive
fi
fi
fi

DEPLOYMENT_TARGET_COMMIT="$(git rev-parse HEAD)"

if [ "${DEPLOYMENT_MODE}" = "release" ] && [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${PREBUILT_RELEASE}" -eq 0 ] \
  && [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 0 ]; then
backend_repository="$(env_value DEPLOYMENT_BACKEND_IMAGE_REPOSITORY)"
frontend_repository="$(env_value DEPLOYMENT_FRONTEND_IMAGE_REPOSITORY)"
inquiry_repository="$(env_value DEPLOYMENT_INQUIRY_IMAGE_REPOSITORY)"
[ -n "${backend_repository}" ] && [ -n "${frontend_repository}" ] && [ -n "${inquiry_repository}" ] || {
  echo "Immutable image repositories are mandatory." >&2
  exit 1
}
fi

DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="$(image_of_service backend)"
DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="$(image_of_service frontend)"
DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="$(image_of_service inquiry)"
DEPLOYMENT_PREVIOUS_NGINX_IMAGE="$(image_of_service nginx)"
DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="$(image_of_service postgres)"
previous_backend_id="$(compose ps -q backend)"
previous_upload_policy="$(docker inspect --format '{{index .Config.Labels "io.sabalan.release.upload-policy"}}' "${previous_backend_id}")"
case "${previous_upload_policy}" in
  no-malware-scan) ;;
  ''|'<no value>')
    LEGACY_RELEASE_GRAPH=1
    DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="$(image_of_service clamav)"
    if [ "${DEPLOYMENT_CLAMAV_REPAIR}" != true ] && [ -z "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ]; then
      legacy_scanner_id="$(compose ps -q clamav)"
      [ "$(docker inspect --format '{{.State.Health.Status}}' "${legacy_scanner_id}")" = healthy ] || {
        echo 'The previous release cannot be qualified for rollback because its scanner is unhealthy.' >&2; exit 1;
      }
    fi
    if [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ] && [ "${DEPLOYMENT_CLAMAV_REPAIR}" = false ] \
      && { [ "${COMPOSE_FILE}" = docker-compose.prod.yml ] || [ -n "${ALLOCATION_EVIDENCE_DIR}" ] \
        || [ "${DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY:-}" = no-malware-scan ]; } \
      && [ -z "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ]; then
      LEGACY_RELEASE_GRAPH=0
    fi
    ;;
  *) echo 'The previous release has an unknown upload policy.' >&2; exit 1 ;;
esac
export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE

if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  [ "${LEGACY_RELEASE_GRAPH}" -eq 0 ] && [ -n "${legacy_scanner_id:-}" ] && [ -z "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ] || {
    echo 'Customer allocation activation requires a scanner-free target and an exact running predecessor scanner.' >&2
    exit 1
  }
  allocation_predecessor="$(node "${ALLOCATION_RELEASE_SCRIPT}" observe-predecessor \
    "$(compose ps -q backend)" "$(compose ps -q frontend)" "$(compose ps -q inquiry)" \
    "${legacy_scanner_id}" "$(compose ps -q postgres)")" || exit 1
elif [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  allocation_predecessor="$(node "${ALLOCATION_RELEASE_SCRIPT}" observe-database \
    "$(compose ps -q backend)" "$(compose ps -q postgres)")" || exit 1
fi
if [ -n "${allocation_predecessor:-}" ]; then
  allocation_network="$(protected_compose_config | node "${ALLOCATION_RELEASE_SCRIPT}" prepare \
    "${allocation_predecessor}" "${ALLOCATION_AUTHORITY_DIR}" "${ALLOCATION_APPROVER_SHA256}")" || exit 1
fi

DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT="$(docker inspect "$(compose ps -q backend)" | node scripts/performance-deployment-environment.mjs capture)"
export DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT

if [ "${DEPLOYMENT_MODE}" = "configuration" ] || [ "${CAPTURE_ONLY}" -eq 1 ]; then
  existing_exports="$(capture_only_services | node "${OPERATIONS_ROOT}/scripts/deployment-existing-release.mjs")"
  eval "${existing_exports}"
fi
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  customer_allocation_predecessor="$(select_customer_allocation_predecessor)" || exit 1
  eval "${customer_allocation_predecessor}"
fi
if [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; then
  # PostgreSQL keeps 63 application_name bytes; sabalan-lock-deploy- uses 20.
  # Keep the full source commit in APP_COMMIT and the original session binding.
  DEPLOYMENT_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')-${DEPLOYMENT_MODE}"
else
  DEPLOYMENT_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "${DEPLOYMENT_TARGET_COMMIT}" | cut -c1-12)-${DEPLOYMENT_MODE}"
fi
DEPLOYMENT_ID="deploy-${DEPLOYMENT_RELEASE_ID}"
APP_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
export DEPLOYMENT_TARGET_COMMIT DEPLOYMENT_RELEASE_ID DEPLOYMENT_ID DEPLOYMENT_OWNER APP_COMMIT
database_role_pin="$(database_role_pin_path)" || exit 1
protected_compose_config | node "${OPERATIONS_ROOT}/deploy/scripts/protected-database-role-pin.mjs" pin \
  "${database_role_pin}" "${previous_backend_id}" "$(compose ps -q postgres)" || exit 1
verify_allocation_promotion_allowed || exit 1
if [ "${DEPLOYMENT_MODE}" = "configuration" ]; then
  sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" 0 0 "${COMPOSE_FILE}"
fi

checkpoint_timeout="$(env_value DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS)"
checkpoint_timeout="${checkpoint_timeout:-3600}"
case "${checkpoint_timeout}" in
  *[!0-9]*|'') echo "DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS must be an integer." >&2; exit 1 ;;
esac
[ "${checkpoint_timeout}" -ge 600 ] && [ "${checkpoint_timeout}" -le 14400 ] || {
  echo "DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS must be between 600 and 14400 seconds." >&2
  exit 1
}
if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    shipment_cutover_required="$(env_value SHIPMENT_STATEMENT_CUTOVER_REQUIRED)"
    case "${shipment_cutover_required:-false}" in
      false) ;;
      *) echo 'ClamAV incident recovery requires SHIPMENT_STATEMENT_CUTOVER_REQUIRED=false.' >&2; exit 1 ;;
    esac
    [ "${DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP:-false}" = false ] || {
      echo 'ClamAV incident recovery requires an existing deployment schema.' >&2; exit 1
    }
    [ -f "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE:-}" ] || { echo 'A fresh degraded-instance snapshot is required before incident maintenance.' >&2; exit 1; }
    [ -z "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE:-}" ] || { echo 'Incident evidence must never be presented as a healthy rollback proof.' >&2; exit 1; }
    node "${OPERATIONS_ROOT}/scripts/clamav-incident-recovery.mjs" verify "$(compose ps -q clamav)" "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}"
    DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256="$(node --input-type=module -e 'import {fileDigest} from "./scripts/clamav-release-readiness.mjs"; console.log(await fileDigest(process.argv[1]));' "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}")"
    export DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256
  else
  [ -f "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE:-}" ] || { echo "A separately reviewed current rollback rehearsal proof is required before maintenance." >&2; exit 1; }
  mkdir -p "${DEPLOYMENT_REPORT_DIR_HOST}"
  node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" rollback-proof "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}" "${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
  timeout 120 node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" inspect-rollback "$(compose ps -q clamav)" "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}" >"${DEPLOYMENT_REPORT_DIR_HOST}/clamav-rollback-preflight-${DEPLOYMENT_ID}.json"
  DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256="$(node --input-type=module -e 'import {fileDigest} from "./scripts/clamav-release-readiness.mjs"; console.log(await fileDigest(process.argv[1]));' "${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE}")"
  export DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256
  fi
  node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" scope "${DEPLOYMENT_CLAMAV_BASE_COMMIT:-}"
  [ -f "${DEPLOYMENT_CLAMAV_READY_FILE:-}" ] || { echo "A reviewed, current ClamAV staging receipt is required before maintenance." >&2; exit 1; }
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    # Reserve the full checkpoint and 900-second mutation bounds, plus time
    # for the protected drain, capture and retention outside the checkpoint job.
    incident_runway_seconds=$((checkpoint_timeout + 900 + 600))
    DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256="$(verify_incident_target "${DEPLOYMENT_CLAMAV_READY_FILE}" "${incident_runway_seconds}")"
    export DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256
  else
    node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" verify "${DEPLOYMENT_CLAMAV_READY_FILE}" "${DEPLOYMENT_CLAMAV_TARGET_IMAGE}"
  fi
  [ "$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_CLAMAV_TARGET_IMAGE}")" = "${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" ] || {
    echo "The ClamAV target must be the locally available immutable image id from staging." >&2; exit 1;
  }
fi

if [ "${DEPLOYMENT_MODE}" = "release" ] && [ "${CAPTURE_ONLY}" -eq 0 ]; then
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  dispatch_volume_transition stage
  sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" 0 0 "${COMPOSE_FILE}"
  [ "$(select_customer_allocation_predecessor)" = "${customer_allocation_predecessor}" ] || exit 1
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
  DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE=""
  export DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE
  compose config --quiet
elif [ "${PREBUILT_RELEASE}" -eq 0 ]; then
backend_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}")"
frontend_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}")"
inquiry_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}")"
docker_required_bytes=$((backend_image_size + frontend_image_size + inquiry_image_size + 1073741824))

# A failed cleanup or capacity proof leaves the current release serving users.
# The helper rechecks recovery/image references and holds the same host lock.
dispatch_volume_transition stage
sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" "${docker_required_bytes}" 0 "${COMPOSE_FILE}"
docker_root="$(docker info --format '{{.DockerRootDir}}')"
docker_available_kb="$(df -Pk "${docker_root}" | awk 'NR==2 {print $4}')"
docker_available_bytes=$((docker_available_kb * 1024))
[ "${docker_available_bytes}" -ge "${docker_required_bytes}" ] || {
  echo "Immutable image build needs ${docker_required_bytes} bytes but only ${docker_available_bytes} are safely available." >&2
  exit 1
}

DEPLOYMENT_BACKEND_IMAGE="${backend_repository}:${DEPLOYMENT_TARGET_COMMIT}"
DEPLOYMENT_FRONTEND_IMAGE="${frontend_repository}:${DEPLOYMENT_TARGET_COMMIT}"
DEPLOYMENT_INQUIRY_IMAGE="${inquiry_repository}:${DEPLOYMENT_TARGET_COMMIT}"
# Each built browser image owns its compiled Next/RSC/asset identity. It must
# survive later environment changes and never use a cross-tab version cookie.
DEPLOYMENT_BROWSER_BUILD_ID="erp_$(printf '%s' "${DEPLOYMENT_RELEASE_ID}" | tr '[:upper:]' '[:lower:]')"
export DEPLOYMENT_BROWSER_BUILD_ID
if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
else
  DEPLOYMENT_NGINX_IMAGE="nginx:1.27-alpine"
fi
DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE

PERFORMANCE_SOURCE_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
PERFORMANCE_SOURCE_HASH="$(node --input-type=module -e 'import { performanceSourceHash } from "./scripts/performance-source-identity.mjs"; console.log(await performanceSourceHash());')"
export PERFORMANCE_SOURCE_COMMIT PERFORMANCE_SOURCE_HASH
RECOVERY_POSTGRES_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_POSTGRES_IMAGE}")"
case "${RECOVERY_POSTGRES_IMAGE_ID}" in sha256:????????????????????????????????????????????????????????????????) ;; *) exit 1;; esac
RECOVERY_POSTGRES_IMAGE="sabalanerp-recovery-postgres:${RECOVERY_POSTGRES_IMAGE_ID#sha256:}"
docker tag "${RECOVERY_POSTGRES_IMAGE_ID}" "${RECOVERY_POSTGRES_IMAGE}"
[ "$(docker image inspect --format '{{.Id}}' "${RECOVERY_POSTGRES_IMAGE}")" = "${RECOVERY_POSTGRES_IMAGE_ID}" ] || exit 1
export RECOVERY_POSTGRES_IMAGE RECOVERY_POSTGRES_IMAGE_ID
compose config --quiet
echo "Building immutable release ${DEPLOYMENT_RELEASE_ID} before maintenance..."
# Keep compiler heaps from competing with the live release on the production host.
# Unknown builder cache can belong to other projects or pending candidates.
# Only the owned storage preflight may retire artifacts; never globally prune.
for release_service in backend frontend inquiry; do
  compose build "${release_service}"
done
DEPLOYMENT_BACKEND_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_BACKEND_IMAGE}")"
DEPLOYMENT_FRONTEND_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_FRONTEND_IMAGE}")"
DEPLOYMENT_INQUIRY_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_INQUIRY_IMAGE}")"
DEPLOYMENT_NGINX_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_NGINX_IMAGE}")"
export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE
for release_image in "${DEPLOYMENT_BACKEND_IMAGE}" "${DEPLOYMENT_FRONTEND_IMAGE}" "${DEPLOYMENT_INQUIRY_IMAGE}"; do
  [ "$(docker image inspect --format '{{ index .Config.Labels "io.sabalan.performance.source-commit" }}' "${release_image}")" = "${PERFORMANCE_SOURCE_COMMIT}" ] || exit 1
  [ "$(docker image inspect --format '{{ index .Config.Labels "io.sabalan.performance.source-hash" }}' "${release_image}")" = "${PERFORMANCE_SOURCE_HASH}" ] || exit 1
done
# Re-measure actual capacity after every image export has finished.
# Insufficient space aborts while the current release still serves users.
docker_available_kb="$(df -Pk "${docker_root}" | awk 'NR==2 {print $4}')"
docker_available_bytes=$((docker_available_kb * 1024))
[ "${docker_available_bytes}" -ge "${docker_required_bytes}" ] || {
  echo "Post-build capacity needs ${docker_required_bytes} bytes but only ${docker_available_bytes} are safely available; current release remains active." >&2
  exit 1
}
DEPLOYMENT_TARGET_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
export DEPLOYMENT_TARGET_BACKEND_IMAGE
PERFORMANCE_RELEASE_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
PERFORMANCE_RELEASE_SOURCE_HASH="${PERFORMANCE_SOURCE_HASH}"
PERFORMANCE_RELEASE_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
PERFORMANCE_RELEASE_FRONTEND_IMAGE="${DEPLOYMENT_FRONTEND_IMAGE}"
PERFORMANCE_RELEASE_INQUIRY_IMAGE="${DEPLOYMENT_INQUIRY_IMAGE}"
export PERFORMANCE_RELEASE_COMMIT PERFORMANCE_RELEASE_SOURCE_HASH PERFORMANCE_RELEASE_BACKEND_IMAGE PERFORMANCE_RELEASE_FRONTEND_IMAGE PERFORMANCE_RELEASE_INQUIRY_IMAGE
else
  # All three immutable images are already imported and verified. Their bytes
  # are allocated before df measures availability; there is no build/import
  # workspace in this lane. The canonical data/checkpoint/restore reserve and
  # its 1 GiB margin remain fully enforced on both hosts by storage-preflight.
  docker_required_bytes=0
  dispatch_volume_transition stage
  sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" "${docker_required_bytes}" 0 "${COMPOSE_FILE}"
  # No fetch, tag, build or derived browser BUILD_ID can replace qualified bytes.
  prebuilt_exports="$(verify_prebuilt_release)" || exit 1
  eval "${prebuilt_exports}"
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
  DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
  export DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE
  compose config --quiet
fi
elif [ "${CAPTURE_ONLY}" -eq 1 ]; then
  # Existing source checkout/app selections stay fixed. Only the separately
  # prebuilt, content-attested control image executes the canonical backup CLI.
  control_image="$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!/^sha256:[a-f0-9]{64}$/.test(v.controlImage))process.exit(1);process.stdout.write(v.controlImage)' "${CAPTURE_ONLY_PLAN}")"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="$(docker image inspect "${control_image}" | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" plan "${CAPTURE_ONLY_PLAN}" "${OPERATIONS_ROOT}")"
  export DEPLOYMENT_TARGET_BACKEND_IMAGE
  DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}"
  DEPLOYMENT_FRONTEND_IMAGE="${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}"
  DEPLOYMENT_INQUIRY_IMAGE="${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}"
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
  DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
  export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE
else
  [ -n "${DEPLOYMENT_BIOMETRIC_PROVISIONING_FILE:-}" ] && [ -f "${DEPLOYMENT_BIOMETRIC_PROVISIONING_FILE}" ] || {
    echo "Configuration release requires a private biometric workstation provisioning file." >&2
    exit 1
  }
  docker inspect "$(compose ps -q backend)" | node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" prepare "${REPO_ROOT}" "${ENV_FILE}" "${DEPLOYMENT_BIOMETRIC_PROVISIONING_FILE}" "${DEPLOYMENT_ID}"
  CONFIGURATION_ACTIVE=1
  configuration_exports="$(node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" exports "${REPO_ROOT}")"
  eval "${configuration_exports}"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
  export DEPLOYMENT_TARGET_BACKEND_IMAGE
  compose config --quiet
  echo "Applying workstation configuration to the existing immutable release ${DEPLOYMENT_TARGET_COMMIT}; no source fetch or image build."
fi
if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_CLAMAV_TARGET_IMAGE}"
  export DEPLOYMENT_CLAMAV_IMAGE
fi
if [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ] \
  && [ "${LEGACY_RELEASE_GRAPH}" -eq 0 ] && [ -z "${DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX:-}" ] \
  && [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 0 ]; then
  target_upload_policy="$(docker image inspect --format '{{index .Config.Labels "io.sabalan.release.upload-policy"}}' "${DEPLOYMENT_TARGET_BACKEND_IMAGE}")"
  [ "${target_upload_policy}" = no-malware-scan ] || {
    echo 'The candidate image does not attest to the scanner-free release graph.' >&2; exit 1;
  }
fi
if [ "${CAPTURE_ONLY}" -eq 1 ]; then
  [ "${DEPLOYMENT_MODE}" = "release" ] || { echo "Capture-only requires the canonical release control image." >&2; exit 1; }
  CAPTURE_ONLY_SNAPSHOT="${REPO_ROOT}/.deploy-state/capture-only-${DEPLOYMENT_ID}.json"
  CAPTURE_ONLY_OUTPUT="${REPO_ROOT}/.deploy-state/capture-only-${DEPLOYMENT_ID}.checkpoint.jsonl"
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" snapshot "${CAPTURE_ONLY_SNAPSHOT}" "${ENV_FILE}"
fi
node "${OPERATIONS_ROOT}/deploy/scripts/backup-retention-host.mjs" --inspect "${ENV_FILE}"
verify_database_role_pin || exit 1
refresh_performance_database_identity

if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  allocation_request="$(node "${ALLOCATION_RELEASE_SCRIPT}" request "${allocation_predecessor}" "${DEPLOYMENT_TARGET_COMMIT}" \
    "${DEPLOYMENT_BACKEND_IMAGE}" "${DEPLOYMENT_FRONTEND_IMAGE}" "${DEPLOYMENT_INQUIRY_IMAGE}" "${DEPLOYMENT_ID}" "${DEPLOYMENT_RELEASE_ID}")" || exit 1
  node "${ALLOCATION_RELEASE_SCRIPT}" publish-request "${ALLOCATION_EVIDENCE_DIR}" "${allocation_request}" || exit 1
fi

node "${OPERATIONS_ROOT}/deploy/scripts/dispatch-volume-preflight.mjs" "${ENV_FILE}" "${COMPOSE_FILE}"
run_backend node dist/scripts/validate-production-environment.js
run_backend node dist/scripts/deployment-drill-preflight.js
if [ "$(env_value BACKEND_DATABASE_USER)" = sabalan_application_runtime ]; then
  run_backend node -e 'const fs=require("node:fs"),expected=process.env.SYSTEM_RECOVERY_POSTGRES_IMAGE_ID;const actual=JSON.parse(fs.readFileSync("/opt/recovery-postgres-root/identity.json","utf8"));if(!/^sha256:[a-f0-9]{64}$/.test(expected||"")||actual.imageId!==expected)process.exit(1)'
fi
python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --preflight \
  "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
  "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json"

if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
  node "${OPERATIONS_ROOT}/scripts/clamav-incident-recovery.mjs" verify "$(compose ps -q clamav)" "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}"
  incident_snapshot_digest="$(node --input-type=module -e 'import {fileDigest} from "./scripts/clamav-release-readiness.mjs"; console.log(await fileDigest(process.argv[1]));' "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE}")"
  [ "${incident_snapshot_digest}" = "${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256}" ] || { echo 'Incident snapshot changed during preparation.' >&2; exit 1; }
fi

if [ "${OFFLINE_CLAMAV_INCIDENT}" -eq 1 ]; then
  node "${OPERATIONS_ROOT}/scripts/clamav-release-readiness.mjs" offline-source-verify "${OFFLINE_CLAMAV_MANIFEST}" "${OFFLINE_CLAMAV_MANIFEST_SHA256}" "${REPO_ROOT}" "${OPERATIONS_ROOT}"
fi
if [ "${CAPTURE_ONLY}" -eq 1 ]; then
  # The already healthy original PostgreSQL is a capture prerequisite. Compose
  # up could apply this operation's environment and replace its configuration.
  verify_capture_only_configuration
elif [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
  # Prove an existing usable schema and adopted Inquiry ledger while still open.
  compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  run_backend_timed 60 node dist/scripts/deployment-owned-migrations.js --verify-current
  run_backend_timed 60 node -e '
    const path = require("node:path");
    const { verifyInquiryBaseline } = require("./dist/services/inquiryMigrationPlan.js");
    verifyInquiryBaseline(path.join(process.env.INQUIRY_RECOVERY_SOURCE_DIR || "/app/recovery-sources/inquiry", "inquiry.db"))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  '
else
  verify_database_role_pin || exit 1
  compose up -d --no-deps postgres
fi
if [ "${PREBUILT_RELEASE}" -eq 1 ]; then
  prebuilt_exports="$(verify_prebuilt_release)" || exit 1
  eval "${prebuilt_exports}"
fi
if [ "${MAINTENANCE_IMAGE_SELECTION}" -eq 1 ]; then
  # Fsynced content identity survives interruption; journal/leases retain authority.
  maintenance_binding="$(verify_prebuilt_release bind)" || exit 1
  eval "${maintenance_binding}"
fi
control prepare
SESSION_PREPARED=1

if ! try_acquire_advisory; then
  if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
    echo 'ClamAV incident recovery requires the advisory lease before maintenance.' >&2; exit 1
  fi
  echo "Database connections are saturated; entering journaled maintenance to drain the previous backend automatically." >&2
  if [ "${CAPTURE_ONLY}" -eq 1 ]; then capture_pause_started="$(node -e 'process.stdout.write(process.hrtime.bigint().toString())')"; DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS="${capture_pause_started}"; export DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS; fi
  enter_maintenance
  drain_current_services
  DRAINED_EARLY=1
  try_acquire_advisory || { echo "PostgreSQL advisory lease is still unavailable after the old backend drained." >&2; exit 1; }
fi

run_backend node dist/scripts/deployment-notify.js retry-blocker || retry_code=$?
retry_code="${retry_code:-0}"
[ "${retry_code}" -eq 0 ] || [ "${retry_code}" -eq 4 ] || exit "${retry_code}"

set +e
control acquire
acquire_code=$?
set -e
if [ "${acquire_code}" -eq 4 ]; then
  [ "${CAPTURE_ONLY}" -eq 0 ] || { echo "Capture-only requires an existing canonical DB lease schema; no bootstrap mutation is permitted." >&2; exit 1; }
  [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 0 ] || {
    echo 'Customer allocation rollback requires an existing canonical DB lease schema.' >&2; exit 1;
  }
  [ "${DEPLOYMENT_CLAMAV_OPERATION}" != incident-recovery ] || {
    echo 'ClamAV incident recovery requires an existing canonical DB lease schema.' >&2; exit 1
  }
  BOOTSTRAP=1
  DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=true
  export DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP
  control bootstrap-enable
elif [ "${acquire_code}" -ne 0 ]; then
  exit "${acquire_code}"
fi
DB_LEASE_ACQUIRED=1
DEPLOYMENT_LEASE_TOKEN="$(session_value leaseToken)"
export DEPLOYMENT_LEASE_TOKEN

phase MAINTENANCE_REQUESTED
if [ "${DRAINED_EARLY}" -eq 0 ]; then
  if [ "${CAPTURE_ONLY}" -eq 1 ]; then capture_pause_started="$(node -e 'process.stdout.write(process.hrtime.bigint().toString())')"; DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS="${capture_pause_started}"; export DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS; fi
  enter_maintenance
fi
phase TRAFFIC_BLOCKED
if [ "${DRAINED_EARLY}" -eq 0 ]; then drain_current_services; fi
phase SERVICES_DRAINED
if [ "${DEPLOYMENT_MODE}" = release ] && [ "${CAPTURE_ONLY}" -eq 0 ]; then
  verify_public_maintenance || exit 1
  control heartbeat || exit 1
  assert_original_legacy_still_stopped || exit 1
  dispatch_volume_transition attest || exit 1
  control heartbeat || exit 1
  assert_original_legacy_still_stopped || exit 1
fi
preserved_clamav_guard identity || exit 1
capture_clamav_checkpoint
postgres_available_kb="$(compose exec -T postgres sh -c 'df -Pk "$PGDATA" | awk "NR==2 {print \$4}"')"
postgres_database_bytes="$(compose exec -T postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
postgres_required_bytes=$((postgres_database_bytes * 5 / 4 + 536870912))
postgres_available_bytes=$((postgres_available_kb * 1024))
[ "${postgres_available_bytes}" -ge "${postgres_required_bytes}" ] || {
  echo "PostgreSQL staging requires ${postgres_required_bytes} bytes but only ${postgres_available_bytes} are available." >&2
  exit 1
}

assert_qa_remote_checkpoint_mount
run_original_owned_with_heartbeat host_backup_retention BEFORE_CHECKPOINT
bind_host_backup_retention_receipt BEFORE_CHECKPOINT
echo "Creating, decrypt-validating, uploading, and reading back the coordinated checkpoint..."

if [ "${CAPTURE_ONLY}" -eq 1 ]; then
  # Retain the original checkpoint owner; exceeding the qualification budget
  # never kills/adopts a live backup. Its actual pause is measured on reopen.
  LEGACY_BACKEND_SIGNAL_PENDING=1
  assert_original_legacy_still_stopped
  (umask 077; set -C; : > "${CAPTURE_ONLY_OUTPUT}")
  run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-checkpoint.js > "${CAPTURE_ONLY_OUTPUT}"
  chmod 400 "${CAPTURE_ONLY_OUTPUT}"
else
  LEGACY_BACKEND_SIGNAL_PENDING=1
  assert_original_legacy_still_stopped
  run_backend_timed_with_heartbeat "${checkpoint_timeout}" node dist/scripts/deployment-checkpoint.js
fi
assert_original_legacy_still_stopped
LEGACY_BACKEND_SIGNAL_PENDING=0
assert_qa_remote_checkpoint_mount
phase LOCAL_CHECKPOINT_VERIFIED
phase REMOTE_CHECKPOINT_VERIFIED
run_original_owned_with_heartbeat host_backup_retention AFTER_CHECKPOINT
bind_host_backup_retention_receipt AFTER_CHECKPOINT
run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-retention-local.js apply AFTER_CHECKPOINT
if [ "${CAPTURE_ONLY}" -eq 1 ]; then
  LEGACY_BACKEND_SIGNAL_PENDING=1
  assert_original_legacy_still_stopped
  LEGACY_BACKEND_SIGNAL_PENDING=0
  complete_capture_only || exit 1
  exit 0
fi

if [ "${PREBUILT_RELEASE}" -eq 1 ]; then
  prebuilt_exports="$(verify_prebuilt_release)" || exit 1
  eval "${prebuilt_exports}"
fi
preserved_clamav_guard identity || exit 1
LEGACY_BACKEND_SIGNAL_PENDING=1
assert_original_legacy_still_stopped
LEGACY_BACKEND_SIGNAL_PENDING=0
assert_qa_remote_checkpoint_mount
verify_database_role_pin || exit 1
verify_allocation_promotion_allowed || exit 1
if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
  # The original was stopped and freshly verified at capture. The target still
  # uses current time and DNS after the independently verified checkpoint.
  incident_capture_time="$(run_backend_timed 45 node scripts/clamav-checkpoint.mjs verify-incident-capture)" || exit 1
  case "${incident_capture_time}" in ''|*[!0-9]*) echo 'Invalid authenticated ClamAV capture time.' >&2; exit 1;; esac
  require_bound_incident_target "${REPO_ROOT}/.deploy-state/$(clamav_unit_name)/target.json" 900 "${incident_capture_time}"
fi
phase MUTATION_STARTED
MUTATION_STARTED=1
mutation_started_at="$(date +%s)"
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  verify_public_maintenance || exit 1
  control heartbeat || exit 1
  [ "$(select_customer_allocation_predecessor)" = "${customer_allocation_predecessor}" ] || exit 1
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed "${remaining}" node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
  remaining_mutation_seconds >/dev/null
  closed_manifest="$(run_original_owned_with_heartbeat run_customer_allocation_controller close \
    "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" "${CUSTOMER_ALLOCATION_CLOSE_MANIFEST_SHA256}")" || exit 1
  [ "${closed_manifest}" = "${CUSTOMER_ALLOCATION_CLOSE_MANIFEST_SHA256}" ] || {
    echo 'Customer allocation closure receipt did not match the active manifest.' >&2; exit 1;
  }
  remaining_mutation_seconds >/dev/null
  scanner_journal="${REPO_ROOT}/.deploy-state/customer-allocation-rollback-${DEPLOYMENT_ID}.scanner.json"
  node "${OPERATIONS_ROOT}/deploy/scripts/lib/customer-allocation-current-data.mjs" stage-scanner \
    "${scanner_journal}" "${CUSTOMER_ALLOCATION_RETAINED_SCANNER}" "${CUSTOMER_ALLOCATION_SCANNER_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE="${CUSTOMER_ALLOCATION_SCANNER_IMAGE}"
  export DEPLOYMENT_CLAMAV_IMAGE
  LEGACY_RELEASE_GRAPH=1
fi
if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed "${remaining}" node scripts/clamav-checkpoint.mjs activate
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_CLAMAV_TARGET_IMAGE}"
  export DEPLOYMENT_CLAMAV_IMAGE
fi
if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
  node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" persist "${REPO_ROOT}"
fi

if [ "${DEPLOYMENT_CLAMAV_OPERATION}" = incident-recovery ]; then
  echo 'Retaining the verified application schemas and business data.'
  phase MIGRATIONS_APPLIED
else
echo "Applying migrations with a two-connection deployment identity..."
remaining="$(remaining_mutation_seconds)" || exit 1
if [ "${BOOTSTRAP}" -eq 1 ]; then
  # Install only the frozen historical prefix, then establish the owned DB
  # lease before either bridge migration. Never adopt unknown native receipts.
  run_backend_timed "${remaining}" sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-control.js bootstrap-migrate-baseline
  run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-control.js bootstrap-adopt >/dev/null
  BOOTSTRAP=0
  remaining="$(remaining_mutation_seconds)" || exit 1
fi
if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
  # Configuration uses the already-serving immutable image, which may predate
  # the bridge CLI. It must have no pending schema work; do not migrate it.
  run_backend_timed "${remaining}" node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
else
  # Reviewed bridge DDL and native Prisma history commit together. Unknown
  # pending strategies fail closed; there is no native/partial fallback.
  run_backend_timed "${remaining}" sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-owned-migrations.js
fi
phase MIGRATIONS_APPLIED
# Inquiry's existing SQLite shape is adopted under the same checkpoint,
# maintenance boundary, database lease and inherited single-control-owner lock.
# Normal Inquiry restarts only verify; they never push schema or reset passwords.
if [ "${DEPLOYMENT_MODE}" = "release" ]; then
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed "${remaining}" sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-inquiry.js
fi

shipment_cutover_required="$(env_value SHIPMENT_STATEMENT_CUTOVER_REQUIRED)"
shipment_cutover_required="${shipment_cutover_required:-false}"
case "${shipment_cutover_required}" in
  true|false) ;;
  *) echo "SHIPMENT_STATEMENT_CUTOVER_REQUIRED must be true or false." >&2; exit 1 ;;
esac
if [ "${shipment_cutover_required}" = "true" ]; then
  target_gate="$(env_value CUSTOMER_SHIPMENT_STATEMENTS_ENABLED)"
  [ "${target_gate}" = "true" ] || {
    echo "A required shipment-statement cutover needs CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=true for the target release." >&2
    exit 1
  }
  cutover_input_host_dir="${DEPLOYMENT_REPORT_DIR_HOST%/}/shipment-statement-cutover/pending"
  cutover_input_container_dir="/app/deployment-reports/shipment-statement-cutover/pending"
  cutover_output_host_dir="${DEPLOYMENT_REPORT_DIR_HOST%/}/shipment-statement-cutover/${DEPLOYMENT_ID}"
  cutover_output_container_dir="/app/deployment-reports/shipment-statement-cutover/${DEPLOYMENT_ID}"
  cutover_evidence_input="${cutover_input_container_dir}/evidence.json"
  cutover_reviews_host="${cutover_input_host_dir}/legacy-pricing-reviews.json"
  cutover_reviews="${cutover_input_container_dir}/legacy-pricing-reviews.json"
  cutover_evidence="${cutover_output_container_dir}/evidence.json"
  cutover_artifacts="${cutover_output_container_dir}/artifacts"
  cutover_cohort_host="${cutover_output_host_dir}/artifacts/live-cohort.json"
  cutover_cohort="${cutover_artifacts}/live-cohort.json"
  cutover_cohort_approval_host="${cutover_output_host_dir}/artifacts/live-cohort-approval.json"
  cutover_manifest="${cutover_output_container_dir}/manifest.json"
  cutover_receipt="${cutover_output_container_dir}/receipt.json"
  [ -f "${cutover_input_host_dir}/evidence.json" ] || {
    echo "Required cutover evidence is missing under ${cutover_input_host_dir}." >&2
    exit 1
  }
  [ ! -e "${cutover_output_host_dir}" ] || {
    echo "A shipment-statement cutover output already exists for deployment ${DEPLOYMENT_ID}; refusing reuse." >&2
    exit 1
  }
  mkdir -p "${cutover_output_host_dir}"
  echo "Running the required Customer Shipment Statement cutover inside the owned maintenance boundary..."
  remaining="$(remaining_mutation_seconds)" || exit 1
  if [ -f "${cutover_reviews_host}" ]; then
    run_backend_timed_with_heartbeat "${remaining}" env \
      CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false \
      SHIPMENT_STATEMENT_RELEASE_ID="${DEPLOYMENT_RELEASE_ID}" \
      node dist-cutover/scripts/shipment-statement-cutover.js legacy \
        --evidence "${cutover_evidence_input}" --reviews "${cutover_reviews}" \
        --artifacts "${cutover_artifacts}" --out "${cutover_evidence}"
  else
    run_backend_timed_with_heartbeat "${remaining}" env \
      CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false \
      SHIPMENT_STATEMENT_RELEASE_ID="${DEPLOYMENT_RELEASE_ID}" \
      node dist-cutover/scripts/shipment-statement-cutover.js legacy \
        --evidence "${cutover_evidence_input}" --artifacts "${cutover_artifacts}" --out "${cutover_evidence}"
  fi
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed_with_heartbeat "${remaining}" env \
    CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false \
    SHIPMENT_STATEMENT_RELEASE_ID="${DEPLOYMENT_RELEASE_ID}" \
    node dist-cutover/scripts/shipment-statement-cutover.js cohort --out "${cutover_cohort}"
  echo "The exact drained cohort is ready at ${cutover_cohort_host}. Review it and create ${cutover_cohort_approval_host}."
  remaining="$(remaining_mutation_seconds)" || exit 1
  wait_for_cutover_approval "${cutover_cohort_approval_host}" "${remaining}"
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed_with_heartbeat "${remaining}" env \
    CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false \
    SHIPMENT_STATEMENT_RELEASE_ID="${DEPLOYMENT_RELEASE_ID}" \
    node dist-cutover/scripts/shipment-statement-cutover.js manifest \
      --evidence "${cutover_evidence}" --artifacts "${cutover_artifacts}" --out "${cutover_manifest}"
  remaining="$(remaining_mutation_seconds)" || exit 1
  run_backend_timed_with_heartbeat "${remaining}" env \
    CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false \
    SHIPMENT_STATEMENT_RELEASE_ID="${DEPLOYMENT_RELEASE_ID}" \
    node dist-cutover/scripts/shipment-statement-cutover.js activate \
      --manifest "${cutover_manifest}" --receipt "${cutover_receipt}"
fi

mkdir -p "${DEPLOYMENT_REPORT_DIR_HOST}"
audit_name="contract-product-graph-${DEPLOYMENT_ID}.json"
remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/dry-run-contract-product-graph-migration.js --output="/app/deployment-reports/${audit_name}"
onboarding_audit_name="hr-onboarding-retirement-${DEPLOYMENT_ID}.json"
remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/audit-hr-onboarding-task-retirement.js --output=/app/deployment-reports/${onboarding_audit_name}

remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/migrate-all-contract-product-graphs.js --apply --deployment-checkpoint

evidence_dry_run_name="contract-financial-evidence-dry-run-${DEPLOYMENT_ID}.json"
remaining="$(remaining_mutation_seconds)" || exit 1
if ! run_backend_timed "${remaining}" node dist/scripts/reconcile-contract-financial-evidence.js --deployment-checkpoint \
  --output="/app/deployment-reports/${evidence_dry_run_name}"; then
  evidence_referral_name="contract-financial-evidence-referrals-${DEPLOYMENT_ID}.json"
  FINANCIAL_EVIDENCE_REFERRAL_REQUIRED=1
  FINANCIAL_EVIDENCE_DRY_RUN_REPORT="${evidence_dry_run_name}"
  FINANCIAL_EVIDENCE_REFERRAL_REPORT="${evidence_referral_name}"
  echo "Unresolved financial evidence blocks deployment; durable referral runs after verified rollback." >&2
  exit 1
fi

evidence_apply_name="contract-financial-evidence-apply-${DEPLOYMENT_ID}.json"
remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/reconcile-contract-financial-evidence.js --apply --deployment-checkpoint \
  --output="/app/deployment-reports/${evidence_apply_name}"

if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  remaining="$(remaining_mutation_seconds)" || exit 1
  echo "Waiting for an independent customer allocation decision for ${DEPLOYMENT_ID} under the verified maintenance boundary."
  wait_for_cutover_approval "${ALLOCATION_EVIDENCE_DIR}/decision.json" "${remaining}" "independently signed customer allocation decision" || exit 1
  remaining_mutation_seconds >/dev/null || exit 1
  verify_public_maintenance || exit 1
  assert_original_legacy_still_stopped || exit 1
  assert_qa_remote_checkpoint_mount || exit 1
  control heartbeat || exit 1
  # Stop the exact predecessor scanner without recreating or removing it.
  docker stop --time 60 "${legacy_scanner_id}" >/dev/null || exit 1
  remaining_mutation_seconds >/dev/null || exit 1
  DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256="$(run_original_owned_with_heartbeat run_customer_allocation_controller activate "${DEPLOYMENT_TARGET_BACKEND_IMAGE}")" || exit 1
  case "${DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256}" in
    ''|*[!a-f0-9]*) echo 'Customer allocation activation receipt is invalid.' >&2; exit 1 ;;
  esac
  [ "${#DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256}" -eq 64 ] || exit 1
  allocation_reference="$(customer_allocation_retention_path)" || exit 1
  node "${OPERATIONS_ROOT}/deploy/scripts/lib/customer-allocation-current-data.mjs" retain \
    "${ALLOCATION_EVIDENCE_DIR}" "${DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256}" "${allocation_reference}" || exit 1
fi
fi

phase RELEASE_STARTED
refresh_performance_database_identity
remaining="$(remaining_mutation_seconds)" || exit 1
start_release_services "${remaining}"

if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  allocation_runtime_address="$(node "${ALLOCATION_RELEASE_SCRIPT}" verify-started "${allocation_request}" "${allocation_predecessor}" \
    "$(compose ps -q backend)" "$(compose ps -q frontend)" "$(compose ps -q inquiry)" "${legacy_scanner_id}")" || exit 1
fi

remaining="$(remaining_mutation_seconds)" || exit 1
if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  run_backend_timed "${remaining}" env "DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256=${DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256}" \
    "DEPLOYMENT_CUSTOMER_ALLOCATION_RUNTIME_ADDRESS=${allocation_runtime_address}" node dist/scripts/deployment-gates.js
else
  run_backend_timed "${remaining}" node dist/scripts/deployment-gates.js
fi
if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ] \
  || { [ "${DEPLOYMENT_MODE}" = configuration ] && [ "${LEGACY_RELEASE_GRAPH}" -eq 1 ]; } \
  || [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  remaining="$(remaining_mutation_seconds)" || exit 1
  timeout "${remaining}" docker compose --env-file "${ENV_FILE}" -f "$(runtime_compose_file)" exec -T backend sh -c '
    set -eu
    test "${HR_HIRING_ANTIVIRUS_COMMAND:-}" = "/app/scripts/hr-clamdscan.sh"
    command -v clamdscan >/dev/null
    test_file="/tmp/sabalanerp-antivirus-deployment-gate.txt"
    printf "Sabalan ERP antivirus deployment gate\n" > "${test_file}"
    "${HR_HIRING_ANTIVIRUS_COMMAND}" "${test_file}"
    rm -f "${test_file}"
  '
fi
remaining_mutation_seconds >/dev/null
verify_clamav_repair_runtime
remaining_mutation_seconds >/dev/null
if [ -n "${ALLOCATION_EVIDENCE_DIR}" ]; then
  checked_allocation_runtime_address="$(node "${ALLOCATION_RELEASE_SCRIPT}" verify-started "${allocation_request}" "${allocation_predecessor}" \
    "$(compose ps -q backend)" "$(compose ps -q frontend)" "$(compose ps -q inquiry)" "${legacy_scanner_id}")" || exit 1
  [ "${checked_allocation_runtime_address}" = "${allocation_runtime_address}" ] || exit 1
fi
verify_database_role_pin || exit 1
phase GATES_PASSED
if [ "${CONFIGURATION_ACTIVE}" -eq 1 ]; then
  node "${OPERATIONS_ROOT}/scripts/deployment-biometric-configuration.mjs" mark-open "${REPO_ROOT}"
fi
phase TRAFFIC_OPENED
PUBLIC_TRAFFIC_OPEN=1
control maintenance-off
MAINTENANCE_ACTIVE=0
finish_with_notification_result COMPLETED
cleanup_configuration_snapshot

FINISHED=1
if [ "${CUSTOMER_ALLOCATION_CURRENT_DATA_ROLLBACK}" -eq 1 ]; then
  allocation_reference="$(customer_allocation_retention_path)" && \
  node "${OPERATIONS_ROOT}/deploy/scripts/lib/customer-allocation-current-data.mjs" retire \
    "${allocation_reference}" "${CUSTOMER_ALLOCATION_CLOSE_MANIFEST_SHA256}" || \
    echo 'Closed allocation images remain protected pending reconciliation of their retention receipt.' >&2
fi
cleanup_locks
trap - EXIT INT TERM
echo "Deployment ${DEPLOYMENT_ID} completed with verified local/remote checkpoints and all mandatory gates passed."
