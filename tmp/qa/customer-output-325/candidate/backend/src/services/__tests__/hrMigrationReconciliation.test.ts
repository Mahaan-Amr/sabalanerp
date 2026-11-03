import assert from 'node:assert/strict';
import {
  assertAutomatedHrMigrationOperationAllowed,
  buildHrReconciliationFilter,
  classifyHrMigrationRecord,
  findPossibleDuplicateNationalIdentities,
  summarizeHrReconciliationRows,
  type HrMigrationClassificationInput,
} from '../hrMigrationReconciliation';
import { projectHrReconciliationRow } from '../hrMigrationReconciliationStore';

const basePersonnel: HrMigrationClassificationInput = {
  sourceType: 'PERSONNEL',
  sourceId: 'personnel-1',
  operationallyCurrent: true,
  personnelLinkResolved: true,
  organizationalMappingComplete: true,
  primaryAssignmentPresent: true,
  employmentStateConsistent: true,
  startDateReviewOpen: false,
  assessmentPlanReconciliationOpen: false,
  durableReviewOutcome: null,
};

assert.deepEqual(classifyHrMigrationRecord(basePersonnel), {
  primaryState: 'PERSONNEL_CURRENT',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceId: 'personnel-ended',
  operationallyCurrent: false,
}), {
  primaryState: 'PERSONNEL_INACTIVE_ENDED',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  organizationalMappingComplete: false,
  primaryAssignmentPresent: true,
}), {
  primaryState: 'PERSONNEL_CURRENT',
  attentionFlags: ['INCOMPLETE_ORGANIZATIONAL_MAPPING'],
  cutoverBlocker: true,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  organizationalMappingComplete: true,
  primaryAssignmentPresent: false,
}), {
  primaryState: 'PERSONNEL_CURRENT',
  attentionFlags: ['MISSING_PRIMARY_ASSIGNMENT'],
  cutoverBlocker: true,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'USER',
  sourceId: 'linked-user',
}), {
  primaryState: 'USER_PERSONNEL_LINKED',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'USER',
  sourceId: 'access-only-user',
  personnelLinkResolved: false,
  durableReviewOutcome: 'ACCESS_ONLY_USER',
}), {
  primaryState: 'USER_ACCESS_ONLY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'USER',
  sourceId: 'unresolved-user',
  personnelLinkResolved: false,
}), {
  primaryState: 'USER_LINKAGE_UNRESOLVED',
  attentionFlags: ['UNRESOLVED_PERSONNEL_LINKAGE'],
  cutoverBlocker: true,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'EMPLOYMENT_RELATIONSHIP',
  sourceId: 'ended-relationship',
  operationallyCurrent: false,
  startDateReviewOpen: true,
  durableReviewOutcome: null,
}), {
  primaryState: 'EMPLOYMENT_ENDED',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'EMPLOYMENT_RELATIONSHIP',
  sourceId: 'current-unrecoverable-start',
  operationallyCurrent: true,
  startDateReviewOpen: true,
  durableReviewOutcome: 'START_DATE_UNRECOVERABLE',
}), {
  primaryState: 'EMPLOYMENT_CURRENT',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'APPLICATION',
  sourceId: 'closed-application',
  operationallyCurrent: false,
}), {
  primaryState: 'NEUTRAL_HISTORY',
  attentionFlags: [],
  cutoverBlocker: false,
});

assert.deepEqual(classifyHrMigrationRecord({
  ...basePersonnel,
  sourceType: 'UNREGISTERED_SOURCE',
  sourceId: 'unexpected',
}), {
  primaryState: 'CLASSIFICATION_ERROR',
  attentionFlags: ['CLASSIFICATION_ERROR'],
  cutoverBlocker: true,
});

assert.deepEqual(findPossibleDuplicateNationalIdentities([
  { id: 'p1', nationalCode: '0013547836' },
  { id: 'p2', nationalCode: '0013547836' },
  { id: 'p3', nationalCode: null },
  { id: 'p4', nationalCode: null },
  { id: 'p5', nationalCode: '0012345678' },
  { id: 'p6', nationalCode: '0012345678' },
]), [{ nationalCode: '0013547836', personnelIds: ['p1', 'p2'] }]);

