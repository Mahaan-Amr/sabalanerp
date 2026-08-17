import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';
import { addTehranWorkingDays } from '../tehranBusinessCalendar';

const responseSchema = Object.freeze({
  type: 'object',
  properties: {
    actionCode: { type: 'string', enum: ['FORWARD_TO_MANAGER', 'RETURN_TO_SELLER'] },
    reason: { type: ['string', 'null'], minLength: 3 },
  },
  required: ['actionCode', 'reason'],
  additionalProperties: false,
});

export const SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS = Object.freeze({
  ACCOUNTING_PROCESS_CONTRACT_CORRECTION: {
    sourceActionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    envelopeCode: 'SALES_CONTRACT_CORRECTION_PROCESSING',
    envelopeVersion: 1,
    responsibilityTypeCode: 'ACCOUNTING_CORRECTION_PROCESSOR',
    actionPermissionCode: 'ACCOUNTING_CORRECTIONS_MANAGE',
    destinationWorkspaceCode: 'ACCOUNTING',
    routingScope: 'GLOBAL' as const,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    allowedActionCodes: ['FORWARD_TO_MANAGER', 'RETURN_TO_SELLER'] as const,
    responseSchema,
  },
  ACCOUNTING_DECIDE_CONTRACT_CORRECTION: {
    sourceActionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
    envelopeCode: 'SALES_CONTRACT_CORRECTION_MANAGER_DECISION',
    envelopeVersion: 1,
    responsibilityTypeCode: 'ACCOUNTING_CORRECTION_MANAGER',
    actionPermissionCode: 'ACCOUNTING_CORRECTIONS_MANAGE',
    destinationWorkspaceCode: 'ACCOUNTING',
    routingScope: 'GLOBAL' as const,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    allowedActionCodes: ['APPROVE', 'DECLINE'] as const,
    responseSchema: { ...responseSchema, properties: {
      actionCode: { type: 'string', enum: ['APPROVE', 'DECLINE'] },
      reason: { type: ['string', 'null'], minLength: 3 },
    } },
  },
  SALES_EDIT_CONTRACT_CORRECTION: {
    sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
    envelopeCode: 'SALES_CONTRACT_CORRECTION_EDIT',
    envelopeVersion: 1,
    responsibilityTypeCode: 'RESPONSIBLE_SELLER',
    actionPermissionCode: 'SALES_CONTRACTS_EDIT',
    destinationWorkspaceCode: 'SALES',
    routingScope: 'CONTRACT' as const,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    allowedActionCodes: [] as const,
    responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  ACCOUNTING_VERIFY_CONTRACT_CORRECTION: {
    sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
    envelopeCode: 'SALES_CONTRACT_CORRECTION_VERIFICATION',
    envelopeVersion: 1,
    responsibilityTypeCode: 'ACCOUNTING_CORRECTION_PROCESSOR',
    actionPermissionCode: 'ACCOUNTING_CORRECTIONS_MANAGE',
    destinationWorkspaceCode: 'ACCOUNTING',
    routingScope: 'GLOBAL' as const,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedEvidence: [] as const,
    allowedActionCodes: ['VERIFY', 'RETURN_TO_SELLER'] as const,
    responseSchema: { ...responseSchema, properties: {
      actionCode: { type: 'string', enum: ['VERIFY', 'RETURN_TO_SELLER'] },
      reason: { type: ['string', 'null'], minLength: 3 },
    } },
  },
});

type Definition = typeof SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS[keyof typeof SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS];
const definitionFor = (actionCode: string): Definition => {
  const found = Object.values(SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS)
    .find((candidate) => candidate.sourceActionCode === actionCode);
  if (!found) throw new Error('DUTY_ACTION_NOT_REGISTERED');
  return found;
};
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

const assertAccountingActor = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  userId: string,
  manager: boolean,
  now: Date,
) => {
  const user = await database.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user?.isActive) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return;
  const [workspace, feature] = await Promise.all([
    database.workspacePermission.findFirst({ where: {
      userId, workspace: 'accounting', permissionLevel: { in: manager ? ['admin'] : ['edit', 'admin'] }, isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    } }),
    database.featurePermission.findFirst({ where: {
      userId, workspace: 'accounting', feature: 'accounting_corrections_manage',
      permissionLevel: { in: manager ? ['admin'] : ['edit', 'admin'] }, isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    } }),
  ]);
  if (!workspace || !feature) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
};

