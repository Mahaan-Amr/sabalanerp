'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-runtime-boundary-')); roots.push(root); fs.chmodSync(root, 0o700);
  const file = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
  const stat = fs.statSync(file, { bigint: true });
  const identity = { device: stat.dev.toString(), inode: stat.ino.toString(), ownerUid: Number(stat.uid) };
  const runtimeId = randomBytes(32).toString('hex');
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    postgresApplicationName: runtimePostgresApplicationName(runtimeId), gate: identity };
  const directory = path.join(root, runtimeId); fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  return { root, file, scope, directory, gate: new KernelWriteAdmission(file, identity, () => {}),
    journal: new RuntimeBoundaryJournal(directory, scope) };
}
function exclusive(file) {
  const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', file, '/usr/bin/true']);
  assert.ok([0, 1].includes(result.status)); return result.status === 0;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true }); });

test('a journal cannot declare a different gate from the acquired kernel boundary', async () => {
  const first = fixture(), second = fixture(); await first.journal.initialize();
  assert.throws(() => new RuntimeTaskAdmission(second.gate, first.journal, () => {}), /GATE_SCOPE_MISMATCH/);
  assert.equal((await first.journal.inspect()).epoch, 0);
  assert.equal((await first.journal.inspect()).phase, 'QUIESCENT');
  assert.equal(exclusive(first.file), true); assert.equal(exclusive(second.file), true);
  const identity = first.gate.identity(); identity.inode = second.scope.gate.inode;
  assert.equal(first.gate.identity().inode, first.scope.gate.inode);
  const declared = first.journal.gateIdentity(); declared.inode = second.scope.gate.inode;
  assert.equal(first.journal.gateIdentity().inode, first.scope.gate.inode);
});

test('durable busy epochs remain constant-space and bind the actual native incarnation', { timeout: 20000 }, async () => {
  const { journal, directory, scope } = fixture();
  await journal.initialize();
  let state = await journal.inspect(); assert.equal(state.phase, 'QUIESCENT'); assert.equal(state.epoch, 0);
  assert.equal(state.birth.pid, process.pid); assert.equal(state.birth.pidNamespace, fs.readlinkSync('/proc/self/ns/pid'));
  assert.equal(state.scope.postgresApplicationName.length, 56);
  for (let index = 1; index <= 20; index++) {
    assert.equal(await journal.activate(), index);
    state = await journal.inspect(); assert.equal(state.phase, 'ACTIVE'); assert.equal(state.epoch, index);
    await journal.settle(index);
  }
  state = await journal.inspect(); assert.equal(state.phase, 'QUIESCENT'); assert.equal(state.epoch, 20);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['claim.json', 'scope.json', 'state.json']);
  const size = fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
  assert.ok(size < 4096);
  await assert.rejects(new RuntimeBoundaryJournal(directory, scope).initialize(), /ALREADY_CLAIMED/);
  await assert.rejects(new RuntimeBoundaryJournal(directory, { ...scope, image: 'sha256:' + 'c'.repeat(64) }).inspect(), /SCOPE_CHANGED/);
});

