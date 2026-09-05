import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
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
  'npm run test:accounting-dispatch-documents:e2e:real',
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
    artifactPath: string;
    backupPath: string;
    evidenceArtifactSha256: string;
    backupSha256: string;
    backupRestored: boolean;
    restoreDrillProject: string;
    restoredEvidenceHash: string;
    sourceEvidenceHash: string;
  };
  legacy: {
    dryRunArtifactPath: string;
    applyArtifactPath: string;
    repeatArtifactPath: string;
    cohortArtifactPath: string;
    cohortApprovalArtifactPath: string;
    dryRunArtifactSha256: string;
    applyArtifactSha256: string;
    repeatArtifactSha256: string;
    cohortArtifactSha256: string;
    cohortApprovalArtifactSha256: string;
    manifestHash: string;
    dryRunCompleted: boolean;
    applyCompleted: boolean;
    repeatCompleted: boolean;
    repeatCreatedCount: number;
    unresolvedCount: number;
    quarantinedCount: number;
    unreviewedCohortCount: number;
    sourceCounts: Record<string, number>;
    releaseCohortCounts: Record<string, number>;
    releaseCohortCount: number;
    excludedBlockedCount: number;
  };
  integrity: {
    artifactPath: string;
    orphanArtifactCount: number;
    incompleteBundleCount: number;
    auditGapCount: number;
    corruptArtifactCount: number;
    recoveryFailures: number;
    evidenceArtifactSha256: string;
  };
  concurrency: { artifactPath: string; completedRuns: number; anomalyCount: number; evidenceArtifactSha256: string };
  acceptance: Array<{ command: string; artifactPath: string; artifactSha256: string; semanticDigest: string; exitCode: number; outputSha256: string }>;
  operations: { incidentContacts: string[]; monitoringChecks: string[] };
};

export type CutoverDecision = { decision: 'GO' | 'NO_GO'; failures: string[] };

const sha256Pattern = /^[0-9a-f]{64}$/;
const requiredArtifactPath = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} artifact path is required.`);
  return value;
};
const readArtifact = async (path: unknown, label: string): Promise<{ bytes: Buffer; value: Record<string, any> }> => {
  const source = requiredArtifactPath(path, label);
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch {
    throw new Error(`${label} artifact could not be read: ${source}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} artifact is not valid JSON: ${source}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} artifact must be a JSON object.`);
  return { bytes, value: value as Record<string, any> };
};
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const volatileEvidenceKey = /^(?:runId|duration(?:Ms)?|elapsed(?:Ms)?|path|.*Path|timestamp|startedAt|completedAt|createdAt|updatedAt)$/i;
const normalizeSemanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !volatileEvidenceKey.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeSemanticValue(item)]));
  }
  return value;
};
export const acceptanceSemanticDigest = (output: string): string => {
  let normalized: string;
  try {
    normalized = JSON.stringify(normalizeSemanticValue(JSON.parse(output)));
  } catch {
    normalized = output
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<timestamp>')
      .replace(/\b(runId|duration(?:Ms)?|elapsed(?:Ms)?|path)\s*[:=]\s*[^\s,;]+/gi, '$1=<volatile>')
      .replace(/[A-Za-z]:\\[^\s,;]+/g, '<path>')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  return hashBytes(Buffer.from(normalized));
};
const exact = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label} does not match the independently captured evidence.`);
};

export type LegacyPricingCohortSnapshot = {
  manifestHash: string;
  sourceContractCount: string | number;
  sourceApprovalRecordCount: string | number;
  sourceRowCount: string | number;
  counts: Record<string, number>;
  entries: Array<{
    contractId: string;
    sourceFinancialRecordId: string;
    sourceEvidenceHash: string;
    status: string;
  }>;
};

type CommandExecution = { exitCode: number; stdout: string; stderr: string };

