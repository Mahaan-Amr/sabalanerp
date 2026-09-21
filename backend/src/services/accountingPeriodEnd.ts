import { createHash } from 'node:crypto';

type JsonLike = null | boolean | number | string | bigint | Date | JsonLike[] | { [key: string]: JsonLike | undefined };

const canonicalize = (value: JsonLike): JsonLike => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item as JsonLike)]));
  }
  return value;
};

const digest = (value: JsonLike) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export const hashPeriodEndEvidence = (value: JsonLike) => digest(value);

export type AssetDepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION';

type EvidenceIdentity = {
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  occurredAt: Date;
};

export type AssetReadyForUseEvidence = EvidenceIdentity & {
  kind: 'ASSET_READY_FOR_USE';
  asset: {
    id: string;
    registerNumber: string;
    classPolicyVersionId: string;
    readyForUseAt: Date;
    costRials: bigint;
    assetAccountId: string;
    constructionInProgressAccountId: string;
    components: Array<{
      id: string;
      titlePersian: string;
      costRials: bigint;
      usefulLifeMonths: number;
      residualValueRials: bigint;
    }>;
    bookMethod: AssetDepreciationMethod;
    taxBasis: { costRials: bigint; method: AssetDepreciationMethod; rateBasisPoints?: number };
  };
};

export type AssetPaymentEvidence = EvidenceIdentity & {
  kind: 'ASSET_PAYMENT';
  assetId: string;
  amountRials: bigint;
};

export type AssetCostEvidence = EvidenceIdentity & {
  kind: 'ASSET_COST';
  assetId: string;
  costKind: 'PURCHASE' | 'DIRECTLY_ATTRIBUTABLE' | 'CONSTRUCTION_IN_PROGRESS';
  amountRials: bigint;
  constructionInProgressAccountId: string;
  creditAccountId: string;
  documentIds: string[];
};

export type AssetLifecycleEvidence = EvidenceIdentity & {
  kind: 'ASSET_LIFECYCLE';
  assetId: string;
  eventType: 'REPAIR' | 'IMPROVEMENT' | 'COMPONENT_REPLACEMENT' | 'TRANSFER' | 'IMPAIRMENT' | 'IMPAIRMENT_REVERSAL' | 'REVALUATION' | 'SALE' | 'LOSS' | 'THEFT' | 'DISPOSAL';
  treatment: 'EXPENSE' | 'CAPITALIZE' | 'TRANSFER' | 'ALLOWANCE' | 'REVALUATION' | 'DERECOGNIZE';
  lines: Array<{ accountId: string; debitRials: bigint; creditRials: bigint; description: string }>;
  lifecyclePayload: {
    documentIds: string[];
    priorComponentId?: string | null;
    successorComponentId?: string | null;
    fromLocation?: string;
    toLocation?: string;
    custodianPartyId?: string;
  };
};

export type ApprovedPayrollEvidence = EvidenceIdentity & {
  kind: 'APPROVED_PAYROLL';
  populationHash: string;
  policyHash: string;
  summaryLines: Array<{
    componentCode: string;
    accountId: string;
    debitRials: bigint;
    creditRials: bigint;
    costCenterMemberId?: string;
  }>;
  obligations: Array<{
    identity: string;
    kind: 'NET_PAY' | 'PAYROLL_TAX' | 'INSURANCE' | 'LOAN' | 'ADVANCE' | 'BENEFIT';
    amountRials: bigint;
  }>;
};

export type RecognitionDueEvidence = EvidenceIdentity & {
  kind: 'RECOGNITION_DUE';
  dueIdentity: string;
  scheduleKind: 'PREPAYMENT' | 'DEFERRED_INCOME' | 'ACCRUAL' | 'PROVISION' | 'RECURRING';
  amountRials: bigint;
  debitAccountId: string;
  creditAccountId: string;
  estimateBasis: string;
  appliesFrom: Date;
  reviewDueAt: Date;
};

export type PeriodEndEvidence = AssetReadyForUseEvidence | AssetPaymentEvidence | AssetCostEvidence | AssetLifecycleEvidence | ApprovedPayrollEvidence | RecognitionDueEvidence;

