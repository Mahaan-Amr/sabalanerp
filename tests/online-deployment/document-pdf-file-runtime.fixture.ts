import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import { runtimeHttpRequests } from '../../backend/src/services/httpRequestLifecycle';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { configurePrivateVersionedDocumentPdfs, DOCUMENT_PDF_RETAINED_ROOTS, DOCUMENT_PDF_EPHEMERAL_ROOTS, publishDocumentPdfFile, removeTemporaryDocumentPdf } from '../../backend/src/services/documentPdfFileRuntime';
import { ACCOUNTING_OFFICIAL_REPORT_ROOT, configurePrivateVersionedAccountingFiles, versionedAccountingReportFiles } from '../../backend/src/services/accountingFileRuntime';
import { downloadAndRemoveDocumentPdf, type PdfDownloadCompletion } from '../../backend/src/services/documentPdfDownload';
import { generatePdfBufferFromHtml, generatePdfFromHtml } from '../../backend/src/utils/pdf';
import { initializeRecoveryRuntime, RECOVERY_COORDINATION_DIR } from '../../backend/src/services/recoveryRuntime';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); // Observe a failed HTTP branch before the client receives headers; the owning await still rejects.
  return { promise, resolve, reject };
};

async function temporaryCollision(boundary: RuntimeWorkBoundary, mode: string) {
  const published = deferred<string>(), release = deferred<void>(), cleaned = deferred<boolean>();
  const root = DOCUMENT_PDF_EPHEMERAL_ROOTS.find(value => value.endsWith('/reports'))!;
  const options = { outputDir: root, fileName: 'same-timestamp-report' };
  const app = express(); app.use(boundary.middleware);
  app.get('/held-finish', async (request, response, next) => {
    try {
      const file = await generatePdfFromHtml({ ...options, htmlContent: '<h1>First report A</h1>' });
      const completion = runtimeHttpRequests.reserveWrite(request);
      response.once('finish', () => completion.run(async () => {
        published.resolve(file); await release.promise; return removeTemporaryDocumentPdf(file);
      }).then(cleaned.resolve, cleaned.reject));
      response.end('A callback is held');
      await cleaned.promise;
    } catch (error) { published.reject(error); cleaned.reject(error); next(error); }
  });
  boundary.requests.install(app);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/held-finish`); await response.arrayBuffer();
    const aFile = await published.promise;
    let bFile: string, bBytes: Buffer;
    try {
      bFile = await boundary.runBackground(() => generatePdfFromHtml({ ...options, htmlContent: '<h1>Later report B must survive</h1>' }));
      bBytes = fs.readFileSync(bFile);
    } finally { release.resolve(); }
    assert.equal(await cleaned.promise, true);
    const bExistsAfterA = fs.existsSync(bFile);
    console.log(JSON.stringify({ ephemeralCollision: true, mode, aFile, bFile, bExistsAfterA }));
    assert.equal(bExistsAfterA, true, 'HELD_A_CALLBACK_DELETED_LATER_PDF');
    assert.deepEqual(fs.readFileSync(bFile), bBytes);
    assert.notEqual(aFile, bFile);
    const unminted = path.join(root, 'unminted.' + 'f'.repeat(32) + '.pdf');
    fs.writeFileSync(unminted, 'HELD UNMINTED PRIVATE FILE', { flag: 'wx', mode: 0o600 });
    await assert.rejects(boundary.runBackground(() => removeTemporaryDocumentPdf(unminted)), /TEMPORARY_GENERATION_UNPROVEN/);
    assert.equal(fs.readFileSync(unminted, 'utf8'), 'HELD UNMINTED PRIVATE FILE');
    await boundary.runBackground(() => removeTemporaryDocumentPdf(bFile));
    await boundary.requests.waitForDrain(5000);
    console.log(JSON.stringify({ documentPdfRuntimePassed: true, mode, laterGenerationSurvivedHeldCallback: true,
      nativeGuardianQualified: false, productionAdmission: false }));
  } finally {
    release.resolve();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

/** Run each mode in its OWN fresh private cwd in the existing candidate
 * container. This is real Chromium/Express/Linux file-lock QA, not native
 * guardian, production admission, coherent recovery or browser qualification. */
async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.umask(), 0o077);
  const mode = process.argv[2]; assert.ok(['document-first', 'parent-first', 'child-observed-first', 'ephemeral-collision', 'ephemeral-collision-unbound'].includes(mode));
  const cwd = process.env.DOCUMENT_PDF_FIXTURE_ROOT!;
  assert.ok(cwd && cwd === process.cwd() && fs.realpathSync(cwd) === cwd);
  assert.match(cwd, /^\/app\/online-runtime-acceptance\/document-pdf-[a-f0-9]{32}$/);
  assert.equal(fs.statSync(cwd).mode & 0o077, 0);
  assert.equal(RECOVERY_COORDINATION_DIR, path.join(cwd, 'recovery-coordination'));
  assert.equal(fs.existsSync(RECOVERY_COORDINATION_DIR), false);
  initializeRecoveryRuntime(); // Fresh private authority, never the canonical/shared coordination directory.
  const runtimeId = randomBytes(32).toString('hex'), gate = path.join(cwd, 'deployment-write-admission.lock');
  fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(gate, { bigint: true });
  const identity = { device: String(value.dev), inode: String(value.ino), ownerUid: Number(value.uid) };
  const journalRoot = path.join(cwd, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {});
  const boundary = new RuntimeWorkBoundary(tasks, runtimeHttpRequests, () => {});
  const roots: Array<{ root: string; publication: VersionedFilePublication }> = [];
  for (const root of [...DOCUMENT_PDF_RETAINED_ROOTS, ...DOCUMENT_PDF_EPHEMERAL_ROOTS, ACCOUNTING_OFFICIAL_REPORT_ROOT]) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  for (const [index, root] of DOCUMENT_PDF_RETAINED_ROOTS.entries()) {
    const store = path.join(cwd, 'versions-' + index); fs.mkdirSync(store, { mode: 0o700 });
    roots.push({ root, publication: await VersionedFilePublication.open(store, root, boundary.context) });
  }
  const accountingParent = roots.find(source => source.root === path.dirname(ACCOUNTING_OFFICIAL_REPORT_ROOT))!;
  const probeEx = () => spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, '/usr/bin/true'], { encoding: 'utf8' }).status;
  const clients = new Set<http.ClientRequest>();
  let server: ReturnType<express.Application['listen']> | undefined;
  try {
    if (mode === 'ephemeral-collision-unbound') { await temporaryCollision(boundary, mode); return; }
    await assert.rejects(configurePrivateVersionedDocumentPdfs({ boundary, roots: roots.slice(0, 1) }), /ROOT_SET_INCOMPLETE/);
    if (mode === 'child-observed-first') {
      const childStore = path.join(cwd, 'child-versions'); fs.mkdirSync(childStore, { mode: 0o700 });
      const child = await VersionedFilePublication.open(childStore, ACCOUNTING_OFFICIAL_REPORT_ROOT, boundary.context);
      await configurePrivateVersionedAccountingFiles({ boundary, publication: child });
      assert.ok(versionedAccountingReportFiles());
      await assert.rejects(configurePrivateVersionedDocumentPdfs({ boundary, roots }), /PARENT_OWNER_CONFLICT/);
      let rendered = false;
      await assert.rejects(publishDocumentPdfFile(path.join(DOCUMENT_PDF_RETAINED_ROOTS[0], 'refused.pdf'), async () => {
        rendered = true; return Buffer.from('MUST NOT RENDER');
      }), /DOCUMENT_PDF_RUNTIME_NOT_READY/);
      assert.equal(rendered, false); return;
    }
    if (mode === 'parent-first') {
      await configurePrivateVersionedAccountingFiles({ boundary, publication: accountingParent.publication });
      assert.ok(versionedAccountingReportFiles());
    }
    await configurePrivateVersionedDocumentPdfs({ boundary, roots });
    if (mode === 'ephemeral-collision') { await temporaryCollision(boundary, mode); return; }
    await assert.rejects(configurePrivateVersionedDocumentPdfs({ boundary, roots }), /ALREADY_BOUND/);
    const conflictingChildStore = path.join(cwd, 'later-child-versions'); fs.mkdirSync(conflictingChildStore, { mode: 0o700 });
    const conflictingChild = await VersionedFilePublication.open(conflictingChildStore, ACCOUNTING_OFFICIAL_REPORT_ROOT, boundary.context);
    await assert.rejects(configurePrivateVersionedAccountingFiles({ boundary, publication: conflictingChild }), /ALREADY_BOUND/);
    const official = versionedAccountingReportFiles()!;
    await official.publish('same-owner/official.pdf', Buffer.from('OFFICIAL CHILD SAME PUBLISHER'));
    const parentScope = await accountingParent.publication.bindRoot(accountingParent.root);
    assert.equal((await parentScope.read('.official-reports/same-owner/official.pdf'))!.toString(), 'OFFICIAL CHILD SAME PUBLISHER');
    let rendered = false;
    await assert.rejects(publishDocumentPdfFile(path.join(cwd, 'unknown', 'refused.pdf'), async () => {
      rendered = true; return Buffer.from('MUST NOT RENDER');
    }), /OUTPUT_ROOT_UNCLASSIFIED/); assert.equal(rendered, false);

    const retained = roots.find(source => source.root.endsWith('/contracts'))!;
    await assert.rejects(publishDocumentPdfFile(path.join(retained.root, 'outside-source.pdf'), async () => {
      rendered = true;
      return generatePdfBufferFromHtml({ htmlContent: '<h1>MUST NOT START CHROMIUM</h1>' });
    }), /RUNTIME_WORK_CONTEXT_NOT_ACTIVE/);
    assert.equal(rendered, false); assert.equal(fs.existsSync(path.join(retained.root, 'outside-source.pdf')), false);
    await assert.rejects(generatePdfFromHtml({ htmlContent: '<h1>MUST NOT START CHROMIUM</h1>',
      fileName: 'outside-renderer-source', outputDir: retained.root }), /RUNTIME_WORK_CONTEXT_NOT_ACTIVE/);
    assert.equal(fs.existsSync(path.join(retained.root, 'outside-renderer-source.pdf')), false);
    const generated = await boundary.runBackground(() => generatePdfFromHtml({
      htmlContent: '<h1>Real retained PDF</h1>', fileName: 'retained', outputDir: retained.root }));
    assert.equal(fs.readFileSync(generated).subarray(0, 5).toString(), '%PDF-');
    const retainedFiles = await retained.publication.bindRoot(retained.root), first = await retainedFiles.inspect('retained.pdf');
    assert.equal(first?.operation, 'PUT');
    assert.deepEqual(await retainedFiles.readVersion('retained.pdf', first!.versionSha256), fs.readFileSync(generated));

    const entered = deferred<void>(), release = deferred<void>();
    let downloaded = deferred<PdfDownloadCompletion>();
    const requestedTemporary = path.join(DOCUMENT_PDF_EPHEMERAL_ROOTS.find(root => root.endsWith('/reports'))!, 'download.pdf');
    let temporary = requestedTemporary;
    const app = express(); app.use(boundary.middleware);
    app.get('/held-render', async (_request, response, next) => {
      try {
        await publishDocumentPdfFile(path.join(retained.root, 'held.pdf'), async () => {
          const bytes = await generatePdfBufferFromHtml({ htmlContent: '<h1>Actual held renderer</h1>' });
          entered.resolve(); await release.promise; return bytes;
        }); response.status(201).end();
      } catch (error) { next(error); }
    });
    app.get('/download', async (request, response, next) => {
      try { downloaded.resolve(await downloadAndRemoveDocumentPdf(request, response, temporary, 'report.pdf')); }
      catch (error) { downloaded.reject(error); next(error); }
    });
    boundary.requests.install(app);
    server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    const request = fetch(base + '/held-render'); await entered.promise;
    try { assert.equal(probeEx(), 1, 'The actual renderer still owns SH before file publication'); }
    finally { release.resolve(); }
    assert.equal((await request).status, 201); await boundary.requests.waitForDrain(5000); assert.equal(probeEx(), 0);

    // Padding makes backpressure observable, without depending on PDF page/font
    // complexity. The retained artifact above is actual Chromium output.
    const realPdf = fs.readFileSync(generated);
    temporary = await boundary.runBackground(() => publishDocumentPdfFile(requestedTemporary, async () => Buffer.concat([realPdf, Buffer.alloc(32 * 1024 * 1024)])));
    const receiving = deferred<http.IncomingMessage>();
    const client = http.get(base + '/download', response => { response.pause(); receiving.resolve(response); });
    clients.add(client); client.once('close', () => clients.delete(client));
    client.on('error', () => {});
    const response = await receiving.promise;
    assert.equal(probeEx(), 1, 'Paused HTTP delivery retains callback cleanup ownership');
    response.destroy(); client.destroy();
    const completion = await downloaded.promise;
    assert.equal(completion.removed, true); assert.equal(completion.cleanupComplete, true); assert.equal(fs.existsSync(temporary), false);
    await boundary.requests.waitForDrain(5000); assert.equal(probeEx(), 0);

    // Deliberate external-root fault: after headers, cleanup must report the
    // retained temporary copy without writing a second response or adopting a
    // new directory incarnation. Keep both fault directories for inspection.
    temporary = await boundary.runBackground(() => publishDocumentPdfFile(requestedTemporary, async () => Buffer.concat([realPdf, Buffer.alloc(32 * 1024 * 1024)])));
    downloaded = deferred<PdfDownloadCompletion>();
    const faultReceiving = deferred<http.IncomingMessage>();
    const faultClient = http.get(base + '/download', value => { value.pause(); faultReceiving.resolve(value); });
    clients.add(faultClient); faultClient.once('close', () => clients.delete(faultClient));
    faultClient.on('error', () => {});
    const faultResponse = await faultReceiving.promise;
    assert.equal(probeEx(), 1);
    const originalRoot = path.dirname(temporary), heldRoot = originalRoot + '-external-fault-held';
    fs.renameSync(originalRoot, heldRoot); fs.mkdirSync(originalRoot, { mode: 0o700 });
    faultResponse.destroy(); faultClient.destroy();
    const failedCleanup = await downloaded.promise;
    assert.equal(failedCleanup.removed, false); assert.equal(failedCleanup.cleanupComplete, false); assert.ok(failedCleanup.cleanupError);
    assert.equal(fs.existsSync(path.join(heldRoot, path.basename(temporary))), true);
    assert.equal(fs.existsSync(temporary), false);
    await boundary.requests.waitForDrain(5000); assert.equal(probeEx(), 0);
    console.log(JSON.stringify({ documentPdfRuntimePassed: true, mode, realChromium: true,
      actualHttpDisconnect: true, postHeadersCleanupFailureRetained: true,
      nativeGuardianQualified: false, productionAdmission: false }));
  } finally {
    for (const client of clients) client.destroy();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await boundary.stopAndDrain(5000);
    console.log(JSON.stringify({ pdfFixtureNativeWorkClosed: true, mode }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
