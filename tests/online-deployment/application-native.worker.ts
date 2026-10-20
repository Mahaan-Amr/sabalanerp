import type { VersionedFilePublication as FilePublication } from '../../backend/src/services/versionedFilePublication';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { createApplication } from '../../backend/src/application';
import { assertNativePrivateInterface } from './native-private-network.fixture.mjs';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sync = (directory: string) => { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const password = 'PRIVATE NATIVE APPLICATION CONFIRMATION';
function privateBytes(file: string, maximum = 65536) {
  assert.equal(fs.realpathSync(file), file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!())
      && (before.mode & 0o077n) === 0n && before.size > 0n && before.size <= BigInt(maximum));
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); assert.ok(count > 0); offset += count; }
    assert.equal(fs.readSync(fd, Buffer.alloc(1), 0, 1, null), 0);
    for (const value of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'mode', 'uid'] as const) assert.equal(value[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** Actual canonical routers under the issued native HTTP guardian. The source
 * bundle is diagnostic code, not a new immutable application-image admission. */
async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.umask(), 0o077);
  assert.equal(process.argv[2], 'application-http');
  const cwd = process.env.APPLICATION_NATIVE_CWD!;
  assert.ok(cwd && path.isAbsolute(cwd) && process.cwd() === cwd && fs.realpathSync(cwd) === cwd);
  const home = fs.statSync(cwd); assert.equal(home.uid, process.getuid!()); assert.equal(home.mode & 0o077, 0);
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = path.join(cwd, 'storage/performance-exports');
  process.env.SUPPORT_TICKET_STORAGE_DIR = path.join(cwd, 'storage/support-tickets');
  const phase = process.env.APPLICATION_ACCEPTANCE_PHASE;
  assert.ok(phase === 'seed' || phase === 'reuse' || phase === 'restored');
  if (phase === 'restored') {
    const keys = JSON.parse(privateBytes(path.join(__dirname, 'private-performance-keys.json')).toString());
    for (const key of [keys.vault, keys.exports]) assert.ok(typeof key === 'string' && Buffer.from(key, 'base64').length === 32);
    process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64 = keys.vault;
    process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID = 'qa-native-vault-v1';
    process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64 = keys.exports;
    process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID = 'qa-native-export-v1';
  }
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.pathname, /^\/qa_[a-z_]+_[a-f0-9]{32}$/);
  const { loadOnlineRuntimeScope } = await import('../../backend/src/services/onlineRuntimeScope');
  const input = loadOnlineRuntimeScope(); assert.ok(input);
  assert.equal(input.scope.purpose, 'http'); assert.equal(input.scope.role, 'serving');
  const bindHost = assertNativePrivateInterface(process.env.APPLICATION_NATIVE_BIND_HOST);
  const { configureNativeApplicationEnvironment } = await import('./application-native-environment.fixture');
  const browserEnvironment = configureNativeApplicationEnvironment(input.scope.runtimeId);
  const { createScopedRuntimeWork } = await import('../../backend/src/services/onlineRuntimeWork');
  let boundary: RuntimeWorkBoundary | undefined;
  let application: ReturnType<typeof createApplication> | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let shuttingDown = false;
  let namespace: string | undefined;
  try {
    boundary = await createScopedRuntimeWork({ registrySha256: input.scope.manifestSha256, generation: 1, canJoin: () => true });
    const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma'); disconnect = disconnectDatabase;
    const [actual] = await db.$queryRaw<{ name: string }[]>`SELECT current_setting('application_name')::text AS name`;
    namespace = actual.name;
    const { runtimeNativePostgresApplicationName } = await import('../../backend/src/services/runtimeBoundaryJournal');
    assert.equal(namespace, runtimeNativePostgresApplicationName(input.scope.runtimeId));
    const recovery = await import('../../backend/src/services/recoveryRuntime');
    assert.equal(recovery.RECOVERY_COORDINATION_DIR, input.scope.coordinationDirectory);
    assert.equal(recovery.getRecoveryRuntimeState().mode, 'NORMAL'); // Never initialize/overwrite issued authority.
    const { VersionedFilePublication } = await import('../../backend/src/services/versionedFilePublication');
    const { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } = await import('../../backend/src/services/hrPersonnelErasureGraph');
    const { configurePrivateVersionedHrFiles } = await import('../../backend/src/services/hrFileRuntime');
    const { HR_HIRING_STORAGE_DIR } = await import('../../backend/src/services/hrHiringFileStorage');
    const versionRoot = process.env.APPLICATION_ACCEPTANCE_VERSION_ROOT!;
    assert.ok(path.isAbsolute(versionRoot) && path.resolve(versionRoot) === versionRoot);
    fs.mkdirSync(versionRoot, { recursive: true, mode: 0o700 });
    const roots: Array<{ root: string; publication: FilePublication }> = [];
    for (const [index, live] of HR_PERSONNEL_ERASURE_STORAGE_ROOTS.entries()) {
      assert.ok(live.startsWith(cwd + path.sep)); fs.mkdirSync(live, { recursive: true, mode: 0o700 });
      const store = path.join(versionRoot, 'hr-' + index); fs.mkdirSync(store, { recursive: true, mode: 0o700 });
      roots.push({ root: live, publication: await VersionedFilePublication.open(store, live, boundary.context) });
    }
    configurePrivateVersionedHrFiles({ boundary, roots });
    const { SHARED_UPLOAD_ROOTS, configurePrivateVersionedSharedUploads } = await import('../../backend/src/services/sharedUploadFileRuntime');
    await configurePrivateVersionedSharedUploads({ boundary, roots: roots.filter(value => SHARED_UPLOAD_ROOTS.includes(value.root)) });
    const { ACCOUNTING_OFFICIAL_REPORT_ROOT } = await import('../../backend/src/services/accountingFileRuntime');
    const { DOCUMENT_PDF_RETAINED_ROOTS, DOCUMENT_PDF_EPHEMERAL_ROOTS, configurePrivateVersionedDocumentPdfs } = await import('../../backend/src/services/documentPdfFileRuntime');
    for (const directory of [...DOCUMENT_PDF_EPHEMERAL_ROOTS, ACCOUNTING_OFFICIAL_REPORT_ROOT]) {
      assert.ok(directory.startsWith(cwd + path.sep)); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const addRoot = async (live: string) => {
      assert.ok(live.startsWith(cwd + path.sep)); fs.mkdirSync(live, { recursive: true, mode: 0o700 });
      const store = path.join(versionRoot, 'hr-' + roots.length); fs.mkdirSync(store, { recursive: true, mode: 0o700 });
      const entry = { root: live, publication: await VersionedFilePublication.open(store, live, boundary!.context) };
      roots.push(entry); return entry;
    };
    const pdfRoots: Array<{ root: string; publication: FilePublication }> = []; for (const live of DOCUMENT_PDF_RETAINED_ROOTS) pdfRoots.push(await addRoot(live));
    await configurePrivateVersionedDocumentPdfs({ boundary, roots: pdfRoots });
    const accountingPublication = pdfRoots.find(value => value.root === path.dirname(ACCOUNTING_OFFICIAL_REPORT_ROOT))!.publication;
    const { DISPATCH_DOCUMENT_STORAGE_ROOT, configurePrivateVersionedDispatchFiles } = await import('../../backend/src/services/dispatchFileRuntime');
    await configurePrivateVersionedDispatchFiles({ boundary, publication: (await addRoot(DISPATCH_DOCUMENT_STORAGE_ROOT)).publication });
    const { performanceExportStorageDirectory, configurePrivateVersionedPerformanceFiles } = await import('../../backend/src/services/performanceFileRuntime');
    await configurePrivateVersionedPerformanceFiles({ boundary, publication: (await addRoot(performanceExportStorageDirectory())).publication });
    const { supportTicketStorageDirectory, configurePrivateVersionedSupportFiles } = await import('../../backend/src/services/supportFileRuntime');
    const supportPublication = (await addRoot(supportTicketStorageDirectory())).publication;
    await configurePrivateVersionedSupportFiles({ boundary, publication: supportPublication });
    const { qualifySupportMaintenanceHttpDenial } = await import('./support-retention-native.fixture');
    const supportHttpDenial = await qualifySupportMaintenanceHttpDenial({ boundary });
    const { qualifyPerformanceMaintenanceHttpDenial } = await import('./performance-cleanup-native.fixture');
    const performanceHttpDenial = await qualifyPerformanceMaintenanceHttpDenial({ db, boundary });
    const { customerFinanceData } = await import('../../backend/src/services/__tests__/customerFinanceFixture');
    const { recordCustomerAccountOperation } = await import('../../backend/src/services/accountingCustomerWorkspace');
    const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../backend/src/services/identitySessionService');
    const seedPath = path.join(cwd, 'acceptance-seed.json');
    let seed: any, seedSha256: string;
    if (phase === 'seed') {
      assert.equal(fs.existsSync(seedPath), false);
      assert.equal(await db.user.count(), 0, 'Fresh acceptance database must not contain another actor');
      if (!(await db.effectiveAuthorizationState.findUnique({ where: { id: 1 } }))) {
        await db.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
      }
      const { default: bcrypt } = await import('bcryptjs');
      const run = randomUUID();
      const admin = await db.user.create({ data: { username: 'native-app-' + run, email: run + '@isolated.invalid',
        password: await bcrypt.hash(password, 4), firstName: 'Private', lastName: 'Native Admin', role: 'ADMIN' } });
      await db.workspacePermission.create({ data: { userId: admin.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: admin.id } });
      // The exact repository migration baseline already owns this catalog and
      // its feature/version history. Reuse it without rewriting its meaning.
      const hrCatalog = await db.hrWorkspaceCatalog.findUniqueOrThrow({ where: { code: 'HUMAN_RESOURCES' } });
      assert.equal(hrCatalog.isActive, true); assert.ok(hrCatalog.version >= 1);
      const session = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Native canonical application acceptance' });
      // Fixture identity only: the actual retired HTTP export route must deny
      // this ordinary authenticated actor without reviving a legacy grant or
      // changing any release phase/catalog history.
      const profileActor = await db.user.create({ data: { username: 'native-profile-' + run,
        email: 'profile-' + run + '@isolated.invalid', password: admin.password,
        firstName: 'Private', lastName: 'Pristine profile', role: 'USER' } });
      const profileSession = await createAuthoritativeSession(db, profileActor.id,
        { ipAddress: '127.0.0.1', userAgent: 'Native pristine production-profile acceptance' });
      const financial = await customerFinanceData(db), customerId = await financial.customer();
      const writerCustomerId = await financial.customer();
      const { seedNativeDispatchPrerequisites } = await import('./dispatch-domain-prerequisites-native.fixture');
      const dispatchPrerequisites = await seedNativeDispatchPrerequisites(db, admin.id, await financial.customer());
      const posted = await recordCustomerAccountOperation(db, customerId, { ...financial.common, kind: 'DEBIT', amountRials: 123456789n, idempotencyKey: randomUUID() });
      assert.ok(posted.voucherId);
      const apiCandidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Durable API Routing', mobile: '09120000000' } });
      const apiApplication = await db.hrJobApplication.create({ data: { candidateId: apiCandidate.id,
        createdBy: admin.id, preIdentityReleasedAt: new Date() } });
      seed = { format: 'sabalan-private-native-application-seed/v1', database: url.pathname.slice(1), root: cwd,
        adminId: admin.id, sessionToken: session.token,
        performanceProductionProfile: { actorId: profileActor.id, sessionToken: profileSession.token },
        customerId, writerCustomerId, dispatchPrerequisites, voucherId: posted.voucherId, apiApplicationId: apiApplication.id,
        hrCatalogSha256: digest(Buffer.from(JSON.stringify(hrCatalog))),
        accountingBookId: financial.book.id, accountingFiscalYearId: financial.year.id,
        command: { ...financial.common, occurredAt: financial.common.occurredAt.toISOString() } };
      const bytes = Buffer.from(JSON.stringify(seed)); seedSha256 = digest(bytes);
      const fd = fs.openSync(seedPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } sync(cwd);
    } else {
      assert.match(process.env.APPLICATION_ACCEPTANCE_SEED_SHA256 || '', /^[a-f0-9]{64}$/);
      const bytes = privateBytes(seedPath);
      seedSha256 = digest(bytes); assert.equal(seedSha256, process.env.APPLICATION_ACCEPTANCE_SEED_SHA256);
      seed = JSON.parse(bytes.toString('utf8'));
      assert.equal(seed.format, 'sabalan-private-native-application-seed/v1');
      assert.equal(seed.database, phase === 'restored' ? process.env.APPLICATION_ACCEPTANCE_ORIGINAL_DATABASE : url.pathname.slice(1));
      assert.equal(seed.root, phase === 'restored' ? process.env.APPLICATION_ACCEPTANCE_ORIGINAL_CWD : cwd);
      if (phase === 'reuse') await recordCustomerAccountOperation(db, seed.customerId, { ...seed.command, occurredAt: new Date(seed.command.occurredAt),
        kind: 'DEBIT', amountRials: 11n, idempotencyKey: 'native-app-reuse-' + input.scope.runtimeId });
    }
    assert.equal(digest(Buffer.from(JSON.stringify(await db.hrWorkspaceCatalog.findUniqueOrThrow({ where: { code: 'HUMAN_RESOURCES' } })))),
      seed.hrCatalogSha256, 'Migrated catalog meaning must remain unchanged across source and restore');
    const { createApplication } = await import('../../backend/src/application');
    application = createApplication({ runtimeRole: 'standalone', isShuttingDown: () => shuttingDown });
    const { server } = application;
    await new Promise<void>(resolve => server.listen(0, bindHost, resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, bindHost);
    const base = `http://${bindHost}:${address.port}`;
    const headers = { Cookie: `${SESSION_COOKIE}=${seed.sessionToken}`, 'Content-Type': 'application/json' };
    let contractPrint: object | undefined;
    let supportStagedHttp: import('./support-staged-http-native.fixture').SupportStagedHttpQualification | undefined;
    let securityUpload: import('./security-upload-native.fixture').SecurityUploadQualification | undefined;
    let realtimeHttp: Awaited<ReturnType<typeof import('./realtime-http-native.fixture')['qualifyNativeHttpRealtime']>> | undefined;
    let pristinePerformanceProfile: Awaited<ReturnType<typeof import('./installed-performance-disabled-profile.fixture')['qualifyInstalledDisabledPerformanceProfile']>> | undefined;
    if (phase === 'seed') {
      const { qualifyInstalledDisabledPerformanceProfile } = await import('./installed-performance-disabled-profile.fixture');
      pristinePerformanceProfile = await qualifyInstalledDisabledPerformanceProfile({ db, base,
        actorId: seed.performanceProductionProfile.actorId, sessionToken: seed.performanceProductionProfile.sessionToken,
        exportRoot: performanceExportStorageDirectory() });
      const { qualifyNativeContractPrint } = await import('./contract-print-native.fixture');
      contractPrint = await qualifyNativeContractPrint({ db, reporterId: seed.adminId, baseUrl: base, sessionToken: seed.sessionToken });
      const { qualifyNativeSecurityUpload } = await import('./security-upload-native.fixture');
      securityUpload = await qualifyNativeSecurityUpload({ db, actorId: seed.adminId, baseUrl: base, sessionToken: seed.sessionToken });
      const { qualifyNativeHttpRealtime } = await import('./realtime-http-native.fixture');
      realtimeHttp = await qualifyNativeHttpRealtime({ baseUrl: base, databaseUrl: process.env.DATABASE_URL!,
        sessionToken: seed.sessionToken, reporterId: seed.adminId });
      const { qualifyNativeSupportStagedHttp } = await import('./support-staged-http-native.fixture');
      supportStagedHttp = await qualifyNativeSupportStagedHttp({ db, boundary, publication: supportPublication, baseUrl: base,
        sessionToken: seed.sessionToken, reporterId: seed.adminId });
      await boundary.requests.waitForDrain(5000);
    }
    const me = await fetch(base + '/api/auth/me', { headers }); const meBody = await me.json() as any;
    assert.equal(me.status, 200, JSON.stringify(meBody)); assert.equal(meBody.data.id, seed.adminId);
    const expected = phase === 'seed' ? '123456789' : '123456800';
    const account = await fetch(base + '/api/accounting/ledger/customer-accounts/' + encodeURIComponent(seed.customerId), { headers });
    const accountBody = await account.json() as any; assert.equal(account.status, 200, JSON.stringify(accountBody));
    assert.equal(String(accountBody.data.netBalanceRials), expected);
    type AccountingArtifact = { snapshotId: string; key: string; sha256: string; bytes: number; amountRials: string };
    let accountingArtifact: AccountingArtifact | undefined;
    const XLSX: typeof import('../../backend/node_modules/xlsx') = require('xlsx');
    const verifyWorkbook = (bytes: Buffer, amount: string) => {
      // SheetJS decorates its input Buffer with parser cursor properties.
      // Preserve the original immutable payload used for exact byte checks.
      const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' }); assert.ok(workbook.SheetNames.length > 0);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      assert.ok(rows.flat().some(value => String(value) === amount), 'actual official XLSX must contain the committed amount');
    };
    if (phase !== 'restored') {
      const response = await fetch(base + '/api/accounting/period-end/report-snapshots', { method: 'POST', headers,
        body: JSON.stringify({ request: { reportKind: 'TRIAL_BALANCE', bookId: seed.accountingBookId,
          fiscalYearId: seed.accountingFiscalYearId, from: '2026-01-01', to: '2026-12-31',
          cutoffAt: new Date().toISOString(), columns: 2, level: 'SUBSIDIARY' } }) });
      const created = await response.json() as any; assert.equal(response.status, 201, JSON.stringify(created));
      const snapshotId = created.data.snapshot.id;
      const first = await fetch(base + `/api/accounting/period-end/report-snapshots/${snapshotId}/export.xlsx`, { headers });
      assert.equal(first.status, 200); const bytes = Buffer.from(await first.arrayBuffer()); verifyWorkbook(bytes, expected);
      const stored = await db.accountingOfficialReportSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
      const sha256 = digest(bytes); assert.equal(stored.excelHash, sha256);
      const key = `${snapshotId}/${sha256}.xlsx`;
      const reportFiles = await accountingPublication.bindRoot(ACCOUNTING_OFFICIAL_REPORT_ROOT);
      const head = await reportFiles.inspect(key); assert.equal(head?.operation, 'PUT');
      assert.deepEqual(await reportFiles.read(key), bytes);
      const repeat = await fetch(base + `/api/accounting/period-end/report-snapshots/${snapshotId}/export.xlsx`, { headers });
      assert.equal(repeat.status, 200); assert.deepEqual(Buffer.from(await repeat.arrayBuffer()), bytes);
      assert.deepEqual(await reportFiles.inspect(key), head, 'repeat frozen export cannot publish another version');
      accountingArtifact = { snapshotId, key, sha256, bytes: bytes.length, amountRials: expected };
    }
    let restoredAcceptance: object | undefined;
    if (phase === 'restored') {
      const expectedFile = path.join(cwd, 'restore-expectations.json');
      const restored = JSON.parse(privateBytes(expectedFile).toString('utf8'));
      assert.equal(await db.hrHiringDocument.count({ where: { applicationId: seed.apiApplicationId } }), 4);
      for (const upload of restored.uploads) {
        const response = await fetch(base + `/api/hr-hiring/applications/${seed.apiApplicationId}/documents/${upload.id}/download`, { headers });
        assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, upload.bytes); assert.equal(digest(bytes), upload.sha256);
      }
      for (const erased of restored.erased) {
        const response = await fetch(base + `/api/hr-hiring/applications/${erased.applicationId}/documents/${erased.documentId}/download`, { headers });
        assert.equal(response.status, 404); await response.arrayBuffer();
        assert.equal(fs.existsSync(path.join(HR_HIRING_STORAGE_DIR, erased.storageName)), false);
      }
      assert.equal(await db.hrHiringDocument.count({ where: { id: restored.postCutDocumentId } }), 0);
      assert.equal(fs.existsSync(path.join(HR_HIRING_STORAGE_DIR, restored.postCutStorageName)), false);
      assert.equal(restored.accountingArtifacts.length, 2);
      for (const artifact of restored.accountingArtifacts as AccountingArtifact[]) {
        const response = await fetch(base + `/api/accounting/period-end/report-snapshots/${artifact.snapshotId}/export.xlsx`, { headers });
        assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(digest(bytes), artifact.sha256); assert.equal(bytes.length, artifact.bytes); verifyWorkbook(bytes, artifact.amountRials);
        const reportFiles = await accountingPublication.bindRoot(ACCOUNTING_OFFICIAL_REPORT_ROOT);
        assert.equal((await reportFiles.inspect(artifact.key))?.operation, 'PUT');
      }
      assert.equal(restored.sharedImages.length, 2);
      for (const image of restored.sharedImages) {
        const response = await fetch(base + image.url, { headers }); assert.equal(response.status, 200);
        assert.equal(digest(Buffer.from(await response.arrayBuffer())), image.sha256);
      }
      const { verifyRestoredSupportStagedHttp } = await import('./support-staged-http-native.fixture');
      const restoredSupportStagedHttp = await verifyRestoredSupportStagedHttp({ db, baseUrl: base, sessionToken: seed.sessionToken,
        qualification: restored.supportStagedHttp });
      const { verifyRestoredSupportRetention } = await import('./support-retention-native.fixture');
      await verifyRestoredSupportRetention({ db, qualification: restored.supportRetention });
      const { verifyRestoredPerformanceCleanup } = await import('./performance-cleanup-native.fixture');
      await verifyRestoredPerformanceCleanup({ db, qualification: restored.performanceCleanup });
      const { verifyRestoredPerformanceExport } = await import('./performance-export-native.fixture');
      const restoredPerformance = await verifyRestoredPerformanceExport({ db, boundary, qualification: restored.performanceExport });
      assert.equal(restoredPerformance.actualRestoredDomainDownloadPathQualified, true);
      const { verifyRestoredNativeDispatch } = await import('./dispatch-artifact-native.fixture');
      await verifyRestoredNativeDispatch({ db, qualification: restored.dispatchArtifact });
      const { verifyRestoredContractPrint } = await import('./contract-print-native.fixture');
      await verifyRestoredContractPrint({ db, qualification: restored.contractPrint, baseUrl: base, sessionToken: seed.sessionToken });
      const { verifyRestoredNativeSecurityUpload } = await import('./security-upload-native.fixture');
      await verifyRestoredNativeSecurityUpload({ db, actorId: seed.adminId, baseUrl: base,
        sessionToken: seed.sessionToken, qualification: restored.securityUpload });
      const { verifyRestoredBrowserSupportTickets } = await import('./browser-support-restore-native.fixture');
      const restoredBrowserSupport = await verifyRestoredBrowserSupportTickets({ db, base, headers,
        tickets: restored.browserSupportTickets, actorId: seed.adminId });
      await boundary.requests.waitForDrain(5000);
      restoredAcceptance = { originalSession: true, amountRials: expected, retainedDownloads: 4, erasedDownloads404: 2, officialXlsxContents: 2,
        postCutAbsent: true, restoredSharedImages: 2, restoredSupportRetentionCases: 5, restoredSupportStagedHolds: 3,
        restoredDispatchArtifactProducer: true, restoredPrintedContract: true, restoredBrowserSupport,
        restoredPerformanceCleanupCases: restored.performanceCleanup.cases.length, restoredPerformanceDomainDownload: true,
        restoredSupportStagedHttp, fullDispatchIssuanceQualified: false, productionAdmission: false };
    }
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
    const imageForm = new FormData(); imageForm.append('image', new Blob([png], { type: 'image/png' }), 'native.png');
    const imageUpload = await fetch(base + '/api/uploads/images', { method: 'POST', headers: { Cookie: headers.Cookie }, body: imageForm });
    const imageBody = await imageUpload.json() as any; assert.equal(imageUpload.status, 201, JSON.stringify(imageBody));
    assert.equal(imageBody.data.size, png.length);
    const imageOwner = roots.find(value => value.root === path.join(cwd, 'uploads/images'))!;
    assert.ok(imageOwner); const imageFiles = await imageOwner.publication.bindRoot(imageOwner.root);
    assert.equal((await imageFiles.inspect(imageBody.data.filename))?.operation, 'PUT');
    assert.deepEqual(await imageFiles.read(imageBody.data.filename), png);
    const imageRead = await fetch(base + imageBody.data.url, { headers }); assert.equal(imageRead.status, 200);
    assert.deepEqual(Buffer.from(await imageRead.arrayBuffer()), png);
    const sharedImage = { url: imageBody.data.url, key: imageBody.data.filename, sha256: digest(png), bytes: png.length };
    let erasedEvidence: object | undefined;
    {
    const candidate = await db.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Native Upload ' + phase, mobile: '09120000000' } });
    const target = await db.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: seed.adminId, preIdentityReleasedAt: new Date() } });
    const bytes = '%PDF-1.4\nPRIVATE NATIVE APP ' + input.scope.runtimeId + '\n';
    const form = new FormData(); form.append('category', 'NATIONAL_ID_FRONT'); form.append('inspectionSource', 'COPY_RECEIVED');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'private.pdf');
    process.env.ALLOW_UNSCANNED_HR_FILES = 'true';
    const uploaded = await fetch(base + `/api/hr-hiring/applications/${target.id}/documents`, { method: 'POST', headers: { Cookie: headers.Cookie }, body: form });
    const uploadBody = await uploaded.json() as any; assert.equal(uploaded.status, 201, JSON.stringify(uploadBody));
    await boundary.requests.waitForDrain(5000);
    const document = await db.hrHiringDocument.findFirstOrThrow({ where: { applicationId: target.id } }); assert.ok(document.storageName);
    const hiring = roots.find(value => value.root === HR_HIRING_STORAGE_DIR)!.publication;
    const head = await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(document.storageName!);
    assert.equal(head?.operation, 'PUT'); assert.deepEqual(await hiring.readVersion(head!.versionSha256), Buffer.from(bytes));
    const preview = await fetch(base + `/api/hr-hiring/applications/${target.id}/deletion-preview`, { headers });
    const impact = (await preview.json() as any).data; assert.equal(preview.status, 200);
    const erased = await fetch(base + `/api/hr-hiring/applications/${target.id}/permanent-delete`, { method: 'POST', headers,
      body: JSON.stringify({ adminPassword: password, fingerprint: impact.fingerprint, fullName: impact.displayName,
        reason: 'Private genuine native application erasure acceptance', confirmed: true }) });
    const erasedBody = await erased.json() as any; assert.equal(erased.status, 202, JSON.stringify(erasedBody));
    await boundary.requests.waitForDrain(5000);
    assert.equal(await db.hrJobApplication.count({ where: { id: target.id } }), 0);
    assert.equal(await db.hrCandidate.count({ where: { id: candidate.id } }), 1);
    assert.equal((await (await hiring.bindRoot(HR_HIRING_STORAGE_DIR)).inspect(document.storageName!))?.operation, 'DELETE');
    assert.deepEqual(await hiring.readVersion(head!.versionSha256), Buffer.from(bytes));
    erasedEvidence = { applicationId: target.id, documentId: document.id, storageName: document.storageName };
    }
    if (phase === 'restored') restoredAcceptance = { ...restoredAcceptance, freshVersionedUploadAndErasure: true };
    console.log(JSON.stringify({ event: 'ready', host: bindHost, port: address.port, namespace, runtimeId: input.scope.runtimeId, seedSha256,
      sources: roots.map((value, ordinal) => { const live = fs.statSync(value.root, { bigint: true });
        const storeRoot = path.join(process.env.APPLICATION_ACCEPTANCE_VERSION_ROOT!, 'hr-' + ordinal), store = fs.statSync(storeRoot, { bigint: true });
        return { name: 'application-files-' + ordinal, path: value.root, device: String(live.dev), inode: String(live.ino),
          storeRoot, storeIdentity: { device: String(store.dev), inode: String(store.ino) } }; }),
      erased: erasedEvidence, restoredAcceptance, accountingArtifact, sharedImage, supportHttpDenial, performanceHttpDenial, pristinePerformanceProfile, contractPrint, supportStagedHttp, securityUpload, realtimeHttp, browserEnvironment,
      applicationAcceptance: { canonicalRouters: true, authoritativeSession: true, financialAmountRials: expected,
        uploadedThenErased: true, immutableBytesRetained: true, productionAdmission: false, immutableReleaseImagesQualified: false } }));
    const finish = path.join(input.scope.coordinationDirectory, 'diagnostic-finish', input.scope.runtimeId);
    while (!fs.existsSync(finish)) await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    shuttingDown = true;
    if (application?.server.listening) {
      const address = application.server.address(); assert.ok(address && typeof address !== 'string');
      const base = `http://${bindHost}:${address.port}`;
      const refused = await fetch(base + '/api/auth/me'); const denial = await refused.json() as any;
      assert.equal(refused.status, 503); assert.equal(denial.error, 'RUNTIME_DRAINING');
      assert.equal(denial.message, "\u0633\u0627\u0645\u0627\u0646\u0647 \u062f\u0631 \u062d\u0627\u0644 \u0622\u0645\u0627\u062f\u0647\u200c\u0633\u0627\u0632\u06cc \u0646\u0633\u062e\u0647 \u0627\u0633\u062a\u061b \u06a9\u0645\u06cc \u0628\u0639\u062f \u062f\u0648\u0628\u0627\u0631\u0647 \u062a\u0644\u0627\u0634 \u06a9\u0646\u06cc\u062f.");
      const readiness = await fetch(base + '/api/ready'); assert.equal(readiness.status, 503); await readiness.arrayBuffer();
      const health = await fetch(base + '/api/health'); assert.equal(health.status, 200); await health.arrayBuffer();
      console.log(JSON.stringify({ event: 'application-draining-guard-qualified', exactOriginalPersianMessage: true,
        businessStatus: 503, readinessStatus: 503, healthStatus: 200 }));
    }
    if (boundary) await boundary.stopAndDrain(5000);
    if (application) {
      await application.realtimeDelivery.stop(5000);
      await new Promise<void>((resolve, reject) => application!.io.close(error => error ? reject(error) : resolve()));
      assert.equal(application.server.listening, false);
    }
    if (disconnect) await disconnect();
    console.log(JSON.stringify({ event: 'application-closed', runtimeId: input.scope.runtimeId, namespace }));
    console.log('APPLICATION_NATIVE_WORK_CLOSED');
  }
}
void main().catch(error => { console.error(error?.message || 'APPLICATION_NATIVE_FAILED'); process.exitCode = 1; });
