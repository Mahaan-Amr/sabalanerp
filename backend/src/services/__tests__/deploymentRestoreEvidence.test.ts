import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyRestoredFiles } from '../deploymentRestoreEvidence';
import { assertIndependentRecoveryApplicationKeys } from '../deploymentDrillApplicationKeys';

test('restore evidence rejects changed promoted bytes, missing files and unsafe paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-restore-evidence-'));
  try {
    const original = Buffer.from('approved signed contract');
    const file = path.join(root, 'contract.pdf');
    await fs.writeFile(file, original);
    const components = [{ path: 'files/contracts/contract.pdf', size: original.length,
      sha256: createHash('sha256').update(original).digest('hex') }];
    const mappings = [{ payloadPath: 'files/contracts', livePath: root }];
    assert.deepEqual(await verifyRestoredFiles(components, mappings), { files: 1, bytes: 24 });
    await fs.writeFile(file, 'unapproved changed data!!');
    await assert.rejects(verifyRestoredFiles(components, mappings), { code: 'DEPLOYMENT_DRILL_RESTORED_FILE_MISMATCH' });
    await fs.unlink(file);
    await assert.rejects(verifyRestoredFiles(components, mappings), { code: 'DEPLOYMENT_DRILL_RESTORED_FILE_MISMATCH' });
    await assert.rejects(verifyRestoredFiles([{ ...components[0], path: 'files/contracts/../outside' }], mappings),
      { code: 'DEPLOYMENT_DRILL_RESTORED_PATH_UNSAFE' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('verified erasure replay permits only absent performance artifacts and still checks retained bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-restore-erasure-'));
  try {
    const original = Buffer.from('encrypted export');
    const erasedPath = path.join(root, 'erased.enc');
    const retainedPath = path.join(root, 'retained.enc');
    await fs.writeFile(erasedPath, original);
    await fs.writeFile(retainedPath, original);
    const components = ['erased.enc', 'retained.enc'].map(name => ({ path: `files/performance-exports/${name}`,
      size: original.length, sha256: createHash('sha256').update(original).digest('hex') }));
    const mappings = [{ payloadPath: 'files/performance-exports', livePath: root }];
    await verifyRestoredFiles(components, mappings);
    // Reappearance after verified erasure must never be accepted.
    await assert.rejects(verifyRestoredFiles(components, mappings, [erasedPath]), { code: 'DEPLOYMENT_DRILL_ERASED_FILE_PRESENT' });
    await fs.unlink(erasedPath);
    assert.deepEqual(await verifyRestoredFiles(components, mappings, [erasedPath]), { files: 1, bytes: 16, erasedFiles: 1 });
    await fs.writeFile(retainedPath, 'changed ciphertext');
    await assert.rejects(verifyRestoredFiles(components, mappings, [erasedPath]), { code: 'DEPLOYMENT_DRILL_RESTORED_FILE_MISMATCH' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('independent restoration never admits development fallback or a shared export/vault key', () => {
  assert.throws(() => assertIndependentRecoveryApplicationKeys({ NODE_ENV: 'test' }), { code: 'PERFORMANCE_ENCRYPTION_CONFIGURATION_INVALID' });
  const environment = { NODE_ENV: 'test', PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'recovery-vault-v1',
    PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID: 'recovery-export-v1',
    PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 11).toString('base64') };
  assert.deepEqual(assertIndependentRecoveryApplicationKeys(environment), { vaultKeyId: 'recovery-vault-v1', exportKeyId: 'recovery-export-v1' });
  assert.throws(() => assertIndependentRecoveryApplicationKeys({ ...environment,
    PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: environment.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64 }),
  { code: 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_INVALID' });
});
