import test from 'node:test';
import assert from 'node:assert/strict';
import {runPhase1Plan} from '../../scripts/lib/reconciliation-phase1-core.mjs';
test('known actor stops before acquisition',async()=>{
 let acquired=false;
 const ports={census:async()=>({status:'OBSERVED_CONFLICT'}),acquire:async()=>{acquired=true;}};
 await assert.rejects(runPhase1Plan(ports),/PHASE1_ACTOR_CENSUS_NOT_CLEAR/);assert.equal(acquired,false);
});
test('unknown native actor coverage stops before acquisition',async()=>{
 let acquired=false;
 const ports={census:async()=>({status:'UNKNOWN'}),acquire:async()=>{acquired=true;}};
 await assert.rejects(runPhase1Plan(ports),/PHASE1_ACTOR_CENSUS_NOT_CLEAR/);assert.equal(acquired,false);
});
