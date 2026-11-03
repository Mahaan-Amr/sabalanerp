import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {prepareNativeStageIntent,consumeNativeStageIntent} from './protectedCandidateNativeStageIntent';
import {runProtectedTemporaryDatabase} from './protectedTemporaryDatabase';

test('a durable intent pins one database and prevents a second attempt after an unknown outcome',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-intent-test-'));
 const intent=prepareNativeStageIntent(directory,'123');
 const name=consumeNativeStageIntent(directory,intent.operationId,intent.sha256,'123');
 assert.equal(name,intent.databaseName);
 let called='';
 const outcome=await runProtectedTemporaryDatabase({create:async n=>{called=n;return {state:'UNKNOWN'};},
  identity:async()=>{throw Error('unexpected');},setup:async()=>{throw Error('unexpected');},
  census:async()=>{throw Error('unexpected');},drop:async()=>{throw Error('unexpected');}},undefined,name);
 assert.equal(called,name);assert.equal(outcome.state,'UNKNOWN');
 assert.throws(()=>consumeNativeStageIntent(directory,intent.operationId,intent.sha256,'123'),{code:'EEXIST'});
 assert.throws(()=>prepareNativeStageIntent(directory,'123'),{code:'EEXIST'});
});
test('missing, changed, wrong identity or wrong cluster cannot create an attempt marker',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-intent-test-'));
 assert.throws(()=>consumeNativeStageIntent(directory,'a'.repeat(32),'b'.repeat(64),'123'));
 const intent=prepareNativeStageIntent(directory,'123'),file=path.join(directory,'native-stage-intent.json');
 assert.throws(()=>consumeNativeStageIntent(directory,'a'.repeat(32),intent.sha256,'123'));
 assert.throws(()=>consumeNativeStageIntent(directory,intent.operationId,intent.sha256,'124'));
 fs.appendFileSync(file,' ');
 assert.throws(()=>consumeNativeStageIntent(directory,intent.operationId,intent.sha256,'123'));
 assert.equal(fs.existsSync(path.join(directory,'native-stage-attempt.json')),false);
});
