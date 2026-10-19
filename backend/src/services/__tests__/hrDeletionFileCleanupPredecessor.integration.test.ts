import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { retryDeletionReceiptFiles } from '../hrDeletionFileCleanup';

test('current generated client completes successful and failed raw cleanup on the real pre-column schema', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.HR_ERASURE_FILE_LOCAL_ACCEPTANCE, '1'); assert.equal(url.host, '127.0.0.1:55432');
  assert.match(url.pathname, /^\/qa_hr_erasure_[a-f0-9]{32}$/);
  assert.ok(Prisma.dmmf.datamodel.models.find(model => model.name === 'HrDeletionFileCleanup')!.fields.some(field => field.name === 'versionedFileState'));
  const db = new PrismaClient(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-hr-predecessor-'));
  try {
    assert.deepEqual(await db.$queryRaw`SELECT count(*)::integer AS count FROM pg_attribute
      WHERE attrelid='public.hr_deletion_file_cleanups'::regclass AND attname='versionedFileState' AND NOT attisdropped`, [{ count: 0 }]);
    for (const kind of ['success', 'failed'] as const) {
      const id = randomUUID(), name = id + '.pdf', trash = path.join(root, '.deletion-trash', id);
      fs.mkdirSync(trash, { recursive: true });
      const stagedPath = kind === 'success' ? path.join(trash, name) : path.join(root, name);
      fs.writeFileSync(stagedPath, 'KNOWN PREDECESSOR CLEANUP COPY');
      await db.hrDeletionReceipt.create({ data: {
        id, targetType: 'PERSONNEL', targetId: 'isolated-predecessor-qa', actorUserId: 'isolated-predecessor-qa',
        reason: 'Isolated current-client predecessor compatibility', previewFingerprint: 'isolated-predecessor-qa',
        status: 'FILE_CLEANUP_PENDING', recordCounts: {}, fileCounts: {},
      } });
      const row = await db.hrDeletionFileCleanup.create({ data: {
        receiptId: id, storageName: name, originalPath: path.join(root, name), stagedPath, status: 'PENDING',
      }, select: { id: true } });
      assert.deepEqual(await retryDeletionReceiptFiles(db, id), {
        receiptId: id, status: kind === 'success' ? 'COMPLETED' : 'FILE_CLEANUP_PENDING',
        remaining: kind === 'success' ? 0 : 1, failed: kind === 'success' ? 0 : 1, blocked: 0,
      });
      assert.equal(fs.existsSync(stagedPath), kind === 'failed');
      if (kind === 'failed') {
        assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'KNOWN PREDECESSOR CLEANUP COPY');
        assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id }, select: { status: true, lastError: true } }),
          { status: 'FAILED', lastError: 'FILE_UNLINK_FAILED' });
      }
    }
  } finally {
    await db.$disconnect();
    const resolvedRoot = fs.realpathSync(root);
    assert.equal(path.dirname(resolvedRoot), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolvedRoot).startsWith('sabalan-hr-predecessor-'));
    fs.rmSync(resolvedRoot, { recursive: true }); console.log('HR_ERASURE_TEST_DATABASE_CLIENT_CLOSED');
  }
});
