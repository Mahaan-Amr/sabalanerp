/** Actual factory + finite collector/process. Root/remote ports modeled only. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {randomBytes,createHash} from 'node:crypto';
import {completePlanReader,writeCompletePlanFile} from '../../scripts/lib/original-complete-plan-files.mjs';
import {collectOriginalCompleteOwner,readOriginalReadOnlyStorageOwner,readOriginalReadOnlyStorageCallbackRefusal,assertOriginalReadOnlyStorageReadyOwner} from '../../scripts/lib/original-existing-compose-owner.mjs';
import {originalBackendBaseCommands} from '../../scripts/lib/production-backend-base-process.mjs';
import {readOriginalDeploymentImageContent} from '../../scripts/lib/original-deployment-image-content.mjs';
import {Worker} from 'node:worker_threads';
import {retainLocalQaPressureSampler} from '../../scripts/lib/local-qa-pressure-sampler.mjs';
const root=path.resolve('.'),python={file:path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'),sha256:'7ca24f26d6e3f463419ee4f537ddd3acd312c38fe45e678cce08572f26a8bd1a'},source=fs.readFileSync(path.join(root,'scripts/lib/original-readonly-storage-preflight.mjs'),'utf8');
const code=source.slice(source.indexOf('const files='),source.indexOf('export function readOriginalReadOnlyStorageRefusal'))+source.slice(source.indexOf('export function readOriginalReadOnlyStorageRefusal')).replaceAll('export function','function').replaceAll('export async function','async function');
const pin=file=>({file:path.resolve(file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
for(const mode of ['success','closed-negative','unknown','missing-recovery'])test('actual packaged factory/collector '+mode+' keeps custody separate from modeled host results',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-readonly-factory-')),traces=[],negative=new WeakMap();let held=false,closed;
 const owner={operation:'a'.repeat(32),assertHeld(){},assertPreparingCurrent(){},assertMemoryWorkAdmission(){},prepareReadOnlyStorageAdmission:async()=>{},inspect:()=>({unknown:false}),acquirePrivatePreflightCredential:async()=> 'finite-fixture-private',persistReadOnlyStorageClosure:async(_operation,row)=>{closed=row;},retainUnclassifiedFailure:async()=>{held=true;throw Error('FIXTURE_HELD_NO_RELEASE');},readReadOnlyStorageOwnerContext:async()=>({rootPid:process.pid,leaseProviderPid:123,rootOperation:'a'.repeat(32),leaseFile:path.join(directory,'fixture.lock'),sources:Object.fromEntries([...source.matchAll(/(?:deploy\/scripts|scripts)\/[a-zA-Z0-9/-]+\.(?:py|mjs)/g)].map(match=>[match[0],pin(path.join(root,match[0]))]))})};
 // Consume the actual Root context producer too: a factory-only mock previously
 // concealed a missing dependency in the real Root's packaged source list.
 const rootSource=fs.readFileSync(path.join(root,'scripts/lib/original-candidate-rollback-owner.mjs'),'utf8'),start=rootSource.indexOf('  async readReadOnlyStorageOwnerContext('),end=rootSource.indexOf('\n  async assertImageRepositoryCapacity',start),method=rootSource.slice(start,end).trim().replace(/,$/,'');
 const paths=[...new Set([...source.matchAll(/(?:deploy\/scripts|scripts)\/[a-zA-Z0-9/-]+\.(?:py|mjs)/g),...method.matchAll(/(?:deploy\/scripts|scripts)\/[a-zA-Z0-9/-]+\.(?:py|mjs)/g)].map(match=>match[0]))];
 const rootContext={assert,owner,source:{operationsFiles:paths.map(relative=>({path:relative,sha256:pin(path.join(root,relative)).sha256}))},pin,path,root,process,lease:{originalPid:123},leaseFile:path.join(directory,'fixture.lock'),operation:owner.operation};
 owner.readReadOnlyStorageOwnerContext=vm.compileFunction('return({'+method+'}).readReadOnlyStorageOwnerContext;',Object.keys(rootContext))(...Object.values(rootContext));
 const commands=()=>{const actual=originalBackendBaseCommands();return{...actual,async run(_exe,_args,options){traces.push('same-query-original');const facts={format:'sabalan-image-owner-parent-facts/v1',signalsSent:0,leaseAcquired:false,nativeActionsExecuted:false,parent:{root:{pid:process.pid},lease:{pid:123},lockFile:path.join(directory,'fixture.lock')}};return actual.run(process.execPath,['-e','console.log('+JSON.stringify(JSON.stringify(facts))+')'],options);}};};
 const context={assert,path,fs,randomBytes,process,Q:directory,python,negatives:negative,completePlanReader,writeCompletePlanFile,
  assertOriginalCandidateRollbackOwner:value=>assert.equal(value,owner),readOriginalDeploymentImageContent,
  readOriginalCompleteRetirementFor:()=>assert.fail('NO_FULL_FIXTURE'),readOriginalPrivatePreflightRefusal:()=>assert.fail('NO_PRIVATE_REFUSAL_FIXTURE'),
  prepareOriginalPrivateEvidenceDirectory:async dir=>{fs.mkdirSync(dir);return dir;},assertOriginalPrivateEvidenceDirectory:(token,dir)=>assert.equal(token,dir),originalBackendBaseCommands:commands,
  readOriginalReadOnlyStorageOwner,readOriginalReadOnlyStorageCallbackRefusal,assertOriginalReadOnlyStorageReadyOwner,
  collectOriginalCompleteOwner:options=>collectOriginalCompleteOwner({...options,command:{executable:python.file,argv:['-I','-B',path.join(root,'tests/online-deployment/fixtures/readonly-storage-owner.fixture.py'),...options.command.argv.slice(-2),mode]}}),
 };
 const api=vm.compileFunction(code+';return{run:collectOriginalReadOnlyStoragePreflight,read:readOriginalReadOnlyStorageRefusal};',Object.keys(context))(...Object.values(context));
 const runtime=pin('deploy/scripts/original-complete-production-admission-v2.py');
 try{
  if(mode==='success'){const value=await api.run(owner,{runtime,admission:runtime,beforeLocal:true});assert.equal(value.report.sshExitCode,0);assert.equal(JSON.parse(value.report.stdout).deletionApplied,false);assert.equal(held,false);}
  else{let failure;try{await api.run(owner,{runtime,admission:runtime,beforeLocal:true});}catch(error){failure=error;}assert.ok(failure);if(['unknown','missing-recovery'].includes(mode)){assert.equal(held,true);assert.throws(()=>api.read(failure,owner));}else{assert.equal(held,false);assert.equal(api.read(failure,owner).preflightSucceeded,false);assert.throws(()=>api.read({...failure},owner));}}
  assert.equal(closed.code,0);assert.ok(closed.stdoutEof&&closed.stderrEof);assert.equal(traces.length,1);
 }finally{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));fs.rmSync(directory,{recursive:true});}
});

for(const mode of ['healthy','disk-low'])test('fresh Root/factory startup samples its SAME real worker before admission: '+mode,async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-root-preflight-start-')),stamp=fs.lstatSync(directory,{bigint:true}),trace=[];
 const data={directory,directoryStamp:['dev','ino','uid','mode'].map(key=>String(stamp[key])),flags:new SharedArrayBuffer(8),nonce:randomBytes(16).toString('hex'),mode:'healthy'};
 const pressure=retainLocalQaPressureSampler({data,createWorker:()=>new Worker(new URL('./fixtures/local-qa-pressure-sampler-worker.mjs',import.meta.url),{workerData:data}),onUnknown:()=>assert.fail('UNKNOWN_FIXTURE_WORKER')});
 const rootSource=fs.readFileSync(path.join(root,'scripts/lib/original-candidate-rollback-owner.mjs'),'utf8'),a=rootSource.indexOf(' async function capacity('),b=rootSource.indexOf('\n',a),capacitySource=rootSource.slice(a,b),admissionSource=rootSource.split('\n').find(line=>line.includes('async prepareReadOnlyStorageAdmission('));
 const owner={operation:'a'.repeat(32),assertPreparingCurrent(){trace.push('preparing');},inspect:()=>({unknown:false}),readReadOnlyStorageOwnerContext:async()=>{trace.push('post-admission');throw Error('STOP_BEFORE_REMOTE_FIXTURE');}};
 const context={assert,path,process,owner,pressure,serial:0,recovering:false,preparationOnly:false,save:()=>{},fs:{readFileSync:()=>JSON.stringify({CustomWslDistroDir:'E:/DockerData'}),realpathSync:file=>path.resolve(file),statfsSync:()=>({bavail:mode==='disk-low'?0n:100n*1024n**3n,bsize:1n})}};
 owner.prepareReadOnlyStorageAdmission=vm.compileFunction('let lastCapacity;'+capacitySource+';return({'+admissionSource+'}).prepareReadOnlyStorageAdmission;',Object.keys(context))(...Object.values(context));
 const factory=vm.compileFunction('return('+source.slice(source.indexOf('export async function collectOriginalReadOnlyStoragePreflight')).replace(/^export /,'')+');',['assert','randomBytes','completePlanReader','negatives','assertOriginalCandidateRollbackOwner','readOriginalDeploymentImageContent'])(assert,randomBytes,completePlanReader,new WeakMap(),value=>assert.equal(value,owner),()=>({content:{images:{backend:{gzip:{bytes:1}},frontend:{cipher:{bytes:1}},inquiry:{cipher:{bytes:1}}}}}));
 try{
  assert.throws(()=>pressure.assertAdmission(),/OBSERVATION_REQUIRED/);
  await assert.rejects(factory(owner,{runtime:{},admission:{},beforeLocal:true}),mode==='healthy'?/STOP_BEFORE_REMOTE_FIXTURE/:/ROLLBACK_BACKING_CAPACITY_FLOOR_REFUSED/);
  assert.ok(pressure.inspect().samples>=1);assert.equal(trace.includes('post-admission'),mode==='healthy');
  await pressure.close();const rows=fs.readdirSync(directory).filter(file=>file.includes('-child-')).map(file=>JSON.parse(fs.readFileSync(path.join(directory,file))));assert.ok(rows.length>=1);assert.ok(rows.every(row=>row.code===0&&row.stdoutEof&&row.stderrEof));
 }finally{if(!pressure.inspect().closed)await pressure.close();fs.rmSync(directory,{recursive:true});}
});
