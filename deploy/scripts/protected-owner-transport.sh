#!/bin/sh
# Shared native command transport. Source only from a protected owner.

protected_backend_run() {
  backend_pull_policy=""
  if [ "${SYSTEM_RECOVERY_BACKUP:-0}" -eq 1 ] || [ "${PROTECTED_BACKEND_NO_PULL:-0}" -eq 1 ]; then backend_pull_policy="--pull=never"; fi
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
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run -T --rm --no-deps ${backend_pull_policy} ${owner_container_option} \
      --label "io.sabalan.deployment.id=${DEPLOYMENT_ID}" \
      -e "BACKEND_RUNTIME_ROLE=control" \
      -e DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX \
      -e DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX \
      -e "DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256=${DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_REPAIR=${DEPLOYMENT_CLAMAV_REPAIR}" \
      -e "DEPLOYMENT_CLAMAV_OPERATION=${DEPLOYMENT_CLAMAV_OPERATION}" \
      -e "DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256=${DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256:-}" \
      -e "DEPLOYMENT_CLAMAV_TARGET_IMAGE=${DEPLOYMENT_CLAMAV_TARGET_IMAGE}" \
      -e "DEPLOYMENT_ID=${DEPLOYMENT_ID}" \
      -e "DEPLOYMENT_MODE=${DEPLOYMENT_MODE}" \
      -e "DEPLOYMENT_RELEASE_ID=${DEPLOYMENT_RELEASE_ID}" \
      -e "DEPLOYMENT_TARGET_COMMIT=${DEPLOYMENT_TARGET_COMMIT}" \
      -e "DEPLOYMENT_LEASE_TOKEN=${DEPLOYMENT_LEASE_TOKEN:-}" \
      -e "DEPLOYMENT_OWNER=${DEPLOYMENT_OWNER}" \
      -e "DEPLOYMENT_PHASE=${DEPLOYMENT_PHASE:-}" \
      -e "DEPLOYMENT_RESULT=${DEPLOYMENT_RESULT:-}" \
      -e "DEPLOYMENT_ORIGINAL_RESULT=${DEPLOYMENT_ORIGINAL_RESULT:-}" \
      -e "DEPLOYMENT_GATE_MODE=${DEPLOYMENT_GATE_MODE:-}" \
      -e "SYSTEM_RECOVERY_OPERATION_ID=${SYSTEM_RECOVERY_OPERATION_ID:-}" \
      -e "SYSTEM_RECOVERY_POSTGRES_IMAGE_ID=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
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

protected_env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

protected_public_maintenance() {
  domain="$(env_value DOMAIN)"
  inquiry_domain="$(env_value INQUIRY_DOMAIN)"
  for public_domain in "${domain}" "${inquiry_domain}"; do
    status="$(curl -k -sS -o /dev/null -w '%{http_code}' "https://${public_domain}/" || true)"
    [ "${status}" = "503" ] || { echo "Maintenance boundary was not proven for ${public_domain} (HTTP ${status})." >&2; return 1; }
  done
}

protected_advisory_owned() {
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
