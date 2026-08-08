import {
  AccountingFlagCategory,
  AccountingFlagSeverity,
  AccountingFlagStatus,
  AccountingPaymentMethod,
  AccountingRecordStatus,
  AccountingSourceKind,
  CheckAccountingStatus,
  ContractStatus,
  CorrectionRequestCategory,
  CorrectionRequestPriority,
  CorrectionRequestStatus,
  FinancialRecordKind,
  PaymentAccountingStatus,
  Prisma,
  PrismaClient,
  ReceivableStatus,
  TaxReadinessStatus,
  TaxSubmissionStatus
} from '@prisma/client';
import { classifyInvoiceStatus, isOpenInvoiceCandidate, isValidFinanciallyApprovedInvoice } from './accountingStatus';
import {
  ACTIVE_CORRECTION_STATUSES,
  ACCOUNTING_RECORD_STATUSES,
  accountingActivityPopulationWhere,
  authorizedAuditPopulationOrderBy,
  authorizedAuditPopulationWhere,
  correctionRequestPopulationWhere,
  invoiceCandidatePopulationWhere,
  orderReviewableContracts,
  resolveAccountingActivityPopulation,
  resolveActiveAccountantIds,
  resolveCorrectionRequestPopulation,
  resolveInvoiceCandidatePopulation,
  resolveTaxRecordPopulation,
  taxRecordPopulationWhere,
} from './accountingPopulations';

const prisma = new PrismaClient();

const ELIGIBLE_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.APPROVED,
  ContractStatus.SIGNED,
  ContractStatus.PRINTED
];

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_CURRENCY = 'ریال';

const activeCorrectionStatuses = () => [
  ...ACTIVE_CORRECTION_STATUSES
] as CorrectionRequestStatus[];

type Actor = {
  userId: string;
  role: string;
};

export type AccountingActionNotificationHook = (
  tx: Prisma.TransactionClient,
  context: {
    kind: string;
    contractId: string;
    contractNumber: string;
    recipientIds: string[];
    recordIdentity: string;
  },
) => Promise<void>;

const publishAccountingActionWithinTransaction = async (
  hook: AccountingActionNotificationHook | undefined,
  tx: Prisma.TransactionClient,
  kind: string,
  contract: any,
  recordIdentity: string,
) => {
  if (!hook) return;
  await hook(tx, {
    kind,
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    recipientIds: [...new Set([contract.createdBy, contract.responsibleSellerId].filter(Boolean))] as string[],
    recordIdentity,
  });
};

type ListContractsQuery = {
  view?: string;
  search?: string;
  status?: string;
  sourceStatus?: string;
  taxStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

type AccountingActionRequest = {
  kind: string;
  idempotencyKey?: string;
  contractId?: string;
  recordId?: string;
  invoiceId?: string;
  receivableId?: string;
  paymentEventId?: string;
  periodId?: string;
  note?: string;
  mode?: 'FROM_CONTRACT_TOTAL' | 'FROM_SELECTED_ITEMS' | 'FROM_DELIVERED_ITEMS' | 'MANUAL';
  selectedContractItemIds?: string[];
  issueDate?: string;
  dueDate?: string;
  amount?: string | number;
  receivedAt?: string;
  occurredAt?: string;
  method?: keyof typeof AccountingPaymentMethod;
  status?: string;
  readiness?: keyof typeof TaxReadinessStatus;
  missingFields?: string[];
  trackingCode?: string;
  submittedAt?: string;
  rejectionReason?: string;
  systemInvoiceNumber?: string;
  systemInvoiceDate?: string;
  sepidarAmount?: string | number;
  correctionRequestId?: string;
  flagId?: string;
  replacesRecordId?: string;
  externalReference?: string;
  downstreamNote?: string;
  resolutionNote?: string;
  category?: keyof typeof CorrectionRequestCategory | keyof typeof AccountingFlagCategory;
  priority?: keyof typeof CorrectionRequestPriority;
  severity?: keyof typeof AccountingFlagSeverity;
  reason?: string;
  requestedChange?: string;
  title?: string;
  check?: {
    checkNumber?: string;
    ownerName?: string;
    handoverDate?: string;
    dueDate?: string;
    nationalCode?: string;
  };
};

const toDecimal = (value: unknown, fallback = 0) => {
  if (value == null || value === '') return new Prisma.Decimal(fallback);
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    return new Prisma.Decimal(fallback);
  }
};

const decimalToString = (value: Prisma.Decimal | number | string | null | undefined) => {
  if (value == null) return '0';
  return new Prisma.Decimal(String(value)).toFixed(0);
};

const isTomanCurrency = (currency?: string | null) => {
  const normalized = String(currency || '').trim().toLowerCase();
  return normalized === 'تومان' || normalized === 'toman';
};

const toRialDecimal = (value: Prisma.Decimal | number | string | null | undefined, currency?: string | null) => {
  const amount = toDecimal(value);
  return isTomanCurrency(currency) ? amount.mul(10) : amount;
};

const amountsEqual = (left: Prisma.Decimal, right: Prisma.Decimal) => left.toFixed(0) === right.toFixed(0);

