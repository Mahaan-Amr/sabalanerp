import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  AccountingCustomerTreasuryError,
  hashCustomerTreasuryEvidence,
  type CustomerSaleRecognitionCommand,
  type CustomerTreasuryActor,
  validateCustomerSaleEvidence,
} from './accountingCustomerTreasury';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { guardPhysicalExitIntegrityHash } from './physicalGateExit';
import { shipmentQuantityEvidenceIntegrityHash } from './shipmentQuantityProjectionStore';
import { generatePdfBufferFromHtml } from '../utils/pdf';

type Database = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const toBigInt = (value: Prisma.Decimal | bigint | number | string) => BigInt(value.toString());
const sanitizeProviderResponse = (value: unknown): Prisma.InputJsonValue => {
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .filter(([key]) => !/(secret|private|credential|password|token|authorization|api[-_]?key)/i.test(key))
      .map(([key, nested]) => [key, redact(nested)]));
    return item;
  };
  return json(redact(value));
};
const ledgerApp = (database: Database, now: Date) => createAccountingLedgerApplication(
  createAccountingLedgerPrismaRepository(database, true),
  { now: () => now, nextReference: () => `ACC-${now.getUTCFullYear()}-${randomUUID()}` },
);
const lineEvidence = (type: string, id: string, version: number, payload: unknown) => ({
  type, id, version, payload, hash: hashAccountingEvidence(payload),
});
const ledgerLine = (input: { accountId: string; debitRials?: bigint; creditRials?: bigint; partyId?: string;
  financialAccountId?: string; evidence: ReturnType<typeof lineEvidence>; description: string }) => ({
  accountId: input.accountId, partyId: input.partyId, financialAccountId: input.financialAccountId,
  debitRials: input.debitRials ?? 0n, creditRials: input.creditRials ?? 0n, description: input.description,
  dimensions: [], originalAmount: (input.debitRials ?? input.creditRials ?? 0n).toString(), originalCurrency: 'IRR',
  rawAmountBeforeRounding: (input.debitRials ?? input.creditRials ?? 0n).toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
  evidence: input.evidence,
});

type ProvisionCustomerProfileInput = {
  legalEntityId: string; relationshipId: string; relationshipVersion: number; partySourceId: string;
  displayName: string; approvedAt: Date; evidence: unknown; actor: CustomerTreasuryActor;
};

export const provisionCustomerAccountingProfileWithin = async (tx: Database, input: ProvisionCustomerProfileInput) => {
  if (input.actor.profile === 'VIEWER') throw new AccountingCustomerTreasuryError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ایجاد حساب مالی مشتری فعال نیست.', 403);
  const evidenceHash = hashCustomerTreasuryEvidence(input.evidence);
  const existingRelationship = await tx.accountingCustomerRelationship.findUnique({
    where: { sourceType_sourceId_sourceVersion: { sourceType: 'SALES_CONTRACT', sourceId: input.relationshipId, sourceVersion: input.relationshipVersion } },
    include: { profile: true },
  });
  if (existingRelationship) return existingRelationship.profile;
  let party = await tx.accountingParty.findUnique({ where: { legalEntityId_sourceKind_sourceId: {
    legalEntityId: input.legalEntityId, sourceKind: 'CUSTOMER', sourceId: input.partySourceId,
  } } });
  if (!party) party = await tx.accountingParty.create({ data: { legalEntityId: input.legalEntityId, sourceKind: 'CUSTOMER',
    sourceId: input.partySourceId, displayName: input.displayName.trim(), activeFrom: input.approvedAt } });
  const role = await tx.accountingPartyRoleAssignment.findFirst({ where: { partyId: party.id, role: 'CUSTOMER', effectiveTo: null } });
  if (!role) await tx.accountingPartyRoleAssignment.create({ data: { partyId: party.id, role: 'CUSTOMER', effectiveFrom: input.approvedAt, createdBy: input.actor.id } });
  const profile = await tx.accountingCustomerProfile.upsert({
    where: { legalEntityId_partySourceKind_partySourceId: { legalEntityId: input.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: input.partySourceId } },
    create: { legalEntityId: input.legalEntityId, accountingPartyId: party.id, partySourceKind: 'CUSTOMER',
      partySourceId: input.partySourceId, displayName: input.displayName.trim(), openingBalanceRials: '0', activeFrom: input.approvedAt, createdBy: input.actor.id },
    update: {},
  });
  await tx.accountingCustomerRelationship.create({ data: { profileId: profile.id, sourceType: 'SALES_CONTRACT', sourceId: input.relationshipId,
    sourceVersion: input.relationshipVersion, approvedAt: input.approvedAt, evidenceHash, createdBy: input.actor.id } });
  return profile;
};

