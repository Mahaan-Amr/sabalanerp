import assert from 'node:assert/strict';
import test from 'node:test';
import { captureRecoveryAllocationAuthority, assertRecoveryAllocationContinuity } from '../systemRecoveryAllocationAuthority';

const runtime = { role: 'sabalan_application_runtime', commit: 'a'.repeat(40), releaseId: 'release-current', admitted: false };
const closed = { control: [{ id: 'grouped-allocation', state: 'CLOSED' }], audit: [], activation: [] };
const manifest = 'c'.repeat(64);
const active = { control: [{ id: 'grouped-allocation', state: 'ACTIVE', deployment_id: 'deployment-original',
  release_id: runtime.releaseId, manifest_sha256: manifest, activated_at: '2026-11-17T00:00:00' }],
  audit: [{ event: 'ACTIVATED', deployment_id: 'deployment-original', release_id: runtime.releaseId,
    manifest_sha256: manifest, recorded_at: '2026-11-17T00:00:00' }],
  activation: [{ id: 'deployment-original', phase: 'COMPLETED', targetCommit: runtime.commit, releaseId: runtime.releaseId }] };

test('an archive cannot reactivate the current closed allocation policy', () => {
  const trusted = captureRecoveryAllocationAuthority(closed, runtime);
  assertRecoveryAllocationContinuity(trusted, closed, runtime);
  assert.throws(() => assertRecoveryAllocationContinuity(trusted, active, { ...runtime, admitted: true }));
});

test('current active authority survives older business data only with the same runtime and authority proof', () => {
  const admitted = { ...runtime, admitted: true };
  const trusted = captureRecoveryAllocationAuthority(active, admitted);
  assertRecoveryAllocationContinuity(trusted, active, admitted);
  assert.throws(() => assertRecoveryAllocationContinuity(trusted, closed, runtime));
  assert.throws(() => assertRecoveryAllocationContinuity(trusted, active, { ...admitted, commit: 'b'.repeat(40) }));
  assert.throws(() => assertRecoveryAllocationContinuity(trusted, active, { ...admitted, admitted: false }));
});
