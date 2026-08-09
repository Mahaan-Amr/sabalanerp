import {
  resolveReceivedCollectionMovements,
  resolveTehranPeriodRange,
} from './accountingPopulations';

export const FINANCIAL_TREND_RANGES = ['1m', '3m', '6m', '1y'] as const;
export type FinancialTrendRange = typeof FINANCIAL_TREND_RANGES[number];

type TrendInvoice = {
  id: string;
  contractId?: string | null;
  status: string;
  amount: unknown;
  sepidarAmount?: unknown;
  financiallyApprovedAt?: Date | null;
  systemInvoiceDate?: Date | null;
  voidedAt?: Date | null;
  createdAt: Date;
};

type TrendPayment = {
  id: string;
  contractId?: string | null;
  receivableId?: string | null;
  method: string;
  status?: string;
  checkStatus?: string | null;
  amount: unknown;
  occurredAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  metadata?: unknown;
};

type TrendAuditEvent = {
  entityId?: string | null;
  entityType?: string | null;
  createdAt: Date;
};

type TrendMovement = {
  contractId: string;
  effectiveAt: Date;
  amount: number;
  confidence: 'authoritative' | 'legacy-fallback';
};

export type FinancialTrendPeriod = {
  key: string;
  monthKey: string;
  label: string;
  day?: number;
  marker: boolean;
  startsAt: Date;
  endsAt: Date;
};

export type AccountingFinancialTrendPoint = {
  periodKey: string;
  monthKey: string;
  label: string;
  marker: boolean;
  startsAt: string;
  endsAt: string;
  invoicedRial: number;
  receivedRial: number;
  outstandingRial: number;
  confidence: 'authoritative' | 'legacy-fallback';
  destinations: {
    invoiced: string;
    received: string;
    outstanding: string;
  };
};

const persianParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
};

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const shiftPersianMonth = (year: number, month: number, offset: number) => {
  const zeroBased = (year * 12) + month - 1 + offset;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
};

const minDate = (left: Date, right: Date) => left < right ? left : right;

export const resolveFinancialTrendPeriods = (
  range: FinancialTrendRange,
  now = new Date(),
): FinancialTrendPeriod[] => {
  const current = persianParts(now);
  const currentKey = monthKey(current.year, current.month);
  if (range === '1m') {
    const month = resolveTehranPeriodRange(currentKey);
    if (!month) return [];
    return Array.from({ length: current.day }, (_, index) => {
      const day = index + 1;
      const startsAt = new Date(month.gte.getTime() + index * 86_400_000);
      const naturalEnd = new Date(month.gte.getTime() + day * 86_400_000);
      return {
        key: `${currentKey}-${String(day).padStart(2, '0')}`,
        monthKey: currentKey,
        label: day.toLocaleString('fa-IR'),
        day,
        marker: [1, 8, 15, 22, 30].includes(day),
        startsAt,
        endsAt: minDate(naturalEnd, now),
      };
    });
  }

  const count = range === '3m' ? 3 : range === '6m' ? 6 : 12;
  return Array.from({ length: count }, (_, index) => {
    const shifted = shiftPersianMonth(current.year, current.month, index - count + 1);
    const key = monthKey(shifted.year, shifted.month);
    const period = resolveTehranPeriodRange(key);
    if (!period) throw new Error(`Invalid generated Persian period ${key}`);
    return {
      key,
      monthKey: key,
      label: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'long' }).format(period.gte),
      marker: true,
      startsAt: period.gte,
      endsAt: key === currentKey ? minDate(period.lt, now) : period.lt,
    };
  });
};

const finiteAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const auditTimesByEntity = (events: TrendAuditEvent[]) => {
  const result = new Map<string, Date>();
  for (const event of events) {
    if (!event.entityId) continue;
    const existing = result.get(event.entityId);
    if (!existing || event.createdAt < existing) result.set(event.entityId, event.createdAt);
  }
  return result;
};

const invoiceMovements = (invoices: TrendInvoice[], auditEvents: TrendAuditEvent[]): TrendMovement[] => {
  const audits = auditTimesByEntity(auditEvents.filter((event) => event.entityType === 'AccountingFinancialRecord'));
  return invoices.flatMap((invoice) => {
    if (!invoice.contractId || !invoice.financiallyApprovedAt || !['ISSUED', 'POSTED', 'VOIDED'].includes(invoice.status)) return [];
    const dedicatedAt = invoice.systemInvoiceDate;
    const effectiveAt = dedicatedAt || audits.get(invoice.id) || invoice.createdAt;
    const confidence = dedicatedAt ? 'authoritative' as const : 'legacy-fallback' as const;
    const amount = finiteAmount(invoice.sepidarAmount ?? invoice.amount);
    if (!amount || Number.isNaN(effectiveAt.getTime())) return [];
    const result: TrendMovement[] = [{ contractId: invoice.contractId, effectiveAt, amount, confidence }];
    if (invoice.status === 'VOIDED' && invoice.voidedAt) {
      result.push({ contractId: invoice.contractId, effectiveAt: invoice.voidedAt, amount: -amount, confidence: 'authoritative' });
    }
    return result;
  });
};

