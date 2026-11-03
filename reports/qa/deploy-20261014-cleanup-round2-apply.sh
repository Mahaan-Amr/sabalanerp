#!/bin/sh
set -eu
cd /opt/sabalanerp
exec 9>.deploy-state/deployment.lock
flock -n 9
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps >/dev/null 2>&1
docker cp reports/qa/deploy-20261014-cleanup-round2-proof.json sabalanerp-backend-1:/tmp/deploy-cleanup-proof-20261014.json
docker exec sabalanerp-backend-1 node /tmp/deploy-safe-cleanup.cjs --plan /tmp/deploy-cleanup-proof-20261014.json > reports/qa/deploy-20261014-cleanup-round2-plan.json
docker exec sabalanerp-backend-1 node /tmp/deploy-safe-cleanup.cjs --apply /tmp/deploy-cleanup-proof-20261014.json > reports/qa/deploy-20261014-cleanup-round2-result.json
df -Pk / > reports/qa/deploy-20261014-cleanup-round2-free.log