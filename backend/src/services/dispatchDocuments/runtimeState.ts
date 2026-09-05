import type { Prisma } from '@prisma/client';
import {
  SHIPMENT_STATEMENT_OPERATIONS_ID,
  SHIPMENT_STATEMENT_OPERATIONS_LOCK,
  type ShipmentStatementCutoverState,
} from './featureGate';

export const loadShipmentStatementRuntimeStateUnderLock = async (
  tx: Prisma.TransactionClient,
): Promise<ShipmentStatementCutoverState | null> => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', SHIPMENT_STATEMENT_OPERATIONS_LOCK);
  const [cutover, control] = await Promise.all([
    tx.shipmentStatementCutover.findUnique({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID }, select: { enabled: true, cutoverAt: true },
    }),
    tx.shipmentStatementOperationsControl.findUnique({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID }, select: { paused: true },
    }),
  ]);
  return cutover ? { ...cutover, operationalPaused: control?.paused ?? true } : null;
};
