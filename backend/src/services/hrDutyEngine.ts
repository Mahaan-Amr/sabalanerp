import { Prisma, type PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from './notificationService';
import { authorizeHrUser, resolveHrNamedResponsibility } from './hrAuthorizationService';

const responseSchema = Object.freeze({
  type: 'object',
  required: ['actionCode', 'expectedSourceVersion', 'expectedEnvelopeVersion'],
  additionalProperties: false,
});
const allowedActionCodes = ['APPROVE', 'REJECT', 'RETURN', 'REQUEST_CLARIFICATION'] as const;
function dutyDefinition(sourceActionCode: string, responsibilityTypeCode: string, destinationWorkspaceCode: string) {
  return {
    sourceActionCode,
    envelopeCode: `HR_${sourceActionCode}`,
    envelopeVersion: 1,
    responsibilityTypeCode,
    destinationWorkspaceCode,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    allowedActionCodes,
    responseSchema,
  };
}

export const HR_DUTY_DEFINITIONS = Object.freeze({
  LEGACY_HR_WORK_ITEM_REVIEW: {
    sourceActionCode: 'LEGACY_HR_WORK_ITEM_REVIEW',
    envelopeCode: 'LEGACY_HR_WORK_ITEM',
    envelopeVersion: 1,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    responsibilityTypeCode: 'HR_PROCESSOR',
    destinationWorkspaceCode: 'HUMAN_RESOURCES',
    allowedActionCodes,
    responseSchema,
  },
  FINANCE_RECORDING: dutyDefinition('FINANCE_RECORDING', 'FINANCE_RECORDER', 'ACCOUNTING'),
  FINANCE_APPROVAL: dutyDefinition('FINANCE_APPROVAL', 'FINANCE_MANAGER', 'ACCOUNTING'),
  HIRING_MANAGER_REVIEW: dutyDefinition('HIRING_MANAGER_REVIEW', 'HIRING_MANAGER', 'PERSONAL'),
  COMPANY_MANAGER_DECISION: dutyDefinition('COMPANY_MANAGER_DECISION', 'COMPANY_MANAGER', 'PERSONAL'),
  RESPONSIBLE_SUPERVISOR_REVIEW: dutyDefinition('RESPONSIBLE_SUPERVISOR_REVIEW', 'RESPONSIBLE_SUPERVISOR', 'PERSONAL'),
  PAYROLL_PREPARATION: dutyDefinition('PAYROLL_PREPARATION', 'HR_PAYROLL_PROCESSOR', 'HUMAN_RESOURCES'),
  PAYROLL_APPROVAL: dutyDefinition('PAYROLL_APPROVAL', 'HR_PAYROLL_MANAGER', 'HUMAN_RESOURCES'),
});

export type HrDutyActionCode = typeof HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes[number];
export type HrDutyTerminalStatus = 'COMPLETED' | 'WAIVED' | 'CANCELLED';

type DutyResponseInput = {
  duty: {
    status: 'OPEN' | HrDutyTerminalStatus;
    currentAssigneeUserId: string | null;
    sourceVersion: number;
    envelopeVersion: number;
  };
  actorUserId: string;
  actionCode: string;
  expectedSourceVersion: number;
  expectedEnvelopeVersion: number;
  reason: string | null;
  sourceIsCurrent: boolean;
  assigneeIsEligible: boolean;
  responsibilityIsCurrent: boolean;
  separationOfDutiesSatisfied: boolean;
  allowedActionCodes: readonly string[];
};

export type HrDutyResponseDenialCode =
  | 'DUTY_NOT_OPEN'
  | 'ASSIGNEE_CHANGED'
  | 'SOURCE_VERSION_CHANGED'
  | 'ENVELOPE_VERSION_CHANGED'
  | 'SOURCE_STATE_CHANGED'
  | 'ASSIGNEE_INELIGIBLE'
  | 'RESPONSIBILITY_CHANGED'
  | 'SEPARATION_OF_DUTIES_CONFLICT'
  | 'ACTION_NOT_ALLOWED'
  | 'REASON_REQUIRED';

export const evaluateHrDutyResponse = (input: DutyResponseInput):
  { allowed: true } | { allowed: false; code: HrDutyResponseDenialCode } => {
  if (input.duty.status !== 'OPEN') return { allowed: false, code: 'DUTY_NOT_OPEN' };
  if (input.duty.currentAssigneeUserId !== input.actorUserId) return { allowed: false, code: 'ASSIGNEE_CHANGED' };
  if (input.duty.sourceVersion !== input.expectedSourceVersion) return { allowed: false, code: 'SOURCE_VERSION_CHANGED' };
  if (input.duty.envelopeVersion !== input.expectedEnvelopeVersion) return { allowed: false, code: 'ENVELOPE_VERSION_CHANGED' };
  if (!input.sourceIsCurrent) return { allowed: false, code: 'SOURCE_STATE_CHANGED' };
  if (!input.assigneeIsEligible) return { allowed: false, code: 'ASSIGNEE_INELIGIBLE' };
  if (!input.responsibilityIsCurrent) return { allowed: false, code: 'RESPONSIBILITY_CHANGED' };
  if (!input.separationOfDutiesSatisfied) return { allowed: false, code: 'SEPARATION_OF_DUTIES_CONFLICT' };
  if (!input.allowedActionCodes.includes(input.actionCode)) return { allowed: false, code: 'ACTION_NOT_ALLOWED' };
  if (input.actionCode !== 'APPROVE' && (!input.reason || input.reason.trim().length < 3)) {
    return { allowed: false, code: 'REASON_REQUIRED' };
  }
  return { allowed: true };
};

export type HrDutyDeadlineEventCode = 'NEAR_DUE' | 'OVERDUE' | 'MANAGER_ESCALATION';

const tehranJalaliDeadlineFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const formatHrDutyDeadlineTehran = (deadline: Date) => tehranJalaliDeadlineFormatter.format(deadline);

export const planHrDutyDeadlineEvents = (input: {
  status: 'OPEN' | HrDutyTerminalStatus;
  dueAt: Date;
  now: Date;
  existingEventCodes: string[];
}): HrDutyDeadlineEventCode[] => {
  if (input.status !== 'OPEN') return [];
  const remainingMs = input.dueAt.getTime() - input.now.getTime();
  const existing = new Set(input.existingEventCodes);
  const events: HrDutyDeadlineEventCode[] = [];
  if (remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1_000 && !existing.has('NEAR_DUE')) {
    events.push('NEAR_DUE');
  }
  if (remainingMs <= 0 && !existing.has('OVERDUE')) events.push('OVERDUE');
  if (remainingMs <= -24 * 60 * 60 * 1_000 && !existing.has('MANAGER_ESCALATION')) {
    events.push('MANAGER_ESCALATION');
  }
  return events;
};

export const planHrDutyReassignment = (input: {
  status: 'OPEN' | HrDutyTerminalStatus;
  currentAssigneeUserId: string | null;
  currentEnvelopeVersion: number;
  nextAssigneeUserId: string | null;
  nextEnvelopeVersion: number;
  dueAt: Date;
  resetDueAt: Date | null;
}) => {
  if (input.status !== 'OPEN') return null;
  if (
    input.currentAssigneeUserId === input.nextAssigneeUserId
    && input.currentEnvelopeVersion === input.nextEnvelopeVersion
  ) return null;
  return {
    predecessorStatus: input.currentEnvelopeVersion === input.nextEnvelopeVersion ? 'WAIVED' as const : 'CANCELLED' as const,
    endReason: input.currentEnvelopeVersion === input.nextEnvelopeVersion ? 'REASSIGNED' as const : 'SOURCE_CHANGED' as const,
    successorDueAt: input.resetDueAt ?? input.dueAt,
  };
};

type HrDutyDatabase = PrismaClient | Prisma.TransactionClient;
type DutyDefinition = typeof HR_DUTY_DEFINITIONS[keyof typeof HR_DUTY_DEFINITIONS];

const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const definitionFor = (sourceActionCode: string): DutyDefinition => {
  const definition = Object.values(HR_DUTY_DEFINITIONS)
    .find((candidate) => candidate.sourceActionCode === sourceActionCode);
  if (!definition) throw new Error('HR_DUTY_ACTION_NOT_REGISTERED');
  return definition;
};
const inTransaction = async <Result>(
  database: HrDutyDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<Result>,
) => '$transaction' in database
  ? database.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  : work(database);

const legacySourceVersion = (tx: Prisma.TransactionClient, workItemId: string) => tx.hrWorkItemAudit.count({
  where: { workItemId, NOT: { eventType: { startsWith: 'DUTY_' } } },
}).then((count) => count + 1);

const workspacePermissionCode = (workspaceCode: string) => (
  workspaceCode === 'HUMAN_RESOURCES' ? 'hr' : workspaceCode.toLowerCase()
);

const destinationManagerIds = async (
  tx: Prisma.TransactionClient,
  workspaceCode: string,
  now: Date,
) => {
  const workspace = workspacePermissionCode(workspaceCode);
  const users = await tx.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'ADMIN' },
        { workspacePermissions: { some: {
          workspace, permissionLevel: 'admin', isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        } } },
      ],
    },
    select: { id: true },
  });
  return users.map(({ id }) => id);
};

