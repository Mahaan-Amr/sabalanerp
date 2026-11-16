import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaProductionStateRestorePlan } from '../qaProductionStateRestorePlan';

const hash = (character: string) => character.repeat(64);
const plan = () => ({
  format: 'sabalan-qa-production-state-restore/v2', qaOnly: true, retainedOldState: true,
  previousCommit: 'b58c53c0f88d2d89da3cb6a45949e6eca97e4308',
  previousImages: Object.fromEntries(['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'].map(role => [role, `sha256:${hash('a')}`])),
  sourceMigrationLedger: { successful: 439, rolledBack: 1, latest: '20261017100000_attendance_review_and_clock' },
  rawInquirySha256: hash('f'),
  checkpointId: 'deploy-20261112T133543Z-b58c53c0f88d-release',
  databaseName: 'sabalanerp',
  qaTargetPlanSha256: hash('e'),
  sourceObject: { path: '/qa-checkpoint/deploy-20261112T133543Z-b58c53c0f88d-release.sabrec', sha256: hash('a'), size: 1476223433 },
  sourceSidecar: { path: '/qa-checkpoint/deploy-20261112T133543Z-b58c53c0f88d-release.sabrec.json', sha256: hash('b') },
  runSidecarPath: '/qa-evidence/checkpoint.json', reportPath: '/qa-evidence/restore-report.json',
});
const metadata = () => ({ id: plan().checkpointId, deploymentId: plan().checkpointId, releaseId: 'previous',
  manifest: { commit: plan().previousCommit }, targetCommit: plan().previousCommit,
  rollbackReleaseSet: plan().previousImages,
  remotePath: '/remote/original.sabrec', checksum: hash('a'), size: 1476223433, remoteVerified: true,
  sourceMachineUuidSha256: hash('c'), sourceKernelBootIdSha256: hash('d'), independentRestoreVerified: false });

test('accepts a distinct QA run sidecar with only the archive path rewritten', () => {
  assertQaProductionStateRestorePlan(plan(), metadata(), { ...metadata(), remotePath: plan().sourceObject.path });
});

test('refuses source metadata changes and drill qualification fields', () => {
  assert.throws(() => assertQaProductionStateRestorePlan(plan(), metadata(), { ...metadata(), remotePath: plan().sourceObject.path, size: 1 }), /QA_RESTORE_SIDECAR_CHANGED/);
  assert.throws(() => assertQaProductionStateRestorePlan(plan(), { ...metadata(), independentRestoreVerified: true }, { ...metadata(), remotePath: plan().sourceObject.path }), /QA_RESTORE_DRILL_ELIGIBILITY_FORBIDDEN/);
});

test('refuses paths outside QA mounts and an unscoped plan', () => {
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), sourceObject: { ...plan().sourceObject, path: '/app/storage/recovery/source.sabrec' } }, metadata(), { ...metadata(), remotePath: plan().sourceObject.path }), /QA_RESTORE_PLAN_INVALID/);
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), qaOnly: false }, metadata(), { ...metadata(), remotePath: plan().sourceObject.path }), /QA_RESTORE_PLAN_INVALID/);
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), qaTargetPlanSha256: 'unbound' }, metadata(), { ...metadata(), remotePath: plan().sourceObject.path }), /QA_RESTORE_PLAN_INVALID/);
});

test('retained-old-state plan refuses missing mode, old commit mismatch and a mutable prior image', () => {
  const run = { ...metadata(), remotePath: plan().sourceObject.path };
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), retainedOldState: false }, metadata(), run), /QA_RESTORE_PLAN_INVALID/);
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), previousCommit: hash('f').slice(0, 40) }, metadata(), run), /QA_RESTORE_SOURCE_INVALID/);
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), previousImages: { ...plan().previousImages, inquiry: 'sabalanerp-inquiry:current' } }, metadata(), run), /QA_RESTORE_PLAN_INVALID/);
  assert.throws(() => assertQaProductionStateRestorePlan({ ...plan(), previousImages: { ...plan().previousImages, inquiry: `sha256:${hash('b')}` } }, metadata(), run), /QA_RESTORE_SOURCE_INVALID/);
});
