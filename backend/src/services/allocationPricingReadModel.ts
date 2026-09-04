import type { Prisma } from '@prisma/client';
import { pricedAllocationIntegrityHash, sumExactMoney } from './pricedAllocationLedger';
import { approvedPricingOperationalContractItemId } from './approvedPricing';
import { ordinaryAllocationLine } from './allocationSource';
import { PartnerEventSchema } from '@sabalanerp/partner-sales-contracts';
import { readPartnerOfficialPurchase } from './partnerSales/accounting/officialPurchase';

type Tx = Prisma.TransactionClient;

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Priced allocation evidence is malformed.');
  return value as Readonly<Record<string, unknown>>;
};

type OrdinaryBoundPricedAllocationReadModel = {
  sourceKind?: never;
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
export type PartnerBoundPricedAllocationReadModel = {
  sourceKind: 'PARTNER_CASE'; currency: string;
  pricingVersions: Array<{ caseId: string; internalRecordId: string; financialApprovalEvidenceId: string;
    sourceFinancialRecordId: string; integrityHash: string; readinessEvidenceHash: string }>;
  lines: Array<{ allocationRevisionLineId: string; productRowId: string; unit: string; quantity: string;
    grossAmount: string; discountAmount: string; netAmount: string; ledgerSequence: number }>;
  totals: { grossAmount: string; discountAmount: string; netAmount: string };
};
export type BoundPricedAllocationReadModel = OrdinaryBoundPricedAllocationReadModel | PartnerBoundPricedAllocationReadModel;

export type BoundAllocationPricingFreshness =
  | { status: 'CURRENT'; staleContracts: [] }
  | { status: 'STALE_REQUIRES_SUCCESSOR'; staleContracts: Array<{
    contractId: string; boundPricingVersionId: string; currentPricingVersionId: string | null;
  }> };

export const assessBoundAllocationPricingFreshness = async (
  tx: Tx,
  allocationRevisionId: string,
): Promise<BoundAllocationPricingFreshness> => {
  const revision = await tx.logisticsAllocationRevision.findUnique({ where: { id: allocationRevisionId },
    select: { sourceKind: true, partnerPricing: { select: { caseId: true, internalRecordId: true,
      sourceFinancialRecordId: true, financialApprovalEvidenceId: true, preparationEvidenceHash: true } } } });
  if (revision?.sourceKind === 'PARTNER_CASE') {
    if (!revision.partnerPricing) throw new Error('Partner allocation revision has no priced binding.');
    const events = await tx.partnerCaseEvent.findMany({ where: { caseId: revision.partnerPricing.caseId },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }], select: { evidence: true } });
    const approvals = events.flatMap(row => {
      const evidence = row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
        ? row.evidence as Record<string, unknown> : {};
      const parsed = PartnerEventSchema.safeParse(evidence.publicEvent);
      return parsed.success && 'financialApprovalEvidenceId' in parsed.data ? [parsed.data] : [];
    });
    const approval = approvals.find(row => row.financialApprovalEvidenceId === revision.partnerPricing!.financialApprovalEvidenceId);
    if (!approval) throw new Error('Partner official financial approval evidence is missing.');
    const clock = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
    const purchase = await readPartnerOfficialPurchase(tx, { internalRecordId: revision.partnerPricing.internalRecordId,
      approval, cutoff: clock, asOf: clock, voided: false });
    if (!purchase.covered || !purchase.official || purchase.official.invoice.status !== 'ISSUED'
        || purchase.official.invoice.invoiceRecordId !== revision.partnerPricing.sourceFinancialRecordId
        || purchase.official.invoice.preparation.evidenceHash !== revision.partnerPricing.preparationEvidenceHash) {
      throw new Error('Partner official shipment pricing is no longer current.');
    }
    return { status: 'CURRENT', staleContracts: [] };
  }
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
  const revision = await tx.logisticsAllocationRevision.findUnique({ where: { id: allocationRevisionId }, include: {
    lines: true, partnerPricing: { include: { events: { include: { allocationRevisionLine: true },
      orderBy: [{ approvalEvidenceId: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }] } } } } });
  if (revision?.sourceKind === 'PARTNER_CASE') {
    const reference = revision.partnerPricing;
    if (!reference || reference.allocationRevisionId !== revision.id || !revision.partnerCaseId ||
        reference.caseId !== revision.partnerCaseId || reference.caseRevision !== revision.partnerCaseRevision ||
        reference.integrityHash !== revision.partnerIntegrityHash || reference.internalRecordId !== revision.partnerInternalRecordId ||
        !reference.events.length || reference.discountAmount.toFixed(12) !== '0.000000000000' ||
        reference.netAmount.toFixed(12) !== reference.grossAmount.toFixed(12)) throw new Error('Partner priced allocation attribution changed.');
    const sequences = new Map<string, number[]>();
    const lines = reference.events.map(event => {
      const line = event.allocationRevisionLine;
      const evidence = record(event.evidence), ledgerSequence = Number(evidence.ledgerSequence);
      const payload = { sourceKind: 'PARTNER_CASE' as const, caseId: reference.caseId,
        internalRecordId: reference.internalRecordId, allocationRevisionLineId: line.id,
        productRowId: line.productRowId, quantity: event.quantity.toFixed(3), unit: line.unit,
        pricingVersionId: reference.financialApprovalEvidenceId, pricingRowId: event.approvalEvidenceId,
        grossAmount: event.grossAmount.toFixed(12), discountAmount: event.discountAmount.toFixed(12),
        netAmount: event.netAmount.toFixed(12), consumesFinalRemainder: event.consumesFinalRemainder,
        evidence: event.evidence, recordedBy: event.recordedBy };
      if (!Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1 ||
          event.integrityHash !== pricedAllocationIntegrityHash(payload) || line.sourceKind !== 'PARTNER_CASE' ||
          line.partnerCaseId !== reference.caseId || line.partnerCaseRevision !== reference.caseRevision ||
          line.partnerIntegrityHash !== reference.integrityHash || line.partnerLineageId === null ||
          line.sourceContractId !== null || line.sourceContractItemId !== null || line.productId !== null ||
          line.quantity.toFixed(3) !== event.quantity.toFixed(3)) throw new Error('Partner priced allocation event failed integrity verification.');
      sequences.set(event.approvalEvidenceId, [...(sequences.get(event.approvalEvidenceId) || []), ledgerSequence]);
      return { allocationRevisionLineId: line.id, productRowId: line.productRowId, unit: line.unit,
        quantity: payload.quantity, grossAmount: payload.grossAmount, discountAmount: payload.discountAmount,
        netAmount: payload.netAmount, ledgerSequence };
    }).sort((left, right) => left.productRowId.localeCompare(right.productRowId) || left.ledgerSequence - right.ledgerSequence);
    for (const values of sequences.values()) if (values.sort((a, b) => a - b).some((value, index) => value !== index + 1)) {
      throw new Error('Partner priced allocation row has a non-contiguous ledger sequence.');
    }
    const totals = { grossAmount: sumExactMoney(lines.map(line => line.grossAmount)),
      discountAmount: sumExactMoney(lines.map(line => line.discountAmount)), netAmount: sumExactMoney(lines.map(line => line.netAmount)) };
    return { sourceKind: 'PARTNER_CASE', currency: reference.currency,
      pricingVersions: [{ caseId: reference.caseId, internalRecordId: reference.internalRecordId,
        financialApprovalEvidenceId: reference.financialApprovalEvidenceId,
        sourceFinancialRecordId: reference.sourceFinancialRecordId,
        integrityHash: reference.pricingIntegrityHash, readinessEvidenceHash: reference.readinessEvidenceHash }], lines, totals };
  }
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
    const revisionLine = ordinaryAllocationLine(event.allocationRevisionLine);
    const reference = referencesByContract.get(revisionLine.sourceContractId);
    if (!reference || reference.pricingVersionId !== event.pricingVersionId
      || event.pricingRow.pricingVersionId !== event.pricingVersionId
      || approvedPricingOperationalContractItemId(event.pricingRow) !== revisionLine.sourceContractItemId
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
