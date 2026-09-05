import { exec, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { link, mkdir, mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  activateShipmentStatementCutover,
  assertAuthoritativeGateParity,
  buildCutoverManifest,
  captureAuthoritativeCutoverGates,
  evaluateCutoverEvidence,
  readAndVerifyCutoverManifest,
  verifyFileBackedCutoverEvidence,
  writeImmutableCutoverManifest,
  type CutoverEvidence,
} from '../src/services/shipmentStatementCutover';
import { PrismaShipmentStatementCutoverRepository } from '../src/services/shipmentStatementCutover/prismaRepository';
import { assertProtectedProductionCutoverBoundary } from '../src/services/shipmentStatementCutover/productionBoundary';
import { buildLegacyPricingManifest, createPrismaLegacyPricingSealWriter, loadLegacyPricingCandidates,
  parseLegacyPricingReviews, runLegacyPricingSeal, toPersistedPricingReadiness } from '../src/services/legacyApprovedPricing';

const usage = 'Usage: shipment-statement-cutover.ts legacy --evidence <json> --artifacts <dir> --out <json> [--reviews <json>] | cohort --out <json> | manifest --evidence <json> --artifacts <dir> --out <json> | activate --manifest <json> --receipt <json>';
const args = process.argv.slice(2);
const command = args.shift();
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const requiredOption = (name: string) => {
  const value = option(name)?.trim();
  if (!value) throw new Error(`${name} is required. ${usage}`);
  return resolve(value);
};
const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const requiredEnvironmentList = (name: string) => requiredEnvironment(name).split(',').map(value => value.trim()).filter(Boolean);
const requiredSecret = (name: string) => {
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) {
    const metadata = statSync(file);
    if (!metadata.isFile()) throw new Error(`${name}_FILE must reference a regular file.`);
    if (process.env.NODE_ENV === 'production' && (metadata.mode & 0o077) !== 0) {
      throw new Error(`${name}_FILE must not be readable or writable by group or other users.`);
    }
    const value = readFileSync(file, 'utf8').trim();
    if (!value) throw new Error(`${name}_FILE is empty.`);
    return value;
  }
  if (process.env.NODE_ENV === 'production') throw new Error(`Production requires ${name}_FILE; raw secret environment values are forbidden.`);
  return requiredEnvironment(name);
};

const cutoverSigningKey = () => requiredSecret('SHIPMENT_STATEMENT_CUTOVER_SIGNING_KEY');
const cohortApprovalVerifier = () => {
  const approvalKey = requiredSecret('SHIPMENT_STATEMENT_COHORT_APPROVAL_KEY');
  const signingKey = cutoverSigningKey();
  if (approvalKey === signingKey) throw new Error('The cohort approval key must be independent from the cutover signing key.');
  return { keyId: requiredEnvironment('SHIPMENT_STATEMENT_COHORT_APPROVAL_KEY_ID'), signingKey: approvalKey };
};
const prisma = new PrismaClient();
const repository = new PrismaShipmentStatementCutoverRepository(prisma);

const recaptureLegacyCohort = async () => {
  const candidates = await prisma.$transaction(
    tx => loadLegacyPricingCandidates(tx, []),
    { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 120_000 },
  );
  const manifest = buildLegacyPricingManifest(candidates);
  return { manifestHash: manifest.manifestHash, sourceContractCount: manifest.sourceContractCount,
    sourceApprovalRecordCount: manifest.sourceApprovalRecordCount, sourceRowCount: manifest.sourceRowCount,
    counts: manifest.counts, entries: manifest.entries.map(entry => ({
      contractId: entry.contractId,
      sourceFinancialRecordId: entry.sourceFinancialRecordId,
      sourceEvidenceHash: entry.sourceEvidenceHash,
      status: entry.status,
    })) };
};

const repositoryRoot = basename(process.cwd()).toLowerCase() === 'backend' ? resolve(process.cwd(), '..') : process.cwd();
const runCommand = (command: string) => new Promise<{ exitCode: number; stdout: string; stderr: string }>(resolveRun => {
  exec(command, { cwd: repositoryRoot, env: process.env, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolveRun({ exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout, stderr });
  });
});

