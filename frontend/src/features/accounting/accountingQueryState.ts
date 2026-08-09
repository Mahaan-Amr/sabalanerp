const CONTRACT_STATUSES = new Set([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SIGNED',
  'PRINTED',
  'CANCELLED',
  'EXPIRED',
]);

const CONTRACT_SOURCE_STATUSES = new Set([
  'VISIBLE_ONLY',
  'ELIGIBLE',
  'HAS_FINANCIAL_RECORDS',
  'NEEDS_CORRECTION',
]);

const INVOICE_STATUSES = new Set([
  'DRAFT',
  'READY',
  'APPROVED_FOR_ISSUE',
  'ISSUED',
  'POSTED',
  'VOIDED',
  'NEEDS_CORRECTION',
]);

const TAX_STATUSES = new Set([
  'NOT_READY',
  'READY',
  'SUBMITTED_MANUALLY',
  'ACCEPTED',
  'REJECTED',
  'NEEDS_CORRECTION',
]);

const CORRECTION_STATUSES = new Set([
  'OPEN',
  'ACKNOWLEDGED',
  'APPROVED_FOR_SALES_EDIT',
  'SALES_EDITED',
  'RESOLVED',
  'CANCELLED',
]);

const AUDIT_ACTIONS = new Set([
  'CREATE_INVOICE',
  'APPROVE_FINANCIAL_INVOICE',
  'CREATE_RECEIVABLE',
  'REGISTER_RECEIPT',
  'UPDATE_CHECK_STATUS',
  'TRACK_TAX_SUBMISSION',
  'REQUEST_CORRECTION',
  'RESOLVE_CORRECTION',
  'FLAG_CONTRACT',
]);

const RECEIVABLE_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID', 'SETTLED', 'OVERDUE', 'VOIDED']);
const CHECK_STATUSES = new Set([
  'PENDING_HANDOVER', 'RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED', 'REPLACED',
]);
const DUE_BUCKETS = new Set(['overdue', 'next7', 'days8to30', 'later30']);
const DEADLINE_TYPES = new Set(['all', 'receivable', 'check']);

const ACCOUNTING_DASHBOARD_KEYS = ['due', 'deadlineType'] as const;
const CONTRACT_KEYS = ['view', 'search', 'status', 'sourceStatus', 'dateFrom', 'dateTo', 'page', 'pageSize', 'sort'] as const;
const INVOICE_KEYS = ['view', 'search', 'status', 'period', 'date', 'cutoff', 'page', 'pageSize'] as const;
const STATUS_DRILLDOWN_KEYS = ['view', 'search', 'status', 'page', 'pageSize'] as const;
const AUDIT_KEYS = ['search', 'action', 'page', 'pageSize'] as const;
const PERFORMANCE_KEYS = ['view', 'search', 'dateFrom', 'dateTo', 'page', 'pageSize'] as const;
const COLLECTION_KEYS = ['view', 'search', 'status', 'due', 'period', 'date', 'cutoff', 'recordId', 'page', 'pageSize'] as const;

export type ContractsQueryState = {
  view: 'reviewable' | null;
  search: string;
  status: string;
  sourceStatus: string;
  dateFrom: string;
  dateTo: string;
  page: number;
};

export type InvoiceCandidatesQueryState = {
  view: 'actionable' | 'invoiced' | null;
  search: string;
  status: string;
  period: string;
  date: string;
  cutoff: string;
  page: number;
};

export type StatusDrilldownQueryState<TView extends string> = {
  view: TView | null;
  search: string;
  status: string;
  page: number;
};

export type AuditQueryState = {
  search: string;
  action: string;
  page: number;
};

export type PerformanceQueryState = {
  view: 'last30days' | null;
  search: string;
  dateFrom: string;
  dateTo: string;
  page: number;
};

export type ReceivablesQueryState = {
  view: 'open' | 'outstanding' | null;
  search: string;
  status: string;
  due: string;
  period: string;
  date: string;
  cutoff: string;
  recordId: string;
  page: number;
};

export type PaymentsQueryState = {
  view: 'due-soon' | 'unsettled-checks' | 'received' | null;
  search: string;
  status: string;
  due: string;
  period: string;
  date: string;
  cutoff: string;
  recordId: string;
  page: number;
};

export type AccountingDashboardQueryState = {
  due: string;
  deadlineType: 'all' | 'receivable' | 'check';
};

type CanonicalQuery<T> = { state: T; params: URLSearchParams };
type QueryPatch = Record<string, string | number | null | undefined>;

const withoutRecognized = (source: URLSearchParams, keys: readonly string[]) => {
  const params = new URLSearchParams(source.toString());
  keys.forEach((key) => params.delete(key));
  return params;
};

const normalizedSearch = (params: URLSearchParams) => (params.get('search') || '').trim();

const normalizedPage = (params: URLSearchParams) => {
  const raw = params.get('page');
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 2 ? page : 1;
};

