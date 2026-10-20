import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performanceRuntimeReleaseIdentityFromEnvironment} from '../../backend/src/services/personnelPerformancePromotionEvidence';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
const source=fs.readFileSync(path.join(repository,'deploy/scripts/deploy.sh'),'utf8');
const block=source.slice(source.indexOf('run_backend() {'),source.indexOf('run_backend_timed_with_heartbeat() {'));
const digest=(character:string)=>'sha256:'+character.repeat(64);
const control=digest('9'),serving=digest('1');
const environment={PERFORMANCE_RELEASE_COMMIT:'a'.repeat(40),PERFORMANCE_RELEASE_SOURCE_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_SCHEMA_HASH:'c'.repeat(64),PERFORMANCE_RELEASE_POLICY_HASH:'d'.repeat(64),PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH:'e'.repeat(64),PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH:'e'.repeat(64),PERFORMANCE_RELEASE_BACKEND_IMAGE:serving,PERFORMANCE_RELEASE_FRONTEND_IMAGE:digest('2'),PERFORMANCE_RELEASE_INQUIRY_IMAGE:digest('3'),DEPLOYMENT_BACKEND_IMAGE:serving,DEPLOYMENT_FRONTEND_IMAGE:digest('2'),DEPLOYMENT_INQUIRY_IMAGE:digest('3')};
const posix=(p:string)=>process.platform==='win32'?p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,letter)=>'/'+letter.toLowerCase()):p;
function execute(timed:boolean,capture:boolean){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-image-identity-'));
 try{
  const fake=path.join(dir,'transport.cjs');
  fs.writeFileSync(fake,`const assert=require('node:assert/strict');const args=process.argv.slice(2);assert.equal(args[0],'compose');const values={};for(let i=0;i<args.length;i++)if(args[i]==='-e'){const pair=args[++i];const cut=pair.indexOf('=');if(cut>0)values[pair.slice(0,cut)]=pair.slice(cut+1);}console.log(JSON.stringify({selectedComposeImage:process.env.DEPLOYMENT_BACKEND_IMAGE,containerEnvironment:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('PERFORMANCE_')||key.startsWith('DEPLOYMENT_'))),...values},args}));`);
  fs.writeFileSync(path.join(dir,'docker'),'#!/bin/sh\nexec "$NODE_BINARY" -- "$FAKE_DOCKER_PROGRAM" "$@"\n',{mode:0o700});
  const env={...process.env,...environment,NODE_BINARY:process.execPath.replaceAll('\\','/'),FAKE_DOCKER_PROGRAM:fake.replaceAll('\\','/'),DEPLOYMENT_TARGET_BACKEND_IMAGE:capture?control:serving,CAPTURE_ONLY:capture?'1':'0'};
  const script='set -eu\nexport PATH="'+posix(dir)+':$PATH"\ntest "$(command -v docker)" = "'+posix(path.join(dir,'docker'))+'"\nENV_FILE=x; COMPOSE_FILE=x; COMPOSE_ONLINE_FLAGS=""\nDEPLOYMENT_ID=owned; DEPLOYMENT_CLAMAV_REPAIR=false; DEPLOYMENT_CLAMAV_OPERATION=none; DEPLOYMENT_CLAMAV_TARGET_IMAGE=x; DEPLOYMENT_MODE=release; DEPLOYMENT_RELEASE_ID=owned; DEPLOYMENT_TARGET_COMMIT='+environment.PERFORMANCE_RELEASE_COMMIT+'; DEPLOYMENT_OWNER=test\nDEPLOYMENT_PREVIOUS_BACKEND_IMAGE=x; DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=x; DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=x; DEPLOYMENT_PREVIOUS_NGINX_IMAGE=x; DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=x; DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=x\ntimeout(){ shift; "$@"; }\n'+block+'\n'+(timed?'run_backend_timed 10':'run_backend')+' node dist/scripts/deployment-control.js validate-production-environment\n';
  const result=spawnSync(shell,['-c',script],{env,cwd:repository,encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
}
for(const timed of [false,true])for(const capture of [false,true])test(`${timed?'timed':'direct'} ${capture?'capture':'normal'} control transport preserves measured business image identity`,()=>{
 const actual=execute(timed,capture);assert.equal(actual.selectedComposeImage,capture?control:serving);assert.equal(actual.containerEnvironment.DEPLOYMENT_CONTROL_IMAGE,capture?control:serving);assert.equal(actual.containerEnvironment.DEPLOYMENT_BACKEND_IMAGE,serving);assert.equal(performanceRuntimeReleaseIdentityFromEnvironment(actual.containerEnvironment).images.backend,serving);
 if(capture)assert.throws(()=>performanceRuntimeReleaseIdentityFromEnvironment({...actual.containerEnvironment,DEPLOYMENT_BACKEND_IMAGE:control}),{code:'PERFORMANCE_RELEASE_RUNTIME_IDENTITY_MISMATCH'});
 assert.deepEqual(actual.args.slice(-4),['deployment','node','dist/scripts/deployment-control.js','validate-production-environment']);
});
