import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpRequestLifecycle, runtimeHttpRequests } from '../httpRequestLifecycle';

test('disconnecting a client does not drain its unfinished async business handler', async () => {
  const lifecycle = new HttpRequestLifecycle();
  const app = express();
  let entered!: () => void; let complete!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const work = new Promise<void>(resolve => { complete = resolve; });
  app.use(lifecycle.middleware);
  const router = express.Router();
  let committed = false;
  router.post('/commit', async (_req, res) => { entered(); await work; committed = true; res.json({ ok: true }); });
  app.use('/business', router);
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const request = http.request({ host: '127.0.0.1', port, path: '/business/commit', method: 'POST' });
  request.on('error', () => {}); request.end();
  try {
    await admitted;
    request.destroy();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    assert.equal(committed, false);
    complete();
    await lifecycle.waitForDrain(1000);
    assert.equal(committed, true);
  } finally { complete(); request.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a finished response does not hide remaining handler work or swallow errors', async () => {
  const lifecycle = new HttpRequestLifecycle();
  const app = express();
  let complete!: () => void;
  const work = new Promise<void>(resolve => { complete = resolve; });
  app.use(lifecycle.middleware);
  app.post('/early-response', async (_req, res) => { res.json({ accepted: true }); await work; });
  app.post('/failure', async () => { throw new Error('expected handler error'); });
  app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ failed: true }); });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/early-response`, { method: 'POST' });
    assert.equal(response.status, 200); await response.text();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    complete(); await lifecycle.waitForDrain(1000);
    assert.equal((await fetch(`http://127.0.0.1:${port}/failure`, { method: 'POST' })).status, 500);
    await lifecycle.waitForDrain(1000);
  } finally { complete(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('late callback middleware hands off unfinished work without a false drained gap after disconnect', async () => {
  const lifecycle = new HttpRequestLifecycle(); const app = express();
  let proceed!: express.NextFunction; let admitted!: () => void; let complete!: () => void;
  const entered = new Promise<void>(resolve => { admitted = resolve; });
  const work = new Promise<void>(resolve => { complete = resolve; });
  app.use(lifecycle.middleware);
  app.use((_req, _res, next) => { proceed = next; admitted(); });
  app.post('/callback', async (_req, res) => { await work; res.end(); });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const request = http.request({ host: '127.0.0.1', port, path: '/callback', method: 'POST' });
  request.on('error', () => {}); request.end();
  try {
    await entered; request.destroy();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    proceed();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    complete(); await lifecycle.waitForDrain(1000);
  } finally { complete(); request.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('GET response-completion audit work remains part of the write drain after the handler returns', async () => {
  const lifecycle = new HttpRequestLifecycle(); const app = express();
  let complete!: () => void;
  const audit = new Promise<void>(resolve => { complete = resolve; });
  app.use(lifecycle.middleware);
  app.get('/audit', (req, res) => {
    res.once('finish', () => { void lifecycle.trackWork(req, () => audit); });
    res.json({ ok: true });
  });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/audit`); await response.text();
    await assert.rejects(lifecycle.waitForWriteDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    complete(); await lifecycle.waitForWriteDrain(1000);
  } finally { complete(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('future GET response writes reserve admission before recovery closes the boundary', async () => {
  let admissionOpen = true;
  const lifecycle = new HttpRequestLifecycle(() => admissionOpen); const app = express();
  let entered!: () => void; let respond!: () => void; let finishAudit!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const responseGate = new Promise<void>(resolve => { respond = resolve; });
  const audit = new Promise<void>(resolve => { finishAudit = resolve; });
  let auditStarted = false;
  app.use(lifecycle.middleware);
  app.get('/deferred-write', async (req, res) => {
    const reservation = lifecycle.reserveWrite(req);
    res.once('finish', () => { void reservation.run(async () => { auditStarted = true; await audit; }); });
    entered(); await responseGate; res.end();
  });
  app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.statusCode || 500).end(); });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const first = fetch(`http://127.0.0.1:${port}/deferred-write`);
    await admitted; admissionOpen = false;
    await assert.rejects(lifecycle.waitForWriteDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    assert.equal(auditStarted, false);
    respond(); await (await first).text();
    assert.equal(auditStarted, true);
    await assert.rejects(lifecycle.waitForWriteDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    finishAudit(); await lifecycle.waitForWriteDrain(1000);
    assert.equal((await fetch(`http://127.0.0.1:${port}/deferred-write`)).status, 503);
    await lifecycle.waitForDrain(1000);
  } finally { respond(); finishAudit(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('READ_ONLY backup drains mutations while a permitted read remains open; retirement still waits for both', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-http-readonly-'));
  const previous = process.env.RECOVERY_COORDINATION_DIR;
  process.env.RECOVERY_COORDINATION_DIR = root;
  const recovery = await import('../recoveryRuntime');
  let readEntered!: () => void; let writeEntered!: () => void; let finishRead!: () => void; let finishWrite!: () => void;
  const readReady = new Promise<void>(resolve => { readEntered = resolve; });
  const writeReady = new Promise<void>(resolve => { writeEntered = resolve; });
  const read = new Promise<void>(resolve => { finishRead = resolve; });
  const write = new Promise<void>(resolve => { finishWrite = resolve; });
  const app = express();
  app.use(runtimeHttpRequests.middleware); app.use(recovery.recoveryWriteGuard);
  app.get('/read', async (_req, res) => { readEntered(); await read; res.end(); });
  app.post('/write', async (_req, res) => { writeEntered(); await write; res.end(); });
  runtimeHttpRequests.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const readRequest = http.request({ host: '127.0.0.1', port, path: '/read' });
  const writeRequest = http.request({ host: '127.0.0.1', port, path: '/write', method: 'POST' });
  readRequest.on('error', () => {}); writeRequest.on('error', () => {});
  recovery.initializeRecoveryRuntime();
  readRequest.end(); writeRequest.end();
  try {
    await Promise.all([readReady, writeReady]);
    recovery.setRecoveryRuntimeState('READ_ONLY');
    await assert.rejects(recovery.waitForActiveWrites(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    finishWrite();
    await recovery.waitForActiveWrites(1000);
    await assert.rejects(runtimeHttpRequests.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    finishRead(); await runtimeHttpRequests.waitForDrain(1000);
  } finally {
    finishRead(); finishWrite(); readRequest.destroy(); writeRequest.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    recovery.setRecoveryRuntimeState('NORMAL');
    if (previous === undefined) delete process.env.RECOVERY_COORDINATION_DIR; else process.env.RECOVERY_COORDINATION_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
