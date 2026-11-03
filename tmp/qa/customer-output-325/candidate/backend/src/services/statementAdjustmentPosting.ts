import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { approvedPricingOperationalContractItemId, mapVerifiedApprovedPricingVersion, persistedApprovedPricingInclude } from './approvedPricing';
import type { PreparedStatementAdjustmentArtifact } from './dispatchDocuments';
import {
  pricedAllocationIntegrityHash,
  type PriorPricedAllocationEvent,
} from './pricedAllocationLedger';
import {
  calculateStatementAdjustment,
  statementAdjustmentPriorEvents,
  type CalculatedStatementAdjustment,
  type StatementAdjustmentSnapshot,
} from './statementAdjustment';
import type { ConfiguredStatementAdjustmentArtifactPreparer } from './statementAdjustmentRuntime';

type Tx = Prisma.TransactionClient;
const adjustmentPostingInclude = Prisma.validator<Prisma.DispatchCorrectionInclude>()({
  lines: true,
  waybill: { include: {
    documentArtifacts: { where: { kind: 'STATEMENT' }, orderBy: { publishedAt: 'asc' } },
    statementAdjustments: { select: { sequence: true }, orderBy: { sequence: 'desc' }, take: 1 },
    candidate: { include: { allocationRevision: { include: {
      queueTurn: true,
      lines: true,
      pricingReferences: { include: { pricingVersion: { include: persistedApprovedPricingInclude } }, orderBy: { contractId: 'asc' } },
    } } } },
  } },
});
type AdjustmentPostingCorrection = Prisma.DispatchCorrectionGetPayload<{ include: typeof adjustmentPostingInclude }>;
type AdjustmentPostingRevisionLine = AdjustmentPostingCorrection['waybill']['candidate']['allocationRevision']['lines'][number];

export type PlannedStatementAdjustment = {
  adjustmentId: string;
  artifactId: string;
  calculated: CalculatedStatementAdjustment;
  artifact: PreparedStatementAdjustmentArtifact;
  issuedAt: Date;
  issuedBy: string;
};

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const text = (value: unknown) => String(value || '').trim();

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

type ImmutableAdjustmentRenderContext = {
  waybillNumber: string;
  customerName: string;
  projectOrDestination: string;
  vehiclePlate: string;
  templateVersion: string;
};

const immutableText = (value: unknown, name: string) => {
  const result = text(value);
  if (!result) throw new Error(`Immutable adjustment render context is missing ${name}.`);
  return result;
};

const readImmutableAdjustmentRenderContext = (
  waybill: AdjustmentPostingCorrection['waybill'],
  templateVersion: string,
): ImmutableAdjustmentRenderContext => {
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
    customerName: immutableText(customer.name || customer.companyName, 'customer name'),
    projectOrDestination: immutableText(project.name || project.address, 'project or destination'),
    vehiclePlate: immutableText(plate.plate || vehicle.plate, 'vehicle plate'),
    templateVersion: immutableText(templateVersion, 'template version'),
  };
};

const lineLabel = (revisionLine: AdjustmentPostingRevisionLine) => {
  const snapshot = record(revisionLine.snapshot);
  return text(snapshot.productName || revisionLine.productRowId);
};

const validArtifact = (artifact: PreparedStatementAdjustmentArtifact, expectedTemplateVersion: string) =>
  Boolean(artifact.id.trim())
  && artifact.templateVersion === expectedTemplateVersion
  && Boolean(artifact.generatorVersion.trim())
  && Object.values(artifact.sourceVersionIdentities).length > 0
  && Object.values(artifact.sourceVersionIdentities).every((value) => Boolean(value.trim()))
  && artifact.mediaType === 'application/pdf'
  && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0
  && /^[0-9a-f]{64}$/.test(artifact.sha256)
  && Number.isFinite(new Date(artifact.publishedAt).getTime())
  && /^dispatch-documents\/[A-Za-z0-9_-]+\.pdf$/.test(artifact.storageKey);

export const planStatementAdjustment = async (tx: Tx, input: {
  correctionId: string;
  actorId: string;
  correctionIntegrityHash: string;
  issuedAt: Date;
  artifactPreparer?: ConfiguredStatementAdjustmentArtifactPreparer;
  id?: () => string;
}): Promise<PlannedStatementAdjustment | null> => {
  const correction = await tx.dispatchCorrection.findUnique({ where: { id: input.correctionId }, include: adjustmentPostingInclude });
  if (!correction) throw new Error('Dispatch correction was not found.');
  const originalStatement = correction.waybill.documentArtifacts[0];
  if (!originalStatement) return null;
  if (!input.artifactPreparer) throw new Error('Statement adjustment artifact publication is unavailable.');
  const references = correction.waybill.candidate.allocationRevision.pricingReferences;
  if (references.length === 0) throw new Error('Statement waybill has no immutable approved-pricing binding.');
  const versions = references.map((reference) => {
    if (reference.expectedPricingHash !== reference.pricingVersion.integrityHash) {
      throw new Error(`Approved pricing ${reference.pricingVersionId} differs from the frozen allocation binding.`);
    }
    return mapVerifiedApprovedPricingVersion(reference.pricingVersion, reference.readinessEvidenceHash);
  });
  const pricingRows = references.flatMap((reference) => reference.pricingVersion.rows);
  const pricingByItem = new Map(pricingRows.map((row) => [approvedPricingOperationalContractItemId(row), row]));
  const revisionByItem = new Map(correction.waybill.candidate.allocationRevision.lines
    .map((line) => [line.sourceContractItemId, line]));
  const pricingRowIds = new Set(pricingRows.map((row) => row.id));
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
      const pricingRow = pricingByItem.get(line.contractItemId);
      const revisionLine = revisionByItem.get(line.contractItemId);
      if (!pricingRow || !revisionLine || pricingRow.productRowId !== line.productRowId || pricingRow.unit !== line.unit
        || revisionLine.productRowId !== line.productRowId || revisionLine.unit !== line.unit) {
        throw new Error(`Correction line ${line.id} no longer matches the original frozen pricing row.`);
      }
      return { correctionLineId: line.id, contractId: line.contractId, contractItemId: line.contractItemId,
        productRowId: line.productRowId, label: lineLabel(revisionLine), unit: line.unit, quantity: line.quantity.toFixed(3) };
    }),
    renderContext: readImmutableAdjustmentRenderContext(correction.waybill, input.artifactPreparer.templateVersion),
  });
  const artifact = await input.artifactPreparer.preparer.prepare(calculated.renderInput);
  if (!validArtifact(artifact, calculated.renderInput.templateVersion)) {
    throw new Error('Statement adjustment artifact failed durable publication verification.');
  }
  return { adjustmentId: calculated.renderInput.documentId, artifactId: artifact.id, calculated, artifact,
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
    publishedAt: new Date(plan.artifact.publishedAt),
    publishedBy: plan.issuedBy,
  } });
  return { adjustment, artifact };
};
