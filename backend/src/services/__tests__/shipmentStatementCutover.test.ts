import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CUTOVER_ACCEPTANCE_COMMANDS,
  activateShipmentStatementCutover,
  assertAuthoritativeGateParity,
  acceptanceSemanticDigest,
  buildCutoverManifest,
  captureAuthoritativeCutoverGates,
  evaluateCutoverEvidence,
  readAndVerifyCutoverManifest,
  verifyFileBackedCutoverEvidence,
  writeImmutableCutoverManifest,
  type CutoverEvidence,
  type ShipmentStatementCutoverRepository,
} from '../shipmentStatementCutover';
import { SHIPMENT_STATEMENT_PRESERVATION_SCOPES } from '../dispatchDocuments/migrationManifest';

const sha = 'a'.repeat(64);

test('cutover requires the authenticated mounted-backend Accounting journey', () => {
  assert.ok(CUTOVER_ACCEPTANCE_COMMANDS.includes('npm run test:accounting-dispatch-documents:e2e:real' as never));
});

const passingEvidence = (): CutoverEvidence => ({
  environment: { composeProject: 'sabalanerp-local', servicesHealthy: true },
  deployment: {
    additiveMigrationsOnly: true,
    constraintsVerified: true,
    databaseGateEnabled: false,
    environmentGateEnabled: false,
    migrationRuns: [
      { runNumber: 1, status: 'COMPLETED', preservationScopes: 8, mismatches: 0 },
      { runNumber: 2, status: 'COMPLETED', preservationScopes: 8, mismatches: 0 },
    ],
  },
  preservation: SHIPMENT_STATEMENT_PRESERVATION_SCOPES.map(scope => ({ scope, beforeCount: '4', afterCount: '4', beforeIdentityHash: sha,
    afterIdentityHash: sha, beforeQuantityScale3: '12.000', afterQuantityScale3: '12.000',
    beforeAmountScale12: '99.000000000000', afterAmountScale12: '99.000000000000',
    beforeEvidenceHash: sha, afterEvidenceHash: sha })),
  recovery: { artifactPath: '', backupPath: '', evidenceArtifactSha256: sha, backupSha256: sha, backupRestored: true, restoreDrillProject: 'sabalanerp-local',
    restoredEvidenceHash: sha, sourceEvidenceHash: sha },
  legacy: { dryRunArtifactPath: '', applyArtifactPath: '', repeatArtifactPath: '', dryRunArtifactSha256: sha,
    applyArtifactSha256: sha, repeatArtifactSha256: sha, manifestHash: sha,
    cohortArtifactPath: '', cohortArtifactSha256: sha, cohortApprovalArtifactPath: '', cohortApprovalArtifactSha256: sha,
    sourceCounts: {}, releaseCohortCounts: {}, releaseCohortCount: 0, excludedBlockedCount: 0,
    dryRunCompleted: true, applyCompleted: true, repeatCompleted: true, repeatCreatedCount: 0,
    unresolvedCount: 0, quarantinedCount: 0, unreviewedCohortCount: 0 },
  integrity: { artifactPath: '', orphanArtifactCount: 0, incompleteBundleCount: 0, auditGapCount: 0,
    corruptArtifactCount: 0, recoveryFailures: 0, evidenceArtifactSha256: sha },
  concurrency: { artifactPath: '', completedRuns: 3, anomalyCount: 0, evidenceArtifactSha256: sha },
  acceptance: CUTOVER_ACCEPTANCE_COMMANDS.map(command => ({ command, artifactPath: '', artifactSha256: sha,
    semanticDigest: sha, exitCode: 0, outputSha256: sha })),
  operations: { incidentContacts: ['accounting-on-call'], monitoringChecks: ['bundle integrity', 'audit gaps'] },
});

