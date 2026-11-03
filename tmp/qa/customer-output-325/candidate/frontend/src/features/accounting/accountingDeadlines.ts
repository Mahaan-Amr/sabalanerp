export type DeadlineType = 'receivable' | 'check';
export type DeadlineBucket = 'overdue' | 'next7' | 'days8to30' | 'later30';

export type DeadlineNavigationRow = {
  id: string;
  type: DeadlineType;
  bucket: DeadlineBucket;
  contractId?: string | null;
};

export const deadlineRegisterHref = (type: DeadlineType, bucket: DeadlineBucket) => {
  const pathname = type === 'receivable'
    ? '/dashboard/accounting/receivables'
    : '/dashboard/accounting/payments';
  const view = type === 'receivable' ? 'open' : 'unsettled-checks';
  return `${pathname}?view=${view}&due=${bucket}`;
};

export const deadlineRowHref = (row: DeadlineNavigationRow) => {
  if (row.contractId) {
    return `/dashboard/accounting/contracts/${encodeURIComponent(row.contractId)}?focus=${row.type}&recordId=${encodeURIComponent(row.id)}#collections`;
  }
  return `${deadlineRegisterHref(row.type, row.bucket)}&recordId=${encodeURIComponent(row.id)}`;
};

export type AccountingWorkspaceLoadState<T = any> = {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
};

export type AccountingWorkspaceLoadEvent<T = any> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'failure'; message: string };

const initialAccountingWorkspaceLoadState: AccountingWorkspaceLoadState = {
  data: null,
  loading: false,
  stale: false,
  error: null,
};

export const reduceAccountingWorkspaceLoad = <T = any>(
  current: AccountingWorkspaceLoadState<T> | undefined,
  event: AccountingWorkspaceLoadEvent<T>,
): AccountingWorkspaceLoadState<T> => {
  const state = current || initialAccountingWorkspaceLoadState as AccountingWorkspaceLoadState<T>;
  if (event.type === 'start') return { ...state, loading: true, error: null };
  if (event.type === 'success') return { data: event.data, loading: false, stale: false, error: null };
  return {
    ...state,
    loading: false,
    stale: Boolean(state.data),
    error: event.message,
  };
};
