import assert from 'node:assert/strict';
import {
  acquireDeploymentLease,
  deploymentFailureAction,
  InMemoryDeploymentStore,
  transitionDeployment,
} from '../deploymentControl';

const run = async () => {
  const store = new InMemoryDeploymentStore();
  const now = new Date('2026-08-11T08:00:00.000Z');

  const first = await acquireDeploymentLease(store, {
    deploymentId: 'deploy-1',
    releaseId: 'release-1',
    targetCommit: 'abc123',
    owner: 'operator-1',
    leaseToken: 'lease-1',
    now,
    leaseMs: 60_000,
  });
  assert.equal(first.acquired, true);

  const second = await acquireDeploymentLease(store, {
    deploymentId: 'deploy-2',
    releaseId: 'release-2',
    targetCommit: 'def456',
    owner: 'operator-2',
    leaseToken: 'lease-2',
    now: new Date(now.getTime() + 1_000),
    leaseMs: 60_000,
  });
  assert.equal(second.acquired, false);
  if (second.acquired) throw new Error('Expected active deployment conflict.');
  assert.equal(second.active.deploymentId, 'deploy-1');

  await assert.rejects(
    transitionDeployment(store, {
      deploymentId: 'deploy-1',
      leaseToken: 'lease-1',
      nextPhase: 'MUTATION_STARTED',
      now: new Date(now.getTime() + 2_000),
    }),
    (error: any) => error.code === 'DEPLOYMENT_TRANSITION_INVALID',
  );

  const maintenance = await transitionDeployment(store, {
    deploymentId: 'deploy-1',
    leaseToken: 'lease-1',
    nextPhase: 'MAINTENANCE_REQUESTED',
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(maintenance.phase, 'MAINTENANCE_REQUESTED');

  const expiredStore = new InMemoryDeploymentStore();
  await acquireDeploymentLease(expiredStore, {
    deploymentId: 'expired', releaseId: 'release-old', targetCommit: 'old', owner: 'operator-old',
    leaseToken: 'lease-old', now, leaseMs: 1,
  });
  const deniedTakeover = await acquireDeploymentLease(expiredStore, {
    deploymentId: 'replacement', releaseId: 'release-new', targetCommit: 'new', owner: 'operator-new',
    leaseToken: 'lease-new', now: new Date(now.getTime() + 10), leaseMs: 60_000,
  });
  assert.equal(deniedTakeover.acquired, false);

  const takeover = await acquireDeploymentLease(expiredStore, {
    deploymentId: 'replacement', releaseId: 'release-new', targetCommit: 'new', owner: 'operator-new',
    leaseToken: 'lease-new', now: new Date(now.getTime() + 10), leaseMs: 60_000,
    recoveryPreflightPassed: true,
  });
  assert.equal(takeover.acquired, true);

  for (const phase of ['PREFLIGHT', 'LEASE_ACQUIRED', 'MAINTENANCE_REQUESTED', 'TRAFFIC_BLOCKED', 'SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED'] as const) {
    assert.equal(deploymentFailureAction(phase, false), 'ABORT_AND_REOPEN_PREVIOUS');
  }
  for (const phase of ['MUTATION_STARTED', 'MIGRATIONS_APPLIED', 'RELEASE_STARTED', 'GATES_PASSED', 'TRAFFIC_OPENED'] as const) {
    assert.equal(deploymentFailureAction(phase, false), 'AUTOMATIC_ROLLBACK_ONCE');
  }
  assert.equal(deploymentFailureAction('ROLLBACK_STARTED', true), 'FAIL_CLOSED_RECOVERY_REQUIRED');

  console.log('deployment control tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
