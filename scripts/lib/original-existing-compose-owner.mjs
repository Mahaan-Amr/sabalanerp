/** Finite original-child custody only. This is never a FULL-restore token.
 * Ticket09's fixed source binding owns command selection and final verification.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const closures = new WeakMap();
const sha = raw => createHash('sha256').update(raw).digest('hex');
function protocol(validate) {
  try { validate(); } catch { throw Error('ORIGINAL_COMPLETE_OWNER_PROTOCOL_REFUSED'); }
}
export const isOriginalCompleteOwner = token => !!token && typeof token === 'object' && closures.has(token);
export function readOriginalCompleteOwner(token) {
  assert.ok(isOriginalCompleteOwner(token), 'ORIGINAL_COMPLETE_OWNER_REQUIRED');
  return structuredClone(closures.get(token));
}

/** @param {{command:{executable:string, argv:string[], environment?:NodeJS.ProcessEnv}, operation:string,
 * beforeCredential:()=>Promise<void>, acquireCredential:()=>Promise<string>, onClosed:(row:object)=>Promise<void>, signal?:AbortSignal}} options */
export async function collectOriginalCompleteOwner({command, operation, beforeCredential, acquireCredential, onClosed, signal}) {
  assert.match(operation, /^[a-f0-9]{32}$/);
  assert.equal(typeof command.executable, 'string');
  assert.ok(Array.isArray(command.argv) && command.argv.every(v => typeof v === 'string'));
  for (const callback of [beforeCredential, acquireCredential, onClosed]) assert.equal(typeof callback, 'function');
  signal?.throwIfAborted();
  // Validate fixed inputs before starting an original or obtaining a secret.
  await beforeCredential();
  signal?.throwIfAborted();
  const child = spawn(command.executable, command.argv, {
    shell:false, windowsHide:true, env:command.environment, stdio:['pipe','pipe','pipe'],
  });
  const done = new Promise(resolve => child.once('close', (code, childSignal) => resolve({code, signal:childSignal})));
  let failureObserved = false, failure, interrupted = false, ready = false, sent = false, resultReference;
  let pending = Buffer.alloc(0), secret, work = Promise.resolve();
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
      await beforeCredential();
      if (failureObserved) return;
      secret = await acquireCredential();
      if (failureObserved) return;
      // Never put the credential into an assertion message or callback output.
      if (typeof secret !== 'string' || !secret.length || Buffer.byteLength(secret) > 4096 || secret.includes('\0')) {
        throw Error('ORIGINAL_COMPLETE_OWNER_CREDENTIAL_REFUSED');
      }
      await beforeCredential();
      if (failureObserved) return;
      frame = Buffer.from(JSON.stringify({format:'sabalan-r9-master-private-credential/v1', operation, credential:secret}) + '\n');
      assert.ok(frame.length <= 16384, 'ORIGINAL_COMPLETE_OWNER_FRAME_BOUND');
      assert.ok(!sent && !child.stdin.destroyed && !child.stdin.writableEnded, 'ORIGINAL_COMPLETE_OWNER_INPUT_CLOSED');
      sent = true;
      await new Promise((resolve, reject) => child.stdin.end(frame, error => error ? reject(error) : resolve()));
      frame.fill(0);
    } else {
      protocol(() => {
        assert.ok(sent && !resultReference);
        assert.deepEqual(Object.keys(event).sort(), ['file','outerOriginalClosurePending','productionAdmission','sha256','strictCompleteValidationSucceeded']);
        assert.ok(typeof event.file === 'string' && event.file.length > 0 && event.file.length <= 4096);
        assert.match(event.sha256, /^[a-f0-9]{64}$/);
        assert.equal(event.strictCompleteValidationSucceeded, true);
        assert.equal(event.outerOriginalClosurePending, true);
        assert.equal(event.productionAdmission, false);
      });
      resultReference = event;
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
    if (typeof secret === 'string' && secret.length && (
      stdout.includes(Buffer.from(secret)) || stderr.includes(Buffer.from(secret))
      || Object.values(resultReference ?? {}).some(value => typeof value === 'string' && value.includes(secret)))) {
      fail(Error('ORIGINAL_COMPLETE_OWNER_CREDENTIAL_ECHO_REFUSED'));
    }
    const naturalClosure = ready && sent && resultReference && pending.length === 0 && ended.code === 0 && ended.signal === null
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
    closures.set(token, {row, resultReference, productionAdmission:false});
    return token;
  } finally {
    frame?.fill(0); secret = null;
    for (const raw of [...output, ...errors]) raw.fill(0);
    pending.fill(0);
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', cancel);
  }
}
