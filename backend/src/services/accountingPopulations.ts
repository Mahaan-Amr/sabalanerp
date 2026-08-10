const TEHRAN_TIME_ZONE = 'Asia/Tehran';

export const ACCOUNTING_RECORD_STATUSES = [
  'DRAFT',
  'READY',
  'APPROVED_FOR_ISSUE',
  'ISSUED',
  'POSTED',
  'VOIDED',
  'NEEDS_CORRECTION',
] as const;

export const ACTIONABLE_INVOICE_STATUSES = [
  'DRAFT',
  'READY',
  'APPROVED_FOR_ISSUE',
] as const;

type DateRange = { gte: Date; lt: Date };
type DeadlineRange = { gte?: Date; lt?: Date };

export const OPEN_RECEIVABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
export const UNSETTLED_CHECK_STATUSES = ['PENDING_HANDOVER', 'RECEIVED', 'DEPOSITED', 'BOUNCED'] as const;
export const CHECK_STATUSES = [
  'PENDING_HANDOVER', 'RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED', 'REPLACED',
] as const;
export const RECEIVABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'SETTLED', 'OVERDUE', 'VOIDED'] as const;
export const DUE_BUCKETS = ['overdue', 'next7', 'days8to30', 'later30'] as const;
export type DueBucket = typeof DUE_BUCKETS[number];

export type InvoiceCandidatePopulation = {
  statuses?: readonly string[];
  invoiced: boolean;
  periodRange?: DateRange;
};

type InvoiceCandidatePopulationQuery = {
  view?: unknown;
  status?: unknown;
  period?: unknown;
  date?: unknown;
  cutoff?: unknown;
};

type InvoiceCandidateRecord = {
  kind: string;
  status: string;
  financiallyApprovedAt?: Date | null;
  systemInvoiceDate?: Date | null;
  voidedAt?: Date | null;
};

type ReviewableContractRow = {
  accounting: {
    openCorrections: number;
    openFlags: number;
    receivableStatus: string;
    taxStatus: string;
    eligibleForFinancialRecords: boolean;
    invoiceStatus: string;
  };
};

export const reviewableContractAttentionScore = (item: ReviewableContractRow) => (
  (item.accounting.openCorrections * 4)
  + (item.accounting.openFlags * 3)
  + (item.accounting.receivableStatus === 'OVERDUE' ? 3 : 0)
  + (item.accounting.taxStatus === 'NOT_READY' ? 2 : 0)
  + (item.accounting.eligibleForFinancialRecords && item.accounting.invoiceStatus === 'NONE' ? 1 : 0)
);

export const orderReviewableContracts = <T extends ReviewableContractRow>(items: T[]) => (
  [...items].sort((left, right) => (
    reviewableContractAttentionScore(right) - reviewableContractAttentionScore(left)
  ))
);

const dateTimeParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

const zonedMidnightToUtc = (year: number, month: number, day: number) => {
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let instant = new Date(targetAsUtc);

  // Two passes handle an offset transition near the guessed instant without
  // baking today's Tehran offset into historical or future dates.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = dateTimeParts(instant, TEHRAN_TIME_ZONE);
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    instant = new Date(instant.getTime() + targetAsUtc - representedAsUtc);
  }

  return instant;
};

const parseGregorianDateKey = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
  ) return null;
  return { year, month, day };
};

export const resolveTehranDayRange = (value: unknown): DateRange | null => {
  const parsed = parseGregorianDateKey(value);
  if (!parsed) return null;
  const nextDay = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  return {
    gte: zonedMidnightToUtc(parsed.year, parsed.month, parsed.day),
    lt: zonedMidnightToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate()),
  };
};

const tehranCivilMidnight = (now: Date, dayOffset = 0) => {
  const local = dateTimeParts(now, TEHRAN_TIME_ZONE);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  return zonedMidnightToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};

export const resolveTehranDeadlineRange = (
  bucket: unknown,
  now = new Date(),
): DeadlineRange | null => {
  if (!(DUE_BUCKETS as readonly unknown[]).includes(bucket)) return null;
  if (bucket === 'overdue') return { lt: tehranCivilMidnight(now) };
  if (bucket === 'next7') return { gte: tehranCivilMidnight(now), lt: tehranCivilMidnight(now, 8) };
  if (bucket === 'days8to30') return { gte: tehranCivilMidnight(now, 8), lt: tehranCivilMidnight(now, 31) };
  return { gte: tehranCivilMidnight(now, 31) };
};

