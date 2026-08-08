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

export type InvoiceCandidatePopulation = {
  statuses?: readonly string[];
  invoiced: boolean;
  periodRange?: DateRange;
};

type InvoiceCandidatePopulationQuery = {
  view?: unknown;
  status?: unknown;
  period?: unknown;
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
      periodRange: resolveTehranPeriodRange(query.period) || undefined,
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
