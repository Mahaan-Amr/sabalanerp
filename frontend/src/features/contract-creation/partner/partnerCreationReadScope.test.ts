import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartnerCreationReadScope } from './partnerCreationReadScope';

test('internal step remounts retain bounded display data, not Case decisions; actors and exits clear it', async () => {
  let now = 0, calls = 0;
  const scope = createPartnerCreationReadScope({ now: () => now });
  const catalog = async () => { calls++; return []; };
  await scope.catalog('a', catalog)('PRODUCT');
  now = 59_999;
  await scope.catalog('a', catalog)('PRODUCT');
  assert.equal(calls, 1);
  now = 60_000; await scope.catalog('a', catalog)('PRODUCT'); assert.equal(calls, 2);
  await scope.catalog('b', catalog)('PRODUCT'); assert.equal(calls, 3);
  scope.clear(); await scope.catalog('b', catalog)('PRODUCT'); assert.equal(calls, 4);
});

test('concurrent identical Case reads share a flight, settled reads are fresh, different revisions and actors are isolated', async () => {
  const scope = createPartnerCreationReadScope();
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const read = async () => { calls++; await gate; return calls; };
  const a = scope.read('a', 'case:one', read), b = scope.read('a', 'case:one', read);
  assert.equal(a, b); assert.equal(calls, 1);
  const c = scope.read('a', 'case:two', read); assert.equal(calls, 2);
  const d = scope.read('b', 'case:one', read); assert.equal(calls, 3);
  release(); await Promise.all([a,b,c,d]);
  await scope.read('b', 'case:one', read); assert.equal(calls, 4);
});

test('denial clears display data and failed reads remain retryable', async () => {
  const scope = createPartnerCreationReadScope(); let calls = 0;
  const catalog = async () => { calls++; return []; };
  await scope.catalog('a', catalog)('PRODUCT');
  await assert.rejects(scope.read('a', 'case:one', async () => { throw { response: { status: 403 } }; }));
  await scope.catalog('a', catalog)('PRODUCT'); assert.equal(calls, 2);
  await assert.rejects(scope.read('a', 'case:one', async () => { throw Error('temporary'); }));
  assert.equal(await scope.read('a', 'case:one', async () => 'fresh'), 'fresh');
});

test('a late denied read from a former actor cannot clear the current actor cache', async () => {
  const scope = createPartnerCreationReadScope();let calls = 0, deny!: (reason: unknown) => void;
  const catalog = async () => { calls++;return []; };
  const old=scope.read('a','case:one',()=>new Promise((_,reject)=>{deny=reject;}));
  await scope.catalog('b',catalog)('PRODUCT');
  deny({response:{status:403}});await assert.rejects(old);
  await scope.catalog('b',catalog)('PRODUCT');assert.equal(calls,1);
});
