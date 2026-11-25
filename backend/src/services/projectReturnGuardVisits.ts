import { Prisma, type PrismaClient } from '@prisma/client';
import { assertCanonicalDispatchCommandAllowed } from './dispatchCutover';
import { appendQueueEvent, GuardQueueConflictError, GuardQueueValidationError, isGuardQueueTurnCurrentlyReady } from './guardDriverQueue';

type VisitCommand = { turnId: string; actorId: string };
type VisitReader = Prisma.TransactionClient | PrismaClient;

const visitSelect = {
  id: true,
  driverSource: true,
  status: true,
  projectReturnStatus: true,
  admittedAt: true,
  admissionSnapshot: true,
} as const;

export function presentProjectReturnVisit(turn: Prisma.GuardDriverQueueTurnGetPayload<{ select: typeof visitSelect }>) {
  const { id, driverSource, status, projectReturnStatus, admittedAt, admissionSnapshot } = turn;
  const snapshot = admissionSnapshot as {
    driver?: { firstName?: string; lastName?: string };
    vehicle?: { vehicleType?: string };
    plate?: { plate?: string };
  };
  return {
    id, driverSource, status, projectReturnStatus, admittedAt,
    driverName: [snapshot.driver?.firstName, snapshot.driver?.lastName].filter(Boolean).join(' '),
    vehicleType: snapshot.vehicle?.vehicleType || '',
    plate: snapshot.plate?.plate || '',
  };
}

export async function listProjectReturnVisits(db: VisitReader) {
  const visits = await db.guardDriverQueueTurn.findMany({
    where: {
      status: 'WAITING_AT_GATE',
      projectReturnReleasedAt: null,
      projectReturnStatus: { in: ['AWAITING_RECEIPT', 'CANCELLED_WITHOUT_DELIVERY'] },
    },
    select: visitSelect,
    orderBy: [{ admittedAt: 'asc' }, { id: 'asc' }],
  });
  return visits.map(presentProjectReturnVisit);
}

export async function lockProjectReturnVisit(tx: Prisma.TransactionClient, turnId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`GUARD_QUEUE:${turnId}`}))`;
  const turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: turnId } });
  if (!turn?.projectReturnStatus) throw new GuardQueueValidationError('ورود مرجوعی پیدا نشد.');
  return turn;
}

export function cancelProjectReturnVisit(db: PrismaClient, { turnId, actorId }: VisitCommand) {
  return db.$transaction(async tx => {
    const turn = await lockProjectReturnVisit(tx, turnId);
    if (turn.projectReturnStatus === 'CANCELLED_WITHOUT_DELIVERY') return presentProjectReturnVisit(turn);
    if (turn.projectReturnStatus !== 'AWAITING_RECEIPT' || turn.status !== 'WAITING_AT_GATE') {
      throw new GuardQueueConflictError('لغو بدون تحویل فقط برای مراجعهٔ در انتظار تحویل ممکن است.');
    }
    const updated = await tx.guardDriverQueueTurn.update({
      where: { id: turnId },
      data: { projectReturnStatus: 'CANCELLED_WITHOUT_DELIVERY' },
      select: visitSelect,
    });
    await appendQueueEvent(tx, {
      turnId, actorId, eventType: 'PROJECT_RETURN_CANCELLED_WITHOUT_DELIVERY',
      fromStatus: turn.status, toStatus: updated.status,
    });
    return presentProjectReturnVisit(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function releaseProjectReturnVisit(db: PrismaClient, { turnId, actorId, action }: VisitCommand & {
  action: 'transfer' | 'complete-personal';
}) {
  return db.$transaction(async tx => {
    const transfer = action === 'transfer';
    if (transfer) await assertCanonicalDispatchCommandAllowed(tx);
    const turn = await lockProjectReturnVisit(tx, turnId);
    if (transfer && turn.driverSource === 'PERSONAL_PICKUP') {
      throw new GuardQueueConflictError('اتمام مرجوعی خودروی شخصی را ثبت کنید.');
    }
    if (!transfer && turn.driverSource !== 'PERSONAL_PICKUP') {
      throw new GuardQueueConflictError('این اقدام برای مرجوعی خودروی شخصی است.');
    }
    if (turn.projectReturnReleasedAt) return turn;
    if (turn.status !== 'WAITING_AT_GATE' || turn.projectReturnStatus === 'AWAITING_RECEIPT') {
      throw new GuardQueueConflictError('ابتدا تحویل مرجوعی یا لغو بدون تحویل را ثبت کنید.');
    }
    const releasedAt = new Date();
    if (transfer && !await isGuardQueueTurnCurrentlyReady(tx, turn, releasedAt)) {
      throw new GuardQueueConflictError('راننده یا خودرو در حال حاضر شرایط بارگیری را ندارد.');
    }
    const updated = await tx.guardDriverQueueTurn.update({
      where: { id: turnId },
      data: {
        projectReturnReleasedAt: releasedAt,
        ...(transfer ? { status: 'AVAILABLE_FOR_LOADING', availableAt: releasedAt, availableBy: actorId } : {}),
      },
    });
    await appendQueueEvent(tx, {
      turnId, actorId, fromStatus: turn.status, toStatus: updated.status,
      eventType: transfer ? 'PROJECT_RETURN_TRANSFERRED_TO_LOADING' : 'PROJECT_RETURN_PERSONAL_COMPLETED',
      payload: { releasedAt, projectReturnStatus: turn.projectReturnStatus },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function recordProjectReturnExit(db: PrismaClient, { turnId, actorId }: VisitCommand) {
  return db.$transaction(async tx => {
    const turn = await lockProjectReturnVisit(tx, turnId);
    if (turn.projectReturnReleasedAt && turn.driverSource !== 'PERSONAL_PICKUP') {
      throw new GuardQueueConflictError('خروج این راننده از گردش بارگیری ثبت می‌شود.');
    }
    if (turn.status === 'EXIT_RECORDED') return turn;
    if (turn.status !== 'WAITING_AT_GATE' || turn.projectReturnStatus === 'AWAITING_RECEIPT') {
      throw new GuardQueueConflictError('خروج پس از پایان رسیدگی به مرجوعی امکان‌پذیر است.');
    }
    const exitedAt = new Date();
    const updated = await tx.guardDriverQueueTurn.update({
      where: { id: turnId },
      data: { status: 'EXIT_RECORDED', exitedAt, exitedBy: actorId },
    });
    await appendQueueEvent(tx, {
      turnId, actorId, eventType: 'PHYSICAL_EXIT_RECORDED', fromStatus: turn.status, toStatus: updated.status,
      payload: { purpose: 'PROJECT_RETURN', exitedAt },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Receipt finalization uses the same lock as cancellation and writes both records in one transaction.
export async function receiveProjectReturnVisit(tx: Prisma.TransactionClient, { turnId, actorId }: VisitCommand) {
  const turn = await lockProjectReturnVisit(tx, turnId);
  if (turn.projectReturnStatus !== 'AWAITING_RECEIPT' || turn.status !== 'WAITING_AT_GATE') {
    throw new GuardQueueConflictError('این مراجعه برای ثبت تحویل مرجوعی در دسترس نیست.');
  }
  await tx.guardDriverQueueTurn.update({ where: { id: turnId }, data: { projectReturnStatus: 'RECEIVED' } });
  await appendQueueEvent(tx, {
    turnId, actorId, eventType: 'PROJECT_RETURN_RECEIVED', fromStatus: turn.status, toStatus: turn.status,
  });
  return presentProjectReturnVisit({ ...turn, projectReturnStatus: 'RECEIVED' });
}
