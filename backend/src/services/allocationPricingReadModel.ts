import type { Prisma } from '@prisma/client';
import { pricedAllocationIntegrityHash, sumExactMoney } from './pricedAllocationLedger';

type Tx = Prisma.TransactionClient;

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Priced allocation evidence is malformed.');
  return value as Readonly<Record<string, unknown>>;
};

export type BoundPricedAllocationReadModel = {
  currency: string;
  pricingVersions: Array<{
    contractId: string;
    pricingVersionId: string;
    integrityHash: string;
    readinessEvidenceHash: string;
  }>;
  lines: Array<{
    allocationRevisionLineId: string;
    contractId: string;
    contractItemId: string;
    productRowId: string;
    unit: string;
    quantity: string;
    grossAmount: string;
    discountAmount: string;
    netAmount: string;
    ledgerSequence: number;
  }>;
  totals: { grossAmount: string; discountAmount: string; netAmount: string };
};

export type BoundAllocationPricingFreshness =
  | { status: 'CURRENT'; staleContracts: [] }
  | { status: 'STALE_REQUIRES_SUCCESSOR'; staleContracts: Array<{
    contractId: string; boundPricingVersionId: string; currentPricingVersionId: string | null;
  }> };

export const assessBoundAllocationPricingFreshness = async (
  tx: Tx,
  allocationRevisionId: string,
): Promise<BoundAllocationPricingFreshness> => {
  const references = await tx.logisticsAllocationRevisionPricing.findMany({
    where: { allocationRevisionId }, orderBy: { contractId: 'asc' },
  });
  if (references.length === 0) throw new Error('Allocation revision has no priced binding.');
  const heads = await tx.contractApprovedPricingHead.findMany({
    where: { contractId: { in: references.map((reference) => reference.contractId) } },
    include: { currentVersion: true }, orderBy: { contractId: 'asc' },
  });
  const current = new Map(heads.map((head) => [head.contractId, head.currentVersion]));
  const staleContracts = references.flatMap((reference) => {
    const version = current.get(reference.contractId);
    return version && version.id === reference.pricingVersionId && version.integrityHash === reference.expectedPricingHash
      ? []
      : [{ contractId: reference.contractId, boundPricingVersionId: reference.pricingVersionId,
        currentPricingVersionId: version?.id || null }];
  });
  return staleContracts.length === 0 ? { status: 'CURRENT', staleContracts: [] }
    : { status: 'STALE_REQUIRES_SUCCESSOR', staleContracts };
};

export const readBoundPricedAllocation = async (
  tx: Tx,
  allocationRevisionId: string,
): Promise<BoundPricedAllocationReadModel> => {
  const [references, events] = await Promise.all([
    tx.logisticsAllocationRevisionPricing.findMany({
      where: { allocationRevisionId }, include: { pricingVersion: true }, orderBy: { contractId: 'asc' },
    }),
    tx.dispatchPricedAllocationEvent.findMany({
      where: { allocationRevisionId },
      include: { allocationRevisionLine: true, pricingRow: true },
      orderBy: [{ pricingRowId: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (references.length === 0 || events.length === 0) throw new Error('Allocation revision has no priced binding.');
  const currencies = [...new Set(references.map((reference) => reference.pricingVersion.currency))];
  if (currencies.length !== 1) throw new Error('Priced allocation currencies conflict.');
  for (const reference of references) {
    if (reference.expectedPricingHash !== reference.pricingVersion.integrityHash) {
      throw new Error(`Approved pricing ${reference.pricingVersionId} failed bound hash verification.`);
    }
  }
  const referencesByContract = new Map(references.map((reference) => [reference.contractId, reference]));
  const sequencesByRow = new Map<string, number[]>();
  const lines = events.map((event) => {
    const evidence = record(event.evidence);
    const ledgerSequence = Number(evidence.ledgerSequence);
    const payload = {
      allocationRevisionId: event.allocationRevisionId,
      allocationRevisionLineId: event.allocationRevisionLineId,
      pricingVersionId: event.pricingVersionId,
      pricingRowId: event.pricingRowId,
      quantity: event.quantity.toFixed(3),
      grossAmount: event.grossAmount.toFixed(12),
      discountAmount: event.discountAmount.toFixed(12),
      netAmount: event.netAmount.toFixed(12),
      consumesFinalRemainder: event.consumesFinalRemainder,
      evidence: event.evidence,
      recordedBy: event.recordedBy,
    };
    if (!Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1
      || event.integrityHash !== pricedAllocationIntegrityHash(payload)) {
      throw new Error(`Priced allocation event ${event.id} failed integrity verification.`);
    }
    const revisionLine = event.allocationRevisionLine;
    const reference = referencesByContract.get(revisionLine.sourceContractId);
    if (!reference || reference.pricingVersionId !== event.pricingVersionId
      || event.pricingRow.pricingVersionId !== event.pricingVersionId
      || event.pricingRow.contractItemId !== revisionLine.sourceContractItemId
      || event.pricingRow.productRowId !== revisionLine.productRowId
      || event.pricingRow.unit !== revisionLine.unit
      || event.quantity.toFixed(3) !== revisionLine.quantity.toFixed(3)) {
      throw new Error(`Priced allocation event ${event.id} attribution changed.`);
    }
    sequencesByRow.set(event.pricingRowId, [...(sequencesByRow.get(event.pricingRowId) || []), ledgerSequence]);
    return {
      allocationRevisionLineId: revisionLine.id,
      contractId: revisionLine.sourceContractId,
      contractItemId: revisionLine.sourceContractItemId,
      productRowId: revisionLine.productRowId,
      unit: revisionLine.unit,
      quantity: payload.quantity,
      grossAmount: payload.grossAmount,
      discountAmount: payload.discountAmount,
      netAmount: payload.netAmount,
      ledgerSequence,
    };
  }).sort((left, right) => left.contractId.localeCompare(right.contractId)
    || left.contractItemId.localeCompare(right.contractItemId) || left.ledgerSequence - right.ledgerSequence);
  for (const [pricingRowId, sequences] of sequencesByRow) {
    if (sequences.sort((left, right) => left - right).some((sequence, index) => sequence !== index + 1)) {
      throw new Error(`Priced allocation row ${pricingRowId} has a non-contiguous ledger sequence.`);
    }
  }
  return {
    currency: currencies[0],
    pricingVersions: references.map((reference) => ({
      contractId: reference.contractId,
      pricingVersionId: reference.pricingVersionId,
      integrityHash: reference.expectedPricingHash,
      readinessEvidenceHash: reference.readinessEvidenceHash,
    })),
    lines,
    totals: {
      grossAmount: sumExactMoney(lines.map((line) => line.grossAmount)),
      discountAmount: sumExactMoney(lines.map((line) => line.discountAmount)),
      netAmount: sumExactMoney(lines.map((line) => line.netAmount)),
    },
  };
};
