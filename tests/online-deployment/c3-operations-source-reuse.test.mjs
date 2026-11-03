import assert from 'node:assert/strict';import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {validateC3OperationsReuseFacts,inspectFrozenC3OperationsFiles,mandatoryC3OperationsPaths} from '../../scripts/lib/c3-operations-source-reuse.mjs';
test('C3 operations provenance never relabels its image or admits changed application inputs',()=>{
 const facts={applicationSourceCommit:'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14',operationsSourceCommit:'a'.repeat(40),image:'sha256:380b765fc645cf2597c2fdd537cd67f74692344f2e3c489078ec459be3baa6f9',imageReceiptSha256:'11895978ca8177d655181c8b3fbcd4dc56d593eaccb715f3cb597256e2f27c19',materialReceiptSha256:'6c440e63f97fdef1884f530da43be181aecafb5d03795e66e9691fee993e418b',compiledReceiptSha256:'c60c88e3a93e952f030115daf7a1ede32a423b49a0a8ed4207b53b78dfb16c90',allCompiledSourcesUnchanged:true,allMaterialSourcesUnchanged:true,changedPaths:['scripts/lib/frozen-native-history.mjs']};
 assert.equal(validateC3OperationsReuseFacts(facts).applicationSourceCommit,facts.applicationSourceCommit);
 validateC3OperationsReuseFacts({...facts,changedPaths:['docs/operations/zero-data-loss-deployment.md']});
 for(const file of ['docs/operations/online-deployment.md','reports/qa/issue-419-c3-bindings-20261026/held-f282-recovery-source-20261101/recovery-control.py','reports/qa/issue-419-c3-bindings-20261026/held-f282-recovery-source-20261101/EXACT-SOURCE-BYTES.json'])validateC3OperationsReuseFacts({...facts,changedPaths:[file]});
 for(const file of ['reports/qa/issue-419-c3-bindings-20261026/held-f282-recovery-source-20261101/unreviewed.py','reports/qa/issue-419-c3-bindings-20261026/other-recovery/recovery-control.py'])assert.throws(()=>validateC3OperationsReuseFacts({...facts,changedPaths:[file]}),/C3_UNREVIEWED_OPERATIONS_PATH/);
 for(const file of ['original-complete-dispatch.test.mjs','original-master-bootstrap-retain.test.mjs','original-master-client-finish.test.mjs','original-master-failure-diagnostic.test.mjs','original-master-prisma-receipt.test.mjs','same-compose-physical-dispatch.test.mjs']){
  const selected='tests/online-deployment/'+file;
  validateC3OperationsReuseFacts({...facts,changedPaths:[selected]});
  assert.ok(mandatoryC3OperationsPaths.includes(selected));
 }
 assert.throws(()=>validateC3OperationsReuseFacts({...facts,changedPaths:['tests/online-deployment/original-master-unreviewed.test.mjs']}),/C3_UNREVIEWED_OPERATIONS_PATH/);
 assert.throws(()=>validateC3OperationsReuseFacts({...facts,changedPaths:['docs/operations/unreviewed-runtime-policy.md']}),/C3_UNREVIEWED_OPERATIONS_PATH/);
 for(const mutant of [{...facts,allCompiledSourcesUnchanged:false},{...facts,allMaterialSourcesUnchanged:false},{...facts,image:'sha256:'+'b'.repeat(64)},{...facts,changedPaths:['backend/src/application.ts']},{...facts,changedPaths:['scripts/other-executable.mjs']},{...facts,compiledReceiptSha256:'0'.repeat(64)}])assert.throws(()=>validateC3OperationsReuseFacts(mutant));
});
test('real Git freeze rejects untracked mandatory modules and later source or HEAD changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-c3-freeze-'));
 const files=mandatoryC3OperationsPaths;
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=()=>git('-c','user.name=Isolated provenance test','-c','user.email=provenance@example.invalid','-c','core.autocrlf=false','commit','-m','Isolated fixture');
 try{
  git('init');fs.writeFileSync(path.join(root,'README'),'fixture\n');git('add','README');commit();
  for(const relative of files){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'frozen fixture\n');}
  assert.throws(()=>inspectFrozenC3OperationsFiles(root,git('rev-parse','HEAD'),files));
  git('-c','core.autocrlf=false','add','--',...files);commit();const head=git('rev-parse','HEAD');const manifest=inspectFrozenC3OperationsFiles(root,head,files);assert.equal(manifest.length,files.length);
  // Git's clean index alone cannot admit changed native working bytes.
  git('update-index','--assume-unchanged','--',files[0]);fs.writeFileSync(path.join(root,files[0]),Buffer.from([0,255,13,10]));assert.equal(git('diff','--name-only'),'');
  assert.throws(()=>inspectFrozenC3OperationsFiles(root,head,files),/C3_OPERATIONS_WORKING_BYTES_NOT_COMMITTED/);
  fs.writeFileSync(path.join(root,files[0]),'frozen fixture\n');git('update-index','--no-assume-unchanged','--',files[0]);
  fs.appendFileSync(path.join(root,files[0]),'changed\n');assert.throws(()=>inspectFrozenC3OperationsFiles(root,head,files),/C3_OPERATIONS_SOURCE_NOT_FROZEN/);
  git('-c','core.autocrlf=false','add','--',files[0]);commit();assert.throws(()=>inspectFrozenC3OperationsFiles(root,head,files),/C3_OPERATIONS_HEAD_CHANGED/);
 }finally{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('sabalan-c3-freeze-'));fs.rmSync(root,{recursive:true});}
});

test('selected pressure graph freezes exact observer/policy and changed historical-schema adapter sources',()=>{
 for(const file of ['scripts/lib/application-native-qa-memory.mjs','tests/online-deployment/application-native-qa-memory-recovery.test.mjs','scripts/lib/local-qa-memory-pressure.mjs','scripts/lib/local-qa-pressure-policy.json','deploy/scripts/local-qa-pressure.py'])assert.ok(mandatoryC3OperationsPaths.includes(file));
});