export const captureAuthoritativeCutoverGates = async (evidence: CutoverEvidence, input: {
  artifactDirectory: string;
  sourceCommit: string;
  incidentContacts: string[];
  monitoringChecks: string[];
  run(command: string): Promise<CommandExecution>;
}): Promise<CutoverEvidence> => {
  const verified = structuredClone(evidence);
  await mkdir(input.artifactDirectory, { recursive: true });
  const composeCommand = 'docker compose -f docker-compose.local.yml ps --format json';
  const compose = await input.run(composeCommand);
  let servicesHealthy = false;
  if (compose.exitCode === 0) {
    try {
      const services = compose.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      servicesHealthy = services.length > 0 && services.every(service => service.State === 'running' && service.Health === 'healthy');
    } catch {
      servicesHealthy = false;
    }
  }
  verified.environment = { composeProject: 'sabalanerp-local', servicesHealthy };

  const acceptance: CutoverEvidence['acceptance'] = [];
  for (const [index, command] of CUTOVER_ACCEPTANCE_COMMANDS.entries()) {
    const startedAt = new Date().toISOString();
    const result = await input.run(command);
    const completedAt = new Date().toISOString();
    const outputPath = join(input.artifactDirectory, `acceptance-${String(index + 1).padStart(2, '0')}.log`);
    const output = `${result.stdout}${result.stderr}`;
    await writeFile(outputPath, output, { encoding: 'utf8', flag: 'wx' });
    const artifactPath = join(input.artifactDirectory, `acceptance-${String(index + 1).padStart(2, '0')}.json`);
    const semanticDigest = acceptanceSemanticDigest(output);
    const receipt = { schemaVersion: 1, command, exitCode: result.exitCode, semanticDigest, startedAt, completedAt,
      sourceCommit: input.sourceCommit, outputPath };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(artifactPath, receiptBytes, { flag: 'wx' });
    acceptance.push({ command, artifactPath, artifactSha256: hashBytes(receiptBytes), semanticDigest, exitCode: result.exitCode,
      outputSha256: hashBytes(Buffer.from(output)) });
  }
  verified.acceptance = acceptance;
  const exitCode = (command: string) => acceptance.find(item => item.command === command)?.exitCode;
  verified.deployment.additiveMigrationsOnly = exitCode('npm --prefix backend run verify:shipment-statement-migration') === 0;
  verified.deployment.constraintsVerified = exitCode('npm --prefix backend run verify:shipment-statement-constraints') === 0;
  verified.operations = { incidentContacts: [...input.incidentContacts], monitoringChecks: [...input.monitoringChecks] };
  return verified;
};

export const assertAuthoritativeGateParity = (signed: CutoverEvidence, current: CutoverEvidence): void => {
  if (signed.environment.composeProject !== current.environment.composeProject
    || signed.environment.servicesHealthy !== current.environment.servicesHealthy
    || !current.environment.servicesHealthy) {
    throw new Error('Authoritative environment gate drifted after the cutover manifest was signed.');
  }
  if (signed.deployment.additiveMigrationsOnly !== current.deployment.additiveMigrationsOnly
    || signed.deployment.constraintsVerified !== current.deployment.constraintsVerified
    || !current.deployment.additiveMigrationsOnly || !current.deployment.constraintsVerified) {
    throw new Error('Authoritative migration or constraint gate drifted after the cutover manifest was signed.');
  }
  const signedCommands = new Map(signed.acceptance.map(item => [item.command, { exitCode: item.exitCode, semanticDigest: item.semanticDigest }]));
  const currentCommands = new Map(current.acceptance.map(item => [item.command, { exitCode: item.exitCode, semanticDigest: item.semanticDigest }]));
  if (signedCommands.size !== CUTOVER_ACCEPTANCE_COMMANDS.length || currentCommands.size !== CUTOVER_ACCEPTANCE_COMMANDS.length
    || CUTOVER_ACCEPTANCE_COMMANDS.some(command => {
      const before = signedCommands.get(command);
      const after = currentCommands.get(command);
      return before?.exitCode !== 0 || after?.exitCode !== 0 || before.semanticDigest !== after.semanticDigest;
    })) {
    throw new Error('Authoritative acceptance gate drifted after the cutover manifest was signed.');
  }
  if (JSON.stringify(signed.operations) !== JSON.stringify(current.operations)
    || current.operations.incidentContacts.length === 0 || current.operations.monitoringChecks.length === 0) {
    throw new Error('Authoritative operations gate drifted after the cutover manifest was signed.');
  }
};

