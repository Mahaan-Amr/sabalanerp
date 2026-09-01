import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCaseCommandSession } from '../cases/PartnerCaseCommandSession';
import { resolvePartnerContractRoute } from '../cases/partnerContractRouting';

test('retail correction retries the identical one-save command after an uncertain response', async () => {
  const fixture = createPartnerFixtures();
  const received: unknown[] = [];
  const session = new PartnerCaseCommandSession({ execute: async command => {
    received.push(command);
    if (received.length === 1) throw new Error('private transport failure');
    return { ok: true, value: { commandId: command.commandId, replayed: true, eventIds: ['event-332'] } };
  } }, 'partner-332');
  const intent = { type: 'RETAIL_CORRECTION_SAVE' as const, expected: fixture.partner.owner, expectedState: 'COMMITTED' as const,
    opportunityId: 'opportunity-332', retailPrices: [{ productRowId: fixture.partner.products[0].productRowId,
      retailUnitPrice: { amount: '1100', currency: 'IRR' as const } }], customerPaymentPlan: fixture.partner.customerPaymentPlan };
  assert.equal((await session.submit(intent)).kind, 'uncertain');
  assert.equal((await session.submit({ ...intent, opportunityId: 'changed-opportunity' })).kind, 'blocked');
  assert.equal((await session.retry()).kind, 'success');
  assert.deepEqual(received[1], received[0]);
  assert.equal(session.isSaved, true);
  assert.equal((await session.submit(intent)).kind, 'blocked');
  assert.equal((await session.submit({ ...intent, opportunityId: 'new-approved-opportunity' })).kind, 'success');
});

test('receipt failure is actionable while successful retry preserves historical allocation intent', async () => {
  const fixture = createPartnerFixtures();
  let calls = 0;
  const session = new PartnerCaseCommandSession({ execute: async command => {
    calls += 1;
    if (calls === 1) return { ok: false, error: { code: 'ROW_STALE', status: 409, message: 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.' } };
    return { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: ['receipt-event'] } };
  } }, 'partner-332');
  const intent = { type: 'RETAIL_RECEIPT' as const, expected: fixture.partner.owner, expectedState: 'COMMITTED' as const,
    planId: fixture.partner.customerPaymentPlan.planId, receiptId: 'receipt-332', amount: { amount: '500', currency: 'IRR' as const },
    effectiveDate: '2026-08-29', allocations: [{ installmentId: fixture.partner.customerPaymentPlan.installments[0].installmentId, amount: '500' }] };
  const failed = await session.submit(intent);
  assert.equal(failed.kind, 'error');
  assert.match(failed.kind === 'error' ? failed.message : '', /تازه/);
  assert.equal((await session.submit(intent)).kind, 'success');
});

test('contract routes only select Partner composition from explicit server metadata', () => {
  assert.deepEqual(resolvePartnerContractRoute({ id: 'contract-332', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: 'case-332',
    partnerRevision: 3, partnerIntegrityHash: `sha256-v1:${'a'.repeat(64)}` }), { kind: 'partner', caseId: 'case-332', expected: {
      caseId: 'case-332', revision: 3, integrityHash: `sha256-v1:${'a'.repeat(64)}` } });
  assert.deepEqual(resolvePartnerContractRoute({ id: 'ordinary-contract' }), { kind: 'ordinary' });
  assert.deepEqual(resolvePartnerContractRoute({ id: 'malformed', partnerKind: 'PARTNER_CUSTOMER' }), { kind: 'blocked' });
});
