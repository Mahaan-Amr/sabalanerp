#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${1:-deploy/.env.prod}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE_FILE="docker-compose.prod.yml"
ADVISORY_LOCK_KEY="741936425"
LOCK_FILE="${REPO_ROOT}/.deploy-state/deployment.lock"
ADVISORY_PID=""
ADVISORY_APPLICATION_NAME=""
MUTATION_STARTED=0
BOOTSTRAP=0
SESSION_PREPARED=0
MAINTENANCE_ACTIVE=0
FINISHED=0
DRAINED_EARLY=0
DB_LEASE_ACQUIRED=0
PUBLIC_TRAFFIC_OPEN=0
ROLLBACK_ALREADY_ATTEMPTED=0

cd "${REPO_ROOT}"

env_value() {
  key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command is missing: $1" >&2; exit 1; }
}

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

start_release_services() {
  wait_seconds="$1"
  compose up -d --no-build --wait --wait-timeout "${wait_seconds}" postgres clamav backend frontend inquiry nginx
  # Nginx resolves Compose service names when its workers start. Recreate it
  # after application containers have their final addresses so rollout and
  # rollback cannot reopen traffic through stale upstream IPs.
  compose up -d --no-deps --force-recreate --wait --wait-timeout "${wait_seconds}" nginx
}

run_backend() {
  DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_TARGET_BACKEND_IMAGE}" BACKEND_DB_CONNECTION_LIMIT=2 DATABASE_APPLICATION_NAME=sabalanerp-deployment \
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm --no-deps \
      -e "DEPLOYMENT_ID=${DEPLOYMENT_ID}" \
      -e "DEPLOYMENT_RELEASE_ID=${DEPLOYMENT_RELEASE_ID}" \
      -e "DEPLOYMENT_TARGET_COMMIT=${DEPLOYMENT_TARGET_COMMIT}" \
      -e "DEPLOYMENT_OWNER=${DEPLOYMENT_OWNER}" \
      -e "DEPLOYMENT_PHASE=${DEPLOYMENT_PHASE:-}" \
      -e "DEPLOYMENT_RESULT=${DEPLOYMENT_RESULT:-}" \
      -e "DEPLOYMENT_ORIGINAL_RESULT=${DEPLOYMENT_ORIGINAL_RESULT:-}" \
      -e "DEPLOYMENT_GATE_MODE=${DEPLOYMENT_GATE_MODE:-}" \
      -e "DEPLOYMENT_LEASE_MS=1200000" \
      -e "DEPLOYMENT_CONTROL_IMAGE=${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=${DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP:-false}" \
      -e "DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_NGINX_IMAGE=${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}" \
      -e "INQUIRY_ALREADY_DRAINED=true" \
      deployment "$@"
}

run_backend_timed() {
  duration="$1"
  shift
  timeout "${duration}" env \
    DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
    BACKEND_DB_CONNECTION_LIMIT=2 \
    DATABASE_APPLICATION_NAME=sabalanerp-deployment \
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm --no-deps \
      -e "DEPLOYMENT_ID=${DEPLOYMENT_ID}" \
      -e "DEPLOYMENT_RELEASE_ID=${DEPLOYMENT_RELEASE_ID}" \
      -e "DEPLOYMENT_TARGET_COMMIT=${DEPLOYMENT_TARGET_COMMIT}" \
      -e "DEPLOYMENT_OWNER=${DEPLOYMENT_OWNER}" \
      -e "DEPLOYMENT_LEASE_MS=1200000" \
      -e "DEPLOYMENT_CONTROL_IMAGE=${DEPLOYMENT_TARGET_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=${DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP:-false}" \
      -e "DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_NGINX_IMAGE=${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}" \
      -e "DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}" \
      -e "INQUIRY_ALREADY_DRAINED=true" \
      deployment "$@"
}

run_backend_timed_with_heartbeat() {
  duration="$1"
  shift
  run_backend_timed "${duration}" "$@" &
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

control() {
  run_backend node dist/scripts/deployment-control.js "$@"
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

drain_current_services() {
  old_backend_container="$(compose ps -q backend)"
  old_backend_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${old_backend_container}")"
  compose stop -t 30 frontend backend inquiry
  remaining_old_sessions="$(compose exec -T postgres sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT count(*) FROM pg_stat_activity WHERE client_addr = '${old_backend_ip}'::inet\"")"
  [ "${remaining_old_sessions}" = "0" ] || { echo "The previous backend retained ${remaining_old_sessions} database sessions after drain." >&2; return 1; }
  utilization="$(compose exec -T postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT round(100.0 * count(*) / current_setting('"'"'max_connections'"'"')::int, 2) FROM pg_stat_activity"')"
  awk -v value="${utilization}" 'BEGIN { exit !(value < 85) }' || { echo "Database connection utilization remains ${utilization}% after drain; mutation is forbidden." >&2; return 1; }
}

drain_release_for_rollback() {
  rollback_backend_container="$(compose ps -q backend || true)"
  rollback_backend_ip=""
  if [ -n "${rollback_backend_container}" ]; then
    rollback_backend_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${rollback_backend_container}")"
  fi
  compose stop -t 30 frontend backend inquiry
  if [ -n "${rollback_backend_ip}" ]; then
    rollback_sessions="$(compose exec -T postgres sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT count(*) FROM pg_stat_activity WHERE client_addr = '${rollback_backend_ip}'::inet\"")"
    [ "${rollback_sessions}" = "0" ] || { echo "The failed release retained ${rollback_sessions} database sessions; rollback promotion is unsafe." >&2; return 1; }
  fi
}

