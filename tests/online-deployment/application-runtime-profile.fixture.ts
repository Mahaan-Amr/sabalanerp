import type { VersionedFilePublication as FilePublication } from '../../backend/src/services/versionedFilePublication';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import dns from 'node:dns';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import { runtimeHttpRequests } from '../../backend/src/services/httpRequestLifecycle';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } from '../../backend/src/services/hrPersonnelErasureGraph';
import { HR_HIRING_STORAGE_DIR } from '../../backend/src/services/hrHiringFileStorage';
import { configurePrivateVersionedHrFiles } from '../../backend/src/services/hrFileRuntime';

export async function exerciseCanonicalApplicationRuntime() {
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
  let canonical: ReturnType<typeof import('../../backend/src/application')['createApplication']> | undefined;
  let shuttingDown = false;
  let api: ReturnType<typeof import('../../deploy/scripts/browser-release-proxy.mjs')['createApiReleaseProxy']> | undefined;
  const originalAgent = http.globalAgent;
  let localAgent: http.Agent | undefined;
  try {
    const roots: Array<{ root: string; publication: FilePublication }> = [];
    for (const [index, live] of HR_PERSONNEL_ERASURE_STORAGE_ROOTS.entries()) {
      fs.mkdirSync(live, { recursive: true, mode: 0o700 });
      const store = path.join(root, 'file-store-' + index); fs.mkdirSync(store, { mode: 0o700 });
      roots.push({ root: live, publication: await VersionedFilePublication.open(store, live, boundary.context) });
    }
    assert.throws(() => configurePrivateVersionedHrFiles({ boundary, roots: roots.slice(0, 1) }), /HR_FILE_RUNTIME_ROOT_SET_INCOMPLETE/);
    configurePrivateVersionedHrFiles({ boundary, roots });
    assert.throws(() => configurePrivateVersionedHrFiles({ boundary, roots }), /HR_FILE_RUNTIME_ALREADY_BOUND/);
    const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../backend/src/services/identitySessionService');
    const run = randomUUID(), password = 'PRIVATE LOCAL ROUTE QA CONFIRMATION';
    const admin = await db.user.create({ data: { username: 'profile-admin-' + run, email: run + '@isolated.invalid',
      password: await bcrypt.hash(password, 4), firstName: 'Private', lastName: 'Admin', role: 'ADMIN' } });
    // Schema-only clone needs the original migration's required singleton.
    await db.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await db.workspacePermission.create({ data: { userId: admin.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: admin.id } });
    await db.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'Private Human Resources' } });
    const session = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Private versioned HR profile acceptance' });
    const candidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Upload Target', mobile: '09120000000' } });
    const application = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id, preIdentityReleasedAt: new Date() } });
    const { initializeRecoveryRuntime, RECOVERY_COORDINATION_DIR } = await import('../../backend/src/services/recoveryRuntime');
    assert.ok(RECOVERY_COORDINATION_DIR.startsWith(path.dirname(__dirname) + path.sep));
    initializeRecoveryRuntime();
    const { assertRuntimeControlAdmission } = await import('../../backend/src/services/runtimeControlOwnership');
    assertRuntimeControlAdmission();
    const { createApplication } = await import('../../backend/src/application');
    canonical = createApplication({ runtimeRole: 'standalone', isShuttingDown: () => shuttingDown });
    assert.throws(() => createApplication({ runtimeRole: 'candidate', isShuttingDown: () => false }), /APPLICATION_ALREADY_CONSTRUCTED/);
    const { server } = canonical;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const directBase = `http://127.0.0.1:${address.port}`;
    const metadata = (globalThis as any).__sabalanHrErasureNativeInput;
    assert.match(metadata.diagnosticBaseImage, /^sha256:[a-f0-9]{64}$/);
    assert.match(metadata.diagnosticBundleSha256, /^[a-f0-9]{64}$/);
    const { createApiReleaseProxy } = await import('../../deploy/scripts/browser-release-proxy.mjs');
    const { browserRoutingIdentity } = await import('../../deploy/scripts/browser-release-routing.mjs');
    const { BrowserOperationJournal } = await import('../../deploy/scripts/browser-operation-journal.mjs');
    const apiJournalRoot = path.join(root, 'api-journal'); fs.mkdirSync(apiJournalRoot, { mode: 0o700 });
    const apiJournal = new BrowserOperationJournal({ directory: apiJournalRoot, instanceId: runtimeId });
    await apiJournal.initialize();
    const browser = { format: 'sabalan-browser-routing/v1', generation: 1,
      current: { erp: 'erp_app_current', inquiry: 'inquiry_app_current' }, legacy: { erp: 'erp_app_current', inquiry: null },
      builds: ['erp_app_current', 'inquiry_app_current'].map(id => ({ id, application: id.startsWith('erp_') ? 'erp' : 'inquiry',
        slotId: 'slot_' + id, image: metadata.diagnosticBaseImage, manifestSha256: metadata.diagnosticBundleSha256,
        actionIds: [], assets: [], retiredAt: null, supportUntil: null })) };
    const apiRegistry = { format: 'sabalan-api-routing/v1', generation: 1, browserRegistryIdentity: browserRoutingIdentity(browser),
      bindings: [{ buildId: 'erp_app_current', browserManifestSha256: metadata.diagnosticBundleSha256,
        slotId: 'backend_canonical', image: metadata.diagnosticBaseImage, manifestSha256: metadata.diagnosticBundleSha256 }] };
    // Only this enrolled backend address is a private loopback alias. Preserve
    // ordinary DNS for every other host; never mask a provider/unknown target.
    const enrolledBackend = 'backend-app-acceptance';
    const originalLookup = (originalAgent as http.Agent & { options: { lookup?: typeof dns.lookup } }).options.lookup || dns.lookup;
    localAgent = new http.Agent({ lookup: (hostname, options, complete) => originalLookup(
      hostname === enrolledBackend ? '127.0.0.1' : hostname, options, complete) });
    http.globalAgent = localAgent;
    api = createApiReleaseProxy({ loadSnapshot: async () => structuredClone({ browser, api: apiRegistry }),
      slotEndpoints: [{ slotId: 'backend_canonical', host: enrolledBackend, port: address.port,
        image: metadata.diagnosticBaseImage, manifestSha256: metadata.diagnosticBundleSha256 }],
      applicationsByHost: { 'erp.application.invalid': 'erp' }, operationJournal: apiJournal,
      bodyLimit: 96 * 1024 * 1024, totalBodyLimit: 128 * 1024 * 1024 });
    await new Promise<void>(resolve => api!.server.listen(0, '127.0.0.1', resolve));
    const apiAddress = api.server.address(); assert.ok(apiAddress && typeof apiAddress !== 'string');
    const base = `http://127.0.0.1:${apiAddress.port}`;
    const apiRequest = async (url: string, init?: RequestInit): Promise<Response> => {
      const prepared = new Request(url, init), target = new URL(url);
      const payload = init?.body == null ? undefined : Buffer.from(await prepared.arrayBuffer());
      const headers = Object.fromEntries(prepared.headers);
      headers.host = 'erp.application.invalid'; headers['x-deployment-id'] = 'erp_app_current';
      if (payload) headers['content-length'] = String(payload.length);
      return new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: target.port, path: target.pathname + target.search,
          method: prepared.method, headers }, response => {
          const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk)));
          response.once('error', reject); response.once('end', () => {
            const returnedHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) returnedHeaders.append(name, item);
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode!, headers: returnedHeaders }));
          });
        }); request.once('error', reject); request.end(payload);
      });
    };
    const health = await fetch(directBase + '/api/health'); assert.equal(health.status, 200); await health.arrayBuffer();
    assert.throws(() => runtimeHttpRequests.assertBeforeFirstRequest(), /HTTP_OWNERSHIP_ALREADY_OBSERVED/);
    const passive = await fetch('http://127.0.0.1:' + (process.env.PORT || '5000') + '/api/auth/me');
    assert.equal(passive.status, 503); const passiveBody = await passive.json() as any;
    assert.equal(passiveBody.error, 'CANDIDATE_NOT_ACTIVE');
    const ownSession = await apiRequest(base + '/api/auth/me', { headers: { Cookie: `${SESSION_COOKIE}=${session.token}` } });
    assert.equal(ownSession.status, 200); const ownIdentity = await ownSession.json() as any;
    assert.equal(ownIdentity.data.id, admin.id);
    const { customerFinanceData } = await import('../../backend/src/services/__tests__/customerFinanceFixture');
    const { recordCustomerAccountOperation } = await import('../../backend/src/services/accountingCustomerWorkspace');
    const financial = await customerFinanceData(db), customerId = await financial.customer();
    const posted = await recordCustomerAccountOperation(db, customerId, { ...financial.common,
      kind: 'DEBIT', amountRials: 123456789n, idempotencyKey: randomUUID() });
    assert.ok(posted.voucherId);
    assert.equal(await db.accountingLedgerVoucher.count({ where: { id: posted.voucherId!, status: 'POSTED' } }), 1);
    const accounting = await apiRequest(base + '/api/accounting/ledger/customer-accounts/' + encodeURIComponent(customerId), { headers: { Cookie: `${SESSION_COOKIE}=${session.token}` } });
    const account = await accounting.json() as any; assert.equal(accounting.status, 200, JSON.stringify(account));
    assert.equal(account.success, true); assert.equal(String(account.data.netBalanceRials), '123456789');
    const bytes = '%PDF-1.4\nPRIVATE ACTUAL VERSIONED HR ROUTE UPLOAD\n';
    const form = new FormData(); form.append('category', 'NATIONAL_ID_FRONT'); form.append('inspectionSource', 'COPY_RECEIVED');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private.pdf');
    process.env.ALLOW_UNSCANNED_HR_FILES = 'true';
    const response = await apiRequest(base + `/api/hr-hiring/applications/${application.id}/documents`, {
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
    const legacyRetry = await apiRequest(base + `/api/hr-hiring/deletion-receipts/${legacyId}/retry-files`, { method: 'POST', headers });
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
    const preview = await apiRequest(base + `/api/hr-hiring/applications/${application.id}/deletion-preview`, { headers });
    assert.equal(preview.status, 200); const impact = (await preview.json() as any).data;
    const confirmed = { adminPassword: password, fingerprint: impact.fingerprint, fullName: impact.displayName,
      reason: 'Private actual versioned route erasure acceptance', confirmed: true };
    const denied = await apiRequest(base + `/api/hr-hiring/applications/${application.id}/permanent-delete`, {
      method: 'POST', headers, body: JSON.stringify({ ...confirmed, adminPassword: 'WRONG PRIVATE QA PASSWORD' }),
    });
    assert.equal(denied.status, 403); await denied.arrayBuffer();
    assert.equal(await db.hrDeletionReceipt.count({ where: { targetType: 'JOB_APPLICATION', targetId: application.id } }), 0);
    const erased = await apiRequest(base + `/api/hr-hiring/applications/${application.id}/permanent-delete`, {
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
    const personalUpload = await apiRequest(base + `/api/hr-hiring/applications/${personApplication.id}/documents`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session.token}` }, body: personalForm,
    });
    assert.equal(personalUpload.status, 201); await personalUpload.arrayBuffer(); await boundary.requests.waitForDrain(1000);
    const personalDocument = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: personApplication.id } });
    assert.ok(personalDocument.storageName);
    const personalHead = await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(personalDocument.storageName);
    assert.ok(personalHead && personalHead.operation === 'PUT');
    const personnelPreview = await apiRequest(base + `/api/hr/personnel/${person.id}/deletion-preview`, { headers });
    assert.equal(personnelPreview.status, 200); const personnelImpact = (await personnelPreview.json() as any).data;
    const personnelDeleted = await apiRequest(base + `/api/hr/personnel/${person.id}/permanent-delete`, { method: 'POST', headers,
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
    const failedUpload = await apiRequest(base + `/api/hr-hiring/applications/${failedApplication.id}/documents`, {
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
      const rejected = await apiRequest(base + endpoint, { method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${session.token}`, 'x-idempotency-key': randomUUID() }, body: invalid });
      assert.equal(rejected.status, 400); await rejected.arrayBuffer(); await boundary.requests.waitForDrain(1000);
      assert.deepEqual(fs.readdirSync(HR_HIRING_STORAGE_DIR).sort(), liveBefore);
      const added = fs.readdirSync(headsDirectory).filter(name => !headsBefore.has(name)); assert.equal(added.length, 1);
      const removedHead = JSON.parse(fs.readFileSync(path.join(headsDirectory, added[0]), 'utf8'));
      assert.equal(removedHead.operation, 'DELETE');
      assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(removedHead.key))!.operation, 'DELETE');
    }
    const failedPreview = await apiRequest(base + `/api/hr-hiring/applications/${failedApplication.id}/deletion-preview`, { headers });
    assert.equal(failedPreview.status, 200); const failedImpact = (await failedPreview.json() as any).data;
    await db.$executeRawUnsafe(`CREATE FUNCTION public.qa_profile_graph_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."targetType"='JOB_APPLICATION' AND NEW."targetId"='${failedApplication.id}' AND NEW.status='FILE_CLEANUP_PENDING'
        THEN RAISE EXCEPTION 'QA_PROFILE_FINAL_GRAPH_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER qa_profile_graph_failure BEFORE UPDATE ON public.hr_deletion_receipts
      FOR EACH ROW EXECUTE FUNCTION public.qa_profile_graph_failure()`);
    const failedErasure = await apiRequest(base + `/api/hr-hiring/applications/${failedApplication.id}/permanent-delete`, {
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
    console.log(JSON.stringify({ actualCanonicalApplicationProfilePassed: true, productionAdmission: false,
      actualAllCanonicalRouters: true, schedulersStarted: false, recoveryEngineInitialized: false,
      actualPassiveCandidateBusinessRefused: true, actualApiTransportWithCanonicalBackend: true,
      diagnosticSourceOverlay: true, immutableReleaseImagesQualified: false, tlsEdgeQualified: false, actualAccountingAmountRials: '123456789',
      cases: ['authoritative-auth-me', 'actual-accounting-customer-read', 'actual-versioned-upload',
        'initial-job-application-erasure', 'initial-personnel-file-session-erasure',
        'committed-upload-audit-failure', 'versioned-validation-cleanup', 'late-graph-exact-restore'] }));
  } finally {
    if (api) {
      api.beginDrain();
      const deadline = performance.now() + 5000;
      for (;;) {
        try { await api.assertDrained(); break; }
        catch (error) { if (performance.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 5)); }
      }
      await new Promise<void>((resolve, reject) => api!.server.close(error => error ? reject(error) : resolve()));
      assert.deepEqual((await api.readStoppedTransport()).pendingOperations, []);
    }
    http.globalAgent = originalAgent; localAgent?.destroy();
    shuttingDown = true;
    await boundary.stopAndDrain(5000);
    if (canonical) {
      await canonical.realtimeDelivery.stop(5000);
      await new Promise<void>((resolve, reject) => canonical!.io.close(error => error ? reject(error) : resolve()));
      assert.equal(canonical.server.listening, false);
    }
    await disconnectDatabase();
    console.log(JSON.stringify({ actualCanonicalApplicationClosed: true, nativeWorkAndDatabaseClosed: true }));
  }
}
void exerciseCanonicalApplicationRuntime().catch(error => {
  console.error(error instanceof Error ? error.stack : 'APPLICATION_PROFILE_ACCEPTANCE_FAILED'); process.exitCode = 1;
});
