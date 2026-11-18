import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { assertCanonicalDispatchCommandAllowed } from './dispatchCutover';
import { appendQueueEvent, GuardQueueConflictError, GuardQueueValidationError } from './guardDriverQueue';
import { preparePartnerLoadingQueueChange } from './partnerSales/fulfillment/loadingQueue';
import { PartnerLoadingCommandError } from './partnerSales/fulfillment/loadingAuthority';

/** A loading-owned transport slot, not evidence of physical Guard admission. */
export async function selectLoadingTransport(db: PrismaClient, input: {
  loadingId: string; actorId: string; mode: 'PERSONAL' | 'DRIVERS'; expected?: RevisionRef; correlationId?: string;
}) {
  if (!['PERSONAL', 'DRIVERS'].includes(input.mode)) throw new GuardQueueValidationError('نوع بارگیری معتبر نیست.');
  const outcome = await db.$transaction(async tx => {
    const selectingPersonal = input.mode === 'PERSONAL';
    const source = await preparePartnerLoadingQueueChange(tx, {
      ...input,
      reason: selectingPersonal ? 'انتخاب راننده شخصی برای بارگیری' : 'برگشت از بارگیری با راننده شخصی',
    }, selectingPersonal ? 'RESERVE' : 'RELEASE');
    if (!source.ok) return { partnerFailure: source.error };
    await assertCanonicalDispatchCommandAllowed(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LOGISTICS_LOADING:${input.loadingId}`}))`;
    const loading = await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, include: {
      guardQueueTurns: { where: { status: 'RESERVED_FOR_LOADING' } },
    } });
    if (!loading) throw new GuardQueueValidationError('بارگیری پیدا نشد.');
    if (loading.status !== 'DRAFT') throw new GuardQueueConflictError('فقط نوع بارگیری پیش‌نویس قابل تغییر است.');
    const personal = loading.guardQueueTurns.find(turn => turn.driverSource === 'PERSONAL_PICKUP');
    if (input.mode === 'PERSONAL' && personal && loading.guardQueueTurns.length === 1) return { turn: personal };
    if (input.mode === 'DRIVERS' && !personal) return { turn: null };
    await tx.logisticsAllocationDraft.deleteMany({ where: { loadingId: loading.id } });
    await tx.logisticsLoadingLine.updateMany({ where: { loadingId: loading.id }, data: { quantity: 0, khatRas: null, pieceCount: null, plus: 0, minus: 0, calculationSnapshot: Prisma.DbNull } });
    const at = new Date();
    for (const turn of loading.guardQueueTurns) {
      const isPersonal = turn.driverSource === 'PERSONAL_PICKUP';
      const updated = await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: isPersonal ? {
        status: 'CLOSED_WITHOUT_LOADING', closedAt: at, closedBy: input.actorId, closureReason: 'تغییر نوع بارگیری',
      } : { status: 'AVAILABLE_FOR_LOADING', loadingId: null, reservedAt: null, reservedBy: null } });
      await appendQueueEvent(tx, { turnId: turn.id, eventType: isPersonal ? 'CLOSED_WITHOUT_LOADING' : 'RESERVATION_RELEASED',
        fromStatus: turn.status, toStatus: updated.status, actorId: input.actorId, reason: 'تغییر نوع بارگیری', payload: { loadingId: loading.id } });
    }
    if (input.mode === 'DRIVERS') return { turn: null };
    const id = randomUUID();
    const snapshot = { kind: 'PERSONAL_PICKUP_SELECTION', schemaVersion: 1, loadingId: loading.id,
      customerId: loading.customerId, selectedAt: at.toISOString(), selectedBy: input.actorId,
      driver: { source: 'PERSONAL_PICKUP', firstName: 'راننده شخصی', lastName: '' }, vehicle: { vehicleType: 'سواری' } };
    const turn = await tx.guardDriverQueueTurn.create({ data: { id, driverSource: 'PERSONAL_PICKUP',
      status: 'RESERVED_FOR_LOADING', loadingId: loading.id, reservedAt: at, reservedBy: input.actorId,
      admittedBy: input.actorId, admissionSnapshot: snapshot,
      integrityHash: createHash('sha256').update(JSON.stringify({ id, ...snapshot })).digest('hex') } });
    await appendQueueEvent(tx, { turnId: turn.id, eventType: 'PERSONAL_PICKUP_SELECTED', fromStatus: null,
      toStatus: turn.status, actorId: input.actorId, payload: { loadingId: loading.id, kind: snapshot.kind } });
    return { turn };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 });
  if ('partnerFailure' in outcome && outcome.partnerFailure) throw new PartnerLoadingCommandError(outcome.partnerFailure);
  return outcome;
}

