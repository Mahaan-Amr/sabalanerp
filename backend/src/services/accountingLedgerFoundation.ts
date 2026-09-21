import { createHash } from 'node:crypto';

export type AccountingAccessProfile = 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER';
export type AccountingActor = { id: string; profile: AccountingAccessProfile; isGlobalAdmin?: boolean };
export const accountingAccessProfileFromPermission = (permission?: string | null): AccountingAccessProfile => (
  permission === 'admin' ? 'ACCOUNTING_MANAGER' : permission === 'edit' ? 'ACCOUNTANT' : 'VIEWER'
);
export type PostingPeriodState = 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED';
export type FiscalYearState = 'DRAFT' | 'ACTIVE' | 'SOFT_CLOSED' | 'HARD_CLOSED';
export type DimensionRequirement = 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';
export const IRR_ROUNDING_RULE_V1 = 'ریال-صحیح-نیم-به-بالا-نسخه-۱';
const SUPPORTED_TRANSACTION_CURRENCIES = new Set(['IRR', 'USD', 'EUR', 'AED', 'TRY', 'CNY', 'GBP']);

export type LedgerLineInput = Readonly<{
  accountId: string;
  partyId?: string;
  financialAccountId?: string;
  debitRials: bigint;
  creditRials: bigint;
  description?: string;
  dimensions: ReadonlyArray<{ typeId: string; memberId: string }>;
  originalAmount?: string;
  originalCurrency?: string;
  exchangeRate?: string;
  exchangeRateDate?: Date;
  exchangeRateSource?: string;
  rawAmountBeforeRounding?: string;
  roundingRuleVersion?: string;
  evidence: { type: string; id: string; version: number; hash: string; payload: unknown };
}>;

export type LedgerVoucherRecord = Readonly<{
  id: string;
  bookId: string;
  fiscalYearId: string;
  periodId: string;
  referenceNumber: string;
  statutoryNumber: number | null;
  idempotencyKey: string;
  correlationId: string;
  description: string;
  documentDate: Date;
  occurredAt: Date;
  recordedAt: Date;
  discoveredAt: Date | null;
  source: { type: string; id: string; version: number; hash: string; payload: unknown };
  actorId: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  debitTotalRials: bigint;
  creditTotalRials: bigint;
  contentHash: string;
  lines: ReadonlyArray<LedgerLineInput>;
  postedAt: Date | null;
  reversedAt: Date | null;
  reversalOfId: string | null;
}>;

export type PostingContext = Readonly<{
  book: { id: string; baseCurrency: 'IRR' };
  fiscalYear: { id: string; bookId: string; status: FiscalYearState };
  period: { id: string; fiscalYearId: string; status: PostingPeriodState; startsAt: Date; endsAt: Date };
  accounts: ReadonlyMap<string, {
    id: string;
    active: boolean;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    level: string;
    currencyBehavior: 'BASE_ONLY' | 'MULTI_CURRENCY';
    partyRequirement: DimensionRequirement;
    financialAccountRequirement: DimensionRequirement;
    dimensionRules: ReadonlyArray<{ dimensionTypeId: string; requirement: DimensionRequirement }>;
  }>;
  dimensionMembers: ReadonlyMap<string, ReadonlySet<string>>;
  partyIds: ReadonlySet<string>;
  financialAccountIds: ReadonlySet<string>;
}>;

export type DraftVoucherPersistence = Omit<
  LedgerVoucherRecord,
  'id' | 'status' | 'statutoryNumber' | 'postedAt' | 'reversedAt' | 'reversalOfId'
>;