test('all mandatory gates pass only with exact preservation, recovery, legacy, and acceptance evidence', () => {
  const result = evaluateCutoverEvidence(passingEvidence());
  assert.deepEqual(result, { decision: 'GO', failures: [] });

  const unsafe = passingEvidence();
  unsafe.preservation[0].afterAmountScale12 = '98.000000000000';
  unsafe.legacy.quarantinedCount = 1;
  unsafe.recovery.restoredEvidenceHash = '';
  unsafe.recovery.sourceEvidenceHash = '';
  unsafe.acceptance.pop();
  const blocked = evaluateCutoverEvidence(unsafe);
  assert.equal(blocked.decision, 'NO_GO');
  assert.ok(blocked.failures.includes('PRESERVATION_MISMATCH:sales_contracts:AMOUNT_SCALE_12'));
  assert.ok(blocked.failures.includes('LEGACY_QUARANTINED:1'));
  assert.ok(blocked.failures.includes('RESTORED_EVIDENCE_HASH_INVALID'));
  assert.ok(blocked.failures.includes('SOURCE_EVIDENCE_HASH_INVALID'));
  assert.ok(blocked.failures.some(failure => failure.startsWith('ACCEPTANCE_MISSING:')));
});

test('file-backed verification rejects hash-shaped caller claims without their artifacts', async () => {
  await assert.rejects(
    () => verifyFileBackedCutoverEvidence(passingEvidence(), async () => ({
      manifestHash: sha,
      sourceContractCount: 0,
      sourceApprovalRecordCount: 0,
      sourceRowCount: 0,
      counts: { SEALED: 0, LEGACY_REVIEW_REQUIRED: 0, REPAIR_REQUIRED: 0, EVIDENCE_CONFLICT: 0 },
      entries: [],
    })),
    /artifact path/i,
  );
});

test('authoritative gate capture replaces caller success claims with executed results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipment-gates-'));
  const caller = passingEvidence();
  const executed: string[] = [];
  const captured = await captureAuthoritativeCutoverGates(caller, {
    artifactDirectory: directory,
    sourceCommit: 'verified-commit',
    incidentContacts: ['release-on-call'],
    monitoringChecks: ['audit-gap-monitor'],
    run: async command => {
      executed.push(command);
      if (command.includes('docker compose')) return { exitCode: 0, stdout: '{"Service":"postgres","State":"running","Health":"healthy"}\n', stderr: '' };
      const exitCode = command === 'npm run build' ? 1 : 0;
      return { exitCode, stdout: exitCode === 0 ? 'passed' : '', stderr: exitCode === 0 ? '' : 'build failed' };
    },
  });
  assert.equal(executed.length, CUTOVER_ACCEPTANCE_COMMANDS.length + 1);
  assert.equal(captured.environment.servicesHealthy, true);
  assert.equal(captured.deployment.additiveMigrationsOnly, true);
  assert.equal(captured.deployment.constraintsVerified, true);
  assert.equal(captured.acceptance.find(item => item.command === 'npm run build')?.exitCode, 1);
  assert.deepEqual(captured.operations, { incidentContacts: ['release-on-call'], monitoringChecks: ['audit-gap-monitor'] });
  assert.equal(evaluateCutoverEvidence(captured).decision, 'NO_GO');
});

test('activation gate parity rejects command, health, or operations drift', () => {
  const signed = passingEvidence();
  assert.doesNotThrow(() => assertAuthoritativeGateParity(signed, structuredClone(signed)));
  const commandDrift = structuredClone(signed);
  commandDrift.acceptance[0].exitCode = 1;
  assert.throws(() => assertAuthoritativeGateParity(signed, commandDrift), /acceptance gate drift/i);
  const healthDrift = structuredClone(signed);
  healthDrift.environment.servicesHealthy = false;
  assert.throws(() => assertAuthoritativeGateParity(signed, healthDrift), /environment gate drift/i);
  const operationsDrift = structuredClone(signed);
  operationsDrift.operations.incidentContacts = ['somebody-else'];
  assert.throws(() => assertAuthoritativeGateParity(signed, operationsDrift), /operations gate drift/i);
});

