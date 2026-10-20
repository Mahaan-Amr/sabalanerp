import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateRetainedBrowserPlan,readOriginalRetainedBrowserQualificationCompletion,assertRetainedControllerEof,validateRetainedBrowserCapacity,buildRetainedInquiryRotation} from '../../scripts/lib/original-retained-browser-qualification.mjs';
test('saved JSON cannot substitute an original retained-browser completion',()=>{
 for(const value of [{},{pass:true,allOriginalChildrenClosed:true},Object.freeze({})])assert.throws(()=>readOriginalRetainedBrowserQualificationCompletion(value),/ORIGINAL_RETAINED_BROWSER_COMPLETION_UNPROVEN/);
});
test('a final JSON frame never hides truncated trailing bytes or an unclosed stream',()=>{
 assertRetainedControllerEof({stdoutEof:true,stderrEof:true,trailingBytes:0});
 for(const wrong of [{stdoutEof:false,stderrEof:true,trailingBytes:0},{stdoutEof:true,stderrEof:false,trailingBytes:0},{stdoutEof:true,stderrEof:true,trailingBytes:1}])assert.throws(()=>assertRetainedControllerEof(wrong));
});
test('retained browser plan cannot supply arbitrary images, commands or controllers',()=>{
 const plan={format:'sabalan-original-retained-browser-plan/v1',preflightFile:'D:/sabalanerp-online-qa/fresh-preflight.json'};
 assert.deepEqual(validateRetainedBrowserPlan(plan),plan);
 const actualLegacy={...plan,legacyAugmentationReceipt:'D:/sabalanerp-online-qa/original-augmentation/image.json',legacyAugmentationSha256:'a'.repeat(64)};assert.deepEqual(validateRetainedBrowserPlan(actualLegacy),actualLegacy);assert.throws(()=>validateRetainedBrowserPlan({...actualLegacy,legacyAugmentationSha256:'caller-pass'}));
 for(const field of ['image','argv','controllerFile','existingReport','sourceCommit'])assert.throws(()=>validateRetainedBrowserPlan({...plan,[field]:'caller-selected'}));
});
test('measured working reserves refuse cap drift, OOM and insufficient VM memory',()=>{
 const M=1024*1024,valid={hostFree:1800*M,linuxMemAvailable:1700*M,cgroups:{'backend-candidate':{current:200*M,maximum:768*M,events:{oom:0,oom_kill:0}},'frontend-retained':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}},'frontend-candidate':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}}}};validateRetainedBrowserCapacity(valid);
 for(const mutate of [v=>v.linuxMemAvailable=1500*M,v=>v.cgroups['backend-candidate'].maximum=1024*M,v=>v.cgroups['frontend-retained'].current=300*M,v=>v.cgroups['frontend-candidate'].events.oom_kill=1]){const value=structuredClone(valid);mutate(value);assert.throws(()=>validateRetainedBrowserCapacity(value));}
});

test('real Compose inherits one /tmp during Inquiry rotation and leaves other services unchanged',{
 skip:process.env.SABALAN_COMPOSE_CONFIG_TEST!=='1'?'Set SABALAN_COMPOSE_CONFIG_TEST=1 for existing-project Compose validation':false,
},()=>{
 const root=path.resolve(import.meta.dirname,'../..'),base=path.join(root,'docker-compose.local.yml'),browser=path.join(root,'docker-compose.application-browser-acceptance.yml');
 const images={old:'sha256:'+'a'.repeat(64),current:'sha256:'+'b'.repeat(64)};
 const env={...process.env,ONLINE_BROWSER_OLD_IMAGE:images.old,ONLINE_BROWSER_NEW_IMAGE:images.current,ONLINE_BROWSER_OLD_BUILD_ID:'erp_retained_compose_regression',ONLINE_BROWSER_NEW_BUILD_ID:'erp_current_compose_regression'};
 const parse=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
 function verifyProject(){
  const result=spawnSync('docker',['compose','-f',base,'ps','--all','--format','json'],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const rows=parse(result.stdout);assert.equal(rows.length,10);assert.ok(rows.every(row=>row.Project==='sabalanerp-local'&&row.State==='running'&&row.Health==='healthy'));return rows;
 }
 function docker(args){verifyProject();return spawnSync('docker',args,{cwd:root,env,encoding:'utf8',maxBuffer:4*1024**2});}
 function identities(){
  const rows=verifyProject(),result=docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}}}',...rows.map(row=>row.ID)]);
  assert.equal(result.status,0,result.stderr);return parse(result.stdout).sort((a,b)=>a.id.localeCompare(b.id));
 }
 const before=identities(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-compose-'));
 try{
  const rotation=buildRetainedInquiryRotation(images,'sabalan-acceptance-config-test','sabalan-authority-config-test');
  const overlay=path.join(directory,'rotation.json');fs.writeFileSync(overlay,JSON.stringify(rotation));
  const compose=['compose','-f',base,'-f',browser,'--profile','application-browser-acceptance'];
  const baseline=docker([...compose,'config','--format','json']);assert.equal(baseline.status,0,baseline.stderr);
  const legacy=structuredClone(rotation);for(const service of Object.values(legacy.services))service.tmpfs.unshift('/tmp:rw,nosuid,nodev,mode=1777');
  const legacyFile=path.join(directory,'legacy-duplicate.json');fs.writeFileSync(legacyFile,JSON.stringify(legacy));
  const rejected=docker([...compose,'-f',legacyFile,'config','--format','json']);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/target \/tmp already mounted/);
  const result=docker([...compose,'-f',overlay,'config','--format','json']);assert.equal(result.status,0,result.stderr);
  const actual=JSON.parse(result.stdout),original=JSON.parse(baseline.stdout),targets=['frontend-retained','frontend-candidate'];assert.equal(actual.name,'sabalanerp-local');
  for(const name of targets){
   const service=actual.services[name];assert.equal(service.image,images[name==='frontend-retained'?'old':'current']);
   assert.deepEqual(service.tmpfs,['/tmp','/app/.next/cache:rw,nosuid,nodev,mode=0700']);
   assert.equal(service.read_only,true);assert.deepEqual(service.ports??[],[]);assert.equal(service.build,undefined);assert.equal(service.healthcheck.disable,true);
   assert.deepEqual(service.cap_drop,['ALL']);assert.deepEqual(service.security_opt,['no-new-privileges:true']);
   assert.deepEqual(service.volumes.map(row=>({target:row.target,readOnly:row.read_only??false})).sort((a,b)=>a.target.localeCompare(b.target)),[{target:'/app/online-runtime-acceptance',readOnly:false},{target:'/run/sabalan-online',readOnly:true}]);
  }
  for(const name of Object.keys(original.services).filter(name=>!targets.includes(name)))assert.deepEqual(actual.services[name],original.services[name]);
  assert.deepEqual(identities(),before,'CONFIG_ONLY_MUST_PRESERVE_ALL_TEN_CONTAINER_IDENTITIES');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
