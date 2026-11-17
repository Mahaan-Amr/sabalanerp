#!/bin/sh
# Sourced only by the protected host runner after its canonical host lock.

system_recovery_owner_command() {
  if [ "${SYSTEM_RECOVERY_OWNER_HANDOFF:-0}" -eq 1 ]; then
    run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/system-recovery-owner.js \
      --sealed "${SYSTEM_RECOVERY_OPERATION_ID}" "${SYSTEM_RECOVERY_OWNER_ACTION}" <&8 8<&-
    return
  fi
  run_backend sh scripts/with-backend-control-ownership.sh node dist/scripts/system-recovery-owner.js \
    "${SYSTEM_RECOVERY_OPERATION_ID}" <&8 8<&-
}

assert_system_recovery_advisory() {
  protected_advisory_owned
}

# Every post-owner child shares the original absolute mutation deadline. A
# native startup guardian retains its Docker children and already stops new
# admission at that deadline; read-only probes are retained until actual exit.
# Gates additionally have an exact named container that this owner may stop.
run_system_recovery_postowner() {
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" != RESTORE ]; then
    run_original_owned_with_heartbeat "$@"
    return
  fi
  node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" within-budget "${restore_mutation_started}" || return 124
  "$@" </dev/null &
  owned_pid=$!
  postowner_expired=0
  postowner_heartbeat_elapsed=0
  postowner_heartbeat_good=1
  while kill -0 "${owned_pid}" 2>/dev/null; do
    sleep 5
    if [ "${postowner_expired}" -eq 0 ] \
      && ! node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" within-budget "${restore_mutation_started}"; then
      postowner_expired=1
      phase ROLLBACK_STARTED >&2 || postowner_heartbeat_good=0
      if [ "${DEPLOYMENT_GATE_MODE:-}" = APPLICATION_RECOVERY ]; then
        node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" stop-gates \
          "${SYSTEM_RECOVERY_GATES_CONTAINER}" "${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
          "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}" || postowner_heartbeat_good=0
      fi
    fi
    postowner_heartbeat_elapsed=$((postowner_heartbeat_elapsed + 5))
    if [ "${postowner_heartbeat_elapsed}" -ge 15 ]; then
      { assert_system_recovery_advisory && verify_public_maintenance && control heartbeat; } >&2 || postowner_heartbeat_good=0
      postowner_heartbeat_elapsed=0
    fi
  done
  postowner_status=0
  wait "${owned_pid}" || postowner_status=$?
  owned_pid=""
  [ "${postowner_expired}" -eq 0 ] && [ "${postowner_heartbeat_good}" -eq 1 ] || return 124
  node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" within-budget "${restore_mutation_started}" || return 124
  return "${postowner_status}"
}

verify_system_recovery_reopened_configuration() {
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${backup_snapshot}" "${ENV_FILE}"
  verify_predecessor_database_roles
}

capture_system_recovery_runtime_after() {
  # mktemp exclusively creates a mode-0600 file beside the root-owned session.
  # Keep the phase-owning monitor in this shell; only the readback may use a
  # command substitution. A failed capture stays private for incident review.
  runtime_proof_file="$(mktemp "${SESSION_HOST_PATH}.runtime-proof.XXXXXX")" || return 1
  exec 6>"${runtime_proof_file}" || return 1
  runtime_proof_status=0
  run_system_recovery_postowner compose exec -T backend node dist/scripts/system-recovery-runtime-proof.js >&6 || runtime_proof_status=$?
  exec 6>&-
  [ "${runtime_proof_status}" -eq 0 ] || return "${runtime_proof_status}"
  SYSTEM_RECOVERY_RUNTIME_AFTER="$(cat "${runtime_proof_file}")" || return 1
  rm -- "${runtime_proof_file}" || return 1
  export SYSTEM_RECOVERY_RUNTIME_AFTER
}

system_recovery_backup_failure() {
  backup_status="$1"
  trap - EXIT
  trap '' INT TERM HUP
  # Wait for the original attached Compose child before releasing host FD9.
  if [ -n "${backup_owner_pid:-}" ]; then wait "${backup_owner_pid}" || true; fi
  if [ -n "${owned_pid:-}" ]; then wait "${owned_pid}" || true; fi
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ] \
    && [ "${MUTATION_STARTED:-0}" -eq 1 ] && [ "${PUBLIC_TRAFFIC_OPEN:-0}" -eq 0 ] \
    && [ "${ROLLBACK_ALREADY_ATTEMPTED:-0}" -eq 0 ] \
    && node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify-startup-closed "${backup_snapshot}"; then
    if system_recovery_checkpoint_rollback; then exit 0; fi
  fi
  if [ "${MAINTENANCE_ACTIVE}" -eq 1 ]; then
    control maintenance-on || true
    if [ "${MUTATION_STARTED:-0}" -eq 1 ]; then
      DEPLOYMENT_PHASE=RECOVERY_REQUIRED DEPLOYMENT_RESULT=RECOVERY_REQUIRED control finish || true
    fi
    echo 'System Recovery backup held in maintenance. Preserve the active journal and investigate before reopening.' >&2
  fi
  cleanup_locks
  exit "${backup_status}"
}

