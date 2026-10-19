import type { Prisma, PrismaClient } from '@prisma/client';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeWorkContext } from './runtimeWorkContext';
import { VersionedFilePublication } from './versionedFilePublication';
import { createDurableVersionedHiringFileTransaction } from './hrVersionedDeletionFileJournal';
import { eraseJobApplicationRecords } from './hrJobApplicationErasure';
import { assertArchiveReason } from './hrRecordRetentionPolicy';

export type VersionedJobApplicationImpact = Readonly<{
  fingerprint: string; files: readonly string[]; counts: Prisma.InputJsonValue;
  fileCounts: Prisma.InputJsonValue; employmentRelationshipId?: string | null;
}>;

const failure = (code: string, statusCode = 503) => Object.assign(new Error(
  statusCode === 409 ? 'پیش‌نمایش حذف تغییر کرده است؛ دوباره بررسی کنید.'
    : 'عملیات حذف نیازمند بررسی وضعیت است؛ پیش از تلاش دوباره وضعیت عملیات را بررسی کنید.',
), { code, statusCode });

/** Private admitted composition only. The caller supplies the domain's actual
 * transactional impact projection after its administrator confirmation. This
 * command grants no public route, bootstrap, recovery takeover or erasure proof. */
export async function eraseVersionedJobApplication(input: {
  database: PrismaClient; work: RuntimeWorkContext; publication: VersionedFilePublication; root: string;
  applicationId: string; actorUserId: string; reason: string; expectedFingerprint: string;
  readImpact: (tx: Prisma.TransactionClient, applicationId: string) => Promise<VersionedJobApplicationImpact | null>;
}) {
  const { database, work, publication, root, applicationId, actorUserId, expectedFingerprint, readImpact } = input;
  if (!(work instanceof RuntimeWorkContext) || !(publication instanceof VersionedFilePublication)
    || !publication.ownsRoot(root) || !publication.ownsWork(work) || !path.isAbsolute(root) || path.resolve(root) !== root
    || !applicationId || !actorUserId || !/^[a-f0-9]{64}$/.test(expectedFingerprint) || typeof readImpact !== 'function') {
    throw failure('HR_VERSIONED_APPLICATION_SCOPE_INVALID');
  }
  const reason = assertArchiveReason(input.reason);
  const transaction = <T>(body: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel: 'Serializable' | 'ReadCommitted' = 'Serializable') => database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
    return body(tx);
  }, { isolationLevel, timeout: 60_000, maxWait: 1000 });
  return work.run(async () => {
    const receiptId = randomUUID(), operationToken = randomUUID();
    const plannedImpact = await transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sabalan:job-application-erasure:${applicationId}`},0))`;
      const active = await tx.hrDeletionReceipt.count({ where: { targetType: 'JOB_APPLICATION', targetId: applicationId,
        status: { notIn: ['ABORTED', 'COMPLETED'] } } });
      if (active) throw failure('HR_VERSIONED_APPLICATION_OPERATION_UNRESOLVED');
      const impact = await readImpact(tx, applicationId);
      if (!impact || impact.fingerprint !== expectedFingerprint) throw failure('HR_APPLICATION_PREVIEW_CHANGED', 409);
      await tx.hrDeletionReceipt.create({ data: { id: receiptId, targetType: 'JOB_APPLICATION', targetId: applicationId,
        actorUserId, reason, previewFingerprint: expectedFingerprint, status: 'PREPARING', operationToken,
        leaseExpiresAt: new Date(Date.now() + 300_000), recordCounts: impact.counts, fileCounts: impact.fileCounts } });
      return impact;
    }, 'ReadCommitted'); // Re-read active owners after the target lock settles.
    const files = await createDurableVersionedHiringFileTransaction({ database, root, publication, work,
      receiptId, operationToken, targetType: 'JOB_APPLICATION' });
    const plans: string[] = [];
    // Every durable plan precedes the first file mutation. Unknown work stays
    // recorded; no raw-path compensation or expiry-based successor is granted.
    for (const name of [...new Set(plannedImpact.files)].sort()) plans.push((await files.plan(name, receiptId)).id);
    for (const id of plans) await files.stage(id);
    try { await transaction(async tx => {
      // This parent lock MUST precede every destructive graph write. A failed
      // acknowledgement cannot authorize a separate path-only restoration.
      const owner = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.hr_deletion_receipts
        WHERE id=${receiptId} AND "targetType"='JOB_APPLICATION' AND status='PREPARING'
          AND "operationToken"=${operationToken} AND "leaseExpiresAt">clock_timestamp() FOR UPDATE`;
      if (owner.length !== 1) throw failure('HR_VERSIONED_APPLICATION_OWNER_LOST');
      const current = await readImpact(tx, applicationId);
      if (!current || current.fingerprint !== expectedFingerprint) throw failure('HR_APPLICATION_PREVIEW_CHANGED', 409);
      await eraseJobApplicationRecords(tx, applicationId, current.employmentRelationshipId);
      await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: 'FILE_CLEANUP_PENDING',
        operationToken: null, leaseExpiresAt: null, recordCounts: current.counts, fileCounts: current.fileCounts, deletedAt: new Date() } });
    }); } catch (error) {
      // Observe the original parent only after acquiring its real row lock in
      // a fresh READ COMMITTED transaction. A still-running graph transaction
      // must finish first; a late one must pass PREPARING/token checks before
      // touching any graph row. COMPENSATING durably countermands that check.
      let resolution: 'COMMITTED' | 'COMPENSATING';
      try {
        resolution = await transaction(async tx => {
          const rows = await tx.$queryRaw<{ status: string; operationToken: string | null; leaseExpiresAt: Date | null;
            previewFingerprint: string; targetId: string }[]>`SELECT status,"operationToken","leaseExpiresAt","previewFingerprint","targetId"
            FROM public.hr_deletion_receipts WHERE id=${receiptId} AND "targetType"='JOB_APPLICATION' FOR UPDATE`;
          const row = rows[0];
          if (rows.length !== 1 || row.previewFingerprint !== expectedFingerprint || row.targetId !== applicationId) {
            throw failure('HR_VERSIONED_APPLICATION_RESOLUTION_UNPROVEN');
          }
          if (row.status === 'FILE_CLEANUP_PENDING' && row.operationToken === null && row.leaseExpiresAt === null) return 'COMMITTED';
          if (row.status !== 'PREPARING' || row.operationToken !== operationToken) throw failure('HR_VERSIONED_APPLICATION_RESOLUTION_UNPROVEN');
          const changed = await tx.hrDeletionReceipt.updateMany({ where: { id: receiptId, targetType: 'JOB_APPLICATION',
            status: 'PREPARING', operationToken }, data: { status: 'COMPENSATING' } });
          if (changed.count !== 1) throw failure('HR_VERSIONED_APPLICATION_RESOLUTION_UNPROVEN');
          return 'COMPENSATING';
        }, 'ReadCommitted');
      } catch (resolutionError) {
        throw Object.assign(failure('HR_VERSIONED_APPLICATION_RESOLUTION_UNPROVEN'), { receiptId, cause: resolutionError });
      }
      if (resolution === 'COMPENSATING') {
        try {
          for (const id of [...plans].reverse()) await files.restore(id);
          await transaction(async tx => {
            const changed = await tx.hrDeletionReceipt.updateMany({ where: { id: receiptId, targetType: 'JOB_APPLICATION',
              status: 'COMPENSATING', operationToken }, data: { status: 'ABORTED', operationToken: null, leaseExpiresAt: null,
              recordCounts: { aborted: true }, fileCounts: { restored: plans.length } } });
            if (changed.count !== 1) throw failure('HR_VERSIONED_APPLICATION_RESOLUTION_UNPROVEN');
          }, 'ReadCommitted');
        } catch (restoreError) {
          throw Object.assign(failure('HR_VERSIONED_APPLICATION_COMPENSATION_UNRESOLVED'), { receiptId, cause: restoreError });
        }
        throw error;
      }
    }
    for (const id of plans) await files.commit(id);
    // Immutable histories and independent copies are still retained. Do not
    // label this full physical erasure or delete its durable cleanup records.
    return { receiptId, status: 'FILE_CLEANUP_PENDING' as const };
  });
}
