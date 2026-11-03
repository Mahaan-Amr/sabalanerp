import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {retainLocalQaPressureSampler,createOriginalLocalQaPressureSampler} from '../../scripts/lib/local-qa-pressure-sampler.mjs';
import {prepareOriginalPrivateEvidenceDirectory} from '../../scripts/lib/original-private-evidence-directory.mjs';
import {acquireSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
const block=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function fixture(mode='healthy',options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pressure-sampler-')),s=fs.lstatSync(directory,{bigint:true});
 const data={directory,directoryStamp:['dev','ino','uid','mode'].map(k=>String(s[k])),flags:new SharedArrayBuffer(8),nonce:randomBytes(16).toString('hex'),mode};
 const createWorker=()=>new Worker(new URL('./fixtures/local-qa-pressure-sampler-worker.mjs',import.meta.url),{workerData:data});let unknown=false,recovered=false;
 const owner=retainLocalQaPressureSampler({createWorker,data,onUnknown:()=>{unknown=true;},recovery:()=>({enterRecovery(){assert.equal(owner.inspect().closed,true);recovered=true;}}),...options});
 return{owner,directory,data,unknown:()=>unknown,recovered:()=>recovered,remove(){assert.ok(owner.inspect().closed);fs.rmSync(directory,{recursive:true});}};
}
test('actual Worker drain retains the allowlisted pressure reason and original assertion code',async()=>{
 const f=fixture('transient');try{
  await assert.rejects(f.owner.run('low-memory-transport',async()=>new Promise(resolve=>setTimeout(resolve,3000))),/QA_MEMORY_PRESSURE_REFUSED/);
  assert.equal(f.owner.inspect().fault,'QA_MEMORY_PRESSURE_REFUSED');
  await f.owner.enterRecovery();const result=await f.owner.close();
  assert.equal(result.closure.state.fault,'QA_MEMORY_PRESSURE_REFUSED');assert.equal(result.closure.state.faultCode,'ERR_ASSERTION');
  assert.equal(result.closure.allOriginalChildrenClosed,true);assert.equal(result.closure.unknownOriginalCustody,false);
  assert.equal(f.unknown(),false);assert.equal(f.recovered(),true);
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('retained sampler durably observes through a real20.5second blocked main event loop',async()=>{
 const f=fixture();try{
  await f.owner.run('blocked',async()=>{block(20500);const logs=fs.readdirSync(f.directory).filter(n=>n.includes('-sample-'));assert.ok(logs.length>=9,'worker must persist while Root cannot receive messages');});
  const logs=fs.readdirSync(f.directory).filter(n=>n.includes('-sample-')).map(n=>JSON.parse(fs.readFileSync(path.join(f.directory,n)))).sort((a,b)=>a.sequence-b.sequence);
  for(let i=1;i<logs.length;i++)assert.ok(Date.parse(logs[i].observation.observedAt)-Date.parse(logs[i-1].observation.observedAt)<=4500);
  f.owner.assertAdmission();await f.owner.close();assert.equal(f.unknown(),false);
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
for(const mode of ['transient','oom'])test(mode+' during blocked Root latches before its next actor or mutation',async()=>{
 const f=fixture(mode);try{
  await assert.rejects(f.owner.run('blocked-fault',async()=>{block(7000);assert.throws(()=>f.owner.assertAdmission());}));
  assert.throws(()=>f.owner.assertAdmission());await f.owner.enterRecovery();assert.equal(f.recovered(),true);assert.equal(f.unknown(),false);
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('late sampler probe refuses without changing gap or duration limits',async()=>{
 const f=fixture('delay');try{await assert.rejects(f.owner.run('late',async()=>new Promise(r=>setTimeout(r,6500))));await f.owner.enterRecovery();assert.equal(f.recovered(),true);assert.equal(f.unknown(),false);}
 finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('END drains a real pending child and both readers before recovery and worker closure',async()=>{
 const f=fixture('reader');try{
  await assert.rejects(f.owner.run('pending-reader',async()=>new Promise(r=>setTimeout(r,2300))));
  await f.owner.enterRecovery();const children=fs.readdirSync(f.directory).filter(n=>n.includes('-child-')).map(n=>JSON.parse(fs.readFileSync(path.join(f.directory,n))));
  assert.ok(children.length>=2);assert.ok(children.every(c=>c.code===0&&c.signal===null&&c.stdoutEof&&c.stderrEof));assert.equal(f.recovered(),true);assert.equal(f.unknown(),false);
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('unexpected worker loss stays unknown and cannot close or permit recovery',async()=>{
 const f=fixture('loss');try{await assert.rejects(f.owner.run('loss',async()=>new Promise(r=>setTimeout(r,2500))));assert.equal(f.unknown(),true);await assert.rejects(f.owner.enterRecovery());assert.equal(f.recovered(),false);}
 finally{assert.equal(f.owner.inspect().closed,true);f.remove();}
});
test('terminal sample bound stops probes/files while the original work remains pending',async()=>{
 const f=fixture('bound');try{
  await assert.rejects(f.owner.run('bound',async()=>{await new Promise(r=>setTimeout(r,4600));const count=fs.readdirSync(f.directory).length;await new Promise(r=>setTimeout(r,2400));assert.equal(fs.readdirSync(f.directory).length,count);assert.equal(count,4);assert.throws(()=>f.owner.assertAdmission());}));
  await f.owner.enterRecovery();assert.equal(fs.readdirSync(f.directory).length,5);assert.equal(f.unknown(),false);
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('synchronous worker constructor failure returns an owned no-worker closure port',async()=>{
 const f=fixture('healthy',{createWorker(){throw Object.assign(new Error('worker initialization refused'),{code:'ERR_WORKER_INIT_FAILED'});}});
 await assert.rejects(f.owner.sample('constructor-failed'));const closure=await f.owner.close();assert.equal(closure.closure.workerCreated,false);assert.equal(f.unknown(),false);f.remove();
});
test('post-constructor setup fault retains the same real worker and naturally drains its child',async()=>{
 const f=fixture('healthy',{afterSetup(){throw new Error('SETUP_EIO');}});try{
  await assert.rejects(f.owner.sample('setup-failed'));await f.owner.close();assert.equal(f.unknown(),false);
  const rows=fs.readdirSync(f.directory).filter(n=>n.includes('-child-')).map(n=>JSON.parse(fs.readFileSync(path.join(f.directory,n))));assert.ok(rows.length>=1);assert.ok(rows.every(r=>r.code===0&&r.stdoutEof&&r.stderrEof));
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
test('asynchronous startup/import failure preserves unknown custody on the same returned owner',async()=>{
 const f=fixture('healthy',{createWorker:()=>new Worker(new URL('./fixtures/absent-pressure-worker.mjs',import.meta.url))});
 await assert.rejects(f.owner.sample('import-failed'));assert.equal(f.unknown(),true);await assert.rejects(f.owner.close());while(!f.owner.inspect().closed)await new Promise(r=>setTimeout(r,5));assert.equal(f.owner.inspect().closed,true);f.remove();
});
test('actual fixed Windows Python and existing Compose observer survive blocked Root and naturally close',
 {skip:process.env.SABALAN_PRESSURE_SAMPLER_ACTUAL_READONLY!=='1'?'explicit read-only existing-project opt-in':false},async()=>{
 assert.equal(process.platform,'win32');const directory=path.resolve('D:/sabalanerp-online-qa/pressure-sampler-readonly-'+randomBytes(16).toString('hex'));
 const lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');let owner,unknown=false,keeper;
 try{
  const custody=await prepareOriginalPrivateEvidenceDirectory(directory);
  owner=createOriginalLocalQaPressureSampler({directory,custody,persist(){throw Error('NO_RECOVERY_NEEDED');},onUnknown:()=>{unknown=true;}});
  await owner.run('actual-readonly-blocked',async()=>{block(20500);assert.ok(fs.readdirSync(directory).filter(n=>n.includes('-sample-')).length>=8);});
  const closure=await owner.close();assert.equal(unknown,false);assert.equal(closure.closure.allOriginalChildrenClosed,true);assert.equal(closure.closure.unknownOriginalCustody,false);
  fs.writeFileSync(path.join(directory,'qualification.json'),JSON.stringify({format:'sabalan-local-qa-sampler-readonly-qualification/v1',closure,realPythonObserver:true,existingComposeOnly:true,mainBlockedMs:20500,upStarted:false,masterStarted:false,qualificationAccepted:false,productionAdmission:false})+'\n');
  console.log(JSON.stringify({actualSamplerEvidenceDirectory:directory,upStarted:false,qualificationAccepted:false}));
 }finally{
  if(owner&&!owner.inspect().closed){try{await owner.close();}catch{unknown=true;}}
  if(unknown){keeper=setInterval(()=>{},1000);void keeper;assert.fail('UNKNOWN_SAMPLER_CUSTODY_SAME_LEASE_RETAINED');}
  await lease.release();
 }
});

test('real retained worker preserves continuous rejected frames, primary refusal and natural recovery drain',async()=>{
 const f=fixture('sustained');let capacityFailure;try{
  await assert.rejects(f.owner.run('sustained',async()=>{await new Promise(resolve=>setTimeout(resolve,9000));try{await f.owner.sample('retained-capacity');}catch(error){capacityFailure=error;}}),/QA_MEMORY_PRESSURE_REFUSED/);assert.match(capacityFailure?.message??'',/QA_MEMORY_PRESSURE_REFUSED/);
  assert.equal(f.unknown(),false);assert.match(f.owner.inspect().fault,/QA_MEMORY_PRESSURE_REFUSED/);assert.throws(()=>f.owner.assertAdmission(),/QA_MEMORY_PRESSURE_REFUSED/);
  const rows=fs.readdirSync(f.directory).filter(n=>n.includes('-sample-')).map(n=>JSON.parse(fs.readFileSync(path.join(f.directory,n)))).sort((a,b)=>a.sequence-b.sequence);assert.ok(rows.filter(r=>r.observation.lowMemory).length>=3);for(let i=1;i<rows.length;i++)assert.ok(Date.parse(rows[i].observation.observedAt)-Date.parse(rows[i-1].observation.observedAt)<=4500);
  await f.owner.enterRecovery();assert.equal(f.recovered(),true);const children=fs.readdirSync(f.directory).filter(n=>n.includes('-child-')).map(n=>JSON.parse(fs.readFileSync(path.join(f.directory,n))));assert.ok(children.length>=5);assert.ok(children.every(c=>c.code===0&&c.signal===null&&c.stdoutEof&&c.stderrEof));
 }finally{if(!f.owner.inspect().closed)await f.owner.close();f.remove();}
});