system_recovery_checkpoint_rollback() {
  ROLLBACK_ALREADY_ATTEMPTED=1
  control maintenance-on && verify_public_maintenance && assert_system_recovery_advisory && control heartbeat || return 1
  verify_predecessor_database_roles && drain_release_for_rollback && assert_native_runtime_closed || return 1
  # The original child has been reaped. Resolve only its bound journal under
  # this same owner before the single canonical verified-checkpoint rollback.
  run_original_owned_with_heartbeat run_backend sh scripts/with-backend-control-ownership.sh \
    node dist/scripts/system-recovery-owner-reconcile.js "${SYSTEM_RECOVERY_OPERATION_ID}" || return 1
  if [ "${DEPLOYMENT_PHASE:-}" != ROLLBACK_STARTED ]; then phase ROLLBACK_STARTED || return 1; fi
  run_original_owned_with_heartbeat run_backend sh scripts/with-backend-control-ownership.sh \
    node dist/scripts/deployment-rollback.js || return 1
  run_original_owned_with_heartbeat run_backend sh scripts/with-backend-control-ownership.sh \
    node dist/scripts/deployment-finalize-recovery.js || return 1
  run_original_owned_with_heartbeat run_backend sh scripts/with-backend-control-ownership.sh \
    node dist/scripts/system-recovery-rollback-receipt.js "${SYSTEM_RECOVERY_OPERATION_ID}" || return 1
  assert_native_runtime_closed && assert_system_recovery_advisory && control heartbeat || return 1
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${backup_snapshot}" "${ENV_FILE}" || return 1
  rollback_snapshot="${backup_snapshot}.rollback.json"
  node -e 'const fs=require("node:fs"),s=process.argv[1],d=process.argv[2];const f=fs.openSync(d,"wx",0o400);try{fs.writeFileSync(f,fs.readFileSync(s));fs.fsyncSync(f)}finally{fs.closeSync(f)}' "${backup_snapshot}" "${rollback_snapshot}" || return 1
  rollback_restart_started="$(node -e 'process.stdout.write(process.hrtime.bigint().toString())')"
  # Emergency recovery may outlast the mutation deadline. Its separate original-
  # container restart is still bounded and requires the rollback owner receipt.
  run_original_owned_with_heartbeat node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" start-rolled-back \
    "${rollback_snapshot}" "${ENV_FILE}" "${REPO_ROOT}/${COMPOSE_FILE}" 300 "${rollback_restart_started}" "${SESSION_HOST_PATH}" || return 1
  SYSTEM_RECOVERY_RUNTIME_AFTER="$(compose exec -T backend node dist/scripts/system-recovery-runtime-proof.js)" || return 1
  export SYSTEM_RECOVERY_RUNTIME_AFTER
  DEPLOYMENT_GATE_MODE=APPLICATION_RECOVERY_ROLLBACK run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-gates.js || return 1
  verify_public_maintenance && assert_system_recovery_advisory && control heartbeat || return 1
  PUBLIC_TRAFFIC_OPEN=1
  control maintenance-off || return 1
  DEPLOYMENT_PHASE=ROLLED_BACK DEPLOYMENT_RESULT=ROLLED_BACK control finish || return 1
  MAINTENANCE_ACTIVE=0
  node "${SYSTEM_RECOVERY_BACKUP_HOST}" clear "${SYSTEM_RECOVERY_BACKUP_INTENT}" "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}" || return 1
  cleanup_locks
  echo 'System Recovery failed; the verified pre-request checkpoint and original release reopened.'
}

