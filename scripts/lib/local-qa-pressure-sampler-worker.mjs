/** One retained observation lane. No Docker mutation, lease or runtime authority. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parentPort,workerData,isMainThread} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {createLocalQaPressureOwner,observeLocalQaPressure,localQaPressurePolicy} from './local-qa-memory-pressure.mjs';

const digest=raw=>createHash('sha256').update(raw).digest('hex');
export function serveLocalQaPressureSampler({port,data,observe=observeLocalQaPressure,maximumSamples=localQaPressurePolicy.maximumSamples}){
 const flags=new Int32Array(data.flags),directory=path.resolve(data.directory),stamp=()=>{
  const s=fs.lstatSync(directory,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(fs.realpathSync(directory),directory);
  return ['dev','ino','uid','mode'].map(k=>String(s[k]));
 };
 assert.deepEqual(stamp(),data.directoryStamp);assert.match(data.nonce,/^[a-f0-9]{32}$/);
 let serial=0,sequence=0,active=false,monitoring=false,finish,work,closing=false,lastRequest=0;
 const originals=new Set();
 function publish(kind,value){
  assert.deepEqual(stamp(),data.directoryStamp);const raw=Buffer.from(JSON.stringify(value)+'\n');assert.ok(raw.length<=65536,'QA_SAMPLER_RECORD_BOUND');assert.ok(serial<maximumSamples*2+1,'QA_SAMPLER_FILE_BOUND');
  const file=path.join(directory,'sampler-'+data.nonce+'-'+kind+'-'+(++serial)+'.json');
  const fd=fs.openSync(file,'wx',0o600);try{assert.equal(fs.writeSync(fd,raw),raw.length);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  assert.equal(digest(fs.readFileSync(file)),digest(raw));return{file,sha256:digest(raw)};
 }
 const fault=error=>{Atomics.store(flags,0,1);port.postMessage({event:'FAULT',reason:String(error?.message??'').match(/QA_[A-Z_]+/)?.[0]??'QA_SAMPLER_FAILED'});};
 const custody={onOriginal:child=>originals.add(child),onClosed:(child,row)=>{
  if(row.code!==0||row.signal!==null||!row.stdoutEof||!row.stderrEof||row.observationFault)Atomics.store(flags,1,1);
  try{publish('child',row);}catch(error){Atomics.store(flags,1,1);throw error;}
  originals.delete(child);
 }};
 const owner=createLocalQaPressureOwner({maximumSamples,observe:()=>observe(custody),persist:row=>publish('sample',row),onFault:fault,
  onValidated:value=>port.postMessage({event:'SAMPLE',sequence:++sequence,monitoring,value})});
 const reply=(id,value,error)=>port.postMessage({event:'REPLY',id,value,error:error?String(error.message??'').match(/QA_[A-Z_]+/)?.[0]??'QA_SAMPLER_REFUSED':null});
 port.on('message',async request=>{
  try{
   assert.equal(closing,false);assert.equal(request.id,lastRequest+1);lastRequest=request.id;
   if(request.command==='SAMPLE')reply(request.id,{sample:await owner.sample(request.stage,request.admission),state:owner.inspect()});
   else if(request.command==='BEGIN'){
    assert.equal(active,false);active=true;
    work=owner.run(request.stage,async()=>{monitoring=true;reply(request.id,{started:true});await new Promise(resolve=>{finish=resolve;});});
    // Keep the original promise handled while Root's event loop is blocked.
    work.catch(error=>{fault(error);if(!finish){active=false;reply(request.id,null,error);}});
   }else if(request.command==='END'){
    assert.ok(active&&finish);finish();try{await work;reply(request.id,{ended:true,state:owner.inspect()});}
    catch(error){reply(request.id,null,error);}finally{active=false;monitoring=false;finish=null;}
   }else if(request.command==='DRAIN'){
    assert.equal(active,false);closing=true;await owner.sample('sampler-drain',false).catch(fault);
    assert.equal(originals.size,0,'QA_SAMPLER_CHILD_STILL_OPEN');
    const closure={format:'sabalan-local-qa-sampler-closure/v1',nonce:data.nonce,allOriginalChildrenClosed:true,unknownOriginalCustody:Atomics.load(flags,1)!==0,state:owner.inspect(),sequence};
    const reference=publish('closed',closure);reply(request.id,{closure,reference});port.close();
   }else throw new Error('QA_SAMPLER_COMMAND_REFUSED');
  }catch(error){fault(error);reply(request.id,null,error);}
 });
 port.postMessage({event:'READY',nonce:data.nonce});
}
if(!isMainThread&&workerData?.format==='sabalan-local-qa-pressure-sampler/v1')serveLocalQaPressureSampler({port:parentPort,data:workerData});
