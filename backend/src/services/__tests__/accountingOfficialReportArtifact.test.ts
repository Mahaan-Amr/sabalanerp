import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retainOfficialReportArtifact } from '../accountingOfficialReportArtifact';

test('repeat export returns the exact frozen bytes and fails closed on missing or altered storage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accounting-artifact-'));
  let hash: string | null = null;
  let renders = 0;
  const input = { root, snapshotId: 'qa-snapshot', format: 'pdf' as const,
    render: async () => { renders++; return Buffer.from(`PDF generation ${renders}`); },
    recordHash: async (next: string) => { assert.equal(hash, null); hash = next; } };
  try {
    const first = await retainOfficialReportArtifact({ ...input, existingHash: hash });
    const second = await retainOfficialReportArtifact({ ...input, existingHash: hash });
    assert.deepEqual(second, first); assert.equal(renders, 1);
    const file = path.join(root, input.snapshotId, `${hash}.pdf`);
    await fs.writeFile(file, 'altered');
    await assert.rejects(retainOfficialReportArtifact({ ...input, existingHash: hash }), /مطابقت ندارد/);
    await fs.unlink(file);
    await assert.rejects(retainOfficialReportArtifact({ ...input, existingHash: hash }), /بازیابی فایل/);
    assert.equal(renders, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
