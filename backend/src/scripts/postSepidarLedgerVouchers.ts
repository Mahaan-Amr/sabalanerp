/** Post source-linked Sepidar ledger drafts through the ordinary audited ledger application. */
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerApplication } from '../services/accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository, verifyLedgerAuditChain } from '../services/accountingLedgerPrismaRepository';
import { assertLocalSepidarHistoricalPosting } from '../services/accountingSepidarLedgerReconciliation';

const bookId = process.env.SEPIDAR_TARGET_BOOK_ID?.trim() ?? '';
const snapshotId = process.env.SEPIDAR_SNAPSHOT_ID?.trim() ?? '';
const apply = process.argv.includes('--apply');
const year = process.argv.find((arg) => /^--year=140[45]$/.test(arg))?.split('=')[1];
const limitArgument = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
const limit = limitArgument ? Number(limitArgument) : Number.POSITIVE_INFINITY;
if (!bookId || !snapshotId || !year || !(limit > 0 && (Number.isInteger(limit) || limit === Number.POSITIVE_INFINITY))) {
  throw new Error('SEPIDAR_TARGET_BOOK_ID, SEPIDAR_SNAPSHOT_ID, --year=1404|1405 and optional --limit=N are required');
}

const actor = { id: 'sepidar-user-approved-development-import', profile: 'ACCOUNTING_MANAGER' as const };
const reason = 'ثبت عملیاتی اسناد سپیدار بر اساس نسخهٔ پشتیبان و تأیید مالک پروژه؛ کمبود ریزگردش ۱۴۰۴ و استثنای انبار ۱۴۰۵ در گزارش مهاجرت محفوظ است.';
const rollback = new Error('SEPIDAR_PREFLIGHT_ROLLBACK');
const dependencies = { now: () => new Date(), nextReference: () => { throw new Error('Posting must not allocate a draft reference'); } };

const main = async () => {
  assertLocalSepidarHistoricalPosting(bookId, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL });
  const db = new PrismaClient();
  try {
    const [snapshot, fiscalYear] = await Promise.all([
      db.accountingSepidarSourceSnapshot.findUnique({ where: { id: snapshotId }, select: { status: true, bookId: true } }),
      db.accountingFiscalYear.findUnique({ where: { bookId_code: { bookId, code: year } }, select: { id: true } }),
    ]);
    if (snapshot?.status !== 'COMPLETE' || snapshot.bookId !== bookId || !fiscalYear) throw new Error('Complete Sepidar snapshot and fiscal year required');
    const vouchers = await db.accountingLedgerVoucher.findMany({
      where: { bookId, fiscalYearId: fiscalYear.id, sourceType: 'SEPIDAR_ACC_VOUCHER' },
      select: { id: true, status: true, debitTotalRials: true, creditTotalRials: true },
      orderBy: [{ documentDate: 'asc' }, { sourceId: 'asc' }],
    });
    const expected = await db.accountingSepidarSourceRecord.count({
      where: { snapshotId, sourceTable: 'ACC.Voucher', fiscalYearRef: year === '1404' ? 1 : 10 },
    });
    const links = await db.accountingSepidarTargetLink.count({
      where: { bookId, firstSnapshotId: snapshotId, sourceTable: 'ACC.Voucher', targetKind: 'LEDGER_DRAFT', reviewStatus: 'USER_APPROVED', targetId: { in: vouchers.map((voucher) => voucher.id) } },
    });
    if (vouchers.length !== expected || links !== expected || vouchers.some((voucher) => voucher.debitTotalRials.cmp(voucher.creditTotalRials) !== 0)) {
      throw new Error(`Incomplete or unbalanced source mapping in ${year}: vouchers=${vouchers.length}, approvedLinks=${links}`);
    }
    const remaining = vouchers.filter((voucher) => voucher.status === 'DRAFT');
    const selected = remaining.slice(0, limit);
    if (selected.length > 0) {
      // Exercise the exact posting path while rolling back every write, sequence, and audit row.
      try {
        await db.$transaction(async (tx) => {
          const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), dependencies);
          await ledger.postVoucher({ voucherId: selected[0].id, actor, reason });
          throw rollback;
        }, { maxWait: 20_000, timeout: 120_000 });
      } catch (error) { if (error !== rollback) throw error; }
    }
    console.log(JSON.stringify({ phase: 'preflight', year, sourceVouchers: vouchers.length, alreadyPosted: vouchers.length - remaining.length, selected: selected.length, passed: true }));
    if (!apply) return;
    const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(db), dependencies);
    let posted = 0;
    for (const voucher of selected) {
      const result = await ledger.postVoucher({ voucherId: voucher.id, actor, reason });
      if (result.status !== 'POSTED') throw new Error(`Posting did not complete for ${voucher.id}`);
      posted++;
      if (posted % 100 === 0) console.log(JSON.stringify({ phase: 'posting', year, posted, selected: selected.length }));
    }
    const [postedCount, audit] = await Promise.all([
      db.accountingLedgerVoucher.count({ where: { bookId, fiscalYearId: fiscalYear.id, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'POSTED' } }),
      verifyLedgerAuditChain(db),
    ]);
    if (postedCount !== vouchers.length - remaining.length + posted || !audit.valid) throw new Error('Posted voucher count or ledger audit chain mismatch');
    console.log(JSON.stringify({ phase: 'verified', year, postedNow: posted, postedTotal: postedCount, sourceVouchers: vouchers.length, auditEntriesChecked: audit.checkedEntries }));
  } finally { await db.$disconnect(); }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
