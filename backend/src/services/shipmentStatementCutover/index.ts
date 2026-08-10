import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { SHIPMENT_STATEMENT_PRESERVATION_SCOPES } from '../dispatchDocuments/migrationManifest';

export const CUTOVER_ACCEPTANCE_COMMANDS = [
  'npm run docker:local:ps',
  'npm --prefix backend run verify:shipment-statement-migration',
  'npm --prefix backend run verify:shipment-statement-constraints',
  'npm --prefix backend run test:shipment-quantities',
  'npm --prefix backend run test:approved-pricing',
  'npm --prefix backend run test:approved-pricing:db',
  'npm --prefix backend run test:approved-pricing:concurrency',
  'npm --prefix backend run test:priced-allocation-ledger',
  'npm --prefix backend run test:priced-allocation-ledger:db',
  'npm --prefix backend run test:dispatch-documents',
  'npm --prefix backend run test:dispatch-documents:db',
  'npm --prefix backend run test:statement-adjustments',
  'npm --prefix backend run test:statement-adjustments:db',
  'npm --prefix backend run test:dispatch-document-recovery',
  'npm --prefix backend run test:shipment-statement-concurrency:harness',
  'npm --prefix backend run test:shipment-statement-concurrency:db',
  'npm --prefix backend run verify:dispatch-allocations',
  'npm --prefix backend run verify:dispatch-confirmation',
  'npm --prefix backend run verify:physical-gate-exit',
  'npm --prefix backend run verify:dispatch-corrections-outages',
  'npm run test:dispatch-document-pdfs:docker',
  'npm --prefix frontend run test:accounting-dispatch-documents',
  'npx playwright test --config=playwright.design-system.config.ts tests/design-system-e2e/accounting-dispatch-documents.spec.ts',
  'npm run design-system:check',
  'npm run test:design-system-foundation',
  'npm run test:design-system-adoption',
  'npm run build',
  'npm run docker:verify',
] as const;

export type CutoverEvidence = {
  environment: { composeProject: string; servicesHealthy: boolean };
  deployment: {
    additiveMigrationsOnly: boolean;
    constraintsVerified: boolean;
    databaseGateEnabled: boolean;
    environmentGateEnabled: boolean;
    migrationRuns: Array<{ runNumber: number; status: 'STARTED' | 'COMPLETED' | 'FAILED'; preservationScopes: number; mismatches: number }>;
  };
  preservation: Array<{
    scope: string;
    beforeCount: string;
    afterCount: string;
    beforeIdentityHash: string;
    afterIdentityHash: string;
    beforeQuantityScale3: string | null;
    afterQuantityScale3: string | null;
    beforeAmountScale12: string | null;
    afterAmountScale12: string | null;
    beforeEvidenceHash: string;
    afterEvidenceHash: string;
  }>;
  recovery: {
    backupSha256: string;
    backupRestored: boolean;
    restoreDrillProject: string;
    restoredEvidenceHash: string;
    sourceEvidenceHash: string;
  };
  legacy: {
    dryRunCompleted: boolean;
    applyCompleted: boolean;
    repeatCompleted: boolean;
    repeatCreatedCount: number;
    unresolvedCount: number;
    quarantinedCount: number;
    unreviewedCohortCount: number;
  };
  integrity: {
    orphanArtifactCount: number;
    incompleteBundleCount: number;
    auditGapCount: number;
    corruptArtifactCount: number;
    recoveryFailures: number;
    evidenceArtifactSha256: string;
  };
  concurrency: { completedRuns: number; anomalyCount: number; evidenceArtifactSha256: string };
  acceptance: Array<{ command: string; exitCode: number; outputSha256: string }>;
  operations: { incidentContacts: string[]; monitoringChecks: string[] };
};

export type CutoverDecision = { decision: 'GO' | 'NO_GO'; failures: string[] };

const sha256Pattern = /^[0-9a-f]{64}$/;
const addCountFailure = (failures: string[], name: string, count: number) => {
  if (!Number.isSafeInteger(count) || count !== 0) failures.push(`${name}:${count}`);
};

