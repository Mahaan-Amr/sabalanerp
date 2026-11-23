import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { hashCustomerTreasuryEvidence } from '../accountingCustomerTreasury';
import { verifyGuardPhysicalReturn } from '../dispatchCorrectionOutage';
import { readStoneReturnAvailability } from '../stoneReturnAvailability';
import { recordStoneReturnReceipt } from '../stoneReturnReceipts';
import { readStoneReturnAllocationReview, saveStoneReturnAllocationDraft } from '../stoneReturnAllocationDraft';
import { finalizeStoneReturn, readStoneReturnPostingContext } from '../stoneReturnFinalization';
import { readShipmentQuantityProjection, shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { importBankStatementFilePrisma, resolveBankFileExceptionPrisma } from '../accountingBankFileImport';
import { listPostedJournal, listPostedTrialBalance, verifyLedgerAuditChain } from '../accountingLedgerPrismaRepository';
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
  publishInventoryCostEvidencePrisma,
  publishInventoryValuationEvidencePrisma,
  importBankStatementLinePrisma,
  proposeBankMatchesPrisma,
  confirmBankMatchPrisma,
  listTreasuryOverviewPrisma,
  recognizeCustomerReturnPrisma,
  recognizeCustomerReturnWithin,
  recognizeCustomerSalePrisma,
  recordCustomerReceiptPrisma,
} from '../accountingCustomerTreasuryPrisma';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('customer revenue and treasury tracer bullet persists once and projects only posted evidence', { skip: !sourceDatabaseUrl, timeout: 240_000 }, async (t) => {
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
    await assert.rejects(() => importBankStatementLinePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, sourceIdentity: '', bookedAt: new Date(0), amountRials: 0n,
      direction: 'INBOUND', description: '', evidence: { ...rawBankEvidence, note: 'changed untrusted evidence' } }),
    /شناسه منبع ردیف بانکی/);
    await assert.rejects(() => importBankStatementLinePrisma(database, { financialAccountId: financial.id,
      adapterType: 'MANUAL', mappingVersion: 1, sourceIdentity: 'bank-line-1', bookedAt: new Date('2026-09-25T08:00:00Z'),
      amountRials: 1_200n, direction: 'INBOUND', description: 'واریز مشتری نمونه', evidence: rawBankEvidence }),
    /شناسه منبع ردیف بانکی/);
    const officialBeforeImport = await listPostedTrialBalance(database, { bookId: book.id, fiscalYearId: year.id });
    assert.ok(officialBeforeImport.some((item) => BigInt(item.debitRials.toFixed(0)) === 1_200n));
    const postedJournal = await listPostedJournal(database, { bookId: book.id, fiscalYearId: year.id });
    assert.ok(postedJournal.some((item) => item.id === receipt.postedVoucherId));
    const fileBase64 = Buffer.from('reference,date,amount,direction,description\nfile-line-1,2026-09-25T08:00:00Z,1200,credit,واریز مشتری نمونه\nfile-line-bad,2026-09-25T08:00:00Z,unknown,credit,ردیف ناسازگار\n').toString('base64');
    const importedFile = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, fileBase64, actorId: actor.id });
    assert.equal(importedFile.imported, 1);
    assert.equal(importedFile.rejected, 1);
    assert.match(String((importedFile.results as any[])[1].reason || ''), /مبلغ ردیف بانکی نامعتبر/);
    await assert.rejects(() => importBankStatementLinePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, sourceIdentity: '', bookedAt: new Date(0), amountRials: 0n,
      direction: 'INBOUND', description: '', evidence: { rawRecord: {
        reference: 'file-date-bad', date: 'invalid-date', amount: '1200', direction: 'credit', description: 'تاریخ نامعتبر',
      } } }), /تاریخ ردیف بانکی نامعتبر/);
    const rejectedCase = await database.accountingExceptionCase.findUniqueOrThrow({ where: {
      sourceType_sourceId_sourceVersion_code: { sourceType: 'BANK_STATEMENT_FILE',
        sourceId: `${financial.id}:${importedFile.fileHash}:3`, sourceVersion: 1, code: 'BANK_SOURCE_ROW_INVALID' },
    } });
    assert.equal(rejectedCase.assignedUserId, actor.id);
    const repeatedFile = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, fileBase64, actorId: actor.id });
    assert.equal(repeatedFile.id, importedFile.id);
    assert.equal((repeatedFile.results as any[])[0].lineId, (importedFile.results as any[])[0].lineId);
    const overlappingFile = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, actorId: actor.id,
      fileBase64: Buffer.from('reference,date,amount,direction,description\nfile-line-1,2026-09-25T08:00:00Z,1200,credit,واریز مشتری نمونه\n').toString('base64') });
    assert.equal(overlappingFile.rejected, 0);
    assert.equal((overlappingFile.results as any[])[0].lineId, (importedFile.results as any[])[0].lineId);
    const proposed = await proposeBankMatchesPrisma(database, (importedFile.results as any[])[0].lineId!);
    const matchingReceipt = proposed.find((item) => item.treasuryTransactionId === receipt.id);
    assert.ok(matchingReceipt);
    await confirmBankMatchPrisma(database, { matchId: matchingReceipt.id, actor, reason: 'تطبیق صورت‌حساب و دریافت مشتری' });
    const treasury = await listTreasuryOverviewPrisma(database);
    assert.equal(treasury.bankMappings[0].version, 1);
    assert.equal(treasury.bankLines.find((item) => item.id === (importedFile.results as any[])[0].lineId)?.matches[0].status, 'CONFIRMED');
    assert.ok(treasury.bankFileImports.some((item) => item.id === importedFile.id));
    assert.equal(treasury.bankExceptions[0].id, rejectedCase.id);
    const correctedFile = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, actorId: actor.id,
      fileBase64: Buffer.from('reference,date,amount,direction,description\nfile-line-bad,2026-09-25T08:00:00Z,1200,credit,ردیف اصلاح‌شده\n').toString('base64') });
    await assert.rejects(() => resolveBankFileExceptionPrisma(database, { exceptionId: rejectedCase.id,
      correctedRunId: overlappingFile.id, correctedRowNumber: 2, reason: 'ارجاع اشتباه به ردیف دیگر', actorId: actor.id,
      actorProfile: 'ACCOUNTANT' }),
    /شناسه ردیف اصلاح‌شده/);
    const resolvedCase = await resolveBankFileExceptionPrisma(database, { exceptionId: rejectedCase.id,
      correctedRunId: correctedFile.id, correctedRowNumber: 2, reason: 'اصلاح مبلغ در فایل جدید بانک', actorId: actor.id,
      actorProfile: 'ACCOUNTANT' });
    assert.equal(resolvedCase.status, 'RESOLVED');
    assert.equal((resolvedCase.resolutionEvidence as any).correctedLineId, (correctedFile.results as any[])[0].lineId);
    assert.equal((await listTreasuryOverviewPrisma(database)).bankExceptions.length, 0);
    const identitylessFile = Buffer.from('reference,actualReference,date,amount,direction,description\n,corrected-identity,2026-09-25T08:00:00Z,1200,credit,ردیف بدون شناسه در نگاشت نخست\n').toString('base64');
    const rejectedIdentity = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, fileBase64: identitylessFile, actorId: actor.id });
    assert.equal(rejectedIdentity.rejected, 1);
    await createBankImportMappingPrisma(database, { financialAccountId: financial.id, adapterType: 'CSV', version: 2,
      effectiveFrom: year.startsAt, columnMapping: { sourceIdentityField: 'actualReference', bookedAtField: 'date', amountField: 'amount',
        directionField: 'direction', descriptionField: 'description', inboundValues: ['credit'], outboundValues: ['debit'] }, actor });
    const remappedIdentity = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 2, fileBase64: identitylessFile, actorId: actor.id });
    assert.equal(remappedIdentity.imported, 1);
    const identityCase = await database.accountingExceptionCase.findUniqueOrThrow({ where: { id: (rejectedIdentity.results as any[])[0].exceptionId } });
    const remappedResolution = await resolveBankFileExceptionPrisma(database, { exceptionId: identityCase.id,
      correctedRunId: remappedIdentity.id, correctedRowNumber: 2, reason: 'اصلاح نگاشت شناسه منبع بانکی', actorId: actor.id,
      actorProfile: 'ACCOUNTANT' });
    assert.equal((remappedResolution.resolutionEvidence as any).linkBasis, 'UNCHANGED_SOURCE_ROW');
    assert.equal((await listTreasuryOverviewPrisma(database)).bankExceptions.length, 0);
    const missingIdentity = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, actorId: actor.id,
      fileBase64: Buffer.from('reference,actualReference,date,amount,direction,description\n,,2026-09-25T08:00:00Z,1200,credit,بدون شناسه\n').toString('base64') });
    const amendedIdentity = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 2, actorId: actor.id,
      fileBase64: Buffer.from('reference,actualReference,date,amount,direction,description\n,attested-identity,2026-09-25T08:00:00Z,1200,credit,بدون شناسه\n').toString('base64') });
    const missingCaseId = (missingIdentity.results as any[])[0].exceptionId;
    await assert.rejects(() => resolveBankFileExceptionPrisma(database, { exceptionId: missingCaseId,
      correctedRunId: amendedIdentity.id, correctedRowNumber: 2, reason: 'اصلاح شناسه با تایید مدیر حسابداری',
      actorId: actor.id, actorProfile: 'ACCOUNTANT', attestUnlinkedCorrection: true }), /شناسه ردیف اصلاح‌شده/);
    const attested = await resolveBankFileExceptionPrisma(database, { exceptionId: missingCaseId,
      correctedRunId: amendedIdentity.id, correctedRowNumber: 2, reason: 'اصلاح شناسه با تایید مدیر حسابداری',
      actorId: actor.id, actorProfile: 'ACCOUNTING_MANAGER', attestUnlinkedCorrection: true });
    assert.equal((attested.resolutionEvidence as any).linkBasis, 'MANAGER_ATTESTATION');
    assert.equal((await listTreasuryOverviewPrisma(database)).bankExceptions.length, 0);
    const savedRun = await database.accountingBankFileImportRun.findUniqueOrThrow({ where: { id: importedFile.id } });
    const mismatchedOriginal = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, actorId: actor.id,
      fileBase64: Buffer.from('reference,actualReference,date,amount,direction,description\noriginal-identity,other-identity,2026-09-25T08:00:00Z,invalid,credit,اصلاح نگاشت\n').toString('base64') });
    const mismatchedCorrection = await importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 2, actorId: actor.id,
      fileBase64: Buffer.from('reference,actualReference,date,amount,direction,description\noriginal-identity,other-identity,2026-09-25T08:00:00Z,1200,credit,اصلاح نگاشت\n').toString('base64') });
    await assert.rejects(() => resolveBankFileExceptionPrisma(database, {
      exceptionId: (mismatchedOriginal.results as any[])[0].exceptionId,
      correctedRunId: mismatchedCorrection.id, correctedRowNumber: 2, reason: 'شناسه قدیمی در ستون دیگری باقی مانده',
      actorId: actor.id, actorProfile: 'ACCOUNTANT' }), /شناسه ردیف اصلاح‌شده/);
    assert.equal(await database.accountingLedgerAuditEntry.count({ where: { action: 'BANK_FILE_IMPORTED', entityId: importedFile.id } }), 1);
    const overrideAudit = await database.accountingLedgerAuditEntry.findFirstOrThrow({ where: {
      action: 'BANK_FILE_EXCEPTION_RESOLVED', entityId: missingCaseId } });
    assert.equal(overrideAudit.effectiveProfile, 'ACCOUNTING_MANAGER');
    assert.equal((overrideAudit.sessionContext as any).linkBasis, 'MANAGER_ATTESTATION');
    assert.equal((savedRun.sourceRows as any[])[1].rawRecord.reference, 'file-line-bad');
    assert.deepEqual(Buffer.from(savedRun.sourceFile), Buffer.from(fileBase64, 'base64'));
    await database.$executeRawUnsafe(`CREATE FUNCTION reject_bank_file_run_test() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected bank run persistence failure'; END; $$ LANGUAGE plpgsql`);
    await database.$executeRawUnsafe(`CREATE TRIGGER reject_bank_file_run_test BEFORE INSERT ON accounting_bank_file_import_runs
      FOR EACH ROW EXECUTE FUNCTION reject_bank_file_run_test()`);
    const failedFileBase64 = Buffer.from('reference,date,amount,direction,description\nfile-line-failure,2026-09-25T08:00:00Z,1200,credit,شکست آزمون\n').toString('base64');
    await assert.rejects(() => importBankStatementFilePrisma(database, { financialAccountId: financial.id,
      adapterType: 'CSV', mappingVersion: 1, fileBase64: failedFileBase64, actorId: actor.id }), /injected bank run persistence failure/);
    assert.equal(await database.accountingBankStatementLine.count({ where: { sourceIdentity: 'file-line-failure' } }), 0);
    await database.$executeRawUnsafe('DROP TRIGGER reject_bank_file_run_test ON accounting_bank_file_import_runs');
    await database.$executeRawUnsafe('DROP FUNCTION reject_bank_file_run_test()');
    await assert.rejects(() => database.accountingBankFileImportRun.update({ where: { id: importedFile.id },
      data: { rejected: 0 } }), /Accounting bank file import evidence is immutable/);
    assert.equal(await database.accountingLedgerVoucher.count({ where: { sourceType: 'BANK_STATEMENT_FILE' } }), 0);
    const officialAfterImport = await listPostedTrialBalance(database, { bookId: book.id, fiscalYearId: year.id });
    assert.deepEqual(officialAfterImport, officialBeforeImport);
    const pageFile = Buffer.from(['reference,date,amount,direction,description', ...Array.from({ length: 101 }, (_, i) =>
      `page-${i},2026-09-25T08:00:00Z,1200,credit,ردیف صفحه‌بندی ${i}`)].join('\n')).toString('base64');
    await importBankStatementFilePrisma(database, { financialAccountId: financial.id, adapterType: 'CSV',
      mappingVersion: 1, actorId: actor.id, fileBase64: pageFile });
    const firstPage = await listTreasuryOverviewPrisma(database);
    const secondPage = await listTreasuryOverviewPrisma(database, { bankLinePage: 2 });
    assert.equal(firstPage.bankLines.length, 100);
    assert.equal(firstPage.bankLinesHasMore, true);
    assert.equal(secondPage.bankLinesHasMore, false);
    assert.equal(new Set([...firstPage.bankLines, ...secondPage.bankLines].map((line) => line.id)).size,
      await database.accountingBankStatementLine.count());
    await assert.rejects(() => listTreasuryOverviewPrisma(database, { bankLinePage: 0 }), /شماره صفحه/);
    const concurrentInput = { financialAccountId: financial.id, adapterType: 'CSV' as const,
      mappingVersion: 1, actorId: actor.id,
      fileBase64: Buffer.from('reference,date,amount,direction,description\nconcurrent-file,2026-09-25T08:00:00Z,1200,credit,ورود هم‌زمان\n').toString('base64') };
    const concurrentRuns = await Promise.all([importBankStatementFilePrisma(database, concurrentInput),
      importBankStatementFilePrisma(database, concurrentInput)]);
    assert.equal(concurrentRuns[0].id, concurrentRuns[1].id);
    assert.equal(await database.accountingLedgerAuditEntry.count({ where: { action: 'BANK_FILE_IMPORTED', entityId: concurrentRuns[0].id } }), 1);
    assert.equal((await verifyLedgerAuditChain(database)).valid, true);
    const allocation = await allocateCustomerReceiptPrisma(database, { treasuryTransactionId: receipt.id, allocations: [{ openItemId: sale.openItem.id, amountRials: 1_100n }],
      bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id, customerAdvanceLedgerId: advance.id,
      receivableLedgerId: receivable.id, documentDate: new Date('2026-09-25T08:01:00Z'), idempotencyKey: `allocation-${temporary.runId}`,
      correlationId: `allocation-correlation-${temporary.runId}`, actor });
    const projection = await projectCustomerAccountPrisma(database, { profileId: profile.id, asOf: new Date(Date.now() + 1_000) });
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
    let ambiguousSubmissions = 0;
    const interruptedAdapter = { resolveSecret: async () => 'isolated-secret', submit: async () => {
      ambiguousSubmissions++; throw new Error('Injected connection loss after provider acceptance');
    } };
    assert.equal(await processNextTaxOutboxMessagePrisma(database, interruptedAdapter), null);
    assert.equal((await database.accountingTaxOutboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status, 'UNKNOWN');
    assert.equal(ambiguousSubmissions, 0, 'an interrupted prior owner is not permission to submit again');
    await assert.rejects(() => bindTaxOutboxChannelPrisma(database, { outboxMessageId: outbox.id, channelId: outbox.channelId! }),
      /نتیجه.*نامشخص/);
    // Fixture-only reset starts a distinct ambiguity scenario; production has no reset path.
    await database.accountingTaxOutboxMessage.update({ where: { id: outbox.id }, data: { status: 'PENDING', claimedAt: null } });
    await assert.rejects(() => processNextTaxOutboxMessagePrisma(database, interruptedAdapter), /Injected connection loss/);
    assert.equal((await database.accountingTaxOutboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status, 'UNKNOWN');
    assert.equal(await processNextTaxOutboxMessagePrisma(database, interruptedAdapter), null);
    assert.equal(ambiguousSubmissions, 1);
    assert.equal((await database.accountingTaxSubmissionAttempt.findFirstOrThrow({ where: { status: 'UNKNOWN' } })).errorCode, 'TAX_SUBMISSION_OUTCOME_UNKNOWN');
    await database.accountingTaxOutboxMessage.update({ where: { id: outbox.id }, data: { status: 'PENDING', claimedAt: null } });
    await database.$executeRawUnsafe(`CREATE FUNCTION qa_reject_tax_success() RETURNS trigger AS $$
      BEGIN IF NEW.status = 'SUCCEEDED' THEN RAISE EXCEPTION 'injected receipt persistence failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await database.$executeRawUnsafe(`CREATE TRIGGER qa_reject_tax_success BEFORE INSERT ON accounting_tax_submission_attempts
      FOR EACH ROW EXECUTE FUNCTION qa_reject_tax_success()`);
    let acceptedBeforePersistenceFailure = 0;
    try {
      await assert.rejects(() => processNextTaxOutboxMessagePrisma(database, {
        resolveSecret: async () => 'isolated-secret', submit: async () => {
          acceptedBeforePersistenceFailure++; return { externalUniqueTaxId: 'isolated-provider-accepted' };
        },
      }), /injected receipt persistence failure/);
      assert.equal((await database.accountingTaxOutboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status, 'UNKNOWN');
      assert.equal(await processNextTaxOutboxMessagePrisma(database, interruptedAdapter), null);
      assert.equal(acceptedBeforePersistenceFailure, 1);
    } finally {
      await database.$executeRawUnsafe('DROP TRIGGER qa_reject_tax_success ON accounting_tax_submission_attempts');
      await database.$executeRawUnsafe('DROP FUNCTION qa_reject_tax_success()');
    }
    // The existing success assertions use a separate controlled fixture attempt.
    await database.accountingTaxOutboxMessage.update({ where: { id: outbox.id }, data: { status: 'PENDING', claimedAt: null } });
    let submittedCredential = '';
    let successAcknowledgementLost = false;
    const lostAcknowledgementDatabase = new Proxy(database, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return async (...args: any[]) => {
        const result = await (database.$transaction as any)(...args);
        if (result?.status === 'SUCCEEDED' && !successAcknowledgementLost) {
          successAcknowledgementLost = true; throw new Error('Injected lost commit acknowledgement');
        }
        return result;
      };
    } });
    await assert.rejects(() => processNextTaxOutboxMessagePrisma(lostAcknowledgementDatabase, {
      resolveSecret: async (reference) => { assert.equal(reference, 'vault://tax/channel-1'); return 'resolved-secret'; },
      submit: async ({ credential, requestIdentity, payload }) => { submittedCredential = credential;
        assert.equal(requestIdentity, `tax-request-${sale.taxInvoice!.id}`); assert.ok(payload);
        return { externalUniqueTaxId: `tax-external-${temporary.runId}`, receiptNumber: 'receipt-tax-1',
          safeResponse: { status: 'accepted', accessToken: 'must-not-persist', nested: { apiKey: 'must-not-persist', receipt: 'safe' } } }; },
    }), /Injected lost commit acknowledgement/);
    assert.equal(submittedCredential, 'resolved-secret');
    assert.equal(await processNextTaxOutboxMessagePrisma(database, interruptedAdapter), null);
    assert.equal((await database.accountingTaxOutboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status, 'SENT');
    assert.equal(await database.accountingTaxSubmissionAttempt.count({ where: { status: 'SUCCEEDED' } }), 1);
    const attempt = await database.accountingTaxSubmissionAttempt.findFirstOrThrow({ where: { status: 'SUCCEEDED' } });
    assert.deepEqual(attempt.safeResponse, { status: 'accepted', nested: { receipt: 'safe' } });
    assert.equal((await database.accountingTaxInvoice.findFirstOrThrow()).status, 'SUBMITTED');
    await assert.rejects(() => database.accountingCustomerOpenItem.update({ where: { id: sale.openItem.id }, data: { originalRials: '1' } }), /ACCOUNTING_IMMUTABLE_RECORD/);

    await t.test('verified Guard return is atomic with its caller and can be reposted once after rollback', async (returnTest) => {
      const returnedAt = new Date('2026-09-28T08:00:00Z');
      const customer = await database.crmCustomer.create({
        data: { id: command.partySourceId, firstName: 'مشتری', lastName: 'نمونه' },
      });
      const department = await database.department.create({ data: { name: 'Return QA', namePersian: 'آزمون مرجوعی' } });
      await database.user.create({ data: { id: actor.id, username: 'return-accountant',
        email: 'return-accountant@example.invalid', password: 'test-only', firstName: 'حسابدار', lastName: 'آزمون' } });
      const product = await database.product.create({ data: {
        code: 'return-test-stone', name: 'Test stone', namePersian: 'سنگ آزمون',
        cuttingDimensionCode: 'slab', cuttingDimensionName: 'Slab', cuttingDimensionNamePersian: 'اسلب',
        stoneTypeCode: 'granite', stoneTypeName: 'Granite', stoneTypeNamePersian: 'گرانیت',
        widthCode: 'w60', widthValue: 60, widthName: '۶۰',
        thicknessCode: 't2', thicknessValue: 2, thicknessName: '۲',
        mineCode: 'test', mineName: 'Test mine', mineNamePersian: 'معدن آزمون',
        finishCode: 'flame', finishName: 'Flame', finishNamePersian: 'فلیم',
        colorCode: 'gray', colorName: 'Gray', colorNamePersian: 'طوسی',
        qualityCode: 'a', qualityName: 'A', qualityNamePersian: 'درجه یک', images: [],
      } });
      const originalLine = command.lines[0];
      const contract = await database.salesContract.create({ data: {
        id: command.contractId, contractNumber: command.contractId, title: 'Return QA', titlePersian: 'آزمون مرجوعی',
        content: '', customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
        contractData: { products: [{ rowId: originalLine.productRowId, productId: product.id, quantity: 2, unit: 'count' }] },
      } });
      const item = await database.contractItem.create({ data: {
        contractId: contract.id, productId: product.id, productRowId: originalLine.productRowId, quantity: 2,
        unitPrice: 500, totalPrice: 1000,
      } });
      const project = await database.projectAddress.create({ data: { customerId: customer.id, address: 'نشانی آزمون' } });
      const loading = await database.logisticsLoading.create({ data: { loadingNumber: 'return-fixture-loading',
        customerId: customer.id, projectId: project.id, createdBy: actor.id } });
      const dispatchEvidence = {
        id: 'return-fixture-dispatch', contractId: contract.id, contractItemId: item.id,
        productRowId: originalLine.productRowId, unit: 'count', kind: 'PHYSICAL_EXIT' as const, quantity: '2.000',
        effectiveAt: command.transferredAt.toISOString(), recordedAt: command.transferredAt.toISOString(),
        sourceType: 'GUARD_PHYSICAL_EXIT', sourceId: 'return-fixture-exit', sourceVersion: 1,
        metadata: { loadingId: loading.id },
      };
      await database.shipmentQuantityEvidence.create({ data: { ...dispatchEvidence,
        integrityHash: shipmentQuantityEvidenceIntegrityHash({ ...dispatchEvidence, integrityHash: '' }),
      } });
      const movement = await database.securityVehicleMovement.create({ data: { movementNumber: 'return-fixture-movement',
        direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED',
        customerId: customer.id, loadingId: loading.id, occurredAt: returnedAt, completedAt: returnedAt, createdBy: actor.id,
      } });
      const returnEvidence = await verifyGuardPhysicalReturn(database, { movementId: movement.id,
        dispatchEvidenceId: dispatchEvidence.id, quantity: '1.000', actorId: actor.id,
        authority: { actorRole: 'ADMIN', workspace: 'guard', workspacePermission: 'admin' },
      });

      const returnCommand = {
        originalInvoiceId: sale.invoice.id, commercialCreditNumber: 'credit-1',
        bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
        returnedAt, evidenceIds: [returnEvidence.id], lines: [{
          id: 'credit-line-1', originalLineId: originalLine.id, evidenceId: returnEvidence.id,
          productRowId: originalLine.productRowId, quantity: '1.000', netRials: 500n, taxRials: 50n,
          costRials: 300n, taxRule: originalLine.taxRule,
        }], postingRule: command.postingRule, idempotencyKey: 'credit-1', correlationId: 'credit-correlation-1', actor,
      };
      const accountAt = { profileId: profile.id, asOf: new Date(Date.now() + 1_000) };
      const journalScope = { bookId: book.id, fiscalYearId: year.id };
      const journalBefore = await listPostedJournal(database, journalScope);
      const abort = new Error('Caller rejected the return');

      await returnTest.test('negotiated credit above the entire original invoice preserves its original reversals and rolls back atomically', async () => {
        const originalTaxLine = await database.accountingTaxInvoiceLine.findUniqueOrThrow({
          where: { taxInvoiceId_sourceLineId: { taxInvoiceId: sale.taxInvoice!.id, sourceLineId: originalLine.id } },
        });
        const negotiatedCredit = { caseId: 'stone-return-case-1', agreedGrossRials: 1_500n, lines: [{
          lineId: 'credit-line-1', agreedUnitRateRials: '1500', rateDifferenceReason: 'توافق برای قبول برگشت',
        }] };
        await assert.rejects(database.$transaction(async (tx) => {
          const staged = await recognizeCustomerReturnWithin(tx, returnCommand, negotiatedCredit);
          assert.equal(staged.grossRials.toFixed(0), '550');
          assert.equal((await projectCustomerAccountPrisma(tx, accountAt)).standaloneCreditRials, 1_500n);
          const voucher = (await listPostedJournal(tx, journalScope)).find((entry) => entry.id === staged.ledgerVoucherId);
          assert.ok(voucher);
          const postedAmounts = voucher.lines.map((line) => [line.accountId, line.debitRials.toFixed(0), line.creditRials.toFixed(0)]);
          assert.deepEqual(postedAmounts, [
            [revenue.id, '500', '0'], [tax.id, '50', '0'], [revenue.id, '950', '0'],
            [receivable.id, '0', '1500'], [inventory.id, '300', '0'], [cost.id, '0', '300'],
          ]);
          assert.equal(voucher.lines.find((line) => line.accountId === receivable.id)?.partyId, profile.accountingPartyId);
          const returnTaxInvoice = await tx.accountingTaxInvoice.findUniqueOrThrow({
            where: { id: staged.taxInvoiceId! }, include: { lines: true, outboxMessages: true },
          });
          assert.equal(returnTaxInvoice.referenceTaxInvoiceId, sale.taxInvoice?.id);
          assert.equal(returnTaxInvoice.documentKind, 'RETURN');
          assert.equal(returnTaxInvoice.outboxMessages.length, 1);
          const [taxLine] = returnTaxInvoice.lines;
          assert.equal(taxLine.rawBaseAmount.toFixed(0), '500');
          assert.equal(taxLine.roundedTaxRials.toFixed(0), '50');
          assert.equal(taxLine.costRials.toFixed(0), '300');
          assert.equal(taxLine.taxRuleId, originalLine.taxRule.id);
          assert.equal(taxLine.taxRuleVersion, originalLine.taxRule.version);
          assert.equal(taxLine.citation, originalLine.taxRule.citation);
          assert.equal(taxLine.exempt, originalLine.taxRule.exempt);
          assert.deepEqual(taxLine.allocationEvidence, {
            returnEvidenceId: returnEvidence.id, originalLineId: originalLine.id,
            originalTaxLineId: originalTaxLine.id, rateBasisPoints: 1000,
          });
          const postedEvidence = await tx.accountingLedgerVoucher.findUniqueOrThrow({
            where: { id: staged.ledgerVoucherId }, select: { sourcePayload: true, lines: { select: { evidenceType: true } } },
          });
          const payload = postedEvidence.sourcePayload as Prisma.JsonObject;
          assert.deepEqual(payload.negotiatedCredit, {
            caseId: 'stone-return-case-1', originalInvoiceId: sale.invoice.id, originalTaxInvoiceId: sale.taxInvoice!.id,
            agreedGrossRials: '1500', standardGrossRials: '550', commercialDifferenceRials: '950',
            lines: [{ lineId: 'credit-line-1', agreedUnitRateRials: '1500', rateDifferenceReason: 'توافق برای قبول برگشت',
              originalLineId: originalLine.id, originalTaxLineId: originalTaxLine.id, returnEvidenceId: returnEvidence.id,
              quantity: '1.000', netRials: '500', taxRials: '50', costRials: '300', taxRule: originalLine.taxRule }],
          });
          assert.equal(postedEvidence.lines.filter((line) => line.evidenceType === 'CUSTOMER_RETURN_COMMERCIAL_DIFFERENCE').length, 1);
          assert.equal((await recognizeCustomerReturnWithin(tx, returnCommand, negotiatedCredit)).id, staged.id);
          for (const changedTerms of [
            { ...negotiatedCredit, caseId: 'different-case' },
            { ...negotiatedCredit, agreedGrossRials: 1_501n },
            { ...negotiatedCredit, lines: [{ ...negotiatedCredit.lines[0], agreedUnitRateRials: '1501' }] },
            { ...negotiatedCredit, lines: [{ ...negotiatedCredit.lines[0], rateDifferenceReason: 'علت دیگری برای همان توافق' }] },
          ]) {
            await assert.rejects(recognizeCustomerReturnWithin(tx, returnCommand, changedTerms), { code: 'IDEMPOTENCY_KEY_REUSED' });
          }
          throw abort;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), (error) => error === abort);
        assert.equal((await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials, 0n);
        assert.deepEqual(await listPostedJournal(database, journalScope), journalBefore);
      });
      await returnTest.test('lower rates require a reason and equal net rates preserve the original VAT independently', async () => {
        const terms = { caseId: 'stone-return-case-1', agreedGrossRials: 400n,
          lines: [{ lineId: 'credit-line-1', agreedUnitRateRials: '400' }] };
        const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
        await assert.rejects(database.$transaction((tx) => recognizeCustomerReturnWithin(tx, returnCommand, terms),
          transactionOptions), { code: 'NEGOTIATED_RETURN_RATE_REASON_REQUIRED' });
        await assert.rejects(database.$transaction((tx) => recognizeCustomerReturnWithin(tx, returnCommand, {
          ...terms, agreedGrossRials: 500n, lines: [{ lineId: 'credit-line-1', agreedUnitRateRials: '499.999' }],
        }), transactionOptions), { code: 'NEGOTIATED_RETURN_RATE_REASON_REQUIRED' });

        for (const { agreedGrossRials, rate, reason, adjustment } of [
          { agreedGrossRials: 400n, rate: '400', reason: 'توافق درباره کاهش نرخ مرجوعی', adjustment: '150' },
          { agreedGrossRials: 500n, rate: '500.00', reason: undefined, adjustment: '50' },
        ]) {
          await assert.rejects(database.$transaction(async (tx) => {
            const credit = await recognizeCustomerReturnWithin(tx, returnCommand, {
              ...terms, agreedGrossRials,
              lines: [{ lineId: 'credit-line-1', agreedUnitRateRials: rate, rateDifferenceReason: reason }],
            });
            assert.equal(credit.grossRials.toFixed(0), '550');
            assert.equal(credit.taxRials.toFixed(0), '50');
            assert.equal((await projectCustomerAccountPrisma(tx, accountAt)).standaloneCreditRials, agreedGrossRials);
            const voucher = (await listPostedJournal(tx, journalScope)).find((entry) => entry.id === credit.ledgerVoucherId);
            assert.ok(voucher);
            assert.equal(voucher.lines.find((line) => line.accountId === revenue.id && line.creditRials.gt(0))?.creditRials.toFixed(0), adjustment);
            assert.equal(voucher.lines.find((line) => line.accountId === receivable.id)?.creditRials.toFixed(0), agreedGrossRials.toString());
            throw abort;
          }, transactionOptions), (error) => error === abort);
        }
      });

      await assert.rejects(database.$transaction(async (tx) => {
        const staged = await recognizeCustomerReturnWithin(tx, returnCommand);
        assert.equal(staged.status, 'CREDIT_NOTE');
        assert.equal((await projectCustomerAccountPrisma(tx, accountAt)).standaloneCreditRials, 550n);
        throw abort;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), (error) => error === abort);
      assert.equal((await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials, 0n);
      assert.deepEqual(await listPostedJournal(database, journalScope), journalBefore);

      const credit = await recognizeCustomerReturnPrisma(database, returnCommand);
      const replay = await recognizeCustomerReturnPrisma(database, returnCommand);

      assert.equal(replay.id, credit.id);
      assert.equal(credit.referenceInvoiceId, sale.invoice.id);
      assert.equal((await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials, 550n);
      const journal = await listPostedJournal(database, journalScope);
      const creditLine = journal.find((voucher) => voucher.id === credit.ledgerVoucherId)?.lines.find((line) => line.accountId === receivable.id);
      assert.equal(creditLine?.partyId, profile.accountingPartyId);
      assert.equal(creditLine.creditRials.toFixed(0), '550');

      await returnTest.test('Logistics 40/35 receipt posts one negotiated credit across two invoices, rolls back fully on a second-invoice error, and replays once', async () => {
        const dispatchAt = new Date('2026-09-22T08:00:00Z');
        const recognizedAt = new Date('2026-09-23T08:00:00Z');
        const postingDate = '2026-09-24';
        async function createOriginal(key: string, shipped: number, rate: bigint, unitCost: bigint) {
          const contractId = `excess-return-contract-${key}`;
          const productRowId = `excess-return-row-${key}`;
          const commercialInvoiceNumber = `excess-original-${key}`;
          await database.salesContract.create({ data: {
            id: contractId, contractNumber: contractId, title: 'Return QA', titlePersian: 'آزمون مرجوعی سنگ',
            content: '', customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
            contractData: { products: [{ rowId: productRowId, productId: product.id, quantity: shipped + 5, unit: 'squareMeter' }] },
          } });
          const item = await database.contractItem.create({ data: {
            contractId, productId: product.id, productRowId, quantity: shipped + 5,
            unitPrice: rate.toString(), totalPrice: (BigInt(shipped + 5) * rate).toString(),
          } });
          await provisionCustomerAccountingProfile(database, { ...profileInput, relationshipId: contractId,
            evidence: { contractId, version: 1, state: 'APPROVED' } });
          const events = [
            { kind: 'CONTRACTED_SET' as const, sourceType: 'CONTRACT_QUANTITY_VERSION', quantity: shipped + 5 },
            { kind: 'ALLOCATION_FINALIZED' as const, sourceType: 'LOGISTICS_ALLOCATION_REVISION', quantity: shipped },
            { kind: 'PHYSICAL_EXIT' as const, sourceType: 'GUARD_PHYSICAL_EXIT', quantity: shipped },
          ];
          for (const [index, event] of events.entries()) {
            const evidence = {
              id: `excess-return-${key}-${index}`, contractId, contractItemId: item.id, productRowId,
              unit: 'squareMeter', kind: event.kind, quantity: `${event.quantity}.000`,
              effectiveAt: dispatchAt.toISOString(), recordedAt: dispatchAt.toISOString(),
              sourceType: event.sourceType, sourceId: `excess-return-${key}-${index}`, sourceVersion: 1,
              metadata: index === 2 ? { loadingId: loading.id } : {},
            };
            await database.shipmentQuantityEvidence.create({ data: { ...evidence,
              integrityHash: shipmentQuantityEvidenceIntegrityHash({ ...evidence, integrityHash: '' }),
            } });
          }
          const dispatchEvidenceId = `excess-return-${key}-2`;
          const valuation = await publishInventoryValuationEvidencePrisma(database, {
            shipmentQuantityEvidenceId: dispatchEvidenceId, valuationVersion: 1, valuationMethod: 'SPECIFIC_IDENTIFICATION',
            inventoryDocumentId: `valuation-${key}`, unitCostRials: unitCost, actorId: actor.id,
          });
          const cost = await publishInventoryCostEvidencePrisma(database, { legalEntityId: entity.id, valuationEvidenceId: valuation.id });
          const netRials = BigInt(shipped) * rate;
          const costRials = BigInt(shipped) * unitCost;
          const policy = await createControlTransferPolicyPrisma(database, {
            contractId, version: 1, carriage: 'CONTRACTUAL_EXCEPTION', recognitionPoint: 'EXPLICIT_EXCEPTION',
            exceptionReason: 'شرط تحویل ویژه مصوب قرارداد آزمون', exceptionOccurredAt: recognizedAt,
            effectiveFrom: dispatchAt, exceptionTerms: [{ productRowId, quantity: String(shipped),
              netRials: netRials.toString(), costRials: costRials.toString() }], actor,
          });
          const baseEvidence = { id: policy.id, version: 1, type: 'CONTRACTUAL_EXCEPTION', occurredAt: recognizedAt,
            contractId, contractVersion: 1, productRows: [{ id: productRowId, quantity: String(shipped) }] };
          const posted = await recognizeCustomerSalePrisma(database, { ...command, contractId, commercialInvoiceNumber,
            transferredAt: recognizedAt, idempotencyKey: commercialInvoiceNumber, correlationId: commercialInvoiceNumber,
            policy: { ...command.policy, id: policy.id },
            evidence: { ...baseEvidence, hash: hashCustomerTreasuryEvidence(baseEvidence) },
            lines: [{ ...originalLine, id: key, productRowId, quantity: String(shipped), netRials, taxRials: netRials / 10n,
              costRials, costEvidenceId: cost.id }],
          });
          assert.equal(posted.kind, 'POSTED');
          if (posted.kind !== 'POSTED') throw new Error('Original sale did not post');
          return { contractId, originalInvoiceId: posted.invoice.id, originalTaxInvoiceId: posted.invoice.taxInvoiceId,
            originalLineId: key, dispatchEvidenceId };
        }
        const first = await createOriginal('a', 20, 1_200_000n, 100n);
        const second = await createOriginal('b', 30, 2_100_000n, 200n);
        const { data: accepted } = await recordStoneReturnReceipt(database, actor.id, {
          requestId: randomUUID(), customerId: customer.id, productId: product.id, unit: 'squareMeter',
          receivedQuantity: '40', acceptedQuantity: '35', rejectionReason: 'لب‌پریدگی',
        });
        assert.ok(accepted.inventoryIdentityId);
        const [{ quantity: available }] = (await readStoneReturnAvailability(database, [product.id])).get(product.id)!;
        assert.equal(available, '35');
        const rows = [{ ...first, quantity: '15' }, { ...second, quantity: '20' }];
        const attributionReason = 'بار ورودی فاقد شناسه بارگیری مبدأ است.';
        const draftInput = { expectedVersion: 0, rows: [rows[0]], attributionReason };
        const partial = await saveStoneReturnAllocationDraft(database, accepted.id, actor.id, draftInput);
        const rateDifferenceReason = 'توافق مدیر فروش و مشتری درباره نرخ سنگ مرجوعی';
        const returnCommand = { expectedVersion: partial.draft.version, requestId: 'certify-multi-reference',
          date: postingDate, periodId: command.periodId, postingRuleId: postingRule.id, confirmed: true,
          agreedUnitRateRials: '2500000.024', rateDifferenceReason };
        const accountant = { id: actor.id, profile: 'ACCOUNTANT' as const };
        await assert.rejects(finalizeStoneReturn(database, accepted.id, accountant, returnCommand), /کامل پوشش دهد/);
        const complete = await saveStoneReturnAllocationDraft(database, accepted.id, actor.id,
          { ...draftInput, expectedVersion: partial.draft.version, rows });
        returnCommand.expectedVersion = complete.draft.version;
        const postingContext = await readStoneReturnPostingContext(database, accepted.id, postingDate);
        assert.deepEqual(postingContext.periods.map(item => item.id), [command.periodId]);
        assert.deepEqual(postingContext.rules.map(item => item.id), [postingRule.id]);
        assert.deepEqual(postingContext.originalAmounts, { originalNetRials: '60000000', originalTaxRials: '6000000' });
        await assert.rejects(finalizeStoneReturn(database, accepted.id, accountant, {
          ...returnCommand, rateDifferenceReason: '   ',
        }), /دلیل تفاوت نرخ/);

        const accountBefore = (await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials;
        const availableToLoad = async () => Promise.all([first, second].map(async ({ contractId }) =>
          (await readShipmentQuantityProjection(database, { contractId })).rows[0].quantities?.availableToLoad));
        assert.deepEqual(await availableToLoad(), ['5.000', '5.000']);

        // Fail only the second original after shipment retirement, the first invoice and its inventory layer were staged.
        await database.$executeRawUnsafe(`CREATE FUNCTION qa_reject_second_excess_return() RETURNS trigger AS $$
        BEGIN
          IF NEW."referenceInvoiceId" = (SELECT max(id) FROM "accounting_commercial_customer_invoices"
            WHERE number IN ('excess-original-a', 'excess-original-b'))
          THEN RAISE EXCEPTION 'QA_SECOND_EXCESS_RETURN_FAILED'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql`);
        await database.$executeRawUnsafe(`CREATE TRIGGER qa_reject_second_excess_return BEFORE INSERT
          ON "accounting_commercial_customer_invoices" FOR EACH ROW EXECUTE FUNCTION qa_reject_second_excess_return()`);
        try {
          await assert.rejects(finalizeStoneReturn(database, accepted.id, accountant, returnCommand), /QA_SECOND_EXCESS_RETURN_FAILED/);
        } finally {
          await database.$executeRawUnsafe('DROP TRIGGER qa_reject_second_excess_return ON "accounting_commercial_customer_invoices"');
          await database.$executeRawUnsafe('DROP FUNCTION qa_reject_second_excess_return()');
        }
        const failed = await readStoneReturnAllocationReview(database, accepted.id);
        assert.equal(failed.allocationStatus, 'DRAFT');
        assert.equal(failed.finalization, null);
        assert.equal((await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials, accountBefore);
        assert.deepEqual(await availableToLoad(), ['5.000', '5.000']);
        assert.equal(await database.accountingInventoryValuationLayer.count({ where: { identityId: accepted.inventoryIdentityId } }), 0);
        assert.equal(await database.shipmentQuantityEvidence.count({ where: { kind: 'EXCESS_RETURN_FINALIZED' } }), 0);

        const outcomes = await Promise.all([
          finalizeStoneReturn(database, accepted.id, accountant, returnCommand),
          finalizeStoneReturn(database, accepted.id, accountant, returnCommand),
        ]);
        assert.equal(outcomes.filter(outcome => outcome.replayed).length, 1);
        assert.equal(outcomes[0].data.id, outcomes[1].data.id);
        const reviewed = await readStoneReturnAllocationReview(database, accepted.id);
        assert.equal(reviewed.allocationStatus, 'FINALIZED');
        assert.equal(reviewed.finalization?.draftVersion, complete.draft.version);
        assert.equal(reviewed.unallocatedQuantity, '0.000');
        await assert.rejects(saveStoneReturnAllocationDraft(database, accepted.id, actor.id,
          { ...draftInput, expectedVersion: complete.draft.version, rows }), /قبلاً ثبت قطعی/);
        await assert.rejects(finalizeStoneReturn(database, accepted.id, accountant, { ...returnCommand, date: '2026-09-25' }), /فرمان دیگری/);

        await assert.rejects(finalizeStoneReturn(database, accepted.id, accountant, {
          ...returnCommand, agreedUnitRateRials: '2500000.025',
        }), /فرمان دیگری/);

        const summary = outcomes[0].data.summary as Prisma.JsonObject;
        assert.equal(summary.agreedUnitRateRials, '2500000.024');
        assert.equal(summary.rateDifferenceReason, rateDifferenceReason);
        assert.equal(summary.originalNetRials, '60000000');
        assert.equal(summary.originalTaxRials, '6000000');
        // Rounding the two invoice shares independently would lose one rial.
        assert.equal(summary.customerCreditRials, '87500001');
        const credits = (summary.credits as Prisma.JsonArray) as Prisma.JsonObject[];
        assert.equal(credits.length, 2);
        const posted = await listPostedJournal(database, journalScope);
        const invoiceCredits = credits.map(item => {
          const voucher = posted.find(entry => entry.id === item.voucherId);
          assert.ok(voucher);
          const credit = voucher.lines.find(line => line.accountId === receivable.id);
          assert.ok(credit);
          assert.equal(item.customerCreditRials, credit.creditRials.toFixed(0));
          const revenueDebits = voucher.lines.filter(line => line.accountId === revenue.id && line.debitRials.gt(0));
          assert.deepEqual(revenueDebits.map(line => line.debitRials.toFixed(0)), [
            item.originalNetRials,
            (BigInt(credit.creditRials.toFixed(0)) - BigInt(String(item.originalNetRials)) - BigInt(String(item.originalTaxRials))).toString(),
          ]);
          return credit.creditRials.toFixed(0);
        });
        assert.equal(invoiceCredits.reduce((sum, part) => sum + BigInt(part), 0n), 87_500_001n);
        assert.equal((await projectCustomerAccountPrisma(database, accountAt)).standaloneCreditRials - accountBefore, 87_500_001n);
        assert.deepEqual(await availableToLoad(), ['5.000', '5.000']);
        const shares = await Promise.all([first, second].map(async ({ contractId }) =>
          (await readShipmentQuantityProjection(database, { contractId })).rows[0].quantities));
        assert.deepEqual(shares.map(row => [row?.contracted, row?.physicallyDispatched, row?.excessRetired]),
          [['10.000', '5.000', '15.000'], ['15.000', '10.000', '20.000']]);
        assert.deepEqual((await readStoneReturnAvailability(database, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);
        const layers = await database.accountingInventoryValuationLayer.findMany({ where: { identityId: accepted.inventoryIdentityId },
          orderBy: { quantity: 'asc' } });
        assert.deepEqual(layers.map(layer => [layer.quantity.toFixed(), layer.valueRials.toFixed()]), [['15', '1500'], ['20', '4000']]);
        const returnTax = await database.accountingTaxInvoice.findMany({ where: {
          documentKind: 'RETURN', referenceTaxInvoiceId: { in: [first.originalTaxInvoiceId!, second.originalTaxInvoiceId!] },
        }, orderBy: { netRials: 'asc' } });
        assert.deepEqual(returnTax.map(invoice => [invoice.referenceTaxInvoiceId, invoice.taxRials.toFixed(0)]), [
          [first.originalTaxInvoiceId, '1800000'], [second.originalTaxInvoiceId, '4200000'],
        ]);
      });
    });
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
