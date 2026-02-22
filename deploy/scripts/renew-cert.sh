#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${1:-deploy/.env.prod}"

cd "${REPO_ROOT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

echo "Running certbot renew..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm certbot renew --webroot -w /var/www/certbot

echo "Reloading nginx..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml exec nginx nginx -s reload
echo "Renewal complete."
