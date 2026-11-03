#!/bin/sh
set -eu
cd /opt/sabalanerp
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps >/dev/null
docker cp reports/qa/deploy-20261013-safe-cleanup.cjs sabalanerp-backend-1:/tmp/deploy-safe-cleanup.cjs
docker exec sabalanerp-backend-1 node /tmp/deploy-safe-cleanup.cjs --inventory > reports/qa/deploy-20261014-cleanup-inventory.json