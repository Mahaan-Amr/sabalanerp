import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PartnerEventSchema, canonicalHash, checkExpectedRevision, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { lockPartnerCommercialContract, partnerDeadlinePassed, resetPartnerCommercialApprovals } from './commercialLifecycle';
import { readPartnerCommercialEditPermission } from './commercialEditPermission';
import { decodeTechnicalRecovery } from './technicalRecoveryRecords';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function reactivatePartnerCase(tx: Prisma.TransactionClient, input: {
  caseId: string; actorId: string; expected: RevisionRef; expectedState: string;
  commercialRevision: number; commandId: string; reason: string;
}) {
  await lockPartnerOperationsControl(tx);
  const { root, contract } = await lockPartnerCommercialContract(tx, input.caseId);
  const authority = await createAuditedPartnerAuthorization(tx,
    { actorId: input.actorId, purpose: 'PARTNER', channel: 'API' },
    { correlationId: input.commandId, reason: input.reason }).authorize('CASE_CANCEL', { kind: 'CASE', id: root.id });
  const rollout = await authorizePartnerTechnicalRollout(tx, root.profileId, 'MUTATE');
  if (!authority.ok || !rollout.ok || root.profile.userId !== input.actorId) throw new Error('فعال‌سازی این پرونده برای شما مجاز نیست.');
  const identity = { actorId: input.actorId, operation: 'CASE_REACTIVATE', targetScope: root.id, key: input.commandId };
  const payloadHash = await canonicalHash(input);
  const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw new Error('شناسه فعال‌سازی با اطلاعات دیگری استفاده شده است.');
    return prior.outcome;
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  if (!['CANCELLED', 'VOIDED'].includes(root.state) || root.state !== input.expectedState || contract.status !== 'CANCELLED'
    || contract.commercialRevision !== input.commercialRevision || checkExpectedRevision(input.expected,
      { caseId: root.id, revision: root.headRevision, integrityHash: root.integrityHash })) throw new Error('وضعیت پرونده تغییر کرده است؛ صفحه را تازه کنید.');
  if (partnerDeadlinePassed(contract, clock.now)) throw new Error('مهلت قرارداد پایان یافته است؛ ابتدا تمدید مجاز فروش لازم است.');
  const cancellation = await tx.partnerCaseEvent.findFirst({ where: { caseId: root.id,
    type: root.state === 'VOIDED' ? 'CASE_VOIDED' : 'CASE_CANCELLED' }, orderBy: { sequence: 'desc' } });
  const cancellationFact = PartnerEventSchema.safeParse((cancellation?.evidence as { publicEvent?: unknown } | null)?.publicEvent);
  if (!cancellation || !cancellationFact.success || contract.isInactive && (root.state !== 'VOIDED'
    || contract.inactiveReason !== cancellation.reason || contract.inactiveAt?.getTime() !== new Date(cancellationFact.data.recordedAt).getTime())) {
    throw new Error('غیرفعال‌سازی اداری یا سابقه لغو نیاز به بررسی حسابداری دارد.');
  }
  const permission = root.committedAt ? await readPartnerCommercialEditPermission(tx, contract.id, input.actorId, clock.now) : null;
  if (root.committedAt && !permission) throw new Error('فعال‌سازی قرارداد قبلاً قطعی‌شده به مجوز تازه مدیر حسابداری نیاز دارد.');
  if (await tx.logisticsLoading.findFirst({ where: { partnerCaseId: root.id, status: { not: 'CANCELLED' } }, select: { id: true } })
    || await tx.shipmentQuantityEvidence.findFirst({ where: { partnerCaseId: root.id,
      kind: { in: ['PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT', 'LEGACY_DISPATCHED'] } }, select: { id: true } })
    || await tx.accountingFinancialVoidCase.findFirst({ where: { status: 'OPEN', metadata: { path: ['partnerCaseId'], equals: root.id } }, select: { id: true } })) {
    throw new Error('ابتدا وابستگی بارگیری یا پرونده مالی باز را تعیین تکلیف کنید.');
  }
  const event = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_REACTIVATED', eventId: randomUUID(),
    commandId: input.commandId, correlationId: input.commandId, actorId: input.actorId,
    recordedAt: clock.now.toISOString(), effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock.now), owner: input.expected,
    cancellationEventId: cancellation.id, ...(permission ? { permissionId: permission.id } : {}), reason: input.reason });
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId: root.id }, _max: { sequence: true } });
  // The database transition fence requires this exact immutable event before
  // allowing either terminal state to reopen. First commitment facts never move.
  await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId: root.id, caseRevision: root.headRevision,
    integrityHash: root.integrityHash, sequence: (maximum._max.sequence ?? 0) + 1, stateRevision: root.stateRevision + 1,
    type: event.type, fromState: root.state, toState: root.committedAt ? 'COMMITTED' : 'DRAFT',
    actorId: input.actorId, commandId: input.commandId, correlationId: input.commandId, recordedAt: clock.now,
    effectiveDate: new Date(`${event.effectiveDate}T00:00:00Z`), reason: input.reason, evidence: json({ publicEvent: event }) } });
  await tx.partnerSaleCase.update({ where: { id: root.id }, data: { state: root.committedAt ? 'COMMITTED' : 'DRAFT',
    commercialFlowVersion: 1, stateRevision: { increment: 1 } } });
  await tx.salesContract.update({ where: { id: contract.id }, data: { isInactive: false,
    inactiveAt: null, inactiveBy: null, inactiveReason: null, lostAt: null } });
  const updated = await resetPartnerCommercialApprovals(tx, root.id, input.actorId, input.reason);
  const sessions = await tx.salesContractEditSession.findMany({ where: { ownerUserId: input.actorId, purpose: 'PARTNER_TECHNICAL',
    OR: [{ contractId: contract.id }, { recovery: { path: ['partnerCaseId'], equals: root.id } }] } });
  for (const session of sessions) {
    const recovery = decodeTechnicalRecovery(session.recovery);
    if (!recovery) continue;
    const wizard = recovery.wizardDraft as { intent?: Record<string, unknown> } | undefined;
    const intent = wizard?.intent;
    const rows = Array.isArray(intent?.rows) ? intent.rows.map(row => {
      const { approvedRowBinding: _old, ...retained } = row as Record<string, unknown>; return retained;
    }) : undefined;
    await tx.salesContractEditSession.update({ where: { id: session.id }, data: {
      leaseToken: randomUUID(), browserSessionId: `reactivated:${event.eventId}`, takenOverAt: clock.now,
      recovery: json({ ...recovery, partnerCaseId: root.id, archived: false,
        ...(wizard && intent ? { wizardDraft: { ...wizard, intent: { ...intent, rows,
          additionalMaterialApprovals: [] }, step: 'pricing' } } : {}),
      }) } });
  }
  if (permission) await tx.partnerCorrectionOpportunity.create({ data: { id: `reactivation:${event.eventId}`,
    caseId: root.id, predecessorRevision: root.headRevision, scope: 'SHARED',
    scopeHash: await canonicalHash({ reactivationEventId: event.eventId, permissionId: permission.id }),
    requesterId: input.actorId, approvedBy: permission.managerApprovedBy, approvedAt: permission.managerApprovedAt,
    expiresAt: permission.dueAt!, calendarVersion: 'COMMON_COMMERCIAL_PERMISSION_V1',
    evidence: json({ reactivationEventId: event.eventId, cancellationEventId: cancellation.id, permissionId: permission.id }) } });
  const outcome = { caseId: root.id, commercialRevision: updated.commercialRevision, status: 'NOTE' };
  await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity, payloadHash, outcome } });
  return outcome;
}
