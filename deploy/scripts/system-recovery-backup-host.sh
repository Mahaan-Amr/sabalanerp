#!/bin/sh
# Sourced only by the protected host runner after its canonical host lock.

system_recovery_owner_command() {
  run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/system-recovery-owner.js \
    "${SYSTEM_RECOVERY_OPERATION_ID}" <&8 8<&-
}

assert_system_recovery_advisory() {
  [ -n "${ADVISORY_PID}" ] && kill -0 "${ADVISORY_PID}" 2>/dev/null || return 1
  owner_count="$(compose exec -T postgres sh -c "
    psql -XAt -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"
      SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid)
      WHERE a.application_name = '${ADVISORY_APPLICATION_NAME}' AND a.datname = 'postgres'
        AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
        AND l.classid = 0 AND l.objid = ${ADVISORY_LOCK_KEY} AND l.objsubid = 1\";
  ")"
  [ "${owner_count}" = 1 ]
}

system_recovery_backup_failure() {
  backup_status="$1"
  trap - EXIT
  trap '' INT TERM HUP
  # Wait for the original attached Compose child before releasing host FD9.
  if [ -n "${backup_owner_pid:-}" ]; then wait "${backup_owner_pid}" || true; fi
  if [ -n "${owned_pid:-}" ]; then wait "${owned_pid}" || true; fi
  if [ "${MAINTENANCE_ACTIVE}" -eq 1 ]; then
    control maintenance-on || true
    echo 'System Recovery backup held in maintenance. Preserve the active journal and investigate before reopening.' >&2
  fi
  cleanup_locks
  exit "${backup_status}"
}