test('acceptance semantic digest ignores volatile metadata but rejects changed domain evidence', () => {
  const first = JSON.stringify({ status: 'PASSED', runId: 'run-one', durationMs: 12, path: 'C:\\tmp\\one',
    passedCount: 10, anomalyCount: 0, evidenceHash: 'a'.repeat(64) });
  const volatileOnly = JSON.stringify({ status: 'PASSED', runId: 'run-two', durationMs: 999, path: '/tmp/two',
    passedCount: 10, anomalyCount: 0, evidenceHash: 'a'.repeat(64) });
  const semanticChange = JSON.stringify({ status: 'PASSED', runId: 'run-three', durationMs: 1, path: '/tmp/three',
    passedCount: 9, anomalyCount: 1, evidenceHash: 'b'.repeat(64) });
  assert.equal(acceptanceSemanticDigest(first), acceptanceSemanticDigest(volatileOnly));
  assert.notEqual(acceptanceSemanticDigest(first), acceptanceSemanticDigest(semanticChange));
  const textEvidence = 'path=C:\\tmp\\run passedCount=9 anomalyCount=0 evidenceHash=' + 'a'.repeat(64);
  const changedTextEvidence = 'path=C:\\tmp\\other passedCount=9 anomalyCount=1 evidenceHash=' + 'b'.repeat(64);
  assert.notEqual(acceptanceSemanticDigest(textEvidence), acceptanceSemanticDigest(changedTextEvidence));

  const signed = passingEvidence();
  const current = structuredClone(signed);
  current.acceptance[0].semanticDigest = acceptanceSemanticDigest(semanticChange);
  signed.acceptance[0].semanticDigest = acceptanceSemanticDigest(first);
  assert.throws(() => assertAuthoritativeGateParity(signed, current), /acceptance gate drift/i);
});

test('file-backed verification recomputes hashes and binds legacy evidence to the current cohort', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipment-evidence-'));
  const writeJson = async (name: string, value: unknown) => {
    const path = join(directory, name);
    await writeFile(path, JSON.stringify(value));
    return path;
  };
  const backupPath = join(directory, 'backup.dump');
  await writeFile(backupPath, 'real backup bytes');
  const evidence = passingEvidence();
  evidence.recovery.artifactPath = await writeJson('recovery.json', { backupPath, backupRestored: true,
    restoreDrillProject: 'sabalanerp-local', restoredEvidenceHash: sha, sourceEvidenceHash: sha });
  evidence.recovery.backupPath = backupPath;
  evidence.integrity.artifactPath = await writeJson('integrity.json', { orphanArtifactCount: 0, incompleteBundleCount: 0,
    auditGapCount: 0, corruptArtifactCount: 0, recoveryFailures: 0 });
  evidence.concurrency.artifactPath = await writeJson('concurrency.json', { runs: [
    { runId: 'one', anomalyCount: 0 }, { runId: 'two', anomalyCount: 0 }, { runId: 'three', anomalyCount: 0 },
  ] });
  evidence.acceptance = await Promise.all(CUTOVER_ACCEPTANCE_COMMANDS.map(async (command, index) => {
    const outputPath = join(directory, `acceptance-${index}.log`);
    const output = `passed: ${command}`;
    await writeFile(outputPath, output);
    const semanticDigest = acceptanceSemanticDigest(output);
    return { command, artifactPath: await writeJson(`acceptance-${index}.json`, {
      command, exitCode: 0, semanticDigest, outputPath, sourceCommit: 'commit-1',
    }),
      artifactSha256: sha, semanticDigest: sha, exitCode: 99, outputSha256: sha };
  }));
  const current = { manifestHash: 'b'.repeat(64), sourceContractCount: '2', sourceApprovalRecordCount: '2', sourceRowCount: '4',
    counts: { READY: 2, LEGACY_REVIEW_REQUIRED: 0, REPAIR_REQUIRED: 0, EVIDENCE_CONFLICT: 0, STALE: 0 }, entries: [
      { contractId: 'contract-1', sourceFinancialRecordId: 'approval-1', sourceEvidenceHash: 'c'.repeat(64), status: 'READY' },
      { contractId: 'contract-2', sourceFinancialRecordId: 'approval-2', sourceEvidenceHash: 'd'.repeat(64), status: 'READY' },
    ] };
  const legacyManifest = { ...current };
  const cohortApprovalKey = 'cohort-approval-key-with-32-characters';
  evidence.legacy.cohortArtifactPath = await writeJson('legacy-cohort.json', {
    schemaVersion: 1, sourceManifestHash: current.manifestHash, entries: current.entries.map(entry => ({
      contractId: entry.contractId, sourceFinancialRecordId: entry.sourceFinancialRecordId,
      sourceEvidenceHash: entry.sourceEvidenceHash, decision: 'INCLUDE', reviewedBy: 'release-owner',
      reviewedAt: '2026-09-05T10:00:00.000Z', reason: 'Approved release cohort.',
    })),
  });
  const cohortBytes = await readFile(evidence.legacy.cohortArtifactPath);
  const cohortApprovalPayload = JSON.stringify({ algorithm: 'HMAC-SHA256', keyId: 'cohort-key-1', approvedBy: 'release-owner',
    cohortSha256: createHash('sha256').update(cohortBytes).digest('hex') });
  evidence.legacy.cohortApprovalArtifactPath = await writeJson('legacy-cohort-approval.json', {
    algorithm: 'HMAC-SHA256', keyId: 'cohort-key-1', approvedBy: 'release-owner',
    signature: createHmac('sha256', cohortApprovalKey).update(cohortApprovalPayload).digest('hex'),
  });
  evidence.legacy.dryRunArtifactPath = await writeJson('legacy-dry.json', { mode: 'DRY_RUN', status: 'COMPLETED', afterManifest: legacyManifest });
  evidence.legacy.applyArtifactPath = await writeJson('legacy-apply.json', { mode: 'APPLY', status: 'COMPLETED', beforeManifest: legacyManifest, afterManifest: legacyManifest,
    sourceComparison: { matched: true }, outcomeCounts: { SEALED: 2, REPLAYED: 0 } });
  evidence.legacy.repeatArtifactPath = await writeJson('legacy-repeat.json', { mode: 'APPLY', status: 'COMPLETED', beforeManifest: legacyManifest, afterManifest: legacyManifest,
    sourceComparison: { matched: true }, outcomeCounts: { SEALED: 0, REPLAYED: 2 } });

  const verified = await verifyFileBackedCutoverEvidence(evidence, async () => current,
    { keyId: 'cohort-key-1', signingKey: cohortApprovalKey }, 'commit-1');
  assert.equal(verified.acceptance[0].exitCode, 0);
  assert.notEqual(verified.acceptance[0].outputSha256, sha);
  assert.equal(verified.recovery.backupSha256, createHash('sha256').update('real backup bytes').digest('hex'));
  assert.equal(verified.legacy.manifestHash, current.manifestHash);
  assert.deepEqual(evaluateCutoverEvidence(verified), { decision: 'GO', failures: [] });

  await assert.rejects(
    () => verifyFileBackedCutoverEvidence(evidence, async () => current,
      { keyId: 'cohort-key-1', signingKey: cohortApprovalKey }, 'different-commit'),
    /Acceptance source commit/,
  );

  await assert.rejects(
    () => verifyFileBackedCutoverEvidence(evidence, async () => ({ ...current, manifestHash: 'c'.repeat(64) })),
    /manifest hash does not match/i,
  );
});

