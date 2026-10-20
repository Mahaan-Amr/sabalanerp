import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configurePrivateVersionedPerformanceFiles, performanceExportStorageDirectory, publishPerformanceExportFile,
  removePerformanceExportFile, runOwnedPerformanceExport, assertPerformanceExportGraphErasureSupported } from '../performanceFileRuntime';

test('ordinary encrypted export storage stays ordinary and cannot acquire a late replacement owner', async () => {
  await assert.rejects(configurePrivateVersionedPerformanceFiles({} as never), /PERFORMANCE_FILE_RUNTIME_SCOPE_INVALID/);
  const previous = process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'sabalan-performance-file-'));
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = root;
  try {
    assert.equal(performanceExportStorageDirectory(), root);
    const file = path.join(root, 'encrypted.enc');
    const bytes = Buffer.from('SPX1-test-ciphertext');
    await runOwnedPerformanceExport(() => publishPerformanceExportFile(file, bytes));
    assert.deepEqual(await readFile(file), bytes);
    assert.doesNotThrow(assertPerformanceExportGraphErasureSupported);
    await removePerformanceExportFile(file);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    await assert.rejects(configurePrivateVersionedPerformanceFiles({} as never), /PERFORMANCE_FILE_RUNTIME_ALREADY_OBSERVED/);
  } finally {
    if (previous === undefined) delete process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR;
    else process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = previous;
    await rm(root, { recursive: true });
  }
});