export type PeriodEndVoucherLine = {
  accountId: string;
  debitRials: bigint;
  creditRials: bigint;
  description: string;
  dimensions: Array<{ typeCode: string; memberId: string }>;
};

export type PeriodEndPosting = {
  bookId: string;
  fiscalYearId: string;
  periodId: string;
  idempotencyKey: string;
  description: string;
  documentDate: Date;
  sourceType: PeriodEndEvidence['kind'];
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  sourcePayload: PeriodEndEvidence;
  actorId: string;
  lines: PeriodEndVoucherLine[];
};

export type PeriodEndResult =
  | {
    kind: 'POSTED';
    sourceHash: string;
    voucherId: string;
    statutoryNumber: number;
    obligationIdentities: string[];
  }
  | {
    kind: 'EXCEPTION';
    sourceHash: string;
    code: PeriodEndExceptionCode;
    reasonPersian: string;
  };

export type PeriodEndExceptionCode =
  | 'EVIDENCE_INTEGRITY_FAILED'
  | 'ASSET_NOT_READY_FOR_USE'
  | 'ASSET_COMPONENT_COST_MISMATCH'
  | 'ASSET_LIFECYCLE_INVALID'
  | 'PAYROLL_CONFIDENTIALITY_VIOLATION'
  | 'PAYROLL_SUMMARY_UNBALANCED'
  | 'PAYROLL_HASH_REQUIRED'
  | 'SCHEDULE_AMOUNT_INVALID'
  | 'SOURCE_CONFLICT';

export interface PeriodEndRepository {
  transaction<T>(operation: (repository: PeriodEndRepository) => Promise<T>): Promise<T>;
  findResult(identity: string): Promise<PeriodEndResult | null>;
  postVoucher(voucher: PeriodEndPosting): Promise<{ voucherId: string; statutoryNumber: number }>;
  saveResult(identity: string, result: PeriodEndResult): Promise<PeriodEndResult>;
}

type EvidenceCommand = {
  bookId: string;
  fiscalYearId: string;
  periodId: string;
  actorId: string;
  evidence: PeriodEndEvidence;
};

const hasEmployeeDetail = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasEmployeeDetail);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => (
    /employee|personnel|nationalId|mobile/i.test(key) || hasEmployeeDetail(item)
  ));
};

const exception = (sourceHash: string, code: PeriodEndExceptionCode, reasonPersian: string): PeriodEndResult => ({
  kind: 'EXCEPTION', sourceHash, code, reasonPersian,
});

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

