'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { test, after } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { HttpRequestLifecycle, runtimeHttpRequests, bindRuntimeHttpWriteAdmission } = require('./httpRequestLifecycle');
const express = require('/app/node_modules/express');

const roots = [];
function gateFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-kernel-admission-'));
  fs.chmodSync(directory, 0o700); roots.push(directory);
  const file = path.join(directory, 'deployment-write-admission.lock');
  fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(file, { bigint: true });
  const identity = { device: value.dev.toString(), inode: value.ino.toString(), ownerUid: Number(value.uid) };
  return { directory, file, identity, gate: new KernelWriteAdmission(file, identity, () => {}) };
}
function exclusive(file) {
  const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', file, '/usr/bin/true'], { timeout: 5000 });
  assert.ok([0, 1].includes(result.status), result.stderr?.toString());
  return result.status === 0;
}
function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true }); });

test('independent processes share admission; the exited flock helper does not release the parent lease', { timeout: 20000 }, async () => {
  const { file, identity, gate } = gateFixture();
  const first = await gate.acquire();
  assert.equal(exclusive(file), false);
  const source = `const {KernelWriteAdmission}=require(${JSON.stringify(path.join(__dirname, 'kernelWriteAdmission.js'))});
    (async()=>{const g=new KernelWriteAdmission(${JSON.stringify(file)},${JSON.stringify(identity)},()=>{});
    const lease=await g.acquire();process.stdout.write('SHARED_ADMITTED\\n');process.stdin.resume();
    await new Promise(resolve=>process.stdin.once('end',resolve));lease.release();await g.drain(1000);
    })().catch(e=>{console.error(e.code||e.message);process.exitCode=1});`;
  const child = spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  try {
    const [ready] = await once(child.stdout, 'data');
    assert.match(ready.toString(), /SHARED_ADMITTED/);
    first.release();
    assert.equal(exclusive(file), false, 'the independent process still owns its shared description');
    child.stdin.end();
    assert.equal((await closed)[0], 0);
    assert.equal(exclusive(file), true);
    await gate.drain(1000);
    assert.throws(() => first.release(), /ALREADY_RELEASED/);
  } finally { child.stdin.end(); if (child.exitCode === null) await closed; }
});

test('a competing exclusive boundary and revoked owner admit no application work', { timeout: 20000 }, async () => {
  const { file, identity, gate } = gateFixture();
  const source = `const fs=require('fs'),cp=require('child_process');const fd=fs.openSync(${JSON.stringify(file)},'r');
    const result=cp.spawnSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','inherit',fd]});
    if(result.status!==0)throw Error('exclusive admission failed');process.stdout.write('EXCLUSIVE_ADMITTED\\n');
    process.stdin.resume();process.stdin.once('end',()=>fs.closeSync(fd));`;
  const child = spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    await assert.rejects(gate.acquire(), /BOUNDARY_ACTIVE/);
    child.stdin.end(); assert.equal((await closed)[0], 0);
  } finally { child.stdin.end(); if (child.exitCode === null) await closed; }
  let checks = 0;
  const revoked = new KernelWriteAdmission(file, identity, () => { if (++checks === 2) throw Error('OWNER_REVOKED'); });
  await assert.rejects(revoked.acquire(), /OWNER_REVOKED/);
  assert.equal(exclusive(file), true);
  await revoked.drain(1000);
});

test('drain never closes a still-owned lease; symlink substitution fails closed', { timeout: 20000 }, async () => {
  const { file, gate } = gateFixture();
  const lease = await gate.acquire();
  await assert.rejects(gate.drain(15), /DRAIN_UNPROVEN/);
  assert.equal(exclusive(file), false);
  lease.release(); await gate.drain(1000);
  const other = file + '.other'; fs.renameSync(file, other); fs.symlinkSync(other, file);
  await assert.rejects(gate.acquire(), /REPLACED/);
});

