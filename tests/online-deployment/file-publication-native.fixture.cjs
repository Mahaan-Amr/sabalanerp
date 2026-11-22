'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { publishDurableFile, publishDurableStream } = require('./services/durableFilePublication');
const { createFilesystemDispatchArtifactStorage } = require('./services/dispatchDocuments/filesystemStorage');

if (process.argv[2] === 'partial-writer') {
  const keepAlive = setInterval(() => {}, 1000);
  const source = Readable.from((async function* () {
    yield Buffer.alloc(1024 * 1024, 0x31);
    console.log(JSON.stringify({ ready: true, pid: process.pid }));
    await new Promise(() => {});
  })());
  publishDurableStream(process.argv[3], source, { replace: true }).then(() => {
    clearInterval(keepAlive); console.log('UNEXPECTED_PUBLICATION');
  }, () => { clearInterval(keepAlive); process.exitCode = 1; });
} else {
  (async () => {
    assert.equal(process.platform, 'linux');
    const root = __dirname;
    assert.match(root, /^\/app\/online-runtime-acceptance\/file-publication-[a-f0-9]{32}$/);
    assert.equal(fs.realpathSync(root), root);
    const directory = path.join(root, 'owned-data'); await fsp.mkdir(directory, { mode: 0o700 });
    const target = path.join(directory, 'artifact.pdf');
    await publishDurableFile(target, Buffer.from('approved original PDF'));
    const original = await fsp.stat(target, { bigint: true });
    const reader = await fsp.open(target, 'r');
    const child = spawn(process.execPath, [__filename, 'partial-writer', target], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { error += bytes; });
    const exited = once(child, 'exit');
    let stage;
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const names = await fsp.readdir(directory);
      const stagedName = names.find(name => /^\.sabalan-file-[a-f0-9-]{36}\.tmp$/.test(name));
      if (stagedName && output.includes('"ready":true')) {
        const value = await fsp.lstat(path.join(directory, stagedName), { bigint: true });
        if (value.isFile() && value.size === 1048576n) { stage = { name: stagedName, value }; break; }
      }
      if (child.exitCode !== null || child.signalCode !== null) throw Error('PARTIAL_WRITER_EXITED: ' + error);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(stage, 'actual partial private inode must exist before the native death test');
    assert.equal(await fsp.readFile(target, 'utf8'), 'approved original PDF');
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
    assert.equal(child.kill('SIGKILL'), true); // exact unreaped child, never a PID/name search.
    const [code, signal] = await exited;
    assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    const after = await fsp.stat(target, { bigint: true });
    assert.equal(after.dev, original.dev); assert.equal(after.ino, original.ino);
    assert.equal(await fsp.readFile(target, 'utf8'), 'approved original PDF');
    assert.equal(output.includes('UNEXPECTED_PUBLICATION'), false);
    await publishDurableFile(target, Buffer.from('complete replacement PDF'), { replace: true });
    assert.equal(await reader.readFile('utf8'), 'approved original PDF');
    await reader.close();
    assert.equal(await fsp.readFile(target, 'utf8'), 'complete replacement PDF');

    const storage = createFilesystemDispatchArtifactStorage(path.join(directory, 'dispatch'));
    await storage.stage({ storageKey: 'dispatch-documents/approved.pdf', bytes: Buffer.from('approved dispatch PDF') });
    await assert.rejects(storage.stage({ storageKey: 'dispatch-documents/approved.pdf', bytes: Buffer.from('wrong replacement') }),
      error => error.code === 'EEXIST');
    assert.equal(Buffer.from(await storage.read('dispatch-documents/approved.pdf')).toString(), 'approved dispatch PDF');
    await storage.discard('dispatch-documents/approved.pdf');
    await storage.discard('dispatch-documents/approved.pdf');
    assert.equal(await storage.read('dispatch-documents/approved.pdf'), null);

    const { generatePdfFromHtml } = require('./pdf-publication.bundle.cjs');
    // The diagnostic slot has a read-only root filesystem. Chromium's actual
    // crash/profile storage belongs to this private fixture, never /root or a
    // shared browser profile; production PDF code/arguments stay unchanged.
    process.env.XDG_CONFIG_HOME = path.join(directory, 'chromium-config');
    process.env.XDG_CACHE_HOME = path.join(directory, 'chromium-cache');
    const pdfDirectory = path.join(directory, 'pdf');
    const pdfOptions = { fileName: 'publication-probe', outputDir: pdfDirectory,
      htmlContent: '<!doctype html><html><body>SABALAN_PUBLICATION_OLD</body></html>' };
    const pdfPath = await generatePdfFromHtml(pdfOptions);
    const oldPdf = await fsp.readFile(pdfPath); assert.equal(oldPdf.subarray(0, 5).toString(), '%PDF-');
    const oldPdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
    assert.ok(oldPdfText.includes('SABALAN_PUBLICATION_OLD'));
    const pdfReader = await fsp.open(pdfPath, 'r');
    await generatePdfFromHtml({ ...pdfOptions, htmlContent: '<!doctype html><html><body>SABALAN_PUBLICATION_NEW</body></html>' });
    assert.deepEqual(await pdfReader.readFile(), oldPdf); await pdfReader.close();
    const newPdf = await fsp.readFile(pdfPath);
    assert.notDeepEqual(newPdf, oldPdf);
    assert.ok(execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }).includes('SABALAN_PUBLICATION_NEW'));
    assert.match(execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }), /Pages:\s+1\b/);
    const matchingDescriptors = [];
    for (const name of await fsp.readdir('/proc/self/fd')) {
      try { const value = await fsp.readlink('/proc/self/fd/' + name); if (value.startsWith(directory + '/')) matchingDescriptors.push(name); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.deepEqual(matchingDescriptors, []);
    const stagedPath = path.join(directory, stage.name), currentStage = await fsp.lstat(stagedPath, { bigint: true });
    assert.equal(currentStage.ino, stage.value.ino); assert.equal(currentStage.dev, stage.value.dev);
    assert.equal(currentStage.nlink, 1n);
    const stagedSha256 = createHash('sha256').update(await fsp.readFile(stagedPath)).digest('hex');
    const report = { format: 'sabalan-file-publication-native/v1', nativeChildSignal: signal,
      unpublishedStageBytes: Number(currentStage.size), unpublishedStageSha256: stagedSha256,
      priorTargetInodePreserved: true, priorReaderPreserved: true, noLeakedOwnedDescriptors: true,
      dispatchCreateCollisionPreserved: true, durableDiscardIdempotent: true,
      nativeChromiumPdfPages: 1, actualPdfReaderPreserved: true,
      oldPdfSha256: createHash('sha256').update(oldPdf).digest('hex'),
      newPdfSha256: createHash('sha256').update(newPdf).digest('hex') };
    // Diagnostic bytes only, no DB/file-version/incident references. Remove the
    // exact unpublished inode only after native death and target proofs above.
    await fsp.unlink(stagedPath);
    assert.equal(fs.realpathSync(directory), directory);
    await fsp.rm(directory, { recursive: true });
    report.ownedDiagnosticBytesRemoved = true;
    console.log(JSON.stringify(report));
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
