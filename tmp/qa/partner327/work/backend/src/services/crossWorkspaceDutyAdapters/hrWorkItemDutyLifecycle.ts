import { Prisma, type PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from '../notificationService';
import { authorizeHrUser, resolveHrNamedResponsibility } from '../hrAuthorizationService';
import { lockCrossWorkspaceDuty } from '../crossWorkspaceDutyLock';

const responseSchema = Object.freeze({
  type: 'object',
  properties: {
    actionCode: { type: 'string', enum: ['APPROVE', 'REJECT', 'RETURN', 'REQUEST_CLARIFICATION'] },
    reason: { type: ['string', 'null'], minLength: 3 },
  },
  required: ['actionCode', 'reason'],
  additionalProperties: false,
});
const allowedActionCodes = ['APPROVE', 'REJECT', 'RETURN', 'REQUEST_CLARIFICATION'] as const;
function dutyDefinition(
  sourceActionCode: string,
  responsibilityTypeCode: string,
  destinationWorkspaceCode: string | null,
  actionPermissionCode: string | null,
  accountabilityModel: 'SHARED_DECISION' | 'INDIVIDUAL_EXECUTION',
  routingScope: 'GLOBAL' | 'HIRING_POSITION' = 'GLOBAL',
) {
  return {
    sourceActionCode,
    envelopeCode: `HR_${sourceActionCode}`,
    envelopeVersion: 1,
    responsibilityTypeCode,
    actionPermissionCode,
    destinationWorkspaceCode,
    accountabilityModel,
    workspaceAdminOverrideDenied: true,
    routingScope,
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
    actionPermissionCode: 'MANAGE_HR_WORK',
    destinationWorkspaceCode: 'HUMAN_RESOURCES',
    accountabilityModel: 'SHARED_DECISION' as const,
    workspaceAdminOverrideDenied: true,
    routingScope: 'GLOBAL' as const,
    allowedActionCodes,
    responseSchema,
  },
  FINANCE_RECORDING: dutyDefinition('FINANCE_RECORDING', 'FINANCE_RECORDER', 'ACCOUNTING', 'RECORD_COLLATERAL_CUSTODY', 'INDIVIDUAL_EXECUTION'),
  FINANCE_APPROVAL: dutyDefinition('FINANCE_APPROVAL', 'FINANCE_MANAGER', 'ACCOUNTING', 'VERIFY_COLLATERAL_CUSTODY', 'SHARED_DECISION'),
  COMPANY_MANAGER_REVIEW: dutyDefinition('COMPANY_MANAGER_REVIEW', 'COMPANY_MANAGER', null, 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', 'SHARED_DECISION'),
  COMPANY_MANAGER_DECISION: dutyDefinition('COMPANY_MANAGER_DECISION', 'COMPANY_MANAGER', null, 'RECORD_FINAL_MANAGEMENT_DECISION', 'SHARED_DECISION'),
  RESPONSIBLE_SUPERVISOR_REVIEW: dutyDefinition('RESPONSIBLE_SUPERVISOR_REVIEW', 'RESPONSIBLE_SUPERVISOR', null, null, 'SHARED_DECISION', 'HIRING_POSITION'),
  PAYROLL_PREPARATION: dutyDefinition('PAYROLL_PREPARATION', 'HR_PAYROLL_PROCESSOR', 'HUMAN_RESOURCES', 'MANAGE_PAYROLL', 'INDIVIDUAL_EXECUTION'),
  PAYROLL_APPROVAL: dutyDefinition('PAYROLL_APPROVAL', 'HR_PAYROLL_MANAGER', 'HUMAN_RESOURCES', 'MANAGE_PAYROLL', 'SHARED_DECISION'),
});

type DutyDefinition = typeof HR_DUTY_DEFINITIONS[keyof typeof HR_DUTY_DEFINITIONS];

export const deriveHrDutyRoutingContext = (
  definition: DutyDefinition,
  source: { sourceKey: string | null; positionId?: string | null },
) => {
  if (definition.routingScope === 'GLOBAL') return { scopeType: 'GLOBAL', scopeId: null };
  if (!source.positionId) throw new Error('HR_DUTY_SOURCE_SCOPE_UNAVAILABLE');
  return { scopeType: 'POSITION', scopeId: source.positionId };
};

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
  sourceActorUserId?: string | null;
  sharedDecision?: boolean;
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
  if (!input.sharedDecision && input.duty.currentAssigneeUserId !== input.actorUserId) {
    return { allowed: false, code: 'ASSIGNEE_CHANGED' };
  }
  if (input.duty.sourceVersion !== input.expectedSourceVersion) return { allowed: false, code: 'SOURCE_VERSION_CHANGED' };
  if (input.duty.envelopeVersion !== input.expectedEnvelopeVersion) return { allowed: false, code: 'ENVELOPE_VERSION_CHANGED' };
  if (!input.sourceIsCurrent) return { allowed: false, code: 'SOURCE_STATE_CHANGED' };
  if (!input.assigneeIsEligible) return { allowed: false, code: 'ASSIGNEE_INELIGIBLE' };
  if (!input.responsibilityIsCurrent) return { allowed: false, code: 'RESPONSIBILITY_CHANGED' };
  if (input.sourceActorUserId && input.sourceActorUserId === input.actorUserId) {
    return { allowed: false, code: 'SEPARATION_OF_DUTIES_CONFLICT' };
  }
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

const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  );
  return value;
};
const jsonMatches = (left: unknown, right: unknown) => (
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
);
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

