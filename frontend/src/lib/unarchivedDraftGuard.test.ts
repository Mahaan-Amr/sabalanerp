import assert from 'node:assert/strict';
import test from 'node:test';
import {BrowserBuildHandoff} from './browserBuildHandoff';
import {registerUnarchivedDraftGuard} from './unarchivedDraftGuard';

test('an unarchived sibling blocks before any archive, and original cleanup releases only its own denial',async()=>{
  let writes=0;const handoff=new BrowserBuildHandoff('erp_guard_test_20261020',async input=>{writes++;return {...input,format:'sabalan-browser-draft/v1',id:'test',capturedAt:'2026-10-20T00:00:00Z',sha256:'a'.repeat(64)};});
  const lease={userId:'owner',sessionId:'session',generation:1};
  handoff.register({userId:'owner',workflow:'registered-parent',draftId:'parent',schemaVersion:1,baseRevision:0,capturePayloadJson:()=>'{"text":"original"}'});
  const release=registerUnarchivedDraftGuard(handoff,'child-buffer','child');
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');assert.equal(writes,0);
  release();assert.equal((await handoff.preserve(lease,()=>{})).status,'PRESERVED');assert.equal(writes,1);
});
test('even a coincident owner identity cannot turn the denial into preserved content',async()=>{
  let writes=0;const handoff=new BrowserBuildHandoff('erp_guard_test_20261020',async()=>{writes++;throw Error('unreachable');});
  registerUnarchivedDraftGuard(handoff,'unarchived-editor','editor');
  assert.equal((await handoff.preserve({userId:'unarchived_local_model',sessionId:'session',generation:1},()=>{})).status,'BLOCKED');
  assert.equal(writes,0);
});

test('a pre-registered live validity guard blocks the same event before a render and releases only when valid',async()=>{
  let writes=0;let badInput=false;
  const handoff=new BrowserBuildHandoff('erp_guard_test_20261020',async input=>{writes++;return {...input,format:'sabalan-browser-draft/v1',id:'test',capturedAt:'2026-10-20T00:00:00Z',sha256:'a'.repeat(64)};});
  const lease={userId:'owner',sessionId:'session',generation:1};
  handoff.register({userId:'owner',workflow:'registered-parent',draftId:'parent',schemaVersion:1,baseRevision:0,capturePayloadJson:()=>' {"number":""}'});
  registerUnarchivedDraftGuard(handoff,'native-number-buffer','leaf',()=>badInput);
  badInput=true;
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');assert.equal(writes,0);
  badInput=false;
  assert.equal((await handoff.preserve(lease,()=>{})).status,'PRESERVED');assert.equal(writes,1);
});

test('new invalid native input during archive cannot be certified, and an unreadable guard fails closed',async()=>{
  let badInput=false;
  const handoff=new BrowserBuildHandoff('erp_guard_test_20261020',async input=>{badInput=true;return {...input,format:'sabalan-browser-draft/v1',id:'test',capturedAt:'2026-10-20T00:00:00Z',sha256:'a'.repeat(64)};});
  const lease={userId:'owner',sessionId:'session',generation:1};
  handoff.register({userId:'owner',workflow:'registered-parent',draftId:'parent',schemaVersion:1,baseRevision:0,capturePayloadJson:()=>'{}'});
  const release=registerUnarchivedDraftGuard(handoff,'native-number-buffer','leaf',()=>badInput);
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');
  release();handoff.registerBlocker(()=>{throw Error('unreadable');});
  assert.equal((await handoff.preserve(lease,()=>{})).status,'BLOCKED');
});
