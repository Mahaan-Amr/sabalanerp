import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('run_backend_timed() {'),end=source.indexOf('run_backend_timed_with_heartbeat()',start);
assert.ok(start>=0&&end>start);const body=source.slice(start,end);
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
for(const mode of ['normal','prebuilt'])test(`protected ${mode} control uses one read-only volume argument`,()=>{
 const script=`set -e
REPO_ROOT=$(mktemp -d); mkdir "$REPO_ROOT/.deploy-state"; DEPLOYMENT_ID=deploy-fixture
touch "$REPO_ROOT/.deploy-state/migration-projection-$DEPLOYMENT_ID.json"
DEPLOYMENT_TARGET_BACKEND_IMAGE=sha256:fixture; ENV_FILE=/private/env; COMPOSE_FILE=compose.yml; COMPOSE_ONLINE_FLAGS=''
timeout(){ shift; "$@"; }
env(){ while :; do case "$1" in *=*) shift;; *) break;; esac; done; "$@"; }
docker(){ printf 'ARG=%s\\n' "$@"; }
${body}
DEPLOYMENT_MIGRATION_PROJECTION_SOURCE="$REPO_ROOT/.deploy-state/migration-projection-$DEPLOYMENT_ID.json" run_backend_timed 20 node fixture
`;
 const r=spawnSync(shell,['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const lines=r.stdout.split(/\r?\n/).filter(Boolean);assert.equal(lines.filter(x=>x==='ARG=--volume').length,1);
 assert.ok(lines.some(x=>/^ARG=\/.*\/\.deploy-state\/migration-projection-deploy-fixture\.json:\/run\/deployment-migration-projection\.json:ro$/.test(x)));
 assert.equal(lines.includes('ARG=--mount'),false);
});
