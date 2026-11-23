'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { supervise } = require('../../deploy/scripts/run-inquiry-local-restored.cjs');

const launcher = path.resolve(__dirname, '../../deploy/scripts/run-inquiry-local-restored.cjs');

function fixture(t) {
  const coordination = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-supervisor-'));
  t.after(() => fs.rmSync(coordination, { recursive: true, force: true }));
  return {
    coordination,
    state: path.join(coordination, 'state.json'),
    stopped: path.join(coordination, 'inquiry-stopped'),
    restart: path.join(coordination, 'restart-inquiry'),
    ready: path.join(coordination, 'ready'),
  };
}

function setMode(state, mode) {
  fs.writeFileSync(state, JSON.stringify({ mode, updatedAt: '2026-11-23T00:00:00Z' }));
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Supervisor lifecycle did not complete');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('ordinary and managed scopes refuse the restored launcher before opening local runtime files', () => {
  for (const overrides of [
    { INQUIRY_LOCAL_RESTORED: '0' },
    { INQUIRY_LOCAL_RESTORED: '1', BACKEND_RUNTIME_ROLE: 'candidate' },
    { INQUIRY_LOCAL_RESTORED: '1', INQUIRY_NATIVE_AUTHORITY_FILE: '' },
  ]) {
    const result = spawnSync(process.execPath, [launcher], {
      env: { ...process.env, ...overrides },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LOCAL_INQUIRY_STARTUP_SCOPE_REFUSED/);
  }
});

test('restored startup refuses the historical root and alternate database URLs', () => {
  for (const [subpath, database, error] of [
    ['.', 'file:/data/inquiry.db', /LOCAL_INQUIRY_DATA_SUBPATH_REFUSED/],
    ['local-recovered-fixture', 'file:/data/other.db', /LOCAL_INQUIRY_DATABASE_URL_REFUSED/],
  ]) {
    const result = spawnSync(process.execPath, [launcher], {
      env: {
        INQUIRY_LOCAL_RESTORED: '1',
        INQUIRY_LOCAL_DATA_SUBPATH: subpath,
        DATABASE_URL: database,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  }
});

test('a recovery request during restored database verification keeps Inquiry stopped', async t => {
  const { coordination, state, stopped, restart, ready } = fixture(t);
  setMode(state, 'NORMAL');
  fs.writeFileSync(stopped, '');
  let verified = false;
  const supervisor = supervise({
    coordination,
    verifyDatabase: () => {
      assert.equal(fs.existsSync(stopped), false, 'verification must not overlap an active stopped acknowledgement');
      fs.writeFileSync(restart, '');
      verified = true;
    },
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(ready)}, '')`],
    pollMs: 20,
  });
  try {
    await waitFor(() => verified && fs.existsSync(stopped));
    assert.equal(fs.existsSync(ready), false);
  } finally {
    supervisor.shutdown();
    assert.equal(await supervisor.done, 0);
  }
});

test('a SQLite admission failure prevents Inquiry startup and remains a supervisor failure', async t => {
  const { coordination, state, stopped, ready } = fixture(t);
  setMode(state, 'NORMAL');
  const supervisor = supervise({
    coordination,
    verifyDatabase: () => { throw new Error('INQUIRY_SCHEMA_UNPROVEN'); },
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(ready)}, '')`],
  });
  assert.equal(await supervisor.done, 1);
  assert.equal(fs.existsSync(ready), false);
  assert.equal(fs.existsSync(stopped), true);
});

test('malformed state and independent restore and deployment holds keep Inquiry stopped', async t => {
  const { coordination, state, stopped, ready } = fixture(t);
  fs.writeFileSync(state, JSON.stringify({ mode: 'NORMAL' }));
  const restore = path.join(coordination, 'pending-restore.json');
  const deployment = path.join(coordination, 'deployment-maintenance.json');
  const supervisor = supervise({
    coordination,
    verifyDatabase: () => {},
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(ready)}, ''); process.exit(7)`],
    pollMs: 20,
  });
  try {
    assert.equal(fs.existsSync(stopped), true);
    fs.writeFileSync(restore, '');
    fs.writeFileSync(deployment, '');
    setMode(state, 'NORMAL');
    await new Promise(resolve => setTimeout(resolve, 80));
    fs.rmSync(restore);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(fs.existsSync(ready), false);
    assert.equal(fs.existsSync(stopped), true);
    fs.rmSync(deployment);
    await waitFor(() => fs.existsSync(ready));
    assert.equal(await supervisor.done, 7);
  } finally {
    supervisor.shutdown();
    await supervisor.done;
  }
});

test('the real child exits before stop acknowledgement and the newly admitted database is reverified on resume',
  { skip: process.platform === 'win32' && 'Windows child termination cannot exercise graceful SIGTERM' }, async t => {
    const { coordination, state, stopped, restart, ready } = fixture(t);
    const closed = path.join(coordination, 'closed');
    const checked = path.join(coordination, 'checked');
    const script = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(closed)}, '');
        process.exit(0);
      }, 100));
      setInterval(() => {}, 1000);
      fs.writeFileSync(${JSON.stringify(ready)}, fs.readFileSync(${JSON.stringify(checked)}));
    `;
    let databaseGeneration = 'original';
    setMode(state, 'NORMAL');
    const supervisor = supervise({
      coordination,
      verifyDatabase: () => fs.writeFileSync(checked, databaseGeneration),
      args: ['-e', script],
      pollMs: 20,
    });
    try {
      await waitFor(() => fs.existsSync(ready));
      assert.equal(fs.readFileSync(ready, 'utf8'), 'original');
      fs.writeFileSync(restart, '');
      await waitFor(() => fs.existsSync(stopped));
      assert.equal(fs.existsSync(closed), true);
      fs.rmSync(closed);
      fs.rmSync(ready);

      setMode(state, 'MAINTENANCE');
      fs.rmSync(restart);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(fs.existsSync(ready), false);
      databaseGeneration = 'restored';
      setMode(state, 'NORMAL');
      await waitFor(() => fs.existsSync(ready));
      assert.equal(fs.readFileSync(ready, 'utf8'), 'restored');
      assert.equal(fs.existsSync(stopped), false);
    } finally {
      supervisor.shutdown();
      assert.equal(await supervisor.done, 0);
      assert.equal(fs.existsSync(closed), true);
      assert.equal(fs.existsSync(stopped), true);
    }
  });
