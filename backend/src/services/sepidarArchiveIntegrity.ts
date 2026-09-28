import { createHash } from 'node:crypto';
import { hashAccountingEvidence } from './accountingLedgerFoundation';

export type SepidarArchiveManifestEntry = { table_name: string; exact_rows: number };
export type SepidarArchiveRow = { table: string; key: string; payload: Record<string, unknown> };
export const sepidarArchivePayloadHash = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export const validateSepidarArchiveManifest = (value: unknown): SepidarArchiveManifestEntry[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Source manifest must contain tables');
  const tables = new Set<string>(); let total = 0;
  for (const item of value) {
    if (!item || typeof item.table_name !== 'string' || !item.table_name.trim() || tables.has(item.table_name)
      || !Number.isSafeInteger(item.exact_rows) || item.exact_rows < 0) throw new Error('Invalid or duplicate source manifest table');
    tables.add(item.table_name); total += item.exact_rows;
    if (!Number.isSafeInteger(total)) throw new Error('Source manifest total exceeds supported count');
  }
  return value;
};

export const createSepidarArchiveValidator = (manifest: SepidarArchiveManifestEntry[]) => {
  const expected = new Map(manifest.map((item) => [item.table_name, item.exact_rows]));
  const seen = new Set<string>(); const actual = new Map<string, number>();
  return {
    accept(value: unknown): SepidarArchiveRow {
      const row = value as SepidarArchiveRow;
      if (!row || typeof row.table !== 'string' || !expected.has(row.table) || typeof row.key !== 'string' || !row.key.trim()
        || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) throw new Error('Invalid source archive row');
      const identity = JSON.stringify([row.table, row.key]);
      if (seen.has(identity)) throw new Error('Duplicate source archive row');
      seen.add(identity);
      const count = (actual.get(row.table) ?? 0) + 1;
      if (count > expected.get(row.table)!) throw new Error('Source archive table exceeds manifest count');
      actual.set(row.table, count);
      return row;
    },
    finish() {
      for (const [table, count] of expected) if ((actual.get(table) ?? 0) !== count) throw new Error('Source archive table count mismatch');
      return seen.size;
    },
  };
};

export const assertSepidarArchiveResumeBinding = (sourceMetadata: unknown, exportSha256: string) => {
  const metadata = sourceMetadata as Record<string, unknown> | null;
  if (!metadata || metadata.exportFormat !== 'sepidar-source-jsonl-v1' || metadata.exportSha256 !== exportSha256) {
    throw new Error('Existing snapshot is bound to a different source export');
  }
};

/** JSONB may reorder object keys; compare semantic content independently of the original JSON byte hash. */
export const assertSepidarArchiveStoredRow = (
  existing: { sourceTable: string; sourceKey: string; sourceHash: string; payload: unknown },
  expected: { sourceTable: string; sourceKey: string; sourceHash: string; payload: unknown },
) => {
  if (existing.sourceTable !== expected.sourceTable || existing.sourceKey !== expected.sourceKey
    || existing.sourceHash !== expected.sourceHash
    || hashAccountingEvidence(existing.payload) !== hashAccountingEvidence(expected.payload)) {
    throw new Error('Existing immutable source row differs from verified export');
  }
};

/** Must finish successfully before any snapshot or record mutation. */
export const verifySepidarArchiveExport = async (
  sourceFile: string, manifest: SepidarArchiveManifestEntry[], expectedSha256: string,
) => {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  const validator = createSepidarArchiveValidator(manifest);
  const hash = createHash('sha256');
  const stream = createReadStream(sourceFile, { encoding: 'utf8' });
  stream.on('data', (chunk) => hash.update(chunk));
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (line) validator.accept(JSON.parse(line));
  }
  const count = validator.finish();
  if (hash.digest('hex') !== expectedSha256) throw new Error('Source export SHA-256 mismatch before import');
  return count;
};
