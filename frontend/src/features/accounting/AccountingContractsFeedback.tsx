'use client';

import React from 'react';
import { FaClipboardCheck } from 'react-icons/fa';
import { ErpEmptyState, ErpInlineState } from '@/components/erp';
import type { AccountingContractRow, AccountingPaginatedResult } from './accountingUi';

export function accountingContractsResponse(payload: any): AccountingPaginatedResult<AccountingContractRow> {
  if (payload?.success !== true || !Array.isArray(payload?.data?.items)) {
    throw { response: { data: payload } };
  }
  return payload.data;
}

export function AccountingContractsFeedback({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return error
    ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: onRetry }} />
    : <ErpEmptyState icon={FaClipboardCheck} title="قراردادی یافت نشد" description="فیلترها را تغییر دهید یا بعد از ثبت قرارداد جدید دوباره بررسی کنید." />;
}
