export interface ShiftSessionInterval {
  startedAt: Date;
  endedAt: Date | null;
}

export interface ShiftSessionCorrectionPolicyInput {
  now: Date;
  plannedStartedAt: Date;
  plannedEndedAt: Date;
  proposedStartedAt: Date;
  proposedEndedAt: Date | null;
  requireEndedAt: boolean;
  deviationConfirmed: boolean;
  evidenceInstants: Date[];
  overlappingSessions: ShiftSessionInterval[];
}

export const validateShiftSessionCorrectionPolicy = ({
  now,
  plannedStartedAt,
  plannedEndedAt,
  proposedStartedAt,
  proposedEndedAt,
  requireEndedAt,
  deviationConfirmed,
  evidenceInstants,
  overlappingSessions,
}: ShiftSessionCorrectionPolicyInput) => {
  if (proposedStartedAt > now || (proposedEndedAt && proposedEndedAt > now)) {
    throw new Error('زمان اصلاح‌شده نمی‌تواند در آینده باشد.');
  }
  if (requireEndedAt && !proposedEndedAt) {
    throw new Error('برای بازسازی شیفت پایان‌یافته، زمان شروع و پایان الزامی است.');
  }
  if (proposedEndedAt && proposedStartedAt >= proposedEndedAt) {
    throw new Error('زمان پایان شیفت باید بعد از زمان شروع باشد.');
  }

  const evidenceBeforeStart = evidenceInstants.some((instant) => instant < proposedStartedAt);
  const evidenceAfterEnd = proposedEndedAt ? evidenceInstants.some((instant) => instant > proposedEndedAt) : false;
  if (evidenceBeforeStart || evidenceAfterEnd) {
    throw new Error('مرزهای اصلاح‌شده باید همه گزارش‌ها و گشت‌زنی‌های ثبت‌شده را دربر بگیرد.');
  }

  const proposedEndMs = proposedEndedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const overlaps = overlappingSessions.some((session) => {
    const otherEndMs = session.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return proposedStartedAt.getTime() < otherEndMs && proposedEndMs > session.startedAt.getTime();
  });
  if (overlaps) {
    throw new Error('زمان اصلاح‌شده با جلسه شیفت دیگری برای این نیرو هم‌پوشانی دارد.');
  }

  const deviatesFromPlan = proposedStartedAt < plannedStartedAt
    || Boolean(proposedEndedAt && proposedEndedAt > plannedEndedAt);
  if (deviatesFromPlan && !deviationConfirmed) {
    throw new Error('تأیید خروج زمان اصلاح‌شده از بازه برنامه الزامی است.');
  }

  return { deviatesFromPlan };
};

export interface ShiftTimelineLogEntry {
  id: string;
  rowNumber?: number | null;
  status: string;
  categoryNameSnapshot: string;
  reportTypeNameSnapshot?: string | null;
  description?: string | null;
  createdAt: Date | string;
  reportType?: { description?: string | null } | null;
  participants?: any[];
  attachments?: Array<{ id: string; originalName?: string | null }>;
  voidReason?: string | null;
  voidedAt?: Date | string | null;
  voidedBy?: string | null;
}

export interface ShiftTimelinePatrol {
  id: string;
  status: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  description?: string | null;
  personnel?: any;
}

const personName = (value: any) => {
  const user = value?.user || value;
  return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '-';
};

const participantName = (participant: any) => personName(participant?.personnel || participant?.user);

export const buildCombinedSecurityShiftTimeline = ({
  logEntries,
  patrolSessions,
  defaultAuthor,
}: {
  logEntries: ShiftTimelineLogEntry[];
  patrolSessions: ShiftTimelinePatrol[];
  defaultAuthor?: string | null;
}) => {
  const logEvents = logEntries.map((entry) => ({
    id: entry.id,
    kind: 'SHIFT_LOG',
    linkedId: null,
    rowNumber: entry.rowNumber ?? null,
    status: entry.status,
    title: `${entry.categoryNameSnapshot}${entry.reportTypeNameSnapshot ? ` / ${entry.reportTypeNameSnapshot}` : ''}`,
    typeDescription: entry.reportType?.description || null,
    description: entry.description || null,
    participants: (entry.participants || []).map(participantName),
    createdAt: new Date(entry.createdAt).toISOString(),
    author: defaultAuthor || null,
    voidReason: entry.voidReason || null,
    voidedAt: entry.voidedAt ? new Date(entry.voidedAt).toISOString() : null,
    voidedBy: entry.voidedBy || null,
    attachmentCount: entry.attachments?.length || 0,
    attachments: (entry.attachments || []).map((attachment) => ({ id: attachment.id, name: attachment.originalName || null })),
    voidable: true,
  }));

  const patrolEvents = patrolSessions.flatMap((patrol) => {
    const startedAt = new Date(patrol.startedAt);
    const endedAt = patrol.endedAt ? new Date(patrol.endedAt) : null;
    const author = personName(patrol.personnel);
    const events: any[] = [{
      id: `patrol-start-${patrol.id}`,
      kind: 'PATROL_START',
      linkedId: patrol.id,
      rowNumber: null,
      status: patrol.status,
      title: 'شروع گشت‌زنی',
      typeDescription: null,
      description: null,
      participants: [],
      createdAt: startedAt.toISOString(),
      author,
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
      attachmentCount: 0,
      attachments: [],
      voidable: false,
    }];
    if (endedAt) {
      const durationMinutes = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 60_000));
      events.push({
        id: `patrol-finish-${patrol.id}`,
        kind: 'PATROL_FINISH',
        linkedId: patrol.id,
        rowNumber: null,
        status: patrol.status,
        title: 'پایان گشت‌زنی',
        typeDescription: `مدت گشت: ${durationMinutes.toLocaleString('fa-IR')} دقیقه`,
        description: patrol.description || null,
        participants: [],
        createdAt: endedAt.toISOString(),
        author,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        attachmentCount: 0,
        attachments: [],
        voidable: false,
      });
    }
    return events;
  });

  return [...logEvents, ...patrolEvents].sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    || a.id.localeCompare(b.id)
  ));
};
