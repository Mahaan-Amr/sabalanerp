import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const qualifiedNames = ['frontend/src/lib/browserBuildHandoff.ts', 'frontend/src/lib/browserDraftArchive.ts',
  'frontend/src/lib/browserSessionContinuation.ts', 'frontend/src/lib/api.ts',
  'frontend/src/features/contract-creation/hooks/useContractEditRecovery.ts',
  'frontend/src/features/contract-creation/CreateContractWizardClient.tsx',
  'frontend/src/features/contract-creation/utils/contractDraftStorage.ts',
  'tests/online-deployment/browser-build-handoff.integration.test.mjs'];
const sha = name => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const sources = Object.fromEntries(qualifiedNames.map(name => [name, sha(name)]));
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test'), { buildSync } = require('esbuild');
const bundle = buildSync({ absWorkingDir: path.join(root, 'frontend'), bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"',
    'process.env.NEXT_PUBLIC_BROWSER_BUILD_ID': '"erp_handoff_browser_20261019"' },
  stdin: { resolveDir: path.join(root, 'frontend'), loader: 'tsx', contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{useContractEditRecovery}from'./src/features/contract-creation/hooks/useContractEditRecovery';
    import{createContractAutosaveDraft}from'./src/features/contract-creation/utils/contractDraftStorage';
    import{browserBuildHandoff}from'./src/lib/browserBuildHandoff';
    import{readBrowserDraftArchives,readBrowserDraftArchive}from'./src/lib/browserDraftArchive';
    import api,{browserSessionContinuation}from'./src/lib/api';
    let update;
    window.handoffApi={api,browserSessionContinuation,browserBuildHandoff,readBrowserDraftArchives,readBrowserDraftArchive,
      mount:()=>{const node=document.createElement('div');document.body.appendChild(node);const root=createRoot(node);
        function Editor(){const[value,setValue]=useState('initial');update=setValue;
          useContractEditRecovery({scope:{userId:'owner_a',draftId:'contract-browser-qa',schemaVersion:2,baseRevision:3},
            enabled:false,onRestore:()=>{},captureDraft:capturedAt=>createContractAutosaveDraft({currentStep:2,
              wizardData:{amount:value,note:'unsaved original'}},capturedAt)});return null;}
        flushSync(()=>root.render(<Editor/>));return()=>flushSync(()=>root.unmount());},
      update:value=>flushSync(()=>update(value))};
  ` } }).outputFiles[0].text;

test('real Contract recovery registration archives latest committed draft on API expiry before refresh', { timeout: 90000 }, async () => {
  const raw = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  const rows = raw.trim().split(/\r?\n/).filter(Boolean).flatMap(line => JSON.parse(line));
  for (const service of ['backend','frontend','postgres','inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext(), page = await context.newPage();
    await page.route('http://localhost:3101/__build_handoff_qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Private local handoff QA</title>' }));
    // Requests from the actual api/session-probe instances use genuine browser
    // HTTP adapters against these deterministic identity/expiry endpoints.
    let expired = false, business = 0, probes = 0;
    await page.route('http://localhost:3101/api/auth/me', route => {
      probes++;
      return route.fulfill({ status: expired ? 409 : 200, contentType: 'application/json',
        body: JSON.stringify(expired ? { error: 'API_BUILD_REFRESH_REQUIRED' }
          : { data: { id: 'owner_a' }, session: { id: 'session_a' } }) });
    });
    await page.route('http://localhost:3101/api/qa-preserve', route => { business++; return route.fulfill({ status: 500, body: 'MUST NOT REACH BUSINESS' }); });
    await page.goto('http://localhost:3101/__build_handoff_qa'); await page.addScriptTag({ content: bundle });
    await page.evaluate(async () => { window.stopHandoffEditor = window.handoffApi.mount(); await window.handoffApi.browserSessionContinuation.acquire(); });
    expired = true;
    const result = await page.evaluate(async () => {
      const owner = window.handoffApi; owner.update('latest-same-turn-333');
      let failure;
      try { await owner.api.post('/qa-preserve', { amount: 'not-replayed' }); } catch (error) { failure = error; }
      const saved = await owner.readBrowserDraftArchives('owner_a', 'sales-contract', 'contract-browser-qa', () => {});
      return { status: failure.response.status, code: failure.response.data.code, handoff: failure.browserBuildHandoff,
        snapshots: saved.archives.map(value => ({ id:value.id, payload:JSON.parse(value.payloadJson), buildId:value.buildId })) };
    });
    assert.equal(result.status, 409); assert.equal(result.code, 'API_BUILD_REFRESH_REQUIRED');
    assert.equal(result.handoff.status, 'PRESERVED'); assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0].payload.wizardData.amount, 'latest-same-turn-333');
    assert.equal(result.snapshots[0].buildId, 'erp_handoff_browser_20261019');
    assert.equal(business, 0); assert.equal(probes, 2, 'expiry must not trigger another session probe');
    assert.equal(page.url(), 'http://localhost:3101/__build_handoff_qa');
    const unregistered = await page.evaluate(async () => {
      window.stopHandoffEditor();
      try { await window.handoffApi.api.post('/qa-preserve', {}); } catch (error) { return error.browserBuildHandoff; }
    });
    assert.equal(unregistered.status, 'BLOCKED'); assert.equal(unregistered.code, 'BROWSER_BUILD_HANDOFF_UNREGISTERED');
    assert.equal(unregistered.archives.length, 0); assert.equal(business, 0); assert.equal(probes, 3);
    await page.reload(); await page.addScriptTag({ content: bundle });
    expired = false;
    const after = await page.evaluate(async id => {
      const scope = window.handoffApi.browserSessionContinuation, lease = await scope.acquire();
      const value = await window.handoffApi.readBrowserDraftArchive(lease.userId, id, () => scope.assertCurrent(lease));
      return JSON.parse(value.payloadJson);
    }, result.snapshots[0].id);
    assert.equal(after.wizardData.amount, 'latest-same-turn-333');
    await context.close();
  } finally { await browser.close(); }
  for (const [name, hash] of Object.entries(sources)) assert.equal(sha(name), hash, 'Qualified source changed: ' + name);
  console.log(JSON.stringify({ productionAdmission: false, sources, browserClosed: true }));
});
