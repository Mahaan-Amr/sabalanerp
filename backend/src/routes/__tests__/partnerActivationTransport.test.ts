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
    replayed: false, controlRevision: 2, eventIds: ['event-1'] } }) }), directPortFor: () => ({
      query: async input => ({ ok: true, value: { schemaVersion: 4, purpose: 'PARTNER_DIRECT_ACTIVATION',
        actorId: 'admin-1', subject: { userId: input.userId, displayName: 'فریبا پورشهید', active: true,
          role: 'SALES', userUpdatedAt: '2026-09-14T08:00:00.000Z', partnerState: 'NONE', canActivate: true,
          canRevert: false, customerCount: 0, inquiryCount: 0, caseCount: 0, priorResponsibilityCount: 0 },
        responders: [{ id: 'responder-1', label: 'پاسخ‌دهنده' }] } }),
      execute: async command => ({ ok: true, value: { schemaVersion: 4, commandId: command.commandId,
        replayed: false, userId: command.userId, profileId: 'profile-1', profileRevision: 2,
        responderAssignmentId: 'assignment-1', commercialAccountId: 'account-1', eventIds: ['event-v4'],
        removedAccessCount: 2, preservedResponsibilityCount: 1 } }),
      revert: async command => ({ ok: true, value: { schemaVersion: 4, commandId: command.commandId,
        replayed: false, userId: command.userId, profileId: command.profileId, profileRevision: 3,
        eventId: 'revert-event', restoredAccessCount: 2 } }),
    }) }));
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

    const directQuery = await fetch(`http://127.0.0.1:${address.port}/activation/query-v4`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 4,
        purpose: 'PARTNER_DIRECT_ACTIVATION', userId: 'fariba-user' }) });
    assert.equal(directQuery.status, 200);
    const directIntent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATE' as const,
      userId: 'fariba-user', responderId: 'responder-1', expectedUserUpdatedAt: '2026-09-14T08:00:00.000Z',
      consequenceConfirmed: true as const };
    const directBody = { ...directIntent, commandId: 'activate-1', correlationId: 'activate-1', idempotency: {
      actorId: 'admin-1', operation: directIntent.type, targetId: directIntent.userId, key: 'activate-1',
      payloadHash: await canonicalHash(directIntent) } };
    const direct = await fetch(`http://127.0.0.1:${address.port}/activation/commands-v4`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(directBody) });
    assert.equal(direct.status, 200);
    const directInvalid = await fetch(`http://127.0.0.1:${address.port}/activation/commands-v4`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...directBody, cohortId: 'legacy' }) });
    assert.equal(directInvalid.status, 400);
    const revertIntent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATION_REVERT' as const,
      userId: 'fariba-user', profileId: 'profile-1', expectedProfileRevision: 2, consequenceConfirmed: true as const };
    const revertBody = { ...revertIntent, commandId: 'revert-1', correlationId: 'revert-1', idempotency: {
      actorId: 'admin-1', operation: revertIntent.type, targetId: revertIntent.profileId, key: 'revert-1',
      payloadHash: await canonicalHash(revertIntent) } };
    const revert = await fetch(`http://127.0.0.1:${address.port}/activation/revert-v4`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(revertBody) });
    assert.equal(revert.status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
