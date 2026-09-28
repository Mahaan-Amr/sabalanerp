/** Report source archive and actual target links without treating an archive row as an operational record. */
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const bookId = process.env.SEPIDAR_TARGET_BOOK_ID?.trim() ?? '';
const snapshotId = process.env.SEPIDAR_SNAPSHOT_ID?.trim() ?? '';
if (!bookId || !snapshotId) throw new Error('SEPIDAR_TARGET_BOOK_ID and SEPIDAR_SNAPSHOT_ID are required');

const main = async () => {
  const db = new PrismaClient();
  try {
    const [snapshot, sources, links, vouchers, ledgerLines] = await Promise.all([
      db.accountingSepidarSourceSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, select: { bookId: true, status: true, expectedRecordCount: true, tableCount: true } }),
      db.accountingSepidarSourceRecord.groupBy({ by: ['sourceTable'], where: { snapshotId }, _count: { _all: true } }),
      db.accountingSepidarTargetLink.groupBy({ by: ['sourceTable', 'targetKind'], where: { bookId }, _count: { _all: true } }),
      db.accountingLedgerVoucher.groupBy({ by: ['fiscalYearId', 'status'], where: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER' }, _count: { _all: true } }),
      db.accountingLedgerLine.count({ where: { voucher: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER' } } }),
    ]);
    if (snapshot.bookId !== bookId || snapshot.status !== 'COMPLETE') throw new Error('Complete snapshot for target book required');
    const linked = new Map<string, Array<{ targetKind: string; count: number }>>();
    for (const link of links) linked.set(link.sourceTable, [...(linked.get(link.sourceTable) ?? []), { targetKind: link.targetKind, count: link._count._all }]);
    const tables = sources.map((source) => ({ sourceTable: source.sourceTable, sourceRows: source._count._all,
      targetLinks: linked.get(source.sourceTable) ?? [] })).sort((left, right) => right.sourceRows - left.sourceRows);
    const sourceVoucherLines = sources.find((source) => source.sourceTable === 'ACC.VoucherItem')?._count._all ?? 0;
    if (ledgerLines !== sourceVoucherLines) throw new Error(`Voucher item coverage mismatch: source=${sourceVoucherLines}, target=${ledgerLines}`);
    const report = { generatedAt: new Date().toISOString(), bookId, snapshotId,
      archive: { expectedRows: snapshot.expectedRecordCount, tablesInBackup: snapshot.tableCount, nonemptyTables: tables.length },
      ledger: vouchers.map((row) => ({ fiscalYearId: row.fiscalYearId, status: row.status, count: row._count._all })),
      voucherItemsEmbeddedAsLedgerLines: { source: sourceVoucherLines, target: ledgerLines },
      tables,
      meaning: 'A target link proves identity or materialization only for its target kind; unlinked source tables remain an archive, not operational subledger data.' };
    const output = process.env.SEPIDAR_COVERAGE_OUTPUT?.trim();
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ archive: report.archive, ledger: report.ledger, voucherItemsEmbeddedAsLedgerLines: report.voucherItemsEmbeddedAsLedgerLines,
      directlyLinkedTables: tables.filter((table) => table.targetLinks.length > 0).length,
      unlinkedNonemptyTables: tables.filter((table) => table.targetLinks.length === 0).length,
      output: output || null }));
  } finally { await db.$disconnect(); }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
