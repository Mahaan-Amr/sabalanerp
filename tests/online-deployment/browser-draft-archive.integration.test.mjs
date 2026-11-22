import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
    const legacy = { ...snapshot, workflow: 'legacy-contract', draftId: 'legacy-draft',
      format: 'sabalan-browser-draft/v1', id: '00000000-0000-4000-8000-000000000001',
      capturedAt: '2026-10-16T00:00:00.000Z', sha256: '' };
    legacy.sha256 = createHash('sha256').update(JSON.stringify([legacy.format, legacy.id, legacy.capturedAt,
      legacy.userId, legacy.buildId, legacy.workflow, legacy.draftId, legacy.schemaVersion, legacy.baseRevision, legacy.payloadJson])).digest('hex');
    // Seed precisely the previous v1 layout before the new module opens it.
    // Keep this old connection open during the new writer's transaction.
    await page.evaluate(async value => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('sabalan-browser-draft-archive', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' })
          .createIndex('ownerDraft', ['userId', 'workflow', 'draftId']);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite', { durability: 'strict' });
        transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
        transaction.objectStore('snapshots').add(value);
      }); window.legacyDraftDatabase = database;
    }, legacy);
    const saved = await page.evaluate(async input => window.draftArchive.archiveBrowserDraft(input, () => {}), snapshot);
    assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    const compatible = await page.evaluate(async value => {
      const old = window.legacyDraftDatabase;
      const original = await window.draftArchive.readBrowserDraftArchive(value.userId, value.id, () => {});
      const rows = await new Promise((resolve, reject) => {
        const transaction = old.transaction('snapshots', 'readonly');
        const request = transaction.objectStore('snapshots').index('ownerDraft').getAll(IDBKeyRange.only([value.userId, value.workflow, value.draftId]));
        transaction.oncomplete = () => resolve(request.result); transaction.onabort = () => reject(transaction.error);
      });
      const version = old.version; old.close();
      return { original, rows, version };
    }, legacy);
    assert.equal(compatible.version, 1); assert.deepEqual(compatible.original, legacy); assert.deepEqual(compatible.rows, [legacy]);
    await page.reload();
    const values = await page.evaluate(async () => window.draftArchive.readBrowserDraftArchives('draft_owner_a', 'sales-contract', 'contract-private-qa', () => {}));
    assert.equal(values.archives.length, 1); assert.deepEqual(values.archives[0], saved); assert.equal(values.archives[0].payloadJson, snapshot.payloadJson);
    assert.deepEqual(await page.evaluate(async () => window.draftArchive.readBrowserDraftArchives('draft_owner_b', 'sales-contract', 'contract-private-qa', () => {})), { archives: [], next: null });
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
    assert.equal(retained.archives.length, 3, 'support expiry must not delete a saved original-version draft');
    assert.ok(retained.archives.some(value => value.payloadJson === snapshot.payloadJson));
    const boundary = await page.evaluate(async input => {
      let newest;
      for (let batch = 0; batch < 17; batch++) {
        const added = await Promise.all(Array.from({ length: 16 }, (_, index) =>
          window.draftArchive.archiveBrowserDraft({ ...input, payloadJson: JSON.stringify({ batch, index }) }, () => {})));
        newest = added[added.length - 1];
      }
      let cursor, count = 0, pages = 0;
      do {
        const result = await window.draftArchive.readBrowserDraftArchives(input.userId, input.workflow, input.draftId, () => {}, cursor);
        if (result.archives.length > 8) throw Error('UNBOUNDED_PAGE');
        count += result.archives.length; pages++; cursor = result.next;
      } while (cursor);
      const restored = await window.draftArchive.readBrowserDraftArchive(input.userId, newest.id, () => {});
      return { count, pages, newest: restored.payloadJson };
    }, snapshot);
    assert.equal(boundary.count, 275); assert.ok(boundary.pages > 32);
    assert.equal(boundary.newest, '{"batch":16,"index":15}');
    const corrupted = await page.evaluate(async id => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('sabalan-browser-draft-archive', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite');
        transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
        const request = transaction.objectStore('snapshots').get(id);
        request.onsuccess = () => transaction.objectStore('snapshots').put({ ...request.result, payloadJson: '{"amount":"0"}' });
      }); database.close();
      try { await window.draftArchive.readBrowserDraftArchive('draft_owner_a', id, () => {}); return false; }
      catch (error) { return error.message === 'BROWSER_DRAFT_ARCHIVE_UNVERIFIED'; }
    }, saved.id);
    assert.equal(corrupted, true);
  } finally { await browser.close(); }
});
