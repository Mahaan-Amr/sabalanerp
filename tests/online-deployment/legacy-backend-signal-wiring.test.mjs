import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
const start=source.indexOf('drain_current_services() {'),end=source.indexOf('\n}\n',start)+3,drain=source.slice(start,end);
test('actual leased drain forwards only inside proven maintenance and preserves compose stop/native/SQL checks',()=>{
 for(const [lease,maintenance,phase,forwardCode,expected]of [
  [1,1,'TRAFFIC_BLOCKED',0,['VERIFY','HEARTBEAT','FORWARD','STOP','NATIVE','STATUS:0:PENDING:0']],
  [1,1,'TRAFFIC_BLOCKED',7,['VERIFY','HEARTBEAT','FORWARD','STATUS:1:PENDING:1']],
  [1,0,'TRAFFIC_BLOCKED',0,['STATUS:1:PENDING:0']],
  [1,1,'MAINTENANCE_REQUESTED',0,['STATUS:1:PENDING:0']],
  [0,1,'MAINTENANCE_REQUESTED',0,['STOP','NATIVE','STATUS:0:PENDING:0']],
 ]){
  const script=[
   'set -eu',
   `DB_LEASE_ACQUIRED=${lease}; MAINTENANCE_ACTIVE=${maintenance}; DEPLOYMENT_PHASE=${phase}; LEGACY_BACKEND_SIGNAL_PENDING=0`,
   'OPERATIONS_ROOT=/ops; REPO_ROOT=/repo; COMPOSE_FILE=docker-compose.prod.yml; ENV_FILE=/private/env',
   'DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=immutable; DEPLOYMENT_ID=original_deployment; SESSION_HOST_PATH=/private/session',
   'compose(){ case "$*" in "ps -q backend") echo original;; "stop -t 300 frontend backend inquiry") echo STOP;; *max_connections*) echo 10;; *pg_stat_activity*) echo 0;; *) exit 91;; esac; }',
   'docker(){ echo 10.0.0.2; }',
   'verify_public_maintenance(){ echo VERIFY; }',
   'control(){ [ "$1" = heartbeat ] || exit 92; echo HEARTBEAT; }',
   'run_original_owned_with_heartbeat(){ "$@"; }',
   `python3(){ [ "$3" = /repo/docker-compose.prod.yml ] || exit 93; echo FORWARD; return ${forwardCode}; }`,
   'assert_native_runtime_closed(){ echo NATIVE; }',drain,
   'set +e','drain_current_services','status=$?','echo STATUS:$status:PENDING:$LEGACY_BACKEND_SIGNAL_PENDING',
  ].join('\n');
  const result=spawnSync(shell,['-c',script],{encoding:'utf8'});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split('\n'),expected);
 }
});
test('unresolved original signal refuses automatic reopening and is checked before ordinary native closure',()=>{
 const from=source.indexOf('  if [ "${LEGACY_BACKEND_SIGNAL_PENDING}" -eq 1 ]; then',source.indexOf('recover_failure()'));
 const to=source.indexOf('\n  if [ "${ROLLBACK_ALREADY_ATTEMPTED}"',from);assert.ok(from>0&&to>from);
 const script=['set -eu; LEGACY_BACKEND_SIGNAL_PENDING=1; exit_code=9','control(){ echo CONTROL:$1; }; cleanup_locks(){ echo LOCKS; }',source.slice(from,to),'echo UNSAFE_REOPEN'].join('\n');
 const result=spawnSync(shell,['-c',script],{encoding:'utf8'});assert.equal(result.status,9);assert.doesNotMatch(result.stdout,/UNSAFE_REOPEN/);assert.match(result.stderr,/shutdown was not proven/);
 const closure=source.slice(source.indexOf('assert_native_runtime_closed() {'),source.indexOf('\ndrain_current_services()'));
 assert.ok(closure.indexOf('--assert-resolved')<closure.indexOf("run_backend sh -c"));
});
test('read-only legacy preflight occurs before session preparation or maintenance and helper belongs to host pack',()=>{
 const preflight=source.indexOf('legacy-backend-signal.py" --preflight'),prepare=source.indexOf('\ncontrol prepare\n');
 assert.ok(preflight>0&&prepare>preflight);assert.ok(preflight<source.indexOf('\nphase MAINTENANCE_REQUESTED\n'));
 const pack=fs.readFileSync(new URL('../../scripts/build-online-controller-host-pack.mjs',import.meta.url),'utf8');assert.ok(pack.includes("'deploy/scripts/legacy-backend-signal.py'"));
});
