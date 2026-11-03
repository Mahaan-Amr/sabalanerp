import type { StatementAdjustmentRenderInput } from './dispatchDocuments/contracts';
import {
  allocatePricedRevision,
  pricedAllocationIntegrityHash,
  type LockedApprovedPricingVersion,
  type PricedAllocationEvidence,
  type PriorPricedAllocationEvent,
} from './pricedAllocationLedger';

export type StatementAdjustmentInvariantCode =
  | 'INVALID_SEQUENCE'
  | 'EMPTY_ADJUSTMENT'
  | 'DUPLICATE_STABLE_ROW'
  | 'INVALID_SOURCE_EVIDENCE'
  | 'CURRENCY_MISMATCH'
  | 'INTEGRITY_MISMATCH';

export class StatementAdjustmentInvariantError extends Error {
  constructor(public readonly code: StatementAdjustmentInvariantCode, message: string) {
    super(message);
  }
}

export type StatementAdjustmentLineInput = {
  correctionLineId: string;
  contractId: string;
  contractItemId: string;
  productRowId: string;
  label: string;
  unit: string;
  quantity: string;
};

export type StatementAdjustmentSnapshotLine = {
  correctionLineId: string;
  contractId: string;
  contractItemId: string;
  productRowId: string;
  pricingVersionId: string;
  pricingRowId: string;
  label: string;
  unit: string;
  quantityDelta: string;
  grossAmountDelta: string;
  discountDelta: string;
  netAmountDelta: string;
  afterQuantity: string;
  ledgerSequence: number;
  consumesFinalRemainder: boolean;
  evidence: PricedAllocationEvidence;
};

export type StatementAdjustmentSnapshot = {
  schemaVersion: 1;
  adjustmentId: string;
  waybillId: string;
  correctionId: string;
  sequence: number;
  reason: string;
  correctionIntegrityHash: string;
  originalStatementDocumentId: string;
  originalStatementSourceIntegrityHash: string;
  originalStatementSha256: string;
  currency: string;
  issuedAt: string;
  issuedBy: string;
  pricingVersions: Array<{
    contractId: string;
    pricingVersionId: string;
    integrityHash: string;
    readinessEvidenceHash: string;
  }>;
  lines: StatementAdjustmentSnapshotLine[];
  quantityDeltasByUnit: Record<string, string>;
  totals: {
    grossAmountDelta: string;
    discountDelta: string;
    netAmountDelta: string;
  };
};

export type CalculatedStatementAdjustment = {
  snapshot: StatementAdjustmentSnapshot;
  integrityHash: string;
  renderInput: StatementAdjustmentRenderInput;
};

