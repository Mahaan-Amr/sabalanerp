import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';
import { addTehranWorkingDays } from '../tehranBusinessCalendar';
import { resolveNarrowFeatureAccess } from '../narrowFeatureAccess';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { lockCrossWorkspaceDuty } from '../crossWorkspaceDutyLock';
import { resolveWorkspaceDutyAuthority } from '../crossWorkspaceDutyAuthority';

const ACCOUNTING_CORRECTION_FEATURES = Object.freeze({
  PROCESS: ['accounting_corrections_manage'],
  DECIDE: ['accounting_corrections_approve'],
  VERIFY: ['accounting_corrections_verify'],
});

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
    accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
    workspaceAdminOverrideDenied: false,
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
    actionPermissionCode: 'ACCOUNTING_CORRECTIONS_APPROVE',
    destinationWorkspaceCode: 'ACCOUNTING',
    routingScope: 'GLOBAL' as const,
    accountabilityModel: 'SHARED_DECISION' as const,
    workspaceAdminOverrideDenied: false,
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
    accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
    workspaceAdminOverrideDenied: false,
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
    actionPermissionCode: 'ACCOUNTING_CORRECTIONS_VERIFY',
    destinationWorkspaceCode: 'ACCOUNTING',
    routingScope: 'GLOBAL' as const,
    accountabilityModel: 'SHARED_DECISION' as const,
    workspaceAdminOverrideDenied: false,
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
const accountingFeatureFor = (actionCode: string) => ({
  ACCOUNTING_PROCESS_CONTRACT_CORRECTION: ACCOUNTING_CORRECTION_FEATURES.PROCESS[0],
  ACCOUNTING_DECIDE_CONTRACT_CORRECTION: ACCOUNTING_CORRECTION_FEATURES.DECIDE[0],
  ACCOUNTING_VERIFY_CONTRACT_CORRECTION: ACCOUNTING_CORRECTION_FEATURES.VERIFY[0],
} as Record<string, string>)[actionCode];
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const lockDutyAuditStream = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  dutyId: string,
) => lockCrossWorkspaceDuty(database, dutyId);

const assertAccountingActor = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  userId: string,
  features: readonly string[],
  now: Date,
) => {
  const user = await database.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user?.isActive) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
  if (user.role === 'ADMIN') return;
  for (const feature of features) {
    const access = await resolveNarrowFeatureAccess(database as any, {
      userId,
      role: user.role,
      workspace: 'accounting',
      feature,
      requiredPermission: 'edit',
    }, now);
    if (access.allowed) return;
  }
  throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
};

const isSystemAdmin = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  userId: string,
) => (await database.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role === 'ADMIN';

const assertSalesActor = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  userId: string,
  required: 'edit' | 'admin',
  now: Date,
) => {
  const user = await database.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user?.isActive) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
  const effective = await getEffectiveUserAccess(database as any, { userId, userRole: user.role, at: now });
  const rank = { view: 1, edit: 2, admin: 3 } as const;
  const workspace = effective.workspaces.find((grant) => grant.workspace === 'sales');
  const feature = effective.features.find((grant) => grant.feature === 'sales_contracts_edit');
  if (!workspace || !feature || rank[workspace.permission] < rank[required] || rank[feature.permission] < rank[required]) {
    throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
  }
};

