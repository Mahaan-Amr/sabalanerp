import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const shell=process.env.SABALAN_TEST_SHELL??(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh');
const script=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('maintenance entry publishes unique operation identities that fit PostgreSQL application_name and retain the full source commit',()=>{
 // Exercise the normal CLI parser and identity publication. External preflight
 // work between these boundaries is covered by the runner and gate-order tests.
 const entry=script.slice(script.indexOf('SYSTEM_RECOVERY_BACKUP_HOST='),script.indexOf('\ncd "${REPO_ROOT}"'));
 const before='  eval "${existing_exports}"\nfi\n';
 assert.ok(script.includes(before));
 const identity=script.slice(script.indexOf(before)+before.length,script.indexOf('\nif [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then'));
 assert.ok(entry.length>0&&identity.length>0);
 const prefix='set -eu\nSCRIPT_DIR=/operations/deploy/scripts; OPERATIONS_ROOT=/operations; REPO_ROOT=/repository\n';
 const code=prefix+entry+'\nDEPLOYMENT_TARGET_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\ndate(){ printf 20261118T060030Z; }\n'+identity+'\nprintf "%s|%s|%s|%s\\n" "$DEPLOYMENT_RELEASE_ID" "$DEPLOYMENT_ID" "$APP_COMMIT" "$DEPLOYMENT_TARGET_COMMIT"\n';
 const run=(args,env={})=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-identity-'));try{const file=path.join(directory,'entry.sh');fs.writeFileSync(file,code);const result=spawnSync(shell,[file,...args],{encoding:'utf8',env:{...process.env,...env}});assert.equal(result.status,0,result.stderr);return result.stdout.trim().split('|');}finally{fs.rmSync(directory,{recursive:true,force:true});}};
 const args=['--maintenance-images','/private/env','/private/plan','a'.repeat(64)];
 const ids=new Set();
 for(let attempt=0;attempt<4;attempt++){
  const [release,deployment,appCommit,targetCommit]=run(args);
  assert.match(release,/^20261118T060030Z-[a-f0-9]{16}-release$/);
  assert.equal(Buffer.byteLength(release,'ascii'),41);
  assert.equal(deployment,'deploy-'+release);
  assert.equal(Buffer.byteLength(deployment,'ascii'),48);
  const applicationName='sabalan-lock-'+deployment;
  assert.equal(Buffer.byteLength(applicationName,'ascii'),61);
  assert.equal(Buffer.from(applicationName).subarray(0,63).toString(),applicationName,'PostgreSQL must retain the literal identity used by acquire, observation and release');
  assert.equal(appCommit,'a'.repeat(40));assert.equal(targetCommit,'a'.repeat(40));
  assert.ok(!ids.has(deployment),'operations in the same UTC second must remain distinct');ids.add(deployment);
 }
 // Other modes retain their exact existing published identity format.
 for(const [args,env,mode]of [[['/private/env'],{},'release'],[['/private/env'],{DEPLOYMENT_MODE:'configuration'},'configuration'],[['--capture-only','/private/env','/private/plan'],{},'release'],[['/private/env'],{DEPLOYMENT_CLAMAV_TARGET_IMAGE:'sha256:'+'b'.repeat(64)},'release'],[['--predecessor-role-cutover','/private/env','/private/plan','c'.repeat(64)],{},'configuration']]){
  const [release,deployment,appCommit,targetCommit]=run(args,env);
  assert.equal(release,'20261118T060030Z-aaaaaaaaaaaa-'+mode);assert.equal(deployment,'deploy-'+release);
  assert.equal(appCommit,'a'.repeat(40));assert.equal(targetCommit,'a'.repeat(40));
 }
});