export const ACCOUNTING_DEADLINE_TYPES = ['all', 'receivable', 'check'] as const;
export type AccountingDeadlineType = typeof ACCOUNTING_DEADLINE_TYPES[number];

type AccountingDeadlineReceivable = {
  id: string;
  status: string;
  dueDate: Date | null;
  remainingAmount: unknown;
  currency?: string | null;
  contractId?: string | null;
};

type AccountingDeadlineCheck = {
  id: string;
  method: string;
  checkStatus?: string | null;
  checkDueDate?: Date | null;
  amount: unknown;
  currency?: string | null;
  contractId?: string | null;
};

export type AccountingDeadlineItem = {
  id: string;
  type: Exclude<AccountingDeadlineType, 'all'>;
  bucket: DueBucket;
  status: string;
  dueDate: Date;
  amount: string;
  currency: string | null;
  contractId: string | null;
};

type AccountingDeadlineQuery = {
  due?: unknown;
  deadlineType?: unknown;
};

const deadlineBucketFor = (dueDate: Date, now: Date): DueBucket => {
  for (const bucket of DUE_BUCKETS) {
    const range = resolveTehranDeadlineRange(bucket, now)!;
    if (isWithinDeadline(dueDate, range)) return bucket;
  }
  return 'later30';
};

export const resolveAccountingDeadlines = (
  sources: {
    receivables: AccountingDeadlineReceivable[];
    checks: AccountingDeadlineCheck[];
  },
  query: AccountingDeadlineQuery = {},
  now = new Date(),
) => {
  const due = (DUE_BUCKETS as readonly unknown[]).includes(query.due)
    ? query.due as DueBucket
    : null;
  const deadlineType = (ACCOUNTING_DEADLINE_TYPES as readonly unknown[]).includes(query.deadlineType)
    ? query.deadlineType as AccountingDeadlineType
    : 'all';
  const receivables: AccountingDeadlineItem[] = sources.receivables.flatMap((record) => (
    record.dueDate && (OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(record.status)
      ? [{
          id: record.id,
          type: 'receivable' as const,
          bucket: deadlineBucketFor(record.dueDate, now),
          status: record.status,
          dueDate: record.dueDate,
          amount: String(record.remainingAmount),
          currency: record.currency || null,
          contractId: record.contractId || null,
        }]
      : []
  ));
  const checks: AccountingDeadlineItem[] = sources.checks.flatMap((record) => (
    record.method === 'CHECK'
    && record.checkDueDate
    && (UNSETTLED_CHECK_STATUSES as readonly string[]).includes(String(record.checkStatus || ''))
      ? [{
          id: record.id,
          type: 'check' as const,
          bucket: deadlineBucketFor(record.checkDueDate, now),
          status: String(record.checkStatus),
          dueDate: record.checkDueDate,
          amount: String(record.amount),
          currency: record.currency || null,
          contractId: record.contractId || null,
        }]
      : []
  ));
  const allItems = [...receivables, ...checks];
  const itemsForDue = due ? allItems.filter((item) => item.bucket === due) : allItems;
  const typeCounts = {
    all: itemsForDue.length,
    receivable: itemsForDue.filter((item) => item.type === 'receivable').length,
    check: itemsForDue.filter((item) => item.type === 'check').length,
  };
  const bucketCounts = Object.fromEntries(DUE_BUCKETS.map((bucket) => {
    const items = allItems.filter((item) => item.bucket === bucket);
    return [bucket, {
      all: items.length,
      receivable: items.filter((item) => item.type === 'receivable').length,
      check: items.filter((item) => item.type === 'check').length,
    }];
  })) as Record<DueBucket, { all: number; receivable: number; check: number }>;
  const items = itemsForDue
    .filter((item) => deadlineType === 'all' || item.type === deadlineType)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime() || left.id.localeCompare(right.id));

  return {
    selection: { due: due || '', deadlineType },
    typeCounts,
    bucketCounts,
    items,
    total: items.length,
  };
};

