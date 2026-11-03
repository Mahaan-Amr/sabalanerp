type TimelineEvent = {
  id: string;
  station: string;
  eventType: string;
  occurredAt: string;
  recordedAt?: string;
  actorId?: string | null;
  detail: Record<string, any>;
};

import { Prisma, PrismaClient } from '@prisma/client';

const normalizedKey = (key: string) => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
const protectedKey = (key: string) => /phone|nationalcode|otp|digest|template|protected|envelope/.test(normalizedKey(key));
const viewOnlyIdentityKey = (key: string) => {
  const normalized = normalizedKey(key);
  return /^(actor|driver|personnel|workstation|guardactor)(id|name)?$/.test(normalized)
    || /^(first|last|full)name$/.test(normalized)
    || /^(recorded|created|issued|approved|admitted|dispatched|removed|reserved|revoked|voided|confirmed|cancelled|entered)by$/.test(normalized);
};
const sanitize = (value: unknown, viewOnly = false): any => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, viewOnly));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !protectedKey(key) && (!viewOnly || !viewOnlyIdentityKey(key)))
    .map(([key, item]) => [key, sanitize(item, viewOnly)]));
};

export const projectDispatchCaseTimeline = (events: TimelineEvent[], access: { workspace: string; permission: string }) => {
  const viewOnly = access.permission === 'view';
  return {
    workspace: access.workspace,
    capabilities: { canMutateTimeline: false, viewOnly },
    events: events.map((event) => ({ ...event, actorId: viewOnly ? null : event.actorId || null,
      detail: sanitize(event.detail, viewOnly) }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)),
  };
};

const snapshotName = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== 'object') return 'راننده';
  const data = snapshot as Record<string, any>;
  return data.driverName || data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ') || 'راننده';
};

const workspaceWhere = (workspace: string, filters: { subjectId?: string; loadingId?: string }): Prisma.GuardDriverQueueTurnWhereInput => {
  const where: Prisma.GuardDriverQueueTurnWhereInput = {};
  if (filters.loadingId) where.loadingId = filters.loadingId;
  if (filters.subjectId) where.OR = [{ internalDriver: { personnelId: filters.subjectId } }, { internalDriverId: filters.subjectId }];
  if (workspace === 'logistics' && !filters.loadingId) where.OR = [{ loadingId: { not: null } }, { allocationRevisions: { some: {} } }];
  if (workspace === 'accounting') where.allocationRevisions = { some: { candidate: { isNot: null } } };
  return where;
};

