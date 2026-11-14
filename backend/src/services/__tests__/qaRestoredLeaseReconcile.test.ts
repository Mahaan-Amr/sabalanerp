import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaRestoredLeaseEvidence, assertQaSnapshotOperation, expectedSnapshotOperation, QaRestoredLeasePlan } from '../qaRestoredLeaseReconcile';

const h = (c: string) => c.repeat(64);
const id = 'deploy-20261112T133543Z-b58c53c0f88d-release';
const plan = (): QaRestoredLeasePlan => ({ format: 'sabalan-qa-restored-lease-reconcile/v1', qaOnly: true,
  checkpointId: id, checkpointSha256: h('a'), sourceSidecarSha256: h('b'),
  restorePlanSha256: h('c'), restoreReportSha256: h('d'), qaTargetPlanSha256: h('e'),
  productionProofSha256: h('f'), qaKernelBootIdSha256: h('1'), databaseName: 'sabalanerp',
  expected: { id, releaseId: 'old-release', targetCommit: 'b58c53c0f88d2d89da3cb6a45949e6eca97e4308',
    phase: 'SERVICES_DRAINED', startedAt: '2026-11-12T13:35:43.000Z', heartbeatAt: '2026-11-12T13:45:43.000Z',
    leaseExpiresAt: '2026-11-12T13:56:48.213Z', leaseTokenSha256: h('2') },
  receiptPrefix: '/qa-evidence/lease-reconciliation' });
const restore = () => ({ format: 'sabalan-qa-production-state-copy/v1', qaOnly: true, productionAdmission: false,
  status: 'RESTORED', retainedOldState: true, candidateMigrationsApplied: false,
  checkpointId: id, releaseId: 'old-release', sourceObjectSha256: h('a'), sourceSidecarSha256: h('b'),
  qaKernelBootIdSha256: h('1'), sourceMachineUuidSha256: h('5'), sourceObjectSize: 1476223433 });
const proof = () => ({ format: 'sabalan-qa-source-terminal-observation/v1', qaOnly: true,
  sourceHost: { machineIdSha256: h('6'), sourceMachineUuidSha256: h('5'), strictHostKeyChecking: true, batchMode: true },
  sourceDeployment: { id, releaseId: 'old-release', targetCommit: plan().expected.targetCommit,
    phase: 'ABORTED', activeKey: null, completedAt: '2026-11-12T13:45:58.930Z',
    checkpointPresent: true, reportPresent: false, errorCode: null },
  sourceCheckpoint: { id, objectSha256: h('a'), sidecarSha256: h('b'), objectSize: 1476223433 },
  qaRestore: { restorePlanSha256: h('c'), restoreReportSha256: h('d') },
  sourceLeaseReleasedForThisDeployment: true, sourceTerminalAborted: true,
  sourceCaptureNoMutationVerified: true, sourcePostrunJournalVerified: true, noActiveSourceLease: true,
  observation: { productionQueryReadOnly: true, productionMutation: false, qaDatabaseMutation: false },
  observedAt: '2026-11-14T13:00:00.000Z' });

test('accepts exact copied snapshot operation only with bound restore and fresh terminal proof', () => {
  assertQaRestoredLeaseEvidence(plan(), restore(), proof(), new Date('2026-11-14T13:30:00Z'));
  assert.equal(expectedSnapshotOperation(plan()).id, id);
});

test('refuses altered checkpoint, missing no-mutation proof, or stale production observation', () => {
  assert.throws(() => assertQaRestoredLeaseEvidence(plan(), { ...restore(), sourceObjectSha256: h('9') }, proof(), new Date('2026-11-14T13:30:00Z')), /QA_LEASE_RESTORE_MISMATCH/);
  assert.throws(() => assertQaRestoredLeaseEvidence(plan(), restore(), { ...proof(), sourceCaptureNoMutationVerified: false }, new Date('2026-11-14T13:30:00Z')), /QA_LEASE_SOURCE_PROOF_INVALID/);
  assert.throws(() => assertQaRestoredLeaseEvidence(plan(), restore(), proof(), new Date('2026-11-16T13:30:00Z')), /QA_LEASE_SOURCE_PROOF_STALE/);
  assert.throws(() => assertQaRestoredLeaseEvidence(plan(), restore(), {
    ...proof(), sourceHost: { ...proof().sourceHost, sourceMachineUuidSha256: h('9') },
  }, new Date('2026-11-14T13:30:00Z')), /QA_LEASE_SOURCE_PROOF_INVALID/);
});

test('refuses unbound database, row identity, and receipt path', () => {
  assert.throws(() => assertQaRestoredLeaseEvidence({ ...plan(), databaseName: 'postgres' }, restore(), proof(), new Date('2026-11-14T13:30:00Z')), /QA_LEASE_PLAN_INVALID/);
  assert.throws(() => assertQaRestoredLeaseEvidence({ ...plan(), expected: { ...plan().expected, id: 'other' } }, restore(), proof(), new Date('2026-11-14T13:30:00Z')), /QA_LEASE_PLAN_INVALID/);
  assert.throws(() => assertQaRestoredLeaseEvidence({ ...plan(), receiptPrefix: '/app/tmp/receipt' }, restore(), proof(), new Date('2026-11-14T13:30:00Z')), /QA_LEASE_PLAN_INVALID/);
});

test('only the exact expired source row can be reconciled; other active or unresolved operations refuse', () => {
  const row = { id, releaseId: 'old-release', targetCommit: plan().expected.targetCommit,
    phase: 'SERVICES_DRAINED', activeKey: 'production', checkpointJson: null, completedAt: null,
    leaseToken: 'snapshot-lease', startedAt: new Date(plan().expected.startedAt),
    heartbeatAt: new Date(plan().expected.heartbeatAt), leaseExpiresAt: new Date(plan().expected.leaseExpiresAt) };
  const bound = { ...plan(), expected: { ...plan().expected,
    leaseTokenSha256: 'e2997a08b9b61b6e494dc5f05d6874d37dde799fc9a61ae35ad8c54c540df2e3' } };
  assert.equal(assertQaSnapshotOperation(bound, [row], 0, new Date('2026-11-14')).id, id);
  assert.throws(() => assertQaSnapshotOperation(bound, [row, { ...row, id: 'another' }], 0, new Date('2026-11-14')), /QA_LEASE_OTHER_OPERATION/);
  assert.throws(() => assertQaSnapshotOperation(bound, [row], 1, new Date('2026-11-14')), /QA_LEASE_OTHER_OPERATION/);
  assert.throws(() => assertQaSnapshotOperation(bound, [{ ...row, phase: 'MUTATION_STARTED' }], 0, new Date('2026-11-14')), /QA_LEASE_SNAPSHOT_ROW_MISMATCH/);
});
