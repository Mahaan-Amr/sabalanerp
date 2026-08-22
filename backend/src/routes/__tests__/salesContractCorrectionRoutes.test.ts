import assert from 'node:assert/strict';
import router from '../sales';
import { createAccountingActionHandler, createAccountingCorrectionRequestHandler } from '../accounting';
import dutyRouter, { serializeCrossWorkspaceDutyResponse } from '../hr-duties';

const routes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: unknown[] } }>;
}).stack.flatMap((layer) => layer.route ? [layer.route] : []);

const sellerRequest = routes.find(({ path, methods }) => (
  path === '/contracts/:id/correction-requests' && methods.post
));
assert.ok(sellerRequest, 'missing Seller-originated Contract correction request endpoint');
assert.ok(sellerRequest.stack.length >= 5, 'Seller correction endpoint must retain auth, Sales permission, and validation middleware');

const dutyRoutes = (dutyRouter as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
}).stack.flatMap((layer) => layer.route ? [layer.route] : []);
assert.ok(dutyRoutes.some(({ path, methods }) => path === '/:id/claim' && methods.post), 'missing generic duty claim endpoint');
assert.ok(dutyRoutes.some(({ path, methods }) => path === '/:id/reassign' && methods.post), 'missing generic duty reassignment endpoint');
assert.ok(dutyRoutes.some(({ path, methods }) => (
  path === '/workspaces/:workspaceCode/duties/:id/eligible-assignees' && methods.get
)), 'missing eligible duty assignees endpoint');

const transitionedAt = new Date('2026-08-22T12:00:00.000Z');
const serializedCorrectionResponse = serializeCrossWorkspaceDutyResponse({
  predecessor: { id: 'accounting-duty-1', dueAt: transitionedAt },
  successor: { id: 'sales-duty-1', dueAt: transitionedAt },
  replayed: false,
});
assert.equal(serializedCorrectionResponse.data.id, 'accounting-duty-1');
assert.equal(serializedCorrectionResponse.data.dueAtDisplay.length > 0, true);
assert.deepEqual(serializedCorrectionResponse.meta, { replayed: false });

const verifyLegacyAccountingWriterIsGone = async () => {
  const handler = createAccountingActionHandler();
  let statusCode = 200;
  let payload: any;
  await handler({
    body: { kind: 'REQUEST_CORRECTION', contractId: 'legacy-contract' },
    user: { id: 'accountant', role: 'ADMIN' },
    workspace: 'accounting', workspacePermission: 'admin', featurePermission: 'admin',
    get: () => undefined,
  } as any, {
    status(code: number) { statusCode = code; return this; },
    json(body: any) { payload = body; return this; },
  } as any);
  assert.equal(statusCode, 410);
  assert.equal(payload.message, 'درخواست اصلاح را از دکمه «درخواست اصلاح» در پرونده حسابداری قرارداد دوباره ثبت کنید.');
};

const verifyAccountingOriginatedWriterIsLive = async () => {
  let received: any;
  const handler = createAccountingCorrectionRequestHandler(async (_database: any, input: any) => {
    received = input;
    return { correction: { id: 'correction-1' }, duty: { id: 'manager-duty-1' }, replayed: false } as any;
  });
  let statusCode = 200;
  let payload: any;
  await handler({
    params: { contractId: 'contract-1' },
    body: { category: 'AMOUNT_PRICING', priority: 'HIGH', reason: 'مبلغ قرارداد باید اصلاح شود.' },
    user: { id: 'accounting-admin', role: 'ADMIN' },
    get: (name: string) => name === 'X-Idempotency-Key' ? 'correction-request-1' : undefined,
  } as any, {
    status(code: number) { statusCode = code; return this; },
    json(body: any) { payload = body; return this; },
  } as any);
  assert.equal(statusCode, 201);
  assert.equal(payload.success, true);
  assert.deepEqual(received, {
    contractId: 'contract-1', actorUserId: 'accounting-admin', category: 'AMOUNT_PRICING',
    priority: 'HIGH', reason: 'مبلغ قرارداد باید اصلاح شود.', idempotencyKey: 'correction-request-1',
  });
};

void Promise.all([verifyLegacyAccountingWriterIsGone(), verifyAccountingOriginatedWriterIsLive()])
  .then(() => console.log('Sales Contract correction route tests passed.'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