const writeDutyNotification = async (
  tx: Prisma.TransactionClient,
  input: {
    dutyId: string;
    auditVersion: number;
    eventType:
      | 'HR_DUTY_ASSIGNED'
      | 'HR_DUTY_UNASSIGNED_TRIAGE'
      | 'HR_DUTY_NEAR_DUE'
      | 'HR_DUTY_OVERDUE'
      | 'HR_DUTY_REASSIGNED'
      | 'HR_DUTY_RESULT'
      | 'HR_DUTY_MANAGER_ESCALATION';
    eventCode: string;
    recipientUserIds: string[];
    destinationWorkspaceCode: string;
    actorUserId?: string | null;
  },
) => {
  const safePayload = {
    dutyId: input.dutyId,
    destinationWorkspaceCode: input.destinationWorkspaceCode,
    eventCode: input.eventCode,
  };
  const recipients: Array<string | null> = input.recipientUserIds.length ? input.recipientUserIds : [null];
  await tx.hrDutyNotificationIdentity.createMany({
    data: recipients.map((recipientUserId) => ({
      stableKey: `hr-duty-notification:${input.dutyId}:${input.auditVersion}:${input.eventCode}:${recipientUserId ?? 'UNASSIGNED'}`,
      dutyId: input.dutyId,
      dutyAuditVersion: input.auditVersion,
      recipientUserId,
      channelCode: 'UNIFIED_NOTIFICATION_CENTER',
      templateCode: input.eventType,
      safePayloadJson: safePayload,
    })),
    skipDuplicates: true,
  });
  if (!input.recipientUserIds.length) return;
  await publishNotificationEvent(tx, {
    type: input.eventType,
    deduplicationKey: `hr-duty:${input.dutyId}:${input.auditVersion}:${input.eventCode}`,
    recipientIds: input.recipientUserIds,
    recipientGroups: {
      DIRECT_USER: input.recipientUserIds,
      WORKSPACE_MANAGERS: input.recipientUserIds,
    },
    actorId: input.actorUserId,
    workspace: input.destinationWorkspaceCode,
    feature: 'HR_DUTY',
    resourceType: 'HR_DUTY',
    resourceId: input.dutyId,
    actionUrl: `/dashboard/${workspacePermissionCode(input.destinationWorkspaceCode)}/duties/${input.dutyId}`,
    payload: {},
  });
};