const preparePosting = (command: EvidenceCommand): PeriodEndPosting | PeriodEndResult => {
  const { evidence } = command;
  const base = {
    bookId: command.bookId,
    fiscalYearId: command.fiscalYearId,
    periodId: command.periodId,
    idempotencyKey: `${command.bookId}:${evidence.kind}:${evidence.sourceId}:${evidence.sourceVersion}`,
    documentDate: evidence.occurredAt,
    sourceType: evidence.kind,
    sourceId: evidence.sourceId,
    sourceVersion: evidence.sourceVersion,
    sourceHash: evidence.sourceHash,
    sourcePayload: evidence,
    actorId: command.actorId,
  };

  if (evidence.kind === 'ASSET_PAYMENT') {
    return exception(evidence.sourceHash, 'ASSET_NOT_READY_FOR_USE', 'پرداخت به‌تنهایی مجوز شروع استهلاک یا انتقال دارایی به وضعیت آماده‌به‌کار نیست.');
  }
  if (evidence.kind === 'ASSET_COST') {
    if (evidence.amountRials <= 0n || evidence.documentIds.length === 0) return exception(evidence.sourceHash, 'ASSET_COMPONENT_COST_MISMATCH', 'بهای دارایی باید مثبت و دارای مدرک منشأ باشد.');
    return {
      ...base,
      description: `انباشت بهای دارایی در جریان تکمیل ${evidence.assetId}`,
      lines: [
        { accountId: evidence.constructionInProgressAccountId, debitRials: evidence.amountRials, creditRials: 0n, description: 'بهای دارایی در جریان تکمیل', dimensions: [] },
        { accountId: evidence.creditAccountId, debitRials: 0n, creditRials: evidence.amountRials, description: 'منبع تأمین بهای دارایی', dimensions: [] },
      ],
    };
  }
  if (evidence.kind === 'ASSET_READY_FOR_USE') {
    const componentCost = sum(evidence.asset.components.map((component) => component.costRials));
    if (componentCost !== evidence.asset.costRials || evidence.asset.components.length === 0) {
      return exception(evidence.sourceHash, 'ASSET_COMPONENT_COST_MISMATCH', 'جمع بهای اجزای بااهمیت باید دقیقاً با بهای دارایی برابر باشد.');
    }
    return {
      ...base,
      description: `انتقال ${evidence.asset.registerNumber} به دارایی آماده‌به‌کار`,
      lines: [
        { accountId: evidence.asset.assetAccountId, debitRials: evidence.asset.costRials, creditRials: 0n, description: 'بهای تمام‌شده دارایی', dimensions: [] },
        { accountId: evidence.asset.constructionInProgressAccountId, debitRials: 0n, creditRials: evidence.asset.costRials, description: 'خروج از جریان تکمیل', dimensions: [] },
      ],
    };
  }
  if (evidence.kind === 'ASSET_LIFECYCLE') {
    const expectedTreatment: Partial<Record<AssetLifecycleEvidence['eventType'], AssetLifecycleEvidence['treatment']>> = {
      REPAIR: 'EXPENSE', IMPROVEMENT: 'CAPITALIZE', COMPONENT_REPLACEMENT: 'CAPITALIZE', TRANSFER: 'TRANSFER',
      IMPAIRMENT: 'ALLOWANCE', IMPAIRMENT_REVERSAL: 'ALLOWANCE', REVALUATION: 'REVALUATION',
      SALE: 'DERECOGNIZE', LOSS: 'DERECOGNIZE', THEFT: 'DERECOGNIZE', DISPOSAL: 'DERECOGNIZE',
    };
    const debit = sum(evidence.lines.map((line) => line.debitRials));
    const credit = sum(evidence.lines.map((line) => line.creditRials));
    const invalidComponentReplacement = evidence.eventType === 'COMPONENT_REPLACEMENT'
      && (!evidence.lifecyclePayload.priorComponentId || !evidence.lifecyclePayload.successorComponentId);
    if (expectedTreatment[evidence.eventType] !== evidence.treatment || invalidComponentReplacement
      || debit <= 0n || debit !== credit || evidence.lines.some((line) => (
        !line.accountId || line.debitRials < 0n || line.creditRials < 0n || (line.debitRials > 0n) === (line.creditRials > 0n)
      ))) {
      return exception(evidence.sourceHash, 'ASSET_LIFECYCLE_INVALID', 'رویداد چرخه عمر دارایی باید treatment صریح، شواهد کامل و ثبت متوازن داشته باشد.');
    }
    return {
      ...base,
      description: `رویداد ${evidence.eventType} دارایی ${evidence.assetId}`,
      lines: evidence.lines.map((line) => ({ ...line, dimensions: [] })),
    };
  }
  if (evidence.kind === 'APPROVED_PAYROLL') {
    if (hasEmployeeDetail(evidence)) {
      return exception(evidence.sourceHash, 'PAYROLL_CONFIDENTIALITY_VIOLATION', 'تحویل حسابداری حقوق باید خلاصه باشد و نباید جزئیات فردی کارکنان را حمل کند.');
    }
    if (!evidence.populationHash.trim() || !evidence.policyHash.trim()) {
      return exception(evidence.sourceHash, 'PAYROLL_HASH_REQUIRED', 'نسخه جمعیت و سیاست محاسبه حقوق باید با هش معتبر تثبیت شده باشد.');
    }
    const debit = sum(evidence.summaryLines.map((line) => line.debitRials));
    const credit = sum(evidence.summaryLines.map((line) => line.creditRials));
    if (debit <= 0n || debit !== credit || evidence.summaryLines.some((line) => (
      line.debitRials < 0n || line.creditRials < 0n || (line.debitRials > 0n) === (line.creditRials > 0n)
    ))) {
      return exception(evidence.sourceHash, 'PAYROLL_SUMMARY_UNBALANCED', 'خلاصه حقوق تأییدشده باید مثبت، یک‌طرفه و کاملاً متوازن باشد.');
    }
    return {
      ...base,
      description: `ثبت خلاصه حقوق تأییدشده ${evidence.sourceId}`,
      lines: evidence.summaryLines.map((line) => ({
        accountId: line.accountId,
        debitRials: line.debitRials,
        creditRials: line.creditRials,
        description: `جزء خلاصه حقوق ${line.componentCode}`,
        dimensions: line.costCenterMemberId ? [{ typeCode: 'COST_CENTER', memberId: line.costCenterMemberId }] : [],
      })),
    };
  }
  if (evidence.amountRials <= 0n) {
    return exception(evidence.sourceHash, 'SCHEDULE_AMOUNT_INVALID', 'مبلغ سررسید برنامه شناسایی باید بیشتر از صفر باشد.');
  }
  return {
    ...base,
    idempotencyKey: `${base.idempotencyKey}:${evidence.dueIdentity}`,
    description: `شناسایی دوره‌ای ${evidence.dueIdentity}`,
    lines: [
      { accountId: evidence.debitAccountId, debitRials: evidence.amountRials, creditRials: 0n, description: evidence.estimateBasis, dimensions: [] },
      { accountId: evidence.creditAccountId, debitRials: 0n, creditRials: evidence.amountRials, description: evidence.estimateBasis, dimensions: [] },
    ],
  };
};

