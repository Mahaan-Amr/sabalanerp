import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import router from '../logistics';
import { prisma } from '../../lib/prisma';

// Invoke the real route handler with an isolated persistence boundary. Access
// middleware is outside this regression: no application database is contacted.
const invoke = async (method: string, path: string, body: any = {}) => {
  const route = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route;
  let status = 200;
  let result: any;
  const response = {
    status(value: number) { status = value; return response; },
    json(value: any) { result = value; return response; },
  };
  await route.stack.at(-1).handle({ params: { projectId: 'project', id: 'loading' }, body, user: { id: 'operator' } }, response);
  return { status, result };
};

test('same-product rows keep their dimensions, balances and loading amounts across ordering and save/reload', async t => {
  const stub = (target: any, method: string, implementation: any) => {
    const original = target[method];
    target[method] = implementation;
    t.after(() => { target[method] = original; });
  };
  const product = { id: 'same-stone', name: 'Stone', namePersian: 'سنگ', widthValue: 60 };
  const narrow = { rowId: 'row-40', productId: product.id, width: 40, length: 3, quantity: 2, productType: 'longitudinal' };
  const wide = { rowId: 'row-60', productId: product.id, width: 60, length: 3, quantity: 3, productType: 'longitudinal' };
  const contract: any = { id: 'contract', contractNumber: 'test-contract', customerId: 'customer',
    status: 'SIGNED', isInactive: false, contractData: { products: [narrow, wide] } };
  const item = (id: string, row: typeof narrow) => ({ id, contractId: contract.id, productId: product.id,
    productRowId: row.rowId, productType: row.productType, quantity: new Prisma.Decimal(row.quantity),
    createdAt: new Date('2026-01-01T00:00:00Z'), product, contract });
  const narrowItem = item('item-40', narrow);
  const wideItem = item('item-60', wide);
  contract.items = [wideItem, narrowItem]; // Same timestamps, opposite JSON row order.
  let loading: any = { id: 'loading', status: 'DRAFT', lines: [] };

  stub(prisma.projectAddress, 'findUnique', async () => ({ id: 'project', customerId: 'customer', customer: {} }));
  stub(prisma.salesContract, 'findMany', async () => [contract]);
  stub(prisma.accountingFinancialRecord, 'findMany', async () => [{ contractId: contract.id,
    amount: new Prisma.Decimal(1), sepidarAmount: new Prisma.Decimal(1), systemInvoiceNumber: 'test', systemInvoiceDate: new Date() }]);
  stub(prisma.accountingFinancialRecord, 'findFirst', async () => ({ id: 'approval' }));
  stub(prisma.logisticsLoadingLine, 'findMany', async () => []);
  stub(prisma.logisticsLoadingCorrection, 'findMany', async () => []);
  stub(prisma.contractItem, 'findUnique', async ({ where }: any) => [narrowItem, wideItem].find(row => row.id === where.id));
  stub(prisma.logisticsLoading, 'findUnique', async () => loading);
  const tx = {
    $queryRaw: async () => [], salesContract: prisma.salesContract, accountingFinancialRecord: prisma.accountingFinancialRecord,
    logisticsLoadingDriverAssignment: { findMany: async () => [] },
    logisticsLoadingDriverAllocation: { deleteMany: async () => ({ count: 0 }) },
    logisticsLoadingLine: { deleteMany: async () => ({ count: 0 }) },
    logisticsLoading: { update: async ({ data }: any) => { loading = { ...loading, lines: data.lines.create }; return loading; } },
  };
  stub(prisma, '$transaction', async (work: any) => work(tx));

  for (const items of [[wideItem, narrowItem], [narrowItem, wideItem]]) {
    contract.items = items;
    const remaining = await invoke('get', '/projects/:projectId/remaining');
    assert.equal(remaining.status, 200);
    const sources = remaining.result.data.groups.flatMap((group: any) => group.sources);
    for (const [id, width, meters] of [['item-40', 40, 6], ['item-60', 60, 9]]) {
      const source = sources.find((row: any) => row.contractItemId === id);
      assert.equal(source.productSnapshot.width, width, `${id} must keep its own width`);
      assert.equal(source.remainingQuantity, meters, `${id} must keep its own balance`);
    }
    const saved = await invoke('put', '/loadings/:id', { lines: [
      // Stale client snapshots must not override the selected row identity.
      { sourceContractItemId: 'item-40', quantity: '5.8', unit: 'meter', productSnapshot: wide,
        sourceSnapshot: { contractItemId: 'item-60', contractedQuantity: 9, remainingQuantity: 9, groupKey: 'wrong-wide-group' } },
      { sourceContractItemId: 'item-60', quantity: '7', unit: 'meter', productSnapshot: narrow },
    ] });
    assert.equal(saved.status, 200, JSON.stringify(saved.result));
    const reloaded = await invoke('get', '/loadings/:id');
    assert.equal(reloaded.status, 200);
    assert.deepEqual(reloaded.result.data.lines.map((line: any) => [line.sourceContractItemId,
      line.productRowId, line.quantity.toString(), line.productSnapshot.width, line.sourceSnapshot.contractedQuantity,
      line.sourceSnapshot.remainingQuantity, line.sourceSnapshot.contractItemId]), [
      ['item-40', 'row-40', '5.8', 40, 6, 6, 'item-40'], ['item-60', 'row-60', '7', 60, 9, 9, 'item-60'],
    ]);
    for (const line of reloaded.result.data.lines) {
      const source = sources.find((row: any) => row.contractItemId === line.sourceContractItemId);
      assert.equal(line.sourceSnapshot.groupKey, remaining.result.data.groups.find((group: any) => group.sources.includes(source)).groupKey);
    }
  }
});