const jalaliToGregorianParts = (jy: number, jm: number, jd: number) => {
  let jalaliYear = jy;
  let gregorianYear = 621;
  if (jalaliYear > 979) {
    gregorianYear = 1600;
    jalaliYear -= 979;
  }
  let days = (365 * jalaliYear)
    + Math.floor(jalaliYear / 33) * 8
    + Math.floor(((jalaliYear % 33) + 3) / 4)
    + 78
    + jd
    + (jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  gregorianYear += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gregorianYear += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gregorianYear += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gregorianYear += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let dayOfYear = days + 1;
  const leap = (gregorianYear % 4 === 0 && gregorianYear % 100 !== 0) || gregorianYear % 400 === 0;
  const monthLengths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gregorianMonth = 1;
  while (dayOfYear > monthLengths[gregorianMonth]) {
    dayOfYear -= monthLengths[gregorianMonth];
    gregorianMonth += 1;
  }
  return { year: gregorianYear, month: gregorianMonth, day: dayOfYear };
};

export const resolveTehranPeriodRange = (value: unknown): DateRange | null => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  if (year < 1200 || year > 1700) return null;
  const start = jalaliToGregorianParts(year, month, 1);
  const nextJalaliYear = month === 12 ? year + 1 : year;
  const nextJalaliMonth = month === 12 ? 1 : month + 1;
  const end = jalaliToGregorianParts(nextJalaliYear, nextJalaliMonth, 1);
  return {
    gte: zonedMidnightToUtc(start.year, start.month, start.day),
    lt: zonedMidnightToUtc(end.year, end.month, end.day),
  };
};

export const resolveTehranJalaliDayRange = (value: unknown): DateRange | null => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthRange = resolveTehranPeriodRange(`${match[1]}-${match[2]}`);
  if (!monthRange || day < 1) return null;
  const start = jalaliToGregorianParts(year, month, day);
  const startsAt = zonedMidnightToUtc(start.year, start.month, start.day);
  if (startsAt < monthRange.gte || startsAt >= monthRange.lt) return null;
  const nextGregorianDay = new Date(Date.UTC(start.year, start.month - 1, start.day + 1));
  return {
    gte: startsAt,
    lt: zonedMidnightToUtc(
      nextGregorianDay.getUTCFullYear(),
      nextGregorianDay.getUTCMonth() + 1,
      nextGregorianDay.getUTCDate(),
    ),
  };
};

const capRangeAt = (range: DateRange | null, value: unknown): DateRange | null => {
  if (!range || typeof value !== 'string') return range;
  const cutoff = new Date(value);
  if (Number.isNaN(cutoff.getTime()) || cutoff <= range.gte) return range;
  return { ...range, lt: cutoff < range.lt ? cutoff : range.lt };
};

export const resolveInvoiceCandidatePopulation = (
  query: InvoiceCandidatePopulationQuery = {},
): InvoiceCandidatePopulation => {
  const requestedStatus = String(query.status || '');
  if ((ACCOUNTING_RECORD_STATUSES as readonly string[]).includes(requestedStatus)) {
    return { statuses: [requestedStatus], invoiced: false };
  }

  if (query.view === 'actionable') {
    return { statuses: ACTIONABLE_INVOICE_STATUSES, invoiced: false };
  }

  if (query.view === 'invoiced') {
    return {
      invoiced: true,
      periodRange: capRangeAt(
        resolveTehranJalaliDayRange(query.date) || resolveTehranPeriodRange(query.period),
        query.cutoff,
      ) || undefined,
    };
  }

  return { invoiced: false };
};

const isWithin = (value: Date | null | undefined, range: DateRange) => Boolean(
  value && value >= range.gte && value < range.lt,
);

export const matchesInvoiceCandidatePopulation = (
  record: InvoiceCandidateRecord,
  population: InvoiceCandidatePopulation,
) => {
  if (record.kind !== 'INVOICE_CANDIDATE') return false;
  if (population.statuses && !population.statuses.includes(record.status)) return false;
  if (!population.invoiced) return true;
  if (!record.financiallyApprovedAt) return false;
  if (!population.periodRange) return true;
  return isWithin(record.systemInvoiceDate, population.periodRange)
    || (record.status === 'VOIDED' && isWithin(record.voidedAt, population.periodRange));
};

