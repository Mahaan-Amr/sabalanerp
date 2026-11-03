/** NOT RUN: acceptance skeleton for the native candidate path. It is disabled
 * until an owned test-database/owner fixture, complete candidate applier and
 * reviewed fault/interruption barriers exist. Do not enable for production. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runNegativeProjectionFixture} from './protectedCandidateNegativeFixture';
import {exactCandidateMigrationNames,exactCandidateMigrationDigests,exactCandidatePlanSha256} from '../protectedCandidateMigrationInventory';

type NativeHistoryRow={name:string;checksum:string;finished:boolean;rolledBack:boolean;receipt:unknown};
type NativeSnapshot={history:readonly NativeHistoryRow[];catalogSha256:string};

/** Pure acceptance assertions; snapshots must eventually come from the owned
 * database and existing catalog reader, never from a caller-supplied MATCH. */
function assertCompleteNativeHistory(snapshot:NativeSnapshot,checkpoint:string){
 assert.match(checkpoint,/^[a-f0-9]{64}$/);assert.match(snapshot.catalogSha256,/^[a-f0-9]{64}$/);
 const rows=snapshot.history.filter(row=>exactCandidateMigrationNames.includes(row.name)&&!row.rolledBack);
 assert.equal(rows.length,14);
 let previous:string|undefined;
 for(let i=0;i<14;i++){
  const row=rows[i],name=exactCandidateMigrationNames[i];assert.equal(row.name,name);assert.equal(row.checksum,exactCandidateMigrationDigests[name]);assert.equal(row.finished,true);
  const r=row.receipt as Record<string,unknown>;assert.equal(r?.format,'sabalan-owned-candidate-migration/v2');assert.equal(r.planSha256,exactCandidatePlanSha256);
  assert.equal(r.sqlSha256,row.checksum);assert.equal(r.checkpointSha256,checkpoint);assert.match(String(r.beforeScopedProjectionSha256),/^[a-f0-9]{64}$/);assert.match(String(r.afterScopedProjectionSha256),/^[a-f0-9]{64}$/);
  if(previous!==undefined)assert.equal(r.beforeScopedProjectionSha256,previous);previous=String(r.afterScopedProjectionSha256);
 }
 assert.equal(previous,snapshot.catalogSha256);
}
function assertAtomicFailure(before:NativeSnapshot,after:NativeSnapshot){assert.deepEqual(after,before);}

// Kept skipped until independent review of exact manifest, command, native
// custody and test database operation; the fixture retains its resources.
async function negativeCandidateCli():Promise<void>{
 const file=process.env.SABALAN_REVIEWED_NEGATIVE_FIXTURE_CONFIG;
 if(!file)throw Error('SYNTHETIC_FIXTURE_CONFIG_REQUIRED');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=await runNegativeProjectionFixture(input);
 assert.equal(result.state,'OBSERVED');
}

test.skip('NOT_RUN: actual owned candidate CLI refuses missing projection with observed scope unchanged',negativeCandidateCli);
test.skip('NOT_RUN: actual owner applies 14 pinned migrations with atomic history and catalog',()=>{
 // Requires complete owned applier, native snapshots and independent catalog qualification.
 assert.equal(typeof assertCompleteNativeHistory,'function');
});
test.skip('NOT_RUN: actual interruption resumes only the verified owned prefix',()=>{
 // Requires reviewed interruption barrier and native descendant closure.
});
