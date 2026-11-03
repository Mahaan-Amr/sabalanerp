import test from 'node:test';
import assert from 'node:assert/strict';
import {collectOriginalCompleteOwner, readOriginalCompleteOwner, isOriginalCompleteOwner} from '../../scripts/lib/original-existing-compose-owner.mjs';

const operation = 'd'.repeat(32);
const credential = 'ephemeral-test-input-409';
function command(mode = 'success', expectedCredential = credential) {
  const script = `const operation=${JSON.stringify(operation)};
    const mode=${JSON.stringify(mode)};
    process.stdout.write(JSON.stringify({format:'sabalan-r9-master-private-credential-ready/v1',operation:mode==='wrong-ready'?'x':operation,credentialsRead:false,productionAdmission:false})+'\\n');
    let chunks=[];process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',()=>{
      if(!chunks.length){process.exitCode=2;return;}
      const frame=JSON.parse(Buffer.concat(chunks));
      if(frame.operation!==operation||frame.credential!==${JSON.stringify(expectedCredential)})throw Error('FRAME');
      if(mode==='echo'){process.stdout.write(frame.credential+'\\n');return;}
      if(mode==='stderr-echo'){process.stderr.write(frame.credential);return;}
      if(mode==='json-echo'){process.stdout.write(JSON.stringify({file:frame.credential,sha256:frame.credential})+'\\n');return;}
      if(mode==='escaped-echo'){process.stdout.write(JSON.stringify({file:frame.credential,sha256:'a'.repeat(64),strictCompleteValidationSucceeded:true,outerOriginalClosurePending:true,productionAdmission:false})+'\\n');return;}
      if(mode==='overflow'){process.stdout.write('x'.repeat(70000));return;}
      if(mode==='nonzero')process.exitCode=3;
      process.stdout.write(JSON.stringify({file:'modeled-only.json',sha256:'a'.repeat(64),strictCompleteValidationSucceeded:true,outerOriginalClosurePending:true,productionAdmission:false})+'\\n');
    });`;
  return {executable:process.execPath, argv:['--max-old-space-size=512','-e',script], environment:process.env};
}

test('same finite original earns closure custody, JSON cannot recreate it', async () => {
  let closed;
  const token = await collectOriginalCompleteOwner({command:command(), operation,
    beforeCredential:async()=>{}, acquireCredential:async()=>credential, onClosed:async row=>{closed=row;}});
  assert.equal(isOriginalCompleteOwner(token), true);
  const result = readOriginalCompleteOwner(token);
  assert.equal(result.row.code, 0);
  assert.equal(result.row.stdoutEof, true);
  assert.equal(result.row.stderrEof, true);
  assert.equal(result.row.originalPid, closed.originalPid);
  assert.equal(result.productionAdmission, false);
  for (const copy of [result, JSON.parse(JSON.stringify(token)), structuredClone(token)]) {
    assert.equal(isOriginalCompleteOwner(copy), false);
    assert.throws(()=>readOriginalCompleteOwner(copy), /ORIGINAL_COMPLETE_OWNER_REQUIRED/);
  }
});

test('falsy readiness failure is preserved after same original exits and both pipes EOF', async () => {
  for (const falsy of [false, 0, '', null, undefined]) {
    let checks = 0, acquired = false, closed;
    await assert.rejects(collectOriginalCompleteOwner({command:command(), operation,
      beforeCredential:async()=>{if (++checks === 2) throw falsy;},
      acquireCredential:async()=>{acquired=true;return credential;},
      onClosed:async row=>{closed=row;throw Error('SECONDARY');}}), error=>error === falsy);
    assert.equal(acquired, false);
    assert.equal(closed.code, 2);
    assert.equal(closed.stdoutEof && closed.stderrEof, true);
    assert.equal(closed.observationFault, true);
  }
});

test('invalid READY never asks for a credential; initial validation never spawns', async () => {
  let acquired = false, closed;
  await assert.rejects(collectOriginalCompleteOwner({command:command('wrong-ready'), operation,
    beforeCredential:async()=>{}, acquireCredential:async()=>{acquired=true;return credential;}, onClosed:async row=>{closed=row;}}), /PROTOCOL_REFUSED/);
  assert.equal(acquired, false); assert.equal(closed.code, 2);
  closed = null;
  await assert.rejects(collectOriginalCompleteOwner({command:command(), operation,
    beforeCredential:async()=>{throw Error('STALE_SOURCE');}, acquireCredential:async()=>{acquired=true;}, onClosed:async row=>{closed=row;}}), /STALE_SOURCE/);
  assert.equal(acquired, false); assert.equal(closed, null);
});

test('interruption retains the same child until natural negative closure', async () => {
  const abort = new AbortController(); let checks = 0, closed, acquired = false;
  await assert.rejects(collectOriginalCompleteOwner({command:command(), operation, signal:abort.signal,
    beforeCredential:async()=>{if (++checks === 2) abort.abort();},
    acquireCredential:async()=>{acquired=true;return credential;}, onClosed:async row=>{closed=row;}}), /INTERRUPTED/);
  assert.equal(acquired, false); assert.equal(closed.code, 2);
  assert.equal(closed.stdoutEof && closed.stderrEof, true);
  assert.equal(closed.interrupted, true); assert.equal(closed.killed, false);
});

test('changed binding after private input refuses before transferring its frame', async () => {
  let checks=0, closed;
  await assert.rejects(collectOriginalCompleteOwner({command:command(), operation,
    beforeCredential:async()=>{if (++checks === 3) throw Error('SOURCE_CHANGED_DURING_PRIVATE_INPUT');},
    acquireCredential:async()=>credential, onClosed:async row=>{closed=row;}}), /SOURCE_CHANGED_DURING_PRIVATE_INPUT/);
  assert.equal(closed.code, 2);
  assert.equal(closed.stdoutEof && closed.stderrEof, true);
});

test('echo and malformed secret-bearing JSON produce no raw or digest callback data', async () => {
  for (const mode of ['echo','stderr-echo','json-echo','overflow','nonzero']) {
    let closed;
    await assert.rejects(collectOriginalCompleteOwner({command:command(mode), operation,
      beforeCredential:async()=>{}, acquireCredential:async()=>credential, onClosed:async row=>{closed=row;}}), error=>{
        assert.equal(String(error.stack).includes(credential), false); return true;
      });
    assert.equal(closed.stdoutEof && closed.stderrEof, true);
    assert.equal(closed.observationFault, true);
    assert.equal('stdoutSha256' in closed, false);
    assert.equal('stderrSha256' in closed, false);
    assert.equal(JSON.stringify(closed).includes(credential), false);
  }
});

test('valid JSON with escaped credential never returns decoded credential or output hashes', async () => {
  for (const secret of ['ephemeral\ninput-409', 'ephemeral"input-409', 'ephemeral\\input-409']) {
    let closed;
    await assert.rejects(collectOriginalCompleteOwner({command:command('escaped-echo', secret), operation,
      beforeCredential:async()=>{}, acquireCredential:async()=>secret, onClosed:async row=>{closed=row;}}), /CREDENTIAL_ECHO_REFUSED/);
    assert.equal(closed.code, 0);
    assert.equal(closed.stdoutEof && closed.stderrEof, true);
    assert.equal(closed.observationFault, true);
    assert.equal('stdoutSha256' in closed, false);
    assert.equal(JSON.stringify(closed).includes(secret), false);
  }
});