/** Preserve personal selection history when the draft is discarded. */
export async function retirePersonalLoadingDraft(tx: Prisma.TransactionClient, loadingId: string, actorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LOGISTICS_LOADING:${loadingId}`}))`;
  const loading = await tx.logisticsLoading.findUniqueOrThrow({ where: { id: loadingId }, include: { guardQueueTurns: true } });
  if (!loading.guardQueueTurns.some(turn => turn.driverSource === 'PERSONAL_PICKUP')) return false;
  if (loading.status !== 'DRAFT') throw new GuardQueueConflictError('فقط پیش‌نویس بارگیری قابل حذف است.');
  await tx.logisticsAllocationDraft.deleteMany({ where: { loadingId } });
  const at = new Date();
  for (const turn of loading.guardQueueTurns.filter(turn => turn.status === 'RESERVED_FOR_LOADING')) {
    const personal = turn.driverSource === 'PERSONAL_PICKUP';
    const updated = await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: personal
      ? { status: 'CLOSED_WITHOUT_LOADING', closedAt: at, closedBy: actorId, closureReason: 'حذف پیش‌نویس بارگیری' }
      : { status: 'AVAILABLE_FOR_LOADING', loadingId: null, reservedAt: null, reservedBy: null } });
    await appendQueueEvent(tx, { turnId: turn.id, eventType: personal ? 'CLOSED_WITHOUT_LOADING' : 'RESERVATION_RELEASED',
      fromStatus: turn.status, toStatus: updated.status, actorId, reason: 'حذف پیش‌نویس بارگیری', payload: { loadingId } });
  }
  await tx.logisticsLoading.update({ where: { id: loadingId }, data: { status: 'CANCELLED', cancelledAt: at,
    cancelledBy: actorId, cancellationReason: 'حذف پیش‌نویس بارگیری' } });
  return true;
}

/** Resolve only the contracts/cases of positive saved allocation rows, never a customer's contract list. */
export async function personalPickupDisplayContext(tx: Prisma.TransactionClient, lines: Array<{
  sourceContractId?: string | null; partnerCaseId?: string | null;
}>) {
  const contractIds = [...new Set(lines.flatMap(line => line.sourceContractId ? [line.sourceContractId] : []))];
  const contracts = contractIds.length ? await tx.salesContract.findMany({ where: { id: { in: contractIds } },
    select: { id: true, contractNumber: true, partnerCaseId: true } }) : [];
  const caseIds = [...new Set([...lines.flatMap(line => line.partnerCaseId ? [line.partnerCaseId] : []),
    ...contracts.flatMap(contract => contract.partnerCaseId ? [contract.partnerCaseId] : [])])];
  const cases = caseIds.length ? await tx.partnerSaleCase.findMany({ where: { id: { in: caseIds } }, select: {
    id: true, customerContract: { select: { id: true, contractNumber: true } },
    profile: { select: { user: { select: { firstName: true, lastName: true } } } },
  } }) : [];
  return {
    contracts: [...new Map([...contracts, ...cases.flatMap(row => row.customerContract ? [row.customerContract] : [])]
      .map(row => [row.id, { id: row.id, number: row.contractNumber }])).values()],
    partners: cases.map(row => ({ caseId: row.id, name: [row.profile.user.firstName, row.profile.user.lastName].filter(Boolean).join(' ') })),
  };
}
