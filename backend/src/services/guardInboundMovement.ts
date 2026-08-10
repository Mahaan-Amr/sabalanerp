import { Prisma, PrismaClient } from '@prisma/client';

export class GuardInboundMovementValidationError extends Error {}
export class GuardInboundMovementConflictError extends Error {}
export class GuardInboundMovementNotFoundError extends Error {}

export const guardInboundMovementInclude = {
  vehiclePair: true, loading: { include: { customer: true, project: true } },
  customer: true, project: true, attachments: true,
} as const;

const json = (value: unknown) => value == null ? undefined : value as Prisma.InputJsonValue;
const storedJson = (value: Prisma.JsonValue) => value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;

export const recordGuardInboundMovement = (prisma: PrismaClient, input: {
  purpose: 'OUTSIDE_PURCHASE' | 'SALES_RETURN'; loadingId?: string | null; customerId?: string | null;
  projectId?: string | null; occurredAt: Date; driverSnapshot?: unknown; documentSnapshot?: unknown;
  settlementSnapshot?: unknown; notes?: string | null; actorId: string;
}) => prisma.$transaction(async tx => {
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime()) || input.occurredAt > new Date()) {
    throw new GuardInboundMovementValidationError('Inbound movement cannot occur in the future.');
  }
  if (input.purpose === 'SALES_RETURN') {
    if (!input.loadingId || !input.customerId) throw new GuardInboundMovementValidationError('Sales return requires original loading and customer identities.');
    if (!await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, select: { id: true } })) {
      throw new GuardInboundMovementValidationError('Original dispatch loading was not found.');
    }
  }
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_INBOUND_NUMBER:${day.toISOString()}`);
  const count = await tx.securityVehicleMovement.count({ where: { createdAt: { gte: day, lt: nextDay } } });
  const datePart = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  return tx.securityVehicleMovement.create({ data: { movementNumber: `IN-${datePart}-${String(count + 1).padStart(4, '0')}`,
    direction: 'INBOUND', purpose: input.purpose, status: 'ENTRY_RECORDED', vehiclePairId: null,
    loadingId: input.purpose === 'SALES_RETURN' ? input.loadingId : null, customerId: input.customerId || null,
    projectId: input.projectId || null, occurredAt: input.occurredAt, driverSnapshot: json(input.driverSnapshot),
    documentSnapshot: json(input.documentSnapshot), settlementSnapshot: json(input.settlementSnapshot),
    notes: input.notes || null, createdBy: input.actorId }, include: guardInboundMovementInclude });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const completeGuardInboundMovement = (prisma: PrismaClient, input: { movementId: string;
  driverSnapshot?: unknown; documentSnapshot?: unknown; settlementSnapshot?: unknown; notes?: string | null;
}) => prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_INBOUND:${input.movementId}`);
  const movement = await tx.securityVehicleMovement.findUnique({ where: { id: input.movementId } });
  if (!movement) throw new GuardInboundMovementNotFoundError('Movement not found.');
  if (movement.direction !== 'INBOUND' || movement.purpose === 'CONSIGNMENT') throw new GuardInboundMovementValidationError('Only supported inbound movements can be completed here.');
  if (movement.status === 'INFO_COMPLETED') return tx.securityVehicleMovement.findUniqueOrThrow({ where: { id: movement.id }, include: guardInboundMovementInclude });
  if (movement.status !== 'ENTRY_RECORDED') throw new GuardInboundMovementConflictError('Inbound movement is not open for completion.');
  return tx.securityVehicleMovement.update({ where: { id: movement.id }, data: { status: 'INFO_COMPLETED', completedAt: new Date(),
    driverSnapshot: json(input.driverSnapshot) ?? storedJson(movement.driverSnapshot),
    documentSnapshot: json(input.documentSnapshot) ?? storedJson(movement.documentSnapshot),
    settlementSnapshot: json(input.settlementSnapshot) ?? storedJson(movement.settlementSnapshot),
    notes: input.notes ?? movement.notes }, include: guardInboundMovementInclude });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
