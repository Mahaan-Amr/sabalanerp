import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && !Number.isNaN(Date.parse(value));

export type QaRestoredLeasePlan = {
  format: 'sabalan-qa-restored-lease-reconcile/v1'; qaOnly: true;
  checkpointId: string; checkpointSha256: string; sourceSidecarSha256: string;
  restorePlanSha256: string; restoreReportSha256: string; qaTargetPlanSha256: string;
  productionProofSha256: string; qaKernelBootIdSha256: string; databaseName: string;
  expected: { id: string; releaseId: string; targetCommit: string; phase: 'SERVICES_DRAINED';
    startedAt: string; heartbeatAt: string; leaseExpiresAt: string; leaseTokenSha256: string };
  receiptPrefix: string;
};

export type QaSourceTerminalProof = {
  format: 'sabalan-qa-source-terminal-observation/v1'; qaOnly: true; observedAt: string;
  sourceHost: { machineIdSha256: string; sourceMachineUuidSha256: string;
    strictHostKeyChecking: true; batchMode: true };
  sourceDeployment: { id: string; releaseId: string; targetCommit: string; phase: 'ABORTED'; activeKey: null;
    completedAt: string; checkpointPresent: true; reportPresent: false; errorCode: null };
  sourceCheckpoint: { id: string; objectSha256: string; sidecarSha256: string; objectSize: number };
  qaRestore: { restorePlanSha256: string; restoreReportSha256: string };
  sourceLeaseReleasedForThisDeployment: true; sourceTerminalAborted: true;
  sourceCaptureNoMutationVerified: true; sourcePostrunJournalVerified: true; noActiveSourceLease: true;
  observation: { productionQueryReadOnly: true; productionMutation: false; qaDatabaseMutation: false };
};

export function expectedSnapshotOperation(untrusted: unknown): QaRestoredLeasePlan['expected'] {
  const plan = untrusted as QaRestoredLeasePlan;
  if (!plan || plan.format !== 'sabalan-qa-restored-lease-reconcile/v1' || plan.qaOnly !== true
    || !/^deploy-[a-zA-Z0-9-]+-release$/.test(plan.checkpointId || '')
    || !/^(sabalanerp|sabalanerp_qa_[a-z0-9_]+)$/.test(plan.databaseName || '')
    || ![plan.checkpointSha256, plan.sourceSidecarSha256, plan.restorePlanSha256,
      plan.restoreReportSha256, plan.qaTargetPlanSha256, plan.productionProofSha256,
      plan.qaKernelBootIdSha256].every(sha)
    || !plan.expected || plan.expected.id !== plan.checkpointId
    || !plan.expected.releaseId || !/^[a-f0-9]{40}$/.test(plan.expected.targetCommit || '')
    || plan.expected.phase !== 'SERVICES_DRAINED'
    || ![plan.expected.startedAt, plan.expected.heartbeatAt, plan.expected.leaseExpiresAt].every(iso)
    || !sha(plan.expected.leaseTokenSha256)
    || plan.receiptPrefix !== '/qa-evidence/lease-reconciliation'
    || path.posix.normalize(plan.receiptPrefix) !== plan.receiptPrefix) fail('QA_LEASE_PLAN_INVALID');
  return plan.expected;
}

