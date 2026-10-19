import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import { runtimeHttpRequests } from '../../backend/src/services/httpRequestLifecycle';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } from '../../backend/src/services/hrPersonnelErasureGraph';
import { HR_HIRING_STORAGE_DIR } from '../../backend/src/services/hrHiringFileStorage';
import { configurePrivateVersionedHrFiles } from '../../backend/src/services/hrFileRuntime';

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.umask(), 0o077);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'postgres'); assert.equal(url.port, '5432');
  assert.match(url.pathname, /^\/qa_hr_erasure_[a-f0-9]{32}$/);
  assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '5');
  const root = path.join(__dirname, 'profile-' + randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const stat = fs.statSync(gate, { bigint: true });
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const runtimeId = randomBytes(32).toString('hex'), journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {});
  const boundary = new RuntimeWorkBoundary(tasks, runtimeHttpRequests, () => {});
  url.searchParams.set('application_name', scope.postgresApplicationName); process.env.DATABASE_URL = url.href;
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  let server: ReturnType<express.Application['listen']> | undefined;
  try {
    const roots = [];
    for (const [index, live] of HR_PERSONNEL_ERASURE_STORAGE_ROOTS.entries()) {
      fs.mkdirSync(live, { recursive: true, mode: 0o700 });
      const store = path.join(root, 'file-store-' + index); fs.mkdirSync(store, { mode: 0o700 });
      roots.push({ root: live, publication: await VersionedFilePublication.open(store, live, boundary.context) });
    }
    assert.throws(() => configurePrivateVersionedHrFiles({ boundary, roots: roots.slice(0, 1) }), /HR_FILE_RUNTIME_ROOT_SET_INCOMPLETE/);
    configurePrivateVersionedHrFiles({ boundary, roots });
    assert.throws(() => configurePrivateVersionedHrFiles({ boundary, roots }), /HR_FILE_RUNTIME_ALREADY_BOUND/);
    const { default: hiringRouter } = await import('../../backend/src/routes/hr-hiring');
    const { default: personnelRouter } = await import('../../backend/src/routes/hr');
    const { default: dutiesRouter } = await import('../../backend/src/routes/hr-duties');
    const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../backend/src/services/identitySessionService');
    const run = randomUUID(), password = 'PRIVATE LOCAL ROUTE QA CONFIRMATION';
    const admin = await db.user.create({ data: { username: 'profile-admin-' + run, email: run + '@isolated.invalid',
      password: await bcrypt.hash(password, 4), firstName: 'Private', lastName: 'Admin', role: 'ADMIN' } });
    await db.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'Private Human Resources' } });
    const session = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Private versioned HR profile acceptance' });
    const candidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Upload Target', mobile: '09120000000' } });
    const application = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id, preIdentityReleasedAt: new Date() } });
    const app = express(); app.use(boundary.middleware); app.use(express.json());
    app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
    app.use('/api/hr-hiring', hiringRouter); app.use('/api/hr', personnelRouter); app.use('/api/hr-duties', dutiesRouter);
    boundary.requests.install(app);
    server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(base + '/api/health'); assert.equal(health.status, 200); await health.arrayBuffer();
    assert.throws(() => runtimeHttpRequests.assertBeforeFirstRequest(), /HTTP_OWNERSHIP_ALREADY_OBSERVED/);
    const bytes = '%PDF-1.4\nPRIVATE ACTUAL VERSIONED HR ROUTE UPLOAD\n';
    const form = new FormData(); form.append('category', 'NATIONAL_ID_FRONT'); form.append('inspectionSource', 'COPY_RECEIVED');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private.pdf');
    process.env.ALLOW_UNSCANNED_HR_FILES = 'true';
    const response = await fetch(base + `/api/hr-hiring/applications/${application.id}/documents`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session.token}` }, body: form,
    });
    assert.equal(response.status, 201); const body = await response.json() as any; assert.equal(body.success, true);
    await boundary.requests.waitForDrain(1000);
    const document = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: application.id } });
    assert.ok(document.storageName);
    const hiring = roots.find(scope => scope.root === HR_HIRING_STORAGE_DIR)!.publication;
    const head = await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(document.storageName);
    assert.ok(head && head.operation === 'PUT', 'Actual HR upload must publish its immutable version before SQL can reference it');
    assert.equal((await hiring.readVersion(head.versionSha256))!.toString(), bytes);
    assert.equal(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, document.storageName), 'utf8'), bytes);
    const headers = { Cookie: `${SESSION_COOKIE}=${session.token}`, 'Content-Type': 'application/json' };
    const legacyId = randomUUID(), legacyTrash = path.join(root, 'legacy-trash'); fs.mkdirSync(legacyTrash, { mode: 0o700 });
    const legacyStaged = path.join(legacyTrash, legacyId + '.pdf'); fs.writeFileSync(legacyStaged, 'PRIVATE LEGACY HELD COPY');
    const legacyReceipt = await db.hrDeletionReceipt.create({ data: { id: legacyId, targetType: 'PERSONNEL',
      targetId: randomUUID(), actorUserId: admin.id, reason: 'Private profile legacy mutation refusal', previewFingerprint: run,
      status: 'FILE_CLEANUP_PENDING', recordCounts: {}, fileCounts: {} } });
    const legacyRow = await db.hrDeletionFileCleanup.create({ data: { receiptId: legacyId, storageName: legacyId + '.pdf',
      originalPath: path.join(HR_HIRING_STORAGE_DIR, legacyId + '.pdf'), stagedPath: legacyStaged, status: 'PENDING' } });
    const legacyRetry = await fetch(base + `/api/hr-hiring/deletion-receipts/${legacyId}/retry-files`, { method: 'POST', headers });
    assert.equal(legacyRetry.status, 409); await legacyRetry.arrayBuffer(); await boundary.requests.waitForDrain(1000);
    assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id: legacyId } }), legacyReceipt);
    assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: legacyRow.id } }), legacyRow);
    assert.equal(fs.readFileSync(legacyStaged, 'utf8'), 'PRIVATE LEGACY HELD COPY');
    await db.hrDeletionReceipt.update({ where: { id: legacyId }, data: { status: 'PREPARING', operationToken: randomUUID(), leaseExpiresAt: new Date(0) } });
    await db.hrDeletionFileCleanup.update({ where: { id: legacyRow.id }, data: { status: 'PREPARING' } });
    const legacyOwner = await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: legacyId } });
    const { recoverInterruptedPersonnelErasures } = await import('../../backend/src/services/hrPersonnelErasureRecovery');
    assert.equal(await recoverInterruptedPersonnelErasures(db), 0);
    assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id: legacyId } }), legacyOwner);
    assert.equal(fs.readFileSync(legacyStaged, 'utf8'), 'PRIVATE LEGACY HELD COPY');
    const preview = await fetch(base + `/api/hr-hiring/applications/${application.id}/deletion-preview`, { headers });
    assert.equal(preview.status, 200); const impact = (await preview.json() as any).data;
    const confirmed = { adminPassword: password, fingerprint: impact.fingerprint, fullName: impact.displayName,
      reason: 'Private actual versioned route erasure acceptance', confirmed: true };
    const denied = await fetch(base + `/api/hr-hiring/applications/${application.id}/permanent-delete`, {
      method: 'POST', headers, body: JSON.stringify({ ...confirmed, adminPassword: 'WRONG PRIVATE QA PASSWORD' }),
    });
    assert.equal(denied.status, 403); await denied.arrayBuffer();
    assert.equal(await db.hrDeletionReceipt.count({ where: { targetType: 'JOB_APPLICATION', targetId: application.id } }), 0);
    const erased = await fetch(base + `/api/hr-hiring/applications/${application.id}/permanent-delete`, {
      method: 'POST', headers, body: JSON.stringify(confirmed),
    });
    assert.equal(erased.status, 202); const erasedBody = await erased.json() as any;
    assert.equal(erasedBody.success, true); assert.equal(erasedBody.data.status, 'FILE_CLEANUP_PENDING');
    await boundary.requests.waitForDrain(1000);
    assert.equal(await db.hrJobApplication.count({ where: { id: application.id } }), 0);
    assert.equal(await db.hrCandidate.count({ where: { id: candidate.id } }), 1);
    assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(document.storageName))!.operation, 'DELETE');
    assert.equal((await hiring.readVersion(head.versionSha256))!.toString(), bytes);
    const person = await db.personnel.create({ data: { firstName: 'Private', lastName: 'Person Target' } });
    const target = await db.user.create({ data: { username: 'profile-person-' + run, email: 'target-' + run + '@isolated.invalid',
      password: 'NO_LOGIN_PRIVATE_QA', firstName: 'Private', lastName: 'Target', role: 'USER', personnelId: person.id } });
    const targetSession = await db.authSession.create({ data: { userId: target.id, tokenHash: randomUUID(),
      idleExpiresAt: new Date(Date.now() + 3600_000), absoluteExpiresAt: new Date(Date.now() + 7200_000) } });
    const personCandidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Person Target',
      mobile: '09120000000', linkedPersonnelId: person.id } });
    const personApplication = await db.hrJobApplication.create({ data: { candidateId: personCandidate.id,
      createdBy: admin.id, preIdentityReleasedAt: new Date() } });
    const personalForm = new FormData(); personalForm.append('category', 'NATIONAL_ID_FRONT'); personalForm.append('inspectionSource', 'COPY_RECEIVED');
    personalForm.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private-personnel.pdf');
    const personalUpload = await fetch(base + `/api/hr-hiring/applications/${personApplication.id}/documents`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session.token}` }, body: personalForm,
    });
    assert.equal(personalUpload.status, 201); await personalUpload.arrayBuffer(); await boundary.requests.waitForDrain(1000);
    const personalDocument = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: personApplication.id } });
    assert.ok(personalDocument.storageName);
    const personalHead = await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(personalDocument.storageName);
    assert.ok(personalHead && personalHead.operation === 'PUT');
    const personnelPreview = await fetch(base + `/api/hr/personnel/${person.id}/deletion-preview`, { headers });
    assert.equal(personnelPreview.status, 200); const personnelImpact = (await personnelPreview.json() as any).data;
    const personnelDeleted = await fetch(base + `/api/hr/personnel/${person.id}/permanent-delete`, { method: 'POST', headers,
      body: JSON.stringify({ adminPassword: password, fingerprint: personnelImpact.fingerprint, fullName: personnelImpact.displayName,
        reason: 'Private actual versioned Personnel route acceptance', confirmed: true }),
    });
    assert.equal(personnelDeleted.status, 202); const personnelBody = await personnelDeleted.json() as any;
    assert.equal(personnelBody.success, true); assert.equal(personnelBody.data.status, 'FILE_CLEANUP_PENDING');
    await boundary.requests.waitForDrain(1000);
    assert.equal(await db.personnel.count({ where: { id: person.id } }), 0);
    assert.equal(await db.user.count({ where: { id: target.id } }), 0);
    assert.equal(await db.authSession.count({ where: { id: targetSession.id } }), 0);
    assert.equal(await db.hrJobApplication.count({ where: { id: personApplication.id } }), 0);
    assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(personalDocument.storageName))!.operation, 'DELETE');
    assert.equal((await hiring.readVersion(personalHead.versionSha256))!.toString(), bytes);
    assert.equal((await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: personnelBody.data.receiptId } })).targetType, 'PERSONNEL');
    const failedCandidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Failure Target', mobile: '09120000000' } });
    const failedApplication = await db.hrJobApplication.create({ data: { candidateId: failedCandidate.id,
      createdBy: admin.id, preIdentityReleasedAt: new Date() } });
    await db.$executeRawUnsafe(`CREATE FUNCTION public.qa_profile_upload_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."applicationId"='${failedApplication.id}' THEN RAISE EXCEPTION 'QA_PROFILE_COMMITTED_UPLOAD_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER qa_profile_upload_audit_failure BEFORE INSERT ON public.hr_hiring_audits
      FOR EACH ROW EXECUTE FUNCTION public.qa_profile_upload_audit_failure()`);
    const failedForm = new FormData(); failedForm.append('category', 'NATIONAL_ID_FRONT'); failedForm.append('inspectionSource', 'COPY_RECEIVED');
    failedForm.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private-failed-audit.pdf');
    const failedUpload = await fetch(base + `/api/hr-hiring/applications/${failedApplication.id}/documents`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session.token}` }, body: failedForm,
    });
    assert.equal(failedUpload.status, 500); await failedUpload.arrayBuffer(); await boundary.requests.waitForDrain(1000);
    const committedDocument = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: failedApplication.id } });
    assert.ok(committedDocument.storageName);
    const committedHead = await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(committedDocument.storageName);
    assert.ok(committedHead && committedHead.operation === 'PUT');
    assert.equal(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, committedDocument.storageName), 'utf8'), bytes);
    await db.$executeRawUnsafe('DROP TRIGGER qa_profile_upload_audit_failure ON public.hr_hiring_audits');
    await db.$executeRawUnsafe('DROP FUNCTION public.qa_profile_upload_audit_failure()');
    const headsDirectory = path.join(root, 'file-store-' + HR_PERSONNEL_ERASURE_STORAGE_ROOTS.indexOf(HR_HIRING_STORAGE_DIR), 'heads');
    for (const endpoint of [
      `/api/hr-hiring/applications/${failedApplication.id}/formal-assessments/INVALID/evidence`,
      `/api/hr-duties/${run}/hiring-finance/original-return`,
      `/api/hr-duties/${run}/hiring-finance/receipt`,
    ]) {
      const headsBefore = new Set(fs.readdirSync(headsDirectory));
      const liveBefore = fs.readdirSync(HR_HIRING_STORAGE_DIR).sort();
      const invalid = new FormData(); invalid.append(endpoint.includes('/formal-assessments/') ? 'files' : 'file',
        new Blob([bytes], { type: 'application/pdf' }), 'private-validation-rejected.pdf');
      const rejected = await fetch(base + endpoint, { method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${session.token}`, 'x-idempotency-key': randomUUID() }, body: invalid });
      assert.equal(rejected.status, 400); await rejected.arrayBuffer(); await boundary.requests.waitForDrain(1000);
      assert.deepEqual(fs.readdirSync(HR_HIRING_STORAGE_DIR).sort(), liveBefore);
      const added = fs.readdirSync(headsDirectory).filter(name => !headsBefore.has(name)); assert.equal(added.length, 1);
      const removedHead = JSON.parse(fs.readFileSync(path.join(headsDirectory, added[0]), 'utf8'));
      assert.equal(removedHead.operation, 'DELETE');
      assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(removedHead.key))!.operation, 'DELETE');
    }
    const failedPreview = await fetch(base + `/api/hr-hiring/applications/${failedApplication.id}/deletion-preview`, { headers });
    assert.equal(failedPreview.status, 200); const failedImpact = (await failedPreview.json() as any).data;
    await db.$executeRawUnsafe(`CREATE FUNCTION public.qa_profile_graph_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."targetType"='JOB_APPLICATION' AND NEW."targetId"='${failedApplication.id}' AND NEW.status='FILE_CLEANUP_PENDING'
        THEN RAISE EXCEPTION 'QA_PROFILE_FINAL_GRAPH_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER qa_profile_graph_failure BEFORE UPDATE ON public.hr_deletion_receipts
      FOR EACH ROW EXECUTE FUNCTION public.qa_profile_graph_failure()`);
    const failedErasure = await fetch(base + `/api/hr-hiring/applications/${failedApplication.id}/permanent-delete`, {
      method: 'POST', headers, body: JSON.stringify({ adminPassword: password, fingerprint: failedImpact.fingerprint,
        fullName: failedImpact.displayName, reason: 'Private actual final graph rollback acceptance', confirmed: true }),
    });
    assert.equal(failedErasure.status, 500); await failedErasure.arrayBuffer(); await boundary.requests.waitForDrain(1000);
    assert.equal(await db.hrJobApplication.count({ where: { id: failedApplication.id } }), 1);
    assert.equal(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, committedDocument.storageName), 'utf8'), bytes);
    assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(committedDocument.storageName))!.operation, 'PUT');
    const aborted = await db.hrDeletionReceipt.findFirstOrThrow({ where: { targetType: 'JOB_APPLICATION', targetId: failedApplication.id } });
    assert.equal(aborted.status, 'ABORTED');
    const children = await db.hrDeletionFileCleanup.findMany({ where: { receiptId: aborted.id } });
    assert.equal(children.length, 1); assert.equal(children[0].status, 'VERSIONED_RESTORED');
    await db.$executeRawUnsafe('DROP TRIGGER qa_profile_graph_failure ON public.hr_deletion_receipts');
    await db.$executeRawUnsafe('DROP FUNCTION public.qa_profile_graph_failure()');
    console.log(JSON.stringify({ actualHrVersionedProfilePassed: true, productionAdmission: false,
      cases: ['startup-root-set', 'actual-versioned-upload', 'password-refusal', 'initial-job-application-erasure',
        'initial-personnel-file-session-erasure', 'committed-upload-audit-failure', 'versioned-validation-cleanup',
        'late-graph-failure-exact-restore-no-raw-fallback'] }));
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    try { await disconnectDatabase(); } finally { await boundary.stopAndDrain(1000); }
    console.log(JSON.stringify({ nativeWorkAndDatabaseClosed: true }));
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'HR_PROFILE_ACCEPTANCE_FAILED'); process.exitCode = 1; });
