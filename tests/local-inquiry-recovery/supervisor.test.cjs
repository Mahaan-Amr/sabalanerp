const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { supervise } = require('../../deploy/scripts/run-inquiry-local-restored.cjs');
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Supervisor lifecycle did not complete');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test('recovery stops the actual child before acknowledging, resumes only NORMAL, and drains on shutdown', { skip: process.platform === 'win32' && 'SIGTERM lifecycle is exercised inside the existing Linux backend container' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-supervisor-'));
  const db = path.join(dir, 'inquiry.db'), state = path.join(dir, 'state.json');
  const ready = path.join(dir, 'ready'), closed = path.join(dir, 'closed');
  fs.writeFileSync(db, 'SQLite format 3\0');
  fs.writeFileSync(state, JSON.stringify({ mode: 'NORMAL' }));
  const script = path.join(dir, 'child.cjs');
  fs.writeFileSync(script, `const fs=require('node:fs');setInterval(()=>{},1000);process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(closed)},'');process.exit(0)},100));fs.writeFileSync(${JSON.stringify(ready)},'');`);
  const supervisor = supervise({ coordination: dir, database: db, args: [script], pollMs: 20 });
  try {
    await waitFor(() => fs.existsSync(ready));
    fs.writeFileSync(path.join(dir, 'restart-inquiry'), '');
    await waitFor(() => fs.existsSync(path.join(dir, 'inquiry-stopped')));
    assert.ok(fs.existsSync(closed), 'acknowledgement follows child exit');
    fs.rmSync(ready); fs.rmSync(closed);
    fs.writeFileSync(state, JSON.stringify({ mode: 'RESTORING' }));
    fs.rmSync(path.join(dir, 'restart-inquiry'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.existsSync(ready), false);
    fs.writeFileSync(state, JSON.stringify({ mode: 'NORMAL' }));
    await waitFor(() => fs.existsSync(ready));
    assert.equal(fs.existsSync(path.join(dir, 'inquiry-stopped')), false);
    supervisor.shutdown();
    assert.equal(await supervisor.done, 0);
    assert.ok(fs.existsSync(closed));
  } finally {
    supervisor.shutdown(); await supervisor.done;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing or invalid database never starts an application or creates a new database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-supervisor-'));
  try {
    const database = path.join(dir, 'missing.db');
    assert.throws(() => supervise({ coordination: dir, database, args: [] }));
    assert.equal(fs.existsSync(database), false);
    fs.writeFileSync(database, 'invalid');
    assert.throws(() => supervise({ coordination: dir, database, args: [] }), /DATABASE_INVALID/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unexpected application exit remains a failure instead of a healthy supervisor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-supervisor-'));
  try {
    const database = path.join(dir, 'inquiry.db');
    fs.writeFileSync(database, 'SQLite format 3\0');
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ mode: 'NORMAL' }));
    const supervisor = supervise({ coordination: dir, database, args: ['-e', 'process.exit(7)'], pollMs: 20 });
    assert.equal(await supervisor.done, 7);
    assert.ok(fs.existsSync(path.join(dir, 'inquiry-stopped')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the local launcher refuses ordinary or online-authority startup without touching a database', () => {
  const file = path.resolve(__dirname, '../../deploy/scripts/run-inquiry-local-restored.cjs');
  for (const overrides of [{ INQUIRY_LOCAL_RESTORED: '0' }, { INQUIRY_LOCAL_RESTORED: '1', BACKEND_RUNTIME_ROLE: 'candidate' }]) {
    const result = spawnSync(process.execPath, [file], { env: { ...process.env, ...overrides }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LOCAL_INQUIRY_STARTUP_SCOPE_REFUSED/);
  }
});

test('a recovery request racing with removal of the stopped acknowledgement cannot start a child', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-supervisor-'));
  const database = path.join(dir, 'inquiry.db'), stopped = path.join(dir, 'inquiry-stopped');
  fs.writeFileSync(database, 'SQLite format 3\0');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ mode: 'NORMAL' }));
  fs.writeFileSync(stopped, '');
  const remove = fs.rmSync;
  let starts = 0, supervisor;
  fs.rmSync = (file, options) => {
    remove(file, options);
    if (file === stopped) fs.writeFileSync(path.join(dir, 'restart-inquiry'), '');
  };
  try {
    supervisor = supervise({ coordination: dir, database, args: ['-e', 'setInterval(()=>{},1000)'], pollMs: 20,
      spawnChild: (...args) => { starts++; return spawn(...args); } });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(starts, 0);
    assert.ok(fs.existsSync(stopped));
  } finally {
    fs.rmSync = remove;
    if (supervisor) { supervisor.shutdown(); await supervisor.done; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