const upsertEnvelope = (
  database: Parameters<CrossWorkspaceDutySourceAdapter['synchronize']>[0],
  definition: Definition,
  actorUserId: string,
) => database.crossWorkspaceDutyEnvelope.upsert({
  where: { code_version: { code: definition.envelopeCode, version: definition.envelopeVersion } },
  update: { isActive: true },
  create: {
    code: definition.envelopeCode,
    version: definition.envelopeVersion,
    destinationWorkspaceCode: definition.destinationWorkspaceCode,
    destinationFeatureCode: definition.actionPermissionCode,
    allowedFieldsJson: [...definition.allowedFields],
    allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes],
    responseSchemaJson: asJson(definition.responseSchema),
    createdByUserId: actorUserId,
  },
});

export const syncSalesContractCorrectionDutyDefinitions = (
  database: Parameters<CrossWorkspaceDutySourceAdapter['synchronize']>[0],
  actorUserId = 'SYSTEM',
) => Promise.all(Object.values(SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS)
  .map((definition) => upsertEnvelope(database, definition, actorUserId)));

const createStageDuty = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['synchronize']>[0],
  input: {
    correctionId: string;
    sourceActorUserId: string;
    actionCode: string;
    sourceVersion: number;
    assigneeUserId: string | null;
    actorUserId: string;
    dueAt: Date;
    predecessorDutyId?: string;
    policyVersion: number;
    now: Date;
  },
) => {
  const stageDefinition = definitionFor(input.actionCode);
  await upsertEnvelope(database, stageDefinition, input.actorUserId);
  const stableKey = `SALES_CONTRACT_CORRECTION:${input.correctionId}:${input.actionCode}:${input.sourceVersion}`;
  const duty = await database.crossWorkspaceDuty.upsert({
    where: { stableKey },
    update: {},
    create: {
      stableKey,
      sourceType: 'SALES_CONTRACT_CORRECTION',
      sourceId: input.correctionId,
      sourceActionCode: input.actionCode,
      sourceVersion: input.sourceVersion,
      envelopeCode: stageDefinition.envelopeCode,
      envelopeVersion: stageDefinition.envelopeVersion,
      destinationWorkspaceCode: stageDefinition.destinationWorkspaceCode,
      destinationQueueCode: input.actionCode,
      currentAssigneeUserId: input.assigneeUserId,
      sourceActorUserId: input.sourceActorUserId,
      dueAt: input.dueAt,
      predecessorDutyId: input.predecessorDutyId,
      createdByUserId: input.actorUserId,
    },
  });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({
    where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } },
    update: {},
    create: {
      dutyId: duty.id, sequence: 1, assignedUserId: input.assigneeUserId,
      destinationWorkspaceCode: stageDefinition.destinationWorkspaceCode,
      destinationQueueCode: input.actionCode, startedAt: input.now,
      changedByUserId: input.actorUserId, policyVersion: input.policyVersion,
    },
  });
  await database.crossWorkspaceDutyAuditVersion.upsert({
    where: { dutyId_version: { dutyId: duty.id, version: 1 } }, update: {},
    create: {
      dutyId: duty.id, version: 1, eventCode: input.assigneeUserId ? 'ASSIGNED' : 'QUEUED', actorUserId: input.actorUserId,
      sourceVersion: input.sourceVersion, envelopeVersion: stageDefinition.envelopeVersion,
      policyVersion: input.policyVersion,
      afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: input.assigneeUserId }),
    },
  });
  return duty;
};

