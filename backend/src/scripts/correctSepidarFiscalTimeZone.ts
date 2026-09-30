import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertLocalSepidarHistoricalPosting } from '../services/accountingSepidarLedgerReconciliation';
import { createAccountingLedgerPrismaRepository } from '../services/accountingLedgerPrismaRepository';
import { sepidarLocalDayStart } from '../services/sepidarCalendar';
import { voucherContentHash } from '../services/accountingLedgerFoundation';

const bookId = 'cmub2hd63007zrqlphrzi5eey';
const actorId = 'sepidar-user-approved-development-import';
const nextDay = (date: Date) => new Date(date.getTime() + 1).toISOString().slice(0, 10);
const startOf = (date: Date) => sepidarLocalDayStart(date.toISOString().slice(0, 10));
const endOf = (date: Date) => new Date(sepidarLocalDayStart(nextDay(date)).getTime() - 1);

const main = async () => {
  assertLocalSepidarHistoricalPosting(bookId, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL });
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sepidar:fiscal-time-zone:' + bookId}))`;
      const years = await tx.accountingFiscalYear.findMany({ where: { bookId }, include: { periods: true }, orderBy: { code: 'asc' } });
      if (years.length !== 2 || years[0].code !== '1404' || years[1].code !== '1405' || years.some((year) => year.periods.length !== 12)) throw new Error('Expected two prepared Sepidar fiscal years');
      const postings = await tx.accountingLedgerVoucher.count({ where: { bookId, status: { not: 'DRAFT' } } });
      if (postings) throw new Error('Posted vouchers exist; fiscal boundaries require a controlled restatement');
      const alreadyCorrect = years[0].startsAt.toISOString() === '2025-03-20T20:30:00.000Z' && years[1].startsAt.toISOString() === '2026-03-20T20:30:00.000Z';
      if (alreadyCorrect) return { action: 'already-correct', years: years.length };
      if (years[0].startsAt.toISOString() !== '2025-03-21T00:00:00.000Z' || years[1].startsAt.toISOString() !== '2026-03-21T00:00:00.000Z') throw new Error('Unknown fiscal boundary; refusing time-zone correction');
      const correctedPeriods = years.flatMap((year) => year.periods.map((period) => ({ id: period.id, fiscalYearId: year.id, startsAt: startOf(period.startsAt), endsAt: endOf(period.endsAt) })));
      for (const year of years) await tx.accountingFiscalYear.update({ where: { id: year.id }, data: { startsAt: startOf(year.startsAt), endsAt: endOf(year.endsAt) } });
      for (const period of correctedPeriods) await tx.accountingPostingPeriod.update({ where: { id: period.id }, data: { startsAt: period.startsAt, endsAt: period.endsAt } });
      const firstDay = sepidarLocalDayStart('2025-03-21');
      await tx.accountingCodeScheme.updateMany({ where: { bookId, createdBy: 'sepidar-local-ledger-preparation' }, data: { effectiveFrom: firstDay } });
      await tx.accountingLedgerAccount.updateMany({ where: { bookId, createdBy: actorId }, data: { effectiveFrom: firstDay } });
      await tx.accountingDimensionType.updateMany({ where: { bookId, createdBy: actorId }, data: { effectiveFrom: firstDay } });
      await tx.accountingDimensionMember.updateMany({ where: { dimensionType: { bookId, sourceKind: 'SEPIDAR_ACC_DL' } }, data: { effectiveFrom: firstDay } });
      const book = await tx.accountingBook.findUniqueOrThrow({ where: { id: bookId } });
      await tx.accountingParty.updateMany({ where: { legalEntityId: book.legalEntityId, sourceKind: 'SEPIDAR' }, data: { activeFrom: firstDay } });
      await tx.accountingPartyRoleAssignment.updateMany({ where: { createdBy: actorId }, data: { effectiveFrom: firstDay } });
      await tx.accountingFinancialAccount.updateMany({ where: { legalEntityId: book.legalEntityId, createdBy: actorId }, data: { activeFrom: firstDay } });
      const drafts = await tx.accountingLedgerVoucher.findMany({ where: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'DRAFT' }, select: { id: true, fiscalYearId: true, periodId: true, documentDate: true } });
      const repository = createAccountingLedgerPrismaRepository(tx, true);
      let correctedDrafts = 0;
      for (const draft of drafts) {
        const period = correctedPeriods.find((candidate) => candidate.fiscalYearId === draft.fiscalYearId && candidate.startsAt <= draft.documentDate && draft.documentDate <= candidate.endsAt);
        if (!period) throw new Error(`Draft ${draft.id} is outside corrected fiscal period coverage`);
        if (period.id === draft.periodId) continue;
        const voucher = await repository.getVoucherForUpdate(draft.id);
        if (!voucher) throw new Error(`Draft ${draft.id} disappeared during correction`);
        const correctedHash = voucherContentHash({ ...voucher, periodId: period.id });
        await tx.accountingLedgerVoucher.update({ where: { id: draft.id }, data: { periodId: period.id, contentHash: correctedHash } });
        await repository.appendAudit({ action: 'SEPIDAR_DRAFT_PERIOD_CORRECTED', result: 'SUCCEEDED', actorId,
          effectiveProfile: 'ACCOUNTING_MANAGER', entityType: 'JOURNAL_VOUCHER', entityId: draft.id,
          correlationId: randomUUID(), reason: 'اصلاح مرز دوره بر اساس ساعت محلی تهران در سپیدار',
          payloadHash: correctedHash, sessionContext: { oldPeriodId: draft.periodId, newPeriodId: period.id, previousContentHash: voucher.contentHash } });
        correctedDrafts++;
      }
      return { action: 'corrected', years: years.length, periods: correctedPeriods.length, inspectedDrafts: drafts.length, correctedDrafts };
    }, { timeout: 120_000, maxWait: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
