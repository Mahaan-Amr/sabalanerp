import { AccountingRecordStatus, FinancialRecordKind, Prisma, PrismaClient } from '@prisma/client';
import { rankBiSellers } from './biRecommendationService';

const prisma = new PrismaClient();
const DAY = 86_400_000;
const REALIZED = new Set(['SIGNED', 'PRINTED']);
const PIPELINE = new Set(['PENDING_APPROVAL', 'APPROVED']);
const LOST = new Set(['CANCELLED', 'EXPIRED']);

export type SalesReportAccess = {
  userId: string;
  role: string;
  departmentId?: string | null;
  canManage: boolean;
  canCompany: boolean;
  canOpenSalesSource?: boolean;
};

export type SalesReportQuery = {
  from?: unknown;
  to?: unknown;
  period?: unknown;
  departmentId?: unknown;
  sellerId?: unknown;
};

type AccountingRegisteredRecord = {
  id: string;
  kind: FinancialRecordKind;
  status: AccountingRecordStatus;
  amount: unknown;
  financiallyApprovedAt?: Date | string | null;
  metadata?: Prisma.JsonValue | null;
};

const recordMetadata = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

export const selectAccountingRegisteredRecord = (records: AccountingRegisteredRecord[]) => {
  const valid = records.filter((record) => (
    record.kind === FinancialRecordKind.INVOICE_CANDIDATE
    && (record.status === AccountingRecordStatus.ISSUED || record.status === AccountingRecordStatus.POSTED)
    && Boolean(record.financiallyApprovedAt)
  ));
  if (!valid.length) return { record: null, hasConflict: false, validLeafCount: 0 };

  const validIds = new Set(valid.map((record) => record.id));
  const supersededIds = new Set(valid.flatMap((record) => {
    const replacesRecordId = recordMetadata(record.metadata).replacesRecordId;
    return typeof replacesRecordId === 'string' && validIds.has(replacesRecordId) ? [replacesRecordId] : [];
  }));
  const leaves = valid.filter((record) => !supersededIds.has(record.id));
  const candidates = leaves.length ? leaves : valid;
  candidates.sort((left, right) => {
    const byApproval = new Date(right.financiallyApprovedAt!).getTime() - new Date(left.financiallyApprovedAt!).getTime();
    return byApproval || right.id.localeCompare(left.id);
  });
  return { record: candidates[0], hasConflict: candidates.length > 1, validLeafCount: candidates.length };
};

const n = (value: unknown) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const faDate = (date: Date) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

const faDateTime = (date: Date) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(date);

const persianParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read('year'), month: read('month'), day: read('day') };
};

const startDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const parseDate = (value: unknown) => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfPersianMonth = (date: Date) => {
  let cursor = startDay(date);
  const target = persianParts(cursor);
  while (true) {
    const previous = new Date(cursor.getTime() - DAY);
    const parts = persianParts(previous);
    if (parts.year !== target.year || parts.month !== target.month) return cursor;
    cursor = previous;
  }
};

const startOfPersianYear = (date: Date) => {
  let cursor = startDay(date);
  const year = persianParts(cursor).year;
  while (persianParts(new Date(cursor.getTime() - DAY)).year === year) cursor = new Date(cursor.getTime() - DAY);
  return cursor;
};

const startOfPersianQuarter = (date: Date) => {
  const parts = persianParts(date);
  const targetMonth = Math.floor((parts.month - 1) / 3) * 3 + 1;
  let cursor = startDay(date);
  while (true) {
    const value = persianParts(cursor);
    if (value.month === targetMonth && value.day === 1) return cursor;
    cursor = new Date(cursor.getTime() - DAY);
  }
};

const startOfPersianMonthsAgo = (date: Date, monthsAgo: number) => {
  const current = persianParts(date);
  const targetIndex = current.year * 12 + current.month - 1 - monthsAgo;
  let cursor = startDay(date);
  while (true) {
    const value = persianParts(cursor);
    if (value.year * 12 + value.month - 1 === targetIndex && value.day === 1) return cursor;
    cursor = new Date(cursor.getTime() - DAY);
  }
};

export const resolveSalesReportPeriod = (query: SalesReportQuery, now = new Date()) => {
  const requestedFrom = parseDate(query.from);
  const requestedTo = parseDate(query.to);
  let from = requestedFrom || startOfPersianMonth(now);
  let to = requestedTo || endDay(now);
  if (!requestedFrom || !requestedTo) {
    switch (String(query.period || 'month')) {
      case 'all': from = startDay(now); break;
      case 'today': from = startDay(now); break;
      case 'yesterday': from = startDay(new Date(now.getTime() - DAY)); to = endDay(from); break;
      case 'week': from = startDay(new Date(now.getTime() - 6 * DAY)); break;
      case 'quarter': from = startOfPersianQuarter(now); break;
      case 'year': from = startOfPersianYear(now); break;
      case 'last12': from = startOfPersianMonthsAgo(now, 11); break;
      case 'previousMonth': {
        const currentMonthStart = startOfPersianMonth(now);
        from = startOfPersianMonthsAgo(now, 1);
        to = endDay(new Date(currentMonthStart.getTime() - 1));
        break;
      }
      default: from = startOfPersianMonth(now);
    }
  }
  from = startDay(from);
  to = endDay(to);
  if (from > to) throw new Error('Invalid report period');
  const duration = to.getTime() - from.getTime() + 1;
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration + 1);
  return { from, to, previousFrom: startDay(previousFrom), previousTo: endDay(previousTo) };
};

