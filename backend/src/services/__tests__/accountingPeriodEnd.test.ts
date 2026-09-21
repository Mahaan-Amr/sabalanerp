import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOfficialAccountingDataset,
  buildTAccountProjection,
  applyPayrollSettlementAttempt,
  calculateAssetDepreciation,
  createAccountingPeriodEndApplication,
  hashPeriodEndEvidence,
  type PeriodEndRepository,
  type PeriodEndResult,
} from '../accountingPeriodEnd';

const now = new Date('2026-09-21T12:00:00.000Z');

const createRepository = (): PeriodEndRepository & { results: Map<string, PeriodEndResult>; posts: any[] } => {
  const results = new Map<string, PeriodEndResult>();
  const posts: any[] = [];
  const repository: PeriodEndRepository & { results: Map<string, PeriodEndResult>; posts: any[] } = {
    results,
    posts,
    transaction: async (operation) => operation(repository),
    findResult: async (identity) => results.get(identity) ?? null,
    postVoucher: async (voucher) => {
      posts.push(voucher);
      return { voucherId: `voucher-${posts.length}`, statutoryNumber: posts.length };
    },
    saveResult: async (identity, result) => {
      results.set(identity, result);
      return result;
    },
  };
  return repository;
};

test('ready-for-use asset evidence capitalizes components while payment alone fails closed', async () => {
  const repository = createRepository();
  const application = createAccountingPeriodEndApplication(repository, { now: () => now });
  const source = {
    kind: 'ASSET_READY_FOR_USE' as const,
    sourceId: 'asset-event-1',
    sourceVersion: 1,
    occurredAt: new Date('2026-09-20T08:00:00.000Z'),
    asset: {
      id: 'asset-1', registerNumber: 'دارایی-۰۰۱', classPolicyVersionId: 'policy-1',
      readyForUseAt: new Date('2026-09-20T08:00:00.000Z'), costRials: 120_000n,
      assetAccountId: 'fixed-asset', constructionInProgressAccountId: 'cip',
      components: [
        { id: 'component-body', titlePersian: 'بدنه', costRials: 90_000n, usefulLifeMonths: 120, residualValueRials: 10_000n },
        { id: 'component-motor', titlePersian: 'موتور', costRials: 30_000n, usefulLifeMonths: 60, residualValueRials: 0n },
      ],
      bookMethod: 'STRAIGHT_LINE' as const,
      taxBasis: { costRials: 100_000n, method: 'DECLINING_BALANCE' as const, rateBasisPoints: 2_500 },
    },
  };
  const evidence = { ...source, sourceHash: hashPeriodEndEvidence(source) };

  const posted = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence,
  });
  const retry = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence,
  });

  assert.equal(posted.kind, 'POSTED');
  assert.deepEqual(retry, posted);
  assert.equal(repository.posts.length, 1);
  assert.equal(repository.posts[0].lines[0].debitRials, 120_000n);
  assert.equal(repository.posts[0].lines[1].creditRials, 120_000n);
  assert.equal(repository.posts[0].sourcePayload.asset.taxBasis.costRials, 100_000n);

  const paymentSource = {
    kind: 'ASSET_PAYMENT' as const, sourceId: 'payment-1', sourceVersion: 1,
    occurredAt: now, assetId: 'asset-1', amountRials: 120_000n,
  };
  const rejected = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1',
    evidence: { ...paymentSource, sourceHash: hashPeriodEndEvidence(paymentSource) },
  });
  assert.equal(rejected.kind, 'EXCEPTION');
  if (rejected.kind === 'EXCEPTION') assert.equal(rejected.code, 'ASSET_NOT_READY_FOR_USE');
  assert.equal(repository.posts.length, 1);
});