test('hash-bound blocked dispositions keep unresolved legacy rows outside the release cohort', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipment-cohort-'));
  const writeJson = async (name: string, value: unknown) => {
    const path = join(directory, name);
    await writeFile(path, JSON.stringify(value));
    return path;
  };
  const backupPath = join(directory, 'backup.dump');
  await writeFile(backupPath, 'backup');
  const evidence = passingEvidence();
  evidence.recovery.artifactPath = await writeJson('recovery.json', { backupPath, backupRestored: true,
    restoreDrillProject: 'sabalanerp-local', restoredEvidenceHash: sha, sourceEvidenceHash: sha });
  evidence.recovery.backupPath = backupPath;
  evidence.integrity.artifactPath = await writeJson('integrity.json', { orphanArtifactCount: 0, incompleteBundleCount: 0,
    auditGapCount: 0, corruptArtifactCount: 0, recoveryFailures: 0 });
  evidence.concurrency.artifactPath = await writeJson('concurrency.json', { runs: [
    { anomalyCount: 0 }, { anomalyCount: 0 }, { anomalyCount: 0 },
  ] });
  evidence.acceptance = await Promise.all(CUTOVER_ACCEPTANCE_COMMANDS.map(async (command, index) => {
    const outputPath = join(directory, `acceptance-${index}.log`);
    await writeFile(outputPath, 'passed');
    return { command, artifactPath: await writeJson(`acceptance-${index}.json`, {
      command, exitCode: 0, semanticDigest: acceptanceSemanticDigest('passed'), outputPath,
    }), artifactSha256: sha, semanticDigest: sha, exitCode: 99, outputSha256: sha };
  }));
  const current = {
    manifestHash: 'b'.repeat(64), sourceContractCount: '1', sourceApprovalRecordCount: '1', sourceRowCount: '1',
    counts: { SEALED: 0, LEGACY_REVIEW_REQUIRED: 0, REPAIR_REQUIRED: 1, EVIDENCE_CONFLICT: 0, STALE: 0 },
    entries: [{ contractId: 'contract-1', sourceFinancialRecordId: 'approval-1', sourceEvidenceHash: 'c'.repeat(64), status: 'REPAIR_REQUIRED' }],
  };
  const legacyManifest = { ...current };
  evidence.legacy.dryRunArtifactPath = await writeJson('legacy-dry.json', { mode: 'DRY_RUN', status: 'COMPLETED', afterManifest: legacyManifest });
  evidence.legacy.applyArtifactPath = await writeJson('legacy-apply.json', { mode: 'APPLY', status: 'COMPLETED', beforeManifest: legacyManifest,
    afterManifest: legacyManifest, sourceComparison: { matched: true }, outcomeCounts: { SEALED: 0, REPLAYED: 0 } });
  evidence.legacy.repeatArtifactPath = await writeJson('legacy-repeat.json', { mode: 'APPLY', status: 'COMPLETED', beforeManifest: legacyManifest,
    afterManifest: legacyManifest, sourceComparison: { matched: true }, outcomeCounts: { SEALED: 0, REPLAYED: 0 } });
  const cohortApprovalKey = 'cohort-approval-key-with-32-characters';
  evidence.legacy.cohortArtifactPath = await writeJson('legacy-cohort.json', { schemaVersion: 1,
    sourceManifestHash: current.manifestHash, entries: [{ contractId: 'contract-1', sourceFinancialRecordId: 'approval-1',
      sourceEvidenceHash: 'c'.repeat(64), decision: 'EXCLUDE_BLOCKED', reviewedBy: 'release-owner',
      reviewedAt: '2026-09-05T10:00:00.000Z', reason: 'Pre-cutover revision remains waybill-only pending source-owned correction.' }] });
  const cohortBytes = await readFile(evidence.legacy.cohortArtifactPath);
  const cohortApprovalPayload = JSON.stringify({ algorithm: 'HMAC-SHA256', keyId: 'cohort-key-1', approvedBy: 'release-owner',
    cohortSha256: createHash('sha256').update(cohortBytes).digest('hex') });
  evidence.legacy.cohortApprovalArtifactPath = await writeJson('legacy-cohort-approval.json', {
    algorithm: 'HMAC-SHA256', keyId: 'cohort-key-1', approvedBy: 'release-owner',
    signature: createHmac('sha256', cohortApprovalKey).update(cohortApprovalPayload).digest('hex'),
  });

  await assert.rejects(() => verifyFileBackedCutoverEvidence(evidence, async () => current), /approval verifier/i);
  const verified = await verifyFileBackedCutoverEvidence(evidence, async () => current,
    { keyId: 'cohort-key-1', signingKey: cohortApprovalKey });
  assert.equal(verified.legacy.releaseCohortCount, 0);
  assert.equal(verified.legacy.excludedBlockedCount, 1);
  assert.equal(verified.legacy.unresolvedCount, 0);
  assert.deepEqual(evaluateCutoverEvidence(verified), { decision: 'GO', failures: [] });

  const approval = JSON.parse(await readFile(evidence.legacy.cohortApprovalArtifactPath, 'utf8'));
  approval.approvedBy = 'different-owner';
  await writeFile(evidence.legacy.cohortApprovalArtifactPath, JSON.stringify(approval));
  await assert.rejects(() => verifyFileBackedCutoverEvidence(evidence, async () => current,
    { keyId: 'cohort-key-1', signingKey: cohortApprovalKey }), /approval signature/i);
  approval.approvedBy = 'release-owner';
  await writeFile(evidence.legacy.cohortApprovalArtifactPath, JSON.stringify(approval));

  const changed = structuredClone(current);
  changed.entries[0].sourceEvidenceHash = 'd'.repeat(64);
  await assert.rejects(() => verifyFileBackedCutoverEvidence(evidence, async () => changed,
    { keyId: 'cohort-key-1', signingKey: cohortApprovalKey }), /cohort disposition.*hash/i);
});

