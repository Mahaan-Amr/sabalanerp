import test from 'node:test';
import assert from 'node:assert/strict';
import { coalescePartnerCatalogReads, loadPartnerCreationCatalog } from './partnerCreationCatalogLoader';

test('products become available while secondary catalogs are still pending', async () => {
  let published = false;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const loading = loadPartnerCreationCatalog(async kind => {
    if (kind !== 'PRODUCT') await blocked;
    return [{ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [] }];
  }, () => { published = true; }, () => {});
  await Promise.resolve(); await Promise.resolve();
  const early = published;
  release(); await loading;
  assert.equal(early, true, 'an unrelated slow service must not hide fetched products');
});

test('a secondary catalog failure preserves published products and does not publish incomplete dependencies', async () => {
  let productsPublished = false;
  let dependenciesPublished = false;
  await assert.rejects(loadPartnerCreationCatalog(async kind => {
    if (kind === 'TOOL') throw new Error('temporary failure');
    return [{ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [] }];
  }, () => { productsPublished = true; }, () => { dependenciesPublished = true; }));
  assert.equal(productsPublished, true);
  assert.equal(dependenciesPublished, false);
});

test('concurrent creator reads share one request and failed reads can be retried', async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const read = coalescePartnerCatalogReads(async () => {
    calls++;
    await blocked;
    throw new Error('temporary failure');
  });
  const first = read('PRODUCT');
  const second = read('PRODUCT');
  assert.equal(first, second);
  release();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  await assert.rejects(read('PRODUCT'));
  assert.equal(calls, 2);
});

test('leaving the creator stops its remaining catalog requests and publications', async () => {
  const reads: string[] = [];
  await loadPartnerCreationCatalog(async kind => {
    reads.push(kind);
    return [{ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [] }];
  }, () => assert.fail('stale products published'), () => assert.fail('stale dependencies published'), () => false);
  assert.deepEqual(reads, ['PRODUCT']);
});
