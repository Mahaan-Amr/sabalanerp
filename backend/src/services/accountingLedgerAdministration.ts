import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AccountingLedgerError } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

type PeriodDefinition = { startsAt: Date; endsAt: Date; isAdjustment: boolean };
type SchemeLengths = { groupLength: number; kolLength: number; moinLength: number };
type AccountDefinition = { code: string; level: 'GROUP' | 'KOL' | 'MOIN'; parent?: { code: string; level: 'GROUP' | 'KOL' | 'MOIN' } | null };

const nextMillisecond = (date: Date) => date.getTime() + 1;

export const validateFiscalPeriodCoverage = (startsAt: Date, endsAt: Date, periods: PeriodDefinition[]) => {
  if (endsAt < startsAt) throw new AccountingLedgerError('INVALID_FISCAL_RANGE', 'پایان سال مالی باید پس از شروع آن باشد.', 400);
  const operational = periods.filter((period) => !period.isAdjustment).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!operational.length || operational[0].startsAt.getTime() !== startsAt.getTime() || operational.at(-1)?.endsAt.getTime() !== endsAt.getTime()) {
    throw new AccountingLedgerError('INCOMPLETE_PERIOD_COVERAGE', 'دوره‌ها باید تمام سال مالی را بدون فاصله پوشش دهند.', 400);
  }
  for (let index = 0; index < operational.length; index += 1) {
    const period = operational[index];
    if (period.endsAt < period.startsAt || (index > 0 && period.startsAt.getTime() !== nextMillisecond(operational[index - 1].endsAt))) {
      throw new AccountingLedgerError('INVALID_PERIOD_BOUNDARIES', 'دوره‌ها باید بدون فاصله و هم‌پوشانی پشت سر هم باشند.', 400);
    }
  }
  for (const adjustment of periods.filter((period) => period.isAdjustment)) {
    if (adjustment.startsAt < startsAt || adjustment.endsAt > endsAt || adjustment.endsAt < adjustment.startsAt) {
      throw new AccountingLedgerError('INVALID_ADJUSTMENT_PERIOD', 'دوره تعدیلات باید داخل سال مالی باشد.', 400);
    }
  }
};

export const validateAccountDefinition = (scheme: SchemeLengths, account: AccountDefinition) => {
  const lengths = {
    GROUP: scheme.groupLength,
    KOL: scheme.groupLength + scheme.kolLength,
    MOIN: scheme.groupLength + scheme.kolLength + scheme.moinLength,
  };
  if (!/^\d+$/.test(account.code) || account.code.length !== lengths[account.level]) {
    throw new AccountingLedgerError('INVALID_ACCOUNT_CODE', 'طول کد حساب با الگوی نسخه کدینگ سازگار نیست.', 400);
  }
  const parentLevel = { GROUP: null, KOL: 'GROUP', MOIN: 'KOL' } as const;
  const requiredParent = parentLevel[account.level];
  if ((requiredParent && (!account.parent || account.parent.level !== requiredParent || !account.code.startsWith(account.parent.code))) || (!requiredParent && account.parent)) {
    throw new AccountingLedgerError('INVALID_ACCOUNT_PARENT', 'والد مستقیم حساب با سلسله‌مراتب گروه، کل و معین سازگار نیست.', 400);
  }
};

const appendAdministrationAudit = async (tx: Prisma.TransactionClient, input: {
  action: string; actorId: string; entityType: string; entityId: string; reason: string; payload: unknown;
  profile?: 'ACCOUNTANT' | 'ACCOUNTING_MANAGER';
}) => createAccountingLedgerPrismaRepository(tx, true).appendAudit({
  action: input.action,
  result: 'SUCCEEDED',
  actorId: input.actorId,
  effectiveProfile: input.profile ?? 'ACCOUNTING_MANAGER',
  entityType: input.entityType,
  entityId: input.entityId,
  correlationId: randomUUID(),
  reason: input.reason,
  payloadHash: createHash('sha256').update(JSON.stringify(input.payload)).digest('hex'),
  sessionContext: input.payload,
});

