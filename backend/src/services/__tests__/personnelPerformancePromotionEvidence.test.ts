import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  performancePromotionAttestationMessage,
  performanceRuntimeReleaseIdentityFromEnvironment,
  verifyPerformancePromotionEvidence,
  type PerformancePromotionEvidenceReport,
  type PerformanceRuntimeReleaseIdentity,
} from '../personnelPerformancePromotionEvidence';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';

const release: PerformanceRuntimeReleaseIdentity = {
  commit: 'a'.repeat(40),
  sourceHash: 'b'.repeat(64),
  schemaHash: 'c'.repeat(64),
  policyHash: 'd'.repeat(64),
  infrastructureHash: 'e'.repeat(64),
  images: {
    backend: `sha256:${'1'.repeat(64)}`,
    frontend: `sha256:${'2'.repeat(64)}`,
    inquiry: `sha256:${'3'.repeat(64)}`,
  },
};
const now = new Date('2026-09-09T06:00:00.000Z');
const key = Buffer.alloc(32, 7);
const unsigned = (): Omit<PerformancePromotionEvidenceReport, 'attestation'> => ({
  schemaVersion: 1,
  decision: 'EVIDENCE_COMPLETE',
  productionActivationAuthorized: false,
  manifestHash: 'f'.repeat(64),
  releaseIdentityHash: canonicalPerformanceHash(release),
  release,
  target: {
    phase: 'SUPERVISOR_HR_PILOT',
    cohortVersionId: 'cohort-1',
    cohortStage: 'PILOT',
    membershipHash: '4'.repeat(64),
    readyPopulation: 1,
    memberCount: 1,
  },
  blockers: [],
  gates: [
    'SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT',
    'RESULT_LEVEL_BADGE', 'ANALYTICS_RANKING_CALIBRATION', 'PDF_EXCEL_EXPORT',
    'CONSEQUENCE_HANDOFF', 'EXPANSION_RETIREMENT',
  ].map((name, index) => ({ number: index + 1, name, status: index < 4 ? 'PASS' : 'NOT_REQUIRED' })),
  verifiedAt: new Date(now.getTime() - 60_000).toISOString(),
  validUntil: new Date(now.getTime() + 60_000).toISOString(),
});
const signed = (report = unsigned()): PerformancePromotionEvidenceReport => ({
  ...report,
  attestation: {
    keyId: 'promotion-test-v1',
    algorithm: 'HMAC-SHA256',
    signature: createHmac('sha256', key).update(performancePromotionAttestationMessage(report)).digest('hex'),
  },
});

const releaseEnvironment = {
  PERFORMANCE_RELEASE_COMMIT: release.commit,
  PERFORMANCE_RELEASE_SOURCE_HASH: release.sourceHash,
  PERFORMANCE_RELEASE_SCHEMA_HASH: release.schemaHash,
  PERFORMANCE_RELEASE_POLICY_HASH: release.policyHash,
  PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH: release.infrastructureHash,
  PERFORMANCE_RELEASE_BACKEND_IMAGE: release.images.backend,
  PERFORMANCE_RELEASE_FRONTEND_IMAGE: release.images.frontend,
  PERFORMANCE_RELEASE_INQUIRY_IMAGE: release.images.inquiry,
  PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH: release.infrastructureHash,
  DEPLOYMENT_BACKEND_IMAGE: release.images.backend,
  DEPLOYMENT_FRONTEND_IMAGE: release.images.frontend,
  DEPLOYMENT_INQUIRY_IMAGE: release.images.inquiry,
};
assert.deepEqual(performanceRuntimeReleaseIdentityFromEnvironment(releaseEnvironment), release);
assert.throws(() => performanceRuntimeReleaseIdentityFromEnvironment({
  ...releaseEnvironment, DEPLOYMENT_BACKEND_IMAGE: `sha256:${'9'.repeat(64)}`,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_RELEASE_RUNTIME_IDENTITY_MISMATCH');

assert.doesNotThrow(() => verifyPerformancePromotionEvidence(signed(), {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 1, memberCount: 1, keyId: 'promotion-test-v1', key,
}));

assert.throws(() => verifyPerformancePromotionEvidence(signed({
  ...unsigned(), target: { ...unsigned().target, cohortVersionId: 'unrelated-cohort' },
}), {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 1, memberCount: 1, keyId: 'promotion-test-v1', key,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_PROMOTION_EVIDENCE_UNRELATED');

const tampered = signed();
tampered.release.schemaHash = '9'.repeat(64);
assert.throws(() => verifyPerformancePromotionEvidence(tampered, {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 1, memberCount: 1, keyId: 'promotion-test-v1', key,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_PROMOTION_EVIDENCE_TAMPERED');

const incomplete = unsigned();
incomplete.gates[2].status = 'BLOCKED';
assert.throws(() => verifyPerformancePromotionEvidence(signed(incomplete), {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 1, memberCount: 1, keyId: 'promotion-test-v1', key,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_PROMOTION_EVIDENCE_INCOMPLETE');

assert.throws(() => verifyPerformancePromotionEvidence(signed({
  ...unsigned(), validUntil: new Date(now.getTime() - 1).toISOString(),
}), {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 1, memberCount: 1, keyId: 'promotion-test-v1', key,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_PROMOTION_EVIDENCE_STALE');

assert.throws(() => verifyPerformancePromotionEvidence(signed(), {
  now, release, phase: 'SUPERVISOR_HR_PILOT', cohortVersionId: 'cohort-1', cohortStage: 'PILOT',
  membershipHash: '4'.repeat(64), readyPopulation: 2, memberCount: 1, keyId: 'promotion-test-v1', key,
}), (error: { code?: string }) => error.code === 'PERFORMANCE_PROMOTION_EVIDENCE_POPULATION_CHANGED');

console.log('Personnel performance promotion evidence tests passed.');
