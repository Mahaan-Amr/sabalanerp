import assert from 'node:assert/strict';
import {
  HR_REDESIGN_CATALOG,
  HR_QA_ACCESS_MATRIX,
  buildHrRedesignBackfillReport,
  canReadLegacyAssessmentCompatibility,
  classifyHrReconciliationRecord,
  projectLegacyHrAccess,
  planLegacyAssessmentMigration,
  projectLegacyHrWorkItem,
  projectLegacyAssessmentCompatibility,
  projectLegacyPosition,
} from '../hrRedesignDataContracts';

assert.deepEqual(projectLegacyHrAccess({
  userId: 'user-1',
  workspacePermission: { id: 'workspace-1', permissionLevel: 'edit', isActive: true, grantedAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: null },
  featurePermissions: [{ id: 'feature-1', feature: 'personnel', permissionLevel: 'view', isActive: true, grantedAt: new Date('2026-01-02T00:00:00.000Z'), expiresAt: null }],
  authorities: [{ id: 'authority-1', authority: 'HR_MANAGER', isActive: false, createdAt: new Date('2026-01-03T00:00:00.000Z'), expiresAt: null, revokedAt: new Date('2026-02-01T00:00:00.000Z') }],
}), {
  workspaceGrant: { legacyGrantId: 'workspace-1', userId: 'user-1', workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
  featureGrants: [{ legacyGrantId: 'feature-1', userId: 'user-1', featureCode: 'PERSONNEL', level: 'VIEW', status: 'ACTIVE', effectiveFrom: new Date('2026-01-02T00:00:00.000Z'), effectiveTo: null }],
  authorityGrants: [{ legacyAuthorityId: 'authority-1', userId: 'user-1', authorityCode: 'HR_MANAGER', status: 'REVOKED', effectiveFrom: new Date('2026-01-03T00:00:00.000Z'), effectiveTo: new Date('2026-02-01T00:00:00.000Z') }],
});

assert.deepEqual(projectLegacyPosition({
  id: 'position-1', code: 'POS-1', title: 'Legacy position', capacity: 2, isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}), {
  id: 'position-1', code: 'POS-1', title: 'Legacy position', capacity: 2,
  lifecycle: { status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), source: 'LEGACY_CURRENT_STATE' },
  lifecycleHistory: [], capacityHistory: [], historicalEvidenceFabricated: false,
});

assert.deepEqual(projectLegacyHrWorkItem({
  id: 'work-1', title: 'Legacy work', description: null, status: 'IN_PROGRESS', sourceType: 'HIRING_ACTION',
  sourceKey: 'application-1', destinationHref: '/dashboard/hr/hiring/application-1', dueDate: new Date('2026-02-01T00:00:00.000Z'),
  assignedToUserId: 'user-1', completedByUserId: null, completedAt: null, waivedByUserId: null, waivedAt: null, waiverReason: null,
}), {
  id: 'work-1', title: 'Legacy work', description: null, status: 'OPEN', dueAt: new Date('2026-02-01T00:00:00.000Z'),
  assigneeUserId: 'user-1', source: { type: 'HIRING_ACTION', id: 'application-1' },
  destinationHref: '/dashboard/hr/hiring/application-1', envelope: { code: 'LEGACY_HR_WORK_ITEM', version: 1 },
  structuredResult: null, compatibilitySource: 'LEGACY_HR_WORK_ITEM', taskScopedOnly: true,
});

assert.deepEqual(HR_REDESIGN_CATALOG.workspaceFeatures.map((feature) => feature.code), [
  'DASHBOARD',
  'ORGANIZATIONAL_STRUCTURE',
  'PERSONNEL',
  'RECRUITMENT_CASES',
  'HR_WORK_MANAGEMENT',
  'AUTHORITY_RESPONSIBILITY_ADMINISTRATION',
  'DATA_MIGRATION_RECONCILIATION',
  'USER_ADMINISTRATION',
]);
assert.deepEqual(HR_REDESIGN_CATALOG.featureLevels, ['VIEW', 'EDIT', 'ADMIN']);
assert.deepEqual(HR_REDESIGN_CATALOG.assessmentKinds, ['DISC', 'EQ', 'BIG_FIVE']);
assert.equal(HR_REDESIGN_CATALOG.dutyEnvelopeVersion, 1);
assert.deepEqual(Object.keys(HR_QA_ACCESS_MATRIX), [
  'qa_no_hr_access',
  'qa_hr_viewer',
  'qa_finance_manager',
  'qa_finance_recorder',
  'qa_payroll_manager',
  'qa_payroll_processor',
  'qa_hiring_manager',
  'qa_hr_manager',
  'qa_hr_processor',
]);
assert.deepEqual(HR_QA_ACCESS_MATRIX.qa_no_hr_access, { workspaceLevel: null, features: {}, authority: null, responsibility: null, destinationWorkspace: null });
assert.equal(HR_QA_ACCESS_MATRIX.qa_finance_manager.workspaceLevel, null);
assert.equal(HR_QA_ACCESS_MATRIX.qa_hiring_manager.workspaceLevel, null);
assert.equal(HR_QA_ACCESS_MATRIX.qa_hr_viewer.authority, null);
assert.equal(HR_QA_ACCESS_MATRIX.qa_hr_manager.features.AUTHORITY_RESPONSIBILITY_ADMINISTRATION, 'ADMIN');

