import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';
import { activeHrActionPermissionsForUser } from '../hrAuthorizationService';
import { addTehranWorkingDays, tehranCivilDateKey } from '../tehranBusinessCalendar';
import { lockCrossWorkspaceDuty } from '../crossWorkspaceDutyLock';
import { reassignIndividualDuty } from '../crossWorkspaceDutyReassignment';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { resolveWorkspaceDutyAuthority } from '../crossWorkspaceDutyAuthority';
import { assertCandidatePersonnelIdentityConsistent } from '../hrCandidatePersonnelIdentityConflict';

export const HR_HIRING_FINANCE_DUTY_DEFINITIONS = {
  HIRING_COLLATERAL_RECORD_RECEIPT: {
    sourceActionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT',
    envelopeCode: 'HIRING_COLLATERAL_RECEIPT_RECORDING',
    envelopeVersion: 1, responsibilityTypeCode: 'FINANCE_RECORDER', actionPermissionCode: 'RECORD_COLLATERAL_CUSTODY', destinationWorkspaceCode: 'ACCOUNTING', routingScope: 'GLOBAL' as const,
    accountabilityModel: 'INDIVIDUAL_EXECUTION' as const, workspaceAdminOverrideDenied: true,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedActionCodes: [] as string[],
    allowedEvidence: ['COLLATERAL_SCAN'],
    responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  HIRING_COLLATERAL_VERIFY_RECEIPT: {
    sourceActionCode: 'HIRING_COLLATERAL_VERIFY_RECEIPT',
    envelopeCode: 'HIRING_COLLATERAL_RECEIPT_VERIFICATION',
    envelopeVersion: 1, responsibilityTypeCode: 'FINANCE_MANAGER', actionPermissionCode: 'VERIFY_COLLATERAL_CUSTODY', destinationWorkspaceCode: 'ACCOUNTING', routingScope: 'GLOBAL' as const,
    accountabilityModel: 'SHARED_DECISION' as const, workspaceAdminOverrideDenied: true,
    allowedFields: ['title', 'description', 'dueAt'] as const,
    allowedActionCodes: ['APPROVE', 'RETURN'],
    allowedEvidence: ['COLLATERAL_SCAN'],
    responseSchema: { type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE', 'RETURN'] }, reason: { type: ['string', 'null'], minLength: 3 } }, required: ['actionCode'], additionalProperties: false },
  },
  HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN: {
    sourceActionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN', envelopeCode: 'HIRING_COLLATERAL_ORIGINAL_RETURN_RECORDING', envelopeVersion: 1,
    responsibilityTypeCode: 'FINANCE_RECORDER', actionPermissionCode: 'RECORD_COLLATERAL_CUSTODY', destinationWorkspaceCode: 'ACCOUNTING', routingScope: 'GLOBAL' as const,
    accountabilityModel: 'INDIVIDUAL_EXECUTION' as const, workspaceAdminOverrideDenied: true,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: [] as string[], allowedEvidence: ['COLLATERAL_RETURN_PROOF'],
    responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN: {
    sourceActionCode: 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN', envelopeCode: 'HIRING_COLLATERAL_ORIGINAL_RETURN_VERIFICATION', envelopeVersion: 1,
    responsibilityTypeCode: 'FINANCE_MANAGER', actionPermissionCode: 'VERIFY_COLLATERAL_CUSTODY', destinationWorkspaceCode: 'ACCOUNTING', routingScope: 'GLOBAL' as const,
    accountabilityModel: 'SHARED_DECISION' as const, workspaceAdminOverrideDenied: true,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: ['APPROVE', 'RETURN'], allowedEvidence: ['COLLATERAL_RETURN_PROOF'],
    responseSchema: { type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE', 'RETURN'] }, reason: { type: ['string', 'null'], minLength: 3 } }, required: ['actionCode'], additionalProperties: false },
  },
  HIRING_CONTRACT_REVIEW: {
    sourceActionCode: 'HIRING_CONTRACT_REVIEW', envelopeCode: 'HIRING_SIGNED_CONTRACT_REVIEW', envelopeVersion: 1,
    responsibilityTypeCode: 'FINANCE_MANAGER', actionPermissionCode: 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT', destinationWorkspaceCode: 'ACCOUNTING', routingScope: 'GLOBAL' as const,
    accountabilityModel: 'SHARED_DECISION' as const, workspaceAdminOverrideDenied: false,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: ['APPROVE', 'RETURN'], allowedEvidence: ['SIGNED_EMPLOYMENT_CONTRACT'],
    responseSchema: { type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE', 'RETURN'] }, reason: { type: ['string', 'null'], minLength: 3 } }, required: ['actionCode'], additionalProperties: false },
  },
} as const;
const definitions = HR_HIRING_FINANCE_DUTY_DEFINITIONS;

type ActionCode = keyof typeof definitions;
const definitionFor = (value: string) => {
  const definition = definitions[value as ActionCode];
  if (!definition) throw new Error('DUTY_ACTION_NOT_REGISTERED');
  return { ...definition, sourceActionCode: value as ActionCode };
};
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const nextAuditVersion = async (database: any, dutyId: string) =>
  ((await database.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId }, _max: { version: true } }))._max.version || 0) + 1;
const lock = (database: any, dutyId: string) => lockCrossWorkspaceDuty(database, dutyId);
const activeTehranHolidays = async (database: any) => new Set<string>((await database.sabalanCalendarEntry.findMany({
  where: { isActive: true, isHoliday: true }, select: { date: true },
})).map(({ date }: { date: Date }) => tehranCivilDateKey(date)));

const upsertEnvelope = (database: any, actionCode: ActionCode, actorUserId: string) => {
  const definition = definitionFor(actionCode);
  const envelopeData = {
    destinationWorkspaceCode: definition.destinationWorkspaceCode,
    destinationFeatureCode: definition.actionPermissionCode,
    allowedFieldsJson: [...definition.allowedFields],
    allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes],
    responseSchemaJson: asJson(definition.responseSchema),
    isActive: true,
  };
  return database.crossWorkspaceDutyEnvelope.upsert({
    where: { code_version: { code: definition.envelopeCode, version: 1 } },
    update: envelopeData,
    create: {
      code: definition.envelopeCode,
      version: definition.envelopeVersion,
      ...envelopeData,
      createdByUserId: actorUserId,
    },
  });
};

export const syncHrHiringFinanceDutyDefinitions = (database: any, actorUserId = 'SYSTEM') =>
  Promise.all((Object.keys(definitions) as ActionCode[]).map((code) => upsertEnvelope(database, code, actorUserId)));

export const createHrHiringFinanceDuty = async (database: any, input: {
  collateralItemId: string; actionCode: ActionCode; actorUserId: string; policyVersion?: number; now?: Date;
}) => {
  const now = input.now || new Date();
  const item = await database.hrCollateralItem.findUniqueOrThrow({ where: { id: input.collateralItemId } });
  const expectedStatus = input.actionCode === 'HIRING_COLLATERAL_RECORD_RECEIPT' ? 'MISSING' : 'RECEIVED';
  if (item.status !== expectedStatus) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
  const definition = definitionFor(input.actionCode);
  const holidays = await activeTehranHolidays(database);
  await upsertEnvelope(database, input.actionCode, input.actorUserId);
  const stableKey = `HR_HIRING_FINANCE:${item.id}:${input.actionCode}:${item.version}`;
  const duty = await database.crossWorkspaceDuty.upsert({
    where: { stableKey }, update: {}, create: {
      stableKey, sourceType: 'HR_HIRING_FINANCE', sourceId: item.id,
      sourceActionCode: input.actionCode, sourceVersion: item.version,
      envelopeCode: definition.envelopeCode, envelopeVersion: 1,
      destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: input.actionCode,
      sourceActorUserId: item.recordedBy, dueAt: addTehranWorkingDays(now, 3, holidays), createdByUserId: input.actorUserId,
    },
  });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({
    where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } }, update: {}, create: {
      dutyId: duty.id, sequence: 1, assignedUserId: null, destinationWorkspaceCode: 'ACCOUNTING',
      destinationQueueCode: input.actionCode, startedAt: now, changedByUserId: input.actorUserId,
      policyVersion: input.policyVersion || 1,
    },
  });
  await database.crossWorkspaceDutyAuditVersion.upsert({
    where: { dutyId_version: { dutyId: duty.id, version: 1 } }, update: {}, create: {
      dutyId: duty.id, version: 1, eventCode: 'QUEUED', actorUserId: input.actorUserId,
      sourceVersion: item.version, envelopeVersion: 1, policyVersion: input.policyVersion || 1,
      afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: null }),
    },
  });
  return duty;
};

