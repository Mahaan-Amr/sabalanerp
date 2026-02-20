#!/bin/sh
set -eu

ENV_FILE="${1:-deploy/.env.prod}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}"
  echo "Copy deploy/.env.prod.template to deploy/.env.prod and fill values."
  exit 1
fi

echo "Building images..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml build

echo "Starting database first..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d postgres

echo "Applying Prisma migrations..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy

echo "Starting full stack..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d

echo "Deployment completed."
