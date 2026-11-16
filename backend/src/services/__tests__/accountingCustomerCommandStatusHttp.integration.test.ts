import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { customerFinanceData } from './customerFinanceFixture';
import { prisma } from '../../lib/prisma';
import { hashAccountingEvidence } from '../accountingLedgerFoundation';
import { readCustomerWorkspace, recordCustomerAccountOperation } from '../accountingCustomerWorkspace';
import { createAuthoritativeSession } from '../identitySessionService';

const url = process.env.DATABASE_URL;
test('status HTTP boundary requires treasury authority and the exact original normalized command', { skip: !url, timeout: 240_000 }, async () => {
  const target = new URL(url!);
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(target.host));
  assert.match(target.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const shared = prisma;
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const [{ name }] = await shared.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.match(name, /^sabalanerp_concurrency_[a-f0-9]{16}$/);
    assert.equal(target.pathname, `/${name}`);
    const f = { ...await customerFinanceData(shared), db: shared };
    const { default: router } = await import('../../routes/accountingLedger');
    const [sharedDatabase] = await shared.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(sharedDatabase.name, name, 'HTTP application must use the isolated fixture database');
    const mkUser = async (id: string, role: 'ADMIN' | 'USER', permission: 'edit' | 'view', disabled = false) => {
      await f.db.user.create({ data: { id, email: `${id}@example.invalid`, username: id, password: 'not-a-login', firstName: 'Test', lastName: 'User', role } });
      await f.db.workspacePermission.create({ data: { userId: id, workspace: 'accounting', permissionLevel: permission } });
      if (disabled) await f.db.featurePermission.create({ data: { userId: id, workspace: 'accounting', feature: 'accounting_treasury_manage', permissionLevel: 'none' } });
      return createAuthoritativeSession(f.db, id, {});
    };
    const owner = await mkUser(f.actor.id, 'ADMIN', 'edit');
    const another = await mkUser('other-accountant', 'ADMIN', 'edit');
    const viewer = await mkUser('viewer', 'USER', 'view');
    const denied = await mkUser('no-treasury', 'USER', 'edit', true);
    const customer = await f.customer();
    await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const account = await readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
    const debt = account.openItems.find(row => row.kind === 'RECEIVABLE')!;
    const body = { kind: 'ALLOCATION', amountRials: '0', occurredAt: f.common.occurredAt.toISOString(), periodId: f.common.periodId,
      postingRuleId: f.common.postingRuleId, reason: f.common.reason, reference: f.common.reference, confirmed: true,
      idempotencyKey: randomUUID(), allocations: [], sourceAllocations: [{ creditItemId: 'synthetic-source', allocations: [{ openItemId: debt.id, amountRials: '1' }] }] };
    const normalized = { ...body, amountRials: 0n, occurredAt: new Date(body.occurredAt),
      sourceAllocations: [{ creditItemId: 'synthetic-source', receiptId: undefined, allocations: [{ openItemId: debt.id, amountRials: 1n }] }] };
    const result = { id: 'recorded-result', allocationIds: ['allocation'] };
    await f.db.accountingCustomerCommand.create({ data: { profileId: account.profile!.id, kind: 'ALLOCATION', idempotencyKey: body.idempotencyKey,
      createdBy: f.actor.id, commandHash: hashAccountingEvidence({ ...normalized, actor: undefined }), result } });
    const app = express(); app.use(express.json()); app.use(router);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/customer-accounts/${encodeURIComponent(customer)}/treasury`;
    const send = (path: string, token?: string, data: unknown = body) => fetch(`${base}${path}`, { method: 'POST', headers: {
      'content-type': 'application/json', ...(token ? { cookie: `sabalan_session=${token}` } : {}),
    }, body: JSON.stringify(data) });
    const before = await Promise.all([f.db.accountingCustomerCommand.count(), f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count()]);
    const response = await send('/status', owner.token); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.deepEqual((await response.json() as any).data, { status: 'COMMITTED', result });
    assert.deepEqual((await (await send('/status', another.token)).json() as any).data, { status: 'UNKNOWN' });
    assert.deepEqual((await (await send('/status', owner.token, { ...body, reference: 'altered evidence' })).json() as any).data, { status: 'UNKNOWN' });
    const otherCustomer = await f.customer();
    const crossCustomer = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/customer-accounts/${encodeURIComponent(otherCustomer)}/treasury/status`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `sabalan_session=${owner.token}` }, body: JSON.stringify(body),
    });
    assert.deepEqual((await crossCustomer.json() as any).data, { status: 'UNKNOWN' });
    assert.equal((await send('/status')).status, 401);
    assert.equal((await send('/status', viewer.token)).status, 403);
    assert.equal((await send('/status', denied.token)).status, 403);
    const blocked = await send('', owner.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json() as any).code, 'CUSTOMER_SOURCE_SHARES_CLOSED');
    assert.deepEqual(await Promise.all([f.db.accountingCustomerCommand.count(), f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count()]), before);
    // A missing visible row cannot be treated as a failed transaction: the
    // original command may be committed while this read is in progress.
    const inFlightBody = { ...body, idempotencyKey: randomUUID() };
    const inFlightHash = hashAccountingEvidence({ ...normalized, idempotencyKey: inFlightBody.idempotencyKey, actor: undefined });
    let inserted!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { inserted = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const transaction = f.db.$transaction(async tx => {
      await tx.accountingCustomerCommand.create({ data: { profileId: account.profile!.id, kind: 'ALLOCATION', idempotencyKey: inFlightBody.idempotencyKey,
        createdBy: f.actor.id, commandHash: inFlightHash, result } });
      inserted(); await hold;
    }, { timeout: 15_000 });
    try {
      await ready;
      assert.deepEqual((await (await send('/status', owner.token, inFlightBody)).json() as any).data, { status: 'UNKNOWN' });
    } finally { release(); await transaction; }
    assert.deepEqual((await (await send('/status', owner.token, inFlightBody)).json() as any).data, { status: 'COMMITTED', result });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    await shared.$disconnect();
  }
});
