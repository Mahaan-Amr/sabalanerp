set -eu
cd /opt/sabalanerp
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml ps >/dev/null 2>&1
img=$(docker inspect --format '{{.Image}}' sabalanerp-backend-1)
DEPLOYMENT_BACKEND_IMAGE=$img docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml run -T --rm --no-deps deployment node -e 'const fs=require("fs");const p="/app/deployment-remote";fs.accessSync(p,fs.constants.R_OK|fs.constants.W_OK);const f=p+"/.codex-preflight-20261012-"+process.pid;fs.writeFileSync(f,"SabalanERP preflight\n",{flag:"wx"});if(fs.readFileSync(f,"utf8")!=="SabalanERP preflight\n")throw new Error("readback mismatch");fs.unlinkSync(f);console.log("OFFSERVER_DOCKER_READ_WRITE_READBACK_OK");'
df -Pk / /mnt/sabalanerp-recovery-docker