const metadataObject = (value: Prisma.JsonValue | null | undefined): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const getContractDateValue = (contract: any): Date | null => {
  const data = contract.contractData;
  const candidates = [
    data?.contractDate,
    data?.date,
    data?.contract?.date,
    contract.signedAt,
    contract.createdAt
  ].filter(Boolean);

  for (const value of candidates) {
    const parsed = parseContractDateCandidate(value);
    if (parsed) return parsed;
  }

  return null;
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseDate = (value: string | undefined, fallback: Date) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const normalizeDigits = (value: string) =>
  value
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

const jalaliToGregorianDate = (jy: number, jm: number, jd: number): Date | null => {
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;

  let jalaliYear = jy;
  let gregorianYear = 621;
  if (jalaliYear > 979) {
    gregorianYear = 1600;
    jalaliYear -= 979;
  }

  let days = (365 * jalaliYear) +
    Math.floor(jalaliYear / 33) * 8 +
    Math.floor(((jalaliYear % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);

  gregorianYear += 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gregorianYear += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }

  gregorianYear += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gregorianYear += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let dayOfYear = days + 1;
  const monthLengths = [
    0,
    31,
    (gregorianYear % 4 === 0 && gregorianYear % 100 !== 0) || gregorianYear % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  let gregorianMonth = 1;
  while (gregorianMonth <= 12 && dayOfYear > monthLengths[gregorianMonth]) {
    dayOfYear -= monthLengths[gregorianMonth];
    gregorianMonth++;
  }

  if (gregorianMonth > 12) return null;
  return new Date(Date.UTC(gregorianYear, gregorianMonth - 1, dayOfYear));
};

const parseContractDateCandidate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = normalizeDigits(String(value).trim());
  const dateMatch = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);

    if (year >= 1200 && year <= 1700) {
      return jalaliToGregorianDate(year, month, day);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTehranDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};

const dateKeyToUtcDay = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const parseBusinessDateKey = (value?: string) => {
  const normalized = normalizeDigits(String(value || '').trim());
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error('System invoice date is required');
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const validateSystemInvoiceDate = (value?: string) => {
  const dateKey = parseBusinessDateKey(value);
  const todayKey = getTehranDateKey(new Date());
  const invoiceDay = dateKeyToUtcDay(dateKey);
  const today = dateKeyToUtcDay(todayKey);
  const oldestAllowed = today - (10 * 24 * 60 * 60 * 1000);
  const newestAllowed = today + (30 * 24 * 60 * 60 * 1000);

  if (invoiceDay > newestAllowed) {
    throw new Error('System invoice date cannot be more than 30 days in the future');
  }
  if (invoiceDay < oldestAllowed) {
    throw new Error('System invoice date cannot be older than 10 days');
  }

  return new Date(`${dateKey}T00:00:00.000Z`);
};

const getCustomerName = (customer: { firstName?: string | null; lastName?: string | null; companyName?: string | null }) => {
  const personName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  return personName || customer.companyName || 'مشتری بدون نام';
};

const getContractAmount = (contract: { totalAmount?: Prisma.Decimal | null; items?: Array<{ totalPrice: Prisma.Decimal }> }) => {
  if (contract.totalAmount) return contract.totalAmount;
  return (contract.items || []).reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0));
};

const mapPaymentMethod = (method?: string | null): AccountingPaymentMethod => {
  if (method === 'CHECK') return AccountingPaymentMethod.CHECK;
  if (method === 'RECEIPT') return AccountingPaymentMethod.BANK_TRANSFER;
  return AccountingPaymentMethod.CASH;
};

const normalizeFinancialRecords = (records: Array<{
  id: string;
  kind: FinancialRecordKind;
  status: AccountingRecordStatus;
  amount: Prisma.Decimal;
  currency?: string | null;
  systemInvoiceNumber?: string | null;
  systemInvoiceDate?: Date | null;
  sepidarAmount?: Prisma.Decimal | null;
  financiallyApprovedAt?: Date | null;
  createdAt: Date;
}>) =>
  records.map((record) => ({
    id: record.id,
    kind: record.kind,
    status: record.status,
    amount: decimalToString(record.amount),
    currency: record.currency,
    systemInvoiceNumber: record.systemInvoiceNumber,
    systemInvoiceDate: record.systemInvoiceDate,
    sepidarAmount: record.sepidarAmount == null ? null : decimalToString(record.sepidarAmount),
    financiallyApprovedAt: record.financiallyApprovedAt,
    createdAt: record.createdAt
  }));

const getTaxMissingFields = (contract: any, settings: any) => {
  const missing: string[] = [];
  const customer = contract.customer || {};

  if (!settings?.companyEconomicCode) missing.push('کد اقتصادی شرکت');
  if (!settings?.companyNationalId) missing.push('شناسه ملی شرکت');
  if (!settings?.fiscalMemoryId) missing.push('شناسه یکتای حافظه مالیاتی');
  if (!customer.nationalCode) missing.push('کد ملی / شناسه ملی مشتری');
  if (!contract.items?.length) missing.push('اقلام قرارداد');

  return missing;
};

const getDefaultSettings = async () => {
  const existing = await prisma.accountingSetting.findFirst({
    orderBy: { createdAt: 'asc' }
  });

  if (existing) return existing;

  return prisma.accountingSetting.create({
    data: {
      requiredTaxFields: ['companyEconomicCode', 'companyNationalId', 'fiscalMemoryId', 'customerNationalCode', 'invoiceItems']
    }
  });
};

const isSubmittedTaxStatus = (status: TaxSubmissionStatus) => ([
  TaxSubmissionStatus.SUBMITTED_MANUALLY,
  TaxSubmissionStatus.SUBMITTED_EXTERNALLY,
  TaxSubmissionStatus.ACCEPTED,
  TaxSubmissionStatus.REJECTED,
  TaxSubmissionStatus.NEEDS_CORRECTION
] as TaxSubmissionStatus[]).includes(status);

const isReceivedPaymentStatus = (status: PaymentAccountingStatus) => ([
  PaymentAccountingStatus.RECEIVED,
  PaymentAccountingStatus.RECONCILED
] as PaymentAccountingStatus[]).includes(status);

const buildCorrectionReplacementWorkflow = (
  contractAmount: Prisma.Decimal,
  financialRecords: any[],
  receivables: any[],
  paymentEvents: any[],
  taxRecords: any[],
  correctionRequests: any[]
) => {
  const correction = correctionRequests.find((item) => item.status === CorrectionRequestStatus.SALES_EDITED);
  if (!correction) return null;

  const isReplacementForCorrection = (record: any) => {
    const metadata = metadataObject(record.metadata);
    return metadata.correctionRequestId === correction.id && metadata.replacesRecordId;
  };

  const sourceRecord = correction.recordId
    ? financialRecords.find((record) => record.id === correction.recordId)
    : financialRecords.find((record) => (
        record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
        record.financiallyApprovedAt &&
        !isReplacementForCorrection(record)
      ));

  if (!sourceRecord) {
    return {
      correctionRequestId: correction.id,
      status: 'NO_SOURCE_RECORD',
      amountChanged: false,
      correctedAmount: decimalToString(contractAmount),
      canResolve: false,
      blockingReasons: ['No approved source invoice was found for this correction']
    };
  }

  const replacementRecords = financialRecords.filter((record) => {
    const metadata = metadataObject(record.metadata);
    return (
      record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
      metadata.correctionRequestId === correction.id &&
      metadata.replacesRecordId === sourceRecord.id
    );
  });
  const replacementRecord = replacementRecords[0] || null;
  const amountChanged = !amountsEqual(toDecimal(sourceRecord.amount), contractAmount);
  const sourceReceivables = receivables.filter((item) => item.invoiceRecordId === sourceRecord.id);
  const sourceReceivableIds = new Set(sourceReceivables.map((item) => item.id));
  const sourcePayments = paymentEvents.filter((item) => item.receivableId && sourceReceivableIds.has(item.receivableId));
  const sourceTaxRecords = taxRecords.filter((item) => item.invoiceRecordId === sourceRecord.id);
  const hasReceivedPayments = sourcePayments.some((item) => isReceivedPaymentStatus(item.status));
  const hasSubmittedTax = sourceTaxRecords.some((item) => isSubmittedTaxStatus(item.submissionStatus));
  const openReceivables = sourceReceivables.filter((item) => item.status !== ReceivableStatus.VOIDED);
  const metadata = metadataObject(sourceRecord.metadata);
  const downstreamEvidencePresent = Boolean(metadata.downstreamCorrectionNote);

  const blockingReasons: string[] = [];
  if (amountChanged) {
    if (sourceRecord.status !== AccountingRecordStatus.VOIDED) {
      blockingReasons.push('Old approved invoice must be voided or reversed first');
    }
    if (sourceRecord.status === AccountingRecordStatus.VOIDED && !replacementRecord) {
      blockingReasons.push('Replacement invoice candidate must be created');
    }
    if (replacementRecord && !replacementRecord.financiallyApprovedAt) {
      blockingReasons.push('Replacement invoice candidate must be financially approved');
    }
    if ((hasReceivedPayments || hasSubmittedTax) && !downstreamEvidencePresent) {
      blockingReasons.push('Downstream payment or tax correction evidence is required');
    }
  }

  const nextStep = !amountChanged
    ? 'REVIEW_NO_AMOUNT_IMPACT'
    : sourceRecord.status !== AccountingRecordStatus.VOIDED
      ? 'VOID_SOURCE_RECORD'
      : !replacementRecord
        ? 'CREATE_REPLACEMENT'
        : !replacementRecord.financiallyApprovedAt
          ? 'APPROVE_REPLACEMENT'
          : blockingReasons.length > 0
            ? 'DOCUMENT_DOWNSTREAM'
            : 'READY_TO_RESOLVE';

  return {
    correctionRequestId: correction.id,
    sourceRecordId: sourceRecord.id,
    replacementRecordId: replacementRecord?.id || null,
    amountChanged,
    oldAmount: decimalToString(sourceRecord.amount),
    correctedAmount: decimalToString(contractAmount),
    sourceRecordStatus: sourceRecord.status,
    replacementRecordStatus: replacementRecord?.status || null,
    replacementFinanciallyApprovedAt: replacementRecord?.financiallyApprovedAt || null,
    nextStep,
    canVoidSource: amountChanged && sourceRecord.status !== AccountingRecordStatus.VOIDED,
    canCreateReplacement: amountChanged && sourceRecord.status === AccountingRecordStatus.VOIDED && !replacementRecord,
    canApproveReplacement: amountChanged && Boolean(replacementRecord) && !replacementRecord.financiallyApprovedAt,
    canResolve: amountChanged ? blockingReasons.length === 0 : true,
    hasReceivables: sourceReceivables.length > 0,
    hasReceivedPayments,
    hasSubmittedTax,
    openReceivableCount: openReceivables.length,
    blockingReasons
  };
};

const getOrCreateCurrentPeriod = async () => {
  const now = new Date();
  const code = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const existing = await prisma.accountingPeriod.findUnique({ where: { code } });
  if (existing) return existing;

  const startsAt = new Date(now.getFullYear(), now.getMonth(), 1);
  const endsAt = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return prisma.accountingPeriod.create({
    data: {
      code,
      title: `دوره ${code}`,
      startsAt,
      endsAt
    }
  });
};

const audit = async (tx: Prisma.TransactionClient | PrismaClient, data: {
  action: string;
  actorId: string;
  contractId?: string | null;
  recordId?: string | null;
  entityType?: string;
  entityId?: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  note?: string | null;
}) => {
  await tx.accountingAuditLog.create({
    data: {
      ...data,
      beforeState: data.beforeState ? toJsonValue(data.beforeState) : undefined,
      afterState: data.afterState ? toJsonValue(data.afterState) : undefined
    }
  });
};

const buildContractRow = async (contract: any, settings: any) => {
  const records = contract.accountingRecords || [];
  const receivables = contract.accountingReceivables || [];
  const payments = contract.accountingPayments || [];
  const taxRecords = contract.accountingTaxRecords || [];
  const corrections = contract.accountingCorrections || [];
  const flags = contract.accountingFlags || [];

  const contractAmount = toRialDecimal(getContractAmount(contract), contract.currency);
  const accountingDate = getContractDateValue(contract);
  const invoicedAmount = records
    .filter((record: any) => record.kind === FinancialRecordKind.INVOICE_CANDIDATE && record.status !== AccountingRecordStatus.VOIDED)
    .reduce((sum: Prisma.Decimal, record: any) => sum.plus(record.amount), new Prisma.Decimal(0));
  const receivedAmount = payments
    .filter((payment: any) => payment.status === PaymentAccountingStatus.RECEIVED || payment.status === PaymentAccountingStatus.RECONCILED)
    .reduce((sum: Prisma.Decimal, payment: any) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const remainingAmount = Prisma.Decimal.max(contractAmount.minus(receivedAmount), new Prisma.Decimal(0));
  const missingFields = getTaxMissingFields(contract, settings);
  const eligible = ELIGIBLE_CONTRACT_STATUSES.includes(contract.status);
  const openCorrections = corrections.filter((item: any) => activeCorrectionStatuses().includes(item.status));
  const openFlags = flags.filter((item: any) => item.status === 'OPEN');
  const issuedInvoices = records.filter(isValidFinanciallyApprovedInvoice);
  const openInvoiceCandidates = records.filter(isOpenInvoiceCandidate);
  const invoiceStatus = classifyInvoiceStatus(records);

  const overdueReceivables = receivables.filter((receivable: any) => (
    receivable.status !== ReceivableStatus.SETTLED &&
    receivable.status !== ReceivableStatus.VOIDED &&
    receivable.dueDate < new Date()
  ));

  const receivableStatus = receivables.length === 0
    ? 'NONE'
    : overdueReceivables.length > 0
      ? 'OVERDUE'
      : receivables.every((item: any) => item.status === ReceivableStatus.SETTLED)
        ? 'SETTLED'
        : receivables.some((item: any) => item.status === ReceivableStatus.PARTIALLY_PAID)
          ? 'PARTIALLY_PAID'
          : 'OPEN';

  const latestTax = taxRecords[0];
  const taxStatus = latestTax?.submissionStatus || (missingFields.length ? TaxSubmissionStatus.NOT_READY : TaxSubmissionStatus.READY);

  let sourceStatus = eligible ? 'ELIGIBLE' : 'VISIBLE_ONLY';
  if (openCorrections.length > 0) {
    sourceStatus = 'NEEDS_CORRECTION';
  } else if (issuedInvoices.length > 0) {
    sourceStatus = 'HAS_FINANCIAL_RECORDS';
  }

  const disabledReason = eligible ? undefined : 'فقط قراردادهای تایید شده، امضا شده یا چاپ شده قابل ثبت مالی هستند';
  const nextBestActions = [
    {
      kind: 'CREATE_INVOICE',
      labelFa: 'ایجاد پیش‌نویس صورتحساب',
      enabled: eligible,
      disabledReason
    },
    {
      kind: 'CREATE_RECEIVABLE',
      labelFa: 'ایجاد دریافتنی',
      enabled: eligible && issuedInvoices.length > 0,
      disabledReason: !eligible ? disabledReason : issuedInvoices.length === 0 ? 'ابتدا صورتحساب باید با شماره فاکتور سیستمی تایید مالی شود' : undefined
    },
    {
      kind: 'APPROVE_FINANCIAL_INVOICE',
      labelFa: 'تایید مالی',
      enabled: eligible && openInvoiceCandidates.length > 0,
      disabledReason: !eligible ? disabledReason : openInvoiceCandidates.length === 0 ? 'صورتحساب تایید نشده‌ای برای تایید مالی وجود ندارد' : undefined
    },
    {
      kind: 'MARK_TAX_READY',
      labelFa: 'بررسی آمادگی مالیاتی',
      enabled: eligible && records.length > 0,
      disabledReason: !eligible ? disabledReason : records.length === 0 ? 'ابتدا پیش‌نویس صورتحساب ایجاد شود' : undefined
    },
    {
      kind: 'REQUEST_CORRECTION',
      labelFa: 'درخواست اصلاح',
      enabled: true
    }
  ];

  return {
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    titlePersian: contract.titlePersian || contract.title || 'قرارداد فروش',
    createdAt: contract.createdAt,
    signedAt: contract.signedAt,
    contractDate: accountingDate,
    customer: {
      id: contract.customer?.id,
      displayName: getCustomerName(contract.customer || {}),
      nationalCode: contract.customer?.nationalCode,
      economicCode: contract.customer?.customFields?.economicCode
    },
    status: contract.status,
    accounting: {
      sourceStatus,
      eligibleForFinancialRecords: eligible,
      eligibilityReason: disabledReason,
      invoiceStatus,
      receivableStatus,
      taxStatus,
      openFlags: openFlags.length,
      openBlockerFlags: openFlags.filter((flag: any) => flag.severity === AccountingFlagSeverity.BLOCKER).length,
      openCorrections: openCorrections.length,
      totalContractAmount: decimalToString(contractAmount),
      invoicedAmount: decimalToString(invoicedAmount),
      receivedAmount: decimalToString(receivedAmount),
      remainingAmount: decimalToString(remainingAmount)
    },
    financialRecords: normalizeFinancialRecords(records),
    nextBestActions
  };
};

const getAccountingInclude = () => ({
  customer: true,
  items: { include: { product: true } },
  deliveries: { include: { products: true } },
  payments: { include: { installments: true } }
});

const attachAccountingCollections = async (contracts: any[]) => {
  const contractIds = contracts.map((contract) => contract.id);
  if (!contractIds.length) return contracts;

  const [records, receivables, payments, taxRecords, flags, corrections] = await Promise.all([
    prisma.accountingFinancialRecord.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.accountingReceivable.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { dueDate: 'asc' }
    }),
    prisma.accountingPaymentStatus.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: [{ checkDueDate: 'asc' }, { createdAt: 'desc' }]
    }),
    prisma.accountingTaxRecord.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.accountingContractFlag.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.accountingCorrectionRequest.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  return contracts.map((contract) => ({
    ...contract,
    accountingRecords: records.filter((record) => record.contractId === contract.id),
    accountingReceivables: receivables.filter((record) => record.contractId === contract.id),
    accountingPayments: payments.filter((record) => record.contractId === contract.id),
    accountingTaxRecords: taxRecords.filter((record) => record.contractId === contract.id),
    accountingFlags: flags.filter((record) => record.contractId === contract.id),
    accountingCorrections: corrections.filter((record) => record.contractId === contract.id)
  }));
};

