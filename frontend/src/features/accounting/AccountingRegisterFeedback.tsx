'use client';

import { ErpInlineState } from '@/components/erp';
import type { AccountingRegisterState } from './accountingRegisterLoader';

export function AccountingRegisterFeedback({ state, retry }: {
  state: AccountingRegisterState<unknown>;
  retry: () => unknown;
}) {
  if (state.status === 'refreshing') return <ErpInlineState kind="stale" title="در حال به‌روزرسانی اطلاعات فهرست…" />;
  if (state.status === 'denied') return <ErpInlineState kind="permission" title="دسترسی به اطلاعات این فهرست در دسترس نیست."
    action={state.reason === 'permission' ? { label: 'تلاش دوباره', onClick: () => { void retry(); } } : undefined} />;
  if (state.status === 'error') return <ErpInlineState kind="error"
    title={state.data === null ? state.message : `${state.message} ثبت تغییر تا خواندن دوباره در دسترس نیست.`}
    action={{ label: 'تلاش دوباره', onClick: () => { void retry(); } }} />;
  return null;
}
