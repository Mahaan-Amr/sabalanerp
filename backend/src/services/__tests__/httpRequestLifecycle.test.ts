import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import express from 'express';
import { HttpRequestLifecycle } from '../httpRequestLifecycle';

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

test('response-completion audit work remains part of the drain after the handler returns', async () => {
  const lifecycle = new HttpRequestLifecycle(); const app = express();
  let complete!: () => void;
  const audit = new Promise<void>(resolve => { complete = resolve; });
  app.use(lifecycle.middleware);
  app.post('/audit', (req, res) => {
    res.once('finish', () => { void lifecycle.trackWork(req, () => audit); });
    res.json({ ok: true });
  });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/audit`, { method: 'POST' }); await response.text();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    complete(); await lifecycle.waitForDrain(1000);
  } finally { complete(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
