import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PerformanceRolloutPhase } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';

export type PerformanceCohortStage = 'PILOT' | 'TEN_PERCENT' | 'TWENTY_FIVE_PERCENT' | 'FIFTY_PERCENT' | 'ALL';
export type PerformanceRuntimeReleaseIdentity = {
  commit: string;
  sourceHash: string;
  schemaHash: string;
  policyHash: string;
  infrastructureHash: string;
  images: { backend: string; frontend: string; inquiry: string };
};
export type PerformancePromotionEvidenceReport = {
  schemaVersion: 1;
  decision: 'EVIDENCE_COMPLETE' | 'BLOCKED';
  productionActivationAuthorized: false;
  manifestHash: string;
  releaseIdentityHash: string;
  release: PerformanceRuntimeReleaseIdentity;
  target: {
    phase: PerformanceRolloutPhase;
    cohortVersionId: string;
    cohortStage: PerformanceCohortStage;
    membershipHash: string;
    readyPopulation: number;
    memberCount: number;
  };
  blockers: string[];
  gates: Array<{ number: number; name: string; status: 'PASS' | 'BLOCKED' | 'NOT_REQUIRED' }>;
  verifiedAt: string;
  validUntil: string;
  attestation: { keyId: string; algorithm: 'HMAC-SHA256'; signature: string };
};

const phases: PerformanceRolloutPhase[] = [
  'SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT',
  'RESULT_LEVEL_BADGE', 'ANALYTICS_RANKING_CALIBRATION', 'PDF_EXCEL_EXPORT',
  'CONSEQUENCE_HANDOFF', 'EXPANSION_RETIREMENT',
];
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const imageDigest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const exactDeploymentDigest = (value: string) => value.startsWith('sha256:') ? value : value.match(/@?(sha256:[a-f0-9]{64})$/)?.[1] ?? '';
const targetPopulationIsValid = (stage: PerformanceCohortStage, readyPopulation: number, memberCount: number) => {
  if (!Number.isSafeInteger(readyPopulation) || readyPopulation < 1 || !Number.isSafeInteger(memberCount)
    || memberCount < 1 || memberCount > readyPopulation) return false;
  if (stage === 'PILOT') return memberCount >= Math.min(10, readyPopulation) && memberCount <= Math.min(25, readyPopulation);
  const percent: Record<Exclude<PerformanceCohortStage, 'PILOT'>, number> = {
    TEN_PERCENT: 10, TWENTY_FIVE_PERCENT: 25, FIFTY_PERCENT: 50, ALL: 100,
  };
  return memberCount === Math.ceil(readyPopulation * percent[stage] / 100);
};
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
  return JSON.stringify(value);
};
const evidenceError = (code: string) => Object.assign(
  new Error('بسته شواهد ارتقای عملکرد معتبر، کامل و منطبق با نسخه جاری نیست.'),
  { code, status: 409 },
);

export const performancePromotionAttestationMessage = (
  report: Omit<PerformancePromotionEvidenceReport, 'attestation'>,
) => stableJson(report);

const validRelease = (release: PerformanceRuntimeReleaseIdentity) => Boolean(release)
  && /^[a-f0-9]{40}$/.test(release.commit)
  && digest(release.sourceHash) && digest(release.schemaHash) && digest(release.policyHash) && digest(release.infrastructureHash)
  && imageDigest(release.images?.backend) && imageDigest(release.images?.frontend) && imageDigest(release.images?.inquiry);