test('overlapping tasks share one durable epoch and retirement waits for the final reference', { timeout: 20000 }, async () => {
  const { journal, gate, directory, file } = fixture(); await journal.initialize();
  const admission = new RuntimeTaskAdmission(gate, journal, () => {});
  const leases = await Promise.all(Array.from({ length: 100 }, () => admission.acquire()));
  assert.equal((await journal.inspect()).epoch, 1); assert.equal(exclusive(file), false);
  await Promise.all(leases.slice(0, -1).map(lease => lease.release()));
  assert.equal((await journal.inspect()).phase, 'ACTIVE'); assert.equal(exclusive(file), false);
  await assert.rejects(admission.stopAndDrain(15), /DRAIN_UNPROVEN/);
  await assert.rejects(admission.acquire(), /ADMISSION_CLOSED/);
  await leases.at(-1).release(); await admission.stopAndDrain(1000);
  assert.equal((await journal.inspect()).phase, 'QUIESCENT'); assert.equal(exclusive(file), true);
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('new work waits for settling publication and starts a fresh durable epoch', { timeout: 20000 }, async () => {
  const { journal, gate, file } = fixture(); await journal.initialize();
  const admission = new RuntimeTaskAdmission(gate, journal, () => {});
  const lease = await admission.acquire(), entered = deferred(), persisted = deferred();
  const settle = journal.settle.bind(journal);
  journal.settle = async epoch => { entered.resolve(); await persisted.promise; return settle(epoch); };
  const releasing = lease.release(); await entered.promise;
  let admitted = false;
  const next = admission.acquire().then(value => { admitted = true; return value; });
  await Promise.resolve(); assert.equal(admitted, false);
  assert.equal((await journal.inspect()).phase, 'ACTIVE'); assert.equal(exclusive(file), false);
  persisted.resolve(); await releasing;
  const second = await next; assert.equal((await journal.inspect()).epoch, 2); assert.equal((await journal.inspect()).phase, 'ACTIVE');
  await second.release(); await admission.stopAndDrain(1000); assert.equal(exclusive(file), true);
});

test('a dead ACTIVE incarnation remains inspectable and cannot be reclaimed or settled by restart', { timeout: 20000 }, async () => {
  const { journal, directory, scope } = fixture();
  const source = `const {RuntimeBoundaryJournal}=require(${JSON.stringify(path.join(__dirname, 'runtimeBoundaryJournal.js'))});
    (async()=>{const journal=new RuntimeBoundaryJournal(${JSON.stringify(directory)},${JSON.stringify(scope)});
    await journal.initialize();await journal.activate();console.log('DURABLE_ACTIVE_BEFORE_EXIT');})().catch(e=>{console.error(e);process.exitCode=1});`;
  const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /DURABLE_ACTIVE_BEFORE_EXIT/);
  const state = await journal.inspect(); assert.equal(state.phase, 'ACTIVE'); assert.notEqual(state.birth.pid, process.pid);
  await assert.rejects(journal.initialize(), /ALREADY_CLAIMED/);
  await assert.rejects(journal.settle(state.epoch), /NOT_OWNED/);
  assert.equal((await new RuntimeBoundaryJournal(directory, scope).inspect()).phase, 'ACTIVE');
});

test('unexpected, torn, symlinked and altered namespace records fail closed', { timeout: 20000 }, async () => {
  const { journal, directory } = fixture(); await journal.initialize();
  const state = path.join(directory, 'state.json'), original = fs.readFileSync(state);
  fs.writeFileSync(path.join(directory, '.state-orphan.tmp'), '{', { flag: 'wx', mode: 0o600 });
  await assert.rejects(journal.inspect(), /INVENTORY_UNPROVEN/); fs.unlinkSync(path.join(directory, '.state-orphan.tmp'));
  fs.writeFileSync(state, '{'); await assert.rejects(journal.inspect(), /RECORD_INVALID/);
  const saved = path.join(path.dirname(directory), 'saved-state.json');
  fs.writeFileSync(state, original); fs.renameSync(state, saved); fs.symlinkSync(saved, state);
  await assert.rejects(journal.inspect());
  fs.unlinkSync(state); fs.renameSync(saved, state);
  const changed = JSON.parse(original); changed.epoch = 100;
  fs.writeFileSync(state, JSON.stringify(changed) + '\n');
  await assert.rejects(journal.activate(), /RECORD_INVALID|STATE_CHANGED|STATE_INVALID/);
});

test('failed state fsync never admits work or releases the shared boundary', { timeout: 20000 }, () => {
  const { directory, scope, file } = fixture();
  const source = `const assert=require('assert/strict'),fsp=require('fs/promises'),cp=require('child_process');
    const {KernelWriteAdmission}=require(${JSON.stringify(path.join(__dirname, 'kernelWriteAdmission.js'))});
    const {RuntimeBoundaryJournal}=require(${JSON.stringify(path.join(__dirname, 'runtimeBoundaryJournal.js'))});
    const {RuntimeTaskAdmission}=require(${JSON.stringify(path.join(__dirname, 'runtimeTaskAdmission.js'))});
    (async()=>{const scope=${JSON.stringify(scope)},journal=new RuntimeBoundaryJournal(${JSON.stringify(directory)},scope);
    await journal.initialize();const gate=new KernelWriteAdmission(${JSON.stringify(file)},scope.gate,()=>{});
    const admission=new RuntimeTaskAdmission(gate,journal,()=>{}),open=fsp.open;
    fsp.open=async function(file,...args){const handle=await open.call(this,file,...args);
      if(String(file).includes('/.state-'))return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Error('INJECTED_FSYNC_FAILURE')};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});return handle;};
    await assert.rejects(admission.acquire(),/INJECTED_FSYNC_FAILURE/);fsp.open=open;
    assert.equal(cp.spawnSync('/usr/bin/flock',['--exclusive','--nonblock',${JSON.stringify(file)},'/usr/bin/true']).status,1);
    await assert.rejects(admission.acquire(),/ADMISSION_CLOSED/);await assert.rejects(admission.stopAndDrain(15),/DRAIN_UNPROVEN/);
    await assert.rejects(journal.inspect(),/INVENTORY_UNPROVEN/);console.log('UNKNOWN_PUBLICATION_FENCED');
    })().catch(e=>{console.error(e);process.exitCode=1});`;
  const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /UNKNOWN_PUBLICATION_FENCED/);
  const inspector = new RuntimeBoundaryJournal(directory, scope);
  return assert.rejects(inspector.inspect(), /INVENTORY_UNPROVEN/);
});

test('owner loss after ACTIVE publication retires unstarted work without a false orphan', { timeout: 20000 }, async () => {
  const { journal, gate, file } = fixture(); await journal.initialize(); let checks = 0;
  const admission = new RuntimeTaskAdmission(gate, journal, () => { if (++checks === 2) throw Error('OWNER_REVOKED'); });
  await assert.rejects(admission.acquire(), /OWNER_REVOKED/);
  assert.equal((await journal.inspect()).phase, 'QUIESCENT'); assert.equal(exclusive(file), true);
  await admission.stopAndDrain(1000);
});

test('stop during kernel admission cancels unstarted work and still proves retirement', { timeout: 20000 }, async () => {
  const { journal, gate, file } = fixture(); await journal.initialize();
  const entered = deferred(), pending = deferred(), acquire = gate.acquire.bind(gate);
  gate.acquire = async () => { entered.resolve(); await pending.promise; return acquire(); };
  const admission = new RuntimeTaskAdmission(gate, journal, () => {}), admitted = admission.acquire();
  await entered.promise;
  const stopped = admission.stopAndDrain(1000); pending.resolve();
  await assert.rejects(admitted, /ADMISSION_CLOSED/); await stopped;
  assert.equal((await journal.inspect()).phase, 'QUIESCENT'); assert.equal((await journal.inspect()).epoch, 0);
  assert.equal(exclusive(file), true);
});