const upsertDutyEnvelope = (
  tx: Prisma.TransactionClient,
  definition: DutyDefinition,
  createdByUserId: string,
) => tx.hrDutyEnvelope.upsert({
  where: { code_version: { code: definition.envelopeCode, version: definition.envelopeVersion } },
  update: {
    destinationWorkspaceCode: definition.destinationWorkspaceCode,
    allowedFieldsJson: [...definition.allowedFields],
    allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes],
    responseSchemaJson: definition.responseSchema,
    isActive: true,
  },
  create: {
    code: definition.envelopeCode,
    version: definition.envelopeVersion,
    destinationWorkspaceCode: definition.destinationWorkspaceCode,
    allowedFieldsJson: [...definition.allowedFields],
    allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes],
    responseSchemaJson: definition.responseSchema,
    createdByUserId,
  },
});

export const syncHrDutyEnvelopeDefinitions = (
  database: HrDutyDatabase,
  actorUserId = 'SYSTEM',
) => inTransaction(database, async (tx) => Promise.all(
  Object.values(HR_DUTY_DEFINITIONS).map((definition) => upsertDutyEnvelope(tx, definition, actorUserId)),
));

export type CreateHrDutyFromLegacyWorkItemInput = {
  sourceWorkItemId: string;
  sourceActionCode: string;
  responsibilityTypeCode: string;
  scopeType: string;
  scopeId: string | null;
  sourceActorUserId: string;
  policyVersion: number;
  now?: Date;
};