export const createHrHiringCollateralReturnDuty = async (database: any, input: {
  returnId: string; actionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN' | 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN'; actorUserId: string; now?: Date;
}) => {
  const now = input.now || new Date();
  const source = await database.hrCollateralOriginalReturn.findUniqueOrThrow({ where: { id: input.returnId } });
  const expected = input.actionCode === 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN' ? 'DRAFT' : 'SUBMITTED';
  if (source.status !== expected) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
  const definition = definitionFor(input.actionCode);
  const holidays = await activeTehranHolidays(database);
  await upsertEnvelope(database, input.actionCode, input.actorUserId);
  const stableKey = `HR_HIRING_FINANCE:${source.id}:${input.actionCode}:${source.version}`;
  const duty = await database.crossWorkspaceDuty.upsert({ where: { stableKey }, update: {}, create: {
    stableKey, sourceType: 'HR_HIRING_FINANCE', sourceId: source.id, sourceActionCode: input.actionCode,
    sourceVersion: source.version, envelopeCode: definition.envelopeCode, envelopeVersion: 1,
    destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: input.actionCode,
    sourceActorUserId: source.returnedBy, dueAt: addTehranWorkingDays(now, 3, holidays), createdByUserId: input.actorUserId,
  } });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({ where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } }, update: {}, create: {
    dutyId: duty.id, sequence: 1, assignedUserId: null, destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: input.actionCode,
    startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1,
  } });
  await database.crossWorkspaceDutyAuditVersion.upsert({ where: { dutyId_version: { dutyId: duty.id, version: 1 } }, update: {}, create: {
    dutyId: duty.id, version: 1, eventCode: 'QUEUED', actorUserId: input.actorUserId, sourceVersion: source.version,
    envelopeVersion: 1, policyVersion: 1, afterJson: asJson({ status: 'OPEN' }),
  } });
  return duty;
};

