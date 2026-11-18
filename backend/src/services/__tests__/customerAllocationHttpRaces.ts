import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, readAuthoritativeSession } from '../identitySessionService';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';
import type { customerFinanceData } from './customerFinanceFixture';

type Common = Awaited<ReturnType<typeof customerFinanceData>>['common'];
type Seed = { actor: Common['actor']; common: Omit<Common, 'occurredAt'> & { occurredAt: string };
  financial: { id: string }; bank: { id: string } };

async function verifyAllocationHttpRaces(imageBackend: string, f: Seed & { db: PrismaClient }) {
  const common = { ...f.common, occurredAt: new Date(f.common.occurredAt) };
  await f.db.$executeRaw`GRANT SELECT ON public.users, public.auth_sessions, public.workspace_permissions,
    public.role_workspace_permissions, public.feature_permissions, public.role_feature_permissions TO sabalan_application_runtime`;
  await f.db.$executeRaw`GRANT UPDATE ("lastActivityAt", "idleExpiresAt") ON public.auth_sessions TO sabalan_application_runtime`;
  const makeSession = async (username: string, role: 'ADMIN' | 'USER') => {
    const user = await f.db.user.create({ data: { username, role, email: `${username}@example.invalid`, password: 'not-a-login',
      firstName: 'Test', lastName: 'Accountant', mustChangePassword: false } });
    if (role === 'ADMIN') await f.db.workspacePermission.create({ data: { userId: user.id, workspace: 'accounting', permissionLevel: 'admin' } });
    const { token } = await createAuthoritativeSession(f.db, user.id, {});
    return token;
  };
  const token = await makeSession('allocation-manager', 'ADMIN');
  const denied = await makeSession('allocation-denied', 'USER');

  const load = createRequire(__filename);
  let db: PrismaClient | undefined;
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    db = (load(path.join(imageBackend, 'dist/lib/prisma.js')) as typeof import('../../lib/prisma')).prisma;
    assert.ok(await readAuthoritativeSession(db, token), 'runtime login can see the authoritative session');
    assert.ok(await readAuthoritativeSession(db, denied), 'runtime login can see the restricted session');
    const router = (load(path.join(imageBackend, 'dist/routes/accountingLedger.js')) as typeof import('../../routes/accountingLedger')).default;
    const app = express();
    app.use((req, res, next) => {
      if (req.get('X-Test-Drop-Response') === 'true') {
        // Drop only the outbound response, after the real handler has built it.
        res.json = () => { res.destroy(); return res; };
      }
      next();
    });
    app.use(express.json(), router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server!.once('listening', resolve).once('error', reject));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = async (customer: string, suffix: string, payload: object, session = token, loseResponse = false) => {
      const response = await fetch(`${origin}/customer-accounts/${encodeURIComponent(customer)}/treasury${suffix}`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: `sabalan_session=${session}`, 'X-Test-Drop-Response': String(loseResponse) },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { data?: unknown; code?: string };
      return { status: response.status, ...body };
    };
    const readHttp = async <T>(resource: string): Promise<T> => {
      const response = await fetch(`${origin}${resource}`, { headers: { cookie: `sabalan_session=${token}` } });
      const body = await response.json() as { data: T };
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data;
    };
    const key = randomUUID;
    const seed = async (debtCount: number, creditCount: number, receiptCount: number) => {
      const customer = `customer:${(await f.db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: key() } })).id}`;
      for (let i = 0; i < debtCount + creditCount; i += 1) {
        await recordCustomerAccountOperation(f.db, customer, { ...common, kind: i < debtCount ? 'DEBIT' : 'CREDIT',
          amountRials: 1n, idempotencyKey: key() });
      }
      const receipts: string[] = [];
      for (let i = 0; i < receiptCount; i += 1) {
        const receipt = await recordCustomerWorkspaceTreasury(f.db, customer, {
          ...common, kind: 'RECEIPT', amountRials: 1n, financialAccountId: f.financial.id,
          bankLedgerId: f.bank.id, allocations: [], idempotencyKey: key(),
        });
        receipts.push(receipt.id);
      }
      const read = () => readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
      const account = await read();
      return { customer, read, receipts, debts: account.openItems.filter(row => row.kind === 'RECEIVABLE').map(row => row.id),
        credits: account.openItems.filter(row => row.kind === 'CREDIT').map(row => row.id) };
    };
    const base = { kind: 'ALLOCATION', amountRials: '0', occurredAt: common.occurredAt.toISOString(),
      periodId: f.common.periodId, postingRuleId: f.common.postingRuleId, reason: f.common.reason,
      reference: f.common.reference, confirmed: true, allocations: [] };
    const group = (source: { receiptId: string } | { creditItemId: string }, openItemId: string) => ({
      ...base, idempotencyKey: key(), sourceAllocations: [{ ...source, allocations: [{ openItemId, amountRials: '1' }] }],
    });
    const reserve = '/allocation-intent';
    const same = await seed(1, 1, 0);
    const exact = group({ creditItemId: same.credits[0] }, same.debts[0]);
    const permission = await send(same.customer, reserve, exact, denied);
    assert.equal(permission.status, 403, JSON.stringify(permission));
    const prepares = await Promise.all([send(same.customer, reserve, exact), send(same.customer, reserve, exact)]);
    for (const reply of prepares) {
      assert.equal(reply.status, 200, JSON.stringify(reply));
      assert.deepEqual(reply.data, { status: 'PENDING', idempotencyKey: exact.idempotencyKey });
    }
    // Hold the account's lock until both HTTP transactions have established a
    // serializable snapshot. This makes the conflict deterministic without mocks.
    let race: ReturnType<typeof send>[] = [];
    await f.db.$transaction(async tx => {
      const lockName = `customer-account:${same.customer.slice('customer:'.length)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockName}))`;
      race = [send(same.customer, '', exact), send(same.customer, '', exact)];
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [{ waiting }] = await f.db.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND usename = 'sabalan_application_runtime' AND wait_event = 'advisory'
        `;
        if (waiting === 2) return;
        await delay(25);
      }
      throw new Error('Both allocation transactions must be waiting on the isolated account lock');
    }, { timeout: 10_000 });
    const replies = await Promise.all(race);
    assert.deepEqual(replies.map(row => row.status).sort(), [200, 409], JSON.stringify(replies));
    const committed = replies.find(row => row.status === 200)!;
    assert.equal(replies.find(row => row.status === 409)?.code, 'ACCOUNTING_CONCURRENT_CHANGE');
    const status = await send(same.customer, '/status', exact);
    assert.deepEqual(status.data, { status: 'COMMITTED', result: committed.data });
    assert.deepEqual((await send(same.customer, '', exact)).data, committed.data);
    assert.equal((await send(same.customer, '', { ...exact, reference: 'changed reference' })).code, 'ALLOCATION_INTENT_REQUIRED');
    assert.equal(await f.db.accountingSettlementAllocation.count({ where: { parentCommandKey: exact.idempotencyKey } }), 1);
    assert.equal((await same.read()).debitOpenRials, 0n);
    assert.equal((await same.read()).standaloneCreditRials, 0n);

    const lost = await seed(2, 1, 1);
    const receiptShare = group({ receiptId: lost.receipts[0] }, lost.debts[0]);
    const command = { ...receiptShare, sourceAllocations: [...receiptShare.sourceAllocations,
      { creditItemId: lost.credits[0], allocations: [{ openItemId: lost.debts[1], amountRials: '1' }] }] };
    assert.equal((await send(lost.customer, reserve, command)).status, 200);
    await assert.rejects(send(lost.customer, '', command, token, true), /fetch failed/);
    const resolved = await send(lost.customer, '/status', command);
    assert.equal(resolved.status, 200, JSON.stringify(resolved));
    const rows = await f.db.accountingSettlementAllocation.findMany({ where: { parentCommandKey: command.idempotencyKey } });
    assert.equal(rows.length, 2);
    assert.deepEqual(resolved.data, { status: 'COMMITTED', result: { id: command.idempotencyKey,
      allocationIds: [rows.find(row => row.treasuryTransactionId === lost.receipts[0])?.id,
        rows.find(row => row.creditItemId === lost.credits[0])?.id] } });
    assert.equal((await lost.read()).debitOpenRials, 0n);
    assert.equal((await lost.read()).standaloneCreditRials, 0n);
    const creditAllocation = rows.find(row => row.creditItemId === lost.credits[0]);
    assert.ok(creditAllocation);
    const reversal = { ...base, kind: 'REVERSE_ALLOCATION', idempotencyKey: key(), allocationId: creditAllocation.id };
    const reversed = await send(lost.customer, '', reversal);
    assert.equal(reversed.status, 200, JSON.stringify(reversed));
    const reversalResult = reversed.data as { id?: string; reversesId?: string };
    assert.equal(reversalResult.reversesId, creditAllocation.id);
    assert.ok(reversalResult.id);
    assert.deepEqual((await send(lost.customer, '', reversal)).data, reversed.data);
    const corrected = await lost.read();
    assert.equal(corrected.debitOpenRials, 1n);
    assert.equal(corrected.standaloneCreditRials, 1n);
    const reversalVoucherId = corrected.creditAllocations[0]?.reversalVoucherId;
    assert.ok(reversalVoucherId);
    const postedVoucherIds = rows.map(row => row.ledgerVoucherId!);
    const voucher = await f.db.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: postedVoucherIds[0] } });
    const reportQuery = new URLSearchParams({ bookId: voucher.bookId, fiscalYearId: voucher.fiscalYearId, periodId: voucher.periodId });
    const journal = await readHttp<Array<{ id: string; debitTotalRials: string; creditTotalRials: string }>>(`/journal?${reportQuery}`);
    for (const id of [...postedVoucherIds, reversalVoucherId]) {
      const entry = journal.find(entry => entry.id === id);
      assert.equal(entry?.debitTotalRials, '1');
      assert.equal(entry?.creditTotalRials, '1');
    }
    const evidence = await readHttp<{ sourceType: string; sourceId: string; lines: unknown[] }>(`/vouchers/${creditAllocation.ledgerVoucherId}/evidence`);
    assert.equal(evidence.sourceType, 'SETTLEMENT_ALLOCATION');
    assert.equal(evidence.sourceId, creditAllocation.idempotencyKey);
    assert.equal(evidence.lines.length, 2);

    const receipt = await seed(2, 0, 1);
    const credit = await seed(2, 1, 0);
    const debt = await seed(1, 0, 2);
    const shared = [
      { name: 'receipt', f: receipt, a: group({ receiptId: receipt.receipts[0] }, receipt.debts[0]),
        b: group({ receiptId: receipt.receipts[0] }, receipt.debts[1]), code: 'RECEIPT_OVER_ALLOCATED', remainingDebt: 1n },
      { name: 'credit', f: credit, a: group({ creditItemId: credit.credits[0] }, credit.debts[0]),
        b: group({ creditItemId: credit.credits[0] }, credit.debts[1]), code: 'CREDIT_OVER_ALLOCATED', remainingDebt: 1n },
      { name: 'debt', f: debt, a: group({ receiptId: debt.receipts[0] }, debt.debts[0]),
        b: group({ receiptId: debt.receipts[1] }, debt.debts[0]), code: 'OPEN_ITEM_OVER_ALLOCATED', remainingDebt: 0n },
    ];
    for (const scenario of shared) {
      const { customer, read } = scenario.f;
      const [a, b] = await Promise.all([send(customer, reserve, scenario.a), send(customer, reserve, scenario.b)]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify({ scenario: scenario.name, a, b }));
      assert.equal((a.status === 409 ? a : b).code, 'ALLOCATION_INTENT_PENDING');
      const [winner, loser] = a.status === 200 ? [scenario.a, scenario.b] : [scenario.b, scenario.a];
      const accepted = await send(customer, '', winner);
      assert.equal(accepted.status, 200, JSON.stringify(accepted));
      const reconsidered = await send(customer, reserve, loser);
      assert.equal(reconsidered.status, 200, JSON.stringify(reconsidered));
      const rejected = await send(customer, '', loser);
      assert.equal(rejected.code, scenario.code, JSON.stringify(rejected));
      const canceled = await send(customer, `${reserve}/cancel`, loser);
      assert.deepEqual(canceled.data, { status: 'CANCELED' });
      assert.equal((await send(customer, '', loser)).code, 'ALLOCATION_INTENT_NOT_PENDING');
      assert.equal(await f.db.accountingSettlementAllocation.count({ where: { parentCommandKey: { in: [winner.idempotencyKey, loser.idempotencyKey] } } }), 1);
      const account = await read();
      assert.equal(account.debitOpenRials, scenario.remainingDebt);
      assert.equal(account.standaloneCreditRials, 0n);
    }

    const mixed = await seed(1, 0, 1);
    const grouped = group({ receiptId: mixed.receipts[0] }, mixed.debts[0]);
    const legacy = { ...base, receiptId: mixed.receipts[0], idempotencyKey: key(),
      allocations: [{ openItemId: mixed.debts[0], amountRials: '1' }] };
    const beforeMixed = await f.db.accountingSettlementAllocation.count();
    assert.equal((await send(mixed.customer, reserve, grouped)).status, 200);
    const [groupedPost, legacyPost] = await Promise.all([send(mixed.customer, '', grouped), send(mixed.customer, '', legacy)]);
    if (groupedPost.status !== 200) {
      assert.equal(groupedPost.code, 'ACCOUNTING_CONCURRENT_CHANGE', JSON.stringify(groupedPost));
      const retried = await send(mixed.customer, '', grouped);
      assert.equal(retried.status, 200, JSON.stringify([groupedPost, legacyPost, retried]));
    }
    assert.equal(legacyPost.status, 409, JSON.stringify(legacyPost));
    assert.ok(['ALLOCATION_INTENT_PENDING', 'ACCOUNTING_CONCURRENT_CHANGE', 'RECEIPT_OVER_ALLOCATED'].includes(legacyPost.code ?? ''),
      JSON.stringify(legacyPost));
    assert.equal((await send(mixed.customer, '', legacy)).code, 'RECEIPT_OVER_ALLOCATED');
    assert.equal(await f.db.accountingSettlementAllocation.count(), beforeMixed + 1);
    assert.equal((await mixed.read()).debitOpenRials, 0n);

    const invalid = await seed(2, 1, 1);
    const foreign = await seed(1, 0, 1);
    const valid = group({ receiptId: invalid.receipts[0] }, invalid.debts[0]);
    const total = () => Promise.all([f.db.accountingSettlementAllocation.count(), f.db.accountingLedgerVoucher.count(),
      f.db.accountingCustomerCommand.count()]);
    const baseline = await total();
    const cases = [
      { command: { ...valid, periodId: key() }, code: 'INVALID_ACCOUNTING_CONTEXT' },
      { command: { ...valid, postingRuleId: key() }, code: 'INVALID_ACCOUNTING_CONTEXT' },
      { command: { ...valid, sourceAllocations: [...valid.sourceAllocations,
        { receiptId: foreign.receipts[0], allocations: [{ openItemId: invalid.debts[1], amountRials: '1' }] }] }, code: 'RECEIPT_NOT_FOUND' },
      { command: { ...valid, sourceAllocations: [...valid.sourceAllocations,
        { creditItemId: invalid.credits[0], allocations: [{ openItemId: invalid.debts[1], amountRials: '2' }] }] }, code: 'CREDIT_OVER_ALLOCATED' },
    ];
    for (const invalidCase of cases) {
      const command = { ...invalidCase.command, idempotencyKey: key() };
      const prepared = await send(invalid.customer, reserve, command);
      assert.equal(prepared.status, 200, JSON.stringify(prepared));
      const rejected = await send(invalid.customer, '', command);
      assert.equal(rejected.code, invalidCase.code, JSON.stringify(rejected));
      assert.deepEqual(await total(), baseline);
      assert.deepEqual((await send(invalid.customer, `${reserve}/cancel`, command)).data, { status: 'CANCELED' });
    }
    const account = await invalid.read();
    assert.equal(account.debitOpenRials, 2n);
    assert.equal(account.standaloneCreditRials, 1n);
    const audit = await readHttp<{ valid: boolean; checkedEntries: number }>('/audit/verify');
    assert.equal(audit.valid, true);
    assert.ok(audit.checkedEntries > 0);
  } finally {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      await db?.$disconnect();
    }
  }
}

async function main() {
  const adminUrl = new URL(process.env.ALLOCATION_HTTP_ADMIN_DATABASE_URL ?? '');
  const runtimeUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(adminUrl.host));
  assert.match(adminUrl.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  assert.equal(runtimeUrl.host, adminUrl.host);
  assert.equal(runtimeUrl.pathname, adminUrl.pathname);
  assert.equal(runtimeUrl.username, 'sabalan_application_runtime');
  const fixture = JSON.parse(process.env.ALLOCATION_HTTP_FIXTURE ?? '') as Seed;
  const db = new PrismaClient({ datasources: { db: { url: adminUrl.href } } });
  try {
    await verifyAllocationHttpRaces(process.env.ALLOCATION_HTTP_BUILD ?? '', { ...fixture, db });
  } finally {
    await db.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });