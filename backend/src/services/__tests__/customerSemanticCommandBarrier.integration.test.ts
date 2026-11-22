import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { allocateCustomerCreditPrisma, recordCustomerReceiptPrisma, createReceivableCheckPrisma } from '../accountingCustomerTreasuryPrisma';
import { customerCompoundCommandWithin } from '../accountingCustomerCommand';
import { recordCustomerReceiptPartsWithin } from '../accountingCustomerReceiptParts';
import { correctCustomerReceiptWithin } from '../accountingCustomerReceiptCorrection';
import { resolveCustomerReceiptWithin } from '../accountingCustomerReceiptResolution';
import { recordCustomerCheckBankWithin } from '../accountingCustomerCheckBank';
import { recordCustomerCheckEndorsementWithin } from '../accountingCustomerCheckEndorsement';
import { attributeCustomerOpening } from '../accountingCustomerOpeningAttribution';
import { recordCustomerAccountOperation, recordCustomerWorkspaceTreasury, readCustomerWorkspace } from '../accountingCustomerWorkspace';
import { customerFinanceData } from './customerFinanceFixture';

test('independent-credit command reports a closed capability before creating any financial evidence', async () => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432');
  assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const db = new PrismaClient();
  try {
    await assert.rejects(allocateCustomerCreditPrisma(db, {
      creditItemId: 'not-yet-read', allocations: [], bookId: 'not-yet-read', fiscalYearId: 'not-yet-read',
      periodId: 'not-yet-read', receivableLedgerId: 'not-yet-read', documentDate: new Date('2026-10-01'),
      reason: 'private compatibility acceptance', reference: 'private-qa', idempotencyKey: 'closed-command',
      correlationId: 'closed-command', actor: { id: 'private-qa', profile: 'ACCOUNTANT' },
    }), (error: any) => error.code === 'CUSTOMER_SOURCE_SHARES_CLOSED' && error.status === 409 && /به‌روزرسانی/.test(error.message));
    assert.equal(await db.accountingLedgerVoucher.count(), 0);
    assert.equal(await db.accountingTreasuryTransaction.count(), 0);
    assert.equal(await db.accountingSettlementAllocation.count(), 0);
    assert.equal(await db.accountingCustomerOpenItem.count(), 0);
  } finally { await db.$disconnect(); }
});

