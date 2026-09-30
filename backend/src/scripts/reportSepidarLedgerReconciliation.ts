/** Read-only source/target ledger evidence; never imports, posts or approves cutover. */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { verifyLedgerAuditChain } from '../services/accountingLedgerPrismaRepository';
import { reconcileSepidarLedger, type SepidarLedgerReconciliationInput } from '../services/accountingSepidarLedgerReconciliation';

const main = async () => {
  const bookId = process.env.SEPIDAR_TARGET_BOOK_ID?.trim() ?? '';
  const snapshotId = process.env.SEPIDAR_SNAPSHOT_ID?.trim() ?? '';
  const outputPath = process.env.SEPIDAR_LEDGER_RECONCILIATION_OUTPUT?.trim() ?? '';
  if (!bookId || !snapshotId || !outputPath || !path.isAbsolute(outputPath)) {
    throw new Error('SEPIDAR_TARGET_BOOK_ID, SEPIDAR_SNAPSHOT_ID and absolute SEPIDAR_LEDGER_RECONCILIATION_OUTPUT are required');
  }
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const snapshot = await tx.accountingSepidarSourceSnapshot.findUniqueOrThrow({ where: { id: snapshotId },
        select: { id: true, bookId: true, status: true, completedAt: true, sourcePackageHash: true,
          expectedRecordCount: true, importedRecordCount: true, sourceMetadata: true } });
      if (snapshot.bookId !== bookId) throw new Error('Snapshot does not belong to target book');
      const sources = await tx.accountingSepidarSourceRecord.findMany({ where: { snapshotId,
        sourceTable: { in: ['ACC.Voucher', 'ACC.VoucherItem', 'ACC.Account', 'ACC.DL', 'FMK.FiscalYear', 'GNR.Party', 'RPA.BankAccount'] } },
        select: { sourceTable: true, sourceKey: true, sourceHash: true, payload: true } });
      const actualArchiveRecordCount = await tx.accountingSepidarSourceRecord.count({ where: { snapshotId } });
      const links = await tx.accountingSepidarTargetLink.findMany({ where: { bookId,
        sourceTable: { in: ['ACC.Voucher', 'ACC.Account', 'ACC.DL', 'GNR.Party', 'RPA.BankAccount'] } },
        select: { bookId: true, sourceTable: true, sourceKey: true, sourceHash: true, firstSnapshotId: true, latestSnapshotId: true,
          targetKind: true, targetId: true, mappingVersion: true, reviewStatus: true, reviewedBy: true, reviewEvidence: true } });
      const completeSnapshots = await tx.accountingSepidarSourceSnapshot.findMany({ where: { bookId, status: 'COMPLETE', completedAt: { not: null } }, select: { id: true } });
      // Include every Sepidar target in this book and every linked target, including wrong-book targets.
      const targets = await tx.accountingLedgerVoucher.findMany({ where: { OR: [
        { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER' },
        { id: { in: links.filter((link) => link.sourceTable === 'ACC.Voucher' && link.targetKind === 'LEDGER_DRAFT').map((link) => link.targetId) } },
      ] }, select: { id: true, bookId: true, fiscalYearId: true, documentDate: true,
        fiscalYear: { select: { code: true, bookId: true } }, period: { select: { fiscalYearId: true, startsAt: true, endsAt: true } },
        status: true, postedAt: true, sourceType: true, sourceId: true, sourceVersion: true, sourceHash: true, sourcePayload: true,
        debitTotalRials: true, creditTotalRials: true,
        lines: { select: { id: true, sequence: true, accountId: true, account: { select: { bookId: true } }, partyId: true,
          financialAccountId: true, debitRials: true, creditRials: true, evidenceType: true, evidenceId: true,
          evidenceVersion: true, evidenceHash: true, evidencePayload: true,
          dimensions: { select: { memberId: true, dimensionType: { select: { code: true, bookId: true } } } } } },
      } });
      const audit = await verifyLedgerAuditChain(tx);
      const metadata = snapshot.sourceMetadata as Record<string, unknown>;
      const input: SepidarLedgerReconciliationInput = {
        bookId, snapshot: { ...snapshot, exportFormat: String(metadata.exportFormat ?? '') },
        actualArchiveRecordCount, completeSnapshotIds: completeSnapshots.map((item) => item.id), sources, links,
        audit: { valid: audit.valid, checkedEntries: audit.checkedEntries },
        vouchers: targets.map((target) => ({ ...target, fiscalYearCode: target.fiscalYear.code,
          fiscalYearBookId: target.fiscalYear.bookId, periodFiscalYearId: target.period.fiscalYearId,
          periodStartsAt: target.period.startsAt, periodEndsAt: target.period.endsAt,
          debitTotalRials: target.debitTotalRials.toString(), creditTotalRials: target.creditTotalRials.toString(),
          lines: target.lines.map((line) => ({ ...line, accountBookId: line.account.bookId,
            debitRials: line.debitRials.toString(), creditRials: line.creditRials.toString(),
            dimensions: line.dimensions.map((dimension) => ({ memberId: dimension.memberId,
              typeCode: dimension.dimensionType.code, bookId: dimension.dimensionType.bookId })) })),
        })),
      };
      return reconcileSepidarLedger(input);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 240_000 });
    await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ exact: result.exact, totals: result.totals, issueCount: result.issues.length,
      outputHash: result.outputHash, scope: result.scope }));
    if (!result.exact) process.exitCode = 1;
  } finally { await db.$disconnect(); }
};

main().catch(() => {
  // Query errors can contain credentials or raw financial values; do not print them.
  console.error('تولید شواهد تطبیق دفتر سپیدار انجام نشد؛ تنظیمات، دسترسی خواندن و مسیر خروجی تازه را بررسی کنید.');
  process.exitCode = 1;
});
