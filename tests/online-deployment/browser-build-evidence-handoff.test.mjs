import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints:[new URL('../../frontend/src/lib/browserBuildHandoff.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')], bundle:true,write:false,platform:'node',format:'cjs' }).outputFiles[0].text;
const module = {exports:{}}; new Function('module','exports','require',bundle)(module,module.exports,require);
const {BrowserBuildHandoff}=module.exports;
const lease={userId:'owner_a',sessionId:'session_a',generation:1};
test('binary evidence is independently verified before any draft manifest is committed',async()=>{
  const calls=[]; let release;const pending=new Promise(resolve=>{release=resolve;});
  const handoff=new BrowserBuildHandoff('erp_evidence_handoff_20261019',async value=>{calls.push('manifest');return {...value,id:'saved',sha256:'a'.repeat(64)};});
  handoff.register({userId:'owner_a',workflow:'support-ticket',draftId:'draft_a',schemaVersion:1,baseRevision:0,
    capturePayloadJson:()=>'{"text":"نوشته","attachment":"original"}',
    verifyArchiveEvidence:async(payload,assertCurrent)=>{calls.push('evidence');assert.equal(JSON.parse(payload).attachment,'original');await pending;assertCurrent();calls.push('readback');}});
  const result=handoff.preserve(lease,()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['evidence']);
  release();assert.equal((await result).status,'PRESERVED');assert.deepEqual(calls,['evidence','readback','manifest']);
});
test('missing binary evidence blocks handoff without publishing a text manifest',async()=>{
  let manifests=0;
  const handoff=new BrowserBuildHandoff('erp_evidence_handoff_20261019',async()=>{manifests++;throw Error('UNEXPECTED_WRITE');});
  handoff.register({userId:'owner_a',workflow:'support-ticket',draftId:'draft_a',schemaVersion:1,baseRevision:0,
    capturePayloadJson:()=>'{"attachment":"missing"}',verifyArchiveEvidence:async()=>{throw Error('MISSING_BYTES');}});
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');assert.equal(manifests,0);
});
test('an edit while binary evidence is being verified prevents publishing its stale manifest',async()=>{
  let text='original',manifests=0;
  const handoff=new BrowserBuildHandoff('erp_evidence_handoff_20261019',async value=>{manifests++;return {...value,id:'saved',sha256:'a'.repeat(64)};});
  handoff.register({userId:'owner_a',workflow:'support-ticket',draftId:'draft_a',schemaVersion:1,baseRevision:0,
    capturePayloadJson:()=>JSON.stringify({text}),verifyArchiveEvidence:async()=>{text='changed';}});
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');assert.equal(manifests,0);
});