export const createAccountingPeriodEndApplication = (
  repository: PeriodEndRepository,
  dependencies: { now: () => Date },
) => ({
  acceptEvidence: async (command: EvidenceCommand): Promise<PeriodEndResult> => repository.transaction(async (tx) => {
    const { sourceHash, ...unsignedEvidence } = command.evidence;
    const identity = `${command.bookId}:${command.evidence.kind}:${command.evidence.sourceId}:${command.evidence.sourceVersion}`;
    const existing = await tx.findResult(identity);
    if (existing) {
      if (existing.sourceHash !== sourceHash) {
        return exception(sourceHash, 'SOURCE_CONFLICT', 'همین نسخه منبع قبلاً با محتوای دیگری دریافت شده است.');
      }
      return existing;
    }
    if (hashPeriodEndEvidence(unsignedEvidence as JsonLike) !== sourceHash) {
      return tx.saveResult(identity, exception(sourceHash, 'EVIDENCE_INTEGRITY_FAILED', 'هش شواهد با محتوای تحویل‌شده مطابقت ندارد.'));
    }
    const prepared = preparePosting(command);
    if ('kind' in prepared) return tx.saveResult(identity, prepared);
    const posted = await tx.postVoucher(prepared);
    const result: PeriodEndResult = {
      kind: 'POSTED',
      sourceHash,
      voucherId: posted.voucherId,
      statutoryNumber: posted.statutoryNumber,
      obligationIdentities: command.evidence.kind === 'APPROVED_PAYROLL'
        ? command.evidence.obligations.map((obligation) => obligation.identity)
        : [],
    };
    void dependencies.now();
    return tx.saveResult(identity, result);
  }),
});

type DepreciationComponent = {
  id: string;
  costRials: bigint;
  residualValueRials: bigint;
  usefulLifeMonths: number;
  method: AssetDepreciationMethod;
  annualRateBasisPoints?: number;
  periodUnits?: bigint;
  totalExpectedUnits?: bigint;
  accumulatedDepreciationRials?: bigint;
};

const divideRounded = (numerator: bigint, denominator: bigint) => {
  if (denominator <= 0n) throw new Error('مخرج محاسبه استهلاک باید بیشتر از صفر باشد.');
  return (numerator + denominator / 2n) / denominator;
};

const componentPeriodCharge = (component: DepreciationComponent) => {
  const depreciable = component.costRials - component.residualValueRials;
  if (depreciable <= 0n) return 0n;
  if (component.method === 'STRAIGHT_LINE') {
    return divideRounded(depreciable, BigInt(component.usefulLifeMonths));
  }
  if (component.method === 'DECLINING_BALANCE') {
    if (!component.annualRateBasisPoints) throw new Error('نرخ استهلاک نزولی ثبت نشده است.');
    return divideRounded(component.costRials * BigInt(component.annualRateBasisPoints), 120_000n);
  }
  if (!component.periodUnits || !component.totalExpectedUnits) throw new Error('مقدار تولید دوره و کل برآورد تولید باید ثبت شود.');
  return divideRounded(depreciable * component.periodUnits, component.totalExpectedUnits);
};