const assertSalesReassignmentManager = async (
  database: Parameters<CrossWorkspaceDutySourceAdapter['respond']>[0],
  userId: string,
  now: Date,
) => {
  const authority = await resolveWorkspaceDutyAuthority(database, {
    userId, workspace: 'sales', feature: 'sales_contracts_edit', at: now,
  });
  if (!authority.canSelfDecide) throw new Error('DUTY_REASSIGN_FORBIDDEN');
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
  const correction = await database.accountingCorrectionRequest.findUnique({
    where: { id: input.sourceId },
  });
  if (!correction?.contractId) throw new Error('DUTY_SOURCE_CHANGED');
  const expectedStatus = definition.sourceActionCode === 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION'
    ? 'OPEN'
    : definition.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION'
      ? 'ACKNOWLEDGED'
      : null;
  if (!expectedStatus || correction.status !== expectedStatus) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');

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
  await lockDutyAuditStream(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  if (definitionFor(duty.sourceActionCode).accountabilityModel === 'SHARED_DECISION') {
    throw new Error('DUTY_CLAIM_NOT_SUPPORTED');
  }
  const claimPolicy = {
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: { sourceStatus: 'OPEN', features: ACCOUNTING_CORRECTION_FEATURES.PROCESS },
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: { sourceStatus: 'ACKNOWLEDGED', features: ACCOUNTING_CORRECTION_FEATURES.DECIDE },
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: { sourceStatus: 'SALES_EDITED', features: ACCOUNTING_CORRECTION_FEATURES.VERIFY },
  }[duty.sourceActionCode];
  if (!claimPolicy) throw new Error('DUTY_CLAIM_NOT_SUPPORTED');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId) throw new Error('DUTY_ALREADY_CLAIMED');
  const selfDecision = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION'
    && duty.sourceActorUserId === input.actorUserId;
  const adminOverride = selfDecision && await isSystemAdmin(database, input.actorUserId);
  if (selfDecision && !adminOverride) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  if (adminOverride && String(input.reason ?? '').trim().length < 3) throw new Error('REASON_REQUIRED');
  await assertAccountingActor(database, input.actorUserId, claimPolicy.features, now);
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
    version: await nextAuditVersion(database, duty.id),
    eventCode: 'CLAIMED',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ status: 'OPEN', currentAssigneeUserId: null }),
    afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: input.actorUserId }),
  } });
  if (adminOverride) await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: await nextAuditVersion(database, duty.id),
    eventCode: 'ADMIN_OVERRIDE_CLAIM_SEPARATION_OF_DUTIES',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ sourceActorUserId: duty.sourceActorUserId, currentAssigneeUserId: null }),
    afterJson: asJson({ currentAssigneeUserId: input.actorUserId }),
    reason: String(input.reason).trim(),
  } });
  const sourceClaim = await database.accountingCorrectionRequest.updateMany({
    where: { id: correction.id, status: claimPolicy.sourceStatus, assignedToUserId: null },
    data: { assignedToUserId: input.actorUserId },
  });
  if (!sourceClaim.count) throw new Error('DUTY_CLAIM_CONFLICT');
  return database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
};

const claimRequiresReason: CrossWorkspaceDutySourceAdapter['claimRequiresReason'] = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({
    where: { id: input.dutyId },
    select: { sourceActionCode: true, sourceActorUserId: true },
  });
  return Boolean(duty
    && duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION'
    && duty.sourceActorUserId === input.actorUserId
    && await isSystemAdmin(database, input.actorUserId));
};

const responseRequiresReason: CrossWorkspaceDutySourceAdapter['responseRequiresReason'] = async () => false;

const canAccessSharedDecision: CrossWorkspaceDutySourceAdapter['canAccessSharedDecision'] = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') return false;
  const definition = definitionFor(duty.sourceActionCode);
  const feature = accountingFeatureFor(duty.sourceActionCode);
  if (definition.accountabilityModel !== 'SHARED_DECISION' || !feature) return false;
  if (!input.includeCompleted && duty.status !== 'OPEN') return false;
  const authority = await resolveWorkspaceDutyAuthority(database, {
    userId: input.actorUserId,
    workspace: 'accounting',
    feature,
    at: input.now,
  });
  if (!authority.hasFeatureEdit) return false;
  return duty.sourceActorUserId !== input.actorUserId || authority.canSelfDecide;
};

const sharedDecisionAccessProvenance: NonNullable<CrossWorkspaceDutySourceAdapter['sharedDecisionAccessProvenance']> = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  const feature = duty && accountingFeatureFor(duty.sourceActionCode);
  if (!duty || !feature) return [];
  const authority = await resolveWorkspaceDutyAuthority(database, {
    userId: input.actorUserId, workspace: 'accounting', feature, at: input.now,
  });
  const labels: Record<string, string> = {
    SYSTEM_ADMIN_OVERRIDE: 'اختیار مدیر سیستم', DIRECT_WORKSPACE: 'مدیریت مستقیم فضای کاری',
    ROLE_WORKSPACE: 'مدیریت فضای کاری از نقش', DIRECT_FEATURE: 'مجوز مستقیم قابلیت',
    ROLE_FEATURE: 'مجوز قابلیت از نقش',
  };
  return [authority.provenance.workspace, authority.provenance.feature]
    .filter(Boolean)
    .map((grant) => labels[grant!.source] ?? 'مجوز مؤثر سازمانی');
};

