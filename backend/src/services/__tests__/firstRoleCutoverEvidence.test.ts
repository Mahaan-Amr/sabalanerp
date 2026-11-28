import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  hasRetainedFirstRoleCutoverEvidence, readRetainedFirstRoleCutoverEvidence, retainFirstRoleCutoverEvidence,
  archiveFirstRoleOpenIntent, readFirstRoleRollbackGateProof, readFirstRoleRollbackPublicProof,
  retainFirstRoleOpenIntent, validateFirstRoleCutoverBinding,
} from '../firstRoleCutoverEvidence';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'role-cutover-evidence-')));
  const sourceDir = path.join(root, 'source');
  await mkdir(sourceDir, { mode: 0o700 });
  const before = Buffer.from('{"acl":"legacy"}\n');
  const staged = Buffer.from('{"acl":"staged"}\n');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(sourceDir, 'legacy-catalog.json'), before, { mode: 0o600 });
  await writeFile(path.join(sourceDir, 'staged-catalog.json'), staged, { mode: 0o600 });
  const input = {
    sourceDir, reportDir: path.join(root, 'reports'), coordinationDir: path.join(root, 'coordination'),
    deploymentId: 'deployment-123',
    binding: { beforeSha256: hash(before), stagedSha256: hash(staged), migrationSha256: 'a'.repeat(64),
      beforeEnvironmentSha256: 'd'.repeat(64), afterEnvironmentSha256: 'e'.repeat(64) },
  };
  return { root, input, before, staged };
}

test('first-role binding pins the catalogs, migration ledger and both environment states', () => {
  const valid = { beforeSha256: 'a'.repeat(64), stagedSha256: 'b'.repeat(64), migrationSha256: 'c'.repeat(64),
    beforeEnvironmentSha256: 'd'.repeat(64), afterEnvironmentSha256: 'e'.repeat(64) };
  assert.deepEqual(validateFirstRoleCutoverBinding(valid), valid);
  assert.throws(() => validateFirstRoleCutoverBinding({ ...valid, extra: true }));
  assert.throws(() => validateFirstRoleCutoverBinding({ ...valid, stagedSha256: 'not-a-digest' }));
  assert.throws(() => validateFirstRoleCutoverBinding({ ...valid, afterEnvironmentSha256: valid.beforeEnvironmentSha256 }));
});

