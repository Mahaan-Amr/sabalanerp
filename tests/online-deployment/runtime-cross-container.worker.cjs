'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { root, scope } = configuration;
assert.match(root, /^\/app\/online-runtime-acceptance\/cross-container-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(root), root);
const gateFile = path.join(root, 'deployment-write-admission.lock');
const journal = new RuntimeBoundaryJournal(path.join(root, scope.runtimeId), scope);
const gate = new KernelWriteAdmission(gateFile, scope.gate, () => {});
const admission = new RuntimeTaskAdmission(gate, journal, () => {});
const references = new Map();
let exclusive;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
async function run(command) {
  switch (command.operation) {
    case 'acquire':
      assert.equal(references.has(command.reference), false);
      references.set(command.reference, await admission.acquire()); return {};
    case 'release': {
      const lease = references.get(command.reference); assert.ok(lease);
      await lease.release(); references.delete(command.reference); return {};
    }
    case 'snapshot': return journal.inspect();
    case 'drain': await admission.stopAndDrain(command.timeoutMs); return {};
    case 'exclusive': {
      assert.equal(exclusive, undefined);
      const descriptor = fs.openSync(gateFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', descriptor] });
      assert.equal(result.signal, null); assert.ok([0, 1].includes(result.status));
      if (result.status === 1) { fs.closeSync(descriptor); return { acquired: false }; }
      const information = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8');
      assert.match(information, /FLOCK\s+ADVISORY\s+WRITE/);
      exclusive = descriptor; return { acquired: true };
    }
    case 'unlock': assert.notEqual(exclusive, undefined); fs.closeSync(exclusive); exclusive = undefined; return {};
    case 'stop':
      assert.equal(references.size, 0); assert.equal(exclusive, undefined);
      await admission.stopAndDrain(1000); return { stopped: true };
    default: throw Error('UNKNOWN_FIXTURE_OPERATION');
  }
}
(async () => {
  await journal.initialize(); emit({ ready: true, snapshot: await journal.inspect() });
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', line => {
    queue = queue.then(async () => {
      let command;
      try {
        assert.ok(line.length < 1024); command = JSON.parse(line);
        const value = await run(command); emit({ id: command.id, ok: true, value });
        if (value.stopped) { lines.close(); process.stdin.destroy(); }
      } catch (error) { emit({ id: command?.id, ok: false, code: error.code || error.message }); }
    });
  });
  // Unexpected EOF with outstanding references is NOT a completed drain.
  // Keep native ownership alive for inspection; no timeout manufactures success.
  lines.on('close', () => {
    void queue.then(() => { if (references.size || exclusive !== undefined) setInterval(() => {}, 60_000); });
  });
})().catch(error => { emit({ failed: true, code: error.code || error.message }); process.exitCode = 1; });