export const calculateAssetDepreciation = (input: {
  assetId: string;
  periodIdentity: string;
  readyForUseAt: Date;
  periodStart: Date;
  periodEnd: Date;
  accumulatedBookDepreciationRials: bigint;
  accumulatedTaxDepreciationRials: bigint;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
  components: DepreciationComponent[];
  taxBasis: {
    costRials: bigint;
    residualValueRials: bigint;
    method: AssetDepreciationMethod;
    usefulLifeMonths?: number;
    annualRateBasisPoints?: number;
    periodUnits?: bigint;
    totalExpectedUnits?: bigint;
  };
}) => {
  const eligible = input.readyForUseAt <= input.periodEnd;
  const componentCharges = input.components.map((component) => {
    const candidate = eligible ? componentPeriodCharge(component) : 0n;
    const remaining = component.costRials - component.residualValueRials - (component.accumulatedDepreciationRials ?? 0n);
    return { componentId: component.id, bookChargeRials: remaining <= 0n ? 0n : candidate > remaining ? remaining : candidate };
  });
  const grossBookCharge = sum(componentCharges.map((component) => component.bookChargeRials));
  const maximumBookCharge = sum(input.components.map((component) => component.costRials - component.residualValueRials))
    - input.accumulatedBookDepreciationRials;
  const bookChargeRials = maximumBookCharge > 0n && grossBookCharge > maximumBookCharge ? maximumBookCharge : grossBookCharge;
  const taxChargeCandidate = eligible ? componentPeriodCharge({
    id: 'tax-basis',
    costRials: input.taxBasis.costRials,
    residualValueRials: input.taxBasis.residualValueRials,
    usefulLifeMonths: input.taxBasis.usefulLifeMonths ?? 1,
    method: input.taxBasis.method,
    annualRateBasisPoints: input.taxBasis.annualRateBasisPoints,
    periodUnits: input.taxBasis.periodUnits,
    totalExpectedUnits: input.taxBasis.totalExpectedUnits,
  }) : 0n;
  const maximumTaxCharge = input.taxBasis.costRials - input.taxBasis.residualValueRials - input.accumulatedTaxDepreciationRials;
  const taxChargeRials = maximumTaxCharge > 0n && taxChargeCandidate > maximumTaxCharge ? maximumTaxCharge : taxChargeCandidate;
  return {
    assetId: input.assetId,
    periodIdentity: input.periodIdentity,
    componentCharges,
    bookChargeRials,
    taxChargeRials,
    deferredTaxTemporaryDifferenceRials: taxChargeRials - bookChargeRials,
    postingLines: bookChargeRials === 0n ? [] : [
      { accountId: input.depreciationExpenseAccountId, debitRials: bookChargeRials, creditRials: 0n, description: 'هزینه استهلاک دفتری', dimensions: [] },
      { accountId: input.accumulatedDepreciationAccountId, debitRials: 0n, creditRials: bookChargeRials, description: 'استهلاک انباشته دفتری', dimensions: [] },
    ] satisfies PeriodEndVoucherLine[],
  };
};

export const applyPayrollSettlementAttempt = (
  obligation: {
    identity: string;
    amountRials: bigint;
    settledRials: bigint;
    status: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED';
    attempts: Array<{ identity: string; status: 'FAILED' | 'SUCCEEDED'; amountRials: bigint }>;
  },
  attempt: { identity: string; status: 'FAILED' | 'SUCCEEDED'; amountRials: bigint },
) => {
  if (obligation.attempts.some((existing) => existing.identity === attempt.identity)) return obligation;
  if (attempt.amountRials <= 0n || obligation.settledRials + attempt.amountRials > obligation.amountRials) {
    throw new Error('مبلغ تلاش تسویه حقوق با مانده تعهد سازگار نیست.');
  }
  const settledRials = attempt.status === 'SUCCEEDED' ? obligation.settledRials + attempt.amountRials : obligation.settledRials;
  return {
    ...obligation,
    settledRials,
    status: settledRials === obligation.amountRials ? 'SETTLED' as const : settledRials > 0n ? 'PARTIALLY_SETTLED' as const : 'OPEN' as const,
    attempts: [...obligation.attempts, { ...attempt }],
  };
};

