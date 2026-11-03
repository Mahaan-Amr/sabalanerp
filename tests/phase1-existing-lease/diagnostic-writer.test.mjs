import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {writeDiagnostic} from '../../scripts/lib/reconciliation-readonly-phase1-cli.mjs';
const evidence=label=>({label,bytes:1,sha256:'a'.repeat(64),fileId:'1:'+'0'.repeat(32),sourceSha256:'b'.repeat(64),pathSnapshot:'NONATOMIC_ANCESTOR_UNPROVEN',concurrentContentMutation:'UNPROVEN'});
test('direct diagnostic writer publishes allowlisted success without arbitrary values',async()=>{
 const census={processSnapshot:{format:'phase1-process-snapshot/v1',completeActorCensus:false},actorCoverage:{windowsKnownEntrypoints:'BOUNDED_NO_MATCH',wslNativeEntrypoints:'UNKNOWN',leaseHandleOwners:'UNKNOWN',secret:'fixture-secret'},evidence:[evidence('baseline'),evidence('roleHeld')],secret:'fixture-secret'};
 const r=await writeDiagnostic(census,null);const raw=await readFile(r.target,'utf8');const parsed=JSON.parse(raw);
 assert.equal(parsed.status,'NOT_QUALIFIED');assert.equal(parsed.census.safeState,'UNKNOWN');assert.equal(raw.includes('fixture-secret'),false);
});
test('direct diagnostic writer publishes failure as unknown',async()=>{
 const r=await writeDiagnostic(null,'Error');const parsed=JSON.parse(await readFile(r.target,'utf8'));
 assert.equal(parsed.failure,'Error');assert.equal(parsed.census,'UNKNOWN');assert.equal(parsed.liveLeaseAcquired,false);
});