test('component depreciation posts the book charge while tax basis remains analytical', () => {
  const calculation = calculateAssetDepreciation({
    assetId: 'asset-1', periodIdentity: '1405-06',
    readyForUseAt: new Date('2026-08-01T00:00:00.000Z'),
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T23:59:59.999Z'),
    accumulatedBookDepreciationRials: 0n,
    accumulatedTaxDepreciationRials: 0n,
    depreciationExpenseAccountId: 'depreciation-expense',
    accumulatedDepreciationAccountId: 'accumulated-depreciation',
    components: [
      { id: 'body', costRials: 90_000n, residualValueRials: 10_000n, usefulLifeMonths: 120, method: 'STRAIGHT_LINE' },
      { id: 'motor', costRials: 30_000n, residualValueRials: 0n, usefulLifeMonths: 60, method: 'STRAIGHT_LINE' },
    ],
    taxBasis: { costRials: 100_000n, residualValueRials: 0n, method: 'DECLINING_BALANCE', annualRateBasisPoints: 2_500 },
  });

  assert.deepEqual(calculation.componentCharges, [
    { componentId: 'body', bookChargeRials: 667n },
    { componentId: 'motor', bookChargeRials: 500n },
  ]);
  assert.equal(calculation.bookChargeRials, 1_167n);
  assert.equal(calculation.taxChargeRials, 2_083n);
  assert.equal(calculation.deferredTaxTemporaryDifferenceRials, 916n);
  assert.equal(calculation.postingLines.length, 2);
  assert.equal(calculation.postingLines.some((line) => line.description.includes('مالیاتی')), false);

  const finalPeriod = calculateAssetDepreciation({
    assetId: 'asset-1', periodIdentity: '1409-12', readyForUseAt: new Date('2026-08-01T00:00:00.000Z'),
    periodStart: new Date('2031-03-01T00:00:00.000Z'), periodEnd: new Date('2031-03-31T23:59:59.999Z'),
    accumulatedBookDepreciationRials: 29_900n, accumulatedTaxDepreciationRials: 50_000n,
    depreciationExpenseAccountId: 'depreciation-expense', accumulatedDepreciationAccountId: 'accumulated-depreciation',
    components: [{ id: 'motor', costRials: 30_000n, residualValueRials: 0n, usefulLifeMonths: 60, method: 'STRAIGHT_LINE', accumulatedDepreciationRials: 29_900n }],
    taxBasis: { costRials: 100_000n, residualValueRials: 0n, method: 'STRAIGHT_LINE', usefulLifeMonths: 12 },
  });
  assert.deepEqual(finalPeriod.componentCharges, [{ componentId: 'motor', bookChargeRials: 100n }]);
  assert.equal(finalPeriod.bookChargeRials, 100n);
  assert.equal(finalPeriod.taxChargeRials, 8_333n);
  const decliningLaterPeriod = calculateAssetDepreciation({
    assetId: 'asset-2', periodIdentity: '1406-02', readyForUseAt: new Date('2026-08-01T00:00:00.000Z'),
    periodStart: new Date('2027-05-01T00:00:00.000Z'), periodEnd: new Date('2027-05-31T23:59:59.999Z'),
    accumulatedBookDepreciationRials: 20_000n, accumulatedTaxDepreciationRials: 50_000n,
    depreciationExpenseAccountId: 'depreciation-expense', accumulatedDepreciationAccountId: 'accumulated-depreciation',
    components: [{ id: 'body', costRials: 100_000n, residualValueRials: 0n, usefulLifeMonths: 120, method: 'DECLINING_BALANCE', annualRateBasisPoints: 2_500, accumulatedDepreciationRials: 20_000n }],
    taxBasis: { costRials: 100_000n, residualValueRials: 0n, method: 'DECLINING_BALANCE', annualRateBasisPoints: 2_500 },
  });
  assert.equal(decliningLaterPeriod.componentCharges[0].bookChargeRials, 1_667n);
  assert.equal(decliningLaterPeriod.taxChargeRials, 1_042n);
});

