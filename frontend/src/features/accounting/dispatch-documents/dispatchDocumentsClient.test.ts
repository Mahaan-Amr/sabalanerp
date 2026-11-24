import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchDocumentsHttpClient, DispatchDocumentsAuthorizationError,
  mapDispatchDocumentReadModel } from './dispatchDocumentsClient';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('loads 66 authorized queue summaries without reading details, and reports a selected failure locally', async () => {
  const calls: string[] = [];
  const summaries = Array.from({ length: 66 }, (_, index) => ({
    id: `case-${index}`, loadingId: `loading-${index}`, state: 'READY', canManage: true,
    customerName: 'مشتری', destination: 'مقصد', loadingNumber: String(index),
    total: { amount: '9007199254740993.125', currency: 'IRR' },
  }));
  globalThis.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('documentQueue=')) return Response.json({ success: true, data: {
      rows: summaries.slice(0, 50), counts: { READY: 66, BLOCKED: 0, ISSUED: 0 }, page: 1, pageSize: 50,
    }}, { headers: { 'X-Dispatch-Documents-Permission': 'MANAGE' } });
    if (url.includes('case-0/document-read-model')) return Response.json({ success: false }, { status: 503 });
    if (url.includes('case-1/document-read-model')) return Response.json({ success: true, data: { id: 'case-1', status: 'PENDING' } });
    return Response.json({ success: true, data: summaries });
  };

  const client = createDispatchDocumentsHttpClient();
  const queue = await client.load();
  assert.equal(calls.length, 1);
  assert.equal(queue.counts?.READY, 66);
  assert.equal(queue.cases[0].total.amount, '9007199254740993.125');
  await assert.rejects(() => client.read(queue.cases[0]));
  assert.equal((await client.read(queue.cases[1])).id, 'case-1');
  assert.equal(calls.length, 3);
});

test('production adapter uses only authenticated permission projection from the response', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { rows: [] } }), { status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Dispatch-Documents-Permission': 'VIEW' } });
  const projected = await createDispatchDocumentsHttpClient().load();
  assert.equal(projected.permission, 'VIEW');
  assert.deepEqual(projected.cases, []);
});

test('the durable issuance receipt resolves before any detail read and replay sends the original intent', async () => {
  const requests: Array<{ url: string; key: string | null; body: BodyInit | null | undefined }> = [];
  let loseResponse = true;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), key: new Headers(init?.headers).get('Idempotency-Key'), body: init?.body });
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError('connection lost after commit');
    }
    return Response.json({ success: true, data: {
      candidateId: 'case', status: 'ACCEPTED', waybill: { id: 'waybill', number: '2026', status: 'ISSUED' },
    } });
  };
  const client = createDispatchDocumentsHttpClient();
  const intent = { action: 'ACCEPT' as const, reason: '', idempotencyKey: 'durable-key' };
  await assert.rejects(() => client.decide('case', intent), { name: 'DispatchDocumentsOutcomeUnknownError' });
  assert.deepEqual(await client.decide('case', intent), { status: 'ISSUED', number: '2026' });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
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
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('documentQueue=')) return new Response(JSON.stringify({ success: true,
      data: { rows: [{ id: 'case', canManage: true, waybillId: 'waybill', state: 'ISSUED' }] } }), { status: 200,
      headers: { 'X-Dispatch-Documents-Permission': 'MANAGE' } });
    if (url.includes('/document-read-model')) return new Response(JSON.stringify({ success: true, data: readModel }), { status: 200 });
    if (url.includes('/print-handoffs?format=form-data')) {
      const form = new FormData();
      form.set('WAYBILL', new Blob(['waybill'], { type: 'application/pdf' }), 'waybill.pdf');
      form.set('STATEMENT', new Blob(['statement'], { type: 'application/pdf' }), 'statement.pdf');
      return new Response(form);
    }
    throw new Error('Printing should use the retained response bytes.');
  };
  const client = createDispatchDocumentsHttpClient();
  const workspace = await client.load();
  assert.equal(workspace.permission, 'MANAGE');
  const details = await client.read(workspace.cases[0]);
  assert.equal(details.canManage, true, 'the candidate-scoped mutation projection survives read-model hydration');
  const result = await client.handoff('case', { kind: 'PRINT_BOTH' });
  assert.deepEqual(result.artifacts.map((item) => item.kind), ['WAYBILL', 'STATEMENT']);
  assert.equal(requests.length, 3);
  for (const artifact of result.artifacts) URL.revokeObjectURL(artifact.url);
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

  assert.equal(item.loadingNumber, 'بارگیری ثبت‌شده');
  assert.equal(item.customerName, 'مشتری در تصویر ثابت ثبت نشده');
  assert.equal(item.destination, 'مقصد در تصویر ثابت ثبت نشده');
  assert.equal(item.vehiclePlate, 'پلاک در تصویر ثابت ثبت نشده');
  assert.equal(item.driverName, 'نام راننده در تصویر ثابت ثبت نشده');
  assert.equal(item.total.amount, 'UNKNOWN');
});

test('a missing priced line never displays a partial total or a zero row', () => {
  const item = mapDispatchDocumentReadModel({ id: 'case', status: 'PENDING', allocationRevision: {
    snapshot: {}, pricingReferences: [],
    lines: [{ id: 'a', sourceContractId: 'c', snapshot: {}, quantity: '1', unit: 'meter' },
      { id: 'b', sourceContractId: 'c', snapshot: {}, quantity: '1', unit: 'meter' }],
    pricedAllocationEvents: [{ allocationRevisionLineId: 'a', netAmount: '20' }],
  }, waybills: [] });
  assert.equal(item.total.amount, 'UNKNOWN');
  assert.equal(item.contracts[0].rows[1].net.amount, 'UNKNOWN');
});