export const buildAccountingSummaryForContracts = async (contracts: any[]) => {
  if (!contracts.length) return new Map<string, any>();

  const [settings, contractsWithAccounting] = await Promise.all([
    getDefaultSettings(),
    attachAccountingCollections(contracts)
  ]);
  const rows = await Promise.all(contractsWithAccounting.map((contract) => buildContractRow(contract, settings)));

  return new Map(rows.map((row) => [row.contractId, row.accounting]));
};

export const listAccountingContracts = async (query: ListContractsQuery = {}) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), 100);
  const skip = (page - 1) * pageSize;
  const search = query.search?.trim();

  const where: Prisma.SalesContractWhereInput = {};
  if (query.status && query.status !== 'ALL' && Object.values(ContractStatus).includes(query.status as ContractStatus)) {
    where.status = query.status as ContractStatus;
  }

  const reviewableView = !where.status && query.view === 'reviewable';
  const orderBy: Prisma.SalesContractOrderByWithRelationInput =
    reviewableView ? { createdAt: 'desc' } :
    query.sort === 'amount_desc' ? { totalAmount: 'desc' } :
    query.sort === 'amount_asc' ? { totalAmount: 'asc' } :
    query.sort === 'oldest' ? { createdAt: 'asc' } :
    { createdAt: 'desc' };

  const [rawContracts, settings] = await Promise.all([
    prisma.salesContract.findMany({
      where,
      include: getAccountingInclude(),
      orderBy
    }),
    getDefaultSettings()
  ]);

  const contracts = await attachAccountingCollections(rawContracts);
  let items = await Promise.all(contracts.map((contract) => buildContractRow(contract, settings)));

  if (search) {
    const lowered = search.toLowerCase();
    items = items.filter((item: any) => {
      const date = item.contractDate ? new Date(item.contractDate) : null;
      const dateParts = date && !Number.isNaN(date.getTime())
        ? [date.toISOString(), getTehranDateKey(date)]
        : [];
      const haystack = [
        item.contractNumber,
        item.titlePersian,
        item.customer?.displayName,
        item.customer?.nationalCode,
        item.customer?.economicCode,
        item.status,
        item.accounting?.sourceStatus,
        item.accounting?.invoiceStatus,
        item.accounting?.receivableStatus,
        item.accounting?.taxStatus,
        ...dateParts
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(lowered);
    });
  }

  if (query.sourceStatus && query.sourceStatus !== 'ALL') {
    items = items.filter((item) => query.sourceStatus === 'HAS_FINANCIAL_RECORDS'
      ? item.accounting.invoiceStatus === 'ISSUED'
      : item.accounting.sourceStatus === query.sourceStatus);
  }
  if (query.taxStatus && query.taxStatus !== 'ALL') {
    items = items.filter((item) => item.accounting.taxStatus === query.taxStatus);
  }
  if (query.dateFrom || query.dateTo) {
    const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom || '') ? query.dateFrom! : null;
    const toKey = /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo || '') ? query.dateTo! : null;

    if (fromKey || toKey) {
      items = items.filter((item: any) => {
        if (!item.contractDate) return false;
        const date = new Date(item.contractDate);
        if (Number.isNaN(date.getTime())) return false;
        const dateKey = getTehranDateKey(date);
        if (fromKey && dateKey < fromKey) return false;
        if (toKey && dateKey > toKey) return false;
        return true;
      });
    }
  }
  if (reviewableView || query.sort === 'attention') {
    items = orderReviewableContracts(items);
  }

  const total = items.length;
  const pagedItems = items.slice(skip, skip + pageSize);

  const totals = items.reduce((acc, item) => ({
    contractAmount: acc.contractAmount.plus(item.accounting.totalContractAmount),
    invoicedAmount: acc.invoicedAmount.plus(item.accounting.invoicedAmount),
    receivedAmount: acc.receivedAmount.plus(item.accounting.receivedAmount),
    remainingAmount: acc.remainingAmount.plus(item.accounting.remainingAmount)
  }), {
    contractAmount: new Prisma.Decimal(0),
    invoicedAmount: new Prisma.Decimal(0),
    receivedAmount: new Prisma.Decimal(0),
    remainingAmount: new Prisma.Decimal(0)
  });

  return {
    items: pagedItems,
    page,
    pageSize,
    total,
    totals: {
      contractAmount: decimalToString(totals.contractAmount),
      invoicedAmount: decimalToString(totals.invoicedAmount),
      receivedAmount: decimalToString(totals.receivedAmount),
      remainingAmount: decimalToString(totals.remainingAmount)
    }
  };
};

export const getAccountingWorkspace = async () => {
  const now = new Date();
  const [period, contractResponse, records, receivables, payments, taxRecords, corrections, auditLogs] = await Promise.all([
    getOrCreateCurrentPeriod(),
    listAccountingContracts({ view: 'reviewable', page: 1, pageSize: 12 }),
    prisma.accountingFinancialRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingReceivable.findMany({ orderBy: { dueDate: 'asc' }, take: 8 }),
    prisma.accountingPaymentStatus.findMany({ orderBy: [{ checkDueDate: 'asc' }, { createdAt: 'desc' }], take: 8 }),
    prisma.accountingTaxRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingCorrectionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  ]);

  const dueSoon = addDays(now, 7);
  const openReceivables = await prisma.accountingReceivable.findMany({
    where: { status: { in: [ReceivableStatus.OPEN, ReceivableStatus.PARTIALLY_PAID, ReceivableStatus.OVERDUE] } }
  });
  const checksDueSoon = await prisma.accountingPaymentStatus.findMany({
    where: {
      method: AccountingPaymentMethod.CHECK,
      checkDueDate: { lte: dueSoon },
      checkStatus: { in: [CheckAccountingStatus.RECEIVED, CheckAccountingStatus.DEPOSITED, CheckAccountingStatus.PENDING_HANDOVER] }
    }
  });
  const actionableInvoicePopulation = resolveInvoiceCandidatePopulation({ view: 'actionable' });
  const invoiceCandidates = await prisma.accountingFinancialRecord.findMany({
    where: invoiceCandidatePopulationWhere(actionableInvoicePopulation) as Prisma.AccountingFinancialRecordWhereInput
  });
  const taxAttentionPopulation = resolveTaxRecordPopulation({ view: 'needs-attention' });
  const activeCorrectionPopulation = resolveCorrectionRequestPopulation({ view: 'active' });
  const activityPopulation = resolveAccountingActivityPopulation({ view: 'last30days' }, now);
  const [taxNotReady, openCorrections, authorizedAuditCount, activeAccountantRows] = await Promise.all([
    prisma.accountingTaxRecord.findMany({
      where: taxRecordPopulationWhere(taxAttentionPopulation) as Prisma.AccountingTaxRecordWhereInput
    }),
    prisma.accountingCorrectionRequest.findMany({
      where: correctionRequestPopulationWhere(activeCorrectionPopulation) as Prisma.AccountingCorrectionRequestWhereInput
    }),
    prisma.accountingAuditLog.count({
      where: authorizedAuditPopulationWhere() as Prisma.AccountingAuditLogWhereInput
    }),
    prisma.accountingAuditLog.findMany({
      where: accountingActivityPopulationWhere(activityPopulation) as Prisma.AccountingAuditLogWhereInput,
      select: { actorId: true },
      distinct: ['actorId']
    })
  ]);

  return {
    period,
    commandCenter: {
      reviewableContracts: {
        count: contractResponse.total
      },
      approvedAndSignedContractValue: contractResponse.items
        .filter((item) => ELIGIBLE_CONTRACT_STATUSES.includes(item.status))
        .reduce((sum, item) => sum.plus(item.accounting.totalContractAmount), new Prisma.Decimal(0))
        .toFixed(0),
      openReceivables: {
        count: openReceivables.length,
        amount: decimalToString(openReceivables.reduce((sum, item) => sum.plus(item.remainingAmount), new Prisma.Decimal(0))),
        urgentCount: openReceivables.filter((item) => item.dueDate < now).length
      },
      checksDue: {
        count: checksDueSoon.length,
        amount: decimalToString(checksDueSoon.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0))),
        urgentCount: checksDueSoon.filter((item) => item.checkDueDate && item.checkDueDate < now).length
      },
      invoiceCandidates: {
        count: invoiceCandidates.length,
        amount: decimalToString(invoiceCandidates.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)))
      },
      taxNotReady: {
        count: taxNotReady.length,
        urgentCount: taxNotReady.filter((item) => item.submissionStatus === TaxSubmissionStatus.REJECTED).length
      },
      correctionRequests: {
        count: openCorrections.length,
        urgentCount: openCorrections.filter((item) => item.priority === CorrectionRequestPriority.URGENT || item.priority === CorrectionRequestPriority.HIGH).length
      },
      auditHistory: {
        count: authorizedAuditCount
      },
      accountantPerformance: {
        count: resolveActiveAccountantIds(activeAccountantRows).length
      }
    },
    queues: {
      contracts: contractResponse.items,
      invoiceCandidates: records.filter((record) => record.kind === FinancialRecordKind.INVOICE_CANDIDATE),
      receivables,
      payments,
      tax: taxRecords,
      corrections,
      audit: auditLogs
    }
  };
};

export const getAccountingContractDetail = async (contractId: string) => {
  const settings = await getDefaultSettings();
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: getAccountingInclude()
  });

  if (!contract) throw new Error('Contract not found');
  const [enriched] = await attachAccountingCollections([contract]);
  const row = await buildContractRow(enriched, settings);
  const [financialRecords, receivables, paymentEvents, tax, auditTrail, correctionRequests, flags] = await Promise.all([
    prisma.accountingFinancialRecord.findMany({ where: { contractId }, include: { invoiceItems: true }, orderBy: { createdAt: 'desc' } }),
    prisma.accountingReceivable.findMany({ where: { contractId }, orderBy: { dueDate: 'asc' } }),
    prisma.accountingPaymentStatus.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } }),
    prisma.accountingTaxRecord.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } }),
    prisma.accountingAuditLog.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } }),
    prisma.accountingCorrectionRequest.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } }),
    prisma.accountingContractFlag.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } })
  ]);
  const replacementWorkflow = buildCorrectionReplacementWorkflow(
    toRialDecimal(getContractAmount(contract), contract.currency),
    financialRecords,
    receivables,
    paymentEvents,
    tax,
    correctionRequests
  );

  return {
    contract: row,
    sourceSnapshot: {
      contractNumber: contract.contractNumber,
      status: contract.status,
      titlePersian: contract.titlePersian,
      totalAmount: decimalToString(toRialDecimal(getContractAmount(contract), contract.currency)),
      currency: DEFAULT_CURRENCY,
      items: contract.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.namePersian || item.product?.name || item.description || 'قلم قرارداد',
        quantity: decimalToString(item.quantity),
        unitPrice: decimalToString(toRialDecimal(item.unitPrice, contract.currency)),
        totalPrice: decimalToString(toRialDecimal(item.totalPrice, contract.currency))
      })),
      deliveries: contract.deliveries,
      salesPayments: contract.payments
    },
    financialRecords,
    receivables,
    paymentEvents,
    tax,
    flags,
    auditTrail,
    correctionRequests,
    replacementWorkflow,
    availableActions: row.nextBestActions
  };
};

const ensureEligibleContract = async (contractId: string) => {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: getAccountingInclude()
  });

  if (!contract) throw new Error('Contract not found');
  if (!ELIGIBLE_CONTRACT_STATUSES.includes(contract.status)) {
    throw new Error('Only approved, signed, or printed contracts can create accounting records');
  }
  return contract;
};

