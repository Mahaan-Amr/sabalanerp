export interface SecurityDashboardActor {
  userId: string;
  role: string;
  workspacePermission?: string | null;
}

interface SecurityPersonnelLike {
  id: string;
  position?: string | null;
  user?: { id?: string; firstName?: string | null; lastName?: string | null; username?: string | null } | null;
}

interface TemporaryCoverageLike {
  personnelId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  personnel: SecurityPersonnelLike;
}

interface SecuritySlotLike {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  plannedPersonnelId: string;
  replacementPersonnelId?: string | null;
  plannedPersonnel: SecurityPersonnelLike;
  replacementPersonnel?: SecurityPersonnelLike | null;
  temporaryCoverage?: TemporaryCoverageLike[];
  plan: { lateAlertMinutes: number };
}

interface SecuritySessionLike {
  id: string;
  status: string;
  startedAt: Date | string;
  personnelId: string;
  personnel: SecurityPersonnelLike;
  slot: SecuritySlotLike;
}

type CoverageKind = 'PLANNED' | 'REPLACEMENT' | 'TEMPORARY';

const personnelSummary = (personnel: SecurityPersonnelLike) => ({
  id: personnel.id,
  name: `${personnel.user?.firstName || ''} ${personnel.user?.lastName || ''}`.trim() || personnel.user?.username || 'نیروی گارد',
  position: personnel.position || null,
});

const activeTemporaryCoverage = (slot: SecuritySlotLike, now: Date) => (slot.temporaryCoverage || []).find((coverage) => (
  new Date(coverage.startsAt).getTime() <= now.getTime() && new Date(coverage.endsAt).getTime() > now.getTime()
));

const resolveScheduledWorker = (slot: SecuritySlotLike, now: Date): { personnel: SecurityPersonnelLike; kind: CoverageKind } => {
  const temporary = activeTemporaryCoverage(slot, now);
  if (temporary) return { personnel: temporary.personnel, kind: 'TEMPORARY' };
  if (slot.replacementPersonnel) return { personnel: slot.replacementPersonnel, kind: 'REPLACEMENT' };
  return { personnel: slot.plannedPersonnel, kind: 'PLANNED' };
};

const coverageKindForSession = (session: SecuritySessionLike, now: Date): CoverageKind => {
  const temporary = activeTemporaryCoverage(session.slot, now);
  if (temporary?.personnelId === session.personnelId) return 'TEMPORARY';
  if (session.slot.replacementPersonnelId === session.personnelId) return 'REPLACEMENT';
  return 'PLANNED';
};

const isManager = (actor: SecurityDashboardActor) => actor.role === 'ADMIN' || actor.workspacePermission === 'admin';

const reportParticipantName = (participant: any) => {
  const person = participant.personnel || participant.user;
  if (!person) return null;
  return `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.username || null;
};

export const buildDashboardRecentReports = (entries: any[], limit = 5) => [...entries]
  .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  .slice(0, limit)
  .map((entry) => ({
    id: entry.id,
    rowNumber: entry.rowNumber,
    status: entry.status,
    title: `${entry.categoryNameSnapshot || entry.category?.name || 'گزارش'}${entry.reportTypeNameSnapshot || entry.reportType?.name ? ` / ${entry.reportTypeNameSnapshot || entry.reportType?.name}` : ''}`,
    description: entry.description || null,
    createdAt: new Date(entry.createdAt).toISOString(),
    voidReason: entry.voidReason || null,
    voidedAt: entry.voidedAt ? new Date(entry.voidedAt).toISOString() : null,
    participants: (entry.participants || []).map(reportParticipantName).filter(Boolean),
    attachmentCount: (entry.attachments || []).length,
  }));

export const buildSecurityDashboardAwareness = ({
  actor,
  activeSession,
  currentSlot,
  now = new Date(),
}: {
  actor: SecurityDashboardActor;
  activeSession: SecuritySessionLike | null;
  currentSlot: SecuritySlotLike | null;
  now?: Date;
}) => {
  const manager = isManager(actor);

  if (activeSession) {
    const operator = activeSession.personnel.user?.id === actor.userId;
    if (!manager && !operator) return { authorized: false as const, access: null, overview: null };
    const kind = coverageKindForSession(activeSession, now);
    return {
      authorized: true as const,
      access: manager ? 'manager' as const : 'operator' as const,
      overview: {
        state: 'ACTIVE' as const,
        sessionId: activeSession.id,
        slotId: activeSession.slot.id,
        startedAt: new Date(activeSession.startedAt).toISOString(),
        startsAt: new Date(activeSession.slot.startsAt).toISOString(),
        endsAt: new Date(activeSession.slot.endsAt).toISOString(),
        overdue: false,
        coverageKind: kind,
        effectivePersonnel: personnelSummary(activeSession.personnel),
        plannedPersonnel: kind === 'PLANNED' ? null : personnelSummary(activeSession.slot.plannedPersonnel),
      },
    };
  }

  if (currentSlot) {
    const effective = resolveScheduledWorker(currentSlot, now);
    const operator = effective.personnel.user?.id === actor.userId;
    if (!manager && !operator) return { authorized: false as const, access: null, overview: null };
    const overdueAt = new Date(currentSlot.startsAt).getTime() + currentSlot.plan.lateAlertMinutes * 60_000;
    return {
      authorized: true as const,
      access: manager ? 'manager' as const : 'operator' as const,
      overview: {
        state: 'SCHEDULED_NOT_STARTED' as const,
        sessionId: null,
        slotId: currentSlot.id,
        startedAt: null,
        startsAt: new Date(currentSlot.startsAt).toISOString(),
        endsAt: new Date(currentSlot.endsAt).toISOString(),
        overdue: now.getTime() >= overdueAt,
        coverageKind: effective.kind,
        effectivePersonnel: personnelSummary(effective.personnel),
        plannedPersonnel: effective.kind === 'PLANNED' ? null : personnelSummary(currentSlot.plannedPersonnel),
      },
    };
  }

  if (!manager) return { authorized: false as const, access: null, overview: null };
  return {
    authorized: true as const,
    access: 'manager' as const,
    overview: {
      state: 'NONE' as const,
      sessionId: null,
      slotId: null,
      startedAt: null,
      startsAt: null,
      endsAt: null,
      overdue: false,
      coverageKind: null,
      effectivePersonnel: null,
      plannedPersonnel: null,
    },
  };
};
