import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import Module from 'node:module';
import {PassThrough} from 'node:stream';
import {originalCompleteWorkerInput} from '../../scripts/lib/original-complete-controller.mjs';
import {renderOriginalCompleteOwner,renderOriginalCompleteWorker,renderOriginalCompleteController} from '../../scripts/lib/original-complete-source-renderer.mjs';
const input=name=>fs.readFileSync(new URL('./fixtures/complete-source/'+name+'.txt',import.meta.url),'utf8');
test('exact reviewed original owner gains capture guard before original cleanup and retains all original retirement validators',()=>{
 const source=renderOriginalCompleteOwner(input('owner'));
 assert.ok(source.indexOf("complete_capture=value['completeCapture']")<source.indexOf("local_command=helpers['terminal_cleanup'].local_command"));
 const result=spawnSync('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',"import ast,sys;ast.parse(sys.stdin.read())"],{input:source,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 for(const text of ['validate_local_retired','validate_backup_retired','retire_windows_inputs','read_master_private_credential'])assert.ok(source.includes(text));
 assert.throws(()=>renderOriginalCompleteOwner(input('owner')+'\n'),/REVIEWED_OWNER/);
});
test('worker/controller renderers connect canonical callback and capture controller while preserving all three HR frames and original issuer',()=>{
 const worker=renderOriginalCompleteWorker(input('worker')),controller=renderOriginalCompleteController(input('controller'));
 for(const frame of ['HR_REQUEST','CALLBACK_DRAINED','RESTORE_RESULT'])assert.ok(worker.includes(frame));
 assert.ok(worker.includes('qualifyOriginalCompleteCallback'));assert.ok(worker.includes('sourceOwned:{...qaWork.sourceOwned,hrSession:channel.originalSession()}'));
 assert.ok(controller.includes('runOriginalCompleteController'));assert.ok(controller.includes('issueOriginalRestoredQaHrCertificate(token)'));
 assert.throws(()=>renderOriginalCompleteWorker(input('worker')+'\n'),/REVIEWED_WORKER/);
});
test('controller input reaches the actual rendered worker initial reader with the same newly created HR session',async()=>{
 const worker=renderOriginalCompleteWorker(input('worker'));
 const file=new URL('./fixtures/complete-source/worker.cjs',import.meta.url).pathname,m=new Module(file);m.filename=file;
 m._compile(worker,file);
 const applicationKeys={PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64:Buffer.alloc(32,1).toString('base64'),PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID:'unit-one',
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64:Buffer.alloc(32,2).toString('base64'),PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID:'unit-two'};
 const initial=Buffer.from(JSON.stringify({applicationKeys,passphrase:'unit-only-transfer-value-'+'x'.repeat(32)})),session='a'.repeat(64);
 const wire=originalCompleteWorkerInput(initial,session),inputPipe=new PassThrough(),outputPipe=new PassThrough();
 const channel=m.exports.createInteractiveChannel(inputPipe,outputPipe);inputPipe.end(Buffer.concat([wire,Buffer.from('\n')]));
 const decoded=await channel.readInitial();assert.deepEqual(decoded.applicationKeys,applicationKeys);assert.equal(channel.originalSession(),session);
 assert.throws(()=>originalCompleteWorkerInput(Buffer.from(JSON.stringify({...JSON.parse(initial),hrSession:session})),session));wire.fill(0);initial.fill(0);
});