export const createHrHiringContractReviewDuty = async (database: any, input: {
  contractId: string; actorUserId: string; now?: Date;
}) => {
  const now = input.now || new Date();
  const contract = await database.hrEmploymentContractDocument.findUniqueOrThrow({ where: { id: input.contractId } });
  if (!contract.submittedAt || contract.approvedAt || contract.returnedAt || contract.withdrawnAt) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
  const actionCode: ActionCode = 'HIRING_CONTRACT_REVIEW';
  const definition = definitionFor(actionCode);
  const holidays = await activeTehranHolidays(database);
  await upsertEnvelope(database, actionCode, input.actorUserId);
  const stableKey = `HR_HIRING_FINANCE:${contract.id}:${actionCode}:${contract.version}`;
  const duty = await database.crossWorkspaceDuty.upsert({ where: { stableKey }, update: {}, create: {
    stableKey, sourceType: 'HR_HIRING_FINANCE', sourceId: contract.id, sourceActionCode: actionCode,
    sourceVersion: contract.version, envelopeCode: definition.envelopeCode, envelopeVersion: 1,
    destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: actionCode,
    sourceActorUserId: contract.submittedBy, dueAt: addTehranWorkingDays(now, 3, holidays), createdByUserId: input.actorUserId,
  } });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({ where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } }, update: {}, create: {
    dutyId: duty.id, sequence: 1, assignedUserId: null, destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: actionCode,
    startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1,
  } });
  await database.crossWorkspaceDutyAuditVersion.upsert({ where: { dutyId_version: { dutyId: duty.id, version: 1 } }, update: {}, create: {
    dutyId: duty.id, version: 1, eventCode: 'QUEUED', actorUserId: input.actorUserId,
    sourceVersion: contract.version, envelopeVersion: 1, policyVersion: 1,
    afterJson: asJson({ status: 'OPEN', source: 'SIGNED_EMPLOYMENT_CONTRACT' }),
  } });
  return duty;
};

export const recordHrHiringCollateralReceipt = async (database: any, input: {
  dutyId: string; actorUserId: string; amountRials?: string | null; identifier?: string | null;
  issuerOrGuarantor?: string | null; receivedAt: Date; custodyLocation: string;
  evidence: { storageName: string; originalName: string; mimeType: string; size: number; sha256: string; malwareScanStatus: string };
  now?: Date;
}) => {
  const now = input.now || new Date();
  await lock(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: input.dutyId } });
  if (duty.sourceType !== 'HR_HIRING_FINANCE' || duty.sourceActionCode !== 'HIRING_COLLATERAL_RECORD_RECEIPT') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.status !== 'OPEN' || duty.currentAssigneeUserId !== input.actorUserId) throw new Error('DUTY_NOT_ASSIGNED');
  await assertEligible(database, input.actorUserId, duty.id, now);
  const item = await database.hrCollateralItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  if (item.status !== 'MISSING' || item.version !== duty.sourceVersion) throw new Error('DUTY_SOURCE_CHANGED');
  const changed = await database.hrCollateralItem.updateMany({
    where: { id: item.id, status: 'MISSING', version: duty.sourceVersion },
    data: {
      status: 'RECEIVED', amountRials: input.amountRials || item.amountRials,
      identifier: input.identifier || null, issuerOrGuarantor: input.issuerOrGuarantor || null,
      receivedAt: input.receivedAt, custodyLocation: input.custodyLocation,
      ...input.evidence, recordedBy: input.actorUserId, approvedBy: null, approvedAt: null,
    },
  });
  if (!changed.count) throw new Error('DUTY_SOURCE_CHANGED');
  const completed = await database.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: input.actorUserId },
    data: { status: 'COMPLETED', respondedAt: now, respondedByUserId: input.actorUserId, structuredResultJson: asJson({ actionCode: 'RECORDED' }) },
  });
  if (!completed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
  const verificationDuty = await createHrHiringFinanceDuty(database, {
    collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_VERIFY_RECEIPT', actorUserId: input.actorUserId, now,
  });
  await database.hrHiringAudit.create({ data: {
    applicationId: item.applicationId, actorUserId: input.actorUserId, actorKind: 'USER',
    eventType: 'COLLATERAL_RECORDED_FROM_ACCOUNTING_DUTY',
    payloadJson: asJson({ collateralItemId: item.id, recordingDutyId: duty.id, verificationDutyId: verificationDuty.id }),
  } });
  return { dutyId: duty.id, successorDutyId: verificationDuty.id };
};

