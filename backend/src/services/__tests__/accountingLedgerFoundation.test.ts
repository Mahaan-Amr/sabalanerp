import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountingLedgerError,
  createAccountingLedgerApplication,
  hashAccountingEvidence,
  type AccountingLedgerRepository,
  type LedgerVoucherRecord,
} from '../accountingLedgerFoundation';

const now = new Date('2026-09-21T08:30:00.000Z');
const immutableSource = (id: string) => {
  const payload = { kind: 'MANUAL_VOUCHER', id, version: 1 };
  return { type: 'MANUAL', id, version: 1, payload, hash: hashAccountingEvidence(payload) };
};

const createRepository = (periodStatus: 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED' = 'OPEN'): AccountingLedgerRepository & { vouchers: Map<string, LedgerVoucherRecord>; audits: any[] } => {
  const vouchers = new Map<string, LedgerVoucherRecord>();
  const audits: any[] = [];
  const idempotency = new Map<string, string>();
  let nextNumber = 0;
  const repository: AccountingLedgerRepository & { vouchers: Map<string, LedgerVoucherRecord>; audits: any[] } = {
    vouchers,
    audits,
    transaction: async (operation) => operation(repository),
    getPostingContext: async () => ({
      book: { id: 'book-1', baseCurrency: 'IRR' },
      fiscalYear: { id: 'year-1', bookId: 'book-1', status: 'ACTIVE' },
      period: {
        id: 'period-1', fiscalYearId: 'year-1', status: periodStatus,
        startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-09-30T23:59:59.999Z'),
      },
      accounts: new Map([
        ['cash', { id: 'cash', active: true, level: 'MOIN', currencyBehavior: 'BASE_ONLY', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'OPTIONAL', dimensionRules: [] }],
        ['capital', { id: 'capital', active: true, level: 'MOIN', currencyBehavior: 'BASE_ONLY', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'FORBIDDEN', dimensionRules: [] }],
        ['fx', { id: 'fx', active: true, level: 'MOIN', currencyBehavior: 'MULTI_CURRENCY', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'FORBIDDEN', dimensionRules: [] }],
        ['cost', { id: 'cost', active: true, level: 'MOIN', currencyBehavior: 'BASE_ONLY', partyRequirement: 'REQUIRED', financialAccountRequirement: 'FORBIDDEN', dimensionRules: [
          { dimensionTypeId: 'cost-center', requirement: 'REQUIRED' },
          { dimensionTypeId: 'contract', requirement: 'FORBIDDEN' },
        ] }],
      ]),
      dimensionMembers: new Map([
        ['cost-center', new Set(['cost-center-1'])],
        ['contract', new Set(['contract-1'])],
      ]),
      partyIds: new Set(['party-1']),
      financialAccountIds: new Set(['bank-1']),
    }),
    findVoucherByIdempotencyKey: async (key) => {
      const id = idempotency.get(key);
      return id ? vouchers.get(id) ?? null : null;
    },
    findVoucherBySource: async ({ bookId, type, id, version }) => [...vouchers.values()].find((voucher) => (
      voucher.bookId === bookId && voucher.source.type === type && voucher.source.id === id && voucher.source.version === version
    )) ?? null,
    createDraftVoucher: async (draft) => {
      const voucher: LedgerVoucherRecord = {
        ...draft,
        id: `voucher-${vouchers.size + 1}`,
        status: 'DRAFT',
        statutoryNumber: null,
        postedAt: null,
        reversedAt: null,
        reversalOfId: null,
      };
      vouchers.set(voucher.id, voucher);
      idempotency.set(voucher.idempotencyKey, voucher.id);
      return voucher;
    },
    getVoucherForUpdate: async (id) => vouchers.get(id) ?? null,
    allocateStatutoryNumber: async () => ++nextNumber,
    markVoucherPosted: async (input) => {
      const voucher = vouchers.get(input.id)!;
      const updated = { ...voucher, status: 'POSTED' as const, statutoryNumber: input.statutoryNumber, postedAt: input.postedAt };
      vouchers.set(updated.id, updated);
      return updated;
    },
    createReversalVoucher: async (input) => {
      const original = vouchers.get(input.original.id)!;
      const reversal: LedgerVoucherRecord = {
        ...input.original,
        id: `voucher-${vouchers.size + 1}`,
        referenceNumber: input.referenceNumber,
        idempotencyKey: input.idempotencyKey,
        description: input.description,
        fiscalYearId: input.target.fiscalYearId,
        periodId: input.target.periodId,
        documentDate: input.target.documentDate,
        source: (() => {
          const payload = { originalVoucherId: original.id, originalContentHash: original.contentHash, commandHash: input.commandHash };
          return { type: 'LEDGER_REVERSAL', id: original.id, version: 1, payload, hash: hashAccountingEvidence(payload) };
        })(),
        contentHash: input.contentHash,
        status: 'POSTED',
        statutoryNumber: input.statutoryNumber,
        postedAt: input.postedAt,
        reversedAt: null,
        reversalOfId: original.id,
        lines: original.lines.map((line) => ({ ...line, debitRials: line.creditRials, creditRials: line.debitRials })),
      };
      vouchers.set(reversal.id, reversal);
      idempotency.set(reversal.idempotencyKey, reversal.id);
      vouchers.set(original.id, { ...original, status: 'REVERSED', reversedAt: input.postedAt });
      return reversal;
    },
    appendAudit: async (entry) => { audits.push(entry); },
  };
  return repository;
};

