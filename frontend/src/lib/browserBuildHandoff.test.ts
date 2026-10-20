import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBuildHandoff } from './browserBuildHandoff';
import type { BrowserDraftArchive, BrowserDraftSnapshot } from './browserDraftArchive';

const lease = { userId: 'owner_a', sessionId: 'session_a', generation: 1 };
const registration = (draftId: string, capturePayloadJson: () => string) => ({ userId: 'owner_a', workflow: 'sales-contract',
  draftId, schemaVersion: 1, baseRevision: 3, capturePayloadJson });
const receipt = (input: BrowserDraftSnapshot): BrowserDraftArchive => ({ ...input, format: 'sabalan-browser-draft/v1',
  id: 'saved-' + input.draftId, sha256: 'a'.repeat(64), capturedAt: new Date().toISOString() });

test('expiry captures every registered draft synchronously before durable archival and never navigates or replays', async () => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let started!:()=>void;const archiveStarted=new Promise<void>(resolve=>{started=resolve;});
  const captured: string[] = [], written: BrowserDraftSnapshot[] = [];
  const handoff = new BrowserBuildHandoff('erp_handoff_20261019', async input => {
    assert.deepEqual(captured.slice(0, 2), ['first', 'second']); written.push(input);started(); await hold; return receipt(input);
  });
  handoff.register(registration('first', () => { captured.push('first'); return '{"amount":"123"}'; }));
  handoff.register(registration('second', () => { captured.push('second'); return '{"note":"unsaved"}'; }));
  const pending = handoff.preserve(lease, () => {});
  assert.deepEqual(captured,['first','second']);
  // Binary verification may legitimately await before starting the first
  // archive. Observe the original archive callback, not microtask scheduling.
  await Promise.race([archiveStarted,pending.then(()=>{throw Error('ARCHIVE_NEVER_STARTED');})]);
  assert.equal(written.length,1);release();
  const result = await pending; assert.equal(result.status, 'PRESERVED'); assert.equal(result.archives.length, 2);
  assert.equal(written[0].payloadJson, '{"amount":"123"}');
});

test('no registration, another owner, malformed payload or changed live draft cannot authorize refresh', async () => {
  let writes = 0;
  const handoff = new BrowserBuildHandoff('erp_handoff_20261019', async input => { writes++; return receipt(input); });
  assert.equal((await handoff.preserve(lease, () => {})).status, 'BLOCKED');
  const remove = handoff.register({ ...registration('foreign', () => '{}'), userId: 'owner_b' });
  assert.equal((await handoff.preserve(lease, () => {})).status, 'BLOCKED'); remove(); assert.equal(writes, 0);
  const invalid = handoff.register(registration('invalid', () => 'not JSON'));
  assert.equal((await handoff.preserve(lease, () => {})).status, 'BLOCKED'); invalid(); assert.equal(writes, 0);
  let value = 'before';
  const racing = new BrowserBuildHandoff('erp_handoff_20261019', async input => { value = 'after'; return receipt(input); });
  racing.register(registration('racing', () => JSON.stringify({ value })));
  assert.equal((await racing.preserve(lease, () => {})).status, 'BLOCKED');
});

test('readback failure or owner invalidation remains blocked even after some bytes were archived', async () => {
  let count = 0;
  const handoff = new BrowserBuildHandoff('erp_handoff_20261019', async input => {
    if (++count === 2) throw Error('READBACK_FAILED'); return receipt(input);
  });
  handoff.register(registration('first', () => '{}')); handoff.register(registration('second', () => '{}'));
  const result = await handoff.preserve(lease, () => {}); assert.equal(result.status, 'BLOCKED'); assert.equal(result.archives.length, 1);
  let current = true;
  const changed = new BrowserBuildHandoff('erp_handoff_20261019', async input => { current = false; return receipt(input); });
  changed.register(registration('owned', () => '{}'));
  assert.equal((await changed.preserve(lease, () => { assert.ok(current); })).status, 'BLOCKED');
});