export const canonicalizeAccountingDashboardQuery = (
  source: URLSearchParams,
): CanonicalQuery<AccountingDashboardQueryState> => {
  const params = withoutRecognized(source, ACCOUNTING_DASHBOARD_KEYS);
  const rawDue = source.get('due') || '';
  const due = DUE_BUCKETS.has(rawDue) ? rawDue : '';
  const rawDeadlineType = source.get('deadlineType') || 'all';
  const deadlineType = DEADLINE_TYPES.has(rawDeadlineType)
    ? rawDeadlineType as AccountingDashboardQueryState['deadlineType']
    : 'all';
  if (due) params.set('due', due);
  if (deadlineType !== 'all') params.set('deadlineType', deadlineType);
  return { state: { due, deadlineType }, params };
};

const isGregorianDateKey = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const isPeriodKey = (value: string) => /^1[2-7]\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
const isJalaliDayInPeriod = (value: string, period: string) => {
  const match = value.match(/^(1[2-7]\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match || value.slice(0, 7) !== period) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month <= 6 ? day <= 31 : day <= 30;
};

const normalizedCutoff = (source: URLSearchParams, period: string) => {
  const value = source.get('cutoff') || '';
  const date = new Date(value);
  return period && !Number.isNaN(date.getTime()) && date.toISOString() === value ? value : '';
};

export const canonicalizeContractsQuery = (
  source: URLSearchParams,
): CanonicalQuery<ContractsQueryState> => {
  const params = withoutRecognized(source, CONTRACT_KEYS);
  const rawStatus = source.get('status') || '';
  const status = CONTRACT_STATUSES.has(rawStatus) ? rawStatus : 'ALL';
  const view = status === 'ALL' && source.get('view') === 'reviewable' ? 'reviewable' : null;
  const rawSourceStatus = source.get('sourceStatus') || '';
  const sourceStatus = CONTRACT_SOURCE_STATUSES.has(rawSourceStatus) ? rawSourceStatus : 'ALL';
  const search = normalizedSearch(source);
  const rawDateFrom = source.get('dateFrom') || '';
  const rawDateTo = source.get('dateTo') || '';
  const dateFrom = isGregorianDateKey(rawDateFrom) ? rawDateFrom : '';
  const dateTo = isGregorianDateKey(rawDateTo) ? rawDateTo : '';
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (status !== 'ALL') params.set('status', status);
  if (sourceStatus !== 'ALL') params.set('sourceStatus', sourceStatus);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (page > 1) params.set('page', String(page));

  return {
    state: { view, search, status, sourceStatus, dateFrom, dateTo, page },
    params,
  };
};

export const canonicalizeInvoiceCandidatesQuery = (
  source: URLSearchParams,
): CanonicalQuery<InvoiceCandidatesQueryState> => {
  const params = withoutRecognized(source, INVOICE_KEYS);
  const rawStatus = source.get('status') || '';
  const status = INVOICE_STATUSES.has(rawStatus) ? rawStatus : 'ALL';
  const rawView = source.get('view');
  const view = status === 'ALL' && (rawView === 'actionable' || rawView === 'invoiced') ? rawView : null;
  const search = normalizedSearch(source);
  const rawPeriod = source.get('period') || '';
  const period = view === 'invoiced' && isPeriodKey(rawPeriod) ? rawPeriod : '';
  const rawDate = source.get('date') || '';
  const date = period && isJalaliDayInPeriod(rawDate, period) ? rawDate : '';
  const cutoff = normalizedCutoff(source, period);
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (status !== 'ALL') params.set('status', status);
  if (period) params.set('period', period);
  if (date) params.set('date', date);
  if (cutoff) params.set('cutoff', cutoff);
  if (page > 1) params.set('page', String(page));

  return { state: { view, search, status, period, date, cutoff, page }, params };
};

const canonicalizeStatusDrilldownQuery = <TView extends string>(
  source: URLSearchParams,
  statuses: Set<string>,
  semanticView: TView,
): CanonicalQuery<StatusDrilldownQueryState<TView>> => {
  const params = withoutRecognized(source, STATUS_DRILLDOWN_KEYS);
  const rawStatus = source.get('status') || '';
  const status = statuses.has(rawStatus) ? rawStatus : 'ALL';
  const view = status === 'ALL' && source.get('view') === semanticView ? semanticView : null;
  const search = normalizedSearch(source);
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (status !== 'ALL') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  return { state: { view, search, status, page }, params };
};

export const canonicalizeTaxQuery = (source: URLSearchParams) => (
  canonicalizeStatusDrilldownQuery(source, TAX_STATUSES, 'needs-attention')
);

export const canonicalizeCorrectionRequestsQuery = (source: URLSearchParams) => (
  canonicalizeStatusDrilldownQuery(source, CORRECTION_STATUSES, 'active')
);

export const canonicalizeAuditQuery = (source: URLSearchParams): CanonicalQuery<AuditQueryState> => {
  const params = withoutRecognized(source, AUDIT_KEYS);
  const search = normalizedSearch(source);
  const rawAction = source.get('action') || '';
  const action = AUDIT_ACTIONS.has(rawAction) ? rawAction : 'ALL';
  const page = normalizedPage(source);
  if (search) params.set('search', search);
  if (action !== 'ALL') params.set('action', action);
  if (page > 1) params.set('page', String(page));
  return { state: { search, action, page }, params };
};

export const canonicalizePerformanceQuery = (
  source: URLSearchParams,
): CanonicalQuery<PerformanceQueryState> => {
  const params = withoutRecognized(source, PERFORMANCE_KEYS);
  const search = normalizedSearch(source);
  const rawDateFrom = source.get('dateFrom') || '';
  const rawDateTo = source.get('dateTo') || '';
  const dateFrom = isGregorianDateKey(rawDateFrom) ? rawDateFrom : '';
  const dateTo = isGregorianDateKey(rawDateTo) ? rawDateTo : '';
  const view = !dateFrom && !dateTo && source.get('view') === 'last30days' ? 'last30days' : null;
  const page = normalizedPage(source);
  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (page > 1) params.set('page', String(page));
  return { state: { view, search, dateFrom, dateTo, page }, params };
};

export const canonicalizeReceivablesQuery = (
  source: URLSearchParams,
): CanonicalQuery<ReceivablesQueryState> => {
  const params = withoutRecognized(source, COLLECTION_KEYS);
  const rawStatus = source.get('status') || '';
  const status = RECEIVABLE_STATUSES.has(rawStatus) ? rawStatus : 'ALL';
  const rawView = source.get('view');
  const view = status === 'ALL' && (rawView === 'open' || rawView === 'outstanding') ? rawView : null;
  const search = normalizedSearch(source);
  const rawDue = source.get('due') || '';
  const due = DUE_BUCKETS.has(rawDue) ? rawDue : '';
  const rawPeriod = source.get('period') || '';
  const period = view === 'outstanding' && isPeriodKey(rawPeriod) ? rawPeriod : '';
  const rawDate = source.get('date') || '';
  const date = period && isJalaliDayInPeriod(rawDate, period) ? rawDate : '';
  const cutoff = normalizedCutoff(source, period);
  const recordId = (source.get('recordId') || '').trim();
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (due) params.set('due', due);
  if (period) params.set('period', period);
  if (date) params.set('date', date);
  if (cutoff) params.set('cutoff', cutoff);
  if (recordId) params.set('recordId', recordId);
  if (status !== 'ALL') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  return { state: { view, search, status, due, period, date, cutoff, recordId, page }, params };
};

export const canonicalizePaymentsQuery = (
  source: URLSearchParams,
): CanonicalQuery<PaymentsQueryState> => {
  const params = withoutRecognized(source, COLLECTION_KEYS);
  const rawStatus = source.get('status') || '';
  const status = CHECK_STATUSES.has(rawStatus) ? rawStatus : 'ALL';
  const rawView = source.get('view');
  const view = status === 'ALL' && (
    rawView === 'due-soon' || rawView === 'unsettled-checks' || rawView === 'received'
  ) ? rawView : null;
  const search = normalizedSearch(source);
  const rawDue = source.get('due') || '';
  const due = DUE_BUCKETS.has(rawDue) ? rawDue : '';
  const rawPeriod = source.get('period') || '';
  const period = view === 'received' && isPeriodKey(rawPeriod) ? rawPeriod : '';
  const rawDate = source.get('date') || '';
  const date = period && isJalaliDayInPeriod(rawDate, period) ? rawDate : '';
  const cutoff = normalizedCutoff(source, period);
  const recordId = (source.get('recordId') || '').trim();
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (due) params.set('due', due);
  if (period) params.set('period', period);
  if (date) params.set('date', date);
  if (cutoff) params.set('cutoff', cutoff);
  if (recordId) params.set('recordId', recordId);
  if (status !== 'ALL') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  return { state: { view, search, status, due, period, date, cutoff, recordId, page }, params };
};

const applyPatch = (source: URLSearchParams, patch: QueryPatch) => {
  const next = new URLSearchParams(source.toString());
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) next.delete('view');
  if (Object.prototype.hasOwnProperty.call(patch, 'dateFrom') || Object.prototype.hasOwnProperty.call(patch, 'dateTo')) {
    next.delete('view');
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key);
    else next.set(key, String(value));
  }
  if (Object.keys(patch).some((key) => key !== 'page')) next.delete('page');
  return next;
};

export const patchContractsQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeContractsQuery(applyPatch(source, patch));

export const patchAccountingDashboardQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeAccountingDashboardQuery(applyPatch(source, patch));

export const patchInvoiceCandidatesQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeInvoiceCandidatesQuery(applyPatch(source, patch));

export const patchTaxQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeTaxQuery(applyPatch(source, patch));

export const patchCorrectionRequestsQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeCorrectionRequestsQuery(applyPatch(source, patch));

export const patchAuditQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeAuditQuery(applyPatch(source, patch));

export const patchPerformanceQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizePerformanceQuery(applyPatch(source, patch));

export const patchReceivablesQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeReceivablesQuery(applyPatch(source, patch));

export const patchPaymentsQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizePaymentsQuery(applyPatch(source, patch));
