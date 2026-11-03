import test from'node:test';import assert from'node:assert/strict';
import{closeOriginalCompleteClients}from'../../scripts/lib/restored-qa/complete-client-closure.mjs';
for(const fault of ['issuer','owner','inquiry','persist'])test('both original client closures are attempted after '+fault+' failure',async()=>{
 const primary=Error('unit-primary'),calls=[],stored=[];
 const issuer={close(){calls.push('issuer');if(fault==='issuer')throw primary;return{failed:false,allOriginalHttpReadersClosed:true};}};
 const inquiry={close(){calls.push('inquiry');if(fault==='inquiry')throw primary;return{failed:false,closed:true};}};
 await assert.rejects(closeOriginalCompleteClients({issuer,inquiry,assertOwner(){if(fault==='owner')throw primary;},persist(value){stored.push(structuredClone(value));if(fault==='persist')throw primary;return{file:'unit'};}}),error=>error instanceof AggregateError&&error.errors.includes(primary));
 assert.deepEqual(calls,['issuer','inquiry']);assert.equal(stored.length,1);if(fault!=='persist')assert.equal(stored[0].pass,false);
});
test('positive closure requires actual ownership and both clean retained transports',async()=>{
 let stored;const reference=await closeOriginalCompleteClients({issuer:{close:()=>({failed:false,allOriginalHttpReadersClosed:true})},inquiry:{close:()=>({failed:false,closed:true})},assertOwner(){},persist(value){stored=value;return{file:'unit'};}});assert.equal(stored.pass,true);assert.deepEqual(reference,{file:'unit'});
});
