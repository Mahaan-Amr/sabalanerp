import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from './approvedPricing';
import type { StatementAdjustmentRenderInput } from './dispatchDocuments/contracts';
import {
  pricedAllocationIntegrityHash,
  type LockedApprovedPricingVersion,
  type PriorPricedAllocationEvent,
} from './pricedAllocationLedger';
import {
  calculateStatementAdjustment,
  statementAdjustmentPriorEvents,
  type CalculatedStatementAdjustment,
  type StatementAdjustmentSnapshot,
} from './statementAdjustment';

type Tx = Prisma.TransactionClient;

export interface StatementAdjustmentArtifactPreparer {
  templateVersion: string;
  prepare(input: StatementAdjustmentRenderInput): Promise<{
    storageKey: string;
    mediaType: 'application/pdf';
    byteLength: number;
    sha256: string;
  }>;
}

export type PlannedStatementAdjustment = {
  adjustmentId: string;
  artifactId: string;
  calculated: CalculatedStatementAdjustment;
  artifact: Awaited<ReturnType<StatementAdjustmentArtifactPreparer['prepare']>>;
  issuedAt: Date;
  issuedBy: string;
};

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const text = (value: unknown) => String(value || '').trim();

const rowIntegrityMatches = (version: any, row: any) => row.integrityHash === approvedPricingRowIntegrityHash({
  versionId: version.id,
  contractId: version.contractId,
  sourceFinancialRecordId: version.sourceFinancialRecordId,
  versionNumber: version.versionNumber,
  contractItemId: row.contractItemId,
  productRowId: row.productRowId,
  ordinal: row.ordinal,
  contractedQuantity: row.contractedQuantity.toFixed(3),
  unit: row.unit,
  canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
  discountEligible: row.discountEligible,
  componentEvidence: record(row.componentEvidence) as Readonly<Record<string, string>>,
});