test('signed manifests are deterministic, tamper-evident, and created without overwrite', async () => {
  const key = 'release-key-with-at-least-32-characters';
  const manifest = buildCutoverManifest({
    releaseId: 'shipment-statements-2026-08-10', migrationManifestId: 'migration-1',
    createdAt: '2026-08-10T07:00:00.000Z', createdBy: 'release-manager', sourceCommit: 'abc123',
    evidence: passingEvidence(), keyId: 'local-release-key-v1', signingKey: key,
  });
  assert.equal(manifest.decision, 'GO');
  assert.equal(manifest.integrityHash.length, 64);
  assert.equal(manifest.signature.value.length, 64);

  const directory = await mkdtemp(join(tmpdir(), 'shipment-cutover-'));
  const destination = join(directory, 'manifest.json');
  await writeImmutableCutoverManifest(destination, manifest);
  assert.deepEqual(await readAndVerifyCutoverManifest(destination, key), manifest);
  await assert.rejects(() => writeImmutableCutoverManifest(destination, manifest), /already exists/i);

  const tampered = JSON.parse(await readFile(destination, 'utf8'));
  tampered.evidence.legacy.unresolvedCount = 1;
  await writeFile(join(directory, 'tampered.json'), JSON.stringify(tampered));
  await assert.rejects(() => readAndVerifyCutoverManifest(join(directory, 'tampered.json'), key), /integrity/i);
});

