import type { Prisma, ShipmentQuantityEvidence } from '@prisma/client';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { exactQuantityText } from './exactQuantity';
import { mapPersistedEvidence, shipmentQuantityEvidenceHashMatches } from './shipmentQuantityProjectionStore';

type Tx = Prisma.TransactionClient;

export type ProjectReturnContractSource = {
  projectId: string; contractId: string; contractItemId: string; productRowId: string | null; dispatchEvidenceId?: string;
};

export const stoneReturnEvidenceRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function validDispatchAllocation(line: {
  revisionId: string; sourceContractId: string | null; sourceContractItemId: string | null;
  productRowId: string; productId: string | null; quantity: Prisma.Decimal; unit: string;
  snapshot: Prisma.JsonValue; integrityHash: string;
}, frozenLines: ReadonlySet<string>) {
  const payload = {
    contractId: line.sourceContractId, contractItemId: line.sourceContractItemId, productRowId: line.productRowId,
    productId: line.productId, quantity: exactQuantityText(line.quantity), unit: line.unit, snapshot: line.snapshot,
  };
  return frozenLines.has(hashAccountingEvidence(payload))
    && hashAccountingEvidence({ revisionId: line.revisionId, ...payload }) === line.integrityHash;
}

function dispatchLocator(dispatch: ShipmentQuantityEvidence) {
  const metadata = stoneReturnEvidenceRecord(dispatch.metadata);
  if (dispatch.kind === 'PHYSICAL_EXIT' && dispatch.sourceType === 'GUARD_PHYSICAL_EXIT' && typeof metadata.physicalExitId === 'string') {
    return { kind: 'guard' as const, id: metadata.physicalExitId };
  }
  if (dispatch.kind === 'MANUAL_OUTAGE_EXIT' && dispatch.sourceType === 'MANUAL_OUTAGE_EXIT' && typeof metadata.manualOutageExitId === 'string') {
    return { kind: 'outage' as const, id: metadata.manualOutageExitId };
  }
  return null;
}

export function claimsFrozenProjectDispatch(dispatch: ShipmentQuantityEvidence) {
  const metadata = stoneReturnEvidenceRecord(dispatch.metadata);
  return 'physicalExitId' in metadata || 'manualOutageExitId' in metadata || 'allocationRevisionId' in metadata;
}

export async function readVerifiedProjectDispatch(tx: Tx, dispatch: ShipmentQuantityEvidence, customerId: string, productId: string) {
  if (dispatch.sourceKind !== 'SALES_CONTRACT' || dispatch.sourceVersion !== 1 || !dispatch.contractId || !dispatch.contractItemId
    || !dispatch.quantity.gt(0) || !shipmentQuantityEvidenceHashMatches(mapPersistedEvidence(dispatch))) return null;
  const locator = dispatchLocator(dispatch);
  if (!locator) return null;
  const exit = locator.kind === 'guard'
    ? await tx.guardPhysicalExit.findUnique({
      where: { id: locator.id }, include: { allocationRevision: { include: { lines: true } } },
    }).then(row => row && ({ ...row, revision: row.allocationRevision }))
    : await tx.manualOutageExit.findUnique({
      where: { id: locator.id },
      include: { waybill: { include: { candidate: { include: { allocationRevision: { include: { lines: true } } } } } } },
    }).then(row => row?.status === 'REGISTERED' && row.integrityHash && row.recordedAt ? ({
      ...row, occurredAt: row.actualOccurredAt, revision: row.waybill.candidate.allocationRevision,
    }) : null);
  if (!exit) return null;

  const metadata = stoneReturnEvidenceRecord(dispatch.metadata);
  const { revision } = exit;
  const snapshot = stoneReturnEvidenceRecord(exit.snapshot);
  const revisionSnapshot = stoneReturnEvidenceRecord(revision.snapshot);
  const loading = stoneReturnEvidenceRecord(revisionSnapshot.loading);
  const project = stoneReturnEvidenceRecord(loading.project);
  const line = revision.lines.find(item => dispatch.sourceId === `${exit.id}:${item.id}`);
  const frozenLines = new Set((Array.isArray(revisionSnapshot.lines) ? revisionSnapshot.lines : []).map(hashAccountingEvidence));
  if (!line || (locator.kind === 'guard' && metadata.allocationLineId !== line.id)
    || line.sourceKind !== 'SALES_CONTRACT' || line.revisionId !== revision.id || line.sourceContractId !== dispatch.contractId
    || line.sourceContractItemId !== dispatch.contractItemId || line.productRowId !== dispatch.productRowId
    || line.productId !== productId || line.unit !== dispatch.unit || !line.quantity.eq(dispatch.quantity)
    || !validDispatchAllocation(line, frozenLines)
    || !revision.sealedAt || revision.sourceKind !== 'SALES_CONTRACT'
    || dispatch.effectiveAt.getTime() !== exit.occurredAt.getTime() || dispatch.recordedAt.getTime() !== exit.recordedAt?.getTime()
    || metadata.waybillId !== exit.waybillId || snapshot.waybillId !== exit.waybillId || snapshot.queueTurnId !== revision.queueTurnId
    || snapshot.allocationRevisionId !== revision.id || snapshot.allocationIntegrityHash !== revision.integrityHash
    || metadata.allocationRevisionId !== revision.id || metadata.loadingId !== revision.loadingId
    || loading.id !== revision.loadingId || stoneReturnEvidenceRecord(loading.customer).id !== customerId
    || typeof project.id !== 'string' || hashAccountingEvidence(exit.snapshot) !== exit.integrityHash
    || hashAccountingEvidence(revision.snapshot) !== revision.integrityHash) return null;

  const owned = await tx.projectAddress.findFirst({ where: { id: project.id, customerId }, select: { id: true } });
  return owned ? {
    projectId: owned.id,
    projectName: typeof project.name === 'string' && project.name ? project.name : typeof project.address === 'string' ? project.address : owned.id,
    contractId: dispatch.contractId, contractItemId: dispatch.contractItemId,
    productRowId: dispatch.productRowId, dispatchEvidenceId: dispatch.id,
  } : null;
}
