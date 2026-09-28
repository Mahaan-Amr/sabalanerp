/** All synthetic event, mapping and comparison rows roll back; they prove no real parallel month. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from '../accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from '../accountingLedgerPrismaRepository';
import { recordAccountingParallelComparison } from '../accountingParallelComparisonPrisma';
import { manageAccountingParallelDifference } from '../accountingParallelDifferences';
import { parseSepidarLocalDateTime } from '../sepidarCalendar';

const databaseUrl = process.env.ACCOUNTING_PARALLEL_TEST_DATABASE_URL;
const rollback = new Error('ROLLBACK_ACCOUNTING_PARALLEL_QA');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('independent native posting compares against archived source, retains disagreements and replays without duplicate report or audit', { skip: !databaseUrl }, async () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const bookId = 'cmub2hd63007zrqlphrzi5eey'; const tag = `QA-PARALLEL-${randomUUID()}`;
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      const year = await tx.accountingFiscalYear.findUniqueOrThrow({ where: { bookId_code: { bookId, code: '1405' } }, include: { periods: true } });
      const date = parseSepidarLocalDateTime('2026-03-21T00:00:00');
      const period = year.periods.find((item) => item.status === 'OPEN' && item.startsAt <= date && item.endsAt >= date); assert.ok(period);
      const accounts = await tx.accountingLedgerAccount.findMany({ where: { bookId, level: 'MOIN', retiredAt: null,
        effectiveFrom: { lte: date }, effectiveTo: null, partyRequirement: { not: 'REQUIRED' }, financialAccountRequirement: { not: 'REQUIRED' },
        dimensionRules: { none: { requirement: 'REQUIRED' } } }, orderBy: { code: 'asc' }, take: 2 }); assert.equal(accounts.length, 2);
      const snapshotId = randomUUID();
      const source = { Version: 1, Number: 1, Date: '2026-03-21T00:00:00', Description: tag };
      const lines = [
        { VoucherRef: 1, RowNumber: 1, AccountSLRef: 11, Debit: '101.0000', Credit: '0.0000' },
        { VoucherRef: 1, RowNumber: 2, AccountSLRef: 12, Debit: '0.0000', Credit: '101.0000' },
      ];
      const records = [
        { sourceTable: 'ACC.Voucher', sourceKey: '1', payload: source },
        ...lines.map((payload, index) => ({ sourceTable: 'ACC.VoucherItem', sourceKey: String(index + 1), payload })),
        ...accounts.map((account, index) => ({ sourceTable: 'ACC.Account', sourceKey: String(index + 11), payload: { Code: account.code, Title: tag } })),
      ];
      await tx.accountingSepidarSourceSnapshot.create({ data: { id: snapshotId, bookId, sourcePackageHash: hash(tag), sourceDatabase: 'SYNTHETIC_QA_NOT_SEPIDAR', schemaManifestHash: hash(records),
        schemaManifest: [], sourceMetadata: { syntheticRegressionOnly: true, exportFormat: 'sepidar-source-jsonl-v1' }, tableCount: 3,
        expectedRecordCount: records.length, importedRecordCount: records.length, status: 'COMPLETE', completedAt: new Date() } });
      await tx.accountingSepidarSourceRecord.createMany({ data: records.map((row) => ({ ...row, id: randomUUID(), snapshotId,
        sourceHash: hash(row.payload), payload: row.payload as Prisma.InputJsonValue, searchText: tag })) });
      for (const [index, account] of accounts.entries()) {
        const row = records.find((item) => item.sourceTable === 'ACC.Account' && item.sourceKey === String(index + 11))!;
        await tx.accountingSepidarTargetLink.create({ data: { id: randomUUID(), bookId, sourceTable: row.sourceTable, sourceKey: row.sourceKey, sourceHash: hash(row.payload),
          firstSnapshotId: snapshotId, latestSnapshotId: snapshotId, targetKind: 'LEDGER_ACCOUNT', targetId: account.id, mappingVersion: 1,
          reviewStatus: 'USER_APPROVED', reviewedBy: tag, reviewEvidence: snapshotId } });
      }
      const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `${tag}:${randomUUID()}` });
      const draft = await ledger.createManualDraft({ bookId, fiscalYearId: year.id, periodId: period.id, idempotencyKey: tag, correlationId: tag,
        description: tag, documentDate: date, occurredAt: date, actor: { id: tag, profile: 'ACCOUNTING_MANAGER' },
        source: { type: 'QA_NATIVE_RECEIPT', id: tag, version: 1, hash: hashAccountingEvidence({ event: tag }), payload: { event: tag } },
        lines: accounts.map((account, index) => ({ accountId: account.id, debitRials: index === 0 ? 101n : 0n, creditRials: index === 1 ? 101n : 0n,
          dimensions: [], rawAmountBeforeRounding: '101', roundingRuleVersion: IRR_ROUNDING_RULE_V1,
          evidence: { type: 'QA_NATIVE_EVENT', id: `${tag}:${index}`, version: 1, hash: hashAccountingEvidence({ event: tag, index }), payload: { event: tag, index } } })),
      });
      await ledger.postVoucher({ voucherId: draft.id, actor: { id: tag, profile: 'ACCOUNTING_MANAGER' }, reason: 'آزمون بازگشت‌پذیر سند مستقل' });
      const command = { bookId, periodId: period.id, snapshotId, actorId: tag, pair: { sourceKey: '1', targetId: draft.id, reason: 'دو شاهد مصنوعی یک رویداد آزمون' } };
      const unmatched = await recordAccountingParallelComparison(tx, { ...command, pair: undefined });
      const difference = unmatched.differences.find((item) => item.code === 'SOURCE_UNMATCHED' && item.sourceKey === '1')!;
      const caseCommand = { bookId, comparisonId: unmatched.id, differenceIdentity: difference.identity, actorId: tag };
      const opened = await manageAccountingParallelDifference(tx, { ...caseCommand, action: 'OPEN' });
      assert.equal(opened.assignedUserId, tag);
      assert.equal((await manageAccountingParallelDifference(tx, { ...caseCommand, action: 'OPEN' })).id, opened.id);
      assert.equal((await manageAccountingParallelDifference(tx, { ...caseCommand, actorId: `${tag}:other-manager`, action: 'OPEN' })).assignedUserId, tag);
      await assert.rejects(manageAccountingParallelDifference(tx, { ...caseCommand, action: 'RESOLVE', cause: 'پیوند ثبت نشده', resolution: 'ادعای رفع بدون اصلاح' }),
        (error: unknown) => (error as { code?: string }).code === 'PARALLEL_DIFFERENCE_STILL_PRESENT');
      const noted = await manageAccountingParallelDifference(tx, { ...caseCommand, actorId: `${tag}:other-manager`, action: 'NOTE', cause: 'پیوند ثبت نشده', resolution: 'بررسی شاهد و پیوند رویداد' });
      assert.equal(noted.status, 'IN_PROGRESS');
      assert.equal(noted.assignedUserId, tag);
      const noteAuditCount = await tx.accountingReplacementAuditEntry.count();
      const noteRetry = await manageAccountingParallelDifference(tx, { ...caseCommand, actorId: `${tag}:other-manager`, action: 'NOTE', cause: 'پیوند ثبت نشده', resolution: 'بررسی شاهد و پیوند رویداد' });
      assert.deepEqual(noteRetry.resolutionEvidence, noted.resolutionEvidence);
      assert.equal(await tx.accountingReplacementAuditEntry.count(), noteAuditCount);
      await tx.accountingSepidarTargetLink.updateMany({ where: { latestSnapshotId: snapshotId, sourceKey: '11' }, data: { reviewStatus: 'PROPOSED' } });
      const unmapped = await recordAccountingParallelComparison(tx, { ...command, pair: undefined });
      const mappingDifference = unmapped.differences.find((item) => item.code === 'SOURCE_MAPPING_MISSING')!;
      const mappingCase = { ...caseCommand, comparisonId: unmapped.id, differenceIdentity: mappingDifference.identity };
      await manageAccountingParallelDifference(tx, { ...mappingCase, action: 'OPEN' });
      await recordAccountingParallelComparison(tx, command);
      await assert.rejects(manageAccountingParallelDifference(tx, { ...mappingCase, action: 'RESOLVE', cause: 'نگاشت تأیید نشده', resolution: 'فقط ثبت پیوند' }),
        (error: unknown) => (error as { code?: string }).code === 'PARALLEL_DIFFERENCE_STILL_PRESENT');
      await tx.accountingSepidarTargetLink.updateMany({ where: { latestSnapshotId: snapshotId, sourceKey: '11' }, data: { reviewStatus: 'USER_APPROVED' } });
      const first = await recordAccountingParallelComparison(tx, command);
      assert.equal(first.acceptedPeriod, false); assert.equal(first.sourceCount, 1);
      assert.equal(first.differences.filter((item) => item.sourceKey === '1').length, 0);
      const audits = await tx.accountingReplacementAuditEntry.count();
      const reportCount = await tx.accountingOperationalReconciliation.count({ where: { sourceSystem: snapshotId } });
      const retry = await recordAccountingParallelComparison(tx, command);
      assert.equal(first.id, retry.id); assert.equal(first.outputHash, retry.outputHash);
      assert.equal(await tx.accountingReplacementAuditEntry.count(), audits);
      assert.equal(await tx.accountingOperationalReconciliation.count({ where: { sourceSystem: snapshotId } }), reportCount);
      assert.equal((await manageAccountingParallelDifference(tx, { ...mappingCase, action: 'RESOLVE', cause: 'نگاشت تأیید نشده', resolution: 'تأیید نگاشت و مقایسهٔ دقیق' })).status, 'RESOLVED');
      const resolved = await manageAccountingParallelDifference(tx, { ...caseCommand, action: 'RESOLVE', cause: 'پیوند ثبت نشده', resolution: 'ثبت پیوند با شاهد یکسان' });
      assert.equal(resolved.status, 'RESOLVED');
      assert.equal((resolved.resolutionEvidence as { correction: { id: string } }).correction.id, first.id);
      const resolvedAuditCount = await tx.accountingReplacementAuditEntry.count();
      await manageAccountingParallelDifference(tx, { ...caseCommand, action: 'RESOLVE', cause: 'پیوند ثبت نشده', resolution: 'ثبت پیوند با شاهد یکسان' });
      assert.equal(await tx.accountingReplacementAuditEntry.count(), resolvedAuditCount);
      await assert.rejects(manageAccountingParallelDifference(tx, { ...caseCommand, action: 'NOTE', cause: 'بازنویسی', resolution: 'تغییر شاهد قبلی' }),
        (error: unknown) => (error as { code?: string }).code === 'PARALLEL_RESOLUTION_IMMUTABLE');
      const secondPayload = { event: `${tag}:second` };
      const second = await ledger.createManualDraft({ bookId, fiscalYearId: year.id, periodId: period.id, idempotencyKey: `${tag}:second`, correlationId: tag,
        description: tag, documentDate: date, occurredAt: date, actor: { id: tag, profile: 'ACCOUNTING_MANAGER' },
        source: { type: 'QA_NATIVE_RECEIPT', id: `${tag}:second`, version: 1, hash: hashAccountingEvidence(secondPayload), payload: secondPayload },
        lines: accounts.map((account, index) => ({ accountId: account.id, debitRials: index === 0 ? 101n : 0n, creditRials: index === 1 ? 101n : 0n,
          dimensions: [], rawAmountBeforeRounding: '101', roundingRuleVersion: IRR_ROUNDING_RULE_V1,
          evidence: { type: 'QA_NATIVE_EVENT', id: `${tag}:second:${index}`, version: 1, hash: hashAccountingEvidence(secondPayload), payload: secondPayload } })),
      });
      await ledger.postVoucher({ voucherId: second.id, actor: { id: tag, profile: 'ACCOUNTING_MANAGER' }, reason: 'آزمون اصلاح پیوند' });
      const a = await recordAccountingParallelComparison(tx, command);
      const b = await recordAccountingParallelComparison(tx, { ...command, pair: { ...command.pair, targetId: second.id, reason: 'اصلاح شاهد مقصد' } });
      const aAgain = await recordAccountingParallelComparison(tx, command);
      assert.notEqual(a.id, b.id); assert.notEqual(a.id, aAgain.id); assert.notEqual(b.id, aAgain.id);
      assert.equal(a.outputHash, aAgain.outputHash);
      const resumed = await recordAccountingParallelComparison(tx, { ...command, pair: undefined });
      assert.equal(resumed.id, aAgain.id);
      assert.equal(resumed.pairs[0].targetId, draft.id);
      const foreignPeriod = year.periods.find((item) => item.id !== period.id); assert.ok(foreignPeriod);
      await assert.rejects(recordAccountingParallelComparison(tx, { ...command, periodId: foreignPeriod.id }), (error: unknown) => (error as { code?: string }).code === 'PARALLEL_PAIR_INVALID');
      throw rollback;
    }, { timeout: 180_000, maxWait: 20_000 }), (error) => error === rollback);
    assert.equal(await db.accountingLedgerVoucher.count({ where: { idempotencyKey: tag } }), 0);
  } finally { await db.$disconnect(); }
});
