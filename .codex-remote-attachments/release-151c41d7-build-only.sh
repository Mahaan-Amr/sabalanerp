#!/bin/sh
set -eu
umask 077
cd /opt/sabalanerp-staging/release-151c41d7
evidence=/opt/sabalanerp-staging/release-151c41d7-build
mkdir -p "$evidence"
test "$(git rev-parse HEAD)" = 151c41d747541d40ff48da91913fbe08e994eab6
git diff --quiet
git diff --cached --quiet
export DEPLOYMENT_BACKEND_IMAGE=sabalanerp-backend:151c41d747541d40ff48da91913fbe08e994eab6
export DEPLOYMENT_FRONTEND_IMAGE=sabalanerp-frontend:151c41d747541d40ff48da91913fbe08e994eab6
export DEPLOYMENT_INQUIRY_IMAGE=sabalanerp-inquiry:151c41d747541d40ff48da91913fbe08e994eab6
source_hash="$(node --input-type=module -e 'import { performanceSourceHash } from "./scripts/performance-source-identity.mjs"; console.log(await performanceSourceHash());')"
result=FAILED
trap 'printf "%s\n" "$result" > "$evidence/result"' EXIT
for service in backend frontend inquiry; do
  docker compose -p sabalanerp -f /opt/sabalanerp/docker-compose.prod.yml --env-file /opt/sabalanerp/deploy/.env.prod ps > "$evidence/live-before-$service.txt" 2>&1
  printf '%s\n' "$service" > "$evidence/current-service"
  docker compose -p sabalanerp -f docker-compose.prod.yml --env-file /opt/sabalanerp/deploy/.env.prod build --build-arg "PERFORMANCE_SOURCE_COMMIT=151c41d747541d40ff48da91913fbe08e994eab6" --build-arg "PERFORMANCE_SOURCE_HASH=$source_hash" "$service" > "$evidence/$service.log" 2>&1
  eval 'image=$DEPLOYMENT_'"$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')"'_IMAGE'
  docker image inspect --format '{{.Id}}' "$image" > "$evidence/$service.image"
done
printf '%s\n' "$source_hash" > "$evidence/source-hash"
result=BUILT_NOT_DEPLOYED
