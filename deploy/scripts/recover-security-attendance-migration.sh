#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${1:-deploy/.env.prod}"
MIGRATION_NAME="20260720000100_security_report_attendance_operations"

cd "${REPO_ROOT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has local changes. Commit/stash them before recovery."
  exit 1
fi

echo "Starting PostgreSQL without recreating application containers..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d postgres

echo "Marking only the failed ${MIGRATION_NAME} migration as rolled back..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm backend \
  npx prisma migrate resolve --rolled-back "${MIGRATION_NAME}"

echo "The failed marker is cleared. Running the normal backup-first deployment..."
exec sh deploy/scripts/deploy.sh "${ENV_FILE}"