export type OfficialReportKind = 'T_ACCOUNT' | 'TRIAL_BALANCE' | 'FINANCIAL_STATEMENT' | 'CASH_FLOW' | 'LEGAL_BOOK';
export type TrialBalanceLevel = 'GROUP' | 'GENERAL' | 'SUBSIDIARY' | 'DETAIL';

export type OfficialPostedLine = {
  id: string;
  voucherId: string;
  voucherNumber: number | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  accountId: string;
  accountCode: string;
  accountTitlePersian: string;
  accountPath: { group: string; general: string; subsidiary: string; detail?: string };
  debitRials: bigint;
  creditRials: bigint;
  documentDate: Date;
  postedAt: Date | null;
  dimensions: Record<string, string>;
  cashTransferIdentity?: string;
};

export type FinancialStatementMapping = {
  id: string;
  effectiveFrom: Date;
  rows: Array<{
    accountId: string;
    statement: 'FINANCIAL_POSITION' | 'PROFIT_OR_LOSS' | 'COMPREHENSIVE_INCOME' | 'CHANGES_IN_EQUITY' | 'NOTES' | 'CASH_FLOW_DIRECT' | 'CASH_FLOW_INDIRECT';
    sectionCode: string;
    signMultiplier?: number;
    cashFlowClass?: 'OPERATING' | 'INVESTING' | 'FINANCING' | 'INTERNAL_TRANSFER';
  }>;
};

export type OfficialDatasetRequest = {
  reportKind: OfficialReportKind;
  bookId: string;
  fiscalYearId: string;
  from: Date;
  to: Date;
  columns?: 2 | 4 | 6 | 8;
  level?: TrialBalanceLevel;
  mappingVersionId?: string;
  legalBookKind?: 'JOURNAL' | 'GENERAL_LEDGER' | 'SUBSIDIARY_LEDGER';
  statutoryFormatId?: string;
  cutoffAt: Date;
  dimensionFilters?: Record<string, string>;
  comparativeFrom?: Date;
  comparativeTo?: Date;
  cashFlowMethod?: 'DIRECT' | 'INDIRECT';
};

type TrialBalanceAmounts = {
  openingDebit: bigint;
  openingCredit: bigint;
  turnoverDebit: bigint;
  turnoverCredit: bigint;
  endingDebit: bigint;
  endingCredit: bigint;
  periodNetDebit: bigint;
  periodNetCredit: bigint;
};

type OfficialDatasetRow = {
  key: string;
  titlePersian: string;
  accountIds: string[];
  mappingSectionCodes: string[];
  amounts: TrialBalanceAmounts;
  drilldownLineIds: string[];
};

const normalBalance = (debit: bigint, credit: bigint) => debit >= credit
  ? { debit: debit - credit, credit: 0n }
  : { debit: 0n, credit: credit - debit };

const lineMatchesDimensions = (line: OfficialPostedLine, filters: Record<string, string> | undefined) => (
  !filters || Object.entries(filters).every(([key, value]) => line.dimensions[key] === value)
);