export const createHrDutyFromLegacyWorkItem = (
  database: HrDutyDatabase,
  input: CreateHrDutyFromLegacyWorkItemInput,
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const definition = definitionFor(input.sourceActionCode);
  if (definition.responsibilityTypeCode !== input.responsibilityTypeCode) {
    throw new Error('HR_DUTY_RESPONSIBILITY_NOT_REGISTERED_FOR_ACTION');
  }
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: input.sourceWorkItemId } });
  if (!['PENDING', 'IN_PROGRESS'].includes(source.status)) throw new Error('HR_DUTY_SOURCE_NOT_ACTIONABLE');
  const sourceVersion = await legacySourceVersion(tx, source.id);
  const stableKey = `hr-duty:${input.sourceActionCode}:${source.id}:v${sourceVersion}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stableKey}))`;
  const existing = await tx.hrDuty.findUnique({ where: { stableKey } });
  if (existing) return existing;

  const resolution = await resolveHrNamedResponsibility(tx, {
    sourceActionCode: input.sourceActionCode,
    responsibilityTypeCode: input.responsibilityTypeCode,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    sourceActorUserId: input.sourceActorUserId,
    now,
  });
  const configuredDestinations = resolution.status === 'RESOLVED' ? [] : await tx.hrResponsibilityDestination.findMany({
    where: {
      responsibilityTypeCode: input.responsibilityTypeCode,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      isActive: true,
    },
  });
  const destinationWorkspaceCode = resolution.status === 'RESOLVED'
    ? resolution.destination.workspaceCode
    : configuredDestinations.length === 1
      ? configuredDestinations[0].workspaceCode
      : definition.destinationWorkspaceCode;
  const destinationQueueCode = resolution.status === 'RESOLVED'
    ? resolution.destination.queueCode
    : configuredDestinations.length === 1
      ? configuredDestinations[0].queueCode
      : `${input.responsibilityTypeCode}_TRIAGE`;
  if (destinationWorkspaceCode !== definition.destinationWorkspaceCode) {
    throw new Error('HR_DUTY_DESTINATION_INCOMPATIBLE_WITH_ENVELOPE');
  }
  await upsertDutyEnvelope(tx, definition, input.sourceActorUserId);
  const assigned = resolution.status === 'RESOLVED';
  const duty = await tx.hrDuty.create({ data: {
    stableKey,
    sourceType: 'HR_WORK_ITEM',
    sourceId: source.id,
    sourceActionCode: input.sourceActionCode,
    sourceVersion,
    envelopeCode: definition.envelopeCode,
    envelopeVersion: definition.envelopeVersion,
    destinationWorkspaceCode,
    destinationQueueCode,
    currentAssigneeUserId: assigned ? resolution.assignedUserId : null,
    responsibilityId: assigned ? resolution.responsibilityId : null,
    dueAt: source.dueDate,
    createdByUserId: input.sourceActorUserId,
  } });
  await tx.hrDutyAssignmentHistory.create({ data: {
    dutyId: duty.id,
    sequence: 1,
    assignedUserId: duty.currentAssigneeUserId,
    responsibilityId: duty.responsibilityId,
    destinationWorkspaceCode,
    destinationQueueCode,
    startedAt: now,
    changedByUserId: input.sourceActorUserId,
    policyVersion: input.policyVersion,
  } });
  const eventCode = assigned ? 'ASSIGNED' : 'UNASSIGNED_TRIAGE';
  await tx.hrDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: 1,
    eventCode,
    actorUserId: input.sourceActorUserId,
    sourceVersion,
    envelopeVersion: definition.envelopeVersion,
    policyVersion: input.policyVersion,
    afterJson: asJson({
      status: duty.status,
      currentAssigneeUserId: duty.currentAssigneeUserId,
      destinationWorkspaceCode,
      destinationQueueCode,
    }),
    reason: assigned ? null : resolution.reason,
  } });
  const recipients = assigned
    ? [resolution.assignedUserId]
    : await destinationManagerIds(tx, destinationWorkspaceCode, now);
  await writeDutyNotification(tx, {
    dutyId: duty.id,
    auditVersion: 1,
    eventType: assigned ? 'HR_DUTY_ASSIGNED' : 'HR_DUTY_UNASSIGNED_TRIAGE',
    eventCode,
    recipientUserIds: recipients,
    destinationWorkspaceCode,
    actorUserId: input.sourceActorUserId,
  });
  return duty;
});