test('asset repair and improvement remain explicit immutable lifecycle treatments', async () => {
  const repository = createRepository();
  const application = createAccountingPeriodEndApplication(repository, { now: () => now });
  const lifecycle = (sourceId: string, eventType: 'REPAIR' | 'IMPROVEMENT', treatment: 'EXPENSE' | 'CAPITALIZE') => {
    const unsigned = {
      kind: 'ASSET_LIFECYCLE' as const,
      sourceId, sourceVersion: 1, occurredAt: now, assetId: 'asset-1', eventType, treatment,
      lines: [
        { accountId: treatment === 'EXPENSE' ? 'repair-expense' : 'fixed-asset', debitRials: 20_000n, creditRials: 0n, description: treatment === 'EXPENSE' ? 'تعمیر عادی' : 'بهسازی واجد شرایط' },
        { accountId: 'payable', debitRials: 0n, creditRials: 20_000n, description: 'بستانکار مربوط' },
      ],
      lifecyclePayload: { documentIds: [`document-${sourceId}`], priorComponentId: null, successorComponentId: null },
    };
    return { ...unsigned, sourceHash: hashPeriodEndEvidence(unsigned) };
  };
  const repair = await application.acceptEvidence({ bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence: lifecycle('repair-1', 'REPAIR', 'EXPENSE') });
  const improvement = await application.acceptEvidence({ bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence: lifecycle('improvement-1', 'IMPROVEMENT', 'CAPITALIZE') });
  assert.equal(repair.kind, 'POSTED');
  assert.equal(improvement.kind, 'POSTED');
  assert.equal(repository.posts[0].lines[0].accountId, 'repair-expense');
  assert.equal(repository.posts[1].lines[0].accountId, 'fixed-asset');
});

test('approved payroll posts only a balanced confidential summary and preserves obligation identity on retry', async () => {
  const repository = createRepository();
  const application = createAccountingPeriodEndApplication(repository, { now: () => now });
  const source = {
    kind: 'APPROVED_PAYROLL' as const,
    sourceId: 'payroll-1405-06', sourceVersion: 3, occurredAt: now,
    populationHash: 'population-sha256', policyHash: 'policy-sha256',
    summaryLines: [
      { componentCode: 'GROSS_PAY', accountId: 'salary-expense', debitRials: 1_000_000n, creditRials: 0n, costCenterMemberId: 'factory' },
      { componentCode: 'NET_PAY', accountId: 'salary-payable', debitRials: 0n, creditRials: 800_000n },
      { componentCode: 'PAYROLL_TAX', accountId: 'tax-payable', debitRials: 0n, creditRials: 100_000n },
      { componentCode: 'INSURANCE', accountId: 'insurance-payable', debitRials: 0n, creditRials: 100_000n },
    ],
    obligations: [
      { identity: 'payroll-1405-06:net-pay', kind: 'NET_PAY' as const, amountRials: 800_000n },
      { identity: 'payroll-1405-06:tax', kind: 'PAYROLL_TAX' as const, amountRials: 100_000n },
    ],
  };
  const evidence = { ...source, sourceHash: hashPeriodEndEvidence(source) };

  const posted = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence,
  });
  const retry = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence,
  });

  assert.equal(posted.kind, 'POSTED');
  assert.deepEqual(retry, posted);
  assert.equal(repository.posts.length, 1);
  assert.equal(JSON.stringify(repository.posts[0], (_key, value) => typeof value === 'bigint' ? value.toString() : value).includes('employee'), false);
  if (posted.kind === 'POSTED') assert.deepEqual(posted.obligationIdentities, ['payroll-1405-06:net-pay', 'payroll-1405-06:tax']);
});

