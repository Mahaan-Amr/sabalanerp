import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CUTOVER_ACCEPTANCE_COMMANDS,
  activateShipmentStatementCutover,
  buildCutoverManifest,
  evaluateCutoverEvidence,
  readAndVerifyCutoverManifest,
  writeImmutableCutoverManifest,
  type CutoverEvidence,
  type ShipmentStatementCutoverRepository,
} from '../shipmentStatementCutover';
import { SHIPMENT_STATEMENT_PRESERVATION_SCOPES } from '../dispatchDocuments/migrationManifest';

const sha = 'a'.repeat(64);

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
  recovery: { backupSha256: sha, backupRestored: true, restoreDrillProject: 'sabalanerp-local',
    restoredEvidenceHash: sha, sourceEvidenceHash: sha },
  legacy: { dryRunCompleted: true, applyCompleted: true, repeatCompleted: true, repeatCreatedCount: 0,
    unresolvedCount: 0, quarantinedCount: 0, unreviewedCohortCount: 0 },
  integrity: { orphanArtifactCount: 0, incompleteBundleCount: 0, auditGapCount: 0,
    corruptArtifactCount: 0, recoveryFailures: 0, evidenceArtifactSha256: sha },
  concurrency: { completedRuns: 3, anomalyCount: 0, evidenceArtifactSha256: sha },
  acceptance: CUTOVER_ACCEPTANCE_COMMANDS.map(command => ({ command, exitCode: 0, outputSha256: sha })),
  operations: { incidentContacts: ['accounting-on-call'], monitoringChecks: ['bundle integrity', 'audit gaps'] },
});

test('all mandatory gates pass only with exact preservation, recovery, legacy, and acceptance evidence', () => {
  const result = evaluateCutoverEvidence(passingEvidence());
  assert.deepEqual(result, { decision: 'GO', failures: [] });

  const unsafe = passingEvidence();
  unsafe.preservation[0].afterAmountScale12 = '98.000000000000';
  unsafe.legacy.quarantinedCount = 1;
  unsafe.acceptance.pop();
  const blocked = evaluateCutoverEvidence(unsafe);
  assert.equal(blocked.decision, 'NO_GO');
  assert.ok(blocked.failures.includes('PRESERVATION_MISMATCH:sales_contracts:AMOUNT_SCALE_12'));
  assert.ok(blocked.failures.includes('LEGACY_QUARANTINED:1'));
  assert.ok(blocked.failures.some(failure => failure.startsWith('ACCEPTANCE_MISSING:')));
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