const collectionMovements = (payments: TrendPayment[], auditEvents: TrendAuditEvent[]): TrendMovement[] => {
  const audits = auditTimesByEntity(auditEvents.filter((event) => event.entityType === 'AccountingPaymentStatus'));
  return payments.flatMap((payment) => {
  if (!payment.contractId) return [];
  return resolveReceivedCollectionMovements(payment).map((movement) => ({
    contractId: payment.contractId!,
    effectiveAt: movement.confidence === 'legacy-fallback' && !payment.occurredAt
      ? audits.get(payment.id) || movement.effectiveAt
      : movement.effectiveAt,
    amount: movement.amount,
    confidence: movement.confidence === 'legacy-fallback' && payment.occurredAt
      ? 'authoritative'
      : movement.confidence,
  }));
  });
};

const within = (movement: TrendMovement, period: FinancialTrendPeriod) => (
  movement.effectiveAt >= period.startsAt && movement.effectiveAt < period.endsAt
);

const throughCutoff = (movement: TrendMovement, cutoff: Date) => movement.effectiveAt < cutoff;

const outstandingAt = (invoices: TrendMovement[], collections: TrendMovement[], cutoff: Date) => {
  const contracts = new Map<string, { invoiced: number; received: number }>();
  for (const movement of invoices.filter((item) => throughCutoff(item, cutoff))) {
    const value = contracts.get(movement.contractId) || { invoiced: 0, received: 0 };
    value.invoiced += movement.amount;
    contracts.set(movement.contractId, value);
  }
  for (const movement of collections.filter((item) => throughCutoff(item, cutoff))) {
    const value = contracts.get(movement.contractId);
    if (value) value.received += movement.amount;
  }
  return [...contracts.values()].reduce((total, contract) => total + Math.max(contract.invoiced - contract.received, 0), 0);
};

export const buildOutstandingContractSnapshots = ({ invoices, payments, auditEvents, cutoff }: {
  invoices: TrendInvoice[];
  payments: TrendPayment[];
  auditEvents: TrendAuditEvent[];
  cutoff: Date;
}) => {
  const invoiceEvents = invoiceMovements(invoices, auditEvents);
  const collectionEvents = collectionMovements(payments, auditEvents);
  const contracts = new Map<string, { invoicedRial: number; receivedRial: number }>();
  for (const movement of invoiceEvents.filter((item) => throughCutoff(item, cutoff))) {
    const value = contracts.get(movement.contractId) || { invoicedRial: 0, receivedRial: 0 };
    value.invoicedRial += movement.amount;
    contracts.set(movement.contractId, value);
  }
  for (const movement of collectionEvents.filter((item) => throughCutoff(item, cutoff))) {
    const value = contracts.get(movement.contractId);
    if (value) value.receivedRial += movement.amount;
  }
  return [...contracts.entries()].flatMap(([contractId, value]) => {
    const outstandingRial = Math.max(value.invoicedRial - value.receivedRial, 0);
    return outstandingRial > 0 ? [{ contractId, ...value, outstandingRial }] : [];
  });
};

const destinationsFor = (period: FinancialTrendPeriod) => {
  const periodQuery = `period=${encodeURIComponent(period.monthKey)}`;
  const dateQuery = period.day ? `&date=${encodeURIComponent(period.key)}` : '';
  return {
    invoiced: `/dashboard/accounting/invoice-candidates?view=invoiced&${periodQuery}${dateQuery}`,
    received: `/dashboard/accounting/payments?view=received&${periodQuery}${dateQuery}`,
    outstanding: `/dashboard/accounting/receivables?view=outstanding&${periodQuery}${dateQuery}`,
  };
};

export const buildAccountingFinancialTrend = ({
  range,
  now = new Date(),
  invoices,
  payments,
  auditEvents,
}: {
  range: FinancialTrendRange;
  now?: Date;
  invoices: TrendInvoice[];
  payments: TrendPayment[];
  auditEvents: TrendAuditEvent[];
}) => {
  const periods = resolveFinancialTrendPeriods(range, now);
  const invoiceEvents = invoiceMovements(invoices, auditEvents);
  const collectionEvents = collectionMovements(payments, auditEvents);
  const allEvents = [...invoiceEvents, ...collectionEvents];
  const points: AccountingFinancialTrendPoint[] = periods.map((period) => ({
    periodKey: period.key,
    monthKey: period.monthKey,
    label: period.label,
    marker: period.marker,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
    invoicedRial: invoiceEvents.filter((event) => within(event, period)).reduce((sum, event) => sum + event.amount, 0),
    receivedRial: collectionEvents.filter((event) => within(event, period)).reduce((sum, event) => sum + event.amount, 0),
    outstandingRial: outstandingAt(invoiceEvents, collectionEvents, period.endsAt),
    confidence: allEvents.some((event) => event.confidence === 'legacy-fallback' && throughCutoff(event, period.endsAt))
      ? 'legacy-fallback'
      : 'authoritative',
    destinations: destinationsFor(period),
  }));
  return {
    range,
    currency: 'RIAL' as const,
    points,
    hasLegacyFallback: points.some((point) => point.confidence === 'legacy-fallback'),
  };
};
