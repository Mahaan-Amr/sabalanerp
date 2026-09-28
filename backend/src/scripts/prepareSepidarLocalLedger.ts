import { PrismaClient } from '@prisma/client';
import { assertLocalSepidarHistoricalPosting } from '../services/accountingSepidarLedgerReconciliation';
import { validateFiscalPeriodCoverage } from '../services/accountingLedgerAdministration';
import { sepidarLocalDayStart } from '../services/sepidarCalendar';

// Deliberately scoped to the one empty placeholder in the local development book.
// The source archive and unrelated financial, tax, and audit data are never touched.
const bookId = 'cmub2hd63007zrqlphrzi5eey';
const placeholderYearId = 'cmub2jlfi0098rqlp3yk2m76f';
const placeholderSchemeId = 'cmub2hd630080rqlptt3lgdjm';
const actorId = 'sepidar-local-ledger-preparation';
const day = 86_400_000;
const midnight = (value: string) => new Date(`${value}T00:00:00.000Z`);
const persianParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
};
const fiscalYears = [
  { code: '1404', start: midnight('2025-03-21'), lastDay: midnight('2026-03-20') },
  { code: '1405', start: midnight('2026-03-21'), lastDay: midnight('2027-03-20') },
];
const definitions = fiscalYears.map((year) => {
  const endsAt = new Date(sepidarLocalDayStart(new Date(year.lastDay.getTime() + day).toISOString().slice(0, 10)).getTime() - 1);
  const starts = [sepidarLocalDayStart(year.start.toISOString().slice(0, 10))];
  for (let cursor = year.start.getTime() + day; cursor <= year.lastDay.getTime(); cursor += day) {
    const date = new Date(cursor);
    if (persianParts(date).day === 1) starts.push(sepidarLocalDayStart(date.toISOString().slice(0, 10)));
  }
  if (starts.length !== 12) throw new Error(`Expected twelve Persian months in ${year.code}; found ${starts.length}`);
  const periods = starts.map((startsAt, index) => ({
    code: `${year.code}-${String(index + 1).padStart(2, '0')}`,
    titlePersian: `ماه ${index + 1} سال ${year.code}`,
    sequence: index + 1,
    startsAt,
    endsAt: new Date((starts[index + 1]?.getTime() ?? endsAt.getTime() + 1) - 1),
    isAdjustment: false,
    status: 'OPEN' as const,
  }));
  validateFiscalPeriodCoverage(starts[0], endsAt, periods);
  return { code: year.code, startsAt: starts[0], endsAt, periods };
});

const run = async () => {
  assertLocalSepidarHistoricalPosting(bookId, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL });
  const database = new PrismaClient();
  const apply = process.argv.includes('--apply');
  try {
  const state = await database.$transaction(async (tx) => {
    const [book, years, schemes, accounts, vouchers, lines, dimensions, migrationRuns, placeholderPeriodCount] = await Promise.all([
      tx.accountingBook.findUnique({ where: { id: bookId } }),
      tx.accountingFiscalYear.findMany({ where: { bookId }, select: { id: true, code: true } }),
      tx.accountingCodeScheme.findMany({ where: { bookId }, select: { id: true, version: true, groupLength: true, kolLength: true, moinLength: true } }),
      tx.accountingLedgerAccount.count({ where: { bookId } }),
      tx.accountingLedgerVoucher.count({ where: { bookId } }),
      tx.accountingLedgerLine.count({ where: { voucher: { bookId } } }),
      tx.accountingDimensionType.count({ where: { bookId } }),
      tx.accountingReplacementMigrationRun.count({ where: { bookId } }),
      tx.accountingPostingPeriod.count({ where: { fiscalYearId: placeholderYearId } }),
    ]);
    if (!book?.isPrimary) throw new Error('Expected local primary accounting book was not found');
    if (accounts || vouchers || lines || dimensions || migrationRuns) throw new Error('Operational accounting data now exists; refusing placeholder cleanup');
    const alreadyPrepared = years.length === 2 && definitions.every((item) => years.some((year) => year.code === item.code))
      && schemes.length === 1 && schemes[0].groupLength === 2 && schemes[0].kolLength === 2 && schemes[0].moinLength === 2;
    if (alreadyPrepared) return { action: 'already-prepared', bookId, years, schemes };
    if (years.length !== 1 || years[0].id !== placeholderYearId || schemes.length !== 1 || schemes[0].id !== placeholderSchemeId
      || schemes[0].version !== 1 || schemes[0].groupLength !== 1 || schemes[0].kolLength !== 2 || schemes[0].moinLength !== 3
      || placeholderPeriodCount !== 14) throw new Error('Local accounting configuration differs from the audited empty placeholder; refusing cleanup');
    if (!apply) return { action: 'dry-run', bookId, delete: { placeholderYearId, placeholderPeriodCount, placeholderSchemeId }, create: definitions.map((item) => ({ code: item.code, periods: item.periods.length })) };
    await tx.accountingPostingPeriod.deleteMany({ where: { fiscalYearId: placeholderYearId } });
    await tx.accountingFiscalYear.delete({ where: { id: placeholderYearId } });
    await tx.accountingCodeScheme.delete({ where: { id: placeholderSchemeId } });
    await tx.accountingCodeScheme.create({ data: { bookId, version: 1, groupLength: 2, kolLength: 2, moinLength: 2, effectiveFrom: definitions[0].startsAt, createdBy: actorId } });
    for (const year of definitions) await tx.accountingFiscalYear.create({ data: {
      bookId, code: year.code, titlePersian: `سال مالی ${year.code} سپیدار`, startsAt: year.startsAt, endsAt: year.endsAt,
      status: 'ACTIVE', createdBy: actorId, periods: { create: year.periods },
    } });
    return { action: 'prepared', bookId, years: definitions.map((item) => item.code), periods: definitions.reduce((count, item) => count + item.periods.length, 0) };
  });
  console.log(JSON.stringify(state));
  } finally {
    await database.$disconnect();
  }
};
run().catch((error) => { console.error(error); process.exitCode = 1; });
