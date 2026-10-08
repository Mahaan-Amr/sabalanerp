import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPartnerCaseRouter } from '../partner-cases';
import { createPartnerTechnicalRequestServices } from '../partner-technical';

const expired = Object.assign(new Error('transaction expired; private SQL lease-token secret'), { code: 'P2028' });

function budgetProbe(failure: unknown = expired) {
  let attempts = 0;
  const budgets: unknown[] = [];
  const database = { async $transaction(_work: unknown, options: unknown) {
    attempts += 1;
    budgets.push(options);
    assert.deepEqual(options, { maxWait: 5_000, timeout: 15_000 });
    throw failure;
  } };
  return { database, attempts: () => attempts, budgets };
}

test('creation context has a bounded transaction budget and does not retry expiry', async () => {
  const probe = budgetProbe();
  const logs: unknown[] = [];
  const app = express();
  app.use(createPartnerCaseRouter({ database: probe.database as never, reportCreationFailure: value => logs.push(value),
    authenticate: (request, _response, next) => {
    (request as any).user = { id: 'partner-budget-test' }; next();
  } }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/creation-context`);
    assert.equal(response.status, 503);
    const body = await response.json() as { code: string; supportReference: string };
    assert.equal(body.code, 'TEMPORARY_FAILURE');
    assert.match(body.supportReference, /^[0-9a-f-]{36}$/);
    assert.deepEqual(logs, [{ supportReference: body.supportReference, code: 'TEMPORARY_FAILURE', databaseCode: 'P2028' }]);
    assert.doesNotMatch(JSON.stringify({ body, logs }), /private|secret|lease-token|SQL/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(probe.attempts(), 1);
    assert.deepEqual(probe.budgets, [{ maxWait: 5_000, timeout: 15_000 }]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('unknown creation context failures retain integrity status without exposing exception text', async () => {
  const probe = budgetProbe(new Error('private customer SQL secret'));
  const logs: unknown[] = [];
  const app = express();
  app.use(createPartnerCaseRouter({ database: probe.database as never, reportCreationFailure: value => logs.push(value),
    authenticate: (request, _response, next) => { (request as any).user = { id: 'partner-budget-test' }; next(); } }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/creation-context`);
    const body = await response.json() as { code: string; supportReference: string };
    assert.equal(response.status, 409);
    assert.equal(body.code, 'INTEGRITY_CONFLICT');
    assert.deepEqual(logs, [{ supportReference: body.supportReference, code: 'INTERNAL_ERROR' }]);
    assert.doesNotMatch(JSON.stringify({ body, logs }), /private|customer|SQL|secret/);
    assert.equal(probe.attempts(), 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('technical catalog, lease, recovery read and checkpoint use bounded owning transactions', async () => {
  const probe = budgetProbe();
  const ports = createPartnerTechnicalRequestServices({ database: probe.database as never,
    actorId: 'partner-budget-test', correlationId: 'budget-test' });
  const access = { schemaVersion: 1 as const, recoveryId: 'budget-recovery',
    browserSessionId: 'budget-browser', leaseToken: 'budget-lease', baseRevision: 0 };
  const operations = [
    () => ports.catalog.read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: 'PRODUCT', limit: 100 }),
    () => ports.lease.acquire({ schemaVersion: 1, recoveryId: access.recoveryId,
      browserSessionId: access.browserSessionId, baseRevision: 0, takeover: false }),
    () => ports.recovery.read(access),
    () => ports.recovery.checkpoint({ ...access, expectedRecoveryRevision: 0, idempotencyKey: 'budget-checkpoint',
      draft: { schemaVersion: 1, inputRevision: 0, rows: [] } }),
  ];
  for (const [index, operation] of operations.entries()) {
    await assert.rejects(operation, error => error === expired);
    assert.equal(probe.attempts(), index + 1, 'expiry must not retry a business transaction');
  }
});
