import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { recoverInterruptedPersonnelErasures } from '../hrPersonnelErasureRecovery';
import { retryDeletionReceiptFiles } from '../hrDeletionFileCleanup';

test('expired versioned or unknown file work preserves its receipt and never restores old bytes over a later upload', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.HR_ERASURE_FILE_LOCAL_ACCEPTANCE, '1');
  assert.equal(url.host, '127.0.0.1:55432');
  assert.match(url.pathname, /^\/qa_hr_erasure_[a-f0-9]{32}$/);
  const db = new PrismaClient();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-hr-file-recovery-'));
  try {
    for (const status of ['VERSIONED_PLANNED', 'VERSIONED_STAGING', 'VERSIONED_STAGED', 'UNRECOGNIZED_FORMAT', 'PREPARING_WITH_VERSIONED_STATE', 'PREPARING_WITH_JSON_NULL']) {
      const id = randomUUID(), originalPath = path.join(root, id + '.pdf');
      const trash = path.join(root, '.deletion-trash', id); fs.mkdirSync(trash, { recursive: true });
      const stagedPath = path.join(trash, id + '.pdf');
      fs.writeFileSync(originalPath, 'LATER ACKNOWLEDGED UPLOAD');
      fs.writeFileSync(stagedPath, 'ORIGINAL PRIVATE DOCUMENT');
      const receipt = await db.hrDeletionReceipt.create({ data: {
        id, targetType: 'PERSONNEL', targetId: 'isolated-qa', actorUserId: 'isolated-qa',
        reason: 'Isolated versioned file recovery acceptance', previewFingerprint: 'isolated-qa',
        status: 'PREPARING', operationToken: randomUUID(), leaseExpiresAt: new Date(0), recordCounts: {}, fileCounts: {},
      } });
      let row = await db.hrDeletionFileCleanup.create({ data: {
        receiptId: id, storageName: id + '.pdf', originalPath, stagedPath,
        status: status.startsWith('PREPARING_WITH_') ? 'PREPARING' : status,
        ...(status === 'PREPARING_WITH_VERSIONED_STATE' ? { versionedFileState: { format: 'UNKNOWN' } } : {}),
      } });
      if (status === 'PREPARING_WITH_JSON_NULL') {
        await db.$executeRaw`UPDATE public.hr_deletion_file_cleanups SET "versionedFileState"='null'::jsonb WHERE id=${row.id}`;
        assert.deepEqual(await db.$queryRaw`SELECT "versionedFileState" IS NULL AS "sqlNull" FROM public.hr_deletion_file_cleanups WHERE id=${row.id}`, [{ sqlNull: false }]);
        row = await db.hrDeletionFileCleanup.findUniqueOrThrow({ where: { id: row.id } });
      }
      assert.equal(await recoverInterruptedPersonnelErasures(db), 0);
      assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id } }), receipt);
      assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
      assert.equal(fs.readFileSync(originalPath, 'utf8'), 'LATER ACKNOWLEDGED UPLOAD');
      assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'ORIGINAL PRIVATE DOCUMENT');
    }
    // A new versioned plan commits while recovery waits on the parent row.
    // Recovery must inspect the committed plan after acquiring that lock.
    const observerUrl = new URL(url.href);
    observerUrl.searchParams.set('application_name', 'hr-erasure-observer-' + randomUUID());
    const observer = new PrismaClient({ datasources: { db: { url: observerUrl.href } } });
    let unlock!: () => void, locked!: () => void;
    const lockAcquired = new Promise<void>(resolve => { locked = resolve; });
    const resume = new Promise<void>(resolve => { unlock = resolve; });
    const id = randomUUID();
    const receipt = await db.hrDeletionReceipt.create({ data: {
      id, targetType: 'PERSONNEL', targetId: 'isolated-race-qa', actorUserId: 'isolated-race-qa',
      reason: 'Isolated concurrent recovery acceptance', previewFingerprint: 'isolated-race-qa',
      status: 'PREPARING', operationToken: randomUUID(), leaseExpiresAt: new Date(0), recordCounts: {}, fileCounts: {},
    } });
    const holder = observer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM public.hr_deletion_receipts WHERE id=${id} FOR UPDATE`;
      locked(); await resume;
      await tx.hrDeletionFileCleanup.create({ data: {
        receiptId: id, storageName: 'held.pdf', originalPath: path.join(root, 'held.pdf'),
        stagedPath: path.join(root, '.deletion-trash', id, 'held.pdf'), status: 'VERSIONED_PLANNED',
      } });
    }, { timeout: 15_000, maxWait: 1000 });
    void holder.catch(() => {});
    let recovery: Promise<number> | undefined, recovered: number | undefined;
    try {
      await lockAcquired;
      recovery = recoverInterruptedPersonnelErasures(db);
      void recovery.catch(() => {});
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const rows = await observer.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
          WHERE datname=current_database() AND application_name=${url.searchParams.get('application_name')!}
            AND wait_event_type='Lock' AND query LIKE '%hr_deletion_receipts%'`;
        blocked = rows[0].count > 0n;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true, 'Observe actual PostgreSQL lock contention before releasing the new plan');
    } finally {
      unlock();
      try { await holder; if (recovery) recovered = await recovery; } finally { await observer.$disconnect(); }
    }
    assert.equal(recovered, 0);
    assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id } }), receipt);
    assert.equal((await db.hrDeletionFileCleanup.findFirstOrThrow({ where: { receiptId: id } })).status, 'VERSIONED_PLANNED');
    for (const status of ['PREPARING', 'FILE_CLEANUP_PENDING', 'FILE_CLEANUP_PENDING_JSON', 'FILE_CLEANUP_PENDING_JSON_NULL']) {
      const cleanupId = randomUUID(), name = cleanupId + '.pdf';
      const trash = path.join(root, '.deletion-trash', cleanupId); fs.mkdirSync(trash, { recursive: true });
      const stagedPath = path.join(trash, name); fs.writeFileSync(stagedPath, 'UNPROVEN VERSIONED STAGED COPY');
      const receipt = await db.hrDeletionReceipt.create({ data: {
        id: cleanupId, targetType: 'PERSONNEL', targetId: 'isolated-retry-qa', actorUserId: 'isolated-retry-qa',
        reason: 'Isolated cleanup retry acceptance', previewFingerprint: 'isolated-retry-qa',
        status: status === 'PREPARING' ? 'PREPARING' : 'FILE_CLEANUP_PENDING', operationToken: status === 'PREPARING' ? randomUUID() : null,
        leaseExpiresAt: status === 'PREPARING' ? new Date(0) : null, recordCounts: {}, fileCounts: {},
      } });
      let row = await db.hrDeletionFileCleanup.create({ data: {
        receiptId: cleanupId, storageName: name, originalPath: path.join(root, name), stagedPath,
        status: status.startsWith('FILE_CLEANUP_PENDING_JSON') ? 'PENDING' : 'VERSIONED_STAGED',
        ...(status === 'FILE_CLEANUP_PENDING_JSON' ? { versionedFileState: { format: 'UNKNOWN' } } : {}),
      } });
      if (status === 'FILE_CLEANUP_PENDING_JSON_NULL') {
        await db.$executeRaw`UPDATE public.hr_deletion_file_cleanups SET "versionedFileState"='null'::jsonb WHERE id=${row.id}`;
        assert.deepEqual(await db.$queryRaw`SELECT "versionedFileState" IS NULL AS "sqlNull" FROM public.hr_deletion_file_cleanups WHERE id=${row.id}`, [{ sqlNull: false }]);
        row = await db.hrDeletionFileCleanup.findUniqueOrThrow({ where: { id: row.id } });
      }
      if (status === 'PREPARING') await assert.rejects(retryDeletionReceiptFiles(db, cleanupId),
        error => (error as { code?: string }).code === 'HR_FILE_CLEANUP_RECEIPT_NOT_READY');
      else assert.deepEqual(await retryDeletionReceiptFiles(db, cleanupId), {
        receiptId: cleanupId, status: 'FILE_CLEANUP_PENDING', remaining: 1, failed: 0, blocked: 1,
      });
      assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id: cleanupId } }), receipt);
      assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
      assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'UNPROVEN VERSIONED STAGED COPY');
    }
    const legacyId = randomUUID(), trash = path.join(root, '.deletion-trash', legacyId);
    fs.mkdirSync(trash, { recursive: true }); const stagedPath = path.join(trash, 'legacy.pdf');
    fs.writeFileSync(stagedPath, 'KNOWN COMMITTED LEGACY CLEANUP');
    await db.hrDeletionReceipt.create({ data: {
      id: legacyId, targetType: 'PERSONNEL', targetId: 'isolated-legacy-qa', actorUserId: 'isolated-legacy-qa',
      reason: 'Isolated legacy retry acceptance', previewFingerprint: 'isolated-legacy-qa', status: 'FILE_CLEANUP_PENDING',
      recordCounts: {}, fileCounts: {},
    } });
    await db.hrDeletionFileCleanup.create({ data: {
      receiptId: legacyId, storageName: 'legacy.pdf', originalPath: path.join(root, 'legacy.pdf'), stagedPath, status: 'PENDING',
    } });
    assert.deepEqual(await retryDeletionReceiptFiles(db, legacyId), {
      receiptId: legacyId, status: 'COMPLETED', remaining: 0, failed: 0, blocked: 0,
    });
    assert.equal(fs.existsSync(stagedPath), false);
    const restoreId = randomUUID(), restoreTrash = path.join(root, '.deletion-trash', restoreId);
    fs.mkdirSync(restoreTrash, { recursive: true }); const restoreStaged = path.join(restoreTrash, 'restore.pdf');
    fs.writeFileSync(restoreStaged, 'KNOWN INTERRUPTED LEGACY PREPARATION');
    await db.hrDeletionReceipt.create({ data: {
      id: restoreId, targetType: 'PERSONNEL', targetId: 'isolated-restore-qa', actorUserId: 'isolated-restore-qa',
      reason: 'Isolated legacy compensation acceptance', previewFingerprint: 'isolated-restore-qa', status: 'PREPARING',
      operationToken: randomUUID(), leaseExpiresAt: new Date(0), recordCounts: {}, fileCounts: {},
    } });
    await db.hrDeletionFileCleanup.create({ data: {
      receiptId: restoreId, storageName: 'restore.pdf', originalPath: path.join(root, 'restore.pdf'), stagedPath: restoreStaged, status: 'PREPARING',
    } });
    assert.equal(await recoverInterruptedPersonnelErasures(db), 1);
    assert.equal(fs.readFileSync(path.join(root, 'restore.pdf'), 'utf8'), 'KNOWN INTERRUPTED LEGACY PREPARATION');
    assert.equal((await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: restoreId } })).status, 'ABORTED');
  } finally {
    await db.$disconnect();
    const resolvedRoot = fs.realpathSync(root);
    assert.equal(path.dirname(resolvedRoot), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolvedRoot).startsWith('sabalan-hr-file-recovery-'));
    fs.rmSync(resolvedRoot, { recursive: true });
    console.log('HR_ERASURE_TEST_DATABASE_CLIENT_CLOSED');
  }
});
