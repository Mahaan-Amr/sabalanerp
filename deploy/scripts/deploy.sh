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

echo "Building images..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml build

echo "Starting database first..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d postgres

echo "Applying Prisma migrations..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy

echo "Starting full stack..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d

echo "Deployment completed."
