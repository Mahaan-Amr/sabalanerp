import { createHash } from 'node:crypto';
import type { PerformanceCriterionResponse, PerformanceCriterionSnapshot } from './personnelPerformanceCalculation';

export type PerformanceReadinessAssignment = {
  assignmentId: string;
  employmentRelationshipId: string;
  personnelId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  responsibleSupervisorAssignmentId: string | null;
  responsibleSupervisorPersonnelId: string | null;
  responsibilityPeriods: Array<{
    responsibilityId: string;
    supervisorAssignmentId: string;
    supervisorPersonnelId: string | null;
    allocationPercent: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    supervisorCoversPeriod: boolean;
  }>;
  responsibilityHistoryComplete: boolean;
  relationshipStatus: 'ACTIVE' | 'SUSPENDED' | 'ENDED';
  hasPrimaryAssignment: boolean;
  positionId: string | null;
  jobId: string | null;
  hasHistoricalContext: boolean;
  performanceAllocationPercent: string | null;
  allocationConsistent: boolean;
};

export type PerformanceReadinessBlocker = {
  assignmentId: string;
  code: 'RELATIONSHIP_SUSPENDED_HISTORY_MISSING' | 'PRIMARY_ASSIGNMENT_MISSING' | 'POSITION_MISSING'
    | 'JOB_MISSING' | 'HISTORICAL_CONTEXT_MISSING' | 'ALLOCATION_PERCENT_MISSING'
    | 'ALLOCATION_PERCENT_INCONSISTENT' | 'RESPONSIBILITY_HISTORY_MISSING'
    | 'RESPONSIBLE_SUPERVISOR_MISSING' | 'SELF_EVALUATION_CONFLICT';
};

const stableReadinessRows = (assignments: readonly PerformanceReadinessAssignment[]) => assignments
  .map((assignment) => ({
    assignmentId: assignment.assignmentId,
    employmentRelationshipId: assignment.employmentRelationshipId,
    personnelId: assignment.personnelId,
    effectiveFrom: assignment.effectiveFrom.toISOString(),
    effectiveTo: assignment.effectiveTo?.toISOString() ?? null,
    responsibleSupervisorAssignmentId: assignment.responsibleSupervisorAssignmentId,
    responsibleSupervisorPersonnelId: assignment.responsibleSupervisorPersonnelId,
    responsibilityPeriods: assignment.responsibilityPeriods.map((period) => ({
      ...period,
      effectiveFrom: period.effectiveFrom.toISOString(),
      effectiveTo: period.effectiveTo?.toISOString() ?? null,
    })),
    responsibilityHistoryComplete: assignment.responsibilityHistoryComplete,
    relationshipStatus: assignment.relationshipStatus,
    hasPrimaryAssignment: assignment.hasPrimaryAssignment,
    positionId: assignment.positionId,
    jobId: assignment.jobId,
    hasHistoricalContext: assignment.hasHistoricalContext,
    performanceAllocationPercent: assignment.performanceAllocationPercent,
    allocationConsistent: assignment.allocationConsistent,
  }))
  .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));