test('all new financial command owners reject before domain reads, callbacks or idempotent returns', async t => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432');
  assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const db = new PrismaClient();
  const common = { profileId: 'not-yet-read', receiptId: 'not-yet-read', legalEntityId: 'not-yet-read',
    bookId: 'not-yet-read', fiscalYearId: 'not-yet-read', periodId: 'not-yet-read',
    financialAccountId: 'not-yet-read', customerAdvanceLedgerId: 'not-yet-read', receivableLedgerId: 'not-yet-read',
    occurredAt: new Date('2026-10-01'), amountRials: 100n, expectedAmountRials: 100n,
    reason: 'private compatibility acceptance', reference: 'private-qa', idempotencyKey: 'closed-command-owner',
    actor: { id: 'private-qa', profile: 'ACCOUNTANT' as const } };
  const closed = (error: any) => error.code === 'CUSTOMER_SOURCE_SHARES_CLOSED' && error.status === 409;
  let callbacks = 0;
  try {
    const operations: Array<[string, () => Promise<unknown>]> = [
      ['compound', () => db.$transaction(tx => customerCompoundCommandWithin(tx, { ...common, kind: 'RECEIPT', payload: {} },
        async () => { callbacks += 1; return {}; }))],
      ['parts', () => db.$transaction(tx => recordCustomerReceiptPartsWithin(tx, { ...common, parts: [] }))],
      ['correction', () => db.$transaction(tx => correctCustomerReceiptWithin(tx, { ...common, kind: 'CORRECT_RECEIPT', reversals: [] }))],
      ['resolution', () => db.$transaction(tx => resolveCustomerReceiptWithin(tx, { ...common, parts: [], shares: [] }))],
      ['check-bank', () => db.$transaction(tx => recordCustomerCheckBankWithin(tx, { ...common, kind: 'CHECK_SETTLE', unpaidRials: 0n,
        expectedSequence: 1, reversals: [], postingRuleVersion: 1 }))],
      ['check-endorsement', () => db.$transaction(tx => recordCustomerCheckEndorsementWithin(tx, { ...common, kind: 'CHECK_ENDORSE',
        expectedSequence: 1, allocations: [] }))],
      ['opening-attribution', () => attributeCustomerOpening(db, 'not-yet-read', { ...common, lineKey: 'line', expectedSequence: 0,
        expectedSnapshotHash: 'a'.repeat(64), confirmed: true })],
      ['opening-review', () => recordCustomerAccountOperation(db, 'not-yet-read', { ...common, kind: 'OPENING', postingRuleId: 'not-yet-read',
        confirmed: true, openingReview: { expectedSnapshotHash: 'a'.repeat(64), identityConfirmed: true, totalConfirmed: true, lines: [] } })],
      ['workspace-new-command', () => recordCustomerWorkspaceTreasury(db, 'not-yet-read', { ...common, kind: 'CHECK_SETTLE',
        postingRuleId: 'not-yet-read', confirmed: true, allocations: [] })],
      ['cash-component', () => recordCustomerReceiptPrisma(db, { ...common, bankAccountLedgerId: 'not-yet-read', componentKind: 'CASH',
        source: { type: 'CUSTOMER_ACCOUNT_RECEIPT', id: 'private-qa', version: 1, payload: {} }, correlationId: 'private-qa' })],
      ['grouped-bank-component', () => recordCustomerReceiptPrisma(db, { ...common, bankAccountLedgerId: 'not-yet-read', receiptGroupId: 'private-group',
        source: { type: 'CUSTOMER_ACCOUNT_RECEIPT', id: 'private-qa', version: 1, payload: {} }, correlationId: 'private-qa' })],
    ];
    for (const [name, operation] of operations) await t.test(name, async () => { await assert.rejects(operation(), closed); });
    assert.equal(callbacks, 0);
    assert.equal(await db.accountingLedgerVoucher.count(), 0);
    assert.equal(await db.accountingTreasuryTransaction.count(), 0);
    assert.equal(await db.accountingCustomerOpenItem.count(), 0);
    assert.equal(await db.accountingCustomerCommand.count(), 0);
  } finally { await db.$disconnect(); }
});