try_acquire_advisory() {
  lock_token="SABALAN_DEPLOYMENT_LOCK_${DEPLOYMENT_ID}"
  ADVISORY_APPLICATION_NAME="sabalan-lock-${DEPLOYMENT_ID}"
  rm -f "${REPO_ROOT}/.deploy-state/advisory-lock.log"
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T \
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

switch_to_previous_images() {
  DEPLOYMENT_BACKEND_IMAGE="${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}"
  DEPLOYMENT_FRONTEND_IMAGE="${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}"
  DEPLOYMENT_INQUIRY_IMAGE="${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}"
  DEPLOYMENT_NGINX_IMAGE="${DEPLOYMENT_PREVIOUS_NGINX_IMAGE}"
  DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
  DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
  export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE
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

recover_failure() {
  exit_code="$1"
  trap - EXIT INT TERM
  echo "Deployment failed; entering deterministic recovery (exit ${exit_code})." >&2

  if [ "${SESSION_PREPARED}" -eq 0 ]; then
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
    control maintenance-on || true
    MAINTENANCE_ACTIVE=1
    switch_to_previous_images
    if start_release_services 300 \
      && DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_backend node dist/scripts/deployment-gates.js; then
      control maintenance-off || true
      MAINTENANCE_ACTIVE=0
      if [ "${DB_LEASE_ACQUIRED}" -eq 1 ]; then
        finish_with_notification_result ABORTED || true
      else
        control cancel-preflight || true
        DEPLOYMENT_RESULT=ABORTED run_backend node dist/scripts/deployment-notify.js || true
      fi
      cleanup_locks
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
  if drain_release_for_rollback; then
    DEPLOYMENT_PHASE="ROLLBACK_STARTED"
    export DEPLOYMENT_PHASE
    if [ "${BOOTSTRAP}" -eq 1 ]; then control local-transition || true; else control transition || true; fi
  fi

  if [ "${DEPLOYMENT_PHASE:-}" = "ROLLBACK_STARTED" ] \
    && run_backend node dist/scripts/deployment-rollback.js \
    && run_backend node dist/scripts/deployment-finalize-recovery.js; then
    switch_to_previous_images
    if start_release_services 300 \
      && DEPLOYMENT_GATE_MODE=ROLLBACK run_backend node dist/scripts/deployment-gates.js; then
      control maintenance-off
      MAINTENANCE_ACTIVE=0
      finish_with_notification_result ROLLED_BACK || true
      cleanup_locks
      echo "Automatic rollback completed and the verified previous release was reopened." >&2
      exit "${exit_code}"
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

for command in git docker awk curl df flock grep mkdir node timeout; do require_command "${command}"; done

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

if [ -f "${SESSION_HOST_PATH}" ]; then
  echo "An interrupted deployment journal was found; automatic recovery runs before any new deployment." >&2
  DEPLOYMENT_ID="$(session_value deploymentId)"
  DEPLOYMENT_RELEASE_ID="$(session_value releaseId)"
  DEPLOYMENT_TARGET_COMMIT="$(session_value targetCommit)"
  DEPLOYMENT_OWNER="$(session_value owner)"
  DEPLOYMENT_PHASE="$(session_value phase)"
  DEPLOYMENT_TARGET_BACKEND_IMAGE="$(session_value controlImage)"
  DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="$(session_value rollbackReleaseSet.backend)"
  DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="$(session_value rollbackReleaseSet.frontend)"
  DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="$(session_value rollbackReleaseSet.inquiry)"
  DEPLOYMENT_PREVIOUS_NGINX_IMAGE="$(session_value rollbackReleaseSet.nginx)"
  DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="$(session_value rollbackReleaseSet.postgres)"
  DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="$(session_value rollbackReleaseSet.clamav)"
  bootstrap_value="$(session_value bootstrap)"
  [ "${bootstrap_value}" = "true" ] && BOOTSTRAP=1 || BOOTSTRAP=0
  export DEPLOYMENT_ID DEPLOYMENT_RELEASE_ID DEPLOYMENT_TARGET_COMMIT DEPLOYMENT_OWNER DEPLOYMENT_PHASE DEPLOYMENT_TARGET_BACKEND_IMAGE
  export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE
  SESSION_PREPARED=1
  [ "${DEPLOYMENT_PHASE}" = "PREFLIGHT" ] || DB_LEASE_ACQUIRED=1
  switch_to_previous_images
  compose up -d postgres clamav
  try_acquire_advisory || { echo "Interrupted deployment recovery cannot acquire its PostgreSQL advisory lease." >&2; exit 1; }
  control maintenance-on
  MAINTENANCE_ACTIVE=1
  drain_release_for_rollback
  case "${DEPLOYMENT_PHASE}" in
    PREFLIGHT|LEASE_ACQUIRED|MAINTENANCE_REQUESTED|TRAFFIC_BLOCKED|SERVICES_DRAINED|LOCAL_CHECKPOINT_VERIFIED|REMOTE_CHECKPOINT_VERIFIED)
      if start_release_services 300 \
        && DEPLOYMENT_GATE_MODE=PREVIOUS_UNCHANGED run_backend node dist/scripts/deployment-gates.js; then
        control maintenance-off
        MAINTENANCE_ACTIVE=0
        if [ "${DEPLOYMENT_PHASE}" = "PREFLIGHT" ]; then control cancel-preflight; else DEPLOYMENT_PHASE=ABORTED control finish; fi
        DEPLOYMENT_RESULT=ABORTED run_backend node dist/scripts/deployment-notify.js || true
        cleanup_locks
        trap - EXIT INT TERM
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

echo "Fetching ${DEPLOY_REMOTE}/${DEPLOY_BRANCH} and requiring a fast-forward update..."
git fetch --prune "${DEPLOY_REMOTE}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}"
git submodule update --init --recursive

DEPLOYMENT_TARGET_COMMIT="$(git rev-parse HEAD)"
DEPLOYMENT_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
DEPLOYMENT_ID="deploy-${DEPLOYMENT_RELEASE_ID}"
APP_COMMIT="${DEPLOYMENT_TARGET_COMMIT}"
export DEPLOYMENT_TARGET_COMMIT DEPLOYMENT_RELEASE_ID DEPLOYMENT_ID DEPLOYMENT_OWNER APP_COMMIT

backend_repository="$(env_value DEPLOYMENT_BACKEND_IMAGE_REPOSITORY)"
frontend_repository="$(env_value DEPLOYMENT_FRONTEND_IMAGE_REPOSITORY)"
inquiry_repository="$(env_value DEPLOYMENT_INQUIRY_IMAGE_REPOSITORY)"
[ -n "${backend_repository}" ] && [ -n "${frontend_repository}" ] && [ -n "${inquiry_repository}" ] || {
  echo "Immutable image repositories are mandatory." >&2
  exit 1
}

DEPLOYMENT_PREVIOUS_BACKEND_IMAGE="$(image_of_service backend)"
DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE="$(image_of_service frontend)"
DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE="$(image_of_service inquiry)"
DEPLOYMENT_PREVIOUS_NGINX_IMAGE="$(image_of_service nginx)"
DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE="$(image_of_service postgres)"
DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE="$(image_of_service clamav)"
export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE DEPLOYMENT_PREVIOUS_NGINX_IMAGE DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE

backend_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_BACKEND_IMAGE}")"
frontend_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE}")"
inquiry_image_size="$(docker image inspect --format '{{.Size}}' "${DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE}")"
docker_required_bytes=$((backend_image_size + frontend_image_size + inquiry_image_size + 1073741824))
docker_root="$(docker info --format '{{.DockerRootDir}}')"
docker_available_kb="$(df -Pk "${docker_root}" | awk 'NR==2 {print $4}')"
docker_available_bytes=$((docker_available_kb * 1024))
if [ "${docker_available_bytes}" -lt "${docker_required_bytes}" ]; then
  echo "Build capacity is low; pruning only unreferenced builder cache older than seven days."
  docker builder prune --force --filter until=168h >"${REPO_ROOT}/.deploy-state/builder-prune.log"
  docker_available_kb="$(df -Pk "${docker_root}" | awk 'NR==2 {print $4}')"
  docker_available_bytes=$((docker_available_kb * 1024))