export const buildPerformanceReadinessSnapshot = (assignments: readonly PerformanceReadinessAssignment[]) => {
  const rows = stableReadinessRows(assignments);
  const blockers = rows.flatMap<PerformanceReadinessBlocker>((assignment) => {
    if (assignment.relationshipStatus === 'SUSPENDED') {
      return [{ assignmentId: assignment.assignmentId, code: 'RELATIONSHIP_SUSPENDED_HISTORY_MISSING' }];
    }
    if (!assignment.hasPrimaryAssignment) return [{ assignmentId: assignment.assignmentId, code: 'PRIMARY_ASSIGNMENT_MISSING' }];
    if (!assignment.positionId) return [{ assignmentId: assignment.assignmentId, code: 'POSITION_MISSING' }];
    if (!assignment.jobId) return [{ assignmentId: assignment.assignmentId, code: 'JOB_MISSING' }];
    if (!assignment.hasHistoricalContext) return [{ assignmentId: assignment.assignmentId, code: 'HISTORICAL_CONTEXT_MISSING' }];
    if (!assignment.performanceAllocationPercent
      || assignment.responsibilityPeriods.some((period) => !period.allocationPercent)) {
      return [{ assignmentId: assignment.assignmentId, code: 'ALLOCATION_PERCENT_MISSING' }];
    }
    if (!assignment.allocationConsistent) return [{ assignmentId: assignment.assignmentId, code: 'ALLOCATION_PERCENT_INCONSISTENT' }];
    if (!assignment.responsibilityHistoryComplete) return [{ assignmentId: assignment.assignmentId, code: 'RESPONSIBILITY_HISTORY_MISSING' }];
    if (!assignment.responsibilityPeriods.length
      || assignment.responsibilityPeriods.some((period) => !period.supervisorPersonnelId || !period.supervisorCoversPeriod)) {
      return [{ assignmentId: assignment.assignmentId, code: 'RESPONSIBLE_SUPERVISOR_MISSING' }];
    }
    if (assignment.responsibilityPeriods.some((period) => assignment.personnelId === period.supervisorPersonnelId)) {
      return [{ assignmentId: assignment.assignmentId, code: 'SELF_EVALUATION_CONFLICT' }];
    }
    return [];
  });
  return {
    count: rows.length,
    hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    blockers,
  };
};

export const derivePerformanceSectionPlans = (
  assignments: readonly PerformanceReadinessAssignment[],
  period: { measurementFrom: Date; measurementTo: Date },
) => assignments
  .flatMap((assignment) => assignment.responsibilityPeriods.map((responsibility) => ({
    employmentAssignmentId: assignment.assignmentId,
    responsibilityId: responsibility.responsibilityId,
    responsibleSupervisorAssignmentId: responsibility.supervisorAssignmentId,
    responsibleSupervisorPersonnelId: responsibility.supervisorPersonnelId!,
    allocationPercent: responsibility.allocationPercent,
    effectiveFrom: [assignment.effectiveFrom, responsibility.effectiveFrom, period.measurementFrom]
      .reduce((latest, value) => value > latest ? value : latest),
    effectiveTo: [assignment.effectiveTo, responsibility.effectiveTo, period.measurementTo]
      .filter((value): value is Date => Boolean(value))
      .reduce((earliest, value) => value < earliest ? value : earliest, period.measurementTo),
  })))
  .filter((plan) => plan.responsibleSupervisorPersonnelId && plan.effectiveFrom < plan.effectiveTo)
  .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime()
    || left.employmentAssignmentId.localeCompare(right.employmentAssignmentId));

const WORKFLOW_NOTIFICATIONS = {
  TASK_CREATED: { title: 'ارزیابی عملکرد جدید', message: 'یک بخش ارزیابی عملکرد برای تکمیل آماده است.' },
  SUBMISSION_DUE: { title: 'یادآوری ارزیابی عملکرد', message: 'مهلت ارسال یکی از ارزیابی‌های عملکرد شما نزدیک است.' },
  SUBMISSION_OVERDUE: { title: 'ارزیابی عملکرد معوق', message: 'مهلت ارسال یکی از ارزیابی‌های عملکرد گذشته است.' },
  REVIEW_READY: { title: 'بررسی ارزیابی عملکرد', message: 'یک ارسال ارزیابی عملکرد آماده بررسی است.' },
  SUBMISSION_ACCEPTED: { title: 'نتیجه بررسی ارزیابی', message: 'ارسال ارزیابی شما بررسی و پذیرفته شد.' },
  SUBMISSION_REJECTED: { title: 'نیاز به اصلاح ارزیابی', message: 'ارسال ارزیابی شما برای اصلاح بازگردانده شد.' },
  STRUCTURAL_BLOCKER: { title: 'مانع ساختاری ارزیابی', message: 'یک پرونده ارزیابی عملکرد به اصلاح سابقه سازمانی نیاز دارد.' },
  RESULT_CHANGED: { title: 'به‌روزرسانی سطح عملکرد', message: 'خلاصه سطح عملکرد شما به‌روزرسانی شد.' },
} as const;

