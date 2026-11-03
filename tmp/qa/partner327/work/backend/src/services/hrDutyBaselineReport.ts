import type { Prisma, PrismaClient } from '@prisma/client';

type DutyBaselineDatabase = PrismaClient | Prisma.TransactionClient;

export type HrDutyBaselineReport = {
  generatedAt: string;
  ok: boolean;
  counts: {
    envelopes: number;
    sourceWorkItems: number;
    duties: number;
    openDuties: number;
    assignmentHistory: number;
    activeAssignments: number;
    auditVersions: number;
    notificationIdentities: number;
  };
  findings: Array<{
    code:
      | 'DUTY_AUDIT_MISSING'
      | 'DUTY_AUDIT_VERSION_GAP'
      | 'DUTY_ENVELOPE_INACTIVE'
      | 'DUTY_SOURCE_MISSING'
      | 'DUTY_SOURCE_ADAPTER_UNREGISTERED'
      | 'DUTY_SOURCE_VERSION_MISMATCH'
      | 'OPEN_DUTY_ACTIVE_ASSIGNMENT_COUNT';
    dutyId: string;
    detail: string;
  }>;
};

export const collectHrDutyBaselineReport = async (
  database: DutyBaselineDatabase,
  input: { now?: Date } = {},
): Promise<HrDutyBaselineReport> => {
  const now = input.now ?? new Date();
  const [
    envelopes,
    sourceWorkItems,
    duties,
    openDuties,
    assignmentHistory,
    activeAssignments,
    auditVersions,
    notificationIdentities,
    dutyEvidence,
  ] = await Promise.all([
    database.crossWorkspaceDutyEnvelope.count(),
    database.hrWorkItem.count(),
    database.crossWorkspaceDuty.count(),
    database.crossWorkspaceDuty.count({ where: { status: 'OPEN' } }),
    database.crossWorkspaceDutyAssignmentHistory.count(),
    database.crossWorkspaceDutyAssignmentHistory.count({ where: { endedAt: null } }),
    database.crossWorkspaceDutyAuditVersion.count(),
    database.crossWorkspaceDutyNotificationIdentity.count(),
    database.crossWorkspaceDuty.findMany({
      select: {
        id: true,
        status: true,
        sourceType: true,
        sourceId: true,
        sourceVersion: true,
        currentAssigneeUserId: true,
        envelope: {
          select: { isActive: true },
        },
        assignmentHistory: {
          where: { endedAt: null },
          select: { assignedUserId: true },
        },
        auditVersions: {
          select: { id: true, version: true },
          orderBy: { version: 'asc' },
        },
      },
    }),
  ]);

  const hrSourceIds = [...new Set(dutyEvidence
    .filter((duty) => duty.sourceType === 'HR_WORK_ITEM')
    .map((duty) => duty.sourceId))];
  const existingHrSources = hrSourceIds.length
    ? await database.hrWorkItem.findMany({ where: { id: { in: hrSourceIds } }, select: { id: true } })
    : [];
  const existingHrSourceIds = new Set(existingHrSources.map((source) => source.id));
  const sourceAudits = hrSourceIds.length
    ? await database.hrWorkItemAudit.findMany({
      where: { workItemId: { in: hrSourceIds }, NOT: { eventType: { startsWith: 'DUTY_' } } },
      select: { workItemId: true },
    })
    : [];
  const sourceAuditCounts = new Map<string, number>();
  for (const audit of sourceAudits) {
    sourceAuditCounts.set(audit.workItemId, (sourceAuditCounts.get(audit.workItemId) ?? 0) + 1);
  }

  const findings: HrDutyBaselineReport['findings'] = [];
  for (const duty of dutyEvidence) {
    if (duty.status === 'OPEN' && !duty.envelope.isActive) findings.push({
      code: 'DUTY_ENVELOPE_INACTIVE',
      dutyId: duty.id,
      detail: 'Duty is bound to an inactive envelope version.',
    });
    if (duty.sourceType === 'HR_WORK_ITEM' && !existingHrSourceIds.has(duty.sourceId)) findings.push({
      code: 'DUTY_SOURCE_MISSING',
      dutyId: duty.id,
      detail: `HR Work Item source ${duty.sourceId} does not exist.`,
    });
    if (duty.sourceType !== 'HR_WORK_ITEM') findings.push({
      code: 'DUTY_SOURCE_ADAPTER_UNREGISTERED',
      dutyId: duty.id,
      detail: `Current engine has no registered source adapter for ${duty.sourceType}.`,
    });
    if (duty.status === 'OPEN' && duty.sourceType === 'HR_WORK_ITEM' && existingHrSourceIds.has(duty.sourceId)) {
      const currentSourceVersion = (sourceAuditCounts.get(duty.sourceId) ?? 0) + 1;
      if (duty.sourceVersion !== currentSourceVersion) findings.push({
        code: 'DUTY_SOURCE_VERSION_MISMATCH',
        dutyId: duty.id,
        detail: `Duty source version ${duty.sourceVersion} does not match current source version ${currentSourceVersion}.`,
      });
    }
    if (duty.status === 'OPEN') {
      const activeAssignments = duty.assignmentHistory;
      const assignmentMatches = activeAssignments.length === 1
        && activeAssignments[0].assignedUserId === duty.currentAssigneeUserId;
      if (!assignmentMatches) findings.push({
        code: 'OPEN_DUTY_ACTIVE_ASSIGNMENT_COUNT',
        dutyId: duty.id,
        detail: `Expected one active assignment matching current assignee; found ${activeAssignments.length}.`,
      });
    }
    if (duty.auditVersions.length === 0) findings.push({
      code: 'DUTY_AUDIT_MISSING',
      dutyId: duty.id,
      detail: 'Duty has no audit version.',
    });
    const auditVersionsAreContiguous = duty.auditVersions.every((audit, index) => audit.version === index + 1);
    if (duty.auditVersions.length > 0 && !auditVersionsAreContiguous) findings.push({
      code: 'DUTY_AUDIT_VERSION_GAP',
      dutyId: duty.id,
      detail: `Expected contiguous audit versions; found ${duty.auditVersions.map((audit) => audit.version).join(',')}.`,
    });
  }
  findings.sort((left, right) => (
    left.dutyId.localeCompare(right.dutyId) || left.code.localeCompare(right.code)
  ));

  return {
    generatedAt: now.toISOString(),
    ok: findings.length === 0,
    counts: {
      envelopes,
      sourceWorkItems,
      duties,
      openDuties,
      assignmentHistory,
      activeAssignments,
      auditVersions,
      notificationIdentities,
    },
    findings,
  };
};
