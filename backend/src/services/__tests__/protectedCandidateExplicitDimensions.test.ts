import assert from 'node:assert/strict';
import test from 'node:test';
import {observeCandidateExplicitDimensions} from '../protectedCandidateExplicitDimensions';

function tx(publicPrivileges=0,increment='1',bound=true){return {$queryRaw:async<T>(strings:TemplateStringsArray)=>{
 const q=strings.join('?');if(q.includes('aclexplode'))return [{present:true,publicPrivileges}] as T;
 if(q.includes('pg_catalog.pg_sequence'))return [{increment,minimum:'1',maximum:'9223372036854775807',cache:'1',cycle:false}] as T;
 if(q.includes('pg_get_serial_sequence'))return [{bound}] as T;
 throw Error('unexpected');
}};}
test('checks source-derived PUBLIC revoke and only the two relevant sequences',async()=>{
 const result=await observeCandidateExplicitDimensions(tx(),14);
 assert.equal(result.state,'SCOPED_MATCH');if(result.state==='SCOPED_MATCH')assert.deepEqual(result.checks,['customer_barrier_public_revoke','sales_invoice_sequence','purchasing_serial_binding']);
 assert.equal((await observeCandidateExplicitDimensions(tx(1),14)).state,'MISMATCH');
 assert.equal((await observeCandidateExplicitDimensions(tx(0,'2'),14)).state,'MISMATCH');
 assert.equal((await observeCandidateExplicitDimensions(tx(0,'1',false),14)).state,'MISMATCH');
});
test('stage prefix only checks objects already created and unknown responses fail closed',async()=>{
 const result=await observeCandidateExplicitDimensions(tx(),1);assert.equal(result.state,'SCOPED_MATCH');
 if(result.state==='SCOPED_MATCH')assert.deepEqual(result.checks,[]);
 assert.equal((await observeCandidateExplicitDimensions({$queryRaw:async<T>()=>[] as T},2)).state,'UNKNOWN');
});
