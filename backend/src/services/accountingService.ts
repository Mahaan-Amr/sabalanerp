import {
  AccountingFlagCategory,
  AccountingFlagSeverity,
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

const prisma = new PrismaClient();

const ELIGIBLE_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.APPROVED,
  ContractStatus.SIGNED,
  ContractStatus.PRINTED
];

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_CURRENCY = 'TOMAN';

type Actor = {
  userId: string;
  role: string;
};

type ListContractsQuery = {
  search?: string;
  status?: string;
  sourceStatus?: string;
  taxStatus?: string;
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
  const oldestAllowed = today - (2 * 24 * 60 * 60 * 1000);

  if (invoiceDay > today) {
    throw new Error('System invoice date cannot be in the future');
  }
  if (invoiceDay < oldestAllowed) {
    throw new Error('System invoice date cannot be older than 2 days');
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

  const contractAmount = getContractAmount(contract);
  const invoicedAmount = records
    .filter((record: any) => record.kind === FinancialRecordKind.INVOICE_CANDIDATE && record.status !== AccountingRecordStatus.VOIDED)
    .reduce((sum: Prisma.Decimal, record: any) => sum.plus(record.amount), new Prisma.Decimal(0));
  const receivedAmount = payments
    .filter((payment: any) => payment.status === PaymentAccountingStatus.RECEIVED || payment.status === PaymentAccountingStatus.RECONCILED)
    .reduce((sum: Prisma.Decimal, payment: any) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const remainingAmount = Prisma.Decimal.max(contractAmount.minus(receivedAmount), new Prisma.Decimal(0));
  const missingFields = getTaxMissingFields(contract, settings);
  const eligible = ELIGIBLE_CONTRACT_STATUSES.includes(contract.status);
  const openCorrections = corrections.filter((item: any) => item.status === CorrectionRequestStatus.OPEN || item.status === CorrectionRequestStatus.ACKNOWLEDGED);
  const openFlags = flags.filter((item: any) => item.status === 'OPEN');
  const hasRecords = records.length > 0 || receivables.length > 0 || payments.length > 0 || taxRecords.length > 0;
  const issuedInvoices = records.filter((record: any) => (
    record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
    (record.status === AccountingRecordStatus.ISSUED || record.status === AccountingRecordStatus.POSTED)
  ));
  const openInvoiceCandidates = records.filter((record: any) => (
    record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
    ![AccountingRecordStatus.ISSUED, AccountingRecordStatus.POSTED, AccountingRecordStatus.VOIDED].includes(record.status)
  ));

  const invoiceStatus = records.some((record: any) => record.status === AccountingRecordStatus.ISSUED || record.status === AccountingRecordStatus.POSTED)
    ? 'ISSUED'
    : records.some((record: any) => record.kind === FinancialRecordKind.INVOICE_CANDIDATE)
      ? 'DRAFT'
      : 'NONE';

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
  if (openCorrections.length > 0 || openFlags.some((flag: any) => flag.severity === AccountingFlagSeverity.BLOCKER)) {
    sourceStatus = 'NEEDS_CORRECTION';
  } else if (hasRecords) {
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

export const listAccountingContracts = async (query: ListContractsQuery = {}) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), 100);
  const skip = (page - 1) * pageSize;
  const search = query.search?.trim();

  const where: Prisma.SalesContractWhereInput = {};
  if (query.status && query.status !== 'ALL') {
    where.status = query.status as ContractStatus;
  }
  if (search) {
    where.OR = [
      { contractNumber: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { titlePersian: { contains: search, mode: 'insensitive' } },
      { customer: { firstName: { contains: search, mode: 'insensitive' } } },
      { customer: { lastName: { contains: search, mode: 'insensitive' } } },
      { customer: { companyName: { contains: search, mode: 'insensitive' } } },
      { customer: { nationalCode: { contains: search, mode: 'insensitive' } } }
    ];
  }

  const orderBy: Prisma.SalesContractOrderByWithRelationInput =
    query.sort === 'amount_desc' ? { totalAmount: 'desc' } :
    query.sort === 'amount_asc' ? { totalAmount: 'asc' } :
    query.sort === 'oldest' ? { createdAt: 'asc' } :
    { createdAt: 'desc' };

  const [rawContracts, total, settings] = await Promise.all([
    prisma.salesContract.findMany({
      where,
      skip,
      take: pageSize,
      include: getAccountingInclude(),
      orderBy
    }),
    prisma.salesContract.count({ where }),
    getDefaultSettings()
  ]);

  const contracts = await attachAccountingCollections(rawContracts);
  let items = await Promise.all(contracts.map((contract) => buildContractRow(contract, settings)));

  if (query.sourceStatus && query.sourceStatus !== 'ALL') {
    items = items.filter((item) => item.accounting.sourceStatus === query.sourceStatus);
  }
  if (query.taxStatus && query.taxStatus !== 'ALL') {
    items = items.filter((item) => item.accounting.taxStatus === query.taxStatus);
  }
  if (query.sort === 'attention') {
    items.sort((a, b) => {
      const score = (item: any) =>
        (item.accounting.openCorrections * 4) +
        (item.accounting.openFlags * 3) +
        (item.accounting.receivableStatus === 'OVERDUE' ? 3 : 0) +
        (item.accounting.taxStatus === TaxSubmissionStatus.NOT_READY ? 2 : 0) +
        (item.accounting.eligibleForFinancialRecords && item.accounting.invoiceStatus === 'NONE' ? 1 : 0);
      return score(b) - score(a);
    });
  }

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
    items,
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
  const [period, contractResponse, records, receivables, payments, taxRecords, corrections, auditLogs] = await Promise.all([
    getOrCreateCurrentPeriod(),
    listAccountingContracts({ page: 1, pageSize: 12, sort: 'attention' }),
    prisma.accountingFinancialRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingReceivable.findMany({ orderBy: { dueDate: 'asc' }, take: 8 }),
    prisma.accountingPaymentStatus.findMany({ orderBy: [{ checkDueDate: 'asc' }, { createdAt: 'desc' }], take: 8 }),
    prisma.accountingTaxRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingCorrectionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.accountingAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  ]);

  const now = new Date();
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
  const invoiceCandidates = await prisma.accountingFinancialRecord.findMany({
    where: { kind: FinancialRecordKind.INVOICE_CANDIDATE, status: { in: [AccountingRecordStatus.DRAFT, AccountingRecordStatus.READY, AccountingRecordStatus.APPROVED_FOR_ISSUE] } }
  });
  const taxNotReady = await prisma.accountingTaxRecord.findMany({
    where: { submissionStatus: { in: [TaxSubmissionStatus.NOT_READY, TaxSubmissionStatus.NEEDS_CORRECTION, TaxSubmissionStatus.REJECTED] } }
  });
  const openCorrections = await prisma.accountingCorrectionRequest.findMany({
    where: { status: { in: [CorrectionRequestStatus.OPEN, CorrectionRequestStatus.ACKNOWLEDGED] } }
  });

  return {
    period,
    commandCenter: {
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

  return {
    contract: row,
    sourceSnapshot: {
      contractNumber: contract.contractNumber,
      status: contract.status,
      titlePersian: contract.titlePersian,
      totalAmount: decimalToString(getContractAmount(contract)),
      currency: contract.currency || DEFAULT_CURRENCY,
      items: contract.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.namePersian || item.product?.name || item.description || 'قلم قرارداد',
        quantity: decimalToString(item.quantity),
        unitPrice: decimalToString(item.unitPrice),
        totalPrice: decimalToString(item.totalPrice)
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

export const executeAccountingAction = async (command: AccountingActionRequest, actor: Actor) => {
  const period = command.periodId
    ? await prisma.accountingPeriod.findUnique({ where: { id: command.periodId } })
    : await getOrCreateCurrentPeriod();

  if (!period) throw new Error('Accounting period not found');

  switch (command.kind) {
    case 'CREATE_INVOICE':
      return createInvoiceCandidate(command, actor, period.id);
    case 'CREATE_RECEIVABLE':
      return createReceivable(command, actor, period.id);
    case 'APPROVE_FINANCIAL_INVOICE':
      return approveFinancialInvoice(command, actor);
    case 'REGISTER_RECEIPT':
      return registerReceipt(command, actor);
    case 'UPDATE_CHECK_STATUS':
      return updateCheckStatus(command, actor);
    case 'MARK_TAX_READY':
      return markTaxReady(command, actor);
    case 'TRACK_TAX_SUBMISSION':
      return trackTaxSubmission(command, actor);
    case 'REQUEST_CORRECTION':
      return requestCorrection(command, actor);
    case 'FLAG_CONTRACT':
      return flagContract(command, actor);
    case 'VOID_ACCOUNTING_RECORD':
      return voidAccountingRecord(command, actor);
    default:
      throw new Error(`Unsupported accounting action: ${command.kind}`);
  }
};

const createInvoiceCandidate = async (command: AccountingActionRequest, actor: Actor, periodId: string) => {
  if (!command.contractId) throw new Error('contractId is required');
  const contract = await ensureEligibleContract(command.contractId);
  const settings = await getDefaultSettings();
  const idempotencyKey = command.idempotencyKey || `invoice-candidate:${contract.id}:${command.mode || 'FROM_CONTRACT_TOTAL'}`;
  const existing = await prisma.accountingFinancialRecord.findUnique({ where: { idempotencyKey } });
  if (existing) return actionResponse('APPLIED', 'پیش‌نویس صورتحساب قبلا ایجاد شده است', { financialRecordIds: [existing.id], contractId: contract.id });

  const selectedItems = command.mode === 'FROM_SELECTED_ITEMS' && command.selectedContractItemIds?.length
    ? contract.items.filter((item) => command.selectedContractItemIds!.includes(item.id))
    : contract.items;
  const amount = command.amount != null ? toDecimal(command.amount) : selectedItems.reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0));
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
        currency: contract.currency || DEFAULT_CURRENCY,
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
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
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

    return invoice;
  });

  return actionResponse('APPLIED', 'پیش‌نویس صورتحساب ایجاد شد', { contractId: contract.id, financialRecordIds: [record.id] });
};

const approveFinancialInvoice = async (command: AccountingActionRequest, actor: Actor) => {
  const invoiceId = command.invoiceId || command.recordId;
  if (!invoiceId) throw new Error('invoiceId is required');

  const systemInvoiceNumber = normalizeDigits(command.systemInvoiceNumber || '').trim();
  if (!systemInvoiceNumber) throw new Error('System invoice number is required');
  const systemInvoiceDate = validateSystemInvoiceDate(command.systemInvoiceDate);

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

    const duplicate = await tx.accountingFinancialRecord.findFirst({
      where: {
        systemInvoiceNumber,
        id: { not: invoiceId }
      }
    });
    if (duplicate) throw new Error('System invoice number is already used');

    const updated = await tx.accountingFinancialRecord.update({
      where: { id: invoiceId },
      data: {
        status: AccountingRecordStatus.ISSUED,
        systemInvoiceNumber,
        systemInvoiceDate,
        financiallyApprovedAt: new Date(),
        financiallyApprovedBy: actor.userId,
        postedAt: new Date()
      }
    });

    await audit(tx, {
      action: 'APPROVE_FINANCIAL_INVOICE',
      actorId: actor.userId,
      contractId: updated.contractId,
      recordId: updated.id,
      entityType: 'AccountingFinancialRecord',
      entityId: updated.id,
      beforeState: toJsonValue(before),
      afterState: toJsonValue(updated),
      note: command.note || null
    });

    return updated;
  });

  return actionResponse('APPLIED', 'تایید مالی ثبت شد', { contractId: result.contractId || undefined, financialRecordIds: [result.id] });
};

const createReceivable = async (command: AccountingActionRequest, actor: Actor, periodId: string) => {
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
        currency: contract.currency || DEFAULT_CURRENCY,
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
        currency: contract.currency || DEFAULT_CURRENCY,
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

    return { record, receivable };
  });

  return actionResponse('APPLIED', 'دریافتنی ایجاد شد', { contractId: contract.id, financialRecordIds: [result.record.id], receivableIds: [result.receivable.id] });
};