export type RespondToHrDutyInput = {
  dutyId: string;
  actorUserId: string;
  actionCode: string;
  expectedSourceVersion: number;
  expectedEnvelopeVersion: number;
  reason: string | null;
  policyVersion: number;
  now?: Date;
};

export const respondToHrDuty = (
  database: HrDutyDatabase,
  input: RespondToHrDutyInput,
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const duty = await tx.hrDuty.findUniqueOrThrow({
    where: { id: input.dutyId },
    include: { envelope: true, responsibility: true },
  });
  const structuredResult = { actionCode: input.actionCode, reason: input.reason };
  if (duty.status === 'COMPLETED') {
    const storedResult = duty.structuredResultJson && typeof duty.structuredResultJson === 'object'
      && !Array.isArray(duty.structuredResultJson)
      ? duty.structuredResultJson as Record<string, unknown>
      : null;
    const replayed = duty.respondedByUserId === input.actorUserId
      && storedResult?.actionCode === input.actionCode
      && (storedResult.reason ?? null) === input.reason;
    if (replayed) return { duty, replayed: true };
    throw new Error('DUTY_NOT_OPEN');
  }
  if (duty.sourceType !== 'HR_WORK_ITEM') throw new Error('HR_DUTY_SOURCE_ADAPTER_NOT_REGISTERED');
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  const currentSourceVersion = await legacySourceVersion(tx, source.id);
  const responsibility = duty.responsibility;
  const currentResolution = responsibility ? await resolveHrNamedResponsibility(tx, {
    sourceActionCode: duty.sourceActionCode,
    responsibilityTypeCode: responsibility.responsibilityTypeCode,
    scopeType: responsibility.scopeType,
    scopeId: responsibility.scopeId,
    sourceActorUserId: duty.createdByUserId,
    now,
  }) : null;
  const authorization = await authorizeHrUser(tx, input.actorUserId, {
    dutyId: duty.id,
    authorityCodes: responsibility ? [responsibility.responsibilityTypeCode] : [],
  }, now);
  const decision = evaluateHrDutyResponse({
    duty,
    actorUserId: input.actorUserId,
    actionCode: input.actionCode,
    expectedSourceVersion: input.expectedSourceVersion,
    expectedEnvelopeVersion: input.expectedEnvelopeVersion,
    reason: input.reason,
    sourceIsCurrent: currentSourceVersion === duty.sourceVersion && ['PENDING', 'IN_PROGRESS'].includes(source.status),
    assigneeIsEligible: authorization.allowed,
    responsibilityIsCurrent: currentResolution?.status === 'RESOLVED'
      && currentResolution.responsibilityId === duty.responsibilityId
      && currentResolution.assignedUserId === duty.currentAssigneeUserId,
    separationOfDutiesSatisfied: currentResolution?.status === 'RESOLVED',
    allowedActionCodes: Array.isArray(duty.envelope.allowedActionCodesJson)
      ? duty.envelope.allowedActionCodesJson.filter((value): value is string => typeof value === 'string')
      : [],
  });
  if (!decision.allowed) throw new Error(decision.code);

  const claimed = await tx.hrDuty.updateMany({
    where: { id: duty.id, status: 'OPEN' },
    data: {
      status: 'COMPLETED',
      structuredResultJson: structuredResult,
      respondedAt: now,
      respondedByUserId: input.actorUserId,
    },
  });
  if (!claimed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
  const sourceStatus = input.actionCode === 'APPROVE'
    ? 'COMPLETE' as const
    : input.actionCode === 'REJECT'
      ? 'WAIVED' as const
      : 'IN_PROGRESS' as const;
  const updatedSource = await tx.hrWorkItem.update({
    where: { id: source.id },
    data: sourceStatus === 'COMPLETE'
      ? { status: sourceStatus, completedAt: now, completedByUserId: input.actorUserId }
      : sourceStatus === 'WAIVED'
        ? { status: sourceStatus, waivedAt: now, waivedByUserId: input.actorUserId, waiverReason: input.reason }
        : { status: sourceStatus },
  });
  await tx.hrWorkItemAudit.create({ data: {
    workItemId: source.id,
    actorUserId: input.actorUserId,
    eventType: `DUTY_${input.actionCode === 'APPROVE' ? 'APPROVED' : input.actionCode}`,
    beforeJson: asJson(source),
    afterJson: asJson(updatedSource),
  } });
  await tx.hrDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'COMPLETED', changedByUserId: input.actorUserId },
  });
  const lastAudit = await tx.hrDutyAuditVersion.findFirst({
    where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  const auditVersion = (lastAudit?.version ?? 0) + 1;
  await tx.hrDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: auditVersion,
    eventCode: 'COMPLETED',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ status: duty.status }),
    afterJson: asJson({ status: 'COMPLETED', structuredResult }),
    reason: input.reason,
  } });
  const resultRecipients = [...new Set([
    duty.createdByUserId,
    ...(await destinationManagerIds(tx, duty.destinationWorkspaceCode, now)),
  ])];
  await writeDutyNotification(tx, {
    dutyId: duty.id,
    auditVersion,
    eventType: 'HR_DUTY_RESULT',
    eventCode: 'COMPLETED',
    recipientUserIds: resultRecipients,
    destinationWorkspaceCode: duty.destinationWorkspaceCode,
    actorUserId: input.actorUserId,
  });
  return {
    duty: await tx.hrDuty.findUniqueOrThrow({ where: { id: duty.id } }),
    replayed: false,
  };
});