const balancedDraft = {
  bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1',
  idempotencyKey: 'manual-opening-1', correlationId: 'correlation-1',
  description: 'ثبت سرمایه اولیه', documentDate: new Date('2026-09-21T00:00:00.000Z'), occurredAt: now,
  source: immutableSource('manual-opening-1'),
  actor: { id: 'accountant-1', profile: 'ACCOUNTANT' as const },
  lines: [
    { accountId: 'cash', debitRials: 10_000n, creditRials: 0n, description: 'صندوق', dimensions: [], rawAmountBeforeRounding: '10000', roundingRuleVersion: 'ریال-صحیح-نیم-به-بالا-نسخه-۱', evidence: (() => { const payload = { kind: 'MANUAL_LINE', index: 1, amount: '10000' }; return { type: 'سند دستی', id: 'شاهد-۱', version: 1, payload, hash: hashAccountingEvidence(payload) }; })() },
    { accountId: 'capital', debitRials: 0n, creditRials: 10_000n, description: 'سرمایه', dimensions: [], rawAmountBeforeRounding: '10000', roundingRuleVersion: 'ریال-صحیح-نیم-به-بالا-نسخه-۱', evidence: (() => { const payload = { kind: 'MANUAL_LINE', index: 2, amount: '10000' }; return { type: 'سند دستی', id: 'شاهد-۲', version: 1, payload, hash: hashAccountingEvidence(payload) }; })() },
  ],
};

test('a balanced command posts once and retry returns the same immutable voucher', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-۱' });

  const draft = await ledger.createManualDraft(balancedDraft);
  const posted = await ledger.postVoucher({ voucherId: draft.id, actor: balancedDraft.actor, reason: 'تأیید ثبت اولیه' });
  const retried = await ledger.createManualDraft(balancedDraft);

  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.statutoryNumber, 1);
  assert.equal(posted.debitTotalRials, 10_000n);
  assert.equal(posted.creditTotalRials, 10_000n);
  assert.equal(retried.id, posted.id);
  assert.equal(repository.vouchers.size, 1);
});

test('the immutable source is idempotent across request keys and rejects changed content', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-منشأ' });
  const first = await ledger.createManualDraft(balancedDraft);
  const retry = await ledger.createManualDraft({ ...balancedDraft, idempotencyKey: 'another-request-key', correlationId: 'another-correlation' });
  assert.equal(retry.id, first.id);
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft,
    idempotencyKey: 'changed-source-request',
    description: 'شرح تغییرکرده برای همان منشأ',
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'SOURCE_CONFLICT');
});

