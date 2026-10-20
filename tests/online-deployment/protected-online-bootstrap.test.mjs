import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const ts=require('typescript');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const raw=v=>Buffer.from(JSON.stringify(canonical(v)));
const hash=v=>createHash('sha256').update(raw(v)).digest('hex');
function load(file,mocks){
 const source=fs.readFileSync(new URL('../../backend/src/services/'+file,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,key=>{
  if(key.startsWith('node:'))return require(key);assert.ok(Object.hasOwn(mocks,key),'unexpected dependency '+key);return mocks[key];
 });return module.exports;
}
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-bootstrap-'));
 const coordinationDirectory=path.join(directory,'coordination'),publicationDirectory=path.join(directory,'publication');
 fs.mkdirSync(coordinationDirectory,{mode:0o700});fs.mkdirSync(publicationDirectory,{mode:0o700});
 const owner={deploymentId:'deployment_new',releaseId:'release_new',leaseToken:'original_lease'};
 fs.writeFileSync(path.join(coordinationDirectory,'deployment-maintenance.json'),JSON.stringify({...owner,message:'protected',activatedAt:'2026-10-20T00:00:00Z'}),{mode:0o600});
 const checkpoint={id:'activation',captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',createdAt:'2026-10-20T00:00:00Z',checksum:'a'.repeat(64),size:123,
  sourceDatabase:{name:'real_database',systemIdentifier:'123',oid:'456'},sourceMachineUuidSha256:'b'.repeat(64),sourceKernelBootIdSha256:'c'.repeat(64),
  deploymentId:owner.deploymentId,releaseId:owner.releaseId,localVerified:true,remoteVerified:true,restoreVerified:true,
  manifestReadable:true,compatibility:{local:{compatible:true},remote:{compatible:true}}};
 const scope={runtimeId:'a'.repeat(64),purpose:'http',image:'sha256:'+'b'.repeat(64),manifestSha256:'c'.repeat(64)};
 const input={previousReleaseId:null,manifestSha256:'d'.repeat(64),acceptanceSha256:'e'.repeat(64),scopes:[{scope}]};
 const manifest={releaseId:owner.releaseId,generation:1,sourceCommit:'f'.repeat(40),database:{name:'real_database',systemIdentifier:'123'}};
 const qualificationCheckpoint={...checkpoint,id:'rehearsal',releaseId:'prior_rehearsal',createdAt:'2026-10-19T00:00:00Z'};
 const acceptance={checkpointSha256:hash(checkpoint),qualification:{deploymentTargetDatabase:{...checkpoint.sourceDatabase},recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',
  qualificationCheckpoint:{metadataSha256:hash(qualificationCheckpoint),metadata:qualificationCheckpoint}}};
 let phase='MIGRATIONS_APPLIED',releases=0,epochs=0,writes=0,semanticReads=0;
 const build={id:'erp_actual_build',application:'erp',slotId:'frontend_actual',image:'sha256:'+'9'.repeat(64),manifestSha256:'8'.repeat(64),assets:[],actionIds:[]};
 const graph={index:'sha256:'+'7'.repeat(64),config:build.image};acceptance.qualification.imageGraphs={frontend:graph};
 acceptance.qualification.deploymentTargetImages={backend:scope.image,frontend:build.image,inquiry:'sha256:'+'6'.repeat(64)};
 const validated={manifest,acceptance,slots:[],compatibilityJson:{},recoveryJson:{},identityJson:{},accepted:{acceptance,browserRegistries:[{builds:[{...build,image:graph.index}]}],revalidate(){semanticReads++;}}};
 const module=load('onlineReleaseBootstrap.ts',{'./onlineBootstrapCheckpointLineage':load('onlineBootstrapCheckpointLineage.ts',{}),
  './onlineImageExecutionBinding':load('onlineImageExecutionBinding.ts',{}),
  './onlineReleaseRegistration':{prepareValidatedOnlineRegistration(){return validated;}},
  './deploymentMaintenance':{DEPLOYMENT_MAINTENANCE_FILE:'deployment-maintenance.json'}});
 const tx={onlineRelease:{create:async()=>{releases++;writes++;}},onlineRuntimeSlot:{createMany:async()=>{writes++;}},
  $executeRaw:async(strings)=>{if(!strings.join('').includes('advisory'))writes++;return 1;},
  $queryRaw:async(strings)=>{const sql=strings.join('');
   if(sql.includes('FROM deployment_operations'))return[{releaseId:owner.releaseId,targetCommit:manifest.sourceCommit,phase,checkpointJson:checkpoint}];
   if(sql.includes('pg_control_system'))return[{...manifest.database,oid:'456'}];
   if(sql.includes('count(*)'))return[{releases,epochs}];
   if(sql.includes('FROM online_runtime_slots'))return[{id:scope.runtimeId}];
   if(sql.includes('FROM online_releases'))return[{id:owner.releaseId}];
   if(sql.includes('FROM online_serving_epochs'))return epochs?[{id:'prior'}]:[];
   assert.fail('unexpected SQL '+sql);
  }};
 const database={$transaction:async work=>work(tx)};
 return{...module,database,owner,input,paths:{coordinationDirectory,publicationDirectory},checkpoint,manifest,acceptance,scope,build,
  setPhase:value=>{phase=value;},setEpochs:value=>{epochs=value;},writes:()=>writes,semanticReads:()=>semanticReads,
  cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}

test('bootstrap prepares only NEW qualified release inside actual protected phase, without granting startup/publication',async()=>{
 const f=fixture();try{
  const cap=await f.prepareProtectedOnlineBootstrap(f.database,f.owner,f.input,f.paths);
  assert.equal(f.writes(),2);assert.ok(f.semanticReads()>0);
  assert.equal(f.assertProtectedOnlineBootstrap(cap,f.database,f.owner).input.previousReleaseId,null);
  assert.throws(()=>f.assertProtectedOnlineBootstrap({},f.database,f.owner),/ORIGINAL_BOOTSTRAP/);
  assert.throws(()=>f.assertProtectedOnlineBootstrap(cap,{},f.owner),/ORIGINAL_BOOTSTRAP/);
  assert.throws(()=>f.assertProtectedOnlineBootstrap(cap,f.database,{...f.owner,leaseToken:'other'}),/ORIGINAL_BOOTSTRAP/);
 }finally{f.cleanup();}
});
test('online phase, existing epoch, unverified checkpoint, nonempty publication and predecessor all refuse bootstrap',async()=>{
 for(const change of [f=>f.setPhase('ONLINE_ACCEPTING'),f=>f.setEpochs(1),f=>{f.checkpoint.remoteVerified=false;},
  f=>fs.writeFileSync(path.join(f.paths.publicationDirectory,'foreign'),'x'),f=>{f.input.previousReleaseId='legacy';}]){
  const f=fixture();try{change(f);await assert.rejects(f.prepareProtectedOnlineBootstrap(f.database,f.owner,f.input,f.paths));assert.equal(f.writes(),0);}finally{f.cleanup();}
 }
});
test('generation one requires actual first paired publication, final gates, and same original opaque capability',async()=>{
 const f=fixture();try{
  const cap=await f.prepareProtectedOnlineBootstrap(f.database,f.owner,f.input,f.paths);
  await assert.rejects(f.finalizeProtectedOnlineBootstrap(cap,f.database,f.owner,'0'.repeat(64)));
  const registry={generation:1,current:{erp:f.build.id},builds:[f.build],apiBindings:[{buildId:f.build.id,
   slotId:'backend_'+f.scope.runtimeId,image:f.scope.image,manifestSha256:f.scope.manifestSha256,browserManifestSha256:f.build.manifestSha256}]};
  const record={format:'sabalan-browser-publication/v1',generation:1,previousPublicationSha256:null,registryIdentity:hash(registry),registry};
  const bytes=Buffer.concat([raw(record),Buffer.from('\n')]),sha=createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(f.paths.publicationDirectory,'published-00000001.json'),bytes,{mode:0o600});
  await assert.rejects(f.finalizeProtectedOnlineBootstrap(cap,f.database,f.owner,sha),/PROTECTED_LEASE/);
  f.setPhase('GATES_PASSED');
  const result=await f.finalizeProtectedOnlineBootstrap(cap,f.database,f.owner,sha);
  assert.equal(result.generation,1);assert.equal(result.legacyReleaseAdopted,false);assert.equal(result.publicTrafficOpened,false);
  await assert.rejects(f.finalizeProtectedOnlineBootstrap(cap,f.database,f.owner,sha),/ORIGINAL_BOOTSTRAP/);
 }finally{f.cleanup();}
});

