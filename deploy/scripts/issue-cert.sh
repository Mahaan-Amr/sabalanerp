#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${3:-deploy/.env.prod}"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <domain> <email> [env-file]"
  exit 1
fi

DOMAIN="$1"
EMAIL="$2"

cd "${REPO_ROOT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

echo "Creating temporary certificate for bootstrap..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN} && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj '/CN=localhost'"

echo "Starting nginx for ACME challenge..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml up -d nginx

echo "Requesting Let's Encrypt certificate..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}"

echo "Reloading nginx with issued certificate..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.prod.yml exec nginx nginx -s reload
echo "Certificate issuance complete."
