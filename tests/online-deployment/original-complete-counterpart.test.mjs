import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createOriginalCompleteWindowsCounterpart,retainOriginalCompleteWorker,captureOriginalCompleteBeforeCleanup,readRetainedCompleteWorker} from '../../scripts/lib/original-complete-counterpart.mjs';
import {originalCompleteDirectoryTransport,originalCompleteApplicationExchange,serveOriginalCompleteFileRequest} from '../../scripts/lib/original-complete-file-exchange.mjs';
import {prepareOriginalPrivateEvidenceDirectory} from '../../scripts/lib/original-private-evidence-directory.mjs';
import {completeFixture} from './original-complete-integration.fixture.mjs';
function ports(f,{fail,hold}={}){
 const events=[],inquiry={
  async reader(work){events.push('reader-open');try{return await work();}finally{events.push('reader-closed');}},
  async observeReady(){return {unitOnly:true};},async stop(){events.push('stop');},
  async awaitRetainedClosure(){events.push('await-original');if(hold)await hold;},
  async closedRecords(){events.push('stop-records');const {retirement,...records}=f.inquiry.evidence;return records;},
  async retire(){events.push('retire');},async retirementRecord(){events.push('tombstone');return f.inquiry.evidence.retirement;},
  observationBinding(){return f.inquiry.expected;},
 };
 const frontend={async observe(){events.push('frontend');if(fail!==undefined)throw fail;
  return {original:f.frontend,healthRaw:f.healthRaw,authenticated:true,businessVerified:true,filesVerified:true};}};
 return {inquiry,frontend,events};
}
function workerCommand(f,{nonzero=false}={}){
 const frames=structuredClone(f.frames);Object.assign(frames[0],{businessDataProof:{},inquiryBusinessProof:{},intendedOwner:{releaseId:'unit_release'}});
 const script=`const frames=${JSON.stringify(frames)};const rl=require('node:readline').createInterface({input:process.stdin});let count=0;
 rl.on('line',()=>{if(++count===1)process.stdout.write(JSON.stringify(frames[0])+'\\n');else process.stdout.write(JSON.stringify(frames[1])+'\\n');});
 process.stdin.on('end',()=>{process.stdout.write(JSON.stringify(frames[2])+'\\n');process.exitCode=${nonzero?2:0};});`;
 return {executable:process.execPath,argv:['--max-old-space-size=512','-e',script],environment:process.env};
}
test('one fixed file request closes the real reader borrow before stop and snapshots stop bytes before retirement',async()=>{
 const f=await completeFixture(),p=ports(f),dir=fs.mkdtempSync(path.join(os.tmpdir(),'complete-exchange-'));
 try{
  const counterpart=createOriginalCompleteWindowsCounterpart({identity:f.identity,manifest:f.frames[0].manifest,assertActive:()=>{},...p});
  const transport=originalCompleteDirectoryTransport(dir),server=serveOriginalCompleteFileRequest(transport,v=>counterpart.observe(v),()=>{});
  // Use the same original manifest value serialization as the counterpart.
  const descriptor=(await import('../../scripts/lib/original-complete-callback.mjs')).completeCallbackRequest(f.identity,f.frames[0].manifest);
  const observed=await originalCompleteApplicationExchange(transport)({descriptor,endpoint:{url:'http://private-model'},database:f.identity.database,manifest:f.frames[0].manifest,assertActive:()=>{}});
  await server.closed();counterpart.assertClosed();assert.equal(observed.ack.callbackDrained,true);
  assert.deepEqual(p.events,['reader-open','frontend','reader-closed','stop','await-original','stop-records','retire','tombstone']);
  await assert.rejects(counterpart.observe({descriptor}),/ALREADY_CONSUMED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('falsy failure owes original Inquiry closure and cannot emit positive ACK while its retained child is open',async()=>{
 const f=await completeFixture();let release;const held=new Promise(resolve=>release=resolve),p=ports(f,{fail:null,hold:held});
 const counterpart=createOriginalCompleteWindowsCounterpart({identity:f.identity,manifest:f.proof.checkpointMetadata.manifest,assertActive:()=>{},...p});
 let settled=false;
 const work=counterpart.observe({descriptor:f.descriptor,database:f.identity.database,manifest:f.proof.checkpointMetadata.manifest,assertActive:()=>{}}).finally(()=>settled=true);
 work.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.throws(()=>counterpart.assertClosed());
 release();await assert.rejects(work,e=>e===null);assert.ok(!p.events.includes('retire'));
});
test('same original worker earns capture only after zero exit/both EOF and closed counterpart; JSON cannot stand in',async()=>{
 const f=await completeFixture(),p=ports(f),parent=fs.mkdtempSync(path.join(os.tmpdir(),'complete-capture-')),dir=path.join(parent,'private');
 if(process.platform==='win32'){
  const script="$ErrorActionPreference='Stop';$p=$env:COMPLETE_TEST_PARENT;$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$a=Get-Acl -LiteralPath $p;$a.SetAccessRuleProtection($true,$false);foreach($r in @($a.Access)){$null=$a.RemoveAccessRuleSpecific($r)};$r=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$a.AddAccessRule($r);[System.IO.Directory]::SetAccessControl($p,$a)";
  const acl=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath')),COMPLETE_TEST_PARENT:parent},windowsHide:true,encoding:'utf8'});
  assert.equal(acl.status,0,acl.stderr);
 }
 const custody=await prepareOriginalPrivateEvidenceDirectory(dir);
 try{
  const counterpart=createOriginalCompleteWindowsCounterpart({identity:f.identity,manifest:f.proof.checkpointMetadata.manifest,assertActive:()=>{},...p});
  await counterpart.observe({descriptor:f.descriptor,database:f.identity.database,manifest:f.proof.checkpointMetadata.manifest,assertActive:()=>{}});
  const worker=await retainOriginalCompleteWorker({command:workerCommand(f),session:f.identity.session,initial:Buffer.from('{}'),onRequest:async()=>Buffer.from('unit-public-certificate')});
  const row=readRetainedCompleteWorker(worker);assert.equal(row.row.code,0);assert.equal(row.row.stdoutEof&&row.row.stderrEof,true);
  const options={counterpart,workerCompletion:worker,applicationRaw:f.appRaw,applicationFile:f.capture.applicationFile,seed:f.seed,
    evidenceDirectory:dir,evidenceCustody:custody,workerSourceSha256:'8'.repeat(64),controllerSourceSha256:'9'.repeat(64)};
  assert.throws(()=>captureOriginalCompleteBeforeCleanup({...options,workerCompletion:structuredClone(worker)}),/WORKER_REQUIRED/);
  const capture=captureOriginalCompleteBeforeCleanup(options),value=JSON.parse(fs.readFileSync(capture.file,'utf8'));
  assert.equal(value.workerClosedBeforeCapture,true);assert.equal(value.cleanupStarted,false);assert.equal(value.probe.originals[1].evidence.requestedStop.sha256,f.inquiry.evidence.requestedStop.sha256);
  assert.equal(JSON.parse(Buffer.from(value.workerOriginal.rawBase64,'base64')).originalPid,row.row.originalPid);
  await assert.rejects(retainOriginalCompleteWorker({command:workerCommand(f,{nonzero:true}),session:f.identity.session,initial:Buffer.from('{}'),onRequest:async()=>Buffer.from('unit-public-certificate')}));
 }finally{assert.equal(fs.realpathSync(parent),path.resolve(parent));assert.ok(path.basename(parent).startsWith('complete-capture-'));fs.rmSync(parent,{recursive:true,force:true});}
});
