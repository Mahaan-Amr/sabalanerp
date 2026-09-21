import { Prisma, type PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  AccountingSupplyChainRepository,
  AllocationRecord,
  CheckEventRecord,
  CheckRecord,
  ExceptionRecord,
  ImmutableEvidence,
  InventoryConsumptionRecord,
  InventoryEventRecord,
  InventoryLayerRecord,
  InventoryReservationRecord,
  OpeningRunRecord,
  PartyRecord,
  PaymentRecord,
  ProductionBatchRecord,
  StoredOutcome,
  SupplyChainCommandAuditRecord,
  SupplierInvoiceRecord,
} from './accountingSupplyChain';
import { hashSupplyChainEvidence } from './accountingSupplyChain';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

type DbClient = PrismaClient | Prisma.TransactionClient;
const activeSupplyChainTransaction = new AsyncLocalStorage<Prisma.TransactionClient>();

export const currentSupplyChainDatabase = (fallback: PrismaClient): DbClient => (
  activeSupplyChainTransaction.getStore() ?? fallback
);

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item) => (
  typeof item === 'bigint' ? item.toString() : item
)));

const evidenceFromColumns = (row: {
  sourceType: string; sourceId: string; sourceVersion: number; sourceHash: string; sourcePayload: Prisma.JsonValue;
}): ImmutableEvidence => ({
  type: row.sourceType,
  id: row.sourceId,
  version: row.sourceVersion,
  hash: row.sourceHash,
  payload: row.sourcePayload,
});

const reservationEvidence = (row: {
  evidenceType: string; evidenceId: string; evidenceVersion: number; evidenceHash: string; evidencePayload: Prisma.JsonValue;
}): ImmutableEvidence => ({
  type: row.evidenceType,
  id: row.evidenceId,
  version: row.evidenceVersion,
  hash: row.evidenceHash,
  payload: row.evidencePayload,
});

const mapOutcome = (payload: Prisma.JsonValue): StoredOutcome => {
  const value = payload as Record<string, unknown>;
  return {
    kind: value.kind as StoredOutcome['kind'],
    invoiceId: value.invoiceId as string | undefined,
    openItemId: value.openItemId as string | undefined,
    voucherId: value.voucherId as string | undefined,
    statutoryNumber: value.statutoryNumber as number | undefined,
    exceptionId: value.exceptionId as string | undefined,
    exceptionCode: value.exceptionCode as string | undefined,
    amountRials: value.amountRials == null ? undefined : BigInt(String(value.amountRials)),
    secondaryAmountRials: value.secondaryAmountRials == null ? undefined : BigInt(String(value.secondaryAmountRials)),
  };
};

class PrismaSupplyChainRepository implements AccountingSupplyChainRepository {
  constructor(private readonly db: DbClient, private readonly root?: PrismaClient) {}

