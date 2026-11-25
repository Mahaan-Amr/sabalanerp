import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import type { CustomerAccountOperation } from '../accountingCustomerWorkspace';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('Sepidar customer opening posts only the matched remainder to clearing under simulated admission', { skip: !url, timeout: 240_000 }, async () => {
  const require = createRequire(path.resolve(process.cwd(), 'src/services/__tests__/sepidarCustomerOpening.integration.test.ts'));
  const admissionPath = require.resolve('../sepidarCustomerOpeningAdmission');
  const admission = require(admissionPath) as typeof import('../sepidarCustomerOpeningAdmission');
  const entry = require.cache[admissionPath]!;
  type Approval = Parameters<typeof admission.requireSepidarCustomerOpeningWithin>[1];
  let approval: Approval | undefined;
  let admittedTarget: Omit<Approval, 'commandHash'> | undefined;
  const attempted: Approval[] = [];
  // Substitute release admission in this process, keeping all ledger and workspace persistence real.
  entry.exports = { ...admission, requireSepidarCustomerOpeningWithin: async (tx: Prisma.TransactionClient, request: Approval) => {
    attempted.push(request);
    const { commandHash, ...target } = request;
    if (approval && commandHash === approval.commandHash) {
      assert.deepEqual(target, admittedTarget);
      return;
    }
    return admission.requireSepidarCustomerOpeningWithin(tx, request);
  } };
  try {
    const { customerFinanceFixture } = require('./customerFinanceFixture') as typeof import('./customerFinanceFixture');
    const { createAccountingLedgerAdministration } = require('../accountingLedgerAdministration') as typeof import('../accountingLedgerAdministration');
    const { ensureCustomerWorkspaceProfile, readCustomerWorkspace, recordCustomerAccountOperation } = require('../accountingCustomerWorkspace') as typeof import('../accountingCustomerWorkspace');
    const { listPostedTrialBalance } = require('../accountingLedgerPrismaRepository') as typeof import('../accountingLedgerPrismaRepository');
    const fixture = await customerFinanceFixture(url!);
    try {
      const customer = await fixture.customer();
      const clearing = await createAccountingLedgerAdministration(fixture.db).createAccount({
        bookId: fixture.book.id, codeSchemeId: fixture.book.codeSchemes[0].id, code: '101002', titlePersian: 'واسط انتقال افتتاحیه',
        level: 'MOIN', normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', parentId: fixture.receivable.parentId!,
        effectiveFrom: fixture.year.startsAt, actorId: fixture.actor.id,
      });
      const read = (id = customer) => readCustomerWorkspace(fixture.db, { id, asOf: new Date(), userId: fixture.actor.id, openingBasisAt: fixture.common.occurredAt });
      const existing = await recordCustomerAccountOperation(fixture.db, customer, {
        ...fixture.common, kind: 'DEBIT', amountRials: 30n, idempotencyKey: randomUUID(),
      });
      const before = await read();
      const opening: CustomerAccountOperation = {
        ...fixture.common, kind: 'OPENING', amountRials: 100n, counterAccountId: clearing.id, idempotencyKey: randomUUID(),
        openingReview: {
          expectedSnapshotHash: before.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true,
          sepidarEvidence: { sourcePackageHash: 'a'.repeat(64), sourceCustomerId: '1', sourceVoucherItemId: '7' },
          lines: [{ key: 'start', kind: 'RECEIVABLE', amountRials: 100n, reference: 'Reviewed invoice remainder', existingSourceIds: before.openingSources.map(item => item.id) }],
        },
      };
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, opening), { code: 'SEPIDAR_CUSTOMER_OPENING_CLOSED' });
      assert.equal((await read()).netBalanceRials, 30n);
      admittedTarget = {
        ...opening.openingReview!.sepidarEvidence!, bookId: fixture.book.id, profileId: existing.profileId, actorId: fixture.actor.id,
        occurredAt: opening.occurredAt, counterAccountId: clearing.id, idempotencyKey: opening.idempotencyKey,
      };
      approval = { ...admittedTarget, commandHash: attempted[0].commandHash };
      assert.match(approval.commandHash, /^[0-9a-f]{64}$/);
      const groupedCalls = attempted.length;
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, {
        ...opening, openingReview: { ...opening.openingReview!, sepidarEvidence: undefined },
      }), { code: 'CUSTOMER_SOURCE_SHARES_CLOSED' });
      assert.equal(attempted.length, groupedCalls);
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, {
        ...opening, reference: 'Different import evidence',
      }), { code: 'SEPIDAR_CUSTOMER_OPENING_CLOSED' });
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, {
        ...opening, counterAccountId: fixture.counter.id,
      }), { code: 'SEPIDAR_CLEARING_ACCOUNT_INVALID' });
      // This test owns the temporary database. The protected admission suite
      // exercises the real trigger and controller; all workspace writes here
      // continue to use real PostgreSQL, ledgers and immutable reviews.
      await fixture.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS sepidar_opening_review_requires_admission ON public.accounting_customer_opening_reviews');
      const [result, concurrent] = await Promise.all([
        recordCustomerAccountOperation(fixture.db, customer, opening), recordCustomerAccountOperation(fixture.db, customer, opening),
      ]);
      assert.deepEqual(concurrent, result);
      approval = undefined;
      assert.deepEqual(await recordCustomerAccountOperation(fixture.db, existing.profileId, opening), result);
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, { ...opening, amountRials: 101n }), { code: 'IDEMPOTENCY_KEY_REUSED' });
      await assert.rejects(recordCustomerAccountOperation(fixture.db, customer, { ...opening, actor: { ...opening.actor, id: 'another-accountant' } }), { code: 'IDEMPOTENCY_KEY_REUSED' });
      const after = await read();
      assert.equal(after.netBalanceRials, 100n);
      assert.equal(after.openingReview?.transferRials.toString(), '70');
      assert.deepEqual(after.openItems.map(item => item.originalRials).sort(), [30n, 70n]);
      const trial = await listPostedTrialBalance(fixture.db, { bookId: fixture.book.id, fiscalYearId: fixture.year.id });
      assert.equal(trial.find(row => row.accountId === clearing.id)?.creditRials.toString(), '70');
      assert.equal(trial.find(row => row.accountId === fixture.receivable.id)?.debitRials.toString(), '100');

      const otherCustomer = await fixture.customer();
      const otherProfile = await ensureCustomerWorkspaceProfile(fixture.db, otherCustomer, fixture.actor, opening.occurredAt);
      const other = await read(otherCustomer);
      const duplicateSource = { ...opening.openingReview!.sepidarEvidence!, sourcePackageHash: 'b'.repeat(64), sourceCustomerId: '2' };
      const duplicate: CustomerAccountOperation = { ...opening, amountRials: 0n, idempotencyKey: randomUUID(), openingReview: {
        expectedSnapshotHash: other.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true, sepidarEvidence: duplicateSource,
        lines: [{ key: 'zero', kind: 'RECEIVABLE', amountRials: 0n, reference: 'Confirmed zero remainder', existingSourceIds: [] }],
      } };
      await assert.rejects(recordCustomerAccountOperation(fixture.db, otherCustomer, duplicate), { code: 'SEPIDAR_CUSTOMER_OPENING_CLOSED' });
      admittedTarget = { ...admittedTarget, ...duplicateSource, profileId: otherProfile.id, idempotencyKey: duplicate.idempotencyKey };
      approval = { ...admittedTarget, commandHash: attempted.at(-1)!.commandHash };
      await assert.rejects(recordCustomerAccountOperation(fixture.db, otherCustomer, duplicate), { code: 'SEPIDAR_OPENING_SOURCE_ALREADY_RECORDED' });
      assert.equal((await read(otherCustomer)).openingReview, null);

      approval = undefined;
      const zeroSource = { ...duplicateSource, sourceVoucherItemId: '8' };
      const zero = { ...duplicate, openingReview: { ...duplicate.openingReview!, sepidarEvidence: zeroSource } };
      await assert.rejects(recordCustomerAccountOperation(fixture.db, otherCustomer, zero), { code: 'SEPIDAR_CUSTOMER_OPENING_CLOSED' });
      admittedTarget = { ...admittedTarget, ...zeroSource };
      approval = { ...admittedTarget, commandHash: attempted.at(-1)!.commandHash };
      assert.equal((await recordCustomerAccountOperation(fixture.db, otherCustomer, zero)).voucherId, null);
      assert.equal((await read(otherCustomer)).openingReview?.transferRials.toString(), '0');
      assert.deepEqual(await listPostedTrialBalance(fixture.db, { bookId: fixture.book.id, fiscalYearId: fixture.year.id }), trial);
    } finally { await fixture.close(); }
  } finally { entry.exports = admission; }
});
