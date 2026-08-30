import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import {
  buildCaseCancellationEvent,
  buildCaseCommitmentEvent,
  projectCustomerContractStatus,
} from '../partnerSales/cases/events';

const fixture = createPartnerFixtures();
const common = {
  eventId: 'event-321', commandId: 'command-321', correlationId: 'correlation-321', actorId: 'actor-321',
  recordedAt: '2026-08-30T08:00:00.000Z', effectiveDate: '2026-08-30', owner: fixture.case.head,
};

test('the first signed or printed fact creates the one public commitment event', () => {
  const signed = buildCaseCommitmentEvent({ ...common, trigger: 'SIGNED', internalRecordId: fixture.accounting.recordId,
    salesCreditOwnerId: fixture.case.salesCreditOwnerId,
    sabalanNetAmount: { amount: fixture.accounting.totals.payable, currency: fixture.accounting.totals.currency } });
  assert.equal(signed.type, 'CASE_COMMITTED');
  assert.equal(signed.trigger, 'SIGNED');
  assert.equal(signed.internalRecordId, fixture.accounting.recordId);

  const printed = buildCaseCommitmentEvent({ ...common, trigger: 'PRINTED', internalRecordId: fixture.accounting.recordId,
    salesCreditOwnerId: fixture.case.salesCreditOwnerId,
    sabalanNetAmount: { amount: fixture.accounting.totals.payable, currency: fixture.accounting.totals.currency } });
  assert.equal(printed.trigger, 'PRINTED');
});

test('customer status projection is monotonic when SIGNED and PRINTED arrive in either order', () => {
  assert.equal(projectCustomerContractStatus('APPROVED', 'SIGNED'), 'SIGNED');
  assert.equal(projectCustomerContractStatus('SIGNED', 'PRINTED'), 'PRINTED');
  assert.equal(projectCustomerContractStatus('PRINTED', 'SIGNED'), 'PRINTED');
  for (const invalid of ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'EXPIRED', 'COMMITTED'] as const) {
    assert.equal(projectCustomerContractStatus(invalid, 'SIGNED'), null);
  }
});

test('cancellation emits only the retained public reason and owner identity', () => {
  const event = buildCaseCancellationEvent({ ...common, reason: 'لغو پرونده پیش از تعهد نهایی' });
  assert.equal(event.type, 'CASE_CANCELLED');
  assert.equal(event.reason, 'لغو پرونده پیش از تعهد نهایی');
  assert.deepEqual(Object.keys(event).sort(), [
    'actorId', 'commandId', 'correlationId', 'effectiveDate', 'eventId', 'owner', 'reason', 'recordedAt', 'schemaVersion', 'type',
  ].sort());
});
