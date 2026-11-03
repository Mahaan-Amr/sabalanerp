set -eu
cd /opt/sabalanerp
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps 2>/dev/null
if flock -n .deploy-state/deployment.lock -c true; then echo HOST_LOCK_FREE; else echo HOST_LOCK_BUSY; exit 1; fi
docker cp reports/qa/deploy-20261012-safe-status.cjs sabalanerp-backend-1:/tmp/deploy-safe-status.cjs
docker exec sabalanerp-backend-1 node /tmp/deploy-safe-status.cjs
remote=$(awk -F= '$1=="DEPLOYMENT_REMOTE_MOUNT_HOST" {sub(/^[^=]*=/, "");print;exit}' deploy/.env.prod)
mountpoint "$remote"
test -d "$remote" && test -r "$remote" && test -w "$remote"
printf 'host remote storage accessible\n'
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/deployment-remote"}}{{.Source}} {{.Destination}}{{end}}{{end}}' sabalanerp-backend-1
docker exec sabalanerp-backend-1 node -e 'const fs=require("fs");const p="/app/deployment-remote";fs.accessSync(p,fs.constants.R_OK|fs.constants.W_OK);console.log("Docker remote storage accessible");'
df -Pk / "$remote"