export const recordHrHiringCollateralOriginalReturn = async (database: any, input: {
  dutyId: string; actorUserId: string; returnedTo: string; evidenceNote: string;
  evidence: { storageName: string; originalName: string; mimeType: string; size: number; sha256: string; malwareScanStatus: string };
  now?: Date;
}) => {
  const now = input.now || new Date();
  await lock(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: input.dutyId } });
  if (duty.sourceType !== 'HR_HIRING_FINANCE' || duty.sourceActionCode !== 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN') throw new Error('DUTY_NOT_AVAILABLE');
  if (duty.status !== 'OPEN' || duty.currentAssigneeUserId !== input.actorUserId) throw new Error('DUTY_NOT_ASSIGNED');
  await assertEligible(database, input.actorUserId, duty.id, now);
  const source = await database.hrCollateralOriginalReturn.findUniqueOrThrow({
    where: { id: duty.sourceId }, include: { collateralItem: { select: { applicationId: true } } },
  });
  if (source.status !== 'DRAFT' || source.version !== duty.sourceVersion) throw new Error('DUTY_SOURCE_CHANGED');
  const changed = await database.hrCollateralOriginalReturn.updateMany({ where: { id: source.id, status: 'DRAFT' }, data: {
    status: 'SUBMITTED', returnedAt: now, returnedTo: input.returnedTo, returnedBy: input.actorUserId,
    evidenceNote: input.evidenceNote, evidenceStorageName: input.evidence.storageName,
    evidenceOriginalName: input.evidence.originalName, evidenceMimeType: input.evidence.mimeType,
    evidenceSize: input.evidence.size, evidenceSha256: input.evidence.sha256,
    evidenceMalwareScanStatus: input.evidence.malwareScanStatus,
  } });
  if (!changed.count) throw new Error('DUTY_SOURCE_CHANGED');
  const completed = await database.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: input.actorUserId },
    data: { status: 'COMPLETED', respondedAt: now, respondedByUserId: input.actorUserId, structuredResultJson: asJson({ actionCode: 'RECORDED' }) },
  });
  if (!completed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
  const successor = await createHrHiringCollateralReturnDuty(database, {
    returnId: source.id, actionCode: 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN', actorUserId: input.actorUserId, now,
  });
  await database.hrHiringAudit.create({ data: {
    applicationId: source.collateralItem.applicationId, actorUserId: input.actorUserId, actorKind: 'USER',
    eventType: 'COLLATERAL_ORIGINAL_RETURN_RECORDED_FROM_ACCOUNTING_DUTY',
    payloadJson: asJson({ collateralReturnId: source.id, recordingDutyId: duty.id, verificationDutyId: successor.id }),
  } });
  return { dutyId: duty.id, successorDutyId: successor.id };
};

const assertEligible = async (database: any, userId: string, dutyId: string, now: Date) => {
  const [permissions, duty] = await Promise.all([
    activeHrActionPermissionsForUser(database, userId, now),
    database.crossWorkspaceDuty.findUnique({ where: { id: dutyId }, select: { currentAssigneeUserId: true, sourceActionCode: true } }),
  ]);
  if (!duty || !permissions.includes(definitionFor(duty.sourceActionCode).actionPermissionCode)) {
    throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
  }
  if (duty?.currentAssigneeUserId && duty.currentAssigneeUserId !== userId) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
};

const synchronize: CrossWorkspaceDutySourceAdapter['synchronize'] = async (database, input) =>
  input.dutyTypeCode === 'HIRING_CONTRACT_REVIEW'
    ? createHrHiringContractReviewDuty(database, { contractId: input.sourceId, actorUserId: input.actorUserId, now: input.now })
    : createHrHiringFinanceDuty(database, { collateralItemId: input.sourceId, actionCode: input.dutyTypeCode as ActionCode, actorUserId: input.actorUserId, policyVersion: input.policyVersion, now: input.now });

const managerialHiringFinanceSelfDecision = async (database: any, duty: any, actorUserId: string, now: Date) => {
  if (duty.sourceActorUserId !== actorUserId) return false;
  const contractDecision = duty.sourceActionCode === 'HIRING_CONTRACT_REVIEW';
  const collateralDecision = ['HIRING_COLLATERAL_VERIFY_RECEIPT', 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN']
    .includes(duty.sourceActionCode);
  if (!contractDecision && !collateralDecision) return false;
  const permissions = await activeHrActionPermissionsForUser(database, actorUserId, now);
  const recordPermission = contractDecision ? 'RECORD_SIGNED_EMPLOYMENT_CONTRACT' : 'RECORD_COLLATERAL_CUSTODY';
  const verifyPermission = contractDecision ? 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT' : 'VERIFY_COLLATERAL_CUSTODY';
  if (!permissions.includes(recordPermission) || !permissions.includes(verifyPermission)) return false;
  return (await resolveWorkspaceDutyAuthority(database, {
    userId: actorUserId, workspace: 'accounting', feature: verifyPermission, at: now,
  })).canSelfDecide;
};

const canClaim: CrossWorkspaceDutySourceAdapter['canClaim'] = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  const permissions = await activeHrActionPermissionsForUser(database, input.actorUserId, input.now ?? new Date());
  const allowed = Boolean(duty && duty.sourceType === 'HR_HIRING_FINANCE' && duty.status === 'OPEN'
    && !duty.currentAssigneeUserId && duty.sourceActorUserId !== input.actorUserId
    && definitionFor(duty.sourceActionCode).accountabilityModel !== 'SHARED_DECISION'
    && permissions.includes(definitionFor(duty.sourceActionCode).actionPermissionCode));
  return allowed;
};

const canAccessSharedDecision: CrossWorkspaceDutySourceAdapter['canAccessSharedDecision'] = async (database, input) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'HR_HIRING_FINANCE') return false;
  if (definitionFor(duty.sourceActionCode).accountabilityModel !== 'SHARED_DECISION') return false;
  if (!input.includeCompleted && duty.status !== 'OPEN') return false;
  const definition = definitionFor(duty.sourceActionCode);
  const permitted = (await activeHrActionPermissionsForUser(database, input.actorUserId, input.now ?? new Date()))
    .includes(definition.actionPermissionCode);
  if (!permitted) return false;
  return duty.sourceActorUserId !== input.actorUserId
    || managerialHiringFinanceSelfDecision(database, duty, input.actorUserId, input.now ?? new Date());
};

