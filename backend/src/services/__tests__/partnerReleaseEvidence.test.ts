import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Prisma } from '@prisma/client';
import { verifiedReadinessFromPublication, verifySignedPublication } from '../partnerSales/activationPackage/releaseEvidence';
import { acceptanceResponsibilities, readinessGates } from '../partnerSales/operations/readiness';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';

const runtime = { deploymentId: 'deploy-release-1', releaseId: 'release-1', schemaId: 'partner-schema-v1' };
const evidence = {
  source: 'DATABASE_VERIFIED', evidenceId: runtime.deploymentId, releaseId: runtime.releaseId,
  schemaId: runtime.schemaId, checkedAt: '2026-09-12T08:00:00.000Z', expiresAt: '2026-09-12T09:00:00.000Z',
  gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
  acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, `actor-${role}`])),
};
const deployment = { id: runtime.deploymentId, releaseId: runtime.releaseId,
  targetCommit: 'a'.repeat(40), phase: 'COMPLETED', reportJson: {
    format: 'sabalan-deployment-report', version: 1, mode: 'RELEASE', deploymentId: runtime.deploymentId,
    releaseId: runtime.releaseId, targetCommit: 'a'.repeat(40),
    gates: mandatoryReleaseDeploymentGateNames.map(name => ({ name, passed: true })),
  } as Prisma.JsonValue };
const row = { id: runtime.deploymentId, deploymentId: runtime.deploymentId, releaseId: runtime.releaseId,
  targetCommit: 'a'.repeat(40), schemaId: runtime.schemaId, checkedAt: new Date(evidence.checkedAt),
  expiresAt: new Date(evidence.expiresAt), packageSha256: 'b'.repeat(64), trustEnvelopeSha256: 'c'.repeat(64),
  trustKeyId: `sha256:${'d'.repeat(64)}`, packageBytesBase64: 'e30=', trustEnvelopeBytesBase64: 'e30=',
  evidenceJson: evidence as Prisma.JsonValue, deployment };

test('accepts only an immutable candidate-bound publication for a completed deployment', () => {
  assert.deepEqual(verifiedReadinessFromPublication(row, runtime), evidence);
});

test('fails closed for incomplete deployment, report drift, failed gates, or missing acceptance', () => {
  assert.equal(verifiedReadinessFromPublication({ ...row, deployment: { ...deployment, phase: 'GATES_PASSED' } }, runtime), null);
  assert.equal(verifiedReadinessFromPublication({ ...row, deployment: { ...deployment, reportJson: {
    ...(deployment.reportJson as Record<string, unknown>), targetCommit: 'b'.repeat(40),
  } as Prisma.JsonValue } }, runtime), null);
  assert.equal(verifiedReadinessFromPublication({ ...row, deployment: { ...deployment, reportJson: {
    ...(deployment.reportJson as Record<string, unknown>), gates: mandatoryReleaseDeploymentGateNames
      .map((name, index) => ({ name, passed: index !== 0 })),
  } as Prisma.JsonValue } }, runtime), null);
  assert.equal(verifiedReadinessFromPublication({ ...row, evidenceJson: {
    ...evidence, acceptedBy: { ...evidence.acceptedBy, SALES: '' },
  } as Prisma.JsonValue }, runtime), null);
});