const sharedDecisionRecipientIds = async (
  tx: Prisma.TransactionClient,
  actionPermissionCode: string | null,
  sourceActorUserId: string | null,
  now: Date,
) => {
  const users = await tx.user.findMany({
    where: { isActive: true, erasedAt: null, ...(sourceActorUserId ? { id: { not: sourceActorUserId } } : {}) },
    select: { id: true },
  });
  if (!actionPermissionCode) return users.map(({ id }) => id);
  const allowed = await Promise.all(users.map(({ id }) => authorizeHrUser(tx, id, {
    actionPermissionCodes: [actionPermissionCode],
  }, now).then((result) => result.allowed)));
  return users.filter((_user, index) => allowed[index]).map(({ id }) => id);
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
  const identities = await tx.crossWorkspaceDutyNotificationIdentity.createMany({
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
  if (!input.recipientUserIds.length || identities.count === 0) return;
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

const envelopeCodeFor = (definition: DutyDefinition, destinationWorkspaceCode: string) => (
  definition.destinationWorkspaceCode
    ? definition.envelopeCode
    : `${definition.envelopeCode}@${destinationWorkspaceCode}`
);

const assertDutyEnvelopeCurrent = (
  definition: DutyDefinition,
  envelope: {
    code: string;
    version: number;
    destinationWorkspaceCode: string;
    allowedFieldsJson: unknown;
    allowedEvidenceJson: unknown;
    allowedActionCodesJson: unknown;
    responseSchemaJson: unknown;
    isActive: boolean;
  },
) => {
  const isCurrent = envelope.code === envelopeCodeFor(definition, envelope.destinationWorkspaceCode)
    && envelope.version === definition.envelopeVersion
    && (!definition.destinationWorkspaceCode
      || envelope.destinationWorkspaceCode === definition.destinationWorkspaceCode)
    && envelope.isActive
    && jsonMatches(envelope.allowedFieldsJson, definition.allowedFields)
    && jsonMatches(envelope.allowedEvidenceJson, definition.allowedEvidence)
    && jsonMatches(envelope.allowedActionCodesJson, definition.allowedActionCodes)
    && jsonMatches(envelope.responseSchemaJson, definition.responseSchema);
  if (!isCurrent) throw new Error('HR_DUTY_ENVELOPE_VERSION_STALE');
};

const upsertDutyEnvelope = async (
  tx: Prisma.TransactionClient,
  definition: DutyDefinition,
  createdByUserId: string,
  destinationWorkspaceCode: string,
) => {
  const code = envelopeCodeFor(definition, destinationWorkspaceCode);
  const envelope = await tx.crossWorkspaceDutyEnvelope.upsert({
  where: { code_version: {
    code,
    version: definition.envelopeVersion,
  } },
  update: {},
  create: {
    code,
    version: definition.envelopeVersion,
    destinationWorkspaceCode,
    allowedFieldsJson: [...definition.allowedFields],
    allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes],
    responseSchemaJson: definition.responseSchema,
    createdByUserId,
  },
  });
  const matchesDefinition = envelope.destinationWorkspaceCode === destinationWorkspaceCode
    && envelope.isActive
    && jsonMatches(envelope.allowedFieldsJson, definition.allowedFields)
    && jsonMatches(envelope.allowedEvidenceJson, definition.allowedEvidence)
    && jsonMatches(envelope.allowedActionCodesJson, definition.allowedActionCodes)
    && jsonMatches(envelope.responseSchemaJson, definition.responseSchema);
  if (!matchesDefinition) throw new Error('HR_DUTY_ENVELOPE_DEFINITION_CONFLICT');
  return envelope;
};

export const syncHrDutyEnvelopeDefinitions = (
  database: HrDutyDatabase,
  actorUserId = 'SYSTEM',
) => inTransaction(database, async (tx) => Promise.all(
  Object.values(HR_DUTY_DEFINITIONS)
    .filter((definition): definition is DutyDefinition & { destinationWorkspaceCode: string } => Boolean(definition.destinationWorkspaceCode))
    .map((definition) => upsertDutyEnvelope(tx, definition, actorUserId, definition.destinationWorkspaceCode)),
));

export type CreateHrDutyFromLegacyWorkItemInput = {
  sourceWorkItemId: string;
  sourceActionCode: string;
  actorUserId: string;
  policyVersion: number;
  now?: Date;
};

export const createHrDutyFromLegacyWorkItem = (
  database: HrDutyDatabase,
  input: CreateHrDutyFromLegacyWorkItemInput,
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const definition = definitionFor(input.sourceActionCode);
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: input.sourceWorkItemId } });
  if (!['PENDING', 'IN_PROGRESS'].includes(source.status)) throw new Error('HR_DUTY_SOURCE_NOT_ACTIONABLE');
  const applicationId = definition.routingScope === 'HIRING_POSITION'
    ? source.sourceKey?.match(/^HIRING:([^:]+):/)?.[1]
    : null;
  const application = applicationId
    ? await tx.hrJobApplication.findUnique({ where: { id: applicationId }, select: { positionId: true } })
    : null;
  const routingContext = deriveHrDutyRoutingContext(definition, {
    sourceKey: source.sourceKey,
    positionId: application?.positionId,
  });
  const sourceActorUserId = source.createdByUserId;
  const sourceVersion = await legacySourceVersion(tx, source.id);
  const stableKey = `hr-duty:${input.sourceActionCode}:${source.id}:v${sourceVersion}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stableKey}))`;
  const existing = await tx.crossWorkspaceDuty.findUnique({ where: { stableKey } });
  if (existing) return existing;

  const resolution = await resolveHrNamedResponsibility(tx, {
    sourceActionCode: input.sourceActionCode,
    responsibilityTypeCode: definition.responsibilityTypeCode,
    scopeType: routingContext.scopeType,
    scopeId: routingContext.scopeId,
    sourceActorUserId: sourceActorUserId ?? undefined,
    now,
  });
  const configuredDestinations = resolution.status === 'RESOLVED' ? [] : await tx.hrResponsibilityDestination.findMany({
    where: {
      responsibilityTypeCode: definition.responsibilityTypeCode,
      scopeType: routingContext.scopeType,
      scopeId: routingContext.scopeId,
      isActive: true,
    },
  });
  if (resolution.status === 'UNRESOLVED' && configuredDestinations.length !== 1) {
    throw new Error('HR_DUTY_DESTINATION_UNRESOLVED');
  }
  const destination = resolution.status === 'RESOLVED' ? resolution.destination : configuredDestinations[0];
  const destinationWorkspaceCode = destination.workspaceCode;
  const destinationQueueCode = destination.queueCode;
  if (definition.destinationWorkspaceCode && destinationWorkspaceCode !== definition.destinationWorkspaceCode) {
    throw new Error('HR_DUTY_DESTINATION_INCOMPATIBLE_WITH_ENVELOPE');
  }
  const envelope = await upsertDutyEnvelope(tx, definition, input.actorUserId, destinationWorkspaceCode);
  const sharedDecision = definition.accountabilityModel === 'SHARED_DECISION';
  const assigned = !sharedDecision && resolution.status === 'RESOLVED';
  const resolutionReason = resolution.status === 'UNRESOLVED' ? resolution.reason : null;
  const duty = await tx.crossWorkspaceDuty.upsert({
    where: { stableKey },
    update: {},
    create: {
      stableKey,
      sourceType: 'HR_WORK_ITEM',
      sourceId: source.id,
      sourceActionCode: input.sourceActionCode,
      sourceVersion,
      envelopeCode: envelope.code,
      envelopeVersion: definition.envelopeVersion,
      destinationWorkspaceCode,
      destinationQueueCode,
      currentAssigneeUserId: assigned ? resolution.assignedUserId : null,
      responsibilityId: assigned ? resolution.responsibilityId : null,
      routingResponsibilityTypeCode: definition.responsibilityTypeCode,
      routingScopeType: routingContext.scopeType,
      routingScopeId: routingContext.scopeId,
      sourceActorUserId,
      dueAt: source.dueDate,
      createdByUserId: input.actorUserId,
    },
  });
  await tx.crossWorkspaceDutyAssignmentHistory.upsert({
    where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } },
    update: {},
    create: {
      dutyId: duty.id,
      sequence: 1,
      assignedUserId: duty.currentAssigneeUserId,
      responsibilityId: duty.responsibilityId,
      destinationWorkspaceCode,
      destinationQueueCode,
      startedAt: now,
      changedByUserId: input.actorUserId,
      policyVersion: input.policyVersion,
    },
  });
  const eventCode = sharedDecision ? 'QUEUED' : assigned ? 'ASSIGNED' : 'UNASSIGNED_TRIAGE';
  await tx.crossWorkspaceDutyAuditVersion.upsert({
    where: { dutyId_version: { dutyId: duty.id, version: 1 } },
    update: {},
    create: {
      dutyId: duty.id,
      version: 1,
      eventCode,
      actorUserId: input.actorUserId,
      sourceVersion,
      envelopeVersion: definition.envelopeVersion,
      policyVersion: input.policyVersion,
      afterJson: asJson({
        status: duty.status,
        currentAssigneeUserId: duty.currentAssigneeUserId,
        destinationWorkspaceCode,
        destinationQueueCode,
      }),
      reason: sharedDecision || assigned ? null : resolutionReason,
    },
  });
  const routedSource = await tx.hrWorkItem.update({
    where: { id: source.id },
    data: assigned || sharedDecision
      ? { dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null }
      : { dutyRoutingBlockedAt: now, dutyRoutingBlockReason: resolutionReason },
  });
  if (!assigned && !sharedDecision) await tx.hrWorkItemAudit.create({ data: {
    workItemId: source.id,
    actorUserId: input.actorUserId,
    eventType: 'DUTY_ROUTING_BLOCKED',
    beforeJson: asJson(source),
    afterJson: asJson(routedSource),
  } });
  const recipients = sharedDecision
    ? await sharedDecisionRecipientIds(tx, definition.actionPermissionCode, sourceActorUserId, now)
    : assigned ? [resolution.assignedUserId]
      : await destinationManagerIds(tx, destinationWorkspaceCode, now);
  await writeDutyNotification(tx, {
    dutyId: duty.id,
    auditVersion: 1,
    eventType: assigned || sharedDecision ? 'HR_DUTY_ASSIGNED' : 'HR_DUTY_UNASSIGNED_TRIAGE',
    eventCode,
    recipientUserIds: recipients,
    destinationWorkspaceCode,
    actorUserId: input.actorUserId,
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
  await lockCrossWorkspaceDuty(tx, input.dutyId);
  const duty = await tx.crossWorkspaceDuty.findUniqueOrThrow({
    where: { id: input.dutyId },
    include: { envelope: true, responsibility: true },
  });
  const structuredResult = { actionCode: input.actionCode, reason: input.reason };
  if (duty.sourceType !== 'HR_WORK_ITEM') throw new Error('HR_DUTY_SOURCE_ADAPTER_NOT_REGISTERED');
  const definition = definitionFor(duty.sourceActionCode);
  const sharedDecision = definition.accountabilityModel === 'SHARED_DECISION';
  assertDutyEnvelopeCurrent(definition, duty.envelope);
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  const currentSourceVersion = await legacySourceVersion(tx, source.id);
  if (duty.status === 'COMPLETED') {
    const storedResult = duty.structuredResultJson && typeof duty.structuredResultJson === 'object'
      && !Array.isArray(duty.structuredResultJson)
      ? duty.structuredResultJson as Record<string, unknown>
      : null;
    const resultMatches = duty.respondedByUserId === input.actorUserId
      && storedResult?.actionCode === input.actionCode
      && (storedResult.reason ?? null) === input.reason;
    const terminalSourceMatches = storedResult?.actionCode === 'APPROVE'
      ? source.status === 'COMPLETE'
      : storedResult?.actionCode === 'REJECT'
        ? source.status === 'WAIVED'
        : source.status === 'IN_PROGRESS';
    const replayPermission = sharedDecision
      ? { allowed: await canAccessHrWorkItemSharedDecision(tx, {
        dutyId: duty.id, actorUserId: input.actorUserId, includeCompleted: true, now,
      }) }
      : definition.actionPermissionCode
        ? await authorizeHrUser(tx, input.actorUserId, { actionPermissionCodes: [definition.actionPermissionCode] }, now)
        : { allowed: true };
    const replayIsAuthorized = replayPermission.allowed
      && input.expectedSourceVersion === duty.sourceVersion
      && input.expectedEnvelopeVersion === duty.envelopeVersion
      && currentSourceVersion === duty.sourceVersion
      && (sharedDecision || duty.currentAssigneeUserId === input.actorUserId)
      && duty.sourceActorUserId !== input.actorUserId
      && terminalSourceMatches;
    if (resultMatches && replayIsAuthorized) return { duty, replayed: true };
    throw new Error(resultMatches ? 'DUTY_REPLAY_REVALIDATION_FAILED' : sharedDecision ? 'DUTY_ALREADY_DECIDED' : 'DUTY_NOT_OPEN');
  }
  const authorization = await authorizeHrUser(tx, input.actorUserId, {
    ...(!sharedDecision ? { dutyId: duty.id } : {}),
    ...(definition.actionPermissionCode ? { actionPermissionCodes: [definition.actionPermissionCode] } : {}),
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
    responsibilityIsCurrent: true,
    separationOfDutiesSatisfied: duty.sourceActorUserId !== input.actorUserId,
    sourceActorUserId: duty.sourceActorUserId,
    sharedDecision,
    allowedActionCodes: definition.allowedActionCodes,
  });
  if (!decision.allowed) throw new Error(decision.code);

  const claimed = await tx.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN' },
    data: {
      status: 'COMPLETED',
      structuredResultJson: structuredResult,
      respondedAt: now,
      respondedByUserId: input.actorUserId,
    },
  });
  if (!claimed.count) throw new Error(sharedDecision ? 'DUTY_ALREADY_DECIDED' : 'DUTY_RESPONSE_CONFLICT');
  const sourceStatus = input.actionCode === 'APPROVE'
    ? 'COMPLETE' as const
    : input.actionCode === 'REJECT'
      ? 'WAIVED' as const
      : 'IN_PROGRESS' as const;
  const updatedSource = await tx.hrWorkItem.update({
    where: { id: source.id },
    data: sourceStatus === 'COMPLETE'
      ? {
        status: sourceStatus, completedAt: now, completedByUserId: input.actorUserId,
        dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null,
      }
      : sourceStatus === 'WAIVED'
        ? {
          status: sourceStatus, waivedAt: now, waivedByUserId: input.actorUserId, waiverReason: input.reason,
          dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null,
        }
        : { status: sourceStatus, dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null },
  });
  await tx.hrWorkItemAudit.create({ data: {
    workItemId: source.id,
    actorUserId: input.actorUserId,
    eventType: `DUTY_${input.actionCode === 'APPROVE' ? 'APPROVED' : input.actionCode}`,
    beforeJson: asJson(source),
    afterJson: asJson(updatedSource),
  } });
  await tx.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'COMPLETED', changedByUserId: input.actorUserId },
  });
  const lastAudit = await tx.crossWorkspaceDutyAuditVersion.findFirst({
    where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  const auditVersion = (lastAudit?.version ?? 0) + 1;
  await tx.crossWorkspaceDutyAuditVersion.create({ data: {
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
    duty: await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }),
    replayed: false,
  };
});

