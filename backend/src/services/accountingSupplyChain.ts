import { createHash, randomUUID } from 'node:crypto';

export type SupplyChainActor = Readonly<{
  id: string;
  profile: 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER';
  isGlobalAdmin?: boolean;
}>;

export type ImmutableEvidence = Readonly<{
  type: string;
  id: string;
  version: number;
  hash: string;
  payload: unknown;
}>;

export type InventoryValuationMethod = 'SPECIFIC_IDENTIFICATION' | 'MOVING_WEIGHTED_AVERAGE';
export type PurchaseLineKind = 'INVENTORY' | 'FIXED_ASSET' | 'SERVICE' | 'EXPENSE';

export class SupplyChainAccountingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
  }
}

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
  return value;
};

export const hashSupplyChainEvidence = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

type Decimal = Readonly<{ units: bigint; scale: number; canonical: string }>;
const ZERO_DECIMAL: Decimal = { units: 0n, scale: 0, canonical: '0' };

const decimal = (value: string, label = 'مقدار'): Decimal => {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new SupplyChainAccountingError('INVALID_FIXED_POINT_QUANTITY', `${label} باید عدد مثبت با دقت مشخص باشد.`, 400);
  const whole = match[1].replace(/^0+(?=\d)/, '');
  // Quantity scale is evidence (for example 2.500 tonne), not presentation noise.
  const fraction = match[2] ?? '';
  if (fraction.length > 6 || whole.length > 18) {
    throw new SupplyChainAccountingError('FIXED_POINT_QUANTITY_OUT_OF_RANGE', `${label} از دقت مجاز بیشتر است.`, 400);
  }
  const units = BigInt(`${whole}${fraction}`);
  if (units <= 0n) throw new SupplyChainAccountingError('NON_POSITIVE_QUANTITY', `${label} باید بزرگ‌تر از صفر باشد.`, 400);
  return { units, scale: fraction.length, canonical: fraction ? `${whole}.${fraction}` : whole };
};

const power = (scale: number) => 10n ** BigInt(scale);
const compareDecimal = (left: Decimal, right: Decimal) => (
  left.units * power(right.scale) < right.units * power(left.scale) ? -1
    : left.units * power(right.scale) > right.units * power(left.scale) ? 1 : 0
);
const addDecimal = (left: Decimal, right: Decimal): Decimal => {
  const scale = Math.max(left.scale, right.scale);
  const units = left.units * power(scale - left.scale) + right.units * power(scale - right.scale);
  const raw = units.toString().padStart(scale + 1, '0');
  return decimal(scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw);
};
const subtractDecimal = (left: Decimal, right: Decimal): Decimal | null => {
  const scale = Math.max(left.scale, right.scale);
  const units = left.units * power(scale - left.scale) - right.units * power(scale - right.scale);
  if (units <= 0n) return null;
  const raw = units.toString().padStart(scale + 1, '0');
  return decimal(scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw);
};
const formatDecimal = (units: bigint, scale: number) => {
  if (units === 0n) return '0';
  const raw = units.toString().padStart(scale + 1, '0');
  return scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw;
};
const proportionalRials = (total: bigint, part: Decimal, whole: Decimal) => {
  const numerator = total * part.units * power(whole.scale);
  const denominator = whole.units * power(part.scale);
  return (numerator + denominator / 2n) / denominator;
};
const proportionalRialsFloor = (total: bigint, part: Decimal, whole: Decimal) => (
  (total * part.units * power(whole.scale)) / (whole.units * power(part.scale))
);

const requireWrite = (actor: SupplyChainActor) => {
  if (actor.profile === 'VIEWER') {
    throw new SupplyChainAccountingError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات حسابداری برای این کاربر فعال نیست.', 403);
  }
};
const requireEvidence = (item: ImmutableEvidence) => {
  if (!item || !item.type?.trim() || !item.id?.trim() || !Number.isInteger(item.version) || item.version < 1
      || item.payload == null || hashSupplyChainEvidence(item.payload) !== item.hash) {
    throw new SupplyChainAccountingError('EVIDENCE_INTEGRITY_FAILED', 'شواهد منبع کامل نیست یا اثر انگشت آن تطبیق ندارد.', 400);
  }
};

export type PartyRecord = { id: string; roles: Array<'CUSTOMER' | 'SUPPLIER'>; roleEvidence?: ImmutableEvidence[]; updatedByActorId?: string };
export type ExceptionRecord = {
  id: string; code: string; message: string; sourceId: string; correlationId: string;
  evidence: ImmutableEvidence; createdAt: Date; resolvedAt: Date | null;
};
export type SupplierInvoiceRecord = {
  id: string; supplierPartyId: string; supplierInvoiceNumber: string; documentDate: Date; dueDate: Date;
  bookId: string; grossRials: bigint; discountRials: bigint; attributableFreightRials: bigint;
  recoverableTaxRials: bigint; nonRecoverableTaxRials: bigint; deductionRials: bigint;
  retentionRials: bigint; roundingRials: bigint; netPayableRials: bigint; inventoryValueRials: bigint;
  voucherId: string; source: ImmutableEvidence; actorId: string; lines: ReadonlyArray<PurchaseLine>; correctionOfInvoiceId?: string;
};
export type OpenItemRecord = { id: string; partyId: string; sourceType: 'SUPPLIER_INVOICE'; sourceId: string; amountRials: bigint; dueDate: Date };
export type PaymentRecord = { id: string; partyId: string; amountRials: bigint; voucherId: string; evidence: ImmutableEvidence; financialAccountId?: string; kind?: 'SUPPLIER_PAYMENT' | 'PURCHASE_ADVANCE' | 'SUPPLIER_CREDIT' | 'PAYABLE_CHECK_ISSUANCE' | 'PAYABLE_CHECK_REVERSAL' | 'ASSIGNED_CUSTOMER_CHECK' | 'ASSIGNED_CUSTOMER_CHECK_REVERSAL'; occurredAt: Date; actorId: string };
export type AllocationRecord = { id: string; paymentId: string; openItemId: string; amountRials: bigint; reversedById: string | null; actorId: string; reason?: string };
export type InventoryLayerRecord = {
  id: string; identityId: string; warehouseId: string; locationId: string; originId?: string;
  unit: string; quantity: string; valueRials: bigint; valuationMethod: InventoryValuationMethod;
  sourceType: string; sourceId: string; createdAt: Date;
};
export type InventoryConsumptionRecord = {
  id: string; identityId: string; layerId: string; unit: string; quantity: string; valueRials: bigint;
  purpose: string; sourceId: string; createdAt: Date;
};
export type InventoryReservationRecord = {
  id: string; identityId: string; unit: string; quantity: string; purposeId: string;
  idempotencyKey: string; evidence: ImmutableEvidence; status: 'ACTIVE' | 'RELEASED'; createdAt: Date;
  releaseEvidence?: ImmutableEvidence; releasedAt?: Date; releasedByActorId?: string;
};
export type InventoryEventRecord = {
  id: string; identityId: string; eventType: 'RECEIPT' | 'MOVEMENT' | 'TRANSFORMATION_INPUT' | 'TRANSFORMATION_OUTPUT' | 'SALE_RELIEF' | 'RETURN' | 'CORRECTION' | 'OPENING';
  warehouseId: string; locationId: string; unit: string; quantity: string; voucherId?: string;
  evidence: ImmutableEvidence; occurredAt: Date; predecessorEventId?: string;
  sourceWarehouseId?: string; sourceLocationId?: string;
  statusAfter: 'AVAILABLE' | 'RESERVED' | 'CONSUMED' | 'RETURNED' | 'QUARANTINED';
  predecessorIdentityIds?: string[];
};
export type CheckStatus = 'RECEIVED' | 'ISSUED' | 'ENDORSED' | 'DELIVERED' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'RETURNED' | 'REPLACED' | 'CANCELLED';
export type CheckRecord = {
  id: string; sayadId: string; amountRials: bigint; supplierPartyId: string; financialAccountId: string;
  treasuryTransactionId: string; dueDate: Date; status: CheckStatus; replacementCheckId?: string;
  kind: 'PAYABLE' | 'ASSIGNED_CUSTOMER'; sourceCustomerPaymentId?: string;
};
export type CheckEventRecord = {
  id: string; checkId: string; status: CheckStatus; reason: string; evidence: ImmutableEvidence; actorId: string; occurredAt: Date;
};
export type StoredOutcome = Readonly<{
  kind: 'POSTED' | 'EXCEPTION'; invoiceId?: string; openItemId?: string; voucherId?: string;
  statutoryNumber?: number; exceptionId?: string; exceptionCode?: string;
  amountRials?: bigint; secondaryAmountRials?: bigint;
}>;
export type SupplyChainCommandAuditRecord = Readonly<{
  id: string; commandName: string; result: 'SUCCEEDED' | 'DENIED'; actorId: string; effectiveProfile: string;
  commandHash: string; reason?: string; createdAt: Date; sequence?: bigint; previousHash?: string; entryHash?: string;
}>;
export type OpeningRunRecord = {
  id: string; sourcePackageHash: string; mappingVersion: number; sepidarControlRials: bigint;
  toolVersion: string; scope: unknown; inputCount: number; acceptedCount: number; quarantinedCount: number; rejectedCount: number; outputHash: string;
  items: OpeningInventoryItem[]; reconciled: boolean; committedVoucherId?: string; commitIdempotencyKey?: string; actorId: string; successorRunId?: string;
};
export type ProductionBatchRecord = {
  id: string; voucherId: string; evidenceHash: string; inputValueRials: bigint; allocatedCostRials: bigint;
  outputValueRials: bigint; abnormalWasteExpenseRials: bigint; completedAt: Date;
  costPools: ReadonlyArray<{ kind: 'DIRECT_LABOR' | 'MACHINE' | 'ENERGY' | 'OVERHEAD'; amountRials: bigint; basis: string; basisQuantity: string; policyVersion: number }>;
  outputs: ReadonlyArray<{ identityId: string; unit: string; quantity: string; valueRials: bigint }>;
};

type RepositoryState = {
  parties: PartyRecord[];
  exceptions: ExceptionRecord[];
  invoices: SupplierInvoiceRecord[];
  openItems: OpenItemRecord[];
  payments: PaymentRecord[];
  allocations: AllocationRecord[];
  layers: InventoryLayerRecord[];
  consumptions: InventoryConsumptionRecord[];
  outcomes: Array<{ key: string; commandHash: string; value: StoredOutcome }>;
  openingRuns: OpeningRunRecord[];
  reservations: InventoryReservationRecord[];
  checks: CheckRecord[];
  checkEvents: CheckEventRecord[];
  productionBatches: ProductionBatchRecord[];
  inventoryEvents: InventoryEventRecord[];
  commandAudits: SupplyChainCommandAuditRecord[];
};

const emptyState = (): RepositoryState => ({
  parties: [], exceptions: [], invoices: [], openItems: [], payments: [], allocations: [],
  layers: [], consumptions: [], outcomes: [], openingRuns: [], reservations: [], checks: [], checkEvents: [], productionBatches: [], inventoryEvents: [], commandAudits: [],
});

export interface AccountingSupplyChainRepository {
  transaction<T>(operation: (repository: AccountingSupplyChainRepository) => Promise<T>): Promise<T>;
  seedParty(party: PartyRecord): Promise<void>;
  getParty(id: string): Promise<PartyRecord | null>;
  saveParty(party: PartyRecord): Promise<void>;
  listExceptions(): Promise<ReadonlyArray<ExceptionRecord>>;
  saveException(item: ExceptionRecord): Promise<void>;
  findInvoiceByNumber(partyId: string, number: string): Promise<SupplierInvoiceRecord | null>;
  getInvoice(id: string): Promise<SupplierInvoiceRecord | null>;
  saveInvoice(item: SupplierInvoiceRecord): Promise<void>;
  listOpenItems(partyId: string): Promise<ReadonlyArray<OpenItemRecord>>;
  saveOpenItem(item: OpenItemRecord): Promise<void>;
  getOpenItem(id: string): Promise<OpenItemRecord | null>;
  listPayments(partyId: string): Promise<ReadonlyArray<PaymentRecord>>;
  savePayment(item: PaymentRecord): Promise<void>;
  listAllocations(): Promise<ReadonlyArray<AllocationRecord>>;
  getAllocation(id: string): Promise<AllocationRecord | null>;
  saveAllocation(item: AllocationRecord): Promise<void>;
  listLayers(identityId: string): Promise<ReadonlyArray<InventoryLayerRecord>>;
  saveLayer(item: InventoryLayerRecord): Promise<void>;
  listConsumptions(identityId: string): Promise<ReadonlyArray<InventoryConsumptionRecord>>;
  saveConsumption(item: InventoryConsumptionRecord): Promise<void>;
  getOutcome(key: string): Promise<{ commandHash: string; value: StoredOutcome } | null>;
  saveOutcome(key: string, commandHash: string, value: StoredOutcome): Promise<void>;
  saveOpeningRun(item: OpeningRunRecord): Promise<void>;
  getOpeningRun(id: string): Promise<OpeningRunRecord | null>;
  findOpeningRun(sourcePackageHash: string, mappingVersion: number): Promise<OpeningRunRecord | null>;
  findReservationByIdempotencyKey(key: string): Promise<InventoryReservationRecord | null>;
  getReservation(id: string): Promise<InventoryReservationRecord | null>;
  listReservations(identityId: string): Promise<ReadonlyArray<InventoryReservationRecord>>;
  saveReservation(item: InventoryReservationRecord): Promise<void>;
  findCheckBySayadId(sayadId: string): Promise<CheckRecord | null>;
  getCheck(id: string): Promise<CheckRecord | null>;
  saveCheck(item: CheckRecord): Promise<void>;
  listCheckEvents(checkId: string): Promise<ReadonlyArray<CheckEventRecord>>;
  saveCheckEvent(item: CheckEventRecord): Promise<void>;
  getProductionBatch(id: string): Promise<ProductionBatchRecord | null>;
  saveProductionBatch(item: ProductionBatchRecord): Promise<void>;
  listInventoryEvents(identityId: string): Promise<ReadonlyArray<InventoryEventRecord>>;
  saveInventoryEvent(item: InventoryEventRecord): Promise<void>;
  saveCommandAudit(item: SupplyChainCommandAuditRecord): Promise<void>;
  listCommandAudits(): Promise<ReadonlyArray<SupplyChainCommandAuditRecord>>;
}