const claim: CrossWorkspaceDutySourceAdapter['claim'] = async (database, input) => {
  const now = input.now || new Date();
  await lock(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: input.dutyId } });
  if (!await canClaim(database, input)) throw new Error('DUTY_CLAIM_NOT_ALLOWED');
  await assertEligible(database, input.actorUserId, duty.id, now);
  const changed = await database.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: null }, data: { currentAssigneeUserId: input.actorUserId } });
  if (!changed.count) throw new Error('DUTY_CLAIM_CONFLICT');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null }, data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: input.actorUserId } });
  await database.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id, sequence: 2, assignedUserId: input.actorUserId, destinationWorkspaceCode: 'ACCOUNTING',
    destinationQueueCode: duty.destinationQueueCode, startedAt: now, changedByUserId: input.actorUserId, policyVersion: input.policyVersion,
  } });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: 'CLAIMED', actorUserId: input.actorUserId,
    sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion, policyVersion: input.policyVersion,
    beforeJson: asJson({ currentAssigneeUserId: null }), afterJson: asJson({ currentAssigneeUserId: input.actorUserId }),
  } });
  return database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
};

const respond: CrossWorkspaceDutySourceAdapter['respond'] = async (database, input) => {
  const now = input.now || new Date();
  await lock(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: input.dutyId }, include: { envelope: true } });
  if (duty.sourceType !== 'HR_HIRING_FINANCE') throw new Error('DUTY_RESPONSE_NOT_SUPPORTED');
  const sharedDecision = definitionFor(duty.sourceActionCode).accountabilityModel === 'SHARED_DECISION';
  if (duty.status !== 'OPEN') throw new Error(sharedDecision ? 'DUTY_ALREADY_DECIDED' : 'DUTY_NOT_ASSIGNED');
  if (sharedDecision) {
    if (!await canAccessSharedDecision(database, { dutyId: duty.id, actorUserId: input.actorUserId, now })) {
      throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
    }
  } else if (duty.currentAssigneeUserId !== input.actorUserId) throw new Error('DUTY_NOT_ASSIGNED');
  if (input.expectedSourceVersion !== duty.sourceVersion || input.expectedEnvelopeVersion !== duty.envelopeVersion) throw new Error('DUTY_VERSION_STALE');
  if (!['APPROVE', 'RETURN'].includes(input.actionCode)) throw new Error('DUTY_ACTION_NOT_ALLOWED');
  const reason = String(input.reason || '').trim();
  if (input.actionCode === 'RETURN' && reason.length < 3) throw new Error('REASON_REQUIRED');
  await assertEligible(database, input.actorUserId, duty.id, now);
  const managerialSelfDecision = sharedDecision
    && await managerialHiringFinanceSelfDecision(database, duty, input.actorUserId, now);
  const managerialActor = managerialSelfDecision
    ? await database.user.findUnique({ where: { id: input.actorUserId }, select: { role: true, firstName: true, lastName: true } })
    : null;
  if (duty.sourceActionCode === 'HIRING_CONTRACT_REVIEW') {
    const contract = await database.hrEmploymentContractDocument.findUniqueOrThrow({ where: { id: duty.sourceId } });
    if (contract.version !== duty.sourceVersion || !contract.submittedAt || contract.approvedAt || contract.returnedAt || contract.withdrawnAt) throw new Error('DUTY_SOURCE_CHANGED');
    if (contract.submittedBy === input.actorUserId && !managerialSelfDecision) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
    const application = await database.hrJobApplication.findUniqueOrThrow({
      where: { id: contract.applicationId }, include: { candidate: { include: { linkedPersonnel: true } } },
    });
    await assertCandidatePersonnelIdentityConsistent(database, { applicationId: application.id, candidate: application.candidate });
    await database.hrEmploymentContractDocument.update({ where: { id: contract.id }, data: input.actionCode === 'APPROVE'
      ? { approvedBy: input.actorUserId, approvedAt: now }
      : { returnedBy: input.actorUserId, returnedAt: now, returnReason: reason } });
    await database.hrJobApplication.update({ where: { id: application.id }, data: {
      contractClearance: input.actionCode === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    } });
    if (input.actionCode === 'APPROVE') {
      await database.hrOnboardingTask.updateMany({
        where: { applicationId: application.id, title: 'تأیید قرارداد امضاشده', ownerAuthority: 'FINANCE_MANAGER', activationBlocker: true },
        data: { status: 'COMPLETE', completedBy: input.actorUserId, completedAt: now },
      });
    } else {
      const holidays = await activeTehranHolidays(database);
      const dueAt = addTehranWorkingDays(now, 3, holidays);
      const sourceKey = `HIRING:${application.id}:RECORD_CONTRACT_CORRECTION:UNASSIGNED`;
      const correction = await database.hrWorkItem.upsert({ where: { sourceKey }, update: {
        status: 'PENDING', dueDate: dueAt, description: reason, completedAt: null, completedByUserId: null,
      }, create: {
        title: `اصلاح قرارداد کاغذی — ${application.candidate.firstName} ${application.candidate.lastName}`,
        description: reason, sourceType: 'HIRING_ACTION', sourceKey,
        destinationHref: `/dashboard/hr/hiring/${application.id}`, assignedToUserId: null,
        dueDate: dueAt, createdByUserId: null,
      } });
      await database.hrWorkItemAudit.create({ data: {
        workItemId: correction.id, eventType: 'CONTRACT_CORRECTION_TASK_CREATED', actorUserId: input.actorUserId,
        beforeJson: Prisma.JsonNull, afterJson: asJson({ contractId: contract.id, version: contract.version + 1, dueAt, reason }),
      } });
    }
    const completed = await database.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN' }, data: {
      status: 'COMPLETED', respondedByUserId: input.actorUserId, respondedAt: now,
      structuredResultJson: asJson({ actionCode: input.actionCode, reason: reason || null,
        managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null }),
    } });
    if (!completed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
    await database.crossWorkspaceDutyAuditVersion.create({ data: {
      dutyId: duty.id, version: await nextAuditVersion(database, duty.id),
      eventCode: managerialSelfDecision
        ? managerialActor?.role === 'ADMIN' ? 'SYSTEM_ADMIN_SELF_DECISION' : 'WORKSPACE_ADMIN_SELF_DECISION'
        : input.actionCode === 'APPROVE' ? 'APPROVED' : 'RETURNED',
      actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
      policyVersion: input.policyVersion, reason: reason || null,
      afterJson: asJson({ actionCode: input.actionCode, managerialSelfDecision,
        overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null,
        actorName: managerialActor ? `${managerialActor.firstName} ${managerialActor.lastName}`.trim() : null,
        actedAt: now }),
    } });
    await database.hrHiringAudit.create({ data: {
      applicationId: application.id, actorUserId: input.actorUserId, actorKind: 'USER',
      eventType: input.actionCode === 'APPROVE' ? 'SIGNED_CONTRACT_APPROVED_FROM_ACCOUNTING_DUTY' : 'SIGNED_CONTRACT_RETURNED_FROM_ACCOUNTING_DUTY',
      payloadJson: asJson({ contractId: contract.id, dutyId: duty.id, reason: reason || null,
        managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null }),
    } });
    return { duty: await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }), replayed: false };
  }
  if (duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN') {
    const source = await database.hrCollateralOriginalReturn.findUniqueOrThrow({ where: { id: duty.sourceId }, include: { collateralItem: true } });
    if (source.status !== 'SUBMITTED' || source.version !== duty.sourceVersion
      || (source.returnedBy === input.actorUserId && !managerialSelfDecision)) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
    await database.hrCollateralOriginalReturn.update({ where: { id: source.id }, data: input.actionCode === 'APPROVE'
      ? { status: 'CONFIRMED', confirmedBy: input.actorUserId, confirmedAt: now, returnedReason: null }
      : { status: 'RETURNED', returnedReason: reason } });
    await database.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { status: 'COMPLETED', respondedByUserId: input.actorUserId, respondedAt: now, structuredResultJson: asJson({ actionCode: input.actionCode, reason: reason || null, managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null }) } });
    if (input.actionCode === 'APPROVE') {
      await database.hrCollateralItem.update({ where: { id: source.collateralItemId }, data: {
        returnedAt: source.returnedAt, returnedTo: source.returnedTo, returnedBy: source.returnedBy,
        returnEvidenceNote: source.evidenceNote, returnEvidenceStorageName: source.evidenceStorageName,
        returnEvidenceOriginalName: source.evidenceOriginalName, returnEvidenceMimeType: source.evidenceMimeType,
        returnEvidenceSize: source.evidenceSize, returnEvidenceSha256: source.evidenceSha256,
        returnEvidenceMalwareScanStatus: source.evidenceMalwareScanStatus,
        returnConfirmedBy: input.actorUserId, returnConfirmedAt: now,
      } });
      const application = await database.hrJobApplication.findUniqueOrThrow({
        where: { id: source.collateralItem.applicationId },
        include: { employmentRelationship: true },
      });
      const heldOriginals = await database.hrCollateralItem.count({
        where: { applicationId: application.id, receivedAt: { not: null }, returnConfirmedAt: null },
      });
      if (!heldOriginals) {
        const explicitNoRequirement = await database.hrCollateralRequirement.findFirst({
          where: { applicationId: application.id, status: 'ACTIVE', type: 'NO_PRE_HIRE_COLLATERAL' }, select: { id: true },
        });
        if (explicitNoRequirement) await database.hrJobApplication.update({
          where: { id: application.id }, data: { collateralClearance: 'APPROVED' },
        });
      }
      if (!heldOriginals && application.pendingClosureOutcome) {
        if (application.employmentRelationship?.status === 'PLANNED') {
          await database.hrEmploymentAssignment.updateMany({
            where: { employmentRelationshipId: application.employmentRelationship.id, effectiveTo: null },
            data: { effectiveTo: now },
          });
          await database.hrEmploymentRelationship.update({
            where: { id: application.employmentRelationship.id },
            data: { status: 'ENDED', effectiveTo: now, endReason: application.pendingClosureReason },
          });
        }
        await database.hrCandidateInvitation.updateMany({
          where: { applicationId: application.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await database.hrJobApplication.update({ where: { id: application.id }, data: {
          stage: 'CLOSED', outcome: application.pendingClosureOutcome as any,
          outcomeReason: application.pendingClosureReason, preClosureStage: application.stage,
          pendingClosureOutcome: null, pendingClosureReason: null,
          pendingClosureRequestedBy: null, pendingClosureRequestedAt: null,
        } });
        await database.hrHiringAudit.create({ data: {
          applicationId: application.id, actorUserId: input.actorUserId, actorKind: 'USER',
          eventType: 'APPLICATION_CLOSED_AFTER_COLLATERAL_RETURN',
          payloadJson: asJson({ outcome: application.pendingClosureOutcome, dutyId: duty.id }),
        } });
      }
    } else {
      const successor = await database.hrCollateralOriginalReturn.create({ data: {
        collateralItemId: source.collateralItemId, version: source.version + 1, status: 'DRAFT',
      } });
      await createHrHiringCollateralReturnDuty(database, {
        returnId: successor.id, actionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN',
        actorUserId: input.actorUserId, now,
      });
    }
    await database.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: managerialSelfDecision ? (managerialActor?.role === 'ADMIN' ? 'SYSTEM_ADMIN_SELF_DECISION' : 'WORKSPACE_ADMIN_SELF_DECISION') : input.actionCode === 'APPROVE' ? 'APPROVED' : 'RETURNED', actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion, policyVersion: input.policyVersion, reason: reason || null,
      afterJson: asJson({ actionCode: input.actionCode, managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null, actorName: managerialActor ? `${managerialActor.firstName} ${managerialActor.lastName}`.trim() : null, actedAt: now }),
    } });
    return { duty: await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }), replayed: false };
  }
  if (duty.sourceActionCode !== 'HIRING_COLLATERAL_VERIFY_RECEIPT') throw new Error('DUTY_RESPONSE_NOT_SUPPORTED');
  const item = await database.hrCollateralItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  if (item.version !== duty.sourceVersion || item.status !== 'RECEIVED'
    || (item.recordedBy === input.actorUserId && !managerialSelfDecision)) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  const itemChange = await database.hrCollateralItem.updateMany({
    where: { id: item.id, status: 'RECEIVED', version: duty.sourceVersion },
    data: input.actionCode === 'APPROVE'
      ? { status: 'VERIFIED', approvedBy: input.actorUserId, approvedAt: now, coordinationReason: null }
      : { status: 'MISMATCH', approvedBy: input.actorUserId, approvedAt: now, coordinationReason: reason },
  });
  if (!itemChange.count) throw new Error('DUTY_SOURCE_CHANGED');
  const completed = await database.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN' }, data: {
    status: 'COMPLETED', respondedByUserId: input.actorUserId, respondedAt: now,
    structuredResultJson: asJson({ actionCode: input.actionCode, reason: reason || null, managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null }),
  } });
  if (!completed.count) throw new Error('DUTY_RESPONSE_CONFLICT');
  if (input.actionCode === 'APPROVE') {
    const remaining = await database.hrCollateralItem.count({ where: { applicationId: item.applicationId, required: true, supersededBy: null, status: { not: 'VERIFIED' } } });
    const explicitNoRequirement = await database.hrCollateralRequirement.findFirst({
      where: { applicationId: item.applicationId, status: 'ACTIVE', type: 'NO_PRE_HIRE_COLLATERAL' }, select: { id: true },
    });
    const heldOriginals = explicitNoRequirement ? await database.hrCollateralItem.count({
      where: { applicationId: item.applicationId, receivedAt: { not: null }, returnConfirmedAt: null },
    }) : 0;
    if (!remaining && !(explicitNoRequirement && heldOriginals)) await database.hrJobApplication.update({ where: { id: item.applicationId }, data: { collateralClearance: 'APPROVED' } });
  } else {
    const successor = await database.hrCollateralItem.create({ data: {
      applicationId: item.applicationId, collateralRequirementId: item.collateralRequirementId, templateItemId: item.templateItemId,
      supersedesItemId: item.id, version: item.version + 1,
      type: item.type, required: item.required, amountRials: item.amountRials,
      status: 'MISSING', note: item.note, recordedBy: input.actorUserId,
    } });
    await createHrHiringFinanceDuty(database, {
      collateralItemId: successor.id, actionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT',
      actorUserId: input.actorUserId, policyVersion: input.policyVersion, now,
    });
  }
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: managerialSelfDecision ? (managerialActor?.role === 'ADMIN' ? 'SYSTEM_ADMIN_SELF_DECISION' : 'WORKSPACE_ADMIN_SELF_DECISION') : input.actionCode === 'APPROVE' ? 'APPROVED' : 'RETURNED',
    actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
    policyVersion: input.policyVersion, beforeJson: asJson({ status: item.status }),
    afterJson: asJson({ status: input.actionCode === 'APPROVE' ? 'VERIFIED' : 'MISMATCH', managerialSelfDecision,
      overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null,
      actorName: managerialActor ? `${managerialActor.firstName} ${managerialActor.lastName}`.trim() : null, actedAt: now }), reason: reason || null,
  } });
  await database.hrHiringAudit.create({ data: {
    applicationId: item.applicationId, actorUserId: input.actorUserId, actorKind: 'USER',
    eventType: input.actionCode === 'APPROVE' ? 'COLLATERAL_VERIFIED_FROM_ACCOUNTING_DUTY' : 'COLLATERAL_RETURNED_FOR_CORRECTION_FROM_ACCOUNTING_DUTY',
    payloadJson: asJson({ collateralItemId: item.id, dutyId: duty.id, reason: reason || null,
      managerialSelfDecision, overrideLabel: managerialSelfDecision ? 'استفاده از اختیار مدیریتی' : null }),
  } });
  return { duty: await database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }), replayed: false };
};