assert.deepEqual(planLegacyAssessmentMigration({
  applicationId: 'application-without-assessments',
  completedAssessmentKinds: [],
}), {
  applicationId: 'application-without-assessments',
  plan: null,
  neutralEvent: {
    code: 'NO_LEGACY_ASSESSMENT_HISTORY',
    details: { completedAssessmentKinds: [] },
  },
});

assert.equal(canReadLegacyAssessmentCompatibility({ hasAssignedAssessmentDuty: true, hasActiveHiringAuthority: true }), true);
assert.equal(canReadLegacyAssessmentCompatibility({ hasAssignedAssessmentDuty: false, hasActiveHiringAuthority: true }), false);
assert.equal(canReadLegacyAssessmentCompatibility({ hasAssignedAssessmentDuty: true, hasActiveHiringAuthority: false }), false);

const legacyEvidence = [{ id: 'assessment-1', assessmentType: 'DISC', payload: { score: 74 } }];
assert.deepEqual(projectLegacyAssessmentCompatibility({
  applicationId: 'application-with-evidence',
  completedAssessmentKinds: ['DISC'],
  evidence: legacyEvidence,
}), {
  migration: {
    applicationId: 'application-with-evidence',
    plan: null,
    neutralEvent: {
      code: 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED',
      details: { completedAssessmentKinds: ['DISC'] },
    },
  },
  evidence: legacyEvidence,
});

assert.deepEqual(planLegacyAssessmentMigration({
  applicationId: 'application-with-legacy-disc',
  completedAssessmentKinds: ['DISC'],
}), {
  applicationId: 'application-with-legacy-disc',
  plan: null,
  neutralEvent: {
    code: 'LEGACY_ASSESSMENT_EVIDENCE_PRESERVED',
    details: { completedAssessmentKinds: ['DISC'] },
  },
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'USER',
  sourceId: 'user-1',
  isOperationallyCurrent: true,
  legacyOnlyReviewed: false,
  personnelLinkExpected: true,
  userPersonnelLinkResolved: false,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: true,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: false,
}), {
  primaryState: 'NEEDS_REVIEW',
  attentionFlags: ['USER_PERSONNEL_LINKAGE'],
  cutoverBlocker: true,
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'PERSONNEL',
  sourceId: 'person-2',
  isOperationallyCurrent: false,
  legacyOnlyReviewed: true,
  personnelLinkExpected: false,
  userPersonnelLinkResolved: true,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: false,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: false,
}), {
  primaryState: 'LEGACY_ONLY_HISTORY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'PERSONNEL',
  sourceId: 'reviewed-history-that-became-current',
  isOperationallyCurrent: true,
  legacyOnlyReviewed: true,
  personnelLinkExpected: false,
  userPersonnelLinkResolved: true,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: true,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: false,
}), {
  primaryState: 'READY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'PERSONNEL',
  sourceId: 'legacy-with-classification-error',
  isOperationallyCurrent: false,
  legacyOnlyReviewed: true,
  personnelLinkExpected: false,
  userPersonnelLinkResolved: true,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: false,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: true,
}), {
  primaryState: 'CLASSIFICATION_ERROR',
  attentionFlags: ['CLASSIFICATION_ERROR'],
  cutoverBlocker: true,
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'PERSONNEL',
  sourceId: 'person-without-login',
  isOperationallyCurrent: true,
  legacyOnlyReviewed: false,
  personnelLinkExpected: false,
  userPersonnelLinkResolved: true,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: true,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: false,
}), {
  primaryState: 'READY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrReconciliationRecord({
  sourceType: 'USER',
  sourceId: 'access-only-user',
  isOperationallyCurrent: true,
  legacyOnlyReviewed: false,
  personnelLinkExpected: false,
  userPersonnelLinkResolved: false,
  identityAmbiguous: false,
  hasCurrentOrganizationalAssignment: true,
  employmentConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanUnresolved: false,
  classificationError: false,
}), {
  primaryState: 'READY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(buildHrRedesignBackfillReport({
  safeBackfills: [{ code: 'CATALOGS', count: 24 }],
  actionableConflicts: [{ code: 'MISSING_RESPONSIBILITY_OWNER', count: 2 }],
  neutralLegacyOutcomes: [{ code: 'NO_LEGACY_ASSESSMENT_HISTORY', count: 4 }],
  blockingFailures: [{ code: 'CLASSIFICATION_ERROR', count: 1 }],
}), {
  safeBackfills: [{ code: 'CATALOGS', count: 24 }],
  actionableConflicts: [{ code: 'MISSING_RESPONSIBILITY_OWNER', count: 2 }],
  neutralLegacyOutcomes: [{ code: 'NO_LEGACY_ASSESSMENT_HISTORY', count: 4 }],
  blockingFailures: [{ code: 'CLASSIFICATION_ERROR', count: 1 }],
  totals: { safeBackfills: 24, actionableConflicts: 2, neutralLegacyOutcomes: 4, blockingFailures: 1 },
  canCutOver: false,
});

console.log('HR redesign data contract tests passed.');
