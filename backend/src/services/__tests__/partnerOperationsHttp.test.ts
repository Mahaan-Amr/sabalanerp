import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../../../../packages/partner-sales-contracts';
import { createOperationsHttpHandlers } from '../partnerSales/operations/http';
import type { OperationsService } from '../partnerSales/operations/service';
import express from 'express';
import { createServer } from 'node:http';
import { createPartnerOperationsRouter } from '../../routes/partner-operations';
import { initialOperationsState } from '../partnerSales/operations/policy';

test('HTTP handlers require server-resolved authentication and never trust body permission claims', async () => {
  const handlers = createOperationsHttpHandlers(contract, async () => ({ ok: false, error: contract.partnerError('FORBIDDEN') }));
  let status = 0;
  let body: any;
  const response = { status: (value: number) => { status = value; return response; }, json: (value: unknown) => { body = value; }, setHeader: () => {} };
  await handlers.pause({ body: { persona: 'INTERNAL', isAdmin: true, actionGranted: true } }, response);
  assert.equal(status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.match(body.error.supportReference, /^[0-9a-f-]{36}$/);
});

test('transport rejects unknown cohort fields and hides unexpected exception details', async () => {
  let calls = 0;
  const service = { defineCohort: async () => { calls++; throw new Error('OTP-123456-private-price'); }, status: async () => { throw new Error('OTP-123456-private-price'); } } as unknown as OperationsService;
  const handlers = createOperationsHttpHandlers(contract, async () => ({ ok: true, value: service }));
  let status = 0;
  let body: any;
  const response = { status: (value: number) => { status = value; return response; }, json: (value: unknown) => { body = value; }, setHeader: () => {} };
  await handlers.defineCohort({ body: { id: 'cohort-333', name: 'همکاران', expectedRevision: 1, reason: 'آماده سازی', readiness: true } }, response);
  assert.equal(status, 400);
  assert.equal(calls, 0);
  await handlers.status({}, response);
  assert.equal(status, 503);
  assert.equal(JSON.stringify(body).includes('123456'), false);
});

test('the unmounted router serves authenticated status and rejects forged operations requests over HTTP', async () => {
  const app = express();
  app.use(express.json());
  const service = { status: async () => ({ ok: true, value: initialOperationsState() }) } as OperationsService;
  app.use('/operations', createPartnerOperationsRouter(contract, async request => request.headers.authorization === 'Bearer test-session-333'
    ? { ok: true, value: service } : { ok: false, error: contract.partnerError('FORBIDDEN') }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture unavailable');
    const origin = `http://127.0.0.1:${address.port}/operations`;
    const denied = await fetch(origin + '/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true, permission: { actionGranted: true } }) });
    assert.equal(denied.status, 403);
    await denied.arrayBuffer();
    const status = await fetch(origin, { headers: { authorization: 'Bearer test-session-333' } });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { ok: true, value: initialOperationsState() });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
