/** Fixed transport client. Its caller supplies the SAME active worker guard;
 * the Linux entry independently pins the existing read-only trust file. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createPublicKey,createHmac,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
const format='sabalan-original-restored-issuer/v1',route='/original-restored-issuer/v1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const mac=(key,domain,value)=>createHmac('sha256',key).update(format+'\0'+domain+'\0').update(bytes(value)).digest('hex');
const validMac=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));

/** Transport readiness seam only. This creates no engine proof or signer; the
 * installed Linux entry below must be used by the original native callback. */
export async function retainOriginalIssuerTransportClient({operation,passphrase,port,expectedPublicKeyPem,assertOriginalWorkerActive}){
 assert.match(operation,/^[a-f0-9]{32}$/);assert.ok(typeof passphrase==='string'&&/^[A-Za-z0-9_-]{64}$/.test(passphrase),'ORIGINAL_ISSUER_TRANSPORT_SECRET_REFUSED');
 assert.ok(Number.isInteger(port)&&port>0&&port<=65535);assert.equal(typeof assertOriginalWorkerActive,'function');
 const publicKey=createPublicKey(expectedPublicKeyPem);assert.equal(publicKey.asymmetricKeyType,'ed25519');
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(format),32));
 let phase='ENROLLING',sequence=0,busy=false,failed=false;const readers=[];
 const active=()=>{assert.equal(failed,false,'ORIGINAL_ISSUER_CLIENT_HELD');assert.notEqual(phase,'CLOSED');assertOriginalWorkerActive();};
 async function call(kind){
  active();assert.equal(busy,false);busy=true;
  const value={format,operation,sequence:++sequence,challenge:randomBytes(32).toString('hex'),kind};
  try{
   const result=await new Promise((resolve,reject)=>{
    let fault=null,responseSeen=false;const row={requestClosed:false,responseSeen:false,responseClosed:false,responseEof:false};readers.push(row);
    const request=http.request({hostname:'host.docker.internal',port,path:route,method:'POST',agent:false,
     headers:{Connection:'close','Content-Type':'application/json','x-sabalan-issuer-mac':mac(key,'request',value)}},response=>{
     responseSeen=true;row.responseSeen=true;let count=0;const chunks=[];
     response.on('data',chunk=>{count+=chunk.length;if(count<=12*1024**2)chunks.push(chunk);else fault??=Error('ORIGINAL_ISSUER_RESPONSE_BOUND');});
     response.on('error',()=>{fault??=Error('ORIGINAL_ISSUER_RESPONSE_FAULT');});
     response.once('end',()=>{row.responseEof=true;});
     response.once('close',()=>{
      row.responseClosed=true;
      try{
       if(fault)throw fault;assert.equal(row.responseEof,true);assert.equal(response.statusCode,200);
       const reply=JSON.parse(Buffer.concat(chunks));assert.ok(validMac(response.headers['x-sabalan-issuer-mac'],mac(key,'response',reply)));
       assert.deepEqual(Object.keys(reply).sort(),['challenge','format','kind','operation','result','sequence']);
       for(const name of ['challenge','format','kind','operation','sequence'])assert.equal(reply[name],value[name]);
       row.result=reply.result;
      }catch{fault=Error('ORIGINAL_ISSUER_RESPONSE_REFUSED');}
      finish();
     });
    });
    const finish=()=>{if(!row.requestClosed||responseSeen&&!row.responseClosed)return;if(fault)reject(fault);else if(!responseSeen)reject(Error('ORIGINAL_ISSUER_RESPONSE_MISSING'));else resolve(row.result);};
    request.once('error',()=>{fault??=Error('ORIGINAL_ISSUER_REQUEST_FAULT');});
    request.once('close',()=>{row.requestClosed=true;finish();});
    try{request.end(bytes(value));}catch{fault??=Error('ORIGINAL_ISSUER_REQUEST_INPUT_FAULT');/* Retain this SAME request until actual close; never replace or abort it. */}
   });active();return result;
  }catch(error){failed=true;throw error;}finally{busy=false;}
 }
 let enrollment;
 try{
  enrollment=await call('ENROLL');assert.deepEqual(Object.keys(enrollment).sort(),['actorId','publicKey','publicKeyPem','session']);
  assert.match(enrollment.actorId,/^[a-f0-9]{64}$/);assert.match(enrollment.session,/^[a-f0-9]{64}$/);
  const der=publicKey.export({type:'spki',format:'der'});assert.equal(enrollment.publicKey,der.toString('base64'));
  assert.ok(createPublicKey(enrollment.publicKeyPem).export({type:'spki',format:'der'}).equals(der));Object.freeze(enrollment);phase='ENROLLED';
 }catch(error){failed=true;key.fill(0);throw error;}
 const invoke=async(expected,next,kind)=>{try{active();assert.equal(phase,expected);phase=next;return await call(kind);}catch(error){failed=true;throw error;}};
 return Object.freeze({enrollment,assertActive:active,
  async prepareOriginalRestoredLayout(){active();assert.equal(phase,'ENROLLED');return call('PREPARE_LAYOUT');},
  async checkOriginalResources(){return call('ASSERT_ACTIVE');},
  async assertMemoryWorkAdmission(){const result=await call('WORK_ADMISSION');assert.deepEqual(Object.keys(result),['admitted']);assert.equal(result.admitted,true,'QA_MEMORY_PRESSURE_REFUSED');},
  async issueOriginalRestoredMaterial(){return invoke('ENROLLED','ISSUED','ISSUE_MATERIAL');},
  async prepareOriginalPrivateDrain(){return invoke('ISSUED','DRAIN_SIGNED','PREPARE_DRAIN');},
  async shutdownOriginalPrivateHttp(){return invoke('DRAIN_SIGNED','SHUTDOWN_SIGNED','SHUTDOWN');},
  close(){assert.equal(busy,false);assert.notEqual(phase,'CLOSED');assert.ok(readers.every(r=>r.requestClosed&&(!r.responseSeen||r.responseClosed)));if(!failed)assert.ok(readers.every(r=>r.responseSeen&&r.responseEof));phase='CLOSED';key.fill(0);return Object.freeze({phase,failed,readers:readers.map(({result,...row})=>({...row})),allOriginalHttpReadersClosed:true,authenticationKeyRetired:true,productionAdmission:false});},
 });
}
export async function createOriginalLinuxRestoredIssuerClient(options){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 const file='/run/sabalan-online/qualification-controller-public-key.pem';assert.equal(fs.realpathSync(file),file);
 const stamp=s=>['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
 const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===0o444n&&before.size>0n&&before.size<=4096n);
 const pem=fs.readFileSync(file);assert.equal(stamp(fs.lstatSync(file,{bigint:true})),stamp(before));
 const guard=()=>{options.assertOriginalWorkerActive();assert.equal(fs.realpathSync(file),file);assert.equal(stamp(fs.lstatSync(file,{bigint:true})),stamp(before));assert.ok(fs.readFileSync(file).equals(pem));};
 return retainOriginalIssuerTransportClient({...options,expectedPublicKeyPem:pem,assertOriginalWorkerActive:guard});
}
