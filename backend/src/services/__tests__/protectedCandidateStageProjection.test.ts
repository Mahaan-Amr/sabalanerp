import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {candidateStageProjection} from '../protectedCandidateStageProjection';
import {candidateStageWitness} from '../protectedCandidateStageWitness';

test('shared invoice table uses the latest completed stage, not its creation snapshot',()=>{
 const before=candidateStageProjection(8),after=candidateStageProjection(9),later=candidateStageProjection(10);
 assert.equal(before.state,'SCOPED_EXPECTATION');assert.equal(after.state,'SCOPED_EXPECTATION');assert.equal(later.state,'SCOPED_EXPECTATION');
 if(before.state!=='SCOPED_EXPECTATION'||after.state!=='SCOPED_EXPECTATION'||later.state!=='SCOPED_EXPECTATION')return;
 assert.notEqual(before.tables.sales_dispatch_invoices,after.tables.sales_dispatch_invoices);
 assert.equal(after.tables.sales_dispatch_invoices,later.tables.sales_dispatch_invoices);
 assert.ok(after.requiredSeparateGates.includes('protectedBoundary-and-assertLease'));
});
test('unrecognized prefix never produces an expectation',()=>{
 for(const value of [-1,15,0.5,NaN])assert.equal(candidateStageProjection(value).state,'UNKNOWN');
});
const localReceipt='C:/Users/mahan/AppData/Local/Temp/sabalan-schema-witness-UgZsT6/receipt.json';
test('local retained receipt reproduces every scoped stage fingerprint',{skip:!fs.existsSync(localReceipt)},()=>{
 const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');const bytes=fs.readFileSync(localReceipt);
 assert.equal(hash(bytes),candidateStageWitness.receiptSha256);const receipt=JSON.parse(bytes.toString());assert.equal(receipt.state,'WITNESSED');
 for(const [i,step] of candidateStageWitness.stages.entries()){
  const original=receipt.observation.stages[i];assert.equal(step.name,original.stage);assert.equal(step.sqlSha256,original.sqlSha256);
  assert.deepEqual(step.coverage,original.coverage);
  for(const side of ['before','after'] as const){
   for(const [table,digest] of Object.entries(step[side].tables)){
    const q=original[side],v={columns:q.columns.filter((x:any)=>x.tablename===table),constraints:q.constraints.filter((x:any)=>x.tablename===table),indexes:q.indexes.filter((x:any)=>x.tablename===table),triggers:q.triggers.filter((x:any)=>x.tablename===table)};
    assert.equal(hash(JSON.stringify(v)),digest);
   }
   for(const [name,digest] of Object.entries(step[side].functions))assert.equal(hash(JSON.stringify(original[side].functions.filter((x:any)=>x.name===name))),digest);
  }
 }
});
