import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLocalPreparationFixture as fixture} from './original-local-preparation.fixture.mjs';
const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8');
test('raw RUN_LOCAL preparation failure has a same-owner closure boundary before allocation',()=>{
 const begin=source.indexOf('  async runOriginalLocalPreparation('),end=source.indexOf('  async observeLocalMemoryPressure()',begin);
 assert.ok(begin>0&&end>begin,'ORIGINAL_RUN_LOCAL_PREPARATION_BOUNDARY_MISSING');
 const block=source.slice(begin,end).replaceAll('await import(','await load(');
 assert.doesNotThrow(()=>new vm.Script('({'+block+'})'));
});

for(const mode of ['raw','END-replacement','no-suspension'])test(mode+' preserves producer lineage and drains actual sampler and Git originals before a negative terminal',async()=>{
 const f=await fixture(mode);try{const error=await f.run();assert.equal(error,mode==='END-replacement'?f.replacement:f.original);const pending=f.runtime.inspect().localPreparation;assert.equal(pending.originalError,f.original);assert.equal(pending.outerError,error);assert.equal(pending.phase,'FAILED');assert.equal(f.failureMap.has(error),false);const terminal=await f.owner.finishOriginalLocalPreparationFailure(error,3);assert.ok(terminal&&f.failureMap.has(terminal));assert.equal(f.runtime.inspect().localPreparation.phase,'CLOSED');assert.equal(f.recovered(),true);assert.equal(f.sampler.inspect().closed,true);assert.equal(f.samplerUnknown(),false);assert.ok(f.children.every(c=>c.code===0&&c.signal===null&&c.stdoutEof&&c.stderrEof));const facts=f.failureMap.get(terminal).facts;assert.equal(facts.localAllocated,false);assert.equal(facts.qualificationSucceeded,false);assert.ok(facts.allReadOnlyOriginalsClosed&&facts.samplerDrained);assert.equal(await f.owner.finishOriginalLocalPreparationFailure(error,3),null);assert.equal(f.runCount(),1);assert.ok(f.trace.includes('protected-hold:backend-retained'));assert.ok(f.trace.some(v=>v==='original-git:rev-parse HEAD'));}finally{await f.remove();}
});
for(const mode of ['registered','registration-throws'])test(mode+' atomically revokes early closure even if registration itself throws',async()=>{
 const f=await fixture(mode);try{const error=await f.run();assert.equal(await f.owner.finishOriginalLocalPreparationFailure(error,3),null);assert.equal(f.runtime.inspect().localPreparation.phase,'REGISTERED');assert.equal(f.recovered(),false);assert.equal(f.failureMap.has(error),false);}finally{await f.remove();}
});
for(const mode of ['resource-drift','source-drift','cancelled','git-exit1','late-identity-drift'])test(mode+' cannot turn a raw error into normal-negative custody',async()=>{
 const f=await fixture(mode);try{const error=await f.run();await assert.rejects(f.owner.finishOriginalLocalPreparationFailure(error,3));assert.equal(f.failureMap.has(error),false);assert.notEqual(f.runtime.inspect().localPreparation.phase,'CLOSED');if(mode==='git-exit1'){const observed=f.runtime.inspect().localPreparation.observations;assert.equal(observed.length,1);assert.equal(observed[0].receipt.code,1);assert.equal(observed[0].child.exitCode,1);assert.ok(observed[0].receipt.stdoutEof&&observed[0].receipt.stderrEof);}}finally{await f.remove();}
});
test('foreign error, sequence or unknown observation cannot close the current attempt',async()=>{
 const f=await fixture();try{const error=await f.run();assert.equal(await f.owner.finishOriginalLocalPreparationFailure(new Error(error.message),3),null);assert.equal(await f.owner.finishOriginalLocalPreparationFailure(error,4),null);f.runtime.setUnknown();await assert.rejects(f.owner.finishOriginalLocalPreparationFailure(error,3));assert.equal(f.failureMap.has(error),false);}finally{await f.remove();}
});

