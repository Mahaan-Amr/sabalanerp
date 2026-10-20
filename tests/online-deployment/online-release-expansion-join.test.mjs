import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url)),ts=require('typescript');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function load(file,mocks){
 const source=fs.readFileSync(new URL('../../backend/src/services/'+file,import.meta.url),'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}});
 const module={exports:{}};new Function('module','exports','require',result.outputText)(module,module.exports,key=>{
  if(key.startsWith('node:'))return require(key);assert.ok(Object.hasOwn(mocks,key),'unexpected dependency '+key);return mocks[key];
 });return module.exports;
}
const primitive=load('onlineMigrationPlan.ts',{'./deploymentMaintenance':{deploymentMaintenanceActive:()=>false},'./recoveryRuntime':{RECOVERY_COORDINATION_DIR:'/private'}});
const plan={format:'sabalan-online-expansion/v1',migrationName:'20261020150000_online_mirror',
 operations:[{kind:'mirror-column',table:'canonical_values',column:'amount_v2',sourceColumn:'amount',type:'numeric(24,8)'}]};
function fixture(){
 const owner={deploymentId:'owned_deployment',leaseToken:'original_token',releaseId:'new_release'};
 const input={previousReleaseId:'old_release',manifestSha256:'a'.repeat(64)};
 const checkpoint={deploymentId:owner.deploymentId,releaseId:owner.releaseId,localVerified:true,remoteVerified:true,restoreVerified:true,
  manifestReadable:true,compatibility:{local:{compatible:true},remote:{compatible:true}}};
 let historyRaw='[{"id":"original","migration_name":"existing","checksum":"original"}]';
 const before={rows:1,sha256:createHash('sha256').update(historyRaw).digest('hex')};
 const prepared={manifest:{releaseId:owner.releaseId,sourceCommit:'b'.repeat(40),database:{name:'actual_database',systemIdentifier:'123'}},
  acceptance:{checkpointSha256:hash(checkpoint),qualification:{deploymentTargetDatabase:{oid:'456'},recoveryMode:'ONLINE_COHERENT_WAL'}},identityJson:{accepted:'identity'},compatibilityJson:{},recoveryJson:{},slots:[],
  accepted:{migrationPlans:[plan],migrationHistories:[{before,afterRows:2}],revalidate(){}}};
 let phase='ONLINE_CHECKPOINTING',release=null,priorExists=true,maintenance=false,applied=0,backfills=0,verified=0,interrupt=false;
 const steps=[];
 const tx={onlineRelease:{create:async({data})=>{assert.equal(release,null);release=structuredClone(data);},findUnique:async()=>release,
  update:async({data})=>{Object.assign(release,data);return release;}},
  onlineRuntimeSlot:{createMany:async()=>{}},
  onlineMigrationStep:{create:async({data})=>steps.push(structuredClone(data)),findMany:async()=>structuredClone(steps)},
  deploymentOperation:{update:async({data})=>{phase=data.phase;}},
  $queryRaw:async(strings)=>{const sql=strings.join('');
   if(sql.includes('FROM deployment_operations'))return[{targetCommit:prepared.manifest.sourceCommit,checkpointJson:checkpoint}];
   if(sql.includes('FROM online_releases r'))return priorExists?[{id:'old_release'}]:[];
   if(sql.includes('pg_control_system'))return[{name:'actual_database',system:'123',oid:'456'}];
   if(sql.includes('json_agg'))return[{value:historyRaw}];
   if(sql.includes('SELECT migration_name'))return[];
   assert.fail('unexpected SQL '+sql);
  }};
 const database={$transaction:async work=>work(tx)};
 const module=load('onlineReleaseExpansion.ts',{
  './onlineReleaseRegistration':{prepareValidatedOnlineRegistration:()=>prepared},
  './onlineReleaseEpochs':{assertOwnedOnlineLease:async(_tx,actual,phases)=>{assert.deepEqual(actual,owner);assert.ok(phases.includes(phase),'wrong owned phase');}},
  './deploymentMaintenance':{deploymentMaintenanceActive:()=>maintenance},'./recoveryRuntime':{RECOVERY_COORDINATION_DIR:'/private'},
  './onlineMigrationPlan':{...primitive,
   applyOnlineExpansion:async(_database,actual,qualified,bytes)=>{assert.deepEqual(actual,owner);assert.equal(release.phase,'EXPANDING');
    assert.deepEqual(bytes,Buffer.from(primitive.compileOnlineExpansion(qualified).sql));steps.find(s=>s.phase==='expand').state='COMPLETE';applied++;},
   verifyAppliedOnlineExpansion:async()=>{assert.equal(release.phase,'BACKFILLING');assert.equal(steps.find(s=>s.phase==='expand').state,'COMPLETE');verified++;},
   backfillMirroredColumn:async(_db,_owner,stepId,backfill,batch)=>{assert.equal(batch,200);assert.equal(release.phase,'BACKFILLING');
    assert.equal(backfill.expansionMigrationName,plan.migrationName);backfills++;const step=steps.find(s=>s.stepId===stepId);
    if(step.state==='PENDING'){step.state='RUNNING';if(interrupt)throw Error('ORIGINAL_BATCH_INTERRUPTED');return{complete:false};}
    step.state='COMPLETE';return{complete:true};},
  }});
 return{...module,database,owner,input,checkpoint,prepared,steps,
  release:()=>release,phase:()=>phase,calls:()=>({applied,backfills,verified}),
  setInterrupt:value=>{interrupt=value;},setMaintenance:value=>{maintenance=value;},setPrior:value=>{priorExists=value;},
  driftHistory:()=>{historyRaw='[{"id":"unexpected-history"}]';}};
}
test('qualified checkpoint prepares the exact expansion/backfill ledger, then runs only bounded primitives into ACCEPTING',async()=>{
 const f=fixture();await f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input);
 assert.equal(f.release().phase,'EXPANDING');assert.equal(f.phase(),'ONLINE_EXPANDING');assert.deepEqual(f.calls(),{applied:0,backfills:0,verified:0});
 assert.equal(f.steps.length,2);assert.equal(f.steps.find(s=>s.phase==='expand').sourceMigrationName,plan.migrationName);
 const result=await f.runAcceptedOnlineExpansion(f.database,f.owner,f.input);
 assert.equal(result.productionAdmission,false);assert.equal(f.release().phase,'ACCEPTING');assert.equal(f.phase(),'ONLINE_ACCEPTING');
 assert.deepEqual(f.calls(),{applied:1,backfills:2,verified:2});assert.ok(f.steps.every(s=>s.state==='COMPLETE'));
});
test('actual interrupted backfill resumes without replaying DDL or regressing the release phase',async()=>{
 const f=fixture();await f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input);f.setInterrupt(true);
 await assert.rejects(f.runAcceptedOnlineExpansion(f.database,f.owner,f.input),/ORIGINAL_BATCH_INTERRUPTED/);
 assert.equal(f.release().phase,'BACKFILLING');assert.equal(f.phase(),'ONLINE_EXPANDING');assert.equal(f.calls().applied,1);
 f.setInterrupt(false);await f.runAcceptedOnlineExpansion(f.database,f.owner,f.input);
 assert.equal(f.calls().applied,1);assert.equal(f.release().phase,'ACCEPTING');assert.equal(f.phase(),'ONLINE_ACCEPTING');
});
test('unverified checkpoint, predecessor loss, maintenance and qualified prior-history drift refuse before registration',async()=>{
 for(const change of [f=>{f.checkpoint.remoteVerified=false;},f=>f.setPrior(false),f=>f.setMaintenance(true),f=>f.driftHistory()]){
  const f=fixture();change(f);await assert.rejects(f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input));
  assert.equal(f.release(),null);assert.equal(f.calls().applied,0);
 }
});
test('a protected-maintenance COMPLETE qualification cannot enter an online expansion lease',async()=>{
 const f=fixture();f.prepared.acceptance.qualification.recoveryMode='PROTECTED_MAINTENANCE_COMPLETE';
 await assert.rejects(f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input),/COHERENT_WAL_REQUIRED/);
 assert.equal(f.release(),null);assert.equal(f.calls().applied,0);
});
test('run refuses release evidence or step drift before DDL; a null predecessor never becomes implicit bootstrap',async()=>{
 for(const change of [f=>{f.release().identityJson={unqualified:true};},f=>{f.steps[0].operationSha256='f'.repeat(64);},
  f=>{f.steps.push({...f.steps[0],stepId:'unqualified_extra'});},f=>f.driftHistory()]){
  const f=fixture();await f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input);change(f);
  await assert.rejects(f.runAcceptedOnlineExpansion(f.database,f.owner,f.input));assert.equal(f.calls().applied,0);
 }
 const f=fixture();f.input.previousReleaseId=null;await assert.rejects(f.prepareAcceptedOnlineExpansion(f.database,f.owner,f.input),/BOOTSTRAP_REQUIRED/);
});
