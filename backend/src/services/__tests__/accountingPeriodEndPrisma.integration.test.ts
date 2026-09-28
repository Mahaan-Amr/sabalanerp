import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import { createAccountingPeriodEndApplication, hashPeriodEndEvidence } from '../accountingPeriodEnd';
import { createOfficialAccountingSnapshot, createAccountingPeriodEndPrismaRepository } from '../accountingPeriodEndPrismaRepository';

const rollback = Symbol('rollback');

test('ready-for-use evidence posts once and persists immutable asset lineage in PostgreSQL', async () => {
  await assert.rejects(() => prisma.$transaction(async (tx) => {
    const suffix = randomUUID();
    const entity = await tx.accountingLegalEntity.create({ data: {
      code: `period-end-${suffix}`, namePersian: 'شرکت آزمون پایان دوره', activeFrom: new Date('2026-01-01'), createdBy: 'integration-test',
    } });
    const book = await tx.accountingBook.create({ data: {
      legalEntityId: entity.id, code: 'primary', namePersian: 'دفتر اصلی آزمون', createdBy: 'integration-test',
    } });
    const fiscalYear = await tx.accountingFiscalYear.create({ data: {
      bookId: book.id, code: '1405', titlePersian: 'سال مالی آزمون', startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-12-31T23:59:59.999Z'), status: 'ACTIVE', createdBy: 'integration-test',
    } });
    const period = await tx.accountingPostingPeriod.create({ data: {
      fiscalYearId: fiscalYear.id, code: '09', titlePersian: 'دوره آزمون', sequence: 1,
      startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30T23:59:59.999Z'), status: 'OPEN',
    } });
    const scheme = await tx.accountingCodeScheme.create({ data: {
      bookId: book.id, version: 1, effectiveFrom: new Date('2026-01-01'), groupLength: 1, kolLength: 2, moinLength: 3, createdBy: 'integration-test',
    } });
    const assetAccount = await tx.accountingLedgerAccount.create({ data: {
      bookId: book.id, codeSchemeId: scheme.id, code: '110101', titlePersian: 'دارایی ثابت', level: 'MOIN',
      normalSide: 'DEBIT', statementRole: 'ASSET', effectiveFrom: new Date('2026-01-01'), createdBy: 'integration-test',
    } });
    const cipAccount = await tx.accountingLedgerAccount.create({ data: {
      bookId: book.id, codeSchemeId: scheme.id, code: '110102', titlePersian: 'دارایی در جریان تکمیل', level: 'MOIN',
      normalSide: 'DEBIT', statementRole: 'ASSET', effectiveFrom: new Date('2026-01-01'), createdBy: 'integration-test',
    } });
    const policy = await tx.accountingAssetClassPolicy.create({ data: {
      bookId: book.id, classCode: 'MACHINE', version: 1, titlePersian: 'ماشین‌آلات', effectiveFrom: new Date('2026-01-01'),
      capitalizationThresholdRials: '1000', bookMethod: 'STRAIGHT_LINE', taxMethod: 'DECLINING_BALANCE', usefulLifeMonths: 60,
      assetAccountId: assetAccount.id, cipAccountId: cipAccount.id, depreciationExpenseAccountId: assetAccount.id,
      accumulatedDepreciationAccountId: cipAccount.id, impairmentExpenseAccountId: assetAccount.id,
      impairmentAllowanceAccountId: cipAccount.id, disposalGainAccountId: assetAccount.id, disposalLossAccountId: cipAccount.id,
      createdBy: 'integration-test',
    } });
    const asset = await tx.accountingFixedAsset.create({ data: {
      bookId: book.id, registerNumber: `asset-${suffix}`, classPolicyId: policy.id, titlePersian: 'دستگاه آزمون',
      acquisitionAt: new Date('2026-09-01'), status: 'UNDER_CONSTRUCTION', bookCostRials: '120000', taxCostRials: '100000',
      createdBy: 'integration-test', components: { create: [
        { componentIdentity: 'body', titlePersian: 'بدنه', bookCostRials: '90000', taxCostRials: '75000', residualValueRials: '10000', usefulLifeMonths: 120, bookMethod: 'STRAIGHT_LINE', taxMethod: 'DECLINING_BALANCE' },
        { componentIdentity: 'motor', titlePersian: 'موتور', bookCostRials: '30000', taxCostRials: '25000', residualValueRials: '0', usefulLifeMonths: 60, bookMethod: 'STRAIGHT_LINE', taxMethod: 'DECLINING_BALANCE' },
      ] },
    } });
    const unsigned = {
      kind: 'ASSET_READY_FOR_USE' as const, sourceId: `ready-${suffix}`, sourceVersion: 1,
      occurredAt: new Date('2026-09-21T08:00:00.000Z'), asset: {
        id: asset.id, registerNumber: asset.registerNumber, classPolicyVersionId: policy.id,
        readyForUseAt: new Date('2026-09-21T08:00:00.000Z'), costRials: 120_000n,
        assetAccountId: assetAccount.id, constructionInProgressAccountId: cipAccount.id,
        components: [
          { id: 'body', titlePersian: 'بدنه', costRials: 90_000n, usefulLifeMonths: 120, residualValueRials: 10_000n },
          { id: 'motor', titlePersian: 'موتور', costRials: 30_000n, usefulLifeMonths: 60, residualValueRials: 0n },
        ],
        bookMethod: 'STRAIGHT_LINE' as const,
        taxBasis: { costRials: 100_000n, method: 'DECLINING_BALANCE' as const, rateBasisPoints: 2_500 },
      },
    };
    const evidence = { ...unsigned, sourceHash: hashPeriodEndEvidence(unsigned) };
    const application = createAccountingPeriodEndApplication(createAccountingPeriodEndPrismaRepository(tx, true), { now: () => new Date('2026-09-21T12:00:00.000Z') });
    const command = { bookId: book.id, fiscalYearId: fiscalYear.id, periodId: period.id, actorId: 'integration-test', evidence };
    const first = await application.acceptEvidence(command);
    const retry = await application.acceptEvidence(command);

    assert.equal(first.kind, 'POSTED');
    assert.deepEqual(retry, first);
    assert.equal(await tx.accountingLedgerVoucher.count({ where: { sourceId: unsigned.sourceId } }), 1);
    assert.equal(await tx.accountingAssetEvent.count({ where: { assetId: asset.id, eventType: 'READY_FOR_USE' } }), 1);
    assert.equal((await tx.accountingFixedAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'ACTIVE');
    throw rollback;
  }), (error) => error === rollback);
});


test('official comparison retrieves prior-year postings without adding them to current opening balances', async () => {
  await assert.rejects(() => prisma.$transaction(async (tx) => {
    const suffix = randomUUID();
    const entity = await tx.accountingLegalEntity.create({ data: { code: 'report-' + suffix, namePersian: 'آزمون گزارش', activeFrom: new Date('2025-01-01'), createdBy: 'test' } });
    const book = await tx.accountingBook.create({ data: { legalEntityId: entity.id, code: 'primary', namePersian: 'دفتر آزمون گزارش', createdBy: 'test' } });
    const scheme = await tx.accountingCodeScheme.create({ data: { bookId: book.id, version: 1, effectiveFrom: new Date('2025-01-01'), groupLength: 1, kolLength: 2, moinLength: 3, createdBy: 'test' } });
    const accounts = await Promise.all(['111', '211'].map((code, index) => tx.accountingLedgerAccount.create({ data: { bookId: book.id, codeSchemeId: scheme.id, code, titlePersian: index ? 'سرمایه' : 'صندوق', level: 'MOIN', normalSide: index ? 'CREDIT' : 'DEBIT', statementRole: index ? 'EQUITY' : 'ASSET', effectiveFrom: new Date('2025-01-01'), createdBy: 'test' } })));
    const years: Array<{ id: string; startsAt: Date; endsAt: Date }> = [];
    for (const year of [2025, 2026]) {
      const fiscalYear = await tx.accountingFiscalYear.create({ data: { bookId: book.id, code: String(year), titlePersian: String(year), startsAt: new Date(year + '-01-01'), endsAt: new Date(year + '-12-31T23:59:59.999Z'), status: 'ACTIVE', createdBy: 'test' } });
      years.push(fiscalYear);
      const period = await tx.accountingPostingPeriod.create({ data: { fiscalYearId: fiscalYear.id, code: '01', titlePersian: 'دوره آزمون', sequence: 1, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, status: 'OPEN' } });
      for (const [index, amount] of (year === 2025 ? [40, 10] : [100, 20]).entries()) {
        const date = new Date(year + (index ? '-02-10' : '-01-10'));
        const identity = suffix + '-' + year + '-' + index;
        const voucher = await tx.accountingLedgerVoucher.create({ data: { bookId: book.id, fiscalYearId: fiscalYear.id, periodId: period.id, referenceNumber: identity, statutoryNumber: index + 1, idempotencyKey: identity, correlationId: identity, status: 'DRAFT', description: 'آزمون مقایسه', documentDate: date, occurredAt: date, recordedAt: date, postedAt: date, sourceType: 'REPORT_TEST', sourceId: identity, sourceVersion: 1, sourceHash: 'a'.repeat(64), sourcePayload: {}, debitTotalRials: amount, creditTotalRials: amount, contentHash: 'b'.repeat(64), createdBy: 'test', lines: { create: accounts.map((account, accountIndex) => ({ sequence: accountIndex + 1, accountId: account.id, debitRials: accountIndex ? 0 : amount, creditRials: accountIndex ? amount : 0, evidenceType: 'REPORT_TEST', evidenceId: identity, evidenceVersion: 1, evidenceHash: 'a'.repeat(64), evidencePayload: {} })) } } });
        await tx.accountingLedgerVoucher.update({ where: { id: voucher.id }, data: { status: 'POSTED' } });
      }
    }
    const mapping = await tx.accountingFinancialStatementMapping.create({ data: { bookId: book.id, version: 1, titlePersian: 'نگاشت آزمون', effectiveFrom: new Date('2024-01-01'), contentHash: 'c'.repeat(64), createdBy: 'test', rows: { create: accounts.map((account, index) => ({ accountId: account.id, statementType: 'FINANCIAL_POSITION', sectionCode: index ? 'equity' : 'cash' })) } } });
    const request = { reportKind: 'FINANCIAL_STATEMENT' as const, bookId: book.id, fiscalYearId: years[1].id, mappingVersionId: mapping.id, from: new Date('2026-02-01'), to: new Date('2026-02-28T23:59:59.999Z'), comparativeFrom: new Date('2025-02-01'), comparativeTo: new Date('2025-02-28T23:59:59.999Z'), cutoffAt: new Date('2026-09-28'), columns: 2 as const };
    const { dataset } = await createOfficialAccountingSnapshot(tx, { request, actorId: 'test' });
    const cash = dataset.rows.find((row) => row.key === 'FINANCIAL_POSITION:cash')!;
    const priorCash = dataset.comparative!.rows.find((row) => row.key === 'FINANCIAL_POSITION:cash')!;
    assert.equal(cash.amounts.openingDebit, 100n);
    assert.equal(cash.amounts.endingDebit, 120n);
    assert.equal(priorCash.amounts.openingDebit, 40n);
    assert.equal(priorCash.amounts.endingDebit, 50n);
    assert.equal(dataset.sourceLineIds.length, 8);
    assert.equal(new Set([...dataset.rows.flatMap((row) => row.drilldownLineIds), ...dataset.comparative!.rows.flatMap((row) => row.drilldownLineIds)]).size, 8);
    const missing = await createOfficialAccountingSnapshot(tx, { request: { ...request, comparativeFrom: new Date('2024-02-01'), comparativeTo: new Date('2024-02-28') }, actorId: 'test' });
    assert.equal(missing.dataset.comparative!.rows.length, 0);
    assert.equal(missing.dataset.rows.find((row) => row.key === 'FINANCIAL_POSITION:cash')!.amounts.endingDebit, 120n);
    throw rollback;
  }, { timeout: 30000 }), (error) => error === rollback);
});
