/** Original diagnostic worker; actual backend graph comes ONLY from its image. */
import fs from 'node:fs';
import {createHash,createPublicKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyPrivateQualificationControl} from './online-private-qualification-control.fixture';
import type {mainPrivateQualificationRuntime} from '../../backend/src/onlinePrivateQualification';

let canonicalRuntimeReturned=false;
const PREFIX='SABALAN_PRIVATE_QUALIFICATION ';
const PUBLIC_KEY='/run/sabalan-online/qualification-controller-public-key.pem';
const fixedEntry='/app/dist/onlinePrivateQualification.js';
// Diagnostic restored-data actors must never inherit real provider credentials.
export const PRIVATE_PROVIDER_ENV=Object.freeze({
 NODE_ENV:'test',SMS_IR_API_KEY:'',SMS_IR_ENVIRONMENT:'production',SMS_IR_API_URL:'http://127.0.0.1:1',
 WEB_PUSH_VAPID_PUBLIC_KEY:'',WEB_PUSH_VAPID_PRIVATE_KEY:'',WEB_PUSH_VAPID_SUBJECT:'',
 TAXPAYER_DELIVERY_BROKER_ENDPOINT:'',HR_HIRING_E2E:'false',HR_HIRING_SMS_ADAPTER:'disabled',
 HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',
});
export function assertPrivateProviderEnvironment(env:NodeJS.ProcessEnv){
 for(const [name,value] of Object.entries(PRIVATE_PROVIDER_ENV))if(env[name]!==value)throw Error('PRIVATE_WORKER_PROVIDER_ENV_REFUSED:'+name);
}

