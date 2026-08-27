import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../../../../packages/partner-sales-contracts';
import { createPartnerTelemetry } from '../partnerSales/operations/telemetry';
import { createRequire } from 'node:module';
const { createPartnerFixtures } = createRequire(require.resolve('../../../../packages/partner-sales-contracts/package.json'))('@sabalanerp/partner-sales-contracts/testing');

test('telemetry projects allowlisted fields and pseudonymizes all caller-controlled identifiers', () => {
  const telemetry = createPartnerTelemetry(contract, 'test-only-333-key-material-32-bytes-minimum');
  const record = telemetry.project({ metric: 'JOB_RETRY', outcome: 'RETRY', correlationId: 'otp-123456-secret',
    evidenceId: 'private-wholesale-9000', subjectId: 'customer-phone-09121234567', value: 3,
    payload: { token: 'bearer-secret', wholesale: '9000' } } as any);
  const json = JSON.stringify(record);
  for (const secret of ['123456', '9000', '09121234567', 'bearer', 'payload', 'wholesale']) assert.equal(json.includes(secret), false);
  assert.equal(record.severity, 'ALERT');
  assert.equal(record.value, 3);
  assert.throws(() => telemetry.project({ metric: 'arbitrary-secret', outcome: 'FAILURE' } as any));
});

test('domain events expose no financial payload, and financial numeric telemetry is rejected', () => {
  const telemetry = createPartnerTelemetry(contract, 'test-only-333-key-material-32-bytes-minimum');
  const fixture = createPartnerFixtures();
  const record = telemetry.event({ schemaVersion: 1, eventId: 'event-333', commandId: 'command-333', correlationId: 'trace-333',
    actorId: 'actor-333', recordedAt: '2026-08-27T08:00:00.000Z', effectiveDate: '2026-08-27', owner: fixture.case.head,
    type: 'CASE_COMMITTED', internalRecordId: 'private-record-333', trigger: 'SIGNED', salesCreditOwnerId: 'seller-333',
    sabalanNetAmount: { amount: '987654321', currency: 'IRR' } });
  assert.equal(record.eventType, 'CASE_COMMITTED');
  for (const secret of ['987654321', 'IRR', 'private-record', 'actor-333', 'seller-333', 'sabalanNetAmount']) assert.equal(JSON.stringify(record).includes(secret), false);
  assert.throws(() => telemetry.project({ metric: 'FINANCIAL_RECONCILIATION', outcome: 'HEALTHY', value: 987654321,
    correlationId: 'trace-333', subjectId: 'case-333', evidenceId: 'evidence-333' }));
});

test('healthy conflict/retry/denial never becomes a critical incident and confirmed faults require matching evidence category', () => {
  const telemetry = createPartnerTelemetry(contract, 'test-only-333-key-material-32-bytes-minimum');
  const refs = { correlationId: 'trace-333', subjectId: 'case-333', evidenceId: 'evidence-333' };
  for (const outcome of ['RETRY', 'DENIED', 'CONFLICT', 'DELAY', 'FAILURE'] as const) {
    assert.equal(telemetry.project({ ...refs, metric: 'IDEMPOTENCY', outcome }).severity, 'ALERT');
  }
  assert.throws(() => telemetry.project({ ...refs, metric: 'IDEMPOTENCY', outcome: 'CONFIRMED_VIOLATION', category: 'PAIR_INCOMPLETE' }));
  assert.equal(telemetry.project({ ...refs, metric: 'IDEMPOTENCY', outcome: 'CONFIRMED_VIOLATION', category: 'DUPLICATE_COMMITMENT' }).severity, 'INCIDENT');
});
