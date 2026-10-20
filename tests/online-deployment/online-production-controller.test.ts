import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryDeploymentStore,transitionDeployment,deploymentFailureAction} from '../../backend/src/services/deploymentControl';
import {recordOwnedOnlinePublication} from '../../backend/src/services/onlineReleaseEpochs';
import {snapshotOnlineSupportWindow} from '../../backend/src/services/onlineReleaseSupportWindow';
const owner={deploymentId:'deployment_new',releaseId:'release_new',leaseToken:'owned-token'};
const now=new Date('2026-10-20T00:00:00Z');
test('online phases cannot fabricate maintenance checkpoint/drain transitions or invoke restoring rollback',async()=>{
 const store=new InMemoryDeploymentStore();
 await store.create({...owner,targetCommit:'a'.repeat(40),owner:'original',phase:'LEASE_ACQUIRED',leaseExpiresAt:new Date(now.getTime()+600000),heartbeatAt:now,startedAt:now,updatedAt:now});
 for(const nextPhase of ['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING'] as const)
  await transitionDeployment(store,{...owner,nextPhase,now});
 await assert.rejects(transitionDeployment(store,{...owner,nextPhase:'SERVICES_DRAINED',now}),/Invalid deployment transition/);
 assert.equal(deploymentFailureAction('ONLINE_SERVING',false),'FAIL_CLOSED_RECOVERY_REQUIRED');
 assert.equal(deploymentFailureAction('ONLINE_EXPANDING',false),'FAIL_CLOSED_RECOVERY_REQUIRED');
});
function fake(options:{head?:boolean;phase?:string;rollback?:boolean}={}){
 const writes:Array<{sql:string;values:any[]}>=[];
 const tx={
  async $queryRaw(parts:TemplateStringsArray,...values:any[]){const sql=parts.join('?');
   if(sql.includes('FROM deployment_operations'))return [{releaseId:owner.releaseId,phase:options.phase??'ONLINE_PUBLISHING'}];
   if(sql.includes('FROM online_releases'))return [{id:'release_old',phase:'SERVING'},{id:owner.releaseId,phase:options.rollback?'RETAINED':'READY'}];
   if(sql.includes('FROM online_runtime_slots'))return [{id:'runtime_new'}];
   if(sql.includes('FROM online_serving_epochs'))return options.head===false?[]:[{id:'epoch_old',releaseId:'release_old',generation:4}];
   if(sql.includes('clock_timestamp() AS now'))return [{now}];throw Error(sql);
  },
  async $executeRaw(parts:TemplateStringsArray,...values:any[]){writes.push({sql:parts.join('?'),values});return 1;}
 };
 return {database:{$transaction:async(fn:any)=>fn(tx)} as any,writes};
}
const publication={releaseId:owner.releaseId,previousReleaseId:'release_old',generation:5,publicationSha256:'a'.repeat(64),rollback:false};
test('publication refuses missing protected bootstrap or wrong owned phase before any write',async()=>{
 for(const options of [{head:false},{phase:'GATES_PASSED'}]){const fixture=fake(options);
  await assert.rejects(recordOwnedOnlinePublication(fixture.database,owner,publication));assert.equal(fixture.writes.length,0);}
});
test('current-data rollback adds epoch and extends old support without resetting retirement or restoring data',async()=>{
 const fixture=fake({phase:'ONLINE_ROLLBACK_PUBLISHING',rollback:true});
 const result=await recordOwnedOnlinePublication(fixture.database,owner,{...publication,rollback:true});
 assert.equal(result.databaseRestored,false);assert.equal(Date.parse(result.retainedUntil)-now.getTime(),86400000);
 assert.ok(fixture.writes.some(row=>row.sql.includes('coalesce("retiredAt"')));
 assert.ok(fixture.writes.some(row=>row.sql.includes('greatest("browserSupportUntil"')));
 assert.ok(fixture.writes.some(row=>row.sql.includes('INSERT INTO online_serving_epochs')));
 assert.ok(fixture.writes.every(row=>!row.sql.includes('"retiredAt"=NULL')));
});
test('READY support snapshot confers no retirement window or serving phase',()=>{
 assert.equal(snapshotOnlineSupportWindow({phase:'READY',now,retiredAt:null,browserSupportUntil:null}).phase,'READY');
 assert.throws(()=>snapshotOnlineSupportWindow({phase:'READY',now,retiredAt:now,browserSupportUntil:new Date(now.getTime()+86400000)}));
});

test('rollback runtime uses original accepted deployment identity, not the newer candidate lease identity',async()=>{
 const {onlineRuntimeDeploymentMatches}=await import('../../backend/src/services/onlineReleaseDeploymentBinding');
 const oldScope={releaseId:'release_retained',sourceCommit:'b'.repeat(40)};
 assert.equal(onlineRuntimeDeploymentMatches({releaseId:oldScope.releaseId,targetCommit:oldScope.sourceCommit},oldScope),true);
 assert.equal(onlineRuntimeDeploymentMatches({releaseId:owner.releaseId,targetCommit:'c'.repeat(40)},oldScope),false);
 const fixture=fake({phase:'ONLINE_ROLLBACK_PUBLISHING',rollback:true});
 await recordOwnedOnlinePublication(fixture.database,owner,{...publication,rollback:true});
 assert.ok(fixture.writes.some(row=>row.sql.includes("SET phase='ONLINE_SERVING'")));
 assert.ok(fixture.writes.every(row=>!row.sql.includes("phase='ROLLED_BACK'")));
});