const canClaim: CrossWorkspaceDutySourceAdapter['canClaim'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  const claimPolicy = duty ? {
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: { sourceStatus: 'OPEN', features: ACCOUNTING_CORRECTION_FEATURES.PROCESS },
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: { sourceStatus: 'ACKNOWLEDGED', features: ACCOUNTING_CORRECTION_FEATURES.DECIDE },
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: { sourceStatus: 'SALES_EDITED', features: ACCOUNTING_CORRECTION_FEATURES.VERIFY },
  }[duty.sourceActionCode] : undefined;
  if (!duty
    || duty.sourceType !== 'SALES_CONTRACT_CORRECTION'
    || !claimPolicy
    || duty.status !== 'OPEN'
    || duty.currentAssigneeUserId) return false;
  if (definitionFor(duty.sourceActionCode).accountabilityModel === 'SHARED_DECISION') return false;
  try {
    if (duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION'
      && duty.sourceActorUserId === input.actorUserId
      && !await isSystemAdmin(database, input.actorUserId)) return false;
    await assertAccountingActor(database, input.actorUserId, claimPolicy.features, now);
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
  await lockDutyAuditStream(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId !== input.expectedAssigneeUserId) throw new Error('ASSIGNEE_CHANGED');
  const targetRequiresManager = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
  const salesStage = duty.sourceActionCode === 'SALES_EDIT_CONTRACT_CORRECTION';
  if (definitionFor(duty.sourceActionCode).accountabilityModel === 'SHARED_DECISION') {
    throw new Error('DUTY_REASSIGN_NOT_SUPPORTED');
  }
  if (targetRequiresManager) {
    if (duty.sourceActorUserId === input.actorUserId && !await isSystemAdmin(database, input.actorUserId)) {
      throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
    }
    if (duty.sourceActorUserId === input.targetUserId && !await isSystemAdmin(database, input.targetUserId)) {
      throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
    }
  }
  if (salesStage) {
    await assertSalesReassignmentManager(database, input.actorUserId, now);
  }
  else {
    const actorFeature = duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION'
      ? ACCOUNTING_CORRECTION_FEATURES.VERIFY
      : duty.sourceActionCode === 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION'
        ? ACCOUNTING_CORRECTION_FEATURES.PROCESS
        : ACCOUNTING_CORRECTION_FEATURES.DECIDE;
    const authority = await resolveWorkspaceDutyAuthority(database, {
      userId: input.actorUserId, workspace: 'accounting', feature: actorFeature[0], at: now,
    });
    if (!authority.canSelfDecide) throw new Error('DUTY_REASSIGN_FORBIDDEN');
  }
  if (![
    'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
    'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
    'SALES_EDIT_CONTRACT_CORRECTION',
  ].includes(duty.sourceActionCode)) throw new Error('DUTY_REASSIGN_NOT_SUPPORTED');
  const targetFeatures = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION'
    ? ACCOUNTING_CORRECTION_FEATURES.DECIDE
    : duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION'
      ? ACCOUNTING_CORRECTION_FEATURES.VERIFY
      : ACCOUNTING_CORRECTION_FEATURES.PROCESS;
  if (salesStage) await assertSalesActor(database, input.targetUserId, 'edit', now);
  else await assertAccountingActor(database, input.targetUserId, targetFeatures, now);
  const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
  const expectedStatus = ({
    ACCOUNTING_PROCESS_CONTRACT_CORRECTION: 'OPEN',
    ACCOUNTING_DECIDE_CONTRACT_CORRECTION: 'ACKNOWLEDGED',
    ACCOUNTING_VERIFY_CONTRACT_CORRECTION: 'SALES_EDITED',
    SALES_EDIT_CONTRACT_CORRECTION: 'APPROVED_FOR_SALES_EDIT',
  } as Record<string, 'OPEN' | 'ACKNOWLEDGED' | 'SALES_EDITED' | 'APPROVED_FOR_SALES_EDIT'>)[duty.sourceActionCode];
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
  const salesStage = duty.sourceActionCode === 'SALES_EDIT_CONTRACT_CORRECTION';
  if (definitionFor(duty.sourceActionCode).accountabilityModel === 'SHARED_DECISION') return [];
  if (salesStage) {
    await assertSalesReassignmentManager(database, input.actorUserId, now);
  }
  else {
    const actorFeature = duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION'
      ? ACCOUNTING_CORRECTION_FEATURES.VERIFY
      : duty.sourceActionCode === 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION'
        ? ACCOUNTING_CORRECTION_FEATURES.PROCESS
        : ACCOUNTING_CORRECTION_FEATURES.DECIDE;
    const authority = await resolveWorkspaceDutyAuthority(database, {
      userId: input.actorUserId, workspace: 'accounting', feature: actorFeature[0], at: now,
    });
    if (!authority.canSelfDecide) throw new Error('DUTY_REASSIGN_FORBIDDEN');
  }
  const managerTarget = duty.sourceActionCode === 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION';
  if (managerTarget && duty.sourceActorUserId === input.actorUserId && !await isSystemAdmin(database, input.actorUserId)) {
    throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  }
  if (![
    'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
    'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
    'SALES_EDIT_CONTRACT_CORRECTION',
  ].includes(duty.sourceActionCode)) return [];
  const users = await database.user.findMany({
    where: {
      isActive: true,
      erasedAt: null,
      id: { not: duty.currentAssigneeUserId || undefined },
    },
    select: { id: true, firstName: true, lastName: true, username: true, role: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const targetFeatures = managerTarget
    ? ACCOUNTING_CORRECTION_FEATURES.DECIDE
    : duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION'
      ? ACCOUNTING_CORRECTION_FEATURES.VERIFY
      : ACCOUNTING_CORRECTION_FEATURES.PROCESS;
  const eligible = (await Promise.all(users.map(async (user) => {
    if (managerTarget && user.id === duty.sourceActorUserId && user.role !== 'ADMIN') return null;
    try {
      if (salesStage) await assertSalesActor(database, user.id, 'edit', now);
      else await assertAccountingActor(database, user.id, targetFeatures, now);
      return user;
    } catch {
      return null;
    }
  }))).filter((user): user is NonNullable<typeof user> => Boolean(user));
  return eligible.map((user) => ({
    id: user.id,
    displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    username: user.username,
    role: user.role,
  }));
};

const respond: CrossWorkspaceDutySourceAdapter['respond'] = async (database, input) => {
  const now = input.now ?? new Date();
  await lockDutyAuditStream(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'SALES_CONTRACT_CORRECTION') throw new Error('DUTY_NOT_AVAILABLE');
  const definition = definitionFor(duty.sourceActionCode);
  const sharedDecision = definition.accountabilityModel === 'SHARED_DECISION';
  if (duty.status !== 'OPEN') throw new Error(sharedDecision ? 'DUTY_ALREADY_DECIDED' : 'DUTY_NOT_OPEN');
  if (sharedDecision) {
    if (!await canAccessSharedDecision(database, { dutyId: duty.id, actorUserId: input.actorUserId, now })) {
      throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
    }
  } else if (duty.currentAssigneeUserId !== input.actorUserId) throw new Error('ASSIGNEE_CHANGED');
  const selfDecision = sharedDecision && duty.sourceActorUserId === input.actorUserId;
  if (duty.sourceVersion !== input.expectedSourceVersion) throw new Error('SOURCE_VERSION_CHANGED');
  if (duty.envelopeVersion !== input.expectedEnvelopeVersion) throw new Error('ENVELOPE_VERSION_CHANGED');
  const correction = await database.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
  if (!correction || correction.dutySourceVersion !== duty.sourceVersion) throw new Error('SOURCE_STATE_CHANGED');

  let nextStatus: 'ACKNOWLEDGED' | 'APPROVED_FOR_SALES_EDIT' | 'RESOLVED' | 'CANCELLED';
  let nextAction: string | null;
  let nextAssignee: string | null;
  let dueAt: Date | null;
  if (duty.sourceActionCode === 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION') {
    await assertAccountingActor(database, input.actorUserId, ACCOUNTING_CORRECTION_FEATURES.PROCESS, now);
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
    await assertAccountingActor(database, input.actorUserId, ACCOUNTING_CORRECTION_FEATURES.DECIDE, now);
    if (input.actionCode === 'APPROVE') {
      const contract = correction.contractId ? await database.salesContract.findUnique({
        where: { id: correction.contractId },
        select: { responsibleSellerId: true, isInactive: true },
      }) : null;
      if (!contract || contract.isInactive) throw new Error('CONTRACT_INACTIVE');
      if (!contract.responsibleSellerId) throw new Error('RESPONSIBLE_SELLER_REQUIRED');
      nextStatus = 'APPROVED_FOR_SALES_EDIT';
      nextAction = 'SALES_EDIT_CONTRACT_CORRECTION';
      nextAssignee = contract.responsibleSellerId;
      dueAt = addTehranWorkingDays(now, 3);
    } else if (input.actionCode === 'DECLINE') {
      if (!input.reason?.trim()) throw new Error('REASON_REQUIRED');
      nextStatus = 'CANCELLED';
      nextAction = null;
      nextAssignee = null;
      dueAt = null;
    } else throw new Error('ACTION_NOT_ALLOWED');
  } else if (duty.sourceActionCode === 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION') {
    await assertAccountingActor(database, input.actorUserId, ACCOUNTING_CORRECTION_FEATURES.VERIFY, now);
    if (input.actionCode === 'VERIFY') {
      nextStatus = 'RESOLVED';
      nextAction = null;
      nextAssignee = null;
      dueAt = null;
    } else if (input.actionCode === 'RETURN_TO_SELLER') {
      if (!input.reason?.trim()) throw new Error('REASON_REQUIRED');
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
  if (selfDecision) await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id,
    version: await nextAuditVersion(database, duty.id),
    eventCode: await isSystemAdmin(database, input.actorUserId)
      ? 'SYSTEM_ADMIN_SELF_DECISION'
      : 'WORKSPACE_ADMIN_SELF_DECISION',
    actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion,
    beforeJson: asJson({ sourceActorUserId: duty.sourceActorUserId, actionCode: input.actionCode }),
    afterJson: asJson({ respondedByUserId: input.actorUserId, actionCode: input.actionCode }),
  } });
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
  let successor = nextAction && dueAt
    ? await createStageDuty(database, {
      correctionId: correction.id, sourceActorUserId: correction.createdBy,
      actionCode: nextAction, sourceVersion: updatedCorrection.dutySourceVersion, assigneeUserId: nextAssignee,
      actorUserId: input.actorUserId, dueAt, predecessorDutyId: duty.id,
      policyVersion: input.policyVersion, now,
    })
    : null;
  if (nextStatus === 'RESOLVED' && correction.contractId) {
    const queuedFindings = await database.accountingAuditLog.findMany({
      where: {
        action: 'ACCOUNTING_QUEUED_SUCCESSOR_FINDING',
        contractId: correction.contractId,
        entityId: correction.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (queuedFindings.length) {
      const payloads = queuedFindings.map((event) => event.afterState as Record<string, any>);
      const first = payloads[0] || {};
      const queuedCorrection = await database.accountingCorrectionRequest.create({ data: {
        contractId: correction.contractId,
        category: first.category || 'OTHER',
        priority: first.priority || 'MEDIUM',
        status: 'ACKNOWLEDGED',
        assignedToUserId: null,
        requestIdempotencyKey: String(first.idempotencyKey || `successor:${correction.id}`),
        accountantNote: payloads.map((payload) => String(payload.reason || '')).filter(Boolean).join('\n'),
        createdBy: queuedFindings[0].actorId,
        createdAt: now,
      } });
      await database.accountingAuditLog.create({ data: {
        action: 'ACCOUNTING_CREATED_SUCCESSOR_CORRECTION', actorId: input.actorUserId,
        contractId: correction.contractId, entityType: 'AccountingCorrectionRequest', entityId: queuedCorrection.id,
        beforeState: asJson({ predecessorCorrectionId: correction.id }), afterState: asJson(queuedCorrection),
        note: 'یافته‌های ثبت‌شده پس از شروع اصلاح به زنجیره بعدی منتقل شد.', createdAt: now,
      } });
      successor = await createStageDuty(database, {
        correctionId: queuedCorrection.id, sourceActorUserId: queuedCorrection.createdBy,
        actionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION', sourceVersion: queuedCorrection.dutySourceVersion,
        assigneeUserId: null, actorUserId: input.actorUserId, dueAt: addTehranWorkingDays(now, 1),
        predecessorDutyId: duty.id, policyVersion: input.policyVersion, now,
      });
    }
  }
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
  let salesDuty = await database.crossWorkspaceDuty.findFirst({
    where: {
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: correction.id,
      sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN',
    },
  });
  if (!salesDuty) throw new Error('DUTY_SALES_EDIT_ALREADY_CONSUMED');
  await lockDutyAuditStream(database, salesDuty.id);
  salesDuty = await database.crossWorkspaceDuty.findUnique({ where: { id: salesDuty.id } });
  if (!salesDuty || salesDuty.status !== 'OPEN') throw new Error('DUTY_SALES_EDIT_ALREADY_CONSUMED');
  const actorIsAdmin = await isSystemAdmin(database, input.actorUserId);
  if (salesDuty.currentAssigneeUserId !== input.actorUserId && !actorIsAdmin) throw new Error('ASSIGNEE_CHANGED');
  const expiredAdminOverride = salesDuty.dueAt < input.now && actorIsAdmin;
  if (salesDuty.dueAt < input.now && !actorIsAdmin) throw new Error('DUTY_SALES_EDIT_EXPIRED');
  if (expiredAdminOverride) await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: salesDuty.id, version: await nextAuditVersion(database, salesDuty.id), eventCode: 'ADMIN_OVERRIDE_EXPIRED_DUTY',
    actorUserId: input.actorUserId, sourceVersion: salesDuty.sourceVersion, envelopeVersion: salesDuty.envelopeVersion,
    policyVersion: input.policyVersion, reason: input.note || 'اجرای اضطراری پس از مهلت',
    afterJson: asJson({ dueAt: salesDuty.dueAt, overriddenAt: input.now }),
  } });
  const processorDuty = await database.crossWorkspaceDuty.findFirst({
    where: {
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: correction.id,
      sourceActionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    },
    select: { respondedByUserId: true, currentAssigneeUserId: true },
  });
  const verifierUserId: string | null = null;
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
    dutyId: salesDuty.id, version: await nextAuditVersion(database, salesDuty.id), eventCode: 'COMPLETED', actorUserId: input.actorUserId,
    sourceVersion: salesDuty.sourceVersion, envelopeVersion: salesDuty.envelopeVersion,
    policyVersion: input.policyVersion, reason: input.note,
    afterJson: asJson({ status: 'COMPLETED', actionCode: 'SALES_EDIT_SAVED' }),
  } });
  const updatedCorrection = await database.accountingCorrectionRequest.update({
    where: { id: correction.id },
    data: {
      status: 'SALES_EDITED', assignedToUserId: verifierUserId,
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
    assigneeUserId: verifierUserId, actorUserId: input.actorUserId,
    dueAt: addTehranWorkingDays(input.now, 1),
    predecessorDutyId: salesDuty.id, policyVersion: input.policyVersion, now: input.now,
  });
  return {
    correction: updatedCorrection,
    predecessor: await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: salesDuty.id } }),
    successor,
  };
};

const canReassign: CrossWorkspaceDutySourceAdapter['canReassign'] = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.status !== 'OPEN' || duty.sourceType !== 'SALES_CONTRACT_CORRECTION'
    || definitionFor(duty.sourceActionCode).accountabilityModel !== 'INDIVIDUAL_EXECUTION') return false;
  try {
    if (duty.sourceActionCode === 'SALES_EDIT_CONTRACT_CORRECTION') {
      await assertSalesReassignmentManager(database, input.actorUserId, input.now ?? new Date());
    } else {
      const feature = accountingFeatureFor(duty.sourceActionCode);
      if (!feature || !(await resolveWorkspaceDutyAuthority(database, {
        userId: input.actorUserId, workspace: 'accounting', feature, at: input.now,
      })).canSelfDecide) return false;
    }
    return true;
  } catch { return false; }
};

export const salesContractCorrectionDutyAdapter = {
  sourceType: 'SALES_CONTRACT_CORRECTION',
  synchronize,
  claim,
  canClaim,
  claimRequiresReason,
  responseRequiresReason,
  canAccessSharedDecision,
  sharedDecisionAccessProvenance,
  reassign,
  canReassign,
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