test('line evidence must contain the canonical payload matching its digest', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-شاهد' });
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft,
    idempotencyKey: 'tampered-evidence-request',
    source: immutableSource('tampered-evidence-source'),
    lines: [{
      ...balancedDraft.lines[0],
      evidence: { ...balancedDraft.lines[0].evidence, payload: { kind: 'MANUAL_LINE', amount: '99999' } },
    }, balancedDraft.lines[1]],
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'LINE_EVIDENCE_INTEGRITY_FAILED');
});

test('invalid dimensions and unbalanced commands fail with no partial ledger effect', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-۲' });

  await assert.rejects(
    () => ledger.createManualDraft({
      ...balancedDraft,
      idempotencyKey: 'bad-dimensions',
      lines: [
        { accountId: 'cost', partyId: 'party-1', debitRials: 10_000n, creditRials: 0n, description: 'هزینه', dimensions: [{ typeId: 'contract', memberId: 'contract-1' }], rawAmountBeforeRounding: '10000', roundingRuleVersion: 'ریال-صحیح-نیم-به-بالا-نسخه-۱', evidence: (() => { const payload = { kind: 'MANUAL_LINE', index: 1, amount: '10000', account: 'cost' }; return { type: 'سند دستی', id: 'شاهد-هزینه', version: 1, payload, hash: hashAccountingEvidence(payload) }; })() },
        balancedDraft.lines[1],
      ],
    }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'INVALID_DIMENSIONS',
  );
  await assert.rejects(
    () => ledger.createManualDraft({
      ...balancedDraft,
      idempotencyKey: 'missing-rounding-evidence',
      lines: balancedDraft.lines.map(({ rawAmountBeforeRounding: _raw, roundingRuleVersion: _rule, ...line }) => line),
    }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'ROUNDING_EVIDENCE_REQUIRED',
  );
  await assert.rejects(
    () => ledger.createManualDraft({
      ...balancedDraft,
      idempotencyKey: 'unbalanced',
      lines: [{ ...balancedDraft.lines[0], debitRials: 9_999n, rawAmountBeforeRounding: '9999' }, balancedDraft.lines[1]],
    }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'UNBALANCED_VOUCHER',
  );
  assert.equal(repository.vouchers.size, 0);
});

test('foreign-currency evidence must be supported, positive, reproducible and rounded to the posted rial', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-ارزی' });
  const fxLine = {
    ...balancedDraft.lines[0], accountId: 'fx', debitRials: 1_000_000n,
    originalAmount: '100.00', originalCurrency: 'USD', exchangeRate: '10000.0000',
    exchangeRateDate: balancedDraft.documentDate, exchangeRateSource: 'نرخ قرارداد شماره ۱',
    rawAmountBeforeRounding: '1000000.00',
  };
  const balancingLine = { ...balancedDraft.lines[1], creditRials: 1_000_000n, rawAmountBeforeRounding: '1000000.00' };
  const created = await ledger.createManualDraft({
    ...balancedDraft, idempotencyKey: 'valid-fx-evidence', source: immutableSource('valid-fx-evidence'), lines: [fxLine, balancingLine],
  });
  assert.equal(created.debitTotalRials, 1_000_000n);
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft, idempotencyKey: 'unsupported-fx-evidence', source: immutableSource('unsupported-fx-evidence'),
    lines: [{ ...fxLine, originalCurrency: 'XYZ' }, balancingLine],
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'UNSUPPORTED_CURRENCY');
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft, idempotencyKey: 'mismatched-fx-evidence', source: immutableSource('mismatched-fx-evidence'),
    lines: [{ ...fxLine, exchangeRate: '9999' }, balancingLine],
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'FX_RECONCILIATION_FAILED');
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft, idempotencyKey: 'raw-scale-overflow', source: immutableSource('raw-scale-overflow'),
    lines: [{ ...fxLine, rawAmountBeforeRounding: '1000000.000000001' }, balancingLine],
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'INVALID_RAW_AMOUNT');
  await assert.rejects(() => ledger.createManualDraft({
    ...balancedDraft, idempotencyKey: 'rate-scale-overflow', source: immutableSource('rate-scale-overflow'),
    lines: [{ ...fxLine, exchangeRate: '10000.00000000001' }, balancingLine],
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'INVALID_EXCHANGE_RATE');
});