fi
[ "${docker_available_bytes}" -ge "${docker_required_bytes}" ] || {
  echo "Immutable image build needs ${docker_required_bytes} bytes but only ${docker_available_bytes} are safely available." >&2
  exit 1
}

DEPLOYMENT_BACKEND_IMAGE="${backend_repository}:${DEPLOYMENT_TARGET_COMMIT}"
DEPLOYMENT_FRONTEND_IMAGE="${frontend_repository}:${DEPLOYMENT_TARGET_COMMIT}"
DEPLOYMENT_INQUIRY_IMAGE="${inquiry_repository}:${DEPLOYMENT_TARGET_COMMIT}"
DEPLOYMENT_NGINX_IMAGE="nginx:1.27-alpine"
DEPLOYMENT_POSTGRES_IMAGE="${DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE}"
DEPLOYMENT_CLAMAV_IMAGE="${DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE}"
export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE DEPLOYMENT_POSTGRES_IMAGE DEPLOYMENT_CLAMAV_IMAGE

compose config --quiet
echo "Building immutable release ${DEPLOYMENT_RELEASE_ID} before maintenance..."
compose build backend frontend inquiry
DEPLOYMENT_BACKEND_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_BACKEND_IMAGE}")"
DEPLOYMENT_FRONTEND_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_FRONTEND_IMAGE}")"
DEPLOYMENT_INQUIRY_IMAGE="$(docker image inspect --format '{{.Id}}' "${DEPLOYMENT_INQUIRY_IMAGE}")"
DEPLOYMENT_NGINX_IMAGE="$(docker image inspect --format '{{.Id}}' nginx:1.27-alpine)"
export DEPLOYMENT_BACKEND_IMAGE DEPLOYMENT_FRONTEND_IMAGE DEPLOYMENT_INQUIRY_IMAGE DEPLOYMENT_NGINX_IMAGE
DEPLOYMENT_TARGET_BACKEND_IMAGE="${DEPLOYMENT_BACKEND_IMAGE}"
export DEPLOYMENT_TARGET_BACKEND_IMAGE

run_backend node dist/scripts/deployment-drill-preflight.js

compose up -d postgres clamav
control prepare
SESSION_PREPARED=1

if ! try_acquire_advisory; then
  echo "Database connections are saturated; entering journaled maintenance to drain the previous backend automatically." >&2
  compose up -d --no-deps --force-recreate nginx
  control maintenance-on
  MAINTENANCE_ACTIVE=1
  verify_public_maintenance
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
  BOOTSTRAP=1
  DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP=true
  export DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP
  control bootstrap-enable
