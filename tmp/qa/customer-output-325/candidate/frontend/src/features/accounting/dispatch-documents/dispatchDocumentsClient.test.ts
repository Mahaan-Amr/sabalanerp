import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchDocumentsHttpClient, DispatchDocumentsAuthorizationError,
  mapDispatchDocumentReadModel } from './dispatchDocumentsClient';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('production adapter uses only authenticated permission projection from the response', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Dispatch-Documents-Permission': 'VIEW' } });
  const projected = await createDispatchDocumentsHttpClient().load();
  assert.equal(projected.permission, 'VIEW');
  assert.deepEqual(projected.cases, []);
});

test('production adapter fails closed instead of substituting fixture data', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'مجاز نیست' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => createDispatchDocumentsHttpClient().load(), (error) => error instanceof DispatchDocumentsAuthorizationError && error.status === 403);
});

test('production adapter retains ordered artifacts in PRINT_BOTH response', async () => {
  const readModel = { id: 'case', status: 'ACCEPTED', allocationRevision: { snapshot: {}, lines: [], pricingReferences: [], pricedAllocationEvents: [] },
    waybills: [{ id: 'waybill', number: '7', status: 'ISSUED', issuedAt: '2026-08-09T12:00:00Z', printHandoffs: [], statementAdjustments: [],
      documentArtifacts: [{ id: 'waybill-pdf', kind: 'WAYBILL', byteLength: 1, sha256: 'a', publishedAt: '2026-08-09T12:00:00Z' },
        { id: 'statement-pdf', kind: 'STATEMENT', byteLength: 1, sha256: 'b', publishedAt: '2026-08-09T12:00:00Z' }] }] };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/dispatch-candidates')) return new Response(JSON.stringify({ success: true, data: [{ id: 'case', waybills: [{ id: 'waybill' }] }] }), { status: 200 });
    if (url.includes('/document-read-model')) return new Response(JSON.stringify({ success: true, data: readModel }), { status: 200 });
    if (url.endsWith('/print-handoffs')) return new Response(new Blob(['combined']), { status: 200 });
    return new Response(new Blob(['pdf'], { type: 'application/pdf' }), { status: 200 });
  };
  const client = createDispatchDocumentsHttpClient();
  await client.load();
  const result = await client.handoff('case', { kind: 'PRINT_BOTH' });
  assert.deepEqual(result.artifacts.map((item) => item.kind), ['WAYBILL', 'STATEMENT']);
});

test('production adapter maps the frozen combined backend read model without changing money or row identity', () => {
  const item = mapDispatchDocumentReadModel({
    id: 'candidate-1', status: 'ACCEPTED', createdAt: '2026-08-09T08:00:00.000Z',
    allocationRevision: {
      id: 'revision-1', finalizedAt: '2026-08-09T08:15:00.000Z',
      snapshot: { loading: { number: '1260', customer: { companyName: 'شرکت عمران آریا' }, project: { address: 'پروژه ونک' } },
        queueTurn: { admissionSnapshot: { vehiclePlate: '78الف456', driverName: 'علی رضایی' } } },
      lines: [{ id: 'allocation-line-1', sourceContractId: 'contract-1', sourceContractItemId: 'stable-row-11',
        productRowId: 'product-row-11', quantity: '2.500', unit: 'M2', snapshot: { contractNumber: '1405-34', productName: 'تراورتن ممتاز' } }],
      pricingReferences: [{ contractId: 'contract-1', pricingVersion: { currency: 'IRR' } }],
      pricedAllocationEvents: [{ allocationRevisionLineId: 'allocation-line-1', grossAmount: '100.125000000000',
        discountAmount: '10.125000000000', netAmount: '90.000000000000' }],
    },
    waybills: [{ id: 'waybill-1', number: '1260', status: 'ISSUED', issuedAt: '2026-08-09T09:00:00.000Z',
      documentArtifacts: [{ id: 'artifact-waybill', kind: 'WAYBILL', byteLength: '120', sha256: 'abc', publishedAt: '2026-08-09T09:00:00.000Z' }],
      printHandoffs: [], statementAdjustments: [] }],
  });

  assert.equal(item.id, 'candidate-1');
  assert.equal(item.state, 'ISSUED');
  assert.equal(item.customerName, 'شرکت عمران آریا');
  assert.equal(item.total.amount, '90.000000000000');
  assert.deepEqual(item.contracts[0].rows[0], {
    id: 'stable-row-11', label: 'تراورتن ممتاز', quantity: '2.500', unit: 'M2',
    gross: { amount: '100.125000000000', currency: 'IRR' },
    discount: { amount: '10.125000000000', currency: 'IRR' },
    net: { amount: '90.000000000000', currency: 'IRR' },
  });
  assert.equal(item.bundle?.artifacts[0].id, 'artifact-waybill');
});

test('incomplete historical snapshots stay explicit and never become blank identity or zero money', () => {
  const item = mapDispatchDocumentReadModel({
    id: 'legacy-candidate', status: 'ACCEPTED',
    allocationRevision: { snapshot: {}, lines: [], pricingReferences: [], pricedAllocationEvents: [] },
    waybills: [{ id: 'legacy-waybill', number: '1258', status: 'ISSUED',
      issuedAt: '2026-08-09T12:00:00Z', documentArtifacts: [], printHandoffs: [], statementAdjustments: [] }],
  });

  assert.equal(item.loadingNumber, 'پرونده legacy-candidate');
  assert.equal(item.customerName, 'مشتری در تصویر ثابت ثبت نشده');
  assert.equal(item.destination, 'مقصد در تصویر ثابت ثبت نشده');
  assert.equal(item.vehiclePlate, 'ثبت نشده در تصویر ثابت');
  assert.equal(item.driverName, 'ثبت نشده در تصویر ثابت');
  assert.equal(item.total.amount, 'UNKNOWN');
});
