import type { Prisma, PrismaClient } from '@prisma/client';
import {
  classifyHrMigrationRecord,
  findPossibleDuplicateNationalIdentities,
  type HrMigrationClassificationInput,
  type HrReconciliationAttentionFlag as ActionableHrReconciliationFlag,
  type HrReconciliationReviewOutcome as ActionableHrReconciliationOutcome,
} from './hrMigrationReconciliation';
import { applyHrCompanyManagerCutover, inspectHrCompanyManagerCutover } from './hrCompanyManagerCutover';
import { HR_ACTION_PERMISSIONS, actionPermissionsForLegacyAuthority } from './hrActionPermissionCatalog';

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
    // HR-owned driver, vehicle and biometric capabilities use the same
    // effective-dated grant ledger as every other HR capability.
    { code: 'hr_internal_drivers_view' },
    { code: 'hr_internal_drivers_manage' },
    { code: 'hr_vehicle_operations_view' },
    { code: 'hr_vehicle_operations_manage' },
    { code: 'hr_internal_driver_eligibility_manage' },
    { code: 'hr_driver_biometric_audit_view' },
    { code: 'hr_driver_biometric_enrollment_manage' },
    { code: 'hr_driver_profiles_manage' },
    { code: 'hr_company_vehicles_manage' },
    { code: 'hr_vehicle_plates_manage' },
    { code: 'hr_driver_vehicle_assignments_manage' },
    { code: 'hr_vehicle_operations_audit_view' },
    ...HR_ACTION_PERMISSIONS.map(({ code }) => ({ code })),
  ] as const,
  featureLevels: ['VIEW', 'EDIT', 'ADMIN'] as const,
  businessAuthorities: [
    'HR_PROCESSOR',
    'HR_MANAGER',
    'COMPANY_MANAGER',
    'HR_PAYROLL_PROCESSOR',
    'HR_PAYROLL_MANAGER',
    'FINANCE_RECORDER',
    'FINANCE_MANAGER',
  ] as const,
  responsibilityTypes: [
    'HR_PROCESSOR',
    'HR_MANAGER',
    'RESPONSIBLE_SUPERVISOR',
    'COMPANY_MANAGER',
    'HR_PAYROLL_PROCESSOR',
    'HR_PAYROLL_MANAGER',
    'FINANCE_RECORDER',
    'FINANCE_MANAGER',
  ] as const,
  assessmentKinds: ['DISC', 'EQ', 'BIG_FIVE'] as const,
  dutyEnvelopeVersion: 1,
});

type QaFeatureLevels = Partial<Record<typeof HR_REDESIGN_CATALOG.workspaceFeatures[number]['code'], 'VIEW' | 'EDIT' | 'ADMIN'>>;
type QaAccessContract = {
  workspaceLevel: 'VIEW' | 'EDIT' | 'ADMIN' | null;
  features: QaFeatureLevels;
  authority: typeof HR_REDESIGN_CATALOG.businessAuthorities[number] | null;
  responsibility: typeof HR_REDESIGN_CATALOG.responsibilityTypes[number] | null;
  destinationWorkspace: string | null;
  responsibilityScope?: 'GLOBAL' | 'RECORDED_POSITION';
};

const everyFeatureAt = (level: 'VIEW' | 'EDIT' | 'ADMIN'): QaFeatureLevels => Object.fromEntries(
  HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => [code, level]),
) as QaFeatureLevels;

export const HR_QA_ACCESS_MATRIX: Record<string, QaAccessContract> = Object.freeze({
  qa_no_hr_access: { workspaceLevel: null, features: {}, authority: null, responsibility: null, destinationWorkspace: null },
  qa_hr_viewer: { workspaceLevel: 'VIEW', features: everyFeatureAt('VIEW'), authority: null, responsibility: null, destinationWorkspace: null },
  qa_finance_manager: { workspaceLevel: null, features: {}, authority: 'FINANCE_MANAGER', responsibility: 'FINANCE_MANAGER', destinationWorkspace: 'ACCOUNTING' },
  qa_finance_recorder: { workspaceLevel: null, features: {}, authority: 'FINANCE_RECORDER', responsibility: 'FINANCE_RECORDER', destinationWorkspace: 'ACCOUNTING' },
  qa_payroll_manager: {
    workspaceLevel: 'EDIT',
    features: { DASHBOARD: 'VIEW', PERSONNEL: 'VIEW', RECRUITMENT_CASES: 'VIEW', HR_WORK_MANAGEMENT: 'EDIT' },
    authority: 'HR_PAYROLL_MANAGER', responsibility: 'HR_PAYROLL_MANAGER', destinationWorkspace: 'HUMAN_RESOURCES',
  },
  qa_payroll_processor: {
    workspaceLevel: 'EDIT',
    features: { DASHBOARD: 'VIEW', PERSONNEL: 'VIEW', RECRUITMENT_CASES: 'EDIT', HR_WORK_MANAGEMENT: 'EDIT' },
    authority: 'HR_PAYROLL_PROCESSOR', responsibility: 'HR_PAYROLL_PROCESSOR', destinationWorkspace: 'HUMAN_RESOURCES',
  },
  qa_hr_manager: {
    workspaceLevel: 'ADMIN',
    features: {
      PERSONNEL: 'VIEW', RECRUITMENT_CASES: 'VIEW', HR_WORK_MANAGEMENT: 'VIEW',
      VIEW_INITIAL_INTERVIEW_CRITERIA: 'VIEW', VIEW_INITIAL_INTERVIEW_REPORT: 'VIEW',
      RECORD_PRELIMINARY_DECISION: 'EDIT', MANAGE_INITIAL_INTERVIEW_CRITERIA: 'ADMIN',
      ARCHIVE_RECRUITMENT_CASE: 'ADMIN', MANAGE_HR_WORK: 'EDIT',
      MANAGE_RECRUITMENT_CASE: 'EDIT', MANAGE_PERSONNEL_SCHEDULE: 'EDIT',
    },
    authority: 'HR_MANAGER', responsibility: 'HR_MANAGER', destinationWorkspace: 'HUMAN_RESOURCES',
  },
  qa_hr_processor: {
    workspaceLevel: 'EDIT',
    features: {
      DASHBOARD: 'VIEW', ORGANIZATIONAL_STRUCTURE: 'VIEW', PERSONNEL: 'EDIT', RECRUITMENT_CASES: 'EDIT',
      HR_WORK_MANAGEMENT: 'EDIT', AUTHORITY_RESPONSIBILITY_ADMINISTRATION: 'VIEW', DATA_MIGRATION_RECONCILIATION: 'VIEW',
    },
    authority: 'HR_PROCESSOR', responsibility: 'HR_PROCESSOR', destinationWorkspace: 'HUMAN_RESOURCES',
  },
});