/** Replaces caller claims with values read from immutable run artifacts and an independently recaptured legacy cohort. */
export const verifyFileBackedCutoverEvidence = async (
  evidence: CutoverEvidence,
  recaptureLegacyCohort: () => Promise<LegacyPricingCohortSnapshot>,
  cohortApprovalVerifier?: { keyId: string; signingKey: string },
): Promise<CutoverEvidence> => {
  const verified = structuredClone(evidence);

  const recovery = await readArtifact(verified.recovery.artifactPath, 'Recovery');
  const recoveryValue = recovery.value;
  const backupPath = requiredArtifactPath(recoveryValue.backupPath, 'Recovery backup');
  const backupBytes = await readFile(backupPath).catch(() => {
    throw new Error(`Recovery backup artifact could not be read: ${backupPath}`);
  });
  exact(verified.recovery.backupPath, backupPath, 'Recovery backup path');
  verified.recovery = {
    artifactPath: verified.recovery.artifactPath,
    backupPath,
    evidenceArtifactSha256: hashBytes(recovery.bytes),
    backupSha256: hashBytes(backupBytes),
    backupRestored: recoveryValue.backupRestored === true,
    restoreDrillProject: String(recoveryValue.restoreDrillProject ?? ''),
    restoredEvidenceHash: String(recoveryValue.restoredEvidenceHash ?? ''),
    sourceEvidenceHash: String(recoveryValue.sourceEvidenceHash ?? ''),
  };

  const integrity = await readArtifact(verified.integrity.artifactPath, 'Audit/recovery');
  verified.integrity = {
    artifactPath: verified.integrity.artifactPath,
    orphanArtifactCount: Number(integrity.value.orphanArtifactCount),
    incompleteBundleCount: Number(integrity.value.incompleteBundleCount),
    auditGapCount: Number(integrity.value.auditGapCount),
    corruptArtifactCount: Number(integrity.value.corruptArtifactCount),
    recoveryFailures: Number(integrity.value.recoveryFailures),
    evidenceArtifactSha256: hashBytes(integrity.bytes),
  };

  const concurrency = await readArtifact(verified.concurrency.artifactPath, 'Concurrency');
  if (!Array.isArray(concurrency.value.runs)) throw new Error('Concurrency artifact must contain a runs array.');
  const anomalyCount = concurrency.value.runs.reduce((sum: number, run: any) => sum + Number(run?.anomalyCount), 0);
  if (concurrency.value.runs.some((run: any) => !Number.isSafeInteger(run?.anomalyCount) || run.anomalyCount < 0)) {
    throw new Error('Concurrency artifact contains an invalid anomaly count.');
  }
  verified.concurrency = { artifactPath: verified.concurrency.artifactPath, completedRuns: concurrency.value.runs.length,
    anomalyCount, evidenceArtifactSha256: hashBytes(concurrency.bytes) };

  verified.acceptance = await Promise.all(verified.acceptance.map(async claim => {
    const artifact = await readArtifact(claim.artifactPath, `Acceptance ${claim.command}`);
    exact(artifact.value.command, claim.command, `Acceptance command ${claim.command}`);
    const outputPath = requiredArtifactPath(artifact.value.outputPath, `Acceptance output ${claim.command}`);
    const output = await readFile(outputPath).catch(() => {
      throw new Error(`Acceptance output artifact could not be read: ${outputPath}`);
    });
    const semanticDigest = acceptanceSemanticDigest(output.toString('utf8'));
    exact(artifact.value.semanticDigest, semanticDigest, `Acceptance semantic digest ${claim.command}`);
    return { command: claim.command, artifactPath: claim.artifactPath, artifactSha256: hashBytes(artifact.bytes), semanticDigest,
      exitCode: Number(artifact.value.exitCode), outputSha256: hashBytes(output) };
  }));

  const [dry, apply, repeat, cohort, cohortApproval, current] = await Promise.all([
    readArtifact(verified.legacy.dryRunArtifactPath, 'Legacy dry-run'),
    readArtifact(verified.legacy.applyArtifactPath, 'Legacy apply'),
    readArtifact(verified.legacy.repeatArtifactPath, 'Legacy repeat'),
    readArtifact(verified.legacy.cohortArtifactPath, 'Legacy release cohort'),
    readArtifact(verified.legacy.cohortApprovalArtifactPath, 'Legacy release cohort approval'),
    recaptureLegacyCohort(),
  ]);
  exact(dry.value.mode, 'DRY_RUN', 'Legacy dry-run mode');
  exact(apply.value.mode, 'APPLY', 'Legacy apply mode');
  exact(repeat.value.mode, 'APPLY', 'Legacy repeat mode');
  for (const [label, artifact] of [['dry-run', dry], ['apply', apply], ['repeat', repeat]] as const) {
    exact(artifact.value.status, 'COMPLETED', `Legacy ${label} status`);
    if (!artifact.value.afterManifest || typeof artifact.value.afterManifest !== 'object') throw new Error(`Legacy ${label} artifact has no afterManifest.`);
  }
  if (!apply.value.beforeManifest || !repeat.value.beforeManifest) throw new Error('Legacy apply/repeat artifacts must contain beforeManifest.');
  exact(dry.value.afterManifest.manifestHash, apply.value.beforeManifest.manifestHash, 'Legacy dry-run/apply cohort');
  exact(apply.value.afterManifest.manifestHash, repeat.value.beforeManifest.manifestHash, 'Legacy apply/repeat cohort');
  exact(repeat.value.beforeManifest.manifestHash, repeat.value.afterManifest.manifestHash, 'Legacy repeat idempotency');
  exact(apply.value.sourceComparison?.matched, true, 'Legacy apply source comparison');
  exact(repeat.value.sourceComparison?.matched, true, 'Legacy repeat source comparison');
  exact(repeat.value.afterManifest.manifestHash, current.manifestHash, 'Legacy cohort manifest hash');
  for (const field of ['sourceContractCount', 'sourceApprovalRecordCount', 'sourceRowCount'] as const) {
    exact(String(repeat.value.afterManifest[field]), String(current[field]), `Legacy cohort ${field}`);
  }
  exact(JSON.stringify(repeat.value.afterManifest.counts), JSON.stringify(current.counts), 'Legacy cohort counts');
  exact(cohort.value.schemaVersion, 1, 'Legacy release cohort schema version');
  exact(cohort.value.sourceManifestHash, current.manifestHash, 'Legacy release cohort source manifest hash');
  if (!Array.isArray(cohort.value.entries)) throw new Error('Legacy release cohort artifact must contain an entries array.');
  if (cohort.value.entries.length > 0) {
    if (!cohortApprovalVerifier || cohortApprovalVerifier.signingKey.length < 32) {
      throw new Error('A trusted legacy release cohort approval verifier is required.');
    }
    exact(cohortApproval.value.algorithm, 'HMAC-SHA256', 'Legacy release cohort approval algorithm');
    exact(cohortApproval.value.keyId, cohortApprovalVerifier.keyId, 'Legacy release cohort approval key');
    if (typeof cohortApproval.value.approvedBy !== 'string' || !cohortApproval.value.approvedBy.trim()) {
      throw new Error('Legacy release cohort approval is missing its approver identity.');
    }
    const approvalPayload = JSON.stringify({ algorithm: 'HMAC-SHA256', keyId: cohortApprovalVerifier.keyId,
      approvedBy: cohortApproval.value.approvedBy.trim(), cohortSha256: hashBytes(cohort.bytes) });
    const expectedSignature = Buffer.from(createHmac('sha256', cohortApprovalVerifier.signingKey).update(approvalPayload).digest('hex'), 'hex');
    const actualSignature = Buffer.from(String(cohortApproval.value.signature ?? ''), 'hex');
    if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
      throw new Error('Legacy release cohort approval signature verification failed.');
    }
  }
  if (current.entries.length !== Number(current.sourceContractCount)) {
    throw new Error('Legacy release cohort snapshot does not contain every source contract.');
  }
  const dispositions = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of cohort.value.entries.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Legacy release cohort disposition ${index} is invalid.`);
    const disposition = raw as Record<string, unknown>;
    const identity = `${String(disposition.contractId ?? '')}:${String(disposition.sourceFinancialRecordId ?? '')}`;
    if (identity === ':' || dispositions.has(identity)) throw new Error(`Legacy release cohort disposition ${index} has an invalid or duplicate identity.`);
    if (typeof disposition.reviewedBy !== 'string' || !disposition.reviewedBy.trim()
      || typeof disposition.reason !== 'string' || !disposition.reason.trim()
      || typeof disposition.reviewedAt !== 'string' || Number.isNaN(Date.parse(disposition.reviewedAt))) {
      throw new Error(`Legacy release cohort disposition ${index} has incomplete review evidence.`);
    }
    dispositions.set(identity, disposition);
  }
  const included: LegacyPricingCohortSnapshot['entries'] = [];
  let excludedBlockedCount = 0;
  for (const entry of current.entries) {
    const identity = `${entry.contractId}:${entry.sourceFinancialRecordId}`;
    const disposition = dispositions.get(identity);
    if (!disposition) throw new Error(`Legacy release cohort disposition is missing for ${identity}.`);
    exact(disposition.sourceEvidenceHash, entry.sourceEvidenceHash, `Legacy release cohort disposition ${identity} hash`);
    if (disposition.decision === 'INCLUDE') included.push(entry);
    else if (disposition.decision === 'EXCLUDE_BLOCKED' && entry.status === 'REPAIR_REQUIRED') excludedBlockedCount += 1;
    else throw new Error(`Legacy release cohort disposition ${identity} is not permitted for ${entry.status}.`);
    dispositions.delete(identity);
  }
  if (dispositions.size !== 0) throw new Error('Legacy release cohort artifact contains identities outside the current source cohort.');
  const unresolvedCount = included.filter(entry => ['REPAIR_REQUIRED', 'EVIDENCE_CONFLICT', 'STALE'].includes(entry.status)).length;
  const releaseCohortCounts = Object.fromEntries(Object.keys(current.counts).map(status => [status, 0])) as Record<string, number>;
  for (const entry of included) releaseCohortCounts[entry.status] = (releaseCohortCounts[entry.status] ?? 0) + 1;
  verified.legacy = {
    ...verified.legacy,
    dryRunArtifactSha256: hashBytes(dry.bytes),
    applyArtifactSha256: hashBytes(apply.bytes),
    repeatArtifactSha256: hashBytes(repeat.bytes),
    cohortArtifactSha256: hashBytes(cohort.bytes),
    cohortApprovalArtifactSha256: hashBytes(cohortApproval.bytes),
    manifestHash: current.manifestHash,
    dryRunCompleted: true,
    applyCompleted: true,
    repeatCompleted: true,
    repeatCreatedCount: Number(repeat.value.outcomeCounts?.SEALED ?? Number.NaN),
    unresolvedCount,
    quarantinedCount: unresolvedCount,
    unreviewedCohortCount: included.filter(entry => entry.status === 'LEGACY_REVIEW_REQUIRED').length,
    sourceCounts: { ...current.counts },
    releaseCohortCounts,
    releaseCohortCount: included.length,
    excludedBlockedCount,
  };
  return verified;
};
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
  if (!sha256Pattern.test(evidence.recovery.evidenceArtifactSha256)) failures.push('RECOVERY_EVIDENCE_HASH_INVALID');
  if (!sha256Pattern.test(evidence.recovery.backupSha256)) failures.push('BACKUP_HASH_INVALID');
  if (!evidence.recovery.backupRestored) failures.push('RESTORE_DRILL_MISSING');
  if (evidence.recovery.restoreDrillProject !== 'sabalanerp-local') failures.push('RESTORE_DRILL_WRONG_PROJECT');
  if (!sha256Pattern.test(evidence.recovery.restoredEvidenceHash)) failures.push('RESTORED_EVIDENCE_HASH_INVALID');
  if (!sha256Pattern.test(evidence.recovery.sourceEvidenceHash)) failures.push('SOURCE_EVIDENCE_HASH_INVALID');
  if (evidence.recovery.restoredEvidenceHash !== evidence.recovery.sourceEvidenceHash) failures.push('RESTORE_EVIDENCE_MISMATCH');
  if (!evidence.legacy.dryRunCompleted || !evidence.legacy.applyCompleted || !evidence.legacy.repeatCompleted) failures.push('LEGACY_PREFLIGHT_INCOMPLETE');
  if (!sha256Pattern.test(evidence.legacy.dryRunArtifactSha256)
    || !sha256Pattern.test(evidence.legacy.applyArtifactSha256)
    || !sha256Pattern.test(evidence.legacy.repeatArtifactSha256)
    || !sha256Pattern.test(evidence.legacy.cohortArtifactSha256)
    || !sha256Pattern.test(evidence.legacy.cohortApprovalArtifactSha256)) failures.push('LEGACY_ARTIFACT_HASH_INVALID');
  if (!sha256Pattern.test(evidence.legacy.manifestHash)) failures.push('LEGACY_MANIFEST_HASH_INVALID');
  addCountFailure(failures, 'LEGACY_REPEAT_CREATED', evidence.legacy.repeatCreatedCount);
  addCountFailure(failures, 'LEGACY_UNRESOLVED', evidence.legacy.unresolvedCount);
  addCountFailure(failures, 'LEGACY_QUARANTINED', evidence.legacy.quarantinedCount);
  addCountFailure(failures, 'LEGACY_UNREVIEWED', evidence.legacy.unreviewedCohortCount);
  if (!Number.isSafeInteger(evidence.legacy.releaseCohortCount) || evidence.legacy.releaseCohortCount < 0) failures.push('LEGACY_RELEASE_COHORT_COUNT_INVALID');
  if (!Number.isSafeInteger(evidence.legacy.excludedBlockedCount) || evidence.legacy.excludedBlockedCount < 0) failures.push('LEGACY_EXCLUDED_BLOCKED_COUNT_INVALID');
  for (const [scope, counts] of [['SOURCE', evidence.legacy.sourceCounts], ['RELEASE', evidence.legacy.releaseCohortCounts]] as const) {
    if (!counts || Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0)) failures.push(`LEGACY_${scope}_COUNTS_INVALID`);
  }
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
    else if (result.exitCode !== 0 || !sha256Pattern.test(result.artifactSha256)
      || !sha256Pattern.test(result.semanticDigest) || !sha256Pattern.test(result.outputSha256)) failures.push(`ACCEPTANCE_FAILED:${command}`);
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