export const reconcileHrDutyAssignment = (
  database: HrDutyDatabase,
  input: { dutyId: string; actorUserId: string; policyVersion: number; now?: Date; resetDueAt?: Date | null },
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const duty = await tx.hrDuty.findUniqueOrThrow({
    where: { id: input.dutyId },
    include: { responsibility: true, envelope: true },
  });
  if (duty.status !== 'OPEN') {
    const successor = await tx.hrDuty.findFirst({ where: { predecessorDutyId: duty.id } });
    return successor ? { predecessor: duty, successor, replayed: true } : null;
  }
  if (duty.sourceType !== 'HR_WORK_ITEM') throw new Error('HR_DUTY_SOURCE_ADAPTER_NOT_REGISTERED');
  const definition = definitionFor(duty.sourceActionCode);
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  const currentSourceVersion = await legacySourceVersion(tx, source.id);
  if (!['PENDING', 'IN_PROGRESS'].includes(source.status)) {
    await tx.hrDuty.update({ where: { id: duty.id }, data: { status: 'CANCELLED' } });
    await tx.hrDutyAssignmentHistory.updateMany({
      where: { dutyId: duty.id, endedAt: null },
      data: { endedAt: now, endReason: 'SOURCE_CHANGED', changedByUserId: input.actorUserId },
    });
    const previousAudit = await tx.hrDutyAuditVersion.findFirst({
      where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const auditVersion = (previousAudit?.version ?? 0) + 1;
    await tx.hrDutyAuditVersion.create({ data: {
      dutyId: duty.id,
      version: auditVersion,
      eventCode: 'CANCELLED',
      actorUserId: input.actorUserId,
      sourceVersion: currentSourceVersion,
      envelopeVersion: duty.envelopeVersion,
      policyVersion: input.policyVersion,
      beforeJson: asJson({ status: duty.status }),
      afterJson: asJson({ status: 'CANCELLED', sourceStatus: source.status }),
      reason: 'SOURCE_CHANGED',
    } });
    const recipients = duty.currentAssigneeUserId ? [duty.currentAssigneeUserId] : [];
    await writeDutyNotification(tx, {
      dutyId: duty.id,
      auditVersion,
      eventType: 'HR_DUTY_RESULT',
      eventCode: 'CANCELLED',
      recipientUserIds: recipients,
      destinationWorkspaceCode: duty.destinationWorkspaceCode,
      actorUserId: input.actorUserId,
    });
    return {
      predecessor: await tx.hrDuty.findUniqueOrThrow({ where: { id: duty.id } }),
      successor: null,
      replayed: false,
    };
  }
  const priorResponsibility = duty.responsibility;
  if (!priorResponsibility) throw new Error('HR_DUTY_UNASSIGNED_REQUIRES_MANAGER_TRIAGE');
  const resolution = await resolveHrNamedResponsibility(tx, {
    sourceActionCode: duty.sourceActionCode,
    responsibilityTypeCode: priorResponsibility.responsibilityTypeCode,
    scopeType: priorResponsibility.scopeType,
    scopeId: priorResponsibility.scopeId,
    sourceActorUserId: duty.createdByUserId,
    now,
  });
  const destination = resolution.status === 'RESOLVED' ? resolution.destination : await tx.hrResponsibilityDestination.findFirst({
    where: {
      responsibilityTypeCode: priorResponsibility.responsibilityTypeCode,
      scopeType: priorResponsibility.scopeType,
      scopeId: priorResponsibility.scopeId,
      isActive: true,
    },
  });
  const nextAssigneeUserId = resolution.status === 'RESOLVED' ? resolution.assignedUserId : null;
  const sourceChanged = currentSourceVersion !== duty.sourceVersion;
  const assignmentPlan = planHrDutyReassignment({
    status: duty.status,
    currentAssigneeUserId: duty.currentAssigneeUserId,
    currentEnvelopeVersion: duty.envelopeVersion,
    nextAssigneeUserId,
    nextEnvelopeVersion: definition.envelopeVersion,
    dueAt: duty.dueAt,
    resetDueAt: input.resetDueAt ?? null,
  });
  if (!assignmentPlan && !sourceChanged) return null;

  const nextSourceVersion = sourceChanged ? currentSourceVersion : duty.sourceVersion + 1;
  if (!sourceChanged) {
    await tx.hrWorkItemAudit.create({ data: {
      workItemId: source.id,
      actorUserId: input.actorUserId,
      eventType: 'RESPONSIBILITY_CHANGED',
      beforeJson: asJson({ responsibilityId: duty.responsibilityId, assigneeUserId: duty.currentAssigneeUserId }),
      afterJson: asJson({
        responsibilityId: resolution.status === 'RESOLVED' ? resolution.responsibilityId : null,
        assigneeUserId: nextAssigneeUserId,
      }),
    } });
  }
  const predecessorStatus = sourceChanged || definition.envelopeVersion !== duty.envelopeVersion
    ? 'CANCELLED' as const
    : 'WAIVED' as const;
  const endReason = sourceChanged
    ? 'SOURCE_CHANGED' as const
    : resolution.status === 'RESOLVED'
      ? 'REASSIGNED' as const
      : 'OWNER_INELIGIBLE' as const;
  await tx.hrDuty.update({ where: { id: duty.id }, data: { status: predecessorStatus } });
  await tx.hrDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason, changedByUserId: input.actorUserId },
  });
  const predecessorAudit = await tx.hrDutyAuditVersion.findFirst({
    where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  await tx.hrDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: (predecessorAudit?.version ?? 0) + 1,
    eventCode: predecessorStatus,
    actorUserId: input.actorUserId,
    sourceVersion: nextSourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ status: 'OPEN', currentAssigneeUserId: duty.currentAssigneeUserId }),
    afterJson: asJson({ status: predecessorStatus }),
    reason: endReason,
  } });
  const destinationWorkspaceCode = destination?.workspaceCode ?? definition.destinationWorkspaceCode;
  const destinationQueueCode = destination?.queueCode ?? `${priorResponsibility.responsibilityTypeCode}_TRIAGE`;
  const successorStableKey = `hr-duty:${duty.sourceActionCode}:${duty.sourceId}:v${nextSourceVersion}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${successorStableKey}))`;
  const successor = await tx.hrDuty.upsert({
    where: { stableKey: successorStableKey },
    update: {},
    create: {
      stableKey: successorStableKey,
      sourceType: duty.sourceType,
      sourceId: duty.sourceId,
      sourceActionCode: duty.sourceActionCode,
      sourceVersion: nextSourceVersion,
      envelopeCode: definition.envelopeCode,
      envelopeVersion: definition.envelopeVersion,
      destinationWorkspaceCode,
      destinationQueueCode,
      currentAssigneeUserId: nextAssigneeUserId,
      responsibilityId: resolution.status === 'RESOLVED' ? resolution.responsibilityId : null,
      dueAt: assignmentPlan?.successorDueAt ?? input.resetDueAt ?? duty.dueAt,
      predecessorDutyId: duty.id,
      createdByUserId: duty.createdByUserId,
    },
  });
  const hasAssignment = await tx.hrDutyAssignmentHistory.findFirst({ where: { dutyId: successor.id } });
  if (!hasAssignment) await tx.hrDutyAssignmentHistory.create({ data: {
    dutyId: successor.id,
    sequence: 1,
    assignedUserId: successor.currentAssigneeUserId,
    responsibilityId: successor.responsibilityId,
    destinationWorkspaceCode,
    destinationQueueCode,
    startedAt: now,
    changedByUserId: input.actorUserId,
    policyVersion: input.policyVersion,
  } });
  const successorEventCode = nextAssigneeUserId ? 'REASSIGNED' : 'UNASSIGNED_TRIAGE';
  const hasSuccessorAudit = await tx.hrDutyAuditVersion.findFirst({ where: { dutyId: successor.id } });
  if (!hasSuccessorAudit) {
    await tx.hrDutyAuditVersion.create({ data: {
      dutyId: successor.id,
      version: 1,
      eventCode: successorEventCode,
      actorUserId: input.actorUserId,
      sourceVersion: nextSourceVersion,
      envelopeVersion: successor.envelopeVersion,
      policyVersion: input.policyVersion,
      afterJson: asJson({
        status: successor.status,
        predecessorDutyId: duty.id,
        currentAssigneeUserId: successor.currentAssigneeUserId,
      }),
      reason: resolution.status === 'RESOLVED' ? 'RESPONSIBILITY_CHANGED' : resolution.reason,
    } });
    const recipients = nextAssigneeUserId
      ? [nextAssigneeUserId]
      : await destinationManagerIds(tx, destinationWorkspaceCode, now);
    await writeDutyNotification(tx, {
      dutyId: successor.id,
      auditVersion: 1,
      eventType: nextAssigneeUserId ? 'HR_DUTY_REASSIGNED' : 'HR_DUTY_UNASSIGNED_TRIAGE',
      eventCode: successorEventCode,
      recipientUserIds: recipients,
      destinationWorkspaceCode,
      actorUserId: input.actorUserId,
    });
  }
  return {
    predecessor: await tx.hrDuty.findUniqueOrThrow({ where: { id: duty.id } }),
    successor,
    replayed: false,
  };
});

