/** Finite original-child custody only. This is never a FULL-restore token.
 * Ticket09's fixed source binding owns command selection and final verification.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';

const closures = new WeakMap();
const activeOwners = new WeakMap();
const originalLineage = new WeakMap();
const imageCallbackRefusals=new WeakMap();
const sha = raw => createHash('sha256').update(raw).digest('hex');
function protocol(validate) {
  try { validate(); } catch { throw Error('ORIGINAL_COMPLETE_OWNER_PROTOCOL_REFUSED'); }
}
export const isOriginalCompleteOwner=token=>!!token&&typeof token==='object'&&closures.get(token)?.purpose==='COMPLETE';
export function readOriginalImageRepositoryOwner(token){const value=closures.get(token);assert.ok(value?.purpose==='IMAGE_REPOSITORY','ORIGINAL_IMAGE_REPOSITORY_OWNER_REQUIRED');return structuredClone(value);}
export function readOriginalReadOnlyStorageOwner(token){const value=closures.get(token);assert.ok(value?.purpose==='READONLY_STORAGE_PREFLIGHT','ORIGINAL_READONLY_STORAGE_OWNER_REQUIRED');return structuredClone(value);}
export function readOriginalReadOnlyStorageCallbackRefusal(token){assert.equal(closures.get(token)?.purpose,'READONLY_STORAGE_PREFLIGHT');assert.ok(imageCallbackRefusals.has(token),'ORIGINAL_READONLY_CALLBACK_REFUSAL_REQUIRED');return imageCallbackRefusals.get(token);}
export function readOriginalImageCallbackRefusal(token){assert.equal(closures.get(token)?.purpose,'IMAGE_REPOSITORY');assert.ok(imageCallbackRefusals.has(token),'ORIGINAL_IMAGE_CALLBACK_REFUSAL_REQUIRED');return imageCallbackRefusals.get(token);}
export function readOriginalCompleteOwner(token) {
  assert.ok(isOriginalCompleteOwner(token), 'ORIGINAL_COMPLETE_OWNER_REQUIRED');
  const{purpose,...record}=closures.get(token);return structuredClone(record);
}
/** This token is minted only for the factory's own still-live child. Neither
 * a READY report nor a PID/ChildProcess supplied by a caller can create it. */
export function assertOriginalCompleteReadyOwner(token) {
  const value=activeOwners.get(token);assert.ok(value,'ORIGINAL_COMPLETE_LIVE_OWNER_REQUIRED');assert.equal(value.purpose,'COMPLETE','ORIGINAL_COMPLETE_OWNER_PURPOSE_REQUIRED');value.check(false);return value.operation;
}
export function assertOriginalCompleteActiveOwner(token) {
  const value=activeOwners.get(token);assert.ok(value,'ORIGINAL_COMPLETE_LIVE_OWNER_REQUIRED');assert.equal(value.purpose,'COMPLETE','ORIGINAL_COMPLETE_OWNER_PURPOSE_REQUIRED');value.check(true);return value.operation;
}
export function assertOriginalImageRepositoryReadyOwner(token){const value=activeOwners.get(token);assert.ok(value?.purpose==='IMAGE_REPOSITORY','ORIGINAL_IMAGE_REPOSITORY_LIVE_OWNER_REQUIRED');value.check(false);return value.operation;}
export function assertOriginalImageRepositoryActiveOwner(token){const value=activeOwners.get(token);assert.ok(value?.purpose==='IMAGE_REPOSITORY','ORIGINAL_IMAGE_REPOSITORY_LIVE_OWNER_REQUIRED');value.check(true);return value.operation;}
export function assertOriginalReadOnlyStorageReadyOwner(token){const value=activeOwners.get(token);assert.ok(value?.purpose==='READONLY_STORAGE_PREFLIGHT','ORIGINAL_READONLY_STORAGE_LIVE_OWNER_REQUIRED');value.check(false);return value.operation;}
export function assertOriginalImageRepositoryClosedOwnerFor(completion,readyOwner){const value=closures.get(completion);assert.ok(value?.purpose==='IMAGE_REPOSITORY'&&activeOwners.get(readyOwner)?.purpose==='IMAGE_REPOSITORY','ORIGINAL_IMAGE_REPOSITORY_OWNER_REQUIRED');assert.equal(originalLineage.get(completion),readyOwner,'ORIGINAL_IMAGE_REPOSITORY_OWNER_LINEAGE_REQUIRED');assert.equal(value.row.code,0);assert.equal(value.row.signal,null);assert.ok(value.row.stdoutEof&&value.row.stderrEof);}
export function assertOriginalCompleteClosedOwnerFor(completion,readyOwner) {
  assert.equal(originalLineage.get(completion),readyOwner,'ORIGINAL_COMPLETE_OWNER_LINEAGE_REQUIRED');
  assert.equal(closures.get(completion)?.purpose,'COMPLETE','ORIGINAL_COMPLETE_OWNER_PURPOSE_REQUIRED');assert.equal(activeOwners.get(readyOwner)?.purpose,'COMPLETE','ORIGINAL_COMPLETE_OWNER_PURPOSE_REQUIRED');

  assert.ok(closures.has(completion),'ORIGINAL_COMPLETE_OWNER_REQUIRED');
  const row=closures.get(completion).row;assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);
}

