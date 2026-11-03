import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
const marker='if [ "${PREBUILT_RELEASE}" -eq 1 ]; then\n  prebuilt_exports="$(verify_prebuilt_release 1)"';
const start=source.indexOf(marker),end=source.indexOf('preserved_clamav_guard identity || exit 1',start);
assert.ok(start>=0&&end>start);
const block=source.slice(start,end);
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
for(const mode of ['normal','prebuilt'])for(const state of ['valid','missing','identity-mismatch']){
 test(`actual pre-mutation selection ${mode} ${state}`,()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-projection-flow-'));
  fs.mkdirSync(path.join(directory,'deploy','scripts'),{recursive:true});
  if(state!=='missing')fs.writeFileSync(path.join(directory,'deploy','scripts','normal-migration-projection.mjs'),'test fixture');
  const script=`set -eu
verify_prebuilt_release() { [ "$CASE_STATE" = valid ] || return 1; printf '%s\\n' ':'; }
node() { [ "$CASE_STATE" = valid ] || return 1; }
compose() { printf '{}'; }
PREBUILT_RELEASE=${mode==='prebuilt'?1:0}
CONFIGURATION_ACTIVE=0
DEPLOYMENT_TARGET_BACKEND_IMAGE=sha256:fixture
OPERATIONS_ROOT="$TEST_ROOT"
REPO_ROOT="$TEST_ROOT"
${block}
printf 'MUTATION_REACHED\\n'
`;
  const result=spawnSync(shell,['-c',script],{encoding:'utf8',env:{...process.env,CASE_STATE:state,TEST_ROOT:directory}});
  assert.equal(result.status,state==='valid'?0:1,result.stderr);
  assert.equal(result.stdout.includes('MUTATION_REACHED'),state==='valid');
 });
}
