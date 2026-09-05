import { createHash } from 'node:crypto';
import { Prisma, PrismaClient, ShipmentStatementOperationsAction } from '@prisma/client';
import {
  isCustomerShipmentStatementsEnabled,
  SHIPMENT_STATEMENT_OPERATIONS_ID,
  SHIPMENT_STATEMENT_OPERATIONS_LOCK,
} from './dispatchDocuments/featureGate';

export type ShipmentStatementOperationsTransition = Readonly<{
  action: ShipmentStatementOperationsAction;
  actorId: string;
  reason: string;
  expectedRevision: number;
}>;

export class ShipmentStatementOperationsError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
  }
}

export const evaluateShipmentStatementDeploymentState = (input: {
  cutoverEnabled: boolean;
  cutoverAt: Date | null;
  environmentEnabled: boolean;
  paused: boolean;
  incident: boolean;
}) => {
  if (!input.cutoverEnabled || !input.cutoverAt) {
    if (input.environmentEnabled) {
      throw new ShipmentStatementOperationsError('ENVIRONMENT_GATE_PRECEDES_CUTOVER', 'Environment gate cannot precede signed database cutover.');
    }
    return { cutoverEnabled: false, environmentEnabled: false, operationalState: 'PRE_CUTOVER_PAUSED' as const };
  }
  if (!input.environmentEnabled || input.paused || input.incident) {
    throw new ShipmentStatementOperationsError(
      'POST_CUTOVER_RUNTIME_NOT_ACTIVE',
      'Post-cutover deployment cannot open traffic unless environment and operations gates are active.',
    );
  }
  return { cutoverEnabled: true, environmentEnabled: true, operationalState: 'ACTIVE' as const };
};

export const verifyShipmentStatementDeploymentState = async (
  client: PrismaClient,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => {
  const [cutover, control] = await Promise.all([
    client.shipmentStatementCutover.findUnique({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID }, select: { enabled: true, cutoverAt: true },
    }),
    client.shipmentStatementOperationsControl.findUniqueOrThrow({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID }, select: { paused: true, incident: true, revision: true },
    }),
  ]);
  return {
    ...evaluateShipmentStatementDeploymentState({
      cutoverEnabled: cutover?.enabled === true,
      cutoverAt: cutover?.cutoverAt ?? null,
      environmentEnabled: isCustomerShipmentStatementsEnabled(environment),
      paused: control.paused,
      incident: control.incident,
    }),
    controlRevision: control.revision,
    cutoverAt: cutover?.cutoverAt?.toISOString() ?? null,
  };
};

const normalizedReason = (reason: string) => {
  const value = String(reason || '').trim();
  if (value.length < 8 || value.length > 500) {
    throw new ShipmentStatementOperationsError('INVALID_REASON', 'Reason must contain between 8 and 500 characters.', 400);
  }
  return value;
};

export const resolveShipmentStatementOperationsTarget = (input: {
  action: ShipmentStatementOperationsAction;
  paused: boolean;
  incident: boolean;
  cutoverEnabled: boolean;
  cutoverAt: Date | null;
  environmentEnabled: boolean;
}) => {
  if (input.action === 'RESUME') {
    if (!input.paused) throw new ShipmentStatementOperationsError('ALREADY_RUNNING', 'Shipment statements are already running.');
    if (!input.cutoverEnabled || !input.cutoverAt || !input.environmentEnabled) {
      throw new ShipmentStatementOperationsError(
        'SHIPMENT_STATEMENTS_NOT_ACTIVATED',
        'The signed cutover and environment gates must both be active before shipment statements can start.',
      );
    }
    return { paused: false, incident: false };
  }
  if (input.action === 'PAUSE_PLANNED') {
    if (input.paused) throw new ShipmentStatementOperationsError('ALREADY_PAUSED', 'Shipment statements are already paused.');
    return { paused: true, incident: false };
  }
  if (input.action === 'PAUSE_INCIDENT') return { paused: true, incident: true };
  throw new ShipmentStatementOperationsError('INVALID_ACTION', 'Unsupported shipment statement operation.', 400);
};

const integrityHash = (payload: object) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const serializeControl = (control: {
  paused: boolean; incident: boolean; revision: number; changedAt: Date; changedBy: string | null; reason: string;
}) => ({ ...control, changedAt: control.changedAt.toISOString() });