const synchronize = async (database: Parameters<CrossWorkspaceDutySourceAdapter['synchronize']>[0], input: Parameters<CrossWorkspaceDutySourceAdapter['synchronize']>[1]) => {
  const definition = definitionFor(input.dutyTypeCode);
  if (definition.sourceActionCode !== 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION') throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
  const correction = await database.accountingCorrectionRequest.findUnique({
    where: { id: input.sourceId },
  });
  if (!correction?.contractId) throw new Error('DUTY_SOURCE_CHANGED');
  if (correction.status !== 'OPEN') throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');

  const dueAt = addTehranWorkingDays(input.now ?? correction.createdAt, 1);
  return createStageDuty(database, {
    correctionId: correction.id, sourceActorUserId: correction.createdBy,
    actionCode: definition.sourceActionCode, sourceVersion: correction.dutySourceVersion,
    assigneeUserId: null, actorUserId: input.actorUserId,
    dueAt, policyVersion: input.policyVersion, now: input.now ?? correction.createdAt,
  });
};

const claim: CrossWorkspaceDutySourceAdapter['claim'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  const claimPolicy = {
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: { sourceStatus: 'OPEN', manager: false },
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: { sourceStatus: 'ACKNOWLEDGED', manager: true },
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: { sourceStatus: 'SALES_EDITED', manager: false },
  }[duty.sourceActionCode];
  if (!claimPolicy) throw new Error('DUTY_CLAIM_NOT_SUPPORTED');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId) throw new Error('DUTY_ALREADY_CLAIMED');
  if (duty.sourceActorUserId === input.actorUserId) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  await assertAccountingActor(database, input.actorUserId, claimPolicy.manager, now);
  const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
  if (!correction || correction.status !== claimPolicy.sourceStatus || correction.assignedToUserId) {
    throw new Error('SOURCE_STATE_CHANGED');
  }

  const claimed = await database.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: null },
    data: { currentAssigneeUserId: input.actorUserId },
  });
  if (!claimed.count) throw new Error('DUTY_CLAIM_CONFLICT');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: input.actorUserId },
  });
  await database.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id,
    sequence: 2,
    assignedUserId: input.actorUserId,
    destinationWorkspaceCode: duty.destinationWorkspaceCode,
    destinationQueueCode: duty.destinationQueueCode,
    startedAt: now,
    changedByUserId: input.actorUserId,
    policyVersion: input.policyVersion,
  } });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: 2,
    eventCode: 'CLAIMED',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ status: 'OPEN', currentAssigneeUserId: null }),
    afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: input.actorUserId }),
  } });
  const sourceClaim = await database.accountingCorrectionRequest.updateMany({
    where: { id: correction.id, status: claimPolicy.sourceStatus, assignedToUserId: null },
    data: { assignedToUserId: input.actorUserId },
  });
  if (!sourceClaim.count) throw new Error('DUTY_CLAIM_CONFLICT');
  return database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
};

const canClaim: CrossWorkspaceDutySourceAdapter['canClaim'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  const claimPolicy = duty ? {
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: { sourceStatus: 'OPEN', manager: false },
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: { sourceStatus: 'ACKNOWLEDGED', manager: true },
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: { sourceStatus: 'SALES_EDITED', manager: false },
  }[duty.sourceActionCode] : undefined;
  if (!duty
    || duty.sourceType !== 'SALES_CONTRACT_CORRECTION'
    || !claimPolicy
    || duty.status !== 'OPEN'
    || duty.currentAssigneeUserId
    || duty.sourceActorUserId === input.actorUserId) return false;
  try {
    await assertAccountingActor(database, input.actorUserId, claimPolicy.manager, now);
    const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
    return Boolean(correction && correction.status === claimPolicy.sourceStatus && !correction.assignedToUserId);
  } catch {
    return false;
  }
};

const nextAuditVersion = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  dutyId: string,
) => (await database.crossWorkspaceDutyAuditVersion.aggregate({
  where: { dutyId },
  _max: { version: true },
}))._max.version! + 1;

const reassign: CrossWorkspaceDutySourceAdapter['reassign'] = async (database, input) => {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('REASON_REQUIRED');
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId !== input.expectedAssigneeUserId) throw new Error('ASSIGNEE_CHANGED');
  if (duty.sourceActorUserId === input.actorUserId || duty.sourceActorUserId === input.targetUserId) {
    throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  }
  await assertAccountingActor(database, input.actorUserId, true, now);
  const targetRequiresManager = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
  if (![
    'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
    'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
  ].includes(duty.sourceActionCode)) throw new Error('DUTY_REASSIGN_NOT_SUPPORTED');
  await assertAccountingActor(database, input.targetUserId, targetRequiresManager, now);
  const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
  const expectedStatus = ({
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: 'OPEN',
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: 'ACKNOWLEDGED',
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: 'SALES_EDITED',
  } as Record<string, 'OPEN' | 'ACKNOWLEDGED' | 'SALES_EDITED'>)[duty.sourceActionCode];
  if (!correction
    || correction.status !== expectedStatus
    || correction.assignedToUserId !== input.expectedAssigneeUserId) throw new Error('SOURCE_STATE_CHANGED');

  const changed = await database.crossWorkspaceDuty.updateMany({
    where: {
      id: duty.id,
      status: 'OPEN',
      currentAssigneeUserId: input.expectedAssigneeUserId,
    },
    data: { currentAssigneeUserId: input.targetUserId },
  });
  if (!changed.count) throw new Error('DUTY_REASSIGN_CONFLICT');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: input.actorUserId },
  });
  const lastAssignment = await database.crossWorkspaceDutyAssignmentHistory.aggregate({
    where: { dutyId: duty.id },
    _max: { sequence: true },
  });
  await database.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id,
    sequence: (lastAssignment._max.sequence ?? 0) + 1,
    assignedUserId: input.targetUserId,
    destinationWorkspaceCode: duty.destinationWorkspaceCode,
    destinationQueueCode: duty.destinationQueueCode,
    startedAt: now,
    changedByUserId: input.actorUserId,
    policyVersion: input.policyVersion,
  } });
  const sourceChanged = await database.accountingCorrectionRequest.updateMany({
    where: {
      id: correction.id,
      status: expectedStatus,
      assignedToUserId: input.expectedAssigneeUserId,
    },
    data: { assignedToUserId: input.targetUserId },
  });
  if (!sourceChanged.count) throw new Error('DUTY_REASSIGN_CONFLICT');
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: await nextAuditVersion(database, duty.id),
    eventCode: 'REASSIGNED',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    reason,
    beforeJson: asJson({ status: 'OPEN', currentAssigneeUserId: input.expectedAssigneeUserId }),
    afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: input.targetUserId }),
  } });
  return database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
};