run_system_recovery_backup() {
  trap 'system_recovery_backup_failure $?' EXIT
  trap 'exit 130' INT TERM HUP
  [ "$(id -u)" = 0 ] && [ "${REPO_ROOT}" = /opt/sabalanerp ] && [ "${COMPOSE_FILE}" = docker-compose.prod.yml ] || return 1
  [ ! -e "${SESSION_HOST_PATH}" ] && [ ! -L "${SESSION_HOST_PATH}" ] \
    && [ ! -e "${CONFIGURATION_STATE}" ] && [ ! -L "${CONFIGURATION_STATE}" ] || return 1
  [ "$(env_value BACKEND_DATABASE_USER)" = sabalan_application_runtime ] || {
    echo 'System Recovery owner backup requires the restricted serving database identity.' >&2
    return 1
  }
  ENV_FILE="$(realpath -- "${ENV_FILE}")"

  # Snapshot the immutable running set and keep the original topology,
  # including a legacy scanner when the existing release uses it.
  previous_backend_id="$(compose ps -q backend)"
  case "$(docker inspect --format '{{index .Config.Labels "io.sabalan.release.upload-policy"}}' "${previous_backend_id}")" in
    no-malware-scan) ;;
    ''|'<no value>') LEGACY_RELEASE_GRAPH=1 ;;
    *) return 1 ;;
  esac
  existing_exports="$(capture_only_services | node "${OPERATIONS_ROOT}/scripts/deployment-existing-release.mjs")"
  eval "${existing_exports}"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="${DEPLOYMENT_FRONTEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="${DEPLOYMENT_INQUIRY_IMAGE}"
  DEPLOYMENT_PREVIOUS_NGINX_IMAGE="${DEPLOYMENT_NGINX_IMAGE}"
  DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="${DEPLOYMENT_POSTGRES_IMAGE}"
  DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="${DEPLOYMENT_CLAMAV_IMAGE:-}"
  DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT="$(docker inspect "${previous_backend_id}" | node scripts/performance-deployment-environment.mjs capture)"
  # PostgreSQL limits application_name to 63 bytes, including the advisory-lock prefix.
  DEPLOYMENT_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(6).toString("hex"))')-backup"
  DEPLOYMENT_ID="deploy-${DEPLOYMENT_RELEASE_ID}"
  APP_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
  export DEPLOYMENT_TARGET_BACKEND_IMAGE DEPLOYMENT_RELEASE_ID DEPLOYMENT_ID DEPLOYMENT_OWNER APP_COMMIT
  export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE
  export DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT

  database_role_pin="$(database_role_pin_path)"
  protected_compose_config | node "${OPERATIONS_ROOT}/deploy/scripts/protected-database-role-pin.mjs" pin \
    "${database_role_pin}" "${previous_backend_id}" "$(compose ps -q postgres)"
  backup_snapshot="${REPO_ROOT}/.deploy-state/system-recovery-backup-${DEPLOYMENT_ID}.json"
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" snapshot "${backup_snapshot}" "${ENV_FILE}"
  run_backend test -f dist/scripts/system-recovery-owner.js
  python3 "${OPERATIONS_ROOT}/deploy/scripts/legacy-backend-signal.py" --preflight \
    "${REPO_ROOT}/${COMPOSE_FILE}" "${ENV_FILE}" "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
    "${REPO_ROOT}/.deploy-state/legacy-backend-drain-${DEPLOYMENT_ID}.json"

  try_acquire_advisory
  # The independent intent keeps ordinary release restart logic from
  # reinterpreting an interrupted backup as a release it can recreate.
  node "${SYSTEM_RECOVERY_BACKUP_HOST}" hold "${SYSTEM_RECOVERY_BACKUP_INTENT}" "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}"
  control prepare
  control acquire
  DB_LEASE_ACQUIRED=1
  DEPLOYMENT_LEASE_TOKEN="$(session_value leaseToken)"
  export DEPLOYMENT_LEASE_TOKEN

  phase MAINTENANCE_REQUESTED
  backup_pause_started="$(node -e 'process.stdout.write(process.hrtime.bigint().toString())')"
  MAINTENANCE_ACTIVE=1
  control maintenance-on
  verify_public_maintenance
  phase TRAFFIC_BLOCKED
  drain_current_services
  phase SERVICES_DRAINED
  verify_public_maintenance
  assert_original_legacy_still_stopped
  assert_system_recovery_advisory
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${backup_snapshot}" "${ENV_FILE}"

  system_recovery_owner_command &
  backup_owner_pid=$!
  exec 8<&-
  backup_heartbeat_good=1
  backup_heartbeat_elapsed=0
  while kill -0 "${backup_owner_pid}" 2>/dev/null; do
    sleep 5
    backup_heartbeat_elapsed=$((backup_heartbeat_elapsed + 5))
    if [ "${backup_heartbeat_elapsed}" -ge 60 ]; then
      if ! assert_system_recovery_advisory || ! verify_public_maintenance || ! control heartbeat; then
        backup_heartbeat_good=0
      fi
      backup_heartbeat_elapsed=0
    fi
  done
  wait "${backup_owner_pid}"
  backup_owner_pid=""
  [ "${backup_heartbeat_good}" -eq 1 ]
  assert_system_recovery_advisory
  control heartbeat
  assert_original_legacy_still_stopped
  assert_native_runtime_closed

  # The restart helper guards the original FD9, lease, configuration bytes,
  # and exact container IDs before starting the original service set.
  run_original_owned_with_heartbeat node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" start-original \
    "${backup_snapshot}" "${ENV_FILE}" "${REPO_ROOT}/${COMPOSE_FILE}" 300 "${backup_pause_started}" "${SESSION_HOST_PATH}"
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${backup_snapshot}" "${ENV_FILE}"
  verify_database_role_pin "$(compose ps -q backend)" "$(compose ps -q postgres)"
  DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-gates.js
  verify_public_maintenance
  assert_system_recovery_advisory
  control heartbeat
  node -e 'if(process.hrtime.bigint()-BigInt(process.argv[1])>=900000000000n)process.exit(1)' "${backup_pause_started}"
  control maintenance-off
  DEPLOYMENT_PHASE=ABORTED DEPLOYMENT_RESULT=ABORTED control finish
  MAINTENANCE_ACTIVE=0
  node "${SYSTEM_RECOVERY_BACKUP_HOST}" clear "${SYSTEM_RECOVERY_BACKUP_INTENT}" "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}"
  cleanup_locks
  trap - EXIT INT TERM HUP
  echo 'System Recovery backup completed. The verified original release reopened.'
}