export interface AccountingLedgerRepository {
  transaction<T>(operation: (repository: AccountingLedgerRepository) => Promise<T>): Promise<T>;
  getPostingContext(input: { bookId: string; fiscalYearId: string; periodId: string; documentDate: Date }): Promise<PostingContext>;
  findVoucherByIdempotencyKey(key: string): Promise<LedgerVoucherRecord | null>;
  findVoucherBySource(input: { bookId: string; type: string; id: string; version: number }): Promise<LedgerVoucherRecord | null>;
  createDraftVoucher(input: DraftVoucherPersistence): Promise<LedgerVoucherRecord>;
  getVoucherForUpdate(id: string): Promise<LedgerVoucherRecord | null>;
  allocateStatutoryNumber(input: { bookId: string; fiscalYearId: string }): Promise<number>;
  markVoucherPosted(input: { id: string; statutoryNumber: number; postedAt: Date; contentHash: string }): Promise<LedgerVoucherRecord>;
  createReversalVoucher(input: {
    original: LedgerVoucherRecord;
    referenceNumber: string;
    statutoryNumber: number;
    idempotencyKey: string;
    actorId: string;
    description: string;
    postedAt: Date;
    contentHash: string;
    commandHash: string;
    target: { fiscalYearId: string; periodId: string; documentDate: Date };
  }): Promise<LedgerVoucherRecord>;
  appendAudit(input: {
    action: string;
    result: 'SUCCEEDED' | 'DENIED';
    actorId: string;
    entityType: string;
    entityId: string;
    correlationId: string;
    reason?: string;
    payloadHash: string;
    effectiveProfile?: AccountingAccessProfile;
    sessionContext?: unknown;
  }): Promise<void>;
}

export class AccountingLedgerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
  }
}

type ManualDraftCommand = Readonly<{
  bookId: string;
  fiscalYearId: string;
  periodId: string;
  idempotencyKey: string;
  correlationId: string;
  description: string;
  documentDate: Date;
  occurredAt: Date;
  discoveredAt?: Date;
  source: { type: string; id: string; version: number; hash: string; payload: unknown };
  actor: AccountingActor;
  override?: { confirmed: boolean; reason: string };
  lines: ReadonlyArray<LedgerLineInput>;
}>;

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
  return value;
};

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export const hashAccountingEvidence = stableHash;

const canonicalDecimalForHash = (value?: string) => {
  if (value == null) return value;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] || '').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

const parsePositiveDecimal = (
  value: string | undefined,
  code: string,
  message: string,
  limits: { maxIntegralDigits: number; maxScale: number },
) => {
  const canonical = canonicalDecimalForHash(value);
  if (!canonical || !/^\d+(?:\.\d+)?$/.test(canonical)) throw new AccountingLedgerError(code, message, 400);
  const [whole, fraction = ''] = canonical.split('.');
  if (whole.replace(/^0+/, '').length > limits.maxIntegralDigits || fraction.length > limits.maxScale) {
    throw new AccountingLedgerError(code, message, 400);
  }
  const unscaled = BigInt(`${whole}${fraction}`);
  if (unscaled <= 0n) throw new AccountingLedgerError(code, message, 400);
  return { canonical, unscaled, scale: fraction.length };
};

const powersOfTen = (scale: number) => 10n ** BigInt(scale);
const decimalEqualsProduct = (
  left: { unscaled: bigint; scale: number },
  right: { unscaled: bigint; scale: number },
  expected: { unscaled: bigint; scale: number },
) => left.unscaled * right.unscaled * powersOfTen(expected.scale)
  === expected.unscaled * powersOfTen(left.scale + right.scale);

const decimalEquals = (
  left: { unscaled: bigint; scale: number },
  right: { unscaled: bigint; scale: number },
) => left.unscaled * powersOfTen(right.scale) === right.unscaled * powersOfTen(left.scale);

const roundPositiveDecimal = (value: { canonical: string }) => {
  const [whole, fraction = ''] = value.canonical.split('.');
  return BigInt(whole) + (fraction[0] && fraction[0] >= '5' ? 1n : 0n);
};