export const resolveAllTimeSalesReportPeriod = (
  contracts: Array<{
    createdAt: Date | string;
    realizedAt?: Date | string | null;
    lostAt?: Date | string | null;
    reportingEvents?: Array<{ effectiveAt: Date | string }>;
  }>,
  now = new Date(),
) => {
  const earliestTime = contracts.reduce((earliest, contract) => {
    const candidates = [
      contract.createdAt,
      contract.realizedAt,
      contract.lostAt,
      ...(contract.reportingEvents || []).map((event) => event.effectiveAt),
    ].filter(Boolean).map((value) => new Date(value as Date | string).getTime());
    return Math.min(earliest, ...candidates);
  }, Number.POSITIVE_INFINITY);
  const from = Number.isFinite(earliestTime) ? startDay(new Date(earliestTime)) : startDay(now);
  return { from, to: endDay(now), previousFrom: from, previousTo: new Date(from.getTime() - 1) };
};

const inRange = (value: Date | string | null | undefined, from: Date, to: Date) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= from.getTime() && time <= to.getTime();
};

const userName = (user: any) => `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || 'نامشخص';
const customerName = (customer: any) => `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || customer?.companyName || 'نامشخص';

const statusInfo: Record<string, { label: string; bucket: string; description: string }> = {
  DRAFT: { label: 'پیش‌نویس', bucket: 'unfinished', description: 'قرارداد هنوز برای بررسی ارسال نشده و فروش قطعی نیست.' },
  PENDING_APPROVAL: { label: 'در انتظار تأیید', bucket: 'pipeline', description: 'قرارداد در صف بررسی است و هنوز فروش قطعی محسوب نمی‌شود.' },
  APPROVED: { label: 'تأییدشده', bucket: 'pipeline', description: 'قرارداد تأیید شده اما هنوز امضا یا چاپ تجاری نشده است.' },
  SIGNED: { label: 'امضاشده', bucket: 'realized', description: 'قرارداد امضا شده و فروش در تاریخ تحقق ثبت شده است.' },
  PRINTED: { label: 'چاپ‌شده', bucket: 'realized', description: 'نسخه تجاری چاپ شده و فروش قطعی است.' },
  CANCELLED: { label: 'لغوشده', bucket: 'lost', description: 'قرارداد لغو شده است؛ لغو فروش قطعی به‌صورت تعدیل منفی ثبت می‌شود.' },
  EXPIRED: { label: 'منقضی‌شده', bucket: 'lost', description: 'مهلت قرارداد بدون تحقق فروش پایان یافته است.' }
};

export const buildSalesReportScope = (access: SalesReportAccess, query: SalesReportQuery) => {
  const requestedDepartment = typeof query.departmentId === 'string' && query.departmentId ? query.departmentId : null;
  const requestedSeller = typeof query.sellerId === 'string' && query.sellerId ? query.sellerId : null;
  if (!access.canManage && requestedSeller && requestedSeller !== access.userId) throw new Error('Seller scope is not permitted');
  const departmentId = access.canCompany ? requestedDepartment : access.departmentId || '__no_department__';
  const sellerId = access.canManage ? requestedSeller : access.userId;
  return {
    departmentId,
    sellerId,
    mode: access.canCompany ? (departmentId ? 'department' : 'company') : access.canManage ? 'department' : 'personal',
    canManage: access.canManage,
    canCompany: access.canCompany
  };
};

const validateSalesReportScope = async (access: SalesReportAccess, query: SalesReportQuery) => {
  const scope = buildSalesReportScope(access, query);
  const requestedDepartment = typeof query.departmentId === 'string' && query.departmentId ? query.departmentId : null;
  const requestedSeller = typeof query.sellerId === 'string' && query.sellerId ? query.sellerId : null;

  if (requestedDepartment && !access.canCompany && requestedDepartment !== access.departmentId) {
    throw new Error('Department scope is not permitted');
  }
  if (requestedDepartment && access.canCompany) {
    const department = await prisma.department.findUnique({ where: { id: requestedDepartment }, select: { id: true } });
    if (!department) throw new Error('Department scope is not permitted');
  }
  if (requestedSeller) {
    const seller = await prisma.user.findUnique({
      where: { id: requestedSeller },
      select: { id: true, isActive: true, departmentId: true },
    });
    const requiredDepartment = scope.departmentId && scope.departmentId !== '__no_department__' ? scope.departmentId : null;
    if (!seller?.isActive || (requiredDepartment && seller.departmentId !== requiredDepartment)) {
      throw new Error('Seller scope is not permitted');
    }
  }
  return scope;
};

