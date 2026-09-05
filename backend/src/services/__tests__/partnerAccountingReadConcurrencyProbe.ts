import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { createPrismaPartnerReportingSource } from '../partnerSales/reporting/prisma';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const actorId = process.env.PARTNER_TEST_ACTOR_ID!, caseB = process.env.PARTNER_TEST_CASE_B!;
  try {
    const session = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-concurrency' });
    const app = express(); app.use('/api/accounting', accountingRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    let read: Promise<Response> | undefined;
    try {
      // This transaction models the documented writer lock sequence through
      // Case B and the shared actor. The read uses the real authenticated route.
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseB} FOR UPDATE`;
        read = process.env.PARTNER_TEST_READ_KIND === 'REPORT'
          ? createPrismaPartnerReportingSource({ database: prisma, actorId, correlationId: 'isolated-report-lock' })
            .read({ purpose: 'ACCOUNTING', from: '2026-01-01', to: '2026-12-31' }, async snapshot => {
              const authority = snapshot.authorization('ACCOUNTING', 'LIST');
              for (const id of [process.env.PARTNER_TEST_CASE_A!, caseB]) await authority.authorize('REPORT_READ', { kind: 'CASE', id });
              return new Response('Report authorization completed', { status: 200 });
            }).catch(error => new Response(String(error), { status: 500 }))
          : fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/payments`,
            { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        let blocked = false;
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const waiting = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
          if (Number(waiting[0].count)) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true, 'list reached the competing transaction');
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
      }, { timeout: 10_000 });
      const response = await read!;
      assert.equal(response.status, 200, `list and writer must both complete: ${await response.text()}`);
    } finally {
      await read;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