export const verifyPerformancePromotionEvidence = (report: PerformancePromotionEvidenceReport, expected: {
  now: Date;
  release: PerformanceRuntimeReleaseIdentity;
  phase: PerformanceRolloutPhase;
  cohortVersionId: string;
  cohortStage: PerformanceCohortStage;
  membershipHash: string;
  readyPopulation: number;
  memberCount: number;
  keyId: string;
  key: Buffer;
}) => {
  const attestation = report?.attestation;
  if (!attestation || attestation.keyId !== expected.keyId || attestation.algorithm !== 'HMAC-SHA256'
    || !digest(attestation.signature) || expected.key.length < 32) throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_TAMPERED');
  const { attestation: _ignored, ...unsigned } = report;
  const actual = Buffer.from(attestation.signature, 'hex');
  const calculated = createHmac('sha256', expected.key).update(performancePromotionAttestationMessage(unsigned)).digest();
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) {
    throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_TAMPERED');
  }
  if (report.schemaVersion !== 1 || report.decision !== 'EVIDENCE_COMPLETE' || report.productionActivationAuthorized !== false
    || !Array.isArray(report.blockers) || report.blockers.length !== 0
    || !digest(report.manifestHash) || !validRelease(report.release)
    || report.releaseIdentityHash !== canonicalPerformanceHash(report.release)) {
    throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_INCOMPLETE');
  }
  if (stableJson(report.release) !== stableJson(expected.release)) throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_RELEASE_CHANGED');
  if (report.target.phase !== expected.phase || report.target.cohortVersionId !== expected.cohortVersionId
    || report.target.cohortStage !== expected.cohortStage || report.target.membershipHash !== expected.membershipHash) {
    throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_UNRELATED');
  }
  if (!targetPopulationIsValid(report.target.cohortStage, report.target.readyPopulation, report.target.memberCount)
    || report.target.readyPopulation !== expected.readyPopulation || report.target.memberCount !== expected.memberCount) {
    throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_POPULATION_CHANGED');
  }
  const targetIndex = phases.indexOf(expected.phase);
  const exactGateSet = report.gates.length === phases.length && phases.every((phase, index) => {
    const matches = report.gates.filter(({ name }) => name === phase);
    return matches.length === 1 && matches[0].number === index + 1
      && matches[0].status === (index <= targetIndex ? 'PASS' : 'NOT_REQUIRED');
  });
  if (targetIndex < 0 || !exactGateSet) throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_INCOMPLETE');
  const verifiedAt = Date.parse(report.verifiedAt);
  const validUntil = Date.parse(report.validUntil);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(validUntil) || verifiedAt > expected.now.getTime()
    || expected.now.getTime() - verifiedAt > MAX_EVIDENCE_AGE_MS || validUntil <= expected.now.getTime()
    || validUntil <= verifiedAt || validUntil - verifiedAt > MAX_EVIDENCE_AGE_MS) throw evidenceError('PERFORMANCE_PROMOTION_EVIDENCE_STALE');
  return { evidenceHash: canonicalPerformanceHash(unsigned), targetGate: targetIndex + 1 };
};

export const performancePromotionAttestationKeyFromEnvironment = (environment: NodeJS.ProcessEnv = process.env) => {
  const keyId = environment.PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID?.trim() ?? '';
  const encoded = environment.PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64?.trim() ?? '';
  const key = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  if (!keyId || /^(change|replace|example|placeholder|local)/i.test(keyId) || key.length < 32
    || key.toString('base64') !== encoded.replace(/\s/g, '')) throw evidenceError('PERFORMANCE_PROMOTION_ATTESTATION_CONFIGURATION_INVALID');
  return { keyId, key };
};

export const performanceRuntimeReleaseIdentityFromEnvironment = (environment: NodeJS.ProcessEnv = process.env): PerformanceRuntimeReleaseIdentity => {
  const release = {
    commit: environment.PERFORMANCE_RELEASE_COMMIT?.trim() ?? '',
    sourceHash: environment.PERFORMANCE_RELEASE_SOURCE_HASH?.trim() ?? '',
    schemaHash: environment.PERFORMANCE_RELEASE_SCHEMA_HASH?.trim() ?? '',
    policyHash: environment.PERFORMANCE_RELEASE_POLICY_HASH?.trim() ?? '',
    infrastructureHash: environment.PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH?.trim() ?? '',
    images: {
      backend: environment.PERFORMANCE_RELEASE_BACKEND_IMAGE?.trim() ?? '',
      frontend: environment.PERFORMANCE_RELEASE_FRONTEND_IMAGE?.trim() ?? '',
      inquiry: environment.PERFORMANCE_RELEASE_INQUIRY_IMAGE?.trim() ?? '',
    },
  };
  if (!validRelease(release)) throw evidenceError('PERFORMANCE_RELEASE_IDENTITY_UNAVAILABLE');
  const deployed = {
    backend: exactDeploymentDigest(environment.DEPLOYMENT_BACKEND_IMAGE?.trim() ?? ''),
    frontend: exactDeploymentDigest(environment.DEPLOYMENT_FRONTEND_IMAGE?.trim() ?? ''),
    inquiry: exactDeploymentDigest(environment.DEPLOYMENT_INQUIRY_IMAGE?.trim() ?? ''),
  };
  const runtimeInfrastructureHash = environment.PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH?.trim() ?? '';
  if (!imageDigest(deployed.backend) || !imageDigest(deployed.frontend) || !imageDigest(deployed.inquiry)
    || deployed.backend !== release.images.backend || deployed.frontend !== release.images.frontend
    || deployed.inquiry !== release.images.inquiry || !digest(runtimeInfrastructureHash)
    || runtimeInfrastructureHash !== release.infrastructureHash) {
    throw evidenceError('PERFORMANCE_RELEASE_RUNTIME_IDENTITY_MISMATCH');
  }
  return release;
};