const loadInboxProjection: CrossWorkspaceDutySourceAdapter['loadInboxProjection'] = async (database, input) => {
  if (input.sourceActionCode === 'HIRING_CONTRACT_REVIEW') {
    const contract = await database.hrEmploymentContractDocument.findUnique({
      where: { id: input.sourceId }, include: { application: { include: { candidate: true } } },
    });
    return {
      title: contract ? `بررسی قرارداد کاغذی — ${contract.application.candidate.firstName} ${contract.application.candidate.lastName}` : 'وظیفه منسوخ بررسی قرارداد',
      description: contract ? `شماره قرارداد: ${contract.contractNumber} · نسخه ${contract.version}` : null,
      sourceIsCurrent: Boolean(contract && contract.version === input.sourceVersion && contract.submittedAt && !contract.approvedAt && !contract.returnedAt && !contract.withdrawnAt),
    };
  }
  const returnSource = await database.hrCollateralOriginalReturn.findUnique({ where: { id: input.sourceId }, include: { collateralItem: true } });
  if (returnSource) return {
    title: returnSource.status === 'DRAFT' ? 'ثبت بازگرداندن اصل وثیقه استخدام' : 'تأیید بازگرداندن اصل وثیقه استخدام',
    description: `نوع وثیقه: ${returnSource.collateralItem.type}`,
    sourceIsCurrent: returnSource.version === input.sourceVersion && ['DRAFT', 'SUBMITTED'].includes(returnSource.status),
  };
  const item = await database.hrCollateralItem.findUnique({ where: { id: input.sourceId } });
  return {
    title: input.sourceVersion === item?.version ? (item.status === 'MISSING' ? 'ثبت دریافت وثیقه استخدام' : 'تأیید دریافت وثیقه استخدام') : 'وظیفه منسوخ وثیقه',
    description: item ? `نوع وثیقه: ${item.type}` : null,
    sourceIsCurrent: Boolean(item && item.version === input.sourceVersion && ['MISSING', 'RECEIVED'].includes(item.status)),
  };
};

