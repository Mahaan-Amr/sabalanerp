import assert from 'node:assert/strict';
import { readContractCancellationEvidence, resolveContractReactivationStatus } from '../contractCancellationPolicy';

const signatures = {
  confirmation: { verifiedAt: '2026-09-20T10:00:00.000Z' },
  cancellation: {
    previousStatus: 'SIGNED',
    reportingEventSourceKey: 'cancellation:contract-1',
    at: '2026-09-21T10:00:00.000Z'
  }
};

assert.equal(resolveContractReactivationStatus(signatures), 'SIGNED');
assert.deepEqual(readContractCancellationEvidence(signatures), signatures.cancellation);
assert.equal(resolveContractReactivationStatus({ cancellation: { previousStatus: 'CANCELLED' } }), null);
assert.equal(resolveContractReactivationStatus({ cancellation: { previousStatus: 'UNKNOWN' } }), null);
assert.equal(resolveContractReactivationStatus(null), null);

console.log('contract cancellation policy tests passed');
