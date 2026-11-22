import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { createCustomerPostingRulePrisma } from '../accountingCustomerTreasuryPrisma';

export async function customerFinanceFixture(sourceDatabaseUrl: string) {
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl, migrateEmptySchema: true });
  const db = temporary.client();
  try {
    return { ...await customerFinanceData(db), close: async () => { await db.$disconnect(); await temporary.cleanup(); } };
  } catch (error) { await db.$disconnect(); await temporary.cleanup(); throw error; }
}

/** Seed the established financial fixture into a caller-owned isolated database.
 * The caller retains connection/database cleanup ownership.
 */
export async function customerFinanceData(db: PrismaClient, options?: { reuseConfiguredLedger: true }) {
  const actor = { id: 'customer-finance-accountant', profile: 'ACCOUNTANT' as const };
  const administration = createAccountingLedgerAdministration(db);
  const occurredAt = new Date('2026-10-01');
  const configured = options?.reuseConfiguredLedger ? await configuredCustomerFixtureLedger(db, occurredAt) : null;
  const entity = configured?.entity ?? await administration.setup({ legalEntity: { code: 'customer-finance', namePersian: 'شرکت آزمون', activeFrom: new Date('2026-01-01') }, book: { code: 'primary', namePersian: 'دفتر اصلی' }, scheme: { groupLength: 1, kolLength: 2, moinLength: 3 }, actorId: actor.id });
  const book = configured?.book ?? entity.books[0];
  const year = configured?.year ?? await administration.createFiscalYear({ bookId: book.id, code: '2026', titlePersian: 'سال آزمون', actorId: actor.id, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31T23:59:59.999Z'), periods: [{ code: '1', titlePersian: 'دوره آزمون', sequence: 1, isAdjustment: false, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31T23:59:59.999Z') }] });
  const effectiveFrom = configured ? occurredAt : year.startsAt;
  const groups = configured?.groups ?? ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const kolSuffix = '1'.padStart(book.codeSchemes[0].kolLength, '0'), moinSuffix = '1'.padStart(book.codeSchemes[0].moinLength, '0');
  async function account(code: string, titlePersian: string, normalSide: 'DEBIT' | 'CREDIT', statementRole: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE', party = false, financial = false) {
    const common = { bookId: book.id, codeSchemeId: book.codeSchemes[0].id, normalSide, statementRole, currencyBehavior: 'BASE_ONLY' as const, effectiveFrom, actorId: actor.id };
    const group = await administration.createAccount({ ...common, code, titlePersian, level: 'GROUP' });
    const kol = await administration.createAccount({ ...common, code: code + kolSuffix, titlePersian, parentId: group.id, level: 'KOL' });
    return administration.createAccount({ ...common, code: code + kolSuffix + moinSuffix, titlePersian, parentId: kol.id, level: 'MOIN', partyRequirement: party ? 'REQUIRED' : 'FORBIDDEN', financialAccountRequirement: financial ? 'REQUIRED' : 'FORBIDDEN' });
  }
  const [receivable, advance, bank, counter, tax, inventory, cost, checks, collection] = await Promise.all([
    account(groups[0], 'دریافتنی', 'DEBIT', 'ASSET', true), account(groups[1], 'پیش‌دریافت', 'CREDIT', 'LIABILITY', true),
    account(groups[2], 'بانک', 'DEBIT', 'ASSET', false, true), account(groups[3], 'حساب مقابل', 'CREDIT', 'REVENUE'),
    account(groups[4], 'مالیات', 'CREDIT', 'LIABILITY', true), account(groups[5], 'موجودی', 'DEBIT', 'ASSET'),
    account(groups[6], 'هزینه', 'DEBIT', 'EXPENSE'), account(groups[7], 'اسناد دریافتنی نزد صندوق', 'DEBIT', 'ASSET', true),
    account(groups[8], 'اسناد در جریان وصول', 'DEBIT', 'ASSET', true),
  ]);
  const rule = await createCustomerPostingRulePrisma(db, { legalEntityId: entity.id, code: configured ? 'qa-customer-' + randomUUID() : 'default', version: 1, receivableAccountId: receivable.id, customerAdvanceAccountId: advance.id, bankClearingAccountId: bank.id, revenueAccountId: counter.id, outputTaxAccountId: tax.id, inventoryAccountId: inventory.id, costAccountId: cost.id, effectiveFrom, actor: { ...actor, profile: 'ACCOUNTING_MANAGER' } });
  const financial = await administration.createFinancialAccount({ legalEntityId: entity.id, kind: 'BANK', titlePersian: 'بانک آزمون', currency: 'IRR', activeFrom: effectiveFrom, actorId: actor.id });
  const common = { periodId: year.periods[0].id, postingRuleId: rule.id, counterAccountId: counter.id, occurredAt, reason: 'ثبت مالی با مستندات آزمون', reference: 'مدرک آزمون', confirmed: true, actor };
  return { db, actor, book, year, rule, financial, bank, counter, receivable, advance, checks, collection, cost, common,
    customer: async () => `customer:${(await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: randomUUID() } })).id}` };
}

/** A restored real ledger is already configured. Reuse its unchanged primary
 * book, current scheme and open period; allocate only unused synthetic codes.
 * This opt-in is confined to caller-owned isolated qualification databases. */
async function configuredCustomerFixtureLedger(db: PrismaClient, at: Date) {
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database()::text AS name`;
  if (!/^qa_customer_expansion_[a-f0-9]{32}$/.test(name)) throw new Error('CONFIGURED_CUSTOMER_FIXTURE_REQUIRES_ISOLATED_DATABASE');
  const entities = await db.accountingLegalEntity.findMany({ include: { books: { where: { isPrimary: true }, include: {
    codeSchemes: { where: { retiredAt: null, effectiveFrom: { lte: at } }, orderBy: { version: 'desc' }, take: 1 },
    fiscalYears: { where: { startsAt: { lte: at }, endsAt: { gte: at } }, include: { periods: {
      where: { status: 'OPEN', startsAt: { lte: at }, endsAt: { gte: at } }, orderBy: { sequence: 'asc' },
    } } },
  } } } });
  const entity = entities[0], book = entity?.books[0], scheme = book?.codeSchemes[0], year = book?.fiscalYears[0];
  if (entities.length !== 1 || entity.baseCurrency !== 'IRR' || entity.books.length !== 1 || book.baseCurrency !== 'IRR'
    || book.codeSchemes.length !== 1 || book.fiscalYears.length !== 1 || year.periods.length !== 1
    || entity.activeFrom > at || (entity.activeTo && entity.activeTo < at)
    || [scheme.groupLength, scheme.kolLength, scheme.moinLength].some(value => !Number.isInteger(value) || value < 1 || value > 8)) {
    throw new Error('CONFIGURED_CUSTOMER_FIXTURE_LEDGER_UNSUPPORTED');
  }
  const used = new Set((await db.accountingLedgerAccount.findMany({ where: { bookId: book.id, level: 'GROUP' }, select: { code: true } })).map(row => row.code));
  const groups: string[] = [];
  for (let value = 10n ** BigInt(scheme.groupLength) - 1n, attempts = 0; value >= 1n && groups.length < 9 && attempts < used.size + 9; value--, attempts++) {
    const code = value.toString().padStart(scheme.groupLength, '0'); if (!used.has(code)) groups.push(code);
  }
  if (groups.length !== 9) throw new Error('CONFIGURED_CUSTOMER_FIXTURE_CODES_UNAVAILABLE');
  return { entity, book, year, groups };
}
