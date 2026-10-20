#!/bin/sh
set -eu
for command in ssh findmnt; do command -v "$command" >/dev/null 2>&1 || { echo 'STORAGE_REQUIRED_COMMAND_MISSING' >&2; exit 1; }; done
# Called by deploy.sh while descriptor 9 owns the deployment lock.
env_file="$1"
repo_root="$2"
operations_root="$3"
required_local="$4"
required_remote="$5"
# Validate the actual distinct operations identity before any cleanup request.
# Inspection only reads local prerequisites under this inherited host lock.
node "$operations_root/deploy/scripts/backup-retention-host.mjs" --inspect "$env_file"
case "$required_local:$required_remote" in *[!0-9:]*) echo 'STORAGE_CAPACITY_INVALID' >&2; exit 1;; esac
env_value() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$env_file"; }
backup_host="$(env_value DEPLOYMENT_BACKUP_HOST)"
backup_user="$(env_value DEPLOYMENT_BACKUP_USER)"
operations_user="$(env_value DEPLOYMENT_BACKUP_OPERATIONS_USER)"
backup_key="$(env_value DEPLOYMENT_BACKUP_SSH_KEY_FILE)"
operations_key="$(env_value DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE)"
backup_known_hosts="$(env_value DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE)"
remote_root="$(env_value DEPLOYMENT_REMOTE_MOUNT_HOST)"
report_root="$(env_value DEPLOYMENT_REPORT_DIR_HOST)"
project="$(docker compose --env-file "$env_file" -f "$repo_root/docker-compose.prod.yml" config --format json | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).name))')"
case "$project" in ''|*[!a-z0-9_-]*) echo 'STORAGE_PROJECT_INVALID' >&2; exit 1;; esac
for value in "$backup_host" "$backup_user" "$operations_user"; do
  case "$value" in ''|-*|*[!a-zA-Z0-9._:-]*) echo 'STORAGE_BACKUP_HOST_INVALID' >&2; exit 1;; esac
done
[ "$backup_user" = sabalan-backup ] && [ "$operations_user" = sabalan-backup-ops ] || { echo 'STORAGE_BACKUP_ACCOUNT_INVALID' >&2; exit 1; }
[ -r "$backup_key" ] && [ -r "$operations_key" ] && [ -r "$backup_known_hosts" ] || { echo 'STORAGE_BACKUP_KEY_MISSING' >&2; exit 1; }
recovery_root="$(docker volume inspect "${project}_backend_recovery" --format '{{.Mountpoint}}')"
coordination_root="$(docker volume inspect "${project}_recovery_coordination" --format '{{.Mountpoint}}')"
docker_root="$(docker info --format '{{.DockerRootDir}}')"
mount_source="$(findmnt --noheadings --output SOURCE --target "$remote_root")"
[ "$mount_source" = "$backup_user@$backup_host:/checkpoints" ] || { echo 'STORAGE_BACKUP_MOUNT_IDENTITY_MISMATCH' >&2; exit 1; }
set --
for volume in postgres_data backend_storage_contracts backend_storage_hr_hiring backend_storage_accounting_contracts backend_storage_support_tickets backend_storage_performance_exports backend_uploads inquiry_data recovery_coordination; do
  source_root="$(docker volume inspect "${project}_$volume" --format '{{.Mountpoint}}')"
  set -- "$@" "$source_root"
done
measured="$(node "$operations_root/scripts/deployment-capacity.mjs" "$required_local" "$@")"
set -- $measured
[ "$#" -eq 2 ] || { echo 'STORAGE_CAPACITY_MEASUREMENT_FAILED' >&2; exit 1; }
required_local="$1"
required_remote="$2"
# A prebuilt release has installed targets before cleanup. Protect those exact
# helper-validated CONFIGs through the existing owned-cleanup protection port.
set --
if [ -n "${DEPLOYMENT_PREBUILT_BACKEND_CONFIG:-}${DEPLOYMENT_PREBUILT_FRONTEND_CONFIG:-}${DEPLOYMENT_PREBUILT_INQUIRY_CONFIG:-}" ]; then
  for protected_image in "${DEPLOYMENT_PREBUILT_BACKEND_CONFIG:-}" "${DEPLOYMENT_PREBUILT_FRONTEND_CONFIG:-}" "${DEPLOYMENT_PREBUILT_INQUIRY_CONFIG:-}"; do
    [ "${#protected_image}" -eq 71 ] || { echo 'STORAGE_PREBUILT_IMAGE_INVALID' >&2; exit 1; }
    case "$protected_image" in sha256:*) ;; *) echo 'STORAGE_PREBUILT_IMAGE_INVALID' >&2; exit 1;; esac
    protected_digest="${protected_image#sha256:}"
    case "$protected_digest" in *[!a-f0-9]*) echo 'STORAGE_PREBUILT_IMAGE_INVALID' >&2; exit 1;; esac
    set -- "$@" --protected-image "$protected_image"
  done
fi
# Both hosts must finish this phase before building images or blocking users.
node "$operations_root/deploy/scripts/storage-preflight.mjs" \
  --mode apply --project "$project" --lock-file "$repo_root/.deploy-state/deployment.lock" --lock-fd 9 \
  --storage-root "$docker_root" --required-bytes "$required_local" \
  --checkpoint-root "$recovery_root/packages" --checkpoint-root "$remote_root" \
  --journal-root "$report_root" \
  --document "$coordination_root/deployment-checkpoint.json" \
  --document "$coordination_root/pending-restore.json" \
  --document "$report_root/active-deployment-session.json" \
  --audit "$report_root/storage-cleanup-local.jsonl" "$@"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -o "UserKnownHostsFile=$backup_known_hosts" -i "$operations_key" "$operations_user@$backup_host" \
  "preflight $required_remote"