const registerReceipt = async (command: AccountingActionRequest, actor: Actor) => {
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
        currency: contract.currency || DEFAULT_CURRENCY,
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
  const correction = await prisma.$transaction(async (tx) => {
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

const voidAccountingRecord = async (command: AccountingActionRequest, actor: Actor) => {
  const recordId = command.recordId || command.invoiceId;
  if (!recordId) throw new Error('recordId is required');
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.accountingFinancialRecord.findUnique({ where: { id: recordId } });
    if (!before) throw new Error('Accounting record not found');
    const record = await tx.accountingFinancialRecord.update({
      where: { id: recordId },
      data: { status: AccountingRecordStatus.VOIDED, voidedAt: new Date() }
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
      note: command.note || null
    });
    return record;
  });

  return actionResponse('APPLIED', 'رکورد حسابداری باطل شد', { contractId: result.contractId || undefined, financialRecordIds: [result.id] });
};

const actionResponse = (status: 'APPLIED' | 'REJECTED' | 'NEEDS_CONFIRMATION', messageFa: string, affected: Record<string, unknown>) => ({
  actionId: `act_${Date.now()}`,
  status,
  messageFa,
  affected
});

export const listFinancialRecords = async (query: any = {}) => {
  const where: Prisma.AccountingFinancialRecordWhereInput = {};
  if (query.kind && query.kind !== 'ALL') where.kind = query.kind;
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.contractId) where.contractId = query.contractId;
  return prisma.accountingFinancialRecord.findMany({
    where,
    include: { invoiceItems: true, taxRecords: true, receivables: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200)
  });
};