export type PerformanceWorkflowNotificationKind = keyof typeof WORKFLOW_NOTIFICATIONS;

export const performanceWorkflowNotification = (kind: PerformanceWorkflowNotificationKind) => WORKFLOW_NOTIFICATIONS[kind];

export const requirePerformanceReason = (reason: string, actionLabel: string) => {
  const normalized = reason.trim();
  if (normalized.length < 8) {
    throw Object.assign(new Error(`برای ${actionLabel} توضیح فارسی روشن و حداقل هشت‌حرفی وارد کنید.`), {
      code: 'PERFORMANCE_REASON_REQUIRED',
      status: 422,
    });
  }
  return normalized;
};

export const validatePerformanceSubmissionResponses = (input: {
  criteria: readonly PerformanceCriterionSnapshot[];
  responses: readonly PerformanceCriterionResponse[];
  effectiveFrom: Date;
  effectiveTo: Date;
}) => {
  const errors: string[] = [];
  const responseMap = new Map<string, PerformanceCriterionResponse>();
  for (const response of input.responses) {
    if (responseMap.has(response.criterionVersionId)) errors.push('پاسخ تکراری برای یک معیار ثبت شده است.');
    responseMap.set(response.criterionVersionId, response);
  }
  const criterionIds = new Set(input.criteria.map(({ criterionVersionId }) => criterionVersionId));
  if (input.responses.some(({ criterionVersionId }) => !criterionIds.has(criterionVersionId))) {
    errors.push('پاسخ متعلق به نسخه معیار این بخش نیست.');
  }
  for (const criterion of input.criteria) {
    const response = responseMap.get(criterion.criterionVersionId);
    if (!response) {
      errors.push(`پاسخ معیار «${criterion.titleFa}» کامل نیست.`);
      continue;
    }
    const requestedNotApplicable = Boolean(response.notApplicable?.requestedReason.trim());
    if (response.notApplicable && !requestedNotApplicable) errors.push(`دلیل نامرتبط‌بودن معیار «${criterion.titleFa}» الزامی است.`);
    if (!requestedNotApplicable && criterion.kind === 'JUDGMENT' && ![1, 2, 3, 4, 5].includes(response.grade ?? 0)) {
      errors.push(`درجه معتبر معیار «${criterion.titleFa}» الزامی است.`);
    }
    if (!requestedNotApplicable && criterion.kind === 'BINARY_GATE' && typeof response.binaryGatePassed !== 'boolean') {
      errors.push(`نتیجه کنترل معیار «${criterion.titleFa}» الزامی است.`);
    }
    const reliableEvidence = response.evidence.filter((evidence) => {
      const occurredAt = new Date(evidence.occurredAt).getTime();
      const earliest = input.effectiveFrom.getTime() - ((criterion.evidence.lookbackDays ?? 0) * 86_400_000);
      return evidence.quality === 'RELIABLE'
        && criterion.evidence.allowedKinds.includes(evidence.kind)
        && evidence.referenceId.trim().length > 0
        && evidence.sourceVersion.trim().length > 0
        && /^[a-f0-9]{64}$/i.test(evidence.contentHash)
        && Number.isFinite(occurredAt)
        && occurredAt >= earliest
        && occurredAt <= input.effectiveTo.getTime();
    });
    if (!requestedNotApplicable && criterion.evidence.required && reliableEvidence.length < criterion.evidence.minimumReliableCount) {
      errors.push(`شاهد قابل اتکای معیار «${criterion.titleFa}» کامل نیست.`);
    }
  }
  return errors;
};