export const createAccountingLedgerAdministration = (database: PrismaClient) => ({
  getContext: async () => database.accountingLegalEntity.findFirst({
    where: { activeTo: null },
    include: {
      books: {
        where: { isPrimary: true },
        include: {
          fiscalYears: { include: { periods: { orderBy: { sequence: 'asc' } } }, orderBy: { startsAt: 'desc' } },
          codeSchemes: { orderBy: { version: 'desc' }, take: 1 },
          accounts: { include: { dimensionRules: true }, orderBy: { code: 'asc' } },
          dimensionTypes: { include: { members: true }, orderBy: { code: 'asc' } },
        },
      },
      parties: { include: { roles: true }, orderBy: { displayName: 'asc' } },
      financialAccounts: { orderBy: { titlePersian: 'asc' } },
    },
  }),

  setup: async (input: {
    legalEntity: { code: string; namePersian: string; nationalId?: string; economicCode?: string; activeFrom: Date };
    book: { code: string; namePersian: string };
    scheme: SchemeLengths;
    actorId: string;
  }) => database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounting:legal-entity:setup'))`;
    if (await tx.accountingLegalEntity.count()) throw new AccountingLedgerError('LEDGER_ALREADY_CONFIGURED', 'واحد گزارشگر حسابداری قبلاً پیکربندی شده است.', 409);
    if (!input.legalEntity.code.trim() || input.legalEntity.namePersian.trim().length < 2 || !input.book.code.trim() || input.book.namePersian.trim().length < 2) {
      throw new AccountingLedgerError('INVALID_LEDGER_IDENTITY', 'کد و عنوان فارسی واحد گزارشگر و دفتر اصلی الزامی است.', 400);
    }
    if (Object.values(input.scheme).some((length) => !Number.isInteger(length) || length < 1)) {
      throw new AccountingLedgerError('INVALID_CODE_SCHEME', 'طول بخش‌های کدینگ باید عدد صحیح مثبت باشد.', 400);
    }
    const created = await tx.accountingLegalEntity.create({
      data: {
        ...input.legalEntity,
        baseCurrency: 'IRR',
        createdBy: input.actorId,
        books: {
          create: {
            ...input.book,
            baseCurrency: 'IRR',
            isPrimary: true,
            createdBy: input.actorId,
            codeSchemes: { create: { version: 1, effectiveFrom: input.legalEntity.activeFrom, ...input.scheme, createdBy: input.actorId } },
          },
        },
      },
      include: { books: { include: { codeSchemes: true } } },
    });
    await appendAdministrationAudit(tx, { action: 'LEDGER_CONFIGURED', actorId: input.actorId, entityType: 'LEGAL_ENTITY', entityId: created.id, reason: 'راه‌اندازی دفترکل', payload: { code: created.code, bookId: created.books[0]?.id } });
    return created;
  }),

  createFiscalYear: async (input: {
    bookId: string; code: string; titlePersian: string; startsAt: Date; endsAt: Date; actorId: string;
    periods: Array<PeriodDefinition & { code: string; titlePersian: string; sequence: number }>;
  }) => database.$transaction(async (tx) => {
    validateFiscalPeriodCoverage(input.startsAt, input.endsAt, input.periods);
    if (!input.code.trim() || input.titlePersian.trim().length < 2) throw new AccountingLedgerError('INVALID_FISCAL_IDENTITY', 'کد و عنوان فارسی سال مالی الزامی است.', 400);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'accounting:fiscal-year:' + input.bookId}))`;
    const overlap = await tx.accountingFiscalYear.findFirst({
      where: { bookId: input.bookId, startsAt: { lte: input.endsAt }, endsAt: { gte: input.startsAt } },
      select: { id: true },
    });
    if (overlap) throw new AccountingLedgerError('FISCAL_YEAR_OVERLAP', 'بازه سال مالی با سال مالی دیگری هم‌پوشانی دارد.', 409);
    const created = await tx.accountingFiscalYear.create({
      data: {
        bookId: input.bookId, code: input.code, titlePersian: input.titlePersian,
        startsAt: input.startsAt, endsAt: input.endsAt, status: 'ACTIVE', createdBy: input.actorId,
        periods: { create: input.periods.map((period) => ({ ...period, status: 'OPEN' })) },
      },
      include: { periods: { orderBy: { sequence: 'asc' } } },
    });
    await appendAdministrationAudit(tx, { action: 'FISCAL_YEAR_CREATED', actorId: input.actorId, entityType: 'FISCAL_YEAR', entityId: created.id, reason: 'تعریف سال مالی', payload: { code: created.code, startsAt: created.startsAt, endsAt: created.endsAt, periods: created.periods.length } });
    return created;
  }),

  createAccount: async (input: {
    bookId: string; codeSchemeId: string; code: string; titlePersian: string;
    level: 'GROUP' | 'KOL' | 'MOIN'; normalSide: 'DEBIT' | 'CREDIT';
    statementRole: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'OTHER_COMPREHENSIVE_INCOME' | 'MEMO';
    currencyBehavior: 'BASE_ONLY' | 'MULTI_CURRENCY'; parentId?: string; effectiveFrom: Date; actorId: string;
    contraAccountId?: string;
    partyRequirement?: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';
    financialAccountRequirement?: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';
    dimensionRules?: Array<{ dimensionTypeId: string; requirement: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN' }>;
  }) => database.$transaction(async (tx) => {
    const [scheme, parent, contraAccount] = await Promise.all([
      tx.accountingCodeScheme.findUnique({ where: { id: input.codeSchemeId } }),
      input.parentId ? tx.accountingLedgerAccount.findUnique({ where: { id: input.parentId } }) : null,
      input.contraAccountId ? tx.accountingLedgerAccount.findUnique({ where: { id: input.contraAccountId } }) : null,
    ]);
    if (!scheme || scheme.bookId !== input.bookId) throw new AccountingLedgerError('CODE_SCHEME_NOT_FOUND', 'نسخه کدینگ معتبر نیست.', 404);
    if (input.contraAccountId && (!contraAccount || contraAccount.bookId !== input.bookId)) throw new AccountingLedgerError('INVALID_CONTRA_ACCOUNT', 'حساب کاهنده انتخاب‌شده معتبر نیست.', 400);
    if (input.titlePersian.trim().length < 2) throw new AccountingLedgerError('ACCOUNT_TITLE_REQUIRED', 'عنوان فارسی حساب الزامی است.', 400);
    validateAccountDefinition(scheme, { code: input.code, level: input.level, parent });
    const { actorId, dimensionRules, contraAccountId, ...account } = input;
    const created = await tx.accountingLedgerAccount.create({
      data: {
        ...account,
        contraAccountId: contraAccountId || undefined,
        createdBy: actorId,
        dimensionRules: { create: dimensionRules || [] },
      },
      include: { dimensionRules: true },
    });
    await appendAdministrationAudit(tx, { action: 'LEDGER_ACCOUNT_CREATED', actorId, entityType: 'LEDGER_ACCOUNT', entityId: created.id, reason: 'افزودن حساب به کدینگ', payload: { code: created.code, level: created.level, parentId: created.parentId } });
    return created;
  }),

  retireAccount: async (input: { accountId: string; actorId: string; reason: string; successorAccountId?: string }) => database.$transaction(async (tx) => {
    if (input.reason.trim().length < 8) throw new AccountingLedgerError('RETIREMENT_REASON_REQUIRED', 'دلیل غیرفعال‌سازی حساب باید دست‌کم هشت نویسه باشد.', 400);
    const account = await tx.accountingLedgerAccount.findUnique({ where: { id: input.accountId }, include: { children: { where: { retiredAt: null } } } });
    if (!account) throw new AccountingLedgerError('ACCOUNT_NOT_FOUND', 'حساب پیدا نشد.', 404);
    if (account.retiredAt) return account;
    if (account.children.length) throw new AccountingLedgerError('ACTIVE_CHILD_ACCOUNTS', 'پیش از غیرفعال‌سازی، حساب‌های فرزند فعال را تعیین تکلیف کنید.', 409);
    if (input.successorAccountId) {
      const successor = await tx.accountingLedgerAccount.findUnique({ where: { id: input.successorAccountId } });
      if (!successor || successor.bookId !== account.bookId || successor.level !== account.level || successor.retiredAt) {
        throw new AccountingLedgerError('INVALID_SUCCESSOR_ACCOUNT', 'حساب جانشین معتبر و هم‌سطح نیست.', 400);
      }
    }
    const retired = await tx.accountingLedgerAccount.update({ where: { id: account.id }, data: {
      retiredAt: new Date(), retiredBy: input.actorId, retirementReason: input.reason.trim(),
      successorAccountId: input.successorAccountId, meaningLockedAt: account.meaningLockedAt ?? new Date(),
    } });
    await appendAdministrationAudit(tx, { action: 'LEDGER_ACCOUNT_RETIRED', actorId: input.actorId, entityType: 'LEDGER_ACCOUNT', entityId: account.id, reason: input.reason.trim(), payload: { successorAccountId: input.successorAccountId } });
    return retired;
  }),

  ensurePartyRole: async (input: {
    legalEntityId: string; sourceKind: string; sourceId: string; displayName: string; nationalId?: string;
    role: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER'; effectiveFrom: Date; actorId: string;
  }) => database.$transaction(async (tx) => {
    const identity = { legalEntityId_sourceKind_sourceId: { legalEntityId: input.legalEntityId, sourceKind: input.sourceKind, sourceId: input.sourceId } };
    const existingParty = await tx.accountingParty.findUnique({ where: identity });
    if (existingParty?.activeTo) throw new AccountingLedgerError('PARTY_INACTIVE', 'هویت غیرفعال طرف حساب باید با فرایند اصلاح کنترل‌شده فعال شود.', 409);
    // Identity attributes are historical facts owned by their source system.
    // Adding a role must never rewrite the name or national identity in place.
    const party = existingParty ?? await tx.accountingParty.create({ data: {
      legalEntityId: input.legalEntityId, sourceKind: input.sourceKind, sourceId: input.sourceId,
      displayName: input.displayName, nationalId: input.nationalId, activeFrom: input.effectiveFrom,
    } });
    const existing = await tx.accountingPartyRoleAssignment.findFirst({ where: { partyId: party.id, role: input.role, effectiveTo: null } });
    if (!existing) await tx.accountingPartyRoleAssignment.create({ data: { partyId: party.id, role: input.role, effectiveFrom: input.effectiveFrom, createdBy: input.actorId } });
    const result = await tx.accountingParty.findUniqueOrThrow({ where: { id: party.id }, include: { roles: true } });
    await appendAdministrationAudit(tx, { action: 'PARTY_ROLE_ENSURED', actorId: input.actorId, entityType: 'PARTY', entityId: party.id, reason: 'ایجاد یا فعال‌سازی نقش طرف حساب', payload: { sourceKind: input.sourceKind, sourceId: input.sourceId, role: input.role }, profile: 'ACCOUNTANT' });
    return result;
  }),

  createFinancialAccount: async (input: {
    legalEntityId: string; kind: 'BANK' | 'CASH' | 'OTHER'; titlePersian: string; institutionName?: string;
    branchName?: string; accountNumber?: string; iban?: string; currency?: string; activeFrom: Date; actorId: string;
  }) => database.$transaction(async (tx) => {
    const created = await tx.accountingFinancialAccount.create({ data: {
      legalEntityId: input.legalEntityId, kind: input.kind, titlePersian: input.titlePersian,
      institutionName: input.institutionName, branchName: input.branchName, accountNumber: input.accountNumber,
      iban: input.iban, currency: input.currency || 'IRR', activeFrom: input.activeFrom, createdBy: input.actorId,
    } });
    await appendAdministrationAudit(tx, { action: 'FINANCIAL_ACCOUNT_CREATED', actorId: input.actorId, entityType: 'FINANCIAL_ACCOUNT', entityId: created.id, reason: 'تعریف حساب مالی', payload: { kind: created.kind, currency: created.currency, iban: created.iban } });
    return created;
  }),

  updatePeriodStatus: async (input: {
    periodId: string; status: 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED'; actorId: string; reason: string;
  }) => database.$transaction(async (tx) => {
    if (input.reason.trim().length < 8) throw new AccountingLedgerError('PERIOD_REASON_REQUIRED', 'دلیل تغییر وضعیت دوره باید دست‌کم هشت نویسه باشد.', 400);
    // Shares the exact lock used by posting. Once this transition validates,
    // no concurrent posting can slip across the resulting period boundary.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.periodId}))`;
    const period = await tx.accountingPostingPeriod.findUnique({ where: { id: input.periodId } });
    if (!period) throw new AccountingLedgerError('PERIOD_NOT_FOUND', 'دوره حسابداری پیدا نشد.', 404);
    const allowed: Record<string, string[]> = { OPEN: ['SOFT_CLOSED'], SOFT_CLOSED: ['OPEN', 'HARD_CLOSED'], HARD_CLOSED: [] };
    if (!allowed[period.status].includes(input.status)) throw new AccountingLedgerError('INVALID_PERIOD_TRANSITION', 'تغییر وضعیت دوره از این حالت مجاز نیست.', 409);
    if (input.status === 'HARD_CLOSED') {
      const draftCount = await tx.accountingLedgerVoucher.count({ where: { periodId: period.id, status: 'DRAFT' } });
      if (draftCount) throw new AccountingLedgerError('PERIOD_HAS_DRAFTS', 'تا تعیین تکلیف همه پیش‌نویس‌ها، بستن قطعی دوره مجاز نیست.', 409);
    }
    const updated = await tx.accountingPostingPeriod.update({
      where: { id: period.id },
      data: input.status === 'OPEN'
        ? { status: 'OPEN', closedAt: null, closedBy: null, closeReason: null }
        : { status: input.status, closedAt: new Date(), closedBy: input.actorId, closeReason: input.reason.trim() },
    });
    await appendAdministrationAudit(tx, { action: `POSTING_PERIOD_${input.status}`, actorId: input.actorId, entityType: 'POSTING_PERIOD', entityId: period.id, reason: input.reason.trim(), payload: { before: period.status, after: input.status } });
    return updated;
  }, { isolationLevel: 'Serializable' }),

  createDimensionType: async (input: { bookId: string; code: string; titlePersian: string; sourceKind: string; effectiveFrom: Date; actorId: string }) => database.$transaction(async (tx) => {
    if (!input.code.trim() || input.titlePersian.trim().length < 2) throw new AccountingLedgerError('INVALID_DIMENSION', 'کد و عنوان فارسی بُعد الزامی است.', 400);
    const { actorId, ...definition } = input;
    const created = await tx.accountingDimensionType.create({ data: { ...definition, createdBy: actorId } });
    await appendAdministrationAudit(tx, { action: 'DIMENSION_TYPE_CREATED', actorId: input.actorId, entityType: 'DIMENSION_TYPE', entityId: created.id, reason: 'تعریف بُعد حسابداری', payload: { code: created.code, sourceKind: created.sourceKind } });
    return created;
  }),

  ensureDimensionMember: async (input: { dimensionTypeId: string; sourceId: string; code?: string; titlePersian: string; effectiveFrom: Date; actorId: string }) => database.$transaction(async (tx) => {
    if (!input.sourceId.trim() || input.titlePersian.trim().length < 2) throw new AccountingLedgerError('INVALID_DIMENSION_MEMBER', 'شناسه منبع و عنوان فارسی تفصیلی الزامی است.', 400);
    const type = await tx.accountingDimensionType.findUnique({ where: { id: input.dimensionTypeId } });
    if (!type) throw new AccountingLedgerError('DIMENSION_NOT_FOUND', 'بُعد حسابداری پیدا نشد.', 404);
    const member = await tx.accountingDimensionMember.upsert({
      where: { dimensionTypeId_sourceId: { dimensionTypeId: type.id, sourceId: input.sourceId.trim() } },
      create: { dimensionTypeId: type.id, sourceId: input.sourceId.trim(), code: input.code, titlePersian: input.titlePersian.trim(), effectiveFrom: input.effectiveFrom },
      update: { code: input.code, titlePersian: input.titlePersian.trim(), effectiveTo: null },
    });
    await appendAdministrationAudit(tx, { action: 'DIMENSION_MEMBER_ENSURED', actorId: input.actorId, entityType: 'DIMENSION_MEMBER', entityId: member.id, reason: 'ایجاد یا فعال‌سازی تفصیلی', payload: { dimensionTypeId: type.id, sourceId: member.sourceId } });
    return member;
  }),
});
