/** SAME-master ownership. Reports, PIDs and caller-supplied ChildProcesses cannot mint this token. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openFixedMasterBinding} from './master-binding.mjs';
const completions=new WeakMap();
const sha=b=>createHash('sha256').update(b).digest('hex');
export function isOriginalExistingComposeComplete(token){return !!token&&typeof token==='object'&&completions.has(token);}
export function readOriginalExistingComposeComplete(token){const s=completions.get(token);assert.ok(s,'ORIGINAL_EXISTING_COMPOSE_COMPLETE_REQUIRED');s.revalidate();return structuredClone(s.value);}
export function assertOriginalExistingComposeCompleteDrained(token){const value=readOriginalExistingComposeComplete(token),row=JSON.parse(Buffer.from(value.originalOwnerClosure.rawBase64,'base64'));assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.observationFault,null);assert.equal(value.outerOriginalClosurePending,false);assert.equal(value.finalDatabaseAbsence.oid,null);for(const k of['sessions','transactions','prepared'])assert.equal(value.finalDatabaseAbsence[k],0);return Object.freeze({format:'sabalan-original-existing-compose-complete-drained/v1',ownerOriginalPid:row.originalPid,ownerClosureSha256:value.originalOwnerClosure.sha256,database:Object.freeze({...value.proofDatabase}),databaseAbsent:true,productionAdmission:false});}
async function retainOwner(command,operation,credential,onReady,onClosed){
 assert.equal(typeof credential,'string');assert.match(operation,/^[a-f0-9]{32}$/);
 let frame=Buffer.from(JSON.stringify({format:'sabalan-r9-master-private-credential/v1',operation,credential})+'\n');
 assert.ok(frame.length<=16384&&Buffer.byteLength(credential)>0&&Buffer.byteLength(credential)<=4096&&!credential.includes('\0'));
 const child=spawn(command.executable,command.argv,{shell:false,windowsHide:true,env:command.environment,stdio:['pipe','pipe','pipe']});
 // Install close observation before ALL fallible drain/write/listener setup.
 const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const startedAt=new Date().toISOString();let failureObserved=false,failure,interrupted=false,ready=false,sent=false,pending=Buffer.alloc(0),out=[],err=[],outBytes=0,errBytes=0;
 const fail=e=>{if(!failureObserved){failureObserved=true;failure=e;}try{if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end();}catch{}};
 const cancel=()=>{interrupted=true;fail(Error('ORIGINAL_EXISTING_COMPOSE_INTERRUPTED'));};
 let work=Promise.resolve();
 try{
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  child.on('error',fail);child.stdin.on('error',fail);child.stdout.on('error',fail);child.stderr.on('error',fail);
  child.stdout.on('data',raw=>{outBytes+=raw.length;if(outBytes>65536){fail(Error('ORIGINAL_OWNER_STDOUT_BOUND'));return;}out.push(Buffer.from(raw));pending=Buffer.concat([pending,raw]);let n;
   while((n=pending.indexOf(10))>=0){const line=pending.subarray(0,n);pending=pending.subarray(n+1);work=work.then(async()=>{
    if(failureObserved)return;const event=JSON.parse(line);
    if(!ready){assert.deepEqual(Object.keys(event).sort(),['credentialsRead','format','operation','productionAdmission']);assert.equal(event.format,'sabalan-r9-master-private-credential-ready/v1');assert.equal(event.operation,operation);assert.equal(event.credentialsRead,false);assert.equal(event.productionAdmission,false);assert.ok(!sent&&!child.stdin.destroyed&&!child.stdin.writableEnded);ready=true;await onReady();assert.ok(!failureObserved);sent=true;await new Promise((resolve,reject)=>child.stdin.end(frame,e=>e?reject(e):resolve()));frame.fill(0);}
    else{assert.equal(typeof event.file,'string');assert.match(event.sha256,/^[a-f0-9]{64}$/);assert.equal(event.strictCompleteValidationSucceeded,true);assert.equal(event.outerOriginalClosurePending,true);assert.equal(event.productionAdmission,false);assert.ok(!resultSeen);resultSeen=event;}
   }).catch(fail);}
  });
  child.stderr.on('data',raw=>{errBytes+=raw.length;if(errBytes<=65536)err.push(Buffer.from(raw));else fail(Error('ORIGINAL_OWNER_STDERR_BOUND'));});
 }catch(e){fail(e);try{child.stdin.end();}catch(x){fail(x);}for(const stream of[child.stdout,child.stderr]){try{stream.on('error',fail);stream.resume();}catch(x){fail(x);}}}
 let resultSeen=null;
 try{const ended=await done;await work;const stdout=Buffer.concat(out),stderr=Buffer.concat(err),row={format:'sabalan-original-existing-compose-complete-owner/v1',originalPid:child.pid??null,...ended,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,observationFault:failureObserved?true:null,killed:child.killed,interrupted,stdoutSha256:sha(stdout),stdoutBytes:outBytes,stderrSha256:sha(stderr),stderrBytes:errBytes,startedAt,closedAt:new Date().toISOString()};
  // Never persist a credential echo. The original still drains and closes.
  if(stdout.includes(Buffer.from(credential))||stderr.includes(Buffer.from(credential)))fail(Error('ORIGINAL_OWNER_CREDENTIAL_ECHO_REFUSED'));
  row.observationFault=failureObserved?true:null;try{await onClosed(row,stdout,stderr,{persistAllowed:!failureObserved});}catch(e){fail(e);}
  if(failureObserved)throw failure;
  assert.ok(ready&&sent&&resultSeen&&pending.length===0&&row.code===0&&row.signal===null&&row.stdoutEof&&row.stderrEof&&!row.killed&&!row.interrupted&&row.stderrBytes===0,'ORIGINAL_OWNER_CLOSURE_REFUSED');return{row,stdout,stderr,resultReference:resultSeen};
 }finally{frame.fill(0);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
/** Fixed configuration chooses this reviewed R9 source recipe, not a command or verifier callback. */
export async function runOriginalExistingComposeComplete({configurationFile,configurationSha256,password}){
 const binding=await openFixedMasterBinding(configurationFile,configurationSha256);
 let secret=password;try{binding.revalidate();const closure=await retainOwner(binding.command,binding.operation,secret,()=>binding.beforeCredential(),(...args)=>binding.persistOwnerClosure(...args));secret=null;
  binding.revalidate();const value=await binding.verifyClosedComplete(closure);binding.revalidate();
  const token=Object.freeze({});completions.set(token,{value:structuredClone(value),revalidate:binding.revalidate});return token;
 }finally{secret=null;password=null;}
}
