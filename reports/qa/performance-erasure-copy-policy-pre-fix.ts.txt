import { createHash } from 'node:crypto';

export const requiredPerformanceCopyLocations = [
  'LIVE_DATABASE',
  'SEARCH_INDEX',
  'APPLICATION_CACHE',
  'TEMPORARY_STORAGE',
  'DATABASE_REPLICA',
  'ARTIFACT_STORAGE',
  'INDEPENDENT_BACKUP',
] as const;

export type PerformanceCopyLocation = typeof requiredPerformanceCopyLocations[number];
export type PerformanceCopyStatus = 'PRESENT' | 'RECOVERABLE' | 'VERIFIED_ABSENT' | 'ERASED' | 'UNKNOWN';

type Graph = {
  evaluationId: string;
  subjectId: string;
  sectionIds: string[];
  draftIds: string[];
  submissionIds: string[];
  reviewIds: string[];
  resultIds: string[];
  traceIds: string[];
  snapshotIds: string[];
  correctionIds: string[];
  privacyCaseIds: string[];
  exportIds: string[];
  consequenceHandoffIds: string[];
  policyVersionIds: string[];
  criterionVersionIds: string[];
  templateVersionIds: string[];
  auditEventIds: string[];
};

export type PerformanceErasureRetentionClass =
  | 'EVALUATION_ANCHOR' | 'SUBJECT_ANCHOR' | 'SECTION_ANCHOR' | 'DRAFT_CONTENT' | 'SUBMISSION_CONTENT'
  | 'REVIEW_CONTENT' | 'ACCEPTED_RESULT_CONTENT' | 'CALCULATION_TRACE_CONTENT' | 'SNAPSHOT_CONTENT'
  | 'CORRECTION_CONTENT' | 'PRIVACY_CASE_EVIDENCE' | 'EXPORT_ARTIFACT' | 'CONSEQUENCE_SOURCE_ANCHOR'
  | 'PUBLISHED_POLICY_TEXT' | 'CRITERION_VERSION' | 'TEMPLATE_VERSION' | 'AUDIT_EVIDENCE';

export type PerformanceErasureRecord = { retentionClass: PerformanceErasureRetentionClass; recordId: string; erasableContent: boolean };

const records = (retentionClass: PerformanceErasureRetentionClass, ids: string[], erasableContent: boolean): PerformanceErasureRecord[] =>
  ids.map((recordId) => ({ retentionClass, recordId, erasableContent }));

export const classifyPerformanceErasureRecords = (graph: Graph): PerformanceErasureRecord[] => [
  ...records('EVALUATION_ANCHOR', [graph.evaluationId], false),
  ...records('SUBJECT_ANCHOR', [graph.subjectId], false),
  ...records('SECTION_ANCHOR', graph.sectionIds, false),
  ...records('DRAFT_CONTENT', graph.draftIds, true),
  ...records('SUBMISSION_CONTENT', graph.submissionIds, true),
  ...records('REVIEW_CONTENT', graph.reviewIds, true),
  ...records('ACCEPTED_RESULT_CONTENT', graph.resultIds, true),
  ...records('CALCULATION_TRACE_CONTENT', graph.traceIds, true),
  ...records('SNAPSHOT_CONTENT', graph.snapshotIds, true),
  ...records('CORRECTION_CONTENT', graph.correctionIds, true),
  ...records('PRIVACY_CASE_EVIDENCE', graph.privacyCaseIds, false),
  ...records('EXPORT_ARTIFACT', graph.exportIds, true),
  ...records('CONSEQUENCE_SOURCE_ANCHOR', graph.consequenceHandoffIds, false),
  ...records('PUBLISHED_POLICY_TEXT', graph.policyVersionIds, false),
  ...records('CRITERION_VERSION', graph.criterionVersionIds, false),
  ...records('TEMPLATE_VERSION', graph.templateVersionIds, false),
  ...records('AUDIT_EVIDENCE', graph.auditEventIds, true),
];

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const performanceErasureOperationIdentity = (input: {
  aggregateType: string; aggregateId: string; policyVersionId: string; retentionStateId: string; scopeHash: string;
}) => stableHash({ schemaVersion: 1, ...input });

export type PerformanceErasureProgress = 'PENDING_IMPACT_APPROVAL' | 'PENDING_BULK_APPROVAL' | 'COPY_REVIEW_REQUIRED'
  | 'READY' | 'PARTIAL_RESTRICTED' | 'LIVE_ERASED_BACKUP_PENDING' | 'COMPLETED';

export const decidePerformanceErasureProgress = (input: {
  impactApproved: boolean;
  recordCount: number;
  bulkThreshold: number;
  distinctBulkApproverIds: string[];
  copies: Array<{ location: PerformanceCopyLocation; status: PerformanceCopyStatus }>;
  liveErased?: boolean;
  partialFailure?: boolean;
}): PerformanceErasureProgress => {
  if (input.partialFailure) return 'PARTIAL_RESTRICTED';
  if (!input.impactApproved) return 'PENDING_IMPACT_APPROVAL';
  if (input.recordCount > input.bulkThreshold && new Set(input.distinctBulkApproverIds).size < 2) return 'PENDING_BULK_APPROVAL';
  if (!input.liveErased && input.copies.some(({ location, status }) => status === 'UNKNOWN'
    || (location !== 'LIVE_DATABASE' && location !== 'INDEPENDENT_BACKUP' && (status === 'PRESENT' || status === 'RECOVERABLE')))) {
    return 'COPY_REVIEW_REQUIRED';
  }
  if (!input.liveErased) return 'READY';
  if (input.copies.some(({ status }) => status === 'PRESENT' || status === 'RECOVERABLE')) return 'LIVE_ERASED_BACKUP_PENDING';
  return 'COMPLETED';
};
