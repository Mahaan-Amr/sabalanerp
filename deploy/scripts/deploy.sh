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

echo "Building images..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml build

echo "Starting database first..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d postgres

BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="${BACKUP_DIR}/sabalanerp-before-deploy-${BACKUP_TIMESTAMP}.dump"
BACKUP_TMP_PATH="${BACKUP_PATH}.tmp"

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

echo "Starting full stack..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d --force-recreate --no-deps nginx

echo "Deployment completed."
