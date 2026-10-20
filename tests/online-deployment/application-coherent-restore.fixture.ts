import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes, randomUUID } from 'node:crypto';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import { runtimeHttpRequests } from '../../backend/src/services/httpRequestLifecycle';

const emit = (value: unknown) => process.stdout.write('APPLICATION_CONTROL:' + JSON.stringify(value) + '\n');
async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.umask(), 0o077);
  const root = process.env.APPLICATION_COHERENT_ROOT!;
  assert.match(root, /^\/app\/online-runtime-acceptance\/application-coherent-[a-f0-9]{32}$/);
  assert.ok(['source', 'restored'].includes(process.env.APPLICATION_COHERENT_MODE!));
  const source = process.env.APPLICATION_COHERENT_MODE === 'source';
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'postgres'); assert.match(url.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const gate = path.join(root, 'deployment-write-admission.lock');
  const stat = fs.fstatSync(10, { bigint: true }), named = fs.statSync(gate, { bigint: true });
  assert.equal(stat.dev, named.dev); assert.equal(stat.ino, named.ino);
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const runtimeId = randomBytes(32).toString('hex'), journalRoot = path.join(root, runtimeId);
  fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {});
  const boundary = new RuntimeWorkBoundary(tasks, runtimeHttpRequests, () => {});
  url.searchParams.set('application_name', scope.postgresApplicationName); process.env.DATABASE_URL = url.href;
  // The singleton and every route import occur only after the private URL and
  // real shared HTTP owner have been fixed for this process incarnation.
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  const { VersionedFilePublication } = await import('../../backend/src/services/versionedFilePublication');
  const { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } = await import('../../backend/src/services/hrPersonnelErasureGraph');
  const { configurePrivateVersionedHrFiles } = await import('../../backend/src/services/hrFileRuntime');
  const { ACCOUNTING_OFFICIAL_REPORT_ROOT, configurePrivateVersionedAccountingFiles } = await import('../../backend/src/services/accountingFileRuntime');
  const { HR_HIRING_STORAGE_DIR } = await import('../../backend/src/services/hrHiringFileStorage');
  const roots: Array<{ name: string; root: string; publication: import('../../backend/src/services/versionedFilePublication').VersionedFilePublication; storeRoot: string }> = [];
  let canonical: ReturnType<typeof import('../../backend/src/application')['createApplication']> | undefined;
  let shuttingDown = false;
  let primaryError: unknown;
  try {
    for (const [index, live] of [...HR_PERSONNEL_ERASURE_STORAGE_ROOTS, ACCOUNTING_OFFICIAL_REPORT_ROOT].entries()) {
      assert.ok(live.startsWith(process.cwd() + path.sep)); fs.mkdirSync(live, { recursive: true, mode: 0o700 });
      const storeRoot = path.join(root, (source ? 'source' : 'restored') + '-store-' + index); fs.mkdirSync(storeRoot, { mode: 0o700 });
      roots.push({ name: 'application-files-' + index, root: live, storeRoot,
        publication: await VersionedFilePublication.open(storeRoot, live, boundary.context) });
    }
    assert.equal(roots.length, 5);
    configurePrivateVersionedHrFiles({ boundary, roots: roots.slice(0, 4) });
    await configurePrivateVersionedAccountingFiles({ boundary, publication: roots[4].publication });
    const { initializeRecoveryRuntime } = await import('../../backend/src/services/recoveryRuntime'); initializeRecoveryRuntime();
    const { createApplication } = await import('../../backend/src/application');
    canonical = createApplication({ runtimeRole: 'standalone', isShuttingDown: () => shuttingDown });
    await new Promise<void>(resolve => canonical!.server.listen(0, '127.0.0.1', resolve));
    const address = canonical.server.address(); assert.ok(address && typeof address !== 'string');
    const base = 'http://127.0.0.1:' + address.port;
    let expected: any;
    const call = async (route: string, options: RequestInit = {}) => fetch(base + route,
      { ...options, headers: { Cookie: expected.cookie, ...options.headers } });
    const upload = async (applicationId: string, contents: string) => {
      const form = new FormData(); form.append('category', 'NATIONAL_ID_FRONT'); form.append('inspectionSource', 'COPY_RECEIVED');
      form.append('file', new Blob([contents], { type: 'application/pdf' }), 'coherent.pdf');
      const response = await call(`/api/hr-hiring/applications/${applicationId}/documents`, { method: 'POST', body: form });
      const body: any = await response.json(); assert.equal(response.status, 201, JSON.stringify(body));
      await boundary.requests.waitForDrain(5000);
      return db.hrHiringDocument.findFirstOrThrow({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
    };
    if (source) {
      const { default: bcrypt } = await import('bcryptjs');
      const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../backend/src/services/identitySessionService');
      const run = randomUUID(), password = 'PRIVATE COHERENT RESTORE CONFIRMATION';
      const admin = await db.user.create({ data: { username: 'coherent-' + run, email: run + '@isolated.invalid',
        password: await bcrypt.hash(password, 4), firstName: 'Coherent', lastName: 'Admin', role: 'ADMIN' } });
      await db.effectiveAuthorizationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 1 }, update: {} });
      await db.workspacePermission.create({ data: { userId: admin.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: admin.id } });
      await db.hrWorkspaceCatalog.upsert({ where: { code: 'HUMAN_RESOURCES' },
        create: { code: 'HUMAN_RESOURCES', displayName: 'Private Human Resources' }, update: {} });
      const session = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Private coherent restore' });
      expected = { cookie: `${SESSION_COOKIE}=${session.token}`, adminId: admin.id };
      const { customerFinanceData } = await import('../../backend/src/services/__tests__/customerFinanceFixture');
      const { recordCustomerAccountOperation } = await import('../../backend/src/services/accountingCustomerWorkspace');
      const finance = await customerFinanceData(db), customerId = await finance.customer();
      const operation = await recordCustomerAccountOperation(db, customerId, { ...finance.common, kind: 'DEBIT', amountRials: 123456789n, idempotencyKey: randomUUID() });
      assert.ok(operation.voucherId);
      expected.customerId = customerId; expected.amountRials = '123456789';
      const candidate = await db.hrCandidate.create({ data: { firstName: 'Coherent', lastName: 'Retained', mobile: '09120000000' } });
      const retained = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id, preIdentityReleasedAt: new Date() } });
      const bytes = '%PDF-1.4\nCOHERENT RETAINED DOCUMENT\n';
      const document = await upload(retained.id, bytes);
      assert.ok(document.storageName);
      expected.applicationId = retained.id; expected.documentId = document.id; expected.documentBytes = bytes;
      expected.storageName = document.storageName;
      const erased = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: admin.id, preIdentityReleasedAt: new Date() } });
      const erasedDocument = await upload(erased.id, '%PDF-1.4\nCOHERENT ERASED DOCUMENT\n');
      const preview = await call(`/api/hr-hiring/applications/${erased.id}/deletion-preview`);
      assert.equal(preview.status, 200); const impact = (await preview.json() as any).data;
      const deletion = await call(`/api/hr-hiring/applications/${erased.id}/permanent-delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminPassword: password,
          fingerprint: impact.fingerprint, fullName: impact.displayName, reason: 'Private coherent restore erasure', confirmed: true }) });
      assert.equal(deletion.status, 202); await deletion.arrayBuffer(); await boundary.requests.waitForDrain(5000);
      assert.equal(await db.hrJobApplication.count({ where: { id: erased.id } }), 0);
      assert.ok(erasedDocument.storageName); assert.equal(fs.existsSync(path.join(HR_HIRING_STORAGE_DIR, erasedDocument.storageName)), false);
      expected.erasedApplicationId = erased.id; expected.erasedDocumentId = erasedDocument.id; expected.erasedStorageName = erasedDocument.storageName;
      fs.writeFileSync(path.join(root, 'application-expected.json'), JSON.stringify(expected), { flag: 'wx', mode: 0o600 });
    } else expected = JSON.parse(fs.readFileSync(path.join(root, 'application-expected.json'), 'utf8'));
    const verify = async () => {
      const identity = await call('/api/auth/me'); assert.equal(identity.status, 200); assert.equal((await identity.json() as any).data.id, expected.adminId);
      const accounting = await call('/api/accounting/ledger/customer-accounts/' + encodeURIComponent(expected.customerId));
      const account = await accounting.json() as any; assert.equal(accounting.status, 200, JSON.stringify(account));
      assert.equal(String(account.data.netBalanceRials), expected.amountRials);
      const download = await call(`/api/hr-hiring/applications/${expected.applicationId}/documents/${expected.documentId}/download`);
      assert.equal(download.status, 200); assert.equal(await download.text(), expected.documentBytes);
      const erased = await call(`/api/hr-hiring/applications/${expected.erasedApplicationId}/documents/${expected.erasedDocumentId}/download`);
      assert.equal(erased.status, 404); await erased.arrayBuffer();
      assert.equal(fs.existsSync(path.join(HR_HIRING_STORAGE_DIR, expected.erasedStorageName)), false);
      assert.equal(await db.hrHiringDocument.count({ where: { applicationId: expected.applicationId } }), 1);
      await boundary.requests.waitForDrain(5000);
    };
    await verify();
    emit({ phase: 'APPLICATION_READY', source, journalRoot, gate: identity, sources: roots.map(value => {
      const stat = fs.statSync(value.root, { bigint: true }); return { name: value.name, path: value.root, device: String(stat.dev), inode: String(stat.ino), storeRoot: value.storeRoot };
    }) });
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let stopped = false;
    for await (const line of input) {
      const command = JSON.parse(line);
      if (command.command === 'seal' && source) {
        const cuts: Array<{name:string;captureId:string;storeRoot:string;sha256:string}> = [];
        for (const value of roots) { const cut = await value.publication.seal(command.captureId, 10);
          cuts.push({ name: value.name, captureId: command.captureId, storeRoot: value.storeRoot, sha256: cut.sha256 }); }
        emit({ phase: 'SEALED', versionedCuts: cuts });
      } else if (command.command === 'mutate' && source) {
        const later = await upload(expected.applicationId, '%PDF-1.4\nPOST CUT DOCUMENT\n');
        assert.equal(await db.hrHiringDocument.count({ where: { applicationId: expected.applicationId } }), 2);
        emit({ phase: 'MUTATED', storageName: later.storageName });
      } else if (command.command === 'stop') { input.close(); stopped = true; break; }
      else throw Error('APPLICATION_CONTROL_UNKNOWN');
    }
    assert.equal(stopped, true, 'APPLICATION_CONTROL_EOF_WITHOUT_STOP');
  } catch (error) { primaryError = error; }
  finally {
    shuttingDown = true;
    await boundary.stopAndDrain(10000);
    if (canonical) { await canonical.realtimeDelivery.stop(10000);
      await new Promise<void>((resolve, reject) => canonical!.io.close(error => error ? reject(error) : resolve()));
      assert.equal(canonical.server.listening, false); }
    await disconnectDatabase(); fs.closeSync(10);
    emit({ phase: 'APPLICATION_CLOSED', source, nativeWorkAndDatabaseClosed: true, journalRoot });
  }
  if (primaryError) throw primaryError;
}
void main().catch(error => { console.error(error instanceof Error ? error.stack : 'APPLICATION_COHERENT_FAILURE'); process.exitCode = 1; });
