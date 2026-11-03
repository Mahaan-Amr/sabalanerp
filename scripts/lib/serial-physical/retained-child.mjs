/** Own one finite child through real close, both EOFs and durable finalization.
 * A closed negative is process-local evidence, never a deserialized receipt. */
import {createHash} from 'node:crypto';

const negatives = new WeakMap();
export function isClosedSerialNegative(error) {
 return negatives.has(error);
}

export async function retainSerialChild(child, {phase, sinks, persistReceipt, finalizeReceipt = () => {}, retry = () => new Promise(resolve => setTimeout(resolve, 50))}) {
 const ended = {stdout:false, stderr:false};
 const counts = {stdout:0, stderr:0};
 const hashes = {stdout:createHash('sha256'), stderr:createHash('sha256')};
 let fault = false;const faultKinds=new Set();
 const pending = {stdout:Promise.resolve(), stderr:Promise.resolve()};
 const bad = (kind='observation') => { fault = true;faultKinds.add(typeof kind==='string'?kind:'observation'); };
 const untilDurable = async (action,kind='sink-finalization') => {
  for (;;) {
   try { return await action(); } catch { bad(kind); await retry(); }
  }
 };
 process.on('SIGINT', bad); process.on('SIGTERM', bad);
 child.on('error', bad);
 const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
 for (const name of ['stdout', 'stderr']) {
  const stream = child[name];
  stream.on('error', bad);
  stream.once('end', () => { ended[name] = true; });
  stream.on('data', bytes => {
   stream.pause();
   counts[name] += bytes.length; hashes[name].update(bytes);
   // sink.write must be synchronous and report actual bytes, including partial writes.
   const task = (async () => {
    let offset = 0;
    while (offset < bytes.length) {
     const n = await untilDurable(() => {
      const written = sinks[name].write(bytes.subarray(offset));
      if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.length-offset) throw Error('SERIAL_WRITE_REFUSED');
      return written;
     },name+'-write');
     offset += n;
    }
    stream.resume();
   })();
   pending[name] = task;
  });
 }
 try {
  const exit = await closed;
  await Promise.all(Object.values(pending));
  // Missing EOF is unknown work, even if the process close event arrived.
  // Keep the original ownership promise pending; never invent successful EOF.
  while (!ended.stdout || !ended.stderr) await retry();
  for (const name of ['stdout','stderr']) {
   await untilDurable(() => sinks[name].sync());
   await untilDurable(() => sinks[name].close());
  }
  let receipt = Object.freeze({format:'sabalan-serial-original-child/v1', phase,
   originalPid:child.pid ?? null, ...exit, stdoutEof:ended.stdout, stderrEof:ended.stderr,
   stdoutBytes:counts.stdout, stderrBytes:counts.stderr,
   stdoutSha256:hashes.stdout.digest('hex'), stderrSha256:hashes.stderr.digest('hex'),
   observationFault:fault,observationFaultKinds:[...faultKinds].sort(), physicalReplayQualified:false, productionAdmission:false});
  await untilDurable(async () => {
   receipt = Object.freeze({...receipt, observationFault:fault,observationFaultKinds:[...faultKinds].sort()});
   await persistReceipt(receipt);
   await finalizeReceipt();
  },'receipt-finalization');
  if (!(receipt.originalPid > 1 && receipt.code === 0 && receipt.signal === null && !receipt.observationFault)) {
   const error = new Error('SERIAL_NATIVE_CLOSED_NEGATIVE');
   // Only an ordinary exit with fully drained output and finalized evidence
   // permits restoration. Signals, spawn/observation faults remain held.
   if (receipt.originalPid > 1 && Number.isInteger(receipt.code) && receipt.signal === null && !receipt.observationFault) negatives.set(error, receipt);
   throw error;
  }
  return receipt;
 } finally {
  process.removeListener('SIGINT',bad); process.removeListener('SIGTERM',bad);
 }
}
