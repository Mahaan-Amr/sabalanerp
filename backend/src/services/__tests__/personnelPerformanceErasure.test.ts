import assert from 'node:assert/strict';
import {
  classifyPerformanceErasureRecords,
  decidePerformanceErasureProgress,
  performanceErasureOperationIdentity,
  requiredPerformanceCopyLocations,
} from '../personnelPerformanceErasure';

const classified = classifyPerformanceErasureRecords({
  evaluationId: 'evaluation-1', subjectId: 'subject-1', sectionIds: ['section-1'], draftIds: ['draft-1'],
  submissionIds: ['submission-1'], reviewIds: ['review-1'], resultIds: ['result-1'], traceIds: ['trace-1'],
  snapshotIds: ['snapshot-1'], correctionIds: ['correction-1'], privacyCaseIds: ['privacy-1'], exportIds: ['export-1'],
  consequenceHandoffIds: ['handoff-1'], policyVersionIds: ['policy-1'], criterionVersionIds: ['criterion-1'], templateVersionIds: ['template-1'],
  auditEventIds: ['audit-1'],
});
assert.deepEqual(new Set(classified.map(({ retentionClass }) => retentionClass)), new Set([
  'EVALUATION_ANCHOR', 'SUBJECT_ANCHOR', 'SECTION_ANCHOR', 'DRAFT_CONTENT', 'SUBMISSION_CONTENT', 'REVIEW_CONTENT',
  'ACCEPTED_RESULT_CONTENT', 'CALCULATION_TRACE_CONTENT', 'SNAPSHOT_CONTENT', 'CORRECTION_CONTENT',
  'PRIVACY_CASE_EVIDENCE', 'EXPORT_ARTIFACT', 'CONSEQUENCE_SOURCE_ANCHOR', 'PUBLISHED_POLICY_TEXT',
  'CRITERION_VERSION', 'TEMPLATE_VERSION',
  'AUDIT_EVIDENCE',
]));

assert.deepEqual(requiredPerformanceCopyLocations, [
  'LIVE_DATABASE', 'SEARCH_INDEX', 'APPLICATION_CACHE', 'TEMPORARY_STORAGE', 'DATABASE_REPLICA',
  'ARTIFACT_STORAGE', 'INDEPENDENT_BACKUP',
]);

const identity = performanceErasureOperationIdentity({ aggregateType: 'EVALUATION', aggregateId: 'evaluation-1',
  policyVersionId: 'policy-1', retentionStateId: 'retention-1', scopeHash: 'scope-hash' });
assert.equal(identity, performanceErasureOperationIdentity({ aggregateType: 'EVALUATION', aggregateId: 'evaluation-1',
  policyVersionId: 'policy-1', retentionStateId: 'retention-1', scopeHash: 'scope-hash' }), 'a retry keeps the same operation identity');
assert.notEqual(identity, performanceErasureOperationIdentity({ aggregateType: 'EVALUATION', aggregateId: 'evaluation-1',
  policyVersionId: 'policy-2', retentionStateId: 'retention-1', scopeHash: 'scope-hash' }), 'a changed policy starts a distinct operation');

const base = { impactApproved: true, recordCount: 2, bulkThreshold: 100, distinctBulkApproverIds: [] as string[],
  copies: requiredPerformanceCopyLocations.map((location) => ({ location,
    status: location === 'LIVE_DATABASE' ? 'PRESENT' as const : 'VERIFIED_ABSENT' as const })) };
assert.equal(decidePerformanceErasureProgress({ ...base, impactApproved: false }), 'PENDING_IMPACT_APPROVAL');
assert.equal(decidePerformanceErasureProgress({ ...base, recordCount: 101, distinctBulkApproverIds: ['one'] }), 'PENDING_BULK_APPROVAL');
assert.equal(decidePerformanceErasureProgress({ ...base, recordCount: 101, distinctBulkApproverIds: ['one', 'two'] }), 'READY');
assert.equal(decidePerformanceErasureProgress({ ...base, copies: base.copies.map((copy) => copy.location === 'DATABASE_REPLICA'
  ? { ...copy, status: 'UNKNOWN' as const } : copy) }), 'COPY_REVIEW_REQUIRED');
assert.equal(decidePerformanceErasureProgress({ ...base, copies: base.copies.map((copy) => copy.location === 'INDEPENDENT_BACKUP'
  ? { ...copy, status: 'RECOVERABLE' as const } : copy), liveErased: true }), 'LIVE_ERASED_BACKUP_PENDING');
assert.equal(decidePerformanceErasureProgress({ ...base, copies: base.copies.map((copy) => ({ ...copy, status: 'ERASED' as const })), liveErased: true }), 'COMPLETED');
assert.equal(decidePerformanceErasureProgress({ ...base, partialFailure: true }), 'PARTIAL_RESTRICTED');

console.log('Performance erasure policy tests passed.');
