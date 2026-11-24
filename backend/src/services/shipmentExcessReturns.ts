import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  EXCESS_SHIPMENT_RETURN_SOURCE,
  parseShipmentQuantityToScaledInteger,
  formatShipmentQuantity,
  excessShipmentReturnEvidenceFailure,
  type ShipmentQuantityEvidence,
} from './shipmentQuantityProjection';
import {
  ShipmentReturnConflictError,
  lockShipmentTruth,
  persistShipmentQuantityProjection,
  readPhysicalDispatchReturnHolding,
  readShipmentQuantityProjection,
  shipmentQuantityEvidenceIntegrityHash,
} from './shipmentQuantityProjectionStore';

export { ShipmentReturnConflictError, readPhysicalDispatchReturnHolding } from './shipmentQuantityProjectionStore';

type DispatchShare = Pick<ShipmentQuantityEvidence, 'contractId' | 'contractItemId' | 'productRowId' | 'unit' | 'quantity'> & {
  dispatchShareId: string;
  dispatchEvidenceId: string;
};

/** The caller owns the Serializable finalization transaction and its case-level idempotency. */
export const recordFinalizedExcessShipmentReturns = async (tx: Prisma.TransactionClient, input: {
  caseId: string;
  actorId: string;
  finalizedAt: Date;
  shares: readonly DispatchShare[];
}) => {
  const { caseId, actorId, finalizedAt, shares } = input;
  if (!caseId.trim() || !actorId.trim() || !Number.isFinite(finalizedAt.getTime()) || finalizedAt.getTime() > Date.now()
    || shares.length === 0 || new Set(shares.map(share => share.dispatchShareId.trim())).size !== shares.length) {
    throw new ShipmentReturnConflictError('مشخصات ثبت قطعی مرجوعی یا سهم‌های ارسال معتبر نیست.');
  }

  const dispatchIds = [...new Set(shares.map(share => share.dispatchEvidenceId))].sort();
  for (const id of dispatchIds) {
    // The Guard return verifier takes the same key before linking a movement.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `SHIPMENT_EVIDENCE:${id}`);
  }
  await lockShipmentTruth(tx, shares.map(share => share.contractItemId));
  const holdings = new Map(await Promise.all(dispatchIds.map(async id => [
    id, await readPhysicalDispatchReturnHolding(tx, id),
  ] as const)));
  const usedByDispatch = new Map<string, bigint>();
  const at = finalizedAt.toISOString();
  const events = shares.map((share) => {
    const { dispatchShareId, dispatchEvidenceId, quantity, ...identity } = share;
    const holding = holdings.get(dispatchEvidenceId)!;
    const { dispatch } = holding;
    if (identity.contractId !== dispatch.contractId || identity.contractItemId !== dispatch.contractItemId
      || identity.productRowId !== dispatch.productRowId || identity.unit !== dispatch.unit) {
      throw new ShipmentReturnConflictError('ردیف قرارداد یا واحد مرجوعی با شاهد ارسال هم‌خوان نیست.');
    }
    const returned = parseShipmentQuantityToScaledInteger(quantity);
    const used = (usedByDispatch.get(dispatchEvidenceId) || 0n) + returned;
    if (returned <= 0n || used > parseShipmentQuantityToScaledInteger(holding.remainingQuantity)) {
      throw new ShipmentReturnConflictError('مقدار مرجوعی از ماندهٔ قابل برگشت سند ارسال بیشتر است.');
    }
    usedByDispatch.set(dispatchEvidenceId, used);
    const item: ShipmentQuantityEvidence = {
      id: randomUUID(), ...identity, dispatchEvidenceId,
      kind: 'EXCESS_RETURN_FINALIZED', quantity: formatShipmentQuantity(returned),
      effectiveAt: at, recordedAt: at, sourceType: EXCESS_SHIPMENT_RETURN_SOURCE,
      sourceId: dispatchShareId, sourceVersion: 1, metadata: { actorId, returnCaseId: caseId }, integrityHash: '',
    };
    if (excessShipmentReturnEvidenceFailure(item, dispatch)) {
      throw new ShipmentReturnConflictError('زمان ثبت قطعی یا شناسه شاهد ارسال مرجوعی معتبر نیست.');
    }
    return item;
  });

  const contracts = [...new Set(shares.map(share => share.contractId))].sort();
  await tx.shipmentQuantityEvidence.createMany({ data: events.map(item => ({
    ...item, sourceKind: 'SALES_CONTRACT', metadata: item.metadata as Prisma.InputJsonValue,
    effectiveAt: finalizedAt, recordedAt: finalizedAt,
    integrityHash: shipmentQuantityEvidenceIntegrityHash(item),
  })) });
  for (const contractId of contracts) {
    const projection = await readShipmentQuantityProjection(tx, { contractId });
    for (const item of events.filter(event => event.contractId === contractId)) {
      const row = projection.rows.find(r => r.contractItemId === item.contractItemId
        && r.productRowId === item.productRowId && r.unit === item.unit);
      if (row?.health !== 'CURRENT' || !row.quantities?.excessRetired || !row.sourceEvidenceIds.includes(item.id)) {
        throw new ShipmentReturnConflictError('سابقهٔ ارسال و تعهد ردیف قرارداد برای قطعی‌سازی مرجوعی قابل تأیید نیست.');
      }
    }
    await persistShipmentQuantityProjection(tx, projection);
  }
  return events.map(({ id, sourceId }) => ({ evidenceId: id, dispatchShareId: sourceId }));
};
