import React from 'react';
import { ErpInlineState } from '@/components/erp';

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
  error: _error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <ErpInlineState
      kind="error"
      title="ذخیره اطلاعات مصاحبه انجام نشد. اطلاعات واردشده حفظ شده است؛ دوباره تلاش کنید."
      action={{ label: 'تلاش مجدد', onClick: onRetry }}
    />
  );
}
