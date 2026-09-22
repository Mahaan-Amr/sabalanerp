import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { hashCustomerTreasuryEvidence } from '../accountingCustomerTreasury';
import {
  allocateCustomerReceiptPrisma,
  bindTaxOutboxChannelPrisma,
  configureTaxSubmissionChannelPrisma,
  createAccountingTaxRulePrisma,
  createBankImportMappingPrisma,
  processNextTaxOutboxMessagePrisma,
  reverseCustomerAllocationPrisma,
  createControlTransferPolicyPrisma,
  createCustomerPostingRulePrisma,
  exportCustomerStatementPrisma,
  projectCustomerAccountPrisma,
  provisionCustomerAccountingProfile,
  importBankStatementLinePrisma,
  recognizeCustomerSalePrisma,
  recordCustomerReceiptPrisma,
} from '../accountingCustomerTreasuryPrisma';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('customer revenue and treasury tracer bullet persists once and projects only posted evidence', { skip: !sourceDatabaseUrl, timeout: 240_000 }, async () => {
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl: sourceDatabaseUrl!, migrateEmptySchema: true });
  const database = temporary.client();
  try {
    const actor = { id: `accountant-${temporary.runId}`, profile: 'ACCOUNTING_MANAGER' as const };
    const administration = createAccountingLedgerAdministration(database);
    const entity = await administration.setup({
      legalEntity: { code: `entity-${temporary.runId}`, namePersian: 'شرکت آزمون حسابداری مشتری', activeFrom: new Date('2026-03-21T00:00:00Z') },
      book: { code: 'primary', namePersian: 'دفتر اصلی' }, scheme: { groupLength: 1, kolLength: 2, moinLength: 3 }, actorId: actor.id,
    });
    const book = entity.books[0];
    const scheme = book.codeSchemes[0];
    const year = await administration.createFiscalYear({ bookId: book.id, code: '1405', titlePersian: 'سال مالی ۱۴۰۵', actorId: actor.id,
      startsAt: new Date('2026-03-21T00:00:00Z'), endsAt: new Date('2027-03-20T23:59:59.999Z'), periods: [{ code: '1', titlePersian: 'دوره سال',
        sequence: 1, isAdjustment: false, startsAt: new Date('2026-03-21T00:00:00Z'), endsAt: new Date('2027-03-20T23:59:59.999Z') }] });
    const account = async (input: { group: string; kol: string; moin: string; title: string; normal: 'DEBIT' | 'CREDIT';
      role: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE'; party?: 'REQUIRED'; financial?: 'REQUIRED' }) => {
      const group = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: input.group,
        titlePersian: `${input.title} گروه`, level: 'GROUP', normalSide: input.normal, statementRole: input.role,
        currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId: actor.id });
      const kol = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: input.kol,
        titlePersian: `${input.title} کل`, level: 'KOL', parentId: group.id, normalSide: input.normal, statementRole: input.role,
        currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId: actor.id });
      return administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: input.moin,
        titlePersian: input.title, level: 'MOIN', parentId: kol.id, normalSide: input.normal, statementRole: input.role,
        currencyBehavior: 'BASE_ONLY', partyRequirement: input.party ?? 'FORBIDDEN',
        financialAccountRequirement: input.financial ?? 'FORBIDDEN', effectiveFrom: year.startsAt, actorId: actor.id });
    };
    const [receivable, revenue, tax, inventory, cost, bankLedger, advance] = await Promise.all([
      account({ group: '1', kol: '101', moin: '101001', title: 'حساب‌های دریافتنی', normal: 'DEBIT', role: 'ASSET', party: 'REQUIRED' }),
      account({ group: '4', kol: '401', moin: '401001', title: 'درآمد فروش', normal: 'CREDIT', role: 'REVENUE' }),
      account({ group: '2', kol: '201', moin: '201001', title: 'مالیات فروش', normal: 'CREDIT', role: 'LIABILITY' }),
      account({ group: '5', kol: '501', moin: '501001', title: 'موجودی کالا', normal: 'DEBIT', role: 'ASSET' }),
      account({ group: '6', kol: '601', moin: '601001', title: 'بهای تمام‌شده', normal: 'DEBIT', role: 'EXPENSE' }),
      account({ group: '7', kol: '701', moin: '701001', title: 'بانک', normal: 'DEBIT', role: 'ASSET', financial: 'REQUIRED' }),
      account({ group: '8', kol: '801', moin: '801001', title: 'پیش‌دریافت مشتری', normal: 'CREDIT', role: 'LIABILITY', party: 'REQUIRED' }),
    ]);
    const financial = await administration.createFinancialAccount({ legalEntityId: entity.id, kind: 'BANK', titlePersian: 'بانک آزمون',
      institutionName: 'بانک نمونه', iban: `IR${temporary.runId}`, currency: 'IRR', activeFrom: year.startsAt, actorId: actor.id });
    const profileInput = { legalEntityId: entity.id, relationshipId: 'contract-1', relationshipVersion: 1, partySourceId: 'customer-1',
      displayName: 'مشتری نمونه', approvedAt: new Date('2026-09-20T08:00:00Z'), evidence: { contractId: 'contract-1', version: 1, state: 'APPROVED' }, actor };
    const profile = await provisionCustomerAccountingProfile(database, profileInput);
    const profileRetry = await provisionCustomerAccountingProfile(database, profileInput);
    assert.equal(profile.id, profileRetry.id);
    assert.equal(profile.openingBalanceRials.toString(), '0');

    await createAccountingTaxRulePrisma(database, { legalEntityId: entity.id, code: 'rule-1', version: 1,
      effectiveFrom: new Date('2026-03-21T00:00:00Z'), citation: 'قاعده آزمون', invoiceType: 'SALE', invoicePattern: 'ORIGINAL',
      exempt: false, rateBasisPoints: 1000, allocationRule: 'PER_LINE', roundingRule: 'HALF_UP_IRR', actor });
    await configureTaxSubmissionChannelPrisma(database, { legalEntityId: entity.id, kind: 'DIRECT', safeKeyVersion: 'key-v1',
      secretReference: 'vault://tax/channel-1', effectiveFrom: new Date('2026-03-21T00:00:00Z'), actor });
    const postingRule = await createCustomerPostingRulePrisma(database, { legalEntityId: entity.id, code: 'customer-default', version: 1,
      receivableAccountId: receivable.id, revenueAccountId: revenue.id, outputTaxAccountId: tax.id,
      inventoryAccountId: inventory.id, costAccountId: cost.id, bankClearingAccountId: bankLedger.id,
      customerAdvanceAccountId: advance.id, effectiveFrom: new Date('2026-03-21T00:00:00Z'), actor });
    const policy = await createControlTransferPolicyPrisma(database, { contractId: 'contract-1', version: 1,
      carriage: 'CONTRACTUAL_EXCEPTION', recognitionPoint: 'EXPLICIT_EXCEPTION', exceptionReason: 'شرط تحویل ویژه و مصوب قرارداد',
      exceptionTerms: [{ productRowId: 'row-1', quantity: '2', netRials: '1000', costRials: '600' }],
      exceptionOccurredAt: new Date('2026-09-21T08:00:00Z'), effectiveFrom: new Date('2026-09-20T00:00:00Z'), actor });
    const evidence = { id: policy.id, version: 1, type: 'CONTRACTUAL_EXCEPTION', occurredAt: new Date('2026-09-21T08:00:00Z'),
      contractId: 'contract-1', contractVersion: 1, productRows: [{ id: 'row-1', quantity: '2' }] };
    const command = { bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id, contractId: 'contract-1', contractVersion: 1,
      partySourceId: 'customer-1', partyDisplayName: 'مشتری نمونه', commercialInvoiceNumber: `sale-${temporary.runId}`,
      transferredAt: new Date('2026-09-21T08:00:00Z'), dueAt: new Date('2026-10-21T00:00:00Z'),
      policy: { id: policy.id, version: 1, carriage: 'CONTRACTUAL_EXCEPTION' as const, recognitionPoint: 'EXPLICIT_EXCEPTION' as const },
      evidence: { ...evidence, hash: hashCustomerTreasuryEvidence(evidence) }, lines: [{ id: 'line-1', productRowId: 'row-1',
        description: 'سنگ فرآوری‌شده', quantity: '2', netRials: 1_000n, taxRials: 100n, costRials: 600n,
        taxRule: { id: 'rule-1', version: 1, citation: 'قاعده آزمون', rateBasisPoints: 1000, exempt: false } }],
      accounts: { receivable: receivable.id, revenue: revenue.id, outputTax: tax.id, inventory: inventory.id, cost: cost.id },
      postingRule: { id: postingRule.id, version: postingRule.version },
      actor, idempotencyKey: `sale-${temporary.runId}`, correlationId: `sale-correlation-${temporary.runId}` };
    const sale = await recognizeCustomerSalePrisma(database, command);
    const saleRetry = await recognizeCustomerSalePrisma(database, command);
    assert.equal(sale.kind, 'POSTED'); assert.equal(saleRetry.kind, 'POSTED');
    if (sale.kind !== 'POSTED' || saleRetry.kind !== 'POSTED') return;
    assert.equal(sale.invoice.id, saleRetry.invoice.id);
    await assert.rejects(() => recognizeCustomerSalePrisma(database, { ...command, commercialInvoiceNumber: `changed-${temporary.runId}` }),
      /فرمان اقتصادی متفاوت/);
    assert.equal(await database.accountingLedgerVoucher.count({ where: { sourceType: 'CONTROL_TRANSFER' } }), 1);
    assert.equal(await database.accountingTaxOutboxMessage.count(), 1);

    const receipt = await recordCustomerReceiptPrisma(database, { profileId: profile.id, contractId: 'contract-1', bookId: book.id,
      fiscalYearId: year.id, periodId: year.periods[0].id, amountRials: 1_200n, occurredAt: new Date('2026-09-25T08:00:00Z'),
      financialAccountId: financial.id, bankAccountLedgerId: bankLedger.id, customerAdvanceLedgerId: advance.id,
      source: { type: 'BANK_RECEIPT', id: 'receipt-1', version: 1, payload: { reference: 'receipt-1', amountRials: '1200' } },
      idempotencyKey: `receipt-${temporary.runId}`, correlationId: `receipt-correlation-${temporary.runId}`, actor });
    await createBankImportMappingPrisma(database, { financialAccountId: financial.id, adapterType: 'CSV', version: 1,
      effectiveFrom: year.startsAt, columnMapping: { sourceIdentityField: 'reference', bookedAtField: 'date', amountField: 'amount',
        directionField: 'direction', descriptionField: 'description', inboundValues: ['credit'], outboundValues: ['debit'] }, actor });
    const rawBankEvidence = { rawRecord: { reference: 'bank-line-1', date: '2026-09-25T08:00:00Z', amount: '1200',
      direction: 'credit', description: 'واریز مشتری نمونه' } };
    const bankLine = await importBankStatementLinePrisma(database, { financialAccountId: financial.id, adapterType: 'CSV', mappingVersion: 1,
      sourceIdentity: '', bookedAt: new Date(0), amountRials: 0n, direction: 'INBOUND', description: '', evidence: rawBankEvidence });
    const bankLineRetry = await importBankStatementLinePrisma(database, { financialAccountId: financial.id, adapterType: 'CSV', mappingVersion: 1,
      sourceIdentity: '', bookedAt: new Date(0), amountRials: 0n, direction: 'INBOUND', description: '', evidence: rawBankEvidence });
    assert.equal(bankLine.id, bankLineRetry.id);
    const allocation = await allocateCustomerReceiptPrisma(database, { treasuryTransactionId: receipt.id, allocations: [{ openItemId: sale.openItem.id, amountRials: 1_100n }],
      bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id, customerAdvanceLedgerId: advance.id,
      receivableLedgerId: receivable.id, documentDate: new Date('2026-09-25T08:01:00Z'), idempotencyKey: `allocation-${temporary.runId}`,
      correlationId: `allocation-correlation-${temporary.runId}`, actor });
    const projection = await projectCustomerAccountPrisma(database, { profileId: profile.id, asOf: new Date('2026-09-26T00:00:00Z') });
    assert.equal(projection.receivableRials, 0n);
    assert.equal(projection.unallocatedCreditRials, 100n);
    assert.equal(projection.openItems.length, 0);
    const reversedAt = new Date();
    await reverseCustomerAllocationPrisma(database, { allocationId: allocation.id, reason: 'اصلاح تخصیص آزمون برای حفظ تاریخچه',
      bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id, customerAdvanceLedgerId: advance.id,
      receivableLedgerId: receivable.id, documentDate: reversedAt, idempotencyKey: `allocation-reversal-${temporary.runId}`,
      correlationId: `allocation-reversal-correlation-${temporary.runId}`, actor });
    const historical = await projectCustomerAccountPrisma(database, { profileId: profile.id, asOf: new Date(reversedAt.getTime() - 1) });
    const afterReversal = await projectCustomerAccountPrisma(database, { profileId: profile.id, asOf: new Date(reversedAt.getTime() + 1_000) });
    assert.equal(historical.receivableRials, 0n);
    assert.equal(afterReversal.receivableRials, 1_100n);
    const exported = await exportCustomerStatementPrisma(database, { profileId: profile.id,
      asOf: new Date(reversedAt.getTime() + 1_000), format: 'xlsx', actorId: actor.id });
    const exportedRetry = await exportCustomerStatementPrisma(database, { profileId: profile.id,
      asOf: new Date(reversedAt.getTime() + 1_000), format: 'xlsx', actorId: actor.id });
    assert.deepEqual(exported.bytes, exportedRetry.bytes);
    assert.equal(await database.accountingCustomerStatementExport.count(), 1);
    const outbox = await database.accountingTaxOutboxMessage.findFirstOrThrow();
    const foreignChannel = await configureTaxSubmissionChannelPrisma(database, { legalEntityId: 'foreign-entity', kind: 'DIRECT',
      safeKeyVersion: 'key-v1', secretReference: 'vault://tax/foreign', effectiveFrom: new Date('2026-03-21T00:00:00Z'), actor });
    await assert.rejects(() => bindTaxOutboxChannelPrisma(database, { outboxMessageId: outbox.id, channelId: foreignChannel.id }),
      /کانال مالیاتی مؤثر/);
    await database.accountingTaxOutboxMessage.update({ where: { id: outbox.id }, data: {
      status: 'PROCESSING', claimedAt: new Date(Date.now() - 10 * 60_000) } });
    let submittedCredential = '';
    await processNextTaxOutboxMessagePrisma(database, {
      resolveSecret: async (reference) => { assert.equal(reference, 'vault://tax/channel-1'); return 'resolved-secret'; },
      submit: async ({ credential, requestIdentity, payload }) => { submittedCredential = credential;
        assert.equal(requestIdentity, `tax-request-${sale.taxInvoice!.id}`); assert.ok(payload);
        return { externalUniqueTaxId: `tax-external-${temporary.runId}`, receiptNumber: 'receipt-tax-1',
          safeResponse: { status: 'accepted', accessToken: 'must-not-persist', nested: { apiKey: 'must-not-persist', receipt: 'safe' } } }; },
    });
    assert.equal(submittedCredential, 'resolved-secret');
    const attempt = await database.accountingTaxSubmissionAttempt.findFirstOrThrow();
    assert.deepEqual(attempt.safeResponse, { status: 'accepted', nested: { receipt: 'safe' } });
    assert.equal((await database.accountingTaxInvoice.findFirstOrThrow()).status, 'SUBMITTED');
    await assert.rejects(() => database.accountingCustomerOpenItem.update({ where: { id: sale.openItem.id }, data: { originalRials: '1' } }), /ACCOUNTING_IMMUTABLE_RECORD/);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