const voucherContentHash = (voucher: {
  bookId: string; fiscalYearId: string; periodId: string; idempotencyKey: string; correlationId: string;
  description: string; documentDate: Date; occurredAt: Date; discoveredAt?: Date | null;
  source: { type: string; id: string; version: number; hash: string; payload: unknown };
  lines: ReadonlyArray<LedgerLineInput>;
}) => stableHash({
  bookId: voucher.bookId,
  fiscalYearId: voucher.fiscalYearId,
  periodId: voucher.periodId,
  description: voucher.description,
  documentDate: voucher.documentDate,
  occurredAt: voucher.occurredAt,
  discoveredAt: voucher.discoveredAt ?? null,
  source: voucher.source,
  lines: voucher.lines.map((line) => ({
    ...line,
    originalAmount: canonicalDecimalForHash(line.originalAmount),
    exchangeRate: canonicalDecimalForHash(line.exchangeRate),
    rawAmountBeforeRounding: canonicalDecimalForHash(line.rawAmountBeforeRounding),
    dimensions: [...line.dimensions].sort((left, right) => (
      `${left.typeId}:${left.memberId}`.localeCompare(`${right.typeId}:${right.memberId}`)
    )),
  })),
});

const assertWriteProfile = (profile: AccountingAccessProfile) => {
  if (!['ACCOUNTANT', 'ACCOUNTING_MANAGER'].includes(profile)) {
    throw new AccountingLedgerError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات حسابداری برای این کاربر فعال نیست.', 403);
  }
};

const normalizedRequiredText = (value: string, code: string, message: string, minimum = 3) => {
  const normalized = String(value || '').trim();
  if (normalized.length < minimum) throw new AccountingLedgerError(code, message, 400);
  return normalized;
};

const assertContext = (context: PostingContext, command: ManualDraftCommand) => {
  if (context.book.id !== command.bookId || context.book.baseCurrency !== 'IRR') {
    throw new AccountingLedgerError('INVALID_BOOK', 'دفتر حسابداری یا ارز پایه آن معتبر نیست.', 400);
  }
  const overrideAllowed = Boolean(
    command.override?.confirmed
    && command.override.reason.trim().length >= 8
    && (command.actor.isGlobalAdmin || command.actor.profile === 'ACCOUNTING_MANAGER'),
  );
  if (context.fiscalYear.id !== command.fiscalYearId || context.fiscalYear.bookId !== command.bookId
      || (context.fiscalYear.status !== 'ACTIVE' && !(context.fiscalYear.status === 'SOFT_CLOSED' && overrideAllowed))) {
    throw new AccountingLedgerError('FISCAL_YEAR_NOT_ACTIVE', 'سال مالی انتخاب‌شده برای ثبت فعال نیست.', 409);
  }
  if (context.period.id !== command.periodId || context.period.fiscalYearId !== command.fiscalYearId
      || (context.period.status !== 'OPEN' && !(context.period.status === 'SOFT_CLOSED' && overrideAllowed))) {
    throw new AccountingLedgerError('PERIOD_NOT_OPEN', 'دوره حسابداری انتخاب‌شده باز نیست.', 409);
  }
  if (command.documentDate < context.period.startsAt || command.documentDate > context.period.endsAt) {
    throw new AccountingLedgerError('DOCUMENT_DATE_OUTSIDE_PERIOD', 'تاریخ سند خارج از محدوده دوره حسابداری است.', 400);
  }
};

