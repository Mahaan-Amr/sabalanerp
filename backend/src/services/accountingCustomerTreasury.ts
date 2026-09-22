import { createHash, randomUUID } from 'node:crypto';
import type { AccountingAccessProfile } from './accountingLedgerFoundation';

export type CustomerTreasuryActor = Readonly<{ id: string; profile: AccountingAccessProfile; isGlobalAdmin?: boolean }>;
type Evidence = Readonly<{ id: string; version: number; type: string; occurredAt: Date; contractId: string;
  contractVersion: number; productRows: ReadonlyArray<{ id: string; quantity: string }>; hash?: string }>;

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'hash').sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
  return value;
};

export const hashCustomerTreasuryEvidence = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value))).digest('hex');

export class AccountingCustomerTreasuryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

export type CustomerAccountingProfile = {
  id: string; legalEntityId: string; partySourceId: string; displayName: string; openingBalanceRials: bigint;
  relationshipIds: Set<string>; cancelledRelationshipIds: Set<string>; createdAt: Date;
};
export type CommercialInvoice = { id: string; profileId: string; contractId: string; contractVersion: number;
  number: string; journalVoucherId: string; taxInvoiceId: string; netRials: bigint; taxRials: bigint; grossRials: bigint;
  issuedAt: Date; dueAt: Date; status: 'POSTED' };
export type TreasuryVoucher = { id: string; sourceType: string; sourceId: string; sourceVersion: number;
  idempotencyKey: string; postedAt: Date; lines: Array<{ accountId: string; debitRials: bigint; creditRials: bigint;
    partyId?: string; financialAccountId?: string }>; debitTotalRials: bigint; creditTotalRials: bigint };
export type AccountingOpenItem = { id: string; profileId: string; contractId: string; invoiceId: string; dueAt: Date;
  originalRials: bigint; kind: 'RECEIVABLE'; postedAt: Date };
export type TaxInvoice = { id: string; invoiceId: string; internalSerial: string; externalUniqueTaxId: string | null;
  referenceTaxInvoiceId: string | null; status: 'QUEUED'; economicPostingIndependent: true;
  netRials: bigint; taxRials: bigint; lines: Array<{ sourceLineId: string; ruleId: string; ruleVersion: number;
    citation: string; rawTaxRials: string; roundedTaxRials: bigint; exempt: boolean }> };
export type AccountingException = { id: string; code: string; messagePersian: string; assignedProfile: 'ACCOUNTANT';
  sourceType: string; sourceId: string; sourceVersion: number; evidenceHash: string; createdAt: Date; status: 'OPEN' };
export type TreasuryReceipt = { id: string; profileId: string; contractId: string; amountRials: bigint; occurredAt: Date;
  financialAccountId: string; source: { type: string; id: string; version: number }; idempotencyKey: string; posted: true };
export type SettlementAllocation = { id: string; receiptId: string; allocations: Array<{ openItemId: string; amountRials: bigint }>;
  createdAt: Date; reversedById: string | null; reversesId: string | null; reason: string | null };

export type CustomerTreasuryState = {
  profiles: Map<string, CustomerAccountingProfile>; profileByParty: Map<string, string>; relationshipProfiles: Map<string, string>;
  invoices: Map<string, CommercialInvoice>; vouchers: Map<string, TreasuryVoucher>; voucherByIdempotency: Map<string, string>;
  openItems: Map<string, AccountingOpenItem>; taxInvoices: Map<string, TaxInvoice>; taxOutbox: Map<string, { id: string; taxInvoiceId: string; payloadHash: string; status: 'PENDING' }>;
  exceptions: Map<string, AccountingException>; receipts: Map<string, TreasuryReceipt>; receiptByIdempotency: Map<string, string>;
  allocations: Map<string, SettlementAllocation>;
};

export interface CustomerTreasuryRepository {
  state: CustomerTreasuryState;
  transaction<T>(operation: (repository: CustomerTreasuryRepository) => Promise<T>): Promise<T>;
}

