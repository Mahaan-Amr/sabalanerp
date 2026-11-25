import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchRegistryReads, type DispatchRegistryPage } from '../dispatchRegistryReads';

const pending = { id: 'row-a', loadingId: 'group-a', status: 'PENDING' };
const issued = { ...pending, status: 'ACCEPTED', currentSalesInvoice: { id: 'invoice-a' } };
const sibling = { id: 'row-b', loadingId: 'group-b', status: 'PENDING', currentSalesInvoice: { id: 'invoice-b' } };
const page: DispatchRegistryPage = { ids: new Set(['row-a', 'row-b']), invoiceActionIds: new Set(['row-b']), page: 1, total: 2 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

test('a delayed registry response keeps the newest group rows and actions without modifying unrelated rows', async () => {
  const reads = createDispatchRegistryReads<typeof issued | typeof pending>();
  reads.acceptList(reads.beginList(), { rows: [pending, sibling], page });

  const delayed = deferred<{ rows: (typeof issued | typeof pending)[]; page: DispatchRegistryPage }>();
  const list = reads.beginList();
  const loadingList = delayed.promise.then(result => reads.acceptList(list, result));
  reads.acceptGroup(reads.beginGroup(), 'group-a', [issued]);
  delayed.resolve({ rows: [pending, sibling], page });

  const snapshot = await loadingList;
  assert.deepEqual(snapshot?.rows, [issued, sibling]);
  assert.deepEqual(snapshot?.page?.invoiceActionIds, new Set(['row-a', 'row-b']));
});

test('a late group read returns the newer list version to its caller without publishing stale action data', async () => {
  const reads = createDispatchRegistryReads<typeof issued | typeof pending>();
  reads.acceptList(reads.beginList(), { rows: [pending], page });

  const delayed = deferred<(typeof issued | typeof pending)[]>();
  const group = reads.beginGroup();
  const readingGroup = delayed.promise.then(rows => reads.acceptGroup(group, 'group-a', rows));
  reads.acceptList(reads.beginList(), { rows: [issued], page });
  delayed.resolve([pending]);

  assert.deepEqual(await readingGroup, { rows: [issued] });
});

test('discarding private access prevents outstanding list and group reads from restoring candidates', () => {
  const reads = createDispatchRegistryReads<typeof pending>();
  const list = reads.beginList();
  const group = reads.beginGroup();
  assert.deepEqual(reads.discard(), { rows: [] });
  assert.equal(reads.acceptList(list, { rows: [pending], page }), undefined);
  assert.equal(reads.acceptGroup(group, 'group-a', [pending]), undefined);
});