const assertHiringReassignmentManager = async (database: any, userId: string, feature: string, now: Date) => {
  const authority = await resolveWorkspaceDutyAuthority(database, {
    userId, workspace: 'accounting', feature, at: now,
  });
  if (!authority.canSelfDecide) throw new Error('DUTY_REASSIGN_FORBIDDEN');
};

const reassign: CrossWorkspaceDutySourceAdapter['reassign'] = (database, input) =>
  reassignIndividualDuty(database, input, async (duty) => {
    if (duty.sourceType !== 'HR_HIRING_FINANCE'
      || definitionFor(duty.sourceActionCode).accountabilityModel !== 'INDIVIDUAL_EXECUTION') {
      throw new Error('DUTY_REASSIGN_NOT_SUPPORTED');
    }
    const now = input.now ?? new Date();
    const feature = definitionFor(duty.sourceActionCode).actionPermissionCode;
    await assertHiringReassignmentManager(database, input.actorUserId, feature, now);
    if (!(await activeHrActionPermissionsForUser(database, input.targetUserId, now)).includes(feature)) {
      throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
    }
    if (duty.sourceActorUserId === input.targetUserId) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  });

const listEligibleAssignees: CrossWorkspaceDutySourceAdapter['listEligibleAssignees'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.sourceType !== 'HR_HIRING_FINANCE'
    || definitionFor(duty.sourceActionCode).accountabilityModel !== 'INDIVIDUAL_EXECUTION') return [];
  const feature = definitionFor(duty.sourceActionCode).actionPermissionCode;
  await assertHiringReassignmentManager(database, input.actorUserId, feature, now);
  const users = await database.user.findMany({
    where: { isActive: true, erasedAt: null, id: { notIn: [duty.currentAssigneeUserId].filter(Boolean) as string[] } },
    select: { id: true, firstName: true, lastName: true, username: true, role: true },
  });
  const grants = await Promise.all(users.map((user) => activeHrActionPermissionsForUser(database, user.id, now)));
  const eligible = users.map((user, index) => grants[index].includes(feature)
    && user.id !== duty.sourceActorUserId);
  return users.filter((_user, index) => eligible[index]).map((user) => ({
    id: user.id, displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    username: user.username, role: user.role,
  }));
};

