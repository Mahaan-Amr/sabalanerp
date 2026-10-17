import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test'), ts = require('typescript');
const source = fs.readFileSync(new URL('../../frontend/src/lib/browserDraftArchive.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const script = `window.draftArchive = {}; (function(exports){${compiled}\n})(window.draftArchive);`;

test('native IndexedDB preserves original draft bytes across refresh, denies another owner and detects corruption', { timeout: 90000 }, async () => {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  const rows = output.trim().split(/\r?\n/).filter(Boolean).flatMap(line => JSON.parse(line));
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.route('http://localhost:3101/__draft_archive_qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Private archive fixture</title>' }));
    await page.addInitScript(script);
    await page.goto('http://localhost:3101/__draft_archive_qa');
    const snapshot = { userId: 'draft_owner_a', buildId: 'erp_retained_20261017', workflow: 'sales-contract',
      draftId: 'contract-private-qa', schemaVersion: 2, baseRevision: 7,
      payloadJson: '{"amount":"125000.25","quantity":"3.50","notes":"نوشتهٔ ثبت‌نشده"}' };
    const saved = await page.evaluate(async input => window.draftArchive.archiveBrowserDraft(input, () => {}), snapshot);
    assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    await page.reload();
    const values = await page.evaluate(async () => window.draftArchive.readBrowserDraftArchives('draft_owner_a', 'sales-contract', 'contract-private-qa', () => {}));
    assert.equal(values.length, 1); assert.deepEqual(values[0], saved); assert.equal(values[0].payloadJson, snapshot.payloadJson);
    assert.deepEqual(await page.evaluate(async () => window.draftArchive.readBrowserDraftArchives('draft_owner_b', 'sales-contract', 'contract-private-qa', () => {})), []);
    const denied = await page.evaluate(async input => {
      try { await window.draftArchive.archiveBrowserDraft(input, () => { throw Error('OWNER_LOST'); }); return false; }
      catch (error) { return error.message === 'OWNER_LOST'; }
    }, snapshot);
    assert.equal(denied, true);
    const concurrent = await page.evaluate(async input => Promise.all([
      window.draftArchive.archiveBrowserDraft({ ...input, payloadJson: '{"amount":"1.01"}' }, () => {}),
      window.draftArchive.archiveBrowserDraft({ ...input, payloadJson: '{"quantity":"0.001"}' }, () => {}),
    ]), snapshot);
    assert.notEqual(concurrent[0].id, concurrent[1].id);
    await page.evaluate(() => { Date.now = () => 2100000000000; });
    const retained = await page.evaluate(async () => window.draftArchive.readBrowserDraftArchives('draft_owner_a', 'sales-contract', 'contract-private-qa', () => {}));
    assert.equal(retained.length, 3, 'support expiry must not delete a saved original-version draft');
    assert.ok(retained.some(value => value.payloadJson === snapshot.payloadJson));
    const corrupted = await page.evaluate(async id => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('sabalan-browser-draft-archive', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite');
        transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
        const request = transaction.objectStore('snapshots').get(id);
        request.onsuccess = () => transaction.objectStore('snapshots').put({ ...request.result, payloadJson: '{"amount":"0"}' });
      }); database.close();
      try { await window.draftArchive.readBrowserDraftArchives('draft_owner_a', 'sales-contract', 'contract-private-qa', () => {}); return false; }
      catch (error) { return error.message === 'BROWSER_DRAFT_ARCHIVE_UNVERIFIED'; }
    }, saved.id);
    assert.equal(corrupted, true);
  } finally { await browser.close(); }
});