const emptyState = (): CustomerTreasuryState => ({
  profiles: new Map(), profileByParty: new Map(), relationshipProfiles: new Map(), invoices: new Map(), vouchers: new Map(),
  voucherByIdempotency: new Map(), openItems: new Map(), taxInvoices: new Map(), taxOutbox: new Map(), exceptions: new Map(),
  receipts: new Map(), receiptByIdempotency: new Map(), allocations: new Map(),
});

export const createInMemoryCustomerTreasuryRepository = (): CustomerTreasuryRepository => {
  const repository: CustomerTreasuryRepository = { state: emptyState(), transaction: async (operation) => operation(repository) };
  return repository;
};

const assertWriteAccess = (actor: CustomerTreasuryActor) => {
  if (actor.profile === 'VIEWER') throw new AccountingCustomerTreasuryError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات حسابداری برای این کاربر فعال نیست.', 403);
};
const positive = (amount: bigint, code: string) => {
  if (amount <= 0n) throw new AccountingCustomerTreasuryError(code, 'مبلغ باید بیشتر از صفر باشد.', 400);
};
const sum = (amounts: readonly bigint[]) => amounts.reduce((total, amount) => total + amount, 0n);

type ProvisionCommand = Readonly<{ legalEntityId: string; relationshipId: string; relationshipVersion: number;
  partySourceId: string; displayName: string; approvedAt: Date; actor: CustomerTreasuryActor }>;
export type CustomerSaleRecognitionCommand = Readonly<{
  bookId: string; fiscalYearId: string; periodId: string; contractId: string; contractVersion: number; partySourceId: string;
  partyDisplayName: string; commercialInvoiceNumber: string; transferredAt: Date; dueAt: Date;
  policy: { id: string; version: number; carriage: 'CUSTOMER_APPOINTED' | 'SABALAN_APPOINTED' | 'CONTRACTUAL_EXCEPTION';
    recognitionPoint: 'GUARD_EXIT' | 'DESTINATION_ACCEPTANCE' | 'EXPLICIT_EXCEPTION' };
  evidence: Evidence;
  lines: ReadonlyArray<{ id: string; productRowId: string; description: string; quantity: string; netRials: bigint;
    taxRials: bigint; costRials: bigint; costEvidenceId?: string; taxRule: { id: string; version: number; citation: string; rateBasisPoints: number; exempt: boolean } }>;
  accounts: { receivable: string; revenue: string; outputTax: string; inventory: string; cost: string };
  actor: CustomerTreasuryActor; idempotencyKey: string; correlationId: string;
}>;

export const validateCustomerSaleEvidence = (command: CustomerSaleRecognitionCommand): { code: string; message: string } | null => {
  if (!command.evidence.hash || command.evidence.hash !== hashCustomerTreasuryEvidence(command.evidence)) {
    return { code: 'MUTABLE_EVIDENCE', message: 'اثر انگشت شواهد عملیاتی معتبر نیست یا شواهد پس از ثبت تغییر کرده است.' };
  }
  if (command.evidence.contractId !== command.contractId || command.evidence.contractVersion !== command.contractVersion) {
    return { code: 'UNLINKED_EVIDENCE', message: 'شواهد انتقال کنترل به نسخه جاری قرارداد متصل نیست.' };
  }
  const quantity = (value: string) => { const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    return match ? `${BigInt(match[1])}.${(match[2] ?? '').padEnd(3, '0')}` : null; };
  const sourceRows = new Map(command.evidence.productRows.map((row) => [row.id, quantity(row.quantity)]));
  if (command.lines.some((line) => sourceRows.get(line.productRowId) !== quantity(line.quantity))) {
    return { code: 'CONTRADICTORY_EVIDENCE', message: 'شواهد کمیت انتقال‌یافته با ردیف‌های صورتحساب سازگار نیست.' };
  }
  const required = command.policy.recognitionPoint === 'GUARD_EXIT' ? 'GUARD_EXIT'
    : command.policy.recognitionPoint === 'DESTINATION_ACCEPTANCE' ? 'DESTINATION_ACCEPTANCE' : 'CONTRACTUAL_EXCEPTION';
  if (command.evidence.type !== required) {
    if (required === 'DESTINATION_ACCEPTANCE') return { code: 'DESTINATION_ACCEPTANCE_REQUIRED', message: 'پذیرش قطعی مقصد ثبت نشده است؛ گذشت زمان جایگزین شواهد تحویل نمی‌شود.' };
    return { code: 'CONTROL_TRANSFER_EVIDENCE_REQUIRED', message: 'شواهد معتبر انتقال کنترل برای این سیاست قراردادی کامل نیست.' };
  }
  return null;
};