const qaFeatureEntries = (contract: QaAccessContract) => {
  const entries = new Map<string, 'VIEW' | 'EDIT' | 'ADMIN'>(
    Object.entries(contract.features) as Array<[string, 'VIEW' | 'EDIT' | 'ADMIN']>,
  );
  if (contract.authority) for (const code of actionPermissionsForLegacyAuthority(contract.authority)) {
    const definition = HR_ACTION_PERMISSIONS.find((permission) => permission.code === code);
    if (definition) entries.set(code, definition.level);
  }
  return [...entries.entries()];
};

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
    const normalized = grant.feature.trim().replace(/[\s-]+/g, '_');
    const catalogFeature = HR_REDESIGN_CATALOG.workspaceFeatures.find(
      (feature) => feature.code.toLocaleLowerCase('en-US') === normalized.toLocaleLowerCase('en-US'),
    );
    if (!catalogFeature) return [];
    const featureCode = catalogFeature.code;
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
  organizationalMappingComplete: boolean;
  primaryAssignmentPresent: boolean;
  employmentConsistent: boolean;
  startDateReviewOpen: boolean;
  assessmentPlanUnresolved: boolean;
  classificationError: boolean;
  suppressedAttentionFlags?: HrReconciliationAttentionFlag[];
};

export const classifyHrReconciliationRecord = (input: HrReconciliationInput) => {
  const flagMap: Partial<Record<HrReconciliationAttentionFlag, ActionableHrReconciliationFlag>> = {
    USER_PERSONNEL_LINKAGE: 'UNRESOLVED_PERSONNEL_LINKAGE',
    IDENTITY_AMBIGUITY: 'POSSIBLE_DUPLICATE_IDENTITY',
    CURRENT_ASSIGNMENT_GAP: 'MISSING_PRIMARY_ASSIGNMENT',
    EMPLOYMENT_INCONSISTENCY: 'EMPLOYMENT_STATE_INCONSISTENCY',
    START_DATE_REVIEW: 'OPEN_START_DATE_REVIEW',
    ASSESSMENT_PLAN_UNRESOLVED: 'ASSESSMENT_PLAN_RECONCILIATION',
    CLASSIFICATION_ERROR: 'CLASSIFICATION_ERROR',
  };
  return classifyHrMigrationRecord({
    sourceType: input.classificationError ? 'UNREGISTERED_SOURCE' : input.sourceType,
    sourceId: input.sourceId,
    operationallyCurrent: input.isOperationallyCurrent,
    personnelLinkResolved: input.userPersonnelLinkResolved,
    organizationalMappingComplete: input.organizationalMappingComplete,
    primaryAssignmentPresent: input.primaryAssignmentPresent,
    employmentStateConsistent: input.employmentConsistent,
    startDateReviewOpen: input.startDateReviewOpen,
    assessmentPlanReconciliationOpen: input.assessmentPlanUnresolved,
    possibleDuplicateIdentity: input.identityAmbiguous,
    legacyOnly: input.legacyOnlyReviewed && !input.isOperationallyCurrent,
    durableReviewOutcome: input.sourceType === 'USER' && !input.userPersonnelLinkResolved && !input.personnelLinkExpected
      ? 'ACCESS_ONLY_USER'
      : null,
    suppressedAttentionFlags: input.suppressedAttentionFlags?.flatMap((flag) => flagMap[flag] ? [flagMap[flag]!] : []),
  });
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
  hr_internal_drivers_view: 'مشاهده رانندگان داخلی',
  hr_internal_drivers_manage: 'مدیریت رانندگان داخلی',
  hr_vehicle_operations_view: 'مشاهده عملیات خودرو',
  hr_vehicle_operations_manage: 'مدیریت عملیات خودرو',
  hr_internal_driver_eligibility_manage: 'مدیریت صلاحیت راننده داخلی',
  hr_driver_biometric_audit_view: 'مشاهده ممیزی بیومتریک راننده',
  hr_driver_biometric_enrollment_manage: 'مدیریت ثبت بیومتریک راننده',
  hr_driver_profiles_manage: 'مدیریت پروفایل رانندگان',
  hr_company_vehicles_manage: 'مدیریت خودروهای شرکت',
  hr_vehicle_plates_manage: 'مدیریت پلاک خودروها',
  hr_driver_vehicle_assignments_manage: 'مدیریت تخصیص راننده و خودرو',
  hr_vehicle_operations_audit_view: 'مشاهده ممیزی عملیات خودرو',
  ...Object.fromEntries(HR_ACTION_PERMISSIONS.map(({ code, labelFa }) => [code, labelFa])),
};

