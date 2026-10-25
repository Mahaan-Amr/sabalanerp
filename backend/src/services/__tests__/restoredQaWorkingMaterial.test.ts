import test from 'node:test';
import assert from 'node:assert/strict';
import {restoredQaMaterialPath,assertRestoredQaWorkingMaterial,withRestoredQaWorkingMaterial} from '../restoredQaWorkingMaterial';
test('finite component mapping uses canonical private app paths without aliases',()=>{
 assert.equal(restoredQaMaterialPath('files/contracts/private.pdf'),'storage/contracts/private.pdf');
 assert.equal(restoredQaMaterialPath('files/uploads/image.png'),'uploads/image.png');
 assert.equal(restoredQaMaterialPath('inquiry/inquiry.db'),'recovery-sources/inquiry/inquiry.db');
 assert.equal(restoredQaMaterialPath('recovery-coordination/state.json'),'recovery-coordination/state.json');
 for(const value of ['database/main.dump','files/contracts/../private','/files/contracts/private','files/contracts//private','files/contracts/private\\file','foreign/file','files/contracts','recovery-coordination/deployment-runtime-control.lock','recovery-coordination/session.json','recovery-coordination/online/native/active.json'])assert.throws(()=>restoredQaMaterialPath(value));
});
test('receipt, copied path and plain callback JSON have no working-copy authority',async()=>{
 const owner={deploymentId:'qa_operation',releaseId:'qa_release'};
 for(const value of [{}, {root:'/app/private',cleanupPending:true}, {database:{name:'qa',oid:'123'}}]){
  assert.throws(()=>assertRestoredQaWorkingMaterial(value as never,owner));
  let reached=false;await assert.rejects(withRestoredQaWorkingMaterial(value,owner,async()=>{reached=true;}),/RECOVERY_STRICT_PROOF_NOT_ACTIVE/);assert.equal(reached,false);
 }
});