export const invoiceCandidatePopulationWhere = (population: InvoiceCandidatePopulation) => {
  const where: Record<string, unknown> = { kind: 'INVOICE_CANDIDATE' };
  if (population.statuses) where.status = { in: [...population.statuses] };
  if (!population.invoiced) return where;

  where.financiallyApprovedAt = { not: null };
  if (population.periodRange) {
    const range = { gte: population.periodRange.gte, lt: population.periodRange.lt };
    where.OR = [
      { systemInvoiceDate: range },
      { status: 'VOIDED', voidedAt: range },
    ];
  }
  return where;
};

export const TAX_ATTENTION_STATUSES = [
  'NOT_READY',
  'NEEDS_CORRECTION',
  'REJECTED',
] as const;

export const ACTIVE_CORRECTION_STATUSES = [
  'OPEN',
  'APPROVED_FOR_SALES_EDIT',
  'SALES_EDITED',
  'ACKNOWLEDGED',
] as const;

const TAX_RECORD_STATUSES = [
  'NOT_READY',
  'READY',
  'SUBMITTED_MANUALLY',
  'ACCEPTED',
  'REJECTED',
  'NEEDS_CORRECTION',
] as const;

const CORRECTION_REQUEST_STATUSES = [
  ...ACTIVE_CORRECTION_STATUSES,
  'RESOLVED',
  'CANCELLED',
] as const;

type StatusPopulation = { statuses?: readonly string[] };
type StatusPopulationQuery = { view?: unknown; status?: unknown };

const resolveStatusPopulation = (
  query: StatusPopulationQuery,
  statuses: readonly string[],
  semanticView: string,
  semanticStatuses: readonly string[],
): StatusPopulation => {
  const requestedStatus = String(query.status || '');
  if (statuses.includes(requestedStatus)) return { statuses: [requestedStatus] };
  if (query.view === semanticView) return { statuses: semanticStatuses };
  return {};
};

export const resolveTaxRecordPopulation = (query: StatusPopulationQuery = {}) => (
  resolveStatusPopulation(query, TAX_RECORD_STATUSES, 'needs-attention', TAX_ATTENTION_STATUSES)
);

export const matchesTaxRecordPopulation = (
  record: { submissionStatus: string },
  population: StatusPopulation,
) => !population.statuses || population.statuses.includes(record.submissionStatus);

export const taxRecordPopulationWhere = (population: StatusPopulation) => (
  population.statuses ? { submissionStatus: { in: [...population.statuses] } } : {}
);

export const resolveCorrectionRequestPopulation = (query: StatusPopulationQuery = {}) => (
  resolveStatusPopulation(query, CORRECTION_REQUEST_STATUSES, 'active', ACTIVE_CORRECTION_STATUSES)
);

export const matchesCorrectionRequestPopulation = (
  record: { status: string },
  population: StatusPopulation,
) => !population.statuses || population.statuses.includes(record.status);

export const correctionRequestPopulationWhere = (population: StatusPopulation) => (
  population.statuses ? { status: { in: [...population.statuses] } } : {}
);

export const authorizedAuditPopulationWhere = () => ({});

export const authorizedAuditPopulationOrderBy = () => ([
  { createdAt: 'desc' as const },
  { id: 'desc' as const },
]);

type ActivityRange = { gte?: Date; lt?: Date; lte?: Date };

export type AccountingActivityPopulation = { range: ActivityRange };

type AccountingActivityPopulationQuery = {
  view?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
};

export const resolveAccountingActivityPopulation = (
  query: AccountingActivityPopulationQuery = {},
  now = new Date(),
): AccountingActivityPopulation => {
  const fromDay = resolveTehranDayRange(query.dateFrom);
  const toDay = resolveTehranDayRange(query.dateTo);
  if (fromDay || toDay) {
    return {
      range: {
        ...(fromDay ? { gte: fromDay.gte } : {}),
        ...(toDay ? { lt: toDay.lt } : {}),
      },
    };
  }
  return {
    range: {
      gte: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)),
      lte: now,
    },
  };
};

