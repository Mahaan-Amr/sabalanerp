#!/bin/sh
set -eu
umask 077
cd /opt/sabalanerp
export DEPLOYMENT_REPO_ROOT=/opt/sabalanerp
export DEPLOY_BRANCH=main
result=FAILED
trap 'printf "%s\n" "$result" > /opt/sabalanerp-staging/release-b58c53c0-deployment-result' EXIT
sh /opt/sabalanerp-staging/release-b58c53c0/deploy/scripts/deploy.sh deploy/.env.prod
result=COMPLETED