const listEligibleAssignees: CrossWorkspaceDutySourceAdapter['listEligibleAssignees'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.destinationWorkspaceCode !== input.workspaceCode) throw new Error('DUTY_DESTINATION_CHANGED');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  await assertAccountingActor(database, input.actorUserId, true, now);
  if (duty.sourceActorUserId === input.actorUserId) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  const managerTarget = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
  if (![
    'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
    'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
  ].includes(duty.sourceActionCode)) return [];
  const permissionLevels = managerTarget ? ['admin'] : ['edit', 'admin'];
  const users = await database.user.findMany({
    where: {
      isActive: true,
      erasedAt: null,
      id: { notIn: [duty.sourceActorUserId, duty.currentAssigneeUserId].filter((id): id is string => Boolean(id)) },
      OR: [
        { role: { in: ['ADMIN', 'MANAGER'] } },
        {
          workspacePermissions: { some: {
            workspace: 'accounting', permissionLevel: { in: permissionLevels }, isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          } },
          featurePermissions: { some: {
            workspace: 'accounting', feature: 'accounting_corrections_manage',
            permissionLevel: { in: permissionLevels }, isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          } },
        },
      ],
    },
    select: { id: true, firstName: true, lastName: true, username: true, role: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return users.map((user) => ({
    id: user.id,
    displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    username: user.username,
    role: user.role,
  }));
};

const respond: CrossWorkspaceDutySourceAdapter['respond'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId !== input.actorUserId) throw new Error('ASSIGNEE_CHANGED');
  if (duty.sourceActorUserId === input.actorUserId) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  if (duty.sourceVersion !== input.expectedSourceVersion) throw new Error('SOURCE_VERSION_CHANGED');
  if (duty.envelopeVersion !== input.expectedEnvelopeVersion) throw new Error('ENVELOPE_VERSION_CHANGED');
  const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
  if (!correction || correction.dutySourceVersion !== duty.sourceVersion) throw new Error('SOURCE_STATE_CHANGED');

  let nextStatus: 'ACKNOWLEDGED' | 'APPROVED_FOR_SALES_EDIT' | 'RESOLVED' | 'CANCELLED';
  let nextAction: string | null;
  let nextAssignee: string | null;
  let dueAt: Date | null;
  if (duty.sourceActionCode === 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION') {
    await assertAccountingActor(database, input.actorUserId, false, now);
    if (input.actionCode === 'FORWARD_TO_MANAGER') {
      nextStatus = 'ACKNOWLEDGED';
      nextAction = 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
      nextAssignee = null;
      dueAt = addTehranWorkingDays(now, 1);
    } else if (input.actionCode === 'RETURN_TO_SELLER') {
      if (!input.reason?.trim()) throw new Error('REASON_REQUIRED');
      nextStatus = 'CANCELLED';
      nextAction = null;
      nextAssignee = null;
      dueAt = null;
    } else throw new Error('ACTION_NOT_ALLOWED');
  } else if (duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION') {
    await assertAccountingActor(database, input.actorUserId, true, now);
    if (input.actionCode === 'APPROVE') {
      nextStatus = 'APPROVED_FOR_SALES_EDIT';
      nextAction = 'SALES_EDIT_CONTRACT_CORRECTION';
      nextAssignee = correction.createdBy;
      dueAt = addTehranWorkingDays(now, 3);
    } else if (input.actionCode === 'DECLINE') {
      if (!input.reason?.trim()) throw new Error('REASON_REQUIRED');
      nextStatus = 'CANCELLED';
      nextAction = null;
      nextAssignee = null;
      dueAt = null;
    } else throw new Error('ACTION_NOT_ALLOWED');
  } else if (duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION') {
    await assertAccountingActor(database, input.actorUserId, false, now);
    if (!input.reason?.trim()) throw new Error('REASON_REQUIRED');
    if (input.actionCode === 'VERIFY') {
      nextStatus = 'RESOLVED';
      nextAction = null;
      nextAssignee = null;
      dueAt = null;
    } else if (input.actionCode === 'RETURN_TO_SELLER') {
      nextStatus = 'ACKNOWLEDGED';
      nextAction = 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
      nextAssignee = null;
      dueAt = addTehranWorkingDays(now, 1);
    } else throw new Error('ACTION_NOT_ALLOWED');
  } else throw new Error('ACTION_NOT_ALLOWED');

  const claimed = await database.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN' },
    data: {
      status: 'COMPLETED', structuredResultJson: asJson({ actionCode: input.actionCode, reason: input.reason }),
      respondedAt: now, respondedByUserId: input.actorUserId,
    },
  });
  if (!claimed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'COMPLETED', changedByUserId: input.actorUserId },
  });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: 'COMPLETED', actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion, reason: input.reason,
    afterJson: asJson({ status: 'COMPLETED', actionCode: input.actionCode }),
  } });
  const updatedCorrection = await database.accountingCorrectionRequest.update({
    where: { id: correction.id },
    data: {
      status: nextStatus,
      assignedToUserId: nextAssignee,
      dutySourceVersion: { increment: 1 },
      resolutionNote: input.reason ?? correction.resolutionNote,
      ...(['CANCELLED', 'RESOLVED'].includes(nextStatus) ? { resolvedBy: input.actorUserId, resolvedAt: now } : {}),
    },
  });
  await database.accountingAuditLog.create({ data: {
    action: input.actionCode === 'FORWARD_TO_MANAGER'
      ? 'PROCESSOR_FORWARDED_CONTRACT_CORRECTION'
      : input.actionCode === 'RETURN_TO_SELLER' && duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION'
        ? 'ACCOUNTING_RETURNED_CONTRACT_CORRECTION_TO_MANAGER'
        : input.actionCode === 'RETURN_TO_SELLER'
          ? 'PROCESSOR_RETURNED_CONTRACT_CORRECTION'
      : input.actionCode === 'APPROVE'
        ? 'MANAGER_APPROVED_CONTRACT_CORRECTION'
        : input.actionCode === 'VERIFY'
          ? 'ACCOUNTING_VERIFIED_CONTRACT_CORRECTION'
          : 'MANAGER_DECLINED_CONTRACT_CORRECTION',
    actorId: input.actorUserId, contractId: correction.contractId,
    entityType: 'AccountingCorrectionRequest', entityId: correction.id,
    beforeState: asJson(correction), afterState: asJson(updatedCorrection), note: input.reason,
    createdAt: now,
  } });
  const predecessor = await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
  const successor = nextAction && dueAt
    ? await createStageDuty(database, {
      correctionId: correction.id, sourceActorUserId: correction.createdBy,
      actionCode: nextAction, sourceVersion: updatedCorrection.dutySourceVersion, assigneeUserId: nextAssignee,
      actorUserId: input.actorUserId, dueAt, predecessorDutyId: duty.id,
      policyVersion: input.policyVersion, now,
    })
    : null;
  return { correction: updatedCorrection, predecessor, successor, replayed: false };
};