  async transaction<T>(operation: (repository: AccountingSupplyChainRepository) => Promise<T>): Promise<T> {
    const active = activeSupplyChainTransaction.getStore();
    if (active) return operation(new PrismaSupplyChainRepository(active));
    if (!this.root) return operation(this);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.root.$transaction(
          (tx) => activeSupplyChainTransaction.run(tx, () => operation(new PrismaSupplyChainRepository(tx))),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
        );
      } catch (error) {
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : '';
        const databaseCode = error instanceof Prisma.PrismaClientKnownRequestError
          ? String((error.meta as { code?: string } | undefined)?.code ?? '') : '';
        if (attempt === 4 || (!['P2002', 'P2034'].includes(code) && databaseCode !== '40001')) throw error;
      }
    }
    throw new Error('تراکنش حسابداری خرید پس از تلاش مجدد کامل نشد.');
  }

  async seedParty(party: PartyRecord) {
    const existing = await this.db.accountingParty.findUnique({ where: { id: party.id } });
    if (!existing) throw new Error('ایجاد طرف حساب از منبع عملیاتی انجام می‌شود.');
    await this.saveParty(party);
  }

  async getParty(id: string): Promise<PartyRecord | null> {
    const party = await this.db.accountingParty.findUnique({ where: { id }, include: { roles: true } });
    if (!party) return null;
    const activeRoles = party.roles.filter((role) => !role.effectiveTo && (role.role === 'CUSTOMER' || role.role === 'SUPPLIER'));
    return {
      id: party.id,
      roles: activeRoles.map((role) => role.role as 'CUSTOMER' | 'SUPPLIER'),
      roleEvidence: activeRoles.flatMap((role) => role.evidenceType && role.evidenceId && role.evidenceVersion && role.evidenceHash && role.evidencePayload
        ? [{ type: role.evidenceType, id: role.evidenceId, version: role.evidenceVersion, hash: role.evidenceHash, payload: role.evidencePayload }] : []),
    };
  }

  async saveParty(party: PartyRecord) {
    const current = await this.getParty(party.id);
    if (!current) throw new Error('طرف حساب یافت نشد.');
    for (const role of party.roles.filter((item) => !current.roles.includes(item))) {
      const roleEvidence = party.roleEvidence?.at(-1);
      if (role === 'SUPPLIER' && !roleEvidence) throw new Error('شاهد نقش تأمین‌کننده الزامی است.');
      await this.db.accountingPartyRoleAssignment.create({
        data: {
          partyId: party.id, role, effectiveFrom: new Date(), createdBy: party.updatedByActorId ?? 'system',
          evidenceType: roleEvidence?.type, evidenceId: roleEvidence?.id, evidenceVersion: roleEvidence?.version,
          evidenceHash: roleEvidence?.hash, evidencePayload: roleEvidence ? json(roleEvidence.payload) : undefined,
        },
      });
    }
  }

  async listExceptions(): Promise<ReadonlyArray<ExceptionRecord>> {
    const rows = await this.db.accountingSupplyChainException.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id, code: row.code, message: row.messagePersian, sourceId: row.sourceId,
      correlationId: row.correlationId, evidence: evidenceFromColumns(row), createdAt: row.createdAt, resolvedAt: row.resolvedAt,
    }));
  }

  async saveException(item: ExceptionRecord) {
    await this.db.accountingSupplyChainException.create({
      data: {
        id: item.id, code: item.code, messagePersian: item.message,
        sourceType: item.evidence.type, sourceId: item.evidence.id, sourceVersion: item.evidence.version,
        sourceHash: item.evidence.hash, sourcePayload: json(item.evidence.payload), correlationId: item.correlationId,
        createdAt: item.createdAt, resolvedAt: item.resolvedAt,
      },
    });
  }

  async findInvoiceByNumber(partyId: string, number: string): Promise<SupplierInvoiceRecord | null> {
    const row = await this.db.accountingSupplierInvoice.findUnique({
      where: { supplierPartyId_supplierInvoiceNumber: { supplierPartyId: partyId, supplierInvoiceNumber: number } },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!row) return null;
    return {
      id: row.id, bookId: row.bookId, supplierPartyId: row.supplierPartyId,
      supplierInvoiceNumber: row.supplierInvoiceNumber, documentDate: row.documentDate, dueDate: row.dueDate,
      grossRials: BigInt(row.grossRials.toString()), discountRials: BigInt(row.discountRials.toString()),
      attributableFreightRials: BigInt(row.attributableFreightRials.toString()), recoverableTaxRials: BigInt(row.recoverableTaxRials.toString()),
      nonRecoverableTaxRials: BigInt(row.nonRecoverableTaxRials.toString()), deductionRials: BigInt(row.deductionRials.toString()),
      retentionRials: BigInt(row.retentionRials.toString()), roundingRials: BigInt(row.roundingRials.toString()),
      netPayableRials: BigInt(row.netPayableRials.toString()), inventoryValueRials: BigInt(row.inventoryValueRials.toString()),
      voucherId: row.voucherId, source: evidenceFromColumns(row), actorId: row.createdBy,
      correctionOfInvoiceId: row.correctionOfId ?? undefined,
      lines: row.lines.map((line) => ({
        id: line.sourceLineId, kind: line.kind, description: line.description, quantity: line.quantity.toString(), unit: line.unit,
        unitPriceRials: BigInt(line.unitPriceRials.toString()), grossRials: BigInt(line.grossRials.toString()),
        discountRials: BigInt(line.discountRials.toString()), attributableFreightRials: BigInt(line.attributableFreightRials.toString()),
        recoverableTaxRials: BigInt(line.recoverableTaxRials.toString()), nonRecoverableTaxRials: BigInt(line.nonRecoverableTaxRials.toString()),
        deductionRials: BigInt(line.deductionRials.toString()), retentionRials: BigInt(line.retentionRials.toString()),
        roundingRials: BigInt(line.roundingRials.toString()),
        orderEvidence: line.orderEvidence as ImmutableEvidence | undefined,
        receiptEvidence: line.receiptEvidence as ImmutableEvidence | undefined,
        acceptedServiceEvidence: line.acceptedServiceEvidence as ImmutableEvidence | undefined,
        nonOrderException: line.nonOrderExceptionEvidence as { reason: string; authorized: boolean } | undefined,
        inventory: line.inventoryIdentityId ? { identityId: line.inventoryIdentityId, warehouseId: '', locationId: '', valuationMethod: 'SPECIFIC_IDENTIFICATION' as const } : undefined,
      })),
    };
  }

  async getInvoice(id: string): Promise<SupplierInvoiceRecord | null> {
    const identity = await this.db.accountingSupplierInvoice.findUnique({
      where: { id }, select: { supplierPartyId: true, supplierInvoiceNumber: true },
    });
    return identity ? this.findInvoiceByNumber(identity.supplierPartyId, identity.supplierInvoiceNumber) : null;
  }

  async saveInvoice(item: SupplierInvoiceRecord) {
    for (const line of item.lines.filter((entry) => entry.inventory)) {
      const inventory = line.inventory!;
      await this.db.accountingInventoryIdentity.upsert({
        where: { id: inventory.identityId }, update: {},
        create: {
          id: inventory.identityId, kind: inventory.valuationMethod === 'MOVING_WEIGHTED_AVERAGE' ? 'CONSUMABLE' : 'BLOCK',
          originId: inventory.originId, valuationMethod: inventory.valuationMethod, governedUnit: line.unit,
        },
      });
    }
    await this.db.accountingSupplierInvoice.create({
      data: {
        id: item.id, bookId: item.bookId, supplierPartyId: item.supplierPartyId,
        supplierInvoiceNumber: item.supplierInvoiceNumber, documentDate: item.documentDate, dueDate: item.dueDate,
        grossRials: item.grossRials.toString(), discountRials: item.discountRials.toString(),
        attributableFreightRials: item.attributableFreightRials.toString(), recoverableTaxRials: item.recoverableTaxRials.toString(),
        nonRecoverableTaxRials: item.nonRecoverableTaxRials.toString(), deductionRials: item.deductionRials.toString(),
        retentionRials: item.retentionRials.toString(), roundingRials: item.roundingRials.toString(),
        netPayableRials: item.netPayableRials.toString(), inventoryValueRials: item.inventoryValueRials.toString(),
        voucherId: item.voucherId, sourceType: item.source.type, sourceId: item.source.id,
        sourceVersion: item.source.version, sourceHash: item.source.hash, sourcePayload: json(item.source.payload),
        correctionOfId: item.correctionOfInvoiceId, createdBy: item.actorId,
        lines: {
          create: item.lines.map((line, index) => ({
            sourceLineId: line.id, sequence: index + 1, kind: line.kind, description: line.description,
            quantity: line.quantity, unit: line.unit, unitPriceRials: line.unitPriceRials.toString(), grossRials: line.grossRials.toString(),
            discountRials: line.discountRials.toString(), attributableFreightRials: line.attributableFreightRials.toString(),
            recoverableTaxRials: line.recoverableTaxRials.toString(), nonRecoverableTaxRials: line.nonRecoverableTaxRials.toString(),
            deductionRials: line.deductionRials.toString(), retentionRials: line.retentionRials.toString(), roundingRials: line.roundingRials.toString(),
            orderEvidence: line.orderEvidence ? json(line.orderEvidence) : undefined,
            receiptEvidence: line.receiptEvidence ? json(line.receiptEvidence) : undefined,
            acceptedServiceEvidence: line.acceptedServiceEvidence ? json(line.acceptedServiceEvidence) : undefined,
            nonOrderExceptionEvidence: line.nonOrderException ? json(line.nonOrderException) : undefined,
            inventoryIdentityId: line.inventory?.identityId,
          })),
        },
      },
    });
  }

  async listOpenItems(partyId: string) {
    const rows = await this.db.accountingSupplierOpenItem.findMany({ where: { supplierPartyId: partyId }, orderBy: { dueDate: 'asc' } });
    return rows.map((row) => ({ id: row.id, partyId: row.supplierPartyId, sourceType: 'SUPPLIER_INVOICE' as const, sourceId: row.invoiceId, amountRials: BigInt(row.amountRials.toString()), dueDate: row.dueDate }));
  }

  async saveOpenItem(item: import('./accountingSupplyChain').OpenItemRecord) {
    await this.db.accountingSupplierOpenItem.create({ data: { id: item.id, supplierPartyId: item.partyId, invoiceId: item.sourceId, amountRials: item.amountRials.toString(), dueDate: item.dueDate } });
  }

  async getOpenItem(id: string) {
    const row = await this.db.accountingSupplierOpenItem.findUnique({ where: { id } });
    return row ? { id: row.id, partyId: row.supplierPartyId, sourceType: 'SUPPLIER_INVOICE' as const, sourceId: row.invoiceId, amountRials: BigInt(row.amountRials.toString()), dueDate: row.dueDate } : null;
  }

  async listPayments(partyId: string): Promise<ReadonlyArray<PaymentRecord>> {
    const rows = await this.db.accountingSupplierSettlementTransaction.findMany({ where: { supplierPartyId: partyId }, orderBy: { occurredAt: 'asc' } });
    return rows.map((row) => ({ id: row.id, partyId: row.supplierPartyId, financialAccountId: row.financialAccountId ?? undefined, amountRials: BigInt(row.amountRials.toString()), voucherId: row.voucherId, evidence: evidenceFromColumns(row), kind: row.kind, occurredAt: row.occurredAt, actorId: row.createdBy }));
  }

  async savePayment(item: PaymentRecord) {
    await this.db.accountingSupplierSettlementTransaction.create({
      data: {
        id: item.id, supplierPartyId: item.partyId, financialAccountId: item.financialAccountId, voucherId: item.voucherId, kind: item.kind ?? 'SUPPLIER_PAYMENT',
        amountRials: item.amountRials.toString(), occurredAt: item.occurredAt, sourceType: item.evidence.type,
        sourceId: item.evidence.id, sourceVersion: item.evidence.version, sourceHash: item.evidence.hash,
        sourcePayload: json(item.evidence.payload), createdBy: item.actorId,
      },
    });
  }

  private mapAllocation(row: { id: string; treasuryTransactionId: string; openItemId: string; amountRials: Prisma.Decimal; reversalOfId: string | null; createdBy: string; reason: string | null; reversal?: { id: string } | null }): AllocationRecord {
    return { id: row.id, paymentId: row.treasuryTransactionId, openItemId: row.openItemId, amountRials: BigInt(row.amountRials.toString()), reversedById: row.reversal?.id ?? row.reversalOfId, actorId: row.createdBy, reason: row.reason ?? undefined };
  }

  async listAllocations() {
    const rows = await this.db.accountingSupplierAllocation.findMany({ include: { reversal: { select: { id: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.mapAllocation(row));
  }

  async getAllocation(id: string) {
    const row = await this.db.accountingSupplierAllocation.findUnique({ where: { id }, include: { reversal: { select: { id: true } } } });
    return row ? this.mapAllocation(row) : null;
  }

  async saveAllocation(item: AllocationRecord) {
    const exists = await this.db.accountingSupplierAllocation.findUnique({ where: { id: item.id } });
    if (exists) return;
    await this.db.accountingSupplierAllocation.create({
      data: {
        id: item.id, treasuryTransactionId: item.paymentId, openItemId: item.openItemId,
        amountRials: item.amountRials.toString(), reversalOfId: item.amountRials < 0n ? item.reversedById : undefined,
        createdBy: item.actorId, reason: item.reason,
      },
    });
  }

  async listLayers(identityId: string): Promise<ReadonlyArray<InventoryLayerRecord>> {
    const rows = await this.db.accountingInventoryValuationLayer.findMany({ where: { identityId }, include: { identity: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id, identityId: row.identityId, warehouseId: row.warehouseId, locationId: row.locationId,
      originId: row.identity.originId ?? undefined, unit: row.unit, quantity: row.quantity.toString(),
      valueRials: BigInt(row.valueRials.toString()), valuationMethod: row.valuationMethod,
      sourceType: row.sourceType, sourceId: row.sourceId, createdAt: row.createdAt,
    }));
  }

  async saveLayer(item: InventoryLayerRecord) {
    await this.db.accountingInventoryIdentity.upsert({
      where: { id: item.identityId }, update: {},
      create: { id: item.identityId, kind: item.valuationMethod === 'MOVING_WEIGHTED_AVERAGE' ? 'CONSUMABLE' : 'BLOCK', originId: item.originId, valuationMethod: item.valuationMethod, governedUnit: item.unit },
    });
    await this.db.accountingInventoryValuationLayer.create({
      data: { id: item.id, identityId: item.identityId, warehouseId: item.warehouseId, locationId: item.locationId, unit: item.unit, quantity: item.quantity, valueRials: item.valueRials.toString(), valuationMethod: item.valuationMethod, sourceType: item.sourceType, sourceId: item.sourceId, createdAt: item.createdAt },
    });
  }

  async listConsumptions(identityId: string): Promise<ReadonlyArray<InventoryConsumptionRecord>> {
    const rows = await this.db.accountingInventoryLayerConsumption.findMany({ where: { identityId }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({ id: row.id, identityId: row.identityId, layerId: row.layerId, unit: row.unit, quantity: row.quantity.toString(), valueRials: BigInt(row.valueRials.toString()), purpose: row.purpose, sourceId: row.sourceId, createdAt: row.createdAt }));
  }

  async saveConsumption(item: InventoryConsumptionRecord) {
    await this.db.accountingInventoryLayerConsumption.create({ data: { id: item.id, identityId: item.identityId, layerId: item.layerId, unit: item.unit, quantity: item.quantity, valueRials: item.valueRials.toString(), purpose: item.purpose, sourceId: item.sourceId, createdAt: item.createdAt } });
  }

  async listInventoryEvents(identityId: string): Promise<ReadonlyArray<InventoryEventRecord>> {
    const rows = await this.db.accountingInventoryEvent.findMany({
      where: { identityId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      identityId: row.identityId,
      eventType: row.eventType,
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      unit: row.unit,
      quantity: row.quantity.toString(),
      voucherId: row.voucherId ?? undefined,
      evidence: evidenceFromColumns(row),
      occurredAt: row.occurredAt,
      predecessorEventId: row.predecessorEventId ?? undefined,
      sourceWarehouseId: row.sourceWarehouseId ?? undefined,
      sourceLocationId: row.sourceLocationId ?? undefined,
      statusAfter: row.statusAfter,
      predecessorIdentityIds: Array.isArray(row.predecessorIdentityIds) ? row.predecessorIdentityIds.filter((item): item is string => typeof item === 'string') : undefined,
    }));
  }

  async saveInventoryEvent(item: InventoryEventRecord) {
    await this.db.accountingInventoryEvent.create({
      data: {
        id: item.id,
        identityId: item.identityId,
        eventType: item.eventType,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        unit: item.unit,
        quantity: item.quantity,
        voucherId: item.voucherId,
        sourceType: item.evidence.type,
        sourceId: item.evidence.id,
        sourceVersion: item.evidence.version,
        sourceHash: item.evidence.hash,
        sourcePayload: json(item.evidence.payload),
        occurredAt: item.occurredAt,
        predecessorEventId: item.predecessorEventId,
        sourceWarehouseId: item.sourceWarehouseId,
        sourceLocationId: item.sourceLocationId,
        statusAfter: item.statusAfter,
        predecessorIdentityIds: item.predecessorIdentityIds,
      },
    });
  }

  async getOutcome(key: string) {
    const row = await this.db.accountingSupplyChainCommand.findUnique({ where: { idempotencyKey: key } });
    return row ? { commandHash: row.commandHash, value: mapOutcome(row.outcomePayload) } : null;
  }

  async saveOutcome(key: string, commandHash: string, value: StoredOutcome) {
    await this.db.accountingSupplyChainCommand.create({ data: { idempotencyKey: key, commandHash, outcomeKind: value.kind, outcomePayload: json(value) } });
  }

  async saveOpeningRun(item: OpeningRunRecord) {
    const acceptedTotal = item.items.filter((entry) => (entry.disposition ?? (entry.uncertainty ? 'QUARANTINED' : 'ACCEPTED')) === 'ACCEPTED').reduce((sum, entry) => sum + entry.valueRials, 0n);
    await this.db.accountingInventoryMigrationRun.upsert({
      where: { id: item.id },
      update: { status: item.committedVoucherId ? 'COMMITTED' : item.reconciled ? 'RECONCILED' : 'PREVIEWED', voucherId: item.committedVoucherId, commitIdempotencyKey: item.commitIdempotencyKey, committedAt: item.committedVoucherId ? new Date() : undefined, successorRunId: item.successorRunId },
      create: {
        id: item.id, sourcePackageHash: item.sourcePackageHash, mappingVersion: item.mappingVersion,
        toolVersion: item.toolVersion, scope: json(item.scope), inputCount: item.inputCount, acceptedCount: item.acceptedCount,
        quarantinedCount: item.quarantinedCount, rejectedCount: item.rejectedCount, outputHash: item.outputHash, successorRunId: item.successorRunId,
        sepidarControlRials: item.sepidarControlRials.toString(), acceptedTotalRials: acceptedTotal.toString(),
        status: item.reconciled ? 'RECONCILED' : 'PREVIEWED', createdBy: item.actorId,
        items: { create: item.items.map((entry) => ({
          sourceId: entry.sourceId, identityId: entry.identityId, warehouseId: entry.warehouseId, locationId: entry.locationId,
          unit: entry.unit, quantity: entry.quantity, valueRials: entry.valueRials.toString(), valuationMethod: entry.valuationMethod,
          uncertainty: entry.uncertainty, disposition: entry.disposition ?? (entry.uncertainty ? 'QUARANTINED' : 'ACCEPTED'), rejectionReason: entry.rejectionReason,
          rawPayload: entry.rawPayload == null ? undefined : json(entry.rawPayload),
        })) },
      },
    });
  }

  async getOpeningRun(id: string): Promise<OpeningRunRecord | null> {
    const row = await this.db.accountingInventoryMigrationRun.findUnique({ where: { id }, include: { items: true } });
    if (!row) return null;
    return {
      id: row.id, sourcePackageHash: row.sourcePackageHash, mappingVersion: row.mappingVersion,
      toolVersion: row.toolVersion, scope: row.scope, inputCount: row.inputCount, acceptedCount: row.acceptedCount,
      quarantinedCount: row.quarantinedCount, rejectedCount: row.rejectedCount, outputHash: row.outputHash, successorRunId: row.successorRunId ?? undefined,
      sepidarControlRials: BigInt(row.sepidarControlRials.toString()), reconciled: row.status !== 'PREVIEWED',
      committedVoucherId: row.voucherId ?? undefined, commitIdempotencyKey: row.commitIdempotencyKey ?? undefined, actorId: row.createdBy,
      items: row.items.map((item) => ({
        sourceId: item.sourceId, identityId: item.identityId, warehouseId: item.warehouseId, locationId: item.locationId,
        unit: item.unit, quantity: item.quantity.toString(), valueRials: BigInt(item.valueRials.toString()),
        valuationMethod: item.valuationMethod, uncertainty: item.uncertainty ?? undefined,
        disposition: item.disposition, rejectionReason: item.rejectionReason ?? undefined, rawPayload: item.rawPayload ?? undefined,
      })),
    };
  }

  async findOpeningRun(sourcePackageHash: string, mappingVersion: number): Promise<OpeningRunRecord | null> {
    const row = await this.db.accountingInventoryMigrationRun.findUnique({
      where: { sourcePackageHash_mappingVersion: { sourcePackageHash, mappingVersion } },
      select: { id: true },
    });
    return row ? this.getOpeningRun(row.id) : null;
  }

  private mapReservation(row: {
    id: string; identityId: string; unit: string; quantity: Prisma.Decimal; purposeId: string; idempotencyKey: string;
    evidenceType: string; evidenceId: string; evidenceVersion: number; evidenceHash: string; evidencePayload: Prisma.JsonValue;
    status: import('@prisma/client').AccountingInventoryReservationStatus; createdAt: Date; releasedAt: Date | null;
    releaseEvidenceType: string | null; releaseEvidenceId: string | null; releaseEvidenceVersion: number | null;
    releaseEvidenceHash: string | null; releaseEvidencePayload: Prisma.JsonValue | null; releasedBy: string | null;
  }): InventoryReservationRecord {
    return {
      id: row.id, identityId: row.identityId, unit: row.unit, quantity: row.quantity.toString(), purposeId: row.purposeId,
      idempotencyKey: row.idempotencyKey, evidence: reservationEvidence(row), status: row.status, createdAt: row.createdAt,
      releasedAt: row.releasedAt ?? undefined, releasedByActorId: row.releasedBy ?? undefined,
      releaseEvidence: row.releaseEvidenceType && row.releaseEvidenceId && row.releaseEvidenceVersion && row.releaseEvidenceHash && row.releaseEvidencePayload
        ? { type: row.releaseEvidenceType, id: row.releaseEvidenceId, version: row.releaseEvidenceVersion, hash: row.releaseEvidenceHash, payload: row.releaseEvidencePayload } : undefined,
    };
  }

  async findReservationByIdempotencyKey(key: string): Promise<InventoryReservationRecord | null> {
    const row = await this.db.accountingInventoryReservation.findUnique({ where: { idempotencyKey: key } });
    return row ? this.mapReservation(row) : null;
  }

  async getReservation(id: string): Promise<InventoryReservationRecord | null> {
    const row = await this.db.accountingInventoryReservation.findUnique({ where: { id } });
    return row ? this.mapReservation(row) : null;
  }

  async listReservations(identityId: string): Promise<ReadonlyArray<InventoryReservationRecord>> {
    const rows = await this.db.accountingInventoryReservation.findMany({ where: { identityId }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.mapReservation(row));
  }

  async saveReservation(item: InventoryReservationRecord) {
    await this.db.accountingInventoryReservation.upsert({
      where: { id: item.id },
      update: {
        status: item.status, releasedAt: item.releasedAt, releasedBy: item.releasedByActorId,
        releaseEvidenceType: item.releaseEvidence?.type, releaseEvidenceId: item.releaseEvidence?.id,
        releaseEvidenceVersion: item.releaseEvidence?.version, releaseEvidenceHash: item.releaseEvidence?.hash,
        releaseEvidencePayload: item.releaseEvidence ? json(item.releaseEvidence.payload) : undefined,
      },
      create: { id: item.id, identityId: item.identityId, unit: item.unit, quantity: item.quantity, purposeId: item.purposeId, idempotencyKey: item.idempotencyKey, status: item.status, evidenceType: item.evidence.type, evidenceId: item.evidence.id, evidenceVersion: item.evidence.version, evidenceHash: item.evidence.hash, evidencePayload: json(item.evidence.payload), createdAt: item.createdAt },
    });
  }

  async findCheckBySayadId(sayadId: string) {
    const row = await this.db.accountingPayableCheck.findUnique({ where: { sayadId } });
    return row ? this.mapCheck(row) : null;
  }

  async getCheck(id: string) {
    const row = await this.db.accountingPayableCheck.findUnique({ where: { id } });
    return row ? this.mapCheck(row) : null;
  }

  private mapCheck(row: { id: string; sayadId: string; amountRials: Prisma.Decimal; supplierPartyId: string; financialAccountId: string; treasuryTransactionId: string; dueDate: Date; status: import('@prisma/client').AccountingCheckLifecycleStatus; replacementCheckId: string | null; kind: import('@prisma/client').AccountingSupplierCheckKind; sourceCustomerPaymentId: string | null }): CheckRecord {
    return { id: row.id, sayadId: row.sayadId, amountRials: BigInt(row.amountRials.toString()), supplierPartyId: row.supplierPartyId, financialAccountId: row.financialAccountId, treasuryTransactionId: row.treasuryTransactionId, dueDate: row.dueDate, status: row.status, replacementCheckId: row.replacementCheckId ?? undefined, kind: row.kind, sourceCustomerPaymentId: row.sourceCustomerPaymentId ?? undefined };
  }

  async saveCheck(item: CheckRecord) {
    await this.db.accountingPayableCheck.upsert({
      where: { id: item.id },
      update: { status: item.status, replacementCheckId: item.replacementCheckId },
      create: { id: item.id, sayadId: item.sayadId, amountRials: item.amountRials.toString(), supplierPartyId: item.supplierPartyId, financialAccountId: item.financialAccountId, treasuryTransactionId: item.treasuryTransactionId, dueDate: item.dueDate, status: item.status, replacementCheckId: item.replacementCheckId, kind: item.kind, sourceCustomerPaymentId: item.sourceCustomerPaymentId },
    });
  }

  async listCheckEvents(checkId: string): Promise<ReadonlyArray<CheckEventRecord>> {
    const rows = await this.db.accountingCheckCustodyEvent.findMany({ where: { checkId }, orderBy: { occurredAt: 'asc' } });
    return rows.map((row) => ({ id: row.id, checkId: row.checkId, status: row.status, reason: row.reason, evidence: reservationEvidence(row), actorId: row.actorId, occurredAt: row.occurredAt }));
  }

  async saveCheckEvent(item: CheckEventRecord) {
    await this.db.accountingCheckCustodyEvent.create({ data: { id: item.id, checkId: item.checkId, status: item.status, reason: item.reason, evidenceType: item.evidence.type, evidenceId: item.evidence.id, evidenceVersion: item.evidence.version, evidenceHash: item.evidence.hash, evidencePayload: json(item.evidence.payload), actorId: item.actorId, occurredAt: item.occurredAt } });
  }

  async getProductionBatch(id: string): Promise<ProductionBatchRecord | null> {
    const row = await this.db.accountingProductionBatch.findUnique({ where: { id }, include: { costPools: true, outputs: true } });
    if (!row) return null;
    return {
      id: row.id, voucherId: row.voucherId, evidenceHash: row.evidenceHash,
      inputValueRials: BigInt(row.inputValueRials.toString()), allocatedCostRials: BigInt(row.allocatedCostRials.toString()),
      outputValueRials: BigInt(row.outputValueRials.toString()), abnormalWasteExpenseRials: BigInt(row.abnormalWasteExpenseRials.toString()),
      completedAt: row.completedAt,
      costPools: row.costPools.map((pool) => ({ kind: pool.kind, amountRials: BigInt(pool.amountRials.toString()), basis: pool.allocationBasis, basisQuantity: pool.basisQuantity.toString(), policyVersion: pool.policyVersion })),
      outputs: row.outputs.map((output) => ({ identityId: output.identityId, unit: output.unit, quantity: output.quantity.toString(), valueRials: BigInt(output.valueRials.toString()) })),
    };
  }

  async saveProductionBatch(item: ProductionBatchRecord) {
    await this.db.accountingProductionBatch.create({
      data: {
        id: item.id, voucherId: item.voucherId, evidenceHash: item.evidenceHash,
        inputValueRials: item.inputValueRials.toString(), allocatedCostRials: item.allocatedCostRials.toString(),
        outputValueRials: item.outputValueRials.toString(), abnormalWasteExpenseRials: item.abnormalWasteExpenseRials.toString(),
        completedAt: item.completedAt,
        costPools: { create: item.costPools.map((pool) => ({ kind: pool.kind, amountRials: pool.amountRials.toString(), allocationBasis: pool.basis, basisQuantity: pool.basisQuantity, policyVersion: pool.policyVersion })) },
        outputs: { create: item.outputs.map((output) => ({ identityId: output.identityId, unit: output.unit, quantity: output.quantity, valueRials: output.valueRials.toString() })) },
      },
    });
  }

  async saveCommandAudit(item: SupplyChainCommandAuditRecord) {
    if (this.root) {
      await this.root.$transaction((tx) => new PrismaSupplyChainRepository(tx).saveCommandAudit(item));
      return;
    }
    const database = this.db;
    await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounting-supply-chain-command-audit'))`;
    const previous = await database.accountingSupplyChainCommandAudit.findFirst({ orderBy: { sequence: 'desc' } });
    const sequence = (previous?.sequence ?? 0n) + 1n;
    const previousHash = previous?.entryHash;
    const entryHash = hashSupplyChainEvidence({
      sequence, commandName: item.commandName, result: item.result, actorId: item.actorId,
      effectiveProfile: item.effectiveProfile, commandHash: item.commandHash, reason: item.reason ?? null,
      createdAt: item.createdAt, previousHash: previousHash ?? null,
    });
    await database.accountingSupplyChainCommandAudit.create({ data: { ...item, sequence, previousHash, entryHash } });
    await createAccountingLedgerPrismaRepository(database, true).appendAudit({
      action: `SUPPLY_CHAIN_${item.commandName}`,
      result: item.result,
      actorId: item.actorId,
      effectiveProfile: ['VIEWER', 'ACCOUNTANT', 'ACCOUNTING_MANAGER'].includes(item.effectiveProfile)
        ? item.effectiveProfile as 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER' : 'VIEWER',
      entityType: 'AccountingSupplyChainCommand',
      entityId: item.id,
      correlationId: item.id,
      reason: item.reason,
      payloadHash: item.commandHash,
      sessionContext: { supplyChainAuditSequence: sequence.toString(), supplyChainAuditHash: entryHash },
    });
  }

  async listCommandAudits(): Promise<ReadonlyArray<SupplyChainCommandAuditRecord>> {
    const rows = await this.db.accountingSupplyChainCommandAudit.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({ ...row, reason: row.reason ?? undefined, previousHash: row.previousHash ?? undefined }));
  }
}

export const createAccountingSupplyChainPrismaRepository = (prisma: PrismaClient): AccountingSupplyChainRepository => (
  new PrismaSupplyChainRepository(prisma, prisma)
);
