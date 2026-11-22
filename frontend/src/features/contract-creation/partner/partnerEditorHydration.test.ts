import test from 'node:test';
import assert from 'node:assert/strict';
import { readPartnerEditorHydration } from './partnerEditorHydration';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('owning technical and pricing reads start from the checkpoint while fresh Case authority is pending; publication waits for both', { timeout: 1_000 }, async () => {
  const currentCase = deferred<string>(), checkpoint = deferred<{ revision: number }>(), evidence = deferred<string>();
  const started = deferred<number>(); let published = false;
  const load = readPartnerEditorHydration({ readCase: () => currentCase.promise, readCheckpoint: () => checkpoint.promise,
    readEvidence: value => { started.resolve(value.revision); return evidence.promise; } }).then(value => { published = true; return value; });
  checkpoint.resolve({ revision: 7 });
  assert.equal(await started.promise, 7, 'full Case presentation must not delay checkpoint-dependent reads');
  evidence.resolve('validated history and pricing'); await Promise.resolve(); await Promise.resolve();
  assert.equal(published, false, 'technical evidence cannot publish before Case authority');
  currentCase.resolve('fresh Case authority');
  assert.deepEqual(await load, { caseResponse: 'fresh Case authority', checkpoint: { revision: 7 }, evidence: 'validated history and pricing' });
});

test('failed checkpoint cannot start dependent evidence and every authorization or evidence failure rejects hydration', async () => {
  const failure = new Error('denied'); let reads = 0;
  await assert.rejects(readPartnerEditorHydration({ readCase: async () => 'case',
    readCheckpoint: async () => { throw failure; }, readEvidence: async () => { reads++; return 'evidence'; } }), error => error === failure);
  assert.equal(reads, 0);
  await assert.rejects(readPartnerEditorHydration({ readCase: async () => { throw failure; },
    readCheckpoint: async () => 'checkpoint', readEvidence: async () => 'evidence' }), error => error === failure);
  await assert.rejects(readPartnerEditorHydration({ readCase: async () => 'case',
    readCheckpoint: async () => 'checkpoint', readEvidence: async () => { throw failure; } }), error => error === failure);
});
