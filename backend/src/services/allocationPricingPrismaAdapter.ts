import { Prisma } from '@prisma/client';
import type { AllocationPricingBindingPort, LockedPricingEvidence, PricedEventWrite, PricingReferenceWrite } from './allocationPricingBinding';
import {
  persistedApprovedPricingInclude,
  approvedPricingOperationalContractItemId,
  persistedApprovedPricingRowIntegrityMatches,
  persistedApprovedPricingVersionIntegrityMatches,
} from './approvedPricing';
import { pricedAllocationIntegrityHash } from './pricedAllocationLedger';
import { loadShipmentStatementRuntimeStateUnderLock } from './dispatchDocuments/runtimeState';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
};

const lockRows = async (tx: Tx, table: string, column: string, ids: string[]) => {
  if (ids.length === 0) return;
  const target = new Map<string, { predicate: string; order: string }>([
    ['contract_approved_pricing_heads:contractId', { predicate: '"contract_approved_pricing_heads"."contractId"', order: '"contractId"' }],
    ['sales_contracts:id', { predicate: '"sales_contracts"."id"', order: '"id"' }],
    ['contract_approved_pricing_rows:contractItemId', {
      predicate: 'COALESCE("contract_approved_pricing_rows"."linkedContractItemId", "contract_approved_pricing_rows"."contractItemId")',
      order: 'COALESCE("linkedContractItemId", "contractItemId"), "id"',
    }],
    ['dispatch_priced_allocation_events:pricingRowId', { predicate: '"dispatch_priced_allocation_events"."pricingRowId"', order: '"pricingRowId", "recordedAt", "id"' }],
  ]).get(`${table}:${column}`);
  if (!target) throw new Error('Unsupported approved-pricing lock target.');
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE ${target.predicate} IN (${placeholders}) ORDER BY ${target.order} FOR UPDATE`, ...ids);
};

export const createPrismaAllocationPricingBindingPort = (tx: Tx): AllocationPricingBindingPort => {
  return ({
  loadCutover: async () => loadShipmentStatementRuntimeStateUnderLock(tx),

  lockPricingScope: async (keys) => {
    for (const key of [...new Set(keys)].sort((left, right) => left.localeCompare(right))) {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
    }
    const headContracts = keys.filter((key) => key.startsWith('APPROVED_PRICING_HEAD:')).map((key) => key.slice('APPROVED_PRICING_HEAD:'.length));
    const rowItems = keys.filter((key) => key.startsWith('APPROVED_PRICING_ROW:')).map((key) => key.split(':').slice(2).join(':'));
    const ledgerRows = keys.filter((key) => key.startsWith('PRICED_ALLOCATION_LEDGER:')).map((key) => key.slice('PRICED_ALLOCATION_LEDGER:'.length));
    await lockRows(tx, 'sales_contracts', 'id', headContracts);
    await lockRows(tx, 'contract_approved_pricing_heads', 'contractId', headContracts);
    await lockRows(tx, 'contract_approved_pricing_rows', 'contractItemId', rowItems);
    await lockRows(tx, 'dispatch_priced_allocation_events', 'pricingRowId', ledgerRows);
  },

  loadLockedPricingEvidence: async (contractIds) => {
    const heads = await tx.contractApprovedPricingHead.findMany({
      where: { contractId: { in: contractIds } },
      include: { currentVersion: { include: persistedApprovedPricingInclude } },
      orderBy: { contractId: 'asc' },
    });
    const result: LockedPricingEvidence[] = [];
    for (const head of heads) {
      const storedVersion = head.currentVersion;
      const readiness = await tx.contractPricingReadinessResult.findFirst({
        where: { contractId: head.contractId },
        include: { reasons: { orderBy: { ordinal: 'asc' } } },
        orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
      });
      if (!readiness || readiness.pricingVersionId !== storedVersion.id) continue;
      const sourceEvidence = record(storedVersion.sourceEvidence);
      const customer = record(sourceEvidence.customer);
      const project = record(sourceEvidence.project);
      const destination = record(sourceEvidence.destination);
      result.push({
        scope: {
          customerId: String(customer.id || ''),
          projectId: String(destination.projectId || project.id || ''),
          destination: String(destination.address || ''),
        },
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
          rows: storedVersion.rows.map((row) => ({
            id: row.id,
            contractItemId: approvedPricingOperationalContractItemId(row),
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
          reasons: readiness.reasons.map((reason) => ({ code: reason.code, detail: reason.detail as Record<string, unknown> })),
          sourceCount: readiness.sourceCount,
          sourceIdentityHash: readiness.sourceIdentityHash,
          quantityTotal: readiness.quantityTotal?.toFixed(3) ?? null,
          amountTotal: readiness.amountTotal?.toFixed(12) ?? null,
        },
        versionIntegrityVerified: persistedApprovedPricingVersionIntegrityMatches(storedVersion),
        rowIntegrityVerified: storedVersion.rows.every((row) => persistedApprovedPricingRowIntegrityMatches(storedVersion, row)),
      });
    }
    return result;
  },

  loadPriorPricedEvents: async (pricingRowIds) => {
    const rows = await tx.dispatchPricedAllocationEvent.findMany({
      where: { pricingRowId: { in: pricingRowIds } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      select: { allocationRevisionId: true, allocationRevisionLineId: true, pricingVersionId: true, pricingRowId: true,
        quantity: true, grossAmount: true, discountAmount: true, netAmount: true, consumesFinalRemainder: true,
        evidence: true, integrityHash: true, recordedBy: true },
    });
    return rows.map((row) => {
      const evidence = record(row.evidence);
      const ledgerSequence = Number(evidence.ledgerSequence);
      const payload = {
        allocationRevisionId: row.allocationRevisionId,
        allocationRevisionLineId: row.allocationRevisionLineId,
        pricingVersionId: row.pricingVersionId,
        pricingRowId: row.pricingRowId,
        quantity: row.quantity.toFixed(3),
        grossAmount: row.grossAmount.toFixed(12),
        discountAmount: row.discountAmount.toFixed(12),
        netAmount: row.netAmount.toFixed(12),
        consumesFinalRemainder: row.consumesFinalRemainder,
        evidence: row.evidence,
        recordedBy: row.recordedBy,
      };
      return { pricingRowId: row.pricingRowId, pricingVersionId: row.pricingVersionId,
        quantity: payload.quantity, grossAmount: payload.grossAmount, discountAmount: payload.discountAmount,
        ledgerSequence,
        integrityVerified: Number.isSafeInteger(ledgerSequence) && ledgerSequence > 0
          && row.integrityHash === pricedAllocationIntegrityHash(payload) };
    });
  },

  createPricingReference: async (reference: PricingReferenceWrite) => {
    await tx.logisticsAllocationRevisionPricing.create({ data: reference });
  },

  createPricedEvent: async (event: PricedEventWrite) => {
    await tx.dispatchPricedAllocationEvent.create({ data: {
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