test('failed payroll payment remains open and a successful retry keeps the same obligation identity', () => {
  const obligation = {
    identity: 'payroll-1405-06:net-pay', amountRials: 800_000n, settledRials: 0n,
    status: 'OPEN' as const, attempts: [] as Array<{ identity: string; status: 'FAILED' | 'SUCCEEDED'; amountRials: bigint }>,
  };
  const failed = applyPayrollSettlementAttempt(obligation, { identity: 'bank-attempt-1', status: 'FAILED', amountRials: 800_000n });
  assert.equal(failed.status, 'OPEN');
  assert.equal(failed.settledRials, 0n);
  assert.equal(failed.identity, obligation.identity);
  const retried = applyPayrollSettlementAttempt(failed, { identity: 'bank-attempt-2', status: 'SUCCEEDED', amountRials: 800_000n });
  assert.equal(retried.status, 'SETTLED');
  assert.equal(retried.settledRials, 800_000n);
  assert.equal(retried.identity, obligation.identity);
  assert.deepEqual(retried.attempts.map((attempt) => attempt.identity), ['bank-attempt-1', 'bank-attempt-2']);
});

test('a future schedule revision never rewrites prior postings', async () => {
  const repository = createRepository();
  const application = createAccountingPeriodEndApplication(repository, { now: () => now });
  const due = (sourceVersion: number, amountRials: bigint) => {
    const source = {
      kind: 'RECOGNITION_DUE' as const, sourceId: 'prepayment-1', sourceVersion, occurredAt: now,
      dueIdentity: `prepayment-1:1405-06:v${sourceVersion}`,
      scheduleKind: 'PREPAYMENT' as const, amountRials,
      debitAccountId: 'insurance-expense', creditAccountId: 'prepaid-insurance',
      estimateBasis: sourceVersion === 1 ? 'قرارداد اولیه' : 'بازنگری آتی',
      appliesFrom: sourceVersion === 1 ? new Date('2026-09-01T00:00:00.000Z') : new Date('2026-10-01T00:00:00.000Z'),
      reviewDueAt: new Date('2026-09-30T00:00:00.000Z'),
    };
    return { ...source, sourceHash: hashPeriodEndEvidence(source) };
  };

  const first = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1', actorId: 'accountant-1', evidence: due(1, 10_000n),
  });
  const future = await application.acceptEvidence({
    bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-2', actorId: 'accountant-1', evidence: due(2, 12_000n),
  });

  assert.equal(first.kind, 'POSTED');
  assert.equal(future.kind, 'POSTED');
  assert.equal(repository.posts.length, 2);
  assert.equal(repository.posts[0].lines[0].debitRials, 10_000n);
  assert.equal(repository.posts[1].lines[0].debitRials, 12_000n);
});