elif [ "${acquire_code}" -ne 0 ]; then
  exit "${acquire_code}"
fi
DB_LEASE_ACQUIRED=1

phase MAINTENANCE_REQUESTED
if [ "${DRAINED_EARLY}" -eq 0 ]; then
  compose up -d --no-deps --force-recreate nginx
  control maintenance-on
  MAINTENANCE_ACTIVE=1
  verify_public_maintenance
fi
phase TRAFFIC_BLOCKED
if [ "${DRAINED_EARLY}" -eq 0 ]; then drain_current_services; fi
phase SERVICES_DRAINED

postgres_available_kb="$(compose exec -T postgres sh -c 'df -Pk "$PGDATA" | awk "NR==2 {print \$4}"')"
postgres_database_bytes="$(compose exec -T postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
postgres_required_bytes=$((postgres_database_bytes * 5 / 4 + 536870912))
postgres_available_bytes=$((postgres_available_kb * 1024))
[ "${postgres_available_bytes}" -ge "${postgres_required_bytes}" ] || {
  echo "PostgreSQL staging requires ${postgres_required_bytes} bytes but only ${postgres_available_bytes} are available." >&2
  exit 1
}

echo "Creating, decrypt-validating, uploading, and reading back the coordinated checkpoint..."
checkpoint_timeout="$(env_value DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS)"
checkpoint_timeout="${checkpoint_timeout:-3600}"
case "${checkpoint_timeout}" in
  *[!0-9]*|'') echo "DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS must be an integer." >&2; exit 1 ;;
esac
[ "${checkpoint_timeout}" -ge 600 ] && [ "${checkpoint_timeout}" -le 7200 ] || {
  echo "DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS must be between 600 and 7200 seconds." >&2
  exit 1
}
run_backend_timed_with_heartbeat "${checkpoint_timeout}" node dist/scripts/deployment-checkpoint.js
phase LOCAL_CHECKPOINT_VERIFIED
phase REMOTE_CHECKPOINT_VERIFIED

phase MUTATION_STARTED
MUTATION_STARTED=1
mutation_started_at="$(date +%s)"

echo "Applying migrations with a two-connection deployment identity..."
remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" npm run db:migrate:deploy
if [ "${BOOTSTRAP}" -eq 1 ]; then
  DEPLOYMENT_PHASE=MIGRATIONS_APPLIED
  export DEPLOYMENT_PHASE
  control local-transition
  control bootstrap-adopt
  BOOTSTRAP=0
else
  phase MIGRATIONS_APPLIED
fi

mkdir -p "${DEPLOYMENT_REPORT_DIR_HOST}"
audit_name="contract-product-graph-${DEPLOYMENT_ID}.json"
remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/dry-run-contract-product-graph-migration.js --output="/app/deployment-reports/${audit_name}"

phase RELEASE_STARTED
remaining="$(remaining_mutation_seconds)" || exit 1
start_release_services "${remaining}"

remaining="$(remaining_mutation_seconds)" || exit 1
run_backend_timed "${remaining}" node dist/scripts/deployment-gates.js
remaining="$(remaining_mutation_seconds)" || exit 1
timeout "${remaining}" docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend sh -c '
  set -eu
  test "${HR_HIRING_ANTIVIRUS_COMMAND:-}" = "/app/scripts/hr-clamdscan.sh"
  command -v clamdscan >/dev/null
  test_file="/tmp/sabalanerp-antivirus-deployment-gate.txt"
  printf "Sabalan ERP antivirus deployment gate\n" > "${test_file}"
  "${HR_HIRING_ANTIVIRUS_COMMAND}" "${test_file}"
  rm -f "${test_file}"
'
remaining_mutation_seconds >/dev/null
phase GATES_PASSED

phase TRAFFIC_OPENED
control maintenance-off
MAINTENANCE_ACTIVE=0
PUBLIC_TRAFFIC_OPEN=1
finish_with_notification_result COMPLETED

FINISHED=1
cleanup_locks
trap - EXIT INT TERM
echo "Deployment ${DEPLOYMENT_ID} completed with verified local/remote checkpoints and all mandatory gates passed."
