import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { archiveWritePath } from '../accountingArchiveStorage';
import { assertAssetEvidenceFiles } from '../accountingAssetEvidenceIntegrity';

test('asset posting binds every scanned document to its real bytes and source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-proof-'));
  try {
    const file = archiveWritePath('proof.pdf', root);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'original');
    const proof = { id: 'proof', bookId: 'book', sourceEntityType: 'FIXED_ASSET', sourceEntityId: 'asset',
      evidenceType: 'ASSET_COST', malwareScanStatus: 'CLEAN', malwareScanAt: new Date(), storageKey: 'proof.pdf',
      sizeBytes: 8n, contentHash: createHash('sha256').update('original').digest('hex') };
    const input = { proofs: [proof], proofIds: ['proof'], sourceId: 'proof', assetId: 'asset', bookId: 'book',
      evidenceType: 'ASSET_COST', applicationRoot: root };
    await assertAssetEvidenceFiles(input);
    await assert.rejects(() => assertAssetEvidenceFiles({ ...input, proofIds: ['other'] }));
    await assert.rejects(() => assertAssetEvidenceFiles({ ...input, proofs: [{ ...proof, malwareScanAt: null }] }));
    await assert.rejects(() => assertAssetEvidenceFiles({ ...input, proofs: [{ ...proof, sourceEntityId: 'other' }] }));
    await fs.writeFile(file, 'tampered');
    await assert.rejects(() => assertAssetEvidenceFiles(input));
    await fs.unlink(file); await assert.rejects(() => assertAssetEvidenceFiles(input));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
