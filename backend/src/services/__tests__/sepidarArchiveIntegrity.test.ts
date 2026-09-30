import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSepidarArchiveResumeBinding, assertSepidarArchiveStoredRow, createSepidarArchiveValidator,
  sepidarArchivePayloadHash, validateSepidarArchiveManifest } from '../sepidarArchiveIntegrity';

const manifest = [{ table_name: 'ACC.Voucher', exact_rows: 1 }, { table_name: 'ACC.VoucherItem', exact_rows: 1 }];
const row = { sourceTable: 'ACC.VoucherItem', sourceKey: '2', payload: { VoucherRef: 1, Debit: '100', Credit: '0' } };
const expected = { ...row, sourceHash: sepidarArchivePayloadHash(row.payload) };
const metadata = { exportFormat: 'sepidar-source-jsonl-v1', exportSha256: 'a'.repeat(64) };

test('an interrupted source import cannot resume against another export even when backup and counts match', () => {
  const immutablePartial = structuredClone(expected);
  let completionWritten = false;
  assert.throws(() => {
    assertSepidarArchiveResumeBinding(metadata, 'b'.repeat(64));
    completionWritten = true;
  }, /different source export/);
  assert.equal(completionWritten, false);
  assert.deepEqual(immutablePartial, expected);
});

test('resuming the same verified export accepts unchanged rows despite JSONB key ordering', () => {
  assertSepidarArchiveResumeBinding(metadata, 'a'.repeat(64));
  assertSepidarArchiveStoredRow({ ...expected, payload: { Credit: '0', Debit: '100', VoucherRef: 1 } }, expected);
});

test('changed immutable payload, stale hash, and identity substitution each prevent completion', () => {
  const changed = { ...expected, payload: { ...expected.payload, Debit: '200' } };
  const stale = { ...expected, sourceHash: 'b'.repeat(64) };
  const swapped = { ...expected, sourceKey: '3' };
  for (const stored of [changed, stale, swapped]) {
    let complete = false;
    assert.throws(() => { assertSepidarArchiveStoredRow(stored, expected); complete = true; }, /differs from verified export/);
    assert.equal(complete, false);
  }
});

test('manifest rejects duplicated tables, fractional, negative and unsafe counts', () => {
  for (const value of [[], [manifest[0], manifest[0]], [{ table_name: 'ACC.Voucher', exact_rows: -1 }],
    [{ table_name: 'ACC.Voucher', exact_rows: 0.5 }], [{ table_name: 'ACC.Voucher', exact_rows: Number.MAX_SAFE_INTEGER + 1 }]]) {
    assert.throws(() => validateSepidarArchiveManifest(value));
  }
});

test('row validation catches duplicate identities and missing tables before importing', () => {
  const validator = createSepidarArchiveValidator(validateSepidarArchiveManifest(manifest));
  validator.accept({ table: 'ACC.Voucher', key: '1', payload: { Number: 1 } });
  assert.throws(() => validator.accept({ table: 'ACC.Voucher', key: '1', payload: { Number: 2 } }), /Duplicate/);
  assert.throws(() => validator.finish(), /count mismatch/);
  validator.accept({ table: 'ACC.VoucherItem', key: '2', payload: expected.payload });
  assert.equal(validator.finish(), 2);
});

test('row validation rejects unknown tables, null or primitive payloads and count overflow', () => {
  for (const value of [{ table: 'UNKNOWN', key: '1', payload: {} }, { table: 'ACC.Voucher', key: '', payload: {} },
    { table: 'ACC.Voucher', key: '1', payload: null }, { table: 'ACC.Voucher', key: '1', payload: 'fake' }]) {
    assert.throws(() => createSepidarArchiveValidator(manifest).accept(value), /Invalid source/);
  }
  const validator = createSepidarArchiveValidator(manifest);
  validator.accept({ table: 'ACC.Voucher', key: '1', payload: {} });
  assert.throws(() => validator.accept({ table: 'ACC.Voucher', key: '2', payload: {} }), /exceeds manifest/);
});

test('invalid export bytes and malformed rows reach no snapshot-write boundary', async () => {
  const { mkdtemp, writeFile, rm, rmdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { verifySepidarArchiveExport } = await import('../sepidarArchiveIntegrity');
  const directory = await mkdtemp(join(tmpdir(), 'sepidar-archive-regression-'));
  const file = join(directory, 'source.jsonl');
  const valid = JSON.stringify({ table: 'ACC.Voucher', key: '1', payload: { Number: 1 } }) + '\n'
    + JSON.stringify({ table: 'ACC.VoucherItem', key: '2', payload: expected.payload }) + '\n';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  let writes = 0;
  const importBoundary = async (content: string, expectedHash: string) => {
    await writeFile(file, content, 'utf8');
    await verifySepidarArchiveExport(file, manifest, expectedHash);
    writes++;
  };
  try {
    await assert.rejects(importBoundary(valid, 'b'.repeat(64)), /SHA-256 mismatch/);
    await assert.rejects(importBoundary(valid.split('\n')[0] + '\n', hash(valid.split('\n')[0] + '\n')), /count mismatch/);
    await assert.rejects(importBoundary(valid + valid, hash(valid + valid)), /Duplicate/);
    assert.equal(writes, 0);
    await importBoundary(valid, hash(valid));
    assert.equal(writes, 1);
  } finally {
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
