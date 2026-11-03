import assert from 'node:assert/strict';
import test from 'node:test';
import {compareCandidateStage,validateCandidateForeignKeyEnforcement} from '../protectedCandidateStageComparison';

function transaction(version:string,tampered=false){let calls=0;return {$queryRaw:async<T>()=>{
 calls++;if(calls===1)return [{version}] as T;
 if(calls===2&&tampered)return [{tablename:'online_releases',columnname:'unexpected'}] as T;
 return [] as T;
}};}
test('first-stage before projection matches only witnessed fields and retains explicit gaps',async()=>{
 const result=await compareCandidateStage(transaction('150018'),0);
 assert.equal(result.state,'SCOPED_MATCH');
 if(result.state==='SCOPED_MATCH')assert.ok(result.requiredSeparateGates.includes('protectedBoundary-and-assertLease'));
});
test('foreign key enforcement requires all enabled internal child and parent triggers',()=>{
 const base={constraint_id:'42',child:'child',parent:'parent',delete_action:'c',update_action:'a',enabled:'O',internal:true,function_schema:'pg_catalog',constraint_deferrable:false,constraint_initially_deferred:false,deferrable:false,initially_deferred:false,arguments:'',columns:'',when_expression:null,old_transition:null,new_transition:null};
 const rows=[{...base,relation:'child',function_name:'RI_FKey_check_ins',trigger_type:5},{...base,relation:'child',function_name:'RI_FKey_check_upd',trigger_type:17},
  {...base,relation:'parent',function_name:'RI_FKey_cascade_del',trigger_type:9},{...base,relation:'parent',function_name:'RI_FKey_noaction_upd',trigger_type:17}];
 assert.equal(validateCandidateForeignKeyEnforcement(rows),true);
 assert.equal(validateCandidateForeignKeyEnforcement(rows.slice(1)),false);
 assert.equal(validateCandidateForeignKeyEnforcement(rows.map((r,i)=>i===2?{...r,enabled:'D'}:r)),false);
 assert.equal(validateCandidateForeignKeyEnforcement(rows.map((r,i)=>i===3?{...r,function_name:'RI_FKey_cascade_upd'}:r)),false);
});
test('wrong version is unknown and changed witnessed fields mismatch',async()=>{
 assert.equal((await compareCandidateStage(transaction('150017'),0)).state,'UNKNOWN');
 assert.equal((await compareCandidateStage(transaction('150018',true),0)).state,'MISMATCH');
 assert.equal((await compareCandidateStage(transaction('150018'),15)).state,'UNKNOWN');
});
