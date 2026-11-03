import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyMigrationControlEvidence} from './migration-control-state.mjs';

const operation='deploy-test123';
const start=Buffer.from(JSON.stringify({format:'sabalan-migration-control-start/v1',operation,productionAdmission:false}));
const complete=()=>Buffer.from(JSON.stringify({format:'sabalan-migration-control-complete/v1',operation,startSha256:createHash('sha256').update(start).digest('hex'),productionAdmission:false}));
test('unknown in-flight work stays unknown across a fresh reader',()=>{
 assert.equal(classifyMigrationControlEvidence(operation,null,null),'NONE');
 assert.equal(classifyMigrationControlEvidence(operation,start,null),'UNKNOWN');
 assert.equal(classifyMigrationControlEvidence(operation,start,complete()),'COMPLETE');
});
test('partial, mismatched or orphaned evidence cannot authorize recovery',()=>{
 for(const [a,b] of [[null,complete()],[Buffer.from('{'),null],[start,Buffer.from('{}')],[Buffer.from('{}'),complete()]])
  assert.throws(()=>classifyMigrationControlEvidence(operation,a,b));
});
