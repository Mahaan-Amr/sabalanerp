import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountingContractsResponse } from '../accounting';
import { PartnerAccountingCommandError } from '../../services/partnerSales/accounting/errors';

test('contracts preserve the real Partner integrity conflict instead of a generic server failure', async () => {
  let status: number | undefined;
  let body: any;
  const message = 'شواهد صورتحساب همکار نیاز به بررسی دارد؛ پرونده را در حسابداری بررسی کنید.';
  const handler = createAccountingContractsResponse(async (_query, actor) => {
    assert.deepEqual(actor, { userId: 'accountant' });
    throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', message);
  }, async () => ({} as never));
  await handler({ query: {}, user: { id: 'accountant', role: 'ACCOUNTANT' } } as never, {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  } as never);
  assert.equal(status, 409);
  assert.equal(body.success, false);
  assert.equal(body.code, 'INTEGRITY_CONFLICT');
  assert.equal(body.message, message);
  assert.equal(body.actionUrl, '/dashboard/accounting/receivables');
});

test('technical contract failures return Persian feedback with tracking and hide diagnostics', async () => {
  let status: number | undefined;
  let body: any;
  const handler = createAccountingContractsResponse(async () => { throw new Error('private-database-diagnostic'); }, async () => ({} as never));
  await handler({ query: {}, user: { id: 'accountant', role: 'ACCOUNTANT' } } as never, {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  } as never);
  assert.equal(status, 500);
  assert.equal(body.success, false);
  assert.match(body.error, /دریافت اطلاعات حسابداری/);
  assert.match(body.trackingId, /^ACC-/);
  assert.doesNotMatch(JSON.stringify(body), /private-database-diagnostic/);
});