test('cutover recovery reads its original catalog bytes from both retained copies', { skip: !process.getuid }, async () => {
  const { root, input, before, staged } = await fixture();
  try {
    assert.equal(await hasRetainedFirstRoleCutoverEvidence(input), false);
    await retainFirstRoleCutoverEvidence(input);
    await retainFirstRoleCutoverEvidence(input);
    assert.equal(await hasRetainedFirstRoleCutoverEvidence(input), true);
    await unlink(path.join(input.sourceDir, 'legacy-catalog.json'));
    await unlink(path.join(input.sourceDir, 'staged-catalog.json'));
    assert.deepEqual(await readRetainedFirstRoleCutoverEvidence(input), { beforeBytes: before, stagedBytes: staged });
    const record = path.join(input.coordinationDir, 'first-role-cutover-deployment-123.json');
    await chmod(record, 0o600);
    await writeFile(record, '{}');
    await assert.rejects(readRetainedFirstRoleCutoverEvidence(input), /evidence is missing or changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cutover recovery refuses linked evidence and does not accept matching paths as independent copies', { skip: !process.getuid }, async () => {
  const { root, input } = await fixture();
  try {
    await assert.rejects(retainFirstRoleCutoverEvidence({ ...input, coordinationDir: input.reportDir }), /evidence is missing or changed/);
    await retainFirstRoleCutoverEvidence(input);
    await link(path.join(input.reportDir, 'first-role-cutover-deployment-123.json'), path.join(root, 'extra-link.json'));
    await assert.rejects(readRetainedFirstRoleCutoverEvidence(input), /evidence is missing or changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rollback reopening binds the observed role, gates and checkpoint to the original intent', { skip: !process.getuid }, async () => {
  const { root, input } = await fixture();
  try {
    await mkdir(input.coordinationDir);
    await mkdir(input.reportDir);
    const deploymentId = input.deploymentId;
    const releaseId = 'release-test';
    const targetCommit = '1'.repeat(40);
    const checkpointSha256 = 'a'.repeat(64);
    const gateReport = {
      format: 'sabalan-deployment-report', version: 1, mode: 'ROLLBACK', deploymentId, releaseId, targetCommit,
      createdAt: '2020-01-01T00:01:01.000Z',
      gates: mandatoryReleaseDeploymentGateNames.filter(name =>
        !['migration-history', 'shipment-statement-runtime-state', 'contract-financial-evidence'].includes(name))
        .map(name => ({ name, passed: true, details: name === 'backend-readiness'
          ? { firstRoleRuntime: 'restored', authenticatedRuntimeSessions: true, firstRoleRuntimeAddress: '172.20.0.8' }
          : name === 'checkpoint-manifest' ? { checksum: checkpointSha256, releaseId, remoteReadBack: true } : {} })),
    };
    const proof = { coordinationDir: input.coordinationDir, deploymentId, releaseId, targetCommit, checkpointSha256,
      restoreRecordedAt: '2020-01-01T00:01:00.000Z' };
    const gatePath = path.join(input.coordinationDir, 'deployment-report.json');
    await writeFile(gatePath, JSON.stringify(gateReport), { mode: 0o600 });
    const { reportSha256, runtimeAddress } = await readFirstRoleRollbackGateProof(proof);
    assert.equal(runtimeAddress, '172.20.0.8');
    assert.match(reportSha256, /^[a-f0-9]{64}$/);
    await assert.rejects(readFirstRoleRollbackGateProof({ ...proof, restoreRecordedAt: '2020-01-01T00:02:00.000Z' }), /missing or changed/);
    await assert.rejects(readFirstRoleRollbackGateProof({ ...proof, checkpointSha256: 'b'.repeat(64) }), /missing or changed/);
    const intent = { deploymentId, releaseId, targetCommit, reportSha256 };
    await assert.rejects(retainFirstRoleOpenIntent(input.reportDir, intent, true), { code: 'ENOENT' });
    const intentFile = await retainFirstRoleOpenIntent(input.reportDir, intent, false);
    await retainFirstRoleOpenIntent(input.reportDir, intent, true);
    await assert.rejects(retainFirstRoleOpenIntent(input.reportDir, { ...intent, reportSha256: 'b'.repeat(64) }, true), /missing or changed/);
    const publicInput = { reportDir: input.reportDir, intentFile, deploymentId, releaseId, targetCommit,
      openedAfter: '2020-01-01T00:01:00.000Z', expectedHosts: ['app.example.test', 'inquiry.example.test'] as [string, string] };
    const proofFile = path.join(input.reportDir, `first-role-rollback-public-${deploymentId}.json`);
    const validPublicProof = {
      format: 'sabalan-first-role-rollback-public/v1', deploymentId, releaseId, targetCommit, observedAt: new Date().toISOString(),
      intentSha256: createHash('sha256').update(`${JSON.stringify(intent)}\n`).digest('hex'),
      origins: publicInput.expectedHosts.map(host => ({ origin: `https://${host}`, httpStatus: 200, tlsVerified: true })),
    };
    await writeFile(proofFile, JSON.stringify(validPublicProof), { mode: 0o600 });
    const publicProofHash = await readFirstRoleRollbackPublicProof(publicInput);
    await archiveFirstRoleOpenIntent(intentFile, deploymentId);
    const archived = await retainFirstRoleOpenIntent(input.reportDir, intent, true, true);
    assert.equal(await readFirstRoleRollbackPublicProof({ ...publicInput, intentFile: archived }), publicProofHash);
    validPublicProof.origins[1].httpStatus = 503;
    await writeFile(proofFile, JSON.stringify(validPublicProof));
    await assert.rejects(readFirstRoleRollbackPublicProof({ ...publicInput, intentFile: archived }), /missing or changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