export const matchesAccountingActivityPopulation = (
  record: { createdAt: Date; actorId?: string },
  population: AccountingActivityPopulation,
) => (!population.range.gte || record.createdAt >= population.range.gte)
  && (!population.range.lt || record.createdAt < population.range.lt)
  && (!population.range.lte || record.createdAt <= population.range.lte);

export const accountingActivityPopulationWhere = (population: AccountingActivityPopulation) => ({
  createdAt: population.range,
});

export const resolveActiveAccountantIds = (rows: Array<{ actorId: string }>) => (
  [...new Set(rows.map((row) => row.actorId))]
);

type ReceivablePopulationQuery = {
  view?: unknown;
  status?: unknown;
  due?: unknown;
  period?: unknown;
  date?: unknown;
  cutoff?: unknown;
};

export type ReceivablePopulation = {
  statuses?: readonly string[];
  dueRange?: DeadlineRange;
  outstandingAt?: Date;
};

type ReceivablePopulationRecord = {
  status: string;
  dueDate: Date;
  createdAt?: Date;
};

export const resolveReceivablePopulation = (
  query: ReceivablePopulationQuery = {},
  now = new Date(),
): ReceivablePopulation => {
  const requestedStatus = String(query.status || '');
  const statuses = (RECEIVABLE_STATUSES as readonly string[]).includes(requestedStatus)
    ? [requestedStatus]
    : query.view === 'open'
      ? OPEN_RECEIVABLE_STATUSES
      : undefined;
  const dueRange = resolveTehranDeadlineRange(query.due, now) || undefined;
  const periodRange = query.view === 'outstanding'
    ? capRangeAt(
        resolveTehranJalaliDayRange(query.date) || resolveTehranPeriodRange(query.period),
        query.cutoff,
      )
    : null;
  return { statuses, dueRange, outstandingAt: periodRange?.lt };
};

const isWithinDeadline = (value: Date | null | undefined, range?: DeadlineRange) => Boolean(
  value
  && (!range?.gte || value >= range.gte)
  && (!range?.lt || value < range.lt),
);

export const matchesReceivablePopulation = (
  record: ReceivablePopulationRecord,
  population: ReceivablePopulation,
) => {
  if (population.statuses && !population.statuses.includes(record.status)) return false;
  if (population.dueRange && !isWithinDeadline(record.dueDate, population.dueRange)) return false;
  if (population.outstandingAt && record.createdAt && record.createdAt >= population.outstandingAt) return false;
  return true;
};

export const receivablePopulationWhere = (population: ReceivablePopulation) => {
  const where: Record<string, unknown> = {};
  if (population.statuses) where.status = { in: [...population.statuses] };
  if (population.dueRange) where.dueDate = population.dueRange;
  if (population.outstandingAt) where.createdAt = { lt: population.outstandingAt };
  return where;
};

type PaymentPopulationQuery = {
  view?: unknown;
  status?: unknown;
  due?: unknown;
  period?: unknown;
  date?: unknown;
  cutoff?: unknown;
};

export type PaymentPopulation = {
  checkStatuses?: readonly string[];
  checksOnly: boolean;
  dueRange?: DeadlineRange;
  received: boolean;
  periodRange?: DateRange;
  empty: boolean;
};

type PaymentPopulationRecord = {
  id?: string;
  method: string;
  status?: string;
  checkStatus?: string | null;
  checkDueDate?: Date | null;
  amount?: unknown;
  occurredAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  metadata?: unknown;
};

export const resolvePaymentPopulation = (
  query: PaymentPopulationQuery = {},
  now = new Date(),
): PaymentPopulation => {
  const requestedStatus = String(query.status || '');
  const statusOverride = (CHECK_STATUSES as readonly string[]).includes(requestedStatus);
  const semanticStatuses = query.view === 'unsettled-checks' || query.view === 'due-soon'
    ? UNSETTLED_CHECK_STATUSES
    : undefined;
  const explicitDue = resolveTehranDeadlineRange(query.due, now) || undefined;
  const dueSoonRange = query.view === 'due-soon'
    ? { lt: tehranCivilMidnight(now, 8) }
    : undefined;
  const dueRange = explicitDue || dueSoonRange;
  const dueSoonConflict = Boolean(
    query.view === 'due-soon'
    && explicitDue?.gte
    && explicitDue.gte >= tehranCivilMidnight(now, 8),
  );
  const received = !statusOverride && query.view === 'received';
  return {
    checkStatuses: statusOverride ? [requestedStatus] : semanticStatuses,
    checksOnly: statusOverride || Boolean(semanticStatuses) || Boolean(dueRange),
    dueRange,
    received,
    periodRange: received
      ? capRangeAt(
          resolveTehranJalaliDayRange(query.date) || resolveTehranPeriodRange(query.period),
          query.cutoff,
        ) || undefined
      : undefined,
    empty: dueSoonConflict,
  };
};

