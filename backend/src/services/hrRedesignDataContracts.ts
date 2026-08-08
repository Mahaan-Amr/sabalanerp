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
  isCurrent: boolean;
  hasLinkedUser: boolean;
  identityAmbiguous: boolean;
  hasCurrentOrganizationalAssignment: boolean;
  employmentConsistent: boolean;
  startDateReviewOpen: boolean;
  assessmentPlanUnresolved: boolean;
  classificationError: boolean;
};

export const classifyHrReconciliationRecord = (input: HrReconciliationInput) => {
  if (!input.isCurrent) {
    return {
      primaryState: 'LEGACY_ONLY_HISTORY' as const,
      attentionFlags: [] as HrReconciliationAttentionFlag[],
      cutoverBlocker: false,
    };
  }

  const attentionFlags: HrReconciliationAttentionFlag[] = [];
  if (!input.hasLinkedUser) attentionFlags.push('USER_PERSONNEL_LINKAGE');
  if (input.identityAmbiguous) attentionFlags.push('IDENTITY_AMBIGUITY');
  if (!input.hasCurrentOrganizationalAssignment) attentionFlags.push('CURRENT_ASSIGNMENT_GAP');
  if (!input.employmentConsistent) attentionFlags.push('EMPLOYMENT_INCONSISTENCY');
  if (input.startDateReviewOpen) attentionFlags.push('START_DATE_REVIEW');
  if (input.assessmentPlanUnresolved) attentionFlags.push('ASSESSMENT_PLAN_UNRESOLVED');
  if (input.classificationError) attentionFlags.push('CLASSIFICATION_ERROR');

  return {
    primaryState: input.classificationError
      ? 'CLASSIFICATION_ERROR' as const
      : attentionFlags.length > 0
        ? 'NEEDS_REVIEW' as const
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

export const runHrRedesignBackfill = async (
  client: PrismaClient,
  options: RunHrRedesignBackfillOptions,
) => {
  const workspaceCodes = [HR_REDESIGN_CATALOG.workspaceCode];
  const featureCodes = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);
  const authorityCodes = [...HR_REDESIGN_CATALOG.businessAuthorities];
  const responsibilityCodes = [...HR_REDESIGN_CATALOG.responsibilityTypes];

  const [workspaceCount, featureCount, authorityCount, responsibilityCount, admins, applications, activePersonnel] = await Promise.all([
    client.hrWorkspaceCatalog.count({ where: { code: { in: workspaceCodes } } }),
    client.hrFeatureCatalog.count({ where: { code: { in: featureCodes } } }),
    client.hrAuthorityCatalog.count({ where: { code: { in: authorityCodes } } }),
    client.hrResponsibilityTypeCatalog.count({ where: { code: { in: responsibilityCodes } } }),
    client.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } }),
    client.hrJobApplication.findMany({
      select: { id: true, stage: true, assessments: { select: { assessmentType: true } } },
    }),
    client.personnel.findMany({
      where: { isActive: true },
      select: {
        id: true,
        user: { select: { id: true } },
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
    ...admins.map((user: { id: string }) => user.id),
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
  const reconciliations = activePersonnel.map((person: any) => {
    const currentRelationships = person.hrEmploymentRelationships.filter((relationship: any) => ['ACTIVE', 'SUSPENDED'].includes(relationship.status));
    const hasCurrentOrganizationalAssignment = currentRelationships.some((relationship: any) => relationship.assignments.some((assignment: any) =>
      assignment.type === 'PRIMARY'
      && assignment.effectiveFrom <= now
      && (!assignment.effectiveTo || assignment.effectiveTo >= now)));
    return {
      person,
      classification: classifyHrReconciliationRecord({
        sourceType: 'PERSONNEL',
        sourceId: person.id,
        isCurrent: true,
        hasLinkedUser: Boolean(person.user),
        identityAmbiguous: false,
        hasCurrentOrganizationalAssignment,
        employmentConsistent: currentRelationships.length === 1,
        startDateReviewOpen: currentRelationships.some((relationship: any) => !relationship.startDateVerified),
        assessmentPlanUnresolved: false,
        classificationError: false,
      }),
    };
  });
  const reconciliationKeys = reconciliations.map(({ person }) => stableKey('reconciliation', 'PERSONNEL', person.id));
  const existingReconciliationCount = reconciliationKeys.length === 0 ? 0 : await client.hrReconciliationRecord.count({
    where: { stableKey: { in: reconciliationKeys } },
  });

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

    for (const { person, classification } of reconciliations) {
      const reconciliationKey = stableKey('reconciliation', 'PERSONNEL', person.id);
      const record = await tx.hrReconciliationRecord.upsert({
        where: { stableKey: reconciliationKey },
        update: {},
        create: {
          stableKey: reconciliationKey, sourceType: 'PERSONNEL', sourceId: person.id,
          primaryState: classification.primaryState, detailsJson: { source: 'LEGACY_PERSONNEL' },
          cutoverBlocker: classification.cutoverBlocker, classifiedAt: now, classifiedByUserId: options.actorUserId,
        },
      });
      for (const flagCode of classification.attentionFlags) {
        const flagKey = stableKey('reconciliation-flag', record.id, flagCode);
        await tx.hrReconciliationAttentionFlag.upsert({
          where: { stableKey: flagKey }, update: {},
          create: { stableKey: flagKey, reconciliationId: record.id, flagCode },
        });
        const blockerKey = stableKey('cutover-blocker', record.id, flagCode);
        await tx.hrCutoverBlockerProjection.upsert({
          where: { stableKey: blockerKey }, update: {},
          create: { stableKey: blockerKey, reconciliationId: record.id, blockerCode: flagCode, sourceVersion: 1 },
        });
      }
    }
  };

  await client.$transaction(applyBackfill, { maxWait: 10_000, timeout: 120_000 });
  return report;
};