const writeReceipt = async (destination: string, receipt: Record<string, unknown>) => {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Cutover receipt already exists: ${destination}`);
    throw error;
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
};

const legacySealOutput = (apply: boolean, manifest: ReturnType<typeof buildLegacyPricingManifest>,
  sealRun: Awaited<ReturnType<typeof runLegacyPricingSeal>> | null) => ({
  mode: apply ? 'APPLY' as const : 'DRY_RUN' as const,
  status: sealRun?.status ?? 'COMPLETED' as const,
  reason: sealRun?.reason ?? null,
  beforeManifest: sealRun?.beforeManifest ?? manifest,
  afterManifest: sealRun?.afterManifest ?? manifest,
  sourceComparison: sealRun?.sourceComparison ?? { matched: true, differences: [] },
  sealResults: sealRun?.results ?? [],
  outcomeCounts: sealRun?.outcomeCounts ?? { SEALED: 0, REPLAYED: 0 },
  persistedReadinessProjection: (sealRun?.afterManifest ?? manifest).entries.map(entry => ({
    contractId: entry.contractId, sourceFinancialRecordId: entry.sourceFinancialRecordId,
    ...toPersistedPricingReadiness(entry),
  })),
});

const run = async () => {
  const sourceCommit = process.env.NODE_ENV === 'production'
    ? requiredEnvironment('DEPLOYMENT_TARGET_COMMIT')
    : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await assertProtectedProductionCutoverBoundary(prisma, {
    sourceCommit,
    releaseId: requiredEnvironment('SHIPMENT_STATEMENT_RELEASE_ID'),
  });
  if (command === 'legacy') {
    const artifactDirectory = requiredOption('--artifacts');
    await mkdir(artifactDirectory, { recursive: true });
    const reviewsPath = option('--reviews');
    const reviews = reviewsPath
      ? parseLegacyPricingReviews(JSON.parse(await readFile(resolve(reviewsPath), 'utf8')))
      : [];
    const capture = () => prisma.$transaction(
      tx => loadLegacyPricingCandidates(tx, reviews),
      { isolationLevel: 'Serializable' as const, maxWait: 10_000, timeout: 120_000 },
    );
    const dryCandidates = await capture();
    const dryManifest = buildLegacyPricingManifest(dryCandidates);
    const applyRun = await runLegacyPricingSeal(dryCandidates, createPrismaLegacyPricingSealWriter(prisma), { recapture: capture });
    if (applyRun.status !== 'COMPLETED') throw new Error(`Legacy pricing apply failed: ${applyRun.reason || 'unknown reason'}`);
    const repeatCandidates = await capture();
    const repeatManifest = buildLegacyPricingManifest(repeatCandidates);
    const repeatRun = await runLegacyPricingSeal(repeatCandidates, createPrismaLegacyPricingSealWriter(prisma), { recapture: capture });
    if (repeatRun.status !== 'COMPLETED') throw new Error(`Legacy pricing repeat failed: ${repeatRun.reason || 'unknown reason'}`);
    const dryPath = join(artifactDirectory, 'legacy-dry-run.json');
    const applyPath = join(artifactDirectory, 'legacy-apply.json');
    const repeatPath = join(artifactDirectory, 'legacy-repeat.json');
    const cohortPath = join(artifactDirectory, 'live-cohort.json');
    const cohortApprovalPath = join(artifactDirectory, 'live-cohort-approval.json');
    await writeReceipt(dryPath, legacySealOutput(false, dryManifest, null));
    await writeReceipt(applyPath, legacySealOutput(true, dryManifest, applyRun));
    await writeReceipt(repeatPath, legacySealOutput(true, repeatManifest, repeatRun));
    const evidence = JSON.parse(await readFile(requiredOption('--evidence'), 'utf8')) as CutoverEvidence;
    evidence.legacy = { ...evidence.legacy, dryRunArtifactPath: dryPath, applyArtifactPath: applyPath,
      repeatArtifactPath: repeatPath, cohortArtifactPath: cohortPath, cohortApprovalArtifactPath: cohortApprovalPath };
    await writeReceipt(requiredOption('--out'), evidence as unknown as Record<string, unknown>);
    console.log(JSON.stringify({ dryRunArtifactPath: dryPath, applyArtifactPath: applyPath,
      repeatArtifactPath: repeatPath, manifestHash: repeatRun.afterManifest.manifestHash }));
    return;
  }
  if (command === 'cohort') {
    const reviewer = requiredEnvironment('SHIPMENT_STATEMENT_COHORT_REVIEWER_ID');
    const reviewedAt = new Date().toISOString();
    const current = await recaptureLegacyCohort();
    const cohort = { schemaVersion: 1, sourceManifestHash: current.manifestHash,
      entries: current.entries.map(entry => ({
        contractId: entry.contractId,
        sourceFinancialRecordId: entry.sourceFinancialRecordId,
        sourceEvidenceHash: entry.sourceEvidenceHash,
        decision: entry.status === 'REPAIR_REQUIRED' ? 'EXCLUDE_BLOCKED' : 'INCLUDE',
        reviewedBy: reviewer,
        reviewedAt,
        reason: entry.status === 'REPAIR_REQUIRED'
          ? 'Blocked pre-cutover revision remains waybill-only pending source-owned correction.'
          : 'Included in the exact drained production release cohort.',
      })) };
    await writeReceipt(requiredOption('--out'), cohort);
    console.log(JSON.stringify({ sourceManifestHash: current.manifestHash,
      sourceContractCount: current.sourceContractCount, counts: current.counts, reviewer, reviewedAt }));
    return;
  }
  if (command === 'manifest') {
    const signingKey = cutoverSigningKey();
    const callerEvidence = JSON.parse(await readFile(requiredOption('--evidence'), 'utf8')) as CutoverEvidence;
    const currentLegacy = await recaptureLegacyCohort();
    const unresolvedLegacy = Number(currentLegacy.counts.REPAIR_REQUIRED ?? 0)
      + Number(currentLegacy.counts.EVIDENCE_CONFLICT ?? 0) + Number(currentLegacy.counts.STALE ?? 0);
    const unreviewedLegacy = Number(currentLegacy.counts.LEGACY_REVIEW_REQUIRED ?? 0);
    let evidence: CutoverEvidence;
    const hasReviewedReleaseCohort = Boolean(callerEvidence.legacy.cohortArtifactPath?.trim());
    if ((unresolvedLegacy !== 0 || unreviewedLegacy !== 0) && !hasReviewedReleaseCohort) {
      evidence = structuredClone(callerEvidence);
      evidence.environment = { composeProject: 'sabalanerp-local', servicesHealthy: false };
      evidence.deployment.additiveMigrationsOnly = false;
      evidence.deployment.constraintsVerified = false;
      evidence.acceptance = [];
      evidence.operations = { incidentContacts: [], monitoringChecks: [] };
      evidence.legacy = { ...evidence.legacy, manifestHash: currentLegacy.manifestHash,
        dryRunCompleted: false, applyCompleted: false, repeatCompleted: false, repeatCreatedCount: 0,
        unresolvedCount: unresolvedLegacy, quarantinedCount: unresolvedLegacy, unreviewedCohortCount: unreviewedLegacy };
    } else if (process.env.NODE_ENV === 'production') {
      evidence = await verifyFileBackedCutoverEvidence(callerEvidence, recaptureLegacyCohort, cohortApprovalVerifier(), sourceCommit);
    } else {
      const captured = await captureAuthoritativeCutoverGates(callerEvidence, {
        artifactDirectory: requiredOption('--artifacts'), sourceCommit,
        incidentContacts: requiredEnvironmentList('SHIPMENT_STATEMENT_INCIDENT_CONTACTS'),
        monitoringChecks: requiredEnvironmentList('SHIPMENT_STATEMENT_MONITORING_CHECKS'), run: runCommand,
      });
      evidence = await verifyFileBackedCutoverEvidence(captured, recaptureLegacyCohort, cohortApprovalVerifier(), sourceCommit);
    }
    const state = await repository.loadState();
    evidence.deployment.databaseGateEnabled = state.enabled;
    evidence.deployment.environmentGateEnabled = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED === 'true';
    const migration = await prisma.shipmentStatementMigrationManifest.findUnique({
      where: { migrationName: '20260809000100_shipment_statement_data_contracts' },
      include: { runs: { orderBy: { runNumber: 'desc' }, take: 2, include: { evidence: true } } },
    });
    if (!migration) throw new Error('The immutable shipment-statement migration manifest is missing.');
    evidence.deployment.migrationRuns = migration.runs.map(run => ({ runNumber: run.runNumber, status: run.status,
      preservationScopes: run.evidence.length, mismatches: run.evidence.filter(item => item.outcome !== 'MATCHED').length }));
    const latest = migration.runs[0];
    if (latest) evidence.preservation = latest.evidence.map(item => ({ scope: item.scope,
      beforeCount: item.beforeRecordCount.toString(), afterCount: item.afterRecordCount.toString(),
      beforeIdentityHash: item.beforeIdentityHash, afterIdentityHash: item.afterIdentityHash,
      beforeQuantityScale3: item.beforeQuantityTotal?.toFixed(3) ?? null,
      afterQuantityScale3: item.afterQuantityTotal?.toFixed(3) ?? null,
      beforeAmountScale12: item.beforeAmountTotal?.toFixed(12) ?? null,
      afterAmountScale12: item.afterAmountTotal?.toFixed(12) ?? null,
      beforeEvidenceHash: item.beforeEvidenceHash, afterEvidenceHash: item.afterEvidenceHash }));
    const manifest = buildCutoverManifest({ releaseId: requiredEnvironment('SHIPMENT_STATEMENT_RELEASE_ID'),
      migrationManifestId: migration.id, createdAt: new Date().toISOString(),
      createdBy: requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID'), sourceCommit, evidence,
      keyId: requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_KEY_ID'), signingKey });
    await writeImmutableCutoverManifest(requiredOption('--out'), manifest);
    console.log(JSON.stringify({ decision: manifest.decision, failures: manifest.failures, integrityHash: manifest.integrityHash }));
    if (manifest.decision === 'NO_GO') process.exitCode = 2;
    return;
  }
  if (command === 'activate') {
    const signingKey = cutoverSigningKey();
    const source = requiredOption('--manifest');
    const manifest = await readAndVerifyCutoverManifest(source, signingKey);
    const currentFileEvidence = await verifyFileBackedCutoverEvidence(
      manifest.evidence, recaptureLegacyCohort, cohortApprovalVerifier(), sourceCommit,
    );
    if (JSON.stringify(currentFileEvidence) !== JSON.stringify(manifest.evidence)) {
      throw new Error('File-backed cutover evidence changed after the manifest was signed; rerun every gate.');
    }
    if (sourceCommit !== manifest.sourceCommit) throw new Error('The signed cutover manifest belongs to a different source commit.');
    const currentMigration = await prisma.shipmentStatementMigrationManifest.findUnique({ where: { id: manifest.migrationManifestId },
      include: { runs: { orderBy: { runNumber: 'desc' }, take: 2, include: { evidence: true } } } });
    if (!currentMigration) throw new Error('The signed migration manifest no longer exists.');
    const currentRuns = currentMigration.runs.map(run => ({ runNumber: run.runNumber, status: run.status,
      preservationScopes: run.evidence.length, mismatches: run.evidence.filter(item => item.outcome !== 'MATCHED').length }));
    if (JSON.stringify(currentRuns) !== JSON.stringify(manifest.evidence.deployment.migrationRuns)) {
      throw new Error('Migration evidence changed after the cutover manifest was signed; rerun the gates.');
    }
    if (process.env.NODE_ENV !== 'production') {
      const activationArtifacts = await mkdtemp(join(tmpdir(), 'shipment-cutover-activation-'));
      try {
      const captured = await captureAuthoritativeCutoverGates(manifest.evidence, {
        artifactDirectory: activationArtifacts, sourceCommit,
        incidentContacts: requiredEnvironmentList('SHIPMENT_STATEMENT_INCIDENT_CONTACTS'),
        monitoringChecks: requiredEnvironmentList('SHIPMENT_STATEMENT_MONITORING_CHECKS'), run: runCommand,
      });
      const verified = await verifyFileBackedCutoverEvidence(captured, recaptureLegacyCohort, cohortApprovalVerifier(), sourceCommit);
      assertAuthoritativeGateParity(manifest.evidence, verified);
      if (evaluateCutoverEvidence(verified).decision !== 'GO') {
        throw new Error('The immediately repeated authoritative cutover gates returned NO-GO.');
      }
      } finally {
        await rm(activationArtifacts, { recursive: true, force: true });
      }
    }
    const activatedBy = requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID');
    const result = await activateShipmentStatementCutover({ repository, manifest, activatedBy, signingKey, environment: process.env });
    if (!result.cutoverAt) throw new Error('Cutover activation returned no compatibility boundary.');
    const receiptCore = { schemaVersion: 1, releaseId: manifest.releaseId, manifestIntegrityHash: manifest.integrityHash,
      migrationManifestId: manifest.migrationManifestId, cutoverAt: result.cutoverAt.toISOString(),
      activatedAt: result.activatedAt.toISOString(), activatedBy };
    const receiptIntegrityHash = createHash('sha256').update(JSON.stringify(receiptCore)).digest('hex');
    const receipt = { ...receiptCore, receiptIntegrityHash, signature: { algorithm: 'HMAC-SHA256',
      keyId: manifest.signature.keyId, value: createHmac('sha256', signingKey).update(receiptIntegrityHash).digest('hex') } };
    await writeReceipt(requiredOption('--receipt'), receipt);
    console.log(JSON.stringify(receipt));
    return;
  }
  throw new Error(usage);
};

run().finally(() => prisma.$disconnect());