export const matchesPaymentPopulation = (
  record: PaymentPopulationRecord,
  population: PaymentPopulation,
) => {
  if (population.empty) return false;
  if (population.checksOnly && record.method !== 'CHECK') return false;
  if (population.checkStatuses && !population.checkStatuses.includes(String(record.checkStatus || ''))) return false;
  if (population.dueRange && !isWithinDeadline(record.checkDueDate, population.dueRange)) return false;
  if (population.received) return resolveReceivedCollectionMovements(record, population).length > 0;
  return true;
};

export const paymentPopulationWhere = (population: PaymentPopulation) => {
  const where: Record<string, unknown> = {};
  if (population.empty) return { id: { equals: '__no_matching_payment__' } };
  if (population.checksOnly) where.method = 'CHECK';
  if (population.checkStatuses) where.checkStatus = { in: [...population.checkStatuses] };
  if (population.dueRange) where.checkDueDate = population.dueRange;
  return where;
};

export type CollectionMovement = {
  projectionId: string;
  recordId: string;
  kind: string;
  effectiveAt: Date;
  amount: number;
  confidence: 'authoritative' | 'legacy-fallback';
};

const metadataObject = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

export const resolveReceivedCollectionMovements = (
  record: PaymentPopulationRecord,
  population: Pick<PaymentPopulation, 'periodRange'> = {},
): CollectionMovement[] => {
  const recordId = String(record.id || 'payment');
  const stored = metadataObject(record.metadata).collectionMovements;
  const candidates: CollectionMovement[] = Array.isArray(stored)
    ? stored.flatMap((movement: any, index: number) => {
        const effectiveAt = new Date(String(movement?.effectiveAt || ''));
        const amount = Number(movement?.amount);
        if (!movement?.kind || Number.isNaN(effectiveAt.getTime()) || !Number.isFinite(amount) || amount === 0) return [];
        return [{
          projectionId: `${recordId}:${index}:${effectiveAt.toISOString()}`,
          recordId,
          kind: String(movement.kind),
          effectiveAt,
          amount,
          confidence: movement?.confidence === 'legacy-fallback' ? 'legacy-fallback' as const : 'authoritative' as const,
        }];
      })
    : [];

  const storedNet = candidates.reduce((sum, movement) => sum + movement.amount, 0);
  if (record.status === 'REVERSED' && storedNet > 0) {
    const effectiveAt = record.updatedAt || record.occurredAt || record.createdAt;
    if (effectiveAt) {
      candidates.push({
        projectionId: `${recordId}:legacy-reversal:${effectiveAt.toISOString()}`,
        recordId,
        kind: 'REVERSED',
        effectiveAt,
        amount: -storedNet,
        confidence: 'legacy-fallback',
      });
    }
  }

  if (candidates.length === 0) {
    const effectiveAt = record.occurredAt || record.createdAt;
    const amount = Number(record.amount);
    let signedAmount = 0;
    let kind = 'RECEIVED';
    if (record.method === 'CHECK' && record.checkStatus === 'CLEARED') {
      signedAmount = amount;
      kind = 'CHECK_CLEARED';
    } else if (record.method !== 'CHECK' && (record.status === 'RECEIVED' || record.status === 'RECONCILED')) {
      signedAmount = amount;
    } else if (record.method !== 'CHECK' && record.status === 'REVERSED') {
      signedAmount = -amount;
      kind = 'REVERSED';
    }
    if (effectiveAt && Number.isFinite(signedAmount) && signedAmount !== 0) {
      candidates.push({
        projectionId: `${recordId}:legacy:${effectiveAt.toISOString()}`,
        recordId,
        kind,
        effectiveAt,
        amount: signedAmount,
        confidence: 'legacy-fallback',
      });
    }
  }

  return candidates.filter((movement) => !population.periodRange || isWithin(movement.effectiveAt, population.periodRange));
};