export const executeAccountingAction = async (
  command: AccountingActionRequest,
  actor: Actor,
  notificationHook?: AccountingActionNotificationHook,
) => {
  const period = command.periodId
    ? await prisma.accountingPeriod.findUnique({ where: { id: command.periodId } })
    : await getOrCreateCurrentPeriod();

  if (!period) throw new Error('Accounting period not found');

  switch (command.kind) {
    case 'CREATE_INVOICE':
      return createInvoiceCandidate(command, actor, period.id, notificationHook);
    case 'CREATE_REPLACEMENT_INVOICE':
      return createReplacementInvoiceCandidate(command, actor, period.id, notificationHook);
    case 'CREATE_RECEIVABLE':
      return createReceivable(command, actor, period.id, notificationHook);
    case 'APPROVE_FINANCIAL_INVOICE':
      return approveFinancialInvoice(command, actor, notificationHook);
    case 'REGISTER_RECEIPT':
      return registerReceipt(command, actor, notificationHook);
    case 'UPDATE_CHECK_STATUS':
      return updateCheckStatus(command, actor);
    case 'MARK_TAX_READY':
      return markTaxReady(command, actor);
    case 'TRACK_TAX_SUBMISSION':
      return trackTaxSubmission(command, actor);
    case 'REQUEST_CORRECTION':
      return requestCorrection(command, actor);
    case 'APPROVE_CORRECTION_FOR_SALES_EDIT':
      return approveCorrectionForSalesEdit(command, actor, notificationHook);
    case 'DECLINE_CORRECTION':
      return declineCorrectionRequest(command, actor);
    case 'FLAG_CONTRACT':
      return flagContract(command, actor);
    case 'RESOLVE_CONTRACT_FLAG':
      return closeContractFlag(command, actor, AccountingFlagStatus.RESOLVED);
    case 'CANCEL_CONTRACT_FLAG':
      return closeContractFlag(command, actor, AccountingFlagStatus.CANCELLED);
    case 'VOID_ACCOUNTING_RECORD':
      return voidAccountingRecord(command, actor);
    case 'DELETE_DRAFT_ACCOUNTING_RECORD':
      return deleteDraftAccountingRecord(command, actor);
    case 'RESOLVE_CORRECTION':
      return resolveCorrectionRequest(command, actor);
    default:
      throw new Error(`Unsupported accounting action: ${command.kind}`);
  }
};

const createInvoiceCandidate = async (command: AccountingActionRequest, actor: Actor, periodId: string, notificationHook?: AccountingActionNotificationHook) => {
  if (!command.contractId) throw new Error('contractId is required');
  const contract = await ensureEligibleContract(command.contractId);
  const settings = await getDefaultSettings();
  const idempotencyKey = command.idempotencyKey || `invoice-candidate:${contract.id}:${command.mode || 'FROM_CONTRACT_TOTAL'}`;
  const existing = await prisma.accountingFinancialRecord.findUnique({ where: { idempotencyKey } });
  if (existing) return actionResponse('APPLIED', 'پیش‌نویس صورتحساب قبلا ایجاد شده است', { financialRecordIds: [existing.id], contractId: contract.id });

  const selectedItems = command.mode === 'FROM_SELECTED_ITEMS' && command.selectedContractItemIds?.length
    ? contract.items.filter((item) => command.selectedContractItemIds!.includes(item.id))
    : contract.items;
  const amount = command.amount != null
    ? toDecimal(command.amount)
    : selectedItems.reduce((sum, item) => sum.plus(toRialDecimal(item.totalPrice, contract.currency)), new Prisma.Decimal(0));
  const missingFields = getTaxMissingFields(contract, settings);
  const vatRate = settings.defaultVatRate || new Prisma.Decimal(0);
  const vatAmount = amount.mul(vatRate).div(100);

  const record = await prisma.$transaction(async (tx) => {
    const invoice = await tx.accountingFinancialRecord.create({
      data: {
        kind: FinancialRecordKind.INVOICE_CANDIDATE,
        status: AccountingRecordStatus.DRAFT,
        sourceKind: AccountingSourceKind.SALES_CONTRACT,
        sourceId: contract.id,
        contractId: contract.id,
        customerId: contract.customerId,
        periodId,
        amount,
        currency: DEFAULT_CURRENCY,
        sourceSnapshot: toJsonValue(contract),
        metadata: {
          mode: command.mode || 'FROM_CONTRACT_TOTAL',
          issueDate: command.issueDate || new Date().toISOString(),
          dueDate: command.dueDate || addDays(new Date(), settings.defaultInvoiceDueDays).toISOString()
        },
        idempotencyKey,
        createdBy: actor.userId
      }
    });

    if (selectedItems.length > 0) {
      await tx.accountingInvoiceCandidateItem.createMany({
        data: selectedItems.map((item) => ({
          invoiceId: invoice.id,
          contractItemId: item.id,
          productId: item.productId,
          description: item.product?.namePersian || item.description || 'قلم قرارداد',
          quantity: item.quantity,
          unitPrice: toRialDecimal(item.unitPrice, contract.currency),
          totalPrice: toRialDecimal(item.totalPrice, contract.currency),
          taxRate: vatRate
        }))
      });
    }

    await tx.accountingTaxRecord.create({
      data: {
        invoiceRecordId: invoice.id,
        contractId: contract.id,
        readinessStatus: missingFields.length ? TaxReadinessStatus.MISSING_DATA : TaxReadinessStatus.READY,
        submissionStatus: missingFields.length ? TaxSubmissionStatus.NOT_READY : TaxSubmissionStatus.READY,
        taxableAmount: amount,
        vatRate,
        vatAmount,
        missingFields,
        createdBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'CREATE_INVOICE',
      actorId: actor.userId,
      contractId: contract.id,
      recordId: invoice.id,
      entityType: 'AccountingFinancialRecord',
      entityId: invoice.id,
      afterState: toJsonValue(invoice),
      note: command.note || null
    });

    await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, invoice.id);
    return invoice;
  });

  return actionResponse('APPLIED', 'پیش‌نویس صورتحساب ایجاد شد', { contractId: contract.id, financialRecordIds: [record.id] });
};

const createReplacementInvoiceCandidate = async (command: AccountingActionRequest, actor: Actor, periodId: string, notificationHook?: AccountingActionNotificationHook) => {
  if (!command.contractId) throw new Error('contractId is required');
  if (!command.correctionRequestId) throw new Error('correctionRequestId is required');
  if (!command.replacesRecordId) throw new Error('replacesRecordId is required');

  const contract = await ensureEligibleContract(command.contractId);
  const settings = await getDefaultSettings();
  const amount = toRialDecimal(getContractAmount(contract), contract.currency);
  const idempotencyKey = command.idempotencyKey || `replacement-invoice:${contract.id}:${command.correctionRequestId}`;
  const existing = await prisma.accountingFinancialRecord.findUnique({ where: { idempotencyKey } });
  if (existing) return actionResponse('APPLIED', 'Replacement invoice draft already exists', { financialRecordIds: [existing.id], contractId: contract.id });

  const correction = await prisma.accountingCorrectionRequest.findUnique({ where: { id: command.correctionRequestId } });
  if (!correction || correction.contractId !== contract.id) throw new Error('Correction request not found for this contract');
  if (correction.status !== CorrectionRequestStatus.SALES_EDITED) {
    throw new Error('Replacement invoices can only be created after sales saves the correction');
  }

  const sourceRecord = await prisma.accountingFinancialRecord.findUnique({ where: { id: command.replacesRecordId } });
  if (!sourceRecord || sourceRecord.contractId !== contract.id) throw new Error('Source financial record not found for this contract');
  if (!sourceRecord.financiallyApprovedAt) throw new Error('Replacement requires a financially approved source invoice');
  if (sourceRecord.status !== AccountingRecordStatus.VOIDED) throw new Error('Source invoice must be voided before creating a replacement');
  if (amountsEqual(toDecimal(sourceRecord.amount), amount)) {
    throw new Error('Replacement invoice is not required because the corrected amount did not change');
  }

  const duplicateReplacement = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId: contract.id,
      kind: FinancialRecordKind.INVOICE_CANDIDATE,
      metadata: {
        path: ['correctionRequestId'],
        equals: correction.id
      }
    }
  });
  if (duplicateReplacement) {
    return actionResponse('APPLIED', 'Replacement invoice draft already exists', { financialRecordIds: [duplicateReplacement.id], contractId: contract.id });
  }

  const missingFields = getTaxMissingFields(contract, settings);
  const vatRate = settings.defaultVatRate || new Prisma.Decimal(0);
  const vatAmount = amount.mul(vatRate).div(100);

  const record = await prisma.$transaction(async (tx) => {
    const invoice = await tx.accountingFinancialRecord.create({
      data: {
        kind: FinancialRecordKind.INVOICE_CANDIDATE,
        status: AccountingRecordStatus.DRAFT,
        sourceKind: AccountingSourceKind.SALES_CONTRACT,
        sourceId: contract.id,
        contractId: contract.id,
        customerId: contract.customerId,
        periodId,
        amount,
        currency: DEFAULT_CURRENCY,
        sourceSnapshot: toJsonValue(contract),
        metadata: {
          mode: 'REPLACEMENT_AFTER_CORRECTION',
          correctionRequestId: correction.id,
          replacesRecordId: sourceRecord.id,
          replacementReason: command.reason || command.note || correction.accountantNote,
          correctedContractAmount: decimalToString(amount),
          originalApprovedAmount: decimalToString(sourceRecord.amount),
          issueDate: command.issueDate || new Date().toISOString(),
          dueDate: command.dueDate || addDays(new Date(), settings.defaultInvoiceDueDays).toISOString()
        },
        idempotencyKey,
        createdBy: actor.userId
      }
    });

    if (contract.items.length > 0) {
      await tx.accountingInvoiceCandidateItem.createMany({
        data: contract.items.map((item) => ({
          invoiceId: invoice.id,
          contractItemId: item.id,
          productId: item.productId,
          description: item.product?.namePersian || item.description || 'Contract item',
          quantity: item.quantity,
          unitPrice: toRialDecimal(item.unitPrice, contract.currency),
          totalPrice: toRialDecimal(item.totalPrice, contract.currency),
          taxRate: vatRate
        }))
      });
    }

    await tx.accountingTaxRecord.create({
      data: {
        invoiceRecordId: invoice.id,
        contractId: contract.id,
        readinessStatus: missingFields.length ? TaxReadinessStatus.MISSING_DATA : TaxReadinessStatus.READY,
        submissionStatus: missingFields.length ? TaxSubmissionStatus.NOT_READY : TaxSubmissionStatus.READY,
        taxableAmount: amount,
        vatRate,
        vatAmount,
        missingFields,
        createdBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'CREATE_REPLACEMENT_INVOICE',
      actorId: actor.userId,
      contractId: contract.id,
      recordId: invoice.id,
      entityType: 'AccountingFinancialRecord',
      entityId: invoice.id,
      afterState: toJsonValue(invoice),
      note: command.note || null
    });

    await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, invoice.id);
    return invoice;
  });

  return actionResponse('APPLIED', 'Replacement invoice draft created', { contractId: contract.id, financialRecordIds: [record.id] });
};