export const evaluateCutoverEvidence = (evidence: CutoverEvidence): CutoverDecision => {
  const failures: string[] = [];
  if (evidence.environment.composeProject !== 'sabalanerp-local') failures.push('ENVIRONMENT_NOT_SABALANERP_LOCAL');
  if (!evidence.environment.servicesHealthy) failures.push('ENVIRONMENT_UNHEALTHY');
  if (!evidence.deployment.additiveMigrationsOnly) failures.push('MIGRATIONS_NOT_PROVEN_ADDITIVE');
  if (!evidence.deployment.constraintsVerified) failures.push('CONSTRAINTS_UNVERIFIED');
  if (evidence.deployment.databaseGateEnabled) failures.push('DATABASE_GATE_ALREADY_ENABLED');
  if (evidence.deployment.environmentGateEnabled) failures.push('ENVIRONMENT_GATE_ALREADY_ENABLED');
  if (evidence.deployment.migrationRuns.length < 2) failures.push('MIGRATION_IDEMPOTENCY_UNPROVEN');
  for (const run of evidence.deployment.migrationRuns) {
    if (run.status !== 'COMPLETED' || run.preservationScopes === 0 || run.mismatches !== 0) {
      failures.push(`MIGRATION_RUN_FAILED:${run.runNumber}`);
    }
  }
  const preservationByScope = new Map(evidence.preservation.map(item => [item.scope, item]));
  for (const scope of SHIPMENT_STATEMENT_PRESERVATION_SCOPES) {
    if (!preservationByScope.has(scope)) failures.push(`PRESERVATION_SCOPE_MISSING:${scope}`);
  }
  for (const item of evidence.preservation) {
    const comparisons: Array<[string, unknown, unknown]> = [
      ['COUNT', item.beforeCount, item.afterCount],
      ['IDENTITY_HASH', item.beforeIdentityHash, item.afterIdentityHash],
      ['QUANTITY_SCALE_3', item.beforeQuantityScale3, item.afterQuantityScale3],
      ['AMOUNT_SCALE_12', item.beforeAmountScale12, item.afterAmountScale12],
      ['EVIDENCE_HASH', item.beforeEvidenceHash, item.afterEvidenceHash],
    ];
    for (const [field, before, after] of comparisons) {
      if (before !== after) failures.push(`PRESERVATION_MISMATCH:${item.scope}:${field}`);
    }
    if (!/^\d+$/.test(item.beforeCount) || !/^\d+$/.test(item.afterCount)) failures.push(`PRESERVATION_INVALID:${item.scope}:COUNT`);
    if (!sha256Pattern.test(item.beforeIdentityHash) || !sha256Pattern.test(item.afterIdentityHash)) failures.push(`PRESERVATION_INVALID:${item.scope}:IDENTITY_HASH`);
    if (item.beforeQuantityScale3 !== null && !/^-?\d+\.\d{3}$/.test(item.beforeQuantityScale3)) failures.push(`PRESERVATION_INVALID:${item.scope}:QUANTITY_SCALE_3`);
    if (item.afterQuantityScale3 !== null && !/^-?\d+\.\d{3}$/.test(item.afterQuantityScale3)) failures.push(`PRESERVATION_INVALID:${item.scope}:QUANTITY_SCALE_3`);
    if (item.beforeAmountScale12 !== null && !/^-?\d+\.\d{12}$/.test(item.beforeAmountScale12)) failures.push(`PRESERVATION_INVALID:${item.scope}:AMOUNT_SCALE_12`);
    if (item.afterAmountScale12 !== null && !/^-?\d+\.\d{12}$/.test(item.afterAmountScale12)) failures.push(`PRESERVATION_INVALID:${item.scope}:AMOUNT_SCALE_12`);
    if (!sha256Pattern.test(item.beforeEvidenceHash) || !sha256Pattern.test(item.afterEvidenceHash)) failures.push(`PRESERVATION_INVALID:${item.scope}:EVIDENCE_HASH`);
  }
  if (!sha256Pattern.test(evidence.recovery.backupSha256)) failures.push('BACKUP_HASH_INVALID');
  if (!evidence.recovery.backupRestored) failures.push('RESTORE_DRILL_MISSING');
  if (evidence.recovery.restoreDrillProject !== 'sabalanerp-local') failures.push('RESTORE_DRILL_WRONG_PROJECT');
  if (!sha256Pattern.test(evidence.recovery.restoredEvidenceHash)) failures.push('RESTORED_EVIDENCE_HASH_INVALID');
  if (!sha256Pattern.test(evidence.recovery.sourceEvidenceHash)) failures.push('SOURCE_EVIDENCE_HASH_INVALID');
  if (evidence.recovery.restoredEvidenceHash !== evidence.recovery.sourceEvidenceHash) failures.push('RESTORE_EVIDENCE_MISMATCH');
  if (!evidence.legacy.dryRunCompleted || !evidence.legacy.applyCompleted || !evidence.legacy.repeatCompleted) failures.push('LEGACY_PREFLIGHT_INCOMPLETE');
  addCountFailure(failures, 'LEGACY_REPEAT_CREATED', evidence.legacy.repeatCreatedCount);
  addCountFailure(failures, 'LEGACY_UNRESOLVED', evidence.legacy.unresolvedCount);
  addCountFailure(failures, 'LEGACY_QUARANTINED', evidence.legacy.quarantinedCount);
  addCountFailure(failures, 'LEGACY_UNREVIEWED', evidence.legacy.unreviewedCohortCount);
  addCountFailure(failures, 'ORPHAN_ARTIFACTS', evidence.integrity.orphanArtifactCount);
  addCountFailure(failures, 'INCOMPLETE_BUNDLES', evidence.integrity.incompleteBundleCount);
  addCountFailure(failures, 'AUDIT_GAPS', evidence.integrity.auditGapCount);
  addCountFailure(failures, 'CORRUPT_ARTIFACTS', evidence.integrity.corruptArtifactCount);
  addCountFailure(failures, 'RECOVERY_FAILURES', evidence.integrity.recoveryFailures);
  if (!sha256Pattern.test(evidence.integrity.evidenceArtifactSha256)) failures.push('AUDIT_RECOVERY_EVIDENCE_HASH_INVALID');
  if (evidence.concurrency.completedRuns < 3) failures.push('CONCURRENCY_REPETITION_INCOMPLETE');
  addCountFailure(failures, 'CONCURRENCY_ANOMALIES', evidence.concurrency.anomalyCount);
  if (!sha256Pattern.test(evidence.concurrency.evidenceArtifactSha256)) failures.push('CONCURRENCY_EVIDENCE_HASH_INVALID');
  const commandResults = new Map(evidence.acceptance.map(result => [result.command, result]));
  for (const command of CUTOVER_ACCEPTANCE_COMMANDS) {
    const result = commandResults.get(command);
    if (!result) failures.push(`ACCEPTANCE_MISSING:${command}`);
    else if (result.exitCode !== 0 || !sha256Pattern.test(result.outputSha256)) failures.push(`ACCEPTANCE_FAILED:${command}`);
  }
  if (evidence.operations.incidentContacts.length === 0) failures.push('INCIDENT_CONTACTS_MISSING');
  if (evidence.operations.monitoringChecks.length === 0) failures.push('MONITORING_CHECKLIST_MISSING');
  return { decision: failures.length === 0 ? 'GO' : 'NO_GO', failures };
};

