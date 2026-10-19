import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import { runtimeHttpRequests } from '../../backend/src/services/httpRequestLifecycle';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';
import hiringRouter from '../../backend/src/routes/hr-hiring';
import dutiesRouter from '../../backend/src/routes/hr-duties';
import { HR_HIRING_STORAGE_DIR } from '../../backend/src/services/hrHiringFileStorage';

/** Real router/auth/session/database path inside the already existing private
 * candidate. No main application, jobs, external providers or public listener. */
export async function exerciseHrDeletionFileRetryHttp(db: PrismaClient, root: string) {
  const run = randomUUID();
  const user = (role: 'ADMIN' | 'MANAGER') => db.user.create({ data: {
    email: `${run}-${role}@isolated.example.invalid`, username: `${run}-${role}`, password: 'NO_LOGIN_PRIVATE_QA',
    firstName: 'Isolated', lastName: 'QA', role,
  } });
  const admin = await user('ADMIN'), manager = await user('MANAGER');
  await db.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'Isolated Human Resources' } });
  await db.hrWorkspaceAccessGrant.create({ data: { stableKey: 'http-retry-qa-' + run, userId: manager.id,
    workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', effectiveFrom: new Date(0), grantedByUserId: admin.id,
    reason: 'Isolated actual HR administrator-boundary acceptance' } });
  const adminSession = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Isolated HR route acceptance' });
  const managerSession = await createAuthoritativeSession(db, manager.id, { ipAddress: '127.0.0.1', userAgent: 'Isolated HR route acceptance' });
  const lifecycle = runtimeHttpRequests, app = express();
  app.use(lifecycle.middleware); app.use(express.json()); app.use('/api/hr-hiring', hiringRouter);
  app.use('/api/hr-duties', dutiesRouter); lifecycle.install(app);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = async (id: string, token?: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/hr-hiring/deletion-receipts/${id}/retry-files`, {
        method: 'POST', headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
      });
      return { status: response.status, body: await response.json() as any };
    };
    for (const kind of ['preparing', 'versioned', 'legacy'] as const) {
      const id = randomUUID(), name = `${id}.pdf`, trash = path.join(root, '.deletion-trash', id);
      fs.mkdirSync(trash, { recursive: true }); const stagedPath = path.join(trash, name);
      fs.writeFileSync(stagedPath, 'PRIVATE HTTP CLEANUP COPY');
      const receipt = await db.hrDeletionReceipt.create({ data: {
        id, targetType: 'PERSONNEL', targetId: 'isolated-http-qa', actorUserId: admin.id, reason: 'Isolated actual HTTP retry acceptance',
        previewFingerprint: run, status: kind === 'preparing' ? 'PREPARING' : 'FILE_CLEANUP_PENDING',
        operationToken: kind === 'preparing' ? randomUUID() : null, leaseExpiresAt: kind === 'preparing' ? new Date(0) : null,
        recordCounts: {}, fileCounts: {},
      } });
      const row = await db.hrDeletionFileCleanup.create({ data: {
        receiptId: id, storageName: name, originalPath: path.join(root, name), stagedPath,
        status: kind === 'legacy' ? 'PENDING' : 'VERSIONED_STAGED',
      } });
      assert.equal((await request(id)).status, 401);
      const denied = await request(id, managerSession.token);
      assert.equal(denied.status, 403); assert.match(denied.body.error, /فقط مدیر سامانه/);
      assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
      assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'PRIVATE HTTP CLEANUP COPY');
      const actual = await request(id, adminSession.token);
      if (kind === 'legacy') {
        assert.equal(actual.status, 200); assert.equal(actual.body.success, true);
        assert.deepEqual(actual.body.data, { receiptId: id, status: 'COMPLETED', remaining: 0 });
        assert.equal(fs.existsSync(stagedPath), false);
      } else {
        assert.equal(actual.status, kind === 'preparing' ? 409 : 202);
        assert.equal(actual.body.success, false);
        assert.match(actual.body.error, kind === 'preparing' ? /مرحلهٔ پاک‌سازی/ : /نسخه‌های نگهداری‌شده/);
        assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id } }), receipt);
        assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
        assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'PRIVATE HTTP CLEANUP COPY');
      }
    }
    const candidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Upload QA', mobile: '09120000000' } });
    const application = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id,
      preIdentityReleasedAt: new Date() } });
    // Fault only this isolated database's audit INSERT, after the document's
    // separate INSERT has actually committed. Existing triggers remain intact.
    await db.$executeRawUnsafe(`CREATE FUNCTION public.qa_reject_hiring_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'ISOLATED_POST_DOCUMENT_AUDIT_FAILURE'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER qa_reject_hiring_upload_audit BEFORE INSERT ON public.hr_hiring_audits
      FOR EACH ROW EXECUTE FUNCTION public.qa_reject_hiring_upload_audit()`);
    const bytes = '%PDF-1.4\nPRIVATE COMMITTED DOCUMENT MUST SURVIVE AUDIT FAILURE\n';
    const form = new FormData(); form.append('category', 'NATIONAL_ID_FRONT'); form.append('inspectionSource', 'COPY_RECEIVED');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private-identity.pdf');
    process.env.ALLOW_UNSCANNED_HR_FILES = 'true';
    const uploadResponse = await fetch(`http://127.0.0.1:${address.port}/api/hr-hiring/applications/${application.id}/documents`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${adminSession.token}` }, body: form,
    });
    assert.equal(uploadResponse.status, 500); await uploadResponse.arrayBuffer(); await lifecycle.waitForDrain(1000);
    const document = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: application.id } });
    assert.ok(document.storageName);
    assert.equal(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, document.storageName), 'utf8'), bytes);
    assert.equal(await db.hrHiringAudit.count({ where: { applicationId: application.id } }), 0);
    const plan = await db.hrFormalAssessmentPlan.create({ data: { stableKey: run + '-plan', applicationId: application.id,
      version: 1, executionMethod: 'COMPANY', finalizedByUserId: admin.id,
      selections: { create: { assessmentKind: 'DISC', selected: true, executionMethod: 'COMPANY' } },
    }, include: { selections: true } });
    await db.hrFormalAssessmentResult.create({ data: { stableKey: run + '-result', applicationId: application.id,
      planId: plan.id, planSelectionId: plan.selections[0].id, assessmentKind: 'DISC', resultVersion: 1, status: 'COMPLETED',
      resultJson: { dominance: 20, influence: 30, steadiness: 40, conscientiousness: 50 }, recordedAt: new Date(), recordedByUserId: admin.id,
      attempts: { create: { stableKey: run + '-attempt', attemptNumber: 1, executionMethod: 'COMPANY', status: 'COMPLETED', completedAt: new Date() } },
    } });
    const beforePartial = fs.readdirSync(HR_HIRING_STORAGE_DIR).sort();
    const partial = new FormData();
    partial.append('files', new Blob([bytes], { type: 'application/pdf' }), 'first-valid.pdf');
    partial.append('files', new Blob(['INVALID SIGNATURE'], { type: 'application/pdf' }), 'second-invalid.pdf');
    const partialResponse = await fetch(`http://127.0.0.1:${address.port}/api/hr-hiring/applications/${application.id}/formal-assessments/DISC/evidence`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${adminSession.token}` }, body: partial,
    });
    assert.equal(partialResponse.status, 400); await partialResponse.arrayBuffer(); await lifecycle.waitForDrain(1000);
    const first = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: application.id, category: 'FORMAL_ASSESSMENT' } });
    assert.ok(first.storageName); assert.equal(fs.readFileSync(path.join(HR_HIRING_STORAGE_DIR, first.storageName), 'utf8'), bytes);
    assert.deepEqual(fs.readdirSync(HR_HIRING_STORAGE_DIR).sort(), [...beforePartial, first.storageName].sort());
    const beforeRejected = fs.readdirSync(HR_HIRING_STORAGE_DIR).sort();
    for (const endpoint of [
      `/api/hr-hiring/applications/${application.id}/formal-assessments/INVALID/evidence`,
      `/api/hr-duties/${run}/hiring-finance/original-return`,
      `/api/hr-duties/${run}/hiring-finance/receipt`,
    ]) {
      const rejected = new FormData();
      rejected.append(endpoint.includes('/formal-assessments/') ? 'files' : 'file',
        new Blob([bytes], { type: 'application/pdf' }), 'rejected-before-sql.pdf');
      const response = await fetch(`http://127.0.0.1:${address.port}${endpoint}`, {
        method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${adminSession.token}`, 'x-idempotency-key': randomUUID() }, body: rejected,
      });
      assert.equal(response.status, 400); await response.arrayBuffer(); await lifecycle.waitForDrain(1000);
      assert.deepEqual(fs.readdirSync(HR_HIRING_STORAGE_DIR).sort(), beforeRejected);
    }
    console.log(JSON.stringify({ actualHrUploadSafetyPassed: true,
      cases: ['committed-document-audit-failure', 'partial-batch', 'invalid-kind', 'finance-return-validation', 'finance-receipt-validation'] }));
    await db.authSession.update({ where: { id: adminSession.session.id }, data: { revokedAt: new Date(), revocationReason: 'ISOLATED_QA' } });
    assert.equal((await request(randomUUID(), adminSession.token)).status, 401);
    console.log(JSON.stringify({ actualHrRetryRouterPassed: true, cases: ['anonymous', 'hr-manager', 'admin-preparing', 'admin-versioned', 'admin-legacy', 'revoked-session'] }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await lifecycle.waitForDrain(1000);
    console.log(JSON.stringify({ actualHrRetryHttpClosed: true }));
  }
}
