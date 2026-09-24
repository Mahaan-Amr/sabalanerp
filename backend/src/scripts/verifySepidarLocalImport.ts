import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { verifyLedgerAuditChain } from '../services/accountingLedgerPrismaRepository';

const bookId = 'cmub2hd63007zrqlphrzi5eey';
const snapshotId = '107e07de8110cdbe0ceeb995a98c9111a223a738d182dd1c0f0cf4cf43bcd009';
type CountAndSums = { count: bigint; debit: Prisma.Decimal; credit: Prisma.Decimal };
const main = async () => {
  const db = new PrismaClient();
  try {
    const results: Array<{ year: string; vouchers: number; lines: number; debitRials: string; creditRials: string }> = [];
    for (const [code, sourceRef] of [['1404', 1], ['1405', 10]] as const) {
      const fiscalYear = await db.accountingFiscalYear.findUniqueOrThrow({ where: { bookId_code: { bookId, code } } });
      const [source, target, sourceVouchers, targetVouchers, outsidePeriods] = await Promise.all([
        db.$queryRaw<CountAndSums[]>`
          SELECT count(*)::bigint AS count, coalesce(sum((l.payload->>'Debit')::numeric),0) AS debit,
            coalesce(sum((l.payload->>'Credit')::numeric),0) AS credit
          FROM accounting_sepidar_source_records l
          JOIN accounting_sepidar_source_records v ON v."snapshotId"=l."snapshotId" AND v."sourceTable"='ACC.Voucher'
            AND v."sourceKey"=(l.payload->>'VoucherRef')
          WHERE l."snapshotId"=${snapshotId} AND l."sourceTable"='ACC.VoucherItem' AND v."fiscalYearRef"=${sourceRef}`,
        db.$queryRaw<CountAndSums[]>`
          SELECT count(*)::bigint AS count, coalesce(sum(l."debitRials"),0) AS debit,
            coalesce(sum(l."creditRials"),0) AS credit
          FROM accounting_ledger_lines l JOIN accounting_ledger_vouchers v ON v.id=l."voucherId"
          WHERE v."bookId"=${bookId} AND v."fiscalYearId"=${fiscalYear.id} AND v."sourceType"='SEPIDAR_ACC_VOUCHER'`,
        db.accountingSepidarSourceRecord.count({ where: { snapshotId, sourceTable: 'ACC.Voucher', fiscalYearRef: sourceRef } }),
        db.accountingLedgerVoucher.count({ where: { bookId, fiscalYearId: fiscalYear.id, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'DRAFT' } }),
        db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM accounting_ledger_vouchers v
          JOIN accounting_posting_periods p ON p.id=v."periodId"
          WHERE v."bookId"=${bookId} AND v."fiscalYearId"=${fiscalYear.id}
            AND (v."documentDate"<p."startsAt" OR v."documentDate">p."endsAt")`,
      ]);
      if (!source[0] || !target[0] || sourceVouchers !== targetVouchers || source[0].count !== target[0].count
        || !source[0].debit.eq(target[0].debit) || !source[0].credit.eq(target[0].credit)
        || outsidePeriods[0]?.count !== 0n) throw new Error(`Source and target mismatch in ${code}`);
      results.push({ year: code, vouchers: sourceVouchers, lines: Number(source[0].count), debitRials: source[0].debit.toString(), creditRials: source[0].credit.toString() });
    }
    const [archiveRows, sourceLinks, posted, audit] = await Promise.all([
      db.accountingSepidarSourceRecord.count({ where: { snapshotId } }),
      db.accountingSepidarTargetLink.count({ where: { bookId, sourceTable: 'ACC.Voucher', targetKind: 'LEDGER_DRAFT' } }),
      db.accountingLedgerVoucher.count({ where: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER', status: { not: 'DRAFT' } } }),
      verifyLedgerAuditChain(db),
    ]);
    if (archiveRows !== 223993 || sourceLinks !== 12846 || posted !== 0 || !audit.valid) throw new Error('Archive, lineage, posting status, or audit chain mismatch');
    const report = { verifiedAt: new Date().toISOString(), snapshotId, bookId, archiveRows, sourceLinks, posted,
      ledgerAuditEntriesChecked: audit.checkedEntries, years: results, status: 'DRAFTS_RECONCILED_TO_SOURCE_NOT_STATUTORY' };
    const output = process.env.SEPIDAR_VERIFICATION_OUTPUT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8' });
    console.log(JSON.stringify(report));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
