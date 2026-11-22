import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test'), ts = require('typescript');
test('attachment bytes survive refresh and remain bound to their original user, session, tab and draft', { timeout: 90000 }, async () => {
  const source = fs.readFileSync(new URL('../../frontend/src/lib/browserEvidenceArchive.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  const rows = output.trim().split(/\r?\n/).filter(Boolean).flatMap(line => JSON.parse(line));
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.route('http://localhost:3101/__evidence_archive_qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Attachment recovery QA</title>' }));
    await page.addInitScript(`window.evidenceArchive={};(function(exports){${compiled}\n})(window.evidenceArchive);`);
    await page.goto('http://localhost:3101/__evidence_archive_qa');
    const scope = { userId: 'owner_a', sessionId: 'session_a', tabId: 'tab_a', draftId: 'support_a' };
    const saved = await page.evaluate(async scope => {
      const bytes = new Uint8Array(17 * 1024 * 1024 + 3); bytes.set([37, 80, 68, 70]); bytes[bytes.length - 1] = 255;
      return window.evidenceArchive.archiveBrowserEvidence(scope, new File([bytes], 'گزارش.pdf', { type: 'application/pdf', lastModified: 1234 }), () => {});
    }, scope);
    await page.reload();
    const restored = await page.evaluate(async ({scope,saved}) => {
      const result = await window.evidenceArchive.readBrowserEvidence(scope, saved, () => {});
      const bytes = new Uint8Array(await result.arrayBuffer());
      return { name:result.name, type:result.type, size:result.size, lastModified:result.lastModified, first:Array.from(bytes.slice(0,4)), last:bytes[bytes.length-1] };
    }, { scope, saved });
    assert.deepEqual(restored, { name:'گزارش.pdf', type:'application/pdf', size:17*1024*1024+3, lastModified:1234, first:[37,80,68,70], last:255 });
    const lostOwner = await page.evaluate(async ({scope,saved}) => {
      let checks=0;
      try { await window.evidenceArchive.readBrowserEvidence(scope,saved,()=>{if(++checks===4)throw Error('OWNER_LOST_DURING_READBACK');}); return {denied:false,checks}; }
      catch(error) {return {denied:error.message==='OWNER_LOST_DURING_READBACK',checks};}
    }, {scope,saved});
    assert.deepEqual(lostOwner,{denied:true,checks:4});
    const lostDuringWrite=await page.evaluate(async scope=>{
      let checks=0;
      try {await window.evidenceArchive.archiveBrowserEvidence(scope,new File(['original'],'original.txt',{type:'text/plain'}),()=>{if(++checks===2)throw Error('OWNER_LOST_DURING_HASH');});return false;}
      catch(error){return error.message==='OWNER_LOST_DURING_HASH';}
    },scope);assert.equal(lostDuringWrite,true);
    for (const key of ['userId','sessionId','tabId','draftId']) {
      assert.equal(await page.evaluate(async ({scope,saved,key}) => {
        try { await window.evidenceArchive.readBrowserEvidence({...scope,[key]:'other'},saved,()=>{}); return false; } catch { return true; }
      }, {scope,saved,key}), true, key);
    }
    assert.equal(await page.evaluate(async ({scope,saved}) => {
      try { await window.evidenceArchive.readBrowserEvidence(scope,{...saved,sha256:'0'.repeat(64)},()=>{}); return false; } catch { return true; }
    }, {scope,saved}), true);
    assert.equal(await page.evaluate(async ({scope,saved}) => {
      const database = await new Promise((resolve,reject) => {const r=indexedDB.open('sabalan-browser-evidence-archive',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject) => {const t=database.transaction('evidence','readwrite');t.oncomplete=resolve;t.onabort=()=>reject(t.error);const r=t.objectStore('evidence').get(saved.id);r.onsuccess=()=>t.objectStore('evidence').put({...r.result,blob:new Blob(['damaged'])});}); database.close();
      try {await window.evidenceArchive.readBrowserEvidence(scope,saved,()=>{});return false;}catch{return true;}
    }, {scope,saved}),true);
  } finally { await browser.close(); }
});
