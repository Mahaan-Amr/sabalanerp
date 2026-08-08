import type { Prisma, PrismaClient } from '@prisma/client';

export const HR_REDESIGN_CATALOG = Object.freeze({
  contractVersion: 1,
  workspaceCode: 'HUMAN_RESOURCES',
  workspaceFeatures: [
    { code: 'DASHBOARD' },
    { code: 'ORGANIZATIONAL_STRUCTURE' },
    { code: 'PERSONNEL' },
    { code: 'RECRUITMENT_CASES' },
    { code: 'HR_WORK_MANAGEMENT' },
    { code: 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION' },
    { code: 'DATA_MIGRATION_RECONCILIATION' },
    { code: 'USER_ADMINISTRATION' },
  ] as const,
  featureLevels: ['VIEW', 'EDIT', 'ADMIN'] as const,
  businessAuthorities: [
    'HR_PROCESSOR',
    'HR_MANAGER',
    'COMPANY_MANAGER',
    'HIRING_MANAGER',
    'HR_PAYROLL_PROCESSOR',
    'HR_PAYROLL_MANAGER',
    'FINANCE_RECORDER',
    'FINANCE_MANAGER',
  ] as const,
  responsibilityTypes: [
    'RESPONSIBLE_SUPERVISOR',
    'HIRING_MANAGER',
    'COMPANY_MANAGER',
    'HR_PAYROLL_PROCESSOR',
    'HR_PAYROLL_MANAGER',
    'FINANCE_RECORDER',
    'FINANCE_MANAGER',
  ] as const,
  assessmentKinds: ['DISC', 'EQ', 'BIG_FIVE'] as const,
  dutyEnvelopeVersion: 1,
});

export type HrAssessmentKind = typeof HR_REDESIGN_CATALOG.assessmentKinds[number];

const includesCode = <Code extends string>(values: readonly Code[], value: string): value is Code => (
  values.some((candidate) => candidate === value)
);

type LegacyGrant = {
  id: string;
  permissionLevel: string;
  isActive: boolean;
  grantedAt: Date;
  expiresAt: Date | null;
};

const accessLevel = (value: string) => {
  const normalized = value.toUpperCase();
  if (!includesCode(HR_REDESIGN_CATALOG.featureLevels, normalized)) {
    throw new Error(`Unsupported legacy HR access level: ${value}`);
  }
  return normalized;
};

const legacyGrantStatus = (grant: { isActive: boolean; expiresAt: Date | null }, now: Date) => {
  if (!grant.isActive) return 'REVOKED' as const;
  if (grant.expiresAt && grant.expiresAt <= now) return 'EXPIRED' as const;
  return 'ACTIVE' as const;
};

export const projectLegacyHrAccess = (input: {
  userId: string;
  workspacePermission: LegacyGrant | null;
  featurePermissions: Array<LegacyGrant & { feature: string }>;
  authorities: Array<{
    id: string;
    authority: string;
    isActive: boolean;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }>;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const workspaceGrant = input.workspacePermission ? {
    legacyGrantId: input.workspacePermission.id,
    userId: input.userId,
    workspaceCode: HR_REDESIGN_CATALOG.workspaceCode,
    level: accessLevel(input.workspacePermission.permissionLevel),
    status: legacyGrantStatus(input.workspacePermission, now),
    effectiveFrom: input.workspacePermission.grantedAt,
    effectiveTo: input.workspacePermission.expiresAt,
  } : null;
  const featureGrants = input.featurePermissions.flatMap((grant) => {
    const featureCode = grant.feature.trim().replace(/[\s-]+/g, '_').toUpperCase();
    if (!HR_REDESIGN_CATALOG.workspaceFeatures.some((feature) => feature.code === featureCode)) return [];
    return [{
      legacyGrantId: grant.id,
      userId: input.userId,
      featureCode,
      level: accessLevel(grant.permissionLevel),
      status: legacyGrantStatus(grant, now),
      effectiveFrom: grant.grantedAt,
      effectiveTo: grant.expiresAt,
    }];
  });
  const authorityGrants = input.authorities.flatMap((grant) => {
    if (!includesCode(HR_REDESIGN_CATALOG.businessAuthorities, grant.authority)) return [];
    return [{
      legacyAuthorityId: grant.id,
      userId: input.userId,
      authorityCode: grant.authority,
      status: legacyGrantStatus(grant, now),
      effectiveFrom: grant.createdAt,
      effectiveTo: grant.revokedAt ?? grant.expiresAt,
    }];
  });
  return { workspaceGrant, featureGrants, authorityGrants };
};

export const projectLegacyPosition = (position: {
  id: string;
  code: string;
  title: string;
  capacity: number;
  isActive: boolean;
  createdAt: Date;
}) => ({
  id: position.id,
  code: position.code,
  title: position.title,
  capacity: position.capacity,
  lifecycle: {
    status: position.isActive ? 'ACTIVE' as const : 'INACTIVE' as const,
    effectiveFrom: position.createdAt,
    source: 'LEGACY_CURRENT_STATE' as const,
  },
  lifecycleHistory: [],
  capacityHistory: [],
  historicalEvidenceFabricated: false,
});

export const projectLegacyHrWorkItem = (workItem: {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'WAIVED';
  sourceType: string;
  sourceKey: string | null;
  destinationHref: string;
  dueDate: Date;
  assignedToUserId: string | null;
  completedByUserId: string | null;
  completedAt: Date | null;
  waivedByUserId: string | null;
  waivedAt: Date | null;
  waiverReason: string | null;
}) => ({
  id: workItem.id,
  title: workItem.title,
  description: workItem.description,
  status: workItem.status === 'COMPLETE'
    ? 'COMPLETED' as const
    : workItem.status === 'WAIVED'
      ? 'WAIVED' as const
      : 'OPEN' as const,
  dueAt: workItem.dueDate,
  assigneeUserId: workItem.assignedToUserId,
  source: { type: workItem.sourceType, id: workItem.sourceKey ?? workItem.id },
  destinationHref: workItem.destinationHref,
  envelope: { code: 'LEGACY_HR_WORK_ITEM' as const, version: 1 },
  structuredResult: workItem.status === 'COMPLETE'
    ? { outcome: 'COMPLETED', actorUserId: workItem.completedByUserId, respondedAt: workItem.completedAt }
    : workItem.status === 'WAIVED'
      ? { outcome: 'WAIVED', actorUserId: workItem.waivedByUserId, respondedAt: workItem.waivedAt, reason: workItem.waiverReason }
      : null,
  compatibilitySource: 'LEGACY_HR_WORK_ITEM' as const,
  taskScopedOnly: true,
});

export const planLegacyAssessmentMigration = (input: {
  applicationId: string;
  completedAssessmentKinds: HrAssessmentKind[];
}) => ({
  applicationId: input.applicationId,
  // Legacy evidence says what happened, not what the Company Manager selected.
  // Creating a plan here would fabricate a business decision.
  plan: null,
  neutralEvent: {
    code: input.completedAssessmentKinds.length === 0
      ? 'NO_LEGACY_ASSESSMENT_HISTORY'
      : 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED',
    details: { completedAssessmentKinds: [...input.completedAssessmentKinds] },
  },
});

export const canReadLegacyAssessmentCompatibility = (input: {
  hasAssignedAssessmentDuty: boolean;
  hasActiveHiringAuthority: boolean;
}) => input.hasAssignedAssessmentDuty && input.hasActiveHiringAuthority;

export const projectLegacyAssessmentCompatibility = <TEvidence>(input: {
  applicationId: string;
  evidence: TEvidence[];
  completedAssessmentKinds: HrAssessmentKind[];
}) => ({
  migration: planLegacyAssessmentMigration({
    applicationId: input.applicationId,
    completedAssessmentKinds: input.completedAssessmentKinds,
  }),
  evidence: input.evidence,
});

export type HrReconciliationAttentionFlag =
  | 'USER_PERSONNEL_LINKAGE'
  | 'IDENTITY_AMBIGUITY'
  | 'CURRENT_ASSIGNMENT_GAP'
  | 'EMPLOYMENT_INCONSISTENCY'
  | 'START_DATE_REVIEW'
  | 'ASSESSMENT_PLAN_UNRESOLVED'
  | 'CLASSIFICATION_ERROR';

export type HrReconciliationInput = {
  sourceType: string;
  sourceId: string;
  isOperationallyCurrent: boolean;
  legacyOnlyReviewed: boolean;
  personnelLinkExpected: boolean;
  userPersonnelLinkResolved: boolean;
  identityAmbiguous: boolean;
  hasCurrentOrganizationalAssignment: boolean;
  employmentConsistent: boolean;
  startDateReviewOpen: boolean;
  assessmentPlanUnresolved: boolean;
  classificationError: boolean;
  suppressedAttentionFlags?: HrReconciliationAttentionFlag[];
};

export const classifyHrReconciliationRecord = (input: HrReconciliationInput) => {
  const attentionFlags: HrReconciliationAttentionFlag[] = [];
  const addFlag = (condition: boolean, flag: HrReconciliationAttentionFlag) => {
    if (condition && !input.suppressedAttentionFlags?.includes(flag)) attentionFlags.push(flag);
  };
  addFlag(input.sourceType === 'USER' && input.personnelLinkExpected && !input.userPersonnelLinkResolved, 'USER_PERSONNEL_LINKAGE');
  addFlag(input.identityAmbiguous, 'IDENTITY_AMBIGUITY');
  if (input.sourceType === 'PERSONNEL' && input.isOperationallyCurrent && !input.hasCurrentOrganizationalAssignment) {
    addFlag(true, 'CURRENT_ASSIGNMENT_GAP');
  }
  addFlag(!input.employmentConsistent, 'EMPLOYMENT_INCONSISTENCY');
  addFlag(input.startDateReviewOpen, 'START_DATE_REVIEW');
  addFlag(input.assessmentPlanUnresolved, 'ASSESSMENT_PLAN_UNRESOLVED');
  addFlag(input.classificationError, 'CLASSIFICATION_ERROR');

  return {
    primaryState: input.classificationError
      ? 'CLASSIFICATION_ERROR' as const
      : attentionFlags.length > 0
        ? 'NEEDS_REVIEW' as const
        : input.legacyOnlyReviewed && !input.isOperationallyCurrent
          ? 'LEGACY_ONLY_HISTORY' as const
        : 'READY' as const,
    attentionFlags,
    cutoverBlocker: attentionFlags.length > 0,
  };
};

type BackfillReportRow = { code: string; count: number };

export type HrRedesignBackfillReportInput = {
  safeBackfills: BackfillReportRow[];
  actionableConflicts: BackfillReportRow[];
  neutralLegacyOutcomes: BackfillReportRow[];
  blockingFailures: BackfillReportRow[];
};

const total = (rows: BackfillReportRow[]) => rows.reduce((sum, row) => sum + row.count, 0);

export const buildHrRedesignBackfillReport = (input: HrRedesignBackfillReportInput) => ({
  ...input,
  totals: {
    safeBackfills: total(input.safeBackfills),
    actionableConflicts: total(input.actionableConflicts),
    neutralLegacyOutcomes: total(input.neutralLegacyOutcomes),
    blockingFailures: total(input.blockingFailures),
  },
  canCutOver: total(input.actionableConflicts) === 0 && total(input.blockingFailures) === 0,
});

const featureDisplayNames: Record<string, string> = {
  DASHBOARD: 'Dashboard',
  ORGANIZATIONAL_STRUCTURE: 'Organizational Structure',
  PERSONNEL: 'Personnel',
  RECRUITMENT_CASES: 'Recruitment Cases',
  HR_WORK_MANAGEMENT: 'HR Work Management',
  AUTHORITY_RESPONSIBILITY_ADMINISTRATION: 'Authority and Responsibility Administration',
  DATA_MIGRATION_RECONCILIATION: 'Data Migration and Reconciliation',
  USER_ADMINISTRATION: 'User Administration',
};

const stableKey = (...parts: string[]) => ['hr-redesign-v1', ...parts].join(':');

export type RunHrRedesignBackfillOptions = {
  apply: boolean;
  shakilaUserId?: string;
  actorUserId?: string;
};

type HrBackfillClient = PrismaClient | Prisma.TransactionClient;

const ownsTransactionBoundary = (client: HrBackfillClient): client is PrismaClient => '$transaction' in client;

export const runHrRedesignBackfill = async (
  client: HrBackfillClient,
  options: RunHrRedesignBackfillOptions,
) => {
  const workspaceCodes = [HR_REDESIGN_CATALOG.workspaceCode];
  const featureCodes = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);
  const authorityCodes = [...HR_REDESIGN_CATALOG.businessAuthorities];
  const responsibilityCodes = [...HR_REDESIGN_CATALOG.responsibilityTypes];

  const [workspaceCount, featureCount, authorityCount, responsibilityCount, users, applications, personnel] = await Promise.all([
    client.hrWorkspaceCatalog.count({ where: { code: { in: workspaceCodes } } }),
    client.hrFeatureCatalog.count({ where: { code: { in: featureCodes } } }),
    client.hrAuthorityCatalog.count({ where: { code: { in: authorityCodes } } }),
    client.hrResponsibilityTypeCatalog.count({ where: { code: { in: responsibilityCodes } } }),
    client.user.findMany({
      where: { erasedAt: null },
      select: { id: true, role: true, isActive: true, personnelId: true },
    }),
    client.hrJobApplication.findMany({
      select: {
        id: true,
        stage: true,
        assessments: { select: { assessmentType: true } },
        formalAssessmentPlans: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
      },
    }),
    client.personnel.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isActive: true,
        hrEmploymentRelationships: {
          select: {
            status: true,
            startDateVerified: true,
            assignments: { select: { type: true, effectiveFrom: true, effectiveTo: true } },
          },
        },
      },
    }),
  ]);

  const blockingFailures: BackfillReportRow[] = [];
  let shakilaUser: { id: string; isActive: boolean } | null = null;
  if (!options.shakilaUserId) {
    blockingFailures.push({ code: 'MISSING_SHAKILA_STABLE_USER_ID', count: 1 });
  } else {
    shakilaUser = await client.user.findUnique({ where: { id: options.shakilaUserId }, select: { id: true, isActive: true } });
    if (!shakilaUser) blockingFailures.push({ code: 'SHAKILA_USER_NOT_FOUND', count: 1 });
    else if (!shakilaUser.isActive) blockingFailures.push({ code: 'SHAKILA_USER_INACTIVE', count: 1 });
  }

  const baselineUserIds = [...new Set([
    ...users.filter((user) => user.role === 'ADMIN' && user.isActive).map((user) => user.id),
    ...(shakilaUser?.isActive ? [shakilaUser.id] : []),
  ])];
  const expectedGrantKeys = baselineUserIds.flatMap((userId) => [
    stableKey('workspace-grant', userId, HR_REDESIGN_CATALOG.workspaceCode),
    ...featureCodes.map((code) => stableKey('feature-grant', userId, code)),
    ...authorityCodes.map((code) => stableKey('authority-grant', userId, code)),
  ]);
  const existingGrantCount = expectedGrantKeys.length === 0 ? 0 : await Promise.all([
    client.hrWorkspaceAccessGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
    client.hrFeatureAccessGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
    client.hrBusinessAuthorityGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
  ]).then((counts) => counts.reduce((sum, count) => sum + count, 0));

  const assessmentMigrations = applications.map((application: { id: string; assessments: Array<{ assessmentType: string }> }) => {
    const completedAssessmentKinds = [...new Set(application.assessments
      .map(({ assessmentType }) => assessmentType)
      .filter((kind): kind is HrAssessmentKind => HR_REDESIGN_CATALOG.assessmentKinds.includes(kind as HrAssessmentKind)))] as HrAssessmentKind[];
    return planLegacyAssessmentMigration({ applicationId: application.id, completedAssessmentKinds });
  });
  const assessmentEventKeys = assessmentMigrations.map(({ applicationId, neutralEvent }) => stableKey('assessment-event', applicationId, neutralEvent.code));
  const existingAssessmentEventCount = assessmentEventKeys.length === 0 ? 0 : await client.hrAssessmentMigrationEvent.count({
    where: { stableKey: { in: assessmentEventKeys } },
  });

  const now = new Date();
  const reconciliationInputs: HrReconciliationInput[] = [];
  for (const person of personnel) {
    const currentRelationships = person.hrEmploymentRelationships.filter((relationship) => ['ACTIVE', 'SUSPENDED'].includes(relationship.status));
    const isOperationallyCurrent = person.isActive || currentRelationships.length > 0;
    const hasCurrentOrganizationalAssignment = currentRelationships.some((relationship) => relationship.assignments.some((assignment) =>
      assignment.type === 'PRIMARY'
      && assignment.effectiveFrom <= now
      && (!assignment.effectiveTo || assignment.effectiveTo >= now)));
    reconciliationInputs.push({
      sourceType: 'PERSONNEL',
      sourceId: person.id,
      isOperationallyCurrent,
      legacyOnlyReviewed: false,
      personnelLinkExpected: false,
      userPersonnelLinkResolved: true,
      // Names are not identity evidence. Ambiguity is recorded only after an
      // explicit reconciliation review supplies identity evidence.
      identityAmbiguous: false,
      hasCurrentOrganizationalAssignment,
      employmentConsistent: person.isActive ? currentRelationships.length === 1 : currentRelationships.length === 0,
      startDateReviewOpen: currentRelationships.some((relationship) => !relationship.startDateVerified),
      assessmentPlanUnresolved: false,
      classificationError: false,
    });
  }
  for (const user of users) reconciliationInputs.push({
    sourceType: 'USER',
    sourceId: user.id,
    isOperationallyCurrent: user.isActive,
    legacyOnlyReviewed: false,
    // The absence of a link cannot distinguish access-only from an unresolved
    // workforce identity. A durable human review makes that classification.
    personnelLinkExpected: !user.personnelId,
    userPersonnelLinkResolved: Boolean(user.personnelId),
    identityAmbiguous: false,
    hasCurrentOrganizationalAssignment: true,
    employmentConsistent: true,
    startDateReviewOpen: false,
    assessmentPlanUnresolved: false,
    classificationError: false,
  });
  for (const application of applications) reconciliationInputs.push({
    sourceType: 'APPLICATION',
    sourceId: application.id,
    isOperationallyCurrent: application.stage !== 'CLOSED',
    legacyOnlyReviewed: false,
    personnelLinkExpected: false,
    userPersonnelLinkResolved: true,
    identityAmbiguous: false,
    hasCurrentOrganizationalAssignment: true,
    employmentConsistent: true,
    startDateReviewOpen: false,
    assessmentPlanUnresolved: application.stage !== 'CLOSED' && application.formalAssessmentPlans.length === 0,
    classificationError: false,
  });
  const reconciliationKeys = reconciliationInputs.map((input) => stableKey('reconciliation', input.sourceType, input.sourceId));
  const existingReconciliations = reconciliationKeys.length === 0 ? [] : await client.hrReconciliationRecord.findMany({
    where: { stableKey: { in: reconciliationKeys } },
    select: {
      stableKey: true,
      primaryState: true,
      cutoverBlocker: true,
      reviews: { orderBy: { version: 'desc' }, take: 1, select: { outcome: true } },
      attentionFlags: { orderBy: { version: 'desc' }, select: { flagCode: true, isActive: true, resolutionReason: true } },
    },
  });
  const existingReconciliationByKey = new Map(existingReconciliations.map((record) => [record.stableKey, record]));
  const reconciliations = reconciliationInputs.map((input) => {
    const key = stableKey('reconciliation', input.sourceType, input.sourceId);
    const existing = existingReconciliationByKey.get(key);
    const latestFlagByCode = new Map<string, { flagCode: string; isActive: boolean; resolutionReason: string | null }>();
    for (const flag of existing?.attentionFlags ?? []) if (!latestFlagByCode.has(flag.flagCode)) latestFlagByCode.set(flag.flagCode, flag);
    const suppressedAttentionFlags = [...latestFlagByCode.values()]
      .filter((flag) => !flag.isActive && flag.resolutionReason !== 'SOURCE_CONDITION_CLEARED_BY_BACKFILL')
      .map((flag) => flag.flagCode as HrReconciliationAttentionFlag);
    const legacyOnlyReviewed = existing?.reviews[0]?.outcome === 'ACCEPTED_LEGACY_ONLY';
    const accessOnlyReviewed = existing?.reviews[0]?.outcome === 'ACCEPTED_ACCESS_ONLY';
    const identityAmbiguous = latestFlagByCode.get('IDENTITY_AMBIGUITY')?.isActive === true;
    const reviewedInput = {
      ...input,
      legacyOnlyReviewed,
      personnelLinkExpected: input.personnelLinkExpected && !accessOnlyReviewed,
      identityAmbiguous,
      suppressedAttentionFlags,
    };
    return {
      input: reviewedInput,
      classification: classifyHrReconciliationRecord(reviewedInput),
    };
  });
  const existingReconciliationCount = existingReconciliations.length;
  const reconciliationStateChangeCount = reconciliations.filter(({ input, classification }) => {
    const existing = existingReconciliationByKey.get(stableKey('reconciliation', input.sourceType, input.sourceId));
    return existing && (
      existing.primaryState !== classification.primaryState
      || existing.cutoverBlocker !== classification.cutoverBlocker
    );
  }).length;
  const reconciliationFlagChangeCount = reconciliations.reduce((count, { input, classification }) => {
    const existing = existingReconciliationByKey.get(stableKey('reconciliation', input.sourceType, input.sourceId));
    const latestByCode = new Map<string, { isActive: boolean }>();
    for (const flag of existing?.attentionFlags ?? []) if (!latestByCode.has(flag.flagCode)) latestByCode.set(flag.flagCode, flag);
    const currentCodes = new Set<string>(classification.attentionFlags);
    const allCodes = new Set([...latestByCode.keys(), ...currentCodes]);
    return count + [...allCodes].filter((code) => Boolean(latestByCode.get(code)?.isActive) !== currentCodes.has(code)).length;
  }, 0);

  const missingCatalogCount = (workspaceCodes.length - workspaceCount)
    + (featureCodes.length - featureCount)
    + (authorityCodes.length - authorityCount)
    + (responsibilityCodes.length - responsibilityCount);
  const actionableConflictCount = reconciliations.filter(({ classification }) => classification.cutoverBlocker).length;

  const report = buildHrRedesignBackfillReport({
    safeBackfills: [
      { code: 'CATALOGS', count: missingCatalogCount },
      { code: 'BASELINE_GRANTS', count: expectedGrantKeys.length - existingGrantCount },
      { code: 'ASSESSMENT_MIGRATION_EVENTS', count: assessmentEventKeys.length - existingAssessmentEventCount },
      { code: 'RECONCILIATION_RECORDS', count: reconciliationKeys.length - existingReconciliationCount },
      { code: 'RECONCILIATION_STATE_CHANGES', count: reconciliationStateChangeCount },
      { code: 'RECONCILIATION_FLAG_CHANGES', count: reconciliationFlagChangeCount },
    ],
    actionableConflicts: [{ code: 'CURRENT_HR_RECONCILIATION', count: actionableConflictCount }],
    neutralLegacyOutcomes: [
      { code: 'NO_LEGACY_ASSESSMENT_HISTORY', count: assessmentMigrations.filter(({ neutralEvent }) => neutralEvent.code === 'NO_LEGACY_ASSESSMENT_HISTORY').length },
      { code: 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED', count: assessmentMigrations.filter(({ neutralEvent }) => neutralEvent.code === 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED').length },
    ],
    blockingFailures,
  });

  if (!options.apply) return report;

  const applyBackfill = async (tx: Prisma.TransactionClient) => {
    await tx.hrWorkspaceCatalog.upsert({
      where: { code: HR_REDESIGN_CATALOG.workspaceCode },
      update: { version: HR_REDESIGN_CATALOG.contractVersion, isActive: true },
      create: { code: HR_REDESIGN_CATALOG.workspaceCode, version: HR_REDESIGN_CATALOG.contractVersion, displayName: 'Human Resources' },
    });
    for (const code of featureCodes) await tx.hrFeatureCatalog.upsert({
      where: { code },
      update: { workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, version: HR_REDESIGN_CATALOG.contractVersion, isActive: true },
      create: { code, workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, version: HR_REDESIGN_CATALOG.contractVersion, displayName: featureDisplayNames[code] },
    });
    for (const code of authorityCodes) await tx.hrAuthorityCatalog.upsert({
      where: { code },
      update: { version: HR_REDESIGN_CATALOG.contractVersion, isActive: true },
      create: { code, version: HR_REDESIGN_CATALOG.contractVersion, displayName: code },
    });
    for (const code of responsibilityCodes) await tx.hrResponsibilityTypeCatalog.upsert({
      where: { code },
      update: { version: HR_REDESIGN_CATALOG.contractVersion, isActive: true },
      create: { code, version: HR_REDESIGN_CATALOG.contractVersion, displayName: code },
    });

    for (const userId of baselineUserIds) {
      await tx.hrWorkspaceAccessGrant.upsert({
        where: { stableKey: stableKey('workspace-grant', userId, HR_REDESIGN_CATALOG.workspaceCode) },
        update: {},
        create: {
          stableKey: stableKey('workspace-grant', userId, HR_REDESIGN_CATALOG.workspaceCode), userId,
          workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, level: 'ADMIN', effectiveFrom: now,
          grantedByUserId: options.actorUserId, reason: 'HR redesign baseline',
        },
      });
      for (const featureCode of featureCodes) await tx.hrFeatureAccessGrant.upsert({
        where: { stableKey: stableKey('feature-grant', userId, featureCode) }, update: {},
        create: { stableKey: stableKey('feature-grant', userId, featureCode), userId, featureCode, level: 'ADMIN', effectiveFrom: now, grantedByUserId: options.actorUserId, reason: 'HR redesign baseline' },
      });
      for (const authorityCode of authorityCodes) await tx.hrBusinessAuthorityGrant.upsert({
        where: { stableKey: stableKey('authority-grant', userId, authorityCode) }, update: {},
        create: { stableKey: stableKey('authority-grant', userId, authorityCode), userId, authorityCode, effectiveFrom: now, grantedByUserId: options.actorUserId, reason: 'HR redesign baseline' },
      });
    }

    for (const migration of assessmentMigrations) await tx.hrAssessmentMigrationEvent.upsert({
      where: { stableKey: stableKey('assessment-event', migration.applicationId, migration.neutralEvent.code) },
      update: {},
      create: {
        stableKey: stableKey('assessment-event', migration.applicationId, migration.neutralEvent.code),
        applicationId: migration.applicationId,
        eventCode: migration.neutralEvent.code,
        detailsJson: migration.neutralEvent.details,
      },
    });

    for (const { input, classification } of reconciliations) {
      const reconciliationKey = stableKey('reconciliation', input.sourceType, input.sourceId);
      const existing = await tx.hrReconciliationRecord.findUnique({
        where: { stableKey: reconciliationKey },
        include: { attentionFlags: { orderBy: { version: 'desc' } } },
      });
      const record = existing
        ? await tx.hrReconciliationRecord.update({
          where: { id: existing.id },
          data: existing.primaryState !== classification.primaryState || existing.cutoverBlocker !== classification.cutoverBlocker
            ? {
              primaryState: classification.primaryState,
              cutoverBlocker: classification.cutoverBlocker,
              stateVersion: { increment: 1 },
              detailsJson: { source: `LEGACY_${input.sourceType}` },
              classifiedAt: now,
              classifiedByUserId: options.actorUserId,
            }
            : {},
        })
        : await tx.hrReconciliationRecord.create({ data: {
          stableKey: reconciliationKey,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          primaryState: classification.primaryState,
          detailsJson: { source: `LEGACY_${input.sourceType}` },
          cutoverBlocker: classification.cutoverBlocker,
          classifiedAt: now,
          classifiedByUserId: options.actorUserId,
        } });
      const latestFlagByCode = new Map<string, {
        id: string;
        flagCode: string;
        version: number;
        isActive: boolean;
      }>();
      for (const flag of existing?.attentionFlags ?? []) if (!latestFlagByCode.has(flag.flagCode)) latestFlagByCode.set(flag.flagCode, flag);
      const currentFlagCodes = new Set<string>(classification.attentionFlags);
      const allFlagCodes = new Set([...latestFlagByCode.keys(), ...currentFlagCodes]);
      for (const flagCode of allFlagCodes) {
        const latestFlag = latestFlagByCode.get(flagCode);
        if (!currentFlagCodes.has(flagCode)) {
          if (latestFlag?.isActive) {
            await tx.hrReconciliationAttentionFlag.update({
              where: { id: latestFlag.id },
              data: {
                isActive: false,
                resolvedAt: now,
                resolvedByUserId: options.actorUserId,
                resolutionReason: 'SOURCE_CONDITION_CLEARED_BY_BACKFILL',
              },
            });
            const blocker = await tx.hrCutoverBlockerProjection.findFirst({
              where: { reconciliationId: record.id, blockerCode: flagCode, isActive: true },
              orderBy: { sourceVersion: 'desc' },
            });
            if (blocker) await tx.hrCutoverBlockerProjection.update({
              where: { id: blocker.id }, data: { isActive: false, clearedAt: now },
            });
          }
          continue;
        }
        if (latestFlag?.isActive) continue;
        const version = (latestFlag?.version ?? 0) + 1;
        const flagKey = version === 1
          ? stableKey('reconciliation-flag', record.id, flagCode)
          : stableKey('reconciliation-flag', record.id, flagCode, String(version));
        await tx.hrReconciliationAttentionFlag.create({ data: {
          stableKey: flagKey,
          reconciliationId: record.id,
          flagCode,
          version,
        } });
        const blockerKey = version === 1
          ? stableKey('cutover-blocker', record.id, flagCode)
          : stableKey('cutover-blocker', record.id, flagCode, String(version));
        await tx.hrCutoverBlockerProjection.create({ data: {
          stableKey: blockerKey,
          reconciliationId: record.id,
          blockerCode: flagCode,
          sourceVersion: version,
        } });
      }
    }
  };

  if (ownsTransactionBoundary(client)) {
    await client.$transaction(applyBackfill, { maxWait: 10_000, timeout: 120_000 });
  } else {
    await applyBackfill(client);
  }
  return report;
};
