#!/bin/sh
set -eu
umask 077
cd /opt/sabalanerp
export DEPLOYMENT_REPO_ROOT=/opt/sabalanerp
export DEPLOY_BRANCH=codex/clamav-incident-recovery-20261020
export DEPLOYMENT_CLAMAV_OPERATION=incident-recovery
export DEPLOYMENT_CLAMAV_BASE_COMMIT=a2c75f1027a069e91837ff433e1c91cdc7746798
export DEPLOYMENT_CLAMAV_TARGET_IMAGE=sha256:269ade6b36a74a2e188dc26265385a13141276d8acdab80c65f09df3b106f355
export DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_FILE=/opt/sabalanerp-staging/clamav-20261020/original-incident-final.json
export DEPLOYMENT_CLAMAV_READY_FILE=/opt/sabalanerp-staging/clamav-20261020/qualified-mirror/target.json
result=FAILED
trap 'printf "%s\n" "$result" > /opt/sabalanerp-staging/clamav-20261020/incident-deployment-result' EXIT
sh /opt/sabalanerp-staging/incident-37b2ef62/deploy/scripts/deploy.sh deploy/.env.prod
result=COMPLETED