test('closed barrier preserves ordinary bank receipt retry, allocation reversal and legacy independent-credit refund', async t => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432'); assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const db = new PrismaClient();
  let oldClient: any;
  try {
    const f = await customerFinanceData(db), id = await f.customer();
    await recordCustomerAccountOperation(db, id, { ...f.common, kind: 'DEBIT', amountRials: 200n, idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(db, id, { ...f.common, kind: 'CREDIT', amountRials: 80n, idempotencyKey: randomUUID() });
    const read = () => readCustomerWorkspace(db, { id, asOf: new Date(), userId: f.actor.id });
    const before = await read(), debt = before.openItems.find(row => row.kind === 'RECEIVABLE')!,
      credit = before.openItems.find(row => row.kind === 'CREDIT')!;
    const receiptCommand = { ...f.common, kind: 'RECEIPT' as const, amountRials: 150n, financialAccountId: f.financial.id,
      bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() };
    const receipt = await recordCustomerWorkspaceTreasury(db, id, receiptCommand);
    const identities = await db.accountingLedgerVoucher.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    assert.equal((await recordCustomerWorkspaceTreasury(db, id, receiptCommand)).id, receipt.id);
    assert.deepEqual(await db.accountingLedgerVoucher.findMany({ select: { id: true }, orderBy: { id: 'asc' } }), identities);
    const allocation = await recordCustomerWorkspaceTreasury(db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n,
      receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 100n }], idempotencyKey: randomUUID() });
    await recordCustomerWorkspaceTreasury(db, id, { ...f.common, kind: 'REVERSE_ALLOCATION', amountRials: 0n,
      allocationId: allocation.id, allocations: [], idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(db, id, { ...f.common, kind: 'REFUND', amountRials: 30n, creditItemId: credit.id,
      financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(db, id, { ...f.common, kind: 'REFUND', amountRials: 20n, receiptId: receipt.id,
      financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    const after = await read();
    // The reopened debt is 200. Independent credit remaining is 80-30=50;
    // net receivables are therefore 150. Bank cash left is 150-20=130.
    assert.equal(after.openItems.find(row => row.id === debt.id)!.remainingRials, 200n);
    assert.equal(after.openItems.find(row => row.id === credit.id)!.remainingRials, 50n);
    assert.equal(after.receivableRials, 150n); assert.equal(after.unallocatedCreditRials, 130n); assert.equal(after.netBalanceRials, 20n);
    assert.equal(await db.accountingSettlementAllocation.count({ where: { treasuryTransactionId: null } }), 0);
    assert.equal(await db.accountingCustomerReceiptAdjustment.count(), 0);
    assert.equal(await db.accountingCustomerCommand.count(), 0);
    const check = await createReceivableCheckPrisma(db, { profileId: after.profile!.id, legalEntityId: f.book.legalEntityId,
      serialNumber: 'legacy-compatible-check', bankName: 'آزمون', amountRials: 100n, dueAt: f.common.occurredAt,
      occurredAt: f.common.occurredAt, evidence: { kind: 'private-legacy-compatibility' }, actor: f.actor });
    await assert.rejects(db.accountingCheckInstrument.update({ where: { id: check.id }, data: { clearedRials: '1' } }), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    assert.equal((await db.accountingCheckInstrument.findUniqueOrThrow({ where: { id: check.id } })).clearedRials.toString(), '0');
    const partialRepresentations: Array<[string, (tx: Prisma.TransactionClient) => Promise<unknown>]> = [
      ['partial-status-insert', tx => tx.accountingCheckInstrument.create({ data: { ...check, id: randomUUID(),
        serialNumber: 'private-status-only', status: 'PARTIAL_SETTLED' } })],
      ['partial-status-transition', tx => tx.accountingCheckInstrument.update({ where: { id: check.id }, data: { status: 'PARTIAL_SETTLED' } })],
      ['partial-event-insert', tx => tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: check.id, sequence: 2,
        eventType: 'PARTIAL_SETTLED', occurredAt: f.common.occurredAt, actorId: f.actor.id, evidence: {}, evidenceHash: 'private-status-event' } })],
    ];
    for (const [name, operation] of partialRepresentations) await t.test(name, async () => {
      await assert.rejects(db.$transaction(async tx => {
        await operation(tx); throw new Error('UNEXPECTEDLY_ALLOWED_PARTIAL_CHECK_REPRESENTATION');
      }), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    });
    assert.equal((await db.accountingCheckInstrument.findUniqueOrThrow({ where: { id: check.id } })).status, 'RECEIVED');

    const directory = process.env.CUSTOMER_SEMANTIC_OLD_CLIENT_DIRECTORY!;
    assert.equal(path.basename(directory), 'production-425-overlap-20261018');
    const oldModule = createRequire(path.join(directory, 'package.json'))(directory);
    assert.equal(oldModule.Prisma.prismaVersion.client, '5.22.0');
    const oldUrl = new URL(url.href); oldUrl.searchParams.set('application_name', 'private-425-closed-barrier-reader');
    oldClient = new oldModule.PrismaClient({ datasources: { db: { url: oldUrl.href } } });
    const oldAllocations = await oldClient.accountingSettlementAllocation.findMany({ include: { lines: true, transaction: true }, orderBy: { id: 'asc' } });
    assert.equal(oldAllocations.length, 3);
    assert.ok(oldAllocations.every((row: any) => typeof row.treasuryTransactionId === 'string' && row.transaction.id === row.treasuryTransactionId));
    assert.deepEqual(oldAllocations.map((row: any) => row.id), (await db.accountingSettlementAllocation.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(row => row.id));
    const oldRefunds = await oldClient.accountingTreasuryTransaction.findMany({ where: { kind: 'CUSTOMER_REFUND' } });
    assert.equal(oldRefunds.length, 2);
    assert.equal(oldRefunds.reduce((sum: bigint, row: any) => sum + BigInt(row.amountRials.toString()), 0n), 50n);
  } finally { try { await oldClient?.$disconnect(); } finally { await db.$disconnect(); } }
});