export const listDispatchCases = async (prisma: PrismaClient, access: { workspace: string; permission: string },
  filters: { subjectId?: string; loadingId?: string } = {}) => {
  const turns = await prisma.guardDriverQueueTurn.findMany({
    where: workspaceWhere(access.workspace, filters),
    select: { id: true, status: true, admittedAt: true, updatedAt: true, loadingId: true, admissionSnapshot: true,
      internalDriver: { select: { personnelId: true } },
      loading: { select: { id: true, loadingNumber: true } },
      allocationRevisions: { select: { candidate: { select: { status: true, waybills: { select: { number: true, status: true }, orderBy: { issuedAt: 'desc' }, take: 1 } } } }, orderBy: { revisionNumber: 'desc' }, take: 1 },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
  });
  return turns.map((turn) => ({ id: turn.id, status: turn.status, admittedAt: turn.admittedAt, updatedAt: turn.updatedAt,
    loadingId: turn.loadingId, loadingNumber: turn.loading?.loadingNumber || null,
    subjectId: turn.internalDriver?.personnelId || null, driverName: access.permission === 'view' ? 'Redacted' : snapshotName(turn.admissionSnapshot),
    accountingStatus: turn.allocationRevisions[0]?.candidate?.status || null,
    waybill: turn.allocationRevisions[0]?.candidate?.waybills[0] ? { ...turn.allocationRevisions[0].candidate.waybills[0], number: turn.allocationRevisions[0].candidate.waybills[0].number.toString() } : null,
    capabilities: { canMutateTimeline: false, viewOnly: access.permission === 'view' } }));
};

export const getDispatchCaseTimeline = async (prisma: PrismaClient, queueTurnId: string,
  access: { workspace: string; permission: string }, filters: { subjectId?: string; loadingId?: string } = {}) => {
  const turn = await prisma.guardDriverQueueTurn.findFirst({ where: { id: queueTurnId, ...workspaceWhere(access.workspace, filters) },
    include: { events: true, allocationRevisions: { include: { candidate: { include: { workItem: true, commands: true,
      waybills: { include: { confirmationSessions: { include: { attempts: true, guardApprovals: true, exitAuthorization: true, alerts: true } },
        physicalExit: true, manualOutageExit: true, dispatchCorrections: { include: { lines: true } } } } } }, physicalExit: true, manualOutageExit: true } } } });
  if (!turn) return null;
  const events: TimelineEvent[] = turn.events.map((item) => ({ id: item.id, station: 'GUARD', eventType: item.eventType,
    occurredAt: item.recordedAt.toISOString(), actorId: item.actorId, detail: { fromStatus: item.fromStatus, toStatus: item.toStatus, reason: item.reason, ...(item.payload as any) } }));
  const aggregateIds = [turn.id];
  for (const revision of turn.allocationRevisions) {
    aggregateIds.push(revision.id);
    events.push({ id: revision.id, station: 'LOGISTICS', eventType: 'ALLOCATION_FINALIZED', occurredAt: revision.finalizedAt.toISOString(), actorId: revision.finalizedBy,
      detail: { revisionNumber: revision.revisionNumber, loadingId: revision.loadingId, integrityHash: revision.integrityHash } });
    const candidate = revision.candidate;
    if (!candidate) continue;
    aggregateIds.push(candidate.id);
    events.push({ id: `${candidate.id}:created`, station: 'ACCOUNTING', eventType: 'CANDIDATE_CREATED', occurredAt: candidate.createdAt.toISOString(), actorId: null, detail: {} });
    if (candidate.dispositionAt) events.push({ id: `${candidate.id}:disposition`, station: 'ACCOUNTING', eventType: `CANDIDATE_${candidate.status}`,
      occurredAt: candidate.dispositionAt.toISOString(), actorId: candidate.dispositionBy, detail: { reason: candidate.dispositionReason } });
    for (const command of candidate.commands) events.push({ id: command.id, station: 'ACCOUNTING', eventType: command.action, occurredAt: command.createdAt.toISOString(), actorId: command.actorId, detail: command.result as any });
    for (const waybill of candidate.waybills) {
      aggregateIds.push(waybill.id);
      events.push({ id: `${waybill.id}:issued`, station: 'ACCOUNTING', eventType: 'WAYBILL_ISSUED', occurredAt: waybill.issuedAt.toISOString(), actorId: waybill.issuedBy, detail: { number: waybill.number.toString(), integrityHash: waybill.integrityHash } });
      if (waybill.voidedAt) events.push({ id: `${waybill.id}:voided`, station: 'ACCOUNTING', eventType: 'WAYBILL_VOIDED', occurredAt: waybill.voidedAt.toISOString(), actorId: waybill.voidedBy, detail: { reason: waybill.voidReason } });
      for (const session of waybill.confirmationSessions) {
        aggregateIds.push(session.id);
        events.push({ id: `${session.id}:started`, station: 'ACCOUNTING', eventType: 'CONFIRMATION_STARTED', occurredAt: session.createdAt.toISOString(), actorId: session.accountingActorId, detail: { method: session.method, workstationId: session.workstationId } });
        const statusAt = session.confirmedAt || session.failedAt || session.cancelledAt || (session.status === 'EXPIRED' ? session.expiresAt : null);
        if (statusAt) events.push({ id: `${session.id}:status`, station: 'ACCOUNTING', eventType: `CONFIRMATION_${session.status}`, occurredAt: statusAt.toISOString(), actorId: session.accountingActorId, detail: { method: session.method } });
        for (const attempt of session.attempts) events.push({ id: attempt.id, station: 'ACCOUNTING', eventType: 'BIOMETRIC_ATTEMPT_RECORDED', occurredAt: attempt.recordedAt.toISOString(), actorId: null, detail: { sequence: attempt.sequence, result: attempt.result } });
        for (const alert of session.alerts) events.push({ id: alert.id, station: 'SYSTEM', eventType: alert.alertType, occurredAt: alert.createdAt.toISOString(), actorId: null, detail: alert.payload as any });
        for (const approval of session.guardApprovals) events.push({ id: approval.id, station: 'GUARD', eventType: 'GUARD_APPROVED', occurredAt: approval.approvedAt.toISOString(), actorId: approval.guardActorId, detail: { reason: approval.reason } });
        if (session.exitAuthorization) {
          const authorization = session.exitAuthorization;
          aggregateIds.push(authorization.id);
          events.push({ id: `${authorization.id}:issued`, station: 'SYSTEM', eventType: 'EXIT_AUTHORIZATION_ISSUED', occurredAt: authorization.issuedAt.toISOString(), actorId: null, detail: { method: authorization.method, validUntil: authorization.validUntil } });
          if (authorization.revokedAt) events.push({ id: `${authorization.id}:revoked`, station: 'SYSTEM', eventType: 'EXIT_AUTHORIZATION_REVOKED', occurredAt: authorization.revokedAt.toISOString(), actorId: authorization.revokedBy, detail: { reason: authorization.revocationReason } });
          if (authorization.consumedAt) events.push({ id: `${authorization.id}:consumed`, station: 'SYSTEM', eventType: 'EXIT_AUTHORIZATION_CONSUMED', occurredAt: authorization.consumedAt.toISOString(), actorId: authorization.consumedBy, detail: {} });
          if (authorization.status === 'EXPIRED' && !authorization.revokedAt && !authorization.consumedAt) events.push({ id: `${authorization.id}:expired`, station: 'SYSTEM', eventType: 'EXIT_AUTHORIZATION_EXPIRED', occurredAt: authorization.validUntil.toISOString(), actorId: null, detail: {} });
        }
      }
      if (waybill.physicalExit) events.push({ id: waybill.physicalExit.id, station: 'GUARD', eventType: 'PHYSICAL_EXIT_RECORDED', occurredAt: waybill.physicalExit.occurredAt.toISOString(), recordedAt: waybill.physicalExit.recordedAt.toISOString(), actorId: waybill.physicalExit.recordedBy, detail: waybill.physicalExit.snapshot as any });
      if (waybill.manualOutageExit) events.push({ id: waybill.manualOutageExit.id, station: 'RECOVERY', eventType: `MANUAL_EXIT_${waybill.manualOutageExit.status}`, occurredAt: waybill.manualOutageExit.actualOccurredAt.toISOString(), actorId: waybill.manualOutageExit.recordedBy, detail: { paperNumber: waybill.manualOutageExit.paperNumber } });
      for (const correction of waybill.dispatchCorrections) events.push({ id: correction.id, station: 'RECOVERY', eventType: `CORRECTION_${correction.status}`, occurredAt: correction.postedAt?.toISOString() || correction.createdAt.toISOString(), actorId: correction.postedBy || correction.createdBy, detail: { reason: correction.reason, effectiveAt: correction.effectiveAt } });
    }
  }
  const audits = await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateId: { in: aggregateIds } }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
  for (const audit of audits) events.push({ id: `audit:${audit.id}`, station: 'AUDIT', eventType: audit.eventType,
    occurredAt: audit.recordedAt.toISOString(), actorId: audit.actorId, detail: { aggregateType: audit.aggregateType, ...(audit.payload as any) } });
  return { case: { id: turn.id, status: turn.status, loadingId: turn.loadingId, admittedAt: turn.admittedAt },
    currentAction: turn.status === 'EXIT_RECORDED' || turn.status === 'CLOSED_WITHOUT_LOADING' ? 'COMPLETE' : 'REVIEW_CURRENT_STATION',
    recovery: turn.status === 'VOIDED' ? 'FOLLOW_REPLACEMENT' : null, ...projectDispatchCaseTimeline(events, access) };
};
