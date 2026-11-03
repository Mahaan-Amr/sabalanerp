import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
const begin=source.indexOf('# Bind ordinary builds to the exact clean checkout');
const end=source.indexOf('PERFORMANCE_RELEASE_BACKEND_IMAGE=',begin);
assert.ok(begin>0&&end>begin);
const block=source.slice(begin,end);
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';

test('ordinary build binds source commit/hash and refuses dirty source or wrong image label',()=>{
 for(const scenario of ['ok','dirty','wrong-label','changed-hash']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-normal-build-test-'));
  const script=`set -eu
cd "$TEST_ROOT"
git() { case "$1" in status) [ "$SCENARIO" = dirty ] && printf ' M source\\n' || :;; rev-parse) printf '%s\\n' "$DEPLOYMENT_TARGET_COMMIT";; *) return 7;; esac; }
node() { if [ "$SCENARIO" = changed-hash ] && [ -e "$TEST_ROOT/hash-seen" ]; then printf '%064d\\n' 0; else : > "$TEST_ROOT/hash-seen"; printf '%s\\n' "$HASH"; fi; }
compose() { printf '%s\\n' "$*" >> "$TEST_ROOT/events"; }
docker() { case "$4" in *source-commit*) [ "$SCENARIO" = wrong-label ] && printf '%040d\\n' 0 || printf '%s\\n' "$DEPLOYMENT_TARGET_COMMIT";; *source-hash*) printf '%s\\n' "$HASH";; *) printf 'sha256:%064d\\n' 0;; esac; }
df() { printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 100 1 99 1%% /\\n'; }
DEPLOYMENT_TARGET_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DEPLOYMENT_RELEASE_ID=fixture-release
HASH=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
DEPLOYMENT_BACKEND_IMAGE=backend DEPLOYMENT_FRONTEND_IMAGE=frontend DEPLOYMENT_INQUIRY_IMAGE=inquiry
docker_root=/ docker_required_bytes=1
${block}
printf 'FINISHED\\n' >> "$TEST_ROOT/events"
`;
  const result=spawnSync(shell,['-c',script],{encoding:'utf8',env:{...process.env,SCENARIO:scenario,TEST_ROOT:dir}});
  assert.equal(result.status,scenario==='ok'?0:1,result.stderr);
  const events=fs.existsSync(path.join(dir,'events'))?fs.readFileSync(path.join(dir,'events'),'utf8'):'';
  assert.equal(events.includes('FINISHED'),scenario==='ok');
  if(scenario==='dirty')assert.equal(events.includes('build backend'),false);
 }
});