test('posted lines and an effective mapping produce a reproducible eight-column official dataset', () => {
  const dataset = buildOfficialAccountingDataset({
    request: {
      reportKind: 'TRIAL_BALANCE', bookId: 'book-1', fiscalYearId: 'year-1',
      from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T23:59:59.999Z'),
      columns: 8, level: 'SUBSIDIARY', mappingVersionId: 'mapping-1', cutoffAt: now,
    },
    mapping: {
      id: 'mapping-1', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      rows: [{ accountId: 'cash', statement: 'FINANCIAL_POSITION', sectionCode: 'CURRENT_ASSETS', cashFlowClass: 'OPERATING' }],
    },
    lines: [
      { id: 'opening', voucherId: 'v0', voucherNumber: 1, status: 'POSTED', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 50_000n, creditRials: 0n, documentDate: new Date('2026-08-31T00:00:00.000Z'), postedAt: new Date('2026-08-31T08:00:00.000Z'), dimensions: {} },
      { id: 'receipt', voucherId: 'v1', voucherNumber: 2, status: 'POSTED', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 30_000n, creditRials: 0n, documentDate: new Date('2026-09-10T00:00:00.000Z'), postedAt: new Date('2026-09-10T08:00:00.000Z'), dimensions: { branch: 'مرکزی' } },
      { id: 'payment', voucherId: 'v2', voucherNumber: 3, status: 'REVERSED', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 0n, creditRials: 10_000n, documentDate: new Date('2026-09-15T00:00:00.000Z'), postedAt: new Date('2026-09-15T08:00:00.000Z'), dimensions: { branch: 'مرکزی' } },
      { id: 'draft', voucherId: 'v3', voucherNumber: null, status: 'DRAFT', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 999_000n, creditRials: 0n, documentDate: new Date('2026-09-20T00:00:00.000Z'), postedAt: null, dimensions: {} },
    ],
  });

  assert.equal(dataset.official, true);
  assert.equal(dataset.rows.length, 1);
  assert.deepEqual(dataset.rows[0].amounts, {
    openingDebit: 50_000n, openingCredit: 0n,
    turnoverDebit: 30_000n, turnoverCredit: 10_000n,
    endingDebit: 70_000n, endingCredit: 0n,
    periodNetDebit: 20_000n, periodNetCredit: 0n,
  });
  assert.equal(dataset.mappingVersionId, 'mapping-1');
  assert.match(dataset.integrityHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(dataset.sourceLineIds, ['opening', 'receipt', 'payment']);
});

test('accepted trial-balance widths publish an explicit stable column contract', () => {
  const widths = [2, 4, 6, 8] as const;
  const expected = [2, 4, 6, 8];
  for (const [index, columns] of widths.entries()) {
    const dataset = buildOfficialAccountingDataset({
      request: {
        reportKind: 'TRIAL_BALANCE', bookId: 'book-1', fiscalYearId: 'year-1',
        from: new Date('2026-09-01'), to: new Date('2026-09-30'), cutoffAt: new Date('2026-09-30T23:59:59Z'),
        mappingVersionId: 'mapping-1', columns, level: 'SUBSIDIARY',
      },
      mapping: { id: 'mapping-1', effectiveFrom: new Date('2026-01-01'), rows: [] },
      lines: [],
    });
    assert.equal(dataset.columnKeys.length, expected[index]);
    assert.equal(dataset.columns, columns);
  }
});

test('T-account keeps chronological running balance and drill-down to posted evidence', () => {
  const projection = buildTAccountProjection({
    accountId: 'cash',
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-30T23:59:59.999Z'),
    openingDebitRials: 5_000n,
    openingCreditRials: 0n,
    lines: [
      { id: 'later', voucherId: 'v2', voucherNumber: 2, status: 'POSTED', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 0n, creditRials: 3_000n, documentDate: new Date('2026-09-20T00:00:00.000Z'), postedAt: new Date('2026-09-20T08:00:00.000Z'), dimensions: {} },
      { id: 'earlier', voucherId: 'v1', voucherNumber: 1, status: 'POSTED', accountId: 'cash', accountCode: '1101', accountTitlePersian: 'وجه نقد', accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'وجه نقد' }, debitRials: 10_000n, creditRials: 0n, documentDate: new Date('2026-09-10T00:00:00.000Z'), postedAt: new Date('2026-09-10T08:00:00.000Z'), dimensions: {} },
    ],
  });
  assert.deepEqual(projection.entries.map((entry) => ({ id: entry.lineId, debit: entry.runningDebitRials, credit: entry.runningCreditRials })), [
    { id: 'earlier', debit: 15_000n, credit: 0n },
    { id: 'later', debit: 12_000n, credit: 0n },
  ]);
  assert.deepEqual(projection.entries[1].drilldown, { voucherId: 'v2', lineId: 'later' });
});

