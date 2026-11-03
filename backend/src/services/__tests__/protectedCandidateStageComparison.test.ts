import assert from 'node:assert/strict';
import test from 'node:test';
import {compareCandidateStage} from '../protectedCandidateStageComparison';

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
test('wrong version is unknown and changed witnessed fields mismatch',async()=>{
 assert.equal((await compareCandidateStage(transaction('150017'),0)).state,'UNKNOWN');
 assert.equal((await compareCandidateStage(transaction('150018',true),0)).state,'MISMATCH');
 assert.equal((await compareCandidateStage(transaction('150018'),15)).state,'UNKNOWN');
});
