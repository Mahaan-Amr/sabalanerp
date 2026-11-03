import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {compileProtectedFinancialMigrationPlan, verifyProtectedFinancialNativeRun} from '../protectedFinancialMigrationEvidence';

const names=['20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier',
 '20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion','20261020093000_online_serving_epochs'];
const hr='20261014120000_hr_vehicle_assignment_plans';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const files=()=>new Map(names.map(name=>[name,Buffer.from(fs.readFileSync(path.resolve(__dirname,'../../../prisma/migrations',name,'migration.sql'),'utf8').replace(/\r\n/g,'\n'))]));
function fixture(){
 const source=files(), plan=compileProtectedFinancialMigrationPlan(source);
 const row=(name:string,id:string,logs:string|null)=>({id,migration_name:name,checksum:source.has(name)?sha(source.get(name)!):'c'.repeat(64),started_at:'2026-10-24T00:00:00+00:00',finished_at:'2026-10-24T00:00:01+00:00',rolled_back_at:null as string|null,logs,applied_steps_count:1});
 const before=Array.from({length:439},(_,i)=>row(i===0?hr:'historical_'+i,'original_'+i,null));
 before.push({...row(names[0],'original_rolled_back',null),rolled_back_at:'2026-10-24T00:01:00+00:00'});
 const added=names.map((name,i)=>row(name,'added_'+i,JSON.stringify({format:'sabalan-protected-bridge/v1',sqlSha256:sha(source.get(name)!),catalogSha256:'d'.repeat(64)})));
 const beforeRaw=JSON.stringify(before),afterRaw=JSON.stringify([...before,...added]);
 const run={format:'sabalan-owned-protected-migration-run/v1',protectedMigrationsCompleted:true,pendingCount:5,validatedAlreadyApplied:[hr],historicalInspections:[{file:'/private/hr.json',sha256:'e'.repeat(64)}],
  steps:added.map(r=>({migrationName:r.migration_name,sqlSha256:r.checksum,applied:true,nativeRow:r,ownedReceipt:JSON.parse(r.logs!)})),
  history:{before:{rows:440,appliedRows:439,sha256:sha(beforeRaw)},after:{rows:445,appliedRows:444,sha256:sha(afterRaw)},priorProjectionSha256:sha(beforeRaw),priorProjectionUnchanged:true}};
 return{source,plan,run,beforeRaw,afterRaw,priorRaw:beforeRaw};
}
test('actual five exact SQL files compile without generic SQL or bootstrap expansion',()=>{
 const a=fixture();assert.deepEqual(a.plan.steps.map(s=>s.migrationName),names);
 assert.deepEqual(a.plan.steps.map(s=>s.statementCount),[29,1,1,10,5]);
 assert.equal(a.plan.strategy,'sabalan-protected-owned-financial/v1');
 for(const change of [(m:Map<string,Buffer>)=>m.delete(names[0]),(m:Map<string,Buffer>)=>m.set(hr,Buffer.from('SELECT 1')),
  (m:Map<string,Buffer>)=>m.set(names[1],Buffer.concat([m.get(names[1])!,Buffer.from('\nSELECT 1')]))]){
  const invalid=files();change(invalid);assert.throws(()=>compileProtectedFinancialMigrationPlan(invalid));
 }
});
test('data verifier preserves all440 originals including same-name rolled-back history and returns no financial admission',()=>{
 const a=fixture(),proof=verifyProtectedFinancialNativeRun(a.plan,a.run,a.beforeRaw,a.afterRaw,a.priorRaw);
 assert.equal(proof.originalRows,440);assert.equal(proof.currentRows,445);assert.equal(proof.currentAppliedRows,444);
 assert.equal(proof.financialSchemaQualified,false);assert.equal(proof.productionAdmission,false);
 assert.equal(proof.requiresOriginalOldAndNewHttpProof,true);
 assert.throws(()=>verifyProtectedFinancialNativeRun(structuredClone(a.plan),a.run,a.beforeRaw,a.afterRaw,a.priorRaw));
});
test('native history, five owned receipts and complete raw prior projection cannot be replaced by summaries',()=>{
 const mutate=[(a:ReturnType<typeof fixture>)=>a.run.steps[0].ownedReceipt.catalogSha256='not-a-hash',
  (a:ReturnType<typeof fixture>)=>a.run.steps[0].nativeRow.logs=null,
  (a:ReturnType<typeof fixture>)=>a.run.steps.reverse(),
  (a:ReturnType<typeof fixture>)=>a.run.history.before.appliedRows=438,
  (a:ReturnType<typeof fixture>)=>a.run.historicalInspections=[],
  (a:ReturnType<typeof fixture>)=>a.priorRaw+=' ',
  (a:ReturnType<typeof fixture>)=>a.priorRaw=JSON.stringify(JSON.parse(a.beforeRaw).slice(0,-1)),
  (a:ReturnType<typeof fixture>)=>a.afterRaw=a.afterRaw.replace('original_1','changed_1')];
 for(const change of mutate){const a=fixture();change(a);assert.throws(()=>verifyProtectedFinancialNativeRun(a.plan,a.run,a.beforeRaw,a.afterRaw,a.priorRaw));}
});
