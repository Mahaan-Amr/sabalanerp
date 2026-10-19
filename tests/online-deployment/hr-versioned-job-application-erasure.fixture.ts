import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { RuntimeWorkContext } from '../../backend/src/services/runtimeWorkContext';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { stableDeletionFingerprint } from '../../backend/src/services/hrRecordRetentionPolicy';
import { eraseVersionedJobApplication } from '../../backend/src/services/hrVersionedJobApplicationErasure';

export async function exerciseVersionedJobApplicationErasure(database: PrismaClient,
  publication: VersionedFilePublication, work: RuntimeWorkContext, root: string) {
  const actorUserId = randomUUID();
  const candidate = await database.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Erasure QA', mobile: '09120000000' } });
  const application = await database.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: actorUserId } });
  const name = randomUUID() + '.pdf', bytes = Buffer.from('PRIVATE APPLICATION ERASURE COPY');
  const version = await publication.publish(name, bytes);
  await database.hrHiringDocument.create({ data: { applicationId: application.id, category: 'NATIONAL_ID_FRONT',
    version: 1, inspectionSource: 'COPY_RECEIVED', storageName: name, originalName: 'private.pdf', uploadedBy: actorUserId } });
  const readImpact = async (tx: Prisma.TransactionClient, id: string) => {
    const current = await tx.hrJobApplication.findUnique({ where: { id }, include: { documents: { orderBy: { id: 'asc' } } } });
    if (!current) return null;
    const files = current.documents.flatMap(row => row.storageName ? [row.storageName] : []).sort();
    return { fingerprint: stableDeletionFingerprint(current, 'PRIVATE FIXTURE FINGERPRINT KEY'), files,
      counts: { applications: 1, documents: current.documents.length }, fileCounts: { liveReferences: files.length } };
  };
  const impact = await database.$transaction(tx => readImpact(tx, application.id)); assert.ok(impact);
  const result = await eraseVersionedJobApplication({ database, publication, work, root, applicationId: application.id,
    actorUserId, reason: 'Private native erasure acceptance', expectedFingerprint: impact.fingerprint, readImpact });
  assert.equal(result.status, 'FILE_CLEANUP_PENDING');
  assert.equal(await database.hrJobApplication.count({ where: { id: application.id } }), 0);
  assert.equal(await database.hrCandidate.count({ where: { id: candidate.id } }), 1);
  assert.equal(await database.hrHiringDocument.count({ where: { applicationId: application.id } }), 0);
  const receipt = await database.hrDeletionReceipt.findUniqueOrThrow({ where: { id: result.receiptId } });
  assert.equal(receipt.targetType, 'JOB_APPLICATION'); assert.equal(receipt.targetId, application.id);
  assert.equal(receipt.operationToken, null); assert.equal(receipt.leaseExpiresAt, null);
  assert.deepEqual(receipt.recordCounts, impact.counts);
  // The native candidate deliberately uses its actual older generated client;
  // read the additive journal column through its public SQL representation.
  const rows = await database.$queryRaw<{ status: string; stagedPath: string; versionedFileState: any }[]>`
    SELECT status,"stagedPath","versionedFileState" FROM public.hr_deletion_file_cleanups WHERE "receiptId"=${result.receiptId}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING');
  assert.equal(rows[0].versionedFileState.removalReceipt.physicalErasure, 'UNPROVEN');
  assert.equal(fs.existsSync(path.join(root, name)), false);
  assert.equal(fs.existsSync(rows[0].stagedPath), false);
  assert.deepEqual(await publication.readVersion(version), bytes);
  const changedApplication = await database.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: actorUserId } });
  const changedName = randomUUID() + '.pdf';
  await publication.publish(changedName, bytes);
  await database.hrHiringDocument.create({ data: { applicationId: changedApplication.id, category: 'NATIONAL_ID_FRONT',
    version: 1, inspectionSource: 'COPY_RECEIVED', storageName: changedName, originalName: 'private.pdf', uploadedBy: actorUserId } });
  const changedImpact = await database.$transaction(tx => readImpact(tx, changedApplication.id)); assert.ok(changedImpact);
  // A real committed metadata change between durable staging and final graph
  // validation; no mocked transaction acknowledgement or private state mutation.
  await database.$executeRawUnsafe(`CREATE FUNCTION public.qa_change_staged_job_application() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public.hr_job_applications a SET "outcomeReason"='CONCURRENT PRIVATE USER CHANGE'
      FROM public.hr_deletion_receipts r WHERE r.id=NEW."receiptId" AND r."targetType"='JOB_APPLICATION' AND a.id=r."targetId";
      RETURN NEW;
    END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER qa_change_staged_job_application AFTER UPDATE ON public.hr_deletion_file_cleanups
    FOR EACH ROW WHEN (NEW.status='VERSIONED_STAGED' AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.qa_change_staged_job_application()`);
  await assert.rejects(eraseVersionedJobApplication({ database, publication, work, root, applicationId: changedApplication.id,
    actorUserId, reason: 'Private concurrent-edit acceptance', expectedFingerprint: changedImpact.fingerprint, readImpact }),
  { code: 'HR_APPLICATION_PREVIEW_CHANGED' });
  const aborted = await database.hrDeletionReceipt.findFirstOrThrow({ where: { targetType: 'JOB_APPLICATION', targetId: changedApplication.id } });
  assert.equal(aborted.status, 'ABORTED'); assert.equal(aborted.operationToken, null); assert.equal(aborted.leaseExpiresAt, null);
  assert.equal(fs.readFileSync(path.join(root, changedName), 'utf8'), bytes.toString());
  assert.equal((await database.hrJobApplication.findUniqueOrThrow({ where: { id: changedApplication.id } })).outcomeReason, 'CONCURRENT PRIVATE USER CHANGE');
  const restored = await database.hrDeletionFileCleanup.findMany({ where: { receiptId: aborted.id } });
  assert.equal(restored.length, 1); assert.equal(restored[0].status, 'VERSIONED_RESTORED');
  assert.equal(fs.existsSync(restored[0].stagedPath), false);
  await database.$executeRawUnsafe('DROP TRIGGER qa_change_staged_job_application ON public.hr_deletion_file_cleanups');
  await database.$executeRawUnsafe('DROP FUNCTION public.qa_change_staged_job_application()');
  const failedApplication = await database.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: actorUserId } });
  const failedName = randomUUID() + '.pdf'; await publication.publish(failedName, bytes);
  await database.hrHiringDocument.create({ data: { applicationId: failedApplication.id, category: 'NATIONAL_ID_FRONT',
    version: 1, inspectionSource: 'COPY_RECEIVED', storageName: failedName, originalName: 'private.pdf', uploadedBy: actorUserId } });
  const failedImpact = await database.$transaction(tx => readImpact(tx, failedApplication.id)); assert.ok(failedImpact);
  await database.$executeRawUnsafe(`CREATE FUNCTION public.qa_fail_job_application_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'PRIVATE_LATE_GRAPH_FAULT'; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER qa_fail_job_application_commit BEFORE UPDATE ON public.hr_deletion_receipts
    FOR EACH ROW WHEN (NEW."targetType"='JOB_APPLICATION' AND NEW.status='FILE_CLEANUP_PENDING')
    EXECUTE FUNCTION public.qa_fail_job_application_commit()`);
  await assert.rejects(eraseVersionedJobApplication({ database, publication, work, root, applicationId: failedApplication.id,
    actorUserId, reason: 'Private late SQL rollback acceptance', expectedFingerprint: failedImpact.fingerprint, readImpact }), /PRIVATE_LATE_GRAPH_FAULT/);
  assert.deepEqual(await database.$transaction(tx => readImpact(tx, failedApplication.id)), failedImpact);
  assert.equal(fs.readFileSync(path.join(root, failedName), 'utf8'), bytes.toString());
  const rolledBack = await database.hrDeletionReceipt.findFirstOrThrow({ where: { targetType: 'JOB_APPLICATION', targetId: failedApplication.id } });
  assert.equal(rolledBack.status, 'ABORTED'); assert.equal(rolledBack.operationToken, null);
  const previousRows = await database.hrDeletionFileCleanup.findMany({ where: { receiptId: rolledBack.id } });
  assert.equal(previousRows.length, 1); assert.equal(previousRows[0].status, 'VERSIONED_RESTORED');
  await database.$executeRawUnsafe('DROP TRIGGER qa_fail_job_application_commit ON public.hr_deletion_receipts');
  await database.$executeRawUnsafe('DROP FUNCTION public.qa_fail_job_application_commit()');
  const retried = await eraseVersionedJobApplication({ database, publication, work, root, applicationId: failedApplication.id,
    actorUserId, reason: 'Private fresh operation after closed abort', expectedFingerprint: failedImpact.fingerprint, readImpact });
  assert.notEqual(retried.receiptId, rolledBack.id);
  assert.equal(await database.hrJobApplication.count({ where: { id: failedApplication.id } }), 0);
  assert.deepEqual(await database.hrDeletionFileCleanup.findMany({ where: { receiptId: rolledBack.id } }), previousRows);
  console.log(JSON.stringify({ versionedJobApplicationErasurePassed: true }));
}
