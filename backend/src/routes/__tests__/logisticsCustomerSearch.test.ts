import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import router from '../logistics';
import { prisma } from '../../lib/prisma';

// Invoke the real route handler with an isolated persistence boundary. Access
// middleware is outside this regression: no application database is contacted.
const invoke = async (method: string, path: string, body: any = {}, query: Record<string, string> = {}) => {
  const route = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route;
  let status = 200;
  let result: any;
  const response = {
    status(value: number) { status = value; return response; },
    json(value: any) { result = value; return response; },
  };
  await route.stack.at(-1).handle({ params: { projectId: 'project', id: 'loading', customerId: 'customer' }, body, query, user: { id: 'operator' } }, response);
  return { status, result };
};

test('loading search resolves split customer names and opens only the matched project', async t => {
  const stub = (target: any, method: string, implementation: any) => {
    const original = target[method];
    target[method] = implementation;
    t.after(() => { target[method] = original; });
  };
  const product = { id: 'same-stone', name: 'Stone', namePersian: 'سنگ', widthValue: 60 };
  const narrow = { rowId: 'row-40', productId: product.id, width: 40, length: 3, quantity: 2, productType: 'longitudinal' };
  const wide = { rowId: 'row-60', productId: product.id, width: 60, length: 3, quantity: 3, productType: 'longitudinal' };
  const contract: any = { id: 'contract', contractNumber: 'test-contract', customerId: 'customer',
    status: 'SIGNED', isInactive: false, logisticsLoadingLines: [], contractData: { products: [narrow, wide] } };
  const item = (id: string, row: typeof narrow) => ({ id, contractId: contract.id, productId: product.id,
    productRowId: row.rowId, productType: row.productType, quantity: new Prisma.Decimal(row.quantity),
    createdAt: new Date('2026-01-01T00:00:00Z'), product, contract });
  const narrowItem = item('item-40', narrow);
  const wideItem = item('item-60', wide);
  contract.items = [wideItem, narrowItem];
  stub(prisma.projectAddress, 'findUnique', async () => ({ id: 'project', customerId: 'customer', customer: {} }));
  stub(prisma.salesContract, 'findMany', async () => [contract]);
  stub(prisma.accountingFinancialRecord, 'findMany', async () => [{
    contractId: contract.id, financiallyApprovedAt: new Date('2026-01-02'),
    amount: new Prisma.Decimal(1), sepidarAmount: new Prisma.Decimal(1),
    systemInvoiceNumber: 'test', systemInvoiceDate: new Date()
  }]);
  stub(prisma.accountingFinancialRecord, 'findFirst', async () => ({ id: 'approval' }));
  stub(prisma.shipmentQuantityEvidence, 'findMany', async () => []);
  stub(prisma.shipmentQuantityProjection, 'findMany', async () => []);
  stub(prisma.contractApprovedPricingVersion, 'findMany', async () => [{
    id: 'version', versionNumber: 1, approvedAt: new Date('2026-01-02'), createdAt: new Date('2026-01-02'),
    rows: [
      { id: 'pricing-40', contractItemId: narrowItem.id, productRowId: narrow.rowId, unit: 'meter', contractedQuantity: '6' },
      { id: 'pricing-60', contractItemId: wideItem.id, productRowId: wide.rowId, unit: 'meter', contractedQuantity: '9' }
    ]
  }]);
  const project = { id: 'project', customerId: 'customer', customer: {}, projectName: 'امیری پور' };
  const projectQueries: unknown[] = [];
  stub(prisma.projectAddress, 'findMany', async ({ where }: any) => {
    projectQueries.push(where);
    return [project];
  });
  stub(prisma.crmCustomer, 'findUnique', async () => ({ id: 'customer' }));
  stub(prisma.crmCustomer, 'findMany', async ({ where }: any) => {
    if (JSON.stringify(where).includes('علی')) {
      assert.ok(where.OR.some((clause: any) => clause.AND?.length === 2
        && clause.AND[0].OR.some((field: any) => field.firstName?.contains === 'علی')
        && clause.AND[1].OR.some((field: any) => field.lastName?.contains === 'امیری')));
      return [{ id: 'customer', firstName: 'علی', lastName: 'امیری', phoneNumbers: [], projectAddresses: [] }];
    }
    return [{ id: 'customer', firstName: 'فروشنده', lastName: 'همکار', phoneNumbers: [], projectAddresses: [project] }];
  });

  const fullName = await invoke('get', '/customers', {}, { search: 'علی امیری' });
  assert.equal(fullName.result.data?.[0]?.customerName, 'علی امیری');
  const projectName = await invoke('get', '/customers', {}, { search: 'امیری پور' });
  assert.deepEqual(projectName.result.data?.map(({ id, projectId, customerName }: any) =>
    ({ id, projectId, customerName })), [{ id: 'customer', projectId: 'project', customerName: 'امیری پور' }]);
  await invoke('get', '/customers/:customerId/projects', {}, { projectId: 'project' });
  assert.deepEqual(projectQueries.at(-1), { customerId: 'customer', isActive: true, id: 'project' });

});