run_system_recovery_backup() {
  trap 'system_recovery_backup_failure $?' EXIT
  trap 'exit 130' INT TERM HUP
  [ "$(id -u)" = 0 ] && [ "${REPO_ROOT}" = /opt/sabalanerp ] || return 1
  case "${COMPOSE_FILE}" in
    docker-compose.prod.yml)
      [ -z "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:-}${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:-}" ] || return 1
      ;;
    docker-compose.rehearsal.yml)
      [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:-}" ] && [ -n "${DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:-}" ] \
        && [ "$(node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-qa.mjs" select "${ENV_FILE}" "${DEPLOYMENT_SECRET_DIR}/system-recovery-owner-private.pem")" = docker-compose.rehearsal.yml ] || return 1
      ;;
    *) return 1 ;;
  esac
  [ ! -e "${SESSION_HOST_PATH}" ] && [ ! -L "${SESSION_HOST_PATH}" ] \
    && [ ! -e "${CONFIGURATION_STATE}" ] && [ ! -L "${CONFIGURATION_STATE}" ] || return 1
  case "${PREDECESSOR_DATABASE_MODE}" in split:*) ;; *)
    echo 'System Recovery owner backup requires the restricted serving database identity.' >&2
    return 1
    ;;
  esac
  ENV_FILE="$(realpath -- "${ENV_FILE}")"

  # Pin the scanner-retaining predecessor's entire six-service graph.
  previous_backend_id="$(compose ps -q backend)"
  existing_exports="$(capture_only_services | node "${OPERATIONS_ROOT}/scripts/deployment-existing-release.mjs")"
  eval "${existing_exports}"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="${DEPLOYMENT_FRONTEND_IMAGE}"
  DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="${DEPLOYMENT_INQUIRY_IMAGE}"
  DEPLOYMENT_PREVIOUS_NGINX_IMAGE="${DEPLOYMENT_NGINX_IMAGE}"
  DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="${DEPLOYMENT_POSTGRES_IMAGE}"
  DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="${DEPLOYMENT_CLAMAV_IMAGE}"
  DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT="$(docker inspect "${previous_backend_id}" | node scripts/performance-deployment-environment.mjs capture)"
  # PostgreSQL limits application_name to 63 bytes, including the advisory-lock prefix.
  DEPLOYMENT_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(6).toString("hex"))')-backup"
  DEPLOYMENT_ID="deploy-${DEPLOYMENT_RELEASE_ID}"
  APP_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
  export DEPLOYMENT_TARGET_BACKEND_IMAGE DEPLOYMENT_RELEASE_ID DEPLOYMENT_ID DEPLOYMENT_OWNER APP_COMMIT
  export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE
  export DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT

  backup_snapshot="${REPO_ROOT}/.deploy-state/system-recovery-backup-${DEPLOYMENT_ID}.json"
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" snapshot "${backup_snapshot}" "${ENV_FILE}"
  run_backend test -f dist/scripts/system-recovery-owner.js
  verify_predecessor_database_roles
  if [ "${SYSTEM_RECOVERY_OWNER_HANDOFF:-0}" -eq 1 ]; then
    preflight_status=0
    run_backend node dist/scripts/system-recovery-owner-preflight.js --sealed \
      "${SYSTEM_RECOVERY_OPERATION_ID}" "${SYSTEM_RECOVERY_OWNER_ACTION}" <&7 7<&- 8<&- || preflight_status=$?
    exec 7<&-
    if [ "${preflight_status}" -eq 75 ]; then
      cleanup_locks
      trap - EXIT INT TERM HUP
      return 0
    fi
    [ "${preflight_status}" -eq 0 ] || return "${preflight_status}"
  fi
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    run_backend node -e 'const fs=require("node:fs"),expected=process.env.SYSTEM_RECOVERY_POSTGRES_IMAGE_ID;const actual=JSON.parse(fs.readFileSync("/opt/recovery-postgres-root/identity.json","utf8"));if(!/^sha256:[a-f0-9]{64}$/.test(expected||"")||actual.imageId!==expected)process.exit(1)'
  fi
  sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" 0 0 "${COMPOSE_FILE}"
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
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    SYSTEM_RECOVERY_RUNTIME_BEFORE="$(compose exec -T backend node dist/scripts/system-recovery-runtime-proof.js)"
    export SYSTEM_RECOVERY_RUNTIME_BEFORE
  fi
  drain_current_services
  phase SERVICES_DRAINED
  verify_public_maintenance
  assert_original_legacy_still_stopped
  assert_system_recovery_advisory
  capture_only_services | node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" verify "${backup_snapshot}" "${ENV_FILE}"
  [ "$(predecessor_database_topology retained)" = "${PREDECESSOR_DATABASE_MODE}" ]

  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    # Application recovery uses the same independently read-back safety point
    # as release mutation. The uploaded archive never replaces this checkpoint.
    capture_clamav_checkpoint
    assert_qa_remote_checkpoint_mount
    run_original_owned_with_heartbeat host_backup_retention BEFORE_CHECKPOINT
    bind_host_backup_retention_receipt BEFORE_CHECKPOINT
    run_backend_timed_with_heartbeat 3600 node dist/scripts/deployment-checkpoint.js
    assert_original_legacy_still_stopped
    assert_qa_remote_checkpoint_mount
    phase LOCAL_CHECKPOINT_VERIFIED
    phase REMOTE_CHECKPOINT_VERIFIED
    run_original_owned_with_heartbeat host_backup_retention AFTER_CHECKPOINT
    bind_host_backup_retention_receipt AFTER_CHECKPOINT
    run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-retention-local.js apply AFTER_CHECKPOINT
    phase MUTATION_STARTED
    MUTATION_STARTED=1
    restore_mutation_started="$(node -e 'process.stdout.write(process.hrtime.bigint().toString())')"
    SYSTEM_RECOVERY_MUTATION_STARTED_NS="${restore_mutation_started}"
    export SYSTEM_RECOVERY_MUTATION_STARTED_NS
    SYSTEM_RECOVERY_OWNER_CONTAINER="sabalanerp-recovery-owner-${DEPLOYMENT_ID}"
    export SYSTEM_RECOVERY_OWNER_CONTAINER
  fi

  system_recovery_owner_command &
  backup_owner_pid=$!
  exec 8<&-
  backup_heartbeat_good=1
  backup_heartbeat_elapsed=0
  while kill -0 "${backup_owner_pid}" 2>/dev/null; do
    sleep 5
    if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ] \
      && ! node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" within-budget "${restore_mutation_started}"; then
      # Fence the old MUTATION_STARTED boundary before requesting termination.
      # No rollback begins until Compose is reaped and native closure is proven.
      phase ROLLBACK_STARTED || backup_heartbeat_good=0
      node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" stop-owner \
        "${SYSTEM_RECOVERY_OWNER_CONTAINER}" "${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
        "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}" || backup_heartbeat_good=0
      break
    fi
    backup_heartbeat_elapsed=$((backup_heartbeat_elapsed + 5))
    if [ "${backup_heartbeat_elapsed}" -ge 15 ]; then
      if ! assert_system_recovery_advisory || ! verify_public_maintenance || ! control heartbeat; then
        backup_heartbeat_good=0
      fi
      backup_heartbeat_elapsed=0
    fi
  done
  owner_status=0
  wait "${backup_owner_pid}" || owner_status=$?
  backup_owner_pid=""
  [ "${owner_status}" -eq 0 ] || return "${owner_status}"
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    node "${OPERATIONS_ROOT}/deploy/scripts/system-recovery-owner-host.mjs" within-budget "${restore_mutation_started}" || return 1
    [ "${DEPLOYMENT_PHASE:-}" != ROLLBACK_STARTED ] || return 1
  fi
  [ "${backup_heartbeat_good}" -eq 1 ]
  assert_system_recovery_advisory
  control heartbeat
  assert_original_legacy_still_stopped
  assert_native_runtime_closed

  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    phase MIGRATIONS_APPLIED
    phase RELEASE_STARTED
  fi

  # The restart helper guards the original FD9, lease, configuration bytes,
  # and exact container IDs before starting the original service set.
  reopen_budget_started="${backup_pause_started}"
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    # The normal release mutation budget starts after checkpoint verification.
    # Keep the full maintenance start above for its separate pause measurement.
    reopen_budget_started="${restore_mutation_started}"
  fi
  original_start_command=start-original
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then original_start_command=start-restored; fi
  run_system_recovery_postowner node "${OPERATIONS_ROOT}/deploy/scripts/capture-only-release.mjs" "${original_start_command}" \
    "${backup_snapshot}" "${ENV_FILE}" "${REPO_ROOT}/${COMPOSE_FILE}" 300 "${reopen_budget_started}" "${SESSION_HOST_PATH}"
  run_system_recovery_postowner verify_system_recovery_reopened_configuration
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    capture_system_recovery_runtime_after
    SYSTEM_RECOVERY_GATES_CONTAINER="sabalanerp-recovery-gates-${DEPLOYMENT_ID}"
    export SYSTEM_RECOVERY_GATES_CONTAINER
    DEPLOYMENT_GATE_MODE=APPLICATION_RECOVERY run_system_recovery_postowner run_backend node dist/scripts/deployment-gates.js
  else
    DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_original_owned_with_heartbeat run_backend node dist/scripts/deployment-gates.js
  fi
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then phase GATES_PASSED; fi
  run_system_recovery_postowner verify_public_maintenance
  run_system_recovery_postowner assert_system_recovery_advisory
  run_system_recovery_postowner control heartbeat
  node -e 'if(process.hrtime.bigint()-BigInt(process.argv[1])>=900000000000n)process.exit(1)' "${reopen_budget_started}"
  PUBLIC_TRAFFIC_OPEN=1
  control maintenance-off
  if [ "${SYSTEM_RECOVERY_OWNER_ACTION:-BACKUP}" = RESTORE ]; then
    phase TRAFFIC_OPENED
    DEPLOYMENT_PHASE=COMPLETED DEPLOYMENT_RESULT=COMPLETED control finish
  else
    DEPLOYMENT_PHASE=ABORTED DEPLOYMENT_RESULT=ABORTED control finish
  fi
  MAINTENANCE_ACTIVE=0
  node "${SYSTEM_RECOVERY_BACKUP_HOST}" clear "${SYSTEM_RECOVERY_BACKUP_INTENT}" "${DEPLOYMENT_ID}" "${SYSTEM_RECOVERY_OPERATION_ID}"
  cleanup_locks
  trap - EXIT INT TERM HUP
  echo 'System Recovery backup completed. The verified original release reopened.'
}
