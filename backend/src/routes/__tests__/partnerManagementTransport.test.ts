import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPartnerManagementRouter } from '../partner-management';

test('management transport authenticates, remains private and returns canonical failures', async () => {
  const app = express(); app.use(express.json());
  app.use('/management', createPartnerManagementRouter({ authenticate: (request, _response, next) => {
    (request as any).user = { id: 'manager-1' }; next();
  }, serviceFor: request => ({ execute: async input => (input as { profileId?: string }).profileId === 'profile-1'
    ? { ok: true, value: { commandId: 'command-1', replayed: false, profileId: 'profile-1', revision: 2, eventIds: ['event-1'] } }
    : { ok: false, error: { code: 'NOT_FOUND', status: 404, message: 'مورد در دسترس نیست.' } } }) }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/management/commands-v2`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'profile-1' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { success: true, data: { commandId: 'command-1', replayed: false,
      profileId: 'profile-1', revision: 2, eventIds: ['event-1'] } });
    const missing = await fetch(`http://127.0.0.1:${address.port}/management/commands-v2`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'missing' }) });
    const body = await missing.json() as any;
    assert.equal(missing.status, 404); assert.equal(body.code, 'NOT_FOUND'); assert.match(body.supportReference, /^[0-9a-f-]{36}$/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