const rows = [
  { primaryState: 'PERSONNEL_CURRENT', cutoverBlocker: false, attentionFlags: [] },
  { primaryState: 'PERSONNEL_CURRENT', cutoverBlocker: true, attentionFlags: ['MISSING_PRIMARY_ASSIGNMENT'] },
  { primaryState: 'USER_ACCESS_ONLY', cutoverBlocker: false, attentionFlags: [] },
] as const;
assert.deepEqual(summarizeHrReconciliationRows(rows), {
  total: 3,
  blockers: 1,
  clearForCutover: 2,
  byPrimaryState: {
    PERSONNEL_CURRENT: 2,
    PERSONNEL_INACTIVE_ENDED: 0,
    USER_PERSONNEL_LINKED: 0,
    USER_ACCESS_ONLY: 1,
    USER_LINKAGE_UNRESOLVED: 0,
    EMPLOYMENT_CURRENT: 0,
    EMPLOYMENT_ENDED: 0,
    LEGACY_ONLY_HISTORY: 0,
    NEUTRAL_HISTORY: 0,
    CLASSIFICATION_ERROR: 0,
  },
  byAttentionFlag: {
    UNRESOLVED_PERSONNEL_LINKAGE: 0,
    POSSIBLE_DUPLICATE_IDENTITY: 0,
    INCOMPLETE_ORGANIZATIONAL_MAPPING: 0,
    MISSING_PRIMARY_ASSIGNMENT: 1,
    EMPLOYMENT_STATE_INCONSISTENCY: 0,
    OPEN_START_DATE_REVIEW: 0,
    ASSESSMENT_PLAN_RECONCILIATION: 0,
    CLASSIFICATION_ERROR: 0,
  },
  canCutOver: false,
});
assert.equal(rows.filter(buildHrReconciliationFilter({ primaryState: 'PERSONNEL_CURRENT' })).length, 2);
assert.equal(rows.filter(buildHrReconciliationFilter({ attentionFlag: 'MISSING_PRIMARY_ASSIGNMENT' })).length, 1);
assert.equal(rows.filter(buildHrReconciliationFilter({ cutoverBlocker: false })).length, 2);

assert.throws(() => assertAutomatedHrMigrationOperationAllowed({
  reconciliationId: 'reconciliation-p2',
  activeAttentionFlags: ['POSSIBLE_DUPLICATE_IDENTITY'],
}), /POSSIBLE_DUPLICATE_IDENTITY/);
assert.doesNotThrow(() => assertAutomatedHrMigrationOperationAllowed({
  reconciliationId: 'reconciliation-unrelated',
  activeAttentionFlags: ['MISSING_PRIMARY_ASSIGNMENT'],
}));

assert.deepEqual(projectHrReconciliationRow({
  id: 'legacy-row',
  sourceType: 'PERSONNEL',
  sourceId: 'person-legacy',
  primaryState: 'UNEXPECTED_API_STATE',
  stateVersion: 1,
  detailsJson: { source: 'legacy' },
  cutoverBlocker: false,
  classifiedAt: new Date('2026-08-09T00:00:00.000Z'),
  attentionFlags: [{ flagCode: 'UNEXPECTED_API_FLAG', isActive: true }],
  reviews: [],
}), {
  id: 'legacy-row',
  sourceType: 'PERSONNEL',
  sourceId: 'person-legacy',
  primaryState: 'CLASSIFICATION_ERROR',
  stateVersion: 1,
  details: { source: 'legacy' },
  attentionFlags: ['CLASSIFICATION_ERROR'],
  cutoverBlocker: true,
  classifiedAt: new Date('2026-08-09T00:00:00.000Z'),
  latestReview: null,
  technicalEvidence: {
    unexpectedPrimaryState: 'UNEXPECTED_API_STATE',
    unexpectedFlags: ['UNEXPECTED_API_FLAG'],
  },
});

console.log('HR migration reconciliation tests passed.');