const approveFinancialInvoice = async (command: AccountingActionRequest, actor: Actor, notificationHook?: AccountingActionNotificationHook) => {
  const invoiceId = command.invoiceId || command.recordId;
  if (!invoiceId) throw new Error('invoiceId is required');

  const systemInvoiceNumber = normalizeDigits(command.systemInvoiceNumber || '').trim();
  if (!systemInvoiceNumber) throw new Error('System invoice number is required');
  const systemInvoiceDate = validateSystemInvoiceDate(command.systemInvoiceDate);
  const sepidarAmount = toDecimal(command.sepidarAmount);
  if (sepidarAmount.lte(0)) throw new Error('Sepidar amount is required');

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingFinancialRecord.findUnique({ where: { id: invoiceId } });
    if (!before) throw new Error('Invoice record not found');
    if (before.kind !== FinancialRecordKind.INVOICE_CANDIDATE) {
      throw new Error('Only invoice records can be financially approved');
    }
    if (before.status === AccountingRecordStatus.ISSUED || before.status === AccountingRecordStatus.POSTED || before.financiallyApprovedAt) {
      throw new Error('Financially approved invoices are locked');
    }
    if (before.status === AccountingRecordStatus.VOIDED) {
      throw new Error('Voided invoices cannot be financially approved');
    }
    if (before.contractId) {
      const blockerFlag = await tx.accountingContractFlag.findFirst({
        where: { contractId: before.contractId, status: AccountingFlagStatus.OPEN, severity: AccountingFlagSeverity.BLOCKER }
      });
      if (blockerFlag) throw new Error('Open blocker flags must be closed before financial approval');
      const openCorrection = await tx.accountingCorrectionRequest.findFirst({
        where: {
          contractId: before.contractId,
          status: { in: activeCorrectionStatuses() }
        }
      });
      if (openCorrection) {
        const metadata = metadataObject(before.metadata);
        const isReplacementForOpenCorrection =
          openCorrection.status === CorrectionRequestStatus.SALES_EDITED &&
          metadata.correctionRequestId === openCorrection.id &&
          Boolean(metadata.replacesRecordId);
        if (!isReplacementForOpenCorrection) {
          throw new Error('Open correction requests must be resolved before financial approval');
        }
      }
    }
    if (!amountsEqual(sepidarAmount, before.amount)) {
      throw new Error('Sepidar amount must match the Sabalan invoice amount');
    }

    const duplicateRecords = await tx.accountingFinancialRecord.findMany({
      where: {
        systemInvoiceNumber,
        id: { not: invoiceId }
      }
    });
    const metadata = metadataObject(before.metadata);
    const replacedRecordId = typeof metadata.replacesRecordId === 'string' ? metadata.replacesRecordId : null;
    const replacementNumberSource = duplicateRecords.length === 1 ? duplicateRecords[0] : null;
    const isAllowedReplacementNumberReuse =
      Boolean(replacementNumberSource) &&
      replacedRecordId === replacementNumberSource?.id &&
      replacementNumberSource?.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
      replacementNumberSource?.status === AccountingRecordStatus.VOIDED;
    if (duplicateRecords.length > 0 && !isAllowedReplacementNumberReuse) {
      throw new Error('System invoice number is already used');
    }

    const updated = await tx.accountingFinancialRecord.update({
      where: { id: invoiceId },
      data: {
        status: AccountingRecordStatus.ISSUED,
        systemInvoiceNumber,
        systemInvoiceDate,
        sepidarAmount,
        financiallyApprovedAt: new Date(),
        financiallyApprovedBy: actor.userId,
        postedAt: new Date()
      }
    });

    const replacementNumberReuseNote = isAllowedReplacementNumberReuse && replacementNumberSource
      ? `Replacement invoice reused system invoice number ${systemInvoiceNumber} from voided source record ${replacementNumberSource.id}; replacement record ${updated.id} is linked by metadata.replacesRecordId. Reason: linked replacement invoice for a post-approval correction.`
      : null;

    await audit(tx, {
      action: 'APPROVE_FINANCIAL_INVOICE',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: updated.id,
      entityType: 'AccountingFinancialRecord',
      entityId: updated.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(updated),
      note: [command.note, replacementNumberReuseNote].filter(Boolean).join(' | ') || null
    });

    if (updated.contractId) {
      const contract = await tx.salesContract.findUnique({ where: { id: updated.contractId } });
      if (contract) await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, updated.id);
    }
    return updated;
  });

  return actionResponse('APPLIED', 'تایید مالی ثبت شد', { contractId: result.contractId || undefined, financialRecordIds: [result.id] });
};

const createReceivable = async (command: AccountingActionRequest, actor: Actor, periodId: string, notificationHook?: AccountingActionNotificationHook) => {
  if (!command.contractId) throw new Error('contractId is required');
  const contract = await ensureEligibleContract(command.contractId);
  const settings = await getDefaultSettings();
  const dueDate = parseDate(command.dueDate, addDays(new Date(), settings.defaultInvoiceDueDays));
  const issuedInvoiceWhere = {
    kind: FinancialRecordKind.INVOICE_CANDIDATE,
    status: { in: [AccountingRecordStatus.ISSUED, AccountingRecordStatus.POSTED] }
  };
  const sourceInvoice = command.invoiceId || command.recordId
    ? await prisma.accountingFinancialRecord.findFirst({
        where: {
          id: command.invoiceId || command.recordId,
          contractId: contract.id,
          ...issuedInvoiceWhere
        }
      })
    : await prisma.accountingFinancialRecord.findFirst({
        where: {
          contractId: contract.id,
          ...issuedInvoiceWhere
        },
        orderBy: { createdAt: 'desc' }
      });
  if (!sourceInvoice) {
    throw new Error('A financially approved issued invoice is required before creating receivables');
  }
  const amount = command.amount != null ? toDecimal(command.amount) : sourceInvoice?.amount || getContractAmount(contract);
  const idempotencyKey = command.idempotencyKey || `receivable:${contract.id}:${sourceInvoice?.id || 'contract'}`;
  const existingRecord = await prisma.accountingFinancialRecord.findUnique({ where: { idempotencyKey } });
  if (existingRecord) return actionResponse('APPLIED', 'دریافتنی قبلا ایجاد شده است', { financialRecordIds: [existingRecord.id], contractId: contract.id });

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.accountingFinancialRecord.create({
      data: {
        kind: FinancialRecordKind.RECEIVABLE,
        status: AccountingRecordStatus.READY,
        sourceKind: AccountingSourceKind.SALES_CONTRACT,
        sourceId: contract.id,
        contractId: contract.id,
        customerId: contract.customerId,
        periodId,
        amount,
        currency: DEFAULT_CURRENCY,
        sourceSnapshot: toJsonValue(contract),
        metadata: { invoiceRecordId: sourceInvoice?.id, dueDate: dueDate.toISOString() },
        idempotencyKey,
        createdBy: actor.userId
      }
    });

    const receivable = await tx.accountingReceivable.create({
      data: {
        contractId: contract.id,
        invoiceRecordId: sourceInvoice?.id || record.id,
        customerId: contract.customerId,
        originalAmount: amount,
        remainingAmount: amount,
        currency: DEFAULT_CURRENCY,
        dueDate,
        createdBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'CREATE_RECEIVABLE',
      actorId: actor.userId,
      contractId: contract.id,
      recordId: record.id,
      entityType: 'AccountingReceivable',
      entityId: receivable.id,
      afterState: toJsonValue(receivable),
      note: command.note || null
    });

    await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, record.id);
    return { record, receivable };
  });

  return actionResponse('APPLIED', 'دریافتنی ایجاد شد', { contractId: contract.id, financialRecordIds: [result.record.id], receivableIds: [result.receivable.id] });
};

const registerReceipt = async (command: AccountingActionRequest, actor: Actor, notificationHook?: AccountingActionNotificationHook) => {
  if (!command.contractId) throw new Error('contractId is required');
  const contract = await ensureEligibleContract(command.contractId);
  const method = command.method && command.method in AccountingPaymentMethod
    ? AccountingPaymentMethod[command.method as keyof typeof AccountingPaymentMethod]
    : AccountingPaymentMethod.CASH;
  const amount = toDecimal(command.amount);
  const occurredAt = parseDate(command.receivedAt || command.occurredAt, new Date());
  const status = method === AccountingPaymentMethod.CHECK ? PaymentAccountingStatus.RECEIVED : PaymentAccountingStatus.RECEIVED;
  const checkStatus = method === AccountingPaymentMethod.CHECK ? CheckAccountingStatus.RECEIVED : undefined;

  const payment = await prisma.$transaction(async (tx) => {
    const event = await tx.accountingPaymentStatus.create({
      data: {
        contractId: contract.id,
        receivableId: command.receivableId,
        method,
        amount,
        currency: DEFAULT_CURRENCY,
        status,
        checkStatus,
        checkNumber: command.check?.checkNumber,
        checkOwnerName: command.check?.ownerName,
        checkDueDate: command.check?.dueDate ? parseDate(command.check.dueDate, occurredAt) : undefined,
        handoverDate: command.check?.handoverDate ? parseDate(command.check.handoverDate, occurredAt) : undefined,
        occurredAt,
        notes: command.note,
        metadata: { nationalCode: command.check?.nationalCode },
        createdBy: actor.userId
      }
    });

    if (command.receivableId && method !== AccountingPaymentMethod.CHECK) {
      await applyReceivablePayment(tx, command.receivableId, amount);
    }

    await audit(tx, {
      action: 'REGISTER_RECEIPT',
      actorId: actor.userId,
      contractId: contract.id,
      entityType: 'AccountingPaymentStatus',
      entityId: event.id,
      afterState: toJsonValue(event),
      note: command.note || null
    });

    await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, event.id);
    return event;
  });

  return actionResponse('APPLIED', 'دریافت ثبت شد', { contractId: contract.id, paymentEventIds: [payment.id] });
};

const applyReceivablePayment = async (tx: Prisma.TransactionClient, receivableId: string, amount: Prisma.Decimal) => {
  const receivable = await tx.accountingReceivable.findUnique({ where: { id: receivableId } });
  if (!receivable) return;
  const paidAmount = receivable.paidAmount.plus(amount);
  const remainingAmount = Prisma.Decimal.max(receivable.originalAmount.minus(paidAmount), new Prisma.Decimal(0));
  await tx.accountingReceivable.update({
    where: { id: receivableId },
    data: {
      paidAmount,
      remainingAmount,
      status: remainingAmount.equals(0)
        ? ReceivableStatus.SETTLED
        : paidAmount.gt(0)
          ? ReceivableStatus.PARTIALLY_PAID
          : ReceivableStatus.OPEN
    }
  });
};

const updateCheckStatus = async (command: AccountingActionRequest, actor: Actor) => {
  if (!command.paymentEventId) throw new Error('paymentEventId is required');
  const checkStatus = command.status && command.status in CheckAccountingStatus
    ? CheckAccountingStatus[command.status as keyof typeof CheckAccountingStatus]
    : CheckAccountingStatus.RECEIVED;
  const occurredAt = parseDate(command.occurredAt, new Date());

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingPaymentStatus.findUnique({ where: { id: command.paymentEventId } });
    if (!before) throw new Error('Payment event not found');
    const payment = await tx.accountingPaymentStatus.update({
      where: { id: command.paymentEventId },
      data: {
        checkStatus,
        occurredAt,
        status: checkStatus === CheckAccountingStatus.CLEARED ? PaymentAccountingStatus.RECONCILED : before.status,
        notes: command.note || before.notes
      }
    });

    if (payment.receivableId && checkStatus === CheckAccountingStatus.CLEARED && before.checkStatus !== CheckAccountingStatus.CLEARED) {
      await applyReceivablePayment(tx, payment.receivableId, payment.amount);
    }

    await audit(tx, {
      action: 'UPDATE_CHECK_STATUS',
      actorId: actor.userId,
      contractId: payment.contractId,
      entityType: 'AccountingPaymentStatus',
      entityId: payment.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(payment),
      note: command.note || null
    });

    return payment;
  });

  return actionResponse('APPLIED', 'وضعیت چک به‌روزرسانی شد', { contractId: result.contractId || undefined, paymentEventIds: [result.id] });
};