/** @param {{command:{executable:string, argv:string[], environment?:NodeJS.ProcessEnv}, operation:string,
 * beforeCredential:()=>Promise<void>, acquireCredential:()=>Promise<string>, onClosed:(row:object)=>Promise<void>, signal?:AbortSignal}} options */
export async function collectOriginalCompleteOwner({command, operation, beforeCredential, acquireCredential, onClosed, signal,onOriginalReady=async()=>{},acquireTransportPassphrase,purpose='COMPLETE',onImageRepositoryRequest,isKnownClosedCallbackRefusal}) {
  assert.ok(['COMPLETE','IMAGE_REPOSITORY','READONLY_STORAGE_PREFLIGHT'].includes(purpose),'ORIGINAL_OWNER_PURPOSE_REFUSED');
  if(purpose==='IMAGE_REPOSITORY'){assert.equal(typeof onImageRepositoryRequest,'function');assert.equal(acquireTransportPassphrase,undefined);if(isKnownClosedCallbackRefusal!==undefined)assert.equal(typeof isKnownClosedCallbackRefusal,'function');}
  else if(purpose==='READONLY_STORAGE_PREFLIGHT'){assert.equal(onImageRepositoryRequest,undefined);assert.equal(acquireTransportPassphrase,undefined);if(isKnownClosedCallbackRefusal!==undefined)assert.equal(typeof isKnownClosedCallbackRefusal,'function');}
  else{assert.equal(onImageRepositoryRequest,undefined,'COMPLETE_DUPLEX_CONTROL_REFUSED');assert.equal(isKnownClosedCallbackRefusal,undefined,'COMPLETE_CALLBACK_REFUSAL_PORT_REFUSED');}
  assert.match(operation, /^[a-f0-9]{32}$/);
  assert.equal(typeof command.executable, 'string');
  assert.ok(Array.isArray(command.argv) && command.argv.every(v => typeof v === 'string'));
  for (const callback of [beforeCredential, acquireCredential, onClosed]) assert.equal(typeof callback, 'function');
  assert.equal(typeof onOriginalReady,'function');if(acquireTransportPassphrase)assert.equal(typeof acquireTransportPassphrase,'function');
  signal?.throwIfAborted();
  // Validate fixed inputs before starting an original or obtaining a secret.
  await beforeCredential();
  signal?.throwIfAborted();
  const child = spawn(command.executable, command.argv, {
    shell:false, windowsHide:true, env:command.environment, stdio:['pipe','pipe','pipe'],
  });
  const done = new Promise(resolve => child.once('close', (code, childSignal) => resolve({code, signal:childSignal})));
  let failureObserved = false, failure, interrupted = false, ready = false, sent = false, resultReference;
  let pending = Buffer.alloc(0), secret, transportPassphrase, work = Promise.resolve();
  let imageSequence=0;const imageStages=Object.freeze(['BACKEND_ENCRYPT','BACKEND_LOCAL_VERIFY','BACKUP_STORE']);
  let ownerClosed=false,callbackRefusal;const liveOwner=Object.freeze({});
  activeOwners.set(liveOwner,{operation,purpose,check(requireSent){
    assert.ok(!ownerClosed&&!failureObserved&&!callbackRefusal&&!interrupted&&ready&&(!requireSent||sent)&&child.exitCode===null&&child.signalCode===null&&!child.killed,'ORIGINAL_COMPLETE_LIVE_OWNER_LOST');
  }});
  /** @type {Buffer | undefined} */
  let frame;
  const output = [], errors = [];
  let stdoutBytes = 0, stderrBytes = 0;
  const startedAt = new Date().toISOString();
  const fail = error => {
    if (!failureObserved) { failureObserved = true; failure = error; }
    try { if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(); } catch { /* Retain child through close. */ }
  };
  const cancel = () => { interrupted = true; fail(Error('ORIGINAL_COMPLETE_OWNER_INTERRUPTED')); };
  const closedCallbackRefusal=async error=>{
    if(!['IMAGE_REPOSITORY','READONLY_STORAGE_PREFLIGHT'].includes(purpose)||!isKnownClosedCallbackRefusal||!await isKnownClosedCallbackRefusal(error))return false;
    assert.equal(callbackRefusal,undefined);callbackRefusal=error;
    await new Promise((resolve,reject)=>child.stdin.end(error=>error?reject(error):resolve()));return true;
  };
  const checkBeforeCredential=async()=>{try{await beforeCredential();return true;}catch(error){if(await closedCallbackRefusal(error))return false;throw error;}};
  const consume = async line => {
    if (failureObserved) return;
    let event;
    try { event = JSON.parse(line); } catch { throw Error('ORIGINAL_COMPLETE_OWNER_PROTOCOL_REFUSED'); }
    if (!ready) {
      protocol(() => {
        assert.deepEqual(Object.keys(event).sort(), ['credentialsRead','format','operation','productionAdmission']);
        assert.equal(event.format, 'sabalan-r9-master-private-credential-ready/v1');
        assert.equal(event.operation, operation);
        assert.equal(event.credentialsRead, false);
        assert.equal(event.productionAdmission, false);
      });
      ready = true;
      await onOriginalReady(liveOwner);
      if(!await checkBeforeCredential())return;
      if (failureObserved) return;
      try{secret = await acquireCredential();}catch(error){if(await closedCallbackRefusal(error))return;throw error;}
      if (failureObserved) return;
      // Never put the credential into an assertion message or callback output.
      if (typeof secret !== 'string' || !secret.length || Buffer.byteLength(secret) > 4096 || secret.includes('\0')) {
        throw Error('ORIGINAL_COMPLETE_OWNER_CREDENTIAL_REFUSED');
      }
      if(!await checkBeforeCredential())return;
      if (failureObserved) return;
      if(acquireTransportPassphrase){
        transportPassphrase=await acquireTransportPassphrase(liveOwner);
        if(typeof transportPassphrase!=='string'||! /^[A-Za-z0-9_-]{64}$/.test(transportPassphrase))throw Error('ORIGINAL_COMPLETE_TRANSPORT_SECRET_REFUSED');
        activeOwners.get(liveOwner).check(false);
        await beforeCredential();if(failureObserved)return;
      }
      frame = Buffer.from(JSON.stringify({format:transportPassphrase?'sabalan-r9-master-private-credential/v2':'sabalan-r9-master-private-credential/v1', operation, credential:secret,...(transportPassphrase?{transportPassphrase}:{})}) + '\n');
      assert.ok(frame.length <= 16384, 'ORIGINAL_COMPLETE_OWNER_FRAME_BOUND');
      assert.ok(!sent && !child.stdin.destroyed && !child.stdin.writableEnded, 'ORIGINAL_COMPLETE_OWNER_INPUT_CLOSED');
      sent = true;
      await new Promise((resolve,reject)=>child.stdin[purpose==='IMAGE_REPOSITORY'?'write':'end'](frame,error=>error?reject(error):resolve()));
      frame.fill(0);
    } else if(purpose==='IMAGE_REPOSITORY'&&event.format==='sabalan-image-repository-owner-request/v1'){
      protocol(()=>{
        assert.ok(sent&&!resultReference&&!callbackRefusal);assert.deepEqual(Object.keys(event).sort(),['challenge','format','operation','sequence','stage']);assert.equal(event.operation,operation);assert.equal(event.sequence,imageSequence+1);assert.match(event.challenge,/^[a-f0-9]{64}$/);assert.equal(event.stage,imageStages[imageSequence]);assert.ok(imageSequence<3);
      });
      activeOwners.get(liveOwner).check(true);let result;
      try{result=await onImageRepositoryRequest(structuredClone(event),liveOwner);}catch(error){if(await closedCallbackRefusal(error))return;throw error;}
      activeOwners.get(liveOwner).check(true);
      protocol(()=>{assert.deepEqual(Object.keys(result).sort(),['configuration','format','operation','productionAdmission','stage']);assert.equal(result.format,'sabalan-image-repository-phase-plan/v1');assert.equal(result.operation,operation);assert.equal(result.stage,event.stage);assert.equal(result.productionAdmission,false);assert.deepEqual(Object.keys(result.configuration).sort(),['file','sha256']);assert.ok(typeof result.configuration.file==='string'&&result.configuration.file.length<=4096&&path.isAbsolute(result.configuration.file));assert.equal(path.resolve(result.configuration.file),result.configuration.file);assert.match(result.configuration.sha256,/^[a-f0-9]{64}$/);});

      frame=Buffer.from(JSON.stringify({...event,format:'sabalan-image-repository-owner-ack/v1',result})+'\n');assert.ok(frame.length<=65536,'IMAGE_REPOSITORY_ACK_BOUND');assert.ok(!frame.includes(Buffer.from(secret)),'IMAGE_REPOSITORY_ACK_SECRET_REFUSED');
      await new Promise((resolve,reject)=>child.stdin.write(frame,error=>error?reject(error):resolve()));frame.fill(0);imageSequence++;
    } else {
      protocol(() => {
        assert.ok((sent||callbackRefusal) && !resultReference);
        if(purpose==='IMAGE_REPOSITORY'){
          assert.deepEqual(Object.keys(event).sort(),['file','format','operation','outerOriginalClosurePending','productionAdmission','retrievalQualified','sha256']);assert.equal(event.format,'sabalan-image-repository-owner-result/v1');assert.equal(event.operation,operation);assert.equal(typeof event.retrievalQualified,'boolean');if(event.retrievalQualified){assert.equal(callbackRefusal,undefined);assert.equal(imageSequence,3);}
        }else if(purpose==='READONLY_STORAGE_PREFLIGHT'){
          assert.deepEqual(Object.keys(event).sort(),['file','format','operation','outerOriginalClosurePending','preflightSucceeded','productionAdmission','sha256']);assert.equal(event.format,'sabalan-readonly-storage-preflight-owner-result/v1');assert.equal(event.operation,operation);assert.equal(typeof event.preflightSucceeded,'boolean');if(callbackRefusal)assert.equal(event.preflightSucceeded,false);
        }else{
          assert.deepEqual(Object.keys(event).sort(), ['file','outerOriginalClosurePending','productionAdmission','sha256','strictCompleteValidationSucceeded']);assert.equal(event.strictCompleteValidationSucceeded,true);
        }
        assert.ok(typeof event.file === 'string' && event.file.length > 0 && event.file.length <= 4096);assert.match(event.sha256, /^[a-f0-9]{64}$/);assert.equal(event.outerOriginalClosurePending,true);assert.equal(event.productionAdmission,false);
      });
      resultReference=event;
      if(purpose==='IMAGE_REPOSITORY'&&!child.stdin.writableEnded)await new Promise((resolve,reject)=>child.stdin.end(error=>error?reject(error):resolve()));
    }

  };
  try {
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    signal?.addEventListener('abort', cancel, {once:true});
    if (signal?.aborted) cancel();
    child.on('error', fail);
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', fail);
    child.stdout.on('data', raw => {
      stdoutBytes += raw.length;
      if (stdoutBytes > 65536) { fail(Error('ORIGINAL_COMPLETE_OWNER_STDOUT_BOUND')); return; }
      output.push(Buffer.from(raw)); pending = Buffer.concat([pending, raw]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
        work = work.then(() => consume(line)).catch(fail);
      }
    });
    child.stderr.on('data', raw => {
      stderrBytes += raw.length;
      if (stderrBytes <= 65536) errors.push(Buffer.from(raw));
      else fail(Error('ORIGINAL_COMPLETE_OWNER_STDERR_BOUND'));
    });
  } catch (error) {
    fail(error);
    for (const stream of [child.stdout, child.stderr]) stream.resume();
  }
  try {
    const ended = await done;
    await work;
    const stdout = Buffer.concat(output), stderr = Buffer.concat(errors);
    // No raw output ever leaves this collector, including negative/echo paths.
    if ([secret,transportPassphrase].some(value=>typeof value==='string'&&value.length&&(
      stdout.includes(Buffer.from(value)) || stderr.includes(Buffer.from(value))
      || Object.values(resultReference ?? {}).some(field => typeof field === 'string' && field.includes(value))))) {
      fail(Error('ORIGINAL_COMPLETE_OWNER_CREDENTIAL_ECHO_REFUSED'));
    }
    const naturalClosure = ready && (sent||callbackRefusal) && resultReference && pending.length === 0 && ended.code === 0 && ended.signal === null
      && child.stdout.readableEnded && child.stderr.readableEnded && !child.killed && !interrupted && stderrBytes === 0;
    if (!naturalClosure && !failureObserved) fail(Error('ORIGINAL_COMPLETE_OWNER_CLOSURE_REFUSED'));
    const row = {format:'sabalan-original-complete-owner-closure/v1', originalPid:child.pid ?? null, ...ended,
      stdoutEof:child.stdout.readableEnded, stderrEof:child.stderr.readableEnded, killed:child.killed, interrupted,
      observationFault:failureObserved ? true : null, stdoutBytes, stderrBytes, startedAt, closedAt:new Date().toISOString()};
    // Digests of a negative output may fingerprint a credential echo. Omit them.
    if (!failureObserved) Object.assign(row, {stdoutSha256:sha(stdout), stderrSha256:sha(stderr)});
    try { await onClosed(structuredClone(row)); } catch (error) { fail(error); }
    if (failureObserved) throw failure;
    const token = Object.freeze({});
    // Only the successful, secret-checked original owns these exact bytes.
    // Negative output is never retained, even as a credential fingerprint.
    closures.set(token, {purpose,row, resultReference, stdoutRawBase64:stdout.toString('base64'),
      stderrRawBase64:stderr.toString('base64'), productionAdmission:false});
    originalLineage.set(token,liveOwner);
    if(callbackRefusal)imageCallbackRefusals.set(token,callbackRefusal);
    return token;
  } finally {
    ownerClosed=true;frame?.fill(0); secret = null;transportPassphrase=null;
    for (const raw of [...output, ...errors]) raw.fill(0);
    pending.fill(0);
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', cancel);
  }
}