/** Admission for a single snapshot-time source row in an isolated QA copy. */
export function assertQaRestoredLeaseEvidence(
  untrustedPlan: unknown, untrustedRestore: unknown, untrustedProof: unknown, now: Date,
): asserts untrustedPlan is QaRestoredLeasePlan {
  const expected = expectedSnapshotOperation(untrustedPlan);
  const plan = untrustedPlan as QaRestoredLeasePlan;
  const restore = untrustedRestore as Record<string, unknown>;
  if (!restore || restore.format !== 'sabalan-qa-production-state-copy/v1' || restore.qaOnly !== true
    || restore.productionAdmission !== false || restore.status !== 'RESTORED'
    || restore.retainedOldState !== true || restore.candidateMigrationsApplied !== false
    || restore.checkpointId !== plan.checkpointId || restore.releaseId !== expected.releaseId
    || restore.sourceObjectSha256 !== plan.checkpointSha256
    || restore.sourceSidecarSha256 !== plan.sourceSidecarSha256
    || restore.qaKernelBootIdSha256 !== plan.qaKernelBootIdSha256) fail('QA_LEASE_RESTORE_MISMATCH');
  const proof = untrustedProof as QaSourceTerminalProof;
  if (!proof || proof.format !== 'sabalan-qa-source-terminal-observation/v1' || proof.qaOnly !== true
    || proof.sourceDeployment?.id !== expected.id || proof.sourceDeployment.releaseId !== expected.releaseId
    || proof.sourceDeployment.targetCommit !== expected.targetCommit
    || proof.sourceDeployment.phase !== 'ABORTED' || proof.sourceDeployment.activeKey !== null
    || !iso(proof.sourceDeployment.completedAt) || proof.sourceDeployment.checkpointPresent !== true
    || proof.sourceDeployment.reportPresent !== false || proof.sourceDeployment.errorCode !== null
    || proof.sourceCheckpoint?.id !== plan.checkpointId
    || proof.sourceCheckpoint.objectSha256 !== plan.checkpointSha256
    || proof.sourceCheckpoint.sidecarSha256 !== plan.sourceSidecarSha256
    || proof.qaRestore?.restorePlanSha256 !== plan.restorePlanSha256
    || proof.qaRestore.restoreReportSha256 !== plan.restoreReportSha256
    || !sha(proof.sourceHost?.machineIdSha256)
    || proof.sourceHost.sourceMachineUuidSha256 !== restore.sourceMachineUuidSha256
    || proof.sourceHost.strictHostKeyChecking !== true || proof.sourceHost.batchMode !== true
    || proof.sourceCheckpoint.objectSize !== restore.sourceObjectSize
    || proof.sourceLeaseReleasedForThisDeployment !== true || proof.sourceTerminalAborted !== true
    || proof.sourceCaptureNoMutationVerified !== true || proof.sourcePostrunJournalVerified !== true
    || proof.noActiveSourceLease !== true || proof.observation?.productionQueryReadOnly !== true
    || proof.observation.productionMutation !== false || proof.observation.qaDatabaseMutation !== false
    || !iso(proof.observedAt)) {
    fail('QA_LEASE_SOURCE_PROOF_INVALID');
  }
  const age = now.getTime() - Date.parse(proof.observedAt);
  if (age < 0 || age > 24 * 60 * 60 * 1000) fail('QA_LEASE_SOURCE_PROOF_STALE');
  if (Date.parse(proof.sourceDeployment.completedAt) < Date.parse(expected.startedAt)
    || Date.parse(proof.sourceDeployment.completedAt) > Date.parse(proof.observedAt)
    || Date.parse(expected.leaseExpiresAt) <= Date.parse(proof.sourceDeployment.completedAt)) {
    fail('QA_LEASE_CAPTURE_ORDER_INVALID');
  }
}

type CopiedOperation = { id: string; releaseId: string; targetCommit: string; phase: string;
  activeKey: string | null; checkpointJson: unknown; completedAt: Date | null; leaseToken: string;
  startedAt: Date; heartbeatAt: Date; leaseExpiresAt: Date };

export function assertQaSnapshotOperation<T extends CopiedOperation>(
  plan: QaRestoredLeasePlan, activeRows: T[], unresolvedCount: number, now: Date,
): T {
  if (activeRows.length !== 1 || activeRows[0].id !== plan.expected.id || unresolvedCount !== 0) {
    fail('QA_LEASE_OTHER_OPERATION');
  }
  const row = activeRows[0];
  if (row.releaseId !== plan.expected.releaseId || row.targetCommit !== plan.expected.targetCommit
    || row.phase !== plan.expected.phase || row.activeKey !== 'production'
    || row.checkpointJson !== null || row.completedAt !== null
    || row.startedAt.getTime() !== Date.parse(plan.expected.startedAt)
    || row.heartbeatAt.getTime() !== Date.parse(plan.expected.heartbeatAt)
    || row.leaseExpiresAt.getTime() !== Date.parse(plan.expected.leaseExpiresAt)
    || createHash('sha256').update(row.leaseToken).digest('hex') !== plan.expected.leaseTokenSha256
    || row.leaseExpiresAt.getTime() >= now.getTime()) fail('QA_LEASE_SNAPSHOT_ROW_MISMATCH');
  return row;
}
