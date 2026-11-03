import assert from 'node:assert/strict';
import { planLocalCheckpointCleanup, planRemoteCheckpointRetention } from '../deploymentCheckpointPolicy';

const artifacts = [
  { id: 'active', createdAt: new Date('2026-08-11'), size: 100, remoteVerified: true, active: true, incidentOpen: false },
  { id: 'latest', createdAt: new Date('2026-08-10'), size: 100, remoteVerified: true, active: false, incidentOpen: false },
  { id: 'second', createdAt: new Date('2026-08-09'), size: 100, remoteVerified: true, active: false, incidentOpen: false },
  { id: 'no-remote', createdAt: new Date('2026-08-08'), size: 100, remoteVerified: false, active: false, incidentOpen: false },
  { id: 'incident', createdAt: new Date('2026-08-07'), size: 100, remoteVerified: true, active: false, incidentOpen: true },
  { id: 'oldest', createdAt: new Date('2026-08-06'), size: 100, remoteVerified: true, active: false, incidentOpen: false },
];

assert.deepEqual(
  planLocalCheckpointCleanup({ artifacts, bytesNeeded: 100, minimumSuccessfulLocal: 2 }).deleteIds,
  ['oldest'],
);
assert.equal(
  planLocalCheckpointCleanup({ artifacts, bytesNeeded: 200, minimumSuccessfulLocal: 2 }).sufficient,
  false,
);

const remoteArtifacts = Array.from({ length: 14 }, (_, index) => ({
  id: `remote-${index}`,
  releaseId: `release-${index}`,
  createdAt: new Date(Date.UTC(2026, 7 - index, 1)),
  size: 100,
  remoteVerified: true,
  active: false,
  incidentOpen: false,
}));
const remotePlan = planRemoteCheckpointRetention(remoteArtifacts);
assert.equal(remotePlan.keepIds.includes('remote-0'), true);
assert.equal(remotePlan.deleteIds.includes('remote-13'), true);
assert.equal(remotePlan.keepIds.length, 12);

console.log('deployment checkpoint policy tests passed');