const persistTransitionUnderLock = async (
  tx: Prisma.TransactionClient,
  input: ShipmentStatementOperationsTransition,
  current: { revision: number },
  target: { paused: boolean; incident: boolean },
  previousIntegrityHash: string | null,
) => {
  const reason = normalizedReason(input.reason);
  const revision = current.revision + 1;
  const createdAt = new Date();
  const eventPayload = {
    revision, action: input.action, paused: target.paused, incident: target.incident,
    actorId: input.actorId, reason, previousIntegrityHash, createdAt: createdAt.toISOString(),
  };
  const event = await tx.shipmentStatementOperationsEvent.create({
    data: { ...eventPayload, createdAt, integrityHash: integrityHash(eventPayload) },
  });
  const update = await tx.shipmentStatementOperationsControl.updateMany({
    where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID, revision: current.revision },
    data: { ...target, revision, changedAt: createdAt, changedBy: input.actorId, reason },
  });
  if (update.count !== 1) {
    throw new ShipmentStatementOperationsError('STALE_CONTROL_REVISION', 'The control changed. Refresh before trying again.');
  }
  const updated = await tx.shipmentStatementOperationsControl.findUniqueOrThrow({ where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID } });
  return { control: serializeControl(updated), event: { ...event, createdAt: event.createdAt.toISOString() } };
};

export const startShipmentStatementOperationsForSignedCutoverUnderLock = async (
  tx: Prisma.TransactionClient,
  input: { actorId: string; cutoverIntegrityHash: string },
) => {
  const [control, previousEvent] = await Promise.all([
    tx.shipmentStatementOperationsControl.findUniqueOrThrow({ where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID } }),
    tx.shipmentStatementOperationsEvent.findFirst({ orderBy: { revision: 'desc' }, select: { integrityHash: true } }),
  ]);
  if (!control.paused || control.incident) {
    throw new ShipmentStatementOperationsError('INVALID_CUTOVER_CONTROL_STATE', 'Signed cutover requires the initial safely paused control state.');
  }
  return persistTransitionUnderLock(tx, {
    action: 'RESUME', actorId: input.actorId, expectedRevision: control.revision,
    reason: `Started atomically by signed cutover ${input.cutoverIntegrityHash}.`,
  }, control, { paused: false, incident: false }, previousEvent?.integrityHash ?? null);
};

export const getShipmentStatementOperations = async (
  client: PrismaClient,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => {
  const [control, cutover, events, totalContracts, readinessRows] = await Promise.all([
    client.shipmentStatementOperationsControl.findUniqueOrThrow({ where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID } }),
    client.shipmentStatementCutover.findUnique({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID },
      select: { enabled: true, cutoverAt: true, activatedAt: true, activatedBy: true },
    }),
    client.shipmentStatementOperationsEvent.findMany({ orderBy: { revision: 'desc' }, take: 20 }),
    client.salesContract.count(),
    client.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
      SELECT latest."status"::text AS "status", COUNT(*)::bigint AS "count"
      FROM (
        SELECT DISTINCT ON (result."contractId") result."contractId", result."status"
        FROM "contract_pricing_readiness_results" result
        ORDER BY result."contractId", result."evaluatedAt" DESC, result."id" DESC
      ) latest
      GROUP BY latest."status"
      ORDER BY latest."status"
    `),
  ]);
  const readinessCounts = Object.fromEntries(readinessRows.map((row) => [row.status, Number(row.count)]));
  const environmentEnabled = isCustomerShipmentStatementsEnabled(environment);
  return {
    control: serializeControl(control),
    cutover: cutover ? {
      ...cutover,
      cutoverAt: cutover.cutoverAt?.toISOString() ?? null,
      activatedAt: cutover.activatedAt?.toISOString() ?? null,
    } : null,
    environmentEnabled,
    effectiveActive: Boolean(environmentEnabled && cutover?.enabled && cutover.cutoverAt && !control.paused),
    live: { totalContracts, readinessCounts, evaluatedContracts: Object.values(readinessCounts).reduce((sum, count) => sum + count, 0) },
    events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
};

export const transitionShipmentStatementOperations = async (
  client: PrismaClient,
  input: ShipmentStatementOperationsTransition,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => {
  normalizedReason(input.reason);
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', SHIPMENT_STATEMENT_OPERATIONS_LOCK);
    const [control, cutover, previousEvent] = await Promise.all([
      tx.shipmentStatementOperationsControl.findUniqueOrThrow({ where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID } }),
      tx.shipmentStatementCutover.findUnique({
        where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID }, select: { enabled: true, cutoverAt: true },
      }),
      tx.shipmentStatementOperationsEvent.findFirst({ orderBy: { revision: 'desc' }, select: { integrityHash: true } }),
    ]);
    if (control.revision !== input.expectedRevision) {
      throw new ShipmentStatementOperationsError('STALE_CONTROL_REVISION', 'The control changed. Refresh before trying again.');
    }
    const target = resolveShipmentStatementOperationsTarget({
      action: input.action,
      paused: control.paused,
      incident: control.incident,
      cutoverEnabled: cutover?.enabled === true,
      cutoverAt: cutover?.cutoverAt ?? null,
      environmentEnabled: isCustomerShipmentStatementsEnabled(environment),
    });
    return persistTransitionUnderLock(tx, input, control, target, previousEvent?.integrityHash ?? null);
  // The advisory transaction lock is the serialization boundary. READ COMMITTED ensures a waiter
  // takes its database snapshot after the in-flight finalization releases that lock; SERIALIZABLE
  // can snapshot before waiting and abort the operation it is meant to drain as a false conflict.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
};