test('activation is one-way, uses database time, and refuses NO-GO or externally enabled flow', async () => {
  let state = { enabled: false, cutoverAt: null as Date | null, manifestId: null as string | null,
    integrityHash: null as string | null };
  const repository: ShipmentStatementCutoverRepository = {
    loadState: async () => state,
    activate: async input => {
      assert.equal(input.expectedDisabled, true);
      assert.equal(input.expiresAt.toISOString(), '2026-08-10T07:15:00.000Z');
      const cutoverAt = new Date('2026-08-10T07:30:00.123Z');
      state = { enabled: true, cutoverAt, manifestId: input.migrationManifestId, integrityHash: input.integrityHash };
      return { ...state, activatedAt: cutoverAt, activatedBy: input.activatedBy };
    },
  };
  const manifest = buildCutoverManifest({ releaseId: 'release', migrationManifestId: 'migration-1',
    createdAt: '2026-08-10T07:00:00.000Z', createdBy: 'manager', sourceCommit: 'abc',
    evidence: passingEvidence(), keyId: 'key-1', signingKey: 'release-key-with-at-least-32-characters' });

  const activated = await activateShipmentStatementCutover({ repository, manifest, activatedBy: 'manager',
    signingKey: 'release-key-with-at-least-32-characters', now: () => new Date('2026-08-10T07:05:00.000Z'),
    environment: { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' } });
  assert.equal(activated.cutoverAt?.toISOString(), '2026-08-10T07:30:00.123Z');
  await assert.rejects(() => activateShipmentStatementCutover({ repository, manifest, activatedBy: 'manager',
    signingKey: 'release-key-with-at-least-32-characters', now: () => new Date('2026-08-10T07:05:00.000Z'),
    environment: { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' } }), /already activated/i);

  const noGo = { ...manifest, decision: 'NO_GO' as const, failures: ['LEGACY_UNREVIEWED:1'] };
  state = { enabled: false, cutoverAt: null, manifestId: null, integrityHash: null };
  await assert.rejects(() => activateShipmentStatementCutover({ repository, manifest: noGo, activatedBy: 'manager',
    signingKey: 'release-key-with-at-least-32-characters', now: () => new Date('2026-08-10T07:05:00.000Z'),
    environment: { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' } }), /integrity|NO-GO/);
  await assert.rejects(() => activateShipmentStatementCutover({ repository, manifest, activatedBy: 'manager',
    signingKey: 'release-key-with-at-least-32-characters', now: () => new Date('2026-08-10T07:05:00.000Z'),
    environment: { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' } }), /must remain disabled/i);
});