const markTaxReady = async (command: AccountingActionRequest, actor: Actor) => {
  const invoiceId = command.invoiceId || command.recordId;
  if (!invoiceId) throw new Error('invoiceId is required');
  const readiness = command.readiness && command.readiness in TaxReadinessStatus
    ? TaxReadinessStatus[command.readiness as keyof typeof TaxReadinessStatus]
    : TaxReadinessStatus.READY;

  const tax = await prisma.$transaction(async (tx) => {
    const existing = await tx.accountingTaxRecord.findFirst({ where: { invoiceRecordId: invoiceId }, orderBy: { createdAt: 'desc' } });
    const record = existing
      ? await tx.accountingTaxRecord.update({
          where: { id: existing.id },
          data: {
            readinessStatus: readiness,
            submissionStatus: readiness === TaxReadinessStatus.READY ? TaxSubmissionStatus.READY : TaxSubmissionStatus.NOT_READY,
            missingFields: command.missingFields || []
          }
        })
      : await tx.accountingTaxRecord.create({
          data: {
            invoiceRecordId: invoiceId,
            readinessStatus: readiness,
            submissionStatus: readiness === TaxReadinessStatus.READY ? TaxSubmissionStatus.READY : TaxSubmissionStatus.NOT_READY,
            missingFields: command.missingFields || [],
            createdBy: actor.userId
          }
        });

    await audit(tx, {
      action: 'MARK_TAX_READY',
      actorId: actor.userId,
      contractId: record.contractId,
      recordId: invoiceId,
      entityType: 'AccountingTaxRecord',
      entityId: record.id,
      afterState: toJsonValue(record),
      note: command.note || null
    });

    return record;
  });

  return actionResponse('APPLIED', 'وضعیت آمادگی مالیاتی ثبت شد', { contractId: tax.contractId || undefined, financialRecordIds: [invoiceId] });
};

const trackTaxSubmission = async (command: AccountingActionRequest, actor: Actor) => {
  const invoiceId = command.invoiceId || command.recordId;
  if (!invoiceId) throw new Error('invoiceId is required');
  const statusMap: Record<string, TaxSubmissionStatus> = {
    SUBMITTED: TaxSubmissionStatus.SUBMITTED_MANUALLY,
    SUBMITTED_MANUALLY: TaxSubmissionStatus.SUBMITTED_MANUALLY,
    SUBMITTED_EXTERNALLY: TaxSubmissionStatus.SUBMITTED_EXTERNALLY,
    ACCEPTED: TaxSubmissionStatus.ACCEPTED,
    REJECTED: TaxSubmissionStatus.REJECTED,
    NEEDS_CORRECTION: TaxSubmissionStatus.NEEDS_CORRECTION
  };
  const submissionStatus = statusMap[command.status || 'SUBMITTED'] || TaxSubmissionStatus.SUBMITTED_MANUALLY;
  const now = new Date();

  const tax = await prisma.$transaction(async (tx) => {
    const existing = await tx.accountingTaxRecord.findFirst({ where: { invoiceRecordId: invoiceId }, orderBy: { createdAt: 'desc' } });
    if (!existing) throw new Error('Tax record not found');
    const updated = await tx.accountingTaxRecord.update({
      where: { id: existing.id },
      data: {
        submissionStatus,
        trackingCode: command.trackingCode || existing.trackingCode,
        submittedAt: submissionStatus === TaxSubmissionStatus.SUBMITTED_MANUALLY || submissionStatus === TaxSubmissionStatus.SUBMITTED_EXTERNALLY ? parseDate(command.submittedAt, now) : existing.submittedAt,
        acceptedAt: submissionStatus === TaxSubmissionStatus.ACCEPTED ? now : existing.acceptedAt,
        rejectedAt: submissionStatus === TaxSubmissionStatus.REJECTED ? now : existing.rejectedAt,
        rejectionReason: command.rejectionReason || existing.rejectionReason,
        notes: command.note || existing.notes
      }
    });

    await audit(tx, {
      action: 'TRACK_TAX_SUBMISSION',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: invoiceId,
      entityType: 'AccountingTaxRecord',
      entityId: updated.id,
      beforeState: toJsonValue(existing),
      afterState: toJsonValue(updated),
      note: command.note || null
    });

    return updated;
  });

  return actionResponse('APPLIED', 'وضعیت سامانه مودیان به‌روزرسانی شد', { contractId: tax.contractId || undefined, financialRecordIds: [invoiceId] });
};

const requestCorrection = async (command: AccountingActionRequest, actor: Actor) => {
  if (!command.contractId) throw new Error('contractId is required');
  const correction = await prisma.$transaction(async (tx) => {
    const activeRequest = await tx.accountingCorrectionRequest.findFirst({
      where: {
        contractId: command.contractId,
        status: { in: activeCorrectionStatuses() }
      },
      select: { id: true }
    });
    if (activeRequest) {
      throw new Error('An active correction request already exists for this contract');
    }

    const item = await tx.accountingCorrectionRequest.create({
      data: {
        contractId: command.contractId,
        recordId: command.recordId,
        category: command.category && command.category in CorrectionRequestCategory
          ? CorrectionRequestCategory[command.category as keyof typeof CorrectionRequestCategory]
          : CorrectionRequestCategory.OTHER,
        priority: command.priority && command.priority in CorrectionRequestPriority
          ? CorrectionRequestPriority[command.priority as keyof typeof CorrectionRequestPriority]
          : CorrectionRequestPriority.MEDIUM,
        accountantNote: command.reason || command.requestedChange || command.note || 'درخواست اصلاح حسابداری',
        createdBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'REQUEST_CORRECTION',
      actorId: actor.userId,
      contractId: command.contractId,
      recordId: command.recordId,
      entityType: 'AccountingCorrectionRequest',
      entityId: item.id,
      afterState: toJsonValue(item),
      note: command.note || null
    });

    return item;
  });

  return actionResponse('APPLIED', 'درخواست اصلاح ثبت شد', { contractId: correction.contractId || undefined });
};

const approveCorrectionForSalesEdit = async (command: AccountingActionRequest, actor: Actor, notificationHook?: AccountingActionNotificationHook) => {
  const correctionRequestId = command.correctionRequestId || command.recordId;
  if (!correctionRequestId) throw new Error('correctionRequestId is required');

  const correction = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingCorrectionRequest.findUnique({ where: { id: correctionRequestId } });
    if (!before) throw new Error('Correction request not found');
    if (before.status !== CorrectionRequestStatus.OPEN && before.status !== CorrectionRequestStatus.ACKNOWLEDGED) {
      throw new Error('Only open correction requests can be approved for sales edit');
    }
    if (!before.contractId) throw new Error('Correction request is not linked to a contract');

    const otherActive = await tx.accountingCorrectionRequest.findFirst({
      where: {
        contractId: before.contractId,
        id: { not: before.id },
        status: { in: activeCorrectionStatuses() }
      },
      select: { id: true }
    });
    if (otherActive) throw new Error('Another active correction request already exists for this contract');

    const updated = await tx.accountingCorrectionRequest.update({
      where: { id: correctionRequestId },
      data: {
        status: CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT,
        resolutionNote: command.note || command.resolutionNote || before.resolutionNote
      }
    });

    await audit(tx, {
      action: 'APPROVE_CORRECTION_FOR_SALES_EDIT',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: updated.recordId,
      entityType: 'AccountingCorrectionRequest',
      entityId: updated.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(updated),
      note: command.note || command.resolutionNote || null
    });

    const contract = await tx.salesContract.findUnique({ where: { id: updated.contractId! } });
    if (contract) await publishAccountingActionWithinTransaction(notificationHook, tx, command.kind, contract, updated.id);
    return updated;
  });

  return actionResponse('APPLIED', 'درخواست اصلاح برای ویرایش فروش تایید شد', { contractId: correction.contractId || undefined });
};

const declineCorrectionRequest = async (command: AccountingActionRequest, actor: Actor) => {
  const correctionRequestId = command.correctionRequestId || command.recordId;
  if (!correctionRequestId) throw new Error('correctionRequestId is required');
  const declineNote = String(command.resolutionNote || command.note || '').trim();
  if (!declineNote) throw new Error('Decline note is required');

  const correction = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingCorrectionRequest.findUnique({ where: { id: correctionRequestId } });
    if (!before) throw new Error('Correction request not found');
    if (before.status === CorrectionRequestStatus.RESOLVED) throw new Error('Resolved correction requests cannot be declined');
    if (before.status === CorrectionRequestStatus.CANCELLED) return before;
    if (before.status === CorrectionRequestStatus.SALES_EDITED) {
      throw new Error('Correction requests already edited by sales cannot be declined');
    }

    const updated = await tx.accountingCorrectionRequest.update({
      where: { id: correctionRequestId },
      data: {
        status: CorrectionRequestStatus.CANCELLED,
        resolutionNote: declineNote,
        resolvedBy: actor.userId,
        resolvedAt: new Date()
      }
    });

    await audit(tx, {
      action: 'DECLINE_CORRECTION',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: updated.recordId,
      entityType: 'AccountingCorrectionRequest',
      entityId: updated.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(updated),
      note: declineNote
    });

    return updated;
  });

  return actionResponse('APPLIED', 'درخواست اصلاح رد شد', { contractId: correction.contractId || undefined });
};

const resolveCorrectionRequest = async (command: AccountingActionRequest, actor: Actor) => {
  const correctionRequestId = command.correctionRequestId || command.recordId;
  if (!correctionRequestId) throw new Error('correctionRequestId is required');

  const correction = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingCorrectionRequest.findUnique({ where: { id: correctionRequestId } });
    if (!before) throw new Error('Correction request not found');
    if (before.status === CorrectionRequestStatus.RESOLVED) {
      return before;
    }
    if (before.status === CorrectionRequestStatus.CANCELLED) {
      throw new Error('Cancelled correction requests cannot be resolved');
    }
    if (before.status === CorrectionRequestStatus.OPEN || before.status === CorrectionRequestStatus.ACKNOWLEDGED) {
      throw new Error('Correction requests must be approved and edited before they can be resolved');
    }
    if (before.status === CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT) {
      throw new Error('Sales must save the correction before accounting can resolve it');
    }
    if (before.status === CorrectionRequestStatus.SALES_EDITED && before.contractId) {
      const contract = await tx.salesContract.findUnique({
        where: { id: before.contractId },
        include: getAccountingInclude()
      });
      if (!contract) throw new Error('Contract not found');
      const [financialRecords, receivables, paymentEvents, taxRecords, correctionRequests] = await Promise.all([
        tx.accountingFinancialRecord.findMany({ where: { contractId: before.contractId }, orderBy: { createdAt: 'desc' } }),
        tx.accountingReceivable.findMany({ where: { contractId: before.contractId } }),
        tx.accountingPaymentStatus.findMany({ where: { contractId: before.contractId } }),
        tx.accountingTaxRecord.findMany({ where: { contractId: before.contractId } }),
        tx.accountingCorrectionRequest.findMany({ where: { contractId: before.contractId }, orderBy: { createdAt: 'desc' } })
      ]);
      const workflow = buildCorrectionReplacementWorkflow(
        toRialDecimal(getContractAmount(contract), contract.currency),
        financialRecords,
        receivables,
        paymentEvents,
        taxRecords,
        correctionRequests
      );
      if (workflow && !workflow.canResolve) {
        throw new Error(`Correction cannot be resolved yet: ${workflow.blockingReasons.join('; ')}`);
      }
    }

    const updated = await tx.accountingCorrectionRequest.update({
      where: { id: correctionRequestId },
      data: {
        status: CorrectionRequestStatus.RESOLVED,
        resolutionNote: command.resolutionNote || command.note || before.resolutionNote,
        resolvedBy: actor.userId,
        resolvedAt: new Date()
      }
    });

    await audit(tx, {
      action: 'RESOLVE_CORRECTION',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: updated.recordId,
      entityType: 'AccountingCorrectionRequest',
      entityId: updated.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(updated),
      note: command.note || command.resolutionNote || null
    });

    return updated;
  });

  return actionResponse('APPLIED', 'درخواست اصلاح بسته شد', { contractId: correction.contractId || undefined });
};