const validateLines = (context: PostingContext, lines: ReadonlyArray<LedgerLineInput>, documentDate?: Date) => {
  if (lines.length < 2) throw new AccountingLedgerError('INSUFFICIENT_LINES', 'سند حسابداری باید دست‌کم دو آرتیکل داشته باشد.', 400);
  let debitTotalRials = 0n;
  let creditTotalRials = 0n;
  for (const line of lines) {
    if (line.debitRials < 0n || line.creditRials < 0n || (line.debitRials === 0n) === (line.creditRials === 0n)) {
      throw new AccountingLedgerError('INVALID_LINE_SIDES', 'هر آرتیکل باید فقط یک مبلغ بدهکار یا بستانکار مثبت داشته باشد.', 400);
    }
    const account = context.accounts.get(line.accountId);
    if (!account || !account.active || account.level !== 'MOIN'
        || (documentDate && account.effectiveFrom && documentDate < account.effectiveFrom)
        || (documentDate && account.effectiveTo && documentDate > account.effectiveTo)) {
      throw new AccountingLedgerError('ACCOUNT_NOT_POSTABLE', 'حساب انتخاب‌شده برای ثبت آرتیکل فعال و قابل ثبت نیست.', 400);
    }
    const currency = line.originalCurrency?.trim().toUpperCase();
    if (currency && !SUPPORTED_TRANSACTION_CURRENCIES.has(currency)) {
      throw new AccountingLedgerError('UNSUPPORTED_CURRENCY', 'ارز اولیه انتخاب‌شده در این نسخه پشتیبانی نمی‌شود.', 400);
    }
    if (account.currencyBehavior === 'BASE_ONLY' && currency && currency !== 'IRR') {
      throw new AccountingLedgerError('FOREIGN_AMOUNT_FORBIDDEN', 'حساب انتخاب‌شده ثبت مبلغ ارزی را نمی‌پذیرد.', 400);
    }
    const validateDetail = (requirement: DimensionRequirement, value: string | undefined, valid: ReadonlySet<string>, label: string) => {
      if (requirement === 'REQUIRED' && !value) throw new AccountingLedgerError('DETAIL_REQUIRED', `${label} برای حساب انتخاب‌شده الزامی است.`, 400);
      if (requirement === 'FORBIDDEN' && value) throw new AccountingLedgerError('DETAIL_FORBIDDEN', `${label} برای حساب انتخاب‌شده مجاز نیست.`, 400);
      if (value && !valid.has(value)) throw new AccountingLedgerError('INVALID_DETAIL', `${label} انتخاب‌شده فعال یا معتبر نیست.`, 400);
    };
    validateDetail(account.partyRequirement, line.partyId, context.partyIds, 'طرف حساب');
    validateDetail(account.financialAccountRequirement, line.financialAccountId, context.financialAccountIds, 'حساب مالی');
    const hasOriginalEvidence = Boolean(line.originalAmount || line.originalCurrency || line.exchangeRate || line.exchangeRateDate || line.exchangeRateSource);
    if (hasOriginalEvidence && (!line.originalAmount || !line.originalCurrency)) {
      throw new AccountingLedgerError('INCOMPLETE_ORIGINAL_AMOUNT', 'مبلغ و ارز اولیه باید با هم ثبت شوند.', 400);
    }
    if (currency && currency !== 'IRR'
        && (!line.exchangeRate || !line.exchangeRateDate || !line.exchangeRateSource)) {
      throw new AccountingLedgerError('INCOMPLETE_EXCHANGE_EVIDENCE', 'نرخ، تاریخ و منبع نرخ ارز برای ثبت ارزی الزامی است.', 400);
    }
    if (!line.rawAmountBeforeRounding || !line.roundingRuleVersion) {
      throw new AccountingLedgerError('ROUNDING_EVIDENCE_REQUIRED', 'مبلغ خام پیش از گردکردن و نسخه قاعده گردکردن برای هر آرتیکل الزامی است.', 400);
    }
    if (line.roundingRuleVersion !== IRR_ROUNDING_RULE_V1) {
      throw new AccountingLedgerError('UNSUPPORTED_ROUNDING_RULE', 'نسخه قاعده گردکردن آرتیکل پشتیبانی نمی‌شود.', 400);
    }
    const rawAmount = parsePositiveDecimal(line.rawAmountBeforeRounding, 'INVALID_RAW_AMOUNT', 'مبلغ خام باید مثبت و حداکثر دارای ۲۲ رقم صحیح و ۸ رقم اعشار باشد.', { maxIntegralDigits: 22, maxScale: 8 });
    const postedAmount = line.debitRials > 0n ? line.debitRials : line.creditRials;
    if (postedAmount.toString().length > 20) {
      throw new AccountingLedgerError('RIAL_AMOUNT_OUT_OF_RANGE', 'مبلغ ریالی آرتیکل از دامنه مجاز دفترکل بیشتر است.', 400);
    }
    if (roundPositiveDecimal(rawAmount) !== postedAmount) {
      throw new AccountingLedgerError('ROUNDING_RECONCILIATION_FAILED', 'مبلغ ریالی آرتیکل با مبلغ خام و قاعده گردکردن سازگار نیست.', 400);
    }
    if (line.originalAmount && currency) {
      const originalAmount = parsePositiveDecimal(line.originalAmount, 'INVALID_ORIGINAL_AMOUNT', 'مبلغ اولیه باید مثبت و حداکثر دارای ۲۲ رقم صحیح و ۸ رقم اعشار باشد.', { maxIntegralDigits: 22, maxScale: 8 });
      if (currency === 'IRR') {
        if (line.exchangeRate || line.exchangeRateDate || line.exchangeRateSource || !decimalEquals(originalAmount, rawAmount)) {
          throw new AccountingLedgerError('IRR_EVIDENCE_MISMATCH', 'مبلغ اولیه ریالی باید بدون نرخ تبدیل و برابر مبلغ خام باشد.', 400);
        }
      } else {
        const exchangeRate = parsePositiveDecimal(line.exchangeRate, 'INVALID_EXCHANGE_RATE', 'نرخ تبدیل باید مثبت و حداکثر دارای ۲۰ رقم صحیح و ۱۰ رقم اعشار باشد.', { maxIntegralDigits: 20, maxScale: 10 });
        if (!decimalEqualsProduct(originalAmount, exchangeRate, rawAmount)) {
          throw new AccountingLedgerError('FX_RECONCILIATION_FAILED', 'مبلغ اولیه، نرخ تبدیل و معادل ریالی آرتیکل با یکدیگر سازگار نیستند.', 400);
        }
      }
    }
    normalizedRequiredText(line.evidence?.type, 'LINE_EVIDENCE_TYPE_REQUIRED', 'نوع شاهد هر آرتیکل الزامی است.');
    normalizedRequiredText(line.evidence?.id, 'LINE_EVIDENCE_ID_REQUIRED', 'شناسه شاهد هر آرتیکل الزامی است.');
    normalizedRequiredText(line.evidence?.hash, 'LINE_EVIDENCE_HASH_REQUIRED', 'اثر انگشت شاهد هر آرتیکل الزامی است.', 8);
    if (!Number.isInteger(line.evidence?.version) || line.evidence.version < 1) {
      throw new AccountingLedgerError('INVALID_LINE_EVIDENCE_VERSION', 'نسخه شاهد آرتیکل معتبر نیست.', 400);
    }
    if (line.evidence.payload == null || stableHash(line.evidence.payload) !== line.evidence.hash) {
      throw new AccountingLedgerError('LINE_EVIDENCE_INTEGRITY_FAILED', 'محتوای شاهد آرتیکل با اثر انگشت ثبت‌شده سازگار نیست.', 400);
    }
    const suppliedTypes = new Set(line.dimensions.map(({ typeId }) => typeId));
    if (suppliedTypes.size !== line.dimensions.length || line.dimensions.some(({ typeId, memberId }) => !context.dimensionMembers.get(typeId)?.has(memberId))) {
      throw new AccountingLedgerError('INVALID_DIMENSION_MEMBER', 'مقدار تفصیلی انتخاب‌شده معتبر یا متعلق به این بُعد نیست.', 400);
    }
    const invalidRule = account.dimensionRules.find((rule) => (
      (rule.requirement === 'REQUIRED' && !suppliedTypes.has(rule.dimensionTypeId))
      || (rule.requirement === 'FORBIDDEN' && suppliedTypes.has(rule.dimensionTypeId))
    ));
    const declaredTypes = new Set(account.dimensionRules.map(({ dimensionTypeId }) => dimensionTypeId));
    const undeclared = line.dimensions.some(({ typeId }) => !declaredTypes.has(typeId));
    if (invalidRule || undeclared) {
      throw new AccountingLedgerError('INVALID_DIMENSIONS', 'ابعاد آرتیکل با قواعد حساب انتخاب‌شده سازگار نیست.', 400);
    }
    debitTotalRials += line.debitRials;
    creditTotalRials += line.creditRials;
  }
  if (debitTotalRials !== creditTotalRials) {
    throw new AccountingLedgerError('UNBALANCED_VOUCHER', 'جمع بدهکار و بستانکار سند برابر نیست.', 400);
  }
  return { debitTotalRials, creditTotalRials };
};