test('cash-flow dataset excludes internal transfers and keeps the mapping version', () => {
  const base = {
    voucherNumber: 1, status: 'POSTED' as const, accountCode: '1101', accountTitlePersian: 'بانک',
    accountPath: { group: 'دارایی', general: 'دارایی جاری', subsidiary: 'بانک' },
    debitRials: 10_000n, creditRials: 0n, documentDate: new Date('2026-09-10T00:00:00.000Z'),
    postedAt: new Date('2026-09-10T08:00:00.000Z'), dimensions: {},
  };
  const dataset = buildOfficialAccountingDataset({
    request: { reportKind: 'CASH_FLOW', bookId: 'book-1', fiscalYearId: 'year-1', from: new Date('2026-09-01'), to: new Date('2026-09-30T23:59:59.999Z'), mappingVersionId: 'mapping-cash', cutoffAt: now },
    mapping: { id: 'mapping-cash', effectiveFrom: new Date('2026-01-01'), rows: [
      { accountId: 'customer-bank', statement: 'FINANCIAL_POSITION', sectionCode: 'CASH', cashFlowClass: 'OPERATING' },
      { accountId: 'transfer-bank', statement: 'FINANCIAL_POSITION', sectionCode: 'CASH', cashFlowClass: 'INTERNAL_TRANSFER' },
    ] },
    lines: [
      { ...base, id: 'external', voucherId: 'v1', accountId: 'customer-bank' },
      { ...base, id: 'internal', voucherId: 'v2', accountId: 'transfer-bank', debitRials: 999_000n },
    ],
  });
  assert.deepEqual(dataset.sourceLineIds, ['external']);
  assert.equal(dataset.rows[0].key, 'OPERATING');
  assert.equal(dataset.rows[0].amounts.turnoverDebit, 10_000n);

  const indirect = buildOfficialAccountingDataset({
    request: { reportKind: 'CASH_FLOW', cashFlowMethod: 'INDIRECT', bookId: 'book-1', fiscalYearId: 'year-1', from: new Date('2026-09-01'), to: new Date('2026-09-30T23:59:59.999Z'), mappingVersionId: 'mapping-cash', cutoffAt: now },
    mapping: { id: 'mapping-cash', effectiveFrom: new Date('2026-01-01'), rows: [
      { accountId: 'customer-bank', statement: 'CASH_FLOW_INDIRECT', sectionCode: 'تعدیلات سرمایه در گردش', cashFlowClass: 'OPERATING' },
    ] },
    lines: [{ ...base, id: 'external', voucherId: 'v1', accountId: 'customer-bank' }],
  });
  assert.equal(indirect.rows[0].key, 'تعدیلات سرمایه در گردش');
});

test('financial statements preserve multiple mapping rows and contra signs', () => {
  const dataset = buildOfficialAccountingDataset({
    request: { reportKind: 'FINANCIAL_STATEMENT', bookId: 'book-1', fiscalYearId: 'year-1', from: new Date('2026-09-01'), to: new Date('2026-09-30'), cutoffAt: new Date('2026-09-30T23:59:59Z'), mappingVersionId: 'mapping-1', columns: 2 },
    mapping: { id: 'mapping-1', effectiveFrom: new Date('2026-01-01'), rows: [
      { accountId: 'account-1', statement: 'FINANCIAL_POSITION', sectionCode: 'دارایی', signMultiplier: 1 },
      { accountId: 'account-1', statement: 'NOTES', sectionCode: 'یادداشت-یک', signMultiplier: -1 },
    ] },
    lines: [{ id: 'line-1', voucherId: 'voucher-1', voucherNumber: 1, status: 'POSTED', accountId: 'account-1', accountCode: '101', accountTitlePersian: 'صندوق', accountPath: { group: 'دارایی', general: 'نقد', subsidiary: 'صندوق' }, debitRials: 100n, creditRials: 0n, documentDate: new Date('2026-09-10'), postedAt: new Date('2026-09-10'), dimensions: {} }],
  });
  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.rows.find((row) => row.key.startsWith('FINANCIAL_POSITION'))?.amounts.endingDebit, 100n);
  assert.equal(dataset.rows.find((row) => row.key.startsWith('NOTES'))?.amounts.endingCredit, 100n);
});