const lockedVersion = (reference: any): LockedApprovedPricingVersion => {
  const version = reference.pricingVersion;
  const rows = [...version.rows].sort((left: any, right: any) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
  if (version.integrityHash !== reference.expectedPricingHash
    || rows.some((row: any) => !rowIntegrityMatches(version, row))
    || version.integrityHash !== approvedPricingVersionIntegrityHash({
      id: version.id,
      contractId: version.contractId,
      versionNumber: version.versionNumber,
      sourceFinancialRecordId: version.sourceFinancialRecordId,
      approvedAt: version.approvedAt,
      approvedBy: version.approvedBy,
      schemaVersion: version.schemaVersion,
      currency: version.currency,
      grossAmount: version.grossAmount.toFixed(12),
      discountAmount: version.discountAmount.toFixed(12),
      netAmount: version.netAmount.toFixed(12),
      sourceEvidence: record(version.sourceEvidence),
      rowHashes: rows.map((row: any) => row.integrityHash),
    })) {
    throw new Error(`Approved pricing ${version.id} failed immutable integrity verification.`);
  }
  return {
    id: version.id,
    contractId: version.contractId,
    versionNumber: version.versionNumber,
    sourceFinancialRecordId: version.sourceFinancialRecordId,
    approvedAt: version.approvedAt.toISOString(),
    approvedBy: version.approvedBy,
    schemaVersion: version.schemaVersion,
    currency: version.currency,
    grossAmount: version.grossAmount.toFixed(12),
    discountAmount: version.discountAmount.toFixed(12),
    netAmount: version.netAmount.toFixed(12),
    integrityHash: version.integrityHash,
    readinessEvidenceHash: reference.readinessEvidenceHash,
    rows: rows.map((row: any) => ({
      id: row.id,
      contractItemId: row.contractItemId,
      productRowId: row.productRowId,
      ordinal: row.ordinal,
      contractedQuantity: row.contractedQuantity.toFixed(3),
      unit: row.unit,
      canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
      discountEligible: row.discountEligible,
      componentEvidence: record(row.componentEvidence) as Readonly<Record<string, string>>,
      integrityHash: row.integrityHash,
    })),
  };
};

const originalPricedEvents = async (tx: Tx, pricingRowIds: string[]): Promise<PriorPricedAllocationEvent[]> => {
  const events = await tx.dispatchPricedAllocationEvent.findMany({
    where: { pricingRowId: { in: pricingRowIds } },
    orderBy: [{ pricingRowId: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
  });
  return events.map((event) => {
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
    return {
      pricingRowId: event.pricingRowId,
      pricingVersionId: event.pricingVersionId,
      quantity: payload.quantity,
      grossAmount: payload.grossAmount,
      discountAmount: payload.discountAmount,
      ledgerSequence,
      integrityVerified: Number.isSafeInteger(ledgerSequence) && ledgerSequence > 0
        && event.integrityHash === pricedAllocationIntegrityHash(payload),
    };
  });
};

const priorAdjustmentEvents = async (tx: Tx, pricingRowIds: Set<string>): Promise<PriorPricedAllocationEvent[]> => {
  const adjustments = await tx.dispatchStatementAdjustment.findMany({ orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] });
  return adjustments.flatMap((adjustment) => {
    const snapshot = adjustment.snapshot as unknown as StatementAdjustmentSnapshot;
    const relevant = snapshot?.schemaVersion === 1 && snapshot.lines?.some((line) => pricingRowIds.has(line.pricingRowId));
    if (!relevant) return [];
    return statementAdjustmentPriorEvents({ snapshot, integrityHash: adjustment.integrityHash })
      .filter((event) => pricingRowIds.has(event.pricingRowId));
  });
};

const renderContext = (waybill: any, templateVersion: string) => {
  const waybillSnapshot = record(waybill.snapshot);
  const allocationSnapshot = record(waybillSnapshot.allocationSnapshot || waybill.candidate.allocationRevision.snapshot);
  const loading = record(allocationSnapshot.loading);
  const customer = record(loading.customer);
  const project = record(loading.project);
  const queueTurn = record(allocationSnapshot.queueTurn);
  const admission = record(queueTurn.admissionSnapshot || waybill.candidate.allocationRevision.queueTurn.admissionSnapshot);
  const plate = record(admission.plate);
  const vehicle = record(admission.vehicle);
  return {
    waybillNumber: waybill.number.toString(),
    customerName: text(customer.name || customer.companyName),
    projectOrDestination: text(project.name || project.address),
    vehiclePlate: text(plate.plate || vehicle.plate),
    templateVersion,
  };
};

const lineLabel = (revisionLine: any) => {
  const snapshot = record(revisionLine.snapshot);
  return text(snapshot.productName || revisionLine.productRowId);
};

const validArtifact = (artifact: Awaited<ReturnType<StatementAdjustmentArtifactPreparer['prepare']>>) =>
  artifact.mediaType === 'application/pdf'
  && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0
  && /^[0-9a-f]{64}$/.test(artifact.sha256)
  && /^dispatch-documents\/[A-Za-z0-9_-]+\.pdf$/.test(artifact.storageKey);

export const planStatementAdjustment = async (tx: Tx, input: {
  correctionId: string;
  actorId: string;
  correctionIntegrityHash: string;
  issuedAt: Date;
  artifactPreparer?: StatementAdjustmentArtifactPreparer;
  id?: () => string;
}): Promise<PlannedStatementAdjustment | null> => {
  const correction = await tx.dispatchCorrection.findUnique({ where: { id: input.correctionId }, include: {
    lines: true,
    waybill: { include: {
      documentArtifacts: { where: { kind: 'STATEMENT' }, orderBy: { publishedAt: 'asc' } },
      statementAdjustments: { select: { sequence: true }, orderBy: { sequence: 'desc' }, take: 1 },
      candidate: { include: { allocationRevision: { include: {
        queueTurn: true,
        lines: true,
        pricingReferences: { include: { pricingVersion: { include: {
          rows: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
        } } }, orderBy: { contractId: 'asc' } },
      } } } },
    } },
  } });
  if (!correction) throw new Error('Dispatch correction was not found.');
  const originalStatement = correction.waybill.documentArtifacts[0];
  if (!originalStatement) return null;
  if (!input.artifactPreparer) throw new Error('Statement adjustment artifact publication is unavailable.');
  const references = correction.waybill.candidate.allocationRevision.pricingReferences;
  if (references.length === 0) throw new Error('Statement waybill has no immutable approved-pricing binding.');
  const versions = references.map(lockedVersion);
  const pricingRows = references.flatMap((reference: any) => reference.pricingVersion.rows);
  const pricingByItem = new Map(pricingRows.map((row: any) => [row.contractItemId, row]));
  const revisionByItem = new Map(correction.waybill.candidate.allocationRevision.lines
    .map((line: any) => [line.sourceContractItemId, line]));
  const pricingRowIds = new Set(pricingRows.map((row: any) => row.id as string));
  const priorEvents = [
    ...await originalPricedEvents(tx, [...pricingRowIds]),
    ...await priorAdjustmentEvents(tx, pricingRowIds),
  ];
  const id = input.id || randomUUID;
  const sequence = (correction.waybill.statementAdjustments[0]?.sequence || 0) + 1;
  const calculated = calculateStatementAdjustment({
    adjustmentId: id(),
    waybillId: correction.waybillId,
    correctionId: correction.id,
    sequence,
    reason: correction.reason,
    correctionIntegrityHash: input.correctionIntegrityHash,
    originalStatementDocumentId: originalStatement.id,
    originalStatementSourceIntegrityHash: originalStatement.sourceIntegrityHash,
    originalStatementSha256: originalStatement.sha256,
    issuedAt: input.issuedAt.toISOString(),
    issuedBy: input.actorId,
    currency: versions[0].currency,
    versions,
    priorEvents,
    lines: correction.lines.map((line) => {
      const pricingRow = pricingByItem.get(line.contractItemId) as any;
      const revisionLine = revisionByItem.get(line.contractItemId) as any;
      if (!pricingRow || !revisionLine || pricingRow.productRowId !== line.productRowId || pricingRow.unit !== line.unit
        || revisionLine.productRowId !== line.productRowId || revisionLine.unit !== line.unit) {
        throw new Error(`Correction line ${line.id} no longer matches the original frozen pricing row.`);
      }
      return { correctionLineId: line.id, contractId: line.contractId, contractItemId: line.contractItemId,
        productRowId: line.productRowId, label: lineLabel(revisionLine), unit: line.unit, quantity: line.quantity.toFixed(3) };
    }),
    renderContext: renderContext(correction.waybill, input.artifactPreparer.templateVersion),
  });
  const artifact = await input.artifactPreparer.prepare(calculated.renderInput);
  if (!validArtifact(artifact)) throw new Error('Statement adjustment artifact failed durable publication verification.');
  return { adjustmentId: calculated.renderInput.documentId, artifactId: id(), calculated, artifact,
    issuedAt: input.issuedAt, issuedBy: input.actorId };
};

export const persistStatementAdjustment = async (tx: Tx, plan: PlannedStatementAdjustment) => {
  const adjustment = await tx.dispatchStatementAdjustment.create({ data: {
    id: plan.adjustmentId,
    waybillId: plan.calculated.snapshot.waybillId,
    correctionId: plan.calculated.snapshot.correctionId,
    sequence: plan.calculated.snapshot.sequence,
    snapshot: json(plan.calculated.snapshot),
    integrityHash: plan.calculated.integrityHash,
    issuedAt: plan.issuedAt,
    issuedBy: plan.issuedBy,
  } });
  const artifact = await tx.dispatchDocumentArtifact.create({ data: {
    id: plan.artifactId,
    waybillId: plan.calculated.snapshot.waybillId,
    kind: 'STATEMENT_ADJUSTMENT',
    statementAdjustmentId: adjustment.id,
    templateVersion: plan.calculated.renderInput.templateVersion,
    storageKey: plan.artifact.storageKey,
    mediaType: plan.artifact.mediaType,
    byteLength: BigInt(plan.artifact.byteLength),
    sha256: plan.artifact.sha256,
    sourceIntegrityHash: plan.calculated.integrityHash,
    publishedAt: plan.issuedAt,
    publishedBy: plan.issuedBy,
  } });
  return { adjustment, artifact };
};