const stableKey = (...parts: string[]) => ['hr-redesign-v1', ...parts].join(':');

export type RunHrRedesignBackfillOptions = {
  apply: boolean;
  actorUserId?: string;
};

type HrBackfillClient = PrismaClient | Prisma.TransactionClient;

const ownsTransactionBoundary = (client: HrBackfillClient): client is PrismaClient => '$transaction' in client;

export const runHrRedesignBackfill = async (
  client: HrBackfillClient,
  options: RunHrRedesignBackfillOptions,
) => {
  const now = new Date();
  const workspaceCodes = [HR_REDESIGN_CATALOG.workspaceCode];
  const featureCodes = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);
  const authorityCodes = [...HR_REDESIGN_CATALOG.businessAuthorities];
  const responsibilityCodes = [...HR_REDESIGN_CATALOG.responsibilityTypes];

  const [workspaceCount, featureCount, authorityCount, responsibilityCount, users, applications, personnel, legacyRoleWorkspaces, legacyRoleFeatures] = await Promise.all([
    client.hrWorkspaceCatalog.count({ where: { code: { in: workspaceCodes } } }),
    client.hrFeatureCatalog.count({ where: { code: { in: featureCodes } } }),
    client.hrAuthorityCatalog.count({ where: { code: { in: authorityCodes } } }),
    client.hrResponsibilityTypeCatalog.count({ where: { code: { in: responsibilityCodes } } }),
    client.user.findMany({
      where: { erasedAt: null },
      select: {
        id: true, username: true, role: true, isActive: true, personnelId: true,
        workspacePermissions: {
          where: { workspace: 'hr', isActive: true },
          select: { id: true, workspace: true, permissionLevel: true, isActive: true, grantedAt: true, expiresAt: true },
        },
        featurePermissions: {
          where: { workspace: 'hr', isActive: true },
          select: { id: true, feature: true, permissionLevel: true, isActive: true, grantedAt: true, expiresAt: true },
        },
        personnel: {
          select: {
            hrEmploymentRelationships: {
              where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
              select: {
                assignments: {
                  where: {
                    type: 'PRIMARY', effectiveFrom: { lte: now },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                  },
                  select: { positionId: true },
                },
              },
            },
          },
        },
      },
    }),
    client.hrJobApplication.findMany({
      select: {
        id: true,
        stage: true,
        candidate: { select: { firstName: true, lastName: true, nationalCode: true, linkedPersonnelId: true } },
        assessments: { select: { assessmentType: true } },
        formalAssessmentPlans: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
      },
    }),
    client.personnel.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nationalCode: true,
        employeeNumber: true,
        isActive: true,
        hrEmploymentRelationships: {
          select: {
            id: true,
            status: true,
            startDateVerified: true,
            assignments: { select: { type: true, positionId: true, organizationalUnitId: true, effectiveFrom: true, effectiveTo: true } },
          },
        },
      },
    }),
    client.roleWorkspacePermission.findMany({
      where: { workspace: 'hr', isActive: true },
      select: { id: true, role: true, workspace: true, permissionLevel: true, isActive: true, createdAt: true },
    }),
    client.roleFeaturePermission.findMany({
      where: { workspace: 'hr', isActive: true },
      select: { id: true, role: true, feature: true, permissionLevel: true, isActive: true, createdAt: true },
    }),
  ]);

  const blockingFailures: BackfillReportRow[] = [];
  const companyManagerCutover = await inspectHrCompanyManagerCutover(client);
  for (const code of companyManagerCutover.blockers) blockingFailures.push({ code, count: 1 });
  const currentUsers = users.filter((user) => user.username !== 'qa_hiring_manager');
  const baselineUserIds = [...new Set(currentUsers
    .filter((user) => user.role === 'ADMIN' && user.isActive)
    .map((user) => user.id))];
  const qaUsersByUsername = new Map(currentUsers
    .filter((user) => user.isActive && Object.prototype.hasOwnProperty.call(HR_QA_ACCESS_MATRIX, user.username))
    .map((user) => [user.username, user]));
  const missingQaUsernames = Object.keys(HR_QA_ACCESS_MATRIX).filter((username) => !qaUsersByUsername.has(username));
  const qaResponsibilityRouting = new Map<string, { scopeType: string; scopeId: string | null; destinationWorkspace: string }>();
  for (const [username, user] of qaUsersByUsername) {
    const contract = HR_QA_ACCESS_MATRIX[username];
    if (!contract.responsibility) continue;
    if (contract.destinationWorkspace) qaResponsibilityRouting.set(username, {
      scopeType: 'GLOBAL', scopeId: null, destinationWorkspace: contract.destinationWorkspace,
    });
  }
  const qaGrantKeys = [...qaUsersByUsername].flatMap(([username, user]) => {
    const contract = HR_QA_ACCESS_MATRIX[username];
    return [
      ...(contract.workspaceLevel ? [stableKey('qa-workspace-grant', user.id)] : []),
      ...qaFeatureEntries(contract).map(([featureCode]) => stableKey('qa-feature-grant', user.id, featureCode)),
      ...(contract.authority ? [stableKey('qa-authority-grant', user.id, contract.authority)] : []),
    ];
  });
  const migrationLevelRank = { VIEW: 1, EDIT: 2, ADMIN: 3 } as const;
  const legacyAccessProjections = currentUsers.map((user) => {
    const roleWorkspace = legacyRoleWorkspaces.find((grant) => grant.role === user.role);
    const directFeatureCodes = new Set(user.featurePermissions.map(({ feature }) => feature.toLocaleLowerCase('en-US')));
    const inheritedFeatures = legacyRoleFeatures
      .filter((grant) => grant.role === user.role && !directFeatureCodes.has(grant.feature.toLocaleLowerCase('en-US')))
      .map((grant) => ({ ...grant, id: `${grant.id}:${user.id}`, grantedAt: grant.createdAt, expiresAt: null }));
    const combinedFeatures = [...user.featurePermissions, ...inheritedFeatures];
    const projection = projectLegacyHrAccess({
      userId: user.id,
      workspacePermission: user.workspacePermissions[0] ?? (roleWorkspace ? {
        ...roleWorkspace, id: `${roleWorkspace.id}:${user.id}`, grantedAt: roleWorkspace.createdAt, expiresAt: null,
      } : null),
      featurePermissions: combinedFeatures,
      authorities: [],
      now,
    });
    const prerequisiteLevel = [projection.workspaceGrant?.level, ...projection.featureGrants.map(({ level }) => level)]
      .filter((level): level is 'VIEW' | 'EDIT' | 'ADMIN' => Boolean(level))
      .sort((left, right) => migrationLevelRank[right] - migrationLevelRank[left])[0] ?? null;
    const knownCodes = new Set(HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code.toLocaleLowerCase('en-US')));
    const unmappedFeatures = combinedFeatures.filter(({ feature }) => !knownCodes.has(feature.trim().replace(/[\s-]+/g, '_').toLocaleLowerCase('en-US')));
    const ambiguousFeatures = user.featurePermissions.filter((direct) => legacyRoleFeatures.some((roleGrant) => (
      roleGrant.role === user.role
      && roleGrant.feature.toLocaleLowerCase('en-US') === direct.feature.toLocaleLowerCase('en-US')
      && roleGrant.permissionLevel.toLocaleLowerCase('en-US') !== direct.permissionLevel.toLocaleLowerCase('en-US')
    )));
    return { user, projection, prerequisiteLevel, unmappedFeatures, ambiguousFeatures };
  });
  const legacyGrantKeys = legacyAccessProjections.flatMap(({ user, projection, prerequisiteLevel }) => [
    ...(prerequisiteLevel ? [stableKey('legacy-workspace-prerequisite-v1', user.id)] : []),
    ...projection.featureGrants.map((grant) => stableKey('legacy-feature-conversion-v1', grant.legacyGrantId)),
  ]);
  const expectedGrantKeys = [...baselineUserIds.flatMap((userId) => [
    stableKey('workspace-grant', userId, HR_REDESIGN_CATALOG.workspaceCode),
    ...featureCodes.map((code) => stableKey('feature-grant', userId, code)),
    ...authorityCodes.map((code) => stableKey('authority-grant', userId, code)),
  ]), ...qaGrantKeys, ...legacyGrantKeys];
  const existingGrantCount = expectedGrantKeys.length === 0 ? 0 : await Promise.all([
    client.hrWorkspaceAccessGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
    client.hrFeatureAccessGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
    client.hrBusinessAuthorityGrant.count({ where: { stableKey: { in: expectedGrantKeys } } }),
  ]).then((counts) => counts.reduce((sum, count) => sum + count, 0));
  const existingLegacyGrantCount = legacyGrantKeys.length === 0 ? 0 : await Promise.all([
    client.hrWorkspaceAccessGrant.count({ where: { stableKey: { in: legacyGrantKeys } } }),
    client.hrFeatureAccessGrant.count({ where: { stableKey: { in: legacyGrantKeys } } }),
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

  const reconciliationInputs: HrReconciliationInput[] = [];
  const possibleDuplicateIdentityRecordIds = new Set(findPossibleDuplicateNationalIdentities([
    ...personnel.map((person) => ({
      id: person.id,
      nationalCode: person.nationalCode,
    })),
    ...applications.filter((application) => !application.candidate.linkedPersonnelId).map((application) => ({
      id: `APPLICATION:${application.id}`,
      nationalCode: application.candidate.nationalCode,
    })),
  ]).flatMap(({ personnelIds }) => personnelIds));
  for (const person of personnel) {
    const currentRelationships = person.hrEmploymentRelationships.filter((relationship) => ['ACTIVE', 'SUSPENDED'].includes(relationship.status));
    const isOperationallyCurrent = person.isActive || currentRelationships.length > 0;
    const currentPrimaryAssignments = currentRelationships.flatMap((relationship) => relationship.assignments.filter((assignment) =>
      assignment.type === 'PRIMARY'
      && assignment.effectiveFrom <= now
      && (!assignment.effectiveTo || assignment.effectiveTo >= now)));
    const primaryAssignmentPresent = currentPrimaryAssignments.length > 0;
    const organizationalMappingComplete = currentPrimaryAssignments.some((assignment) => Boolean(assignment.organizationalUnitId));
    reconciliationInputs.push({
      sourceType: 'PERSONNEL',
      sourceId: person.id,
      isOperationallyCurrent,
      legacyOnlyReviewed: false,
      personnelLinkExpected: false,
      userPersonnelLinkResolved: true,
      // Only confirmed links or a valid national identity are evidence;
      // employee numbers and name similarity never participate.
      identityAmbiguous: possibleDuplicateIdentityRecordIds.has(person.id),
      organizationalMappingComplete,
      primaryAssignmentPresent,
      employmentConsistent: person.isActive ? currentRelationships.length === 1 : currentRelationships.length === 0,
      startDateReviewOpen: currentRelationships.some((relationship) => !relationship.startDateVerified),
      assessmentPlanUnresolved: false,
      classificationError: false,
    });
    for (const relationship of person.hrEmploymentRelationships) {
      const operationallyCurrent = ['ACTIVE', 'SUSPENDED'].includes(relationship.status);
      const currentPrimaryAssignments = relationship.assignments.filter((assignment) => assignment.type === 'PRIMARY'
        && assignment.effectiveFrom <= now
        && (!assignment.effectiveTo || assignment.effectiveTo >= now));
      reconciliationInputs.push({
        sourceType: 'EMPLOYMENT_RELATIONSHIP',
        sourceId: relationship.id,
        isOperationallyCurrent: operationallyCurrent,
        legacyOnlyReviewed: false,
        personnelLinkExpected: false,
        userPersonnelLinkResolved: true,
        identityAmbiguous: false,
        organizationalMappingComplete: !operationallyCurrent || currentPrimaryAssignments.some((assignment) => Boolean(assignment.organizationalUnitId)),
        primaryAssignmentPresent: !operationallyCurrent || currentPrimaryAssignments.length > 0,
        employmentConsistent: !operationallyCurrent || person.isActive,
        startDateReviewOpen: !relationship.startDateVerified,
        assessmentPlanUnresolved: false,
        classificationError: false,
      });
    }
  }
  for (const user of currentUsers) reconciliationInputs.push({
    sourceType: 'USER',
    sourceId: user.id,
    isOperationallyCurrent: user.isActive,
    legacyOnlyReviewed: false,
    // The absence of a link cannot distinguish access-only from an unresolved
    // workforce identity. A durable human review makes that classification.
    personnelLinkExpected: !user.personnelId,
    userPersonnelLinkResolved: Boolean(user.personnelId),
    identityAmbiguous: false,
    organizationalMappingComplete: true,
    primaryAssignmentPresent: true,
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
    identityAmbiguous: possibleDuplicateIdentityRecordIds.has(`APPLICATION:${application.id}`),
    organizationalMappingComplete: true,
    primaryAssignmentPresent: true,
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
    const reviewOutcome = String(existing?.reviews[0]?.outcome ?? '');
    const legacyOnlyReviewed = ['ACCEPTED_LEGACY_ONLY', 'LEGACY_ONLY_CONFIRMED'].includes(reviewOutcome);
    const accessOnlyReviewed = ['ACCEPTED_ACCESS_ONLY', 'ACCESS_ONLY_USER'].includes(reviewOutcome);
    const identityAmbiguous = input.identityAmbiguous || ['IDENTITY_AMBIGUITY', 'POSSIBLE_DUPLICATE_IDENTITY']
      .some((flag) => latestFlagByCode.get(flag)?.isActive === true);
    const reviewedInput = {
      ...input,
      legacyOnlyReviewed,
      personnelLinkExpected: input.personnelLinkExpected && !accessOnlyReviewed,
      identityAmbiguous,
      suppressedAttentionFlags,
    };
    const durableReviewOutcome = reviewOutcome === 'ACCEPTED_ACCESS_ONLY'
      ? 'ACCESS_ONLY_USER'
      : reviewOutcome === 'ACCEPTED_LEGACY_ONLY'
        ? 'LEGACY_ONLY_CONFIRMED'
        : reviewOutcome || null;
    const actionableInput: HrMigrationClassificationInput = {
      sourceType: reviewedInput.sourceType,
      sourceId: reviewedInput.sourceId,
      operationallyCurrent: reviewedInput.isOperationallyCurrent,
      personnelLinkResolved: reviewedInput.userPersonnelLinkResolved,
      organizationalMappingComplete: reviewedInput.organizationalMappingComplete,
      primaryAssignmentPresent: reviewedInput.primaryAssignmentPresent,
      employmentStateConsistent: reviewedInput.employmentConsistent,
      startDateReviewOpen: reviewedInput.startDateReviewOpen,
      assessmentPlanReconciliationOpen: reviewedInput.assessmentPlanUnresolved,
      possibleDuplicateIdentity: identityAmbiguous,
      legacyOnly: legacyOnlyReviewed && !reviewedInput.isOperationallyCurrent,
      durableReviewOutcome: durableReviewOutcome as ActionableHrReconciliationOutcome | null,
      suppressedAttentionFlags: suppressedAttentionFlags as ActionableHrReconciliationFlag[],
    };
    return {
      input: reviewedInput,
      classification: classifyHrMigrationRecord(actionableInput),
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
  const unmappedLegacyPermissionCount = legacyAccessProjections.reduce((sum, item) => sum + item.unmappedFeatures.length, 0);
  const ambiguousLegacyPermissionCount = legacyAccessProjections.reduce((sum, item) => sum + item.ambiguousFeatures.length, 0);
  const preservedLegacyPermissionCount = legacyAccessProjections.reduce((sum, item) => (
    sum + item.projection.featureGrants.length + (item.prerequisiteLevel ? 1 : 0)
  ), 0);

  const report = buildHrRedesignBackfillReport({
    safeBackfills: [
      { code: 'COMPANY_MANAGER_WORKFLOW_CUTOVER', count: companyManagerCutover.pendingChanges },
      { code: 'CATALOGS', count: missingCatalogCount },
      { code: 'BASELINE_GRANTS', count: expectedGrantKeys.length - existingGrantCount },
      { code: 'LEGACY_PERMISSION_CONVERSION_V1', count: legacyGrantKeys.length - existingLegacyGrantCount },
      { code: 'ASSESSMENT_MIGRATION_EVENTS', count: assessmentEventKeys.length - existingAssessmentEventCount },
      { code: 'RECONCILIATION_RECORDS', count: reconciliationKeys.length - existingReconciliationCount },
      { code: 'RECONCILIATION_STATE_CHANGES', count: reconciliationStateChangeCount },
      { code: 'RECONCILIATION_FLAG_CHANGES', count: reconciliationFlagChangeCount },
    ],
    actionableConflicts: [
      { code: 'CURRENT_HR_RECONCILIATION', count: actionableConflictCount },
      { code: 'MISSING_PERSISTENT_QA_ACCOUNTS', count: missingQaUsernames.length },
      { code: 'LEGACY_PERMISSION_AMBIGUITY', count: ambiguousLegacyPermissionCount },
    ],
    neutralLegacyOutcomes: [
      { code: 'LEGACY_PERMISSION_PARITY_PRESERVED', count: preservedLegacyPermissionCount },
      { code: 'NO_LEGACY_ASSESSMENT_HISTORY', count: assessmentMigrations.filter(({ neutralEvent }) => neutralEvent.code === 'NO_LEGACY_ASSESSMENT_HISTORY').length },
      { code: 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED', count: assessmentMigrations.filter(({ neutralEvent }) => neutralEvent.code === 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED').length },
    ],
    blockingFailures: [
      ...blockingFailures,
      { code: 'UNMAPPED_LEGACY_HR_PERMISSION', count: unmappedLegacyPermissionCount },
    ],
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

    await applyHrCompanyManagerCutover(tx, companyManagerCutover, now);

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

    for (const { user, projection, prerequisiteLevel } of legacyAccessProjections) {
      if (prerequisiteLevel) await tx.hrWorkspaceAccessGrant.upsert({
        where: { stableKey: stableKey('legacy-workspace-prerequisite-v1', user.id) },
        update: {},
        create: {
          stableKey: stableKey('legacy-workspace-prerequisite-v1', user.id),
          userId: user.id,
          workspaceCode: HR_REDESIGN_CATALOG.workspaceCode,
          level: prerequisiteLevel,
          status: 'ACTIVE',
          effectiveFrom: projection.workspaceGrant?.effectiveFrom
            ?? projection.featureGrants.map(({ effectiveFrom }) => effectiveFrom).sort((left, right) => left.getTime() - right.getTime())[0]
            ?? now,
          effectiveTo: projection.workspaceGrant?.effectiveTo ?? null,
          grantedByUserId: options.actorUserId,
          reason: 'Legacy HR prerequisite-preserving conversion v1',
        },
      });
      for (const grant of projection.featureGrants) await tx.hrFeatureAccessGrant.upsert({
        where: { stableKey: stableKey('legacy-feature-conversion-v1', grant.legacyGrantId) },
        update: {},
        create: {
          stableKey: stableKey('legacy-feature-conversion-v1', grant.legacyGrantId),
          userId: grant.userId,
          featureCode: grant.featureCode,
          level: grant.level,
          status: grant.status,
          effectiveFrom: grant.effectiveFrom,
          effectiveTo: grant.effectiveTo,
          grantedByUserId: options.actorUserId,
          reason: 'Legacy HR permission conversion v1',
        },
      });
    }

    for (const [username, user] of qaUsersByUsername) {
      const contract = HR_QA_ACCESS_MATRIX[username];
      const featureEntries = qaFeatureEntries(contract);
      const expectedFeatureGrantKeys = featureEntries.map(([featureCode]) => stableKey('qa-feature-grant', user.id, featureCode));
      const expectedAuthorityGrantKey = contract.authority ? stableKey('qa-authority-grant', user.id, contract.authority) : null;
      const responsibilityRouting = qaResponsibilityRouting.get(username);
      const expectedResponsibilityKey = contract.responsibility && responsibilityRouting
        ? stableKey(
          'qa-responsibility', user.id, contract.responsibility,
          responsibilityRouting.scopeType, responsibilityRouting.scopeId ?? 'GLOBAL',
        )
        : null;

      const workspaceGrantsToRevoke = await tx.hrWorkspaceAccessGrant.findMany({
        where: { userId: user.id, status: 'ACTIVE', ...(contract.workspaceLevel ? { stableKey: { not: stableKey('qa-workspace-grant', user.id) } } : {}) },
      });
      for (const current of workspaceGrantsToRevoke) {
        const updated = await tx.hrWorkspaceAccessGrant.update({ where: { id: current.id }, data: {
          status: 'REVOKED', effectiveTo: now, revokedAt: now,
          revokedByUserId: options.actorUserId, reason: 'Approved persistent QA matrix',
        } });
        await tx.hrAuthorizationAuditEvent.create({ data: {
          entityType: 'WORKSPACE_GRANT', entityId: current.id, action: 'QA_MATRIX_REVOKED',
          actorUserId: options.actorUserId ?? user.id, reason: 'Approved persistent QA matrix', effectiveAt: now,
          beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)),
        } });
      }
      if (!contract.workspaceLevel) {
        await tx.workspacePermission.updateMany({ where: { userId: user.id, workspace: 'hr', isActive: true }, data: { isActive: false, expiresAt: now } });
        await tx.featurePermission.updateMany({ where: { userId: user.id, workspace: 'hr', isActive: true }, data: { isActive: false, expiresAt: now } });
      } else {
        await tx.hrWorkspaceAccessGrant.upsert({
          where: { stableKey: stableKey('qa-workspace-grant', user.id) },
          update: { level: contract.workspaceLevel, status: 'ACTIVE', effectiveTo: null, revokedAt: null, revokedByUserId: null },
          create: {
            stableKey: stableKey('qa-workspace-grant', user.id), userId: user.id,
            workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, level: contract.workspaceLevel,
            effectiveFrom: now, grantedByUserId: options.actorUserId, reason: 'Approved persistent QA matrix',
          },
        });
      }

      const featureGrantsToRevoke = await tx.hrFeatureAccessGrant.findMany({
        where: { userId: user.id, status: 'ACTIVE', ...(expectedFeatureGrantKeys.length ? { stableKey: { notIn: expectedFeatureGrantKeys } } : {}) },
      });
      for (const current of featureGrantsToRevoke) {
        const updated = await tx.hrFeatureAccessGrant.update({ where: { id: current.id }, data: {
          status: 'REVOKED', effectiveTo: now, revokedAt: now,
          revokedByUserId: options.actorUserId, reason: 'Approved persistent QA matrix',
        } });
        await tx.hrAuthorizationAuditEvent.create({ data: {
          entityType: 'FEATURE_GRANT', entityId: current.id, action: 'QA_MATRIX_REVOKED',
          actorUserId: options.actorUserId ?? user.id, reason: 'Approved persistent QA matrix', effectiveAt: now,
          beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)),
        } });
      }
      for (const [featureCode, level] of featureEntries) await tx.hrFeatureAccessGrant.upsert({
        where: { stableKey: stableKey('qa-feature-grant', user.id, featureCode) },
        update: { level, status: 'ACTIVE', effectiveTo: null, revokedAt: null, revokedByUserId: null },
        create: {
          stableKey: stableKey('qa-feature-grant', user.id, featureCode), userId: user.id, featureCode,
          level, effectiveFrom: now, grantedByUserId: options.actorUserId, reason: 'Approved persistent QA matrix',
        },
      });

      const authorityGrantsToRevoke = await tx.hrBusinessAuthorityGrant.findMany({
        where: { userId: user.id, status: 'ACTIVE', ...(expectedAuthorityGrantKey ? { stableKey: { not: expectedAuthorityGrantKey } } : {}) },
      });
      for (const current of authorityGrantsToRevoke) {
        const updated = await tx.hrBusinessAuthorityGrant.update({ where: { id: current.id }, data: {
          status: 'REVOKED', effectiveTo: now, revokedAt: now,
          revokedByUserId: options.actorUserId, reason: 'Approved persistent QA matrix',
        } });
        await tx.hrAuthorizationAuditEvent.create({ data: {
          entityType: 'BUSINESS_AUTHORITY', entityId: current.id, action: 'QA_MATRIX_REVOKED',
          actorUserId: options.actorUserId ?? user.id, reason: 'Approved persistent QA matrix', effectiveAt: now,
          beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)),
        } });
      }
      if (contract.authority) await tx.hrBusinessAuthorityGrant.upsert({
        where: { stableKey: stableKey('qa-authority-grant', user.id, contract.authority) },
        update: { status: 'ACTIVE', effectiveTo: null, revokedAt: null, revokedByUserId: null },
        create: {
          stableKey: stableKey('qa-authority-grant', user.id, contract.authority), userId: user.id,
          authorityCode: contract.authority, effectiveFrom: now, grantedByUserId: options.actorUserId,
          reason: 'Approved persistent QA matrix',
        },
      });

      const responsibilitiesToEnd = await tx.hrNamedResponsibility.findMany({
        where: {
          assignedUserId: user.id, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          ...(expectedResponsibilityKey
            ? { stableKey: { not: expectedResponsibilityKey } }
            : {}),
        },
      });
      for (const current of responsibilitiesToEnd) {
        const updated = await tx.hrNamedResponsibility.update({ where: { id: current.id }, data: {
          effectiveTo: now, reason: 'Approved persistent QA matrix',
        } });
        await tx.hrAuthorizationAuditEvent.create({ data: {
          entityType: 'NAMED_RESPONSIBILITY', entityId: current.id, action: 'QA_MATRIX_ENDED',
          actorUserId: options.actorUserId ?? user.id, reason: 'Approved persistent QA matrix', effectiveAt: now,
          beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)),
        } });
      }
      if (contract.responsibility) {
        const expectedDestinationKey = responsibilityRouting
          ? stableKey('qa-destination', contract.responsibility, responsibilityRouting.scopeType, responsibilityRouting.scopeId ?? 'GLOBAL')
          : null;
        const destinationsToDeactivate = await tx.hrResponsibilityDestination.findMany({
          where: {
            isActive: true,
            AND: [
              { stableKey: { startsWith: stableKey('qa-destination', contract.responsibility) } },
              ...(expectedDestinationKey ? [{ stableKey: { not: expectedDestinationKey } }] : []),
            ],
          },
        });
        for (const current of destinationsToDeactivate) {
          const updated = await tx.hrResponsibilityDestination.update({ where: { id: current.id }, data: { isActive: false } });
          await tx.hrAuthorizationAuditEvent.create({ data: {
            entityType: 'RESPONSIBILITY_DESTINATION', entityId: current.id, action: 'QA_MATRIX_DEACTIVATED',
            actorUserId: options.actorUserId ?? user.id, reason: 'Approved persistent QA matrix', effectiveAt: now,
            beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)),
          } });
        }
      }
      if (contract.responsibility && responsibilityRouting) {
        await tx.hrNamedResponsibility.upsert({
          where: { stableKey: expectedResponsibilityKey! },
          update: {
            assignedUserId: user.id, scopeType: responsibilityRouting.scopeType, scopeId: responsibilityRouting.scopeId,
            effectiveTo: null, reason: 'Approved persistent QA matrix',
          },
          create: {
            stableKey: expectedResponsibilityKey!,
            responsibilityTypeCode: contract.responsibility,
            scopeType: responsibilityRouting.scopeType, scopeId: responsibilityRouting.scopeId,
            assignedUserId: user.id, effectiveFrom: now, reason: 'Approved persistent QA matrix',
            createdByUserId: options.actorUserId ?? user.id,
          },
        });
        await tx.hrResponsibilityDestination.upsert({
          where: { stableKey: stableKey('qa-destination', contract.responsibility, responsibilityRouting.scopeType, responsibilityRouting.scopeId ?? 'GLOBAL') },
          update: { workspaceCode: responsibilityRouting.destinationWorkspace, isActive: true },
          create: {
            stableKey: stableKey('qa-destination', contract.responsibility, responsibilityRouting.scopeType, responsibilityRouting.scopeId ?? 'GLOBAL'),
            responsibilityTypeCode: contract.responsibility,
            scopeType: responsibilityRouting.scopeType, scopeId: responsibilityRouting.scopeId,
            workspaceCode: responsibilityRouting.destinationWorkspace, queueCode: `${contract.responsibility}_QUEUE`,
            createdByUserId: options.actorUserId ?? user.id,
          },
        });
      }
    }

    const [auditedWorkspaceGrants, auditedFeatureGrants, auditedAuthorityGrants, auditedQaResponsibilities, auditedQaDestinations] = await Promise.all([
      tx.hrWorkspaceAccessGrant.findMany({ where: { stableKey: { in: expectedGrantKeys } } }),
      tx.hrFeatureAccessGrant.findMany({ where: { stableKey: { in: expectedGrantKeys } } }),
      tx.hrBusinessAuthorityGrant.findMany({ where: { stableKey: { in: expectedGrantKeys } } }),
      tx.hrNamedResponsibility.findMany({ where: { stableKey: { startsWith: stableKey('qa-responsibility') } } }),
      tx.hrResponsibilityDestination.findMany({ where: { stableKey: { startsWith: stableKey('qa-destination') } } }),
    ]);
    const authorizationEntities = [
      ...auditedWorkspaceGrants.map((row) => ({ entityType: 'WORKSPACE_GRANT', row })),
      ...auditedFeatureGrants.map((row) => ({ entityType: 'FEATURE_GRANT', row })),
      ...auditedAuthorityGrants.map((row) => ({ entityType: 'BUSINESS_AUTHORITY', row })),
      ...auditedQaResponsibilities.map((row) => ({ entityType: 'NAMED_RESPONSIBILITY', row })),
      ...auditedQaDestinations.map((row) => ({ entityType: 'RESPONSIBILITY_DESTINATION', row })),
    ];
    for (const { entityType, row } of authorizationEntities) {
      const action = row.stableKey.includes(':qa-') ? 'QA_MATRIX_APPLIED' : 'BASELINE_GRANTED';
      const existingAudit = await tx.hrAuthorizationAuditEvent.findFirst({ where: { entityType, entityId: row.id, action } });
      if (!existingAudit) await tx.hrAuthorizationAuditEvent.create({ data: {
        entityType,
        entityId: row.id,
        action,
        actorUserId: options.actorUserId ?? ('userId' in row ? row.userId : 'createdByUserId' in row ? row.createdByUserId : 'SYSTEM'),
        reason: 'Approved HR authorization baseline',
        effectiveAt: 'effectiveFrom' in row ? row.effectiveFrom : row.createdAt,
        afterJson: JSON.parse(JSON.stringify(row)),
      } });
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