export const listReceivables = async (query: any = {}) => {
  const where: Prisma.AccountingReceivableWhereInput = {};
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.contractId) where.contractId = query.contractId;
  return prisma.accountingReceivable.findMany({
    where,
    include: { paymentStatuses: true },
    orderBy: { dueDate: 'asc' },
    take: Math.min(Number(query.limit) || 100, 200)
  });
};

export const listPaymentStatuses = async (query: any = {}) => {
  const where: Prisma.AccountingPaymentStatusWhereInput = {};
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.checkStatus && query.checkStatus !== 'ALL') where.checkStatus = query.checkStatus;
  if (query.contractId) where.contractId = query.contractId;
  return prisma.accountingPaymentStatus.findMany({
    where,
    orderBy: [{ checkDueDate: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(Number(query.limit) || 100, 200)
  });
};

export const listTaxRecords = async (query: any = {}) => {
  const where: Prisma.AccountingTaxRecordWhereInput = {};
  if (query.submissionStatus && query.submissionStatus !== 'ALL') where.submissionStatus = query.submissionStatus;
  if (query.contractId) where.contractId = query.contractId;
  return prisma.accountingTaxRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200)
  });
};

export const listCorrectionRequests = async (query: any = {}) => {
  const where: Prisma.AccountingCorrectionRequestWhereInput = {};
  if (query.status && query.status !== 'ALL') where.status = query.status;
  if (query.contractId) where.contractId = query.contractId;
  return prisma.accountingCorrectionRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200)
  });
};

export const listAuditLogs = async (query: any = {}) => {
  const where: Prisma.AccountingAuditLogWhereInput = {};
  if (query.contractId) where.contractId = query.contractId;
  if (query.recordId) where.recordId = query.recordId;
  return prisma.accountingAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200)
  });
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