test('protected HTTP startup uses a separate signed domain; tampered, expired and jobs decisions refuse',()=>{
 const module=load('onlineProtectedBootstrapAuthority.ts',{'./onlineReleaseControllerAuthority':{},'./onlineRuntimeScope':{},
  './deploymentMaintenance':{DEPLOYMENT_MAINTENANCE_FILE:'deployment-maintenance.json'}});
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),key=Buffer.from(publicKey.export({type:'spki',format:'pem'}));
 const decision={format:'sabalan-protected-online-bootstrap/v1',purpose:'private-http-bootstrap',deploymentId:'deployment_new',releaseId:'release_new',
  runtimeId:'a'.repeat(64),startupDecisionSha256:'b'.repeat(64),checkpointSha256:'c'.repeat(64),maintenanceSha256:'d'.repeat(64),
  issuedAt:'2026-10-20T00:00:00.000Z',expiresAt:'2026-10-20T00:10:00.000Z'};
 const envelope=(value,domain='sabalan-protected-online-bootstrap/v1\n')=>raw({format:'sabalan-signed-protected-online-bootstrap/v1',decision:value,
  signature:sign(null,Buffer.concat([Buffer.from(domain),raw(value)]),privateKey).toString('base64')});
 assert.deepEqual(module.verifyProtectedBootstrapDecision(envelope(decision),key,new Date('2026-10-20T00:01:00Z')),decision);
 for(const value of [{...decision,purpose:'jobs'}, {...decision,expiresAt:'2026-10-20T00:11:00.000Z'}, {...decision,force:true}]){
  assert.throws(()=>module.verifyProtectedBootstrapDecision(envelope(value),key,new Date('2026-10-20T00:01:00Z')));
 }
 assert.throws(()=>module.verifyProtectedBootstrapDecision(envelope(decision,'other-domain\n'),key,new Date('2026-10-20T00:01:00Z')));
 assert.throws(()=>module.verifyProtectedBootstrapDecision(envelope(decision),key,new Date('2026-10-20T00:10:00Z')));
 for(const route of ['/api/system-recovery','/api/auth/logout','/api/health/mutate','/api/ready-extra','/api/contracts']){
  assert.equal(module.protectedBootstrapReadinessProbe('GET',route),false);
  assert.equal(module.protectedBootstrapReadinessProbe('POST',route),false);
 }
 assert.equal(module.protectedBootstrapReadinessProbe('POST','/api/health'),false);
 assert.equal(module.protectedBootstrapReadinessProbe('GET','/api/health'),true);
 assert.equal(module.protectedBootstrapReadinessProbe('HEAD','/api/ready'),true);
});
