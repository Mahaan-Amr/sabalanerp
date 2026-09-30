import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPartnerCaseRouter } from '../partner-cases';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../services/contractRecoveryProtection';

test('a saved technical draft without a wizard is absent, while a corrupt wizard fails closed', async () => {
  let wizardDraft: unknown = undefined;
  const database = { salesContractEditSession: { findUnique: async () => ({ ownerUserId: 'partner-test', purpose: 'PARTNER_TECHNICAL',
    recovery: { kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1, recoveryRevision: 1, updatedAt: Date.now(),
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, ...(wizardDraft === undefined ? {} : { wizardDraft }) } }) } };
  const app = express();
  app.use('/cases', createPartnerCaseRouter({ database: database as never, authenticate: (request, _response, next) => {
    (request as any).user = { id: 'partner-test' }; next();
  } }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const url = `http://127.0.0.1:${address.port}/cases/drafts/recovery-test/wizard`;
    const absent = await fetch(url);
    assert.equal(absent.status, 404);
    wizardDraft = { corrupt: true };
    const corrupt = await fetch(url);
    assert.equal(corrupt.status, 409);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