test('replays the signed package with the production verifier and rejects tampering', async () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' });
  const tree = 'f'.repeat(40), digest = `sha256:${'2'.repeat(64)}`, migrationSetSha256 = '3'.repeat(64);
  const claimNames = ['schema:migration-set', 'checkpoint:remote-readback',
    ...readinessGates.map(name => `gate:${name}`),
    ...acceptanceResponsibilities.map(role => `approval:${role}`)];
  const claims = Object.fromEntries(claimNames.map((name, index) => [name, (index + 1).toString(16).padStart(64, '0')]));
  const releaseIdentity = { releaseId: runtime.releaseId, releaseSet: { backend: digest, frontend: digest,
    inquiry: digest, nginx: digest, supporting: [digest] },
    deploymentFormat: { name: 'sabalan-deployment-report', version: 1 },
    checkpointFormat: { name: 'sabalan-checkpoint-manifest', version: 1 } };
  const attestation = (reference: string, claim: string) => ({ source: 'SIGNED_ATTESTATION', reference,
    digestSha256: claims[claim], candidateCommit: row.targetCommit, candidateTree: tree,
    schemaId: runtime.schemaId, checkedAt: evidence.checkedAt, expiresAt: evidence.expiresAt });
  const manifest = { format: 'sabalan-partner-release-package', version: 1,
    candidate: { releaseId: runtime.releaseId, commit: row.targetCommit, tree, qaIssue: 335,
      qaRunId: 'partner-qa-signed-publication', interfacePackage: '@sabalanerp/partner-sales-contracts',
      interfaceVersion: '1.9.0', wireSchemaVersion: 1, schemaId: runtime.schemaId,
      migrationCount: 1, migrationSetSha256, releaseSet: releaseIdentity.releaseSet,
      deploymentFormat: releaseIdentity.deploymentFormat, checkpointFormat: releaseIdentity.checkpointFormat },
    evaluatedAt: evidence.checkedAt, expiresAt: evidence.expiresAt,
    schemaVerification: { status: 'MATCH', repositoryMigrationCount: 1, runtimeAppliedMigrationCount: 1,
      repositoryMigrationSetSha256: migrationSetSha256, runtimeMigrationSetSha256: migrationSetSha256,
      evidence: attestation('schema/audit/reference', 'schema:migration-set') },
    remoteCheckpoint: { status: 'REMOTE_READBACK_VERIFIED', releaseId: runtime.releaseId,
      candidateCommit: row.targetCommit, candidateTree: tree, schemaId: runtime.schemaId,
      archiveSha256: '4'.repeat(64), remoteFingerprintSha256: '4'.repeat(64), sidecarSha256: '5'.repeat(64),
      verifiedAt: evidence.checkedAt, expiresAt: evidence.expiresAt, evidenceReference: 'remote/checkpoint/readback',
      evidenceDigestSha256: claims['checkpoint:remote-readback'] },
    gates: Object.fromEntries(readinessGates.map(name => [name,
      { status: 'PASS', evidence: [attestation(`evidence/${name}`, `gate:${name}`)] }])),
    approvals: Object.fromEntries(acceptanceResponsibilities.map(role => [role, { status: 'APPROVED',
      actorId: `actor-${role}`, authenticationRef: `identity-${role}`, issuedAt: evidence.checkedAt,
      expiresAt: evidence.expiresAt, candidateCommit: row.targetCommit, candidateTree: tree,
      schemaId: runtime.schemaId, evidenceReference: `approval/${role}`,
      evidenceDigestSha256: claims[`approval:${role}`] }])),
    activation: { requested: false, trafficOpened: false, realSmsEnabled: false } };
  const packageBytes = Buffer.from(JSON.stringify(manifest)), packageSha256 = createHash('sha256').update(packageBytes).digest('hex');
  const trustPayload = Buffer.from(JSON.stringify({ packageSha256, releaseIdentity, claims }));
  const keyId = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;
  const envelopeBytes = Buffer.from(JSON.stringify({ format: 'sabalan-partner-trusted-claims-envelope', version: 1,
    keyId, payloadBase64: trustPayload.toString('base64'),
    signatureBase64: sign(null, trustPayload, keys.privateKey).toString('base64') }));
  const signed = { ...row, packageSha256, trustEnvelopeSha256: createHash('sha256').update(envelopeBytes).digest('hex'),
    trustKeyId: keyId, packageBytesBase64: packageBytes.toString('base64'),
    trustEnvelopeBytesBase64: envelopeBytes.toString('base64') };
  const repositoryRoot = process.cwd().endsWith(`${path.sep}backend`) ? path.resolve(process.cwd(), '..') : process.cwd();
  const verifier = await import(pathToFileURL(path.join(repositoryRoot,
    'docs/qa/partner-sales/release/release-package.mjs')).href) as {
      evaluateReleasePackage(manifest: unknown, expected: Record<string, unknown>): { decision: string };
    };
  const evaluate = verifier.evaluateReleasePackage;
  assert.equal(verifySignedPublication({ row: signed, publicKey, now: evidence.checkedAt, evaluate }), true);
  assert.equal(verifySignedPublication({ row: { ...signed, evidenceJson: { ...evidence,
    acceptedBy: { ...evidence.acceptedBy, SALES: 'forged-actor' } } as Prisma.JsonValue },
    publicKey, now: evidence.checkedAt, evaluate }), false);
  assert.equal(verifySignedPublication({ row: { ...signed, packageBytesBase64: 'e30=' },
    publicKey, now: evidence.checkedAt, evaluate }), false);
});
