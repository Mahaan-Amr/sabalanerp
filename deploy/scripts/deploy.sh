#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${1:-deploy/.env.prod}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

cd "${REPO_ROOT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}"
  echo "Copy deploy/.env.prod.template to deploy/.env.prod and fill values."
  exit 1
fi

if [ ! -d ".git" ]; then
  echo "This deployment script must be run inside a git repository clone."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has local changes. Commit/stash them before running deploy."
  exit 1
fi

echo "Fetching latest code from ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}..."
git fetch --prune "${DEPLOY_REMOTE}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}"
git submodule update --init --recursive

upsert_env_value() {
  key="$1"
  value="$2"
  temp_file="${ENV_FILE}.tmp.$$"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { prefix = "^" key "="; written = 0 }
    $0 ~ prefix {
      if (!written) print key "=" value
      written = 1
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "${ENV_FILE}" > "${temp_file}"
  chmod 600 "${temp_file}"
  mv "${temp_file}" "${ENV_FILE}"
}

echo "Synchronizing approved SMS.ir dispatch template IDs..."
upsert_env_value SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID 173656
upsert_env_value SMS_IR_DISPATCH_EXIT_TEMPLATE_ID 153829
upsert_env_value SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID 3429496

echo "Building images..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml build

echo "Starting database and antivirus services first..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d postgres clamav

BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="${BACKUP_DIR}/sabalanerp-before-deploy-${BACKUP_TIMESTAMP}.dump"
BACKUP_TMP_PATH="${BACKUP_PATH}.tmp"
MIGRATION_REPORT_DIR="${MIGRATION_REPORT_DIR:-reports/deploy}"
MIGRATION_REPORT_NAME="contract-product-graph-dry-run-${BACKUP_TIMESTAMP}.json"

mkdir -p "${BACKUP_DIR}"
echo "Creating pre-migration database backup: ${BACKUP_PATH}"
if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  > "${BACKUP_TMP_PATH}"; then
  rm -f "${BACKUP_TMP_PATH}"
  echo "Database backup failed. Deployment aborted before migrations."
  exit 1
fi

if [ ! -s "${BACKUP_TMP_PATH}" ]; then
  rm -f "${BACKUP_TMP_PATH}"
  echo "Database backup is empty. Deployment aborted before migrations."
  exit 1
fi

if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml exec -T postgres \
  pg_restore --list < "${BACKUP_TMP_PATH}" > /dev/null; then
  rm -f "${BACKUP_TMP_PATH}"
  echo "Database backup is not a readable PostgreSQL custom-format archive. Deployment aborted before migrations."
  exit 1
fi

mv "${BACKUP_TMP_PATH}" "${BACKUP_PATH}"
echo "Database backup completed: ${BACKUP_PATH}"

echo "Applying Prisma migrations..."
if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm backend npm run db:migrate:deploy; then
  echo "Database migration failed. The verified backup is retained at ${BACKUP_PATH}."
  echo "The application stack was not recreated. Do not run prisma migrate reset on this database."
  exit 1
fi

echo "Running the read-only contract product graph migration audit..."
mkdir -p "${MIGRATION_REPORT_DIR}"
if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm \
  -v "${REPO_ROOT}/${MIGRATION_REPORT_DIR}:/migration-report" \
  -e CONTRACT_GRAPH_BACKUP_REFERENCE="${BACKUP_PATH}" \
  backend node dist/scripts/dry-run-contract-product-graph-migration.js \
  --output="/migration-report/${MIGRATION_REPORT_NAME}"; then
  echo "Contract product graph dry-run found unexplained financial drift or broken relationships."
  echo "Review the full report at ${MIGRATION_REPORT_DIR}/${MIGRATION_REPORT_NAME}."
  echo "Deployment stopped. The verified backup is retained at ${BACKUP_PATH}."
  exit 1
fi
echo "Contract product graph dry-run report: ${MIGRATION_REPORT_DIR}/${MIGRATION_REPORT_NAME}"

echo "Starting full stack..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d --force-recreate --no-deps nginx

echo "Verifying HR document antivirus scanning..."
if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml exec -T backend sh -c '
  set -eu
  test "${HR_HIRING_ANTIVIRUS_COMMAND:-}" = "/app/scripts/hr-clamdscan.sh"
  command -v clamdscan >/dev/null
  test -x "${HR_HIRING_ANTIVIRUS_COMMAND}"
  test_file="/tmp/sabalanerp-antivirus-healthcheck.txt"
  printf "Sabalan ERP clean antivirus deployment check\n" > "${test_file}"
  if ! "${HR_HIRING_ANTIVIRUS_COMMAND}" "${test_file}"; then
    rm -f "${test_file}"
    exit 1
  fi
  rm -f "${test_file}"
'; then
  echo "HR document antivirus verification failed."
  echo "Inspect it with: docker compose --env-file ${ENV_FILE} -f docker-compose.prod.yml logs clamav backend"
  exit 1
fi

echo "Deployment completed. HR document antivirus scanning and the contract graph migration audit are healthy."
