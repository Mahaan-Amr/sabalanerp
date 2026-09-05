import assert from 'node:assert/strict';
import {
  buildPerformanceReadinessSnapshot,
  derivePerformanceSectionPlans,
  performanceWorkflowNotification,
  validatePerformanceSubmissionResponses,
} from '../personnelPerformanceWorkflow';

const measurementFrom = new Date('2026-01-01T00:00:00.000Z');
const measurementTo = new Date('2026-04-01T00:00:00.000Z');

const assignments = [
  {
    assignmentId: 'assignment-secondary',
    employmentRelationshipId: 'relationship-1',
    personnelId: 'personnel-1',
    effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
    effectiveTo: null,
    responsibleSupervisorAssignmentId: 'supervisor-assignment-2',
    responsibleSupervisorPersonnelId: 'supervisor-2',
    responsibilityPeriods: [{
      responsibilityId: 'responsibility-2', supervisorAssignmentId: 'supervisor-assignment-2', supervisorPersonnelId: 'supervisor-2',
      allocationPercent: '40.00',
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'), effectiveTo: null, supervisorCoversPeriod: true,
    }],
    responsibilityHistoryComplete: true,
    relationshipStatus: 'ACTIVE' as const,
    hasPrimaryAssignment: true,
    positionId: 'position-2',
    jobId: 'job-1',
    hasHistoricalContext: true,
    performanceAllocationPercent: '40.00',
    allocationConsistent: true,
  },
  {
    assignmentId: 'assignment-primary',
    employmentRelationshipId: 'relationship-1',
    personnelId: 'personnel-1',
    effectiveFrom: new Date('2025-12-01T00:00:00.000Z'),
    effectiveTo: new Date('2026-02-15T00:00:00.000Z'),
    responsibleSupervisorAssignmentId: 'supervisor-assignment-1',
    responsibleSupervisorPersonnelId: 'supervisor-1',
    responsibilityPeriods: [{
      responsibilityId: 'responsibility-1', supervisorAssignmentId: 'supervisor-assignment-1', supervisorPersonnelId: 'supervisor-1',
      allocationPercent: '60.00',
      effectiveFrom: new Date('2025-12-01T00:00:00.000Z'), effectiveTo: new Date('2026-02-15T00:00:00.000Z'), supervisorCoversPeriod: true,
    }],
    responsibilityHistoryComplete: true,
    relationshipStatus: 'ENDED' as const,
    hasPrimaryAssignment: true,
    positionId: 'position-1',
    jobId: 'job-1',
    hasHistoricalContext: true,
    performanceAllocationPercent: '60.00',
    allocationConsistent: true,
  },
];

const snapshot = buildPerformanceReadinessSnapshot(assignments);
const reversedSnapshot = buildPerformanceReadinessSnapshot([...assignments].reverse());
assert.equal(snapshot.count, 2);
assert.equal(snapshot.hash, reversedSnapshot.hash, 'readiness hashes must not depend on database row order');
assert.deepEqual(snapshot.blockers, []);

const missingSupervisor = buildPerformanceReadinessSnapshot([{
  ...assignments[0],
  responsibleSupervisorAssignmentId: null,
  responsibleSupervisorPersonnelId: null,
  responsibilityPeriods: [],
}]);
assert.deepEqual(missingSupervisor.blockers.map((blocker) => blocker.code), ['RESPONSIBLE_SUPERVISOR_MISSING']);

const selfSupervisor = buildPerformanceReadinessSnapshot([{
  ...assignments[0],
  responsibleSupervisorPersonnelId: 'personnel-1',
  responsibilityPeriods: assignments[0].responsibilityPeriods.map((period) => ({ ...period, supervisorPersonnelId: 'personnel-1' })),
}]);
assert.deepEqual(selfSupervisor.blockers.map((blocker) => blocker.code), ['SELF_EVALUATION_CONFLICT']);

