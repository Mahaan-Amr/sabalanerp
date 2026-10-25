import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const current=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
// Exact original enter_maintenance function from source SHA de015176... .
const old="\nenter_maintenance() {\n  if [ \"${DEPLOYMENT_CLAMAV_OPERATION}\" = incident-recovery ]; then\n    # Make the durable boundary own every subsequent runtime change. A crash\n    # before the shell flag is set is detected through the marker and journal.\n    control maintenance-on\n    MAINTENANCE_ACTIVE=1\n    compose up -d --no-deps --force-recreate nginx\n  else\n    compose up -d --no-deps --force-recreate nginx\n    control maintenance-on\n    MAINTENANCE_ACTIVE=1\n  fi\n  verify_public_maintenance\n}\n";
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
function entry(source){const from=source.indexOf('enter_maintenance() {'),to=source.indexOf('\n}\n',from)+3;assert.ok(from>0&&to>from);return source.slice(from,to);}
function run(source,{capture=1,incident=false,configuration=0,control=0,publicCode=0}={}){
 const script=['set -eu',`CAPTURE_ONLY=${capture}; DEPLOYMENT_CLAMAV_OPERATION=${incident?'incident-recovery':'none'}; MAINTENANCE_ACTIVE=0; nginx=original; marker=0`,
 `verify_capture_only_configuration(){ echo VERIFY_CONFIGURATION; return ${configuration}; }`,
 `control(){ [ "$1" = maintenance-on ] || return 99; echo CONTROL; [ ${control} -eq 0 ] || return ${control}; marker=1; }`,
 'compose(){ [ "$*" = "up -d --no-deps --force-recreate nginx" ] || return 98; echo RECREATE; nginx=replacement; }',
 `verify_public_maintenance(){ echo PUBLIC_503; [ "$marker" -eq 1 ] && [ ${publicCode} -eq 0 ]; }`,entry(source),
 'if enter_maintenance; then code=0; else code=$?; fi',
 'echo STATUS:$code:MAINTENANCE:$MAINTENANCE_ACTIVE:NGINX:$nginx',
 'if [ "$code" -eq 0 ] && [ "$CAPTURE_ONLY" -eq 1 ] && [ "$nginx" != original ]; then echo ORIGINAL_CAPTURE_CONTAINER_REPLACED; exit 92; fi',
 ].join('\n');const result=spawnSync(shell,['-c',script],{encoding:'utf8'});assert.ifError(result.error);return {...result,lines:result.stdout.trim().split('\n')};
}
test('capture retains original nginx and verifies configuration, durable marker and public503',()=>{
 const r=run(current);assert.equal(r.status,0,r.stderr);assert.deepEqual(r.lines,['VERIFY_CONFIGURATION','CONTROL','PUBLIC_503','STATUS:0:MAINTENANCE:1:NGINX:original']);
});
test('old exact function RED reproduces original nginx replacement before canonical reopen',()=>{
 const r=run(old);assert.equal(r.status,92);assert.ok(r.lines.includes('RECREATE'));assert.ok(r.lines.includes('ORIGINAL_CAPTURE_CONTAINER_REPLACED'));
});
for(const incident of [false,true])test(`ordinary ${incident?'incident':'release'} maintenance choreography unchanged`,()=>{
 const r=run(current,{capture:0,incident});assert.equal(r.status,0,r.stderr);assert.deepEqual(r.lines,incident?['CONTROL','RECREATE','PUBLIC_503','STATUS:0:MAINTENANCE:1:NGINX:replacement']:['RECREATE','CONTROL','PUBLIC_503','STATUS:0:MAINTENANCE:1:NGINX:replacement']);
 assert.deepEqual(r.lines,run(old,{capture:0,incident}).lines);
});
test('capture configuration refusal precedes marker and any service change',()=>{
 const r=run(current,{configuration:7});assert.equal(r.status,0);assert.deepEqual(r.lines,['VERIFY_CONFIGURATION','STATUS:1:MAINTENANCE:0:NGINX:original']);
});
test('failed durable marker refuses successful maintenance and preserves original identity',()=>{
 const r=run(current,{control:8});assert.equal(r.status,0);assert.deepEqual(r.lines,['VERIFY_CONFIGURATION','CONTROL','STATUS:1:MAINTENANCE:0:NGINX:original']);
});
test('public503 refusal remains negative after marker, with no recreation or reopening',()=>{
 const r=run(current,{publicCode:9});assert.equal(r.status,0);assert.deepEqual(r.lines,['VERIFY_CONFIGURATION','CONTROL','PUBLIC_503','STATUS:1:MAINTENANCE:1:NGINX:original']);
});
test('capture branch wins even if incident selector is also present',()=>{assert.deepEqual(run(current,{incident:true}).lines,run(current).lines);});