export const canAccessHrWorkItemSharedDecision = async (
  database: HrDutyDatabase,
  input: { dutyId: string; actorUserId: string; includeCompleted?: boolean; now?: Date },
) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'HR_WORK_ITEM') return false;
  const definition = definitionFor(duty.sourceActionCode);
  if (definition.accountabilityModel !== 'SHARED_DECISION') return false;
  if (!input.includeCompleted && duty.status !== 'OPEN') return false;
  if (duty.sourceActorUserId === input.actorUserId) return false;
  if (!definition.actionPermissionCode) return true;
  return (await authorizeHrUser(database, input.actorUserId, {
    actionPermissionCodes: [definition.actionPermissionCode],
  }, input.now ?? new Date())).allowed;
};

export const reconcileHrDutyAssignment = (
  database: HrDutyDatabase,
  input: { dutyId: string; actorUserId: string; policyVersion: number; now?: Date; resetDueAt?: Date | null },
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const duty = await tx.crossWorkspaceDuty.findUniqueOrThrow({
    where: { id: input.dutyId },
    include: { responsibility: true, envelope: true },
  });
  if (duty.status !== 'OPEN') {
    const successor = await tx.crossWorkspaceDuty.findFirst({ where: { predecessorDutyId: duty.id } });
    return successor ? { predecessor: duty, successor, replayed: true } : null;
  }
  if (duty.sourceType !== 'HR_WORK_ITEM') throw new Error('HR_DUTY_SOURCE_ADAPTER_NOT_REGISTERED');
  const definition = definitionFor(duty.sourceActionCode);
  const sharedDecision = definition.accountabilityModel === 'SHARED_DECISION';
  const source = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  const currentSourceVersion = await legacySourceVersion(tx, source.id);
  if (!['PENDING', 'IN_PROGRESS'].includes(source.status)) {
    await tx.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { status: 'CANCELLED' } });
    await tx.hrWorkItem.update({
      where: { id: source.id },
      data: { dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null },
    });
    await tx.crossWorkspaceDutyAssignmentHistory.updateMany({
      where: { dutyId: duty.id, endedAt: null },
      data: { endedAt: now, endReason: 'SOURCE_CHANGED', changedByUserId: input.actorUserId },
    });
    const previousAudit = await tx.crossWorkspaceDutyAuditVersion.findFirst({
      where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const auditVersion = (previousAudit?.version ?? 0) + 1;
    await tx.crossWorkspaceDutyAuditVersion.create({ data: {
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
      predecessor: await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }),
      successor: null,
      replayed: false,
    };
  }
  if (sharedDecision && currentSourceVersion === duty.sourceVersion) return null;
  const priorResponsibility = duty.responsibility;
  const responsibilityTypeCode = duty.routingResponsibilityTypeCode
    ?? priorResponsibility?.responsibilityTypeCode;
  const scopeType = duty.routingScopeType ?? priorResponsibility?.scopeType;
  const scopeId = duty.routingScopeId ?? priorResponsibility?.scopeId ?? null;
  if (!responsibilityTypeCode || !scopeType) throw new Error('HR_DUTY_ROUTING_CONTEXT_UNAVAILABLE');
  const resolution = await resolveHrNamedResponsibility(tx, {
    sourceActionCode: duty.sourceActionCode,
    responsibilityTypeCode,
    scopeType,
    scopeId,
    sourceActorUserId: duty.sourceActorUserId ?? undefined,
    now,
  });
  const configuredDestinations = resolution.status === 'RESOLVED' ? [] : await tx.hrResponsibilityDestination.findMany({
    where: {
      responsibilityTypeCode,
      scopeType,
      scopeId,
      isActive: true,
    },
  });
  if (resolution.status === 'UNRESOLVED' && configuredDestinations.length !== 1) {
    throw new Error('HR_DUTY_DESTINATION_UNRESOLVED');
  }
  const destination = resolution.status === 'RESOLVED' ? resolution.destination : configuredDestinations[0];
  if (definition.destinationWorkspaceCode
    && destination.workspaceCode !== definition.destinationWorkspaceCode) {
    throw new Error('HR_DUTY_DESTINATION_INCOMPATIBLE_WITH_ENVELOPE');
  }
  const nextAssigneeUserId = sharedDecision ? null : resolution.status === 'RESOLVED' ? resolution.assignedUserId : null;
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
  await tx.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { status: predecessorStatus } });
  await tx.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason, changedByUserId: input.actorUserId },
  });
  const predecessorAudit = await tx.crossWorkspaceDutyAuditVersion.findFirst({
    where: { dutyId: duty.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  await tx.crossWorkspaceDutyAuditVersion.create({ data: {
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
  const destinationWorkspaceCode = destination.workspaceCode;
  const destinationQueueCode = destination.queueCode;
  const envelope = await upsertDutyEnvelope(tx, definition, input.actorUserId, destinationWorkspaceCode);
  const successorStableKey = `hr-duty:${duty.sourceActionCode}:${duty.sourceId}:v${nextSourceVersion}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${successorStableKey}))`;
  const successor = await tx.crossWorkspaceDuty.upsert({
    where: { stableKey: successorStableKey },
    update: {},
    create: {
      stableKey: successorStableKey,
      sourceType: duty.sourceType,
      sourceId: duty.sourceId,
      sourceActionCode: duty.sourceActionCode,
      sourceVersion: nextSourceVersion,
      envelopeCode: envelope.code,
      envelopeVersion: definition.envelopeVersion,
      destinationWorkspaceCode,
      destinationQueueCode,
      currentAssigneeUserId: nextAssigneeUserId,
      responsibilityId: sharedDecision ? null : resolution.status === 'RESOLVED' ? resolution.responsibilityId : null,
      routingResponsibilityTypeCode: responsibilityTypeCode,
      routingScopeType: scopeType,
      routingScopeId: scopeId,
      sourceActorUserId: duty.sourceActorUserId,
      dueAt: assignmentPlan?.successorDueAt ?? input.resetDueAt ?? duty.dueAt,
      predecessorDutyId: duty.id,
      createdByUserId: duty.createdByUserId,
    },
  });
  const hasAssignment = await tx.crossWorkspaceDutyAssignmentHistory.findFirst({ where: { dutyId: successor.id } });
  if (!hasAssignment) await tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
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
  const successorEventCode = sharedDecision ? 'QUEUED' : nextAssigneeUserId ? 'REASSIGNED' : 'UNASSIGNED_TRIAGE';
  const hasSuccessorAudit = await tx.crossWorkspaceDutyAuditVersion.findFirst({ where: { dutyId: successor.id } });
  if (!hasSuccessorAudit) {
    await tx.crossWorkspaceDutyAuditVersion.create({ data: {
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
      reason: sharedDecision ? null : resolution.status === 'RESOLVED' ? 'RESPONSIBILITY_CHANGED' : resolution.reason,
    } });
    const recipients = sharedDecision
      ? await sharedDecisionRecipientIds(tx, definition.actionPermissionCode, duty.sourceActorUserId, now)
      : nextAssigneeUserId
      ? [nextAssigneeUserId]
      : await destinationManagerIds(tx, destinationWorkspaceCode, now);
    await writeDutyNotification(tx, {
      dutyId: successor.id,
      auditVersion: 1,
      eventType: sharedDecision ? 'HR_DUTY_ASSIGNED' : nextAssigneeUserId ? 'HR_DUTY_REASSIGNED' : 'HR_DUTY_UNASSIGNED_TRIAGE',
      eventCode: successorEventCode,
      recipientUserIds: recipients,
      destinationWorkspaceCode,
      actorUserId: input.actorUserId,
    });
  }
  await tx.hrWorkItem.update({
    where: { id: source.id },
    data: resolution.status === 'RESOLVED'
      ? { dutyRoutingBlockedAt: null, dutyRoutingBlockReason: null }
      : { dutyRoutingBlockedAt: now, dutyRoutingBlockReason: resolution.reason },
  });
  return {
    predecessor: await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }),
    successor,
    replayed: false,
  };
});

export const processHrDutyDeadlines = (
  database: HrDutyDatabase,
  input: { now?: Date; policyVersion: number },
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const duties = await tx.crossWorkspaceDuty.findMany({
    where: { status: 'OPEN', dueAt: { lte: new Date(now.getTime() + 24 * 60 * 60 * 1_000) } },
    orderBy: { dueAt: 'asc' },
    take: 500,
  });
  const result = { nearDue: 0, overdue: 0, escalated: 0 };
  for (const duty of duties) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hr-duty-deadline:${duty.id}`}))`;
    const existingAudits = await tx.crossWorkspaceDutyAuditVersion.findMany({
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
      await tx.crossWorkspaceDutyAuditVersion.create({ data: {
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
