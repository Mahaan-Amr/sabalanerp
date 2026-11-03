import test from 'node:test';
import assert from 'node:assert/strict';
import {runReadOnlyReconciliationAudit} from './reconciliation-readonly-phase1.mjs';
process.env.NODE_ENV='test';
function fixture() {
  const events=[];
  const lease={assertHeld:async()=>events.push('held'),release:async()=>events.push('release')};
  const ports={
    testOnly:true,
    freshCensus:async()=>({freshIdentityBound:true,noParallelOperationalOwner:true,canonicalFileAlreadyPresentAndBound:true,reviewedAuthority:true}),
    acquireOriginalCanonicalLease:async()=>{events.push('acquire');return lease;},
    auditReadOnly:async()=>({readersAndChildrenClosed:true,newOutstandingObligations:0,evidence:{testOnly:true}}),
    writeDurableAuditRecord:async record=>{events.push('record');assert.equal(record.oldObligation,'RETAINED_UNRESOLVED');},
    retainUnresolvedLease:async()=>events.push('retain'),
  };
  return {ports,events};
}
test('a completed audit records unknowns before releasing its own lease',async()=>{
  const {ports,events}=fixture();const result=await runReadOnlyReconciliationAudit(ports);
  assert.deepEqual(events,['acquire','held','held','record','held','release']);
  assert.equal(result.historicalEof,'UNKNOWN');assert.equal(result.scopeReuse,false);
});
test('no acquisition when the owner census is inconclusive',async()=>{
  const {ports,events}=fixture();ports.freshCensus=async()=>({freshIdentityBound:true,noParallelOperationalOwner:false});
  await assert.rejects(runReadOnlyReconciliationAudit(ports),/PARALLEL_OWNER_UNPROVEN/);assert.deepEqual(events,[]);
});
test('incomplete reader closure retains lease and never publishes success',async()=>{
  const {ports,events}=fixture();ports.auditReadOnly=async()=>({readersAndChildrenClosed:false,newOutstandingObligations:0});
  await assert.rejects(runReadOnlyReconciliationAudit(ports),/AUDIT_CLOSURE_UNPROVEN/);
  assert.deepEqual(events,['acquire','held','retain']);
});
test('durable record failure retains lease without release',async()=>{
  const {ports,events}=fixture();ports.writeDurableAuditRecord=async()=>{throw Error('disk failure');};
  await assert.rejects(runReadOnlyReconciliationAudit(ports),/disk failure/);assert.deepEqual(events,['acquire','held','held','retain']);
});
test('a caller without the test fixture marker cannot start acquisition',async()=>{
  const {ports,events}=fixture();delete ports.testOnly;
  await assert.rejects(runReadOnlyReconciliationAudit(ports),/PHASE1_OPERATIONAL_ADAPTER_UNAVAILABLE/);
  assert.deepEqual(events,[]);
});
