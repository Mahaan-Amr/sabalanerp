set -eu
cd /opt/sabalanerp
git status --short --branch
git fetch origin >/dev/null 2>&1
git rev-parse HEAD origin/main origin/ferpheri
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps 2>/dev/null
df -h / /mnt/sabalanerp-recovery-docker
flock -n .deploy-state/deployment.lock -c true && echo HOST_LOCK_FREE
awk -F= '$1=="SMS_IR_CONTRACT_CANCEL_TEMPLATE_ID" {print $1"="$2}' deploy/.env.prod