export const createAccountingLedgerApplication = (
  repository: AccountingLedgerRepository,
  dependencies: { now: () => Date; nextReference: () => string },
) => ({
  createManualDraft: async (command: ManualDraftCommand) => repository.transaction(async (tx) => {
    assertWriteProfile(command.actor.profile);
    const idempotencyKey = normalizedRequiredText(command.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'شناسه یکتای درخواست الزامی است.', 8);
    const correlationId = normalizedRequiredText(command.correlationId, 'CORRELATION_ID_REQUIRED', 'شناسه پیگیری درخواست الزامی است.', 3);
    const description = normalizedRequiredText(command.description, 'DESCRIPTION_REQUIRED', 'شرح سند الزامی است.');
    normalizedRequiredText(command.source?.type, 'SOURCE_TYPE_REQUIRED', 'نوع مدرک منشأ الزامی است.');
    normalizedRequiredText(command.source?.id, 'SOURCE_ID_REQUIRED', 'شناسه مدرک منشأ الزامی است.');
    normalizedRequiredText(command.source?.hash, 'SOURCE_HASH_REQUIRED', 'اثر انگشت مدرک منشأ الزامی است.', 8);
    if (!Number.isInteger(command.source?.version) || command.source.version < 1) {
      throw new AccountingLedgerError('INVALID_SOURCE_VERSION', 'نسخه مدرک منشأ معتبر نیست.', 400);
    }
    if (command.source.payload == null || stableHash(command.source.payload) !== command.source.hash) {
      throw new AccountingLedgerError('SOURCE_INTEGRITY_FAILED', 'محتوای مدرک منشأ با اثر انگشت ثبت‌شده سازگار نیست.', 400);
    }
    const contentHash = voucherContentHash({ ...command, description, idempotencyKey, correlationId });
    const existing = await tx.findVoucherByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.contentHash !== contentHash) {
        throw new AccountingLedgerError('IDEMPOTENCY_CONFLICT', 'این شناسه درخواست قبلاً برای محتوای دیگری استفاده شده است.', 409);
      }
      return existing;
    }
    const existingSource = await tx.findVoucherBySource({ bookId: command.bookId, ...command.source });
    if (existingSource) {
      if (existingSource.contentHash !== contentHash) {
        throw new AccountingLedgerError('SOURCE_CONFLICT', 'این نسخه مدرک منشأ قبلاً با محتوای دیگری ثبت شده است.', 409);
      }
      return existingSource;
    }
    const context = await tx.getPostingContext(command);
    assertContext(context, command);
    const totals = validateLines(context, command.lines, command.documentDate);
    const recordedAt = dependencies.now();
    const created = await tx.createDraftVoucher({
      bookId: command.bookId,
      fiscalYearId: command.fiscalYearId,
      periodId: command.periodId,
      referenceNumber: dependencies.nextReference(),
      idempotencyKey,
      correlationId,
      description,
      documentDate: command.documentDate,
      occurredAt: command.occurredAt,
      discoveredAt: command.discoveredAt ?? null,
      recordedAt,
      source: command.source,
      actorId: command.actor.id,
      debitTotalRials: totals.debitTotalRials,
      creditTotalRials: totals.creditTotalRials,
      contentHash,
      lines: command.lines,
    });
    await tx.appendAudit({
      action: 'LEDGER_DRAFT_CREATED', result: 'SUCCEEDED', actorId: command.actor.id,
      entityType: 'JOURNAL_VOUCHER', entityId: created.id, correlationId, payloadHash: contentHash,
      effectiveProfile: command.actor.profile,
      reason: command.override?.reason,
      sessionContext: command.override ? { emergencyOverride: true, confirmed: command.override.confirmed } : undefined,
    });
    return created;
  }),

  postVoucher: async (input: { voucherId: string; actor: AccountingActor; reason: string; override?: { confirmed: boolean; reason: string } }) => (
    repository.transaction(async (tx) => {
      assertWriteProfile(input.actor.profile);
      const reason = normalizedRequiredText(input.reason, 'POSTING_REASON_REQUIRED', 'دلیل قطعی‌سازی سند الزامی است.');
      const voucher = await tx.getVoucherForUpdate(input.voucherId);
      if (!voucher) throw new AccountingLedgerError('VOUCHER_NOT_FOUND', 'سند حسابداری پیدا نشد.', 404);
      if (voucher.status === 'POSTED' || voucher.status === 'REVERSED') return voucher;
      const context = await tx.getPostingContext(voucher);
      assertContext(context, { ...voucher, actor: input.actor, override: input.override } as unknown as ManualDraftCommand);
      const totals = validateLines(context, voucher.lines, voucher.documentDate);
      if (totals.debitTotalRials !== voucher.debitTotalRials || totals.creditTotalRials !== voucher.creditTotalRials) {
        throw new AccountingLedgerError('VOUCHER_CONTENT_CHANGED', 'محتوای سند با اثر ثبت‌شده آن سازگار نیست.', 409);
      }
      if (voucherContentHash(voucher) !== voucher.contentHash) {
        throw new AccountingLedgerError('VOUCHER_CONTENT_CHANGED', 'محتوای سند با اثر انگشت ثبت‌شده آن سازگار نیست.', 409);
      }
      const postedAt = dependencies.now();
      const statutoryNumber = await tx.allocateStatutoryNumber({ bookId: voucher.bookId, fiscalYearId: voucher.fiscalYearId });
      const posted = await tx.markVoucherPosted({ id: voucher.id, statutoryNumber, postedAt, contentHash: voucher.contentHash });
      await tx.appendAudit({
        action: 'LEDGER_VOUCHER_POSTED', result: 'SUCCEEDED', actorId: input.actor.id,
        entityType: 'JOURNAL_VOUCHER', entityId: voucher.id, correlationId: voucher.correlationId,
        reason, payloadHash: voucher.contentHash,
        effectiveProfile: input.actor.profile,
        sessionContext: input.override ? { emergencyOverride: true, confirmed: input.override.confirmed, reason: input.override.reason } : undefined,
      });
      return posted;
    })
  ),

  reverseVoucher: async (input: {
    voucherId: string;
    actor: AccountingActor;
    idempotencyKey: string;
    reason: string;
    targetFiscalYearId: string;
    targetPeriodId: string;
    documentDate: Date;
    override?: { confirmed: boolean; reason: string };
  }) => repository.transaction(async (tx) => {
    assertWriteProfile(input.actor.profile);
    const emergencyOverride = input.actor.isGlobalAdmin && input.actor.profile !== 'ACCOUNTING_MANAGER';
    if (!input.actor.isGlobalAdmin && input.actor.profile !== 'ACCOUNTING_MANAGER') {
      throw new AccountingLedgerError('REVERSAL_FORBIDDEN', 'برگشت سند فقط برای مدیر حسابداری مجاز است.', 403);
    }
    if (emergencyOverride) {
      const overrideReason = normalizedRequiredText(input.override?.reason ?? '', 'EMERGENCY_OVERRIDE_REASON_REQUIRED', 'دلیل استفاده از دسترسی اضطراری الزامی است.', 8);
      if (input.override?.confirmed !== true) {
        throw new AccountingLedgerError('EMERGENCY_OVERRIDE_CONFIRMATION_REQUIRED', 'استفاده از دسترسی اضطراری باید دوباره تأیید شود.', 400);
      }
      input.override = { confirmed: true, reason: overrideReason };
    }
    const idempotencyKey = normalizedRequiredText(input.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'شناسه یکتای درخواست الزامی است.', 8);
    const reason = normalizedRequiredText(input.reason, 'REVERSAL_REASON_REQUIRED', 'دلیل برگشت سند الزامی است.', 8);
    const original = await tx.getVoucherForUpdate(input.voucherId);
    if (!original) throw new AccountingLedgerError('VOUCHER_NOT_FOUND', 'سند حسابداری پیدا نشد.', 404);
    const target = { fiscalYearId: input.targetFiscalYearId, periodId: input.targetPeriodId, documentDate: input.documentDate };
    const commandHash = stableHash({
      originalVoucherId: original.id,
      reason,
      target,
      authority: emergencyOverride ? 'GLOBAL_ADMIN_WITH_ACCOUNTING_ACCESS' : 'ACCOUNTING_MANAGER',
      overrideReason: emergencyOverride ? input.override!.reason : null,
    });
    const existing = await tx.findVoucherByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.source.type !== 'LEDGER_REVERSAL'
          || existing.source.id !== original.id
          || (existing.source.payload as { commandHash?: string } | null)?.commandHash !== commandHash
          || existing.description !== `برگشت سند ${original.referenceNumber}: ${reason}`
          || existing.fiscalYearId !== input.targetFiscalYearId
          || existing.periodId !== input.targetPeriodId
          || existing.documentDate.getTime() !== input.documentDate.getTime()) {
        throw new AccountingLedgerError('IDEMPOTENCY_CONFLICT', 'این شناسه درخواست قبلاً برای برگشت دیگری استفاده شده است.', 409);
      }
      return existing;
    }
    if (original.status !== 'POSTED') throw new AccountingLedgerError('VOUCHER_NOT_REVERSIBLE', 'فقط سند قطعی و برگشت‌نخورده قابل برگشت است.', 409);
    const context = await tx.getPostingContext({ bookId: original.bookId, ...target });
    assertContext(context, { ...original, ...target, actor: input.actor, override: input.override } as unknown as ManualDraftCommand);
    const reversalLines = original.lines.map((line) => ({ ...line, debitRials: line.creditRials, creditRials: line.debitRials }));
    const reversalDebit = reversalLines.reduce((total, line) => total + line.debitRials, 0n);
    const reversalCredit = reversalLines.reduce((total, line) => total + line.creditRials, 0n);
    if (reversalLines.length < 2 || reversalDebit <= 0n || reversalDebit !== reversalCredit
        || reversalDebit !== original.creditTotalRials || reversalCredit !== original.debitTotalRials
        || reversalLines.some((line) => line.debitRials < 0n || line.creditRials < 0n
          || (line.debitRials === 0n) === (line.creditRials === 0n))) {
      throw new AccountingLedgerError('REVERSAL_INVARIANT_FAILED', 'سند برگشت با آرتیکل‌های قطعی سند اصلی سازگار نیست.', 409);
    }
    const postedAt = dependencies.now();
    const statutoryNumber = await tx.allocateStatutoryNumber({ bookId: original.bookId, fiscalYearId: input.targetFiscalYearId });
    const contentHash = stableHash({ originalId: original.id, originalHash: original.contentHash, reason, target, postedAt, statutoryNumber });
    const reversal = await tx.createReversalVoucher({
      original,
      referenceNumber: dependencies.nextReference(),
      statutoryNumber,
      idempotencyKey,
      actorId: input.actor.id,
      description: `برگشت سند ${original.referenceNumber}: ${reason}`,
      postedAt,
      contentHash,
      commandHash,
      target,
    });
    await tx.appendAudit({
      action: 'LEDGER_VOUCHER_REVERSED', result: 'SUCCEEDED', actorId: input.actor.id,
      entityType: 'JOURNAL_VOUCHER', entityId: original.id, correlationId: original.correlationId,
      reason, payloadHash: contentHash,
      effectiveProfile: input.actor.profile,
      sessionContext: emergencyOverride
        ? { emergencyOverride: true, confirmed: true, reason: input.override!.reason, authority: 'GLOBAL_ADMIN_WITH_ACCOUNTING_ACCESS' }
        : undefined,
    });
    return reversal;
  }),
});
