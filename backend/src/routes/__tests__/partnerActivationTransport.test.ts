import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPartnerActivationRouter } from '../partner-activation';

test('activation transport stays authenticated, strict and private', async () => {
  const app = express(); app.use(express.json());
  app.use('/activation', createPartnerActivationRouter({ authenticate: (request, _response, next) => {
    (request as any).user = { id: 'admin-1' }; next();
  }, portFor: () => ({ query: async () => ({ ok: true, value: { schemaVersion: 3,
    purpose: 'PARTNER_ACTIVATION', actorId: 'admin-1', release: { controlRevision: 1,
      status: 'MISSING', actions: [] }, candidates: [], identityEvidence: [], commercialTerms: [], creditTerms: [], responders: [] } }),
  execute: async command => ({ ok: true, value: { schemaVersion: 3, commandId: command.commandId,
    replayed: false, controlRevision: 2, eventIds: ['event-1'] } }) }) }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const query = await fetch(`http://127.0.0.1:${address.port}/activation/query-v3`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION' }) });
    assert.equal(query.status, 200); assert.equal(query.headers.get('cache-control'), 'private, no-store');
    const intent = { schemaVersion: 3 as const, type: 'RELEASE_READINESS_PUBLISH' as const,
      verifiedPackageId: 'verified-1', expectedControlRevision: 1, reason: 'انتشار بسته معتبر آمادگی' };
    const body = { ...intent, commandId: 'publish-1', correlationId: 'publish-1', idempotency: {
      actorId: 'admin-1', operation: intent.type, targetId: 'verified-1', key: 'publish-1',
      payloadHash: await canonicalHash(intent) } };
    const command = await fetch(`http://127.0.0.1:${address.port}/activation/commands-v3`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(command.status, 200);
    const invalid = await fetch(`http://127.0.0.1:${address.port}/activation/commands-v3`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, extra: true }) });
    assert.equal(invalid.status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