test('replacing an owned inode retains the original lock and forbids retirement or readmission', { timeout: 20000 }, () => {
  const { file, identity } = gateFixture();
  const source = `const assert=require('assert/strict'),fs=require('fs'),cp=require('child_process');
    const {KernelWriteAdmission}=require(${JSON.stringify(path.join(__dirname, 'kernelWriteAdmission.js'))});
    (async()=>{const g=new KernelWriteAdmission(${JSON.stringify(file)},${JSON.stringify(identity)},()=>{});
    const lease=await g.acquire();fs.renameSync(${JSON.stringify(file)},${JSON.stringify(file + '.original')});
    fs.writeFileSync(${JSON.stringify(file)},'',{flag:'wx',mode:0o600});
    assert.throws(()=>lease.release(),/REPLACED/);
    assert.equal(cp.spawnSync('/usr/bin/flock',['--exclusive','--nonblock',${JSON.stringify(file + '.original')},'/usr/bin/true']).status,1);
    await assert.rejects(g.acquire(),/OWNERSHIP_UNPROVEN/);await assert.rejects(g.drain(15),/DRAIN_UNPROVEN/);
    assert.throws(()=>new KernelWriteAdmission(${JSON.stringify(file)},${JSON.stringify(identity)},()=>{}),/REPLACED/);
    console.log('REPLACEMENT_FAIL_CLOSED');})().catch(e=>{console.error(e);process.exitCode=1});`;
  const result = spawnSync(process.execPath, ['-e', source], { timeout: 10000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /REPLACEMENT_FAIL_CLOSED/);
});

for (const disconnect of [false, true]) test(`native HTTP ${disconnect ? 'disconnect' : 'early response'} cannot release unfinished handler ownership`, { timeout: 20000 }, async () => {
  const { gate, file } = gateFixture();
  const entered = deferred(), pending = deferred(), responseClosed = deferred();
  const lifecycle = new HttpRequestLifecycle(() => true, () => gate.acquire());
  const app = express();
  app.use((_req, res, next) => { res.once('close', responseClosed.resolve); next(); });
  app.use(lifecycle.middleware);
  app.get('/owned', async (_request, response) => {
    if (!disconnect) response.end('early acknowledgement');
    entered.resolve(); await pending.promise;
    if (!response.destroyed && !response.writableEnded) response.end('done');
  });
  lifecycle.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = http.get({ host: '127.0.0.1', port: server.address().port, path: '/owned' });
  client.on('error', () => {});
  client.on('response', response => response.resume());
  try {
    await entered.promise;
    if (disconnect) client.destroy();
    await responseClosed.promise;
    await assert.rejects(lifecycle.waitForDrain(20), /DRAIN_TIMEOUT/);
    assert.equal(exclusive(file), false);
    pending.resolve();
    await lifecycle.waitForDrain(2000); await gate.drain(1000);
    assert.equal(exclusive(file), true);
  } finally {
    pending.resolve(); client.destroy(); await new Promise(resolve => server.close(resolve));
  }
});

test('client disconnect during pending admission never dispatches the domain handler', { timeout: 20000 }, async () => {
  const { gate, file } = gateFixture();
  const entered = deferred(), pending = deferred(), responseClosed = deferred(); let mutations = 0;
  const lifecycle = new HttpRequestLifecycle(() => true, async () => { entered.resolve(); await pending.promise; return gate.acquire(); });
  const app = express();
  app.use((_req, res, next) => { res.once('close', responseClosed.resolve); next(); });
  app.use(lifecycle.middleware); app.post('/owned', (_req, res) => { mutations++; res.end('changed'); });
  lifecycle.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = http.request({ host: '127.0.0.1', port: server.address().port, path: '/owned', method: 'POST' });
  client.on('error', () => {}); client.end();
  try {
    await entered.promise; client.destroy(); await responseClosed.promise;
    await assert.rejects(lifecycle.waitForDrain(20), /DRAIN_TIMEOUT/);
    pending.resolve(); await lifecycle.waitForDrain(2000); await gate.drain(1000);
    assert.equal(mutations, 0); assert.equal(exclusive(file), true);
  } finally { pending.resolve(); client.destroy(); await new Promise(resolve => server.close(resolve)); }
});

test('GET response-event audit reservation retains the cross-process boundary until its work finishes', { timeout: 20000 }, async () => {
  const { gate, file } = gateFixture();
  const entered = deferred(), pending = deferred();
  const lifecycle = new HttpRequestLifecycle(() => true, () => gate.acquire());
  const app = express(); app.use(lifecycle.middleware);
  app.get('/audit', (request, response) => {
    const reservation = lifecycle.reserveWrite(request);
    response.once('finish', () => {
      void reservation.run(async () => { entered.resolve(); await pending.promise; }).catch(() => {});
    });
    response.end('download completed');
  });
  lifecycle.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/audit`); await response.text();
    await entered.promise;
    await assert.rejects(lifecycle.waitForWriteDrain(20), /DRAIN_TIMEOUT/);
    assert.equal(exclusive(file), false);
    pending.resolve(); await lifecycle.waitForDrain(2000); await gate.drain(1000);
    assert.equal(exclusive(file), true);
  } finally { pending.resolve(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('durable-completion callback must finish before HTTP retirement and kernel release', { timeout: 20000 }, async () => {
  const { gate, file } = gateFixture();
  const entered = deferred(), persisted = deferred();
  const lifecycle = new HttpRequestLifecycle(() => true, async () => {
    const lease = await gate.acquire();
    return { release: async () => { entered.resolve(); await persisted.promise; lease.release(); } };
  });
  const app = express(); app.use(lifecycle.middleware); app.get('/owned', (_request, response) => response.end('done'));
  lifecycle.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/owned`); await response.text();
    await entered.promise;
    await assert.rejects(lifecycle.waitForDrain(20), /DRAIN_TIMEOUT/);
    assert.equal(exclusive(file), false);
    persisted.resolve(); await lifecycle.waitForDrain(2000); await gate.drain(1000);
    assert.equal(exclusive(file), true);
  } finally { persisted.resolve(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('the existing shared HTTP lifecycle binds native ownership once before serving and retains captured callbacks', async () => {
  const { gate, file } = gateFixture();
  const capturedByRoute = runtimeHttpRequests;
  bindRuntimeHttpWriteAdmission(() => true);
  runtimeHttpRequests.bindOwnership(() => gate.acquire());
  assert.throws(() => runtimeHttpRequests.bindOwnership(() => gate.acquire()), /ALREADY_BOUND/);
  const entered = deferred(), pending = deferred(), finished = deferred();
  const app = express();
  app.use(runtimeHttpRequests.middleware);
  app.get('/owned', async (request, response) => {
    await capturedByRoute.trackWork(request, async () => {
      response.end('early'); entered.resolve(); await pending.promise;
    });
  });
  runtimeHttpRequests.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = http.get({ host: '127.0.0.1', port: server.address().port, path: '/owned' });
  request.on('error', () => {});
  request.on('response', response => { response.resume(); response.once('end', finished.resolve); });
  try {
    await entered.promise; await finished.promise;
    assert.equal(exclusive(file), false);
    await assert.rejects(runtimeHttpRequests.waitForDrain(20), /DRAIN_TIMEOUT/);
    pending.resolve(); await runtimeHttpRequests.waitForDrain(2000); await gate.drain(1000);
    assert.equal(exclusive(file), true);
  } finally { pending.resolve(); request.destroy(); await new Promise(resolve => server.close(resolve)); }
});


test('ownership cannot be attached after an initially unowned runtime has answered a probe', async () => {
  const lifecycle = new HttpRequestLifecycle(() => true);
  const app = express(); app.use(lifecycle.middleware);
  app.get('/api/health', (_request, response) => response.end('healthy'));
  lifecycle.install(app);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/health' }, response => {
        response.on('error', reject); response.resume(); response.once('end', resolve);
      });
      request.once('error', reject);
    });
    assert.throws(() => lifecycle.bindOwnership(async () => ({ release() {} })), /ALREADY_OBSERVED/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