type ManifestCore = {
  schemaVersion: 1;
  releaseId: string;
  migrationManifestId: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  sourceCommit: string;
  evidence: CutoverEvidence;
  decision: 'GO' | 'NO_GO';
  failures: string[];
};

export type SignedCutoverManifest = ManifestCore & {
  integrityHash: string;
  signature: { algorithm: 'HMAC-SHA256'; keyId: string; value: string };
};

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Manifest contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
  }
  throw new Error('Manifest contains an unsupported value.');
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sign = (integrityHash: string, signingKey: string) => createHmac('sha256', signingKey).update(integrityHash).digest('hex');

export const buildCutoverManifest = (input: {
  releaseId: string;
  migrationManifestId: string;
  createdAt: string;
  createdBy: string;
  sourceCommit: string;
  evidence: CutoverEvidence;
  keyId: string;
  signingKey: string;
}): SignedCutoverManifest => {
  if (input.signingKey.length < 32) throw new Error('The cutover signing key must contain at least 32 characters.');
  const decision = evaluateCutoverEvidence(input.evidence);
  const createdAt = new Date(input.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error('The cutover manifest creation time is invalid.');
  const core: ManifestCore = { schemaVersion: 1, releaseId: input.releaseId, migrationManifestId: input.migrationManifestId,
    createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
    createdBy: input.createdBy, sourceCommit: input.sourceCommit,
    evidence: input.evidence, ...decision };
  const integrityHash = hash(canonicalize(core));
  return { ...core, integrityHash,
    signature: { algorithm: 'HMAC-SHA256', keyId: input.keyId, value: sign(integrityHash, input.signingKey) } };
};

export const verifyCutoverManifest = (manifest: SignedCutoverManifest, signingKey: string): void => {
  if (signingKey.length < 32) throw new Error('The cutover signing key must contain at least 32 characters.');
  const { integrityHash, signature, ...core } = manifest;
  if (hash(canonicalize(core)) !== integrityHash) throw new Error('Cutover manifest integrity verification failed.');
  const expected = Buffer.from(sign(integrityHash, signingKey), 'hex');
  const actual = Buffer.from(signature.value, 'hex');
  if (signature.algorithm !== 'HMAC-SHA256' || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Cutover manifest signature verification failed.');
  }
  const evaluated = evaluateCutoverEvidence(manifest.evidence);
  if (evaluated.decision !== manifest.decision || canonicalize(evaluated.failures) !== canonicalize(manifest.failures)) {
    throw new Error('Cutover manifest decision does not match its evidence.');
  }
};

export const writeImmutableCutoverManifest = async (destination: string, manifest: SignedCutoverManifest): Promise<void> => {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Cutover manifest already exists: ${destination}`);
    throw error;
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
};

export const readAndVerifyCutoverManifest = async (source: string, signingKey: string): Promise<SignedCutoverManifest> => {
  const manifest = JSON.parse(await readFile(source, 'utf8')) as SignedCutoverManifest;
  verifyCutoverManifest(manifest, signingKey);
  return manifest;
};

export type ShipmentStatementCutoverState = {
  enabled: boolean;
  cutoverAt: Date | null;
  manifestId: string | null;
  integrityHash: string | null;
};

export type ShipmentStatementCutoverRepository = {
  loadState(): Promise<ShipmentStatementCutoverState>;
  activate(input: { expectedDisabled: true; migrationManifestId: string; integrityHash: string; activatedBy: string; expiresAt: Date }): Promise<ShipmentStatementCutoverState & { activatedAt: Date; activatedBy: string }>;
};

export const activateShipmentStatementCutover = async (input: {
  repository: ShipmentStatementCutoverRepository;
  manifest: SignedCutoverManifest;
  activatedBy: string;
  signingKey: string;
  environment: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}) => {
  verifyCutoverManifest(input.manifest, input.signingKey);
  if (input.manifest.decision !== 'GO') throw new Error('A NO-GO cutover manifest cannot activate Customer Shipment Statements.');
  const now = (input.now ?? (() => new Date()))();
  if (now.getTime() > new Date(input.manifest.expiresAt).getTime()) {
    throw new Error('The GO cutover manifest expired; rerun every cutover gate and create a new immutable manifest.');
  }
  if (input.environment.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED === 'true') {
    throw new Error('The environment feature flag must remain disabled until database cutover activation commits.');
  }
  const state = await input.repository.loadState();
  if (state.enabled) throw new Error('Customer Shipment Statements are already activated; cutover is one-way.');
  return input.repository.activate({ expectedDisabled: true, migrationManifestId: input.manifest.migrationManifestId,
    integrityHash: input.manifest.integrityHash, activatedBy: input.activatedBy,
    expiresAt: new Date(input.manifest.expiresAt) });
};
