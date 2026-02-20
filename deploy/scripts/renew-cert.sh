#!/bin/sh
set -eu

echo "Running certbot renew..."
docker compose -f docker-compose.prod.yml run --rm certbot renew --webroot -w /var/www/certbot

echo "Reloading nginx..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
echo "Renewal complete."
