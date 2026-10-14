import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { createCustomerPostingRulePrisma } from '../accountingCustomerTreasuryPrisma';

export async function customerFinanceFixture(sourceDatabaseUrl: string) {
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl, migrateEmptySchema: true });
  const db = temporary.client();
  try {
    const actor = { id: 'customer-finance-accountant', profile: 'ACCOUNTANT' as const };
    const administration = createAccountingLedgerAdministration(db);
    const entity = await administration.setup({ legalEntity: { code: 'customer-finance', namePersian: 'شرکت آزمون', activeFrom: new Date('2026-01-01') }, book: { code: 'primary', namePersian: 'دفتر اصلی' }, scheme: { groupLength: 1, kolLength: 2, moinLength: 3 }, actorId: actor.id });
    const book = entity.books[0];
    const year = await administration.createFiscalYear({ bookId: book.id, code: '2026', titlePersian: 'سال آزمون', actorId: actor.id, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31T23:59:59.999Z'), periods: [{ code: '1', titlePersian: 'دوره آزمون', sequence: 1, isAdjustment: false, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31T23:59:59.999Z') }] });
    async function account(code: string, titlePersian: string, normalSide: 'DEBIT' | 'CREDIT', statementRole: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE', party = false, financial = false) {
      const common = { bookId: book.id, codeSchemeId: book.codeSchemes[0].id, normalSide, statementRole, currencyBehavior: 'BASE_ONLY' as const, effectiveFrom: year.startsAt, actorId: actor.id };
      const group = await administration.createAccount({ ...common, code, titlePersian, level: 'GROUP' });
      const kol = await administration.createAccount({ ...common, code: `${code}01`, titlePersian, parentId: group.id, level: 'KOL' });
      return administration.createAccount({ ...common, code: `${code}01001`, titlePersian, parentId: kol.id, level: 'MOIN', partyRequirement: party ? 'REQUIRED' : 'FORBIDDEN', financialAccountRequirement: financial ? 'REQUIRED' : 'FORBIDDEN' });
    }
    const [receivable, advance, bank, counter, tax, inventory, cost, checks, collection] = await Promise.all([
      account('1', 'دریافتنی', 'DEBIT', 'ASSET', true), account('2', 'پیش‌دریافت', 'CREDIT', 'LIABILITY', true),
      account('3', 'بانک', 'DEBIT', 'ASSET', false, true), account('4', 'حساب مقابل', 'CREDIT', 'REVENUE'),
      account('5', 'مالیات', 'CREDIT', 'LIABILITY', true), account('6', 'موجودی', 'DEBIT', 'ASSET'),
      account('7', 'هزینه', 'DEBIT', 'EXPENSE'), account('8', 'اسناد دریافتنی نزد صندوق', 'DEBIT', 'ASSET', true),
      account('9', 'اسناد در جریان وصول', 'DEBIT', 'ASSET', true),
    ]);
    const rule = await createCustomerPostingRulePrisma(db, { legalEntityId: entity.id, code: 'default', version: 1, receivableAccountId: receivable.id, customerAdvanceAccountId: advance.id, bankClearingAccountId: bank.id, revenueAccountId: counter.id, outputTaxAccountId: tax.id, inventoryAccountId: inventory.id, costAccountId: cost.id, effectiveFrom: year.startsAt, actor: { ...actor, profile: 'ACCOUNTING_MANAGER' } });
    const financial = await administration.createFinancialAccount({ legalEntityId: entity.id, kind: 'BANK', titlePersian: 'بانک آزمون', currency: 'IRR', activeFrom: year.startsAt, actorId: actor.id });
    const common = { periodId: year.periods[0].id, postingRuleId: rule.id, counterAccountId: counter.id, occurredAt: new Date('2026-10-01'), reason: 'ثبت مالی با مستندات آزمون', reference: 'مدرک آزمون', confirmed: true, actor };
    return { db, actor, book, year, rule, financial, bank, counter, receivable, advance, checks, collection, cost, common,
      customer: async () => `customer:${(await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: randomUUID() } })).id}`,
      close: async () => { await db.$disconnect(); await temporary.cleanup(); } };
  } catch (error) { await db.$disconnect(); await temporary.cleanup(); throw error; }
}