export const processHrDutyDeadlines = (
  database: HrDutyDatabase,
  input: { now?: Date; policyVersion: number },
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const duties = await tx.hrDuty.findMany({
    where: { status: 'OPEN', dueAt: { lte: new Date(now.getTime() + 24 * 60 * 60 * 1_000) } },
    orderBy: { dueAt: 'asc' },
    take: 500,
  });
  const result = { nearDue: 0, overdue: 0, escalated: 0 };
  for (const duty of duties) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hr-duty-deadline:${duty.id}`}))`;
    const existingAudits = await tx.hrDutyAuditVersion.findMany({
      where: { dutyId: duty.id }, orderBy: { version: 'asc' }, select: { version: true, eventCode: true },
    });
    const events = planHrDutyDeadlineEvents({
      status: duty.status,
      dueAt: duty.dueAt,
      now,
      existingEventCodes: existingAudits.map(({ eventCode }) => eventCode),
    });
    let auditVersion = existingAudits.at(-1)?.version ?? 0;
    for (const eventCode of events) {
      auditVersion += 1;
      await tx.hrDutyAuditVersion.create({ data: {
        dutyId: duty.id,
        version: auditVersion,
        eventCode,
        actorUserId: null,
        sourceVersion: duty.sourceVersion,
        envelopeVersion: duty.envelopeVersion,
        policyVersion: input.policyVersion,
        afterJson: asJson({ dueAt: duty.dueAt, overdue: duty.dueAt <= now }),
      } });
      const managerEvent = eventCode === 'MANAGER_ESCALATION';
      const recipients = managerEvent
        ? await destinationManagerIds(tx, duty.destinationWorkspaceCode, now)
        : duty.currentAssigneeUserId ? [duty.currentAssigneeUserId] : [];
      const eventType = eventCode === 'NEAR_DUE'
        ? 'HR_DUTY_NEAR_DUE' as const
        : eventCode === 'OVERDUE'
          ? 'HR_DUTY_OVERDUE' as const
          : 'HR_DUTY_MANAGER_ESCALATION' as const;
      await writeDutyNotification(tx, {
        dutyId: duty.id,
        auditVersion,
        eventType,
        eventCode,
        recipientUserIds: recipients,
        destinationWorkspaceCode: duty.destinationWorkspaceCode,
      });
      if (eventCode === 'NEAR_DUE') result.nearDue += 1;
      else if (eventCode === 'OVERDUE') result.overdue += 1;
      else result.escalated += 1;
    }
  }
  return result;
});

export const startHrDutyDeadlineMaintenance = (prisma: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await syncHrDutyEnvelopeDefinitions(prisma);
      await processHrDutyDeadlines(prisma, { policyVersion: 1 });
    } catch (error) {
      console.error('HR duty deadline maintenance failed:', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
};
