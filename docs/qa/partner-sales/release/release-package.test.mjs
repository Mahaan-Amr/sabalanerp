import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTANCE_RESPONSIBILITIES,
  READINESS_GATES,
  evaluateReleasePackage,
} from './release-package.mjs';

const imageDigest = `sha256:${'2'.repeat(64)}`;
const commit = '3d4a487e5a629741a8159458e2cfef059e4c55c0';
const tree = 'e8a21e56dbe58a8ec04543d88f338d61db6522e6';
const schemaId = 'partner-schema-v1';
const migrationSetSha256 = '8d3232f9323d89bd5abbbb00a838176cd1dca6b2a56ef86f9cd44ddf5e9b902a';
const claimNames = [
  'schema:migration-set',
  'checkpoint:remote-readback',
  ...READINESS_GATES.map(name => `gate:${name}`),
  ...ACCEPTANCE_RESPONSIBILITIES.map(role => `approval:${role}`),
];
const trustedClaims = Object.fromEntries(claimNames.map((name, index) => [
  name, (index + 1).toString(16).padStart(64, '0'),
]));
const releaseIdentity = {
  releaseId: 'partner-release-3d4a487e',
  releaseSet: {
    backend: imageDigest,
    frontend: imageDigest,
    inquiry: imageDigest,
    nginx: imageDigest,
    supporting: [imageDigest],
  },
  deploymentFormat: { name: 'sabalan-deployment-report', version: 1 },
  checkpointFormat: { name: 'sabalan-checkpoint-manifest', version: 1 },
};

const expectedIdentity = overrides => ({
  now: '2026-09-05T08:05:00.000Z',
  expectedCommit: commit,
  expectedTree: tree,
  expectedSchemaId: schemaId,
  releaseIdentity,
  trustedClaims,
  ...overrides,
});

const attestation = (reference, claim) => ({
  source: 'SIGNED_ATTESTATION',
  reference,
  digestSha256: trustedClaims[claim],
  candidateCommit: commit,
  candidateTree: tree,
  schemaId,
  checkedAt: '2026-09-05T08:00:00.000Z',
  expiresAt: '2026-09-05T08:15:00.000Z',
});

const acceptedCandidate = {
  format: 'sabalan-partner-release-package',
  version: 1,
  candidate: {
    releaseId: 'partner-release-3d4a487e',
    commit,
    tree,
    qaIssue: 335,
    qaRunId: 'partner-qa-1d5cfb40-b10f-4889-a7a7-d0a99f4f7708',
    interfacePackage: '@sabalanerp/partner-sales-contracts',
    interfaceVersion: '1.9.0',
    wireSchemaVersion: 1,
    schemaId,
    migrationCount: 223,
    migrationSetSha256,
    releaseSet: releaseIdentity.releaseSet,
    deploymentFormat: releaseIdentity.deploymentFormat,
    checkpointFormat: releaseIdentity.checkpointFormat,
  },
  evaluatedAt: '2026-09-05T08:00:00.000Z',
  expiresAt: '2026-09-05T08:15:00.000Z',
  schemaVerification: {
    status: 'MATCH',
    repositoryMigrationCount: 223,
    runtimeAppliedMigrationCount: 223,
    repositoryMigrationSetSha256: migrationSetSha256,
    runtimeMigrationSetSha256: migrationSetSha256,
    evidence: attestation('schema/audit/reference', 'schema:migration-set'),
  },
  remoteCheckpoint: {
    status: 'REMOTE_READBACK_VERIFIED',
    releaseId: 'partner-release-3d4a487e',
    candidateCommit: commit,
    candidateTree: tree,
    schemaId,
    archiveSha256: '3'.repeat(64),
    remoteFingerprintSha256: '3'.repeat(64),
    sidecarSha256: '5'.repeat(64),
    verifiedAt: '2026-09-05T08:00:00.000Z',
    expiresAt: '2026-09-05T08:15:00.000Z',
    evidenceReference: 'remote/checkpoint/readback-attestation',
    evidenceDigestSha256: trustedClaims['checkpoint:remote-readback'],
  },
  gates: Object.fromEntries(READINESS_GATES.map(name => [name, {
    status: 'PASS', evidence: [attestation(`evidence/${name}`, `gate:${name}`)],
  }])),
  approvals: Object.fromEntries(ACCEPTANCE_RESPONSIBILITIES.map(role => [role, {
    status: 'APPROVED',
    actorId: `actor-${role.toLowerCase()}`,
    authenticationRef: `identity-${role.toLowerCase()}`,
    issuedAt: '2026-09-05T08:00:00.000Z',
    expiresAt: '2026-09-05T08:15:00.000Z',
    candidateCommit: commit,
    candidateTree: tree,
    schemaId,
    evidenceReference: `approval/${role.toLowerCase()}`,
    evidenceDigestSha256: trustedClaims[`approval:${role}`],
  }])),
  activation: { requested: false, trafficOpened: false, realSmsEnabled: false },
};

