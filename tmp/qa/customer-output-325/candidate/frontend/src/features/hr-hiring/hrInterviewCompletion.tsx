import React from 'react';
import { ErpInlineState } from '@/components/erp';

export type InterviewCompletionFailure = {
  message: string;
  target?: 'criterion' | 'custom-criterion' | 'summary' | 'snapshot';
  criterionId?: string;
};

const genericCompletionFailure = 'تکمیل مصاحبه انجام نشد. اطلاعات واردشده حفظ شده است؛ دوباره تلاش کنید.';

export const interviewCompletionFailure = (error: any): InterviewCompletionFailure => {
  const data = error?.response?.data;
  if (data?.code !== 'HR_INTERVIEW_EVIDENCE_INVALID' || typeof data?.error !== 'string') {
    return { message: genericCompletionFailure };
  }
  return {
    message: data.error,
    ...(['criterion', 'custom-criterion', 'summary', 'snapshot'].includes(data.target) ? { target: data.target } : {}),
    ...(typeof data.criterionId === 'string' ? { criterionId: data.criterionId } : {}),
  };
};

export const interviewCompletionFocus = (
  error: unknown,
  criterionIds: string[],
  customCriterionIds: string[],
) => {
  const failure = interviewCompletionFailure(error);
  if (failure.target === 'criterion' && failure.criterionId) {
    const index = criterionIds.indexOf(failure.criterionId);
    if (index >= 0) return { target: 'criterion' as const, index };
  }
  if (failure.target === 'custom-criterion' && failure.criterionId) {
    const index = customCriterionIds.indexOf(failure.criterionId);
    if (index >= 0) return { target: 'custom-criterion' as const, index };
  }
  if (failure.target === 'summary') return { target: 'summary' as const };
  return { target: 'completion' as const };
};

export const completeHrInterview = async <Payload,>({
  payload,
  flush,
  complete,
}: {
  payload: Payload;
  flush: (payload: Payload) => Promise<unknown>;
  complete: (payload: Payload) => Promise<void>;
}) => {
  await flush(payload);
  await complete(payload);
};

export function HrInterviewCompletionError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const failure = interviewCompletionFailure(error);
  return (
    <ErpInlineState
      kind="error"
      title={failure.message}
      action={{ label: 'تلاش مجدد', onClick: onRetry }}
    />
  );
}