export const buildSalesReportContractWhere = (
  access: SalesReportAccess,
  query: SalesReportQuery,
): Prisma.SalesContractWhereInput => {
  const scope = buildSalesReportScope(access, query);
  return {
    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
    ...(!access.canManage ? {
      OR: [
        { responsibleSellerId: access.userId },
        { realizedSellerId: access.userId },
        { createdBy: access.userId }
      ]
    } : {})
  };
};

type SalesHeadlineContract = {
  id: string;
  status: string;
  createdBy: string;
  responsibleSellerId: string;
  realizedSellerId?: string | null;
  lostAt?: Date | string | null;
  updatedAt: Date | string;
  reportingEvents: Array<{
    contractId: string;
    eventType: string;
    amount: unknown;
    sellerId?: string | null;
    effectiveAt: Date | string;
  }>;
};

export const buildRealizedSalesHeadline = ({
  contracts,
  sellerId,
  from,
  to,
}: {
  contracts: SalesHeadlineContract[];
  sellerId?: string | null;
  from?: Date;
  to?: Date;
}) => {
  const insidePeriod = (value: Date | string | null | undefined) => !from || !to || inRange(value, from, to);
  const metricContracts = sellerId
    ? contracts.filter((contract) => contract.responsibleSellerId === sellerId || contract.realizedSellerId === sellerId || contract.createdBy === sellerId)
    : contracts;
  const events = metricContracts.flatMap((contract) => contract.reportingEvents)
    .filter((event) => (!sellerId || event.sellerId === sellerId) && insidePeriod(event.effectiveAt));
  const originalRealized = events.filter((event) => event.eventType === 'REALIZED');
  const adjustments = events.filter((event) => event.eventType !== 'REALIZED');
  const realizedContractIds = new Set(originalRealized.map((event) => event.contractId));
  const lostContractIds = new Set(metricContracts
    .filter((contract) => LOST.has(contract.status)
      && insidePeriod(contract.lostAt || contract.updatedAt)
      && (!sellerId || contract.responsibleSellerId === sellerId))
    .map((contract) => contract.id));
  const grossRealized = originalRealized.reduce((sum, event) => sum + n(event.amount), 0);
  const adjustmentAmount = adjustments.reduce((sum, event) => sum + n(event.amount), 0);
  const netRealized = grossRealized + adjustmentAmount;
  const decidedCount = new Set([...realizedContractIds, ...lostContractIds]).size;

  return {
    grossRealized,
    adjustmentAmount,
    netRealized,
    realizedCount: realizedContractIds.size,
    averageRealizedValue: realizedContractIds.size ? Math.round(netRealized / realizedContractIds.size) : null,
    successRate: decidedCount ? Math.round((realizedContractIds.size / decidedCount) * 100) : null,
    originalRealized,
    adjustments,
    realizedContractIds,
  };
};

type SalesPipelineContract = {
  id: string;
  status: string;
  totalAmount: unknown;
  createdAt: Date | string;
  responsibleSellerId: string;
};

export const buildSalesPipelineHeadline = ({
  contracts,
  sellerId,
  from,
  to,
}: {
  contracts: SalesPipelineContract[];
  sellerId?: string | null;
  from: Date;
  to: Date;
}) => {
  const activeContracts = contracts.filter((contract) =>
    PIPELINE.has(contract.status)
    && (!sellerId || contract.responsibleSellerId === sellerId));
  const createdInPeriod = activeContracts.filter((contract) =>
    inRange(contract.createdAt, from, to));

  return {
    activeValue: activeContracts.reduce((sum, contract) => sum + n(contract.totalAmount), 0),
    activeCount: activeContracts.length,
    createdInPeriodValue: createdInPeriod.reduce((sum, contract) => sum + n(contract.totalAmount), 0),
    createdInPeriodCount: createdInPeriod.length,
  };
};

const bucketKey = (date: Date, monthly: boolean) => monthly
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  : date.toISOString().slice(0, 10);

