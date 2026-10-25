import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRestoredQaHttpControl} from '../../scripts/restored-qa-http-original';
const session='1'.repeat(64),wire=(command:string,sequence=1)=>Buffer.from(JSON.stringify({session,sequence,command}));
test('private original accepts only its ordered fixed drain and shutdown commands',()=>{
 assert.equal(parseRestoredQaHttpControl(wire('PRIVATE_PREPARE_DRAIN'),session,1).command,'PRIVATE_PREPARE_DRAIN');
 assert.equal(parseRestoredQaHttpControl(wire('PRIVATE_SHUTDOWN',2),session,2).sequence,2);
});
test('private original refuses wrong owner, replay, arbitrary commands, fields and oversized input',()=>{
 for(const value of [Buffer.from('{}'),Buffer.from('null'),Buffer.from('[]'),Buffer.alloc(2049),wire('kill'),wire('PRIVATE_SHUTDOWN',3),Buffer.from(JSON.stringify({session,sequence:1,command:'PRIVATE_PREPARE_DRAIN',extra:true}))])assert.throws(()=>parseRestoredQaHttpControl(value,session,1));
 assert.throws(()=>parseRestoredQaHttpControl(wire('PRIVATE_PREPARE_DRAIN'),'2'.repeat(64),1));
 assert.throws(()=>parseRestoredQaHttpControl(wire('PRIVATE_PREPARE_DRAIN'),session,2));
});
