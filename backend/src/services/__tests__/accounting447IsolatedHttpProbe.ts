import assert from 'node:assert/strict';
import express from 'express';
import accountingRouter from '../../routes/accounting';
import { prisma } from '../../lib/prisma';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

async function main() {
  const actorId = process.env.ACCOUNTING_447_ACTOR_ID;
  assert.ok(actorId);
  const { token, session } = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1' });
  const app = express();
  app.use('/api/accounting', accountingRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/accounting`;
    for (const [name, path] of [['dashboard', '/dashboard?range=3m'],
      ['reviewable', '/contracts?view=reviewable&page=1&pageSize=12']] as const) {
      const samples: number[] = [];
      for (let index = 0; index < 20; index++) {
        const started = performance.now();
        const response = await fetch(`${base}${path}`, { headers: {
          Cookie: `${SESSION_COOKIE}=${token}`, 'x-sabalan-expected-user': actorId,
          'x-sabalan-expected-session': session.id,
        } });
        const body = await response.json() as { success?: boolean; data?: any; code?: string };
        samples.push(Math.round(performance.now() - started));
        assert.equal(response.status, 200, `${name}: ${JSON.stringify(body).slice(0, 300)}`);
        assert.equal(body.success, true);
        if (name === 'reviewable') assert.equal(body.data?.total, 965);
        else assert.equal(body.data?.workspace?.commandCenter?.reviewableContracts?.count, 965);
      }
      samples.sort((a, b) => a - b);
      console.log(JSON.stringify({ name, samples, p95: samples[Math.ceil(.95 * samples.length) - 1] }));
    }
    for (const [sourceKind, expected] of [['SALES_CONTRACT', 935], ['PARTNER_INTERNAL_RECORD', 30]] as const) {
      const response = await fetch(`${base}/contracts?view=reviewable&sourceKind=${sourceKind}&page=1&pageSize=100`, {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      });
      const body = await response.json() as { data?: { total: number; items: { sourceKind: string }[] } };
      assert.equal(response.status, 200);
      assert.equal(body.data?.total, expected, sourceKind);
      assert.ok(body.data?.items.every(item => sourceKind === 'SALES_CONTRACT'
        ? item.sourceKind !== 'PARTNER_INTERNAL_RECORD' : item.sourceKind === sourceKind));
    }
    for (const route of ['/financial-records', '/receivables', '/payments', '/tax',
      '/correction-requests', '/audit', '/performance']) {
      const response = await fetch(`${base}${route}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
      const body = await response.json() as { success?: boolean; error?: string };
      assert.equal(response.status, 200, `${route}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.equal(body.success, true, route);
    }
    await prisma.user.update({ where: { id: actorId }, data: { isActive: false } });
    const denied = await fetch(`${base}/dashboard?range=3m`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    assert.equal(denied.status, 401);
    console.log(JSON.stringify({ revocationStatus: denied.status }));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
