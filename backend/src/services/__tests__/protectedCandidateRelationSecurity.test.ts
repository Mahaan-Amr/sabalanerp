import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {candidateStageProjection} from '../protectedCandidateStageProjection';
import {observeCandidateRelationSecurity} from '../protectedCandidateRelationSecurity';

test('relation checks bind current control role without pinning an owner name',async()=>{
 const expected=candidateStageProjection(1);assert.equal(expected.state,'SCOPED_EXPECTATION');if(expected.state!=='SCOPED_EXPECTATION')return;
 const empty=createHash('sha256').update(JSON.stringify({columns:[],constraints:[],indexes:[],triggers:[]})).digest('hex');
 const rows=Object.entries(expected.tables).filter(([,hash])=>hash!==empty).map(([name])=>({name,kind:'r',persistence:'p',rls:false,forced:false,policies:0,inheritance:0,ownerRights:true,selectable:true,insertable:true,updatable:true,deletable:true}));
 const make=(values:unknown[])=>({$queryRaw:async<T>()=>values as T});
 assert.equal((await observeCandidateRelationSecurity(make(rows),1)).state,'SCOPED_MATCH');
 assert.equal((await observeCandidateRelationSecurity(make(rows.map((r,i)=>i? r:{...r,rls:true})),1)).state,'MISMATCH');
 assert.equal((await observeCandidateRelationSecurity(make(rows.map((r,i)=>i? r:{...r,ownerRights:false})),1)).state,'MISMATCH');
 assert.equal((await observeCandidateRelationSecurity(make([]),1)).state,'MISMATCH');
});