const flagContract = async (command: AccountingActionRequest, actor: Actor) => {
  if (!command.contractId) throw new Error('contractId is required');
  const flag = await prisma.$transaction(async (tx) => {
    const item = await tx.accountingContractFlag.create({
      data: {
        contractId: command.contractId!,
        category: command.category && command.category in AccountingFlagCategory
          ? AccountingFlagCategory[command.category as keyof typeof AccountingFlagCategory]
          : AccountingFlagCategory.OTHER,
        severity: command.severity && command.severity in AccountingFlagSeverity
          ? AccountingFlagSeverity[command.severity as keyof typeof AccountingFlagSeverity]
          : AccountingFlagSeverity.MEDIUM,
        title: command.title || 'پرچم حسابداری',
        note: command.note,
        createdBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'FLAG_CONTRACT',
      actorId: actor.userId,
      contractId: command.contractId,
      entityType: 'AccountingContractFlag',
      entityId: item.id,
      afterState: toJsonValue(item),
      note: command.note || null
    });

    return item;
  });

  return actionResponse('APPLIED', 'پرچم حسابداری ثبت شد', { contractId: flag.contractId });
};

const closeContractFlag = async (command: AccountingActionRequest, actor: Actor, status: AccountingFlagStatus) => {
  if (!command.flagId) throw new Error('flagId is required');
  const reason = String(status === AccountingFlagStatus.RESOLVED ? (command.resolutionNote || command.note || '') : (command.reason || command.note || '')).trim();
  if (!reason) throw new Error(status === AccountingFlagStatus.RESOLVED ? 'Resolution note is required' : 'Cancellation reason is required');
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingContractFlag.findUnique({ where: { id: command.flagId } });
    if (!before) throw new Error('Accounting flag not found');
    if (before.status !== AccountingFlagStatus.OPEN) throw new Error('Only open flags can be closed or cancelled');
    const now = new Date();
    const item = await tx.accountingContractFlag.update({
      where: { id: before.id },
      data: status === AccountingFlagStatus.RESOLVED
        ? { status, resolutionNote: reason, resolvedBy: actor.userId, resolvedAt: now }
        : { status, cancellationReason: reason, cancelledBy: actor.userId, cancelledAt: now }
    });
    await audit(tx, {
      action: status === AccountingFlagStatus.RESOLVED ? 'RESOLVE_CONTRACT_FLAG' : 'CANCEL_CONTRACT_FLAG',
      actorId: actor.userId, contractId: before.contractId, entityType: 'AccountingContractFlag', entityId: before.id,
      beforeState: toJsonValue(before), afterState: toJsonValue(item), note: reason
    });
    return item;
  });
  return actionResponse('APPLIED', status === AccountingFlagStatus.RESOLVED ? 'پرچم بسته شد' : 'پرچم لغو شد', { contractId: updated.contractId });
};

const voidAccountingRecord = async (command: AccountingActionRequest, actor: Actor) => {
  const recordId = command.recordId || command.invoiceId;
  if (!recordId) throw new Error('recordId is required');
  const voidReason = String(command.reason || command.note || '').trim();
  const externalReference = String(command.externalReference || '').trim();
  const downstreamNote = String(command.downstreamNote || '').trim();
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingFinancialRecord.findUnique({
      where: { id: recordId },
      include: {
        receivables: true,
        taxRecords: true
      }
    });
    if (!before) throw new Error('Accounting record not found');
    if (before.status === AccountingRecordStatus.VOIDED) return before;
    if (before.kind !== FinancialRecordKind.INVOICE_CANDIDATE) {
      throw new Error('Only invoice records can be voided from this workflow');
    }
    if (before.financiallyApprovedAt || before.systemInvoiceNumber) {
      if (!voidReason) throw new Error('Void reason is required for approved accounting records');
      if (!externalReference) throw new Error('External cancellation or reversal reference is required');
    }
    const receivableIds = before.receivables.map((item) => item.id);
    const payments = receivableIds.length
      ? await tx.accountingPaymentStatus.findMany({ where: { receivableId: { in: receivableIds } } })
      : [];
    const hasReceivedPayments = payments.some((item) => isReceivedPaymentStatus(item.status));
    const hasSubmittedTax = before.taxRecords.some((item) => isSubmittedTaxStatus(item.submissionStatus));
    if ((hasReceivedPayments || hasSubmittedTax) && !downstreamNote) {
      throw new Error('Downstream payment or tax correction evidence is required before voiding this record');
    }
    const unsafeReceivables = before.receivables.filter((item) => (
      item.status === ReceivableStatus.PARTIALLY_PAID ||
      item.status === ReceivableStatus.SETTLED ||
      item.paidAmount.gt(0)
    ));
    if (unsafeReceivables.length > 0 && !downstreamNote) {
      throw new Error('Paid receivables require downstream correction evidence before voiding this record');
    }

    await tx.accountingReceivable.updateMany({
      where: {
        invoiceRecordId: before.id,
        paidAmount: new Prisma.Decimal(0),
        status: { in: [ReceivableStatus.OPEN, ReceivableStatus.OVERDUE] }
      },
      data: {
        status: ReceivableStatus.VOIDED,
        metadata: {
          voidedWithInvoiceRecordId: before.id,
          voidReason,
          externalVoidReference: externalReference || null
        }
      }
    });

    const beforeMetadata = metadataObject(before.metadata);
    const record = await tx.accountingFinancialRecord.update({
      where: { id: recordId },
      data: {
        status: AccountingRecordStatus.VOIDED,
        voidedAt: new Date(),
        metadata: {
          ...beforeMetadata,
          voidReason: voidReason || beforeMetadata.voidReason,
          externalVoidReference: externalReference || beforeMetadata.externalVoidReference,
          downstreamCorrectionNote: downstreamNote || beforeMetadata.downstreamCorrectionNote
        }
      }
    });
    await audit(tx, {
      action: 'VOID_ACCOUNTING_RECORD',
      actorId: actor.userId,
      contractId: record.contractId,
      recordId: record.id,
      entityType: 'AccountingFinancialRecord',
      entityId: record.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(record),
      note: voidReason || null
    });
    return record;
  });

  return actionResponse('APPLIED', 'رکورد حسابداری باطل شد', { contractId: result.contractId || undefined, financialRecordIds: [result.id] });
};

const deleteDraftAccountingRecord = async (command: AccountingActionRequest, actor: Actor) => {
  const recordId = command.recordId || command.invoiceId;
  if (!recordId) throw new Error('recordId is required');

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingFinancialRecord.findUnique({
      where: { id: recordId },
      include: {
        invoiceItems: true,
        taxRecords: true,
        receivables: true,
        journalVouchers: true
      }
    });
    if (!before) throw new Error('Accounting record not found');
    if (before.status !== AccountingRecordStatus.DRAFT || before.financiallyApprovedAt || before.systemInvoiceNumber || before.postedAt) {
      throw new Error('Only unsubmitted draft accounting records can be deleted');
    }
    if (before.receivables.length > 0 || before.journalVouchers.length > 0) {
      throw new Error('Draft accounting records with downstream accounting entries cannot be deleted');
    }

    await tx.accountingInvoiceCandidateItem.deleteMany({ where: { invoiceId: before.id } });
    await tx.accountingTaxRecord.deleteMany({ where: { invoiceRecordId: before.id } });
    await tx.accountingFinancialRecord.delete({ where: { id: before.id } });

    await audit(tx, {
      action: 'DELETE_DRAFT_ACCOUNTING_RECORD',
      actorId: actor.userId,
      contractId: before.contractId,
      recordId: before.id,
      entityType: 'AccountingFinancialRecord',
      entityId: before.id,
      beforeState: toJsonValue(before),
      note: command.note || null
    });

    return before;
  });

  return actionResponse('APPLIED', 'پیش‌نویس رکورد مالی حذف شد', { contractId: result.contractId || undefined, financialRecordIds: [result.id] });
};

const actionResponse = (status: 'APPLIED' | 'REJECTED' | 'NEEDS_CONFIRMATION', messageFa: string, affected: Record<string, unknown>) => ({
  actionId: `act_${Date.now()}`,
  status,
  messageFa,
  affected
});

const getPagination = (query: any = {}) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || query.limit) || DEFAULT_PAGE_SIZE, 1), 200);
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const dateRangeFilter = (query: any, field: string) => {
  const range: Record<string, Date> = {};
  if (query.dateFrom) {
    const from = new Date(String(query.dateFrom));
    if (!Number.isNaN(from.getTime())) range.gte = from;
  }
  if (query.dateTo) {
    const to = new Date(String(query.dateTo));
    if (!Number.isNaN(to.getTime())) range.lte = to;
  }
  return Object.keys(range).length ? { [field]: range } : {};
};

const getActorMap = async (ids: string[]) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, { id: string; displayName: string; username: string }>();
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, firstName: true, lastName: true, username: true }
  });
  return new Map(users.map((user) => [
    user.id,
    {
      id: user.id,
      displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      username: user.username
    }
  ]));
};