export const buildOfficialAccountingDataset = ({ request, mapping, lines }: {
  request: OfficialDatasetRequest;
  mapping: FinancialStatementMapping;
  lines: OfficialPostedLine[];
}) => {
  if (request.mappingVersionId && request.mappingVersionId !== mapping.id) throw new Error('نسخه نگاشت گزارش با درخواست رسمی مطابقت ندارد.');
  const mappingsByAccount = new Map<string, FinancialStatementMapping['rows']>();
  for (const row of mapping.rows) mappingsByAccount.set(row.accountId, [...(mappingsByAccount.get(row.accountId) ?? []), row]);
  const cashFlowRows = (rows: FinancialStatementMapping['rows']) => request.cashFlowMethod === 'INDIRECT'
    ? rows.filter((row) => row.statement === 'CASH_FLOW_INDIRECT')
    : rows.filter((row) => row.statement !== 'CASH_FLOW_INDIRECT');
  const primaryMappingByAccount = new Map([...mappingsByAccount].map(([accountId, rows]) => [accountId, cashFlowRows(rows)[0] ?? rows[0]]));
  const included = lines.filter((line) => (
    (line.status === 'POSTED' || line.status === 'REVERSED')
    && line.postedAt != null
    && line.postedAt <= request.cutoffAt
    && line.documentDate <= request.to
    && lineMatchesDimensions(line, request.dimensionFilters)
    && (request.reportKind !== 'CASH_FLOW' || (
      primaryMappingByAccount.get(line.accountId)?.cashFlowClass != null
      && primaryMappingByAccount.get(line.accountId)?.cashFlowClass !== 'INTERNAL_TRANSFER'
    ))
  ));
  const level = request.level ?? 'SUBSIDIARY';
  const buckets = new Map<string, { title: string; entries: Array<{ line: OfficialPostedLine; signMultiplier: number }> }>();
  for (const line of included) {
    const applicableMappings = request.reportKind === 'FINANCIAL_STATEMENT'
      ? (mappingsByAccount.get(line.accountId) ?? [undefined])
      : request.reportKind === 'CASH_FLOW'
        ? cashFlowRows(mappingsByAccount.get(line.accountId) ?? [])
      : [primaryMappingByAccount.get(line.accountId)];
    for (const mappingRow of applicableMappings) {
      const key = request.reportKind === 'LEGAL_BOOK' && (request.legalBookKind ?? 'JOURNAL') === 'JOURNAL'
        ? `${line.documentDate.toISOString()}:${line.voucherNumber ?? 0}:${line.id}`
      : request.reportKind === 'CASH_FLOW' ? request.cashFlowMethod === 'INDIRECT' ? mappingRow!.sectionCode : mappingRow!.cashFlowClass!
      : request.reportKind === 'FINANCIAL_STATEMENT' ? `${mappingRow?.statement ?? 'UNMAPPED'}:${mappingRow?.sectionCode ?? 'UNMAPPED'}`
      : level === 'GROUP' ? line.accountPath.group
      : level === 'GENERAL' ? `${line.accountPath.group}/${line.accountPath.general}`
        : level === 'DETAIL' ? `${line.accountCode}/${line.accountPath.detail ?? line.accountTitlePersian}`
          : line.accountCode;
      const title = request.reportKind === 'LEGAL_BOOK' && (request.legalBookKind ?? 'JOURNAL') === 'JOURNAL'
        ? `${line.voucherNumber?.toLocaleString('fa-IR') ?? 'بدون شماره'} · ${line.accountCode} · ${line.accountTitlePersian}`
      : request.reportKind === 'CASH_FLOW' && request.cashFlowMethod === 'INDIRECT' ? mappingRow!.sectionCode
      : request.reportKind === 'CASH_FLOW' ? ({
      OPERATING: 'جریان‌های نقدی عملیاتی', INVESTING: 'جریان‌های نقدی سرمایه‌گذاری', FINANCING: 'جریان‌های نقدی تأمین مالی',
    }[mappingRow!.cashFlowClass!] ?? mappingRow!.cashFlowClass!)
      : request.reportKind === 'FINANCIAL_STATEMENT' ? mappingRow?.sectionCode ?? 'فاقد نگاشت'
      : level === 'GROUP' ? line.accountPath.group
      : level === 'GENERAL' ? line.accountPath.general
        : level === 'DETAIL' ? line.accountPath.detail ?? line.accountTitlePersian
          : line.accountPath.subsidiary;
      const bucket: { title: string; entries: Array<{ line: OfficialPostedLine; signMultiplier: number }> }
        = buckets.get(key) ?? { title, entries: [] };
      bucket.entries.push({ line, signMultiplier: mappingRow?.signMultiplier ?? 1 });
      buckets.set(key, bucket);
    }
  }
  const rows: OfficialDatasetRow[] = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right, 'fa')).map(([key, bucket]) => {
    const amounts = (entry: { line: OfficialPostedLine; signMultiplier: number }) => entry.signMultiplier < 0
      ? { debit: entry.line.creditRials * BigInt(-entry.signMultiplier), credit: entry.line.debitRials * BigInt(-entry.signMultiplier) }
      : { debit: entry.line.debitRials * BigInt(entry.signMultiplier), credit: entry.line.creditRials * BigInt(entry.signMultiplier) };
    const openingEntries = bucket.entries.filter(({ line }) => line.documentDate < request.from);
    const turnoverEntries = bucket.entries.filter(({ line }) => line.documentDate >= request.from);
    const opening = normalBalance(sum(openingEntries.map((entry) => amounts(entry).debit)), sum(openingEntries.map((entry) => amounts(entry).credit)));
    const turnoverDebit = sum(turnoverEntries.map((entry) => amounts(entry).debit));
    const turnoverCredit = sum(turnoverEntries.map((entry) => amounts(entry).credit));
    const ending = normalBalance(opening.debit + turnoverDebit, opening.credit + turnoverCredit);
    const periodNet = normalBalance(turnoverDebit, turnoverCredit);
    const accountIds = [...new Set(bucket.entries.map(({ line }) => line.accountId))].sort();
    const mappingSectionCodes = [...new Set(mapping.rows.filter((row) => accountIds.includes(row.accountId)).map((row) => row.sectionCode))].sort();
    return {
      key,
      titlePersian: bucket.title,
      accountIds,
      mappingSectionCodes,
      amounts: {
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        turnoverDebit,
        turnoverCredit,
        endingDebit: ending.debit,
        endingCredit: ending.credit,
        periodNetDebit: periodNet.debit,
        periodNetCredit: periodNet.credit,
      },
      drilldownLineIds: [...new Set(bucket.entries.map(({ line }) => line.id))],
    };
  });
  const sourceLineIds = included.map((line) => line.id);
  const columns = request.columns ?? 8;
  const columnKeys = columns === 2
    ? ['endingDebit', 'endingCredit']
    : columns === 4
      ? ['turnoverDebit', 'turnoverCredit', 'endingDebit', 'endingCredit']
      : columns === 6
        ? ['openingDebit', 'openingCredit', 'turnoverDebit', 'turnoverCredit', 'endingDebit', 'endingCredit']
        : ['openingDebit', 'openingCredit', 'turnoverDebit', 'turnoverCredit', 'endingDebit', 'endingCredit', 'periodNetDebit', 'periodNetCredit'];
  const unsigned = {
    official: true as const,
    reportKind: request.reportKind,
    bookId: request.bookId,
    fiscalYearId: request.fiscalYearId,
    parameters: canonicalize(request as unknown as JsonLike),
    mappingVersionId: mapping.id,
    mappingEffectiveFrom: mapping.effectiveFrom,
    cutoffAt: request.cutoffAt,
    sourceLineIds,
    columns,
    columnKeys,
    rows,
  };
  return { ...unsigned, integrityHash: digest(unsigned as unknown as JsonLike) };
};

