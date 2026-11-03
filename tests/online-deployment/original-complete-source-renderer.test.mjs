import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import Module from 'node:module';
import {PassThrough} from 'node:stream';
import {originalCompleteWorkerInput} from '../../scripts/lib/original-complete-controller.mjs';
import {renderOriginalCompleteOwner,renderOriginalCompleteOwnerWithRetainedIssuer,renderOriginalCompleteUnboundOwner,renderOriginalCompleteWorker,renderOriginalCompleteController} from '../../scripts/lib/original-complete-source-renderer.mjs';
const input=name=>fs.readFileSync(new URL('./fixtures/complete-source/'+name+'.txt',import.meta.url),'utf8');
test('packaged owner material contains no historical runtime binding and refuses before credentials',()=>{
 const source=renderOriginalCompleteUnboundOwner(input('owner'));assert.equal((source.match(/^BOUND_SOURCE_INPUTS=None$/gm)||[]).length,1);assert.doesNotMatch(source,/^BOUND_SOURCE_INPUTS=\{/m);
 const program="import ast,sys;source=sys.stdin.read();tree=ast.parse(source);binding=next(n for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='BOUND_SOURCE_INPUTS'for t in n.targets));assert ast.literal_eval(binding.value)is None;ns={'__name__':'unbound_source_only'};exec(compile(tree,'unbound_owner','exec'),ns)\ntry:ns['validate_bound_inputs'](None)\nexcept AssertionError as e:assert str(e)=='UNRESOLVED_GENUINE_CAPTURE_AND_RUNTIME_BINDING';print('UNBOUND_REFUSED_BEFORE_PRIVATE_INPUT')\nelse:raise AssertionError('UNBOUND_ACCEPTED')";
 const result=spawnSync('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',program],{input:source,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'UNBOUND_REFUSED_BEFORE_PRIVATE_INPUT');
});
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
test('retained-issuer successor accepts only its v2 private frame and cannot reuse its transport secret',()=>{
 const source=renderOriginalCompleteOwnerWithRetainedIssuer(input('owner')),operation='a'.repeat(32),credential='unit-private-input',transportPassphrase='Z'.repeat(64);
 const code=String.raw`import ast,json,sys,io
p=json.load(sys.stdin);tree=ast.parse(p['source']);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='read_master_private_credential')
s={'sys':sys,'json':json,'_MASTER_TRANSPORT_PASSPHRASE':None};exec(compile(ast.Module(body=[fn],type_ignores=[]),'original-reader','exec'),s)
sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(p['frame']).encode()+b'\n'))
try:
 value=s['read_master_private_credential'](p['operation']);assert value=='unit-private-input';assert s['_MASTER_TRANSPORT_PASSPHRASE']=='Z'*64
 reused=False
 try:s['read_master_private_credential'](p['operation'])
 except AssertionError:reused=True
 print(json.dumps({'accepted':True,'reuseRefused':reused}))
except AssertionError:print(json.dumps({'accepted':False}))
`;
 for(const [frame,accepted]of [[{format:'sabalan-r9-master-private-credential/v2',operation,credential,transportPassphrase},true],[{format:'sabalan-r9-master-private-credential/v1',operation,credential},false],[{format:'sabalan-r9-master-private-credential/v2',operation,credential,transportPassphrase:'short'},false],[{format:'sabalan-r9-master-private-credential/v2',operation,credential,transportPassphrase,command:'override'},false]]){
  const result=spawnSync('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',code],{input:JSON.stringify({source,frame,operation}),encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes(credential)&&!result.stdout.includes(transportPassphrase));const row=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));assert.equal(row.accepted,accepted);if(accepted)assert.equal(row.reuseRefused,true);
 }
 assert.ok(source.includes("assert args.master_private_credential_stdin=='yes'"));
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