const structuralBlockerCases = [
  [{ relationshipStatus: 'SUSPENDED' as const }, 'RELATIONSHIP_SUSPENDED_HISTORY_MISSING'],
  [{ hasPrimaryAssignment: false }, 'PRIMARY_ASSIGNMENT_MISSING'],
  [{ positionId: null }, 'POSITION_MISSING'],
  [{ jobId: null }, 'JOB_MISSING'],
  [{ hasHistoricalContext: false }, 'HISTORICAL_CONTEXT_MISSING'],
  [{ performanceAllocationPercent: null }, 'ALLOCATION_PERCENT_MISSING'],
  [{ allocationConsistent: false }, 'ALLOCATION_PERCENT_INCONSISTENT'],
  [{ responsibilityHistoryComplete: false }, 'RESPONSIBILITY_HISTORY_MISSING'],
] as const;
for (const [changes, expectedCode] of structuralBlockerCases) {
  const blocked = buildPerformanceReadinessSnapshot([{ ...assignments[0], ...changes }]);
  assert.deepEqual(blocked.blockers.map((blocker) => blocker.code), [expectedCode]);
}

assert.deepEqual(derivePerformanceSectionPlans(assignments, { measurementFrom, measurementTo }), [
  {
    employmentAssignmentId: 'assignment-primary',
    responsibilityId: 'responsibility-1',
    responsibleSupervisorAssignmentId: 'supervisor-assignment-1',
    responsibleSupervisorPersonnelId: 'supervisor-1',
    allocationPercent: '60.00',
    effectiveFrom: measurementFrom,
    effectiveTo: new Date('2026-02-15T00:00:00.000Z'),
  },
  {
    employmentAssignmentId: 'assignment-secondary',
    responsibilityId: 'responsibility-2',
    responsibleSupervisorAssignmentId: 'supervisor-assignment-2',
    responsibleSupervisorPersonnelId: 'supervisor-2',
    allocationPercent: '40.00',
    effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
    effectiveTo: measurementTo,
  },
]);

const decisionNotification = performanceWorkflowNotification('SUBMISSION_ACCEPTED');
assert.equal(decisionNotification.title, 'نتیجه بررسی ارزیابی');
assert.equal(decisionNotification.message, 'ارسال ارزیابی شما بررسی و پذیرفته شد.');
assert.doesNotMatch(`${decisionNotification.title} ${decisionNotification.message}`, /score|امتیاز|روایت|criterion|معیار/i);

const submissionCriteria = [{
  criterionVersionId: 'criterion-1', titleFa: 'کیفیت تحویل', weightPercent: '100', kind: 'JUDGMENT' as const,
  anchorsFa: ['۱', '۲', '۳', '۴', '۵'], applicability: null,
  evidence: { minimumReliableCount: 1, allowedKinds: ['STRUCTURED_OBSERVATION' as const], required: true },
}];
const completeResponse = [{
  criterionVersionId: 'criterion-1', grade: 4 as const,
  evidence: [{
    kind: 'STRUCTURED_OBSERVATION' as const, quality: 'RELIABLE' as const,
    occurredAt: '2026-02-01T10:00:00.000Z', referenceId: 'OBS-42', sourceVersion: '2', contentHash: 'a'.repeat(64),
  }],
}];
assert.deepEqual(validatePerformanceSubmissionResponses({
  criteria: submissionCriteria, responses: completeResponse, effectiveFrom: measurementFrom, effectiveTo: measurementTo,
}), []);
assert.match(validatePerformanceSubmissionResponses({
  criteria: submissionCriteria,
  responses: [{ ...completeResponse[0], evidence: [{ ...completeResponse[0].evidence[0], contentHash: 'invalid' }] }],
  effectiveFrom: measurementFrom, effectiveTo: measurementTo,
})[0], /شاهد قابل اتکا/);

console.log('Personnel performance workflow tests passed.');