const fail=(code:string):never=>{throw Error(code);};
function readKey(){
 const fd=fs.openSync(PUBLIC_KEY,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true}),identity=(v:fs.BigIntStats)=>[v.dev,v.ino,v.size,v.mtimeNs,v.ctimeNs,v.uid,v.mode,v.nlink].map(String).join(':');
  if(!before.isFile()||before.nlink!==1n||before.uid!==0n||(before.mode&0o777n)!==0o444n||before.size<1n||before.size>4096n)fail('PRIVATE_WORKER_FIXED_KEY_UNPROVEN');
  const bytes=Buffer.alloc(Number(before.size));let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)fail('PRIVATE_WORKER_FIXED_KEY_TRUNCATED');offset+=count;}
  if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0||identity(before)!==identity(fs.fstatSync(fd,{bigint:true}))||identity(before)!==identity(fs.lstatSync(PUBLIC_KEY,{bigint:true})))fail('PRIVATE_WORKER_FIXED_KEY_CHANGED');
  return {der:createPublicKey(bytes).export({format:'der',type:'spki'}) as Buffer,identity:identity(before)};
 }finally{fs.closeSync(fd);}
}
function installedEntrySha256(){
 if(fs.realpathSync(fixedEntry)!==fixedEntry)fail('PRIVATE_WORKER_ENTRY_ALIAS');
 const fd=fs.openSync(fixedEntry,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.size<1n||before.size>1024n*1024n)fail('PRIVATE_WORKER_ENTRY_UNPROVEN');
  const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024);let total=0;
  for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;if(total>1024*1024)fail('PRIVATE_WORKER_ENTRY_BOUND');hash.update(buffer.subarray(0,count));}
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(fixedEntry,{bigint:true});
  for(const value of [after,named])for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'] as const)if(value[key]!==before[key])fail('PRIVATE_WORKER_ENTRY_CHANGED');
  if(BigInt(total)!==before.size)fail('PRIVATE_WORKER_ENTRY_TRUNCATED');return hash.digest('hex');
 }finally{fs.closeSync(fd);}
}
export async function main(){
 if(process.platform!=='linux'||process.argv.length!==5)fail('PRIVATE_WORKER_FIXED_ARGV_REQUIRED');
 const [publicKeyBase64,session,actorId]=process.argv.slice(2);
 if(![session,actorId].every(value=>/^[a-f0-9]{64}$/.test(value)))fail('PRIVATE_WORKER_FIXED_ARGV_REQUIRED');
 assertPrivateProviderEnvironment(process.env);
 const originalKey=readKey();
 if(originalKey.der.toString('base64')!==publicKeyBase64)fail('PRIVATE_WORKER_CONTROL_KEY_NOT_FIXED_TRUST');
 const originalEntrySha256=installedEntrySha256();
 const runtimeRequire=createRequire('/app/package.json');
 const entry=runtimeRequire(fixedEntry) as {mainPrivateQualificationRuntime:typeof mainPrivateQualificationRuntime};
 const runtime=await entry.mainPrivateQualificationRuntime();canonicalRuntimeReturned=true;
 if(installedEntrySha256()!==originalEntrySha256)fail('PRIVATE_WORKER_ENTRY_CHANGED');
 const after=readKey();if(after.identity!==originalKey.identity||!after.der.equals(originalKey.der))fail('PRIVATE_WORKER_FIXED_KEY_CHANGED');
 const identity=runtime.identity;
 const emit=(event:string,extra:Record<string,unknown>={})=>process.stdout.write(PREFIX+JSON.stringify({format:'sabalan-private-qualification-worker/v1',session,actorId,event,scopeSha256:identity.scopeSha256,...extra})+'\n');
 let stage:'READY'|'PREPARED'|'CLOSED'='READY',sequence=0,held=false,buffer=Buffer.alloc(0),queue=Promise.resolve();
 let holdTimer:NodeJS.Timeout|undefined;
 const hold=(code:string)=>{if(held)return;held=true;process.exitCode=1;emit('HELD',{code});holdTimer=setInterval(()=>{},60_000);};
 const assertKey=()=>{const current=readKey();if(current.identity!==originalKey.identity||!current.der.equals(originalKey.der))fail('PRIVATE_WORKER_FIXED_KEY_CHANGED');};
 process.stdin.on('data',(chunk:Buffer)=>{
  if(held||stage==='CLOSED')return;
  if(buffer.length+chunk.length>8192){hold('PRIVATE_WORKER_CONTROL_OVERFLOW');return;}
  buffer=Buffer.concat([buffer,chunk]);
  for(;;){const newline=buffer.indexOf(10);if(newline<0)break;const wire=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
   queue=queue.then(async()=>{
    if(held||stage==='CLOSED')return;assertKey();
    const control=verifyPrivateQualificationControl(wire,originalKey.der,{session,actorId,scopeSha256:identity.scopeSha256,sequence:sequence+1});
    sequence=control.sequence;
    if(control.command==='PRIVATE_PREPARE_DRAIN'){
     if(stage!=='READY')fail('PRIVATE_WORKER_CONTROL_PHASE_REFUSED');
     await runtime.prepareDrain();if(held)return;stage='PREPARED';emit('PREPARED',{sequence});
    }else{
     if(stage!=='PREPARED')fail('PRIVATE_WORKER_CONTROL_PHASE_REFUSED');
     await runtime.shutdown();if(held)return;stage='CLOSED';emit('CLOSED',{sequence});
     if(holdTimer)clearInterval(holdTimer);process.stdin.destroy();
    }
   }).catch(error=>hold(error instanceof Error?error.message:'PRIVATE_WORKER_CONTROL_UNKNOWN'));
  }
 });
 process.stdin.on('end',()=>{if(stage!=='CLOSED')hold('PRIVATE_WORKER_CONTROL_EOF');});
 process.stdin.on('error',()=>{if(stage!=='CLOSED')hold('PRIVATE_WORKER_CONTROL_IO_UNKNOWN');});
 emit('READY',{identity,installedEntry:fixedEntry,installedEntrySha256:originalEntrySha256});
}
if(require.main===module)void main().catch(error=>{console.error('PRIVATE_QUALIFICATION_WORKER_FAILED',error instanceof Error?error.message:'UNKNOWN');process.exitCode=1;if(canonicalRuntimeReturned||(error instanceof Error&&error.message==='PRIVATE_QUALIFICATION_CLOSURE_UNPROVEN'))setInterval(()=>{},60_000);});
