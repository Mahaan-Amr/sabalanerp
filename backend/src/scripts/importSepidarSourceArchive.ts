/** Import a verified, privately extracted Sepidar JSONL into the read-only source archive. */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

type SourceLine = { table: string; key: string; payload: Record<string, unknown> };
type TableCount = { table_name: string; exact_rows: number };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const main = async () => {
  const bookId = required('SEPIDAR_TARGET_BOOK_ID');
  const sourceFile = required('SEPIDAR_SOURCE_JSONL');
  const countsFile = required('SEPIDAR_SOURCE_COUNTS_JSON');
  const backupHash = required('SEPIDAR_BACKUP_SHA256').toLowerCase();
  const exportHash = required('SEPIDAR_EXPORT_SHA256').toLowerCase();
  const backupFilename = path.basename(required('SEPIDAR_BACKUP_FILENAME'));
  const sourceDatabase = process.env.SEPIDAR_SOURCE_DATABASE?.trim() || 'Sepidar01';
  const predecessorId = process.env.SEPIDAR_PREDECESSOR_SNAPSHOT_ID?.trim() || null;
  if (!/\.bak$/i.test(backupFilename)) throw new Error('Source must identify a Sepidar .bak file');
  if (![backupHash, exportHash].every((hash) => /^[0-9a-f]{64}$/.test(hash))) throw new Error('Invalid source SHA-256');
  const countBytes = readFileSync(countsFile);
  const tableCounts = JSON.parse(countBytes.toString('utf8')) as TableCount[];
  const expectedByTable = new Map(tableCounts.map((item) => [item.table_name, item.exact_rows]));
  const expectedCount = tableCounts.reduce((sum, item) => sum + item.exact_rows, 0);
  const snapshotId = sha256(`${bookId}:${backupHash}`);
  const prisma = new PrismaClient();
  try {
    const book = await prisma.accountingBook.findUnique({ where: { id: bookId }, select: { id: true } });
    if (!book) throw new Error('Target accounting book does not exist');
    if (predecessorId) {
      const predecessor = await prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: predecessorId }, select: { bookId: true, status: true, sourcePackageHash: true } });
      if (!predecessor || predecessor.bookId !== bookId || predecessor.status !== 'COMPLETE' || predecessor.sourcePackageHash === backupHash) {
        throw new Error('Predecessor must be a different complete Sepidar backup in the same book');
      }
    }
    const snapshot = await prisma.accountingSepidarSourceSnapshot.upsert({
      where: { bookId_sourcePackageHash: { bookId, sourcePackageHash: backupHash } },
      create: {
        id: snapshotId, bookId, sourcePackageHash: backupHash, sourceDatabase,
        schemaManifestHash: createHash('sha256').update(countBytes).digest('hex'),
        schemaManifest: tableCounts as unknown as Prisma.InputJsonValue,
        sourceMetadata: { exportSha256: exportHash, backupFilename, predecessorId, exportFormat: 'sepidar-source-jsonl-v1' },
        tableCount: tableCounts.length, expectedRecordCount: expectedCount, status: 'IMPORTING',
      },
      update: {},
    });
    if (snapshot.id !== snapshotId || snapshot.expectedRecordCount !== expectedCount || snapshot.schemaManifestHash !== createHash('sha256').update(countBytes).digest('hex')) {
      throw new Error('Existing snapshot does not match this source manifest');
    }
    if (snapshot.status === 'COMPLETE') {
      console.log(`Snapshot already complete: ${snapshot.id}`);
      return;
    }

    const actualByTable = new Map<string, number>();
    const batch: Prisma.AccountingSepidarSourceRecordCreateManyInput[] = [];
    const fileHash = createHash('sha256');
    let scanned = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await prisma.accountingSepidarSourceRecord.createMany({ data: batch, skipDuplicates: true });
      batch.length = 0;
      if (scanned % 10000 < 250) console.log(`Scanned ${scanned}/${expectedCount}`);
    };
    const sourceStream = createReadStream(sourceFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
    sourceStream.on('data', (chunk) => fileHash.update(chunk));
    for await (const line of createInterface({ input: sourceStream, crlfDelay: Infinity })) {
      if (!line) continue;
      const source = JSON.parse(line) as SourceLine;
      if (!expectedByTable.has(source.table) || typeof source.key !== 'string' || !source.payload || Array.isArray(source.payload)) throw new Error(`Invalid source row ${scanned + 1}`);
      const sourceHash = sha256(JSON.stringify(source.payload));
      const fiscalYearRef = typeof source.payload.FiscalYearRef === 'number' ? source.payload.FiscalYearRef : null;
      const rawDate = source.payload.Date;
      const date = typeof rawDate === 'string' && /^\d{4}-\d\d-\d\dT/.test(rawDate) ? new Date(rawDate) : null;
      batch.push({
        id: sha256(`${snapshotId}:${source.table}:${source.key}`), snapshotId,
        sourceTable: source.table, sourceKey: source.key, sourceHash,
        fiscalYearRef, documentDate: date && !Number.isNaN(date.getTime()) ? date : null,
        payload: source.payload as Prisma.InputJsonValue,
        searchText: source.key,
      });
      scanned++;
      actualByTable.set(source.table, (actualByTable.get(source.table) ?? 0) + 1);
      if (batch.length >= 250) await flush();
    }
    await flush();
    if (scanned !== expectedCount) throw new Error(`Row count mismatch: ${scanned} vs ${expectedCount}`);
    for (const [table, count] of expectedByTable) if ((actualByTable.get(table) ?? 0) !== count) throw new Error(`Table count mismatch: ${table}`);
    const actualExportHash = fileHash.digest('hex');
    if (actualExportHash !== exportHash) throw new Error(`Export SHA-256 mismatch: ${actualExportHash}`);
    const grouped = await prisma.accountingSepidarSourceRecord.groupBy({ by: ['sourceTable'], where: { snapshotId }, _count: { _all: true } });
    const storedByTable = new Map(grouped.map((item) => [item.sourceTable, item._count._all]));
    for (const [table, count] of expectedByTable) if ((storedByTable.get(table) ?? 0) !== count) throw new Error(`Stored table count mismatch: ${table}`);
    const storedCount = grouped.reduce((sum, item) => sum + item._count._all, 0);
    if (storedCount !== expectedCount) throw new Error(`Stored row count mismatch: ${storedCount}`);
    await prisma.accountingSepidarSourceSnapshot.update({ where: { id: snapshotId }, data: { importedRecordCount: storedCount, status: 'COMPLETE', completedAt: new Date() } });
    console.log(`COMPLETE snapshot=${snapshotId} tables=${tableCounts.length} records=${storedCount} exportSha256=${actualExportHash}`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