export const createInMemorySupplyChainRepository = (): AccountingSupplyChainRepository => {
  let state = emptyState();
  const repository: AccountingSupplyChainRepository = {
    transaction: async (operation) => {
      const snapshot = structuredClone(state);
      try { return await operation(repository); } catch (error) { state = snapshot; throw error; }
    },
    seedParty: async (party) => { state.parties = [...state.parties.filter((item) => item.id !== party.id), structuredClone(party)]; },
    getParty: async (id) => structuredClone(state.parties.find((item) => item.id === id) ?? null),
    saveParty: async (party) => { state.parties = [...state.parties.filter((item) => item.id !== party.id), structuredClone(party)]; },
    listExceptions: async () => structuredClone(state.exceptions),
    saveException: async (item) => { state.exceptions.push(structuredClone(item)); },
    findInvoiceByNumber: async (partyId, number) => structuredClone(state.invoices.find((item) => item.supplierPartyId === partyId && item.supplierInvoiceNumber === number) ?? null),
    getInvoice: async (id) => structuredClone(state.invoices.find((item) => item.id === id) ?? null),
    saveInvoice: async (item) => { state.invoices.push(structuredClone(item)); },
    listOpenItems: async (partyId) => structuredClone(state.openItems.filter((item) => item.partyId === partyId)),
    saveOpenItem: async (item) => { state.openItems.push(structuredClone(item)); },
    getOpenItem: async (id) => structuredClone(state.openItems.find((item) => item.id === id) ?? null),
    listPayments: async (partyId) => structuredClone(state.payments.filter((item) => item.partyId === partyId)),
    savePayment: async (item) => { state.payments.push(structuredClone(item)); },
    listAllocations: async () => structuredClone(state.allocations),
    getAllocation: async (id) => structuredClone(state.allocations.find((item) => item.id === id) ?? null),
    saveAllocation: async (item) => { state.allocations = [...state.allocations.filter((entry) => entry.id !== item.id), structuredClone(item)]; },
    listLayers: async (identityId) => structuredClone(state.layers.filter((item) => item.identityId === identityId)),
    saveLayer: async (item) => { state.layers.push(structuredClone(item)); },
    listConsumptions: async (identityId) => structuredClone(state.consumptions.filter((item) => item.identityId === identityId)),
    saveConsumption: async (item) => { state.consumptions.push(structuredClone(item)); },
    getOutcome: async (key) => structuredClone(state.outcomes.find((item) => item.key === key) ?? null),
    saveOutcome: async (key, commandHash, value) => { state.outcomes.push({ key, commandHash, value: structuredClone(value) }); },
    saveOpeningRun: async (item) => { state.openingRuns = [...state.openingRuns.filter((entry) => entry.id !== item.id), structuredClone(item)]; },
    getOpeningRun: async (id) => structuredClone(state.openingRuns.find((item) => item.id === id) ?? null),
    findOpeningRun: async (sourcePackageHash, mappingVersion) => structuredClone(state.openingRuns.find((item) => item.sourcePackageHash === sourcePackageHash && item.mappingVersion === mappingVersion) ?? null),
    findReservationByIdempotencyKey: async (key) => structuredClone(state.reservations.find((item) => item.idempotencyKey === key) ?? null),
    getReservation: async (id) => structuredClone(state.reservations.find((item) => item.id === id) ?? null),
    listReservations: async (identityId) => structuredClone(state.reservations.filter((item) => item.identityId === identityId)),
    saveReservation: async (item) => { state.reservations = [...state.reservations.filter((entry) => entry.id !== item.id), structuredClone(item)]; },
    findCheckBySayadId: async (sayadId) => structuredClone(state.checks.find((item) => item.sayadId === sayadId) ?? null),
    getCheck: async (id) => structuredClone(state.checks.find((item) => item.id === id) ?? null),
    saveCheck: async (item) => { state.checks = [...state.checks.filter((entry) => entry.id !== item.id), structuredClone(item)]; },
    listCheckEvents: async (checkId) => structuredClone(state.checkEvents.filter((item) => item.checkId === checkId).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())),
    saveCheckEvent: async (item) => { state.checkEvents.push(structuredClone(item)); },
    getProductionBatch: async (id) => structuredClone(state.productionBatches.find((item) => item.id === id) ?? null),
    saveProductionBatch: async (item) => { state.productionBatches.push(structuredClone(item)); },
    listInventoryEvents: async (identityId) => structuredClone(state.inventoryEvents.filter((item) => item.identityId === identityId).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())),
    saveInventoryEvent: async (item) => { state.inventoryEvents.push(structuredClone(item)); },
    saveCommandAudit: async (item) => {
      const previous = state.commandAudits.at(-1);
      const sequence = (previous?.sequence ?? 0n) + 1n;
      const previousHash = previous?.entryHash;
      const entryHash = hashSupplyChainEvidence({ sequence, commandName: item.commandName, result: item.result,
        actorId: item.actorId, effectiveProfile: item.effectiveProfile, commandHash: item.commandHash,
        reason: item.reason ?? null, createdAt: item.createdAt, previousHash: previousHash ?? null });
      state.commandAudits.push(structuredClone({ ...item, sequence, previousHash, entryHash }));
    },
    listCommandAudits: async () => structuredClone(state.commandAudits),
  };
  return repository;
};

export type PurchaseLine = Readonly<{
  id: string;
  kind: PurchaseLineKind;
  description: string;
  quantity: string;
  unit: string;
  unitPriceRials: bigint;
  grossRials: bigint;
  discountRials: bigint;
  attributableFreightRials: bigint;
  recoverableTaxRials: bigint;
  nonRecoverableTaxRials: bigint;
  deductionRials: bigint;
  retentionRials: bigint;
  roundingRials: bigint;
  orderEvidence?: ImmutableEvidence;
  receiptEvidence?: ImmutableEvidence;
  acceptedServiceEvidence?: ImmutableEvidence;
  nonOrderException?: { reason: string; authorized: boolean };
  inventory?: { identityId: string; warehouseId: string; locationId: string; originId?: string; valuationMethod: InventoryValuationMethod };
}>;

type SupplierInvoiceCommand = Readonly<{
  bookId: string; fiscalYearId: string; periodId: string; idempotencyKey: string; correlationId: string;
  supplierPartyId: string; supplierInvoiceNumber: string; documentDate: Date; dueDate: Date;
  actor: SupplyChainActor; evidence: ImmutableEvidence; lines: ReadonlyArray<PurchaseLine>;
}>;

export type SupplyChainLedgerContext = Readonly<{
  bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
}>;

export type PostingCommand = Readonly<{
  idempotencyKey: string; correlationId?: string; source: ImmutableEvidence; description: string;
  bookId: string; fiscalYearId: string; periodId: string; documentDate: Date; actor: SupplyChainActor;
  lines: ReadonlyArray<{ accountRole: string; debitRials: bigint; creditRials: bigint; partyId?: string; financialAccountId?: string; inventoryIdentityId?: string }>;
}>;

export type OpeningInventoryItem = Readonly<{
  sourceId: string; identityId: string; warehouseId: string; locationId: string; unit: string; quantity: string;
  valueRials: bigint; valuationMethod: InventoryValuationMethod; uncertainty?: string;
  disposition?: 'ACCEPTED' | 'QUARANTINED' | 'REJECTED'; rejectionReason?: string; rawPayload?: unknown;
}>;

const commandRetry = async <T extends StoredOutcome>(repository: AccountingSupplyChainRepository, key: string, value: unknown) => {
  const commandHash = hashSupplyChainEvidence(value);
  const prior = await repository.getOutcome(key);
  if (prior && prior.commandHash !== commandHash) {
    throw new SupplyChainAccountingError('IDEMPOTENCY_CONFLICT', 'شناسه یکتای درخواست قبلاً با محتوای دیگری استفاده شده است.');
  }
  return { commandHash, prior: prior?.value as T | undefined };
};

const mismatch = (line: PurchaseLine, supplierPartyId: string): { code: string; message: string } | null => {
  if (line.nonOrderException) {
    if (!line.nonOrderException.authorized || line.nonOrderException.reason.trim().length < 8) {
      throw new SupplyChainAccountingError('NON_ORDER_AUTHORIZATION_REQUIRED', 'خرید بدون سفارش به دلیل مشخص و مجوز حسابداری نیاز دارد.', 403);
    }
    return null;
  }
  if (line.kind === 'SERVICE' || line.kind === 'EXPENSE') {
    if (!line.acceptedServiceEvidence) return { code: 'ACCEPTED_SERVICE_EVIDENCE_REQUIRED', message: 'تأیید انجام خدمت برای ثبت این فاکتور کافی نیست.' };
    requireEvidence(line.acceptedServiceEvidence);
    return null;
  }
  if (!line.orderEvidence || !line.receiptEvidence) {
    return { code: 'THREE_WAY_MATCH_EVIDENCE_REQUIRED', message: 'سفارش و رسید فیزیکی برای تطبیق خرید کامل نیست.' };
  }
  requireEvidence(line.orderEvidence);
  requireEvidence(line.receiptEvidence);
  const order = line.orderEvidence.payload as Record<string, unknown>;
  const receipt = line.receiptEvidence.payload as Record<string, unknown>;
  if (order.supplierPartyId !== supplierPartyId || receipt.supplierPartyId !== supplierPartyId) {
    return { code: 'PURCHASE_SUPPLIER_MISMATCH', message: 'طرف حساب فاکتور با سفارش یا رسید مغایرت دارد.' };
  }
  if (order.unit !== line.unit || receipt.unit !== line.unit) {
    return { code: 'PURCHASE_UNIT_MISMATCH', message: 'واحد فاکتور با سفارش یا رسید مغایرت دارد.' };
  }
  const quantity = decimal(line.quantity, 'مقدار فاکتور');
  if (compareDecimal(quantity, decimal(String(order.quantity), 'مقدار سفارش')) !== 0
      || compareDecimal(quantity, decimal(String(receipt.quantity), 'مقدار رسید')) !== 0) {
    return { code: 'PURCHASE_QUANTITY_MISMATCH', message: 'مقدار فاکتور با سفارش یا رسید مغایرت دارد.' };
  }
  if (BigInt(String(order.unitPriceRials)) !== line.unitPriceRials) {
    return { code: 'PURCHASE_PRICE_MISMATCH', message: 'نرخ فاکتور با سفارش مغایرت دارد.' };
  }
  return null;
};

const purchasePostingLines = (lines: ReadonlyArray<PurchaseLine>, direction: 'RECOGNIZE' | 'REVERSE') => {
  const totals = new Map<string, bigint>();
  const add = (role: string, amount: bigint) => totals.set(role, (totals.get(role) ?? 0n) + amount);
  for (const line of lines) {
    const acquisitionBasis = line.grossRials - line.discountRials + line.attributableFreightRials + line.nonRecoverableTaxRials;
    if (acquisitionBasis < 0n) throw new SupplyChainAccountingError('INVALID_PURCHASE_LINE_AMOUNT', 'مبلغ پایه ردیف خرید نمی‌تواند منفی باشد.', 400);
    add(line.kind === 'INVENTORY' ? 'INVENTORY' : line.kind === 'FIXED_ASSET' ? 'FIXED_ASSET' : 'PURCHASE_EXPENSE', acquisitionBasis);
    add('RECOVERABLE_PURCHASE_TAX', line.recoverableTaxRials);
    add('PURCHASE_ROUNDING', line.roundingRials);
    add('PURCHASE_DEDUCTION_PAYABLE', -line.deductionRials);
    add('PURCHASE_RETENTION_PAYABLE', -line.retentionRials);
  }
  return [...totals.entries()].filter(([, amount]) => amount !== 0n).map(([accountRole, signedAmount]) => {
    const amount = direction === 'RECOGNIZE' ? signedAmount : -signedAmount;
    return { accountRole, debitRials: amount > 0n ? amount : 0n, creditRials: amount < 0n ? -amount : 0n };
  });
};

