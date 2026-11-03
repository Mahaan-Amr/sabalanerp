set -eu
umask 077
cd /opt/sabalanerp
evidence=/opt/sabalanerp-staging/incident-preflight-20261020
mkdir -p "$evidence"
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps > "$evidence/live-before.txt" 2>&1
docker exec sabalanerp-backend-1 node dist/scripts/dry-run-contract-product-graph-migration.js --output=/tmp/incident-contract-graph-preflight.json > "$evidence/contract-graph.json" 2>&1
docker exec sabalanerp-backend-1 node dist/scripts/audit-hr-onboarding-task-retirement.js --output=/tmp/incident-onboarding-preflight.json > "$evidence/onboarding.json" 2>&1
docker exec sabalanerp-backend-1 node dist/scripts/reconcile-contract-financial-evidence.js --output=/tmp/incident-financial-preflight.json > "$evidence/financial.json" 2>&1
cat "$evidence/contract-graph.json" "$evidence/onboarding.json" "$evidence/financial.json"
