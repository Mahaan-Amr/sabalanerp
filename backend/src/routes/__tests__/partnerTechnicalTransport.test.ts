import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerError } from '@sabalanerp/partner-sales-contracts';
import { registerPartnerTechnicalRoutes, type TechnicalRequest, type TechnicalResponse } from '../partner-technical';

test('technical transport resolves request-bound ports and keeps every response private', async () => {
  const handlers = new Map<string, (request: TechnicalRequest, response: TechnicalResponse) => Promise<void>>();
  const router = { post: (path: string, handler: any) => handlers.set(`POST ${path}`, handler),
    put: (path: string, handler: any) => handlers.set(`PUT ${path}`, handler) };
  let boundRequest: TechnicalRequest | undefined;
  registerPartnerTechnicalRoutes(router, { servicesFor: async request => {
    boundRequest = request;
    return { lease: { acquire: async () => ({ ok: false, error: partnerError('FORBIDDEN') }) },
      catalog: { read: async () => ({ ok: false, error: partnerError('INVALID_PAYLOAD') }) },
      recovery: { read: async () => ({ ok: false, error: partnerError('NOT_FOUND') }),
        checkpoint: async () => ({ ok: false, error: partnerError('ROW_STALE') }) },
      saved: { save: async () => ({ ok: false, error: partnerError('FORBIDDEN') }),
        readSaved: async () => ({ ok: false, error: partnerError('NOT_FOUND') }) } };
  } });
  const headers = new Map<string, string>(); let status = 200; let body: any;
  const response: TechnicalResponse = { status: code => { status = code; return response; },
    json: value => { body = value; }, setHeader: (name, value) => { headers.set(name, value); } };
  const request = { body: { schemaVersion: 1 } };
  await handlers.get('POST /catalog/query')!(request, response);
  assert.equal(boundRequest, request);
  assert.equal(status, 400);
  assert.deepEqual({ success: body.success, code: body.code }, { success: false, code: 'INVALID_PAYLOAD' });
  assert.match(body.supportReference, /^[0-9a-f-]{36}$/);
  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  status = 200; body = undefined;
  await handlers.get('POST /recoveries/acquire')!(request, response);
  assert.equal(status, 403);
  assert.equal(body.code, 'FORBIDDEN');
  assert.equal(handlers.size, 6);
});

test('technical infrastructure failures have a matching sanitized support log instead of an integrity conflict', async () => {
  for (const [failure, status, code, databaseCode] of [
    [{ code: 'P2028', message: 'private lease token and SQL values' }, 503, 'TEMPORARY_FAILURE', 'P2028'],
    [new Error('Connector error code: "40P01"; private parameters'), 503, 'TEMPORARY_FAILURE', '40P01'],
    [new Error('unexpected private customer data'), 500, 'INTERNAL_ERROR', undefined],
  ] as const) {
    const handlers = new Map<string, any>();
    const logs: unknown[] = [];
    registerPartnerTechnicalRoutes({ post: (path, handler) => handlers.set(path, handler),
      put: (path, handler) => handlers.set(path, handler) }, {
      servicesFor: async () => { throw failure; }, reportFailure: value => { logs.push(value); },
    });
    let actualStatus = 200; let body: any;
    const response: TechnicalResponse = { status: value => { actualStatus = value; return response; },
      json: value => { body = value; }, setHeader: () => undefined };
    await handlers.get('/recoveries/save')({ body: { password: 'secret', leaseToken: 'private' } }, response);
    assert.equal(actualStatus, status);
    assert.equal(body.code, code);
    assert.deepEqual(logs, [{ supportReference: body.supportReference, code, ...(databaseCode ? { databaseCode } : {}) }]);
    assert.doesNotMatch(JSON.stringify({ body, logs }), /private|secret|parameters|customer data/);
  }
});

test('genuine evidence conflicts retain their business status', async () => {
  let handler: any; const logs: unknown[] = [];
  registerPartnerTechnicalRoutes({ post: (path, fn) => { if (path === '/recoveries/save') handler = fn; }, put: () => undefined }, {
    servicesFor: async () => ({ saved: { save: async () => ({ ok: false, error: partnerError('INTEGRITY_CONFLICT') }) } } as any),
    reportFailure: value => { logs.push(value); },
  });
  let status = 200; let body: any;
  const response: TechnicalResponse = { status: value => { status = value; return response; },
    json: value => { body = value; }, setHeader: () => undefined };
  await handler({ body: {} }, response);
  assert.equal(status, 409); assert.equal(body.code, 'INTEGRITY_CONFLICT'); assert.deepEqual(logs, []);
});
