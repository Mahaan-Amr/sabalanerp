/** Fixed JSON line transport retaining the SAME original Docker exec child.
 * Transport alone creates no native admission; semantic owners retain their
 * own native Popen, scope, requested-stop and reader evidence. */
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function retainOriginalCompleteNativeSession({command,commands,observeRaw=()=>{},onClosed=async()=>{}}){
 assert.equal(Array.isArray(commands),true);assert.equal(new Set(commands).size,commands.length);const allowed=new Set(commands);
 const child=spawn(command.executable,command.argv,{env:command.environment,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let started=false,sequence=0,pending=null,buffer=Buffer.alloc(0),fault=null,closed=false,stdoutBytes=0,stderrBytes=0;const out=createHash('sha256'),err=createHash('sha256');let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
 function fail(error){fault??=error;readyReject(fault);pending?.reject(fault);pending=null;}
 for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',fail);child.once('error',fail);
 child.stdout.on('data',raw=>{stdoutBytes+=raw.length;out.update(raw);try{observeRaw('stdout',raw);assert.ok(stdoutBytes<=16*1024**2&&buffer.length+raw.length<=8*1024**2+1);buffer=Buffer.concat([buffer,raw]);for(let i;(i=buffer.indexOf(10))>=0;){const line=buffer.subarray(0,i);buffer=buffer.subarray(i+1);const value=JSON.parse(line);if(!started){assert.deepEqual(Object.keys(value).sort(),['event','originalPopenPid','productionAdmission']);assert.equal(value.event,'ORIGINAL_STARTED');assert.ok(Number.isSafeInteger(value.originalPopenPid)&&value.originalPopenPid>1);assert.equal(value.productionAdmission,false);started=true;readyResolve(Object.freeze(value));}else{assert.ok(pending);assert.deepEqual(Object.keys(value).sort(),['command','result','sequence']);assert.equal(value.command,pending.command);assert.equal(value.sequence,pending.sequence);const p=pending;pending=null;p.resolve(value.result);}}}catch(error){fail(error);buffer=Buffer.alloc(0);}});
 child.stderr.on('data',raw=>{stderrBytes+=raw.length;err.update(raw);try{observeRaw('stderr',raw);assert.ok(stderrBytes<=65536);}catch(error){fail(error);}});
 const completion=new Promise(resolve=>child.once('close',async(code,signal)=>{closed=true;const row={originalPid:child.pid??null,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,killed:child.killed,stdoutBytes,stderrBytes,stdoutSha256:out.digest('hex'),stderrSha256:err.digest('hex'),observationFault:fault?String(fault.code??fault.name??'FAULT'):null,productionAdmission:false};if(!started||pending||buffer.length||code!==0||signal!==null||!row.stdoutEof||!row.stderrEof||child.killed)fail(Error('ORIGINAL_COMPLETE_NATIVE_SESSION_NEGATIVE'));try{await onClosed(row);}catch(error){fail(error);}resolve(Object.freeze({...row,observationFault:fault?String(fault.code??fault.name??'FAULT'):null}));}));
 return Object.freeze({started:()=>ready,
  async send(command){assert.ok(allowed.has(command),'FIXED_NATIVE_COMMAND_REQUIRED');assert.equal(closed,false);assert.equal(fault,null);assert.equal(pending,null);await ready;const n=++sequence;const result=new Promise((resolve,reject)=>{pending={sequence:n,command,resolve,reject};});result.catch(()=>{});await new Promise(resolve=>{try{child.stdin.write(JSON.stringify({sequence:n,command})+'\n',error=>{if(error)fail(error);resolve();});}catch(error){fail(error);resolve();}});return result;},
  async endOriginalInput(){try{child.stdin.end();}catch(error){fail(error);}return completion;},
  async finish(){assert.equal(pending,null);try{child.stdin.end();}catch(error){fail(error);}const row=await completion;assert.equal(fault,null,'ORIGINAL_COMPLETE_NATIVE_SESSION_HELD');assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stderrBytes,0);return row;},
  awaitOriginalClosure:()=>completion,
  assertLive(){assert.equal(closed,false);assert.equal(fault,null);assert.ok(child.pid>0&&child.exitCode===null&&child.signalCode===null&&!child.killed);},
 });
}
