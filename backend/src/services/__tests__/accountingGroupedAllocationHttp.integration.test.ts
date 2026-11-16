import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const url = process.env.DATABASE_URL;

test('authenticated grouped allocation reserves, posts and recovers the same result over HTTP', { skip: !url, timeout: 240_000 }, async () => {
  const target = new URL(url!);
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(target.host));
  assert.match(target.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const require = createRequire(path.resolve('src/services/__tests__/accountingGroupedAllocationHttp.integration.test.ts'));
  const compatibilityPath = require.resolve('../customerSemanticCompatibility');
  const original = require(compatibilityPath);
  const entry = require.cache[compatibilityPath]!;
  entry.exports = { ...original, requireCustomerSourceSharesWithin: async () => {} };
  const { prisma } = require('../../lib/prisma') as typeof import('../../lib/prisma');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(`/${name}`, target.pathname);
    const { customerFinanceData } = require('./customerFinanceFixture') as typeof import('./customerFinanceFixture');
    const { createAuthoritativeSession } = require('../identitySessionService') as typeof import('../identitySessionService');
    const { recordCustomerAccountOperation, recordCustomerWorkspaceTreasury, readCustomerWorkspace } =
      require('../accountingCustomerWorkspace') as typeof import('../accountingCustomerWorkspace');
    const f = await customerFinanceData(prisma);
    await prisma.user.create({ data: { id: f.actor.id, username: f.actor.id, email: 'grouped@example.invalid',
      password: 'not-a-login', firstName: 'Test', lastName: 'Accountant', role: 'ADMIN' } });
    await prisma.workspacePermission.create({ data: { userId: f.actor.id, workspace: 'accounting', permissionLevel: 'edit' } });
    const session = await createAuthoritativeSession(prisma, f.actor.id, {});
    const customer = await f.customer();
    for (const [kind, amountRials] of [['DEBIT', 3n], ['CREDIT', 1n]] as const) {
      await recordCustomerAccountOperation(prisma, customer, { ...f.common, kind, amountRials, idempotencyKey: randomUUID() });
    }
    const receipt = await recordCustomerWorkspaceTreasury(prisma, customer, { ...f.common, kind: 'RECEIPT', amountRials: 2n,
      financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() });
    const read = async () => {
      const [{ at }] = await prisma.$queryRaw<Array<{ at: Date }>>`SELECT clock_timestamp() AS at`;
      return readCustomerWorkspace(prisma, { id: customer, asOf: at, userId: f.actor.id });
    };
    const account = await read();
    const debt = account.openItems.find(row => row.kind === 'RECEIVABLE')!;
    const credit = account.openItems.find(row => row.kind === 'CREDIT')!;
    const body = { kind: 'ALLOCATION', amountRials: '0', occurredAt: f.common.occurredAt.toISOString(),
      periodId: f.common.periodId, postingRuleId: f.common.postingRuleId, reason: f.common.reason, reference: f.common.reference,
      confirmed: true, idempotencyKey: randomUUID(), allocations: [], sourceAllocations: [
        { receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: '2' }] },
        { creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: '1' }] },
      ] };
    const router = (require('../../routes/accountingLedger') as typeof import('../../routes/accountingLedger')).default;
    const app = express(); app.use(express.json()); app.use(router);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/customer-accounts/${encodeURIComponent(customer)}/treasury`;
    const send = (suffix: string, payload: unknown = body) => fetch(`${base}${suffix}`, { method: 'POST', headers: {
      'content-type': 'application/json', cookie: `sabalan_session=${session.token}`,
    }, body: JSON.stringify(payload) });
    const prepared = await send('/allocation-intent');
    assert.equal(prepared.status, 200);
    assert.deepEqual((await prepared.json() as any).data, { status: 'PENDING', idempotencyKey: body.idempotencyKey });
    const posting = await send('');
    assert.equal(posting.status, 200);
    const result = (await posting.json() as any).data;
    assert.equal(result.allocationIds.length, 2);
    assert.deepEqual((await (await send('/allocation-intent/status')).json() as any).data, { status: 'COMMITTED', result });
    assert.deepEqual((await (await send('')).json() as any).data, result);
    assert.equal((await send('', { ...body, reference: 'changed reference' })).status, 409);
    assert.equal(await prisma.accountingSettlementAllocation.count(), 2);
    assert.equal((await read()).debitOpenRials, 0n);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    await prisma.$disconnect();
    entry.exports = original;
  }
});