export const hrHiringFinanceDutyAdapter: CrossWorkspaceDutySourceAdapter = {
  sourceType: 'HR_HIRING_FINANCE', synchronize, respond, claim, canClaim,
  claimRequiresReason: async () => false,
  responseRequiresReason: async () => false,
  canAccessSharedDecision,
  sharedDecisionAccessProvenance: async (database, input) => {
    const user = await database.user.findUnique({ where: { id: input.actorUserId }, select: { role: true } });
    if (!user) return [];
    const effective = await getEffectiveUserAccess(database, { userId: input.actorUserId, userRole: user.role, at: input.now });
    const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    const requiredFeature = duty && definitionFor(duty.sourceActionCode).actionPermissionCode;
    const source = effective.provenance.features.find(({ feature }) => feature === requiredFeature)?.source;
    return source === 'SYSTEM_ADMIN_OVERRIDE' ? ['اختیار مدیر سیستم']
      : source === 'CANONICAL_HR_FEATURE' || source === 'DIRECT_FEATURE' ? ['مجوز مستقیم مدیریت مدارک مالی']
        : source === 'ROLE_FEATURE' || source === 'HR_MANAGER_OVERRIDE' ? ['مجوز مدیریت مدارک مالی از نقش'] : [];
  },
  reassign,
  canReassign: async (database, input) => {
    const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    if (!duty || duty.status !== 'OPEN' || duty.sourceType !== 'HR_HIRING_FINANCE'
      || definitionFor(duty.sourceActionCode).accountabilityModel !== 'INDIVIDUAL_EXECUTION') return false;
    try {
      await assertHiringReassignmentManager(database, input.actorUserId,
        definitionFor(duty.sourceActionCode).actionPermissionCode, input.now ?? new Date());
      return true;
    }
    catch { return false; }
  },
  listEligibleAssignees,
  reconcileAssignment: async () => { throw new Error('DUTY_RECONCILE_NOT_SUPPORTED'); },
  loadInboxProjection,
};
