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
  let admitPosting = true;
  entry.exports = { ...original, requireCustomerSourceSharesWithin: async (
    tx: import('@prisma/client').Prisma.TransactionClient,
    operation?: import('../customerSemanticCompatibility').CustomerSourceShareOperation,
  ) => {
    if (operation !== 'grouped-allocation' || !admitPosting) {
      await original.requireCustomerSourceSharesWithin(tx, operation);
    }
  } };
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
    const vouchersBefore = await prisma.accountingLedgerVoucher.count();
    const blocked = await send('');
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json() as any).code, 'CUSTOMER_SOURCE_SHARES_CLOSED');
    assert.equal(await prisma.accountingSettlementAllocation.count(), 0);
    assert.equal(await prisma.accountingLedgerVoucher.count(), vouchersBefore);
    const pending = await prisma.accountingCustomerAllocationIntent.findUniqueOrThrow({
      where: { idempotencyKey: body.idempotencyKey },
    });
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.result, null);
    // The HTTP harness owns this isolated database and simulates an admitted
    // release. Preserve all child lineage and financial constraints.
    const [backstop] = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid = 'public.accounting_settlement_allocations'::regclass
        AND tgname = 'require_active_grouped_allocation_child'
    `;
    assert.ok(backstop?.definition);
    await prisma.$executeRawUnsafe('DROP TRIGGER require_active_grouped_allocation_child ON public.accounting_settlement_allocations');
    const posting = await send('');
    assert.equal(posting.status, 200);
    const result = (await posting.json() as any).data;
    assert.equal(result.allocationIds.length, 2);
    assert.deepEqual((await (await send('/allocation-intent/status')).json() as any).data, { status: 'COMMITTED', result });
    assert.deepEqual((await (await send('')).json() as any).data, result);
    assert.equal((await send('', { ...body, reference: 'changed reference' })).status, 409);
    assert.equal(await prisma.accountingSettlementAllocation.count(), 2);
    assert.equal((await read()).debitOpenRials, 0n);
    await prisma.$executeRawUnsafe(backstop.definition);
    admitPosting = false;
    const newPosting = await send('', { ...body, idempotencyKey: randomUUID() });
    assert.equal(newPosting.status, 409);
    assert.equal((await newPosting.json() as any).code, 'CUSTOMER_SOURCE_SHARES_CLOSED');
    const creditShare = await prisma.accountingSettlementAllocation.findFirstOrThrow({ where: { creditItemId: credit.id } });
    const { sourceAllocations: _sources, ...reversalBase } = body;
    const reversal = { ...reversalBase, kind: 'REVERSE_ALLOCATION', allocationId: creditShare.id, idempotencyKey: randomUUID() };
    const reversed = await send('', reversal);
    assert.equal(reversed.status, 200, await reversed.clone().text());
    const reversedResult = (await reversed.json() as any).data;
    assert.equal(reversedResult.reversesId, creditShare.id);
    const replay = await send('', reversal);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).data.id, reversedResult.id);
    const conflict = await send('', { ...reversal, reference: 'different evidence' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as any).code, 'ALLOCATION_REVERSAL_CONFLICT');
    assert.equal(await prisma.accountingSettlementAllocation.count(), 3);
    const corrected = await read();
    assert.equal(corrected.debitOpenRials, 1n);
    assert.equal(corrected.standaloneCreditRials, 1n);
    assert.ok(corrected.creditAllocations[0]?.reversalVoucherId);
    const receiptShare = await prisma.accountingSettlementAllocation.findFirstOrThrow({
      where: { id: { in: result.allocationIds }, treasuryTransactionId: { not: null } },
    });
    const receiptReversal = { ...reversalBase, kind: 'REVERSE_ALLOCATION', allocationId: receiptShare.id, idempotencyKey: randomUUID() };
    const receiptResponse = await send('', receiptReversal);
    assert.equal(receiptResponse.status, 200, await receiptResponse.clone().text());
    const receiptResult = (await receiptResponse.json() as any).data;
    assert.equal(receiptResult.reversesId, receiptShare.id);
    const receiptReplay = await send('', receiptReversal);
    assert.equal(receiptReplay.status, 200);
    assert.equal((await receiptReplay.json() as any).data.id, receiptResult.id);
    for (const changed of [{ reference: 'different evidence' }, { idempotencyKey: randomUUID() }]) {
      const receiptConflict = await send('', { ...receiptReversal, ...changed });
      assert.equal(receiptConflict.status, 409);
      assert.equal((await receiptConflict.json() as any).code, 'ALLOCATION_REVERSAL_CONFLICT');
    }
    assert.equal(await prisma.accountingSettlementAllocation.count(), 4);
    assert.equal((await read()).debitOpenRials, 3n);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    await prisma.$disconnect();
    entry.exports = original;
  }
});