export const buildTAccountProjection = (input: {
  accountId: string;
  from: Date;
  to: Date;
  openingDebitRials: bigint;
  openingCreditRials: bigint;
  lines: OfficialPostedLine[];
  dimensionFilters?: Record<string, string>;
}) => {
  let running = normalBalance(input.openingDebitRials, input.openingCreditRials);
  const chronological = input.lines.filter((line) => (
    line.accountId === input.accountId
    && (line.status === 'POSTED' || line.status === 'REVERSED')
    && line.documentDate >= input.from
    && line.documentDate <= input.to
    && lineMatchesDimensions(line, input.dimensionFilters)
  )).sort((left, right) => (
    left.documentDate.getTime() - right.documentDate.getTime()
    || (left.voucherNumber ?? Number.MAX_SAFE_INTEGER) - (right.voucherNumber ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
  ));
  const entries = chronological.map((line) => {
    running = normalBalance(running.debit + line.debitRials, running.credit + line.creditRials);
    return {
      lineId: line.id,
      voucherNumber: line.voucherNumber,
      documentDate: line.documentDate,
      debitRials: line.debitRials,
      creditRials: line.creditRials,
      runningDebitRials: running.debit,
      runningCreditRials: running.credit,
      drilldown: { voucherId: line.voucherId, lineId: line.id },
    };
  });
  return {
    accountId: input.accountId,
    openingDebitRials: input.openingDebitRials,
    openingCreditRials: input.openingCreditRials,
    entries,
    endingDebitRials: running.debit,
    endingCreditRials: running.credit,
  };
};