export const calculateStatementAdjustment = (input: {
  adjustmentId: string;
  waybillId: string;
  correctionId: string;
  sequence: number;
  reason: string;
  correctionIntegrityHash: string;
  originalStatementDocumentId: string;
  originalStatementSourceIntegrityHash: string;
  originalStatementSha256: string;
  issuedAt: string;
  issuedBy: string;
  currency: string;
  versions: LockedApprovedPricingVersion[];
  priorEvents: PriorPricedAllocationEvent[];
  lines: StatementAdjustmentLineInput[];
  renderContext: {
    waybillNumber: string;
    customerName: string;
    projectOrDestination: string;
    vehiclePlate: string;
    templateVersion: string;
  };
}): CalculatedStatementAdjustment => {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new StatementAdjustmentInvariantError('INVALID_SEQUENCE', 'Statement adjustment sequence must be a positive integer.');
  }
  if (input.lines.length === 0) {
    throw new StatementAdjustmentInvariantError('EMPTY_ADJUSTMENT', 'Statement adjustment requires at least one affected stable row.');
  }
  const stableRows = input.lines.map((line) => `${line.contractId}:${line.contractItemId}:${line.productRowId}`);
  if (new Set(stableRows).size !== stableRows.length) {
    throw new StatementAdjustmentInvariantError('DUPLICATE_STABLE_ROW', 'Statement adjustment may contain each stable row only once.');
  }
  if (!input.reason.trim() || !input.originalStatementDocumentId.trim()
    || ![input.correctionIntegrityHash, input.originalStatementSourceIntegrityHash, input.originalStatementSha256]
      .every((value) => /^[0-9a-f]{64}$/.test(value))) {
    throw new StatementAdjustmentInvariantError('INVALID_SOURCE_EVIDENCE', 'Statement adjustment source evidence is incomplete or malformed.');
  }
  if (input.versions.some((version) => version.currency !== input.currency)) {
    throw new StatementAdjustmentInvariantError('CURRENCY_MISMATCH', 'Statement adjustment must reuse one original pricing currency.');
  }
  const labels = new Map(input.lines.map((line) => [line.correctionLineId, line.label]));
  const allocation = allocatePricedRevision({
    versions: input.versions,
    priorEvents: input.priorEvents,
    lines: input.lines.map((line) => ({
      allocationRevisionLineId: line.correctionLineId,
      contractId: line.contractId,
      contractItemId: line.contractItemId,
      productRowId: line.productRowId,
      unit: line.unit,
      quantity: line.quantity,
    })),
  });
  const lines: StatementAdjustmentSnapshotLine[] = allocation.events.map((event) => ({
    correctionLineId: event.allocationRevisionLineId,
    contractId: event.contractId,
    contractItemId: event.contractItemId,
    productRowId: event.productRowId,
    pricingVersionId: event.pricingVersionId,
    pricingRowId: event.pricingRowId,
    label: labels.get(event.allocationRevisionLineId) || event.productRowId,
    unit: event.unit,
    quantityDelta: event.quantity,
    grossAmountDelta: event.grossAmount,
    discountDelta: event.discountAmount,
    netAmountDelta: event.netAmount,
    afterQuantity: event.evidence.afterQuantity,
    ledgerSequence: event.ledgerSequence,
    consumesFinalRemainder: event.consumesFinalRemainder,
    evidence: event.evidence,
  }));
  const snapshot: StatementAdjustmentSnapshot = {
    schemaVersion: 1,
    adjustmentId: input.adjustmentId,
    waybillId: input.waybillId,
    correctionId: input.correctionId,
    sequence: input.sequence,
    reason: input.reason,
    correctionIntegrityHash: input.correctionIntegrityHash,
    originalStatementDocumentId: input.originalStatementDocumentId,
    originalStatementSourceIntegrityHash: input.originalStatementSourceIntegrityHash,
    originalStatementSha256: input.originalStatementSha256,
    currency: input.currency,
    issuedAt: input.issuedAt,
    issuedBy: input.issuedBy,
    pricingVersions: [...input.versions]
      .sort((left, right) => left.contractId.localeCompare(right.contractId))
      .map((version) => ({ contractId: version.contractId, pricingVersionId: version.id,
        integrityHash: version.integrityHash, readinessEvidenceHash: version.readinessEvidenceHash })),
    lines,
    quantityDeltasByUnit: allocation.totals.quantitiesByUnit,
    totals: {
      grossAmountDelta: allocation.totals.grossAmount,
      discountDelta: allocation.totals.discountAmount,
      netAmountDelta: allocation.totals.netAmount,
    },
  };
  return {
    snapshot,
    integrityHash: pricedAllocationIntegrityHash(snapshot),
    renderInput: {
      schemaVersion: 1,
      documentId: input.adjustmentId,
      waybillNumber: input.renderContext.waybillNumber,
      issuedAt: input.issuedAt,
      customerName: input.renderContext.customerName,
      projectOrDestination: input.renderContext.projectOrDestination,
      vehiclePlate: input.renderContext.vehiclePlate,
      templateVersion: input.renderContext.templateVersion,
      kind: 'STATEMENT_ADJUSTMENT',
      payload: {
        sequence: input.sequence,
        originalStatementDocumentId: input.originalStatementDocumentId,
        reason: input.reason,
        currency: input.currency,
        lines: lines.map((line) => ({
          contractId: line.contractId,
          contractItemId: line.contractItemId,
          productRowId: line.productRowId,
          label: line.label,
          unit: line.unit,
          quantityDelta: line.quantityDelta,
          grossAmountDelta: line.grossAmountDelta,
          discountDelta: line.discountDelta,
          netAmountDelta: line.netAmountDelta,
        })),
        ...snapshot.totals,
      },
    },
  };
};

export const statementAdjustmentPriorEvents = (persisted: {
  snapshot: StatementAdjustmentSnapshot;
  integrityHash: string;
}): PriorPricedAllocationEvent[] => {
  if (pricedAllocationIntegrityHash(persisted.snapshot) !== persisted.integrityHash) {
    throw new StatementAdjustmentInvariantError('INTEGRITY_MISMATCH', 'Statement adjustment evidence failed integrity verification.');
  }
  return persisted.snapshot.lines.map((line) => ({
    pricingRowId: line.pricingRowId,
    pricingVersionId: line.pricingVersionId,
    quantity: line.quantityDelta,
    grossAmount: line.grossAmountDelta,
    discountAmount: line.discountDelta,
    integrityVerified: true,
    ledgerSequence: line.ledgerSequence,
  }));
};
