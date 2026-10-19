import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { RuntimeWorkContext } from '../../backend/src/services/runtimeWorkContext';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { buildPersonnelErasurePlan } from '../../backend/src/services/hrPersonnelErasureGraph';
import { eraseVersionedPersonnel } from '../../backend/src/services/hrVersionedPersonnelErasure';
import { retryDeletionReceiptFiles } from '../../backend/src/services/hrDeletionFileCleanup';
import { recoverInterruptedPersonnelErasures } from '../../backend/src/services/hrPersonnelErasureRecovery';
import { HR_HIRING_STORAGE_DIR } from '../../backend/src/services/hrHiringFileStorage';

export async function exerciseVersionedPersonnelErasure(database: PrismaClient,
  publication: VersionedFilePublication, work: RuntimeWorkContext, root: string) {
  const run = randomUUID();
  const admin = await database.user.create({ data: { username: 'personnel-admin-' + run,
    email: run + '@isolated.invalid', password: 'NO_LOGIN_PRIVATE_QA', firstName: 'Private', lastName: 'Admin', role: 'ADMIN' } });
  const person = await database.personnel.create({ data: { firstName: 'Private', lastName: 'Erasure' } });
  const user = await database.user.create({ data: { username: 'personnel-target-' + run,
    email: 'target-' + run + '@isolated.invalid', password: 'NO_LOGIN_PRIVATE_QA', firstName: 'Private', lastName: 'Target',
    role: 'USER', personnelId: person.id } });
  await database.hrHiringAuthorityDefaultOwner.create({ data: { authority: 'HR_PROCESSOR', userId: user.id, configuredBy: admin.id } });
  const session = await database.authSession.create({ data: { userId: user.id, tokenHash: randomUUID(),
    idleExpiresAt: new Date(Date.now() + 3600_000), absoluteExpiresAt: new Date(Date.now() + 7200_000) } });
  const impact = await buildPersonnelErasurePlan(database, person.id);
  assert.ok(impact.nodes.User.includes(user.id));
  assert.deepEqual(impact.nodes.HrHiringAuthorityDefaultOwner, ['HR_PROCESSOR']);
  await assert.rejects(eraseVersionedPersonnel({ database, work, roots: [{ root, publication }], personnelId: person.id,
    actorUserId: user.id, reason: 'Private nonadministrator refusal acceptance', expectedFingerprint: impact.fingerprint }),
  { code: 'HR_VERSIONED_PERSONNEL_ADMIN_REQUIRED', statusCode: 403 });
  assert.equal(await database.hrDeletionReceipt.count({ where: { targetType: 'PERSONNEL', targetId: person.id } }), 0);
  assert.equal((await database.user.findUniqueOrThrow({ where: { id: user.id } })).isActive, true);
  const result = await eraseVersionedPersonnel({ database, work, roots: [{ root, publication }],
    personnelId: person.id, actorUserId: admin.id, reason: 'Private native Personnel erasure acceptance',
    expectedFingerprint: impact.fingerprint });
  assert.equal(result.status, 'FILE_CLEANUP_PENDING');
  assert.equal(await database.personnel.count({ where: { id: person.id } }), 0);
  assert.equal(await database.user.count({ where: { id: user.id } }), 0);
  assert.equal(await database.user.count({ where: { id: admin.id } }), 1);
  assert.equal(await database.authSession.count({ where: { id: session.id } }), 0);
  assert.equal(await database.hrHiringAuthorityDefaultOwner.count({ where: { authority: 'HR_PROCESSOR' } }), 0);
  const receipt = await database.hrDeletionReceipt.findUniqueOrThrow({ where: { id: result.receiptId } });
  assert.equal(receipt.targetType, 'PERSONNEL'); assert.equal(receipt.operationToken, null);
  assert.equal(receipt.leaseExpiresAt, null);
  assert.equal((receipt.recordCounts as any).fileProtocol, 'sabalan-versioned-hr-erasure/v1');
  await assert.rejects(retryDeletionReceiptFiles(database, result.receiptId), { code: 'HR_FILE_CLEANUP_PROTOCOL_OWNER_REQUIRED' });
  const makeTarget = async () => {
    const suffix = randomUUID();
    const person = await database.personnel.create({ data: { firstName: 'Private', lastName: 'Compensation' } });
    const user = await database.user.create({ data: { username: 'compensate-' + suffix, email: suffix + '@isolated.invalid',
      password: 'NO_LOGIN_PRIVATE_QA', firstName: 'Private', lastName: 'Target', role: 'USER', personnelId: person.id } });
    const session = await database.authSession.create({ data: { userId: user.id, tokenHash: randomUUID(),
      idleExpiresAt: new Date(Date.now() + 3600_000), absoluteExpiresAt: new Date(Date.now() + 7200_000) } });
    const impact = await buildPersonnelErasurePlan(database, person.id);
    return { person, user, session, impact };
  };
  const hiringVersions = path.join(path.dirname(root), 'personnel-hiring-versions');
  fs.mkdirSync(hiringVersions, { mode: 0o700 });
  const hiringPublication = await VersionedFilePublication.open(hiringVersions, HR_HIRING_STORAGE_DIR, work);
  const enrolledRoots = [{ root, publication }, { root: HR_HIRING_STORAGE_DIR, publication: hiringPublication }];
  const attachFile = async (target: Awaited<ReturnType<typeof makeTarget>>) => {
    const candidate = await database.hrCandidate.create({ data: { firstName: 'Private', lastName: 'File Target',
      mobile: '09120000000', linkedPersonnelId: target.person.id } });
    const application = await database.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id } });
    const name = randomUUID() + '.pdf', bytes = Buffer.from('PRIVATE PERSONNEL FILE RECOVERY COPY');
    const version = await hiringPublication.publish(name, bytes);
    await database.hrHiringDocument.create({ data: { applicationId: application.id, category: 'NATIONAL_ID_FRONT',
      version: 1, inspectionSource: 'COPY_RECEIVED', storageName: name, originalName: 'private.pdf', uploadedBy: admin.id } });
    target.impact = await buildPersonnelErasurePlan(database, target.person.id);
    return { name, bytes, version };
  };
  const withFile = await makeTarget(), source = await attachFile(withFile);
  await assert.rejects(eraseVersionedPersonnel({ database, work, roots: [{ root, publication }], personnelId: withFile.person.id,
    actorUserId: admin.id, reason: 'Private unenrolled file root refusal', expectedFingerprint: withFile.impact.fingerprint }),
  { code: 'HR_VERSIONED_PERSONNEL_FILE_ROOT_UNENROLLED' });
  assert.equal(await database.hrDeletionReceipt.count({ where: { targetType: 'PERSONNEL', targetId: withFile.person.id } }), 0);
  assert.deepEqual(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, source.name)), source.bytes);
  const fileResult = await eraseVersionedPersonnel({ database, work, roots: enrolledRoots, personnelId: withFile.person.id,
    actorUserId: admin.id, reason: 'Private enrolled file root erasure acceptance', expectedFingerprint: withFile.impact.fingerprint });
  assert.equal(fs.existsSync(path.join(HR_HIRING_STORAGE_DIR, source.name)), false);
  assert.deepEqual(await hiringPublication.readVersion(source.version), source.bytes);
  assert.equal(await database.personnel.count({ where: { id: withFile.person.id } }), 0);
  const removedRows = await database.hrDeletionFileCleanup.findMany({ where: { receiptId: fileResult.receiptId } });
  assert.equal(removedRows.length, 1); assert.equal(removedRows[0].status, 'VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING');
  const rolledBack = await makeTarget();
  const restoredFile = await attachFile(rolledBack);
  await database.$executeRawUnsafe(`CREATE FUNCTION public.qa_personnel_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."targetType"='PERSONNEL' AND NEW."targetId"='${rolledBack.person.id}' AND NEW.status='FILE_CLEANUP_PENDING'
      THEN RAISE EXCEPTION 'QA_PERSONNEL_LATE_COMMIT_FAILURE'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER qa_personnel_late_failure BEFORE UPDATE ON public.hr_deletion_receipts
    FOR EACH ROW EXECUTE FUNCTION public.qa_personnel_late_failure()`);
  await assert.rejects(eraseVersionedPersonnel({ database, work, roots: enrolledRoots, personnelId: rolledBack.person.id,
    actorUserId: admin.id, reason: 'Private late SQL rollback acceptance', expectedFingerprint: rolledBack.impact.fingerprint }), /QA_PERSONNEL_LATE_COMMIT_FAILURE/);
  const aborted = await database.hrDeletionReceipt.findFirstOrThrow({ where: { targetType: 'PERSONNEL', targetId: rolledBack.person.id } });
  assert.equal(aborted.status, 'ABORTED'); assert.equal(aborted.operationToken, null);
  assert.equal((await database.user.findUniqueOrThrow({ where: { id: rolledBack.user.id } })).isActive, true);
  const restored = await database.authSession.findUniqueOrThrow({ where: { id: rolledBack.session.id } });
  assert.equal(restored.revokedAt, null); assert.equal(restored.revokedById, rolledBack.session.revokedById);
  assert.equal(restored.revocationReason, rolledBack.session.revocationReason);
  assert.deepEqual(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, restoredFile.name)), restoredFile.bytes);
  const restoredPlans = await database.hrDeletionFileCleanup.findMany({ where: { receiptId: aborted.id } });
  assert.equal(restoredPlans.length, 1); assert.equal(restoredPlans[0].status, 'VERSIONED_RESTORED');
  await database.$executeRawUnsafe('DROP TRIGGER qa_personnel_late_failure ON public.hr_deletion_receipts');
  await database.$executeRawUnsafe('DROP FUNCTION public.qa_personnel_late_failure()');
  const changed = await makeTarget();
  await database.$executeRawUnsafe(`CREATE FUNCTION public.qa_personnel_change_prepared_access() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."targetType"='PERSONNEL' AND NEW."targetId"='${changed.person.id}' AND NEW.status='ACCESS_PREPARED' THEN
      UPDATE public.users SET username='changed-${run}',"updatedAt"="updatedAt"+interval '1 second' WHERE id='${changed.user.id}';
    END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER qa_personnel_change_prepared_access AFTER UPDATE ON public.hr_deletion_receipts
    FOR EACH ROW EXECUTE FUNCTION public.qa_personnel_change_prepared_access()`);
  await assert.rejects(eraseVersionedPersonnel({ database, work, roots: [{ root, publication }], personnelId: changed.person.id,
    actorUserId: admin.id, reason: 'Private changed access refusal acceptance', expectedFingerprint: changed.impact.fingerprint }),
  { code: 'HR_VERSIONED_PERSONNEL_COMPENSATION_UNRESOLVED' });
  const held = await database.hrDeletionReceipt.findFirstOrThrow({ where: { targetType: 'PERSONNEL', targetId: changed.person.id } });
  assert.equal(held.status, 'COMPENSATING'); assert.ok(held.operationToken);
  const preservedUser = await database.user.findUniqueOrThrow({ where: { id: changed.user.id } });
  assert.equal(preservedUser.username, 'changed-' + run); assert.equal(preservedUser.isActive, false);
  assert.equal((await database.authSession.findUniqueOrThrow({ where: { id: changed.session.id } })).revocationReason,
    `PERMANENT_PERSONNEL_ERASURE:${held.id}`);
  await database.hrDeletionReceipt.update({ where: { id: held.id }, data: { leaseExpiresAt: new Date(0) } });
  assert.equal(await recoverInterruptedPersonnelErasures(database), 0);
  await assert.rejects(eraseVersionedPersonnel({ database, work, roots: [{ root, publication }], personnelId: changed.person.id,
    actorUserId: admin.id, reason: 'Private refusal of unresolved predecessor', expectedFingerprint: changed.impact.fingerprint }),
  { code: 'HR_VERSIONED_PERSONNEL_OPERATION_UNRESOLVED' });
  await database.$executeRawUnsafe('DROP TRIGGER qa_personnel_change_prepared_access ON public.hr_deletion_receipts');
  await database.$executeRawUnsafe('DROP FUNCTION public.qa_personnel_change_prepared_access()');
  console.log(JSON.stringify({ versionedPersonnelErasurePassed: true }));
}