export const completeSalesCorrectionEditDuty = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  input: { contractId: string; actorUserId: string; note: string | null; policyVersion: number; now: Date },
) => {
  const correction = await database.accountingCorrectionRequest.findFirst({
    where: { contractId: input.contractId, status: 'APPROVED_FOR_SALES_EDIT' },
    orderBy: { updatedAt: 'desc' },
  });
  if (!correction) {
    const consumed = await database.accountingCorrectionRequest.findFirst({
      where: { contractId: input.contractId, status: 'SALES_EDITED' },
      select: { id: true },
    });
    throw new Error(consumed ? 'DUTY_SALES_EDIT_ALREADY_CONSUMED' : 'DUTY_SALES_EDIT_NOT_AVAILABLE');
  }
  if (correction.createdBy !== input.actorUserId) throw new Error('DUTY_REQUESTER_NOT_RESPONSIBLE_SELLER');
  const salesDuty = await database.crossWorkspaceDuty.findFirst({
    where: {
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: correction.id,
      sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN',
    },
  });
  if (!salesDuty) throw new Error('DUTY_SALES_EDIT_ALREADY_CONSUMED');
  if (salesDuty.currentAssigneeUserId !== input.actorUserId) throw new Error('ASSIGNEE_CHANGED');
  if (salesDuty.dueAt < input.now) throw new Error('DUTY_SALES_EDIT_EXPIRED');
  const processorDuty = await database.crossWorkspaceDuty.findFirst({
    where: {
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: correction.id,
      sourceActionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    },
    select: { respondedByUserId: true, currentAssigneeUserId: true },
  });
  const processorUserId = processorDuty?.respondedByUserId ?? processorDuty?.currentAssigneeUserId;
  if (!processorUserId || processorUserId === input.actorUserId) throw new Error('DUTY_VERIFIER_UNAVAILABLE');
  const claimed = await database.crossWorkspaceDuty.updateMany({
    where: { id: salesDuty.id, status: 'OPEN' },
    data: {
      status: 'COMPLETED', structuredResultJson: asJson({ actionCode: 'SALES_EDIT_SAVED', reason: input.note }),
      respondedAt: input.now, respondedByUserId: input.actorUserId,
    },
  });
  if (!claimed.count) throw new Error('DUTY_SALES_EDIT_ALREADY_CONSUMED');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: salesDuty.id, endedAt: null },
    data: { endedAt: input.now, endReason: 'COMPLETED', changedByUserId: input.actorUserId },
  });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: salesDuty.id, version: 2, eventCode: 'COMPLETED', actorUserId: input.actorUserId,
    sourceVersion: salesDuty.sourceVersion, envelopeVersion: salesDuty.envelopeVersion,
    policyVersion: input.policyVersion, reason: input.note,
    afterJson: asJson({ status: 'COMPLETED', actionCode: 'SALES_EDIT_SAVED' }),
  } });
  const updatedCorrection = await database.accountingCorrectionRequest.update({
    where: { id: correction.id },
    data: {
      status: 'SALES_EDITED', assignedToUserId: processorUserId,
      dutySourceVersion: { increment: 1 },
      resolutionNote: [correction.resolutionNote, input.note].filter(Boolean).join('\n') || null,
    },
  });
  await database.accountingAuditLog.create({ data: {
    action: 'SALES_CORRECTION_SAVED', actorId: input.actorUserId, contractId: input.contractId,
    entityType: 'AccountingCorrectionRequest', entityId: correction.id,
    beforeState: asJson(correction), afterState: asJson(updatedCorrection), note: input.note,
    createdAt: input.now,
  } });
  const successor = await createStageDuty(database, {
    correctionId: correction.id, sourceActorUserId: correction.createdBy,
    actionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', sourceVersion: updatedCorrection.dutySourceVersion,
    assigneeUserId: processorUserId, actorUserId: input.actorUserId,
    dueAt: addTehranWorkingDays(input.now, 1),
    predecessorDutyId: salesDuty.id, policyVersion: input.policyVersion, now: input.now,
  });
  return {
    correction: updatedCorrection,
    predecessor: await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: salesDuty.id } }),
    successor,
  };
};

export const salesContractCorrectionDutyAdapter = {
  sourceType: 'SALES_CONTRACT_CORRECTION',
  synchronize,
  claim,
  canClaim,
  reassign,
  listEligibleAssignees,
  respond,
  reconcileAssignment: async () => { throw new Error('DUTY_ACTION_NOT_IMPLEMENTED'); },
  loadInboxProjection: async (database, input) => {
    const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: input.sourceId } });
    if (!correction?.contractId) throw new Error('DUTY_SOURCE_CHANGED');
    const contract = await database.salesContract.findUnique({
      where: { id: correction.contractId },
      select: { contractNumber: true },
    });
    if (!contract) throw new Error('DUTY_SOURCE_CHANGED');
    return {
      title: `اصلاح قرارداد ${contract.contractNumber}`,
      description: correction.accountantNote,
      sourceIsCurrent: input.sourceVersion === correction.dutySourceVersion,
    };
  },
} satisfies CrossWorkspaceDutySourceAdapter;