export const createAccountingCustomerTreasury = (repository: CustomerTreasuryRepository) => ({
  provisionCustomerProfile: async (command: ProvisionCommand) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor);
    const existingRelationship = tx.state.relationshipProfiles.get(command.relationshipId);
    const existingParty = tx.state.profileByParty.get(`${command.legalEntityId}:${command.partySourceId}`);
    const existingId = existingRelationship || existingParty;
    if (existingId) {
      const profile = tx.state.profiles.get(existingId)!;
      profile.relationshipIds.add(command.relationshipId);
      tx.state.relationshipProfiles.set(command.relationshipId, profile.id);
      return { profile, created: false };
    }
    const profile: CustomerAccountingProfile = { id: `customer-profile-${randomUUID()}`, legalEntityId: command.legalEntityId,
      partySourceId: command.partySourceId, displayName: command.displayName.trim(), openingBalanceRials: 0n,
      relationshipIds: new Set([command.relationshipId]), cancelledRelationshipIds: new Set(), createdAt: command.approvedAt };
    tx.state.profiles.set(profile.id, profile);
    tx.state.profileByParty.set(`${command.legalEntityId}:${command.partySourceId}`, profile.id);
    tx.state.relationshipProfiles.set(command.relationshipId, profile.id);
    return { profile, created: true };
  }),

  cancelCustomerRelationship: async (command: { relationshipId: string; cancelledAt: Date; actor: CustomerTreasuryActor }) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor);
    const profileId = tx.state.relationshipProfiles.get(command.relationshipId);
    if (!profileId) return { preserved: true };
    tx.state.profiles.get(profileId)?.cancelledRelationshipIds.add(command.relationshipId);
    return { preserved: true };
  }),

  recognizeCustomerSale: async (command: CustomerSaleRecognitionCommand) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor);
    const priorVoucherId = tx.state.voucherByIdempotency.get(command.idempotencyKey);
    if (priorVoucherId) {
      const voucher = tx.state.vouchers.get(priorVoucherId)!;
      const invoice = [...tx.state.invoices.values()].find((item) => item.journalVoucherId === voucher.id)!;
      const openItem = [...tx.state.openItems.values()].find((item) => item.invoiceId === invoice.id)!;
      const taxInvoice = tx.state.taxInvoices.get(invoice.taxInvoiceId)!;
      return { kind: 'POSTED' as const, voucher, invoice, openItem, taxInvoice };
    }
    const profileId = tx.state.profileByParty.get(`entity-1:${command.partySourceId}`)
      ?? [...tx.state.profiles.values()].find((profile) => profile.partySourceId === command.partySourceId)?.id;
    if (!profileId) throw new AccountingCustomerTreasuryError('CUSTOMER_PROFILE_REQUIRED', 'حساب مالی مشتری برای این رابطه فروش فعال نشده است.', 409);
    const failure = validateCustomerSaleEvidence(command);
    if (failure) {
      const sameException = [...tx.state.exceptions.values()].find((item) => item.sourceId === command.evidence.id && item.sourceVersion === command.evidence.version);
      const exception = sameException ?? { id: `accounting-exception-${randomUUID()}`, code: failure.code,
        messagePersian: failure.message, assignedProfile: 'ACCOUNTANT' as const, sourceType: command.evidence.type,
        sourceId: command.evidence.id, sourceVersion: command.evidence.version,
        evidenceHash: command.evidence.hash ?? hashCustomerTreasuryEvidence(command.evidence), createdAt: new Date(), status: 'OPEN' as const };
      tx.state.exceptions.set(exception.id, exception);
      return { kind: 'EXCEPTION' as const, exception };
    }
    if (command.lines.length === 0) throw new AccountingCustomerTreasuryError('INVOICE_LINES_REQUIRED', 'صورتحساب فروش باید دست‌کم یک ردیف داشته باشد.', 400);
    for (const line of command.lines) {
      if (line.netRials < 0n || line.taxRials < 0n || line.costRials < 0n) throw new AccountingCustomerTreasuryError('NEGATIVE_INVOICE_AMOUNT', 'مبالغ صورتحساب نمی‌تواند منفی باشد.', 400);
      const expectedTax = line.taxRule.exempt ? 0n : (line.netRials * BigInt(line.taxRule.rateBasisPoints) + 5_000n) / 10_000n;
      if (line.taxRials !== expectedTax) throw new AccountingCustomerTreasuryError('TAX_RULE_MISMATCH', 'مالیات ردیف با قاعده مؤثر و شواهد گردکردن سازگار نیست.', 400);
    }
    const netRials = sum(command.lines.map((line) => line.netRials));
    const taxRials = sum(command.lines.map((line) => line.taxRials));
    const costRials = sum(command.lines.map((line) => line.costRials));
    const lines: TreasuryVoucher['lines'] = [
      { accountId: command.accounts.receivable, debitRials: netRials + taxRials, creditRials: 0n, partyId: profileId },
      { accountId: command.accounts.revenue, debitRials: 0n, creditRials: netRials },
      ...(taxRials > 0n ? [{ accountId: command.accounts.outputTax, debitRials: 0n, creditRials: taxRials }] : []),
      ...(costRials > 0n ? [{ accountId: command.accounts.cost, debitRials: costRials, creditRials: 0n },
        { accountId: command.accounts.inventory, debitRials: 0n, creditRials: costRials }] : []),
    ];
    const voucher: TreasuryVoucher = { id: `voucher-${randomUUID()}`, sourceType: 'CONTROL_TRANSFER', sourceId: command.evidence.id,
      sourceVersion: command.evidence.version, idempotencyKey: command.idempotencyKey, postedAt: new Date(), lines,
      debitTotalRials: sum(lines.map((line) => line.debitRials)), creditTotalRials: sum(lines.map((line) => line.creditRials)) };
    if (voucher.debitTotalRials !== voucher.creditTotalRials) throw new AccountingCustomerTreasuryError('UNBALANCED_POSTING', 'ثبت پیشنهادی تراز نیست.', 500);
    const taxInvoice: TaxInvoice = { id: `tax-invoice-${randomUUID()}`, invoiceId: '', internalSerial: `tax-${randomUUID()}`,
      externalUniqueTaxId: null, referenceTaxInvoiceId: null, status: 'QUEUED', economicPostingIndependent: true, netRials, taxRials,
      lines: command.lines.map((line) => ({ sourceLineId: line.id, ruleId: line.taxRule.id, ruleVersion: line.taxRule.version,
        citation: line.taxRule.citation, rawTaxRials: `${line.netRials}*${line.taxRule.rateBasisPoints}/10000`,
        roundedTaxRials: line.taxRials, exempt: line.taxRule.exempt })) };
    const invoice: CommercialInvoice = { id: `customer-invoice-${randomUUID()}`, profileId, contractId: command.contractId,
      contractVersion: command.contractVersion, number: command.commercialInvoiceNumber, journalVoucherId: voucher.id,
      taxInvoiceId: taxInvoice.id, netRials, taxRials, grossRials: netRials + taxRials,
      issuedAt: command.transferredAt, dueAt: command.dueAt, status: 'POSTED' };
    taxInvoice.invoiceId = invoice.id;
    const openItem: AccountingOpenItem = { id: `open-item-${randomUUID()}`, profileId, contractId: command.contractId,
      invoiceId: invoice.id, dueAt: command.dueAt, originalRials: invoice.grossRials, kind: 'RECEIVABLE', postedAt: voucher.postedAt };
    tx.state.vouchers.set(voucher.id, voucher); tx.state.voucherByIdempotency.set(command.idempotencyKey, voucher.id);
    tx.state.invoices.set(invoice.id, invoice); tx.state.openItems.set(openItem.id, openItem); tx.state.taxInvoices.set(taxInvoice.id, taxInvoice);
    const outbox = { id: `tax-outbox-${randomUUID()}`, taxInvoiceId: taxInvoice.id,
      payloadHash: hashCustomerTreasuryEvidence(taxInvoice), status: 'PENDING' as const };
    tx.state.taxOutbox.set(outbox.id, outbox);
    return { kind: 'POSTED' as const, voucher, invoice, openItem, taxInvoice };
  }),

  recordReceipt: async (command: { profileId: string; contractId: string; amountRials: bigint; occurredAt: Date;
    financialAccountId: string; source: { type: string; id: string; version: number }; idempotencyKey: string; actor: CustomerTreasuryActor }) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor); positive(command.amountRials, 'INVALID_RECEIPT_AMOUNT');
    const priorId = tx.state.receiptByIdempotency.get(command.idempotencyKey);
    if (priorId) return tx.state.receipts.get(priorId)!;
    if (!tx.state.profiles.has(command.profileId)) throw new AccountingCustomerTreasuryError('CUSTOMER_PROFILE_NOT_FOUND', 'حساب مالی مشتری پیدا نشد.', 404);
    const receipt: TreasuryReceipt = { id: `treasury-receipt-${randomUUID()}`, profileId: command.profileId,
      contractId: command.contractId, amountRials: command.amountRials, occurredAt: command.occurredAt,
      financialAccountId: command.financialAccountId, source: command.source, idempotencyKey: command.idempotencyKey, posted: true };
    tx.state.receipts.set(receipt.id, receipt); tx.state.receiptByIdempotency.set(command.idempotencyKey, receipt.id);
    return receipt;
  }),

  allocateReceipt: async (command: { receiptId: string; actor: CustomerTreasuryActor;
    allocations: ReadonlyArray<{ openItemId: string; amountRials: bigint }> }) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor);
    const receipt = tx.state.receipts.get(command.receiptId);
    if (!receipt) throw new AccountingCustomerTreasuryError('RECEIPT_NOT_FOUND', 'دریافت خزانه‌داری پیدا نشد.', 404);
    if (command.allocations.length === 0) throw new AccountingCustomerTreasuryError('ALLOCATION_REQUIRED', 'حداقل یک تخصیص لازم است.', 400);
    const alreadyAllocated = [...tx.state.allocations.values()].filter((item) => !item.reversedById && !item.reversesId && item.receiptId === receipt.id)
      .flatMap((item) => item.allocations);
    const newTotal = sum(command.allocations.map((item) => item.amountRials));
    if (sum(alreadyAllocated.map((item) => item.amountRials)) + newTotal > receipt.amountRials) {
      throw new AccountingCustomerTreasuryError('RECEIPT_OVER_ALLOCATED', 'جمع تخصیص‌ها از مبلغ دریافت بیشتر است.', 409);
    }
    for (const requested of command.allocations) {
      positive(requested.amountRials, 'INVALID_ALLOCATION_AMOUNT');
      const item = tx.state.openItems.get(requested.openItemId);
      if (!item) throw new AccountingCustomerTreasuryError('OPEN_ITEM_NOT_FOUND', 'قلم باز انتخاب‌شده پیدا نشد.', 404);
      if (item.profileId !== receipt.profileId) throw new AccountingCustomerTreasuryError('CROSS_CUSTOMER_ALLOCATION', 'تخصیص بین دو مشتری مجاز نیست.', 409);
      const allocated = [...tx.state.allocations.values()].filter((entry) => !entry.reversedById && !entry.reversesId)
        .flatMap((entry) => entry.allocations).filter((entry) => entry.openItemId === item.id)
        .reduce((total, entry) => total + entry.amountRials, 0n);
      if (allocated + requested.amountRials > item.originalRials) throw new AccountingCustomerTreasuryError('OPEN_ITEM_OVER_ALLOCATED', 'مبلغ تخصیص از مانده قلم باز بیشتر است.', 409);
    }
    const allocation: SettlementAllocation = { id: `allocation-${randomUUID()}`, receiptId: receipt.id,
      allocations: command.allocations.map((item) => ({ ...item })), createdAt: new Date(), reversedById: null, reversesId: null, reason: null };
    tx.state.allocations.set(allocation.id, allocation); return allocation;
  }),

  reverseAllocation: async (command: { allocationId: string; reason: string; actor: CustomerTreasuryActor }) => repository.transaction(async (tx) => {
    assertWriteAccess(command.actor);
    if (command.reason.trim().length < 8) throw new AccountingCustomerTreasuryError('REVERSAL_REASON_REQUIRED', 'دلیل برگشت تخصیص الزامی است.', 400);
    const original = tx.state.allocations.get(command.allocationId);
    if (!original || original.reversesId) throw new AccountingCustomerTreasuryError('ALLOCATION_NOT_FOUND', 'تخصیص پیدا نشد.', 404);
    if (original.reversedById) return tx.state.allocations.get(original.reversedById)!;
    const reversal: SettlementAllocation = { id: `allocation-reversal-${randomUUID()}`, receiptId: original.receiptId,
      allocations: original.allocations.map((item) => ({ ...item, amountRials: -item.amountRials })), createdAt: new Date(),
      reversedById: null, reversesId: original.id, reason: command.reason.trim() };
    original.reversedById = reversal.id; tx.state.allocations.set(reversal.id, reversal); return reversal;
  }),

  projectCustomerAccount: async (input: { profileId: string; asOf: Date }) => {
    const items = [...repository.state.openItems.values()].filter((item) => item.profileId === input.profileId && item.postedAt <= input.asOf);
    const receipts = [...repository.state.receipts.values()].filter((item) => item.profileId === input.profileId && item.occurredAt <= input.asOf);
    const activeAllocations = [...repository.state.allocations.values()].filter((item) => !item.reversedById && !item.reversesId && item.createdAt <= input.asOf);
    const allocatedByItem = new Map<string, bigint>();
    const allocatedByReceipt = new Map<string, bigint>();
    for (const allocation of activeAllocations) for (const item of allocation.allocations) {
      allocatedByItem.set(item.openItemId, (allocatedByItem.get(item.openItemId) ?? 0n) + item.amountRials);
      allocatedByReceipt.set(allocation.receiptId, (allocatedByReceipt.get(allocation.receiptId) ?? 0n) + item.amountRials);
    }
    const openItems = items.map((item) => ({ ...item, remainingRials: item.originalRials - (allocatedByItem.get(item.id) ?? 0n),
      agingDays: Math.max(0, Math.floor((input.asOf.getTime() - item.dueAt.getTime()) / 86_400_000)) }))
      .filter((item) => item.remainingRials > 0n);
    return { profileId: input.profileId, receivableRials: sum(openItems.map((item) => item.remainingRials)), openItems,
      unallocatedCreditRials: sum(receipts.map((receipt) => receipt.amountRials - (allocatedByReceipt.get(receipt.id) ?? 0n))),
      activity: { invoices: items.length, receipts: receipts.length, allocations: activeAllocations.length } };
  },
});