test('actual retained binding without frontend suspension retains a separate genuine completion and only accepts audited browser epochs',async()=>{
 const a=source.indexOf('  async bindOriginalRetainedBrowserReturn('),b=source.indexOf('  // Opaque epoch/receipt',a),method=source.slice(a,b).replaceAll('await import(','await load('),current=[{service:'frontend',id:'same-main'},{service:'backend-candidate',id:'same-candidate'},{service:'frontend-candidate',id:'returned-candidate'},{service:'frontend-retained',id:'returned-retained'}],before=current.map(row=>({...row,...(row.service.startsWith('frontend-')?{id:'old-'+row.service}:{})})),token=Object.freeze({}),facts={rootOperation:'root',componentQualified:true,operation:'retained'};
 for(const drift of [false,true]){let bound=0;const projection=structuredClone(current);if(drift)projection[0].id='foreign-main';const context={assert,structuredClone,load:async()=>({readOriginalRetainedBrowserReturnCustody:value=>{assert.equal(value,token);return facts;}}),bindRetainedParent:async()=>{bound++;return{protected:true};},inspectAll:async()=>({same:true}),protectedEqual(){},resources:async()=>{},candidateBeforeUpConfiguration:()=>projection,before};
  const factory=vm.compileFunction(`let devScope=null,devRetainedReturn=null,retainedPreparationReturn=null,qualifiedConfiguration=before;const owner={${method}};return{owner,retained:()=>retainedPreparationReturn,configuration:()=>qualifiedConfiguration};`,Object.keys(context)),runtime=factory(...Object.values(context));
  if(drift){await assert.rejects(runtime.owner.bindOriginalRetainedBrowserReturn(token,()=>{}));assert.equal(runtime.retained(),null);}else{assert.deepEqual(await runtime.owner.bindOriginalRetainedBrowserReturn(token,()=>{}),{protected:true});assert.equal(runtime.retained().completion,token);assert.deepEqual(runtime.retained().facts,facts);assert.deepEqual(runtime.configuration(),current);}assert.equal(bound,1);
 }
});

for(const mode of ['ledger-push-fault','ledger-post-spawn','receipt-clone-fault'])test(mode+' cannot abandon an original or mint preparation closure',async()=>{
 const f=await fixture(mode);try{const error=await f.run();assert.equal(f.runtime.inspect().unknown,true);await assert.rejects(f.owner.finishOriginalLocalPreparationFailure(error,3));assert.equal(f.failureMap.has(error),false);const rows=f.runtime.inspect().localPreparation.observations;
  if(mode==='ledger-push-fault'){assert.equal(rows.length,0);assert.ok(!f.trace.some(v=>v.startsWith('original-git:')));}
  else{assert.equal(rows.length,1);const row=rows[0];assert.equal(row.child.exitCode,0);assert.ok(row.child.stdout.readableEnded&&row.child.stderr.readableEnded);assert.ok(row.receipt.stdoutEof&&row.receipt.stderrEof);if(mode==='ledger-post-spawn'){assert.equal(row.receipt.stdoutBytes,1048576);assert.equal(row.receipt.stderrBytes,65536);}else assert.equal(row.receipt.observationFault,true);}
 }finally{await f.remove();}
});

for(const mode of ['success','success-no-suspension'])test(mode+' preserves the genuine later LOCAL boundary without manufacturing a negative or closing the sampler',async()=>{
 const f=await fixture(mode);try{const result=await f.owner.runWithMemoryPressure('LOCAL',()=>f.owner.runOriginalLocalPreparation(f.options,3));assert.deepEqual(result,{fixtureLocalCompletion:true});assert.equal(f.runtime.inspect().localPreparation.phase,'REGISTERED');assert.ok(f.runtime.inspect().localDirectory);assert.equal(f.sampler.inspect().closed,false);assert.equal(f.recovered(),false);assert.equal(await f.owner.finishOriginalLocalPreparationFailure(new Error('foreign'),3),null);assert.equal(f.runCount(),1);}finally{await f.remove();}
});
