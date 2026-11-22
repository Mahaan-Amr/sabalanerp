'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function fixture(canJoin = () => true, assertOwner = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-work-context-')); fs.chmodSync(root, 0o700);
  const file = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(file, { bigint: true });
  const identity = { device: String(value.dev), inode: String(value.ino), ownerUid: Number(value.uid) };
  const runtimeId = randomBytes(32).toString('hex');
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  const directory = path.join(root, runtimeId); fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(directory, scope); await journal.initialize();
  const gate = new KernelWriteAdmission(file, identity, () => {});
  const tasks = new RuntimeTaskAdmission(gate, journal, () => {}, canJoin);
  const context = new RuntimeWorkContext(tasks, assertOwner);
  const exclusive = () => {
    const value = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', file, '/usr/bin/true']);
    assert.ok([0, 1].includes(value.status)); return value.status === 0;
  };
  return { root, journal, context, exclusive };
}

test('a Server Action body cannot acknowledge completion while its already started nested query is unfinished', async () => {
  const value = await fixture(); const entered = deferred(), complete = deferred();
  let child, settled = false;
  const parent = value.context.run(async () => {
    child = value.context.run(async () => { entered.resolve(); await complete.promise; return 'query-result'; });
    await entered.promise;
    return 'action-result';
  }).then(result => { settled = true; return result; });
  try {
    await entered.promise;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false, 'actual nested work must finish before the parent completion');
    assert.equal(value.exclusive(), false);
    assert.equal((await value.journal.inspect()).phase, 'ACTIVE');
  } finally { complete.resolve(); await child; await parent; await value.context.stopAndDrain(1000); }
  assert.equal(value.exclusive(), true);
  fs.rmSync(value.root, { recursive: true });
});

test('an admitted action finishes nested queries during capture closure while a new action remains outside the gate', async () => {
  let open = true;
  const value = await fixture(() => open), entered = deferred(), proceed = deferred(), queried = deferred(), finish = deferred();
  let lateStarted = false;
  const parent = value.context.run(async () => {
    entered.resolve(); await proceed.promise;
    assert.equal(await value.context.run(async () => 'existing-query'), 'existing-query');
    queried.resolve(); await finish.promise;
  });
  await entered.promise; open = false;
  const late = value.context.run(async () => { lateStarted = true; });
  const rejected = assert.rejects(late, { code: 'RUNTIME_TASK_ADMISSION_CLOSED' });
  try {
    proceed.resolve();
    await Promise.race([queried.promise, new Promise((_, reject) => setTimeout(() => reject(Error('NESTED_QUERY_BLOCKED_BY_CAPTURE')), 1000))]);
    assert.equal(lateStarted, false); assert.equal(value.exclusive(), false);
  } finally {
    finish.resolve(); await parent;
    await value.context.stopAndDrain(1000); await rejected;
  }
  assert.equal(lateStarted, false); assert.equal(value.exclusive(), true);
  fs.rmSync(value.root, { recursive: true });
});

test('a handled nested failure preserves the action result, and a failed parent still owns its unfinished child', async () => {
  const value = await fixture();
  assert.equal(await value.context.run(async () => {
    try { await value.context.run(async () => { throw Error('BUSINESS_CONFLICT'); }); }
    catch { return 'friendly-action-state'; }
  }), 'friendly-action-state');
  const entered = deferred(), finish = deferred(); let child, rejected = false;
  const original = Error('PARENT_FAILED');
  const parent = value.context.run(async () => {
    child = value.context.run(async () => { entered.resolve(); await finish.promise; });
    await entered.promise; throw original;
  });
  const result = parent.catch(error => { rejected = true; assert.equal(error, original); });
  try {
    await entered.promise; await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(rejected, false); assert.equal(value.exclusive(), false);
    await assert.rejects(value.context.stopAndDrain(20), { code: 'RUNTIME_TASK_DRAIN_UNPROVEN' });
    assert.equal(value.exclusive(), false); assert.equal((await value.journal.inspect()).phase, 'ACTIVE');
  } finally { finish.resolve(); await child; await result; await value.context.stopAndDrain(1000); }
  assert.equal(value.exclusive(), true); fs.rmSync(value.root, { recursive: true });
});

test('drain refuses an invalid or unbounded timeout without silently retiring the context', async () => {
  const value = await fixture();
  try {
    for (const timeout of [NaN, Infinity, -1, 240001, 0.5]) {
      await assert.rejects(value.context.stopAndDrain(timeout), { code: 'RUNTIME_WORK_DRAIN_TIMEOUT_INVALID' });
    }
    assert.equal(await value.context.run(async () => 'still-serving'), 'still-serving');
  } finally { await value.context.stopAndDrain(1000); }
  assert.equal(value.exclusive(), true); fs.rmSync(value.root, { recursive: true });
});

test('a later async descendant cannot reuse its completed parent admission across a capture pause', async () => {
  let open = true, started = false, late;
  const value = await fixture(() => open), trigger = deferred(), attempted = deferred();
  await value.context.run(async () => {
    late = trigger.promise.then(() => {
      attempted.resolve(); return value.context.run(async () => { started = true; });
    });
  });
  assert.equal(value.exclusive(), true);
  open = false;
  const rejected = assert.rejects(late, { code: 'RUNTIME_TASK_ADMISSION_CLOSED' });
  trigger.resolve(); await attempted.promise;
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(started, false); assert.equal(value.exclusive(), true);
    assert.equal((await value.journal.inspect()).phase, 'QUIESCENT');
  } finally { await value.context.stopAndDrain(1000); await rejected; }
  assert.equal(started, false); fs.rmSync(value.root, { recursive: true });
});

test('owner revocation prevents a nested query without discarding the admitted parent lease', async () => {
  let owner = true, enteredQuery = false;
  const value = await fixture(() => true, () => { if (!owner) throw Object.assign(Error('OWNER_REVOKED'), { code: 'OWNER_REVOKED' }); });
  try {
    await value.context.run(async () => {
      owner = false;
      await assert.rejects(value.context.run(async () => { enteredQuery = true; }), { code: 'OWNER_REVOKED' });
      assert.equal(value.exclusive(), false);
      assert.equal((await value.journal.inspect()).phase, 'ACTIVE');
    });
    assert.equal(enteredQuery, false); assert.equal(value.exclusive(), true);
  } finally { await value.context.stopAndDrain(1000); }
  fs.rmSync(value.root, { recursive: true });
});
