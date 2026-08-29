import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPartnerTechnicalPolicyRouter } from '../partner-technical-policy';

test('technical policy transport authenticates and keeps private Sales policy responses out of caches', async () => {
  const app = express(); app.use(express.json());
  app.use('/policy', createPartnerTechnicalPolicyRouter({ authenticate: (request, _response, next) => {
    (request as any).user = { id: 'manager-1' }; next();
  }, serviceFor: request => ({
    read: async profileId => ({ ok: true, value: { profileId, actorId: request.user!.id, accountVersion: 2 } }),
    publish: async command => ({ ok: false, error: { code: 'ROW_STALE', status: 409,
      message: 'اطلاعات تغییر کرده است؛ تازه‌سازی کنید.' } }),
  }) }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const read = await fetch(`http://127.0.0.1:${address.port}/policy/profile-1`);
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await read.json(), { success: true, data: { profileId: 'profile-1', actorId: 'manager-1', accountVersion: 2 } });
    const stale = await fetch(`http://127.0.0.1:${address.port}/policy`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    const body = await stale.json() as any;
    assert.equal(stale.status, 409); assert.equal(body.code, 'ROW_STALE'); assert.match(body.supportReference, /^[0-9a-f-]{36}$/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
