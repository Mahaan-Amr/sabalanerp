import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../../../../packages/partner-sales-contracts';
import { createPartnerTelemetry } from '../partnerSales/operations/telemetry';

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