type OutstandingInvoiceRecord = {
  financiallyApprovedAt?: Date | null;
  systemInvoiceDate?: Date | null;
  voidedAt?: Date | null;
};

type OutstandingReceivableRecord = {
  id: string;
  contractId?: string | null;
  originalAmount: unknown;
  dueDate: Date;
  createdAt: Date;
  invoiceRecord?: OutstandingInvoiceRecord | null;
};

type OutstandingPaymentRecord = PaymentPopulationRecord & {
  contractId?: string | null;
  receivableId?: string | null;
};

export const resolveOutstandingReceivableProjection = <T extends OutstandingReceivableRecord>(
  receivables: T[],
  payments: OutstandingPaymentRecord[],
  population: Pick<ReceivablePopulation, 'outstandingAt'>,
): Array<T & { representedRemainingAmount: number }> => {
  if (!population.outstandingAt) return receivables.map((row) => ({
    ...row,
    representedRemainingAmount: Math.max(Number(row.originalAmount) || 0, 0),
  }));
  const cutoff = population.outstandingAt;
  const valid = receivables.filter((row) => {
    const invoice = row.invoiceRecord;
    return Boolean(
      invoice?.financiallyApprovedAt
      && invoice.financiallyApprovedAt < cutoff
      && invoice.systemInvoiceDate
      && invoice.systemInvoiceDate < cutoff
      && (!invoice.voidedAt || invoice.voidedAt >= cutoff),
    );
  });
  const remaining = new Map(valid.map((row) => [row.id, Math.max(Number(row.originalAmount) || 0, 0)]));
  const contractRows = new Map<string, T[]>();
  valid.forEach((row) => {
    const key = String(row.contractId || '');
    contractRows.set(key, [...(contractRows.get(key) || []), row]);
  });

  const effects = payments.map((payment) => ({
    payment,
    amount: resolveReceivedCollectionMovements(payment)
      .filter((movement) => movement.effectiveAt < cutoff)
      .reduce((sum, movement) => sum + movement.amount, 0),
  })).filter(({ amount }) => amount !== 0);

  effects.filter(({ payment }) => payment.receivableId && remaining.has(payment.receivableId)).forEach(({ payment, amount }) => {
    const id = payment.receivableId!;
    const original = Number(valid.find((row) => row.id === id)?.originalAmount) || 0;
    remaining.set(id, Math.min(Math.max((remaining.get(id) || 0) - amount, 0), original));
  });

  effects.filter(({ payment }) => !payment.receivableId).forEach(({ payment, amount }) => {
    let unapplied = amount;
    const rows = [...(contractRows.get(String(payment.contractId || '')) || [])]
      .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime() || left.createdAt.getTime() - right.createdAt.getTime());
    for (const row of rows) {
      if (unapplied === 0) break;
      const current = remaining.get(row.id) || 0;
      const original = Number(row.originalAmount) || 0;
      if (unapplied > 0) {
        const applied = Math.min(current, unapplied);
        remaining.set(row.id, current - applied);
        unapplied -= applied;
      } else {
        const restored = Math.min(original - current, -unapplied);
        remaining.set(row.id, current + restored);
        unapplied += restored;
      }
    }
  });

  return valid
    .map((row) => ({ ...row, representedRemainingAmount: remaining.get(row.id) || 0 }))
    .filter((row) => row.representedRemainingAmount > 0);
};

export const resolveCollectionFocus = <T extends { id: string }>(
  recordId: unknown,
  representedIds: Iterable<string>,
  authorizedRecord: T | null,
) => {
  const requestedId = String(recordId || '').trim();
  if (!requestedId) return null;
  if (!authorizedRecord) return { state: 'missing' as const, record: null };
  return {
    state: new Set(representedIds).has(authorizedRecord.id) ? 'focused' as const : 'current-truth' as const,
    record: authorizedRecord,
  };
};
