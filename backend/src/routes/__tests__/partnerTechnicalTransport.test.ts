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
    return { catalog: { read: async () => ({ ok: false, error: partnerError('INVALID_PAYLOAD') }) },
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
  assert.equal(handlers.size, 5);
});
