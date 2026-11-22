import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { HttpRequestLifecycle } from '../httpRequestLifecycle';

const source = process.env.HTTP_DRAIN_TEST_DATABASE_URL;

test('an aborted HTTP response retains its actual PostgreSQL transaction until commit', { skip: !source, timeout: 10_000 }, async () => {
  const url = new URL(source!);
  assert.equal(url.protocol, 'postgresql:');
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(url.host));
  assert.equal(url.pathname, '/sabalanerp');
  url.searchParams.set('connection_limit', '1'); url.searchParams.set('pool_timeout', '5');
  // This harness owns one client and session-local table only. No application
  // schema/data or second container/Compose project is created or modified.
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const table = `qa_http_drain_${randomBytes(8).toString('hex')}`;
  const lifecycle = new HttpRequestLifecycle(); const app = express();
  let proceed!: () => void; let entered!: () => void;
  const work = new Promise<void>(resolve => { proceed = resolve; });
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  app.use(lifecycle.middleware);
  app.post('/commit', async (_req, res, next) => {
    try {
      await database.$transaction(async tx => {
        entered(); await work;
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" (command_id) VALUES ($1)`, 'committed-once');
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  lifecycle.install(app);
  const server = http.createServer(app);
  let request: http.ClientRequest | undefined;
  try {
    await database.$executeRawUnsafe(`CREATE TEMP TABLE "${table}" (command_id text PRIMARY KEY)`);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    request = http.request({ host: '127.0.0.1', port, path: '/commit', method: 'POST' });
    request.on('error', () => {}); request.end();
    await admitted; request.destroy();
    await assert.rejects(lifecycle.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    proceed(); await lifecycle.waitForDrain(3000);
    const rows = await database.$queryRawUnsafe<Array<{ command_id: string }>>(`SELECT command_id FROM "${table}"`);
    assert.deepEqual(rows, [{ command_id: 'committed-once' }]);
  } finally {
    proceed(); request?.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    try { await database.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`); }
    finally { await database.$disconnect(); }
  }
});
