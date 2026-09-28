/** Import a verified, privately extracted Sepidar JSONL into the immutable source archive. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSepidarArchiveResumeBinding, assertSepidarArchiveStoredRow, createSepidarArchiveValidator,
  sepidarArchivePayloadHash, validateSepidarArchiveManifest, verifySepidarArchiveExport } from '../services/sepidarArchiveIntegrity';

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
  const tableCounts = validateSepidarArchiveManifest(JSON.parse(countBytes.toString('utf8')));
  const expectedCount = tableCounts.reduce((sum, item) => sum + item.exact_rows, 0);
  const manifestHash = createHash('sha256').update(countBytes).digest('hex');
  const snapshotId = sha256(`${bookId}:${backupHash}`);
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sepidar-verified-export-'));
  const verifiedSourceFile = path.join(stagingDirectory, 'source.jsonl');
  const prisma = new PrismaClient();
  try {
    // A private copy removes the input-file race between validation and import.
    // Bad bytes, duplicate identities and incomplete manifests cause no DB writes.
    await fs.chmod(stagingDirectory, 0o700);
    const copyHash = createHash('sha256');
    await pipeline(createReadStream(sourceFile), new Transform({ transform(chunk, _encoding, callback) {
      copyHash.update(chunk); callback(null, chunk);
    } }), createWriteStream(verifiedSourceFile, { flags: 'wx', mode: 0o600 }));
    if (copyHash.digest('hex') !== exportHash) throw new Error('Source export SHA-256 mismatch before import');
    await fs.chmod(verifiedSourceFile, 0o400);
    if (await verifySepidarArchiveExport(verifiedSourceFile, tableCounts, exportHash) !== expectedCount) throw new Error('Source archive total count mismatch');
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
      create: { id: snapshotId, bookId, sourcePackageHash: backupHash, sourceDatabase,
        schemaManifestHash: manifestHash, schemaManifest: tableCounts as unknown as Prisma.InputJsonValue,
        sourceMetadata: { exportSha256: exportHash, backupFilename, predecessorId, exportFormat: 'sepidar-source-jsonl-v1' },
        tableCount: tableCounts.length, expectedRecordCount: expectedCount, status: 'IMPORTING' },
      update: {},
    });
    if (snapshot.id !== snapshotId || snapshot.expectedRecordCount !== expectedCount || snapshot.schemaManifestHash !== manifestHash) {
      throw new Error('Existing snapshot does not match this source manifest');
    }
    assertSepidarArchiveResumeBinding(snapshot.sourceMetadata, exportHash);
    const alreadyComplete = snapshot.status === 'COMPLETE';
    const validator = createSepidarArchiveValidator(tableCounts);
    const batch: Prisma.AccountingSepidarSourceRecordCreateManyInput[] = [];
    let scanned = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await prisma.$transaction(async (tx) => {
        const existing = await tx.accountingSepidarSourceRecord.findMany({ where: { id: { in: batch.map((row) => row.id!) } },
          select: { id: true, sourceTable: true, sourceKey: true, sourceHash: true, payload: true } });
        const stored = new Map(existing.map((row) => [row.id, row]));
        for (const row of batch) {
          const found = stored.get(row.id!);
          if (found) assertSepidarArchiveStoredRow(found, row);
          else if (alreadyComplete) throw new Error('Complete snapshot is missing an immutable source row');
        }
        if (!alreadyComplete) await tx.accountingSepidarSourceRecord.createMany({ data: batch.filter((row) => !stored.has(row.id!)) });
      });
      batch.length = 0;
      if (scanned % 10000 < 250) console.log(`Scanned ${scanned}/${expectedCount}`);
    };
    for await (const line of createInterface({ input: createReadStream(verifiedSourceFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 }), crlfDelay: Infinity })) {
      if (!line) continue;
      const source = validator.accept(JSON.parse(line));
      const fiscalYearRef = typeof source.payload.FiscalYearRef === 'number' ? source.payload.FiscalYearRef : null;
      const rawDate = source.payload.Date;
      const date = typeof rawDate === 'string' && /^\d{4}-\d\d-\d\dT/.test(rawDate) ? new Date(rawDate) : null;
      batch.push({ id: sha256(`${snapshotId}:${source.table}:${source.key}`), snapshotId,
        sourceTable: source.table, sourceKey: source.key, sourceHash: sepidarArchivePayloadHash(source.payload),
        fiscalYearRef, documentDate: date && !Number.isNaN(date.getTime()) ? date : null,
        payload: source.payload as Prisma.InputJsonValue, searchText: source.key });
      scanned++;
      if (batch.length >= 250) await flush();
    }
    await flush();
    if (validator.finish() !== expectedCount) throw new Error('Source archive total count mismatch');
    const grouped = await prisma.accountingSepidarSourceRecord.groupBy({ by: ['sourceTable'], where: { snapshotId }, _count: { _all: true } });
    const storedByTable = new Map(grouped.map((item) => [item.sourceTable, item._count._all]));
    for (const { table_name, exact_rows } of tableCounts) if ((storedByTable.get(table_name) ?? 0) !== exact_rows) throw new Error('Stored source table count mismatch');
    const storedCount = grouped.reduce((sum, item) => sum + item._count._all, 0);
    if (storedCount !== expectedCount) throw new Error('Stored source total count mismatch');
    if (!alreadyComplete) await prisma.accountingSepidarSourceSnapshot.update({ where: { id: snapshotId }, data: { importedRecordCount: storedCount, status: 'COMPLETE', completedAt: new Date() } });
    console.log(`COMPLETE snapshot=${snapshotId} tables=${tableCounts.length} records=${storedCount} exportSha256=${exportHash}`);
  } finally {
    await prisma.$disconnect();
    await fs.chmod(verifiedSourceFile, 0o600).catch(() => undefined);
    await fs.rm(verifiedSourceFile, { force: true });
    await fs.rmdir(stagingDirectory);
  }
};
main().catch(() => { console.error('Sepidar source archive import failed; verify source package and immutable retry evidence.'); process.exitCode = 1; });
