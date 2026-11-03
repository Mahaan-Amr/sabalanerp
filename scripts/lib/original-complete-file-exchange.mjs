/** One request/one ACK over the existing private material channel. No stdout HR
 * frames, command RPC, credential transport, new trust key or native executor. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertCompleteCallbackAck} from './original-complete-callback.mjs';
const names=Object.freeze({request:'complete-observation-request.json',ack:'complete-observation-ack.json'});
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const MAX=8*1024**2;
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
function publicOnly(value,depth=0,budget={nodes:0}){
  assert.ok(depth<=64&&++budget.nodes<=100000);
  if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
    assert.ok(!['credential','password','passphrase','applicationKeys','privateKey','leaseToken','DATABASE_URL','argv','executable','command'].includes(key),'COMPLETE_PRIVATE_INPUT_REFUSED');
    publicOnly(child,depth+1,budget);
  }
}
function decode(raw){assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=MAX);const value=JSON.parse(raw.toString('utf8'));publicOnly(value);return value;}
/** Concrete file-only port; an existing original Docker material transport may
 * implement the same two fixed names, while retaining its actual reader closes. */
export function originalCompleteDirectoryTransport(directory){
  assert.equal(fs.realpathSync(directory),directory);const first=fs.lstatSync(directory,{bigint:true});
  assert.ok(first.isDirectory()&&!first.isSymbolicLink());
  const active=()=>{const now=fs.lstatSync(directory,{bigint:true});assert.equal(fs.realpathSync(directory),directory);
    for(const key of ['dev','ino','uid','mode'])assert.equal(now[key],first[key]);};
  return Object.freeze({
    async read(name){active();assert.ok(Object.values(names).includes(name));const file=path.join(directory,name);
      let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return null;throw error;}
      try{const a=fs.fstatSync(fd,{bigint:true}),n=fs.lstatSync(file,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n&&a.size>0n&&a.size<=BigInt(MAX));
        const stamp=st=>['ino','size','mode','nlink','mtimeNs','ctimeNs'].map(key=>String(st[key])).join(':');assert.equal(stamp(a),stamp(n));
        const raw=fs.readFileSync(fd);assert.equal(stamp(a),stamp(fs.fstatSync(fd,{bigint:true})));assert.equal(stamp(n),stamp(fs.lstatSync(file,{bigint:true})));active();return raw;
      }finally{fs.closeSync(fd);}},
    async write(name,raw){active();assert.ok(Object.values(names).includes(name));decode(raw);
      const file=path.join(directory,name),fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}active();
      assert.deepEqual(fs.readFileSync(file),raw);},
  });
}
export function originalCompleteApplicationExchange(transport){
  let used=false;
  return async({descriptor,endpoint,database,manifest,inquiryStage,assertActive})=>{
    assert.ok(!used,'COMPLETE_EXCHANGE_ALREADY_USED');used=true;assertActive();
    const request={format:'sabalan-original-complete-file-request/v1',descriptor:{rawBase64:descriptor.raw.toString('base64'),sha256:descriptor.sha256,
      manifestRawBase64:descriptor.manifestRaw.toString('base64')},endpoint,database,manifest,...(inquiryStage?{inquiryStage}:{}),productionAdmission:false};
    publicOnly(request);await transport.write(names.request,encode(request));
    for(;;){assertActive();const raw=await transport.read(names.ack);if(raw){
      const value=decode(raw);assert.equal(value.format,'sabalan-original-complete-file-ack/v1');
      assert.equal(value.requestSha256,sha(encode(request)));assert.equal(value.productionAdmission,false);
      assert.equal(value.status,'CLOSED','COMPLETE_PARENT_ORIGINAL_NEGATIVE');assertCompleteCallbackAck(value.result.ack,descriptor);assertActive();return value.result;
    }await pause();}
  };
}
export function serveOriginalCompleteFileRequest(transport,observe,assertActive){
  let stop=false,served=false;
  const work=(async()=>{
    while(!stop){assertActive();const raw=await transport.read(names.request);if(!raw){await pause();continue;}
      const value=decode(raw);assert.equal(value.format,'sabalan-original-complete-file-request/v1');assert.equal(value.productionAdmission,false);
      assert.ok(!served);served=true;
      const d=value.descriptor,descriptor={raw:Buffer.from(d.rawBase64,'base64'),sha256:d.sha256,manifestRaw:Buffer.from(d.manifestRawBase64,'base64')};
      assert.equal(descriptor.raw.toString('base64'),d.rawBase64);assert.equal(descriptor.manifestRaw.toString('base64'),d.manifestRawBase64);
      let result;
      try{result=await observe({descriptor,endpoint:value.endpoint,database:value.database,manifest:value.manifest,...(value.inquiryStage?{inquiryStage:value.inquiryStage}:{}),assertActive});}
      catch(error){await transport.write(names.ack,encode({format:'sabalan-original-complete-file-ack/v1',requestSha256:sha(raw),status:'NEGATIVE',productionAdmission:false}));throw error;}
      assertActive();publicOnly(result);
      await transport.write(names.ack,encode({format:'sabalan-original-complete-file-ack/v1',requestSha256:sha(raw),status:'CLOSED',result,productionAdmission:false}));
      return;
    }
    assert.ok(served,'COMPLETE_REQUEST_MISSING');
  })();
  // Keep rejection observed while the SAME worker/callback is still draining.
  work.catch(()=>{});
  return Object.freeze({async closed(){stop=true;await work;}});
}