test('posted content is corrected through a linked opposite voucher', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => `عطف-${repository.vouchers.size + 1}` });
  const draft = await ledger.createManualDraft(balancedDraft);
  const posted = await ledger.postVoucher({ voucherId: draft.id, actor: balancedDraft.actor, reason: 'تأیید ثبت اولیه' });

  const reversal = await ledger.reverseVoucher({
    voucherId: posted.id,
    actor: { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' },
    idempotencyKey: 'reverse-opening-1',
    reason: 'اصلاح ثبت اولیه اشتباه',
    targetFiscalYearId: 'year-1', targetPeriodId: 'period-1', documentDate: balancedDraft.documentDate,
  });

  assert.equal(reversal.reversalOfId, posted.id);
  assert.equal(reversal.lines[0].creditRials, 10_000n);
  assert.equal(repository.vouchers.get(posted.id)?.status, 'REVERSED');
  assert.equal(repository.vouchers.size, 2);
  await assert.rejects(
    () => ledger.reverseVoucher({
      voucherId: posted.id,
      actor: { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' },
      idempotencyKey: 'reverse-opening-1',
      reason: 'دلیل متفاوت برای همان شناسه',
      targetFiscalYearId: 'year-1', targetPeriodId: 'period-1', documentDate: balancedDraft.documentDate,
    }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('مدیر سامانه با سطح ویرایش فقط با تأیید صریح اضطراری می‌تواند سند را برگرداند', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => `عطف-${repository.vouchers.size + 1}` });
  const draft = await ledger.createManualDraft({ ...balancedDraft, idempotencyKey: 'admin-emergency-source', source: immutableSource('admin-emergency-source') });
  const posted = await ledger.postVoucher({ voucherId: draft.id, actor: balancedDraft.actor, reason: 'قطعی‌سازی برای آزمون اضطراری' });
  const request = {
    voucherId: posted.id,
    actor: { id: 'admin-1', profile: 'ACCOUNTANT' as const, isGlobalAdmin: true },
    idempotencyKey: 'admin-emergency-reversal',
    reason: 'اصلاح اضطراری ثبت قطعی',
    targetFiscalYearId: 'year-1', targetPeriodId: 'period-1', documentDate: balancedDraft.documentDate,
  };
  await assert.rejects(
    () => ledger.reverseVoucher({ ...request, actor: { ...request.actor, profile: 'VIEWER' }, override: { confirmed: true, reason: 'اصلاح اضطراری ثبت قطعی' } }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'ACCOUNTING_WRITE_FORBIDDEN',
  );
  await assert.rejects(
    () => ledger.reverseVoucher(request),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'EMERGENCY_OVERRIDE_REASON_REQUIRED',
  );
  await assert.rejects(
    () => ledger.reverseVoucher({ ...request, override: { confirmed: false, reason: 'اصلاح اضطراری ثبت قطعی' } }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'EMERGENCY_OVERRIDE_CONFIRMATION_REQUIRED',
  );
  const reversal = await ledger.reverseVoucher({ ...request, override: { confirmed: true, reason: 'اصلاح اضطراری ثبت قطعی' } });
  assert.equal(reversal.status, 'POSTED');
  assert.deepEqual(repository.audits.at(-1)?.sessionContext, {
    emergencyOverride: true,
    confirmed: true,
    reason: 'اصلاح اضطراری ثبت قطعی',
    authority: 'GLOBAL_ADMIN_WITH_ACCOUNTING_ACCESS',
  });
  await assert.rejects(
    () => ledger.reverseVoucher({ ...request, override: { confirmed: true, reason: 'دلیل اضطراری متفاوت برای همان درخواست' } }),
    (error: unknown) => error instanceof AccountingLedgerError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('a posted voucher remains reversible after its master data is retired', async () => {
  const repository = createRepository();
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => `عطف-${repository.vouchers.size + 1}` });
  const draft = await ledger.createManualDraft({ ...balancedDraft, idempotencyKey: 'retired-master-draft', source: immutableSource('retired-master-source') });
  const posted = await ledger.postVoucher({ voucherId: draft.id, actor: balancedDraft.actor, reason: 'ثبت پیش از غیرفعال‌سازی' });
  const originalContext = repository.getPostingContext;
  repository.getPostingContext = async (input) => {
    const context = await originalContext(input);
    return { ...context, accounts: new Map([...context.accounts].map(([id, account]) => [id, { ...account, active: false }])) };
  };
  const reversal = await ledger.reverseVoucher({
    voucherId: posted.id,
    actor: { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' },
    idempotencyKey: 'retired-master-reversal',
    reason: 'اصلاح سند پس از غیرفعال‌سازی حساب',
    targetFiscalYearId: 'year-1', targetPeriodId: 'period-1', documentDate: balancedDraft.documentDate,
  });
  assert.equal(reversal.status, 'POSTED');
  assert.equal(reversal.lines[0].creditRials, posted.lines[0].debitRials);
});

test('مدیر حسابداری فقط با تأیید و دلیل می‌تواند دوره بسته موقت را تکمیل کند', async () => {
  const repository = createRepository('SOFT_CLOSED');
  const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => 'عطف-اضطراری' });
  await assert.rejects(() => ledger.createManualDraft(balancedDraft), (error: unknown) => (
    error instanceof AccountingLedgerError && error.code === 'PERIOD_NOT_OPEN'
  ));
  const created = await ledger.createManualDraft({
    ...balancedDraft,
    idempotencyKey: 'soft-close-override',
    actor: { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' },
    override: { confirmed: true, reason: 'ثبت رویداد دیررس مستند' },
  });
  assert.equal(created.status, 'DRAFT');
  const globalAdmin = await ledger.createManualDraft({
    ...balancedDraft,
    idempotencyKey: 'global-admin-soft-close-override',
    source: immutableSource('global-admin-soft-close-override'),
    actor: { id: 'admin-1', profile: 'ACCOUNTANT', isGlobalAdmin: true },
    override: { confirmed: true, reason: 'ثبت اضطراری مدیر سامانه با سطح ویرایش' },
  });
  assert.equal(globalAdmin.status, 'DRAFT');
  const hardClosed = createRepository('HARD_CLOSED');
  const hardLedger = createAccountingLedgerApplication(hardClosed, { now: () => now, nextReference: () => 'عطف-بسته' });
  await assert.rejects(() => hardLedger.createManualDraft({
    ...balancedDraft,
    idempotencyKey: 'hard-close-override',
    actor: { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' },
    override: { confirmed: true, reason: 'تلاش غیرمجاز برای دوره قطعی' },
  }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'PERIOD_NOT_OPEN');
});

test('خاصیت توازن و ریال صحیح برای دامنه‌ای از مبالغ حفظ می‌شود', async () => {
  let seed = 2_140_137;
  for (let index = 0; index < 80; index += 1) {
    seed = (seed * 48_271) % 2_147_483_647;
    const amount = BigInt(seed);
    const repository = createRepository();
    const ledger = createAccountingLedgerApplication(repository, { now: () => now, nextReference: () => `عطف-${index}` });
    const created = await ledger.createManualDraft({
      ...balancedDraft,
      idempotencyKey: `property-${index}-request`,
      lines: [
        { ...balancedDraft.lines[0], debitRials: amount, rawAmountBeforeRounding: amount.toString() },
        { ...balancedDraft.lines[1], creditRials: amount, rawAmountBeforeRounding: amount.toString() },
      ],
    });
    assert.equal(created.debitTotalRials, created.creditTotalRials);
    assert.equal(created.debitTotalRials, amount);
    await assert.rejects(() => ledger.createManualDraft({
      ...balancedDraft,
      idempotencyKey: `property-bad-${index}`,
      source: immutableSource(`property-bad-source-${index}`),
      lines: [
        { ...balancedDraft.lines[0], debitRials: amount, rawAmountBeforeRounding: amount.toString() },
        { ...balancedDraft.lines[1], creditRials: amount + 1n, rawAmountBeforeRounding: (amount + 1n).toString() },
      ],
    }), (error: unknown) => error instanceof AccountingLedgerError && error.code === 'UNBALANCED_VOUCHER');
  }
});