export const buildSalesReport = async (access: SalesReportAccess, query: SalesReportQuery) => {
  const allTime = String(query.period || '') === 'all';
  let period = resolveSalesReportPeriod(query);
  const scope = await validateSalesReportScope(access, query);
  const where = buildSalesReportContractWhere(access, query);

  const contracts = await prisma.salesContract.findMany({
    where,
    include: {
      customer: { include: { projectAddresses: true } },
      department: { select: { id: true, namePersian: true, name: true } },
      createdByUser: { select: { id: true, firstName: true, lastName: true, username: true } },
      responsibleSeller: { select: { id: true, firstName: true, lastName: true, username: true } },
      realizedSeller: { select: { id: true, firstName: true, lastName: true, username: true } },
      items: { include: { product: true } },
      deliveries: true,
      payments: { include: { installments: true } },
      reportingEvents: true,
      wonCrmPotentialProject: { select: { id: true, title: true } }
    }
  });

  if (allTime) {
    period = resolveAllTimeSalesReportPeriod(contracts);
  }

  const contractIds = contracts.map((contract) => contract.id);
  const crmProjectWhere = {
    isActive: true,
    ...(scope.sellerId
      ? { responsibleSellerId: scope.sellerId }
      : scope.departmentId
        ? { responsibleSeller: { departmentId: scope.departmentId } }
        : {}),
  };
  const [accountingEvidence, deliveryEvidence, crmEvidence] = await Promise.allSettled([
    contractIds.length ? Promise.all([
      prisma.accountingPaymentStatus.findMany({ where: { contractId: { in: contractIds } } }),
      prisma.accountingReceivable.findMany({ where: { contractId: { in: contractIds } } }),
      prisma.accountingFinancialRecord.findMany({
        where: { contractId: { in: contractIds } },
        select: {
          id: true,
          contractId: true,
          kind: true,
          status: true,
          amount: true,
          financiallyApprovedAt: true,
          metadata: true,
        },
      }),
    ]) : Promise.resolve([[], [], []] as [never[], never[], never[]]),
    contractIds.length ? prisma.logisticsLoadingLine.findMany({
      where: { sourceContractId: { in: contractIds } },
      include: { loading: { include: { securityVehicleMovements: true } } }
    }) : Promise.resolve([] as never[]),
    prisma.crmPotentialProject.findMany({
      where: crmProjectWhere,
      include: { nextActions: true },
    }),
  ]);
  const [accountingPayments, receivables, financialRecords] = accountingEvidence.status === 'fulfilled'
    ? accountingEvidence.value
    : [[], [], []];
  const loadingLines = deliveryEvidence.status === 'fulfilled' ? deliveryEvidence.value : [];
  const crmProjects = crmEvidence.status === 'fulfilled' ? crmEvidence.value : [];

  const metricContracts = scope.sellerId
    ? contracts.filter((contract) => contract.responsibleSellerId === scope.sellerId || contract.realizedSellerId === scope.sellerId || contract.createdBy === scope.sellerId)
    : contracts;
  const events = metricContracts.flatMap((contract) => contract.reportingEvents)
    .filter((event) => !scope.sellerId || event.sellerId === scope.sellerId);
  const currentEvents = events.filter((event) => inRange(event.effectiveAt, period.from, period.to));
  const previousEvents = allTime ? [] : events.filter((event) => inRange(event.effectiveAt, period.previousFrom, period.previousTo));
  const headline = buildRealizedSalesHeadline({ contracts, sellerId: scope.sellerId, from: period.from, to: period.to });
  const pipelineHeadline = buildSalesPipelineHeadline({
    contracts: metricContracts,
    sellerId: scope.sellerId,
    from: period.from,
    to: period.to,
  });
  const { originalRealized, adjustments, grossRealized, adjustmentAmount, netRealized, realizedContractIds } = headline;
  const previousNet = previousEvents.reduce((sum, event) => sum + n(event.amount), 0);

  const pipelineContracts = metricContracts.filter((contract) => PIPELINE.has(contract.status) && inRange(contract.createdAt, period.from, period.to) && (!scope.sellerId || contract.responsibleSellerId === scope.sellerId));
  const lostContracts = metricContracts.filter((contract) => LOST.has(contract.status) && inRange(contract.lostAt || contract.updatedAt, period.from, period.to) && (!scope.sellerId || contract.responsibleSellerId === scope.sellerId));
  const createdContracts = metricContracts.filter((contract) => inRange(contract.createdAt, period.from, period.to) && (!scope.sellerId || contract.createdBy === scope.sellerId));
  const successRate = headline.successRate;

  const monthly = (period.to.getTime() - period.from.getTime()) / DAY > 62;
  const trendMap = new Map<string, { key: string; label: string; realized: number; adjustments: number; net: number; pipeline: number }>();
  let cursor = startDay(period.from);
  while (cursor <= period.to) {
    const key = bucketKey(cursor, monthly);
    if (!trendMap.has(key)) trendMap.set(key, { key, label: monthly ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'short' }).format(cursor) : faDate(cursor), realized: 0, adjustments: 0, net: 0, pipeline: 0 });
    cursor = new Date(cursor.getTime() + DAY);
  }
  currentEvents.forEach((event) => {
    const row = trendMap.get(bucketKey(event.effectiveAt, monthly));
    if (!row) return;
    if (event.eventType === 'REALIZED') row.realized += n(event.amount); else row.adjustments += n(event.amount);
    row.net += n(event.amount);
  });
  pipelineContracts.forEach((contract) => {
    const row = trendMap.get(bucketKey(contract.createdAt, monthly));
    if (row) row.pipeline += n(contract.totalAmount);
  });
  const trend = Array.from(trendMap.values()).reverse(); // oldest on the right in RTL charts

  const statusDistribution = Object.entries(statusInfo).map(([status, info]) => {
    const rows = metricContracts.filter((contract) => contract.status === status && (
      REALIZED.has(status) ? inRange(contract.realizedAt || contract.signedAt || contract.createdAt, period.from, period.to)
        : LOST.has(status) ? inRange(contract.lostAt || contract.updatedAt, period.from, period.to)
          : inRange(contract.createdAt, period.from, period.to)
    ));
    return { status, ...info, count: rows.length, value: rows.reduce((sum, row) => sum + n(row.totalAmount), 0) };
  });

  const receivedStatuses = new Set(['RECEIVED', 'RECONCILED']);
  const receivedInPeriod = accountingPayments.filter((payment) => receivedStatuses.has(payment.status) && inRange(payment.occurredAt || payment.createdAt, period.from, period.to));
  const receivedAmount = receivedInPeriod.reduce((sum, payment) => sum + n(payment.amount), 0);
  const receivableAmount = receivables.reduce((sum, row) => sum + n(row.remainingAmount), 0);
  const accountingCovered = new Set([
    ...accountingPayments.map((row) => row.contractId),
    ...receivables.map((row) => row.contractId),
    ...financialRecords.map((row) => row.contractId)
  ].filter(Boolean)).size;

  const accountingRegistered = (() => {
    if (accountingEvidence.status !== 'fulfilled') {
      return {
        available: false,
        rows: [],
        unassigned: null,
        details: [],
        contractCount: null,
        totalAmount: null,
        conflictCount: null,
      };
    }

    const recordsByContract = new Map<string, AccountingRegisteredRecord[]>();
    financialRecords.forEach((record: any) => {
      if (!record.contractId) return;
      const rows = recordsByContract.get(record.contractId) || [];
      rows.push(record);
      recordsByContract.set(record.contractId, rows);
    });

    const accountingDetails = contracts.flatMap((contract) => {
      if (scope.sellerId && contract.realizedSellerId !== scope.sellerId) return [];
      const selected = selectAccountingRegisteredRecord(recordsByContract.get(contract.id) || []);
      if (!selected.record || !inRange(selected.record.financiallyApprovedAt, period.from, period.to)) return [];
      return [{
        id: contract.id,
        contractNumber: contract.contractNumber,
        customer: customerName(contract.customer),
        sellerId: contract.realizedSellerId,
        sellerName: contract.realizedSeller ? userName(contract.realizedSeller) : 'فروشندهٔ قطعی تخصیص‌نیافته',
        financialRecordId: selected.record.id,
        financiallyApprovedAt: new Date(selected.record.financiallyApprovedAt!).toISOString(),
        amount: n(selected.record.amount),
        hasConflict: selected.hasConflict,
        validLeafCount: selected.validLeafCount,
        canOpenSource: Boolean(access.canOpenSalesSource),
      }];
    }).sort((left, right) => (
      new Date(right.financiallyApprovedAt).getTime() - new Date(left.financiallyApprovedAt).getTime()
      || right.contractNumber.localeCompare(left.contractNumber)
    ));

    const sellerRows = new Map<string, { id: string; name: string; contractCount: number; totalAmount: number }>();
    accountingDetails.forEach((detail) => {
      const id = detail.sellerId || 'legacy-unassigned';
      const row = sellerRows.get(id) || { id, name: detail.sellerName, contractCount: 0, totalAmount: 0 };
      row.contractCount += 1;
      row.totalAmount += detail.amount;
      sellerRows.set(id, row);
    });
    const unassigned = sellerRows.get('legacy-unassigned') || null;
    const rows = Array.from(sellerRows.values())
      .filter((row) => row.id !== 'legacy-unassigned')
      .sort((left, right) => (
        right.totalAmount - left.totalAmount
        || right.contractCount - left.contractCount
        || left.name.localeCompare(right.name, 'fa')
      ));

    return {
      available: true,
      rows,
      unassigned,
      details: accountingDetails,
      contractCount: accountingDetails.length,
      totalAmount: accountingDetails.reduce((sum, detail) => sum + detail.amount, 0),
      conflictCount: accountingDetails.filter((detail) => detail.hasConflict).length,
    };
  })();

  const loadingById = new Map<string, any>();
  loadingLines.forEach((line: any) => loadingById.set(line.loading.id, line.loading));
  const loadings = Array.from(loadingById.values());
  const finalizedLoadings = loadings.filter((loading) => loading.status === 'FINALIZED');
  const exitedLoadings = loadings.filter((loading) => loading.securityVehicleMovements.some((movement: any) => movement.direction === 'EXIT' && !movement.voidedAt));
  const now = new Date();
  const stalledBefore = new Date(now.getTime() - 30 * DAY);
  const activePipelineContracts = metricContracts.filter((contract) => PIPELINE.has(contract.status));
  const stalledPipelineContracts = activePipelineContracts.filter((contract) => contract.createdAt < stalledBefore);
  const overdueReceivableRows = receivables.filter((row) =>
    n(row.remainingAmount) > 0
    && row.dueDate < now
    && !['SETTLED', 'VOIDED'].includes(row.status));
  const overdueDeliveryRows = metricContracts.flatMap((contract) => contract.deliveries)
    .filter((delivery) => delivery.deliveryDate < now && !['DELIVERED', 'CANCELLED'].includes(delivery.status));
  const dueSoonEnd = new Date(now.getTime() + 7 * DAY);
  const dueSoonDeliveryRows = metricContracts.flatMap((contract) => contract.deliveries)
    .filter((delivery) => delivery.deliveryDate >= now && delivery.deliveryDate <= dueSoonEnd && !['DELIVERED', 'CANCELLED'].includes(delivery.status));
  const deliveredUnconfirmedRows = metricContracts.flatMap((contract) => contract.deliveries)
    .filter((delivery) => delivery.status === 'DELIVERED' && !delivery.customerConfirmation);
  const contractsWithLoading = new Set(loadingLines.map((line) => line.sourceContractId).filter(Boolean));
  const promisedWithoutLoading = metricContracts.filter((contract) =>
    contract.deliveries.some((delivery) => delivery.status !== 'CANCELLED')
    && !contractsWithLoading.has(contract.id));
  const finalizedWithoutExit = finalizedLoadings.filter((loading) =>
    !loading.securityVehicleMovements.some((movement: any) => movement.direction === 'EXIT' && !movement.voidedAt));
  const overdueFollowUps = crmProjects.flatMap((project) => project.nextActions)
    .filter((action) => action.dueAt < now && !action.completedAt && action.status !== 'انجام شده');
  const crmWonWithoutContract = crmProjects.filter((project) =>
    project.status === 'برنده شده' && !project.wonSalesContractId);

  const customerMap = new Map<string, any>();
  const productMap = new Map<string, any>();
  metricContracts.filter((contract) => realizedContractIds.has(contract.id)).forEach((contract) => {
    const customer = customerMap.get(contract.customerId) || { id: contract.customerId, name: customerName(contract.customer), value: 0, contracts: 0, firstRealizedAt: contract.realizedAt, allRealizedContracts: 0 };
    customer.value += n(contract.realizedAmount || contract.totalAmount);
    customer.contracts += 1;
    customerMap.set(contract.customerId, customer);
    contract.items.forEach((item) => {
      const key = item.productId;
      const product = productMap.get(key) || { id: key, name: item.product.namePersian || item.product.name, code: item.product.code, value: 0, quantity: 0, contracts: new Set<string>() };
      product.value += n(item.totalPrice);
      product.quantity += n(item.quantity);
      product.contracts.add(contract.id);
      productMap.set(key, product);
    });
  });

  const sellerMap = new Map<string, any>();
  if (scope.canManage) {
    contracts.forEach((contract) => {
      const id = contract.responsibleSellerId;
      if (!sellerMap.has(id)) sellerMap.set(id, { id, name: userName(contract.responsibleSeller), createdCount: 0, createdValue: 0, pipelineCount: 0, pipelineValue: 0, stalledPipelineCount: 0, overdueFollowUpCount: 0, realizedCount: 0, realizedValue: 0, adjustments: 0, previousNetRealized: 0, lostCount: 0, lostValue: 0, discountAmount: 0 });
      const row = sellerMap.get(id);
      if (inRange(contract.createdAt, period.from, period.to) && contract.createdBy === id) { row.createdCount += 1; row.createdValue += n(contract.totalAmount); }
      if (PIPELINE.has(contract.status)) {
        row.pipelineCount += 1;
        row.pipelineValue += n(contract.totalAmount);
        if (contract.createdAt < stalledBefore) row.stalledPipelineCount += 1;
      }
      if (LOST.has(contract.status) && inRange(contract.lostAt || contract.updatedAt, period.from, period.to)) { row.lostCount += 1; row.lostValue += n(contract.totalAmount); }
    });
    currentEvents.forEach((event) => {
      const id = event.sellerId || 'legacy-unassigned';
      if (!sellerMap.has(id)) sellerMap.set(id, { id, name: id === 'legacy-unassigned' ? 'فروش قطعی تخصیص‌نیافته قدیمی' : 'نامشخص', createdCount: 0, createdValue: 0, pipelineCount: 0, pipelineValue: 0, stalledPipelineCount: 0, overdueFollowUpCount: 0, realizedCount: 0, realizedValue: 0, adjustments: 0, previousNetRealized: 0, lostCount: 0, lostValue: 0, discountAmount: 0 });
      const row = sellerMap.get(id);
      if (event.eventType === 'REALIZED') { row.realizedCount += 1; row.realizedValue += n(event.amount); } else row.adjustments += n(event.amount);
    });
    previousEvents.forEach((event) => {
      if (event.sellerId && sellerMap.has(event.sellerId)) sellerMap.get(event.sellerId).previousNetRealized += n(event.amount);
    });
    crmProjects.forEach((project) => {
      if (!sellerMap.has(project.responsibleSellerId)) return;
      sellerMap.get(project.responsibleSellerId).overdueFollowUpCount += project.nextActions
        .filter((action) => action.dueAt < now && !action.completedAt && action.status !== 'انجام شده').length;
    });
  }

  const details = metricContracts.filter((contract) => {
    const relevantEvent = contract.reportingEvents.some((event) => inRange(event.effectiveAt, period.from, period.to) && (!scope.sellerId || event.sellerId === scope.sellerId));
    return PIPELINE.has(contract.status) || relevantEvent || inRange(contract.createdAt, period.from, period.to) || inRange(contract.lostAt, period.from, period.to);
  }).map((contract) => ({
    id: contract.id,
    customerId: contract.customerId,
    responsibleSellerId: contract.responsibleSellerId,
    realizedSellerId: contract.realizedSellerId,
    productIds: contract.items.map((item) => item.productId),
    contractNumber: contract.contractNumber,
    customer: customerName(contract.customer),
    project: contract.wonCrmPotentialProject?.title || (contract.contractData as any)?.project?.address || 'ثبت نشده',
    status: contract.status,
    statusLabel: statusInfo[contract.status]?.label || contract.status,
    statusDescription: statusInfo[contract.status]?.description || '',
    amount: n(contract.totalAmount),
    responsibleSeller: userName(contract.responsibleSeller),
    realizedSeller: contract.realizedSeller ? userName(contract.realizedSeller) : contract.realizedAt ? 'تخصیص‌نیافته قدیمی' : '—',
    createdAt: contract.createdAt,
    realizedAt: contract.realizedAt,
    lostAt: contract.lostAt,
    reportingEventDates: contract.reportingEvents
      .filter((event) => !scope.sellerId || event.sellerId === scope.sellerId)
      .map((event) => event.effectiveAt),
    canOpenSource: Boolean(access.canOpenSalesSource)
  })).sort((a, b) => new Date(b.realizedAt || b.lostAt || b.createdAt).getTime() - new Date(a.realizedAt || a.lostAt || a.createdAt).getTime());

  const sellers = rankBiSellers(Array.from(sellerMap.values())
    .filter((row) => row.id !== 'legacy-unassigned')
    .map((row) => {
      const netRealized = row.realizedValue + row.adjustments;
      return {
        ...row,
        netRealized,
        averageRealizedValue: row.realizedCount ? Math.round(netRealized / row.realizedCount) : null,
        deteriorationPercent: allTime || row.previousNetRealized === 0
          ? null
          : Math.round(((netRealized - row.previousNetRealized) / Math.abs(row.previousNetRealized)) * 100),
        lossRate: row.lostCount + row.realizedCount
          ? Math.round((row.lostCount / (row.lostCount + row.realizedCount)) * 100)
          : null,
      };
    }));

  return {
    generatedAt: new Date().toISOString(),
    generatedAtLabel: faDateTime(new Date()),
    currency: 'تومان',
    sourceAvailability: {
      crm: crmEvidence.status === 'fulfilled',
      accounting: accountingEvidence.status === 'fulfilled',
      logistics: deliveryEvidence.status === 'fulfilled',
      security: deliveryEvidence.status === 'fulfilled',
    },
    riskEvidence: {
      overdueReceivables: {
        count: overdueReceivableRows.length,
        value: overdueReceivableRows.reduce((sum, row) => sum + n(row.remainingAmount), 0),
      },
      overdueDeliveries: { count: overdueDeliveryRows.length },
      overdueFollowUps: { count: overdueFollowUps.length },
      dueSoonDeliveries: { count: dueSoonDeliveryRows.length },
      stalledPipeline: {
        count: stalledPipelineContracts.length,
        value: stalledPipelineContracts.reduce((sum, contract) => sum + n(contract.totalAmount), 0),
      },
      promisedWithoutLoading: { count: promisedWithoutLoading.length },
      finalizedWithoutExit: { count: finalizedWithoutExit.length },
      crmWonWithoutContract: { count: crmWonWithoutContract.length },
    },
    permissions: { canManage: scope.canManage, canCompany: scope.canCompany, canSelectSeller: scope.canManage, canViewSellerComparisons: scope.canManage },
    scope: {
      mode: scope.mode,
      departmentId: scope.departmentId === '__no_department__' ? null : scope.departmentId,
      sellerId: scope.sellerId,
      label: scope.mode === 'company' ? 'کل شرکت' : scope.mode === 'department' ? 'دپارتمان فروش' : 'قراردادهای خودم'
    },
    period: {
      from: period.from.toISOString(), to: period.to.toISOString(),
      label: `${faDate(period.from)} تا ${faDate(period.to)}`,
      ...(!allTime ? {
        previousFrom: period.previousFrom.toISOString(),
        previousTo: period.previousTo.toISOString(),
        previousLabel: `${faDate(period.previousFrom)} تا ${faDate(period.previousTo)}`,
      } : {}),
    },
    cards: {
      grossRealized, adjustments: adjustmentAmount, netRealized,
      previousNetRealized: previousNet,
      growthPercent: allTime ? null : previousNet === 0 ? (netRealized === 0 ? null : 100) : Math.round(((netRealized - previousNet) / Math.abs(previousNet)) * 100),
      currentPipelineValue: pipelineHeadline.activeValue,
      currentPipelineCount: pipelineHeadline.activeCount,
      pipelineValue: pipelineHeadline.createdInPeriodValue,
      pipelineCount: pipelineHeadline.createdInPeriodCount,
      lostValue: lostContracts.reduce((sum, contract) => sum + n(contract.totalAmount), 0),
      lostCount: lostContracts.length,
      realizedCount: headline.realizedCount,
      averageRealizedValue: headline.averageRealizedValue,
      customerCount: new Set(originalRealized.map((event) => contracts.find((contract) => contract.id === event.contractId)?.customerId).filter(Boolean)).size,
      successRate
    },
    trend,
    statusDistribution,
    contracts: details,
    customers: Array.from(customerMap.values()).sort((a, b) => b.value - a.value),
    products: Array.from(productMap.values()).map((row) => ({ ...row, contracts: row.contracts.size })).sort((a, b) => b.value - a.value),
    finance: {
      plannedPaymentAmount: metricContracts.filter((contract) => realizedContractIds.has(contract.id)).flatMap((contract) => contract.payments).filter((payment) => payment.status !== 'CANCELLED').reduce((sum, payment) => sum + n(payment.totalAmount), 0),
      receivedAmount,
      receivableAmount,
      overdueAmount: overdueReceivableRows.reduce((sum, row) => sum + n(row.remainingAmount), 0),
      coverage: { coveredContracts: accountingCovered, totalContracts: contractIds.length },
      source: 'ACCOUNTING'
    },
    delivery: {
      promisedDeliveries: metricContracts.flatMap((contract) => contract.deliveries).filter((delivery) => inRange(delivery.deliveryDate, period.from, period.to)).length,
      dueSoonDeliveries: dueSoonDeliveryRows.length,
      overdueDeliveries: overdueDeliveryRows.length,
      deliveredUnconfirmed: deliveredUnconfirmedRows.length,
      finalizedLoadings: finalizedLoadings.length,
      exitedLoadings: exitedLoadings.length,
      coverage: { coveredContracts: new Set(loadingLines.map((line) => line.sourceContractId)).size, totalContracts: contractIds.length },
      sources: ['SALES', 'LOGISTICS', 'SECURITY']
    },
    sellers: scope.canManage ? sellers : [],
    legacyUnassigned: {
      count: currentEvents.filter((event) => event.eventType === 'REALIZED' && !event.sellerId).length,
      value: currentEvents.filter((event) => event.eventType === 'REALIZED' && !event.sellerId).reduce((sum, event) => sum + n(event.amount), 0)
    },
    accountingRegistered,
    created: { count: createdContracts.length, value: createdContracts.reduce((sum, contract) => sum + n(contract.totalAmount), 0) }
  };
};

export const getSalesReportSellers = async (access: SalesReportAccess, departmentId?: string | null) => {
  if (!access.canManage) return [];
  if (departmentId && !access.canCompany && departmentId !== access.departmentId) {
    throw new Error('Department scope is not permitted');
  }
  if (departmentId && access.canCompany) {
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!department) throw new Error('Department scope is not permitted');
  }
  const targetDepartment = access.canCompany ? departmentId || undefined : access.departmentId || '__no_department__';
  return prisma.user.findMany({
    where: { isActive: true, ...(targetDepartment ? { departmentId: targetDepartment } : {}) },
    select: { id: true, firstName: true, lastName: true, username: true, departmentId: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
  });
};
