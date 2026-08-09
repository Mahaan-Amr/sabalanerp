import { Prisma } from '@prisma/client';
import type { AllocationPricingBindingPort, LockedPricingEvidence, PricedEventWrite, PricingReferenceWrite } from './allocationPricingBinding';

type Tx = Prisma.TransactionClient;
type ShipmentStatementTransaction = Tx & Record<string, any>;

export type ApprovedPricingIntegrityVerifier = {
  versionMatches(version: unknown, rows: unknown[]): boolean;
  rowMatches(version: unknown, row: unknown): boolean;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

const lockRows = async (tx: Tx, table: string, column: string, ids: string[]) => {
  if (ids.length === 0) return;
  const allowed = new Map([
    ['contract_approved_pricing_heads:contractId', '"contract_approved_pricing_heads"."contractId"'],
    ['contract_approved_pricing_rows:contractItemId', '"contract_approved_pricing_rows"."contractItemId"'],
    ['dispatch_priced_allocation_events:pricingRowId', '"dispatch_priced_allocation_events"."pricingRowId"'],
  ]).get(`${table}:${column}`);
  if (!allowed) throw new Error('Unsupported approved-pricing lock target.');
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE ${allowed} IN (${placeholders}) ORDER BY ${allowed} FOR UPDATE`, ...ids);
};

export const createPrismaAllocationPricingBindingPort = (
  tx: Tx,
  verifier: ApprovedPricingIntegrityVerifier,
): AllocationPricingBindingPort => {
  const database = tx as ShipmentStatementTransaction;
  return ({
  loadCutover: async () => database.shipmentStatementCutover.findUnique({
    where: { id: 'customer-shipment-statements' },
    select: { enabled: true, cutoverAt: true },
  }),

  lockPricingScope: async (keys) => {
    for (const key of [...new Set(keys)].sort((left, right) => left.localeCompare(right))) {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
    }
    const headContracts = keys.filter((key) => key.startsWith('APPROVED_PRICING_HEAD:')).map((key) => key.slice('APPROVED_PRICING_HEAD:'.length));
    const rowItems = keys.filter((key) => key.startsWith('APPROVED_PRICING_ROW:')).map((key) => key.split(':').slice(2).join(':'));
    const ledgerRows = keys.filter((key) => key.startsWith('PRICED_ALLOCATION_LEDGER:')).map((key) => key.slice('PRICED_ALLOCATION_LEDGER:'.length));
    await lockRows(tx, 'contract_approved_pricing_heads', 'contractId', headContracts);
    await lockRows(tx, 'contract_approved_pricing_rows', 'contractItemId', rowItems);
    await lockRows(tx, 'dispatch_priced_allocation_events', 'pricingRowId', ledgerRows);
  },

  loadLockedPricingEvidence: async (contractIds) => {
    const heads = await database.contractApprovedPricingHead.findMany({
      where: { contractId: { in: contractIds } },
      include: { currentVersion: { include: { rows: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] } } } },
      orderBy: { contractId: 'asc' },
    });
    const result: LockedPricingEvidence[] = [];
    for (const head of heads) {
      const storedVersion = head.currentVersion;
      const readiness = await database.contractPricingReadinessResult.findFirst({
        where: { contractId: head.contractId },
        include: { reasons: { orderBy: { ordinal: 'asc' } } },
        orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
      });
      if (!readiness || readiness.pricingVersionId !== storedVersion.id) continue;
      result.push({
        version: {
          id: storedVersion.id,
          contractId: storedVersion.contractId,
          versionNumber: storedVersion.versionNumber,
          sourceFinancialRecordId: storedVersion.sourceFinancialRecordId,
          approvedAt: storedVersion.approvedAt.toISOString(),
          approvedBy: storedVersion.approvedBy,
          schemaVersion: storedVersion.schemaVersion,
          currency: storedVersion.currency,
          grossAmount: storedVersion.grossAmount.toFixed(12),
          discountAmount: storedVersion.discountAmount.toFixed(12),
          netAmount: storedVersion.netAmount.toFixed(12),
          integrityHash: storedVersion.integrityHash,
          readinessEvidenceHash: readiness.evidenceHash,
          rows: storedVersion.rows.map((row: any) => ({
            id: row.id,
            contractItemId: row.contractItemId,
            productRowId: row.productRowId,
            ordinal: row.ordinal,
            contractedQuantity: row.contractedQuantity.toFixed(3),
            unit: row.unit,
            canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
            discountEligible: row.discountEligible,
            componentEvidence: row.componentEvidence as Record<string, string>,
            integrityHash: row.integrityHash,
          })),
        },
        readiness: {
          status: readiness.status,
          reasons: readiness.reasons.map((reason: any) => ({ code: reason.code, detail: reason.detail as Record<string, unknown> })),
          sourceCount: readiness.sourceCount,
          sourceIdentityHash: readiness.sourceIdentityHash,
          quantityTotal: readiness.quantityTotal?.toFixed(3) ?? null,
          amountTotal: readiness.amountTotal?.toFixed(12) ?? null,
        },
        versionIntegrityVerified: verifier.versionMatches(storedVersion, storedVersion.rows),
        rowIntegrityVerified: storedVersion.rows.every((row: any) => verifier.rowMatches(storedVersion, row)),
      });
    }
    return result;
  },

  loadPriorPricedEvents: async (pricingRowIds) => {
    const rows = await database.dispatchPricedAllocationEvent.findMany({
      where: { pricingRowId: { in: pricingRowIds } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      select: { pricingRowId: true, quantity: true, grossAmount: true, discountAmount: true },
    });
    return rows.map((row: any) => ({
      pricingRowId: row.pricingRowId,
      quantity: row.quantity.toFixed(3),
      grossAmount: row.grossAmount.toFixed(12),
      discountAmount: row.discountAmount.toFixed(12),
    }));
  },

  createPricingReference: async (reference: PricingReferenceWrite) => {
    await database.logisticsAllocationRevisionPricing.create({ data: reference });
  },

  createPricedEvent: async (event: PricedEventWrite) => {
    await database.dispatchPricedAllocationEvent.create({ data: {
      allocationRevisionId: event.allocationRevisionId,
      allocationRevisionLineId: event.allocationRevisionLineId,
      pricingVersionId: event.pricingVersionId,
      pricingRowId: event.pricingRowId,
      quantity: new Prisma.Decimal(event.quantity),
      grossAmount: new Prisma.Decimal(event.grossAmount),
      discountAmount: new Prisma.Decimal(event.discountAmount),
      netAmount: new Prisma.Decimal(event.netAmount),
      consumesFinalRemainder: event.consumesFinalRemainder,
      evidence: json(event.evidence),
      integrityHash: event.integrityHash,
      recordedBy: event.recordedBy,
    } });
  },
});
};
