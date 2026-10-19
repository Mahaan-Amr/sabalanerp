import type { Prisma, PrismaClient } from '@prisma/client';
import { commitStagedHiringFiles } from './hrDeletionFileTransaction';
import { hasDeclaredHrFileProtocol, readHrLegacyFileCleanupRows } from './hrLegacyFileCleanupRows';

/** Legacy cleanup after committed erasure only. Versioned/unknown plans keep
 * their own original-actor closure and retained-copy obligations; the raw retry
 * route must neither unlink their files nor certify them as completed. */
export async function retryDeletionReceiptFiles(prisma: PrismaClient, receiptId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
    const ready = await tx.$queryRaw<Array<{ id: string; recordCounts: Prisma.JsonValue }>>`SELECT id,"recordCounts" FROM public.hr_deletion_receipts
      WHERE id=${receiptId} AND status='FILE_CLEANUP_PENDING' AND "operationToken" IS NULL AND "leaseExpiresAt" IS NULL FOR UPDATE`;
    if (ready.length !== 1) throw Object.assign(
      new Error('عملیات حذف هنوز به مرحلهٔ پاک‌سازی فایل نرسیده است؛ وضعیت عملیات را بررسی کنید.'),
      { code: 'HR_FILE_CLEANUP_RECEIPT_NOT_READY', statusCode: 409 });
    if (hasDeclaredHrFileProtocol(ready[0].recordCounts)) throw Object.assign(
      new Error('پاک‌سازی این عملیات به روش نگهداری فایل آن وابسته است؛ وضعیت نسخه‌های نگهداری‌شده باید بررسی شود.'),
      { code: 'HR_FILE_CLEANUP_PROTOCOL_OWNER_REQUIRED', statusCode: 409 });
    const cleanupRows = await readHrLegacyFileCleanupRows(tx, receiptId);
    if (cleanupRows.some(row => !['PENDING', 'FAILED'].includes(row.status) || row.legacyFileState !== true)) {
      return { receiptId, status: 'FILE_CLEANUP_PENDING', remaining: cleanupRows.length, failed: 0, blocked: cleanupRows.length };
    }
    let failures = 0;
    for (const row of cleanupRows) {
      const failed = commitStagedHiringFiles([{ storageName: row.storageName, originalPath: row.originalPath, stagedPath: row.stagedPath }]);
      if (failed.length) {
        failures += 1;
        await tx.hrDeletionFileCleanup.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: 'FILE_UNLINK_FAILED' }, select: { id: true } });
      } else await tx.hrDeletionFileCleanup.delete({ where: { id: row.id }, select: { id: true } });
    }
    const remaining = await tx.hrDeletionFileCleanup.count({ where: { receiptId } });
    const receipt = await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: remaining ? 'FILE_CLEANUP_PENDING' : 'COMPLETED' } });
    return { receiptId: receipt.id, status: receipt.status, remaining, failed: failures, blocked: 0 };
  }, { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 1000 });
}