export const createAccountingSupplyChainApplication = (
  repository: AccountingSupplyChainRepository,
  dependencies: {
    now: () => Date;
    post: (command: PostingCommand) => Promise<{ voucherId: string; statutoryNumber: number }>;
    resolveEvidence: (evidence: ImmutableEvidence, allowedTypes: readonly string[]) => Promise<ImmutableEvidence>;
  },
) => {
  const evidenceTypesFor = (commandName: string, path: string): readonly string[] => {
    if (/(?:^|\.)orderEvidence$/.test(path)) return ['PURCHASE_ORDER_APPROVAL'];
    if (/(?:^|\.)receiptEvidence$/.test(path)) {
      return commandName === 'assignCustomerCheck' ? ['CUSTOMER_PAYMENT_STATUS'] : ['GUARD_INBOUND_MOVEMENT'];
    }
    if (/(?:^|\.)acceptedServiceEvidence$/.test(path)) return ['SERVICE_ACCEPTANCE'];
    if (/\.inventoryReturns\.\d+\.evidence$/.test(`.${path}`)) return ['GUARD_OUTBOUND_MOVEMENT'];
    if (path === 'endorsementEvidence') return ['TREASURY_CUSTOMER_CHECK_ENDORSEMENT'];
    if (path !== 'evidence') return [];
    return ({
      approveSupplierRelationship: ['SUPPLIER_RELATIONSHIP_APPROVAL'],
      recognizeSupplierInvoice: ['SUPPLIER_INVOICE'],
      recordSupplierCorrection: ['SUPPLIER_CORRECTION'],
      recordSupplierPayment: ['TREASURY_SUPPLIER_PAYMENT'],
      reverseAllocation: ['ACCOUNTING_ALLOCATION_REVERSAL'],
      recordPhysicalMovement: ['INVENTORY_CUSTODY_MOVEMENT'],
      reserveInventory: ['INVENTORY_RESERVATION_APPROVAL'],
      releaseInventoryReservation: ['INVENTORY_RESERVATION_RELEASE'],
      consumeInventory: ['INVENTORY_CONSUMPTION'],
      completeProduction: ['PRODUCTION_COMPLETION'],
      issuePayableCheck: ['TREASURY_PAYABLE_CHECK'],
      transitionCheck: ['TREASURY_CHECK_STATUS'],
    } as Record<string, readonly string[]>)[commandName] ?? [];
  };
  const resolveEvidenceTree = async (value: unknown, commandName: string, path = ''): Promise<unknown> => {
    if (value instanceof Date || value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Promise.all(value.map((item, index) => resolveEvidenceTree(item, commandName, `${path}.${index}`)));
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.type === 'string' && typeof candidate.id === 'string' && typeof candidate.version === 'number'
        && typeof candidate.hash === 'string' && 'payload' in candidate) {
      const allowedTypes = evidenceTypesFor(commandName, path.replace(/^\./, ''));
      if (!allowedTypes.length) {
        throw new SupplyChainAccountingError('EVIDENCE_NOT_APPLICABLE', 'نوع شاهد عملیاتی با این فرمان حسابداری سازگار نیست.', 400);
      }
      const resolved = await dependencies.resolveEvidence(candidate as ImmutableEvidence, allowedTypes);
      requireEvidence(resolved);
      if (!allowedTypes.includes(resolved.type)) {
        throw new SupplyChainAccountingError('EVIDENCE_NOT_APPLICABLE', 'شاهد بازیابی‌شده به این فرمان حسابداری تعلق ندارد.', 400);
      }
      return resolved;
    }
    return Object.fromEntries(await Promise.all(Object.entries(candidate).map(async ([key, item]) => [key, await resolveEvidenceTree(item, commandName, path ? `${path}.${key}` : key)])));
  };
  const inventoryProjection = async (identityId: string, sourceRepository: AccountingSupplyChainRepository = repository) => {
    const layers = await sourceRepository.listLayers(identityId);
    const consumptions = await sourceRepository.listConsumptions(identityId);
    if (layers.length === 0) return { identityId, quantity: '0', unit: null, valueRials: 0n, layers: [] as InventoryLayerRecord[] };
    const units = new Set(layers.map((item) => item.unit));
    if (units.size !== 1) throw new SupplyChainAccountingError('INCOMPATIBLE_INVENTORY_UNIT', 'واحدهای ناسازگار قابل تجمیع نیستند.');
    const scale = Math.max(...layers.map((item) => decimal(item.quantity).scale), ...consumptions.map((item) => decimal(item.quantity).scale), 0);
    const inbound = layers.reduce((sum, item) => sum + decimal(item.quantity).units * power(scale - decimal(item.quantity).scale), 0n);
    const outbound = consumptions.reduce((sum, item) => sum + decimal(item.quantity).units * power(scale - decimal(item.quantity).scale), 0n);
    return {
      identityId,
      quantity: formatDecimal(inbound - outbound, scale),
      unit: layers[0].unit,
      valueRials: layers.reduce((sum, item) => sum + item.valueRials, 0n) - consumptions.reduce((sum, item) => sum + item.valueRials, 0n),
      layers,
    };
  };

  const inventoryLocationQuantity = async (identityId: string, warehouseId: string, locationId: string,
    sourceRepository: AccountingSupplyChainRepository = repository) => (
    (await sourceRepository.listInventoryEvents(identityId)).reduce((quantity, item) => {
      const amount = decimal(item.quantity);
      const arrives = item.warehouseId === warehouseId && item.locationId === locationId
        && ['RECEIPT', 'OPENING', 'TRANSFORMATION_OUTPUT', 'MOVEMENT'].includes(item.eventType);
      const leaves = item.eventType === 'MOVEMENT'
        ? item.sourceWarehouseId === warehouseId && item.sourceLocationId === locationId
        : ['SALE_RELIEF', 'TRANSFORMATION_INPUT', 'RETURN'].includes(item.eventType)
          && item.warehouseId === warehouseId && item.locationId === locationId;
      return leaves ? (subtractDecimal(quantity, amount) ?? ZERO_DECIMAL) : arrives ? addDecimal(quantity, amount) : quantity;
    }, ZERO_DECIMAL)
  );

  const consume = async (input: {
    identityId: string; quantity: string; unit: string; purpose: string; sourceId: string; createdAt: Date; reservationId?: string;
    reservationPurposeId?: string; sourceWarehouseId: string; sourceLocationId: string;
  }, sourceRepository: AccountingSupplyChainRepository = repository) => {
    const requested = decimal(input.quantity);
    const projection = await inventoryProjection(input.identityId, sourceRepository);
    if (!projection.unit || projection.unit !== input.unit) {
      throw new SupplyChainAccountingError('INCOMPATIBLE_INVENTORY_UNIT', 'واحد خروج با واحد هویت موجودی سازگار نیست.', 400);
    }
    const onHand = projection.quantity === '0' ? ZERO_DECIMAL : decimal(projection.quantity);
    const activeReservations = (await sourceRepository.listReservations(input.identityId)).filter((item) => item.status === 'ACTIVE');
    const selectedReservation = input.reservationId ? activeReservations.find((item) => item.id === input.reservationId) : undefined;
    if (input.reservationId && (!selectedReservation || !input.reservationPurposeId
        || selectedReservation.purposeId !== input.reservationPurposeId || selectedReservation.unit !== input.unit
        || compareDecimal(decimal(selectedReservation.quantity), requested) !== 0)) {
      throw new SupplyChainAccountingError('INVALID_CONSUMPTION_RESERVATION', 'رزرو مصرف باید فعال، هم‌واحد و دقیقاً برابر مقدار خروج باشد.', 400);
    }
    const protectedReservations = activeReservations.filter((item) => item.id !== selectedReservation?.id);
    const protectedQuantity = protectedReservations.reduce((sum, item) => addDecimal(sum, decimal(item.quantity)), ZERO_DECIMAL);
    const available = subtractDecimal(onHand, protectedQuantity) ?? ZERO_DECIMAL;
    if (compareDecimal(requested, available) > 0) {
      throw new SupplyChainAccountingError('INSUFFICIENT_INVENTORY', 'موجودی قابل ردیابی برای این خروج کافی نیست.');
    }
    if (compareDecimal(requested, await inventoryLocationQuantity(input.identityId, input.sourceWarehouseId, input.sourceLocationId, sourceRepository)) > 0) {
      throw new SupplyChainAccountingError('INSUFFICIENT_LOCATION_INVENTORY', 'موجودی مکان مبدأ برای این خروج کافی نیست.');
    }
    const methods = new Set(projection.layers.map((layer) => layer.valuationMethod));
    if (methods.size !== 1) throw new SupplyChainAccountingError('MIXED_VALUATION_METHODS', 'روش ارزش‌گذاری هویت موجودی یکدست نیست.');
    if (methods.has('MOVING_WEIGHTED_AVERAGE')) {
      const valueRials = proportionalRials(projection.valueRials, requested, onHand);
      return {
        valueRials,
        records: [{
          id: randomUUID(), identityId: input.identityId, layerId: projection.layers[0].id,
          unit: input.unit, quantity: requested.canonical, valueRials, purpose: input.purpose,
          sourceId: input.sourceId, createdAt: input.createdAt,
        }], consumedReservation: selectedReservation, fullyConsumed: compareDecimal(requested, onHand) === 0,
      };
    }
    let remaining = requested;
    let valueRials = 0n;
    const records: InventoryConsumptionRecord[] = [];
    for (const layer of projection.layers) {
      const layerConsumptions = (await sourceRepository.listConsumptions(input.identityId)).filter((item) => item.layerId === layer.id);
      const used = layerConsumptions.reduce<Decimal | null>((sum, item) => sum ? addDecimal(sum, decimal(item.quantity)) : decimal(item.quantity), null);
      const layerQuantity = decimal(layer.quantity);
      const layerAvailable = used ? subtractDecimal(layerQuantity, used) : layerQuantity;
      if (!layerAvailable) continue;
      const take = compareDecimal(remaining, layerAvailable) <= 0 ? remaining : layerAvailable;
      const layerUsedValue = layerConsumptions.reduce((sum, item) => sum + item.valueRials, 0n);
      const availableValue = layer.valueRials - layerUsedValue;
      const takeValue = compareDecimal(take, layerAvailable) === 0 ? availableValue : proportionalRials(availableValue, take, layerAvailable);
      records.push({
        id: randomUUID(), identityId: input.identityId, layerId: layer.id, unit: input.unit,
        quantity: take.canonical, valueRials: takeValue, purpose: input.purpose,
        sourceId: input.sourceId, createdAt: input.createdAt,
      });
      valueRials += takeValue;
      const next = subtractDecimal(remaining, take);
      if (!next) break;
      remaining = next;
    }
    return { valueRials, records, consumedReservation: selectedReservation, fullyConsumed: compareDecimal(requested, onHand) === 0 };
  };

  const application = {
    approveSupplierRelationship: async (command: { partyId: string; evidence: ImmutableEvidence; actor: SupplyChainActor }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      return repository.transaction(async (tx) => {
        const party = await tx.getParty(command.partyId);
        if (!party) throw new SupplyChainAccountingError('PARTY_NOT_FOUND', 'طرف حساب یافت نشد.', 404);
        if (!party.roles.includes('SUPPLIER')) await tx.saveParty({ ...party, roles: [...party.roles, 'SUPPLIER'], roleEvidence: [...(party.roleEvidence ?? []), command.evidence], updatedByActorId: command.actor.id });
      });
    },

    recognizeSupplierInvoice: async (command: SupplierInvoiceCommand): Promise<StoredOutcome> => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (!command.lines.length) throw new SupplyChainAccountingError('INVOICE_LINES_REQUIRED', 'فاکتور تأمین‌کننده بدون ردیف قابل ثبت نیست.', 400);
      if (command.lines.some((line) => [line.unitPriceRials, line.grossRials, line.discountRials, line.attributableFreightRials,
        line.recoverableTaxRials, line.nonRecoverableTaxRials, line.deductionRials, line.retentionRials, line.roundingRials].some((amount) => amount < 0n))) {
        throw new SupplyChainAccountingError('INVALID_PURCHASE_LINE_AMOUNT', 'مبالغ ردیف خرید باید نامنفی باشند.', 400);
      }
      return repository.transaction(async (tx) => {
        const { commandHash, prior } = await commandRetry(tx, command.idempotencyKey, command);
        if (prior) return prior;
        const party = await tx.getParty(command.supplierPartyId);
        if (!party) throw new SupplyChainAccountingError('PARTY_NOT_FOUND', 'طرف حساب تأمین‌کننده یافت نشد.', 404);
        const duplicate = await tx.findInvoiceByNumber(command.supplierPartyId, command.supplierInvoiceNumber.trim());
        const firstMismatch = command.lines.map((line) => mismatch(line, command.supplierPartyId)).find(Boolean)
          ?? (duplicate ? { code: 'DUPLICATE_SUPPLIER_INVOICE', message: 'شماره فاکتور تأمین‌کننده تکراری است.' } : null);
        if (firstMismatch) {
          const exception: ExceptionRecord = {
            id: randomUUID(), code: firstMismatch.code, message: firstMismatch.message,
            sourceId: command.evidence.id, correlationId: command.correlationId,
            evidence: command.evidence, createdAt: dependencies.now(), resolvedAt: null,
          };
          await tx.saveException(exception);
          const outcome: StoredOutcome = { kind: 'EXCEPTION', exceptionId: exception.id, exceptionCode: exception.code };
          await tx.saveOutcome(command.idempotencyKey, commandHash, outcome);
          return outcome;
        }
        const netPayableRials = command.lines.reduce((sum, line) => sum + line.grossRials - line.discountRials
          + line.attributableFreightRials + line.recoverableTaxRials + line.nonRecoverableTaxRials
          - line.deductionRials - line.retentionRials + line.roundingRials, 0n);
        const inventoryValueRials = command.lines.reduce((sum, line) => line.kind === 'INVENTORY'
          ? sum + line.grossRials - line.discountRials + line.attributableFreightRials + line.nonRecoverableTaxRials : sum, 0n);
        if (netPayableRials <= 0n) throw new SupplyChainAccountingError('INVALID_NET_PAYABLE', 'خالص بدهی فاکتور باید مثبت باشد.', 400);
        const posted = await dependencies.post({
          idempotencyKey: `supplier-invoice:${command.idempotencyKey}`, correlationId: command.correlationId,
          source: command.evidence, description: `فاکتور تأمین‌کننده ${command.supplierInvoiceNumber}`,
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId, documentDate: command.documentDate,
          actor: command.actor,
          lines: [
            ...purchasePostingLines(command.lines, 'RECOGNIZE'),
            { accountRole: 'SUPPLIER_PAYABLE', debitRials: 0n, creditRials: netPayableRials, partyId: command.supplierPartyId },
          ],
        });
        const invoiceId = randomUUID();
        const openItemId = randomUUID();
        await tx.saveInvoice({
          id: invoiceId, bookId: command.bookId, supplierPartyId: command.supplierPartyId, supplierInvoiceNumber: command.supplierInvoiceNumber.trim(),
          documentDate: command.documentDate, dueDate: command.dueDate, netPayableRials, inventoryValueRials,
          grossRials: command.lines.reduce((sum, line) => sum + line.grossRials, 0n),
          discountRials: command.lines.reduce((sum, line) => sum + line.discountRials, 0n),
          attributableFreightRials: command.lines.reduce((sum, line) => sum + line.attributableFreightRials, 0n),
          recoverableTaxRials: command.lines.reduce((sum, line) => sum + line.recoverableTaxRials, 0n),
          nonRecoverableTaxRials: command.lines.reduce((sum, line) => sum + line.nonRecoverableTaxRials, 0n),
          deductionRials: command.lines.reduce((sum, line) => sum + line.deductionRials, 0n),
          retentionRials: command.lines.reduce((sum, line) => sum + line.retentionRials, 0n),
          roundingRials: command.lines.reduce((sum, line) => sum + line.roundingRials, 0n),
          voucherId: posted.voucherId, source: command.evidence, actorId: command.actor.id, lines: command.lines,
        });
        await tx.saveOpenItem({ id: openItemId, partyId: command.supplierPartyId, sourceType: 'SUPPLIER_INVOICE', sourceId: invoiceId, amountRials: netPayableRials, dueDate: command.dueDate });
        if (!party.roles.includes('SUPPLIER')) await tx.saveParty({ ...party, roles: [...party.roles, 'SUPPLIER'], roleEvidence: [...(party.roleEvidence ?? []), command.evidence], updatedByActorId: command.actor.id });
        const inventoryLines = command.lines.filter((line) => line.kind === 'INVENTORY');
        const totalInventoryBasis = inventoryLines.reduce((sum, line) => sum + line.grossRials - line.discountRials + line.attributableFreightRials + line.nonRecoverableTaxRials, 0n);
        for (const line of inventoryLines) {
          if (!line.inventory) throw new SupplyChainAccountingError('INVENTORY_IDENTITY_REQUIRED', 'هویت و مکان موجودی برای ردیف کالا الزامی است.', 400);
          const lineBasis = line.grossRials - line.discountRials + line.attributableFreightRials + line.nonRecoverableTaxRials;
          const allocatedValue = totalInventoryBasis === inventoryValueRials ? lineBasis : (inventoryValueRials * lineBasis) / totalInventoryBasis;
          await tx.saveLayer({
            id: randomUUID(), identityId: line.inventory.identityId, warehouseId: line.inventory.warehouseId,
            locationId: line.inventory.locationId, originId: line.inventory.originId, unit: line.unit,
            quantity: decimal(line.quantity).canonical, valueRials: allocatedValue,
            valuationMethod: line.inventory.valuationMethod, sourceType: 'SUPPLIER_INVOICE', sourceId: invoiceId, createdAt: dependencies.now(),
          });
          await tx.saveInventoryEvent({
            id: randomUUID(), identityId: line.inventory.identityId, eventType: 'RECEIPT',
            warehouseId: line.inventory.warehouseId, locationId: line.inventory.locationId,
            unit: line.unit, quantity: decimal(line.quantity).canonical, voucherId: posted.voucherId,
            evidence: line.receiptEvidence!, occurredAt: command.documentDate, statusAfter: 'AVAILABLE',
          });
        }
        const outcome: StoredOutcome = { kind: 'POSTED', invoiceId, openItemId, voucherId: posted.voucherId, statutoryNumber: posted.statutoryNumber };
        await tx.saveOutcome(command.idempotencyKey, commandHash, outcome);
        return outcome;
      });
    },

    recordSupplierCorrection: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date; dueDate: Date;
      correctionOfInvoiceId: string; supplierInvoiceNumber: string; reason: string; idempotencyKey: string;
      correlationId: string; evidence: ImmutableEvidence; actor: SupplyChainActor; lines: ReadonlyArray<PurchaseLine>;
      inventoryReturns?: ReadonlyArray<{ identityId: string; quantity: string; unit: string; sourceWarehouseId: string; sourceLocationId: string; warehouseId: string; locationId: string; evidence: ImmutableEvidence }>;
    }): Promise<StoredOutcome> => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (command.reason.trim().length < 8 || !command.lines.length) {
        throw new SupplyChainAccountingError('CORRECTION_REASON_REQUIRED', 'اصلاح خرید باید ردیف و دلیل روشن داشته باشد.', 400);
      }
      return repository.transaction(async (tx) => {
        const { commandHash, prior } = await commandRetry(tx, command.idempotencyKey, command);
        if (prior) return prior;
        const original = await tx.getInvoice(command.correctionOfInvoiceId);
        if (!original) throw new SupplyChainAccountingError('SUPPLIER_INVOICE_NOT_FOUND', 'فاکتور مرجع اصلاح یافت نشد.', 404);
        if (await tx.findInvoiceByNumber(original.supplierPartyId, command.supplierInvoiceNumber.trim())) {
          throw new SupplyChainAccountingError('DUPLICATE_SUPPLIER_INVOICE', 'شماره سند اصلاحی تأمین‌کننده تکراری است.');
        }
        for (const line of command.lines) {
          decimal(line.quantity, 'مقدار سند اصلاحی');
          for (const amount of [line.unitPriceRials, line.grossRials, line.discountRials, line.attributableFreightRials,
            line.recoverableTaxRials, line.nonRecoverableTaxRials, line.deductionRials, line.retentionRials, line.roundingRials]) {
            if (amount < 0n) throw new SupplyChainAccountingError('INVALID_CORRECTION_AMOUNT', 'مبالغ سند اصلاحی باید نامنفی باشند.', 400);
          }
        }
        const correctionRials = command.lines.reduce((sum, line) => sum + line.grossRials - line.discountRials
          + line.attributableFreightRials + line.recoverableTaxRials + line.nonRecoverableTaxRials
          - line.deductionRials - line.retentionRials + line.roundingRials, 0n);
        if (correctionRials <= 0n || correctionRials > original.netPayableRials) {
          throw new SupplyChainAccountingError('INVALID_CORRECTION_AMOUNT', 'مبلغ اصلاح باید مثبت و حداکثر برابر فاکتور مرجع باشد.', 400);
        }
        const returned: Array<{ valueRials: bigint; records: InventoryConsumptionRecord[]; item: NonNullable<typeof command.inventoryReturns>[number] }> = [];
        for (const item of command.inventoryReturns ?? []) {
          requireEvidence(item.evidence);
          const result = await consume({ identityId: item.identityId, quantity: item.quantity, unit: item.unit,
            sourceWarehouseId: item.sourceWarehouseId, sourceLocationId: item.sourceLocationId,
            purpose: 'PURCHASE_RETURN', sourceId: command.evidence.id, createdAt: dependencies.now() }, tx);
          returned.push({ ...result, item });
        }
        const returnedValueRials = returned.reduce((sum, item) => sum + item.valueRials, 0n);
        const inventoryCorrectionRials = command.lines.filter((line) => line.kind === 'INVENTORY').reduce((sum, line) => sum + line.grossRials
          - line.discountRials + line.attributableFreightRials + line.nonRecoverableTaxRials, 0n);
        if (inventoryCorrectionRials !== returnedValueRials) {
          throw new SupplyChainAccountingError('RETURN_VALUE_MISMATCH', 'ارزش لایه‌های کالای مرجوعی باید دقیقاً با بخش موجودی سند اصلاحی برابر باشد.', 400);
        }
        const posted = await dependencies.post({
          idempotencyKey: `supplier-correction:${command.idempotencyKey}`, correlationId: command.correlationId,
          source: command.evidence, description: `اصلاح فاکتور تأمین‌کننده: ${command.reason.trim()}`,
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            { accountRole: 'SUPPLIER_PAYABLE', debitRials: correctionRials, creditRials: 0n, partyId: original.supplierPartyId },
            ...purchasePostingLines(command.lines, 'REVERSE'),
          ],
        });
        const correctionId = randomUUID();
        await tx.saveInvoice({
          id: correctionId, bookId: command.bookId, supplierPartyId: original.supplierPartyId,
          supplierInvoiceNumber: command.supplierInvoiceNumber.trim(), documentDate: command.documentDate, dueDate: command.dueDate,
          grossRials: command.lines.reduce((sum, line) => sum + line.grossRials, 0n),
          discountRials: command.lines.reduce((sum, line) => sum + line.discountRials, 0n),
          attributableFreightRials: command.lines.reduce((sum, line) => sum + line.attributableFreightRials, 0n),
          recoverableTaxRials: command.lines.reduce((sum, line) => sum + line.recoverableTaxRials, 0n),
          nonRecoverableTaxRials: command.lines.reduce((sum, line) => sum + line.nonRecoverableTaxRials, 0n),
          deductionRials: command.lines.reduce((sum, line) => sum + line.deductionRials, 0n),
          retentionRials: command.lines.reduce((sum, line) => sum + line.retentionRials, 0n),
          roundingRials: command.lines.reduce((sum, line) => sum + line.roundingRials, 0n),
          netPayableRials: correctionRials, inventoryValueRials: returnedValueRials,
          voucherId: posted.voucherId, source: command.evidence, actorId: command.actor.id,
          lines: command.lines, correctionOfInvoiceId: original.id,
        });
        const originalOpenItem = (await tx.listOpenItems(original.supplierPartyId)).find((item) => item.sourceId === original.id);
        if (!originalOpenItem) throw new SupplyChainAccountingError('OPEN_ITEM_NOT_FOUND', 'قلم باز فاکتور مرجع یافت نشد.', 404);
        const activeAllocations = (await tx.listAllocations()).filter((item) => !item.reversedById && item.openItemId === originalOpenItem.id);
        const remaining = originalOpenItem.amountRials - activeAllocations.reduce((sum, item) => sum + item.amountRials, 0n);
        if (correctionRials > remaining) throw new SupplyChainAccountingError('CORRECTION_EXCEEDS_OPEN_ITEM', 'مبلغ اصلاح از مانده قلم باز بیشتر است.', 400);
        const creditId = randomUUID();
        await tx.savePayment({ id: creditId, partyId: original.supplierPartyId, amountRials: correctionRials, voucherId: posted.voucherId, evidence: command.evidence, kind: 'SUPPLIER_CREDIT', occurredAt: command.documentDate, actorId: command.actor.id });
        await tx.saveAllocation({ id: randomUUID(), paymentId: creditId, openItemId: originalOpenItem.id, amountRials: correctionRials, reversedById: null, actorId: command.actor.id, reason: command.reason.trim() });
        for (const result of returned) {
          for (const record of result.records) await tx.saveConsumption(record);
          await tx.saveInventoryEvent({
            id: randomUUID(), identityId: result.item.identityId, eventType: 'RETURN', warehouseId: result.item.sourceWarehouseId,
            locationId: result.item.sourceLocationId, unit: result.item.unit, quantity: decimal(result.item.quantity).canonical,
            voucherId: posted.voucherId, evidence: result.item.evidence, occurredAt: command.documentDate,
            statusAfter: 'RETURNED',
            predecessorEventId: (await tx.listInventoryEvents(result.item.identityId)).at(-1)?.id,
          });
        }
        const outcome: StoredOutcome = { kind: 'POSTED', invoiceId: correctionId, voucherId: posted.voucherId, statutoryNumber: posted.statutoryNumber, amountRials: correctionRials };
        await tx.saveOutcome(command.idempotencyKey, commandHash, outcome);
        return outcome;
      });
    },

    getSupplierProjection: async (partyId: string) => {
      const openItems = await repository.listOpenItems(partyId);
      const payments = await repository.listPayments(partyId);
      const allocations = (await repository.listAllocations()).filter((item) => !item.reversedById);
      const allocatedByOpenItem = new Map<string, bigint>();
      const allocatedByPayment = new Map<string, bigint>();
      for (const item of allocations) {
        allocatedByOpenItem.set(item.openItemId, (allocatedByOpenItem.get(item.openItemId) ?? 0n) + item.amountRials);
        allocatedByPayment.set(item.paymentId, (allocatedByPayment.get(item.paymentId) ?? 0n) + item.amountRials);
      }
      const payableRials = openItems.reduce((sum, item) => sum + item.amountRials - (allocatedByOpenItem.get(item.id) ?? 0n), 0n);
      const advanceRials = payments.reduce((sum, item) => {
        const signedAmount = item.kind === 'PAYABLE_CHECK_REVERSAL' || item.kind === 'ASSIGNED_CUSTOMER_CHECK_REVERSAL' ? -item.amountRials : item.amountRials;
        return sum + signedAmount - (allocatedByPayment.get(item.id) ?? 0n);
      }, 0n);
      return { payableRials, advanceRials, openItemCount: openItems.filter((item) => item.amountRials > (allocatedByOpenItem.get(item.id) ?? 0n)).length };
    },

    getSupplierAging: async (partyId: string, asOf: Date) => {
      const openItems = await repository.listOpenItems(partyId);
      const activeAllocations = (await repository.listAllocations()).filter((item) => !item.reversedById);
      const allocated = new Map<string, bigint>();
      for (const item of activeAllocations) allocated.set(item.openItemId, (allocated.get(item.openItemId) ?? 0n) + item.amountRials);
      const buckets = { notDueRials: 0n, overdue1To30Rials: 0n, overdue31To60Rials: 0n, overdue61To90Rials: 0n, overdueOver90Rials: 0n };
      const items = openItems.map((item) => {
        const remainingRials = item.amountRials - (allocated.get(item.id) ?? 0n);
        const overdueDays = Math.max(0, Math.floor((asOf.getTime() - item.dueDate.getTime()) / 86_400_000));
        if (remainingRials > 0n) {
          if (item.dueDate.getTime() >= asOf.getTime()) buckets.notDueRials += remainingRials;
          else if (overdueDays <= 30) buckets.overdue1To30Rials += remainingRials;
          else if (overdueDays <= 60) buckets.overdue31To60Rials += remainingRials;
          else if (overdueDays <= 90) buckets.overdue61To90Rials += remainingRials;
          else buckets.overdueOver90Rials += remainingRials;
        }
        return { ...item, remainingRials, overdueDays };
      }).filter((item) => item.remainingRials > 0n);
      return { partyId, asOf, buckets, totalRials: Object.values(buckets).reduce((sum, amount) => sum + amount, 0n), items };
    },

    recordSupplierPayment: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
      supplierPartyId: string; financialAccountId: string; amountRials: bigint; occurredAt: Date; idempotencyKey: string;
      evidence: ImmutableEvidence; actor: SupplyChainActor; allocations: ReadonlyArray<{ openItemId: string; amountRials: bigint }>;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (command.amountRials <= 0n) throw new SupplyChainAccountingError('INVALID_PAYMENT_AMOUNT', 'مبلغ پرداخت باید مثبت باشد.', 400);
      return repository.transaction(async (tx) => {
        const prior = await tx.getOutcome(command.idempotencyKey);
        const commandHash = hashSupplyChainEvidence(command);
        if (prior && prior.commandHash !== commandHash) throw new SupplyChainAccountingError('IDEMPOTENCY_CONFLICT', 'شناسه یکتای پرداخت با محتوای دیگری ثبت شده است.');
        if (prior) {
          const paymentId = prior.value.invoiceId!;
          return { paymentId, allocationIds: (await tx.listAllocations()).filter((item) => item.paymentId === paymentId).map((item) => item.id), voucherId: prior.value.voucherId! };
        }
        const allocationTotal = command.allocations.reduce((sum, item) => sum + item.amountRials, 0n);
        if (allocationTotal > command.amountRials) throw new SupplyChainAccountingError('PAYMENT_OVER_ALLOCATED', 'جمع تخصیص‌ها از مبلغ پرداخت بیشتر است.', 400);
        const activeAllocations = (await tx.listAllocations()).filter((item) => !item.reversedById);
        const requestedByOpenItem = new Map<string, bigint>();
        for (const allocation of command.allocations) {
          const openItem = await tx.getOpenItem(allocation.openItemId);
          if (!openItem || openItem.partyId !== command.supplierPartyId) throw new SupplyChainAccountingError('OPEN_ITEM_NOT_FOUND', 'قلم باز تأمین‌کننده یافت نشد.', 404);
          const already = activeAllocations.filter((item) => item.openItemId === openItem.id).reduce((sum, item) => sum + item.amountRials, 0n);
          const requested = (requestedByOpenItem.get(openItem.id) ?? 0n) + allocation.amountRials;
          requestedByOpenItem.set(openItem.id, requested);
          if (allocation.amountRials <= 0n || already + requested > openItem.amountRials) {
            throw new SupplyChainAccountingError('OPEN_ITEM_OVER_ALLOCATED', 'تخصیص از مانده قلم باز بیشتر است.', 400);
          }
        }
        const posted = await dependencies.post({
          idempotencyKey: `supplier-payment:${command.idempotencyKey}`, source: command.evidence,
          description: 'پرداخت به تأمین‌کننده',
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            ...(allocationTotal > 0n ? [{ accountRole: 'SUPPLIER_PAYABLE', debitRials: allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            ...(command.amountRials > allocationTotal ? [{ accountRole: 'SUPPLIER_ADVANCE', debitRials: command.amountRials - allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            { accountRole: 'CASH_OR_BANK', debitRials: 0n, creditRials: command.amountRials, financialAccountId: command.financialAccountId },
          ],
        });
        const paymentId = randomUUID();
        await tx.savePayment({ id: paymentId, partyId: command.supplierPartyId, financialAccountId: command.financialAccountId, amountRials: command.amountRials, voucherId: posted.voucherId, evidence: command.evidence, occurredAt: command.occurredAt, actorId: command.actor.id });
        const allocationIds: string[] = [];
        for (const allocation of command.allocations) {
          const id = randomUUID();
          allocationIds.push(id);
          await tx.saveAllocation({ id, paymentId, openItemId: allocation.openItemId, amountRials: allocation.amountRials, reversedById: null, actorId: command.actor.id });
        }
        await tx.saveOutcome(command.idempotencyKey, commandHash, { kind: 'POSTED', invoiceId: paymentId, voucherId: posted.voucherId });
        return { paymentId, allocationIds, voucherId: posted.voucherId };
      });
    },

    reverseAllocation: async (command: { allocationId: string; reason: string; idempotencyKey: string; evidence: ImmutableEvidence; actor: SupplyChainActor } & SupplyChainLedgerContext) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (command.reason.trim().length < 8) throw new SupplyChainAccountingError('REVERSAL_REASON_REQUIRED', 'دلیل برگشت تخصیص باید شفاف باشد.', 400);
      return repository.transaction(async (tx) => {
        const original = await tx.getAllocation(command.allocationId);
        if (!original) throw new SupplyChainAccountingError('ALLOCATION_NOT_FOUND', 'تخصیص یافت نشد.', 404);
        if (original.reversedById) return tx.getAllocation(original.reversedById);
        const openItem = await tx.getOpenItem(original.openItemId);
        if (!openItem) throw new SupplyChainAccountingError('OPEN_ITEM_NOT_FOUND', 'قلم باز تخصیص یافت نشد.', 404);
        await dependencies.post({
          idempotencyKey: `supplier-allocation-reversal:${command.idempotencyKey}`, source: command.evidence,
          description: `برگشت تخصیص پرداخت: ${command.reason.trim()}`,
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            { accountRole: 'SUPPLIER_ADVANCE', debitRials: original.amountRials, creditRials: 0n, partyId: openItem.partyId },
            { accountRole: 'SUPPLIER_PAYABLE', debitRials: 0n, creditRials: original.amountRials, partyId: openItem.partyId },
          ],
        });
        const reversal: AllocationRecord = { id: randomUUID(), paymentId: original.paymentId, openItemId: original.openItemId, amountRials: -original.amountRials, reversedById: original.id, actorId: command.actor.id, reason: command.reason.trim() };
        await tx.saveAllocation(reversal);
        await tx.saveAllocation({ ...original, reversedById: reversal.id });
        return reversal;
      });
    },

    getInventoryProjection: async ({ identityId }: { identityId: string }) => inventoryProjection(identityId),

    recordPhysicalMovement: async (command: {
      identityId: string; quantity: string; unit: string; sourceWarehouseId: string; sourceLocationId: string; warehouseId: string; locationId: string;
      evidence: ImmutableEvidence; actor: SupplyChainActor; occurredAt: Date;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      return repository.transaction(async (tx) => {
        const existing = (await tx.listInventoryEvents(command.identityId)).find((item) => item.evidence.type === command.evidence.type
          && item.evidence.id === command.evidence.id && item.evidence.version === command.evidence.version);
        if (existing) return existing;
        const projection = await inventoryProjection(command.identityId, tx);
        if (projection.unit !== command.unit) throw new SupplyChainAccountingError('INCOMPATIBLE_INVENTORY_UNIT', 'واحد حرکت فیزیکی با هویت موجودی سازگار نیست.', 400);
        if (projection.quantity === '0' || compareDecimal(decimal(command.quantity), decimal(projection.quantity)) > 0) {
          throw new SupplyChainAccountingError('INSUFFICIENT_INVENTORY', 'مقدار قابل ردیابی برای این حرکت کافی نیست.');
        }
        const prior = (await tx.listInventoryEvents(command.identityId)).at(-1);
        const locationQuantity = await inventoryLocationQuantity(command.identityId, command.sourceWarehouseId, command.sourceLocationId, tx);
        if (compareDecimal(decimal(command.quantity), locationQuantity) > 0) throw new SupplyChainAccountingError('INSUFFICIENT_LOCATION_INVENTORY', 'موجودی مکان مبدأ برای جابه‌جایی کافی نیست.');
        const event: InventoryEventRecord = {
          id: randomUUID(), identityId: command.identityId, eventType: 'MOVEMENT',
          warehouseId: command.warehouseId, locationId: command.locationId, unit: command.unit,
          quantity: decimal(command.quantity).canonical, evidence: command.evidence,
          occurredAt: command.occurredAt, predecessorEventId: prior?.id,
          sourceWarehouseId: command.sourceWarehouseId, sourceLocationId: command.sourceLocationId, statusAfter: 'AVAILABLE',
        };
        await tx.saveInventoryEvent(event);
        return event;
      });
    },

    reserveInventory: async (command: {
      identityId: string; quantity: string; unit: string; purposeId: string; idempotencyKey: string;
      evidence: ImmutableEvidence; actor: SupplyChainActor;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      return repository.transaction(async (tx) => {
        const prior = await tx.findReservationByIdempotencyKey(command.idempotencyKey);
        if (prior) {
          if (prior.identityId !== command.identityId || prior.unit !== command.unit
              || compareDecimal(decimal(prior.quantity), decimal(command.quantity)) !== 0
              || prior.purposeId !== command.purposeId || prior.evidence.hash !== command.evidence.hash) {
            throw new SupplyChainAccountingError('IDEMPOTENCY_CONFLICT', 'شناسه یکتای رزرو با محتوای دیگری ثبت شده است.');
          }
          return prior;
        }
        const projection = await inventoryProjection(command.identityId, tx);
        if (projection.unit !== command.unit) throw new SupplyChainAccountingError('INCOMPATIBLE_INVENTORY_UNIT', 'واحد رزرو با موجودی سازگار نیست.', 400);
        const activeReservations = (await tx.listReservations(command.identityId)).filter((item) => item.status === 'ACTIVE');
        const reserved = activeReservations.map((item) => decimal(item.quantity)).reduce<Decimal | null>((sum, item) => sum ? addDecimal(sum, item) : item, null);
        const requestedWithReserved = reserved ? addDecimal(reserved, decimal(command.quantity)) : decimal(command.quantity);
        if (compareDecimal(requestedWithReserved, decimal(projection.quantity)) > 0) throw new SupplyChainAccountingError('INSUFFICIENT_INVENTORY', 'موجودی آزاد برای رزرو کافی نیست.');
        const reservation: InventoryReservationRecord = {
          id: randomUUID(), identityId: command.identityId, unit: command.unit,
          quantity: decimal(command.quantity).canonical, purposeId: command.purposeId,
          idempotencyKey: command.idempotencyKey, evidence: command.evidence,
          status: 'ACTIVE', createdAt: dependencies.now(),
        };
        await tx.saveReservation(reservation);
        return reservation;
      });
    },

    releaseInventoryReservation: async (command: { reservationId: string; evidence: ImmutableEvidence; actor: SupplyChainActor }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      return repository.transaction(async (tx) => {
        const reservation = await tx.getReservation(command.reservationId);
        if (!reservation) throw new SupplyChainAccountingError('RESERVATION_NOT_FOUND', 'رزرو موجودی یافت نشد.', 404);
        if (reservation.status === 'RELEASED') {
          if (reservation.releaseEvidence?.hash !== command.evidence.hash) throw new SupplyChainAccountingError('RESERVATION_RELEASE_CONFLICT', 'این رزرو قبلاً با شاهد دیگری آزاد شده است.');
          return reservation;
        }
        const released: InventoryReservationRecord = {
          ...reservation, status: 'RELEASED', releaseEvidence: command.evidence,
          releasedAt: dependencies.now(), releasedByActorId: command.actor.id,
        };
        await tx.saveReservation(released);
        return released;
      });
    },

    consumeInventory: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
      identityId: string; quantity: string; unit: string; purpose: 'PRODUCTION' | 'SALE' | 'ADJUSTMENT'; sourceWarehouseId: string; sourceLocationId: string;
      idempotencyKey: string; evidence: ImmutableEvidence; actor: SupplyChainActor; reservationId?: string; reservationPurposeId?: string;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      return repository.transaction(async (tx) => {
        const { commandHash, prior } = await commandRetry(tx, command.idempotencyKey, command);
        if (prior) return { voucherId: prior.voucherId!, valueRials: prior.amountRials ?? 0n };
        const result = await consume({ ...command, sourceId: command.evidence.id, createdAt: dependencies.now() }, tx);
        const posted = await dependencies.post({
          idempotencyKey: `inventory-consumption:${command.idempotencyKey}`, source: command.evidence,
          description: 'خروج ارزشی موجودی',
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            { accountRole: command.purpose === 'SALE' ? 'COST_OF_GOODS_SOLD' : 'WORK_IN_PROGRESS', debitRials: result.valueRials, creditRials: 0n, inventoryIdentityId: command.identityId },
            { accountRole: 'INVENTORY', debitRials: 0n, creditRials: result.valueRials, inventoryIdentityId: command.identityId },
          ],
        });
        for (const record of result.records) await tx.saveConsumption(record);
        if (result.consumedReservation) await tx.saveReservation({ ...result.consumedReservation, status: 'RELEASED',
          releaseEvidence: command.evidence, releasedAt: dependencies.now(), releasedByActorId: command.actor.id });
        await tx.saveInventoryEvent({
          id: randomUUID(), identityId: command.identityId,
          eventType: command.purpose === 'SALE' ? 'SALE_RELIEF' : 'TRANSFORMATION_INPUT',
          warehouseId: command.sourceWarehouseId, locationId: command.sourceLocationId, unit: command.unit,
          quantity: decimal(command.quantity).canonical, voucherId: posted.voucherId,
          evidence: command.evidence, occurredAt: command.documentDate,
          predecessorEventId: (await tx.listInventoryEvents(command.identityId)).at(-1)?.id, statusAfter: result.fullyConsumed ? 'CONSUMED' : 'AVAILABLE',
        });
        await tx.saveOutcome(command.idempotencyKey, commandHash, { kind: 'POSTED', voucherId: posted.voucherId, amountRials: result.valueRials });
        return { voucherId: posted.voucherId, valueRials: result.valueRials };
      });
    },

    completeProduction: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
      batchId: string; idempotencyKey: string; actor: SupplyChainActor; evidence: ImmutableEvidence;
      inputs: ReadonlyArray<{ identityId: string; quantity: string; unit: string; sourceWarehouseId: string; sourceLocationId: string; reservationId?: string }>;
      outputs: ReadonlyArray<{ identityId: string; quantity: string; unit: string; warehouseId: string; locationId: string; allocationBasisQuantities?: Partial<Record<'DIRECT_LABOR' | 'MACHINE' | 'ENERGY' | 'OVERHEAD', string>> }>;
      costPools: ReadonlyArray<{ kind: 'DIRECT_LABOR' | 'MACHINE' | 'ENERGY' | 'OVERHEAD'; amountRials: bigint; basis: 'HOUR' | 'AREA' | 'LENGTH' | 'WEIGHT' | 'BATCH'; basisQuantity: string; policyVersion: number }>;
      normalWaste?: { quantity: string; unit: string };
      abnormalWaste?: { quantity: string; unit: string; reason: string };
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (!command.inputs.length || !command.outputs.length || command.costPools.some((item) => item.amountRials < 0n || item.policyVersion < 1 || decimal(item.basisQuantity).units <= 0n)) {
        throw new SupplyChainAccountingError('INCOMPLETE_PRODUCTION_EVIDENCE', 'شواهد مقدار یا مبنای تخصیص تولید کامل نیست.', 400);
      }
      if (new Set(command.inputs.map((item) => item.identityId)).size !== command.inputs.length
          || new Set(command.outputs.map((item) => item.identityId)).size !== command.outputs.length) {
        throw new SupplyChainAccountingError('DUPLICATE_PRODUCTION_IDENTITY', 'هر هویت موجودی در یک بچ تولید باید فقط یک‌بار ثبت شود.', 400);
      }
      if (new Set(command.outputs.map((item) => item.unit)).size !== 1) {
        throw new SupplyChainAccountingError('INCOMPATIBLE_OUTPUT_UNITS', 'خروجی‌های دارای واحد ناسازگار بدون مبنای تبدیل صریح قابل تخصیص نیستند.', 400);
      }
      return repository.transaction(async (tx) => {
        const prior = await tx.getOutcome(command.idempotencyKey);
        const commandHash = hashSupplyChainEvidence(command);
        if (prior && prior.commandHash !== commandHash) throw new SupplyChainAccountingError('IDEMPOTENCY_CONFLICT', 'شناسه یکتای تولید با محتوای دیگری ثبت شده است.');
        if (prior) return {
          voucherId: prior.value.voucherId!,
          outputValueRials: prior.value.amountRials ?? 0n,
          abnormalWasteExpenseRials: prior.value.secondaryAmountRials ?? 0n,
        };
        let materialRials = 0n;
        const consumptionRecords: InventoryConsumptionRecord[] = [];
        for (const input of command.inputs) {
          const consumed = await consume({ ...input, purpose: 'PRODUCTION', sourceId: command.batchId, reservationPurposeId: command.batchId, createdAt: dependencies.now() }, tx);
          materialRials += consumed.valueRials;
          consumptionRecords.push(...consumed.records);
        }
        const inputUnit = command.inputs[0].unit;
        if (command.normalWaste && command.normalWaste.unit !== inputUnit) throw new SupplyChainAccountingError('INCOMPATIBLE_WASTE_UNIT', 'واحد ضایعات عادی با ماده مصرفی سازگار نیست.', 400);
        if (command.abnormalWaste && (command.abnormalWaste.unit !== inputUnit || command.abnormalWaste.reason.trim().length < 8)) throw new SupplyChainAccountingError('ABNORMAL_WASTE_EVIDENCE_REQUIRED', 'ضایعات غیرعادی به واحد سازگار و دلیل مشخص نیاز دارد.', 400);
        if ((command.normalWaste || command.abnormalWaste) && command.inputs.some((item) => item.unit !== inputUnit)) {
          throw new SupplyChainAccountingError('INCOMPATIBLE_WASTE_UNIT', 'برای محاسبه ضایعات، همه ورودی‌های مبنا باید یک واحد داشته باشند.', 400);
        }
        const totalInputQuantity = command.inputs.map((item) => decimal(item.quantity)).reduce(addDecimal);
        const totalWaste = [command.normalWaste, command.abnormalWaste].filter(Boolean)
          .map((item) => decimal(item!.quantity)).reduce<Decimal | null>((sum, item) => sum ? addDecimal(sum, item) : item, null);
        if (totalWaste && compareDecimal(totalWaste, totalInputQuantity) > 0) {
          throw new SupplyChainAccountingError('WASTE_EXCEEDS_INPUT', 'جمع ضایعات از مقدار ورودی تولید بیشتر است.', 400);
        }
        const abnormalWasteExpenseRials = command.abnormalWaste
          ? proportionalRials(materialRials, decimal(command.abnormalWaste.quantity), totalInputQuantity) : 0n;
        const poolRials = command.costPools.reduce((sum, item) => sum + item.amountRials, 0n);
        const outputValueRials = materialRials + poolRials - abnormalWasteExpenseRials;
        const posted = await dependencies.post({
          idempotencyKey: `production:${command.idempotencyKey}`, source: command.evidence,
          description: `بهای تمام‌شده واقعی باچ ${command.batchId}`,
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            { accountRole: 'WORK_IN_PROGRESS', debitRials: materialRials + poolRials, creditRials: 0n },
            { accountRole: 'INVENTORY', debitRials: 0n, creditRials: materialRials },
            ...(poolRials > 0n ? [{ accountRole: 'PRODUCTION_COST_POOLS', debitRials: 0n, creditRials: poolRials }] : []),
            { accountRole: 'FINISHED_GOODS', debitRials: outputValueRials, creditRials: 0n },
            ...(abnormalWasteExpenseRials > 0n ? [
              { accountRole: 'ABNORMAL_WASTE_EXPENSE', debitRials: abnormalWasteExpenseRials, creditRials: 0n },
            ] : []),
            { accountRole: 'WORK_IN_PROGRESS', debitRials: 0n, creditRials: materialRials + poolRials },
          ],
        });
        for (const record of consumptionRecords) await tx.saveConsumption(record);
        for (const input of command.inputs) {
          if (!input.reservationId) continue;
          const reservation = await tx.getReservation(input.reservationId);
          if (reservation?.status === 'ACTIVE') await tx.saveReservation({ ...reservation, status: 'RELEASED', releaseEvidence: command.evidence,
            releasedAt: dependencies.now(), releasedByActorId: command.actor.id });
        }
        for (const input of command.inputs) {
          await tx.saveInventoryEvent({
            id: randomUUID(), identityId: input.identityId, eventType: 'TRANSFORMATION_INPUT',
            warehouseId: input.sourceWarehouseId, locationId: input.sourceLocationId, unit: input.unit,
            quantity: decimal(input.quantity).canonical, voucherId: posted.voucherId,
            evidence: command.evidence, occurredAt: command.documentDate,
            predecessorEventId: (await tx.listInventoryEvents(input.identityId)).at(-1)?.id,
            statusAfter: (await inventoryProjection(input.identityId, tx)).quantity === '0' ? 'CONSUMED' : 'AVAILABLE',
          });
        }
        const outputQuantities = command.outputs.map((item) => decimal(item.quantity));
        const totalOutputUnits = outputQuantities.reduce((sum, item) => sum + item.units * power(Math.max(...outputQuantities.map((value) => value.scale)) - item.scale), 0n);
        const outputScale = Math.max(...outputQuantities.map((item) => item.scale));
        const outputValues = command.outputs.map(() => 0n);
        let materialAllocated = 0n;
        const materialForOutputs = materialRials - abnormalWasteExpenseRials;
        for (let index = 0; index < command.outputs.length; index += 1) {
          const quantity = outputQuantities[index];
          const share = index === command.outputs.length - 1 ? materialForOutputs - materialAllocated
            : (materialForOutputs * quantity.units * power(outputScale - quantity.scale)) / totalOutputUnits;
          outputValues[index] += share;
          materialAllocated += share;
        }
        for (const pool of command.costPools) {
          if (command.outputs.length === 1) {
            outputValues[0] += pool.amountRials;
            continue;
          }
          const factors = command.outputs.map((output) => decimal(output.allocationBasisQuantities?.[pool.kind] ?? '', `مبنای ${pool.kind}`));
          const totalFactor = factors.reduce(addDecimal);
          if (compareDecimal(totalFactor, decimal(pool.basisQuantity)) !== 0) {
            throw new SupplyChainAccountingError('COST_POOL_BASIS_MISMATCH', 'جمع مبنای تخصیص خروجی‌ها با مبنای نسخه هزینه برابر نیست.', 400);
          }
          let poolAllocated = 0n;
          for (let index = 0; index < factors.length; index += 1) {
            const share = index === factors.length - 1 ? pool.amountRials - poolAllocated : proportionalRialsFloor(pool.amountRials, factors[index], totalFactor);
            outputValues[index] += share;
            poolAllocated += share;
          }
        }
        const persistedOutputs: ProductionBatchRecord['outputs'][number][] = [];
        for (let index = 0; index < command.outputs.length; index += 1) {
          const output = command.outputs[index];
          const quantity = outputQuantities[index];
          const valueRials = outputValues[index];
          persistedOutputs.push({ identityId: output.identityId, unit: output.unit, quantity: quantity.canonical, valueRials });
          await tx.saveLayer({
            id: randomUUID(), identityId: output.identityId, warehouseId: output.warehouseId, locationId: output.locationId,
            originId: command.inputs.map((item) => item.identityId).join(','), unit: output.unit, quantity: quantity.canonical,
            valueRials, valuationMethod: 'SPECIFIC_IDENTIFICATION', sourceType: 'PRODUCTION_BATCH', sourceId: command.batchId, createdAt: dependencies.now(),
          });
          await tx.saveInventoryEvent({
            id: randomUUID(), identityId: output.identityId, eventType: 'TRANSFORMATION_OUTPUT',
            warehouseId: output.warehouseId, locationId: output.locationId, unit: output.unit,
            quantity: quantity.canonical, voucherId: posted.voucherId, evidence: command.evidence,
            occurredAt: command.documentDate, predecessorEventId: (await tx.listInventoryEvents(output.identityId)).at(-1)?.id,
            statusAfter: 'AVAILABLE', predecessorIdentityIds: command.inputs.map((item) => item.identityId),
          });
        }
        await tx.saveProductionBatch({
          id: command.batchId, voucherId: posted.voucherId, evidenceHash: command.evidence.hash,
          inputValueRials: materialRials, allocatedCostRials: poolRials, outputValueRials,
          abnormalWasteExpenseRials, completedAt: dependencies.now(), costPools: command.costPools,
          outputs: persistedOutputs,
        });
        await tx.saveOutcome(command.idempotencyKey, commandHash, {
          kind: 'POSTED', voucherId: posted.voucherId,
          amountRials: outputValueRials, secondaryAmountRials: abnormalWasteExpenseRials,
        });
        return { voucherId: posted.voucherId, outputValueRials, abnormalWasteExpenseRials };
      });
    },

    previewOpeningInventory: async (command: {
      sourcePackageHash: string; mappingVersion: number; toolVersion: string; scope: unknown; actor: SupplyChainActor; sepidarControlRials: bigint; items: ReadonlyArray<OpeningInventoryItem>; predecessorRunId?: string;
    }) => {
      requireWrite(command.actor);
      if (!/^[a-f0-9]{64}$/i.test(command.sourcePackageHash) || command.mappingVersion < 1 || !command.toolVersion.trim() || command.scope == null) {
        throw new SupplyChainAccountingError('INVALID_MIGRATION_PROVENANCE', 'بسته مهاجرت به اثر انگشت و نسخه نگاشت معتبر نیاز دارد.', 400);
      }
      for (const item of command.items) {
        if (item.disposition === 'REJECTED') {
          if (!item.rejectionReason?.trim()) throw new SupplyChainAccountingError('MIGRATION_REJECTION_REASON_REQUIRED', 'دلیل رد ردیف مهاجرت الزامی است.', 400);
        } else decimal(item.quantity, 'مقدار افتتاحیه');
      }
      const dispositionOf = (item: OpeningInventoryItem) => item.disposition ?? (item.uncertainty ? 'QUARANTINED' : 'ACCEPTED');
      const accepted = command.items.filter((item) => dispositionOf(item) === 'ACCEPTED');
      const acceptedTotal = accepted.reduce((sum, item) => sum + item.valueRials, 0n);
      const prior = await repository.findOpeningRun(command.sourcePackageHash, command.mappingVersion);
      if (prior) {
        if (prior.sepidarControlRials !== command.sepidarControlRials || prior.toolVersion !== command.toolVersion.trim()
            || hashSupplyChainEvidence(prior.scope) !== hashSupplyChainEvidence(command.scope)
            || hashSupplyChainEvidence(prior.items) !== hashSupplyChainEvidence(command.items)) {
          throw new SupplyChainAccountingError('MIGRATION_PREVIEW_CONFLICT', 'این بسته و نسخه نگاشت قبلاً با محتوای دیگری پیش‌نمایش شده است.');
        }
        return { runId: prior.id, reconciled: prior.reconciled, acceptedTotalRials: acceptedTotal, quarantinedCount: prior.items.filter((item) => item.uncertainty).length };
      }
      const run: OpeningRunRecord = {
        id: randomUUID(), sourcePackageHash: command.sourcePackageHash, mappingVersion: command.mappingVersion,
        toolVersion: command.toolVersion.trim(), scope: command.scope, inputCount: command.items.length,
        acceptedCount: accepted.length,
        quarantinedCount: command.items.filter((item) => dispositionOf(item) === 'QUARANTINED').length,
        rejectedCount: command.items.filter((item) => dispositionOf(item) === 'REJECTED').length,
        outputHash: hashSupplyChainEvidence({ items: command.items, acceptedTotalRials: acceptedTotal }),
        sepidarControlRials: command.sepidarControlRials, items: [...command.items], reconciled: acceptedTotal === command.sepidarControlRials, actorId: command.actor.id,
      };
      await repository.transaction(async (tx) => {
        const predecessor = command.predecessorRunId ? await tx.getOpeningRun(command.predecessorRunId) : null;
        if (command.predecessorRunId && (!predecessor || predecessor.successorRunId || predecessor.id === run.id)) {
          throw new SupplyChainAccountingError('INVALID_MIGRATION_PREDECESSOR', 'اجرای پیشین برای جانشینی معتبر نیست.', 400);
        }
        await tx.saveOpeningRun(run);
        if (predecessor) await tx.saveOpeningRun({ ...predecessor, successorRunId: run.id });
      });
      return { runId: run.id, reconciled: run.reconciled, acceptedTotalRials: acceptedTotal, quarantinedCount: command.items.filter((item) => item.uncertainty).length };
    },

    commitOpeningInventory: async (command: { runId: string; idempotencyKey: string; actor: SupplyChainActor } & SupplyChainLedgerContext) => {
      requireWrite(command.actor);
      return repository.transaction(async (tx) => {
        const run = await tx.getOpeningRun(command.runId);
        if (!run) throw new SupplyChainAccountingError('MIGRATION_RUN_NOT_FOUND', 'پیش‌نمایش مهاجرت یافت نشد.', 404);
        if (!run.reconciled) throw new SupplyChainAccountingError('OPENING_INVENTORY_NOT_RECONCILED', 'مجموع افتتاحیه موجودی با کنترل سپیدار برابر نیست.');
        if (run.committedVoucherId) {
          if (run.commitIdempotencyKey !== command.idempotencyKey) throw new SupplyChainAccountingError('MIGRATION_ALREADY_COMMITTED', 'این مهاجرت قبلاً با شناسه دیگری ثبت شده است.');
          return { voucherId: run.committedVoucherId };
        }
        const sourcePayload = { runId: run.id, sourcePackageHash: run.sourcePackageHash, mappingVersion: run.mappingVersion };
        const source = { type: 'OPENING_INVENTORY_MIGRATION', id: run.id, version: 1, payload: sourcePayload, hash: hashSupplyChainEvidence(sourcePayload) };
        const posted = await dependencies.post({
          idempotencyKey: `opening-inventory:${command.idempotencyKey}`, source, description: 'افتتاحیه اقلام موجودی',
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            { accountRole: 'OPENING_INVENTORY', debitRials: run.sepidarControlRials, creditRials: 0n },
            { accountRole: 'OPENING_BALANCE_CONTROL', debitRials: 0n, creditRials: run.sepidarControlRials },
          ],
        });
        for (const item of run.items.filter((entry) => (entry.disposition ?? (entry.uncertainty ? 'QUARANTINED' : 'ACCEPTED')) === 'ACCEPTED')) {
          await tx.saveLayer({
            id: randomUUID(), identityId: item.identityId, warehouseId: item.warehouseId, locationId: item.locationId,
            unit: item.unit, quantity: decimal(item.quantity).canonical, valueRials: item.valueRials,
            valuationMethod: item.valuationMethod, sourceType: 'OPENING_INVENTORY_MIGRATION', sourceId: run.id, createdAt: dependencies.now(),
          });
          await tx.saveInventoryEvent({
            id: randomUUID(), identityId: item.identityId, eventType: 'OPENING', warehouseId: item.warehouseId,
            locationId: item.locationId, unit: item.unit, quantity: decimal(item.quantity).canonical,
            voucherId: posted.voucherId, evidence: source, occurredAt: command.documentDate, statusAfter: 'AVAILABLE',
          });
        }
        await tx.saveOpeningRun({ ...run, committedVoucherId: posted.voucherId, commitIdempotencyKey: command.idempotencyKey });
        return { voucherId: posted.voucherId };
      });
    },

    issuePayableCheck: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
      sayadId: string; amountRials: bigint; supplierPartyId: string; financialAccountId: string; dueDate: Date;
      idempotencyKey: string; evidence: ImmutableEvidence; actor: SupplyChainActor;
      allocations: ReadonlyArray<{ openItemId: string; amountRials: bigint }>;
      replacesCheckId?: string;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (!/^\d{16}$/.test(command.sayadId) || command.amountRials <= 0n) {
        throw new SupplyChainAccountingError('INVALID_PAYABLE_CHECK', 'شناسه صیاد یا مبلغ چک معتبر نیست.', 400);
      }
      return repository.transaction(async (tx) => {
        const duplicate = await tx.findCheckBySayadId(command.sayadId);
        if (duplicate) {
          if (duplicate.amountRials !== command.amountRials || duplicate.supplierPartyId !== command.supplierPartyId
              || duplicate.financialAccountId !== command.financialAccountId || duplicate.dueDate.getTime() !== command.dueDate.getTime()) {
            throw new SupplyChainAccountingError('DUPLICATE_SAYAD_CONFLICT', 'شناسه صیاد قبلاً با مشخصات دیگری ثبت شده است.');
          }
          return { checkId: duplicate.id, status: duplicate.status };
        }
        const allocationTotal = command.allocations.reduce((sum, item) => sum + item.amountRials, 0n);
        if (allocationTotal > command.amountRials) throw new SupplyChainAccountingError('CHECK_OVER_ALLOCATED', 'جمع تخصیص‌های چک از مبلغ آن بیشتر است.', 400);
        const activeAllocations = (await tx.listAllocations()).filter((item) => !item.reversedById);
        const requestedByOpenItem = new Map<string, bigint>();
        for (const allocation of command.allocations) {
          const openItem = await tx.getOpenItem(allocation.openItemId);
          if (!openItem || openItem.partyId !== command.supplierPartyId) throw new SupplyChainAccountingError('OPEN_ITEM_NOT_FOUND', 'قلم باز تأمین‌کننده برای چک یافت نشد.', 404);
          const already = activeAllocations.filter((item) => item.openItemId === openItem.id).reduce((sum, item) => sum + item.amountRials, 0n);
          const requested = (requestedByOpenItem.get(openItem.id) ?? 0n) + allocation.amountRials;
          requestedByOpenItem.set(openItem.id, requested);
          if (allocation.amountRials <= 0n || already + requested > openItem.amountRials) throw new SupplyChainAccountingError('OPEN_ITEM_OVER_ALLOCATED', 'تخصیص چک از مانده قلم باز بیشتر است.', 400);
        }
        const replaced = command.replacesCheckId ? await tx.getCheck(command.replacesCheckId) : null;
        if (command.replacesCheckId && (!replaced || !['BOUNCED', 'RETURNED'].includes(replaced.status)
            || replaced.supplierPartyId !== command.supplierPartyId || replaced.kind !== 'PAYABLE')) {
          throw new SupplyChainAccountingError('INVALID_CHECK_REPLACEMENT', 'چک مرجع برای جایگزینی معتبر نیست.', 400);
        }
        const posted = await dependencies.post({
          idempotencyKey: `payable-check:${command.idempotencyKey}`, source: command.evidence,
          description: 'صدور چک پرداختنی',
          bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
          documentDate: command.documentDate, actor: command.actor,
          lines: [
            ...(allocationTotal > 0n ? [{ accountRole: 'SUPPLIER_PAYABLE', debitRials: allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            ...(command.amountRials > allocationTotal ? [{ accountRole: 'SUPPLIER_ADVANCE', debitRials: command.amountRials - allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            { accountRole: 'PAYABLE_CHECK', debitRials: 0n, creditRials: command.amountRials, partyId: command.supplierPartyId, financialAccountId: command.financialAccountId },
          ],
        });
        const transactionId = randomUUID();
        await tx.savePayment({
          id: transactionId, partyId: command.supplierPartyId, financialAccountId: command.financialAccountId, amountRials: command.amountRials,
          voucherId: posted.voucherId, evidence: command.evidence, kind: 'PAYABLE_CHECK_ISSUANCE',
          occurredAt: command.documentDate, actorId: command.actor.id,
        });
        for (const allocation of command.allocations) await tx.saveAllocation({
          id: randomUUID(), paymentId: transactionId, openItemId: allocation.openItemId,
          amountRials: allocation.amountRials, reversedById: null, actorId: command.actor.id,
        });
        const check: CheckRecord = {
          id: randomUUID(), sayadId: command.sayadId, amountRials: command.amountRials,
          supplierPartyId: command.supplierPartyId, financialAccountId: command.financialAccountId,
          treasuryTransactionId: transactionId, dueDate: command.dueDate, status: 'ISSUED', kind: 'PAYABLE',
        };
        await tx.saveCheck(check);
        await tx.saveCheckEvent({
          id: randomUUID(), checkId: check.id, status: 'ISSUED', reason: 'صدور چک پرداختنی',
          evidence: command.evidence, actorId: command.actor.id, occurredAt: dependencies.now(),
        });
        if (replaced) {
          await tx.saveCheck({ ...replaced, status: 'REPLACED', replacementCheckId: check.id });
          await tx.saveCheckEvent({ id: randomUUID(), checkId: replaced.id, status: 'REPLACED', reason: 'صدور چک جایگزین',
            evidence: command.evidence, actorId: command.actor.id, occurredAt: dependencies.now() });
        }
        return { checkId: check.id, status: check.status, voucherId: posted.voucherId };
      });
    },

    assignCustomerCheck: async (command: {
      bookId: string; fiscalYearId: string; periodId: string; documentDate: Date;
      sayadId: string; amountRials: bigint; supplierPartyId: string; financialAccountId: string; dueDate: Date;
      sourceCustomerPaymentId: string; idempotencyKey: string; receiptEvidence: ImmutableEvidence;
      endorsementEvidence: ImmutableEvidence; actor: SupplyChainActor;
      allocations: ReadonlyArray<{ openItemId: string; amountRials: bigint }>;
      replacesCheckId?: string;
    }) => {
      requireWrite(command.actor);
      requireEvidence(command.receiptEvidence);
      requireEvidence(command.endorsementEvidence);
      if (!/^\d{16}$/.test(command.sayadId) || command.amountRials <= 0n || !command.sourceCustomerPaymentId.trim()) {
        throw new SupplyChainAccountingError('INVALID_ASSIGNED_CUSTOMER_CHECK', 'اطلاعات چک مشتری واگذارشده کامل نیست.', 400);
      }
      return repository.transaction(async (tx) => {
        const duplicate = await tx.findCheckBySayadId(command.sayadId);
        if (duplicate) {
          if (duplicate.kind !== 'ASSIGNED_CUSTOMER' || duplicate.sourceCustomerPaymentId !== command.sourceCustomerPaymentId
              || duplicate.amountRials !== command.amountRials || duplicate.supplierPartyId !== command.supplierPartyId) {
            throw new SupplyChainAccountingError('DUPLICATE_SAYAD_CONFLICT', 'شناسه صیاد قبلاً با مشخصات دیگری ثبت شده است.');
          }
          return { checkId: duplicate.id, status: duplicate.status };
        }
        const allocationTotal = command.allocations.reduce((sum, item) => sum + item.amountRials, 0n);
        if (allocationTotal > command.amountRials) throw new SupplyChainAccountingError('CHECK_OVER_ALLOCATED', 'جمع تخصیص‌های چک از مبلغ آن بیشتر است.', 400);
        const activeAllocations = (await tx.listAllocations()).filter((item) => !item.reversedById);
        const requestedByOpenItem = new Map<string, bigint>();
        for (const allocation of command.allocations) {
          const openItem = await tx.getOpenItem(allocation.openItemId);
          if (!openItem || openItem.partyId !== command.supplierPartyId) throw new SupplyChainAccountingError('OPEN_ITEM_NOT_FOUND', 'قلم باز تأمین‌کننده برای چک یافت نشد.', 404);
          const already = activeAllocations.filter((item) => item.openItemId === openItem.id).reduce((sum, item) => sum + item.amountRials, 0n);
          const requested = (requestedByOpenItem.get(openItem.id) ?? 0n) + allocation.amountRials;
          requestedByOpenItem.set(openItem.id, requested);
          if (allocation.amountRials <= 0n || already + requested > openItem.amountRials) throw new SupplyChainAccountingError('OPEN_ITEM_OVER_ALLOCATED', 'تخصیص چک از مانده قلم باز بیشتر است.', 400);
        }
        const replaced = command.replacesCheckId ? await tx.getCheck(command.replacesCheckId) : null;
        if (command.replacesCheckId && (!replaced || !['BOUNCED', 'RETURNED'].includes(replaced.status)
            || replaced.supplierPartyId !== command.supplierPartyId || replaced.kind !== 'ASSIGNED_CUSTOMER')) {
          throw new SupplyChainAccountingError('INVALID_CHECK_REPLACEMENT', 'چک مشتری مرجع برای جایگزینی معتبر نیست.', 400);
        }
        const posted = await dependencies.post({
          idempotencyKey: `assigned-customer-check:${command.idempotencyKey}`, source: command.endorsementEvidence,
          description: 'واگذاری چک دریافتی مشتری به تأمین‌کننده', bookId: command.bookId, fiscalYearId: command.fiscalYearId,
          periodId: command.periodId, documentDate: command.documentDate, actor: command.actor,
          lines: [
            ...(allocationTotal ? [{ accountRole: 'SUPPLIER_PAYABLE', debitRials: allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            ...(command.amountRials > allocationTotal ? [{ accountRole: 'SUPPLIER_ADVANCE', debitRials: command.amountRials - allocationTotal, creditRials: 0n, partyId: command.supplierPartyId }] : []),
            { accountRole: 'RECEIVABLE_CHECK', debitRials: 0n, creditRials: command.amountRials, financialAccountId: command.financialAccountId },
          ],
        });
        const transactionId = randomUUID();
        await tx.savePayment({ id: transactionId, partyId: command.supplierPartyId, financialAccountId: command.financialAccountId, amountRials: command.amountRials,
          voucherId: posted.voucherId, evidence: command.endorsementEvidence, kind: 'ASSIGNED_CUSTOMER_CHECK', occurredAt: command.documentDate, actorId: command.actor.id });
        for (const allocation of command.allocations) await tx.saveAllocation({ id: randomUUID(), paymentId: transactionId,
          openItemId: allocation.openItemId, amountRials: allocation.amountRials, reversedById: null, actorId: command.actor.id });
        const check: CheckRecord = { id: randomUUID(), sayadId: command.sayadId, amountRials: command.amountRials,
          supplierPartyId: command.supplierPartyId, financialAccountId: command.financialAccountId, treasuryTransactionId: transactionId,
          dueDate: command.dueDate, status: 'ENDORSED', kind: 'ASSIGNED_CUSTOMER', sourceCustomerPaymentId: command.sourceCustomerPaymentId };
        await tx.saveCheck(check);
        await tx.saveCheckEvent({ id: randomUUID(), checkId: check.id, status: 'RECEIVED', reason: 'دریافت چک از مشتری',
          evidence: command.receiptEvidence, actorId: command.actor.id, occurredAt: dependencies.now() });
        await tx.saveCheckEvent({ id: randomUUID(), checkId: check.id, status: 'ENDORSED', reason: 'ظهرنویسی و واگذاری به تأمین‌کننده',
          evidence: command.endorsementEvidence, actorId: command.actor.id, occurredAt: dependencies.now() });
        if (replaced) {
          await tx.saveCheck({ ...replaced, status: 'REPLACED', replacementCheckId: check.id });
          await tx.saveCheckEvent({ id: randomUUID(), checkId: replaced.id, status: 'REPLACED', reason: 'ثبت چک مشتری جایگزین',
            evidence: command.endorsementEvidence, actorId: command.actor.id, occurredAt: dependencies.now() });
        }
        return { checkId: check.id, status: check.status, voucherId: posted.voucherId };
      });
    },

    transitionCheck: async (command: { checkId: string; to: CheckStatus; reason: string; evidence: ImmutableEvidence; actor: SupplyChainActor } & SupplyChainLedgerContext) => {
      requireWrite(command.actor);
      requireEvidence(command.evidence);
      if (command.reason.trim().length < 8) throw new SupplyChainAccountingError('CHECK_TRANSITION_REASON_REQUIRED', 'دلیل تغییر وضعیت چک الزامی است.', 400);
      const allowed: Record<CheckStatus, CheckStatus[]> = {
        RECEIVED: ['ENDORSED', 'DEPOSITED', 'RETURNED'], ISSUED: ['DELIVERED', 'CANCELLED'],
        ENDORSED: ['DELIVERED', 'RETURNED', 'CANCELLED'], DELIVERED: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED'],
        DEPOSITED: ['CLEARED', 'BOUNCED', 'RETURNED'], CLEARED: [], BOUNCED: ['RETURNED'],
        RETURNED: ['CANCELLED'], REPLACED: [], CANCELLED: [],
      };
      return repository.transaction(async (tx) => {
        const check = await tx.getCheck(command.checkId);
        if (!check) throw new SupplyChainAccountingError('CHECK_NOT_FOUND', 'چک یافت نشد.', 404);
        const existing = (await tx.listCheckEvents(check.id)).find((item) => item.evidence.id === command.evidence.id && item.evidence.version === command.evidence.version);
        if (existing) return existing;
        if (!allowed[check.status].includes(command.to)) throw new SupplyChainAccountingError('INVALID_CHECK_TRANSITION', 'تغییر وضعیت درخواست‌شده با زنجیره حقوقی و حضانت چک سازگار نیست.');
        const financialEffectIsActive = ['RECEIVED', 'ISSUED', 'ENDORSED', 'DELIVERED', 'DEPOSITED'].includes(check.status);
        const reopensPayable = financialEffectIsActive && (command.to === 'BOUNCED' || command.to === 'CANCELLED' || command.to === 'RETURNED');
        const checkAllocations = (await tx.listAllocations()).filter((item) => item.paymentId === check.treasuryTransactionId && !item.reversedById);
        const allocatedRials = checkAllocations.reduce((sum, item) => sum + item.amountRials, 0n);
        let transitionVoucherId: string | undefined;
        if ((check.kind === 'PAYABLE' && command.to === 'CLEARED') || reopensPayable) {
          const posted = await dependencies.post({
            idempotencyKey: `check-state:${command.evidence.id}:${command.evidence.version}`, source: command.evidence,
            description: `تغییر وضعیت چک به ${command.to}`,
            bookId: command.bookId, fiscalYearId: command.fiscalYearId, periodId: command.periodId,
            documentDate: command.documentDate, actor: command.actor,
            lines: [
              ...(check.kind === 'PAYABLE'
                ? [{ accountRole: 'PAYABLE_CHECK', debitRials: check.amountRials, creditRials: 0n, partyId: check.supplierPartyId, financialAccountId: check.financialAccountId }]
                : [{ accountRole: 'RETURNED_RECEIVABLE_CHECK', debitRials: check.amountRials, creditRials: 0n, financialAccountId: check.financialAccountId }]),
              ...(command.to === 'CLEARED' ? [{ accountRole: 'BANK', debitRials: 0n, creditRials: check.amountRials, financialAccountId: check.financialAccountId }] : [
                ...(allocatedRials > 0n ? [{ accountRole: 'SUPPLIER_PAYABLE', debitRials: 0n, creditRials: allocatedRials, partyId: check.supplierPartyId }] : []),
                ...(check.amountRials > allocatedRials ? [{ accountRole: 'SUPPLIER_ADVANCE', debitRials: 0n, creditRials: check.amountRials - allocatedRials, partyId: check.supplierPartyId }] : []),
              ]),
            ],
          });
          transitionVoucherId = posted.voucherId;
        }
        if (reopensPayable) {
          await tx.savePayment({
            id: randomUUID(), partyId: check.supplierPartyId, financialAccountId: check.financialAccountId, amountRials: check.amountRials,
            voucherId: transitionVoucherId!, evidence: command.evidence,
            kind: check.kind === 'PAYABLE' ? 'PAYABLE_CHECK_REVERSAL' : 'ASSIGNED_CUSTOMER_CHECK_REVERSAL',
            occurredAt: command.documentDate, actorId: command.actor.id,
          });
          for (const allocation of checkAllocations) {
            const reversal: AllocationRecord = {
              id: randomUUID(), paymentId: allocation.paymentId, openItemId: allocation.openItemId,
              amountRials: -allocation.amountRials, reversedById: allocation.id,
              actorId: command.actor.id, reason: command.reason.trim(),
            };
            await tx.saveAllocation(reversal);
            await tx.saveAllocation({ ...allocation, reversedById: reversal.id });
          }
        }
        const event: CheckEventRecord = {
          id: randomUUID(), checkId: check.id, status: command.to, reason: command.reason.trim(),
          evidence: command.evidence, actorId: command.actor.id, occurredAt: dependencies.now(),
        };
        await tx.saveCheck({ ...check, status: command.to });
        await tx.saveCheckEvent(event);
        return event;
      });
    },

    getCheckTimeline: async (checkId: string) => repository.listCheckEvents(checkId),
  };
  return new Proxy(application, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== 'function') return member;
      return async (...args: unknown[]) => {
        const command = args[0] as { actor?: SupplyChainActor } | undefined;
        if (!command?.actor) return Reflect.apply(member, target, args);
        const baseAudit = {
          id: randomUUID(), commandName: String(property), actorId: command.actor.id,
          effectiveProfile: command.actor.profile, commandHash: hashSupplyChainEvidence(command), createdAt: dependencies.now(),
        };
        try {
          return await repository.transaction(async (tx) => {
            const resolvedCommand = await resolveEvidenceTree(command, String(property)) as typeof command;
            const result = await Reflect.apply(member, target, [resolvedCommand, ...args.slice(1)]);
            await tx.saveCommandAudit({ ...baseAudit, result: 'SUCCEEDED' });
            return result;
          });
        } catch (error) {
          await repository.saveCommandAudit({ ...baseAudit, result: 'DENIED', reason: error instanceof Error ? error.message : 'خطای ناشناخته' });
          if (error && typeof error === 'object') Object.assign(error, { supplyChainAuditRecorded: true });
          throw error;
        }
      };
    },
  });
};