export const provisionCustomerAccountingProfile = async (database: PrismaClient, input: ProvisionCustomerProfileInput) => database.$transaction(
  (tx) => provisionCustomerAccountingProfileWithin(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);

export const provisionApprovedSalesContractCustomer = async (tx: Database, input: { contractId: string; approvedAt: Date; actorId: string }) => {
  const [book, contract] = await Promise.all([
    tx.accountingBook.findFirst({ where: { isPrimary: true }, orderBy: { createdAt: 'asc' }, select: { legalEntityId: true } }),
    tx.salesContract.findUnique({ where: { id: input.contractId }, select: { id: true, customerId: true,
      customer: { select: { firstName: true, lastName: true, companyName: true } } } }),
  ]);
  // Sales keeps ownership of approval. During a fresh installation there may
  // not yet be an Accounting Legal Entity; setup/backfill will provision the
  // profile later without turning Accounting readiness into a Sales gate.
  if (!book) return null;
  if (!contract) throw new AccountingCustomerTreasuryError('SALES_CONTRACT_NOT_FOUND', 'قرارداد فروش پیدا نشد.', 404);
  const displayName = contract.customer.companyName?.trim() || `${contract.customer.firstName} ${contract.customer.lastName}`.trim();
  return provisionCustomerAccountingProfileWithin(tx, { legalEntityId: book.legalEntityId, relationshipId: contract.id,
    relationshipVersion: 1, partySourceId: contract.customerId,
    displayName, approvedAt: input.approvedAt, evidence: { contractId: contract.id, customerId: contract.customerId,
      approvedAt: input.approvedAt.toISOString(), approvalActorId: input.actorId },
    actor: { id: input.actorId, profile: 'ACCOUNTANT' },
  });
};

export const backfillApprovedSalesContractCustomers = async (database: PrismaClient, input: { actorId: string }) => database.$transaction(async (tx) => {
  const contracts = await tx.salesContract.findMany({ where: { status: { in: ['APPROVED', 'SIGNED', 'PRINTED'] } },
    select: { id: true, updatedAt: true }, orderBy: { createdAt: 'asc' } });
  const profiles: Array<unknown> = [];
  for (const contract of contracts) profiles.push(await provisionApprovedSalesContractCustomer(tx, {
    contractId: contract.id, approvedAt: contract.updatedAt, actorId: input.actorId,
  }));
  return { scanned: contracts.length, provisioned: profiles.filter(Boolean).length };
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const cancelCustomerAccountingRelationship = async (database: PrismaClient, input: {
  relationshipId: string; relationshipVersion: number; cancelledAt: Date; actor: CustomerTreasuryActor;
}) => database.accountingCustomerRelationship.updateMany({ where: { sourceType: 'SALES_CONTRACT', sourceId: input.relationshipId,
  sourceVersion: input.relationshipVersion, cancelledAt: null }, data: { cancelledAt: input.cancelledAt } });

export const createControlTransferPolicyPrisma = async (database: PrismaClient, input: {
  contractId: string; version: number; carriage: 'CUSTOMER_APPOINTED' | 'SABALAN_APPOINTED' | 'CONTRACTUAL_EXCEPTION';
  recognitionPoint: 'GUARD_EXIT' | 'DESTINATION_ACCEPTANCE' | 'EXPLICIT_EXCEPTION'; exceptionReason?: string;
  exceptionTerms?: Array<{ productRowId: string; quantity: string; netRials: string; costRials: string }>;
  exceptionOccurredAt?: Date;
  effectiveFrom: Date; effectiveTo?: Date; actor: CustomerTreasuryActor;
}) => {
  const validPair = (input.carriage === 'CUSTOMER_APPOINTED' && input.recognitionPoint === 'GUARD_EXIT')
    || (input.carriage === 'SABALAN_APPOINTED' && input.recognitionPoint === 'DESTINATION_ACCEPTANCE')
    || (input.carriage === 'CONTRACTUAL_EXCEPTION' && input.recognitionPoint === 'EXPLICIT_EXCEPTION'
      && (input.exceptionReason?.trim().length ?? 0) >= 8 && (input.exceptionTerms?.length ?? 0) > 0
      && input.exceptionOccurredAt instanceof Date && !Number.isNaN(input.exceptionOccurredAt.getTime()));
  if (!validPair || !Number.isInteger(input.version) || input.version < 1) throw new AccountingCustomerTreasuryError('INVALID_CONTROL_TRANSFER_POLICY', 'سیاست انتقال کنترل یا نسخه آن معتبر نیست.', 400);
  const evidenceHash = hashCustomerTreasuryEvidence({ contractId: input.contractId, version: input.version, carriage: input.carriage,
    recognitionPoint: input.recognitionPoint, exceptionReason: input.exceptionReason?.trim() || null,
    exceptionTerms: input.exceptionTerms ?? null,
    exceptionOccurredAt: input.exceptionOccurredAt ?? null,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null });
  return database.accountingControlTransferPolicy.create({ data: { contractId: input.contractId, version: input.version,
    carriage: input.carriage, recognitionPoint: input.recognitionPoint, exceptionReason: input.exceptionReason?.trim(),
    exceptionTerms: input.exceptionTerms == null ? undefined : json(input.exceptionTerms),
    exceptionOccurredAt: input.exceptionOccurredAt,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, evidenceHash, createdBy: input.actor.id } });
};

export const publishDestinationAcceptanceEvidencePrisma = async (database: PrismaClient, input: {
  sourceId: string; sourceVersion: number; contractId: string; contractVersion: number; pricingVersionId: string; occurredAt: Date;
  productRows: Array<{ id: string; quantity: string }>; actorId: string;
}) => {
  const [delivery, pricingVersion] = await Promise.all([
    database.delivery.findUnique({ where: { id: input.sourceId }, include: { products: true } }),
    database.contractApprovedPricingVersion.findUnique({ where: { id: input.pricingVersionId } }),
  ]);
  const productRows = delivery?.products.map((row) => ({ id: row.productRowId ?? '',
    quantity: (row.deliveredQuantity ?? row.quantity).toFixed(3) })) ?? [];
  if (!delivery || delivery.contractId !== input.contractId || delivery.status !== 'DELIVERED'
    || !delivery.customerConfirmation || !delivery.deliveredAt || delivery.deliveredAt.getTime() !== input.occurredAt.getTime()
    || input.sourceVersion !== 1 || productRows.length === 0 || productRows.some((row) => !row.id)
    || productRows.length !== input.productRows.length
    || productRows.some((row) => !input.productRows.some((candidate) => candidate.id === row.id
      && new Prisma.Decimal(candidate.quantity).eq(row.quantity)))
    || !pricingVersion || pricingVersion.contractId !== input.contractId || pricingVersion.approvedAt > input.occurredAt) {
    throw new AccountingCustomerTreasuryError('DESTINATION_ACCEPTANCE_SOURCE_INVALID', 'پذیرش مقصد، ردیف‌های تحویل یا نسخه قیمت‌گذاری با منبع فروش سازگار نیست.', 409);
  }
  const payload = { sourceId: input.sourceId, sourceVersion: input.sourceVersion, contractId: input.contractId,
    contractVersion: input.contractVersion, pricingVersionId: input.pricingVersionId,
    occurredAt: input.occurredAt, productRows };
  const evidenceHash = hashCustomerTreasuryEvidence(payload);
  const persisted = await database.accountingDestinationAcceptanceEvidence.upsert({
    where: { sourceId_sourceVersion: { sourceId: input.sourceId, sourceVersion: input.sourceVersion } },
    create: { sourceId: input.sourceId, sourceVersion: input.sourceVersion, contractId: input.contractId,
      contractVersion: input.contractVersion, pricingVersionId: input.pricingVersionId,
      occurredAt: input.occurredAt, productRows: json(productRows),
      evidenceHash, createdBy: input.actorId },
    update: {},
  });
  if (persisted.evidenceHash !== evidenceHash) throw new AccountingCustomerTreasuryError('EVIDENCE_IDENTITY_COLLISION', 'هویت شاهد پذیرش مقصد قبلاً با محتوای متفاوت ثبت شده است.', 409);
  return persisted;
};

export const publishInventoryValuationEvidencePrisma = async (database: PrismaClient, input: {
  shipmentQuantityEvidenceId: string; valuationVersion: number;
  valuationMethod: 'SPECIFIC_IDENTIFICATION';
  inventoryDocumentId: string; unitCostRials: bigint; actorId: string;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-valuation:${input.shipmentQuantityEvidenceId}`}))`;
  const source = await tx.shipmentQuantityEvidence.findUnique({ where: { id: input.shipmentQuantityEvidenceId },
    include: { contractItem: { include: { product: true } } } });
  const sourceIntegrityHash = source ? shipmentQuantityEvidenceIntegrityHash({ ...source,
    quantity: source.quantity.toString(), effectiveAt: source.effectiveAt.toISOString(),
    recordedAt: source.recordedAt.toISOString(), metadata: source.metadata as Record<string, unknown> } as Parameters<typeof shipmentQuantityEvidenceIntegrityHash>[0]) : null;
  const totalCost = source ? source.quantity.mul(input.unitCostRials.toString()) : null;
  if (!source || !source.contractId || source.returnEvidenceId != null || source.integrityHash !== sourceIntegrityHash
    || !['PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT', 'DISPATCH_CORRECTION_POSTED', 'LEGACY_DISPATCHED'].includes(source.kind)
    || !source.contractItem?.product.stoneTypeCode || input.valuationMethod !== 'SPECIFIC_IDENTIFICATION'
    || !Number.isInteger(input.valuationVersion) || input.valuationVersion < 1 || input.inventoryDocumentId.trim().length < 3
    || input.unitCostRials < 0n || !totalCost?.isInteger()) {
    throw new AccountingCustomerTreasuryError('INVENTORY_VALUATION_SOURCE_INVALID', 'ارزش‌گذاری فقط برای خروج قطعی و سالم موجودی قابل انتشار است.', 409);
  }
  const evidence = { shipmentQuantityEvidenceId: source.id, valuationVersion: input.valuationVersion,
    valuationMethod: input.valuationMethod, inventoryDocumentId: input.inventoryDocumentId.trim(),
    contractId: source.contractId!, productRowId: source.productRowId, quantity: source.quantity.toFixed(3),
    unitCostRials: input.unitCostRials, totalCostRials: BigInt(totalCost.toFixed(0)), effectiveAt: source.effectiveAt };
  const evidenceHash = hashCustomerTreasuryEvidence(evidence);
  const persisted = await tx.inventoryValuationEvidence.upsert({ where: {
    shipmentQuantityEvidenceId_valuationVersion: { shipmentQuantityEvidenceId: source.id, valuationVersion: input.valuationVersion },
  }, create: { ...evidence, quantity: evidence.quantity, unitCostRials: input.unitCostRials.toString(),
    totalCostRials: evidence.totalCostRials.toString(), evidenceHash, createdBy: input.actorId }, update: {} });
  if (persisted.evidenceHash !== evidenceHash) throw new AccountingCustomerTreasuryError('EVIDENCE_IDENTITY_COLLISION', 'نسخه ارزش‌گذاری انبار قبلاً با محتوای متفاوت ثبت شده است.', 409);
  return persisted;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const publishInventoryCostEvidencePrisma = async (database: PrismaClient, input: {
  legalEntityId: string; valuationEvidenceId: string;
}) => database.$transaction(async (tx) => {
  const valuationIdentity = await tx.inventoryValuationEvidence.findUnique({ where: { id: input.valuationEvidenceId },
    select: { shipmentQuantityEvidenceId: true } });
  if (!valuationIdentity) throw new AccountingCustomerTreasuryError('INVENTORY_VALUATION_NOT_FOUND', 'شاهد قطعی ارزش‌گذاری انبار پیدا نشد.', 404);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-valuation:${valuationIdentity.shipmentQuantityEvidenceId}`}))`;
  const valuation = await tx.inventoryValuationEvidence.findUnique({ where: { id: input.valuationEvidenceId } });
  if (!valuation) throw new AccountingCustomerTreasuryError('INVENTORY_VALUATION_NOT_FOUND', 'شاهد قطعی ارزش‌گذاری انبار پیدا نشد.', 404);
  const latest = await tx.inventoryValuationEvidence.findFirst({ where: {
    shipmentQuantityEvidenceId: valuation.shipmentQuantityEvidenceId }, orderBy: { valuationVersion: 'desc' } });
  if (latest?.id !== valuation.id || valuation.valuationMethod !== 'SPECIFIC_IDENTIFICATION') {
    throw new AccountingCustomerTreasuryError('INVENTORY_VALUATION_SUPERSEDED', 'فقط آخرین نسخه ارزش‌گذاری شناسایی ویژه برای انتشار معتبر است.', 409);
  }
  const payload = { valuationEvidenceId: valuation.id, valuationMethod: valuation.valuationMethod,
    valuationVersion: valuation.valuationVersion, inventoryDocumentId: valuation.inventoryDocumentId,
    unitCostRials: valuation.unitCostRials.toString(), valuationEvidenceHash: valuation.evidenceHash };
  const evidence = { legalEntityId: input.legalEntityId, sourceType: 'INVENTORY_VALUATION_EVIDENCE', sourceId: valuation.id,
    sourceVersion: valuation.valuationVersion, contractId: valuation.contractId, productRowId: valuation.productRowId,
    quantity: valuation.quantity.toFixed(3), costRials: toBigInt(valuation.totalCostRials),
    effectiveAt: valuation.effectiveAt, payload };
  const evidenceHash = hashCustomerTreasuryEvidence(evidence);
  const persisted = await tx.accountingInventoryCostEvidence.upsert({
    where: { sourceType_sourceId_sourceVersion: { sourceType: evidence.sourceType, sourceId: evidence.sourceId,
      sourceVersion: evidence.sourceVersion } },
    create: { ...evidence, costRials: evidence.costRials.toString(), payload: json(payload), evidenceHash }, update: {},
  });
  if (persisted.evidenceHash !== evidenceHash) throw new AccountingCustomerTreasuryError('EVIDENCE_IDENTITY_COLLISION', 'هویت شاهد بهای موجودی قبلاً با محتوای متفاوت ثبت شده است.', 409);
  return persisted;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const createCustomerPostingRulePrisma = async (database: PrismaClient, input: { legalEntityId: string; code: string;
  version: number; receivableAccountId: string; revenueAccountId: string; outputTaxAccountId: string;
  inventoryAccountId: string; costAccountId: string; bankClearingAccountId: string; customerAdvanceAccountId: string;
  effectiveFrom: Date; effectiveTo?: Date; actor: CustomerTreasuryActor;
}) => {
  if (input.actor.profile !== 'ACCOUNTING_MANAGER') throw new AccountingCustomerTreasuryError('POSTING_RULE_FORBIDDEN', 'تعریف قاعده ثبت فقط برای مدیر حسابداری مجاز است.', 403);
  const accounts = [input.receivableAccountId, input.revenueAccountId, input.outputTaxAccountId, input.inventoryAccountId,
    input.costAccountId, input.bankClearingAccountId, input.customerAdvanceAccountId];
  if (new Set(accounts).size !== accounts.length) throw new AccountingCustomerTreasuryError('POSTING_RULE_ACCOUNT_INVALID', 'هر نقش قاعده ثبت باید حساب معین مستقل داشته باشد.', 400);
  const accountRows = await database.accountingLedgerAccount.findMany({ where: { id: { in: accounts },
    book: { legalEntityId: input.legalEntityId } } });
  const byId = new Map(accountRows.map((account) => [account.id, account]));
  const validRole = (id: string, expected: { side: 'DEBIT' | 'CREDIT'; role: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE';
    party?: 'REQUIRED'; financial?: 'REQUIRED' }) => { const account = byId.get(id); return account?.level === 'MOIN'
      && account.normalSide === expected.side && account.statementRole === expected.role
      && (expected.party == null || account.partyRequirement === expected.party)
      && (expected.financial == null || account.financialAccountRequirement === expected.financial)
      && account.effectiveFrom <= input.effectiveFrom && account.retiredAt == null
      && (account.effectiveTo == null || account.effectiveTo >= input.effectiveFrom); };
  const semanticAccountsValid = validRole(input.receivableAccountId, { side: 'DEBIT', role: 'ASSET', party: 'REQUIRED' })
    && validRole(input.revenueAccountId, { side: 'CREDIT', role: 'REVENUE' })
    && validRole(input.outputTaxAccountId, { side: 'CREDIT', role: 'LIABILITY' })
    && validRole(input.inventoryAccountId, { side: 'DEBIT', role: 'ASSET' })
    && validRole(input.costAccountId, { side: 'DEBIT', role: 'EXPENSE' })
    && validRole(input.bankClearingAccountId, { side: 'DEBIT', role: 'ASSET', financial: 'REQUIRED' })
    && validRole(input.customerAdvanceAccountId, { side: 'CREDIT', role: 'LIABILITY', party: 'REQUIRED' });
  if (!semanticAccountsValid) throw new AccountingCustomerTreasuryError('POSTING_RULE_ACCOUNT_INVALID', 'سطح، ماهیت، نقش و تفصیلی حساب‌های قاعده ثبت معتبر نیست.', 400);
  const payload = { ...input, actor: undefined };
  return database.accountingCustomerPostingRule.create({ data: { legalEntityId: input.legalEntityId, code: input.code.trim(),
    version: input.version, receivableAccountId: input.receivableAccountId, revenueAccountId: input.revenueAccountId,
    outputTaxAccountId: input.outputTaxAccountId, inventoryAccountId: input.inventoryAccountId, costAccountId: input.costAccountId,
    bankClearingAccountId: input.bankClearingAccountId, customerAdvanceAccountId: input.customerAdvanceAccountId,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, evidenceHash: hashCustomerTreasuryEvidence(payload), createdBy: input.actor.id } });
};

export const recognizeCustomerSalePrisma = async (database: PrismaClient, command: CustomerSaleRecognitionCommand & {
  postingRule: { id: string; version: number };
}) => database.$transaction(async (tx) => {
  const commandHash = hashCustomerTreasuryEvidence({ ...command, actor: undefined, idempotencyKey: undefined, correlationId: undefined });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${command.contractId}:${command.evidence.id}:${command.evidence.version}`}))`;
  const existing = await tx.accountingCommercialCustomerInvoice.findUnique({ where: { contractId_contractVersion_controlEvidenceId_controlEvidenceVersion: {
    contractId: command.contractId, contractVersion: command.contractVersion, controlEvidenceId: command.evidence.id,
    controlEvidenceVersion: command.evidence.version,
  } }, include: { openItems: true } });
  if (existing) {
    if (existing.commandHash && existing.commandHash !== commandHash) {
      throw new AccountingCustomerTreasuryError('SOURCE_COMMAND_CONFLICT', 'شاهد انتقال کنترل قبلاً با فرمان اقتصادی متفاوت ثبت شده است.', 409);
    }
    const [voucher, taxInvoice] = await Promise.all([
      tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: existing.ledgerVoucherId } }),
      existing.taxInvoiceId ? tx.accountingTaxInvoice.findUniqueOrThrow({ where: { id: existing.taxInvoiceId } }) : null,
    ]);
    return { kind: 'POSTED' as const, invoice: existing, openItem: existing.openItems[0], voucher, taxInvoice };
  }
  const book = await tx.accountingBook.findUnique({ where: { id: command.bookId }, select: { legalEntityId: true } });
  if (!book) throw new AccountingCustomerTreasuryError('BOOK_NOT_FOUND', 'دفتر حسابداری پیدا نشد.', 404);
  const profile = await tx.accountingCustomerProfile.findUnique({ where: { legalEntityId_partySourceKind_partySourceId: {
    legalEntityId: book.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: command.partySourceId,
  } } });
  if (!profile) throw new AccountingCustomerTreasuryError('CUSTOMER_PROFILE_REQUIRED', 'حساب مالی مشتری برای رابطه فروش فعال نشده است.', 409);
  const relationship = await tx.accountingCustomerRelationship.findFirst({ where: { profileId: profile.id,
    sourceType: 'SALES_CONTRACT', sourceId: command.contractId, sourceVersion: command.contractVersion, cancelledAt: null } });
  if (!relationship) throw new AccountingCustomerTreasuryError('ACTIVE_CUSTOMER_RELATIONSHIP_REQUIRED', 'رابطه فروش تأییدشده و فعال برای این حساب مشتری پیدا نشد.', 409);
  const postingRule = await tx.accountingCustomerPostingRule.findUnique({ where: { id: command.postingRule.id } });
  if (!postingRule || postingRule.legalEntityId !== book.legalEntityId || postingRule.version !== command.postingRule.version) {
    throw new AccountingCustomerTreasuryError('CUSTOMER_POSTING_RULE_REQUIRED', 'نسخه معتبر و مؤثر قاعده ثبت مشتری پیدا نشد.', 409);
  }
  const persistedPolicy = await tx.accountingControlTransferPolicy.findUnique({ where: { contractId_version: {
    contractId: command.contractId, version: command.policy.version,
  } } });
  let policyFailure = !persistedPolicy || persistedPolicy.id !== command.policy.id
    || persistedPolicy.carriage !== command.policy.carriage || persistedPolicy.recognitionPoint !== command.policy.recognitionPoint
    ? { code: 'CONTROL_TRANSFER_POLICY_MISSING', message: 'نسخه معتبر و مؤثر سیاست انتقال کنترل برای این قرارداد پیدا نشد.' }
    : null;
  let authoritativeEvidence = command.evidence;
  const authoritativeNetRials = new Map<string, bigint>();
  const quantityKey = (value: Prisma.Decimal | string) => new Prisma.Decimal(value).toFixed(3);
  const pricingAmountToRials = (amount: Prisma.Decimal, currency: string) => {
    const factor = currency === 'تومان' || currency.toUpperCase() === 'TOMAN' ? new Prisma.Decimal(10) : new Prisma.Decimal(1);
    if (!['تومان', 'ریال', 'IRR', 'TOMAN'].includes(currency.toUpperCase() === 'TOMAN' ? 'TOMAN' : currency)) {
      throw new AccountingCustomerTreasuryError('UNSUPPORTED_PRICING_CURRENCY', 'واحد پول شاهد قیمت‌گذاری برای ثبت حسابداری پشتیبانی نمی‌شود.', 409);
    }
    const rials = amount.mul(factor);
    if (!rials.isInteger()) throw new AccountingCustomerTreasuryError('NON_WHOLE_RIAL_PRICING', 'مبلغ شاهد قیمت‌گذاری به ریال کامل تبدیل نمی‌شود.', 409);
    return BigInt(rials.toFixed(0));
  };
  if (!policyFailure && persistedPolicy?.recognitionPoint === 'GUARD_EXIT') {
    const exit = await tx.guardPhysicalExit.findUnique({ where: { id: command.evidence.id }, include: {
      allocationRevision: { include: { lines: { include: { pricedAllocationEvent: { include: { pricingVersion: true } } } } } },
    } });
    const sourceLines = exit?.allocationRevision.lines.filter((line) => line.sourceKind === 'SALES_CONTRACT'
      && line.sourceContractId === command.contractId) ?? [];
    if (!exit || guardPhysicalExitIntegrityHash(exit.snapshot) !== exit.integrityHash || sourceLines.length === 0) {
      authoritativeEvidence = { ...command.evidence, hash: undefined };
    } else {
      const quantities = new Map<string, Prisma.Decimal>();
      let pricingComplete = true;
      for (const line of sourceLines) {
        quantities.set(line.productRowId, (quantities.get(line.productRowId) ?? new Prisma.Decimal(0)).add(line.quantity));
        if (!line.pricedAllocationEvent || line.pricedAllocationEvent.pricingVersion.contractId !== command.contractId) {
          pricingComplete = false;
          break;
        }
        const priced = pricingAmountToRials(line.pricedAllocationEvent.netAmount, line.pricedAllocationEvent.pricingVersion.currency);
        authoritativeNetRials.set(line.productRowId, (authoritativeNetRials.get(line.productRowId) ?? 0n) + priced);
      }
      const evidenceWithoutHash = { id: exit.id, version: 1, type: 'GUARD_EXIT', occurredAt: exit.occurredAt,
        contractId: command.contractId, contractVersion: command.contractVersion,
        productRows: [...quantities].map(([id, quantity]) => ({ id, quantity: quantity.toFixed(3) })) };
      authoritativeEvidence = pricingComplete
        ? { ...evidenceWithoutHash, hash: hashCustomerTreasuryEvidence(evidenceWithoutHash) }
        : { ...evidenceWithoutHash, hash: undefined };
    }
  } else if (!policyFailure && persistedPolicy?.recognitionPoint === 'DESTINATION_ACCEPTANCE') {
    const accepted = await tx.accountingDestinationAcceptanceEvidence.findUnique({ where: { sourceId_sourceVersion: {
      sourceId: command.evidence.id, sourceVersion: command.evidence.version } } });
    const productRows = accepted?.productRows as Array<{ id: string; quantity: string }> | undefined;
    const payload = accepted && productRows ? { sourceId: accepted.sourceId, sourceVersion: accepted.sourceVersion,
      contractId: accepted.contractId, contractVersion: accepted.contractVersion, pricingVersionId: accepted.pricingVersionId,
      occurredAt: accepted.occurredAt, productRows } : null;
    authoritativeEvidence = accepted && payload && accepted.evidenceHash === hashCustomerTreasuryEvidence(payload)
      ? { id: accepted.sourceId, version: accepted.sourceVersion, type: 'DESTINATION_ACCEPTANCE', occurredAt: accepted.occurredAt,
        contractId: accepted.contractId, contractVersion: accepted.contractVersion, productRows: productRows!, hash: accepted.evidenceHash }
      : { ...command.evidence, hash: undefined };
  } else if (!policyFailure && persistedPolicy?.recognitionPoint === 'EXPLICIT_EXCEPTION') {
    const terms = persistedPolicy.exceptionTerms as Array<{ productRowId: string; quantity: string; netRials: string; costRials: string }> | null;
    const evidenceWithoutHash = { id: persistedPolicy.id, version: persistedPolicy.version, type: 'CONTRACTUAL_EXCEPTION',
      occurredAt: persistedPolicy.exceptionOccurredAt!, contractId: command.contractId, contractVersion: command.contractVersion,
      productRows: (terms ?? []).map((term) => ({ id: term.productRowId, quantity: term.quantity })) };
    for (const term of terms ?? []) authoritativeNetRials.set(term.productRowId, BigInt(term.netRials));
    authoritativeEvidence = { ...evidenceWithoutHash, hash: hashCustomerTreasuryEvidence(evidenceWithoutHash) };
  }
  const recognizedAt = authoritativeEvidence.occurredAt;
  if (!policyFailure && authoritativeEvidence.hash && authoritativeNetRials.size === 0
    && persistedPolicy?.recognitionPoint !== 'EXPLICIT_EXCEPTION') {
    const pricingVersionId = persistedPolicy?.recognitionPoint === 'DESTINATION_ACCEPTANCE'
      ? (await tx.accountingDestinationAcceptanceEvidence.findUnique({ where: { sourceId_sourceVersion: {
        sourceId: authoritativeEvidence.id, sourceVersion: authoritativeEvidence.version } }, select: { pricingVersionId: true } }))?.pricingVersionId
      : undefined;
    const pricingVersion = pricingVersionId
      ? await tx.contractApprovedPricingVersion.findUnique({ where: { id: pricingVersionId }, include: { rows: true } })
      : null;
    if (pricingVersion && pricingVersion.contractId === command.contractId && pricingVersion.approvedAt <= recognizedAt) for (const line of command.lines) {
      const row = pricingVersion.rows.find((item) => item.productRowId === line.productRowId);
      if (!row || row.contractedQuantity.lte(0)) continue;
      const allocated = row.canonicalAllInTotal.mul(new Prisma.Decimal(line.quantity)).div(row.contractedQuantity);
      authoritativeNetRials.set(line.productRowId, pricingAmountToRials(allocated, pricingVersion.currency));
    }
  }
  if (!policyFailure && persistedPolicy && (recognizedAt < persistedPolicy.effectiveFrom
    || (persistedPolicy.effectiveTo != null && recognizedAt > persistedPolicy.effectiveTo))) {
    policyFailure = { code: 'CONTROL_TRANSFER_POLICY_MISSING', message: 'نسخه معتبر و مؤثر سیاست انتقال کنترل برای این قرارداد پیدا نشد.' };
  }
  if (recognizedAt < postingRule.effectiveFrom || (postingRule.effectiveTo != null && recognizedAt > postingRule.effectiveTo)) {
    throw new AccountingCustomerTreasuryError('CUSTOMER_POSTING_RULE_REQUIRED', 'نسخه معتبر و مؤثر قاعده ثبت مشتری پیدا نشد.', 409);
  }
  const effectiveCommand = { ...command, evidence: authoritativeEvidence };
  const failure = policyFailure ?? validateCustomerSaleEvidence(effectiveCommand);
  if (failure) {
    const exception = await tx.accountingExceptionCase.upsert({ where: { sourceType_sourceId_sourceVersion_code: {
      sourceType: command.evidence.type, sourceId: command.evidence.id, sourceVersion: command.evidence.version, code: failure.code,
    } }, create: { code: failure.code, messagePersian: failure.message, assignedProfile: 'ACCOUNTANT', sourceType: command.evidence.type,
      sourceId: command.evidence.id, sourceVersion: command.evidence.version,
      evidenceHash: command.evidence.hash ?? hashCustomerTreasuryEvidence(command.evidence) }, update: {} });
    return { kind: 'EXCEPTION' as const, exception };
  }
  const exceptionTerms = persistedPolicy?.recognitionPoint === 'EXPLICIT_EXCEPTION'
    ? persistedPolicy.exceptionTerms as Array<{ productRowId: string; quantity: string; netRials: string; costRials: string }> : null;
  const commandProductRows = command.lines.map((line) => line.productRowId);
  const evidenceProductRows = authoritativeEvidence.productRows.map((line) => line.id);
  const costEvidenceIds = command.lines.map((line) => line.costEvidenceId).filter((id): id is string => Boolean(id));
  if (new Set(commandProductRows).size !== commandProductRows.length
    || new Set(evidenceProductRows).size !== evidenceProductRows.length
    || new Set(costEvidenceIds).size !== costEvidenceIds.length
    || commandProductRows.length !== evidenceProductRows.length
    || commandProductRows.some((id) => !evidenceProductRows.includes(id))) {
    throw new AccountingCustomerTreasuryError('SALE_LINE_COVERAGE_MISMATCH', 'ردیف‌های فروش باید پوشش یکتا و کامل شواهد انتقال کنترل را حفظ کنند.', 409);
  }
  const costEvidenceSources = costEvidenceIds.length ? await tx.accountingInventoryCostEvidence.findMany({
    where: { id: { in: costEvidenceIds }, sourceType: 'INVENTORY_VALUATION_EVIDENCE' }, select: { sourceId: true },
  }) : [];
  const valuationShipments = costEvidenceSources.length ? await tx.inventoryValuationEvidence.findMany({
    where: { id: { in: costEvidenceSources.map(({ sourceId }) => sourceId) } }, select: { shipmentQuantityEvidenceId: true },
  }) : [];
  for (const shipmentId of [...new Set(valuationShipments.map(({ shipmentQuantityEvidenceId }) => shipmentQuantityEvidenceId))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-valuation:${shipmentId}`}))`;
  }
  for (const line of command.lines) {
    const expectedNet = authoritativeNetRials.get(line.productRowId);
    if (expectedNet == null || expectedNet !== line.netRials) throw new AccountingCustomerTreasuryError('AUTHORITATIVE_PRICE_REQUIRED', 'مبلغ ردیف با شاهد تغییرناپذیر قیمت‌گذاری فروش سازگار نیست.', 409);
    if (exceptionTerms) {
      const term = exceptionTerms.find((item) => item.productRowId === line.productRowId);
      if (!term || quantityKey(term.quantity) !== quantityKey(line.quantity) || BigInt(term.costRials) !== line.costRials) {
        throw new AccountingCustomerTreasuryError('CONTRACTUAL_EXCEPTION_TERMS_MISMATCH', 'ردیف فروش با شروط اقتصادی مصوب استثنای قراردادی سازگار نیست.', 409);
      }
    } else {
      if (!line.costEvidenceId) throw new AccountingCustomerTreasuryError('INVENTORY_COST_EVIDENCE_REQUIRED', 'شاهد تغییرناپذیر بهای موجودی برای ردیف فروش الزامی است.', 409);
      const costEvidence = await tx.accountingInventoryCostEvidence.findUnique({ where: { id: line.costEvidenceId } });
      const valuation = costEvidence?.sourceType === 'INVENTORY_VALUATION_EVIDENCE'
        ? await tx.inventoryValuationEvidence.findUnique({ where: { id: costEvidence.sourceId } }) : null;
      const latestValuation = valuation ? await tx.inventoryValuationEvidence.findFirst({ where: {
        shipmentQuantityEvidenceId: valuation.shipmentQuantityEvidenceId }, orderBy: { valuationVersion: 'desc' } }) : null;
      if (!costEvidence || costEvidence.legalEntityId !== book.legalEntityId || costEvidence.contractId !== command.contractId
        || costEvidence.productRowId !== line.productRowId || quantityKey(costEvidence.quantity) !== quantityKey(line.quantity)
        || toBigInt(costEvidence.costRials) !== line.costRials || costEvidence.effectiveAt > recognizedAt
        || !valuation || valuation.valuationMethod !== 'SPECIFIC_IDENTIFICATION' || latestValuation?.id !== valuation.id
        || costEvidence.evidenceHash !== hashCustomerTreasuryEvidence({ legalEntityId: costEvidence.legalEntityId,
          sourceType: costEvidence.sourceType, sourceId: costEvidence.sourceId, sourceVersion: costEvidence.sourceVersion,
          contractId: costEvidence.contractId, productRowId: costEvidence.productRowId, quantity: costEvidence.quantity.toFixed(3),
          costRials: toBigInt(costEvidence.costRials), effectiveAt: costEvidence.effectiveAt, payload: costEvidence.payload })) {
        throw new AccountingCustomerTreasuryError('INVENTORY_COST_EVIDENCE_REQUIRED', 'شاهد تغییرناپذیر بهای موجودی با ردیف فروش سازگار نیست.', 409);
      }
    }
  }
  const netRials = command.lines.reduce((total, line) => total + line.netRials, 0n);
  const taxRials = command.lines.reduce((total, line) => total + line.taxRials, 0n);
  const costRials = command.lines.reduce((total, line) => total + line.costRials, 0n);
  for (const line of command.lines) {
    const persistedRule = await tx.accountingTaxRule.findUnique({ where: { legalEntityId_code_version: {
      legalEntityId: book.legalEntityId, code: line.taxRule.id, version: line.taxRule.version,
    } } });
    const components = persistedRule?.components as Record<string, unknown> | undefined;
    const persistedRate = Number(components?.rateBasisPoints);
    if (!persistedRule || recognizedAt < persistedRule.effectiveFrom
      || (persistedRule.effectiveTo != null && recognizedAt > persistedRule.effectiveTo)
      || persistedRule.citation !== line.taxRule.citation || persistedRule.exempt !== line.taxRule.exempt
      || !Number.isInteger(persistedRate) || persistedRate !== line.taxRule.rateBasisPoints) {
      throw new AccountingCustomerTreasuryError('TAX_RULE_MISMATCH', 'نسخه معتبر و مؤثر قاعده مالیاتی برای ردیف پیدا نشد.', 400);
    }
    const expected = persistedRule.exempt ? 0n : (line.netRials * BigInt(persistedRate) + 5_000n) / 10_000n;
    if (expected !== line.taxRials) throw new AccountingCustomerTreasuryError('TAX_RULE_MISMATCH', 'مالیات ردیف با قاعده مؤثر سازگار نیست.', 400);
  }
  const sourcePayload = { policy: command.policy, evidence: authoritativeEvidence, contractId: command.contractId, contractVersion: command.contractVersion };
  const source = { type: 'CONTROL_TRANSFER', id: authoritativeEvidence.id, version: authoritativeEvidence.version,
    payload: sourcePayload, hash: hashAccountingEvidence(sourcePayload) };
  const evidence = lineEvidence('CONTROL_TRANSFER', authoritativeEvidence.id, authoritativeEvidence.version, sourcePayload);
  const lines = [
    ledgerLine({ accountId: postingRule.receivableAccountId, debitRials: netRials + taxRials, partyId: profile.accountingPartyId, evidence, description: 'مطالبات فروش مشتری' }),
    ledgerLine({ accountId: postingRule.revenueAccountId, creditRials: netRials, evidence, description: 'درآمد فروش انتقال‌یافته' }),
    ...(taxRials > 0n ? [ledgerLine({ accountId: postingRule.outputTaxAccountId, creditRials: taxRials, evidence, description: 'مالیات و عوارض فروش' })] : []),
    ...(costRials > 0n ? [ledgerLine({ accountId: postingRule.costAccountId, debitRials: costRials, evidence, description: 'بهای تمام‌شده فروش' }),
      ledgerLine({ accountId: postingRule.inventoryAccountId, creditRials: costRials, evidence, description: 'خروج موجودی انتقال‌یافته' })] : []),
  ];
  const now = new Date();
  const app = ledgerApp(tx, now);
  const draft = await app.createManualDraft({ bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
    idempotencyKey: command.idempotencyKey, correlationId: command.correlationId, description: `ثبت فروش قرارداد ${command.contractId}`,
    documentDate: recognizedAt, occurredAt: recognizedAt, source, actor: command.actor, lines });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: command.actor, reason: 'ثبت انتقال کنترل و آثار فروش مشتری' });
  const invoiceId = `customer-invoice-${randomUUID()}`;
  const taxInvoiceId = `tax-invoice-${randomUUID()}`;
  const taxChannel = await tx.accountingTaxSubmissionChannel.findFirst({ where: { legalEntityId: book.legalEntityId,
    effectiveFrom: { lte: recognizedAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: recognizedAt } }],
    healthStatus: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' } });
  const taxInvoice = await tx.accountingTaxInvoice.create({ data: { id: taxInvoiceId, commercialInvoiceId: invoiceId,
    ledgerVoucherId: voucher.id, internalSerial: `tax-${randomUUID()}`, documentKind: 'ORIGINAL', protocolVersion: 'TAXPAYER-V1',
    netRials: netRials.toString(), taxRials: taxRials.toString(), status: 'QUEUED', issuedAt: recognizedAt,
    lines: { create: command.lines.map((line) => ({ sourceLineId: line.id, taxRuleId: line.taxRule.id, taxRuleVersion: line.taxRule.version,
      productRowId: line.productRowId, quantity: line.quantity, costRials: line.costRials.toString(),
      citation: line.taxRule.citation, rawBaseAmount: line.netRials.toString(),
      rawTaxAmount: `${line.taxRials}.00000000`, roundedTaxRials: line.taxRials.toString(), exempt: line.taxRule.exempt,
      allocationEvidence: json({ rateBasisPoints: line.taxRule.rateBasisPoints, quantity: line.quantity, rounding: 'HALF_UP_IRR' }) })) } },
  });
  const invoice = await tx.accountingCommercialCustomerInvoice.create({ data: { id: invoiceId, profileId: profile.id,
    contractId: command.contractId, contractVersion: command.contractVersion, number: command.commercialInvoiceNumber,
    ledgerVoucherId: voucher.id, taxInvoiceId, controlPolicyId: command.policy.id, controlPolicyVersion: command.policy.version,
    controlEvidenceType: authoritativeEvidence.type, controlEvidenceId: authoritativeEvidence.id,
    controlEvidenceVersion: authoritativeEvidence.version, controlEvidenceHash: authoritativeEvidence.hash!, commandHash, netRials: netRials.toString(),
    taxRials: taxRials.toString(), grossRials: (netRials + taxRials).toString(), issuedAt: recognizedAt, dueAt: command.dueAt } });
  const openItem = await tx.accountingCustomerOpenItem.create({ data: { profileId: profile.id, invoiceId: invoice.id,
    contractId: command.contractId, kind: 'RECEIVABLE', originalRials: (netRials + taxRials).toString(), dueAt: command.dueAt, postedAt: voucher.postedAt! } });
  const payloadHash = hashCustomerTreasuryEvidence({ taxInvoiceId, internalSerial: taxInvoice.internalSerial, netRials, taxRials, protocolVersion: 'TAXPAYER-V1' });
  await tx.accountingTaxOutboxMessage.create({ data: { taxInvoiceId, channelId: taxChannel?.id, payloadHash,
    protocolVersion: 'TAXPAYER-V1', requestIdentity: `tax-request-${taxInvoiceId}`,
    status: taxChannel ? 'PENDING' : 'NEEDS_CHANNEL', availableAt: now } });
  return { kind: 'POSTED' as const, invoice, openItem, voucher, taxInvoice };
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const recognizeCustomerReturnPrisma = async (database: PrismaClient, input: {
  originalInvoiceId: string; commercialCreditNumber: string; bookId: string; fiscalYearId: string; periodId: string;
  returnedAt: Date; evidenceIds: string[]; lines: Array<{ id: string; originalLineId: string; evidenceId: string; productRowId: string; quantity: string;
    netRials: bigint; taxRials: bigint; costRials: bigint; taxRule: { id: string; version: number; citation: string; rateBasisPoints: number; exempt: boolean } }>;
  postingRule: { id: string; version: number };
  idempotencyKey: string; correlationId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-return:${input.originalInvoiceId}`}))`;
  const original = await tx.accountingCommercialCustomerInvoice.findUnique({ where: { id: input.originalInvoiceId },
    include: { openItems: true } });
  if (!original || original.status !== 'POSTED') throw new AccountingCustomerTreasuryError('ORIGINAL_INVOICE_REQUIRED', 'صورتحساب فروش قطعی مرجع پیدا نشد.', 404);
  const returnCommandHash = hashCustomerTreasuryEvidence({ originalInvoiceId: input.originalInvoiceId,
    commercialCreditNumber: input.commercialCreditNumber, bookId: input.bookId, fiscalYearId: input.fiscalYearId,
    periodId: input.periodId, returnedAt: input.returnedAt, evidenceIds: [...input.evidenceIds].sort(),
    lines: [...input.lines].sort((left, right) => left.id.localeCompare(right.id)), postingRule: input.postingRule });
  const priorVoucher = await tx.accountingLedgerVoucher.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (priorVoucher) {
    const accepted = await tx.accountingCommercialCustomerInvoice.findUnique({ where: { ledgerVoucherId: priorVoucher.id } });
    if (accepted?.referenceInvoiceId === original.id && accepted.commandHash === returnCommandHash) return accepted;
    throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید تکرار برگشت برای فرمان متفاوتی استفاده شده است.', 409);
  }
  const prior = await tx.accountingCommercialCustomerInvoice.findFirst({ where: { referenceInvoiceId: original.id,
    number: input.commercialCreditNumber } });
  if (prior) {
    if (prior.commandHash === returnCommandHash) return prior;
    throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'شماره اصلاح فروش برای فرمان متفاوتی استفاده شده است.', 409);
  }
  if (!input.lines.length || input.evidenceIds.length !== input.lines.length
    || new Set(input.evidenceIds).size !== input.evidenceIds.length
    || new Set(input.lines.map((line) => line.evidenceId)).size !== input.lines.length
    || input.lines.some((line) => !input.evidenceIds.includes(line.evidenceId))) {
    throw new AccountingCustomerTreasuryError('RETURN_LINES_REQUIRED', 'ردیف و شاهد برگشت کامل و یکتا نیست.', 400);
  }
  const evidenceRows = await tx.shipmentQuantityEvidence.findMany({ where: { id: { in: input.evidenceIds } } });
  const consumed = await tx.accountingReturnEvidenceConsumption.count({ where: { evidenceId: { in: input.evidenceIds } } });
  if (consumed > 0) throw new AccountingCustomerTreasuryError('RETURN_EVIDENCE_ALREADY_CONSUMED', 'این شاهد برگشت پیش‌تر در اصلاح مالی دیگری مصرف شده است.', 409);
  const byId = new Map(evidenceRows.map((row) => [row.id, row]));
  for (const line of input.lines) {
    const evidenceRow = byId.get(line.evidenceId);
    if (!evidenceRow || evidenceRow.kind !== 'GUARD_RETURN_VERIFIED' || evidenceRow.contractId !== original.contractId
      || !evidenceRow.dispatchEvidenceId || evidenceRow.productRowId !== line.productRowId
      || evidenceRow.quantity.toFixed(3) !== line.quantity
      || evidenceRow.integrityHash !== shipmentQuantityEvidenceIntegrityHash(evidenceRow as never)) {
      throw new AccountingCustomerTreasuryError('VERIFIED_RETURN_EVIDENCE_REQUIRED', 'شاهد تغییرناپذیر برگشت گارد با ردیف اصلاح فروش سازگار نیست.', 409);
    }
  }
  const book = await tx.accountingBook.findUnique({ where: { id: input.bookId } });
  if (!book) throw new AccountingCustomerTreasuryError('BOOK_NOT_FOUND', 'دفتر حسابداری پیدا نشد.', 404);
  const [postingRule, originalTaxInvoice] = await Promise.all([
    tx.accountingCustomerPostingRule.findUnique({ where: { id: input.postingRule.id } }),
    original.taxInvoiceId ? tx.accountingTaxInvoice.findUnique({ where: { id: original.taxInvoiceId }, include: { lines: true } }) : null,
  ]);
  if (!postingRule || postingRule.version !== input.postingRule.version || postingRule.legalEntityId !== book.legalEntityId
    || input.returnedAt < postingRule.effectiveFrom || (postingRule.effectiveTo != null && input.returnedAt > postingRule.effectiveTo)) {
    throw new AccountingCustomerTreasuryError('CUSTOMER_POSTING_RULE_REQUIRED', 'نسخه معتبر و مؤثر قاعده ثبت مشتری پیدا نشد.', 409);
  }
  if (!originalTaxInvoice) throw new AccountingCustomerTreasuryError('ORIGINAL_TAX_INVOICE_REQUIRED', 'ردیف‌های اقتصادی صورتحساب مرجع پیدا نشد.', 409);
  const proportionalWholeRials = (amount: Prisma.Decimal, returned: string, originalQuantity: Prisma.Decimal) => {
    const result = amount.mul(new Prisma.Decimal(returned)).div(originalQuantity);
    if (!result.isInteger()) throw new AccountingCustomerTreasuryError('RETURN_AMOUNT_NOT_WHOLE_RIAL', 'سهم مبلغ برگشت به ریال کامل تبدیل نمی‌شود.', 409);
    return BigInt(result.toFixed(0));
  };
  const derivedLines = input.lines.map((line) => {
    const source = originalTaxInvoice.lines.find((item) => item.sourceLineId === line.originalLineId
      && item.productRowId === line.productRowId);
    if (!source || source.quantity.lte(0) || new Prisma.Decimal(line.quantity).lte(0)
      || new Prisma.Decimal(line.quantity).gt(source.quantity)) {
      throw new AccountingCustomerTreasuryError('RETURN_EXCEEDS_ORIGINAL_LINE', 'کمیت برگشت با ردیف صورتحساب مرجع سازگار نیست.', 409);
    }
    const netRials = proportionalWholeRials(source.rawBaseAmount, line.quantity, source.quantity);
    const taxRials = proportionalWholeRials(source.roundedTaxRials, line.quantity, source.quantity);
    const costRials = proportionalWholeRials(source.costRials, line.quantity, source.quantity);
    if (line.netRials !== netRials || line.taxRials !== taxRials || line.costRials !== costRials
      || line.taxRule.id !== source.taxRuleId || line.taxRule.version !== source.taxRuleVersion
      || line.taxRule.citation !== source.citation || line.taxRule.exempt !== source.exempt) {
      throw new AccountingCustomerTreasuryError('RETURN_ECONOMICS_MISMATCH', 'مبالغ برگشت باید دقیقاً از ردیف صورتحساب مرجع مشتق شوند.', 409);
    }
    return { ...line, netRials, taxRials, costRials };
  });
  const priorReturned = await tx.accountingReturnEvidenceConsumption.groupBy({ by: ['originalLineId'],
    where: { originalInvoiceId: original.id }, _sum: { quantity: true } });
  for (const line of derivedLines) {
    const source = originalTaxInvoice.lines.find((item) => item.sourceLineId === line.originalLineId)!;
    const priorQuantity = priorReturned.find((item) => item.originalLineId === line.originalLineId)?._sum.quantity ?? new Prisma.Decimal(0);
    const currentQuantity = derivedLines.filter((item) => item.originalLineId === line.originalLineId)
      .reduce((total, item) => total.add(item.quantity), new Prisma.Decimal(0));
    if (new Prisma.Decimal(priorQuantity).add(currentQuantity).gt(source.quantity)) {
      throw new AccountingCustomerTreasuryError('RETURN_EXCEEDS_ORIGINAL_LINE', 'جمع برگشت‌ها از کمیت ردیف صورتحساب مرجع بیشتر است.', 409);
    }
  }
  const netRials = derivedLines.reduce((total, line) => total + line.netRials, 0n);
  const taxRials = derivedLines.reduce((total, line) => total + line.taxRials, 0n);
  const costRials = derivedLines.reduce((total, line) => total + line.costRials, 0n);
  const priorCredits = await tx.accountingCommercialCustomerInvoice.aggregate({ where: { referenceInvoiceId: original.id,
    status: 'CREDIT_NOTE' }, _sum: { grossRials: true } });
  if (toBigInt(priorCredits._sum.grossRials ?? 0) + netRials + taxRials > toBigInt(original.grossRials)) {
    throw new AccountingCustomerTreasuryError('RETURN_EXCEEDS_INVOICE', 'جمع برگشت‌ها از صورتحساب مرجع بیشتر است.', 409);
  }
  const payload = { originalInvoiceId: original.id, evidence: evidenceRows.map((row) => ({ id: row.id,
    sourceType: row.sourceType, sourceId: row.sourceId, sourceVersion: row.sourceVersion, integrityHash: row.integrityHash })) };
  const evidence = lineEvidence('VERIFIED_CUSTOMER_RETURN', input.idempotencyKey, 1, payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, description: `برگشت از فروش ${original.number}`,
    documentDate: input.returnedAt, occurredAt: input.returnedAt,
    source: { type: 'VERIFIED_CUSTOMER_RETURN', id: input.idempotencyKey, version: 1, payload, hash: hashAccountingEvidence(payload) },
    actor: input.actor, lines: [
      ledgerLine({ accountId: postingRule.revenueAccountId, debitRials: netRials, evidence, description: 'برگشت درآمد فروش' }),
      ...(taxRials > 0n ? [ledgerLine({ accountId: postingRule.outputTaxAccountId, debitRials: taxRials, evidence, description: 'برگشت مالیات فروش' })] : []),
      ledgerLine({ accountId: postingRule.receivableAccountId, creditRials: netRials + taxRials, evidence, description: 'بستانکاری مشتری بابت برگشت' }),
      ...(costRials > 0n ? [ledgerLine({ accountId: postingRule.inventoryAccountId, debitRials: costRials, evidence, description: 'بازگشت موجودی تأییدشده' }),
        ledgerLine({ accountId: postingRule.costAccountId, creditRials: costRials, evidence, description: 'برگشت بهای تمام‌شده' })] : []),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: 'ثبت اصلاح مالی پس از شاهد قطعی برگشت' });
  const invoiceId = `customer-credit-${randomUUID()}`;
  const taxInvoiceId = `tax-return-${randomUUID()}`;
  const taxChannel = await tx.accountingTaxSubmissionChannel.findFirst({ where: { legalEntityId: book.legalEntityId,
    effectiveFrom: { lte: input.returnedAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.returnedAt } }], healthStatus: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' } });
  await tx.accountingTaxInvoice.create({ data: { id: taxInvoiceId, commercialInvoiceId: invoiceId, ledgerVoucherId: voucher.id,
    internalSerial: `tax-return-${randomUUID()}`, referenceTaxInvoiceId: original.taxInvoiceId, documentKind: 'RETURN',
    protocolVersion: 'TAXPAYER-V1', netRials: netRials.toString(), taxRials: taxRials.toString(), status: 'QUEUED', issuedAt: input.returnedAt,
    lines: { create: derivedLines.map((line) => ({ sourceLineId: line.id, productRowId: line.productRowId,
      quantity: line.quantity, costRials: line.costRials.toString(), taxRuleId: line.taxRule.id,
      taxRuleVersion: line.taxRule.version, citation: line.taxRule.citation, rawBaseAmount: line.netRials.toString(),
      rawTaxAmount: `${line.taxRials}.00000000`, roundedTaxRials: line.taxRials.toString(), exempt: line.taxRule.exempt,
      allocationEvidence: json({ returnEvidenceId: line.evidenceId, rateBasisPoints: line.taxRule.rateBasisPoints }) })) } } });
  const credit = await tx.accountingCommercialCustomerInvoice.create({ data: { id: invoiceId, profileId: original.profileId,
    referenceInvoiceId: original.id, contractId: original.contractId, contractVersion: original.contractVersion,
    number: input.commercialCreditNumber, ledgerVoucherId: voucher.id, taxInvoiceId, controlPolicyId: original.controlPolicyId,
    controlPolicyVersion: original.controlPolicyVersion, controlEvidenceType: 'GUARD_RETURN_VERIFIED',
    controlEvidenceId: input.evidenceIds.join(','), controlEvidenceVersion: 1,
    controlEvidenceHash: hashCustomerTreasuryEvidence(payload), commandHash: returnCommandHash,
    netRials: netRials.toString(), taxRials: taxRials.toString(),
    grossRials: (netRials + taxRials).toString(), issuedAt: input.returnedAt, dueAt: input.returnedAt, status: 'CREDIT_NOTE' } });
  await tx.accountingReturnEvidenceConsumption.createMany({ data: derivedLines.map((line) => ({ evidenceId: line.evidenceId,
    creditInvoiceId: credit.id, originalInvoiceId: original.id, originalLineId: line.originalLineId,
    productRowId: line.productRowId, quantity: line.quantity })) });
  await tx.accountingCustomerOpenItem.create({ data: { profileId: original.profileId, invoiceId: credit.id,
    contractId: original.contractId, kind: 'CREDIT', originalRials: (netRials + taxRials).toString(), dueAt: input.returnedAt,
    postedAt: voucher.postedAt! } });
  const payloadHash = hashCustomerTreasuryEvidence({ taxInvoiceId, originalTaxInvoiceId: original.taxInvoiceId, netRials, taxRials });
  await tx.accountingTaxOutboxMessage.create({ data: { taxInvoiceId, channelId: taxChannel?.id, payloadHash,
    protocolVersion: 'TAXPAYER-V1', requestIdentity: `tax-request-${taxInvoiceId}`,
    status: taxChannel ? 'PENDING' : 'NEEDS_CHANNEL', availableAt: new Date() } });
  return credit;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const recordCustomerReceiptPrisma = async (database: PrismaClient, input: {
  profileId: string; contractId?: string; bookId: string; fiscalYearId: string; periodId: string; amountRials: bigint;
  occurredAt: Date; financialAccountId: string; bankAccountLedgerId: string; customerAdvanceLedgerId: string;
  source: { type: string; id: string; version: number; payload: unknown }; idempotencyKey: string; correlationId: string;
  actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  if (input.amountRials <= 0n) throw new AccountingCustomerTreasuryError('INVALID_RECEIPT_AMOUNT', 'مبلغ دریافت باید بیشتر از صفر باشد.', 400);
  const prior = await tx.accountingTreasuryTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  const sourceHash = hashCustomerTreasuryEvidence(input.source.payload);
  if (prior) {
    const priorVoucher = prior.postedVoucherId
      ? await tx.accountingLedgerVoucher.findUnique({ where: { id: prior.postedVoucherId }, include: { lines: true } }) : null;
    const sameCommand = prior.profileId === input.profileId && prior.contractId === (input.contractId ?? null)
      && prior.financialAccountId === input.financialAccountId && toBigInt(prior.amountRials) === input.amountRials
      && prior.sourceType === input.source.type && prior.sourceId === input.source.id
      && prior.sourceVersion === input.source.version && prior.sourceHash === sourceHash
      && prior.occurredAt.getTime() === input.occurredAt.getTime()
      && priorVoucher?.bookId === input.bookId && priorVoucher.fiscalYearId === input.fiscalYearId
      && priorVoucher.periodId === input.periodId && priorVoucher.documentDate.getTime() === input.occurredAt.getTime()
      && priorVoucher.lines.some((line) => line.accountId === input.bankAccountLedgerId && line.financialAccountId === input.financialAccountId)
      && priorVoucher.lines.some((line) => line.accountId === input.customerAdvanceLedgerId);
    if (!sameCommand) throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید تکرار دریافت برای فرمان متفاوتی استفاده شده است.', 409);
    return prior;
  }
  const profile = await tx.accountingCustomerProfile.findUnique({ where: { id: input.profileId } });
  if (!profile) throw new AccountingCustomerTreasuryError('CUSTOMER_PROFILE_NOT_FOUND', 'حساب مالی مشتری پیدا نشد.', 404);
  const evidence = lineEvidence(input.source.type, input.source.id, input.source.version, input.source.payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: `ledger-${input.idempotencyKey}`, correlationId: input.correlationId, description: 'دریافت از مشتری و ثبت بستانکاری تخصیص‌نیافته',
    documentDate: input.occurredAt, occurredAt: input.occurredAt, source: { ...input.source, hash: sourceHash }, actor: input.actor, lines: [
      ledgerLine({ accountId: input.bankAccountLedgerId, debitRials: input.amountRials, financialAccountId: input.financialAccountId, evidence, description: 'ورود وجه به حساب مالی' }),
      ledgerLine({ accountId: input.customerAdvanceLedgerId, creditRials: input.amountRials, partyId: profile.accountingPartyId, evidence, description: 'بستانکاری تخصیص‌نیافته مشتری' }),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: 'ثبت قطعی دریافت مشتری' });
  return tx.accountingTreasuryTransaction.create({ data: { profileId: profile.id, contractId: input.contractId,
    financialAccountId: input.financialAccountId, kind: 'CUSTOMER_RECEIPT', direction: 'INBOUND', amountRials: input.amountRials.toString(),
    idempotencyKey: input.idempotencyKey, sourceType: input.source.type, sourceId: input.source.id, sourceVersion: input.source.version,
    sourceHash, occurredAt: input.occurredAt, postedVoucherId: voucher.id, createdBy: input.actor.id } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const recordInternalTreasuryTransferPrisma = async (database: PrismaClient, input: {
  fromFinancialAccountId: string; toFinancialAccountId: string; fromLedgerAccountId: string; toLedgerAccountId: string;
  bookId: string; fiscalYearId: string; periodId: string; amountRials: bigint; occurredAt: Date;
  idempotencyKey: string; correlationId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  if (input.amountRials <= 0n || input.fromFinancialAccountId === input.toFinancialAccountId) {
    throw new AccountingCustomerTreasuryError('INVALID_INTERNAL_TRANSFER', 'انتقال داخلی باید مثبت و میان دو حساب مالی متفاوت باشد.', 400);
  }
  const payload = { fromFinancialAccountId: input.fromFinancialAccountId, toFinancialAccountId: input.toFinancialAccountId,
    fromLedgerAccountId: input.fromLedgerAccountId, toLedgerAccountId: input.toLedgerAccountId,
    bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    amountRials: input.amountRials, occurredAt: input.occurredAt };
  const sourceHash = hashCustomerTreasuryEvidence(payload);
  const prior = await tx.accountingTreasuryTransaction.findUnique({ where: { idempotencyKey: `${input.idempotencyKey}:out` } });
  if (prior) {
    const pair = await tx.accountingTreasuryTransaction.findMany({
      where: { sourceType: 'INTERNAL_TRANSFER', sourceId: input.idempotencyKey }, orderBy: { direction: 'asc' },
    });
    const sameCommand = pair.length === 2 && pair.every((item) => item.sourceHash === sourceHash
      && toBigInt(item.amountRials) === input.amountRials && item.occurredAt.getTime() === input.occurredAt.getTime())
      && pair.some((item) => item.direction === 'OUTBOUND' && item.financialAccountId === input.fromFinancialAccountId)
      && pair.some((item) => item.direction === 'INBOUND' && item.financialAccountId === input.toFinancialAccountId);
    if (!sameCommand) throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید تکرار انتقال داخلی برای فرمان متفاوتی استفاده شده است.', 409);
    return pair;
  }
  const [book, fromFinancial, toFinancial] = await Promise.all([
    tx.accountingBook.findUnique({ where: { id: input.bookId } }),
    tx.accountingFinancialAccount.findUnique({ where: { id: input.fromFinancialAccountId } }),
    tx.accountingFinancialAccount.findUnique({ where: { id: input.toFinancialAccountId } }),
  ]);
  if (!book || !fromFinancial || !toFinancial || fromFinancial.legalEntityId !== book.legalEntityId
    || toFinancial.legalEntityId !== book.legalEntityId) throw new AccountingCustomerTreasuryError('INTERNAL_TRANSFER_ENTITY_MISMATCH', 'دو حساب مالی انتقال باید به واحد گزارشگر دفتر تعلق داشته باشند.', 409);
  const evidence = lineEvidence('INTERNAL_TRANSFER', input.idempotencyKey, 1, payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: `ledger-${input.idempotencyKey}`, correlationId: input.correlationId, description: 'انتقال داخلی میان حساب‌های مالی',
    documentDate: input.occurredAt, occurredAt: input.occurredAt,
    source: { type: evidence.type, id: evidence.id, version: evidence.version, payload, hash: evidence.hash }, actor: input.actor, lines: [
      ledgerLine({ accountId: input.toLedgerAccountId, debitRials: input.amountRials, financialAccountId: toFinancial.id, evidence, description: 'ورود انتقال داخلی' }),
      ledgerLine({ accountId: input.fromLedgerAccountId, creditRials: input.amountRials, financialAccountId: fromFinancial.id, evidence, description: 'خروج انتقال داخلی' }),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: 'ثبت انتقال داخلی بدون طبقه‌بندی جریان نقد خارجی' });
  await tx.accountingTreasuryTransaction.createMany({ data: [
    { financialAccountId: fromFinancial.id, kind: 'INTERNAL_TRANSFER', direction: 'OUTBOUND', amountRials: input.amountRials.toString(),
      idempotencyKey: `${input.idempotencyKey}:out`, sourceType: 'INTERNAL_TRANSFER', sourceId: input.idempotencyKey,
      sourceVersion: 1, sourceHash, occurredAt: input.occurredAt, postedVoucherId: voucher.id, createdBy: input.actor.id },
    { financialAccountId: toFinancial.id, kind: 'INTERNAL_TRANSFER', direction: 'INBOUND', amountRials: input.amountRials.toString(),
      idempotencyKey: `${input.idempotencyKey}:in`, sourceType: 'INTERNAL_TRANSFER', sourceId: input.idempotencyKey,
      sourceVersion: 2, sourceHash, occurredAt: input.occurredAt, postedVoucherId: voucher.id, createdBy: input.actor.id },
  ] });
  return tx.accountingTreasuryTransaction.findMany({ where: { sourceType: 'INTERNAL_TRANSFER', sourceId: input.idempotencyKey }, orderBy: { direction: 'asc' } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const allocateCustomerReceiptPrisma = async (database: PrismaClient, input: {
  treasuryTransactionId: string; allocations: Array<{ openItemId: string; amountRials: bigint }>;
  bookId: string; fiscalYearId: string; periodId: string; customerAdvanceLedgerId: string; receivableLedgerId: string;
  documentDate: Date; idempotencyKey: string; correlationId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.treasuryTransactionId}))`;
  const receipt = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.treasuryTransactionId }, include: {
    allocations: { where: { reversesId: null, reversedById: null }, include: { lines: true } }, profile: true,
  } });
  if (!receipt || receipt.kind !== 'CUSTOMER_RECEIPT' || !receipt.profile) throw new AccountingCustomerTreasuryError('RECEIPT_NOT_FOUND', 'دریافت مشتری پیدا نشد.', 404);
  const payload = { treasuryTransactionId: receipt.id,
    allocations: [...input.allocations].map((item) => ({ openItemId: item.openItemId, amountRials: item.amountRials }))
      .sort((left, right) => left.openItemId.localeCompare(right.openItemId)),
    bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    customerAdvanceLedgerId: input.customerAdvanceLedgerId, receivableLedgerId: input.receivableLedgerId,
    documentDate: input.documentDate };
  const prior = await tx.accountingSettlementAllocation.findUnique({ where: { idempotencyKey: input.idempotencyKey },
    include: { lines: true } });
  if (prior) {
    const priorVoucher = prior.ledgerVoucherId
      ? await tx.accountingLedgerVoucher.findUnique({ where: { id: prior.ledgerVoucherId } }) : null;
    if (prior.treasuryTransactionId !== input.treasuryTransactionId
      || priorVoucher?.sourceHash !== hashAccountingEvidence(payload)) {
      throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید تکرار تخصیص برای فرمان متفاوتی استفاده شده است.', 409);
    }
    return prior;
  }
  const requestedTotal = input.allocations.reduce((total, item) => total + item.amountRials, 0n);
  const used = receipt.allocations.flatMap((item) => item.lines).reduce((total, item) => total + toBigInt(item.amountRials), 0n);
  if (requestedTotal <= 0n || used + requestedTotal > toBigInt(receipt.amountRials)) throw new AccountingCustomerTreasuryError('RECEIPT_OVER_ALLOCATED', 'جمع تخصیص‌ها از مانده دریافت بیشتر است.', 409);
  const items = await tx.accountingCustomerOpenItem.findMany({ where: { id: { in: input.allocations.map((item) => item.openItemId) } }, include: {
    allocationLines: { where: { allocation: { reversesId: null, reversedById: null } } },
  } });
  for (const requested of input.allocations) {
    const item = items.find(({ id }) => id === requested.openItemId);
    if (!item) throw new AccountingCustomerTreasuryError('OPEN_ITEM_NOT_FOUND', 'قلم باز پیدا نشد.', 404);
    if (item.kind !== 'RECEIVABLE') throw new AccountingCustomerTreasuryError('CREDIT_ITEM_DIRECT_ALLOCATION_FORBIDDEN', 'اعتبار برگشت از فروش با دریافت تخصیص نمی‌یابد.', 409);
    if (item.profileId !== receipt.profileId) throw new AccountingCustomerTreasuryError('CROSS_CUSTOMER_ALLOCATION', 'تخصیص بین دو مشتری مجاز نیست.', 409);
    const allocated = item.allocationLines.reduce((total, line) => total + toBigInt(line.amountRials), 0n);
    if (requested.amountRials <= 0n || allocated + requested.amountRials > toBigInt(item.originalRials)) throw new AccountingCustomerTreasuryError('OPEN_ITEM_OVER_ALLOCATED', 'مبلغ تخصیص از مانده قلم باز بیشتر است.', 409);
  }
  const evidence = lineEvidence('SETTLEMENT_ALLOCATION', input.idempotencyKey, 1, payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, description: 'تخصیص دریافت مشتری به اقلام باز',
    documentDate: input.documentDate, occurredAt: input.documentDate,
    source: { type: evidence.type, id: evidence.id, version: evidence.version, payload, hash: evidence.hash }, actor: input.actor, lines: [
      ledgerLine({ accountId: input.customerAdvanceLedgerId, debitRials: requestedTotal, partyId: receipt.profile.accountingPartyId, evidence, description: 'کاهش بستانکاری تخصیص‌نیافته' }),
      ledgerLine({ accountId: input.receivableLedgerId, creditRials: requestedTotal, partyId: receipt.profile.accountingPartyId, evidence, description: 'تسویه مطالبات مشتری' }),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: 'ثبت قطعی تخصیص دریافت به مطالبات' });
  return tx.accountingSettlementAllocation.create({ data: { treasuryTransactionId: receipt.id, idempotencyKey: input.idempotencyKey, ledgerVoucherId: voucher.id,
    createdBy: input.actor.id, lines: { create: input.allocations.map((item) => ({ openItemId: item.openItemId, amountRials: item.amountRials.toString() })) } }, include: { lines: true } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const reverseCustomerAllocationPrisma = async (database: PrismaClient, input: {
  allocationId: string; reason: string; bookId: string; fiscalYearId: string; periodId: string;
  customerAdvanceLedgerId: string; receivableLedgerId: string; documentDate: Date;
  idempotencyKey: string; correlationId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  if (input.reason.trim().length < 8) throw new AccountingCustomerTreasuryError('REVERSAL_REASON_REQUIRED', 'دلیل برگشت تخصیص الزامی است.', 400);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.allocationId}))`;
  const original = await tx.accountingSettlementAllocation.findUnique({ where: { id: input.allocationId }, include: {
    lines: true, transaction: { include: { profile: true } }, reversedBy: true,
  } });
  if (!original || original.reversesId || !original.transaction.profile) throw new AccountingCustomerTreasuryError('ALLOCATION_NOT_FOUND', 'تخصیص پیدا نشد.', 404);
  if (original.reversedBy) return original.reversedBy;
  const total = original.lines.reduce((sum, line) => sum + toBigInt(line.amountRials), 0n);
  const payload = { reversesAllocationId: original.id, reason: input.reason.trim(), originalLines: original.lines.map((line) => ({ openItemId: line.openItemId, amountRials: line.amountRials.toString() })) };
  const evidence = lineEvidence('SETTLEMENT_ALLOCATION_REVERSAL', original.id, 1, payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, description: 'برگشت تخصیص دریافت مشتری',
    documentDate: input.documentDate, occurredAt: input.documentDate,
    source: { type: evidence.type, id: evidence.id, version: evidence.version, payload, hash: evidence.hash }, actor: input.actor, lines: [
      ledgerLine({ accountId: input.receivableLedgerId, debitRials: total, partyId: original.transaction.profile.accountingPartyId, evidence, description: 'بازگشایی مطالبات مشتری' }),
      ledgerLine({ accountId: input.customerAdvanceLedgerId, creditRials: total, partyId: original.transaction.profile.accountingPartyId, evidence, description: 'بازگرداندن بستانکاری تخصیص‌نیافته' }),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason.trim() });
  const reversal = await tx.accountingSettlementAllocation.create({ data: { treasuryTransactionId: original.treasuryTransactionId,
    reversesId: original.id, reason: input.reason.trim(), idempotencyKey: input.idempotencyKey, ledgerVoucherId: voucher.id,
    createdBy: input.actor.id, lines: { create: original.lines.map((line) => ({ openItemId: line.openItemId, amountRials: line.amountRials })) } } });
  await tx.accountingSettlementAllocation.update({ where: { id: original.id }, data: { reversedById: reversal.id } });
  return reversal;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const projectCustomerAccountPrisma = async (database: Database, input: { profileId: string; asOf: Date }) => {
  const [profile, items, receipts] = await Promise.all([
    database.accountingCustomerProfile.findUnique({ where: { id: input.profileId } }),
    database.accountingCustomerOpenItem.findMany({ where: { profileId: input.profileId, postedAt: { lte: input.asOf } }, include: {
      invoice: true, allocationLines: { where: { createdAt: { lte: input.asOf }, allocation: { reversesId: null } },
        include: { allocation: { include: { reversedBy: true } } } },
    }, orderBy: { dueAt: 'asc' } }),
    database.accountingTreasuryTransaction.findMany({ where: { profileId: input.profileId, kind: 'CUSTOMER_RECEIPT', occurredAt: { lte: input.asOf } }, include: {
      allocations: { where: { reversesId: null, createdAt: { lte: input.asOf } }, include: { lines: true, reversedBy: true } },
    } }),
  ]);
  if (!profile) throw new AccountingCustomerTreasuryError('CUSTOMER_PROFILE_NOT_FOUND', 'حساب مالی مشتری پیدا نشد.', 404);
  const activeAt = <T extends { reversedBy: { createdAt: Date } | null }>(item: T) => !item.reversedBy || item.reversedBy.createdAt > input.asOf;
  const activityItems = items.map((item) => { const allocated = item.allocationLines.filter((line) => activeAt(line.allocation))
    .reduce((total, line) => total + toBigInt(line.amountRials), 0n);
    return { id: item.id, kind: item.kind, invoiceId: item.invoiceId, invoiceNumber: item.invoice.number, contractId: item.contractId, dueAt: item.dueAt,
      originalRials: toBigInt(item.originalRials), remainingRials: toBigInt(item.originalRials) - allocated,
      ledgerVoucherId: item.invoice.ledgerVoucherId, taxInvoiceId: item.invoice.taxInvoiceId,
      controlEvidence: { type: item.invoice.controlEvidenceType, id: item.invoice.controlEvidenceId,
        version: item.invoice.controlEvidenceVersion, hash: item.invoice.controlEvidenceHash },
      agingDays: Math.max(0, Math.floor((input.asOf.getTime() - item.dueAt.getTime()) / 86_400_000)) }; });
  const openItems = activityItems.filter((item) => item.remainingRials > 0n);
  const unallocatedCreditRials = receipts.reduce((total, receipt) => total + toBigInt(receipt.amountRials)
    - receipt.allocations.filter(activeAt).flatMap((allocation) => allocation.lines)
      .reduce((allocated, line) => allocated + toBigInt(line.amountRials), 0n), 0n);
  return { profile: { ...profile, openingBalanceRials: toBigInt(profile.openingBalanceRials) },
    receivableRials: openItems.reduce((total, item) => total + (item.kind === 'CREDIT' ? -item.remainingRials : item.remainingRials), 0n),
    unallocatedCreditRials, openItems, activityItems,
    receipts: receipts.map((receipt) => ({ id: receipt.id, contractId: receipt.contractId, financialAccountId: receipt.financialAccountId,
      amountRials: toBigInt(receipt.amountRials), occurredAt: receipt.occurredAt, postedVoucherId: receipt.postedVoucherId,
      source: { type: receipt.sourceType, id: receipt.sourceId, version: receipt.sourceVersion, hash: receipt.sourceHash },
      allocatedRials: receipt.allocations.filter(activeAt).flatMap((allocation) => allocation.lines)
        .reduce((total, line) => total + toBigInt(line.amountRials), 0n),
      allocations: receipt.allocations.map((allocation) => ({ id: allocation.id, createdAt: allocation.createdAt,
        reversedAt: allocation.reversedBy?.createdAt ?? null, ledgerVoucherId: allocation.ledgerVoucherId,
        lines: allocation.lines.map((line) => ({ openItemId: line.openItemId, amountRials: toBigInt(line.amountRials) })) })) })),
  };
};

export const listCustomerAccountsPrisma = async (database: PrismaClient, input: { asOf: Date; search?: string }) => {
  const profiles = await database.accountingCustomerProfile.findMany({ where: input.search?.trim() ? { OR: [
    { displayName: { contains: input.search.trim(), mode: 'insensitive' } },
    { partySourceId: { contains: input.search.trim(), mode: 'insensitive' } },
  ] } : undefined, orderBy: { displayName: 'asc' }, take: 200 });
  return Promise.all(profiles.map(async (profile) => {
    const projection = await projectCustomerAccountPrisma(database, { profileId: profile.id, asOf: input.asOf });
    return { id: profile.id, displayName: profile.displayName, partySourceId: profile.partySourceId,
      activeFrom: profile.activeFrom, receivableRials: projection.receivableRials,
      unallocatedCreditRials: projection.unallocatedCreditRials, openItemCount: projection.openItems.length,
      oldestDueAt: projection.openItems[0]?.dueAt ?? null };
  }));
};

export const listTreasuryOverviewPrisma = async (database: PrismaClient) => {
  const [transactions, bankLines, checks, cashCounts, pettyCash] = await Promise.all([
    database.accountingTreasuryTransaction.findMany({ orderBy: { occurredAt: 'desc' }, take: 100,
      include: { profile: { select: { displayName: true } }, allocations: { include: { lines: true } } } }),
    database.accountingBankStatementLine.findMany({ orderBy: { bookedAt: 'desc' }, take: 100,
      include: { matches: { orderBy: { createdAt: 'desc' } } } }),
    database.accountingCheckInstrument.findMany({ orderBy: { dueAt: 'asc' }, take: 100,
      include: { events: { orderBy: { sequence: 'asc' } } } }),
    database.accountingCashCount.findMany({ orderBy: { countedAt: 'desc' }, take: 50 }),
    database.accountingPettyCashAdvance.findMany({ orderBy: { settlementDueAt: 'asc' }, take: 100 }),
  ]);
  return { transactions, bankLines, checks, cashCounts, pettyCash };
};

export const listTaxOverviewPrisma = async (database: PrismaClient) => {
  const [invoices, channels, reconciliations, rules] = await Promise.all([
    database.accountingTaxInvoice.findMany({ orderBy: { issuedAt: 'desc' }, take: 100,
      include: { outboxMessages: { include: { attempts: { orderBy: { attemptNumber: 'desc' } } } } } }),
    database.accountingTaxSubmissionChannel.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 50,
      select: { id: true, legalEntityId: true, kind: true, providerName: true, safeKeyVersion: true,
        effectiveFrom: true, effectiveTo: true, healthStatus: true, createdAt: true } }),
    database.accountingVatReconciliation.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    database.accountingTaxRule.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], take: 100 }),
  ]);
  return { invoices, channels, reconciliations, rules };
};

const exportCell = (value: unknown) => {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const exportHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

export const exportCustomerStatementPrisma = async (database: PrismaClient, input: {
  profileId: string; asOf: Date; format: 'xlsx' | 'pdf'; actorId: string;
}) => {
  const projection = await projectCustomerAccountPrisma(database, { profileId: input.profileId, asOf: input.asOf });
  const rows = [
    ...projection.activityItems.map((item) => ({ نوع: item.kind === 'CREDIT' ? 'اصلاح فروش' : 'صورتحساب فروش', تاریخ: item.dueAt.toISOString(), قرارداد: item.contractId,
      مرجع: item.invoiceNumber, بدهکار: item.kind === 'CREDIT' ? '0' : item.originalRials.toString(),
      بستانکار: item.kind === 'CREDIT' ? item.originalRials.toString() : '0', مانده: item.remainingRials.toString(),
      سند: item.ledgerVoucherId, شاهد: `${item.controlEvidence.type}:${item.controlEvidence.id}:${item.controlEvidence.version}` })),
    ...projection.receipts.map((receipt) => ({ نوع: 'دریافت', تاریخ: receipt.occurredAt.toISOString(), قرارداد: receipt.contractId ?? '',
      مرجع: `${receipt.source.type}:${receipt.source.id}:${receipt.source.version}`, بدهکار: '0', بستانکار: receipt.amountRials.toString(),
      مانده: (receipt.amountRials - receipt.allocatedRials).toString(), سند: receipt.postedVoucherId ?? '', شاهد: receipt.source.hash })),
    ...projection.receipts.flatMap((receipt) => receipt.allocations.flatMap((allocation) => [
      ...allocation.lines.map((line) => ({ نوع: 'تخصیص دریافت', تاریخ: allocation.createdAt.toISOString(), قرارداد: receipt.contractId ?? '',
        مرجع: line.openItemId, بدهکار: line.amountRials.toString(), بستانکار: line.amountRials.toString(), مانده: '0',
        سند: allocation.ledgerVoucherId ?? '', شاهد: allocation.id })),
      ...(allocation.reversedAt ? allocation.lines.map((line) => ({ نوع: 'برگشت تخصیص', تاریخ: allocation.reversedAt!.toISOString(), قرارداد: receipt.contractId ?? '',
        مرجع: line.openItemId, بدهکار: line.amountRials.toString(), بستانکار: line.amountRials.toString(), مانده: '0',
        سند: allocation.ledgerVoucherId ?? '', شاهد: allocation.id })) : []),
    ])),
  ].map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, exportCell(value)])));
  const sourceHash = hashCustomerTreasuryEvidence({ profileId: input.profileId, asOf: input.asOf, rows });
  const requestIdentity = hashCustomerTreasuryEvidence({ profileId: input.profileId, asOf: input.asOf, format: input.format, sourceHash });
  const prior = await database.accountingCustomerStatementExport.findUnique({ where: { requestIdentity } });
  if (prior) return { bytes: Buffer.from(prior.content),
    mimeType: input.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf', extension: input.format };
  let bytes: Buffer;
  if (input.format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'صورتحساب مشتری');
    bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  } else {
    const headers = rows.length ? Object.keys(rows[0]) : ['نوع', 'تاریخ', 'مرجع', 'مانده'];
    const html = `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px;text-align:right;font-size:11px}h1{font-size:18px}</style><h1>صورتحساب مشتری — ${exportHtml(projection.profile.displayName)}</h1><p>تا تاریخ ${exportHtml(input.asOf.toISOString())}</p><table><thead><tr>${headers.map((header) => `<th>${exportHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${exportHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
    bytes = await generatePdfBufferFromHtml({ htmlContent: html });
  }
  await database.accountingCustomerStatementExport.create({ data: { requestIdentity, profileId: input.profileId,
    asOf: input.asOf, format: input.format, dataset: json(rows), sourceHash,
    contentHash: createHash('sha256').update(bytes).digest('hex'), content: bytes, createdBy: input.actorId } });
  return { bytes, mimeType: input.format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf', extension: input.format };
};

export const createBankImportMappingPrisma = async (database: PrismaClient, input: { financialAccountId: string;
  adapterType: 'API' | 'CSV' | 'XLSX'; version: number; columnMapping: { sourceIdentityField: string; bookedAtField: string;
    amountField: string; directionField: string; descriptionField: string; inboundValues: string[]; outboundValues: string[] };
  effectiveFrom: Date; effectiveTo?: Date; actor: CustomerTreasuryActor;
}) => {
  const normalizedMapping = { ...input.columnMapping,
    inboundValues: [...new Set(input.columnMapping.inboundValues.map((value) => value.trim()).filter(Boolean))].sort(),
    outboundValues: [...new Set(input.columnMapping.outboundValues.map((value) => value.trim()).filter(Boolean))].sort() };
  const fields = [input.columnMapping.sourceIdentityField, input.columnMapping.bookedAtField, input.columnMapping.amountField,
    input.columnMapping.directionField, input.columnMapping.descriptionField];
  if (input.actor.profile !== 'ACCOUNTING_MANAGER' || !['API', 'CSV', 'XLSX'].includes(input.adapterType)
    || !Number.isInteger(input.version) || input.version < 1 || fields.some((field) => !field.trim())
    || normalizedMapping.inboundValues.length === 0 || normalizedMapping.outboundValues.length === 0
    || normalizedMapping.inboundValues.some((value) => normalizedMapping.outboundValues.includes(value))) {
    throw new AccountingCustomerTreasuryError('BANK_MAPPING_INVALID', 'نسخه و نگاشت منبع بانکی معتبر نیست.', 400);
  }
  const evidenceHash = hashCustomerTreasuryEvidence({ ...input, columnMapping: normalizedMapping, actor: undefined });
  return database.accountingBankImportMapping.create({ data: { financialAccountId: input.financialAccountId,
    adapterType: input.adapterType, version: input.version, columnMapping: json(normalizedMapping),
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, evidenceHash, createdBy: input.actor.id } });
};

export const importBankStatementLinePrisma = async (database: PrismaClient, input: {
  financialAccountId: string; adapterType: 'API' | 'CSV' | 'XLSX' | 'MANUAL'; mappingVersion: number; sourceIdentity: string;
  bookedAt: Date; amountRials: bigint; direction: 'INBOUND' | 'OUTBOUND'; description: string; evidence: unknown;
}) => database.$transaction(async (tx) => {
  let normalized = { sourceIdentity: input.sourceIdentity, bookedAt: input.bookedAt, amountRials: input.amountRials,
    direction: input.direction, description: input.description };
  let mappingId: string | undefined;
  if (input.adapterType !== 'MANUAL') {
    const mapping = await tx.accountingBankImportMapping.findUnique({ where: { financialAccountId_adapterType_version: {
      financialAccountId: input.financialAccountId, adapterType: input.adapterType, version: input.mappingVersion } } });
    const rawRecord = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence)
      ? (input.evidence as Record<string, unknown>).rawRecord : null;
    const columns = mapping?.columnMapping as { sourceIdentityField?: string; bookedAtField?: string; amountField?: string;
      directionField?: string; descriptionField?: string; inboundValues?: string[]; outboundValues?: string[] } | null;
    if (!mapping || !columns || !rawRecord) {
      throw new AccountingCustomerTreasuryError('BANK_MAPPING_NOT_EFFECTIVE', 'نگاشت نسخه‌دار و مؤثر برای منبع بانکی پیدا نشد.', 409);
    }
    const rawAmount = String(rawRecord[String(columns.amountField)] ?? '').trim();
    const rawDirection = String(rawRecord[String(columns.directionField)] ?? '').trim();
    const mappedDate = new Date(String(rawRecord[String(columns.bookedAtField)] ?? ''));
    if (!/^\d+$/.test(rawAmount) || Number.isNaN(mappedDate.getTime())) throw new AccountingCustomerTreasuryError('BANK_SOURCE_ROW_INVALID', 'ردیف منبع بانکی با نگاشت انتخاب‌شده سازگار نیست.', 400);
    if (mapping.effectiveFrom > mappedDate || (mapping.effectiveTo != null && mapping.effectiveTo < mappedDate)) {
      throw new AccountingCustomerTreasuryError('BANK_MAPPING_NOT_EFFECTIVE', 'نگاشت نسخه‌دار در تاریخ ردیف بانکی مؤثر نیست.', 409);
    }
    const direction = columns.inboundValues?.includes(rawDirection) ? 'INBOUND'
      : columns.outboundValues?.includes(rawDirection) ? 'OUTBOUND' : null;
    if (!direction) throw new AccountingCustomerTreasuryError('BANK_SOURCE_DIRECTION_INVALID', 'جهت ردیف بانکی در نگاشت نسخه‌دار تعریف نشده است.', 400);
    normalized = { sourceIdentity: String(rawRecord[String(columns.sourceIdentityField)] ?? '').trim(), bookedAt: mappedDate,
      amountRials: BigInt(rawAmount), direction, description: String(rawRecord[String(columns.descriptionField)] ?? '').trim() };
    mappingId = mapping.id;
  }
  if (normalized.amountRials <= 0n || !normalized.sourceIdentity || !normalized.description || !['INBOUND', 'OUTBOUND'].includes(normalized.direction)) {
    throw new AccountingCustomerTreasuryError('INVALID_BANK_LINE_AMOUNT', 'مبلغ ردیف بانکی باید مثبت و جهت آن معتبر باشد.', 400);
  }
  const sourceHash = hashCustomerTreasuryEvidence(input.evidence);
  const prior = await tx.accountingBankStatementLine.findUnique({ where: { financialAccountId_sourceIdentity: {
    financialAccountId: input.financialAccountId, sourceIdentity: normalized.sourceIdentity,
  } } });
  if (prior) {
    if (prior.adapterType !== input.adapterType || prior.mappingVersion !== input.mappingVersion
      || prior.bookedAt.getTime() !== normalized.bookedAt.getTime() || toBigInt(prior.amountRials) !== normalized.amountRials
      || prior.direction !== normalized.direction || prior.description !== normalized.description || prior.sourceHash !== sourceHash) {
      throw new AccountingCustomerTreasuryError('BANK_SOURCE_IDENTITY_CONFLICT', 'شناسه منبع ردیف بانکی با محتوای متفاوت تکرار شده است.', 409);
    }
    return prior;
  }
  return tx.accountingBankStatementLine.create({ data: { financialAccountId: input.financialAccountId,
    adapterType: input.adapterType, mappingVersion: input.mappingVersion, mappingId, ...normalized,
    amountRials: normalized.amountRials.toString(), evidence: json(input.evidence), sourceHash } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const proposeBankMatchesPrisma = async (database: PrismaClient, bankStatementLineId: string) => database.$transaction(async (tx) => {
  const line = await tx.accountingBankStatementLine.findUnique({ where: { id: bankStatementLineId } });
  if (!line) throw new AccountingCustomerTreasuryError('BANK_LINE_NOT_FOUND', 'ردیف صورتحساب بانکی پیدا نشد.', 404);
  const candidates = await tx.accountingTreasuryTransaction.findMany({ where: { financialAccountId: line.financialAccountId,
    direction: line.direction, amountRials: line.amountRials,
    occurredAt: { gte: new Date(line.bookedAt.getTime() - 3 * 86_400_000), lte: new Date(line.bookedAt.getTime() + 3 * 86_400_000) } } });
  return Promise.all(candidates.map((candidate) => tx.accountingBankReconciliationMatch.upsert({ where: {
    bankStatementLineId_treasuryTransactionId: { bankStatementLineId: line.id, treasuryTransactionId: candidate.id },
  }, create: { bankStatementLineId: line.id, treasuryTransactionId: candidate.id, status: 'PROPOSED',
    score: candidate.occurredAt.toDateString() === line.bookedAt.toDateString() ? 100 : 80 }, update: {} })));
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const confirmBankMatchPrisma = async (database: PrismaClient, input: { matchId: string; actor: CustomerTreasuryActor; reason: string }) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.matchId}))`;
  const match = await tx.accountingBankReconciliationMatch.findUnique({ where: { id: input.matchId } });
  if (!match) throw new AccountingCustomerTreasuryError('BANK_MATCH_NOT_FOUND', 'پیشنهاد تطبیق بانکی پیدا نشد.', 404);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${match.bankStatementLineId}))`;
  const confirmed = await tx.accountingBankReconciliationMatch.findFirst({ where: { bankStatementLineId: match.bankStatementLineId, status: 'CONFIRMED' } });
  if (confirmed && confirmed.id !== match.id) throw new AccountingCustomerTreasuryError('BANK_LINE_ALREADY_MATCHED', 'این ردیف بانکی قبلاً قطعی تطبیق داده شده است.', 409);
  return tx.accountingBankReconciliationMatch.update({ where: { id: match.id }, data: { status: 'CONFIRMED', confirmedBy: input.actor.id,
    confirmedAt: new Date(), confirmationReason: input.reason.trim() || 'تأیید تطبیق بانکی' } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const reverseBankMatchPrisma = async (database: PrismaClient, input: { matchId: string; actor: CustomerTreasuryActor; reason: string }) => database.$transaction(async (tx) => {
  const match = await tx.accountingBankReconciliationMatch.findUnique({ where: { id: input.matchId } });
  if (!match) throw new AccountingCustomerTreasuryError('BANK_MATCH_NOT_FOUND', 'تطبیق بانکی پیدا نشد.', 404);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${match.bankStatementLineId}))`;
  if (match.status !== 'CONFIRMED') throw new AccountingCustomerTreasuryError('BANK_MATCH_NOT_CONFIRMED', 'فقط تطبیق قطعی قابل برگشت است.', 409);
  if (input.reason.trim().length < 8) throw new AccountingCustomerTreasuryError('BANK_MATCH_REVERSAL_REASON_REQUIRED', 'دلیل برگشت تطبیق باید روشن و قابل حسابرسی باشد.', 400);
  return tx.accountingBankReconciliationMatch.update({ where: { id: match.id }, data: { status: 'REVERSED',
    reversedBy: input.actor.id, reversedAt: new Date(), reversalReason: input.reason.trim() } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

const checkTransitions: Record<string, ReadonlySet<string>> = {
  RECEIVED: new Set(['ENDORSED', 'DEPOSITED', 'RETURNED', 'CANCELLED']),
  ENDORSED: new Set(['ASSIGNED', 'DEPOSITED', 'RETURNED']),
  ASSIGNED: new Set(['RETURNED']),
  DEPOSITED: new Set(['CLEARED', 'BOUNCED']),
  BOUNCED: new Set(['DEPOSITED', 'RETURNED', 'REPLACED']),
};

export const createReceivableCheckPrisma = async (database: PrismaClient, input: {
  legalEntityId: string; profileId: string; sayadId?: string; serialNumber: string; bankName: string; amountRials: bigint;
  dueAt: Date; custodianId?: string; evidence: unknown; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  if (input.amountRials <= 0n) throw new AccountingCustomerTreasuryError('INVALID_CHECK_AMOUNT', 'مبلغ چک باید بیشتر از صفر باشد.', 400);
  const evidenceHash = hashCustomerTreasuryEvidence(input.evidence);
  const instrument = await tx.accountingCheckInstrument.create({ data: { legalEntityId: input.legalEntityId, profileId: input.profileId,
    direction: 'RECEIVABLE', sayadId: input.sayadId, serialNumber: input.serialNumber, bankName: input.bankName,
    amountRials: input.amountRials.toString(), dueAt: input.dueAt, status: 'RECEIVED', custodianId: input.custodianId,
    evidenceHash, createdBy: input.actor.id } });
  await tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: instrument.id, sequence: 1, eventType: 'RECEIVED',
    occurredAt: new Date(), actorId: input.actor.id, toCustodianId: input.custodianId, evidence: json(input.evidence), evidenceHash } });
  return instrument;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const transitionReceivableCheckPrisma = async (database: PrismaClient, input: { checkId: string; nextStatus: string;
  occurredAt: Date; fromCustodianId?: string; toCustodianId?: string; postingRuleVersion?: number; ledgerVoucherId?: string;
  evidence: unknown; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.checkId}))`;
  const instrument = await tx.accountingCheckInstrument.findUnique({ where: { id: input.checkId }, include: { events: true } });
  if (!instrument) throw new AccountingCustomerTreasuryError('CHECK_NOT_FOUND', 'چک دریافتنی پیدا نشد.', 404);
  if (!checkTransitions[instrument.status]?.has(input.nextStatus)) throw new AccountingCustomerTreasuryError('INVALID_CHECK_TRANSITION', 'تغییر وضعیت چک با سابقه فعلی آن سازگار نیست.', 409);
  const nextSequence = instrument.events.length + 1;
  if (['ASSIGNED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED'].includes(input.nextStatus)) {
    if (!Number.isInteger(input.postingRuleVersion) || input.postingRuleVersion! < 1 || !input.ledgerVoucherId) {
      throw new AccountingCustomerTreasuryError('CHECK_POSTING_REQUIRED', 'برای این رویداد چک، نسخه قاعده و سند قطعی مرتبط الزامی است.', 409);
    }
    const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: input.ledgerVoucherId } });
    if (!voucher || voucher.status !== 'POSTED' || voucher.sourceType !== 'CHECK_INSTRUMENT'
      || voucher.sourceId !== instrument.id || voucher.sourceVersion !== nextSequence) {
      throw new AccountingCustomerTreasuryError('CHECK_POSTING_INVALID', 'سند قطعی چک با هویت و نسخه رویداد سازگار نیست.', 409);
    }
  }
  const evidenceHash = hashCustomerTreasuryEvidence(input.evidence);
  await tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: instrument.id, sequence: nextSequence,
    eventType: input.nextStatus, occurredAt: input.occurredAt, actorId: input.actor.id, fromCustodianId: input.fromCustodianId,
    toCustodianId: input.toCustodianId, postingRuleVersion: input.postingRuleVersion, ledgerVoucherId: input.ledgerVoucherId,
    evidence: json(input.evidence), evidenceHash } });
  return tx.accountingCheckInstrument.update({ where: { id: instrument.id }, data: { status: input.nextStatus,
    custodianId: input.toCustodianId === undefined ? instrument.custodianId : input.toCustodianId } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const recordCashCountPrisma = async (database: PrismaClient, input: { financialAccountId: string; custodianId: string;
  cashCountId: string; countedAt: Date; expectedRials: bigint; countedRials: bigint; ledgerVoucherId?: string; evidence: unknown; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-count:${input.cashCountId}`}))`;
  const prior = await tx.accountingCashCount.findUnique({ where: { id: input.cashCountId } });
  if (prior) {
    const sameCommand = prior.financialAccountId === input.financialAccountId && prior.custodianId === input.custodianId
      && prior.countedAt.getTime() === input.countedAt.getTime() && toBigInt(prior.expectedRials) === input.expectedRials
      && toBigInt(prior.countedRials) === input.countedRials && prior.ledgerVoucherId === (input.ledgerVoucherId ?? null)
      && prior.evidenceHash === hashCustomerTreasuryEvidence(input.evidence);
    if (!sameCommand) throw new AccountingCustomerTreasuryError('EVIDENCE_IDENTITY_COLLISION', 'هویت شمارش صندوق قبلاً با محتوای متفاوت ثبت شده است.', 409);
    return prior;
  }
  const varianceRials = input.countedRials - input.expectedRials;
  if (varianceRials !== 0n && !input.ledgerVoucherId) throw new AccountingCustomerTreasuryError('CASH_VARIANCE_POSTING_REQUIRED', 'کسری یا اضافه صندوق باید با سند حسابداری مستقل ثبت شود.', 409);
  if (varianceRials !== 0n) {
    const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: input.ledgerVoucherId! }, include: { lines: true } });
    const linkedAmount = voucher?.lines.filter((line) => line.financialAccountId === input.financialAccountId)
      .reduce((total, line) => total + toBigInt(line.debitRials) - toBigInt(line.creditRials), 0n);
    if (!voucher || voucher.status !== 'POSTED' || voucher.sourceType !== 'CASH_COUNT'
      || voucher.sourceId !== input.cashCountId || voucher.sourceVersion !== 1 || linkedAmount !== varianceRials) {
      throw new AccountingCustomerTreasuryError('CASH_VARIANCE_POSTING_INVALID', 'سند قطعی و منطبق با مبلغ کسری یا اضافه صندوق پیدا نشد.', 409);
    }
  }
  return tx.accountingCashCount.create({ data: { id: input.cashCountId, financialAccountId: input.financialAccountId, custodianId: input.custodianId,
    countedAt: input.countedAt, expectedRials: input.expectedRials.toString(), countedRials: input.countedRials.toString(),
    varianceRials: varianceRials.toString(), ledgerVoucherId: input.ledgerVoucherId,
    evidenceHash: hashCustomerTreasuryEvidence(input.evidence), createdBy: input.actor.id } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const issuePettyCashAdvancePrisma = async (database: PrismaClient, input: { financialAccountId: string; custodianId: string;
  costCenterId: string; amountRials: bigint; limitRials: bigint; issuedAt: Date; settlementDueAt: Date;
  supportingEvidence: unknown; bookId: string; fiscalYearId: string; periodId: string; cashLedgerId: string;
  pettyCashAdvanceLedgerId: string; idempotencyKey: string; correlationId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  if (input.amountRials <= 0n || input.amountRials > input.limitRials) throw new AccountingCustomerTreasuryError('PETTY_CASH_LIMIT_EXCEEDED', 'مبلغ تنخواه باید مثبت و در سقف مصوب امین باشد.', 409);
  const payload = { financialAccountId: input.financialAccountId, custodianId: input.custodianId,
    costCenterId: input.costCenterId, amountRials: input.amountRials, limitRials: input.limitRials,
    issuedAt: input.issuedAt, settlementDueAt: input.settlementDueAt, supportingEvidence: input.supportingEvidence,
    bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    cashLedgerId: input.cashLedgerId, pettyCashAdvanceLedgerId: input.pettyCashAdvanceLedgerId };
  const sourceHash = hashCustomerTreasuryEvidence(payload);
  const prior = await tx.accountingTreasuryTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.sourceHash !== sourceHash || prior.financialAccountId !== input.financialAccountId
      || toBigInt(prior.amountRials) !== input.amountRials || prior.occurredAt.getTime() !== input.issuedAt.getTime()) {
      throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید تکرار تنخواه برای فرمان متفاوتی استفاده شده است.', 409);
    }
    return tx.accountingPettyCashAdvance.findUniqueOrThrow({ where: { treasuryTransactionId: prior.id } });
  }
  const evidence = lineEvidence('PETTY_CASH_ADVANCE', input.idempotencyKey, 1, payload);
  const app = ledgerApp(tx, new Date());
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: `ledger-${input.idempotencyKey}`, correlationId: input.correlationId, description: 'پرداخت تنخواه به امین',
    documentDate: input.issuedAt, occurredAt: input.issuedAt,
    source: { type: 'PETTY_CASH_ADVANCE', id: input.idempotencyKey, version: 1, payload, hash: hashAccountingEvidence(payload) },
    actor: input.actor, lines: [
      ledgerLine({ accountId: input.pettyCashAdvanceLedgerId, debitRials: input.amountRials, evidence, description: 'تنخواه پرداختی به امین' }),
      ledgerLine({ accountId: input.cashLedgerId, creditRials: input.amountRials, financialAccountId: input.financialAccountId, evidence, description: 'خروج وجه تنخواه' }),
    ] });
  const voucher = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: 'ثبت قطعی پرداخت تنخواه' });
  const treasury = await tx.accountingTreasuryTransaction.create({ data: { financialAccountId: input.financialAccountId,
    kind: 'PETTY_CASH_ADVANCE', direction: 'OUTBOUND', amountRials: input.amountRials.toString(), idempotencyKey: input.idempotencyKey,
    sourceType: 'PETTY_CASH_ADVANCE', sourceId: input.idempotencyKey, sourceVersion: 1,
    sourceHash, occurredAt: input.issuedAt, postedVoucherId: voucher.id, createdBy: input.actor.id } });
  return tx.accountingPettyCashAdvance.create({ data: { financialAccountId: input.financialAccountId,
    treasuryTransactionId: treasury.id, custodianId: input.custodianId,
    costCenterId: input.costCenterId, amountRials: input.amountRials.toString(), limitRials: input.limitRials.toString(),
    issuedAt: input.issuedAt, settlementDueAt: input.settlementDueAt, supportingEvidence: json(input.supportingEvidence),
    status: 'OPEN', createdBy: input.actor.id } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const settlePettyCashAdvancePrisma = async (database: PrismaClient, input: { advanceId: string; ledgerVoucherId: string;
  settledRials: bigint; settledAt: Date; evidence: unknown; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  const advance = await tx.accountingPettyCashAdvance.findUnique({ where: { id: input.advanceId }, include: { settlement: true } });
  if (!advance) throw new AccountingCustomerTreasuryError('PETTY_CASH_NOT_FOUND', 'تنخواه پیدا نشد.', 404);
  if (advance.settlement) return advance.settlement;
  if (input.settledRials !== toBigInt(advance.amountRials)) throw new AccountingCustomerTreasuryError('PETTY_CASH_SETTLEMENT_MISMATCH', 'مبلغ تسویه باید با مانده تنخواه برابر باشد.', 409);
  const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: input.ledgerVoucherId } });
  if (!voucher || voucher.status !== 'POSTED' || voucher.sourceType !== 'PETTY_CASH_SETTLEMENT'
    || voucher.sourceId !== advance.id || voucher.sourceVersion !== 1 || voucher.debitTotalRials.toString() !== input.settledRials.toString()) {
    throw new AccountingCustomerTreasuryError('PETTY_CASH_SETTLEMENT_POSTING_INVALID', 'سند قطعی تسویه تنخواه با مبلغ و هویت تنخواه سازگار نیست.', 409);
  }
  const settlement = await tx.accountingPettyCashSettlement.create({ data: { advanceId: advance.id,
    ledgerVoucherId: voucher.id, settledRials: input.settledRials.toString(), evidence: json(input.evidence),
    evidenceHash: hashCustomerTreasuryEvidence(input.evidence), settledAt: input.settledAt, createdBy: input.actor.id } });
  await tx.accountingPettyCashAdvance.update({ where: { id: advance.id }, data: { status: 'SETTLED', settledAt: input.settledAt } });
  return settlement;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const configureTaxSubmissionChannelPrisma = async (database: PrismaClient, input: { legalEntityId: string;
  kind: 'DIRECT' | 'TRUSTED_COMPANY'; providerName?: string; safeKeyVersion: string; secretReference: string;
  effectiveFrom: Date; effectiveTo?: Date; actor: CustomerTreasuryActor;
}) => {
  if (input.actor.profile !== 'ACCOUNTING_MANAGER') throw new AccountingCustomerTreasuryError('TAX_CHANNEL_FORBIDDEN', 'تنظیم کانال مالیاتی فقط برای مدیر حسابداری مجاز است.', 403);
  if (!input.secretReference.startsWith('vault://') || input.secretReference.length < 12) {
    throw new AccountingCustomerTreasuryError('TAX_SECRET_REFERENCE_REQUIRED', 'فقط ارجاع امن مخزن راز برای کانال مالیاتی پذیرفته می‌شود.', 400);
  }
  const channel = await database.accountingTaxSubmissionChannel.create({ data: { legalEntityId: input.legalEntityId,
    kind: input.kind, providerName: input.providerName?.trim(), safeKeyVersion: input.safeKeyVersion,
    secretReference: input.secretReference, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    healthStatus: 'ACTIVE', createdBy: input.actor.id } });
  return { id: channel.id, legalEntityId: channel.legalEntityId, kind: channel.kind, providerName: channel.providerName,
    safeKeyVersion: channel.safeKeyVersion, effectiveFrom: channel.effectiveFrom, effectiveTo: channel.effectiveTo,
    healthStatus: channel.healthStatus };
};

export const createAccountingTaxRulePrisma = async (database: PrismaClient, input: { legalEntityId: string; code: string;
  version: number; effectiveFrom: Date; effectiveTo?: Date; citation: string; invoiceType: string; invoicePattern: string;
  exempt: boolean; exemptionReason?: string; rateBasisPoints: number; allocationRule: string; roundingRule: string;
  actor: CustomerTreasuryActor;
}) => {
  if (input.actor.profile !== 'ACCOUNTING_MANAGER') throw new AccountingCustomerTreasuryError('TAX_RULE_FORBIDDEN', 'تعریف قاعده مالیاتی فقط برای مدیر حسابداری مجاز است.', 403);
  if (!input.code.trim() || !Number.isInteger(input.version) || input.version < 1 || input.citation.trim().length < 3
    || !input.invoiceType.trim() || !input.invoicePattern.trim() || !input.allocationRule.trim() || !input.roundingRule.trim()
    || !Number.isInteger(input.rateBasisPoints) || input.rateBasisPoints < 0 || input.rateBasisPoints > 10000
    || (input.exempt && (input.exemptionReason?.trim().length ?? 0) < 3)
    || (input.effectiveTo != null && input.effectiveTo < input.effectiveFrom)) {
    throw new AccountingCustomerTreasuryError('TAX_RULE_INVALID', 'نسخه، نرخ، استناد یا بازه اثر قاعده مالیاتی معتبر نیست.', 400);
  }
  const code = input.code.trim();
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.legalEntityId}:${code}:tax-rule`}))`;
    const overlap = await tx.accountingTaxRule.findFirst({ where: { legalEntityId: input.legalEntityId, code,
      effectiveFrom: { lte: input.effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.effectiveFrom } }] } });
    if (overlap) throw new AccountingCustomerTreasuryError('TAX_RULE_EFFECTIVE_RANGE_OVERLAP', 'بازه اثر این قاعده مالیاتی با نسخه موجود هم‌پوشانی دارد.', 409);
    return tx.accountingTaxRule.create({ data: { legalEntityId: input.legalEntityId, code, version: input.version,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, citation: input.citation.trim(),
      invoiceType: input.invoiceType.trim(), invoicePattern: input.invoicePattern.trim(), exempt: input.exempt,
      exemptionReason: input.exemptionReason?.trim(), components: { rateBasisPoints: input.exempt ? 0 : input.rateBasisPoints },
      allocationRule: input.allocationRule.trim(), roundingRule: input.roundingRule.trim(), createdBy: input.actor.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

export const bindTaxOutboxChannelPrisma = async (database: PrismaClient, input: { outboxMessageId: string; channelId: string }) => database.$transaction(async (tx) => {
  const [message, channel] = await Promise.all([
    tx.accountingTaxOutboxMessage.findUnique({ where: { id: input.outboxMessageId }, include: { taxInvoice: true } }),
    tx.accountingTaxSubmissionChannel.findUnique({ where: { id: input.channelId } }),
  ]);
  const voucher = message?.taxInvoice.ledgerVoucherId
    ? await tx.accountingLedgerVoucher.findUnique({ where: { id: message.taxInvoice.ledgerVoucherId }, include: { book: true } }) : null;
  if (!message || !channel || !voucher || channel.legalEntityId !== voucher.book.legalEntityId || channel.healthStatus !== 'ACTIVE'
    || message.taxInvoice.issuedAt < channel.effectiveFrom
    || (channel.effectiveTo != null && message.taxInvoice.issuedAt > channel.effectiveTo)) {
    throw new AccountingCustomerTreasuryError('TAX_CHANNEL_NOT_EFFECTIVE', 'کانال مالیاتی مؤثر برای این صورتحساب پیدا نشد.', 409);
  }
  return tx.accountingTaxOutboxMessage.update({ where: { id: message.id }, data: { channelId: channel.id, status: 'PENDING' } });
});

export const publishVatInputEvidencePrisma = async (database: PrismaClient, input: { legalEntityId: string; fiscalYearId: string;
  periodId: string; kind: 'PURCHASE_CREDIT' | 'CORRECTION' | 'PAYMENT' | 'CARRYFORWARD' | 'PENALTY' | 'NON_CREDITABLE';
  amountRials: bigint; sourceType: string; sourceId: string; sourceVersion: number; payload: unknown; occurredAt: Date;
}) => { const source = input.sourceType === 'ACCOUNTING_LEDGER_LINE'
  ? await database.accountingLedgerLine.findUnique({ where: { id: input.sourceId }, include: { account: true, voucher: { include: { book: true } } } }) : null;
const sourceAmount = source ? toBigInt(source.debitRials) - toBigInt(source.creditRials) : 0n;
const allowedRoles: Record<typeof input.kind, string[]> = { PURCHASE_CREDIT: ['ASSET'], CORRECTION: ['ASSET', 'LIABILITY'],
  PAYMENT: ['ASSET', 'LIABILITY'], CARRYFORWARD: ['ASSET'], PENALTY: ['EXPENSE'], NON_CREDITABLE: ['EXPENSE'] };
if (!source || input.sourceVersion !== source.evidenceVersion || source.voucher.status !== 'POSTED'
  || source.voucher.book.legalEntityId !== input.legalEntityId || source.voucher.fiscalYearId !== input.fiscalYearId
  || source.voucher.periodId !== input.periodId || sourceAmount !== input.amountRials
  || source.voucher.documentDate.getTime() !== input.occurredAt.getTime()
  || source.account.level !== 'MOIN' || !allowedRoles[input.kind].includes(source.account.statementRole)
  || source.evidenceType !== `VAT_INPUT_${input.kind}`
  || source.evidenceHash !== hashAccountingEvidence(source.evidencePayload)) {
  throw new AccountingCustomerTreasuryError('VAT_INPUT_SOURCE_INVALID', 'شاهد ورودی ارزش افزوده با ردیف سند قطعی و دوره مالی سازگار نیست.', 409);
}
const evidence = { legalEntityId: input.legalEntityId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
  kind: input.kind, amountRials: input.amountRials, sourceType: input.sourceType, sourceId: input.sourceId,
  sourceVersion: input.sourceVersion, occurredAt: input.occurredAt, payload: input.payload };
const evidenceHash = hashCustomerTreasuryEvidence(evidence);
const persisted = await database.accountingVatInputEvidence.upsert({ where: { sourceType_sourceId_sourceVersion: {
  sourceType: input.sourceType, sourceId: input.sourceId, sourceVersion: input.sourceVersion,
} }, create: { ...input, amountRials: input.amountRials.toString(), payload: json(input.payload),
  evidenceHash }, update: {} });
if (persisted.evidenceHash !== evidenceHash) throw new AccountingCustomerTreasuryError('EVIDENCE_IDENTITY_COLLISION', 'هویت شاهد ارزش افزوده قبلاً با محتوای متفاوت ثبت شده است.', 409);
return persisted; };

export const reconcileVatPeriodPrisma = async (database: PrismaClient, input: { legalEntityId: string; fiscalYearId: string;
  periodId: string; actor: CustomerTreasuryActor;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.legalEntityId}:${input.fiscalYearId}:${input.periodId}:vat`}))`;
  const vouchers = await tx.accountingLedgerVoucher.findMany({ where: { fiscalYearId: input.fiscalYearId,
    periodId: input.periodId, status: 'POSTED', book: { legalEntityId: input.legalEntityId } }, select: { id: true, contentHash: true } });
  const invoices = await tx.accountingTaxInvoice.findMany({ where: { ledgerVoucherId: { in: vouchers.map(({ id }) => id) } }, include: { lines: true } });
  const inputs = await tx.accountingVatInputEvidence.findMany({ where: { legalEntityId: input.legalEntityId,
    fiscalYearId: input.fiscalYearId, periodId: input.periodId } });
  if (inputs.some((item) => item.evidenceHash !== hashCustomerTreasuryEvidence({ legalEntityId: item.legalEntityId,
    fiscalYearId: item.fiscalYearId, periodId: item.periodId, kind: item.kind, amountRials: toBigInt(item.amountRials),
    sourceType: item.sourceType, sourceId: item.sourceId, sourceVersion: item.sourceVersion,
    occurredAt: item.occurredAt, payload: item.payload }))) {
    throw new AccountingCustomerTreasuryError('VAT_INPUT_EVIDENCE_INVALID', 'اثر انگشت یکی از شواهد ورودی ارزش افزوده معتبر نیست.', 409);
  }
  const vatInput = (kind: string) => inputs.filter((item) => item.kind === kind)
    .reduce((total, item) => total + toBigInt(item.amountRials), 0n);
  const eligiblePurchaseTaxRials = vatInput('PURCHASE_CREDIT');
  const correctionRials = vatInput('CORRECTION');
  const paymentRials = vatInput('PAYMENT');
  const carryforwardRials = vatInput('CARRYFORWARD');
  const penaltyRials = vatInput('PENALTY');
  const nonCreditableRials = vatInput('NON_CREDITABLE');
  const signOf = (documentKind: string) => ['RETURN', 'CREDIT_NOTE', 'CANCELLATION'].includes(documentKind) ? -1n : 1n;
  const salesTaxRials = invoices.reduce((total, invoice) => total + signOf(invoice.documentKind) * toBigInt(invoice.taxRials), 0n);
  const exemptRials = invoices.reduce((total, invoice) => total + signOf(invoice.documentKind)
    * invoice.lines.filter((line) => line.exempt).reduce((subtotal, line) => subtotal + toBigInt(line.rawBaseAmount), 0n), 0n);
  const taxpayerInvoiceStates = invoices.map((invoice) => ({ id: invoice.id, status: invoice.status,
    externalUniqueTaxId: invoice.externalUniqueTaxId ?? null })).sort((left, right) => left.id.localeCompare(right.id));
  const taxpayerStateSnapshot = { invoices: taxpayerInvoiceStates, capturedAt: new Date().toISOString() };
  const ledgerControlHash = hashCustomerTreasuryEvidence({ voucherHashes: vouchers.map(({ contentHash }) => contentHash).sort(),
    salesTaxRials, exemptRials, eligiblePurchaseTaxRials, correctionRials, paymentRials, carryforwardRials,
    penaltyRials, nonCreditableRials, inputEvidence: inputs.map((item) => ({ id: item.id, hash: item.evidenceHash })) });
  const sourceHash = hashCustomerTreasuryEvidence({ ledgerControlHash, taxpayerInvoiceStates });
  const prior = await tx.accountingVatReconciliation.findFirst({ where: { legalEntityId: input.legalEntityId,
    fiscalYearId: input.fiscalYearId, periodId: input.periodId }, orderBy: { revision: 'desc' } });
  if (prior?.sourceHash === sourceHash) return prior;
  return tx.accountingVatReconciliation.create({ data: { legalEntityId: input.legalEntityId,
    fiscalYearId: input.fiscalYearId, periodId: input.periodId, revision: (prior?.revision ?? 0) + 1,
    supersedesId: prior?.id, sourceHash, salesTaxRials: salesTaxRials.toString(),
    eligiblePurchaseTaxRials: eligiblePurchaseTaxRials.toString(), correctionRials: correctionRials.toString(),
    paymentRials: paymentRials.toString(), carryforwardRials: carryforwardRials.toString(),
    penaltyRials: penaltyRials.toString(), exemptRials: exemptRials.toString(),
    nonCreditableRials: nonCreditableRials.toString(), taxpayerStateSnapshot: json(taxpayerStateSnapshot),
    ledgerControlHash, status: 'RECONCILED', createdBy: input.actor.id } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const recordTaxSubmissionAttemptPrisma = async (database: PrismaClient, input: { outboxMessageId: string;
  requestHash: string; status: 'SUCCEEDED' | 'FAILED'; safeResponse?: unknown; receiptNumber?: string; errorCode?: string;
  externalUniqueTaxId?: string;
}) => database.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.outboxMessageId}))`;
  const message = await tx.accountingTaxOutboxMessage.findUnique({ where: { id: input.outboxMessageId }, include: { attempts: true } });
  if (!message) throw new AccountingCustomerTreasuryError('TAX_OUTBOX_NOT_FOUND', 'درخواست ارسال صورتحساب مالیاتی پیدا نشد.', 404);
  if (message.attempts.some((attempt) => attempt.requestHash === input.requestHash && attempt.status === 'SUCCEEDED')) return message.attempts.find((attempt) => attempt.requestHash === input.requestHash)!;
  if (!message.channelId) throw new AccountingCustomerTreasuryError('TAX_CHANNEL_REQUIRED', 'درخواست مالیاتی هنوز به کانال مؤثر متصل نشده است.', 409);
  if (input.status === 'SUCCEEDED' && !input.externalUniqueTaxId?.trim()) {
    throw new AccountingCustomerTreasuryError('EXTERNAL_TAX_ID_REQUIRED', 'شناسه یکتای مالیاتی برای ارسال موفق الزامی است.', 400);
  }
  const attemptedAt = new Date();
  const attempt = await tx.accountingTaxSubmissionAttempt.create({ data: { outboxMessageId: message.id,
    attemptNumber: message.attempts.length + 1, requestHash: input.requestHash, status: input.status,
    safeResponse: input.safeResponse == null ? undefined : sanitizeProviderResponse(input.safeResponse), receiptNumber: input.receiptNumber,
    errorCode: input.errorCode, attemptedAt, completedAt: attemptedAt } });
  await tx.accountingTaxOutboxMessage.update({ where: { id: message.id }, data: input.status === 'SUCCEEDED'
    ? { status: 'SENT', claimedAt: null }
    : { status: 'RETRY_PENDING', claimedAt: null, availableAt: new Date(attemptedAt.getTime() + 60_000) } });
  if (input.status === 'SUCCEEDED') await tx.accountingTaxInvoice.update({ where: { id: message.taxInvoiceId }, data: {
    status: 'SUBMITTED', externalUniqueTaxId: input.externalUniqueTaxId!.trim(),
  } });
  return attempt;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export type TaxpayerSubmissionAdapter = (input: { channelKind: 'DIRECT' | 'TRUSTED_COMPANY'; providerName?: string;
  credential: string; requestIdentity: string; protocolVersion: string; payload: unknown;
}) => Promise<{ externalUniqueTaxId: string; receiptNumber?: string; safeResponse?: unknown }>;

export const processNextTaxOutboxMessagePrisma = async (database: PrismaClient, dependencies: {
  resolveSecret: (reference: string, safeKeyVersion: string) => Promise<string>;
  submit: TaxpayerSubmissionAdapter; now?: () => Date;
}) => {
  const now = dependencies.now?.() ?? new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const claimed = await database.$transaction(async (tx) => {
    const candidate = await tx.accountingTaxOutboxMessage.findFirst({ where: {
      channelId: { not: null }, OR: [
        { status: { in: ['PENDING', 'RETRY_PENDING'] }, availableAt: { lte: now } },
        { status: 'PROCESSING', claimedAt: { lt: staleBefore } },
      ],
    }, orderBy: { availableAt: 'asc' } });
    if (!candidate) return null;
    const result = await tx.accountingTaxOutboxMessage.updateMany({ where: { id: candidate.id, OR: [
      { status: { in: ['PENDING', 'RETRY_PENDING'] }, availableAt: { lte: now } },
      { status: 'PROCESSING', claimedAt: { lt: staleBefore } },
    ] }, data: { status: 'PROCESSING', claimedAt: now } });
    return result.count === 1 ? candidate : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!claimed) return null;
  const message = await database.accountingTaxOutboxMessage.findUniqueOrThrow({ where: { id: claimed.id },
    include: { taxInvoice: { include: { lines: true } } } });
  const channel = await database.accountingTaxSubmissionChannel.findUniqueOrThrow({ where: { id: message.channelId! } });
  const voucher = message.taxInvoice.ledgerVoucherId
    ? await database.accountingLedgerVoucher.findUnique({ where: { id: message.taxInvoice.ledgerVoucherId }, include: { book: true } }) : null;
  if (!voucher || voucher.book.legalEntityId !== channel.legalEntityId || channel.healthStatus !== 'ACTIVE') {
    await database.accountingTaxOutboxMessage.update({ where: { id: message.id }, data: { status: 'NEEDS_CHANNEL' } });
    throw new AccountingCustomerTreasuryError('TAX_CHANNEL_NOT_EFFECTIVE', 'کانال مالیاتی به واحد گزارشگر صورتحساب تعلق ندارد یا فعال نیست.', 409);
  }
  const payload = { internalSerial: message.taxInvoice.internalSerial, documentKind: message.taxInvoice.documentKind,
    referenceTaxInvoiceId: message.taxInvoice.referenceTaxInvoiceId, issuedAt: message.taxInvoice.issuedAt,
    netRials: message.taxInvoice.netRials.toString(), taxRials: message.taxInvoice.taxRials.toString(),
    lines: message.taxInvoice.lines.map((line) => ({ sourceLineId: line.sourceLineId, productRowId: line.productRowId,
      quantity: line.quantity.toString(), taxRuleId: line.taxRuleId, taxRuleVersion: line.taxRuleVersion,
      rawBaseAmount: line.rawBaseAmount.toString(), roundedTaxRials: line.roundedTaxRials.toString(), exempt: line.exempt })) };
  const requestHash = hashCustomerTreasuryEvidence({ requestIdentity: message.requestIdentity, payload });
  try {
    const credential = await dependencies.resolveSecret(channel.secretReference, channel.safeKeyVersion);
    const result = await dependencies.submit({ channelKind: channel.kind as 'DIRECT' | 'TRUSTED_COMPANY',
      providerName: channel.providerName ?? undefined, credential, requestIdentity: message.requestIdentity,
      protocolVersion: message.protocolVersion, payload });
    return recordTaxSubmissionAttemptPrisma(database, { outboxMessageId: message.id, requestHash, status: 'SUCCEEDED',
      externalUniqueTaxId: result.externalUniqueTaxId, receiptNumber: result.receiptNumber, safeResponse: result.safeResponse });
  } catch (error) {
    await recordTaxSubmissionAttemptPrisma(database, { outboxMessageId: message.id, requestHash, status: 'FAILED',
      errorCode: error instanceof Error ? error.name : 'TAX_SUBMISSION_FAILED',
      safeResponse: { category: 'ADAPTER_FAILURE' } });
    throw error;
  }
};
