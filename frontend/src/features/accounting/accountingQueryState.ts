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
  'BLOCKED',
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

const CONTRACT_KEYS = ['view', 'search', 'status', 'sourceStatus', 'dateFrom', 'dateTo', 'page', 'pageSize', 'sort'] as const;
const INVOICE_KEYS = ['view', 'search', 'status', 'period', 'page', 'pageSize'] as const;

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
  page: number;
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

const isGregorianDateKey = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const isPeriodKey = (value: string) => /^(?:1[2-7]\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value);

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
  const page = normalizedPage(source);

  if (view) params.set('view', view);
  if (search) params.set('search', search);
  if (status !== 'ALL') params.set('status', status);
  if (period) params.set('period', period);
  if (page > 1) params.set('page', String(page));

  return { state: { view, search, status, period, page }, params };
};

const applyPatch = (source: URLSearchParams, patch: QueryPatch) => {
  const next = new URLSearchParams(source.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key);
    else next.set(key, String(value));
  }
  if (Object.keys(patch).some((key) => key !== 'page')) next.delete('page');
  return next;
};

export const patchContractsQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeContractsQuery(applyPatch(source, patch));

export const patchInvoiceCandidatesQuery = (source: URLSearchParams, patch: QueryPatch) =>
  canonicalizeInvoiceCandidatesQuery(applyPatch(source, patch));