test('authorizes only a trusted fresh package for the exact immutable candidate and remote checkpoint', () => {
  assert.deepEqual(evaluateReleasePackage(acceptedCandidate, expectedIdentity()), {
    decision: 'GO', blockers: [],
  });
});

test('fails closed for a failed gate and pending approval without allowing signatures to cover the gate', () => {
  const input = structuredClone(acceptedCandidate);
  input.gates.noOpenReleaseDefects.status = 'FAIL';
  input.approvals.TECH_SECURITY = { status: 'PENDING' };
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO', blockers: ['gate:noOpenReleaseDefects:FAIL', 'approval:TECH_SECURITY:PENDING'],
  });
});

test('fails closed on candidate drift, stale evidence, unsafe activation, or an incomplete manifest', () => {
  const drifted = structuredClone(acceptedCandidate);
  drifted.candidate.commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.match(evaluateReleasePackage(drifted, expectedIdentity()).blockers.join('\n'), /candidate:commit:mismatch/);
  assert.match(evaluateReleasePackage(acceptedCandidate, expectedIdentity({ now: acceptedCandidate.expiresAt })).blockers.join('\n'), /evidence:expired/);

  const unsafe = structuredClone(acceptedCandidate);
  unsafe.activation.trafficOpened = true;
  assert.match(evaluateReleasePackage(unsafe, expectedIdentity()).blockers.join('\n'), /activation:already-mutated/);

  const incomplete = structuredClone(acceptedCandidate);
  delete incomplete.gates.recoveryDrill;
  assert.match(evaluateReleasePackage(incomplete, expectedIdentity()).blockers.join('\n'), /gate:recoveryDrill:MISSING/);
});

test('fails closed when runtime migration content does not belong to the frozen candidate', () => {
  const input = structuredClone(acceptedCandidate);
  input.schemaVerification.status = 'MISMATCH';
  input.schemaVerification.runtimeAppliedMigrationCount = 244;
  input.schemaVerification.runtimeMigrationSetSha256 = '6'.repeat(64);
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO', blockers: ['candidate:schema-evidence:MISMATCH'],
  });
});

test('fails closed without a complete immutable image set and remote read-back evidence', () => {
  const input = structuredClone(acceptedCandidate);
  delete input.candidate.releaseSet.nginx;
  input.remoteCheckpoint.status = 'LOCAL_ONLY';
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO',
    blockers: ['candidate:release-set:invalid', 'checkpoint:remote-readback:LOCAL_ONLY'],
  });
});

test('fails closed for untrusted gate evidence and stale or other-candidate approval', () => {
  const input = structuredClone(acceptedCandidate);
  input.gates.atomicCase.evidence[0].digestSha256 = '7'.repeat(64);
  input.approvals.SALES.candidateCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO',
    blockers: ['gate:atomicCase:EVIDENCE_UNVERIFIED', 'approval:SALES:EVIDENCE_UNVERIFIED'],
  });
});

test('fails closed when remote read-back bytes differ from the validated local archive', () => {
  const input = structuredClone(acceptedCandidate);
  input.remoteCheckpoint.remoteFingerprintSha256 = '4'.repeat(64);
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO', blockers: ['checkpoint:remote-readback:EVIDENCE_UNVERIFIED'],
  });
});

test('fails closed when a trusted digest is replayed for a different gate', () => {
  const input = structuredClone(acceptedCandidate);
  input.gates.atomicCase.evidence[0].digestSha256 = trustedClaims['gate:inquiry'];
  assert.deepEqual(evaluateReleasePackage(input, expectedIdentity()), {
    decision: 'NO_GO', blockers: ['gate:atomicCase:EVIDENCE_UNVERIFIED'],
  });
});
