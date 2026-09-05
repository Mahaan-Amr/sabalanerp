import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { planInquiryNotifications } from '../partnerSales/notifications/inquiries';

const load = createRequire(resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract: typeof import('../../../../packages/partner-sales-contracts') = load('@sabalanerp/partner-sales-contracts');
const { FixedTransactionClock } = load('@sabalanerp/partner-sales-contracts/testing');

test('the six-hour warning and expiry use DB time even if no warning job ran', async () => {
  const cause = {
    type: 'EXPIRING' as const, eventId: 'approval-327', correlationId: 'correlation-327',
    occurredAt: '2026-08-25T10:00:00.000Z',
    approval: { approvedAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-27T10:00:00.000Z', superseded: false, terminated: false },
    recipients: [{ audience: 'PARTNER' as const, recipientEvidenceId: 'recipient-327', projectionEvidenceId: 'projection-327' }],
  };
  const clock = new FixedTransactionClock('2026-08-27T03:59:59.999Z');
  assert.deepEqual(await planInquiryNotifications(contract, clock, cause), []);
  clock.advance(1);
  const warning = await planInquiryNotifications(contract, clock, cause);
  assert.equal(warning.length, 1);
  assert.equal(warning[0].notBefore, '2026-08-27T04:00:00.000Z');
  clock.advance(6 * 60 * 60 * 1000);
  assert.deepEqual(await planInquiryNotifications(contract, clock, cause), []);
  const expired = await planInquiryNotifications(contract, clock, { ...cause, type: 'EXPIRED' });
  assert.equal(expired.length, 1);
  assert.equal(expired[0].notBefore, '2026-08-27T10:00:00.000Z');
  assert.deepEqual(await planInquiryNotifications(contract, clock, { ...cause, type: 'EXPIRED', approval: { ...cause.approval, superseded: true } }), []);
  assert.equal(cause.approval.expiresAt, '2026-08-27T10:00:00.000Z');
});

test('a partial response only notifies for committed outcomes, and replay has the same identity', async () => {
  const event = {
    type: 'PARTIAL_RESPONSE' as const, eventId: 'event-327', correlationId: 'correlation-327',
    occurredAt: '2026-08-27T10:00:00.000Z',
    recipients: [{ audience: 'PARTNER' as const, recipientEvidenceId: 'recipient-327', projectionEvidenceId: 'projection-327' }],
    batch: { schemaVersion: 1 as const, commandId: 'command-327', outcomes: [
      { ok: true as const, rowId: 'row-a', outcomeId: 'outcome-a', revision: 2, outcome: 'APPROVED' as const },
      { ok: false as const, rowId: 'row-b', error: contract.partnerError('ROW_STALE') },
    ] },
  };
  const clock = new FixedTransactionClock(event.occurredAt);
  const notices = await planInquiryNotifications(contract, clock, event);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'INQUIRY_DECIDED');
  assert.deepEqual(await planInquiryNotifications(contract, clock, event), notices);
  assert.deepEqual(await planInquiryNotifications(contract, clock, { ...event, batch: {
    ...event.batch, outcomes: [event.batch.outcomes[1]],
  } }), []);
  assert.equal(JSON.stringify(notices).includes('row-a'), false);
});

test('submission and cancellation target responders; reassignment and approval notices use their safe audiences', async () => {
  const cause = {
    eventId: 'inquiry-event-327', correlationId: 'correlation-327', occurredAt: '2026-08-27T10:00:00.000Z',
    recipients: [
      { audience: 'PARTNER' as const, recipientEvidenceId: 'partner-recipient', projectionEvidenceId: 'partner-view' },
      { audience: 'RESPONDER' as const, recipientEvidenceId: 'responder-recipient', projectionEvidenceId: 'responder-view' },
    ],
  };
  const clock = new FixedTransactionClock(cause.occurredAt);
  for (const type of ['SUBMITTED', 'CANCELLED'] as const) {
    const notices = await planInquiryNotifications(contract, clock, { ...cause, type });
    assert.deepEqual(notices.map(notice => notice.recipientEvidenceId), ['responder-recipient']);
    assert.equal(Object.keys(notices[0]).length, 7);
  }
  const notices = await planInquiryNotifications(contract, clock, { ...cause, type: 'REASSIGNED' });
  assert.deepEqual(notices.map(notice => notice.recipientEvidenceId), ['partner-recipient', 'responder-recipient']);
});