const getContractContextMap = async (contractIds: string[]) => {
  const uniqueIds = [...new Set(contractIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, any>();
  const contracts = await prisma.salesContract.findMany({
    where: { id: { in: uniqueIds } },
    include: { customer: true }
  });
  return new Map(contracts.map((contract) => [
    contract.id,
    {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      titlePersian: contract.titlePersian || contract.title,
      status: contract.status,
      createdAt: contract.createdAt,
      customer: {
        id: contract.customer?.id,
        displayName: getCustomerName(contract.customer || {}),
        nationalCode: contract.customer?.nationalCode
      }
    }
  ]));
};

const attachListContext = async <T extends { contractId?: string | null; createdBy?: string | null; actorId?: string | null; resolvedBy?: string | null }>(rows: T[]) => {
  const contractMap = await getContractContextMap(rows.map((row) => row.contractId).filter(Boolean) as string[]);
  const actorMap = await getActorMap(rows.flatMap((row) => [row.createdBy, row.actorId, row.resolvedBy].filter(Boolean) as string[]));
  return rows.map((row) => ({
    ...row,
    contract: row.contractId ? contractMap.get(row.contractId) || null : null,
    actor: row.actorId ? actorMap.get(row.actorId) || null : null,
    createdByUser: row.createdBy ? actorMap.get(row.createdBy) || null : null,
    resolvedByUser: row.resolvedBy ? actorMap.get(row.resolvedBy) || null : null
  }));
};

const searchContractIds = async (search?: string) => {
  const normalized = String(search || '').trim();
  if (!normalized) return undefined;
  const contracts = await prisma.salesContract.findMany({
    where: {
      OR: [
        { contractNumber: { contains: normalized, mode: 'insensitive' } },
        { title: { contains: normalized, mode: 'insensitive' } },
        { titlePersian: { contains: normalized, mode: 'insensitive' } },
        { customer: { firstName: { contains: normalized, mode: 'insensitive' } } },
        { customer: { lastName: { contains: normalized, mode: 'insensitive' } } },
        { customer: { companyName: { contains: normalized, mode: 'insensitive' } } },
        { customer: { nationalCode: { contains: normalized, mode: 'insensitive' } } }
      ]
    },
    select: { id: true }
  });
  return contracts.map((contract) => contract.id);
};

const applyContractSearch = async (where: { contractId?: any }, query: any) => {
  const contractIds = await searchContractIds(query.search);
  if (!contractIds) return true;
  if (!contractIds.length) return false;
  where.contractId = { in: contractIds };
  return true;
};

export const listFinancialRecords = async (query: any = {}) => {
  const where: Prisma.AccountingFinancialRecordWhereInput = {};
  const isInvoiceCandidateQuery = query.kind === FinancialRecordKind.INVOICE_CANDIDATE
    || query.view === 'actionable'
    || query.view === 'invoiced';
  if (isInvoiceCandidateQuery) {
    const population = resolveInvoiceCandidatePopulation({
      view: query.view,
      status: query.status,
      period: query.period,
    });
    Object.assign(
      where,
      invoiceCandidatePopulationWhere(population) as Prisma.AccountingFinancialRecordWhereInput,
    );
  } else {
    if (query.kind && query.kind !== 'ALL') where.kind = query.kind;
    if (
      query.status
      && query.status !== 'ALL'
      && (ACCOUNTING_RECORD_STATUSES as readonly string[]).includes(String(query.status))
    ) where.status = query.status;
  }
  if (query.contractId) where.contractId = query.contractId;
  Object.assign(where, dateRangeFilter(query, 'createdAt'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingFinancialRecord.findMany({
      where,
      include: { invoiceItems: true, taxRecords: true, receivables: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.accountingFinancialRecord.count({ where })
  ]);
  return {
    items: await attachListContext(rows),
    page,
    pageSize,
    total
  };
};

export const listReceivables = async (query: any = {}) => {
  const where: Prisma.AccountingReceivableWhereInput = {};
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.contractId) where.contractId = query.contractId;
  Object.assign(where, dateRangeFilter(query, 'dueDate'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingReceivable.findMany({
      where,
      include: { paymentStatuses: true },
      orderBy: { dueDate: 'asc' },
      skip,
      take: pageSize
    }),
    prisma.accountingReceivable.count({ where })
  ]);
  return { items: await attachListContext(rows), page, pageSize, total };
};

export const listPaymentStatuses = async (query: any = {}) => {
  const where: Prisma.AccountingPaymentStatusWhereInput = {};
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.checkStatus && query.checkStatus !== 'ALL') where.checkStatus = query.checkStatus;
  if (query.method && query.method !== 'ALL') where.method = query.method;
  if (query.contractId) where.contractId = query.contractId;
  Object.assign(where, dateRangeFilter(query, 'createdAt'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingPaymentStatus.findMany({
      where,
      orderBy: [{ checkDueDate: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: pageSize
    }),
    prisma.accountingPaymentStatus.count({ where })
  ]);
  return { items: await attachListContext(rows), page, pageSize, total };
};

export const listTaxRecords = async (query: any = {}) => {
  const population = resolveTaxRecordPopulation({ view: query.view, status: query.status || query.submissionStatus });
  const where = taxRecordPopulationWhere(population) as Prisma.AccountingTaxRecordWhereInput;
  if (query.readinessStatus && query.readinessStatus !== 'ALL') where.readinessStatus = query.readinessStatus;
  if (query.contractId) where.contractId = query.contractId;
  Object.assign(where, dateRangeFilter(query, 'updatedAt'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingTaxRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.accountingTaxRecord.count({ where })
  ]);
  return { items: await attachListContext(rows), page, pageSize, total };
};

export const listCorrectionRequests = async (query: any = {}) => {
  const population = resolveCorrectionRequestPopulation(query);
  const where = correctionRequestPopulationWhere(population) as Prisma.AccountingCorrectionRequestWhereInput;
  if (query.priority && query.priority !== 'ALL') where.priority = query.priority;
  if (query.contractId) where.contractId = query.contractId;
  Object.assign(where, dateRangeFilter(query, 'createdAt'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingCorrectionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.accountingCorrectionRequest.count({ where })
  ]);
  const enrichedRows = await attachListContext(rows);
  const contractIds = [...new Set(rows.map((row) => row.contractId).filter(Boolean))] as string[];
  if (!contractIds.length) return { items: enrichedRows, page, pageSize, total };

  const approvedRecords = await prisma.accountingFinancialRecord.findMany({
    where: {
      contractId: { in: contractIds },
      financiallyApprovedAt: { not: null }
    },
    select: { contractId: true }
  });
  const lockedContractIds = new Set(approvedRecords.map((record) => record.contractId).filter(Boolean));

  return {
    items: enrichedRows.map((row) => ({
    ...row,
    accountingEditLocked: row.contractId ? lockedContractIds.has(row.contractId) : false
    })),
    page,
    pageSize,
    total
  };
};

export const listAuditLogs = async (query: any = {}) => {
  const where = authorizedAuditPopulationWhere() as Prisma.AccountingAuditLogWhereInput;
  if (query.contractId) where.contractId = query.contractId;
  if (query.recordId) where.recordId = query.recordId;
  if (query.action && query.action !== 'ALL') where.action = query.action;
  if (query.actorId) where.actorId = query.actorId;
  Object.assign(where, dateRangeFilter(query, 'createdAt'));
  const { page, pageSize, skip } = getPagination(query);
  const hasSearchMatches = await applyContractSearch(where, query);
  if (!hasSearchMatches) return { items: [], page, pageSize, total: 0 };
  const [rows, total] = await Promise.all([
    prisma.accountingAuditLog.findMany({
      where,
      orderBy: authorizedAuditPopulationOrderBy(),
      skip,
      take: pageSize
    }),
    prisma.accountingAuditLog.count({ where })
  ]);
  return { items: await attachListContext(rows), page, pageSize, total };
};

export const getAccountantPerformanceReport = async (query: any = {}) => {
  const { page, pageSize, skip } = getPagination(query);
  const population = resolveAccountingActivityPopulation(query);
  const range = population.range;

  const [records, payments, corrections, auditRows] = await Promise.all([
    prisma.accountingFinancialRecord.findMany({
      where: { createdAt: range },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.accountingPaymentStatus.findMany({
      where: { createdAt: range },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.accountingCorrectionRequest.findMany({
      where: { createdAt: range },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.accountingAuditLog.findMany({
      where: { createdAt: range },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const contractMap = await getContractContextMap([
    ...records.map((row) => row.contractId).filter(Boolean) as string[],
    ...payments.map((row) => row.contractId).filter(Boolean) as string[],
    ...corrections.map((row) => row.contractId).filter(Boolean) as string[],
    ...auditRows.map((row) => row.contractId).filter(Boolean) as string[]
  ]);
  const actorMap = await getActorMap([
    ...records.map((row) => row.createdBy),
    ...records.map((row) => row.financiallyApprovedBy).filter(Boolean) as string[],
    ...payments.map((row) => row.createdBy),
    ...corrections.map((row) => row.createdBy),
    ...corrections.map((row) => row.resolvedBy).filter(Boolean) as string[],
    ...auditRows.map((row) => row.actorId)
  ]);

  type Bucket = {
    accountant: { id: string; displayName: string; username: string };
    firstRecordDelays: number[];
    approvalDelays: number[];
    receiptDelays: number[];
    correctionClosureDelays: number[];
    financialRecordsCreated: number;
    invoicesApproved: number;
    receiptsRegistered: number;
    correctionsOpened: number;
    correctionsResolved: number;
    actionsLogged: number;
  };

  const buckets = new Map<string, Bucket>();
  const activeAccountantIds = new Set(resolveActiveAccountantIds(auditRows));
  const getBucket = (userId: string) => {
    const actor = actorMap.get(userId) || { id: userId, displayName: 'کاربر حسابداری', username: userId };
    if (!buckets.has(userId)) {
      buckets.set(userId, {
        accountant: actor,
        firstRecordDelays: [],
        approvalDelays: [],
        receiptDelays: [],
        correctionClosureDelays: [],
        financialRecordsCreated: 0,
        invoicesApproved: 0,
        receiptsRegistered: 0,
        correctionsOpened: 0,
        correctionsResolved: 0,
        actionsLogged: 0
      });
    }
    return buckets.get(userId)!;
  };

  const firstRecordByContract = new Map<string, typeof records[number]>();
  records.forEach((record) => {
    if (!record.contractId) return;
    const current = firstRecordByContract.get(record.contractId);
    if (!current || record.createdAt < current.createdAt) firstRecordByContract.set(record.contractId, record);
  });

  records.forEach((record) => {
    const bucket = getBucket(record.createdBy);
    bucket.financialRecordsCreated += 1;
    if (record.financiallyApprovedAt) {
      const approvalBucket = getBucket(record.financiallyApprovedBy || record.createdBy);
      approvalBucket.invoicesApproved += 1;
      approvalBucket.approvalDelays.push(record.financiallyApprovedAt.getTime() - record.createdAt.getTime());
    }
  });

  firstRecordByContract.forEach((record) => {
    const contract = record.contractId ? contractMap.get(record.contractId) : null;
    if (!contract?.createdAt) return;
    getBucket(record.createdBy).firstRecordDelays.push(record.createdAt.getTime() - new Date(contract.createdAt).getTime());
  });

  payments.forEach((payment) => {
    const bucket = getBucket(payment.createdBy);
    bucket.receiptsRegistered += 1;
    const contract = payment.contractId ? contractMap.get(payment.contractId) : null;
    if (contract?.createdAt) bucket.receiptDelays.push(payment.createdAt.getTime() - new Date(contract.createdAt).getTime());
  });

  corrections.forEach((correction) => {
    getBucket(correction.createdBy).correctionsOpened += 1;
    if (correction.resolvedBy && correction.resolvedAt) {
      const bucket = getBucket(correction.resolvedBy);
      bucket.correctionsResolved += 1;
      bucket.correctionClosureDelays.push(correction.resolvedAt.getTime() - correction.createdAt.getTime());
    }
  });

  auditRows.forEach((row) => {
    getBucket(row.actorId).actionsLogged += 1;
  });

  const averageHours = (durations: number[]) => {
    if (!durations.length) return null;
    const averageMs = durations.reduce((sum, value) => sum + Math.max(value, 0), 0) / durations.length;
    return Math.round((averageMs / (1000 * 60 * 60)) * 10) / 10;
  };

  const rows = [...buckets.values()]
    .map((bucket) => ({
      accountant: bucket.accountant,
      financialRecordsCreated: bucket.financialRecordsCreated,
      invoicesApproved: bucket.invoicesApproved,
      receiptsRegistered: bucket.receiptsRegistered,
      correctionsOpened: bucket.correctionsOpened,
      correctionsResolved: bucket.correctionsResolved,
      actionsLogged: bucket.actionsLogged,
      averageHoursToFirstFinancialRecord: averageHours(bucket.firstRecordDelays),
      averageHoursToApproveInvoice: averageHours(bucket.approvalDelays),
      averageHoursToRegisterReceipt: averageHours(bucket.receiptDelays),
      averageHoursToResolveCorrection: averageHours(bucket.correctionClosureDelays)
    }))
    .filter((row) => activeAccountantIds.has(row.accountant.id))
    .filter((row) => !query.search || row.accountant.displayName.includes(String(query.search)) || row.accountant.username.includes(String(query.search)))
    .sort((left, right) => right.actionsLogged - left.actionsLogged);

  return {
    items: rows.slice(skip, skip + pageSize),
    page,
    pageSize,
    total: rows.length,
    range
  };
};

export const getAccountingSettings = async () => getDefaultSettings();

export const updateAccountingSettings = async (data: any, actor: Actor) => {
  const existing = await getDefaultSettings();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.accountingSetting.update({
      where: { id: existing.id },
      data: {
        companyEconomicCode: data.companyEconomicCode,
        companyNationalId: data.companyNationalId,
        branchCode: data.branchCode,
        fiscalMemoryId: data.fiscalMemoryId,
        defaultVatRate: data.defaultVatRate != null ? toDecimal(data.defaultVatRate, 10) : undefined,
        defaultCurrency: data.defaultCurrency,
        invoiceNumberPrefix: data.invoiceNumberPrefix,
        nextInvoiceSequence: data.nextInvoiceSequence != null ? Number(data.nextInvoiceSequence) : undefined,
        defaultInvoiceDueDays: data.defaultInvoiceDueDays != null ? Number(data.defaultInvoiceDueDays) : undefined,
        requiredTaxFields: data.requiredTaxFields,
        defaultAccounts: data.defaultAccounts,
        updatedBy: actor.userId
      }
    });

    await audit(tx, {
      action: 'UPDATE_ACCOUNTING_SETTINGS',
      actorId: actor.userId,
      entityType: 'AccountingSetting',
      entityId: result.id,
      beforeState: toJsonValue(existing),
      afterState: toJsonValue(result)
    });

    return result;
  });

  return updated;
};
